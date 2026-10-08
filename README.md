# ProjectOS

A folder of markdown files that an AI coding assistant reads before it touches your project: your rules, your process, your history.
It exists because a new chat session starts with none of that, and loses all of it again the moment the session ends.

Most of it is markdown: you copy the files in and your assistant picks them up. The rest is a few small scripts that run on Node. The hooks matter most: a setting the install switches on for you, and what stops the rules being quietly forgotten halfway through a long session. The others keep the growing files short, back the project up, check its records and bring in a newer kit.

## The pattern

When something goes wrong twice, it becomes a file.

That is the whole idea. You can correct an assistant in chat, and it will listen, for as long as that session lasts. The next session starts blank. It has never met you, has never seen the bug you fixed last week, and has no idea which parts of your project are load-bearing.

A file is the only part of your working relationship that survives a new session. So every correction worth repeating gets written down once, in a place the assistant reads before it touches anything. Chat is where you notice the problem. A file is where you solve it.

## What is in the box

Every file and folder in this repository, grouped by what it does. The install copies `CLAUDE.md`, `Installation.md` and the `project-os/` folder into your project; the last group stays here.

**Six rule files.** These arrive with real content and work on day one.

| File | What it does for you |
|---|---|
| `CLAUDE.md` | The entry file. Names your project, your stack, and the rules that override the assistant's defaults. It is read first, every session. |
| `project-os/Workflow.md` | The mandatory path from request to delivery. Stops the assistant from writing code before it understands the job. |
| `project-os/QA.md` | What must be true before anything is called done. Kills "looks fine to me" as a verification standard. |
| `project-os/Conversations.md` | How the assistant writes back to you. Short, structured, skimmable, instead of five paragraphs restating your own request. |
| `project-os/Code_review.md` | How risky changes get reviewed, and what counts as risky enough to trigger one. |
| `project-os/Visual_QA.md` | How the running app gets tested by actually using it, not by reading the diff and hoping. |

**One file of reasons.** `project-os/Rule-reasons.md` holds the backstory of the rules: why each one exists. It is opened only when a rule is questioned or changed, never as part of the reading before work, so the rule files stay short.

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

**Two tool files.** `project-os/mcp/Figma/Figma_MCP_Rules.md` holds working rules for the Figma MCP server: the call budget discipline, the hard caps, and the traps that fail silently. `project-os/mcp/Google_analytics/Google_Analytics_MCP_Rules.md` holds the wiring and reading rules for the official GA4 MCP server: key-outside-the-repo authorization, and never quoting a number that did not come from a tool call. Every rule in them was paid for in real use. The install asks whether your project uses each one, and removes a folder only when you say it is not used; a different server earns its own folder there the first time it bites.

**The enforcement layer.** `project-os/Hooks.md` is the part that makes the rest hold. Rule files are followed while they are remembered; hooks fire on every message and every tool call whether anything remembers them or not. It ships a ready setup that needs no path editing and works on any machine: your core rules re-stated on every single message, plus two guards that do not ask: one refuses the file writes outside the project it recognises, and one refuses the destructive commands it recognises before they run. They are a safety net, not a wall. The install switches it on for you, as a step and not as a suggestion; your only part is starting a new session afterwards, since the setting is read when a session opens. A project running this kit without it is running on good intentions.

| File | What it does |
|---|---|
| `project-os/Hooks.md` | What the hooks do, how they get wired, and how to check they work. |
| `project-os/Hooks-settings.json` | The ready setup: the reminder text and the two guard lines. |
| `project-os/Install-project-hooks.mjs` | Writes that setup into the project's own settings, on a computer without the plugin below, or one whose plugin carries older guards than the project. |
| `project-os/guards/Path-guard.mjs` | The folder guard: refuses the writes it recognises outside the project. |
| `project-os/guards/Destructive-guard.mjs` | The destructive-command guard: refuses the one-way commands it recognises. |
| `project-os/guards/Check-on-stop.mjs` | The check when a turn ends: runs the project's quick check after a turn that changed code, and sends the assistant back when it fails. |
| `project-os/Check-command.json` | The quick check that runs by itself, one command, set at install. |

**Five upkeep scripts.** All of them run on Node. The first two also ship as PowerShell twins that do the same thing, for anyone who prefers them.

| File | What it does |
|---|---|
| `project-os/Archive-old-rows.mjs`, and its twin `Archive-old-rows.ps1` | Moves the oldest rows of the files that grow forever into archives that are not read by default. Runs at `Go commit`. |
| `project-os/Backup-whole-project.mjs`, and its twin `Backup-whole-project.ps1` | Zips the whole project, git history included, into one file you can put on a drive. Runs when you say `Go backup`. |
| `project-os/Find-heavy-files.mjs` | Lists every file, and every top-level folder, over 1 GB at `Go commit`, for you to keep or delete. It deletes nothing. |
| `project-os/Audit-project-records.mjs` | Counts the gaps in the project's own records, such as a day of commits with no History row. Runs when you say `Go audit`, and as a warning at every `Go commit`. It never blocks anything. |
| `project-os/Compare-kit-files.mjs` | Compares your project with a newer kit when you say `Go update kit`, and on your word brings in only what you never changed. |

**One install file.** `Installation.md` is the complete install law: the merge rules for a project that already has a `CLAUDE.md`, the placeholder list, the setup steps, and the closing report the install owes you, problems and clashes included. Used once, then kept or deleted at your word.

**The kit's own files, never copied into a project.**

| File or folder | What it is |
|---|---|
| `README.md`, `LICENSE` | This page, and the license below. |
| `.gitignore`, `.gitattributes` | This repository's own git settings. |
| `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/dispatch.mjs` | The plugin the once-per-computer step below sets up. Its one dispatcher decides, project by project, whether the hooks apply. |
| `mods/` | Two optional mods for Claude Code's own window, with their tests: a second plugin that rides in the same once-per-computer copy. See "Mods" below. |
| `System-map.html` | The whole system on one canvas: open it in a browser, click a block to zoom into its process. Its content is written by hand from the files above, so a change to them is carried into it. |
| `tests/` | The kit's test suites, one per guard or script, run from the kit root before a change to any of them ships. |
| `scripts/Multiple-claude-accounts.ps1` | Windows only, and separate from the install. Gives each client their own Claude Desktop, kept apart from your personal one: run it once, then double-click "New Claude client" on your desktop for each new client. |

## Once per computer

One command, once, and every project that carries the kit gets its hooks with
no install step, in any permission mode. It puts a copy of this kit in your
personal Claude folder, where Claude Code reads it as a plugin; the hooks stay
silent in any project without `project-os/` and stand down where a project
already wired its own. Needs `git` and `node` on the path.

The same command on every system. It runs in Windows PowerShell, in a macOS or
Linux terminal, and in Claude Code's chat box with an exclamation mark in
front. It does not run in the old Windows Command Prompt.

<!-- Keep this command identical to the copy in project-os/Hooks.md, "Two ways the hooks get wired". -->

```
git clone https://github.com/rotem914/ProjectOS "$HOME/.claude/skills/projectos"
```

Then start a new session anywhere. To pick up a newer kit later, run
`git pull` inside that folder; the hooks read it on their next call. That
updates this computer's copy only; each project's own copy is updated with
`Go update kit` (Install, step 1).

Skip this and the install still works: the assistant then writes the hooks into
each project's own settings, and asks you for one command whenever its
environment refuses that write.

## Mods

Optional, and early access. Two small additions that draw inside Claude Code's
own window, in the desktop app and in the terminal, in every folder you open.

**A row above the message box.**

- The project's name, in plain text: the repository's name, or the folder's
  name outside a repository.
- What is waiting, inside a git project: files to commit, commits to
  push, and a newer kit ready for this computer's copy.
- A small light, in the desktop app, where the project's `CLAUDE.md` names
  a local address (`http://localhost:4321`): green while that address
  answers, grey while it does not, whoever started the server.
- Buttons. One for each kit shortcut the project's `CLAUDE.md` carries:
  `Go commit` in the row, only while files wait, with their count inside it
  (`Go commit · 1`), the rest behind the three dots. A press sends the phrase as
  your own message. `Push` and `Update plugin` show only while there is
  something to push or to update, each with its count of commits
  (`Push · 1`, `Update plugin · 1`), and neither acts on one press. `Push`
  turns into `Approve` for five seconds, and a press on `Approve` pushes;
  left alone, it is `Push` again. `Update plugin` asks in the row first.
- No `Push` in a project with a push step of its own, such as push checks or
  large files kept in Git LFS. Claude Code runs a mod's git without that
  step, so a push from the row would skip it. The row says
  `to push from your git app` there instead.

**How long the last reply took**, under the message box: `12s` under a
minute, `2:36m` from there. It stays until the next reply ends.

**A live fix for long dashes**, only in a project whose
`project-os/Conversations.md` asks for it. A long dash is replaced as the
reply is saved. Nothing else about a reply is changed, and a reply is never
held back.

Claude Code puts the plugin's name on what a mod shows: the short notice
after a push and the message a button sends both carry it.

The mods ride in the copy the once-per-computer step made, in its `mods/`
folder, so a newer kit brings newer mods. This updates that copy, on every
system:

```
git -C "$HOME/.claude/skills/projectos" pull
```

Every install asks whether to switch the mods on, when they are not on yet
on that computer, and on a yes does the steps below for you.

By hand: a copy made before the mods existed needs that update first. One
more step, once, then switches the mods on in every way of opening Claude.
In Windows PowerShell:

```
$mods = "$HOME\.claude\skills\projectos\mods"; if (-not (Test-Path -LiteralPath $mods)) { "The mods folder is not on this computer yet: $mods. Do the Once per computer step, or run the update command above, then run this again." } else { $dirs = @("$([Environment]::GetEnvironmentVariable('CLAUDE_CODE_PLUGIN_DIRS', 'User'))" -split ';' | ForEach-Object { $_.Trim() } | Where-Object { $_ }); if ($dirs -notcontains $mods) { [Environment]::SetEnvironmentVariable('CLAUDE_CODE_PLUGIN_DIRS', (($dirs + $mods) -join ';'), 'User') }; "The mods are switched on. Quit Claude completely and open it again." }
```

The command answers in words: the mods are switched on, or their folder is
not on this computer yet and what to do about it. It adds the folder to your
own `CLAUDE_CODE_PLUGIN_DIRS` setting, keeps whatever was already in it, and
changes nothing when run a second time. Then quit Claude completely and open
it again. On Windows it keeps running beside the clock after its window
closes, so quit it there too; a terminal needs a new window.

To switch the mods off again, in Windows PowerShell:

```
$mods = "$HOME\.claude\skills\projectos\mods"; $dirs = @("$([Environment]::GetEnvironmentVariable('CLAUDE_CODE_PLUGIN_DIRS', 'User'))" -split ';' | ForEach-Object { $_.Trim() } | Where-Object { $_ -and $_ -ne $mods }); [Environment]::SetEnvironmentVariable('CLAUDE_CODE_PLUGIN_DIRS', $(if ($dirs) { $dirs -join ';' } else { $null }), 'User'); "The mods are switched off. Quit Claude completely and open it again."
```

It takes the folder out of the same setting and leaves the rest of it as it
was.

On macOS or Linux, name the same folder in the `env` block of
`~/.claude/settings.json` instead:
`"CLAUDE_CODE_PLUGIN_DIRS": "~/.claude/skills/projectos/mods"`. Take that
line out again to switch the mods off.

A window opened for a client runs the mods from that same personal copy. Its
`Update plugin` button updates the client's own copy of the kit, the one that
client's hooks read; the update command above is what brings newer mods.

Early access means Claude Code may change this kind of plugin, or switch it
off, in any release. The two mods are one plugin, so when a newer Claude Code
refuses something in either of them, both stop together. The row then stops
showing, long dashes stay as written, and the rest of the kit works as before.

## Install

Under ten minutes of your time. The assistant's part is longer, mostly
reading. What you will see while it runs:

- **Approval prompts.** In Claude Code's usual permission mode it asks before
  most commands and every file change, so an install left alone waits at the
  first one. The check that proves the guards are live is a harmless `echo`.
- **Its questions, near the start, in one sitting.** Each one marks the
  option it recommends.
- **A short set of decisions after its report**, for what is waiting on you.

The complete install law lives in `Installation.md`: the merge rules for an
existing `CLAUDE.md`, the placeholders, the setup steps, and the report the
install must end with, problems and clashes included.

1. Open Claude Code in your project's own folder and paste the install prompt
   below. It carries the kit's link: your assistant fetches the kit into
   `.tmp/projectos-kit` inside your project, never into the project itself or
   beside it, copies `CLAUDE.md`, `Installation.md` and the `project-os/`
   folder in, writes down which kit version they came from, and deletes the
   fetch.
   Already have a `CLAUDE.md`? It stays: the kit's comes in beside it as
   `CLAUDE-kit.md`, and the install merges the two, your rules winning every
   clash until you rule otherwise.
   Already have a `project-os/` folder from an earlier install? To bring it up
   to a newer kit, say `Go update kit` instead: your assistant fetches the new
   kit, shows you what would change, and applies it on your word, leaving your
   records and your own edits alone. A project installed before that phrase
   existed does not know it yet: give your assistant this link with it, and it
   follows the shortcut as the kit's `CLAUDE.md` writes it. Either way the
   update finishes with the steps of the newest kit's `CLAUDE.md`, whatever
   version your project started from.
2. Approve what Claude Code asks, and answer the questions.
3. Read its closing report: what was set, what broke, and where your existing
   rules clash with the kit's process. Then answer the decisions after it.
4. Start a new session, in the project's own folder, never in a folder above
   it: the rules and guards switch on only there. With the once-per-computer
   step done, the hooks switch on as soon as the kit is in the folder. Without
   it the install switches them on for you, and they are read when a session
   opens, so the next one is where they take effect. See
   `project-os/Hooks.md` for what they do and how to check they worked.
5. In that new session, say `Go commit`, and your assistant commits the
   result with the rules and guards on. In a cloud session, say it before
   step 4 instead: a new cloud session starts without this one's uncommitted
   files.

**Copying the files in by hand** works too, as a fallback: put `CLAUDE.md`
(as `CLAUDE-kit.md` when you already have one), `Installation.md` and the
`project-os/` folder at your project's root, never over an existing
`project-os/`, which would replace your History and Decisions with empty
templates. Then paste the same prompt. It costs one thing: the install cannot
write down which kit version the files came from. The first `Go update kit`
then has to work it out by matching the kit's scripts in your project against
the kit's history, and if one of them was changed in between it cannot: every
file that differs from the kit is then compared by hand.

## The install prompt

Copy this whole block and paste it into your assistant, in your project's own
folder.

```
Install ProjectOS from https://github.com/rotem914/ProjectOS

Read Installation.md and follow it exactly, every step, in order. Do not
change anything before its reading step is complete.

If the files are not in this project yet, fetch the kit into
.tmp/projectos-kit first, never into the project root or beside it, and read
Installation.md there.

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

The rule files need nothing. Everything else runs on Node, and the install
checks it and tells you if it is missing.

**Node.** Every script in the kit runs through it, whatever language your
project is written in: the hooks and their installer, the two guards, and the
five upkeep scripts, from the archive at commit time to the `Go backup` ZIP.
So does the separate Chrome every install sets up for browser checks, which
needs Node 20.19 or newer (22.12 or newer on the 22 line). The
once-per-computer step and `Go update kit` also need `git`, to fetch the kit.

**PowerShell is not needed for anything.** `Archive-old-rows.ps1` and
`Backup-whole-project.ps1` are twins of the two Node scripts and do the same
thing, for anyone who prefers PowerShell. A machine without it loses nothing.

**What the backup carries.** The `Go backup` ZIP holds the whole project, git
history included. It leaves out what can be rebuilt (dependencies, build
output), the assistant's personal settings and scratch, the env files and
the common key files (certificates, SSH private keys, cloud credential
files), and it names each key file it left out. A secret saved under any
other name goes along, so keep those outside the project.

## Which assistants this fits

It is written for Claude Code, which picks up a `CLAUDE.md` at the project root on its own. Copy the files in and it works.

Other assistants read a different entry filename. Rename `CLAUDE.md` to whatever yours looks for; the content does not change. The `project-os/` folder is markdown plus a few Node scripts that work the same under any assistant, so it needs no adjustment at all.

The hooks in `project-os/Hooks.md` are the exception: they are Claude Code's own mechanism, and another assistant with a similar feature needs its own equivalent wiring. Everything the reminder hooks say is already written in the rule files, so a project without them still works, it just relies on the assistant remembering. The two guards are the exception to that too: without them nothing stops a stray write or a bad delete except the assistant's own care.

## Growing it

**The rule files are a starting position, not scripture.** They are a set of defaults that worked somewhere else. The moment one of them is wrong for your project, edit it. A rule you are quietly ignoring is worse than no rule, because it teaches the assistant that the folder is decorative.

**Split by area when one file gets crowded.** This kit is deliberately single-tier: one QA file, one History, one Decisions. That holds for a long time. When a project grows several distinct areas, give each one its own QA and History file and let the root ones point at them. Do that when the single file starts hurting, not before.

**If your project has an architecture worth protecting, write one more file for it.** One document, stating the rules the system depends on: what the data is allowed to look like, what cannot change without a migration, which boundaries are load-bearing. Then say in `CLAUDE.md` that it gets read before any structural work.

Write it as law, not as advice. An assistant follows a stated invariant exactly. It cannot infer one from the code, and it will cheerfully refactor a constraint nobody told it about.

## Who made it

Rotem Elimelech (Rotem E) is a product designer in Tel Aviv, shipping products since 2009 and now building his own with AI coding assistants. ProjectOS came out of his daily work on vibe coding projects for clients and internal projects.

[rotem-e.com](https://rotem-e.com)

## Use at your own risk

ProjectOS is provided as is, without any warranty. Using it is entirely your own responsibility: how you use it, and everything that happens in your projects while you do, including anything an AI assistant does while following these rules. The creator of the kit is not responsible for anything.

## License

MIT (see `LICENSE`). Use it, change it, ship it in paid work.

Its copyright line still holds `{{YEAR}}` and `{{OWNER_NAME}}`. Fill those in if you republish the kit under your own name; leave them alone if you are just using it, since the install copies `CLAUDE.md`, `Installation.md` and `project-os/` into your project and leaves the license behind.
