// Tests for the kit's heavy-file lister, project-os/Find-heavy-files.mjs.
//
// Run from the kit root:   node tests/Heavy-files-tests.mjs
// It prints one line per failing check and a count at the end, and exits 1 when
// any check fails.
//
// This folder sits outside project-os/ on purpose: an install copies all of
// project-os/ into a client project, and these tests belong to the kit only.
//
// The script runs for real, as a child process, on a throwaway folder in the OS
// temp folder whose name holds a space. The files in it are small (a few
// kilobytes and one of 1.5 MB), so the lower thresholds are what list them.
// The folder is removed at the end.
//
// What it pins (2026-10-01): every size prints in the unit that fits it, GB
// from 1 GB, MB from 1 MB and KB below, the threshold line too. Every size used
// to print in GB, so with --min 200mb a 300 MB file read as "0.29 GB". Also:
// what is listed at each threshold, the kind beside each path, the default
// 1 GB threshold, and that nothing is deleted. And (2026-10-01) the unit is
// chosen from the size as printed, rounded: 1048575 bytes is "1.00 MB", never
// "1024.00 KB", while 1048570 bytes stays "1023.99 KB". The threshold line
// shows the rounding without a big file, so --min in bytes pins the edges.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../project-os/Find-heavy-files.mjs', import.meta.url));
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'projectos heavy ')));

let ran = 0;
let failures = 0;
function t(name, pass, detail = '') {
  ran++;
  if (pass) return;
  failures++;
  console.error(`FAIL ${name}${detail ? `\n     ${String(detail).split('\n').join('\n     ')}` : ''}`);
}

function heavy(flags = []) {
  const r = spawnSync(process.execPath, [SCRIPT, '--root', TMP, ...flags], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

// The listed line for a path: `  <size>  <kind> <path>`, or null.
const lineFor = (out, label) => out.split('\n').find((l) => l.trimEnd().endsWith(` ${label}`)) || null;

// The files, each with the size it is made with.
const FILES = {
  'notes.txt': 3 * 1024, // 3.00 KB, a top-level file
  'tiny.txt': 100, // under every threshold here
  'media/clip.bin': 1.5 * 1024 * 1024, // 1.50 MB
  'node_modules/pkg/index.js': 2 * 1024, // 2.00 KB, regenerable
};

try {
  for (const [rel, size] of Object.entries(FILES)) {
    const full = path.join(TMP, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, Buffer.alloc(size, 'x'));
  }

  // --min 1kb: KB and MB sizes, each in its own unit.
  let r = heavy(['--min', '1kb']);
  t('--min 1kb exits 0', r.code === 0, r.out);
  t('--min 1kb: the threshold line reads 1.00 KB', r.out.includes('everything over 1.00 KB'), r.out);
  t('--min 1kb: a 3 KB file shows as 3.00 KB', /^\s+3\.00 KB\s+leftover\s+notes\.txt$/m.test(r.out), lineFor(r.out, 'notes.txt') || r.out);
  t('--min 1kb: a 1.5 MB file shows as 1.50 MB', /^\s+1\.50 MB\s+leftover\s+media\/clip\.bin$/m.test(r.out), lineFor(r.out, 'media/clip.bin') || r.out);
  t('--min 1kb: a file under dependencies is regenerable, in KB', /^\s+2\.00 KB\s+regenerable\s+node_modules\/pkg\/index\.js$/m.test(r.out), lineFor(r.out, 'node_modules/pkg/index.js') || r.out);
  t('--min 1kb: the dependencies folder is listed whole, in KB', /^\s+2\.00 KB\s+regenerable\s+node_modules\/$/m.test(r.out), lineFor(r.out, 'node_modules/') || r.out);
  t('--min 1kb: a 100-byte file is not listed', !lineFor(r.out, 'tiny.txt'), r.out);
  t('--min 1kb: no size is printed in GB', !/\bGB\b/.test(r.out), r.out);
  t('--min 1kb: largest first', r.out.indexOf('media/') < r.out.indexOf('notes.txt') && r.out.indexOf('notes.txt') < r.out.indexOf('node_modules/'), r.out);

  // --min 1mb: only the 1.5 MB file and the folder that holds it.
  r = heavy(['--min', '1mb']);
  t('--min 1mb exits 0', r.code === 0, r.out);
  t('--min 1mb: the threshold line reads 1.00 MB', r.out.includes('everything over 1.00 MB'), r.out);
  t('--min 1mb: the 1.5 MB file shows as 1.50 MB', /^\s+1\.50 MB\s+leftover\s+media\/clip\.bin$/m.test(r.out), lineFor(r.out, 'media/clip.bin') || r.out);
  t('--min 1mb: the folder holding it shows as 1.50 MB', /^\s+1\.50 MB\s+leftover\s+media\/$/m.test(r.out), lineFor(r.out, 'media/') || r.out);
  t('--min 1mb: the KB files are not listed', !lineFor(r.out, 'notes.txt') && !lineFor(r.out, 'node_modules/') && !lineFor(r.out, 'node_modules/pkg/index.js'), r.out);
  t('--min 1mb: no size is printed in GB or KB', !/\b(GB|KB)\b/.test(r.out), r.out);

  // The default threshold, 1 GB: nothing here is that big.
  r = heavy();
  t('default exits 0', r.code === 0, r.out);
  t('default: the threshold line reads 1.00 GB', r.out.includes('everything over 1.00 GB'), r.out);
  t('default: nothing that big here', r.out.includes('nothing that big here') && !lineFor(r.out, 'media/clip.bin') && !lineFor(r.out, 'media/'), r.out);

  // A threshold over 1 GB keeps GB, with two decimals.
  r = heavy(['--min', '1.5gb']);
  t('--min 1.5gb: the threshold line reads 1.50 GB', r.out.includes('everything over 1.50 GB'), r.out);

  // The unit follows the rounded number: a size that rounds up to 1024 of one
  // unit is printed as 1.00 of the next.
  r = heavy(['--min', '1048575b']);
  t('--min 1048575b: the threshold line reads 1.00 MB, not 1024.00 KB', r.out.includes('everything over 1.00 MB') && !r.out.includes('1024.00'), r.out);
  r = heavy(['--min', '1048570b']);
  t('--min 1048570b: a size that rounds below 1024 KB stays in KB', r.out.includes('everything over 1023.99 KB'), r.out);
  r = heavy(['--min', '1073741823b']);
  t('--min 1073741823b: one byte under 1 GB reads 1.00 GB, not 1024.00 MB', r.out.includes('everything over 1.00 GB') && !r.out.includes('1024.00'), r.out);
  r = heavy(['--min', '1048576b']);
  t('--min 1048576b: exactly 1 MB reads 1.00 MB', r.out.includes('everything over 1.00 MB'), r.out);
  // A listed file one byte under 1 MB prints as 1.00 MB too.
  const almost = path.join(TMP, 'edge', 'almost-a-megabyte.bin');
  fs.mkdirSync(path.dirname(almost), { recursive: true });
  fs.writeFileSync(almost, Buffer.alloc(1048575, 'x'));
  r = heavy(['--min', '1mb']);
  t('a file of 1048575 bytes is under --min 1mb, so not listed', !lineFor(r.out, 'edge/almost-a-megabyte.bin'), r.out);
  r = heavy(['--min', '1000kb']);
  t('a file of 1048575 bytes is listed as 1.00 MB', /^\s+1\.00 MB\s+leftover\s+edge\/almost-a-megabyte\.bin$/m.test(r.out) && !r.out.includes('1024.00'), lineFor(r.out, 'edge/almost-a-megabyte.bin') || r.out);
  fs.rmSync(almost);
  fs.rmdirSync(path.dirname(almost));

  // It deletes nothing, ever.
  t('every file is still there, at its size', Object.entries(FILES).every(([rel, size]) => {
    try { return fs.statSync(path.join(TMP, rel)).size === size; } catch { return false; }
  }));
  t('the closing line says it deletes nothing', r.out.includes('Find-heavy-files deletes nothing'), r.out);
} finally {
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

if (failures > 0) {
  console.error(`Heavy-files-tests.mjs: ${failures} of ${ran} checks FAILED`);
  process.exit(1);
}
console.log(`Heavy-files-tests.mjs: all ${ran} checks passed`);
