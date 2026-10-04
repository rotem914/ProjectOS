// dispatch.mjs - the ProjectOS plugin's one hook. Wired by hooks/hooks.json for
// SessionStart, UserPromptSubmit, PreToolUse and Stop, and called with one word:
//
//   node hooks/dispatch.mjs session | prompt | pretool | stop
//
// A fifth word is run by hand, by the install, from a project's folder:
//
//   node hooks/dispatch.mjs approve
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
// process cwd. No marker: exit 0, print nothing, with one exception. When a
// folder directly inside the session folder carries the marker, session start
// prints one line naming it: the rules and guards are off here, open that
// project's folder itself. A designer often opens the app on the folder that
// holds all their projects, and there nothing said that no rule and no guard
// was running (review 2026-10-02). Only one level down, and only at session
// start; a folder with no project inside it stays silent.
//
// THE KIT REPOSITORY ITSELF. Its project-os/ files are the templates shipped to
// clients, so its reminders carry placeholders: there the session and prompt
// hooks print no reminder. The guards run there exactly as in an installed
// project. Until 2026-10-01 the kit repository was skipped whole, so a session
// opened in it ran with no guard at all and `rm -rf src` went through. One
// line still prints there at session start: the notice that the kit's guard
// files differ from the plugin's copy, with the git pull. A session in the kit
// runs the plugin folder's guards, which can be older than the ones being
// edited in it, and without the notice nothing says so (2026-10-01).
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
// ONLY THE WIRING THE SESSION STARTED WITH. Claude Code reads the settings
// hooks once, when a session starts, so wiring written later (the install's
// step 6b) runs only from the next session. Until 2026-10-02 the plugin read
// the settings on every call and stood down the moment the installer wrote
// them, which left the rest of that session with no guard and no reminder.
// Now session start records what the settings wire, one small file per
// session in the plugin's own folder under the OS temp folder (never in the
// project), and a later call stands down only where that record and the
// settings on disk both say so. A start that is not a fresh one (a resume, a
// /clear, a compaction) happens inside a session that still runs the hooks it
// read earlier, so it keeps the least wired of its own record and the
// settings now, or, under a new session id, of every record this folder wrote
// in the last day. With no record at all (a session that began before this
// version, a record that could not be written) a settings file counts only
// when it is older than the session's transcript; when that cannot be told,
// the plugin runs its own copy. Running a guard twice blocks the same; a guard
// that runs nowhere is the failure this prevents.
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
// THE CHECK WHEN A TURN ENDS. On Stop the plugin runs the project's quick
// check through its own copy of project-os/guards/Check-on-stop.mjs, which
// decides whether code changed, runs the check once per state, and on a
// failure exits 2 with the errors so the assistant goes back to work. That
// verdict is passed through unchanged. The command it runs is the one thing
// here that comes from the project: the "command" in
// project-os/Check-command.json.
//
// APPROVED PROJECTS. Everything else the plugin runs is its own code, so a
// repository the owner merely opens can make it run nothing. A check command
// breaks that: it is the project's. So the plugin runs it only for a project
// approved on this computer, and only while the command is still the one that
// was approved. `approve`, run from the project's folder, records the folder
// and the command in .approved-checks.json in the plugin's own folder (kept
// out of git, so a pull never touches it). The install runs it, so for the
// owner it is automatic. A project that arrived with the kit already inside
// it, and was never installed here, has no approval and runs no check. A
// command changed later (a teammate's commit) stops running until the install
// or `Go update kit` approves it again. In the kit repository itself there is
// no check and nothing to approve.
//
// A project whose own settings already wire a check on Stop (a script named
// check-on-stop) keeps its own: the plugin stands down there.
//
// FAIL OPEN. Any error of its own exits 0 silently. Set PROJECTOS_PLUGIN_LOG
// to a file path to get one line per call appended there, for diagnosis.
//
// A GUARD THAT CANNOT ANSWER IS SAID OUT LOUD. A guard missing from the plugin
// folder (an antivirus, an interrupted update) or left unable to load (merge
// markers from a failed pull) gives no verdict, and failing open then lets
// every call through. Until 2026-10-02 that happened in silence: the session
// still said "hooks active" and the log had nothing. Now session start runs
// each guard the plugin would run once, on an empty tool call that every
// working guard answers with exit 0, both side by side so it costs one node
// start. When one does not answer, the session line reads "guards OFF" with
// the reason in place of "hooks active". At tool time a guard that is missing,
// does not start, times out, or exits with anything but 0 or 2 still lets the
// call through, but the plugin then exits 1 with one line on stderr naming it:
// Claude Code shows that line as a hook error and does not block on it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
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

// The payload for session start and prompts, which carries the session id.
// Claude Code writes it and closes stdin, but a run by hand from a terminal,
// or a host that leaves stdin open, would wait until the hook times out, so a
// terminal is never read and anything else gets one second at most.
function readStdinBriefly() {
  return new Promise((resolve) => {
    let data = '';
    let timer = null;
    const done = () => { clearTimeout(timer); resolve(data); };
    try {
      if (process.stdin.isTTY) { done(); return; }
      timer = setTimeout(done, 1000);
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (d) => { data += d; });
      process.stdin.on('end', done);
      process.stdin.on('error', done);
    } catch { done(); }
  });
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

// The folders directly inside `dir` that carry the marker, for the line a
// session opened above its projects gets (see WHICH PROJECTS above). One level
// only, and at most the first 500 folders, so a session opened in a huge
// folder still starts at once.
function kitsInside(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((e) => e.isDirectory() || e.isSymbolicLink())
    .slice(0, 500)
    .map((e) => path.join(dir, e.name))
    .filter((p) => markerIn(p));
}

// The one session line for a folder above its projects, or null when no
// folder directly inside it carries the kit.
function aboveProjectsLine(dir) {
  const kits = kitsInside(dir).map(norm);
  if (!kits.length) return null;
  const shown = kits.slice(0, 3).join(', ') + (kits.length > 3 ? ` and ${kits.length - 3} more` : '');
  const which = kits.length === 1
    ? `the ProjectOS project is the folder inside it, ${shown}. Open the session in that folder itself`
    : `the ProjectOS projects are the folders inside it: ${shown}. Open the session in one of those folders itself`;
  return `[ProjectOS plugin] rules and guards OFF here, in ${norm(dir)}: ${which} to switch them on.`;
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

// Every hook command the loaded settings carry for this event, from all of
// them unless the caller narrows the files.
function settingsCommands(dir, event, files = settingsFiles(dir)) {
  return files.flatMap((f) => hookCommands(readJson(f), event));
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
function guardWired(dir, name, tool, files = settingsFiles(dir)) {
  const groups = files.flatMap((f) => hookGroups(readJson(f), 'PreToolUse'));
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

// Where session start records the wiring it saw (see ONLY THE WIRING THE
// SESSION STARTED WITH above), one file per session id.
const RECORDS = path.join(os.tmpdir(), 'ProjectOS-plugin-sessions');
const DAY = 24 * 60 * 60 * 1000;
const REMINDER_EVENTS = ['SessionStart', 'UserPromptSubmit'];
const recordFile = (id) => path.join(RECORDS, `${String(id).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100)}.json`);

// The settings' wiring as a record: per guard the tools it is proven for, per
// reminder event the hook commands the settings carry.
function wiringIn(dir) {
  const guards = {};
  for (const [name, tools] of Object.entries(GUARD_TOOLS)) guards[name] = tools.filter((tool) => guardWired(dir, name, tool));
  const reminders = {};
  for (const event of REMINDER_EVENTS) reminders[event] = settingsCommands(dir, event);
  return { dir: norm(dir), guards, reminders };
}

// Only what both records carry.
function leastWired(a, b) {
  const both = (x, y) => (Array.isArray(x) && Array.isArray(y) ? x.filter((v) => y.includes(v)) : []);
  const guards = {};
  for (const name of Object.keys(GUARD_TOOLS)) guards[name] = both(a.guards[name], b.guards[name]);
  const reminders = {};
  for (const event of REMINDER_EVENTS) reminders[event] = both(a.reminders[event], b.reminders[event]);
  return { dir: a.dir, guards, reminders };
}

// A record of this session folder, or null. On macOS and Linux the OS temp
// folder can be shared, so there only a file this user owns counts.
function readRecordFile(file, dir) {
  try {
    if (typeof process.getuid === 'function' && fs.statSync(file).uid !== process.getuid()) return null;
  } catch { return null; }
  const rec = readJson(file);
  const ok = rec && rec.dir === norm(dir) && rec.guards && typeof rec.guards === 'object' && rec.reminders && typeof rec.reminders === 'object';
  return ok ? rec : null;
}
const readRecord = (id, dir) => (id ? readRecordFile(recordFile(id), dir) : null);

// The records of this folder written in the last day. Records older than a
// week are removed on the way: one matters only while its session runs, and
// the folder must not grow forever.
function recentRecords(dir) {
  let names;
  try { names = fs.readdirSync(RECORDS); } catch { return []; }
  const out = [];
  for (const name of names) {
    const file = path.join(RECORDS, name);
    try {
      const age = Date.now() - fs.statSync(file).mtimeMs;
      if (age > 7 * DAY) fs.rmSync(file, { force: true });
      else if (age < DAY && name.endsWith('.json')) {
        const rec = readRecordFile(file, dir);
        if (rec) out.push(rec);
      }
    } catch { /* another session's file, mid-write or gone: skip it */ }
  }
  return out;
}

// Written under a temporary name and renamed into place, so a call reading it
// at the same moment never gets half a record.
function writeRecord(id, rec) {
  try {
    fs.mkdirSync(RECORDS, { recursive: true, mode: 0o700 });
    const file = recordFile(id);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(rec), 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    log(`session record not written (${err.message}), later calls go by the age of the settings files`);
  }
}

// Session start: write this session's record and return it, or null with no
// session id. A fresh start records the settings as they are; any other start
// keeps the least wired of what came before (see above).
function recordAtStart(dir, payload) {
  const id = payload.session_id;
  if (!id) return null;
  // Read at every start, not only where it is used, since reading the folder
  // is also what removes the old records.
  const earlier = recentRecords(dir);
  let rec = wiringIn(dir);
  if (payload.source && payload.source !== 'startup') {
    const own = readRecord(id, dir);
    rec = (own ? [own] : earlier).reduce(leastWired, rec);
  }
  writeRecord(id, rec);
  return rec;
}

// When the session's transcript was created, or 0 when that cannot be told.
function transcriptBorn(file) {
  if (!file) return 0;
  try { return fs.statSync(String(file)).birthtimeMs || 0; } catch { return 0; }
}

// What a call goes by: this session's record, written first when this call is
// session start, or without one the settings files older than the transcript.
function startView(root, payload) {
  const dir = settingsDir(root);
  const rec = mode === 'session' ? recordAtStart(dir, payload) : readRecord(payload.session_id, dir);
  if (rec) return { rec };
  const born = transcriptBorn(payload.transcript_path);
  const files = settingsFiles(dir).filter((f) => {
    try { return born > 0 && fs.statSync(f).mtimeMs < born; } catch { return false; }
  });
  return { files };
}

// Whether the plugin stands down for this guard on this tool: the settings
// wired it when the session started and still do, with the script on disk.
function guardStandsDown(dir, name, tool, view) {
  const tools = view.rec && view.rec.guards[name];
  const atStart = view.rec ? Array.isArray(tools) && tools.includes(tool) : guardWired(dir, name, tool, view.files);
  if (atStart) return view.rec ? guardWired(dir, name, tool) : true;
  if (guardWired(dir, name, tool)) log(`${name}: settings wire it for ${tool || 'this call'} only since this session started, plugin runs its copy`);
  return false;
}

// The hook commands for this event that the settings carried when the
// session started and still carry.
function loadedCommands(dir, event, view) {
  if (!view.rec) return settingsCommands(dir, event, view.files);
  const now = settingsCommands(dir, event);
  const then = view.rec.reminders[event];
  return Array.isArray(then) ? then.filter((c) => now.includes(c)) : [];
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

function runReminders(kit, root, event, view) {
  const ours = hookCommands(kit, event);
  const theirs = loadedCommands(settingsDir(root), event, view);
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

// The session line that names those guards, or null when none differs. One
// helper, because the kit repository prints it too (see THE KIT REPOSITORY
// ITSELF above).
function staleLine(root) {
  const differ = staleGuards(root);
  if (!differ.length) return null;
  return `[ProjectOS plugin] this project's ${differ.join(' and ')} differ from the plugin's copy, and where the plugin runs a guard it runs its own. If the project carries the newer kit, update this computer's copy: git -C "${norm(PLUGIN_ROOT)}" pull`;
}

// The tools the plugin sends each guard: the PreToolUse matcher in
// hooks/hooks.json, and the shell tools only for the delete guard, as in the
// pretool branch below.
const GUARD_TOOLS = {
  'Path-guard.mjs': ['Write', 'Edit', 'NotebookEdit', 'Bash', 'PowerShell', 'Monitor'],
  'Destructive-guard.mjs': ['Bash', 'PowerShell', 'Monitor'],
};
const guardScript = (name) => path.join(PLUGIN_ROOT, 'project-os', 'guards', name);
const PROBE_SECONDS = 10;

// "exit 1: SyntaxError: Unexpected token '<<'", from a guard's exit and its
// stderr: the line that names the error, not node's file and caret lines
// printed above it.
function exitReason(status, signal, stderr) {
  const lines = String(stderr || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const why = lines.find((l) => /^[A-Za-z]*Error\b/.test(l)) || lines[0] || '';
  const how = status === null || status === undefined ? `stopped by ${signal || 'a signal'}` : `exit ${status}`;
  return why ? `${how}: ${why.slice(0, 200)}` : how;
}

// One guard run on an empty tool call, which a working guard answers with
// exit 0. Resolves to the reason it cannot answer, or null when it did.
function probeGuard(name, root) {
  const script = guardScript(name);
  if (!fs.existsSync(script)) return Promise.resolve(`${name} is missing from ${norm(path.dirname(script))}`);
  return new Promise((resolve) => {
    let stderr = '';
    let timedOut = false;
    let child;
    try {
      child = spawn(process.execPath, [script], { env: { ...process.env, CLAUDE_PROJECT_DIR: root }, stdio: ['pipe', 'ignore', 'pipe'] });
    } catch (err) {
      resolve(`${name} could not be started (${err.message})`);
      return;
    }
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, PROBE_SECONDS * 1000);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => { clearTimeout(timer); resolve(`${name} could not be started (${err.message})`); });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      if (timedOut) resolve(`${name} did not answer within ${PROBE_SECONDS} seconds`);
      else resolve(status === 0 ? null : `${name} did not load (${exitReason(status, signal, stderr)})`);
    });
    // A guard that exits before reading its input must not crash this check.
    child.stdin.on('error', () => {});
    child.stdin.end('{}');
  });
}

// The reasons the guards the plugin would run here cannot answer, empty when
// both can. A guard the project's own settings wire for every tool the plugin
// sends it, from the start of this session, is never run from here (SETTINGS
// WIRING WINS above), so its copy is not checked: a broken copy nobody runs
// turns nothing off.
async function guardsOff(root, view) {
  const dir = settingsDir(root);
  const names = Object.keys(GUARD_TOOLS).filter((name) => !GUARD_TOOLS[name].every((tool) => guardStandsDown(dir, name, tool, view)));
  const reasons = (await Promise.all(names.map((name) => probeGuard(name, root)))).filter(Boolean);
  for (const why of reasons) log(`guard check at session start: ${why}`);
  return reasons;
}

// The session line for guards that cannot answer, in place of "hooks active".
function guardsOffLine(root, reasons, remindersOn) {
  const they = reasons.length === 1 ? 'it' : 'they';
  const reminders = remindersOn ? `, while the reminders stay active from ${norm(PLUGIN_ROOT)} (kit ${pluginVersion()})` : '';
  return `[ProjectOS plugin] guards OFF for ${norm(root)}: ${reasons.join('; ')}. Every call ${they} would check goes through unchecked${reminders}. See what changed in this computer's copy: git -C "${norm(PLUGIN_ROOT)}" status`;
}

// What the guards that gave no verdict on this call said, for the one stderr
// line at the end of the pretool branch.
const noVerdict = [];

// A guard that gives no verdict lets the call through (FAIL OPEN), and says so
// (see A GUARD THAT CANNOT ANSWER above).
function unchecked(name, why) {
  log(`${name}: no verdict, allow (${why})`);
  noVerdict.push(why);
  return 0;
}

// The projects approved for the check on Stop, and the command approved for
// each (see APPROVED PROJECTS above). Kept in the plugin's own folder.
// PROJECTOS_APPROVED_FILE names another file, for the kit's own tests.
const APPROVED = process.env.PROJECTOS_APPROVED_FILE || path.join(PLUGIN_ROOT, '.approved-checks.json');
const CHECK_FILE = path.join('project-os', 'Check-command.json');
const CHECK_STATES = path.join(os.tmpdir(), 'ProjectOS-plugin-checks');
const approvalKey = (root) => (process.platform === 'win32' ? norm(root).toLowerCase() : norm(root));

function checkCommandOf(root) {
  const kept = readJson(path.join(root, CHECK_FILE));
  const command = kept && typeof kept.command === 'string' ? kept.command.trim() : '';
  return command;
}

function readApproved() {
  const kept = readJson(APPROVED);
  return kept && typeof kept === 'object' && !Array.isArray(kept) ? kept : {};
}

// Run by hand from the project's folder. Says in one line what it did, since
// the install quotes that line.
function approve(root) {
  if (!root) return 'No ProjectOS project here: nothing approved.';
  if (isKitItself(root)) return 'This is the kit repository itself: it has no check to approve.';
  const command = checkCommandOf(root);
  const all = readApproved();
  const key = approvalKey(root);
  if (!command) {
    if (key in all) {
      delete all[key];
      fs.writeFileSync(APPROVED, `${JSON.stringify(all, null, 2)}\n`, 'utf8');
    }
    return `No command in ${norm(path.join(root, CHECK_FILE))}: no automatic check for this project.`;
  }
  all[key] = command;
  fs.writeFileSync(APPROVED, `${JSON.stringify(all, null, 2)}\n`, 'utf8');
  return `Approved on this computer: when a turn ends with changed code in ${norm(root)}, the plugin runs \`${command}\`.`;
}

// A project that wires its own check on Stop keeps it.
function ownCheckWired(root) {
  return settingsCommands(settingsDir(root), 'Stop').some((c) => /check-on-stop/i.test(c));
}

function runCheck(rawPayload, root) {
  const command = checkCommandOf(root);
  if (!command) { log('stop: no check command, inert'); return 0; }
  if (readApproved()[approvalKey(root)] !== command) { log('stop: command not approved on this computer, inert'); return 0; }
  if (ownCheckWired(root)) { log('stop: the project wires its own check, stand down'); return 0; }
  const script = guardScript('Check-on-stop.mjs');
  if (!fs.existsSync(script)) { log('stop: Check-on-stop.mjs is missing, allow'); return 0; }
  const state = path.join(CHECK_STATES, `${Buffer.from(approvalKey(root)).toString('hex').slice(-80)}.json`);
  const r = spawnSync(process.execPath, [script], {
    input: rawPayload,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, CHECK_ON_STOP_COMMAND: command, CHECK_ON_STOP_STATE: state },
    timeout: 170000,
  });
  if (r.status === 2) {
    process.stderr.write(r.stderr || 'The check failed.\n');
    log('stop: check FAILED, sent back');
    return 2;
  }
  log(`stop: allow (${r.error ? r.error.message : `exit ${r.status}`})`);
  return 0;
}

function runGuard(name, rawPayload, root) {
  const script = guardScript(name);
  if (!fs.existsSync(script)) return unchecked(name, `${name} is missing from ${norm(path.dirname(script))}`);
  const r = spawnSync(process.execPath, [script], {
    input: rawPayload,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    timeout: 15000,
  });
  if (r.error) {
    return unchecked(name, r.error.code === 'ETIMEDOUT' ? `${name} did not answer within 15 seconds` : `${name} could not be started (${r.error.message})`);
  }
  if (r.status === 2) {
    process.stderr.write(r.stderr || `${name}: blocked.\n`);
    log(`${name}: BLOCKED`);
    return 2;
  }
  if (r.status !== 0) return unchecked(name, `${name} gave no verdict (${exitReason(r.status, r.signal, r.stderr)})`);
  return 0;
}

let code = 0;
try {
  // PreToolUse reads its payload whole. SessionStart and UserPromptSubmit
  // read theirs only for the session id and transcript, with a bounded wait
  // (see readStdinBriefly), and their root still comes from the environment
  // and cwd alone.
  const raw = mode === 'pretool' || mode === 'stop' ? readStdin() : mode === 'session' || mode === 'prompt' ? await readStdinBriefly() : '';
  let payload = {};
  try { payload = raw.trim() ? JSON.parse(raw) : {}; } catch { payload = {}; }
  if (!payload || typeof payload !== 'object') payload = {};

  const root = findRoot(mode === 'pretool' || mode === 'stop' ? payload : {});
  if (mode === 'approve') {
    process.stdout.write(`[ProjectOS plugin] ${approve(root)}\n`);
  } else if (!root) {
    log('no marker, inert');
    const above = mode === 'session' ? aboveProjectsLine(process.env.CLAUDE_PROJECT_DIR || process.cwd()) : null;
    if (above) process.stdout.write(`${above}\n`);
  } else if ((mode === 'session' || mode === 'prompt') && isKitItself(root)) {
    // No reminder here, while the guards below still run in the kit, so the
    // guard check and the stale-guard notice still print at session start
    // (see THE KIT REPOSITORY ITSELF above).
    log('kit repository itself, reminders off');
    if (mode === 'session') {
      const lines = [];
      const off = await guardsOff(root, startView(root, payload));
      if (off.length) lines.push(guardsOffLine(root, off, false));
      const stale = staleLine(root);
      if (stale) lines.push(stale);
      if (lines.length) process.stdout.write(lines.join('\n') + '\n');
    }
  } else if (mode === 'session' || mode === 'prompt') {
    const marker = markerIn(root);
    const kit = readJson(marker);
    const markerName = norm(path.relative(root, marker));
    const view = startView(root, payload);
    // With a broken marker, a reminder the project's settings carry still
    // prints on its own, so "OFF" is said only where nothing else sends one.
    const settingsRemind = (event) => loadedCommands(settingsDir(root), event, view).some((c) => reminderText(c) !== null);
    if (mode === 'session') {
      const lines = kit ? runReminders(kit, root, 'SessionStart', view) : [];
      const off = await guardsOff(root, view);
      const guards = off.length ? `Guards OFF: ${off.join('; ')}.` : 'Guards still active.';
      if (kit && off.length) lines.push(guardsOffLine(root, off, true));
      else if (kit) lines.push(`[ProjectOS plugin] hooks active for ${norm(root)} from ${norm(PLUGIN_ROOT)} (kit ${pluginVersion()}); nothing to install in this project.`);
      else if (settingsRemind('SessionStart') || settingsRemind('UserPromptSubmit')) lines.push(`[ProjectOS plugin] ${markerName} is not valid JSON in ${norm(root)}: the reminders come only from this project's settings, in the wording they were installed with. ${guards}`);
      else lines.push(`[ProjectOS plugin] reminders OFF for ${norm(root)}: ${markerName} is not valid JSON, so the plugin sends none. ${guards}`);
      // Its own line, after the others: when it sat in the chain above, a
      // valid marker fell through to the "not valid JSON" lines, and a broken
      // marker with a stale guard lost its "OFF" line (fixed 2026-10-01).
      const stale = staleLine(root);
      if (stale) lines.push(stale);
      process.stdout.write(lines.join('\n') + '\n');
    } else if (!kit) {
      log('marker is not valid JSON, reminders off');
      if (!settingsRemind('UserPromptSubmit')) process.stdout.write(`[ProjectOS plugin] reminders OFF: ${markerName} is not valid JSON. Guards still active.\n`);
    } else {
      const lines = runReminders(kit, root, 'UserPromptSubmit', view);
      if (lines.length) process.stdout.write(`[ProjectOS plugin] ${lines.join('\n')}\n`);
    }
  } else if (mode === 'stop') {
    // The kit's own project-os files are templates: nothing to check there.
    if (isKitItself(root)) log('stop: kit repository itself, inert');
    else code = runCheck(raw, root);
  } else if (mode === 'pretool') {
    const tool = String(payload.tool_name || '');
    const dir = settingsDir(root);
    const view = startView(root, payload);
    const shell = /^(Bash|PowerShell|Monitor)$/.test(tool);
    if (!guardStandsDown(dir, 'Path-guard.mjs', tool, view)) code = runGuard('Path-guard.mjs', raw, root);
    else log(`path-guard: stand down, wired in settings for ${tool} since session start and on disk`);
    if (code === 0 && shell) {
      if (!guardStandsDown(dir, 'Destructive-guard.mjs', tool, view)) code = runGuard('Destructive-guard.mjs', raw, root);
      else log(`destructive-guard: stand down, wired in settings for ${tool} since session start and on disk`);
    }
    // One line, since Claude Code shows only the first line of a hook error.
    // Exit 1 lets the call through and shows that line; with exit 0 it would
    // go to the debug log only. After a block, exit 2 stands and the line
    // rides along with the reason.
    if (noVerdict.length) {
      process.stderr.write(`[ProjectOS plugin] ${noVerdict.length === 1 ? 'guard' : 'guards'} skipped on this call, fail open: ${noVerdict.join('; ')}.\n`);
      if (code === 0) code = 1;
    }
  }
} catch (err) {
  log(`error, allow: ${err && err.message}`);
  code = 0;
}
process.exit(code);
