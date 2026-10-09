// Tests for the band above the message box (hooks/Project-band.tsx).
//
// Nothing here touches a real repository or the network. Each test builds a
// small world (a folder, what git would answer in it, a CLAUDE.md, the plugin
// copy of the kit) and answers the engine's calls from it, beneath the mod.
// Every test that draws runs once per surface, terminal and desktop, so the
// row is proven not to depend on one of them.
//
// One thing the test kit cannot show: where the keyboard's ring stands. A
// mod's `$.ui.focus` has nothing beneath it in the kit, so the call fails
// there and the band carries on without it, which is itself tested. The ring
// was checked in a real terminal instead; the tests here hold the part that
// is drawn: Cancel comes first and asks for the ring.

import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

const PLUGIN = 'project-os'
const SURFACES = ['terminal', 'desktop'] as const

// The cells the terminal keeps at the end of the band for its collapse mark.
const MARK = 4
// The cells the desktop row gives the drawing before the name, and its gap.
const MARK_CELLS = 4

const KIT_HEADINGS = [
  '# Project rules',
  '',
  '### `Go code review`',
  'Start a code review.',
  '### `Go commit` (short form: `Go c`)',
  'Commit everything.',
  '### `Go audit`',
  '### `Go update kit`',
  '### `Go backup`',
  '### `Go commit and backup`',
  '### `Backlog`',
  '',
].join('\n')

const LOCAL_HEAD = 'a'.repeat(40)
const ONLINE_HEAD = 'b'.repeat(40)

// What the engine itself draws in the band: nothing of its own.
const ENGINE_DRAWING: RenderElement = { type: 'engine', ref: 0 }

type Surface = (typeof SURFACES)[number]

type GitCall = {
  args: string[]
  cwd: string
  env: Record<string, string>
  timeoutMs: number | undefined
}

type World = {
  /** The environment the mod reads. */
  env: Record<string, string>
  /** The folder the session was opened in. */
  folder: string
  /** The git top folder; null outside a repository. */
  top: string | null
  /** The folder git keeps its own files in, as git names it from `folder`. */
  gitDir: string
  /** The branch checked out; null for a detached HEAD. */
  branch: string | null
  /** The upstream's short name; null when the branch was never put online. */
  upstream: string | null
  /** Commits ahead of the upstream; null when the upstream is gone. */
  ahead: number | null
  /** Commits the online copy has that this branch lacks. */
  behind: number
  /** How many files have uncommitted changes. */
  changed: number
  remote: string
  remoteRef: string
  pushUrl: string
  /** The address of the project's remote named origin; null when it has none. */
  origin: string | null
  /** Text files by path, for `$.fs.read`. */
  files: Record<string, string>
  /** Other paths that exist: a hook file, for one. */
  present: string[]
  /** The hooks folder the project names in its git settings; null for none. */
  hooksPath: string | null
  /** Git subcommands that answer with an error. */
  broken: string[]
  /** Git subcommands that never answer: the engine gives up on them. */
  silent: string[]
  /** How long a git subcommand takes on the test's clock, in milliseconds. */
  slow: Record<string, number>
  /** True when the list of changed files is longer than the engine reads. */
  isStatusCut: boolean
  plugin: {
    dir: string
    isClone: boolean
    head: string
    onlineHead: string
    /** Whether this copy already holds the online commit. */
    isHeld: boolean
    /** Whether the online commit has been fetched into this copy's history. */
    isFetched: boolean
    /** The commits this copy is missing, as git counts them after a fetch. */
    behind: number
    origin: string
  }
  push: { code: number; err: string; delayMs: number }
  pull: { code: number; out: string; err: string; delayMs: number }
  /** What the store holds before the session starts. */
  stored: Record<string, unknown>
  isPromptRefused: boolean
  /** How full the conversation is, in percent; null before its first answer. */
  fill: number | null
  /** What the project's listing of heavy files prints. */
  heavyOut: string
  /** Whether the project's local address answers, and every address asked. */
  isServerUp: boolean
  fetched: string[]
  /** Every slash command the mod ran. */
  commands: string[]
  /** The slash commands this Claude Code offers. */
  offered: string[]
  /** A tree some other mod draws in the band, beneath this one. */
  beneath: RenderElement | null
  /** How long the drawing beneath takes on the test's clock, in milliseconds. */
  slowDraw: number
  /** How many of the next writes of a stored value Claude Code refuses. */
  refusals: number
  // What happened.
  git: GitCall[]
  toasts: string[]
  statuses: (string | undefined)[]
  prompts: { text: string; origin: unknown }[]
  logs: string[]
  /**
   * The ZIPs and other files in the project's backups folder, each with its
   * age in days as the session starts; null when the folder is not there.
   */
  backups: { name: string; daysOld: number }[] | null
  /** Every folder the mod listed. It lists the backups folder, and no other. */
  listed: string[]
  /** Every pane the mod opened. It should open none. */
  opened: string[]
}

type Kit = { world: World; clock: MockClock }

let startOfTime = Date.UTC(2026, 9, 3, 9, 0, 0)

// A path in one spelling: forward slashes, lower case, no trailing slash, and
// every "go up one folder" already taken.
function plain(path: string): string {
  const parts: string[] = []

  for (const part of path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase().split('/')) {
    if (part === '..' && parts.length > 0 && parts.at(-1) !== '..' && parts.at(-1) !== '') {
      parts.pop()
    } else if (part !== '.') {
      parts.push(part)
    }
  }

  return parts.join('/')
}

// The engine resolves a path for the computer it runs on before a test sees
// it: on Windows a Mac path gains a drive letter, and on a Mac a Windows path
// is read as a name under the working folder. So a file of the world is
// matched by the end of the path, without the drive and the leading slash,
// and the worlds below, Windows and Mac alike, work on either computer.
function isAt(asked: string, file: string): boolean {
  const tail = (path: string) => plain(path).replace(/^[a-z]:/, '').replace(/^\/+/, '')

  return `/${tail(asked)}`.endsWith(`/${tail(file)}`)
}

function worldOf(changes: Partial<World> = {}): World {
  return {
    env: {
      CLAUDE_CONFIG_DIR: 'C:\\ClaudeConfigs\\Darrow',
      USERPROFILE: 'C:\\Users\\Dana',
    },
    folder: 'D:\\Work\\Site',
    top: 'D:/Work/Site',
    gitDir: '.git',
    branch: 'main',
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    changed: 0,
    remote: 'origin',
    remoteRef: 'refs/heads/main',
    pushUrl: 'https://github.com/example/site.git',
    origin: 'https://github.com/example/site-web.git',
    files: { 'D:/Work/Site/CLAUDE.md': KIT_HEADINGS },
    present: [],
    hooksPath: null,
    broken: [],
    silent: [],
    slow: {},
    isStatusCut: false,
    plugin: {
      dir: 'C:\\ClaudeConfigs\\Darrow\\skills\\projectos',
      isClone: true,
      head: LOCAL_HEAD,
      onlineHead: LOCAL_HEAD,
      isHeld: false,
      isFetched: false,
      behind: 1,
      origin: 'https://github.com/example/kit',
    },
    push: { code: 0, err: '', delayMs: 0 },
    pull: { code: 0, out: 'Updating aaaaaaa..bbbbbbb\nFast-forward\n', err: '', delayMs: 0 },
    stored: {},
    isPromptRefused: false,
    fill: null,
    heavyOut: '',
    isServerUp: false,
    fetched: [],
    commands: [],
    offered: ['compact'],
    beneath: null,
    slowDraw: 0,
    refusals: 0,
    git: [],
    toasts: [],
    statuses: [],
    prompts: [],
    logs: [],
    backups: null,
    listed: [],
    opened: [],
    ...changes,
  }
}

// One of each kind of line git writes for a changed file: edited, renamed,
// in conflict, and new.
function statusText(world: World): string {
  const kinds = [
    (n: number) => `1 .M N... 100644 100644 100644 ${'c'.repeat(40)} ${'c'.repeat(40)} src/page ${n}.txt`,
    (n: number) => `2 R. N... 100644 100644 100644 ${'d'.repeat(40)} ${'d'.repeat(40)} R100 new ${n}.txt\told ${n}.txt`,
    (n: number) => `u UU N... 100644 100644 100644 100644 ${'e'.repeat(40)} ${'e'.repeat(40)} ${'e'.repeat(40)} clash ${n}.txt`,
    (n: number) => `? notes/new ${n}.txt`,
  ]
  const lines: string[] = []

  for (let n = 0; n < world.changed; n += 1) {
    lines.push((kinds[n % kinds.length] ?? kinds[0]!)(n))
  }

  return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}

// What git's listing of branches says about the branch checked out: the
// remote its upstream lives on, the upstream's name there, and how the two
// stand, in git's own words.
function branchLine(world: World): string {
  if (world.upstream === null) {
    return '\t\t'
  }

  const stand =
    world.ahead === null
      ? 'gone'
      : [
          ...(world.ahead > 0 ? [`ahead ${world.ahead}`] : []),
          ...(world.behind > 0 ? [`behind ${world.behind}`] : []),
        ].join(', ')

  return `${world.remote}\t${world.remoteRef}\t${stand}`
}

function answer(code: number, out: string, err = '') {
  return {
    value: {
      exitCode: code,
      stdout: out,
      stderr: err,
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }
}

// Stands in for git: answers each command the way git would in this world.
async function gitOf(
  world: World,
  clock: MockClock,
  argv: readonly string[],
  init: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } | undefined,
) {
  const args = argv.slice(1)
  const command = args.find(arg => !arg.startsWith('-')) ?? ''
  const cwd = init?.cwd ?? ''
  const isInPlugin = plain(cwd) === plain(world.plugin.dir)

  world.git.push({ args: [...args], cwd, env: { ...(init?.env ?? {}) }, timeoutMs: init?.timeoutMs })

  if (argv[0] !== 'git') {
    return answer(127, '', 'not git')
  }

  if (world.silent.includes(command)) {
    return {
      deny: `${PLUGIN}: $.process.run(git) aborted: still running after ${init?.timeoutMs ?? 30000}ms`,
    }
  }

  const wait = world.slow[command] ?? 0

  if (wait > 0) {
    await clock.sleep(wait)
  }

  if (world.broken.includes(command)) {
    return answer(128, '', `fatal: ${command} could not be read`)
  }

  switch (command) {
    case 'rev-parse':
      if (args.includes('--show-toplevel')) {
        return world.top === null
          ? answer(128, '', 'fatal: not a git repository (or any of the parent directories): .git')
          : answer(0, `${world.top}\n${world.gitDir}\n`)
      }

      return answer(0, `${isInPlugin ? world.plugin.head : '1'.repeat(40)}\n`)
    case 'symbolic-ref':
      return world.branch === null ? answer(1, '') : answer(0, `${world.branch}\n`)
    case 'for-each-ref':
      return answer(0, `${branchLine(world)}\n`)
    case 'config':
      // The last line is Claude Code's own: it switches hooks off for the
      // git a plugin runs, with a setting given on the command line.
      return answer(
        0,
        `${world.hooksPath === null ? '' : `local\t${world.hooksPath}\n`}command\t\\\\.\\NUL\n`,
      )
    case 'status': {
      const status = answer(0, statusText(world))

      return { value: { ...status.value, isStdoutTruncated: world.isStatusCut } }
    }
    case 'remote':
      if (args.includes('--push')) {
        return answer(0, `${world.pushUrl}\n`)
      }

      if (isInPlugin) {
        return answer(0, `${world.plugin.origin}\n`)
      }

      // The project's own origin: where the band reads the project's name.
      return world.origin === null
        ? answer(2, '', "error: No such remote 'origin'")
        : answer(0, `${world.origin}\n`)
    case 'ls-remote':
      return answer(0, `${world.plugin.onlineHead}\trefs/heads/main\n`)
    case 'merge-base':
      return answer(world.plugin.isHeld ? 0 : 1, '')
    case 'cat-file':
      return answer(world.plugin.isFetched ? 0 : 1, '')
    case 'fetch':
      world.plugin.isFetched = true

      return answer(0, '')
    case 'rev-list':
      return answer(0, `${world.plugin.behind}\n`)
    case 'push':
      if (world.push.delayMs > 0) {
        await clock.sleep(world.push.delayMs)
      }

      if (world.push.code === 0) {
        world.ahead = 0
      }

      return answer(world.push.code, '', world.push.err)
    case 'pull':
      if (world.pull.delayMs > 0) {
        await clock.sleep(world.pull.delayMs)
      }

      if (world.pull.code === 0) {
        world.plugin.head = world.plugin.onlineHead
      }

      return answer(world.pull.code, world.pull.out, world.pull.err)
    default:
      return answer(1, '', `git: '${command}' is not a git command`)
  }
}

// Answers, beneath the mod, everything the mod asks of the engine.
function install(on: On, changes: Partial<World> = {}): Kit {
  const world = worldOf(changes)

  startOfTime += 3_600_000

  const startedAt = startOfTime

  const clock = mock.clock(on, { now: startOfTime })

  mock.env(on, world.env)
  mock.store(on, world.stored)

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  on('session.root', () => ({ value: world.folder }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('process.run', (_, e) =>
    e.argv[0] === 'node' ? answer(0, world.heavyOut) : gitOf(world, clock, e.argv, e.init),
  )
  on('http.fetch', (_, e) => {
    world.fetched.push(e.url)

    return world.isServerUp
      ? { value: { status: 404, ok: false, headers: {}, text: '' } }
      : { deny: 'connect ECONNREFUSED 127.0.0.1:4321' }
  })
  on('fs.read', (_, e) => {
    const found = Object.entries(world.files).find(([path]) => isAt(e.path, path))

    return found === undefined ? { deny: `ENOENT: no such file, open '${e.path}'` } : { value: found[1] }
  })
  on('fs.exists', (_, e) => {
    if (isAt(e.path, `${world.plugin.dir}/.git`)) {
      return { value: world.plugin.isClone }
    }

    if (world.backups !== null && isAt(e.path, `${world.top}/backups`)) {
      return { value: true }
    }

    return { value: [...Object.keys(world.files), ...world.present].some(path => isAt(e.path, path)) }
  })
  on('fs.list', (_, e) => {
    world.listed.push(e.path ?? '')

    if (world.backups !== null && isAt(e.path ?? '', `${world.top}/backups`)) {
      return {
        value: world.backups.map(file => ({
          name: file.name,
          kind: 'file' as const,
          size: 1_000,
          // A minute older than its count of days, so the count is whole.
          mtimeMs: startedAt - file.daysOld * 24 * 60 * 60_000 - 60_000,
          isLink: false,
        })),
      }
    }

    return { deny: `ENOENT: no such directory, scandir '${e.path ?? ''}'` }
  })
  on('prompt.submit', (_, e) => {
    // A hook that throws is skipped, and nothing beneath it answers: that is
    // how a prompt the engine cannot take reaches the mod, as a rejection.
    if (world.isPromptRefused) {
      throw new Error('the session takes no prompts')
    }

    world.prompts.push({ text: e.text, origin: e.origin })

    return { text: e.text }
  })
  on('session.usage', () => ({
    value: {
      startedAt: startOfTime,
      context: { window: 200_000, ...(world.fill === null ? {} : { percent: world.fill }) },
      rateLimits: [],
      cost: { usd: 0 },
    },
  }))
  on('command.list', () => ({
    value: world.offered.map(name => ({ name, description: '', source: 'builtin' as const })),
  }))
  on('command.run', (_, e) => {
    world.commands.push(e.command)

    return {}
  })
  on('ui.toast', (_, e) => {
    world.toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.status', (_, e) => {
    world.statuses.push(e.text)

    return { value: undefined }
  })
  on('ui.log', (_, e) => {
    world.logs.push(e.text)

    return { value: undefined }
  })
  on('ui.open', (_, e) => {
    world.opened.push(e.id)

    return { value: { isPlaced: true as const } }
  })
  // Claude Code refuses a stored value for the moment in which a row is being
  // drawn. A test asks for that refusal by count.
  on('state.set', (_, e, next) => {
    if (world.refusals > 0) {
      world.refusals -= 1

      return { deny: 'state.set: denied: it was made while ui.render is being dispatched' }
    }

    return next(e)
  })
  on('ui.render', async () => {
    if (world.slowDraw > 0) {
      await clock.sleep(world.slowDraw)
    }

    return world.beneath ?? ENGINE_DRAWING
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))

  return { world, clock }
}

// The session starts. Nobody has looked at it yet.
async function open($: Engine, { world, clock }: Kit): Promise<void> {
  await $.session.start({ cwd: world.folder, surface: 'terminal', isInteractive: true })
  await clock.settle()
}

function bandOn($: Engine, surface: Surface, columns = 160, hasSurvey = false) {
  return $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'AbovePrompt',
    props: {
      hasSurvey,
      isWorking: false,
      maxRows: 12,
      bodyColumns: columns,
      scroll: { offset: 0, bodyRows: 12 },
      view: {},
    },
  })
}

// The session starts and the owner looks at the window: the row is asked for
// once, which is what sends the mod to git.
async function start($: Engine, kit: Kit): Promise<void> {
  await open($, kit)

  const glance = await bandOn($, 'terminal')

  await kit.clock.settle()
  await glance.unmount()
}

async function endTurn($: Engine, { clock }: Kit): Promise<void> {
  await $.turn.complete({
    answer: 'Done.',
    durationMs: 1200,
    isAborted: false,
    turnId: 'turn-1',
    reason: 'answer',
  })
  await clock.settle()
}

type Drawing = Awaited<ReturnType<typeof bandOn>>

// What the row says, read the same on both surfaces: where the desktop draws
// its check mark in place of "All committed", the words are put back where
// the terminal has them, at the head of the waiting words.
async function wordsOn(ui: Drawing): Promise<string> {
  const texts = await ui.findAll({ type: 'Text' })
  const said = texts.map(text => text.text)
  const hasCheck = (await ui.findAll({ type: 'Svg' })).some(svg => svg.props.alt === 'All committed')

  if (hasCheck) {
    const last = texts.length - 1

    if (last >= 0 && texts[last]?.props.wrap === 'truncate-end') {
      said[last] = `All committed \u00b7 ${said[last]}`
    } else {
      said.push('All committed')
    }
  }

  return said.join(' | ')
}

async function buttonsOn(ui: Drawing): Promise<string[]> {
  return (await ui.findAll({ type: 'Button' })).map(button => String(button.props.label))
}

// A yes pressed right after its question is taken for a double press, so a
// test waits a moment first, as a person reading the question does.
async function answerYes(kit: Kit, ui: Drawing, key: string): Promise<void> {
  await kit.clock.advance(1_000)
  await ui.press({ key })
}

function gitRuns(world: World, command: string): GitCall[] {
  return world.git.filter(call => call.args.find(arg => !arg.startsWith('-')) === command)
}

// The band's width that leaves `usable` cells for the row: the terminal keeps
// a few cells at the end for its own mark, the desktop a few at the start
// for the drawing before the name.
function width(surface: Surface, usable: number): number {
  return usable + (surface === 'terminal' ? MARK : MARK_CELLS)
}

// One test per surface, with the surface in its name.
function onEachSurface(
  name: string,
  body: ($: Engine, on: On, surface: Surface) => Promise<void>,
): void {
  for (const surface of SURFACES) {
    test(`${name} (${surface})`, ($, on) => body($, on, surface))
  }
}

// The label is the project's name, in plain text with no color behind it, in
// every window. The row first named the window's owner there, Personal or a
// client; the owner asked for the repository's name instead (2026-10-03).
describe('the label', () => {
  onEachSurface('names the repository in plain text', async ($, on, surface) => {
    const kit = install(on)

    await start($, kit)

    const ui = await bandOn($, surface)
    const label = await ui.find({ type: 'Text', text: 'site-web' })

    expect(label?.text).toBe('site-web')
    expect(label?.props.bold).toBe(true)
    expect(label?.props.backgroundColor).toBeUndefined()
    expect(label?.props.color).toBe('#B3B4BC')
    expect(await wordsOn(ui)).toBe('site-web | All committed')
    await ui.unmount()
  })

  // Whose window it is changes nothing in the row. A window opened for a
  // client, a personal one, and one whose profile is the home folder itself
  // all name the project, and none of them lists a folder to do it.
  const WINDOWS: [string, Record<string, string>][] = [
    ['a client', { CLAUDE_CONFIG_DIR: 'C:\\ClaudeConfigs\\Darrow', USERPROFILE: 'C:\\Users\\Dana' }],
    ['no profile', { USERPROFILE: 'C:\\Users\\Dana' }],
    ['the home folder', { CLAUDE_CONFIG_DIR: 'C:\\Users\\Dana\\.claude', USERPROFILE: 'C:\\Users\\Dana' }],
  ]

  for (const [who, env] of WINDOWS) {
    test(`is the same in a window of ${who}`, async ($, on) => {
      const kit = install(on, { env })

      await start($, kit)

      const ui = await bandOn($, 'desktop')

      expect(await wordsOn(ui)).toBe('site-web | All committed')
      expect(kit.world.listed).toEqual([])
      await ui.unmount()
    })
  }

  const ADDRESSES: [string, string][] = [
    ['https://github.com/rotem914/RotemE.git', 'RotemE'],
    ['https://github.com/rotem914/RotemE', 'RotemE'],
    ['https://github.com/rotem914/RotemE.git/', 'RotemE'],
    ['git@github.com:rotem914/RotemE.git', 'RotemE'],
    ['ssh://git@github.com/rotem914/Rotem-E.git', 'Rotem-E'],
    ['D:\\Repos\\Bare.git', 'Bare'],
  ]

  for (const [address, name] of ADDRESSES) {
    test(`reads the name from the online address: ${address}`, async ($, on) => {
      const kit = install(on, { origin: address })

      await start($, kit)

      const ui = await bandOn($, 'desktop')

      expect(await wordsOn(ui)).toBe(`${name} | All committed`)
      await ui.unmount()
    })
  }

  onEachSurface('a sign-in token in the address never reaches the row', async ($, on, surface) => {
    const kit = install(on, { origin: 'https://dana:ghp_secret123@github.com/example/site.git' })

    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await wordsOn(ui)).toBe('site | All committed')
    await ui.unmount()
  })

  onEachSurface('a repository with No online copy is named by its top folder', async ($, on, surface) => {
    const kit = install(on, { origin: null, upstream: null })

    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await wordsOn(ui)).toBe('Site | All committed \u{b7} No online copy yet')
    await ui.unmount()
  })

  onEachSurface('outside a repository it is the folder\'s name, alone', async ($, on, surface) => {
    const kit = install(on, { top: null, folder: 'D:\\Work\\Notes' })

    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await wordsOn(ui)).toBe('Notes')
    expect(await buttonsOn(ui)).toEqual([])
    await ui.unmount()
  })

  test('asks git for the name once, however many passes follow', async ($, on) => {
    const kit = install(on)
    const asksForName = () =>
      gitRuns(kit.world, 'remote').filter(
        call => !call.args.includes('--push') && plain(call.cwd) === plain('D:/Work/Site'),
      )

    await start($, kit)

    const ui = await bandOn($, 'terminal')

    await endTurn($, kit)
    await kit.clock.advance(3 * 60_000)
    expect(asksForName()).toHaveLength(1)
    expect(asksForName()[0]?.args).toEqual(['remote', 'get-url', 'origin'])
    await ui.unmount()
  })

  test('a name longer than the label is cut', async ($, on) => {
    const kit = install(on, {
      origin: 'https://github.com/example/a-very-long-repository-name-indeed.git',
    })

    await start($, kit)

    const ui = await bandOn($, 'desktop')

    expect(await wordsOn(ui)).toBe('a-very-long-repository-\u{2026} | All committed')
    await ui.unmount()
  })

  onEachSurface('a push waiting for its OK keeps the name in front', async ($, on, surface) => {
    const kit = install(on, { ahead: 2 })

    await start($, kit)

    const ui = await bandOn($, surface)

    await ui.press({ key: 'push' })
    await kit.clock.settle()

    const label = await ui.find({ type: 'Text', text: 'site-web' })

    expect(label?.props.backgroundColor).toBeUndefined()
    expect(await wordsOn(ui)).toBe('site-web | All committed')
    expect(await buttonsOn(ui)).toEqual(['Approve', '\u22ee'])
    await ui.unmount()
  })
})

describe('what is waiting', () => {
  onEachSurface('a folder with no git shows the label and nothing else', async ($, on, surface) => {
    const kit = install(on, { top: null })

    // An update is ready for the plugin copy, and the folder has a CLAUDE.md
    // with every shortcut: outside a repository neither is drawn.
    kit.world.plugin.onlineHead = ONLINE_HEAD
    kit.world.files['D:/Work/Site/CLAUDE.md'] = KIT_HEADINGS
    await start($, kit)

    const ui = await bandOn($, surface)

    // Outside a repository the name is the folder's own.
    expect(await wordsOn(ui)).toBe('Site')
    expect(await buttonsOn(ui)).toEqual([])
    expect(gitRuns(kit.world, 'status')).toHaveLength(0)
    expect(gitRuns(kit.world, 'ls-remote')).toHaveLength(0)
    await ui.unmount()
  })

  onEachSurface('counts uncommitted files and commits to push', async ($, on, surface) => {
    const kit = install(on, { changed: 3, ahead: 2 })

    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await wordsOn(ui)).toBe('site-web')
    expect(await buttonsOn(ui)).toEqual(['Go commit \u00b7 3', 'Push \u00b7 2', '\u22ee'])
    await ui.unmount()
  })

  onEachSurface('says one file and one commit in the singular', async ($, on, surface) => {
    const kit = install(on, { changed: 1, ahead: 1 })

    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await buttonsOn(ui)).toContain('Push \u00b7 1')
    await ui.unmount()
  })

  onEachSurface('says All committed and nothing about pushing when nothing waits', async ($, on, surface) => {
    const kit = install(on, { changed: 0, ahead: 0 })

    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await wordsOn(ui)).toBe('site-web | All committed')
    expect(await buttonsOn(ui)).toEqual(['\u22ee'])
    await ui.unmount()
  })

  onEachSurface('counts what waits to be pushed on a branch that is also behind', async ($, on, surface) => {
    const kit = install(on, { ahead: 2, behind: 5 })

    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await wordsOn(ui)).toBe('site-web | All committed')

    // Only behind: nothing waits to be pushed.
    kit.world.ahead = 0
    await endTurn($, kit)
    expect(await wordsOn(ui)).toBe('site-web | All committed')
    expect(await buttonsOn(ui)).not.toContain('Push')
    await ui.unmount()
  })

  onEachSurface('says No online copy yet for a branch with no upstream', async ($, on, surface) => {
    const kit = install(on, { changed: 2, upstream: null, ahead: null })

    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await wordsOn(ui)).toBe('site-web | No online copy yet')
    expect(await buttonsOn(ui)).not.toContain('Push')
    await ui.unmount()
  })

  onEachSurface('treats a branch that follows a local branch as not online', async ($, on, surface) => {
    const kit = install(on, { upstream: 'main', remote: '.', ahead: 4 })

    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await wordsOn(ui)).toContain('No online copy yet')
    expect(await wordsOn(ui)).not.toContain('to push')
    expect(await buttonsOn(ui)).not.toContain('Push')
    await ui.unmount()
  })

  onEachSurface('shows nothing about pushing when the upstream is gone or HEAD is detached', async ($, on, surface) => {
    const kit = install(on, { changed: 1, ahead: null })

    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await wordsOn(ui)).toBe('site-web')

    kit.world.branch = null
    await endTurn($, kit)
    expect(await wordsOn(ui)).toBe('site-web')
    expect(await buttonsOn(ui)).not.toContain('Push')
    await ui.unmount()
  })

  onEachSurface('a failing git leaves its part empty, never an old number', async ($, on, surface) => {
    const kit = install(on, { changed: 3, ahead: 2 })

    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await buttonsOn(ui)).toContain('Push \u00b7 2')

    // The count of files starts failing. The number it gave before must go;
    // the branch is read apart from the files, so its part stays.
    kit.world.broken = ['status']
    await endTurn($, kit)
    expect(await wordsOn(ui)).toBe('site-web')
    expect(await buttonsOn(ui)).toContain('Push \u00b7 2')

    // The branch cannot be read: files only, and no Push.
    kit.world.broken = ['symbolic-ref']
    await endTurn($, kit)
    expect(await wordsOn(ui)).toBe('site-web')
    expect(await buttonsOn(ui)).not.toContain('Push')

    // The same when its online copy cannot be read.
    kit.world.broken = ['for-each-ref']
    await endTurn($, kit)
    expect(await wordsOn(ui)).toBe('site-web')
    expect(await buttonsOn(ui)).not.toContain('Push')

    // The address cannot be read: the count is real, but no Push without it.
    kit.world.broken = ['remote']
    await endTurn($, kit)
    expect(await wordsOn(ui)).toContain('2 to push')
    expect(await buttonsOn(ui)).not.toContain('Push \u00b7 2')

    // Git cannot even say where the folder is: the name alone, and the same
    // name as before. A git that fails for a moment does not rename the row.
    kit.world.broken = ['rev-parse']
    await endTurn($, kit)
    expect(await wordsOn(ui)).toBe('site-web')
    expect(await buttonsOn(ui)).toEqual([])
    await ui.unmount()
  })

  onEachSurface('a list of files too long to read whole is not counted', async ($, on, surface) => {
    const kit = install(on, { changed: 3, ahead: 2, isStatusCut: true })

    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await wordsOn(ui)).toBe('site-web')
    expect((await ui.find({ key: 'go-commit' }))?.props.variant).toBeUndefined()
    await ui.unmount()
  })

  onEachSurface('a git that never answers leaves its part empty too', async ($, on, surface) => {
    const kit = install(on, { changed: 3, ahead: 2, silent: ['status'] })

    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await wordsOn(ui)).toBe('site-web')

    // Every git run is given a time limit, so a silent one cannot hang a pass.
    expect(kit.world.git.every(call => typeof call.timeoutMs === 'number' && call.timeoutMs <= 120_000)).toBe(true)
    await ui.unmount()
  })

  onEachSurface('the timer and the end of a turn pick up new values', async ($, on, surface) => {
    const kit = install(on, { changed: 0, ahead: 0 })

    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await wordsOn(ui)).toContain('All committed')

    kit.world.changed = 5
    await kit.clock.advance(60_000)
    expect(await buttonsOn(ui)).toContain('Go commit \u00b7 5')

    kit.world.changed = 6
    kit.world.ahead = 1
    await endTurn($, kit)
    expect(await buttonsOn(ui)).toContain('Push \u00b7 1')
    await ui.unmount()
  })

  test('a subagent finishing does not start a pass', async ($, on) => {
    const kit = install(on)

    await start($, kit)

    const before = kit.world.git.length

    await $.turn.complete({
      answer: 'Done.',
      durationMs: 5,
      isAborted: false,
      turnId: 'turn-2',
      reason: 'answer',
      agentId: 'agent-7',
    })
    await kit.clock.settle()
    expect(kit.world.git.length).toBe(before)
  })

  test('the count asks for every untracked file and takes no lock', async ($, on) => {
    const kit = install(on)

    await start($, kit)
    expect(gitRuns(kit.world, 'status')[0]?.args).toEqual([
      '--no-optional-locks',
      'status',
      '--porcelain=v2',
      '--untracked-files=all',
    ])
  })

  test('one look at the row costs one pass, not two', async ($, on) => {
    const kit = install(on)

    await start($, kit)
    expect(gitRuns(kit.world, 'rev-parse').filter(call => call.args.includes('--show-toplevel'))).toHaveLength(1)
    expect(gitRuns(kit.world, 'status')).toHaveLength(1)
  })

  // The desktop app asks for the row while the session is still starting, and
  // a drawing can take a moment when another mod draws beneath this one.
  for (const surface of SURFACES) {
    test(`a look that is still being drawn while the session starts costs one pass too (${surface})`, async ($, on) => {
      const kit = install(on, { changed: 3, ahead: 2, slowDraw: 50 })
      const looking = bandOn($, surface)

      // The row is being drawn. Nothing can be written meanwhile, so the
      // start of the session waits with the label, and no pass runs yet.
      await kit.clock.settle()
      await $.session.start({ cwd: kit.world.folder, surface: null, isInteractive: false })
      await kit.clock.settle()

      // The drawing ends, and later ones take no time.
      kit.world.slowDraw = 0
      await kit.clock.advance(50)

      const ui = await looking

      await kit.clock.settle()
      expect(await wordsOn(ui)).toBe('site-web')
      expect(gitRuns(kit.world, 'rev-parse').filter(call => call.args.includes('--show-toplevel'))).toHaveLength(1)
      expect(gitRuns(kit.world, 'status')).toHaveLength(1)

      // Nothing was refused on the way: every write waited for the drawing.
      expect(kit.world.logs.filter(line => line.includes('failed'))).toEqual(
        kit.world.logs.filter(line => line.includes('moving the keyboard')),
      )
      await ui.unmount()
    })

    test(`a pass sent off while the first look is still being drawn is not sent again (${surface})`, async ($, on) => {
      const kit = install(on, { changed: 3, ahead: 2 })

      await open($, kit)
      kit.world.slowDraw = 50

      const looking = bandOn($, surface)

      // A turn ends while the row is being drawn. Somebody is looking by
      // now, so the turn's end sends a pass off, and the look, as it ends,
      // must not send a second one.
      await kit.clock.settle()
      await endTurn($, kit)
      kit.world.slowDraw = 0
      await kit.clock.advance(50)

      const ui = await looking

      await kit.clock.settle()
      expect(await wordsOn(ui)).toBe('site-web')
      expect(gitRuns(kit.world, 'rev-parse').filter(call => call.args.includes('--show-toplevel'))).toHaveLength(1)
      expect(gitRuns(kit.world, 'status')).toHaveLength(1)
      await ui.unmount()
    })
  }
})

describe('the reply time under the message box', () => {
  test('seconds under a minute, minutes and seconds from there', async ($, on) => {
    const kit = install(on)

    await start($, kit)

    for (const durationMs of [400, 5_000, 12_300, 59_400, 60_000, 156_000, 352_000]) {
      await $.turn.complete({
        answer: 'Done.',
        durationMs,
        isAborted: false,
        turnId: 'turn-1',
        reason: 'answer',
      })
    }

    await kit.clock.settle()
    expect(kit.world.statuses).toEqual(['0s', '5s', '12s', '59s', '1:00m', '2:36m', '5:52m'])
  })

  test('a turn of the main conversation pins its time', async ($, on) => {
    const kit = install(on)

    await start($, kit)
    await $.turn.complete({
      answer: 'Done.',
      durationMs: 156_000,
      isAborted: false,
      turnId: 'turn-1',
      reason: 'answer',
    })
    await kit.clock.settle()
    expect(kit.world.statuses).toEqual(['2:36m'])
  })

  test('a subagent finishing pins nothing', async ($, on) => {
    const kit = install(on)

    await start($, kit)
    await $.turn.complete({
      answer: 'Done.',
      durationMs: 5_000,
      isAborted: false,
      turnId: 'turn-2',
      reason: 'answer',
      agentId: 'agent-7',
    })
    await kit.clock.settle()
    expect(kit.world.statuses).toEqual([])
  })
})

describe('a session nobody looks at', () => {
  test('runs no git: not at the start, not after a turn, not on the timer', async ($, on) => {
    const kit = install(on, { changed: 3, ahead: 2 })

    kit.world.plugin.onlineHead = ONLINE_HEAD
    await open($, kit)
    await endTurn($, kit)
    await kit.clock.advance(5 * 60_000)
    expect(kit.world.git).toEqual([])

    // The first look is what starts it, and the row then fills in.
    const ui = await bandOn($, 'desktop')

    await kit.clock.settle()
    expect(await wordsOn(ui)).toBe('site-web')
    expect(await buttonsOn(ui)).toContain('Update plugin \u00b7 1')
    expect(gitRuns(kit.world, 'status')).toHaveLength(1)

    // From here on the timer and the turns keep it fresh.
    kit.world.changed = 4
    await kit.clock.advance(60_000)
    expect(await buttonsOn(ui)).toContain('Go commit \u00b7 4')
    await ui.unmount()
  })

  test('a row that yields to a survey still counts as a look', async ($, on) => {
    const kit = install(on, { changed: 2 })

    await open($, kit)

    const ui = await bandOn($, 'terminal', 160, true)

    await kit.clock.settle()
    expect(await ui.drawn()).toEqual({ type: 'engine', ref: 0 })
    expect(gitRuns(kit.world, 'status')).toHaveLength(1)
    await ui.unmount()
  })
})

describe('each part as soon as it is known', () => {
  onEachSurface('nothing is drawn until git has named the project, then the name before the counts', async ($, on, surface) => {
    const kit = install(on, {
      changed: 3,
      ahead: 2,
      slow: { 'rev-parse': 5_000, status: 4_000 },
    })

    await open($, kit)

    const ui = await bandOn($, surface)

    await kit.clock.settle()
    // Nothing to say yet: the engine's own drawing stands, not an empty row.
    expect(await ui.drawn()).toEqual({ type: 'engine', ref: 0 })

    // Git answers where the project is, and the name is there at once. The
    // count of files is still under way and holds nothing back.
    await kit.clock.advance(5_000)
    expect(await wordsOn(ui)).toBe('site-web')
    expect(await buttonsOn(ui)).toEqual([])

    await kit.clock.advance(1_500)
    expect(await wordsOn(ui)).toBe('site-web')

    await kit.clock.advance(2_500)
    expect(await wordsOn(ui)).toBe('site-web')
    await ui.unmount()
  })

  onEachSurface('a hanging online check of the plugin copy holds nothing else back', async ($, on, surface) => {
    // The check runs to its whole time limit before it answers.
    const kit = install(on, { changed: 3, ahead: 2, slow: { 'ls-remote': 15_000 } })

    kit.world.plugin.onlineHead = ONLINE_HEAD
    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await wordsOn(ui)).toBe('site-web')
    expect(await buttonsOn(ui)).toEqual(['Go commit \u00b7 3', 'Push \u00b7 2', '\u22ee'])

    // A turn ends while the check still hangs: the new counts are not kept
    // waiting behind it, and no second check is sent after the first.
    kit.world.changed = 5
    await endTurn($, kit)
    expect(await wordsOn(ui)).toBe('site-web')
    expect(gitRuns(kit.world, 'ls-remote')).toHaveLength(1)

    await kit.clock.advance(15_000)
    expect(await buttonsOn(ui)).toContain('Update plugin \u00b7 1')
    await ui.unmount()
  })

  onEachSurface('a slow count of files holds the branch and the buttons back for a moment only', async ($, on, surface) => {
    const kit = install(on, { changed: 3, ahead: 2, slow: { status: 4_000 } })

    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await wordsOn(ui)).toBe('site-web')

    await kit.clock.advance(1_500)
    expect(await wordsOn(ui)).toBe('site-web')
    expect(await buttonsOn(ui)).toEqual(['Push \u00b7 2', '\u22ee'])

    await kit.clock.advance(2_500)
    expect(await wordsOn(ui)).toBe('site-web')
    await ui.unmount()
  })

  onEachSurface('while a new count is under way the row keeps the number it shows', async ($, on, surface) => {
    const kit = install(on, { changed: 3, ahead: 2 })

    await start($, kit)

    const ui = await bandOn($, surface)

    kit.world.slow = { status: 4_000 }
    kit.world.changed = 9
    kit.world.ahead = 3
    await endTurn($, kit)
    await kit.clock.advance(1_500)
    expect(await wordsOn(ui)).toBe('site-web')

    await kit.clock.advance(2_500)
    expect(await wordsOn(ui)).toBe('site-web')
    await ui.unmount()
  })
})

describe('a count of files that runs out of time', () => {
  test('is not started again every minute', async ($, on) => {
    const kit = install(on, { changed: 3, ahead: 2, silent: ['status'] })

    await start($, kit)

    const ui = await bandOn($, 'terminal')

    // The first count ran out of time: no number, and the rest is there.
    expect(await wordsOn(ui)).toBe('site-web')
    expect(gitRuns(kit.world, 'status')).toHaveLength(1)

    // Ten minutes on. The next count waited two minutes, the one after it
    // four: two more, where every minute used to start one.
    await kit.clock.advance(10 * 60_000)
    expect(gitRuns(kit.world, 'status')).toHaveLength(3)
    expect(await wordsOn(ui)).toBe('site-web')

    // An hour more. The wait doubles up to a quarter of an hour and stays.
    await kit.clock.advance(60 * 60_000)
    expect(gitRuns(kit.world, 'status')).toHaveLength(7)

    // The branch was read on every pass all the while.
    expect(gitRuns(kit.world, 'symbolic-ref').length).toBeGreaterThan(60)
    await ui.unmount()
  })

  test('a finished turn does not start one either while the wait runs', async ($, on) => {
    const kit = install(on, { changed: 3, ahead: 2, silent: ['status'] })

    await start($, kit)
    await endTurn($, kit)
    await endTurn($, kit)
    await kit.clock.advance(60_000)
    expect(gitRuns(kit.world, 'status')).toHaveLength(1)
  })

  test('once a count answers in time the number is back and the waits are over', async ($, on) => {
    const kit = install(on, { changed: 3, ahead: 2, silent: ['status'] })

    await start($, kit)

    const ui = await bandOn($, 'desktop')

    kit.world.silent = []
    await kit.clock.advance(60_000)
    expect(await wordsOn(ui)).toBe('site-web')

    await kit.clock.advance(60_000)
    expect(await wordsOn(ui)).toBe('site-web')
    expect(gitRuns(kit.world, 'status')).toHaveLength(2)

    // Back to a count on every pass.
    await kit.clock.advance(3 * 60_000)
    expect(gitRuns(kit.world, 'status')).toHaveLength(5)
    await ui.unmount()
  })

  onEachSurface('Push does not wait for the count: the press asks at once', async ($, on, surface) => {
    const kit = install(on, { changed: 3, ahead: 2, silent: ['status'] })

    await start($, kit)

    const ui = await bandOn($, surface)
    const counts = gitRuns(kit.world, 'status').length

    await ui.press({ key: 'push' })
    expect(await buttonsOn(ui)).toContain('Approve')
    await answerYes(kit, ui, 'confirm-push')
    expect(kit.world.toasts).toEqual(['Pushed 2 commits'])

    // Neither the press nor the yes started a count of its own.
    expect(gitRuns(kit.world, 'status')).toHaveLength(counts)
    await ui.unmount()
  })
})

describe('the shortcut buttons', () => {
  onEachSurface('follow the headings in CLAUDE.md', async ($, on, surface) => {
    const kit = install(on, {
      changed: 1,
      files: {
        'D:/Work/Site/CLAUDE.md': [
          '### `Go commit`',
          '### `Go audit` runs the checks',
          // None of these is the kit's heading for a shortcut.
          '### `Go commit and backup now`',
          '#### `Go backup`',
          '### Go update kit',
          'Type `Go code review` to start a review.',
          '```',
          '### `Go code review`',
          '```',
        ].join('\n'),
      },
    })

    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await buttonsOn(ui)).toEqual(['Go commit \u00b7 1', '\u22ee'])
    await ui.press({ key: 'more' })
    expect(await buttonsOn(ui)).toEqual(['Go audit', 'X'])
    await ui.unmount()
  })

  // A fence closes only on its own mark, at least as long as the one that
  // opened it. One left open hides everything below it.
  const FENCES: [string, string, string[]][] = [
    ['a four tick fence that quotes a three tick one', '````\n```\n### `Go backup`\n```\n````\n### `Go commit`', []],
    ['a four tick fence holding one three tick line', '````\n```\n````\n### `Go commit`', []],
    ['a tilde fence holding backticks', '~~~\n```\n### `Go backup`\n~~~\n### `Go commit`', []],
    ['a backtick fence holding tildes', '```\n~~~\n```\n### `Go commit`', []],
    ['a fence with a language on it', '```md\n### `Go backup`\n```\n### `Go commit`', []],
    ['a closing fence with a word after it is no closing fence', '```\n``` not the end\n### `Go commit`\n```', []],
    ['a fence left open', '```\nsome code\n\n### `Go commit`', []],
    ['a tilde fence around the heading', '~~~\n### `Go commit`\n~~~', []],
    ['an indented fence', '  ```\n  ### `Go backup`\n  ```\n### `Go commit`', []],
  ]

  for (const [name, text, expected] of FENCES) {
    test(`a heading in a code fence is an example: ${name}`, async ($, on) => {
      const kit = install(on, { files: { 'D:/Work/Site/CLAUDE.md': text } })

      await start($, kit)

      const ui = await bandOn($, 'terminal')

      expect(await buttonsOn(ui)).toEqual(expected)
      await ui.unmount()
    })
  }

  onEachSurface('take the whole phrase: Go commit and backup is not Go commit', async ($, on, surface) => {
    const kit = install(on, {
      changed: 1,
      files: {
        'D:/Work/Site/CLAUDE.md': ['### `Go commit and backup`', '### `go BACKUP` (every Friday)'].join('\n'),
      },
    })

    await start($, kit)

    const ui = await bandOn($, surface)

    // The heading may be written in any letter case; the button and the
    // prompt always carry the phrase the kit's way.
    expect(await buttonsOn(ui)).toEqual(['\u22ee'])
    await ui.press({ key: 'more' })
    expect(await buttonsOn(ui)).toEqual(['Go backup', 'Go commit and backup', 'X'])
    await ui.press({ key: 'go-backup' })
    expect(kit.world.prompts.map(prompt => prompt.text)).toEqual(['Go backup'])
    await ui.unmount()
  })

  onEachSurface('are found in a CLAUDE.md saved with Windows line endings', async ($, on, surface) => {
    const kit = install(on, {
      files: { 'D:/Work/Site/CLAUDE.md': '# Rules\r\n\r\n### `Go commit`\r\nCommit.\r\n### `Go audit`\r\n' },
    })

    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await buttonsOn(ui)).toEqual(['\u22ee'])
    await ui.unmount()
  })

  onEachSurface('are absent in a project without the kit', async ($, on, surface) => {
    const kit = install(on, { changed: 2, files: {} })

    await start($, kit)

    const ui = await bandOn($, surface)

    // With no Go commit in the row, the count stays in the words.
    expect(await wordsOn(ui)).toContain('2 to commit')
    expect(await buttonsOn(ui)).toEqual([])
    await ui.unmount()
  })

  onEachSurface('read the session folder too when the project sits inside a larger repository', async ($, on, surface) => {
    const kit = install(on, {
      folder: 'D:\\Work\\Site\\Product',
      files: { 'D:/Work/Site/Product/CLAUDE.md': '### `Go backup`\n' },
    })

    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await buttonsOn(ui)).toEqual(['\u22ee'])
    await ui.press({ key: 'more' })
    expect(await buttonsOn(ui)).toEqual(['Go backup', 'X'])
    await ui.unmount()
  })

  onEachSurface('Go commit submits exactly Go commit, as the owner', async ($, on, surface) => {
    const kit = install(on, { changed: 2 })

    await start($, kit)

    const ui = await bandOn($, surface)

    await ui.press({ key: 'go-commit' })
    expect(kit.world.prompts).toEqual([
      { text: 'Go commit', origin: { kind: 'plugin', name: PLUGIN, asUser: true } },
    ])

    // A double click is one press.
    await ui.press({ key: 'go-commit' })
    expect(kit.world.prompts).toHaveLength(1)

    // A later press is a new one.
    await kit.clock.advance(5_000)
    await ui.press({ key: 'go-commit' })
    expect(kit.world.prompts.map(prompt => prompt.text)).toEqual(['Go commit', 'Go commit'])
    await ui.unmount()
  })

  onEachSurface('a press the session cannot take says so instead of doing nothing', async ($, on, surface) => {
    const kit = install(on, { changed: 2, isPromptRefused: true })

    await start($, kit)

    const ui = await bandOn($, surface)

    await ui.press({ key: 'go-commit' })
    expect(kit.world.prompts).toEqual([])
    expect(kit.world.toasts).toEqual([
      'Could not send "Go commit". Type it in the message box instead.',
    ])
    await ui.unmount()
  })

  onEachSurface('Go commit is drawn as the other buttons, files waiting or not', async ($, on, surface) => {
    const kit = install(on, { changed: 2 })

    await start($, kit)

    const ui = await bandOn($, surface)

    expect((await ui.find({ key: 'go-commit' }))?.props.variant).toBeUndefined()

    kit.world.changed = 0
    await endTurn($, kit)
    expect((await ui.find({ key: 'go-commit' }))?.props.variant).toBeUndefined()
    await ui.unmount()
  })

  onEachSurface('Fast sits right after Go commit and submits FAST ON', async ($, on, surface) => {
    const kit = install(on, {
      files: {
        'D:/Work/Site/CLAUDE.md': [
          '### `Go commit`',
          '### `FAST MODE` (also `FAST ON`)',
          '### `Go backup`',
        ].join('\n'),
      },
    })

    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await buttonsOn(ui)).toEqual(['Fast mode', '\u22ee'])
    await ui.press({ key: 'fast-mode' })
    expect(kit.world.prompts.map(prompt => prompt.text)).toEqual(['FAST ON'])

    // Fast is in the row, so More does not list it again.
    await ui.press({ key: 'more' })
    expect(await buttonsOn(ui)).toEqual(['Go backup', 'X'])
    await ui.unmount()
  })

  const FAST_HEADINGS = [
    '### `Go commit`',
    '### `FAST MODE` (also `FAST ON`)',
    '### `Go backup`',
  ].join('\n')

  // What the owner types, as the engine hands it to the mods.
  const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' as const } })

  onEachSurface('Fast reads Fast on while the mode is on, and a press switches it off', async ($, on, surface) => {
    const kit = install(on, { files: { 'D:/Work/Site/CLAUDE.md': FAST_HEADINGS } })

    await start($, kit)

    const ui = await bandOn($, surface)

    await ui.press({ key: 'fast-mode' })
    await kit.clock.settle()
    expect(await buttonsOn(ui)).toEqual(['Fast Off', '\u22ee'])

    // A later press is a new one, and sends the words that end the mode.
    await kit.clock.advance(5_000)
    await ui.press({ key: 'fast-mode' })
    await kit.clock.settle()
    expect(kit.world.prompts.map(prompt => prompt.text)).toEqual(['FAST ON', 'FAST OFF'])
    expect(await buttonsOn(ui)).toEqual(['Fast mode', '\u22ee'])
    await ui.unmount()
  })

  onEachSurface('Fast follows the words the owner types', async ($, on, surface) => {
    const kit = install(on, { files: { 'D:/Work/Site/CLAUDE.md': FAST_HEADINGS } })

    await start($, kit)

    const ui = await bandOn($, surface)
    const after = async (text: string): Promise<string | undefined> => {
      await $.prompt.submit(typed(text))
      await kit.clock.settle()

      return (await buttonsOn(ui))[0]
    }

    // The mode's name in a sentence is talk about it, and switches nothing.
    expect(await after('is fast mode worth it here?')).toBe('Fast mode')
    expect(await after('fast on')).toBe('Fast Off')
    expect(await after('make the title bigger')).toBe('Fast Off')
    expect(await after('FAST OFF')).toBe('Fast mode')
    expect(await after('Fast mode')).toBe('Fast Off')
    expect(await after('ok, exit fast mode please')).toBe('Fast mode')
    expect(await after('FAST ON')).toBe('Fast Off')

    // Go commit ends the mode by itself.
    expect(await after('Go commit')).toBe('Fast mode')
    await ui.unmount()
  })

  test('a prompt the session refuses switches nothing', async ($, on) => {
    const kit = install(on, { files: { 'D:/Work/Site/CLAUDE.md': FAST_HEADINGS } })

    await start($, kit)

    const ui = await bandOn($, 'desktop')

    kit.world.isPromptRefused = true
    await ui.press({ key: 'fast-mode' })
    await kit.clock.settle()
    expect(await buttonsOn(ui)).toEqual(['Fast mode', '\u22ee'])
    await ui.unmount()
  })

  test('a reply that ends on "Fast mode on" puts the button on the mode', async ($, on) => {
    const kit = install(on, { files: { 'D:/Work/Site/CLAUDE.md': FAST_HEADINGS } })

    await start($, kit)

    const ui = await bandOn($, 'desktop')
    const reply = (answer: string, extra: Partial<{ isAborted: boolean; agentId: string }> = {}) =>
      $.turn.complete({
        answer,
        durationMs: 1200,
        isAborted: false,
        turnId: 'turn-1',
        reason: 'answer',
        ...extra,
      })

    // A resume left the button at off while the conversation stayed in the mode.
    await $.classic.SessionStart({ source: 'resume', cwd: kit.world.folder })
    await kit.clock.settle()
    expect(await buttonsOn(ui)).toEqual(['Fast mode', '\u22ee'])

    // The line inside a reply, a subagent's answer, or an interrupted turn: no change.
    await reply('I would say Fast mode on later.\n\nDone.')
    await reply('Done.\n\n----\n\nFast mode on', { agentId: 'helper-1' })
    await reply('Done.\n\n----\n\nFast mode on', { isAborted: true })
    await kit.clock.settle()
    expect(await buttonsOn(ui)).toEqual(['Fast mode', '\u22ee'])

    // A reply that ends on it: the button follows, and Fast Off then switches it off.
    await reply('The title is bigger.\n\n----\n\nFast mode on\n')
    await kit.clock.settle()
    expect(await buttonsOn(ui)).toEqual(['Fast Off', '\u22ee'])

    // A later reply without the line does not turn it off.
    await reply('Which one?')
    await kit.clock.settle()
    expect(await buttonsOn(ui)).toEqual(['Fast Off', '\u22ee'])
    await ui.press({ key: 'fast-mode' })
    await kit.clock.settle()
    expect(kit.world.prompts.map(prompt => prompt.text)).toEqual(['FAST OFF'])
    expect(await buttonsOn(ui)).toEqual(['Fast mode', '\u22ee'])
    await ui.unmount()
  })

  test('the mode is kept through a compaction, and a cleared conversation starts without it', async ($, on) => {
    const kit = install(on, { files: { 'D:/Work/Site/CLAUDE.md': FAST_HEADINGS } })

    await start($, kit)

    const ui = await bandOn($, 'desktop')

    await $.prompt.submit(typed('FAST ON'))
    await kit.clock.settle()
    await $.classic.SessionStart({ source: 'compact', cwd: kit.world.folder })
    await kit.clock.settle()
    expect(await buttonsOn(ui)).toEqual(['Fast Off', '\u22ee'])

    await $.classic.SessionStart({ source: 'clear', cwd: kit.world.folder })
    await kit.clock.settle()
    expect(await buttonsOn(ui)).toEqual(['Fast mode', '\u22ee'])
    await ui.unmount()
  })

  onEachSurface('the row is silent about a backup until it is 30 days old, then offers a button', async ($, on, surface) => {
    const kit = install(on, {
      backups: [
        { name: 'Site_2026-08-01_10-00.zip', daysOld: 60 },
        { name: 'Site_2026-09-21_10-00.zip', daysOld: 12 },
        // Not a ZIP: whatever else sits in the folder says nothing.
        { name: 'notes.txt', daysOld: 0 },
      ],
    })

    await start($, kit)

    const ui = await bandOn($, surface)

    // Before it is due the row says nothing about the backup.
    expect(await wordsOn(ui)).toBe('site-web | All committed')
    expect(await buttonsOn(ui)).toEqual(['\u22ee'])
    expect(await ui.find({ key: 'backup-age' })).toBeUndefined()
    expect(new Set(kit.world.listed).size).toBe(1)

    // The days pass, and on the thirtieth the button appears.
    kit.world.backups = [{ name: 'Site_2026-09-04_10-00.zip', daysOld: 29 }]
    await endTurn($, kit)
    expect(await buttonsOn(ui)).toEqual(['\u22ee'])
    kit.world.backups = [{ name: 'Site_2026-09-03_10-00.zip', daysOld: 30 }]
    await endTurn($, kit)
    expect(await wordsOn(ui)).toBe('site-web | All committed')
    expect(await buttonsOn(ui)).toEqual(['Backup 30d', '\u22ee'])

    // The button is the backup shortcut, so More does not list it again.
    await ui.press({ key: 'go-backup' })
    expect(kit.world.prompts.map(prompt => prompt.text)).toEqual(['Go backup'])
    await ui.press({ key: 'more' })
    expect(await buttonsOn(ui)).toEqual([
      'Go commit and backup',
      'Go audit',
      'Go code review',
      'X',
    ])
    await ui.unmount()
  })

  onEachSurface('a backup made today says nothing', async ($, on, surface) => {
    const kit = install(on, { backups: [{ name: 'Site_2026-10-03_08-00.zip', daysOld: 0 }] })

    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await buttonsOn(ui)).toEqual(['\u22ee'])
    await ui.unmount()
  })

  onEachSurface('a backup that is due stays in the words where the row is narrow', async ($, on, surface) => {
    const kit = install(on, {
      changed: 3,
      backups: [{ name: 'Site_2026-08-01_10-00.zip', daysOld: 45 }],
    })

    await start($, kit)

    const narrow = await bandOn($, surface, width(surface, 44))

    expect(await wordsOn(narrow)).toBe('site-web | 3 to commit \u00b7 Backup 45d')
    expect(await buttonsOn(narrow)).toEqual(['\u22ee'])
    await narrow.press({ key: 'more' })
    expect(await buttonsOn(narrow)).toContain('Go backup')
    await narrow.unmount()
  })

  onEachSurface('no backup age without a ZIP, and none without the backup shortcut', async ($, on, surface) => {
    const empty = install(on, { backups: [{ name: 'readme.txt', daysOld: 3 }] })

    await start($, empty)

    const ui = await bandOn($, surface)

    expect(await wordsOn(ui)).toBe('site-web | All committed')
    await ui.unmount()
  })

  onEachSurface('a project without the backup shortcut never has its backups folder read', async ($, on, surface) => {
    const kit = install(on, {
      files: { 'D:/Work/Site/CLAUDE.md': '### `Go commit`\n' },
      backups: [{ name: 'Site_2026-08-01_10-00.zip', daysOld: 45 }],
    })

    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await wordsOn(ui)).toBe('site-web | All committed')
    expect(await buttonsOn(ui)).toEqual([])
    expect(kit.world.listed).toEqual([])
    await ui.unmount()
  })

  onEachSurface('GO visual qa is listed behind More and sent the kit\'s way', async ($, on, surface) => {
    const kit = install(on, {
      files: { 'D:/Work/Site/CLAUDE.md': '### `Go commit`\n### `GO visual qa`\n' },
    })

    await start($, kit)

    const ui = await bandOn($, surface)

    await ui.press({ key: 'more' })
    expect(await buttonsOn(ui)).toEqual(['Go visual QA', 'X'])
    await ui.press({ key: 'go-visual-qa' })
    expect(kit.world.prompts.map(prompt => prompt.text)).toEqual(['GO visual qa'])
    await ui.unmount()
  })

  onEachSurface('the fill is a percentage before the words, and a press runs /compact', async ($, on, surface) => {
    const kit = install(on, { changed: 2, fill: 42 })

    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await buttonsOn(ui)).toEqual(['42%', 'Go commit \u00b7 2', '\u22ee'])
    expect((await ui.find({ key: 'fill' }))?.props.plain).toBe(true)
    await ui.press({ key: 'fill' })
    await kit.clock.settle()
    expect(kit.world.commands).toEqual(['compact'])
    expect(kit.world.prompts).toEqual([])

    // A double click is one press.
    await ui.press({ key: 'fill' })
    await kit.clock.settle()
    expect(kit.world.commands).toHaveLength(1)

    // After a compaction the session has no figure, and the row shows none.
    kit.world.fill = null
    await endTurn($, kit)
    expect(await buttonsOn(ui)).toEqual(['Go commit \u00b7 2', '\u22ee'])
    await ui.unmount()
  })

  onEachSurface('from 80% the number is pastel orange and Compact stands beside it', async ($, on, surface) => {
    const kit = install(on, { changed: 2, fill: 79 })

    await start($, kit)

    const ui = await bandOn($, surface)

    // Below 80 nothing changes: the number is the plain button.
    expect(await buttonsOn(ui)).toEqual(['79%', 'Go commit \u00b7 2', '\u22ee'])

    kit.world.fill = 80
    await endTurn($, kit)

    // From 80 the number is orange words, and a grey Compact follows it.
    expect(await buttonsOn(ui)).toEqual(['Compact', 'Go commit \u00b7 2', '\u22ee'])
    expect(await ui.find({ key: 'fill' })).toBeFalsy()

    const number = await ui.find({ type: 'Text', text: '80%' })

    expect(number?.props.color).toBe('#F5BE8C')
    expect((await ui.find({ key: 'compact' }))?.props.plain).toBeUndefined()
    await ui.press({ key: 'compact' })
    await kit.clock.settle()
    expect(kit.world.commands).toEqual(['compact'])
    expect(kit.world.prompts).toEqual([])
    await ui.unmount()
  })

  onEachSurface('heavy files show only while a leftover or a backup is that big', async ($, on, surface) => {
    const kit = install(on, {
      files: {
        'D:/Work/Site/CLAUDE.md': KIT_HEADINGS,
        'D:/Work/Site/project-os/Find-heavy-files.mjs': '',
      },
      // Dependencies and git's history are heavy in most projects: no mark.
      heavyOut: [
        'Find-heavy-files: D:/Work/Site, everything over 1.00 GB',
        '    3.10 GB  regenerable node_modules/',
        '    1.40 GB  git         .git/',
        'Find-heavy-files deletes nothing; the owner decides what goes.',
      ].join('\n'),
    })

    await start($, kit)

    const ui = await bandOn($, surface)

    // The desktop draws the name's mark and the check mark.
    expect(await wordsOn(ui)).toBe('site-web | All committed')
    expect(await ui.findAll({ type: 'Svg' })).toHaveLength(surface === 'terminal' ? 0 : 2)

    kit.world.heavyOut = [
      '   12.00 GB  leftover    old-render.mov',
      '    2.50 GB  backups     backups/',
      '    3.10 GB  regenerable node_modules/',
    ].join('\n')
    await kit.clock.advance(31 * 60_000)
    await kit.clock.settle()

    // The count is words of its own, with no mark beside it, and can be pressed.
    expect(await wordsOn(ui)).toBe('site-web | All committed')
    expect(await buttonsOn(ui)).toContain('2 heavy files')
    expect(await ui.findAll({ type: 'Svg' })).toHaveLength(surface === 'terminal' ? 0 : 2)
    await ui.unmount()
  })

  onEachSurface('a press on the heavy words lists again at once', async ($, on, surface) => {
    const kit = install(on, {
      files: {
        'D:/Work/Site/CLAUDE.md': KIT_HEADINGS,
        'D:/Work/Site/project-os/Find-heavy-files.mjs': '',
      },
      heavyOut: '   12.00 GB  leftover    old-render.mov',
    })

    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await buttonsOn(ui)).toContain('1 heavy file')

    // Still there: the press says so, and the row keeps its words.
    await ui.press({ key: 'heavy' })
    await kit.clock.settle()
    expect(kit.world.toasts).toEqual(['Checking for heavy files...', 'Still 1 heavy file.'])
    expect(await buttonsOn(ui)).toContain('1 heavy file')

    // The file is gone, minutes after the last listing: a press finds out now.
    kit.world.heavyOut = ''
    await kit.clock.advance(60_000)
    await ui.press({ key: 'heavy' })
    await kit.clock.settle()
    expect(kit.world.toasts.slice(2)).toEqual(['Checking for heavy files...', 'No heavy files any more.'])
    expect(await buttonsOn(ui)).not.toContain('1 heavy file')
    await ui.unmount()
  })

  // All committed is a drawing on the desktop and words on the terminal.
  test('all committed is a check mark where Go commit would be, on the desktop', async ($, on) => {
    const kit = install(on)

    await start($, kit)

    const desktop = await bandOn($, 'desktop')
    const drawn = await desktop.findAll({})
    const check = drawn.findIndex(one => one.type === 'Svg' && one.props.alt === 'All committed')
    const first = drawn.findIndex(one => one.type === 'Button' && one.props.label === '\u22ee')

    expect((await desktop.findAll({ type: 'Text' })).map(text => text.text)).toEqual(['site-web'])
    expect(drawn[check]?.props).toMatchObject({ width: 20, height: 20 })
    expect(check).toBeGreaterThan(-1)
    expect(check).toBeLessThan(first)
    // With nothing to commit there is no Go commit: the check stands there.
    expect(await buttonsOn(desktop)).toEqual(['\u22ee'])

    // A file changes: the check goes, and Go commit is back with its count.
    kit.world.changed = 1
    await endTurn($, kit)
    expect((await desktop.findAll({ type: 'Svg' })).some(svg => svg.props.alt === 'All committed')).toBe(false)
    expect(await buttonsOn(desktop)).toEqual(['Go commit \u00b7 1', '\u22ee'])

    // Nor is it drawn in the More list.
    kit.world.changed = 0
    await endTurn($, kit)
    await desktop.press({ key: 'more' })
    expect((await desktop.findAll({ type: 'Svg' })).some(svg => svg.props.alt === 'All committed')).toBe(false)
    await desktop.press({ key: 'cancel' })
    await desktop.unmount()

    const terminal = await bandOn($, 'terminal')

    expect((await terminal.findAll({ type: 'Text' })).map(text => text.text)).toEqual([
      'site-web',
      'All committed',
    ])
    await terminal.unmount()
  })
})

describe('Update Kit', () => {
  const STANDS_ON = {
    'D:/Work/Site/CLAUDE.md': KIT_HEADINGS,
    'D:/Work/Site/project-os/Kit-version.json': JSON.stringify({ commit: LOCAL_HEAD.slice(0, 7), date: '2026-10-02' }),
  }

  onEachSurface('is not offered while the project stands on the newest kit', async ($, on, surface) => {
    const kit = install(on, { files: STANDS_ON })

    await start($, kit)

    const ui = await bandOn($, surface)

    await ui.press({ key: 'more' })
    expect((await buttonsOn(ui)).some(label => label.startsWith('Update Kit'))).toBe(false)
    await ui.unmount()
  })

  onEachSurface('shows with its 1, last before the X, once the kit online is newer', async ($, on, surface) => {
    const kit = install(on, { files: STANDS_ON, offered: ['compact', 'deep-research'] })

    await start($, kit)

    const ui = await bandOn($, surface)

    // The kit moves on online, and the next check hears of it.
    kit.world.plugin.onlineHead = ONLINE_HEAD
    await kit.clock.advance(6 * 60_000)
    await endTurn($, kit)
    await ui.press({ key: 'more' })

    // After every shortcut and Deep Research: beside the X.
    expect((await buttonsOn(ui)).slice(-4)).toEqual([
      'Go code review',
      'Deep Research',
      'Update Kit \u00b7 1',
      'X',
    ])

    // The mark is on the label only: a press still sends the phrase.
    await ui.press({ key: 'go-update-kit' })
    await kit.clock.settle()
    expect(kit.world.prompts.map(prompt => prompt.text)).toEqual(['Go update kit'])
    await ui.unmount()
  })

  onEachSurface('an older install, kit but no phrase, is behind by definition, and a press sends the whole instruction', async ($, on, surface) => {
    const kit = install(on, {
      files: { 'D:/Work/Site/CLAUDE.md': '### `Go commit`\n' },
      present: ['D:/Work/Site/project-os/Hooks-settings.json'],
    })

    await start($, kit)

    const ui = await bandOn($, surface)

    await ui.press({ key: 'more' })
    expect(await buttonsOn(ui)).toEqual(['Update Kit \u00b7 1', 'X'])
    await ui.press({ key: 'go-update-kit' })
    await kit.clock.settle()
    expect(kit.world.prompts).toHaveLength(1)
    expect(kit.world.prompts[0]?.text).toContain('https://github.com/rotem914/ProjectOS')
    expect(kit.world.prompts[0]?.text).toContain('Go update kit')
    await ui.unmount()
  })

  onEachSurface('a project that carries the kit and records no version is offered the update', async ($, on, surface) => {
    const kit = install(on, { present: ['D:/Work/Site/project-os/Hooks-settings.json'] })

    await start($, kit)

    const ui = await bandOn($, surface)

    await ui.press({ key: 'more' })
    expect((await buttonsOn(ui)).slice(-2)).toEqual(['Update Kit \u00b7 1', 'X'])
    await ui.press({ key: 'go-update-kit' })
    await kit.clock.settle()
    expect(kit.world.prompts.map(prompt => prompt.text)).toEqual(['Go update kit'])
    await ui.unmount()
  })

  onEachSurface('the kit repository itself is never offered an update', async ($, on, surface) => {
    const kit = install(on, {
      present: [
        'D:/Work/Site/project-os/Hooks-settings.json',
        'D:/Work/Site/hooks/dispatch.mjs',
        'D:/Work/Site/.claude-plugin/plugin.json',
      ],
    })

    await start($, kit)

    const ui = await bandOn($, surface)

    await ui.press({ key: 'more' })
    expect((await buttonsOn(ui)).some(label => label.startsWith('Update Kit'))).toBe(false)
    await ui.unmount()
  })

  onEachSurface('the phrase alone, with no kit in the project, offers nothing', async ($, on, surface) => {
    const kit = install(on)

    kit.world.plugin.onlineHead = ONLINE_HEAD
    await start($, kit)

    const ui = await bandOn($, surface)

    await ui.press({ key: 'more' })
    expect((await buttonsOn(ui)).some(label => label.startsWith('Update Kit'))).toBe(false)
    await ui.unmount()
  })

  onEachSurface('a project without the kit and without the phrase gets no such button', async ($, on, surface) => {
    const kit = install(on, { files: { 'D:/Work/Site/CLAUDE.md': '### `Go commit`\n### `Go backup`\n' } })

    await start($, kit)

    const ui = await bandOn($, surface)

    await ui.press({ key: 'more' })
    expect((await buttonsOn(ui)).some(label => label.startsWith('Update Kit'))).toBe(false)
    await ui.unmount()
  })
})

describe('Deep Research', () => {
  onEachSurface('sits last in More where the command is offered, and a press runs it', async ($, on, surface) => {
    const kit = install(on, { offered: ['compact', 'deep-research'] })

    await start($, kit)

    const ui = await bandOn($, surface)

    await ui.press({ key: 'more' })

    const listed = await buttonsOn(ui)

    expect(listed.slice(-2)).toEqual(['Deep Research', 'X'])
    await ui.press({ key: '/deep-research' })
    await kit.clock.settle()
    expect(kit.world.commands).toEqual(['deep-research'])
    expect(kit.world.prompts).toEqual([])
    // The list has done its job and the row is back.
    expect(await buttonsOn(ui)).toContain('\u22ee')
    await ui.unmount()
  })

  onEachSurface('is not offered where Claude Code has no such command', async ($, on, surface) => {
    const kit = install(on)

    await start($, kit)

    const ui = await bandOn($, surface)

    await ui.press({ key: 'more' })
    expect(await buttonsOn(ui)).not.toContain('Deep Research')
    await ui.unmount()
  })
})

describe('the order of the buttons', () => {
  onEachSurface('Push sits before Fast', async ($, on, surface) => {
    const kit = install(on, {
      changed: 1,
      ahead: 1,
      files: { 'D:/Work/Site/CLAUDE.md': `${KIT_HEADINGS}\n### \`FAST MODE\` (also \`FAST ON\`)\n` },
    })

    await start($, kit)

    const ui = await bandOn($, surface)
    const buttons = await buttonsOn(ui)

    expect(buttons).toContain('Fast mode')
    expect(buttons.indexOf('Push \u00b7 1')).toBe(buttons.indexOf('Fast mode') - 1)
    await ui.unmount()
  })
})

describe('the server light', () => {
  const WITH_ADDRESS = [
    KIT_HEADINGS,
    'Docs: http://localhost:9999/guide',
    'Local app URL: `http://localhost:4321` (editor at `/keystatic`).',
  ].join('\n')

  // The dot's color is all the drawing says, so it is read off the markup.
  async function dotsOn(ui: Drawing): Promise<string[]> {
    return (await ui.findAll({ type: 'Svg' }))
      .map(svg => String(svg.props.source))
      .filter(source => source.includes('r="4"'))
      .map(source => /fill="(#[0-9A-F]{6})"/.exec(source)?.[1] ?? '')
  }

  test('a project that names no local address shows no light and asks nothing', async ($, on) => {
    const kit = install(on)

    await start($, kit)

    const ui = await bandOn($, 'desktop')

    expect(await dotsOn(ui)).toEqual([])
    expect(kit.world.fetched).toEqual([])
    await ui.unmount()
  })

  test('grey while the address does not answer, green once it does', async ($, on) => {
    const kit = install(on, { files: { 'D:/Work/Site/CLAUDE.md': WITH_ADDRESS }, fill: 23 })

    await start($, kit)

    const ui = await bandOn($, 'desktop')

    // The address the file calls the local app's, not the first one in it.
    expect(new Set(kit.world.fetched)).toEqual(new Set(['http://localhost:4321']))
    expect(await dotsOn(ui)).toEqual(['#646464'])

    // The owner starts the server himself. Any answer counts, even a 404.
    kit.world.isServerUp = true
    await endTurn($, kit)
    expect(await dotsOn(ui)).toEqual(['#2E9B24'])

    // The dot is 6 pixels and sits before the percentage.
    const drawn = await ui.findAll({})
    const dot = drawn.findIndex(one => one.type === 'Svg' && String(one.props.source).includes('r="4"'))
    const fill = drawn.findIndex(one => one.type === 'Button' && one.props.label === '23%')

    expect(drawn[dot]?.props).toMatchObject({ width: 6, height: 6, alt: 'Local server is running' })
    expect(dot).toBeGreaterThan(-1)
    expect(dot).toBeLessThan(fill)

    kit.world.isServerUp = false
    await endTurn($, kit)
    expect(await dotsOn(ui)).toEqual(['#646464'])
    await ui.unmount()
  })

  test('the terminal draws no light', async ($, on) => {
    const kit = install(on, { files: { 'D:/Work/Site/CLAUDE.md': WITH_ADDRESS } })

    kit.world.isServerUp = true
    await start($, kit)

    const ui = await bandOn($, 'terminal')

    expect(await ui.findAll({ type: 'Svg' })).toHaveLength(0)
    await ui.unmount()
  })
})

describe('More', () => {
  onEachSurface('lists the other shortcuts in the row itself and submits the one pressed', async ($, on, surface) => {
    const kit = install(on)

    await start($, kit)

    const ui = await bandOn($, surface)

    await ui.press({ key: 'more' })
    expect(await wordsOn(ui)).toBe('site-web')
    expect(await buttonsOn(ui)).toEqual([
      'Go backup',
      'Go commit and backup',
      'Go audit',
      'Go code review',
      'X',
    ])

    // The list is drawn where the row is, so it needs no pane, and its
    // buttons wrap onto further rows in a narrow window.
    expect(kit.world.opened).toEqual([])
    // They sit at the far end of the row, after the name.
    expect(
      (await ui.findAll({ type: 'Box' })).some(
        box => box.props.flexWrap === 'wrap' && box.props.justifyContent === 'flex-end',
      ),
    ).toBe(true)

    await ui.press({ key: 'go-code-review' })
    expect(kit.world.prompts.map(prompt => prompt.text)).toEqual(['Go code review'])

    // The list has done its job: the row is back.
    expect(await buttonsOn(ui)).toEqual(['\u22ee'])
    await ui.unmount()
  })

  onEachSurface('Back submits nothing and brings the row back', async ($, on, surface) => {
    const kit = install(on, { changed: 2 })

    await start($, kit)

    const ui = await bandOn($, surface)

    await ui.press({ key: 'more' })
    expect(await buttonsOn(ui)).toContain('X')
    await ui.press({ key: 'cancel' })
    expect(kit.world.prompts).toEqual([])
    expect(await wordsOn(ui)).toBe('site-web')
    expect(await buttonsOn(ui)).toEqual(['Go commit \u00b7 2', '\u22ee'])
    await ui.unmount()
  })

  onEachSurface('opens at every width, where a pane would have stayed hidden', async ($, on, surface) => {
    const kit = install(on, { changed: 3, ahead: 2 })

    await start($, kit)

    // A terminal narrower than 144 columns never showed a pane opened this
    // way. The list is drawn in the row, so the width does not matter.
    for (const columns of [40, 60, 80, 100, 143, 144, 200]) {
      const ui = await bandOn($, surface, columns)

      await ui.press({ key: 'more' })
      expect((await buttonsOn(ui)).at(-1), `${columns} columns`).toBe('X')
      await ui.press({ key: 'cancel' })
      await ui.unmount()
    }

    expect(kit.world.opened).toEqual([])
    expect(kit.world.toasts).toEqual([])
  })

  onEachSurface('left open, it closes by itself after a while', async ($, on, surface) => {
    const kit = install(on, { changed: 2 })

    await start($, kit)

    const ui = await bandOn($, surface)

    await ui.press({ key: 'more' })
    await kit.clock.advance(60_000)
    expect(await buttonsOn(ui)).toContain('X')

    await kit.clock.advance(2 * 60_000)
    expect(await buttonsOn(ui)).toEqual(['Go commit \u00b7 2', '\u22ee'])
    await ui.unmount()
  })
})

describe('the Push button', () => {
  onEachSurface('is there only while commits wait on a branch with an upstream', async ($, on, surface) => {
    const kit = install(on, { ahead: 0 })

    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await buttonsOn(ui)).not.toContain('Push \u00b7 3')

    kit.world.ahead = 3
    await endTurn($, kit)
    expect(await buttonsOn(ui)).toContain('Push \u00b7 3')
    await ui.unmount()
  })

  onEachSurface('turns into OK in the row, and pushes nothing at the first press', async ($, on, surface) => {
    const kit = install(on, {
      ahead: 2,
      branch: 'feature/new-header',
      upstream: 'origin/feature/new-header',
      remoteRef: 'refs/heads/feature/new-header',
      // A sign-in token in the address must never reach the screen.
      pushUrl: 'https://dana:ghp_secret123@github.com/example/site.git',
    })

    await start($, kit)

    const ui = await bandOn($, surface)

    await ui.press({ key: 'push' })
    expect(gitRuns(kit.world, 'push')).toHaveLength(0)

    expect(await wordsOn(ui)).not.toContain('ghp_secret123')

    // The button itself turns into OK, with no second row to answer, and it
    // never asks for the keyboard, so a stray Enter never pushes.
    expect(await buttonsOn(ui)).toContain('Approve')
    expect(await buttonsOn(ui)).not.toContain('Cancel')
    expect((await ui.find({ key: 'confirm-push' }))?.props.autoFocus).toBeUndefined()
    expect((await ui.find({ key: 'confirm-push' }))?.props.variant).toBe('primary')

    // Asked in the row: no pane is opened for it.
    expect(kit.world.opened).toEqual([])
    await ui.unmount()
  })

  onEachSurface('turns into OK at every width', async ($, on, surface) => {
    const kit = install(on, { ahead: 2 })

    await start($, kit)

    for (const columns of [40, 60, 80, 100, 143, 144, 200]) {
      const ui = await bandOn($, surface, columns)

      await ui.press({ key: 'push' })
      expect(await buttonsOn(ui), `${columns} columns`).toContain('Approve')

      // Left alone, OK is Push again before the next width is tried.
      await kit.clock.advance(5_000)
      expect(await buttonsOn(ui), `${columns} columns`).not.toContain('Approve')
      await ui.unmount()
    }

    expect(kit.world.opened).toEqual([])
    expect(kit.world.toasts).toEqual([])
    expect(gitRuns(kit.world, 'push')).toHaveLength(0)
  })

  onEachSurface('an OK nobody presses is Push again after five seconds', async ($, on, surface) => {
    const kit = install(on, { ahead: 2 })

    await start($, kit)

    const ui = await bandOn($, surface)

    await ui.press({ key: 'push' })
    await kit.clock.advance(4_000)
    expect(await buttonsOn(ui)).toEqual(['Approve', '\u22ee'])
    await kit.clock.advance(1_000)
    expect(gitRuns(kit.world, 'push')).toHaveLength(0)
    expect(kit.world.toasts).toEqual([])
    expect(await wordsOn(ui)).toBe('site-web | All committed')
    expect(await buttonsOn(ui)).toEqual(['Push \u00b7 2', '\u22ee'])
    await ui.unmount()
  })

  onEachSurface('a yes right after the question is a double press and pushes nothing', async ($, on, surface) => {
    const kit = install(on, { ahead: 2 })

    await start($, kit)

    const ui = await bandOn($, surface)

    // The question may be drawn right where the button was. The second half
    // of a double click must not answer it.
    await ui.press({ key: 'push' })
    await ui.press({ key: 'confirm-push' })
    await kit.clock.advance(500)
    await ui.press({ key: 'confirm-push' })
    expect(gitRuns(kit.world, 'push')).toHaveLength(0)
    expect(await buttonsOn(ui)).toEqual(['Approve', '\u22ee'])

    // A moment later the same press is an answer.
    await kit.clock.advance(100)
    await ui.press({ key: 'confirm-push' })
    expect(gitRuns(kit.world, 'push')).toHaveLength(1)
    expect(kit.world.toasts).toEqual(['Pushed 2 commits'])
    await ui.unmount()
  })

  onEachSurface('a question nobody answers is taken back, and nothing is pushed', async ($, on, surface) => {
    const kit = install(on, { ahead: 2 })

    await start($, kit)

    const ui = await bandOn($, surface)

    await ui.press({ key: 'push' })
    await kit.clock.advance(3 * 60_000)
    expect(await buttonsOn(ui)).toEqual(['Push \u00b7 2', '\u22ee'])
    expect(gitRuns(kit.world, 'push')).toHaveLength(0)
    await ui.unmount()
  })

  onEachSurface('a confirmed push sends the branch to its upstream and says so', async ($, on, surface) => {
    const kit = install(on, { changed: 1, ahead: 2 })

    await start($, kit)

    const ui = await bandOn($, surface)

    await ui.press({ key: 'push' })
    await answerYes(kit, ui, 'confirm-push')

    const pushes = gitRuns(kit.world, 'push')

    expect(pushes).toHaveLength(1)
    expect(pushes[0]?.args).toEqual([
      'push',
      '--no-follow-tags',
      'origin',
      'refs/heads/main:refs/heads/main',
    ])
    expect(pushes[0]?.cwd).toBe('D:/Work/Site')
    expect(pushes[0]?.env.GIT_TERMINAL_PROMPT).toBe('0')
    expect(pushes[0]?.timeoutMs).toBe(120_000)
    expect(pushes[0]?.args.some(arg => /force|tags$|^--all$|^--mirror$|^\+/.test(arg) && arg !== '--no-follow-tags')).toBe(false)
    expect(kit.world.toasts).toEqual(['Pushed 2 commits'])

    // The row follows: nothing left to push, so no Push button.
    expect(await wordsOn(ui)).toBe('site-web')
    expect(await buttonsOn(ui)).not.toContain('Push')
    await ui.unmount()
  })

  onEachSurface('a push of one commit says one commit', async ($, on, surface) => {
    const kit = install(on, { ahead: 1 })

    await start($, kit)

    const ui = await bandOn($, surface)

    await ui.press({ key: 'push' })
    await answerYes(kit, ui, 'confirm-push')
    expect(kit.world.toasts).toEqual(['Pushed 1 commit'])
    await ui.unmount()
  })

  onEachSurface('a push that fails says why in plain words', async ($, on, surface) => {
    const kit = install(on, {
      ahead: 2,
      push: {
        code: 128,
        err: "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
        delayMs: 0,
      },
    })

    await start($, kit)

    const ui = await bandOn($, surface)

    await ui.press({ key: 'push' })
    await answerYes(kit, ui, 'confirm-push')
    expect(kit.world.toasts).toEqual([
      'Push did not go through: sign-in is missing. Nothing changed.',
    ])

    // Still waiting, and Push can be tried again.
    expect(await buttonsOn(ui)).toContain('Push \u00b7 2')
    expect(await buttonsOn(ui)).toContain('Push \u00b7 2')
    await ui.unmount()
  })

  onEachSurface('a push the online copy refuses says it has newer work', async ($, on, surface) => {
    const kit = install(on, {
      ahead: 1,
      push: {
        code: 1,
        err: [
          'To https://github.com/example/site.git',
          ' ! [rejected]        main -> main (fetch first)',
          "error: failed to push some refs to 'https://github.com/example/site.git'",
        ].join('\n'),
        delayMs: 0,
      },
    })

    await start($, kit)

    const ui = await bandOn($, surface)

    await ui.press({ key: 'push' })
    await answerYes(kit, ui, 'confirm-push')
    expect(kit.world.toasts).toEqual([
      'Push did not go through: the online copy has newer work. Nothing changed.',
    ])
    await ui.unmount()
  })

  onEachSurface('a push that runs out of time does not claim nothing changed', async ($, on, surface) => {
    const kit = install(on, { ahead: 2 })

    await start($, kit)

    const ui = await bandOn($, surface)

    await ui.press({ key: 'push' })
    kit.world.silent = ['push']
    await answerYes(kit, ui, 'confirm-push')
    expect(kit.world.toasts).toEqual([
      'Push did not go through: it took too long. Check the online copy before pushing again.',
    ])
    await ui.unmount()
  })

  onEachSurface('a second press while a push runs does nothing', async ($, on, surface) => {
    const kit = install(on, { ahead: 2, push: { code: 0, err: '', delayMs: 30_000 } })

    await start($, kit)

    const ui = await bandOn($, surface)

    await ui.press({ key: 'push' })

    // The push stays in flight until the clock moves.
    await answerYes(kit, ui, 'confirm-push')
    expect(gitRuns(kit.world, 'push')).toHaveLength(1)
    expect(kit.world.toasts).toEqual([])
    expect((await ui.find({ key: 'push' }))?.props.label).toBe('Pushing...')

    await ui.press({ key: 'push' })
    await ui.press({ key: 'push' })
    expect(await buttonsOn(ui)).not.toContain('Cancel')
    expect(gitRuns(kit.world, 'push')).toHaveLength(1)

    await kit.clock.advance(30_000)
    expect(kit.world.toasts).toEqual(['Pushed 2 commits'])
    expect(gitRuns(kit.world, 'push')).toHaveLength(1)
    expect(await buttonsOn(ui)).not.toContain('Pushing...')
    await ui.unmount()
  })

  onEachSurface('the yes pressed twice pushes once', async ($, on, surface) => {
    const kit = install(on, { ahead: 2, push: { code: 0, err: '', delayMs: 3_000 } })

    await start($, kit)

    const ui = await bandOn($, surface)

    await ui.press({ key: 'push' })
    await kit.clock.advance(1_000)

    const one = ui.press({ key: 'confirm-push' })
    const two = ui.press({ key: 'confirm-push' })

    await kit.clock.advance(5_000)
    await Promise.all([one, two])
    expect(gitRuns(kit.world, 'push')).toHaveLength(1)
    expect(kit.world.toasts).toEqual(['Pushed 2 commits'])
    await ui.unmount()
  })

  onEachSurface('a push is called off when the branch changed after the question', async ($, on, surface) => {
    const kit = install(on, { ahead: 2 })

    await start($, kit)

    const ui = await bandOn($, surface)

    await ui.press({ key: 'push' })
    kit.world.branch = 'other'
    kit.world.upstream = 'origin/other'
    kit.world.remoteRef = 'refs/heads/other'
    await answerYes(kit, ui, 'confirm-push')
    expect(gitRuns(kit.world, 'push')).toHaveLength(0)
    expect(kit.world.toasts).toEqual([
      'Push did not go through: the branch changed since you asked. Nothing was pushed.',
    ])
    await ui.unmount()
  })

  onEachSurface('a push is called off when the address changed after the question', async ($, on, surface) => {
    const kit = install(on, { ahead: 2 })

    await start($, kit)

    const ui = await bandOn($, surface)

    await ui.press({ key: 'push' })
    kit.world.pushUrl = 'https://github.com/someone-else/site.git'
    await answerYes(kit, ui, 'confirm-push')
    expect(gitRuns(kit.world, 'push')).toHaveLength(0)
    expect(kit.world.toasts).toEqual([
      'Push did not go through: the branch changed since you asked. Nothing was pushed.',
    ])
    await ui.unmount()
  })

  onEachSurface('a push is called off when more commits arrived after the question', async ($, on, surface) => {
    const kit = install(on, { ahead: 2 })

    await start($, kit)

    const ui = await bandOn($, surface)

    await ui.press({ key: 'push' })

    // The owner said yes to two commits. Three is a different push.
    kit.world.ahead = 3
    await answerYes(kit, ui, 'confirm-push')
    expect(gitRuns(kit.world, 'push')).toHaveLength(0)
    expect(kit.world.toasts).toEqual([
      'Push did not go through: the branch changed since you asked. Nothing was pushed.',
    ])

    // The row now shows three, and a new press is about three.
    expect(await buttonsOn(ui)).toContain('Push \u00b7 3')
    await ui.press({ key: 'push' })
    await answerYes(kit, ui, 'confirm-push')
    expect(gitRuns(kit.world, 'push')).toHaveLength(1)
    await ui.unmount()
  })

  onEachSurface('a push that is no longer needed says so', async ($, on, surface) => {
    const kit = install(on, { ahead: 2 })

    await start($, kit)

    const ui = await bandOn($, surface)

    await ui.press({ key: 'push' })

    // Pushed from another program while the question was open.
    kit.world.ahead = 0
    await answerYes(kit, ui, 'confirm-push')
    expect(gitRuns(kit.world, 'push')).toHaveLength(0)
    expect(kit.world.toasts).toEqual(['Nothing to push. Everything is already online.'])
    expect(await buttonsOn(ui)).not.toContain('Push')
    await ui.unmount()
  })

  onEachSurface('a press after everything went online says so and asks nothing', async ($, on, surface) => {
    const kit = install(on, { ahead: 2 })

    await start($, kit)

    const ui = await bandOn($, surface)

    // Pushed from another program since the row was drawn.
    kit.world.ahead = 0
    await ui.press({ key: 'push' })
    expect(kit.world.toasts).toEqual(['Nothing to push. Everything is already online.'])
    expect(await buttonsOn(ui)).toEqual(['\u22ee'])
    await ui.unmount()
  })

  onEachSurface('a press while git cannot answer does not claim there is nothing to push', async ($, on, surface) => {
    const kit = install(on, { ahead: 2 })

    await start($, kit)

    const ui = await bandOn($, surface)

    kit.world.broken = ['for-each-ref']
    await ui.press({ key: 'push' })
    expect(gitRuns(kit.world, 'push')).toHaveLength(0)
    expect(kit.world.toasts).toEqual([
      'Could not read what is waiting to be pushed. Try again in a moment.',
    ])
    expect(await buttonsOn(ui)).not.toContain('Cancel')
    await ui.unmount()
  })

  onEachSurface('turns into OK and pushes without moving the keyboard', async ($, on, surface) => {
    const kit = install(on, { ahead: 2 })

    await start($, kit)

    const ui = await bandOn($, surface)

    // OK takes the place of Push and the keyboard's ring is left where it
    // is: nothing is asked of it between the two presses.
    await ui.press({ key: 'push' })
    expect(kit.world.logs.some(line => line.includes('moving the keyboard to a button failed'))).toBe(false)
    expect(await buttonsOn(ui)).toEqual(['Approve', '\u22ee'])
    await answerYes(kit, ui, 'confirm-push')
    expect(kit.world.toasts).toEqual(['Pushed 2 commits'])
    await ui.unmount()
  })
})

describe('a project with a push step of its own', () => {
  // Claude Code runs a plugin's git with the project's hooks switched off. A
  // push from the row would skip a project's own push hook: its checks, or
  // the upload of its large files, and would still say Pushed.
  onEachSurface('gets no Push, and the words say where to push from', async ($, on, surface) => {
    const kit = install(on, {
      changed: 1,
      ahead: 2,
      present: ['D:/Work/Site/.git/hooks/pre-push'],
    })

    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await wordsOn(ui)).toBe(
      'site-web | 2 to push from your git app',
    )
    expect(await buttonsOn(ui)).toEqual(['Go commit \u00b7 1', '\u22ee'])

    // The words are not dimmed: something is waiting.
    expect((await ui.find({ type: 'Text', text: 'to push' }))?.props.dimColor).toBe(false)
    await ui.unmount()
  })

  onEachSurface('the sample hook git ships is no push step', async ($, on, surface) => {
    const kit = install(on, { ahead: 2, present: ['D:/Work/Site/.git/hooks/pre-push.sample'] })

    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await wordsOn(ui)).toBe('site-web | All committed')
    expect(await buttonsOn(ui)).toContain('Push \u00b7 2')
    await ui.unmount()
  })

  onEachSurface('the hooks folder the project names is the one that counts', async ($, on, surface) => {
    const kit = install(on, {
      ahead: 2,
      hooksPath: '.githooks',
      // Git ignores its own hooks folder once the project names another.
      present: ['D:/Work/Site/.git/hooks/pre-push'],
    })

    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await buttonsOn(ui)).toContain('Push \u00b7 2')

    kit.world.present = ['D:/Work/Site/.githooks/pre-push']
    await endTurn($, kit)
    expect(await buttonsOn(ui)).not.toContain('Push')
    expect(await wordsOn(ui)).toContain('2 to push from your git app')
    await ui.unmount()
  })

  onEachSurface('a hooks folder named in full, or under the home folder, is found too', async ($, on, surface) => {
    const kit = install(on, {
      ahead: 2,
      hooksPath: 'E:/Shared/hooks',
      present: ['E:/Shared/hooks/pre-push'],
    })

    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await buttonsOn(ui)).not.toContain('Push \u00b7 2')

    kit.world.hooksPath = '~/git-hooks'
    kit.world.present = ['C:/Users/Dana/git-hooks/pre-push']
    await endTurn($, kit)
    expect(await buttonsOn(ui)).not.toContain('Push \u00b7 2')

    kit.world.present = []
    await endTurn($, kit)
    expect(await buttonsOn(ui)).toContain('Push \u00b7 2')
    await ui.unmount()
  })

  onEachSurface('husky\u2019s own stand-in is no push step until the project writes one', async ($, on, surface) => {
    const kit = install(on, {
      ahead: 2,
      hooksPath: '.husky/_',
      // Husky keeps a stand-in for every hook in its own folder.
      present: ['D:/Work/Site/.husky/_/pre-push'],
    })

    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await buttonsOn(ui)).toContain('Push \u00b7 2')

    // The project's own push hook, one folder up, is what the stand-in runs.
    kit.world.present = ['D:/Work/Site/.husky/_/pre-push', 'D:/Work/Site/.husky/pre-push']
    await endTurn($, kit)
    expect(await buttonsOn(ui)).not.toContain('Push')
    await ui.unmount()
  })

  onEachSurface('when git cannot say, no Push is offered', async ($, on, surface) => {
    const kit = install(on, { ahead: 2, broken: ['config'] })

    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await wordsOn(ui)).toBe('site-web | All committed \u00b7 2 to push from your git app')
    expect(await buttonsOn(ui)).not.toContain('Push')
    await ui.unmount()
  })

  onEachSurface('a hook that turned up after the row was drawn stops the press', async ($, on, surface) => {
    const kit = install(on, { ahead: 2 })

    await start($, kit)

    const ui = await bandOn($, surface)

    kit.world.present = ['D:/Work/Site/.git/hooks/pre-push']
    await ui.press({ key: 'push' })
    expect(kit.world.toasts).toEqual([
      'This project has push steps of its own. Push it from your git app.',
    ])
    expect(gitRuns(kit.world, 'push')).toHaveLength(0)
    expect(await buttonsOn(ui)).toEqual(['\u22ee'])
    await ui.unmount()
  })

  onEachSurface('a hook that turned up after the question stops the yes', async ($, on, surface) => {
    const kit = install(on, { ahead: 2 })

    await start($, kit)

    const ui = await bandOn($, surface)

    await ui.press({ key: 'push' })
    kit.world.present = ['D:/Work/Site/.git/hooks/pre-push']
    await answerYes(kit, ui, 'confirm-push')
    expect(gitRuns(kit.world, 'push')).toHaveLength(0)
    expect(kit.world.toasts).toHaveLength(1)
    await ui.unmount()
  })

  test('a hook is found from a subfolder of the project too', async ($, on) => {
    const kit = install(on, {
      ahead: 2,
      folder: 'D:\\Work\\Site\\Product',
      // Git names its own folder from where it was asked: one level up here.
      gitDir: '../.git',
      present: ['D:/Work/Site/.git/hooks/pre-push'],
    })

    await start($, kit)

    const ui = await bandOn($, 'terminal')

    expect(await buttonsOn(ui)).not.toContain('Push')
    await ui.unmount()
  })

  test('in a worktree the hooks are looked for in the folder every worktree shares', async ($, on) => {
    const kit = install(on, {
      ahead: 2,
      folder: 'D:\\Work\\Site-fix',
      top: 'D:/Work/Site-fix',
      files: { 'D:/Work/Site-fix/CLAUDE.md': KIT_HEADINGS },
      // A worktree's own git folder holds no hooks: git names the shared one.
      gitDir: 'D:/Work/Site/.git',
      present: ['D:/Work/Site/.git/hooks/pre-push'],
    })

    await start($, kit)

    const ui = await bandOn($, 'terminal')

    expect(await buttonsOn(ui)).toEqual(['\u22ee'])

    kit.world.present = ['D:/Work/Site-fix/.git/hooks/pre-push']
    await endTurn($, kit)
    expect(await buttonsOn(ui)).toEqual(['Push \u00b7 2', '\u22ee'])
    await ui.unmount()
  })
})

describe('the plugin copy of the kit', () => {
  onEachSurface('says nothing when it is up to date', async ($, on, surface) => {
    const kit = install(on)

    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await wordsOn(ui)).toBe('site-web | All committed')
    expect(await buttonsOn(ui)).not.toContain('Update plugin')

    // It did ask, in the plugin folder, and quietly.
    const asked = gitRuns(kit.world, 'ls-remote')

    expect(asked).toHaveLength(1)
    expect(asked[0]?.args).toEqual(['ls-remote', 'origin', 'refs/heads/main'])
    expect(asked[0]?.cwd).toBe('C:\\ClaudeConfigs\\Darrow\\skills\\projectos')
    expect(asked[0]?.env.GIT_TERMINAL_PROMPT).toBe('0')
    await ui.unmount()
  })

  onEachSurface('offers Update plugin, with its count, when the online copy moved on', async ($, on, surface) => {
    const kit = install(on)

    kit.world.plugin.onlineHead = ONLINE_HEAD
    kit.world.plugin.behind = 3
    await start($, kit)

    const ui = await bandOn($, surface)

    // The button alone says an update waits: no words beside it (owner,
    // 2026-10-08), and the count is what git counts once the online commit
    // was fetched into this copy's history.
    expect(await wordsOn(ui)).toBe('site-web | All committed')
    expect(await buttonsOn(ui)).toEqual(['Update plugin \u00b7 3', '\u22ee'])
    expect(gitRuns(kit.world, 'fetch')).toHaveLength(1)
    expect(gitRuns(kit.world, 'fetch')[0]?.args).toEqual(['fetch', 'origin', 'main'])
    expect(gitRuns(kit.world, 'rev-list')[0]?.args).toEqual(['rev-list', '--count', `HEAD..${ONLINE_HEAD}`])

    // The next look counts again without fetching again.
    await endTurn($, kit)
    expect(gitRuns(kit.world, 'fetch')).toHaveLength(1)
    expect(gitRuns(kit.world, 'rev-list').length).toBeGreaterThan(1)
    await ui.unmount()
  })

  onEachSurface('Update plugin carries no count when git cannot count', async ($, on, surface) => {
    const kit = install(on, { broken: ['fetch'] })

    kit.world.plugin.onlineHead = ONLINE_HEAD
    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await buttonsOn(ui)).toEqual(['Update plugin', '\u22ee'])
    expect(gitRuns(kit.world, 'rev-list')).toHaveLength(0)
    await ui.unmount()
  })

  onEachSurface('reads the personal profile from the home folder', async ($, on, surface) => {
    const kit = install(on, { env: { USERPROFILE: 'C:\\Users\\Dana' } })

    kit.world.plugin.dir = 'C:\\Users\\Dana\\.claude\\skills\\projectos'
    kit.world.plugin.onlineHead = ONLINE_HEAD
    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await buttonsOn(ui)).toContain('Update plugin \u00b7 1')
    expect(gitRuns(kit.world, 'ls-remote')[0]?.cwd).toBe('C:\\Users\\Dana\\.claude\\skills\\projectos')
    await ui.unmount()
  })

  onEachSurface('works the same on a Mac or Linux computer', async ($, on, surface) => {
    const kit = install(on, {
      env: { CLAUDE_CONFIG_DIR: '/Users/dana/claude-configs/Darrow', HOME: '/Users/dana' },
      folder: '/Users/dana/work/site',
      top: '/Users/dana/work/site',
      files: { '/Users/dana/work/site/CLAUDE.md': KIT_HEADINGS },
      changed: 2,
      ahead: 1,
    })

    kit.world.plugin.dir = '/Users/dana/claude-configs/Darrow/skills/projectos'
    kit.world.plugin.onlineHead = ONLINE_HEAD
    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await wordsOn(ui)).toBe('site-web')
    expect(await buttonsOn(ui)).toEqual(['Go commit \u00b7 2', 'Push \u00b7 1', 'Update plugin \u00b7 1', '\u22ee'])
    expect(gitRuns(kit.world, 'ls-remote')[0]?.cwd).toBe('/Users/dana/claude-configs/Darrow/skills/projectos')
    expect(kit.world.listed).toEqual([])

    // A push hook is found there too.
    kit.world.present = ['/Users/dana/work/site/.git/hooks/pre-push']
    await endTurn($, kit)
    expect(await buttonsOn(ui)).toEqual(['Go commit \u00b7 2', 'Update plugin \u00b7 1', '\u22ee'])
    await ui.unmount()
  })

  onEachSurface('says nothing when this copy is ahead of the online one', async ($, on, surface) => {
    const kit = install(on)

    kit.world.plugin.onlineHead = ONLINE_HEAD
    kit.world.plugin.isHeld = true
    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await wordsOn(ui)).toBe('site-web | All committed')
    await ui.unmount()
  })

  onEachSurface('says nothing when the folder is missing or is not a clone', async ($, on, surface) => {
    const kit = install(on)

    kit.world.plugin.isClone = false
    kit.world.plugin.onlineHead = ONLINE_HEAD
    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await wordsOn(ui)).toBe('site-web | All committed')
    expect(gitRuns(kit.world, 'ls-remote')).toHaveLength(0)
    expect(kit.world.git.every(call => plain(call.cwd) !== plain(kit.world.plugin.dir))).toBe(true)
    await ui.unmount()
  })

  onEachSurface('says nothing when the network does not answer', async ($, on, surface) => {
    const kit = install(on, { silent: ['ls-remote'] })

    kit.world.plugin.onlineHead = ONLINE_HEAD
    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await wordsOn(ui)).toBe('site-web | All committed')

    // And it is not asked again on every pass.
    await endTurn($, kit)
    await kit.clock.advance(60_000)
    expect(gitRuns(kit.world, 'ls-remote')).toHaveLength(1)
    await ui.unmount()
  })

  test('asks online at most once per five minutes', async ($, on) => {
    const kit = install(on)

    await start($, kit)
    await endTurn($, kit)
    await endTurn($, kit)
    await kit.clock.advance(4 * 60_000)
    expect(gitRuns(kit.world, 'ls-remote')).toHaveLength(1)

    await kit.clock.advance(2 * 60_000)
    expect(gitRuns(kit.world, 'ls-remote')).toHaveLength(2)
  })

  onEachSurface('uses the answer another window stored, without asking again', async ($, on, surface) => {
    const dir = 'C:\\ClaudeConfigs\\Darrow\\skills\\projectos'
    const kit = install(on, {
      stored: {
        'band.pluginCheck': { dir, checkedAt: startOfTime + 3_600_000 - 2 * 60_000, remoteHead: ONLINE_HEAD },
      },
    })

    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await buttonsOn(ui)).toContain('Update plugin \u00b7 1')
    expect(gitRuns(kit.world, 'ls-remote')).toHaveLength(0)
    await ui.unmount()
  })

  onEachSurface('Update plugin asks first, then pulls and the notice goes', async ($, on, surface) => {
    const kit = install(on)

    kit.world.plugin.onlineHead = ONLINE_HEAD
    kit.world.plugin.origin = 'https://dana:token@github.com/example/kit'
    await start($, kit)

    const ui = await bandOn($, surface)

    await ui.press({ key: 'update-plugin' })
    expect(gitRuns(kit.world, 'pull')).toHaveLength(0)

    const words = await wordsOn(ui)

    expect(words).toBe(
      'site-web | Update the ProjectOS plugin in C:\\ClaudeConfigs\\Darrow\\skills\\projectos from https://github.com/example/kit?',
    )
    expect(words).not.toContain('token')
    expect(await buttonsOn(ui)).toEqual(['Cancel', 'Update'])
    expect((await ui.find({ key: 'cancel' }))?.props.autoFocus).toBe(true)
    expect(kit.world.opened).toEqual([])

    // Cancel first: nothing is pulled.
    await ui.press({ key: 'cancel' })
    expect(gitRuns(kit.world, 'pull')).toHaveLength(0)
    expect(await buttonsOn(ui)).toEqual(['Update plugin \u00b7 1', '\u22ee'])

    await ui.press({ key: 'update-plugin' })

    // A yes that comes at once is a double press here too.
    await ui.press({ key: 'confirm-update' })
    expect(gitRuns(kit.world, 'pull')).toHaveLength(0)
    await answerYes(kit, ui, 'confirm-update')

    const pulls = gitRuns(kit.world, 'pull')

    expect(pulls).toHaveLength(1)
    expect(pulls[0]?.args).toEqual(['pull', '--ff-only'])
    expect(pulls[0]?.cwd).toBe('C:\\ClaudeConfigs\\Darrow\\skills\\projectos')
    expect(pulls[0]?.env.GIT_TERMINAL_PROMPT).toBe('0')
    expect(kit.world.toasts).toEqual(['Plugin updated'])
    expect(await wordsOn(ui)).toBe('site-web | All committed')
    expect(await buttonsOn(ui)).not.toContain('Update plugin')
    await ui.unmount()
  })

  onEachSurface('the question names the folder alone when git cannot name the address', async ($, on, surface) => {
    const kit = install(on)

    kit.world.plugin.onlineHead = ONLINE_HEAD
    await start($, kit)

    const ui = await bandOn($, surface)

    kit.world.broken = ['remote']
    await ui.press({ key: 'update-plugin' })
    expect(await wordsOn(ui)).toBe(
      'site-web | Update the ProjectOS plugin in C:\\ClaudeConfigs\\Darrow\\skills\\projectos?',
    )
    await ui.unmount()
  })

  onEachSurface('a second press while an update runs does nothing', async ($, on, surface) => {
    const kit = install(on, {
      pull: { code: 0, out: 'Updating aaaaaaa..bbbbbbb\nFast-forward\n', err: '', delayMs: 20_000 },
    })

    kit.world.plugin.onlineHead = ONLINE_HEAD
    await start($, kit)

    const ui = await bandOn($, surface)

    await ui.press({ key: 'update-plugin' })

    // The update stays in flight until the clock moves.
    await answerYes(kit, ui, 'confirm-update')
    expect((await ui.find({ key: 'update-plugin' }))?.props.label).toBe('Updating...')

    await ui.press({ key: 'update-plugin' })
    expect(await buttonsOn(ui)).not.toContain('Cancel')
    expect(gitRuns(kit.world, 'pull')).toHaveLength(1)

    await kit.clock.advance(20_000)
    expect(kit.world.toasts).toEqual(['Plugin updated'])
    expect(gitRuns(kit.world, 'pull')).toHaveLength(1)
    await ui.unmount()
  })

  onEachSurface('an update that runs out of time says so, and can be tried again', async ($, on, surface) => {
    const kit = install(on)

    kit.world.plugin.onlineHead = ONLINE_HEAD
    await start($, kit)

    const ui = await bandOn($, surface)

    await ui.press({ key: 'update-plugin' })
    kit.world.silent = ['pull']
    await answerYes(kit, ui, 'confirm-update')
    expect(kit.world.toasts).toEqual([
      'Update did not go through: it took too long. Try again in a moment.',
    ])
    expect(gitRuns(kit.world, 'pull')[0]?.timeoutMs).toBe(120_000)
    expect(await buttonsOn(ui)).toContain('Update plugin \u00b7 1')
    await ui.unmount()
  })

  onEachSurface('an update that fails says why and changes nothing', async ($, on, surface) => {
    const kit = install(on, {
      pull: { code: 128, out: '', err: 'fatal: Not possible to fast-forward, aborting.', delayMs: 0 },
    })

    kit.world.plugin.onlineHead = ONLINE_HEAD
    await start($, kit)

    const ui = await bandOn($, surface)

    await ui.press({ key: 'update-plugin' })
    await answerYes(kit, ui, 'confirm-update')
    expect(kit.world.toasts).toEqual([
      'Update did not go through: this copy has changes of its own. Nothing changed.',
    ])
    expect(await buttonsOn(ui)).toContain('Update plugin \u00b7 1')
    await ui.unmount()
  })
})

describe('a narrow row', () => {
  // The label is 8 cells. With 3 files, 2 commits and every shortcut the row
  // needs 45 cells with the counts in Go commit and Push, and 39 with Go
  // commit behind More, where its count goes back into the words.
  onEachSurface('shortens the words first, then folds Go commit into More', async ($, on, surface) => {
    const kit = install(on, { changed: 3, ahead: 2 })

    await start($, kit)

    const wide = await bandOn($, surface, width(surface, 47))

    expect(await wordsOn(wide)).toBe('site-web')
    expect(await buttonsOn(wide)).toEqual(['Go commit \u00b7 3', 'Push \u00b7 2', '\u22ee'])
    await wide.unmount()

    const narrower = await bandOn($, surface, width(surface, 46))

    expect(await wordsOn(narrower)).toBe('site-web')
    expect(await buttonsOn(narrower)).toEqual(['Go commit \u00b7 3', 'Push \u00b7 2', '\u22ee'])
    await narrower.redraw({
      hasSurvey: false,
      isWorking: false,
      maxRows: 12,
      bodyColumns: width(surface, 45),
      scroll: { offset: 0, bodyRows: 12 },
      view: {},
    })
    expect(await buttonsOn(narrower)).toEqual(['Go commit \u00b7 3', 'Push \u00b7 2', '\u22ee'])
    await narrower.unmount()

    const narrow = await bandOn($, surface, width(surface, 44))

    expect(await wordsOn(narrow)).toBe('site-web | 3 to commit')
    expect(await buttonsOn(narrow)).toEqual(['Push \u00b7 2', '\u22ee'])

    // Go commit did not vanish: it leads More, drawn as the buttons beside it.
    await narrow.press({ key: 'more' })
    expect(await buttonsOn(narrow)).toEqual([
      'Go commit',
      'Go backup',
      'Go commit and backup',
      'Go audit',
      'Go code review',
      'X',
    ])
    expect((await narrow.find({ key: 'go-commit' }))?.props.variant).toBeUndefined()
    await narrow.press({ key: 'go-commit' })
    expect(kit.world.prompts.map(prompt => prompt.text)).toEqual(['Go commit'])
    await narrow.unmount()
  })

  // The terminal draws its own collapse mark over the last cells of the band.
  test('on the terminal the row keeps clear of the collapse mark', async ($, on) => {
    const kit = install(on, { changed: 3, ahead: 2 })

    await start($, kit)

    // 72 cells are what the full row needs. On the terminal four of the 74
    // stay free for the mark, and the row is planned for the 70 that are left.
    const terminal = await bandOn($, 'terminal', 74)

    expect(await terminal.drawn()).toMatchObject({ type: 'Box', props: { paddingRight: 4 } })
    expect(await wordsOn(terminal)).toBe('site-web')
    await terminal.unmount()

    const roomy = await bandOn($, 'terminal', 76)

    expect(await wordsOn(roomy)).toBe('site-web')
    await roomy.unmount()

    // The desktop draws no such mark at the end. It keeps cells at the start
    // instead, for the drawing before the name.
    const desktop = await bandOn($, 'desktop', 76)

    expect(await desktop.drawn()).toMatchObject({ type: 'Box', props: { paddingRight: 0 } })
    expect(await wordsOn(desktop)).toBe('site-web')
    await desktop.unmount()

    // A push waiting for its OK and More keep clear of the mark too.
    const asking = await bandOn($, 'terminal', 84)

    await asking.press({ key: 'push' })
    expect(await asking.drawn()).toMatchObject({ type: 'Box', props: { paddingRight: 4 } })
    await kit.clock.advance(5_000)
    await asking.press({ key: 'more' })
    expect(await asking.drawn()).toMatchObject({ type: 'Box', props: { paddingRight: 4 } })
    await asking.unmount()
  })

  // The drawing before the name is for a surface that can show one.
  test('the mark is drawn before the name on the desktop and not on the terminal', async ($, on) => {
    const kit = install(on, { changed: 1 })

    await start($, kit)

    const desktop = await bandOn($, 'desktop')
    const marks = await desktop.findAll({ type: 'Svg' })

    expect(marks).toHaveLength(1)
    expect(marks[0]?.props).toMatchObject({ alt: 'Rotem E', width: 25, height: 25 })
    await desktop.press({ key: 'more' })
    expect(await desktop.findAll({ type: 'Svg' })).toHaveLength(1)
    await desktop.unmount()

    const terminal = await bandOn($, 'terminal')

    expect(await terminal.findAll({ type: 'Svg' })).toHaveLength(0)
    await terminal.unmount()
  })

  onEachSurface('keeps the label and Push at any width', async ($, on, surface) => {
    const kit = install(on, { changed: 3, ahead: 2 })

    kit.world.plugin.onlineHead = ONLINE_HEAD
    await start($, kit)

    for (const columns of [200, 120, 100, 80, 60, 40]) {
      const ui = await bandOn($, surface, columns)

      expect((await ui.find({ type: 'Text', text: 'site-web' }))?.text, `${columns} columns`).toBe('site-web')
      expect(await buttonsOn(ui)).toContain('Push \u00b7 2')
      await ui.unmount()
    }

    // Narrower than the label and the buttons together: the name is cut, and
    // the label and Push are both still there.
    for (const columns of [20, 8, 1]) {
      const ui = await bandOn($, surface, columns)

      expect((await ui.findAll({ type: 'Text' }))[0]?.text, `${columns} columns`).toBe('s\u2026')
      expect(await buttonsOn(ui)).toContain('Push \u00b7 2')
      await ui.unmount()
    }
  })

  // The name is 24 letters at the most. With Push and More beside it the
  // label then needs 43 cells, more than a narrow window has.
  onEachSurface('a long name gives way before Push does', async ($, on, surface) => {
    const kit = install(on, {
      changed: 3,
      ahead: 2,
      origin: 'https://github.com/example/Northwind-Traders-Europe-Holdings.git',
    })

    await start($, kit)

    const wide = await bandOn($, surface, 160)

    expect((await wide.findAll({ type: 'Text' }))[0]?.text).toBe('Northwind-Traders-Europ\u{2026}')
    await wide.unmount()

    for (const usable of [43, 42, 30, 26]) {
      const ui = await bandOn($, surface, width(surface, usable))
      const label = (await ui.findAll({ type: 'Text' }))[0]?.text ?? ''
      const buttons = await buttonsOn(ui)

      expect(buttons, `${usable} cells`).toEqual(['Push \u00b7 2', '\u22ee'])
      expect(label.startsWith('N'), `${usable} cells`).toBe(true)

      // The name and the buttons fit the cells there are, and no words are
      // squeezed in between them.
      expect(await ui.findAll({ type: 'Text' })).toHaveLength(1)
      expect(label.length + buttons.reduce((sum, text) => sum + 1 + text.length + 4, 0)).toBeLessThanOrEqual(usable)
      await ui.unmount()
    }

    const tight = await bandOn($, surface, width(surface, 30))

    expect((await tight.findAll({ type: 'Text' }))[0]?.text).toBe('Northwind-\u{2026}')
    await tight.unmount()
  })

  // With an update ready the row has Go commit in it at 67 cells. It needs
  // 61 once Go commit is behind More, and less with Update plugin there too.
  onEachSurface('folds Update plugin into More last, and it still asks first', async ($, on, surface) => {
    const kit = install(on, { changed: 3, ahead: 2 })

    kit.world.plugin.onlineHead = ONLINE_HEAD
    await start($, kit)

    const roomy = await bandOn($, surface, width(surface, 67))

    expect(await buttonsOn(roomy)).toEqual(['Go commit \u00b7 3', 'Push \u00b7 2', 'Update plugin \u00b7 1', '\u22ee'])
    await roomy.unmount()

    const tighter = await bandOn($, surface, width(surface, 61))

    expect(await buttonsOn(tighter)).toEqual(['Push \u00b7 2', 'Update plugin \u00b7 1', '\u22ee'])
    await tighter.unmount()

    const ui = await bandOn($, surface, width(surface, 60))

    expect(await wordsOn(ui)).toBe('site-web | 3 to commit')
    expect(await buttonsOn(ui)).toEqual(['Push \u00b7 2', '\u22ee'])
    await ui.press({ key: 'more' })
    expect(await buttonsOn(ui)).toContain('Update plugin \u00b7 1')
    await ui.press({ key: 'update-plugin' })
    expect(gitRuns(kit.world, 'pull')).toHaveLength(0)
    expect(await buttonsOn(ui)).toEqual(['Cancel', 'Update'])
    await ui.unmount()
  })

  onEachSurface('lets the words be cut before anything else gives way', async ($, on, surface) => {
    const kit = install(on, { changed: 3, ahead: 2 })

    await start($, kit)

    const ui = await bandOn($, surface, width(surface, 40))
    const words = await ui.find({ type: 'Text', text: '3 to commit' })

    expect(words?.props.wrap).toBe('truncate-end')
    await ui.unmount()
  })

  // The label is 8 cells and Push and More take 19. Beside them the words
  // need their own cell of space and at least 8 cells to say anything.
  onEachSurface('leaves the words out when too few cells are left to read them in', async ($, on, surface) => {
    const kit = install(on, { changed: 3, ahead: 2 })

    await start($, kit)

    const enough = await bandOn($, surface, width(surface, 36))

    expect(await wordsOn(enough)).toBe('site-web | 3 to commit')
    await enough.unmount()

    const tooFew = await bandOn($, surface, width(surface, 35))

    expect(await wordsOn(tooFew)).toBe('site-web')
    expect(await buttonsOn(tooFew)).toEqual(['Push \u00b7 2', '\u22ee'])
    await tooFew.unmount()
  })
})

describe('a new conversation in the same window', () => {
  // /clear, a resume, a compaction or a fork puts another conversation in the
  // window with no session start, and the window's values start empty. The
  // row must not wait for the timer or the next finished turn.
  for (const source of ['clear', 'resume', 'compact', 'fork'] as const) {
    test(`after ${source} the row is gathered again at once`, async ($, on) => {
      const kit = install(on, { changed: 3, ahead: 2 })

      await start($, kit)

      const ui = await bandOn($, 'terminal')

      kit.world.changed = 7
      await $.classic.SessionStart({ source, cwd: kit.world.folder })
      await kit.clock.settle()

      // No turn ended and the clock did not move: the hook alone did it.
      expect(await wordsOn(ui)).toBe('site-web')
      await ui.unmount()
    })
  }

  test('the start of the process itself adds no pass of its own', async ($, on) => {
    const kit = install(on, { changed: 3 })

    await start($, kit)

    const before = kit.world.git.length

    await $.classic.SessionStart({ source: 'startup', cwd: kit.world.folder })
    await kit.clock.settle()
    expect(kit.world.git.length).toBe(before)
  })

  test('in a window nobody looked at it still runs no git', async ($, on) => {
    const kit = install(on, { changed: 3 })

    await open($, kit)
    await $.classic.SessionStart({ source: 'clear', cwd: kit.world.folder })
    await kit.clock.settle()
    expect(kit.world.git).toEqual([])
  })

  test('a push waiting for its OK is not taken away by a compaction', async ($, on) => {
    const kit = install(on, { ahead: 2 })

    await start($, kit)

    const ui = await bandOn($, 'desktop')

    await ui.press({ key: 'push' })
    await $.classic.SessionStart({ source: 'compact', cwd: kit.world.folder })
    await kit.clock.settle()
    expect(await buttonsOn(ui)).toEqual(['Approve', '\u22ee'])
    await ui.unmount()
  })
})

describe('a write Claude Code refuses for a moment', () => {
  // A stored value cannot be written in the moment in which a row is being
  // drawn. The band waits a little and tries again.
  onEachSurface('is tried again and lands', async ($, on, surface) => {
    const kit = install(on, { changed: 2 })

    await start($, kit)

    const ui = await bandOn($, surface)

    kit.world.refusals = 2

    const pressing = ui.press({ key: 'more' })

    await kit.clock.advance(30)
    await kit.clock.advance(30)
    await pressing
    expect(await buttonsOn(ui)).toContain('X')
    expect(kit.world.refusals).toBe(0)
    await ui.unmount()
  })

  onEachSurface('is given up after a few tries, and the next press works again', async ($, on, surface) => {
    const kit = install(on, { changed: 2 })

    await start($, kit)

    const ui = await bandOn($, surface)

    kit.world.refusals = 5

    const pressing = ui.press({ key: 'more' })

    await kit.clock.advance(200)
    await pressing
    expect(await buttonsOn(ui)).toEqual(['Go commit \u00b7 2', '\u22ee'])
    expect(kit.world.logs.some(line => line.includes('opening More failed'))).toBe(true)

    await ui.press({ key: 'more' })
    expect(await buttonsOn(ui)).toContain('X')
    await ui.unmount()
  })

  onEachSurface('a busy mark that could not be cleared is put right by the next pass', async ($, on, surface) => {
    const kit = install(on, { ahead: 2, push: { code: 0, err: '', delayMs: 1_000 } })

    await start($, kit)

    const ui = await bandOn($, surface)

    await ui.press({ key: 'push' })
    await answerYes(kit, ui, 'confirm-push')
    expect((await ui.find({ key: 'push' }))?.props.label).toBe('Pushing...')

    // The push ends, and every try to clear its mark is refused.
    kit.world.refusals = 5
    await kit.clock.advance(1_000)
    await kit.clock.advance(200)
    expect(kit.world.toasts).toEqual(['Pushed 2 commits'])
    expect(kit.world.logs.some(line => line.includes('clearing the busy mark failed'))).toBe(true)

    // The pass that follows a push writes what is really running: nothing.
    expect(await buttonsOn(ui)).toEqual(['\u22ee'])
    await ui.unmount()
  })

  test('a pass whose write was refused lands on the retry', async ($, on) => {
    const kit = install(on, { changed: 2 })

    await start($, kit)

    const ui = await bandOn($, 'terminal')

    kit.world.changed = 4
    kit.world.refusals = 1
    await endTurn($, kit)
    expect(await buttonsOn(ui)).toContain('Go commit \u00b7 2')

    await kit.clock.advance(30)
    expect(await buttonsOn(ui)).toContain('Go commit \u00b7 4')
    await ui.unmount()
  })
})

describe('good manners', () => {
  onEachSurface('yields the band to a survey', async ($, on, surface) => {
    const kit = install(on, { changed: 3 })

    await start($, kit)

    const ui = await bandOn($, surface, 160, true)

    expect(await ui.drawn()).toEqual({ type: 'engine', ref: 0 })
    await ui.unmount()
  })

  onEachSurface('keeps what another mod draws in the band, above its own row', async ($, on, surface) => {
    const kit = install(on, { changed: 3, beneath: { type: 'Text', children: ['another mod'] } })

    await start($, kit)

    const ui = await bandOn($, surface)

    expect(await wordsOn(ui)).toBe('another mod | site-web')
    await ui.unmount()
  })

  onEachSurface('draws nothing before the session has started', async ($, on, surface) => {
    const kit = install(on)

    const ui = await bandOn($, surface)

    expect(await ui.drawn()).toEqual({ type: 'engine', ref: 0 })

    // The look came first and the start after it: the row still fills in.
    await open($, kit)
    expect(await wordsOn(ui)).toBe('site-web | All committed')
    await ui.unmount()
  })

  test('the session starts and a turn ends unchanged even when everything fails', async ($, on) => {
    const kit = install(on, {
      silent: ['rev-parse', 'status', 'ls-remote', 'symbolic-ref', 'config'],
      files: {},
    })

    expect(await $.session.start({ cwd: kit.world.folder, surface: 'terminal', isInteractive: true })).toEqual({
      cwd: kit.world.folder,
    })
    await kit.clock.settle()
    expect(
      await $.turn.complete({
        answer: 'Done.',
        durationMs: 10,
        isAborted: false,
        turnId: 'turn-9',
        reason: 'answer',
      }),
    ).toMatchObject({ text: 'Done.' })
    expect(await $.classic.SessionStart({ source: 'clear', cwd: kit.world.folder })).toEqual({})
    await kit.clock.settle()

    const ui = await bandOn($, 'terminal')

    await kit.clock.settle()
    // With git silent the row still names the folder, and nothing else.
    expect(await wordsOn(ui)).toBe('Site')
    await ui.unmount()
  })

  onEachSurface('writes no long dash anywhere on screen', async ($, on, surface) => {
    const kit = install(on, {
      changed: 3,
      ahead: 2,
      push: { code: 1, err: 'error: something odd happened', delayMs: 0 },
    })

    kit.world.plugin.onlineHead = ONLINE_HEAD
    await start($, kit)

    const seen: string[] = []

    for (const columns of [200, 70, 30]) {
      const ui = await bandOn($, surface, columns)

      seen.push(await wordsOn(ui), ...(await buttonsOn(ui)))
      await ui.unmount()
    }

    const ui = await bandOn($, surface)

    await ui.press({ key: 'push' })
    seen.push(await wordsOn(ui), ...(await buttonsOn(ui)))
    await answerYes(kit, ui, 'confirm-push')
    await ui.press({ key: 'update-plugin' })
    seen.push(await wordsOn(ui), ...(await buttonsOn(ui)))
    await ui.press({ key: 'cancel' })
    await ui.press({ key: 'more' })
    seen.push(await wordsOn(ui), ...(await buttonsOn(ui)))
    await ui.press({ key: 'cancel' })

    // The words for a project that is pushed from the git app, and its toast.
    kit.world.present = ['D:/Work/Site/.git/hooks/pre-push']
    await ui.press({ key: 'push' })
    await endTurn($, kit)
    seen.push(await wordsOn(ui))
    seen.push(...kit.world.toasts)
    expect(kit.world.toasts).toEqual([
      'Push did not go through: git reported a problem. Nothing changed.',
      'This project has push steps of its own. Push it from your git app.',
    ])

    for (const text of seen) {
      expect(text).not.toMatch(/[\u2012\u2013\u2014\u2015]|--/)
    }

    await ui.unmount()
  })
})
