// Backup-whole-project.mjs - one local, self-contained ZIP snapshot of the whole
// project, the Node twin of Backup-whole-project.ps1.
//
// Why this exists: offline disaster recovery that does NOT depend on any git
// host or sync folder. Code, docs, content and the full git history in one
// file you can put on a drive; regenerable build folders are left out so the
// ZIP stays small and restorable. Node so a machine without PowerShell makes
// the same snapshot; the ZIP is written with Node's own zlib, so nothing has
// to be installed.
//
// TWIN. Backup-whole-project.ps1 does exactly this in PowerShell. The two keep
// the same setup block, the same exclusions, the same ZIP name, the same
// messages (here a detail line puts a colon between a path and its reason)
// and the same failure contract, so a change to one is made to the other in
// the same edit (2026-10-01).
//
// Run it, from the project root:
//   node project-os/Backup-whole-project.mjs
// It makes the same snapshot as the `Go backup` shortcut in CLAUDE.md.
//
// FAILURE CONTRACT. This script has exactly two outcomes:
//   success  -> exit 0, a `<project>_<stamp>.zip` exists in backups/, and every
//               file the walk found is listed in that archive by name. Names
//               are checked, not contents: a damaged entry is not caught.
//   failure  -> exit 1, the reason on stderr, and no ZIP from this run left
//               behind (a ZIP of the same name from an EARLIER run can be).
// There is deliberately no third "mostly worked" outcome. A backup that quietly
// skipped a locked file or an unreadable folder is the one kind that hurts you,
// because the gap shows up only when you are already restoring.
// On success it also prints "Left out by name:", every folder the walk skipped
// because of its name. A source folder on that line means the list below needs
// changing.
//
// WHAT IS NEVER IN THE ZIP, whatever the list below says: the backups/ and .tmp/
// (scratch) folders at the project root, the assistant's personal settings
// (.claude/settings.local.json and its .backup copy, which can hold keys and
// this machine's paths), its worktree copies (.claude/worktrees, whole copies
// of the repository), the .codex folder at any depth, atomic-write leftovers
// (*.tmp, *.tmp.*), and the env files (.env*, .dev.vars*; a template such as
// .env.example, .env.sample or .dev.vars.template is kept), so a restore
// recreates them by hand from the templates. The rest of .claude travels: the
// committed settings.json, which can carry the team's guard wiring, and the
// project's own commands, agents and skills. Common key files stay out too, by
// name (KEY_FILE_PATTERNS below). A secret saved under any other name travels
// in the ZIP, so keep those outside the project. Names compare without regard
// to case, as PowerShell's -contains and -like do in the twin.
//
// A git worktree or submodule is refused: its .git is a file pointing at
// history kept in another folder, so the ZIP would hold no history. Commit
// there, then run this from the main project folder.
//
// ONE DIFFERENCE THE PLATFORM FORCES. On Windows the twin opens each file so
// that no other program may write to it meanwhile, and fails on a file another
// program holds open for writing. Node cannot ask for that, so this twin reads
// each file's size and modification time before and after copying it, and
// fails the same loud way when either moved.
//
// THE ZIP WRITER uses Node built-ins only. Each file is deflated through zlib
// and its CRC-32 comes from the table below; a large file is streamed, never
// held whole in memory: the local header goes first, the deflated bytes follow,
// and the CRC and sizes are patched into the header in place. ZIP64 records
// are written whenever a size, an offset or the entry count passes its 32-bit
// or 16-bit field. Names are UTF-8 (flag bit 11) with forward slashes, and
// each entry carries its file's modification time. On macOS and Linux it also
// carries the file's permission bits, so a restored script stays executable,
// as it does from the twin under pwsh. PROJECTOS_FORCE_ZIP64=1 writes every
// record in its ZIP64 form, so the kit's tests reach that path with a tiny
// project; it changes nothing about what goes in.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

// This file sits in project-os/, one level below the project root.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// --- Setup block: check this list against the stack at install ---------------
// Folders that never belong in a restore snapshot because they are regenerated
// from what IS in it (dependencies, build output, caches). The walk prunes them
// as it descends, so it never even enters them. A listed name is skipped at
// EVERY depth, so a source folder such as src/dist is skipped too; the
// "Left out by name" line of each run shows what was. Add the stack's own;
// remove a name only if this project commits that folder on purpose. Add '.git'
// here for a smaller, working-tree-only ZIP without the history.
// The install adds build, target or any other output folder only when this project's own tools write output there.
const EXCLUDE_DIRS = [
  'node_modules',  // npm / pnpm / yarn dependencies
  'dist',          // build output
  '.next',         // Next.js output and cache
  '.nuxt',         // Nuxt output and cache
  '.astro',        // Astro generated types and cache
  '.svelte-kit',   // SvelteKit output and cache
  '.cache',        // generic tool cache
  'coverage',      // test coverage output
  '.venv',         // Python virtualenvs
  '__pycache__',   // Python bytecode
];
// --- End of setup block -------------------------------------------------------

const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();
const listHas = (list, name) => list.some((x) => sameName(x, name));

// The ZIP name: the project folder's leaf, spaces to underscores so the filename
// is safe everywhere.
const repoName = path.basename(root).replace(/\s+/g, '_');

// Forced regardless of the list above: the .codex folder at any depth, the
// assistant's worktree copies under .claude, and at the project root only, the
// backup output (never nest the ZIP inside itself) and the scratch folder.
// Those are per-machine state; a restore recreates them. Forced so the secrets
// and local-state posture cannot be widened by editing the list. A folder
// called backups or .tmp deeper down is ordinary project content and travels.
for (const force of ['.codex']) {
  if (!listHas(EXCLUDE_DIRS, force)) EXCLUDE_DIRS.push(force);
}
const ROOT_ONLY_DIRS = ['backups', '.tmp'];
// Inside any .claude folder: the personal settings file and its backup copy
// stay on this machine, and the worktrees folder is left out.
const CLAUDE_LOCAL_FILES = ['settings.local.json', 'settings.local.json.backup', 'settings.json.backup'];
const CLAUDE_LOCAL_DIRS = ['worktrees'];
// Common key files stay on this machine too, by name (owner, 2026-10-01):
// a certificate or private key store (.pem, .p12, .pfx, .jks, .keystore), an
// SSH private key (id_rsa, id_dsa, id_ecdsa, id_ed25519, and the same with a
// suffix such as id_rsa_work, since ssh-keygen users name one key per host)
// and a cloud credentials file (credentials, client secret and service
// account JSON). An SSH public key (.pub) is not a secret and travels.
// Forced like the lists above, so editing the setup block cannot widen it. A
// run names every key file it left out, since a restore has to bring them
// back by hand. A secret saved under any other name still travels.
// A Keynote deck ends in .key, so that ending is deliberately not listed.
const KEY_FILE_PATTERNS = ['*.pem', '*.p12', '*.pfx', '*.jks', '*.keystore', 'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', 'id_rsa_*', 'id_dsa_*', 'id_ecdsa_*', 'id_ed25519_*', '*credentials*.json', 'client_secret*.json', '*service-account*.json', '*service_account*.json'];
const PUBLIC_KEY_PATTERNS = ['*.pub'];
// A template travels, key file and env file alike (2026-10-01): a name whose
// last dot-separated part, or the part just before its ending, is one of
// these words, so .env.sample, .env.production.example and
// credentials.example.json all go in. The word has to be a whole part at the
// end of the name. A test for the word anywhere let a real certificate such
// as www.example.com.pem or tls.sample-site.pem into the ZIP unnamed.
// Compared after lowering the name, exactly, as the twin does.
const TEMPLATE_WORDS = ['example', 'sample', 'template'];
const isTemplate = (name) => name.toLowerCase().split('.').slice(-2).some((part) => TEMPLATE_WORDS.includes(part));
// The same wildcards PowerShell's -like reads: * is any run of characters,
// everything else is itself, and case is ignored.
const like = (pattern) => new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
const KEY_FILE_RES = KEY_FILE_PATTERNS.map(like);
const PUBLIC_KEY_RES = PUBLIC_KEY_PATTERNS.map(like);
const isKeyFile = (name) => !isTemplate(name) && !PUBLIC_KEY_RES.some((re) => re.test(name)) && KEY_FILE_RES.some((re) => re.test(name));

// The key-file line prints in one order on every machine and in both twins:
// ASCII letters compared without case, every other character by its UTF-16
// code unit, and the exact name breaking a tie. localeCompare sorted by its
// own collation and the twin's Sort-Object by the machine's culture, so the
// same key files printed in two orders (2026-10-01). The sort key is the
// folded name, a NUL that no file name holds, then the name itself, compared
// by code unit as JavaScript's < does.
const nameSortKey = (s) => `${s.replace(/[a-z]/g, (c) => c.toUpperCase())}\u0000${s}`;
const sortNames = (list) => list.map((s) => [nameSortKey(s), s])
  .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  .map(([, s]) => s);

const pad2 = (n) => String(n).padStart(2, '0');
const now = new Date();
const stamp = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}_${pad2(now.getHours())}-${pad2(now.getMinutes())}`;
const backups = path.join(root, 'backups');
const zipPath = path.join(backups, `${repoName}_${stamp}.zip`);

// Everything below writes to a PARTIAL name and only renames to the real .zip
// once the archive has been proved complete. A file called
// `<project>_<stamp>.zip` therefore means "verified"; a failed run never leaves
// one of its own, so a later restore can never pick up a half-written snapshot
// believing it is good.
const partial = `${zipPath}.partial`;

// A failure is thrown, not exited on the spot, so the archive handle is closed
// and every line of the report is flushed before the process ends.
class BackupFailure extends Error {
  constructor(summary, details) {
    super(summary);
    this.summary = summary;
    this.details = details;
  }
}
function stopWithFailure(summary, details = []) {
  throw new BackupFailure(summary, details);
}

// The ZIP writer.

const FORCE_ZIP64 = process.env.PROJECTOS_FORCE_ZIP64 === '1';
const MAX16 = 0xFFFF;
const MAX32 = 0xFFFFFFFF;
const UTF8_NAMES = 0x0800;                // general purpose flag bit 11
const HOST = process.platform === 'win32' ? 0 : 3; // 0 MS-DOS, 3 Unix: whose attribute bits travel
const MADE_BY = HOST * 256 + 45;          // spec version 4.5, the one with ZIP64
const STREAM_FROM = 1024 * 1024;          // files this big and up are streamed
const STREAM_CHUNK = 1024 * 1024;

// CRC-32 (the ZIP polynomial, reflected), from its own table so it does not
// depend on zlib.crc32, which older Node versions lack.
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(crc, buf) {
  let c = (crc ^ 0xFFFFFFFF) >>> 0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// The most deflate can ever grow its input, zlib's bound for any settings.
// Plain arithmetic, not shifts: JavaScript shifts cut a number to 32 bits.
const deflateBound = (n) => n + Math.ceil(n / 8) + Math.ceil(n / 64) + 5;

// DOS date and time, in local time as the twin writes them, clamped to the
// range the format can hold (1980 to 2107).
function dosDateTime(date) {
  let y = date.getFullYear();
  let d = date;
  if (y < 1980) d = new Date(1980, 0, 1, 0, 0, 0);
  else if (y > 2107) d = new Date(2107, 11, 31, 23, 59, 58);
  y = d.getFullYear();
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

let zipFd = null;
let pos = 0;
const central = [];

function writeAt(buf, at) {
  let done = 0;
  while (done < buf.length) done += fs.writeSync(zipFd, buf, done, buf.length - done, at + done);
}
function closeZip() {
  if (zipFd === null) return;
  try { fs.closeSync(zipFd); } catch { /* already gone; the failure report says why */ }
  zipFd = null;
}
const changedError = () => new Error('the file changed while it was being read, so the copy would match no single moment of it');

// A small file is read in one go, into a buffer one byte longer than its size,
// so a file that grew meanwhile is caught without ever reading more than that.
function readSmall(fd, size) {
  const buf = Buffer.alloc(size + 1);
  let got = 0;
  while (got < buf.length) {
    const n = fs.readSync(fd, buf, got, buf.length - got, got);
    if (n === 0) break;
    got += n;
  }
  if (got !== size) throw changedError();
  return buf.subarray(0, size);
}

async function addEntry(full, rel) {
  const name = Buffer.from(rel, 'utf8');
  if (name.length > MAX16) throw new Error('the path is too long for a ZIP entry name');
  // Checked before opening: opening a pipe would wait forever for a writer.
  if (!fs.statSync(full).isFile()) throw new Error('not a regular file (a pipe, socket or device), so it cannot be copied');
  const fd = fs.openSync(full, 'r');
  const start = pos;
  try {
    const before = fs.fstatSync(fd);
    const size = before.size;
    // The local header has no room to grow later, so its ZIP64 field is
    // decided now, from the largest the data could become.
    const local64 = FORCE_ZIP64 || deflateBound(size) >= MAX32;
    const entry64 = local64 || start >= MAX32;
    const { time, date } = dosDateTime(before.mtime);
    const header = Buffer.alloc(30 + name.length + (local64 ? 20 : 0));
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(entry64 ? 45 : 20, 4);
    header.writeUInt16LE(UTF8_NAMES, 6);
    header.writeUInt16LE(8, 8);              // deflate
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    // CRC and sizes (14 to 25) are patched in once the data is written.
    if (local64) {
      header.writeUInt32LE(MAX32, 18);
      header.writeUInt32LE(MAX32, 22);
    }
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(local64 ? 20 : 0, 28);
    name.copy(header, 30);
    if (local64) {
      header.writeUInt16LE(0x0001, 30 + name.length); // the ZIP64 extra field
      header.writeUInt16LE(16, 32 + name.length);     // both sizes, filled in below
    }
    writeAt(header, start);
    pos = start + header.length;

    let crc = 0;
    let usize = 0;
    let csize = 0;
    if (size < STREAM_FROM) {
      const data = readSmall(fd, size);
      crc = crc32(0, data);
      usize = data.length;
      const out = zlib.deflateRawSync(data);
      writeAt(out, pos);
      pos += out.length;
      csize = out.length;
    } else {
      await pipeline(
        fs.createReadStream(full, { fd, autoClose: false, start: 0, highWaterMark: STREAM_CHUNK }),
        async function* (source) {
          for await (const chunk of source) {
            crc = crc32(crc, chunk);
            usize += chunk.length;
            yield chunk;
          }
        },
        zlib.createDeflateRaw(),
        async (source) => {
          for await (const out of source) {
            writeAt(out, pos);
            pos += out.length;
            csize += out.length;
          }
        },
      );
    }
    const after = fs.fstatSync(fd);
    if (usize !== size || after.size !== size || after.mtimeMs !== before.mtimeMs) throw changedError();
    if (!local64 && (usize >= MAX32 || csize >= MAX32)) throw changedError();

    if (local64) {
      const c = Buffer.alloc(4);
      c.writeUInt32LE(crc, 0);
      writeAt(c, start + 14);
      const z = Buffer.alloc(16);
      z.writeBigUInt64LE(BigInt(usize), 0);
      z.writeBigUInt64LE(BigInt(csize), 8);
      writeAt(z, start + 30 + name.length + 4);
    } else {
      const p = Buffer.alloc(12);
      p.writeUInt32LE(crc, 0);
      p.writeUInt32LE(csize, 4);
      p.writeUInt32LE(usize, 8);
      writeAt(p, start + 14);
    }
    // Unix keeps the permission bits in the top half, marked a regular file;
    // the MS-DOS form carries no bits the restore would need.
    const attrs = HOST === 3 ? (0o100000 | (before.mode & 0o7777)) * 65536 : 0;
    central.push({ name, crc, usize, csize, offset: start, time, date, entry64, attrs });
  } catch (e) {
    // The next entry overwrites whatever this one left; the run fails anyway.
    pos = start;
    throw e;
  } finally {
    fs.closeSync(fd);
  }
}

function finishArchive() {
  const cdStart = pos;
  let batch = [];
  let batchLen = 0;
  const flush = () => {
    if (batchLen === 0) return;
    const b = Buffer.concat(batch, batchLen);
    writeAt(b, pos);
    pos += b.length;
    batch = [];
    batchLen = 0;
  };
  for (const e of central) {
    // A ZIP64 field appears only for the values that do not fit, in this
    // fixed order: uncompressed size, compressed size, local header offset.
    const big = [FORCE_ZIP64 || e.usize >= MAX32, FORCE_ZIP64 || e.csize >= MAX32, FORCE_ZIP64 || e.offset >= MAX32];
    const count64 = big.filter(Boolean).length;
    const extraLen = count64 ? 4 + 8 * count64 : 0;
    const h = Buffer.alloc(46 + e.name.length + extraLen);
    h.writeUInt32LE(0x02014b50, 0);
    h.writeUInt16LE(MADE_BY, 4);
    h.writeUInt16LE(e.entry64 ? 45 : 20, 6);
    h.writeUInt16LE(UTF8_NAMES, 8);
    h.writeUInt16LE(8, 10);
    h.writeUInt16LE(e.time, 12);
    h.writeUInt16LE(e.date, 14);
    h.writeUInt32LE(e.crc, 16);
    h.writeUInt32LE(big[1] ? MAX32 : e.csize, 20);
    h.writeUInt32LE(big[0] ? MAX32 : e.usize, 24);
    h.writeUInt16LE(e.name.length, 28);
    h.writeUInt16LE(extraLen, 30);
    // 32 comment length, 34 disk number, 36 internal attributes: all zero.
    h.writeUInt32LE(e.attrs, 38);
    h.writeUInt32LE(big[2] ? MAX32 : e.offset, 42);
    e.name.copy(h, 46);
    if (count64) {
      let x = 46 + e.name.length;
      h.writeUInt16LE(0x0001, x);
      h.writeUInt16LE(8 * count64, x + 2);
      x += 4;
      for (const [i, v] of [e.usize, e.csize, e.offset].entries()) {
        if (!big[i]) continue;
        h.writeBigUInt64LE(BigInt(v), x);
        x += 8;
      }
    }
    batch.push(h);
    batchLen += h.length;
    if (batchLen >= STREAM_CHUNK) flush();
  }
  flush();

  const cdSize = pos - cdStart;
  const count = central.length;
  const countBig = FORCE_ZIP64 || count >= MAX16;
  const sizeBig = FORCE_ZIP64 || cdSize >= MAX32;
  const offsetBig = FORCE_ZIP64 || cdStart >= MAX32;
  if (countBig || sizeBig || offsetBig) {
    const z = Buffer.alloc(56 + 20);
    z.writeUInt32LE(0x06064b50, 0);          // ZIP64 end of central directory
    z.writeBigUInt64LE(44n, 4);              // its size after these 12 bytes
    z.writeUInt16LE(MADE_BY, 12);
    z.writeUInt16LE(45, 14);
    // 16 this disk, 20 the disk the directory starts on: both zero.
    z.writeBigUInt64LE(BigInt(count), 24);
    z.writeBigUInt64LE(BigInt(count), 32);
    z.writeBigUInt64LE(BigInt(cdSize), 40);
    z.writeBigUInt64LE(BigInt(cdStart), 48);
    z.writeUInt32LE(0x07064b50, 56);         // its locator
    z.writeUInt32LE(0, 60);
    z.writeBigUInt64LE(BigInt(pos), 64);
    z.writeUInt32LE(1, 72);                  // one disk in all
    writeAt(z, pos);
    pos += z.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(countBig ? MAX16 : count, 8);
  end.writeUInt16LE(countBig ? MAX16 : count, 10);
  end.writeUInt32LE(sizeBig ? MAX32 : cdSize, 12);
  end.writeUInt32LE(offsetBig ? MAX32 : cdStart, 16);
  writeAt(end, pos);
  pos += end.length;
}

// The read-back reader: the end record (and its ZIP64 form when the plain one
// says so), then every central directory header, read in chunks from disk.
function readExact(fd, length, at) {
  const buf = Buffer.alloc(length);
  let got = 0;
  while (got < length) {
    const n = fs.readSync(fd, buf, got, length - got, at + got);
    if (n === 0) throw new Error('the archive ends early');
    got += n;
  }
  return buf;
}
function archiveNames(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const tailLen = Math.min(size, 22 + MAX16);
    const tailAt = size - tailLen;
    const tail = readExact(fd, tailLen, tailAt);
    let e = -1;
    for (let i = tailLen - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) { e = i; break; }
    }
    if (e < 0) throw new Error('no end of central directory record');
    let count = tail.readUInt16LE(e + 10);
    let cdSize = tail.readUInt32LE(e + 12);
    let cdStart = tail.readUInt32LE(e + 16);
    if (count === MAX16 || cdSize === MAX32 || cdStart === MAX32) {
      const locAt = tailAt + e - 20;
      if (locAt < 0) throw new Error('the ZIP64 locator is missing');
      const loc = readExact(fd, 20, locAt);
      if (loc.readUInt32LE(0) !== 0x07064b50) throw new Error('the ZIP64 locator is missing');
      const z = readExact(fd, 56, Number(loc.readBigUInt64LE(8)));
      if (z.readUInt32LE(0) !== 0x06064b50) throw new Error('the ZIP64 end of central directory record is missing');
      count = Number(z.readBigUInt64LE(32));
      cdSize = Number(z.readBigUInt64LE(40));
      cdStart = Number(z.readBigUInt64LE(48));
    }
    const cdEnd = cdStart + cdSize;
    if (cdEnd > size) throw new Error('the central directory runs past the end of the file');
    const names = new Set();
    let buf = Buffer.alloc(0);
    let bufAt = cdStart;
    let p = cdStart;
    const need = (n) => {
      if (p + n > cdEnd) throw new Error('the central directory is shorter than its end record says');
      if (p + n <= bufAt + buf.length) return;
      bufAt = p;
      buf = readExact(fd, Math.min(cdEnd - p, Math.max(n, STREAM_CHUNK)), p);
    };
    for (let i = 0; i < count; i++) {
      need(46);
      let o = p - bufAt;
      if (buf.readUInt32LE(o) !== 0x02014b50) throw new Error(`central directory entry ${i + 1} of ${count} is damaged`);
      const flags = buf.readUInt16LE(o + 8);
      const nameLen = buf.readUInt16LE(o + 28);
      const total = 46 + nameLen + buf.readUInt16LE(o + 30) + buf.readUInt16LE(o + 32);
      need(total);
      o = p - bufAt;
      names.add(buf.toString(flags & UTF8_NAMES ? 'utf8' : 'latin1', o + 46, o + 46 + nameLen));
      p += total;
    }
    return names;
  } finally {
    fs.closeSync(fd);
  }
}

// The walk.

const enumErrors = [];
const pruned = [];
const keyFiles = [];
const files = [];
const relOf = (full) => path.relative(root, full).split(path.sep).join('/');

// A link counts as what it points at, as Get-ChildItem shows it to the twin.
function isFolder(dirent, full) {
  if (dirent.isDirectory()) return true;
  if (!dirent.isSymbolicLink()) return false;
  try { return fs.statSync(full).isDirectory(); } catch { return false; }
}

function walk(dir) {
  // Enumeration failure is FATAL, never silent. An unreadable directory
  // (permissions, a sync-client lock, a path too long) would otherwise yield
  // zero entries for its ENTIRE subtree, recorded nowhere, while the script
  // still printed OK. A silently short ZIP is worse than no ZIP, because it is
  // trusted.
  let dirents;
  try {
    dirents = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    enumErrors.push(`${dir}: ${e.message}`);
    return;
  }
  const inClaude = sameName(path.basename(dir), '.claude');
  // Folders first, then files, each by name: the order the twin walks in.
  const entries = dirents.map((d) => {
    const full = path.join(dir, d.name);
    const folder = isFolder(d, full);
    return { name: d.name, full, folder, key: `${folder ? 0 : 1}${d.name.toLowerCase()}` };
  }).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const entry of entries) {
    if (entry.folder) {
      if (listHas(EXCLUDE_DIRS, entry.name) ||
          (dir === root && listHas(ROOT_ONLY_DIRS, entry.name)) ||
          (inClaude && listHas(CLAUDE_LOCAL_DIRS, entry.name))) {
        // Recorded, so a skipped source folder shows in the output.
        pruned.push(relOf(entry.full));
        continue;
      }
      walk(entry.full);
      continue;
    }
    const lower = entry.name.toLowerCase();
    // The assistant's personal settings stay on this machine.
    if (inClaude && listHas(CLAUDE_LOCAL_FILES, entry.name)) continue;
    // Atomic-write leftovers.
    if (lower.endsWith('.tmp') || lower.includes('.tmp.')) continue;
    // Env files and the common key files stay on this machine; the
    // templates travel. A secret under any other name still goes in.
    if ((lower.startsWith('.env') || lower.startsWith('.dev.vars')) && !isTemplate(entry.name)) continue;
    if (isKeyFile(entry.name)) { keyFiles.push(relOf(entry.full)); continue; }
    files.push({ full: entry.full, rel: relOf(entry.full) });
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  try {
    fs.mkdirSync(backups, { recursive: true });
  } catch (e) {
    stopWithFailure('the backups folder could not be created', [e.message]);
  }
  try {
    fs.rmSync(partial, { force: true });
  } catch (e) {
    stopWithFailure('a leftover partial archive from an earlier run could not be removed', [e.message]);
  }

  // A .git FILE (not a folder) means a git worktree or submodule: its history
  // lives in another folder, so a ZIP of this one would hold no history. Unless
  // the setup block left .git out on purpose (a working-tree-only ZIP).
  const dotGit = path.join(root, '.git');
  let gitIsFile = false;
  try { gitIsFile = fs.statSync(dotGit).isFile(); } catch { /* no .git at all */ }
  if (!listHas(EXCLUDE_DIRS, '.git') && gitIsFile) {
    let pointer = '';
    try {
      let text = fs.readFileSync(dotGit, 'utf8');
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // a byte order mark, as Get-Content drops it
      pointer = text.split(/\r\n|\r|\n/)[0];
    } catch { /* named as empty */ }
    pointer = pointer.replace(/^gitdir:\s*/i, '');
    stopWithFailure("this folder's .git is a file that points elsewhere (a git worktree or submodule), so a ZIP of it would hold no history",
      [`history lives in: ${pointer}`, 'commit the work here, then run Go backup from the main project folder']);
  }

  walk(root);

  if (enumErrors.length > 0) {
    stopWithFailure(`could not read ${enumErrors.length} directory/ies, so the file list is incomplete`, enumErrors);
  }
  if (files.length === 0) {
    stopWithFailure('walked the project and found no files at all', [`root: ${root}`]);
  }

  // Expected contents, decided BEFORE writing so they can be compared against
  // what the archive actually ended up holding.
  const expected = new Set(files.map((f) => f.rel));

  let added = 0;
  const skipped = [];
  try {
    zipFd = fs.openSync(partial, 'wx');
  } catch (e) {
    stopWithFailure('the archive could not be created', [e.message]);
  }
  for (const f of files) {
    try {
      await addEntry(f.full, f.rel);
      added++;
    } catch (e) {
      // A locked file is fatal like any other omission: a snapshot missing
      // a file is not a snapshot.
      skipped.push(`${f.rel}: ${e.message}`);
    }
  }
  try {
    finishArchive();
  } catch (e) {
    stopWithFailure('the archive could not be finished', [e.message]);
  } finally {
    closeZip();
  }

  if (skipped.length > 0) {
    stopWithFailure(`${skipped.length} file(s) could not be added (locked or unreadable)`, skipped);
  }

  // Independent read-back: trust what the archive HOLDS, not what the writer
  // thought it wrote. Catches a missing entry, an archive a mid-write crash left
  // unreadable, and any entry-name mangling. It reads names only: an entry whose
  // content was damaged still passes, and so does anything the walk itself
  // skipped, since the expected list comes from that same walk.
  let actual;
  try {
    actual = archiveNames(partial);
  } catch (e) {
    stopWithFailure('the finished archive could not be re-opened for verification', [e.message]);
  }

  const missing = [...expected].filter((rel) => !actual.has(rel));
  if (missing.length > 0) {
    stopWithFailure(`${missing.length} expected file(s) are absent from the finished archive`, missing);
  }

  // The rename is checked like every other step: a failed one would print OK
  // over an older ZIP of the same name, or over no ZIP at all. Another program
  // can hold the name for a moment, so it is retried before it fails.
  let moved = false;
  let lastErr = '';
  for (let i = 0; i < 5 && !moved; i++) {
    try {
      fs.renameSync(partial, zipPath);
      moved = true;
    } catch (e) {
      lastErr = e.message;
      await sleep(500);
    }
  }
  if (!moved || !fs.existsSync(zipPath)) {
    stopWithFailure('the verified archive could not be renamed to its final name',
      [lastErr, `Any ${zipPath} already in backups is from an EARLIER run and does not hold this run's changes. Close whatever has it open and re-run.`]);
  }

  console.log(`OK: ${zipPath}`);
  console.log(`Added ${added} file(s), all ${actual.size} verified present in the archive by name.`);
  if (pruned.length > 0) {
    console.log(`Left out by name: ${sortNames(pruned).join(', ')}`);
  }
  if (keyFiles.length > 0) {
    console.log(`Left out as key files (bring them back by hand on a restore): ${sortNames(keyFiles).join(', ')}`);
  }
}

try {
  await main();
} catch (e) {
  const f = e instanceof BackupFailure ? e : new BackupFailure('the script stopped on an unexpected error', [(e && e.stack) || String(e)]);
  closeZip();
  console.error(`BACKUP FAILED: ${f.summary}`);
  for (const d of f.details) console.error(`  - ${d}`);
  console.error('No .zip was produced. Nothing here is a usable snapshot - fix the cause and re-run.');
  try { fs.rmSync(partial, { force: true }); } catch { /* reported above; the name says partial */ }
  process.exitCode = 1;
}
