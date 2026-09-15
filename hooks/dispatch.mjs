// dispatch.mjs - the ProjectOS plugin's one hook. Wired by hooks/hooks.json for
// SessionStart, UserPromptSubmit and PreToolUse, and called with one word:
//
//   node hooks/dispatch.mjs session | prompt | pretool
//
// WHY A PLUGIN. Writing hooks into a project's own .claude settings is the
// assistant modifying its own configuration, and an environment may refuse
// that, so an install could end with the rules unenforced. A plugin is read
// from the owner's personal skills folder instead, set up once per computer
// (README.md, "Once per computer"), and from there it reaches every project
// with no install step and no settings write.
//
// WHICH PROJECTS. Only a project that carries the kit: the marker is
// project-os/hooks-settings.json, the file the owner copies in with the rest of
// project-os/. The project root is found by walking up from the session's
// project folder (CLAUDE_PROJECT_DIR), then from the payload's cwd, then from
// the process cwd, so a session opened in a subfolder still finds it. No
// marker: exit 0, print nothing. The kit repository itself is skipped too.
//
// SETTINGS WIRING WINS. If the project's own .claude/settings.json or
// .claude/settings.local.json already carries a hook this plugin would add
// (the installer's fallback wiring), the plugin stands down for that hook, so
// nothing fires twice. Checked per event, and per guard for PreToolUse.
//
// WHAT IT RUNS. Only code from the plugin's own folder: the reminder TEXT is
// read out of the project's hooks-settings.json as data (the string inside the
// console.log form) and printed, never executed, so a user-level plugin never
// runs a command from a repository it happens to be opened in. The two guards
// run as child processes from this plugin's copy under project-os/guards/,
// with CLAUDE_PROJECT_DIR set to the project found above, and their verdict is
// passed through unchanged: exit 2 with the reason blocks the tool call.
//
// FAIL OPEN. Any error of its own exits 0 silently. Set PROJECTOS_PLUGIN_LOG
// to a file path to get one line per call appended there, for diagnosis.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MARKER = path.join('project-os', 'hooks-settings.json');
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] || '';
const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '');

function log(line) {
  const file = process.env.PROJECTOS_PLUGIN_LOG;
  if (!file) return;
  try { fs.appendFileSync(file, `${new Date().toISOString()} ${mode} ${line}\n`, 'utf8'); } catch { /* fail open */ }
}

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function readJson(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return null; }
}

// Walk up from a start folder to the first folder carrying the marker.
function findRootFrom(start) {
  if (!start) return null;
  let dir = path.resolve(String(start));
  for (let i = 0; i < 64; i++) {
    if (fs.existsSync(path.join(dir, MARKER))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

function findRoot(payload) {
  const candidates = [process.env.CLAUDE_PROJECT_DIR, payload && payload.cwd, process.cwd()];
  for (const c of candidates) {
    const found = findRootFrom(c);
    if (found) return found;
  }
  return null;
}

function isKitItself(root) {
  return fs.existsSync(path.join(root, '.claude-plugin', 'plugin.json'))
    && fs.existsSync(path.join(root, 'hooks', 'dispatch.mjs'));
}

function hookCommands(settings, event) {
  const out = [];
  const groups = settings && settings.hooks && settings.hooks[event];
  for (const g of Array.isArray(groups) ? groups : []) {
    for (const h of (g && Array.isArray(g.hooks)) ? g.hooks : []) {
      if (h && typeof h.command === 'string') {
        out.push(Array.isArray(h.args) ? `${h.command} ${h.args.join(' ')}` : h.command);
      }
    }
  }
  return out;
}

// Every hook command the project's own settings carry for this event.
function settingsCommands(root, event) {
  const files = ['settings.json', 'settings.local.json'].map((f) => path.join(root, '.claude', f));
  return files.flatMap((f) => hookCommands(readJson(f), event));
}

// The text inside the kit's `node -e "console.log('...')"` reminder form.
function reminderText(command) {
  const m = /console\.log\('([\s\S]*?)'\)/.exec(command);
  return m ? m[1] : null;
}

function runReminders(root, event) {
  const kit = readJson(path.join(root, MARKER));
  const ours = hookCommands(kit, event);
  const theirs = settingsCommands(root, event);
  const lines = [];
  for (const cmd of ours) {
    if (theirs.includes(cmd)) { log(`${event}: stand down, wired in settings`); continue; }
    const text = reminderText(cmd);
    if (text) lines.push(text);
  }
  return lines;
}

function runGuard(name, rawPayload, root) {
  const script = path.join(PLUGIN_ROOT, 'project-os', 'guards', name);
  if (!fs.existsSync(script)) { log(`${name}: missing in plugin, allow`); return 0; }
  const r = spawnSync(process.execPath, [script], {
    input: rawPayload,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    timeout: 15000,
  });
  if (r.error) { log(`${name}: spawn error, allow (${r.error.message})`); return 0; }
  if (r.status === 2) {
    process.stderr.write(r.stderr || `${name}: blocked.\n`);
    log(`${name}: BLOCKED`);
    return 2;
  }
  return 0;
}

let code = 0;
try {
  // Only PreToolUse needs the payload. SessionStart and UserPromptSubmit do
  // not, and waiting on stdin there can hang until the hook times out, so
  // those two never touch it: the root comes from the environment and cwd.
  const raw = mode === 'pretool' ? readStdin() : '';
  let payload = {};
  try { payload = raw.trim() ? JSON.parse(raw) : {}; } catch { payload = {}; }

  const root = findRoot(payload);
  if (!root) {
    log('no marker, inert');
  } else if (isKitItself(root)) {
    log('kit repository itself, inert');
  } else if (mode === 'session') {
    const lines = runReminders(root, 'SessionStart');
    lines.push(`[ProjectOS plugin] hooks active for ${norm(root)} from ${norm(PLUGIN_ROOT)}; nothing to install in this project.`);
    process.stdout.write(lines.join('\n') + '\n');
  } else if (mode === 'prompt') {
    const lines = runReminders(root, 'UserPromptSubmit');
    if (lines.length) process.stdout.write(`[ProjectOS plugin] ${lines.join('\n')}\n`);
  } else if (mode === 'pretool') {
    const tool = String(payload.tool_name || '');
    const wired = settingsCommands(root, 'PreToolUse').join('\n');
    const shell = /^(Bash|PowerShell|Monitor)$/.test(tool);
    if (!wired.includes('path-guard.mjs')) code = runGuard('path-guard.mjs', raw, root);
    else log('path-guard: stand down, wired in settings');
    if (code === 0 && shell) {
      if (!wired.includes('destructive-guard.mjs')) code = runGuard('destructive-guard.mjs', raw, root);
      else log('destructive-guard: stand down, wired in settings');
    }
  }
} catch (err) {
  log(`error, allow: ${err && err.message}`);
  code = 0;
}
process.exit(code);
