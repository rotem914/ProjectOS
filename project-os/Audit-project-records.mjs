// Audit-project-records.mjs - counts the places where this project's own records
// fell behind its rules, so the owner sees where the process slipped. It reads
// only: it changes nothing, blocks nothing, and always exits 0.
//
// Why: the rules ask for a History row for every change, a review result on
// every medium or high row, no placeholder left after the install, no pointer
// to a file that is gone, no long dash in new text, and a .gitignore that keeps
// scratch output and snapshots out of git. Every one of those slips silently:
// nothing errors, and a slip is found only when someone goes looking. This goes
// looking. It runs on the owner's `Go audit`, and at `Go commit` as a warning
// that never stops the commit (CLAUDE.md, 2026-10-01).
//
//   node project-os/Audit-project-records.mjs             the last 30 days
//   node project-os/Audit-project-records.mjs --days 90   a longer window
//
// Run it from the project root. It prints one count line per check and, under
// each, the gaps it found (dates, files, lines), at most 25 per check:
//   a. days in the window with commits (merges left out) but no History row.
//      A day counts as recorded when a row in project-os/History.md or one of
//      its archives carries that date, or when a commit that day added a row to
//      project-os/History.md: `Go commit` often lands the day after the work,
//      carrying rows dated the day before.
//   b. rows rated medium or high in project-os/History.md whose cells, past
//      the date and the task, never mention a review result.
//   c. placeholders like {{THIS}} left in CLAUDE.md and project-os/, except
//      inside ``` fences and inside the setup tables the tool files under
//      project-os/mcp/ keep on purpose until their server is wired (the
//      "Setup facts" section, or a "Setup step" note and the table below it).
//      A ~~~ fence is looked into: the kit's example replies sit in those, and
//      the install replaces the placeholders there too (Installation.md step
//      5), so one left there is a gap like any other (2026-10-01).
//   d. backticked paths in CLAUDE.md and project-os/ that point into the project
//      (project-os/..., features/..., scripts/..., or a bare file name) and are
//      not on disk, with the exact case, so the answer is the same on Windows,
//      macOS and Linux. The living records (History, Decisions, Backlog,
//      BugAtlas, Mistakes and every archive) are left out: they describe the
//      past and are never rewritten, so a stale name there is not a gap. Names
//      the kit mentions before they exist (an archive, Plan.md, .mcp.json and
//      the rest of MADE_LATER below) are left out too.
//   e. long dashes (the em dash, the en dash, and in prose files a double
//      hyphen standing between words) in lines added within the window and
//      still in the file today. A line fixed since is not listed. In a prose
//      file a dash inside a fenced block (``` or ~~~) or an inline code span
//      is not listed either: that is a rule showing the forbidden dash as its
//      example, not a slip (2026-10-01). In a code file every one counts,
//      since a backtick there opens a template string whose text is shown.
//   f. a .gitignore that does not keep out /.tmp/ or /backups/ (any pattern that
//      ignores the folder counts, and a later "!" line that brings it back is
//      followed).
// In a folder that is not a git repository, checks a and e say "no git here"
// and the other four still run.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

// Never blocks: whatever goes wrong, it says so and exits 0, since `Go commit`
// runs it as a warning and a crash there must not read as a failed check.
const stopEarly = (e) => {
  console.log(`Audit-project-records: stopped early (${e && e.message ? e.message : e}); it changed nothing.`);
  process.exit(0);
};
process.on('uncaughtException', stopEarly);
process.on('unhandledRejection', stopEarly);

const ROOT = process.cwd();
const MAX_SHOWN = 25;
const notes = [];

// ---- arguments -------------------------------------------------------------
let DAYS = 30;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  let value = null;
  if (a === '--days') { value = argv[i + 1]; i++; }
  else if (a.startsWith('--days=')) value = a.slice('--days='.length);
  else { notes.push(`unknown argument "${a}", ignored`); continue; }
  if (/^\d+$/.test(value || '') && Number(value) > 0) DAYS = Number(value);
  else notes.push(`--days takes a whole number above 0, and "${value ?? ''}" is not one, so the default ${DAYS} is used`);
}

// ---- dates -----------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const NOW = new Date();
// The window is the last DAYS calendar days, today included, in local time.
const START = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - (DAYS - 1));
const FROM = localDate(START);
const TO = localDate(NOW);

// ---- files -----------------------------------------------------------------
const abs = (rel) => path.join(ROOT, ...rel.split('/'));
const textCache = new Map();
function readLines(rel) {
  if (textCache.has(rel)) return textCache.get(rel);
  let lines = null;
  try {
    let s = fs.readFileSync(abs(rel), 'utf8');
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
    lines = s.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  } catch { lines = null; }
  textCache.set(rel, lines);
  return lines;
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__']);
function walk(relDir, out) {
  let entries;
  try { entries = fs.readdirSync(abs(relDir), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const rel = relDir ? `${relDir}/${e.name}` : e.name;
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(rel, out); }
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

// CLAUDE.md and every markdown file under project-os/, the tool files included.
const DOCS = [
  ...(fs.existsSync(abs('CLAUDE.md')) ? ['CLAUDE.md'] : []),
  ...walk('project-os', []).filter((f) => /\.md$/i.test(f)).sort(),
];

// Exact-case existence, so a reference spelled `Workflow.MD` is missing on every
// system, not only on the ones whose disks care about case.
const dirCache = new Map();
function namesIn(relDir) {
  if (dirCache.has(relDir)) return dirCache.get(relDir);
  let m = null;
  try { m = new Map(fs.readdirSync(abs(relDir || '.'), { withFileTypes: true }).map((e) => [e.name, e.isDirectory()])); } catch { m = null; }
  dirCache.set(relDir, m);
  return m;
}
function existsExact(rel, wantDir = false) {
  const parts = rel.split('/').filter((p) => p && p !== '.');
  let dir = '';
  for (let i = 0; i < parts.length; i++) {
    const names = namesIn(dir);
    if (!names || !names.has(parts[i])) return false;
    const isDir = names.get(parts[i]);
    if (i < parts.length - 1 && !isDir) return false;
    if (i === parts.length - 1 && wantDir && !isDir) return false;
    dir = dir ? `${dir}/${parts[i]}` : parts[i];
  }
  return parts.length > 0;
}

// For each line, the character of the fenced block it sits in (` or ~, the
// fence lines included), or null outside one. Check c needs the kind, since
// it looks inside ~~~ fences and not inside ``` ones.
function fenceKinds(lines) {
  const kinds = new Array(lines.length).fill(null);
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (open) {
      kinds[i] = open[0];
      if (m && m[1][0] === open[0] && m[1].length >= open.length && m[2].trim() === '') open = null;
    } else if (m && !(m[1][0] === '`' && m[2].includes('`'))) {
      kinds[i] = m[1][0];
      open = m[1];
    }
  }
  return kinds;
}
// Lines inside a fenced block of either kind.
const fenceMask = (lines) => fenceKinds(lines).map((k) => k !== null);

const ROW_DATE = /^\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|/;
const isRow = (l) => /^\s*\|/.test(l || '');
const isSeparator = (l) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l || '');
const cellsOf = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());

function shown(list, fmt) {
  const lines = list.slice(0, MAX_SHOWN).map((x) => `       ${fmt(x)}`);
  if (list.length > MAX_SHOWN) lines.push(`       and ${list.length - MAX_SHOWN} more`);
  return lines;
}

// ---- git -------------------------------------------------------------------
const GIT_CONFIG = ['-c', 'core.quotePath=false', '-c', 'log.showSignature=false'];
function hasGit() {
  const r = spawnSync('git', [...GIT_CONFIG, 'rev-parse', '--is-inside-work-tree'], { cwd: ROOT, encoding: 'utf8' });
  return !r.error && r.status === 0 && r.stdout.trim() === 'true';
}

// Git quotes a path with unusual characters in C style; this undoes it.
function unquote(s) {
  if (!s.startsWith('"')) return s;
  const bytes = [];
  for (let i = 1; i < s.length - 1; i++) {
    const c = s[i];
    if (c !== '\\') { bytes.push(...Buffer.from(c, 'utf8')); continue; }
    const n = s[++i];
    if (/[0-7]/.test(n)) { bytes.push(parseInt(s.slice(i, i + 3), 8)); i += 2; continue; }
    bytes.push(({ n: 10, t: 9, r: 13, '"': 34, '\\': 92, a: 7, b: 8, f: 12, v: 11 })[n] ?? n.charCodeAt(0));
  }
  return Buffer.from(bytes).toString('utf8');
}

const PROSE_FILE = /\.(md|mdx|markdown|txt)$/i;
// A line of prose with its inline code spans taken out, each replaced by a
// pair of backticks so the words around it stay apart. A span opens with a run
// of backticks and closes at the next run of the same length, as markdown reads
// it, so ``a ` b`` is one span; a run that never closes is plain text.
function withoutCodeSpans(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '`') { out += text[i++]; continue; }
    let n = 0;
    while (text[i + n] === '`') n++;
    let close = -1;
    for (let j = i + n; j < text.length;) {
      if (text[j] !== '`') { j++; continue; }
      let m = 0;
      while (text[j + m] === '`') m++;
      if (m === n) { close = j; break; }
      j += m;
    }
    if (close === -1) { out += text.slice(i, i + n); i += n; continue; }
    out += '``';
    i = close + n;
  }
  return out;
}
// A double hyphen counts only between words in prose, and not after a command
// word on the same line: `git checkout abc -- file` is a command, not a dash.
const COMMAND_WORD = /\b(git|npm|npx|pnpm|yarn|node|deno|bun|cargo|docker|pip|python|bash|sh|pwsh|powershell)\s/i;
function hasProseDoubleHyphen(plain) {
  const re = /[^\s-][ \t]+--[ \t]+[^\s-]/g;
  for (let m = re.exec(plain); m; m = re.exec(plain)) {
    if (!COMMAND_WORD.test(plain.slice(0, m.index + 1))) return true;
  }
  return false;
}
// In prose the inline code spans are left out first, so a rule that quotes the
// forbidden dash as `\u2014` is not taken for a slip (2026-10-01). A code file
// is read whole: its backticks open template strings, whose text is shown.
function dashKind(file, text) {
  const prose = PROSE_FILE.test(file);
  const plain = prose ? withoutCodeSpans(text) : text;
  if (plain.includes('\u2014')) return 'em dash';
  if (plain.includes('\u2013')) return 'en dash';
  if (prose && hasProseDoubleHyphen(plain)) return 'double hyphen';
  return null;
}

// One pass over `git log -p` for the window feeds checks a and e: which days
// had commits, which commits added a History row, and which added lines carry
// a long dash. Streamed line by line, so a long window never sits in memory.
function readGitLog() {
  // A repository with no commit yet has no log to read, and git's message for
  // that differs by version and language, so ask for HEAD first.
  const head = spawnSync('git', [...GIT_CONFIG, 'rev-parse', '--verify', '--quiet', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  if (head.error || head.status !== 0) return Promise.resolve({ commits: [], dashes: [] });
  return new Promise((resolve) => {
    const since = Math.floor(START.getTime() / 1000) - 86400; // a day of margin; author dates decide below
    const args = [...GIT_CONFIG, 'log', '--no-merges', `--since=@${since}`, '--format=%x01C %H %at',
      '-p', '--relative', '--no-color', '--no-ext-diff', '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/', '--', '.'];
    const child = spawn('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    const commits = [];
    const dashes = [];
    let cur = null;
    let file = null;
    let inHunk = false;
    let oldLeft = 0;
    let newLeft = 0;
    let err = '';
    // The log runs newest first, so a rename is seen before the older commits
    // that wrote under the old name; this maps each old name to today's name.
    const renamed = new Map();
    let renameFrom = null;
    const today = (p) => renamed.get(p) ?? p;
    const onLine = (line) => {
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (inHunk) {
        const c = line[0];
        if (c === '+') {
          // An archive only ever receives rows moved out of its live file, so
          // what lands there is old text, never new writing.
          if (cur && cur.inWindow && file && !/-archive\.md$/i.test(file)) {
            if (file === 'project-os/History.md' && ROW_DATE.test(line.slice(1))) cur.addsRow = true;
            const kind = dashKind(file, line.slice(1));
            if (kind) dashes.push({ file, text: line.slice(1), kind, hash: cur.hash, date: cur.date });
          }
          newLeft--;
        } else if (c === '-') oldLeft--;
        else if (c === '\\') { /* "No newline at end of file" */ }
        else { oldLeft--; newLeft--; }
        if (oldLeft <= 0 && newLeft <= 0) inHunk = false;
        return;
      }
      if (line.startsWith('\x01C ')) {
        const [, hash, at] = line.split(' ');
        const date = localDate(new Date(Number(at) * 1000));
        cur = { hash, date, inWindow: date >= FROM, addsRow: false };
        commits.push(cur);
        file = null;
        return;
      }
      if (line.startsWith('diff --git ')) { file = null; renameFrom = null; return; }
      if (line.startsWith('rename from ')) { renameFrom = unquote(line.slice(12)); return; }
      if (line.startsWith('rename to ') && renameFrom !== null) {
        renamed.set(renameFrom, today(unquote(line.slice(10))));
        renameFrom = null;
        return;
      }
      if (line.startsWith('+++ ')) {
        let p = line.slice(4).replace(/\t$/, '');
        if (p === '/dev/null') { file = null; return; }
        p = unquote(p);
        file = today(p.startsWith('b/') ? p.slice(2) : p);
        return;
      }
      const h = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
      if (h) {
        oldLeft = h[1] === undefined ? 1 : Number(h[1]);
        newLeft = h[2] === undefined ? 1 : Number(h[2]);
        inHunk = oldLeft > 0 || newLeft > 0;
      }
    };
    const decoder = new StringDecoder('utf8');
    let rest = '';
    child.stdout.on('data', (chunk) => {
      const parts = (rest + decoder.write(chunk)).split('\n');
      rest = parts.pop();
      for (const p of parts) onLine(p);
    });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => resolve({ error: e.message }));
    child.on('close', (code) => {
      const tail = rest + decoder.end();
      if (tail) onLine(tail);
      if (code !== 0 && !commits.length) return resolve({ error: err.trim().split('\n')[0] || `git log exited ${code}` });
      resolve({ commits: commits.filter((c) => c.inWindow), dashes });
    });
  });
}

// ---- a. days with commits but no History row --------------------------------
function historyDates() {
  const dates = new Set();
  for (const rel of ['project-os/History.md', 'project-os/History-scan-archive.md', 'project-os/History-archive.md']) {
    const lines = readLines(rel);
    if (!lines) continue;
    const mask = fenceMask(lines);
    lines.forEach((l, i) => { const m = !mask[i] && ROW_DATE.exec(l); if (m) dates.add(m[1]); });
  }
  return dates;
}
function checkA(log) {
  const dates = historyDates();
  const byDay = new Map();
  for (const c of log.commits) {
    if (!byDay.has(c.date)) byDay.set(c.date, { date: c.date, hashes: [], addsRow: false });
    const d = byDay.get(c.date);
    d.hashes.push(c.hash.slice(0, 7));
    if (c.addsRow) d.addsRow = true;
  }
  return [...byDay.values()].filter((d) => !dates.has(d.date) && !d.addsRow).sort((x, y) => (x.date < y.date ? -1 : 1));
}

// ---- b. medium or high rows with no review result ----------------------------
function checkB() {
  const rel = 'project-os/History.md';
  const lines = readLines(rel);
  if (!lines) return { missing: true, gaps: [] };
  const mask = fenceMask(lines);
  const gaps = [];
  for (let i = 0; i < lines.length; i++) {
    if (mask[i] || !isRow(lines[i]) || !isSeparator(lines[i + 1])) continue;
    const riskAt = cellsOf(lines[i]).findIndex((c) => /^risk\b/i.test(c));
    let j = i + 2;
    for (; j < lines.length && isRow(lines[j]) && !mask[j]; j++) {
      if (riskAt === -1) continue;
      const cells = cellsOf(lines[j]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(cells[0] || '')) continue;
      if (!/\b(medium|high)\b/i.test(cells[riskAt] || '')) continue;
      const rest = cells.slice(2).join(' | ');
      if (/\breview/i.test(rest) || /\bfindings?\b/i.test(rest)) continue;
      gaps.push({ rel, line: j + 1, date: cells[0], task: cells[1] || '', risk: (cells[riskAt].match(/medium|high/i) || [''])[0].toLowerCase() });
    }
    i = j - 1;
  }
  return { missing: false, gaps };
}

// ---- c. placeholders left ----------------------------------------------------
// The setup tables a tool file under project-os/mcp/ keeps until its server is
// wired: the "Setup facts" section down to the next heading of its level, and a
// "Setup step" note with the table that follows it.
function setupMask(lines, fences) {
  const mask = new Array(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (fences[i]) continue;
    const h = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (h && /setup facts/i.test(h[2])) {
      let j = i;
      for (; j < lines.length; j++) {
        const h2 = j > i && !fences[j] && /^(#{1,6})\s/.exec(lines[j]);
        if (h2 && h2[1].length <= h[1].length) break;
        mask[j] = true;
      }
      i = j - 1;
      continue;
    }
    if (/^\s*>.*setup step/i.test(lines[i])) {
      let j = i;
      let table = false;
      for (; j < lines.length; j++) {
        const l = lines[j];
        if (isRow(l)) { table = true; mask[j] = true; continue; }
        if (table) break;
        if (/^\s*>/.test(l) || l.trim() === '') { mask[j] = true; continue; }
        break;
      }
      i = j - 1;
    }
  }
  return mask;
}
// The living records describe the past and are never rewritten. A row there
// that quotes a placeholder or names a file since renamed is history, not a
// gap, and an archive holds nothing else; the install fills only the text
// around a record's tables (its heading and its rules).
const RECORD_DOC = /^project-os\/(History|Decisions|Backlog|BugAtlas|Mistakes)(-scan)?(-archive)?\.md$|-archive\.md$/;
const ARCHIVE_DOC = /-archive\.md$/;

function checkC() {
  const gaps = [];
  for (const rel of DOCS) {
    if (ARCHIVE_DOC.test(rel)) continue;
    const lines = readLines(rel);
    if (!lines) continue;
    const kinds = fenceKinds(lines);
    const fences = kinds.map((k) => k !== null);
    const setup = rel.startsWith('project-os/mcp/') ? setupMask(lines, fences) : null;
    const record = RECORD_DOC.test(rel);
    lines.forEach((l, i) => {
      // Only a ``` fence is skipped: a ~~~ fence holds an example reply, whose
      // placeholders the install replaces too (see c. above).
      if (kinds[i] === '`' || (setup && setup[i]) || (record && isRow(l))) return;
      for (const m of l.matchAll(/\{\{[A-Z][A-Z0-9_]*\}\}/g)) gaps.push({ rel, line: i + 1, token: m[0] });
    });
  }
  return gaps;
}

// ---- d. references to missing files ------------------------------------------
const PREFIXES = ['project-os/', 'features/', 'scripts/'];
const FILE_EXT = /\.(md|mdx|markdown|txt|json|jsonc|mjs|cjs|js|jsx|ts|tsx|ps1|psm1|sh|bash|py|yml|yaml|toml|ini|cfg|html|css|astro|vue|svelte|xml|csv|sql|lock|example)$/i;
// Names the kit mentions before they exist: each appears the first time it is
// needed, so its absence is not a gap.
const MADE_LATER = [
  /-archive\.md$/, // an archive appears at the first rotation that needs it
  /(^|\/)Plan\.md$/, // a plan is moved in only when the project has one
  /(^|\/)Kit-version\.json$/, // written by the install and by Compare-kit-files.mjs
  /(^|\/)CLAUDE-kit\.md$/, // exists only during a merge
  /(^|\/)\.mcp\.json(\.example)?$/, // written when a browser or tool server is set up
  /(^|\/)\.env/, /(^|\/)\.dev\.vars/, // env files and their templates are per project
  /(^|\/)settings(\.local)?\.json$/, // the assistant's settings, per machine
  /(^|\/)README\.md$/, // the human overview, when the project keeps one
  /(^|\/)(\.venv|venv|node_modules|backups|\.tmp|notes)(\/|$)/, // made on first use
];
function refsIn(span) {
  const out = [];
  const tokens = span.trim().split(/\s+/);
  for (let t of tokens) {
    t = t.replace(/^[("'[]+/, '').replace(/[)"'\],;:.!?]+$/, '');
    t = t.replace(/#.*$/, '').replace(/:\d+(-\d+)?$/, '').replace(/^\.\//, '');
    if (!t || /[<>*?{}$~|\\"'`]/.test(t) || t.includes('://') || t.startsWith('..')) continue;
    if (PREFIXES.some((p) => t.startsWith(p))) { out.push({ ref: t, bare: false }); continue; }
    if (tokens.length === 1 && !t.includes('/') && /^[\w.-]*[\w-]\.[A-Za-z][\w]*$/.test(t) && FILE_EXT.test(t) && !/^[\d.]+$/.test(t)) out.push({ ref: t, bare: true });
  }
  return out;
}
// A bare file name is missing only when no file of that name exists anywhere
// in the project: `Hooks-settings.json` lives in project-os/, a component named
// by itself lives wherever the code keeps it. Dependencies, caches, scratch and
// snapshots are not looked into.
const NAME_SKIP = new Set([...SKIP_DIRS, '.tmp', 'backups', '.cache', '.parcel-cache', '.turbo', '.vite',
  '.next', '.nuxt', '.astro', '.svelte-kit', 'coverage']);
function allNames() {
  const names = new Set();
  const stack = [''];
  let budget = 200000; // a pathological tree stops here rather than hanging the commit
  while (stack.length && budget > 0) {
    const relDir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(abs(relDir || '.'), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (--budget <= 0) break;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { if (!NAME_SKIP.has(e.name)) stack.push(relDir ? `${relDir}/${e.name}` : e.name); }
      else names.add(e.name);
    }
  }
  return names;
}
function checkD() {
  const gaps = [];
  let names = null;
  for (const rel of DOCS) {
    if (RECORD_DOC.test(rel)) continue;
    const lines = readLines(rel);
    if (!lines) continue;
    const fences = fenceMask(lines);
    const docDir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    lines.forEach((l, i) => {
      if (fences[i]) return;
      for (const m of l.matchAll(/`([^`]+)`/g)) {
        for (const { ref, bare } of refsIn(m[1])) {
          if (MADE_LATER.some((re) => re.test(ref))) continue;
          const wantDir = ref.endsWith('/');
          let found;
          if (bare) found = existsExact(ref) || (docDir && existsExact(`${docDir}/${ref}`)) || (names ??= allNames()).has(ref);
          else found = existsExact(ref.replace(/\/$/, ''), wantDir);
          if (!found) gaps.push({ rel, line: i + 1, ref });
        }
      }
    });
  }
  return gaps;
}

// ---- e. long dashes added in the window ---------------------------------------
function checkE(log) {
  const gaps = [];
  const seen = new Set();
  for (const d of log.dashes) { // newest commit first, so each line is credited to its latest addition
    // Exact case: on a disk that ignores case, a file renamed from lower to
    // upper case would otherwise still answer to its old name.
    const lines = existsExact(d.file) ? readLines(d.file) : null;
    if (!lines) continue; // the file is gone since
    // A fenced block in prose is an example, whichever dash it shows; the
    // inline code spans were already left out when the line was read.
    const fences = PROSE_FILE.test(d.file) ? fenceMask(lines) : null;
    lines.forEach((l, i) => {
      if (l !== d.text || (fences && fences[i])) return;
      const key = `${d.file}:${i + 1}`;
      if (seen.has(key)) return;
      seen.add(key);
      gaps.push({ ...d, line: i + 1 });
    });
  }
  return gaps.sort((x, y) => (x.file === y.file ? x.line - y.line : x.file < y.file ? -1 : 1));
}

// ---- f. .gitignore keeps out .tmp and backups --------------------------------
function globToRegex(p) {
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const end = p.indexOf(']', i + 1);
      if (end === -1) re += '\\[';
      else { re += `[${p.slice(i + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`; i = end; }
    } else if (c === '\\' && i + 1 < p.length) { re += p[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
function ignoresTopFolder(lines, name) {
  let ignored = false;
  for (const raw of lines) {
    let p = raw.replace(/\s+$/, '');
    if (!p || p.startsWith('#')) continue;
    let negate = false;
    if (p.startsWith('!')) { negate = true; p = p.slice(1); }
    p = p.replace(/^\*\*\//, '').replace(/^\//, '').replace(/\/\*\*$/, '').replace(/\/\*$/, '').replace(/\/$/, '');
    if (!p || p.includes('/')) continue;
    if (globToRegex(p).test(name)) ignored = !negate;
  }
  return ignored;
}
function checkF() {
  const lines = readLines('.gitignore');
  const wanted = [{ name: '.tmp', label: '/.tmp/' }, { name: 'backups', label: '/backups/' }];
  if (!lines) return { noFile: true, gaps: wanted.map((w) => w.label) };
  return { noFile: false, gaps: wanted.filter((w) => !ignoresTopFolder(lines, w.name)).map((w) => w.label) };
}

// ---- report ------------------------------------------------------------------
function run(label, fn) {
  try { return fn(); } catch (e) { return [`  ${label}: could not run (${e.message})`]; }
}

const out = [];
out.push(`Audit-project-records: ${ROOT}`);
out.push(`Window: the last ${DAYS} day${DAYS === 1 ? '' : 's'}, ${FROM} to ${TO}.`);
for (const n of notes) out.push(`Note: ${n}.`);

const git = hasGit();
let log = null;
if (git) {
  try { log = await readGitLog(); } catch (e) { log = { error: e.message }; }
}

out.push(...run('a. Days with commits but no History row', () => {
  const label = 'a. Days with commits but no History row';
  if (!git) return [`  ${label}: no git here`];
  if (log.error) return [`  ${label}: could not read git (${log.error})`];
  const gaps = checkA(log);
  return [`  ${label}: ${gaps.length}`, ...shown(gaps, (d) => `${d.date}  ${d.hashes.length} commit${d.hashes.length === 1 ? '' : 's'}: ${d.hashes.slice(0, 3).join(', ')}${d.hashes.length > 3 ? ', ...' : ''}`)];
}));
out.push(...run('b. Medium or high rows with no review result', () => {
  const label = 'b. Medium or high rows with no review result';
  const r = checkB();
  if (r.missing) return [`  ${label}: 0 (no project-os/History.md here)`];
  return [`  ${label}: ${r.gaps.length}`, ...shown(r.gaps, (g) => `${g.rel}:${g.line}  ${g.date}  ${g.risk}  ${g.task.length > 70 ? `${g.task.slice(0, 67)}...` : g.task}`)];
}));
out.push(...run('c. Placeholders left', () => {
  const gaps = checkC();
  return [`  c. Placeholders left: ${gaps.length}`, ...shown(gaps, (g) => `${g.rel}:${g.line}  ${g.token}`)];
}));
out.push(...run('d. References to missing files', () => {
  const gaps = checkD();
  return [`  d. References to missing files: ${gaps.length}`, ...shown(gaps, (g) => `${g.rel}:${g.line}  ${g.ref}`)];
}));
out.push(...run('e. Long dashes added in the window', () => {
  const label = 'e. Long dashes added in the window';
  if (!git) return [`  ${label}: no git here`];
  if (log.error) return [`  ${label}: could not read git (${log.error})`];
  const gaps = checkE(log);
  return [`  ${label}: ${gaps.length}`, ...shown(gaps, (g) => `${g.file}:${g.line}  ${g.kind}, added ${g.date} in ${g.hash.slice(0, 7)}`)];
}));
out.push(...run('f. .gitignore lines missing', () => {
  const r = checkF();
  const lines = [`  f. .gitignore lines missing: ${r.gaps.length}`];
  if (r.noFile) lines.push('       there is no .gitignore here');
  for (const g of r.gaps) lines.push(`       ${g} is not kept out of git`);
  return lines;
}));
out.push('Audit-project-records changes nothing and never blocks; each gap is the owner\'s to weigh.');
console.log(out.join('\n'));
process.exit(0);
