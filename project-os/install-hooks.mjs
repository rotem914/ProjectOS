// Installs this project's hooks, by merging project-os/hooks-settings.json into
// the project's Claude settings.
//
// The assistant runs this as a STEP OF THE INSTALL, without being asked. See
// Installation.md section 6b. The owner can also run it by hand at any time.
//
//   node project-os/install-hooks.mjs
//
// Flags:
//   --dry       show what would change and write nothing
//   --shared    write to .claude/settings.json (committed, shared with the team)
//               instead of .claude/settings.local.json (personal, usually
//               gitignored, so it reaches only this machine)
//   --replace   replace an event's existing hooks instead of running beside them
//
// DEFAULT IS COMBINE, NOT REPLACE. A hook event holds a LIST, so this project's
// hooks are appended to whatever is already there and both run. Nothing the
// project already had is removed, reworded or reordered. `--replace` is the
// deliberate exception, for when the existing hook is known to be broken.
//
// Safe by design: it never rewrites a settings file it could not parse, it
// writes a .backup first, and it is idempotent, since a hook whose command is
// already present is recognised and not added twice.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry');
const SHARED = args.has('--shared');
const REPLACE = args.has('--replace') || args.has('--force');

const root = process.cwd();
const sourcePath = path.join(root, 'project-os', 'hooks-settings.json');
const targetDir = path.join(root, '.claude');
const targetName = SHARED ? 'settings.json' : 'settings.local.json';
const targetPath = path.join(targetDir, targetName);
// Hooks can live in either file, and both are read before deciding anything is
// missing. Reporting "not installed" while the other file already carries it is
// how a project ends up with the same hook twice.
const otherPath = path.join(targetDir, SHARED ? 'settings.local.json' : 'settings.json');

function die(message) {
  console.error(`install-hooks: ${message}`);
  process.exit(1);
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

function hookCommands(eventEntries) {
  const out = [];
  for (const group of Array.isArray(eventEntries) ? eventEntries : []) {
    for (const h of (group && Array.isArray(group.hooks)) ? group.hooks : []) {
      if (h && typeof h.command === 'string') out.push(h.command);
    }
  }
  return out;
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
  die('hooks-settings.json has no "hooks" object.');
}

const target = readSettings(targetPath, { strict: true });
const other = readSettings(otherPath, { strict: false });

const currentHooks =
  target.data.hooks && typeof target.data.hooks === 'object' ? target.data.hooks : {};
const otherHooks =
  other.data.hooks && typeof other.data.hooks === 'object' ? other.data.hooks : {};

const added = [];
const combined = [];
const replaced = [];
const alreadyThere = [];

const merged = {};
for (const [event, entries] of Object.entries(currentHooks)) merged[event] = entries;

for (const [event, entries] of Object.entries(incoming.hooks)) {
  const ours = hookCommands(entries);
  const here = hookCommands(currentHooks[event]);
  const elsewhere = hookCommands(otherHooks[event]);
  const seen = new Set([...here, ...elsewhere]);

  if (ours.length && ours.every((c) => seen.has(c))) {
    alreadyThere.push(event);
    continue;
  }
  if (!Object.prototype.hasOwnProperty.call(currentHooks, event)) {
    merged[event] = entries;
    added.push(event);
  } else if (REPLACE) {
    merged[event] = entries;
    replaced.push(event);
  } else {
    // Combine: the event holds a list, so ours runs beside what is already there.
    const existing = Array.isArray(currentHooks[event]) ? currentHooks[event] : [];
    merged[event] = [...existing, ...(Array.isArray(entries) ? entries : [])];
    combined.push(event);
  }
}

console.log(`install-hooks: target ${path.relative(root, targetPath)}${SHARED ? ' (shared, committed)' : ' (personal to this machine)'}`);
console.log(`  node:     ${process.version} (the hooks run through it, so this is the proof it is available)`);
if (added.length) console.log(`  added:    ${added.join(', ')}`);
if (combined.length) console.log(`  combined: ${combined.join(', ')} (yours kept, ours runs beside it)`);
if (replaced.length) console.log(`  REPLACED: ${replaced.join(', ')} (existing hooks removed)`);
if (alreadyThere.length) console.log(`  present:  ${alreadyThere.join(', ')} (nothing to do)`);

if (!added.length && !combined.length && !replaced.length) {
  console.log('install-hooks: nothing to change. Every hook this project ships is already installed.');
  process.exit(0);
}

if (DRY) {
  console.log('install-hooks: --dry, nothing written.');
  process.exit(0);
}

const next = { ...target.data, hooks: merged };
const body = JSON.stringify(next, null, 2) + '\n';

fs.mkdirSync(targetDir, { recursive: true });
if (target.exists) {
  const backup = `${targetPath}.backup`;
  fs.copyFileSync(targetPath, backup);
  console.log(`  backup:   ${path.relative(root, backup)}`);
}

const tmp = `${targetPath}.tmp`;
fs.writeFileSync(tmp, body, 'utf8');
fs.renameSync(tmp, targetPath);

console.log(`install-hooks: wrote ${path.relative(root, targetPath)}`);
if (!SHARED) {
  console.log('This file is personal to this machine and is usually not committed.');
  console.log('For hooks the whole team gets, re-run with --shared.');
}
console.log('Start a NEW session for the hooks to take effect, then ask the assistant');
console.log('what rules it was given this turn. It should read them back.');
