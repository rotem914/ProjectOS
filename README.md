# ProjectOS

A folder of markdown files that an AI coding assistant reads before it touches your project: your rules, your process, your history.
It exists because a new chat session starts with none of that, and loses all of it again the moment the session ends.

It is not code. It installs nothing, imports nothing, and runs nothing — you copy the files in and your assistant picks them up.

## The pattern

When something goes wrong twice, it becomes a file.

That is the whole idea. You can correct an assistant in chat, and it will listen — for as long as that session lasts. The next session starts blank. It has never met you, has never seen the bug you fixed last week, and has no idea which parts of your project are load-bearing.

A file is the only part of your working relationship that survives a new session. So every correction worth repeating gets written down once, in a place the assistant reads before it touches anything. Chat is where you notice the problem. A file is where you solve it.

## What is in the box

**Six rule files.** These arrive with real content and work on day one.

| File | What it does for you |
|---|---|
| `CLAUDE.md` | The entry file. Names your project, your stack, and the rules that override the assistant's defaults. It is read first, every session. |
| `project-os/Workflow.md` | The mandatory path from request to delivery. Stops the assistant from writing code before it understands the job. |
| `project-os/QA.md` | What must be true before anything is called done. Kills "looks fine to me" as a verification standard. |
| `project-os/Conversations.md` | How the assistant writes back to you. Short, structured, skimmable — instead of five paragraphs restating your own request. |
| `project-os/Code_review.md` | How risky changes get reviewed, and what counts as risky enough to trigger one. |
| `project-os/Visual_QA.md` | How the running app gets tested by actually using it, not by reading the diff and hoping. |

**Four living files.** These arrive nearly empty on purpose. They are yours to fill.

| File | What it becomes |
|---|---|
| `project-os/Backlog.md` | The open items you said "not now" to, so they stop resurfacing as surprises. |
| `project-os/Map.md` | Where things live in your project. Written once you have something to map. |
| `project-os/History.md` | What changed and what was checked, one row per task. Useful from about the tenth row. |
| `project-os/Decisions.md` | Why a non-obvious choice was made, so nobody re-litigates it in three months. |

Each one ships with its structure already in place and a worked example at the end, in a block marked for deletion. That is all a kit can give you here. They are worth nothing on day one and a great deal on day sixty, and no starter kit can fake that difference.

## Install

Under ten minutes, and most of that is the assistant reading.

1. Copy `CLAUDE.md` and the `project-os/` folder into the root of your project.
   Already have a `CLAUDE.md`? Keep yours: bring the kit's in as `CLAUDE-kit.md`
   beside it, and the prompt below has your assistant merge the two.
2. Paste the install prompt below into your assistant.
3. Answer its questions. It asks once, in one batch.
4. Commit the result.

## The install prompt

Copy this whole block and paste it into your assistant, in your project.

```
Set up ProjectOS — the files I just copied into this project.

1. Read CLAUDE.md and every file in project-os/. All of them, in full, before
   you change anything. If the kit's entry file came in as CLAUDE-kit.md
   beside an existing CLAUDE.md, fold it into the existing file — the
   existing rules win every clash, each clash goes in your report — and
   delete CLAUDE-kit.md when done.

2. Work out from the repo itself everything you can: the project name, the
   stack (framework, data store, host), the command that runs the app locally
   and the URL it serves on, and the command that builds / typechecks / tests.
   Read package manifests, config files, lockfiles, CI config and existing
   docs. Do not guess where you can check. Run the check command once on the
   untouched project: if it fails, that becomes a question for me, never the
   standing check.

3. Ask me only what the repo cannot tell you. Send every question in ONE
   message, not one at a time. At minimum:
   - my name,
   - my role on this project,
   - how I want you to talk to me: language, tone, how blunt, how long,
   - whatever step 2 came up empty on — the host, a check command that
     passes.

4. Replace every placeholder — the values written in double curly braces —
   with the real thing, in CLAUDE.md and every file under project-os/. None
   may survive there. Where an answer is missing, write the honest state
   ("not hosted yet") and flag it — never a guess.

5. Do the setup steps the files carry, then clear the scaffolding: fill the
   marked setup blocks (the project description in CLAUDE.md, the reply
   language and dial in project-os/Conversations.md), replace the skeleton
   tree in project-os/Map.md with the real one and fill its Data and
   Ownership tables, then delete the example blocks at the end of Map.md,
   History.md, Decisions.md and Backlog.md — they only show the shape. The
   example rows inside Code_review.md and Visual_QA.md carry their own
   instruction and stay. So do the blocks you cannot fill yet — the project
   invariants, the worst-bug-class lines; name them in your report as
   waiting on me.

6. Log the install itself as the first two rows in project-os/History.md —
   the kit's rules apply to the kit. Then report back: what you set and
   where you got it, what you asked me, what is still waiting on me — and
   that the phrase "full report" lifts the reply-length ceiling when I want
   the long version. If a rule in the kit contradicts how this project
   actually works, say so instead of quietly adapting it.
```

## The placeholders

| Token | What it means | Example |
|---|---|---|
| `{{PROJECT_NAME}}` | The project's name | Northwind Dashboard |
| `{{OWNER_NAME}}` | The person the assistant works for | Alex Rivera |
| `{{OWNER_ROLE}}` | Their role on this project | product designer |
| `{{PROJECT_ROOT}}` | Absolute path to the project folder | /Users/alex/code/northwind |
| `{{DEV_URL}}` | Where the app runs locally | http://localhost:3000 |
| `{{STACK}}` | One line: framework, data store, host | server-rendered web app · SQL database · managed cloud host |
| `{{CHECK_COMMAND}}` | The build / typecheck / test command | npm run build && npm test |

## Which assistants this fits

It is written for Claude Code, which picks up a `CLAUDE.md` at the project root on its own. Copy the files in and it works.

Other assistants read a different entry filename. Rename `CLAUDE.md` to whatever yours looks for — the content does not change. The `project-os/` folder is plain markdown with no tooling attached, so it needs no adjustment at all.

## Growing it

**The rule files are a starting position, not scripture.** They are a set of defaults that worked somewhere else. The moment one of them is wrong for your project, edit it — a rule you are quietly ignoring is worse than no rule, because it teaches the assistant that the folder is decorative.

**Split by area when one file gets crowded.** This kit is deliberately single-tier: one QA file, one History, one Decisions. That holds for a long time. When a project grows several distinct areas, give each one its own QA and History file and let the root ones point at them. Do that when the single file starts hurting, not before.

**If your project has an architecture worth protecting, write one more file for it.** One document, stating the rules the system depends on: what the data is allowed to look like, what cannot change without a migration, which boundaries are load-bearing. Then say in `CLAUDE.md` that it gets read before any structural work.

Write it as law, not as advice. An assistant follows a stated invariant exactly. It cannot infer one from the code, and it will cheerfully refactor a constraint nobody told it about.

## License

MIT — see `LICENSE`. Use it, change it, ship it in paid work.

Its copyright line still holds `{{YEAR}}` and `{{OWNER_NAME}}`. Fill those in if you republish the kit under your own name; leave them alone if you are just using it, since the install copies `CLAUDE.md` and `project-os/` into your project and leaves the license behind.
