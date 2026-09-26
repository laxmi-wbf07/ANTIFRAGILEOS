/* ============================================================
   store.js — durable local persistence

   Strategy, in order of trust:
     1. IndexedDB  (primary; large quota, survives eviction better)
     2. localStorage mirror (instant sync read on boot, sync write on exit)
     3. Rolling daily snapshots in IndexedDB (10 kept, restorable)

   Rules that matter:
     - Never overwrite a good record with a failed parse.
     - Never let an older write land on top of a newer one. Every save
       carries a revision number, and boot trusts the higher one.
     - Always write through to both stores.
     - Flush on every signal the browser gives that the page might be
       about to die: hidden, pagehide, freeze, unload.
     - If both stores fail, say so out loud. A silent save failure would
       be the worst bug this app could have.
   ============================================================ */

import { ds, addDays } from './util.js';

const DB_NAME = 'engine';
const DB_VER = 1;
const STORE_MAIN = 'main';
const STORE_SNAP = 'snapshots';
const DOC_KEY = 'doc';
const LS_KEY = 'engine.doc.v1';
const LS_META = 'engine.meta.v1';
const MAX_SNAPS = 10;
const LS_MAX_BYTES = 2_500_000;

/* The mirror is cheap and goes first; IndexedDB follows. Both have a
   ceiling on how long they will wait, so a long stream of edits still
   lands on disk regularly instead of only when you stop typing. */
const MIRROR_DEBOUNCE = 220;
const MIRROR_MAX_WAIT = 1200;
const IDB_DEBOUNCE = 700;
const HEARTBEAT = 8000;

let db = null;
export const health = {
  idb: false,
  ls: false,
  persisted: false,
  lastWrite: 0,
  lastMirror: 0,
  lastError: null,
  failures: 0,
  bytes: 0,
  rev: 0,
  dirty: false,
};

let onTrouble = null;
/** The app passes a reporter in at boot so a failing disk becomes visible. */
export function setTroubleReporter(fn) { onTrouble = fn; }

/* ---------- IndexedDB plumbing ---------- */
function openDB() {
  return new Promise(resolve => {
    if (!('indexedDB' in self)) return resolve(null);
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VER); } catch (e) { return resolve(null); }
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE_MAIN)) d.createObjectStore(STORE_MAIN);
      if (!d.objectStoreNames.contains(STORE_SNAP)) d.createObjectStore(STORE_SNAP);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
    /* If the open neither succeeds nor fails — another tab holding an
       upgrade, a browser in a strange mood — give up and carry on without
       it rather than hanging the whole app on the splash screen.

       Reading `req.result` while the request is still pending throws
       InvalidStateError, and a throw in here escapes the promise
       entirely: `resolve` is never called, `boot()` never returns, and
       the app sits on "Starting up" until it is force-quit. */
    setTimeout(() => {
      let r = null;
      try { r = req.readyState === 'done' ? req.result : null; } catch (e) { r = null; }
      resolve(r);
    }, 3000);
  });
}

function idbGet(store, key) {
  return new Promise(resolve => {
    if (!db) return resolve(undefined);
    try {
      const tx = db.transaction(store, 'readonly');
      const rq = tx.objectStore(store).get(key);
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => resolve(undefined);
    } catch (e) { resolve(undefined); }
  });
}

function idbSet(store, key, val) {
  return new Promise(resolve => {
    if (!db) return resolve(false);
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(val, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => { health.lastError = 'idb-write'; resolve(false); };
      tx.onabort = () => { health.lastError = 'idb-abort'; resolve(false); };
    } catch (e) { health.lastError = 'idb-throw'; resolve(false); }
  });
}

function idbKeys(store) {
  return new Promise(resolve => {
    if (!db) return resolve([]);
    try {
      const tx = db.transaction(store, 'readonly');
      const rq = tx.objectStore(store).getAllKeys();
      rq.onsuccess = () => resolve(rq.result || []);
      rq.onerror = () => resolve([]);
    } catch (e) { resolve([]); }
  });
}

function idbDel(store, key) {
  return new Promise(resolve => {
    if (!db) return resolve(false);
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch (e) { resolve(false); }
  });
}

/* ---------- localStorage helpers ---------- */
function lsGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, val); return true; }
  catch (e) { health.lastError = 'ls-quota'; return false; }
}

/* ---------- validation ----------
   A record must look like an Engine document before we trust it.
   This is the guard that stops a truncated write wiping real data. */
export function looksValid(o) {
  return !!(o && typeof o === 'object'
    && typeof o.schema === 'number'
    && o.settings && typeof o.settings === 'object'
    && Array.isArray(o.cards)
    && Array.isArray(o.sessions));
}

function parse(text) {
  if (!text) return null;
  try {
    const o = JSON.parse(text);
    return looksValid(o) ? o : null;
  } catch (e) { return null; }
}

/* ---------- boot ---------- */
/**
 * Load the best available document.
 * Returns { doc, source } where source is idb | local | snapshot | none.
 */
export async function boot() {
  db = await openDB();
  health.idb = !!db;

  let fromIdb = null;
  if (db) {
    const rec = await idbGet(STORE_MAIN, DOC_KEY);
    if (rec && looksValid(rec)) fromIdb = rec;
  }

  const lsText = lsGet(LS_KEY);
  health.ls = lsText != null;
  const fromLs = parse(lsText);

  // Prefer whichever was written most recently. `rev` decides between two
  // documents this app wrote; savedAt is the fallback for older ones.
  let picked = null, source = 'none';
  if (fromIdb && fromLs) {
    const lsIsNewer = newer(fromLs, fromIdb);
    picked = lsIsNewer ? fromLs : fromIdb;
    source = lsIsNewer ? 'local' : 'idb';
  } else if (fromIdb) { picked = fromIdb; source = 'idb'; }
  else if (fromLs) { picked = fromLs; source = 'local'; }

  if (!picked && db) {
    const snap = await latestSnapshot();
    if (snap) { picked = snap.doc; source = 'snapshot'; }
  }

  health.rev = picked?.meta?.rev || 0;
  await checkPersisted();
  return { doc: picked, source };
}

/**
 * Is `a` a later write than `b`?
 *
 * This used to fold both numbers into one (`rev * 1e13 + savedAt`), which
 * is fine for the first few hundred saves and then quietly stops being a
 * comparison at all: `rev` passes 900 within a day of ordinary use, at
 * which point `rev * 1e13` is past 2^53 and the `savedAt` term — and
 * eventually the low digits of `rev` itself — round away. Two documents
 * would compare equal, boot would keep whichever the `>` happened to
 * favour, and a session's work could be dropped in favour of the older
 * copy. Compared as a pair, there is nothing to round.
 */
function newer(a, b) {
  const ra = a?.meta?.rev || 0, rb = b?.meta?.rev || 0;
  if (ra !== rb) return ra > rb;
  return (a?.meta?.savedAt || 0) > (b?.meta?.savedAt || 0);
}

export async function checkPersisted() {
  try {
    if (navigator.storage?.persisted) health.persisted = await navigator.storage.persisted();
  } catch (e) { /* ignore */ }
  return health.persisted;
}

/** Ask the browser to make storage durable. Android Chrome grants this for installed PWAs. */
export async function requestPersist() {
  try {
    if (!navigator.storage?.persist) return false;
    const already = await navigator.storage.persisted();
    if (already) { health.persisted = true; return true; }
    const ok = await navigator.storage.persist();
    health.persisted = !!ok;
    return health.persisted;
  } catch (e) { return false; }
}

/* ---------- writing ----------
   Serialising the whole document costs real milliseconds once there are a
   few thousand cards, and save() is called on every tick, tap and keystroke.
   So a call only marks the document dirty. Two timers then run:

     the mirror   localStorage, ~220ms after the last change, and never
                  more than 1.2s after the first unwritten one
     the primary  IndexedDB, ~700ms after the last change

   A heartbeat catches anything a timer missed, and every signal that the
   page might be closing writes straight through. */
let live = null;            // the document, once save() has seen it
let dirtySince = 0;
let mirrorTimer = null;
let idbTimer = null;
let heartbeat = null;
let writing = false;
let queuedWrite = false;

function fail(what) {
  health.lastError = what;
  health.failures++;
  // Say it once, not on every retry.
  if (health.failures === 3 && onTrouble) {
    onTrouble('Saving is failing. Export a backup from You → Settings → Your data.');
  }
}

/** localStorage, synchronous. Returns true if the bytes landed. */
function writeMirror(d) {
  let text;
  try { text = JSON.stringify(d); }
  catch (e) { fail('serialize'); return false; }
  health.bytes = text.length;
  const ok = text.length < LS_MAX_BYTES ? lsSet(LS_KEY, text) : false;
  lsSet(LS_META, JSON.stringify({ savedAt: d.meta.savedAt, rev: d.meta.rev, bytes: text.length }));
  if (ok) { health.lastMirror = Date.now(); health.failures = 0; }
  else fail(text.length >= LS_MAX_BYTES ? 'ls-too-big' : 'ls');
  return ok;
}

/** IndexedDB, with retries. Structured clone means the live object goes straight in. */
async function writePrimary(d) {
  if (!db) return false;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await idbSet(STORE_MAIN, DOC_KEY, d)) {
      health.lastWrite = Date.now();
      health.failures = 0;
      return true;
    }
    await new Promise(r => setTimeout(r, 120 * (attempt + 1)));
  }
  fail('idb');
  return false;
}

function clearTimers() {
  clearTimeout(mirrorTimer); mirrorTimer = null;
  clearTimeout(idbTimer); idbTimer = null;
}

/** Queue a durable write. Coalesced; safe to call on every keystroke. */
export function save(target, { immediate = false } = {}) {
  if (!target) return;
  live = target;
  live.meta = live.meta || {};
  live.meta.rev = (live.meta.rev || 0) + 1;
  live.meta.savedAt = Date.now();
  health.rev = live.meta.rev;
  health.dirty = true;
  if (!dirtySince) dirtySince = Date.now();
  if (!heartbeat) heartbeat = setInterval(tickHeartbeat, HEARTBEAT);

  if (immediate) { flushAll(); return; }

  const waited = Date.now() - dirtySince;
  clearTimeout(mirrorTimer);
  mirrorTimer = setTimeout(runMirror, waited > MIRROR_MAX_WAIT ? 0 : MIRROR_DEBOUNCE);
  clearTimeout(idbTimer);
  idbTimer = setTimeout(runPrimary, IDB_DEBOUNCE);
}

function runMirror() {
  mirrorTimer = null;
  if (live) writeMirror(live);
}

async function runPrimary() {
  idbTimer = null;
  if (!live) return;
  if (writing) { queuedWrite = true; return; }
  writing = true;
  const rev = live.meta.rev;
  await writePrimary(live);
  await maybeSnapshot(live);
  writing = false;
  if (queuedWrite) { queuedWrite = false; runPrimary(); return; }
  // Nothing changed while we were writing: the document is safely down.
  if (live.meta.rev === rev) { health.dirty = false; dirtySince = 0; }
}

function tickHeartbeat() {
  if (!health.dirty || mirrorTimer || idbTimer || writing) return;
  runMirror();
  runPrimary();
}

/** Write both stores now. The mirror half is synchronous. */
export function flushAll() {
  clearTimers();
  if (!live) return;
  writeMirror(live);
  runPrimary();
}

/**
 * Best-effort write for the moment the page might die. The localStorage
 * half is synchronous and holds a complete document, so nothing is lost
 * even if the tab is killed before IndexedDB finishes.
 */
export function flushSync(target) {
  clearTimers();
  const d = target || live;
  if (!d) return;
  live = d;
  writeMirror(d);
  runPrimary();
}

/**
 * Number a document that is about to replace the one on disk.
 *
 * A restore, an import or a wipe swaps the whole document for another,
 * and a document out of a backup carries whatever `rev` it had when the
 * backup was taken — usually far below the rev of the copy it is
 * replacing. Boot keeps the higher rev, so if either store missed the
 * write that followed (a full localStorage quota is enough), the next
 * launch would quietly resurrect the document the user had just
 * replaced, and the restore would look like it had silently failed.
 *
 * Numbering the replacement above everything already written means it
 * wins on either store, so the worst case is a restore that has to be
 * done twice rather than one that undoes itself.
 */
export function adoptRev(doc) {
  if (!doc) return;
  doc.meta = doc.meta || {};
  doc.meta.rev = Math.max(Number(doc.meta.rev) || 0, health.rev || 0) + 1;
}

/** True when there are changes not yet on disk. */
export function isDirty() { return health.dirty; }

/* ---------- snapshots ---------- */
let snapshotCheckedFor = '';
async function maybeSnapshot(d) {
  if (!db) return;
  const key = ds();
  if (snapshotCheckedFor === key) return;  // one lookup a day, not one a write
  const existing = await idbGet(STORE_SNAP, key);
  snapshotCheckedFor = key;
  if (existing) return;
  await idbSet(STORE_SNAP, key, { key, at: Date.now(), doc: d });
  const keys = (await idbKeys(STORE_SNAP)).sort();
  while (keys.length > MAX_SNAPS) await idbDel(STORE_SNAP, keys.shift());
}

export async function forceSnapshot(d, label) {
  if (!db) return false;
  const key = label || ds();
  return idbSet(STORE_SNAP, key, { key, at: Date.now(), doc: d });
}

export async function listSnapshots() {
  if (!db) return [];
  const keys = (await idbKeys(STORE_SNAP)).sort().reverse();
  const out = [];
  for (const k of keys) {
    const rec = await idbGet(STORE_SNAP, k);
    if (rec && looksValid(rec.doc)) {
      out.push({
        key: k,
        at: rec.at,
        cards: (rec.doc.cards || []).length,
        sessions: (rec.doc.sessions || []).length,
        water: Object.keys(rec.doc.hydration?.days || {}).length,
        bytes: JSON.stringify(rec.doc).length,
      });
    }
  }
  return out;
}

export async function latestSnapshot() {
  const keys = (await idbKeys(STORE_SNAP)).sort().reverse();
  for (const k of keys) {
    const rec = await idbGet(STORE_SNAP, k);
    if (rec && looksValid(rec.doc)) return rec;
  }
  return null;
}

export async function readSnapshot(key) {
  const rec = await idbGet(STORE_SNAP, key);
  return rec && looksValid(rec.doc) ? rec.doc : null;
}

/* ---------- wipe ---------- */
export async function wipeAll() {
  clearTimers();
  live = null;
  snapshotCheckedFor = '';
  try { localStorage.removeItem(LS_KEY); localStorage.removeItem(LS_META); } catch (e) { /* ignore */ }
  if (!db) return;
  await new Promise(resolve => {
    try {
      const tx = db.transaction([STORE_MAIN, STORE_SNAP], 'readwrite');
      tx.objectStore(STORE_MAIN).clear();
      tx.objectStore(STORE_SNAP).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch (e) { resolve(); }
  });
}

/* ---------- file export / import ---------- */
export function downloadFile(name, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 800);
}

export function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read that file'));
    r.readAsText(file);
  });
}

/* ---------- age helpers ---------- */
export function backupAgeDays(d) {
  const last = d.settings?.lastBackup;
  if (!last) return daysSince(d.meta?.createdOn || ds());
  return daysSince(last);
}
export function daysSince(key) {
  return Math.max(0, Math.round((Date.parse(ds()) - Date.parse(key)) / 864e5));
}
export { addDays };
