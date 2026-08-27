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

## Who installs this

**You do, by hand, once per project.** The assistant is deliberately blocked
from editing agent configuration, so it can describe this setup and can never
apply it. That block is a good thing, and it means the paste below is yours.

The file that has to change is:

```
<your project>/.claude/settings.local.json
```

**One command does it**, run from the project root, by you:

```
node project-os/install-hooks.mjs
```

It merges the ready-made hooks in `project-os/hooks-settings.json` into that
file. It never overwrites: whatever is already there is kept, a backup is
written first, and an event that already has hooks is reported and left alone
unless you re-run it with `--force`. Add `--dry` to see what it would do and
change nothing.

If you would rather do it by hand, the same content is in the block below.

Hooks are read when a session starts, so **start a new session afterwards**.

## Level 1 — works in any project, needs no files

Paste this and you are done. It adds nothing to the repository, depends on no
script, and needs no path edited: `${CLAUDE_PROJECT_DIR}` is filled in by the
tool itself.

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
            "command": "node -e \"console.log('PROJECT RULES: read CLAUDE.md and the files in ${CLAUDE_PROJECT_DIR}/project-os before doing anything in this session. Conversations.md governs every reply you write. Workflow.md governs every task. Read them now, in full, if you have not.')\"",
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

That block is exactly what `project-os/hooks-settings.json` holds, and what
the command above installs.

**Edit the wording freely.** That second string is the shortest useful version
of your own rules; a project with different sore points should say different
things. Keep it to a few lines: this text is paid for on every message, and a
long block gets skimmed exactly like a long rule file.

**Keep it under roughly 10 KB.** Longer output is not inlined; it is written to
a file with a short preview, and the end of your text never reaches the model.
A hook that says too much says nothing.

## Level 2 — the guards, when a project earns them

These need a real script in the project, because they have to make decisions,
and they are the difference between a rule that is repeated and a rule that
cannot be broken.

**The folder guard.** Fires before every file write and every shell command,
and refuses anything aimed outside the project folder. It reads the command,
including redirections and inline shells, and blocks what it cannot prove is
inside. Without it, the rule about staying inside the project is a sentence in
a document, and stray files land in your home folder and in the agent's own
configuration.

**The destructive-command guard.** Fires before every shell command and blocks
recursive deletes and the other one-way operations, unless the target is
provably disposable. Its job is the command nobody meant to run.

**The reply linter.** Fires when the assistant finishes a reply, checks it
against your reply rules, and, on the next message, tells it exactly which line
broke which rule. It warns, it never blocks and never forces a rewrite: a
blocked reply has already been rendered, so a rewrite just shows you the same
answer twice.

They wire the same way as level 1, with the event and the script path:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|NotebookEdit|Bash|PowerShell",
        "hooks": [
          { "type": "command", "command": "node \"${CLAUDE_PROJECT_DIR}/scripts/path-guard.mjs\"" }
        ]
      },
      {
        "matcher": "Bash|PowerShell",
        "hooks": [
          { "type": "command", "command": "node \"${CLAUDE_PROJECT_DIR}/scripts/destructive-guard.mjs\"" }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "node \"${CLAUDE_PROJECT_DIR}/scripts/reply-linter.mjs\"" }
        ]
      }
    ]
  }
}
```

**The kit does not ship these scripts yet.** Level 1 is the whole of what this
file gives you with no files added. When a project needs the guards, they are
written into that project, and this section is the shape they wire into.

## The laws every hook here obeys

- **Fail open.** A hook that crashes, or cannot read what it needs, exits
  quietly and allows the action. A bug in a guard must never trap you inside
  your own project. The only thing a hook may block on purpose is the specific
  thing it exists to block.
- **A guard blocks, a linter warns.** Anything that changes the world gets
  stopped before it happens. Anything about style or wording gets corrected on
  the next message, never by forcing a redo.
- **The scripts live in this project.** Never point a hook at a copy sitting in
  another project on the same disk. Rename or move that project and this one
  silently loses its protection, and the two copies drift apart unnoticed.
- **Nothing secret goes in this file.** It holds paths and instructions. Keys,
  tokens and credentials live outside the repository.

## Checking that it actually works

A hook that is not firing looks exactly like a hook that is firing, so check it
once rather than assuming.

- **The session hook:** start a new session and ask the assistant what standing
  rules it was given this turn. It should quote them back.
- **A guard:** ask for something the guard forbids, in a way that is safe to be
  refused, and confirm you get the refusal rather than the action.
- **The linter:** after a reply that clearly breaks a rule, the next message
  should carry the correction.

If nothing happens, the usual causes are: the session was not restarted, the
JSON has a syntax error, or the command form does not survive your shell.

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
