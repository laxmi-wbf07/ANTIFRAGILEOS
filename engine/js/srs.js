/* ============================================================
   srs.js — scheduling, queue, parsing

   An SM-2 variant with learning steps. The point of using real
   scheduling is that the reward in the feed becomes contingent on
   actually remembering, not on swiping. Grading is the only thing
   that moves a card forward.

   Grades: 1 Again · 2 Hard · 3 Good · 4 Easy. The feed only ever sends
   1 and 3 — it reads them off the gesture rather than asking — but the
   other two stay because the algorithm is defined in terms of all four.
   ============================================================ */

import { uid, ds, pd, esc, clamp, round } from './util.js';

const MIN = 60_000;
const DAY = 86_400_000;

const LEARN_STEPS = [1 * MIN, 10 * MIN];
const RELEARN_STEPS = [10 * MIN];
const GRAD_IVL = 1;
const EASY_IVL = 4;
const EASE_MIN = 1.3;
const EASE_MAX = 3.2;
const MAX_IVL = 365 * 2;

export function newCard(fields = {}) {
  return Object.assign({
    id: uid('c'),
    deck: null,
    type: 'basic',
    front: '',
    back: '',
    tags: [],
    state: 'new',
    step: 0,
    ease: 2.5,
    ivl: 0,
    reps: 0,
    lapses: 0,
    due: 0,
    last: 0,
    created: ds(),
    suspended: false,
  }, fields);
}

function fuzz(days) {
  if (days < 2.5) return days;
  const f = days * 0.05;
  return days + (Math.random() * 2 - 1) * Math.max(1, f);
}

/** Pure: what would this card look like after grade g? */
export function preview(card, g, now = Date.now()) {
  const c = { ...card };
  const isLearn = c.state === 'new' || c.state === 'learning';
  const isRelearn = c.state === 'relearning';

  if (isLearn || isRelearn) {
    const steps = isRelearn ? RELEARN_STEPS : LEARN_STEPS;
    if (g === 1) {
      c.step = 0;
      c.state = isRelearn ? 'relearning' : 'learning';
      c.due = now + steps[0];
      c.ivl = 0;
      return c;
    }
    if (g === 2) {
      c.state = isRelearn ? 'relearning' : 'learning';
      c.due = now + Math.round(steps[Math.min(c.step, steps.length - 1)] * 1.5);
      c.ivl = 0;
      return c;
    }
    if (g === 4) {
      c.state = 'review';
      c.step = 0;
      c.ivl = isRelearn ? Math.max(1, Math.round(c.ivl * 0.7) || 1) : EASY_IVL;
      c.due = now + fuzz(c.ivl) * DAY;
      return c;
    }
    // good
    const nextStep = c.step + 1;
    if (nextStep >= steps.length) {
      c.state = 'review';
      c.step = 0;
      c.ivl = isRelearn ? Math.max(1, Math.round(c.ivl * 0.5) || 1) : GRAD_IVL;
      c.due = now + fuzz(c.ivl) * DAY;
    } else {
      c.step = nextStep;
      c.state = isRelearn ? 'relearning' : 'learning';
      c.due = now + steps[nextStep];
      c.ivl = 0;
    }
    return c;
  }

  // review
  const elapsedDays = c.last ? Math.max(0, (now - c.last) / DAY) : c.ivl;
  const base = Math.max(c.ivl, 1);
  if (g === 1) {
    c.lapses++;
    c.ease = clamp(c.ease - 0.2, EASE_MIN, EASE_MAX);
    c.state = 'relearning';
    c.step = 0;
    c.ivl = Math.max(1, Math.round(base * 0.45));
    c.due = now + RELEARN_STEPS[0];
    return c;
  }
  if (g === 2) {
    c.ease = clamp(c.ease - 0.15, EASE_MIN, EASE_MAX);
    c.ivl = clamp(round(base * 1.2, 1), 1, MAX_IVL);
  } else if (g === 3) {
    c.ivl = clamp(round(Math.max(base + 1, (base + elapsedDays / 4) * c.ease), 1), 1, MAX_IVL);
  } else {
    c.ease = clamp(c.ease + 0.15, EASE_MIN, EASE_MAX);
    c.ivl = clamp(round(Math.max(base + 2, (base + elapsedDays / 2) * c.ease * 1.25), 1), 1, MAX_IVL);
  }
  c.state = 'review';
  c.step = 0;
  c.due = now + fuzz(c.ivl) * DAY;
  return c;
}

/** Apply a grade in place and return a review log row. */
export function grade(card, g, now = Date.now()) {
  const before = { state: card.state, ivl: card.ivl };
  const next = preview(card, g, now);
  Object.assign(card, next);
  card.reps++;
  card.last = now;
  return {
    id: uid('rv'),
    card: card.id,
    date: ds(),
    at: now,
    g,
    from: before.state,
    to: card.state,
    ivl: card.ivl,
  };
}

/* ---------- counts ----------
   The review log only ever grows or gets trimmed, so its length plus the
   date is enough of a fingerprint to cache on. Without this, drawing a
   list of topics rescanned every review once per row. */
let nitKey = '', nitVal = 0;
export function newIntroducedToday(doc) {
  const today = ds();
  const revs = doc.reviews || [];
  const key = today + '|' + revs.length;
  if (key === nitKey) return nitVal;
  const seen = new Set();
  for (const r of revs) {
    if (r.date === today && r.from === 'new') seen.add(r.card);
  }
  nitKey = key; nitVal = seen.size;
  return nitVal;
}

function blank(cap) {
  return { due: 0, learn: 0, new: 0, newAll: 0, total: 0, buried: 0, cap };
}

function tally(t, c, now) {
  t.total++;
  if (c.suspended) { t.buried++; return; }
  if (c.state === 'new') t.newAll++;
  else if (c.due <= now) { if (c.state === 'learning' || c.state === 'relearning') t.learn++; else t.due++; }
}

/**
 * `where` is a deck id, an array or Set of deck ids, or null for everything.
 */
/* The tab badge asks for this on every paint, and it is a scan of every
   card you own. Every write bumps meta.rev, so that plus the minute is an
   exact fingerprint of anything that could change the answer. */
let cKey = '', cVal = null;
export function counts(doc, where = null, now = Date.now()) {
  if (where == null) {
    const k = (doc.meta?.rev || 0) + '|' + Math.floor(now / 60000) + '|' + doc.cards.length;
    if (k === cKey && cVal) return cVal;
    const t = tallyAll(doc, null, now);
    cKey = k; cVal = t;
    return t;
  }
  return tallyAll(doc, where, now);
}

function tallyAll(doc, where, now) {
  const cap = Math.max(0, (doc.settings.reel?.newPerDay ?? 15) - newIntroducedToday(doc));
  const set = where == null ? null
    : (where instanceof Set ? where : new Set(Array.isArray(where) ? where : [where]));
  const t = blank(cap);
  for (const c of doc.cards) {
    if (set && !set.has(c.deck)) continue;
    tally(t, c, now);
  }
  t.new = Math.min(t.newAll, cap);
  return t;
}

/**
 * One pass over every card, giving per-deck and overall counts.
 * The cards screen draws the whole list from this instead of a scan per row.
 */
export function tree(doc, now = Date.now()) {
  const cap = Math.max(0, (doc.settings.reel?.newPerDay ?? 15) - newIntroducedToday(doc));
  const byDeck = new Map();
  for (const d of doc.decks) byDeck.set(d.id, blank(cap));
  const all = blank(cap);

  for (const c of doc.cards) {
    const d = byDeck.get(c.deck);
    if (d) tally(d, c, now);
    tally(all, c, now);
  }
  for (const t of [...byDeck.values(), all]) t.new = Math.min(t.newAll, cap);
  return { byDeck, all, cap };
}

/** Ready-to-study count: what the badges and buttons show. */
export function ready(t) {
  return t ? t.due + t.learn + t.new : 0;
}

/**
 * Cards that keep coming back.
 *
 * A card you have forgotten eight times is not a card you are failing to
 * learn, it is a card that is badly written — two facts in one, or a
 * question with more than one right answer. Flagging them is the single
 * cheapest thing a card app can do for the quality of a deck, because the
 * fix is to rewrite the card, not to try harder.
 */
export const LEECH_AT = 6;
export function leeches(doc) {
  return doc.cards.filter(c => !c.suspended && (c.lapses || 0) >= LEECH_AT);
}
export function isLeech(c) {
  return !!c && !c.suspended && (c.lapses || 0) >= LEECH_AT;
}

/* ---------- the queue ----------
   Order: anything in learning that is ready, then reviews, then a
   capped number of new cards, shuffled together so it does not feel
   like a worksheet. When that runs dry the feed keeps going with
   cards due soonest, so scrolling never hits a wall. */
export function buildQueue(doc, { deck = null, mode = 'due', limit = null, now = Date.now() } = {}) {
  const set = deck == null ? null
    : (deck instanceof Set ? deck : new Set(Array.isArray(deck) ? deck : [deck]));
  const pool = doc.cards.filter(c => !c.suspended && (!set || set.has(c.deck)));
  const max = limit ?? (doc.settings.reel?.maxPerSession ?? 120);

  if (mode === 'cram') return shuffle(pool.slice()).slice(0, max);

  if (mode === 'ahead') {
    return pool
      .filter(c => c.state !== 'new')
      .sort((a, b) => a.due - b.due)
      .slice(0, max);
  }

  if (mode === 'starred') {
    return shuffle(pool.filter(c => c.starred)).slice(0, max);
  }

  if (mode === 'hardest') {
    return pool
      .filter(c => c.lapses > 0)
      .sort((a, b) => b.lapses - a.lapses || a.ease - b.ease)
      .slice(0, max);
  }

  if (mode === 'recent') {
    return pool.slice().sort((a, b) => String(b.created).localeCompare(String(a.created))).slice(0, max);
  }

  // default: what is actually due
  const learning = pool.filter(c => (c.state === 'learning' || c.state === 'relearning') && c.due <= now).sort((a, b) => a.due - b.due);
  const reviews = shuffle(pool.filter(c => c.state === 'review' && c.due <= now));
  const cap = Math.max(0, (doc.settings.reel?.newPerDay ?? 15) - newIntroducedToday(doc));
  const fresh = pool.filter(c => c.state === 'new').slice(0, cap);

  const body = interleave(reviews, fresh);
  return [...learning, ...body].slice(0, max);
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Spread the shorter list evenly through the longer one. */
function interleave(main, extra) {
  if (!extra.length) return main;
  if (!main.length) return extra;
  const out = [];
  const every = Math.max(1, Math.floor(main.length / extra.length));
  let ei = 0;
  for (let i = 0; i < main.length; i++) {
    out.push(main[i]);
    if (ei < extra.length && (i + 1) % every === 0) out.push(extra[ei++]);
  }
  while (ei < extra.length) out.push(extra[ei++]);
  return out;
}

/* ---------- cloze ----------
   {{text}} marks a gap. On the front it is a blank, on the back it lights up. */
export function hasCloze(s) {
  return /\{\{[\s\S]+?\}\}/.test(String(s || ''));
}
export function renderCloze(text, revealed) {
  const s = String(text || '');
  let out = '', last = 0;
  const re = /\{\{([\s\S]+?)\}\}/g;
  let m;
  while ((m = re.exec(s))) {
    out += esc(s.slice(last, m.index));
    out += revealed
      ? `<span class="cloze">${esc(m[1])}</span>`
      : `<span class="cloze blank">${esc(m[1])}</span>`;
    last = m.index + m[0].length;
  }
  out += esc(s.slice(last));
  return out;
}

/* ---------- parsing ----------
   Accepts, per line or per paragraph:
     Question :: Answer
     Question | Answer
     [Question] [Answer]
     Question<TAB>Answer
     Question
     Answer            (two lines, blank line between pairs)
     A sentence with {{a gap}}        -> cloze
   Trailing #tags are pulled out of the answer. */
export function parseCards(text, deck) {
  const raw = String(text || '').replace(/\r/g, '');
  const cards = [];
  const push = (front, back, type = 'basic') => {
    front = front.trim(); back = (back || '').trim();
    if (!front) return;
    const tags = [];
    back = back.replace(/(^|\s)#([\w-]+)/g, (_, sp, t) => { tags.push(t); return ''; }).trim();
    const fTags = [];
    front = front.replace(/(^|\s)#([\w-]+)$/g, (_, sp, t) => { fTags.push(t); return ''; }).trim();
    cards.push(newCard({ deck, front, back, type, tags: tags.concat(fTags) }));
  };

  const paragraphs = raw.split(/\n{2,}/);
  const multiline = paragraphs.length > 1 && paragraphs.every(p => p.trim().split('\n').length <= 6);

  for (const para of paragraphs) {
    const lines = para.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;

    // A paragraph of exactly two lines with no delimiter is a Q/A pair.
    const anyDelim = lines.some(l => /\s::\s|\t|\s\|\s|^\s*\[.+?\]\s*\[.+?\]\s*$/.test(l));
    if (multiline && lines.length === 2 && !anyDelim && !hasCloze(lines[0])) {
      push(lines[0], lines[1]);
      continue;
    }

    for (const line of lines) {
      let m;
      if ((m = line.match(/^\s*\[([\s\S]+?)\]\s*\[([\s\S]+)\]\s*$/))) { push(m[1], m[2]); continue; }
      if (line.includes('\t')) { const [a, ...b] = line.split('\t'); push(a, b.join(' ')); continue; }
      if ((m = line.match(/^([\s\S]+?)\s*::\s*([\s\S]+)$/))) { push(m[1], m[2]); continue; }
      if ((m = line.match(/^([\s\S]+?)\s+\|\s+([\s\S]+)$/))) { push(m[1], m[2]); continue; }
      if (hasCloze(line)) { push(line, '', 'cloze'); continue; }
      // A lone line with no answer still becomes a prompt you can fill later.
      push(line, '');
    }
  }
  return cards;
}

export function cardsToText(cards) {
  return cards.map(c => (c.type === 'cloze' ? c.front : `${c.front} :: ${c.back}`)).join('\n');
}

/* ---------- retention ---------- */
export function retention(doc, days = 30) {
  const from = Date.now() - days * DAY;
  let hit = 0, all = 0;
  for (const r of doc.reviews || []) {
    if (r.at < from) continue;
    if (r.from === 'new') continue;
    all++;
    if (r.g >= 3) hit++;
  }
  return all ? hit / all : null;
}

export function matureCount(doc) {
  return doc.cards.filter(c => c.state === 'review' && c.ivl >= 21).length;
}

export function reviewsOn(doc, date) {
  return (doc.reviews || []).filter(r => r.date === date).length;
}

/** Reviews per day over the last `n` days, oldest first, today last. */
export function reviewsPerDay(doc, n = 7, today = ds()) {
  const counted = new Map();
  for (const r of doc.reviews || []) counted.set(r.date, (counted.get(r.date) || 0) + 1);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = pd(today);
    d.setDate(d.getDate() - i);
    const key = ds(d);
    out.push({ date: key, n: counted.get(key) || 0 });
  }
  return out;
}

/** Every date with at least one review, as a Set. Used by the streak. */
export function reviewDates(doc) {
  return new Set((doc.reviews || []).map(r => r.date));
}

/** How many cards you have ever recalled without turning them over. */
export function recalledTotal(doc) {
  let n = 0;
  for (const r of doc.reviews || []) if (r.g >= 3) n++;
  return n;
}

/**
 * Days in a row with at least one card reviewed.
 *
 * Today counts only once something has actually been done on it, so the
 * run does not break at one minute past midnight and reappear in the
 * evening — an uncleared today is skipped rather than counted as a miss.
 */
export function streak(doc) {
  const seen = new Set((doc.reviews || []).map(r => r.date));
  const d = pd(ds());
  if (!seen.has(ds(d))) d.setDate(d.getDate() - 1);
  let run = 0;
  while (run < 400 && seen.has(ds(d))) {
    run++;
    d.setDate(d.getDate() - 1);
  }
  return run;
}

export function forecast(doc, days = 14, now = Date.now()) {
  const out = new Array(days).fill(0);
  for (const c of doc.cards) {
    if (c.suspended || c.state === 'new') continue;
    const d = Math.floor((c.due - now) / DAY);
    if (d >= 0 && d < days) out[d]++;
    else if (d < 0) out[0]++;
  }
  return out;
}
