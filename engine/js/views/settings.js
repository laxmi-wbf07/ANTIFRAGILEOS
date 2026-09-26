/* ============================================================
   views/settings.js — appearance, notifications, your data

   A screen one level down from the You tab rather than a tab of its
   own. Settings are a place you go on purpose, once, and then do not
   come back to; a tab is for something you touch every day.
   ============================================================ */

import { html, icon, $, ds, niceDate, plural, durShort } from '../util.js';
import * as store from '../store.js';
import { seed, normalize } from '../state.js';
import * as notify from '../notify.js';
import { openSheet, closeSheet, confirmSheet, toast, buzz, field, readForm } from '../ui.js';

/** The whole settings screen, rendered by the You tab one level down. */
export function settingsScreen(app) {
  return html`
    ${appearancePanel(app.doc)}
    ${notifPanel(app.doc)}
    ${dataPanel(app.doc)}
    ${aboutPanel(app)}
  `;
}

export const settingsActions = {
    /* ---------- appearance ---------- */
    setTheme(app, el) { app.doc.settings.theme = el.dataset.theme; applyAndSave(app); },
    setAccent(app, el) { app.doc.settings.accent = el.dataset.accent; applyAndSave(app); },
    setDensity(app, el) { app.doc.settings.density = el.dataset.density; applyAndSave(app); },
    setClock(app, el) { app.doc.settings.clock24 = el.dataset.clock === '24'; applyAndSave(app); },

    toggleSetting(app, el) {
      const path = el.dataset.setting.split('.');
      let o = app.doc.settings;
      for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
      const k = path[path.length - 1];
      o[k] = !o[k];
      el.setAttribute('aria-checked', String(o[k]));
      buzz(10);
      applyAndSave(app, false);
    },

    /* ---------- notifications ---------- */
    async enableNotifs(app) {
      const res = await notify.request();
      if (res === 'granted') {
        app.doc.settings.notif.enabled = true;
        app.save(); app.render();
        notify.show('Notifications on', 'This is what a nudge looks like.', { tag: 'test' });
        toast('On');
      } else if (res === 'denied') {
        toast('Blocked in your browser settings. Turn it on there first.');
      }
    },

    setIntensity(app, el) {
      app.doc.settings.notif.intensity = el.dataset.intensity;
      buzz(10);
      app.save(); app.render();
      toast(notify.INTENSITY[el.dataset.intensity].hint);
    },

    /* What the scheduler would say if it could say everything at once.
       Useful exactly once — when you are deciding whether to trust it. */
    previewNotifs(app) {
      const q = notify.preview(app.doc);
      const ready = q.rules.filter(r => r.due);
      const waiting = q.rules.filter(r => !r.due);

      const sub = q.quiet ? 'Inside quiet hours. Nothing will arrive until they end.'
        : ready.length
          ? (q.gapLeft > 0
            ? `${plural(ready.length, 'nudge')} ready. The next one lands in ${durShort(q.gapLeft)} — one at a time, never a stack.`
            : `${plural(ready.length, 'nudge')} ready. The top one goes out within ten seconds.`)
          : 'Nothing is due at this minute. That is the idea.';

      openSheet({
        title: 'What is queued',
        sub,
        body: html`
          ${ready.length ? html`
            <div class="rulehead">Ready now</div>
            <ul class="list">
              ${ready.map((r, i) => html`
                <li>
                  <div class="body">
                    <div class="title">${r.title}</div>
                    <div class="meta">${r.body}</div>
                  </div>
                  ${i === 0 ? html`<span class="chip live">next</span>` : ''}
                </li>`)}
            </ul>` : ''}

          ${waiting.length ? html`
            <div class="rulehead">Waiting</div>
            <ul class="list">
              ${waiting.map(r => html`
                <li>
                  <div class="body">
                    <div class="title">${r.title}</div>
                    <div class="meta">${r.body}</div>
                  </div>
                  <span class="chip">${r.why || 'later'}</span>
                </li>`)}
            </ul>` : ''}

          ${!q.rules.length ? html`
            <div class="empty"><b>Quiet</b>Nothing due, nothing behind, nothing waiting to be reviewed.</div>` : ''}

          <div class="hint mt">
            At most one every ${q.gap} minutes, highest first. Your plan is the exception — a block
            about to start is said when it starts, not when the queue allows.
          </div>`,
        footer: html`<button class="btn primary" data-sheet-close>Close</button>`,
      });
    },

    testNotif(app) {
      const ok = notify.show('Deep work at 5:20pm', '1h 30m. This is the one that never moves.', {
        tag: 'test',
        url: './#/focus',
        vibrate: [70, 40, 70],
        actions: [{ action: 'begin', title: 'Start' }, { action: 'later', title: 'Later' }],
      });
      if (!ok) toast('Could not show it. Check browser permissions.');
    },

    editNotifTimes(app) {
      const n = app.doc.settings.notif;
      openSheet({
        title: 'When to nudge',
        sub: 'Nothing is said inside quiet hours, whatever it is.',
        body: html`
          <div class="g2">
            ${field('quietFrom', 'Quiet from', n.quietFrom, { type: 'time' })}
            ${field('quietTo', 'Quiet until', n.quietTo, { type: 'time' })}
          </div>
          <div class="g2">
            ${field('cardsAt', 'Cards reminder', n.cardsAt || '21:00', { type: 'time' })}
            ${field('shutdownAt', 'Wind down', n.shutdownAt || '22:30', { type: 'time' })}
          </div>
          ${field('focusIdleAt', 'Nothing focused yet', n.focusIdleAt || '17:00', { type: 'time' })}`,
        footer: html`<button class="btn quiet" data-sheet-close>Cancel</button>
          <button class="btn primary" data-act="saveNotifTimes">Save</button>`,
      });
    },

    saveNotifTimes(app) {
      const f = readForm($('#sheet'));
      Object.assign(app.doc.settings.notif, {
        quietFrom: f.quietFrom, quietTo: f.quietTo,
        cardsAt: f.cardsAt || '21:00',
        shutdownAt: f.shutdownAt || '22:30',
        focusIdleAt: f.focusIdleAt || '17:00',
      });
      app.save(); closeSheet(); app.render();
      toast('Saved');
    },

    /* ---------- data ---------- */
    exportJSON(app) { saveBackupDownload(app); },

    importJSON(app) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const text = await store.readFile(file);
          const parsed = JSON.parse(text);
          if (!store.looksValid(parsed)) { toast('That does not look like an Engine backup'); return; }
          confirmSheet({
            title: 'Replace everything?',
            body: `The backup holds ${(parsed.cards || []).length} cards and ${(parsed.sessions || []).length} sessions. Your current data is snapshotted first.`,
            confirmLabel: 'Restore',
            danger: false,
            async onYes() {
              await store.forceSnapshot(app.doc, 'before-import-' + Date.now());
              app.doc = normalize(parsed);
              store.adoptRev(app.doc);
              app.restyle(); app.saveNow(); app.render(); app.refreshChrome();
              toast('Restored');
            },
          });
        } catch (e) { toast('Could not read that file'); }
      });
      input.click();
    },

    async openSnapshots(app) {
      const list = await store.listSnapshots();
      openSheet({
        title: 'Daily snapshots',
        sub: 'Taken automatically, ten kept. Nothing here is ever overwritten by the app.',
        body: list.length
          ? html`<ul class="list mt">
              ${list.map(s => html`
                <li>
                  <div class="body">
                    <div class="title">${niceDate(s.key)}</div>
                    <div class="meta">${s.cards} cards · ${plural(s.sessions, 'session')} · ${Math.round(s.bytes / 1024)} KB</div>
                  </div>
                  <button class="btn s quiet" data-act="restoreSnapshot" data-snap="${s.key}">Restore</button>
                </li>`)}
            </ul>`
          : html`<div class="empty"><b>No snapshots yet</b>The first one is taken next time you save something.</div>`,
      });
    },

    async restoreSnapshot(app, el) {
      const key = el.dataset.snap;
      const doc = await store.readSnapshot(key);
      if (!doc) { toast('That snapshot could not be read'); return; }
      closeSheet();
      setTimeout(() => confirmSheet({
        title: `Restore ${niceDate(key)}?`,
        body: 'Everything since then is replaced. Your current state is snapshotted first.',
        confirmLabel: 'Restore',
        danger: false,
        async onYes() {
          await store.forceSnapshot(app.doc, 'before-restore-' + Date.now());
          app.doc = normalize(doc);
          store.adoptRev(app.doc);
          app.restyle(); app.saveNow(); app.render(); app.refreshChrome();
          toast('Restored');
        },
      }), 100);
    },

    wipe(app) {
      confirmSheet({
        title: 'Erase everything?',
        body: 'Every card, session, task and spend. This cannot be undone. Export a backup first.',
        confirmLabel: 'Erase it all',
        async onYes() {
          await store.wipeAll();
          app.doc = seed();
          app.doc.settings.onboarded = true;
          store.adoptRev(app.doc);
          app.restyle(); app.saveNow(); app.render(); app.refreshChrome();
          toast('Back to a clean start');
        },
      });
    },

    async installApp(app) {
      const p = app.installPrompt;
      if (!p) {
        openSheet({
          title: 'Add to your home screen',
          body: html`
            <ol class="list mt">
              <li><div class="body"><div class="title">Open the browser menu</div><div class="meta">The three dots, top right</div></div></li>
              <li><div class="body"><div class="title">Tap "Add to Home screen" or "Install app"</div></div></li>
              <li><div class="body"><div class="title">Open it from the icon after that</div><div class="meta">It runs full screen with no browser bar, and storage becomes durable</div></div></li>
            </ol>`,
          footer: html`<button class="btn primary" data-sheet-close>Got it</button>`,
        });
        return;
      }
      p.prompt();
      const res = await p.userChoice;
      app.installPrompt = null;
      if (res.outcome === 'accepted') toast('Installing');
      app.render();
    },

    async makeDurable(app) {
      const ok = await store.requestPersist();
      app.render();
      toast(ok
        ? 'Storage is durable. Android will not clear it to free space.'
        : 'The browser declined for now. Installing the app usually grants it.');
    },

    welcome(app) {
      app.doc.settings.onboarded = true;
      app.save();
      openSheet({
        title: 'Four things',
        sub: 'Then it gets out of your way.',
        body: html`
          <ol class="list mt">
            <li><div class="body"><div class="title">Cards</div><div class="meta">Write them anywhere with <b>::</b> between the two sides, or paste a whole list in. The feed is one thumb, and it decides what comes back and when.</div></div></li>
            <li><div class="body"><div class="title">Today</div><div class="meta">Give it a task, two answers and a length, and it finds the time around what does not move. When the day changes, the plan changes with it.</div></div></li>
            <li><div class="body"><div class="title">Focus</div><div class="meta">One slider, one button. It keeps running when the screen locks, because the clock is the wall clock, not a counter.</div></div></li>
            <li><div class="body"><div class="title">Money</div><div class="meta">An allowance, what you spent, and a pie showing where it actually went. It never blocks the day — a day you spent nothing is a good one.</div></div></li>
          </ol>
          <div class="note mt2">
            Clear your cards, hit the focus target and sit the deep block on the same day, and the day is won. <b>You</b> keeps the count, and
            tells you which one to do next — a day where you only manage one of them still holds the
            streak together.
          </div>
          <div class="hint mt">Add it to your home screen and everything above keeps working offline.</div>`,
        footer: html`<button class="btn primary" data-sheet-close>Start</button>`,
      });
    },
};

/* ---------- helpers ---------- */
function saveBackupDownload(app) {
  const text = JSON.stringify(app.doc, null, 2);
  store.downloadFile(`engine-${ds()}.json`, text);
  app.doc.settings.lastBackup = ds();
  app.save();
  toast('Backup saved');
}

function applyAndSave(app, rerender = true) {
  app.restyle();
  app.save();
  if (rerender) app.render();
}

function saveState(h) {
  if (h.dirty) return 'Saving…';
  if (!h.lastWrite && !h.lastMirror) return 'Nothing yet';
  const secs = Math.round((Date.now() - Math.max(h.lastWrite, h.lastMirror)) / 1000);
  if (secs < 5) return 'Just now';
  if (secs < 90) return `${secs} seconds ago`;
  return `${Math.round(secs / 60)} minutes ago`;
}

/* ---------- panels ---------- */
function appearancePanel(doc) {
  const s = doc.settings;
  return html`
    <div class="panel block">
      <div class="panel-h"><h3>Appearance</h3></div>
      <div class="field">
        <span class="lbl">Theme</span>
        <div class="seg">
          ${[['dark', 'Dark'], ['light', 'Light'], ['auto', 'Match phone']].map(([v, l]) => html`
            <button data-act="setTheme" data-theme="${v}" aria-pressed="${s.theme === v ? 'true' : 'false'}">${l}</button>`)}
        </div>
      </div>
      <div class="field">
        <span class="lbl">Accent</span>
        <div class="seg">
          ${[['default', 'Clay'], ['amber', 'Amber'], ['jade', 'Jade'], ['indigo', 'Indigo'], ['violet', 'Violet'], ['steel', 'Steel']].map(([v, l]) => html`
            <button data-act="setAccent" data-accent="${v}" aria-pressed="${s.accent === v ? 'true' : 'false'}">${l}</button>`)}
        </div>
      </div>
      <div class="field">
        <span class="lbl">Spacing</span>
        <div class="seg">
          ${[['compact', 'Compact'], ['normal', 'Normal'], ['roomy', 'Roomy']].map(([v, l]) => html`
            <button data-act="setDensity" data-density="${v}" aria-pressed="${s.density === v ? 'true' : 'false'}">${l}</button>`)}
        </div>
      </div>
      <div class="field">
        <span class="lbl">Clock</span>
        <div class="seg">
          ${[['12', '9:30pm'], ['24', '21:30']].map(([v, l]) => html`
            <button data-act="setClock" data-clock="${v}" aria-pressed="${(s.clock24 ? '24' : '12') === v ? 'true' : 'false'}">${l}</button>`)}
        </div>
      </div>
      <div class="switch mt">
        <div class="switch-txt"><b>Sound</b><span>Short tones on ticks and timers</span></div>
        <button class="tgl" role="switch" aria-checked="${s.sound ? 'true' : 'false'}" data-act="toggleSetting" data-setting="sound"></button>
      </div>
      <div class="switch">
        <div class="switch-txt"><b>Vibration</b></div>
        <button class="tgl" role="switch" aria-checked="${s.haptics ? 'true' : 'false'}" data-act="toggleSetting" data-setting="haptics"></button>
      </div>
      <div class="switch">
        <div class="switch-txt"><b>Little celebrations</b><span>The burst when something completes</span></div>
        <button class="tgl" role="switch" aria-checked="${s.confetti ? 'true' : 'false'}" data-act="toggleSetting" data-setting="confetti"></button>
      </div>
    </div>`;
}

function notifPanel(doc) {
  const n = doc.settings.notif;
  const perm = notify.permission();
  const dial = notify.INTENSITY[n.intensity] || notify.INTENSITY.steady;

  return html`
    <div class="panel block">
      <div class="panel-h"><h3>Notifications</h3>
        <span class="chip ${perm === 'granted' ? 'done' : perm === 'denied' ? 'bad' : ''}">${perm}</span>
      </div>
      ${perm !== 'granted' ? html`
        <button class="btn primary full" data-act="enableNotifs">${icon('bell')} Turn on notifications</button>
        <div class="hint">
          Everything here runs on this phone, so nudges arrive while the app is open or recently open.
          Adding it to your home screen is what keeps it awake in the background.
        </div>`
        : html`
        <div class="field">
          <span class="lbl">How hard to push</span>
          <div class="seg">
            ${Object.entries(notify.INTENSITY).map(([k, v]) => html`
              <button data-act="setIntensity" data-intensity="${k}"
                      aria-pressed="${(n.intensity || 'steady') === k ? 'true' : 'false'}">${v.label}</button>`)}
          </div>
          <span class="hint">${dial.hint}. One nudge at a time, at most every ${dial.gap} minutes — never a stack of them.</span>
        </div>
        <div class="switch mt">
          <div class="switch-txt"><b>Everything on</b><span>The master switch. Off means silence.</span></div>
          <button class="tgl" role="switch" aria-checked="${n.enabled ? 'true' : 'false'}" data-act="toggleSetting" data-setting="notif.enabled"></button>
        </div>
        <div class="switch">
          <div class="switch-txt"><b>Cards</b><span>${n.cardsAt}, only if something is due</span></div>
          <button class="tgl" role="switch" aria-checked="${n.cardsReminder ? 'true' : 'false'}" data-act="toggleSetting" data-setting="notif.cardsReminder"></button>
        </div>
        <div class="switch">
          <div class="switch-txt"><b>Pocket money</b><span>Only when it has been a few days, or you have gone over</span></div>
          <button class="tgl" role="switch" aria-checked="${n.money !== false ? 'true' : 'false'}" data-act="toggleSetting" data-setting="notif.money"></button>
        </div>
        <div class="switch">
          <div class="switch-txt"><b>Your plan</b><span>When a planned task or the deep work block is about to start</span></div>
          <button class="tgl" role="switch" aria-checked="${n.plan !== false ? 'true' : 'false'}" data-act="toggleSetting" data-setting="notif.plan"></button>
        </div>
        <div class="switch">
          <div class="switch-txt"><b>Nothing focused yet</b><span>${n.focusIdleAt}, only on a day with no session on it</span></div>
          <button class="tgl" role="switch" aria-checked="${n.focusIdle !== false ? 'true' : 'false'}" data-act="toggleSetting" data-setting="notif.focusIdle"></button>
        </div>
        <div class="switch">
          <div class="switch-txt"><b>Wind down</b><span>${n.shutdownAt}</span></div>
          <button class="tgl" role="switch" aria-checked="${n.shutdown ? 'true' : 'false'}" data-act="toggleSetting" data-setting="notif.shutdown"></button>
        </div>
        <div class="kv mt"><span class="k">Quiet hours</span><span class="v">${n.quietFrom} – ${n.quietTo}</span></div>
        <div class="g3 mt">
          <button class="btn quiet" data-act="editNotifTimes">${icon('clock')} Times</button>
          <button class="btn quiet" data-act="previewNotifs">${icon('list')} Queue</button>
          <button class="btn quiet" data-act="testNotif">${icon('bell')} Test</button>
        </div>
        <div class="hint">
          Each one carries buttons, so starting a block or opening the card feed never needs the app
          opened and hunted through.
        </div>`}
    </div>`;
}

function dataPanel(doc) {
  const s = doc.settings;
  const h = store.health;
  const backupAge = store.backupAgeDays(doc);

  return html`
    <div class="panel block">
      <div class="panel-h"><h3>Your data</h3></div>
      <div class="kv"><span class="k">Stored in</span><span class="v">${h.idb ? 'Database and local copy' : 'Local copy only'}</span></div>
      <div class="kv"><span class="k">Protected from clearing</span><span class="v">${h.persisted ? 'Yes' : 'Not yet'}</span></div>
      <div class="kv"><span class="k">Size</span><span class="v">${Math.round((h.bytes || 0) / 1024)} KB</span></div>
      <div class="kv">
        <span class="k">Saved</span>
        <span class="v ${h.lastError && h.failures ? 'bad' : ''}">${saveState(h)}</span>
      </div>
      <div class="kv"><span class="k">Cards</span><span class="v">${doc.cards.length}</span></div>
      <div class="kv"><span class="k">Sessions</span><span class="v">${doc.sessions.length}</span></div>
      <div class="kv"><span class="k">Tasks planned</span><span class="v">${doc.plan.tasks.length}</span></div>
      <div class="kv"><span class="k">Last backup</span><span class="v">${s.lastBackup ? niceDate(s.lastBackup) : 'never'}</span></div>

      ${!h.persisted ? html`
        <button class="btn quiet full mt" data-act="makeDurable">${icon('shield')} Make storage durable</button>` : ''}

      <div class="g2 mt">
        <button class="btn ${backupAge > 7 ? 'primary' : 'quiet'}" data-act="exportJSON">${icon('down')} Export backup</button>
        <button class="btn quiet" data-act="importJSON">${icon('up')} Restore</button>
      </div>
      <button class="btn quiet full mt" data-act="openSnapshots">${icon('refresh')} Daily snapshots</button>
    </div>`;
}

function aboutPanel() {
  return html`
    <div class="panel block">
      <div class="panel-h"><h3>App</h3></div>
      <button class="btn quiet full" data-act="installApp">${icon('down')} Add to home screen</button>
      <button class="btn quiet full mt" data-act="welcome">${icon('book')} Show the intro again</button>
      <button class="btn danger full mt2" data-act="wipe">${icon('trash')} Erase everything</button>
      <div class="hint center" style="margin-top:14px">
        Everything lives on this phone. Nothing is uploaded anywhere.
      </div>
    </div>`;
}
