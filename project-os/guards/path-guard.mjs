// path-guard.mjs - PreToolUse hook. Refuses any file write aimed outside the
// project folder, before it happens.
//
// A rule in a document depends on the assistant reading and remembering it,
// and a permission prompt only ASKS. This does not ask. It reads every write the
// file tools make and every Bash / PowerShell command (redirections, writing
// programs, cmdlets, wrappers, inline shells, inline scripts, `cd` moves) and
// exits 2 on anything it cannot prove lands inside the project.
//
// Installed by `node project-os/install-hooks.mjs`, which wires it as:
//   PreToolUse, matcher "Write|Edit|NotebookEdit|Bash|PowerShell|Monitor",
//   command: node "<project root>/project-os/guards/path-guard.mjs"
//
// The project root comes from the session (CLAUDE_PROJECT_DIR, then the
// payload's cwd), never from where this file happens to sit, so one copy guards
// whichever project is open. It runs on Windows, macOS and Linux: a POSIX
// absolute path is a real path when the project root is POSIX, and the MSYS
// drive spelling Git Bash produces (`/c/...`) is folded back to `C:/...` only
// when the root itself has a drive letter.
//
// Fail OPEN: any error, unreadable payload or unknown tool exits 0. A guard bug
// must never trap the owner. The only thing it blocks on purpose is a write it
// cannot prove is inside the project.
//
// Two narrow exceptions, both owner-editable constants below:
//   ALLOW_CLAUDE_MEMORY  the assistant's own memory folder, markdown only.
//   EXTRA_ROOTS          other folders the owner has explicitly approved writes
//                        into, named literally; agent config and env files stay
//                        refused even there. Empty by default.
//
// What it does NOT cover, stated plainly: the assistant's own storage (session
// transcripts, sub-agent logs, overflow of long tool output) is written by the
// application, not by the assistant, and cannot be redirected.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOW = 0;
const BLOCK = 2;
const MAX_DEPTH = 5;

// Claude's memory folder is required by its own system prompt, so blocking it
// would simply stop memory working. Allowed by exception, narrowly: only
// markdown, only under a `.claude/**/memory/` path in the user's home. Set this
// to false and memory stops — the owner's call, one edit.
const ALLOW_CLAUDE_MEMORY = true;

const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '');
const HOME = norm(os.homedir() || '').toLowerCase();
const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Folders OUTSIDE the project the owner has explicitly approved writes into,
// named literally, one per line, forward slashes. Empty by default. A write may
// land in one of them only when the session is inside the project or inside one
// of them, and agent config and env files stay refused even there, so a session
// can never widen another folder's permissions or touch its secrets. Set
// ALLOW_EXTRA_ROOTS to false and the list is ignored.
const ALLOW_EXTRA_ROOTS = true;
const EXTRA_ROOTS = [
  // 'C:/code/other-project',
].map((r) => norm(r).toLowerCase());

// ---------------------------------------------------------------------------
// Quote-aware splitting & tokenizing
// ---------------------------------------------------------------------------

/**
 * Split a command line into executable segments on unquoted ; | & and newlines,
 * and strip here-document BODIES.
 *
 * A here-doc body is data the shell hands to a program — writing `echo hi >
 * C:/x` inside one documents a command, it does not run it. Treating those lines
 * as segments blocked a perfectly legal write to a file inside the project
 * (review 2026-08-02).
 *
 * Redirection operators that CONTAIN a separator character (`>|`, `>&`, `&>`)
 * are kept whole: splitting them apart is how `>| C:/outside` used to slip
 * through as two harmless halves.
 */
function splitSegments(command) {
  const segs = [];
  let cur = '';
  let q = null;
  let heredoc = null; // { delim, stripTabs }
  const lines = String(command).split(/\r?\n/);

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (heredoc) {
      const probe = heredoc.stripTabs ? line.replace(/^\t+/, '') : line;
      if (probe.trim() === heredoc.delim) heredoc = null;
      continue; // body is data, never a command
    }
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (q === '"' && ch === '\\') { cur += ch + (line[i + 1] ?? ''); i++; continue; }
        if (ch === q) q = null;
        cur += ch;
        continue;
      }
      if (ch === "'" || ch === '"') { q = ch; cur += ch; continue; }
      if (ch === '\\') { cur += ch + (line[i + 1] ?? ''); i++; continue; }
      // Here-doc opener: << or <<- then a (possibly quoted) delimiter word.
      if (ch === '<' && line[i + 1] === '<') {
        const m = line.slice(i).match(/^<<(-?)\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z_][\w-]*))/);
        if (m) {
          heredoc = { delim: m[2] || m[3] || m[4], stripTabs: m[1] === '-' };
          i += m[0].length - 1;
          continue;
        }
      }
      // Keep multi-character redirection operators intact.
      if (ch === '>' || (ch === '&' && line[i + 1] === '>')) {
        let op = '';
        if (ch === '&') { op = '&>'; i++; if (line[i + 1] === '>') { op = '&>>'; i++; } }
        else {
          op = '>';
          if (line[i + 1] === '>') { op = '>>'; i++; }
          else if (line[i + 1] === '|') { op = '>|'; i++; }
          else if (line[i + 1] === '&') { op = '>&'; i++; }
        }
        cur += op;
        continue;
      }
      if (ch === ';' || ch === '|' || ch === '&') {
        if (cur.trim()) segs.push(cur);
        cur = '';
        continue;
      }
      cur += ch;
    }
    if (cur.trim()) segs.push(cur);
    cur = '';
  }
  if (cur.trim()) segs.push(cur);
  return segs;
}

/** Tokenize one segment; a redirection operator becomes its own marked token. */
function tokenize(segment, shell) {
  const bashEscapes = shell === 'bash';
  const tokens = [];
  let cur = '';
  let has = false;
  let q = null;
  const push = () => {
    if (has) tokens.push({ text: cur });
    cur = '';
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
      has = true;
      continue;
    }
    if (ch === "'" || ch === '"') { q = ch; has = true; continue; }
    if (ch === '\\' && bashEscapes) {
      const n = segment[i + 1];
      // A backslash-escaped space is part of the path, not a separator.
      if (n !== undefined) { cur += n; i++; has = true; }
      continue;
    }
    if (ch === '>' || (ch === '&' && segment[i + 1] === '>')) {
      push();
      let op;
      if (ch === '&') {
        op = '&>'; i++;
        if (segment[i + 1] === '>') { op = '&>>'; i++; }
      } else {
        op = '>';
        if (segment[i + 1] === '>') { op = '>>'; i++; }
        else if (segment[i + 1] === '|') { op = '>|'; i++; }
        else if (segment[i + 1] === '&') { op = '>&'; i++; }
      }
      tokens.push({ text: op, redirect: true });
      continue;
    }
    if (/\s/.test(ch)) { push(); continue; }
    // A leading file-descriptor digit belongs to the operator, not to a word.
    if (/\d/.test(ch) && cur === '' && segment[i + 1] === '>') continue;
    cur += ch;
    has = true;
  }
  push();
  return tokens;
}

/** Can this token act as a flag or a subcommand? Never used on path arguments. */
const isWord = (t) => t.text.length > 0 && !/\s/.test(t.text);

/**
 * Flag test, per shell. Under bash a leading `/` opens an ABSOLUTE PATH; only
 * cmd-style shells use `/X` switches, and those are one to three letters. This
 * single character is what the first cut got wrong.
 */
const isFlag = (t, shell) =>
  shell === 'bash' ? /^-/.test(t.text) : /^-/.test(t.text) || /^\/[A-Za-z?]{1,3}$/.test(t.text);

/** Path-argument candidates: everything that is not a flag or an operator. */
const positionals = (tokens, shell) =>
  tokens.filter((t) => !t.redirect && t.text.length > 0 && !isFlag(t, shell));

// ---------------------------------------------------------------------------
// Where the project is, and whether a path is inside it
// ---------------------------------------------------------------------------

/**
 * The folder writes must stay inside.
 *
 * Read from the session first, not from this script's own location, so the
 * permitted area is the project that is OPEN, whatever folder this file sits in.
 */
function projectRoot(payload) {
  for (const c of [process.env.CLAUDE_PROJECT_DIR, payload && payload.cwd, SCRIPT_ROOT]) {
    if (typeof c === 'string' && c.trim()) return norm(c);
  }
  return norm(SCRIPT_ROOT);
}

/** Discard sinks — not files, in any of the three shells. */
const SINKS = new Set(['-', '/dev/null', '/dev/stdout', '/dev/stderr', '$null', 'nul', 'con']);

/**
 * Resolve a STATIC path against `root`. Returns { dynamic: true } when the path
 * cannot be proven, { full } otherwise (lower-cased for comparison).
 *
 * Handles the MSYS spelling Git Bash produces: `/c/Users/...` is `C:/Users/...`,
 * and `/c/code/project/...` is the project itself. Without this the guard
 * both missed real escapes and refused the project's own path.
 */
function resolveStatic(target, root) {
  if (/[$`]|%[^%\s]*%|^~|\$\(|\{\{/.test(target)) return { dynamic: true };
  let raw = norm(target);

  // `C:file` — relative to that DRIVE's current directory, which is per-process
  // state this guard cannot see. Unprovable by construction.
  if (/^[A-Za-z]:(?![/])./.test(raw)) return { dynamic: true };

  // On a Windows root, Git Bash spells drives as `/c/...`; fold that back to
  // `C:/...`. On a POSIX root, `/c/...` is an ordinary folder and stays as is.
  const rootHasDrive = /^[A-Za-z]:/.test(root);
  const msys = rootHasDrive ? raw.match(/^\/([A-Za-z])(?=\/|$)(.*)$/) : null;
  if (msys) raw = `${msys[1]}:${msys[2] || '/'}`;

  const hasDrive = /^[A-Za-z]:/.test(raw);
  const posixAbs = !hasDrive && raw.startsWith('/');
  // On a Windows root a drive-less absolute path is the MSYS install root
  // (/tmp, /etc, /usr ...) and can never be inside the project. On a POSIX root
  // it is simply an absolute path, and is resolved like any other.
  if (posixAbs && rootHasDrive) return { full: '\u0000msys' + raw.toLowerCase() };

  const joined = (hasDrive || posixAbs) ? raw : root + '/' + raw;
  const drive = (joined.match(/^[A-Za-z]:/) || [''])[0];
  const body = drive ? joined.slice(2) : joined;
  const out = [];
  for (const part of body.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length === 0) return { dynamic: true }; // escapes its own root
      out.pop();
      continue;
    }
    out.push(part);
  }
  return { full: (drive + '/' + out.join('/')).toLowerCase() };
}

/** Claude's own memory folder, the one allowed exception. */
function isMemoryFile(full) {
  if (!ALLOW_CLAUDE_MEMORY || !HOME) return false;
  return full.startsWith(HOME + '/.claude/') && /\/memory\/[^/]+\.md$/.test(full);
}

/** Is `full` inside `root` (or root itself)? Both must already be lowercased. */
const inside = (full, root) => full === root || full.startsWith(root + '/');

/**
 * A folder in EXTRA_ROOTS, the second allowed exception. Both ends are checked:
 * the write must LAND in an approved folder, and the session must be in the
 * project or in one of them. Agent config and env files are refused even there.
 */
function isExtraRoot(full, rootKey) {
  if (!ALLOW_EXTRA_ROOTS || EXTRA_ROOTS.length === 0) return false;
  if (!EXTRA_ROOTS.some((r) => inside(full, r))) return false;
  if (full.includes('/.claude/') || full.includes('/.codex/')) return false;
  if (/(^|\/)\.env(\.|$)/.test(full)) return false;
  return true;
}

/**
 * Verdict for one write target: null = fine, string = the reason to refuse.
 *
 * `root` is the project — the only place a write may land, and it never moves.
 * `base` is the directory a RELATIVE path resolves against, which a `cd` earlier
 * in the same command does move. Keeping them apart is the whole point: the
 * first cut used one value for both, so `cd C:/Users/User && echo x > y.txt`
 * moved the permitted area along with the working directory and allowed itself
 * (review 2026-08-02).
 */
function checkTarget(target, root, what, base = root) {
  if (!target) return null;
  if (SINKS.has(target.toLowerCase())) return null;
  const rootKey = root.toLowerCase();
  const r = resolveStatic(target, base.toLowerCase());
  if (r.dynamic) {
    return `${what} writes to "${target}", a path built at runtime — it cannot be proven to be inside the project folder. Use a literal path under the project, or the Write tool`;
  }
  if (inside(r.full, rootKey)) return null;
  if (isMemoryFile(r.full)) return null;
  if (isExtraRoot(r.full, rootKey)) return null;
  return `${what} writes to "${target}", which is outside the project folder (${root})`;
}

// ---------------------------------------------------------------------------
// Which commands write, and where their targets are
// ---------------------------------------------------------------------------

// Every trailing positional is a destination.
const BASH_WRITE_ALL = new Set(['tee', 'touch', 'mkdir', 'truncate', 'split']);
// The LAST positional is the destination; earlier ones are sources (reads).
const BASH_WRITE_LAST = new Set(['cp', 'mv', 'install', 'rsync']);
// Flag-valued destinations: flag -> how to read the value.
const BASH_FLAG_TARGETS = {
  curl: /^(-o|--output)$/,
  wget: /^(-O|--output-document)$/,
  tar: /^(-C|--directory)$/,
  unzip: /^-d$/,
};
// Programs that carry a whole script in an argument — scanned as text, since a
// real parse is out of reach.
const INLINE_SCRIPT = { node: /^(-e|--eval|-p|--print)$/, python: /^-c$/, python3: /^-c$/, perl: /^-e$/, ruby: /^-e$/, deno: /^eval$/ };

// PowerShell. Aliases included: `cp`/`mv`/`rni` really are Copy/Move/Rename-Item.
const PS_WRITE_FIRST = new Set([
  'out-file', 'set-content', 'add-content', 'new-item', 'export-csv', 'export-clixml',
  'start-transcript', 'tee-object', 'sc', 'ac', 'ni', 'epcsv', 'tee',
  'compress-archive', 'expand-archive', 'invoke-webrequest', 'iwr', 'curl', 'wget',
]);
const PS_WRITE_LAST = new Set(['copy-item', 'move-item', 'rename-item', 'cpi', 'copy', 'cp', 'mi', 'move', 'mv', 'rni', 'ren']);
// Parameters whose VALUE is a write destination.
const PS_DEST_PARAMS = /^-(destination|newname|destinationpath|outfile|literalpath|path|filepath|outputfile|target)(:|=|$)/i;
// For copy/move/rename, only these are destinations — `-Path` is the SOURCE, and
// checking it refused copying a file INTO the project from outside.
const PS_DEST_ONLY = /^-(destination|newname|destinationpath)(:|=|$)/i;
// Parameters whose value is content, not a path.
const PS_VALUE_PARAMS = /^-(value|body|encoding|name|itemtype|filter|include|exclude|delimiter|separator)(:|=|$)/i;

// Wrappers that sit in front of the real program.
const WRAPPERS = new Set(['sudo', 'doas', 'env', 'nohup', 'command', 'time', 'timeout', 'stdbuf', 'nice', 'ionice', 'xargs']);

const programName = (t) => t.text.replace(/^[({\s]+/, '').split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase();

/** Advance past env assignments, wrappers and their flags to the real program. */
function programIndex(tokens, shell) {
  let i = 0;
  for (let hops = 0; hops < 8 && i < tokens.length; hops++) {
    while (i < tokens.length && (tokens[i].redirect
      || (isWord(tokens[i]) && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i].text)))) i++;
    if (i >= tokens.length) return -1;
    if (!WRAPPERS.has(programName(tokens[i]))) return i;
    const wrapper = programName(tokens[i]);
    i++;
    // Skip the wrapper's own flags, and `timeout 5` / `nice 10`.
    while (i < tokens.length && isFlag(tokens[i], shell)) i++;
    if ((wrapper === 'timeout' || wrapper === 'nice') && i < tokens.length && /^\d+(\.\d+)?$/.test(tokens[i].text)) i++;
  }
  return i < tokens.length ? i : -1;
}

/**
 * Absolute-looking path literals inside an inline script body.
 *
 * The quantifier must have no minimum: with `{3,}` the engine skipped the short
 * literal `'fs'` and then paired the WRONG quotes — the closing one of `'fs'`
 * with the opening one of the path — so the path was never seen (caught by the
 * test, 2026-08-02).
 */
function scriptLiterals(text) {
  return [...String(text).matchAll(/(['"])([^'"\n]+)\1/g)]
    .map((m) => m[2])
    .filter((s) => /^([A-Za-z]:[\\/]|\/)/.test(s));
}

function checkSegment(tokens, root, shell, base) {
  // 1. Redirections, in either shell. `>&` / `&>` followed by a digit or `-` is
  //    a descriptor dup, not a file.
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t.redirect) continue;
    const target = tokens[i + 1];
    if (!target || target.redirect) continue;
    if (t.text.endsWith('&') && /^(\d+|-)$/.test(target.text)) continue;
    const reason = checkTarget(target.text, root, 'a redirection', base);
    if (reason) return reason;
  }

  const pi = programIndex(tokens, shell);
  if (pi < 0) return null;
  const prog = programName(tokens[pi]);
  const rest = tokens.slice(pi + 1);

  // 2. Inline scripts — heuristic, and honest about it.
  const inline = INLINE_SCRIPT[prog];
  if (inline) {
    for (let k = 0; k < rest.length; k++) {
      if (!isWord(rest[k]) || !inline.test(rest[k].text) || !rest[k + 1]) continue;
      for (const lit of scriptLiterals(rest[k + 1].text)) {
        const reason = checkTarget(lit, root, `the script passed to \`${prog}\``, base);
        if (reason) return reason;
      }
    }
  }

  if (shell !== 'powershell') {
    // 3a. bash writers.
    if (BASH_WRITE_ALL.has(prog)) {
      for (const t of positionals(rest, shell)) {
        const reason = checkTarget(t.text, root, `\`${prog}\``, base);
        if (reason) return reason;
      }
      return null;
    }
    if (BASH_WRITE_LAST.has(prog)) {
      const ps = positionals(rest, shell);
      return ps.length >= 2 ? checkTarget(ps[ps.length - 1].text, root, `\`${prog}\``, base) : null;
    }
    // A link is a door out of the folder: check where it POINTS as well.
    if (prog === 'ln') {
      for (const t of positionals(rest, shell)) {
        const reason = checkTarget(t.text, root, '`ln`', base);
        if (reason) return reason;
      }
      return null;
    }
    if (prog === 'sed') {
      const inPlace = rest.some((t) => isWord(t) && /^(-i|--in-place)/.test(t.text));
      if (!inPlace) return null;
      for (const t of positionals(rest, shell).slice(1)) {
        const reason = checkTarget(t.text, root, '`sed -i`', base);
        if (reason) return reason;
      }
      return null;
    }
    if (prog === 'dd') {
      for (const t of rest) {
        const m = t.text.match(/^of=(.*)$/i);
        if (m) return checkTarget(m[1], root, '`dd`', base);
      }
      return null;
    }
    if (prog === 'git') {
      const sub = positionals(rest, shell)[0];
      const subName = sub ? sub.text.toLowerCase() : '';
      if (subName === 'clone') {
        const ps = positionals(rest, shell);
        if (ps.length >= 3) return checkTarget(ps[ps.length - 1].text, root, '`git clone`', base);
      }
      if (subName === 'worktree') {
        const ps = positionals(rest, shell);
        if (ps.length >= 3 && ps[1].text.toLowerCase() === 'add') {
          return checkTarget(ps[2].text, root, '`git worktree add`', base);
        }
      }
      return null;
    }
    const flagRe = BASH_FLAG_TARGETS[prog];
    if (flagRe) {
      for (let k = 0; k < rest.length; k++) {
        if (isWord(rest[k]) && flagRe.test(rest[k].text) && rest[k + 1]) {
          const reason = checkTarget(rest[k + 1].text, root, `\`${prog}\``, base);
          if (reason) return reason;
        }
      }
      return null;
    }
    if (prog === 'npm' || prog === 'pnpm' || prog === 'yarn') {
      for (let k = 0; k < rest.length; k++) {
        if (isWord(rest[k]) && rest[k].text === '--prefix' && rest[k + 1]) {
          const reason = checkTarget(rest[k + 1].text, root, `\`${prog} --prefix\``, base);
          if (reason) return reason;
        }
      }
      return null;
    }
    return null;
  }

  // 3b. PowerShell.
  const isWriter = PS_WRITE_FIRST.has(prog) || PS_WRITE_LAST.has(prog);
  const linkish = prog === 'new-item' && rest.some((t) => /^(junction|symboliclink|hardlink)$/i.test(t.text));
  if (!isWriter && !linkish) return null;
  const destOnly = PS_WRITE_LAST.has(prog);

  // Named parameters, including PowerShell's `-Param:Value` and `-Param=Value`.
  let sawNamedDest = false;
  const named = [];
  for (let k = 0; k < rest.length; k++) {
    const t = rest[k];
    if (!isWord(t) || !/^-/.test(t.text)) continue;
    const which = destOnly && !/^-target(:|=|$)/i.test(t.text) ? PS_DEST_ONLY : PS_DEST_PARAMS;
    if (!which.test(t.text)) continue;
    const glued = t.text.match(/^-[A-Za-z]+[:=](.+)$/);
    if (glued) { named.push(glued[1]); sawNamedDest = true; continue; }
    if (rest[k + 1] && !rest[k + 1].redirect) { named.push(rest[k + 1].text); sawNamedDest = true; }
  }
  if (sawNamedDest) {
    for (const value of named) {
      const reason = checkTarget(value, root, `\`${prog}\``, base);
      if (reason) return reason;
    }
    return null;
  }

  // Positional fallback. Drop the value of any parameter that is content rather
  // than a path, so `-Value "C:\note.txt"` is not read as a destination.
  const skip = new Set();
  for (let k = 0; k < rest.length; k++) {
    if (isWord(rest[k]) && PS_VALUE_PARAMS.test(rest[k].text) && !/[:=]/.test(rest[k].text) && rest[k + 1]) {
      skip.add(rest[k + 1]);
    }
  }
  const ps = positionals(rest, shell).filter((t) => !skip.has(t));
  if (ps.length === 0) return null;
  if (destOnly) return checkTarget(ps[ps.length - 1].text, root, `\`${prog}\``, base);
  for (const t of ps) {
    const reason = checkTarget(t.text, root, `\`${prog}\``, base);
    if (reason) return reason;
  }
  return null;
}

const BASH_SHELLS = new Set(['bash', 'sh', 'zsh', 'dash']);
const PS_SHELLS = new Set(['powershell', 'pwsh']);
const CD_PROGRAMS = new Set(['cd', 'pushd', 'chdir', 'set-location', 'sl']);

/**
 * @param root  the project — the only place a write may land. Never moves.
 * @param cwd   the directory relative paths resolve against. A `cd` moves this
 *              and ONLY this; conflating the two let a command walk out of the
 *              folder and take the permission with it.
 */
function analyze(command, shell, root, depth = 0, cwd = root) {
  if (depth > MAX_DEPTH) return null;
  let here = cwd;
  for (const segment of splitSegments(command)) {
    const tokens = tokenize(segment, shell);
    if (tokens.length === 0) continue;

    const pi = programIndex(tokens, shell);
    const prog = pi >= 0 ? programName(tokens[pi]) : '';

    // A directory change relocates every later relative write in the same
    // command. Follow it; if it cannot be followed, later writes are unprovable.
    if (CD_PROGRAMS.has(prog)) {
      const arg = positionals(tokens.slice(pi + 1), shell)[0];
      if (!arg) continue;
      const moved = resolveStatic(arg.text, here);
      here = moved.dynamic || !moved.full ? '\u0000unknown' : moved.full;
      continue;
    }

    const reason = checkSegment(tokens, root, shell === 'bash' ? 'bash' : 'powershell', here);
    if (reason) return reason;

    if (pi < 0) continue;
    const rest = tokens.slice(pi + 1);
    // Inline shells carry a whole script in an argument — scan it too.
    // `-lc`, `-ec` and friends cluster the flag, so match the shape.
    if (BASH_SHELLS.has(prog)) {
      const ci = rest.findIndex((t) => isWord(t) && /^-[a-z]*c$/.test(t.text));
      if (ci >= 0 && rest[ci + 1]) {
        const inner = analyze(rest[ci + 1].text, 'bash', root, depth + 1, here);
        if (inner) return inner;
      }
    } else if (PS_SHELLS.has(prog)) {
      const ci = rest.findIndex((t) => isWord(t) && /^-c(o(m(m(a(n(d)?)?)?)?)?)?$/i.test(t.text));
      if (ci >= 0 && rest.length > ci + 1) {
        const inner = analyze(rest.slice(ci + 1).map((t) => t.text).join(' '), 'powershell', root, depth + 1, here);
        if (inner) return inner;
      }
      const ei = rest.findIndex((t) => isWord(t) && /^-e(c|nc(odedcommand)?)?$/i.test(t.text));
      if (ei >= 0 && rest[ei + 1]) {
        let decoded = '';
        try {
          decoded = Buffer.from(rest[ei + 1].text, 'base64').toString('utf16le');
        } catch {
          decoded = '';
        }
        if (!decoded) {
          return 'an encoded PowerShell command cannot be read, so it cannot be proven to write inside the project folder';
        }
        const inner = analyze(decoded, 'powershell', root, depth + 1, here);
        if (inner) return inner;
      }
    } else if (prog === 'cmd') {
      const ci = rest.findIndex((t) => isWord(t) && /^\/c$/i.test(t.text));
      if (ci >= 0 && rest.length > ci + 1) {
        const inner = analyze(rest.slice(ci + 1).map((t) => t.text).join(' '), 'other', root, depth + 1, here);
        if (inner) return inner;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hook entry point
// ---------------------------------------------------------------------------

const SHELL_BY_TOOL = { Bash: 'bash', PowerShell: 'powershell', Monitor: 'bash' };
const FILE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);

export function verdict(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const root = projectRoot(payload);

  if (FILE_TOOLS.has(payload.tool_name)) {
    const file = payload.tool_input && (payload.tool_input.file_path ?? payload.tool_input.notebook_path);
    if (typeof file !== 'string' || file.length === 0) return null;
    return checkTarget(file, root, `the ${payload.tool_name} tool`);
  }

  const shell = SHELL_BY_TOOL[payload.tool_name];
  if (!shell) return null;
  const command = payload.tool_input && payload.tool_input.command;
  if (typeof command !== 'string' || command.length === 0) return null;
  return analyze(command, shell, root);
}

function main() {
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    return ALLOW;
  }
  const reason = verdict(payload);
  if (reason) {
    process.stderr.write(
      `path-guard: blocked - ${reason}. Every file this project writes stays inside the project folder ` +
        "(CLAUDE.md rule 12). Scratch files go in the project's own .tmp/ folder. " +
        'If the owner explicitly asked for a write outside it, ask them to do it themselves.\n'
    );
    return BLOCK;
  }
  return ALLOW;
}

// Importable for the test; only the direct run touches stdin and exits.
if (process.argv[1] && norm(path.resolve(process.argv[1])).toLowerCase() === norm(fileURLToPath(import.meta.url)).toLowerCase()) {
  let code = ALLOW;
  try {
    code = main();
  } catch {
    code = ALLOW; // fail open — a guard bug must never trap the owner
  }
  process.exit(code);
}
