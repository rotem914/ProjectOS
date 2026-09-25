// Installs this project's hooks, by merging project-os/Hooks-settings.json into
// the project's Claude settings.
//
// The assistant runs this as a STEP OF THE INSTALL, without being asked. See
// Installation.md section 6b. The owner can also run it by hand at any time.
//
//   node project-os/Install-project-hooks.mjs
//
// Flags:
//   --dry       show what would change and write nothing
//   --shared    write to .claude/settings.json (committed, shared with the team)
//               instead of .claude/settings.local.json (personal, usually
//               gitignored, so it reaches only this machine)
//   --replace   replace an event's existing hooks instead of running beside them
//
// The guards under project-os/guards/ ride in the same file, named through
// "${CLAUDE_PROJECT_DIR}", the folder Claude Code fills in before the hook
// runs. On Windows a session opened in a subfolder loads only that folder's
// settings, while on macOS and Linux it also loads the git root's
// settings.local.json. Where the guards land decides what the path becomes:
//   - the personal file (the default) gets this project's own path instead,
//     because on macOS and Linux that subfolder session reads this file while
//     CLAUDE_PROJECT_DIR names the subfolder, and a guard named through it
//     would not be found there (review 2026-09-25); on Windows the plugin
//     covers a subfolder session;
//   - the shared file (--shared) keeps "${CLAUDE_PROJECT_DIR}", so the same
//     committed file works on every computer and in a cloud session. Open
//     sessions at the project root there.
// A moved or renamed project is covered by the plugin, which runs its own copy
// of a guard whose file is gone. A project whose folder path holds a $, a
// backtick or a double quote (or, on macOS and Linux, a backslash) is refused,
// because each one breaks the quoted path inside the hook command and the
// guards would silently not run.
//
// DEFAULT IS COMBINE, NOT REPLACE. A hook event holds a LIST, so this project's
// hooks are appended to whatever is already there and both run. Nothing the
// project already had is removed, reworded or reordered. `--replace` is the
// deliberate exception, for when the existing hook is known to be broken.
//
// Safe by design: it never rewrites a settings file it could not parse, it
// writes a .backup first, and it is idempotent, since a hook already present
// is recognised and not added twice. A guard is recognised by the script it
// runs, however its path is written: through ${CLAUDE_PROJECT_DIR},
// $CLAUDE_PROJECT_DIR or %CLAUDE_PROJECT_DIR%, with backslashes, or, on
// Windows, in another letter case.
//
// HOW IT FAILS. Before touching anything it proves the target folder is
// writable with one probe file, so a full disk, a read-only folder or a
// permission block fails in a second with one plain sentence and a remedy,
// never halfway through with a stack trace. Nothing is reported as added until
// the settings file has actually been written and renamed into place; before
// that the summary says "will add". A run that prints "added:" wrote the file.
//
// PROVING IT IS WIRED. Running the hook scripts by hand proves they work, not
// that they are installed. `--dry` answers that: every event listed under
// "present:" is wired, and any event under "will add:" is NOT. A plain `--dry`
// also counts what the committed settings.json carries, so it proves a
// --shared install as well.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry');
const SHARED = args.has('--shared');
const REPLACE = args.has('--replace') || args.has('--force');

const root = process.cwd();
const sourcePath = path.join(root, 'project-os', 'Hooks-settings.json');
const targetDir = path.join(root, '.claude');
const targetName = SHARED ? 'settings.json' : 'settings.local.json';
const targetPath = path.join(targetDir, targetName);
// The committed settings.json runs on this machine too, so a personal run
// counts a hook it already carries as installed and does not add it again. A
// --shared run never looks at the personal file: only the committed file
// reaches the team and a cloud session, so it always gets the full set. After
// "default, then --shared" the guards sit in both files and run twice on this
// machine, which is harmless, since both give the same verdict.
const otherPath = SHARED ? null : path.join(targetDir, 'settings.json');

function die(message) {
  console.error(`Install-project-hooks: ${message}`);
  process.exit(1);
}

// One sentence per filesystem failure, with the remedy, instead of the raw
// error object. The codes are the ones a settings write can actually hit.
function explainFsError(err, what) {
  const code = err && err.code;
  const where = path.relative(root, targetDir) || '.claude';
  switch (code) {
    case 'ENOSPC':
      return `${what}: the disk is full, so nothing could be written to ${where}. Free some space and run this again.`;
    case 'EACCES':
    case 'EPERM':
      return `${what}: no permission to write in ${where}. Fix the folder's permissions, or run this from an account that owns it, and run again.`;
    case 'EROFS':
      return `${what}: ${where} is on a read-only disk, so nothing can be written there. Make it writable and run again.`;
    case 'EEXIST':
    case 'ENOTDIR':
      return `${what}: ${where} exists but is not a folder, so the settings file has nowhere to go. Move that file aside and run again.`;
    default:
      return `${what}: ${err && err.message ? err.message : String(err)}. Nothing was changed; fix the cause and run again.`;
  }
}

// Prove the target folder takes a write BEFORE deciding or reporting anything.
// A probe file is created and removed; a failure here is the same failure the
// real write would hit, caught in one second instead of halfway through.
function probeWritable() {
  const probe = path.join(targetDir, `.Install-project-hooks-probe-${process.pid}`);
  try {
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(probe, 'probe', 'utf8');
    fs.unlinkSync(probe);
  } catch (err) {
    try { fs.unlinkSync(probe); } catch { /* the probe never landed */ }
    die(explainFsError(err, 'target is not writable'));
  }
}

function readSettings(file, { strict }) {
  if (!fs.existsSync(file)) return { exists: false, data: {} };
  const raw = fs.readFileSync(file, 'utf8');
  if (!raw.trim()) return { exists: true, data: {} };
  try {
    return { exists: true, data: JSON.parse(raw) };
  } catch (err) {
    if (strict) {
      die(
        `${path.relative(root, file)} exists but is not valid JSON (${err.message}).\n` +
        '  Fix or move that file first. Nothing was changed.'
      );
    }
    console.log(`  note:     ${path.relative(root, file)} is not valid JSON, so it was not consulted.`);
    return { exists: true, data: {} };
  }
}

// What a hook runs, as one string for telling whether it is already installed.
// `node <script>` is known by the script's full path: the project folder filled
// in for ${CLAUDE_PROJECT_DIR}, $CLAUDE_PROJECT_DIR and %CLAUDE_PROJECT_DIR%, a
// relative path taken from the project folder, forward slashes, and letter case
// ignored on Windows. Any other hook is known by its command text.
const IGNORE_CASE = process.platform === 'win32';
function scriptPath(text) {
  const p = String(text)
    .replace(/\$\{CLAUDE_PROJECT_DIR\}/g, () => root)
    .replace(/\$CLAUDE_PROJECT_DIR(?![A-Za-z0-9_])/g, () => root)
    .replace(/%CLAUDE_PROJECT_DIR%/gi, () => root);
  const full = path.resolve(root, p).split('\\').join('/');
  return IGNORE_CASE ? full.toLowerCase() : full;
}
function hookKey(h) {
  const words = [];
  if (Array.isArray(h.args)) {
    words.push(h.command, ...h.args.map(String));
  } else {
    const re = /"([^"]*)"|'([^']*)'|([^\s"']+)/g;
    let m;
    while ((m = re.exec(h.command)) !== null) words.push(m[1] ?? m[2] ?? m[3]);
  }
  if (words.length === 2 && /^(?:.*[\\/])?node(?:\.exe)?$/i.test(words[0]) && !words[1].startsWith('-')) {
    return `node ${scriptPath(words[1])}`;
  }
  return Array.isArray(h.args) ? `${h.command} ${h.args.join(' ')}` : h.command;
}
const isCommandHook = (h) => h && typeof h.command === 'string';

function hookKeys(eventEntries) {
  const out = new Set();
  for (const group of Array.isArray(eventEntries) ? eventEntries : []) {
    for (const h of (group && Array.isArray(group.hooks)) ? group.hooks : []) {
      if (isCommandHook(h)) out.add(hookKey(h));
    }
  }
  return out;
}

// An event's groups keeping only the hooks not already in `have`. A group left
// with no hook is dropped.
function without(eventEntries, have) {
  const out = [];
  for (const group of Array.isArray(eventEntries) ? eventEntries : []) {
    const hooks = (group && Array.isArray(group.hooks)) ? group.hooks : [];
    const keep = hooks.filter((h) => !(isCommandHook(h) && have.has(hookKey(h))));
    if (keep.length) out.push({ ...group, hooks: keep });
  }
  return out;
}

// A $ or a backtick in the project folder's path would sit inside the double
// quotes of every guard command, where bash and PowerShell read it as code, and
// the guards would then fail to start without a word.
// On macOS and Linux a double quote or a backslash is just as bad: the first
// ends the quoted path, the second would be read as a folder separator.
if (/[$`"]/.test(root) || (process.platform !== 'win32' && !/^[A-Za-z]:[\\/]/.test(root) && /\\/.test(root))) {
  die('nothing was written, because this project folder\'s path contains a $, a backtick, a double quote or a backslash, which break the quoted path inside a hook command, so move or rename the folder to a path without them and run this again.');
}

if (!fs.existsSync(sourcePath)) {
  die(`cannot find ${path.relative(root, sourcePath)}. Run this from the project root.`);
}

let incoming;
try {
  incoming = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
} catch (err) {
  die(`${path.relative(root, sourcePath)} is not valid JSON: ${err.message}`);
}
if (!incoming || typeof incoming.hooks !== 'object' || incoming.hooks === null) {
  die('Hooks-settings.json has no "hooks" object.');
}
if (!SHARED) {
  // Forward slashes, which every shell on every platform accepts.
  const rootForward = root.split('\\').join('/');
  incoming = JSON.parse(JSON.stringify(incoming).split('${CLAUDE_PROJECT_DIR}').join(rootForward));
}

const target = readSettings(targetPath, { strict: true });
const other = otherPath ? readSettings(otherPath, { strict: false }) : { exists: false, data: {} };

if (!DRY) probeWritable();

const currentHooks =
  target.data.hooks && typeof target.data.hooks === 'object' ? target.data.hooks : {};
const otherHooks =
  other.data.hooks && typeof other.data.hooks === 'object' ? other.data.hooks : {};

// On macOS and Linux a session opened in a subfolder loads the personal file
// at the git root but not the root's committed file, and a guard named there
// through ${CLAUDE_PROJECT_DIR} would not be found from a subfolder anyway. So
// on those systems a guard in the committed file never stands in for one in
// the personal file; at the root it then runs twice, which blocks the same thing.
function coveredByOther(event) {
  const keys = hookKeys(otherHooks[event]);
  if (process.platform === 'win32') return keys;
  return new Set([...keys].filter((k) => !/^node .*\/project-os\/guards\//i.test(k)));
}

const added = [];
const combined = [];
const replaced = [];
const alreadyThere = [];

const merged = {};
for (const [event, entries] of Object.entries(currentHooks)) merged[event] = entries;

for (const [event, entries] of Object.entries(incoming.hooks)) {
  // What this file should hold: ours, less what the committed file already
  // runs (a personal run only; otherHooks is empty for --shared).
  const wanted = without(entries, coveredByOther(event));
  const missing = without(wanted, hookKeys(currentHooks[event]));

  if (!missing.length) {
    alreadyThere.push(event);
    continue;
  }
  if (!Object.prototype.hasOwnProperty.call(currentHooks, event)) {
    merged[event] = missing;
    added.push(event);
  } else if (REPLACE) {
    merged[event] = wanted;
    replaced.push(event);
  } else {
    // Combine: the event holds a list, so ours runs beside what is already there.
    const existing = Array.isArray(currentHooks[event]) ? currentHooks[event] : [];
    merged[event] = [...existing, ...missing];
    combined.push(event);
  }
}

// The plan, in the future tense: nothing below is a claim that anything was
// written. "added:" appears only after the file is in place.
console.log(`Install-project-hooks: target ${path.relative(root, targetPath)}${SHARED ? ' (shared, committed)' : ' (personal to this machine)'}`);
console.log(`  node:     ${process.version} (the hooks run through it, so this is the proof it is available)`);
if (alreadyThere.length) console.log(`  present:  ${alreadyThere.join(', ')} (already wired, nothing to do)`);
if (added.length) console.log(`  will add: ${added.join(', ')} (NOT wired yet)`);
if (combined.length) console.log(`  will combine: ${combined.join(', ')} (yours kept, ours runs beside it)`);
if (replaced.length) console.log(`  will REPLACE: ${replaced.join(', ')} (existing hooks removed)`);

if (!added.length && !combined.length && !replaced.length) {
  console.log('Install-project-hooks: nothing to change. Every hook this project ships is already installed.');
  process.exit(0);
}

if (DRY) {
  console.log('Install-project-hooks: --dry, nothing written. Every event above under "will add" is not installed.');
  process.exit(0);
}

const next = { ...target.data, hooks: merged };
const body = JSON.stringify(next, null, 2) + '\n';
const tmp = `${targetPath}.tmp`;

try {
  fs.mkdirSync(targetDir, { recursive: true });
  if (target.exists) {
    const backup = `${targetPath}.backup`;
    fs.copyFileSync(targetPath, backup);
    console.log(`  backup:   ${path.relative(root, backup)}`);
  }
  fs.writeFileSync(tmp, body, 'utf8');
  fs.renameSync(tmp, targetPath);
} catch (err) {
  try { fs.unlinkSync(tmp); } catch { /* nothing partial to remove */ }
  die(explainFsError(err, `could not write ${path.relative(root, targetPath)}`));
}

// Only now is anything "added": the file is on disk under its real name.
console.log(`Install-project-hooks: wrote ${path.relative(root, targetPath)}`);
if (added.length) console.log(`  added:    ${added.join(', ')}`);
if (combined.length) console.log(`  combined: ${combined.join(', ')}`);
if (replaced.length) console.log(`  REPLACED: ${replaced.join(', ')}`);
if (!SHARED) {
  console.log('This file is personal to this machine and is usually not committed.');
  console.log('For hooks the whole team gets, re-run with --shared.');
}
console.log('Start a NEW session for the hooks to take effect, then ask the assistant');
console.log('what rules it was given this turn. It should read them back.');
