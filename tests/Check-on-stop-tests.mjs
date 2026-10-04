// Tests for the check that runs when a turn ends: the guard
// project-os/guards/Check-on-stop.mjs, and the plugin's `stop` and `approve`
// words in hooks/dispatch.mjs.
// Run from the kit root: node tests/Check-on-stop-tests.mjs
// Self-contained: each case builds a throwaway git repository in the OS temp
// folder, with a stand-in check command, and asserts the exit code (0 = the
// turn may end, 2 = the assistant is sent back). The approvals are kept in a
// file of the test's own, never in the plugin folder.
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { changedIn, isCode, isFastReply, lastReplyIn, tailOf } from '../project-os/guards/Check-on-stop.mjs';

const KIT = fileURLToPath(new URL('..', import.meta.url));
const GUARD = path.join(KIT, 'project-os', 'guards', 'Check-on-stop.mjs');
const DISPATCH = path.join(KIT, 'hooks', 'dispatch.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-on-stop-'));
const APPROVED = path.join(dir, 'approved.json');

process.on('exit', () => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup, never mask a test failure
  }
});

let seq = 0;
let cases = 0;

const PASS = 'node -e "process.exit(0)"';
const FAIL = 'node -e "console.error(\'src/app.ts:3:1 - error TS2304: Cannot find name\');process.exit(1)"';

function git(root, ...args) {
  const ran = spawnSync('git', args, { cwd: root, encoding: 'utf8' });

  assert.equal(ran.status, 0, `git ${args.join(' ')}: ${ran.stderr}`);
}

/** A repository carrying the kit, with one committed source file. */
function repo({ command = '' } = {}) {
  const root = path.join(dir, `repo-${seq++}`);

  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'project-os'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'app.ts'), 'export const a = 1\n');
  fs.writeFileSync(path.join(root, 'README.md'), 'hello\n');
  fs.writeFileSync(path.join(root, 'project-os', 'Hooks-settings.json'), '{ "hooks": {} }\n');
  fs.writeFileSync(path.join(root, 'project-os', 'History.md'), '# History\n');
  fs.writeFileSync(path.join(root, 'project-os', 'Check-command.json'), JSON.stringify({ command }));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'first');

  return root;
}

function payloadFor(root, reply) {
  const folder = path.join(dir, `aside-${path.basename(root)}`);
  const file = path.join(folder, `transcript-${seq++}.jsonl`);
  const rows = [
    { type: 'user', message: { role: 'user', content: 'change it' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: reply }] } },
  ];

  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n'));

  return JSON.stringify({ transcript_path: file, cwd: root });
}

/** The guard alone, handed its command the way the plugin hands it. */
function guard(root, command, { reply = 'Done.', input } = {}) {
  const ran = spawnSync('node', [GUARD], {
    encoding: 'utf8',
    input: input ?? payloadFor(root, reply),
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: root,
      CHECK_ON_STOP_COMMAND: command,
      CHECK_ON_STOP_STATE: path.join(dir, `state-${path.basename(root)}.json`),
    },
  });

  return { code: ran.status, err: ran.stderr };
}

/** The plugin's own word, as Claude Code or the install would run it. */
function plugin(word, root, { reply = 'Done.' } = {}) {
  const ran = spawnSync('node', [DISPATCH, word], {
    cwd: root,
    encoding: 'utf8',
    input: word === 'stop' ? payloadFor(root, reply) : '',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, PROJECTOS_APPROVED_FILE: APPROVED },
  });

  return { code: ran.status, out: ran.stdout, err: ran.stderr };
}

function setCommand(root, command) {
  fs.writeFileSync(path.join(root, 'project-os', 'Check-command.json'), JSON.stringify({ command }));
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'check command');
}

function breakCode(root, text = 'export const a: number = "no"\n') {
  fs.writeFileSync(path.join(root, 'src', 'app.ts'), text);
}

function test(name, body) {
  cases += 1;

  try {
    body();
  } catch (error) {
    console.error(`FAILED: ${name}`);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// The pure parts
// ---------------------------------------------------------------------------

test('code is every changed file that is not a record or a note', () => {
  assert.equal(isCode('src/pages/index.astro'), true);
  assert.equal(isCode('lib\\media.ts'), true);
  assert.equal(isCode('package.json'), true);
  assert.equal(isCode('Cargo.toml'), true);
  assert.equal(isCode('project-os/History.md'), false);
  assert.equal(isCode('project-os/guards/Path-guard.mjs'), false);
  assert.equal(isCode('CLAUDE.md'), false);
  assert.equal(isCode('docs/guide.MD'), false);
  assert.equal(isCode('plans/idea.txt'), false);
  assert.equal(isCode('.claude/settings.json'), false);
});

test('changed paths are read out of git status, renames by their new name', () => {
  const out = [' M src/a.ts', '?? src/new/x.ts', 'R  src/old.ts -> src/b.ts', ' M "src/with space.ts"', ''].join('\n');

  assert.deepEqual(changedIn(out), ['src/a.ts', 'src/new/x.ts', 'src/b.ts', 'src/with space.ts']);
  assert.deepEqual(changedIn(''), []);
});

test('the last reply is found, and a tool call after it does not hide it', () => {
  const rows = [
    { type: 'assistant', message: { content: [{ type: 'text', text: 'first' }] } },
    { type: 'user', message: { content: 'again' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'second' }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } },
    'not json',
    null,
  ];

  assert.equal(lastReplyIn(rows.map((row) => (typeof row === 'string' ? row : JSON.stringify(row))).join('\n')), 'second');
  assert.equal(lastReplyIn(''), '');
});

test('the fast mode footer counts only as the last line, alone', () => {
  assert.equal(isFastReply('# Changed\n\nDone.\n\n----\n\nFast mode on\n'), true);
  assert.equal(isFastReply('fast mode on'), true);
  assert.equal(isFastReply('Fast mode on, as you asked.\n\nDone.'), false);
  assert.equal(isFastReply(''), false);
});

test('the shown output is the end of it, without color codes', () => {
  const out = `${Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n')}\n\u001b[31merror\u001b[0m here\n`;
  const shown = tailOf(out).split('\n');

  assert.equal(shown.length, 40);
  assert.equal(shown[shown.length - 1], 'error here');
});

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

test('with no command there is no check', () => {
  const root = repo();

  breakCode(root);
  assert.equal(guard(root, '').code, 0);
});

test('a turn that changed only records runs no check', () => {
  const root = repo();

  fs.writeFileSync(path.join(root, 'README.md'), 'changed docs\n');
  fs.writeFileSync(path.join(root, 'project-os', 'History.md'), '# History\n\nrow\n');
  // The failing command proves it was never run.
  assert.equal(guard(root, FAIL).code, 0);
});

test('changed code that passes lets the turn end, and is not checked twice', () => {
  const root = repo();

  breakCode(root, 'export const a = 2\n');
  assert.equal(guard(root, PASS).code, 0);
  assert.equal(guard(root, FAIL).code, 0);
});

test('changed code that fails sends the assistant back, with the errors', () => {
  const root = repo();

  breakCode(root);

  const ran = guard(root, FAIL);

  assert.equal(ran.code, 2);
  assert.match(ran.err, /CHECK FAILED/);
  assert.match(ran.err, /Cannot find name/);
  assert.match(ran.err, /Do not repeat it/);
});

test('the same failing state is reported once, and a new state is checked again', () => {
  const root = repo();

  breakCode(root);
  assert.equal(guard(root, FAIL).code, 2);
  assert.equal(guard(root, FAIL).code, 0);
  breakCode(root, 'export const a: number = "still no, and longer"\n');
  assert.equal(guard(root, FAIL).code, 2);
});

test('a new file counts as changed code', () => {
  const root = repo();

  fs.mkdirSync(path.join(root, 'src', 'new'));
  fs.writeFileSync(path.join(root, 'src', 'new', 'thing.ts'), 'export const x: number = "no"\n');
  assert.equal(guard(root, FAIL).code, 2);
});

test('a reply that ends on the fast mode footer skips the check', () => {
  const root = repo();

  breakCode(root);
  assert.equal(guard(root, FAIL, { reply: 'Moved it.\n\n----\n\nFast mode on' }).code, 0);
  assert.equal(guard(root, FAIL, { reply: 'Moved it.' }).code, 2);
});

test('the guard fails open on a bad payload and outside a repository', () => {
  const root = repo();

  breakCode(root);
  assert.equal(guard(root, FAIL, { input: 'not json' }).code, 0);
  assert.equal(guard(path.join(dir, 'no-such-folder'), FAIL).code, 0);
});

// ---------------------------------------------------------------------------
// The plugin: approval, and the Stop word
// ---------------------------------------------------------------------------

test('a project never approved on this computer runs no check', () => {
  const root = repo({ command: FAIL });

  breakCode(root);
  assert.equal(plugin('stop', root).code, 0);
});

test('approve records the project and its command, and the check then runs', () => {
  const root = repo({ command: FAIL });
  const said = plugin('approve', root);

  assert.equal(said.code, 0);
  assert.match(said.out, /Approved on this computer/);
  assert.match(said.out, /Cannot find name/);
  assert.equal(Object.values(JSON.parse(fs.readFileSync(APPROVED, 'utf8'))).includes(FAIL), true);

  breakCode(root);

  const ran = plugin('stop', root);

  assert.equal(ran.code, 2);
  assert.match(ran.err, /CHECK FAILED/);
});

test('a command changed after the approval stops running until approved again', () => {
  const root = repo({ command: PASS });

  plugin('approve', root);
  setCommand(root, FAIL);
  breakCode(root);
  assert.equal(plugin('stop', root).code, 0);
  plugin('approve', root);
  assert.equal(plugin('stop', root).code, 2);
});

test('approve with an empty command says so and takes the approval away', () => {
  const root = repo({ command: FAIL });

  plugin('approve', root);
  setCommand(root, '');
  assert.match(plugin('approve', root).out, /no automatic check/);
  setCommand(root, FAIL);
  breakCode(root);
  assert.equal(plugin('stop', root).code, 0);
});

test('an approved project that passes its check lets the turn end', () => {
  const root = repo({ command: PASS });

  plugin('approve', root);
  breakCode(root, 'export const a = 3\n');
  assert.equal(plugin('stop', root).code, 0);
});

test('a project that wires its own check on Stop keeps it, and the plugin stands down', () => {
  const root = repo({ command: FAIL });

  plugin('approve', root);
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.claude', 'settings.json'),
    JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node scripts/check-on-stop.mjs' }] }] },
    }),
  );
  breakCode(root);
  assert.equal(plugin('stop', root).code, 0);
});

test('outside a ProjectOS project, and in the kit itself, nothing is approved or run', () => {
  const bare = path.join(dir, `bare-${seq++}`);

  fs.mkdirSync(bare, { recursive: true });
  assert.match(plugin('approve', bare).out, /nothing approved/);
  assert.equal(plugin('stop', bare).code, 0);
  assert.match(plugin('approve', KIT.replace(/[\\/]$/, '')).out, /kit repository itself/);
  assert.equal(plugin('stop', KIT.replace(/[\\/]$/, '')).code, 0);
});

console.log(`Check-on-stop-tests.mjs: all ${cases} cases passed`);
