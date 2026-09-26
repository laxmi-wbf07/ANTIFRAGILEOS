# Engine

Three things, on your own phone: **flash cards**, a **day planner** with a **deep work timer** under
it, and **pocket money** — one honest way of keeping score across them, and one card at the top of
the last tab that says which of them to do next. It works held upright or on its side.
No server, no account, no network calls. Everything is stored locally and can be exported at any time.

---

## Putting it on GitHub Pages

1. Create a repository. `engine` is a good name.
2. Upload every file and folder from here, keeping the structure exactly as it is.
3. Repository **Settings → Pages → Build and deployment**, set Source to **Deploy from a branch**,
   branch `main`, folder `/ (root)`. Save.
4. Wait a minute, then open `https://<your-username>.github.io/engine/` on your phone.
5. Chrome menu → **Add to Home screen**.

The `.nojekyll` file matters — without it GitHub ignores some paths. Don't delete it.

### Updating later

Replace the changed files and bump `CACHE` in `sw.js` (`engine-v19` → `engine-v20`, and so on).
The app then shows a small "update ready" bar instead of swapping code out from under a
running timer. Your data is never touched by an update.

---

## The three things to do once

**Install it.** Running from the home screen gives you a real app window and, more importantly,
makes Android treat your storage as durable instead of something it can clear to free space.

**Turn on notifications.** It asks once, on your first tap. After that the nudges carry buttons —
*Start*, *Review*, *Log it* — so the thing being asked for is one tap from the lock screen
rather than one screen away.

**Export a backup occasionally.** You → Settings → Your data → Export backup. The app nags weekly.

---

## How it works

### Moving around

Four tabs, always in the same order, always in the same place: **Cards**, **Focus**, **Money**,
**You**. A rail slides to the one you are on. A flat sideways flick moves one tab along, number keys
jump straight to one, and the arrow keys step between them. Settings live one level down inside
**You**, because they are a place you go on purpose once and then never again.

A sheet is a screen, so the phone's back gesture and the browser's back button close it rather than
leaving the tab underneath it.

**On its side**, a phone has width to spare and no height, so the tab bar becomes a rail down the left
edge, sheets slide in from the right at full height instead of up from the bottom, the planner puts
the day beside what it can take, and a running session puts the dial beside its controls. A tablet
or a laptop gets the same layout, for the same reason. Notches on either side are respected.

---

### Cards

One level: **deck → card**. A deck is one lecture, one chapter, one language, and that is the whole
shape.

It used to be two — a subject holding topics holding cards — and the cost of that was a screen you
had to navigate before you could do anything, on a tab whose entire job is to get out of the way of
the feed. Two taps to reach a deck, a back button to leave it, and a choice ("which subject?") every
single time you added a card. None of it earned its place. Folding it flat took the tab from two
screens and six sheets down to one screen and three.

So the whole tab is now the button that starts the queue, your decks, and nothing else. Each deck
carries a coloured dot — spaced by golden angle rather than hashed from its name, so eight decks are
eight distinguishable colours instead of three shades of the same blue — and its due count.
Anything rarer than that is behind the two icons in the top bar.

The feed is the point, and it has no buttons at all:

| | |
|---|---|
| drag up | the next card |
| drag down | the one before |
| tap, or drag left or right | turn the card over |
| double tap | keep this one |

The drag is read off the whole window rather than off a card, so a thumb anywhere moves the feed —
including on the two corner buttons, which only act on a press that never moved. A target is a thing
you have to aim at, and not aiming at anything is most of what this tab is for. A flick counts as well
as a long drag, and a finger that arrives mid-animation takes the stack over instead of being ignored,
so going through a queue at speed never drops a swipe.

**The grade is taken from what you did, not from what you pressed.** Move on without turning the card
over and you knew it, so it is marked Good. Turn it over and you did not, so it is marked Again and it
comes back a few cards later in the same sitting. One thumb, one motion, and the schedule stays honest.

**Double tap keeps a card.** It is the one gesture in here that costs nothing and cannot be wrong, so
it does the one thing that cannot be got wrong: a heart, and a mark that lasts. The second tap of the
pair undoes the turn the first one did, so a double tap never grades anything by accident, and *Kept
cards* is a queue of its own in the feed's menu.

**The back of a card is the answer, and nothing else.** Repeating the question on it spent the half
of the card the answer needed, and you were looking at the question a second earlier. A cloze is the
exception, because there the sentence with the blank filled in *is* the answer.

#### Nothing on screen but the card

The card is not a card sitting on a page; it **is** the page, edge to edge, and the only thing on it is
the words. No deck name, no counter, no timer, no chips, no caption under it saying what a swipe does.
Every one of those is a thing the eye checks before it reaches the question, and an app that makes you
read three labels before the prompt is measuring the wrong thing.

What is left is a hairline of progress across the top, and two quiet icons in the corners: close, and a
menu. The deck, how far through you are, the run and every action live behind that menu — where you
look at them on purpose rather than past them on every card. The deck's own colour tints the top of the
question side, just enough to tell two decks apart out of the corner of your eye; the answer side is
told apart by a wash of the accent colour, not by a label.

Nothing inside a card scrolls, because a scroller in there would eat the gesture the whole screen exists
to receive. Long text is fitted to the glass instead: the type steps down until it fits, and re-fits if
you turn the phone.

#### The run

The one number the feed keeps is your **run**: cards recalled back to back without turning one over. It
is the only figure in the app that cannot be farmed, because the sole way to raise it is to actually
remember something — swiping faster does nothing. It is not printed on the cards; every fifth one pulses
the screen in the accent colour, and the total is in the menu and on the card at the end.

Clearing a queue ends on what actually happened: how many, what share you recalled, your best run, and
how many are coming back. That end card is the one screen in the feed allowed words, because it is the
one screen that is not a card.

There is no score inside the feed. No points ticking up on the cards, no level bar across the top, no
daily quota to watch. Reviewing does earn points — see **You** — but they are counted somewhere
else and looked at afterwards, because a number moving while you are trying to remember something is
a number you are reading instead of remembering.

Paste a whole lecture at once. Question and answer can be separated by `::`, `|`, a tab, or
`[brackets]`, or wrap a phrase in `{{braces}}` to blank it out instead. Pick the deck as you paste,
or type a new one straight into the same sheet — choosing "New deck" reveals a name field rather
than sending you to another screen, because leaving the text you just pasted to go and make a deck
is how a paste gets lost.

#### Cards that keep coming back

A card you have forgotten six times is not a card you are failing to learn. It is a card that is
badly written — two facts in one coat, or a question with more than one right answer — and the fix
is to rewrite it, not to grind it. So the app counts lapses and offers you the list: split them, or
bury them. It is the cheapest thing a card app can do for the quality of a deck, and almost none of
them do it.

---

### Focus

One card, and the number you are most likely to want to change is the one thing on it you can move: a
**slider** for how long, with the minutes shown above it, five quick values under it, and the big
button relabelling itself as you drag. Under that, one line says what you have actually built —
*45 min × 2, 10 min off · 1h 40m in total* — and tapping it opens the whole shape: a slider for the
focus, a slider for the break, a stepper for the rounds, that sentence updating live, and your saved
presets under a rule. Anything you build there can be saved as a preset in one tap. Typing a number
into a box is the worst possible way to answer a question you were going to guess at anyway.

Pressing start does not start the clock. Three breaths do, out for longer than in, about twenty
seconds. The gap between deciding to work and working is exactly where the phone gets picked up, and
something physical to do closes it; it also does the one thing that reliably helps attention, which
is to put you in the room you are actually in rather than the one you are worrying about. The X
backs out, the button skips ahead, and one switch in Focus settings turns it off for good.

The timer is derived from timestamps, never from a counter ticking down, so locking your phone
mid-session and coming back an hour later produces the correct state.

A session is rounds of work with breaks between them, and it **ends on work** — so what the start
screen says the session will take is what it takes, and *write three things down from memory* arrives
when the work does.

A running session takes the whole screen: one number, one primary control, one line of guidance. The
top bar goes, because it is empty while the clock runs and the clock wants the room — but the tab bar
stays. Losing the way between tabs is losing the app, and no screen is worth that; the session keeps
its own **‹ Cards** in the top left as well, with `+5` in the top right and *the clock keeps going*
written between them so that is not a thing you have to find out by trying it. Leave the tab and the
session carries on, with a dot on the Focus tab.

Closing a session asks for three things from memory, and anything you write with `::` or
`{{braces}}` becomes a card automatically. That is the loop: studying makes cards, and the cards
come back on their own.

The distraction counter is there because self-monitoring is the single most effective thing in the
behaviour-change literature. Tapping it costs nothing and halves the next pull.

A **daily target** in Focus settings turns on a progress panel, a week of bars with the target drawn
across them, and one evening nudge if you are short of it. Set it to zero and all three disappear.

#### Depth

Fifty minutes in one sitting is not the same work as five tens. The literature is unambiguous and so
is anyone who has tried both, so a session is worth its real minutes multiplied by how unbroken it
was:

| | |
|---|---|
| base | ×1.0 |
| every full 25 minutes in one unbroken work phase | +0.1, up to ×1.4 |
| every pull you counted | −0.05, never below ×0.6 |

A 90-minute block with nothing pulling at it is worth 1.3× its own length. The same 90 minutes as
six broken fifteens is worth 1.0×. Nothing about that is punishment — it is the app agreeing with
you about which of the two was harder.

The multiplier is **live on the running screen, next to the distraction counter**, so tapping the
counter moves it under your thumb rather than revealing the cost at the end. That is the whole
reason to count a pull at all.

Underneath, the tab keeps four numbers that cannot be moved without sitting down: longest session,
best day, what share of your sessions ran to the last round, and the total.

#### Today — the plan

The Focus tab opens on **Today**, with **Timer** one tap along. The plan exists to hand you to the
timer at the right moment, already knowing what the session is for.

**Anchors** are the things that do not move: get ready, class, training, the deep work block,
dinner, wind down, lights out, and on Saturday training and the weekly test. They start as the
one-page plan and every one is editable (the sliders icon, top right). Wake-up is 6:00 on weekdays
and 7:30 at weekends, and the first fifteen minutes after waking are never planned.

**A task** takes ten seconds: a name, *urgent?*, *important?* and a length. Tapping a square of the
matrix answers both questions at once. A deadline within a day makes a task urgent by itself.

| | goes |
|---|---|
| **Q1** urgent + important | into the earliest slot that fits |
| **Q2** important, not urgent | into your fresh hours, spread over the week |
| **Q3** urgent, not important | batched into the evening |
| **Q4** neither | nowhere: parked for a week, then dropped |

**The plan is never stored.** It is rebuilt from *now* every time you look at it, so a lost hour does
not break it. The rest of the day re-flows around what happened, and there is nothing to fix by hand.

**Free time is not capacity.** Each day has two budgets, and the plan stops when one runs out
instead of cramming:

| | weekday | weekend |
|---|---|---|
| hard work (important, 30 min or more), only before 6:30pm | 60 min | 120 min |
| light work, any time | 90 min | 90 min |

That is on top of the anchors, and the deep work block does not count against it. Whatever does not
fit today moves to the next day that has room. Sunday is a rest day: nothing goes on it unless a
deadline forces it. Work already done today counts against today's budget.

**My day changed** takes one of three answers:

- *Something came up* blocks out time from now, and anything planned there moves.
- *Low energy* makes it a half-size day: only Q1, half the limits, 45 minutes of deep work counts,
  and training is the short version.
- *I missed an anchor* makes tomorrow a never-miss-twice day: the anchor is flagged as not optional,
  and tomorrow's hard-work limit is halved so there is energy for it.

The plan only asks you to decide in three places: a task that has moved three times (*do it today,
halve it, drop it*), a task that will not fit before its deadline (*allow it today anyway* lifts the
limits for that one task, today only), and a task that does not fit anywhere this week.

**Start** on a planned task opens the timer already named and already the right length. Finishing
asks whether the task is done; if not, what is left of it goes back on the plan. The block on now
also becomes the "what now" card on the You tab, and a nudge arrives when a planned task or the
deep work block is about to start. Quiet hours still apply, so a 6:15 task only gets a nudge if
quiet hours end before then.

---

### Money

Pocket money, and nothing that turns into a spreadsheet you stop opening. One question at the top —
**can I spend this?** — answered by one number.

An allowance arrives on a day you pick, weekly or monthly. Entries come off it. Three figures are
worked out rather than stored:

| | |
|---|---|
| **left** | the allowance minus what you have spent this period |
| **per day** | what is left, divided by the days still to come |
| **pace** | what you would have spent by now if it were even |

The pace is drawn as a mark on the bar rather than written underneath it, and being ahead of it is
never in red. It is a position, not a verdict, and the useful response is a
smaller number for tomorrow rather than a telling off.

Underneath, a **donut** of where it actually went. A donut rather than a disc because the middle is
the best place on the screen for the total and a disc spends it on a point nobody can read an angle
from. Slices cap at six and the tail folds into one, because a pie with eleven wedges answers
nothing — tap any slice for the entries behind it. Then a bar per day of the period with the
even-spend line across it, and the periods before this one, marked under or over.

Logging is one sheet: an amount, a category, a date that defaults to today. Six categories to start
with, all editable, each with a colour spaced by golden angle so no two slices are the same blue.

**There is no ring for money.** The rings are things you do every day; spending is not, and a
day you spent nothing is a good day rather than an unclosed one. It earns no points either: it is
self-reported, and typing a number is not an achievement. What it
does have is four milestones, and they are about behaviour — finishing a period inside the allowance
— rather than about logging.

---

### You — what now, and how it is going

The top of this tab is the only forward-looking thing on it.

#### What now

One card. One thing, the reason for it, and a button that does it. Never a list, because a list is
the question again.

Nothing in it is a priority you typed in. A to-do list sorted by an urgency you set yourself is just
the list in a different order, and it is wrong within a day. Every candidate scores itself from
facts the app already holds — what the scheduler says is due and how overdue it is, how far off the
day's target you are, what is on your plan right now, what time it actually is.

**One clock, shared by everything.** The day runs from when you are up (the planner's wake-up time) to
when you wind down. Everything measures itself against that one span, which is what stops the
answers contradicting each other: an hour of work is a reasonable suggestion at four and an absurd
one at eleven, and only a shared clock knows the difference.

| | |
|---|---|
| **need** | how much of it is outstanding |
| **pressure** | how far through the day you are |
| **urgency** | need × (0.45 + 0.55 × pressure) |
| **fit** | whether it can actually be done in the time left |
| **score** | urgency × fit, then three adjustments |

The adjustments are the only opinions in it, and all three are about how people behave rather than
how a scheduler would prefer them to:

- **The plan already decided.** A block on your plan, or the deep work block, goes first while it is
  on. The point of planning is not deciding again at the moment of doing.

- **Finishing beats starting.** Something four-fifths done is worth more than something untouched,
  because the last fifth is cheap.
- **Protect the day.** Late in the evening with nothing closed at all, the cheapest closable ring
  jumps to the front — not because it matters more than the rest, but because the day that ends empty
  is the one that breaks the run.

Past wind-down the answer is always the same one, however much is outstanding: stop. An app that
keeps finding you work at midnight is one you end up resenting. **Rest is a real answer**, not a
fallback — an app that always has something for you to do is one that never lets you finish.

Every number behind the recommendation is in the **why this** sheet, including the ones that lost. A
recommendation you cannot interrogate is one you stop trusting the first time it is wrong.

#### The day, the streak, the level

Up to three rings, each either closed or not.

| | |
|---|---|
| **Cards** | nothing due or in learning |
| **Focus** | the daily target met |
| **Deep work** | the deep work block sat — a session of 20 minutes or more started inside it |

Close every ring that is on and the day is **won**. Close at least one and the day is **kept**.

A ring switches itself off when its goal is off — a focus target of zero, no cards at all, or a day
with no deep work anchor on it — so turning a feature off never leaves you with a day you cannot
win. The deep work ring only judges days from when the planner arrived, so a streak built before it
existed is not re-marked.

#### The streak, and why it has grace

Won days advance it. A day where you did something but not everything **holds it where it is**. Only
a day with nothing at all on it breaks it.

That middle rule is the most important one in the app. A streak that snaps the first time you have a
bad day punishes you at exactly the moment you are least able to take it, and what people do next is
not "try harder tomorrow" — it is delete the app. Showing up at all has to be worth something.

#### Points, and what is deliberately not counted

One number, three sources, and a hard ceiling on the one that could otherwise be farmed:

| | |
|---|---|
| focus | depth-weighted minutes, which are real elapsed time |
| cards | one each, capped at 120 a day whatever you review |
| the day | 40 for every ring, 10 for showing up |

**The deep work ring earns no points of its own.** It counts towards closing the day, but its minutes
are already counted as focus, and counting them twice would be the app flattering you. The app says
exactly that, out loud, in the sheet that explains the scoring.

Points accumulate into ten named levels — Spark, Kindling, Ember, Steady, Forge, Furnace, Engine,
Flywheel, Relentless, Lodestar. **None of them unlocks anything.** They are a record of what has
happened, not a gate in front of what has not. Nor are the twenty-three milestones, which are facts
about things that happened and cannot be taken away.

Nothing on this tab is stored. The streak, the level, the bests and the milestones are all derived
from the three logs every time they are drawn, because a number that lives on disk is a number that
can drift away from the thing it claims to measure — and it is the one thing a hand-edited export
could inflate. Delete a session and the level goes down. That is correct.

(The whole tab is a single pass over the logs, cached on the document's revision number, so drawing
it at six hundred logged days costs about a millisecond, and nothing at all between writes.)

### The nudges

A static page has no server, so there is no push. What there is:

1. **A rule engine**, wall-clock driven and self-correcting. It does not test for an exact minute.
   Every rule asks *is this true right now, and have I said it recently*, which means a nudge missed
   while the screen was off still lands the moment you pick the phone up, with the right wording for
   how late it now is.
2. **Service worker notifications**, so they survive the tab losing focus, and carry buttons that do
   the thing rather than opening a screen with the thing on it.
3. **Periodic background sync** where the browser has it.

#### Why it is a queue and not a list of alarms

*Constantly* and *all at once* are different things, and the second one gets an app muted inside a
week. So every rule that is currently true becomes a **candidate**, the candidates are ranked, and
exactly one fires — after which nothing else fires for a gap you set with one dial: *Gentle*,
*Steady*, *Constant*. Open the app at nine at night having ignored it all day and you get the one
thing that matters most, not six notifications in a stack.

Your plan is the exception. A block you planned is a time, not a suggestion, so the nudge for it
jumps the queue — once per task per day — rather than arriving after the time has gone.

**You → Settings → Notifications → Queue** shows exactly what is ready and what each waiting rule is waiting
for, so what the settings screen promises and what actually arrives cannot drift apart.

#### What it will say

Every line follows four rules: it is **true** — no invented urgency; it is **specific** — *forty
cards due, and four hours left*, not *don't lose your progress!*; it **names one action**, and
the action is the smallest one that counts, because the small one is the one you will actually do;
and it **never shames**, because a missed day is information, not a moral failure, and an app that
says otherwise gets uninstalled in a fortnight.

There are several lines per situation and one is picked at random, never the same one twice running,
because a nudge you can predict word for word stops being read at all.

---

## Your data

Stored three ways at once: IndexedDB as the primary copy, a localStorage mirror, and ten rolling daily
snapshots you can restore from. A write that fails to parse can never overwrite a good record.

Writes are coalesced and layered. A change marks the document dirty; the localStorage mirror is written
about 220ms later and never more than 1.2 seconds after the first unwritten change, and IndexedDB
follows at 700ms. A heartbeat catches anything a timer missed. Every signal the browser gives that the
page might be about to die — hidden, pagehide, blur, freeze, unload — writes straight through
synchronously, and all of them are wired because each one fires in some browsers and not others.

A session that is hours past its own end is dropped on load rather than resumed. The timer derives
from timestamps, so locking the phone mid-session and coming back gives the right answer — you were
still working. Applied to a session left open overnight the same arithmetic would credit every phase
that elapsed while you were asleep, so anything more than two hours past its planned finish is not a
session any more.

Every save carries a revision number, so an older copy can never land on top of a newer one, and the
IndexedDB write retries three times before giving up. Boot compares the two stores by revision and
then by timestamp, as a pair rather than as one folded number — a revision passes nine hundred within
a day of ordinary use, and past that a single fused number stops being a comparison at all. A
document that arrives to *replace* the one on disk (a restore, an import, a wipe) is renumbered above
everything already written, so a restore cannot undo itself the next time the app opens.

If both stores fail you are told out loud rather than left to find out later; **You → Settings →
Your data** shows when the last write actually landed.

An older backup still opens. Everything belonging to a feature that no longer exists — a timetable, a
training log, boxes, task lists — is dropped on load, and your cards, sessions and appearance
settings come through untouched. A backup from when cards had subjects *and* topics is folded flat
by name rather than by deletion: a subject that held one throwaway topic ("General") becomes a deck
under the subject's own name, a topic with a real name keeps it, and two topics that would collide
are told apart by their old subject — `Biochem · Upper limb`. No card changes hands.

### A bad build cannot brick it

The service worker is registered from a plain script in `index.html`, not from inside the module
graph. If a module ever fails to load — a half-finished upload, a file missing from the cache, a typo
in an import — the graph never instantiates and nothing inside it runs, which would have included
the code that registers the worker. The app would then be stuck on the broken copy with no way to
fetch a fixed one.

Out there, an update can always land, so the next one replaces the bad one instead of the page
staying dead. That inline script waits for `load` and retries four times, because registration races
the module fetches for bandwidth and loses on a bad connection; `app.js` picks the registration up
afterwards through `navigator.serviceWorker.ready`.

Nothing leaves the phone. There is no analytics, no telemetry and no remote anything.

To move to a new phone: export a backup on the old one, install on the new one, then You → Settings
→ Your data → Restore.

---

## Files

```
index.html              shell
manifest.webmanifest    install metadata and shortcuts
sw.js                   offline cache and notification delivery
css/app.css             design system
js/util.js              dates, formatting, safe HTML templating
js/store.js             IndexedDB, mirror, snapshots, the save machinery
js/state.js             schema, seed, migration
js/srs.js               card scheduling, queue, parsing, leeches
js/plan.js              anchors, tasks, and the day planned around them
js/session.js           the deep work timer
js/game.js              rings, streak, depth, points, levels, milestones
js/money.js             allowance periods, pace, the pie geometry
js/next.js              the shared clock, and what to do now
js/notify.js            the rule engine and delivery
js/ui.js                sheets, toasts, feedback, wake lock
js/app.js               router, clock, event delegation
js/views/cards.js       decks, writing cards, the leech list
js/views/reel.js        the card feed
js/views/focus.js       the timer, the week, the bests
js/views/plan.js        today: the timeline, adding a task, the day changing
js/views/money.js       what is left, the donut, day by day
js/views/you.js         the day, the streak, the level, the milestones
js/views/settings.js    appearance, notifications, your data
```

---

## Why it is shaped like this

Every design decision in here comes from the same short list, and where a rule and a feature
disagreed, the rule won.

**A phone, held in one hand, at eleven at night.** That is the only device this is designed for.
Everything reachable with a thumb, every target big enough to hit without looking, no screen that
scrolls sideways by accident, and nothing that needs two hands or a second of aim. It works on its
side and on a desktop, with the same controls in a layout that uses the width.

**One thing, now.** A screen costs you the number of decisions on it, not the number of pixels.
Decision fatigue is real and it is worst in the evening, which is exactly when you need to start.
So each surface has one obvious action and everything else is one tap down.

**Earned, not given.** The test for anything with a number on it is one question: *could you move
this without doing the thing?* Focus points are real elapsed time. Card points are capped by what the
scheduler decided was due, and capped again at 120 a day. The run counts cards recalled back to back
without turning one over. Money — self-reported — earns nothing.
Nothing in here moves because you opened the app.

**Position, not judgement.** Being over the day's pace on money is a mark on a bar. Being short of the day's focus
target is a bar. Neither is red, and neither is phrased as a failure, because the thing that makes
most habit apps undignified is not that they nudge often — it is what they say.

**Nothing is locked.** Ten levels, twenty-three milestones, and not one of them gates a feature. They
are a record, not a carrot. The moment a score decides what you are allowed to use, it stops being
about you and starts being about the app.

**Improvement by subtraction.** One pass deleted a timetable, a workout engine, a progression
system, a progress tab and four tabs of lists. The next deleted a whole level of the card hierarchy.
Both times the tab that lost something ended up doing more.

The test for anything added here is simple: **could you move this number without doing the thing?**
If yes, it does not go in.
