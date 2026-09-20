/* ============================================================
   ui.js — sheet, toast, confirm, feedback
   ============================================================ */

import { $, $$, html, str, raw, esc, icon } from './util.js';

let prefs = { sound: true, haptics: true, confetti: true };
export function setFeedbackPrefs(p) { Object.assign(prefs, p); }

/* ---------- haptics ---------- */
export function buzz(pattern = 12) {
  if (!prefs.haptics) return;
  try { navigator.vibrate?.(pattern); } catch (e) { /* ignore */ }
}

/* ---------- sound ----------
   Short, soft, tuned. Nothing here should ever be startling. */
let AC = null;
function ctx() {
  if (!prefs.sound) return null;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === 'suspended') AC.resume();
    return AC;
  } catch (e) { return null; }
}
function tone(freq, when, dur, gain = 0.16, type = 'sine') {
  const ac = ctx(); if (!ac) return;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, when);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(gain, when + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  o.connect(g).connect(ac.destination);
  o.start(when); o.stop(when + dur + 0.02);
}
export const sfx = {
  tick() { const ac = ctx(); if (ac) tone(1180, ac.currentTime, 0.055, 0.07); },
  ok() { const ac = ctx(); if (!ac) return; const t = ac.currentTime; tone(660, t, 0.1, 0.13); tone(990, t + 0.06, 0.14, 0.11); },
  undo() { const ac = ctx(); if (!ac) return; const t = ac.currentTime; tone(520, t, 0.09, 0.1); tone(390, t + 0.05, 0.13, 0.09); },
  miss() { const ac = ctx(); if (!ac) return; const t = ac.currentTime; tone(320, t, 0.16, 0.1, 'triangle'); },
  start() { const ac = ctx(); if (!ac) return; const t = ac.currentTime; tone(523, t, 0.1, 0.12); tone(784, t + 0.08, 0.16, 0.12); },
  done() { const ac = ctx(); if (!ac) return; const t = ac.currentTime; [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.085, 0.22, 0.13)); },
  alarm() { const ac = ctx(); if (!ac) return; const t = ac.currentTime; for (let i = 0; i < 3; i++) { tone(880, t + i * 0.28, 0.16, 0.2); tone(1320, t + i * 0.28 + 0.07, 0.14, 0.14); } },
  rest() { const ac = ctx(); if (!ac) return; const t = ac.currentTime; tone(784, t, 0.14, 0.12); tone(587, t + 0.1, 0.2, 0.11); },
  count() { const ac = ctx(); if (ac) tone(740, ac.currentTime, 0.09, 0.13); },
  go() { const ac = ctx(); if (!ac) return; const t = ac.currentTime; tone(660, t, 0.1, 0.16); tone(1320, t + 0.07, 0.18, 0.14); },
};
/** Browsers need a user gesture before audio works. Call once on first tap. */
export function unlockAudio() { const ac = ctx(); if (ac && ac.state === 'suspended') ac.resume(); }

/* ---------- keeping the screen on ----------
   A running focus session is the one time the screen going dark is
   actively unhelpful: you are across the room doing burpees, not holding
   the phone. The lock is dropped the moment the session ends, and
   re-taken after the tab comes back, because the browser drops it on hide. */
let wakeLock = null;
let wantAwake = false;

async function takeLock() {
  if (!wantAwake || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
    wakeLock?.addEventListener?.('release', () => { wakeLock = null; });
  } catch (e) { wakeLock = null; }
}

export function keepAwake(on) {
  wantAwake = !!on;
  if (on) takeLock();
  else { try { wakeLock?.release(); } catch (e) { /* ignore */ } wakeLock = null; }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) takeLock();
});

/* ---------- particles ---------- */
export function sparkle(x, y, count = 10, color = null) {
  if (!prefs.confetti) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    p.className = 'spark';
    const a = (Math.PI * 2 * i) / count + Math.random() * 0.6;
    const d = 32 + Math.random() * 58;
    p.style.left = x + 'px';
    p.style.top = y + 'px';
    if (color) p.style.background = color;
    p.style.transition = 'transform 620ms cubic-bezier(.2,.7,.3,1), opacity 620ms ease-out';
    document.body.appendChild(p);
    requestAnimationFrame(() => {
      p.style.transform = `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d + 24}px) scale(0)`;
      p.style.opacity = '0';
    });
    setTimeout(() => p.remove(), 700);
  }
}
export function sparkleFrom(node, count = 10, color = null) {
  if (!node) return;
  const r = node.getBoundingClientRect();
  sparkle(r.left + r.width / 2, r.top + r.height / 2, count, color);
}

/* ---------- the scroll lock ----------
   Four different places used to write `documentElement.style.overflow`
   directly — the sheet, the card feed and the shell —
   and the last one to write won. Close a sheet that was opened over the
   card feed and the feed's lock went with it; fail to tear a screen down
   and the lock stayed on with nothing to justify it, which reads as the
   whole app having frozen.

   So the lock is owned. It is on while anyone holds it, off when nobody
   does, and `reconcileScroll` lets the shell state exactly who should be
   holding it — which is how a lock left behind by a screen that is no
   longer there gets dropped. */
const scrollLocks = new Set();

function syncScroll() {
  const want = scrollLocks.size > 0;
  const root = document.documentElement;
  if ((root.style.overflow === 'hidden') !== want) root.style.overflow = want ? 'hidden' : '';
}

export function lockScroll(owner) { scrollLocks.add(owner); syncScroll(); }
export function unlockScroll(owner) { scrollLocks.delete(owner); syncScroll(); }

/** The definitive list of who should hold the lock right now. */
export function reconcileScroll(owners) {
  scrollLocks.clear();
  for (const o of owners) if (o) scrollLocks.add(o);
  syncScroll();
}

/* ---------- toast ---------- */
let toastTimer = null;
export function toast(msg, { action = null, onAction = null, ms = 2400 } = {}) {
  const t = $('#toast');
  if (!t) return;
  t.innerHTML = '';
  t.appendChild(document.createTextNode(msg));
  if (action && onAction) {
    const b = document.createElement('button');
    b.textContent = action;
    b.style.cssText = 'margin-left:12px;font-weight:700;text-decoration:underline;color:inherit';
    b.addEventListener('click', () => { hideToast(); onAction(); });
    t.appendChild(b);
    t.style.pointerEvents = 'auto';
    ms = Math.max(ms, 4200);
  } else {
    t.style.pointerEvents = 'none';
  }
  t.classList.add('in');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms);
}
function hideToast() {
  const t = $('#toast');
  if (t) { t.classList.remove('in'); t.style.pointerEvents = 'none'; }
}

/* ---------- sheet ---------- */
let sheetState = null;
/** A close schedules a teardown 260ms later. If another sheet opens inside
 *  that window — which is exactly what every "confirm this" flow does — the
 *  stale teardown would wipe the new sheet out from under the user. */
let closeTimer = null;
let openedAt = 0;

export function openSheet(opts) {
  const { title = '', sub = '', body = '', footer = '', onMount, onClose, closeLabel = 'Close' } = opts;
  const sheet = $('#sheet'), scrim = $('#scrim');
  if (!sheet) return;

  clearTimeout(closeTimer);
  closeTimer = null;
  sheet.innerHTML = str(html`
    <div class="sheet-grab" data-grab></div>
    <div class="sheet-in">
      <div class="sheet-hd">
        <div class="grow">
          <h2>${title}</h2>
          ${sub ? html`<div class="sub">${sub}</div>` : ''}
        </div>
        <button class="iconbtn" data-sheet-close aria-label="${closeLabel}">${icon('x')}</button>
      </div>
      <div data-sheet-body>${raw(str(body))}</div>
      ${footer ? html`<div class="sheet-ft">${raw(str(footer))}</div>` : ''}
    </div>
  `);

  scrim.hidden = false;
  sheet.hidden = false;
  requestAnimationFrame(() => { scrim.classList.add('in'); sheet.classList.add('in'); });
  lockScroll('sheet');

  sheetState = { onClose };
  openedAt = Date.now();
  attachGrab(sheet);
  if (onMount) onMount(sheet);
  return sheet;
}

export function closeSheet() {
  const sheet = $('#sheet'), scrim = $('#scrim');
  if (!sheet || sheet.hidden) return;
  const st = sheetState; sheetState = null;
  sheet.classList.remove('in');
  scrim.classList.remove('in');
  unlockScroll('sheet');
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    closeTimer = null;
    sheet.hidden = true; scrim.hidden = true; sheet.innerHTML = '';
  }, 260);
  if (st?.onClose) st.onClose();
}
export function sheetOpen() { return !$('#sheet')?.hidden; }

/** A tap on the scrim in the first moments after a sheet opens is the tail of
 *  the gesture that opened it, not a dismissal. Tapping a row used
 *  to open the block editor on pointerup and then shut it again on the click
 *  that followed, which read as the tap simply not working. */
export function scrimTap() {
  if (Date.now() - openedAt > 400) closeSheet();
}

function attachGrab(sheet) {
  const grab = sheet.querySelector('[data-grab]');
  if (!grab) return;
  let y0 = 0, dy = 0, active = false;
  const start = e => {
    active = true; dy = 0;
    y0 = (e.touches ? e.touches[0].clientY : e.clientY);
    sheet.style.transition = 'none';
  };
  const move = e => {
    if (!active) return;
    const y = (e.touches ? e.touches[0].clientY : e.clientY);
    dy = Math.max(0, y - y0);
    sheet.style.transform = `translateY(${dy}px)`;
    e.preventDefault();
  };
  const end = () => {
    if (!active) return;
    active = false;
    sheet.style.transition = '';
    sheet.style.transform = '';
    if (dy > 90) closeSheet();
  };
  grab.addEventListener('touchstart', start, { passive: true });
  grab.addEventListener('touchmove', move, { passive: false });
  grab.addEventListener('touchend', end);
  grab.addEventListener('mousedown', e => {
    start(e);
    const mm = ev => move(ev);
    const mu = () => { end(); window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); };
    window.addEventListener('mousemove', mm);
    window.addEventListener('mouseup', mu);
  });
}

/* ---------- confirm ---------- */
export function confirmSheet({ title, body = '', confirmLabel = 'Delete', danger = true, onYes }) {
  openSheet({
    title,
    sub: body,
    body: '',
    footer: html`
      <button class="btn quiet" data-sheet-close>Cancel</button>
      <button class="btn ${danger ? 'danger' : 'primary'}" data-confirm-yes>${confirmLabel}</button>`,
    onMount(root) {
      root.querySelector('[data-confirm-yes]').addEventListener('click', () => {
        closeSheet();
        setTimeout(() => onYes(), 60);
      });
    },
  });
}

/* ---------- form helpers ---------- */
export function field(name, label, value = '', { type = 'text', placeholder = '', hint = '', attrs = '' } = {}) {
  return html`<label class="field">
    <span class="lbl">${label}</span>
    <input class="in" name="${name}" type="${type}" value="${value ?? ''}" placeholder="${placeholder}" ${raw(attrs)}>
    ${hint ? html`<span class="hint">${hint}</span>` : ''}
  </label>`;
}
export function area(name, label, value = '', { placeholder = '', hint = '', rows = 4 } = {}) {
  return html`<label class="field">
    <span class="lbl">${label}</span>
    <textarea class="in" name="${name}" rows="${rows}" placeholder="${placeholder}">${value ?? ''}</textarea>
    ${hint ? html`<span class="hint">${hint}</span>` : ''}
  </label>`;
}
export function select(name, label, value, options, { hint = '' } = {}) {
  return html`<label class="field">
    <span class="lbl">${label}</span>
    <select class="in" name="${name}">
      ${options.map(o => {
        const [v, l] = Array.isArray(o) ? o : [o, o];
        return html`<option value="${v}" ${String(v) === String(value) ? raw('selected') : ''}>${l}</option>`;
      })}
    </select>
    ${hint ? html`<span class="hint">${hint}</span>` : ''}
  </label>`;
}
/* A number set with a thumb. Dragging beats typing on a phone for
   anything you would have guessed at anyway, and the value is readable
   the whole time it moves. */
export function slider(name, label, value, { min = 0, max = 100, step = 1, unit = '', cls = '', fmt = null } = {}) {
  return html`<div class="slider ${cls}">
    <div class="slider-h">
      <span class="lbl">${label}</span>
      <span class="val" data-slidout="${name}" data-unit="${unit}">${fmt ? fmt(value) : value}${unit ? html`<small>${unit}</small>` : ''}</span>
    </div>
    <input class="rng ${cls}" type="range" name="${name}" min="${min}" max="${max}" step="${step}" value="${value}">
    <div class="slider-ticks"><span>${min}</span><span>${max}</span></div>
  </div>`;
}

/** Keep every slider's readout in step with its thumb. */
export function wireSliders(root, onChange) {
  for (const inp of $$('input.rng', root)) {
    const out = root.querySelector(`[data-slidout="${inp.name}"]`);
    let last = inp.value;
    const paint = () => {
      if (out) {
        const unit = out.dataset.unit || '';
        out.innerHTML = esc(inp.value) + (unit ? `<small>${esc(unit)}</small>` : '');
      }
    };
    inp.addEventListener('input', () => {
      paint();
      if (inp.value !== last) { last = inp.value; buzz(4); }
      onChange?.(inp, root);
    });
    paint();
  }
}

/* A stepper writes into the hidden input beside it, so readForm() picks
   it up like any other field. Two thumbs and a number, for the things
   that are counted rather than measured. */
export function wireSteppers(root) {
  for (const st of $$('[data-step]', root)) {
    const name = st.dataset.step;
    const min = Number(st.dataset.min ?? 0);
    const max = Number(st.dataset.max ?? 999);
    const inc = Number(st.dataset.inc ?? 1);
    const out = root.querySelector(`[name="${name}"]`);
    const val = st.querySelector('[data-stepval]');
    const set = v => {
      const n = Math.min(max, Math.max(min, v));
      if (out) out.value = String(n);
      if (val) val.textContent = (n > 0 && min < 0 ? '+' : '') + n;
    };
    const at = () => { const n = Number(out?.value); return isFinite(n) ? n : min; };
    st.querySelector('[data-stepdown]')?.addEventListener('click', () => { set(at() - inc); buzz(6); });
    st.querySelector('[data-stepup]')?.addEventListener('click', () => { set(at() + inc); buzz(6); });
  }
}

export function readForm(root) {
  const out = {};
  $$('[name]', root).forEach(el => {
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else out[el.name] = el.value;
  });
  $$('[data-seg]', root).forEach(seg => {
    const on = seg.querySelector('[aria-pressed="true"]');
    out[seg.dataset.seg] = on ? on.dataset.val : null;
  });
  $$('[data-toggle]', root).forEach(t => {
    out[t.dataset.toggle] = t.getAttribute('aria-checked') === 'true';
  });
  return out;
}
