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
//  - Inline scripts (`node -e`, `python -c`, `py -c`, `perl -e`, `ruby -e`) are
//    read with the Path-guard.mjs that sits beside this file. If that file is
//    missing, older or broken, only this one check is skipped.
//  - Disposable-delete containment: a recursive/forced delete is allowed ONLY
//    when every target is a STATIC path (no variables, substitution, `~`, or
//    unresolved traversal) that normalizes to inside node_modules / dist /
//    .astro, inside the OS temp dir (os.tmpdir() or /tmp), or a `*.tmp`
//    atomic-write leftover. `backups/` is NOT disposable — it holds the
//    disaster-recovery ZIPs. Ambiguous targets block. In bash a brace list in a
//    target (`dist/{a,b}`) is expanded first, and every word it becomes is
//    judged. A `)` that closes a subshell is not part of the path before it.
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
//  - find with -delete, or with -exec/-execdir/-ok/-okdir running a delete
//    program: judged as a recursive delete of its start paths (`.` when none
//    is given), so `find node_modules -delete` passes and `find src -delete`
//    blocks.
//  - inline scripts: a delete call that always removes a whole folder
//    (rmtree, rm_rf, remove_tree) or is given recursive/force true must name a
//    disposable folder written out in full; every command the script hands to
//    a shell (execSync, os.system, subprocess with a shell) is checked by the
//    rules above, like a command typed at the prompt.

import fs from 'node:fs';
import os from 'node:os';

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

function splitSegments(command, shell = 'bash') {
  const segs = [];
  let cur = '';
  let q = null;
  const braces = []; // PowerShell: one entry per open `{`, true when it opened a block
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
    const prev = i > 0 ? command[i - 1] : ' ';
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
      if (cur.trim()) segs.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) segs.push(cur);
  return segs;
}

// Tokenize one segment into { text, quoted, lit } tokens. `quoted` records that a
// token was (even partly) inside quotes. `lit` has one mark per character of
// `text`: 0 when it was bare, q when it was inside quotes, e when a backslash
// escaped it; a brace list or a closing `)` only counts when bare. Backslash is
// an escape only under bash semantics; under PowerShell/unknown it is a path
// separator and stays literal.
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

// The paths that target tokens name: in bash each word as it expands, in the
// other shells as written. Null when a word expands to too many to judge.
function targetPaths(tokens, shell) {
  const paths = [];
  for (const t of tokens) {
    const words = shell === 'bash' ? braceExpand(t.text, t.lit) : [t.text];
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

function checkDelete(program, tokens, shell) {
  let recursive = false;
  let force = false;
  let dryRun = false;
  const targets = [];
  let afterDashDash = false;
  for (const token of tokens) {
    const t = dropClosingParen(token);
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
  if (!recursive && !force) return null;
  const paths = targetPaths(targets, shell);
  if (!paths || paths.length === 0 || !paths.every(isDisposable)) {
    return `${program}: recursive/forced delete on a non-disposable or unprovable path (allowed only for static paths inside ${[...DISPOSABLE_DIRS].join('/')}, the OS temp dir, or *.tmp files)`;
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
// `{` is a group the splitter could not see, as in `time -p { rm -rf src; }`.
const SHELL_KEYWORDS = /^(then|do|else|elif|if|while|until|!|\{|\(+)$/;

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

// `find <start paths> ... -delete`, or `-exec rm ...`, deletes what it finds
// under its start paths at any depth: judged like `rm -rf <start paths>`.
function checkFind(tokens, shell) {
  let k = 0;
  // Options written before the start paths: -H, -L, -P, -O3, -D <debug opts>.
  while (k < tokens.length && /^-([HLP]|O\d*|D)$/.test(tokens[k].text)) k += tokens[k].text === '-D' ? 2 : 1;
  const starts = [];
  while (k < tokens.length && !/^[-(!]/.test(tokens[k].text)) starts.push(tokens[k++]);
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
  if (m.INLINE_SCRIPT && typeof m.INLINE_SCRIPT === 'object' && m.SCRIPT_SPAWN_CALLS instanceof RegExp
    && helpers.every((h) => typeof m[h] === 'function')) PG = m;
} catch {
  PG = null;
}

// The flag that carries a script for this program (`-e` for node), or null.
function inlineFlag(prog) {
  if (!PG || !Object.prototype.hasOwnProperty.call(PG.INLINE_SCRIPT, prog)) return null;
  const re = PG.INLINE_SCRIPT[prog];
  return re instanceof RegExp ? re : null;
}

const SCRIPT_DELETES = /\b(rmSync|rm|rmdirSync|rmdir|rmtree|remove_tree|rm_rf|rm_r|remove_dir|remove_entry)\s*\(/g;
const ALWAYS_RECURSIVE = /^(rmtree|remove_tree|rm_rf|rm_r|remove_dir|remove_entry)$/;

// A delete call that always removes a whole folder, or is given recursive or
// force true, must name a disposable folder written out in full. Every command
// the script hands to a shell is read by analyze(), like one typed at the prompt.
function checkScript(body, prog, depth) {
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
  }
  for (const m of code.matchAll(PG.SCRIPT_SPAWN_CALLS)) {
    // `/re/g.exec(text)` and `new RegExp(s).exec(text)` are regular expressions, not processes.
    if (m[1] === 'exec' && code[m.index - 1] === '.'
      && (/\/[a-z]*$/.test(code.slice(0, m.index - 1)) || /^(\/|(new )?RegExp\b)/.test(PG.receiverBefore(body, m.index - 1)))) continue;
    const args = PG.callArgs(body, m.index + m[0].length - 1);
    for (const { text, shell } of PG.spawnedCommands(m[1], args, body, prog)) {
      const reason = inlineFlag(shell) ? checkScript(text, shell, depth + 1) : analyze(text, shell === 'cmd' ? 'other' : shell, depth + 1);
      if (reason) return inlineFlag(shell) ? reason : `inside ${what}, ${reason}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Segment analysis + inline-shell recursion
// ---------------------------------------------------------------------------

function analyze(command, shell, depth = 0) {
  if (depth > MAX_DEPTH) return null;
  for (const segment of splitSegments(command, shell)) {
    const tokens = tokenize(segment, shell);
    const i = programIndex(tokens);
    if (i < 0) continue;
    const prog = programName(tokens[i]);
    const rest = tokens.slice(i + 1);

    if (prog === 'find') {
      const reason = checkFind(rest, shell);
      if (reason) return reason;
      continue;
    }
    const flag = inlineFlag(prog);
    if (flag) {
      let reason = null;
      try {
        const k = rest.findIndex((t) => isWord(t) && flag.test(t.text));
        if (k >= 0 && rest[k + 1]) reason = checkScript(rest[k + 1].text, prog, depth + 1);
      } catch {
        reason = null; // a Path-guard that cannot read this script skips only this check
      }
      if (reason) return reason;
      continue;
    }
    if (prog === 'git') {
      const reason = checkGit(rest);
      if (reason) return reason;
      continue;
    }
    if (DELETE_PROGRAMS.has(prog)) {
      const reason = checkDelete(prog, rest, shell);
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
      const ci = rest.findIndex((t) => isWord(t) && /^\/\/?c$/i.test(t.text));
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
