# QA

This file is the standing checklist: what must be true before any change is called
done, and how to report what you checked.

It holds only checks that future tasks will reuse. A check that only one task needs
goes in that task's History row, never here, so this file stays worth reading at
every pickup.

## QA ownership

You check everything you can check yourself.

Never hand {{OWNER_NAME}} a check a tool could have run. If you have a terminal, run the
build. If you have a browser tool, open the page.

If a check genuinely could not run, say so in the reply, in plain words, with the reason.

## 1. Match QA to change type

| Change type | Required checks |
|---|---|
| Docs only | Read the file back. Confirm every cross-link resolves. |
| App code | Run `{{CHECK_COMMAND}}`. It must pass, not "mostly pass". |
| Server route / API | Call the route on the running app, then call its error path. If the app is down, `CLAUDE.md` rule 16 says who starts it. |
| Data / storage | Write, read back, reload, confirm it still validates. |
| UI / layout | Browser QA (§2) plus the narrow-width check (§9). |
| Client state / cache | Reload. Mutate, then confirm fresh data arrives. |
| Refactor | Re-check the old behavior. Prove nothing moved. |
| Process / rules | Cross-links resolve, and the change is recorded in `project-os/History.md`. |

If a change spans rows, run every row it spans.

## 2. Browser QA for anything visible

Any change a person can see or operate is verified in a running browser, at `{{DEV_URL}}`.

- Open the changed screen in a fresh tab, and confirm the page loads.
- Confirm the changed element is actually there.
- Do the real interaction: click it, type in it, submit it.
- Check hover, focus, active, disabled, loading, empty, and error states where they exist.
- Check the console (§3).
- Check that network responses are what the UI expects.
- Read the DOM or the computed style when the change is about state or styling.
- Look at the neighbours for regressions.
- Reload if anything was saved.

If you have no browser tool, first prove it (§11), then give a manual check list instead:
numbered, specific, one action per line.

## 3. Console check

A visible change is not verified until you have read the console.

Four allowed outcomes. Write one of them, verbatim shape:

- `Passed: no new console errors`
- `Passed: known existing error only`, and name it
- `Failed: <the error>`, then fix and re-check
- `Not run: <why>`

There is no fifth outcome. "Console looked fine" is not one of these.

## 4. Persistence and reload

When a change writes anything that outlives the page, prove the write reached the store.

- Inspect the stored data after the write.
- Confirm it reads back intact and passes its own validation.
- Reload, and confirm the state survived, or reset on purpose, if that was the point.
- Never delete or rewrite the owner's content to make a check pass.

## 5. Atomic write guard

This applies where the app writes files itself. A transactional database gives you
the same guarantee already. There, this section asks nothing.

Every write to the data store writes to a temp target first, then swaps it into place.

If a new code path writes directly over live data, that is a bug in the change, not a style
preference.

## 6. Accessibility basics

For anything interactive:

- **Keyboard reachable.** Every control can be reached and operated without a pointer.
- **Focus is visible.** A focused control shows a ring you can see against its own
  background, not just against white.
- **Test focus with a real keypress.** Focusing an element from the console does not
  always trigger the same focus styling a keyboard does, so a healthy ring can measure as
  absent. Send an actual key.
- **Accessible names.** Inputs have labels. Icon-only buttons have names. Images have an
  alt decision: authored text, or an empty alt on purpose for decoration.
- **No pointer-only path to a critical action.** If the only way to submit, confirm, or
  dismiss is a hover or a drag, the action is unreachable for some people.
- **Headings stay in order**, and new content sits inside the page's main landmark.
- **Contrast is measured, not eyeballed.** Over a photo or a gradient, sample the real
  pixels behind the text and judge the worst one, not the average.

## 7. Reduced motion

Animation respects the reduced-motion preference. The final state stays reachable with no
animation at all, because motion is how content arrives, never the content itself, and
for some people large motion is physically unpleasant.

Gate each animation at its own surface. Never add one blanket rule that zeroes every
duration everywhere.

## 8. Cold-asset check for entrance animations

When an animation reveals something (an image, text measured off a loaded font, an
element whose geometry a script reads), run that entrance once with the thing genuinely not
cached.

- Force the asset to be cold (a unique query string, a cleared cache, a throttled network)
  and confirm the animation holds at its start until the asset lands, then plays.
- Confirm the gate releases on **both** success and failure. A failed load must not leave
  the gate stuck.
- Confirm it fails open: if the gate never resolves at all, or scripting is off, the
  element ends **visible**. An entrance may degrade to no animation. It may never degrade
  to permanently hidden.
- Confirm the reduced-motion path still lands on the final state (§7).

## 9. Narrow-width check for any layout change

Any change to layout, type, or spacing is checked at your smallest supported width before
it is called done.

**Resize first, then load.** Set the viewport, then navigate or reload. A measurement taken
without that reload is unproven.

**Check both sides of every breakpoint.** One pixel below it and one pixel above.

What to check:

- **No horizontal overflow.** The document's scroll width must not exceed the viewport
  width. Probe several widths, not one.
- **Wide content stays inside its box.** A no-wrap heading inside a clipped parent fails
  silently. Measure the element against its container.
- **Wide layouts are untouched.** Re-measure anything the narrow rule could have moved: a
  shared token, a base rule you overrode. A narrow fix that shifts the wide layout is a
  regression.
- **Specificity first, then source order.** A media query adds no specificity of its
  own. A narrow-width rule must out-rank the rule it overrides, or repeat the same
  selector after it in the same stylesheet.
- **Tap targets** stay large enough to hit after any shrink.

Measure, do not eyeball. Read the numbers out of the page; a screenshot at the wrong scale
will agree with whatever you already believe.

## 10. No vague QA

Never write `manual QA passed`, `looks good`, `verified`, or `tested`. Name the screen,
the input, the expected result.

| Bad | Good |
|---|---|
| `Manual QA passed` | `Opened the settings screen, changed the name field, confirmed the save indicator fired and the stored record updated.` |
| `Looks good` | `Changed list-row padding, opened the screen, checked alignment, hover, and that nothing clipped at the narrow width.` |
| `Tested` | `Ran the project check; passed. Loaded the page; no console errors.` |

Two lines, always, in the History row: what you ran, and what it returned.

```md
**Verification run**
Ran the project check, then opened the changed screen, made an edit, reloaded.

**Verification result**
Passed: checks green, the edit rendered, the record updated, the change survived the
reload. Console: no new errors.
```

## 11. Prove a tool is missing before you claim it is

`CLAUDE.md` rule 6 holds this rule in full: search before you claim a browser tool is
missing, what an empty search means here, and what a refused or blocked tool is.

## Checklist before delivery

- [ ] Task type identified, risk level stated.
- [ ] Context files read.
- [ ] Scope boundaries named, including what you did not touch.
- [ ] Smallest safe change used.
- [ ] `{{CHECK_COMMAND}}` run and passing.
- [ ] Browser QA run for anything visible.
- [ ] Layout, type, or spacing touched → narrow-width check run, both sides of each
      breakpoint, wide layout re-measured (§9).
- [ ] Entrance animation touched → cold-asset check run (§8).
- [ ] Storage touched → persistence and reload check run (§4).
- [ ] Medium or high risk → code review run (`project-os/Code_review.md`), result named
      in the History row.
- [ ] Something shared touched, at any risk → blast-radius trace run
      (`project-os/Code_review.md`), impact class named in the History row.
- [ ] QA wording is concrete, not vague (§10).
- [ ] `project-os/History.md` row added.
- [ ] `project-os/Decisions.md` updated if a non-obvious choice was made.
- [ ] Reply reports checks as `project-os/Conversations.md` says (Report-back sections).
