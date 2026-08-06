# Visual QA

This file is how {{PROJECT_NAME}} gets tested by being used: the method for
driving the running app, the bar for what counts as a defect there, and the
defects this project has produced before. Load it before a pass starts.

A code review reads the change. A visual QA pass **uses the app**. They are a
matched pair and they catch different things. A defect visible in the code is a
review finding. A defect that only appears when a careless person clicks, types,
reloads, or undoes is a visual QA finding — the code can read perfectly and the
behavior still be wrong. `project-os/Code_review.md` is the other half.

## When a pass runs

Whenever a change alters something a person can see or do, and any time
{{OWNER_NAME}} asks for a sweep.

**Drive the screens the change actually reaches**, plus their neighbors for
regression. Map the changed code to the screens it renders and start there. Do not
test a screen the change cannot touch. Do not skip a reachable one because the code
"looks safe" — that judgment is what the pass exists to check.

## Driving the app

The app runs at {{DEV_URL}}. Drive the real thing.

Reach for the most precise tool you have, in this order:

1. A dedicated interface for the app, if it has one.
2. Otherwise, anything that reads the real document tree.
3. Screen control, only when nothing else can reach the surface.

Structure beats pixels. A document tree tells you a control is disabled; a
screenshot only tells you it looks grey.

**One driver, one surface.** Never run two things driving the same app at once.
They fight over focus and windows, and the pass turns into debugging the harness
instead of the product.

**Search for a tool before concluding you have none.** Tooling is often loaded on
demand and invisible until you look for it, and a wrongly declared absence cancels
the whole pass without anyone noticing. `project-os/Workflow.md` holds the gate
you have to satisfy either way: run the pass, or state the search that came up
empty and hand over a manual checklist. Never report a pass you did not run.

## Severity bar

| Tier | Meaning |
|---|---|
| 🔴 **blocking** | Data loss, silent corruption, a crash, or a broken core flow you reproduced in the running app. Fix before it lands. |
| 🟠 **important** | Wrong or confusing behavior with no data loss — a control that misleads, a state that drifts out of sync. Should fix; say so if you disagree. |
| 🟡 **nit** | Polish, a small accessibility gap on a non-critical control, cosmetic. Non-blocking. |

One rule of thumb that holds everywhere: **if a careless user can lose or silently
corrupt their work, it is blocking** — no matter how good the page looks.

### The worst defect class here

Name, in one sentence, the worst visual or interaction defect this project
produces. Write it below, and make that class always blocking.

> **Fill this in.** *Example to replace: "The dangerous defects here are state, not
> pixels — an edit that reports success while nothing was written."*

## The pass method

Four steps. This is what turns "it looks fine" into a real test.

**1 · Per screen, drive it properly.** Load it. Capture the state. Then exercise
every state of every interactive control — default, hover, focus, active, disabled,
loading, empty, error. Take each control through **every exit path**, not just one:
choose, click outside, press Escape, submit. Focus restoration and side effects
differ per path, which is exactly why only one path gets tested and only one path
works. Watch the console and the network the whole time. Reload and confirm what
survived. Glance at neighboring screens for damage.

**2 · Be a destructive user.** The resting state is where nothing hides. Go at the
transitions:

- clear a required field, then leave it;
- type something, then delete all of it;
- paste junk — emoji, mixed-direction text, a thousand characters with no spaces,
  an absurd number;
- add an item, then delete it, then add it again;
- undo and redo in the middle of an edit;
- edit two fields fast, before the first one settles;
- change a list while a confirmation dialog about it is open;
- switch mode, theme, or language with unsaved edits pending;
- do the same action twice quickly.

**3 · Guard against false positives — the settled state, and the tooling.**
Re-check anything you saw mid-transition: a fade or a skeleton caught halfway is
usually an artifact, not a defect. Then distrust the harness itself, because
automation lies about what happened.

- Synthetic typing can desync a framework's idea of an input's value. Prefer real
  keystrokes.
- An offscreen or backgrounded automation context can freeze animation timers and
  swallow input, so "nothing happened" may mean nothing ran.
- Screenshot pixels are not layout pixels. Read state from the document tree, not
  from coordinates.

Re-verify every "it didn't work" before you write it down. A false finding costs
more than a missed one, because it sends someone to fix code that was never broken.

**4 · Confirm against the source of truth, then clean up.** What the screen shows
must match what was actually stored — the file, the database, the response — and
must survive a reload. A screen can display "Saved" over nothing at all; eyes alone
cannot tell the difference. Then undo your test edits, or work on a throwaway copy,
so the pass leaves no residue in real data.

## Universal dimensions

The spine of the always-look-for list. Each one is something to *do* in the running
app, not something to read. Add or drop dimensions to fit the product.

- **States & interaction** — every control through its full state set. Focus
  actually paints. Decorative elements do not steal focus. An overlay that takes
  focus returns it to its trigger on **every** close path.
- **Editable lists & focus** — typing, deleting, or reordering a row must not drop
  focus, jump the cursor, or shift a neighbor's value into the field you are in.
- **Undo, redo & autosave** — undo is scoped and granular; autosave is truthful,
  saving when it claims to and never on a mere page view, and firing the number of
  writes you expect.
- **Persistence & reload** — a change survives a reload and matches what was
  stored. A deleted thing stays deleted. Switching route or mode does not throw
  away unsaved edits in silence.
- **Theme & appearance** — every supported appearance renders, nothing flashes on
  load, text stays legible on every surface.
- **Layout, overflow & content stress** — hostile content must not clip, overlap,
  or spill its container; blank content renders a sensible fallback, not an empty
  hole.
- **Empty, error & loading** — all three exist as real states, and an empty state
  is not an error state wearing a disguise. Whitespace in a required field does not
  count as filled.
- **Input & feedback** — a field snaps back to its last good value rather than
  committing garbage; malformed input is visibly flagged, not silently stored; a
  broken reference is surfaced, not quietly shown as the wrong option.
- **Console & network** — after every interaction the console is clean, and the
  network shows the request count you expected. No double-fire. No request just
  from looking at a page.
- **Language, direction & accessibility** — correct language and text direction,
  user content direction-aware, everything reachable and labeled by keyboard, every
  action working without a pointer.

## Always-look-for list — this project's own

**Empty on purpose.** This is where the pass earns its keep, and it has to come
from {{PROJECT_NAME}}'s real defects. Seed it with the bootstrap recipe below, then
let the calibration loop grow it.

One row per defect-class: a short check, a severity, the **action that exercises
it**, and a pointer to the record. Group the rows under the dimensions above.

### Persistence & reload

> *Example row — delete this one when you write your first real one.*
>
> - 🔴 **A save reaches storage** — edit a field, save, reload the page, then open
>   the stored record directly. The screen saying "Saved" is not evidence.
>   (Source: `project-os/History.md`, the save-path entry.)

## Bootstrap recipe — fill the list from this project's own memory

Run this once to seed the list, then again whenever the app has moved enough that
the rows go stale. Sweep these five sources and dedupe into rows, each one an
action to perform:

1. **Past QA passes and bug reports** — the interaction defects that keep coming
   back.
2. **`project-os/History.md`** — bugs that recurred or took several attempts: lost
   focus, hijacked undo, deletions that came back, a save that bricked. Highest
   value; these are almost always blocking.
3. **`project-os/Decisions.md`** — the visual and behavioral invariants past
   choices implied. The theme model, the text direction, the autosave contract, the
   empty-state rule.
4. **The running app** — drive the real screens and note which controls are
   fragile. Cite the screen and the file behind it.
5. **`CLAUDE.md`** — the stated must-not-break rules about what the product looks
   like and how it behaves.

## Output — findings as small, executable tasks

Two layers, same as a code review:

1. **The reply** — terse: counts by severity, screens driven, headline findings,
   and whether the pass ran fully or fell back to a manual check.
   `project-os/Conversations.md` has the reply rules.
2. **The task document** — one file per pass, one section per severity (🔴 first),
   one block per finding:

```
T# · <short title>          (+ severity marker)
Where:   screen / route  ·  file:line for the fix
Repro:   the exact steps a careless user takes to hit it
Expect:  what should happen
Actual:  what happens now
Fix:     the concrete change (or two options, if there is a real choice)
Verify:  the step in the running app, plus the stored-data check, that proves it fixed
Status:  [ ] open · [x] done
```

When one root cause produces findings on five screens, write the root cause once
and point the five at it — fixing the root closes them all. Keep each task small
enough to run on its own, and write it for someone with no context.

## Exceptions — settled, never raise again

**Empty on purpose.** When {{OWNER_NAME}} rejects a finding — it was intentional,
or it was a transition artifact, or that screen is not designed yet — one line
lands here and no later pass raises it again. Without this section every sweep
re-reports the same non-bug, and the owner pays for it every time.

One row each: what not to report · the reason in the owner's own words · where it
was raised.

## Calibration loop

After every pass, fold the verdict back into this file. The verdict vocabulary is
**fix / drop / backlog**.

- A **rejected** finding becomes an exception row above, or the check gets dropped.
- A **new rule** ("always exercise X") becomes a row under the right dimension.
- A **severity change** is edited into the row inline.
- A **recurring interaction bug** gets its full record in `project-os/History.md`;
  this file keeps a one-line pointer.
- A **pre-existing** defect the change only sits next to gets flagged and marked
  pre-existing, never fixed silently and never blocking. A `backlog` verdict sends
  it to `project-os/Backlog.md`.

Keep this an index of checks, not a bug encyclopedia. And leave the app as you
found it: test edits reverted, nothing you started left running.
