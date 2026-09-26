/* ============================================================
   session.js — the deep-work timer

   Everything is derived from timestamps, never from a counter that
   ticks down. A decremented counter drifts, and mobile suspends
   intervals the moment the screen locks, which is exactly when you
   are mid-session. Here, locking the phone for an hour and coming back
   produces the correct state because the state was never the timer.
   ============================================================ */

import { uid, ds } from './util.js';

/**
 * A session is rounds of work with breaks between them, and it ends on
 * work.
 *
 * It used to append a `long` break after the final round. Nothing ever
 * followed that break, so it was twenty minutes of the app telling you to
 * stand up after you had already finished — and, worse, it made the app
 * lie: the start screen says "45 min x 2, 10 min off, 1h 40m in total"
 * while the session it actually built ran two hours, which is also how
 * long it took "write three things down from memory" to arrive. A break
 * with no work after it is not a break, it is a wait.
 */
export function buildPhases(preset) {
  const { work = 45, brk = 10, rounds = 2 } = preset || {};
  const n = Math.max(1, Math.round(rounds) || 1);
  const out = [];
  for (let r = 1; r <= n; r++) {
    out.push({ type: 'work', sec: Math.max(60, Math.round(work * 60)), round: r });
    if (r < n && brk > 0) out.push({ type: 'break', sec: Math.round(brk * 60), round: r });
  }
  return out;
}

export function startFocus({ preset, task = '', subject = '', deckId = null, planTask = null }) {
  const phases = buildPhases(preset);
  return {
    id: uid('fs'),
    startedAt: Date.now(),
    date: ds(),
    preset: { ...preset },
    phases,
    task, subject, deckId,
    /* The planner task this session is working on, if it came from the plan. */
    planTask,
    idx: 0,
    phaseStart: Date.now(),
    paused: false,
    pausedAt: 0,
    pausedTotal: 0,
    distractions: 0,
    workDoneSec: 0,
    finished: false,
  };
}

/** Seconds elapsed inside the current phase. */
export function phaseElapsed(s, now = Date.now()) {
  if (!s) return 0;
  const paused = s.paused ? (now - s.pausedAt) : 0;
  return Math.max(0, (now - s.phaseStart - s.pausedTotal - paused) / 1000);
}
export function phaseLeft(s, now = Date.now()) {
  if (!s) return 0;
  const p = s.phases[s.idx];
  if (!p) return 0;
  return Math.max(0, p.sec - phaseElapsed(s, now));
}
export function phaseOf(s) {
  return s ? s.phases[s.idx] : null;
}
export function totalSec(s) {
  return s ? s.phases.reduce((a, p) => a + p.sec, 0) : 0;
}
export function elapsedTotalSec(s, now = Date.now()) {
  if (!s) return 0;
  let before = 0;
  for (let i = 0; i < s.idx; i++) before += s.phases[i].sec;
  return before + phaseElapsed(s, now);
}

/**
 * Move the session forward to wherever the wall clock says it should be.
 * Returns a list of phase transitions that happened, so the caller can
 * make noise once per transition rather than once per tick.
 */
export function advance(s, now = Date.now()) {
  const events = [];
  if (!s || s.finished || s.paused) return events;
  let guard = 0;
  while (guard++ < 64) {
    const p = s.phases[s.idx];
    if (!p) { s.finished = true; events.push({ type: 'end' }); break; }
    const el = phaseElapsed(s, now);
    if (el < p.sec) break;
    if (p.type === 'work') s.workDoneSec += p.sec;
    const carry = (el - p.sec) * 1000;
    s.idx++;
    const nxt = s.phases[s.idx];
    if (!nxt) { s.finished = true; events.push({ type: 'end', from: p.type }); break; }
    s.phaseStart = now - carry;
    s.pausedTotal = 0;
    events.push({ type: 'phase', from: p.type, to: nxt.type, round: nxt.round });
  }
  return events;
}

export function pauseFocus(s, now = Date.now()) {
  if (!s || s.paused || s.finished) return;
  s.paused = true; s.pausedAt = now;
}
export function resumeFocus(s, now = Date.now()) {
  if (!s || !s.paused) return;
  s.pausedTotal += now - s.pausedAt;
  s.paused = false; s.pausedAt = 0;
}
export function skipPhase(s, now = Date.now()) {
  if (!s || s.finished) return null;
  const p = s.phases[s.idx];
  if (!p) return null;
  if (p.type === 'work') s.workDoneSec += Math.round(phaseElapsed(s, now));
  s.idx++;
  if (!s.phases[s.idx]) { s.finished = true; return { type: 'end' }; }
  s.phaseStart = now;
  s.pausedTotal = 0;
  s.paused = false;
  return { type: 'phase', from: p.type, to: s.phases[s.idx].type };
}
export function extendPhase(s, minutes) {
  if (!s) return;
  const p = s.phases[s.idx];
  if (p) p.sec += minutes * 60;
}

/** Convert a live session into the permanent record. */
export function closeFocus(s, { rating = null, note = '', three = '' } = {}, now = Date.now()) {
  const p = s.phases[s.idx];
  let workSec = s.workDoneSec;
  if (p && p.type === 'work' && !s.finished) workSec += Math.round(phaseElapsed(s, now));
  const minutes = Math.round(workSec / 60);
  return {
    id: s.id,
    date: s.date,
    startedAt: s.startedAt,
    endedAt: now,
    minutes,
    plannedMinutes: Math.round(s.phases.filter(x => x.type === 'work').reduce((a, x) => a + x.sec, 0) / 60),
    /* The length of ONE work phase, not the total. Depth is about how
       unbroken the sitting was, so this is the number that matters and
       it has to be recorded rather than reconstructed later. */
    workMin: Math.max(1, Math.round((s.preset?.work) || (s.phases.find(x => x.type === 'work')?.sec || 0) / 60)),
    subject: s.subject || '',
    task: s.task || '',
    planTask: s.planTask || null,
    rounds: s.phases.filter(x => x.type === 'work').length,
    completedRounds: s.phases.slice(0, s.idx).filter(x => x.type === 'work').length + (p && p.type === 'work' && s.finished ? 1 : 0),
    distractions: s.distractions || 0,
    rating,
    note,
    three,
  };
}

export function phaseName(type) {
  return type === 'work' ? 'Focus' : 'Break';
}
