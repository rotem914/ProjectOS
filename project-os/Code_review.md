# Code review

This file is the calibration for reviewing code in {{PROJECT_NAME}}: how severe a
defect is *here*, which mistakes this project keeps making, and how findings get
handed back. Load it before a review starts, not after it ends.

The review itself reads the change and asks whether the code is correct, and that
part is the same everywhere. The bar is not. A generic checklist finds generic
bugs; the bugs that actually ship are the ones this project has shipped before,
and this file is the only place that remembers them.

## When a review runs

Every medium- or high-risk change gets one; `project-os/Workflow.md` carries the
risk scale and the trigger. {{OWNER_NAME}} can also ask for a wider pass at any
time.

## Scope — pin it, never guess

**Two different passes load this file, and their scopes are opposites.** Say
which one you are running, before you run it.

**The automatic pass after a task: that task's own change.** Two parts, and each
one is easy to lose:

- work that is already committed but not yet shipped;
- work still sitting uncommitted in the project folder.

Anything that defaults to "uncommitted changes only" will report a clean tree when
the real change was committed an hour ago. That is a silent empty review. Name the
range in the report so an empty result can be trusted.

**The `Go code review` trigger: the WHOLE REPOSITORY, every time.** The entire
codebase as it stands, including code that shipped long ago and code nobody has
opened in months. Never a diff. Review tools default to reviewing a diff, and
that default is wrong here: drive the review across the whole tree, in batches
by area if the repository is large, and say which areas were covered.

The reason is simple. The automatic pass above already covers every new change,
so a second review of the same diff finds the same nothing. The owner-driven
pass exists for everything the automatic ones never look at, which after a few
months is most of the codebase. Only a range the owner names in the same
message narrows it.

## Blast radius: where else can this change reach?

A review answers two questions, not one. The first is whether the changed code is
correct where it sits. The second is **where else the change can propagate**, and
that is the one that gets skipped, because the diff never shows it. The diff shows
what was edited. It does not show who was depending on it.

Run this on every medium- or high-risk change, in either pass above.

Trace the consumers of everything the change touched:

- shared components, and every route or screen that renders one;
- global tokens, theme values, shared styles, utility classes;
- data shapes and schemas that are read somewhere else;
- states and variants that reuse the same logic;
- size- or breakpoint-scoped behaviour that can leak across widths;
- flows and features that depend on the changed code;
- consumers that are NOT in the diff;
- hidden coupling: helpers, variants, inheritance, shared config, load order.

Then classify the impact, and say which one it is, in a line of the report:

| Class | Meaning |
|---|---|
| **Local** | Confidently contained to the intended area. |
| **Shared** | Several known consumers are affected. |
| **Unknown** | The full propagation could not be established. |

**A small diff is not a local diff.** A one-line change to a shared component, a
token, a helper, a schema, or a styling rule reaches further than a large isolated
one. Size is not containment, and a review that reads it that way is guessing.

When the impact is **shared**: name the affected consumers, open a representative
few rather than only the file that was edited, confirm the change still holds
there, and report any real side effect.

When the impact is **unknown**: mark it **UNVERIFIED**, say what could not be
determined, and name the smallest practical check that would settle it. An empty
finding list is not proof of safety. It is the absence of evidence, and the two
only look alike from outside.

**Inspecting a consumer is not fixing it.** Blast radius widens what the review
reads, never what the change edits (rules 2 and 18). A consumer that turns out to
be broken is a reported finding, marked pre-existing when the change did not cause
it, and it waits for the owner's verdict.

## A check that never ran is not a check that passed

The other way a review comes back falsely clean. When a pass is split across
several checks, some of them fail to run — they time out, they hit a limit, they
die halfway. A finding whose checks all failed comes back with zero confirmations,
and zero confirmations is not the same as refuted. It means nobody looked.

So read the failure list before the results list. Score a no-vote as
**unverified** and check it by hand. Say in the report that the pass ran degraded,
and give the numbers.

Why this one matters more than it sounds: the serious findings are the expensive
ones to check, so they are exactly the ones that time out. A review that reports
four findings while twenty-four went unexamined is worse than no review, because
it sells confidence nobody earned.

## Severity bar

| Tier | Meaning |
|---|---|
| 🔴 **blocking** | Data loss, silent corruption, a security hole, or a break in a stated must-not-break invariant. Fix before it lands. |
| 🟠 **important** | A real defect, or a maintainability break that bites later. No immediate data loss. Should fix; say so if you disagree. |
| 🟡 **nit** | Polish, a small accessibility gap on a non-critical control, cosmetic. Non-blocking. |

Rewrite those three rows with defects this project has actually shipped, in place
of the generic ones. A bar argued from real incidents survives a disagreement
about a rating. A copied one does not.

### The worst bug class here

Name, in one sentence, the worst thing this project's code can do. Write it below.
Then treat that class as **always blocking**, even when the screen looks fine —
that is what calibrates the bar for everything else.

> **Fill this in.** *Example to replace: "The worst thing this app's code can do
> is silently lose or corrupt work a user already saved."*

## Universal review dimensions

The spine of the always-check list. Add or drop dimensions to fit what this
project actually is. For each one, the question to ask:

- **Change impact / blast radius**: who else consumes what this change touched,
  and does it still hold there? (The section above; run it on medium+ risk.)
- **Data & persistence integrity** — can this change silently lose, corrupt, or
  half-write stored data? Are writes atomic, and are reads validated and loud on
  failure?
- **State & concurrency** — stale or lost updates, races, effects that loop,
  out-of-order writes.
- **Contract & schema** — is a schema change backward-compatible? Full versus
  partial writes, version gates, validation of incoming data.
- **Reference & identity** — dangling references after a rename or delete, stable
  ids versus editable ones, list keys.
- **Input & values** — trimming, format, uniqueness, empty versus whitespace,
  numeric edges, untrusted paths, escaping in generated output.
- **Architecture & extension points** — is the single source of truth honored, or
  did a second branch of the same logic appear somewhere else?
- **UI invariants** — tokens over hard-coded values, language and direction,
  theme, focus states, this project's own visual rules.
- **Accessibility** — labels, roles that match real behavior, keyboard paths.
- **Security & untrusted input** — injection, path traversal, secrets in the repo,
  authorization.
- **Performance hot paths** — repeated queries in a loop, work on the keystroke or
  render path, unbounded growth.
- **Process & environment** — build and environment hazards, docs that drift out of
  sync with the code.

## Always-check list — this project's own

**Empty on purpose.** This is the section that makes a review worth running, and
it has to come from {{PROJECT_NAME}}, not from a catalogue. Seed it with the
bootstrap recipe below, then let the calibration loop grow it.

One row per finding-class: a short title, a severity, something concrete enough to
search for, and a pointer to where the reasoning lives. Never restate the record —
point at it, because two copies of the same finding drift apart and then neither
one is worth trusting. Group the rows under the dimensions above.

### Data & persistence integrity

> *Example row — delete this one when you write your first real one.*
>
> - 🔴 **Every write is atomic** — a save writes to a temporary file and then swaps
>   it into place. A direct in-place write can leave a half-written file if the
>   process dies mid-save. (Source: `project-os/Decisions.md`, the storage entry.)

## Bootstrap recipe — fill the list from this project's own memory

Run this once to seed the list, then re-run it whenever the code has moved enough
that the rows feel stale. Sweep these five sources and dedupe what they give you
into rows:

1. **Past review documents** — the finding-classes that keep coming back.
2. **`project-os/History.md`** — bugs that recurred, or took several attempts to
   fix. The highest-value source by far; these are almost always blocking.
3. **`project-os/Decisions.md`** — choices that imply a review rule. "All writes
   are atomic", "schema changes are additive only", "one module owns this map".
4. **The code** — the real save path, the validation boundary, the single-source-of-
   truth modules, and the sharp edges of whatever this project is built on. Cite
   `file:line`.
5. **`CLAUDE.md`** — the invariants that are stated as must-not-break.

## Output — findings as small, executable tasks

A review's deliverable is a list someone can run top to bottom, not a wall of prose.
Two layers:

1. **The reply** — terse: counts by severity, the range reviewed, the headline
   findings. `project-os/Conversations.md` has the reply rules.
2. **The task document** — one file per review, one section per severity (🔴
   first), one block per finding:

```
T# · <short title>          (+ severity marker)
Where:   file:line
Problem: one line — the defect, not a lecture
Fix:     the concrete change (or two options, if there is a real choice)
Verify:  the one check that proves it fixed — a test, a search, {{CHECK_COMMAND}}, or a manual step
Status:  [ ] open · [x] done
```

Keep each task small enough to execute on its own; split anything bigger into
numbered sub-tasks. Write it for a reader with no context — {{OWNER_NAME}}, or a
fresh assistant tomorrow — who should not have to re-read the change to act on it.

## Exceptions — settled, never raise again

**Empty on purpose.** When {{OWNER_NAME}} rejects a finding, one line lands here,
and no later review raises it again. Without this section every pass re-litigates
the same argument, and the owner pays for it every time.

One row each: what not to flag · the reason in the owner's own words · where it
was raised.

## Calibration loop

After every review, take the verdict and fold it back into this file. The verdict
vocabulary is **fix / drop / backlog**.

- A **rejected** finding becomes an exception row above, or the check gets dropped.
- A **new rule** ("always check X") becomes a row under the right dimension.
- A **severity change** is edited into the row inline.
- A **recurring bug** gets its full record in `project-os/History.md`; this file
  keeps a one-line pointer.
- A **pre-existing** problem the change only sits next to gets flagged and marked
  pre-existing — never fixed silently, never blocking the change. A `backlog`
  verdict sends it to `project-os/Backlog.md`.

Keep this an index of checks, not a bug encyclopedia. The moment a row needs three
paragraphs, the record belongs somewhere else and the row belongs here as a
pointer.
