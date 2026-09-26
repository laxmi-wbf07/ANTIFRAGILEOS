/* ============================================================
   views/reel.js — the feed

   One card, the whole screen, nothing else on it.

     drag up            the next card
     drag down          the one before
     tap, or drag
     left or right      turn the card over
     double tap         keep this one

   The drag is read off the whole window, including the two corner
   buttons, so a thumb anywhere moves the feed. A button only acts if
   the gesture on it turned out to be a tap; anything with travel in it
   is a scroll and the button gets out of the way.

   What is on screen while you study is the card's text and nothing
   else. No deck name, no counter, no timer, no chips, no captions
   under the card telling you what a swipe does. The reason is not
   minimalism for its own sake: every one of those is a thing the eye
   checks before it reads the question, and a recall app that makes you
   read three labels before the prompt is measuring the wrong thing.
   The count, the deck and the gestures all still exist — they live
   behind the one menu button, where you look at them on purpose.

   The grade is taken from what you did, not from what you pressed:
   move on without turning it over and you knew it, so it is marked
   Good. Turn it over and you did not, so it is marked Again and comes
   back a few cards later.

   Three card nodes are recycled forever. A swipe writes one card's
   markup, not three, and the settle is driven off transitionend rather
   than a timer, so the feed does not tear on a slow frame.
   ============================================================ */

import { html, raw, str, icon, $, ds, clamp, durFmt, plural, hashHue } from '../util.js';
import { buildQueue, counts, grade, renderCloze, hasCloze, streak } from '../srs.js';
import * as game from '../game.js';
import { openSheet, closeSheet, toast, buzz, sfx, sparkle, lockScroll, unlockScroll } from '../ui.js';

let S = null;        // live reel session
let A = null;        // the app, while the feed is open
let slotEls = [];    // the three recycled card nodes, as [prev, cur, next]
let wired = false;   // #reel outlives any one sitting; wire it exactly once
let needFit = false; // a card was built before there was a box to fit it to

const SWIPE_Y = 58;    // px of travel before a vertical drag commits
const SWIPE_X = 52;    // px before a sideways drag turns the card
const FLING = 0.42;    // px/ms — a flick this fast commits on its own
const FLING_MIN = 16;  // …but it still has to have gone somewhere
const AXIS = 7;        // px before we commit to an axis
const ANIM = 240;      // ms, kept in step with TRANS below
const TRANS = `transform ${ANIM}ms cubic-bezier(.22,.82,.28,1)`;
const DOUBLE = 300;    // ms between two taps for them to be one gesture
const RUN_STEP = 5;    // a run is worth a nudge every five

const reel = {
  id: 'reel',

  isOpen() { return !!S; },

  open(app, param = '') {
    const doc = app.doc;
    const where = parseParam(doc, param);
    const queue = buildQueue(doc, { deck: where.decks, mode: where.mode });

    if (!queue.length) {
      const c = counts(doc, where.decks);
      if (!c.total) {
        toast('No cards here yet. Add some first.');
        app.go('cards', 'add');
        return;
      }
      toast('Nothing due. Opening what is coming up next.');
      const ahead = buildQueue(doc, { deck: where.decks, mode: 'ahead' });
      if (!ahead.length) { app.go('cards'); return; }
      start(app, ahead, where, 'ahead');
      return;
    }
    start(app, queue, where, where.mode);
  },

  /* Tears the screen down whether or not there is still a session behind
     it. A close that bails early on missing state leaves a full-screen
     node with no way out of it, and being unable to leave the feed is
     the worst thing this file could do. */
  close(app, { silent = false } = {}) {
    const was = S;
    const done = was ? was.done : 0;
    const mins = was ? Math.round((Date.now() - was.startedAt) / 60000) : 0;
    S = null;
    A = null;
    slotEls = [];
    const node = $('#reel');
    if (node) { node.hidden = true; node.innerHTML = ''; }
    const bar = $('#tabbar');
    if (bar) bar.hidden = false;
    unlockScroll('reel');
    if (was && !silent) {
      if (done > 0) toast(`${plural(done, 'card')} in ${mins < 1 ? 'under a minute' : durFmt(mins)}`);
      if (location.hash.startsWith('#/reel')) app.go('cards');
      else app.render();
    }
    app.refreshChrome();
  },

  /* Nothing on the card is a clock any more. What is left for the app
     clock to do is finish any fit that could not be measured when the
     card was built. */
  tick() {
    if (S && needFit) refit();
  },

  key(app, ev) {
    if (!S) return;
    if (S.animating) { cutAnimation(); if (S.animating) return; }
    const k = ev.key;
    if (k === 'ArrowUp' || k === ' ' || k === 'Enter') { ev.preventDefault(); advance(app, 1); return; }
    if (k === 'ArrowDown') { ev.preventDefault(); advance(app, -1); return; }
    if (k === 'ArrowLeft' || k === 'ArrowRight') { ev.preventDefault(); flip(app, k === 'ArrowLeft' ? -1 : 1); }
  },

  actions: {
    reelClose(app) { reel.close(app); },

    /* Everything the card no longer says is in here: what deck this is,
       how far through you are, how the run is going, and every action.
       One button, looked at on purpose, rather than five labels read by
       accident on every card. */
    reelMenu(app) {
      if (!S) { reel.close(app); return; }
      const item = current();
      const isCard = item?.kind === 'card';
      const seen = Math.min(S.idx + 1, S.queue.length);
      openSheet({
        title: S.title || 'Cards',
        sub: `${seen} of ${S.queue.length} · ${left()} to go${S.done ? ` · ${S.done} done` : ''}${S.bestRun > 1 ? ` · best run ${S.bestRun}` : ''}`,
        body: html`
          <div class="g2 mt">
            ${isCard ? html`
              <button class="btn" data-act="reelLikeToggle" data-sheet-close>${icon('heart')} ${item.card.starred ? 'Stop keeping it' : 'Keep this one'}</button>
              <button class="btn" data-act="reelEdit">${icon('edit')} Edit this card</button>
              <button class="btn" data-act="reelBury">${icon('down')} Bury it</button>` : ''}
            <button class="btn" data-act="reelMore">${icon('play')} Go ahead of schedule</button>
            <button class="btn" data-act="reelHow">${icon('tap')} How this works</button>
            <button class="btn quiet" data-act="reelClose" data-sheet-close>${icon('x')} Close the feed</button>
          </div>`,
      });
    },

    reelHow(app) {
      closeSheet();
      setTimeout(() => openSheet({
        title: 'One thumb, one motion',
        sub: 'There is nothing to aim at and nothing to press.',
        body: html`
          <ul class="gesture-list">
            <li><span class="gi">${icon('swipeUp')}</span><div><b>Drag up</b><i>The next card. Down for the one before. Anywhere on the screen.</i></div></li>
            <li><span class="gi">${icon('tap')}</span><div><b>Tap it</b><i>Turns the card over. So does a sideways drag.</i></div></li>
            <li><span class="gi">${icon('check')}</span><div><b>Move on without turning it over</b><i>You knew it. Marked Good, and it moves further away.</i></div></li>
            <li><span class="gi">${icon('undo')}</span><div><b>Turn it over first</b><i>You did not. Marked Again, and it comes back in this sitting.</i></div></li>
            <li><span class="gi">${icon('heart')}</span><div><b>Double tap</b><i>Keeps the card. Study just the kept ones from the menu.</i></div></li>
          </ul>
          <div class="note mt2">
            The run counts cards recalled back to back without turning one over. It is the
            only number in here you cannot get by swiping.
          </div>`,
        footer: html`<button class="btn primary" data-sheet-close>Got it</button>`,
      }), 80);
    },

    reelEdit(app) {
      const item = current();
      if (!item || item.kind !== 'card') return;
      const id = item.card.id;
      closeSheet();
      reel.close(app, { silent: true });
      setTimeout(() => app.go('cards', 'edit-' + id), 120);
    },

    reelBury(app) {
      const item = current();
      if (!item || item.kind !== 'card') return;
      item.card.suspended = true;
      item.graded = true;
      app.save();
      closeSheet();
      toast('Buried. Bring it back from the topic menu.', {
        action: 'Undo', onAction() { item.card.suspended = false; app.save(); },
      });
      advance(app, 1);
    },

    reelLikeToggle(app) {
      const it = current();
      if (!it || it.kind !== 'card') return;
      like(app, it, !it.card.starred);
    },

    reelStarred(app) {
      closeSheet();
      reel.close(app, { silent: true });
      setTimeout(() => reel.open(app, 'mode-starred'), 140);
    },

    reelMore(app) {
      if (!S) return;
      const ahead = buildQueue(app.doc, { deck: S.decks || null, mode: 'ahead' })
        .filter(c => !S.seen.has(c.id));
      closeSheet();
      if (!ahead.length) { toast('Nothing left, even ahead of schedule.'); return; }
      for (const c of ahead) { S.queue.push(mkItem(c)); S.seen.add(c.id); }
      syncSlots(app);
      syncChrome();
      toast('Pulling in cards ahead of schedule');
    },
  },
};

export default reel;

/* ---------- what to study ---------- */
function parseParam(doc, param) {
  const all = { mode: 'due', decks: null, title: 'All cards' };
  if (!param) return all;

  if (param.startsWith('deck-')) {
    const id = param.slice(5);
    const d = doc.decks.find(x => x.id === id);
    if (!d) return all;
    return { mode: 'due', decks: [id], title: d.name, hue: d.color ?? hashHue(d.name) };
  }
  if (param.startsWith('mode-')) {
    const [m] = param.slice(5).split('~');
    const names = { cram: 'Everything, shuffled', hardest: 'Hardest first', recent: 'Newest first', ahead: 'Ahead of schedule', starred: 'Kept cards' };
    return { mode: m || 'due', decks: null, title: names[m] || 'All cards' };
  }
  return all;
}

/* ---------- session ---------- */
function mkItem(card) {
  return { kind: 'card', card, revealed: false, deg: 0, graded: false };
}

function start(app, cards, where, mode) {
  A = app;
  S = {
    queue: cards.map(mkItem),
    idx: 0,
    done: 0,
    again: 0,
    run: 0,
    bestRun: 0,
    gained: 0,
    xpAt: game.pointsOn(app.doc, ds()).total,
    startedAt: Date.now(),
    decks: where.decks,
    title: where.title,
    hue: where.hue ?? null,
    mode,
    seen: new Set(cards.map(c => c.id)),
    animating: false,
    settle: null,
  };

  buildShell(app);
  syncSlots(app);
  syncChrome();
  /* Let the shell settle its own chrome state now rather than waiting for
     the clock's next reconciliation. */
  app.refreshChrome();
  dealIn();
  buzz(10);
}

/* The end of the queue is an item at one past the last card rather than
   a flag, so sliding onto it and back off it is the same motion as any
   other card and needs no special case in the animation. */
function itemAt(i) {
  if (!S) return null;
  if (i < 0 || i > S.queue.length) return null;
  return i === S.queue.length ? { kind: 'end' } : S.queue[i];
}
function current() { return itemAt(S ? S.idx : -1); }
function ended() { return !!S && S.idx >= S.queue.length; }
function left() { return S ? Math.max(0, S.queue.length - S.idx) : 0; }

/* ---------- shell, painted once ----------
   Two corner buttons and a hairline. That is the entire interface that
   is not the card. */
function buildShell(app) {
  const node = $('#reel');
  node.hidden = false;
  const bar = $('#tabbar');
  if (bar) bar.hidden = true;
  lockScroll('reel');
  if (S.hue != null) node.style.setProperty('--deck-hue', S.hue);
  else node.style.removeProperty('--deck-hue');

  node.innerHTML = str(html`
    <div class="reel-prog" aria-hidden="true"><i id="reelBar" style="width:0%"></i></div>
    <div class="reel-stage" id="reelStage">
      <div class="rcard" data-slot="0"></div>
      <div class="rcard" data-slot="1"></div>
      <div class="rcard" data-slot="2"></div>
      <div class="rlike" id="reelLike" hidden>${icon('heart')}</div>
    </div>
    <div class="reel-ctl">
      <button class="reel-btn" data-act="reelClose" aria-label="Close the feed">${icon('chevD')}</button>
      <button class="reel-btn" data-act="reelMenu" aria-label="Deck, progress and options">${icon('more')}</button>
    </div>`);

  slotEls = Array.from(node.querySelectorAll('.rcard'));
  wireDrag();
}

/** The first card lands rather than appearing. Costs 340ms, once. */
function dealIn() {
  if (reduced()) return;
  const stage = $('#reelStage');
  if (!stage) return;
  stage.classList.add('dealing');
  setTimeout(() => stage.classList.remove('dealing'), 400);
}

/* Writing the transition string every frame of a drag is a style
   recalculation for no reason, so it is only written when it changes. */
function place(el, pct, px = 0, anim = false) {
  if (!el) return;
  const t = anim ? TRANS : 'none';
  if (el._tr !== t) { el.style.transition = t; el._tr = t; }
  el.style.transform = px
    ? `translate3d(0,calc(${pct}% + ${px}px),0)`
    : `translate3d(0,${pct}%,0)`;
}

/* ---------- filling the three slots ----------
   Full refill. Used on open and whenever the queue itself changes;
   a plain swipe uses shiftSlots below, which writes one card. */
function syncSlots(app) {
  if (!S || slotEls.length !== 3) return;
  fill(app, slotEls[0], itemAt(S.idx - 1));
  fill(app, slotEls[1], itemAt(S.idx));
  fill(app, slotEls[2], itemAt(S.idx + 1));
  settleSlots();
}

/** Put the three nodes back where they belong, with no animation. */
function settleSlots() {
  place(slotEls[0], -100); place(slotEls[1], 0); place(slotEls[2], 100);
  for (let i = 0; i < slotEls.length; i++) slotEls[i].dataset.slot = String(i);
}

/* After a swipe the three nodes are rotated rather than rewritten: the
   card that was next is already on screen and already laid out, and only
   the one that just came into range is built. One innerHTML per swipe
   instead of three, which is most of why this now feels like a feed. */
function shiftSlots(app, dir) {
  if (dir > 0) slotEls.push(slotEls.shift());
  else slotEls.unshift(slotEls.pop());
  const edge = dir > 0 ? 2 : 0;
  fill(app, slotEls[edge], itemAt(S.idx + (dir > 0 ? 1 : -1)));
  settleSlots();
}

function fill(app, el, it) {
  if (!el) return;
  el.hidden = !it;
  if (!it) { el.innerHTML = ''; el._fit = null; return; }
  el.className = 'rcard' + (it.kind === 'card' && it.card.starred ? ' liked' : '') + (it.kind === 'end' ? ' end' : '');
  el.innerHTML = it.kind === 'card' ? cardFaces(it) : oneFace(endInner(app));
  const flipper = el.querySelector('.rflip');
  if (flipper) {
    flipper.style.transition = 'none';
    flipper.style.transform = `rotateY(${it.deg || 0}deg)`;
    /* Re-arm the transition next frame, or turning the card over would
       have no animation the first time. */
    requestAnimationFrame(() => { flipper.style.transition = ''; });
  }
  fitCard(el);
}

function oneFace(inner) {
  return str(html`<div class="rflip"><div class="rface">${raw(str(inner))}</div></div>`);
}

/* ---------- the card ----------
   The question, and then the answer. That is the whole of it. */
function cardFaces(it) {
  const c = it.card;
  const isCloze = c.type === 'cloze' || hasCloze(c.front);

  const front = html`
    <div class="rface front">
      <div class="rcard-body">
        <div class="rcard-q fit">${isCloze ? raw(renderCloze(c.front, false)) : c.front}</div>
      </div>
    </div>`;

  /* The back is the answer and nothing else. Repeating the question you
     were looking at a second ago spends the half of the card the answer
     needs. A cloze is the exception, because for a cloze the sentence
     with the blank filled in *is* the answer. */
  const back = html`
    <div class="rface back">
      <div class="rcard-body">
        ${isCloze
          ? html`<div class="rcard-ans fit">${raw(renderCloze(c.front, true))}</div>`
          : (c.back
            ? html`<div class="rcard-ans fit">${c.back}</div>`
            : html`<div class="rcard-ans fit t3">No answer written yet.</div>`)}
      </div>
    </div>`;

  return str(html`<div class="rflip">${front}${back}</div>`);
}

/* ---------- fitting the words to the glass ----------
   A full-screen card with a scrollbar in it is a card you cannot swipe,
   because the scroller eats the gesture. So nothing inside a card ever
   scrolls: the type shrinks until the text fits, starting from a guess
   made off the length so the loop almost always runs once or twice.

   Run on the card as it is filled, which for a swipe is the card that is
   still off-screen, so the measuring never lands in a moving frame. */
function fitCard(card) {
  if (!card || card.hidden) return;
  for (const face of card.querySelectorAll('.rface')) {
    const txt = face.querySelector('.fit');
    const box = face.querySelector('.rcard-body');
    if (!txt || !box) continue;
    const n = txt.textContent.length;
    txt.style.fontSize = '';
    txt.classList.toggle('long', n > 160);
    txt.classList.toggle('xlong', n > 420);

    /* There has to be a box before there is a fit. A card built while the
       tab is in the background, the window is collapsed, or the first
       frame has not landed measures zero high — and a shrink loop against
       zero drives the type to the floor and leaves it there, which is a
       card of 11px text on a phone held at arm's length. So the CSS sizes
       stand, and the fit is redone from the clock once the box is real. */
    const room = box.clientHeight;
    if (room < 48) { needFit = true; continue; }

    let size = parseFloat(getComputedStyle(txt).fontSize) || 24;
    let guard = 0;
    while (txt.scrollHeight > room + 1 && size > 12 && guard++ < 18) {
      size *= 0.91;
      txt.style.fontSize = size.toFixed(2) + 'px';
    }
  }
}

/** Every card on screen, re-fitted. Cheap: three cards, two faces each. */
function refit() {
  needFit = false;
  for (const el of slotEls) fitCard(el);
}

/** Only the hairline. There is no number on the screen to keep in step. */
function syncChrome() {
  if (!S) return;
  const bar = $('#reelBar');
  if (!bar) return;
  const total = S.queue.length || 1;
  bar.style.width = clamp((S.idx / total) * 100, 0, 100).toFixed(1) + '%';
}

/* A wash of colour over the whole screen for a moment. It says the same
   thing the word "again" used to say, without putting a word on a card
   whose entire job is to hold one other piece of text. */
function tint(kind) {
  const stage = $('#reelStage');
  if (!stage || reduced()) return;
  stage.classList.remove('t-again', 't-run');
  void stage.offsetWidth;
  stage.classList.add(kind === 'again' ? 't-again' : 't-run');
  clearTimeout(tint._t);
  tint._t = setTimeout(() => stage.classList.remove('t-again', 't-run'), 620);
}

/* ---------- the end of the queue ----------
   The one screen in the feed that is allowed words, because it is the
   one screen that is not a card. */
function endInner(app) {
  const mins = Math.max(1, Math.round((Date.now() - S.startedAt) / 60000));
  const run = streak(app.doc);
  const knew = Math.max(0, S.done - S.again);
  const pct = S.done ? Math.round((knew / S.done) * 100) : 0;
  /* The card ring closes the moment the queue is empty, and closing it
     here rather than on another tab is the whole payoff for having sat
     through it. */
  const ring = game.rings(app.doc).find(r => r.id === 'cards');
  const cleared = !!ring?.done;

  return html`
    <div class="rcard-body end">
      <div class="story-num">${S.done}</div>
      <div class="story-h">${S.done === 0 ? 'Nothing to do here' : 'Queue clear'}</div>
      <div class="story-p">
        ${S.done === 0
          ? 'Everything here is scheduled for later.'
          : `${plural(S.done, 'card')} in ${durFmt(mins)}.`}
      </div>
      ${S.done ? html`
        <div class="g3 end-stats">
          <div class="stat ok"><b>${pct}%</b><span>recalled</span></div>
          <div class="stat"><b>${S.bestRun}</b><span>best run</span></div>
          <div class="stat"><b>${S.again}</b><span>coming back</span></div>
        </div>` : ''}
      <div class="end-chips">
        ${S.gained ? html`<span class="chip live">${icon('spark')} +${S.gained}</span>` : ''}
        ${cleared ? html`<span class="chip done">${icon('check')} cards ring closed</span>` : ''}
        ${run > 0 ? html`<span class="chip">${icon('flame')} ${plural(run, 'day')} of cards</span>` : ''}
      </div>
      <div class="reel-endacts">
        <button class="btn quiet" data-act="reelMore">Keep going</button>
        <button class="btn primary" data-act="reelClose">Done</button>
      </div>
    </div>`;
}

/* ---------- turning a card over ---------- */
function flip(app, dir = 1) {
  const it = current();
  if (!it || it.kind !== 'card' || S.animating) return;
  it.deg = normDeg((it.deg || 0) + dir * 180);
  it.revealed = !it.revealed;
  const flipper = slotEls[1]?.querySelector('.rflip');
  if (flipper) {
    flipper.style.transition = '';
    flipper.style.transform = `rotateY(${it.deg}deg)`;
  }
  buzz(8);
}
function normDeg(d) { return ((d % 720) + 720) % 720; }

/* ---------- keeping one ----------
   A double tap is the one gesture in here that costs nothing and is
   never wrong, so it does the one thing you cannot get wrong: it marks
   a card as worth coming back to. */
function like(app, it, on) {
  if (!it || it.kind !== 'card') return;
  const was = !!it.card.starred;
  it.card.starred = on || undefined;
  slotEls[1]?.classList.toggle('liked', !!on);
  app.save();

  if (!on) { buzz(8); sfx.undo(); return; }
  buzz(was ? 10 : [10, 30, 16]);
  if (!was) sfx.ok(); else sfx.tick();
  const heart = $('#reelLike');
  if (heart && !reduced()) {
    heart.hidden = false;
    heart.classList.remove('go');
    void heart.offsetWidth;
    heart.classList.add('go');
    clearTimeout(like._t);
    like._t = setTimeout(() => { heart.hidden = true; }, 780);
  }
}

/* ---------- moving through the feed ---------- */
function gradeCurrent(app) {
  const it = current();
  if (!it || it.kind !== 'card' || it.graded) return;
  it.graded = true;

  const g = it.revealed ? 1 : 3;
  const row = grade(it.card, g);
  app.doc.reviews.push(row);
  if (app.doc.reviews.length > 6000) app.doc.reviews.splice(0, app.doc.reviews.length - 6000);
  S.done++;

  if (g === 1) {
    S.again++;
    S.run = 0;
    sfx.miss(); buzz([20, 36, 20]);
    tint('again');
    // back in the pile a few cards later, which is what "again" means
    const at = Math.min(S.queue.length, S.idx + 4 + Math.floor(Math.random() * 4));
    S.queue.splice(at, 0, mkItem(it.card));
  } else {
    S.run++;
    if (S.run > S.bestRun) S.bestRun = S.run;
    if (S.run >= RUN_STEP && S.run % RUN_STEP === 0) {
      sfx.ok(); buzz([12, 30, 12, 30, 24]);
      tint('run');
    } else {
      sfx.tick(); buzz(11);
    }
  }

  /* What this sitting has actually been worth, measured against where
     the day stood when it opened. It is shown once, at the end. */
  S.gained = Math.max(0, game.pointsOn(app.doc, ds()).total - S.xpAt);

  app.save();
  announce(app);
}

/* A milestone that lands mid-queue is announced under the card rather
   than on a screen you would have to go and find. */
function announce(app) {
  const fresh = game.claimNew(app.doc);
  if (!fresh.length) return;
  sparkle(innerWidth / 2, innerHeight * 0.36, 16);
  sfx.done(); buzz([20, 60, 20, 60, 40]);
  toast(`${fresh[0].name} — ${fresh[0].hint}`, { ms: 4200 });
}

/** Run the callback when this element's own transform lands, or shortly
 *  after if the browser never says so. */
function onSettled(el, fn) {
  let done = false;
  const go = ev => {
    if (done || (ev && ev.target !== el)) return;
    done = true;
    clearTimeout(t);
    el.removeEventListener('transitionend', go);
    fn();
  };
  const t = setTimeout(go, ANIM + 110);
  el.addEventListener('transitionend', go);
}

function advance(app, dir) {
  if (!S || S.animating) return;
  if (dir > 0 && ended()) return;
  if (dir < 0 && S.idx === 0) { settleSlots(); return; }

  if (dir > 0) gradeCurrent(app);

  const wasEnding = dir > 0 && S.idx + 1 >= S.queue.length;
  const [prev, cur, next] = slotEls;

  /* Idempotent, because two things race to call it: the transition
     ending on its own, and a finger arriving before it does. */
  let settled = false;
  const finish = () => {
    if (settled || !S) return;
    settled = true;
    S.settle = null;
    S.animating = false;
    S.idx += dir;
    shiftSlots(app, dir);
    /* The end card was built when it came into range, one card early,
       so the tally on it was one card out of date by the time you got
       to it. Rebuild it on arrival. */
    if (ended()) fill(app, slotEls[1], { kind: 'end' });
    syncChrome();
    if (wasEnding) { endCelebrate(); app.refreshChrome(); }
  };

  if (reduced()) { finish(); return; }

  S.animating = true;
  S.settle = finish;
  const shift = dir > 0 ? -100 : 100;
  onSettled(cur, finish);
  place(prev, -100 + shift, 0, true);
  place(cur, shift, 0, true);
  place(next, 100 + shift, 0, true);
}

/* A finger that lands mid-flight takes the stack over rather than being
   ignored for a quarter of a second. Without this, flicking through a
   queue at speed silently drops every other swipe, which is exactly the
   moment a feed has to feel like one. */
function cutAnimation() {
  if (S?.settle) S.settle();
}

/* Clearing a queue is the one moment in here allowed to be loud. */
function endCelebrate() {
  if (!S || !S.done) return;
  sfx.done();
  buzz([18, 40, 18, 40, 60]);
  const w = window.innerWidth, h = window.innerHeight;
  sparkle(w / 2, h * 0.36, 16, 'var(--done)');
  setTimeout(() => sparkle(w * 0.3, h * 0.42, 9, 'var(--accent)'), 130);
  setTimeout(() => sparkle(w * 0.7, h * 0.42, 9, 'var(--accent)'), 220);
}

function reduced() { return matchMedia('(prefers-reduced-motion: reduce)').matches; }

/* ---------- gestures ----------
   Read off the whole window, buttons included. The card is a target, and
   a target is a thing you have to aim at; the point of this screen is
   that you never do.

   A press that starts on one of the two corner buttons still drags the
   feed. The button only fires if the gesture turned out to have no
   travel in it — and if it did have travel, the click that the browser
   sends afterwards is swallowed, so a swipe that happened to begin on
   the close button does not close the feed. */
function wireDrag() {
  const node = $('#reel');
  if (!node || wired) return;
  /* #reel is part of the page, not of a sitting: its innerHTML is
     replaced every time the feed opens but the element itself is the
     same one forever. Wiring it per-open stacked a fresh set of
     handlers on top of the last, so by the third sitting of a session
     one tap turned the card over three times and one flick went three
     cards on. Wire it once; the handlers read the live session. */
  wired = true;

  let x0 = 0, y0 = 0, dx = 0, dy = 0;
  let dragging = false, axis = null, frame = 0;
  let ctl = null, lastTap = 0, pid = null;
  let samples = [];

  const paint = () => {
    frame = 0;
    if (!dragging || !S) return;
    if (axis === 'y') {
      /* Rubber band at both ends, so the feed says "there is nothing
         there" by feel rather than by refusing to move. */
      const damp = dy < 0
        ? (ended() ? dy * 0.28 : dy)
        : (S.idx === 0 ? dy * 0.28 : dy);
      place(slotEls[0], -100, damp);
      place(slotEls[1], 0, damp);
      place(slotEls[2], 100, damp);
    } else if (axis === 'x') {
      const it = current();
      const flipper = slotEls[1]?.querySelector('.rflip');
      if (flipper && it) {
        flipper.style.transition = 'none';
        flipper.style.transform = `rotateY(${(it.deg || 0) + dx * 0.45}deg)`;
      }
    }
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(paint); };

  /* px per ms over the tail of the gesture, so a short fast flick counts
     as much as a long slow drag. */
  const speed = () => {
    if (samples.length < 2) return 0;
    const a = samples[0], b = samples[samples.length - 1];
    const dt = b.t - a.t;
    return dt > 0 ? (b.y - a.y) / dt : 0;
  };

  node.addEventListener('pointerdown', e => {
    if (!S || !A) return;
    if (S.animating) cutAnimation();
    if (S.animating) return;              // reduced motion: nothing to cut
    dragging = true; axis = null;
    ctl = e.target.closest('[data-act],button');
    x0 = e.clientX; y0 = e.clientY; dx = 0; dy = 0;
    pid = e.pointerId;
    samples = [{ t: performance.now(), y: e.clientY }];
    /* Capture is taken when the gesture turns out to be a drag, not
       when the finger lands. Capturing on contact also re-targets the
       click that follows to #reel, which quietly killed every button on
       this screen: the press registered, and then the thing it was a
       press *of* never heard about it. */
  }, { passive: true });

  node.addEventListener('pointermove', e => {
    if (!dragging) return;
    dx = e.clientX - x0;
    dy = e.clientY - y0;
    const t = performance.now();
    samples.push({ t, y: e.clientY });
    while (samples.length > 2 && t - samples[0].t > 90) samples.shift();
    if (!axis) {
      if (Math.abs(dx) < AXIS && Math.abs(dy) < AXIS) return;
      axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      // now it is a drag: keep the rest of it even if the finger leaves
      try { node.setPointerCapture?.(pid); } catch (err) { /* gone already */ }
    }
    schedule();
  }, { passive: true });

  const release = () => {
    if (!dragging) return;
    dragging = false;
    if (!S || !A) { axis = null; return; }
    if (frame) { cancelAnimationFrame(frame); frame = 0; }

    const it = current();

    if (!axis) {                                   // a tap
      /* A press with no travel in it, on a button, is a press of that
         button — said here rather than left to the browser, because the
         browser re-points the click it sends afterwards at whatever
         holds the pointer capture, and on a screen that is one big
         gesture surface that is never the button. */
      if (ctl) { ctl.click(); return; }
      const now = Date.now();
      /* The second tap of a pair undoes the turn the first one did and
         keeps the card instead, so a double tap costs nothing and never
         grades anything by accident. */
      if (now - lastTap < DOUBLE) {
        lastTap = 0;
        if (it?.kind === 'card') { flip(A, -1); like(A, it, true); }
        return;
      }
      lastTap = now;
      if (!it) return;
      if (it.kind === 'card') flip(A, 1);
      return;
    }

    if (axis === 'y') {
      const v = speed();
      const flung = Math.abs(v) > FLING && Math.abs(dy) > FLING_MIN;
      const up = dy < 0;
      if ((dy < -SWIPE_Y || (flung && up)) && !ended()) { advance(A, 1); return; }
      if ((dy > SWIPE_Y || (flung && !up)) && S.idx > 0) { advance(A, -1); return; }
      place(slotEls[0], -100, 0, true);
      place(slotEls[1], 0, 0, true);
      place(slotEls[2], 100, 0, true);
      return;
    }

    const flipper = slotEls[1]?.querySelector('.rflip');
    if (Math.abs(dx) > SWIPE_X && it?.kind === 'card') { flip(A, dx < 0 ? -1 : 1); return; }
    if (flipper && it) {
      flipper.style.transition = '';
      flipper.style.transform = `rotateY(${it.deg || 0}deg)`;
    }
  };

  node.addEventListener('pointerup', release);
  node.addEventListener('pointercancel', release);

  /* Every pointer-driven click inside the feed is dropped: the gestures
     above have already decided what the press meant, and a second,
     re-targeted opinion from the browser can only disagree. A click with
     no pointer behind it — detail 0 — is a keyboard press or one this
     file sent itself, and those go through. */
  node.addEventListener('click', e => {
    if (e.detail === 0) return;
    e.stopPropagation();
    e.preventDefault();
  }, true);

  /* Turn the phone sideways and the box the words were fitted to is a
     different shape. Re-fit rather than leave a portrait size in a
     landscape card. */
  addEventListener('resize', () => { if (S) refit(); }, { passive: true });
}
