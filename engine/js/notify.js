/* ============================================================
   notify.js — nudges that arrive, and sound like someone

   A static page has no server, so there is no push. What there is:

   1. A rule engine, wall-clock driven and self-correcting. It does not
      test for an exact minute. Every rule asks "is this true right now
      and have I said it recently", which means a nudge missed while the
      screen was off still lands the moment you pick the phone up, with
      the right wording for how late it now is.

   2. Service worker notifications, so they survive the tab losing
      focus, and carry buttons that do the thing without opening a
      screen and hunting for it.

   3. Periodic background sync where the browser has it.

   ------------------------------------------------------------
   Why it is a queue and not a list of alarms

   "Constantly" and "all at once" are different things, and the second
   one gets an app muted inside a week. So every rule that is currently
   true becomes a *candidate*, the candidates are ranked, and exactly one
   fires — after which nothing else fires for a gap you set. Open the app
   at nine at night having ignored it all day and you get the one thing
   that matters most, not six notifications in a stack.

   Your plan is the exception. A block you planned is a time, not a
   suggestion, so the nudge for it jumps the queue rather than arriving
   after the time has gone.

   ------------------------------------------------------------
   The voice

   Pushy, and dignified. Those are not in tension; what makes most
   streak apps undignified is not that they nudge often, it is what
   they say. So every line in here follows four rules:

     it is true            no invented urgency, no countdown to a loss
                           that is not real
     it is specific        "forty cards due, and four hours left",
                           not "don't lose your progress!"
     it names one action   and the action is the smallest one that
                           counts, because the small one is the one you
                           will actually do
     it never shames       a missed day is information, not a moral
                           failure, and an app that says otherwise gets
                           uninstalled in a fortnight

   There are several lines per situation and one is picked at random,
   never the same one twice running, because a nudge you can predict
   word for word stops being read at all.
   ============================================================ */

import { ds, toMin, nowMin, fmtTime, durShort, durFmt, plural } from './util.js';
import * as money from './money.js';
import * as plan from './plan.js';

let swReg = null;
export function setSW(reg) { swReg = reg; }

export function supported() { return 'Notification' in window; }
export function permission() { return supported() ? Notification.permission : 'unsupported'; }
export async function request() {
  if (!supported()) return 'unsupported';
  try { return await Notification.requestPermission(); }
  catch (e) { return 'denied'; }
}

/* ---------- quiet hours ---------- */
export function inQuiet(settings, minutes = nowMin()) {
  const n = settings.notif || {};
  if (!n.quietFrom || !n.quietTo) return false;
  const a = toMin(n.quietFrom), b = toMin(n.quietTo);
  if (a === b) return false;
  return a < b ? (minutes >= a && minutes < b) : (minutes >= a || minutes < b);
}

/* ---------- how hard to push ----------
   One dial rather than thirty switches. It moves the gap between any two
   nudges and how many times a single rule may repeat itself in a day. */
export const INTENSITY = {
  gentle: { gap: 75, repeats: 0, label: 'Gentle', hint: 'A handful a day, well spaced' },
  steady: { gap: 35, repeats: 1, label: 'Steady', hint: 'Something most parts of the day' },
  constant: { gap: 14, repeats: 2, label: 'Constant', hint: 'Every open thing, chased until it is shut' },
};
function dial(doc) {
  return INTENSITY[doc.settings.notif?.intensity] || INTENSITY.steady;
}

/* ---------- the voice ---------- */
const LINES = {
  cards: [
    f => `${f.due} due. Ten minutes clears most of it.`,
    f => `${f.due} waiting. One thumb, nothing to press.`,
    f => `${f.due} cards. They came back because you forgot them, which is the point.`,
    f => `${f.due} due. Start it and stop whenever you like.`,
  ],
  cardsPile: [
    f => `${f.due} have piled up. Twenty of them is a real dent and takes four minutes.`,
    f => `${f.due} due. Do not clear them all — do twenty and stop.`,
  ],
  focusIdle: [
    () => 'Nothing focused yet today. Set it to fifteen minutes and start badly.',
    f => `No session logged. ${f.goal} was the plan; a quarter of it still counts.`,
    () => 'Start the clock before you decide what to work on. The deciding is the part that eats the hour.',
  ],
  focusShort: [
    f => `${f.done} in so far, ${f.left} short of the day. One more round covers it.`,
    f => `${f.left} off the day's total. That is one short session.`,
  ],
  money: [
    f => `Nothing logged for ${f.days}. It takes longer to remember than to write down.`,
    f => `${f.left} left this ${f.period}, and ${f.days} unaccounted for.`,
    () => 'Two minutes now, or ten minutes of guessing on Sunday.',
  ],
  moneyOver: [
    f => `${f.over} past the allowance with ${f.days} to go. Worth knowing now rather than later.`,
    f => `Over by ${f.over}. ${f.days} until the next one lands.`,
  ],
  shutdown: [
    () => 'Screens off. Tomorrow’s first block is already planned.',
    () => 'Wind down. Tomorrow starts tonight, and it starts with sleep.',
    () => 'Done is done. Put the phone down, then sleep.',
  ],
};

/* The same line twice running reads as a machine, so the last one used
   is remembered per pool and never repeated immediately. */
const lastPick = new Map();
function say(pool, facts) {
  const list = LINES[pool];
  if (!list || !list.length) return '';
  let i = Math.floor(Math.random() * list.length);
  if (list.length > 1 && i === lastPick.get(pool)) i = (i + 1) % list.length;
  lastPick.set(pool, i);
  try { return list[i](facts || {}); } catch (e) { return list[0](facts || {}); }
}

/* ---------- firing ---------- */
export function show(title, body, opts = {}) {
  if (!supported() || Notification.permission !== 'granted') return false;
  const o = {
    body,
    tag: opts.tag || 'engine',
    renotify: true,
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-72.png',
    silent: !!opts.silent,
    requireInteraction: !!opts.sticky,
    data: { url: opts.url || './', ...(opts.data || {}) },
    vibrate: opts.vibrate || [90, 50, 90],
    actions: (opts.actions || []).slice(0, 2),
  };
  /* showNotification returns a promise, and it rejects for reasons that
     have nothing to do with this code: permission revoked in another tab,
     a platform that will not show actions, a worker that has been
     replaced. An unhandled rejection there would be an app that quietly
     stops nudging, so the rejection is caught and the plain constructor
     gets a turn. */
  try {
    if (swReg?.showNotification) {
      const p = swReg.showNotification(title, o);
      if (p?.catch) p.catch(() => bare(title, body, o));
      return true;
    }
    new Notification(title, o);
    return true;
  } catch (e) {
    return bare(title, body, o);
  }
}

function bare(title, body, o) {
  try { new Notification(title, { body, tag: o.tag, icon: o.icon }); return true; }
  catch (e) { return false; }
}

/* Buttons, because the whole point of a nudge is that the thing it asks
   for should be one tap away and not a screen away. */
const ACT = {
  start: { action: 'start', title: 'Start' },
  open: { action: 'open', title: 'Open' },
  later: { action: 'later', title: 'Later' },
  cards: { action: 'cards', title: 'Review' },
  log: { action: 'log', title: 'Log it' },
  /* Start the thing this nudge is about. It has no fixed route in the
     worker, so it falls through to the nudge's own url. */
  begin: { action: 'begin', title: 'Start' },
};

/* ---------- badge ---------- */
export function setBadge(n) {
  try {
    if (n > 0) navigator.setAppBadge?.(n);
    else navigator.clearAppBadge?.();
  } catch (e) { /* ignore */ }
}

/* ============================================================
   The rules

   Each one is a small object rather than a branch in a long function,
   which is what makes the queue possible: they can all be asked whether
   they are true without any of them firing.

     id      unique within a day
     at      'HH:MM' it first becomes worth saying, or null for any time
     window  minutes it stays worth saying after that
     every   minutes before it is worth saying again
     max     times a day, before the intensity dial adds to it
     prio    who wins when several are true at once
     make    (ctx) -> null | { title, body, ...opts }
   ============================================================ */
const RULES = [
  {
    id: 'cardsPile', prio: 80, at: '13:00', window: 420, every: 0, max: 1,
    on: c => c.n.cardsReminder,
    make(c) {
      if (c.due < 40) return null;
      return {
        title: `${c.due} cards due`,
        body: say('cardsPile', { due: c.due }),
        url: './#/cards', actions: [ACT.cards, ACT.later],
      };
    },
  },

  {
    id: 'cards', prio: 76, at: c => c.n.cardsAt || '21:00', window: 240, every: 90, max: 3,
    on: c => c.n.cardsReminder,
    make(c) {
      if (!c.due) return null;
      return {
        title: 'Cards',
        body: say(c.due > 40 ? 'cardsPile' : 'cards', { due: c.due }),
        url: './#/cards', actions: [ACT.cards, ACT.later],
      };
    },
  },

  {
    id: 'focusIdle', prio: 72, at: c => c.n.focusIdleAt || '17:00', window: 240, every: 90, max: 2,
    on: c => c.n.focusIdle !== false,
    make(c) {
      if (c.focusMin > 0) return null;
      if (c.doc.activeFocus && !c.doc.activeFocus.finished) return null;
      return {
        title: 'Still time',
        body: say('focusIdle', { goal: durFmt(c.goal || 60) }),
        url: './#/focus', actions: [ACT.start, ACT.later],
      };
    },
  },

  {
    id: 'focusShort', prio: 66, at: '20:00', window: 150, every: 0, max: 1,
    on: c => c.n.focusIdle !== false && c.goal > 0,
    make(c) {
      if (!c.focusMin || c.focusMin >= c.goal) return null;
      if (c.doc.activeFocus && !c.doc.activeFocus.finished) return null;
      return {
        title: 'Short of the day',
        body: say('focusShort', { done: durFmt(c.focusMin), left: durFmt(c.goal - c.focusMin) }),
        url: './#/focus', actions: [ACT.start, ACT.later],
      };
    },
  },

  {
    id: 'moneyOver', prio: 58, at: '18:00', window: 300, every: 0, max: 1,
    on: c => c.n.money !== false && c.doc.settings.money.on,
    make(c) {
      const st = money.status(c.doc, c.date);
      if (!st.allowance || !st.over) return null;
      return {
        title: 'Over the allowance',
        body: say('moneyOver', {
          over: money.fmt(c.doc, -st.left),
          days: plural(st.daysLeft, 'day'),
        }),
        url: './#/money', actions: [ACT.open, ACT.later],
      };
    },
  },

  {
    id: 'money', prio: 54, at: c => c.doc.settings.money.askAt || '21:00', window: 150, every: 0, max: 1,
    on: c => c.n.money !== false && c.doc.settings.money.on,
    make(c) {
      const gap = money.daysSinceLogged(c.doc, c.date);
      if (gap < 2 || gap > 90) return null;
      const st = money.status(c.doc, c.date);
      if (!st.allowance) return null;
      return {
        title: 'Pocket money',
        body: say('money', {
          days: plural(gap, 'day'),
          left: money.fmt(c.doc, Math.max(0, st.left)),
          period: c.doc.settings.money.period,
        }),
        url: './#/money/add', actions: [ACT.log, ACT.later],
      };
    },
  },

  {
    id: 'shutdown', prio: 36, at: c => c.n.shutdownAt || '22:30', window: 60, every: 0, max: 1,
    on: c => c.n.shutdown,
    make: () => ({ title: 'Wind down', body: say('shutdown'), url: './#/focus', actions: [ACT.open] }),
  },
];

/* ---------- the scheduler ----------
   Called by the app clock roughly every ten seconds, and immediately on
   every return to foreground. Idempotent: everything it remembers lives
   in doc.notified, which is pruned to today. */
export function tick(doc, save) {
  const n = doc.settings.notif || {};
  if (!n.enabled || permission() !== 'granted') return;

  const date = ds();
  const minutes = nowMin();
  const now = Date.now();
  let changed = false;

  // prune keys from other days so the object stays small
  for (const k of Object.keys(doc.notified)) {
    if (k[0] === '_') continue;                       // bookkeeping, not a nudge
    if (!k.startsWith(date)) { delete doc.notified[k]; changed = true; }
  }
  if (doc.notified._day !== date) {
    doc.notified._day = date;
    doc.notified._fired = {};
    changed = true;
  }

  const quiet = inQuiet(doc.settings, minutes);

  /* ---- the plan jumps the queue too ----
     A block you planned is a time, not a suggestion, and a nudge about
     it that waits behind a chatty afternoon arrives after the time has
     gone. Once per task per day, and never while a session is running. */
  if (!quiet && n.plan !== false) {
    const due = planNudge(doc, date, minutes);
    if (due && !doc.notified[due.key]) {
      show(due.title, due.body, { tag: 'plan', url: due.url, actions: [ACT.begin, ACT.later] });
      doc.notified[due.key] = now;
      doc.notified._last = now;
      changed = true;
    }
  }

  /* ---- everything else goes through the queue ---- */
  const d = dial(doc);
  const sinceLast = now - (doc.notified._last || 0);
  if (!quiet && sinceLast >= d.gap * 60_000) {
    const ctx = buildCtx(doc, date, minutes, n);
    let best = null;

    for (const rule of RULES) {
      try {
        const g = gate(rule, ctx, doc, date, minutes, now, d);
        if (!g.due) continue;

        const out = rule.make(ctx);
        if (!out) continue;

        if (!best || rule.prio > best.rule.prio) best = { rule, out, idKey: g.idKey };
      } catch (e) { /* one broken rule must not silence the rest */ }
    }

    if (best) {
      const { rule, out, idKey } = best;
      /* A nudge that stays on the lock screen earns that on its first
         showing. By the third it is furniture, so the repeats are
         ordinary notifications. */
      if ((doc.notified[idKey + '|n'] || 0) > 0) out.sticky = false;
      show(out.title, out.body, out);
      doc.notified[idKey] = now;
      doc.notified[idKey + '|n'] = (doc.notified[idKey + '|n'] || 0) + 1;
      doc.notified._last = now;
      doc.notified._fired = doc.notified._fired || {};
      doc.notified._fired[rule.id] = true;
      changed = true;
    }
  }

  if (changed) save?.();
}

function planNudge(doc, date, minutes) {
  if (doc.activeFocus && !doc.activeFocus.finished) return null;
  let cur;
  try { cur = plan.current(doc, { today: date, now: minutes }); } catch (e) { return null; }
  const a = cur.deepSoon;
  if (a && a.fromM - minutes >= -3) {
    return {
      key: `${date}|plan|${a.id}`,
      title: `${a.name} at ${fmtTime(a.fromM)}`,
      body: `${durFmt(a.toM - a.fromM)}. This is the one that never moves.${a.note ? ' ' + a.note : ''}`,
      url: './#/focus/deep',
    };
  }
  const b = cur.block;
  if (b) {
    return {
      key: `${date}|plan|${b.task.id}`,
      title: b.from > minutes ? `${fmtTime(b.from)} · ${b.task.title}` : b.task.title,
      body: `${durFmt(b.min)}${b.parts > 1 ? `, part ${b.part} of ${b.parts}` : ''}. You already decided this one, so start it badly rather than not at all.`,
      url: `./#/focus/task-${b.task.id}`,
    };
  }
  return null;
}

function buildCtx(doc, date, minutes, n) {
  return {
    doc, date, minutes, n,
    due: doc.cards.filter(c => !c.suspended && c.state !== 'new' && c.due <= Date.now()).length,
    focusMin: doc.sessions.filter(s => s.date === date).reduce((a, s) => a + (s.minutes || 0), 0),
    goal: doc.settings.focus.dailyGoalMin || 0,
    fired: doc.notified._fired || {},
  };
}

/* Ask once, at the first moment there is a gesture to ask on. A page
   that asks before you have seen anything gets refused, and a refusal is
   permanent. */
export async function ensurePermission(doc, save) {
  if (!supported()) return 'unsupported';
  const p = Notification.permission;
  if (p === 'granted') {
    if (!doc.settings.notif.enabled) { doc.settings.notif.enabled = true; save?.(); }
    return p;
  }
  if (p === 'denied' || doc.settings.notif.asked) return p;
  doc.settings.notif.asked = true;
  const res = await request();
  if (res === 'granted') doc.settings.notif.enabled = true;
  save?.();
  return res;
}

/** Ask the browser to wake the worker now and then. Chrome only, and
 *  only when installed, but free where it exists. */
export async function registerPeriodic(reg) {
  try {
    const status = await navigator.permissions?.query({ name: 'periodic-background-sync' });
    if (status && status.state !== 'granted') return false;
    await reg.periodicSync?.register('engine-nudge', { minInterval: 60 * 60 * 1000 });
    return true;
  } catch (e) { return false; }
}

/* Is this rule allowed to speak at this minute? Used by the scheduler and
   by the preview, so what the settings screen promises and what actually
   arrives cannot drift apart. */
function gate(rule, ctx, doc, date, minutes, now, d) {
  const idKey = `${date}|r|${rule.id}`;
  const out = { idKey, due: false, why: '', at: null };
  if (rule.on && !rule.on(ctx)) { out.why = 'switched off'; return out; }

  const max = rule.max + (rule.every ? d.repeats : 0);
  const count = doc.notified[idKey + '|n'] || 0;
  if (count >= max) { out.why = `said ${count} times already today`; return out; }

  const at = typeof rule.at === 'function' ? rule.at(ctx) : rule.at;
  out.at = at;
  if (at) {
    const t = toMin(at);
    if (minutes < t) { out.why = `not until ${fmtTime(at)}`; return out; }
    if (rule.window && minutes - t > rule.window) { out.why = 'the moment for it has passed'; return out; }
  }
  if (count > 0) {
    if (!rule.every) { out.why = 'already said today'; return out; }
    const wait = rule.every * 60_000 - (now - (doc.notified[idKey] || 0));
    if (wait > 0) { out.why = `again in ${durShort(Math.round(wait / 60000))}`; return out; }
  }
  out.due = true;
  return out;
}

/** Exactly what the scheduler will and will not say, for the settings
 *  screen. Anything listed as ready is a thing that fires on the next
 *  tick; anything listed as waiting says what it is waiting for. */
export function preview(doc) {
  const date = ds();
  const minutes = nowMin();
  const now = Date.now();
  const d = dial(doc);
  const ctx = buildCtx(doc, date, minutes, doc.settings.notif || {});
  const quiet = inQuiet(doc.settings, minutes);
  const gapLeft = Math.max(0, d.gap * 60_000 - (now - (doc.notified?._last || 0)));

  const out = [];

  for (const rule of RULES) {
    try {
      const g = gate(rule, ctx, doc, date, minutes, now, d);
      const made = rule.make(ctx);
      if (!made) continue;
      out.push({
        id: rule.id, prio: rule.prio, title: made.title, body: made.body,
        due: g.due, why: g.why, at: g.at,
      });
    } catch (e) { /* one broken rule must not hide the rest */ }
  }
  out.sort((a, b) => (b.due - a.due) || (b.prio - a.prio));
  return {
    rules: out,
    ready: out.filter(x => x.due).length,
    quiet,
    gapLeft: Math.round(gapLeft / 60000),
    gap: d.gap,
  };
}
