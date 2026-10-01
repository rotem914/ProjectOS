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
// over by hand, and writes no version while a conflict or an unknown is left,
// which --record then writes once they are carried over (2026-10-01). Projects
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
  'project-os/Hooks.md': 'hooks v1\n',
  'project-os/Hooks-settings.json': '{}\n',
  'project-os/Find-heavy-files.mjs': '// heavy v1\n',
  'project-os/Install-project-hooks.mjs': '// install hooks v1\n',
  'project-os/guards/Path-guard.mjs': '// path guard v1\n',
  'project-os/guards/Destructive-guard.mjs': '// destructive guard v1\nsecond line\n',
  'project-os/Archive-old-rows.ps1': '# archive v1\n',
  'project-os/mcp/Figma/Figma_MCP_Rules.md': 'figma v1\n',
};
// What the kit changed since.
const claudeV2 = lines('claude', 12).split('\n');
claudeV2[2] = 'claude line 3, reworded by the kit';
claudeV2.splice(8, 0, 'a line the kit added after line 8');
const V2_CHANGES = {
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
  'project-os/History.md': '# {{PROJECT_NAME}}, History\n\nA newer template.\n', // record
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
  t('report: writes nothing at all', snapshot(P) === before);
  t('report: says it wrote nothing, and what --apply would copy', r.out.includes('Report only: nothing was written. --apply copies the 3 safe files'), r.out);
  t('report: with conflicts left, --apply is not promised to record the kit commit', r.out.includes('--apply copies the 3 safe files.') && !r.out.includes('and records the kit commit'), r.out);
  t('report: says the version waits for the conflicts and --record', r.out.includes('--apply writes no project-os/Kit-version.json while 2 files are left') && r.out.includes('with --record'), r.out);

  const expect = {
    'project-os/guards/Path-guard.mjs': 'current',
    'project-os/guards/Destructive-guard.mjs': 'current',
    'project-os/Archive-old-rows.mjs': 'current',
    'project-os/Find-heavy-files.mjs': 'kit updated',
    'project-os/Audit-project-records.mjs': 'new in the kit',
    'project-os/Compare-kit-files.mjs': 'new in the kit',
    'project-os/Hooks.md': 'changed here only',
    'Installation.md': 'changed here only',
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
  t('records: a living record is never listed as machinery', statusOf(r.out, 'project-os/History.md') === null && r.out.includes('Living records: never touched (2 here).'), r.out);
  t('unlisted: a kit file no list names is reported', /not in this script's list[^\n]*\n {2}project-os\/Unlisted-tool\.mjs/.test(r.out), r.out);
  t('unlisted: the kit-only README is not reported', !r.out.includes('README.md'), r.out);
  t('note: a newer Compare-kit-files.mjs in the kit is pointed at', r.out.includes('the kit carries a different Compare-kit-files.mjs'), r.out);

  t('calibrated: CLAUDE.md shows the kit\'s lines and places', calibratedLine(r.out, 'CLAUDE.md').includes('the kit changed 3 lines (+2 -1) in 2 places: line 3, line 9'), calibratedLine(r.out, 'CLAUDE.md'));
  t('calibrated: the full-diff command is given', r.out.includes(`full diff: git -C "${K}" diff ${BASE} -- CLAUDE.md`), r.out);
  t('calibrated: QA.md changed in the kit is reported', calibratedLine(r.out, 'project-os/QA.md').includes('the kit changed 2 lines (+1 -1) in 1 place: line 1'), calibratedLine(r.out, 'project-os/QA.md'));
  t('calibrated: a file the kit did not touch says so', calibratedLine(r.out, 'project-os/Workflow.md').endsWith('unchanged in the kit'), r.out);
  t('calibrated: a tool file removed at install says so', calibratedLine(r.out, 'project-os/mcp/Figma/Figma_MCP_Rules.md').includes('unchanged in the kit; not here'), r.out);
  t('calibrated: a calibrated file new in the kit is to be brought over by hand', calibratedLine(r.out, 'project-os/Backup-whole-project.mjs').includes('new in the kit, not here yet'), r.out);
  t('calibrated: never listed as machinery', statusOf(r.out, 'CLAUDE.md') === null, r.out);

  // ---- --apply --------------------------------------------------------------------------
  r = compare(P, ['--kit', K, '--apply']);
  t('apply: exits 0', r.code === 0, r.out);
  t('apply: a kit-updated file is copied', read(P, 'project-os/Find-heavy-files.mjs') === '// heavy v2\n');
  t('apply: files new in the kit are copied', read(P, 'project-os/Audit-project-records.mjs') === '// audit v2\n' && read(P, 'project-os/Compare-kit-files.mjs') === '// a newer compare\n');
  t('apply: a conflict is left as the project had it', read(P, 'project-os/Install-project-hooks.mjs') === '// install hooks, edited here\n' && read(P, 'project-os/Rule-reasons.md') === 'our own reasons\n');
  t('apply: a file changed here only is left alone', read(P, 'project-os/Hooks.md') === 'hooks v1, edited here\n');
  t('apply: a file removed here is not brought back', read(P, 'Installation.md') === null);
  t('apply: a file gone from the kit is not deleted', read(P, 'project-os/Archive-old-rows.ps1') === '# archive v1\n');
  t('apply: the CRLF copy that was current is not rewritten', read(P, 'project-os/guards/Destructive-guard.mjs') === HERE_CHANGES['project-os/guards/Destructive-guard.mjs']);
  t('apply: calibrated files are never copied', read(P, 'CLAUDE.md') === HERE_CHANGES['CLAUDE.md'] && read(P, 'project-os/QA.md') === 'qa v1, for Demo\n' && read(P, 'project-os/Backup-whole-project.mjs') === null);
  t('apply: a living record is never touched', read(P, 'project-os/History.md') === HERE_CHANGES['project-os/History.md']);
  t('apply: an unlisted kit file is not copied', read(P, 'project-os/Unlisted-tool.mjs') === null);
  t('apply: a tool folder removed at install stays removed', read(P, 'project-os/mcp/Figma/Figma_MCP_Rules.md') === null);
  // 2026-10-01: two files are left changed on both sides, so no version is
  // written. Recording the kit HEAD now would make the next compare read both
  // as changed here only, and the kit's changes to them would never show again.
  t('apply with conflicts left: Kit-version.json is left exactly as it was', read(P, 'project-os/Kit-version.json') === versionOf(BASE), read(P, 'project-os/Kit-version.json'));
  t('apply: the report lists what it copied', /Copied from the kit: .*Find-heavy-files\.mjs/.test(r.out), r.out);
  t('apply with conflicts left: each one is named with its status', r.out.includes('Kit-version.json was not written: 2 files are still left') && r.out.includes('  project-os/Install-project-hooks.mjs: changed on both sides') && r.out.includes('  project-os/Rule-reasons.md: changed on both sides'), r.out);
  t('apply with conflicts left: a file changed here only is not among them', !r.out.includes('project-os/Hooks.md: '), r.out);
  t('apply with conflicts left: the --record command is given, the kit path quoted', r.out.includes(`then record the kit commit: node project-os/Compare-kit-files.mjs --kit "${K}" --record`), r.out);
  t('apply with conflicts left: the calibrated changes are named to carry over too', r.out.includes('with the kit\'s changes to CLAUDE.md'), r.out);
  t('apply with conflicts left: says why the version waits', r.out.includes('would read them as changed here only'), r.out);
  t('apply with conflicts left: no "Wrote" line', !r.out.includes('Wrote project-os/Kit-version.json'), r.out);
  t('apply: no temporary file is left behind', !Object.keys(JSON.parse(snapshot(P))).some((f) => f.endsWith('.tmp')));

  r = compare(P, ['--kit', K]);
  t('after apply: the base is still the install\'s and the copied file is current', r.out.includes(`Base: ${BASE} (from project-os/Kit-version.json)`) && statusOf(r.out, 'project-os/Find-heavy-files.mjs') === 'current', r.out);
  t('after apply: the conflict still shows as a conflict', statusOf(r.out, 'project-os/Install-project-hooks.mjs') === 'changed on both sides', r.out);

  // ---- --record -------------------------------------------------------------------------
  // The assistant carries the conflicts over by hand, then records the base.
  write(P, { 'project-os/Install-project-hooks.mjs': '// install hooks v2, edited here\n' });
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
  t('record: calibrated files and records are not printed', !r.out.includes('CLAUDE.md') && !r.out.includes('History.md'), r.out);
  t('record: says what the next compare will read them as', r.out.includes(`the kit at ${HEAD} is the base, so the next compare reads those 5 files as changed here only`), r.out);
  const afterRecord = JSON.parse(snapshot(P));
  t('record: writes nothing but Kit-version.json', Object.keys({ ...beforeRecord, ...afterRecord }).every((f) => f === 'project-os/Kit-version.json' || beforeRecord[f] === afterRecord[f]));
  r = compare(P, ['--kit', K]);
  t('after record: the base is the kit HEAD', r.out.includes(`Base: ${HEAD} (from project-os/Kit-version.json)`), r.out);
  t('after record: the merged file reads as changed here only', statusOf(r.out, 'project-os/Install-project-hooks.mjs') === 'changed here only', r.out);

  // ---- --apply with nothing left to carry over by hand -------------------------------
  const CLEAN = installedProject('project clean', { version: versionOf(BASE) });
  write(CLEAN, { 'project-os/Install-project-hooks.mjs': '// install hooks v1\n', 'project-os/Rule-reasons.md': null });
  r = compare(CLEAN, ['--kit', K]);
  t('clean: the report promises the kit commit too', r.out.includes('--apply copies the 5 safe files and records the kit commit.') && !r.out.includes('writes no project-os/Kit-version.json while'), r.out);
  r = compare(CLEAN, ['--kit', K, '--apply']);
  try { version = JSON.parse(read(CLEAN, 'project-os/Kit-version.json')); } catch { version = null; }
  t('clean: --apply copies the safe files', r.code === 0 && read(CLEAN, 'project-os/Install-project-hooks.mjs') === '// install hooks v2\n' && read(CLEAN, 'project-os/Rule-reasons.md') === 'reasons from the kit\n', r.out);
  t('clean: --apply writes Kit-version.json with the kit HEAD and today', version && version.commit === HEAD && version.date === TODAY && Object.keys(version).length === 2, read(CLEAN, 'project-os/Kit-version.json'));
  t('clean: the calibrated files are named to carry over now, and no --record is asked', /Carry these over now, by hand: .*CLAUDE\.md/.test(r.out) && !r.out.includes('--record'), r.out);
  r = compare(CLEAN, ['--kit', K, '--record']);
  t('clean: --record after a clean apply prints only what still differs, such as a file changed here',r.code === 0 && statusOf(r.out, 'project-os/Install-project-hooks.mjs') === null && statusOf(r.out, 'project-os/Hooks.md') === 'differs', r.out);

  // ---- --record when the project matches the kit ------------------------------------
  const SAME = path.join(TMP, 'project same as kit');
  write(SAME, { ...V1, ...V2_CHANGES });
  r = compare(SAME, ['--kit', K, '--record']);
  t('record, nothing differs: says so and records', r.code === 0 && r.out.includes('Every machinery file matches the kit.') && !r.out.includes('From here on') && JSON.parse(read(SAME, 'project-os/Kit-version.json') || '{}').commit === HEAD, r.out);

  // ---- no base -------------------------------------------------------------------------
  const N = installedProject('project no base');
  write(N, { 'Installation.md': 'install law v1\n' });
  r = compare(N, ['--kit', K]);
  t('no base: exits 0 and says how to name one', r.code === 0 && r.out.includes('Base: unknown') && r.out.includes('pass the kit commit named in the install row of project-os/History.md with --base <commit>'), r.out);
  t('no base: says the kit clone needs its full history', r.out.includes('The kit clone needs its full history'), r.out);
  t('no base: a file that differs is "cannot tell who changed it"', statusOf(r.out, 'project-os/Find-heavy-files.mjs') === 'cannot tell who changed it', r.out);
  // 2026-10-01: nothing of the project's is overwritten by a file it does not have.
  t('no base: a file only in the kit is "new in the kit", safe to copy', statusOf(r.out, 'project-os/Audit-project-records.mjs') === 'new in the kit' && r.out.includes('project-os/Audit-project-records.mjs  (safe to copy)'), r.out);
  t('no base: an identical file is still current', statusOf(r.out, 'project-os/guards/Path-guard.mjs') === 'current', r.out);
  t('no base: calibrated files say the kit\'s changes cannot be told', calibratedLine(r.out, 'CLAUDE.md').includes('no base'), r.out);
  r = compare(N, ['--kit', K, '--apply']);
  t('no base: --apply copies the files new in the kit', r.code === 0 && read(N, 'project-os/Audit-project-records.mjs') === '// audit v2\n' && read(N, 'project-os/Compare-kit-files.mjs') === '// a newer compare\n', r.out);
  t('no base: --apply never copies a file it cannot tell about', read(N, 'project-os/Find-heavy-files.mjs') === '// heavy v1\n' && read(N, 'project-os/Install-project-hooks.mjs') === '// install hooks, edited here\n', r.out);
  t('no base: --apply writes no version and names what to carry over first', read(N, 'project-os/Kit-version.json') === null && r.out.includes('  project-os/Find-heavy-files.mjs: cannot tell who changed it') && r.out.includes('--record'), r.out);

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
