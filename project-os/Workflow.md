# Workflow — the mandatory process from idea to delivery

This file is the path every change in {{PROJECT_NAME}} walks: request, plan, implementation, QA, documentation, delivery.

It exists so the same steps run on every task regardless of size, and so the reasoning behind a change outlives the memory of the person who made it.

## The universal rule

This workflow applies to every task. No exceptions.

Task size does not unlock a shortcut. Adjusting one line of padding walks the same path as building a new screen.

What scales with size is the *depth of the writing*, not the number of steps. A tiny change gets a one-line plan and a one-line history row — but it still gets both.

Why: the shortcuts are always taken on the small changes, and small changes are what break things quietly. A process you skip when it feels unnecessary is not a process.

## Core flow

Idea → classify and state risk → read context → define boundaries → plan → design the QA → implement small → self-check → browser QA → QA checklist → fix loop → auto review on medium+ risk → decisions checkpoint → documentation routing → History row → delivery summary.

## 1. Idea / request

{{OWNER_NAME}} describes a need. It will be one of:

- a new feature,
- a change to something that exists,
- a bug,
- a UX improvement,
- an infrastructure change,
- a documentation change,
- a process or QA change,
- an architecture decision.

Do not open an editor yet. Understand the job first.

## 2. Classify the task and state its risk

Name what kind of change this is: new feature · change to existing behavior · bug fix · UI change · backend or API change · data or storage change · state and persistence change · styling change · docs or infra change · process change · architecture decision.

The label does not let you skip steps. It tells you which context to read, which checks matter, and which docs will need updating.

**Then state the risk level out loud, at pickup — low, medium, or high.**

| Risk | What it covers |
|---|---|
| Low | Docs. Isolated changes with no behavior attached. |
| Medium | UI behavior, new interaction, multi-file change, anything that changes how you yourself work. |
| High | Data, schema, auth, user records, irreversible actions, security, money. Anything that breaks a project invariant. |

This table is the scale's one home — every other file points here.

This is not commentary. Medium or high **arms the automatic review in step 12**, which reads this rating back. So a rating stated too low quietly cancels a review nobody notices is missing. {{OWNER_NAME}} can override your call, and the owner's rating wins.

## 3. Read the context

Before touching anything, read:

- `CLAUDE.md` — project context and working rules.
- `project-os/Workflow.md` — this file.
- `project-os/Map.md` — architecture and where things live.
- `project-os/QA.md` — what must be checked.
- `project-os/History.md` — what changed recently.
- `project-os/Decisions.md` — why things are the way they are.
- `project-os/Conversations.md` — how to write the reply at the end.
- `project-os/Backlog.md` — scan the open items; flag any that this task touches.

Read them before you form an opinion. An opinion formed without them is a guess that happens to be typed confidently.

Two more are read on demand rather than every time, because most tasks never reach them: `project-os/Code_review.md` when step 12 arms a review, and `project-os/Visual_QA.md` when the task changes something a person can see.

If the task touches an area with its own notes in `project-os/Map.md`, follow that pointer too.

## 4. Define boundaries

Before planning, write down:

- what is in scope,
- what is out of scope,
- which files may change,
- which files must not change,
- what behavior must stay identical,
- what could break,
- whether this touches UI, data, state, persistence, auth, security, or performance.

If scope is ambiguous, ask before implementing — unless the owner already said to proceed on best effort.

Why: most bad changes are not wrong code. They are correct code applied to the wrong surface.

## 5. Write a short plan

Before implementing, state:

- the goal,
- files likely to change,
- files not to touch,
- the risk level,
- the QA you expect to run,
- the rollback point,
- the docs that will need updating.

Practical and short. A three-line plan is fine. No plan is not.

Why: a plan written before the code is a prediction, so it can turn out wrong and teach you something. A summary written afterwards only ever agrees with what you did.

## 6. Design the QA before you write code

Decide how you will prove this works *before* it exists. Otherwise QA gets invented at the end to match whatever you happened to build, and it only ever confirms your own assumptions.

Derive the checks from the goal, the user flows, the states, the data, and the risks:

- the critical flows,
- the expected default behavior,
- loading, empty, error, disabled, and success states where they exist,
- interactions that must be tested by hand,
- input and output checks,
- reload and persistence checks where relevant,
- network checks where the UI depends on data,
- regression checks on whatever sits next to the change,
- the done criteria.

Add anything new to `project-os/QA.md`. Checks specific to this task belong there next to the global ones — one file, no second home.

## 7. Implement the smallest safe change

Implement the requested change and nothing else.

- One clear change at a time.
- No side refactors.
- No opportunistic cleanup.
- No unrelated styling.
- No hidden behavior changes.
- No new public interfaces unless the task requires them.

If the work reveals a bigger problem, write it down as a follow-up. Do not silently grow the scope to swallow it.

Why: an unrequested change is a defect even when it is an improvement. The owner did not ask for it, does not expect it, and now has to find it.

## 8. Run self-checks

Run what the change deserves. Typically `{{CHECK_COMMAND}}`, plus whatever else applies: build, typecheck, lint, unit tests, a smoke run, a request against the API, a schema validation, a write-then-read test.

Record the exact checks and their results. You will need them in step 15.

## 9. Browser QA for anything visible

Anything a person can see or click gets checked in a running app, not by reading the diff. Code reading proves the code says what you meant. It does not prove the screen does what you meant.

Drive {{DEV_URL}} with a browser-automation tool and check:

- the page loads,
- the change is actually visible,
- the console is clean, or existing errors are named,
- the real interaction works,
- hover, focus, active, disabled, loading, empty, and error states where they exist,
- nothing nearby moved,
- narrow and wide widths if the area is responsive,
- persisted state survives a reload,
- network responses are what the UI expects.

### Verification gate — mandatory before "done"

Before calling any visible change done, complete one of these two paths and say which one in the delivery summary.

- [ ] **Path A — the check ran.** You opened the app in a browser-automation tool, ran the flow, and inspected console, network, and DOM. List each concrete check and its result.
- [ ] **Path B — no tool was available.** You searched the available tooling for a browser automation tool and found none. State the search you ran and its empty result, then hand the owner a manual QA list.

A task claiming neither path is not done.

Two traps to avoid:

- **Assuming the tool is missing.** Tools are often loaded on demand and invisible until you look for them. Search before you declare an absence.
- **A tool that exists but was blocked.** That is not Path B. Name the blocked tool, try the other route, and say what happened.

Why the gate is written as a checkbox: "I verified it" is the single easiest sentence to write without having done it. Naming the path makes the claim falsifiable.

## 10. Run the QA checklist

Go through `project-os/QA.md`.

If a check the task needed does not exist there yet, add it now. That is how the checklist grows into something worth reading.

## 11. Fix loop

When a check fails:

1. Fix the smallest thing that explains the failure.
2. Re-run that check.
3. Re-run the checks around it.
4. Do not move on to documentation until the relevant checks are green, or the remaining limitation is written down plainly.

Why step 3: a fix is itself a change. It earns the same suspicion as the change that caused the bug.

## 12. Automatic review on medium or high risk

If step 2 rated this medium or high, the task is not finished. Run the review now — after your own QA is green, before any documentation.

1. Load `project-os/Code_review.md` and review this task's diff plus whatever it touched.
2. Fix every finding this change introduced, at every severity. Re-verify each fix. If a fix affects something visible, re-verify it in the browser.
3. Report pre-existing findings; never auto-fix them. They wait for the owner's verdict.
4. Name the review result in the History row and the delivery summary: found, fixed, pre-existing flagged.

A medium-risk task with no review result recorded is unfinished, not sloppily documented.

Low-risk tasks skip this step.

## 13. Decisions checkpoint

Before writing documentation, ask whether this work created or exposed a decision worth keeping.

- Did you choose one approach over another?
- Was there a real tradeoff — technical, product, UX, data, or process?
- Will it constrain future work?
- Would someone later reasonably ask "why was this done this way?"

If yes, add an entry to `project-os/Decisions.md`.

The split: `project-os/Decisions.md` says *why* a direction was chosen. `project-os/History.md` says *what* changed.

## 14. Documentation routing

Update only what needs to change.

| Situation | Update |
|---|---|
| Setup or the human-facing overview changed | `README.md` |
| A working rule or project context changed | `CLAUDE.md` |
| The process itself changed | `project-os/Workflow.md` |
| Structure, routes, or file ownership changed | `project-os/Map.md` |
| A check was added, changed, or retired | `project-os/QA.md` |
| A non-obvious choice was made | `project-os/Decisions.md` |
| Reply format or tone rules changed | `project-os/Conversations.md` |
| The review bar or its scope changed | `project-os/Code_review.md` |
| The hands-on testing method changed | `project-os/Visual_QA.md` |
| An open item was added or closed | `project-os/Backlog.md` |
| Anything was completed | `project-os/History.md` |

Do not write the same rule in two files. If two files need it, one states it and the other points there.

Why: two copies drift apart, and once they disagree neither one is worth trusting.

## 15. Add the History row

Every completed change gets two rows in `project-os/History.md`: one in the scan table, one in the appendix. No exceptions, including docs-only changes.

The scan row names the behavior that changed, for a reader who was not there. The appendix row carries the date, the task, what changed and where, what was checked and its result, the risk level, the commit to roll back to — and, for medium or high risk, the review result.

Keep it to an index entry, not an essay. Someone reading it later needs to know what happened and where to look, not to relive it.

## 16. Delivery summary

Close with a short summary:

- what changed,
- what was checked,
- what was not checked or is still risky,
- the next step.

Format it per `project-os/Conversations.md`. Leave out implementation noise the owner did not ask for — a summary padded with steps that went fine buries the one line that did not.
