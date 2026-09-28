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
// project-os/. The project root is found by walking up from the folder the
// session was opened in (CLAUDE_PROJECT_DIR), so a session opened in a
// subfolder still finds it. When that folder is known it alone decides: a
// session opened on a parent folder that holds several projects stays inert
// there, even after its shell moves into one of them, instead of switching on
// for whichever project the shell visited last. Only a run with no session
// folder (a check run by hand) walks up from the payload's cwd, then from the
// process cwd. No marker: exit 0, print nothing. The kit repository itself is
// skipped too.
//
// SETTINGS WIRING WINS. If the project's own .claude/settings.json or
// .claude/settings.local.json already carries a hook this plugin would add
// (the installer's fallback wiring), the plugin stands down for that hook, so
// nothing fires twice. Checked per event, and per guard and per tool for
// PreToolUse.
// Only the settings Claude Code actually loaded count, so they are read from
// the session folder: CLAUDE_PROJECT_DIR when it is set, the found root only
// when it is not. On Windows a session opened in a subfolder loads only that
// folder's settings, while on macOS and Linux it also loads the git root's
// settings.local.json, so there that file is read too (the git root is the
// first folder holding .git, walking up from the session folder). A reminder
// stands down when any of those files carries a reminder for that event, the
// same one or an older wording of it, so a reworded reminder never arrives
// beside the old list it replaces. A guard counts as wired only for a tool
// the settings actually send to it: the group naming the guard must have a
// matcher that covers this call's tool (none, "*", or a plain list of names
// such as "Write|Edit" that includes it; any other matcher is a pattern this
// does not read, so it counts as not proven). The script the settings name
// must also be on disk, read the way Claude Code runs it
// (${CLAUDE_PROJECT_DIR}, $CLAUDE_PROJECT_DIR, %CLAUDE_PROJECT_DIR% and a
// relative path all taken from the session folder), because a moved or
// renamed project keeps a path to a guard that is gone. Anything not proven
// that way runs the plugin's copy: at worst a guard runs twice, and both block
// the same.
//
// A BROKEN MARKER. When project-os/Hooks-settings.json is not valid JSON the
// plugin has no reminder text to send. It says so instead of going quiet: the
// session line reads "reminders OFF" in place of "hooks active", and every
// prompt carries one short line saying the same. Where the project's own
// settings still carry a copy of the reminders, that copy keeps printing, so
// the session line says the reminders come only from there and the prompt
// line is left out. The guards do not read that file, so they keep running.
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

// The session folder decides when it is known (see WHICH PROJECTS above);
// the payload's cwd and the process cwd are only for a run by hand.
function findRoot(payload) {
  if (process.env.CLAUDE_PROJECT_DIR) return findRootFrom(process.env.CLAUDE_PROJECT_DIR);
  for (const c of [payload && payload.cwd, process.cwd()]) {
    const found = findRootFrom(c);
    if (found) return found;
  }
  return null;
}

function isKitItself(root) {
  return fs.existsSync(path.join(root, '.claude-plugin', 'plugin.json'))
    && fs.existsSync(path.join(root, 'hooks', 'dispatch.mjs'));
}

// The hook groups one settings object carries for this event.
function hookGroups(settings, event) {
  const groups = settings && settings.hooks && settings.hooks[event];
  return (Array.isArray(groups) ? groups : []).filter((g) => g && typeof g === 'object');
}

// Every command hook in one group.
function groupCommandHooks(g) {
  return (Array.isArray(g.hooks) ? g.hooks : []).filter((h) => h && typeof h.command === 'string');
}

// Every command hook one settings object carries for this event.
function hookEntries(settings, event) {
  return hookGroups(settings, event).flatMap(groupCommandHooks);
}

// Whether a PreToolUse group is sent this tool. Claude Code reads a missing or
// empty matcher and "*" as every tool, and a matcher of only letters, digits,
// _ and | as one exact name or a list of names. Any other matcher is a
// pattern, which this does not try to read, so it counts as not covering: the
// plugin then runs its own copy, and at worst the guard runs twice.
function covers(group, tool) {
  if (group.matcher === undefined || group.matcher === null) return true;
  if (typeof group.matcher !== 'string') return false;
  const m = group.matcher.trim();
  return m === '' || m === '*' || (/^[\w|]+$/.test(m) && m.split('|').includes(tool));
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

// True only when the loaded settings wire this guard for this tool AND the
// script they name is on disk. A matcher that leaves the tool out, a moved
// project, a path from another computer, or a variable this cannot fill in
// all come out false, and the plugin runs its own copy.
function guardWired(dir, name, tool) {
  const groups = settingsFiles(dir).flatMap((f) => hookGroups(readJson(f), 'PreToolUse'));
  for (const g of groups) {
    for (const h of groupCommandHooks(g)) {
      for (const token of guardTokens(h, name)) {
        if (!covers(g, tool)) {
          log(`${name}: settings wire it under matcher ${JSON.stringify(g.matcher)}, not proven for ${tool || 'this call'}, plugin runs its copy`);
          continue;
        }
        const p = resolveGuardPath(token, dir);
        if (p && fs.existsSync(p)) return true;
        log(`${name}: settings name ${token.text}, not proven on disk, plugin runs its copy`);
      }
    }
  }
  return false;
}

// The text inside the kit's `node -e "console.log('...')"` reminder form.
function reminderText(command) {
  const m = /console\.log\('([\s\S]*?)'\)/.exec(command);
  return m ? m[1] : null;
}

// A settings file that carries any reminder for this event stands in for
// ours, whatever its wording: an install copies the text, so after a reword
// the copy there is older, and printing ours as well would send both lists.
// The leading label of a reminder's text: its first two capitalised words, such
// as STANDING RULES or PROJECT RULES. It tells the kit's own reminder, reworded
// or not, from a reminder the project wrote for something else.
const reminderLabel = (text) => (/^\s*([A-Z][A-Z]+ [A-Z][A-Z]+)/.exec(text || '') || [])[1] || null;

function runReminders(kit, root, event) {
  const ours = hookCommands(kit, event);
  const theirs = settingsCommands(settingsDir(root), event);
  // Stand down only for the kit's own reminder: the exact command, or one in
  // the settings that carries the same label (a reworded copy). A project's
  // unrelated reminder never silences the kit's (review 2026-09-26).
  const labels = new Set(['PROJECT RULES', 'STANDING RULES', ...ours.map((c) => reminderLabel(reminderText(c)))].filter(Boolean));
  const theirsRemind = theirs.some((c) => labels.has(reminderLabel(reminderText(c))));
  const lines = [];
  for (const cmd of ours) {
    if (theirs.includes(cmd) || theirsRemind) { log(`${event}: stand down, wired in settings`); continue; }
    const text = reminderText(cmd);
    if (text) lines.push(text);
    else log(`${event}: a hook in the marker is not in the console.log('...') form, nothing printed for it`);
  }
  return lines;
}

// The kit version this plugin folder carries, from its own manifest.
function pluginVersion() {
  const manifest = readJson(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'));
  return (manifest && typeof manifest.version === 'string' && manifest.version) || 'unknown';
}

// The guards whose copy in the project differs from the plugin's. The plugin
// runs its own copy, so a project that received a newer kit is protected by
// an older guard until the plugin folder is updated, and nothing said so
// (review 2026-09-28). Compared by content, so a rename or a re-download that
// changed nothing stays quiet.
function staleGuards(root) {
  const out = [];
  for (const name of ['Path-guard.mjs', 'Destructive-guard.mjs']) {
    try {
      const theirs = path.join(root, 'project-os', 'guards', name);
      const ours = path.join(PLUGIN_ROOT, 'project-os', 'guards', name);
      if (!fs.existsSync(theirs) || !fs.existsSync(ours)) continue;
      if (!fs.readFileSync(theirs).equals(fs.readFileSync(ours))) out.push(name);
    } catch { /* unreadable: nothing to say */ }
  }
  return out;
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
  } else if (mode === 'session' || mode === 'prompt') {
    const marker = markerIn(root);
    const kit = readJson(marker);
    const markerName = norm(path.relative(root, marker));
    // With a broken marker, a reminder the project's settings carry still
    // prints on its own, so "OFF" is said only where nothing else sends one.
    const settingsRemind = (event) => settingsCommands(settingsDir(root), event).some((c) => reminderText(c) !== null);
    if (mode === 'session') {
      const lines = kit ? runReminders(kit, root, 'SessionStart') : [];
      if (kit) lines.push(`[ProjectOS plugin] hooks active for ${norm(root)} from ${norm(PLUGIN_ROOT)} (kit ${pluginVersion()}); nothing to install in this project.`);
      const differ = staleGuards(root);
      if (differ.length) lines.push(`[ProjectOS plugin] this project's ${differ.join(' and ')} differ from the plugin's copy, and where the plugin runs a guard it runs its own. If the project carries the newer kit, update this computer's copy: git -C "${norm(PLUGIN_ROOT)}" pull`);
      else if (settingsRemind('SessionStart') || settingsRemind('UserPromptSubmit')) lines.push(`[ProjectOS plugin] ${markerName} is not valid JSON in ${norm(root)}: the reminders come only from this project's settings, in the wording they were installed with. Guards still active.`);
      else lines.push(`[ProjectOS plugin] reminders OFF for ${norm(root)}: ${markerName} is not valid JSON, so the plugin sends none. Guards still active.`);
      process.stdout.write(lines.join('\n') + '\n');
    } else if (!kit) {
      log('marker is not valid JSON, reminders off');
      if (!settingsRemind('UserPromptSubmit')) process.stdout.write(`[ProjectOS plugin] reminders OFF: ${markerName} is not valid JSON. Guards still active.\n`);
    } else {
      const lines = runReminders(kit, root, 'UserPromptSubmit');
      if (lines.length) process.stdout.write(`[ProjectOS plugin] ${lines.join('\n')}\n`);
    }
  } else if (mode === 'pretool') {
    const tool = String(payload.tool_name || '');
    const dir = settingsDir(root);
    const shell = /^(Bash|PowerShell|Monitor)$/.test(tool);
    if (!guardWired(dir, 'Path-guard.mjs', tool)) code = runGuard('Path-guard.mjs', raw, root);
    else log(`path-guard: stand down, wired in settings for ${tool} and on disk`);
    if (code === 0 && shell) {
      if (!guardWired(dir, 'Destructive-guard.mjs', tool)) code = runGuard('Destructive-guard.mjs', raw, root);
      else log(`destructive-guard: stand down, wired in settings for ${tool} and on disk`);
    }
  }
} catch (err) {
  log(`error, allow: ${err && err.message}`);
  code = 0;
}
process.exit(code);
