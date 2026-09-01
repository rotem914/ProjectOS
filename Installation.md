# Installation — the complete install law

This file is the whole procedure for installing ProjectOS into a project.
The assistant reads it and follows it exactly, every step, in order.
The owner does two things only: answers one batch of questions, and reads one
report at the end.

The install is not done until the report in the last section has been
delivered.

## 1. Read everything first

Read CLAUDE.md and every file in project-os/, its mcp/ subfolder included.
All of them, in full, before changing anything. A step below will tell you to
adapt files; you cannot adapt what you have not read.

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
project: if it fails, that becomes a line in the report's Problems section and
a question for the owner, never the standing check.

## 4. Ask once

Ask only what the repo cannot tell you. Send every question in ONE message,
not one at a time. At minimum:

- the owner's name,
- their role on this project,
- how they want you to talk to them: language, tone, how blunt, how long,
- the commit policy the `Go commit` shortcut needs: which checks gate a
  commit, whether work goes straight to the current branch or onto a task
  branch, and who pushes,
- whatever step 3 came up empty on: the host, a check command that passes.

Every marked setup block in the kit is a question waiting to be asked. Walk
them ALL before sending this message, and fold each one's question into the
batch. A setup block reached in step 6 with no answer means step 4 was
written short.

**Never fill a setup block from a default, a convention, or another
project's habit.** An unanswered block is left as it is and listed in the
report's Waiting-on-you section. A guessed policy looks decided, so nobody
ever revisits it; a blank one gets answered in ten seconds.

## 5. Replace every placeholder

Replace every value written in double curly braces with the real thing, in
CLAUDE.md and every file under project-os/. None may survive there.

| Token | What it means | Example |
|---|---|---|
| `{{PROJECT_NAME}}` | The project's name | Northwind Dashboard |
| `{{OWNER_NAME}}` | The person the assistant works for | Alex Rivera |
| `{{OWNER_ROLE}}` | Their role on this project | product designer |
| `{{PROJECT_ROOT}}` | Absolute path to the project folder | /Users/alex/code/northwind |
| `{{DEV_URL}}` | Where the app runs locally | http://localhost:3000 |
| `{{STACK}}` | One line: framework, data store, host | server-rendered web app · SQL database · managed cloud host |
| `{{CHECK_COMMAND}}` | The build / typecheck / test command | npm run build && npm test |

The two tool files under project-os/mcp/ carry a few more (the Figma file key
and target page, the Cloud project, the GA4 property), each inside a marked
setup table with its own instruction.

Where an answer is missing, write the honest state ("not hosted yet") and add
it to the report's Waiting-on-you section, never a guess. If the project uses
no Figma or no Google Analytics, ask whether to delete that folder under
project-os/mcp/ instead of filling its setup table.

## 6. Setup blocks and scaffolding

Do the setup steps the files carry, then clear the scaffolding:

- fill the marked setup blocks: the project description in CLAUDE.md, the
  reply language and length dial in project-os/Conversations.md, and the
  `Go commit` calibration in CLAUDE.md's Shortcuts section (which checks gate
  a commit, what is never staged, branch policy, who pushes);
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
  freely: it is an ordinary repo file, not agent configuration.
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

Two scripts ship in `project-os/` and keep the growing docs from becoming a
tax on every task: `rotate-history.ps1` (History rows) and `rotate-docs.ps1`
(Decisions entries, the Backlog Done table, the Mistakes tails, the BugAtlas
rows). Both MOVE old material into a sibling `*-archive.md`, never rewrite it,
and both are wired into `Go commit`.

They are PowerShell, so they run on Windows out of the box and need PowerShell
installed anywhere else. At install:

- Run each once with `-DryRun`. A fresh repo has nothing to move, so the
  expected output is a clean "nothing to move" per file. That is the proof the
  paths resolved.
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

5. **The rules are on.** The last thing in the report, always. Short, and
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

Also tell the owner once that the phrase "full report" lifts the reply-length
ceiling when they want the long version.

If a rule in the kit contradicts how this project actually works, it belongs
in Clashes too, said plainly, instead of quietly adapting the kit.

## 9. Clean up

When the report is delivered, this file has done its job: ask the owner
whether to delete Installation.md or keep it for reference. CLAUDE-kit.md, if
there was one, is already gone (step 2).
