// heavy.mjs - lists the heavy files and folders in the project, so the owner
// can decide what to delete. It deletes nothing, ever.
//
// Why: a project quietly grows ten- and twenty-gigabyte things nobody needs, a
// stray download, a partial archive, a cache, a build folder, and nobody sees
// them until the disk is full. This prints them with their size and what kind
// of thing each one is, and the owner deletes, or says the word. Wired into
// `Go commit` (CLAUDE.md), and runnable any time:
//
//   node project-os/heavy.mjs            everything over 1 GB
//   node project-os/heavy.mjs --min 200mb
//   node project-os/heavy.mjs --root <folder>
//
// Output, one line each, largest first:
//   <size>  <kind>  <path>
// kinds: regenerable (dependencies, build output, caches; safe to delete and
// rebuilt by a command), backups (the kit's own snapshots; delete the old
// ones by hand), git (the repository's history; never delete), leftover
// (anything else this big; the owner decides). Exit code is always 0; a
// folder it cannot read is reported, not skipped silently.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}
function parseSize(s) {
  const m = /^(\d+(?:\.\d+)?)\s*(gb|mb|kb|b)?$/i.exec(String(s).trim());
  if (!m) return 1024 ** 3;
  const n = parseFloat(m[1]);
  const unit = (m[2] || 'b').toLowerCase();
  return Math.round(n * ({ gb: 1024 ** 3, mb: 1024 ** 2, kb: 1024, b: 1 })[unit]);
}
const ROOT = path.resolve(flag('--root', process.cwd()));
const MIN = parseSize(flag('--min', '1gb'));

const REGENERABLE = new Set(['node_modules', 'dist', 'build', 'out', '.next', '.nuxt', '.astro', '.svelte-kit',
  '.cache', '.parcel-cache', '.turbo', 'coverage', '.venv', 'venv', '__pycache__', 'target', '.tmp', 'tmp']);

function kindOf(rel) {
  const top = rel.split('/')[0];
  if (top === '.git') return 'git';
  if (top === 'backups') return 'backups';
  if (rel.split('/').some((seg) => REGENERABLE.has(seg))) return 'regenerable';
  return 'leftover';
}

const bigFiles = [];
const unreadable = [];
const topSizes = new Map();

function walk(dir, top) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (err) { unreadable.push(`${dir}: ${err.message}`); return 0; }
  let total = 0;
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) { total += walk(full, top); continue; }
    if (!e.isFile()) continue;
    let size = 0;
    try { size = fs.statSync(full).size; } catch { continue; }
    total += size;
    if (size >= MIN) bigFiles.push({ size, rel: path.relative(ROOT, full).replace(/\\/g, '/') });
  }
  return total;
}

let rootEntries;
try { rootEntries = fs.readdirSync(ROOT, { withFileTypes: true }); } catch (err) {
  console.log(`heavy: cannot read ${ROOT}: ${err.message}`);
  process.exit(0);
}
for (const e of rootEntries) {
  const full = path.join(ROOT, e.name);
  if (e.isSymbolicLink()) continue;
  if (e.isDirectory()) topSizes.set(e.name, walk(full, e.name));
  else if (e.isFile()) {
    let size = 0;
    try { size = fs.statSync(full).size; } catch { continue; }
    topSizes.set(e.name, size);
    if (size >= MIN) bigFiles.push({ size, rel: e.name });
  }
}

const gb = (n) => `${(n / 1024 ** 3).toFixed(2)} GB`;
const rows = [];
for (const [name, size] of topSizes) {
  if (size >= MIN && !bigFiles.some((f) => f.rel === name)) rows.push({ size, kind: kindOf(name), label: `${name}/` });
}
for (const f of bigFiles) rows.push({ size: f.size, kind: kindOf(f.rel), label: f.rel });
rows.sort((a, b) => b.size - a.size);

console.log(`heavy: ${ROOT}, everything over ${gb(MIN)}`);
if (!rows.length) console.log('  nothing that big here');
for (const r of rows) console.log(`  ${gb(r.size).padStart(10)}  ${r.kind.padEnd(11)} ${r.label}`);
if (unreadable.length) {
  console.log(`  could not read ${unreadable.length} folder(s), so their size is missing:`);
  for (const u of unreadable) console.log(`    ${u}`);
}
console.log('heavy deletes nothing; the owner decides what goes.');
process.exit(0);
