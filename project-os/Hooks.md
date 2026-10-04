# Hooks: reminders and guards

Every other file here is a rule the assistant is asked to follow.
This one is about what the machine adds on top: reminders that repeat the core
rules on every message, and two guards that block a known set of commands
whether the assistant follows the rules or not.

A reminder makes drift less likely; it does not prove a rule was followed. Only
the guards block anything, and only the commands they recognise.

## Two ways the hooks get wired

**Once per computer: the kit as a plugin.** The owner clones the kit into their
personal skills folder, `~/.claude/skills/projectos`, with one command. It runs
in the chat box with `!` in front, in Windows PowerShell, or in a macOS or
Linux terminal (not the old Command Prompt):

```
git clone https://github.com/rotem914/ProjectOS "$HOME/.claude/skills/projectos"
```

Claude Code reads it as a plugin from then on. Its one hook,
`hooks/dispatch.mjs` at the kit root, fires in every session and decides per
project: it looks for `project-os/Hooks-settings.json`, walking up from the
folder the session was opened in (never from a folder the shell moved into
later), and does nothing where that file is absent, except to say so in a
folder that holds projects (see "A session opened in a folder above the
project" below). Where it is
present, it prints the reminder text it finds in that file (as data, never
run) and runs the two guards from the plugin's own copy, with the project root
set to the project it found. No install step, no settings write, so no
environment can refuse it. It announces itself once per session with a line
beginning `[ProjectOS plugin] hooks active for`, after checking that its own
copy of each guard loads; when one does not, that line reads `guards OFF`
instead (see "When the plugin says guards OFF" below). In the kit's own repository
the guards run the same way and only the reminders stay off, that line
included, since the files there are the templates shipped to projects.

**Per project: the installer.** Where the plugin is not on the machine, the
assistant installs the hooks into the project's own settings, during the
install, without being asked. Installing the hooks is a step of the setup, not
a suggestion at the end of it.

**Settings wiring wins, when it is proven.** When both exist, the plugin
stands down for a reminder whenever the project's own settings already carry
one for that moment, whatever its wording, so a session never gets two lists.
For a guard it stands down only when those settings name it under a matcher
that covers the tool being called (no matcher, `*`, or a plain list such as
`Bash|PowerShell` that names that tool) and the file they name exists on disk.
Only the settings Claude Code loads for that session count: those of the folder the session was opened in and, on macOS and Linux,
also the personal file at the root of the git repository, which Claude Code
loads there even for a session opened in a subfolder (see `--shared` below).
Claude Code reads them once, when the session opens, so wiring written during
a session, as the installer does during an install, counts only from the next
one: until then the plugin keeps running its own guards and sending its
reminder, through a `/clear` or a compaction too. To know what the settings
wired when the session opened, it keeps one small file per session in a
`ProjectOS-plugin-sessions` folder under the system's temp folder, never in
the project, and removes those older than a week.
Anything not proven runs the plugin's own copy: a moved or renamed
project, a path from another computer, or a matcher that leaves the tool out.
At worst a guard runs twice, which blocks the same thing. A project can keep
its own wiring forever.

That is also how a project gets newer guards than the plugin carries: the
installer wires the project's own copies, and from the next session the
plugin steps aside for them on every tool (`Installation.md` 6b, and
`Go update kit` in CLAUDE.md). On Windows that holds for a session opened at
the project root. A session opened in a subfolder there loads only that
subfolder's settings, so the plugin runs its own copy, and updating the
plugin folder (`git pull` inside it) is what brings that one up to date.

The installer step is one command, run from the project root:

```
node project-os/Install-project-hooks.mjs
```

It merges the ready-made hooks in `project-os/Hooks-settings.json` into
`.claude/settings.local.json`, and it never overwrites.

**Hooks of the same kind run side by side.** That setting holds a LIST, so this
project's hooks are added beside whatever the project already had, and both
fire. Nothing existing is removed, reworded or reordered. Running it twice
with the same flags changes nothing, because a hook already present is
recognised.

Flags, all of them optional:

- `--dry` shows what it would do and writes nothing.
- `--shared` writes to `.claude/settings.json`, which is committed, so the whole
  team gets the hooks, and so does a session in the cloud. Without it the hooks
  land in `.claude/settings.local.json`, which is personal to one machine and
  usually not committed, so a teammate cloning the repo gets none. The
  personal file names each guard by this project's own path, and the reason
  depends on the system. On macOS and Linux, a session opened in a subfolder
  still loads the personal file from the root of the git repository, while the
  folder Claude Code hands every hook is the subfolder, so only the project's
  own path still leads to the guard there. On Windows, a session opened in a
  subfolder loads no settings from the root at all: the plugin is what covers
  it, and without the plugin that session runs without the project's hooks.
  The shared file names the guards through `${CLAUDE_PROJECT_DIR}`, that
  folder Claude Code hands every hook, so the same file works on every
  computer and in the cloud; open sessions at the project root there, because
  from a subfolder that name leads to a guard that is not there. Say which one
  you chose, out loud.
- `--replace` removes an event's existing hooks instead of running beside them.
  For a hook known to be broken, never as a default.

A hook already in the committed file is not added again to the personal one,
except the guards on macOS and Linux, which go into the personal file too so a
session opened in a subfolder still gets them. A default run reads both files
before it judges anything missing, and a guard counts as the same guard when
both files lead to the same script, however each spells the path. `--shared`
never skips a hook because the personal file has
it. It always fills the committed file, reminders included, because only the
committed file reaches teammates and the cloud. So a default run followed by
a `--shared` one leaves the guards in both files, and on this machine each
runs twice, which is harmless: both copies block the same thing.

**If the environment refuses that write**, some setups guard their own
configuration, do not argue with it and do not retry in a loop. Say plainly
that the write was refused, hand the owner that one command to run themselves,
and carry on. That is the fallback, never the plan.

**The owner's only step is a restart.** Hooks are read when a session starts,
so the newly installed ones take effect in the NEXT session, not this one. Say
that clearly, and give the one question that proves the reminders arrive: ask
the assistant what rules it was given this turn, and see whether it reads them
back.

If you would rather wire it by hand, the reminders are in the block below. The
guards are the PreToolUse part of `project-os/Hooks-settings.json`. As it
stands it names each guard through `${CLAUDE_PROJECT_DIR}`, which works for a
session opened at the project root; for the personal file, put the project's
own path in its place, as the installer does. Keep each guard's matcher as
that file has it: the plugin steps aside only for the tools a matcher covers.
A guard whose command does not lead to its file fails
open and blocks nothing, so run the checks at the end of this file after wiring.

## Level 1: works in any project, needs no files

Paste this and you are done. It adds nothing to the repository, depends on no
script, and needs no path edited: every name in it is relative to the project.

Two hooks. The first speaks once when a session opens. The second speaks on
**every single message**, which is the whole point: a rule repeated at the top
of the conversation is a rule that fades, and a rule repeated every turn does
not.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node -e \"console.log('PROJECT RULES: before doing anything in this session, read the files CLAUDE.md lists under Read these before you work, as that list says. Conversations.md governs every reply you write. Workflow.md governs every task.')\"",
            "timeout": 10,
            "suppressOutput": true
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node -e \"console.log('STANDING RULES for this reply and this task: 1) Reply exactly as project-os/Conversations.md prescribes, layout and length included. 2) Change only what was asked, nothing else, however tempting. 3) Prefer the smallest safe change. 4) When something is unclear, or the decision belongs to the owner, ask instead of deciding. 5) After any completed change, add its History row; in FAST MODE, one row for the whole burst, when it ends. 6) Never write a file outside this project folder. 7) Never say a check passed unless it was actually run.')\"",
            "timeout": 10,
            "suppressOutput": true
          }
        ]
      }
    ]
  }
}
```

That block is the kit's default wording for the reminder half of
`project-os/Hooks-settings.json`. The same file also carries the two guards
(level 2 below), and the command above installs all of it. Once the wording is
adapted for a project, that file, not this block, is what counts.

**Edit the wording freely**, using only the characters that "The trap that
costs an afternoon" below allows. That second string is the shortest useful version
of your own rules; a project with different sore points should say different
things. Keep it to a few lines: this text is paid for on every message, and a
long block gets skimmed exactly like a long rule file.

**A reword where the installer wired the hooks needs one more step.** There the
reminder is a copy inside `.claude/settings.local.json` (or `settings.json`
after `--shared`), that copy is the one sent, and the plugin stays quiet
beside it. So a reword reaches sessions only after the installer is re-run for
that file with `--replace`; until then the old wording is the one sent. A
plain re-run would put the new wording beside the old, and both would be sent.
`--replace` swaps only the kinds of hook whose wording changed, but it also
drops any other hook of that kind the project had, so read the file first and
name what it removes.

**Keep it under roughly 10 KB.** Longer output is not inlined; it is written to
a file with a short preview, and the end of your text never reaches the model.

## Level 2: the guards, and they ship with the kit

These are the difference between a rule that is repeated and a rule that is
enforced before the action runs. They live in `project-os/guards/`, they install with the same
command as level 1, and `Hooks-settings.json` names each one through
`${CLAUDE_PROJECT_DIR}`, for example
`node "${CLAUDE_PROJECT_DIR}/project-os/guards/Path-guard.mjs"`. A hook runs
from whatever folder the tool happens to be in, so a bare relative path would
miss. The installer writes this project's own path in its place in the personal
settings file, and keeps it in the committed one, where every machine fills in
its own project folder.

**The folder guard**, `guards/Path-guard.mjs`. Fires before every file write
and every shell command, and refuses writes aimed outside the project folder.
It reads the command, including redirections, writing programs, inline shells
and `cd` moves, and blocks a write it recognises whose target it cannot prove
is inside. A delete outside the folder counts as a write, and so does moving a
file in from outside, since the move deletes it there; copy it in instead. It
recognises the common ways a command writes; a command it does
not recognise runs unchecked, so it is a safety net, not a wall. It runs on
Windows, macOS and Linux; the one exception it allows on its own is the
assistant's memory folder for a project, `~/.claude/projects/<project>/memory/`,
markdown only. An `EXTRA_ROOTS` list at the top of
the file, empty by default, is where the owner names any other folder writes
may reach.

What it reads, beyond a plain command:

- **Loops and conditions.** The command after `if`, `then`, `else`, `do` and
  the other words of a loop or condition, and after a `case` pattern, is read
  like any other. A rename loop over names in the current folder,
  `for f in *.jpeg; do mv "$f" "${f%.jpeg}.jpg"; done`, stays allowed; any
  other path built while the command runs is refused.
- **Text blocks are text.** A PowerShell here-string, a bash here-document
  inside a quoted `$( )` (the usual way a commit message is written), and a
  quoted text of several lines given to a program that takes it as text (a
  commit or tag message, a `gh` title or body, what `echo`, `printf`,
  `Write-Host` or `Write-Output` prints, a PowerShell `-Value` or `-Message`)
  are never read as commands, unless the same command can run text: `iex`,
  `Invoke-Expression`, `eval`, `sh -c`, `| bash` and the like. Printed text
  that a later pipe carries on is read line by line.
- **Inline scripts of any length.** A script given on the command line
  (`node -e`, `python -c` and their other spellings) or piped into an
  interpreter or a shell is refused when it names a path outside the project,
  unless that path is only read, and a script that reads a file outside and
  writes inside is refused too. A web route such as `'/projects/'` looks like
  such a path. It counts in a one-line script; a script of several lines
  counts only a path shaped like a folder on this computer (a drive, `~`,
  `/c/`, the system's top folders), unless it writes to a path it builds
  while it runs.
- **Pipelines.** A delete, overwrite, empty or rename that names no path of
  its own (`Get-ChildItem <folder> | Remove-Item`) is checked against where
  its pipeline starts, and refused when that start cannot be read.
  `find -exec` works in the folders find searches.
- **git elsewhere.** git pointed at another folder (`-C`, `--git-dir`,
  `--work-tree`, or a `cd` before it) may only read there: status, log, diff,
  show. Anything that changes a repository outside the project, or in a
  folder chosen while the command runs, is refused.

**The destructive-command guard**, `guards/Destructive-guard.mjs`. Fires before
every shell command and blocks the one-way operations: recursive or forced
deletes whose targets are not provably disposable, force pushes, history
rewrites, hard resets, branch deletes. Its job is the command nobody meant to
run. A dry-run flag passes; a delete inside `node_modules`, a build folder, the
project's `.tmp/` scratch folder, the OS temp folder or a `*.tmp` leftover
passes; everything else stops with the reason. Also judged like a recursive
delete:

- **Many files at once.** A delete with a wildcard (`rm *.log`,
  `Remove-Item *.zip`), one fed by a pipe (`... | Remove-Item`) and `xargs rm`
  pass only inside throwaway folders.
- **Through a link.** A throwaway target that reaches through a link (a
  symlink or a junction) into a folder that is not throwaway is refused, since
  a delete through a link removes the real files. Deleting the link itself,
  with no trailing slash, passes.
- **`git checkout` with a file or folder name.** It throws away that file's
  uncommitted changes, so it is refused like `git restore`. Switching
  branches passes; a branch that shares its name with a folder is switched
  with `git switch`.

Text blocks are text here too, as above. One command is refused on purpose:
`echo projectos-live-probe` gets the fixed line
`ProjectOS live probe: the guards are on in this session. Nothing was run.`,
which is how the install proves the guards are live in a session
(`Installation.md` 6b).

Both are the same shape: read the tool call from standard input, exit 0 to
allow, exit 2 with one line on standard error to block, and on any error of
their own exit 0. That last part is the law below, fail open.

## The check when a turn ends

`guards/Check-on-stop.mjs`, run by the plugin on the Stop event. When the
assistant finishes a turn that changed code, it runs the project's quick
check, the `command` in `project-os/Check-command.json`. A pass is silent. A
failure sends the assistant back to work in the same turn, with the errors:
it fixes them, runs the check again, and adds one short reply. The reply that
ended the turn is already on screen, so the owner sees two replies in such a
turn, and is never left with a broken project that was called done.

- **What counts as changed code.** Anything git shows as changed that is not
  a record or a note: markdown files, and everything under `project-os/`,
  `plans/`, `features/`, `backups/`, `.tmp/` and `.claude/`, do not count.
- **Once per state.** A state of the changed files that passed is not checked
  again. A state that failed is reported once: a check the assistant cannot
  fix never traps the turn.
- **Fast mode skips it.** A reply that ends on the line `Fast mode on` runs
  no check, since the mode waives checks. `Go commit` still runs them all.
- **Only for a project approved on this computer.** Everything else the
  plugin runs is its own code. This command is the project's, so the plugin
  runs it only after the install approved it here, from the project folder:

  ```
  node "$HOME/.claude/skills/projectos/hooks/dispatch.mjs" approve
  ```

  A project that came with the kit already inside it, and was never installed
  on this computer, runs no check. So does a command changed after it was
  approved, until the line above is run again.
- **A plugin thing only.** `Hooks-settings.json` does not carry it, so a
  project without the plugin has no automatic check. A project that wires a
  script of its own named `check-on-stop` on Stop keeps that one, and the
  plugin stands down.
- **It fails open.** No git, a check that cannot start or runs past two and a
  half minutes, any error of its own: the turn ends as usual.

**Not shipped yet: the reply linter.** It would check each reply against the
reply rules and correct the next one. It is a script of its own with a test
suite, and it has not been made generic yet, so the kit does not carry it.
Hooks.md says so here rather than pretending; a project that wants it writes it.

## The laws every hook here obeys

- **Fail open.** A hook that crashes, or cannot read what it needs, exits
  quietly and allows the action. A bug in a guard must never trap you inside
  your own project. The only thing a hook may block on purpose is the specific
  thing it exists to block. The plugin still allows when its own copy of a
  guard gives no verdict, but never in silence: see "When the plugin says
  guards OFF".
- **A guard blocks, a linter warns.** Anything that changes the world gets
  stopped before it happens. Anything about style or wording gets corrected on
  the next message, never by forcing a redo. The check when a turn ends is
  neither: it never asks for the reply again, it sends the assistant back to
  mend the code.
- **A hook points at a copy that moves with what it guards.** The project's
  own copy under `project-os/`, or the plugin's kit clone in the personal
  skills folder. Never a copy sitting in another project on the same disk:
  rename or move that project and this one silently loses its protection, and
  the two copies drift apart unnoticed.
- **Nothing secret goes in this file.** It holds paths and instructions. Keys,
  tokens and credentials live outside the repository.

## Checking that it actually works

A hook that is not firing looks exactly like a hook that is firing, so check it
once rather than assuming.

- **First, that anything is wired at all:** the two checks below run the
  scripts by hand, so they pass whether or not the settings file names them.
  The installer's dry run is the check that cannot be fooled:

  ```
  node project-os/Install-project-hooks.mjs --dry
  ```

  It checks the file it would write to, so give it the flags the hooks were
  installed with: add `--shared` at the end when that is how they went in.
  Every event under "present:" is installed. Any event under "will add:" is
  not, and the speaking and blocking checks below prove nothing about it.
  The one exception: when the session started with a line beginning
  `[ProjectOS plugin] hooks active for` and naming this project, the hooks
  come from the plugin, "will add" is expected, and nothing needs installing.
  In the session the kit arrived in, a missing line proves nothing, since the
  plugin decides whether to speak when a session opens; use the live check in
  `Installation.md` 6b there.
- **The plugin's guard, when the plugin is the wiring:** the announcing line
  names the plugin folder; feed the same fake tool call to its dispatcher from
  the project root, and expect the same blocking line and `exit 2`. The line
  below uses the usual plugin folder; if the announcing line names another,
  put that path in its place:

  ```
  node -e "const r=require('child_process').spawnSync(process.execPath,process.argv.slice(1),{input:JSON.stringify({tool_name:'Bash',tool_input:{command:'rm -rf src'},cwd:'.'}),encoding:'utf8'});process.stderr.write(r.stderr||'');console.log('exit '+r.status);process.exitCode=r.status||0" "$HOME/.claude/skills/projectos/hooks/dispatch.mjs" pretool
  ```
- **The session hook:** start a new session and ask the assistant what standing
  rules it was given this turn. It should quote them back.
- **A guard:** feed it one fake tool call and read the exit code, no real
  action needed. From the project root:

  ```
  node -e "const r=require('child_process').spawnSync(process.execPath,process.argv.slice(1),{input:JSON.stringify({tool_name:'Bash',tool_input:{command:'rm -rf src'}}),encoding:'utf8'});process.stderr.write(r.stderr||'');console.log('exit '+r.status);process.exitCode=r.status||0" project-os/guards/Destructive-guard.mjs
  ```

  It should print one blocking line, then `exit 2`, and exit with code 2. A
  guard that exits 0 there is not installed, not this file, or broken, in that
  order of likelihood.

  Both lines are written in node alone, on purpose, and run the same in Git
  Bash, PowerShell and a macOS or Linux terminal. An `echo` pipe of the same
  fake call breaks in one shell or another: Git Bash strips the quotes when
  the JSON is left bare, and PowerShell can put an invisible mark in front of
  what it pipes. Either way a working guard reads as switched off. Keep the
  script path outside the quoted part: the quoted script then names nothing
  outside the project, so no version of the folder guard, older copies
  included, can mistake it for a write.

If nothing happens, the usual causes are: the session was not restarted, the
JSON has a syntax error, or the command form does not survive your shell.

**A session opened in a folder above the project gets no hooks at all.**
Claude Code does not load the project's own `.claude` settings for it, even
after the shell moves into the project, and the plugin runs nothing there. It
says so, though: when a folder directly inside the session's folder carries
the kit, session start prints one line beginning
`[ProjectOS plugin] rules and guards OFF here`, naming that project's folder.
Open the session in the project folder itself.

**When the plugin says guards OFF.** At session start the plugin runs its own
copy of each guard once, on an empty call; a guard the project's settings
already wire is not checked, since the plugin does not run it there. When one
is missing, will not load or does not answer, the start line reads
`[ProjectOS plugin] guards OFF for <project>: <reason>` in place of
`hooks active`, and every call that guard would check goes through
unchecked. Each such call also shows one hook error beginning
`[ProjectOS plugin] guard skipped on this call, fail open`, and still runs.
The usual cause is the plugin folder itself: a file an antivirus removed, or
an update that stopped halfway. Two fixes:

- In the project, run `node project-os/Install-project-hooks.mjs`: from the
  next session the project's own guards run, and the plugin steps aside for
  them.
- The plugin folder is outside the project, so its repair is the owner's. The
  line ends with the `git status` that shows what changed there. When nobody
  edited that folder on purpose, deleting it and running the
  once-per-computer command again puts it back as the kit ships it.

**Where the plugin does not reach, stated plainly.** A session run in the
cloud, a session whose setting sources exclude the personal folder, a managed
policy that disables personal plugins, or a project folder that lacks
`project-os/Hooks-settings.json` (a worktree that excludes it). In
every one of those the per-project installer is the wiring,
and the announcing line is absent, which is how you know (except in the
session the kit arrived in, where a missing line proves nothing; see
`Installation.md` 6b). A cloud session works from a fresh copy of the
repository, so only the committed `.claude/settings.json` reaches it: there the
wiring is the installer run with `--shared`, and the default personal file
never arrives. The plugin's guards also use the plugin copy's own settings, so
an `EXTRA_ROOTS` list edited in a project's copy of `Path-guard.mjs` applies
only when that project's own wiring is the one running.

## The trap that costs an afternoon

**Do not write a hook command as `echo` with single quotes around JSON.** It
works when commands run through a Unix-style shell, and produces mangled,
invalid output under the Windows command prompt, where those quotes survive as
literal characters. The hook still reports success. Nothing warns you. The
rules simply never arrive, and the assistant looks like it is ignoring a file
it was never shown.

The `node -e "console.log('...')"` form above is used instead because it
survives both shells unchanged. Inside that text use no apostrophes, double
quotes, backticks, dollar signs or backslashes, anywhere. Each one either
closes the string or is read by a shell as code, and the reminder then arrives
with words missing, or not at all, while the install still reports it on.
Write "do not" rather than the short form, and name files without quotes. The
guard lines carry `${CLAUDE_PROJECT_DIR}` on purpose; this list is for the
reminder text only.
