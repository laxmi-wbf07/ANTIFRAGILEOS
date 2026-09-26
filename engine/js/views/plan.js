/* ============================================================
   views/plan.js — today, planned around what does not move

   Lives inside the Focus tab, because the plan's only job is to hand
   you to the timer at the right moment. Three things on it you can
   press without thinking:

     Add task         two answers and a length, and it finds the time
     My day changed   something came up, low energy, or an anchor missed
     Start            on whatever is on now

   The timeline is rebuilt from now every time it is drawn, so it is
   never out of date and never needs fixing by hand. See plan.js.
   ============================================================ */

import {
  html, raw, icon, $, $$, ds, addDays, durFmt, plural, fmtTime, nowMin, relDate, niceDate,
  toMin, toHHMM, clamp, DOW_S, DOW_XS, daysBetween,
} from '../util.js';
import * as plan from '../plan.js';
import { openSheet, closeSheet, confirmSheet, toast, buzz, sfx, field, select, readForm, slider, wireSliders } from '../ui.js';

const DURATIONS = [15, 30, 45, 60, 90, 120];

/* ---------- the pane ---------- */
export function planPane(app) {
  const doc = app.doc;
  const today = ds();
  const now = nowMin();
  const sch = plan.schedule(doc, { today, now });
  app.viewState.planSch = sch;
  const f = sch.frames[0];

  return html`
    ${headPanel(doc, f)}
    ${alerts(doc, sch, f, today)}
    ${todayPanel(doc, sch, f, today, now)}
    ${comingPanel(sch)}
    ${parkedPanel(sch)}`;
}

/** Remember what is on today's plan, so tomorrow can tell what was carried. */
export function planMount(app) {
  const sch = app.viewState.planSch;
  if (sch && sch.today === ds() && plan.mark(app.doc, sch)) app.save();
}

/* The top bar is painted straight after the pane, so it reuses the plan
   the pane just built rather than building it again. */
export function planSummary(app) {
  const fresh = app.viewState.planSch;
  const sch = fresh && fresh.today === ds() ? fresh : plan.schedule(app.doc);
  const f = sch.frames[0];
  const n = new Set(f.blocks.map(b => b.task.id)).size;
  if (!n) return f.rest ? 'Rest day' : 'Nothing planned for the rest of today';
  return `${plural(n, 'task')} planned · ${durFmt(f.blocks.reduce((a, b) => a + b.min, 0))}`;
}

function headPanel(doc, f) {
  const meter = (label, used, cap) => {
    const pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : 0;
    return html`
      <div class="loadrow">
        <span class="lbl">${label}</span>
        <div class="bar ${cap && used >= cap ? 'ok' : ''}"><i style="width:${pct}%"></i></div>
        <b>${used}<small>/${cap}m</small></b>
      </div>`;
  };
  const s = doc.settings.plan;
  return html`
    <div class="panel block plan-head">
      <div class="panel-h">
        <h3>${f.rest ? 'Rest day' : f.half ? 'Half-size day' : 'Today'}</h3>
        <span class="chip">${niceDate(f.date)}</span>
      </div>
      ${meter('Hard work', f.used.heavy, f.caps.heavy)}
      ${meter('Light work', f.used.light, f.caps.light)}
      <div class="hint" style="margin-top:6px">
        ${f.rest
          ? 'Nothing is planned today unless a deadline forces it.'
          : `The limits are what a day can take, not what is free. Hard work stops at ${fmtTime(s.lightFrom)}.`}
      </div>
      <div class="g2 mt2">
        <button class="btn primary" data-act="planAdd">${icon('plus')} Add task</button>
        <button class="btn quiet" data-act="planChanged">My day changed</button>
      </div>
    </div>`;
}

/* ---------- things that need you ----------
   The only places the plan asks you to decide. Everything else it has
   already decided. */
function alerts(doc, sch, f, today) {
  const out = [];
  const names = ids => ids.map(id => doc.settings.plan.anchors.find(a => a.id === id)?.name).filter(Boolean);

  if (f.strict) {
    const missed = names(f.missedYesterday);
    out.push(html`
      <div class="note warn">
        <b>Never miss twice.</b> You missed ${missed.length ? missed.join(' and ') : 'an anchor'} yesterday, so today
        ${missed.length > 1 ? 'they are' : 'it is'} not optional. Today's hard-work limit is halved to leave energy for it.
      </div>`);
  }
  if (f.half) {
    out.push(html`
      <div class="note live">
        <b>Half-size day.</b> Only urgent-and-important tasks today, and half the usual limits.
        45 minutes of deep work counts. Training is the short version.
        <div class="mt"><button class="btn s quiet" data-act="planHalf">Back to a full day</button></div>
      </div>`);
  }
  for (const b of f.busy) {
    out.push(html`
      <div class="note">
        <div class="row between">
          <span><b>${b.label || 'Busy'}</b> · ${fmtTime(b.fromM)} – ${fmtTime(b.toM)}. The plan works around it.</span>
          <button class="iconbtn" data-act="planBusyDel" data-id="${b.id}" aria-label="Remove">${icon('x')}</button>
        </div>
      </div>`);
  }
  for (const t of sch.decide) {
    out.push(html`
      <div class="note warn">
        <b>“${t.title}”</b> has moved ${plural(t.carried, 'time')}. Decide now, once:
        <div class="wrap mt">
          <button class="btn s primary" data-act="planPin" data-task="${t.id}">Do it today</button>
          <button class="btn s quiet" data-act="planShrink" data-task="${t.id}" data-half="1">Halve it</button>
          <button class="btn s quiet" data-act="planDrop" data-task="${t.id}">Drop it</button>
        </div>
      </div>`);
  }
  const deciding = new Set(sch.decide.map(t => t.id));
  for (const is of sch.issues) {
    const t = is.task;
    if (deciding.has(t.id)) continue;   // one question per task, not two
    const soon = t.deadline && daysBetween(today, t.deadline) <= 1;
    out.push(html`
      <div class="note warn">
        ${is.kind === 'late'
          ? html`<b>“${t.title}”</b> will not fit before its deadline (${relDate(t.deadline, today).toLowerCase()}) inside your limits.`
          : html`<b>“${t.title}”</b> does not fit anywhere in the next week${is.left < t.min ? html` — ${durFmt(is.left)} of it is left over` : ''}.`}
        <div class="wrap mt">
          ${is.kind === 'late' && soon && t.stretch !== today
            ? html`<button class="btn s primary" data-act="planStretch" data-task="${t.id}">Allow it today anyway</button>` : ''}
          <button class="btn s quiet" data-act="planShrink" data-task="${t.id}" data-half="1">Halve it</button>
          <button class="btn s quiet" data-act="planOpen" data-task="${t.id}">Open</button>
        </div>
      </div>`);
  }
  return out.length ? html`<div class="block plan-alerts">${out}</div>` : '';
}

/* ---------- today, as a timeline ---------- */
function todayPanel(doc, sch, f, today, now) {
  const rows = [];
  const s = doc.settings.plan;
  const day = doc.plan.days[today] || { missed: [] };
  const end = toMin(s.bedAt);

  rows.push({ at: f.wake, ord: 0, kind: 'mark', label: 'Up', ic: 'clock' });
  for (const a of f.anchors) rows.push({ at: a.fromM, ord: 1, kind: 'anchor', a });
  for (const b of f.busy) rows.push({ at: b.fromM, ord: 1, kind: 'busy', b });
  for (const b of f.blocks) rows.push({ at: b.from, ord: 2, kind: 'block', b });
  for (const sl of f.slots) {
    if (sl.to - sl.at >= 15) rows.push({ at: sl.at, ord: 3, kind: 'free', sl });
  }
  for (const t of doc.plan.tasks) {
    if (t.status === 'done' && t.doneOn === today) {
      const d = new Date(t.doneAt || Date.now());
      rows.push({ at: d.getHours() * 60 + d.getMinutes(), ord: 2, kind: 'done', t });
    }
  }
  if (sch.active) {
    const t = plan.task(doc, sch.active);
    const d = new Date(doc.activeFocus.startedAt);
    if (t) rows.push({ at: d.getHours() * 60 + d.getMinutes(), ord: 2, kind: 'active', t });
  }
  rows.push({ at: end, ord: 4, kind: 'mark', label: 'Lights out', ic: 'lock' });
  if (now >= f.wake && now < end) rows.push({ at: Math.floor(now), ord: -1, kind: 'now' });
  rows.sort((a, b) => (a.at - b.at) || (a.ord - b.ord));

  const firstBlock = f.blocks[0];
  const ctx = { doc, f, now, today, day, firstBlock, active: !!(doc.activeFocus && !doc.activeFocus.finished) };
  const empty = !doc.plan.tasks.some(t => t.status === 'open');

  return html`
    <div class="panel block">
      <div class="panel-h"><h3>The day</h3>
        ${f.blocks.length ? html`<span class="chip live">${durFmt(f.blocks.reduce((a, b) => a + b.min, 0))} planned</span>` : ''}
      </div>
      ${empty ? html`<div class="hint" style="margin-bottom:6px">Nothing to plan yet. Add a task — two taps and a length — and it finds the time.</div>` : ''}
      <ul class="plan-tl">${rows.map(r => row(r, ctx))}</ul>
    </div>`;
}

const qtag = q => html`<span class="qtag q${q}">${plan.QUAD[q].tag}</span>`;

function row(r, c) {
  const past = to => to <= c.now;
  switch (r.kind) {
    case 'now':
      return html`<li class="pl-now"><span>Now · ${fmtTime(r.at)}</span></li>`;

    case 'mark':
      return html`
        <li class="pl-row mark ${past(r.at + 1) ? 'past' : ''}">
          <span class="pl-time"><b>${fmtTime(r.at)}</b></span>
          <span class="pl-dot">${icon(r.ic)}</span>
          <div class="pl-main"><div class="t">${r.label}</div></div>
        </li>`;

    case 'anchor': {
      const a = r.a;
      const k = plan.KIND[a.kind];
      const on = a.fromM <= c.now && a.toM > c.now;
      const missed = c.day.missed?.includes(a.id);
      let meta = `${durFmt(a.toM - a.fromM)} · ${k.say}`;
      if (c.f.half && a.kind === 'deep') meta = '45 minutes counts today';
      if (c.f.half && a.kind === 'train') meta = 'The short version today';
      const done = a.kind === 'deep' && plan.deepDone(c.doc, a, c.today);
      const canStart = a.kind === 'deep' && !c.active && !done && a.toM > c.now && a.fromM - c.now <= 30;
      if (done) meta = 'Done today';
      return html`
        <li class="pl-row anchor k-${a.kind} ${past(a.toM) ? 'past' : ''} ${on ? 'now' : ''}">
          <span class="pl-time"><b>${fmtTime(a.fromM)}</b><i>${fmtTime(a.toM)}</i></span>
          <span class="pl-dot">${icon(k.icon)}</span>
          <div class="pl-main">
            <div class="t">${a.name}${missed ? html` <span class="chip bad">missed</span>` : ''}</div>
            <div class="m">${meta}</div>
          </div>
          ${canStart ? html`<button class="btn s primary" data-act="planDeep" aria-label="Start ${a.name}">${icon('play')}</button>` : ''}
        </li>`;
    }

    case 'busy':
      return html`
        <li class="pl-row anchor busy">
          <span class="pl-time"><b>${fmtTime(r.b.fromM)}</b><i>${fmtTime(r.b.toM)}</i></span>
          <span class="pl-dot">${icon('bell')}</span>
          <div class="pl-main"><div class="t">${r.b.label || 'Busy'}</div><div class="m">Something came up</div></div>
        </li>`;

    case 'block': {
      const b = r.b;
      const t = b.task;
      const isNow = b.from - c.now <= 5;
      const first = c.firstBlock === b && !c.active;
      const bits = [durFmt(b.min)];
      if (b.parts > 1) bits.push(`part ${b.part} of ${b.parts}`);
      if (b.deep) bits.push('in the deep block');
      if (t.deadline) bits.push(`due ${relDate(t.deadline, c.today).toLowerCase()}`);
      return html`
        <li class="pl-row task q${b.q} ${isNow ? 'now' : ''}">
          <span class="pl-time"><b>${isNow ? 'Now' : fmtTime(b.from)}</b><i>${fmtTime(b.to)}</i></span>
          <button class="tickbox" role="checkbox" aria-checked="false" data-act="planDone" data-task="${t.id}" aria-label="Done">${icon('check')}</button>
          <button class="pl-main" data-act="planOpen" data-task="${t.id}">
            <div class="t">${t.title}</div>
            <div class="m">${qtag(b.q)} ${bits.join(' · ')}</div>
          </button>
          ${first ? html`<button class="btn s primary" data-act="planStart" data-task="${t.id}" aria-label="Start">${icon('play')}</button>` : ''}
        </li>`;
    }

    case 'active':
      return html`
        <li class="pl-row task now q${plan.quadrant(r.t)}">
          <span class="pl-time"><b>${fmtTime(r.at)}</b></span>
          <span class="pl-dot live">${icon('focus')}</span>
          <button class="pl-main" data-nav="focus">
            <div class="t">${r.t.title}</div>
            <div class="m">In progress on the timer</div>
          </button>
        </li>`;

    case 'done':
      return html`
        <li class="pl-row task is-done">
          <span class="pl-time"><b>${fmtTime(r.at)}</b></span>
          <button class="tickbox" role="checkbox" aria-checked="true" data-act="planDone" data-task="${r.t.id}" aria-label="Not done">${icon('check')}</button>
          <button class="pl-main" data-act="planOpen" data-task="${r.t.id}">
            <div class="t">${r.t.title}</div>
            <div class="m">Done</div>
          </button>
        </li>`;

    case 'free': {
      const sl = r.sl;
      const f = c.f;
      const full = sl.light
        ? f.used.light >= f.caps.light
        : f.used.heavy >= f.caps.heavy && f.used.light >= f.caps.light;
      return html`
        <li class="pl-row free">
          <span class="pl-time"><b>${fmtTime(sl.at)}</b></span>
          <span class="pl-dot"></span>
          <div class="pl-main"><div class="m">
            Free · ${durFmt(sl.to - sl.at)}${full ? ' · kept as slack' : sl.light ? ' · light work only' : ''}
          </div></div>
        </li>`;
    }
  }
  return '';
}

/* ---------- the rest of the week ---------- */
function comingPanel(sch) {
  const days = sch.frames.slice(1).filter(f => f.blocks.length);
  if (!days.length) return '';
  return html`
    <div class="panel block">
      <div class="panel-h"><h3>Coming up</h3></div>
      ${days.map(f => html`
        <div class="rulehead">${relDate(f.date, sch.today)}${f.rest ? ' · rest day' : ''}</div>
        <ul class="plan-tl mini">
          ${f.blocks.map(b => html`
            <li class="pl-row task q${b.q}">
              <span class="pl-time"><b>${fmtTime(b.from)}</b></span>
              <button class="pl-main" data-act="planOpen" data-task="${b.task.id}">
                <div class="t">${b.task.title}</div>
                <div class="m">${qtag(b.q)} ${durFmt(b.min)}${b.parts > 1 ? ` · part ${b.part} of ${b.parts}` : ''}</div>
              </button>
            </li>`)}
        </ul>`)}
    </div>`;
}

function parkedPanel(sch) {
  if (!sch.parked.length) return '';
  return html`
    <div class="panel block">
      <div class="panel-h"><h3>Parked</h3><span class="chip">Q4 · not planned</span></div>
      <ul class="plan-tl mini">
        ${sch.parked.map(({ task: t, daysLeft }) => html`
          <li class="pl-row task q4">
            <span class="pl-time"><b>${daysLeft}d</b></span>
            <button class="pl-main" data-act="planOpen" data-task="${t.id}">
              <div class="t">${t.title}</div>
              <div class="m">${daysLeft ? `Dropped in ${plural(daysLeft, 'day')} unless it becomes important` : 'Dropped tonight'}</div>
            </button>
          </li>`)}
      </ul>
    </div>`;
}

/* ---------- the task form ----------
   Two answers and a length. The matrix is there to be tapped, not read:
   a tap on a square answers both questions at once. */
function yesNo(name, label, on) {
  return html`<div class="field">
    <span class="lbl">${label}</span>
    <div class="seg" data-seg="${name}">
      <button type="button" data-val="0" aria-pressed="${on ? 'false' : 'true'}">No</button>
      <button type="button" data-val="1" aria-pressed="${on ? 'true' : 'false'}">Yes</button>
    </div>
  </div>`;
}

function taskSheet(app, t = null) {
  const today = ds();
  const v = t || { title: '', urgent: false, important: true, min: 30, deadline: null };
  const dueMode = !v.deadline ? 'none' : v.deadline === today ? 'today' : v.deadline === addDays(today, 1) ? 'tomorrow' : 'date';
  const mins = [...new Set([...DURATIONS, v.min])].sort((a, b) => a - b);

  openSheet({
    title: t ? 'Edit task' : 'New task',
    sub: t ? '' : 'Two answers and a length. The time is found for you.',
    body: html`
      ${field('title', 'What is it?', v.title, { placeholder: 'Physiology assignment', attrs: 'maxlength="120" autocomplete="off" enterkeyhint="done"' })}
      <div class="g2">
        ${yesNo('urgent', 'Urgent?', v.urgent)}
        ${yesNo('important', 'Important?', v.important)}
      </div>
      <div class="qgrid" id="qgrid" aria-label="Eisenhower matrix">
        ${[1, 2, 3, 4].map(q => html`
          <button type="button" class="qcell q${q}" data-q="${q}">
            <b>${plan.QUAD[q].tag}</b><span>${plan.QUAD[q].name}</span>
          </button>`)}
        <span class="qax qx">urgent ← → not urgent</span>
      </div>
      <div class="note live" id="qsay"></div>
      <div class="field mt">
        <span class="lbl">How long?</span>
        <div class="quickrow" id="minPick">
          ${mins.map(m => html`<button type="button" data-min="${m}" aria-pressed="${m === v.min ? 'true' : 'false'}">${m < 60 ? m + 'm' : durFmt(m)}</button>`)}
        </div>
        <input type="hidden" name="min" value="${v.min}">
      </div>
      <div class="field">
        <span class="lbl">Deadline</span>
        <div class="seg" data-seg="due">
          ${[['none', 'None'], ['today', 'Today'], ['tomorrow', 'Tomorrow'], ['date', 'A day']].map(([k, l]) => html`
            <button type="button" data-val="${k}" aria-pressed="${k === dueMode ? 'true' : 'false'}">${l}</button>`)}
        </div>
        <input class="in mt" type="date" name="dueDate" value="${v.deadline || ''}" min="${today}" ${dueMode === 'date' ? '' : raw('hidden')}>
      </div>`,
    footer: html`
      <button class="btn quiet" data-sheet-close>Cancel</button>
      <button class="btn primary" data-act="planSave" ${t ? raw(`data-task="${t.id}"`) : ''}>${t ? 'Save' : 'Plan it'}</button>`,
    onMount(root) {
      const say = $('#qsay', root);
      const cells = $$('.qcell', root);
      const dateIn = root.querySelector('[name="dueDate"]');
      const pick = (seg, val) => {
        for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.val === val));
      };
      const paint = () => {
        const f = readForm(root);
        const q = plan.quadOf(f.urgent === '1', f.important === '1');
        for (const c of cells) c.setAttribute('aria-pressed', String(Number(c.dataset.q) === q));
        const deadline = dueOf(f, today);
        const auto = f.urgent !== '1' && deadline && daysBetween(today, deadline) <= 1;
        const eff = auto ? plan.quadOf(true, f.important === '1') : q;
        say.textContent = `${plan.QUAD[eff].tag} · ${plan.QUAD[eff].name}. ${plan.QUAD[eff].where}`
          + (auto ? ' Its deadline makes it urgent anyway.' : '');
        if (dateIn) dateIn.hidden = f.due !== 'date';
      };
      root.addEventListener('click', e => {
        const segBtn = e.target.closest('[data-seg] button');
        if (segBtn) { pick(segBtn.parentElement, segBtn.dataset.val); buzz(6); paint(); return; }
        const cell = e.target.closest('.qcell');
        if (cell) {
          const q = Number(cell.dataset.q);
          pick(root.querySelector('[data-seg="urgent"]'), q === 1 || q === 3 ? '1' : '0');
          pick(root.querySelector('[data-seg="important"]'), q === 1 || q === 2 ? '1' : '0');
          buzz(8); paint(); return;
        }
        const m = e.target.closest('[data-min]');
        if (m) {
          for (const b of root.querySelectorAll('[data-min]')) b.setAttribute('aria-pressed', String(b === m));
          root.querySelector('[name="min"]').value = m.dataset.min;
          buzz(6);
        }
      });
      dateIn?.addEventListener('change', paint);
      root.querySelector('[name="title"]')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
      });
      paint();
      if (!t) setTimeout(() => root.querySelector('[name="title"]')?.focus(), 280);
    },
  });
}

function dueOf(f, today) {
  if (f.due === 'today') return today;
  if (f.due === 'tomorrow') return addDays(today, 1);
  if (f.due === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(f.dueDate || '')) return f.dueDate;
  return null;
}

/** Where a task ended up, said as a sentence. */
function whereSay(doc, t) {
  const today = ds();
  if (t.status === 'done') return 'Done.';
  if (t.status === 'dropped') return 'Dropped.';
  const q = plan.quadrant(t, today);
  if (q === 4) return 'Parked. Not planned — it is dropped after a week unless it becomes important.';
  const sch = plan.schedule(doc);
  const blocks = sch.byTask.get(t.id) || [];
  if (!blocks.length) {
    if (sch.active === t.id) return 'On the timer now.';
    return 'Not placed. It does not fit anywhere in the next week inside your limits.';
  }
  const parts = blocks.slice(0, 3).map(b => `${relDate(b.date, today)} ${fmtTime(b.from)}–${fmtTime(b.to)}`);
  return `Planned: ${parts.join(', ')}${blocks.length > 3 ? ` and ${plural(blocks.length - 3, 'more block')}` : ''}.`;
}

/* ---------- settings ---------- */
function daysSay(days) {
  const d = [...days].sort().join(',');
  if (d === '1,2,3,4,5') return 'Weekdays';
  if (d === '0,1,2,3,4,5,6') return 'Every day';
  if (d === '0,6') return 'Weekends';
  if (!days.length) return 'No days';
  return [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(x => DOW_S[x]).join(' ');
}

function dayPicker(name, days) {
  /* Monday first, the way a week is lived. */
  const order = [1, 2, 3, 4, 5, 6, 0];
  return html`<div class="seg days" data-days="${name}">
    ${order.map(d => html`<button type="button" data-dow="${d}" aria-pressed="${days.includes(d) ? 'true' : 'false'}" aria-label="${DOW_S[d]}">${DOW_XS[d]}</button>`)}
  </div>`;
}
const readDays = (root, name) => $$(`[data-days="${name}"] [aria-pressed="true"]`, root).map(b => Number(b.dataset.dow));
function wireDays(root) {
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-days] button');
    if (!b) return;
    b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
    buzz(6);
  });
}

function settingsSheet(app) {
  const s = app.doc.settings.plan;
  const anchors = s.anchors.slice().sort((a, b) => toMin(a.from) - toMin(b.from));
  openSheet({
    title: 'Your day',
    sub: 'What does not move, and how much a day can take.',
    body: html`
      <div class="g2">
        ${field('wakeWeekday', 'Up, weekdays', s.wakeWeekday, { type: 'time' })}
        ${field('wakeWeekend', 'Up, weekends', s.wakeWeekend, { type: 'time' })}
      </div>
      <div class="g2">
        ${field('bedAt', 'Lights out', s.bedAt, { type: 'time' })}
        ${field('lightFrom', 'Light work only from', s.lightFrom, { type: 'time' })}
      </div>
      <div class="hint">The first fifteen minutes after waking are never planned.</div>

      <div class="rulehead">What a day can take</div>
      ${slider('heavyWeekday', 'Hard work, weekdays', s.heavyWeekday, { min: 0, max: 180, step: 15, unit: 'min' })}
      ${slider('heavyWeekend', 'Hard work, weekends', s.heavyWeekend, { min: 0, max: 240, step: 15, unit: 'min' })}
      ${slider('lightMax', 'Light work, any day', s.lightMax, { min: 0, max: 240, step: 15, unit: 'min', cls: 'rest' })}
      <div class="hint">On top of the anchors. Hard work is anything important that takes half an hour or more.</div>
      <div class="field mt">
        <span class="lbl">Rest days</span>
        ${dayPicker('restDays', s.restDays)}
        <span class="hint">Nothing is planned on these unless a deadline forces it.</span>
      </div>

      <div class="rulehead">Anchors</div>
      <div>
        ${anchors.map(a => html`
          <button class="setrow" data-act="planAnchor" data-anchor="${a.id}">
            <span class="p">${icon(plan.KIND[a.kind].icon)}</span>
            <span class="grow"><b>${a.name}</b><i>${daysSay(a.days)} · ${fmtTime(a.from)}–${fmtTime(a.to)} · ${plan.KIND[a.kind].label}</i></span>
            <span class="chev">${icon('chev')}</span>
          </button>`)}
      </div>
      <button class="btn quiet full mt" data-act="planAnchor">${icon('plus')} Add an anchor</button>
      <button class="btn s quiet full mt" data-act="planResetAnchors">${icon('undo')} Back to the one-page plan</button>`,
    footer: html`<button class="btn primary" data-act="planSettingsSave">Done</button>`,
    onMount(root) { wireSliders(root); wireDays(root); },
  });
}

/* Settings are kept whenever the sheet is left for another one, so a
   change is never lost to opening an anchor. */
function keepSettings(app) {
  const root = $('#sheet');
  if (!root || !root.querySelector('[name="wakeWeekday"]')) return;
  const f = readForm(root);
  const s = app.doc.settings.plan;
  const t = (v, fb) => (/^\d{2}:\d{2}$/.test(v || '') ? v : fb);
  s.wakeWeekday = t(f.wakeWeekday, s.wakeWeekday);
  s.wakeWeekend = t(f.wakeWeekend, s.wakeWeekend);
  s.bedAt = t(f.bedAt, s.bedAt);
  s.lightFrom = t(f.lightFrom, s.lightFrom);
  s.heavyWeekday = clamp(Number(f.heavyWeekday) || 0, 0, 480);
  s.heavyWeekend = clamp(Number(f.heavyWeekend) || 0, 0, 480);
  s.lightMax = clamp(Number(f.lightMax) || 0, 0, 480);
  s.restDays = readDays(root, 'restDays');
}

function anchorSheet(app, a) {
  const v = a || { name: '', from: '09:00', to: '10:00', days: [1, 2, 3, 4, 5], kind: 'fixed', note: '' };
  openSheet({
    title: a ? a.name : 'New anchor',
    sub: 'Something that happens at the same time whether or not you plan it.',
    body: html`
      ${field('name', 'Name', v.name, { placeholder: 'Lab', attrs: 'maxlength="60"' })}
      <div class="g2">
        ${field('from', 'From', v.from, { type: 'time' })}
        ${field('to', 'To', v.to, { type: 'time' })}
      </div>
      <div class="field"><span class="lbl">Days</span>${dayPicker('days', v.days)}</div>
      ${select('kind', 'What kind', v.kind, Object.entries(plan.KIND).map(([k, x]) => [k, `${x.label} — ${x.say.toLowerCase()}`]))}
      ${field('note', 'Note', v.note, { placeholder: 'optional — shown on the timeline' })}`,
    footer: html`
      ${a ? html`<button class="btn danger thin" data-act="planAnchorDel" data-anchor="${a.id}" aria-label="Delete">${icon('trash')}</button>` : ''}
      <button class="btn quiet" data-act="planSettings">Back</button>
      <button class="btn primary" data-act="planAnchorSave" ${a ? raw(`data-anchor="${a.id}"`) : ''}>Save</button>`,
    onMount(root) { wireDays(root); },
  });
}

/* ---------- my day changed ---------- */
function changedSheet(app) {
  const today = ds();
  const d = app.doc.plan.days[today] || { half: false, busy: [], missed: [] };
  openSheet({
    title: 'My day changed',
    sub: 'Say what happened. The rest of the day re-plans itself.',
    body: html`
      <button class="setrow" data-act="planBusyForm">
        <span class="p">${icon('bell')}</span>
        <span class="grow"><b>Something came up</b><i>Block out time from now. Anything planned there moves.</i></span>
        <span class="chev">${icon('chev')}</span>
      </button>
      <button class="setrow" data-act="planHalf">
        <span class="p">${icon('heart')}</span>
        <span class="grow"><b>${d.half ? 'Back to a full day' : 'Low energy — half-size day'}</b>
          <i>${d.half ? 'Half-size is on for today.' : 'Only urgent-and-important today, half the limits. A bad day at half size still counts.'}</i></span>
      </button>
      <button class="setrow" data-act="planMissedForm">
        <span class="p">${icon('flame')}</span>
        <span class="grow"><b>I missed an anchor</b><i>Tomorrow keeps it and carries less. Never miss twice.</i></span>
        <span class="chev">${icon('chev')}</span>
      </button>`,
  });
}

function busySheet(app) {
  const now = Math.ceil(nowMin() / 5) * 5;
  openSheet({
    title: 'Something came up',
    body: html`
      ${field('label', 'What', '', { placeholder: 'optional — errand, visitor, travel' })}
      <div class="g2">
        ${field('from', 'From', toHHMM(now), { type: 'time' })}
        ${field('to', 'Until', toHHMM(Math.min(1435, Math.ceil((now + 60) / 15) * 15)), { type: 'time' })}
      </div>`,
    footer: html`<button class="btn quiet" data-act="planChanged">Back</button>
      <button class="btn primary" data-act="planBusySave">Block it out</button>`,
  });
}

function missedSheet(app) {
  const today = ds();
  const d = app.doc.plan.days[today] || { missed: [] };
  /* The anchors worth a streak: the deep block and training. Missing lunch
     is not a thing to carry into tomorrow. */
  const anchors = plan.anchorsOn(app.doc, today).filter(a => a.kind === 'deep' || a.kind === 'train');
  openSheet({
    title: 'Missed today',
    sub: 'Tap what did not happen. Tomorrow keeps its hard-work limit low so there is energy for it.',
    body: anchors.length
      ? html`<div class="wrap">${anchors.map(a => html`
          <button type="button" class="chip tap ${d.missed.includes(a.id) ? 'bad' : ''}" data-act="planMissToggle" data-anchor="${a.id}">
            ${a.name} · ${fmtTime(a.fromM)}
          </button>`)}</div>`
      : html`<div class="empty"><b>No anchors today</b>Nothing to miss.</div>`,
    footer: html`<button class="btn primary" data-sheet-close>Done</button>`,
  });
}

/* ---------- actions ---------- */
const again = (fn, ...a) => { closeSheet(); setTimeout(() => fn(...a), 80); };
const byEl = (app, el) => plan.task(app.doc, el?.dataset?.task);
const redo = app => { app.save(); app.render(); app.refreshChrome(); };

export const planActions = {
  focusPane(app, el) {
    app.doc.settings.plan.pane = el.dataset.val === 'timer' ? 'timer' : 'plan';
    buzz(6);
    app.save(); app.render(); app.refreshChrome();
  },

  planAdd(app) { again(taskSheet, app); },
  planEdit(app, el) { const t = byEl(app, el); if (t) again(taskSheet, app, t); },

  planSave(app, el) {
    const root = $('#sheet');
    const f = readForm(root);
    const title = String(f.title || '').trim();
    if (!title) { toast('Give it a name first'); root.querySelector('[name="title"]')?.focus(); return; }
    const today = ds();
    const vals = {
      title,
      urgent: f.urgent === '1',
      important: f.important === '1',
      min: Number(f.min) || 30,
      deadline: dueOf(f, today),
    };
    let t = byEl(app, el);
    if (t) {
      Object.assign(t, vals, { title: vals.title.slice(0, 120), min: clamp(Math.round(vals.min), 5, 960) });
      if (t.doneMin >= t.min && t.status === 'open') t.doneMin = Math.max(0, t.min - 5);
    } else {
      t = plan.newTask(vals);
      app.doc.plan.tasks.push(t);
    }
    closeSheet();
    redo(app);
    sfx.ok(); buzz(12);
    toast(whereSay(app.doc, t), { ms: 3600 });
  },

  planOpen(app, el) {
    const t = byEl(app, el);
    if (!t) return;
    const doc = app.doc;
    const today = ds();
    const q = plan.quadrant(t, today);
    const open = t.status === 'open';
    const left = plan.remaining(t);
    const deep = plan.anchorsOn(doc, today).find(a => a.kind === 'deep' && a.toM > nowMin());
    const r = (act, ic, b, i, extra = '') => html`
      <button class="setrow" data-act="${act}" data-task="${t.id}" ${raw(extra)}>
        <span class="p">${icon(ic)}</span>
        <span class="grow"><b>${b}</b>${i ? html`<i>${i}</i>` : ''}</span>
      </button>`;

    again(openSheet, {
      title: t.title,
      sub: `${plan.QUAD[q].tag} · ${plan.QUAD[q].say}${plan.autoUrgent(t, today) ? ' (by its deadline)' : ''}`,
      body: html`
        <div class="wrap">
          ${qtag(q)}
          <span class="chip">${t.doneMin && open ? `${durFmt(left)} left of ${durFmt(t.min)}` : durFmt(t.min)}</span>
          ${t.deadline ? html`<span class="chip ${daysBetween(today, t.deadline) <= 1 ? 'warn' : ''}">due ${relDate(t.deadline, today).toLowerCase()}</span>` : ''}
          ${t.carried ? html`<span class="chip">moved ${plural(t.carried, 'time')}</span>` : ''}
        </div>
        <div class="note ${open && q !== 4 ? 'good' : ''} mt">${whereSay(doc, t)}</div>
        <div class="mt">
          ${open && q !== 4 ? r('planStart', 'play', 'Start now', 'Opens the timer on it') : ''}
          ${r('planDone', 'check', open ? 'Mark it done' : 'Not done after all', '')}
          ${open && left > 15 ? r('planShrink', 'minus', 'Take 15 minutes off', `${durFmt(left - 15)} left after`, 'data-by="15"') : ''}
          ${open && left >= 30 ? r('planShrink', 'minus', 'Halve it', `Do the half that matters · ${durFmt(Math.round(left / 2 / 5) * 5)}`, 'data-half="1"') : ''}
          ${open && q !== 4 ? (t.after && t.after > today
            ? r('planNotLater', 'undo', 'Allow it today again', '')
            : r('planLater', 'arrow', 'Not today', 'Plans it from tomorrow')) : ''}
          ${open && q === 1 && deep ? r('planUseDeep', 'focus', t.useDeep === today ? 'Give the deep block back' : `Use today's ${deep.name.toLowerCase()} block`,
            t.useDeep === today ? '' : `${fmtTime(deep.fromM)}–${fmtTime(deep.toM)}. Only for urgent study that cannot wait.`) : ''}
          ${r('planEdit', 'edit', 'Edit', 'Name, quadrant, length, deadline')}
        </div>`,
      footer: html`
        <button class="btn danger thin" data-act="planDrop" data-task="${t.id}" aria-label="Drop">${icon('trash')}</button>
        <button class="btn primary" data-sheet-close>Close</button>`,
    });
  },

  planStart(app, el) {
    const t = byEl(app, el);
    if (!t) return;
    closeSheet();
    app.go('focus', `task-${t.id}`);
  },

  planDeep(app) {
    closeSheet();
    app.go('focus', 'deep');
  },

  planDone(app, el) {
    const t = byEl(app, el);
    if (!t) return;
    const done = t.status !== 'done';
    plan.markDone(app.doc, t, done);
    closeSheet();
    if (done) { sfx.ok(); buzz([12, 40, 12]); } else { sfx.undo(); buzz(8); }
    redo(app);
    toast(done ? `Done: ${t.title}` : 'Back on the plan', done ? { action: 'Undo', onAction: () => { plan.markDone(app.doc, t, false); redo(app); } } : {});
  },

  planShrink(app, el) {
    const t = byEl(app, el);
    if (!t) return;
    const left = plan.remaining(t);
    const cut = el.dataset.half ? Math.round(left / 2 / 5) * 5 : Number(el.dataset.by) || 15;
    const nextLeft = Math.max(5, left - cut);
    t.min = t.doneMin + nextLeft;
    t.carried = 0;
    closeSheet(); buzz(8);
    redo(app);
    toast(`${durFmt(nextLeft)} now. ${whereSay(app.doc, t)}`, { ms: 3600 });
  },

  planLater(app, el) {
    const t = byEl(app, el);
    if (!t) return;
    t.after = addDays(ds(), 1);
    t.pinned = null;
    closeSheet(); buzz(8);
    redo(app);
    toast(whereSay(app.doc, t), { ms: 3600 });
  },

  planNotLater(app, el) {
    const t = byEl(app, el);
    if (!t) return;
    t.after = null;
    closeSheet(); redo(app);
    toast(whereSay(app.doc, t), { ms: 3600 });
  },

  /* "Do it" on a task that keeps moving: it goes to the front of today,
     and the count starts again because you have decided. */
  planPin(app, el) {
    const t = byEl(app, el);
    if (!t) return;
    t.pinned = ds();
    t.after = null;
    t.carried = 0;
    buzz(10); redo(app);
    toast(whereSay(app.doc, t), { ms: 3600 });
  },

  planStretch(app, el) {
    const t = byEl(app, el);
    if (!t) return;
    t.stretch = ds();
    t.after = null;
    buzz(10); redo(app);
    toast(`Over the limit for this one, today only. ${whereSay(app.doc, t)}`, { ms: 4200 });
  },

  planUseDeep(app, el) {
    const t = byEl(app, el);
    if (!t) return;
    const today = ds();
    t.useDeep = t.useDeep === today ? null : today;
    closeSheet(); buzz(10); redo(app);
    toast(whereSay(app.doc, t), { ms: 3600 });
  },

  planDrop(app, el) {
    const t = byEl(app, el);
    if (!t) return;
    closeSheet();
    const was = t.status;
    t.status = 'dropped';
    t.doneOn = ds();
    sfx.undo(); buzz(8);
    redo(app);
    toast('Dropped. Not doing it is a decision too.', {
      action: 'Undo',
      onAction: () => { t.status = was; t.doneOn = null; redo(app); },
    });
  },

  /* ---------- the day changing ---------- */
  planChanged(app) { again(changedSheet, app); },
  planBusyForm(app) { again(busySheet, app); },
  planMissedForm(app) { again(missedSheet, app); },

  planBusySave(app) {
    const f = readForm($('#sheet'));
    const from = toMin(f.from), to = toMin(f.to);
    if (!(to > from)) { toast('The end has to come after the start'); return; }
    plan.dayOf(app.doc, ds()).busy.push({
      id: 'bz' + Date.now().toString(36),
      from: toHHMM(from), to: toHHMM(to),
      label: String(f.label || '').trim().slice(0, 60),
    });
    closeSheet(); buzz(10); redo(app);
    toast(`Blocked out until ${fmtTime(to)}. The rest of the day moved around it.`, { ms: 3600 });
  },

  planBusyDel(app, el) {
    const d = plan.dayOf(app.doc, ds());
    d.busy = d.busy.filter(b => b.id !== el.dataset.id);
    buzz(8); redo(app);
  },

  planHalf(app) {
    const d = plan.dayOf(app.doc, ds());
    d.half = !d.half;
    closeSheet(); buzz(10); redo(app);
    toast(d.half ? 'Half-size day. Showing up at half size still counts.' : 'Back to a full day');
  },

  planMissToggle(app, el) {
    const d = plan.dayOf(app.doc, ds());
    const id = el.dataset.anchor;
    d.missed = d.missed.includes(id) ? d.missed.filter(x => x !== id) : [...d.missed, id];
    el.classList.toggle('bad', d.missed.includes(id));
    buzz(8);
    app.save(); app.render();
  },

  /* ---------- settings ---------- */
  planSettings(app) { again(settingsSheet, app); },

  planSettingsSave(app) {
    keepSettings(app);
    closeSheet(); redo(app);
  },

  planAnchor(app, el) {
    keepSettings(app);
    app.save();
    const a = app.doc.settings.plan.anchors.find(x => x.id === el?.dataset?.anchor) || null;
    again(anchorSheet, app, a);
  },

  planAnchorSave(app, el) {
    const root = $('#sheet');
    const f = readForm(root);
    const name = String(f.name || '').trim();
    if (!name) { toast('Give it a name'); return; }
    if (!(toMin(f.to) > toMin(f.from))) { toast('The end has to come after the start'); return; }
    const days = readDays(root, 'days');
    if (!days.length) { toast('Pick at least one day'); return; }
    const s = app.doc.settings.plan;
    const vals = { name: name.slice(0, 60), from: f.from, to: f.to, days, kind: plan.KIND[f.kind] ? f.kind : 'fixed', note: String(f.note || '').slice(0, 200) };
    const a = s.anchors.find(x => x.id === el?.dataset?.anchor);
    if (a) Object.assign(a, vals);
    else s.anchors.push({ id: 'an' + Date.now().toString(36), ...vals });
    buzz(10); app.save(); app.render();
    again(settingsSheet, app);
  },

  planAnchorDel(app, el) {
    const s = app.doc.settings.plan;
    const a = s.anchors.find(x => x.id === el.dataset.anchor);
    if (!a) return;
    closeSheet();
    setTimeout(() => confirmSheet({
      title: `Delete “${a.name}”?`,
      body: 'Its time becomes free for the planner.',
      onYes() {
        s.anchors = s.anchors.filter(x => x.id !== a.id);
        redo(app);
        setTimeout(() => settingsSheet(app), 120);
      },
    }), 80);
  },

  planResetAnchors(app) {
    closeSheet();
    setTimeout(() => confirmSheet({
      title: 'Back to the one-page plan?',
      body: 'Every anchor goes back to how it started. Your tasks are not touched.',
      confirmLabel: 'Reset anchors',
      onYes() {
        app.doc.settings.plan.anchors = plan.seedAnchors();
        redo(app);
        setTimeout(() => settingsSheet(app), 120);
      },
    }), 80);
  },
};
