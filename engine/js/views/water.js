/* ============================================================
   views/water.js — the hydration tab

   One number, one ring, and two buttons that cover ninety per cent of
   what you drink. Everything else — a custom amount, the target, when
   to be asked — is a tap down, because a screen you use eight times a
   day has to be thumb-sized, not comprehensive.

   The ring shows two things at once: how much is in you, and where you
   should be by this minute. Being behind is drawn as a mark on the ring
   rather than said in red text, because it is a position, not a telling
   off.
   ============================================================ */

import { html, icon, $, ds, clamp, fmtTime, plural, niceDate, durShort, DOW_XS, dowOf } from '../util.js';
import * as water from '../hydration.js';
import {
  openSheet, closeSheet, confirmSheet, toast, buzz, sfx, sparkleFrom,
  field, readForm, slider, wireSliders,
} from '../ui.js';

export default {
  id: 'water',

  topbar(app) {
    const doc = app.doc;
    const st = water.status(doc);
    const run = water.streak(doc);
    return {
      title: 'Water',
      sub: st.done
        ? `Target cleared${run > 1 ? ` · ${plural(run, 'day')} running` : ''}`
        : `${vol(doc, st.total)} of ${vol(doc, st.target)}`,
      actions: html`<button class="iconbtn" data-act="waterSettings" aria-label="Water settings">${icon('sliders')}</button>`,
    };
  },

  render(app) {
    const doc = app.doc;
    const st = water.status(doc);
    const w = doc.settings.water;
    const log = doc.hydration.days[ds()]?.log || [];
    const nextIn = water.dueIn(doc, ds(), doc.notified?._water || 0);

    return html`
      <div class="block">
        <div class="panel wcard">
          ${ring(doc, st)}

          <div class="wsay" id="waterSay">${sentence(doc, st, nextIn)}</div>

          <div class="wadd">
            <button class="btn tall" data-act="drink" data-ml="${w.glassMl}">
              ${icon('cup')} ${vol(doc, w.glassMl)}
            </button>
            <button class="btn tall" data-act="drink" data-ml="${w.bottleMl}">
              ${icon('cup')} ${vol(doc, w.bottleMl)}
            </button>
          </div>
          <div class="g2 mt">
            <button class="btn s quiet" data-act="drinkCustom">${icon('plus')} Another amount</button>
            <button class="btn s quiet" data-act="undoDrink" ${log.length ? '' : 'disabled'}>${icon('undo')} Undo</button>
          </div>
        </div>
      </div>

      ${w.on ? html`
        <div class="block wrap">
          <span class="chip ${st.done ? 'done' : ''}">${icon('bell')} ${reminderChip(doc, st, nextIn)}</span>
          <span class="chip">awake ${fmtTime(w.fromAt)}–${fmtTime(w.toAt)}</span>
        </div>`
        : html`
        <div class="block">
          <div class="note warn">Reminders are off. The tally still works; nothing will ask you.</div>
        </div>`}

      <div class="panel block">
        <div class="panel-h"><h3>Today</h3>
          ${log.length ? html`<span class="chip">${plural(log.length, 'drink')}</span>` : ''}
        </div>
        ${log.length ? html`
          <ul class="list">
            ${log.slice().reverse().map(e => html`
              <li>
                <div class="body">
                  <div class="title">${vol(doc, e.ml)}</div>
                  <div class="meta">${atTime(e.at)}</div>
                </div>
                <button class="iconbtn" data-act="removeDrink" data-drink="${e.id}" aria-label="Remove">${icon('x')}</button>
              </li>`)}
          </ul>`
          : html`<div class="empty"><b>Nothing logged yet</b>The first glass is the one that makes the rest of the day easy.</div>`}
      </div>

      ${weekPanel(doc)}
    `;
  },

  mount(app) {
    /* A notification's "Log a glass" button lands here rather than on a
       screen with a button on it. One tap, from the lock screen. */
    if (app.param === 'drink') {
      app.param = '';
      logDrink(app, app.doc.settings.water.glassMl, null);
    }
  },

  /* The sentence under the ring is the only thing that changes between
     ticks, and repainting the whole tab would throw away a press
     animation for a line of text. */
  tick(app, root) {
    const say = $('#waterSay', root);
    if (!say) return;
    const st = water.status(app.doc);
    const nextIn = water.dueIn(app.doc, ds(), app.doc.notified?._water || 0);
    const next = sentence(app.doc, st, nextIn);
    if (say.textContent !== next) say.textContent = next;
  },

  actions: {
    drink(app, el) { logDrink(app, Number(el.dataset.ml) || 0, el); },

    drinkCustom(app) {
      const doc = app.doc;
      const u = doc.settings.water.unit;
      openSheet({
        title: 'How much?',
        sub: `In ${water.unitLabel(u)}. It is added to today, at this minute.`,
        body: html`
          ${slider('amount', 'Amount', water.volNum(doc.settings.water.glassMl, u), {
            min: u === 'oz' ? 1 : 50, max: u === 'oz' ? 68 : 2000,
            step: u === 'oz' ? 1 : 50, unit: water.unitLabel(u),
          })}
          <div class="quickrow mt">
            ${quickAmounts(doc).map(ml => html`
              <button type="button" data-act="drink" data-ml="${ml}" data-sheet-close>${vol(doc, ml)}</button>`)}
          </div>`,
        footer: html`<button class="btn quiet" data-sheet-close>Cancel</button>
          <button class="btn primary" data-act="drinkCustomGo">Add</button>`,
        onMount(root) { wireSliders(root); },
      });
    },

    drinkCustomGo(app) {
      const f = readForm($('#sheet'));
      const ml = water.toMl(f.amount, app.doc.settings.water.unit);
      closeSheet();
      logDrink(app, ml, null);
    },

    undoDrink(app) {
      const ml = water.undoLast(app.doc);
      if (!ml) { toast('Nothing to undo'); return; }
      buzz(10); sfx.undo();
      app.save(); app.render();
      toast(`${vol(app.doc, ml)} taken back off`);
    },

    removeDrink(app, el) {
      const ml = water.removeDrink(app.doc, el.dataset.drink);
      if (!ml) return;
      buzz(8);
      app.save(); app.render();
      toast(`${vol(app.doc, ml)} removed`);
    },

    /* ---------- settings ---------- */
    waterSettings(app) { openWaterSettings(app); },

    toggleWater(app, el) {
      const on = el.getAttribute('aria-checked') !== 'true';
      el.setAttribute('aria-checked', String(on));
      app.doc.settings.water.on = on;
      buzz(10);
      app.save();
    },

    /* Changing the unit rewrites the sheet, because every slider on it is
       labelled and scaled in the old one. */
    setWaterUnit(app, el) {
      const u = el.dataset.unit === 'oz' ? 'oz' : 'ml';
      if (app.doc.settings.water.unit === u) return;
      // Keep whatever is on screen rather than silently reverting edits.
      saveWaterFields(app, readForm($('#sheet')));
      app.doc.settings.water.unit = u;
      app.save();
      closeSheet();
      setTimeout(() => openWaterSettings(app), 90);
    },

    saveWater(app) {
      saveWaterFields(app, readForm($('#sheet')));
      app.save(); closeSheet(); app.render();
      toast('Saved');
    },

    clearWaterDay(app) {
      closeSheet();
      setTimeout(() => confirmSheet({
        title: "Clear today?",
        body: 'Every drink logged today is removed. Other days are untouched.',
        confirmLabel: 'Clear it',
        onYes() {
          water.clearDay(app.doc);
          app.save(); app.render();
          toast('Cleared');
        },
      }), 100);
    },

    openWaterDay(app, el) {
      const key = el.dataset.day;
      const doc = app.doc;
      const day = doc.hydration.days[key];
      const ml = day?.ml || 0;
      openSheet({
        title: niceDate(key),
        sub: `${vol(doc, ml)} of ${vol(doc, water.target(doc))}`,
        body: day?.log?.length
          ? html`<ul class="list mt">
              ${day.log.slice().reverse().map(e => html`
                <li><div class="body"><div class="title">${vol(doc, e.ml)}</div><div class="meta">${atTime(e.at)}</div></div></li>`)}
            </ul>`
          : html`<div class="empty"><b>Nothing logged</b>That day has no drinks on it.</div>`,
        footer: html`<button class="btn primary" data-sheet-close>Close</button>`,
      });
    },
  },
};

/* ---------- settings ----------
   Pulled out of the action table so that changing the unit can reopen
   the same sheet without an action having to call itself. */
function openWaterSettings(app) {
  const w = app.doc.settings.water;
  const u = w.unit;
  const L = water.unitLabel(u);
  openSheet({
    title: 'Water',
    sub: 'Reminders are spaced from your last drink, never fired on the hour.',
    body: html`
      <div class="switch">
        <div class="switch-txt"><b>Remind me</b><span>Only between the hours below, and never once the target is met</span></div>
        <button class="tgl" role="switch" aria-checked="${w.on ? 'true' : 'false'}" data-act="toggleWater"></button>
      </div>

      <div class="field mt">
        <span class="lbl">Units</span>
        <div class="seg">
          ${[['ml', 'Millilitres'], ['oz', 'Ounces']].map(([v, l]) => html`
            <button type="button" data-act="setWaterUnit" data-unit="${v}" aria-pressed="${u === v ? 'true' : 'false'}">${l}</button>`)}
        </div>
      </div>

      ${slider('target', 'Daily target', water.volNum(w.targetMl, u), {
        min: u === 'oz' ? 17 : 500, max: u === 'oz' ? 203 : 6000, step: u === 'oz' ? 1 : 100, unit: L,
      })}
      ${slider('glass', 'A glass', water.volNum(w.glassMl, u), {
        min: u === 'oz' ? 2 : 50, max: u === 'oz' ? 34 : 1000, step: u === 'oz' ? 1 : 10, unit: L,
      })}
      ${slider('bottle', 'A bottle', water.volNum(w.bottleMl, u), {
        min: u === 'oz' ? 7 : 200, max: u === 'oz' ? 68 : 2000, step: u === 'oz' ? 1 : 50, unit: L,
      })}
      ${slider('every', 'Ask me every', w.everyMin, { min: 15, max: 240, step: 15, unit: 'min', cls: 'rest' })}

      <div class="g2 mt">
        ${field('fromAt', 'Awake from', w.fromAt, { type: 'time' })}
        ${field('toAt', 'Until', w.toAt, { type: 'time' })}
      </div>
      <div class="hint">Nothing arrives outside those hours, or inside quiet hours in You → Settings.</div>

      <button class="btn quiet full mt2" data-act="clearWaterDay">${icon('trash')} Clear today’s tally</button>`,
    footer: html`<button class="btn quiet" data-sheet-close>Cancel</button>
      <button class="btn primary" data-act="saveWater">Save</button>`,
    onMount(root) { wireSliders(root); },
  });
}

/* ---------- logging ----------
   One path in, whether it came from a button, a slider or a lock-screen
   notification, so the sound, the buzz and the celebration are the same
   every time. */
function logDrink(app, ml, el) {
  const amount = Math.round(Number(ml) || 0);
  if (amount <= 0) return;
  const doc = app.doc;
  const was = water.hitTarget(doc);
  water.drink(doc, amount);

  /* The next reminder is measured from the last drink, so logging one
     has already moved it along. Clearing the app's own marker stops a
     nudge that was queued a second ago from arriving anyway. */
  if (doc.notified) doc.notified._water = Date.now();

  buzz(12); sfx.tick();
  app.save();
  app.render();

  const now = water.hitTarget(doc);
  if (now && !was) {
    sfx.done(); buzz([20, 60, 20, 60, 40]);
    const node = el || $('.wring');
    if (node) sparkleFrom(node, 14);
    toast(`Target cleared — ${vol(doc, water.totalMl(doc))}`);
  } else {
    const st = water.status(doc);
    toast(`${vol(doc, amount)} in. ${vol(doc, st.left)} to go.`);
  }
}

function saveWaterFields(app, f) {
  const w = app.doc.settings.water;
  const u = w.unit;
  if (f.target != null) w.targetMl = clampMl(water.toMl(f.target, u), 500, 8000, w.targetMl);
  if (f.glass != null) w.glassMl = clampMl(water.toMl(f.glass, u), 50, 2000, w.glassMl);
  if (f.bottle != null) w.bottleMl = clampMl(water.toMl(f.bottle, u), 100, 4000, w.bottleMl);
  if (f.every != null) w.everyMin = clampMl(Number(f.every), 15, 360, w.everyMin);
  if (f.fromAt) w.fromAt = f.fromAt;
  if (f.toAt) w.toAt = f.toAt;
}
function clampMl(v, lo, hi, fallback) {
  const n = Math.round(Number(v));
  return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

/* ---------- the ring ----------
   Two arcs on one circle. The filled one is what you have drunk; the
   small mark is where an even day would have you by now. */
function ring(doc, st) {
  const R = 46;
  const C = 2 * Math.PI * R;
  const pct = clamp(st.total / st.target, 0, 1);
  const pacePct = clamp(st.pace / st.target, 0, 1);
  const a = (pacePct * 360 - 90) * Math.PI / 180;
  const px = (55 + R * Math.cos(a)).toFixed(2);
  const py = (55 + R * Math.sin(a)).toFixed(2);

  return html`
    <div class="wring ${st.done ? 'done' : ''}">
      <svg viewBox="0 0 110 110" aria-hidden="true">
        <circle cx="55" cy="55" r="${R}" fill="none" stroke="var(--s2)" stroke-width="7"/>
        <circle cx="55" cy="55" r="${R}" fill="none"
          stroke="${st.done ? 'var(--done)' : 'var(--accent)'}" stroke-width="7" stroke-linecap="round"
          stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - pct)).toFixed(1)}"
          transform="rotate(-90 55 55)"/>
        ${!st.done && pacePct > 0.01 ? html`
          <circle cx="${px}" cy="${py}" r="3.2"
            fill="var(--tx2)" stroke="var(--ink)" stroke-width="1.6"/>` : ''}
      </svg>
      <div class="wface">
        <b>${vol(doc, st.total)}</b>
        <span>of ${vol(doc, st.target)}</span>
      </div>
    </div>`;
}

/* ---------- what it says ----------
   Position, then the smallest next move. Never a telling off. */
function sentence(doc, st, nextIn) {
  const w = doc.settings.water;
  if (st.done) return `Target cleared. Anything more is a bonus.`;
  if (!water.inWindow(doc)) {
    const before = new Date().getHours() * 60 + new Date().getMinutes() < water.windowOf(doc).from;
    return before
      ? `The day starts at ${fmtTime(w.fromAt)}. ${vol(doc, st.target)} between then and ${fmtTime(w.toAt)}.`
      : `${vol(doc, st.left)} short today. Tomorrow starts at ${fmtTime(w.fromAt)}.`;
  }
  if (st.behind >= (w.glassMl || 250)) {
    return `${vol(doc, st.behind)} behind pace. ${plural(st.glasses, 'glass', 'glasses')} left in the day.`;
  }
  if (st.ahead >= (w.glassMl || 250)) {
    return `Ahead of pace. ${vol(doc, st.left)} to go, no hurry.`;
  }
  return nextIn === 0
    ? `Level with the day. A glass now keeps it that way.`
    : `Level with the day. ${vol(doc, st.left)} to go.`;
}

function reminderChip(doc, st, nextIn) {
  if (st.done) return 'nothing more today';
  if (nextIn == null) return 'nothing more today';
  if (!water.inWindow(doc)) return `from ${fmtTime(doc.settings.water.fromAt)}`;
  return nextIn === 0 ? 'due now' : `next in ${durShort(nextIn)}`;
}

/* ---------- the week ----------
   Seven bars. Not a chart — a glance that answers "is this a good week
   or a bad one" without a single number being read. */
function weekPanel(doc) {
  const days = water.history(doc, 7);
  const hit = days.filter(d => d.hit).length;
  const run = water.streak(doc);

  return html`
    <div class="panel block">
      <div class="panel-h"><h3>This week</h3>
        <span class="chip ${hit >= 5 ? 'done' : ''}">${hit} of 7</span>
      </div>
      <div class="wweek">
        ${days.map(d => html`
          <button class="wday" data-act="openWaterDay" data-day="${d.date}"
                  aria-label="${niceDate(d.date)}, ${vol(doc, d.ml)}">
            <span class="wbar"><i class="${d.hit ? 'hit' : ''}" style="height:${Math.round(d.pct * 100)}%"></i></span>
            <span class="wdow">${DOW_XS[dowOf(d.date)]}</span>
          </button>`)}
      </div>
      <div class="hint center" style="margin-top:10px">
        ${run > 0
          ? `${plural(run, 'day')} in a row at target.`
          : 'A week of mostly-cleared days is the whole goal. Nothing here needs to be perfect.'}
      </div>
    </div>`;
}

/* ---------- small helpers ---------- */
function vol(doc, ml) { return water.fmtVol(ml, doc.settings.water.unit); }

/* Round numbers in whichever unit you actually read. 330 ml is a can;
   12 oz is a can. Showing "11.2 oz" for the same button is the kind of
   detail that makes an app feel translated rather than written. */
function quickAmounts(doc) {
  const u = doc.settings.water.unit;
  return u === 'oz'
    ? [4, 8, 12, 16, 20, 24, 32].map(oz => water.toMl(oz, 'oz'))
    : [100, 200, 250, 330, 500, 750, 1000];
}
function atTime(ts) {
  const d = new Date(ts);
  return fmtTime(d.getHours() * 60 + d.getMinutes());
}
