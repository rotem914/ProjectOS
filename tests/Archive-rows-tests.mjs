// Fixture tests for the kit's rotation script, project-os/Archive-old-rows.ps1.
//
// Run from the kit root:   node tests/Archive-rows-tests.mjs
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
// script into its project-os/, runs it for real and reads the files back. The
// fake projects live in the OS temp folder, or under PROJECTOS_TEST_TMP when that
// is set (a project whose rules keep every write inside it points this at its
// own scratch folder). Nothing else is touched. The folder is removed at the end,
// or kept and named when a check failed, so the failure can be looked at.
//
// What it pins: moved rows and entries land in the archive and leave the live
// file; nothing is lost when two items look alike; the archive keeps date order
// across runs; a re-run after a crash writes nothing twice; the first separator
// is the table's; an example block below a table is left alone; line endings
// survive; a fresh install's templates move nothing and write nothing.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT_POS = fileURLToPath(new URL('../project-os/', import.meta.url));
const SCRIPT = path.join(KIT_POS, 'Archive-old-rows.ps1');

function findPowerShell() {
  for (const exe of ['powershell', 'pwsh']) {
    const r = spawnSync(exe, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' });
    if (!r.error && r.status === 0) return exe;
  }
  return null;
}
const PS = findPowerShell();
if (!PS) {
  console.log('Archive-rows-tests.mjs: SKIPPED. Neither powershell nor pwsh was found, so Archive-old-rows.ps1 cannot run on this machine and nothing was tested.');
  process.exit(0);
}

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

function project(name) {
  const root = path.join(BASE, name, 'fake proj');
  fs.mkdirSync(path.join(root, 'project-os'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(root, 'project-os', 'Archive-old-rows.ps1'));
  return root;
}
function run(root, ...args) {
  const r = spawnSync(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(root, 'project-os', 'Archive-old-rows.ps1'), ...args], { encoding: 'utf8', cwd: root });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}
const pos = (root, file) => path.join(root, 'project-os', file);
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
const write = (p, lines, eol = '\n') => fs.writeFileSync(p, lines.join(eol) + eol);
const count = (text, needle) => (text ? text.split(needle).length - 1 : 0);
const day = (n) => new Date(Date.UTC(2020, 0, n)).toISOString().slice(0, 10);
// The lines that say what moved, for a short failure message.
const summary = (out) => (out.match(/^.*(archive\s*:|WROTE|DONE).*$/gm) || []).map((x) => x.trim()).join(' | ');
const hasBareLf = (text) => /(^|[^\r])\n/.test(text);
function entriesTotal(out, name) {
  const m = new RegExp(`=== ${name.replace(/[().]/g, '\\$&')} ===[\\s\\S]*?entries total\\s*:\\s*(\\d+)`).exec(out);
  return m ? Number(m[1]) : null;
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

function caseDecisionsAcrossRuns() {
  const label = 'decisions';
  const root = project('decisions');
  const live = pos(root, 'Decisions.md');
  const arch = pos(root, 'Decisions-archive.md');
  // Entries 1 and 2 share a date and a title but are different decisions.
  write(live, [...decisionsHead,
    ...entry(day(1), 'Storage choice', 'MARK_1'),
    ...entry(day(1), 'Storage choice', 'MARK_2'),
    ...numbered(3, 30).flat()]);
  const original = read(live);

  let r = run(root, '-DryRun');
  check(`${label}: dry run exits 0`, r.status === 0, r.out);
  check(`${label}: dry run writes nothing`, read(live) === original && read(arch) === null);

  r = run(root);
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
  r = run(root);
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
  r = run(root);
  check(`${label}: crash re-run exits 0`, r.status === 0, r.out);
  check(`${label}: crash re-run leaves the archive byte-identical`, read(arch) === archAfter2);
  check(`${label}: crash re-run reports the duplicates`, /\+0 new, 6 duplicate\(s\) skipped/.test(r.out), summary(r.out));
  check(`${label}: crash re-run ends at the same live file`, read(live) === liveAfter2);
}

function caseDecisionsHandMoved() {
  const label = 'decisions, hand-moved archive';
  const root = project('decisions-hand');
  const live = pos(root, 'Decisions.md');
  const arch = pos(root, 'Decisions-archive.md');
  // The template's supersede flow: an old entry was moved here by hand, and the
  // live entry that replaced it kept the same date and title.
  write(arch, ['# Decisions - Archive', '', ...entry(day(1), 'Storage choice', 'MARK_OLD')]);
  write(live, [...decisionsHead, ...entry(day(1), 'Storage choice', 'MARK_NEW'), ...numbered(2, 26).flat()]);
  const r = run(root);
  check(`${label}: exits 0`, r.status === 0, r.out);
  const a = read(arch) || '';
  check(`${label}: the replacing decision is archived, not skipped`, a.includes('Why MARK_NEW.'), summary(r.out));
  check(`${label}: the hand-moved entry is untouched`, a.startsWith(['# Decisions - Archive', '', ...entry(day(1), 'Storage choice', 'MARK_OLD')].join('\n')));
  check(`${label}: nothing is lost from the live file`, !(read(live) || '').includes('MARK_NEW'));
}

// --- Tables: Backlog Done, Mistakes tails, BugAtlas ---------------------------
function caseBacklog() {
  const label = 'backlog';
  const root = project('backlog');
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

  const r = run(root);
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

function caseMistakes() {
  const label = 'mistakes';
  const root = project('mistakes');
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
  const r = run(root);
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

function caseAtlas() {
  const label = 'bug atlas';
  const root = project('atlas');
  const live = pos(root, 'BugAtlas.md');
  const arch = pos(root, 'BugAtlas-archive.md');
  const rows = [];
  for (let k = 1; k <= 32; k++) rows.push(`| ${k} | Symptom ${k} | Cause ${k} | Fix ${k} | 1x | History ${day(k)} |`);
  write(live, ['# Fake - Bug Atlas', '', '## Atlas', '',
    '| # | Symptom | Root cause | The fix that holds | Times bitten | Where recorded |', '|---|---|---|---|---|---|', ...rows]);
  const r = run(root);
  check(`${label}: exits 0`, r.status === 0, r.out);
  const a = read(arch) || '';
  check(`${label}: the two oldest rows move`, a.includes('| Symptom 2 |') && !a.includes('| Symptom 3 |'));
  check(`${label}: the archive tells a reader to search it when nothing live matches`, /search this file too/i.test(a.split('## Atlas')[0]));
}

// --- History: the Scan log and the deep rows ---------------------------------
function caseHistory() {
  const label = 'history';
  const root = project('history');
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
  const r = run(root);
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
function caseFreshTemplates() {
  const label = 'fresh templates';
  const root = project('fresh');
  const names = ['History.md', 'Decisions.md', 'Backlog.md', 'Mistakes.md', 'BugAtlas.md'].filter((f) => fs.existsSync(path.join(KIT_POS, f)));
  const before = {};
  for (const f of names) {
    fs.copyFileSync(path.join(KIT_POS, f), pos(root, f));
    before[f] = fs.readFileSync(pos(root, f));
  }
  const r = run(root);
  check(`${label}: exits 0`, r.status === 0, r.out);
  check(`${label}: nothing moves`, /DONE - 0 item\(s\) moved/.test(r.out), summary(r.out));
  for (const f of names) check(`${label}: ${f} is byte-identical`, Buffer.compare(before[f], fs.readFileSync(pos(root, f))) === 0);
  const archives = fs.readdirSync(path.join(root, 'project-os')).filter((f) => f.endsWith('-archive.md'));
  check(`${label}: no archive is created`, archives.length === 0, archives.join(', '));
  const totals = [...r.out.matchAll(/entries total\s*:\s*(\d+)/g)].map((m) => Number(m[1]));
  check(`${label}: no example row counts as an entry`, totals.length > 0 && totals.every((n) => n === 0), `totals ${totals.join(',')}`);
}

try {
  caseDecisionsAcrossRuns();
  caseDecisionsHandMoved();
  caseBacklog();
  caseMistakes();
  caseAtlas();
  caseHistory();
  caseFreshTemplates();
} catch (e) {
  failures++;
  console.error(`FAIL the suite itself threw: ${e.stack || e.message}`);
}

if (failures > 0) {
  console.error(`Archive-rows-tests.mjs: ${failures} of ${checks} checks FAILED (${PS}). Fake projects kept for a look: ${BASE}`);
  process.exit(1);
}
fs.rmSync(BASE, { recursive: true, force: true });
console.log(`Archive-rows-tests.mjs: all ${checks} checks passed (${PS})`);
