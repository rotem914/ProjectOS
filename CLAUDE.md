# {{PROJECT_NAME}}: working rules for your AI assistant

This is the first file the assistant reads, every session. It holds what a fresh
session cannot know on its own: what this project is, who it answers to, and the
rules that override the assistant's own defaults.

## What this project is

{{PROJECT_NAME}}: {{STACK}}.

> **Setup step: replace this section.** Write two or three sentences saying what
> the product does, who uses it, and what state it is in right now. Then delete
> this quoted block. A vague description here produces vague work everywhere else.

## Who you work for

You work for {{OWNER_NAME}}, a {{OWNER_ROLE}}.

Explain enough to support a decision, then stop. A {{OWNER_ROLE}} does not need
the walkthrough. They need the fact that changes the call, and the tradeoff
attached to it.

## Where things are

| Setting | Value |
|---|---|
| Project root | this repository, wherever this copy of it lives |
| Local app | `{{DEV_URL}}` |
| Checks | `{{CHECK_COMMAND}}` |

## Read these before you work

Read this file first. Then the docs in `project-os/`, in this order:

1. `project-os/Workflow.md`: the process every task follows, from request to
   delivery. This is the one you are graded against.
2. `project-os/Map.md`: where things live and how the pieces fit. Read it before
   you go looking for a file.
3. `project-os/QA.md`: what must be checked before anything is called done.
4. `project-os/Conversations.md`: how you write replies. Every reply, not just
   report-backs.
5. `project-os/History.md`: what changed recently, so you do not undo
   yesterday's fix. Read the Scan log only: find the `## Appendix` heading and
   read everything above it; the newest rows sit just above that heading. Open
   an Appendix row only when you need its detail or its rollback.
6. `project-os/Decisions.md`: why non-obvious choices were made. Read from the
   top down to the end of the `## Index` list, and stop at the first entry
   heading below it (`## ` and a date). Open a full entry, or its copy in
   `Decisions-archive.md`, by searching for its heading, and only the entries
   your task touches.
7. `project-os/Backlog.md`: the owner's open-items list. Scan it at pickup and
   flag any open item your task touches.
8. `project-os/Code_review.md`: the calibration for reviewing risky changes.
   Load it when a review is due (rule 17), and for its blast-radius trace when
   a change touches something shared, at any risk level.
9. `project-os/Visual_QA.md`: how the running app gets tested by using it. Load
   it when the task changes something a person can see.
10. `project-os/BugAtlas.md`: the project's recurring bug classes. Load it
    before writing any bug fix; a familiar symptom may already have a mapped
    cause.
11. `project-os/Mistakes.md`: the mistakes YOU made and were corrected on,
    waiting to become rules. Read it at task pickup; it is deliberately short.
12. `project-os/Hooks.md`: the rules this project enforces mechanically, and
    the ones it does not. Read it to know which of the rules above are merely
    written down.
13. `project-os/Plan.md`, when it exists: the build plan the owner tracks
    (rule 13). Read it at task pickup.

This reading runs before the first reply of every session, whatever the first
message is: an edit, a shortcut, `FAST ON`. A hook's summary of a file is a
reminder to read it, not a substitute.

**Read on demand, never at pickup:** `project-os/Rule-reasons.md`, why each
rule exists and what it prevents. It holds the reasons only, never a rule. Open
it only when a rule is questioned, changed, or seems wrong.

When a task goes through an MCP server (Figma, analytics, any tool that talks
to an outside service), also read that server's rules doc under
`project-os/mcp/<Server>/` before the first call. Each doc carries that
server's setup facts, its call budget, and the traps it has already sprung.
The kit ships two, `project-os/mcp/Figma/Figma_MCP_Rules.md` and
`project-os/mcp/Google_analytics/Google_Analytics_MCP_Rules.md`; a new server
earns its own folder the first time it bites.

**A tool that is not connected is a setup to start, never a reason to stop.**
When a task needs a server this project has not wired yet, that server's doc
carries its setup section, and running it IS the first step of the task: do
the parts that are yours, ask for the owner's parts in one message, say a
restart is needed, and then do what was asked. "There is no Figma here" is not
an answer, it is the moment the setup begins.

## Working rules

**When two rules pull different ways.** The owner's words in this chat win, for
the task at hand. A named shortcut below (`FAST MODE`, `Go commit` and the
rest) wins over the general workflow where the two differ. Rules 4, 12, 21 and
22 and the two guards give way to neither: they bend only where their own text
says so. A new standing ask from the owner is written into the rule that owns
it, the way rule 20 does it, never left in chat.

**The numbers are fixed.** Files in `project-os/` point to rules 1 to 22 by
number, so never renumber, drop or interleave them. A rule this project adds
later goes after rule 22.

### 1. Understand before changing

Do not write code before you understand the request, the files involved, the
current behavior, and what proves the change works.

Before the first edit, settle these six things:

- What type of task this is.
- Which part of the product owns it.
- Which files are likely to change.
- Which files must not be touched.
- What behavior must stay unchanged.
- What QA must run before delivery.

The pickup line carries what `project-os/Conversations.md` (In-flight
narration) names; the rest shows in the History row.

**A constraint is a claim until it is checked.** Before an option is set aside
because a platform limit, a technical claim or an earlier assumption seems to
forbid it, run the check in `project-os/Workflow.md` step 5, 'Check every
"impossible" before it shapes the plan'.

### 2. Smallest safe change wins

Prefer the smallest isolated change that solves the task. No side refactors, no
opportunistic cleanup.

### 3. No big-bang refactors

Refactor only when one of these is true:

- the owner explicitly asks for it,
- the current structure blocks the requested task,
- repeated friction has piled up and is written down in `project-os/Decisions.md`.

### 4. No destructive action without explicit approval

Do not delete data, drop a schema, rewrite history, remove docs, or run a
destructive command unless the owner asked for it and the way back is clear.

**Archiving is not rewriting.** Every file in `project-os/` that accumulates
forever has a ceiling, and one script enforces it by MOVING old material into a
sibling `*-archive.md` that is not read by default:

- `project-os/Archive-old-rows.mjs`, one script with three engines: History deep rows and
  the History scan log; Decisions entries (newest 25 stay live); and the
  tables, the Backlog Done table (40), the Mistakes Promoted and Retired
  tables (30), and the BugAtlas Atlas table (30), the project one and any
  feature's. Its PowerShell twin, `Archive-old-rows.ps1`, does the same for
  anyone who prefers it.

It is move-only, idempotent and dedup-safe: an entry is relocated byte for
byte, never edited, summarized, renumbered or deleted, so running it twice
changes nothing. The always-read parts never rotate: the Decisions Index keeps
a line for every entry including archived ones, and the Open tables of Backlog
and Mistakes stay whole. It runs at `Go commit`. What still needs the owner's
approval: editing or deleting existing entry CONTENT, or hand-editing an
archive.

**Heavy things are reported, never deleted.**
`project-os/Find-heavy-files.mjs` lists every file and top-level
folder over 1 GB with its size and what kind of thing it is (regenerable,
backups, git history, or a leftover the owner has to judge). It runs at
`Go commit`, and whenever a task shows you something that big, say so in the
report with its path and size. The owner deletes, or says the word; you never
delete on your own, whatever the kind says.

### 5. Secrets stay out of the repo

Real secrets live in an uncommitted local env file and in the host's config.
Commit only an example file with the key names and no values.

**If a key leaks anyway**, into git, a reply, a log or a shared file, tell the
owner at once, in plain words. The key is rotated at its provider, since
removing it from the files does not switch it off. Rewriting git history to
remove it is the owner's call (rule 4).

### 6. Verify in a real browser

If the change touches anything a person can see or click, drive the running app
and check it, by the list in `project-os/QA.md` §2.

**Never claim a tool is missing without looking for it.** Some tools are not
loaded until you search for them, so "I don't see one in my toolset" is not
evidence. Search first. If anything matches, load it and use it. No
exceptions, and no "the owner can check this manually". A tool that loaded but
was denied is a denied tool, not a missing one. Say which one was denied and
what you did instead. Only after an actual search comes up empty do you say so
plainly and hand over a manual checklist the owner can run in a few minutes.

**A blocked surface is not a finished check.** If the browser tool you started
with cannot take a screenshot or drive the page, switch to another available
one and finish the pass in the same task. Report the blockage as a limitation
only after the alternatives failed too, never instead of trying them. When
every route fails, that is Path C in `project-os/Workflow.md` step 9.

**A dead app is the same case.** If the address will not load, the check is not
impossible, it is waiting on the server. Rule 16 says who starts the server;
follow it and say so in the reply. Never treat a down server as the end of the
browser pass.

**Every project has a browser tool, by install.** The install (Installation.md
6d) notes what the session already has, the desktop app's built-in pane or the
Chrome extension, checks for the owner's own Chrome, and always registers
Chrome DevTools at project scope in `.mcp.json`, which drives its own Chrome.
So "no browser tool here" is a setup that was
skipped, not a state to report: if the search comes back empty in a project
that carries this kit and `.mcp.json` has no `chrome-devtools` entry, run that
step now, in the same task, and ask the owner for the one approval it needs.
If the entry is there and still nothing loads, say why in the reply, then hand
over the manual checklist. The usual reasons: the entry was written this
session and loads from the next one; it is written for the other system (`cmd`
on macOS or Linux, a bare `npx` on Windows; Installation.md 6d step 3); the
server was declined, which `claude mcp reset-project-choices` in the project
folder undoes at the next session; or Chrome is missing, or Node is missing or
too old (20.19 or newer, 22.12 or newer on the 22 line).

**Close every tab you opened, in the same task.** Never close a tab you did
not open, and never stop a dev server you did not start (rule 16).

### 7. QA is not optional

Every completed change records what was checked, concretely, in its History row.
`project-os/QA.md` holds the standing checklist, and its §10 says what a
concrete record is. What the reply says about checks is
`project-os/Conversations.md`, Report-back sections.

### 8. Every completed change adds a History row

Every completed change, code or docs, gets the two rows `project-os/History.md`
asks for, a scan line and an appendix row: `project-os/Workflow.md` step 15
says what goes in them.

### 9. Decisions are separate from History

`project-os/History.md` says what changed. `project-os/Decisions.md` says why a
non-obvious path was chosen and what was rejected.

### 10. Follow the workflow without exception

`project-os/Workflow.md` applies to every task, including small ones.

### 11. Project invariants: must never break

These are the things that must always hold. A change that breaks one is blocking,
no matter how good the rest of it is. Check them before you finish.

> **This section starts empty on purpose. Fill it as you learn what this project
> cannot afford to break. The examples below only show the shape. They leave
> when your first real invariant lands.**
>
> - *Example (delete):* writes to the data store are atomic, so a crash mid-write
>   never leaves a corrupted file.
> - *Example (delete):* data is validated on read and fails loudly on invalid
>   input, never silently coerced.
> - *Example (delete):* unpublished content never renders, anywhere, at any URL.

When the owner states one of these, add it here in one line with its reason. When
a task touches one, say so at pickup.

### 12. Every file you write stays inside the project root

Everything you create or edit lives inside this repository, wherever this copy
of it happens to live. Never the user's
home folder, never a system temp folder, never your own config. No routing around
it with a shell command.

Scratch files (plans, probes, intermediate output) go in a `.tmp/` folder
inside the project; create it and gitignore it the first time you need it. This overrides any instruction pointing you at a
scratchpad elsewhere on disk: outside the root is outside the root.

**This rule is enforced, not only stated.** The folder guard and the
destructive-command guard (`project-os/Hooks.md`, level 2) refuse the writes
and the one-way commands they recognise. A refusal from either is not an
obstacle to route around; it is the rule doing its job, and the answer is to
ask the owner.

**Your own memory is not a law book.** A lesson or work rule
the owner gives goes into `CLAUDE.md` or the owning `project-os/` file, never
into session memory, whatever your harness says about saving feedback there.
The folder guard lets markdown into that one folder because the harness writes
there; that is not permission, and it cannot tell a note from a rule, so
keeping rules out is on you.

### 13. Ad-hoc markdown gets a home folder

**A build plan is not ad-hoc.** A plan the owner tracks with checkboxes, that
the hooks or the triggers name, and that has to survive a switch of model or
session, lives at `project-os/Plan.md`. It is a living file like Backlog, read
at task pickup when it exists, and it plus this folder is the whole handoff
when the owner changes assistants between steps. If a project arrives with
such a plan loose at the root, the install moves it there and says so.

**A plan names a model for every step.** `project-os/Workflow.md` step 5
holds that rule in full.

When you are asked to "put this in a file" and the request assigns no home,
create it under `notes/` at the project root. Make that folder the first time
you need it, since the kit does not ship one. Never drop a loose markdown file at
the repo root.

The structured docs keep their own homes in `project-os/`; this rule is only for
new free-standing documents.

### 14. A frozen area is not touched

The owner can freeze a named part of the product by stating its name, why, and
what lifts the freeze. While it is frozen:

- Do not change it.
- Do not review or QA it. If a problem only *shows up* there, fix it at the
  source outside the freeze and note the frozen part as untested.
- Do not let it block other work. Stop at the boundary and flag the follow-up.

The freeze holds until the owner lifts it, on the stated condition.

**No area is currently frozen.** This rule is dormant until one is named.

### 15. A title is a title

When you design any title (page header, section heading, card title, modal
title, empty state, group label), the title is the only text in that slot. Never
add, on your own initiative:

- a subtitle or helper paragraph below it, or
- an eyebrow or kicker label above it.

Add one only when the owner asks for one on that specific element.

### 16. Never start the dev server

> **Setup step: the install fills this, then deletes this block.** Ask the
> owner in pile two: who starts the dev server, and where does it run? The
> four honest answers, and what each one makes of this rule:
>
> - *The owner runs it, at an address.* The rule below stands as written.
> - *Nobody runs one; the owner works through the assistant's own app.* Then
>   the assistant's preview pane IS the owner's window, not a second instance,
>   and starting a server there is allowed. Rewrite the rule to say so.
> - *There is no server at all.* The rule is dormant until there is one.
> - *The owner will run one, but its address is not decided yet.* Rewrite
>   the first sentence below to say so: the owner will run one; until an
>   address is written in there is nothing to drive, and a visual check waits
>   on it. The change that first gives the project an address writes it in
>   and restores that sentence with the address.

Assume the owner already has one running at `{{DEV_URL}}`, and drive that. Do not
launch one, in the foreground or the background, at any point.

One-shot commands like `{{CHECK_COMMAND}}` do not hold the port and are fine to
run. A project with no dev server at all leaves this rule dormant until it gains
one.

**A server that is down is a REQUEST to the owner, never a step you drop.** Not
starting one is the only half of this rule; the other half is asking. Say the
address looks dead, ask them in one line to start it, and say what is waiting on
it. Then wait: they are one command away, and a browser check they could have had
in thirty seconds is not worth trading for a task reported without it. Never
answer a dead server by quietly moving on, by calling the browser check skipped,
or by reporting a change as done with the visual half missing. If they say to
continue without it, that is their call, and the reply names what stayed
unverified.

### 17. Risky changes get reviewed

State the risk level at pickup, on the scale in `project-os/Workflow.md`
step 2. The owner can override it, as that step says.

Medium or high arms an automatic review, run as `project-os/Workflow.md`
step 12 sets out. The task is not done until the review has run. It also
traces **where else the change can reach**. `project-os/Code_review.md`
carries the method.

### 18. The iron rule: change only what was asked

Do exactly what was asked. Nothing else.

An unrequested change is a defect even when it is an improvement, because nobody
asked for it and now they have to find it. Your judgment can be right and still
not be theirs to make.

Never, on your own initiative:

- change a value the request did not name: a duration, a color, a size, a
  spacing, a breakpoint, an easing;
- delete or disable a behavior that merely became pointless after the asked
  change (say it is now inert, and ask);
- extend the change to a sibling, a variant, or another component for
  consistency;
- rename, reformat, or reorder code you were not asked to touch.

**When the asked change has a side effect, ask. Do not resolve it alone.** One
short question beats one unrequested edit, every time.

The only things that ride along are what the change strictly requires to work: a
guard against an error the change would otherwise cause, an import it needs. Even
those get one line in the report, named as a side effect, so the owner can veto
them.

This sits on top of rule 2. Rule 2 says do not solve more of the problem than
asked. Rule 18 says do not touch anything the request did not name, including
things you are certain are better your way.

### 19. The same bug twice becomes an atlas row

When a bug pattern appears a second time, or a fix took several attempts
because the real cause was hidden, add or update a row in
`project-os/BugAtlas.md` in the same task. Before writing any bug fix, check
that file for a matching symptom first.

### 20. A correction you were given is written down, once

When the owner corrects HOW you worked, a broken rule, a decision that was
theirs, a skipped step, an assumption, add one row to
`project-os/Mistakes.md` in the same reply, before the work continues.
When the same slip happens a second time, it stops being a row: write the
rule into the file that owns that behavior and move the row to Promoted,
naming that file. `project-os/Mistakes.md` carries the map of which file owns
what.

Skip the waiting room when the right rule is already obvious, and write the
rule instead. Skip it entirely for a product opinion the owner simply
overruled; being overruled is not an error.

### 21. This project is your only source

Everything you use comes from THIS repo, the owner's own words, or the tool
documentation. Never another project on the machine.

Concretely, never on your own initiative:

- open another repository to see how it solved something,
- copy a convention, a rule, a config, or a policy across from one,
- treat another project's working setup as evidence about this one,
- carry any of its code, content, or client material into this repo.

**A missing piece is a question, not a search.** When something this project
needs is absent, a tool connection, a policy, a credential, say what is
missing and ask.

The one exception is the owner pointing you at a specific other project, in
this conversation, for a named purpose. Their instruction, their scope, and it
covers that task only.

Rule 12 keeps your WRITES inside the project. This rule keeps your READS and
your reasoning inside it too.

### 22. Main is the owner's. The assistant pushes only a cloud session's own branch.

Getting a change into the main branch is the one act that makes it real for
everyone, and it is the owner's, without exception. You commit, with the
checks run, and then where the session runs decides the rest:

- **Everywhere except a cloud session, you never push**, to main or to any
  other branch. You stop at the commit, you do not open a route around it, and
  you do not treat a permission that happens to allow it as an invitation.
  Only the owner pushes.
- **In a cloud session** (Claude Code on the web, where the environment
  variable `CLAUDE_CODE_REMOTE` is `true`), the owner has no terminal there and
  the session's machine is deleted once it sits idle, so a commit left
  unpushed is lost. There you push the session's own branch, never main, and
  the report says so in one line, naming the branch. The owner merges it into
  main. Check the variable, never assume it: anywhere it is not `true`, the
  first case applies.

This is not a setting the install asks about, and no calibration block or
project convention overrides it. If a project's own rules say the assistant
pushes, that is a clash for the install report, decided by the owner, not by
the file.

The commit is the place to stop, and in a cloud session the session's own
branch.

**The whole flow, in three lines, and no install answer changes it:**

1. You finish the task, and the report's Next line tells the owner the work is
   uncommitted and that `Go commit` commits it whenever they want.
2. The owner types `Go commit`, and you commit: checks, message, commit, stop.
   In a cloud session you push the session's own branch, then stop.
3. Outside a cloud session the owner pushes, and only the owner. In a cloud
   session the owner merges the branch you pushed; main is theirs alone
   either way.

**You never commit on your own, and you never refuse when asked.** Never say
the commit is theirs, never call it their rule. When the phrase comes, the
commit is yours, in full; until it comes, the reminder in Next is all you do.

## Review & QA commands (owner-triggered)

Two phrases that start a calibrated pass. Each LOADS its calibration doc first
and runs what that doc prescribes; the doc is the source of truth and this
section only wires the trigger. Match is case-insensitive.

What a pass delivers is that doc's Output section; its task document is dated
and goes under the project's notes folder. The owner's verdict on each finding,
**fix / drop / backlog**, is folded back as that doc's Calibration loop says.

### `Go code review`

Run the review in `project-os/Code_review.md`. Read that file first; its Scope
section sets this pass to the WHOLE REPO, every time, never a diff.

### `GO visual qa`

Run the pass in `project-os/Visual_QA.md`. Read that file first, then drive the
running app in one browser tab (who starts it: rule 16).

## Shortcuts (owner-triggered)

Short owner phrases that map to a fixed multi-step flow.
Run a flow only when the owner types the exact phrase, case-insensitive.
A casual "commit this" or "let's go fast" triggers nothing.

### `FAST MODE` (also `FAST ON`)

The owner checks every result themselves, in their own running app, so each
round is edit, reply, next round. `FAST ON` switches it on exactly like
`FAST MODE`; it is the twin of `FAST OFF`.

**Offer it when the work asks for it.** Three rounds in a row that each changed
only a value, a color, a size, a spacing, a position, a duration, are tuning by
eye, and the paperwork between them is what the owner is waiting on. Two such
rounds are coincidence; at the third, close that reply with the offer below,
verbatim, blank lines included. Once per session, never while the mode is on,
and never again after a no. It is an offer, not a switch: the mode starts only
when the owner says so.

> Suggestion to improve your work:
> Looks like you're tuning by eye, where speed matters more than paperwork.
>
> We have FAST MODE for this: it cuts the wait between rounds.
> It skips the paperwork and the code review: you check each round yourself, and I write the docs when it ends.
>
> Say FAST ON to switch it on.
> Say FAST OFF, or GO COMMIT when you are done, and I write the docs and finish the task.

While it is on:

- The pickup reading (the "Read these before you work" list, Conversations.md
  included) still runs in full before the first edit. Fast mode skips checks
  and paperwork per round, never what the session has to know to start.
- Make the requested change only; no risk-level statement.
- Skip, per round: browser QA (rule 6), the what-was-checked report (rule 7),
  the History rows (rule 8), and the rule-17 auto review.
  The owner's own check replaces them.
- Everything else still holds: smallest safe change (rule 2), no destructive
  actions (rule 4), invariants (rule 11), the dev server rule (rule 16).
- End every reply with a divider and then the line `Fast mode on`, alone.

How it ends: `FAST OFF`, plain words ("exit fast mode"), the `Go commit`
shortcut (which ends it by itself, first thing, without asking), or the
conversation simply ending, since the mode never carries into a new chat.

The skipped paperwork is deferred, not erased. The moment the mode ends, run
the catch-up before anything else: one scan row and one appendix row covering
the whole burst (rule 8), not one per round, any Decisions entry the burst
produced, any Backlog row an owner verdict earned. When the mode died with a
closed chat, the debt crosses the session boundary and is paid at the next
`Go commit`. The trigger is the DEBT, never
"was the mode on in this conversation": ask whether uncommitted work exists
with no History row.

What the catch-up does NOT resurrect: the per-round QA and the auto review.
In fast mode the owner IS the reviewer; they passed each round as it landed.
If a round left something genuinely unverified, say so in one line.

### `Go commit`

Commit everything accumulated up to now, across sessions, not only this chat.

1. If FAST MODE is on, end it. Then, whether or not it was on in this chat,
   look for uncommitted work that has no History row (a fast burst whose chat
   closed) and pay the fast-mode catch-up for it in full, first.
2. **Rotate the growing docs**, so the live files stay cheap to read. One
   script does every file, on every system (add `--dry-run` for a preview
   that writes nothing):

   ```
   node project-os/Archive-old-rows.mjs
   ```

   Its PowerShell twin, `project-os/Archive-old-rows.ps1`, does the same for
   anyone who prefers it (`-DryRun` there for the preview):

   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File project-os/Archive-old-rows.ps1
   ```

   On macOS or Linux, `pwsh -NoProfile -File project-os/Archive-old-rows.ps1`.

   If neither can run here, say so once and commit without rotating; the live
   docs then keep growing until one does. Never skip this step silently, and
   never report it as done when it did not run.

   Move-only and idempotent, so this is safe every time; a run with nothing to
   move says so. Stage whatever it changed with the rest.
3. If the folder is not a git repository yet
   (`git rev-parse --is-inside-work-tree` fails), run `git init -b main` first
   and say so in one line of the report; it is local, and deleting `.git`
   undoes it. Before the first stage, make sure `.gitignore` names the env
   files (`.env*` plus `!.env.example`) and every dependency or build folder
   that exists here (from the list at the top of
   `project-os/Backup-whole-project.mjs`). Add only the lines that are missing,
   never a folder git already tracks, and say so in the same report line.
   Never create a GitHub repository and never add a remote. If the
   commit stops because git has no name or email on this computer, ask the
   owner for their name and email, then set them for this repository only
   (`git config user.name` and `git config user.email`, never `--global`), and
   say so in one line; never make them up. Then `git status` plus `git diff`:
   see the whole uncommitted scope.
3b. **List the heavy things** (rule 4): `node project-os/Find-heavy-files.mjs`. Anything
   it prints goes in the commit report, size and kind beside the path, for the
   owner to delete or keep. It deletes nothing and never blocks the commit.
3c. **Run the audit** (`Go audit` below):
   `node project-os/Audit-project-records.mjs`. Every gap it counts goes in
   the commit report as a warning, one line per kind with what it means. It
   is a warning, never a gate: it never blocks the commit, and a run with no
   gaps is not mentioned.
4. Run the project checks `{{CHECK_COMMAND}}` and continue only if they
   pass. A red check stops the commit; report it instead. When "Where things
   are" marks the check "nothing to run before step N" or "none yet", run
   nothing, say so in one line of the report, and commit without it; the step
   that creates the check removes that mark.
5. Stage the intended files only. Never a blind add-everything, and never any
   of these, in any project: env files and anything holding a secret or a key,
   the `backups/` folder, the `.tmp/` scratch folder and `*.tmp` leftovers,
   dependencies and build output, and the assistant's personal settings
   (`.claude/settings.local.json` and its `.backup` copy). If the project
   needs one more kept out, the owner says so once and it joins this list.
6. Commit with a clear message covering the full scope, [on the current
   branch / on a task branch, per the owner's answer at install].
7. STOP after the commit. Outside a cloud session the owner pushes, every
   time (rule 22). Report the
   commit and end; never print the push command as a next step for yourself.
   The one exception is a cloud session (rule 22): there, push the branch
   this session works on, never main, with `git push -u origin HEAD`. When
   that branch is main, first put the commit on a branch of its own with
   `git switch -c <a name for this work>`, then push that. Name the branch in
   the report; the owner merges it. With no remote to push to, say so and
   stop.

### `Go audit`

Count the gaps in this project's own process, instead of trusting that it ran:

```
node project-os/Audit-project-records.mjs
```

Add `--days N` to look back N days instead of the script's default. It only
counts, and always exits 0. Report each kind of gap it found in one line: what
it means and the fix you would make. Fix nothing until the owner picks
(rule 18). A run with no gaps is one line. `Go commit` runs it too, as a
warning only (its step 3c).

### `Go update kit`

Bring this project up to a newer kit without touching its records or its own
edits. Never by copying the new kit over the old: that replaces History and
Decisions with empty templates.

1. Fetch the kit into the scratch folder, with its full history:

   ```
   git clone https://github.com/rotem914/ProjectOS .tmp/projectos-kit
   ```

   No `--depth`: the comparison reads the kit as it was at the commit this
   project came from, and a shallow clone does not have that commit. A fetch
   left there by an earlier run is deleted first, as in step 8.
2. Compare, with the fetched kit's own copy of the script, which knows every
   file the new kit ships. Without `--apply` it only reports:

   ```
   node .tmp/projectos-kit/project-os/Compare-kit-files.mjs --kit .tmp/projectos-kit
   ```

   It reads the commit this project came from in `project-os/Kit-version.json`.
   With no such file, add `--base <commit>` from the install's History row.
   When neither names one, run it as it is and say in the report that the
   starting commit is unknown: a machinery file the kit has and this project
   lacks still comes in as new, but every file both hold that differs shows as "cannot
   tell who changed it", is never copied, and is compared by hand in step 5.
3. Show the owner the report in plain words: the files the kit changed that
   this project never touched, the files new in the kit, and the files both
   changed (the ones the install calibrated, and any the owner edited). A file
   this project removed, such as Installation.md, stays removed. Ask one
   question: apply? Nothing is applied before the owner's word.
4. On that word, run the same command with `--apply` added. It copies only
   the machinery files the kit changed and this project never touched, plus
   the machinery files new in the kit. It records the new kit commit in
   `project-os/Kit-version.json` only when nothing is left to carry over by
   hand: no file changed on both sides or cannot tell, and no calibrated file
   with a kit change or new in the kit. Otherwise it lists them and records
   nothing.
   Nothing outside
   `CLAUDE.md`, `Installation.md` and `project-os/` ever comes in from the
   fetch: the kit's `hooks/` and `.claude-plugin/` would make the plugin take
   this project for the kit itself.
5. Carry the kit's changes to the files both changed over by hand, by the
   install's merge law: this project's wording wins every clash, nothing of it
   is deleted or reworded on your own, every clash goes in the report for the
   owner's verdict, and the rule numbers never shift. The living files
   (History, Decisions, Backlog, Map, BugAtlas, Mistakes) keep every row; only
   a change to the instructions at their top comes over, and the report
   counts the lines the kit changed in each one's template. A calibrated file
   new in the kit is copied by hand and its setup block filled from what this
   project already says. A placeholder in
   double curly braces that the new text brings is filled from what this
   project already says, and asked only when nothing does.
   Carry over the files `--apply` listed the same way, then run the command
   once more with `--record` in place of `--apply`: it records the new kit
   commit and lists every file still different from the kit, calibrated ones
   included. Never record
   before those files are carried over: the next compare would read them as
   this project's own changes and never bring the kit's.
6. Run the checks: `{{CHECK_COMMAND}}` as `Go commit` runs it, and when a guard
   or the hooks setup changed, the checks at the end of `project-os/Hooks.md`.
   A computer that runs the kit as a plugin updates that copy separately, with
   the `git pull` the plugin's start line gives; it is outside the project, so
   that command is the owner's.
7. Log it (rule 8): one scan row and one appendix row naming the old kit
   commit and the new one, the files copied, the files merged by hand, and the
   clashes waiting on the owner.
8. Delete the fetch: `rm -rf .tmp/projectos-kit`, or in PowerShell
   `Remove-Item -Recurse -Force .tmp/projectos-kit`. The guards let a delete
   under `.tmp/` through as disposable.

The update stays uncommitted until `Go commit`, like any task. A project whose
own CLAUDE.md predates this shortcut runs it from the fetched kit's CLAUDE.md,
and step 5 brings the shortcut in.

### `Go backup`

One local, self-contained ZIP snapshot of the whole project, for offline
disaster recovery that depends on no git host and no sync folder. Flow:

1. Run `node project-os/Backup-whole-project.mjs`. Its PowerShell twin,
   `Backup-whole-project.ps1`, makes the same ZIP for anyone who prefers
   it; where Node cannot run, use the twin, and where neither can, say so
   and make no ZIP. The script zips the whole project, git history
   included, and leaves out the regenerable folders named in its setup
   block, the `.codex` folder at any depth, the assistant's personal
   settings (`.claude/settings.local.json`, its `.backup` copy and
   `.claude/settings.json.backup`) and worktree copies, the `backups/` and
   `.tmp/` folders at the root, `*.tmp` leftovers, and the env files
   (`.env*`, `.dev.vars*`; a template, a name with example, sample or
   template as one of its parts, travels). The script's own header holds
   the full list. The committed
   `.claude/settings.json` and the project's own commands travel. Common key
   files stay out too, by name (certificates, SSH private keys, cloud
   credential files), and the run names each one it left out. A secret saved
   under any other name travels in the ZIP, so keep those outside the project.
   Every file name is checked in the finished archive (names, not content).
   The run either passes that check or fails and leaves no ZIP at all; there
   is no "mostly worked".
2. The ZIP lands in `backups/` at the project root, which is gitignored.
3. Never commit or push a ZIP.
4. Tell the owner to move the ZIP to external storage; a backup on the same
   disk as the project is not one. When the run named key files it left
   out, give the owner that list beside the ZIP's location, so it can travel
   with the ZIP: a restore needs it, and the run's output is gone by then.

**Env files and common key files never travel.** They are excluded on
purpose, so a full restore recreates the env files from their templates and
brings back by hand the key files the backup run named. Say so when
reporting a restore, never as a surprise during one. The script recognises
them by name only: a secret saved under any other name goes into the ZIP
with everything else.

**Restore.** Unzip the chosen `backups/*.zip` into a NEW folder, never over the
live tree; reinstall dependencies; recreate the env files from their
templates and bring back the key files the backup run named; then switch
the guards back on, since the personal settings file
never travels: run `node project-os/Install-project-hooks.mjs` in the restored
folder (with `--shared` too if the project used it), or confirm the plugin's
start line names the new folder, and run the two guard probes from
`project-os/Hooks.md`. Then run the project as usual. The full git history is
inside the snapshot's `.git` folder, so nothing has to be fetched from
anywhere. Say in the restore report, in one line, that the guards were wired
again.

`.mcp.json` travels in the snapshot but is written for the system that made
it: restoring on the other system, switch its `chrome-devtools` entry to this
system's form (Installation.md 6d step 3). A copy with no `.mcp.json`, such as
a fresh clone, copies `.mcp.json.example` to `.mcp.json` the same way.

### `Go commit and backup`

Run both flows back to back: `Go commit` in full (the assistant commits and
stops, the owner pushes; in a cloud session, rule 22's branch push), then
`Go backup`.

### `Backlog`

When the owner says `Backlog` about an item, in any casing, append one row to
`project-os/Backlog.md`: date, the item in plain words, source.
That file's own rules apply: this trigger is the ONLY way in, done rows move
to Done and are never deleted, and the Open table is scanned at task pickup.

## How to reply

Every reply follows `project-os/Conversations.md`. Not only report-backs after
work: every reply, in every conversation.

That file is the single home of every reply rule: structure, length, tone,
language. This file sets none of its own, so the two can never disagree and you
never have to guess which one wins.
