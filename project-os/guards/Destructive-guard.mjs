// Destructive-guard.mjs - PreToolUse hook. Blocks destructive shell commands
// before the assistant runs them. Inspired by the rule packs of
// Dicklesworthstone/destructive_command_guard (dcg), reimplemented as a
// zero-dependency local script so there is nothing to install or maintain.
//
// Installed by `node project-os/Install-project-hooks.mjs`, which wires it as:
//   PreToolUse, matcher "Bash|PowerShell|Monitor",
//   command: node "<project root>/project-os/guards/Destructive-guard.mjs"
//
// The hook feeds this script a JSON payload on stdin ({ tool_name,
// tool_input: { command }, ... }). If the command matches a destructive
// pattern, the script exits 2 with the reason on stderr. Claude Code then
// blocks the tool call and hands the reason back to Claude. Anything else
// exits 0 (allow).
//
// Design (hardened 2026-07-11 after an external review):
//  - Fail OPEN: any error, unparsable payload, or missing command -> exit 0.
//    A guard bug must never trap the owner; this is a safety net, not a sandbox.
//  - Blocklist only, no default-deny: unrecognized commands run normally.
//  - STRUCTURAL parsing, not whole-command regex: commands are split into
//    quote-aware segments and tokens, so dangerous text inside quoted data
//    (echo/commit messages/greps) never triggers, and flags are evaluated as
//    sets (clustered short flags, long/short synonyms, any order). Inline
//    shells (`bash -c "..."`, `powershell -Command ...`, `cmd /c ...`, and
//    `cmd //c ...` as Git Bash passes it) are recursively scanned.
//  - The program is found the way the shell finds it: past `VAR=x`, past the
//    wrappers that run the command after them (sudo, env, nohup, command,
//    time, timeout, nice, xargs, exec and the rest of Path-guard's list, with
//    the values of their own flags), and past the words that open a block or a
//    condition (if, then, do, else, !, a bare `(`). A `{ ... }` block, bash or
//    PowerShell, starts a new command, so `if (Test-Path x) { Remove-Item x
//    -Recurse -Force }` is read like the plain delete it contains. That holds
//    for a bash function body (`f() { ... }`) and a group after time or while,
//    and for a compact PowerShell block (`try{...}`, `{git reset --hard}`).
//  - Inline scripts (`node -e`, `node -pe`, `python -c`, `python -Bc`,
//    `perl -le`, `ruby -e`) are found with this file's own list of switches
//    and read with the Path-guard.mjs that sits beside this file. If that file
//    is missing, older or broken, only this one check is skipped. A script fed
//    to an interpreter or a shell from a pipe, a here-document, a here-string
//    or a variable holding one is read the same way, and so is a script file
//    the same command wrote and then runs.
//  - Text blocks are text, never commands: a bash here-document, a PowerShell
//    here-string (@'...'@, @"..."@) and a PowerShell block comment (<# #>).
//    See splitSegments.
//  - The disk is read for three things, each failing open on any error:
//    whether a throwaway target reaches through a link (symlink or junction),
//    whether the word after `git checkout` names something on disk, and, by
//    asking git, whether a dotted word there is a branch or a tag.
//  - Disposable-delete containment: a recursive/forced delete is allowed ONLY
//    when every target is a STATIC path (no variables, substitution, `~`, or
//    unresolved traversal) that normalizes to inside one of the
//    DISPOSABLE_DIRS below (build output, dependencies, caches, the project's
//    .tmp/ scratch folder), inside the OS temp dir (os.tmpdir() or /tmp), or a
//    `*.tmp` atomic-write leftover. `backups/` is NOT disposable: it holds the
//    disaster-recovery ZIPs. Ambiguous targets block. In bash a brace list in a
//    target (`dist/{a,b}`) is expanded first, and every word it becomes is
//    judged; in PowerShell every item of a comma list (`a,b`) is. A `)` that
//    closes a subshell is not part of the path before it.
//
// What it blocks:
//  - git: reset --hard/--merge; clean -f/-x (without -n); checkout -f / `--` /
//    `.` / any checkout that names files or folders; non-staged or worktree
//    restore; switch -f/--discard-changes; push
//    --force/--force-with-lease/--mirror/--prune/-d/--delete/+refspec/:refspec;
//    branch -D / -d+-f; stash drop|clear; filter-branch/filter-repo; reflog
//    expire|delete; gc --prune=now; prune (without -n); rm -f/--force
//    (without --cached or -n); worktree remove --force
//  - deletes (bash rm incl. /bin/rm; PowerShell Remove-Item + aliases ri/rm/
//    del/erase/rd; cmd rd/rmdir/del/erase): any recursive or forced delete
//    whose targets are not all provably disposable. -WhatIf / dry-run passes.
//    A delete with a wildcard target, a PowerShell pipeline that ends in a
//    delete, and xargs running rm are judged the same way, flags or not. A
//    disposable target that reaches through a link into a folder that is not
//    disposable is refused.
//  - find with -delete, or with -exec/-execdir/-ok/-okdir running a delete
//    program: judged as a recursive delete of its start paths (`.` when none
//    is given), so `find node_modules -delete` passes and `find src -delete`
//    blocks.
//  - inline scripts: a delete call that always removes a whole folder
//    (rmtree, rm_rf, remove_tree) or is given recursive/force true must name a
//    disposable folder written out in full; every command the script hands to
//    a shell (execSync, os.system, subprocess with a shell) is checked by the
//    rules above, like a command typed at the prompt.
//  - the install's live probe: `echo projectos-live-probe` (or Write-Output,
//    Write-Host) as the first command is refused with one fixed line, so the
//    install can prove the guards are on without showing anyone a delete.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ALLOW = 0;
const BLOCK = 2;
const MAX_DEPTH = 5;

// ---------------------------------------------------------------------------
// Quote-aware splitting & tokenizing
// ---------------------------------------------------------------------------

// Split a command line into executable segments on unquoted ; | & and newlines
// (covers `;`, `|`, `||`, `&`, `&&`), and at the braces of a block.
//
// A `{ ... }` block (a bash group or function body, a PowerShell script block
// after if, try or ForEach-Object) holds commands of its own.
//
// In PowerShell a `{` opens a block when it follows a space, `(`, `)`, `;`, `|`
// or `&`, or when it is glued to try, catch, finally, else, elseif, do, begin,
// process, end, a dot or a -Parameter (`try{`, `.{`, `-ScriptBlock{`). After
// `$` or `@`, or as the empty `{}`, it is text: `${x}`, `@{...}`, git's
// `HEAD@{1}` and find's `{}` stay whole, since splitting those turned blocked
// git and Remove-Item commands into allowed ones. Every `{` is remembered, so a
// `}` ends the block its own `{` opened whatever comes before it:
// `{git reset --hard}` ends at the brace, not in a flag named `hard}`. A `}`
// with no `{` of its own ends a segment after a space or `;` (review 2026-09-25).
//
// In bash a `{` followed by a space opens a group only where a command can
// start: the start of a segment, after then, do, else, elif, if, while, until,
// time, coproc, `!` or `(`, after a word ending in `)` (a function header like
// `f()`, a case pattern like `dist)`), and after `function NAME` or
// `coproc NAME`. A `}` closes one only as the first word of a segment. Anywhere
// else a brace is part of the arguments: a literal word, or a brace list like
// `{src,lib}`, which the delete rules expand. Splitting there let
// `rm -rf dist {src,lib}` pass on its first, disposable target alone, and not
// splitting after `f()` or `time` hid the delete inside the group (review
// 2026-09-25). A word with a backslash, or with `$`, `<`, `>` or a glob sign
// before its `()`, is an argument, not a header, so `rm -rf dist/a\) { src }`
// keeps all its targets.
const BASH_GROUP_AFTER = /^(then|do|else|elif|if|while|until|time|coproc|!|\(|[^\\()]*\)|[^\\?*+@!()$<>]*\(\))$/;
// Any bare word, % or ? glued to a brace opens a block too: ForEach-Object{,
// %{ and ?{ are ordinary (review 2026-09-25). A word holding $ or @ never
// matches, so ${x}, @{...} and HEAD@{1} stay whole.
const PS_GLUED_BLOCK = /^([%?.]|[A-Za-z][\w-]*|-[A-Za-z][\w-]*)$/i;

// The escape character is the backtick in PowerShell and the backslash
// elsewhere. PowerShell reads a backslash as a plain path character, so
// "C:\x\" is a closed string there: reading its `\"` as an escaped quote
// swallowed the `;` after it, and everything behind it went unread (review
// 2026-09-25).
//
// A line that ends in the escape character goes on in the next line: bash drops
// the pair (also inside double quotes), PowerShell reads it as a space. Read as
// two commands, `Remove-Item -Path src` and `-Recurse -Force` each passed.
// Bash joins only a bare `\n`: before `\r\n` the backslash escapes the `\r`,
// and the newline still ends the command.
//
// Text blocks hold text, never commands and never quote marks (review
// 2026-10-02). Read character by character, an apostrophe inside one ("It's a
// note") opened a quote that ran on past the block and swallowed the commands
// after it, so a delete written there ran unread; and a line of a note that
// began with a command name was refused as if it ran. Each block now ends
// where its shell ends it:
//  - a bash here-document from the line after its `<<WORD` to the line that
//    holds WORD alone (tabs dropped first for `<<-`). A `<<` inside `(( ))` is
//    a shift, and `<<<` is a here-string, not a here-document.
//  - a PowerShell here-string from an `@'` or `@"` that ends its line to the
//    next line that starts with `'@` or `"@`.
//  - a PowerShell block comment from `<#` to `#>`.
// A here-document inside "$( )", the usual way a commit message is written
// (git commit -m "$(cat <<'EOF' ... EOF)"), is read the same way.
//
// The text of a here-string, and of a "$(cat <<'EOF' ... EOF)" that holds
// nothing else, stands in its word through a marker (MARK, its number in
// `texts`, MARK). expandMarkers() puts the text back once the word is
// tokenized, so the word reads exactly as the program receives it: `node -e
// @'...'@` hands node its script, and a commit message stays one piece of
// data. A here-document body goes with the segment that opened it, in `docs`,
// and analyze() reads it as a script only when the command reading it runs it
// (bash, python3 -, node -). To every other command it is data.
//
// Each segment is { text, pipe, docs, level }: `pipe` is true when a single
// `|` feeds it the output of the segment before, and `level` counts the `{ }`
// blocks it sits in.
const MARK = '\u0001';
const CAT_ONLY = /^\s*cat\s+<<-?[ \t]*\S+\s*$/;

function splitSegments(command, shell = 'bash', texts = []) {
  const segs = [];
  let cur = '';
  let q = null;
  const braces = []; // PowerShell: one entry per open `{`, true when it opened a block
  const esc = shell === 'powershell' ? '`' : '\\';
  let comment = false; // inside a # comment, which runs to the end of its line
  let pipe = false; // the segment being read takes the output of the one before
  let level = 0;
  let pending = []; // here-documents opened on this line; their bodies start on the next
  const docs = [];
  const push = () => {
    if (cur.trim()) {
      segs.push({ text: cur, pipe, docs: [], level });
      pipe = false;
    }
    cur = '';
  };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (comment) {
      if (ch !== '\n' && ch !== '\r') { cur += ch; continue; }
      comment = false;
    }
    if (ch === esc && shell === 'bash' && q !== "'" && command[i + 1] === '\n') { i++; continue; }
    if (ch === esc && shell === 'powershell' && !q) {
      const n = command[i + 1] === '\n' ? 1 : command[i + 1] === '\r' && command[i + 2] === '\n' ? 2 : 0;
      if (n) { cur += ' '; i += n; continue; }
    }
    if (q) {
      if (q === '"' && shell === 'bash' && ch === '$' && command[i + 1] === '(' && command[i + 2] !== '('
        && command.includes('<<', i)) {
        const sub = readSubstitution(command, i + 2);
        if (sub && sub.docs.length > 0) {
          if (sub.docs.length === 1 && CAT_ONLY.test(sub.text)) {
            texts.push(sub.docs[0].lines.join('\n').replace(/\n+$/, ''));
            cur += MARK + (texts.length - 1) + MARK;
          } else {
            cur += '$(' + sub.text + ')';
            for (const d of sub.docs) { d.owner = segs.length; docs.push(d); }
          }
          i = sub.end;
          continue;
        }
      }
      if (q === '"' && ch === esc) { cur += ch + (command[i + 1] ?? ''); i++; continue; }
      if (ch === q) q = null;
      cur += ch;
      continue;
    }
    if (shell === 'powershell' && ch === '<' && command[i + 1] === '#') {
      const end = command.indexOf('#>', i + 2);
      cur += ' ';
      i = end < 0 ? command.length : end + 1;
      continue;
    }
    if (shell === 'powershell' && ch === '@' && (command[i + 1] === "'" || command[i + 1] === '"')) {
      const here = readHereString(command, i);
      if (here) {
        texts.push(here.body);
        cur += "'" + MARK + (texts.length - 1) + MARK + "'";
        i = here.end - 1;
        continue;
      }
    }
    // A # that starts a word opens a comment: a quote or an escape inside it is
    // plain text, so an apostrophe in "# don't" or a trailing backtick cannot
    // swallow the next line (review 2026-09-26).
    if (ch === '#' && (i === 0 || /[\s;&|(]/.test(command[i - 1]))) { comment = true; cur += ch; continue; }
    if (shell === 'bash' && ch === '<' && command[i + 1] === '<') {
      if (command[i + 2] === '<') { cur += '<<<'; i += 2; continue; }
      const doc = heredocOpener(command, i, cur);
      if (doc) {
        doc.owner = segs.length;
        pending.push(doc);
        docs.push(doc);
        cur += command.slice(i, i + doc.len);
        i += doc.len - 1;
        continue;
      }
    }
    if (ch === "'" || ch === '"') { q = ch; cur += ch; continue; }
    if (ch === esc) { cur += ch + (command[i + 1] ?? ''); i++; continue; }
    const prev = i > 0 ? command[i - 1] : ' ';
    // `2>&1` is one redirection, not a command boundary: split at its `&`, the
    // targets after it were never judged (review 2026-09-28).
    if (ch === '&' && (prev === '>' || command[i + 1] === '>')) { cur += ch; continue; }
    let block = false;
    if (shell === 'bash') {
      const words = cur.trim().split(/\s+/);
      const atCommand = cur.trim() === '' || BASH_GROUP_AFTER.test(words[words.length - 1])
        || /^(function|coproc)$/.test(words[words.length - 2] ?? '');
      block = (ch === '{' && atCommand && /\s/.test(command[i + 1] ?? ''))
        || (ch === '}' && cur.trim() === '');
    } else if (ch === '{') {
      const word = cur.match(/[^\s();|&]*$/)[0];
      block = command[i + 1] !== '}' && (/[\s();|&]/.test(prev) || PS_GLUED_BLOCK.test(word));
      braces.push(block);
    } else if (ch === '}') {
      block = braces.length > 0 ? braces.pop() : /[\s;]/.test(prev);
    }
    if (ch === ';' || ch === '|' || ch === '&' || ch === '\n' || ch === '\r' || block) {
      const pipes = ch === '|' && prev !== '|' && command[i + 1] !== '|';
      push();
      if (block) level = ch === '{' ? level + 1 : Math.max(0, level - 1);
      if (pipes) {
        pipe = true;
        if (command[i + 1] === '&') i++; // bash `|&` pipes stderr as well
      } else if (ch !== '\n' && ch !== '\r') {
        pipe = false;
      }
      if (ch === '\n' && pending.length > 0) {
        i = readBodies(command, i + 1, pending) - 1;
        pending = [];
      }
      continue;
    }
    cur += ch;
  }
  push();
  for (const d of docs) if (segs[d.owner]) segs[d.owner].docs.push(d);
  return segs;
}

// A here-document opener at `i`: `<<` or `<<-`, then its delimiter word, with
// its quotes and backslashes taken out the way bash takes them out
// (`'EOF'`, `"EOF"`, `\EOF` and `E"O"F` all end at a line reading EOF).
// `before` is the command text up to it, which names the command that reads
// the body. Null for a `<<` inside `(( ))`, where it is a shift.
function heredocOpener(command, i, before) {
  if ((before.match(/\(\(/g) || []).length > (before.match(/\)\)/g) || []).length) return null;
  const m = /^<<(-?)[ \t]*/.exec(command.slice(i, i + 8));
  let k = i + m[0].length;
  let word = '';
  let q = null;
  for (; k < command.length && command[k] !== '\n'; k++) {
    const c = command[k];
    if (q) { if (c === q) q = null; else word += c; continue; }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === '\\') { word += command[k + 1] ?? ''; k++; continue; }
    if (/[\s;&|<>()`$]/.test(c)) break;
    word += c;
  }
  if (q || word === '') return null;
  const head = before.split(/\$\(|`|[;&|\n(]/).pop();
  return { delim: word, stripTabs: m[1] === '-', len: k - i, head, lines: [], owner: -1 };
}

// Read the bodies of the here-documents in `pending`, one after the other,
// from index j. Each ends at the line that holds its delimiter alone. Bash runs
// one that never closes to the end of the command, but a delimiter read wrong
// here would then hide every command after it, so the bodies are dropped and
// the lines are read as commands, the old way. Returns the index to go on from.
function readBodies(command, j, pending) {
  const from = j;
  for (const doc of pending) {
    let closed = false;
    while (j < command.length) {
      let e = command.indexOf('\n', j);
      if (e < 0) e = command.length;
      const line = command.slice(j, e).replace(/\r$/, '');
      j = e + 1;
      const probe = doc.stripTabs ? line.replace(/^\t+/, '') : line;
      if (probe.trim() === doc.delim) { closed = true; break; }
      doc.lines.push(probe);
    }
    if (!closed) {
      for (const d of pending) d.lines = [];
      return from;
    }
  }
  return Math.min(j, command.length);
}

// The `$( )` that starts at `start` (just after its `$(`), inside a double
// quote, read as the command it is: its own quotes, nested parentheses and
// here-documents. Returns { end, text, docs } with `end` at its closing `)`
// and the bodies left out of `text`, or null when it never closes. Only used
// when it holds a here-document; otherwise the old reading stands.
function readSubstitution(command, start) {
  let depth = 0;
  let q = null;
  let comment = false;
  let text = '';
  let pending = [];
  const docs = [];
  for (let i = start; i < command.length; i++) {
    const ch = command[i];
    if (comment) {
      if (ch !== '\n') { text += ch; continue; }
      comment = false;
    }
    if (q) {
      if (q === '"' && ch === '\\') { text += ch + (command[i + 1] ?? ''); i++; continue; }
      if (ch === q) q = null;
      text += ch;
      continue;
    }
    if (ch === '\\') { text += ch + (command[i + 1] ?? ''); i++; continue; }
    if (ch === '#' && (i === start || /[\s;&|(]/.test(command[i - 1]))) { comment = true; text += ch; continue; }
    if (ch === '<' && command[i + 1] === '<') {
      if (command[i + 2] === '<') { text += '<<<'; i += 2; continue; }
      const doc = heredocOpener(command, i, text);
      if (doc) {
        pending.push(doc);
        docs.push(doc);
        text += command.slice(i, i + doc.len);
        i += doc.len - 1;
        continue;
      }
    }
    if (ch === "'" || ch === '"') { q = ch; text += ch; continue; }
    if (ch === '\n' && pending.length > 0) {
      text += '\n';
      i = readBodies(command, i + 1, pending) - 1;
      pending = [];
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') {
      if (depth === 0) return { end: i, text, docs };
      depth--;
    }
    text += ch;
  }
  return null;
}

// A PowerShell here-string at `i`: `@'` or `@"` with nothing after it on its
// line, up to the next line that starts with the same quote and `@`. Leading
// spaces before the closer are allowed, which can only end the block sooner
// than PowerShell does, so its last lines would be read as commands, the old
// way. Null when the opener is not alone at the end of its line, or when no
// closer follows: PowerShell runs nothing it cannot parse, and the old reading
// of those lines can then hide nothing.
function readHereString(command, i) {
  const quote = command[i + 1];
  const eol = command.indexOf('\n', i + 2);
  if (eol < 0 || !/^[ \t\r]*$/.test(command.slice(i + 2, eol))) return null;
  const lines = [];
  let j = eol + 1;
  while (j < command.length) {
    let e = command.indexOf('\n', j);
    if (e < 0) e = command.length;
    const line = command.slice(j, e).replace(/\r$/, '');
    const close = /^[ \t]*/.exec(line)[0].length;
    if (line[close] === quote && line[close + 1] === '@') return { body: lines.join('\n'), end: j + close + 2 };
    lines.push(line);
    j = e + 1;
  }
  return null;
}

// Tokenize one segment into { text, quoted, lit } tokens. `quoted` records that a
// token was (even partly) inside quotes. `lit` has one mark per character of
// `text`: 0 when it was bare, q when it was inside quotes, e when a backslash
// escaped it; a brace list or a closing `)` only counts when bare. Backslash is
// an escape only under bash semantics; under PowerShell/unknown it is a path
// separator and stays literal.
//
// `quoted` is NOT a data marker: see isWord below. It used to be treated as one
// ("quoted tokens are DATA, never flags or subcommands"), which was the whole of
// finding B1 (review 2026-07-26): the shell strips quotes before the program
// sees its argv, so `git reset "--hard"` and `git reset --hard` are byte-identical
// to git, yet only the second was blocked. Every git rule and the bash `rm` rule
// were bypassable by quoting one flag.
function tokenize(segment, shell) {
  const bashEscapes = shell === 'bash';
  const tokens = [];
  let cur = '';
  let lit = '';
  let quoted = false;
  let has = false;
  let q = null;
  const push = () => {
    if (has) tokens.push({ text: cur, quoted, lit });
    cur = '';
    lit = '';
    quoted = false;
    has = false;
  };
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (q) {
      if (q === '"' && ch === '\\' && bashEscapes) {
        const n = segment[i + 1];
        if (n !== undefined) { cur += n; lit += 'e'; i++; }
        continue;
      }
      if (ch === q) { q = null; continue; }
      cur += ch;
      lit += 'q';
      continue;
    }
    if (ch === "'" || ch === '"') { q = ch; quoted = true; has = true; continue; }
    if (ch === '\\' && bashEscapes) {
      const n = segment[i + 1];
      if (n !== undefined) { cur += n; lit += 'e'; i++; has = true; }
      continue;
    }
    if (/\s/.test(ch)) { push(); continue; }
    cur += ch;
    lit += '0';
    has = true;
  }
  push();
  return tokens;
}

// Can this token act as a flag, a switch, or a subcommand? Decided on the token's
// TEXT, never on whether it was quoted. That is the B1 fix.
//
// What quoting still tells us is WORD-SPLITTING, and that is the property worth
// keeping: `git commit -m "reset --hard"` arrives as one token whose text is
// `reset --hard`, spaces included, and no real flag or subcommand ever contains
// whitespace. So the whitespace test is what keeps commit messages, grep patterns
// and prose out of the rules, while `"--hard"`, `'--hard'` and `--"hard"`, which
// all reach the program as exactly `--hard`, are read as the flag they are.
const isWord = (t) => t.text.length > 0 && !/\s/.test(t.text);

// ---------------------------------------------------------------------------
// Disposable-path containment
// ---------------------------------------------------------------------------

const OS_TMP = (os.tmpdir() || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

// Normalize a STATIC path: reject anything dynamic (variables, substitution,
// %VAR%, `~`, backticks), resolve `.`/`..` segments; return null when the path
// cannot be proven (traversal past its own root, dynamic content).
function staticNormalize(p) {
  if (/[$`]|%[^%\s]*%|^~|[\s]~[\\/]/.test(p)) return null;
  let s = p.replace(/\\/g, '/');
  const driveMatch = s.match(/^[A-Za-z]:/);
  const drive = driveMatch ? driveMatch[0].toLowerCase() : '';
  if (drive) s = s.slice(2);
  const abs = s.startsWith('/');
  const out = [];
  for (const part of s.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length === 0) return null; // escapes its own root: unprovable
      out.pop();
      continue;
    }
    out.push(part);
  }
  return { abs: abs || !!drive, drive, segs: out };
}

// Regenerable build/dependency dirs. The same list ships to every project that
// installs the kit (each runs its own copy under project-os/guards/, or the
// plugin's), so it has to cover the common stacks, not one project's: `.astro`
// for Astro, `.next` for Next.js, and the framework-agnostic rest. Only
// unambiguously GENERATED names belong here:
// `build` and `out` are deliberately absent, since either can be a real source
// directory, and a false "disposable" verdict is the one mistake this list must
// never make. A missing name only costs a needless block, which is the safe way
// to be wrong.
const DISPOSABLE_DIRS = new Set([
  'node_modules', 'dist', '.astro', '.next', '.turbo', '.vite', '.cache', '.svelte-kit', 'coverage',
  // The project's own scratch folder (CLAUDE.md rule 12, 2026-08-02). Added the
  // day it was introduced: it is where every temporary file now goes, so
  // refusing to clean it would have made the new folder a permanent junk drawer.
  // Unambiguously generated, gitignored, and nothing in it is a source of truth.
  '.tmp',
]);

function isDisposable(p) {
  const n = staticNormalize(p);
  if (!n || n.segs.length === 0) return false;
  const lower = n.segs.map((x) => x.toLowerCase());
  if (n.abs) {
    const full = n.drive + '/' + lower.join('/');
    if (OS_TMP && full.startsWith(OS_TMP + '/')) return true;
    if (full.startsWith('/tmp/')) return true;
  }
  // After normalization no `..` remains, so a disposable segment anywhere in
  // the path means the target sits inside (or is) that directory.
  if (lower.some((seg) => DISPOSABLE_DIRS.has(seg))) return true;
  if (/\.tmp(\.[^\\/]*)?$/i.test(lower[lower.length - 1])) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Links inside a disposable folder (review 2026-10-02)
// ---------------------------------------------------------------------------

// A disposable name says nothing about where a link (symlink or junction)
// inside it leads. Workspaces and `npm link` put links in node_modules that
// lead to real source folders, and `rm -rf node_modules/lib/` emptied the
// package's real folder while the guard called it throwaway. So before a
// disposable target passes, the disk is read from its disposable folder down,
// and what each delete was measured to do decides (Git Bash rm, PowerShell 5.1
// Remove-Item, cmd rd and del, Node rmSync, on a junction):
//  - the link itself, written without a trailing slash, is all that goes: rm,
//    Remove-Item, rd and rmSync remove the link and keep what it points to, so
//    it passes. cmd's del deletes the files inside instead, so for del the
//    folder it points to is judged.
//  - a trailing slash, a wildcard right after the link, or find starting at it
//    reaches into the folder it points to: refused outright.
//  - a link further up the path is followed: the real place is judged.
// A wildcard is matched against the folder, so `node_modules/*/dist` is
// judged for every name it can stand for (the first 512 names, and at most
// 2000 reads for one path, so a huge folder cannot stall the hook). Any error
// reading the disk passes: this check only ever adds a refusal, and never
// traps the owner.
const MAX_GLOB_NAMES = 512;
const MAX_DISK_READS = 2000;
let diskReads = 0;

// Git Bash spells C:\x as /c/x. Node on Windows reads that as a folder named
// c on the current drive, so it is turned back into the drive form first.
function diskPath(p) {
  if (process.platform === 'win32' && /^\/[A-Za-z](\/|$)/.test(p)) return `${p[1]}:/${p.slice(3)}`;
  return p;
}

// The index of the segment that made a static path disposable: the first
// segment inside a temp folder, the first disposable folder name, or a *.tmp
// file. The disk is read from there down. -1 when the path is not disposable.
function disposableAnchor(n) {
  const lower = n.segs.map((x) => x.toLowerCase());
  if (n.abs) {
    const full = n.drive + '/' + lower.join('/');
    if (OS_TMP && full.startsWith(OS_TMP + '/')) return OS_TMP.replace(/^[a-z]:/, '').split('/').filter(Boolean).length;
    if (full.startsWith('/tmp/')) return 1;
  }
  const k = lower.findIndex((seg) => DISPOSABLE_DIRS.has(seg));
  if (k >= 0) return k;
  return /\.tmp(\.[^\\/]*)?$/i.test(lower[lower.length - 1] ?? '') ? lower.length - 1 : -1;
}

// The link through which a delete of the disposable path `p` would reach a
// folder that is not disposable, or null. `how.through` is true when the
// delete enters the last part (a trailing slash, find, a listing of it), and
// `how.follows` when the program deletes what a link points to (cmd's del).
// Relative paths are read from every folder the command may be in.
function linkProblem(p, how, ctx, depth = 0) {
  if (!ctx || depth > 4) return null;
  if (depth === 0) diskReads = 0;
  try {
    const n = staticNormalize(p);
    if (!n) return null;
    if (n.abs && !n.drive && process.platform === 'win32' && /^[A-Za-z]$/.test(n.segs[0] ?? '')) {
      n.drive = `${n.segs[0]}:`;
      n.segs = n.segs.slice(1);
    }
    const anchor = disposableAnchor(n);
    if (anchor < 0 || anchor >= n.segs.length) return null;
    const bases = n.abs ? [`${n.drive}/`] : ctx.folders;
    for (const base of bases) {
      const found = walkLinks(path.join(base, ...n.segs.slice(0, anchor)), n.segs, anchor, how, ctx, depth);
      if (found) return found;
    }
  } catch {
    return null;
  }
  return null;
}

function walkLinks(cur, segs, k, how, ctx, depth) {
  for (; k < segs.length; k++) {
    if (++diskReads > MAX_DISK_READS) return null;
    const seg = segs[k];
    if (/[*?[]/.test(seg)) {
      let names;
      try {
        const re = globRegex(seg);
        names = fs.readdirSync(cur).filter((x) => re.test(x) && !/[*?[]/.test(x)).slice(0, MAX_GLOB_NAMES);
      } catch {
        return null;
      }
      for (const name of names) {
        const found = walkLinks(cur, [...segs.slice(0, k), name, ...segs.slice(k + 1)], k, how, ctx, depth);
        if (found) return found;
      }
      return null;
    }
    const next = path.join(cur, seg);
    let st;
    try {
      st = fs.lstatSync(next);
    } catch {
      return null; // nothing there, so nothing to reach through
    }
    if (st.isSymbolicLink()) {
      const last = k === segs.length - 1;
      if (last && !how.through) return how.follows ? judgeReal(next, [], how, ctx, depth) : null;
      if (last || /[*?[]/.test(segs[k + 1])) return next;
      return judgeReal(next, segs.slice(k + 1), how, ctx, depth);
    }
    cur = next;
  }
  return null;
}

// Judge where a link really leads, with the rest of the path after it.
function judgeReal(link, rest, how, ctx, depth) {
  let real;
  try {
    real = fs.realpathSync(link);
  } catch {
    return null; // a link to nothing reaches nothing
  }
  const full = [real.replace(/\\/g, '/'), ...rest].join('/');
  if (!isDisposable(full)) return link;
  return linkProblem(full, how, ctx, depth + 1) ? link : null;
}

// A shell wildcard as a regular expression: `*`, `?` and `[...]`.
function globRegex(seg) {
  let re = '';
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    const close = c === '[' ? seg.indexOf(']', i + 2) : -1;
    if (c === '*') re += '.*';
    else if (c === '?') re += '.';
    else if (close > 0) {
      re += '[' + seg.slice(i + 1, close).replace(/^!/, '^').replace(/\\/g, '\\\\') + ']';
      i = close;
    } else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, process.platform === 'win32' ? 'i' : '');
}

const LINK_NOTE = 'deleting through a link removes the real files it points to. Delete the link itself, with no trailing slash, or name the real folder';

// ---------------------------------------------------------------------------
// Bash brace lists and closing parens in delete targets
// ---------------------------------------------------------------------------

// Bash expands a bare brace list before the program runs: `rm -rf dist/{x,../src}`
// deletes dist/x and src, and `rm -rf node_modules/..{Z..a}` deletes
// node_modules/.. (a letter range from Z to a holds a backslash, which bash
// then drops). So a delete target is judged by every word it becomes (review
// 2026-09-25). The four functions below follow bash's own braces.c
// (brace_gobbler, valid_seqterm, expand_seqterm, brace_expand) and were checked
// against Git Bash 5.3 on 40,000 generated words. Where the two differ, the
// guard mostly judges a few words more. Bash made 3 words the guard did not,
// all around empty quotes ('') or a quote right after a range, and none of
// them held a `/` or `..` the guard's words lacked. More than MAX_BRACE_WORDS
// words, or a range too long to list, counts as unprovable. A word holding `$`
// or a backtick is left whole: it is unprovable either way.
const MAX_BRACE_WORDS = 256;

// The index of the first bare `want` at nesting level 0 from i (-1 when there
// is none), and what made it a list: ',' or '..'. A `}` only closes once a `,`
// or a `..` came first, and a `{}` that starts the text is not a list.
function braceScan(t, l, i, want) {
  let level = 0;
  let kind = '';
  for (; i < t.length; i++) {
    if (l[i] !== '0') continue;
    const c = t[i];
    if (c === want && level === 0 && (want !== '}' || kind)) {
      if (c === '{' && (i === 0 || (/\s/.test(t[i - 1]) && l[i - 1] === 'e')) && t[i + 1] === '}' && l[i + 1] === '0') continue;
      return [i, kind];
    }
    if (c === '{') level++;
    else if (c === '}' && level) level--;
    else if (want === '}' && level === 0 && c === ',') kind = ',';
    else if (want === '}' && level === 0 && !kind && t.startsWith('..', i) && l[i + 1] === '0'
      && !(t[i + 2] === '}' && l[i + 2] === '0')) kind = '..';
  }
  return [-1, kind];
}

// Bash's quick look at `{x..y}`: when this fails, the `{` is plain text and
// the search for a list goes on inside it.
function rangeLooksValid(a) {
  const k = a.indexOf('..');
  const rhs = a.slice(k + 2) + '}';
  const kind = (s, next) => (/^[+-]?\d/.test(s) ? 'int' : new RegExp(`^[A-Za-z][${next}]`).test(s) ? 'char' : '');
  return k > 0 && rhs[0] !== '}' && kind(a, '.') !== '' && kind(a, '.') === kind(rhs, '.}');
}

// The words of `{1..10}`, `{01..9..2}` or `{a..e}`, or null when it is not a range.
function braceRange(a) {
  const m = a.match(/^([+-]?\d+|[A-Za-z])\.\.([+-]?\d+|[A-Za-z])(?:\.\.([+-]?\d+))?$/);
  if (!m) return null;
  const [, x, y, step] = m;
  const isInt = /\d/.test(x);
  if (isInt !== /\d/.test(y)) return null;
  if (x.length > 15 || y.length > 15 || (step && step.length > 15)) throw new RangeError('brace');
  const from = isInt ? Number(x) : x.charCodeAt(0);
  const to = isInt ? Number(y) : y.charCodeAt(0);
  let inc = Math.abs(Number(step || 1)) || 1;
  if (Math.abs(to - from) / inc + 1 > MAX_BRACE_WORDS) throw new RangeError('brace');
  if (from > to) inc = -inc;
  const width = isInt && [x, y].some((s) => /^-?0\d/.test(s)) ? Math.max(x.length, y.length) : 0;
  const out = [];
  for (let n = from; inc > 0 ? n <= to : n >= to; n += inc) {
    let s = isInt ? String(Math.abs(n)).padStart(width - (n < 0 ? 1 : 0), '0') : String.fromCharCode(n);
    if (isInt && n < 0) s = '-' + s;
    // A backslash from a range is dropped, or kept when an escaped character
    // follows it: both readings are judged.
    if (s === '\\') out.push(['', '']);
    out.push([s, s === '\\' ? 'e' : '0'.repeat(s.length)]);
  }
  return out;
}

// Every [text, lit] word that the word t (marks l) becomes, the way bash
// expands it. The search for a list starts at `from`.
function braceWords(t, l, from = 0) {
  let open = from;
  let close;
  let kind;
  let alt = [];
  for (;;) {
    [open] = braceScan(t, l, open, '{');
    if (open < 0) return [[t, l]];
    [close, kind] = braceScan(t, l, open + 1, '}');
    if (close >= 0 && kind === '..' && /[^0]/.test(l.slice(open + 1, close))) {
      alt = braceWords(t, l, open + 1); // quotes inside a range: judge both readings
      break;
    }
    if (close >= 0 && (kind === ',' || rangeLooksValid(t.slice(open + 1, close)))) break;
    open++;
  }
  const amble = t.slice(open + 1, close);
  const al = l.slice(open + 1, close);
  let tack = [];
  if (kind === ',') {
    for (let s = 0, e; s <= amble.length; s = e + 1) {
      [e] = braceScan(amble, al, s, ',');
      if (e < 0) e = amble.length;
      tack.push(...braceWords(amble.slice(s, e), al.slice(s, e)));
      if (tack.length > MAX_BRACE_WORDS) throw new RangeError('brace');
    }
  } else {
    tack = /^0*$/.test(al) ? braceRange(amble) : null;
    if (!tack) {
      if (close + 1 >= t.length) return [[t, l], ...alt];
      tack = [[t.slice(open, close + 1), l.slice(open, close + 1)]];
    }
  }
  const post = close + 1 < t.length ? braceWords(t.slice(close + 1), l.slice(close + 1)) : [['', '']];
  if (tack.length * post.length + alt.length > MAX_BRACE_WORDS) throw new RangeError('brace');
  const out = [];
  for (const [a, al2] of tack) for (const [p, pl] of post) out.push([t.slice(0, open) + a + p, l.slice(0, open) + al2 + pl]);
  return [...out, ...alt];
}

// The words a bash word becomes, or null when there are too many to judge.
function braceExpand(text, lit) {
  if (/[$`]/.test(text)) return [text];
  try {
    return braceWords(text, lit).map(([w]) => w);
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
}

// A bare `)` that closes a subshell or a `( )` group ends the word before it:
// `(rm -rf node_modules)` deletes node_modules. It is taken off only while the
// word has more `)` than `(`, so `dist/a(b)` keeps its own (review 2026-09-25).
function dropClosingParen(t) {
  let { text, lit } = t;
  while (text.endsWith(')') && lit.endsWith('0') && text.split(')').length > text.split('(').length) {
    text = text.slice(0, -1);
    lit = lit.slice(0, -1);
  }
  return { ...t, text, lit };
}

// PowerShell reads `a,b` as a list of two paths, so each item is judged on its
// own: `node_modules,dist` is two disposable folders, and `.tmp/a,src` deletes
// src (review 2026-09-25). A comma inside quotes is part of the name, and an
// empty item (`node_modules, dist` leaves one) is dropped. In bash `a,b` is one
// name, so bash words are never split here.
function commaItems(t) {
  const out = [];
  let from = 0;
  for (let i = 0; i <= t.text.length; i++) {
    if (i < t.text.length && !(t.text[i] === ',' && t.lit[i] === '0')) continue;
    if (i > from) out.push(t.text.slice(from, i));
    from = i + 1;
  }
  return out;
}

// The paths that target tokens name: in bash each word as it expands, in
// PowerShell each item of a comma list, in the other shells as written. Null
// when a word expands to too many to judge.
function targetPaths(tokens, shell) {
  const paths = [];
  for (const t of tokens) {
    const words = shell === 'bash' ? braceExpand(t.text, t.lit) : shell === 'powershell' ? commaItems(t) : [t.text];
    if (!words) return null;
    paths.push(...words);
  }
  return paths;
}

// ---------------------------------------------------------------------------
// Git rules (structural)
// ---------------------------------------------------------------------------

// Parse the tokens after `git` into { sub, flagsLong, flagsShort, raw, pos }.
function parseGit(tokens) {
  let i = 0;
  const dirs = []; // each `-C <path>`, which moves git before it reads a path
  // skip global options (git -C <path> -c <k=v> --paginate ... <subcommand>).
  // The long ones that take a separate value skip it too: read alone, the `.`
  // of `git --work-tree . reset --hard` was taken for the subcommand and the
  // reset passed (review 2026-09-25).
  while (i < tokens.length) {
    const t = tokens[i];
    if (!isWord(t)) break;
    if (/^(-[Cc]|--(git-dir|work-tree|namespace|config-env|attr-source))$/.test(t.text)) {
      if (t.text === '-C' && tokens[i + 1]) dirs.push(tokens[i + 1].text);
      i += 2;
      continue;
    }
    if (/^-/.test(t.text)) { i++; continue; }
    break;
  }
  const subTok = tokens[i];
  if (!subTok || !isWord(subTok)) return null;
  const sub = subTok.text.toLowerCase();
  const flagsLong = new Set();
  const flagsShort = new Set(); // case-sensitive: -d vs -D matter
  const raw = [];
  const pos = [];
  let afterDashDash = false;
  for (const t of tokens.slice(i + 1)) {
    if (afterDashDash || !isWord(t)) { pos.push(t.text); continue; }
    if (t.text === '--') { afterDashDash = true; pos.push('--'); continue; }
    if (/^--./.test(t.text)) {
      raw.push(t.text.toLowerCase());
      flagsLong.add(t.text.slice(2).split('=')[0].toLowerCase());
      continue;
    }
    if (/^-./.test(t.text)) {
      for (const c of t.text.slice(1)) flagsShort.add(c);
      continue;
    }
    pos.push(t.text);
  }
  return { sub, flagsLong, flagsShort, raw, pos, dirs };
}

// A checkout that names files or folders overwrites them from the index or a
// commit, as `git restore` does, and their unsaved edits are gone with no copy
// anywhere. Only `--` and a lone `.` used to count, so `git checkout ./`,
// `:/`, `HEAD src/a.txt`, `src/` and `--pathspec-from-file=list.txt` all
// discarded edits unseen (measured in a throwaway repo, review 2026-10-02).
// A plain switch to a branch still passes, `feature/login` included. A word
// is read as a path, in this order, when:
//  - it has a spelling no branch can have (git's check-ref-format rules): a
//    leading `/`, `\` or `:`, a trailing slash, a `:`, `\`, `*`, `?` or `[`,
//    or a part that starts with a dot (`./`, `..`, `.github`);
//  - it names something on disk, from the working folder or the folder an
//    earlier `cd` or a `git -C` moved to;
//  - it has a dot and git does not know it as a branch or a tag. That one asks
//    git (`show-ref`, which matches remote branches too), and if git cannot be
//    asked, the word passes, as it did before.
// Revision words (`HEAD~1`, `main@{1}`, `-`) are switches, and a word built at
// runtime (`"$branch"`) passes as before, since it cannot be read. Two or more
// words are a commit and then names, unless -b, -B, --orphan, --detach or
// --track makes the command a branch operation, which takes no paths. A
// `$( ... )` split over several words counts as the one word it becomes.
function checkoutNamesPaths(g, ctx) {
  const { flagsLong, flagsShort, dirs } = g;
  if (flagsLong.has('pathspec-from-file')) return true;
  if (flagsShort.has('b') || flagsShort.has('B') || flagsShort.has('t')
    || ['orphan', 'detach', 'track'].some((f) => flagsLong.has(f))) return false;
  const pos = [];
  for (let k = 0; k < g.pos.length; k++) {
    let w = g.pos[k];
    const open = (s) => (s.match(/\$\(/g) || []).length - (s.match(/\)/g) || []).length;
    while (open(w) > 0 && k + 1 < g.pos.length) w += ' ' + g.pos[++k];
    pos.push(w);
  }
  if (pos.length >= 2) return true;
  if (pos.length === 0) return false;
  const name = pos[0];
  if (name === '-' || name === '@') return false;
  if (/^[\\/:]|[\\/]$|[*?[\\:]|(^|\/)\./.test(name)) return true;
  if (/[$`]/.test(name)) return false;
  const folders = gitFolders(dirs, ctx);
  if (folders.some((d) => onDisk(path.resolve(d, diskPath(name))))) return true;
  if (/[~^]|@\{/.test(name)) return false;
  return name.includes('.') && !gitKnowsRef(name, folders[0]);
}

// The folders a git command reads relative paths from: each folder the
// command may be in, moved by every `-C`. None when a `-C` cannot be read.
function gitFolders(dirs, ctx) {
  let folders = ctx ? ctx.folders : [];
  for (const d of dirs) {
    if (/[$`%~]/.test(d)) return [];
    folders = folders.map((f) => path.resolve(f, diskPath(d)));
  }
  return folders;
}

function onDisk(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

// Does git know `name` as a branch, tag or remote branch here? True also when
// git cannot be asked (not installed, not a repository, too slow): this check
// only ever adds a refusal.
function gitKnowsRef(name, dir) {
  try {
    const r = spawnSync('git', ['show-ref', '--quiet', '--', name], {
      cwd: dir, stdio: 'ignore', timeout: 3000, windowsHide: true,
    });
    return Boolean(r.error) || r.status !== 1;
  } catch {
    return true;
  }
}

function checkGit(tokens, ctx = null) {
  const g = parseGit(tokens);
  if (!g) return null;
  const { sub, flagsLong, flagsShort, raw, pos } = g;
  const has = (long, short) => flagsLong.has(long) || (short !== null && flagsShort.has(short));

  switch (sub) {
    case 'reset':
      if (flagsLong.has('hard') || flagsLong.has('merge'))
        return 'git reset --hard/--merge discards uncommitted work (content lives in the working tree)';
      return null;
    case 'clean':
      if ((has('force', 'f') || flagsShort.has('x') || flagsShort.has('X')) && !has('dry-run', 'n'))
        return 'git clean -f/-x deletes untracked files (add -n for a dry run)';
      return null;
    case 'checkout':
      if (has('force', 'f') || pos.includes('--') || pos.includes('.'))
        return 'git checkout -f / -- / . discards working-tree changes';
      if (checkoutNamesPaths(g, ctx))
        return 'git checkout with a file or folder name discards working-tree changes to it (to switch branches, git switch <branch>)';
      return null;
    case 'restore': {
      const staged = has('staged', 'S');
      const worktree = has('worktree', 'W');
      if (!staged || worktree)
        return 'git restore touching the worktree discards working-tree changes (only --staged/-S alone is safe)';
      return null;
    }
    case 'switch':
      if (has('force', 'f') || flagsLong.has('discard-changes'))
        return 'git switch -f/--discard-changes discards working-tree changes';
      return null;
    case 'push':
      if (has('force', 'f') || flagsLong.has('force-with-lease') || flagsLong.has('force-if-includes'))
        return 'force push rewrites remote history';
      if (has('delete', 'd') || flagsLong.has('mirror') || flagsLong.has('prune'))
        return 'push --delete/--mirror/--prune removes remote refs';
      if (pos.some((p) => /^\+/.test(p) || /^:.+/.test(p)))
        return 'push with a +refspec or :refspec force-updates or deletes remote refs';
      return null;
    case 'branch':
      if (flagsShort.has('D') || (has('delete', 'd') && has('force', 'f')))
        return 'git branch -D force-deletes a branch';
      return null;
    case 'stash':
      if (pos[0] === 'drop' || pos[0] === 'clear')
        return 'git stash drop/clear destroys stashed work';
      return null;
    // Without -f git refuses to remove a file whose changes are not committed;
    // with it they are gone. --cached leaves the working tree alone, and -n
    // only lists (review 2026-09-25).
    case 'rm':
      if (has('force', 'f') && !flagsLong.has('cached') && !has('dry-run', 'n'))
        return 'git rm -f removes files with uncommitted changes (without -f git refuses)';
      return null;
    case 'worktree':
      if (pos[0] === 'remove' && has('force', 'f'))
        return "git worktree remove --force deletes that worktree's uncommitted and untracked files";
      return null;
    case 'filter-branch':
    case 'filter-repo':
      return 'git history rewrite';
    case 'reflog':
      if (pos[0] === 'expire' || pos[0] === 'delete')
        return 'reflog expire/delete destroys recovery points';
      return null;
    case 'gc':
      if (raw.some((r) => r.startsWith('--prune=now')))
        return 'gc --prune=now destroys recovery points';
      return null;
    case 'prune':
      if (!has('dry-run', 'n'))
        return 'git prune destroys unreachable objects (recovery points)';
      return null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Delete rules (bash rm, PowerShell Remove-Item + aliases, cmd rd/del/erase)
// ---------------------------------------------------------------------------

const DELETE_PROGRAMS = new Set(['rm', 'remove-item', 'ri', 'del', 'erase', 'rd', 'rmdir']);

// Remove-Item parameters, for PowerShell prefix-abbreviation matching
// (-Rec -> Recurse). A prefix must be unambiguous to bind.
const PS_PARAMS = ['recurse', 'force', 'whatif', 'confirm', 'path', 'literalpath', 'filter', 'include', 'exclude', 'credential'];
function psParam(word) {
  const w = word.toLowerCase();
  const hits = PS_PARAMS.filter((p) => p.startsWith(w));
  return hits.length === 1 ? hits[0] : null;
}

// PowerShell's common parameters, which every cmdlet takes: the same two lists
// as in Path-guard.mjs, copied because that file is optional here. Read as a
// cluster of short flags, the `r` of -ErrorAction made any delete recursive and
// its value (`SilentlyContinue`, `0`) became a target, so the usual quiet
// cleanup of a build folder was refused (review 2026-09-25). A value name skips
// the next word too, unless the value is glued on with `:`.
const PS_COMMON_VALUE = /^(erroraction|ea|warningaction|wa|informationaction|infa|progressaction|proga|errorvariable|ev|warningvariable|wv|informationvariable|iv|outvariable|ov|outbuffer|ob|pipelinevariable|pv)$/i;
const PS_COMMON_SWITCH = /^(verbose|vb|debug|db)$/i;

// A redirection among a delete's arguments: `2>/dev/null`, `>log.txt`,
// `2>&1`, or the operator alone with its file in the next word. Read as a
// target it refused the usual quiet cleanup of a build folder, `rm -rf
// node_modules 2>/dev/null` (review 2026-09-28).
const REDIRECT = /^(\d*>>?|&>>?|>\||<)(.*)$/;

// A wildcard in a delete target: one word that stands for many files. In bash
// only a bare one counts, since quotes make it a plain character; PowerShell
// expands `*`, `?` and `[...]` in -Path quoted or not, and cmd expands `*` and
// `?` (review 2026-10-02).
function hasWildcard(t, shell) {
  for (let k = 0; k < t.text.length; k++) {
    if (shell === 'bash' && t.lit[k] !== '0') continue;
    const c = t.text[k];
    if (c === '*' || c === '?') return true;
    if (c === '[' && shell !== 'other' && t.text.indexOf(']', k + 2) > k) return true;
  }
  return false;
}

// A delete is judged like a recursive one, flags or not, when it can remove
// many files in one go (review 2026-10-02): a wildcard target, a PowerShell
// pipeline that ends in a delete, or xargs handing it names. Only the
// recursive and forced forms used to count, so `rm src/content/*.yaml`,
// `Get-ChildItem src -Recurse -File | Remove-Item` and `find src | xargs rm`
// passed while `find src -delete` was refused for the same effect. `feed` is
// set for the last two: { via, names, through, repl }, where `names` is null
// when the source cannot be read.
function checkDelete(program, tokens, shell, ctx = null, feed = null) {
  let recursive = false;
  let force = false;
  let dryRun = false;
  let literal = false; // -LiteralPath: PowerShell reads no wildcard in it
  const targets = [];
  let afterDashDash = false;
  for (let k = 0; k < tokens.length; k++) {
    const t = dropClosingParen(tokens[k]);
    const x = t.text;
    const redirect = isWord(t) && t.lit[0] === '0' ? REDIRECT.exec(x) : null;
    if (redirect) {
      if (redirect[2] === '') k++; // the file is the next word
      continue;
    }
    if (isWord(t) && !afterDashDash) {
      if (x === '--') { afterDashDash = true; continue; }
      const common = shell === 'powershell' ? x.match(/^-([A-Za-z]+)(:.*)?$/) : null;
      if (common && PS_COMMON_SWITCH.test(common[1])) continue;
      if (common && PS_COMMON_VALUE.test(common[1])) {
        if (common[2] === undefined) k++;
        continue;
      }
      if (/^--./.test(x)) {
        const name = x.slice(2).toLowerCase();
        if (name === 'recursive') recursive = true;
        else if (name === 'force') force = true;
        continue;
      }
      if (/^-./.test(x)) {
        const word = x.slice(1);
        if (shell === 'powershell' && /^(lp|pspath)$/i.test(word)) { literal = true; continue; }
        const param = /^[A-Za-z]+$/.test(word) ? psParam(word) : null;
        if (param) {
          if (param === 'recurse') recursive = true;
          else if (param === 'force') force = true;
          else if (param === 'whatif' || param === 'confirm') dryRun = true;
          else if (param === 'literalpath') literal = true;
          continue;
        }
        // bash-style short-flag cluster (-rf)
        for (const c of word) {
          if (c === 'r' || c === 'R') recursive = true;
          else if (c === 'f') force = true;
        }
        continue;
      }
      // cmd switches: `/s`, or `//s` as Git Bash passes it (a single `/s`
      // would be turned into a path there).
      if (/^\/\/?[a-zA-Z]$/.test(x)) {
        const sw = x[x.length - 1].toLowerCase();
        if (sw === 's') recursive = true;
        else if (sw === 'f' || sw === 'q') force = true;
        continue;
      }
    }
    targets.push(t);
  }
  if (dryRun) return null;
  const wild = !literal && targets.some((t) => hasWildcard(t, shell));
  const fed = feed && (feed.via === 'xargs' || targets.length === 0) ? feed : null;
  if (!recursive && !force && !wild && !fed) return null;
  const what = recursive || force ? 'recursive/forced delete' : wild ? 'delete with a wildcard' : `delete fed by ${fed.via}`;
  const allowed = `allowed only for static paths inside ${[...DISPOSABLE_DIRS].join('/')}, the OS temp dir, or *.tmp files`;
  const refusal = `${program}: ${what} on a non-disposable or unprovable path (${allowed})`;
  let paths = targetPaths(targets, shell);
  if (!paths) return refusal;
  // The written targets of a recursive or forced delete are judged first, as
  // they always were: with none, or with one that is not disposable, it is
  // refused even when every name fed in is disposable. The names fed in can
  // only add a refusal, never lift one.
  if ((recursive || force) && (paths.length === 0 || !paths.every(isDisposable))) return refusal;
  let through = paths.map((p) => /[\\/]$/.test(p));
  if (fed) {
    if (!fed.names) {
      return `${program}: ${what} takes names from a source that cannot be read, so they are non-disposable or unprovable (${allowed})`;
    }
    // With a placeholder (`xargs -I {}`), each word holding it becomes one word
    // per name read; without one, the names go after the written words.
    const out = [];
    const thr = [];
    paths.forEach((p, k) => {
      if (!fed.repl || !p.includes(fed.repl)) { out.push(p); thr.push(through[k]); return; }
      for (const n of fed.names) { out.push(p.split(fed.repl).join(n)); thr.push(fed.through); }
    });
    if (!fed.repl) for (const n of fed.names) { out.push(n); thr.push(fed.through); }
    paths = out;
    through = thr;
  }
  if (paths.length === 0 || !paths.every(isDisposable)) return refusal;
  const follows = shell === 'other' && (program === 'del' || program === 'erase');
  for (let k = 0; k < paths.length; k++) {
    const link = linkProblem(paths[k], { through: through[k], follows }, ctx);
    if (link) return `${program}: ${what} reaches through the link ${link} into a folder that is not provably disposable; ${LINK_NOTE}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Finding the program: wrappers, shell keywords, find
// ---------------------------------------------------------------------------

const BASH_SHELLS = new Set(['bash', 'sh', 'zsh', 'dash']);
const PS_SHELLS = new Set(['powershell', 'pwsh']);

function programName(token) {
  return token.text.replace(/^[({\s]+/, '').split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase();
}

// Programs that run the command written after them: Path-guard's list plus
// `exec`. `env rm -rf src` deletes exactly what `rm -rf src` does.
const WRAPPERS = new Set(['sudo', 'doas', 'env', 'nohup', 'command', 'time', 'timeout', 'stdbuf', 'nice', 'ionice', 'xargs', 'exec']);
// Wrapper flags whose value is the next word (`xargs -I {}`, `timeout -s KILL`,
// `env -u NAME`, `sudo -u root`): that word is not the program.
const WRAPPER_VALUE_FLAGS = {
  xargs: /^-[IndPLEsa]$/, env: /^-[uCS]$/, timeout: /^-[sk]$/, nice: /^-n$/,
  ionice: /^-[cnp]$/, stdbuf: /^-[ioe]$/, sudo: /^-[ugCDpRrtTU]$/, doas: /^-[uC]$/,
};
// Words that open a block or a condition; the command comes after them. A lone
// `{` is a group the splitter could not see, as in `time -p { rm -rf src; }`,
// and a lone `.` is PowerShell's dot-source operator (or the bash `source`
// dot), which runs the command after it (review 2026-09-28).
const SHELL_KEYWORDS = /^(then|do|else|elif|if|while|until|!|\{|\(+|\.)$/;

// Index of the real program in a segment: past `VAR=x`, shell keywords and
// wrappers with their flags (and `timeout 5` / `nice 10`). -1 when none.
function programIndex(tokens) {
  let i = 0;
  for (let hops = 0; hops < 8 && i < tokens.length; hops++) {
    while (i < tokens.length && isWord(tokens[i])
      && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i].text) || SHELL_KEYWORDS.test(tokens[i].text))) i++;
    if (i >= tokens.length) return -1;
    const w = programName(tokens[i]);
    if (!WRAPPERS.has(w)) return i;
    i++;
    while (i < tokens.length && isWord(tokens[i]) && /^-/.test(tokens[i].text)) {
      i += WRAPPER_VALUE_FLAGS[w] && WRAPPER_VALUE_FLAGS[w].test(tokens[i].text) ? 2 : 1;
    }
    if ((w === 'timeout' || w === 'nice') && i < tokens.length && /^\d+(\.\d+)?[smhd]?$/.test(tokens[i].text)) i++;
  }
  return i < tokens.length ? i : -1;
}

// find's start paths and the index of the first word after them.
function findStarts(tokens) {
  let k = 0;
  // Options written before the start paths: -H, -L, -P, -O3, -D <debug opts>.
  while (k < tokens.length && /^-([HLP]|O\d*|D)$/.test(tokens[k].text)) k += tokens[k].text === '-D' ? 2 : 1;
  const starts = [];
  while (k < tokens.length && !/^[-(!]/.test(tokens[k].text)) starts.push(tokens[k++]);
  return { starts, k };
}

// `find <start paths> ... -delete`, or `-exec rm ...`, deletes what it finds
// under its start paths at any depth: judged like `rm -rf <start paths>`.
function checkFind(tokens, shell, ctx = null) {
  const found = findStarts(tokens);
  const { starts } = found;
  let { k } = found;
  let deletes = false;
  for (; k < tokens.length; k++) {
    const x = tokens[k].text;
    if (x === '-delete') deletes = true;
    if (/^-(exec|execdir|ok|okdir)$/.test(x)) {
      const p = programIndex(tokens.slice(k + 1));
      if (p >= 0 && DELETE_PROGRAMS.has(programName(tokens[k + 1 + p]))) deletes = true;
    }
  }
  if (!deletes) return null;
  const paths = starts.length > 0 ? targetPaths(starts, shell) : ['.'];
  if (!paths || !paths.every(isDisposable)) {
    return `find -delete / -exec rm on a non-disposable or unprovable path (allowed only for static paths inside ${[...DISPOSABLE_DIRS].join('/')}, the OS temp dir, or *.tmp files)`;
  }
  // find starts inside each start path, so a link there is reached through.
  for (const p of paths) {
    const link = linkProblem(p, { through: true }, ctx);
    if (link) return `find -delete / -exec rm reaches through the link ${link} into a folder that is not provably disposable; ${LINK_NOTE}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Inline scripts (`node -e`, `python -c`, `perl -e` ...)
// ---------------------------------------------------------------------------

// Read with the Path-guard.mjs beside this file, which already finds the calls
// in a script and the commands it hands to a shell. It is kept only when every
// helper used here is there, so a missing, older or broken Path-guard skips
// this one check and leaves every rule above working.
let PG = null;
try {
  const m = await import('./Path-guard.mjs');
  const helpers = ['maskStrings', 'callArgs', 'destShape', 'receiverBefore', 'spawnedCommands'];
  if (m.SCRIPT_SPAWN_CALLS instanceof RegExp && helpers.every((h) => typeof m[h] === 'function')) PG = m;
} catch {
  PG = null;
}

// The interpreters that take a script in an argument or on stdin, with this
// file's own reading of their switches. It used to borrow Path-guard's list,
// which knew only the plain switches, so `node -pe`, `node --eval=...`,
// `python -Bc`, `perl -le` and a script glued to its switch (`python
// -c"..."`) each ran a delete unread (review 2026-10-02).
function interpreterOf(prog) {
  if (/^(node|nodejs|bun)$/.test(prog)) return 'node';
  if (/^(python[0-9.]*|py|pypy[0-9.]*)$/.test(prog)) return 'python';
  return prog === 'perl' || prog === 'ruby' || prog === 'deno' ? prog : null;
}

// Node switches whose value is the next word, so that word is not the script.
const NODE_VALUE = /^(-r|--require|--import|--loader|--experimental-loader|-C|--conditions|--input-type|--env-file|--title|--inspect-port|--redirect-warnings|--openssl-config|--icu-data-dir|--diagnostic-dir|--report-dir|--watch-path)$/;
// The one-letter switches of python, perl and ruby, which can be joined
// (`-Bc`, `-lne`): `script` letters take the script, from the rest of the word
// or else the next word; `value` letters take the rest of the word as their
// value, or the next word for those also in `next`; `digits` letters take the
// digits after them; `module` ends the switches with no script at all.
const SWITCHES = {
  python: { script: 'c', value: 'WXQ', next: 'WXQ', digits: '', module: 'm' },
  perl: { script: 'eE', value: 'CdDFiIMmx', next: 'I', digits: '0l', module: '' },
  ruby: { script: 'e', value: 'CEFIKrTWx', next: 'CEIr', digits: '0', module: '' },
};

// A redirection word, and whether its file is the next word. A bash
// here-string (`<<< text`) takes the next word as its text, and a
// here-document opener (`<<EOF`) carries its delimiter.
function redirectAt(t) {
  if (t.lit[0] !== '0') return null;
  if (t.text.startsWith('<<<')) return { op: '<<<', file: t.text.slice(3), next: t.text.length === 3 };
  if (t.text.startsWith('<<')) return { op: '<<', file: t.text.slice(2), next: false };
  const r = REDIRECT.exec(t.text);
  return r ? { op: r[1], file: r[2], next: r[2] === '' } : null;
}

// Where an interpreter takes its script from: { inline: [texts], file, stdin }.
// The first word that is not a switch is the script file, and the words after
// it are that script's own. With neither, or with `-`, the script comes on
// stdin. A redirection is not a word of the command.
function scriptSource(kind, rest) {
  const out = { inline: [], file: null, stdin: false };
  for (let k = 0; k < rest.length; k++) {
    const x = rest[k].text;
    const r = redirectAt(rest[k]);
    if (r) { if (r.next) k++; continue; }
    if (kind === 'deno') {
      if (x === 'eval' && rest[k + 1]) out.inline.push(rest[k + 1].text);
      return out;
    }
    if (x === '-') break;
    if (x === '--') { out.file = rest[k + 1] ? rest[k + 1].text : null; break; }
    if (kind === 'node') {
      if (/^(-e|-p|-pe|--eval|--print)$/.test(x)) {
        if (rest[k + 1]) out.inline.push(rest[k + 1].text);
        k++;
        continue;
      }
      const eq = /^--(eval|print)=([\s\S]*)$/.exec(x);
      if (eq) { out.inline.push(eq[2]); continue; }
      if (NODE_VALUE.test(x)) { k++; continue; }
      if (x.startsWith('-')) continue;
    } else if (x.startsWith('--')) {
      continue;
    } else if (x.startsWith('-')) {
      const sw = SWITCHES[kind];
      for (let c = 1; c < x.length; c++) {
        const L = x[c];
        if (sw.module.includes(L)) return out;
        if (sw.script.includes(L)) {
          if (c < x.length - 1) out.inline.push(x.slice(c + 1));
          else if (rest[k + 1]) { out.inline.push(rest[k + 1].text); k++; }
          break;
        }
        if (sw.digits.includes(L)) { while (/\d/.test(x[c + 1] ?? '')) c++; continue; }
        if (sw.value.includes(L)) {
          if (c === x.length - 1 && sw.next.includes(L)) k++;
          break;
        }
      }
      if (kind === 'python' && out.inline.length > 0) break; // the words after -c are the script's own
      continue;
    }
    out.file = x;
    break;
  }
  out.stdin = out.inline.length === 0 && !out.file;
  return out;
}

// PowerShell parameters whose value is the next word, for the console
// programs (`powershell -ExecutionPolicy Bypass`), written in full or cut short.
const PS_EXE_VALUE = ['executionpolicy', 'windowstyle', 'version', 'inputformat', 'outputformat', 'workingdirectory', 'configurationname', 'settingsfile', 'custompipename'];

// Where a shell takes its commands from: { inline, file, stdin }. `inline` is
// only a yes or no here; analyze() reads the inline script itself.
function shellSource(prog, rest) {
  const out = { inline: false, file: null, stdin: false };
  for (let k = 0; k < rest.length; k++) {
    const x = rest[k].text;
    const r = redirectAt(rest[k]);
    if (r) { if (r.next) k++; continue; }
    if (BASH_SHELLS.has(prog)) {
      if (/^-[A-Za-z]*c[A-Za-z]*$/.test(x)) { out.inline = true; return out; }
      if (/^-[A-Za-z]*s[A-Za-z]*$/.test(x)) break;
      if (/^[-+][oO]$/.test(x)) { k++; continue; }
      if (x === '--') { out.file = rest[k + 1] ? rest[k + 1].text : null; return out; }
      if (/^[-+]/.test(x)) continue;
      out.file = x;
      return out;
    }
    if (PS_SHELLS.has(prog)) {
      const p = /^-([A-Za-z]+)$/.exec(x);
      if (!p) { out.inline = true; return out; } // a bare word is run as a command
      const w = p[1].toLowerCase();
      if ('command'.startsWith(w) || 'file'.startsWith(w)) {
        const v = rest[k + 1] ? rest[k + 1].text : undefined;
        if (v === '-') break;
        if ('file'.startsWith(w)) out.file = v ?? null;
        else out.inline = true;
        return out;
      }
      if ('encodedcommand'.startsWith(w) || w === 'ec') { out.inline = true; return out; }
      if (['ep', 'ex', 'w', 'v', 'if', 'of', 'o', 'wd'].includes(w)
        || (w.length >= 3 && PS_EXE_VALUE.some((n) => n.startsWith(w)))) k++;
      continue;
    }
    if (prog === 'cmd' && /^\/\/?[ck]$/i.test(x)) { out.inline = true; return out; }
  }
  out.stdin = true;
  return out;
}

const SCRIPT_DELETES = /\b(rmSync|rm|rmdirSync|rmdir|rmtree|remove_tree|rm_rf|rm_r|remove_dir|remove_entry)\s*\(/g;
const ALWAYS_RECURSIVE = /^(rmtree|remove_tree|rm_rf|rm_r|remove_dir|remove_entry)$/;

// A delete call that always removes a whole folder, or is given recursive or
// force true, must name a disposable folder written out in full. Every command
// the script hands to a shell is read by analyze(), like one typed at the prompt.
function checkScript(body, prog, depth, ctx = null) {
  if (depth > MAX_DEPTH) return null;
  const what = `the script passed to \`${prog}\``;
  const code = PG.maskStrings(body); // a call named inside a string is not a call
  for (const m of code.matchAll(SCRIPT_DELETES)) {
    const args = PG.callArgs(body, m.index + m[0].length - 1);
    // Options kept in a variable (`rmSync(p, o)`) are read from the whole script.
    const opts = args.slice(1).map((a) => (/^[A-Za-z_$][\w$]*$/.test(a) ? body : a)).join(',');
    if (!ALWAYS_RECURSIVE.test(m[1]) && !/\b(recursive|force)\s*[:=]\s*(true|True|1)\b/.test(opts)) continue;
    const shape = PG.destShape(args[0] ?? '', body);
    if (shape.full === undefined || !isDisposable(shape.full)) {
      return `${what} makes a recursive/forced delete (${m[1]}) on a non-disposable or unprovable path (allowed only for a literal path inside ${[...DISPOSABLE_DIRS].join('/')}, the OS temp dir, or *.tmp files)`;
    }
    const link = linkProblem(shape.full, { through: /[\\/]$/.test(shape.full) }, ctx);
    if (link) return `${what} makes a recursive/forced delete (${m[1]}) that reaches through the link ${link} into a folder that is not provably disposable; ${LINK_NOTE}`;
  }
  for (const m of code.matchAll(PG.SCRIPT_SPAWN_CALLS)) {
    // `/re/g.exec(text)` and `new RegExp(s).exec(text)` are regular expressions, not processes.
    if (m[1] === 'exec' && code[m.index - 1] === '.'
      && (/\/[a-z]*$/.test(code.slice(0, m.index - 1)) || /^(\/|(new )?RegExp\b)/.test(PG.receiverBefore(body, m.index - 1)))) continue;
    const args = PG.callArgs(body, m.index + m[0].length - 1);
    for (const { text, shell } of PG.spawnedCommands(m[1], args, body, prog)) {
      const interp = interpreterOf(shell);
      const reason = interp ? checkScript(text, shell, depth + 1, ctx) : analyze(text, shell === 'cmd' ? 'other' : shell, depth + 1, ctx);
      if (reason) return interp ? reason : `inside ${what}, ${reason}`;
    }
  }
  return null;
}

// A script can reach an interpreter or a shell some other way than as an
// argument (review 2026-10-02): a here-document or a here-string it reads, the
// output of the segment piped into it, a variable holding a text block, or a
// file this same command wrote and then runs. Each is judged as that script.
// Read line by line, the old reading caught a delete written in such a text by
// accident; reading the text as text must not lose it. A reader given a script
// file or a -c script takes a here-document as that script's input: data.

function shellKind(prog) {
  return BASH_SHELLS.has(prog) ? 'bash' : PS_SHELLS.has(prog) ? 'powershell' : prog === 'cmd' ? 'other' : null;
}

// Judge a script by what runs it: an interpreter reads it with checkScript, a
// shell as commands of its own. A text that is only a variable (`$s`) is read
// as the text that variable was given earlier in the command.
function judgeText(text, kind, prog, depth, ctx) {
  if (typeof text !== 'string') return null;
  const v = /^\s*\$\{?([\w:]+)\}?\s*$/.exec(text);
  if (v && ctx.vars.has(v[1].toLowerCase())) text = ctx.vars.get(v[1].toLowerCase());
  if (!text.trim()) return null;
  if (kind === 'bash' || kind === 'powershell' || kind === 'other') return analyze(text, kind, depth + 1, ctx);
  if (!PG) return null;
  try {
    return checkScript(text, prog, depth + 1, ctx);
  } catch {
    return null; // a Path-guard that cannot read this script skips only this check
  }
}

// A here-document, judged as the script of the command that reads it when
// that command runs what it reads (bash, python3 -, node -).
function judgeDoc(doc, depth, ctx) {
  const tokens = tokenize(doc.head, 'bash');
  const i = programIndex(tokens);
  if (i < 0) return null;
  const prog = programName(tokens[i]);
  const rest = tokens.slice(i + 1);
  const body = doc.lines.join('\n');
  const kind = interpreterOf(prog);
  if (kind) return scriptSource(kind, rest).stdin ? judgeText(body, kind, prog, depth, ctx) : null;
  const sk = shellKind(prog);
  return sk && shellSource(prog, rest).stdin ? judgeText(body, sk, prog, depth, ctx) : null;
}

// The scripts a segment's interpreter or shell reads from a file this command
// wrote, from a bash here-string (`<<< text`) or a `< file`, or from the pipe.
function judgeFeeds(segs, si, src, kind, prog, shell, depth, ctx) {
  const seg = segs[si];
  const texts = [];
  if (src.file) texts.push(ctx.files.get(fileKey(src.file)));
  if (src.stdin) {
    const rest = seg.tokens.slice(seg.i + 1);
    for (let k = 0; k < rest.length; k++) {
      const t = rest[k];
      if (t.lit[0] !== '0' || t.text[0] !== '<') continue;
      if (t.text.startsWith('<<<')) {
        texts.push(t.text.length > 3 ? t.text.slice(3) : rest[k + 1] && rest[++k].text);
      } else if (!t.text.startsWith('<<')) { // a here-document is judged with judgeDoc
        const f = t.text.length > 1 ? t.text.slice(1) : rest[k + 1] && rest[++k].text;
        if (f) texts.push(ctx.files.get(fileKey(f)));
      }
    }
    if (seg.pipe && si > 0) texts.push(pipeText(segs[si - 1], shell, ctx));
  }
  for (const text of texts) {
    const reason = judgeText(text, kind, prog, depth, ctx);
    if (reason) return reason;
  }
  return null;
}

// The words of a command, without its redirections.
function plainWords(args) {
  const out = [];
  for (let k = 0; k < args.length; k++) {
    const r = redirectAt(args[k]);
    if (r) { if (r.next) k++; continue; }
    out.push(args[k].text);
  }
  return out;
}

// PowerShell parameters whose value is the next word, so the value is not a
// positional argument.
const PS_VALUE_PARAMS = /^-(path|literalpath|lp|pspath|filepath|filter|include|exclude|depth|attributes|encoding|itemtype|type|name|value|delimiter|stream|newname|destination)$/i;
function psPositionals(args) {
  const out = [];
  for (let k = 0; k < args.length; k++) {
    const t = args[k];
    const r = redirectAt(t);
    if (r) { if (r.next) k++; continue; }
    if (PS_VALUE_PARAMS.test(t.text)) { k++; continue; }
    if (isWord(t) && /^-[A-Za-z]/.test(t.text)) continue;
    out.push(t);
  }
  return out;
}

const fileKey = (f) => String(f).replace(/\\/g, '/').replace(/^(\.\/)+/, '').toLowerCase();

// The text a segment writes to the pipe, when the command shows it: an echo
// or printf, a PowerShell string, here-string or variable standing alone, a
// here-document read by cat, or a file this command wrote. Null otherwise.
function pipeText(seg, shell, ctx) {
  const { tokens, i, prog } = seg;
  if (shell === 'powershell' && tokens.length === 1) {
    if (tokens[0].quoted) return tokens[0].text;
    const v = /^\$([\w:]+)$/.exec(tokens[0].text);
    if (v) return ctx.vars.get(v[1].toLowerCase()) ?? null;
  }
  if (i < 0) return null;
  const words = plainWords(tokens.slice(i + 1));
  if (/^(echo|write-output|write|printf)$/.test(prog)) {
    if (prog === 'echo' && shell !== 'powershell') while (words.length > 0 && /^-[neE]+$/.test(words[0])) words.shift();
    const text = words.join(' ');
    return prog === 'printf' ? text.replace(/\\n/g, '\n') : text;
  }
  if (prog === 'cat' && seg.docs.length > 0) return seg.docs[0].lines.join('\n');
  if (/^(cat|type|get-content|gc)$/.test(prog)) {
    const f = words.find((w) => !w.startsWith('-'));
    return f ? ctx.files.get(fileKey(f)) ?? null : null;
  }
  return null;
}

// What a segment leaves for the segments after it: the folder a `cd` moved
// to, a variable given a text, and a file written with a text the command
// shows (a here-document, a here-string, a piped echo, a -Value).
const CD_PROGRAMS = new Set(['cd', 'chdir', 'pushd', 'set-location', 'sl', 'push-location']);
const FILE_WRITERS = /^(tee|tee-object|set-content|sc|add-content|ac|out-file|new-item|ni)$/;

function remember(segs, si, shell, ctx) {
  const seg = segs[si];
  const { tokens, i, prog } = seg;
  const first = tokens[0];
  const assign = first ? /^\$?([A-Za-z_][\w:]*)=([\s\S]*)$/.exec(first.text) : null;
  if (shell === 'powershell' && tokens.length === 3 && tokens[1].text === '=' && tokens[2].quoted && /^\$[\w:]+$/.test(first.text)) {
    ctx.vars.set(first.text.slice(1).toLowerCase(), tokens[2].text);
  } else if (assign && first.quoted && tokens.length === 1) {
    ctx.vars.set(assign[1].toLowerCase(), assign[2]);
  } else if (assign && seg.docs.length === 1 && assign[2] === '$(cat') {
    ctx.vars.set(assign[1].toLowerCase(), seg.docs[0].lines.join('\n'));
  }
  if (i < 0) return;
  const args = tokens.slice(i + 1);
  if (CD_PROGRAMS.has(prog)) { moveFolder(args, ctx); return; }
  let text = null;
  if (seg.docs.length > 0 && (prog === 'cat' || prog === 'tee')) text = seg.docs[0].lines.join('\n');
  else if (seg.pipe && si > 0 && FILE_WRITERS.test(prog)) text = pipeText(segs[si - 1], shell, ctx);
  else if (FILE_WRITERS.test(prog)) text = psValue(prog, args);
  if (text == null) return;
  for (const f of writtenFiles(prog, args)) ctx.files.set(fileKey(f), text);
}

function psValue(prog, args) {
  const k = args.findIndex((t) => /^-value$/i.test(t.text));
  if (k >= 0) return args[k + 1] ? args[k + 1].text : null;
  if (!/^(set-content|sc|add-content|ac)$/.test(prog)) return null;
  const p = psPositionals(args);
  return p[1] ? p[1].text : null;
}

// The files a command writes: its `>` redirections, tee's names, and the path
// of a PowerShell writer.
function writtenFiles(prog, args) {
  const out = [];
  for (let k = 0; k < args.length; k++) {
    const r = redirectAt(args[k]);
    if (!r) continue;
    const f = r.next ? (args[k + 1] ? args[k + 1].text : null) : r.file;
    if (r.next) k++;
    if (!r.op.startsWith('<') && f) out.push(f);
  }
  if (prog === 'tee') {
    out.push(...plainWords(args).filter((w) => !w.startsWith('-')));
  } else if (FILE_WRITERS.test(prog)) {
    const k = args.findIndex((t) => /^-(path|filepath|literalpath|lp)$/i.test(t.text));
    const given = k >= 0 ? args[k + 1] : psPositionals(args)[0];
    if (given) out.push(given.text);
  }
  return out;
}

// A `cd` adds the folder it moves to, read from every folder the command may
// already be in, to the folders a relative path is read from. Folders are only
// ever added, so a `cd` inside a subshell can only make the disk checks read
// more places. A folder built at runtime is not added: it cannot be read.
function moveFolder(args, ctx) {
  let target = null;
  for (let k = 0; k < args.length; k++) {
    const x = args[k].text;
    if (/^-(path|literalpath|lp)$/i.test(x)) { target = args[k + 1] ? args[k + 1].text : null; break; }
    if (/^-./.test(x) || /^\/d$/i.test(x)) continue;
    target = x;
    break;
  }
  if (!target || target === '-' || /[$`%~]/.test(target)) return;
  const moved = ctx.folders.map((f) => path.resolve(f, diskPath(target)));
  ctx.folders = [...new Set([...ctx.folders, ...moved])].slice(0, 8);
}

// A script file this same command wrote, run by its own name (`./x.sh`,
// `.\x.ps1`, `source x.sh`), judged by its extension.
const RUN_KIND = { sh: 'bash', bash: 'bash', ps1: 'powershell', cmd: 'other', bat: 'other', js: 'node', mjs: 'node', cjs: 'node', py: 'python', pl: 'perl', rb: 'ruby' };
function ranFile(seg, shell, depth, ctx) {
  if (ctx.files.size === 0) return null;
  const { tokens, i, prog } = seg;
  const file = prog === 'source' ? plainWords(tokens.slice(i + 1))[0] : tokens[i].text;
  const text = file ? ctx.files.get(fileKey(file)) : undefined;
  if (text == null) return null;
  const ext = ((/\.([A-Za-z0-9]+)$/.exec(file) || [])[1] || '').toLowerCase();
  const kind = RUN_KIND[ext] || (shell === 'powershell' ? 'powershell' : 'bash');
  return judgeText(text, kind, kind, depth, ctx);
}

// The names a delete takes from elsewhere: xargs adds the names it reads to
// the command, and in PowerShell a delete at the end of a pipeline deletes what
// the pipeline hands it. `names` is null when their source cannot be read.
function deleteFeed(segs, si, shell) {
  const seg = segs[si];
  const before = seg.tokens.slice(0, seg.i);
  const xi = before.findIndex((t) => programName(t) === 'xargs');
  if (xi >= 0) {
    let repl = null;
    let fromFile = false;
    const opts = before.slice(xi + 1);
    for (let k = 0; k < opts.length; k++) {
      const x = opts[k].text;
      if (/^-I/.test(x)) repl = x.length > 2 ? x.slice(2) : opts[k + 1] ? opts[k + 1].text : '{}';
      else if (/^(-i|--replace)$/.test(x)) repl = '{}';
      else if (/^(-i|--replace=)./.test(x)) repl = x.replace(/^(-i|--replace=)/, '');
      else if (/^(-a|--arg-file)/.test(x)) fromFile = true;
    }
    const src = !fromFile && seg.pipe ? pipelineNames(segs, si, shell) : null;
    return { via: 'xargs', names: src ? src.paths : null, through: Boolean(src && src.through), repl };
  }
  if (shell === 'powershell' && seg.pipe) {
    const src = pipelineNames(segs, si, shell);
    return { via: 'a pipe', names: src ? src.paths : null, through: Boolean(src && src.through), repl: null };
  }
  return null;
}

// Walk a pipeline back past the stages that only filter (grep, sort, head,
// Where-Object, Select-Object) to the stage the names come from. A `{ }` block
// of a stage, as in `Where-Object { ... }`, belongs to that stage.
const PIPE_FILTERS = new Set(['grep', 'egrep', 'fgrep', 'sort', 'uniq', 'head', 'tail', 'where-object', 'where', '?', 'select-object', 'select', 'sort-object']);
function pipelineNames(segs, si, shell) {
  let k = si;
  while (segs[k].pipe) {
    let j = k - 1;
    while (j >= 0 && segs[j].level > segs[k].level) j--;
    if (j < 0) return null;
    if (!(PIPE_FILTERS.has(segs[j].prog) && segs[j].pipe)) return sourceNames(segs[j], shell);
    k = j;
  }
  return null;
}

// The paths a pipeline's first stage hands on, when they can be read: find's
// start folders, the words of an echo, and in PowerShell the folder that
// Get-ChildItem lists (or Get-Item, Resolve-Path, a string) names. `through`
// is true when the names are what is inside that path.
const PS_LISTERS = new Set(['get-childitem', 'gci', 'ls', 'dir', 'childitem']);
const PS_NAMERS = new Set(['get-item', 'gi', 'resolve-path', 'rvpa']);
function sourceNames(st, shell) {
  const { tokens, i, prog } = st;
  if (shell === 'powershell' && tokens.length === 1 && tokens[0].quoted) return { paths: commaItems(tokens[0]), through: false };
  if (i < 0) return null;
  const args = tokens.slice(i + 1);
  if (shell !== 'powershell' && prog === 'find') {
    const { starts } = findStarts(args);
    const paths = starts.length > 0 ? targetPaths(starts, shell) : ['.'];
    return paths ? { paths, through: true } : null;
  }
  if (shell !== 'powershell' && (prog === 'echo' || prog === 'printf')) {
    const words = plainWords(args).filter((w) => !/^-[neE]+$/.test(w)).join(' ').split(/\s+/).filter(Boolean);
    return { paths: words, through: false };
  }
  if (shell === 'powershell' && (PS_LISTERS.has(prog) || PS_NAMERS.has(prog))) {
    const k = args.findIndex((t) => /^-(path|literalpath|lp|pspath)$/i.test(t.text));
    const given = k >= 0 ? args.slice(k + 1, k + 2) : psPositionals(args).slice(0, 1);
    const paths = given.length > 0 ? targetPaths(given, shell) : PS_LISTERS.has(prog) ? ['.'] : null;
    return paths ? { paths, through: PS_LISTERS.has(prog) } : null;
  }
  return null;
}

// Put the text blocks splitSegments set aside back into the words that held
// their markers.
function expandMarkers(tokens, texts) {
  if (texts.length === 0) return tokens;
  const re = new RegExp(`${MARK}(\\d+)${MARK}`, 'g');
  return tokens.map((t) => {
    if (!t.text.includes(MARK)) return t;
    let text = '';
    let lit = '';
    let last = 0;
    for (const m of t.text.matchAll(re)) {
      const body = texts[Number(m[1])] ?? '';
      text += t.text.slice(last, m.index) + body;
      lit += t.lit.slice(last, m.index) + 'q'.repeat(body.length);
      last = m.index + m[0].length;
    }
    return { ...t, text: text + t.text.slice(last), lit: lit + t.lit.slice(last), quoted: true };
  });
}

// ---------------------------------------------------------------------------
// Segment analysis + inline-shell recursion
// ---------------------------------------------------------------------------

// What the command works on: the folders a relative path is read from (the
// session's current folder, then any a `cd` moves to), and the variables and
// files it fills with a text, for the scripts that later read them.
function newContext(payload) {
  const folders = [];
  for (const c of [payload && payload.cwd, process.env.CLAUDE_PROJECT_DIR, process.cwd()]) {
    if (typeof c === 'string' && c.trim()) {
      folders.push(path.resolve(diskPath(c)));
      break;
    }
  }
  return { folders, vars: new Map(), files: new Map() };
}

function analyze(command, shell, depth = 0, ctx = newContext(null)) {
  if (depth > MAX_DEPTH) return null;
  const texts = [];
  const segs = splitSegments(command, shell, texts).map((s) => {
    const tokens = expandMarkers(tokenize(s.text, shell), texts);
    const i = programIndex(tokens);
    return { ...s, tokens, i, prog: i >= 0 ? programName(tokens[i]) : '' };
  });
  for (let si = 0; si < segs.length; si++) {
    const reason = checkSegment(segs, si, shell, depth, ctx);
    if (reason) return reason;
    remember(segs, si, shell, ctx);
  }
  return null;
}

function checkSegment(segs, si, shell, depth, ctx) {
  const seg = segs[si];
  for (const doc of seg.docs) {
    const reason = judgeDoc(doc, depth, ctx);
    if (reason) return reason;
  }
  const { tokens, i, prog } = seg;
  if (i < 0) return null;
  const rest = tokens.slice(i + 1);

  if (prog === 'find') return checkFind(rest, shell, ctx);
  const kind = interpreterOf(prog);
  if (kind) {
    const src = scriptSource(kind, rest);
    for (const text of src.inline) {
      const reason = judgeText(text, kind, prog, depth, ctx);
      if (reason) return reason;
    }
    return judgeFeeds(segs, si, src, kind, prog, shell, depth, ctx);
  }
  if (prog === 'git') return checkGit(rest, ctx);
  if (DELETE_PROGRAMS.has(prog)) return checkDelete(prog, rest, shell, ctx, deleteFeed(segs, si, shell));
  // The script is the first word after the flag cluster that holds `c`
  // (`-c`, `-lc`, `-ec`, `-cl`) that is not an option itself (`-c -e`,
  // `-c --`, `-c -o pipefail`). Only an exact `-c` used to count, so
  // `bash -lc "git reset --hard"` ran unread (review 2026-09-25).
  if (BASH_SHELLS.has(prog)) {
    let ci = rest.findIndex((t) => isWord(t) && /^-[A-Za-z]*c[A-Za-z]*$/.test(t.text));
    if (ci >= 0) for (ci++; rest[ci] && isWord(rest[ci]) && /^[-+]/.test(rest[ci].text); ci++) if (/^[-+][oO]$/.test(rest[ci].text)) ci++;
    if (ci >= 0 && rest[ci]) {
      const reason = judgeText(rest[ci].text, 'bash', prog, depth, ctx);
      if (reason) return reason;
    }
    return judgeFeeds(segs, si, shellSource(prog, rest), 'bash', prog, shell, depth, ctx);
  }
  if (PS_SHELLS.has(prog)) {
    const ci = rest.findIndex((t) => isWord(t) && /^-c(ommand)?$/i.test(t.text));
    if (ci >= 0 && rest.length > ci + 1) {
      const reason = judgeText(rest.slice(ci + 1).map((t) => t.text).join(' '), 'powershell', prog, depth, ctx);
      if (reason) return reason;
    }
    return judgeFeeds(segs, si, shellSource(prog, rest), 'powershell', prog, shell, depth, ctx);
  }
  if (prog === 'cmd') {
    const ci = rest.findIndex((t) => isWord(t) && /^\/\/?c$/i.test(t.text));
    if (ci >= 0 && rest.length > ci + 1) {
      const reason = judgeText(rest.slice(ci + 1).map((t) => t.text).join(' '), 'other', prog, depth, ctx);
      if (reason) return reason;
    }
    return judgeFeeds(segs, si, shellSource(prog, rest), 'other', prog, shell, depth, ctx);
  }
  // eval and Invoke-Expression run their text as commands. Read here so that
  // a text block kept in a variable and run this way is judged, as the old
  // line-by-line reading judged it.
  const evals = shell === 'powershell' ? prog === 'invoke-expression' || prog === 'iex' : shell === 'bash' && prog === 'eval';
  if (evals) {
    const words = plainWords(rest).filter((w) => !/^-command$/i.test(w));
    const texts = shell === 'powershell' ? words : [words.join(' ')];
    if (seg.pipe && si > 0) texts.push(pipeText(segs[si - 1], shell, ctx));
    for (const text of texts) {
      const reason = judgeText(text, shell === 'powershell' ? 'powershell' : 'bash', prog, depth, ctx);
      if (reason) return reason;
    }
    return null;
  }
  return ranFile(seg, shell, depth, ctx);
}

// ---------------------------------------------------------------------------
// Hook entry point
// ---------------------------------------------------------------------------

// Monitor runs its command in the Bash tool's shell, as Path-guard.mjs already
// reads it. As 'other' its brace lists were never expanded, so
// `rm -rf dist/{x,../src}` passed there while Bash refused it (review 2026-09-25).
const SHELL_BY_TOOL = { Bash: 'bash', PowerShell: 'powershell', Monitor: 'bash' };

// The install's live probe (review 2026-10-02). The install proves the guards
// are on in a session by running `echo projectos-live-probe` and reading this
// exact line back. It used to try a forced recursive delete of a folder that
// did not exist, which showed the owner an approval prompt for `rm -rf`. The
// probe is the first command (alone, or before others), with echo,
// Write-Output or Write-Host and that one word; it is refused, so nothing in
// the command runs. Any other echo is untouched.
const PROBE_WORD = 'projectos-live-probe';
const PROBE_LINE = 'ProjectOS live probe: the guards are on in this session. Nothing was run.';

function isLiveProbe(command, shell) {
  const first = splitSegments(command, shell)[0];
  if (!first) return false;
  const tokens = tokenize(first.text, shell);
  return tokens.length === 2 && /^(echo|write-output|write-host)$/.test(programName(tokens[0])) && tokens[1].text === PROBE_WORD;
}

function main() {
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    return ALLOW;
  }
  if (!payload || typeof payload !== 'object') return ALLOW;
  const shell = SHELL_BY_TOOL[payload.tool_name];
  if (!shell) return ALLOW;
  const command = payload.tool_input && payload.tool_input.command;
  if (typeof command !== 'string' || command.length === 0) return ALLOW;

  if (isLiveProbe(command, shell)) {
    process.stderr.write(`${PROBE_LINE}\n`);
    return BLOCK;
  }
  const reason = analyze(command, shell, 0, newContext(payload));
  if (reason) {
    process.stderr.write(`destructive-guard: blocked - ${reason}. If the owner explicitly asked for this, ask them to run it themselves.\n`);
    return BLOCK;
  }
  return ALLOW;
}

let code = ALLOW;
try {
  code = main();
} catch {
  code = ALLOW; // fail open: a guard bug must never trap the owner
}
process.exit(code);
