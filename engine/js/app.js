/* ============================================================
   app.js — shell, router, clock, wiring

   One clock drives everything. One delegated listener handles every
   tap. No inline handlers anywhere, which is why text containing
   quotes, brackets or apostrophes can no longer break the interface.
   ============================================================ */

import { $, html, str, raw, esc, icon, mount, ds, setClockMode, debounce } from './util.js';
import * as store from './store.js';
import { seed, normalize } from './state.js';
import * as notify from './notify.js';
import * as water from './hydration.js';
import * as game from './game.js';
import { toast, setFeedbackPrefs, unlockAudio, closeSheet, scrimTap, sheetOpen, reconcileScroll, sfx, buzz } from './ui.js';
import { advance as advanceFocus } from './session.js';
import * as plan from './plan.js';
import { counts } from './srs.js';

import cards from './views/cards.js';
import focus from './views/focus.js';
import waterView from './views/water.js';
import moneyView from './views/money.js';
import you from './views/you.js';
import reel from './views/reel.js';
import { settingsActions } from './views/settings.js';

/* ---------- the app object passed to every view ---------- */
export const app = {
  doc: seed(),
  route: 'cards',
  param: '',
  viewState: {},
  ready: false,
  installPrompt: null,
  swReg: null,
  bootSource: 'none',

  save(opts) { queueSave(opts); },
  /** Re-read theme, accent, density and clock format from settings. */
  restyle() { applyAppearance(); },
  saveNow() { queueSave({ immediate: true }); },
  render() { render(); },
  go(r, param) { go(r, param); },
  refreshChrome() { applyChrome(); paintTabs(); paintTopbar(); },
  toast,
};

const VIEWS = { cards, focus, water: waterView, money: moneyView, you };
const ROUTES = Object.keys(VIEWS);

/* The shell's nodes exist for the life of the page and are touched
   several times a second, so they are looked up once. */
const EL = {};
function el(id) {
  const hit = EL[id];
  if (hit && hit.isConnected) return hit;
  return (EL[id] = document.getElementById(id));
}

/* ---------- saving ---------- */
function queueSave(opts = {}) {
  store.save(app.doc, opts);
  scheduleBadge();
}

/* ---------- theme ---------- */
export function applyAppearance() {
  const s = app.doc.settings;
  const root = document.documentElement;
  let theme = s.theme;
  if (theme === 'auto') theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  root.dataset.theme = theme;
  root.dataset.accent = s.accent || 'default';
  root.dataset.density = s.density || 'normal';
  setClockMode(!!s.clock24);
  setFeedbackPrefs({ sound: s.sound, haptics: s.haptics, confetti: s.confetti });
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#F6F2EA' : '#0D1014');
}

/* ---------- chrome ----------
   The top bar and the tab bar are the only way out of anywhere, so
   whether they are on screen is derived, once, from what is actually
   true — never toggled imperatively from six places and left behind.

   A full-screen overlay that failed to tear down used to strand you with
   `hidden` and an `overflow:hidden` on the root and no way back. Both are
   now recomputed rather than remembered, and `healChrome` below puts it
   right even if something throws halfway through a teardown. */
export function applyChrome() {
  const root = document.documentElement;
  const overlay = reelVisible();

  /* Only the Focus tab itself gets to hide the top bar, and only while a
     session is actually running on it. The tab bar stays put wherever you
     are: losing it is losing the app. */
  const owns = app.route === 'focus' && !!app.doc.activeFocus;
  const want = owns ? 'focus' : '';
  if (root.dataset.session !== want) root.dataset.session = want;

  if (overlay) { if (!root.dataset.immersive) root.dataset.immersive = 'on'; }
  else if (root.dataset.immersive) delete root.dataset.immersive;

  const bar = el('tabbar');
  if (bar && bar.hidden !== overlay) bar.hidden = overlay;

  /* The root scroll lock belongs to whatever is covering the page, and
     this is the list of everything that currently is. Anything else
     holding it — a screen that failed to tear down — loses it here. */
  reconcileScroll([
    reelVisible() && 'reel',
    sheetOpen() && 'sheet',
  ]);
}

function reelVisible() { const n = el('reel'); return !!n && !n.hidden; }

/* A second line of defence, run from the clock. If the overlay's node is
   on screen with no session behind it there is no gesture and no button
   that can dismiss it, so it is torn down here instead of stranding you
   in it. */
function healChrome() {
  if (reelVisible() && !reel.isOpen()) reel.close(app, { silent: true });
  applyChrome();
}

/* ---------- router ---------- */
function parseHash() {
  const h = (location.hash || '').replace(/^#\/?/, '');
  const [r, p] = h.split('/');
  return { route: ROUTES.includes(r) ? r : (r === 'reel' ? 'reel' : 'cards'), param: p || '' };
}

export function go(route, param = '') {
  const target = route === 'reel' ? 'reel' : (ROUTES.includes(route) ? route : 'cards');
  const next = '#/' + target + (param ? '/' + param : '');
  if (location.hash === next) { onRoute(); return; }
  location.hash = next;
}

function onRoute() {
  const { route, param } = parseHash();
  /* A sheet is a screen. The phone's back gesture and the browser's back
     button should close it rather than leaving the tab underneath it,
     which is what everybody expects and nothing here was doing. */
  if (sheetOpen()) closeSheet();
  if (route === 'reel') {
    reel.open(app, param);
    return;
  }
  if (reel.isOpen()) reel.close(app, { silent: true });
  const changed = route !== app.route;
  app.route = route;
  app.param = param;
  if (changed) { app.viewState = {}; window.scrollTo(0, 0); }
  render({ swap: changed });
}

/* ---------- render ---------- */
let currentView = null;

export function render(opts = {}) {
  if (!app.ready) return;
  const view = VIEWS[app.route] || VIEWS.cards;
  currentView = view;
  const root = el('main');
  applyChrome();
  mount(root, view.render(app));
  paintTopbar();
  paintTabs();
  view.mount?.(app, root);
  /* A param the view has consumed should not survive in the address bar:
     a reload would replay it, which for a route like #/water/drink means
     silently logging another glass. */
  if (!app.param) {
    const bare = '#/' + app.route;
    if (location.hash.startsWith(bare + '/')) history.replaceState(null, '', bare);
  }
  tickView();
  if (opts.swap) swapIn(root);
}

/* A short fade on the way in, so a tab change reads as a change rather
   than a flicker. Re-triggered by removing the class and forcing a reflow,
   which is the only reliable way to restart a CSS animation.

   Skipped while a session owns the screen: the animation puts a transform
   on #main, and a transform makes it the containing block for the fixed
   chevron inside it, which would jump for the length of the animation. */
function swapIn(root) {
  if (!root || (app.route === 'focus' && app.doc.activeFocus)) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  root.classList.remove('swap');
  void root.offsetWidth;
  root.classList.add('swap');
}

/* The bar is identical between most renders — same tab, same title, same
   actions — and rewriting it anyway throws away a press animation and
   costs a layout for nothing. So the markup is built, compared, and only
   written when it is actually different. */
let lastTopbar = '';

function paintTopbar() {
  const view = VIEWS[app.route] || VIEWS.cards;
  const bar = el('topbar');
  const info = view.topbar ? view.topbar(app) : { title: view.title || '' };
  /* `back` is how a screen one level down says so. It renders in the same
     place on every tab, so leaving a sub-screen is never a hunt. */
  const back = info.back
    ? html`<button class="topbar-back" ${raw(backAttrs(info.back))} aria-label="${info.back.label || 'Back'}">${icon('chevL')}</button>`
    : '';
  const markup = str(html`
    <div class="topbar-in">
      ${back}
      <div class="grow">
        <div class="topbar-title">${info.title}</div>
        ${info.sub ? html`<div class="topbar-sub">${info.sub}</div>` : ''}
      </div>
      <div class="topbar-actions">${raw(str(info.actions || ''))}</div>
    </div>`);
  if (markup === lastTopbar) return;
  lastTopbar = markup;
  mount(bar, markup);
}

function backAttrs(b) {
  if (b.nav) return `data-nav="${esc(b.nav)}"`;
  return `data-act="${esc(b.act)}"${b.data ? ' ' + b.data : ''}`;
}

const TABS = [
  ['cards', 'Cards', 'cards'],
  ['focus', 'Focus', 'focus'],
  ['water', 'Water', 'cup'],
  ['money', 'Money', 'wallet'],
  ['you', 'You', 'trophy'],
];
const TAB_INDEX = Object.fromEntries(TABS.map(([id], i) => [id, i]));

/* Painted once. After that only the attributes that actually changed are
   touched, which is what lets the rail slide instead of blinking, and
   stops a badge re-rendering from cancelling a press animation. */
let tabsBuilt = false;

function buildTabs() {
  mount(el('tabbar'), html`
    <i class="tabrail" id="tabrail"></i>
    ${TABS.map(([id, label, ic]) => html`
      <button class="tab" data-nav="${id}" data-tab="${id}" aria-current="false">
        <span class="ico">${icon(ic)}</span>
        <span>${label}</span>
        <i class="dot" data-badge="${id}" hidden></i>
      </button>`)}`);
  tabsBuilt = true;
  /* Every node inside the bar, found once. The bar is repainted on most
     renders and a querySelector per tab per paint is pure waste. */
  for (const [id] of TABS) {
    TAB_EL[id] = $(`.tab[data-tab="${id}"]`, EL.tabbar || document);
    BADGE_EL[id] = $(`[data-badge="${id}"]`, EL.tabbar || document);
  }
  EL.tabrail = $('#tabrail');
  addEventListener('resize', () => { railAt = null; moveRail(); }, { passive: true });
}

const TAB_EL = {};
const BADGE_EL = {};

function paintTabs() {
  if (!tabsBuilt) buildTabs();

  for (const [id] of TABS) {
    const b = TAB_EL[id];
    const want = app.route === id ? 'page' : 'false';
    if (b && b.getAttribute('aria-current') !== want) b.setAttribute('aria-current', want);
  }
  moveRail();

  countBadge('cards', countDue());
  pipBadge('focus', !!app.doc.activeFocus && !app.doc.activeFocus.finished);
  pipBadge('water', waterDue());
  wonBadge();
}

/* Measured off the tab itself rather than assumed to be a quarter of the
   bar, so the rail still lands on it at any width or density.

   offsetWidth is a forced layout, so it is only read when the rail has
   somewhere new to be — a route change or a resize — rather than on
   every repaint of the bar. */
let railAt = null;

function moveRail() {
  if (railAt === app.route) return;
  const rail = EL.tabrail || (EL.tabrail = $('#tabrail'));
  const active = TAB_EL[app.route] || TAB_EL.cards;
  if (!rail || !active || !active.offsetWidth) return;
  railAt = app.route;
  const w = active.offsetWidth;
  const x = active.offsetLeft + (w - Math.min(w, 34)) / 2;
  rail.style.width = Math.min(w, 34) + 'px';
  rail.style.transform = `translateX(${x}px)`;
}

function countBadge(tab, n) {
  const node = BADGE_EL[tab];
  if (!node) return;
  const show = n > 0;
  const text = show ? (n > 99 ? '99+' : String(n)) : '';
  if (node.hidden !== !show) node.hidden = !show;
  if (node.textContent !== text) node.textContent = text;
  node.classList.remove('pip', 'soft');
}

/** A bare dot: something is running or owed, no number worth reading. */
function pipBadge(tab, on) {
  const node = BADGE_EL[tab];
  if (!node) return;
  if (node.hidden !== !on) node.hidden = !on;
  if (node.textContent) node.textContent = '';
  node.classList.toggle('pip', on);
  node.classList.toggle('soft', on);
}

/* The You tab wears a dot when the day is won, and nothing before that.
   A badge that is always on is furniture. */
function wonBadge() {
  const node = BADGE_EL.you;
  if (!node) return;
  let won = false;
  try { won = game.dayState(app.doc).won; } catch (e) { won = false; }
  if (node.hidden !== !won) node.hidden = !won;
  if (node.textContent !== '') node.textContent = '';
  node.classList.toggle('pip', won);
  node.classList.toggle('soft', won);
}

function countDue() {
  try {
    const c = counts(app.doc);
    return c.due + c.learn + c.new;
  } catch (e) { return 0; }
}

/** A dot on the Water tab once a glass is actually owed. */
function waterDue() {
  try {
    const doc = app.doc;
    if (!doc.settings.water.on) return false;
    return water.isDue(doc, ds(), doc.notified?._water || 0);
  } catch (e) { return false; }
}

/* ---------- moving between tabs ---------- */
function stepTab(dir) {
  const i = TAB_INDEX[app.route];
  if (i == null) return;
  const next = TABS[i + dir];
  if (!next) return;
  buzz(7);
  go(next[0]);
}

const scheduleBadge = debounce(() => notify.setBadge(countDue()), 900);

/* ---------- the clock ----------
   One interval. Views register a tick through their module.
   Everything derives from Date.now(), so a suspended tab catches up
   the instant it wakes rather than silently losing time. */
let lastTickDate = ds();
let tickCount = 0;

function tickView() {
  const root = el('main');
  if (reel.isOpen()) { reel.tick?.(app); return; }
  currentView?.tick?.(app, root);
}

function clockTick() {
  tickCount++;
  const now = Date.now();

  // roll over at midnight without needing a reload
  const d = ds();
  if (d !== lastTickDate) {
    lastTickDate = d;
    if (plan.rollover(app.doc, d)) app.save();
    render();
  }

  // focus session
  const fs = app.doc.activeFocus;
  if (fs && !fs.finished) {
    const events = advanceFocus(fs, now);
    if (events.length) {
      for (const ev of events) {
        if (ev.type === 'end') {
          sfx.done(); buzz([180, 90, 180, 90, 320]);
          notify.show('Session complete', 'Write down three things from memory before you stand up.', { tag: 'focus', url: './#/focus' });
        } else if (ev.to === 'work') {
          sfx.start(); buzz([140, 60, 140]);
          notify.show('Back to it', 'Break over.', { tag: 'focus', url: './#/focus' });
        } else {
          sfx.rest(); buzz([90, 50, 90]);
          notify.show('Break', 'Stand up. Water. Look out of a window.', { tag: 'focus', url: './#/focus' });
        }
      }
      app.save();
      if (app.route === 'focus') render();
    }
  }

  tickView();

  /* Cheap, and it is the difference between a bad frame and being locked
     out of the app until a reload. */
  if (tickCount % 3 === 0) healChrome();

  // notifications roughly every 10 seconds
  if (tickCount % 10 === 0) {
    notify.tick(app.doc, () => app.save());
    paintTabs();
  }
}

/* ---------- delegated events ---------- */
/* Resolved against what is on screen rather than against internal state.
   An overlay whose state has gone but whose node has not still has a close
   button on it, and that button has to work — it is the only way out. */
function findAction(name) {
  if (reelVisible() && reel.actions?.[name]) return reel.actions[name];
  if (currentView?.actions?.[name]) return currentView.actions[name];
  for (const v of Object.values(VIEWS)) if (v.actions?.[name]) return v.actions[name];
  return GLOBAL[name];
}

const GLOBAL = {
  close() { closeSheet(); },
  nav(a, el) { go(el.dataset.nav); },
  openReel(a, el) { reel.open(a, el.dataset.deck || ''); },
};

function wireEvents() {
  let audioUnlocked = false;

  document.addEventListener('click', ev => {
    if (!audioUnlocked) {
      unlockAudio();
      audioUnlocked = true;
      /* The permission prompt needs a gesture, and a prompt that arrives
         before you have seen the app gets refused for good. So it waits
         for the first tap and then asks once, ever. */
      setTimeout(() => notify.ensurePermission(app.doc, () => app.save()), 400);
    }

    const nav = ev.target.closest('[data-nav]');
    if (nav) { ev.preventDefault(); go(nav.dataset.nav); return; }

    const actEl = ev.target.closest('[data-act]');
    const closer = ev.target.closest('[data-sheet-close]');

    if (actEl) {
      const fn = findAction(actEl.dataset.act);
      if (fn) { ev.preventDefault(); fn(app, actEl, ev); }
    }
    // An element can carry both: do the thing, then dismiss the sheet.
    if (closer) closeSheet();
  });

  $('#scrim').addEventListener('click', scrimTap);

  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') {
      if (sheetOpen()) { closeSheet(); return; }
      if (reelVisible()) { reel.close(app); return; }
      if (app.doc.activeFocus) { go('cards'); return; }
    }
    if (ev.target.matches?.('input, textarea, select')) return;
    if (reelVisible()) { reel.key?.(app, ev); return; }
    if (sheetOpen()) return;
    const n = Number(ev.key);
    if (n >= 1 && n <= TABS.length && !ev.metaKey && !ev.ctrlKey) { go(TABS[n - 1][0]); return; }
    if (ev.key === 'ArrowRight' && !ev.metaKey && !ev.ctrlKey && !ev.altKey) { ev.preventDefault(); stepTab(1); return; }
    if (ev.key === 'ArrowLeft' && !ev.metaKey && !ev.ctrlKey && !ev.altKey) { ev.preventDefault(); stepTab(-1); }
  });

  wireTabSwipe();

  let scrolled = false;
  let scrollFrame = 0;
  const onScroll = () => {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      const now = window.scrollY > 6;
      if (now === scrolled) return;
      scrolled = now;
      el('topbar')?.classList.toggle('scrolled', now);
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });

  /* Saving. Every one of these fires in some browser and not in others,
     so all of them are wired and the write itself is idempotent. */
  const panic = () => store.flushSync(app.doc);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { panic(); return; }
    clockTick();
    render();
  });
  window.addEventListener('pagehide', panic);
  window.addEventListener('beforeunload', panic);
  window.addEventListener('blur', panic);
  document.addEventListener('freeze', panic);
  window.addEventListener('focus', () => { clockTick(); });

  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (app.doc.settings.theme === 'auto') applyAppearance();
  });

  window.addEventListener('hashchange', onRoute);

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    app.installPrompt = e;
    if (app.route === 'you') render();
  });
  window.addEventListener('appinstalled', () => {
    app.installPrompt = null;
    store.requestPersist();
    toast('Installed. Open it from your home screen.');
  });
}

/* ---------- sliding between tabs ----------
   A flat sideways flick on the page moves one tab along, which is how a
   phone expects to be driven. It has to be conservative or it eats the
   gestures that matter: anything that scrolls sideways under the finger
   keeps its own gesture, and so do the card feed and any open sheet. */
function wireTabSwipe() {
  const main = el('main');
  if (!main) return;
  const EDGE = 64;        // px of travel before it counts
  const SLOPE = 1.7;      // how much more sideways than vertical it must be
  let x0 = 0, y0 = 0, live = false, pid = null;

  const blocked = node => {
    for (let el = node; el && el !== main; el = el.parentElement) {
      if (el.matches?.('input, textarea, select, .seg, .quickrow, .wweek, [data-noswipe]')) return true;
      if (el.scrollWidth - el.clientWidth > 4) return true;   // it scrolls sideways itself
    }
    return false;
  };

  main.addEventListener('pointerdown', e => {
    live = false;
    if (e.pointerType === 'mouse') return;
    if (sheetOpen() || reel.isOpen()) return;
    if (app.route === 'focus' && app.doc.activeFocus) return;
    if (blocked(e.target)) return;
    x0 = e.clientX; y0 = e.clientY; live = true; pid = e.pointerId;
  }, { passive: true });

  main.addEventListener('pointerup', e => {
    if (!live || e.pointerId !== pid) return;
    live = false;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    if (Math.abs(dx) < EDGE || Math.abs(dx) < Math.abs(dy) * SLOPE) return;
    stepTab(dx < 0 ? 1 : -1);
  }, { passive: true });

  main.addEventListener('pointercancel', () => { live = false; }, { passive: true });
}

/* ---------- service worker ---------- */
/* index.html registers the worker in a plain script, outside the module
   graph, so that a build that fails to import can still be replaced by
   the next one. All this has to do is pick up the registration when it
   lands — and not wait forever if it never does. */
async function waitForSW(ms = 12000) {
  if (!('serviceWorker' in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise(r => setTimeout(() => r(null), ms)),
  ]);
}

async function initSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await waitForSW();
    if (!reg) return;                       // offline still works from cache
    app.swReg = reg;
    notify.setSW(reg);

    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdate(nw);
      });
    });
    if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);

    navigator.serviceWorker.addEventListener('message', ev => {
      if (ev.data?.type === 'navigate' && ev.data.url) {
        const h = String(ev.data.url).split('#')[1];
        if (!h) return;
        /* A changed hash routes itself through hashchange. Routing here as
           well ran every route twice, and the second pass shut the sheet
           the first had opened — a nudge's Start button opened the three
           breaths and then cancelled them. Only an unchanged hash needs a
           push. */
        if (location.hash === '#' + h) onRoute();
        else location.hash = '#' + h;
        return;
      }
      // periodic background sync woke the worker: re-run the schedule
      if (ev.data?.type === 'nudge') notify.tick(app.doc, () => app.save());
    });

    notify.registerPeriodic(reg);
  } catch (e) { /* offline still works from cache */ }
}

function showUpdate(worker) {
  const bar = el('updater');
  if (!bar) return;
  bar.hidden = false;
  mount(bar, html`
    <div class="grow sm"><b>Update ready</b><div class="t3 xs">Your data is untouched.</div></div>
    <button class="btn s primary" data-update-go>Reload</button>
    <button class="iconbtn" data-update-hide aria-label="Later">${icon('x')}</button>`);
  bar.querySelector('[data-update-go]').addEventListener('click', () => {
    worker.postMessage({ type: 'SKIP_WAITING' });
    setTimeout(() => location.reload(), 260);
  });
  bar.querySelector('[data-update-hide]').addEventListener('click', () => { bar.hidden = true; });
}

/* ---------- boot ---------- */
async function boot() {
  const { doc, source } = await store.boot();
  app.bootSource = source;

  if (doc) {
    app.doc = normalize(doc);
    plan.rollover(app.doc);
    if (source === 'snapshot') {
      setTimeout(() => toast('Recovered from the most recent daily snapshot.'), 900);
    }
  } else {
    app.doc = seed();
    app.doc.settings.onboarded = false;
  }

  applyAppearance();
  app.ready = true;
  store.setTroubleReporter(msg => toast(msg, { ms: 9000 }));

  const { route, param } = parseHash();
  app.route = route === 'reel' ? 'cards' : route;
  app.param = param;

  render();
  wireEvents();
  setInterval(clockTick, 1000);
  clockTick();

  store.requestPersist();

  initSW();
  scheduleBadge();

  if (route === 'reel') setTimeout(() => reel.open(app, param), 60);

  // first run
  if (!app.doc.settings.onboarded) {
    setTimeout(() => settingsActions.welcome(app), 420);
  }

  // weekly backup nudge
  const age = store.backupAgeDays(app.doc);
  if (age >= (app.doc.settings.backupReminderDays || 7) && app.doc.cards.length > 20) {
    setTimeout(() => toast(`No backup in ${age} days.`, { action: 'Export', onAction: () => settingsActions.exportJSON(app) }), 2200);
  }

  app.save();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

export { store, notify };
