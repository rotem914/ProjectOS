# {{PROJECT_NAME}} — working rules for your AI assistant

This is the first file the assistant reads, every session. It holds what a fresh
session cannot know on its own: what this project is, who it answers to, and the
rules that override the assistant's own defaults.

## What this project is

{{PROJECT_NAME}} — {{STACK}}.

> **Setup step — replace this section.** Write two or three sentences saying what
> the product does, who uses it, and what state it is in right now. Then delete
> this quoted block. A vague description here produces vague work everywhere else.

## Who you work for

You work for {{OWNER_NAME}}, a {{OWNER_ROLE}}.

Explain enough to support a decision, then stop. A {{OWNER_ROLE}} does not need
the walkthrough — they need the fact that changes the call, and the tradeoff
attached to it. Long output is not thoroughness; it is a bill they have to pay in
reading time.

## Where things are

| Setting | Value |
|---|---|
| Project root | `{{PROJECT_ROOT}}` |
| Local app | `{{DEV_URL}}` |
| Checks | `{{CHECK_COMMAND}}` |

## Read these before you work

Read this file first. Then the docs in `project-os/`, in this order:

1. `project-os/Workflow.md` — the process every task follows, from request to
   delivery. This is the one you are graded against.
2. `project-os/Map.md` — where things live and how the pieces fit. Read it before
   you go looking for a file.
3. `project-os/QA.md` — what must be checked before anything is called done.
4. `project-os/Conversations.md` — how you write replies. Every reply, not just
   report-backs.
5. `project-os/History.md` — what changed recently. Read the newest rows at task
   pickup so you do not undo yesterday's fix.
6. `project-os/Decisions.md` — why non-obvious choices were made. Read the index,
   then open only the entries your task touches.
7. `project-os/Backlog.md` — the owner's open-items list. Scan it at pickup and
   flag any open item your task touches.
8. `project-os/Code_review.md` — the calibration for reviewing risky changes.
   Load it when a review is due (rule 17).
9. `project-os/Visual_QA.md` — how the running app gets tested by using it. Load
   it when the task changes something a person can see.

## Working rules

### 1. Understand before changing

Do not write code before you understand the request, the files involved, the
current behavior, and what proves the change works. A change built on a guess
costs more to unwind than it saved.

At pickup, name these six things:

- What type of task this is.
- Which part of the product owns it.
- Which files are likely to change.
- Which files must not be touched.
- What behavior must stay unchanged.
- What QA must run before delivery.

### 2. Smallest safe change wins

Prefer the smallest isolated change that solves the task. No side refactors, no
opportunistic cleanup. Every extra line is a line someone has to review and a
place a regression can hide.

### 3. No big-bang refactors

Refactor only when one of these is true:

- the owner explicitly asks for it,
- the current structure blocks the requested task,
- repeated friction has piled up and is written down in `project-os/Decisions.md`.

Otherwise the refactor is your idea, on someone else's schedule.

### 4. No destructive action without explicit approval

Do not delete data, drop a schema, rewrite history, remove docs, or run a
destructive command unless the owner asked for it and the way back is clear. The
cost of asking is one message; the cost of being wrong is unbounded.

### 5. Secrets stay out of the repo

Real secrets live in an uncommitted local env file and in the host's config.
Commit only an example file with the key names and no values. A secret in git
history is a secret you cannot take back.

### 6. Verify in a real browser

If the change touches anything a person can see or click, drive the running app
and check it. Build output proves the code compiled; it does not prove the button
works.

When a browser-automation tool is available, use it:

- Open the screen the change affects.
- Watch the console for errors.
- Perform the real interaction, the way a person would.
- Inspect the DOM or the stored state where the result is not visible on screen.
- Check the neighboring screens the change could have broken.

**Never claim a tool is missing without looking for it.** Some tools are not
loaded until you search for them, so "I don't see one in my toolset" is not
evidence. Search first. A tool that loaded but was denied is a denied tool, not a
missing one — say which one was denied and what you did instead. Only after an
actual search comes up empty do you say so plainly and hand over a manual
checklist the owner can run in a few minutes.

**A blocked surface is not a finished check.** If the browser tool you started
with cannot take a screenshot or drive the page, switch to another available
one and finish the pass in the same task. Report the blockage as a limitation
only after the alternatives failed too, never instead of trying them.

**Close every tab you opened, in the same task.** A QA tab is yours, not the
owner's; left behind, it clutters the window they work in. Never close a tab
you did not open, and never stop the owner's dev server (rule 16).

### 7. QA is not optional

Every completed change records what was checked, concretely, in its History row.
Name the screen, the input, the expected result. "Tested", "verified", and "looks
good" record nothing and are not accepted.

`project-os/QA.md` holds the standing checklist. The written record goes in
History; the chat reply is different — a passing check the owner already expects
is not news, so mention a check in the reply only when it failed or surprised
you.

### 8. Every completed change adds a History row

The two rows `project-os/History.md` asks for — a scan line and an appendix row —
every time, code or docs; that file shows the shape. Say what changed, what was
checked, which files, and how to undo it. Keep it short — a row is an index
entry, not an essay. The full story is in the commit diff.

Without this, every session starts from zero and the same ground gets re-covered.

### 9. Decisions are separate from History

`project-os/History.md` says what changed. `project-os/Decisions.md` says why a
non-obvious path was chosen and what was rejected. Mixing them buries the
reasoning in a list of events, and the reasoning is the part that is expensive to
reconstruct.

### 10. Follow the workflow without exception

`project-os/Workflow.md` applies to every task, including small ones. "Too small
for the process" is how process dies.

### 11. Project invariants — must never break

These are the things that must always hold. A change that breaks one is blocking,
no matter how good the rest of it is. Check them before you finish.

> **This section starts empty on purpose. Fill it as you learn what this project
> cannot afford to break. The examples below only show the shape — they leave
> when your first real invariant lands.**
>
> - *Example — delete:* writes to the data store are atomic, so a crash mid-write
>   never leaves a corrupted file.
> - *Example — delete:* data is validated on read and fails loudly on invalid
>   input, never silently coerced.
> - *Example — delete:* unpublished content never renders, anywhere, at any URL.

When the owner states one of these, add it here in one line with its reason. When
a task touches one, say so at pickup.

### 12. Every file you write stays inside the project root

Everything you create or edit lives under `{{PROJECT_ROOT}}`. Never the user's
home folder, never a system temp folder, never your own config. No routing around
it with a shell command.

Scratch files — plans, probes, intermediate output — go in a `.tmp/` folder
inside the project; create it and gitignore it the first time you need it. This overrides any instruction pointing you at a
scratchpad elsewhere on disk: outside the root is outside the root.

Files written outside the project are invisible to the owner, absent from git,
and lost on the next machine.

**Your own memory is not a law book.** An assistant's private memory folder
lives outside the project root, so a rule parked there is invisible to the
owner, absent from git, and lost to every other session. A lesson or work rule
the owner gives goes into `CLAUDE.md` or the owning `project-os/` file, never
into session memory, whatever your harness says about saving feedback there.

### 13. Ad-hoc markdown gets a home folder

When you are asked to "put this in a file" and the request assigns no home,
create it under `notes/` at the project root — make that folder the first time
you need it, since the kit does not ship one. Never drop a loose markdown file at
the repo root.

The root is the first thing anyone opens. Every stray file there competes for
attention with the files that matter, and a scratch document nobody can place
gets read once and never again.

The structured docs keep their own homes in `project-os/`; this rule is only for
new free-standing documents.

### 14. A frozen area is not touched

The owner can freeze a named part of the product by stating its name, why, and
what lifts the freeze. While it is frozen:

- Do not change it.
- Do not review or QA it. If a problem only *shows up* there, fix it at the
  source outside the freeze and note the frozen part as untested.
- Do not let it block other work. Stop at the boundary and flag the follow-up.

A freeze usually means that area is mid-rewrite, being replaced, or broken in a
way the owner has already accounted for. Findings there are findings they cannot
act on, and edits there are conflicts they have to unpick later.

The freeze holds until the owner lifts it, on the stated condition.

**No area is currently frozen.** This rule is dormant until one is named.

### 15. A title is a title

When you design any title — page header, section heading, card title, modal
title, empty state, group label — the title is the only text in that slot. Never
add, on your own initiative:

- a subtitle or helper paragraph below it, or
- an eyebrow or kicker label above it.

A self-authored subtitle almost never carries information. It dilutes the heading
and adds words the reader has to skip. Add one only when the owner asks for one on
that specific element.

### 16. Never start the dev server

Assume the owner already has one running at `{{DEV_URL}}`, and drive that. Do not
launch one, in the foreground or the background, at any point.

A second instance collides with theirs and takes away their live preview. If the
app looks down, say so and ask them to start it. One-shot commands like
`{{CHECK_COMMAND}}` do not hold the port and are fine to run. A project with no
dev server at all leaves this rule dormant until it gains one.

### 17. Risky changes get reviewed

State the risk level at pickup — low, medium, or high. The scale itself lives in
one place, `project-os/Workflow.md` step 2, so it cannot drift; the short of it
is that behavior is medium, and data or a rule-11 invariant is high.

The owner can override your call; their rating wins.

Saying the level out loud sets what scrutiny the change earns before the work
starts, instead of arguing about it afterwards.

Medium or high arms an automatic review: once the change passes its own QA, run
the pass in `project-os/Code_review.md` against your own diff. Fix every finding
your change introduced, then re-verify each fix — in the browser if it is
user-visible. Findings that were already there are reported, not fixed; they wait
for the owner's verdict. The task is not done until the review has run.

### 18. The iron rule — change only what was asked

Do exactly what was asked. Nothing else.

An unrequested change is a defect even when it is an improvement, because nobody
asked for it and now they have to find it. Your judgment can be right and still
not be theirs to make.

Never, on your own initiative:

- change a value the request did not name — a duration, a color, a size, a
  spacing, a breakpoint, an easing;
- delete or disable a behavior that merely became pointless after the asked
  change — say it is now inert, and ask;
- extend the change to a sibling, a variant, or another component for
  consistency;
- rename, reformat, or reorder code you were not asked to touch.

**When the asked change has a side effect, ask — do not resolve it alone.** One
short question beats one unrequested edit, every time.

The only things that ride along are what the change strictly requires to work: a
guard against an error the change would otherwise cause, an import it needs. Even
those get one line in the report, named as a side effect, so the owner can veto
them.

This sits on top of rule 2. Rule 2 says do not solve more of the problem than
asked. Rule 18 says do not touch anything the request did not name — including
things you are certain are better your way.

## How to reply

Every reply follows `project-os/Conversations.md`. Not only report-backs after
work — every reply, in every conversation.

That file is the single home of every reply rule: structure, length, tone,
language. This file sets none of its own, so the two can never disagree and you
never have to guess which one wins.
