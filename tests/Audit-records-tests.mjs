// Tests for project-os/Audit-project-records.mjs, the read-only audit of a
// project's own records that `Go audit` runs and `Go commit` runs as a warning.
//
// Run from the kit root:   node tests/Audit-records-tests.mjs
// It prints one line per failing case and a count at the end, and exits 1 when
// any case fails.
//
// Every case runs the real script as a child process, from the root of a
// throwaway project, the way an installed project runs it. The projects, and
// the git repositories some of them are, live in one folder under the system
// temp folder (or under PROJECTOS_TEST_TMP when that is set), whose name holds
// a space on purpose; that folder is removed at the end. Git runs with an empty
// global config and no system config, so the machine's own settings cannot
// change what a case sees, and every commit carries a date set by the case.
//
// Each of the six checks has at least one case that must be reported and one
// that must not.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(KIT, 'project-os', 'Audit-project-records.mjs');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(process.env.PROJECTOS_TEST_TMP || os.tmpdir(), 'projectos audit ')));
const EMPTY_CONFIG = path.join(TMP, 'empty gitconfig');
fs.writeFileSync(EMPTY_CONFIG, '');

const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
Object.assign(ENV, {
  GIT_CONFIG_GLOBAL: EMPTY_CONFIG,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CEILING_DIRECTORIES: TMP,
  GIT_AUTHOR_NAME: 'Audit Test',
  GIT_AUTHOR_EMAIL: 'audit@example.com',
  GIT_COMMITTER_NAME: 'Audit Test',
  GIT_COMMITTER_EMAIL: 'audit@example.com',
});

// Day n is n days before today, at local noon, so a commit never sits on the
// edge of a day in any time zone the suite runs in.
const NOW = new Date();
const dayAt = (n) => new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - n, 12, 0, 0);
const pad = (n) => String(n).padStart(2, '0');
const D = (n) => { const d = dayAt(n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const stamp = (n) => `${Math.floor(dayAt(n).getTime() / 1000)} +0000`;

function git(dir, args, n) {
  const env = { ...ENV };
  if (n !== undefined) { env.GIT_AUTHOR_DATE = stamp(n); env.GIT_COMMITTER_DATE = stamp(n); }
  const r = spawnSync('git', args, { cwd: dir, env, encoding: 'utf8' });
  if (r.error || r.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${dir}: ${r.error ? r.error.message : r.stderr}`);
  return r.stdout;
}
function write(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, ...rel.split('/'));
    if (content === null) { fs.rmSync(p, { force: true }); continue; }
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
}
function commit(dir, n, files, message) {
  write(dir, files);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '--no-verify', '-m', message], n);
}
function project(name, files = {}, { repo = false } = {}) {
  const dir = path.join(TMP, name);
  fs.mkdirSync(dir, { recursive: true });
  if (repo) git(dir, ['-c', 'init.defaultBranch=main', 'init', '-q']);
  write(dir, files);
  return dir;
}
function audit(dir, args = []) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, env: ENV, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}
// One check's block: its count line and the gap lines under it.
function section(out, letter) {
  const lines = out.split('\n');
  const i = lines.findIndex((l) => l.startsWith(`  ${letter}. `));
  if (i === -1) return '';
  let j = i + 1;
  while (j < lines.length && lines[j].startsWith('       ')) j++;
  return lines.slice(i, j).join('\n');
}
const countOf = (sec) => { const m = /: (\d+)$/.exec(sec.split('\n')[0]); return m ? Number(m[1]) : null; };

let ran = 0;
let failures = 0;
function t(name, pass, detail = '') {
  ran++;
  if (pass) return;
  failures++;
  console.error(`FAIL ${name}${detail ? `\n     ${String(detail).split('\n').join('\n     ')}` : ''}`);
}

// A History.md in the template's shape. Its heading keeps a placeholder (a gap
// for check c), and one low row quotes a placeholder and an old file name,
// which a record row may do (no gap for checks c and d).
function history(scanDates) {
  return [
    '# {{PROJECT_NAME}}, History',
    '',
    '## Scan log',
    '',
    '| Date | Area | What changed |',
    '|---|---|---|',
    ...scanDates.map((d) => `| ${d} | app | something changed |`),
    '',
    '## Appendix, deep rows',
    '',
    '| Date | Task | What changed | What was checked | Result | Risk | Commit before | Rollback |',
    '|---|---|---|---|---|---|---|---|',
    `| ${D(10)} | Add the login form | form added | Clicked it, it signs in | Pass | medium | none yet | remove the form |`,
    `| ${D(10)} | Payment flow | card form | Test card paid. Review: 0 findings. | Pass | high | none yet | remove the flow |`,
    `| ${D(10)} | Copy fix | words | read it | Pass | low | none yet | put the words back |`,
    `| ${D(10)} | Code review doc update | the doc | read it | Pass | medium | none yet | revert the doc |`,
    // 2026-10-01: a review named with no result, or said not to have run, is a gap.
    `| ${D(10)} | Add a search box | box added | Typed a word, results shown. Review: not run. | Pass | medium | none yet | remove the box |`,
    `| ${D(10)} | Export to CSV | export added | Exported a file, it opened. Review skipped in fast mode. | Pass | high | none yet | remove the export |`,
    `| ${D(10)} | Settings page | page added | Opened it. Code review ran. | Pass | medium | none yet | remove the page |`,
    `| ${D(10)} | Header fix | header | Looked at it. Review ran. | Pass | medium | none yet | put back the fixed header |`,
    `| ${D(10)} | Footer links | links | Clicked each. Review: none yet. | Pass | medium | none yet | remove the links |`,
    `| ${D(10)} | Search filters | filters | Filtered twice. Review: 1 found, 1 fixed. Review skipped for the second pass. | Pass | medium | none yet | remove the filters |`,
    // A review result in the template's own words, and the other result words.
    `| ${D(10)} | Show a failed-login error | the error line | Wrong password: message shown. Review: 2 found, 2 fixed, 1 pre-existing flagged. | Pass | medium | none yet | remove the error line |`,
    `| ${D(10)} | Profile photo | upload | Uploaded one. Review: clean. | Pass | medium | none yet | remove the upload |`,
    `| ${D(10)} | Dark mode | theme | Skipped the print view. Review: none. | Pass | medium | none yet | remove the theme |`,
    `| ${D(10)} | Refunds | refund button | Refunded a test card. Code review passed. | Pass | high | none yet | remove the button |`,
    `| ${D(10)} | Tooltip | tooltip | Hovered it. Review: no findings. | Pass | medium | none yet | remove the tooltip |`,
    `| ${D(10)} | Tidy a label | label | Read it. Review: not run. | Pass | low | none yet | put the label back |`,
    `| ${D(10)} | Rename a doc | \`project-os/Old-name.md\` became Workflow, the {{TOKEN}} kept | read it | Pass | low | none yet | rename it back |`,
    '',
  ].join('\n');
}

const FENCE = '```';
const CLAUDE = [
  '# Demo',
  'You work for {{OWNER_NAME}}.',
  '',
  `${FENCE}text`,
  'Open {{DEV_URL}} in a fence.',
  '`project-os/In-fence.md` in a fence.',
  FENCE,
  '~~~',
  'Run {{CHECK_COMMAND}} in a tilde fence.',
  '~~~',
  '',
  'Read `project-os/Workflow.md` first.',
  'Then `project-os/Missing-rules.md`.',
  'See `project-os/workflow.md` too.',
  'The plan is `project-os/Plan.md` when it exists.',
  'The guard is `Path-guard.mjs`.',
  'Also `Gone-root-file.md`.',
  'Run `node scripts/run-checks.mjs` daily.',
  'The install law is `Installation.md`.',
  'The guards live in `project-os/guards/`.',
  'Billing lived in `features/billing/`.',
  '',
].join('\n');

const FIGMA = [
  '# Figma',
  '',
  '## 0. Setup facts',
  '',
  '> **Setup step: fill this table once the server is connected, then delete this block.**',
  '',
  '| Fact | Value |',
  '|---|---|',
  '| Figma file | `{{FIGMA_FILE_KEY}}` |',
  '',
  '~~~',
  'An example inside the setup section: {{FIGMA_EXAMPLE_KEY}}',
  '~~~',
  '',
  '## 1. Rules',
  '',
  'A leftover {{STRAY_TOKEN}} here.',
  '',
].join('\n');
const OTHER_TOOL = [
  '# Other server',
  '',
  '> **Setup step: fill this table once the server is wired.**',
  '',
  '| Fact | Value |',
  '|---|---|',
  '| Account | `{{ACCOUNT_ID}}` |',
  '',
  'After the table, {{AFTER_TABLE}} is a gap.',
  '',
  '~~~',
  'An example reply past the setup table: {{TOOL_TILDE}}',
  '~~~',
  '',
].join('\n');

try {
  // ---- project A: a git repository with a month of history -------------------
  const A = project('project a', {}, { repo: true });
  commit(A, 40, {
    'src/old.js': 'export const old = 1;\n',
    'notes/old.md': 'Old text \u2014 from long ago.\n',
    '.gitignore': '/backups/\n',
  }, 'start');
  commit(A, 10, {
    'CLAUDE.md': CLAUDE,
    'Installation.md': '# Install\n',
    'project-os/Workflow.md': '# Workflow\n',
    'project-os/QA.md': '# QA\n\n## 0. Setup facts\n\n| Fact | Value |\n|---|---|\n| x | {{QA_TOKEN}} |\n',
    'project-os/guards/Path-guard.mjs': '// guard\n',
    'project-os/History.md': history([D(10)]),
    'project-os/History-archive.md': `| ${D(50)} | {{OLD_TOKEN}} quoted, \`project-os/Gone.md\` named | x |\n`,
    'project-os/Decisions-archive.md': '## 2026-01-01, Old\n\nWe kept {{ARCHIVED_PROSE}} as it was, in `project-os/Gone-too.md`.\n',
    'project-os/mcp/Figma/Figma_MCP_Rules.md': FIGMA,
    'project-os/mcp/Other/Other_MCP_Rules.md': OTHER_TOOL,
  }, 'docs, with a row for the day');
  commit(A, 8, { 'src/app.js': 'export const app = 2;\n' }, 'code, no row');
  commit(A, 6, { 'project-os/History.md': history([D(10), D(7)]) }, 'go commit carrying the row of the day before');
  git(A, ['checkout', '-q', '-b', 'side']);
  commit(A, 5, { 'project-os/History.md': history([D(10), D(7), D(5)]), 'src/side.js': 'side\n' }, 'side work with its row');
  git(A, ['checkout', '-q', 'main']);
  // Main moves on too, so the merge differs from both parents and git cannot
  // drop it as a plain copy of one of them: only --no-merges keeps it out.
  commit(A, 5, { 'src/main.js': 'main\n' }, 'main work the same day');
  git(A, ['merge', '-q', '--no-ff', '--no-verify', '-m', 'merge side', 'side'], 4);
  commit(A, 3, {
    'CLAUDE.md': `${CLAUDE}A new line \u2014 with an em dash.\n`,
    'src/util.js': '// a range 1\u20132\nexport const u = 3;\n',
    'docs/guide.md': [
      'The plan -- as agreed -- holds.',
      'Run `git log -- path` to see it.',
      'Then git checkout abc -- the four files.',
      'Type `x -- y` in the field.',
      FENCE,
      'foo -- bar in a fence',
      FENCE,
      '',
    ].join('\n'),
    'src/code.mjs': 'const a = 1; const b = a -- 0;\n',
    // A rule that shows the forbidden dash as its example: in inline code or
    // in a fence of either kind it is not a slip, beside it on the line it is.
    'docs/rules.md': [
      'Never write a long dash: not `\u2014`, not `\u2013`.',
      'Write ``a ` \u2014`` like this.',
      'A real slip \u2014 next to `code`.',
      `${FENCE}text`,
      'An example \u2014 in a backtick fence.',
      FENCE,
      '~~~',
      'An example reply \u2013 in a tilde fence.',
      '~~~',
      'An unclosed ` tick \u2014 is not a code span.',
      'Also ``x -- y`` as code.',
      '',
    ].join('\n'),
    'src/msg.mjs': 'console.log(`done \u2014 now`);\n',
    'docs/fixed.md': 'This one \u2014 gets fixed.\n',
    'docs/before.md': 'Renamed later \u2014 still here.\n',
    'docs/case.md': 'Case renamed \u2014 still here.\n',
    'docs/mixed.md': 'Kept \u2014 through a rewrite.\none\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\n',
    'project-os/History-archive.md': `| ${D(50)} | {{OLD_TOKEN}} quoted, \`project-os/Gone.md\` named | x |\n| ${D(49)} | moved \u2014 row | x |\n`,
  }, 'dashes, no row');
  write(A, { 'docs/fixed.md': 'This one, fixed.\n' });
  git(A, ['mv', 'docs/before.md', 'docs/after.md']);
  git(A, ['mv', 'docs/case.md', 'docs/Case.md']);
  // A case-only rename with most of the file rewritten is too different for
  // git to call a rename: it reads as the old name deleted and the new one
  // added. On a disk that ignores case the old name still opens the new file.
  git(A, ['mv', 'docs/mixed.md', 'docs/Mixed.md']);
  write(A, { 'docs/Mixed.md': 'Kept \u2014 through a rewrite.\nuno\ndos\ntres\ncuatro\ncinco\nseis\nsiete\nocho\nnueve\n' });
  git(A, ['add', '-A']);
  git(A, ['commit', '-q', '--no-verify', '-m', 'fix one dash, rename two files'], 2);

  let r = audit(A);
  t('always exits 0, gaps or not', r.code === 0, r.out);
  t('the header names the window', r.out.includes(`Window: the last 30 days, ${D(29)} to ${D(0)}.`), r.out);

  // a. days with commits but no History row
  let a = section(r.out, 'a');
  t('a: a day with a commit and no row is listed', a.includes(D(8)), a);
  t('a: days 3 and 2, commits with no row, are listed', a.includes(D(3)) && a.includes(D(2)), a);
  t('a: a day whose row is there is not listed', !a.includes(D(10)), a);
  t('a: a day whose commit added a History row (dated the day before) is not listed', !a.includes(D(6)), a);
  t('a: a branch day with its own row is not listed', !a.includes(D(5)), a);
  t('a: a day with only a merge commit is not listed', !a.includes(D(4)), a);
  t('a: a commit older than the window is not listed', !a.includes(D(40)), a);
  t('a: the count matches the three gap days', countOf(a) === 3, a);
  const wide = audit(A, ['--days', '60']);
  t('a: --days 60 reaches the commit 40 days back', section(wide.out, 'a').includes(D(40)) && countOf(section(wide.out, 'a')) === 4, section(wide.out, 'a'));

  // b. medium or high rows with no review result
  const b = section(r.out, 'b');
  t('b: a medium row with no review result is listed', b.includes('Add the login form'), b);
  t('b: "review" in the task name alone is not a review result', b.includes('Code review doc update'), b);
  t('b: a high row naming its review result is not listed', !b.includes('Payment flow'), b);
  t('b: a low row is not listed', !b.includes('Copy fix') && !b.includes('Rename a doc') && !b.includes('Tidy a label'), b);
  // 2026-10-01: the word review alone used to pass a row.
  t('b: "Review: not run" is a gap', b.includes('Add a search box'), b);
  t('b: a review said to be skipped is a gap, on a high row too', b.includes('high  Export to CSV'), b);
  t('b: a review mentioned with no result is a gap', b.includes('Settings page'), b);
  t('b: a result word in another cell does not count', b.includes('Header fix'), b);
  t('b: "none yet" is no result', b.includes('Footer links'), b);
  t('b: a sentence saying the review was skipped makes the row a gap, even beside a result', b.includes('Search filters'), b);
  t('b: the template\'s own wording is a result', !b.includes('Show a failed-login error'), b);
  t('b: clean, none, passed and no findings are results', !b.includes('Profile photo') && !b.includes('Dark mode') && !b.includes('Refunds') && !b.includes('Tooltip'), b);
  t('b: "skipped" in a sentence that does not mention the review does not count', !b.includes('Dark mode'), b);
  t('b: the count is 8, with file and line', countOf(b) === 8 && /project-os\/History\.md:\d+/.test(b), b);

  // c. placeholders left
  const c = section(r.out, 'c');
  t('c: a placeholder in CLAUDE.md is listed with its line', c.includes('CLAUDE.md:2  {{OWNER_NAME}}'), c);
  t('c: a placeholder in a record\'s heading is listed', c.includes('project-os/History.md:1  {{PROJECT_NAME}}'), c);
  t('c: a placeholder past a tool file\'s setup section is listed', c.includes('{{STRAY_TOKEN}}') && c.includes('{{AFTER_TABLE}}'), c);
  t('c: a "Setup facts" table outside project-os/mcp/ is not exempt', c.includes('{{QA_TOKEN}}'), c);
  t('c: a placeholder inside a ``` fence is not listed', !c.includes('{{DEV_URL}}'), c);
  // 2026-10-01: the install replaces placeholders in the ~~~ example fences
  // too (Installation.md step 5), so one left there is a gap.
  t('c: a placeholder inside a ~~~ fence is listed with its line', c.includes('CLAUDE.md:9  {{CHECK_COMMAND}}'), c);
  t('c: a ~~~ fence in a tool file, past its setup table, is listed', c.includes('{{TOOL_TILDE}}'), c);
  t('c: the tool files\' setup tables are not listed', !c.includes('{{FIGMA_FILE_KEY}}') && !c.includes('{{ACCOUNT_ID}}'), c);
  t('c: a ~~~ fence inside a tool file\'s setup section is still not listed', !c.includes('{{FIGMA_EXAMPLE_KEY}}'), c);
  t('c: a record row quoting a placeholder, and an archive, are not listed', !c.includes('{{TOKEN}}') && !c.includes('{{OLD_TOKEN}}'), c);
  t('c: prose in an archived Decisions entry is not listed', !c.includes('{{ARCHIVED_PROSE}}'), c);
  t('c: the count is 7', countOf(c) === 7, c);

  // d. references to missing files
  const d = section(r.out, 'd');
  t('d: a missing project-os/ path is listed', d.includes('project-os/Missing-rules.md'), d);
  t('d: a path whose case differs from the disk is listed, on every system', d.includes('project-os/workflow.md'), d);
  t('d: a bare file name found nowhere is listed', d.includes('Gone-root-file.md'), d);
  t('d: a scripts/ path inside a command is listed', d.includes('scripts/run-checks.mjs'), d);
  t('d: a folder that is gone is listed', d.includes('features/billing/'), d);
  t('d: a path that exists is not listed', !d.includes('project-os/Workflow.md') && !d.includes('Installation.md'), d);
  t('d: a folder that exists is not listed', !d.includes('project-os/guards/'), d);
  t('d: a bare name living deeper in the project is not listed', !d.includes('Path-guard.mjs'), d);
  t('d: a name the kit makes later (Plan.md) is not listed', !d.includes('Plan.md'), d);
  t('d: a path inside a fence is not listed', !d.includes('In-fence.md'), d);
  t('d: names in History rows and archives are not listed', !d.includes('Old-name.md') && !d.includes('Gone.md') && !d.includes('Gone-too.md'), d);
  t('d: the count is 5', countOf(d) === 5, d);

  // e. long dashes added in the window
  const e = section(r.out, 'e');
  const claudeLines = fs.readFileSync(path.join(A, 'CLAUDE.md'), 'utf8').split('\n');
  const emLine = claudeLines.findIndex((l) => l.includes('\u2014')) + 1;
  t('e: an em dash added in the window and still there is listed with its line', e.includes(`CLAUDE.md:${emLine}  em dash, added ${D(3)}`), e);
  t('e: an en dash in a code file is listed', e.includes('src/util.js:1  en dash'), e);
  t('e: a double hyphen between words in prose is listed', e.includes('docs/guide.md:1  double hyphen'), e);
  t('e: a double hyphen in inline code, after a command word, or in a fence is not listed', !/docs\/guide\.md:[2-9]/.test(e), e);
  t('e: a double hyphen in a code file is not listed', !e.includes('src/code.mjs'), e);
  t('e: a dash fixed since is not listed', !e.includes('docs/fixed.md'), e);
  t('e: a dash in a renamed file is listed under its name today', e.includes('docs/after.md:1') && !e.includes('docs/before.md'), e);
  t('e: a case-only rename is listed under the new case', e.includes('docs/Case.md:1') && !e.includes('docs/case.md'), e);
  t('e: a case-only rename git sees as delete and add is listed once, under the name on disk', e.includes(`docs/Mixed.md:1  em dash, added ${D(2)}`) && !e.includes('docs/mixed.md'), e);
  t('e: a double hyphen inside inline code is not listed', !e.includes('docs/guide.md:4'), e);
  t('e: rows landing in an archive are not new text', !e.includes('History-archive.md'), e);
  t('e: a dash older than the window is not listed', !e.includes('notes/old.md'), e);
  // 2026-10-01: a rule may show the forbidden dash as its example.
  t('e: a dash inside inline code in prose is not listed', !e.includes('docs/rules.md:1  ') && !e.includes('docs/rules.md:2  '), e);
  t('e: a dash beside inline code on the same line is listed', e.includes(`docs/rules.md:3  em dash, added ${D(3)}`), e);
  t('e: a dash inside a ``` fence in prose is not listed', !e.includes('docs/rules.md:5  '), e);
  t('e: a dash inside a ~~~ fence in prose is not listed', !e.includes('docs/rules.md:8  '), e);
  t('e: a backtick that never closes is plain text, so its dash is listed', e.includes('docs/rules.md:10  em dash'), e);
  t('e: a double hyphen inside a double-backtick span is not listed', !e.includes('docs/rules.md:11  '), e);
  t('e: in a code file a dash between backticks is still listed', e.includes('src/msg.mjs:1  em dash'), e);
  t('e: the count is 9', countOf(e) === 9, e);
  t('e: --days 60 reaches the older dash', section(wide.out, 'e').includes('notes/old.md:1'), section(wide.out, 'e'));

  // f. .gitignore
  const f = section(r.out, 'f');
  t('f: a .gitignore without .tmp says so', f.includes('/.tmp/ is not kept out of git') && countOf(f) === 1, f);
  t('f: /backups/ present is not listed', !f.includes('/backups/'), f);

  // ---- project B: not a git repository ------------------------------------------
  const B = project('project b no git', {
    'CLAUDE.md': '# B\n\nRead `project-os/History.md`.\n',
    'project-os/History.md': '# B, History\n',
    '.gitignore': '.tmp/**\n**/backups\n',
  });
  r = audit(B);
  t('no git: exits 0', r.code === 0, r.out);
  t('no git: check a says "no git here"', section(r.out, 'a').endsWith('no git here'), r.out);
  t('no git: check e says "no git here"', section(r.out, 'e').endsWith('no git here'), r.out);
  t('no git: checks b, c and d still run, and find nothing here', countOf(section(r.out, 'b')) === 0 && countOf(section(r.out, 'c')) === 0 && countOf(section(r.out, 'd')) === 0, r.out);
  t('f: .tmp/** and **/backups count as keeping both out', countOf(section(r.out, 'f')) === 0, section(r.out, 'f'));

  // ---- project C: no .gitignore at all -------------------------------------------
  const C = project('project c', { 'CLAUDE.md': '# C\n' });
  r = audit(C);
  const fc = section(r.out, 'f');
  t('f: no .gitignore lists both folders', countOf(fc) === 2 && fc.includes('there is no .gitignore here') && fc.includes('/.tmp/') && fc.includes('/backups/'), fc);

  // ---- project D: a later "!" line brings .tmp back -----------------------------
  const DD = project('project d', { '.gitignore': '.tmp/\n!.tmp/\nbackups/*\n' });
  r = audit(DD);
  const fd = section(r.out, 'f');
  t('f: a later "!.tmp/" line un-ignores it', fd.includes('/.tmp/ is not kept out of git'), fd);
  t('f: backups/* keeps the folder out', !fd.includes('/backups/') && countOf(fd) === 1, fd);

  // ---- project E: a git repository with no commit yet ---------------------------
  const E = project('project e', { 'CLAUDE.md': '# E\n' }, { repo: true });
  r = audit(E);
  t('no commit yet: exits 0 with nothing found by a and e', r.code === 0 && countOf(section(r.out, 'a')) === 0 && countOf(section(r.out, 'e')) === 0, r.out);

  // ---- project F: Installation.md deleted after the install --------------------
  // 2026-10-01: the README lets the owner delete Installation.md once the
  // install is done, while CLAUDE.md keeps naming it. Only the root file is
  // meant: a path to it under project-os/ never existed, and is still a gap.
  const F = project('project f', {
    'CLAUDE.md': [
      '# F',
      '',
      'The install law was `Installation.md`, deleted after the install.',
      'The setup notes are in `Setup-notes.md`.',
      'A wrong home for it: `project-os/Installation.md`.',
      '',
    ].join('\n'),
    'project-os/Workflow.md': '# Workflow\n\nSee `./Installation.md` step 5.\n',
  });
  r = audit(F);
  const df = section(r.out, 'd');
  t('d: Installation.md, deleted after the install, is not listed', !df.split('\n').some((l) => / (\.\/)?Installation\.md$/.test(l)), df);
  t('d: another missing root file is still listed', df.includes('CLAUDE.md:4  Setup-notes.md'), df);
  t('d: Installation.md under project-os/ is still listed', df.includes('CLAUDE.md:5  project-os/Installation.md'), df);
  t('d: the count is 2', countOf(df) === 2, df);

  // ---- arguments ------------------------------------------------------------------
  r = audit(B, ['--days', 'abc', '--weird']);
  t('a bad --days and an unknown argument are noted, and it still exits 0', r.code === 0 && r.out.includes('--days takes a whole number') && r.out.includes('unknown argument "--weird"') && r.out.includes('Window: the last 30 days'), r.out);
  r = audit(B, ['--days=7']);
  t('--days=7 works too', r.code === 0 && r.out.includes(`Window: the last 7 days, ${D(6)} to ${D(0)}.`), r.out);

  // ---- an empty folder: nothing installed --------------------------------------------
  const EMPTY = project('empty folder');
  r = audit(EMPTY);
  t('an empty folder: exits 0 and prints all six checks', r.code === 0 && ['a', 'b', 'c', 'd', 'e', 'f'].every((x) => section(r.out, x)), r.out);

  // ---- it writes nothing ------------------------------------------------------------
  const before = git(A, ['status', '--porcelain', '--ignored']);
  audit(A);
  t('a run leaves the working tree exactly as it was', git(A, ['status', '--porcelain', '--ignored']) === before, before);

  // ---- no install placeholder in the kit's own machinery ---------------------------
  // Installation.md step 5 replaces every value in double curly braces in every
  // file under project-os/. One left in a script, even in a comment, has the
  // install edit that machinery file, and `Go update kit` then reads it as
  // changed here and stops updating it. This script's header held one until
  // 2026-10-01. Every file under project-os/ that is not a markdown template is
  // read, and so are the two machinery docs copied as they are.
  const TOKEN = /\{\{\s*[A-Za-z][\w-]*\s*\}\}/;
  const machineryFiles = [];
  const walkKit = (rel) => {
    for (const e of fs.readdirSync(path.join(KIT, ...rel.split('/')), { withFileTypes: true })) {
      const p = `${rel}/${e.name}`;
      if (e.isDirectory()) walkKit(p);
      else if (!/\.md$/i.test(e.name) || ['project-os/Hooks.md', 'project-os/Rule-reasons.md'].includes(p)) machineryFiles.push(p);
    }
  };
  walkKit('project-os');
  t('placeholders: the audit script and Compare-kit-files.mjs are among the files read', machineryFiles.includes('project-os/Audit-project-records.mjs') && machineryFiles.includes('project-os/Compare-kit-files.mjs'), machineryFiles.join('\n'));
  const carrying = machineryFiles.filter((p) => TOKEN.test(fs.readFileSync(path.join(KIT, ...p.split('/')), 'utf8')));
  t('placeholders: no machinery file under project-os/ carries a double-curly token', carrying.length === 0, carrying.join('\n'));
  t('placeholders: the pattern would catch one', TOKEN.test(`// c. placeholders like {{THIS}} left`) && !TOKEN.test("if (m === '{{') return '{';"));
} finally {
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

if (failures > 0) {
  console.error(`Audit-records-tests.mjs: ${failures} of ${ran} cases FAILED`);
  process.exit(1);
}
console.log(`Audit-records-tests.mjs: all ${ran} cases passed`);
