/* ============================================================
   util.js — dates, formatting, safe templating, DOM
   ============================================================ */

/* ---------- ids ---------- */
let _n = 0;
export function uid(p = '') {
  _n = (_n + 1) % 1e6;
  return p + Date.now().toString(36) + _n.toString(36) + Math.random().toString(36).slice(2, 6);
}

/* ---------- escaping + templating ----------
   html`` escapes every interpolated value automatically.
   Use raw() to inject trusted markup you built yourself.
   This means user text can contain ' " < > & and nothing breaks. */
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC[c]);
}
export function raw(s) {
  return { __raw: String(s == null ? '' : s) };
}
function pour(v) {
  if (v == null || v === false || v === true) return '';
  if (typeof v === 'object' && '__raw' in v) return v.__raw;
  if (Array.isArray(v)) return v.map(pour).join('');
  return esc(v);
}
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += pour(vals[i]) + strings[i + 1];
  return raw(out);
}
/** Render an html`` result (or plain string) into an element. */
export function mount(el, tpl) {
  el.innerHTML = typeof tpl === 'string' ? tpl : pour(tpl);
  return el;
}
export function str(tpl) {
  return typeof tpl === 'string' ? tpl : pour(tpl);
}

/* ---------- DOM ---------- */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
/* ---------- numbers ---------- */
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const pad2 = n => String(n).padStart(2, '0');
export function round(n, dp = 0) {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

/* ---------- dates ----------
   Date keys are local 'YYYY-MM-DD'. Never use toISOString for keys:
   it shifts by timezone and silently logs the wrong day. */
export function ds(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
export function pd(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(key, n) {
  const d = pd(key);
  d.setDate(d.getDate() + n);
  return ds(d);
}
export function daysBetween(a, b) {
  return Math.round((pd(b) - pd(a)) / 864e5);
}
export function dowOf(key) {
  return pd(key).getDay();
}
/** Monday-start week containing `key`. */
export function weekStart(key) {
  return addDays(key, -((dowOf(key) + 6) % 7));
}

export const DOW_S = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DOW_L = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DOW_XS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
export const MON_S = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function niceDate(key, withDow = true) {
  const d = pd(key);
  const base = `${d.getDate()} ${MON_S[d.getMonth()]}`;
  return withDow ? `${DOW_S[d.getDay()]} ${base}` : base;
}
export function relDate(key, today = ds()) {
  const n = daysBetween(today, key);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return DOW_L[dowOf(key)];
  return niceDate(key);
}

/* ---------- clock ---------- */
/** 'HH:MM' -> minutes since midnight */
export function toMin(t) {
  const [h, m] = String(t).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
/** minutes -> 'HH:MM' */
export function toHHMM(min) {
  min = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
}
let CLOCK24 = false;
export function setClockMode(is24) { CLOCK24 = !!is24; }
export function fmtTime(t) {
  const m = typeof t === 'number' ? t : toMin(t);
  const hh = Math.floor(m / 60) % 24, mm = m % 60;
  if (CLOCK24) return `${pad2(hh)}:${pad2(mm)}`;
  const ap = hh >= 12 ? 'pm' : 'am';
  const h12 = hh % 12 || 12;
  return mm ? `${h12}:${pad2(mm)}${ap}` : `${h12}${ap}`;
}
/** Minutes since local midnight, with seconds as a fraction. */
export function nowMin(d = new Date()) {
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}
/** seconds -> '12:04' or '1:02:04' */
export function clockFmt(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}
/** minutes -> '1h 25m' / '45m' */
export function durFmt(mins) {
  mins = Math.max(0, Math.round(mins));
  const h = Math.floor(mins / 60), m = mins % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}
/** minutes -> '1h 25m left' style, short */
export function durShort(mins) {
  mins = Math.round(mins);
  if (mins < 1) return 'under a minute';
  return durFmt(mins);
}
export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many || one + 's'}`;
}

/* ---------- misc ---------- */
export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export function throttle(fn, ms) {
  let last = 0, pend = null;
  return (...a) => {
    const now = Date.now();
    if (now - last >= ms) { last = now; fn(...a); }
    else { clearTimeout(pend); pend = setTimeout(() => { last = Date.now(); fn(...a); }, ms - (now - last)); }
  };
}
/** Stable colour from a string — used for subject dots. */
export function hashHue(s) {
  let h = 0;
  for (let i = 0; i < String(s).length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

/* ---------- SVG icons (stroked, 24-box) ---------- */
const P = d => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
export const ICON = {
  focus:   P('<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="3.2"/><path d="M12 3.4v2M12 18.6v2M3.4 12h2M18.6 12h2"/>'),
  pause:   P('<path d="M9 5.5v13M15 5.5v13"/>'),
  cards:   P('<rect x="3.2" y="6.6" width="13.6" height="14" rx="2.6"/><path d="M7.6 3.4h9.8a3 3 0 0 1 3 3v10"/>'),
  more:    P('<circle cx="12" cy="5.5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="18.5" r="1.6"/>'),
  trophy:  P('<path d="M7.5 4.2h9v4.3a4.5 4.5 0 0 1-9 0Z"/><path d="M7.5 5.6H5.2a2.4 2.4 0 0 0 2.3 3.8M16.5 5.6h2.3a2.4 2.4 0 0 1-2.3 3.8"/><path d="M12 13v3.6M9 20.2h6M9.8 16.6h4.4"/>'),
  layers:  P('<path d="M12 3.4 3.6 7.8 12 12.2l8.4-4.4Z"/><path d="M3.6 12.6 12 17l8.4-4.4"/>'),
  brain:   P('<path d="M9.5 4.2a2.7 2.7 0 0 0-2.7 2.7 2.6 2.6 0 0 0-1.5 4.6 2.7 2.7 0 0 0 1.2 4.6 2.7 2.7 0 0 0 4.6 1.9V4.9a2.6 2.6 0 0 0-1.6-.7Z"/><path d="M14.5 4.2a2.7 2.7 0 0 1 2.7 2.7 2.6 2.6 0 0 1 1.5 4.6 2.7 2.7 0 0 1-1.2 4.6 2.7 2.7 0 0 1-4.6 1.9V4.9a2.6 2.6 0 0 1 1.6-.7Z"/>'),
  lock:    P('<rect x="4.8" y="10.4" width="14.4" height="9.8" rx="2.4"/><path d="M8.2 10.4V7.6a3.8 3.8 0 0 1 7.6 0v2.8"/>'),
  ring:    P('<circle cx="12" cy="12" r="8.6"/>'),
  wallet:  P('<rect x="3.2" y="6" width="17.6" height="13.4" rx="2.8"/><path d="M3.2 10.2h17.6M16.4 14.6h1.8"/><path d="M6 6V4.9a1.6 1.6 0 0 1 2-1.55l8.4 2.2"/>'),
  cart:    P('<circle cx="10" cy="19.4" r="1.4"/><circle cx="17.4" cy="19.4" r="1.4"/><path d="M2.8 4h2.6l2.3 11.1h10.1l1.9-7.8H6.2"/>'),
  pie:     P('<path d="M12 3.6a8.4 8.4 0 1 0 8.4 8.4H12Z"/><path d="M14.6 2.2a8.4 8.4 0 0 1 7.2 7.2h-7.2Z"/>'),
  arrow:   P('<path d="M4.5 12h14M13 6.5 18.5 12 13 17.5"/>'),
  check:   P('<path d="M4.5 12.5 9.5 17.5 19.5 6.5"/>'),
  chev:    P('<path d="M9 5.5 15.5 12 9 18.5"/>'),
  chevD:   P('<path d="M5.5 9 12 15.5 18.5 9"/>'),
  chevL:   P('<path d="M15 5.5 8.5 12 15 18.5"/>'),
  plus:    P('<path d="M12 5v14M5 12h14"/>'),
  minus:   P('<path d="M5 12h14"/>'),
  x:       P('<path d="M6 6l12 12M18 6L6 18"/>'),
  search:  P('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
  play:    P('<path d="M7.5 5.2 18.5 12 7.5 18.8Z"/>'),
  stop:    P('<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>'),
  bell:    P('<path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.6 5.5 1.6 5.5H4.9S6.5 14 6.5 10Z"/><path d="M10 18.5a2.2 2.2 0 0 0 4 0"/>'),
  edit:    P('<path d="M4.5 19.5h4L19 9a2.3 2.3 0 0 0-3.2-3.2L5.3 16.3Z"/><path d="M14.5 6.8 17.2 9.5"/>'),
  trash:   P('<path d="M4.5 6.5h15M9.5 6.5V4.8a1.3 1.3 0 0 1 1.3-1.3h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7M7 6.5l.9 12.2a1.6 1.6 0 0 0 1.6 1.5h5a1.6 1.6 0 0 0 1.6-1.5l.9-12.2"/>'),
  down:    P('<path d="M12 3.8v12M7 11l5 5 5-5M4.5 20.2h15"/>'),
  up:      P('<path d="M12 20.2v-12M7 13l5-5 5 5M4.5 3.8h15"/>'),
  flame:   P('<path d="M12 3.2s4.6 3.7 4.6 8a4.6 4.6 0 1 1-9.2 0c0-1.5.7-2.7 1.6-3.6.3 1.2 1 1.9 1.7 1.9 1.1 0 1.3-1.4 1.3-6.3Z"/>'),
  book:    P('<path d="M4 5.2v13.4a1.6 1.6 0 0 0 1.6 1.6H19V3.8H5.6A1.6 1.6 0 0 0 4 5.4"/><path d="M7.5 8h7M7.5 11.5h5"/>'),
  bolt:    P('<path d="M13.2 3.2 5.5 13.4h5.3l-.9 7.4 7.7-10.2h-5.3Z"/>'),
  target:  P('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.6"/><circle cx="12" cy="12" r="1.1"/>'),
  refresh: P('<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20.2 4v4.4h-4.4"/>'),
  shield:  P('<path d="M12 3.4 5 6v5.4c0 4.2 2.9 7.6 7 9.2 4.1-1.6 7-5 7-9.2V6Z"/>'),
  clock:   P('<circle cx="12" cy="12" r="8.6"/><path d="M12 7v5.2l3.4 2"/>'),
  note:    P('<path d="M5.5 3.8h13v16.4H5.5Z"/><path d="M8.5 8h7M8.5 11.5h7M8.5 15h4"/>'),
  shuffle: P('<path d="M3.5 6.5h3.8l9.4 11h3.8M3.5 17.5h3.8l3-3.6M14 9.1l2.7-2.6h3.8"/><path d="M17.8 3.6 20.5 6.5 17.8 9.4M17.8 14.6l2.7 2.9-2.7 2.9"/>'),
  swipeUp: P('<path d="M12 20.5V6.4"/><path d="M7.6 10.8 12 6.4l4.4 4.4"/>'),
  tap:     P('<path d="M12 3.6v4M12 20.4v-2.2M20.4 12h-4M3.6 12h2.2"/><circle cx="12" cy="12" r="3.4"/>'),
  list:    P('<path d="M4 6.5h1.2M4 12h1.2M4 17.5h1.2M9 6.5h11M9 12h11M9 17.5h11"/>'),
  sliders: P('<path d="M4 7.5h9M17 7.5h3M4 16.5h3M11 16.5h9"/><circle cx="15" cy="7.5" r="2.1"/><circle cx="9" cy="16.5" r="2.1"/>'),
  undo:    P('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M3.8 4v4.4h4.4"/>'),
  spark:   P('<path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9Z"/><path d="M18.6 16.4l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7Z"/>'),
  heart:   P('<path d="M12 20.3S3.8 15.2 3.8 9.4A4.4 4.4 0 0 1 12 7a4.4 4.4 0 0 1 8.2 2.4c0 5.8-8.2 10.9-8.2 10.9Z"/>'),
  cup:     P('<path d="M4.5 7.5h12v6a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5Z"/><path d="M16.5 9.5h1.8a2.4 2.4 0 0 1 0 4.8h-1.8M6 4.2v1.4M10.5 3.6v2M15 4.2v1.4"/>'),
};
export const icon = n => raw(ICON[n] || '');
