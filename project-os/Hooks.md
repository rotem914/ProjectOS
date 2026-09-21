# Hooks — the part that actually enforces the rules

Every other file here is a rule the assistant is asked to follow.
This one is about rules the machine enforces whether it follows them or not.

**Why it matters more than it looks.** A folder of markdown holds for a while
and then drifts: the rules sit at the top of a long session, the work moves on,
and by the fiftieth message they are quietly gone. Nothing announces it. The
replies just start getting longer, the History row stops being written, and a
change touches things nobody asked for. Hooks are what stop that, because they
fire on every message and every tool call, forever, at no cost to anyone's
memory.

A project running the kit with no hooks is running on good intentions.

## Two ways the hooks get wired

**Once per computer: the kit as a plugin.** The owner clones the kit into their
personal skills folder, `~/.claude/skills/projectos` (README, "Once per
computer"), and Claude Code reads it as a plugin from then on. Its one hook,
`hooks/dispatch.mjs` at the kit root, fires in every session and decides per
project: it looks for `project-os/Hooks-settings.json`, walking up from the
session's folder, and does nothing where that file is absent. Where it is
present, it prints the reminder text it finds in that file (as data, never
run) and runs the two guards from the plugin's own copy, with the project root
set to the project it found. No install step, no settings write, so no
environment can refuse it. It announces itself once per session with a line
beginning `[ProjectOS plugin] hooks active for`.

**Per project: the installer.** Where the plugin is not on the machine, the
assistant installs the hooks into the project's own settings, during the
install, without being asked. Installing the hooks is a step of the setup, not
a suggestion at the end of it. A kit whose enforcement layer waits for the
owner to notice a request is a kit that runs unenforced.

**Settings wiring wins.** When both exist, the plugin stands down for every
hook the project's own settings already carry, per event and per guard, so
nothing fires twice. A project can keep its own wiring forever; the plugin is
for the projects that have none.

The installer step is one command, run from the project root:

```
node project-os/Install-project-hooks.mjs
```

It merges the ready-made hooks in `project-os/Hooks-settings.json` into
`.claude/settings.local.json`, and it never overwrites.

**Hooks of the same kind run side by side.** That setting holds a LIST, so this
project's hooks are added beside whatever the project already had, and both
fire. Nothing existing is removed, reworded or reordered. Running it twice
changes nothing, because a hook already present is recognised.

Flags, all of them optional:

- `--dry` shows what it would do and writes nothing.
- `--shared` writes to `.claude/settings.json`, which is committed, so the whole
  team gets the hooks. Without it the hooks land in `.claude/settings.local.json`,
  which is personal to one machine and usually not committed, so a teammate
  cloning the repo gets none. Say which one you chose, out loud.
- `--replace` removes an event's existing hooks instead of running beside them.
  For a hook known to be broken, never as a default.

Both settings files are read before anything is judged missing, so a hook
already installed in the other one is never added twice.

**If the environment refuses that write**, some setups guard their own
configuration, do not argue with it and do not retry in a loop. Say plainly
that the write was refused, hand the owner that one command to run themselves,
and carry on. That is the fallback, never the plan.

**The owner's only step is a restart.** Hooks are read when a session starts,
so the newly installed ones take effect in the NEXT session, not this one. Say
that clearly, and give the one question that proves it worked: ask the
assistant what rules it was given this turn, and see whether it reads them
back.

If you would rather wire it by hand, the same content is in the block below.

## Level 1 — works in any project, needs no files

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
            "command": "node -e \"console.log('PROJECT RULES: read CLAUDE.md and the files in project-os before doing anything in this session. Conversations.md governs every reply you write. Workflow.md governs every task. Read them now, in full, if you have not.')\"",
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
            "command": "node -e \"console.log('STANDING RULES for this reply and this task: 1) Reply exactly as project-os/Conversations.md prescribes, layout and length included. 2) Change only what was asked, nothing else, however tempting. 3) Prefer the smallest safe change. 4) When something is unclear, or the decision belongs to the owner, ask instead of deciding. 5) After any completed change, add its History row. 6) Never write a file outside this project folder. 7) Never say a check passed unless it was actually run.')\"",
            "timeout": 10,
            "suppressOutput": true
          }
        ]
      }
    ]
  }
}
```

That block is exactly what `project-os/Hooks-settings.json` holds, and what
the command above installs.

**Edit the wording freely.** That second string is the shortest useful version
of your own rules; a project with different sore points should say different
things. Keep it to a few lines: this text is paid for on every message, and a
long block gets skimmed exactly like a long rule file.

**Keep it under roughly 10 KB.** Longer output is not inlined; it is written to
a file with a short preview, and the end of your text never reaches the model.
A hook that says too much says nothing.

## Level 2 — the guards, and they ship with the kit

These are the difference between a rule that is repeated and a rule that
cannot be broken. They live in `project-os/guards/`, they install with the same
command as level 1, and they are wired by absolute path: the installer replaces
`{{ROOT}}` in `Hooks-settings.json` with this project's real root, because a
hook runs from whatever folder the tool happens to be in and an environment
variable in the command is not expanded on every shell.

**The folder guard**, `guards/Path-guard.mjs`. Fires before every file write
and every shell command, and refuses anything aimed outside the project folder.
It reads the command, including redirections, writing programs, inline shells
and `cd` moves, and blocks what it cannot prove is inside. Without it, the rule
about staying inside the project is a sentence in a document, and stray files
land in the home folder and in the agent's own configuration. It runs on
Windows, macOS and Linux; the one exception it allows on its own is the
assistant's memory folder, markdown only. An `EXTRA_ROOTS` list at the top of
the file, empty by default, is where the owner names any other folder writes
may reach.

**The destructive-command guard**, `guards/Destructive-guard.mjs`. Fires before
every shell command and blocks the one-way operations: recursive or forced
deletes whose targets are not provably disposable, force pushes, history
rewrites, hard resets, branch deletes. Its job is the command nobody meant to
run. A dry-run flag passes; a delete inside `node_modules`, a build folder, the
OS temp folder or a `*.tmp` leftover passes; everything else stops with the
reason.

Both are the same shape: read the tool call from standard input, exit 0 to
allow, exit 2 with one line on standard error to block, and on any error of
their own exit 0. That last part is the law below, fail open.

**Not shipped yet: the reply linter.** It would check each reply against the
reply rules and correct the next one. It is a script of its own with a test
suite, and it has not been made generic yet, so the kit does not carry it.
Hooks.md says so here rather than pretending; a project that wants it writes it.

## The laws every hook here obeys

- **Fail open.** A hook that crashes, or cannot read what it needs, exits
  quietly and allows the action. A bug in a guard must never trap you inside
  your own project. The only thing a hook may block on purpose is the specific
  thing it exists to block.
- **A guard blocks, a linter warns.** Anything that changes the world gets
  stopped before it happens. Anything about style or wording gets corrected on
  the next message, never by forcing a redo.
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

  Every event under "present:" is installed. Any event under "will add:" is
  not, and the speaking and blocking checks below prove nothing about it.
  The one exception: when the session started with a line beginning
  `[ProjectOS plugin] hooks active for` and naming this project, the hooks
  come from the plugin, "will add" is expected, and nothing needs installing.
- **The plugin's guard, when the plugin is the wiring:** the announcing line
  names the plugin folder; feed the same fake tool call to its dispatcher from
  the project root, and expect the same blocking line and exit code 2:

  ```
  echo {"tool_name":"Bash","tool_input":{"command":"rm -rf src"},"cwd":"."} | node <plugin folder>/hooks/dispatch.mjs pretool
  ```
- **The session hook:** start a new session and ask the assistant what standing
  rules it was given this turn. It should quote them back.
- **A guard:** feed it one fake tool call and read the exit code, no real
  action needed. From the project root:

  ```
  echo {"tool_name":"Bash","tool_input":{"command":"rm -rf src"}} | node project-os/guards/Destructive-guard.mjs
  ```

  It should print one blocking line and exit with code 2. A guard that exits 0
  there is not installed, not this file, or broken, in that order of likelihood.
- **The linter:** after a reply that clearly breaks a rule, the next message
  should carry the correction.

If nothing happens, the usual causes are: the session was not restarted, the
JSON has a syntax error, or the command form does not survive your shell.

**Where the plugin does not reach, stated plainly.** A session run in the
cloud, a session whose setting sources exclude the personal folder, a managed
policy that disables personal plugins, or a project folder that lacks
`project-os/Hooks-settings.json` (a worktree that excludes it, a folder above
the project). In every one of those the per-project installer is the wiring,
and the announcing line is absent, which is how you know. The plugin's guards
also use the plugin copy's own settings, so an `EXTRA_ROOTS` list edited in a
project's copy of `Path-guard.mjs` applies only when that project's own wiring
is the one running.

## The trap that costs an afternoon

**Do not write a hook command as `echo` with single quotes around JSON.** It
works when commands run through a Unix-style shell, and produces mangled,
invalid output under the Windows command prompt, where those quotes survive as
literal characters. The hook still reports success. Nothing warns you. The
rules simply never arrive, and the assistant looks like it is ignoring a file
it was never shown.

The `node -e "console.log('...')"` form above is used instead because it
survives both shells unchanged. Inside that text use no apostrophes, since they
would close the string.
