# Rule reasons

This file holds why the rules in `CLAUDE.md` and the rule files under `project-os/` exist: the reasoning, the failures they prevent, and how some of them came to be.
Read it only when a rule is questioned, changed, or seems wrong; it is never part of the pickup reading, and it holds no rule of its own.

## CLAUDE.md

### Who you work for

Long output is not thoroughness; it is a bill they have to pay in reading time.

### Rule 1: Understand before changing

A change built on a guess costs more to unwind than it saved.

### Rule 2: Smallest safe change wins

Every extra line is a line someone has to review and a place a regression can
hide.

### Rule 3: No big-bang refactors

Otherwise the refactor is your idea, on someone else's schedule.

### Rule 4: No destructive action without explicit approval

The cost of asking is one message; the cost of being wrong is unbounded.

On heavy things: A project quietly grows ten- and twenty-gigabyte things nobody
needs: a stray download, a partial archive, a cache, a build folder.

### Rule 5: Secrets stay out of the repo

A secret in git history is a secret you cannot take back.

### Rule 6: Verify in a real browser

Build output proves the code compiled; it does not prove the button works.

On closing tabs: A QA tab is yours, not the owner's; left behind, it clutters the
window they work in.

### Rule 8: Every completed change adds a History row

One `Go commit` can carry several tasks, so reverting the commit would undo
them all.

Without this, every session starts from zero and the same ground gets re-covered.

### Rule 9: Decisions are separate from History

Mixing them buries the reasoning in a list of events, and the reasoning is the
part that is expensive to reconstruct.

### Rule 10: Follow the workflow without exception

"Too small for the process" is how process dies.

### Rule 12: Every file you write stays inside the project root

Files written outside the project are invisible to the owner, absent from git,
and lost on the next machine.

On memory: An assistant's private memory folder lives outside the project root,
so a rule parked there is invisible to the owner, absent from git, and lost to
every other session.

### Rule 13: Ad-hoc markdown gets a home folder

On a model for every step: The owner switches models between steps and pays for
each, so the plan is where that choice is easiest to make and hardest to guess.
`project-os/Workflow.md` step 5 is where that line lives, because that is where
a plan actually gets written.

On the root: The root is the first thing anyone opens. Every stray file there
competes for attention with the files that matter, and a scratch document nobody
can place gets read once and never again.

### Rule 14: A frozen area is not touched

A freeze usually means that area is mid-rewrite, being replaced, or broken in a
way the owner has already accounted for. Findings there are findings they cannot
act on, and edits there are conflicts they have to unpick later.

### Rule 15: A title is a title

A self-authored subtitle almost never carries information. It dilutes the heading
and adds words the reader has to skip.

### Rule 16: Never start the dev server

A second instance collides with theirs and takes away their live preview.

### Rule 17: Risky changes get reviewed

Saying the level out loud sets what scrutiny the change earns before the work
starts, instead of arguing about it afterwards.

### Rule 19: The same bug twice becomes an atlas row

History says a bug was fixed once. The atlas says it is a CLASS, and hands the
next session the cause and the fix that held. Without it, the third occurrence
costs as much as the first.

### Rule 20: A correction you were given is written down, once

A correction that lives only in chat expires with the session, and the next
session makes the same mistake with total confidence.

### Rule 21: This project is your only source

Filling the hole from a neighboring folder produces a setting that was never
chosen here and looks decided forever after (that is exactly how a commit policy
arrived unasked).

In client work the same habit is a leak: two clients' repositories sit on the
same disk, and material has no business crossing between them.

### Rule 22: Main is the owner's

An assistant that pushes to main is an assistant whose mistakes reach
production without a human between them and the world.

On never committing unasked and never refusing: Both ends have failed on real
installs. A commit nobody asked for takes the timing away from the owner, who
may still be looking at the change. And an assistant that answers `Go commit`
with "the commit is yours" hands them a pile of changed files and the record of
work they did not do, which is the one part only you can write: what changed,
why, what was checked.

### Go code review

This matters because the automatic review after each task (rule 17) already
covers the diff. A second diff review adds nothing; the whole value of this one
is everything the diff reviews never look at.

### Go commit, step 2

It comes after step 1 on purpose, so the fast-mode catch-up rows are already in
the file before rotation decides what is old.

## Workflow.md

### The file itself

It exists so the same steps run on every task regardless of size, and so the
reasoning behind a change outlives the memory of the person who made it.

### The universal rule

Why: the shortcuts are always taken on the small changes, and small changes are
what break things quietly. A process you skip when it feels unnecessary is not a
process.

### Step 2: Classify the task and state its risk

So a rating stated too low quietly cancels a review nobody notices is missing.

### Step 3: Read the context

An opinion formed without them is a guess that happens to be typed confidently.

Some files on that list are read on demand rather than every time, because most
tasks never reach them: `project-os/Code_review.md`, for one, only when step 12
arms a review or a blast-radius trace.

### Step 4: Define boundaries

Why: most bad changes are not wrong code. They are correct code applied to the
wrong surface.

### Step 5: Settle a short plan

Why: a plan made before the code is a prediction, so it can turn out wrong and
teach you something. A summary written afterwards only ever agrees with what you
did.

On checking every "impossible": Why: a limit that is real for one route gets
carried as if it held for every route. A design once called a line of client
code unavoidable because browser walls forbade anything else; the walls were
real for web pages, and a browser extension the project already had went
straight through them.

### Step 6: Design the QA before you write code

Otherwise QA gets invented at the end to match whatever you happened to build,
and it only ever confirms your own assumptions.

### Step 7: Implement the smallest safe change

Why: an unrequested change is a defect even when it is an improvement. The owner
did not ask for it, does not expect it, and now has to find it.

### Step 9: Browser QA for anything visible

Code reading proves the code says what you meant. It does not prove the screen
does what you meant.

On assuming the tool is missing: Tools are often loaded on demand and invisible
until you look for them.

Why the gate is written as a checkbox: "I verified it" is the single easiest
sentence to write without having done it. Naming the path makes the claim
falsifiable.

### Step 11: Fix loop

Why step 3: a fix is itself a change. It earns the same suspicion as the change
that caused the bug.

### Step 14: Documentation routing

Why: two copies drift apart, and once they disagree neither one is worth
trusting.

### Step 15: Add the History row

Someone reading it later needs to know what happened and where to look, not to
relive it.

### Step 16: Delivery summary

Implementation noise the owner did not ask for stays out because a summary
padded with steps that went fine buries the one line that did not.

## QA.md

### The file itself

It exists so "done" means the same thing on every task, instead of whatever felt
like enough that day.

### QA ownership

Asking them to confirm what you could have confirmed moves your work onto their
desk.

An unrun check that is named is information. An unrun check that is silently
skipped is a false report.

### §1: Match QA to change type

Each kind of change fails in its own place. A green build says nothing about a
route that errors, and a working route says nothing about a layout that clips.

### §2: Browser QA for anything visible

A passing build proves the code compiles. It proves nothing about what the
screen does.

On reading the DOM: Pixels lie; a rule that never matched usually still looks
plausible.

### §3: Console check

Why: most browser failures never reach the screen. An exception stops one
script, the rest of the page renders anyway, and the result looks like it worked.

### §4: Persistence and reload

Why: the screen in front of you already holds the value in memory. It renders
the same whether the write succeeded or vanished.

### §5: Atomic write guard

Why: a crash halfway through a direct write leaves a half-written file where
live data used to be. The swap is the whole point: either the old file or the
new one, never a torn one.

### §6: Accessibility basics

A control that only a mouse can reach does not exist for the people who do not
use one. These are the cheap checks that catch most of it.

### §7: Reduced motion

On no blanket rule: An entrance that deliberately waits at frame zero (§8) has
nothing left to release it, so it freezes there and hides its content for good.

### §8: Cold-asset check for entrance animations

Why: a warm cache hides this entire bug class. On your machine the asset is
already there, so the reveal always has something to reveal. A first-time
visitor gets the animation running on an empty box, finishing before the
content arrives.

### §9: Narrow-width check for any layout change

A narrow screen is a real surface, not a fallback.

On resizing first: A page that was loaded wide and then narrowed is not the same
page. Scripts that measure on load re-fit on resize. A page that has lived
across several widths reports geometry no fresh visitor ever sees.

On both sides of a breakpoint: A rule that lands on only one side is invisible
at both extremes: you will not catch it at a typical phone width or a typical
desktop width.

### §10: No vague QA

They say nothing, and they read exactly like a check that was skipped.

### §11: Prove a tool is missing before you claim it is

In many setups, tools are not loaded until something asks for them. They are
invisible by default, which makes "I don't see a browser tool" feel true when it
is not.

The failure mode this blocks: declaring early in a task that you have no
browser, then repeating it for the rest of the task to stay consistent with
yourself.

## Conversations.md

### The file itself

They exist so a reply can be scanned in seconds instead of read twice.

### Language

Matching the question instead makes two sessions read differently, and the owner
has to re-learn the vocabulary each time.

### In-flight narration

A running commentary fills the owner's feed with lines they never need, and the
report at the end already carries what changed. The scaffolding of dividers and
headings is built for that final report; stamping it on a one-line status makes
the stream noisier, not calmer.

### The one hierarchy

Most chat clients render H2 gray and H3 identically to bold, so H1 is the only
heading that reads as a heading. That is why bold is never a section.

### Rule 1: Cut hard

The owner asks when more is wanted, so the default is the floor, not a guess.

On never a verdict alone: A conclusion fits in ten words. A cause almost never
does. Raise something new, send its explanation to a file the owner does not
read, and the reply arrives as a table of contents: technically short, and
useless.

### Rule 2: Short headlines

Past three words a heading becomes a sentence, and the eye stops using it as a
landmark.

### Rule 3: Section dividers

Spacing alone does not separate two blocks in a chat client. The divider is the
only thing that does.

### Rule 4: Paragraph spacing

The reply is read in a chat client, where a wall of text is skipped whole.

### Rule 5: One sentence per line

Two sentences sharing a line get read as one, and the second is the one lost.

### Rule 6: Short sentences

A sentence holding two ideas has to be read twice: once to find where the first
one ended.

### Rule 7: Lead-in split

On one line the label swallows its own answer, and the eye takes in the label
only.

### Rule 8: Numbered options

One sentence with two questions in it gets one answer, and the second ask is
lost.

### Rule 9: Topic headlines in long answers

A second topic with no heading of its own is read as part of the first, and
answered as if it were.

### Rule 10: Stacked list points

A `1.` list item nests the following lines, which reflows the stacked beats back
into one dense paragraph, exactly what this rule exists to prevent. And numbers
alone do not separate blocks in a chat client; the divider is what does.

The labels came from an owner who asked for the most important fixes and
got one line per item, cut to fit rule 1, the turn after a full list. A line
per item reads as a verdict with no reason. Each item now says the problem, the
proposal with how it plays out, and what changes in the owner's work, and no
line ceiling trims it. They were four at first; "In practice" was folded into
the proposal, since the two were read as one thought.

### Rule 11: Grouped status lists

An icon legend makes the reader decipher a key before reading. A table row per
item is the same rejected one-liner, packed into a grid.

### Rule 12: Verbatim text goes in a fence

A fence is the copy button. A project-relative path cannot be pasted anywhere
as-is, so it fails the copy test. A bare path pasted into an address bar becomes
a web search, so a path is not a link. Real content read inside a monospace box
loses its headings, its dividers and its line rhythm, and reads as machine
output instead of an answer. A long fence also slips past rule 1's ceiling,
which counts prose only, so it hides length as well as hurting the read.

A command is pasted into whatever terminal is open, and that terminal may be in
another folder or another project; a bare command then fails, or runs somewhere
else. Prefixing the move into the project makes the fence true to its own test:
paste it anywhere and it works. The same holds for a dashboard: naming menus
makes the owner hunt, a deep link lands them on the screen, and most dashboards
have one.

### Rule 13: A question for the owner goes last

The panel is easier to answer than a list in the feed.

A question in the middle is answered late or not at all.

### Rule 14: Plain language

Repo-internal nouns are worse than syntax: they LOOK like plain English, so they
slip past unnoticed and the owner cannot even tell they were jargon until asking.
The test is not "is it correct", it is "would the owner have to ask".
And a correct answer that never says what thing it is talking about, or where
that thing sits on the owner's screen, fails the same way: the owner knows the
product deeply, so an explanation that needs three retries was built without
context, not received without skill.

### Rule 15: Elaborate stays short

Asked for detail, an unbounded reply comes back as eight sections. The
correction then strips the layout, which is the wrong half to cut.

### Rule 16: One home

A second home means the rules drift, duplicate, and sit somewhere the owner
cannot see or edit.

### Rule 17: After a commit, never print the push command

The owner pushes (CLAUDE.md rule 22), often by clicking a button in a desktop
git client, so a pasted push command at the end of a report is dead weight.
Building the line from the work just committed is the whole anti-repeat
mechanism; reading past sessions to check for repeats is not worth the cost.

### Rule 18: Never a long dash

Two thoughts joined by a long dash are two sentences, which rules 5 and 6
already demand; the dash mostly hides a chain this file bans elsewhere.

## Code_review.md

### The file itself

The review itself reads the change and asks whether the code is correct, and that
part is the same everywhere. The bar is not. A generic checklist finds generic
bugs; the bugs that actually ship are the ones this project has shipped before,
and this file is the only place that remembers them.

### Scope

The reason is simple. The automatic pass after each medium or high task
(`project-os/Workflow.md` step 12) already covers every new change,
so a second review of the same diff finds the same nothing. The owner-driven
pass exists for everything the automatic ones never look at, which after a few
months is most of the codebase.

### Blast radius

The diff shows what was edited. It does not show who was depending on it.

On the shared-change trace: The rating measures the size of the edit; this
section measures its reach, and those are not the same question.

On an empty finding list: It is the absence of evidence, and the two only look
alike from outside.

### A check that never ran is not a check that passed

Why this one matters more than it sounds: the serious findings are the expensive
ones to check, so they are exactly the ones that time out. A review that reports
four findings while twenty-four went unexamined is worse than no review, because
it sells confidence nobody earned.

### Severity bar

A bar argued from real incidents survives a disagreement about a rating. A
copied one does not.

### Exceptions

Without this section every pass re-litigates the same argument, and the owner
pays for it every time. Without the condition, a finding stays silenced forever,
even after the code under it changes enough to make it a real bug.

## Visual_QA.md

### Driving the app

On structure over pixels: A document tree tells you a control is disabled; a
screenshot only tells you it looks grey.

On one driver: They fight over focus and windows, and the pass turns into
debugging the harness instead of the product.

### The pass method, step 1

Focus restoration and side effects differ per path, which is exactly why only
one path gets tested and only one path works.

### The pass method, step 2

The inputs below can erase or corrupt a real entry, and the undo that step 4
asks for is often the very thing under test; the guards also refuse the git
commands that would roll the data files back, so a failed undo is the owner's
to repair.

### The pass method, step 3

A false finding costs more than a missed one, because it sends someone to fix
code that was never broken.

### The pass method, step 4

A screen can display "Saved" over nothing at all; eyes alone cannot tell the
difference.

### Exceptions

Without this section every sweep re-reports the same non-bug, and the owner pays
for it every time. Without the condition, a defect stays silenced forever, even
after the screen changes enough to make it a real one.

## Hooks.md

### The file itself

**Why it matters more than it looks.** A folder of markdown holds for a while
and then drifts: the rules sit at the top of a long session, the work moves on,
and by the fiftieth message they are quietly gone. Nothing announces it. The
replies just start getting longer, the History row stops being written, and a
change touches things nobody asked for. Hooks push back against that, because
they fire on every message and every tool call, forever, at no cost to anyone's
memory.

A project running the kit with no hooks is running on good intentions.

### Per project: the installer

A kit whose enforcement layer waits for the owner to notice a request is a kit
that runs unenforced.

### Level 1: the reminder length

A hook that says too much says nothing.

### Level 2: the folder guard

Without it, the rule about staying inside the project is a sentence in a
document, and stray files land in the home folder and in the agent's own
configuration.
