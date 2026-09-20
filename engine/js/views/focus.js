/* ============================================================
   views/focus.js — the deep work timer

   One card, and the number you are most likely to want to change is the
   one thing on it you can move. Everything else is a tap down.

   A running session takes the whole screen. Nothing else on it is useful
   while the clock is going.
   ============================================================ */

import { html, str, icon, $, ds, clamp, durFmt, clockFmt, plural, niceDate, round, DOW_XS, dowOf, pd } from '../util.js';
import {
  startFocus, phaseLeft, phaseOf, phaseName, pauseFocus, resumeFocus, skipPhase,
  extendPhase, closeFocus, totalSec, elapsedTotalSec,
} from '../session.js';
import { parseCards } from '../srs.js';
import { ensureDeck } from '../state.js';
import * as game from '../game.js';
import {
  openSheet, closeSheet, confirmSheet, toast, buzz, sfx, keepAwake,
  field, area, readForm, slider, wireSliders, wireSteppers,
} from '../ui.js';

export default {
  id: 'focus',

  topbar(app) {
    const doc = app.doc;
    if (doc.activeFocus) return { title: '', sub: '' };   // the session owns the screen
    const mins = game.focusMinutesOn(doc, ds());
    const goal = doc.settings.focus.dailyGoalMin || 0;
    return {
      title: 'Focus',
      sub: mins
        ? `${durFmt(mins)} today${goal ? ` of ${durFmt(goal)}` : ''}`
        : 'Nothing logged today',
      actions: html`<button class="iconbtn" data-act="focusSettings" aria-label="Settings">${icon('sliders')}</button>`,
    };
  },

  render(app) {
    const doc = app.doc;
    if (doc.activeFocus) return focusLive(doc);
    return studyHome(app);
  },

  mount(app, root) {
    const p = app.param || '';
    if (p === 'start' && !app.doc.activeFocus) {
      app.param = '';
      const sh = shape(app);
      beginFocus(app, { preset: { work: sh.work, brk: sh.brk, rounds: sh.rounds } });
      return;
    }
    keepAwake(!!app.doc.activeFocus && app.doc.settings.immersive !== false);
    wireStartSlider(app, root);
  },

  tick(app, root) {
    const fs = app.doc.activeFocus;
    if (!fs || fs.finished) return;
    const left = phaseLeft(fs);
    const p = phaseOf(fs);
    const cd = $('#focusCd', root);
    if (cd) cd.textContent = clockFmt(left);
    const ring = $('#focusRing', root);
    if (ring && p) {
      const C = 2 * Math.PI * 44;
      ring.setAttribute('stroke-dashoffset', String(C * (1 - clamp(1 - left / p.sec, 0, 1))));
    }
    const tot = $('#focusTotal', root);
    if (tot) tot.textContent = `${clockFmt(elapsedTotalSec(fs))} of ${clockFmt(totalSec(fs))}`;
  },

  actions: {
    arriveNow(app) { if (ARRIVING) ARRIVING(); },

    toggleArrive(app, el) {
      const on = el.getAttribute('aria-checked') !== 'true';
      el.setAttribute('aria-checked', String(on));
      app.doc.settings.arrive = on;
      buzz(8);
      app.save();
    },

    /* ---------- starting ---------- */
    startFocusNow(app, el) {
      const p = el?.dataset?.preset ? presetById(app.doc, el.dataset.preset) : shape(app);
      closeSheet();
      beginFocus(app, { preset: { work: p.work || 45, brk: p.brk ?? 10, rounds: p.rounds || 1 } });
    },

    /* One sheet for the whole shape of a session: how long, how long off,
       how many times. Three thumbs and a sentence telling you what you
       just built. Typing a number into a box is the worst possible way
       to answer a question you were going to guess at anyway. */
    pickPreset(app) {
      const doc = app.doc;
      const sh = shape(app);
      closeSheet();
      setTimeout(() => openSheet({
        title: 'Session shape',
        sub: 'Short enough that starting is easy. That is the only rule that matters.',
        body: html`
          ${slider('work', 'Focus for', sh.work, { min: 5, max: 120, step: 5, unit: 'min' })}
          ${slider('brk', 'Break', sh.brk, { min: 0, max: 30, step: 1, unit: 'min', cls: 'rest' })}
          <div class="field">
            <span class="lbl">Rounds</span>
            <div class="stepper" data-step="rounds" data-min="1" data-max="8" data-inc="1">
              <button type="button" class="sbtn" data-stepdown aria-label="Fewer">${icon('minus')}</button>
              <div class="sval"><span data-stepval>${sh.rounds}</span><span>rounds of focus</span></div>
              <button type="button" class="sbtn" data-stepup aria-label="More">${icon('plus')}</button>
            </div>
            <input type="hidden" name="rounds" value="${sh.rounds}">
          </div>
          <div class="note live mt2" id="shapeSay">${shapeSay(sh)}</div>

          <div class="rulehead">Saved presets</div>
          <ul class="list">
            ${doc.settings.focus.presets.map(p => html`
              <li>
                <button class="body" data-act="startFocusNow" data-preset="${p.id}" style="text-align:left">
                  <div class="title">${p.name}</div>
                  <div class="meta">${p.work} minutes${p.rounds > 1 ? ` × ${p.rounds}, ${p.brk} off` : ''}</div>
                </button>
                ${doc.settings.focus.defaultPreset === p.id ? html`<span class="chip live">default</span>` : html`<span class="chev">${icon('chev')}</span>`}
              </li>`)}
          </ul>
          <button class="btn quiet full mt" data-act="saveShapePreset">${icon('plus')} Save this shape as a preset</button>`,
        footer: html`<button class="btn quiet" data-sheet-close>Cancel</button>
          <button class="btn primary" data-act="startShape">${icon('play')} Start</button>`,
        onMount(root) {
          wireSteppers(root);
          const say = root.querySelector('#shapeSay');
          const paint = () => { if (say) say.textContent = shapeSay(readShape(root)); };
          wireSliders(root, paint);
          root.addEventListener('click', e => { if (e.target.closest('[data-step] button')) paint(); });
          paint();
        },
      }), 80);
    },

    startShape(app) {
      const sh = readShape($('#sheet'));
      app.viewState.shape = sh;
      closeSheet();
      beginFocus(app, { preset: { work: sh.work, brk: sh.brk, rounds: sh.rounds } });
    },

    saveShapePreset(app) {
      const sh = readShape($('#sheet'));
      const doc = app.doc;
      const name = `${sh.work} min${sh.rounds > 1 ? ` × ${sh.rounds}` : ''}`;
      doc.settings.focus.presets.push({ id: 'f' + Date.now().toString(36), name, ...sh });
      app.save(); closeSheet(); app.render();
      toast(`Saved as "${name}"`);
    },

    /* A named session, for when you want the log to say what it was. */
    startCustom(app) {
      const sh = shape(app);
      closeSheet();
      setTimeout(() => openSheet({
        title: 'Name it',
        body: html`
          ${field('task', 'What are you working on?', '', { placeholder: 'Anatomy — upper limb' })}
          ${field('subject', 'Subject', '', { placeholder: 'optional' })}
          ${slider('work', 'Focus for', sh.work, { min: 5, max: 120, step: 5, unit: 'min' })}
          ${slider('brk', 'Break', sh.brk, { min: 0, max: 30, step: 1, unit: 'min', cls: 'rest' })}
          <div class="field">
            <span class="lbl">Rounds</span>
            <div class="stepper" data-step="rounds" data-min="1" data-max="8" data-inc="1">
              <button type="button" class="sbtn" data-stepdown aria-label="Fewer">${icon('minus')}</button>
              <div class="sval"><span data-stepval>${sh.rounds}</span><span>rounds of focus</span></div>
              <button type="button" class="sbtn" data-stepup aria-label="More">${icon('plus')}</button>
            </div>
            <input type="hidden" name="rounds" value="${sh.rounds}">
          </div>`,
        footer: html`<button class="btn quiet" data-sheet-close>Cancel</button>
          <button class="btn primary" data-act="startCustomGo">Start</button>`,
        onMount(root) { wireSteppers(root); wireSliders(root); },
      }), 80);
    },

    startCustomGo(app) {
      const f = readForm($('#sheet'));
      closeSheet();
      beginFocus(app, {
        preset: {
          work: Math.max(1, Number(f.work) || 45),
          brk: Math.max(0, Number(f.brk) || 0),
          rounds: Math.max(1, Number(f.rounds) || 1),
        },
        task: f.task || '',
        subject: f.subject || '',
      });
    },

    /* ---------- while it runs ---------- */
    pauseToggle(app) {
      const fs = app.doc.activeFocus;
      if (!fs) return;
      if (fs.paused) { resumeFocus(fs); sfx.start(); } else { pauseFocus(fs); sfx.undo(); }
      buzz(12);
      app.save(); app.render();
    },

    skipPhase(app) {
      const fs = app.doc.activeFocus;
      if (!fs) return;
      const ev = skipPhase(fs);
      buzz(14);
      if (ev?.type === 'end') sfx.done(); else sfx.rest();
      app.save(); app.render();
    },

    extend(app, el) {
      const fs = app.doc.activeFocus;
      if (!fs) return;
      extendPhase(fs, Number(el.dataset.min) || 5);
      buzz(10); sfx.tick();
      app.save(); app.render();
      toast(`${el.dataset.min} more minutes`);
    },

    /** Self-monitoring is the strongest single intervention there is.
        Counting a pull costs nothing and halves the next one. */
    distracted(app, el) {
      const fs = app.doc.activeFocus;
      if (!fs) return;
      fs.distractions = (fs.distractions || 0) + 1;
      buzz([8, 30, 8]);
      app.save();
      const b = el.querySelector('b');
      if (b) b.textContent = String(fs.distractions);
      el.classList.add('hit');
      /* The multiplier is the honest consequence of the tap, so it moves
         under your thumb rather than being revealed at the end. */
      const d = $('#focusDepth');
      if (d) {
        const f = game.depthFactor({ workMin: fs.preset?.work || 45, distractions: fs.distractions });
        d.innerHTML = `${str(icon('spark'))} depth ×${round(f, 2)}`;
        d.className = 'depth ' + (f >= 1.2 ? 'high' : f < 1 ? 'low' : '');
      }
    },

    stopFocus(app) {
      const fs = app.doc.activeFocus;
      if (!fs) return;
      const rec = closeFocus(fs);
      if (rec.minutes < 2) {
        confirmSheet({
          title: 'Stop and bin it?',
          body: 'Under two minutes, so nothing is logged.',
          confirmLabel: 'Bin it',
          onYes() { app.doc.activeFocus = null; keepAwake(false); app.save(); app.render(); app.refreshChrome(); },
        });
        return;
      }
      app.viewState.pendingRec = rec;
      openCloseSheet(app, rec);
    },

    saveSession(app) {
      const f = readForm($('#sheet'));
      const rec = app.viewState.pendingRec;
      if (!rec) { closeSheet(); return; }
      rec.rating = f.rating ? Number(f.rating) : null;
      rec.note = f.note || '';
      rec.three = f.three || '';

      app.doc.sessions.push(rec);
      app.doc.activeFocus = null;
      keepAwake(false);

      let made = 0;
      if (f.three?.trim()) {
        const deck = pickDeck(app.doc, rec.subject);
        if (deck) {
          for (const line of f.three.split('\n').map(s => s.trim()).filter(Boolean)) {
            const parsed = parseCards(line, deck);
            if (parsed.length) { app.doc.cards.push(...parsed); made += parsed.length; }
          }
        }
      }

      app.viewState.pendingRec = null;
      app.save(); closeSheet(); app.render(); app.refreshChrome();
      sfx.done(); buzz([20, 60, 20, 60, 40]);

      /* Anything this session just earned is said here, where it was
         earned, rather than waiting on a tab you might not open. */
      const fresh = game.claimNew(app.doc);
      if (fresh.length) {
        app.save();
        setTimeout(() => toast(`${fresh[0].name} — ${fresh[0].hint}`, { ms: 4200 }), 900);
      }
      if (made) toast(`${plural(made, 'card')} made from memory`);
      else toast(`${durFmt(rec.minutes)} logged`);
    },

    /* ---------- settings and history ---------- */
    focusSettings(app) {
      const doc = app.doc;
      openSheet({
        title: 'Focus',
        body: html`
          <div class="field">
            <span class="lbl">Presets</span>
            <ul class="list">
              ${doc.settings.focus.presets.map(p => html`
                <li>
                  <button class="body" data-act="editPreset" data-preset="${p.id}" style="text-align:left">
                    <div class="title">${p.name}</div>
                    <div class="meta">${p.work}m work · ${p.brk}m break · ${plural(p.rounds, 'round')}</div>
                  </button>
                  <button class="btn s ${doc.settings.focus.defaultPreset === p.id ? 'primary' : 'quiet'}"
                          data-act="setDefaultPreset" data-preset="${p.id}">Default</button>
                </li>`)}
            </ul>
          </div>
          ${slider('goal', 'Daily target', doc.settings.focus.dailyGoalMin || 0, { min: 0, max: 480, step: 15, unit: 'min' })}
          <div class="hint">Zero switches the target off, and with it the evening nudge about being short of it.</div>
          <div class="switch mt">
            <div class="switch-txt"><b>Ask for three things at the end</b><span>Turns them into cards automatically</span></div>
            <button class="tgl" role="switch" aria-checked="${doc.settings.focus.askThreeThings !== false ? 'true' : 'false'}"
                    data-act="toggleThree"></button>
          </div>
          <div class="switch">
            <div class="switch-txt"><b>Keep the screen on</b><span>While a session is running</span></div>
            <button class="tgl" role="switch" aria-checked="${doc.settings.immersive !== false ? 'true' : 'false'}"
                    data-act="toggleImmersive"></button>
          </div>
          <div class="switch">
            <div class="switch-txt"><b>Three breaths first</b><span>Twenty seconds between deciding and starting</span></div>
            <button class="tgl" role="switch" aria-checked="${doc.settings.arrive !== false ? 'true' : 'false'}"
                    data-act="toggleArrive"></button>
          </div>
          <button class="btn quiet full mt2" data-act="openHistory">${icon('clock')} Everything you have logged</button>`,
        footer: html`<button class="btn primary" data-act="saveFocusSettings">Done</button>`,
        /* The goal writes through as it moves rather than on the way out,
           because half the rows on this sheet leave it for another one and
           a number that only survives the Done button would be lost. */
        onMount(root) {
          wireSliders(root, inp => { if (inp.name === 'goal') setGoal(app, inp.value); });
        },
      });
    },

    saveFocusSettings(app) {
      const f = readForm($('#sheet'));
      if (f.goal != null) setGoal(app, f.goal);
      app.save(); closeSheet(); app.render();
    },

    toggleImmersive(app, el) {
      const on = el.getAttribute('aria-checked') !== 'true';
      el.setAttribute('aria-checked', String(on));
      app.doc.settings.immersive = on;
      keepAwake(on && !!app.doc.activeFocus);
      app.save();
    },

    editPreset(app, el) {
      const p = presetById(app.doc, el.dataset.preset);
      closeSheet();
      setTimeout(() => openSheet({
        title: p.name,
        body: html`
          ${field('name', 'Name', p.name)}
          <div class="g3">
            ${field('work', 'Work', p.work, { type: 'number', attrs: 'inputmode="numeric"' })}
            ${field('brk', 'Break', p.brk, { type: 'number', attrs: 'inputmode="numeric"' })}
            ${field('rounds', 'Rounds', p.rounds, { type: 'number', attrs: 'inputmode="numeric"' })}
          </div>`,
        footer: html`<button class="btn danger thin" data-act="deletePreset" data-preset="${p.id}" aria-label="Delete">${icon('trash')}</button>
          <button class="btn primary" data-act="savePreset" data-preset="${p.id}">Save</button>`,
      }), 80);
    },

    savePreset(app, el) {
      const f = readForm($('#sheet'));
      const p = presetById(app.doc, el.dataset.preset);
      p.name = f.name?.trim() || p.name;
      p.work = Math.max(1, Number(f.work) || p.work);
      p.brk = Math.max(0, Number(f.brk) || 0);
      p.rounds = Math.max(1, Number(f.rounds) || 1);
      app.save(); closeSheet(); app.render();
    },

    /* The last one cannot go: the big button has to have a shape to fall
       back on, and an empty list would leave it with nothing. */
    deletePreset(app, el) {
      const doc = app.doc;
      if (doc.settings.focus.presets.length < 2) { toast('Keep at least one preset'); return; }
      doc.settings.focus.presets = doc.settings.focus.presets.filter(p => p.id !== el.dataset.preset);
      if (!doc.settings.focus.presets.some(p => p.id === doc.settings.focus.defaultPreset)) {
        doc.settings.focus.defaultPreset = doc.settings.focus.presets[0].id;
      }
      app.save(); closeSheet(); app.render();
      toast('Deleted');
    },

    setDefaultPreset(app, el) {
      app.doc.settings.focus.defaultPreset = el.dataset.preset;
      app.save(); closeSheet(); app.render();
      toast('That is the one the big button starts');
    },

    toggleThree(app, el) {
      const on = el.getAttribute('aria-checked') !== 'true';
      el.setAttribute('aria-checked', String(on));
      app.doc.settings.focus.askThreeThings = on;
      app.save();
    },

    openHistory(app) {
      const doc = app.doc;
      const rows = doc.sessions
        .slice()
        .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0) || b.date.localeCompare(a.date))
        .slice(0, 60);
      closeSheet();
      setTimeout(() => openSheet({
        title: 'Logged',
        sub: plural(doc.sessions.length, 'session'),
        body: rows.length
          ? html`<ul class="list mt">
              ${rows.map(s => html`
                <li>
                  <button class="body" data-act="openSession" data-session="${s.id}" style="text-align:left">
                    <div class="title">${s.task || s.subject || 'Focus'}</div>
                    <div class="meta">${niceDate(s.date)} · ${durFmt(s.minutes)}</div>
                  </button>
                  <span class="chev">${icon('chev')}</span>
                </li>`)}
            </ul>`
          : html`<div class="empty"><b>Nothing yet</b>It fills up faster than you expect.</div>`,
      }), 80);
    },

    openSession(app, el) {
      const s = app.doc.sessions.find(x => x.id === el.dataset.session);
      if (!s) return;
      closeSheet();
      setTimeout(() => openSheet({
        title: s.task || s.subject || 'Session',
        sub: `${niceDate(s.date)} · ${durFmt(s.minutes)}${s.distractions ? ` · ${plural(s.distractions, 'pull')}` : ''}`,
        body: html`
          ${s.three ? html`<div class="field"><span class="lbl">From memory</span><div class="note good">${s.three}</div></div>` : ''}
          ${s.note ? html`<div class="field"><span class="lbl">Note</span><div class="note">${s.note}</div></div>` : ''}
          <div class="g3 mt">
            <div class="stat"><b>${s.minutes}</b><span>minutes</span></div>
            <div class="stat"><b>${s.completedRounds ?? s.rounds ?? 1}</b><span>rounds</span></div>
            <div class="stat"><b>${s.distractions || 0}</b><span>pulls</span></div>
          </div>`,
        footer: html`<button class="btn danger thin" data-act="deleteSession" data-session="${s.id}" aria-label="Delete">${icon('trash')}</button>
          <button class="btn primary" data-sheet-close>Close</button>`,
      }), 80);
    },

    deleteSession(app, el) {
      app.doc.sessions = app.doc.sessions.filter(x => x.id !== el.dataset.session);
      app.save(); closeSheet(); app.render();
      toast('Deleted');
    },
  },
};

/* Three slow breaths before the clock starts.

   This is not a wellness flourish. The gap between deciding to work and
   working is where the phone gets picked up, and twenty seconds of
   something physical to do closes it. It also does the one thing that
   actually helps attention: it puts you in the room you are in rather
   than the one you are worrying about. Off in Focus settings, and it
   never appears twice for the same session. */
function beginFocus(app, opts) {
  /* Not before a very short start. Those exist precisely because you are
     struggling to begin, and twenty seconds of preparation is the last
     thing they need. */
  const short = (opts?.preset?.work || 99) < 5;
  if (short || app.doc.settings.arrive === false) { reallyBegin(app, opts); return; }
  arrive(app, () => reallyBegin(app, opts), opts);
}

function reallyBegin(app, opts) {
  app.doc.activeFocus = startFocus(opts);
  sfx.start(); buzz([16, 50, 16]);
  keepAwake(app.doc.settings.immersive !== false);
  app.save(); app.render(); app.refreshChrome();
}

const BREATHS = 3;
const IN_MS = 4000, OUT_MS = 6000;   // out longer than in: that is the half that settles you

/** The pending start, while the breaths are running. */
let ARRIVING = null;

function arrive(app, done, opts) {
  let n = 0;
  let timer = 0;
  let closed = false;

  const go = () => {
    if (closed) return;
    closed = true;
    ARRIVING = null;
    clearTimeout(timer);
    closeSheet();
    setTimeout(done, 160);
  };
  ARRIVING = go;

  openSheet({
    title: opts?.task || 'Arrive',
    sub: 'Three breaths, out for longer than in. Then the clock starts.',
    closeLabel: 'Not now',
    body: html`
      <div class="arrive">
        <div class="breath" id="breathRing"><b id="breathWord">In</b></div>
        <div class="breath-count" id="breathCount">Breath 1 of ${BREATHS}</div>
        <div class="breath-say">
          Nothing before this session is happening now, and nothing after it is either.
          There is only the next stretch of time, and it has already started.
        </div>
      </div>`,
    footer: html`<button class="btn primary" data-act="arriveNow">Start now</button>`,
    onClose() {
      // The X or the scrim means you changed your mind. Nothing starts.
      closed = true;
      ARRIVING = null;
      clearTimeout(timer);
    },
    onMount(root) {
      const ring = root.querySelector('#breathRing');
      const word = root.querySelector('#breathWord');
      const count = root.querySelector('#breathCount');

      const cycle = () => {
        if (closed) return;
        n++;
        if (n > BREATHS) { go(); return; }
        count.textContent = `Breath ${n} of ${BREATHS}`;
        ring.classList.remove('out'); ring.classList.add('in');
        word.textContent = 'In';
        buzz(10);
        timer = setTimeout(() => {
          if (closed) return;
          ring.classList.remove('in'); ring.classList.add('out');
          word.textContent = 'Out';
          buzz(6);
          timer = setTimeout(cycle, OUT_MS);
        }, IN_MS);
      };
      cycle();
    },
  });
}

/* ---------- the start screen ---------- */
function studyHome(app) {
  const doc = app.doc;
  const sh = shape(app);
  const st = game.stats(doc);
  const mins = game.focusMinutesOn(doc, ds());
  const depth = game.depthMinutesOn(doc, ds());
  const goal = doc.settings.focus.dailyGoalMin || 0;
  const sessions = doc.sessions.filter(x => x.date === ds()).length;

  return html`
    <div class="block">
      <div class="panel startcard">
        <div class="xs hl">Whenever you are ready</div>
        <div class="start-title">Start a session</div>

        <div class="slider" id="startSlider">
          <div class="slider-h">
            <span class="lbl">Focus for</span>
            <span class="val" id="startVal">${sh.work}<small>min</small></span>
          </div>
          <input class="rng" type="range" id="startWork" min="5" max="120" step="5" value="${sh.work}"
                 aria-label="Minutes of focus">
          <div class="slider-ticks"><span>5m</span><span>1h</span><span>2h</span></div>
        </div>
        <div class="quickrow" id="startQuick">
          ${[15, 25, 45, 50, 90].map(m => html`
            <button type="button" data-qwork="${m}" aria-pressed="${m === sh.work ? 'true' : 'false'}">${m}m</button>`)}
        </div>

        <button class="btn primary full mt2 tall" data-act="startFocusNow">
          ${icon('play')} <span id="startLabel">Start · ${sh.work} min${sh.rounds > 1 ? ` × ${sh.rounds}` : ''}</span>
        </button>
        <button class="btn s quiet full mt" data-act="pickPreset">
          ${icon('sliders')} <span id="startShape">${shapeSay(sh)}</span>
        </button>
        <button class="btn s quiet full mt" data-act="startCustom">${icon('edit')} Name this one</button>
      </div>
    </div>

    ${goal ? html`
      <div class="panel block">
        <div class="panel-h"><h3>Today</h3>
          <span class="chip ${mins >= goal ? 'done' : ''}">${Math.round((mins / goal) * 100)}%</span>
        </div>
        <div class="bar ${mins >= goal ? 'ok' : ''}"><i style="width:${Math.min(100, Math.round((mins / goal) * 100))}%"></i></div>
        <div class="hint" style="margin-top:8px">
          ${mins >= goal
            ? `${durFmt(mins)} done. The target is cleared — anything more is a bonus.`
            : `${durFmt(mins)} of ${durFmt(goal)}. ${durFmt(goal - mins)} left, which is ${plural(Math.max(1, Math.ceil((goal - mins) / Math.max(5, sh.work))), 'session')}.`}
        </div>
        ${sessions ? html`
          <div class="wrap mt">
            <span class="chip">${plural(sessions, 'session')}</span>
            ${depth !== mins ? html`<span class="chip live">${icon('spark')} ${depth} deep minutes</span>` : ''}
          </div>` : ''}
      </div>`
      : mins ? html`
      <div class="block wrap">
        <span class="chip done">${durFmt(mins)} focused today</span>
        <span class="chip">${plural(sessions, 'session')}</span>
      </div>` : ''}

    ${doc.sessions.length ? weekPanel(doc, goal) : ''}
    ${doc.sessions.length ? bestsPanel(st) : ''}`;
}

/* ---------- the week ----------
   Seven bars against the target line. Not a chart — a glance that
   answers "is this a good week" before a single number is read. */
function weekPanel(doc, goal) {
  const days = [];
  let peak = Math.max(goal, 30);
  for (let i = 6; i >= 0; i--) {
    const d = pd(ds());
    d.setDate(d.getDate() - i);
    const key = ds(d);
    const min = game.focusMinutesOn(doc, key);
    peak = Math.max(peak, min);
    days.push({ key, min, hit: goal > 0 && min >= goal });
  }
  const total = days.reduce((a, d) => a + d.min, 0);
  const hit = days.filter(d => d.hit).length;

  return html`
    <div class="panel block">
      <div class="panel-h"><h3>This week</h3>
        <span class="chip ${hit >= 5 ? 'done' : ''}">${durFmt(total)}</span>
      </div>
      <div class="weekbars">
        ${days.map(d => html`
          <span class="wbcol" title="${niceDate(d.key)}">
            <span class="wbar">
              ${goal > 0 ? html`<b class="wbgoal" style="bottom:${Math.round((goal / peak) * 100)}%"></b>` : ''}
              <i class="${d.hit ? 'hit' : ''}" style="height:${Math.round((d.min / peak) * 100)}%"></i>
            </span>
            <span class="wdow">${DOW_XS[dowOf(d.key)]}</span>
          </span>`)}
      </div>
      ${goal > 0 ? html`<div class="hint center" style="margin-top:10px">${hit} of 7 days at target. The line is ${durFmt(goal)}.</div>` : ''}
    </div>`;
}

/* ---------- what you have done ----------
   Four numbers, none of which can be moved without sitting down. */
function bestsPanel(st) {
  return html`
    <div class="panel block">
      <div class="panel-h"><h3>Bests</h3>
        ${st.focusHours ? html`<span class="chip">${plural(st.focusHours, 'hour')} in total</span>` : ''}
      </div>
      <div class="g2">
        <div class="stat"><b>${durFmt(st.longestMin)}</b><span>longest session</span></div>
        <div class="stat"><b>${durFmt(st.bestDayMin)}</b><span>best day</span></div>
        <div class="stat"><b>${Math.round(st.finishRate * 100)}%</b><span>run to the end</span></div>
        <div class="stat"><b>${st.sessions}</b><span>sessions</span></div>
      </div>
      <button class="btn quiet full mt" data-act="openHistory">${icon('clock')} Everything you have logged</button>
    </div>`;
}

/* The shape the big button will start: your default, unless you have
   moved the slider this visit. */
function shape(app) {
  if (app.viewState.shape) return app.viewState.shape;
  const base = presetById(app.doc, app.doc.settings.focus.defaultPreset);
  return {
    work: Math.max(1, base.work || 45),
    brk: Math.max(0, base.brk ?? 10),
    rounds: Math.max(1, base.rounds || 1),
  };
}

function readShape(root) {
  const f = readForm(root);
  return {
    work: clamp(Number(f.work) || 45, 1, 240),
    brk: clamp(Number(f.brk) || 0, 0, 60),
    rounds: clamp(Number(f.rounds) || 1, 1, 12),
  };
}

/** What you just built, said as a sentence rather than three numbers. */
function shapeSay(sh) {
  const total = sh.work * sh.rounds + sh.brk * Math.max(0, sh.rounds - 1);
  if (sh.rounds === 1) return `${sh.work} minutes straight · ${durFmt(total)} in total`;
  return `${sh.work} min × ${sh.rounds}, ${sh.brk || 'no'} min off · ${durFmt(total)} in total`;
}

/* The slider writes straight into view state and repaints two labels.
   No re-render: a slider that re-renders the page under your thumb
   loses the thumb. */
function wireStartSlider(app, root) {
  const rng = $('#startWork', root);
  if (!rng) return;
  const val = $('#startVal', root);
  const label = $('#startLabel', root);
  const say = $('#startShape', root);
  const quick = $('#startQuick', root);
  let last = rng.value;

  const paint = () => {
    const sh = shape(app);
    if (val) val.innerHTML = `${sh.work}<small>min</small>`;
    if (label) label.textContent = `Start · ${sh.work} min${sh.rounds > 1 ? ` × ${sh.rounds}` : ''}`;
    if (say) say.textContent = shapeSay(sh);
    if (quick) {
      for (const b of quick.children) b.setAttribute('aria-pressed', String(Number(b.dataset.qwork) === sh.work));
    }
  };

  const set = work => {
    const sh = shape(app);
    app.viewState.shape = { ...sh, work: clamp(work, 1, 240) };
    rng.value = String(app.viewState.shape.work);
    paint();
  };

  rng.addEventListener('input', () => {
    set(Number(rng.value));
    if (rng.value !== last) { last = rng.value; buzz(4); }
  });
  quick?.addEventListener('click', e => {
    const b = e.target.closest('[data-qwork]');
    if (!b) return;
    set(Number(b.dataset.qwork));
    buzz(8);
  });
}

/* ---------- the running session ----------
   Full screen, one number. Three controls: hold, move on, stop. */
function focusLive(doc) {
  const fs = doc.activeFocus;
  const p = phaseOf(fs);
  const left = phaseLeft(fs);
  const isRest = p && p.type !== 'work';
  const C = 2 * Math.PI * 44;
  const pct = p ? clamp(1 - left / p.sec, 0, 1) : 1;
  const workPhases = fs.phases.filter(x => x.type === 'work').length;
  const doneWork = fs.phases.slice(0, fs.idx).filter(x => x.type === 'work').length;
  /* What this session is currently worth per minute. It is live because
     the one thing that moves it — tapping the pull counter — is right
     next to it, and watching it move is the entire point of counting. */
  const depth = game.depthFactor({ workMin: fs.preset?.work || 45, distractions: fs.distractions || 0 });

  if (fs.finished) {
    return html`
      <div class="focus-wrap done">
        <div class="focus-bar">
          <button class="backbtn" data-nav="cards">${icon('chevL')} Cards</button>
          <span class="grow">Session complete</span>
          <button class="iconbtn" data-act="focusSettings" aria-label="Settings">${icon('sliders')}</button>
        </div>
        <div class="pl-kick done">${icon('check')} Session complete</div>
        <div class="focus-end">${durFmt(Math.round(fs.workDoneSec / 60))}</div>
        <div class="focus-say wide">
          Three things from memory before you stand up. Not from the book — that is the whole point of the session.
        </div>
        <div class="g2 mt2" style="width:100%;max-width:420px">
          <button class="btn quiet" data-act="extend" data-min="10">${icon('plus')} 10 more</button>
          <button class="btn primary" data-act="stopFocus">Finish and log</button>
        </div>
      </div>`;
  }

  return html`
    <div class="focus-wrap live">
      <div class="focus-bar">
        <button class="backbtn" data-nav="cards">${icon('chevL')} Cards</button>
        <span class="grow">The clock keeps going</span>
        <button class="iconbtn" data-act="extend" data-min="5" aria-label="Five more minutes">${icon('plus')}</button>
      </div>
      <div class="focus-phase">${phaseName(p?.type)}${workPhases > 1 ? ` · ${doneWork + (p?.type === 'work' ? 1 : 0)} of ${workPhases}` : ''}${fs.paused ? ' · held' : ''}</div>
      ${fs.task || fs.subject ? html`<div class="focus-task">${fs.task || fs.subject}</div>` : ''}

      <div class="dial ${isRest ? 'rest' : ''}">
        <svg viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="44" fill="none" stroke="var(--s2)" stroke-width="5"/>
          <circle id="focusRing" cx="50" cy="50" r="44" fill="none"
            stroke="${isRest ? 'var(--done)' : 'var(--accent)'}" stroke-width="5" stroke-linecap="round"
            stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - pct)).toFixed(1)}"/>
        </svg>
        <div class="face">
          <div class="cd ${isRest ? 'rest' : ''}" id="focusCd">${clockFmt(left)}</div>
          <div class="sub" id="focusTotal">${clockFmt(elapsedTotalSec(fs))} of ${clockFmt(totalSec(fs))}</div>
        </div>
      </div>

      ${workPhases > 1 ? html`
        <div class="pips">
          ${fs.phases.map((x, i) => x.type === 'work'
            ? html`<i class="${i <= fs.idx ? 'on' : ''}"></i>` : '')}
        </div>` : ''}

      <div class="focus-acts">
        <button class="btn quiet thin" data-act="skipPhase" aria-label="${isRest ? 'Skip the break' : 'Break now'}">${icon('chev')}</button>
        <button class="btn ${fs.paused ? 'primary' : ''} grow tall" data-act="pauseToggle">
          ${icon(fs.paused ? 'play' : 'pause')} ${fs.paused ? 'Carry on' : 'Hold'}
        </button>
        <button class="btn quiet thin" data-act="stopFocus" aria-label="Finish">${icon('stop')}</button>
      </div>

      <div class="focus-meta">
        <span class="depth ${depth >= 1.2 ? 'high' : depth < 1 ? 'low' : ''}" id="focusDepth">
          ${icon('spark')} depth ×${round(depth, 2)}
        </span>
        <button class="focus-pull ${fs.distractions ? 'hit' : ''}" data-act="distracted">
          ${icon('bolt')} pulled away <b>${fs.distractions || 0}</b>×
        </button>
      </div>

      <div class="focus-say">${isRest
        ? 'Stand. Water. Look at something further away than two metres.'
        : fs.distractions > 2
          ? 'Three pulls already. Phone in the bag, not on the desk. No penalty, just move it.'
          : 'Phone in the bag. Anything that needs looking up goes on a list, not into a search bar.'}</div>
    </div>`;
}

/* ---------- closing a session ---------- */
function openCloseSheet(app, rec) {
  const doc = app.doc;
  const ask = doc.settings.focus.askThreeThings !== false;
  const factor = game.depthFactor(rec);
  const worth = game.depthMinutes(rec);
  const best = game.stats(doc).longestMin;

  openSheet({
    title: `${durFmt(rec.minutes)} logged`,
    sub: rec.task || rec.subject || '',
    body: html`
      <div class="wrap" style="margin-bottom:12px">
        <span class="chip live">${icon('spark')} +${worth}</span>
        <span class="chip">depth ×${round(factor, 2)}</span>
        ${rec.minutes > best ? html`<span class="chip done">${icon('trophy')} longest yet</span>` : ''}
        ${rec.distractions ? html`<span class="chip warn">${plural(rec.distractions, 'pull')}</span>` : ''}
      </div>
      ${ask ? area('three', 'Three things, from memory', '', {
        rows: 4,
        placeholder: 'Anything with :: becomes a card\nBrachial plexus roots :: C5 to T1',
        hint: 'Closed book. This is the part that makes the session worth having done.',
      }) : ''}
      <div class="field">
        <span class="lbl">How did it go?</span>
        <div class="seg">
          ${[[1, 'Scratchy'], [2, 'Fine'], [3, 'Deep']].map(([v, l]) => html`
            <button type="button" data-rating="${v}" aria-pressed="false">${l}</button>`)}
        </div>
      </div>
      ${area('note', 'Note', '', { rows: 2, placeholder: 'optional' })}
      <input type="hidden" name="rating" value="">`,
    footer: html`<button class="btn primary" data-act="saveSession">Save</button>`,
    onMount(root) {
      root.addEventListener('click', e => {
        const b = e.target.closest('[data-rating]');
        if (!b) return;
        for (const x of root.querySelectorAll('[data-rating]')) x.setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-pressed', 'true');
        root.querySelector('[name="rating"]').value = b.dataset.rating;
        buzz(8);
      });
    },
    onClose() { /* the session stays alive until it is saved, so nothing is lost */ },
  });
}

/* Cards written from memory at the end of a session are filed without
   asking you anything, because you are packing up. A session named after
   a deck lands in it; anything else lands in "From sessions". */
function pickDeck(doc, subject) {
  const name = String(subject || '').trim().toLowerCase();
  if (name) {
    const hit = doc.decks.find(d => d.name.toLowerCase() === name)
      || doc.decks.find(d => name.includes(d.name.toLowerCase()));
    if (hit) return hit.id;
  }
  return ensureDeck(doc, 'From sessions');
}

function presetById(doc, id) {
  return doc.settings.focus.presets.find(p => p.id === id) || doc.settings.focus.presets[0];
}

function setGoal(app, value) {
  app.doc.settings.focus.dailyGoalMin = clamp(Math.round(Number(value) || 0), 0, 960);
  app.save();
}
