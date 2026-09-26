/* ============================================================
   money.js — pocket money, and what is left of it

   The whole feature is one question: **can I spend this?** Everything
   in here exists to answer it in one number, so the tab does not become
   a spreadsheet you stop opening.

   The model is deliberately thin. An allowance arrives on a day you
   choose, entries come off it, and the three numbers that matter are
   worked out rather than stored:

     left      allowance minus what you have spent this period
     perDay    what is left, divided by the days still to come
     pace      what you should have spent by now if it were even

   Being ahead of pace is not a failure and is never drawn in red. It is
   a position, the same way being behind on a plan is — and the useful
   response to it is a smaller number for tomorrow, not a telling off.

   ------------------------------------------------------------
   Why there is no ring for this

   The three rings are habits you do every day. Spending is not: a day
   you spent nothing is a good day, not an unclosed ring. So money never
   blocks the day and never earns points — it only asks to be *logged*,
   and only when it has been a while.
   ============================================================ */

import { uid, ds, pd, addDays, daysBetween, clamp, round } from './util.js';

/* ---------- formatting ---------- */
export function fmt(doc, amount) {
  const sym = doc.settings.money.symbol || '₹';
  const n = Math.abs(Number(amount) || 0);
  /* Whole numbers are the common case for pocket money and ".00" on
     every row is noise, so the decimals only appear when they carry
     something. */
  const body = n % 1 === 0 ? String(Math.round(n)) : n.toFixed(2);
  const grouped = body.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (Number(amount) < 0 ? '-' : '') + sym + grouped;
}
/** Short, for a chart label where the symbol is already established. */
export function fmtShort(doc, amount) {
  const n = Math.round(Number(amount) || 0);
  const sym = doc.settings.money.symbol || '₹';
  if (Math.abs(n) >= 100000) return sym + round(n / 1000, 0) + 'k';
  if (Math.abs(n) >= 1000) return sym + round(n / 1000, 1) + 'k';
  return sym + n;
}

/* ---------- the period ----------
   An allowance lands on a day and covers until the next one lands. A
   monthly one that starts on the 31st has to survive February, so the
   day is clamped to what the month actually has. */
function monthStart(date, startDay) {
  const d = pd(date);
  const day = Math.min(startDay, daysIn(d.getFullYear(), d.getMonth()));
  if (d.getDate() >= day) return ds(new Date(d.getFullYear(), d.getMonth(), day));
  const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return ds(new Date(prev.getFullYear(), prev.getMonth(), Math.min(startDay, daysIn(prev.getFullYear(), prev.getMonth()))));
}
function daysIn(y, m) { return new Date(y, m + 1, 0).getDate(); }

function weekStartOn(date, startDow) {
  const d = pd(date);
  const back = (d.getDay() - startDow + 7) % 7;
  return addDays(date, -back);
}

/** { from, to, days, dayIndex, daysLeft } for the period containing `date`. */
export function period(doc, date = ds()) {
  const m = doc.settings.money;
  const from = m.period === 'week'
    ? weekStartOn(date, m.startDay ?? 1)
    : monthStart(date, m.startDay || 1);
  const next = m.period === 'week'
    ? addDays(from, 7)
    : nextMonthStart(from, m.startDay || 1);
  const to = addDays(next, -1);                 // inclusive last day
  const days = Math.max(1, daysBetween(from, next));
  const dayIndex = clamp(daysBetween(from, date) + 1, 1, days);
  return { from, to, days, dayIndex, daysLeft: Math.max(1, days - dayIndex + 1) };
}

function nextMonthStart(from, startDay) {
  const d = pd(from);
  const n = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return ds(new Date(n.getFullYear(), n.getMonth(), Math.min(startDay, daysIn(n.getFullYear(), n.getMonth()))));
}

/* ---------- entries ---------- */
export function spend(doc, { amount, cat, note = '', date = ds(), at = Date.now() }) {
  const value = Math.round((Number(amount) || 0) * 100) / 100;
  if (value <= 0) return null;
  const entry = { id: uid('mv'), at, date, amount: value, cat, note: String(note || '').slice(0, 120) };
  doc.money.entries.unshift(entry);
  return entry;
}

export function removeEntry(doc, id) {
  const i = doc.money.entries.findIndex(e => e.id === id);
  if (i < 0) return null;
  return doc.money.entries.splice(i, 1)[0];
}

export function entriesBetween(doc, from, to) {
  return doc.money.entries.filter(e => e.date >= from && e.date <= to);
}
export function entriesOn(doc, date) {
  return doc.money.entries.filter(e => e.date === date);
}
export function spentOn(doc, date) {
  return entriesOn(doc, date).reduce((a, e) => a + e.amount, 0);
}
/**
 * The most recent date anything was logged *for* — not the last row
 * added.
 *
 * The two come apart the moment you log something for a past date,
 * which the form lets you do on purpose: that entry is prepended, so
 * reading entries[0] would report the back-dated day as the latest one
 * and the "you have not logged anything" nudge would go quiet for a
 * week. The list is small and a scan is exact.
 */
export function lastEntryDate(doc) {
  let best = null;
  for (const e of doc.money.entries) if (!best || e.date > best) best = e.date;
  return best;
}
/** Days since anything was logged. Large when nothing ever was. */
export function daysSinceLogged(doc, date = ds()) {
  const last = lastEntryDate(doc);
  return last ? Math.max(0, daysBetween(last, date)) : 999;
}

/* ---------- where you stand ---------- */
export function status(doc, date = ds()) {
  const m = doc.settings.money;
  const p = period(doc, date);
  const rows = entriesBetween(doc, p.from, p.to);
  const spent = rows.reduce((a, e) => a + e.amount, 0);
  const allowance = Math.max(0, m.allowance || 0);
  const left = allowance - spent;

  /* What an even spend would have you at by the end of today. Today
     counts as spent, which is the honest reading: the money for today
     is gone whether or not you have used it yet. */
  const pace = allowance * (p.dayIndex / p.days);

  return {
    ...p,
    allowance,
    spent,
    left,
    over: left < 0,
    pct: allowance ? clamp(spent / allowance, 0, 1) : 0,
    pace,
    ahead: Math.max(0, spent - pace),       // spending faster than even
    behind: Math.max(0, pace - spent),      // under pace, money in hand
    perDay: Math.max(0, left) / p.daysLeft,
    evenPerDay: allowance / p.days,
    today: spentOn(doc, date),
    count: rows.length,
  };
}

/* ---------- the pie ----------
   Totals per category over a range, biggest first, with the small tail
   folded into one slice. A pie with eleven slices answers nothing; the
   question it exists for is "where did most of it go", and that needs
   five or six shapes at most. */
export const MAX_SLICES = 6;

export function byCategory(doc, from, to, { maxSlices = MAX_SLICES } = {}) {
  const totals = new Map();
  for (const e of entriesBetween(doc, from, to)) {
    totals.set(e.cat, (totals.get(e.cat) || 0) + e.amount);
  }
  const all = doc.money.cats
    .map(c => ({ id: c.id, name: c.name, icon: c.icon, color: c.color, total: totals.get(c.id) || 0 }))
    .filter(c => c.total > 0)
    .sort((a, b) => b.total - a.total);

  const sum = all.reduce((a, c) => a + c.total, 0);
  let slices = all;
  if (all.length > maxSlices) {
    const head = all.slice(0, maxSlices - 1);
    const tail = all.slice(maxSlices - 1);
    slices = [...head, {
      id: '__rest',
      name: `${tail.length} more`,
      icon: 'more',
      color: 0,
      grey: true,
      total: tail.reduce((a, c) => a + c.total, 0),
      folded: tail,
    }];
  }
  return {
    total: sum,
    slices: slices.map(c => ({ ...c, pct: sum ? c.total / sum : 0 })),
    all,
  };
}

/**
 * Turn slices into arcs for one SVG circle each.
 *
 * Every arc is the same circle with a different dash pattern and
 * offset, which is what lets the whole pie animate as one object and
 * keeps the markup to one element per slice.
 */
export function arcs(slices, { r = 42, gap = 1.5 } = {}) {
  const C = 2 * Math.PI * r;
  let at = 0;
  return slices.map(s => {
    const len = Math.max(0, s.pct * C - (slices.length > 1 ? gap : 0));
    const arc = { ...s, dash: `${len.toFixed(2)} ${(C - len).toFixed(2)}`, offset: (-at).toFixed(2), C };
    at += s.pct * C;
    return arc;
  });
}

/* ---------- history ---------- */
/** Spend per day across the current period, oldest first. */
export function dailySpend(doc, date = ds()) {
  const p = period(doc, date);
  const byDate = new Map();
  for (const e of entriesBetween(doc, p.from, p.to)) {
    byDate.set(e.date, (byDate.get(e.date) || 0) + e.amount);
  }
  const out = [];
  for (let i = 0; i < p.days; i++) {
    const key = addDays(p.from, i);
    out.push({ date: key, amount: byDate.get(key) || 0, future: key > date });
  }
  return out;
}

/** The last `n` periods, newest first, for the trend list. */
export function recentPeriods(doc, n = 6, date = ds()) {
  const out = [];
  let cursor = date;
  for (let i = 0; i < n; i++) {
    const p = period(doc, cursor);
    const rows = entriesBetween(doc, p.from, p.to);
    const spent = rows.reduce((a, e) => a + e.amount, 0);
    out.push({ ...p, spent, count: rows.length, under: spent <= (doc.settings.money.allowance || 0) });
    cursor = addDays(p.from, -1);
    if (cursor < (doc.money.entries[doc.money.entries.length - 1]?.date || '0000')) break;
  }
  return out;
}

/** Whole periods that finished under the allowance. Used by a milestone. */
export function periodsUnder(doc, date = ds()) {
  return recentPeriods(doc, 24, date).filter((p, i) => i > 0 && p.count > 0 && p.under).length;
}

export { ds };
