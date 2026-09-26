/* ============================================================
   hydration.js — what you drank, and when to ask again

   The whole feature is one idea: a reminder is worth having only if it
   knows what you have already done. So nothing in here fires on the
   hour. The next nudge is measured from your last drink, which means
   drinking early moves it along instead of being ignored, and a phone
   left face-down for three hours is greeted with one ask rather than
   three stacked ones.

   Two numbers do all the work:

     total     what is in you today
     pace      what should be in you by this minute, spread evenly
               across your waking window

   Being behind pace is information, not a failure, and everything the
   app says about it is phrased that way.
   ============================================================ */

import { uid, ds, pd, toMin, nowMin, clamp, round } from './util.js';

const ML_PER_OZ = 29.5735;

/* ---------- units ----------
   Stored in millilitres always. The unit is a display choice, so it can
   be changed at any time without touching a single logged drink. */
export function toMl(value, unit = 'ml') {
  const n = Number(value) || 0;
  return Math.round(unit === 'oz' ? n * ML_PER_OZ : n);
}
export function fromMl(ml, unit = 'ml') {
  const n = Number(ml) || 0;
  return unit === 'oz' ? round(n / ML_PER_OZ, 1) : Math.round(n);
}
/** '750 ml' / '25 oz' — the number and its unit, never one without the other. */
export function fmtVol(ml, unit = 'ml') {
  if (unit === 'oz') return `${fromMl(ml, 'oz')} oz`;
  const n = Math.round(Number(ml) || 0);
  return n >= 1000 ? `${round(n / 1000, n % 1000 === 0 ? 0 : 1)} L` : `${n} ml`;
}
/** Just the number, for a field the unit is already labelling. */
export function volNum(ml, unit = 'ml') { return fromMl(ml, unit); }
export function unitLabel(unit = 'ml') { return unit === 'oz' ? 'oz' : 'ml'; }

/* ---------- the day ---------- */
export function dayRec(doc, date = ds()) {
  const days = doc.hydration.days;
  if (!days[date]) days[date] = { ml: 0, log: [] };
  return days[date];
}
export function totalMl(doc, date = ds()) {
  return doc.hydration.days[date]?.ml || 0;
}
export function target(doc) {
  return Math.max(1, doc.settings.water.targetMl || 2000);
}
/** 0..1, and never past 1 — a ring that overfills reads as broken. */
export function progress(doc, date = ds()) {
  return clamp(totalMl(doc, date) / target(doc), 0, 1);
}
export function hitTarget(doc, date = ds()) {
  return totalMl(doc, date) >= target(doc);
}

/** Log a drink. Returns the new total. */
export function drink(doc, ml, now = Date.now()) {
  const amount = Math.round(Number(ml) || 0);
  if (amount <= 0) return totalMl(doc);
  const day = dayRec(doc, ds(new Date(now)));
  day.log.push({ id: uid('w'), at: now, ml: amount });
  day.ml += amount;
  return day.ml;
}

/** Take the most recent drink back off. Returns what it removed, or 0. */
export function undoLast(doc, date = ds()) {
  const day = doc.hydration.days[date];
  if (!day || !day.log.length) return 0;
  const last = day.log.pop();
  day.ml = Math.max(0, day.ml - last.ml);
  return last.ml;
}

export function removeDrink(doc, id, date = ds()) {
  const day = doc.hydration.days[date];
  if (!day) return 0;
  const i = day.log.findIndex(e => e.id === id);
  if (i < 0) return 0;
  const [gone] = day.log.splice(i, 1);
  day.ml = Math.max(0, day.ml - gone.ml);
  return gone.ml;
}

export function clearDay(doc, date = ds()) {
  delete doc.hydration.days[date];
}

export function lastDrinkAt(doc, date = ds()) {
  const log = doc.hydration.days[date]?.log;
  return log && log.length ? log[log.length - 1].at : 0;
}

/* ---------- the waking window ----------
   Reminders belong inside it and nowhere else. A window that wraps past
   midnight is treated as ending at midnight rather than pretending to
   understand a night shift: the day key would change underneath it. */
export function windowOf(doc) {
  const w = doc.settings.water;
  const from = toMin(w.fromAt || '08:00');
  let to = toMin(w.toAt || '22:00');
  if (to <= from) to = Math.min(1439, from + 60);
  return { from, to, len: to - from };
}
export function inWindow(doc, minutes = nowMin()) {
  const { from, to } = windowOf(doc);
  return minutes >= from && minutes < to;
}

/** What should be in you by this minute, if the day were spread evenly. */
export function paceMl(doc, minutes = nowMin()) {
  const { from, to, len } = windowOf(doc);
  if (minutes <= from) return 0;
  if (minutes >= to) return target(doc);
  return Math.round(target(doc) * ((minutes - from) / len));
}

/**
 * Where you stand right now.
 *   behind   millilitres short of pace, 0 when level or ahead
 *   left     millilitres short of the day's target, 0 when done
 *   perHour  what clearing the rest of the day would take from here
 */
export function status(doc, date = ds(), minutes = nowMin()) {
  const total = totalMl(doc, date);
  const tgt = target(doc);
  const pace = paceMl(doc, minutes);
  const { to } = windowOf(doc);
  const hoursLeft = Math.max(0.25, (to - minutes) / 60);
  const left = Math.max(0, tgt - total);
  return {
    total,
    target: tgt,
    pace,
    left,
    behind: Math.max(0, pace - total),
    ahead: Math.max(0, total - pace),
    done: total >= tgt,
    pct: Math.round((total / tgt) * 100),
    perHour: left ? Math.round(left / hoursLeft) : 0,
    glasses: Math.max(0, Math.ceil(left / Math.max(1, doc.settings.water.glassMl || 250))),
  };
}

/* ---------- when to ask again ----------
   Spaced from the last thing that happened, whichever it was: a drink
   you logged, or the last time the app asked. Both count, because being
   asked twice for the same silence is the fastest way to be muted. */
export function nextDueAt(doc, date = ds(), lastNudge = 0) {
  const w = doc.settings.water;
  const { from, to } = windowOf(doc);
  const midnight = pd(date).getTime();
  const startOfWindow = midnight + from * 60_000;
  const endOfWindow = midnight + to * 60_000;

  const last = Math.max(lastDrinkAt(doc, date), Number(lastNudge) || 0, startOfWindow);
  const at = last + (w.everyMin || 90) * 60_000;
  return at > endOfWindow ? null : at;
}

/** Minutes until the next reminder. 0 means now, null means not today. */
export function dueIn(doc, date = ds(), lastNudge = 0, now = Date.now()) {
  if (!doc.settings.water.on) return null;
  const at = nextDueAt(doc, date, lastNudge);
  if (at == null) return null;
  return Math.max(0, Math.round((at - now) / 60_000));
}

/** True when a nudge is worth sending at this instant. */
export function isDue(doc, date = ds(), lastNudge = 0, now = Date.now(), minutes = nowMin()) {
  if (!doc.settings.water.on) return false;
  if (!inWindow(doc, minutes)) return false;
  if (hitTarget(doc, date)) return false;
  const at = nextDueAt(doc, date, lastNudge);
  return at != null && now >= at;
}

/* ---------- history ---------- */
/** The last `n` days, oldest first, today last. */
export function history(doc, n = 7, date = ds()) {
  const out = [];
  const tgt = target(doc);
  for (let i = n - 1; i >= 0; i--) {
    const day = pd(date);
    day.setDate(day.getDate() - i);
    const key = ds(day);
    const ml = doc.hydration.days[key]?.ml || 0;
    out.push({ date: key, ml, target: tgt, hit: ml >= tgt, pct: clamp(ml / tgt, 0, 1) });
  }
  return out;
}

/**
 * Days in a row that cleared the target.
 *
 * Today counts only once it is actually cleared — a run should not break
 * at one minute past midnight and then reappear in the evening, so an
 * uncleared today is skipped rather than counted as a miss.
 */
export function streak(doc, date = ds()) {
  const tgt = target(doc);
  const at = key => doc.hydration.days[key]?.ml || 0;
  const d = pd(date);
  if (at(ds(d)) < tgt) d.setDate(d.getDate() - 1);
  let run = 0;
  while (run < 400 && at(ds(d)) >= tgt) {
    run++;
    d.setDate(d.getDate() - 1);
  }
  return run;
}

/** Days with anything logged at all. */
export function loggedDays(doc) {
  return Object.keys(doc.hydration.days).length;
}

export { ds };
