/* ============================================================
   next.js — what to do now, and why

   One question, asked continuously: of everything outstanding, which
   single thing is worth doing at this minute?

   Answering it badly is easy. A to-do list sorted by "urgency" that you
   set yourself is just the list again, in a different order, and it is
   wrong within a day. So nothing here is a priority you type in. Every
   candidate scores itself from facts the app already holds — what the
   scheduler says is due, how far off the day's target you are, how long
   since you drank anything, what time it actually is.

   ------------------------------------------------------------
   One clock, shared by everything

   The day runs from when you are up (the water window's start) to when
   you wind down (the shutdown time). Everything measures itself against
   that one span, which is what stops the answers contradicting each
   other — an hour of work is a reasonable suggestion at four and an
   absurd one at eleven, and only a shared clock knows the difference.

       pressure = how far through that span you are, 0 -> 1

   ------------------------------------------------------------
   How a candidate scores

       need        0..1  how much of it is outstanding
       pressure    0..1  how little of the day is left
       urgency     need x (0.45 + 0.55 x pressure)
       fit         0..1  can it actually be done in the time left
       score       urgency x fit, then two adjustments

   The two adjustments are the only opinions in the file, and both are
   there because of how people actually behave rather than how a
   scheduler would prefer them to:

     finishing beats starting   something four-fifths done is worth more
                                than something untouched, because the
                                last fifth is cheap and closing it is
                                what makes the next day easier

     protect the day            late in the evening with nothing closed,
                                the cheapest closable ring jumps to the
                                front. Not because water matters more
                                than work, but because a day that ends
                                with nothing on it is the one that
                                breaks the habit, and one glass costs a
                                minute

   Everything it decides is shown, with the numbers, in the "why this"
   sheet. A recommendation you cannot interrogate is one you stop
   trusting the first time it is wrong.
   ============================================================ */

import { ds, toMin, nowMin, clamp, durFmt, plural } from './util.js';
import { counts } from './srs.js';
import * as water from './hydration.js';
import * as money from './money.js';
import * as game from './game.js';

/* ---------- the shared clock ---------- */
export function clock(doc, minutes = nowMin()) {
  const start = toMin(doc.settings.water.fromAt || '08:00');
  let end = toMin(doc.settings.notif.shutdownAt || '22:30');
  if (end <= start) end = Math.min(1439, start + 840);
  const span = end - start;
  const before = minutes < start;
  return {
    minutes, start, end, span, before,
    minutesLeft: Math.max(0, end - minutes),
    /* Before you are up, the day has not started rather than being
       nearly over: pressure stays at zero instead of wrapping to one. */
    pressure: before ? 0 : clamp((minutes - start) / span, 0, 1),
    over: minutes >= end,
  };
}

/* Below this a block is not worth the walk to the library. */
const MIN_BLOCK = 5;

const urgencyOf = (need, pressure) => clamp(need, 0, 1) * (0.45 + 0.55 * clamp(pressure, 0, 1));

/* ---------- the candidates ----------
   Each returns null when it has nothing to say, so "nothing is
   outstanding" is represented by an empty list rather than by a row
   saying zero. */

function cardsCandidate(doc, c, date) {
  if (!doc.cards.length) return null;
  const t = counts(doc);
  const owed = t.due + t.learn;
  const fresh = t.new;
  if (!owed && !fresh) return null;

  /* A card three days overdue is not three times as urgent, but it is
     more urgent, and the curve should flatten rather than run away. */
  const now = Date.now();
  let lateDays = 0;
  let n = 0;
  for (const card of doc.cards) {
    if (card.suspended || card.state === 'new' || card.due > now) continue;
    lateDays += (now - card.due) / 864e5;
    n++;
  }
  const avgLate = n ? lateDays / n : 0;
  const stale = clamp(avgLate / 6, 0, 1);

  const need = owed
    ? clamp(0.45 + 0.35 * clamp(owed / 50, 0, 1) + 0.2 * stale, 0, 1)
    : 0.25;                                    // only new cards waiting

  const mins = Math.max(1, Math.round(((owed || fresh) * 8) / 60));
  return {
    id: 'cards',
    label: owed ? `Review ${plural(owed, 'card')}` : `Start ${plural(fresh, 'new card')}`,
    icon: 'cards',
    route: 'reel', param: '',
    go: 'Review',
    cost: mins,
    need,
    why: owed
      ? (avgLate >= 1
        ? `${plural(owed, 'card')} due, and the oldest have been waiting ${plural(Math.round(avgLate), 'day')}. They came back because you forgot them.`
        : `${plural(owed, 'card')} due today. Ten minutes clears most of it.`)
      : `${plural(fresh, 'new card')} waiting to be met for the first time.`,
    ring: 'cards',
    minFit: 2,
  };
}

function focusCandidate(doc, c, date) {
  /* A target of zero is not "no opinion", it is the user having said
     there is no daily obligation — the ring is off too. Suggesting a
     session anyway would be the app overriding a setting it was given
     on purpose. The Focus tab is still one tap away. */
  const goal = doc.settings.focus.dailyGoalMin || 0;
  if (goal <= 0) return null;
  const done = game.focusMinutesOn(doc, date);
  if (done >= goal) return null;

  const gap = goal - done;
  const preset = doc.settings.focus.presets.find(p => p.id === doc.settings.focus.defaultPreset)
    || doc.settings.focus.presets[0] || { work: 45, rounds: 1, brk: 0 };

  /* What will actually fit: never longer than the gap, never longer
     than the evening has room for, never so short it is not a session. */
  const room = Math.max(0, c.minutesLeft - 5);
  const want = Math.min(preset.work || 45, Math.max(10, gap));
  const block = clamp(Math.min(want, room), 0, 240);
  /* A session that does not fit is not a smaller session, it is not a
     session. Without this the evening ran out and the card cheerfully
     offered a block of zero minutes. */
  if (block < MIN_BLOCK) return null;

  const need = clamp(gap / goal, 0, 1);
  return {
    id: 'focus',
    label: block >= want ? `Focus for ${durFmt(block)}` : `Focus for ${durFmt(block)} — what fits`,
    icon: 'focus',
    route: 'focus', param: 'start',
    go: 'Start',
    cost: Math.max(0, block),
    need,
    shape: { work: Math.max(1, block), brk: 0, rounds: 1 },
    why: done
      ? `${durFmt(done)} logged, ${durFmt(gap)} short of the day. One block covers it.`
      : `Nothing focused yet, and the target is ${durFmt(goal)}. Starting badly beats starting late.`,
    ring: 'focus',
    minFit: 10,
  };
}

function waterCandidate(doc, c, date) {
  if (!doc.settings.water.on) return null;
  const st = water.status(doc, date, c.minutes);
  if (st.done) return null;
  /* Outside the hours you said you are awake, a glass of water is not
     the next step — and the window, not merely "before you are up", is
     what says so. Half eleven at night used to slip through. */
  if (!water.inWindow(doc, c.minutes)) return null;

  const glass = doc.settings.water.glassMl || 250;
  const since = water.lastDrinkAt(doc, date);
  const gapMin = since ? Math.round((Date.now() - since) / 60000) : null;

  /* Being behind pace is the need; the number of glasses is the size of
     the job, not the urgency of it. */
  const need = clamp(st.behind / Math.max(glass, st.target * 0.25), 0, 1) * 0.85
    + clamp(st.left / st.target, 0, 1) * 0.15;

  return {
    id: 'water',
    label: `Drink ${water.fmtVol(glass, doc.settings.water.unit)}`,
    icon: 'cup',
    route: 'water', param: 'drink',
    go: 'Log it',
    cost: 1,
    need: clamp(need, 0, 1),
    why: st.behind >= glass
      ? `${water.fmtVol(st.behind, doc.settings.water.unit)} behind where the day should be${gapMin != null && gapMin > 60 ? `, and nothing for ${durFmt(gapMin)}` : ''}.`
      : `${water.fmtVol(st.left, doc.settings.water.unit)} left of today's target.`,
    ring: 'water',
    minFit: 0,
  };
}

function moneyCandidate(doc, c, date) {
  const m = doc.settings.money;
  if (!m.on) return null;
  const gap = money.daysSinceLogged(doc, date);
  if (gap === 0) return null;
  /* Nothing to say on day one of using the app. */
  if (gap > 90) return null;

  const askAt = toMin(m.askAt || '21:00');
  const evening = c.minutes >= askAt;
  const need = clamp(gap / 4, 0, 1) * (evening ? 1 : 0.45);
  if (need < 0.12) return null;

  return {
    id: 'money',
    label: gap === 1 ? 'Log yesterday’s spending' : `Log ${plural(gap, 'day')} of spending`,
    icon: 'wallet',
    route: 'money', param: 'add',
    go: 'Log it',
    cost: 2,
    need,
    why: gap === 1
      ? 'Nothing logged since yesterday. It takes longer to remember than to write down.'
      : `Nothing logged for ${plural(gap, 'day')}. Any longer and you will be guessing.`,
    ring: null,
    minFit: 0,
  };
}

const BUILDERS = [cardsCandidate, focusCandidate, waterCandidate, moneyCandidate];

/* ---------- scoring ---------- */
export function rank(doc, date = ds(), minutes = nowMin()) {
  const c = clock(doc, minutes);
  const day = game.dayState(doc, date);
  const openRings = day.rings.filter(r => !r.done);

  const list = [];
  for (const build of BUILDERS) {
    let item = null;
    try { item = build(doc, c, date); } catch (e) { item = null; }
    if (!item) continue;

    const urgency = urgencyOf(item.need, c.pressure);

    /* Can it be done in what is left? A one-minute job always fits; an
       hour of work at ten past ten does not, and pretending otherwise
       is how a recommendation loses its credibility. */
    const room = c.minutesLeft;
    const fit = c.over ? 0.15
      : item.cost <= room ? 1
        : room >= item.minFit ? clamp(room / Math.max(1, item.cost), 0.2, 0.9)
          : 0.05;

    const factors = [
      { name: 'Outstanding', value: item.need },
      { name: 'Time pressure', value: c.pressure },
      { name: 'Fits the time left', value: fit },
    ];

    let score = urgency * fit;

    /* Finishing beats starting. */
    const ring = item.ring ? day.rings.find(r => r.id === item.ring) : null;
    if (ring && !ring.done && ring.pct >= 0.7) {
      score *= 1.18;
      factors.push({ name: 'Nearly closed', value: ring.pct });
    }

    list.push({ ...item, urgency, fit, score: clamp(score, 0, 1.4), factors, clock: c });
  }

  /* Protect the day. Late, with nothing closed at all, the cheapest
     thing that can still close a ring goes to the front — because the
     day that ends empty is the one that breaks the run, and the
     difference between "nothing" and "something" is worth more than the
     difference between "something" and "more". */
  let guarded = null;
  if (day.of && day.closed === 0 && c.pressure >= 0.62 && !c.over) {
    const closable = list
      .filter(x => x.ring && openRings.some(r => r.id === x.ring) && x.cost <= c.minutesLeft)
      .sort((a, b) => a.cost - b.cost)[0];
    if (closable) {
      closable.score = Math.max(closable.score, 1.25);
      closable.factors.push({ name: 'Protects the day', value: 1 });
      closable.guard = true;
      guarded = closable.id;
    }
  }

  list.sort((a, b) => b.score - a.score);
  return { items: list, clock: c, day, guarded };
}

/**
 * The single thing to do now — or an honest reason there is nothing.
 *
 * "Rest" is a real answer, not a fallback. An app that always has
 * something for you to do is an app that never lets you finish, and the
 * whole point of closing the day is that it closes.
 */
export function next(doc, date = ds(), minutes = nowMin()) {
  const r = rank(doc, date, minutes);
  const top = r.items[0];

  /* Past wind-down the answer is always the same one, however much is
     outstanding. The app spends all day saying "start badly rather than
     late"; at half eleven the honest version of that is that the thing
     will be cheaper tomorrow, and an app that keeps finding you work at
     midnight is one you end up resenting. Whatever is still ranked is
     in the "why this" sheet for anyone who wants to argue. */
  if (r.clock.over || !top || top.score < 0.08) {
    return { ...r, top: restCard(doc, r, date) };
  }
  return { ...r, top };
}

function restCard(doc, r, date) {
  const day = r.day;
  if (r.clock.before) {
    return {
      id: 'rest', label: 'The day has not started', icon: 'clock',
      why: `Nothing is owed before ${fmtHM(r.clock.start)}. Come back then.`,
      rest: true, cost: 0, score: 0, factors: [],
    };
  }
  if (r.clock.over) {
    return {
      id: 'rest', label: 'Stop for the night', icon: 'clock',
      why: day.won
        ? 'Every ring closed and the day is past its end. Sleep is the next thing on the list.'
        : 'It is past wind-down. Whatever is left is tomorrow’s, and it will be cheaper then.',
      rest: true, cost: 0, score: 0, factors: [],
    };
  }
  return {
    id: 'rest', label: day.won ? 'Day won' : 'Nothing owed', icon: 'check',
    why: day.won
      ? 'Every ring closed. Anything more today is a bonus, not a debt.'
      : 'Nothing is due, nothing is behind. This is what caught up looks like.',
    rest: true, cost: 0, score: 0, factors: [],
  };
}

function fmtHM(min) {
  const h = Math.floor(min / 60), m = min % 60;
  const ap = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, '0')}${ap}` : `${h12}${ap}`;
}

export { ds };
