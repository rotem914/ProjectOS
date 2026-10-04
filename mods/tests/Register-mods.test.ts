// Tests for the module that switches the parts on (hooks/Register-mods.tsx).
//
// Two layers. The first calls the module's own `register` directly, with a
// stand-in for Claude Code's `on` that throws for the events a test names:
// that is the one way to make a part fail while it registers, and to see
// that the other part still loads. The second runs the plugin through the
// engine itself, loaded from its folder as a session loads it, and shows the
// two parts working in one session, once as the terminal and once as the
// desktop app.
//
// What the guards do not cover, and no test here can show: Claude Code reads
// the module's source before it runs it, and when that reading finds
// something it does not accept, an event it no longer has for one, it
// refuses the whole module. `register` never runs then, so both parts are
// off together. A plugin has one hooks module, so the parts cannot be loaded
// apart. The guards are for a part that throws once `register` does run.
//
// Every long dash the tests need as data is written as an escape, so this
// file holds none.

import type { Args, EngineInterface, On, RenderElement } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { register } from '../hooks/Register-mods'

const PLUGIN = 'time'
const SURFACES = ['terminal', 'desktop'] as const
const EM = '\u{2014}'

type Surface = (typeof SURFACES)[number]

// THE GUARDS, CALLED DIRECTLY

type Registered = { event: string; matcher: unknown; hook: unknown }

type StartInput = Args<'session.start'>

/** The hook this module adds when a part was left out, as a plain function. */
type NoteHook = (
  $: EngineInterface,
  e: StartInput,
  next: (e: StartInput) => Promise<{ cwd: string }>,
) => unknown

// The events only one of the two parts hooks, so a throw on one of them fails
// that part and no other.
const BAND_ONLY = 'ui.render'
const REPLY_ONLY = 'session.append'

/**
 * Stands in for the `on` Claude Code hands to `register`: it keeps what was
 * registered, and throws for the events the test names. Claude Code itself
 * turns an unknown event down earlier, when it reads the module, and then
 * loads no part at all; a throw from `on` is what is left for a guard to
 * catch.
 */
const standIn = (refuse: (event: string) => unknown = () => undefined) => {
  const registered: Registered[] = []
  const on = ((event: string, ...rest: unknown[]) => {
    const refusal = refuse(event)
    if (refusal !== undefined) throw refusal

    registered.push({
      event,
      matcher: rest.length === 2 ? rest[0] : undefined,
      hook: rest.at(-1),
    })

    return { catch: () => undefined }
  }) as unknown as On

  return { on, registered }
}

const eventsOf = (registered: readonly Registered[]): string[] =>
  registered.map(one => one.event)

/** Runs the note hook as a session start would, and keeps what it logged. */
const runNote = async (hook: unknown, log?: (text: string) => void) => {
  const logged: Array<{ text: string; options: unknown }> = []
  const $ = {
    ui: {
      log: (text: string, options: unknown) => {
        log?.(text)
        logged.push({ text, options })
      },
    },
  } as unknown as EngineInterface
  const start: StartInput = { cwd: '/work/site', surface: null, isInteractive: false }
  const handed: StartInput[] = []
  const answer = await (hook as NoteHook)($, start, async e => {
    handed.push(e)

    return { cwd: e.cwd }
  })

  return { logged, answer, handed, start }
}

describe('the guards around each part', () => {
  test('both parts register, and nothing more is added on a normal day', () => {
    const { on, registered } = standIn()

    expect(register(on, {})).toBeUndefined()

    // Five hooks from the band, then two from the dash fix.
    expect(eventsOf(registered)).toEqual([
      'session.start',
      'classic.SessionStart',
      'prompt.submit',
      'turn.complete',
      'ui.render',
      'session.start',
      'session.append',
    ])
  })

  test('the band opens no pane any more: its questions are asked in the row', () => {
    const { on, registered } = standIn()

    register(on, {})

    // A pane needs a hook on its drawing and one on its closing. Neither is
    // registered: the one drawing left is the band above the message box.
    expect(eventsOf(registered)).not.toContain('ui.close')
    expect(registered.filter(one => one.event === 'ui.render').map(one => one.matcher)).toEqual([
      { component: 'AbovePrompt' },
    ])
  })

  test('only the band hears of a new conversation in the same window', () => {
    const { on, registered } = standIn()

    register(on, {})

    // The band gathers again after /clear, a resume, a compaction or a fork.
    // The dash fix keeps nothing from one conversation to the next, so it
    // has no hook there.
    expect(registered.filter(one => one.event === 'classic.SessionStart').map(one => one.matcher)).toEqual([
      { source: ['clear', 'resume', 'compact', 'fork'] },
    ])
  })

  test('every hook carries a matcher, so the parts can share an event', () => {
    const { on, registered } = standIn()

    register(on, {})

    for (const one of registered) {
      expect(one.matcher, one.event).toBeDefined()
      expect(typeof one.hook, one.event).toBe('function')
    }
  })

  test('the band throwing while it registers leaves the reply check on', async () => {
    const { on, registered } = standIn(event =>
      event === BAND_ONLY ? new Error('on("ui.render") threw') : undefined,
    )

    expect(register(on, {})).toBeUndefined()

    // What the band registered before it failed, the whole reply check, and
    // the one hook that writes the failure down.
    expect(eventsOf(registered)).toEqual([
      'session.start',
      'classic.SessionStart',
      'prompt.submit',
      'turn.complete',
      'session.start',
      'session.append',
      'session.start',
    ])

    const note = registered.at(-1)

    expect(note?.matcher).toEqual({ isInteractive: [true, false] })

    const { logged, answer, handed, start } = await runNote(note?.hook)

    expect(logged).toEqual([
      {
        text: 'the band above the message box was left out: on("ui.render") threw',
        options: { to: 'debug' },
      },
    ])
    // The session start is handed on as it came, and its answer comes back.
    expect(handed).toEqual([start])
    expect(answer).toEqual({ cwd: '/work/site' })
  })

  test('the reply check throwing while it registers leaves the band on', async () => {
    const { on, registered } = standIn(event =>
      event === REPLY_ONLY ? new Error('on("session.append") threw') : undefined,
    )

    expect(register(on, {})).toBeUndefined()
    expect(eventsOf(registered)).toEqual([
      'session.start',
      'classic.SessionStart',
      'prompt.submit',
      'turn.complete',
      'ui.render',
      'session.start',
      'session.start',
    ])

    const { logged } = await runNote(registered.at(-1)?.hook)

    expect(logged).toEqual([
      {
        text: 'the live reply check was left out: on("session.append") threw',
        options: { to: 'debug' },
      },
    ])
  })

  test('both parts failing is written down as two lines', async () => {
    const { on, registered } = standIn(event =>
      event === BAND_ONLY || event === REPLY_ONLY ? new Error(`no ${event}`) : undefined,
    )

    expect(register(on, {})).toBeUndefined()

    const { logged } = await runNote(registered.at(-1)?.hook)

    expect(logged.map(line => line.text)).toEqual([
      'the band above the message box was left out: no ui.render',
      'the live reply check was left out: no session.append',
    ])
  })

  test('when every hook throws, register still returns quietly', () => {
    const { on, registered } = standIn(event => new Error(`no ${event}`))

    expect(register(on, {})).toBeUndefined()
    expect(registered).toEqual([])
  })

  test('the reason is one short line, whatever was thrown', async () => {
    const long = standIn(event =>
      event === BAND_ONLY ? new Error(`first line\n  second line ${'x'.repeat(2_000)}`) : undefined,
    )

    register(long.on, {})

    const [line] = (await runNote(long.registered.at(-1)?.hook)).logged

    expect(line?.text).toStartWith(
      'the band above the message box was left out: first line second line xxx',
    )
    expect(line?.text).not.toMatch(/[\r\n]/)
    expect(line?.text.length).toBeLessThanOrEqual(
      'the band above the message box was left out: '.length + 300,
    )

    // Something thrown that is not an error is written down as it reads.
    const bare = standIn(event => (event === REPLY_ONLY ? 'refused by policy' : undefined))

    register(bare.on, {})
    expect((await runNote(bare.registered.at(-1)?.hook)).logged.map(one => one.text)).toEqual([
      'the live reply check was left out: refused by policy',
    ])
  })

  test('a debug log that cannot be written never stops a session start', async () => {
    const { on, registered } = standIn(event =>
      event === BAND_ONLY || event === REPLY_ONLY ? new Error(`no ${event}`) : undefined,
    )

    register(on, {})

    const tried: string[] = []
    const { answer, handed } = await runNote(registered.at(-1)?.hook, text => {
      tried.push(text)
      throw new Error('the log is closed')
    })

    // Both lines were tried, and the session start went on all the same.
    expect(tried).toHaveLength(2)
    expect(handed).toHaveLength(1)
    expect(answer).toEqual({ cwd: '/work/site' })
  })

  test('what is written down holds no long dash', async () => {
    const { on, registered } = standIn(event =>
      event === BAND_ONLY || event === REPLY_ONLY ? new Error(`no ${event}`) : undefined,
    )

    register(on, {})

    for (const line of (await runNote(registered.at(-1)?.hook)).logged) {
      expect(line.text).not.toMatch(/[\u{2012}-\u{2015}]|-{2}/u)
    }
  })
})

// THE TWO PARTS IN ONE SESSION, THROUGH THE ENGINE

const FOLDER = 'D:\\Work\\Site'
const TOP = 'D:/Work/Site'

const PROJECT_RULES = [
  '### `Go commit`',
  'Commit everything.',
].join('\n')

const REPLY_RULES = [
  'Short by default: 3 prose lines, each at most 14 WORDS.',
  `Never write a dash longer than a hyphen: not \`${EM}\`.`,
].join('\n')

// What the engine itself draws in the band: nothing of its own.
const ENGINE_DRAWING: RenderElement = { type: 'engine', ref: 0 }

type RowInput = Args<'session.append'>

type Seen = {
  /** Every status line call, in order; undefined is a clear. */
  status: Array<string | undefined>
  /** The text blocks of every row as it reached the conversation's store. */
  kept: unknown[][]
  /** Every line the plugin wrote to a log. */
  logs: string[]
  /** How many times git's status was asked for. */
  statusRuns: number
}

// The engine hands a hook a path resolved for the computer it runs on, so a
// file of this world is known by the end of its path.
const endsWith = (asked: string, tail: string): boolean =>
  asked.replace(/\\/g, '/').toLowerCase().endsWith(tail.toLowerCase())

const answer = (code: number, out: string) => ({
  value: {
    exitCode: code,
    stdout: out,
    stderr: '',
    isStdoutTruncated: false,
    isStderrTruncated: false,
  },
})

/**
 * Stands in for everything beneath the plugin, for both parts at once: a
 * client profile, a git repository with two changed files, a CLAUDE.md with
 * one shortcut, and the reply rules the kit ships.
 */
const world = (on: On) => {
  const seen: Seen = { status: [], kept: [], logs: [], statusRuns: 0 }
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 3, 9, 0, 0) })

  mock.env(on, {
    CLAUDE_CONFIG_DIR: 'C:\\ClaudeConfigs\\Darrow',
    USERPROFILE: 'C:\\Users\\Dana',
  })
  mock.store(on, {})

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  on('session.root', () => ({ value: FOLDER }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('process.run', (_, e) => {
    const args = e.argv.slice(1)
    const command = args.find(arg => !arg.startsWith('-')) ?? ''

    if (command === 'rev-parse') return answer(0, `${TOP}\n.git\n`)
    if (command === 'symbolic-ref') return answer(0, 'main\n')
    if (command === 'for-each-ref') return answer(0, 'origin\trefs/heads/main\t\n')
    if (command === 'remote') return answer(0, 'https://github.com/example/site.git\n')
    if (command !== 'status') return answer(1, '')

    seen.statusRuns += 1

    return answer(0, ['? notes/one.txt', '? notes/two.txt', ''].join('\n'))
  })
  on('fs.exists', (_, e) => ({
    value: endsWith(e.path, '/Work/Site/project-os/Conversations.md'),
  }))
  on('fs.read', (_, e) => {
    if (endsWith(e.path, '/Work/Site/project-os/Conversations.md')) return { value: REPLY_RULES }
    if (endsWith(e.path, '/Work/Site/CLAUDE.md')) return { value: PROJECT_RULES }

    return { deny: `ENOENT: no such file, open '${e.path}'` }
  })
  on('ui.status', (_, e) => {
    // The band pins how long each reply took (`12s`, `2:36m`). That line is
    // the band's, so it is left out of what this suite counts.
    if (e.text === undefined || !/^(\d+s|\d+:\d\dm)$/.test(e.text)) {
      seen.status.push(e.text)
    }

    return { value: undefined }
  })
  on('ui.log', (_, e) => {
    seen.logs.push(e.text)

    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', () => ENGINE_DRAWING)
  on('session.append', (_, e, next) => {
    seen.kept.push(e.message.content.map(block => block.text))

    return next(e)
  })

  return { seen, clock }
}

// The test kit of these builds keeps no store beneath session.append: a row
// runs the whole chain down to the test's own hook, and the call then rejects
// for want of a store. What reached that hook is the row the conversation
// would keep, so the test reads it there and lets that one rejection go.
const keep = async ($: Engine, input: RowInput): Promise<void> => {
  await $.session.append(input).then(
    () => undefined,
    (error: unknown) => {
      if (!String(error).includes('no implementation for session.append')) throw error
    },
  )
}

const bandOn = ($: Engine, surface: Surface) =>
  $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'AbovePrompt',
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 12,
      bodyColumns: 160,
      scroll: { offset: 0, bodyRows: 12 },
      view: {},
    },
  })

describe('the two parts in one session', () => {
  for (const surface of SURFACES) {
    test(`the band draws and the reply is checked, side by side (${surface})`, async ($, on) => {
      const { seen, clock } = world(on)

      expect(await $.session.start({ cwd: FOLDER, surface, isInteractive: true })).toEqual({
        cwd: FOLDER,
      })
      await clock.settle()

      // Loaded as a session loads it, no part was left out. This comes
      // first: when a part fails to register, the line that says why is the
      // first thing a failing run of these tests shows.
      expect(seen.logs.filter(line => line.includes('was left out'))).toEqual([])

      // The band: the label, what is waiting, and the project's shortcut. The
      // first look at the row is what sends it to git.
      expect(seen.statusRuns).toBe(0)

      const ui = await bandOn($, surface)

      await clock.settle()

      const words = (await ui.findAll({ type: 'Text' })).map(one => one.text)
      const buttons = (await ui.findAll({ type: 'Button' })).map(one => String(one.props.label))

      expect(words).toEqual(['site'])
      expect(buttons).toEqual(['Go commit \u00b7 2'])

      // The dash fix, in the same session: the dash is fixed as the reply is
      // kept, and nothing is said about the reply's length.
      const reply = `Done ${EM} it works.\nLine two.\nLine three.\nLine four.`

      expect(await $.turn.start({ text: 'hello', turnId: 't1' })).toEqual({ turnId: 't1' })
      await keep($, {
        message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: reply }] },
        door: 'response',
        origin: { kind: 'model', model: 'claude-test' },
        uuid: `row-${surface}`,
      })

      const passesBefore = seen.statusRuns

      expect(
        await $.turn.complete({
          answer: reply,
          durationMs: 1,
          isAborted: false,
          turnId: 't1',
          reason: 'answer',
        }),
      ).toEqual({ text: reply })
      await clock.settle()

      expect(seen.kept).toEqual([['Done, it works.\nLine two.\nLine three.\nLine four.']])
      expect(seen.status).toEqual([])

      // The same end of turn sent the band for fresh values, and it still draws.
      expect(seen.statusRuns).toBe(passesBefore + 1)
      expect((await ui.find({ type: 'Text', text: 'site' }))?.text).toBe('site')

      // /clear puts a new conversation in the window with no session start.
      // The band hears of it, and the row is gathered again at once.
      expect(await $.classic.SessionStart({ source: 'clear', cwd: FOLDER })).toEqual({})
      await clock.settle()
      expect(seen.status).toEqual([])
      expect(seen.statusRuns).toBe(passesBefore + 2)
      expect((await ui.findAll({ type: 'Text' })).map(one => one.text)).toEqual(['site'])
      await ui.unmount()
    })
  }
})
