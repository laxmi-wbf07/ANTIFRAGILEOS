/* ============================================================
   game.js — the day, the streak, the level, the milestones

   Everything in here is *derived* from what you actually logged. There
   is no stored score anywhere in the document, which is the whole point:
   a number that lives on disk is a number that can drift away from the
   thing it claims to measure, and it is the one thing a hand-edited
   export could inflate. Delete a session and the level goes down. That
   is correct.

   ------------------------------------------------------------
   The rule everything here obeys

       Could you move this number without doing the thing?

   If yes, it does not go in. So:

     focus minutes   real elapsed time, weighted by how unbroken it was
     cards           capped per day by the scheduler and again by a hard
                     ceiling, so a cram session cannot be farmed
     days won        needs all three rings on the same day
     water           counts towards the day, but earns no points of its
                     own — it is the one self-reported number in here and
                     tapping a button is not an achievement

   ------------------------------------------------------------
   Depth, and why long blocks are worth more

   Fifty minutes in one sitting is not the same work as five tens. The
   literature is unambiguous and so is anyone who has tried both. So the
   focus points a session earns are its real minutes multiplied by how
   unbroken it was, and the multiplier is visible and explainable rather
   than a secret sauce:

     ×1.0  base
     +0.1  per full 25 minutes in one unbroken work phase, up to +0.4
     -0.05 per distraction you counted, down to a floor of ×0.6

   A 90-minute block with nothing pulling at it is worth 1.4× its own
   length. The same 90 minutes as six broken fifteens is worth 1.0×.
   Nothing about that is punishment — it is the app agreeing with you
   about which of the two was harder.
   ============================================================ */

import { ds, pd, clamp, plural, durFmt } from './util.js';
import { counts, recalledTotal } from './srs.js';
import * as water from './hydration.js';
import * as money from './money.js';

/* ---------- the rollup ----------
   One pass over the three logs, giving a per-date row that everything
   else in this file reads by lookup.

   This exists because of what it replaced. The streak walks back up to
   800 days, and each of those days used to re-scan every review you own
   to count that date — six thousand reviews across eight hundred days is
   five million comparisons, and the feed was asking for it after every
   single swipe. Built once and keyed on the revision, the same work is
   a few thousand operations and then free until the next write. */
let rollKey = '';
let rollVal = null;

function rollup(doc) {
  const key = (doc.meta?.rev || 0) + '|' + doc.reviews.length + '|' + doc.sessions.length;
  if (key === rollKey && rollVal) return rollVal;

  const byDate = new Map();
  const row = d => {
    let r = byDate.get(d);
    if (!r) byDate.set(d, (r = { reviews: 0, recalled: 0, focusMin: 0, depthMin: 0, ml: 0 }));
    return r;
  };

  for (const r of doc.reviews || []) {
    if (!r || !r.date) continue;
    const x = row(r.date);
    x.reviews++;
    if (r.g >= 3) x.recalled++;
  }
  for (const x of doc.sessions) {
    if (!x || !x.date) continue;
    const r = row(x.date);
    r.focusMin += x.minutes || 0;
    r.depthMin += depthMinutes(x);
  }
  for (const [date, day] of Object.entries(doc.hydration.days)) {
    row(date).ml = day.ml || 0;
  }

  rollVal = { byDate, dates: [...byDate.keys()].sort() };
  rollKey = key;
  return rollVal;
}

const EMPTY_ROW = { reviews: 0, recalled: 0, focusMin: 0, depthMin: 0, ml: 0 };
function rowOn(doc, date) {
  return rollup(doc).byDate.get(date) || EMPTY_ROW;
}

/* ---------- depth ---------- */
export const DEPTH = { per: 25, step: 0.1, max: 1.4, min: 0.6, pull: 0.05 };

/** The multiplier a single session earned, and why. */
export function depthFactor(s) {
  const block = Math.max(1, Number(s?.workMin) || 0);
  const bonus = Math.min(0.4, Math.floor(block / DEPTH.per) * DEPTH.step);
  const pulls = (Number(s?.distractions) || 0) * DEPTH.pull;
  return clamp(1 + bonus - pulls, DEPTH.min, DEPTH.max);
}
/** Real minutes, weighted. This is what the level actually counts. */
export function depthMinutes(s) {
  return Math.round((Number(s?.minutes) || 0) * depthFactor(s));
}

/* ---------- the three rings ----------
   A ring is a goal that is either closed or it is not. There is no
   partial credit in the streak, because "nearly" is how a streak becomes
   a thing you argue with.

   A ring switches itself off when its goal is off: a focus target of
   zero, or no cards at all. The day is judged on the rings that are
   actually on, so turning a feature off never makes the day unwinnable. */
export function rings(doc, date = ds()) {
  const out = [];

  if (doc.cards.length) {
    const c = counts(doc);
    const owed = c.due + c.learn;
    out.push({
      id: 'cards',
      label: 'Cards',
      icon: 'cards',
      done: owed === 0,
      /* How full the ring looks. Cleared is full; otherwise it is what
         share of today's queue you have actually got through. */
      pct: owed === 0 ? 1 : clamp(rowOn(doc, date).reviews / (rowOn(doc, date).reviews + owed), 0, 0.98),
      say: owed === 0 ? 'Nothing owed' : `${plural(owed, 'card')} still due`,
    });
  }

  const goal = doc.settings.focus.dailyGoalMin || 0;
  if (goal > 0) {
    const mins = focusMinutesOn(doc, date);
    out.push({
      id: 'focus',
      label: 'Focus',
      icon: 'focus',
      done: mins >= goal,
      pct: clamp(mins / goal, 0, 1),
      say: mins >= goal ? `${durFmt(mins)} done` : `${durFmt(goal - mins)} to go`,
    });
  }

  const st = water.status(doc, date);
  out.push({
    id: 'water',
    label: 'Water',
    icon: 'cup',
    done: st.done,
    pct: clamp(st.total / st.target, 0, 1),
    say: st.done ? 'Target met' : `${water.fmtVol(st.left, doc.settings.water.unit)} to go`,
  });

  return out;
}

/**
 * What a day amounts to.
 *
 *   won    every ring on that day closed
 *   kept   at least one closed — you showed up, and that is enough to
 *          hold a streak together
 *   empty  nothing at all
 */
export function dayState(doc, date = ds()) {
  const r = rings(doc, date);
  const closed = r.filter(x => x.done).length;
  if (!r.length) return { rings: r, closed, of: 0, won: false, kept: false };
  return {
    rings: r,
    closed,
    of: r.length,
    won: closed === r.length,
    kept: closed > 0,
  };
}

/* A past day cannot be re-derived from `rings`, because the card ring
   asks what is due *now*. So history is judged on what the logs can
   still prove happened on that date: minutes focused, cards reviewed,
   water drunk. Today is the only day the live rings speak for. */
function pastDay(doc, date) {
  const goal = doc.settings.focus.dailyGoalMin || 0;
  const r = rowOn(doc, date);
  const marks = [];
  if (doc.cards.length) marks.push(r.reviews > 0);
  if (goal > 0) marks.push(r.focusMin >= goal);
  marks.push(r.ml >= water.target(doc));
  const closed = marks.filter(Boolean).length;
  return { closed, of: marks.length, won: marks.length > 0 && closed === marks.length, kept: closed > 0 };
}

export function dayAt(doc, date, today = ds()) {
  return date === today ? dayState(doc, date) : pastDay(doc, date);
}

/* ---------- the streak ----------
   Won days advance it. A day where you did something but not everything
   holds it where it is. Only a day with nothing at all on it breaks it.

   That grace is deliberate and it is the most important rule in this
   file. A streak that snaps the first time you have a bad day punishes
   you at exactly the moment you are least able to take it, and the
   thing people do next is not "try harder tomorrow", it is delete the
   app. Showing up at all has to be worth something. */
export function streak(doc, today = ds()) {
  let run = 0;
  let holds = 0;
  const d = pd(today);

  // Today only counts once it is won; an unwon today is simply not news yet.
  const first = dayAt(doc, ds(d), today);
  if (!first.won) d.setDate(d.getDate() - 1);

  for (let i = 0; i < 800; i++) {
    const day = dayAt(doc, ds(d), today);
    if (day.won) run++;
    else if (day.kept) holds++;
    else break;
    d.setDate(d.getDate() - 1);
  }
  return { run, holds, live: first.won };
}

/** Days in a row with at least something on them. */
export function showUpStreak(doc, today = ds()) {
  const d = pd(today);
  if (!dayAt(doc, ds(d), today).kept) d.setDate(d.getDate() - 1);
  let run = 0;
  while (run < 800 && dayAt(doc, ds(d), today).kept) {
    run++;
    d.setDate(d.getDate() - 1);
  }
  return run;
}

/* ---------- points and levels ----------
   One number, three honest sources, and a hard daily ceiling on the one
   that could otherwise be farmed. */
export const CARD_XP_CAP = 120;          // per day, whatever you review
export const XP = { perCard: 1, perDayWon: 40, perDayKept: 10 };

export function focusMinutesOn(doc, date) {
  return rowOn(doc, date).focusMin;
}
export function depthMinutesOn(doc, date) {
  return rowOn(doc, date).depthMin;
}

/** Points earned on one date, and where they came from. */
export function pointsOn(doc, date, today = ds()) {
  const r = rowOn(doc, date);
  const cards = Math.min(CARD_XP_CAP, r.reviews * XP.perCard);
  const day = dayAt(doc, date, today);
  const bonus = day.won ? XP.perDayWon : day.kept ? XP.perDayKept : 0;
  return { focus: r.depthMin, cards, bonus, total: r.depthMin + cards + bonus };
}

/* The whole tab reads this several times a paint and it is a pass over
   every session, every review and every logged day. `meta.rev` changes
   on every write, so it is an exact fingerprint of anything that could
   move the answer — which makes this free between writes and correct
   across them. */
let statKey = '';
let statVal = null;

export function stats(doc, today = ds()) {
  const key = (doc.meta?.rev || 0) + '|' + today;
  if (key === statKey && statVal) return statVal;

  const dates = rollup(doc).dates;
  let points = 0;
  let won = 0;
  let kept = 0;
  let bestDayMin = 0;
  let bestDayDate = '';

  for (const date of dates) {
    const p = pointsOn(doc, date, today);
    points += p.total;
    const day = dayAt(doc, date, today);
    if (day.won) won++;
    else if (day.kept) kept++;
    const mins = rowOn(doc, date).focusMin;
    if (mins > bestDayMin) { bestDayMin = mins; bestDayDate = date; }
  }

  let longest = null;
  let focusMin = 0;
  let finished = 0;
  for (const s of doc.sessions) {
    focusMin += s.minutes || 0;
    if (!longest || (s.minutes || 0) > (longest.minutes || 0)) longest = s;
    /* "Finished" means the clock ran out rather than you stopping it:
       every planned round actually happened. */
    if ((s.completedRounds ?? 0) >= (s.rounds ?? 1)) finished++;
  }

  const run = streak(doc, today);
  const out = {
    points,
    level: levelOf(points),
    daysWon: won,
    daysKept: kept,
    daysActive: dates.length,
    firstDate: dates[0] || today,
    streak: run.run,
    holds: run.holds,
    streakLive: run.live,
    showUp: showUpStreak(doc, today),
    focusMin,
    focusHours: Math.floor(focusMin / 60),
    sessions: doc.sessions.length,
    finished,
    finishRate: doc.sessions.length ? finished / doc.sessions.length : 0,
    longest,
    longestMin: longest?.minutes || 0,
    bestDayMin,
    bestDayDate,
    reviews: (doc.reviews || []).length,
    recalled: recalledTotal(doc),
    cards: doc.cards.length,
    waterDays: Object.keys(doc.hydration.days).filter(k => (doc.hydration.days[k].ml || 0) >= water.target(doc)).length,
    waterStreak: water.streak(doc, today),
    /* Money never earns points — it is self-reported, like water, and
       tapping a button is not an achievement. It gets milestones only,
       and those are about behaviour rather than about logging. */
    moneyEntries: doc.money.entries.length,
    moneyDays: new Set(doc.money.entries.map(e => e.date)).size,
    periodsUnder: moneyUnder(doc, today),
    today: pointsOn(doc, today, today),
  };

  statKey = key;
  statVal = out;
  return out;
}

function moneyUnder(doc, today) {
  try { return doc.settings.money.allowance ? money.periodsUnder(doc, today) : 0; }
  catch (e) { return 0; }
}

/* ---------- levels ----------
   Ten of them, named rather than numbered, because "Level 6" says
   nothing and "Furnace" says the same nothing more memorably. The gaps
   widen: the early ones arrive in days, the last one is a year of real
   work, and none of them unlock a feature. They are a record of what has
   happened, not a gate in front of what has not. */
export const LEVELS = [
  { n: 1, name: 'Spark', at: 0 },
  { n: 2, name: 'Kindling', at: 300 },
  { n: 3, name: 'Ember', at: 900 },
  { n: 4, name: 'Steady', at: 2000 },
  { n: 5, name: 'Forge', at: 4000 },
  { n: 6, name: 'Furnace', at: 7500 },
  { n: 7, name: 'Engine', at: 13000 },
  { n: 8, name: 'Flywheel', at: 22000 },
  { n: 9, name: 'Relentless', at: 36000 },
  { n: 10, name: 'Lodestar', at: 60000 },
];

export function levelOf(points) {
  let cur = LEVELS[0];
  for (const l of LEVELS) if (points >= l.at) cur = l;
  const next = LEVELS.find(l => l.at > points) || null;
  const span = next ? next.at - cur.at : 1;
  return {
    ...cur,
    next,
    into: points - cur.at,
    span,
    pct: next ? clamp((points - cur.at) / span, 0, 1) : 1,
    toNext: next ? next.at - points : 0,
  };
}

/* ---------- milestones ----------
   Specific, earned, and permanent. None of them is a currency and none
   of them can be lost, because a thing you can lose is a reason to stop
   opening the app. Each one is a fact about something that happened. */
export const MILESTONES = [
  { id: 'first-session', group: 'Focus', name: 'First session', hint: 'Sit down once', test: s => s.sessions >= 1 },
  { id: 'hours-10', group: 'Focus', name: 'Ten hours', hint: '10 hours of focus logged', test: s => s.focusMin >= 600 },
  { id: 'hours-50', group: 'Focus', name: 'Fifty hours', hint: '50 hours of focus logged', test: s => s.focusMin >= 3000 },
  { id: 'hours-100', group: 'Focus', name: 'A hundred hrs', hint: '100 hours of focus logged', test: s => s.focusMin >= 6000 },
  { id: 'long-90', group: 'Focus', name: 'Ninety unbroken', hint: 'One session of 90 minutes or more', test: s => s.longestMin >= 90 },
  { id: 'day-4h', group: 'Focus', name: 'Four-hour day', hint: 'Four hours of focus in one day', test: s => s.bestDayMin >= 240 },
  { id: 'finish-20', group: 'Focus', name: 'Sees it through', hint: '20 sessions run to the last round', test: s => s.finished >= 20 },

  { id: 'first-card', group: 'Cards', name: 'First card', hint: 'Write one', test: s => s.cards >= 1 },
  { id: 'cards-100', group: 'Cards', name: 'A hundred', hint: '100 cards remembered without turning them over', test: s => s.recalled >= 100 },
  { id: 'cards-1000', group: 'Cards', name: 'A thousand', hint: '1000 cards remembered', test: s => s.recalled >= 1000 },
  { id: 'cards-5000', group: 'Cards', name: 'Five thousand', hint: '5000 cards remembered', test: s => s.recalled >= 5000 },
  { id: 'deck-100', group: 'Cards', name: 'A real deck', hint: '100 cards written', test: s => s.cards >= 100 },

  { id: 'water-7', group: 'Water', name: 'A week of water', hint: '7 days at target', test: s => s.waterDays >= 7 },
  { id: 'water-30', group: 'Water', name: 'A month of water', hint: '30 days at target', test: s => s.waterDays >= 30 },
  { id: 'water-run-14', group: 'Water', name: 'Fourteen in a row', hint: '14 consecutive days at target', test: s => s.waterStreak >= 14 },

  { id: 'money-log', group: 'Money', name: 'First entry', hint: 'Write down one thing you spent', test: s => s.moneyEntries >= 1 },
  { id: 'money-30', group: 'Money', name: 'A month tracked', hint: '30 days with spending logged', test: s => s.moneyDays >= 30 },
  { id: 'money-under', group: 'Money', name: 'Came in under', hint: 'Finish a whole period inside the allowance', test: s => s.periodsUnder >= 1 },
  { id: 'money-under-3', group: 'Money', name: 'Three in a row', hint: 'Three finished periods inside the allowance', test: s => s.periodsUnder >= 3 },

  { id: 'day-1', group: 'The day', name: 'First full day', hint: 'Close every ring once', test: s => s.daysWon >= 1 },
  { id: 'streak-7', group: 'The day', name: 'A week', hint: 'Seven full days in a row', test: s => s.streak >= 7 },
  { id: 'streak-30', group: 'The day', name: 'A month', hint: 'Thirty full days in a row', test: s => s.streak >= 30 },
  { id: 'streak-100', group: 'The day', name: 'A hundred', hint: 'A hundred full days in a row', test: s => s.streak >= 100 },
  { id: 'days-50', group: 'The day', name: 'Fifty won', hint: '50 full days, in any order', test: s => s.daysWon >= 50 },
  { id: 'showup-30', group: 'The day', name: 'Turned up', hint: '30 days in a row with something on them', test: s => s.showUp >= 30 },
  { id: 'level-7', group: 'The day', name: 'Engine', hint: 'Reach the level the app is named after', test: s => s.level.n >= 7 },
];

export function milestoneState(doc, s = stats(doc)) {
  const seen = doc.game.seen || {};
  return MILESTONES.map(m => ({ ...m, got: !!m.test(s), at: seen[m.id] || 0 }));
}

/**
 * Anything newly true that has not been announced yet, marked as seen.
 * Called after something is logged, so the celebration happens at the
 * moment it was earned rather than the next time the tab is opened.
 */
export function claimNew(doc, now = Date.now()) {
  const s = stats(doc);
  const seen = doc.game.seen || (doc.game.seen = {});
  const fresh = [];
  for (const m of MILESTONES) {
    if (seen[m.id]) continue;
    let got = false;
    try { got = !!m.test(s); } catch (e) { got = false; }
    if (!got) continue;
    seen[m.id] = now;
    fresh.push(m);
  }
  return fresh;
}

/** The last `n` days as bars, for the strip on the progress tab. */
export function history(doc, n = 14, today = ds()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = pd(today);
    d.setDate(d.getDate() - i);
    const key = ds(d);
    const day = dayAt(doc, key, today);
    out.push({
      date: key,
      won: day.won,
      kept: day.kept,
      closed: day.closed,
      of: day.of || 1,
      points: pointsOn(doc, key, today).total,
    });
  }
  return out;
}
