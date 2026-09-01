# ProjectOS

A folder of markdown files that an AI coding assistant reads before it touches your project: your rules, your process, your history.
It exists because a new chat session starts with none of that, and loses all of it again the moment the session ends.

Almost all of it is not code: you copy the files in and your assistant picks them up. The one exception is the hooks, a small setting the install switches on for you, which is what stops the rules being quietly forgotten halfway through a long session.

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

**Six living files.** These arrive nearly empty on purpose. They are yours to fill.

| File | What it becomes |
|---|---|
| `project-os/Backlog.md` | The open items you said "not now" to, so they stop resurfacing as surprises. |
| `project-os/Map.md` | Where things live in your project. Written once you have something to map. |
| `project-os/History.md` | What changed and what was checked, one row per task. Useful from about the tenth row. |
| `project-os/Decisions.md` | Why a non-obvious choice was made, so nobody re-litigates it in three months. |
| `project-os/BugAtlas.md` | The map of bugs that came back. A symptom seen twice gets its cause and fix on record, so the third time costs minutes. |
| `project-os/Mistakes.md` | The assistant's own slips, waiting to become rules. A correction you gave twice stops being a correction and becomes law. |

Each one ships with its structure already in place and a worked example at the end, in a block marked for deletion. That is all a kit can give you here. They are worth nothing on day one and a great deal on day sixty, and no starter kit can fake that difference.

**Two tool files.** `project-os/mcp/Figma/Figma_MCP_Rules.md` holds working rules for the Figma MCP server: the call budget discipline, the hard caps, and the traps that fail silently. `project-os/mcp/Google_analytics/Google_Analytics_MCP_Rules.md` holds the wiring and reading rules for the official GA4 MCP server: key-outside-the-repo authorization, and never quoting a number that did not come from a tool call. Every rule in them was paid for in real use. Delete the folder of any server your project never touches; a different server earns its own folder there the first time it bites.

**One enforcement file.** `project-os/Hooks.md` is the part that makes the rest hold. Rule files are followed while they are remembered; hooks fire on every message and every tool call whether anything remembers them or not. It ships a ready setup that needs no path editing and works on any machine, and it re-states your core rules on every single message rather than once at the start. The install switches it on for you, as a step and not as a suggestion; your only part is starting a new session afterwards, since the setting is read when a session opens. A project running this kit without it is running on good intentions.

**One install file.** `Installation.md` is the complete install law: the merge rules for a project that already has a `CLAUDE.md`, the placeholder list, the setup steps, and the closing report the install owes you, problems and clashes included. Used once, then kept or deleted at your word.

## Install

Under ten minutes, and most of that is the assistant reading.

The complete install law lives in `Installation.md`: the merge rules for an
existing `CLAUDE.md`, the placeholders, the setup steps, and the report the
install must end with, problems and clashes included.

1. Copy `CLAUDE.md`, `Installation.md` and the `project-os/` folder into the
   root of your project.
   Already have a `CLAUDE.md`? Keep yours: bring the kit's in as `CLAUDE-kit.md`
   beside it, and the install has your assistant merge the two.
2. Paste the install prompt below into your assistant.
3. Answer its questions. It asks once, in one batch.
4. Read its closing report: what was set, what broke, and where your existing
   rules clash with the kit's process.
5. Commit the result.
6. Start a new session. The install switches the hooks on for you; they are
   read when a session opens, so the next one is where they take effect. See
   `project-os/Hooks.md` for what they do and how to check they worked.

## The install prompt

Copy this whole block and paste it into your assistant, in your project.

```
Set up ProjectOS — the files I just copied into this project.

Read Installation.md at the project root and follow it exactly, every step,
in order. Do not change anything before its reading step is complete.

The install ends with the report Installation.md defines: what was set, every
problem you hit, every clash between this project's existing rules and the
kit's process, and what is waiting on me. No clash is resolved by an override
without my verdict.
```

## The placeholders

Every value written in double curly braces is a placeholder, and none may
survive the install. The full token list, with meanings and examples, lives in
`Installation.md` step 5; the two tool files under `project-os/mcp/` carry a
few more inside marked setup tables of their own.

## What it needs on the machine

The rule files need nothing. The part that enforces them needs two things, and
the install checks both and tells you if either is missing.

**Node.** The hooks and their installer run through it, whatever language your
project is written in. Nothing else in the kit uses it.

**PowerShell, for the rotation scripts only.** These trim the files that grow
forever, and they run at commit time, not during normal work. Windows has it
already; on macOS or Linux install PowerShell Core (`pwsh`) if you want them.
Skipping it costs you nothing except that those files keep growing.

## Which assistants this fits

It is written for Claude Code, which picks up a `CLAUDE.md` at the project root on its own. Copy the files in and it works.

Other assistants read a different entry filename. Rename `CLAUDE.md` to whatever yours looks for — the content does not change. The `project-os/` folder is plain markdown with no tooling attached, so it needs no adjustment at all.

The hooks in `project-os/Hooks.md` are the exception: they are Claude Code's own mechanism, and another assistant with a similar feature needs its own equivalent wiring. Everything the hooks say is already written in the rule files, so a project without them still works, it just relies on the assistant remembering.

## Growing it

**The rule files are a starting position, not scripture.** They are a set of defaults that worked somewhere else. The moment one of them is wrong for your project, edit it — a rule you are quietly ignoring is worse than no rule, because it teaches the assistant that the folder is decorative.

**Split by area when one file gets crowded.** This kit is deliberately single-tier: one QA file, one History, one Decisions. That holds for a long time. When a project grows several distinct areas, give each one its own QA and History file and let the root ones point at them. Do that when the single file starts hurting, not before.

**If your project has an architecture worth protecting, write one more file for it.** One document, stating the rules the system depends on: what the data is allowed to look like, what cannot change without a migration, which boundaries are load-bearing. Then say in `CLAUDE.md` that it gets read before any structural work.

Write it as law, not as advice. An assistant follows a stated invariant exactly. It cannot infer one from the code, and it will cheerfully refactor a constraint nobody told it about.

## License

MIT — see `LICENSE`. Use it, change it, ship it in paid work.

Its copyright line still holds `{{YEAR}}` and `{{OWNER_NAME}}`. Fill those in if you republish the kit under your own name; leave them alone if you are just using it, since the install copies `CLAUDE.md`, `Installation.md` and `project-os/` into your project and leaves the license behind.
