/* ============================================================
   state.js — schema, seed, migration

   Five things live in here and nothing else:

     cards      deck -> card, and their scheduling
     sessions   what the deep-work timer logged
     hydration  what you drank, per day
     money      what you spent, and on what
     game       which milestones you have already been shown

   Everything else on the progress tab — the streak, the level, the
   personal bests — is *derived* from those logs rather than stored.
   A score that is kept somewhere is a score that can drift away from
   what you actually did, and a stored number is the one thing an
   editable export could inflate.

   Cards used to sit three levels deep (subject -> topic -> card). They
   are two now, and `normalize` folds an old document's subjects and
   topics into one flat list of decks without losing a card.
   ============================================================ */

import { uid, ds } from './util.js';

export const SCHEMA = 7;

const CARD_STATES = new Set(['new', 'learning', 'review', 'relearning']);

/* Keys from every earlier version of this app. Listed once and dropped
   on load, so nothing downstream has to keep asking whether a document
   might still have a timetable in it. */
const RETIRED = [
  'routines', 'schedule', 'boxes', 'days', 'tasks', 'lookups', 'protocol',
  'deadlines', 'training', 'activeTraining', 'program', 'body', 'workouts',
  'customExercises', 'activeWorkout',
];
const RETIRED_SETTINGS = [
  'startDate', 'rampStart', 'rampOverride', 'modeOverride', 'winThreshold',
  'train', 'identity', 'calendarDirty',
];

/* Topic names that only ever existed because the old model demanded a
   level here. A subject holding nothing but one of these was really
   just a deck, so it becomes one under its own name. */
const FILLER_TOPICS = new Set(['general', 'unsorted', 'recovered', 'from sessions', 'cards']);

/* ---------- seed ---------- */

export function seed() {
  const today = ds();
  return {
    schema: SCHEMA,
    meta: { createdOn: today, savedAt: Date.now(), app: 'engine' },

    settings: {
      theme: 'dark',
      accent: 'default',
      density: 'normal',
      clock24: false,
      sound: true,
      haptics: true,
      confetti: true,

      /* Nudges. Every one is switchable and every one respects quiet
         hours. */
      notif: {
        enabled: true,
        asked: false,
        /* gentle / steady / constant. The dial moves the gap between any
           two nudges and how often one rule may repeat itself, which is
           the only honest way to answer "more" without answering it with
           eleven notifications in a stack. */
        intensity: 'steady',
        quietFrom: '23:15',
        quietTo: '06:30',
        cardsReminder: true,
        cardsAt: '21:00',
        focusIdle: true,
        focusIdleAt: '17:00',
        water: true,
        money: true,
        shutdown: true,
        shutdownAt: '22:30',
      },

      /* Work, break, rounds. A session ends on work — see buildPhases. */
      focus: {
        presets: [
          { id: 'f25', name: 'Classic', work: 25, brk: 5, rounds: 4 },
          { id: 'f45', name: 'Deep', work: 45, brk: 10, rounds: 2 },
          { id: 'f50', name: 'Exam', work: 50, brk: 10, rounds: 3 },
          { id: 'f90', name: 'Long', work: 90, brk: 20, rounds: 1 },
        ],
        defaultPreset: 'f45',
        askThreeThings: true,
        dailyGoalMin: 120,
      },

      reel: {
        newPerDay: 15,
        maxPerSession: 120,
      },

      /* Water. A target, the sizes you actually drink in, the hours you
         are awake for, and how often to ask. The reminder is spaced from
         your last drink rather than fired on the hour, so drinking early
         moves the next one along instead of being ignored. */
      water: {
        on: true,
        unit: 'ml',
        targetMl: 2500,
        glassMl: 250,
        bottleMl: 750,
        everyMin: 90,
        fromAt: '08:00',
        toAt: '22:00',
      },

      /* Pocket money. An allowance, a period it arrives on, and the
         categories you actually spend in. Everything else — what is
         left, what is safe to spend today, whether you are ahead of
         pace — is worked out from the entries rather than stored. */
      money: {
        on: true,
        symbol: '₹',
        period: 'month',        // 'month' or 'week'
        allowance: 5000,
        startDay: 1,            // day of the month it lands, or 1 = Monday for a weekly one
        carryOver: false,       // what is left rolls into the next period
        askAt: '21:00',
      },

      immersive: true,

      /* Three slow breaths before a focus block. Twenty seconds that put
         you in the room you are actually in, which is the only place the
         work can happen. Off is one tap in Focus settings. */
      arrive: true,

      lastBackup: null,
      backupReminderDays: 7,
      onboarded: false,
    },

    /* One level. A card points at a deck, and that is the whole shape. */
    decks: [],
    cards: [],
    reviews: [],

    sessions: [],
    activeFocus: null,

    /* hydration.days['YYYY-MM-DD'] = { ml, log:[{ id, at, ml }] } */
    hydration: { days: {} },

    /* money.entries[] = { id, at, date, amount, cat, note }
       The categories are editable; these are a starting set, spread by
       golden angle so the pie never puts two similar colours together. */
    money: {
      entries: [],
      cats: seedCats(),
    },

    /* The only thing the progress tab keeps rather than derives: when
       each milestone was first reached, so it can be announced once and
       then stop being news. */
    game: { seen: {} },

    notified: {},
  };
}

/* ---------- money ---------- */
export const CAT_ICONS = ['cup', 'bolt', 'book', 'bell', 'spark', 'heart', 'cart', 'note'];

function seedCats() {
  return [
    ['Food', 'cup'],
    ['Travel', 'bolt'],
    ['Study', 'book'],
    ['Phone', 'bell'],
    ['Fun', 'spark'],
    ['Other', 'note'],
  ].map(([name, icon], i) => ({
    id: 'ct_' + name.toLowerCase(),
    name,
    icon,
    color: Math.round((i * GOLDEN) % 360),
  }));
}

/** The category called `name`, created if it is not there yet. */
export function ensureCat(doc, name = 'Other') {
  const want = String(name).trim() || 'Other';
  const hit = doc.money.cats.find(c => c.name.toLowerCase() === want.toLowerCase());
  if (hit) return hit.id;
  const cat = {
    id: uid('ct'),
    name: want,
    icon: 'note',
    color: Math.round((doc.money.cats.length * GOLDEN) % 360),
  };
  doc.money.cats.push(cat);
  return cat.id;
}

function migrateMoney(doc, base) {
  const m = doc.money = (doc.money && typeof doc.money === 'object') ? doc.money : {};
  if (!Array.isArray(m.cats) || !m.cats.length) m.cats = seedCats();
  m.cats.forEach((c, i) => {
    if (!c.id) c.id = uid('ct');
    if (!c.name) c.name = 'Other';
    if (!c.icon) c.icon = 'note';
    if (typeof c.color !== 'number') c.color = Math.round((i * GOLDEN) % 360);
  });

  if (!Array.isArray(m.entries)) m.entries = [];
  const catIds = new Set(m.cats.map(c => c.id));
  let spare = null;
  m.entries = m.entries
    .filter(e => e && Number(e.amount) > 0 && e.date)
    .map(e => {
      if (!catIds.has(e.cat)) {
        /* An entry whose category was deleted out from under it still
           counts towards the total but belongs to no slice of the pie,
           so the pie and the total would disagree. Give it somewhere. */
        if (!spare) { spare = ensureCat(doc, 'Other'); catIds.add(spare); }
        e.cat = spare;
      }
      return {
        id: e.id || uid('mv'),
        at: Number(e.at) || 0,
        date: String(e.date),
        amount: Math.round(Number(e.amount) * 100) / 100,
        cat: e.cat,
        note: typeof e.note === 'string' ? e.note : '',
      };
    })
    .sort((a, b) => (b.at - a.at) || b.date.localeCompare(a.date));
}

/* ---------- normalisation ----------
   Runs on every load. Fills anything missing without destroying anything
   present, so a backup from an older build still opens cleanly. */
function fillDefaults(target, defaults) {
  for (const k of Object.keys(defaults)) {
    const d = defaults[k];
    if (target[k] === undefined || target[k] === null) {
      target[k] = typeof d === 'object' && d !== null && !Array.isArray(d) ? JSON.parse(JSON.stringify(d)) : d;
    } else if (d && typeof d === 'object' && !Array.isArray(d) && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      fillDefaults(target[k], d);
    }
  }
  return target;
}

/* ---------- cards: one flat list of decks ----------
   Three shapes have to arrive at the same place.

     schema <3   a flat list of decks, which is already what we want
     schema 3-5  subject -> topic, two levels where one would do
     schema 6    already flat

   Folding two levels into one is the only lossy-looking step, so it is
   done by name rather than by deletion: a subject that held one
   throwaway topic ("General", "Unsorted") becomes a deck under the
   subject's own name, and a subject with real topics in it gives each
   topic a deck, prefixed with the subject when the bare name would
   collide with something else. No card ever changes hands. */
function migrateCards(doc, base) {
  if (!Array.isArray(doc.decks)) doc.decks = [];
  const subjects = Array.isArray(doc.subjects) ? doc.subjects.filter(x => x && x.id) : [];

  if (subjects.length) {
    const nameOf = new Map(subjects.map(s => [s.id, String(s.name || 'Cards').trim() || 'Cards']));
    const perSubject = new Map();
    for (const d of doc.decks) {
      if (!d || !d.id) continue;
      const sid = nameOf.has(d.subject) ? d.subject : subjects[0].id;
      if (!perSubject.has(sid)) perSubject.set(sid, []);
      perSubject.get(sid).push(d);
    }

    const taken = new Set();
    /* Two subjects can easily hold a topic of the same name — every
       subject has an "Introduction". The first one keeps the bare name
       and the rest are qualified by their subject, which is the
       disambiguation a person would have written themselves. Numbering
       is the last resort and should almost never be reached. */
    const unique = (want, qualified) => {
      const free = n => !taken.has(n.toLowerCase());
      let name = want;
      if (!free(name) && qualified && free(qualified)) name = qualified;
      let n = 2;
      while (!free(name)) name = `${qualified || want} ${n++}`;
      taken.add(name.toLowerCase());
      return name;
    };

    const flat = [];
    for (const s of subjects) {
      const topics = perSubject.get(s.id) || [];
      const subName = nameOf.get(s.id);
      const filler = t => FILLER_TOPICS.has(String(t.name || '').trim().toLowerCase());
      for (const t of topics) {
        /* A nothing-topic — "General", "Unsorted" — was never a level,
           it was scaffolding, so the deck takes the subject's name. A
           topic with a real name of its own keeps it. */
        const topicName = String(t.name || '').trim();
        const bare = (!topicName || filler(t)) ? subName : topicName;
        const qualified = (!topicName || filler(t)) ? subName : `${subName} · ${topicName}`;
        flat.push({
          id: t.id,
          name: unique(bare, qualified),
          color: Math.round((flat.length * GOLDEN) % 360),
        });
      }
      // A subject with no topics but cards pointing nowhere still needs a home.
      if (!topics.length && doc.cards.some(c => c.deck === s.id)) {
        const id = uid('dk');
        flat.push({ id, name: unique(subName, subName), color: Math.round((flat.length * GOLDEN) % 360) });
        for (const c of doc.cards) if (c.deck === s.id) c.deck = id;
      }
    }
    doc.decks = flat;
  }

  delete doc.subjects;

  doc.decks.forEach((d, i) => {
    if (!d.id) d.id = uid('dk');
    if (!d.name) d.name = 'Deck';
    if (typeof d.color !== 'number') d.color = Math.round((i * GOLDEN) % 360);
    delete d.subject;
  });

  // Every card belongs to a deck that exists.
  const deckIds = new Set(doc.decks.map(d => d.id));
  let spare = null;
  for (const c of doc.cards) {
    if (deckIds.has(c.deck)) continue;
    if (!spare) {
      spare = { id: uid('dk'), name: 'Recovered', color: nextHue(doc) };
      doc.decks.push(spare);
      deckIds.add(spare.id);
    }
    c.deck = spare.id;
  }
  if (!doc.decks.length && doc.cards.length) doc.decks.push({ id: uid('dk'), name: 'Cards', color: 0 });
}

/* ---------- deck colour ----------
   A deck's dot exists to make a list of eight scannable without reading
   any of it, which means the only property it needs is being unlike the
   dots either side of it. Hashing the name does not give that: "Upper
   limb", "Physiology" and "Biochem" hash to 256, 269 and 245, which is
   twenty-five degrees of the wheel and three dots nobody can tell apart.

   Stepping by the golden angle instead spreads any number of decks as
   far apart as they can go, and keeps doing so as more are added. */
const GOLDEN = 137.508;
export function nextHue(doc) {
  return Math.round((doc.decks.length * GOLDEN) % 360);
}

/** The deck called `name`, created if it is not there yet. */
export function ensureDeck(doc, name = 'Cards') {
  const want = String(name).trim() || 'Cards';
  const hit = doc.decks.find(d => d.name.toLowerCase() === want.toLowerCase());
  if (hit) return hit.id;
  const deck = { id: uid('dk'), name: want, color: nextHue(doc) };
  doc.decks.push(deck);
  return deck.id;
}

/* ---------- hydration ----------
   A day is a total and the drinks that made it. The total is stored
   rather than summed on read, because it is read several times a second
   by the ring — and recomputed here on load, so a hand-edited export
   cannot leave the two disagreeing. */
function migrateWater(doc) {
  const h = doc.hydration = (doc.hydration && typeof doc.hydration === 'object') ? doc.hydration : {};
  if (!h.days || typeof h.days !== 'object') h.days = {};
  for (const key of Object.keys(h.days)) {
    const day = h.days[key];
    if (!day || typeof day !== 'object') { delete h.days[key]; continue; }
    if (!Array.isArray(day.log)) day.log = [];
    day.log = day.log
      .filter(e => e && Number(e.ml) > 0)
      .map(e => ({ id: e.id || uid('w'), at: Number(e.at) || 0, ml: Math.round(Number(e.ml)) }));
    /* The log is the source of truth when there is one. When there is
       not, the stored total is all that is left of that day, and
       throwing it away because it cannot be re-derived would be the
       migration silently deleting data it merely failed to check. */
    const summed = day.log.reduce((a, e) => a + e.ml, 0);
    day.ml = day.log.length ? summed : Math.max(0, Math.round(Number(day.ml) || 0));
    if (!day.ml) delete h.days[key];
  }
}

export function normalize(doc) {
  const base = seed();
  if (!doc || typeof doc !== 'object') return base;

  fillDefaults(doc, { settings: base.settings, meta: base.meta });

  doc.schema = SCHEMA;
  for (const k of RETIRED) delete doc[k];
  for (const k of RETIRED_SETTINGS) delete doc.settings[k];

  if (!Array.isArray(doc.decks)) doc.decks = [];
  for (const k of ['cards', 'reviews', 'sessions']) {
    if (!Array.isArray(doc[k])) doc[k] = [];
  }
  migrateCards(doc, base);
  migrateWater(doc);
  migrateMoney(doc, base);
  if (!doc.notified || typeof doc.notified !== 'object') doc.notified = {};
  if (!doc.game || typeof doc.game !== 'object') doc.game = { seen: {} };
  if (!doc.game.seen || typeof doc.game.seen !== 'object') doc.game.seen = {};

  /* Sessions carry the length of one work phase, which is what the
     depth weighting reads. Older records did not, so it is reconstructed
     from what they did keep. */
  for (const x of doc.sessions) {
    if (!x || typeof x !== 'object') continue;
    if (typeof x.workMin !== 'number' || !isFinite(x.workMin) || x.workMin <= 0) {
      const rounds = Math.max(1, Number(x.rounds) || 1);
      const planned = Number(x.plannedMinutes) || Number(x.minutes) || 0;
      x.workMin = Math.max(1, Math.round(planned / rounds));
    }
  }
  doc.sessions = doc.sessions.filter(x => x && x.id && x.date);

  const w = doc.settings.water;
  w.targetMl = clampNum(w.targetMl, 500, 8000, base.settings.water.targetMl);
  w.glassMl = clampNum(w.glassMl, 50, 2000, base.settings.water.glassMl);
  w.bottleMl = clampNum(w.bottleMl, 100, 4000, base.settings.water.bottleMl);
  w.everyMin = clampNum(w.everyMin, 15, 360, base.settings.water.everyMin);
  if (w.unit !== 'oz') w.unit = 'ml';

  const mo = doc.settings.money;
  mo.allowance = Math.max(0, Math.round((Number(mo.allowance) || 0) * 100) / 100);
  if (mo.period !== 'week') mo.period = 'month';
  mo.startDay = mo.period === 'week'
    ? clampNum(mo.startDay, 0, 6, 1)
    : clampNum(mo.startDay, 1, 28, 1);
  mo.symbol = String(mo.symbol || '₹').slice(0, 3) || '₹';

  const f = doc.settings.focus;
  if (!Array.isArray(f.presets) || !f.presets.length) {
    f.presets = JSON.parse(JSON.stringify(base.settings.focus.presets));
  }
  f.presets = f.presets.filter(p => p && p.id).map(p => ({
    id: p.id,
    name: p.name || 'Preset',
    work: clampNum(p.work, 1, 240, 45),
    brk: clampNum(p.brk, 0, 60, 0),
    rounds: clampNum(p.rounds, 1, 12, 1),
  }));
  if (!f.presets.length) f.presets = JSON.parse(JSON.stringify(base.settings.focus.presets));
  if (!f.presets.some(p => p.id === f.defaultPreset)) f.defaultPreset = f.presets[0].id;
  f.dailyGoalMin = clampNum(f.dailyGoalMin, 0, 960, base.settings.focus.dailyGoalMin);

  // Cards: guarantee scheduling fields, and a topic that exists.
  const deckIds = new Set(doc.decks.map(d => d.id));
  let orphanDeck = null;
  doc.cards = doc.cards.filter(c => c && typeof c === 'object');
  for (const c of doc.cards) {
    if (!c.id) c.id = uid('c');
    if (typeof c.reps !== 'number' || !isFinite(c.reps)) c.reps = 0;
    if (typeof c.lapses !== 'number' || !isFinite(c.lapses)) c.lapses = 0;
    if (typeof c.ease !== 'number' || !isFinite(c.ease)) c.ease = 2.5;
    if (typeof c.ivl !== 'number' || !isFinite(c.ivl)) c.ivl = 0;
    if (typeof c.due !== 'number' || !isFinite(c.due)) c.due = 0;
    if (typeof c.step !== 'number' || !isFinite(c.step)) c.step = 0;
    if (!CARD_STATES.has(c.state)) c.state = c.reps ? 'review' : 'new';
    if (!c.type) c.type = 'basic';
    if (!c.created) c.created = ds();
    if (typeof c.front !== 'string') c.front = String(c.front ?? '');
    if (typeof c.back !== 'string') c.back = String(c.back ?? '');
    if (!Array.isArray(c.tags)) c.tags = [];
    /* A card whose topic was deleted out from under it — which only an
       edited or half-merged export can produce — counts towards the total
       on the Cards tab and towards the badge, but belongs to no topic, so
       there is no screen anywhere that can reach it. Give it somewhere to
       live instead of leaving it haunting the counts. */
    if (!deckIds.has(c.deck)) {
      if (!orphanDeck) orphanDeck = ensureDeck(doc, 'Recovered');
      c.deck = orphanDeck;
      deckIds.add(orphanDeck);
    }
  }

  /* A session that is hours past its own end was not being watched.

     Everything in session.js derives from timestamps on purpose, so that
     locking your phone for an hour and coming back gives the right
     answer: you were still working, the clock was still running. Applied
     to a session left open overnight, though, the same arithmetic credits
     every phase that elapsed while you were asleep and then offers to log
     an hour and a half of focus nobody did.

     So the test is how long past its planned finish the thing is, not
     which day it started on — a session begun at half eleven and picked
     up at ten past midnight is still a session, and one whose end went by
     six hours ago is not. */
  if (staleSession(doc.activeFocus)) doc.activeFocus = null;

  return doc;
}

function clampNum(v, lo, hi, fallback) {
  const n = Math.round(Number(v));
  if (!isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

/* Two hours past the end is the grace: long enough that a phone left
   face-down through a break is untouched, short enough that nothing
   survives a night. */
const STALE_GRACE_MS = 2 * 60 * 60 * 1000;

function staleSession(s) {
  if (!s) return false;
  const started = Number(s.startedAt) || 0;
  if (!started) return true;
  const planned = Array.isArray(s.phases)
    ? s.phases.reduce((a, p) => a + (Number(p?.sec) || 0), 0) * 1000
    : 0;
  return Date.now() - started > planned + STALE_GRACE_MS;
}

export { uid, ds };
