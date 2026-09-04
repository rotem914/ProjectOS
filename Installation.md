# Installation — the complete install law

This file is the whole procedure for installing ProjectOS into a project.
The assistant reads it and follows it exactly, every step, in order.
The owner does two things only: answers one batch of questions, and reads one
report at the end.

The install is not done until the report in the last section has been
delivered.

## 1. Read everything first

Read CLAUDE.md and every markdown file in project-os/, its mcp/ subfolder
included, in full, before changing anything. A step below will tell you to
adapt files; you cannot adapt what you have not read.

Two exceptions, because reading is the biggest bill of the install and these
files are never adapted by hand:

- **The scripts are read by their header only.** `rotate.ps1` and
  `install-hooks.mjs` open with a comment that says what they do and what
  their parameters are; read that and stop. Their internals are not the
  install's business, and they are half the folder by size.
- **A tool folder the project will delete is deleted before it is read.** The
  `mcp/` folders exist only to be filled; if step 4's pile one already says a
  server is not used here, remove that folder first and read nothing in it.

## 2. Merge with an existing CLAUDE.md

If the kit's entry file came in as CLAUDE-kit.md beside an existing CLAUDE.md,
fold it into the existing file, then delete CLAUDE-kit.md.

The merge law:

- The EXISTING rules win every clash, without exception, during the install.
  This is the client's production repo; an existing rule may encode a
  constraint you cannot see from outside.
- Nothing of the existing file is deleted or reworded on your own initiative.
- Every clash you find is recorded for the report (section 8), never resolved
  silently in either direction.
- An override happens only after the owner's explicit verdict on that clash,
  as its own change, never as part of the install.

## 2b. Two checks before you go further

Both take seconds, and each one catches a failure that is invisible afterwards.

**Did copying the kit overwrite an existing rules file?** The merge law above
only works if the project's own CLAUDE.md still exists. If the files were
dragged in rather than renamed, it was replaced on disk before you ever ran,
and there is nothing left to clash with. Check the history:

```
git log --oneline -3 -- CLAUDE.md
```

If that shows earlier versions and the file now holds this kit's placeholders,
STOP. Recover the previous one with `git show HEAD:CLAUDE.md`, keep the kit's
beside it as CLAUDE-kit.md, and only then merge. In a project with no version
history, say plainly in the report that the merge could not be verified.

**What does your own memory already say about this project?** Rule 12 keeps
rules out of the assistant's private memory, and that folder is invisible to
the owner, so this is the only moment anyone will look. List every note there
that concerns this project, one line each, and put them in the report under
Waiting-on-you with a keep-or-trim verdict per line. A note that is really a
rule gets moved into the right file here; a note that is stale gets deleted on
the owner's word, never yours.

**Is Node available?** Everything that enforces the rules runs through it: the
hooks themselves and their installer. Check:

```
node --version
```

No Node means the enforcement layer cannot run, whatever this project is
written in. That is a Problems line in the report, and the owner needs to know
the rules are documents only until it is installed.

## 3. Learn the repo before asking

Work out from the repo itself everything you can: the project name, the stack
(framework, data store, host), the command that runs the app locally and the
URL it serves on, and the command that builds, typechecks, and tests.

Read package manifests, config files, lockfiles, CI config and existing docs.
Do not guess where you can check. Run the check command once on the untouched
project. There are THREE outcomes, not two:

- **It passes.** It becomes the standing check.
- **It fails.** That is a Problems line and a question for the owner, never the
  standing check.
- **Nothing exists to run yet.** A project with a plan and no code has no check
  command and no dev address. Do not invent one and do not leave the row empty:
  write the FUTURE command the plan will create, name the plan step that creates
  it, and mark every table that carries it "nothing to run before that step".
  The report's Problems section says so in one fixed line: "No check exists yet;
  it arrives at step N of the plan." The same shape applies to the dev address.
- **It was refused, so it never ran.** A permission system can deny an unfamiliar
  build command, and a session with nobody to approve it gets no answer at all.
  Say REFUSED, name the command, and put it in Waiting-on-you. A command that
  never ran is not a command that passed, and recording it as the standing check
  means every future task believes a check is running when none is.

## 4. Ask once

Ask only what the repo cannot tell you, in ONE message, never one at a time.

**Send it as TWO piles, and label them.** A batch of nine questions reads as
nine decisions when half of them are things you already worked out and only
need waved through. Separating them halves what the owner has to think about.

**Pile one: confirm, and silence means yes.** Everything you derived and are
confident in. State each as a fact with its source, not as a question. The
owner reads them, and answers only the ones you got wrong.
Typically: their name from the version history, the command that runs the app
and the address it serves on, the command that checks the project, whether a
tool folder is needed, and, if a build plan sits loose in the repo, that it
moves to `project-os/Plan.md` (CLAUDE.md rule 13).

**Pile two: needs a real answer, and the install waits.** Only what genuinely
cannot be derived, and what would be wrong to guess. Number these.
Typically: their role on this project, how they want you to write to them, the
commit policy (which checks gate a commit, straight to the branch or a branch
per task), who starts the dev server and where it runs (CLAUDE.md
rule 16 has three honest answers and is rewritten from this one), and anything
step 3 came up empty on.

Say which pile blocks the install and which does not, in one line, so nobody
answers eight things to unblock one.

**This message, like the closing report, is exempt from the reply-length
ceiling.** It must be complete, since a question left out is a setup block
filled by a guess. Every layout rule still applies. The same exemption is
written into Conversations.md rule 1, so the two files agree.

**Two questions have a shape that matters:**

**How long replies should be.** Never ask for numbers. Nobody can picture
sixteen words. Show the SAME short answer written two ways, a terse one and a
fuller one, and ask which reads better. Turn the answer into the numbers
yourself.

**The project invariants.** Do not leave that section empty and move on. Read
the code, propose the three to six things this project cannot afford to break,
and ask for a yes or no on each. Nothing is faster than judging a real list.
Write every one as its CONSEQUENCE, in the owner's language: whose data could
be exposed, what a customer would see, what would be lost. A candidate written
as a technical noun cannot be judged by the person who has to approve it, so
the yes it gets back is worthless.

Every marked setup block in the kit is a question waiting to be asked. Walk
them ALL before sending this message, and fold each one into the right pile. A
setup block reached in step 6 with no answer means step 4 was written short.

**The hooks are not a question.** They are installed for you in step 6b, on
their default, and the report says so in one line. Never ask the owner to
choose where they go.

**Never fill a setup block from a default, a convention, or another
project's habit.** An unanswered block is left as it is and listed in the
report's Waiting-on-you section. A guessed policy looks decided, so nobody
ever revisits it; a blank one gets answered in ten seconds.

## 5. Replace every placeholder

Replace every value written in double curly braces with the real thing, in
CLAUDE.md and every file under project-os/. None may survive there, and that
includes the ones sitting inside example fences (`~~~` blocks): an example
reply in Conversations.md carries the dev address too, and a careful reader of
the table below would not expect one there.

| Token | What it means | Example |
|---|---|---|
| `{{PROJECT_NAME}}` | The project's name | Northwind Dashboard |
| `{{OWNER_NAME}}` | The person the assistant works for | Alex Rivera |
| `{{OWNER_ROLE}}` | Their role on this project | product designer |
| `{{PROJECT_ROOT}}` | Retired. Do not write a machine path into a committed file: it is one person's checkout, and a teammate reads a boundary that does not exist for them. CLAUDE.md now says "this repository, wherever this copy lives". | |
| `{{DEV_URL}}` | Where the app runs locally | http://localhost:3000 |
| `{{STACK}}` | One line: framework, data store, host | server-rendered web app · SQL database · managed cloud host |
| `{{CHECK_COMMAND}}` | The build / typecheck / test command | npm run build && npm test |

The two tool files under project-os/mcp/ carry a few more (the Figma file key
and target page, the Cloud project, the GA4 property), each inside a marked
setup table with its own instruction.

**A repo with more than one app gets more than one row.** `{{DEV_URL}}` and
`{{CHECK_COMMAND}}` are written as single values, which is right for a single
app and wrong for a workspace: picking the one app you were pointed at leaves
every other app unchecked, silently, for the life of the project. Replace those
rows with a small table, one line per app, plus the workspace-wide command if
there is one, and say in the `Go commit` calibration which of them gate a
commit.

Where an answer is missing, write the honest state ("not hosted yet") and add
it to the report's Waiting-on-you section, never a guess. If the project uses
no Figma or no Google Analytics, ask whether to delete that folder under
project-os/mcp/ instead of filling its setup table.

## 6. Setup blocks and scaffolding

Do the setup steps the files carry, then clear the scaffolding:

- fill the marked setup blocks: the project description in CLAUDE.md, the
  reply language and length dial in project-os/Conversations.md, and the
  `Go commit` calibration in CLAUDE.md's Shortcuts section (which checks gate
  a commit, what is never staged, branch policy; who pushes is never asked,
  the owner does, rule 22);
- replace the skeleton tree in project-os/Map.md with the real one and fill
  its Data and Ownership tables;
- delete the example blocks at the end of Map.md, History.md, Decisions.md,
  Backlog.md, BugAtlas.md and Mistakes.md; they only show the shape;
- the example rows inside Code_review.md and Visual_QA.md carry their own
  instruction and stay;
- so do the blocks you cannot fill yet, the project invariants and the
  worst-bug-class lines; name them in the report as waiting on the owner.

A block whose answer never arrived stays unfilled and goes to Waiting-on-you.
Filling it from a sensible default is the one shortcut this install forbids
(step 4).

## 6b. Install the hooks yourself

The rule files you just installed are followed only while they are remembered.
`project-os/Hooks.md` is what makes them hold on message fifty.

**Install them. Do not ask first.** This is a step of the setup, exactly like
replacing the placeholders, and the owner asking for ProjectOS is the approval.
An enforcement layer that waits for someone to notice a request at the bottom
of a report is an enforcement layer that never gets switched on.

So, as part of the install:

- Read `project-os/Hooks.md`.
- **Adapt the wording first.** Open `project-os/hooks-settings.json` and rewrite
  the standing-rules text for THIS project, using the rules it actually has and
  the mistakes it actually makes. The shipped wording is a generic default, and
  a generic reminder every message is worth little. You may edit that file
  freely: it is an ordinary repo file, not agent configuration. The recipe:
  - Five to seven rules, each one line, numbered. A rule earns a line when
    breaking it costs the owner a round of correction; a rule nobody breaks
    does not.
  - Under about 600 characters. The text is paid for on every message.
  - No apostrophes anywhere in it: the text sits inside single quotes, and one
    apostrophe ends the string. Write "do not", never the contraction.
  - No dollar-brace variables. The shell on Windows prints them as literal
    text. Use names relative to the project, "project-os/Conversations.md".
  - Run the finished command once in the shell before installing, and once
    more in the other shell if the machine has both, and read what comes out.
- **Check whether hooks are already installed.** Read
  `.claude/settings.local.json` if it exists (reading it is allowed) and say in
  the report which events already have hooks and which do not. If a hook there
  uses the `echo` form with single quotes around JSON, flag it: it produces
  invalid output under the Windows command prompt and silently injects nothing.
- **Run it**, from the project root:

```
node project-os/install-hooks.mjs
```

  It merges, never overwrites, backs the file up first, and leaves existing
  hooks alone unless re-run with `--force`. Report what it added, in one line.

- **Prove one hook actually speaks.** Installing is not evidence. Run the hook's
  own command once in a shell, exactly as it is written in the settings, and
  confirm the standing-rules text comes back. If nothing comes back, or the
  shell mangles it, the hooks are installed and silent, which looks identical to
  working. Say so in Problems rather than reporting the rules as on.

- **If the write is refused**, some environments guard their own configuration,
  do not argue with it and do not retry in a loop. Say plainly that it was
  refused, put that one command in the report's Waiting-on-you section for the
  owner to run, and move on. Fallback, never the plan.

- **Tell the owner the one thing that is theirs:** hooks are read at session
  start, so the ones you just installed take effect in their NEXT session.
  Give them the check: ask the assistant what rules it was given this turn, and
  see whether it reads them back.

Never present the install as finished enforcement when only the documents are
in place, and never leave the hooks uninstalled merely because nobody asked.

## 6c. Check the rotation scripts run here

One script ships in `project-os/` and keeps the growing docs from becoming a
tax on every task: `rotate.ps1`, with three engines inside it (History rows and
the scan log; Decisions entries; the Backlog Done, Mistakes tail and BugAtlas
tables). It MOVES old material into a sibling `*-archive.md`, never rewrites
it, and it is wired into `Go commit`.

It is PowerShell, so it runs on Windows out of the box and needs PowerShell
Core (`pwsh`) anywhere else. At install:

- Run it once with `-DryRun`. A fresh repo has nothing to move, so the expected
  output is "nothing to move" per file, and a target named "(missing - skipped)"
  only for a file this project does not have. That is the proof the paths
  resolved; a run that moves nothing writes nothing.
- If PowerShell is not available on this machine, say so in the report's
  Problems section and tell the owner plainly what it costs: the docs still
  work, they simply grow forever until someone archives by hand.
- Never edit an entry to make a file smaller. Shrinking is the scripts' job,
  and theirs alone.

## 7. Log the install

Log the install itself as the first two rows in project-os/History.md.
The kit's rules apply to the kit.

## 8. The install report

The one output the owner reads. Deliver it as the install's closing message,
in the reply format project-os/Conversations.md prescribes.

**This one report is exempt from that file's length ceiling**, and only this
one. Its layout rules still apply in full: the dividers, the headings, one
sentence per line, plain words. Length is what lifts, because a report that
drops a problem or a clash to fit a line budget defeats its own purpose. The
same exemption is written into Conversations.md, so the two cannot disagree.

Sections, in this order:

1. **What was set.** Each value, and where it came from: the repo, or the
   owner's answer.
2. **Problems.** Every place the project does not work the way the kit
   expects: a failing check command, no dev server, a tool that is not wired,
   a block that cannot be filled. One line each, with its practical
   consequence. An install with no problems says so explicitly.
3. **Clashes.** Every place an existing rule or working habit of this project
   interferes with the kit's processes. Per clash: the existing rule, the kit
   rule or process it blocks, what keeping it will cost in practice, and a
   keep-or-override recommendation. This is a decision list for the owner;
   nothing has been overridden.
4. **Waiting on you.** Everything that needs the owner's answer or verdict,
   numbered, so each item can be answered in one word.

5. **The rules are on.** Second to last in the report, always. Short, and
   written for someone who does not read code. Use this shape:

   > **Your rules are switched on**
   >
   > I installed the part that keeps me following them.
   > From now on your rules are repeated to me on every message you send,
   > instead of fading as the conversation gets long.
   >
   > One thing is yours: close this session and start a new one, because that
   > setting is read when a session opens.
   >
   > To check it worked, ask me in the new session:
   > "what rules were you given this turn?"
   > If I read your rules back to you, it is working.

   If the install could not write that setting, say so in the same place, in
   plain words, and give the owner the one command to run instead.

   Say in one line where the hooks were installed: personal to this machine by
   default, and team-wide is available on request. Do not turn it into a
   question.

6. **What you can say to me.** The closing section, after the rules are on.
   The owner has just been handed a folder of rules and knows none of the
   phrases that drive it, so list them: a title, then ONE line saying what it
   does. Nothing else, no flags, no explanation of the machinery.

   List every trigger this project actually has, which is every one in
   CLAUDE.md's Review, QA and Shortcuts sections. On a stock install:

   > **What you can say to me**
   >
   > **Go commit**
   > Commit everything so far, with the checks run first.
   >
   > **Go code review**
   > Review the whole codebase and hand you the findings.
   >
   > **GO visual qa**
   > Use the running app screen by screen and report what breaks.
   >
   > **FAST MODE**
   > Skip the paperwork and check each round yourself, until you say stop.
   >
   > **Backlog**
   > Put the thing we just discussed on the open-items list.
   >
   > **full report**
   > Lift the length limit when you want the long version of an answer.

   **Then the project's own phrases.** A plan-driven project is driven by its
   own triggers ("go 1.1", "next step", a build phrase the owner already uses),
   and those are the ones used most. Add a second short group under the same
   heading, "This project's own", with whatever this install found or the owner
   named. Leave it out only when there genuinely is none.

   Adapt the list to what this project ended up with, and drop anything that
   does not exist here. A trigger the owner never learns is a trigger nobody
   uses.

Also tell the owner once that the phrase "full report" lifts the reply-length
ceiling when they want the long version.

If a rule in the kit contradicts how this project actually works, it belongs
in Clashes too, said plainly, instead of quietly adapting the kit.

## 9. Clean up

When the report is delivered, this file has done its job, and it STAYS. Other
files point at it by name (Hooks.md, the installer's header, Conversations.md),
so deleting it leaves a reader following a pointer to nothing. Say once in the
report that it is kept as the record of how the install was done, and that the
owner may delete it later if they want; if they do, the pointers are theirs to
update. CLAUDE-kit.md, if there was one, is already gone (step 2).
