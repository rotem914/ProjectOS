// Wrap-up.test.ts - tests for the refusal of a wrap-up box that carries a
// question, the third part of hooks/Reply-check.ts.
//
// Run with the engine itself, from anywhere:
//
//   claude plugin test <the plugin folder>
//
// Two layers, as in Full-links.test.ts. The reading of a call is pure, so the
// first half calls it directly. The second half drives the hook through the
// engine, with a disk and the app's own tool standing in beneath the plugin,
// once as the terminal and once as the desktop app.
import type { On, RenderSurface } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { WRAP_UP_TOOL, wrapUpAsks } from '../hooks/Reply-check'

// ---------------------------------------------------------------------------
// Reading a call, called directly
// ---------------------------------------------------------------------------

describe('reading a wrap-up call', () => {
  test('the recap alone carries no question', () => {
    expect(wrapUpAsks({ tool: 'wrap_up', tool_use_id: 't1', recap: 'The lock is in. Both suites pass.' })).toBeNull()
    expect(wrapUpAsks({ tool: 'wrap_up', summary: 'Done.', question: '', options: [], buttons: {} })).toBeNull()
  })

  test('a question or its answers, by name, is one', () => {
    expect(wrapUpAsks({ tool: 'wrap_up', recap: 'Done.', question: 'Push now' })).toBe('its question')
    expect(wrapUpAsks({ tool: 'wrap_up', recap: 'Done.', options: ['Yes', 'No'] })).toBe('its options')
    expect(wrapUpAsks({ tool: 'wrap_up', recap: 'Done.', buttons: [{ label: 'Approve' }] })).toBe('its buttons')
  })

  test('a line that ends on a question mark is one, wherever it sits', () => {
    expect(wrapUpAsks({ tool: 'wrap_up', recap: 'Done.\nShall I push?' })).toBe('a question in its recap')
    expect(wrapUpAsks({ tool: 'wrap_up', recap: 'Done.', next: { text: 'Which one do you want?' } })).toBe(
      'a question in its next',
    )
    expect(wrapUpAsks({ tool: 'wrap_up', recap: 'Done. (Is it?)' })).toBe('a question in its recap')
    expect(wrapUpAsks({ tool: 'wrap_up', recap: 'Ready?  ' })).toBe('a question in its recap')
  })

  test('a question mark inside a sentence is no question at the end', () => {
    expect(wrapUpAsks({ tool: 'wrap_up', recap: 'The "why?" column is filled. Two rows wait.' })).toBeNull()
  })

  test('the keys of the call itself are never read', () => {
    expect(wrapUpAsks({ tool: 'wrap_up', tool_use_id: 'why?', consent: 'Pressed "Yes?"', recap: 'Done.' })).toBeNull()
  })

  test('the tool is known by its name in either spelling', () => {
    expect(WRAP_UP_TOOL.test('wrap_up')).toBe(true)
    expect(WRAP_UP_TOOL.test('mcp__ccd_session__wrap_up')).toBe(true)
    expect(WRAP_UP_TOOL.test('WrapUp')).toBe(true)
    expect(WRAP_UP_TOOL.test('Bash')).toBe(false)
    expect(WRAP_UP_TOOL.test('wrap_up_later')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The hook, through the engine
// ---------------------------------------------------------------------------

const ROOT = '/work/site'
const RULES_PATH = `${ROOT}/project-os/Conversations.md`
const WRAP_UP_RULE = "The app's wrap-up box carries the recap only, never a question or buttons."
const DASH_RULE = 'Never write a dash longer than a hyphen.'

// A path as the test wrote it: the engine hands a hook the path resolved for
// the machine it runs on, with that machine's separators and drive.
const place = (path: string): string => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

type Call = Readonly<Record<string, unknown>>

/**
 * Stands in for everything beneath the plugin: a disk holding `files`, the
 * environment, the engine's own end of each event the tests raise, and the
 * app's wrap-up tool, which records every call that reaches it.
 */
const world = (on: On, files: Readonly<Record<string, string>>) => {
  const reached: Call[] = []

  mock.clock(on)
  mock.env(on, { HOME: '/home/dana' })
  on('fs.exists', (_$, e) => ({ value: Object.hasOwn(files, place(e.path)) }))
  on('fs.read', (_$, e) => {
    const text = files[place(e.path)]

    return text === undefined ? { deny: `cannot read ${e.path}` } : { value: text }
  })
  on('fs.list', () => ({ deny: 'no such folder' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', (_$, e) => {
    reached.push(e as unknown as Call)

    return { result: 'shown' }
  })

  return { reached }
}

const open = ($: Engine, surface: RenderSurface) =>
  $.session.start({ cwd: ROOT, surface, isInteractive: true })

/** The app's wrap-up call, as the model would make it. */
const wrapUp = ($: Engine, args: Call) => $.tool.call({ tool: 'mcp__app__wrap_up', ...args } as never)

const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]

const onEachSurface = (name: string, body: ($: Engine, on: On, surface: Surface) => Promise<void>): void => {
  for (const surface of SURFACES) test(`${name}, on ${surface}`, ($, on) => body($, on, surface))
}

const WITH_RULE = { [RULES_PATH]: `${DASH_RULE}\n${WRAP_UP_RULE}` }

describe('the wrap-up box through the engine', () => {
  onEachSurface('a call that carries a question is refused, with the reason', async ($, on, surface) => {
    const { reached } = world(on, WITH_RULE)
    await open($, surface)

    const answer = await wrapUp($, { recap: 'The lock is in.', question: 'Push it now?', options: ['Yes', 'No'] })
    expect('deny' in answer ? answer.deny : '').toMatch(/carries the recap only.*this call carries its question/)
    expect(reached).toEqual([])
  })

  onEachSurface('a question inside the recap is refused too', async ($, on, surface) => {
    const { reached } = world(on, WITH_RULE)
    await open($, surface)

    const answer = await wrapUp($, { recap: 'The lock is in.\nShall I push it?' })
    expect('deny' in answer ? answer.deny : '').toMatch(/a question in its recap/)
    expect(reached).toEqual([])
  })

  onEachSurface('the recap alone reaches the app', async ($, on, surface) => {
    const { reached } = world(on, WITH_RULE)
    await open($, surface)

    const answer = await wrapUp($, { recap: 'The lock is in. Both suites pass.', question: '' })
    expect('deny' in answer).toBe(false)
    expect(reached.map(call => call.recap)).toEqual(['The lock is in. Both suites pass.'])
  })

  onEachSurface('a project whose rules say nothing of the box lets every call through', async ($, on, surface) => {
    const { reached } = world(on, { [RULES_PATH]: DASH_RULE })
    await open($, surface)

    const answer = await wrapUp($, { recap: 'Done.', question: 'Push it now?' })
    expect('deny' in answer).toBe(false)
    expect(reached).toHaveLength(1)
  })

  onEachSurface('a folder with no rules file lets every call through', async ($, on, surface) => {
    const { reached } = world(on, {})
    await open($, surface)

    const answer = await wrapUp($, { recap: 'Done.', question: 'Push it now?' })
    expect('deny' in answer).toBe(false)
    expect(reached).toHaveLength(1)
  })
})
