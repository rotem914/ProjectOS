// Fixture tests for the kit's snapshot scripts, the twins
// project-os/Backup-whole-project.ps1 and project-os/Backup-whole-project.mjs.
//
// Run from the kit root:   node tests/Backup-script-tests.mjs
// It prints one line per failing check and a count at the end, and exits 1 when
// any check fails. Every case runs against both twins: the PowerShell one when
// Windows PowerShell or PowerShell 7 (pwsh) is on the machine, the Node one
// always. Without PowerShell it says so plainly and tests the Node twin alone,
// since that one is all such a machine can run.
//
// This folder sits outside project-os/ on purpose: an install copies all of
// project-os/ into a client project, and these tests belong to the kit only.
//
// Each case builds a fake project in a folder whose name has a space, copies one
// twin into its project-os/, runs it for real and opens the ZIP it made with a
// reader written here, independent of the code that wrote it. The Node twin's
// ZIP is also opened by two outside readers, PowerShell's Expand-Archive and a
// tar that reads ZIP (bsdtar; GNU tar cannot), each where the machine has it,
// and every file that comes out is compared byte for byte with its source. The
// fake projects live in the OS temp folder, or under PROJECTOS_TEST_TMP when
// that is set (a project whose rules keep every write inside it points this at
// its own scratch folder). Nothing else is touched. The folder is removed when
// the run ends, whether it passed, failed, threw or was stopped with Ctrl+C
// (2026-10-01): removing it only after a clean finish left one behind on every
// failed or stopped run. A process killed outright runs no handler, so that
// one alone still leaves the folder, named projectos-backup-tests-*.
//
// What it pins: the right files go in and the right ones stay out, a template
// travels only when example, sample or template is a whole part at the end of
// its name (env files too: .env.sample, .env.production.example), an SSH key
// with a suffix (id_rsa_work) stays out while its .pub travels, every key
// file left out is named and both twins print that line in one order, the
// common real names of secrets stay out (serviceAccountKey.json, the adminsdk
// JSON, production.env, .npmrc, .netrc, a file named credentials, *.p8, *.ppk,
// terraform state, a key's .bak, .old or .orig copy) while the everyday names
// beside them travel, a folder named build or target travels (either can hold
// real work, 2026-10-01), a folder named like a scratch or backup folder
// deeper down still travels, every folder left out by name is reported, each
// entry carries its file's modification time, every folder goes in as an
// entry of its own so an empty one comes back out of the outside readers, the
// history check (2026-10-02): a project right after git gc, whose .git/refs
// holds no file, restores with history that git opens, a project with no
// commit yet passes, a signed latest commit passes with git set to show
// signatures (ssh signing; skipped without ssh-keygen), a branch named
// fix/credentials travels with the history whether or not it is checked
// out, a .git missing a part git needs or naming a commit that
// is not there fails the run, and without git the parts alone are checked and
// the run says so, a git worktree is refused, the Node twin's ZIP64 records
// open in the outside readers (forced on a tiny project by
// PROJECTOS_FORCE_ZIP64=1, so no huge disk is needed), a ZIP name held open
// by another program ends in a loud failure instead of a false OK (Windows
// only: other systems do not lock files that way), both twins print the same
// lines for the same project, and the two twins' setup blocks name the same
// folders to leave out, and their fixed lists the same key files, key copy
// endings, public keys and template words. Those last checks read the kit's
// own files, so they run even where PowerShell cannot. The history cases that
// build a real repository need git; without it they say so and are skipped.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const KIT_OS = fileURLToPath(new URL('../project-os/', import.meta.url));

function findPowerShell() {
  for (const exe of ['powershell', 'pwsh']) {
    const r = spawnSync(exe, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' });
    if (!r.error && r.status === 0) return exe;
  }
  return null;
}
// A tar that reads ZIP. On Windows the system's own tar.exe is bsdtar, but a
// Git Bash PATH puts GNU tar first, so that one is asked for by its full path.
function findZipTar() {
  const candidates = ['bsdtar', 'tar'];
  if (process.platform === 'win32') candidates.unshift(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'));
  for (const exe of candidates) {
    const r = spawnSync(exe, ['--version'], { encoding: 'utf8' });
    if (!r.error && r.status === 0 && /bsdtar/.test(r.stdout)) return exe;
  }
  return null;
}
// git for the history cases, run with every GIT_ variable dropped, as the
// twins run it, so a hook's GIT_DIR cannot point it at another repository.
const GIT_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k)));
function findGit() {
  const r = spawnSync('git', ['--version'], { env: GIT_ENV, encoding: 'utf8' });
  return !r.error && r.status === 0;
}
// ssh-keygen for the signed-commit case, which makes the key git signs with.
// It has no version flag, so being found at all is the test.
function findSshKeygen() {
  const r = spawnSync('ssh-keygen', ['-?'], { encoding: 'utf8' });
  return !r.error;
}
const PS = findPowerShell();
const TAR = findZipTar();
const GIT = findGit();
const SSH_KEYGEN = findSshKeygen();

const ENGINES = [];
if (PS) {
  ENGINES.push({
    id: PS,
    file: 'Backup-whole-project.ps1',
    command: (script) => [PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script]],
    // Puts '.git' at the top of the setup block's list.
    addGit: (s) => s.replace(/\$ExcludeDirs = @\(\r?\n/, (m) => `${m}    '.git'\n`),
  });
} else {
  console.log('  Neither powershell nor pwsh was found: Backup-whole-project.ps1 cannot run on this machine, so only the Node twin is tested.');
}
ENGINES.push({
  id: 'node',
  file: 'Backup-whole-project.mjs',
  command: (script) => [process.execPath, [script]],
  addGit: (s) => s.replace(/const EXCLUDE_DIRS = \[\r?\n/, (m) => `${m}  '.git',\n`),
});
const NODE = ENGINES[ENGINES.length - 1];
if (!TAR) console.log('  No tar that reads ZIP (bsdtar) was found: the tar checks are skipped.');
if (!GIT) console.log('  git was not found: the history cases that build a real repository are skipped.');
if (GIT && !SSH_KEYGEN) console.log('  ssh-keygen was not found: the signed-commit history case is skipped.');

const BASE = fs.mkdtempSync(path.join(process.env.PROJECTOS_TEST_TMP || os.tmpdir(), 'projectos-backup-tests-'));

// The fake projects are removed however the run ends (2026-10-01). A child
// still holding a file open inside them is stopped first, since Windows
// refuses to delete a file another program holds, and the removal retries for
// a moment while that program lets go. The result is kept, so the closing
// lines can report a folder that would not go.
const children = new Set();
let baseRemoved = null;
function removeBase() {
  if (baseRemoved !== null) return baseRemoved;
  for (const child of children) {
    try { child.kill(); } catch { /* already gone */ }
  }
  try {
    fs.rmSync(BASE, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    baseRemoved = true;
  } catch (e) {
    baseRemoved = false;
    console.error(`The fake projects could not be removed, delete this folder by hand: ${BASE} (${e.message})`);
  }
  return baseRemoved;
}
process.on('exit', removeBase);
// Ctrl+C and its kin end a Node process without the exit event, so each one
// that this system knows is caught, cleaned up after, and passed on as the
// usual exit code for that signal.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  const number = os.constants.signals[sig];
  if (number === undefined) continue;
  process.on(sig, () => {
    removeBase();
    process.exit(128 + number);
  });
}

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
// A name ending in a slash makes an empty folder.
function project(engine, name, files, editScript = (s) => s) {
  const root = path.join(BASE, engine.id, name, 'fake proj');
  for (const [rel, content] of Object.entries(files)) {
    if (rel.endsWith('/')) {
      fs.mkdirSync(path.join(root, rel), { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  fs.mkdirSync(path.join(root, 'project-os'), { recursive: true });
  fs.writeFileSync(path.join(root, 'project-os', engine.file), editScript(fs.readFileSync(path.join(KIT_OS, engine.file), 'utf8')));
  return root;
}
function run(engine, root, env = {}) {
  const [exe, args] = engine.command(path.join(root, 'project-os', engine.file));
  const r = spawnSync(exe, args, { encoding: 'utf8', cwd: root, env: { ...process.env, ...env } });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
const backupsOf = (root) => path.join(root, 'backups');
const listBackups = (root) => (fs.existsSync(backupsOf(root)) ? fs.readdirSync(backupsOf(root)) : []);
const okPath = (stdout) => (/^OK: (.+?)\r?$/m.exec(stdout) || [])[1] || null;
const historyLineOf = (stdout) => ((/^History check: .*$/m.exec(stdout) || [''])[0]).replace(/\r$/, '');
const samePath = (a, b) => {
  try { return fs.realpathSync.native(a) === fs.realpathSync.native(b); } catch { return false; }
};
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

// A CRC-32 for checking each entry. zlib.crc32 when this Node has it, so the
// check does not share code with the Node twin's own table.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  let c = 0xFFFFFFFF;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// A small ZIP reader: the end record (and its ZIP64 form), the central
// directory with any ZIP64 extra field, and one entry's bytes from its local
// header. Enough for what the twins write.
const MAX32 = 0xFFFFFFFF;
function readZip(file) {
  const buf = fs.readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error(`${file} is not a ZIP (no end record)`);
  let count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  let zip64End = false;
  if (count === 0xFFFF || p === MAX32 || buf.readUInt32LE(eocd + 12) === MAX32) {
    if (buf.readUInt32LE(eocd - 20) !== 0x07064b50) throw new Error(`${file}: no ZIP64 locator before the end record`);
    const z = Number(buf.readBigUInt64LE(eocd - 20 + 8));
    if (buf.readUInt32LE(z) !== 0x06064b50) throw new Error(`${file}: no ZIP64 end record where the locator points`);
    count = Number(buf.readBigUInt64LE(z + 32));
    p = Number(buf.readBigUInt64LE(z + 48));
    zip64End = true;
  }
  const entries = new Map();
  for (; count > 0; count--) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`${file}: bad central directory`);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const e = {
      needed: buf.readUInt16LE(p + 6), flags: buf.readUInt16LE(p + 8), method: buf.readUInt16LE(p + 10),
      time: buf.readUInt16LE(p + 12), date: buf.readUInt16LE(p + 14), crc: buf.readUInt32LE(p + 16),
      csize: buf.readUInt32LE(p + 20), size: buf.readUInt32LE(p + 24), local: buf.readUInt32LE(p + 42), zip64: false,
    };
    e.allMax = e.csize === MAX32 && e.size === MAX32 && e.local === MAX32;
    for (let x = p + 46 + nameLen; x + 4 <= p + 46 + nameLen + extraLen; x += 4 + buf.readUInt16LE(x + 2)) {
      if (buf.readUInt16LE(x) !== 0x0001) continue;
      e.zip64 = true;
      let q = x + 4;
      if (e.size === MAX32) { e.size = Number(buf.readBigUInt64LE(q)); q += 8; }
      if (e.csize === MAX32) { e.csize = Number(buf.readBigUInt64LE(q)); q += 8; }
      if (e.local === MAX32) { e.local = Number(buf.readBigUInt64LE(q)); q += 8; }
    }
    // What the local header says, for comparing with the central record. With
    // flag bit 3 the values sit in a descriptor after the data instead.
    const l = e.local;
    e.localZip64 = buf.readUInt32LE(l + 18) === MAX32 && buf.readUInt16LE(l + 28) >= 20;
    e.localAgrees = buf.readUInt32LE(l) === 0x04034b50 && buf.toString('utf8', l + 30, l + 30 + buf.readUInt16LE(l + 26)) === name;
    if (e.localAgrees && !(e.flags & 0x08)) {
      let lsize = buf.readUInt32LE(l + 22);
      let lcsize = buf.readUInt32LE(l + 18);
      if (e.localZip64) {
        const x = l + 30 + buf.readUInt16LE(l + 26);
        if (buf.readUInt16LE(x) !== 0x0001) e.localAgrees = false;
        else { lsize = Number(buf.readBigUInt64LE(x + 4)); lcsize = Number(buf.readBigUInt64LE(x + 12)); }
      }
      e.localAgrees = e.localAgrees && buf.readUInt32LE(l + 14) === e.crc && lsize === e.size && lcsize === e.csize;
    }
    entries.set(name, e);
    p += 46 + nameLen + extraLen + buf.readUInt16LE(p + 32);
  }
  function bytes(name) {
    const e = entries.get(name);
    if (!e) return null;
    const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
    const data = buf.subarray(start, start + e.csize);
    return e.method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data);
  }
  // Files and folders apart: a folder's entry name ends in a slash.
  const all = [...entries.keys()];
  return {
    names: all.filter((n) => !n.endsWith('/')).sort(),
    folders: all.filter((n) => n.endsWith('/')).sort(),
    entries, zip64End, bytes, content: (n) => (bytes(n) || Buffer.alloc(0)).toString('utf8'),
  };
}

// Every folder above a file, each with its closing slash: a/b/c.txt gives
// a/ and a/b/.
const parentsOf = (rel) => rel.split('/').slice(0, -1).map((_, i, parts) => `${parts.slice(0, i + 1).join('/')}/`);

function filesUnder(dir, rel = '') {
  const out = [];
  for (const d of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) out.push(...filesUnder(dir, r));
    else out.push(r);
  }
  return out;
}

// Every entry of the ZIP, through this reader: its local header agrees with
// its central record, the CRC it records matches the bytes, and the bytes match
// the source file. A folder entry holds no data and names a folder.
function compareEntries(label, zipFile, root) {
  const z = readZip(zipFile);
  const disagree = [...z.entries.keys()].filter((n) => !z.entries.get(n).localAgrees);
  check(`${label}: every local header agrees with its central record (CRC, sizes, name)`, disagree.length === 0, disagree.join(', '));
  const bad = z.names.filter((n) => {
    const b = z.bytes(n);
    return crc32(b) !== z.entries.get(n).crc || !b.equals(fs.readFileSync(path.join(root, n)));
  });
  check(`${label}: every entry's CRC and bytes match its source`, bad.length === 0, bad.join(', '));
  const notFolders = z.folders.filter((n) => {
    const e = z.entries.get(n);
    try { return e.size !== 0 || e.csize !== 0 || !fs.statSync(path.join(root, n)).isDirectory(); } catch { return true; }
  });
  check(`${label}: every folder entry is empty and names a folder in the source`, notFolders.length === 0, notFolders.join(', '));
  return z;
}

// The outside readers this machine has, each a [name, open(zip, dest)] pair:
// PowerShell's Expand-Archive and a tar that reads ZIP.
function outsideReaders() {
  const readers = [];
  if (PS) {
    readers.push(['Expand-Archive', (zipFile, dest) => spawnSync(PS, ['-NoProfile', '-Command',
      `$ProgressPreference = 'SilentlyContinue'; Expand-Archive -LiteralPath '${zipFile.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}'`], { encoding: 'utf8' })]);
  }
  if (TAR) readers.push(['tar -xf', (zipFile, dest) => spawnSync(TAR, ['-xf', zipFile, '-C', dest], { encoding: 'utf8' })]);
  return readers;
}
const isFolder = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

// The Node twin's ZIP, opened by readers that share nothing with it.
//
// One allowance, for tar on Windows only: tar.exe writes each name through the
// machine's ANSI code page, so a name that page cannot hold is skipped with
// "unreadable filename". A ZIP made by .NET fails the same way (measured
// 2026-10-01), so it says nothing about the writer. There, a name outside
// ASCII may be missing, with that message and no other; every file tar does
// write is still compared, and the test's reader and Expand-Archive check that
// name in full.
const NON_ASCII = /[^\x20-\x7e]/;
function extractAndCompare(label, zipFile, root, names, folders = []) {
  for (const [reader, open] of outsideReaders()) {
    const codePageBound = reader.startsWith('tar') && process.platform === 'win32';
    const dest = fs.mkdtempSync(path.join(BASE, 'out-'));
    const r = open(zipFile, dest);
    let got = [];
    try { got = filesUnder(dest).sort(); } catch { /* reported by the checks below */ }
    const unwritten = names.filter((n) => !got.includes(n));
    const onlyCodePage = codePageBound && unwritten.length > 0 && unwritten.every((n) => NON_ASCII.test(n)) &&
      (r.stderr || '').split(/\r?\n/).filter(Boolean).every((l) => /unreadable filename|Error exit delayed/.test(l));
    if (onlyCodePage) console.log(`  ${label}: ${reader} could not write ${unwritten.join(', ')} through this machine's ANSI code page (a reader limit, see extractAndCompare)`);
    check(`${label}: opens with ${reader}`, !r.error && (r.status === 0 || onlyCodePage), (r.error && r.error.message) || r.stderr);
    const want = onlyCodePage ? names.filter((n) => !unwritten.includes(n)) : names;
    check(`${label}: ${reader} gives back exactly the archived files`, got.join('|') === want.join('|'), `got ${got.join(', ')}`);
    const differ = want.filter((n) => {
      try { return !fs.readFileSync(path.join(dest, n)).equals(fs.readFileSync(path.join(root, n))); } catch { return true; }
    });
    check(`${label}: every file ${reader} extracts has its source's bytes`, differ.length === 0, differ.join(', '));
    const noFolder = folders.filter((n) => !isFolder(path.join(dest, n)));
    check(`${label}: ${reader} gives back every folder, the empty ones too`, noFolder.length === 0, noFolder.join(', '));
  }
}

// Bytes that do not compress well, from a fixed seed, so a run is repeatable.
function noise(length, seed) {
  const b = Buffer.alloc(length);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    b[i] = x & 0xFF;
  }
  return b;
}
// Over a megabyte, so the Node twin streams it instead of reading it whole.
const BIG = Buffer.concat([noise(1536 * 1024, 7), Buffer.from('a line that repeats\n'.repeat(60000)), noise(777, 9)]);
const UNICODE_NAME = 'src/caf\u00e9 \u05e9\u05dc\u05d5\u05dd.txt';

function caseWhatGoesIn(engine) {
  const label = `${engine.id} contents`;
  const root = project(engine, 'contents', {
    'README.md': 'readme\n',
    'src/a.txt': 'alpha content\n',
    'src/dist/icon.png': 'png',                     // a listed name deeper down: left out, and reported
    'build/out.js': 'a build folder can hold real work',  // not listed: travels
    'src/target/keep.txt': 'so can a target folder',      // not listed: travels
    'src/.tmp/keep.txt': 'nested .tmp travels',     // only the root scratch folder is left out
    'src/features/backups/b.txt': 'nested backups travels',
    'node_modules/pkg/index.js': 'dependency',
    '.tmp/scratch.txt': 'root scratch',
    '.claude/settings.local.json': '{}',                 // personal: stays on this machine
    '.claude/settings.local.json.backup': '{}',          // the installer's copy of it
    '.claude/settings.json': '{ "hooks": {} }',           // committed: the team's guard wiring travels
    '.claude/commands/go.md': 'a project command',         // travels
    '.claude/worktrees/w/a.txt': 'a whole repository copy',
    'src/.claude/notes.md': 'a .claude folder deeper down travels',
    '.env': 'SECRET=1', '.env.local': 'SECRET=2', '.env.example': 'SECRET=',
    '.dev.vars': 'KEY=1', '.dev.vars.example': 'KEY=',
    // An env template travels whatever its word, at any depth; a real env
    // file deeper down stays out like the root one (2026-10-01).
    '.env.sample': 'SECRET=', '.env.template': 'SECRET=', '.dev.vars.sample': 'KEY=',
    'src/deep/.env.production.example': 'SECRET=', 'src/deep/.env.production': 'SECRET=3',
    // Common key files stay out by name (2026-10-01); templates and a
    // Keynote deck (.key) travel, and so does an SSH public key.
    'certs/server.pem': 'KEY', 'certs/app.P12': 'KEY', 'certs/app.pfx': 'KEY', 'android/release.keystore': 'KEY',
    'android/upload.jks': 'KEY', 'ssh/id_rsa': 'KEY', 'ssh/id_ed25519': 'KEY', 'ssh/id_rsa.pub': 'public',
    'credentials.json': '{}', 'config/gcp-credentials-prod.json': '{}', 'client_secret_123.json': '{}',
    'my-service-account.json': '{}', 'service_account_key.json': '{}',
    'credentials.example.json': '{}', 'certs/server.sample.pem': 'template', 'deck.key': 'a Keynote deck',
    // The template word counts only as a whole part at the end of the name:
    // these two are real certificates, and stay out named.
    'certs/www.example.com.pem': 'KEY', 'certs/tls.sample-site.pem': 'KEY',
    // An SSH key with a suffix stays out; its public key travels.
    'ssh/id_rsa_work': 'KEY', 'ssh/id_ed25519_github': 'KEY', 'ssh/id_ecdsa_old': 'KEY', 'ssh/id_dsa_x': 'KEY',
    'ssh/id_rsa_work.pub': 'public', 'ssh/id_ed25519_github.pub': 'public',
    'x.tmp': 'atomic-write leftover', 'y.tmp.1': 'atomic-write leftover',
    // The least git calls a repository: a project with no commit yet.
    '.git/HEAD': 'ref: refs/heads/main\n', '.git/objects/': null, '.git/refs/heads/': null,
    'bin/big.bin': BIG,
    'bin/empty.txt': '',
    [UNICODE_NAME]: 'a name outside ASCII\n',
  });
  // A known modification time, local, on an even second: DOS times keep two.
  const when = new Date(2001, 1, 3, 4, 5, 6);
  fs.utimesSync(path.join(root, 'src/a.txt'), when, when);
  const r = run(engine, root);
  check(`${label}: exits 0`, r.status === 0, r.stderr);
  const zip = okPath(r.stdout);
  check(`${label}: prints the ZIP it made`, !!zip && fs.existsSync(zip), r.stdout);
  if (!zip || !fs.existsSync(zip)) return;
  check(`${label}: the ZIP lands in backups/`, samePath(path.dirname(zip), backupsOf(root)), zip);
  check(`${label}: no .partial is left behind`, !listBackups(root).some((f) => f.endsWith('.partial')), listBackups(root).join(', '));
  const z = compareEntries(label, zip, root);
  // [R10] The committed .claude/settings.json and the project's commands
  // travel, so a restore comes back with its guard wiring; the personal
  // settings file, its backup copy and the worktree copies stay behind.
  const expected = ['.claude/commands/go.md', '.claude/settings.json', '.dev.vars.example', '.env.example', '.git/HEAD', 'README.md',
    'bin/big.bin', 'bin/empty.txt', 'build/out.js', `project-os/${engine.file}`, 'src/.claude/notes.md', 'src/.tmp/keep.txt', 'src/a.txt',
    'ssh/id_rsa.pub', 'credentials.example.json', 'certs/server.sample.pem', 'deck.key',
    '.env.sample', '.env.template', '.dev.vars.sample', 'src/deep/.env.production.example',
    'ssh/id_rsa_work.pub', 'ssh/id_ed25519_github.pub',
    UNICODE_NAME, 'src/features/backups/b.txt', 'src/target/keep.txt'].sort();
  check(`${label}: exactly the right files are in the ZIP`, z.names.join('|') === expected.join('|'),
    `got ${z.names.join(', ')}`);
  // Every folder the walk entered goes in, the empty ones and those whose
  // files all stayed out too; a folder left out by name does not.
  const expectedFolders = [...new Set([...expected.flatMap(parentsOf), 'android/', 'config/', '.git/objects/', '.git/refs/', '.git/refs/heads/'])].sort();
  check(`${label}: exactly the right folders are in the ZIP`, z.folders.join('|') === expectedFolders.join('|'),
    `got ${z.folders.join(', ')}`);
  check(`${label}: the count line counts files and folders apart`,
    r.stdout.includes(`Added ${expected.length} file(s) and ${expectedFolders.length} folder(s), all ${expected.length + expectedFolders.length} verified present in the archive by name.`), r.stdout);
  const wantHistory = GIT ? "History check: the snapshot's history opens with git and holds no commit yet."
    : 'History check: git was not found, so only the parts git needs were checked: .git/HEAD, .git/objects and .git/refs are in the archive.';
  check(`${label}: the history check passes a project with no commit yet`, historyLineOf(r.stdout) === wantHistory, historyLineOf(r.stdout));
  check(`${label}: the ZIP is all backups/ holds`, listBackups(root).join('|') === path.basename(zip), listBackups(root).join(', '));
  check(`${label}: a file's bytes come back out`, z.content('src/a.txt') === 'alpha content\n');
  const a = z.entries.get('src/a.txt');
  check(`${label}: an entry carries its file's modification time`,
    !!a && a.date === ((2001 - 1980) << 9 | 2 << 5 | 3) && a.time === (4 << 11 | 5 << 5 | 3), a && `date ${a.date}, time ${a.time}`);
  const u = z.entries.get(UNICODE_NAME);
  check(`${label}: a name outside ASCII is marked UTF-8 (flag bit 11)`, !!u && (u.flags & 0x0800) !== 0, u && `flags ${u.flags}`);
  const left = ((/^Left out by name: (.+?)\r?$/m.exec(r.stdout) || [])[1] || '').split(', ');
  for (const dir of ['.claude/worktrees', '.tmp', 'backups', 'node_modules', 'src/dist']) {
    check(`${label}: "${dir}" is reported as left out by name`, left.includes(dir), `Left out: ${left.join(', ')}`);
  }
  for (const dir of ['.claude', 'build', 'src/.claude', 'src/.tmp', 'src/features/backups', 'src/target']) {
    check(`${label}: "${dir}" is not reported as left out`, !left.includes(dir), `Left out: ${left.join(', ')}`);
  }
  const keys = ((/^Left out as key files \(bring them back by hand on a restore\): (.+?)\r?$/m.exec(r.stdout) || [])[1] || '').split(', ');
  const wantKeys = ['android/release.keystore', 'android/upload.jks', 'certs/app.P12', 'certs/app.pfx', 'certs/server.pem', 'client_secret_123.json',
    'config/gcp-credentials-prod.json', 'credentials.json', 'my-service-account.json', 'service_account_key.json', 'ssh/id_ed25519', 'ssh/id_rsa',
    'certs/www.example.com.pem', 'certs/tls.sample-site.pem', 'ssh/id_rsa_work', 'ssh/id_ed25519_github', 'ssh/id_ecdsa_old', 'ssh/id_dsa_x'];
  check(`${label}: every key file left out is named on its own line`, [...keys].sort().join('|') === [...wantKeys].sort().join('|'), `got: ${keys.join(', ')}`);
  if (engine === NODE) {
    check(`${label}: every name is marked UTF-8 and uses forward slashes`, [...z.entries].every(([n, e]) => (e.flags & 0x0800) && !n.includes('\\')));
    check(`${label}: a small archive needs no ZIP64 records`, !z.zip64End && [...z.entries.values()].every((e) => !e.zip64 && !e.localZip64));
    extractAndCompare(label, zip, root, expected, expectedFolders);
  }
}

function caseZip64() {
  const label = 'node forced ZIP64';
  const root = project(NODE, 'zip64', {
    'src/a.txt': 'alpha content\n',
    'bin/big.bin': BIG,
    'bin/empty.txt': '',
    [UNICODE_NAME]: 'a name outside ASCII\n',
  });
  const r = run(NODE, root, { PROJECTOS_FORCE_ZIP64: '1' });
  check(`${label}: exits 0, its own read-back passing through the ZIP64 records`, r.status === 0, r.stderr);
  const zip = okPath(r.stdout);
  if (!zip || !fs.existsSync(zip)) {
    check(`${label}: prints the ZIP it made`, false, r.stdout);
    return;
  }
  const z = compareEntries(label, zip, root);
  const names = ['bin/big.bin', 'bin/empty.txt', 'project-os/Backup-whole-project.mjs', 'src/a.txt', UNICODE_NAME].sort();
  check(`${label}: exactly the right files are in the ZIP`, z.names.join('|') === names.join('|'), `got ${z.names.join(', ')}`);
  const folders = ['bin/', 'project-os/', 'src/'];
  check(`${label}: exactly the right folders are in the ZIP`, z.folders.join('|') === folders.join('|'), `got ${z.folders.join(', ')}`);
  check(`${label}: the end record points on to a ZIP64 end record`, z.zip64End);
  // Folder entries included: they take the ZIP64 form too.
  const plain = [...z.entries].filter(([, e]) => !(e.zip64 && e.allMax && e.localZip64 && e.needed === 45)).map(([n]) => n);
  check(`${label}: every entry's sizes and offset live in ZIP64 fields, central and local`, plain.length === 0, plain.join(', '));
  extractAndCompare(label, zip, root, names, folders);
}

function caseWorktree(engine) {
  const label = `${engine.id} worktree`;
  const root = project(engine, 'worktree', {
    'src/a.txt': 'a\n',
    '.git': 'gitdir: C:/elsewhere/main/.git/worktrees/wt\n',
  });
  const r = run(engine, root);
  check(`${label}: a .git file is refused with exit 1`, r.status === 1, r.stdout);
  check(`${label}: the refusal names where the history lives`, /BACKUP FAILED/.test(r.stderr) && r.stderr.includes('history lives in: C:/elsewhere/main/.git/worktrees/wt'), r.stderr);
  check(`${label}: no ZIP is made`, !listBackups(root).some((f) => /\.zip/.test(f)), listBackups(root).join(', '));

  // A working-tree-only ZIP, chosen in the setup block, is not refused.
  let edited = false;
  const root2 = project(engine, 'worktree-no-history', { 'src/a.txt': 'a\n', '.git': 'gitdir: C:/elsewhere/main/.git/worktrees/wt\n' },
    (s) => { const t = engine.addGit(s); edited = t !== s; return t; });
  check(`${label}: the setup block was found to add .git to`, edited);
  const r2 = run(engine, root2);
  check(`${label}: with .git left out on purpose, the ZIP is made`, r2.status === 0 && !!okPath(r2.stdout), r2.stderr);
  check(`${label}: with .git left out on purpose, there is no history to check`, historyLineOf(r2.stdout) === '', r2.stdout);
}

function caseSameMinuteReplaced(engine) {
  const label = `${engine.id} same-minute ZIP`;
  const root = project(engine, 'same-minute', { 'src/a.txt': 'a\n' });
  fs.mkdirSync(backupsOf(root), { recursive: true });
  for (const name of nearStamps()) fs.writeFileSync(path.join(backupsOf(root), name), 'an older ZIP');
  const r = run(engine, root);
  check(`${label}: an earlier ZIP of the same name, not held open, is replaced`, r.status === 0, r.stderr);
  const zip = okPath(r.stdout);
  let names = [];
  try { names = readZip(zip).names; } catch (e) { names = [e.message]; }
  check(`${label}: the ZIP printed is this run's`, names.includes('src/a.txt'), names.join(', '));
}

async function caseRenameBlocked(engine) {
  const label = `${engine.id} rename blocked`;
  if (process.platform !== 'win32' || !PS) {
    console.log(`  ${label}: skipped (Windows only, and the file holder is PowerShell; other systems do not lock a file against a rename)`);
    return;
  }
  const root = project(engine, 'rename-blocked', { 'src/a.txt': 'a\n' });
  fs.mkdirSync(backupsOf(root), { recursive: true });
  const held = nearStamps().map((n) => path.join(backupsOf(root), n));
  for (const f of held) fs.writeFileSync(f, 'an older ZIP');
  // Another program holds each possible name open, sharing read only: a rename
  // onto it cannot delete it.
  const quoted = held.map((f) => `'${f.replace(/'/g, "''")}'`).join(', ');
  const locker = spawn(PS, ['-NoProfile', '-Command',
    `$h = @(); foreach ($p in @(${quoted})) { $h += [System.IO.File]::Open($p, 'Open', 'Read', 'Read') }; [Console]::Out.WriteLine('LOCKED'); [Console]::Out.Flush(); Start-Sleep -Seconds 120`],
  { stdio: ['ignore', 'pipe', 'pipe'] });
  // Known to the cleanup, so a run stopped while it holds the files can
  // still remove the folder they sit in.
  children.add(locker);
  locker.on('exit', () => children.delete(locker));
  const exited = new Promise((res) => locker.on('exit', res));
  try {
    await new Promise((res, rej) => {
      let seen = '';
      const timer = setTimeout(() => rej(new Error('the file holder did not start within 30 seconds')), 30000);
      locker.stdout.on('data', (d) => { seen += d; if (seen.includes('LOCKED')) { clearTimeout(timer); res(); } });
      locker.on('exit', (code) => { clearTimeout(timer); rej(new Error(`the file holder exited early (${code})`)); });
    });
    const r = run(engine, root);
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

// The folder names one twin's setup block leaves out: the quoted names between
// the line that opens its list and the line that closes it, inside the block
// the install edits. Reading stops at a comment on each line, so a name that a
// comment only mentions does not count.
function setupExcludes(text, opens, closes) {
  const block = /--- Setup block[^\n]*\n([\s\S]*?)\n[^\n]*--- End of setup block/.exec(text.replace(/\r\n/g, '\n'));
  if (!block) return null;
  const lines = block[1].split('\n');
  const start = lines.findIndex((l) => opens.test(l));
  if (start === -1) return null;
  const names = [];
  for (let i = start + 1; i < lines.length && !closes.test(lines[i]); i++) {
    for (const m of lines[i].matchAll(/'([^']*)'|"([^"]*)"|(#|\/\/)/g)) {
      if (m[3]) break;
      names.push(m[1] ?? m[2]);
    }
  }
  return names;
}

// Both twins name their exclusions in a setup block the install edits, and a
// name added to one and not the other makes the two snapshots differ with no
// error from either (2026-10-01). Compared without case, since both scripts
// match a folder's name that way.
function caseSameExcludeList() {
  const label = 'twins: the setup blocks leave out the same folders';
  const read = (file) => fs.readFileSync(path.join(KIT_OS, file), 'utf8');
  const ps = setupExcludes(read('Backup-whole-project.ps1'), /^\s*\$ExcludeDirs\s*=\s*@\(/, /^\s*\)/);
  const js = setupExcludes(read('Backup-whole-project.mjs'), /^\s*const EXCLUDE_DIRS\s*=\s*\[/, /^\s*\]/);
  if (!ps || !js || !ps.length || !js.length) {
    check(label, false, `no exclude list found in the setup block of ${[!ps || !ps.length ? 'Backup-whole-project.ps1' : '', !js || !js.length ? 'Backup-whole-project.mjs' : ''].filter(Boolean).join(' and ')}`);
    return;
  }
  const lower = (list) => new Set(list.map((n) => n.toLowerCase()));
  const a = lower(ps);
  const b = lower(js);
  const onlyPs = [...a].filter((n) => !b.has(n)).sort();
  const onlyJs = [...b].filter((n) => !a.has(n)).sort();
  check(label, !onlyPs.length && !onlyJs.length, `only in the .ps1: ${onlyPs.join(', ') || 'none'}; only in the .mjs: ${onlyJs.join(', ') || 'none'}`);
}

// Both twins name the key files they leave out, the public keys that travel
// and the words that mark a template in fixed lists outside the setup block;
// a name in one list and not the other lets a key into one twin's ZIP only
// (2026-10-01).
function caseSameKeyFiles() {
  const read = (file) => fs.readFileSync(path.join(KIT_OS, file), 'utf8').replace(/\r\n/g, '\n');
  const names = (text, re) => { const m = re.exec(text); return m ? [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1].toLowerCase()).sort() : null; };
  const ps = read('Backup-whole-project.ps1');
  const js = read('Backup-whole-project.mjs');
  for (const [what, psRe, jsRe] of [
    ['key files stay out', /^\$KeyFilePatterns = @\(([^)]*)\)/m, /^const KEY_FILE_PATTERNS = \[([^\]]*)\]/m],
    ['endings mark a key file\'s copy', /^\$KeyCopyEndings = @\(([^)]*)\)/m, /^const KEY_COPY_ENDINGS = \[([^\]]*)\]/m],
    ['public keys travel', /^\$PublicKeyPatterns = @\(([^)]*)\)/m, /^const PUBLIC_KEY_PATTERNS = \[([^\]]*)\]/m],
    ['words mark a template', /^\$TemplateWords = @\(([^)]*)\)/m, /^const TEMPLATE_WORDS = \[([^\]]*)\]/m],
  ]) {
    const a = names(ps, psRe);
    const b = names(js, jsRe);
    check(`twins: the same ${what}`, !!a && !!b && a.length > 0 && a.join('|') === b.join('|'), `.ps1: ${a && a.join(', ')}; .mjs: ${b && b.join(', ')}`);
  }
}

// Both twins print the key-file line in one fixed order, byte for byte
// (2026-10-01): ASCII letters compared without case, every other character by
// its UTF-16 code unit, the exact name breaking a tie. PowerShell's Sort-Object
// followed the machine's culture and Node's localeCompare its own collation,
// so the same files printed in two orders. The names mix case, digits, spaces
// and punctuation, where a collation and a code-unit order part ways, and the
// order below is written out by hand so it shares no code with either twin.
// No two differ only by case, so the set fits a Windows folder.
const KEY_LINE_ORDER = ['keys.d/y.pem', 'keys/10.pem', 'keys/9.pem', 'keys/a b.pem', 'keys/a-c.pem', 'keys/a.pem', 'keys/ab.pem',
  'keys/A_d.pem', 'keys/B.pem', "keys/it's.pem", 'keys/z[1].pem', 'keys/~t.pem', 'Keys2/x.pem', 'ssh/ID_ed25519', 'ssh/id_RSA_Work'];
function caseKeyLineOrder() {
  const lines = [];
  for (const engine of ENGINES) {
    const label = `${engine.id} key-file line`;
    const root = project(engine, 'key-order', Object.fromEntries(KEY_LINE_ORDER.map((n) => [n, 'KEY'])));
    const r = run(engine, root);
    check(`${label}: exits 0`, r.status === 0, r.stderr);
    const line = (/^Left out as key files .*$/m.exec(r.stdout) || [])[0] || '';
    check(`${label}: names every key file in the fixed order`,
      line === `Left out as key files (bring them back by hand on a restore): ${KEY_LINE_ORDER.join(', ')}`, `got: ${line}`);
    lines.push(line);
  }
  if (lines.length === 2) {
    check('twins: the key-file line is the same, byte for byte', lines[0] === lines[1], `${ENGINES[0].id}: ${lines[0]}; node: ${lines[1]}`);
  }
}

// What a run printed, for comparing the twins: the OK line left out, since it
// names each twin's own folder, and every commit hash made one word, since
// each twin's project is its own repository.
const plainLines = (text) => text.replace(/\r/g, '').split('\n').filter((l) => l && !l.startsWith('OK: ')).join('\n').replace(/\b[0-9a-f]{40}(?:[0-9a-f]{24})?\b/g, '<sha>');

// The common real names of secrets stay out, each named on the key-file line
// (2026-10-02), and the everyday names beside them still travel: a template, a
// copy of a public key or of a template, a .bak of an ordinary file, a doc
// about credentials, a folder named credentials. Both twins print the same
// lines for this project.
const SECRET_NAMES = ['serviceAccountKey.json', 'firebase/myapp-firebase-adminsdk-x1y2z-0123456789.json', 'firebase-adminsdk.json',
  'production.env', 'config/secrets.env', '.npmrc', '.pypirc', '.netrc', '.git-credentials', 'keys/AuthKey_ABC123.p8', 'keys/Deploy.PPK',
  'infra/terraform.tfstate', 'infra/terraform.tfstate.backup', 'credentials', '.aws/credentials', '.aws/credentials.bak',
  'ssh/id_rsa.OLD', 'ssh/id_ed25519.bak', 'certs/key.pem.bak', 'certs/key.pem.orig', 'npm/.npmrc.orig'];
const EVERYDAY_NAMES = ['.env.example', 'example.env', 'production.env.example', 'serviceAccountKey.example.json', '.npmrc.example',
  'ssh/id_rsa.pub', 'ssh/id_rsa.pub.bak', 'certs/server.sample.pem.bak', 'notes.bak', 'README.md.orig', 'config.old', 'src/app.js.orig',
  'docs/credentials.md', 'docs/credentials-guide.md', 'docs/credentials/README.md', 'docs/ppk-setup.md', 'src/environment.ts', 'src/env.ts',
  '.gitignore', '.npmignore', '.git-blame-ignore-revs', 'infra/main.tf', 'deck.key'];
function caseSecretNames() {
  const texts = [];
  for (const engine of ENGINES) {
    const label = `${engine.id} secret names`;
    const root = project(engine, 'secret-names', Object.fromEntries([...SECRET_NAMES, ...EVERYDAY_NAMES].map((n) => [n, 'x'])));
    const r = run(engine, root);
    check(`${label}: exits 0`, r.status === 0, r.stderr);
    const zip = okPath(r.stdout);
    if (!zip) continue;
    const z = readZip(zip);
    const want = [...EVERYDAY_NAMES, `project-os/${engine.file}`].sort();
    const kept = SECRET_NAMES.filter((n) => z.names.includes(n));
    check(`${label}: no secret name is in the ZIP`, kept.length === 0, kept.join(', '));
    const lost = EVERYDAY_NAMES.filter((n) => !z.names.includes(n));
    check(`${label}: every everyday name beside them travels`, lost.length === 0, lost.join(', '));
    check(`${label}: exactly the right files are in the ZIP`, z.names.join('|') === want.join('|'), `got ${z.names.join(', ')}`);
    const keys = ((/^Left out as key files \(bring them back by hand on a restore\): (.+?)\r?$/m.exec(r.stdout) || [])[1] || '').split(', ');
    check(`${label}: every secret left out is named on the key-file line`, [...keys].sort().join('|') === [...SECRET_NAMES].sort().join('|'), `got: ${keys.join(', ')}`);
    texts.push(plainLines(r.stdout));
  }
  if (texts.length === 2) {
    check('twins: the same lines for the same project', texts[0] === texts[1], `${ENGINES[0].id}:\n${texts[0]}\nnode:\n${texts[1]}`);
  }
}

// The git a fixture needs, run in the fake project.
function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' });
  if (r.error || r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || '').trim() || (r.error && r.error.message)}`);
  return (r.stdout || '').trim();
}
function gitRepo(root, commit) {
  git(root, 'init', '-q');
  if (!commit) return;
  git(root, 'add', '-A');
  git(root, '-c', 'user.name=Backup test', '-c', 'user.email=backup@test.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'first');
}
// Opens a restored copy's history the way the owner would, with nothing in
// the environment pointing elsewhere.
const gitIn = (dest, ...args) => spawnSync('git', ['-c', 'safe.directory=*', `--git-dir=${path.join(dest, '.git')}`, ...args], { env: GIT_ENV, encoding: 'utf8' });

// The PATH with every folder that holds git taken out, under the name this
// environment already uses for it, or null when git can still be reached.
function pathWithoutGit() {
  const key = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  const gitNames = ['git', 'git.exe', 'git.cmd', 'git.bat', 'git.com'];
  const dirs = (process.env[key] || '').split(path.delimiter).filter((d) => d && !gitNames.some((n) => fs.existsSync(path.join(d, n))));
  const env = { [key]: dirs.join(path.delimiter) };
  const r = spawnSync('git', ['--version'], { env: { ...GIT_ENV, ...env } });
  return !r.error && r.status === 0 ? null : env;
}

const HISTORY_EMPTY = "History check: the snapshot's history opens with git and holds no commit yet.";
const HISTORY_PARTS = 'History check: git was not found, so only the parts git needs were checked: .git/HEAD, .git/objects and .git/refs are in the archive.';

// The history check (2026-10-02). After git gc the refs live in one file and
// .git/refs holds only empty folders; a ZIP of files alone restored a .git git
// would not open, while the run said OK. Each case runs on both twins, and the
// twins must print the same lines.
function caseHistory() {
  const texts = new Map();
  // Git files each object under a folder named by its hash's first two
  // characters, and each twin's project holds its own script, so the hashes,
  // and how many of those folders there are, differ by chance between the two
  // (one run in three failed on it, 2026-10-02). The folder count is left out
  // of the comparison here; every other line, the file count included, stays.
  const keep = (what, text) => texts.set(what, [...(texts.get(what) || []),
    text.replace(/ and \d+ folder\(s\), all \d+ verified/g, ' and <n> folder(s), all <n> verified')]);
  const noGitEnv = pathWithoutGit();
  if (!noGitEnv) console.log('  git is still reachable with every PATH folder that holds it taken out: the no-git history case is skipped.');
  // One ssh key signs the latest commit of each twin's signed project. It sits
  // outside both projects, so neither ZIP has it to leave out.
  let signKey = null;
  if (GIT && SSH_KEYGEN) {
    const keyFile = path.join(BASE, 'signing-key', 'key');
    fs.mkdirSync(path.dirname(keyFile), { recursive: true });
    const k = spawnSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-q', '-f', keyFile], { encoding: 'utf8' });
    const made = !k.error && k.status === 0 && fs.existsSync(keyFile);
    check('(setup) ssh-keygen makes a signing key', made, (k.error && k.error.message) || k.stderr);
    if (made) signKey = keyFile;
  }
  for (const engine of ENGINES) {
    const label = `${engine.id} history`;

    // A .git that lacks a part git needs: the run fails, no git needed.
    const parts = project(engine, 'history-parts', { 'src/a.txt': 'a\n', '.git/HEAD': 'ref: refs/heads/main\n' });
    const rp = run(engine, parts);
    check(`${label}: a .git without objects and refs fails the run`, rp.status === 1 && /^BACKUP FAILED: the snapshot's history would not open/m.test(rp.stderr), rp.stderr || rp.stdout);
    check(`${label}: that failure names each missing part`, /^ {2}- \.git\/objects\/\r?$/m.test(rp.stderr) && /^ {2}- \.git\/refs\/\r?$/m.test(rp.stderr), rp.stderr);
    check(`${label}: that failure leaves nothing in backups/`, listBackups(parts).length === 0, listBackups(parts).join(', '));
    keep('a .git missing parts', plainLines(rp.stderr));

    // Without git, the parts alone are checked, and the run says so.
    if (noGitEnv) {
      const bare = project(engine, 'history-no-git', { 'src/a.txt': 'a\n', '.git/HEAD': 'ref: refs/heads/main\n', '.git/objects/': null, '.git/refs/heads/': null });
      const rn = run(engine, bare, noGitEnv);
      check(`${label}: without git the run passes on the parts`, rn.status === 0 && historyLineOf(rn.stdout) === HISTORY_PARTS, rn.stderr || rn.stdout);
      keep('no git', plainLines(rn.stdout));
    }

    if (!GIT) continue;

    // Right after git gc: .git/refs holds no file, and the history still
    // comes back whole.
    const gc = project(engine, 'history-gc', { 'src/a.txt': 'alpha\n' });
    gitRepo(gc, true);
    git(gc, 'gc', '-q');
    check(`${label}: (setup) git gc left no file under .git/refs`, filesUnder(path.join(gc, '.git', 'refs')).length === 0, filesUnder(path.join(gc, '.git', 'refs')).join(', '));
    const sha = git(gc, 'rev-parse', 'HEAD');
    const rg = run(engine, gc);
    check(`${label}: after git gc the run passes`, rg.status === 0, rg.stderr);
    check(`${label}: after git gc the history opens, at the project's latest commit`,
      historyLineOf(rg.stdout) === `History check: the snapshot's history opens with git, latest commit ${sha}.`, historyLineOf(rg.stdout));
    const zip = okPath(rg.stdout);
    check(`${label}: the history check leaves only the ZIP in backups/`, !!zip && listBackups(gc).join('|') === path.basename(zip), listBackups(gc).join(', '));
    if (zip) {
      const z = readZip(zip);
      const lacking = ['.git/objects/', '.git/refs/', '.git/refs/heads/', '.git/refs/tags/'].filter((n) => !z.folders.includes(n));
      check(`${label}: the ZIP holds the empty refs folders`, lacking.length === 0, lacking.join(', '));
      for (const [reader, open] of outsideReaders()) {
        const dest = fs.mkdtempSync(path.join(BASE, 'restore-'));
        const o = open(zip, dest);
        const log = gitIn(dest, 'log', '-1', '--format=%H');
        check(`${label}: restored with ${reader}, git reads the latest commit`, !o.error && o.status === 0 && log.status === 0 && log.stdout.trim() === sha,
          `${o.stderr || ''} ${log.stderr || ''}`.trim());
      }
    }
    keep('after git gc', plainLines(rg.stdout));

    // A signed latest commit with git set to show signatures (2026-10-02): git
    // log then prints its signature check on the same output as the hash, and
    // the history check failed every run. The setting sits in the project's own
    // config, so the copy taken out of the ZIP carries it too.
    if (signKey) {
      const signed = project(engine, 'history-signed', { 'src/a.txt': 'a\n' });
      git(signed, 'init', '-q');
      git(signed, 'config', 'gpg.format', 'ssh');
      git(signed, 'config', 'user.signingkey', signKey);
      git(signed, 'add', '-A');
      git(signed, '-c', 'user.name=Backup test', '-c', 'user.email=backup@test.invalid', '-c', 'commit.gpgsign=true', 'commit', '-q', '--no-verify', '-m', 'signed');
      git(signed, 'config', 'log.showSignature', 'true');
      const signedSha = git(signed, 'rev-parse', 'HEAD');
      const shown = git(signed, 'log', '-1', '--format=%H');
      check(`${label}: (setup) git log prints more than the signed commit's hash`, shown !== signedSha && shown.endsWith(signedSha), shown);
      const rs = run(engine, signed);
      check(`${label}: a signed latest commit, with signatures shown, passes`, rs.status === 0 &&
        historyLineOf(rs.stdout) === `History check: the snapshot's history opens with git, latest commit ${signedSha}.`, rs.stderr || rs.stdout);
      keep('a signed latest commit, with signatures shown', plainLines(rs.stdout));
    }

    // A branch named like a key file (2026-10-02). The key-file names skip the
    // project's .git, so the branch's ref and its log travel. Left out, the
    // restore lost the branch, and with it checked out the run failed.
    for (const checkedOut of [true, false]) {
      const what = `a branch named fix/credentials, ${checkedOut ? 'checked out' : 'not checked out'}`;
      const cred = project(engine, `history-credentials-${checkedOut ? 'on' : 'off'}`, { 'src/a.txt': 'a\n' });
      gitRepo(cred, true);
      git(cred, 'checkout', '-q', '-b', 'fix/credentials');
      fs.writeFileSync(path.join(cred, 'src', 'b.txt'), 'b\n');
      git(cred, 'add', '-A');
      git(cred, '-c', 'user.name=Backup test', '-c', 'user.email=backup@test.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'second');
      const branchSha = git(cred, 'rev-parse', 'HEAD');
      if (!checkedOut) git(cred, 'checkout', '-q', '-');
      const headSha = git(cred, 'rev-parse', 'HEAD');
      const rc = run(engine, cred);
      check(`${label}: ${what}, passes at the project's latest commit`, rc.status === 0 &&
        historyLineOf(rc.stdout) === `History check: the snapshot's history opens with git, latest commit ${headSha}.`, rc.stderr || rc.stdout);
      check(`${label}: ${what}, names no key file`, !/^Left out as key files/m.test(rc.stdout), rc.stdout);
      const czip = okPath(rc.stdout);
      if (czip) {
        const z = readZip(czip);
        const lacking = ['.git/refs/heads/fix/credentials', '.git/logs/refs/heads/fix/credentials'].filter((n) => !z.names.includes(n));
        check(`${label}: ${what}, its ref and its log are in the ZIP`, lacking.length === 0, lacking.join(', '));
        check(`${label}: ${what}, its ref in the ZIP names its commit`, z.content('.git/refs/heads/fix/credentials').trim() === branchSha,
          z.content('.git/refs/heads/fix/credentials'));
      }
      keep(what, plainLines(rc.stdout));
    }

    // A fresh git init: no commit yet, and its empty refs folders still come
    // back, so the restore is a repository.
    const unborn = project(engine, 'history-unborn', { 'src/a.txt': 'a\n' });
    gitRepo(unborn, false);
    const ru = run(engine, unborn);
    check(`${label}: a project with no commit yet passes`, ru.status === 0 && historyLineOf(ru.stdout) === HISTORY_EMPTY, ru.stderr || ru.stdout);
    const uzip = okPath(ru.stdout);
    const [first] = outsideReaders();
    if (uzip && first) {
      const dest = fs.mkdtempSync(path.join(BASE, 'restore-'));
      first[1](uzip, dest);
      const opens = gitIn(dest, 'rev-parse', '--git-dir');
      check(`${label}: restored with ${first[0]}, git opens a project with no commit yet`, opens.status === 0, opens.stderr);
    }
    keep('no commit yet', plainLines(ru.stdout));

    // A ref that names a commit the history does not hold: git cannot read
    // the latest commit, so the run fails.
    const broken = project(engine, 'history-broken', { 'src/a.txt': 'a\n', '.git/HEAD': 'ref: refs/heads/main\n',
      '.git/refs/heads/main': `${'1234567890'.repeat(4)}\n`, '.git/objects/': null });
    const rb = run(engine, broken);
    check(`${label}: a latest commit git cannot read fails the run`, rb.status === 1 && /^BACKUP FAILED: the snapshot's latest commit cannot be read back with git/m.test(rb.stderr), rb.stderr || rb.stdout);
    check(`${label}: that failure leaves nothing in backups/`, listBackups(broken).length === 0, listBackups(broken).join(', '));
    keep('a commit that is not there', plainLines(rb.stderr));

    // A HEAD git cannot read in the project itself: the snapshot is as good
    // as its source, so the run passes on the parts and says why.
    const unreadable = project(engine, 'history-unreadable', { 'src/a.txt': 'a\n', '.git/HEAD': 'not a ref\n', '.git/objects/': null, '.git/refs/heads/': null });
    const rr = run(engine, unreadable);
    check(`${label}: a history git cannot open in the project either passes on the parts`, rr.status === 0 &&
      historyLineOf(rr.stdout) === "History check: git cannot open this project's own history either, so only the parts git needs were checked: .git/HEAD, .git/objects and .git/refs are in the archive.",
    rr.stderr || rr.stdout);
    keep('a history git cannot open anywhere', plainLines(rr.stdout));
  }
  for (const [what, list] of texts) {
    if (list.length === 2) check(`twins: the same lines for ${what}`, list[0] === list[1], `${ENGINES[0].id}:\n${list[0]}\nnode:\n${list[1]}`);
  }
}

try {
  caseSameExcludeList();
  caseSameKeyFiles();
  for (const engine of ENGINES) {
    caseWhatGoesIn(engine);
    caseWorktree(engine);
    caseSameMinuteReplaced(engine);
    await caseRenameBlocked(engine);
  }
  caseKeyLineOrder();
  caseSecretNames();
  caseHistory();
  caseZip64();
} catch (e) {
  failures++;
  console.error(`FAIL the suite itself threw: ${e.stack || e.message}`);
} finally {
  // Removed here, before the count, so a folder that would not go is counted
  // as a failure; the exit and signal handlers above cover every other end.
  check('the fake projects are removed', removeBase(), BASE);
}

const ran = `${ENGINES.map((e) => e.id).join(' + ')}${TAR ? `; tar: ${path.basename(TAR)}` : ''}${GIT ? '; git' : '; no git'}`;
if (failures > 0) {
  console.error(`Backup-script-tests.mjs: ${failures} of ${checks} checks FAILED (${ran})`);
  process.exit(1);
}
console.log(`Backup-script-tests.mjs: all ${checks} checks passed (${ran})`);
