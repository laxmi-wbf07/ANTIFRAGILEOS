/* ============================================================
   plan.js — the day, planned around what does not move

   The problem this solves is not a missing list. It is that a decision
   made at breakfast never becomes a time, and a plan that is a list of
   times is wrong by eleven and abandoned by two. So:

     anchors    the handful of things that do not move — class, the
                deep work block, lights out. Entered once.

     tasks      entered in ten seconds: two yes/no answers (urgent?
                important?) and a length. Nothing else is asked.

     the plan   derived, never stored. Every time it is looked at it is
                rebuilt from now onwards, so a lost hour does not break
                it — the rest of the day simply re-flows around it. There
                is no "reschedule" button because there is nothing to
                reschedule.

   ------------------------------------------------------------
   Where a task goes (the Eisenhower part)

     Q1  urgent + important      the earliest slot that fits
     Q2  important, not urgent   fresh hours, spread over the week
     Q3  urgent, not important   the evening, batched
     Q4  neither                 nowhere — parked for a week, then dropped

   A deadline within a day makes a task urgent by itself. Urgency you
   have to remember to update is urgency that goes stale.

   ------------------------------------------------------------
   Why it will not fill the day (the fatigue part)

   Free time is not capacity. After class, training and ninety minutes
   of deep work, an evening that is technically empty is not an evening
   that can take another hour of hard thinking. So each day has two
   budgets, and the plan stops when either runs out instead of cramming:

     hard work    Q1/Q2 tasks of half an hour or more. Only before the
                  light-only hour, and only up to the day's limit.
     light work   everything else, capped below the time that is free,
                  so the slack absorbs the day going wrong.

   What does not fit is said out loud — "won't fit before its deadline",
   "moved three times" — and those are the moments you are asked to
   decide. Everywhere else the deciding has already been done.
   ============================================================ */

import { uid, ds, addDays, dowOf, toMin, nowMin, daysBetween, clamp } from './util.js';

/* ---------- vocabulary ---------- */
export const KIND = {
  fixed:     { label: 'Fixed',       icon: 'lock',   say: 'Nothing is planned over it' },
  deep:      { label: 'Deep work',   icon: 'focus',  say: 'Never moves' },
  train:     { label: 'Training',    icon: 'bolt',   say: 'Can shrink, never goes' },
  buffer:    { label: 'Buffer',      icon: 'clock',  say: 'Breathing room between things' },
  protected: { label: 'Protected',   icon: 'shield', say: 'Nothing is ever planned here' },
};

export const QUAD = {
  1: { tag: 'Q1', name: 'Do first', say: 'Urgent and important', where: 'Goes into the earliest slot that fits.' },
  2: { tag: 'Q2', name: 'Schedule', say: 'Important, not urgent', where: 'Goes into your fresh hours, spread over the week.' },
  3: { tag: 'Q3', name: 'Batch', say: 'Urgent, not important', where: 'Batched into the evening. Could it take five minutes, or someone else?' },
  4: { tag: 'Q4', name: 'Park', say: 'Neither', where: 'Not planned. Parked for a week, then dropped if untouched.' },
};

/* The first quarter of an hour after waking is not for anything. */
const WAKE_BUFFER = 15;
/* A gap shorter than this is not a slot, it is a pause. */
const MIN_SLOT = 15;
/* Tasks up to this long are never split: two halves of a half-hour job
   are two things to start instead of one. */
const WHOLE_UP_TO = 45;
const MIN_CHUNK = 30;
const MAX_HEAVY_CHUNK = 90;
const MAX_LIGHT_CHUNK = 60;
/* Half an hour of important work is hard work. Less is an errand. */
const HEAVY_FROM = 30;
const HORIZON = 7;
const PARK_DAYS = 7;

const WEEKDAYS = [1, 2, 3, 4, 5];
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

/* ---------- seed ----------
   The one-page plan, as anchors. Every one of them is editable; these
   are only where it starts. */
export function seedAnchors() {
  const a = (id, name, from, to, days, kind, note = '') => ({ id, name, from, to, days: days.slice(), kind, note });
  return [
    a('an_ready', 'Get ready', '08:10', '09:00', WEEKDAYS, 'fixed'),
    a('an_class', 'Class', '09:00', '16:15', WEEKDAYS, 'fixed', 'One 2-minute note after every lecture.'),
    a('an_train', 'Train', '16:25', '17:05', WEEKDAYS, 'train', 'Short on time: 2 rounds of moves 1–4, then plank.'),
    a('an_snack', 'Snack', '17:05', '17:20', WEEKDAYS, 'fixed'),
    a('an_deep', 'Deep work', '17:20', '18:50', WEEKDAYS, 'deep', 'Yesterday from a blank page, then today’s lectures.'),
    a('an_decomp', 'Decompress', '18:50', '19:10', WEEKDAYS, 'buffer'),
    /* Saturday morning belongs to training and the test. The gaps around
       them are for getting there, not for squeezing a task into. */
    a('an_sat_warm', 'Get going', '07:45', '08:30', [6], 'buffer'),
    a('an_sat_train', 'Long training', '08:30', '09:30', [6], 'train'),
    a('an_sat_shower', 'Shower, eat', '09:30', '10:00', [6], 'fixed'),
    a('an_sat_test', 'Weekly test', '10:00', '12:00', [6], 'deep', 'Twenty titles from memory, then fix only the failed ones.'),
    a('an_sat_break', 'Break', '12:00', '13:00', [6], 'buffer'),
    a('an_lunch', 'Lunch', '13:00', '13:30', [0, 6], 'fixed'),
    a('an_dinner', 'Dinner', '20:00', '20:30', EVERY_DAY, 'fixed'),
    a('an_wind', 'Wind down', '22:00', '23:00', EVERY_DAY, 'protected'),
  ];
}

export function seedSettings() {
  return {
    pane: 'plan',
    wakeWeekday: '06:00',
    wakeWeekend: '07:30',
    bedAt: '23:00',
    lightFrom: '18:30',
    heavyWeekday: 60,
    heavyWeekend: 120,
    lightMax: 90,
    restDays: [0],
    anchors: seedAnchors(),
  };
}

export function seedDoc() {
  return { tasks: [], days: {}, lastDay: null };
}

/* ---------- normalisation ---------- */
const HHMM = /^\d{2}:\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const time = (v, fb) => (HHMM.test(String(v)) ? String(v) : fb);
const date = v => (DATE.test(String(v || '')) ? String(v) : null);
const int = (v, lo, hi, fb) => {
  const n = Math.round(Number(v));
  return isFinite(n) ? clamp(n, lo, hi) : fb;
};

export function normalize(doc) {
  const base = seedSettings();
  const s = doc.settings.plan;
  s.pane = s.pane === 'timer' ? 'timer' : 'plan';
  s.wakeWeekday = time(s.wakeWeekday, base.wakeWeekday);
  s.wakeWeekend = time(s.wakeWeekend, base.wakeWeekend);
  s.bedAt = time(s.bedAt, base.bedAt);
  s.lightFrom = time(s.lightFrom, base.lightFrom);
  s.heavyWeekday = int(s.heavyWeekday, 0, 480, base.heavyWeekday);
  s.heavyWeekend = int(s.heavyWeekend, 0, 480, base.heavyWeekend);
  s.lightMax = int(s.lightMax, 0, 480, base.lightMax);
  s.restDays = Array.isArray(s.restDays) ? [...new Set(s.restDays.map(Number).filter(d => d >= 0 && d <= 6))] : base.restDays;
  if (!Array.isArray(s.anchors)) s.anchors = base.anchors;
  s.anchors = s.anchors
    .filter(a => a && typeof a === 'object')
    .map(a => ({
      id: a.id || uid('an'),
      name: String(a.name || 'Anchor').slice(0, 60),
      from: time(a.from, '09:00'),
      to: time(a.to, '10:00'),
      days: Array.isArray(a.days) ? [...new Set(a.days.map(Number).filter(d => d >= 0 && d <= 6))] : WEEKDAYS.slice(),
      kind: KIND[a.kind] ? a.kind : 'fixed',
      note: typeof a.note === 'string' ? a.note.slice(0, 200) : '',
    }));

  const p = doc.plan = (doc.plan && typeof doc.plan === 'object') ? doc.plan : seedDoc();
  if (!Array.isArray(p.tasks)) p.tasks = [];
  if (!p.days || typeof p.days !== 'object') p.days = {};
  p.lastDay = date(p.lastDay);
  p.tasks = p.tasks.filter(t => t && typeof t === 'object').map(t => ({
    id: t.id || uid('tk'),
    title: String(t.title || 'Task').slice(0, 120),
    urgent: !!t.urgent,
    important: !!t.important,
    min: int(t.min, 5, 960, 30),
    doneMin: int(t.doneMin, 0, 9999, 0),
    deadline: date(t.deadline),
    created: date(t.created) || ds(),
    createdAt: Number(t.createdAt) || 0,
    after: date(t.after),
    status: ['open', 'done', 'dropped'].includes(t.status) ? t.status : 'open',
    doneAt: Number(t.doneAt) || 0,
    doneOn: date(t.doneOn),
    carried: int(t.carried, 0, 99, 0),
    on: date(t.on),
    useDeep: date(t.useDeep),
    stretch: date(t.stretch),
    pinned: date(t.pinned),
    doneAdd: int(t.doneAdd, 0, 9999, 0),
  }));
  for (const k of Object.keys(p.days)) {
    const d = p.days[k];
    if (!DATE.test(k) || !d || typeof d !== 'object') { delete p.days[k]; continue; }
    d.half = !!d.half;
    d.busy = Array.isArray(d.busy)
      ? d.busy.filter(b => b && HHMM.test(b.from) && HHMM.test(b.to) && toMin(b.to) > toMin(b.from))
        .map(b => ({ id: b.id || uid('bz'), from: b.from, to: b.to, label: String(b.label || '').slice(0, 60) }))
      : [];
    d.missed = Array.isArray(d.missed) ? d.missed.filter(x => typeof x === 'string') : [];
    const sp = d.spent && typeof d.spent === 'object' ? d.spent : {};
    d.spent = { heavy: int(sp.heavy, 0, 1440, 0), light: int(sp.light, 0, 1440, 0) };
  }
}

/* ---------- the day turning over ----------
   Runs at boot and at midnight. A task that was on yesterday's plan and
   is still open has been carried once more; three of those and it stops
   being quietly re-planned and asks you to decide. */
export function rollover(doc, today = ds()) {
  const p = doc.plan;
  if (p.lastDay === today) return false;
  for (const t of p.tasks) {
    if (t.status !== 'open') continue;
    if (t.on && t.on < today) { t.carried++; t.on = null; }
    for (const k of ['useDeep', 'stretch', 'pinned']) if (t[k] && t[k] < today) t[k] = null;
    if (quadrant(t, today) === 4 && daysBetween(t.created, today) >= PARK_DAYS) {
      t.status = 'dropped';
      t.doneOn = today;
    }
  }
  /* Finished and dropped tasks are kept for a month, then let go. */
  p.tasks = p.tasks.filter(t => t.status === 'open' || daysBetween(t.doneOn || t.created, today) <= 30);
  for (const k of Object.keys(p.days)) if (daysBetween(k, today) > 14) delete p.days[k];
  p.lastDay = today;
  return true;
}

/* ---------- a task ---------- */
export function newTask({ title, urgent, important, min, deadline }) {
  return {
    id: uid('tk'),
    title: String(title || '').trim().slice(0, 120) || 'Task',
    urgent: !!urgent,
    important: !!important,
    min: int(min, 5, 960, 30),
    doneMin: 0,
    deadline: date(deadline),
    created: ds(),
    createdAt: Date.now(),
    after: null,
    status: 'open',
    doneAt: 0,
    doneOn: null,
    carried: 0,
    on: null,
    useDeep: null,
    stretch: null,
    pinned: null,
    doneAdd: 0,
  };
}

export const task = (doc, id) => doc.plan.tasks.find(t => t.id === id) || null;
export const remaining = t => Math.max(0, t.min - t.doneMin);

/** Is it urgent only because its deadline is close? */
export function autoUrgent(t, today = ds()) {
  return !t.urgent && !!t.deadline && daysBetween(today, t.deadline) <= 1;
}

export function quadrant(t, today = ds()) {
  const urgent = t.urgent || autoUrgent(t, today);
  return urgent ? (t.important ? 1 : 3) : (t.important ? 2 : 4);
}

export function quadOf(urgent, important) {
  return urgent ? (important ? 1 : 3) : (important ? 2 : 4);
}

const isHeavy = (t, q) => (q === 1 || q === 2) && t.min >= HEAVY_FROM;

/* What today has already taken out of the day's budgets. Work done this
   morning is work the evening does not get to have again. */
function spend(doc, t, minutes) {
  if (!minutes) return;
  const k = isHeavy(t, quadrant(t)) ? 'heavy' : 'light';
  const sp = dayOf(doc, ds()).spent;
  sp[k] = clamp(sp[k] + minutes, 0, 1440);
}

/** Ticked off. Whatever was left on it is counted as done today. */
export function markDone(doc, t, done = true) {
  if (done) {
    const add = remaining(t);
    t.doneAdd = add;
    t.doneMin += add;
    spend(doc, t, add);
  } else {
    if (t.doneOn === ds()) spend(doc, t, -t.doneAdd);
    t.doneMin = Math.max(0, t.doneMin - t.doneAdd);
    t.doneAdd = 0;
  }
  t.status = done ? 'done' : 'open';
  t.doneAt = done ? Date.now() : 0;
  t.doneOn = done ? ds() : null;
}

/** A focus session on a task counts towards it. */
export function logWork(doc, id, minutes, finished) {
  const t = task(doc, id);
  if (!t) return null;
  const m = Math.max(0, Math.round(minutes) || 0);
  t.doneMin = Math.min(9999, t.doneMin + m);
  spend(doc, t, m);
  if (finished || t.doneMin >= t.min) markDone(doc, t, true);
  return t;
}

/* ---------- a day ---------- */
export function dayOf(doc, key) {
  const p = doc.plan;
  if (!p.days[key]) p.days[key] = { half: false, busy: [], missed: [], spent: { heavy: 0, light: 0 } };
  return p.days[key];
}
const peekDay = (doc, key) => doc.plan.days[key] || { half: false, busy: [], missed: [], spent: { heavy: 0, light: 0 } };

const isWeekend = dow => dow === 0 || dow === 6;

export function wakeOn(doc, key) {
  const s = doc.settings.plan;
  return toMin(isWeekend(dowOf(key)) ? s.wakeWeekend : s.wakeWeekday);
}

export function anchorsOn(doc, key) {
  const dow = dowOf(key);
  return doc.settings.plan.anchors
    .filter(a => a.days.includes(dow))
    .map(a => ({ ...a, fromM: toMin(a.from), toM: toMin(a.to) }))
    .filter(a => a.toM > a.fromM)
    .sort((a, b) => a.fromM - b.fromM);
}

/** Take the intervals in `cut` out of [from, to]. */
function subtract(from, to, cut) {
  let out = [{ from, to }];
  for (const c of cut) {
    const next = [];
    for (const r of out) {
      if (c.to <= r.from || c.from >= r.to) { next.push(r); continue; }
      if (c.from > r.from) next.push({ from: r.from, to: c.from });
      if (c.to < r.to) next.push({ from: c.to, to: r.to });
    }
    out = next;
  }
  return out;
}

const ceil5 = m => Math.ceil(m / 5) * 5;

/**
 * Everything the planner needs to know about one day: when it starts and
 * ends, what does not move, what is free, and how much it can take.
 * `now` clips the free time for today, so the plan always runs forwards
 * from the present rather than from a morning that has already gone.
 */
export function frame(doc, key, now = null) {
  const s = doc.settings.plan;
  const dow = dowOf(key);
  const wake = wakeOn(doc, key);
  const start = wake + WAKE_BUFFER;
  let end = toMin(s.bedAt);
  if (end <= start) end = 1439;
  const day = peekDay(doc, key);
  const yesterday = peekDay(doc, addDays(key, -1));
  const anchors = anchorsOn(doc, key);
  const busy = day.busy.map(b => ({ ...b, fromM: toMin(b.from), toM: toMin(b.to) }));

  const rest = s.restDays.includes(dow);
  const half = !!day.half;
  /* Never miss twice: the day after a missed anchor carries less, so the
     anchor itself is the thing there is energy for. */
  const strict = yesterday.missed.length > 0;

  let heavy = isWeekend(dow) ? s.heavyWeekend : s.heavyWeekday;
  let light = s.lightMax;
  if (half) { heavy = Math.round(heavy / 2); light = Math.round(light / 2); }
  if (strict) heavy = Math.round(heavy / 2);

  const cursor = now == null ? start : Math.max(start, ceil5(now));
  const lightFrom = toMin(s.lightFrom);
  const blocked = [
    ...anchors.map(a => ({ from: a.fromM, to: a.toM })),
    ...busy.map(b => ({ from: b.fromM, to: b.toM })),
  ];

  const slots = [];
  for (const r of subtract(cursor, end, blocked)) {
    /* A free stretch that crosses the light-only hour is two slots: the
       part before it can take hard work, the part after cannot. */
    const parts = r.from < lightFrom && r.to > lightFrom
      ? [{ from: r.from, to: lightFrom }, { from: lightFrom, to: r.to }]
      : [r];
    for (const x of parts) {
      if (x.to - x.from < MIN_SLOT) continue;
      slots.push({ from: x.from, to: x.to, at: x.from, light: x.from >= lightFrom });
    }
  }

  const deepA = anchors.find(a => a.kind === 'deep' && a.toM > cursor);
  const deep = deepA ? { from: Math.max(deepA.fromM, cursor), to: deepA.toM, at: Math.max(deepA.fromM, cursor), deep: true, light: false } : null;

  return {
    date: key, dow, wake, start, end, cursor, anchors, busy, slots, deep,
    rest, half, strict, missedYesterday: yesterday.missed,
    caps: { heavy, light },
    /* Today starts with whatever has already been done today. */
    used: now == null ? { heavy: 0, light: 0 } : { heavy: day.spent.heavy, light: day.spent.light },
    blocks: [],
  };
}

/* ---------- the planner ---------- */
function orderOf(tasks, today) {
  const key = t => {
    const q = quadrant(t, today);
    return [
      t.pinned === today ? 0 : 1,
      q === 1 ? 0 : q === 2 ? 1 : 2,
      t.deadline || '9999-12-31',
      -t.carried,
      t.createdAt || 0,
    ];
  };
  return tasks.slice().sort((a, b) => {
    const x = key(a), y = key(b);
    for (let i = 0; i < x.length; i++) {
      if (x[i] < y[i]) return -1;
      if (x[i] > y[i]) return 1;
    }
    return 0;
  });
}

/** May this task go on a rest day at all? Only if waiting would miss the deadline. */
const forcedOnRest = (t, q, key) => q === 1 && !!t.deadline && daysBetween(key, t.deadline) <= 1;

function slotsFor(f, t, q, heavy) {
  const stretch = t.stretch === f.date;
  let list = f.slots.filter(s => stretch || !(heavy && s.light));
  if (t.useDeep === f.date && f.deep) list = [f.deep, ...list];
  /* Light work that is not urgent-and-important would rather be in the
     evening, so the fresh hours stay free for the work that needs them. */
  if (!heavy && q !== 1) list = [...list.filter(s => s.light), ...list.filter(s => !s.light)];
  return list;
}

/**
 * Lay every open task into the next seven days.
 *
 * Nothing here is stored. It is cheap enough to run on every render and
 * every notification tick, and running it again is what re-planning is.
 */
export function schedule(doc, { today = ds(), now = nowMin(), horizon = HORIZON } = {}) {
  const frames = [];
  for (let i = 0; i < horizon; i++) {
    const key = addDays(today, i);
    frames.push(frame(doc, key, i === 0 ? now : null));
  }

  const active = doc.activeFocus && !doc.activeFocus.finished ? doc.activeFocus.planTask : null;
  const open = doc.plan.tasks.filter(t => t.status === 'open');
  const byTask = new Map();
  const issues = [];
  const parked = [];

  for (const t of orderOf(open, today)) {
    const q = quadrant(t, today);
    if (q === 4) { parked.push({ task: t, daysLeft: Math.max(0, PARK_DAYS - daysBetween(t.created, today)) }); continue; }
    if (t.id === active) continue;

    const heavy = isHeavy(t, q);
    let left = remaining(t);
    if (left <= 0) continue;
    const placed = [];

    for (const f of frames) {
      if (left <= 0) break;
      if (t.after && f.date < t.after) continue;
      if (f.rest && !forcedOnRest(t, q, f.date)) continue;
      if (f.half && q !== 1) continue;

      for (const sl of slotsFor(f, t, q, heavy)) {
        if (left <= 0) break;
        const free = sl.deep || t.stretch === f.date
          ? Infinity
          : (heavy ? f.caps.heavy - f.used.heavy : f.caps.light - f.used.light);
        const need = left <= WHOLE_UP_TO ? left : MIN_CHUNK;
        let take = Math.min(left, sl.to - sl.at, free, heavy ? MAX_HEAVY_CHUNK : MAX_LIGHT_CHUNK);
        if (take < need) continue;
        /* Never leave a crumb behind: a ten-minute tail is a task nobody starts. */
        if (left - take > 0 && left - take < MIN_SLOT && take - MIN_SLOT >= need) take -= MIN_SLOT;

        const b = { task: t, q, heavy, date: f.date, from: sl.at, to: sl.at + take, min: take, deep: !!sl.deep };
        f.blocks.push(b);
        placed.push(b);
        sl.at += take + (heavy && take >= 45 ? 10 : 5);
        if (!sl.deep) f.used[heavy ? 'heavy' : 'light'] += take;
        left -= take;
      }
    }

    placed.forEach((b, i) => { b.part = i + 1; b.parts = placed.length + (left > 0 ? 1 : 0); });
    byTask.set(t.id, placed);

    const last = placed[placed.length - 1];
    if (t.deadline && ((last && last.date > t.deadline) || (left > 0 && daysBetween(today, t.deadline) < horizon))) {
      issues.push({ kind: 'late', task: t, q, left });
    } else if (left > 0) {
      issues.push({ kind: 'nofit', task: t, q, left });
    }
  }

  for (const f of frames) f.blocks.sort((a, b) => a.from - b.from);
  const decide = open.filter(t => t.carried >= 3 && quadrant(t, today) !== 4 && t.pinned !== today);

  return { today, now, frames, byTask, issues, parked, decide, active };
}

/** Remember which tasks are on today's plan, so tomorrow can tell what was carried. */
export function mark(doc, sch) {
  let changed = false;
  for (const b of sch.frames[0]?.blocks || []) {
    if (b.task.on !== sch.today) { b.task.on = sch.today; changed = true; }
  }
  return changed;
}

/* ---------- what is happening now ----------
   The block that is on now, or about to be, and the deep work anchor if
   it is about to start. Shared by the "what now" card, the nudges and
   the timeline so they cannot disagree. */
export function current(doc, { today = ds(), now = nowMin(), sch = null } = {}) {
  const s = sch || schedule(doc, { today, now });
  const f = s.frames[0];
  const block = f.blocks.find(b => b.from - now <= 5 && b.to > now) || null;
  const deepSoon = f.anchors.find(a => a.kind === 'deep' && a.fromM - now <= 5 && a.toM > now && !deepDone(doc, a, today)) || null;
  return { sch: s, frame: f, block, deepSoon };
}

/* A deep block you have already sat is done, even if its time has not run
   out. Any session of twenty minutes or more started inside it counts. */
export function deepDone(doc, a, today = ds()) {
  const inside = at => {
    const d = new Date(at);
    const m = d.getHours() * 60 + d.getMinutes();
    return m >= a.fromM - 15 && m < a.toM;
  };
  if (doc.activeFocus && doc.activeFocus.date === today && inside(doc.activeFocus.startedAt)) return true;
  return doc.sessions.some(x => x.date === today && x.minutes >= 20 && inside(x.startedAt));
}

/** Minutes of the deep anchor still ahead, if you are in it or it is about to start. */
export function deepMinutesLeft(a, now = nowMin()) {
  if (!a) return 0;
  return Math.max(0, a.toM - Math.max(a.fromM, Math.floor(now)));
}
