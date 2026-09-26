/* ============================================================
   views/money.js — pocket money

   One question at the top of the screen — **can I spend this?** —
   answered by one number, and a pie underneath that answers the only
   other one worth asking: where did it actually go.

   The pie is a donut rather than a disc because the middle is the best
   place on the whole screen to put the total, and a disc wastes it on a
   point nobody can read an angle from anyway. Slices are capped at six
   and the tail is folded into one, because a pie with eleven wedges
   answers nothing.
   ============================================================ */

import { html, icon, $, ds, pd, niceDate, plural, clamp, round, DOW_XS, dowOf } from '../util.js';
import * as money from '../money.js';
import { ensureCat } from '../state.js';
import {
  openSheet, closeSheet, confirmSheet, toast, buzz, sfx, sparkleFrom,
  field, area, select, readForm, slider, wireSliders,
} from '../ui.js';

export default {
  id: 'money',

  topbar(app) {
    const st = money.status(app.doc);
    return {
      title: 'Money',
      sub: st.allowance
        ? `${money.fmt(app.doc, Math.max(0, st.left))} left · ${plural(st.daysLeft, 'day')}`
        : 'No allowance set',
      actions: html`<button class="iconbtn" data-act="moneySettings" aria-label="Money settings">${icon('sliders')}</button>`,
    };
  },

  render(app) {
    const doc = app.doc;
    const st = money.status(doc);
    const pie = money.byCategory(doc, st.from, st.to);
    const today = money.entriesOn(doc, ds());

    return html`
      ${leftPanel(doc, st)}
      ${addRow(doc)}
      ${piePanel(doc, st, pie)}
      ${dayBars(doc, st)}
      ${todayPanel(doc, today)}
      ${recentPanel(doc, st)}
    `;
  },

  mount(app) {
    if (app.param === 'add') {
      app.param = '';
      setTimeout(() => openSpend(app), 80);
    }
  },

  actions: {
    /* ---------- logging ---------- */
    addSpend(app) { openSpend(app); },

    quickCat(app, el) { openSpend(app, el.dataset.cat); },

    saveSpend(app) {
      const f = readForm($('#sheet'));
      const amount = Math.round((Number(f.amount) || 0) * 100) / 100;
      if (amount <= 0) { toast('Put a number in'); return; }
      const cat = f.cat === NEW_CAT ? ensureCat(app.doc, f.newCat?.trim() || 'Other') : f.cat;
      const entry = money.spend(app.doc, { amount, cat, note: f.note || '', date: f.date || ds() });
      if (!entry) { toast('Put a number in'); return; }

      const st = money.status(app.doc);
      buzz(12); sfx.tick();
      app.save(); closeSheet(); app.render();
      toast(st.over
        ? `${money.fmt(app.doc, amount)} logged. ${money.fmt(app.doc, -st.left)} over.`
        : `${money.fmt(app.doc, amount)} logged. ${money.fmt(app.doc, st.left)} left.`);
    },

    deleteEntry(app, el) {
      const gone = money.removeEntry(app.doc, el.dataset.entry);
      if (!gone) return;
      buzz(8);
      app.save(); app.render();
      toast(`${money.fmt(app.doc, gone.amount)} removed`, {
        action: 'Undo',
        onAction() { app.doc.money.entries.unshift(gone); app.save(); app.render(); },
      });
    },

    openSlice(app, el) {
      const doc = app.doc;
      const st = money.status(doc);
      const id = el.dataset.slice;
      const pie = money.byCategory(doc, st.from, st.to);
      const slice = pie.slices.find(s => s.id === id);
      if (!slice) return;

      const ids = slice.folded ? new Set(slice.folded.map(c => c.id)) : new Set([id]);
      const rows = money.entriesBetween(doc, st.from, st.to)
        .filter(e => ids.has(e.cat))
        .sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at);

      openSheet({
        title: slice.name,
        sub: `${money.fmt(doc, slice.total)} · ${Math.round(slice.pct * 100)}% of this ${doc.settings.money.period}`,
        body: rows.length
          ? html`<ul class="list mt">
              ${rows.slice(0, 80).map(e => html`
                <li>
                  <div class="body">
                    <div class="title">${money.fmt(doc, e.amount)}${e.note ? html` <span class="t3">${e.note}</span>` : ''}</div>
                    <div class="meta">${niceDate(e.date)}${slice.folded ? ` · ${catName(doc, e.cat)}` : ''}</div>
                  </div>
                  <button class="iconbtn" data-act="deleteEntry" data-entry="${e.id}" aria-label="Remove">${icon('x')}</button>
                </li>`)}
            </ul>`
          : html`<div class="empty"><b>Nothing here</b>No entries in this category yet.</div>`,
      });
    },

    /* ---------- settings ---------- */
    moneySettings(app) { openMoneySettings(app); },

    saveMoney(app) {
      const f = readForm($('#sheet'));
      const m = app.doc.settings.money;
      m.allowance = Math.max(0, Math.round((Number(f.allowance) || 0) * 100) / 100);
      m.period = f.period === 'week' ? 'week' : 'month';
      m.symbol = (f.symbol || '₹').trim().slice(0, 3) || '₹';
      m.startDay = m.period === 'week'
        ? clamp(Number(f.startDow) || 1, 0, 6)
        : clamp(Number(f.startDay) || 1, 1, 28);
      m.askAt = f.askAt || '21:00';
      app.save(); closeSheet(); app.render();
      toast('Saved');
    },

    toggleMoney(app, el) {
      const on = el.getAttribute('aria-checked') !== 'true';
      el.setAttribute('aria-checked', String(on));
      app.doc.settings.money.on = on;
      buzz(10);
      app.save();
    },

    editCats(app) {
      const doc = app.doc;
      closeSheet();
      setTimeout(() => openSheet({
        title: 'Categories',
        sub: 'Six is plenty. The pie folds anything past that into one slice.',
        body: html`
          <ul class="list mt">
            ${doc.money.cats.map(c => html`
              <li>
                <div class="body">
                  <div class="title"><i class="dhue" style="--h:${c.color}"></i>${c.name}</div>
                  <div class="meta">${plural(doc.money.entries.filter(e => e.cat === c.id).length, 'entry', 'entries')}</div>
                </div>
                <button class="iconbtn" data-act="deleteCat" data-cat="${c.id}" aria-label="Delete">${icon('trash')}</button>
              </li>`)}
          </ul>
          ${field('newCat', 'Add one', '', { placeholder: 'e.g. Laundry' })}`,
        footer: html`<button class="btn quiet" data-sheet-close>Done</button>
          <button class="btn primary" data-act="addCat">Add</button>`,
      }), 80);
    },

    addCat(app) {
      const f = readForm($('#sheet'));
      const name = f.newCat?.trim();
      if (!name) { toast('Name it'); return; }
      ensureCat(app.doc, name);
      app.save(); closeSheet(); app.render();
      toast(`"${name}" added`);
    },

    deleteCat(app, el) {
      const doc = app.doc;
      const c = doc.money.cats.find(x => x.id === el.dataset.cat);
      if (!c) return;
      if (doc.money.cats.length <= 1) { toast('Keep at least one'); return; }
      const n = doc.money.entries.filter(e => e.cat === c.id).length;
      closeSheet();
      setTimeout(() => confirmSheet({
        title: `Delete "${c.name}"?`,
        body: n
          ? `${plural(n, 'entry', 'entries')} move to Other. Nothing is lost from the total.`
          : 'It is empty.',
        onYes() {
          doc.money.cats = doc.money.cats.filter(x => x.id !== c.id);
          const other = ensureCat(doc, 'Other');
          for (const e of doc.money.entries) if (e.cat === c.id) e.cat = other;
          app.save(); app.render();
          toast('Deleted');
        },
      }), 80);
    },

    clearPeriod(app) {
      const doc = app.doc;
      const st = money.status(doc);
      closeSheet();
      setTimeout(() => confirmSheet({
        title: 'Clear this period?',
        body: `${plural(st.count, 'entry', 'entries')} from ${niceDate(st.from)} onwards are removed. Older ones are untouched.`,
        confirmLabel: 'Clear it',
        onYes() {
          const gone = money.entriesBetween(doc, st.from, st.to);
          const ids = new Set(gone.map(e => e.id));
          doc.money.entries = doc.money.entries.filter(e => !ids.has(e.id));
          app.save(); app.render();
          toast(`${plural(gone.length, 'entry', 'entries')} cleared`, {
            action: 'Undo',
            onAction() { doc.money.entries.push(...gone); app.save(); app.render(); },
          });
        },
      }), 100);
    },
  },
};

/* ---------- what is left ----------
   The one number the tab exists for, and under it the only derived
   figure that changes behaviour: what today is worth if the rest of the
   period is to survive. */
function leftPanel(doc, st) {
  if (!st.allowance) {
    return html`
      <div class="panel block">
        <div class="empty">
          <b>No allowance set</b>
          Put in what you get and how often, and this becomes one number you can act on.
        </div>
        <button class="btn primary full mt" data-act="moneySettings">${icon('wallet')} Set it up</button>
      </div>`;
  }

  const pct = Math.round(st.pct * 100);
  return html`
    <div class="panel block mcard">
      <div class="xs ${st.over ? 'bad' : 'hl'}">
        ${st.over ? 'Over' : 'Left to spend'} · ${plural(st.daysLeft, 'day')} to go
      </div>
      <div class="mbig ${st.over ? 'over' : ''}">${money.fmt(doc, Math.abs(st.left))}</div>
      <div class="sm t2">
        ${money.fmt(doc, st.spent)} of ${money.fmt(doc, st.allowance)} this ${doc.settings.money.period}
      </div>

      <div class="bar mt2 ${st.over ? 'bad' : st.ahead ? '' : 'ok'}">
        <i style="width:${Math.min(100, pct)}%"></i>
        ${!st.over ? html`<b class="bargoal" style="left:${Math.round((st.pace / st.allowance) * 100)}%"></b>` : ''}
      </div>

      <div class="hint" style="margin-top:10px">
        ${st.over
          ? `${money.fmt(doc, -st.left)} past the allowance with ${plural(st.daysLeft, 'day')} left. The next one lands ${niceDate(money.period(doc, ds()).to)}.`
          : st.ahead >= st.evenPerDay
            ? `Spending faster than even — ${money.fmt(doc, Math.round(st.ahead))} ahead of the mark. ${money.fmt(doc, Math.round(st.perDay))} a day from here.`
            : st.behind >= st.evenPerDay
              ? `${money.fmt(doc, Math.round(st.behind))} under the mark. ${money.fmt(doc, Math.round(st.perDay))} a day is still safe.`
              : `Level with the mark. ${money.fmt(doc, Math.round(st.perDay))} a day keeps it that way.`}
      </div>

      ${st.today ? html`
        <div class="wrap mt">
          <span class="chip">${money.fmt(doc, st.today)} today</span>
          <span class="chip">${plural(st.count, 'entry', 'entries')} this ${doc.settings.money.period}</span>
        </div>` : ''}
    </div>`;
}

/* One tap per category, because the amount is the only thing you
   actually have to think about. */
function addRow(doc) {
  const cats = doc.money.cats.slice(0, 6);
  return html`
    <div class="block">
      <button class="btn primary full tall" data-act="addSpend">${icon('plus')} Log a spend</button>
      <div class="catrow mt">
        ${cats.map(c => html`
          <button type="button" data-act="quickCat" data-cat="${c.id}" aria-label="${c.name}">
            <i class="dhue" style="--h:${c.color}"></i>${c.name}
          </button>`)}
      </div>
    </div>`;
}

/* ---------- the pie ----------
   One circle per slice, all the same circle, each with its own dash and
   offset. That keeps the markup to one element per category and lets
   the whole thing animate as a single object. */
function piePanel(doc, st, pie) {
  if (!pie.total) {
    return html`
      <div class="panel block">
        <div class="panel-h"><h3>Where it goes</h3></div>
        <div class="empty"><b>Nothing logged yet</b>Log one spend and the pie appears.</div>
      </div>`;
  }

  const R = 42;
  const ring = money.arcs(pie.slices, { r: R });

  return html`
    <div class="panel block">
      <div class="panel-h">
        <h3>Where it goes</h3>
        <span class="chip">${plural(pie.all.length, 'category', 'categories')}</span>
      </div>

      <div class="pierow">
        <div class="pie">
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <circle cx="50" cy="50" r="${R}" fill="none" stroke="var(--s2)" stroke-width="15"/>
            ${ring.map(a => html`
              <circle cx="50" cy="50" r="${R}" fill="none"
                stroke="${a.grey ? 'var(--tx3)' : `hsl(${a.color} 48% 56%)`}" stroke-width="15"
                stroke-dasharray="${a.dash}" stroke-dashoffset="${a.offset}"
                transform="rotate(-90 50 50)"/>`)}
          </svg>
          <div class="pieface">
            <b>${money.fmtShort(doc, pie.total)}</b>
            <span>spent</span>
          </div>
        </div>

        <ul class="pielegend">
          ${pie.slices.map(s => html`
            <li>
              <button data-act="openSlice" data-slice="${s.id}">
                <i class="pdot ${s.grey ? 'grey' : ''}" style="--h:${s.color}"></i>
                <span class="pname">${s.name}</span>
                <span class="pamt">${money.fmt(doc, s.total)}</span>
                <span class="ppct">${Math.round(s.pct * 100)}%</span>
              </button>
            </li>`)}
        </ul>
      </div>
    </div>`;
}

/* A bar per day of the period, with the even-spend line across it. */
function dayBars(doc, st) {
  if (!st.count) return '';
  const days = money.dailySpend(doc);
  const peak = Math.max(st.evenPerDay, ...days.map(d => d.amount)) || 1;
  const biggest = days.reduce((a, d) => (d.amount > a.amount ? d : a), days[0]);

  return html`
    <div class="panel block">
      <div class="panel-h">
        <h3>Day by day</h3>
        <span class="chip">${money.fmt(doc, Math.round(st.evenPerDay))} even</span>
      </div>
      <div class="daybars">
        ${days.map(d => html`
          <span class="dbcol ${d.future ? 'future' : ''}" title="${niceDate(d.date)} · ${money.fmt(doc, d.amount)}">
            <i style="height:${Math.round(clamp(d.amount / peak, 0, 1) * 100)}%"></i>
          </span>`)}
        <b class="dbline" style="bottom:${Math.round((st.evenPerDay / peak) * 100)}%"></b>
      </div>
      <div class="hint center" style="margin-top:10px">
        ${biggest && biggest.amount > 0
          ? `Biggest day was ${niceDate(biggest.date)} at ${money.fmt(doc, biggest.amount)}. The line is an even spend.`
          : 'The line is what an even spend would look like.'}
      </div>
    </div>`;
}

function todayPanel(doc, today) {
  return html`
    <div class="panel block">
      <div class="panel-h"><h3>Today</h3>
        ${today.length ? html`<span class="chip">${money.fmt(doc, today.reduce((a, e) => a + e.amount, 0))}</span>` : ''}
      </div>
      ${today.length
        ? html`<ul class="list">
            ${today.map(e => html`
              <li>
                <div class="body">
                  <div class="title"><i class="dhue" style="--h:${catColor(doc, e.cat)}"></i>${money.fmt(doc, e.amount)}</div>
                  <div class="meta">${catName(doc, e.cat)}${e.note ? ` · ${e.note}` : ''}</div>
                </div>
                <button class="iconbtn" data-act="deleteEntry" data-entry="${e.id}" aria-label="Remove">${icon('x')}</button>
              </li>`)}
          </ul>`
        : html`<div class="empty"><b>Nothing spent today</b>A day you spent nothing is a good day, not an empty one.</div>`}
    </div>`;
}

function recentPanel(doc, st) {
  const periods = money.recentPeriods(doc, 6).filter((p, i) => i > 0 && p.count > 0);
  if (!periods.length) return '';
  return html`
    <div class="panel block">
      <div class="panel-h"><h3>Before this</h3>
        <span class="chip ${periods.every(p => p.under) ? 'done' : ''}">
          ${periods.filter(p => p.under).length} of ${periods.length} under
        </span>
      </div>
      <ul class="list">
        ${periods.map(p => html`
          <li>
            <div class="body">
              <div class="title">${money.fmt(doc, p.spent)}</div>
              <div class="meta">${niceDate(p.from, false)} – ${niceDate(p.to, false)} · ${plural(p.count, 'entry', 'entries')}</div>
            </div>
            <span class="chip ${p.under ? 'done' : 'warn'}">${p.under ? 'under' : 'over'}</span>
          </li>`)}
      </ul>
    </div>`;
}

/* ---------- logging a spend ----------
   The amount gets the keyboard and the focus, because it is the only
   field that cannot be guessed. Everything else has a default that is
   right most of the time. */
const NEW_CAT = '__new';

function openSpend(app, catId) {
  const doc = app.doc;
  const cats = [...doc.money.cats.map(c => [c.id, c.name]), [NEW_CAT, 'New category…']];
  const start = catId && doc.money.cats.some(c => c.id === catId) ? catId : cats[0][0];

  openSheet({
    title: 'Log a spend',
    sub: `Goes against this ${doc.settings.money.period}.`,
    body: html`
      ${field('amount', `Amount (${doc.settings.money.symbol})`, '', {
        type: 'number',
        attrs: 'inputmode="decimal" step="0.01" min="0" autocomplete="off"',
        placeholder: '0',
      })}
      ${select('cat', 'Category', start, cats)}
      <div id="newCatWrap" ${start === NEW_CAT ? '' : 'hidden'}>
        ${field('newCat', 'New category name', '', { placeholder: 'e.g. Laundry' })}
      </div>
      ${field('date', 'When', ds(), { type: 'date' })}
      ${field('note', 'Note', '', { placeholder: 'optional' })}`,
    footer: html`<button class="btn quiet" data-sheet-close>Cancel</button>
      <button class="btn primary" data-act="saveSpend">Log it</button>`,
    onMount(root) {
      const sel = root.querySelector('[name="cat"]');
      const wrap = root.querySelector('#newCatWrap');
      sel.addEventListener('change', () => { wrap.hidden = sel.value !== NEW_CAT; });
      setTimeout(() => root.querySelector('[name="amount"]')?.focus(), 140);
    },
  });
}

/* ---------- settings ---------- */
const DOW = [['1', 'Monday'], ['2', 'Tuesday'], ['3', 'Wednesday'], ['4', 'Thursday'], ['5', 'Friday'], ['6', 'Saturday'], ['0', 'Sunday']];
const SYMBOLS = ['₹', '$', '€', '£', '¥', '₩'];

function openMoneySettings(app) {
  const m = app.doc.settings.money;
  openSheet({
    title: 'Pocket money',
    sub: 'What you get, and when it lands.',
    body: html`
      <div class="switch">
        <div class="switch-txt"><b>Remind me to log it</b><span>One nudge in the evening when it has been a few days</span></div>
        <button class="tgl" role="switch" aria-checked="${m.on ? 'true' : 'false'}" data-act="toggleMoney"></button>
      </div>

      ${field('allowance', 'Allowance', m.allowance || '', {
        type: 'number', attrs: 'inputmode="decimal" step="1" min="0"',
      })}
      ${select('period', 'Arrives every', m.period, [['month', 'Month'], ['week', 'Week']])}
      ${m.period === 'week'
        ? select('startDow', 'On a', String(m.startDay ?? 1), DOW)
        : field('startDay', 'On day of the month', m.startDay || 1, { type: 'number', attrs: 'inputmode="numeric" min="1" max="28"' })}
      ${select('symbol', 'Currency', m.symbol, SYMBOLS.map(x => [x, x]))}
      ${field('askAt', 'Ask me at', m.askAt || '21:00', { type: 'time' })}

      <div class="g2 mt2">
        <button class="btn quiet" data-act="editCats">${icon('layers')} Categories</button>
        <button class="btn quiet" data-act="clearPeriod">${icon('trash')} Clear period</button>
      </div>`,
    footer: html`<button class="btn quiet" data-sheet-close>Cancel</button>
      <button class="btn primary" data-act="saveMoney">Save</button>`,
  });
}

/* ---------- helpers ---------- */
function catName(doc, id) { return doc.money.cats.find(c => c.id === id)?.name || 'Other'; }
function catColor(doc, id) { return doc.money.cats.find(c => c.id === id)?.color ?? 0; }
