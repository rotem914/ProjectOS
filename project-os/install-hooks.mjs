// Installs this project's hooks by merging project-os/hooks-settings.json into
// .claude/settings.local.json.
//
// WHY THIS EXISTS AS A SCRIPT YOU RUN, and not as something the assistant does:
// the assistant is hard-blocked from writing any .claude/settings*.json, and
// explicit permission does not lift that block. It is a good rule (an agent that
// can rewrite its own guard rails has none), and it means this one step is
// yours. It is one command, once per project.
//
//   node project-os/install-hooks.mjs
//
// Flags:
//   --dry    show what would change and write nothing
//   --force  replace an event that already has hooks, instead of stopping
//
// Safe by design: it MERGES, it never overwrites the file. Anything already in
// settings.local.json that is not a hook is preserved untouched, and an event
// that already has hooks is reported and left alone unless you pass --force.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry');
const FORCE = args.has('--force');

const root = process.cwd();
const sourcePath = path.join(root, 'project-os', 'hooks-settings.json');
const targetDir = path.join(root, '.claude');
const targetPath = path.join(targetDir, 'settings.local.json');

function die(message) {
  console.error(`install-hooks: ${message}`);
  process.exit(1);
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

let current = {};
const exists = fs.existsSync(targetPath);
if (exists) {
  const raw = fs.readFileSync(targetPath, 'utf8');
  try {
    current = raw.trim() ? JSON.parse(raw) : {};
  } catch (err) {
    die(
      `.claude/settings.local.json exists but is not valid JSON (${err.message}).\n` +
      '  Fix or move that file first. Nothing was changed.'
    );
  }
}

const currentHooks = current.hooks && typeof current.hooks === 'object' ? current.hooks : {};
const added = [];
const replaced = [];
const skipped = [];

const merged = { ...currentHooks };
for (const [event, entries] of Object.entries(incoming.hooks)) {
  if (!Object.prototype.hasOwnProperty.call(currentHooks, event)) {
    merged[event] = entries;
    added.push(event);
  } else if (FORCE) {
    merged[event] = entries;
    replaced.push(event);
  } else {
    skipped.push(event);
  }
}

if (added.length) console.log(`  add:      ${added.join(', ')}`);
if (replaced.length) console.log(`  REPLACED: ${replaced.join(', ')}`);
if (skipped.length) {
  console.log(`  kept:     ${skipped.join(', ')} (already had hooks; re-run with --force to replace)`);
}
if (!added.length && !replaced.length) {
  console.log('install-hooks: nothing to add. Your existing hooks were left exactly as they are.');
  process.exit(0);
}

if (DRY) {
  console.log('install-hooks: --dry, nothing written.');
  process.exit(0);
}

const next = { ...current, hooks: merged };
const body = JSON.stringify(next, null, 2) + '\n';

fs.mkdirSync(targetDir, { recursive: true });
if (exists) {
  const backup = `${targetPath}.backup`;
  fs.copyFileSync(targetPath, backup);
  console.log(`  backup:   ${path.relative(root, backup)}`);
}

const tmp = `${targetPath}.tmp`;
fs.writeFileSync(tmp, body, 'utf8');
fs.renameSync(tmp, targetPath);

console.log(`install-hooks: wrote ${path.relative(root, targetPath)}`);
console.log('Start a NEW session for the hooks to take effect, then ask the assistant');
console.log('what standing rules it was given this turn. It should quote them back.');
