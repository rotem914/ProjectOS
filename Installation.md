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
- whatever step 3 came up empty on: the host, a check command that passes.

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
  Backlog.md and BugAtlas.md; they only show the shape;
- the example rows inside Code_review.md and Visual_QA.md carry their own
  instruction and stay;
- so do the blocks you cannot fill yet, the project invariants and the
  worst-bug-class lines; name them in the report as waiting on the owner.

## 7. Log the install

Log the install itself as the first two rows in project-os/History.md.
The kit's rules apply to the kit.

## 8. The install report

The one output the owner reads. Deliver it as the install's closing message,
in the reply format project-os/Conversations.md prescribes, with these
sections in this order:

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

Also tell the owner once that the phrase "full report" lifts the reply-length
ceiling when they want the long version.

If a rule in the kit contradicts how this project actually works, it belongs
in Clashes too, said plainly, instead of quietly adapting the kit.

## 9. Clean up

When the report is delivered, this file has done its job: ask the owner
whether to delete Installation.md or keep it for reference. CLAUDE-kit.md, if
there was one, is already gone (step 2).
