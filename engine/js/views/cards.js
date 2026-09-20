/* ============================================================
   views/cards.js — decks, and the one button that starts the feed

   One level. A deck holds cards; that is the whole shape.

   It used to be two — a subject holding topics holding cards — and the
   cost of that was a screen you had to navigate before you could do
   anything, on a tab whose entire job is to get out of the way of the
   feed. Two taps to reach a deck, a back button to leave it, and a
   choice ("which subject?") every single time you added a card. None of
   it earned its place. Folding it flat took the tab from two screens and
   six sheets down to one screen and three.

   What is on the screen, top to bottom: the button that starts the
   queue, your decks, and nothing else. Everything rarer than that lives
   behind the two icons in the top bar.
   ============================================================ */

import { html, raw, str, esc, icon, $, ds, plural, niceDate } from '../util.js';
import { tree, ready, parseCards, cardsToText, hasCloze, reviewsOn, leeches, isLeech, LEECH_AT } from '../srs.js';
import { ensureDeck } from '../state.js';
import { openSheet, closeSheet, confirmSheet, toast, buzz, sfx, field, area, select, readForm } from '../ui.js';
import reel from './reel.js';

const NEW_DECK = '__new';

export default {
  id: 'cards',

  topbar(app) {
    const t = tree(app.doc);
    const n = ready(t.all);
    return {
      title: 'Cards',
      sub: n ? `${n} ready` : (app.doc.cards.length ? 'Nothing due' : 'Nothing yet'),
      actions: html`
        <button class="iconbtn" data-act="openBrowse" aria-label="Browse">${icon('search')}</button>
        <button class="iconbtn" data-act="addCards" aria-label="Add cards">${icon('plus')}</button>`,
    };
  },

  render(app) {
    const doc = app.doc;
    if (!doc.cards.length && !doc.decks.length) return emptyState();
    const t = tree(doc);
    return deckScreen(doc, t);
  },

  mount(app) {
    const p = app.param;
    if (!p) return;
    app.param = '';
    if (p === 'add') setTimeout(() => openAddCards(app, null), 80);
    else if (p.startsWith('edit-')) setTimeout(() => editCard(app, p.slice(5)), 80);
    else if (p.startsWith('deck-')) setTimeout(() => reel.open(app, p), 80);
  },

  actions: {
    /* ---------- starting the feed ---------- */
    studyAll(app) { reel.open(app, ''); },
    studyDeck(app, el) { reel.open(app, 'deck-' + el.dataset.deck); },
    studyMode(app, el) { closeSheet(); reel.open(app, 'mode-' + el.dataset.mode); },

    /* ---------- decks ---------- */
    newDeck(app) {
      closeSheet();
      setTimeout(() => openSheet({
        title: 'New deck',
        sub: 'A lecture, a chapter, a language. Small is better than tidy.',
        body: html`${field('name', 'Name', '', { placeholder: 'e.g. Upper limb' })}`,
        footer: html`<button class="btn quiet" data-sheet-close>Cancel</button>
          <button class="btn primary" data-act="newDeckSave">Create</button>`,
        onMount(root) { setTimeout(() => root.querySelector('[name="name"]')?.focus(), 120); },
      }), 60);
    },

    newDeckSave(app) {
      const f = readForm($('#sheet'));
      const name = f.name?.trim();
      if (!name) { toast('Name it'); return; }
      const id = ensureDeck(app.doc, name);
      app.save(); closeSheet(); app.render();
      toast('Deck ready', { action: 'Add cards', onAction() { openAddCards(app, id); } });
    },

    deckMenu(app, el) {
      const doc = app.doc;
      const d = doc.decks.find(x => x.id === el.dataset.deck);
      if (!d) return;
      const t = tree(doc).byDeck.get(d.id);
      const bad = doc.cards.filter(c => c.deck === d.id && isLeech(c)).length;
      openSheet({
        title: d.name,
        sub: `${plural(t.total, 'card')} · ${ready(t)} ready`,
        body: html`
          <div class="g2 mt">
            <button class="btn primary" data-act="studyDeck" data-deck="${d.id}" data-sheet-close>${icon('play')} Review</button>
            <button class="btn" data-act="addToDeck" data-deck="${d.id}">${icon('plus')} Add cards</button>
            <button class="btn" data-act="browseDeck" data-deck="${d.id}">${icon('search')} Browse</button>
            <button class="btn" data-act="renameDeck" data-deck="${d.id}">${icon('edit')} Rename</button>
            <button class="btn" data-act="exportDeck" data-deck="${d.id}">${icon('down')} Export as text</button>
            <button class="btn danger" data-act="deleteDeck" data-deck="${d.id}">${icon('trash')} Delete</button>
          </div>
          ${bad ? html`
            <button class="btn quiet full mt2" data-act="openLeeches">
              ${icon('refresh')} ${plural(bad, 'card')} here keeps coming back
            </button>` : ''}`,
      });
    },

    addToDeck(app, el) { const id = el.dataset.deck; closeSheet(); setTimeout(() => openAddCards(app, id), 80); },

    renameDeck(app, el) {
      const d = app.doc.decks.find(x => x.id === el.dataset.deck);
      if (!d) return;
      closeSheet();
      setTimeout(() => openSheet({
        title: 'Rename deck',
        body: html`${field('name', 'Name', d.name)}`,
        footer: html`<button class="btn quiet" data-sheet-close>Cancel</button>
          <button class="btn primary" data-act="renameDeckSave" data-deck="${d.id}">Save</button>`,
      }), 80);
    },

    renameDeckSave(app, el) {
      const f = readForm($('#sheet'));
      const d = app.doc.decks.find(x => x.id === el.dataset.deck);
      if (d && f.name?.trim()) d.name = f.name.trim();
      app.save(); closeSheet(); app.render();
    },

    deleteDeck(app, el) {
      const doc = app.doc;
      const d = doc.decks.find(x => x.id === el.dataset.deck);
      if (!d) return;
      const n = doc.cards.filter(c => c.deck === d.id).length;
      closeSheet();
      setTimeout(() => confirmSheet({
        title: `Delete "${d.name}"?`,
        body: n ? `${plural(n, 'card')} go with it.` : 'It is empty.',
        onYes() {
          const cards = doc.cards.filter(c => c.deck === d.id);
          doc.cards = doc.cards.filter(c => c.deck !== d.id);
          doc.decks = doc.decks.filter(x => x.id !== d.id);
          app.save(); app.render(); app.refreshChrome();
          toast('Deleted', {
            action: 'Undo',
            onAction() { doc.decks.push(d); doc.cards.push(...cards); app.save(); app.render(); app.refreshChrome(); },
          });
        },
      }), 80);
    },

    exportDeck(app, el) {
      const doc = app.doc;
      const d = doc.decks.find(x => x.id === el.dataset.deck);
      if (!d) return;
      const text = cardsToText(doc.cards.filter(c => c.deck === d.id));
      closeSheet();
      setTimeout(() => openSheet({
        title: `${d.name} as text`,
        sub: 'Copy this anywhere. Pasting it back re-creates the cards.',
        body: html`${area('out', '', text, { rows: 10 })}`,
        footer: html`<button class="btn primary" data-sheet-close>Done</button>`,
        onMount(root) { const t = root.querySelector('[name="out"]'); t.focus(); t.select(); },
      }), 80);
    },

    /* ---------- making cards ---------- */
    addCards(app, el) { openAddCards(app, el?.dataset?.deck || null); },

    addCardsSave(app) {
      const f = readForm($('#sheet'));
      const deckId = resolveDeck(app, f);
      if (!deckId) { toast('Name the deck first'); return; }
      const found = parseCards(f.text, deckId);
      if (!found.length) { toast('Nothing to add'); return; }
      app.doc.cards.push(...found);
      app.save(); closeSheet(); app.render(); app.refreshChrome();
      buzz([14, 40, 14]); sfx.ok();
      toast(`${plural(found.length, 'card')} added`, {
        action: 'Review', onAction() { reel.open(app, 'deck-' + deckId); },
      });
    },

    /* ---------- cards that keep coming back ----------
       The single cheapest thing this app can do for the quality of a
       deck. A card forgotten six times is usually two facts wearing one
       coat, and the fix is to rewrite it rather than to grind it. */
    openLeeches(app) {
      const list = leeches(app.doc).sort((a, b) => b.lapses - a.lapses);
      closeSheet();
      setTimeout(() => openSheet({
        title: 'Keeps coming back',
        sub: list.length
          ? `${plural(list.length, 'card')} forgotten ${LEECH_AT} times or more.`
          : 'Nothing is fighting you.',
        body: list.length
          ? html`
            <div class="note mt">
              A card you have forgotten this often is usually not hard, it is badly written — two facts
              in one, or a question with more than one right answer. Split it, or bury it.
            </div>
            <ul class="list mt">
              ${list.slice(0, 40).map(c => html`
                <li>
                  <button class="body" data-act="editCardAct" data-card="${c.id}" style="text-align:left">
                    <div class="title">${c.front.slice(0, 80)}</div>
                    <div class="meta">${deckName(app.doc, c.deck)} · forgotten ${c.lapses} times</div>
                  </button>
                  <button class="iconbtn" data-act="buryCard" data-card="${c.id}" aria-label="Bury">${icon('down')}</button>
                </li>`)}
            </ul>`
          : html`<div class="empty"><b>Nothing to fix</b>No card here has been forgotten ${LEECH_AT} times.</div>`,
      }), 80);
    },

    buryCard(app, el) {
      const c = app.doc.cards.find(x => x.id === el.dataset.card);
      if (!c) return;
      c.suspended = true;
      app.save(); app.render(); app.refreshChrome();
      buzz(10);
      toast('Buried', { action: 'Undo', onAction() { c.suspended = false; app.save(); app.render(); } });
    },

    /* ---------- browsing and editing ---------- */
    openBrowse(app) { openBrowse(app, null, ''); },
    browseDeck(app, el) { const id = el.dataset.deck; closeSheet(); setTimeout(() => openBrowse(app, id, ''), 80); },
    editCardAct(app, el) { const id = el.dataset.card; closeSheet(); setTimeout(() => editCard(app, id), 80); },

    studyPicker(app) {
      openSheet({
        title: 'Other ways through',
        sub: 'None of these change what is scheduled. They are just different doors.',
        body: html`
          <div class="g2 mt">
            <button class="btn" data-act="studyMode" data-mode="hardest">${icon('target')} Hardest first</button>
            <button class="btn" data-act="studyMode" data-mode="cram">${icon('shuffle')} Shuffle everything</button>
            <button class="btn" data-act="studyMode" data-mode="starred">${icon('heart')} Kept cards</button>
            <button class="btn" data-act="studyMode" data-mode="recent">${icon('spark')} Newest first</button>
            <button class="btn" data-act="studyMode" data-mode="ahead">${icon('play')} Go ahead of schedule</button>
            <button class="btn" data-act="openLeeches">${icon('refresh')} Keeps coming back</button>
          </div>`,
      });
    },

    saveCard(app, el) {
      const f = readForm($('#sheet'));
      const c = app.doc.cards.find(x => x.id === el.dataset.card);
      if (!c) return;
      if (f.front !== undefined) c.front = f.front;
      if (f.back !== undefined) c.back = f.back;
      if (f.deck) c.deck = f.deck;
      c.type = hasCloze(c.front) ? 'cloze' : 'basic';
      if (f.tags !== undefined) c.tags = f.tags.split(/[, ]+/).filter(Boolean);
      app.save(); closeSheet(); app.render();
      toast('Saved');
    },

    resetCard(app, el) {
      const c = app.doc.cards.find(x => x.id === el.dataset.card);
      if (!c) return;
      Object.assign(c, { state: 'new', ivl: 0, ease: 2.5, reps: 0, lapses: 0, due: 0, step: 0, last: 0 });
      app.save(); closeSheet(); app.render(); app.refreshChrome();
      toast('Back to new');
    },

    deleteCard(app, el) {
      const doc = app.doc;
      const c = doc.cards.find(x => x.id === el.dataset.card);
      if (!c) return;
      doc.cards = doc.cards.filter(x => x.id !== c.id);
      app.save(); closeSheet(); app.render(); app.refreshChrome();
      toast('Deleted', { action: 'Undo', onAction() { doc.cards.push(c); app.save(); app.render(); } });
    },

    toggleSuspend(app, el) {
      const c = app.doc.cards.find(x => x.id === el.dataset.card);
      if (!c) return;
      c.suspended = !c.suspended;
      app.save(); closeSheet(); app.render(); app.refreshChrome();
      toast(c.suspended ? 'Buried' : 'Back in rotation');
    },
  },
};

/* ---------- screens ---------- */
function emptyState() {
  return html`
    <div class="hero block">
      <div class="kicker">Cards</div>
      <div class="h">Nothing to recall yet.</div>
      <div class="p">
        Cards are made from what you just studied, not downloaded. Three a lecture is plenty.
        They sit in a deck, and the feed is where you meet them again.
      </div>
      <button class="btn primary full mt2" data-act="addCards">${icon('plus')} Make the first cards</button>
      <div class="note mt2">
        Paste a whole lecture at once. Separate question and answer with <b>::</b> or <b>|</b>, or wrap a phrase
        in <b>{{braces}}</b> to blank it out.
      </div>
    </div>`;
}

function breakdown(t) {
  return [t.due ? `${t.due} scheduled` : '', t.learn ? `${t.learn} learning` : '', t.new ? `${t.new} new` : '']
    .filter(Boolean).join(' · ');
}

function deckScreen(doc, t) {
  const n = ready(t.all);
  const today = reviewsOn(doc, ds());
  const bad = leeches(doc).length;

  /* When the queue is empty the useful thing to say is what you already
     did, not nothing. It is a fact about today, not a score. */
  const caughtUp = today
    ? `${plural(today, 'card')} today. Come back tomorrow, or go on ahead.`
    : 'Come back tomorrow, or go on ahead.';

  return html`
    <div class="block">
      <button class="panel reviewcard ${n ? 'live' : ''}" data-act="${n ? 'studyAll' : 'studyPicker'}">
        <div class="row">
          <div class="grow">
            <div class="xs hl" style="${n ? '' : 'color:var(--tx3)'}">${n ? 'Ready' : 'All caught up'}</div>
            <div class="review-n">${n ? `${n} to review` : 'Nothing due'}</div>
            <div class="sm t2" style="margin-top:3px">${n ? breakdown(t.all) : caughtUp}</div>
          </div>
          <span class="btn ${n ? 'primary' : 'quiet'}">${icon('play')}</span>
        </div>
      </button>
    </div>

    <div class="block">
      <div class="section-h">
        <h2>Decks</h2>
        <button class="btn s quiet" data-act="newDeck">${icon('plus')} New</button>
      </div>
      ${doc.decks.length
        ? html`<ul class="list">
            ${doc.decks.map(d => {
              const dt = t.byDeck.get(d.id);
              const r = ready(dt);
              return html`
                <li>
                  <button class="body" data-act="studyDeck" data-deck="${d.id}" style="text-align:left">
                    <div class="title"><i class="dhue" style="--h:${d.color || 0}"></i>${d.name}</div>
                    <div class="meta">${dt.total ? `${plural(dt.total, 'card')}${r ? ` · ${r} ready` : ' · nothing due'}` : 'Empty'}</div>
                  </button>
                  ${r ? html`<span class="chip live">${r}</span>` : ''}
                  <button class="iconbtn" data-act="deckMenu" data-deck="${d.id}" aria-label="Deck options">${icon('more')}</button>
                </li>`;
            })}
          </ul>`
        : html`<div class="empty">
            <b>No decks yet</b>
            A deck is one lecture or one chapter. Make the first one and paste the cards in.
          </div>`}
    </div>

    ${doc.cards.length ? html`
      <div class="block">
        <button class="btn quiet full" data-act="studyPicker">${icon('layers')} Other ways through</button>
        ${bad ? html`
          <button class="btn quiet full mt" data-act="openLeeches">
            ${icon('refresh')} ${plural(bad, 'card')} keeps coming back
          </button>` : ''}
      </div>` : ''}`;
}

/* ---------- add cards ----------
   One deck picker and one box. Picking "New deck" reveals a name field
   rather than sending you to another sheet, because leaving the text you
   just pasted to go and make a deck is how a paste gets lost. */
function resolveDeck(app, f) {
  if (f.deck && f.deck !== NEW_DECK) return f.deck;
  return ensureDeck(app.doc, f.newDeck?.trim() || 'Cards');
}

function deckOptions(doc) {
  return [...doc.decks.map(d => [d.id, d.name]), [NEW_DECK, 'New deck…']];
}

function openAddCards(app, deckId) {
  const doc = app.doc;
  const opts = deckOptions(doc);
  const start = deckId && doc.decks.some(d => d.id === deckId) ? deckId : (opts[0]?.[0] || NEW_DECK);

  openSheet({
    title: 'Add cards',
    sub: 'Paste a whole lecture at once. One card per line.',
    body: html`
      ${select('deck', 'Deck', start, opts)}
      <div id="newDeckWrap" ${start === NEW_DECK ? '' : raw('hidden')}>
        ${field('newDeck', 'New deck name', '', { placeholder: 'e.g. Upper limb' })}
      </div>
      ${area('text', 'Cards', '', {
        rows: 8,
        placeholder: 'Origin of biceps brachii :: Supraglenoid tubercle\nWhat does the phrenic nerve supply | Diaphragm\nThe {{sinoatrial node}} sets the pace',
      })}
      <div class="hint">
        Separate the two sides with <b>::</b> or <b>|</b> or a tab. Wrap a phrase in
        <b>{{braces}}</b> to blank it out instead. A line on its own becomes a prompt you can fill in later.
      </div>
      <div class="note mt" id="parsePreview">Nothing parsed yet.</div>`,
    footer: html`<button class="btn quiet" data-sheet-close>Cancel</button>
      <button class="btn primary" data-act="addCardsSave">Add</button>`,
    onMount(root) {
      const deckSel = root.querySelector('[name="deck"]');
      const wrap = root.querySelector('#newDeckWrap');
      const ta = root.querySelector('[name="text"]');
      const prev = root.querySelector('#parsePreview');

      deckSel.addEventListener('change', () => { wrap.hidden = deckSel.value !== NEW_DECK; });

      const update = () => {
        const found = parseCards(ta.value, null);
        const cloze = found.filter(c => c.type === 'cloze').length;
        const blank = found.filter(c => !c.back && c.type !== 'cloze').length;
        prev.textContent = found.length
          ? `${plural(found.length, 'card')} ready${cloze ? `, ${cloze} with blanks` : ''}${blank ? `, ${blank} missing an answer` : ''}.`
          : 'Nothing parsed yet.';
        prev.className = 'note mt' + (found.length ? ' good' : '');
      };
      ta.addEventListener('input', update);
      setTimeout(() => ta.focus(), 120);
    },
  });
}

/* ---------- browse ---------- */
function deckName(doc, id) {
  return doc.decks.find(d => d.id === id)?.name || 'No deck';
}

function openBrowse(app, deckId, q) {
  const doc = app.doc;

  const render = (query, deck) => {
    const list = doc.cards.filter(c =>
      (!deck || c.deck === deck) &&
      (!query || (c.front + ' ' + c.back + ' ' + (c.tags || []).join(' ')).toLowerCase().includes(query.toLowerCase())));
    return str(list.length
      ? html`<ul class="list">
          ${list.slice(0, 200).map(c => html`
            <li class="${c.suspended ? 'is-done' : ''}">
              <button class="body" data-act="editCardAct" data-card="${c.id}" style="text-align:left">
                <div class="title">${c.front.slice(0, 90)}</div>
                <div class="meta">
                  ${deckName(doc, c.deck)}
                  ${c.state === 'new' ? ' · new' : c.ivl ? ` · every ${c.ivl < 1 ? 'day' : Math.round(c.ivl) + 'd'}` : ''}
                  ${c.lapses ? ` · ${c.lapses} lapses` : ''}
                </div>
              </button>
              ${isLeech(c) ? html`<span class="chip warn">sticky</span>` : ''}
              <span class="chev">${icon('chev')}</span>
            </li>`)}
          ${list.length > 200 ? html`<li><div class="meta">Showing the first 200 of ${list.length}.</div></li>` : ''}
        </ul>`
      : html`<div class="empty"><b>Nothing found</b>Try a different word.</div>`);
  };

  openSheet({
    title: 'Browse',
    sub: `${doc.cards.length} cards`,
    body: html`
      <input class="in mt" id="browseQ" placeholder="Search question, answer or tag" value="${q}">
      <select class="in mt" id="browseDeck">
        <option value="">Every deck</option>
        ${doc.decks.map(d => html`
          <option value="${d.id}" ${d.id === deckId ? raw('selected') : ''}>${d.name}</option>`)}
      </select>
      <div id="browseList" class="mt">${raw(render(q, deckId))}</div>`,
    onMount(root) {
      const input = root.querySelector('#browseQ');
      const sel = root.querySelector('#browseDeck');
      const list = root.querySelector('#browseList');
      const update = () => { list.innerHTML = render(input.value, sel.value || null); };
      input.addEventListener('input', update);
      sel.addEventListener('change', update);
    },
  });
}

/* ---------- edit one card ---------- */
function editCard(app, id) {
  const doc = app.doc;
  const c = doc.cards.find(x => x.id === id);
  if (!c) { toast('That card is gone'); return; }
  const nextDue = c.state === 'new' ? 'not started'
    : c.due <= Date.now() ? 'due now'
      : niceDate(ds(new Date(c.due)));

  openSheet({
    title: 'Card',
    sub: `${c.reps} reviews · ${c.lapses} lapses · ${nextDue}`,
    body: html`
      ${isLeech(c) ? html`
        <div class="note warn">
          Forgotten ${c.lapses} times. That is usually two facts in one coat — splitting it works
          far better than another pass at it.
        </div>` : ''}
      ${area('front', 'Question', c.front, { rows: 3, hint: 'Wrap a phrase in {{braces}} to blank it out instead.' })}
      ${area('back', 'Answer', c.back, { rows: 3 })}
      ${select('deck', 'Deck', c.deck, doc.decks.map(d => [d.id, d.name]))}
      ${field('tags', 'Tags', (c.tags || []).join(' '), { placeholder: 'space separated' })}
      <div class="g2 mt2">
        <button class="btn quiet" data-act="resetCard" data-card="${c.id}">${icon('refresh')} Reset progress</button>
        <button class="btn quiet" data-act="toggleSuspend" data-card="${c.id}">${icon('down')} ${c.suspended ? 'Unbury' : 'Bury'}</button>
      </div>`,
    footer: html`
      <button class="btn danger thin" data-act="deleteCard" data-card="${c.id}" aria-label="Delete">${icon('trash')}</button>
      <button class="btn primary" data-act="saveCard" data-card="${c.id}">Save</button>`,
  });
}
