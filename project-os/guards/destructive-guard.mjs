// destructive-guard.mjs - PreToolUse hook. Blocks destructive shell commands
// before the assistant runs them. Inspired by the rule packs of
// Dicklesworthstone/destructive_command_guard (dcg), reimplemented as a
// zero-dependency local script so there is nothing to install or maintain.
//
// Installed by `node project-os/install-hooks.mjs`, which wires it as:
//   PreToolUse, matcher "Bash|PowerShell|Monitor",
//   command: node "<project root>/project-os/guards/destructive-guard.mjs"
//
// The hook feeds this script a JSON payload on stdin ({ tool_name,
// tool_input: { command }, ... }). If the command matches a destructive
// pattern, the script exits 2 with the reason on stderr — Claude Code then
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
//    shells (`bash -c "..."`, `powershell -Command ...`, `cmd /c ...`) are
//    recursively scanned.
//  - Disposable-delete containment: a recursive/forced delete is allowed ONLY
//    when every target is a STATIC path (no variables, substitution, `~`, or
//    unresolved traversal) that normalizes to inside node_modules / dist /
//    .astro, inside the OS temp dir (os.tmpdir() or /tmp), or a `*.tmp`
//    atomic-write leftover. `backups/` is NOT disposable — it holds the
//    disaster-recovery ZIPs. Ambiguous targets block.
//
// What it blocks:
//  - git: reset --hard/--merge; clean -f/-x (without -n); checkout -f / `--` /
//    `.`; non-staged or worktree restore; switch -f/--discard-changes; push
//    --force/--force-with-lease/--mirror/--prune/-d/--delete/+refspec/:refspec;
//    branch -D / -d+-f; stash drop|clear; filter-branch/filter-repo; reflog
//    expire|delete; gc --prune=now; prune (without -n)
//  - deletes (bash rm incl. /bin/rm; PowerShell Remove-Item + aliases ri/rm/
//    del/erase/rd; cmd rd/rmdir/del/erase): any recursive or forced delete
//    whose targets are not all provably disposable. -WhatIf / dry-run passes.

import fs from 'node:fs';
import os from 'node:os';

const ALLOW = 0;
const BLOCK = 2;
const MAX_DEPTH = 5;

// ---------------------------------------------------------------------------
// Quote-aware splitting & tokenizing
// ---------------------------------------------------------------------------

// Split a command line into executable segments on unquoted ; | & and newlines
// (covers `;`, `|`, `||`, `&`, `&&`).
function splitSegments(command) {
  const segs = [];
  let cur = '';
  let q = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (q) {
      if (q === '"' && ch === '\\') { cur += ch + (command[i + 1] ?? ''); i++; continue; }
      if (ch === q) q = null;
      cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { q = ch; cur += ch; continue; }
    if (ch === '\\') { cur += ch + (command[i + 1] ?? ''); i++; continue; }
    if (ch === ';' || ch === '|' || ch === '&' || ch === '\n' || ch === '\r') {
      if (cur.trim()) segs.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) segs.push(cur);
  return segs;
}

// Tokenize one segment into { text, quoted } tokens. `quoted` records that a
// token was (even partly) inside quotes. Backslash is an escape only under bash
// semantics; under PowerShell/unknown it is a path separator and stays literal.
//
// `quoted` is NOT a data marker — see isWord below. It used to be treated as one
// ("quoted tokens are DATA, never flags or subcommands"), which was the whole of
// finding B1 (review 2026-07-26): the shell strips quotes before the program
// sees its argv, so `git reset "--hard"` and `git reset --hard` are byte-identical
// to git, yet only the second was blocked. Every git rule and the bash `rm` rule
// were bypassable by quoting one flag.
function tokenize(segment, shell) {
  const bashEscapes = shell === 'bash';
  const tokens = [];
  let cur = '';
  let quoted = false;
  let has = false;
  let q = null;
  const push = () => {
    if (has) tokens.push({ text: cur, quoted });
    cur = '';
    quoted = false;
    has = false;
  };
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (q) {
      if (q === '"' && ch === '\\' && bashEscapes) {
        const n = segment[i + 1];
        if (n !== undefined) { cur += n; i++; }
        continue;
      }
      if (ch === q) { q = null; continue; }
      cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { q = ch; quoted = true; has = true; continue; }
    if (ch === '\\' && bashEscapes) {
      const n = segment[i + 1];
      if (n !== undefined) { cur += n; i++; has = true; }
      continue;
    }
    if (/\s/.test(ch)) { push(); continue; }
    cur += ch;
    has = true;
  }
  push();
  return tokens;
}

// Can this token act as a flag, a switch, or a subcommand? Decided on the token's
// TEXT, never on whether it was quoted — that is the B1 fix.
//
// What quoting still tells us is WORD-SPLITTING, and that is the property worth
// keeping: `git commit -m "reset --hard"` arrives as one token whose text is
// `reset --hard`, spaces included, and no real flag or subcommand ever contains
// whitespace. So the whitespace test is what keeps commit messages, grep patterns
// and prose out of the rules — while `"--hard"`, `'--hard'` and `--"hard"`, which
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
      if (out.length === 0) return null; // escapes its own root — unprovable
      out.pop();
      continue;
    }
    out.push(part);
  }
  return { abs: abs || !!drive, drive, segs: out };
}

// Regenerable build/dependency dirs. This one script is wired as the PreToolUse
// guard for every project that installs it (each project's settings point at
// this absolute path — owner 2026-07-26), so the set has to cover their stacks,
// not just this Astro repo: `.astro` here, `.next` for the Next.js project, and
// the framework-agnostic rest. Only unambiguously GENERATED names belong here —
// `build` and `out` are deliberately absent, since either can be a real source
// directory, and a false "disposable" verdict is the one mistake this list must
// never make. A missing name only costs a needless block, which is the safe way
// to be wrong.
const DISPOSABLE_DIRS = new Set([
  'node_modules', 'dist', '.astro', '.next', '.turbo', '.vite', '.cache', '.svelte-kit', 'coverage',
  // The project's own scratch folder (CLAUDE.md rule 15, 2026-08-02). Added the
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
// Git rules (structural)
// ---------------------------------------------------------------------------

// Parse the tokens after `git` into { sub, flagsLong, flagsShort, raw, pos }.
function parseGit(tokens) {
  let i = 0;
  // skip global options (git -C <path> -c <k=v> --paginate ... <subcommand>)
  while (i < tokens.length) {
    const t = tokens[i];
    if (!isWord(t)) break;
    if (t.text === '-C' || t.text === '-c') { i += 2; continue; }
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
  return { sub, flagsLong, flagsShort, raw, pos };
}

function checkGit(tokens) {
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

function checkDelete(program, tokens) {
  let recursive = false;
  let force = false;
  let dryRun = false;
  const targets = [];
  let afterDashDash = false;
  for (const t of tokens) {
    const x = t.text;
    if (isWord(t) && !afterDashDash) {
      if (x === '--') { afterDashDash = true; continue; }
      if (/^--./.test(x)) {
        const name = x.slice(2).toLowerCase();
        if (name === 'recursive') recursive = true;
        else if (name === 'force') force = true;
        continue;
      }
      if (/^-./.test(x)) {
        const word = x.slice(1);
        const param = /^[A-Za-z]+$/.test(word) ? psParam(word) : null;
        if (param) {
          if (param === 'recurse') recursive = true;
          else if (param === 'force') force = true;
          else if (param === 'whatif' || param === 'confirm') dryRun = true;
          continue;
        }
        // bash-style short-flag cluster (-rf)
        for (const c of word) {
          if (c === 'r' || c === 'R') recursive = true;
          else if (c === 'f') force = true;
        }
        continue;
      }
      if (/^\/[a-zA-Z]$/.test(x)) {
        const sw = x[1].toLowerCase();
        if (sw === 's') recursive = true;
        else if (sw === 'f' || sw === 'q') force = true;
        continue;
      }
    }
    targets.push(x);
  }
  if (dryRun) return null;
  if (!recursive && !force) return null;
  if (targets.length === 0 || !targets.every(isDisposable)) {
    return `${program}: recursive/forced delete on a non-disposable or unprovable path (allowed only for static paths inside ${[...DISPOSABLE_DIRS].join('/')}, the OS temp dir, or *.tmp files)`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Segment analysis + inline-shell recursion
// ---------------------------------------------------------------------------

const BASH_SHELLS = new Set(['bash', 'sh', 'zsh', 'dash']);
const PS_SHELLS = new Set(['powershell', 'pwsh']);

function programName(token) {
  return token.text.replace(/^[({\s]+/, '').split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase();
}

function analyze(command, shell, depth = 0) {
  if (depth > MAX_DEPTH) return null;
  for (const segment of splitSegments(command)) {
    const tokens = tokenize(segment, shell);
    let i = 0;
    // skip env-var prefixes (VAR=x cmd) and sudo
    while (i < tokens.length && isWord(tokens[i])
      && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i].text) || tokens[i].text === 'sudo')) i++;
    const progTok = tokens[i];
    if (!progTok) continue;
    const prog = programName(progTok);
    const rest = tokens.slice(i + 1);

    if (prog === 'git') {
      const reason = checkGit(rest);
      if (reason) return reason;
      continue;
    }
    if (DELETE_PROGRAMS.has(prog)) {
      const reason = checkDelete(prog, rest);
      if (reason) return reason;
      continue;
    }
    if (BASH_SHELLS.has(prog)) {
      const ci = rest.findIndex((t) => isWord(t) && t.text === '-c');
      if (ci >= 0 && rest[ci + 1]) {
        const reason = analyze(rest[ci + 1].text, 'bash', depth + 1);
        if (reason) return reason;
      }
      continue;
    }
    if (PS_SHELLS.has(prog)) {
      const ci = rest.findIndex((t) => isWord(t) && /^-c(ommand)?$/i.test(t.text));
      if (ci >= 0 && rest.length > ci + 1) {
        const script = rest.slice(ci + 1).map((t) => t.text).join(' ');
        const reason = analyze(script, 'powershell', depth + 1);
        if (reason) return reason;
      }
      continue;
    }
    if (prog === 'cmd') {
      const ci = rest.findIndex((t) => isWord(t) && /^\/c$/i.test(t.text));
      if (ci >= 0 && rest.length > ci + 1) {
        const script = rest.slice(ci + 1).map((t) => t.text).join(' ');
        const reason = analyze(script, 'other', depth + 1);
        if (reason) return reason;
      }
      continue;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hook entry point
// ---------------------------------------------------------------------------

const SHELL_BY_TOOL = { Bash: 'bash', PowerShell: 'powershell', Monitor: 'other' };

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

  const reason = analyze(command, shell);
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
  code = ALLOW; // fail open — a guard bug must never trap the owner
}
process.exit(code);
