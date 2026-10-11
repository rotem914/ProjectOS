// Full-links.test.ts - tests for the live fix of half links and half paths,
// the second fix in hooks/Reply-check.ts.
//
// Run with the engine itself, from anywhere:
//
//   claude plugin test <the plugin folder>
//
// Two layers, as in Reply-check.test.ts. The text work is pure, so the first
// half calls it directly, with a place standing for a Windows project and one
// for a POSIX project. The second half drives the hook through the engine,
// with a disk, a listing and an environment standing in beneath the plugin,
// once as the terminal and once as the desktop app.
import type { Args, On, RenderSurface } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { fullLinksIn, readReplyRules } from '../hooks/Reply-check'
import type { Place } from '../hooks/Reply-check'

const EN = '\u{2013}'

// ---------------------------------------------------------------------------
// The links fix, called directly
// ---------------------------------------------------------------------------

const WINDOWS: Place = {
  root: 'J:\\Projects\\Rotem E',
  roots: new Set(['project-os', 'src', '.tmp', 'scripts', 'share']),
  home: 'C:\\Users\\User',
  address: 'http://localhost:4321',
}
const POSIX: Place = {
  root: '/home/dana/site',
  roots: new Set(['src']),
  home: '/home/dana',
  address: null,
}

describe('the links fix, called directly', () => {
  test('a route gets the project address, in prose, in code and in a link target', () => {
    expect(fullLinksIn('/dev/outreach-ideas', WINDOWS)).toBe('http://localhost:4321/dev/outreach-ideas')
    expect(fullLinksIn('See `/dev/x` and [here](/dev/y).', WINDOWS)).toBe(
      'See `http://localhost:4321/dev/x` and [here](http://localhost:4321/dev/y).',
    )
    expect(fullLinksIn('Open /llms.txt now.', WINDOWS)).toBe('Open http://localhost:4321/llms.txt now.')
  })

  test('a slash command and a lone plain segment are not routes, nor is a route without an address', () => {
    expect(fullLinksIn('Press /compact, or /about.', WINDOWS)).toBe('Press /compact, or /about.')
    expect(fullLinksIn('/dev/x', POSIX)).toBe('/dev/x')
  })

  test('a host without its scheme gets one', () => {
    expect(fullLinksIn('rotem-e.com/about and localhost:4321/dev/x and localhost:4321', WINDOWS)).toBe(
      'https://rotem-e.com/about and http://localhost:4321/dev/x and http://localhost:4321',
    )
    expect(fullLinksIn('v1.2/notes stays', WINDOWS)).toBe('v1.2/notes stays')
  })

  test('a path relative to the project gets the project folder, written for this computer', () => {
    expect(fullLinksIn('The row is in `project-os/History.md`.', WINDOWS)).toBe(
      'The row is in `J:\\Projects\\Rotem E\\project-os\\History.md`.',
    )
    expect(fullLinksIn('.tmp/strip-waits.py, ./src/x.ts, src\\lib\\y.ts, src/', WINDOWS)).toBe(
      'J:\\Projects\\Rotem E\\.tmp\\strip-waits.py, J:\\Projects\\Rotem E\\src\\x.ts, ' +
        'J:\\Projects\\Rotem E\\src\\lib\\y.ts, J:\\Projects\\Rotem E\\src\\',
    )
    expect(fullLinksIn('src/x.ts and ~/notes.md', POSIX)).toBe('/home/dana/site/src/x.ts and /home/dana/notes.md')
    expect(fullLinksIn('~/.claude/skills', WINDOWS)).toBe('C:\\Users\\User\\.claude\\skills')
  })

  test('a first folder the project does not have is left as written, and so is what is no path', () => {
    expect(fullLinksIn('mods/hooks/Project-band.tsx in the kit', WINDOWS)).toBe(
      'mods/hooks/Project-band.tsx in the kit',
    )
    const plain = 'and/or, 24/7, fix/drop/backlog, e.g./i.e., origin/main, ../up, Scripts/x on a Mac'
    expect(fullLinksIn(plain, POSIX)).toBe(plain)
  })

  test('what is full already is left alone, a space inside it included', () => {
    const full =
      'Open http://localhost:4321/dev/x or `J:\\Projects\\Rotem E\\src\\x.md` then https://rotem-e.com/about'
    expect(fullLinksIn(full, WINDOWS)).toBe(full)
    expect(fullLinksIn('cd "J:\\Projects\\Rotem E"; node project-os/Find-heavy-files.mjs', WINDOWS)).toBe(
      'cd "J:\\Projects\\Rotem E"; node J:\\Projects\\Rotem E\\project-os\\Find-heavy-files.mjs',
    )
  })

  test('the rule is read in both spellings the kit has used, and "full report" is not it', () => {
    expect(readReplyRules('A named route is the FULL absolute address, never a bare path.').hasFullLinkRule).toBe(true)
    expect(readReplyRules('EVERY path is the FULL path from the\ndrive root.').hasFullLinkRule).toBe(true)
    expect(readReplyRules('It lifts ONLY on his report phrases: `full report`.').hasFullLinkRule).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The hook, through the engine
// ---------------------------------------------------------------------------

type RowInput = Args<'session.append'>
type Content = RowInput['message']['content']

const ROOT = '/work/site'
const RULES_PATH = `${ROOT}/project-os/Conversations.md`
const CLAUDE_PATH = `${ROOT}/CLAUDE.md`
const LINK_RULE =
  'A named route is the FULL absolute address, never a bare path.\n' +
  'A file path is the FULL absolute path, never a project-relative one.'
const DASH_RULE = 'Never write a dash longer than a hyphen.'
const ADDRESS_LINE = 'Local app URL: `http://localhost:4321` (editor at `/keystatic`, dev only).'

// A path as the test wrote it: the engine hands a hook the path resolved for
// the machine it runs on, with that machine's separators and drive.
const place = (path: string): string => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

/**
 * Stands in for everything beneath the plugin: a disk holding `files`, a
 * listing of the project folder (`names`, or none when the disk refuses), the
 * environment, and the engine's own end of each event the tests raise.
 */
const world = (on: On, files: Readonly<Record<string, string>>, names: readonly string[] | null = ['src', 'project-os']) => {
  const kept: RowInput[] = []

  mock.clock(on)
  mock.env(on, { HOME: '/home/dana' })
  on('fs.exists', (_$, e) => ({ value: Object.hasOwn(files, place(e.path)) }))
  on('fs.read', (_$, e) => {
    const text = files[place(e.path)]

    return text === undefined ? { deny: `cannot read ${e.path}` } : { value: text }
  })
  on('fs.list', (_$, e) =>
    names === null || place(e.path ?? '') !== ROOT
      ? { deny: 'no such folder' }
      : { value: names.map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })) },
  )
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('ui.status', () => ({ value: undefined }))
  on('session.append', (_$, e, next) => {
    kept.push(e)

    return next(e)
  })

  return { kept }
}

const open = ($: Engine, surface: RenderSurface) =>
  $.session.start({ cwd: ROOT, surface, isInteractive: true })

const text = (value: string) => ({ type: 'text', text: value })

let rowsMade = 0
/** A block of the model's reply, as the engine appends it. */
const row = (content: Content, extra: Partial<RowInput> = {}): RowInput => {
  rowsMade += 1

  return {
    message: { type: 'assistant', role: 'assistant', content },
    door: 'response',
    origin: { kind: 'model', model: 'claude-test' },
    uuid: `row-${rowsMade}`,
    ...extra,
  }
}

// The test kit keeps no store beneath session.append: a row runs the whole
// chain down to the test's own hook, and the call then rejects for want of a
// store. What reached that hook is the row the conversation would keep.
const keep = async ($: Engine, input: RowInput): Promise<void> => {
  await $.session.append(input).then(
    () => undefined,
    (error: unknown) => {
      if (!String(error).includes('no implementation for session.append')) throw error
    },
  )
}

const keptText = (kept: readonly RowInput[]): unknown =>
  kept.at(-1)?.message.content.map(block => block.text)

const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]

const onEachSurface = (name: string, body: ($: Engine, on: On, surface: Surface) => Promise<void>): void => {
  for (const surface of SURFACES) test(`${name}, on ${surface}`, ($, on) => body($, on, surface))
}

const FULL_PROJECT = { [RULES_PATH]: `${LINK_RULE}\n${DASH_RULE}`, [CLAUDE_PATH]: ADDRESS_LINE }

describe('the links fix as the reply is kept', () => {
  onEachSurface('a half link and a half path are written out, beside the dash fix', async ($, on, surface) => {
    const { kept } = world(on, FULL_PROJECT)
    await open($, surface)

    await keep($, row([text(`See /dev/x and src/a.ts, pages 3${EN}5.`)]))
    expect(keptText(kept)).toEqual(['See http://localhost:4321/dev/x and /work/site/src/a.ts, pages 3-5.'])
  })

  onEachSurface('a project whose rules do not ask for full links keeps the reply as it came', async ($, on, surface) => {
    const { kept } = world(on, { [RULES_PATH]: DASH_RULE, [CLAUDE_PATH]: ADDRESS_LINE })
    await open($, surface)

    await keep($, row([text('See /dev/x and src/a.ts.')]))
    expect(keptText(kept)).toEqual(['See /dev/x and src/a.ts.'])
  })

  onEachSurface('without an address in CLAUDE.md the routes stay, and the paths are still written out', async ($, on, surface) => {
    const { kept } = world(on, { [RULES_PATH]: LINK_RULE })
    await open($, surface)

    await keep($, row([text('See /dev/x and src/a.ts and ~/notes.md.')]))
    expect(keptText(kept)).toEqual(['See /dev/x and /work/site/src/a.ts and /home/dana/notes.md.'])
  })

  onEachSurface('a listing the disk refuses leaves relative paths as written, and a host still gets its scheme', async ($, on, surface) => {
    const { kept } = world(on, FULL_PROJECT, null)
    await open($, surface)

    await keep($, row([text('See src/a.ts and rotem-e.com/about and /dev/x.')]))
    expect(keptText(kept)).toEqual(['See src/a.ts and https://rotem-e.com/about and http://localhost:4321/dev/x.'])
  })

  onEachSurface("a subagent's reply is left alone", async ($, on, surface) => {
    const { kept } = world(on, FULL_PROJECT)
    await open($, surface)

    await keep($, row([text('See /dev/x and src/a.ts.')], { agentId: 'helper-1' }))
    expect(keptText(kept)).toEqual(['See /dev/x and src/a.ts.'])
  })
})
