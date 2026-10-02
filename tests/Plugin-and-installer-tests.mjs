// Tests for the kit's plugin hook, hooks/dispatch.mjs, and its hook installer,
// project-os/Install-project-hooks.mjs: the two scripts that decide whether
// the rules and guards are switched on in a project at all.
//
// Run from the kit root:   node tests/Plugin-and-installer-tests.mjs
// It prints one line per failing case and a count at the end, and exits 1 when
// any case fails.
//
// Every case runs the real script as a child process, the way Claude Code
// does: the plugin with its mode word, CLAUDE_PROJECT_DIR set and a hook
// payload on stdin; the installer with node, from a scratch project folder.
// Nothing a payload describes is ever carried out. The scratch projects live
// in one folder under the system temp folder, whose name holds a space on
// purpose, and that folder is removed at the end.
//
// A case marked [R] is one the review of 2026-09-25 found open.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DISPATCH = path.join(KIT, 'hooks', 'dispatch.mjs');
const GUARDS = ['Path-guard.mjs', 'Destructive-guard.mjs'];
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'projectos test ')));
const LOG = path.join(TMP, 'plugin.log');
const fwd = (p) => p.split('\\').join('/');
const WIN = process.platform === 'win32';
const ALL = 'SessionStart, UserPromptSubmit, PreToolUse';

// Run a script as if on Linux: this preload sets process.platform first.
const AS_LINUX = path.join(TMP, 'as-linux.mjs');
fs.writeFileSync(AS_LINUX, "Object.defineProperty(process, 'platform', { value: 'linux' });\n");
const LINUX = ['--import', pathToFileURL(AS_LINUX).href];

const OUTSIDE = fwd(path.join(os.homedir(), 'projectos-test-never-written.txt'));
const P = {
  rm: { tool_name: 'Bash', tool_input: { command: 'rm -rf src' } },
  psRm: { tool_name: 'PowerShell', tool_input: { command: 'Remove-Item -Recurse -Force src' } },
  status: { tool_name: 'Bash', tool_input: { command: 'git status' } },
  writeOut: { tool_name: 'Write', tool_input: { file_path: OUTSIDE, content: 'x' } },
  psOut: { tool_name: 'PowerShell', tool_input: { command: `Set-Content -Path "${OUTSIDE}" -Value x` } },
};
const pay = (dir, p) => ({ cwd: dir, ...p });

function kitProject(dir) {
  fs.mkdirSync(path.join(dir, 'project-os', 'guards'), { recursive: true });
  for (const f of ['Hooks-settings.json', 'Install-project-hooks.mjs']) {
    fs.copyFileSync(path.join(KIT, 'project-os', f), path.join(dir, 'project-os', f));
  }
  for (const g of GUARDS) fs.copyFileSync(path.join(KIT, 'project-os', 'guards', g), path.join(dir, 'project-os', 'guards', g));
  return dir;
}
function writeSettings(dir, obj, file = 'settings.local.json') {
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', file), typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
}
const settingsOf = (dir, file = 'settings.local.json') => JSON.parse(fs.readFileSync(path.join(dir, '.claude', file), 'utf8'));
const cmdsOf = (s, ev) => ((s.hooks || {})[ev] || []).flatMap((g) => g.hooks.map((h) => h.command));
const count = (s, needle) => s.split(needle).length - 1;
const guardCmd = (dir, name) => `node "${fwd(dir)}/project-os/guards/${name}"`;

// A scratch copy of the plugin. The dispatcher runs the guards beside its own
// folder, so one can be removed or broken in the copy without touching the kit.
function pluginCopy(dir) {
  for (const f of ['hooks/dispatch.mjs', '.claude-plugin/plugin.json', ...GUARDS.map((g) => `project-os/guards/${g}`)]) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.copyFileSync(path.join(KIT, f), path.join(dir, f));
  }
  return dir;
}
const pluginGuard = (dir, g) => path.join(dir, 'project-os', 'guards', g);

// The OS temp folder the plugin sees is this test's own folder, so the
// session records it writes there go when the folder does. The projects sit
// inside it either way, so no guard verdict changes. With `sid`, the payload
// carries that session id, as Claude Code's does.
const TEMP_ENV = { TEMP: TMP, TMP, TMPDIR: TMP };
function dispatch(mode, payload, session, { linux = false, plugin, sid } = {}) {
  fs.writeFileSync(LOG, '');
  const script = plugin ? path.join(plugin, 'hooks', 'dispatch.mjs') : DISPATCH;
  const r = spawnSync(process.execPath, [...(linux ? LINUX : []), script, mode], {
    input: JSON.stringify({ ...(payload || {}), ...(sid ? { session_id: sid } : {}) }),
    encoding: 'utf8',
    env: { ...process.env, ...TEMP_ENV, CLAUDE_PROJECT_DIR: session || '', PROJECTOS_PLUGIN_LOG: LOG },
  });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), log: fs.readFileSync(LOG, 'utf8') };
}
// A session that starts now in `session`: its start writes the record later
// calls go by. Returns the options those calls pass.
let sids = 0;
const newSid = () => `test-session-${++sids}`;
function started(session, opts = {}) {
  const sid = newSid();
  dispatch('session', { source: 'startup' }, session, { ...opts, sid });
  return { ...opts, sid };
}
function install(dir, flags = [], { linux = false, home } = {}) {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  if (home) { env.HOME = home; env.USERPROFILE = home; }
  const r = spawnSync(process.execPath, [...(linux ? LINUX : []), path.join('project-os', 'Install-project-hooks.mjs'), ...flags], { cwd: dir, encoding: 'utf8', env });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

let ran = 0;
let failures = 0;
function t(name, pass, detail = '') {
  ran++;
  if (pass) return;
  failures++;
  console.error(`FAIL ${name}${detail ? `\n     ${String(detail).split('\n').join('\n     ')}` : ''}`);
}
const blocks = (r, guard) => r.code === 2 && r.err.includes(`${guard}: blocked`);
const standsDown = (r, n) => r.code === 0 && count(r.log, 'stand down') === n;

try {
  // ---- the plugin ----------------------------------------------------------
  const BARE = path.join(TMP, 'bare');
  fs.mkdirSync(path.join(BARE, 'src'), { recursive: true });
  let r = dispatch('session', {}, BARE);
  t('no marker: session start prints nothing', r.code === 0 && r.out === '', r.out);
  r = dispatch('pretool', pay(BARE, P.rm), BARE);
  t('no marker: rm -rf src is let through, the plugin is inert', r.code === 0, r.err);

  const PROJ = kitProject(path.join(TMP, 'proj'));
  fs.mkdirSync(path.join(PROJ, 'src', 'deep'), { recursive: true });
  r = dispatch('session', {}, PROJ);
  t('marker: session start prints the reminder and the active line', r.code === 0 && r.out.includes('PROJECT RULES') && r.out.includes('[ProjectOS plugin] hooks active for'), r.out);
  // 2026-10-01: a valid marker used to fall through to the broken-marker lines
  // whenever no guard differed, so every session start also said "reminders OFF".
  t('marker: a valid marker gets no broken-marker line', !r.out.includes('reminders OFF') && !r.out.includes('is not valid JSON'), r.out);
  // [R10] The active line names the kit version the plugin carries, and a
  // project whose guard files differ from the plugin's copy is told so, with
  // the one command that updates the plugin folder.
  const VERSION = JSON.parse(fs.readFileSync(path.join(KIT, '.claude-plugin', 'plugin.json'), 'utf8')).version;
  t('[R10] the active line names the kit version', r.out.includes(`(kit ${VERSION})`), r.out);
  t('[R10] a project with the same guards gets no update line', !r.out.includes('differ from the plugin'), r.out);
  const NEWER = kitProject(path.join(TMP, 'newer guards'));
  fs.appendFileSync(path.join(NEWER, 'project-os', 'guards', 'Destructive-guard.mjs'), '\n// a newer kit\n');
  r = dispatch('session', {}, NEWER);
  t('[R10] a project whose delete guard differs is told, with the pull command', r.code === 0 && r.out.includes("this project's Destructive-guard.mjs differ from the plugin's copy") && r.out.includes(`git -C "${fwd(KIT)}" pull`), r.out);
  t('[R10] beside the notice, the active line and no broken-marker line', r.out.includes('hooks active for') && !r.out.includes('reminders OFF') && !r.out.includes('is not valid JSON'), r.out);
  r = dispatch('prompt', {}, PROJ);
  t('marker: every prompt prints the standing rules once', r.code === 0 && r.out.startsWith('[ProjectOS plugin]') && count(r.out, 'STANDING RULES') === 1, r.out);
  r = dispatch('pretool', pay(PROJ, P.writeOut), PROJ);
  t('no settings: a Write outside the project is blocked', blocks(r, 'path-guard'), r.err);
  r = dispatch('pretool', pay(PROJ, P.rm), PROJ);
  t('no settings: rm -rf src is blocked', blocks(r, 'destructive-guard'), r.err);
  r = dispatch('pretool', pay(PROJ, P.psRm), PROJ);
  t('no settings: PowerShell delete of src is blocked', blocks(r, 'destructive-guard'), r.err);
  r = dispatch('pretool', pay(PROJ, P.status), PROJ);
  t('no settings: git status is allowed', r.code === 0, r.err);
  r = dispatch('pretool', pay(PROJ, P.rm), path.join(PROJ, 'src', 'deep'));
  t('a session opened in a subfolder finds the project and blocks', blocks(r, 'destructive-guard'), r.err);

  // 2026-10-01: in the kit repository itself the reminders stay off, since its
  // templates carry placeholders, and both guards run as in any project. The
  // kit used to be skipped whole, so `rm -rf src` went through there. A scratch
  // copy stands in for the kit, so a settings file in the real one cannot
  // change the verdicts.
  const kitRepoCopy = (dir) => {
    kitProject(dir);
    fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(KIT, '.claude-plugin', 'plugin.json'), path.join(dir, '.claude-plugin', 'plugin.json'));
    fs.mkdirSync(path.join(dir, 'hooks'), { recursive: true });
    fs.copyFileSync(DISPATCH, path.join(dir, 'hooks', 'dispatch.mjs'));
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    return dir;
  };
  const KITREPO = kitRepoCopy(path.join(TMP, 'kit repo'));
  r = dispatch('session', {}, KITREPO);
  t('kit repository: session start prints no reminder', r.code === 0 && r.out === '' && r.log.includes('kit repository itself, reminders off'), r.out || r.log);
  r = dispatch('prompt', {}, KITREPO);
  t('kit repository: a prompt prints no reminder', r.code === 0 && r.out === '' && r.log.includes('kit repository itself, reminders off'), r.out || r.log);
  r = dispatch('pretool', pay(KITREPO, P.rm), KITREPO);
  t('kit repository: rm -rf src is blocked', blocks(r, 'destructive-guard'), r.err || r.log);
  r = dispatch('pretool', pay(KITREPO, P.psRm), KITREPO);
  t('kit repository: PowerShell delete of src is blocked', blocks(r, 'destructive-guard'), r.err || r.log);
  r = dispatch('pretool', pay(KITREPO, P.writeOut), KITREPO);
  t('kit repository: a Write outside the folder is blocked', blocks(r, 'path-guard'), r.err || r.log);
  r = dispatch('pretool', pay(KITREPO, P.psOut), KITREPO);
  t('kit repository: a PowerShell write outside the folder is blocked', blocks(r, 'path-guard'), r.err || r.log);
  r = dispatch('pretool', pay(KITREPO, { tool_name: 'Write', tool_input: { file_path: fwd(path.join(KITREPO, 'tests', 'New-tests.mjs')), content: 'x' } }), KITREPO);
  t('kit repository: a Write inside the folder is allowed', r.code === 0 && r.err === '', r.err || r.log);
  r = dispatch('pretool', pay(KITREPO, P.status), KITREPO);
  t('kit repository: git status is allowed', r.code === 0 && r.err === '', r.err || r.log);
  // The real kit is taken for the kit too: its session and prompt stay silent.
  r = dispatch('session', {}, KIT);
  t('the real kit repository: session start prints no reminder', r.code === 0 && r.out === '' && r.log.includes('kit repository itself, reminders off'), r.out || r.log);
  r = dispatch('prompt', {}, KIT);
  t('the real kit repository: a prompt prints no reminder', r.code === 0 && r.out === '' && r.log.includes('kit repository itself, reminders off'), r.out || r.log);
  // 2026-10-01: a session in the kit runs the plugin folder's guards, which can
  // be older than the ones being edited there, so the stale-guard notice prints
  // in the kit too, alone, at session start only.
  const KITEDIT = kitRepoCopy(path.join(TMP, 'kit repo editing a guard'));
  fs.appendFileSync(path.join(KITEDIT, 'project-os', 'guards', 'Path-guard.mjs'), '\n// being edited\n');
  r = dispatch('session', {}, KITEDIT);
  t('kit repository with a guard that differs: session start prints the stale notice, with the pull', r.code === 0 && r.out.includes("this project's Path-guard.mjs differ from the plugin's copy") && r.out.includes(`git -C "${fwd(KIT)}" pull`), r.out || r.log);
  t('kit repository with a guard that differs: the notice is the only line, no reminder', r.out.split('\n').length === 1 && !r.out.includes('PROJECT RULES') && !r.out.includes('hooks active') && !r.out.includes('reminders OFF'), r.out);
  r = dispatch('prompt', {}, KITEDIT);
  t('kit repository with a guard that differs: a prompt still prints nothing', r.code === 0 && r.out === '', r.out);

  // [R] T9: the folder the session was opened in decides.
  const PARENT = path.join(TMP, 'parent');
  const A = kitProject(path.join(PARENT, 'proj a'));
  const B = kitProject(path.join(PARENT, 'proj b'));
  const writeB = { tool_name: 'Write', tool_input: { file_path: fwd(path.join(B, 'notes.md')), content: 'x' } };
  r = dispatch('pretool', pay(A, writeB), PARENT);
  t('[R] a session on a parent folder stays inert after its shell moves into a project', r.code === 0 && r.log.includes('no marker, inert'), r.log);
  r = dispatch('pretool', pay(A, writeB), A);
  t('a session opened in one project is blocked from writing into its sibling', blocks(r, 'path-guard'), r.err);

  // [R] T51 (2026-10-02): a session opened on the folder that holds the
  // projects runs with no rules and no guards. Session start now says so in
  // one line, naming the project folders to open instead.
  r = dispatch('session', {}, PARENT);
  t('[R] T51 a session on a folder holding two projects gets one line naming both', r.code === 0 && r.out.split('\n').length === 1 && r.out.includes(`rules and guards OFF here, in ${fwd(PARENT)}`) && r.out.includes(fwd(A)) && r.out.includes(fwd(B)) && r.out.includes('Open the session in one of those folders itself'), r.out);
  t('T51 the line carries no reminder and no active line', !r.out.includes('PROJECT RULES') && !r.out.includes('hooks active'), r.out);
  r = dispatch('prompt', {}, PARENT);
  t('T51 a prompt on that folder still prints nothing', r.code === 0 && r.out === '', r.out);
  const ONE = path.join(TMP, 'one project inside');
  const SITE = kitProject(path.join(ONE, 'site'));
  fs.mkdirSync(path.join(ONE, 'notes'), { recursive: true });
  r = dispatch('session', {}, ONE);
  t('T51 a folder holding one project names that folder, by its full path', r.code === 0 && r.out.split('\n').length === 1 && r.out.includes(`the ProjectOS project is the folder inside it, ${fwd(SITE)}. Open the session in that folder itself`), r.out);
  const MANY = path.join(TMP, 'four projects inside');
  for (const n of ['p1', 'p2', 'p3', 'p4']) kitProject(path.join(MANY, n));
  r = dispatch('session', {}, MANY);
  t('T51 a folder holding four projects names three and counts the rest, still one line', r.code === 0 && r.out.split('\n').length === 1 && r.out.includes(fwd(path.join(MANY, 'p3'))) && !r.out.includes(fwd(path.join(MANY, 'p4'))) && r.out.includes('and 1 more'), r.out);
  const DEEP = path.join(TMP, 'two levels above');
  kitProject(path.join(DEEP, 'group', 'site'));
  r = dispatch('session', {}, DEEP);
  t('T51 a project two levels down is not named: session start stays silent', r.code === 0 && r.out === '', r.out);
  r = dispatch('session', {}, path.join(PROJ, 'src', 'deep'));
  t('T51 a session in a project subfolder finds the project and gets no folder line', r.code === 0 && r.out.includes('hooks active for') && !r.out.includes('rules and guards OFF here'), r.out);

  // Installed wiring: in a session that starts after the install, the plugin
  // stands down for what the settings carry.
  const INST = kitProject(path.join(TMP, 'installed'));
  install(INST);
  const instSession = { sid: newSid() };
  r = dispatch('session', { source: 'startup' }, INST, instSession);
  t('installed: session start prints only the active line', r.code === 0 && count(r.out, 'PROJECT RULES') === 0 && r.out.includes('hooks active for'), r.out);
  r = dispatch('prompt', {}, INST, instSession);
  t('installed: the plugin prints no second copy of the standing rules', r.code === 0 && r.out === '', r.out);
  r = dispatch('pretool', pay(INST, P.rm), INST, instSession);
  t('installed: the plugin stands down for both guards', standsDown(r, 2), r.log);

  const GONE = kitProject(path.join(TMP, 'guard gone'));
  writeSettings(GONE, { hooks: { PreToolUse: [
    { matcher: 'Write|Edit|NotebookEdit|Bash|PowerShell|Monitor', hooks: [{ type: 'command', command: guardCmd(path.join(TMP, 'moved away'), 'Path-guard.mjs') }] },
    { matcher: 'Bash|PowerShell|Monitor', hooks: [{ type: 'command', command: guardCmd(path.join(TMP, 'moved away'), 'Destructive-guard.mjs') }] },
  ] } });
  r = dispatch('pretool', pay(GONE, P.rm), GONE);
  t('settings name a guard that is not on disk: the plugin runs its own copy and blocks', blocks(r, 'destructive-guard'), r.err);

  // [R] T8: a guard wired for some tools only covers those tools.
  const PART = kitProject(path.join(TMP, 'partly wired'));
  writeSettings(PART, { hooks: { PreToolUse: [
    { matcher: 'Write|Edit', hooks: [{ type: 'command', command: guardCmd(PART, 'Path-guard.mjs') }] },
    { matcher: 'Bash|PowerShell|Monitor.*', hooks: [{ type: 'command', command: guardCmd(PART, 'Destructive-guard.mjs') }] },
  ] } });
  const partSession = started(PART);
  r = dispatch('pretool', pay(PART, P.writeOut), PART, partSession);
  t('[R] Path-guard wired for Write|Edit: the plugin stands down for a Write', standsDown(r, 1), r.log);
  r = dispatch('pretool', pay(PART, P.psOut), PART, partSession);
  t('[R] Path-guard wired for Write|Edit: a PowerShell write outside is still blocked', blocks(r, 'path-guard'), r.err || r.log);
  r = dispatch('pretool', pay(PART, P.rm), PART, partSession);
  t('[R] a pattern matcher is not taken as proof: rm -rf src is blocked', blocks(r, 'destructive-guard'), r.err || r.log);

  // [R] T17: an installed reminder in an older wording stands in for ours.
  const OLD = kitProject(path.join(TMP, 'old wording'));
  writeSettings(OLD, { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: `node -e "console.log('STANDING RULES: 1) an older wording.')"` }] }] } });
  r = dispatch('prompt', {}, OLD, started(OLD));
  t('[R] settings carry an older wording of the standing rules: the plugin adds no second list', r.code === 0 && r.out === '', r.out);

  // [R] 2026-09-26: a reminder of the project's own, for something else, never silences the kit's.
  const OWN = kitProject(path.join(TMP, 'own reminder'));
  writeSettings(OWN, { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: `node -e "console.log('Remember the staging server is shared.')"` }] }] } });
  r = dispatch('prompt', {}, OWN);
  t('[R] settings carry an unrelated reminder of their own: the kit still sends its standing rules', r.code === 0 && count(r.out, 'STANDING RULES') === 1, r.out);

  // [R] T37: a marker that is not valid JSON is reported, and the guards keep running.
  const BROKEN = kitProject(path.join(TMP, 'broken marker'));
  fs.writeFileSync(path.join(BROKEN, 'project-os', 'Hooks-settings.json'), '{ "hooks": ');
  r = dispatch('session', {}, BROKEN);
  t('[R] broken marker: session start says the reminders are off', r.code === 0 && r.out.includes('reminders OFF') && !r.out.includes('hooks active'), r.out);
  r = dispatch('prompt', {}, BROKEN);
  t('[R] broken marker: every prompt says the reminders are off', r.code === 0 && r.out.includes('reminders OFF'), r.out);
  r = dispatch('pretool', pay(BROKEN, P.rm), BROKEN);
  t('[R] broken marker: rm -rf src is still blocked', blocks(r, 'destructive-guard'), r.err);
  // 2026-10-01: a guard that differs used to take the place of the "OFF" line.
  fs.appendFileSync(path.join(BROKEN, 'project-os', 'guards', 'Destructive-guard.mjs'), '\n// a newer kit\n');
  r = dispatch('session', {}, BROKEN);
  t('broken marker and a guard that differs: session start prints both lines', r.code === 0 && r.out.includes('reminders OFF') && r.out.includes("this project's Destructive-guard.mjs differ from the plugin's copy"), r.out);

  // [R] T48 (2026-10-02): a guard the plugin cannot run used to fail open in
  // silence, while the session still said hooks active. Scratch copies of the
  // plugin stand in, each with one guard removed or broken.
  const HEALTHY = pluginCopy(path.join(TMP, 'plugin healthy'));
  const writeIn = { tool_name: 'Write', tool_input: { file_path: fwd(path.join(PROJ, 'notes.md')), content: 'x' } };
  const everyday = {
    'git status': P.status,
    'npm test': { tool_name: 'Bash', tool_input: { command: 'npm test' } },
    'a PowerShell listing': { tool_name: 'PowerShell', tool_input: { command: 'Get-ChildItem src' } },
    'a Write inside the project': writeIn,
  };
  r = dispatch('session', {}, PROJ, { plugin: HEALTHY });
  t('T48 healthy plugin: session start says hooks active and no guards OFF', r.code === 0 && r.out.includes('hooks active for') && !r.out.includes('guards OFF') && r.log === '', r.out || r.log);
  for (const [what, call] of Object.entries(everyday)) {
    r = dispatch('pretool', pay(PROJ, call), PROJ, { plugin: HEALTHY });
    t(`T48 healthy plugin: ${what} is allowed in silence`, r.code === 0 && r.err === '', r.err || r.log);
  }

  const NO_DEL = pluginCopy(path.join(TMP, 'plugin without its delete guard'));
  fs.rmSync(pluginGuard(NO_DEL, 'Destructive-guard.mjs'));
  r = dispatch('session', {}, PROJ, { plugin: NO_DEL });
  t('[R] T48 delete guard missing: session start says guards OFF and why, in place of hooks active', r.code === 0 && r.out.includes(`[ProjectOS plugin] guards OFF for ${fwd(PROJ)}: Destructive-guard.mjs is missing from ${fwd(path.join(NO_DEL, 'project-os', 'guards'))}`) && !r.out.includes('hooks active'), r.out);
  t('T48 delete guard missing: the reminders still print, and the line says they are on', r.out.includes('PROJECT RULES') && r.out.includes('while the reminders stay active from') && r.out.includes(`git -C "${fwd(NO_DEL)}" status`), r.out);
  r = dispatch('pretool', pay(PROJ, P.rm), PROJ, { plugin: NO_DEL });
  t('[R] T48 delete guard missing: rm -rf src still goes through, with exit 1 and one stderr line naming it', r.code === 1 && r.err.split('\n').length === 1 && r.err.includes('guard skipped on this call, fail open: Destructive-guard.mjs is missing from'), r.err);
  t('[R] T48 delete guard missing: the diagnostic log records it', r.log.includes('Destructive-guard.mjs: no verdict, allow'), r.log);
  r = dispatch('pretool', pay(PROJ, P.writeOut), PROJ, { plugin: NO_DEL });
  t('T48 delete guard missing: the folder guard still blocks a Write outside', blocks(r, 'path-guard') && !r.err.includes('skipped'), r.err);
  r = dispatch('pretool', pay(PROJ, writeIn), PROJ, { plugin: NO_DEL });
  t('T48 delete guard missing: a Write inside, which that guard is never sent, stays silent', r.code === 0 && r.err === '', r.err);

  const MERGED = pluginCopy(path.join(TMP, 'plugin with merge markers'));
  const mergedGuard = pluginGuard(MERGED, 'Destructive-guard.mjs');
  fs.writeFileSync(mergedGuard, '<<<<<<< HEAD\n' + fs.readFileSync(mergedGuard, 'utf8'));
  r = dispatch('session', {}, PROJ, { plugin: MERGED });
  t('[R] T48 delete guard left unloadable: session start says guards OFF, with the error', r.code === 0 && r.out.includes('guards OFF for') && r.out.includes('Destructive-guard.mjs did not load (exit 1: SyntaxError') && !r.out.includes('hooks active'), r.out);
  r = dispatch('pretool', pay(PROJ, P.rm), PROJ, { plugin: MERGED });
  t('[R] T48 delete guard left unloadable: rm -rf src goes through with exit 1, the error on stderr and in the log', r.code === 1 && r.err.includes('Destructive-guard.mjs gave no verdict (exit 1: SyntaxError') && r.log.includes('Destructive-guard.mjs: no verdict, allow'), r.err || r.log);

  const ODD = pluginCopy(path.join(TMP, 'plugin with an odd exit'));
  fs.writeFileSync(pluginGuard(ODD, 'Destructive-guard.mjs'), "import fs from 'node:fs';\nfs.readFileSync(0);\nprocess.stderr.write('something odd\\n');\nprocess.exit(3);\n");
  r = dispatch('pretool', pay(PROJ, P.rm), PROJ, { plugin: ODD });
  t('T48 a guard exiting 3: the call goes through with exit 1, naming the exit', r.code === 1 && r.err.includes('Destructive-guard.mjs gave no verdict (exit 3: something odd)'), r.err);

  const NO_PATH = pluginCopy(path.join(TMP, 'plugin with a broken folder guard'));
  const brokenPath = pluginGuard(NO_PATH, 'Path-guard.mjs');
  fs.writeFileSync(brokenPath, '<<<<<<< HEAD\n' + fs.readFileSync(brokenPath, 'utf8'));
  r = dispatch('pretool', pay(PROJ, P.rm), PROJ, { plugin: NO_PATH });
  t('T48 folder guard broken: the delete guard still runs and blocks, and the skipped guard is named too', blocks(r, 'destructive-guard') && r.err.includes('Path-guard.mjs gave no verdict'), r.err);
  r = dispatch('pretool', pay(PROJ, P.writeOut), PROJ, { plugin: NO_PATH });
  t('T48 folder guard broken: a Write outside goes through with exit 1', r.code === 1 && r.err.includes('Path-guard.mjs gave no verdict'), r.err);

  const NONE = pluginCopy(path.join(TMP, 'plugin with no guard at all'));
  for (const g of GUARDS) fs.rmSync(pluginGuard(NONE, g));
  r = dispatch('session', {}, PROJ, { plugin: NONE });
  t('T48 both guards missing: one guards OFF line names both', r.code === 0 && count(r.out, 'guards OFF') === 1 && r.out.includes('Path-guard.mjs is missing') && r.out.includes('Destructive-guard.mjs is missing') && r.out.includes('Every call they would check'), r.out);
  r = dispatch('pretool', pay(PROJ, P.rm), PROJ, { plugin: NONE });
  t('T48 both guards missing: one stderr line names both', r.code === 1 && r.err.split('\n').length === 1 && r.err.includes('guards skipped on this call') && r.err.includes('Path-guard.mjs') && r.err.includes('Destructive-guard.mjs'), r.err);

  r = dispatch('session', {}, BROKEN, { plugin: NO_DEL });
  t('T48 broken marker and a missing guard: the OFF line no longer says the guards are active', r.code === 0 && r.out.includes('reminders OFF') && r.out.includes('Guards OFF: Destructive-guard.mjs is missing') && !r.out.includes('Guards still active'), r.out);
  r = dispatch('session', {}, KITREPO, { plugin: NO_DEL });
  t('T48 kit repository with a missing guard: session start says guards OFF, and still no reminder', r.code === 0 && r.out.includes('guards OFF for') && !r.out.includes('PROJECT RULES') && !r.out.includes('hooks active') && !r.out.includes('reminders stay active'), r.out);
  r = dispatch('session', { source: 'startup' }, INST, { plugin: NO_DEL, sid: newSid() });
  t('T48 settings wire both guards for every tool: the plugin copy is not checked, no guards OFF', r.code === 0 && r.out.includes('hooks active for') && !r.out.includes('guards OFF'), r.out);
  r = dispatch('session', {}, PART, { plugin: NO_DEL });
  t('T48 settings wire the delete guard under a pattern only: its missing plugin copy is reported', r.code === 0 && r.out.includes('guards OFF for') && r.out.includes('Destructive-guard.mjs is missing'), r.out);

  // T53 (2026-10-02): once the installer wired the project's own guards, an
  // older plugin steps aside for both of them, on every tool it is sent, so
  // the project's newer guards are the ones that run. The older plugin's
  // guards here let everything through and leave a line in the log.
  const OLDER = pluginCopy(path.join(TMP, 'older plugin'));
  for (const g of GUARDS) fs.writeFileSync(pluginGuard(OLDER, g), `import fs from 'node:fs';\nfs.readFileSync(0);\nfs.appendFileSync(process.env.PROJECTOS_PLUGIN_LOG, 'older ${g} ran\\n');\n`);
  const NEWKIT = kitProject(path.join(TMP, 'newer kit than the plugin'));
  fs.mkdirSync(path.join(NEWKIT, 'src'), { recursive: true });
  const installSession = started(NEWKIT, { plugin: OLDER });
  r = dispatch('pretool', pay(NEWKIT, P.rm), NEWKIT, installSession);
  t('T53 before the install: the older plugin runs its own copy and rm -rf src goes through', r.code === 0 && r.log.includes('older Destructive-guard.mjs ran'), r.log);
  r = install(NEWKIT);
  t('T53 the installer wires the project into its settings with the plugin on the computer', r.code === 0 && r.out.includes(`added:    ${ALL}`), r.out);
  const toolCalls = {
    Write: P.writeOut,
    Edit: { tool_name: 'Edit', tool_input: { file_path: OUTSIDE, old_string: 'a', new_string: 'b' } },
    NotebookEdit: { tool_name: 'NotebookEdit', tool_input: { notebook_path: `${OUTSIDE}.ipynb`, new_source: 'x' } },
    Bash: P.rm,
    PowerShell: P.psRm,
    Monitor: { tool_name: 'Monitor', tool_input: { command: 'rm -rf src' } },
  };
  // [R] R1 (2026-10-02): Claude Code reads the settings hooks when a session
  // starts, so the wiring just written runs only from the next session. The
  // plugin used to step aside the moment the file was written, which left the
  // rest of the install session with no guard and no reminder. Now it keeps
  // running its own copy there, on every tool, through a compaction and a
  // /clear, and steps aside from the next session on.
  const pluginRan = (r, n) => count(r.log, 'older ') === n && !r.log.includes('stand down');
  for (const [tool, call] of Object.entries(toolCalls)) {
    const n = /^(Bash|PowerShell|Monitor)$/.test(tool) ? 2 : 1;
    r = dispatch('pretool', pay(NEWKIT, call), NEWKIT, installSession);
    t(`[R] R1 later in the install session: the plugin still runs ${n === 2 ? 'both guards' : 'the folder guard'} on ${tool}`, pluginRan(r, n) && r.log.includes('only since this session started'), r.log);
  }
  r = dispatch('prompt', {}, NEWKIT, installSession);
  t('[R] R1 later in the install session: every prompt still gets the standing rules', r.code === 0 && count(r.out, 'STANDING RULES') === 1, r.out);
  r = dispatch('session', { source: 'compact' }, NEWKIT, installSession);
  t('[R] R1 a compaction in the install session: the reminder prints and the plugin guards are still checked', r.code === 0 && r.out.includes('PROJECT RULES') && r.log.includes('older'), r.out || r.log);
  r = dispatch('pretool', pay(NEWKIT, P.rm), NEWKIT, installSession);
  t('[R] R1 after that compaction the plugin still runs both guards', pluginRan(r, 2), r.log);
  const clearSession = { plugin: OLDER, sid: newSid() };
  dispatch('session', { source: 'clear' }, NEWKIT, clearSession);
  r = dispatch('pretool', pay(NEWKIT, P.rm), NEWKIT, clearSession);
  t('[R] R1 a /clear in the install session, under a new session id: the plugin still runs both guards', pluginRan(r, 2), r.log);
  r = dispatch('prompt', {}, NEWKIT, clearSession);
  t('R1 after that /clear every prompt still gets the standing rules', r.code === 0 && count(r.out, 'STANDING RULES') === 1, r.out);
  const nextSession = started(NEWKIT, { plugin: OLDER });
  for (const [tool, call] of Object.entries(toolCalls)) {
    const n = /^(Bash|PowerShell|Monitor)$/.test(tool) ? 2 : 1;
    r = dispatch('pretool', pay(NEWKIT, call), NEWKIT, nextSession);
    t(`T53 in the next session: the older plugin steps aside for ${n === 2 ? 'both guards' : 'the folder guard'} on ${tool}`, standsDown(r, n) && r.err === '' && !r.log.includes('older'), r.log);
  }
  r = dispatch('prompt', {}, NEWKIT, nextSession);
  t('R1 in the next session the plugin prints no second copy of the standing rules', r.code === 0 && r.out === '', r.out);
  const wiredCmds = cmdsOf(settingsOf(NEWKIT), 'PreToolUse');
  for (const [g, call] of [['Path-guard.mjs', P.writeOut], ['Destructive-guard.mjs', P.rm]]) {
    const cmd = wiredCmds.find((c) => c.includes(g)) || '';
    const quoted = (/"([^"]+)"/.exec(cmd) || [])[1] || '';
    const script = path.resolve(quoted.replace('${CLAUDE_PROJECT_DIR}', fwd(NEWKIT)));
    const own = spawnSync(process.execPath, [script], { input: JSON.stringify(pay(NEWKIT, call)), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: NEWKIT } });
    t(`T53 after the install: the ${g} the settings run is the project's own copy, and it blocks`, script === path.join(NEWKIT, 'project-os', 'guards', g) && own.status === 2, `${cmd}\n${own.stderr}`);
  }
  r = dispatch('session', { source: 'startup' }, NEWKIT, { plugin: OLDER, sid: newSid() });
  t('T53 after the install: session start skips the plugin guard check and still says the guards differ', r.code === 0 && !r.log.includes('older') && !r.out.includes('guards OFF') && r.out.includes('Path-guard.mjs and Destructive-guard.mjs differ'), r.out || r.log);
  // On macOS and Linux the installer names the guards by the project's own
  // path and a subfolder session also loads the git root's personal file, so
  // the older plugin steps aside there too.
  const NEWKIT_L = kitProject(path.join(TMP, 'newer kit linux'));
  fs.mkdirSync(path.join(NEWKIT_L, '.git'), { recursive: true });
  fs.mkdirSync(path.join(NEWKIT_L, 'src', 'deep'), { recursive: true });
  install(NEWKIT_L, [], { linux: true });
  r = dispatch('pretool', pay(NEWKIT_L, P.rm), NEWKIT_L, started(NEWKIT_L, { linux: true, plugin: OLDER }));
  t('T53 Linux: at the project root the older plugin steps aside for both guards', standsDown(r, 2) && !r.log.includes('older'), r.log);
  const DEEP_L = path.join(NEWKIT_L, 'src', 'deep');
  r = dispatch('pretool', pay(DEEP_L, P.rm), DEEP_L, started(DEEP_L, { linux: true, plugin: OLDER }));
  t('T53 Linux: in a subfolder session the older plugin steps aside for both guards', standsDown(r, 2) && !r.log.includes('older'), r.log);

  // A git worktree reads the main checkout's personal settings on macOS and Linux.
  const MAIN = kitProject(path.join(TMP, 'main checkout'));
  fs.mkdirSync(path.join(MAIN, '.git', 'worktrees', 'w'), { recursive: true });
  fs.writeFileSync(path.join(MAIN, '.git', 'worktrees', 'w', 'commondir'), '../..\n');
  install(MAIN);
  const WT = kitProject(path.join(TMP, 'worktree w'));
  fs.writeFileSync(path.join(WT, '.git'), `gitdir: ${fwd(MAIN)}/.git/worktrees/w\n`);
  r = dispatch('prompt', {}, WT, started(WT, { linux: true }));
  t('Linux: a worktree follows its .git file to the main checkout, whose settings carry the reminders', r.code === 0 && r.out === '', r.out);

  // R1 with no record (a session that began before the plugin kept them): a
  // settings file counts only when it is older than the session's transcript,
  // and when that cannot be told the plugin runs its own copy.
  const NOREC = kitProject(path.join(TMP, 'no session record'));
  fs.mkdirSync(path.join(NOREC, 'src'), { recursive: true });
  const before = path.join(TMP, 'transcript before the install.jsonl');
  fs.writeFileSync(before, '');
  install(NOREC);
  const after = path.join(TMP, 'transcript after the install.jsonl');
  fs.writeFileSync(after, '');
  r = dispatch('pretool', { ...pay(NOREC, P.rm), transcript_path: before }, NOREC, { sid: 'never-started' });
  t('[R] R1 no record, settings newer than the transcript: the plugin runs its own copy and blocks', blocks(r, 'destructive-guard') && r.log.includes('only since this session started'), r.err || r.log);
  r = dispatch('prompt', { transcript_path: before }, NOREC, { sid: 'never-started' });
  t('R1 no record, settings newer than the transcript: the prompt gets the standing rules', r.code === 0 && count(r.out, 'STANDING RULES') === 1, r.out);
  r = dispatch('pretool', pay(NOREC, P.rm), NOREC);
  t('R1 no record and no transcript: the plugin runs its own copy and blocks', blocks(r, 'destructive-guard'), r.err || r.log);
  // A file system that keeps no creation time cannot tell, so this one case
  // runs only where it does.
  if (fs.statSync(after).birthtimeMs > 0) {
    r = dispatch('pretool', { ...pay(NOREC, P.rm), transcript_path: after }, NOREC, { sid: 'never-started-either' });
    t('R1 no record, settings older than the transcript: the plugin stands down as before', standsDown(r, 2), r.log);
  }

  // R1 reads the session id from stdin at session start. A host that leaves
  // stdin open must not hold the hook until it times out.
  const open = await new Promise((resolve) => {
    const began = Date.now();
    const child = spawn(process.execPath, [DISPATCH, 'session'], { env: { ...process.env, ...TEMP_ENV, CLAUDE_PROJECT_DIR: PROJ }, stdio: ['pipe', 'pipe', 'ignore'] });
    const stop = setTimeout(() => child.kill(), 20000);
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; });
    child.on('close', (status) => { clearTimeout(stop); resolve({ status, out, ms: Date.now() - began }); });
  });
  t('R1 a session start whose stdin stays open still ends within seconds, with the reminder', open.status === 0 && open.ms < 8000 && open.out.includes('PROJECT RULES'), JSON.stringify(open));

  // ---- the installer -------------------------------------------------------
  const FRESH = kitProject(path.join(TMP, 'fresh'));
  r = install(FRESH);
  let s = settingsOf(FRESH);
  t('fresh install adds all three events', r.code === 0 && r.out.includes(`added:    ${ALL}`), r.out);
  // [R10] On Windows the personal file keeps ${CLAUDE_PROJECT_DIR}, so a
  // renamed or moved project keeps its guards; on macOS and Linux it names the
  // project's own path, which a subfolder session needs.
  const personal = (dir, name) => (WIN ? `node "\${CLAUDE_PROJECT_DIR}/project-os/guards/${name}"` : guardCmd(dir, name));
  t(WIN ? '[R10] Windows: a fresh install keeps the placeholder in the personal file' : 'fresh install names the guards by this project\'s own path', cmdsOf(s, 'PreToolUse').join('|') === `${personal(FRESH, 'Path-guard.mjs')}|${personal(FRESH, 'Destructive-guard.mjs')}`, cmdsOf(s, 'PreToolUse').join('\n'));
  const FRESH_L = kitProject(path.join(TMP, 'fresh linux'));
  install(FRESH_L, [], { linux: true });
  t('[R10] Linux: a fresh install names the guards by this project\'s own path', cmdsOf(settingsOf(FRESH_L), 'PreToolUse')[0] === guardCmd(FRESH_L, 'Path-guard.mjs'), cmdsOf(settingsOf(FRESH_L), 'PreToolUse').join('\n'));
  r = dispatch('pretool', pay(FRESH, P.rm), FRESH, started(FRESH));
  t('[R10] after a personal install the plugin stands down for the placeholder wiring too', standsDown(r, 2), r.log);
  r = install(FRESH);
  t('a second run changes nothing', r.code === 0 && r.out.includes('nothing to change'), r.out);
  r = install(FRESH, ['--dry']);
  t('--dry after the install lists every event as present', r.code === 0 && r.out.includes(`present:  ${ALL}`), r.out);

  const SHARED = kitProject(path.join(TMP, 'shared'));
  r = install(SHARED, ['--shared']);
  t('--shared keeps ${CLAUDE_PROJECT_DIR} in the committed file', r.code === 0 && cmdsOf(settingsOf(SHARED, 'settings.json'), 'PreToolUse')[0] === 'node "${CLAUDE_PROJECT_DIR}/project-os/guards/Path-guard.mjs"', r.out);
  r = install(SHARED);
  if (WIN) {
    t('Windows: a personal run after --shared adds nothing', r.code === 0 && r.out.includes('nothing to change') && !fs.existsSync(path.join(SHARED, '.claude', 'settings.local.json')), r.out);
  } else {
    t('macOS and Linux: a personal run after --shared adds only the guards', r.code === 0 && Object.keys(settingsOf(SHARED).hooks).join(', ') === 'PreToolUse', r.out);
  }
  const SHARED_L = kitProject(path.join(TMP, 'shared linux'));
  install(SHARED_L, ['--shared'], { linux: true });
  r = install(SHARED_L, ['--dry'], { linux: true });
  t('Linux: after --shared a plain --dry still wants the guards in the personal file', r.code === 0 && r.out.includes('will add: PreToolUse'), r.out);
  r = install(SHARED_L, ['--dry', '--shared'], { linux: true });
  t('Linux: --dry --shared proves the shared install', r.code === 0 && r.out.includes(`present:  ${ALL}`), r.out);

  const FOREIGN = kitProject(path.join(TMP, 'foreign hook'));
  writeSettings(FOREIGN, { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node their-own-hook.mjs' }] }] } });
  r = install(FOREIGN);
  const pre = cmdsOf(settingsOf(FOREIGN), 'PreToolUse');
  t('a hook the project already has is kept, and ours runs beside it', r.code === 0 && r.out.includes('combined: PreToolUse') && pre[0] === 'node their-own-hook.mjs' && pre.length === 3, pre.join('\n'));

  const BAD = kitProject(path.join(TMP, 'bad json'));
  writeSettings(BAD, '{ not json');
  r = install(BAD);
  t('invalid JSON in the settings is refused and the file is left untouched', r.code === 1 && fs.readFileSync(path.join(BAD, '.claude', 'settings.local.json'), 'utf8') === '{ not json' && !fs.existsSync(path.join(BAD, '.claude', 'settings.local.json.backup')), r.out);

  const DOLLAR = kitProject(path.join(TMP, 'd dollar $x'));
  r = install(DOLLAR);
  t('a project path holding a $ is refused before anything is written', r.code === 1 && !fs.existsSync(path.join(DOLLAR, '.claude')), r.out);

  const TYPO = kitProject(path.join(TMP, 'typo'));
  r = install(TYPO, ['--dry-run', '--shared']);
  t('[R] an unknown option is refused and nothing is written', r.code === 1 && r.out.includes('unknown option --dry-run') && !fs.existsSync(path.join(TYPO, '.claude')), r.out);

  const QUOTE = kitProject(path.join(TMP, 'quote'));
  const q = JSON.parse(fs.readFileSync(path.join(QUOTE, 'project-os', 'Hooks-settings.json'), 'utf8'));
  q.hooks.UserPromptSubmit[0].hooks[0].command = q.hooks.UserPromptSubmit[0].hooks[0].command.replace('Change only what was asked', 'Change only "what was asked"');
  fs.writeFileSync(path.join(QUOTE, 'project-os', 'Hooks-settings.json'), JSON.stringify(q, null, 2));
  r = install(QUOTE, ['--dry']);
  t('[R] a double quote in a reminder text is warned about, and the run goes on', r.code === 0 && r.out.includes('warning:  the UserPromptSubmit reminder text'), r.out);
  const LONG = kitProject(path.join(TMP, 'long reminder'));
  const l = JSON.parse(fs.readFileSync(path.join(LONG, 'project-os', 'Hooks-settings.json'), 'utf8'));
  l.hooks.UserPromptSubmit[0].hooks[0].command = l.hooks.UserPromptSubmit[0].hooks[0].command.replace('Change only what was asked', 'Change only what was asked ' + 'and nothing beside it, '.repeat(6));
  fs.writeFileSync(path.join(LONG, 'project-os', 'Hooks-settings.json'), JSON.stringify(l, null, 2));
  r = install(LONG, ['--dry']);
  t('[R] a reminder text over 600 characters is warned about, and the run goes on', r.code === 0 && /warning:  the UserPromptSubmit reminder text is \d+ characters/.test(r.out), r.out);
  r = install(FRESH, ['--dry']);
  t('the shipped reminder texts give no warning', !r.out.includes('warning:'), r.out);
  t('the shipped reminder lengths are printed', /reminder: UserPromptSubmit text is \d+ characters/.test(r.out) && /reminder: SessionStart text is \d+ characters/.test(r.out), r.out);

  const HOME_ON = path.join(TMP, 'home with plugin');
  fs.mkdirSync(path.join(HOME_ON, '.claude', 'skills', 'projectos', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(HOME_ON, '.claude', 'skills', 'projectos', 'hooks', 'dispatch.mjs'), '// stand-in for the plugin\n');
  r = install(kitProject(path.join(TMP, 'under plugin')), ['--dry'], { home: HOME_ON });
  t('[R] with the plugin folder on this computer, the dry run says the plugin covers the project, never "NOT wired"', r.code === 0 && r.out.includes('plugin:   found at') && r.out.includes('covers this project') && !r.out.includes('NOT wired yet') && !r.out.includes('is not installed'), r.out);
  const HOME_OFF = path.join(TMP, 'home without plugin');
  fs.mkdirSync(HOME_OFF, { recursive: true });
  r = install(kitProject(path.join(TMP, 'no plugin')), ['--dry'], { home: HOME_OFF });
  t('without the plugin folder the dry run still says NOT wired yet', r.code === 0 && r.out.includes('NOT wired yet') && !r.out.includes('plugin:'), r.out);
} finally {
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

if (failures > 0) {
  console.error(`Plugin-and-installer-tests.mjs: ${failures} of ${ran} cases FAILED`);
  process.exit(1);
}
console.log(`Plugin-and-installer-tests.mjs: all ${ran} cases passed`);
