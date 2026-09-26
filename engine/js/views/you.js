/* ============================================================
   views/you.js — what now, and how it is going

   Two questions, in that order. The top of the screen is the only
   forward-looking thing on it: of everything outstanding, what is worth
   doing at this minute. Everything below it is the evidence — where the
   day stands, how long this has been running, what it has added up to.

   Top to bottom, in the order the answers are actually wanted:

     what now          one thing, with the reason, and a button
     the three rings   is today done
     the streak        how long has this been going
     the level         how far has all of it added up to
     the fortnight     what does the recent shape look like
     milestones        what is there still to reach

   Settings live one level down, behind a single row, because they are a
   place you go on purpose once and then never again.
   ============================================================ */

import { html, icon, ds, pd, plural, durFmt, niceDate, DOW_XS, dowOf, clamp, round } from '../util.js';
import * as game from '../game.js';
import * as next from '../next.js';
import { openSheet, closeSheet, toast, buzz } from '../ui.js';
import { settingsScreen, settingsActions } from './settings.js';

export default {
  id: 'you',

  topbar(app) {
    if (app.param === 'settings') {
      return {
        title: 'Settings',
        sub: 'Appearance, nudges, your data',
        back: { act: 'youBack', label: 'Back' },
      };
    }
    const s = game.stats(app.doc);
    const day = game.dayState(app.doc);
    return {
      title: 'You',
      sub: day.of
        ? (day.won ? 'Day won' : `${day.closed} of ${day.of} rings closed`)
        : 'Nothing set up yet',
      actions: html`<button class="iconbtn" data-act="openSettings" aria-label="Settings">${icon('sliders')}</button>`,
    };
  },

  render(app) {
    if (app.param === 'settings') return settingsScreen(app);

    const doc = app.doc;
    const s = game.stats(doc);
    const day = game.dayState(doc);

    return html`
      ${nextPanel(doc)}
      ${ringsPanel(day)}
      ${streakPanel(s)}
      ${levelPanel(s)}
      ${historyPanel(doc)}
      ${milestonePanel(doc, s)}

      <div class="block">
        <button class="btn quiet full" data-act="openSettings">${icon('sliders')} Settings and your data</button>
      </div>`;
  },

  /* The next-step card is the only thing on this tab that changes
     between ticks, and repainting the whole screen for it would throw
     away a press animation every second. */
  tick(app, root) {
    if (app.param === 'settings') return;
    const node = root.querySelector('#nextCard');
    if (!node) return;
    const now = next.next(app.doc);
    const key = `${now.top.id}|${now.top.label}|${Math.round(now.top.score * 50)}`;
    if (node.dataset.key === key) return;
    node.dataset.key = key;
    node.outerHTML = String(nextInner(app.doc, now).__raw ?? '');
  },

  actions: Object.assign({
    openSettings(app) { app.go('you', 'settings'); },
    youBack(app) { app.go('you'); },

    /* ---------- what now ---------- */
    doNext(app, el) {
      const now = next.next(app.doc);
      const top = now.top;
      if (!top || top.rest) return;
      buzz(10);
      /* A focus suggestion carries the shape it worked out — what
         actually fits in the evening that is left — so starting it here
         starts that, not whatever the slider last remembered. */
      if (top.id === 'focus' && top.shape) app.viewState.shape = top.shape;
      app.go(top.route, top.param || '');
    },

    whyNext(app) {
      const r = next.rank(app.doc);
      const now = next.next(app.doc);
      const c = r.clock;
      const pc = v => Math.round(clamp(v, 0, 1) * 100) + '%';

      openSheet({
        title: 'Why this one',
        sub: c.before
          ? 'The day has not started yet.'
          : c.over
            ? 'Past wind-down. Everything is scored as tomorrow’s.'
            : `${durFmt(c.minutesLeft)} of the day left. Nothing here is a priority you typed in.`,
        body: html`
          ${r.items.length ? html`
            <ul class="list mt">
              ${r.items.map((x, i) => html`
                <li>
                  <div class="body">
                    <div class="title">${x.label}${x.guard ? html` <span class="chip warn">protects the day</span>` : ''}</div>
                    <div class="meta">${x.factors.map(f => `${f.name} ${pc(f.value)}`).join(' · ')}</div>
                  </div>
                  <span class="chip ${i === 0 ? 'live' : ''}">${round(x.score, 2)}</span>
                </li>`)}
            </ul>`
            : html`<div class="empty"><b>Nothing outstanding</b>${now.top.why}</div>`}

          <div class="rulehead">How the score is made</div>
          <ul class="list">
            <li><div class="body"><div class="title">Outstanding</div><div class="meta">How much of it is left, from what the app already knows</div></div></li>
            <li><div class="body"><div class="title">Time pressure</div><div class="meta">How far through the day you are, from waking to wind-down</div></div></li>
            <li><div class="body"><div class="title">Fits the time left</div><div class="meta">An hour of work at ten past ten scores badly on purpose</div></div></li>
          </ul>
          <div class="note mt">
            Two thumbs on the scale, and both are deliberate. Something nearly closed beats something
            untouched, because the last fifth is cheap. And late in the evening with nothing closed at
            all, the cheapest ring jumps the queue — not because it matters more than the rest, but
            because the day that ends empty is the one that breaks the run. And anything already on
            your plan goes first while it is on, because you decided it once already.
          </div>`,
        footer: html`<button class="btn primary" data-sheet-close>Close</button>`,
      });
    },

    /* One sheet that says exactly how every number on this tab is made.
       A score nobody can check is a score nobody should trust, and this
       app's whole claim is that none of them can be moved without doing
       the thing. */
    explainPoints(app) {
      const s = game.stats(app.doc);
      const t = s.today;
      openSheet({
        title: 'How this is counted',
        sub: 'Nothing here is stored. It is all worked out from what you logged.',
        body: html`
          <div class="rulehead">Today</div>
          <ul class="list">
            <li><div class="body"><div class="title">Focus</div><div class="meta">Minutes, weighted by how unbroken they were</div></div><span class="chip">${t.focus}</span></li>
            <li><div class="body"><div class="title">Cards</div><div class="meta">One each, capped at ${game.CARD_XP_CAP} a day</div></div><span class="chip">${t.cards}</span></li>
            <li><div class="body"><div class="title">The day</div><div class="meta">${game.XP.perDayWon} for every ring, ${game.XP.perDayKept} for showing up</div></div><span class="chip">${t.bonus}</span></li>
          </ul>

          <div class="rulehead">Depth</div>
          <div class="note">
            Fifty minutes in one sitting is not the same work as five tens, so a session is worth its
            real minutes times how unbroken it was.
          </div>
          <ul class="list">
            <li><div class="body"><div class="title">Base</div></div><span class="chip">×1.0</span></li>
            <li><div class="body"><div class="title">Every 25 unbroken minutes</div><div class="meta">up to ×1.4</div></div><span class="chip">+0.1</span></li>
            <li><div class="body"><div class="title">Every pull you counted</div><div class="meta">never below ×0.6</div></div><span class="chip">−0.05</span></li>
          </ul>

          <div class="rulehead">What is deliberately not counted</div>
          <div class="note warn">
            The deep block earns no points of its own. It counts towards closing the day, but its
            minutes are already counted as focus, and counting them twice would be the app flattering
            you. Money earns nothing either: it is self-reported, and typing a number is not an
            achievement. Everything else is real elapsed time or a card the scheduler decided was due.
          </div>`,
        footer: html`<button class="btn primary" data-sheet-close>Got it</button>`,
      });
    },

    explainStreak(app) {
      const s = game.stats(app.doc);
      openSheet({
        title: 'The streak',
        sub: `${plural(s.streak, 'day')} won${s.holds ? `, held through ${plural(s.holds, 'day')}` : ''}.`,
        body: html`
          <ul class="list mt">
            <li><div class="body"><div class="title">Close every ring</div><div class="meta">The day is won and the streak goes up</div></div><span class="chip done">+1</span></li>
            <li><div class="body"><div class="title">Close at least one</div><div class="meta">You showed up. The streak holds where it is</div></div><span class="chip">held</span></li>
            <li><div class="body"><div class="title">Nothing at all</div><div class="meta">Only this breaks it</div></div><span class="chip bad">reset</span></li>
          </ul>
          <div class="note mt2">
            That middle row is the important one. A streak that snaps the first time you have a bad
            day punishes you at exactly the moment you are least able to take it, and what people do
            next is not try harder — it is stop opening the app. Showing up at all has to be worth
            something.
          </div>
          <div class="hint mt">
            A ring switches itself off when its goal is off, so turning the focus target down to zero
            never leaves you with a day you cannot win.
          </div>`,
        footer: html`<button class="btn primary" data-sheet-close>Close</button>`,
      });
    },

    openMilestone(app, el) {
      const s = game.stats(app.doc);
      const m = game.MILESTONES.find(x => x.id === el.dataset.ms);
      if (!m) return;
      const got = m.test(s);
      const at = app.doc.game.seen?.[m.id];
      openSheet({
        title: m.name,
        sub: m.group,
        body: html`
          <div class="empty" style="padding:26px 10px">
            <b>${got ? 'Done' : 'Not yet'}</b>
            ${m.hint}.
            ${at ? html`<div class="hint" style="margin-top:10px">Reached ${niceDate(ds(new Date(at)))}.</div>` : ''}
          </div>`,
        footer: html`<button class="btn primary" data-sheet-close>Close</button>`,
      });
    },

    openLevels(app) {
      const s = game.stats(app.doc);
      openSheet({
        title: 'Levels',
        sub: `${s.points.toLocaleString()} points. None of them unlock anything.`,
        body: html`
          <ul class="list mt">
            ${game.LEVELS.map(l => html`
              <li class="${s.points >= l.at ? '' : 'is-done'}">
                <div class="body">
                  <div class="title">${l.name}</div>
                  <div class="meta">${l.at ? `${l.at.toLocaleString()} points` : 'from the first thing you log'}</div>
                </div>
                ${s.level.n === l.n ? html`<span class="chip live">here</span>`
                  : s.points >= l.at ? html`<span class="chip done">${icon('check')}</span>`
                  : html`<span class="chip">${icon('lock')}</span>`}
              </li>`)}
          </ul>
          <div class="hint mt">
            They are a record of what has happened, not a gate in front of what has not. Nothing in
            this app is locked behind one.
          </div>`,
        footer: html`<button class="btn primary" data-sheet-close>Close</button>`,
      });
    },
  }, settingsActions),
};

/* ---------- what now ----------
   One thing, the reason for it, and a button that does it. Never a
   list: a list is the question again, and the whole job of this card is
   to answer it.

   "Rest" is a real answer rather than a fallback. An app that always
   has something for you to do is one that never lets you finish. */
function nextPanel(doc) {
  return nextInner(doc, next.next(doc));
}

function nextInner(doc, now) {
  const t = now.top;
  const key = `${t.id}|${t.label}|${Math.round((t.score || 0) * 50)}`;
  const left = now.clock.over || now.clock.before ? '' : durFmt(now.clock.minutesLeft) + ' of the day left';

  if (t.rest) {
    return html`
      <div class="panel block nextcard rest" id="nextCard" data-key="${key}">
        <div class="row">
          <span class="nextic done">${icon(t.icon)}</span>
          <div class="grow">
            <div class="next-label">${t.label}</div>
            <div class="sm t2" style="margin-top:3px">${t.why}</div>
          </div>
        </div>
      </div>`;
  }

  return html`
    <div class="panel block nextcard ${t.guard ? 'guard' : ''}" id="nextCard" data-key="${key}">
      <div class="xs hl">${t.guard ? 'Protects the day' : 'Do this next'}${left ? ` · ${left}` : ''}</div>
      <div class="row mt">
        <span class="nextic">${icon(t.icon)}</span>
        <div class="grow">
          <div class="next-label">${t.label}</div>
          <div class="sm t2" style="margin-top:3px">${t.why}</div>
        </div>
      </div>
      <div class="nextacts">
        <button class="btn quiet thin" data-act="whyNext" aria-label="Why this one">${icon('brain')}</button>
        <button class="btn primary grow tall" data-act="doNext">
          ${icon('arrow')} ${t.go}${t.cost ? ` · ${t.cost < 60 ? t.cost + 'm' : durFmt(t.cost)}` : ''}
        </button>
      </div>
    </div>`;
}

/* ---------- the three rings ----------
   Three arcs on one row, each either closed or not. No partial credit in
   the count, because "nearly" is how a streak becomes a thing you argue
   with — but the arc still fills, because seeing how close you are is
   exactly what makes you go and close it. */
function ringsPanel(day) {
  if (!day.of) {
    return html`
      <div class="panel block">
        <div class="empty"><b>Nothing to close yet</b>Write a card, set a focus target, or give the planner a deep work block.</div>
      </div>`;
  }
  return html`
    <div class="panel block">
      <div class="panel-h">
        <h3>Today</h3>
        <span class="chip ${day.won ? 'done' : ''}">${day.closed} of ${day.of}</span>
      </div>
      <div class="ringrow">
        ${day.rings.map(r => html`
          <div class="ringcell ${r.done ? 'done' : ''}">
            ${arc(r)}
            <b>${r.label}</b>
            <span>${r.say}</span>
          </div>`)}
      </div>
      <div class="hint center" style="margin-top:12px">
        ${day.won
          ? 'Every ring closed. That is the day — anything more is a bonus.'
          : day.closed
            ? 'One ring is enough to hold the streak. All of them wins the day.'
            : 'Any one of these holds the streak together.'}
      </div>
    </div>`;
}

function arc(r) {
  const R = 26;
  const C = 2 * Math.PI * R;
  const pct = clamp(r.pct || 0, 0, 1);
  return html`
    <div class="ringdial">
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r="${R}" fill="none" stroke="var(--s2)" stroke-width="6"/>
        <circle cx="32" cy="32" r="${R}" fill="none"
          stroke="${r.done ? 'var(--done)' : 'var(--accent)'}" stroke-width="6" stroke-linecap="round"
          stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - pct)).toFixed(1)}"
          transform="rotate(-90 32 32)"/>
      </svg>
      <i>${icon(r.done ? 'check' : r.icon)}</i>
    </div>`;
}

/* ---------- the streak ---------- */
function streakPanel(s) {
  return html`
    <div class="block">
      <button class="panel streakcard" data-act="explainStreak">
        <div class="row">
          <div class="grow">
            <div class="xs hl">${s.streakLive ? 'Running' : s.streak ? 'Holding' : 'Not started'}</div>
            <div class="streak-n">${icon('flame')} ${s.streak}<small>${s.streak === 1 ? 'day' : 'days'}</small></div>
            <div class="sm t2" style="margin-top:3px">
              ${s.streak
                ? (s.streakLive
                  ? 'Won today. Close them again tomorrow.'
                  : 'Close every ring today and it goes up.')
                : 'Close every ring on one day to start it.'}
            </div>
          </div>
          <span class="chev">${icon('chev')}</span>
        </div>
        <div class="g3 mt">
          <div class="stat"><b>${s.showUp}</b><span>turned up</span></div>
          <div class="stat"><b>${s.daysWon}</b><span>days won</span></div>
          <div class="stat"><b>${s.daysActive}</b><span>days logged</span></div>
        </div>
      </button>
    </div>`;
}

/* ---------- the level ---------- */
function levelPanel(s) {
  const l = s.level;
  return html`
    <div class="panel block">
      <div class="panel-h">
        <h3>Level ${l.n}</h3>
        <button class="btn s quiet" data-act="openLevels">All ten</button>
      </div>
      <div class="levelrow">
        <div class="grow">
          <div class="level-name">${l.name}</div>
          <div class="sm t2">${s.points.toLocaleString()} points</div>
        </div>
        <button class="btn s quiet" data-act="explainPoints" aria-label="How this is counted">${icon('brain')}</button>
      </div>
      <div class="bar mt"><i style="width:${Math.round(l.pct * 100)}%"></i></div>
      <div class="hint" style="margin-top:8px">
        ${l.next
          ? `${l.toNext.toLocaleString()} to ${l.next.name}. Today is worth ${s.today.total} so far.`
          : 'The last one. Everything from here is just more of it.'}
      </div>
      <div class="g3 mt">
        <div class="stat"><b>${plural(s.focusHours, 'hr')}</b><span>focused</span></div>
        <div class="stat"><b>${s.recalled.toLocaleString()}</b><span>cards recalled</span></div>
        <div class="stat"><b>${s.daysWon}</b><span>days won</span></div>
      </div>
    </div>`;
}

/* ---------- the fortnight ----------
   Fourteen columns, one per day, each showing how many rings closed. Not
   a number anywhere: the shape of a fortnight is the whole message. */
function historyPanel(doc) {
  const days = game.history(doc, 14);
  const won = days.filter(d => d.won).length;
  return html`
    <div class="panel block">
      <div class="panel-h">
        <h3>The last fortnight</h3>
        <span class="chip ${won >= 10 ? 'done' : ''}">${won} won</span>
      </div>
      <div class="fortnight">
        ${days.map(d => html`
          <span class="fnday ${d.won ? 'won' : d.kept ? 'kept' : ''}" title="${niceDate(d.date)}">
            <i style="height:${Math.round((d.closed / Math.max(1, d.of)) * 100)}%"></i>
          </span>`)}
      </div>
      <div class="fnlabels">
        ${days.map((d, i) => html`<span>${i % 2 === 0 ? DOW_XS[dowOf(d.date)] : ''}</span>`)}
      </div>
    </div>`;
}

/* ---------- milestones ----------
   Specific, earned and permanent. None of them is a currency and none of
   them can be taken away, because a thing you can lose is a reason to
   stop opening the app. */
function milestonePanel(doc, s) {
  const all = game.milestoneState(doc, s);
  const got = all.filter(m => m.got);
  const next = all.filter(m => !m.got);
  const groups = [...new Set(all.map(m => m.group))];

  return html`
    <div class="panel block">
      <div class="panel-h">
        <h3>Milestones</h3>
        <span class="chip ${got.length === all.length ? 'done' : ''}">${got.length} of ${all.length}</span>
      </div>
      ${groups.map(g => html`
        <div class="rulehead">${g}</div>
        <div class="msgrid">
          ${all.filter(m => m.group === g).map(m => html`
            <button class="mscell ${m.got ? 'got' : ''}" data-act="openMilestone" data-ms="${m.id}"
                    aria-label="${m.name}, ${m.got ? 'reached' : 'not yet'}">
              <span class="msic">${icon(m.got ? 'trophy' : 'lock')}</span>
              <b>${m.name}</b>
            </button>`)}
        </div>`)}
      ${next.length ? html`
        <div class="hint" style="margin-top:14px">
          Next up: ${next[0].name} — ${next[0].hint.toLowerCase()}.
        </div>` : html`
        <div class="hint center" style="margin-top:14px">Every one of them. There is nothing left to unlock.</div>`}
    </div>`;
}
