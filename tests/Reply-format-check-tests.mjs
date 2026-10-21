// Reply-format-check-tests.mjs - proves project-os/guards/Reply-format-check.mjs
// and the plugin's reply check around it (hooks/dispatch.mjs, stop and prompt).
//
//   node tests/Reply-format-check-tests.mjs
//
// Run from the kit root. Every project, transcript and note lives in one
// folder under the OS temp folder, removed at the end; nothing is written in
// the kit. The rules each case is judged by are the kit's own
// project-os/Conversations.md files, filled in the way an install fills them,
// so a reworded rule shows up here first.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { halfPaths, linesOf, projectNames } from '../project-os/guards/Reply-format-check.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(KIT, 'project-os', 'guards', 'Reply-format-check.mjs');
const DISPATCH = path.join(KIT, 'hooks', 'dispatch.mjs');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'reply check ')));

process.on('exit', () => {
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    // Best effort: the OS clears its temp folder in time.
  }
});

let cases = 0;
const test = (name, body) => {
  try {
    body();
    cases += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    console.log(`FAILED: ${name}`);
    throw error;
  }
};

// ---------------------------------------------------------------------------
// A project, filled in the way the install fills it
// ---------------------------------------------------------------------------

const kitRules = (name) => fs.readFileSync(path.join(KIT, 'project-os', name), 'utf8');

// The kit's own rules with the install's answers in: the owner's name and
// role, and the language block replaced by its one line.
const filled = (text) =>
  text
    .replace(/\{\{OWNER_NAME\}\}/g, 'Alex')
    .replace(/\{\{OWNER_ROLE\}\}/g, 'product designer')
    .replace(/^> \*\*Setup step: replace this block\*\*[\s\S]*?(?=\n\n)/m, 'Reply in English, always.');

let projects = 0;

function project({ main = filled(kitRules('Conversations.md')), second = filled(kitRules('Conversations-2.md')), marker = false } = {}) {
  const root = path.join(TMP, `project ${projects++}`);

  fs.mkdirSync(path.join(root, 'project-os'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src', 'pages'), { recursive: true });
  fs.writeFileSync(path.join(root, 'project-os', 'Conversations.md'), main);
  if (second !== null) fs.writeFileSync(path.join(root, 'project-os', 'Conversations-2.md'), second);
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '| Local app | `http://localhost:3000` |\n');
  fs.writeFileSync(path.join(root, 'src', 'pages', 'about.astro'), '---\n---\n');
  if (marker) fs.copyFileSync(path.join(KIT, 'project-os', 'Hooks-settings.json'), path.join(root, 'project-os', 'Hooks-settings.json'));

  return root;
}

let transcripts = 0;
const row = (role, content) => JSON.stringify({ type: role, message: { role, content } });

function transcript(reply, { ask = 'hi', rows = null } = {}) {
  const file = path.join(TMP, `transcript ${transcripts++}.jsonl`);
  const lines = rows ?? [row('user', ask), row('assistant', [{ type: 'text', text: reply }])];

  fs.writeFileSync(file, `${lines.join('\n')}\n`);

  return file;
}

const DEFAULT = project();
let notes = 0;

// The script run as the plugin runs it. Returns its exit code and the note it
// left, '' when it left none.
function check(reply, { root = DEFAULT, ask, rows, input } = {}) {
  const note = path.join(TMP, `note ${notes++}.txt`);
  const payload = input ?? JSON.stringify({ transcript_path: transcript(reply, { ask, rows }), stop_hook_active: false });
  const r = spawnSync(process.execPath, [SCRIPT], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, REPLY_CHECK_NOTE: note },
  });
  const text = fs.existsSync(note) ? fs.readFileSync(note, 'utf8') : '';

  return { code: r.status, note: text };
}

// The note's part for one rule, by the start of its line.
const flags = (reply, start, options) => {
  const r = check(reply, options);

  assert.equal(r.code, 0, 'the check never blocks');

  return r.note.split('\n').some((line) => line.startsWith(start));
};

const lines = (count) => Array.from({ length: count }, (_, i) => `Line number ${i + 1} of the reply.`).join('\n');

// ---------------------------------------------------------------------------
// The language
// ---------------------------------------------------------------------------

test('language: Hebrew in prose, where the rules name English -> note', () => {
  assert.equal(flags('The build is green.\n\u05ea\u05d5\u05d3\u05d4 \u05e8\u05d1\u05d4.', 'The reply language'), true);
});

test('language: accented Latin is English enough -> clean', () => {
  assert.equal(flags('The caf\u00e9 page is green.', 'The reply language'), false);
});

test('language: another script inside inline code or a fence -> clean', () => {
  assert.equal(flags('The label reads `\u05e9\u05dc\u05d5\u05dd` now.', 'The reply language'), false);
  assert.equal(flags('The label:\n\n```\n\u05e9\u05dc\u05d5\u05dd\n```', 'The reply language'), false);
});

test('language: a project that replies in another language is not checked', () => {
  const root = project({ main: filled(kitRules('Conversations.md')).replace('Reply in English, always.', 'Reply in Hebrew, always.') });

  assert.equal(flags('\u05d4\u05db\u05dc \u05d9\u05e8\u05d5\u05e7.', 'The reply language', { root }), false);
});

// ---------------------------------------------------------------------------
// Rule 3, and rule 10: the dividers
// ---------------------------------------------------------------------------

test('rule 3: a # H1 with ---- directly above, or ---- and one blank line -> clean', () => {
  assert.equal(flags('----\n# Changed\n\nThe build is green.', 'Rule 3 ('), false);
  assert.equal(flags('----\n\n# Changed\n\nThe build is green.', 'Rule 3 ('), false);
});

test('rule 3: a # H1 with no divider above -> note', () => {
  assert.equal(flags('The build is green.\n\n# Next\n\nSay Go commit.', 'Rule 3 ('), true);
});

test('rule 3: a # inside a fence is no heading, and ## is not checked -> clean', () => {
  assert.equal(flags('Run this:\n\n```sh\n# a comment\nnpm test\n```', 'Rule 3 ('), false);
  assert.equal(flags('Some text.\n\n## sub\n\nMore text.', 'Rule 3 ('), false);
});

// The shape that bit on 2026-10-21: a plan's numbered points, each glued to
// the line above it.
test('rule 10: a numbered bold point glued to the line above -> note', () => {
  assert.equal(flags('Model: the faster one.\n**2 \u00b7 One Atom opened by shape**\nEach row gets its own strip.', 'Rule 10 ('), true);
});

test('rule 10: the first point right under its # H1, no divider of its own -> note', () => {
  assert.equal(flags('----\n# Plan\n\n**1 \u00b7 A strip under every slider**\n\nClicking one moves the slider.', 'Rule 10 ('), true);
});

test('rule 10: a numbered bold point with ---- above, or ---- and a blank line -> clean', () => {
  assert.equal(flags('----\n# Plan\n\n----\n**1 \u00b7 A strip under every slider**\n\nIt moves.', 'Rule 10 ('), false);
  assert.equal(flags('The plan is set.\n\n----\n\n**1 \u00b7 A strip under every slider**\n\nIt moves.', 'Rule 10 ('), false);
});

test('rule 10: an unnumbered bold headline that a Problem label follows -> note', () => {
  assert.equal(
    flags('One finding.\n\n**Status column is ambiguous**\n\nProblem:\nIt reads two ways.\n\nProposal:\nPick one.', 'Rule 10 ('),
    true,
  );
});

test('rule 10: bold labels inside a point are not headlines -> clean', () => {
  assert.equal(
    flags('----\n**Status column is ambiguous**\n\n&nbsp;\n\n**Problem:**\nIt reads two ways.\n\n&nbsp;\n\n**Proposal:**\nPick one.', 'Rule 10 ('),
    false,
  );
});

test('rule 10: bold status headers (rule 11) take no divider -> clean', () => {
  assert.equal(flags('Where things stand.\n\n**Done**\nThe header.\n\n**Not started**\nThe footer.', 'Rule 10 ('), false);
});

test('rule 10: a bold point in a fence, and a line of two bold spans -> clean', () => {
  assert.equal(flags('Here:\n\n```\nDone.\n**1 \u00b7 A point in an example**\n```', 'Rule 10 ('), false);
  assert.equal(flags('Green.\n**1 \u00b7 one** and **2 \u00b7 two** both landed.', 'Rule 10 ('), false);
});

test('rule 10: the kit rule\'s own example passes', () => {
  const example = /### 10 \u00b7[\s\S]*?~~~\n([\s\S]*?)~~~/.exec(kitRules('Conversations.md'))[1];

  assert.equal(flags(example, 'Rule 10 ('), false);
  assert.equal(flags(example, 'Rule 3 ('), false);
});

// ---------------------------------------------------------------------------
// Rule 5: one sentence per line
// ---------------------------------------------------------------------------

test('rule 5: two sentences on one line -> note', () => {
  assert.equal(flags('The build is green. Say Go commit to lock it in.', 'Rule 5 ('), true);
  assert.equal(flags('It runs on the host (not here). The page fails locally.', 'Rule 5 ('), true);
});

test('rule 5: one per line, abbreviations, a fence, a numbered list -> clean', () => {
  assert.equal(flags('The build is green.\nSay Go commit to lock it in.', 'Rule 5 ('), false);
  assert.equal(flags("Skip stops that aren't ends, e.g. Foo and i.e. Bar.", 'Rule 5 ('), false);
  assert.equal(flags('Run:\n\n```\nfoo. Bar baz. Qux\n```', 'Rule 5 ('), false);
  assert.equal(flags('1) Create it.\n2) Copy it.\n3) Paste it.', 'Rule 5 ('), false);
});

test('rule 5: inline code right before a real second sentence still counts -> note', () => {
  assert.equal(flags('Set `CONTACT_FROM`. Then push once more.', 'Rule 5 ('), true);
});

// ---------------------------------------------------------------------------
// Rule 1: the ceiling and the words, read from the rule itself
// ---------------------------------------------------------------------------

test('rule 1: three prose lines -> clean, four -> note', () => {
  assert.equal(flags(lines(3), 'Rule 1 (cut hard)'), false);
  assert.equal(flags(lines(4), 'Rule 1 (cut hard)'), true);
});

test('rule 1: dividers, headings, blank and gap lines and fences are not counted', () => {
  const reply = `----\n# Changed\n\n${lines(2)}\n\n&nbsp;\n\n\`\`\`\nnpm test\nnpm run build\n\`\`\`\n\n----\n# Next\n\nSay Go commit.`;

  assert.equal(flags(reply, 'Rule 1 (cut hard)'), false);
});

test('rule 1: a full report lifts the ceiling to the rule\'s sixteen lines, never past them', () => {
  assert.equal(flags(lines(16), 'Rule 1 (cut hard)', { ask: 'do it and give me a full report' }), false);
  assert.equal(flags(lines(17), 'Rule 1 (cut hard)', { ask: 'do it and give me a full report' }), true);
});

test('rule 1: a findings list, plain or bold labels, has no line ceiling', () => {
  const item = (i, bold) =>
    `----\n**${i} \u00b7 Item ${i}**\n\n${bold ? '**Problem:**' : 'Problem:'}\nIt breaks.\n\n${bold ? '**Proposal:**' : 'Proposal:'}\nFix it.\nIt works.`;

  assert.equal(flags([1, 2, 3].map((i) => item(i, false)).join('\n\n'), 'Rule 1 (cut hard)'), false);
  assert.equal(flags([1, 2, 3].map((i) => item(i, true)).join('\n\n'), 'Rule 1 (cut hard)'), false);
});

test('rule 1: the words in a line, read from the rule (sixteen in the kit)', () => {
  const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

  assert.equal(flags(`${words(16)}.`, 'Rule 1 (16 words'), false);
  assert.equal(flags(`${words(17)}.`, 'Rule 1 (16 words'), true);
});

test('rule 1: a project with its own numbers is held to its own', () => {
  const main = filled(kitRules('Conversations.md'))
    .replace('3 prose lines, each at most 16 WORDS', '5 prose lines, each at most 12 WORDS');
  const root = project({ main });

  assert.equal(flags(lines(5), 'Rule 1 (cut hard)', { root }), false);
  assert.equal(flags(lines(6), 'Rule 1 (cut hard)', { root }), true);
  assert.equal(flags('One two three four five six seven eight nine ten eleven twelve thirteen.', 'Rule 1 (12 words', { root }), true);
});

test('rule 1: the FAST MODE offer, quoted verbatim, counts against nothing', () => {
  const offer = /> Suggestion to improve your work:[\s\S]*?Say FAST OFF[^\n]*/.exec(fs.readFileSync(path.join(KIT, 'CLAUDE.md'), 'utf8'))[0];
  const reply = `The spacing is 12 now.\n\n${offer}`;

  assert.equal(flags(reply, 'Rule 1 ('), false);
  assert.equal(flags(reply, 'Rule 5 ('), false);
});

// ---------------------------------------------------------------------------
// Rule 8: two asks are two numbered items
// ---------------------------------------------------------------------------

test('rule 8: two asks in one sentence of the closing section -> note', () => {
  const reply = '----\n# Next\n\nSay fix, drop or backlog on the list page and tell me if you want the footer too.';

  assert.equal(flags(reply, 'Rule 8 ('), true);
});

test('rule 8: the same asks numbered, or one ask alone -> clean', () => {
  assert.equal(flags('----\n# Next\n\n1) Say fix, drop or backlog.\n2) Tell me about the footer.', 'Rule 8 ('), false);
  assert.equal(flags('----\n# Next\n\nSay Go commit to lock it in.', 'Rule 8 ('), false);
  assert.equal(flags('----\n# Next\n\nDo you want me to tell you when it lands?', 'Rule 8 ('), false);
});

// ---------------------------------------------------------------------------
// Rule 12: links and paths in full
// ---------------------------------------------------------------------------

test('rule 12, as the kit writes it: a lone half route or host in a fence -> note', () => {
  assert.equal(flags('The page:\n\n```\n/admin/users\n```', 'Rule 12 ('), true);
  assert.equal(flags('The page:\n\n```\nlocalhost:3000/about\n```', 'Rule 12 ('), true);
  assert.equal(flags('The page:\n\n```\n/about\n```', 'Rule 12 ('), true);
});

test('rule 12, as the kit writes it: full addresses and paths -> clean', () => {
  assert.equal(flags('The page:\n\n```\nhttp://localhost:3000/admin/users\n```', 'Rule 12 ('), false);
  assert.equal(flags('The file:\n\n```\nD:\\Work\\Site\\src\\app.js\n```', 'Rule 12 ('), false);
});

test('rule 12, as the kit writes it: a name in prose, code, and a command that enters the folder -> clean', () => {
  assert.equal(flags('The rule lives in `project-os/Conversations.md` now.', 'Rule 12 ('), false);
  assert.equal(flags('The fix:\n\n```js\nimport { x } from \'./lib/x.js\'\n```', 'Rule 12 ('), false);
  assert.equal(flags('Run:\n\n```\ncd "D:\\Work\\Site" && node project-os/Find-heavy-files.mjs\n```', 'Rule 12 ('), false);
  assert.equal(flags('Press /compact and the verdicts are fix/drop/backlog.', 'Rule 12 ('), false);
});

test('rule 12, as the note words it: the project\'s own address and folder', () => {
  const r = check('The page:\n\n```\n/admin/users\n```');

  assert.match(r.note, /http:\/\/localhost:3000\/\.\.\. for a page here/);
  assert.ok(r.note.includes(`${DEFAULT}${path.sep}... for a file`));
});

test('rule 12, where the project wants every path in full: a name in backticks too -> note', () => {
  const main = filled(kitRules('Conversations.md')).replace(/A path named only to identify a file[\s\S]*?stays inline\.\n/, '');
  const root = project({ main });

  assert.equal(flags('The rule lives in `project-os/Conversations.md` now.', 'Rule 12 (', { root }), true);
  assert.equal(flags('Open example.com/about and look.', 'Rule 12 (', { root }), true);
  assert.equal(flags('Open https://example.com/about and look.', 'Rule 12 (', { root }), false);
});

// ---------------------------------------------------------------------------
// Only what the project's rules state, under the project's numbers
// ---------------------------------------------------------------------------

test('a rule the project dropped is not checked', () => {
  const main = filled(kitRules('Conversations.md')).replace('Give EVERY point, numbered or not, a **bold** headline with `----` above it.\n', '');
  const root = project({ main });

  assert.equal(flags('Done.\n**1 \u00b7 Glued**\nText.', 'Rule 10 (', { root }), false);
  assert.equal(flags('Done.\n**1 \u00b7 Glued**\nText.', 'Rule 10 ('), true);
});

test('a project that renumbered its rules is told its own numbers', () => {
  const main = filled(kitRules('Conversations.md'))
    .replace('### 3 \u00b7 Section dividers', '### 30 \u00b7 Section dividers')
    .replace('### 10 \u00b7 Stacked list points', '### 40 \u00b7 Stacked list points');
  const root = project({ main });

  assert.equal(flags('Text.\n\n# Next\n\nSay it.', 'Rule 30 (', { root }), true);
  assert.equal(flags('Done.\n**1 \u00b7 Glued**\nText.', 'Rule 40 (', { root }), true);
});

test('a rule in a continuation file is read, under its number there', () => {
  const kit = filled(kitRules('Conversations.md'));
  const cut = kit.indexOf('### 5 \u00b7');
  const next = kit.indexOf('### 6 \u00b7');
  const main = kit.slice(0, cut) + kit.slice(next);
  const second = `${filled(kitRules('Conversations-2.md'))}\n### 28 \u00b7 One line each\n\nBreak after every sentence-ending period: one sentence per line, never two.\n`;
  const root = project({ main, second });

  assert.equal(flags('Green. Say Go commit.', 'Rule 28 (', { root }), true);
});

// ---------------------------------------------------------------------------
// When it stays silent
// ---------------------------------------------------------------------------

test('mid-install: rules that still hold a setup placeholder are not checked', () => {
  const root = project({ main: kitRules('Conversations.md'), second: kitRules('Conversations-2.md') });

  assert.equal(check(lines(9), { root }).note, '');
});

test('a project with no Conversations.md: nothing', () => {
  const root = path.join(TMP, 'bare');

  fs.mkdirSync(root, { recursive: true });
  assert.equal(check(lines(9), { root }).note, '');
});

test('a reply of an earlier turn is never judged again', () => {
  const rows = [row('user', 'hi'), row('assistant', [{ type: 'text', text: lines(9) }]), row('user', 'thanks')];

  assert.equal(check('', { rows }).note, '');
});

test('a tool result is no new turn: the full report asked before it still holds', () => {
  const rows = [
    row('user', 'give me a full report'),
    row('assistant', [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }]),
    row('user', [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]),
    row('assistant', [{ type: 'text', text: lines(10) }]),
  ];

  assert.equal(check('', { rows }).note, '');
});

test('garbage, no transcript, a missing transcript: exit 0, no note', () => {
  for (const input of ['not json', 'null', '{}', JSON.stringify({ transcript_path: path.join(TMP, 'none.jsonl') })]) {
    const r = check('', { input });

    assert.equal(r.code, 0);
    assert.equal(r.note, '');
  }
});

// The check when a turn ends can send the assistant back, and the reply
// that then closes the turn arrives on a second Stop. It is the one the owner
// read last, so it is read too: this check never blocks, so it cannot loop.
test('the second Stop of a turn reads the reply that closed it', () => {
  const input = JSON.stringify({ transcript_path: transcript('Fixed the build. The import was wrong.'), stop_hook_active: true });

  assert.match(check('', { input }).note, /^Rule 5 \(/m);
});

// Only the owner typing starts a turn: rows the harness writes on its own
// never reset it, and never stand in for what the owner asked.
test('turn: a caption, a skill text, a task notice and a request copy are not the owner typing', () => {
  const asked = row('user', 'give me a full report on the audit');
  const answer = row('assistant', [{ type: 'text', text: lines(10) }]);
  const extras = [
    JSON.stringify({ type: 'user', isMeta: true, message: { role: 'user', content: [{ type: 'text', text: '[Image: source: shot.png]' }] } }),
    JSON.stringify({ type: 'user', isMeta: true, message: { role: 'user', content: [{ type: 'text', text: 'Base directory for this skill: x' }] } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: '<task-notification>\n<task-id>x</task-id>\n</task-notification>' } }),
    JSON.stringify({ type: 'api-request-blob', message: { role: 'user', content: [{ type: 'text', text: 'an older message' }] } }),
  ];

  for (const extra of extras) assert.equal(check('', { rows: [asked, extra, answer] }).note, '', extra.slice(0, 60));
});

test('turn: a request copy that quotes an old full report does not lift this turn', () => {
  const rows = [
    row('user', 'what about the footer?'),
    JSON.stringify({ type: 'api-request-blob', message: { role: 'user', content: [{ type: 'text', text: 'full report on the audit' }] } }),
    row('assistant', [{ type: 'text', text: lines(8) }]),
  ];

  assert.match(check('', { rows }).note, /Rule 1 \(cut hard\)/);
});

test('rule 1: the phrase asks however it is joined: full-report, full_report, fullreport', () => {
  for (const ask of ['a full-report please', 'full_report', 'fullreport now', 'Full\nReport']) {
    assert.equal(flags(lines(10), 'Rule 1 (cut hard)', { ask }), false, ask);
  }
});

test('rule 1: a lift sentence wrapped over two lines still lifts, and a file name in it asks nothing', () => {
  const main = filled(kitRules('Conversations.md')).replace(
    'Otherwise it lifts ONLY when the owner asks for a `full report`: 16 prose lines,',
    'Otherwise it lifts ONLY when the owner asks for a `full report` or a `weekly summary`:\n16 prose lines,',
  );
  const root = project({ main });

  assert.equal(flags(lines(12), 'Rule 1 (cut hard)', { root, ask: 'the weekly summary' }), false);
  assert.equal(flags(lines(12), 'Rule 1 (cut hard)', { root, ask: 'see Installation.md' }), true);
});

// The install's closing report is exempt from the line ceiling (rule 1 and
// Installation.md, step 8). It is known by its first and last sections, so
// those names are read from Installation.md here: a rename fails this case.
test('rule 1: the install\'s closing report is exempt from the line ceiling', () => {
  const steps = fs.readFileSync(path.join(KIT, 'Installation.md'), 'utf8');

  assert.match(steps, /\*\*What was set\.\*\*/);
  assert.match(steps, /\*\*Waiting on you\.\*\*/);

  const report = `----\n# What was set\n\n${lines(12)}\n\n----\n# Waiting on you\n\nNothing is waiting on you.`;

  assert.equal(flags(report, 'Rule 1 (cut hard)'), false);
  assert.equal(flags(`----\n# Changed\n\n${lines(12)}`, 'Rule 1 (cut hard)'), true);
});

test('language: symbols and units are no other language, a heading in one is', () => {
  for (const line of ['The reveal waits 40 \u00b5s less.', 'The circle uses 2\u03c0r now.', 'The \u0394 is 4 KB.', 'The resistor is 10 k\u03a9.', 'Push to live, it explains itself \u2139\ufe0f']) {
    assert.equal(flags(line, 'The reply language'), false, line);
  }
  assert.equal(flags('----\n# \u05e1\u05d9\u05db\u05d5\u05dd\n\nThe page saves now.', 'The reply language'), true);
});

test('rule 5: a list marker, a quote, initials and short forms are not sentence ends', () => {
  for (const reply of ['Two steps:\n\n1. Open the settings page.\n2. Press save.', 'The hero now reads "Design that ships. Code that lasts." on top.', 'The quote is from J. K. Rowling now.', 'The cover shows Mt. Fuji at dawn.']) {
    assert.equal(flags(reply, 'Rule 5 ('), false, reply);
  }
});

test('rule 8: the assistant\'s own "and pick", a lead-in question and a quoted question are one ask', () => {
  for (const close of [
    'Say `Gate` and I hold the reveal and confirm it on a cold cache.',
    'Say `Fonts` and I test both and pick the faster one.',
    'Same treatment for the search page?\nSay `Search` and I start.',
    'The banner now reads "Still there?" after a minute.\nSay `Go commit` when you want it.',
  ]) {
    assert.equal(flags(`----\n# Next\n\n${close}`, 'Rule 8 ('), false, close);
  }
});

test('rule 12: a full path on macOS or Linux is whole', () => {
  const names = projectNames('/Users/alex/code/northwind');

  for (const lone of ['/Users/alex/code/northwind/project-os/Conversations.md', '/home/alex/northwind/.tmp/build.log']) {
    assert.deepEqual(halfPaths(linesOf(`The file:\n\n\`\`\`\n${lone}\n\`\`\`\n`), names, false), [], lone);
  }
  assert.deepEqual(halfPaths(linesOf('The page:\n\n```\n/admin/users\n```\n'), names, false), ['/admin/users']);
});

test('rule 12: a fence of several lines is code or a file, not addresses', () => {
  assert.equal(flags('Add these to the ignore file:\n\n```\n.tmp/\n.env\n/dist/\n```', 'Rule 12 ('), false);
});

test('rule 8: a findings list\'s proposals are not asks to the owner', () => {
  const point = (i, fix) => `----\n**${i} \u00b7 Point ${i}**\n\nProblem:\nIt reads two ways.\n\nProposal:\n${fix}`;
  const reply = `----\n# Review findings\n\n${point(1, 'Pick one meaning and label it.')}\n\n${point(2, 'Choose one name for both screens.')}`;

  assert.equal(flags(reply, 'Rule 8 ('), false);
});

test('a project that renamed rule 10\'s labels has its findings lists read by its own labels', () => {
  const main = filled(kitRules('Conversations.md')).replace('`Problem:`, `Proposal:`', '`Issue:`, `Fix:`');
  const root = project({ main });
  const item = (i) => `----\n**${i} \u00b7 Item ${i}**\n\nIssue:\nIt breaks.\n\nFix:\nPick the other one.\nIt works.`;
  const list = [1, 2, 3].map(item).join('\n\n');

  assert.equal(flags(list, 'Rule 1 (cut hard)', { root }), false);
  assert.equal(flags(list, 'Rule 8 (', { root }), false);
  assert.equal(flags('Text.\n\n**Glued headline**\n\nIssue:\nIt breaks.', 'Rule 10 (', { root }), true);
});

test('rule 5: one initial alone still ends a sentence', () => {
  assert.equal(flags('I would ship B. It keeps the old links.', 'Rule 5 ('), true);
});

test('a lone indented marker, a tab, and an indented marker inside a fence never hide what follows', () => {
  for (const reply of [
    'List item:\n\n    ```\n\nFirst one. Second one.\n\nThe page:\n\n```\nhttp://localhost:3000/x\n```',
    'List item:\n\n\t```\n\nFirst one. Second one.',
    '```\n- step one\n    ```\n- step two\n```\n\nFirst one. Second one.',
    'List item:\n\n    ```\n\nFirst one. Second one.',
  ]) {
    assert.equal(flags(reply, 'Rule 5 ('), true, reply);
  }
});

test('turn: a slash command the owner typed starts a turn', () => {
  const rows = [
    row('user', 'give me a full report'),
    row('assistant', [{ type: 'text', text: 'Long one.' }]),
    row('user', '<command-name>/ultrareview</command-name>'),
    row('assistant', [{ type: 'text', text: lines(6) }]),
  ];

  assert.match(check('', { rows }).note, /Rule 1 \(cut hard\)/);
});

test('the second Stop adds to the first Stop\'s note, never replaces it', () => {
  const note = path.join(TMP, 'kept note.txt');
  const run = (input) =>
    spawnSync(process.execPath, [SCRIPT], { input, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: DEFAULT, REPLY_CHECK_NOTE: note } });

  run(JSON.stringify({ transcript_path: transcript(lines(10)) }));
  run(JSON.stringify({ transcript_path: transcript('The type check broke. It is fixed now.'), stop_hook_active: true }));

  const kept = fs.readFileSync(note, 'utf8');

  assert.match(kept, /Rule 1 \(cut hard\)/);
  assert.match(kept, /Rule 5 \(/);
});

test('a fence inside a list item, indented four spaces, is still a fence', () => {
  const reply = '1) Run it:\n\n    ```\n    # from the project folder\n    npm test\n    ```';

  assert.equal(flags(reply, 'Rule 3 ('), false);
  assert.equal(flags(reply, 'Rule 1 (cut hard)'), false);
});

test('a clean reply leaves no note, and a note tells never to resend', () => {
  assert.equal(check('----\n# Changed\n\nThe build is green.').note, '');
  assert.match(check(lines(5)).note, /^REPLY FORMAT:[\s\S]*Never resend it/);
});

// ---------------------------------------------------------------------------
// The plugin: the note at Stop, printed once with the next message
// ---------------------------------------------------------------------------

const PLUGIN_TMP = path.join(TMP, 'os temp');

fs.mkdirSync(PLUGIN_TMP, { recursive: true });

function plugin(word, root, payload, env = {}) {
  const r = spawnSync(process.execPath, [DISPATCH, word], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: {
      ...process.env,
      TEMP: PLUGIN_TMP,
      TMP: PLUGIN_TMP,
      TMPDIR: PLUGIN_TMP,
      CLAUDE_PROJECT_DIR: root,
      PROJECTOS_APPROVED_FILE: path.join(TMP, 'approved.json'),
      ...env,
    },
  });

  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

const stopWith = (root, reply, sid) => plugin('stop', root, { session_id: sid, transcript_path: transcript(reply), cwd: root });
const prompt = (root, sid) => plugin('prompt', root, { session_id: sid, prompt: 'next' });

test('plugin: a reply that broke a rule leaves a note, printed with the next message only', () => {
  const root = project({ marker: true });

  assert.equal(stopWith(root, lines(5), 'session-a').code, 0);

  const first = prompt(root, 'session-a');

  assert.equal(first.code, 0);
  assert.match(first.out, /<reply-format-check>\nREPLY FORMAT:[\s\S]*Rule 1 \(cut hard\)[\s\S]*<\/reply-format-check>/);
  assert.match(first.out, /STANDING RULES/);
  assert.doesNotMatch(prompt(root, 'session-a').out, /reply-format-check/);
});

test('plugin: a clean reply leaves nothing, and a note stays with its own session', () => {
  const root = project({ marker: true });

  stopWith(root, '----\n# Changed\n\nThe build is green.', 'session-b');
  assert.doesNotMatch(prompt(root, 'session-b').out, /reply-format-check/);

  stopWith(root, lines(5), 'session-c');
  assert.doesNotMatch(prompt(root, 'session-d').out, /reply-format-check/);
  assert.match(prompt(root, 'session-c').out, /reply-format-check/);
});

test('plugin: the kit\'s own script wired in settings has nowhere to leave a note, so the plugin keeps running', () => {
  const root = project({ marker: true });

  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.claude', 'settings.json'),
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PROJECT_DIR}/project-os/guards/Reply-format-check.mjs"' }] }] } }),
  );
  stopWith(root, lines(5), 'session-h');
  assert.match(prompt(root, 'session-h').out, /reply-format-check/);
});

test('plugin: a project that wires its own reply check on Stop keeps it', () => {
  const root = project({ marker: true });

  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.claude', 'settings.json'),
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node scripts/conversations-lint.mjs' }] }] } }),
  );
  stopWith(root, lines(5), 'session-e');
  assert.doesNotMatch(prompt(root, 'session-e').out, /reply-format-check/);
});

test('plugin: with no session id there is nowhere to keep a note, so none', () => {
  const root = project({ marker: true });

  assert.equal(plugin('stop', root, { transcript_path: transcript(lines(5)) }).code, 0);
  assert.equal(fs.existsSync(path.join(PLUGIN_TMP, 'ProjectOS-plugin-replies', 'undefined.txt')), false);
});

test('plugin: in the kit repository itself the reply check does not run', () => {
  assert.equal(stopWith(KIT, lines(5), 'session-f').code, 0);
  assert.equal(fs.existsSync(path.join(PLUGIN_TMP, 'ProjectOS-plugin-replies', 'session-f.txt')), false);
});

test('plugin: the check when a turn ends still sends back a failure after the reply check', () => {
  const root = project({ marker: true });

  spawnSync('git', ['init', '-q'], { cwd: root });
  fs.writeFileSync(path.join(root, 'app.js'), 'broken\n');
  fs.writeFileSync(path.join(root, 'project-os', 'Check-command.json'), JSON.stringify({ command: 'node -e "process.exit(1)"' }));
  plugin('approve', root, {});

  const r = stopWith(root, lines(5), 'session-g');

  assert.equal(r.code, 2);
  assert.match(r.err, /CHECK FAILED/);
  assert.match(prompt(root, 'session-g').out, /reply-format-check/);
});

console.log(`Reply-format-check-tests.mjs: all ${cases} cases passed`);
