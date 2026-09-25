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
// project-os/Hooks-settings.json, the file the owner copies in with the rest of
// project-os/. The project root is found by walking up from the session's
// project folder (CLAUDE_PROJECT_DIR), then from the payload's cwd, then from
// the process cwd, so a session opened in a subfolder still finds it. No
// marker: exit 0, print nothing. The kit repository itself is skipped too.
//
// SETTINGS WIRING WINS. If the project's own .claude/settings.json or
// .claude/settings.local.json already carries a hook this plugin would add
// (the installer's fallback wiring), the plugin stands down for that hook, so
// nothing fires twice. Checked per event, and per guard for PreToolUse.
// Only the settings Claude Code actually loaded count, so they are read from
// the session folder: CLAUDE_PROJECT_DIR when it is set, the found root only
// when it is not. On Windows a session opened in a subfolder loads only that
// folder's settings, while on macOS and Linux it also loads the git root's
// settings.local.json, so there that file is read too (the git root is the
// first folder holding .git, walking up from the session folder). A reminder
// stands down when any of those files carries it. A guard counts as wired
// only when the script the settings name is on disk, read the way Claude Code
// runs it (${CLAUDE_PROJECT_DIR}, $CLAUDE_PROJECT_DIR, %CLAUDE_PROJECT_DIR% and
// a relative path all taken from the session folder), because a moved or
// renamed project keeps a path to a guard that is gone. Anything not proven
// that way runs the plugin's copy: at worst a guard runs twice, and both block
// the same.
//
// WHAT IT RUNS. Only code from the plugin's own folder: the reminder TEXT is
// read out of the project's Hooks-settings.json as data (the string inside the
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

// The marker, in both spellings: projects installed before the kit's files
// were renamed carry the lowercase name, and a case-sensitive disk tells the
// two apart.
const MARKERS = ['Hooks-settings.json', 'hooks-settings.json'].map((f) => path.join('project-os', f));
const markerIn = (dir) => MARKERS.map((m) => path.join(dir, m)).find((f) => fs.existsSync(f)) || null;
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
    if (markerIn(dir)) return dir;
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

// Every command hook one settings object carries for this event.
function hookEntries(settings, event) {
  const out = [];
  const groups = settings && settings.hooks && settings.hooks[event];
  for (const g of Array.isArray(groups) ? groups : []) {
    for (const h of (g && Array.isArray(g.hooks)) ? g.hooks : []) {
      if (h && typeof h.command === 'string') out.push(h);
    }
  }
  return out;
}

function hookCommands(settings, event) {
  return hookEntries(settings, event)
    .map((h) => (Array.isArray(h.args) ? `${h.command} ${h.args.join(' ')}` : h.command));
}

// The folder whose .claude settings Claude Code loaded for this session: the
// session's own project folder when it is known, else the found root.
function settingsDir(root) {
  const pd = process.env.CLAUDE_PROJECT_DIR;
  return pd ? path.resolve(pd) : root;
}

// A git worktree has a .git FILE pointing into the main repository, and Claude
// Code reads the personal settings of the main checkout for it. Follow that; a
// submodule (whose shared folder is not named .git) stays its own root.
function mainCheckout(dir, dotGit) {
  try {
    if (!fs.statSync(dotGit).isFile()) return dir;
    const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, 'utf8'));
    if (!m) return dir;
    const gitdir = path.resolve(dir, m[1].trim());
    const commonFile = path.join(gitdir, 'commondir');
    if (!fs.existsSync(commonFile)) return dir;
    const common = path.resolve(gitdir, fs.readFileSync(commonFile, 'utf8').trim());
    return path.basename(common) === '.git' ? path.dirname(common) : dir;
  } catch {
    return dir;
  }
}

// The first folder at or above `start` that holds .git (the main checkout for
// a worktree), or null.
function gitRootFrom(start) {
  let dir = path.resolve(String(start));
  for (let i = 0; i < 64; i++) {
    const dotGit = path.join(dir, '.git');
    if (fs.existsSync(dotGit)) return mainCheckout(dir, dotGit);
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

// Every settings file Claude Code loaded for a session in `dir`: that folder's
// two, plus on macOS and Linux the git root's settings.local.json when `dir`
// is a subfolder of the repository.
function settingsFiles(dir) {
  const files = ['settings.json', 'settings.local.json'].map((f) => path.join(dir, '.claude', f));
  if (process.platform !== 'win32') {
    const git = gitRootFrom(dir);
    if (git && git !== path.resolve(dir)) files.push(path.join(git, '.claude', 'settings.local.json'));
  }
  return files;
}

// Every hook command the loaded settings carry for this event.
function settingsCommands(dir, event) {
  return settingsFiles(dir).flatMap((f) => hookCommands(readJson(f), event));
}

// The path a settings hook gives for a guard: the args element for the exec
// form, else the double-quoted, single-quoted or bare token of the command.
// Only a token whose last part is the guard's own name counts, in any case,
// so a project wired under the guards' old lowercase names still counts.
function guardTokens(hook, name) {
  const endsInName = (t) => {
    const s = String(t).replace(/\\/g, '/');
    const base = s.slice(s.lastIndexOf('/') + 1);
    return base.toLowerCase() === name.toLowerCase();
  };
  if (Array.isArray(hook.args)) {
    return hook.args.filter((a) => typeof a === 'string' && endsInName(a)).map((text) => ({ text, bare: false }));
  }
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|([^\s"']+)/g;
  let m;
  while ((m = re.exec(hook.command)) !== null) tokens.push({ text: m[1] ?? m[2] ?? m[3], bare: m[3] !== undefined });
  return tokens.filter((t) => endsInName(t.text));
}

// Fill in the session folder the way Claude Code and the shell would, and
// resolve a relative path from it. Null when a variable, a backtick or a home
// folder is left over, or when an unquoted path holds a space the shell would
// split on, because then the path cannot be proven from here: inside the
// double quotes of a hook command the shell reads a $ or a backtick as code.
function resolveGuardPath(token, dir) {
  const p = token.text
    .replace(/\$\{CLAUDE_PROJECT_DIR\}/g, () => dir)
    .replace(/\$CLAUDE_PROJECT_DIR(?![A-Za-z0-9_])/g, () => dir)
    .replace(/%CLAUDE_PROJECT_DIR%/gi, () => dir);
  if (/[$`]|%[A-Za-z0-9_]+%|^~/.test(p)) return null;
  if (token.bare && /\s/.test(p)) return null;
  return path.resolve(dir, p);
}

// True only when the loaded settings wire this guard AND the script they name
// is on disk. A moved project, a path from another computer, or a variable
// this cannot fill in all come out false, and the plugin runs its own copy.
function guardWired(dir, name) {
  const hooks = settingsFiles(dir).flatMap((f) => hookEntries(readJson(f), 'PreToolUse'));
  for (const h of hooks) {
    for (const token of guardTokens(h, name)) {
      const p = resolveGuardPath(token, dir);
      if (p && fs.existsSync(p)) return true;
      log(`${name}: settings name ${token.text}, not proven on disk, plugin runs its copy`);
    }
  }
  return false;
}

// The text inside the kit's `node -e "console.log('...')"` reminder form.
function reminderText(command) {
  const m = /console\.log\('([\s\S]*?)'\)/.exec(command);
  return m ? m[1] : null;
}

function runReminders(root, event) {
  const kit = readJson(markerIn(root) || '');
  const ours = hookCommands(kit, event);
  const theirs = settingsCommands(settingsDir(root), event);
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
    const dir = settingsDir(root);
    const shell = /^(Bash|PowerShell|Monitor)$/.test(tool);
    if (!guardWired(dir, 'Path-guard.mjs')) code = runGuard('Path-guard.mjs', raw, root);
    else log('path-guard: stand down, wired in settings and on disk');
    if (code === 0 && shell) {
      if (!guardWired(dir, 'Destructive-guard.mjs')) code = runGuard('Destructive-guard.mjs', raw, root);
      else log('destructive-guard: stand down, wired in settings and on disk');
    }
  }
} catch (err) {
  log(`error, allow: ${err && err.message}`);
  code = 0;
}
process.exit(code);
