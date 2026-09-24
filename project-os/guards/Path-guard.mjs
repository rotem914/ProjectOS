// Path-guard.mjs - PreToolUse hook. Refuses any file write aimed outside the
// project folder, before it happens.
//
// A rule in a document depends on the assistant reading and remembering it,
// and a permission prompt only ASKS. This does not ask. It reads every write the
// file tools make and every Bash / PowerShell command (redirections, writing
// programs, cmdlets, wrappers, inline shells, inline scripts, `cd` moves) and
// exits 2 on anything it cannot prove lands inside the project.
//
// Installed by `node project-os/Install-project-hooks.mjs`, which wires it as:
//   PreToolUse, matcher "Write|Edit|NotebookEdit|Bash|PowerShell|Monitor",
//   command: node "<project root>/project-os/guards/Path-guard.mjs"
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
 *
 * A MULTI-LINE INLINE SCRIPT STAYS ONE ARGUMENT (2026-09-24). A `node -e "..."`
 * (or python -c, perl -e, ruby -e, deno eval) script written over several lines
 * used to be cut at every newline, so each script line was read as a shell
 * command: the `>` of a JavaScript arrow (`x=>x.name`) became a redirection, and
 * after a `cd` out of the folder it blocked a script that wrote nothing.
 *
 * The fix is deliberately narrow. The joining pass keeps a quoted string whole
 * across lines ONLY when it is the script argument of one of those non-shell
 * interpreters, where the inline-script checks in checkSegment read it. Any
 * other string that crosses a line, or a quote left open at the end, and the
 * whole command is read the old line-by-line way instead. A review found that
 * joining every multi-line string hid real writes from the guard (eval,
 * `bash -ce`, `iex`, heredocs, comments, here-strings), because the old reading
 * caught them only by cutting at newlines. Anything that is not a multi-line
 * interpreter script is read exactly as before.
 */
function splitSegments(command, shell = 'bash') {
  return splitJoiningInlineScripts(command, shell) ?? splitSegmentsByLine(command);
}

/** Does the quote about to open here start an inline interpreter's script? */
function opensInlineScript(before, shell) {
  if (!/\s$/.test(before)) return false; // the quote must start its own word
  const tokens = tokenize(before, shell);
  const pi = programIndex(tokens, shell);
  if (pi < 0) return false;
  const flag = INLINE_SCRIPT[programName(tokens[pi])];
  const last = tokens[tokens.length - 1];
  return Boolean(flag) && tokens.length - 1 > pi && isWord(last) && flag.test(last.text);
}

/**
 * The joining pass. Returns null (read the old way) unless every string that
 * crosses a line is an inline interpreter's script and every quote closes.
 * Escapes are read per shell: backslash in bash, backtick in PowerShell, and
 * PowerShell's typographic quotes count as quotes, as they do in PowerShell.
 */
function splitJoiningInlineScripts(command, shell) {
  const text = shell === 'powershell'
    ? String(command).replace(/[‘’‚‛]/g, "'").replace(/[“”„]/g, '"')
    : String(command);
  const esc = shell === 'bash' ? '\\' : shell === 'powershell' ? '`' : null;
  const segs = [];
  let cur = '';
  let q = null;
  let qInline = false;
  let joined = false;
  let heredoc = null;
  const lines = text.split(/\r?\n/);

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (heredoc) {
      const probe = heredoc.stripTabs ? line.replace(/^\t+/, '') : line;
      if (probe.trim() === heredoc.delim) heredoc = null;
      continue;
    }
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (q === '"' && esc && ch === esc) { cur += ch + (line[i + 1] ?? ''); i++; continue; }
        if (ch === q) { q = null; qInline = false; }
        cur += ch;
        continue;
      }
      if (ch === "'" || ch === '"') { qInline = opensInlineScript(cur, shell); q = ch; cur += ch; continue; }
      if (esc && ch === esc) { cur += ch + (line[i + 1] ?? ''); i++; continue; }
      if (ch === '<' && line[i + 1] === '<') {
        const m = line.slice(i).match(/^<<(-?)\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z_][\w-]*))/);
        if (m) {
          heredoc = { delim: m[2] || m[3] || m[4], stripTabs: m[1] === '-' };
          i += m[0].length - 1;
          continue;
        }
      }
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
    if (q) {
      if (!qInline) return null; // a multi-line string that is not an interpreter script
      cur += '\n';
      joined = true;
      continue;
    }
    if (cur.trim()) segs.push(cur);
    cur = '';
  }
  if (q || !joined || heredoc) return null;
  if (cur.trim()) segs.push(cur);
  return segs;
}

/** The original reading: every line is a fresh command. */
function splitSegmentsByLine(command) {
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

/**
 * Tokenize one segment; a redirection operator becomes its own marked token.
 *
 * Each token also carries `legacy`: its text as the guard read it before
 * 2026-09-24, when a backslash inside double quotes was always dropped. Only
 * the one-line inline-script literal scan reads it, so that check gives the
 * verdicts it always gave (a review found a one-line script that only READ
 * `C:\Users\...` refused once the backslashes survived).
 */
function tokenize(segment, shell) {
  const bashEscapes = shell === 'bash';
  const tokens = [];
  let cur = '';
  let legacy = '';
  let has = false;
  let q = null;
  const add = (s) => {
    cur += s;
    legacy += s;
    has = true;
  };
  const push = () => {
    if (has) tokens.push({ text: cur, legacy });
    cur = '';
    legacy = '';
    has = false;
  };
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (q) {
      if (q === '"' && ch === '\\' && bashEscapes) {
        // Inside double quotes bash drops the backslash only before $ ` " \ and
        // a newline; anywhere else it stays, so "J:\Projects\x" keeps its
        // backslashes (2026-09-24: dropping them turned a `cd` into the project
        // into an unknown folder).
        const n = segment[i + 1];
        if (n !== undefined && '$`"\\\n'.includes(n)) { add(n); i++; continue; }
        cur += ch; // kept in the text, dropped in the legacy reading
        has = true;
        continue;
      }
      if (ch === q) { q = null; continue; }
      add(ch);
      continue;
    }
    if (ch === "'" || ch === '"') { q = ch; has = true; continue; }
    if (ch === '\\' && bashEscapes) {
      const n = segment[i + 1];
      // A backslash-escaped space is part of the path, not a separator.
      if (n !== undefined) { add(n); i++; }
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
    add(ch);
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

/**
 * Where an inline script writes (2026-09-24).
 *
 * Reading a multi-line script as one argument (see splitSegments) stopped its
 * lines being misread as shell commands. Some of those misreadings had been
 * blocking real writes by accident, so the checks below look at what the
 * script actually writes, in one-line and multi-line scripts alike:
 *   - the DESTINATION of every write call (the file written, not the files
 *     read): a literal must land inside the project, a path built from the
 *     home, temp or environment folders is refused, and a path built at run
 *     time is refused when the command runs outside the project (`cd` out) or
 *     when the script also uses the home, temp or environment folders;
 *   - every command the script hands to a shell (`execSync`, `os.system`,
 *     `subprocess` with a shell, an argument list starting `bash -c`), also
 *     when the command is kept in a variable first. It is read by this guard's
 *     own shell reading, exactly like a command typed at the prompt, so a `>`
 *     inside a quoted sed or grep pattern is data and a `mkdir` or `cp` inside
 *     the command is checked like any other.
 * Reads are never checked here: a script may read any folder it likes. The
 * first cut of this checked every literal and every statement and blocked
 * everyday read-only scripts (two reviews, 2026-09-24). A third review found
 * writes reached through a variable or through a call the list did not name,
 * and quoted `>` characters in sed and grep patterns read as redirections.
 */
const SCRIPT_WRITE_CALLS = [
  // `dest` lists the arguments written; 'receiver' is the object the method is
  // called on (`Path('x').touch()`). A move writes both of its ends.
  { re: /\b(writeFile(?:Sync)?|appendFile(?:Sync)?|createWriteStream|mkdir(?:Sync)?|mkdtemp(?:Sync)?|rm(?:Sync)?|rmdir(?:Sync)?|unlink(?:Sync)?|truncate(?:Sync)?|makedirs|removedirs|os\.remove|shutil\.rmtree|File\.write|IO\.write|FileUtils\.(?:touch|mkdir_p|mkdir|rm_rf|rm_r|rm_f|rm))\s*\(/g, dest: [0] },
  { re: /\b(copyFile(?:Sync)?|cp(?:Sync)?|linkSync|os\.link|symlink(?:Sync)?|shutil\.(?:copy|copy2|copyfile|copytree)|FileUtils\.(?:cp_r|cp|ln_s|ln))\s*\(/g, dest: [1] },
  { re: /\b(rename(?:Sync)?|os\.replace|shutil\.move|FileUtils\.mv)\s*\(/g, dest: [0, 1] },
  { re: /\b(open|openSync)\s*\(/g, open: true },
  { re: /\.(write_text|write_bytes|touch|mkdir|rmdir|unlink|symlink_to|hardlink_to|rename)\s*\(/g, dest: ['receiver'] },
];
const SCRIPT_SPAWN_CALLS = /\b(execSync|exec|execFile(?:Sync)?|spawn(?:Sync)?|os\.system|os\.popen|subprocess\.(?:run|call|check_call|check_output|Popen)|system)\s*\(/g;
const SCRIPT_HOME = /\b(os\.homedir|homedir\s*\(|os\.tmpdir|tmpdir\s*\(|process\.env\.(HOME|USERPROFILE|APPDATA|LOCALAPPDATA|TEMP|TMP)\b|expanduser|Path\.home|gettempdir|Dir\.home)|os\.environ(\.get)?\s*[[(]\s*['"](HOME|USERPROFILE|APPDATA|LOCALAPPDATA|TEMP|TMP|TMPDIR)['"]|os\.getenv\s*\(\s*['"](HOME|USERPROFILE|APPDATA|LOCALAPPDATA|TEMP|TMP|TMPDIR)['"]|\$ENV\{/;
const SCRIPT_STRINGS = /(['"`])((?:\\[\s\S]|(?!\1)[^\\])*?)\1/g;
// A method called on one of these is a module function, not a call on a path.
const MODULE_RECEIVER = /^(?:fs|fsp|os|io|codecs|shutil|FileUtils|File|IO|Dir|promises|fs\.promises|require\([^()]*\)(?:\.promises)?)$/;
const POSIX_SHELL = /^(?:.*[\\/])?(?:bash|sh|zsh|dash)(?:\.exe)?$/i;
const CMD_SHELL = /^(?:.*[\\/])?cmd(?:\.exe)?$/i;
const PS_SHELL = /^(?:.*[\\/])?(?:powershell|pwsh)(?:\.exe)?$/i;
// Characters cmd.exe treats as plain text, swapped for look-alikes the bash
// reading also treats as plain text, and swapped back in the message.
const CMD_PLAIN = { "'": 'ʼ', $: '＄', '`': 'ˋ' };
const CMD_BACK = { 'ʼ': "'", '＄': '$', 'ˋ': '`' };
let inlineDepth = 0; // a script that starts a script that starts a script stops somewhere

/** The top-level arguments of the call whose `(` sits at `open`; `.end` is just past its `)`. */
function callArgs(text, open) {
  const args = [];
  let depth = 0;
  let cur = '';
  let q = null;
  for (let i = open + 1; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      cur += ch;
      if (ch === '\\') { cur += text[i + 1] ?? ''; i++; continue; }
      if (ch === q) q = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; cur += ch; continue; }
    if ('([{'.includes(ch)) { depth++; cur += ch; continue; }
    if (')]}'.includes(ch)) {
      if (depth === 0) { args.push(cur.trim()); args.end = i + 1; return args; }
      depth--; cur += ch; continue;
    }
    if (ch === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  args.push(cur.trim());
  args.end = text.length;
  return args;
}

/**
 * The string literal that starts at `i`, in JavaScript or Python spelling
 * (prefixes like r'' and f'', triple quotes, templates). `text` is its value
 * with each interpolation replaced by %X%, which the shell reading treats as a
 * value known only at run time; `prefix` is the fixed part before the
 * first interpolation, or null when there is none. Null when no literal starts here.
 */
function stringLiteralAt(src, i) {
  let j = i;
  let pre = '';
  while (pre.length < 2 && /[rRbBuUfF]/.test(src[j] ?? '')) { pre += src[j]; j++; }
  if (pre && i > 0 && /[\w$]/.test(src[i - 1])) return null;
  const q = src[j];
  if (q !== "'" && q !== '"' && q !== '`') return null;
  if (pre && q === '`') return null;
  const raw = /r/i.test(pre);
  const fmt = /f/i.test(pre);
  const close = q !== '`' && src.startsWith(q.repeat(3), j) ? q.repeat(3) : q;
  let inner = '';
  for (let k = j + close.length; k < src.length;) {
    if (src[k] === '\\') { inner += src.slice(k, k + 2); k += 2; continue; }
    if (src.startsWith(close, k)) {
      const hole = q === '`' ? /\$\{[^}]*\}/g : fmt ? /\{\{|\}\}|\{[^{}]*\}/g : null;
      const decode = (s) => (raw ? s : s.replace(/\\([\s\S])/g, (m, c) => ({ n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', '`': '`', '\n': '' }[c] ?? m)));
      let first = -1;
      const text = hole
        ? inner.replace(hole, (m, at) => {
          if (m === '{{') return '{';
          if (m === '}}') return '}';
          if (first < 0) first = at;
          return '%X%';
        })
        : inner;
      return { text: decode(text), prefix: first < 0 ? null : decode(inner.slice(0, first)), end: k + close.length };
    }
    inner += src[k];
    k++;
  }
  return null;
}

/** The script with every string's contents blanked, so a call NAMED in a string is not a call. */
function maskStrings(body) {
  return body.replace(SCRIPT_STRINGS, (m, q, inner) => q + ' '.repeat(inner.length) + q);
}

/** The expression a method is called on, read backward from its `.`. */
function receiverBefore(src, dot) {
  const skipBack = (at) => {
    let depth = 0;
    for (let k = at; k >= 0; k--) {
      const ch = src[k];
      if (ch === "'" || ch === '"' || ch === '`') { k = src.lastIndexOf(ch, k - 1); if (k < 0) return -1; continue; }
      if (')]}'.includes(ch)) depth++;
      else if ('([{'.includes(ch) && --depth === 0) return k;
    }
    return -1;
  };
  let i = dot;
  while (i > 0) {
    const ch = src[i - 1];
    if (ch === ')' || ch === ']') {
      const open = skipBack(i - 1);
      if (open < 0) break;
      i = open;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const open = src.lastIndexOf(ch, i - 2);
      if (open < 0) break;
      i = open;
      continue;
    }
    if (/[\w$.]/.test(ch)) { i--; continue; }
    break;
  }
  return src.slice(i, dot).trim();
}

/** Does this argument list open a file for writing? The first mode given decides. */
function writeModeIn(args) {
  for (const a of args) {
    const kw = /^(\w+)\s*=(?!=)\s*([\s\S]*)$/.exec(a);
    if (kw && !/^(mode|flags?)$/.test(kw[1])) continue;
    const v = (kw ? kw[2] : a).trim();
    if (/\bO_(WRONLY|RDWR|CREAT|TRUNC|APPEND)\b/.test(v)) return true;
    const l = stringLiteralAt(v, 0);
    if (l && l.end === v.length) return /^[rwxabts+U]+$/.test(l.text) && /[wax+]/.test(l.text);
  }
  return false;
}

/** The expressions a script writes to, as written in the script. */
function writeDestinations(body) {
  const out = [];
  const code = maskStrings(body);
  for (const call of SCRIPT_WRITE_CALLS) {
    for (const m of code.matchAll(call.re)) {
      const open = m.index + m[0].length - 1;
      const dot = code[m.index] === '.' ? m.index : code[m.index - 1] === '.' ? m.index - 1 : -1;
      const receiver = dot >= 0 ? receiverBefore(body, dot) : '';
      const onModule = dot < 0 || MODULE_RECEIVER.test(receiver);
      const args = callArgs(body, open);
      const argAt = (k) => (args[k] && !/^\w+\s*=(?!=)/.test(args[k]) ? args[k] : null);
      if (call.open) {
        if (onModule) {
          if (argAt(0) && writeModeIn(args.slice(1))) out.push(argAt(0)); // open(path, 'w')
        } else if (receiver && writeModeIn(args)) {
          out.push(receiver); // Path('x').open('w')
        }
        continue;
      }
      for (const d of call.dest) {
        if (d === 'receiver') {
          if (!onModule && receiver) out.push(receiver);
        } else if (argAt(d)) {
          out.push(argAt(d));
        }
      }
    }
  }
  return out;
}

/**
 * What a destination expression is known to be: { full } for a fixed path,
 * { prefix } for a path whose start is fixed, {} when it is built at run time.
 * A variable given exactly one literal and nothing else counts as that literal,
 * and a path built with `Path(...)` or `path.join(...)` from a fixed first
 * part starts there (`Path('.tmp', p.name)` lands in .tmp). That start is as
 * far as a guard can see; a later part could still climb out, the same as the
 * rest of a template string could.
 */
function destShape(expr, body, depth = 0) {
  const e = String(expr).trim();
  const lit = stringLiteralAt(e, 0);
  if (lit && lit.end === e.length) return lit.prefix === null ? { full: lit.text } : { prefix: lit.prefix };
  if (/^[A-Za-z_$][\w$]*$/.test(e) && depth < 3) {
    const name = e.replace(/\$/g, '\\$');
    const given = [...body.matchAll(new RegExp(`(?:^|[^\\w$.])${name}\\s*\\+?=(?![=>])\\s*`, 'g'))];
    if (given.length === 1 && !/\+=\s*$/.test(given[0][0])) {
      const at = given[0].index + given[0][0].length;
      const l = stringLiteralAt(body, at);
      if (l && /^\s*(?:[;\n]|$)/.test(body.slice(l.end))) return l.prefix === null ? { full: l.text } : { prefix: l.prefix };
    }
    return {};
  }
  const call = /^((?:pathlib\.)?(?:Pure)?(?:Windows|Posix)?Path|os\.path\.join|path\.(?:posix\.)?(?:join|resolve))\s*\(/.exec(e);
  if (call) {
    const args = callArgs(e, call[0].length - 1);
    if (args.end === e.length && args[0]) {
      const parts = args.map((a) => destShape(a, body, depth + 1));
      if (parts.every((p) => p.full !== undefined)) {
        // A later absolute part restarts the path, as pathlib does.
        let full = '';
        for (const p of parts) full = full === '' || /^([A-Za-z]:)?[\\/]/.test(p.full) ? p.full : `${full}/${p.full}`;
        return { full };
      }
      if (parts[0].full !== undefined) return { prefix: `${parts[0].full}/` };
      if (parts[0].prefix) return parts[0];
    }
  }
  return {};
}

/** The texts an expression can be: a literal's value, or every literal a variable is given. */
function exprTexts(expr, body) {
  const e = String(expr).trim();
  if (!e) return [];
  const lit = stringLiteralAt(e, 0);
  if (lit && lit.end === e.length) return [lit.text];
  const out = [];
  if (/^[A-Za-z_$][\w$]*$/.test(e)) {
    const name = e.replace(/\$/g, '\\$');
    for (const m of body.matchAll(new RegExp(`(?:^|[^\\w$.])${name}\\s*\\+?=(?![=>])\\s*`, 'g'))) {
      const l = stringLiteralAt(body, m.index + m[0].length);
      if (l) out.push(l.text);
    }
    return out;
  }
  // Anything else (a concatenation, a call): every literal inside it, each on its own.
  for (let i = 0; i < e.length; i++) {
    const l = stringLiteralAt(e, i);
    if (l) { out.push(l.text); i = l.end - 1; }
  }
  return out;
}

/**
 * Every command a spawn call hands to a shell or to another inline script:
 * [{ text, shell }], shell being 'bash', 'cmd', 'powershell', or an
 * interpreter name for a nested inline script. An argument list with no shell
 * is never read: no shell parses it, so a `>` in it is only a character.
 */
function spawnedCommands(name, args, body, prog) {
  const out = [];
  const platformShell = process.platform === 'win32' ? 'cmd' : 'bash';
  const literal = (expr) => {
    const e = String(expr ?? '').trim();
    const l = stringLiteralAt(e, 0);
    return l && l.end === e.length ? l.text : null;
  };
  const add = (expr, shell) => { for (const text of exprTexts(expr, body)) out.push({ text, shell }); };
  const isList = (expr) => /^[[(]/.test(String(expr ?? '').trim());
  const items = (expr) => callArgs(String(expr).trim(), 0).filter((a) => a !== '');
  const shellOption = (rest) => {
    const m = /\bshell\s*[:=]\s*(?:(['"`])([^'"`]*)\1|(\w+))/.exec(rest.join(','));
    if (!m) return null;
    if (m[2] !== undefined) {
      if (POSIX_SHELL.test(m[2])) return 'bash';
      if (PS_SHELL.test(m[2])) return 'powershell';
      return CMD_SHELL.test(m[2]) ? 'cmd' : platformShell;
    }
    return /^(true|True|1)$/.test(m[3]) ? platformShell : null;
  };
  // An argument list that starts a shell or an interpreter: `bash -c <script>`.
  const argv = (list) => {
    const head = literal(list[0]);
    if (!head) return;
    const flagAt = (re) => list.findIndex((a, k) => k > 0 && re.test(literal(a) ?? ''));
    const joinFrom = (k) => list.slice(k).map((a) => literal(a) ?? '%X%').join(' ');
    const interp = programName({ text: head });
    if (POSIX_SHELL.test(head)) {
      const k = flagAt(/^-[a-z]*c$/);
      if (k > 0 && list[k + 1]) add(list[k + 1], 'bash');
    } else if (CMD_SHELL.test(head)) {
      const k = flagAt(/^\/c$/i);
      if (k > 0) out.push({ text: joinFrom(k + 1), shell: 'cmd' });
    } else if (PS_SHELL.test(head)) {
      const k = flagAt(/^-c(o(m(m(a(n(d)?)?)?)?)?)?$/i);
      if (k > 0) out.push({ text: joinFrom(k + 1), shell: 'powershell' });
    } else if (INLINE_SCRIPT[interp]) {
      const k = flagAt(INLINE_SCRIPT[interp]);
      if (k > 0 && list[k + 1]) add(list[k + 1], interp);
    }
  };
  const rest = args.slice(1);
  if (name === 'exec' || name === 'execSync') {
    if (/^python/.test(prog)) return out; // Python's exec() runs Python, not a shell
    add(args[0], shellOption(rest) ?? platformShell);
  } else if (/^(execFile|spawn)/.test(name)) {
    const list = isList(args[1]) ? items(args[1]) : [];
    const shell = shellOption(rest);
    if (shell) out.push({ text: [args[0], ...list].map((a) => literal(a) ?? '%X%').join(' '), shell });
    else argv([args[0], ...list]);
  } else if (name.startsWith('subprocess.')) {
    const exe = /\bexecutable\s*=\s*(['"])([^'"]*)\1/.exec(rest.join(','));
    let shell = shellOption(rest);
    if (shell && exe) shell = POSIX_SHELL.test(exe[2]) ? 'bash' : PS_SHELL.test(exe[2]) ? 'powershell' : shell;
    if (isList(args[0])) {
      const list = items(args[0]);
      if (shell) out.push({ text: list.map((a) => literal(a) ?? '%X%').join(' '), shell });
      else argv(list);
    } else if (shell) {
      add(args[0], shell);
    }
  } else if (name === 'os.system' || name === 'os.popen') {
    add(args[0], platformShell);
  } else if (name === 'system') {
    if (args.length === 1) add(args[0], platformShell);
    else argv(args);
  }
  return out;
}

function inlineScriptRisk(body, prog, root, base) {
  const what = `the script passed to \`${prog}\``;
  const baseOutside = Boolean(checkTarget('.', root, what, base));
  const usesHome = SCRIPT_HOME.test(body);
  for (const dest of writeDestinations(body)) {
    const shape = destShape(dest, body);
    if (shape.full !== undefined) {
      const reason = checkTarget(shape.full.replace(/\\{2,}/g, '\\'), root, what, base);
      if (reason) return reason;
      continue;
    }
    if (shape.prefix) {
      const reason = checkTarget(`${shape.prefix}x`, root, what, base);
      if (reason) return reason;
      continue;
    }
    if (SCRIPT_HOME.test(dest)) {
      return `${what} writes to a path built from the home, temp or environment folders, which cannot be proven to be inside the project folder`;
    }
    if (usesHome) {
      return `${what} writes to a path built at run time in a script that also uses the home, temp or environment folders, so it cannot be proven to be inside the project folder`;
    }
    if (baseOutside) {
      return `${what} writes to a path built at run time while the command runs outside the project folder, so it cannot be proven inside`;
    }
  }
  const code = maskStrings(body);
  for (const m of code.matchAll(SCRIPT_SPAWN_CALLS)) {
    // `/re/.exec(text)` is a regular expression, not a process.
    if (m[1] === 'exec' && code[m.index - 1] === '.' && /^(\/|new RegExp)/.test(receiverBefore(body, m.index - 1))) continue;
    const args = callArgs(body, m.index + m[0].length - 1);
    for (const { text, shell } of spawnedCommands(m[1], args, body, prog)) {
      if (inlineDepth >= MAX_DEPTH) return null;
      inlineDepth++;
      let reason;
      try {
        if (INLINE_SCRIPT[shell]) {
          reason = inlineScriptRisk(text, shell, root, base);
        } else if (shell === 'powershell') {
          reason = analyze(text, 'powershell', root, 0, base);
        } else {
          // cmd.exe, the shell these calls get on Windows, has no single
          // quotes, no backslash escapes and no $ variables: read it that way.
          const asRead = shell === 'cmd' ? text.replace(/['$`]/g, (c) => CMD_PLAIN[c]).replace(/\\/g, '/') : text;
          reason = analyze(asRead, 'bash', root, 0, base);
        }
      } finally {
        inlineDepth--;
      }
      if (reason) return INLINE_SCRIPT[shell] ? reason : `inside ${what}, ${reason.replace(/[ʼ＄ˋ]/g, (c) => CMD_BACK[c])}`;
    }
  }
  return null;
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
      const body = rest[k + 1].text;
      // A one-line script keeps the check it always had: every absolute path
      // literal in it, read the way the guard always read it (see tokenize).
      // A multi-line one was never read at all before 2026-09-24, and now only
      // its write destinations are (inlineScriptRisk).
      if (!body.includes('\n')) {
        for (const lit of scriptLiterals(rest[k + 1].legacy ?? body)) {
          const reason = checkTarget(lit, root, `the script passed to \`${prog}\``, base);
          if (reason) return reason;
        }
      }
      const risk = inlineScriptRisk(body, prog, root, base);
      if (risk) return risk;
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
 * Bash subshell parentheses in one segment: how many open at its start and how
 * many close in it. `(cd x && ls) && write` changes folder only inside the
 * parentheses, so the folder is restored where they close (review 2026-09-24:
 * the write after them was read as running in `x`). A `$(...)` is counted apart
 * so its closing parenthesis never ends a subshell.
 */
function subshellParens(segment) {
  const s = segment.trim();
  let opens = 0;
  let i = 0;
  while (s[i] === '(') {
    opens++;
    i++;
    while (/\s/.test(s[i] ?? '')) i++;
  }
  let closes = 0;
  let inner = 0;
  let q = null;
  for (; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '\\' && q === '"') { i++; continue; }
      if (ch === q) q = null;
      continue;
    }
    if (ch === "'" || ch === '"') { q = ch; continue; }
    if (ch === '\\') { i++; continue; }
    if (ch === '(') { inner++; continue; }
    if (ch === ')') {
      if (inner > 0) inner--;
      else closes++;
    }
  }
  return { opens, closes };
}

/**
 * @param root  the project — the only place a write may land. Never moves.
 * @param cwd   the directory relative paths resolve against. A `cd` moves this
 *              and ONLY this; conflating the two let a command walk out of the
 *              folder and take the permission with it.
 */
function analyze(command, shell, root, depth = 0, cwd = root) {
  if (depth > MAX_DEPTH) return null;
  let here = cwd;
  const outer = []; // the folder each open bash subshell will return to
  for (const segment of splitSegments(command, shell)) {
    const tokens = tokenize(segment, shell);
    if (tokens.length === 0) continue;
    const parens = shell === 'bash' ? subshellParens(segment) : { opens: 0, closes: 0 };
    for (let k = 0; k < parens.opens; k++) outer.push(here);
    const leave = () => {
      for (let k = 0; k < parens.closes && outer.length > 0; k++) here = outer.pop();
    };

    const pi = programIndex(tokens, shell);
    const prog = pi >= 0 ? programName(tokens[pi]) : '';

    // A directory change relocates every later relative write in the same
    // command. Follow it; if it cannot be followed, later writes are unprovable.
    if (CD_PROGRAMS.has(prog)) {
      const arg = positionals(tokens.slice(pi + 1), shell)[0];
      if (arg) {
        const moved = resolveStatic(arg.text, here);
        here = moved.dynamic || !moved.full ? '\u0000unknown' : moved.full;
      }
      leave();
      continue;
    }

    const reason = checkSegment(tokens, root, shell === 'bash' ? 'bash' : 'powershell', here);
    if (reason) return reason;

    if (pi < 0) { leave(); continue; }
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
    leave();
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
