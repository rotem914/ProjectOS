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
import { spawnSync } from 'node:child_process';
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

function dispatch(mode, payload, session, { linux = false } = {}) {
  fs.writeFileSync(LOG, '');
  const r = spawnSync(process.execPath, [...(linux ? LINUX : []), DISPATCH, mode], {
    input: JSON.stringify(payload || {}),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: session || '', PROJECTOS_PLUGIN_LOG: LOG },
  });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), log: fs.readFileSync(LOG, 'utf8') };
}
function install(dir, flags = [], { linux = false } = {}) {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
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

  // [R] T9: the folder the session was opened in decides.
  const PARENT = path.join(TMP, 'parent');
  const A = kitProject(path.join(PARENT, 'proj a'));
  const B = kitProject(path.join(PARENT, 'proj b'));
  const writeB = { tool_name: 'Write', tool_input: { file_path: fwd(path.join(B, 'notes.md')), content: 'x' } };
  r = dispatch('pretool', pay(A, writeB), PARENT);
  t('[R] a session on a parent folder stays inert after its shell moves into a project', r.code === 0 && r.log.includes('no marker, inert'), r.log);
  r = dispatch('pretool', pay(A, writeB), A);
  t('a session opened in one project is blocked from writing into its sibling', blocks(r, 'path-guard'), r.err);

  // Installed wiring: the plugin stands down for what the settings carry.
  const INST = kitProject(path.join(TMP, 'installed'));
  install(INST);
  r = dispatch('prompt', {}, INST);
  t('installed: the plugin prints no second copy of the standing rules', r.code === 0 && r.out === '', r.out);
  r = dispatch('session', {}, INST);
  t('installed: session start prints only the active line', r.code === 0 && count(r.out, 'PROJECT RULES') === 0 && r.out.includes('hooks active for'), r.out);
  r = dispatch('pretool', pay(INST, P.rm), INST);
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
  r = dispatch('pretool', pay(PART, P.writeOut), PART);
  t('[R] Path-guard wired for Write|Edit: the plugin stands down for a Write', standsDown(r, 1), r.log);
  r = dispatch('pretool', pay(PART, P.psOut), PART);
  t('[R] Path-guard wired for Write|Edit: a PowerShell write outside is still blocked', blocks(r, 'path-guard'), r.err || r.log);
  r = dispatch('pretool', pay(PART, P.rm), PART);
  t('[R] a pattern matcher is not taken as proof: rm -rf src is blocked', blocks(r, 'destructive-guard'), r.err || r.log);

  // [R] T17: an installed reminder in an older wording stands in for ours.
  const OLD = kitProject(path.join(TMP, 'old wording'));
  writeSettings(OLD, { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: `node -e "console.log('STANDING RULES: 1) an older wording.')"` }] }] } });
  r = dispatch('prompt', {}, OLD);
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

  // A git worktree reads the main checkout's personal settings on macOS and Linux.
  const MAIN = kitProject(path.join(TMP, 'main checkout'));
  fs.mkdirSync(path.join(MAIN, '.git', 'worktrees', 'w'), { recursive: true });
  fs.writeFileSync(path.join(MAIN, '.git', 'worktrees', 'w', 'commondir'), '../..\n');
  install(MAIN);
  const WT = kitProject(path.join(TMP, 'worktree w'));
  fs.writeFileSync(path.join(WT, '.git'), `gitdir: ${fwd(MAIN)}/.git/worktrees/w\n`);
  r = dispatch('prompt', {}, WT, { linux: true });
  t('Linux: a worktree follows its .git file to the main checkout, whose settings carry the reminders', r.code === 0 && r.out === '', r.out);

  // ---- the installer -------------------------------------------------------
  const FRESH = kitProject(path.join(TMP, 'fresh'));
  r = install(FRESH);
  let s = settingsOf(FRESH);
  t('fresh install adds all three events', r.code === 0 && r.out.includes(`added:    ${ALL}`), r.out);
  t('fresh install names the guards by this project\'s own path', cmdsOf(s, 'PreToolUse').join('|') === `${guardCmd(FRESH, 'Path-guard.mjs')}|${guardCmd(FRESH, 'Destructive-guard.mjs')}`, cmdsOf(s, 'PreToolUse').join('\n'));
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
  r = install(FRESH, ['--dry']);
  t('the shipped reminder texts give no warning', !r.out.includes('warning:'), r.out);
} finally {
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

if (failures > 0) {
  console.error(`Plugin-and-installer-tests.mjs: ${failures} of ${ran} cases FAILED`);
  process.exit(1);
}
console.log(`Plugin-and-installer-tests.mjs: all ${ran} cases passed`);
