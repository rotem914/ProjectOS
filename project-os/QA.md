# QA

This file is the standing checklist: what must be true before any change is called
done, and how to report what you checked.

It exists so "done" means the same thing on every task, instead of whatever felt like
enough that day.

## QA ownership

You check everything you can check yourself.

Never hand {{OWNER_NAME}} a check a tool could have run. If you have a terminal, run the
build. If you have a browser tool, open the page. Asking them to confirm what you could
have confirmed moves your work onto their desk.

If a check genuinely could not run, say so in the reply, in plain words, with the reason.
An unrun check that is named is information. An unrun check that is silently skipped is a
false report.

## 1. Match QA to change type

Each kind of change fails in its own place. A green build says nothing about a route
that errors, and a working route says nothing about a layout that clips.

| Change type | Required checks |
|---|---|
| Docs only | Read the file back. Confirm every cross-link resolves. |
| App code | Run `{{CHECK_COMMAND}}`. It must pass, not "mostly pass". |
| Server route / API | Start it, call the route, call its error path. |
| Data / storage | Write, read back, reload, confirm it still validates. |
| UI / layout | Browser QA (§2) plus the narrow-width check (§9). |
| Client state / cache | Reload. Mutate, then confirm fresh data arrives. |
| Refactor | Re-check the old behavior. Prove nothing moved. |
| Process / rules | Cross-links resolve, and the change is recorded in `project-os/History.md`. |

If a change spans rows, run every row it spans.

## 2. Browser QA for anything visible

Any change a person can see or operate is verified in a running browser, at `{{DEV_URL}}`.
A passing build proves the code compiles. It proves nothing about what the screen does.

- Open the changed screen in a fresh tab.
- Confirm the changed element is actually there.
- Do the real interaction — click it, type in it, submit it.
- Check the console (§3).
- Read the DOM or the computed style when the change is about state or styling. Pixels
  lie; a rule that never matched usually still looks plausible.
- Look at the neighbours for regressions.
- Reload if anything was saved.

If you have no browser tool, first prove it (§11), then give a manual check list instead —
numbered, specific, one action per line.

## 3. Console check

A visible change is not verified until you have read the console.

Why: most browser failures never reach the screen. An exception stops one script, the
rest of the page renders anyway, and the result looks like it worked.

Four allowed outcomes. Write one of them, verbatim shape:

- `Passed: no new console errors`
- `Passed: known existing error only` — and name it
- `Failed: <the error>` — then fix and re-check
- `Not run: <why>`

There is no fifth outcome. "Console looked fine" is not one of these.

## 4. Persistence and reload

When a change writes anything that outlives the page, prove the write reached the store.

Why: the screen in front of you already holds the value in memory. It renders the same
whether the write succeeded or vanished.

- Inspect the stored data after the write.
- Confirm it reads back intact and passes its own validation.
- Reload, and confirm the state survived — or reset on purpose, if that was the point.
- Never delete or rewrite the owner's content to make a check pass.

## 5. Atomic write guard

This applies where the app writes files itself. A transactional database gives you
the same guarantee already — there, this section asks nothing.

Every write to the data store writes to a temp target first, then swaps it into place.

Why: a crash halfway through a direct write leaves a half-written file where live data used
to be. The swap is the whole point — either the old file or the new one, never a torn one.

If a new code path writes directly over live data, that is a bug in the change, not a style
preference.

## 6. Accessibility basics

A control that only a mouse can reach does not exist for the people who do not use one.
These are the cheap checks that catch most of it.

For anything interactive:

- **Keyboard reachable.** Every control can be reached and operated without a pointer.
- **Focus is visible.** A focused control shows a ring you can see against its own
  background, not just against white.
- **Test focus with a real keypress.** Focusing an element from the console does not
  always trigger the same focus styling a keyboard does, so a healthy ring can measure as
  absent. Send an actual key.
- **Accessible names.** Inputs have labels. Icon-only buttons have names. Images have an
  alt decision — authored text, or an empty alt on purpose for decoration.
- **No pointer-only path to a critical action.** If the only way to submit, confirm, or
  dismiss is a hover or a drag, the action is unreachable for some people.
- **Headings stay in order**, and new content sits inside the page's main landmark.
- **Contrast is measured, not eyeballed.** Over a photo or a gradient, sample the real
  pixels behind the text and judge the worst one, not the average.

## 7. Reduced motion

Animation respects the reduced-motion preference. The final state stays reachable with no
animation at all, because motion is how content arrives, never the content itself — and
for some people large motion is physically unpleasant.

Gate each animation at its own surface. Never add one blanket rule that zeroes every
duration everywhere. An entrance that deliberately waits at frame zero (§8) has nothing
left to release it, so it freezes there and hides its content for good.

## 8. Cold-asset check for entrance animations

When an animation reveals something — an image, text measured off a loaded font, an
element whose geometry a script reads — run that entrance once with the thing genuinely not
cached.

Why: a warm cache hides this entire bug class. On your machine the asset is already there,
so the reveal always has something to reveal. A first-time visitor gets the animation
running on an empty box, finishing before the content arrives.

- Force the asset to be cold — a unique query string, a cleared cache, a throttled network
  — and confirm the animation holds at its start until the asset lands, then plays.
- Confirm the gate releases on **both** success and failure. A failed load must not leave
  the gate stuck.
- Confirm it fails open: if the gate never resolves at all, or scripting is off, the
  element ends **visible**. An entrance may degrade to no animation. It may never degrade
  to permanently hidden.
- Confirm the reduced-motion path still lands on the final state (§7).

## 9. Narrow-width check for any layout change

Any change to layout, type, or spacing is checked at your smallest supported width before
it is called done. A narrow screen is a real surface, not a fallback.

**Resize first, then load.** A page that was loaded wide and then narrowed is not the same
page. Scripts that measure on load re-fit on resize. A page that has lived across several
widths reports geometry no fresh visitor ever sees. Set the viewport, then navigate or
reload. A measurement taken without that reload is unproven.

**Check both sides of every breakpoint.** One pixel below it and one pixel above. A rule
that lands on only one side is invisible at both extremes — you will not catch it at a
typical phone width or a typical desktop width.

What to check:

- **No horizontal overflow.** The document's scroll width must not exceed the viewport
  width. Probe several widths, not one.
- **Wide content stays inside its box.** A no-wrap heading inside a clipped parent fails
  silently. Measure the element against its container.
- **Wide layouts are untouched.** Re-measure anything the narrow rule could have moved — a
  shared token, a base rule you overrode. A narrow fix that shifts the wide layout is a
  regression.
- **Specificity, not source order.** A media query adds no specificity of its own. A
  narrow-width rule must out-rank the rule it overrides, and still come after it.
- **Tap targets** stay large enough to hit after any shrink.

Measure, do not eyeball. Read the numbers out of the page; a screenshot at the wrong scale
will agree with whatever you already believe.

## 10. No vague QA

Never write `manual QA passed`, `looks good`, or `tested`. They say nothing, and they read
exactly like a check that was skipped.

| Bad | Good |
|---|---|
| `Manual QA passed` | `Opened the settings screen, changed the name field, confirmed the save indicator fired and the stored record updated.` |
| `Looks good` | `Changed list-row padding, opened the screen, checked alignment, hover, and that nothing clipped at the narrow width.` |
| `Tested` | `Ran {{CHECK_COMMAND}}; passed. Loaded the page; no console errors.` |

Two lines, always: what you ran, and what it returned.

```md
**Verification run**
Ran `{{CHECK_COMMAND}}`, then opened the changed screen, made an edit, reloaded.

**Verification result**
Passed: checks green, the edit rendered, the record updated, the change survived the
reload. Console: no new errors.
```

## 11. Prove a tool is missing before you claim it is

In many setups, tools are not loaded until something asks for them. They are invisible by
default, which makes "I don't see a browser tool" feel true when it is not.

Before you ever write that no browser tool exists:

1. Search the available tools for one.
2. If anything matches, load it and use it. No exceptions, and no "the owner can check
   this manually".
3. Only if the search returns nothing, say that you searched and found none. In a project
   that carries this kit, an empty search with no `chrome-devtools` entry in `.mcp.json`
   means the install's browser step was skipped (Installation.md 6d, CLAUDE.md rule 6): run
   it now and ask for its one approval. With the entry there, say why nothing loaded, as
   rule 6 lists. The manual check list is for the session
   where even that cannot happen.

A tool that loaded but was **refused** is a different case. Name the tool, say it was
refused, use another route, and never report it as "no tools available".

The failure mode this blocks: declaring early in a task that you have no browser, then
repeating it for the rest of the task to stay consistent with yourself.

## Checklist before delivery

- [ ] Task type identified, risk level stated.
- [ ] Context files read.
- [ ] Scope boundaries named — including what you did not touch.
- [ ] Smallest safe change used.
- [ ] `{{CHECK_COMMAND}}` run and passing.
- [ ] Browser QA run for anything visible.
- [ ] Layout, type, or spacing touched → narrow-width check run, both sides of each
      breakpoint, wide layout re-measured (§9).
- [ ] Entrance animation touched → cold-asset check run (§8).
- [ ] Storage touched → persistence and reload check run (§4).
- [ ] Medium or high risk → code review run (`project-os/Code_review.md`), result named.
- [ ] QA wording is concrete, not vague (§10).
- [ ] `project-os/History.md` row added.
- [ ] `project-os/Decisions.md` updated if a non-obvious choice was made.
- [ ] Reply names the checks that failed or surprised you — not the ones that passed as
      expected.
