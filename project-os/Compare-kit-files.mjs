// Compare-kit-files.mjs - compares this project's copy of the kit with a fresh
// clone of the kit, file by file, and on the owner's word copies only the files
// that are safe to copy and writes only the merges that came out clean. It
// never deletes anything outside its own review folder, .tmp/kit-merge/, and
// never touches a living record.
//
// Why: the kit keeps fixing its guards, its scripts and its install law, and an
// installed project keeps the copy it was installed with. Copying a newer kit
// over the old one replaces History and Decisions with empty templates and
// undoes every calibration the install made, so until now an installed project
// was simply never updated. This tells, per file, who changed what since the
// install, from three copies of it:
//   BASE  the file in the kit at the commit this project was installed from
//         (project-os/Kit-version.json, or --base <commit>, or found in the
//         kit's history when neither names one), read with
//         git -C <kit> show <base>:<path>
//   KIT   the file in the fresh clone now
//   HERE  the project's file
// It runs on the owner's `Go update kit` (CLAUDE.md, 2026-10-01), which fetches
// the kit into .tmp/projectos-kit with its full history: a clone made with
// --depth 1 has no BASE to read. A project copied in by hand or from a ZIP
// records no BASE, so its scripts and guards name it instead: the kit's history
// is searched for the commit whose copies of them all match this project's,
// line endings aside (2026-10-02). That search reads every commit the clone
// holds, so it needs the full history too; a --depth 1 clone recognises only
// its newest commit. When nothing matches, the report says to pass the kit
// commit named in the install row of project-os/History.md.
//
//   node project-os/Compare-kit-files.mjs --kit .tmp/projectos-kit                 report only
//   node project-os/Compare-kit-files.mjs --kit .tmp/projectos-kit --base 1a80938  name the base
//   node project-os/Compare-kit-files.mjs --kit .tmp/projectos-kit --apply         copy the safe ones
//   node project-os/Compare-kit-files.mjs --kit .tmp/projectos-kit --record        record the kit commit
//
// The install runs that last line too, right after it copies the kit in, from
// its own --depth 1 fetch: every file still matches that one commit, so the
// project knows its kit from the first minute (2026-10-02).
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
//   calibrated  adapted at install, so never copied over as it is: the report
//               says how many lines the kit changed between BASE and KIT, and
//               where, and merges those changes into this copy with git
//               merge-file. Both kit copies are first filled with this
//               project's own values (its name, its owner, its address, its
//               check command), read from its files: a filled-in value is not
//               this project's own wording, and merged unfilled it read as a
//               clash at every line the kit touched or wrote next to
//               (2026-10-02). The owner's answer the install writes in place
//               of a bracketed choice, and the marks it writes after a value
//               nothing can run yet, are read the same way. A line counts as
//               filled only when the values give exactly that line; one
//               holding a placeholder filled two ways, or any added wording,
//               stays this project's own. Each merge goes to
//               .tmp/kit-merge/<path> for review, with the filled kit copies
//               under .tmp/kit-merge/.inputs/. The report says per file:
//               already carried, merged cleanly, merged but bringing a
//               placeholder nothing here fills, or each clash with its lines,
//               a setup block or a mark the install wrote told apart from this
//               project's own wording. One that is new in the kit and missing
//               here is reported as "new in the kit: copy it by hand and fill
//               its setup block".
//   record      a living record of this project: never compared, never touched.
//               The kit's own template of it is read, though: the report says
//               how many of its lines changed between BASE and KIT, so an
//               instruction change can be carried over by hand (2026-10-01).
// Without --apply or --record it writes nothing in this project but that
// review folder, which each compare empties and fills again.
// With --apply it copies only "kit updated" and "new in the kit" machinery,
// and writes each calibrated merge that came out clean over this project's
// copy, in that copy's line endings. It then writes project-os/Kit-version.json
// with the clone's short HEAD and today's date, but only when nothing is left
// to carry over by hand: no machinery file "changed on both sides" or "cannot
// tell who changed it", and no calibrated file with a clash, a placeholder to
// fill, a kit change git could not merge, or one new in the kit that this copy
// does not match yet. While one is left it writes no version and names those
// files, to be carried over by hand and then recorded with --record. Recording
// the base sooner would hide the kit's changes to them for good: the next
// compare would read each machinery file as changed here only and each
// calibrated one as unchanged in the kit (2026-10-01). A machinery file
// removed here never holds the version back, since the project chose to be
// without it. A base found in the kit's history is the exception: while files
// are left, --apply writes that base before it copies anything, since the
// copies would hide it from the next search (2026-10-02). When the CLAUDE.md
// it writes carries changed Go update kit steps, its last line says to finish
// the update with those (2026-10-02).
// With --record it writes the same two fields once those files are carried
// over, and first prints every machinery and calibrated file that still
// differs from the kit, so recording a base is a step taken knowingly. With no
// base recorded and this project's scripts and guards matching an older kit
// commit than the clone's HEAD, it records that commit instead: these files
// came from it. It takes no --base, is never combined with --apply, and copies
// nothing.
// Exit 0 on success; 1 on a usage error, a kit folder that is missing, a copy
// or a merge that could not be written, or a version that could not be written.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
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
  '  --apply   copy the safe files and write the clean merges; record the kit commit only when no file is left to carry over by hand',
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
const kitHeadFull = kitIsGit ? (git(['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout || '').trim() || null : null;
const toLines = (s) => {
  const a = s.split('\n');
  if (a[a.length - 1] === '') a.pop();
  return a;
};

// ---- finding the base no file records ----------------------------------------
// A project whose files were copied in by hand, or unpacked from a ZIP, has no
// Kit-version.json, and without a base every file both sides hold that differs
// is "cannot tell who changed it", never copied, for good (2026-10-02). Its
// scripts and guards still say which kit it came from: the install copies
// them as they are and never adjusts them, so the kit commit whose copies all
// match this project's, line endings aside, is the one these files came from.
// The search reads every commit the clone holds, so it needs the kit's full
// history: a clone made without --depth. A --depth 1 clone holds only its
// newest commit, and recognises only a project that runs exactly that one.
const MATCHED = KIT_FILES.filter((f) => f.kind === 'machinery' && /\.(mjs|ps1)$/.test(f.path)).map((f) => f.path);
function catFile(mode, names, encoding) {
  const r = git(['cat-file', mode], { input: `${names.join('\n')}\n`, ...(encoding ? { encoding } : {}) });
  return r.error || r.status !== 0 ? null : r.stdout;
}
const blobOf = (line) => {
  const m = /^([0-9a-f]+) blob \d+$/.exec(line);
  return m ? m[1] : null;
};
// The ids git would give a text, LF and CRLF alike: a kit commit made before
// its .gitattributes may hold either.
function blobIds(text, algo) {
  return [text, text.replace(/\n/g, '\r\n')].map((t) => {
    const b = Buffer.from(t, 'utf8');
    return crypto.createHash(algo).update(`blob ${b.length}\0`).update(b).digest('hex');
  });
}
const shortOf = (c) => (git(['rev-parse', '--short', c], { encoding: 'utf8' }).stdout || '').trim() || c.slice(0, 7);
function findBase() {
  if (!kitIsGit) return null;
  const mine = MATCHED.map((p) => ({ p, h: norm(readBuf(ROOT, p)) })).filter((x) => x.h !== null);
  if (!mine.length) return { said: 'this project has none of the kit\'s scripts and guards to look for in its history' };
  const rl = git(['rev-list', 'HEAD'], { encoding: 'utf8' });
  const commits = rl.status === 0 ? String(rl.stdout).split('\n').map((s) => s.trim()).filter(Boolean) : [];
  const algo = (git(['rev-parse', '--show-object-format'], { encoding: 'utf8' }).stdout || '').trim() === 'sha256' ? 'sha256' : 'sha1';
  const check = commits.length ? catFile('--batch-check', commits.flatMap((c) => mine.map((x) => `${c}:${x.p}`)), 'utf8') : null;
  if (check === null) return { said: 'git could not read the kit clone\'s history' };
  const oids = String(check).split('\n').map(blobOf);
  const ids = mine.map((x) => new Set(blobIds(x.h, algo)));
  const n = mine.length;
  const hits = commits.map((c, ci) => mine.reduce((s, x, xi) => s + (ids[xi].has(oids[ci * n + xi]) ? 1 : 0), 0));
  const full = commits.filter((c, ci) => hits[ci] === n);
  if (!full.length) {
    let best = 0;
    for (let i = 1; i < commits.length; i++) if (hits[i] > hits[best]) best = i;
    const shallow = (git(['rev-parse', '--is-shallow-repository'], { encoding: 'utf8' }).stdout || '').trim() === 'true';
    const near = hits[best] ? ` (the closest, ${shortOf(commits[best])}, has ${hits[best]} of them)` : '';
    return { said: `no commit the kit clone holds has the scripts and guards here (${n}) as they are, line endings aside${near}${shallow ? '; the clone was made with --depth, so it holds only its newest commits' : ''}` };
  }
  const pick = full.length === 1 ? full[0] : closest(full);
  const short = shortOf(pick);
  return {
    commit: pick,
    short,
    said: full.length === 1
      ? `${short} is the one commit that holds the scripts and guards here (${n}) as they are, line endings aside`
      : `${full.length} commits hold the scripts and guards here (${n}) as they are, line endings aside, and ${short} is the one whose other files are closest to this project's`,
  };
}
// Several commits can share every script and guard while the kit's docs moved
// on between them. The one whose other files are closest to this project's,
// line for line, is the one it came from: a newer one would hide the kit's
// changes in between, an older one would show changes this project already
// has. Equally close ones are the same kit to this project, and the newest of
// them is taken.
function closest(cands) {
  const others = KIT_FILES.filter((f) => f.kind !== 'record' && !MATCHED.includes(f.path))
    .map((f) => ({ p: f.path, h: norm(readBuf(ROOT, f.path)) }))
    .filter((x) => x.h !== null);
  if (!others.length) return cands[0];
  const check = catFile('--batch-check', cands.flatMap((c) => others.map((x) => `${c}:${x.p}`)), 'utf8');
  if (check === null) return cands[0];
  const oids = String(check).split('\n').map(blobOf);
  const unique = [...new Set(oids.filter(Boolean))];
  const texts = new Map();
  const raw = unique.length ? catFile('--batch', unique) : Buffer.alloc(0);
  if (raw === null) return cands[0];
  for (let pos = 0; pos < raw.length;) {
    const nl = raw.indexOf(0x0a, pos);
    if (nl === -1) break;
    const head = raw.toString('utf8', pos, nl).split(' ');
    const size = Number(head[2]);
    if (head[1] !== 'blob' || !Number.isFinite(size)) break;
    texts.set(head[0], norm(raw.subarray(nl + 1, nl + 1 + size)));
    pos = nl + 1 + size + 1;
  }
  const counts = (s) => {
    const m = new Map();
    for (const l of toLines(s)) m.set(l, (m.get(l) || 0) + 1);
    return m;
  };
  const apart = (a, b) => {
    let d = 0;
    for (const [l, k] of a) d += Math.abs(k - (b.get(l) || 0));
    for (const [l, k] of b) if (!a.has(l)) d += k;
    return d;
  };
  const mine = others.map((x) => counts(x.h));
  const theirs = new Map();
  let best = cands[0];
  let bestD = Infinity;
  cands.forEach((c, ci) => {
    let d = 0;
    others.forEach((x, xi) => {
      const oid = oids[ci * others.length + xi];
      if (oid && !theirs.has(oid)) theirs.set(oid, counts(texts.get(oid) || ''));
      d += apart(mine[xi], oid ? theirs.get(oid) : new Map());
    });
    if (d < bestD) { bestD = d; best = c; }
  });
  return best;
}

// Where the base comes from: --base wins, then Kit-version.json, then the
// search above. --record compares from no base: it records the commit the
// clone is at, or the one the search finds when no base is recorded.
const notes = [];
let baseName = null;
let baseFrom = null;
let noRecord = null; // why no base is recorded, when none is
// What to do with no base, said the same way wherever one is missing: the
// install row names the commit, and git can read it only from a full clone.
const FIND_BASE = 'pass the kit commit named in the install row of project-os/History.md with --base <commit>. The kit clone needs its full history for git to read that commit: a clone made with --depth 1 has none.';
if (baseArg !== null) { baseName = baseArg; baseFrom = '--base'; }
else {
  const vbuf = readBuf(ROOT, VERSION_FILE);
  if (vbuf === null) noRecord = `no ${VERSION_FILE} here`;
  else {
    try {
      const v = JSON.parse(norm(vbuf));
      const c = typeof v.commit === 'string' ? v.commit.trim() : '';
      if (/^[0-9a-f]{4,40}$/i.test(c)) { baseName = c; baseFrom = VERSION_FILE; }
      else noRecord = `${VERSION_FILE} names no commit ("${c}")`;
    } catch (e) {
      noRecord = `${VERSION_FILE} is not valid JSON (${e.message})`;
    }
  }
}
let BASE = null; // the full commit id, once proven to be in the clone
const found = noRecord === null ? null : findBase();
if (noRecord !== null && !RECORD) {
  if (found && found.commit) {
    BASE = found.commit;
    baseFrom = 'found';
    notes.push(`${noRecord}, so the base was looked for in the kit's history: ${found.said}.`);
  } else notes.push(`${noRecord}, ${found ? `and ${found.said}, ` : ''}so the base is unknown: ${FIND_BASE}`);
}
if (baseName !== null && !RECORD) {
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

// ---- merging a calibrated file -------------------------------------------------
// A calibrated file differs from the kit's copy mostly by what the install
// filled in: the project's name, the owner, the address, the check command.
// Merged as they stand, every such line reads as a clash wherever the kit
// edited it or wrote a line next to it, and "this project's wording wins" then
// keeps the old line and drops the kit's change: a new Go commit step that sat
// beside the filled check command was lost that way (2026-10-02). So the
// values are read from this project's own files first, each kit line that
// carries a placeholder set against the line that took its place here. Both
// kit copies are filled with them, and only then merged with this copy. A
// filled value no longer reads as this project's wording; a real edit here
// still does, and clashes with any kit change to the same lines. Nothing in
// the review folder is ever written over this project's file without --apply.
const MERGE_DIR = '.tmp/kit-merge';
const TOKEN = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;
const HAS_TOKEN = /\{\{[A-Z][A-Z0-9_]*\}\}/;
const tokensIn = (s) => new Set(Array.from(s.matchAll(TOKEN), (m) => m[1]));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const joinLines = (lines, like) => (lines.length ? `${lines.join('\n')}${like.endsWith('\n') ? '\n' : ''}` : '');
const range = (start, n) => Array.from({ length: n }, (_, i) => start + i);

// The marks the install writes after a value nothing can run yet (Installation.md
// step 3): "(nothing to run before plan step 2)", "(none yet)". They are the
// install's text, not this project's wording, so a line that differs from its
// filled kit line by such a mark alone reads as filled. Merged as wording, a
// kit change beside the dev address went to the owner as their own (2026-10-02).
const MARK = /\s*\((?:nothing to run before (?:(?:plan )?step \d+|that step)|none yet)\)/gi;
const unmark = (s) => s.replace(MARK, '');

// A choice the install settles from the owner's answer, written in square
// brackets: "[on the current branch / on a task branch, per the owner's answer
// at install]" in Go commit step 6. It is no placeholder, so the lines the
// answer replaced read as this project's own wording, and the owner was asked
// to rule on their own install answer (2026-10-02). Where this copy holds the
// bracket's lines with one of its options in its place, line breaks and spaces
// aside, those lines are the install's: both kit copies are given them, and a
// kit line that rewords the sentence gets the same option. Anything else in its
// place stays this project's own wording.
const ANSWER = /\[([^[\]]+?),\s+per the owner's answer at install\]/g;
const loose = (s) => escapeRe(s.trim()).replace(/\s+/g, '\\s+');
const optionsOf = (inside) => inside.split(/\s+\/\s+/).map((o) => o.replace(/\s+/g, ' ').trim());
function fillAnswers(b, k, h) {
  let base = b;
  let kit = k;
  // From the last bracket back, so each one's place in the base still holds.
  for (const m of [...b.matchAll(ANSWER)].reverse()) {
    const from = b.lastIndexOf('\n', m.index) + 1;
    const nl = b.indexOf('\n', m.index + m[0].length);
    const to = nl === -1 ? b.length : nl;
    const before = b.slice(from, m.index);
    const after = b.slice(m.index + m[0].length, to);
    const options = optionsOf(m[1]);
    const re = new RegExp(`(?:^|\\n)([ \\t]*${loose(before)}${/\S\s+$/.test(before) ? '\\s+' : ''}(${options.map(loose).join('|')})${/^\s+\S/.test(after) ? '\\s+' : ''}${loose(after)}[ \\t]*)(?=\\n|$)`, 'g');
    const found = [...h.matchAll(re)];
    if (found.length !== 1) continue;
    const [, mine, picked] = found[0];
    const lines = b.slice(from, to);
    base = base.slice(0, from) + mine + base.slice(to);
    if (kit === null) continue;
    // The kit kept the bracket's lines: they become this copy's, as in the
    // base. It reworded them around the bracket: the bracket becomes the answer.
    const at = kit.indexOf(lines);
    const whole = at !== -1 && kit.indexOf(lines, at + 1) === -1 && (at === 0 || kit[at - 1] === '\n') && (at + lines.length === kit.length || kit[at + lines.length] === '\n');
    kit = whole
      ? kit.slice(0, at) + mine + kit.slice(at + lines.length)
      : kit.replace(ANSWER, (all, inside) => (optionsOf(inside).join('/') === options.join('/') ? picked.replace(/\s+/g, ' ') : all));
  }
  return [base, kit];
}

// The stretches git finds between two files, 0-based: `an` lines at `a` in the
// first became `bn` lines at `b` in the second. An empty stretch sits before
// the line its index names.
function hunks(fileA, fileB) {
  const r = git(['diff', '--no-index', '--no-color', '--no-ext-diff', '--no-textconv', '--diff-algorithm=myers', '--unified=0', '--', fileA, fileB], { encoding: 'utf8' });
  if (r.error || (r.status !== 0 && r.status !== 1)) return null;
  const out = [];
  for (const line of String(r.stdout).split('\n')) {
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!h) continue;
    const an = h[2] === undefined ? 1 : Number(h[2]);
    const bn = h[4] === undefined ? 1 : Number(h[4]);
    out.push({ a: an ? Number(h[1]) - 1 : Number(h[1]), an, b: bn ? Number(h[3]) - 1 : Number(h[3]), bn });
  }
  return out;
}

// A kit line with placeholders, as a pattern for the line that took its place
// here: each placeholder whose value is known becomes that value, each other
// one a group to read the value from, the same one twice a back-reference.
function pattern(line, known) {
  let re = '^';
  const groups = [];
  const fixed = new Map();
  for (const part of line.split(/(\{\{[A-Z][A-Z0-9_]*\}\})/)) {
    const t = /^\{\{([A-Z][A-Z0-9_]*)\}\}$/.exec(part);
    if (!t) { re += escapeRe(part); continue; }
    if (known.has(t[1])) { fixed.set(t[1], known.get(t[1])); re += escapeRe(known.get(t[1])); continue; }
    const g = groups.indexOf(t[1]);
    if (g !== -1) { re += `\\${g + 1}`; continue; }
    groups.push(t[1]);
    re += '(.+?)';
  }
  return { re: new RegExp(`${re}$`), groups, fixed };
}

// The lines of the setup blocks the install fills: a quoted block led by a
// setup or fill-in instruction, and a script's marked setup block. A clash
// whose kit side changed only such lines is the kit rewording an instruction
// this project already followed, not a clash with its own wording.
function setupLines(lines) {
  const s = new Set();
  let quote = false;
  let code = false;
  for (const l of lines) {
    if (/^\s*(\/\/|#)\s*-+\s*Setup block:/i.test(l)) code = true;
    if (code) {
      s.add(l);
      if (/End of setup block/i.test(l)) code = false;
      continue;
    }
    if (/^>\s*\*\*(Setup step|Fill this in|This section starts empty on purpose)/i.test(l)) quote = true;
    else if (!l.startsWith('>')) quote = false;
    if (quote) s.add(l);
  }
  return s;
}

// The clashes git merge-file marked, read back from its --diff3 output.
function clashesIn(text, setup) {
  const lines = toLines(text);
  const out = [];
  for (let n = 0; n < lines.length; n++) {
    if (lines[n] !== '<<<<<<< here') continue;
    const c = { at: n + 1, here: [], base: [], kit: [] };
    let part = 'here';
    for (n++; n < lines.length; n++) {
      const l = lines[n];
      if (part === 'here' && l === '||||||| base') { part = 'base'; continue; }
      if (part === 'base' && l === '=======') { part = 'kit'; continue; }
      if (part === 'kit' && l === '>>>>>>> kit') break;
      c[part].push(l);
    }
    c.setup = c.base.some((l) => l.trim()) && c.base.every((l) => !l.trim() || setup.has(l));
    // This copy's side differs from the filled base by the install's marks
    // alone: the kit changed a line the install marked.
    c.mark = !c.setup && c.here.length === c.base.length && c.here.some((l, i) => l !== c.base[i]) && c.here.every((l, i) => unmark(l) === c.base[i]);
    out.push(c);
  }
  return out;
}

// Each calibrated file the kit changed is merged here, once, before the report.
const merges = new Map(); // path -> { state, file, clashes, brought, text }
const valueNotes = [];
const twoWays = new Set(); // placeholders this project fills more than one way
function mergeCalibrated() {
  const work = abs(ROOT, MERGE_DIR);
  const items = [];
  try {
    // The folder is this script's own: emptied on each compare, so a merge left
    // from an earlier run is never mistaken for this one's.
    fs.rmSync(work, { recursive: true, force: true });
    const pending = [];
    for (const f of KIT_FILES.filter((x) => x.kind === 'calibrated')) {
      const b = baseText(f.path);
      const h = norm(readBuf(ROOT, f.path));
      if (typeof b !== 'string' || h === null) continue;
      const k = norm(readBuf(KIT, f.path));
      pending.push({ rel: f.path, b, k, h, merge: k !== null && b !== k && h !== k });
    }
    if (!pending.some((it) => it.merge)) return;
    for (const it of pending) {
      [it.b, it.k] = fillAnswers(it.b, it.k, it.h);
      const dir = path.join(work, '.inputs', ...it.rel.split('/'));
      it.file = (name) => path.join(dir, name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(it.file('base'), it.b);
      fs.writeFileSync(it.file('here'), it.h);
      if (it.k !== null) fs.writeFileSync(it.file('kit'), it.k);
      items.push(it);
    }
  } catch (e) {
    notes.push(`the merges could not be written to ${MERGE_DIR}/ (${e.message}), so each calibrated file the kit changed is to be carried over by hand.`);
    for (const it of items) if (it.merge) merges.set(it.rel, { state: 'error' });
    return;
  }

  // The lines to read values from: each base line with a placeholder against
  // the lines that replaced it here, and each new kit line with one against
  // this copy, for a placeholder a merge already carried over and filled.
  const pairs = [];
  for (const it of items) {
    it.bl = toLines(it.b);
    it.hl = toLines(it.h);
    it.kl = it.k === null ? null : toLines(it.k);
    it.matched = new Map(); // base line -> the line here that took its place
    it.changed = new Set(); // base lines this copy changed in any way
    for (const [side, lines, text] of [['base', it.bl, it.b], ...(it.merge ? [['kit', it.kl, it.k]] : [])]) {
      if (text === it.h) continue;
      const hs = hunks(it.file(side), it.file('here'));
      if (!hs) { it.failed = true; continue; }
      const used = new Set();
      for (const x of hs) {
        for (let i = x.a; i < x.a + x.an; i++) {
          if (side === 'base') it.changed.add(i);
          if (!HAS_TOKEN.test(lines[i])) continue;
          // The line at the same place in the stretch is tried first: a filled
          // line nearly always took the place of its own line. Where the
          // stretch kept its length, that line is its line for line.
          const at = x.b + (i - x.a);
          const here = range(x.b, x.bn).sort((p, q) => Math.abs(p - at) - Math.abs(q - at) || p - q);
          pairs.push({ it, side, i, line: lines[i], here, aligned: x.an === x.bn ? at : null, used });
        }
      }
    }
  }
  const seen = new Map(); // path -> placeholder -> the values it was filled with
  const everywhere = new Map(); // placeholder -> the values, in every file
  const saw = (rel, t, v) => {
    if (!seen.has(rel)) seen.set(rel, new Map());
    for (const m of [seen.get(rel), everywhere]) {
      if (!m.has(t)) m.set(t, new Set());
      m.get(t).add(v);
    }
  };
  const known = () => {
    const m = new Map();
    for (const [t, s] of everywhere) if (s.size === 1) m.set(t, [...s][0]);
    return m;
  };
  // Lines with one placeholder first, since their value is certain; then lines
  // with more, once all but one of them are known; last, the rest, read left to
  // right. A value is never empty and never holds a placeholder itself.
  const pass = (list, stage, learns, lineForLine) => {
    let progress = false;
    const k = stage === 1 ? new Map() : known();
    for (const p of list) {
      if (p.done) continue;
      if (stage === 1 && tokensIn(p.line).size !== 1) continue;
      const pat = pattern(p.line, k);
      if (stage === 2 && pat.groups.length > 1) continue;
      for (const j of lineForLine ? (p.aligned === null ? [] : [p.aligned]) : p.here) {
        if (p.used.has(j)) continue;
        const m = pat.re.exec(unmark(p.it.hl[j]));
        if (!m) continue;
        const vals = new Map(pat.fixed);
        pat.groups.forEach((t, g) => vals.set(t, m[g + 1]));
        if ([...vals.values()].some((v) => !v.trim() || HAS_TOKEN.test(v))) continue;
        for (const [t, v] of vals) if (learns(t)) saw(p.it.rel, t, v);
        p.used.add(j);
        p.done = true;
        progress = true;
        if (p.side === 'base') p.it.matched.set(p.i, j);
        break;
      }
    }
    return progress;
  };
  const readValues = (list, learns, lineForLine) => {
    pass(list, 1, learns, lineForLine);
    while (pass(list, 2, learns, lineForLine)) { /* each pass can make the next line's value known */ }
    pass(list, 3, learns, lineForLine);
  };
  // A line that took its base line's place, line for line, is read first. A
  // line found elsewhere in its stretch, or a new kit line, is read only for a
  // placeholder nothing read before it gave: the kit rewraps paragraphs and the
  // owner joins lines, and such a line can sit beside an unrelated one here.
  // Read for a value already given, a moved kit line once took a whole
  // sentence for the owner's name.
  const base = pairs.filter((p) => p.side === 'base');
  readValues(base, () => true, true);
  const aligned = new Set(everywhere.keys());
  readValues(base, (t) => !aligned.has(t), false);
  const fromBase = new Set(everywhere.keys());
  readValues(pairs.filter((p) => p.side === 'kit' && [...tokensIn(p.line)].some((t) => !fromBase.has(t))), (t) => !fromBase.has(t), false);

  // A value is this file's own when it filled the placeholder one way here,
  // else the one every file agrees on. Filled two ways, it is never guessed.
  const valueOf = (rel, t) => {
    const own = seen.has(rel) ? seen.get(rel).get(t) : null;
    const s = own && own.size ? own : everywhere.get(t);
    return s && s.size === 1 ? [...s][0] : null;
  };
  const one = [...everywhere].filter(([, s]) => s.size === 1).sort(([a], [b]) => (a < b ? -1 : 1));
  if (one.length) valueNotes.push(`This project's values, read from its own files: ${one.map(([t, s]) => `{{${t}}} "${[...s][0]}"`).join(', ')}.`);
  for (const [t, s] of [...everywhere].filter(([, x]) => x.size > 1)) {
    twoWays.add(t);
    valueNotes.push(`{{${t}}} is filled more than one way here (${[...s].map((v) => `"${v}"`).join(', ')}), so a kit line that brings it is left unfilled.`);
  }

  for (const it of items) {
    if (!it.merge) continue;
    try {
      if (it.failed) { merges.set(it.rel, { state: 'error' }); continue; }
      const fill = (line) => line.replace(TOKEN, (whole, t) => {
        const v = valueOf(it.rel, t);
        return v === null ? whole : v;
      });
      // Each kit line the kit kept from the base, against that base line.
      const hk = hunks(it.file('base'), it.file('kit'));
      if (!hk) { merges.set(it.rel, { state: 'error' }); continue; }
      const kept = new Map();
      let a = 0;
      let b = 0;
      for (const x of hk) {
        while (b < x.b) kept.set(b++, a++);
        a += x.an;
        b += x.bn;
      }
      while (b < it.kl.length) kept.set(b++, a++);
      const keptByKit = new Set(kept.values());
      // A base line this copy changed is filled with the values this file
      // agrees on, and reads as filled only when that gives exactly the line
      // here. A placeholder filled two ways, or any wording added on the line,
      // keeps it this project's own edit, so a kit change to it is a clash for
      // the owner. Taken as filled because it was paired line for line, an
      // owner sentence on a filled line once vanished under the kit's rewrite,
      // in a merge reported clean (2026-10-02). A mark the install wrote after
      // the value counts as filled too, but only on a line the kit kept: the
      // kit's own new line would land without the mark, so that one is left to
      // clash, labelled as the install's. One this copy left as it was stays
      // as it was, placeholder and all.
      const bp = it.bl.map((l, i) => {
        if (!it.changed.has(i) || !HAS_TOKEN.test(l)) return l;
        const f = fill(l);
        const mine = it.matched.has(i) ? it.hl[it.matched.get(i)] : null;
        return mine !== null && mine !== f && unmark(mine) === f && keptByKit.has(i) ? mine : f;
      });
      // A line the kit kept from the base is filled exactly as the base line
      // was, so the fill alone never reads as a kit change; a new one is filled.
      const kp =it.kl.map((l, j) => (kept.has(j) ? bp[kept.get(j)] : HAS_TOKEN.test(l) ? fill(l) : l));
      fs.writeFileSync(it.file('base-filled'), joinLines(bp, it.b));
      fs.writeFileSync(it.file('kit-filled'), joinLines(kp, it.k));
      const r = git(['merge-file', '-p', '--diff3', '-L', 'here', '-L', 'base', '-L', 'kit', it.file('here'), it.file('base-filled'), it.file('kit-filled')]);
      if (r.error || r.status === null || r.status > 127) { merges.set(it.rel, { state: 'error' }); continue; }
      const text = norm(r.stdout);
      if (r.status === 0 && text === it.h) { merges.set(it.rel, { state: 'carried' }); continue; }
      const file = `${MERGE_DIR}/${it.rel}`;
      const dest = abs(ROOT, file);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, text);
      const hereHas = tokensIn(it.h);
      // Read from this copy's side and the kit's only: the base side of a
      // clash shows a base line, often left unfilled, and brings nothing.
      const sides = text.replace(/^\|{7} base\n[\s\S]*?^={7}\n/gm, '');
      const brought = [...tokensIn(sides)].filter((t) => !hereHas.has(t)).sort();
      if (r.status > 0) {
        const clashes = clashesIn(text, setupLines(bp));
        merges.set(it.rel, { state: 'clash', file, clashes, count: clashes.length || r.status, brought });
      } else if (brought.length) merges.set(it.rel, { state: 'unfilled', file, brought });
      else merges.set(it.rel, { state: 'clean', file, text });
    } catch {
      merges.set(it.rel, { state: 'error' });
    }
  }
}

// Each calibrated file gets a line of text, and `open` when the kit's side of
// it still has to be carried over by hand. An open file holds back the version
// --apply writes, exactly as a conflict does: once the base moves to the kit's
// HEAD, the next compare reads it as unchanged in the kit and the change is
// never shown again (2026-10-01). A copy that already matches the kit word for
// word has nothing left to carry, and one the project removed has nowhere to
// carry it, so neither is open. Nor is one whose merge already equals it, or
// one whose merge came out clean, which --apply writes (2026-10-02).
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
  const said = `the kit changed ${changesText(c)}`;
  const diff = diffCommand(rel);
  if (h === null) return { text: `${said}; not here (removed here, so nothing to carry over)`, diff };
  if (matches) return { text: `${said}; this copy already matches the kit`, diff };
  const m = merges.get(rel);
  const n = c.added + c.removed;
  if (!m || m.state === 'error') return { text: `${said}; git could not merge it, carry it over by hand`, open: true, why: `changed in the kit, ${n} line${n === 1 ? '' : 's'}`, diff };
  if (m.state === 'carried') return { text: `${said}; this copy already carries them`, diff };
  if (m.state === 'clean') return { text: `${said}; merged cleanly, this project's wording kept: ${m.file}`, merged: m, diff };
  const list = (ts) => ts.map((t) => `{{${t}}}`).join(', ');
  const none = m.brought.filter((t) => !twoWays.has(t));
  const two = m.brought.filter((t) => twoWays.has(t));
  const brings = [none.length ? `${list(none)}, which nothing here fills` : '', two.length ? `${list(two)}, which this project fills more than one way` : ''].filter(Boolean).join(', and ');
  const fillIt = `copy ${m.file} over this project's copy by hand, then fill ${list(m.brought)} there`;
  if (m.state === 'unfilled') return { text: `${said}; merged cleanly into ${m.file}, but its new lines bring ${brings}`, open: true, why: `the merge brings ${brings}: ${fillIt}`, diff };
  const clashes = `${m.count} clash${m.count === 1 ? '' : 'es'}`;
  const also = m.brought.length ? `, and its new lines bring ${brings}` : '';
  return { text: `${said}; ${clashes} to settle, marked in ${m.file}${also}`, open: true, why: `${clashes} to settle, marked in ${m.file}`, clashes: m.clashes, diff };
}

// One clash as the report prints it: where it sits in the merged copy, whose
// wording meets the kit's, and both sides' lines exactly.
function clashLines(c, i) {
  const out = [`    clash ${i + 1}, line ${c.at} of the merged copy: ${c.setup
    ? 'a setup block the install filled, whose instructions the kit changed; fill the kit\'s new block again from this project\'s answer, nothing here is the owner\'s own wording'
    : c.mark
      ? 'a mark the install wrote after a value, on a line the kit changed; take the kit\'s line and write the mark again, nothing here is the owner\'s own wording'
      : 'this project\'s own wording against the kit\'s change; the owner rules'}`];
  const MAX = 12;
  for (const [label, lines] of [['here', c.here], ['kit ', c.kit]]) {
    if (!lines.length) out.push(`      ${label} | (nothing: ${label === 'here' ? 'this project removed these lines' : 'the kit removed these lines'})`);
    for (const l of lines.slice(0, MAX)) out.push(`      ${label} | ${l}`);
    if (lines.length > MAX) out.push(`      ${label} | and ${lines.length - MAX} more line${lines.length - MAX === 1 ? '' : 's'}, in the merged copy`);
  }
  return out;
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
if (BASE && !RECORD) mergeCalibrated();
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
function writeVersion(commit = kitHead) {
  const dest = abs(ROOT, VERSION_FILE);
  const tmp = `${dest}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ commit, date: today }, null, 2)}\n`);
  try { fs.renameSync(tmp, dest); } catch (e) { try { fs.unlinkSync(tmp); } catch { /* already gone */ } throw e; }
}
// A merge is made with LF endings; it is written back with the endings and the
// byte-order mark this project's copy had, so git sees only the kit's change.
function inEndingsOf(raw, text) {
  const s = raw ? raw.toString('utf8') : '';
  const t = s.includes('\r\n') ? text.replace(/\n/g, '\r\n') : text;
  return Buffer.from(s.charCodeAt(0) === 0xfeff ? `﻿${t}` : t, 'utf8');
}
// The `Go update kit` section of a CLAUDE.md, from its heading to the next
// heading of the same level or above; null when it has none.
function updateSteps(text) {
  const level = (l) => { const m = /^(#{1,6})\s/.exec(l); return m ? m[1].length : 0; };
  const lines = toLines(text);
  const at = lines.findIndex((l) => level(l) && /^#+\s+`?Go update kit`?\s*$/.test(l));
  if (at === -1) return null;
  let end = at + 1;
  while (end < lines.length && !(level(lines[end]) && level(lines[end]) <= level(lines[at]))) end++;
  return lines.slice(at, end).join('\n');
}
// The --record command for this kit folder, quoted when its path has a space.
const recordCommand = `node project-os/Compare-kit-files.mjs --kit ${/\s/.test(kitArg) ? `"${kitArg}"` : kitArg} --record`;

// ---- report ------------------------------------------------------------------
const out = [];
out.push(`Compare-kit-files: project ${ROOT}`);
out.push(`Kit: ${KIT}${kitHead ? ` at ${kitHead}` : ' (not a git clone)'}`);
if (!RECORD) out.push(`Base: ${BASE ? `${BASE.slice(0, 7)} (${baseFrom === 'found' ? 'found in the kit\'s history, not recorded yet' : `from ${baseFrom}`})` : 'unknown'}`);
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
  // No base recorded, and this project's scripts and guards match an older kit
  // than the clone's HEAD: the files came from that commit, so it is the one
  // recorded. Recording the HEAD would hide every kit change since it, and
  // nothing was carried over yet to make the HEAD true (2026-10-02).
  if (found && found.commit && found.commit !== kitHeadFull) {
    out.push(`No base is recorded here, and this project's files came from an older kit than the clone's HEAD, ${kitHead}: ${found.said}.`);
    try { writeVersion(found.short); } catch (e) {
      out.push(`Could not write ${VERSION_FILE}: ${e.message}`);
      console.log(out.join('\n'));
      process.exit(1);
    }
    out.push(`Wrote ${VERSION_FILE}: commit ${found.short}, ${today}.`);
    out.push(`Run the compare again: it now measures from ${found.short} and shows every kit change since.`);
    console.log(out.join('\n'));
    process.exit(0);
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
out.push('Calibrated at install (never copied over: the kit\'s changes are merged in with this project\'s values, and --apply writes only a clean merge):');
for (const v of valueNotes) out.push(`  ${v}`);
if (!calibrated.length) out.push('  none on either side');
for (const c of calibrated) {
  out.push(`  ${c.path}: ${c.text}`);
  if (c.diff) out.push(`    full diff: ${c.diff}`);
  (c.clashes || []).forEach((x, i) => out.push(...clashLines(x, i)));
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
// status, then the calibrated files the kit changed or added (2026-10-01) that
// no clean merge settles: a clash, a placeholder to fill, a file to add.
const blockers = [
  ...machinery.filter((m) => m.status === 'changed on both sides' || m.status === 'cannot tell who changed it').map((m) => ({ path: m.path, why: m.status })),
  ...calibrated.filter((c) => c.open).map((c) => ({ path: c.path, why: `calibrated, ${c.why}` })),
];
const calOpen = calibrated.filter((c) => c.open).length;
const cleanMerges = calibrated.filter((c) => c.merged);
const files = (n) => `${n} file${n === 1 ? '' : 's'}`;
out.push('');
out.push(`Summary: ${count('kit updated')} kit updated, ${count('new in the kit')} new in the kit, ${count('changed on both sides')} conflict${count('changed on both sides') === 1 ? '' : 's'}, ${count('cannot tell who changed it')} cannot tell, ${count('changed here only')} changed here only, ${count('removed here')} removed here, ${count('gone from the kit')} gone from the kit, ${cleanMerges.length} calibrated file${cleanMerges.length === 1 ? '' : 's'} merged cleanly, ${calOpen} calibrated file${calOpen === 1 ? '' : 's'} to carry over, ${templates.length} record template${templates.length === 1 ? '' : 's'} changed.`);
// A base found in the kit's history is written by --apply while files are
// left, before it copies anything: the copies make this project's scripts a
// mix of two kits, which no single commit matches, and the next compare
// would find no base at all (2026-10-02).
const recordFound = APPLY && baseFrom === 'found' && blockers.length > 0;
const foundShort = baseFrom === 'found' ? found.short : null;

if (!APPLY) {
  const acts = [
    safe.length ? `copies the ${safe.length} safe file${safe.length === 1 ? '' : 's'}` : '',
    cleanMerges.length ? `writes the ${cleanMerges.length} clean merge${cleanMerges.length === 1 ? '' : 's'} into this project` : '',
  ].filter(Boolean);
  if (acts.length && !blockers.length) acts.push('records the kit commit');
  const copies = acts.length ? ` --apply ${acts.length === 1 ? acts[0] : `${acts.slice(0, -1).join(', ')} and ${acts[acts.length - 1]}`}.` : '';
  const one = blockers.length === 1;
  const held = blockers.length ? ` --apply writes no ${VERSION_FILE} while ${files(blockers.length)} ${one ? 'is' : 'are'} left to carry over by hand (a conflict, no telling who changed it, or a calibrated file with a clash, a placeholder to fill or a kit file to add): carry ${one ? 'it' : 'them'} over by hand, then record the kit commit with --record.${baseFrom === 'found' ? ` Until then it records the base this compare found, ${foundShort}, so the next compare starts from it.` : ''}` : '';
  const wrote = [...merges.values()].some((m) => m.file);
  out.push(`Report only: nothing was written${wrote ? ` in this project; the merges are in ${MERGE_DIR}/ for review` : ''}.${copies}${held}`);
  console.log(out.join('\n'));
  process.exit(0);
}

// ---- apply ---------------------------------------------------------------------
out.push('');
if (recordFound) {
  try { writeVersion(foundShort); } catch (e) {
    out.push(`Could not write ${VERSION_FILE}: ${e.message}. Nothing was copied.`);
    console.log(out.join('\n'));
    process.exit(1);
  }
  out.push(`Wrote ${VERSION_FILE}: commit ${foundShort}, ${today}, the base this compare found, so the next compare starts from it.`);
}
let failed = 0;
const copied = [];
for (const m of safe) {
  try { writeAtomic(m.path, readBuf(KIT, m.path)); copied.push(m.path); } catch (e) { failed++; out.push(`Could not copy ${m.path}: ${e.message}`); }
}
out.push(copied.length ? `Copied from the kit: ${copied.join(', ')}` : 'Copied from the kit: nothing was safe to copy.');
// A clean merge keeps every line this project wrote and adds the kit's
// changes, so it is written; each one is named, never written silently.
const mergedIn = [];
const stepsBefore = updateSteps(norm(readBuf(ROOT, 'CLAUDE.md')) || '');
for (const c of cleanMerges) {
  try { writeAtomic(c.path, inEndingsOf(readBuf(ROOT, c.path), c.merged.text)); mergedIn.push(c.path); } catch (e) { failed++; out.push(`Could not write the merge of ${c.path}: ${e.message}`); }
}
if (mergedIn.length) out.push(`Merged into this project, its own wording kept: ${mergedIn.join(', ')} (the same merges are in ${MERGE_DIR}/)`);
// The session runs this update as the CLAUDE.md it read at the start writes
// it. A project installed from an older kit then finished with the older
// steps, and a newer step, such as handing the guards to the project, waited
// for the next update (2026-10-02). When the merge just written changed those
// steps, the run's last line says to finish with the merged ones.
const newSteps = mergedIn.includes('CLAUDE.md') && updateSteps(cleanMerges.find((c) => c.path === 'CLAUDE.md').merged.text) !== stepsBefore;
// The same holds when CLAUDE.md is left to carry over by hand: no merge is
// written, so the line above never comes, and the session finished with the
// older steps it started from (round two check, 2026-10-02). The kit's steps
// are measured against the base's, both unfilled, or against this project's
// own when no base is known.
const handSteps = !newSteps && blockers.some((b) => b.path === 'CLAUDE.md') && (() => {
  const kitSteps = updateSteps(norm(readBuf(KIT, 'CLAUDE.md')) || '');
  const b = baseText('CLAUDE.md');
  return kitSteps !== null && kitSteps !== (typeof b === 'string' ? updateSteps(b) : stepsBefore);
})();
const done = (code) => {
  if (newSteps) out.push('This project\'s CLAUDE.md now carries newer Go update kit steps than the ones this update started from: finish this update with steps 5 to 8 as the merged CLAUDE.md writes them.');
  if (handSteps) out.push('The kit\'s CLAUDE.md carries newer Go update kit steps than the ones this update started from: once CLAUDE.md is carried over by hand, finish this update with steps 5 to 8 as the carried-over CLAUDE.md writes them.');
  console.log(out.join('\n'));
  process.exit(code);
};
if (failed) {
  out.push(`${failed} write${failed === 1 ? '' : 's'} failed, so ${VERSION_FILE} was left ${recordFound ? `naming the base this compare found, ${foundShort}` : 'as it was'}.`);
  done(1);
}
if (blockers.length) {
  // No version while one is left: with the kit's HEAD as the base, the next
  // compare would read each machinery file here as changed here only and each
  // calibrated one as unchanged in the kit, and the kit's changes to them
  // would never be shown again (2026-10-01).
  const one = blockers.length === 1;
  out.push(`${recordFound ? `${VERSION_FILE} names the base this compare found, not the kit's HEAD` : `${VERSION_FILE} was not written`}: ${files(blockers.length)} ${one ? 'is' : 'are'} still left to carry over by hand:`);
  for (const m of blockers) out.push(`  ${m.path}: ${m.why}`);
  out.push(`Carry ${one ? 'it' : 'them'} over from the kit by hand, then record the kit commit: ${recordCommand}`);
  out.push(`Recording before that would hide the kit's changes to ${one ? 'it' : 'them'} for good: the next compare would measure from the kit as it is now, and read a machinery file as changed here only and a calibrated one as unchanged in the kit.`);
  if (!kitHead) out.push('The kit folder is not a git clone, so --record cannot name its commit either: fetch the kit with git, full history.');
} else if (!kitHead) {
  out.push(`${VERSION_FILE} was not written: the kit folder is not a git clone, so its commit is unknown.`);
} else {
  try { writeVersion(); } catch (e) {
    out.push(`Could not write ${VERSION_FILE}: ${e.message}`);
    done(1);
  }
  out.push(`Wrote ${VERSION_FILE}: commit ${kitHead}, ${today}.`);
  // A record's template never holds the version back, since a record is never
  // copied; but from here on the kit at kitHead is the base, so a change to a
  // template will not show again. Name each one while it still can be seen.
  if (templates.length) out.push(`The kit also changed the template of ${templates.map((r) => r.path).join(', ')}. Carry any instruction change in ${templates.length === 1 ? 'it' : 'them'} over by hand now: the next compare against kit ${kitHead} will no longer show it.`);
}
done(0);
