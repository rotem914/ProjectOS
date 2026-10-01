// Compare-kit-files.mjs - compares this project's copy of the kit with a fresh
// clone of the kit, file by file, and on the owner's word copies only the files
// that are safe to copy. It never deletes anything and never touches a living
// record.
//
// Why: the kit keeps fixing its guards, its scripts and its install law, and an
// installed project keeps the copy it was installed with. Copying a newer kit
// over the old one replaces History and Decisions with empty templates and
// undoes every calibration the install made, so until now an installed project
// was simply never updated. This tells, per file, who changed what since the
// install, from three copies of it:
//   BASE  the file in the kit at the commit this project was installed from
//         (project-os/Kit-version.json, or --base <commit>), read with
//         git -C <kit> show <base>:<path>
//   KIT   the file in the fresh clone now
//   HERE  the project's file
// It runs on the owner's `Go update kit` (CLAUDE.md, 2026-10-01), which fetches
// the kit into .tmp/projectos-kit with its full history: a clone made with
// --depth 1 has no BASE to read. With no BASE known, the report says to pass
// the kit commit named in the install row of project-os/History.md.
//
//   node project-os/Compare-kit-files.mjs --kit .tmp/projectos-kit                 report only
//   node project-os/Compare-kit-files.mjs --kit .tmp/projectos-kit --base 1a80938  name the base
//   node project-os/Compare-kit-files.mjs --kit .tmp/projectos-kit --apply         copy the safe ones
//   node project-os/Compare-kit-files.mjs --kit .tmp/projectos-kit --record        record the kit commit
//
// Run it from the project root. What each kind of file gets:
//   machinery   current | kit updated (HERE equals BASE, the kit changed it: safe
//               to copy) | changed here only (keep) | changed on both sides
//               (conflict: reported, never overwritten) | new in the kit (in
//               the kit and not here, nor at BASE: safe to copy) | removed
//               here (at BASE and deleted in this project: reported, never
//               copied back) | gone from the kit (reported, never deleted).
//               With no BASE known, a file in the kit and not here is still
//               "new in the kit", since there is nothing of the project's to
//               overwrite; any other file that differs is "cannot tell who
//               changed it" and is never copied.
//   calibrated  adapted at install, so never copied: the report says how many
//               lines the kit changed between BASE and KIT, and where, for the
//               assistant to carry over by hand like the install's merge step.
//               One that is new in the kit and missing here is reported as
//               "new in the kit: copy it by hand and fill its setup block".
//   record      a living record of this project: never compared, never touched.
//               The kit's own template of it is read, though: the report says
//               how many of its lines changed between BASE and KIT, so an
//               instruction change can be carried over by hand (2026-10-01).
// Without --apply or --record it writes nothing.
// With --apply it copies only "kit updated" and "new in the kit" machinery.
// It then writes project-os/Kit-version.json with the clone's short HEAD and
// today's date, but only when nothing is left to carry over by hand: no
// machinery file "changed on both sides" or "cannot tell who changed it", and
// no calibrated file the kit changed or added that this copy does not match
// yet. While one is left it writes no version and names those files, to be
// carried over by hand and then recorded with --record. Recording the base
// sooner would hide the kit's changes to them for good: the next compare
// would read each machinery file as changed here only and each calibrated
// one as unchanged in the kit (2026-10-01). A machinery file removed here
// never holds the version back, since the project chose to be without it.
// With --record it writes the same two fields once those files are carried
// over, and first prints every machinery and calibrated file that still
// differs from the kit, so recording a base is a step taken knowingly. It
// takes no --base, is never combined with --apply, and copies nothing.
// Exit 0 on success; 1 on a usage error, a kit folder that is missing, a copy
// that failed, or a version that could not be written.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Every kit path this script knows, and what the install does with it. ONE
// list, so a new kit file is classified in one place (2026-10-01). A kit file
// missing from it is reported as unlisted and left alone.
const KIT_FILES = [
  // machinery: the install copies it as it is.
  { path: 'Installation.md', kind: 'machinery' },
  { path: 'project-os/guards/Path-guard.mjs', kind: 'machinery' },
  { path: 'project-os/guards/Destructive-guard.mjs', kind: 'machinery' },
  { path: 'project-os/Install-project-hooks.mjs', kind: 'machinery' },
  { path: 'project-os/Find-heavy-files.mjs', kind: 'machinery' },
  { path: 'project-os/Archive-old-rows.ps1', kind: 'machinery' },
  { path: 'project-os/Archive-old-rows.mjs', kind: 'machinery' },
  { path: 'project-os/Audit-project-records.mjs', kind: 'machinery' },
  { path: 'project-os/Compare-kit-files.mjs', kind: 'machinery' },
  { path: 'project-os/Hooks.md', kind: 'machinery' },
  { path: 'project-os/Rule-reasons.md', kind: 'machinery' },
  // calibrated: the install fills placeholders, setup blocks or wording in it.
  { path: 'CLAUDE.md', kind: 'calibrated' },
  { path: 'project-os/Workflow.md', kind: 'calibrated' },
  { path: 'project-os/QA.md', kind: 'calibrated' },
  { path: 'project-os/Conversations.md', kind: 'calibrated' },
  { path: 'project-os/Code_review.md', kind: 'calibrated' },
  { path: 'project-os/Visual_QA.md', kind: 'calibrated' },
  { path: 'project-os/mcp/Figma/Figma_MCP_Rules.md', kind: 'calibrated' },
  { path: 'project-os/mcp/Google_analytics/Google_Analytics_MCP_Rules.md', kind: 'calibrated' },
  { path: 'project-os/Hooks-settings.json', kind: 'calibrated' },
  { path: 'project-os/Backup-whole-project.ps1', kind: 'calibrated' }, // its exclusion list is set at install
  { path: 'project-os/Backup-whole-project.mjs', kind: 'calibrated' }, // the same setup block
  // record: this project's own history, never touched.
  { path: 'project-os/History.md', kind: 'record' },
  { path: 'project-os/History-archive.md', kind: 'record' },
  { path: 'project-os/History-scan-archive.md', kind: 'record' },
  { path: 'project-os/Decisions.md', kind: 'record' },
  { path: 'project-os/Decisions-archive.md', kind: 'record' },
  { path: 'project-os/Backlog.md', kind: 'record' },
  { path: 'project-os/Backlog-archive.md', kind: 'record' },
  { path: 'project-os/Map.md', kind: 'record' },
  { path: 'project-os/BugAtlas.md', kind: 'record' },
  { path: 'project-os/BugAtlas-archive.md', kind: 'record' },
  { path: 'project-os/Mistakes.md', kind: 'record' },
  { path: 'project-os/Mistakes-archive.md', kind: 'record' },
  { path: 'project-os/Plan.md', kind: 'record' },
  { path: 'project-os/Kit-version.json', kind: 'record' },
];
const VERSION_FILE = 'project-os/Kit-version.json';
const RECORDS = new Set(KIT_FILES.filter((f) => f.kind === 'record').map((f) => f.path));

// ---- arguments -------------------------------------------------------------
const USAGE = [
  'usage: node project-os/Compare-kit-files.mjs --kit <folder of a fresh kit clone> [--base <commit>] [--apply]',
  '       node project-os/Compare-kit-files.mjs --kit <folder of a fresh kit clone> --record',
  '  --apply   copy the safe files; record the kit commit only when no file is left to carry over by hand',
  '  --record  record the kit commit once those files are carried over (prints what still differs first)',
].join('\n');
function usageError(msg) {
  console.log(`Compare-kit-files: ${msg}`);
  console.log(USAGE);
  process.exit(1);
}
let kitArg = null;
let baseArg = null;
let APPLY = false;
let RECORD = false;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const eq = a.indexOf('=');
  const name = a.startsWith('--') && eq !== -1 ? a.slice(0, eq) : a;
  const inline = a.startsWith('--') && eq !== -1 ? a.slice(eq + 1) : null;
  if (name === '--kit' || name === '--base') {
    const v = inline ?? argv[++i];
    if (!v || (inline === null && v.startsWith('--'))) usageError(`${name} needs a value.`);
    if (name === '--kit') kitArg = v; else baseArg = v;
  } else if (a === '--apply') APPLY = true;
  else if (a === '--record') RECORD = true;
  else usageError(`unknown argument "${a}".`);
}
if (!kitArg) usageError('--kit is required.');
// Two steps, never one: --apply copies and names what is left, the assistant
// carries that over by hand, and only then --record writes the base.
if (APPLY && RECORD) usageError('--apply and --record are separate steps: --apply first, then --record once the files it names are carried over by hand.');
if (RECORD && baseArg !== null) usageError('--record takes no --base: it records the commit the kit clone is at now.');
if (baseArg !== null && !/^[\w./-]+$/.test(baseArg)) usageError(`--base "${baseArg}" is not a commit name.`);
if (baseArg !== null && baseArg.startsWith('-')) usageError(`--base "${baseArg}" is not a commit name.`);

const ROOT = process.cwd();
const KIT = path.resolve(ROOT, kitArg);
if (!fs.existsSync(KIT) || !fs.statSync(KIT).isDirectory()) {
  console.log(`Compare-kit-files: the kit folder ${KIT} does not exist. Fetch the kit first (git clone https://github.com/rotem914/ProjectOS .tmp/projectos-kit).`);
  process.exit(1);
}
if (!fs.existsSync(path.join(KIT, 'project-os')) || !fs.existsSync(path.join(KIT, 'Installation.md'))) {
  usageError(`${KIT} is not a ProjectOS kit: it has no project-os/ folder or no Installation.md.`);
}
if (!fs.existsSync(path.join(ROOT, 'project-os'))) usageError(`run it from an installed project's root; ${ROOT} has no project-os/ folder.`);
const same = (a, b) => (process.platform === 'win32' || process.platform === 'darwin' ? a.toLowerCase() === b.toLowerCase() : a === b);
if (same(path.resolve(KIT), path.resolve(ROOT))) usageError('the kit folder is this project itself; point --kit at a fresh clone.');

// ---- reading the three copies ------------------------------------------------
const abs = (root, rel) => path.join(root, ...rel.split('/'));
function readBuf(root, rel) {
  try {
    const p = abs(root, rel);
    return fs.statSync(p).isFile() ? fs.readFileSync(p) : null;
  } catch { return null; }
}
// Compared as text with line endings evened out: a project whose git turns LF
// into CRLF on checkout holds the same file the kit does.
const norm = (buf) => {
  if (buf === null || buf === undefined) return buf;
  let s = buf.toString('utf8');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return s.replace(/\r\n/g, '\n');
};

function git(args, opts = {}) {
  return spawnSync('git', ['-C', KIT, '-c', 'core.quotePath=false', ...args], { maxBuffer: 256 * 1024 * 1024, ...opts });
}
// The kit folder must be a repository of its own. A ZIP unpacked into the
// project's .tmp/ sits inside the project's repository, and asking git there
// would read the project's history as if it were the kit's.
const kitIsGit = (() => {
  const r = git(['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (r.error || r.status !== 0 || !r.stdout.trim()) return false;
  try { return same(fs.realpathSync(r.stdout.trim()), fs.realpathSync(KIT)); } catch { return false; }
})();
const kitHead = kitIsGit ? (git(['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout || '').trim() || null : null;

// Where the base comes from: --base wins, then Kit-version.json. --record
// needs none: it records the commit the clone is at.
const notes = [];
let baseName = null;
let baseFrom = null;
// What to do with no base, said the same way wherever one is missing: the
// install row names the commit, and git can read it only from a full clone.
const FIND_BASE = 'pass the kit commit named in the install row of project-os/History.md with --base <commit>. The kit clone needs its full history for git to read that commit: a clone made with --depth 1 has none.';
if (RECORD) { /* no base to read */ }
else if (baseArg !== null) { baseName = baseArg; baseFrom = '--base'; }
else {
  const vbuf = readBuf(ROOT, VERSION_FILE);
  if (vbuf === null) notes.push(`no ${VERSION_FILE} here, so the base is unknown: ${FIND_BASE}`);
  else {
    try {
      const v = JSON.parse(norm(vbuf));
      const c = typeof v.commit === 'string' ? v.commit.trim() : '';
      if (/^[0-9a-f]{4,40}$/i.test(c)) { baseName = c; baseFrom = VERSION_FILE; }
      else notes.push(`${VERSION_FILE} names no commit ("${c}"), so the base is unknown: ${FIND_BASE}`);
    } catch (e) {
      notes.push(`${VERSION_FILE} is not valid JSON (${e.message}), so the base is unknown: ${FIND_BASE}`);
    }
  }
}
let BASE = null; // the full commit id, once proven to be in the clone
if (baseName !== null) {
  if (!kitIsGit) notes.push(`the kit folder is not a git clone, so the base ${baseName} cannot be read. Fetch the kit with git, full history.`);
  else {
    const r = git(['rev-parse', '--verify', '--quiet', `${baseName}^{commit}`], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) BASE = r.stdout.trim();
    else notes.push(`the base ${baseName} (from ${baseFrom}) is not in the kit clone. The clone needs its full history: a clone made with --depth 1 has none, so fetch it again without --depth. If the base is still missing then, pass the kit commit named in the install row of project-os/History.md with --base <commit>.`);
  }
}
let baseTree = null;
if (BASE) {
  const r = git(['ls-tree', '-r', '-z', '--name-only', BASE]);
  baseTree = new Set(String(r.stdout || '').split('\0').filter(Boolean));
}
const baseText = (rel) => {
  if (!BASE) return undefined; // unknown
  if (!baseTree.has(rel)) return null; // absent at the base
  const r = git(['show', `${BASE}:${rel}`]);
  return r.status === 0 ? norm(r.stdout) : null;
};

// ---- the comparison ------------------------------------------------------------
function machineryStatus(rel) {
  const b = baseText(rel);
  const k = norm(readBuf(KIT, rel));
  const h = norm(readBuf(ROOT, rel));
  if (k === null && h === null) return null; // nothing on either side: nothing to say
  if (k !== null && h !== null && k === h) return 'current';
  if (b === undefined) {
    if (k === null) return 'gone from the kit';
    // Who changed a file both sides hold cannot be told without a base. A file
    // only the kit has is another matter: copying it overwrites nothing of the
    // project's, so it is new in the kit with or without a base (2026-10-01).
    // Installation.md is the exception: every install places it, so a project
    // without it is one whose owner deleted it, and it is never brought back.
    if (h === null) return rel === 'Installation.md' ? 'removed here' : 'new in the kit';
    return 'cannot tell who changed it';
  }
  if (b === null) {
    if (k === null) return 'changed here only'; // the project's own file under a kit name
    return h === null ? 'new in the kit' : 'changed on both sides';
  }
  // At the base and gone from here: the project deleted it, and a deleted file
  // is never brought back. The README and Installation.md let the owner delete
  // Installation.md after the install, and before this status it read as
  // changed on both sides at every kit change to it, for good (2026-10-01).
  if (h === null) return 'removed here';
  if (k === null) return 'gone from the kit';
  if (h === b) return 'kit updated';
  if (k === b) return 'changed here only';
  return 'changed on both sides';
}

// The kit's own changes to a calibrated file or a record's template, as the
// line ranges git reports between BASE and the clone's working tree.
function kitChanges(rel) {
  const r = git(['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--unified=0', BASE, '--', rel], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  let added = 0;
  let removed = 0;
  const places = [];
  for (const line of String(r.stdout).split('\n')) {
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (h) {
      const start = Number(h[1]);
      const n = h[2] === undefined ? 1 : Number(h[2]);
      places.push(n === 0 ? `after line ${start}` : n === 1 ? `line ${start}` : `lines ${start}-${start + n - 1}`);
      continue;
    }
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added++;
    else if (line.startsWith('-')) removed++;
  }
  return { added, removed, places };
}
// The kit's changes to one file between BASE and KIT, said in one phrase.
function changesText(c) {
  const shown = c.places.slice(0, 8).join(', ') + (c.places.length > 8 ? `, and ${c.places.length - 8} more` : '');
  const n = c.added + c.removed;
  return `${n} line${n === 1 ? '' : 's'} (+${c.added} -${c.removed}) in ${c.places.length} place${c.places.length === 1 ? '' : 's'}: ${shown}`;
}
const diffCommand = (rel) => `git -C "${KIT}" diff ${BASE.slice(0, 7)} -- ${rel}`;

// Each calibrated file gets a line of text, and `open` when the kit's side of
// it still has to be carried over by hand. An open file holds back the version
// --apply writes, exactly as a conflict does: once the base moves to the kit's
// HEAD, the next compare reads it as unchanged in the kit and the change is
// never shown again (2026-10-01). A copy that already matches the kit word for
// word has nothing left to carry, and one the project removed has nowhere to
// carry it, so neither is open.
function calibratedReport(rel) {
  const b = baseText(rel);
  const k = norm(readBuf(KIT, rel));
  const h = norm(readBuf(ROOT, rel));
  if (k === null && h === null && !b) return null;
  const matches = k !== null && h === k;
  if (b === undefined) {
    if (k === null) return { text: 'not in the kit now; report only' };
    if (h === null) return { text: 'in the kit, not here (removed at install, or new in the kit); bring it over by hand if this project needs it', open: true, why: 'in the kit, not here, and no base to tell why' };
    return matches ? { text: 'same as the kit' } : { text: 'no base, so the kit\'s own changes cannot be told from this project\'s calibration; compare by hand', open: true, why: 'no base to tell the kit\'s changes from this project\'s' };
  }
  if (k === null) return { text: b === null ? 'not in the kit; report only' : 'gone from the kit; report only, nothing deleted' };
  if (b === null) {
    // Never copied, since its setup block is this project's to fill, and shown
    // on every compare until it exists here (2026-10-01).
    if (h === null) return { text: 'new in the kit: copy it by hand and fill its setup block', open: true, why: 'new in the kit: copy it by hand and fill its setup block' };
    return matches ? { text: 'new in the kit, and this project already has the same file' } : { text: 'new in the kit, and this project has its own: compare by hand', open: true, why: 'new in the kit, and this project has its own' };
  }
  if (b === k) return { text: `unchanged in the kit${h === null ? '; not here (removed at install?)' : ''}` };
  const c = kitChanges(rel);
  if (!c) return { text: 'changed in the kit; git could not list the lines, compare by hand', open: h !== null && !matches, why: 'changed in the kit' };
  const tail = h === null ? '; not here (removed here, so nothing to carry over)' : matches ? '; this copy already matches the kit' : '';
  return {
    text: `the kit changed ${changesText(c)}${tail}`,
    open: h !== null && !matches,
    why: `changed in the kit, ${c.added + c.removed} line${c.added + c.removed === 1 ? '' : 's'}`,
    diff: diffCommand(rel),
  };
}

// The kit's own template of a living record: what changed in it between BASE
// and KIT, never copied. A record is this project's history, but its template
// carries the rules for writing it (the History row shape, the Decisions
// entry), and a change there reaches the project only by hand (2026-10-01).
function recordTemplateReport(rel) {
  const b = baseText(rel);
  if (b === undefined) return null; // no base: said once, for all of them
  const k = norm(readBuf(KIT, rel));
  if (k === null && b === null) return null; // not a kit template, like an archive
  if (b === k) return null;
  if (b === null) {
    const n = k.split('\n').length - (k.endsWith('\n') ? 1 : 0);
    return { text: `new in the kit's templates, ${n} line${n === 1 ? '' : 's'}: read it and carry over what applies` };
  }
  if (k === null) return { text: 'gone from the kit\'s templates; report only, nothing deleted' };
  const c = kitChanges(rel);
  if (!c) return { text: 'the kit changed its template; git could not list the lines, compare by hand' };
  return { text: `the kit's template changed ${changesText(c)}`, diff: diffCommand(rel) };
}

// Kit files no entry above names: reported, never copied. Only what an install
// carries is looked at: the two root files and project-os/.
function kitPaths() {
  const out = [];
  for (const f of ['CLAUDE.md', 'Installation.md']) if (fs.existsSync(abs(KIT, f))) out.push(f);
  const walk = (rel) => {
    let entries;
    try { entries = fs.readdirSync(abs(KIT, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = `${rel}/${e.name}`;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { if (!['node_modules', '.venv', '.git'].includes(e.name)) walk(p); }
      else if (e.isFile()) out.push(p);
    }
  };
  walk('project-os');
  return out;
}

const STATUS_ORDER = ['changed on both sides', 'cannot tell who changed it', 'kit updated', 'new in the kit', 'changed here only', 'removed here', 'gone from the kit', 'current'];
const NOTE = {
  'current': '',
  'kit updated': 'safe to copy',
  'new in the kit': 'safe to copy',
  'changed here only': 'keep',
  'removed here': 'deleted in this project: never copied back',
  'changed on both sides': 'conflict: merge by hand, never overwritten',
  'gone from the kit': 'report only, nothing deleted',
  'cannot tell who changed it': 'no base: never copied, compare by hand',
};

const machinery = [];
for (const f of KIT_FILES.filter((x) => x.kind === 'machinery')) {
  const status = machineryStatus(f.path);
  if (status) machinery.push({ path: f.path, status });
}
machinery.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || (a.path < b.path ? -1 : 1));
const calibrated = [];
for (const f of KIT_FILES.filter((x) => x.kind === 'calibrated')) {
  const r = calibratedReport(f.path);
  if (r) calibrated.push({ path: f.path, ...r });
}
const listed = new Set(KIT_FILES.map((f) => f.path));
const unlisted = kitPaths().filter((p) => !listed.has(p)).sort();
const recordsHere = KIT_FILES.filter((f) => f.kind === 'record' && readBuf(ROOT, f.path) !== null).length;
const templates = [];
for (const f of KIT_FILES.filter((x) => x.kind === 'record')) {
  const r = recordTemplateReport(f.path);
  if (r) templates.push({ path: f.path, ...r });
}

// ---- writing ---------------------------------------------------------------------
// Each copy goes to a temporary name beside the file and is then renamed over
// it, so a crash mid-write never leaves half a guard in place.
function writeAtomic(rel, data) {
  if (RECORDS.has(rel)) throw new Error(`${rel} is a living record and is never written`);
  const dest = abs(ROOT, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp`;
  fs.writeFileSync(tmp, data);
  try { fs.renameSync(tmp, dest); } catch (e) { try { fs.unlinkSync(tmp); } catch { /* already gone */ } throw e; }
}
const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
// The one record this script writes, the same way: a temporary name, then a
// rename over the old one.
function writeVersion() {
  const dest = abs(ROOT, VERSION_FILE);
  const tmp = `${dest}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ commit: kitHead, date: today }, null, 2)}\n`);
  try { fs.renameSync(tmp, dest); } catch (e) { try { fs.unlinkSync(tmp); } catch { /* already gone */ } throw e; }
}
// The --record command for this kit folder, quoted when its path has a space.
const recordCommand = `node project-os/Compare-kit-files.mjs --kit ${/\s/.test(kitArg) ? `"${kitArg}"` : kitArg} --record`;

// ---- report ------------------------------------------------------------------
const out = [];
out.push(`Compare-kit-files: project ${ROOT}`);
out.push(`Kit: ${KIT}${kitHead ? ` at ${kitHead}` : ' (not a git clone)'}`);
if (!RECORD) out.push(`Base: ${BASE ? `${BASE.slice(0, 7)} (from ${baseFrom})` : 'unknown'}`);
for (const n of notes) out.push(`Note: ${n}`);

// The list above lives in this script, so an older copy of it does not know a
// file a newer kit added. Say so, with the command that runs the kit's own copy.
const KIT_SELF = abs(KIT, 'project-os/Compare-kit-files.mjs');
const SELF = fileURLToPath(import.meta.url);
if (fs.existsSync(KIT_SELF) && !same(path.resolve(KIT_SELF), path.resolve(SELF)) && norm(fs.readFileSync(KIT_SELF)) !== norm(fs.readFileSync(SELF))) {
  out.push(`Note: the kit carries a different Compare-kit-files.mjs, whose list may name files this copy does not. For the kit's own list, run: node "${KIT_SELF}" --kit "${KIT}"${baseArg ? ` --base ${baseArg}` : ''}${RECORD ? ' --record' : ''}`);
}

// ---- record --------------------------------------------------------------------
// The step after the files --apply named are carried over by hand. Every
// machinery and calibrated file that still differs from the kit is printed
// before the base is written, since from then on the kit's side of each one is
// no longer shown: a machinery file reads as this project's own, and a
// calibrated one as unchanged in the kit. A calibrated file is listed too, so
// one the kit added and nobody copied over is seen before it drops out of the
// report (2026-10-01).
if (RECORD) {
  out.push('');
  if (!kitHead) {
    out.push(`${VERSION_FILE} was not written: the kit folder is not a git clone, so its commit is unknown. Fetch the kit with git, full history, and run --record against that clone.`);
    console.log(out.join('\n'));
    process.exit(1);
  }
  const differing = (kind) => {
    const list = [];
    for (const f of KIT_FILES.filter((x) => x.kind === kind)) {
      const k = norm(readBuf(KIT, f.path));
      const h = norm(readBuf(ROOT, f.path));
      if (k === h) continue; // the same, or on neither side
      list.push({ path: f.path, how: k === null ? 'not in the kit' : h === null ? 'not here' : 'differs' });
    }
    return list;
  };
  const listOut = (list) => {
    const w = Math.max(...list.map((d) => d.how.length));
    for (const d of list) out.push(`  ${d.how.padEnd(w)}  ${d.path}`);
  };
  const differ = differing('machinery');
  const calDiffer = differing('calibrated');
  if (!differ.length) out.push('Every machinery file matches the kit.');
  else {
    out.push(`Machinery that still differs from the kit (${differ.length}), recorded as this project's own from now on:`);
    listOut(differ);
  }
  if (!calDiffer.length) out.push('Every calibrated file matches the kit.');
  else {
    out.push(`Calibrated files that still differ from the kit (${calDiffer.length}), their calibration or a kit change not carried over:`);
    listOut(calDiffer);
  }
  try { writeVersion(); } catch (e) {
    out.push(`Could not write ${VERSION_FILE}: ${e.message}`);
    console.log(out.join('\n'));
    process.exit(1);
  }
  out.push(`Wrote ${VERSION_FILE}: commit ${kitHead}, ${today}.`);
  if (differ.length) {
    const removed = differ.filter((d) => d.how === 'not here').length;
    const kept = differ.length - removed;
    const said = [kept ? `${kept} as changed here only` : '', removed ? `${removed} as removed here` : ''].filter(Boolean).join(' and ');
    out.push(`From here on the kit at ${kitHead} is the base, so the next compare reads ${differ.length === 1 ? 'that machinery file' : `those ${differ.length} machinery files`} as this project's own: ${said}.`);
  }
  if (calDiffer.length) out.push(`For ${calDiffer.length === 1 ? 'that calibrated file' : `those ${calDiffer.length} calibrated files`}, the next compare shows only what the kit changes after ${kitHead}.`);
  console.log(out.join('\n'));
  process.exit(0);
}

out.push('');
out.push('Machinery (the install copies these as they are):');
const width = Math.max(...STATUS_ORDER.map((s) => s.length));
if (!machinery.length) out.push('  none on either side');
for (const m of machinery) out.push(`  ${m.status.padEnd(width)}  ${m.path}${NOTE[m.status] ? `  (${NOTE[m.status]})` : ''}`);

out.push('');
out.push('Calibrated at install (never copied; carry the kit\'s changes over by hand):');
if (!calibrated.length) out.push('  none on either side');
for (const c of calibrated) {
  out.push(`  ${c.path}: ${c.text}`);
  if (c.diff) out.push(`    full diff: ${c.diff}`);
}

out.push('');
out.push(`Living records: never touched (${recordsHere} here).`);
// Their templates are read, never copied: an instruction change in one is
// carried over by hand (see recordTemplateReport).
if (!BASE) out.push('  no base, so the kit\'s changes to their templates cannot be told');
else if (!templates.length) out.push('  the kit\'s templates for them are unchanged since the base');
for (const r of templates) {
  out.push(`  ${r.path}: ${r.text}. Nothing copied; carry an instruction change over by hand.`);
  if (r.diff) out.push(`    full diff: ${r.diff}`);
}
if (unlisted.length) {
  out.push('');
  out.push('In the kit but not in this script\'s list (nothing done):');
  for (const p of unlisted) out.push(`  ${p}`);
}

const count = (s) => machinery.filter((m) => m.status === s).length;
const safe = machinery.filter((m) => m.status === 'kit updated' || m.status === 'new in the kit');
// The files that keep the base from being recorded: the kit's side of each
// still has to be carried over by hand (see the header). Machinery first, by
// status, then the calibrated files the kit changed or added (2026-10-01).
const blockers = [
  ...machinery.filter((m) => m.status === 'changed on both sides' || m.status === 'cannot tell who changed it').map((m) => ({ path: m.path, why: m.status })),
  ...calibrated.filter((c) => c.open).map((c) => ({ path: c.path, why: `calibrated, ${c.why}` })),
];
const calOpen = calibrated.filter((c) => c.open).length;
const files = (n) => `${n} file${n === 1 ? '' : 's'}`;
out.push('');
out.push(`Summary: ${count('kit updated')} kit updated, ${count('new in the kit')} new in the kit, ${count('changed on both sides')} conflict${count('changed on both sides') === 1 ? '' : 's'}, ${count('cannot tell who changed it')} cannot tell, ${count('changed here only')} changed here only, ${count('removed here')} removed here, ${count('gone from the kit')} gone from the kit, ${calOpen} calibrated file${calOpen === 1 ? '' : 's'} to carry over, ${templates.length} record template${templates.length === 1 ? '' : 's'} changed.`);

if (!APPLY) {
  const copies = safe.length ? ` --apply copies the ${safe.length} safe file${safe.length === 1 ? '' : 's'}${blockers.length ? '' : ' and records the kit commit'}.` : '';
  const one = blockers.length === 1;
  const held = blockers.length ? ` --apply writes no ${VERSION_FILE} while ${files(blockers.length)} ${one ? 'is' : 'are'} left to carry over by hand (a conflict, no telling who changed it, or a calibrated file the kit changed or added): carry ${one ? 'it' : 'them'} over by hand, then record the kit commit with --record.` : '';
  out.push(`Report only: nothing was written.${copies}${held}`);
  console.log(out.join('\n'));
  process.exit(0);
}

// ---- apply ---------------------------------------------------------------------
out.push('');
let failed = 0;
const copied = [];
for (const m of safe) {
  try { writeAtomic(m.path, readBuf(KIT, m.path)); copied.push(m.path); } catch (e) { failed++; out.push(`Could not copy ${m.path}: ${e.message}`); }
}
out.push(copied.length ? `Copied from the kit: ${copied.join(', ')}` : 'Copied from the kit: nothing was safe to copy.');
if (failed) {
  out.push(`${failed} cop${failed === 1 ? 'y' : 'ies'} failed, so ${VERSION_FILE} was left as it was.`);
  console.log(out.join('\n'));
  process.exit(1);
}
if (blockers.length) {
  // No version while one is left: with the kit's HEAD as the base, the next
  // compare would read each machinery file here as changed here only and each
  // calibrated one as unchanged in the kit, and the kit's changes to them
  // would never be shown again (2026-10-01).
  const one = blockers.length === 1;
  out.push(`${VERSION_FILE} was not written: ${files(blockers.length)} ${one ? 'is' : 'are'} still left to carry over by hand:`);
  for (const m of blockers) out.push(`  ${m.path}: ${m.why}`);
  out.push(`Carry ${one ? 'it' : 'them'} over from the kit by hand, then record the kit commit: ${recordCommand}`);
  out.push(`Recording before that would hide the kit's changes to ${one ? 'it' : 'them'} for good: the next compare would measure from the kit as it is now, and read a machinery file as changed here only and a calibrated one as unchanged in the kit.`);
  if (!kitHead) out.push('The kit folder is not a git clone, so --record cannot name its commit either: fetch the kit with git, full history.');
} else if (!kitHead) {
  out.push(`${VERSION_FILE} was not written: the kit folder is not a git clone, so its commit is unknown.`);
} else {
  try { writeVersion(); } catch (e) {
    out.push(`Could not write ${VERSION_FILE}: ${e.message}`);
    console.log(out.join('\n'));
    process.exit(1);
  }
  out.push(`Wrote ${VERSION_FILE}: commit ${kitHead}, ${today}.`);
  // A record's template never holds the version back, since a record is never
  // copied; but from here on the kit at kitHead is the base, so a change to a
  // template will not show again. Name each one while it still can be seen.
  if (templates.length) out.push(`The kit also changed the template of ${templates.map((r) => r.path).join(', ')}. Carry any instruction change in ${templates.length === 1 ? 'it' : 'them'} over by hand now: the next compare against kit ${kitHead} will no longer show it.`);
}
console.log(out.join('\n'));
process.exit(0);
