// Fixture tests for the kit's snapshot script, project-os/Backup-whole-project.ps1.
//
// Run from the kit root:   node tests/Backup-script-tests.mjs
// It prints one line per failing check and a count at the end, and exits 1 when
// any check fails. The script is PowerShell, so the suite needs Windows
// PowerShell or PowerShell 7 (pwsh). Without either it says so plainly and
// exits 0: the script cannot run on that machine at all, so there is nothing to
// test there.
//
// This folder sits outside project-os/ on purpose: an install copies all of
// project-os/ into a client project, and these tests belong to the kit only.
//
// Each case builds a fake project in a folder whose name has a space, copies the
// script into its project-os/, runs it for real and opens the ZIP it made with
// a reader written here, independent of the .NET code that wrote it. The fake
// projects live in the OS temp folder, or under PROJECTOS_TEST_TMP when that is
// set (a project whose rules keep every write inside it points this at its own
// scratch folder). Nothing else is touched. The folder is removed at the end, or
// kept and named when a check failed, so the failure can be looked at.
//
// What it pins: the right files go in and the right ones stay out, a folder
// named like a scratch or backup folder deeper down still travels, every folder
// left out by name is reported, a git worktree is refused, and a ZIP name held
// open by another program ends in a loud failure instead of a false OK
// (Windows only: other systems do not lock files that way).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../project-os/Backup-whole-project.ps1', import.meta.url));

function findPowerShell() {
  for (const exe of ['powershell', 'pwsh']) {
    const r = spawnSync(exe, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' });
    if (!r.error && r.status === 0) return exe;
  }
  return null;
}
const PS = findPowerShell();
if (!PS) {
  console.log('Backup-script-tests.mjs: SKIPPED. Neither powershell nor pwsh was found, so Backup-whole-project.ps1 cannot run on this machine and nothing was tested.');
  process.exit(0);
}

const BASE = fs.mkdtempSync(path.join(process.env.PROJECTOS_TEST_TMP || os.tmpdir(), 'projectos-backup-tests-'));
let checks = 0;
let failures = 0;
function check(label, ok, detail = '') {
  checks++;
  if (!ok) {
    failures++;
    console.error(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
  }
}

const REPO = 'fake_proj'; // the leaf "fake proj", spaces to underscores
function project(name, files, editScript = (s) => s) {
  const root = path.join(BASE, name, 'fake proj');
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  fs.mkdirSync(path.join(root, 'project-os'), { recursive: true });
  fs.writeFileSync(path.join(root, 'project-os', 'Backup-whole-project.ps1'), editScript(fs.readFileSync(SCRIPT, 'utf8')));
  return root;
}
function run(root) {
  const r = spawnSync(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(root, 'project-os', 'Backup-whole-project.ps1')], { encoding: 'utf8', cwd: root });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
const backupsOf = (root) => path.join(root, 'backups');
const listBackups = (root) => (fs.existsSync(backupsOf(root)) ? fs.readdirSync(backupsOf(root)) : []);
const okPath = (stdout) => (/^OK: (.+?)\r?$/m.exec(stdout) || [])[1] || null;
function stamp(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}-${p(date.getMinutes())}`;
}
// The ZIP names this minute and the next could get: the script stamps to the
// minute, and a run can cross a minute boundary.
function nearStamps() {
  const now = new Date();
  return [...new Set([stamp(now), stamp(new Date(now.getTime() + 60000))])].map((s) => `${REPO}_${s}.zip`);
}

// A small ZIP reader: the central directory for the names, the local header
// and raw deflate for one entry's bytes. Enough for what the script writes.
function readZip(file) {
  const buf = fs.readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error(`${file} is not a ZIP (no end record)`);
  const entries = new Map();
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = buf.readUInt16LE(eocd + 10); n > 0; n--) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`${file}: bad central directory`);
    const nameLen = buf.readUInt16LE(p + 28);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, { method: buf.readUInt16LE(p + 10), size: buf.readUInt32LE(p + 20), local: buf.readUInt32LE(p + 42) });
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  function content(name) {
    const e = entries.get(name);
    if (!e) return null;
    const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
    const data = buf.subarray(start, start + e.size);
    return (e.method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data)).toString('utf8');
  }
  return { names: [...entries.keys()].sort(), content };
}

function caseWhatGoesIn() {
  const label = 'contents';
  const root = project('contents', {
    'README.md': 'readme\n',
    'src/a.txt': 'alpha content\n',
    'src/build/icon.png': 'png',                    // a listed name deeper down: left out, and reported
    'src/.tmp/keep.txt': 'nested .tmp travels',     // only the root scratch folder is left out
    'src/features/backups/b.txt': 'nested backups travels',
    'node_modules/pkg/index.js': 'dependency',
    '.tmp/scratch.txt': 'root scratch',
    '.claude/settings.local.json': '{}',
    'src/.claude/notes.md': 'machine-local at any depth',
    '.env': 'SECRET=1', '.env.local': 'SECRET=2', '.env.example': 'SECRET=',
    '.dev.vars': 'KEY=1', '.dev.vars.example': 'KEY=',
    'x.tmp': 'atomic-write leftover', 'y.tmp.1': 'atomic-write leftover',
    '.git/HEAD': 'ref: refs/heads/main\n',
  });
  const r = run(root);
  check(`${label}: exits 0`, r.status === 0, r.stderr);
  const zip = okPath(r.stdout);
  check(`${label}: prints the ZIP it made`, !!zip && fs.existsSync(zip), r.stdout);
  if (!zip || !fs.existsSync(zip)) return;
  check(`${label}: the ZIP lands in backups/`, path.dirname(zip) === backupsOf(root), zip);
  check(`${label}: no .partial is left behind`, !listBackups(root).some((f) => f.endsWith('.partial')), listBackups(root).join(', '));
  const z = readZip(zip);
  const expected = ['.dev.vars.example', '.env.example', '.git/HEAD', 'README.md', 'project-os/Backup-whole-project.ps1',
    'src/.tmp/keep.txt', 'src/a.txt', 'src/features/backups/b.txt'].sort();
  check(`${label}: exactly the right files are in the ZIP`, z.names.join('|') === expected.join('|'),
    `got ${z.names.join(', ')}`);
  check(`${label}: a file's bytes come back out`, z.content('src/a.txt') === 'alpha content\n');
  const left = ((/^Left out by name: (.+?)\r?$/m.exec(r.stdout) || [])[1] || '').split(', ');
  for (const dir of ['.claude', '.tmp', 'backups', 'node_modules', 'src/.claude', 'src/build']) {
    check(`${label}: "${dir}" is reported as left out by name`, left.includes(dir), `Left out: ${left.join(', ')}`);
  }
  for (const dir of ['src/.tmp', 'src/features/backups']) {
    check(`${label}: "${dir}" is not reported as left out`, !left.includes(dir), `Left out: ${left.join(', ')}`);
  }
}

function caseWorktree() {
  const label = 'worktree';
  const root = project('worktree', {
    'src/a.txt': 'a\n',
    '.git': 'gitdir: C:/elsewhere/main/.git/worktrees/wt\n',
  });
  const r = run(root);
  check(`${label}: a .git file is refused with exit 1`, r.status === 1, r.stdout);
  check(`${label}: the refusal names where the history lives`, /BACKUP FAILED/.test(r.stderr) && r.stderr.includes('history lives in: C:/elsewhere/main/.git/worktrees/wt'), r.stderr);
  check(`${label}: no ZIP is made`, !listBackups(root).some((f) => /\.zip/.test(f)), listBackups(root).join(', '));

  // A working-tree-only ZIP, chosen in the setup block, is not refused.
  let edited = false;
  const root2 = project('worktree-no-history', { 'src/a.txt': 'a\n', '.git': 'gitdir: C:/elsewhere/main/.git/worktrees/wt\n' },
    (s) => s.replace(/\$ExcludeDirs = @\(\r?\n/, (m) => { edited = true; return `${m}    '.git'\n`; }));
  check(`${label}: the setup block was found to add .git to`, edited);
  const r2 = run(root2);
  check(`${label}: with .git left out on purpose, the ZIP is made`, r2.status === 0 && !!okPath(r2.stdout), r2.stderr);
}

function caseSameMinuteReplaced() {
  const label = 'same-minute ZIP';
  const root = project('same-minute', { 'src/a.txt': 'a\n' });
  fs.mkdirSync(backupsOf(root), { recursive: true });
  for (const name of nearStamps()) fs.writeFileSync(path.join(backupsOf(root), name), 'an older ZIP');
  const r = run(root);
  check(`${label}: an earlier ZIP of the same name, not held open, is replaced`, r.status === 0, r.stderr);
  const zip = okPath(r.stdout);
  let names = [];
  try { names = readZip(zip).names; } catch (e) { names = [e.message]; }
  check(`${label}: the ZIP printed is this run's`, names.includes('src/a.txt'), names.join(', '));
}

async function caseRenameBlocked() {
  const label = 'rename blocked';
  if (process.platform !== 'win32') {
    console.log(`  ${label}: skipped (Windows only; other systems do not lock a file against a rename)`);
    return;
  }
  const root = project('rename-blocked', { 'src/a.txt': 'a\n' });
  fs.mkdirSync(backupsOf(root), { recursive: true });
  const held = nearStamps().map((n) => path.join(backupsOf(root), n));
  for (const f of held) fs.writeFileSync(f, 'an older ZIP');
  // Another program holds each possible name open, sharing read only: a rename
  // onto it cannot delete it.
  const quoted = held.map((f) => `'${f.replace(/'/g, "''")}'`).join(', ');
  const locker = spawn(PS, ['-NoProfile', '-Command',
    `$h = @(); foreach ($p in @(${quoted})) { $h += [System.IO.File]::Open($p, 'Open', 'Read', 'Read') }; [Console]::Out.WriteLine('LOCKED'); [Console]::Out.Flush(); Start-Sleep -Seconds 120`],
  { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise((res) => locker.on('exit', res));
  try {
    await new Promise((res, rej) => {
      let seen = '';
      const timer = setTimeout(() => rej(new Error('the file holder did not start within 30 seconds')), 30000);
      locker.stdout.on('data', (d) => { seen += d; if (seen.includes('LOCKED')) { clearTimeout(timer); res(); } });
      locker.on('exit', (code) => { clearTimeout(timer); rej(new Error(`the file holder exited early (${code})`)); });
    });
    const r = run(root);
    check(`${label}: exits 1, not a false OK`, r.status === 1 && !/^OK:/m.test(r.stdout), `exit ${r.status}; ${r.stdout.trim()}`);
    check(`${label}: says the rename failed`, /BACKUP FAILED/.test(r.stderr) && /could not be renamed/.test(r.stderr), r.stderr);
    check(`${label}: warns that a ZIP of that name is from an earlier run`, /EARLIER run/.test(r.stderr), r.stderr);
    check(`${label}: no .partial is left behind`, !listBackups(root).some((f) => f.endsWith('.partial')), listBackups(root).join(', '));
  } finally {
    locker.kill();
    await exited;
  }
  check(`${label}: the earlier ZIPs are untouched`, held.every((f) => fs.readFileSync(f, 'utf8') === 'an older ZIP'));
}

try {
  caseWhatGoesIn();
  caseWorktree();
  caseSameMinuteReplaced();
  await caseRenameBlocked();
} catch (e) {
  failures++;
  console.error(`FAIL the suite itself threw: ${e.stack || e.message}`);
}

if (failures > 0) {
  console.error(`Backup-script-tests.mjs: ${failures} of ${checks} checks FAILED (${PS}). Fake projects kept for a look: ${BASE}`);
  process.exit(1);
}
fs.rmSync(BASE, { recursive: true, force: true });
console.log(`Backup-script-tests.mjs: all ${checks} checks passed (${PS})`);
