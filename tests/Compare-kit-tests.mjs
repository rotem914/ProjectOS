// Tests for project-os/Compare-kit-files.mjs, the three-way compare `Go update
// kit` runs between an installed project and a fresh clone of the kit.
//
// Run from the kit root:   node tests/Compare-kit-tests.mjs
// It prints one line per failing case and a count at the end, and exits 1 when
// any case fails.
//
// Every case runs the real script as a child process, from the root of a
// throwaway project, against a throwaway kit: a git repository with two
// commits, the one the project was installed from (BASE) and a newer one (KIT).
// Each machinery status is pinned on a file built for it, and the files around
// it pin that the status is not handed out where it does not belong. --apply
// is pinned both ways: it records the kit commit when nothing is left to carry
// over by hand, and writes no version while a conflict, an unknown, or a
// calibrated file the kit changed or added is left, which --record then
// writes once they are carried over. A machinery file the project deleted is
// "removed here" and holds nothing back, and a change to a living record's
// template is reported and never copied (2026-10-01). A calibrated file is
// merged three ways with this project's values filled into both kit copies,
// so a filled-in name is never a clash and an owner edit always is; a project
// with no recorded base has it found in the kit's history; and the install's
// own --record against a fresh --depth 1 fetch records that commit (2026-10-02).
// A filled line holding an owner sentence stays the owner's, the install's
// branch answer and marks merge as fills, and --apply that writes newer update
// steps says so last (round two, 2026-10-02).
// Projects
// and kits live in one folder under the system temp folder (or under
// PROJECTOS_TEST_TMP when that is set), whose name holds a space on purpose;
// that folder is removed at the end. Git runs with an empty global config and
// no system config, so the machine's own settings cannot change a result.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(KIT_ROOT, 'project-os', 'Compare-kit-files.mjs');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(process.env.PROJECTOS_TEST_TMP || os.tmpdir(), 'projectos compare ')));
const EMPTY_CONFIG = path.join(TMP, 'empty gitconfig');
fs.writeFileSync(EMPTY_CONFIG, '');

const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
Object.assign(ENV, {
  GIT_CONFIG_GLOBAL: EMPTY_CONFIG,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CEILING_DIRECTORIES: TMP,
  GIT_AUTHOR_NAME: 'Compare Test',
  GIT_AUTHOR_EMAIL: 'compare@example.com',
  GIT_COMMITTER_NAME: 'Compare Test',
  GIT_COMMITTER_EMAIL: 'compare@example.com',
});

function git(dir, args) {
  const r = spawnSync('git', args, { cwd: dir, env: ENV, encoding: 'utf8' });
  if (r.error || r.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${dir}: ${r.error ? r.error.message : r.stderr}`);
  return r.stdout.trim();
}
const full = (dir, rel) => path.join(dir, ...rel.split('/'));
function write(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = full(dir, rel);
    if (content === null) { fs.rmSync(p, { recursive: true, force: true }); continue; }
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
}
const read = (dir, rel) => { try { return fs.readFileSync(full(dir, rel), 'utf8'); } catch { return null; } };
function compare(dir, args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, env: ENV, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}
// The machinery status printed for a path: the line is the status, two or
// more spaces, the path.
function statusOf(out, rel) {
  for (const line of out.split('\n')) {
    if (!line.startsWith('  ')) continue;
    const parts = line.trim().split(/\s{2,}/);
    if (parts[1] === rel) return parts[0];
  }
  return null;
}
const calibratedLine = (out, rel) => out.split('\n').find((l) => l.startsWith(`  ${rel}: `)) || '';
// Every file under a folder with a hash of its bytes, to prove a run wrote nothing.
function snapshot(dir) {
  const out = {};
  const walk = (rel) => {
    for (const e of fs.readdirSync(full(dir, rel || '.'), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else out[r] = crypto.createHash('sha1').update(fs.readFileSync(full(dir, r))).digest('hex');
    }
  };
  walk('');
  return JSON.stringify(out);
}
// The same, leaving out the review folder a compare writes its merges into.
const REVIEW = '.tmp/kit-merge/';
const outsideReview = (dir) => JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(snapshot(dir))).filter(([f]) => !f.startsWith(REVIEW))));
const exists = (dir, rel) => fs.existsSync(full(dir, rel));
const pad = (n) => String(n).padStart(2, '0');
const NOW = new Date();
const TODAY = `${NOW.getFullYear()}-${pad(NOW.getMonth() + 1)}-${pad(NOW.getDate())}`;

let ran = 0;
let failures = 0;
function t(name, pass, detail = '') {
  ran++;
  if (pass) return;
  failures++;
  console.error(`FAIL ${name}${detail ? `\n     ${String(detail).split('\n').join('\n     ')}` : ''}`);
}

const lines = (word, n) => Array.from({ length: n }, (_, i) => `${word} line ${i + 1}`).join('\n') + '\n';
// The kit as it was when the project was installed.
const V1 = {
  'README.md': 'kit readme, never installed\n',
  'Installation.md': 'install law v1\n',
  'CLAUDE.md': lines('claude', 12),
  'project-os/Workflow.md': 'workflow v1\n',
  'project-os/QA.md': 'qa v1\n',
  'project-os/History.md': '# {{PROJECT_NAME}}, History\n',
  'project-os/Decisions.md': 'decisions template v1\n', // a record whose template the kit leaves alone
  'project-os/Hooks.md': 'hooks v1\n',
  'project-os/Hooks-settings.json': '{}\n',
  'project-os/Find-heavy-files.mjs': '// heavy v1\n',
  'project-os/Install-project-hooks.mjs': '// install hooks v1\n',
  'project-os/guards/Path-guard.mjs': '// path guard v1\n',
  'project-os/guards/Destructive-guard.mjs': '// destructive guard v1\nsecond line\n',
  'project-os/Archive-old-rows.ps1': '# archive v1\n',
  'project-os/mcp/Figma/Figma_MCP_Rules.md': 'figma v1\n',
  'project-os/mcp/Google_analytics/Google_Analytics_MCP_Rules.md': 'analytics v1\n',
};
// What the kit changed since.
const claudeV2 = lines('claude', 12).split('\n');
claudeV2[2] = 'claude line 3, reworded by the kit';
claudeV2.splice(8, 0, 'a line the kit added after line 8');
const V2_CHANGES = {
  'Installation.md': 'install law v2\n', // removed here, and changed in the kit since
  'project-os/Find-heavy-files.mjs': '// heavy v2\n', // kit updated
  'project-os/Install-project-hooks.mjs': '// install hooks v2\n', // conflict: changed here too
  'project-os/Archive-old-rows.ps1': null, // gone from the kit
  'project-os/Audit-project-records.mjs': '// audit v2\n', // new in the kit
  'project-os/Compare-kit-files.mjs': '// a newer compare\n', // new in the kit, and not the running copy
  'project-os/Rule-reasons.md': 'reasons from the kit\n', // new in the kit, the project has its own: conflict
  'project-os/Archive-old-rows.mjs': '// archive mjs\n', // new in the kit, the project has the same: current
  'CLAUDE.md': claudeV2.join('\n'), // calibrated, changed in 2 places
  'project-os/QA.md': 'qa v2\n', // calibrated, changed
  'project-os/Backup-whole-project.mjs': '// backup mjs\n', // calibrated, new in the kit
  'project-os/mcp/Google_analytics/Google_Analytics_MCP_Rules.md': 'analytics v2\n', // calibrated, changed, removed here
  'project-os/History.md': '# {{PROJECT_NAME}}, History\n\nA newer template.\n', // record, its template changed
  'project-os/Unlisted-tool.mjs': '// no list names me\n', // unlisted
};

// A project installed from V1, then lived in.
const HERE_CHANGES = {
  'README.md': null, // never installed
  'Installation.md': null, // removed here, unchanged in the kit
  'project-os/Hooks.md': 'hooks v1, edited here\n', // changed here only
  'project-os/Install-project-hooks.mjs': '// install hooks, edited here\n', // conflict
  'project-os/guards/Destructive-guard.mjs': '// destructive guard v1\r\nsecond line\r\n', // CRLF from checkout: still current
  'project-os/Rule-reasons.md': 'our own reasons\n',
  'project-os/Archive-old-rows.mjs': '// archive mjs\n',
  'project-os/mcp/Figma/Figma_MCP_Rules.md': null, // folder removed at install
  'project-os/mcp/Google_analytics/Google_Analytics_MCP_Rules.md': null, // removed at install too
  'CLAUDE.md': lines('claude', 12).replace('claude line 1', 'Demo project, line 1'),
  'project-os/QA.md': 'qa v1, for Demo\n',
  'project-os/History.md': '# Demo, History\n\n| 2026-09-01 | install | kit installed |\n',
};

function installedProject(name, { version } = {}) {
  const dir = path.join(TMP, name);
  write(dir, V1);
  write(dir, HERE_CHANGES);
  if (version !== undefined) write(dir, { 'project-os/Kit-version.json': version });
  return dir;
}

try {
  // ---- the kit: BASE, then KIT -----------------------------------------------
  const K = path.join(TMP, 'kit clone');
  fs.mkdirSync(K, { recursive: true });
  git(K, ['-c', 'init.defaultBranch=main', 'init', '-q']);
  write(K, V1);
  git(K, ['add', '-A']);
  git(K, ['commit', '-q', '--no-verify', '-m', 'v1']);
  const BASE = git(K, ['rev-parse', '--short', 'HEAD']);
  write(K, V2_CHANGES);
  git(K, ['add', '-A']);
  git(K, ['commit', '-q', '--no-verify', '-m', 'v2']);
  const HEAD = git(K, ['rev-parse', '--short', 'HEAD']);
  const versionOf = (c) => `${JSON.stringify({ commit: c, date: '2026-09-01' }, null, 2)}\n`;

  // ---- report only ---------------------------------------------------------------
  const P = installedProject('project one', { version: versionOf(BASE) });
  const before = snapshot(P);
  let r = compare(P, ['--kit', K]);
  t('report: exits 0', r.code === 0, r.out);
  t('report: the base comes from Kit-version.json', r.out.includes(`Base: ${BASE} (from project-os/Kit-version.json)`), r.out);
  t('report: the kit commit is named', r.out.includes(`at ${HEAD}`), r.out);
  t('report: writes nothing in the project but its review folder', outsideReview(P) === JSON.stringify(JSON.parse(before)));
  t('report: the project\'s own calibrated files are untouched', read(P, 'CLAUDE.md') === HERE_CHANGES['CLAUDE.md'] && read(P, 'project-os/QA.md') === 'qa v1, for Demo\n');
  t('report: says it changed nothing here, where the merges are, and what --apply would do', r.out.includes('Report only: nothing was written in this project; the merges are in .tmp/kit-merge/ for review. --apply copies the 3 safe files and writes the 1 clean merge into this project.'), r.out);
  t('report: with conflicts left, --apply is not promised to record the kit commit', !r.out.includes('and records the kit commit'), r.out);
  // 2026-10-01: two conflicts and the calibrated files the kit changed or
  // added. The removed Installation.md and the removed analytics file, which
  // the kit also changed, are not among them. 2026-10-02: CLAUDE.md merges
  // cleanly now, so it is not among them either; QA.md clashes.
  t('report: says the version waits for the 4 files and --record', r.out.includes('--apply writes no project-os/Kit-version.json while 4 files are left to carry over by hand') && r.out.includes('with --record'), r.out);

  const expect = {
    'project-os/guards/Path-guard.mjs': 'current',
    'project-os/guards/Destructive-guard.mjs': 'current',
    'project-os/Archive-old-rows.mjs': 'current',
    'project-os/Find-heavy-files.mjs': 'kit updated',
    'project-os/Audit-project-records.mjs': 'new in the kit',
    'project-os/Compare-kit-files.mjs': 'new in the kit',
    'project-os/Hooks.md': 'changed here only',
    'Installation.md': 'removed here',
    'project-os/Install-project-hooks.mjs': 'changed on both sides',
    'project-os/Rule-reasons.md': 'changed on both sides',
    'project-os/Archive-old-rows.ps1': 'gone from the kit',
  };
  for (const [rel, status] of Object.entries(expect)) {
    t(`status: ${rel} is "${status}"`, statusOf(r.out, rel) === status, `got "${statusOf(r.out, rel)}"\n${r.out}`);
  }
  t('status: a file unchanged on both sides is current, line endings aside', statusOf(r.out, 'project-os/guards/Destructive-guard.mjs') === 'current');
  t('status: nothing is "cannot tell" when the base is known', !r.out.includes('cannot tell who changed it  '), r.out);
  t('status: a conflict says it is never overwritten', r.out.includes('project-os/Install-project-hooks.mjs  (conflict: merge by hand, never overwritten)'), r.out);
  t('status: gone from the kit says nothing is deleted', r.out.includes('project-os/Archive-old-rows.ps1  (report only, nothing deleted)'), r.out);
  // 2026-10-01: Installation.md was deleted here and changed in the kit since.
  // It used to read as changed on both sides, at every kit change, for good.
  t('status: a machinery file deleted here is "removed here", never copied back', r.out.includes('Installation.md  (deleted in this project: never copied back)'), r.out);
  t('status: "removed here" is not a conflict', !/changed on both sides\s+Installation\.md/.test(r.out), r.out);
  t('status: a file only the kit has, and the base did not, stays "new in the kit", not "removed here"', statusOf(r.out, 'project-os/Audit-project-records.mjs') === 'new in the kit', r.out);
  t('summary: counts the file removed here', r.out.includes(', 1 removed here,'), r.out);
  t('records: a living record is never listed as machinery', statusOf(r.out, 'project-os/History.md') === null && r.out.includes('Living records: never touched (3 here).'), r.out);
  // 2026-10-01: a record is never copied, but its template's changes are told.
  t('records: a record template the kit changed is reported with its lines', r.out.includes('  project-os/History.md: the kit\'s template changed 2 lines (+2 -0) in 1 place: lines 2-3. Nothing copied; carry an instruction change over by hand.'), r.out);
  t('records: the full-diff command for it is given', r.out.includes(`full diff: git -C "${K}" diff ${BASE} -- project-os/History.md`), r.out);
  t('records: a record template the kit left alone is not reported', !r.out.includes('project-os/Decisions.md:'), r.out);
  t('summary: counts the changed record template', r.out.includes('1 record template changed.'), r.out);
  t('unlisted: a kit file no list names is reported', /not in this script's list[^\n]*\n {2}project-os\/Unlisted-tool\.mjs/.test(r.out), r.out);
  t('unlisted: the kit-only README is not reported', !r.out.includes('README.md'), r.out);
  t('note: a newer Compare-kit-files.mjs in the kit is pointed at', r.out.includes('the kit carries a different Compare-kit-files.mjs'), r.out);

  t('calibrated: CLAUDE.md shows the kit\'s lines and places', calibratedLine(r.out, 'CLAUDE.md').includes('the kit changed 3 lines (+2 -1) in 2 places: line 3, line 9'), calibratedLine(r.out, 'CLAUDE.md'));
  t('calibrated: the full-diff command is given', r.out.includes(`full diff: git -C "${K}" diff ${BASE} -- CLAUDE.md`), r.out);
  t('calibrated: QA.md changed in the kit is reported', calibratedLine(r.out, 'project-os/QA.md').includes('the kit changed 2 lines (+1 -1) in 1 place: line 1'), calibratedLine(r.out, 'project-os/QA.md'));
  t('calibrated: a file the kit did not touch says so', calibratedLine(r.out, 'project-os/Workflow.md').endsWith('unchanged in the kit'), r.out);
  t('calibrated: a tool file removed at install says so', calibratedLine(r.out, 'project-os/mcp/Figma/Figma_MCP_Rules.md').includes('unchanged in the kit; not here'), r.out);
  t('calibrated: a calibrated file new in the kit is to be copied by hand with its setup block', calibratedLine(r.out, 'project-os/Backup-whole-project.mjs') === '  project-os/Backup-whole-project.mjs: new in the kit: copy it by hand and fill its setup block', r.out);
  t('calibrated: a file the kit changed and the project removed says so, with the kit\'s lines', calibratedLine(r.out, 'project-os/mcp/Google_analytics/Google_Analytics_MCP_Rules.md').includes('the kit changed 2 lines (+1 -1) in 1 place: line 1; not here (removed here, so nothing to carry over)'), r.out);
  t('calibrated: never listed as machinery', statusOf(r.out, 'CLAUDE.md') === null, r.out);
  t('summary: counts the clean merge and the two calibrated files to carry over', r.out.includes(', 1 calibrated file merged cleanly, 2 calibrated files to carry over,'), r.out);
  // 2026-10-02: the kit's two changes and this project's edit to line 1 are
  // far enough apart to merge on their own.
  t('calibrated: CLAUDE.md merged cleanly, the merge named for review', calibratedLine(r.out, 'CLAUDE.md').endsWith('; merged cleanly, this project\'s wording kept: .tmp/kit-merge/CLAUDE.md'), calibratedLine(r.out, 'CLAUDE.md'));
  t('calibrated: the clean merge holds this project\'s line and the kit\'s two changes', read(P, '.tmp/kit-merge/CLAUDE.md') === claudeV2.join('\n').replace('claude line 1', 'Demo project, line 1'), read(P, '.tmp/kit-merge/CLAUDE.md'));
  t('calibrated: QA.md, edited on the same line on both sides, is one clash', calibratedLine(r.out, 'project-os/QA.md').endsWith('; 1 clash to settle, marked in .tmp/kit-merge/project-os/QA.md'), calibratedLine(r.out, 'project-os/QA.md'));
  t('calibrated: the clash is printed with both sides\' lines', r.out.includes('    clash 1, line 1 of the merged copy: this project\'s own wording against the kit\'s change; the owner rules\n      here | qa v1, for Demo\n      kit  | qa v2'), r.out);
  t('calibrated: the merged copy of a clash carries the markers', /^<<<<<<< here\nqa v1, for Demo\n\|\|\|\|\|\|\| base\nqa v1\n=======\nqa v2\n>>>>>>> kit\n$/.test(read(P, '.tmp/kit-merge/project-os/QA.md') || ''), read(P, '.tmp/kit-merge/project-os/QA.md'));

  // ---- --apply --------------------------------------------------------------------------
  r = compare(P, ['--kit', K, '--apply']);
  t('apply: exits 0', r.code === 0, r.out);
  t('apply: a kit-updated file is copied', read(P, 'project-os/Find-heavy-files.mjs') === '// heavy v2\n');
  t('apply: files new in the kit are copied', read(P, 'project-os/Audit-project-records.mjs') === '// audit v2\n' && read(P, 'project-os/Compare-kit-files.mjs') === '// a newer compare\n');
  t('apply: a conflict is left as the project had it', read(P, 'project-os/Install-project-hooks.mjs') === '// install hooks, edited here\n' && read(P, 'project-os/Rule-reasons.md') === 'our own reasons\n');
  t('apply: a file changed here only is left alone', read(P, 'project-os/Hooks.md') === 'hooks v1, edited here\n');
  t('apply: a file removed here, though the kit changed it, is not brought back', read(P, 'Installation.md') === null);
  t('apply: a file gone from the kit is not deleted', read(P, 'project-os/Archive-old-rows.ps1') === '# archive v1\n');
  t('apply: the CRLF copy that was current is not rewritten', read(P, 'project-os/guards/Destructive-guard.mjs') === HERE_CHANGES['project-os/guards/Destructive-guard.mjs']);
  t('apply: a calibrated file with a clash is never written, and one new in the kit is never copied', read(P, 'project-os/QA.md') === 'qa v1, for Demo\n' && read(P, 'project-os/Backup-whole-project.mjs') === null);
  t('apply: a clean merge is written, this project\'s line kept and the kit\'s changes in', read(P, 'CLAUDE.md') === claudeV2.join('\n').replace('claude line 1', 'Demo project, line 1'), read(P, 'CLAUDE.md'));
  t('apply: the clean merge is named, never written silently', r.out.includes('Merged into this project, its own wording kept: CLAUDE.md'), r.out);
  t('apply: a living record is never touched', read(P, 'project-os/History.md') === HERE_CHANGES['project-os/History.md']);
  t('apply: an unlisted kit file is not copied', read(P, 'project-os/Unlisted-tool.mjs') === null);
  t('apply: a tool folder removed at install stays removed', read(P, 'project-os/mcp/Figma/Figma_MCP_Rules.md') === null);
  // 2026-10-01: two files are left changed on both sides and two calibrated
  // files are left to carry over, so no version is written. Recording the kit
  // HEAD now would make the next compare read the conflicts as changed here
  // only and the calibrated files as unchanged in the kit, and the kit's
  // changes to them would never show again.
  t('apply with files left: Kit-version.json is left exactly as it was', read(P, 'project-os/Kit-version.json') === versionOf(BASE), read(P, 'project-os/Kit-version.json'));
  t('apply: the report lists what it copied', /Copied from the kit: .*Find-heavy-files\.mjs/.test(r.out), r.out);
  t('apply with files left: each conflict is named with its status', r.out.includes('Kit-version.json was not written: 4 files are still left') && r.out.includes('  project-os/Install-project-hooks.mjs: changed on both sides') && r.out.includes('  project-os/Rule-reasons.md: changed on both sides'), r.out);
  t('apply with files left: the calibrated file with a clash is named, the clean merge is not', r.out.includes('  project-os/QA.md: calibrated, 1 clash to settle, marked in .tmp/kit-merge/project-os/QA.md') && !r.out.includes('  CLAUDE.md: calibrated'), r.out);
  t('apply with files left: the calibrated file new in the kit is named, to copy by hand', r.out.includes('  project-os/Backup-whole-project.mjs: calibrated, new in the kit: copy it by hand and fill its setup block'), r.out);
  t('apply with files left: a file changed here only is not among them', !r.out.includes('project-os/Hooks.md: '), r.out);
  t('apply with files left: a machinery file removed here is not among them', !r.out.includes('  Installation.md: '), r.out);
  t('apply with files left: calibrated files the kit left alone, or the project removed, are not among them', !r.out.includes('  project-os/Workflow.md: calibrated') && !r.out.includes('Figma_MCP_Rules.md: calibrated') && !r.out.includes('Google_Analytics_MCP_Rules.md: calibrated'), r.out);
  t('apply with files left: the --record command is given, the kit path quoted', r.out.includes(`then record the kit commit: node project-os/Compare-kit-files.mjs --kit "${K}" --record`), r.out);
  t('apply with files left: says why the version waits', r.out.includes('read a machinery file as changed here only and a calibrated one as unchanged in the kit'), r.out);
  t('apply with files left: no "Wrote" line', !r.out.includes('Wrote project-os/Kit-version.json'), r.out);
  t('apply: no temporary file is left behind', !Object.keys(JSON.parse(snapshot(P))).some((f) => f.endsWith('.tmp')));

  r = compare(P, ['--kit', K]);
  t('after apply: the base is still the install\'s and the copied file is current', r.out.includes(`Base: ${BASE} (from project-os/Kit-version.json)`) && statusOf(r.out, 'project-os/Find-heavy-files.mjs') === 'current', r.out);
  t('after apply: the conflict still shows as a conflict', statusOf(r.out, 'project-os/Install-project-hooks.mjs') === 'changed on both sides', r.out);
  // The session that stops between --apply and the hand merge: the next one
  // still sees every kit change it has to carry over (2026-10-01).
  t('after apply: the kit\'s change to a calibrated file with a clash still shows', calibratedLine(r.out, 'project-os/QA.md').includes('the kit changed 2 lines') && calibratedLine(r.out, 'project-os/QA.md').includes('1 clash to settle'), r.out);
  t('after apply: the merged file reads as already carried, and holds nothing back', calibratedLine(r.out, 'CLAUDE.md').endsWith('; this copy already carries them') && r.out.includes('while 4 files are left'), r.out);
  t('after apply: nothing left to review is left in the review folder', !exists(P, '.tmp/kit-merge/CLAUDE.md') && exists(P, '.tmp/kit-merge/project-os/QA.md'), r.out);
  t('after apply: the calibrated file new in the kit still shows until it exists here', calibratedLine(r.out, 'project-os/Backup-whole-project.mjs').includes('new in the kit: copy it by hand'), r.out);
  t('after apply: the file removed here is still "removed here"', statusOf(r.out, 'Installation.md') === 'removed here', r.out);

  // ---- --record -------------------------------------------------------------------------
  // The assistant carries the conflicts and the kit's change to CLAUDE.md over
  // by hand, keeping this project's calibration, then records the base.
  write(P, {
    'project-os/Install-project-hooks.mjs': '// install hooks v2, edited here\n',
    'CLAUDE.md': claudeV2.join('\n').replace('claude line 1', 'Demo project, line 1'),
  });
  const beforeRecord = JSON.parse(snapshot(P));
  let version = null;
  r = compare(P, ['--kit', K, '--record']);
  t('record: exits 0', r.code === 0, r.out);
  try { version = JSON.parse(read(P, 'project-os/Kit-version.json')); } catch { version = null; }
  t('record: Kit-version.json names the kit HEAD and today, and nothing else', version && version.commit === HEAD && version.date === TODAY && Object.keys(version).length === 2, read(P, 'project-os/Kit-version.json'));
  t('record: says what it wrote', r.out.includes(`Wrote project-os/Kit-version.json: commit ${HEAD}, ${TODAY}.`), r.out);
  const recorded = {
    'project-os/Install-project-hooks.mjs': 'differs',
    'project-os/Rule-reasons.md': 'differs',
    'project-os/Hooks.md': 'differs',
    'Installation.md': 'not here',
    'project-os/Archive-old-rows.ps1': 'not in the kit',
  };
  for (const [rel, how] of Object.entries(recorded)) {
    t(`record: ${rel} is printed as still "${how}"`, statusOf(r.out, rel) === how, `got "${statusOf(r.out, rel)}"\n${r.out}`);
  }
  t('record: a file that matches the kit is not printed', statusOf(r.out, 'project-os/Find-heavy-files.mjs') === null && statusOf(r.out, 'project-os/guards/Path-guard.mjs') === null, r.out);
  // 2026-10-01: calibrated files are listed too, so one the kit added and
  // nobody copied over is seen before the base moves past it.
  const recordedCalibrated = {
    'CLAUDE.md': 'differs',
    'project-os/QA.md': 'differs',
    'project-os/Backup-whole-project.mjs': 'not here',
    'project-os/mcp/Figma/Figma_MCP_Rules.md': 'not here',
    'project-os/mcp/Google_analytics/Google_Analytics_MCP_Rules.md': 'not here',
  };
  for (const [rel, how] of Object.entries(recordedCalibrated)) {
    t(`record: calibrated ${rel} is printed as still "${how}"`, statusOf(r.out, rel) === how, `got "${statusOf(r.out, rel)}"\n${r.out}`);
  }
  t('record: the calibrated list has its own heading and count', r.out.includes('Calibrated files that still differ from the kit (5)'), r.out);
  t('record: a calibrated file that matches the kit is not printed', statusOf(r.out, 'project-os/Workflow.md') === null && statusOf(r.out, 'project-os/Hooks-settings.json') === null, r.out);
  t('record: living records are not printed', !r.out.includes('History.md') && !r.out.includes('Decisions.md'), r.out);
  t('record: says what the next compare will read the machinery as', r.out.includes(`the kit at ${HEAD} is the base, so the next compare reads those 5 machinery files as this project's own: 4 as changed here only and 1 as removed here.`), r.out);
  t('record: says what the next compare will show of the calibrated files', r.out.includes(`For those 5 calibrated files, the next compare shows only what the kit changes after ${HEAD}.`), r.out);
  const afterRecord = JSON.parse(snapshot(P));
  t('record: writes nothing but Kit-version.json', Object.keys({ ...beforeRecord, ...afterRecord }).every((f) => f === 'project-os/Kit-version.json' || beforeRecord[f] === afterRecord[f]));
  r = compare(P, ['--kit', K]);
  t('after record: the base is the kit HEAD', r.out.includes(`Base: ${HEAD} (from project-os/Kit-version.json)`), r.out);
  t('after record: the merged file reads as changed here only', statusOf(r.out, 'project-os/Install-project-hooks.mjs') === 'changed here only', r.out);
  t('after record: the file removed here reads as removed here', statusOf(r.out, 'Installation.md') === 'removed here', r.out);
  t('after record: a calibrated file carried over reads as unchanged in the kit', calibratedLine(r.out, 'CLAUDE.md').endsWith('unchanged in the kit'), r.out);
  t('after record: a compare with nothing to merge empties the review folder of the old merges', !exists(P, '.tmp/kit-merge'), r.out);

  // ---- --apply with nothing left to carry over by hand -------------------------------
  // The machinery conflicts are gone, and the calibrated files the kit changed
  // or added already match the kit: nothing is left, so --apply records. The
  // analytics file and Installation.md, both removed here and both changed in
  // the kit, hold nothing back (2026-10-01).
  const CLEAN = installedProject('project clean', { version: versionOf(BASE) });
  write(CLEAN, {
    'project-os/Install-project-hooks.mjs': '// install hooks v1\n',
    'project-os/Rule-reasons.md': null,
    'CLAUDE.md': V2_CHANGES['CLAUDE.md'],
    'project-os/QA.md': V2_CHANGES['project-os/QA.md'],
    'project-os/Backup-whole-project.mjs': V2_CHANGES['project-os/Backup-whole-project.mjs'],
  });
  r = compare(CLEAN, ['--kit', K]);
  t('clean: the report promises the kit commit too', r.out.includes('--apply copies the 5 safe files and records the kit commit.') && !r.out.includes('writes no project-os/Kit-version.json while'), r.out);
  t('clean: with nothing to merge, no review folder is made and the report says nothing was written', !exists(CLEAN, '.tmp/kit-merge') && r.out.includes('Report only: nothing was written. --apply'), r.out);
  t('clean: a calibrated file the kit changed that matches it says so', calibratedLine(r.out, 'CLAUDE.md').endsWith('; this copy already matches the kit'), r.out);
  t('clean: a calibrated file new in the kit that is here already says so', calibratedLine(r.out, 'project-os/Backup-whole-project.mjs').endsWith('new in the kit, and this project already has the same file'), r.out);
  r = compare(CLEAN, ['--kit', K, '--apply']);
  try { version = JSON.parse(read(CLEAN, 'project-os/Kit-version.json')); } catch { version = null; }
  t('clean: --apply copies the safe files', r.code === 0 && read(CLEAN, 'project-os/Install-project-hooks.mjs') === '// install hooks v2\n' && read(CLEAN, 'project-os/Rule-reasons.md') === 'reasons from the kit\n', r.out);
  t('clean: --apply writes Kit-version.json with the kit HEAD and today', version && version.commit === HEAD && version.date === TODAY && Object.keys(version).length === 2, read(CLEAN, 'project-os/Kit-version.json'));
  t('clean: files removed here stay removed', read(CLEAN, 'Installation.md') === null && read(CLEAN, 'project-os/mcp/Google_analytics/Google_Analytics_MCP_Rules.md') === null, r.out);
  t('clean: no --record is asked', !r.out.includes('--record'), r.out);
  t('clean: the changed record template is named while it can still be seen', r.out.includes('The kit also changed the template of project-os/History.md. Carry any instruction change in it over by hand now'), r.out);
  t('clean: the record itself is not touched', read(CLEAN, 'project-os/History.md') === HERE_CHANGES['project-os/History.md'], r.out);
  r = compare(CLEAN, ['--kit', K, '--record']);
  t('clean: --record after a clean apply prints only what still differs, such as a file changed here',r.code === 0 && statusOf(r.out, 'project-os/Install-project-hooks.mjs') === null && statusOf(r.out, 'project-os/Hooks.md') === 'differs', r.out);

  // ---- --apply with only calibrated files left ------------------------------------------
  // 2026-10-01: the machinery is settled, but the calibrated files still carry
  // the kit's changes. --apply copies the machinery and writes no version, so
  // a session that stops before the hand merge loses nothing.
  const CAL = installedProject('project calibrated left', { version: versionOf(BASE) });
  write(CAL, { 'project-os/Install-project-hooks.mjs': '// install hooks v1\n', 'project-os/Rule-reasons.md': null });
  r = compare(CAL, ['--kit', K]);
  t('calibrated left: the report does not promise the kit commit', r.out.includes('--apply copies the 5 safe files and writes the 1 clean merge into this project.') && r.out.includes('while 2 files are left to carry over by hand'), r.out);
  r = compare(CAL, ['--kit', K, '--apply']);
  t('calibrated left: --apply copies the machinery and exits 0', r.code === 0 && read(CAL, 'project-os/Install-project-hooks.mjs') === '// install hooks v2\n', r.out);
  t('calibrated left: Kit-version.json is left as it was', read(CAL, 'project-os/Kit-version.json') === versionOf(BASE), read(CAL, 'project-os/Kit-version.json'));
  t('calibrated left: only the calibrated files are named', r.out.includes('Kit-version.json was not written: 2 files are still left') && r.out.includes('  project-os/QA.md: calibrated, 1 clash to settle') && !r.out.includes('changed on both sides'), r.out);
  t('calibrated left: the calibrated file new in the kit is never copied', read(CAL, 'project-os/Backup-whole-project.mjs') === null, r.out);
  t('calibrated left: no record template line, since nothing was recorded', !r.out.includes('The kit also changed the template'), r.out);
  r = compare(CAL, ['--kit', K]);
  t('calibrated left: the next compare still shows the kit\'s changes', calibratedLine(r.out, 'project-os/QA.md').includes('the kit changed 2 lines') && calibratedLine(r.out, 'project-os/Backup-whole-project.mjs').includes('new in the kit: copy it by hand'), r.out);
  write(CAL, { 'project-os/Backup-whole-project.mjs': '// backup mjs, its setup block filled\n' });
  r = compare(CAL, ['--kit', K]);
  t('calibrated left: once copied by hand and filled, it is no longer "new in the kit: copy it"', calibratedLine(r.out, 'project-os/Backup-whole-project.mjs').includes('new in the kit, and this project has its own'), r.out);

  // ---- --record when the project matches the kit ------------------------------------
  const SAME = path.join(TMP, 'project same as kit');
  write(SAME, { ...V1, ...V2_CHANGES });
  r = compare(SAME, ['--kit', K, '--record']);
  t('record, nothing differs: says so and records', r.code === 0 && r.out.includes('Every machinery file matches the kit.') && r.out.includes('Every calibrated file matches the kit.') && !r.out.includes('From here on') && !r.out.includes('the next compare shows only') && JSON.parse(read(SAME, 'project-os/Kit-version.json') || '{}').commit === HEAD, r.out);

  // ---- no base -------------------------------------------------------------------------
  const N = installedProject('project no base');
  write(N, { 'Installation.md': 'install law v1\n' });
  r = compare(N, ['--kit', K]);
  t('no base: exits 0 and says how to name one', r.code === 0 && r.out.includes('Base: unknown') && r.out.includes('pass the kit commit named in the install row of project-os/History.md with --base <commit>'), r.out);
  t('no base: says the kit clone needs its full history', r.out.includes('The kit clone needs its full history'), r.out);
  // 2026-10-02: the kit's history is searched first. One script edited here
  // matches no commit, so nothing is guessed, and the closest one is named.
  t('no base: the search of the kit\'s history is said, with the closest commit', r.out.includes(`no project-os/Kit-version.json here, and no commit the kit clone holds has the scripts and guards here (6) as they are, line endings aside (the closest, ${BASE}, has 4 of them), so the base is unknown`), r.out);
  t('no base: a file that differs is "cannot tell who changed it"', statusOf(r.out, 'project-os/Find-heavy-files.mjs') === 'cannot tell who changed it', r.out);
  // 2026-10-01: nothing of the project's is overwritten by a file it does not have.
  t('no base: a file only in the kit is "new in the kit", safe to copy', statusOf(r.out, 'project-os/Audit-project-records.mjs') === 'new in the kit' && r.out.includes('project-os/Audit-project-records.mjs  (safe to copy)'), r.out);
  t('no base: an identical file is still current', statusOf(r.out, 'project-os/guards/Path-guard.mjs') === 'current', r.out);
  t('no base: calibrated files say the kit\'s changes cannot be told', calibratedLine(r.out, 'CLAUDE.md').includes('no base'), r.out);
  t('no base: the record templates say so once', r.out.includes('  no base, so the kit\'s changes to their templates cannot be told') && !r.out.includes('project-os/History.md: the kit\'s template'), r.out);
  r = compare(N, ['--kit', K, '--apply']);
  t('no base: --apply copies the files new in the kit', r.code === 0 && read(N, 'project-os/Audit-project-records.mjs') === '// audit v2\n' && read(N, 'project-os/Compare-kit-files.mjs') === '// a newer compare\n', r.out);
  t('no base: --apply never copies a file it cannot tell about', read(N, 'project-os/Find-heavy-files.mjs') === '// heavy v1\n' && read(N, 'project-os/Install-project-hooks.mjs') === '// install hooks, edited here\n', r.out);
  t('no base: --apply writes no version and names what to carry over first', read(N, 'project-os/Kit-version.json') === null && r.out.includes('  project-os/Find-heavy-files.mjs: cannot tell who changed it') && r.out.includes('--record'), r.out);

  // Without a base, an Installation.md the owner deleted is not brought back:
  // every install places it, so its absence is the owner's choice.
  const N2 = installedProject('project no base no install law');
  write(N2, { 'Installation.md': null });
  r = compare(N2, ['--kit', K]);
  t('no base: an Installation.md missing here is "removed here", not new', statusOf(r.out, 'Installation.md') === 'removed here', r.out);
  r = compare(N2, ['--kit', K, '--apply']);
  t('no base: --apply does not bring Installation.md back', read(N2, 'Installation.md') === null, r.out);

  // ---- --base ----------------------------------------------------------------------------
  const B = installedProject('project base flag');
  r = compare(B, ['--kit', K, '--base', BASE]);
  t('--base: names the base without Kit-version.json', r.code === 0 && r.out.includes(`Base: ${BASE} (from --base)`) && statusOf(r.out, 'project-os/Find-heavy-files.mjs') === 'kit updated', r.out);
  const BOGUS = installedProject('project bogus base', { version: versionOf('deadbeef') });
  r = compare(BOGUS, ['--kit', K]);
  t('a base the clone does not have is said plainly, and nothing is guessed', r.code === 0 && r.out.includes('is not in the kit clone') && statusOf(r.out, 'project-os/Find-heavy-files.mjs') === 'cannot tell who changed it', r.out);
  r = compare(BOGUS, ['--kit', K, '--base', BASE]);
  t('--base wins over Kit-version.json', r.out.includes(`Base: ${BASE} (from --base)`), r.out);
  const BROKEN = installedProject('project broken version', { version: '{ not json' });
  r = compare(BROKEN, ['--kit', K]);
  t('a Kit-version.json that is not JSON is said plainly', r.code === 0 && r.out.includes('is not valid JSON') && r.out.includes('Base: unknown'), r.out);

  // ---- a shallow clone has no base to read --------------------------------------------------
  const SHALLOW = path.join(TMP, 'shallow kit');
  git(TMP, ['clone', '-q', '--depth', '1', pathToFileURL(K).href, SHALLOW]);
  r = compare(installedProject('project shallow', { version: versionOf(BASE) }), ['--kit', SHALLOW]);
  t('a --depth 1 clone: the base is missing and the fix is named', r.code === 0 && r.out.includes('is not in the kit clone') && r.out.includes('without --depth'), r.out);

  // ---- a kit folder that is not a git clone -----------------------------------------------
  const PLAIN = path.join(TMP, 'plain kit');
  write(PLAIN, { ...V1, ...V2_CHANGES });
  const PP = installedProject('project plain kit', { version: versionOf(BASE) });
  r = compare(PP, ['--kit', PLAIN, '--apply']);
  t('a kit with no git: said plainly, only files new in the kit copied, no version written', r.code === 0 && r.out.includes('(not a git clone)') && read(PP, 'project-os/Find-heavy-files.mjs') === '// heavy v1\n' && read(PP, 'project-os/Audit-project-records.mjs') === '// audit v2\n' && JSON.parse(read(PP, 'project-os/Kit-version.json')).commit === BASE, r.out);
  t('a kit with no git: --record cannot name a commit either, and that is said', r.out.includes('--record cannot name its commit either'), r.out);
  r = compare(PP, ['--kit', PLAIN, '--record']);
  t('--record against a kit with no git: exits 1 and writes no version', r.code === 1 && r.out.includes('was not written: the kit folder is not a git clone') && JSON.parse(read(PP, 'project-os/Kit-version.json')).commit === BASE, r.out);

  // A ZIP unpacked into a git project's .tmp/ is inside the project's
  // repository; the project's history must never be read as the kit's.
  const GP = installedProject('project git with zip kit', { version: versionOf(BASE) });
  git(GP, ['-c', 'init.defaultBranch=main', 'init', '-q']);
  git(GP, ['add', '-A']);
  git(GP, ['commit', '-q', '--no-verify', '-m', 'the project']);
  write(GP, Object.fromEntries(Object.entries({ ...V1, ...V2_CHANGES }).map(([k, v]) => [`.tmp/projectos-kit/${k}`, v])));
  r = compare(GP, ['--kit', '.tmp/projectos-kit']);
  t('a kit unpacked inside the project\'s repository is not read through the project\'s git', r.code === 0 && r.out.includes('(not a git clone)') && !r.out.includes(`at ${git(GP, ['rev-parse', '--short', 'HEAD'])}`), r.out);

  // ---- merging with this project's values (2026-10-02) -----------------------------------
  // Every line the install filled in used to read as a clash wherever the kit
  // touched it or wrote next to it, and "this project's wording wins" then
  // dropped the kit's change: a new Go commit step beside the filled check
  // command was lost that way. Here the values are read back from the
  // project's own files, both kit copies are filled with them, and only a
  // real edit here, or a setup block the kit reworded, is a clash.
  const MK = path.join(TMP, 'merge kit');
  fs.mkdirSync(MK, { recursive: true });
  git(MK, ['-c', 'init.defaultBranch=main', 'init', '-q']);
  const claudeM1 = [
    '# {{PROJECT_NAME}}: working rules',
    '',
    '{{PROJECT_NAME}}: {{STACK}}.',
    '',
    '> **Setup step: replace this section.** Write what the product does.',
    '> Then delete this quoted block.',
    '',
    'You work for {{OWNER_NAME}}, a {{OWNER_ROLE}}.',
    '',
    '| Local app | `{{DEV_URL}}` |',
    '| Checks | `{{CHECK_COMMAND}}` |',
    '',
    '## Go commit',
    '',
    '1. Rotate the docs.',
    '2. Read the diff.',
    '3. Run the project checks `{{CHECK_COMMAND}}` and continue only if they pass.',
    '4. Commit.',
    '',
    '## Rule 15',
    '',
    'Rule fifteen, as the kit wrote it.',
    '',
    '## Rule 16',
    '',
    '> **Setup step: the install fills this, then deletes this block.** Ask the',
    '> owner who starts the dev server.',
    '',
    'Assume the owner runs one at `{{DEV_URL}}`.',
    '',
    '## End',
    '',
    'The last kit line.',
  ];
  const M1 = {
    'Installation.md': 'install law\n',
    'project-os/guards/Path-guard.mjs': '// path guard\n',
    'CLAUDE.md': `${claudeM1.join('\n')}\n`,
    'project-os/Workflow.md': 'Workflow for {{PROJECT_NAME}}.\nstep one\n',
    'project-os/QA.md': 'qa line\n',
    'project-os/Conversations.md': 'Replies to {{OWNER_NAME}}.\nrule a\nRead this first. {{OWNER_NAME}} can override any rule.\n',
    'project-os/Code_review.md': 'Review {{PROJECT_NAME}}.\n',
    'project-os/Visual_QA.md': '{{OWNER_NAME}} tests.\nAsk {{OWNER_NAME}} first.\n',
    'project-os/mcp/Figma/Figma_MCP_Rules.md': 'Figma for {{PROJECT_NAME}}.\nsetup\nfigma rules\n',
  };
  write(MK, M1);
  git(MK, ['add', '-A']);
  git(MK, ['commit', '-q', '--no-verify', '-m', 'm1']);
  const MBASE = git(MK, ['rev-parse', '--short', 'HEAD']);
  const claudeM2 = claudeM1.map((l) => ({
    '# {{PROJECT_NAME}}: working rules': '# {{PROJECT_NAME}}: working rules for your assistant', // a kit change on a filled line
    '2. Read the diff.': '2. Read the diff.\n2b. Run the audit.', // a new step right beside the filled check command
    '4. Commit.': '4. Commit.\n5. Open {{DEV_URL}} and look.', // a new line bringing a value this project has
    'Rule fifteen, as the kit wrote it.': 'Rule fifteen, as the kit now words it.', // edited here too: a real clash
    '> owner who starts the dev server.': '> owner who starts the dev server, and where it runs.', // a setup block this project filled
  }[l] ?? l));
  write(MK, {
    'CLAUDE.md': `${claudeM2.join('\n')}\n`,
    'project-os/Workflow.md': 'Workflow for {{PROJECT_NAME}}.\nstep one\nAsk {{NEW_THING}} first.\n', // a value nothing here gives
    'project-os/QA.md': 'qa line\nRun `{{CHECK_COMMAND}}` before calling it done.\n', // a value another file gives
    // This copy differs from the base by its values only. The kit adds a rule
    // and rewraps a line, and the rewrapped half "{{OWNER_NAME}} can override
    // any rule." sits beside this copy's unwrapped line: read as a value, it
    // would make "Read this first. Dana" a second owner name.
    'project-os/Conversations.md': 'Replies to {{OWNER_NAME}}.\nrule a\nrule b\nRead this first.\n{{OWNER_NAME}} can override any rule.\n',
    'project-os/Code_review.md': 'Review {{PROJECT_NAME}}.\nA new check.\n', // already carried over here
    'project-os/Visual_QA.md': '{{OWNER_NAME}} tests.\nAsk {{OWNER_NAME}} first.\nShow {{OWNER_NAME}} the result.\n', // filled two ways here
    'project-os/mcp/Figma/Figma_MCP_Rules.md': 'Figma for {{PROJECT_NAME}}, once connected.\nsetup\nfigma rules\n', // a line this project left unfilled
  });
  git(MK, ['add', '-A']);
  git(MK, ['commit', '-q', '--no-verify', '-m', 'm2']);
  const claudeHere = [
    '# Demo: working rules',
    '',
    'Demo: a static site.',
    '',
    'Demo is a portfolio site for one designer, live since 2026.',
    '',
    'You work for Dana, a product designer.',
    '',
    '| Local app | `http://localhost:4321` |',
    '| Checks | `npm test` |',
    '',
    '## Go commit',
    '',
    '1. Rotate the docs.',
    '2. Read the diff.',
    '3. Run the project checks `npm test` and continue only if they pass.',
    '4. Commit.',
    '',
    '## Rule 15',
    '',
    'Rule fifteen, as the owner reworded it.',
    '',
    '## Rule 16',
    '',
    'Assume the owner runs one at `http://localhost:4321`.',
    '',
    '## End',
    '',
    'The last kit line.',
    'A line the owner added.',
  ];
  const MP = path.join(TMP, 'project merged');
  write(MP, {
    ...M1,
    'CLAUDE.md': `${claudeHere.join('\n')}\n`,
    'project-os/Workflow.md': 'Workflow for Demo.\nstep one\n',
    'project-os/QA.md': 'The owner\'s own QA intro.\r\nqa line\r\n', // CRLF from checkout
    'project-os/Conversations.md': 'Replies to Dana.\nrule a\nRead this first. Dana can override any rule.\n',
    'project-os/Code_review.md': 'Review Demo.\nA new check.\n',
    'project-os/Visual_QA.md': 'Dana tests.\nAsk Dana Levi first.\n',
    'project-os/mcp/Figma/Figma_MCP_Rules.md': 'Figma for {{PROJECT_NAME}}.\nsetup\nfigma rules, ours\n',
    'project-os/Kit-version.json': versionOf(MBASE),
  });
  const mpBefore = snapshot(MP);
  r = compare(MP, ['--kit', MK]);
  const merged = read(MP, '.tmp/kit-merge/CLAUDE.md') || '';
  t('merge: exits 0 and changes nothing outside the review folder', r.code === 0 && outsideReview(MP) === mpBefore, r.out);
  t('merge: the values are read from the project\'s own files and shown', r.out.includes('  This project\'s values, read from its own files: {{CHECK_COMMAND}} "npm test", {{DEV_URL}} "http://localhost:4321", {{OWNER_ROLE}} "product designer", {{PROJECT_NAME}} "Demo", {{STACK}} "a static site".'), r.out);
  t('merge: a value filled two ways is said, and never guessed', r.out.includes('  {{OWNER_NAME}} is filled more than one way here ("Dana", "Dana Levi"), so a kit line that brings it is left unfilled.'), r.out);
  t('merge: a kit change on a filled line comes in, filled', merged.startsWith('# Demo: working rules for your assistant\n'), merged);
  t('merge: a new kit step beside a filled value comes in, the filled value kept', merged.includes('2. Read the diff.\n2b. Run the audit.\n3. Run the project checks `npm test` and continue only if they pass.\n'), merged);
  t('merge: a new kit line is filled with the project\'s value', merged.includes('4. Commit.\n5. Open http://localhost:4321 and look.\n'), merged);
  t('merge: the description that replaced a setup block is kept', merged.includes('Demo is a portfolio site for one designer, live since 2026.') && !merged.includes('Write what the product does.'), merged);
  t('merge: a line the owner added is kept', merged.endsWith('The last kit line.\nA line the owner added.\n'), merged);
  t('merge: no filled-in line reads as a clash, only the 2 real ones do', calibratedLine(r.out, 'CLAUDE.md').endsWith('; 2 clashes to settle, marked in .tmp/kit-merge/CLAUDE.md') && (merged.match(/^<<<<<<< here$/gm) || []).length === 2, `${calibratedLine(r.out, 'CLAUDE.md')}\n${merged}`);
  t('merge: an owner edit against a kit edit is a clash with both lines, for the owner', /clash 1, line \d+ of the merged copy: this project's own wording against the kit's change; the owner rules\n {6}here \| Rule fifteen, as the owner reworded it\.\n {6}kit {2}\| Rule fifteen, as the kit now words it\./.test(r.out), r.out);
  t('merge: a setup block the install filled, reworded by the kit, is told apart', /clash 2, line \d+ of the merged copy: a setup block the install filled, whose instructions the kit changed; fill the kit's new block again from this project's answer/.test(r.out) && r.out.includes('      here | (nothing: this project removed these lines)') && r.out.includes('      kit  | > owner who starts the dev server, and where it runs.'), r.out);
  t('merge: the filled kit copies are kept for review', (read(MP, '.tmp/kit-merge/.inputs/CLAUDE.md/kit-filled') || '').startsWith('# Demo: working rules for your assistant\n') && (read(MP, '.tmp/kit-merge/.inputs/CLAUDE.md/base-filled') || '').startsWith('# Demo: working rules\n'));
  t('merge: a file that differs from the base only by its values merges cleanly, a kit rewrap included', calibratedLine(r.out, 'project-os/Conversations.md').endsWith('merged cleanly, this project\'s wording kept: .tmp/kit-merge/project-os/Conversations.md') && read(MP, '.tmp/kit-merge/project-os/Conversations.md') === 'Replies to Dana.\nrule a\nrule b\nRead this first.\nDana can override any rule.\n', `${r.out}\n${read(MP, '.tmp/kit-merge/project-os/Conversations.md')}`);
  t('merge: a kit line beside an unrelated line here never teaches a second value', !r.out.includes('"Read this first. Dana"'), r.out);
  t('merge: a value from another file fills a new kit line', read(MP, '.tmp/kit-merge/project-os/QA.md') === 'The owner\'s own QA intro.\nqa line\nRun `npm test` before calling it done.\n', read(MP, '.tmp/kit-merge/project-os/QA.md'));
  t('merge: a kit change this copy already carries is said, and nothing is left for review', calibratedLine(r.out, 'project-os/Code_review.md').endsWith('; this copy already carries them') && !exists(MP, '.tmp/kit-merge/project-os/Code_review.md'), r.out);
  t('merge: a new placeholder nothing here fills is named, and holds the version back', calibratedLine(r.out, 'project-os/Workflow.md').endsWith('merged cleanly into .tmp/kit-merge/project-os/Workflow.md, but its new lines bring {{NEW_THING}}, which nothing here fills') && read(MP, '.tmp/kit-merge/project-os/Workflow.md') === 'Workflow for Demo.\nstep one\nAsk {{NEW_THING}} first.\n', r.out);
  // 2026-10-02 (round two): a line holding a placeholder filled two ways is
  // this project's own edit, never taken for a fill, so the kit's new line
  // beside it is a clash; the kit's new line still comes unfilled.
  t('merge: a placeholder filled two ways is left unfilled in the kit\'s new line, beside lines that stay this project\'s own', calibratedLine(r.out, 'project-os/Visual_QA.md').endsWith('; 1 clash to settle, marked in .tmp/kit-merge/project-os/Visual_QA.md, and its new lines bring {{OWNER_NAME}}, which this project fills more than one way') && (read(MP, '.tmp/kit-merge/project-os/Visual_QA.md') || '').includes('=======\n{{OWNER_NAME}} tests.\nAsk {{OWNER_NAME}} first.\nShow {{OWNER_NAME}} the result.\n>>>>>>> kit'), `${r.out}\n${read(MP, '.tmp/kit-merge/project-os/Visual_QA.md')}`);
  t('merge: a placeholder line this copy left unfilled is not a clash when the kit rewords it', calibratedLine(r.out, 'project-os/mcp/Figma/Figma_MCP_Rules.md').includes('merged cleanly') && read(MP, '.tmp/kit-merge/project-os/mcp/Figma/Figma_MCP_Rules.md') === 'Figma for Demo, once connected.\nsetup\nfigma rules, ours\n', `${calibratedLine(r.out, 'project-os/mcp/Figma/Figma_MCP_Rules.md')}\n${read(MP, '.tmp/kit-merge/project-os/mcp/Figma/Figma_MCP_Rules.md')}`);
  t('merge: the report counts the clean merges and what is left', r.out.includes(', 3 calibrated files merged cleanly, 3 calibrated files to carry over,') && r.out.includes('--apply writes the 3 clean merges into this project.') && r.out.includes('while 3 files are left'), r.out);

  r = compare(MP, ['--kit', MK, '--apply']);
  t('merge apply: exits 0', r.code === 0, r.out);
  t('merge apply: a clean merge is written in the copy\'s own line endings', read(MP, 'project-os/QA.md') === 'The owner\'s own QA intro.\r\nqa line\r\nRun `npm test` before calling it done.\r\n', JSON.stringify(read(MP, 'project-os/QA.md')));
  t('merge apply: a file that only had its values filled takes the kit\'s change, filled', read(MP, 'project-os/Conversations.md') === 'Replies to Dana.\nrule a\nrule b\nRead this first.\nDana can override any rule.\n');
  t('merge apply: a file with clashes is never written', read(MP, 'CLAUDE.md') === `${claudeHere.join('\n')}\n`);
  t('merge apply: a merge that brings an unfilled placeholder is never written', read(MP, 'project-os/Workflow.md') === 'Workflow for Demo.\nstep one\n' && read(MP, 'project-os/Visual_QA.md') === 'Dana tests.\nAsk Dana Levi first.\n');
  t('merge apply: every write is named', r.out.includes('Merged into this project, its own wording kept: project-os/QA.md, project-os/Conversations.md, project-os/mcp/Figma/Figma_MCP_Rules.md'), r.out);
  t('merge apply: the files left are named with what to do, and no version is written', r.out.includes('Kit-version.json was not written: 3 files are still left') && r.out.includes('  CLAUDE.md: calibrated, 2 clashes to settle, marked in .tmp/kit-merge/CLAUDE.md') && r.out.includes('  project-os/Workflow.md: calibrated, the merge brings {{NEW_THING}}, which nothing here fills: copy .tmp/kit-merge/project-os/Workflow.md over this project\'s copy by hand, then fill {{NEW_THING}} there') && read(MP, 'project-os/Kit-version.json') === versionOf(MBASE), r.out);
  // The assistant copies the merge over and fills the new placeholder; the
  // next compare reads the value back from that line and calls it carried.
  write(MP, { 'project-os/Workflow.md': 'Workflow for Demo.\nstep one\nAsk the design lead first.\n' });
  r = compare(MP, ['--kit', MK]);
  t('merge, after a hand fill: the new placeholder\'s value is read back and the file reads as carried', calibratedLine(r.out, 'project-os/Workflow.md').endsWith('; this copy already carries them'), calibratedLine(r.out, 'project-os/Workflow.md'));
  t('merge, after apply: the written merges read as carried', calibratedLine(r.out, 'project-os/QA.md').endsWith('; this copy already carries them') && calibratedLine(r.out, 'project-os/Conversations.md').endsWith('; this copy already carries them'), r.out);
  t('merge, after apply: their merged copies are no longer in the review folder', !exists(MP, '.tmp/kit-merge/project-os/QA.md') && exists(MP, '.tmp/kit-merge/CLAUDE.md'), r.out);

  // The owner joined a placeholder line onto the line before it, and the kit
  // then reworded that line. The joined line is this project's own edit, so it
  // clashes; it is never read as a value, nor taken for the filled base line.
  const JK = path.join(TMP, 'join kit');
  fs.mkdirSync(JK, { recursive: true });
  git(JK, ['-c', 'init.defaultBranch=main', 'init', '-q']);
  write(JK, { 'Installation.md': 'law\n', 'project-os/Conversations.md': 'Replies to {{OWNER_NAME}}.\n', 'project-os/QA.md': 'Intro.\n{{OWNER_NAME}} can override.\nlast\n' });
  git(JK, ['add', '-A']);
  git(JK, ['commit', '-q', '--no-verify', '-m', 'j1']);
  const JBASE = git(JK, ['rev-parse', '--short', 'HEAD']);
  write(JK, { 'project-os/QA.md': 'Intro.\n{{OWNER_NAME}} can override, always.\nlast\n' });
  git(JK, ['add', '-A']);
  git(JK, ['commit', '-q', '--no-verify', '-m', 'j2']);
  const JP = path.join(TMP, 'project joined lines');
  write(JP, { 'Installation.md': 'law\n', 'project-os/Conversations.md': 'Replies to Dana.\n', 'project-os/QA.md': 'Intro. Dana can override.\nlast\n', 'project-os/Kit-version.json': versionOf(JBASE) });
  r = compare(JP, ['--kit', JK]);
  t('joined lines: the owner\'s joined line is never read as a value', r.out.includes('  This project\'s values, read from its own files: {{OWNER_NAME}} "Dana".') && !r.out.includes('Intro. Dana"') && !r.out.includes('more than one way'), r.out);
  t('joined lines: the kit\'s change to the line the owner joined is a clash, the joined line kept on its side', calibratedLine(r.out, 'project-os/QA.md').endsWith('; 1 clash to settle, marked in .tmp/kit-merge/project-os/QA.md') && r.out.includes('      here | Intro. Dana can override.\n      kit  | Intro.\n      kit  | Dana can override, always.'), r.out);

  // ---- round two follow-ups (2026-10-02) ------------------------------------------------
  // A kit of two commits, the base and one change, and a project installed
  // from the base, for one case each.
  const twoCommitKit = (name, before, after) => {
    const dir = path.join(TMP, name);
    fs.mkdirSync(dir, { recursive: true });
    git(dir, ['-c', 'init.defaultBranch=main', 'init', '-q']);
    write(dir, { 'Installation.md': 'law\n', 'project-os/Workflow.md': 'flow\n', ...before });
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '--no-verify', '-m', 'before']);
    const base = git(dir, ['rev-parse', '--short', 'HEAD']);
    write(dir, after);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '--no-verify', '-m', 'after']);
    return { dir, base, head: git(dir, ['rev-parse', '--short', 'HEAD']) };
  };
  const projectOn = (name, kit, files) => {
    const dir = path.join(TMP, name);
    write(dir, { 'Installation.md': 'law\n', 'project-os/Workflow.md': 'flow\n', ...files, 'project-os/Kit-version.json': versionOf(kit.base) });
    return dir;
  };
  const lastLine = (out) => out.trimEnd().split('\n').pop();
  const NEWER_STEPS = 'This project\'s CLAUDE.md now carries newer Go update kit steps than the ones this update started from: finish this update with steps 5 to 8 as the merged CLAUDE.md writes them.';

  // R5, the Merge-probe repro. The project wrote an owner sentence on the line
  // that carried the name, so the name reads two ways. Round one took that
  // line for a pure fill because it was paired line for line, the kit's
  // rewrite of it dropped the sentence from a merge reported clean, and
  // --apply recorded the kit, so the loss never showed again.
  const AK = twoCommitKit('atlas kit', {
    'CLAUDE.md': '# {{PROJECT_NAME}}: working rules\n\nProject: {{PROJECT_NAME}}\n\nYou work for {{OWNER_NAME}}.\n\n## Rules\n\n1. Rule one.\n2. Rule two.\n',
  }, {
    'CLAUDE.md': '# {{PROJECT_NAME}}: working rules\n\nProject: see the title above.\n\nYou work for {{OWNER_NAME}}.\n\n## Rules\n\n1. Rule one.\n2. Rule two.\n3. Rule three.\n',
  });
  const atlasHere = '# Atlas Studio: working rules\n\nProject: Atlas Studio. Internal only, never share the staging URL.\n\nYou work for Dana.\n\n## Rules\n\n1. Rule one.\n2. Rule two.\n';
  const AP = projectOn('project atlas', AK, { 'CLAUDE.md': atlasHere });
  r = compare(AP, ['--kit', AK.dir]);
  t('owner sentence on a filled line: the name read two ways is said', r.out.includes('{{PROJECT_NAME}} is filled more than one way here ("Atlas Studio", "Atlas Studio. Internal only, never share the staging URL.")'), r.out);
  t('owner sentence on a filled line: the kit\'s rewrite of it is a clash for the owner, never a clean merge', calibratedLine(r.out, 'CLAUDE.md').endsWith('; 1 clash to settle, marked in .tmp/kit-merge/CLAUDE.md') && r.out.includes('this project\'s own wording against the kit\'s change; the owner rules\n      here | Project: Atlas Studio. Internal only, never share the staging URL.\n      kit  | Project: see the title above.'), r.out);
  t('owner sentence on a filled line: a placeholder on the base side of a clash is not called brought', !calibratedLine(r.out, 'CLAUDE.md').includes('bring'), r.out);
  r = compare(AP, ['--kit', AK.dir, '--apply']);
  t('owner sentence on a filled line: --apply keeps the sentence and records no kit commit', r.code === 0 && read(AP, 'CLAUDE.md') === atlasHere && read(AP, 'project-os/Kit-version.json') === versionOf(AK.base), r.out);

  // R4, the branch answer. The install fills Go commit step 6's bracket with
  // the owner's answer. It is no placeholder, so a kit edit beside it went to
  // the owner as their own wording, and either side they took lost something.
  const goCommit = (step6, word = 'every') => `# Demo: rules\n\n## Go commit\n\n5. Stage the intended files only.\n${step6}\n7. STOP after the commit. Outside a cloud session the owner pushes, ${word}\n   time (rule 22).\n`;
  const kitGoCommit = (step6, word) => goCommit(step6, word).replace('# Demo:', '# {{PROJECT_NAME}}:');
  const BRACKET = '6. Commit with a clear message covering the full scope, [on the current\n   branch / on a task branch, per the owner\'s answer at install].';
  const ON_CURRENT = '6. Commit with a clear message covering the full scope, on the current\n   branch.';
  const ON_TASK = '6. Commit with a clear message covering the full scope, on a task branch.';
  const BK = twoCommitKit('branch kit', { 'CLAUDE.md': kitGoCommit(BRACKET) }, { 'CLAUDE.md': kitGoCommit(BRACKET, 'each') });
  const BP = projectOn('project branch answer', BK, { 'CLAUDE.md': goCommit(ON_CURRENT) });
  r = compare(BP, ['--kit', BK.dir]);
  t('branch answer: a kit edit beside it merges cleanly, the answer kept', calibratedLine(r.out, 'CLAUDE.md').endsWith('; merged cleanly, this project\'s wording kept: .tmp/kit-merge/CLAUDE.md') && read(BP, '.tmp/kit-merge/CLAUDE.md') === goCommit(ON_CURRENT, 'each'), `${r.out}\n${read(BP, '.tmp/kit-merge/CLAUDE.md')}`);
  r = compare(BP, ['--kit', BK.dir, '--apply']);
  t('branch answer: --apply writes the merge and records the kit commit', r.code === 0 && read(BP, 'CLAUDE.md') === goCommit(ON_CURRENT, 'each') && JSON.parse(read(BP, 'project-os/Kit-version.json')).commit === BK.head, r.out);
  t('branch answer: no word of newer update steps when the kit changed none', !r.out.includes(NEWER_STEPS), r.out);
  const BP2 = projectOn('project branch answer task', BK, { 'CLAUDE.md': goCommit(ON_TASK) });
  r = compare(BP2, ['--kit', BK.dir]);
  t('branch answer: the other option, written on one line, merges cleanly too', calibratedLine(r.out, 'CLAUDE.md').includes('merged cleanly') && read(BP2, '.tmp/kit-merge/CLAUDE.md') === goCommit(ON_TASK, 'each'), `${r.out}\n${read(BP2, '.tmp/kit-merge/CLAUDE.md')}`);
  const OWN_WORDS = '6. Commit with a clear message covering the full scope, on the current\n   branch, and never amend a pushed commit.';
  const BP3 = projectOn('project branch answer own words', BK, { 'CLAUDE.md': goCommit(OWN_WORDS) });
  r = compare(BP3, ['--kit', BK.dir]);
  t('branch answer: other words in its place stay this project\'s own, a clash for the owner', calibratedLine(r.out, 'CLAUDE.md').endsWith('; 1 clash to settle, marked in .tmp/kit-merge/CLAUDE.md') && r.out.includes('this project\'s own wording against the kit\'s change; the owner rules\n      here | 6. Commit with a clear message covering the full scope, on the current\n      here |    branch, and never amend a pushed commit.'), r.out);
  const BK2 = twoCommitKit('branch kit reworded', { 'CLAUDE.md': kitGoCommit(BRACKET) }, { 'CLAUDE.md': kitGoCommit(BRACKET.replace('a clear message', 'one clear message')) });
  const BP4 = projectOn('project branch answer reworded', BK2, { 'CLAUDE.md': goCommit(ON_CURRENT) });
  r = compare(BP4, ['--kit', BK2.dir]);
  t('branch answer: the kit rewording its sentence comes in with the answer filled', calibratedLine(r.out, 'CLAUDE.md').includes('merged cleanly') && read(BP4, '.tmp/kit-merge/CLAUDE.md') === goCommit('6. Commit with one clear message covering the full scope, on the current branch.'), `${r.out}\n${read(BP4, '.tmp/kit-merge/CLAUDE.md')}`);

  // R4, the install's marks. A project with a plan and no code marks the
  // check and the address "(nothing to run before plan step N)"; one with
  // neither writes "none yet". A kit edit beside such a line went to the owner
  // as their own wording.
  const table = (local, checks, mark = '') => `# Demo: rules\n\n| What | Where |\n|---|---|\n| Local app | \`${local}\`${mark} |\n${checks}\n\nThe app runs at ${local}${mark}.\n`;
  const kitTable = (between = '', local = '| Local app | `{{DEV_URL}}` |') => `# {{PROJECT_NAME}}: rules\n\n| What | Where |\n|---|---|\n${local}\n${between}| Checks | \`{{CHECK_COMMAND}}\` |\n\nThe app runs at {{DEV_URL}}.\n`;
  const DOCS_ROW = '| Docs | `project-os/` |\n';
  const TK2 = twoCommitKit('marks kit', { 'CLAUDE.md': kitTable() }, { 'CLAUDE.md': kitTable(DOCS_ROW) });
  const PLANNED = table('http://localhost:4321', '| Checks | `npm run check` (nothing to run before step 2) |', ' (nothing to run before plan step 1)');
  const MKP = projectOn('project marks', TK2, { 'CLAUDE.md': PLANNED });
  r = compare(MKP, ['--kit', TK2.dir]);
  t('marks: the values are read past the marks', r.out.includes('{{CHECK_COMMAND}} "npm run check", {{DEV_URL}} "http://localhost:4321", {{PROJECT_NAME}} "Demo".') && !r.out.includes('more than one way'), r.out);
  t('marks: a kit edit between two marked lines merges cleanly, both marks kept', calibratedLine(r.out, 'CLAUDE.md').includes('merged cleanly') && read(MKP, '.tmp/kit-merge/CLAUDE.md') === PLANNED.replace('| Checks |', `${DOCS_ROW}| Checks |`), `${r.out}\n${read(MKP, '.tmp/kit-merge/CLAUDE.md')}`);
  const NONE_YET = table('none yet', '| Checks | `npm run check` (none yet) |');
  const NYP = projectOn('project none yet', TK2, { 'CLAUDE.md': NONE_YET });
  r = compare(NYP, ['--kit', TK2.dir]);
  t('marks: "none yet" in place of a value, or after one, merges cleanly beside a kit edit', calibratedLine(r.out, 'CLAUDE.md').includes('merged cleanly') && read(NYP, '.tmp/kit-merge/CLAUDE.md') === NONE_YET.replace('| Checks |', `${DOCS_ROW}| Checks |`), `${r.out}\n${read(NYP, '.tmp/kit-merge/CLAUDE.md')}`);
  // The kit changes the marked line itself: its new line would land without
  // the mark, so it clashes, and the clash is the install's, not the owner's.
  const TK3 = twoCommitKit('marks kit line changed', { 'CLAUDE.md': kitTable() }, { 'CLAUDE.md': kitTable('', '| Local app | `{{DEV_URL}}`, in a browser |') });
  const MKP2 = projectOn('project marks line changed', TK3, { 'CLAUDE.md': PLANNED });
  r = compare(MKP2, ['--kit', TK3.dir]);
  t('marks: a kit change to the marked line is a clash labelled as the install\'s mark, never as the owner\'s wording', calibratedLine(r.out, 'CLAUDE.md').endsWith('; 1 clash to settle, marked in .tmp/kit-merge/CLAUDE.md') && r.out.includes('a mark the install wrote after a value, on a line the kit changed; take the kit\'s line and write the mark again, nothing here is the owner\'s own wording\n      here | | Local app | `http://localhost:4321` (nothing to run before plan step 1) |\n      kit  | | Local app | `http://localhost:4321`, in a browser |') && !r.out.includes('the owner rules'), r.out);

  // R3: a session runs Go update kit as the CLAUDE.md it read at the start
  // writes it. When --apply writes a CLAUDE.md whose update steps changed, the
  // run's last line says to finish with the merged ones.
  const steps = (six, backup = 'Run the backup.') => `# {{PROJECT_NAME}}: rules\n\n### \`Go update kit\`\n\n5. Settle what is left by hand.\n6. ${six}\n7. Log it.\n8. Delete the fetch.\n\n### \`Go backup\`\n\n1. ${backup}\n`;
  const UK = twoCommitKit('update steps kit', { 'CLAUDE.md': steps('Run the checks.') }, { 'CLAUDE.md': steps('Run the checks, then hand the guards to the project.') });
  const UP = projectOn('project update steps', UK, { 'CLAUDE.md': steps('Run the checks.').replace('{{PROJECT_NAME}}', 'Demo') });
  r = compare(UP, ['--kit', UK.dir]);
  t('newer update steps: a report only says nothing of them', !r.out.includes(NEWER_STEPS), r.out);
  r = compare(UP, ['--kit', UK.dir, '--apply']);
  t('newer update steps: --apply writes the merge and ends on the line to finish with them', r.code === 0 && read(UP, 'CLAUDE.md').includes('6. Run the checks, then hand the guards to the project.') && lastLine(r.out) === NEWER_STEPS, r.out);
  const UK2 = twoCommitKit('backup steps kit', { 'CLAUDE.md': steps('Run the checks.') }, { 'CLAUDE.md': steps('Run the checks.', 'Run the backup script.') });
  const UP2 = projectOn('project backup steps', UK2, { 'CLAUDE.md': steps('Run the checks.').replace('{{PROJECT_NAME}}', 'Demo') });
  r = compare(UP2, ['--kit', UK2.dir, '--apply']);
  t('newer update steps: a kit change outside them writes no such line', r.code === 0 && read(UP2, 'CLAUDE.md').includes('1. Run the backup script.') && !r.out.includes(NEWER_STEPS), r.out);
  // When CLAUDE.md is left to carry over by hand, no merge is written, and the
  // run still has to end on the newer steps (round two check, 2026-10-02).
  const HAND_STEPS = 'The kit\'s CLAUDE.md carries newer Go update kit steps than the ones this update started from: once CLAUDE.md is carried over by hand, finish this update with steps 5 to 8 as the carried-over CLAUDE.md writes them.';
  const UP3 = projectOn('project update steps clash', UK, { 'CLAUDE.md': steps('Run the checks, twice.').replace('{{PROJECT_NAME}}', 'Demo') });
  r = compare(UP3, ['--kit', UK.dir, '--apply']);
  t('newer update steps: with CLAUDE.md left to carry over by hand, --apply still ends on the line to finish with them', r.code === 0 && read(UP3, 'CLAUDE.md').includes('6. Run the checks, twice.') && lastLine(r.out) === HAND_STEPS && !r.out.includes(NEWER_STEPS), r.out);
  const UP4 = projectOn('project backup steps clash', UK2, { 'CLAUDE.md': steps('Run the checks.', 'Run it now.').replace('{{PROJECT_NAME}}', 'Demo') });
  r = compare(UP4, ['--kit', UK2.dir, '--apply']);
  t('newer update steps: a hand carry-over outside them writes no such line', r.code === 0 && !r.out.includes(HAND_STEPS), r.out);

  // ---- finding the base no file records (2026-10-02) -------------------------------------
  // A project copied in by hand, or from a ZIP, records no base, and every file
  // both sides hold that differs used to be "cannot tell who changed it", for
  // good. Its scripts and guards still name the kit commit it came from.
  const handCopy = (name) => {
    const dir = installedProject(name);
    write(dir, {
      'project-os/Install-project-hooks.mjs': '// install hooks v1\n', // as the kit had it
      'project-os/Archive-old-rows.mjs': null, // the base never had it
      'project-os/guards/Path-guard.mjs': '// path guard v1\r\n', // CRLF from checkout
    });
    return dir;
  };
  const H = handCopy('project hand copy');
  r = compare(H, ['--kit', K]);
  t('found: the base is found in the kit\'s history and said so', r.code === 0 && r.out.includes(`Base: ${BASE} (found in the kit's history, not recorded yet)`), r.out);
  t('found: the note names the commit and how it matched, line endings aside', r.out.includes(`no project-os/Kit-version.json here, so the base was looked for in the kit's history: ${BASE} is the one commit that holds the scripts and guards here (5) as they are, line endings aside.`), r.out);
  t('found: the compare runs from it, so a file the kit changed is "kit updated", never "cannot tell"', statusOf(r.out, 'project-os/Find-heavy-files.mjs') === 'kit updated' && statusOf(r.out, 'project-os/Install-project-hooks.mjs') === 'kit updated' && !r.out.includes('cannot tell who changed it  '), r.out);
  t('found: calibrated files are merged from it', calibratedLine(r.out, 'CLAUDE.md').includes('merged cleanly'), r.out);
  t('found: the report says --apply records it while files are left', r.out.includes(`Until then it records the base this compare found, ${BASE}, so the next compare starts from it.`), r.out);
  t('found: a report writes no version', read(H, 'project-os/Kit-version.json') === null);
  r = compare(H, ['--kit', K, '--apply']);
  try { version = JSON.parse(read(H, 'project-os/Kit-version.json')); } catch { version = null; }
  t('found, --apply with files left: records the found base, not the kit\'s HEAD', r.code === 0 && version && version.commit === BASE && version.date === TODAY && Object.keys(version).length === 2, `${r.out}\n${read(H, 'project-os/Kit-version.json')}`);
  t('found, --apply with files left: says so, and still names the files left', r.out.includes(`Wrote project-os/Kit-version.json: commit ${BASE}, ${TODAY}, the base this compare found, so the next compare starts from it.`) && r.out.includes('project-os/Kit-version.json names the base this compare found, not the kit\'s HEAD: 3 files are still left') && r.out.includes('--record'), r.out);
  t('found, --apply: the safe files are copied as from any base', read(H, 'project-os/Find-heavy-files.mjs') === '// heavy v2\n' && read(H, 'project-os/Install-project-hooks.mjs') === '// install hooks v2\n', r.out);
  r = compare(H, ['--kit', K]);
  t('found, after --apply: the next compare reads the base from the file, though its scripts now mix two kits', r.out.includes(`Base: ${BASE} (from project-os/Kit-version.json)`) && statusOf(r.out, 'project-os/Find-heavy-files.mjs') === 'current' && !r.out.includes('looked for in the kit\'s history'), r.out);

  // --record before any --apply: the files came from the base, so the base is
  // what gets recorded. The clone's HEAD would hide every kit change since.
  const H2 = handCopy('project hand copy record');
  const h2Before = JSON.parse(snapshot(H2));
  r = compare(H2, ['--kit', K, '--record']);
  try { version = JSON.parse(read(H2, 'project-os/Kit-version.json')); } catch { version = null; }
  t('found, --record: records the commit the files came from, not the clone\'s HEAD', r.code === 0 && version && version.commit === BASE && version.date === TODAY && Object.keys(version).length === 2, r.out);
  t('found, --record: says why, and what the next compare shows', r.out.includes(`No base is recorded here, and this project's files came from an older kit than the clone's HEAD, ${HEAD}: ${BASE} is the one commit`) && r.out.includes(`Wrote project-os/Kit-version.json: commit ${BASE}, ${TODAY}.`) && r.out.includes(`Run the compare again: it now measures from ${BASE} and shows every kit change since.`), r.out);
  const h2After = JSON.parse(snapshot(H2));
  t('found, --record: writes nothing but Kit-version.json', Object.keys({ ...h2Before, ...h2After }).every((f) => f === 'project-os/Kit-version.json' || h2Before[f] === h2After[f]));
  r = compare(H2, ['--kit', K]);
  t('found, --record: the next compare measures from it', r.out.includes(`Base: ${BASE} (from project-os/Kit-version.json)`) && statusOf(r.out, 'project-os/Find-heavy-files.mjs') === 'kit updated', r.out);

  // A --depth 1 clone holds only its newest commit: an older base cannot be found.
  r = compare(handCopy('project hand copy shallow'), ['--kit', SHALLOW]);
  t('found, shallow clone: the older base is not found, and the fix is named', r.code === 0 && r.out.includes('Base: unknown') && r.out.includes('the clone was made with --depth, so it holds only its newest commits') && r.out.includes('The kit clone needs its full history'), r.out);
  const NONE = path.join(TMP, 'project no scripts');
  write(NONE, { 'CLAUDE.md': 'rules\n', 'project-os/QA.md': 'qa\n' });
  r = compare(NONE, ['--kit', K]);
  t('found: a project without the kit\'s scripts and guards has nothing to look for, and says so', r.code === 0 && r.out.includes('this project has none of the kit\'s scripts and guards to look for in its history') && r.out.includes('Base: unknown'), r.out);

  // Several commits can hold the same scripts while the kit's docs moved on.
  const TK = path.join(TMP, 'tie kit');
  fs.mkdirSync(TK, { recursive: true });
  git(TK, ['-c', 'init.defaultBranch=main', 'init', '-q']);
  const tieCommit = (files, msg) => {
    write(TK, files);
    git(TK, ['add', '-A']);
    git(TK, ['commit', '-q', '--no-verify', '-m', msg]);
    return git(TK, ['rev-parse', '--short', 'HEAD']);
  };
  const TIE1 = { 'Installation.md': 'law\n', 'project-os/guards/Path-guard.mjs': '// guard one\n', 'CLAUDE.md': 'rules one\n', 'project-os/Workflow.md': 'flow\n' };
  const c1 = tieCommit(TIE1, 'c1');
  const c2 = tieCommit({ 'CLAUDE.md': 'rules one\nrules two\n' }, 'c2'); // the same guard, a newer CLAUDE.md
  const c3 = tieCommit({ 'README.md': 'kit readme\n' }, 'c3'); // nothing an install carries
  const c4 = tieCommit({ 'project-os/guards/Path-guard.mjs': '// guard two\n' }, 'c4');
  const tieProject = (name, files) => {
    const dir = path.join(TMP, name);
    write(dir, files);
    return dir;
  };
  r = compare(tieProject('project tie one', TIE1), ['--kit', TK]);
  t('found, several match: the one whose other files are closest is taken, not the newest', r.out.includes(`Base: ${c1} (found`) && r.out.includes(`3 commits hold the scripts and guards here (1) as they are, line endings aside, and ${c1} is the one whose other files are closest to this project's`), r.out);
  t('found, several match: the kit\'s later change to a calibrated file is shown, not hidden', calibratedLine(r.out, 'CLAUDE.md').includes('the kit changed 1 line (+1 -0)') && calibratedLine(r.out, 'CLAUDE.md').includes('merged cleanly'), r.out);
  r = compare(tieProject('project tie two', { ...TIE1, 'CLAUDE.md': 'rules one\nrules two\n' }), ['--kit', TK]);
  t('found, equally close: the newest of them is taken', r.out.includes(`Base: ${c3} (found`) && !r.out.includes(`Base: ${c2}`) && calibratedLine(r.out, 'CLAUDE.md').endsWith('unchanged in the kit'), r.out);
  r = compare(tieProject('project tie four', { ...TIE1, 'CLAUDE.md': 'rules one\nrules two\n', 'project-os/guards/Path-guard.mjs': '// guard two\n' }), ['--kit', TK]);
  t('found, one match: the kit\'s HEAD itself', r.out.includes(`Base: ${c4} (found`) && r.out.includes(`${c4} is the one commit that holds`) && statusOf(r.out, 'project-os/guards/Path-guard.mjs') === 'current', r.out);

  // ---- the install records its kit at once (2026-10-02) ----------------------------------------
  // Installation.md step 0 fetches the kit with --depth 1 and copies it in,
  // then records the commit right there with the fetch's own copy of this
  // script, instead of carrying it in memory to step 7.
  const FK = path.join(TMP, 'fresh kit');
  fs.mkdirSync(FK, { recursive: true });
  git(FK, ['-c', 'init.defaultBranch=main', 'init', '-q']);
  write(FK, {
    'README.md': 'kit readme\n',
    'Installation.md': 'install law\n',
    'CLAUDE.md': '# {{PROJECT_NAME}}: rules\n',
    'project-os/Workflow.md': 'workflow for {{PROJECT_NAME}}\n',
    'project-os/History.md': '# {{PROJECT_NAME}}: History\n',
    'project-os/guards/Path-guard.mjs': '// path guard\n',
    'project-os/Compare-kit-files.mjs': fs.readFileSync(SCRIPT),
  });
  git(FK, ['add', '-A']);
  git(FK, ['commit', '-q', '--no-verify', '-m', 'f1']);
  write(FK, { 'CLAUDE.md': '# {{PROJECT_NAME}}: rules\n\nA newer rule.\n' });
  git(FK, ['add', '-A']);
  git(FK, ['commit', '-q', '--no-verify', '-m', 'f2']);
  const FHEAD = git(FK, ['rev-parse', '--short', 'HEAD']);
  const freshInstall = (name, own, depth = ['--depth', '1']) => {
    const dir = path.join(TMP, name);
    write(dir, { 'src/app.js': '// the project\'s own code\n', ...own });
    git(dir, ['-c', 'init.defaultBranch=main', 'init', '-q']);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '--no-verify', '-m', 'the project']);
    git(dir, ['clone', '-q', ...depth, pathToFileURL(FK).href, '.tmp/projectos-kit']);
    // Step 0.2: CLAUDE.md (as CLAUDE-kit.md beside the project's own), Installation.md, project-os/.
    const fetch = path.join(dir, '.tmp', 'projectos-kit');
    fs.cpSync(path.join(fetch, 'project-os'), path.join(dir, 'project-os'), { recursive: true });
    fs.copyFileSync(path.join(fetch, 'Installation.md'), path.join(dir, 'Installation.md'));
    fs.copyFileSync(path.join(fetch, 'CLAUDE.md'), path.join(dir, own['CLAUDE.md'] ? 'CLAUDE-kit.md' : 'CLAUDE.md'));
    return dir;
  };
  // The exact command the install runs, from the project root.
  const installRecord = (dir) => {
    const res = spawnSync(process.execPath, ['.tmp/projectos-kit/project-os/Compare-kit-files.mjs', '--kit', '.tmp/projectos-kit', '--record'], { cwd: dir, env: ENV, encoding: 'utf8' });
    return { code: res.status, out: `${res.stdout || ''}${res.stderr || ''}` };
  };
  const F1 = freshInstall('project fresh install', {});
  const f1Before = JSON.parse(snapshot(F1));
  r = installRecord(F1);
  try { version = JSON.parse(read(F1, 'project-os/Kit-version.json')); } catch { version = null; }
  t('install record: exits 0 against the --depth 1 fetch, every file the same', r.code === 0 && r.out.includes('Every machinery file matches the kit.') && r.out.includes('Every calibrated file matches the kit.'), r.out);
  t('install record: Kit-version.json names the fetch\'s commit and today, and nothing else', version && version.commit === FHEAD && version.date === TODAY && Object.keys(version).length === 2, read(F1, 'project-os/Kit-version.json'));
  t('install record: says what it wrote, with no note and nothing about an older kit', r.out.includes(`Wrote project-os/Kit-version.json: commit ${FHEAD}, ${TODAY}.`) && !r.out.includes('older kit') && !r.out.includes('Note:'), r.out);
  const f1After = JSON.parse(snapshot(F1));
  t('install record: writes nothing but Kit-version.json', Object.keys({ ...f1Before, ...f1After }).every((f) => f === 'project-os/Kit-version.json' || f1Before[f] === f1After[f]));
  r = compare(F1, ['--kit', '.tmp/projectos-kit']);
  t('install record: a compare right after reads the base from the file, everything current', r.code === 0 && r.out.includes(`Base: ${FHEAD} (from project-os/Kit-version.json)`) && statusOf(r.out, 'project-os/guards/Path-guard.mjs') === 'current' && calibratedLine(r.out, 'CLAUDE.md').endsWith('unchanged in the kit'), r.out);
  const F2 = freshInstall('project fresh install own rules', { 'CLAUDE.md': '# Our own rules\n' });
  r = installRecord(F2);
  try { version = JSON.parse(read(F2, 'project-os/Kit-version.json')); } catch { version = null; }
  t('install record, the project\'s own CLAUDE.md beside CLAUDE-kit.md: still records the fetch\'s commit', r.code === 0 && version && version.commit === FHEAD && statusOf(r.out, 'CLAUDE.md') === 'differs', r.out);
  const F3 = freshInstall('project fresh install full clone', {}, []);
  r = installRecord(F3);
  try { version = JSON.parse(read(F3, 'project-os/Kit-version.json')); } catch { version = null; }
  t('install record from a full clone: the same commit, though an older one holds the same scripts', r.code === 0 && version && version.commit === FHEAD && !r.out.includes('older kit'), r.out);

  // ---- usage errors -------------------------------------------------------------------------------
  r = compare(P, []);
  t('usage: no --kit exits 1', r.code === 1 && r.out.includes('--kit is required'), r.out);
  r = compare(P, ['--kit', path.join(TMP, 'no such kit')]);
  t('usage: a missing kit folder exits 1', r.code === 1 && r.out.includes('does not exist'), r.out);
  r = compare(P, ['--kit', K, '--force']);
  t('usage: an unknown argument exits 1', r.code === 1 && r.out.includes('unknown argument "--force"'), r.out);
  r = compare(P, ['--kit']);
  t('usage: --kit with no value exits 1', r.code === 1, r.out);
  r = compare(P, ['--kit', K, '--base=-x']);
  t('usage: a base that looks like a flag exits 1', r.code === 1, r.out);
  const NOT_KIT = path.join(TMP, 'not a kit');
  write(NOT_KIT, { 'notes.txt': 'x\n' });
  r = compare(P, ['--kit', NOT_KIT]);
  t('usage: a folder that is not a kit exits 1', r.code === 1 && r.out.includes('is not a ProjectOS kit'), r.out);
  const NO_OS = path.join(TMP, 'no project-os');
  write(NO_OS, { 'CLAUDE.md': '# x\n' });
  r = compare(NO_OS, ['--kit', K]);
  t('usage: run outside an installed project exits 1', r.code === 1 && r.out.includes('has no project-os/ folder'), r.out);
  r = compare(N, ['--kit', '.']);
  t('usage: the project as its own kit exits 1', r.code === 1 && r.out.includes('is this project itself'), r.out);
  r = compare(P, [`--kit=${K}`]);
  t('--kit=<folder> works too', r.code === 0, r.out);
  const beforeUsage = snapshot(P);
  r = compare(P, ['--kit', K, '--apply', '--record']);
  t('usage: --apply and --record together exit 1, as two steps', r.code === 1 && r.out.includes('--apply and --record are separate steps'), r.out);
  r = compare(P, ['--kit', K, '--record', '--base', BASE]);
  t('usage: --record with --base exits 1', r.code === 1 && r.out.includes('--record takes no --base'), r.out);
  t('usage: the usage text names --record', r.out.includes('--kit <folder of a fresh kit clone> --record'), r.out);
  t('usage: a refused --record or --apply writes nothing', snapshot(P) === beforeUsage);
} finally {
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

if (failures > 0) {
  console.error(`Compare-kit-tests.mjs: ${failures} of ${ran} cases FAILED`);
  process.exit(1);
}
console.log(`Compare-kit-tests.mjs: all ${ran} cases passed`);
