// Fixture tests for the kit's rotation scripts, the twins
// project-os/Archive-old-rows.ps1 and project-os/Archive-old-rows.mjs.
//
// Run from the kit root:   node tests/Archive-rows-tests.mjs
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
// twin into its project-os/, runs it for real and reads the files back. The
// fake projects live in the OS temp folder, or under PROJECTOS_TEST_TMP when that
// is set (a project whose rules keep every write inside it points this at its
// own scratch folder). Nothing else is touched. The folder is removed at the end,
// or kept and named when a check failed, so the failure can be looked at.
//
// What it pins: moved rows and entries land in the archive and leave the live
// file; nothing is lost when two items look alike; the archive keeps date order
// across runs; a re-run after a crash writes nothing twice; the first separator
// is the table's; an example block below a table is left alone; line endings
// survive; a fresh install's templates move nothing and write nothing; a bad
// option or a date that is not a day stops the run before anything is written;
// a decimal value is rounded half to even by both twins, as PowerShell's [int]
// does, and a value that is not a number is refused by both (2026-10-01);
// a byte order mark, a UTF-16 file and broken UTF-8 are read the way .NET reads
// them. Where PowerShell is present, the twins also run side by side on one
// awkward project and must leave every file byte-identical (2026-10-01).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT_POS = fileURLToPath(new URL('../project-os/', import.meta.url));

function findPowerShell() {
  for (const exe of ['powershell', 'pwsh']) {
    const r = spawnSync(exe, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' });
    if (!r.error && r.status === 0) return exe;
  }
  return null;
}
const PS = findPowerShell();

// Options are written once, in the Node twin's kebab case. The PowerShell twin
// gets the same name in its own spelling: --max-keep-rows becomes -MaxKeepRows.
const pascal = (kebab) => kebab.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase()).replace(/Kb$/, 'KB');
const ENGINES = [];
if (PS) {
  ENGINES.push({
    id: PS,
    file: 'Archive-old-rows.ps1',
    command: (script, opts) => [PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
      ...Object.entries(opts).flatMap(([k, v]) => (v === true ? [`-${pascal(k)}`] : [`-${pascal(k)}`, String(v)]))]],
  });
} else {
  console.log('  Neither powershell nor pwsh was found: Archive-old-rows.ps1 cannot run on this machine, so only the Node twin is tested.');
}
ENGINES.push({
  id: 'node',
  file: 'Archive-old-rows.mjs',
  command: (script, opts) => [process.execPath, [script,
    ...Object.entries(opts).flatMap(([k, v]) => (v === true ? [`--${k}`] : [`--${k}`, String(v)]))]],
});

const BASE = fs.mkdtempSync(path.join(process.env.PROJECTOS_TEST_TMP || os.tmpdir(), 'projectos-archive-tests-'));
let checks = 0;
let failures = 0;
function check(label, ok, detail = '') {
  checks++;
  if (!ok) {
    failures++;
    console.error(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
  }
}

function project(engine, name) {
  const root = path.join(BASE, engine.id, name, 'fake proj');
  fs.mkdirSync(path.join(root, 'project-os'), { recursive: true });
  fs.copyFileSync(path.join(KIT_POS, engine.file), path.join(root, 'project-os', engine.file));
  return root;
}
function run(engine, root, opts = {}) {
  const [exe, args] = engine.command(path.join(root, 'project-os', engine.file), opts);
  const r = spawnSync(exe, args, { encoding: 'utf8', cwd: root });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}`, stdout: r.stdout || '', stderr: r.stderr || '' };
}
const pos = (root, file) => path.join(root, 'project-os', file);
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
const write = (p, lines, eol = '\n') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, lines.join(eol) + eol); };
const count = (text, needle) => (text ? text.split(needle).length - 1 : 0);
const day = (n) => new Date(Date.UTC(2020, 0, n)).toISOString().slice(0, 10);
// The lines that say what moved, for a short failure message.
const summary = (out) => (out.match(/^.*(archive\s*:|WROTE|DONE).*$/gm) || []).map((x) => x.trim()).join(' | ');
const hasBareLf = (text) => /(^|[^\r])\n/.test(text);
function entriesTotal(out, name) {
  const m = new RegExp(`=== ${name.replace(/[().]/g, '\\$&')} ===[\\s\\S]*?entries total\\s*:\\s*(\\d+)`).exec(out);
  return m ? Number(m[1]) : null;
}
function listFiles(root, rel = '') {
  const out = {};
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) Object.assign(out, listFiles(root, r));
    else if (!/^project-os\/Archive-old-rows\.(ps1|mjs)$/.test(r)) out[r] = fs.readFileSync(path.join(root, r));
  }
  return out;
}

// --- Decisions: one block per "## YYYY-MM-DD" entry -------------------------
const entry = (date, title, mark) =>
  [`## ${date} · ${title}`, '', '### Context', `Why ${mark}.`, '', '### Decision', `Chose ${mark}.`, ''];
const decisionsHead = ['# Fake - Decisions', '', '## Index', '', '- one line per entry', '', '---', ''];
const numbered = (from, to) => {
  const out = [];
  for (let n = from; n <= to; n++) out.push(entry(day(n), `Decision ${n}`, `MARK_${n}`));
  return out;
};
const marksInOrder = (text) => [...text.matchAll(/^Why MARK_(\d+)\.$/gm)].map((m) => Number(m[1]));
const entryCount = (text) => (text.match(/^## \d{4}-\d{2}-\d{2}\b/gm) || []).length;

function caseDecisionsAcrossRuns(engine) {
  const label = `${engine.id} decisions`;
  const root = project(engine, 'decisions');
  const live = pos(root, 'Decisions.md');
  const arch = pos(root, 'Decisions-archive.md');
  // Entries 1 and 2 share a date and a title but are different decisions.
  write(live, [...decisionsHead,
    ...entry(day(1), 'Storage choice', 'MARK_1'),
    ...entry(day(1), 'Storage choice', 'MARK_2'),
    ...numbered(3, 30).flat()]);
  const original = read(live);

  let r = run(engine, root, { 'dry-run': true });
  check(`${label}: dry run exits 0`, r.status === 0, r.out);
  check(`${label}: dry run writes nothing`, read(live) === original && read(arch) === null);

  r = run(engine, root);
  check(`${label}: run 1 exits 0`, r.status === 0, r.out);
  let a = read(arch) || '';
  let l = read(live) || '';
  check(`${label}: two decisions sharing a heading are both archived`, a.includes('Why MARK_1.') && a.includes('Why MARK_2.'), summary(r.out));
  check(`${label}: moved entries leave the live file`, !l.includes('MARK_1.') && !l.includes('MARK_5.') && l.includes('MARK_6.'));
  check(`${label}: live keeps the newest 25`, entryCount(l) === 25, `found ${entryCount(l)}`);
  check(`${label}: archive opens an Archived decisions section`, a.includes('## Archived decisions'));
  check(`${label}: archive says rotated entries still bind`, /still BIND/.test(a));
  check(`${label}: middle dot survives byte for byte`, a.includes(`## ${day(3)} · Decision 3`));

  fs.appendFileSync(live, `${numbered(31, 36).flat().join('\n')}\n`);
  const liveBefore2 = read(live);
  r = run(engine, root);
  check(`${label}: run 2 exits 0`, r.status === 0, r.out);
  a = read(arch) || '';
  l = read(live) || '';
  const order = marksInOrder(a);
  check(`${label}: archive stays in date order across runs`,
    order.join(',') === [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].join(','), `order ${order.join(',')}`);
  const alines = a.split('\n');
  const noBlank = alines.filter((ln, i) => /^## \d{4}-/.test(ln) && alines[i - 1].trim() !== '');
  check(`${label}: every archived entry has a blank line above it`, noBlank.length === 0, noBlank.join(' | '));
  check(`${label}: the pointer is written once`, count(l, 'Older entries archived') === 1);
  check(`${label}: live keeps the newest 25 after run 2`, entryCount(l) === 25, `found ${entryCount(l)}`);

  // A crash after the archive write but before the live write: the live file
  // still holds the moved entries. The re-run must not archive them twice.
  const archAfter2 = a;
  const liveAfter2 = l;
  fs.writeFileSync(live, liveBefore2);
  r = run(engine, root);
  check(`${label}: crash re-run exits 0`, r.status === 0, r.out);
  check(`${label}: crash re-run leaves the archive byte-identical`, read(arch) === archAfter2);
  check(`${label}: crash re-run reports the duplicates`, /\+0 new, 6 duplicate\(s\) skipped/.test(r.out), summary(r.out));
  check(`${label}: crash re-run ends at the same live file`, read(live) === liveAfter2);
}

function caseDecisionsHandMoved(engine) {
  const label = `${engine.id} decisions, hand-moved archive`;
  const root = project(engine, 'decisions-hand');
  const live = pos(root, 'Decisions.md');
  const arch = pos(root, 'Decisions-archive.md');
  // The template's supersede flow: an old entry was moved here by hand, and the
  // live entry that replaced it kept the same date and title.
  write(arch, ['# Decisions - Archive', '', ...entry(day(1), 'Storage choice', 'MARK_OLD')]);
  write(live, [...decisionsHead, ...entry(day(1), 'Storage choice', 'MARK_NEW'), ...numbered(2, 26).flat()]);
  const r = run(engine, root);
  check(`${label}: exits 0`, r.status === 0, r.out);
  const a = read(arch) || '';
  check(`${label}: the replacing decision is archived, not skipped`, a.includes('Why MARK_NEW.'), summary(r.out));
  check(`${label}: the hand-moved entry is untouched`, a.startsWith(['# Decisions - Archive', '', ...entry(day(1), 'Storage choice', 'MARK_OLD')].join('\n')));
  check(`${label}: nothing is lost from the live file`, !(read(live) || '').includes('MARK_NEW'));
}

// --- Tables: Backlog Done, Mistakes tails, BugAtlas ---------------------------
function caseBacklog(engine) {
  const label = `${engine.id} backlog`;
  const root = project(engine, 'backlog');
  const live = pos(root, 'Backlog.md');
  const arch = pos(root, 'Backlog-archive.md');
  const same = `| ${day(1)} | ${day(2)} | Same item | chat |`;
  const row = (k) => `| ${day(k)} | ${day(k + 1)} | Item ${k} | chat |`;
  const rows = [same, same];
  for (let k = 3; k <= 45; k++) rows.push(row(k));
  const example = ['| Added | Item | Source |', '|---|---|---|', '| YYYY-MM-DD | Example item | chat |'];
  // CRLF on purpose, with the template's empty placeholder row under each head.
  write(live, ['# Fake - Backlog', '', '## Open', '', '| Added | Item | Source |', '|---|---|---|', '| | | |', '',
    '## Done', '', 'Newest at the bottom.', '', '| Added | Closed | Item | Source |', '|---|---|---|---|', '| | | | |',
    ...rows, '', '---', '', '### Example row - delete this', '', ...example], '\r\n');

  const r = run(engine, root);
  check(`${label}: exits 0`, r.status === 0, r.out);
  const total = entriesTotal(r.out, 'project-os/Backlog.md (Done)');
  check(`${label}: the example block is not counted as Done rows`, total === 45, `entries total ${total}`);
  const a = read(arch) || '';
  const l = read(live) || '';
  check(`${label}: two identical rows moved together are both archived`, count(a, same) === 2, `archive holds ${count(a, same)}`);
  check(`${label}: and both leave the live file`, count(l, same) === 0);
  const al = a.split('\r\n');
  const h = al.indexOf('| Added | Closed | Item | Source |');
  check(`${label}: the archive table keeps the real separator`, h >= 0 && al[h + 1] === '|---|---|---|---|', `line after head: ${al[h + 1]}`);
  check(`${label}: the placeholder row is never archived`, !a.includes('| | | | |'));
  check(`${label}: the top rows are the ones moved`, a.includes('| Item 5 |') && !a.includes('| Item 6 |') && l.includes('| Item 6 |') && !l.includes('| Item 5 |'));
  check(`${label}: the example block stays in the live file`, l.includes('| YYYY-MM-DD | Example item | chat |') && !a.includes('Example item'));
  check(`${label}: the live file keeps CRLF`, !hasBareLf(l));
  check(`${label}: the archive is written in CRLF too`, a.length > 0 && !hasBareLf(a));
  check(`${label}: Open is never touched`, l.includes('## Open\r\n\r\n| Added | Item | Source |\r\n|---|---|---|\r\n| | | |\r\n'));
}

function caseMistakes(engine) {
  const label = `${engine.id} mistakes`;
  const root = project(engine, 'mistakes');
  const live = pos(root, 'Mistakes.md');
  const arch = pos(root, 'Mistakes-archive.md');
  const prow = (k) => `| ${day(k)} | Promoted slip ${k} | Workflow.md |`;
  const rrow = (k) => `| ${day(k)} | Retired slip ${k} | Not repeated in 60 days |`;
  const promoted = [];
  for (let k = 1; k <= 32; k++) promoted.push(prow(k));
  const retired = [];
  for (let k = 1; k <= 31; k++) retired.push(rrow(k));
  write(live, ['# Fake - Mistakes', '', '## Open', '', '| Date | What I did | What was wanted | Home if it repeats | Times |', '|---|---|---|---|---|', '',
    '## Promoted', '', '| Date | The slip | Where its rule now lives |', '|---|---|---|', ...promoted, '',
    '## Retired', '', '| Date | The slip | Why it left |', '|---|---|---|', ...retired, '',
    '---', '', '### Example rows - delete this block', '',
    '| Date | What I did | What was wanted | Home if it repeats | Times |', '|---|---|---|---|---|',
    '| YYYY-MM-DD | Example slip | Example want | CLAUDE.md | 1 |']);
  const r = run(engine, root);
  check(`${label}: exits 0`, r.status === 0, r.out);
  const retiredTotal = entriesTotal(r.out, 'project-os/Mistakes.md (Retired)');
  check(`${label}: Retired counts only its own rows`, retiredTotal === 31, `entries total ${retiredTotal}`);
  const a = read(arch) || '';
  const iP = a.indexOf('## Promoted');
  const iR = a.indexOf('## Retired');
  check(`${label}: both tails share one archive, each in its own section`, iP >= 0 && iR > iP
    && a.indexOf('Promoted slip 2 ') > iP && a.indexOf('Promoted slip 2 ') < iR && a.indexOf('Retired slip 1 ') > iR,
    `Promoted section at ${iP}, Retired section at ${iR}`);
  check(`${label}: the Retired archive table has its own 3-column separator`,
    a.slice(iR).split('\n')[3] === '|---|---|---|', a.slice(iR).split('\n').slice(0, 5).join(' / '));
  check(`${label}: the example row stays live`, (read(live) || '').includes('| YYYY-MM-DD | Example slip |') && !a.includes('Example slip'));
}

function caseAtlas(engine) {
  const label = `${engine.id} bug atlas`;
  const root = project(engine, 'atlas');
  const live = pos(root, 'BugAtlas.md');
  const arch = pos(root, 'BugAtlas-archive.md');
  const rows = [];
  for (let k = 1; k <= 32; k++) rows.push(`| ${k} | Symptom ${k} | Cause ${k} | Fix ${k} | 1x | History ${day(k)} |`);
  write(live, ['# Fake - Bug Atlas', '', '## Atlas', '',
    '| # | Symptom | Root cause | The fix that holds | Times bitten | Where recorded |', '|---|---|---|---|---|---|', ...rows]);
  const r = run(engine, root);
  check(`${label}: exits 0`, r.status === 0, r.out);
  const a = read(arch) || '';
  check(`${label}: the two oldest rows move`, a.includes('| Symptom 2 |') && !a.includes('| Symptom 3 |'));
  check(`${label}: the archive tells a reader to search it when nothing live matches`, /search this file too/i.test(a.split('## Atlas')[0]));
}

// --- History: the Scan log and the deep rows ---------------------------------
function caseHistory(engine) {
  const label = `${engine.id} history`;
  const root = project(engine, 'history');
  const live = pos(root, 'History.md');
  const scanArch = pos(root, 'History-scan-archive.md');
  const deepArch = pos(root, 'History-archive.md');
  const same = `| ${day(1)} | docs | Same scan row. |`;
  const scan = [same, same];
  for (let k = 3; k <= 82; k++) scan.push(`| ${day(k)} | docs | Scan row ${k}. |`);
  const deep = [];
  for (let k = 1; k <= 25; k++) deep.push(`| ${day(k)} | Task ${k} | Changed ${k}. | Checked. | Pass | low | none yet | Undo ${k} by hand. |`);
  const deepHead = '| Date | Task | What changed | What was checked | Result | Risk | Commit before | Rollback |';
  write(live, ['# Fake - History', '', '## Scan log', '', 'Newest at the bottom.', '',
    '| Date | Area | What changed |', '|---|---|---|', '| | | |', ...scan, '',
    '## Appendix - deep rows', '', 'Newest at the bottom, same as the scan log.', '',
    deepHead, '|---|---|---|---|---|---|---|---|', '| | | | | | | | |', ...deep]);
  const r = run(engine, root);
  check(`${label}: exits 0`, r.status === 0, r.out);
  const s = read(scanArch) || '';
  const d = read(deepArch) || '';
  const l = read(live) || '';
  check(`${label}: two identical scan rows moved together are both archived`, count(s, same) === 2, `scan archive holds ${count(s, same)}`);
  check(`${label}: and both leave the live file`, count(l, same) === 0);
  check(`${label}: the live Scan log keeps the newest 80`, (l.match(/\| Scan row \d+\. \|/g) || []).length === 80);
  const moved = [...d.matchAll(/\| Task (\d+) \|/g)].map((m) => Number(m[1]));
  check(`${label}: the five oldest deep rows move, oldest first`, moved.join(',') === '1,2,3,4,5', `moved ${moved.join(',')}`);
  check(`${label}: the live appendix keeps the newest 20`, (l.match(/\| Task \d+ \|/g) || []).length === 20);
  const dl = d.split('\n');
  check(`${label}: the deep archive opens with the appendix head and separator`, dl[dl.indexOf(deepHead) + 1] === '|---|---|---|---|---|---|---|---|');
}

// --- A fresh install: the real templates move nothing and write nothing -------
function caseFreshTemplates(engine) {
  const label = `${engine.id} fresh templates`;
  const root = project(engine, 'fresh');
  const names = ['History.md', 'Decisions.md', 'Backlog.md', 'Mistakes.md', 'BugAtlas.md'].filter((f) => fs.existsSync(path.join(KIT_POS, f)));
  const before = {};
  for (const f of names) {
    fs.copyFileSync(path.join(KIT_POS, f), pos(root, f));
    before[f] = fs.readFileSync(pos(root, f));
  }
  const r = run(engine, root);
  check(`${label}: exits 0`, r.status === 0, r.out);
  check(`${label}: nothing moves`, /DONE - 0 item\(s\) moved/.test(r.out), summary(r.out));
  for (const f of names) check(`${label}: ${f} is byte-identical`, Buffer.compare(before[f], fs.readFileSync(pos(root, f))) === 0);
  const archives = fs.readdirSync(path.join(root, 'project-os')).filter((f) => f.endsWith('-archive.md'));
  check(`${label}: no archive is created`, archives.length === 0, archives.join(', '));
  const totals = [...r.out.matchAll(/entries total\s*:\s*(\d+)/g)].map((m) => Number(m[1]));
  check(`${label}: no example row counts as an entry`, totals.length > 0 && totals.every((n) => n === 0), `totals ${totals.join(',')}`);
}

// --- Stops: a bad option, a date that is not a day ----------------------------
function caseStops(engine) {
  const label = `${engine.id} stops`;
  const root = project(engine, 'stops');
  const live = pos(root, 'Decisions.md');
  write(live, [...decisionsHead, ...numbered(1, 30).flat()]);
  const original = read(live);
  let r = run(engine, root, { 'max-keep-decisions': 'abc' });
  check(`${label}: a value that is not a whole number exits 1`, r.status === 1, r.out);
  check(`${label}: and writes nothing`, read(live) === original && read(pos(root, 'Decisions-archive.md')) === null);

  // A History row dated 30 February: .NET's ParseExact refuses it, and the run
  // stops there, before the Decisions file further down the list is touched.
  const hist = pos(root, 'History.md');
  write(hist, ['# Fake - History', '', '## Appendix', '', '| Date | Task |', '|---|---|', '| 2020-02-30 | Bad day |', `| ${day(5)} | Fine |`]);
  const histBefore = read(hist);
  r = run(engine, root, { 'max-keep-rows': 0 });
  check(`${label}: a date that is not a day exits 1`, r.status === 1, r.out);
  check(`${label}: and says so on stderr`, /ParseExact[\s\S]*DateTime/.test(r.stderr), r.stderr.slice(0, 300));
  check(`${label}: and nothing is written`, read(hist) === histBefore && read(live) === original && read(pos(root, 'History-archive.md')) === null);
}

// --- A decimal value, read the way PowerShell's [int] reads it ----------------
// 2026-10-01: the .ps1 ran -MaxKeepRows 3.7 as 4 while the Node twin refused
// it. Both now read the value as a double and round it half to even, and both
// still refuse what is not a number, or what rounds past the Int32 range.
const DECIMALS = [['3.7', 4], ['2.5', 2], ['3.5', 4], ['35e-1', 4]];
const NOT_NUMBERS = ['3.7abc', '1e2.5', '2147483647.5'];
function decimalHistory(live) {
  const deep = [];
  for (let k = 1; k <= 10; k++) deep.push(`| ${day(k)} | Task ${k} | Changed ${k}. | Checked. | Pass | low | none yet | Undo ${k} by hand. |`);
  write(live, ['# Fake - History', '', '## Appendix - deep rows', '',
    '| Date | Task | What changed | What was checked | Result | Risk | Commit before | Rollback |', '|---|---|---|---|---|---|---|---|', ...deep]);
}
function caseDecimalValue(engine) {
  const label = `${engine.id} decimal value`;
  for (const [value, kept] of DECIMALS) {
    const root = project(engine, `decimal ${value}`);
    const live = pos(root, 'History.md');
    decimalHistory(live);
    const r = run(engine, root, { 'max-keep-rows': value });
    check(`${label} ${value}: exits 0`, r.status === 0, r.out);
    check(`${label} ${value}: is read as ${kept}`, r.out.includes(`keep newest ${kept} rows`), summary(r.out));
    const left = ((read(live) || '').match(/\| Task \d+ \|/g) || []).length;
    check(`${label} ${value}: the live file keeps ${kept} deep rows`, left === kept, `kept ${left}`);
  }
  for (const value of NOT_NUMBERS) {
    const root = project(engine, `not a number ${value}`);
    const live = pos(root, 'History.md');
    decimalHistory(live);
    const before = read(live);
    const r = run(engine, root, { 'max-keep-rows': value });
    check(`${label} ${value}: is refused with exit 1`, r.status === 1, r.out);
    check(`${label} ${value}: and nothing is written`, read(live) === before && read(pos(root, 'History-archive.md')) === null);
  }
}
// Side by side, the two twins read every value above the same way.
function caseDecimalTwinsAgree() {
  if (ENGINES.length < 2) return;
  for (const value of [...DECIMALS.map(([v]) => v), ...NOT_NUMBERS]) {
    const runs = ENGINES.map((e) => run(e, project(e, `decimal twins ${value}`), { 'dry-run': true, 'max-keep-rows': value }));
    const read1 = runs.map((x) => (x.status === 0 ? (/keep newest (-?\d+) rows/.exec(x.out) || [])[1] : 'refused'));
    check(`twins agree on --max-keep-rows ${value}`, runs[0].status === runs[1].status && read1[0] === read1[1], `${ENGINES[0].id}: ${read1[0]}, ${ENGINES[1].id}: ${read1[1]}`);
  }
}

// --- Text the way .NET reads it ----------------------------------------------
function caseEncodings(engine) {
  const label = `${engine.id} encodings`;
  const root = project(engine, 'encodings');
  // Decisions with a UTF-8 byte order mark and CRLF: the mark is dropped on the
  // rewrite, CRLF stays.
  const dec = pos(root, 'Decisions.md');
  fs.writeFileSync(dec, Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from([...decisionsHead, ...numbered(1, 26).flat()].join('\r\n') + '\r\n')]));
  // Backlog saved as UTF-16 LE (Notepad's "Unicode"): read through its mark,
  // written back as UTF-8.
  const back = pos(root, 'Backlog.md');
  const rows = [];
  for (let k = 1; k <= 42; k++) rows.push(`| ${day(k)} | ${day(k + 1)} | Item ${k} שלום | chat |`);
  fs.writeFileSync(back, Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(['# Fake - Backlog', '', '## Done', '', '| Added | Closed | Item | Source |', '|---|---|---|---|', ...rows].join('\n') + '\n', 'utf16le')]));
  // Mistakes with a broken UTF-8 sequence in a kept row: .NET turns "E0 80 80"
  // into two U+FFFD, where a WHATWG decoder would write three.
  const mis = pos(root, 'Mistakes.md');
  const promoted = [];
  for (let k = 1; k <= 31; k++) promoted.push(`| ${day(k)} | Slip ${k} | Workflow.md |`);
  fs.writeFileSync(mis, Buffer.concat([
    Buffer.from(['# Fake - Mistakes', '', '## Promoted', '', '| Date | The slip | Where |', '|---|---|---|', ...promoted, '| 2020-03-01 | Broken '].join('\n')),
    Buffer.from([0xE0, 0x80, 0x80]), Buffer.from(' bytes | x |\n')]));
  const r = run(engine, root);
  check(`${label}: exits 0`, r.status === 0, r.out);
  const d = fs.readFileSync(dec);
  check(`${label}: the byte order mark is dropped`, !(d[0] === 0xEF && d[1] === 0xBB && d[2] === 0xBF));
  check(`${label}: CRLF survives the mark`, !hasBareLf(d.toString('utf8')) && /Older entries archived/.test(d.toString('utf8')));
  const b = read(back) || '';
  check(`${label}: a UTF-16 file is read and rewritten as UTF-8`, b.startsWith('# Fake - Backlog\n') && b.includes('| Item 3 שלום |') && !b.includes('| Item 2 שלום |'), b.slice(0, 80));
  check(`${label}: its moved rows land in a UTF-8 archive`, (read(pos(root, 'Backlog-archive.md')) || '').includes('| Item 2 שלום |'));
  const m = read(mis) || '';
  check(`${label}: a broken sequence becomes two U+FFFD, as in .NET`, m.includes('Broken �� bytes'), JSON.stringify(m.slice(m.indexOf('Broken'), m.indexOf('Broken') + 20)));
}

// --- The twins side by side ---------------------------------------------------
// One awkward project, run by both twins on identical copies: a dry run, a real
// run and a second real run. Every file must come out byte-identical, and the
// summaries must match line for line apart from each twin's own name.
function twinProject(root) {
  const t = '\r\n';
  const scan = ['| Date | Area | What changed |', '|---|---|---|', '| | | |'];
  for (let k = 1; k <= 90; k++) {
    scan.push(`| ${day(k)} | docs | Scan row ${k}. |`);
    if (k === 40) scan.push('﻿'); // a stray mark alone on a line is blank to .NET
    if (k === 50) scan.push('­');
  }
  const deep = ['| Date | Task | What changed | Checked | Result | Risk | Commit | Rollback |', '|---|---|---|---|---|---|---|---|'];
  for (let k = 1; k <= 26; k++) deep.push(`| ${day(k)} | Task ${k} | ${'x'.repeat(60)} שינוי ${k} · détail | ok | Pass | low | none | Undo. |`);
  fs.writeFileSync(path.join(root, 'project-os', 'History.md'), ['# Fake - History', '', '## Scan log', '', ...scan, '', '## Appendix', '', ...deep].join(t) + t);
  const dec = [...decisionsHead, '```', `## ${day(1)} - Fenced example`, '```', ''];
  for (let k = 1; k <= 28; k++) dec.push(`## ${day(k)} - Decision ${k}`, '', `Why ${k} · ${'y'.repeat(70)} ‍.`, '­', '');
  dec.push(`## ${day(29)}א not an entry to .NET`, 'body');
  fs.writeFileSync(path.join(root, 'project-os', 'Decisions.md'), Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(dec.join('\n'))]));
  fs.writeFileSync(path.join(root, 'project-os', 'Decisions-archive.md'), ['# Old archive', '', `## ${day(1)} - Decision 1`, '', 'Hand-moved.'].join(t));
  const done = ['## Done', '', '| Added | Closed | Item | Source |', '|---|---|---|---|'];
  for (let k = 1; k <= 44; k++) done.push(`| ${day(k)} | ${day(k)} | Item ${k} ${'z'.repeat(50)} é ok | chat |`);
  fs.writeFileSync(path.join(root, 'project-os', 'Backlog.md'), Buffer.from(['# Fake - Backlog', '', '## Open', '', ...done, '', '---', '| x |'].join('\n'), 'utf8'));
  const feat = path.join(root, 'features', 'alpha');
  fs.mkdirSync(feat, { recursive: true });
  const log = ['# alpha', '', '## Log', '', '| Date | Task |', '|---|---|'];
  for (let k = 1; k <= 23; k++) log.push(`| ${day(k)} | Feature task ${k} |`);
  fs.writeFileSync(path.join(feat, 'History.md'), log.join('\n'));
  fs.writeFileSync(path.join(feat, 'BugAtlas.md'), ['## Atlas', '', '| # | Symptom |', '|---|---|', ...Array.from({ length: 33 }, (_, i) => `| ${i} | S ${i} |`)].join('\r\n') + '\r\n');
  fs.mkdirSync(path.join(root, 'features', '_template'), { recursive: true });
  fs.writeFileSync(path.join(root, 'features', '_template', 'History.md'), log.join('\n'));
}
function caseTwinsAgree() {
  if (ENGINES.length < 2) return;
  const roots = ENGINES.map((e) => project(e, 'twins'));
  roots.forEach(twinProject);
  const name = (out) => out.replace(/\r\n/g, '\n').replace(/^Archive-old-rows\.(ps1|mjs)/, 'Archive-old-rows').replace(/-DryRun|--dry-run/, 'DRYRUN');
  for (const step of [{ 'dry-run': true }, {}, {}]) {
    const runs = ENGINES.map((e, i) => run(e, roots[i], step));
    const label = `twins agree, ${step['dry-run'] ? 'dry run' : 'real run'}`;
    check(`${label}: both exit 0`, runs.every((x) => x.status === 0), runs.map((x) => x.out).join('\n'));
    const [a, b] = runs.map((x) => name(x.stdout));
    const i = [...a].findIndex((c, k) => c !== b[k]);
    check(`${label}: the summaries match`, a === b, `first difference at ${i}: ${JSON.stringify(a.slice(Math.max(0, i - 40), i + 40))} vs ${JSON.stringify(b.slice(Math.max(0, i - 40), i + 40))}`);
    const [fa, fb] = roots.map((r) => listFiles(r));
    const keys = [...new Set([...Object.keys(fa), ...Object.keys(fb)])];
    const differ = keys.filter((k) => !fa[k] || !fb[k] || Buffer.compare(fa[k], fb[k]) !== 0);
    check(`${label}: every file is byte-identical`, differ.length === 0, differ.join(', '));
  }
}

for (const engine of ENGINES) {
  try {
    caseDecisionsAcrossRuns(engine);
    caseDecisionsHandMoved(engine);
    caseBacklog(engine);
    caseMistakes(engine);
    caseAtlas(engine);
    caseHistory(engine);
    caseFreshTemplates(engine);
    caseStops(engine);
    caseDecimalValue(engine);
    caseEncodings(engine);
  } catch (e) {
    failures++;
    console.error(`FAIL the ${engine.id} cases threw: ${e.stack || e.message}`);
  }
}
try {
  caseTwinsAgree();
  caseDecimalTwinsAgree();
} catch (e) {
  failures++;
  console.error(`FAIL the twins case threw: ${e.stack || e.message}`);
}

const engines = ENGINES.map((e) => e.id).join(' + ');
if (failures > 0) {
  console.error(`Archive-rows-tests.mjs: ${failures} of ${checks} checks FAILED (${engines}). Fake projects kept for a look: ${BASE}`);
  process.exit(1);
}
fs.rmSync(BASE, { recursive: true, force: true });
console.log(`Archive-rows-tests.mjs: all ${checks} checks passed (${engines})`);
