// Check-on-stop.mjs - runs the project's quick check when the assistant
// finishes a turn that changed code, and sends it back to work when the check
// fails.
//
// WHY. "Done" gets said over a project that no longer passes its own check,
// and the failure only surfaces at the commit. A check after every single
// edit is too slow, dozens of runs per task. One run when the turn ends is
// enough, and it is the moment that matters: just before the owner reads
// "done".
//
// WHAT THE OWNER SEES. The reply that ended the turn is already on screen; a
// hook cannot take it back. On a failed check the assistant keeps working by
// itself, fixes the errors and adds one short second reply. The project is
// never left broken, at the price of two replies in that turn.
//
// WHO RUNS IT. The ProjectOS plugin, from its own copy of this file, on the
// Stop event (hooks/dispatch.mjs, "stop"). The plugin hands it the project
// folder, the command and a place for its state through the environment:
//
//   CLAUDE_PROJECT_DIR      the project
//   CHECK_ON_STOP_COMMAND   the command to run, from project-os/Check-command.json
//   CHECK_ON_STOP_STATE     a file outside the project, for what was checked
//
// The command comes from the project, so the plugin runs it only for a
// project approved on this computer (see dispatch.mjs, APPROVED PROJECTS).
// This file never reads the command from anywhere but the environment.
//
// WHEN IT RUNS THE CHECK. Only when git shows changed code. Records and notes
// do not count: markdown files, and anything under project-os/, plans/,
// features/, backups/, .tmp/ or .claude/. A turn that only talked, or only
// touched the records, costs nothing.
//
// ONCE PER STATE. The changed files are fingerprinted by path, size and time
// of change. A state that already passed is not checked again, in this
// conversation or another. A state that already failed is not sent back a
// second time: the assistant was told once, and a check it cannot fix must
// never trap the turn.
//
// FAST MODE. The mode waives checks: the owner tests every round himself. A
// reply that ends on the line `Fast mode on` skips the check. The debt is
// paid at `Go commit`, which runs the full checks anyway.
//
// FAIL OPEN. Any error in this script, no git, a check that cannot be
// started or runs out of time: exit 0. A hook bug must never trap the owner.
//
// Proven by tests/Check-on-stop-tests.mjs in the kit.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOW = 0;
const SEND_BACK = 2;
const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const STATE = process.env.CHECK_ON_STOP_STATE || '';
const COMMAND = (process.env.CHECK_ON_STOP_COMMAND || '').trim();
// Under the hook's own timeout in hooks/hooks.json, so this script ends
// first and decides for itself.
const CHECK_MS = Number(process.env.CHECK_ON_STOP_MS) || 150_000;
const SHOWN_LINES = 40;
const FAST_FOOTER = /^fast mode on$/i;
const RECORD_FOLDERS = ['project-os/', 'plans/', 'features/', 'backups/', '.tmp/', '.claude/'];

/** True for a changed path the project's check can be expected to read. */
export function isCode(file) {
  const clean = file.replace(/\\/g, '/');

  if (/\.md$/i.test(clean)) return false;

  return !RECORD_FOLDERS.some((folder) => clean.startsWith(folder));
}

/** The paths in `git status --porcelain` output, renames by their new name. */
export function changedIn(porcelain) {
  const files = [];

  for (const line of porcelain.split(/\r?\n/)) {
    if (line.length < 4) continue;

    const state = line.slice(0, 2);
    let file = line.slice(3);

    if (state.includes('R') || state.includes('C')) {
      file = file.split(' -> ').pop() ?? file;
    }

    // Git quotes a path that holds a space or a letter outside ASCII.
    if (file.startsWith('"') && file.endsWith('"')) {
      file = file.slice(1, -1);
    }

    files.push(file);
  }

  return files;
}

/** One hash for the state of the changed code: which files, how big, when. */
export function fingerprintOf(root, files) {
  const hash = crypto.createHash('sha1');

  for (const file of [...files].sort()) {
    let stamp = 'gone';

    try {
      const stat = fs.statSync(path.join(root, file));

      stamp = stat.isDirectory() ? `dir:${stat.mtimeMs}` : `${stat.size}:${stat.mtimeMs}`;
    } catch {
      // Deleted: its absence is the state.
    }

    hash.update(`${file}\n${stamp}\n`);
  }

  return hash.digest('hex');
}

/** The text of the last reply in a transcript, or '' when there is none. */
export function lastReplyIn(transcript) {
  const lines = transcript.split(/\r?\n/);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].trim() === '') continue;

    let row = null;

    try {
      row = JSON.parse(lines[i]);
    } catch {
      continue;
    }

    if (row === null || row.type !== 'assistant') continue;

    const content = row.message?.content;
    const blocks = Array.isArray(content) ? content : [];
    const text = blocks
      .filter((block) => block !== null && block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n');

    if (text.trim() !== '') return text;
  }

  return '';
}

/** True when the reply ends on the fast mode footer, alone on its line. */
export function isFastReply(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  const last = lines[lines.length - 1] ?? '';

  return FAST_FOOTER.test(last.trim());
}

/** The end of the check's output, without color codes: where the errors are. */
export function tailOf(output) {
  // eslint-disable-next-line no-control-regex
  const plain = output.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
  const lines = plain.split(/\r?\n/).filter((line) => line.trim() !== '');

  return lines.slice(-SHOWN_LINES).join('\n');
}

function readState() {
  try {
    const kept = JSON.parse(fs.readFileSync(STATE, 'utf8'));

    return kept !== null && typeof kept === 'object' ? kept : {};
  } catch {
    return {};
  }
}

function writeState(next) {
  if (STATE === '') return;

  try {
    fs.mkdirSync(path.dirname(STATE), { recursive: true });

    // Atomic: a half-written state file must never be read as a pass.
    const draft = `${STATE}.${process.pid}.tmp`;

    fs.writeFileSync(draft, JSON.stringify(next));
    fs.renameSync(draft, STATE);
  } catch {
    // A state that cannot be kept only means the check runs again next time.
  }
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  // No command, no check: the project has none yet.
  if (COMMAND === '') process.exit(ALLOW);

  let payload = {};

  try {
    payload = JSON.parse(readStdin() || '{}') ?? {};
  } catch {
    process.exit(ALLOW);
  }

  const transcriptPath = payload.transcript_path;

  if (typeof transcriptPath === 'string' && fs.existsSync(transcriptPath)) {
    if (isFastReply(lastReplyIn(fs.readFileSync(transcriptPath, 'utf8')))) {
      process.exit(ALLOW);
    }
  }

  // Every new file by its own name: a folder's time of change does not move
  // when a file inside it is edited.
  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  if (status.status !== 0 || typeof status.stdout !== 'string') process.exit(ALLOW);

  const code = changedIn(status.stdout).filter(isCode);

  if (code.length === 0) process.exit(ALLOW);

  const fingerprint = fingerprintOf(ROOT, code);
  const kept = readState();

  if (kept.passed === fingerprint || kept.failed === fingerprint) process.exit(ALLOW);

  const check = spawnSync(COMMAND, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: true,
    timeout: CHECK_MS,
    windowsHide: true,
  });

  // Could not be started, or ran out of time: not a verdict on the code.
  if (check.error || check.status === null) process.exit(ALLOW);

  if (check.status === 0) {
    writeState({ ...kept, passed: fingerprint });
    process.exit(ALLOW);
  }

  writeState({ ...kept, failed: fingerprint });

  const shown = tailOf(`${check.stdout ?? ''}\n${check.stderr ?? ''}`);

  process.stderr.write(
    [
      `CHECK FAILED: \`${COMMAND}\` does not pass with the changes this turn left.`,
      'The owner has already read your reply. Do not repeat it.',
      'Fix what the check reports, run the check yourself until it passes, then add ONE short',
      'reply that says what was broken and that it is fixed. If the failure is not yours to fix',
      '(another conversation is mid-work in those files, or the fix needs the owner), say that',
      'in one line instead. This state is reported once: it will not send you back again.',
      '',
      shown,
      '',
    ].join('\n'),
  );
  process.exit(SEND_BACK);
}

const isRunDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isRunDirectly) {
  try {
    main();
  } catch {
    process.exit(ALLOW);
  }
}
