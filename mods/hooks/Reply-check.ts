// Reply-check.ts - the live fix for long dashes. In a project whose reply
// rules say a dash is never "longer than a hyphen", each block of the reply is
// rewritten as the conversation keeps it: a long dash between words becomes a
// comma, and one set tight between two words or numbers, a range, becomes a
// plain hyphen. It does nothing anywhere else.
//
// WHY LIVE. A check that runs after the reply can only correct the next one,
// because the owner has already read this one. A dash can be fixed before the
// reply is kept, so it is.
//
// ONLY THE DASH. This part first also counted each reply against the limits
// the project's rules state, and said what ran over in one status line beside
// the message box. The owner did not want that line (2026-10-03), so the
// counting is gone with it.
//
// WHICH PROJECTS. Only one with project-os/Conversations.md at or above the
// folder the session was opened in, and only when that file holds the dash
// rule. The file is looked for once, at session start, nearest folder first,
// and the answer is remembered. Everywhere else the hook hands its event
// straight on.
//
// NEVER IN THE WAY. The hook passes its event on whatever happens inside it.
// It does plain text work and waits on nothing. The one read of the file
// happens at session start, with a short wait and no more.
//
// BESIDE THE OTHER PARTS. The engine loads a module with one hook per event
// that has no matcher, and refuses a second. Every hook here carries a
// matcher, so this part can be registered beside the others in one module.
//
// The text work lives in pure functions, exported so the tests can call them
// directly. A mod has no Node, so nothing is imported at run time.
//
// Every character outside plain ASCII is spelled as an escape, so no editor
// or shell on the way can change one, and so this file obeys the dash rule it
// enforces.
import type { EngineInterface, On, Timer } from 'claude-code'

/** What the project's Conversations.md asks of a reply, read once a session. */
export type ReplyRules = {
  /** The file says a dash is never longer than a hyphen. */
  hasDashRule: boolean
}

// ---------------------------------------------------------------------------
// Reading the rules
// ---------------------------------------------------------------------------

const RULES_FILE = 'project-os/Conversations.md'
const DASH_RULE = /longer\s+than\s+a\s+hyphen/i

/**
 * Reads the reply rules out of a Conversations.md. Only what the file states
 * is taken: a file without the sentence gives rules that ask for nothing.
 */
export const readReplyRules = (conversations: string): ReplyRules => ({
  hasDashRule: DASH_RULE.test(conversations),
})

// Where a walk up ends: at the drive, or at the share of a network path. A
// path with neither ends at the POSIX root, which is the empty string here.
const TOP_FOLDER = /^(?:[A-Za-z]:|[\\/]{2}[^\\/]+[\\/]+[^\\/]+)/

/**
 * The folder a session was opened in and every folder above it, nearest
 * first, each without a trailing separator ("" is the root of a POSIX path).
 */
export const foldersUp = (cwd: string): string[] => {
  const folders: string[] = []
  const top = TOP_FOLDER.exec(cwd)?.[0] ?? ''
  let folder = cwd.replace(/[\\/]+$/, '')

  // Forty levels is deeper than any real project and bounds the walk.
  for (let depth = 0; depth < 40; depth += 1) {
    folders.push(folder)
    const cut = Math.max(folder.lastIndexOf('/'), folder.lastIndexOf('\\'))
    if (cut < top.length) break
    folder = folder.slice(0, cut)
  }

  return folders
}

// ---------------------------------------------------------------------------
// Fenced blocks, inline code and addresses
// ---------------------------------------------------------------------------

// A fence opens on a run of three or more backticks or tildes and closes on a
// later run of the same mark at least as long, with nothing after it; an
// unclosed one runs to the end. The fix changes text and must never touch
// code, so a fence nested in a list or a quote, deeper than three spaces, is
// still a fence.
const GUARDED_OPEN = /^[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?(`{3,}|~{3,})/
const GUARDED_CLOSE = /^[ \t>]*(`{3,}|~{3,})[ \t]*$/

/** Marks the lines inside a fenced block, the two fence lines included. */
const maskFences = (lines: readonly string[], open: RegExp, close: RegExp): boolean[] => {
  const mask: boolean[] = []
  let mark = ''
  let length = 0

  for (const line of lines) {
    if (mark === '') {
      const opened = open.exec(line)?.[1]
      if (opened !== undefined) {
        mark = opened.charAt(0)
        length = opened.length
      }
      mask.push(opened !== undefined)
    } else {
      const closed = close.exec(line)?.[1]
      if (closed !== undefined && closed.charAt(0) === mark && closed.length >= length) {
        mark = ''
        length = 0
      }
      mask.push(true)
    }
  }

  return mask
}

/**
 * Inline code as filler letters of the same length: every position in the
 * line stays where it was, and a code span beside a dash reads as a word.
 * A span opens on a run of backticks and closes on the next run just as long.
 */
const hideCode = (line: string): string => {
  let hidden = ''
  let at = 0

  while (at < line.length) {
    const open = line.indexOf('`', at)
    if (open < 0) break
    let openEnd = open
    while (line.charAt(openEnd) === '`') openEnd += 1
    const ticks = openEnd - open

    let close = -1
    let seek = openEnd
    while (seek < line.length) {
      const next = line.indexOf('`', seek)
      if (next < 0) break
      let nextEnd = next
      while (line.charAt(nextEnd) === '`') nextEnd += 1
      if (nextEnd - next === ticks) {
        close = next
        break
      }
      seek = nextEnd
    }

    if (close < 0) {
      hidden += line.slice(at, openEnd)
      at = openEnd
    } else {
      hidden += line.slice(at, open) + 'x'.repeat(close + ticks - open)
      at = close + ticks
    }
  }

  return hidden + line.slice(at)
}

// A web address and a link's target are data, like code: a long dash inside
// one is part of the address, and changing it would break the link. A target
// holds no space, so it is read up to the first space or closing bracket and
// no further: reading on to the end of the line from every opening mark made
// one very long line of them cost seconds. A target written between angle
// brackets may hold spaces, and is read up to its closing bracket.
const LINK_TARGET = /\]\((?:<[^>\n]{0,300}>|[^)\s]*)/g
const ADDRESS = /\b(?:https?|ftp|file):\/\/\S+/gi
const filler = (hidden: string): string => 'x'.repeat(hidden.length)

/** A line with everything that must stay as written hidden behind filler. */
const hideLiterals = (line: string): string =>
  hideCode(line).replace(LINK_TARGET, filler).replace(ADDRESS, filler)

// ---------------------------------------------------------------------------
// The dash fix
// ---------------------------------------------------------------------------

const EN_DASH = '\u{2013}'
const LONG_DASH = /[\u{2013}\u{2014}]/u
const EVERY_LONG_DASH = /[\u{2013}\u{2014}]/gu
// One or more long dashes with nothing but spaces between them: one join.
const DASHES = /[\u{2013}\u{2014}](?:[ \t\xa0\u{2013}\u{2014}]*[\u{2013}\u{2014}])?/gu
const INLINE_SPACES = ' \t\xa0'
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u
// A number on each side of the dash, with the signs a number is written
// with: a percent or degree sign behind it, a currency sign or a point ahead.
const NUMBER_BEHIND = /\d[%\xb0]?$/
const NUMBER_AHEAD = /^[$\xa3\u{20ac}\u{20aa}]?\.?\d/u
// Nothing but block marks so far (quote marks, list marks, heading marks,
// emphasis marks): the dash opens the line's text.
const OPENS_LINE = /^(?:[ \t>#*+_~-]|\d{1,9}[.)])*$/
const OPENERS = '([{\u{201c}\u{2018}'
const CLOSERS = ')]}\u{201d}\u{2019}'
const STOPS = ',;:.!?\u{2026}'
// Emphasis marks that close a phrase, and a plain quote mark that closes one.
const MARKS_THEN_EDGE = /^[*_~]{1,3}(?:$|[\s.,;:!?)\]}])/
const QUOTE_THEN_EDGE = /^["'](?:$|[\s.,;:!?)\]}])/

const isOneOf = (set: string, character: string): boolean =>
  character !== '' && set.includes(character)

// Nothing before the dash to join: it follows an opening bracket or quote
// mark, or the emphasis marks that open a phrase. Only the last few
// characters decide, so only they are read.
const opensPhrase = (before: string): boolean => {
  const tail = before.slice(-5)
  const text = tail.replace(/[*_~]{1,3}$/, '')
  const last = text.slice(-1)
  if (isOneOf(OPENERS, last)) return true
  if (text.length < tail.length) return last === '' || /\s/.test(last)
  if (last !== '"' && last !== "'") return false
  const prior = text.slice(-2, -1)

  return prior === '' || /\s/.test(prior) || isOneOf(OPENERS, prior)
}

type Join = { before: string; lead: string; dashes: string; trail: string; after: string }

/**
 * What stands in place of one run of long dashes and the spaces around it,
 * given the text before and after it on the line. The comma is the rule; the
 * other answers are the places where a comma would be wrong.
 */
const joinFor = ({ before, lead, dashes, trail, after }: Join): string => {
  const left = before.slice(-1)
  const right = after.slice(0, 1)

  if (dashes === EN_DASH && NUMBER_AHEAD.test(after)) {
    // A range of numbers keeps its meaning with a plain hyphen.
    if (NUMBER_BEHIND.test(before.slice(-2))) return `${lead}-${trail}`
    // Set against the number after it and apart from what is before it, the
    // dash is a minus sign. Dropping it or writing a comma would change the
    // number, so it becomes a plain hyphen too.
    if (trail === '' && (lead !== '' || !LETTER_OR_DIGIT.test(left))) return `${lead}-`
  }
  // An en dash set tight between two words or numbers is a range or a
  // compound (Monday to Friday, 9am to 5pm, v1.2 to v1.4). A comma would turn
  // the range into a list of two, so it becomes a plain hyphen.
  const isTight = lead === '' && trail === ''
  if (dashes === EN_DASH && isTight && LETTER_OR_DIGIT.test(left) && LETTER_OR_DIGIT.test(right)) {
    return '-'
  }
  // A dash alone in a table cell means "nothing here": a hyphen says the same.
  if (left === '|' && (right === '|' || right === '')) return `${lead}-${trail}`
  // A table cell that opens with a dash and a number holds a signed number.
  if (left === '|' && NUMBER_AHEAD.test(after)) return `${lead}-${trail}`
  // A dash that opens a line, with a space and then text after it, marks a
  // list item. A plain hyphen marks one too, so the item keeps its mark.
  if (before === '' && trail !== '' && right !== '') return `${lead}- `
  // Elsewhere at the start of a line, or of a table cell, there is nothing
  // to join.
  if (left === '|' || OPENS_LINE.test(before)) return lead
  if (opensPhrase(before)) return ''
  if (right === '|') return trail

  const endsPhrase = right === '' || MARKS_THEN_EDGE.test(after)
  // Punctuation is already there: the dash goes and nothing is added.
  if (isOneOf(STOPS, left)) return endsPhrase ? '' : ' '
  // Before a line break the comma closes the line.
  if (endsPhrase) return ','
  if (isOneOf(CLOSERS, right) || isOneOf(STOPS, right) || QUOTE_THEN_EDGE.test(after)) return ''

  return ', '
}

const fixLine = (line: string): string => {
  if (!LONG_DASH.test(line)) return line
  const shadow = hideLiterals(line)
  let fixed = ''
  let from = 0

  for (const run of shadow.matchAll(DASHES)) {
    const first = run.index ?? 0
    const last = first + run[0].length
    // The spaces around the run belong to the join. They are walked by hand,
    // so a line of many spaces costs one pass and no more.
    let start = first
    let end = last
    while (start > from && INLINE_SPACES.includes(shadow.charAt(start - 1))) start -= 1
    while (end < shadow.length && INLINE_SPACES.includes(shadow.charAt(end))) end += 1

    fixed +=
      line.slice(from, start) +
      joinFor({
        before: shadow.slice(0, start),
        lead: line.slice(start, first),
        dashes: run[0],
        trail: line.slice(last, end),
        after: shadow.slice(end),
      })
    from = end
  }

  return fixed + line.slice(from)
}

/**
 * Rewrites the long dashes of a reply. An em dash, or an en dash with a space
 * beside it, becomes a comma between words; before a line break it becomes a
 * comma at the line's end; where it opens a line as a list mark it becomes a
 * plain hyphen, and elsewhere at the start of a line it is dropped. An en
 * dash set tight between two words or numbers (a range), or standing as a
 * minus sign, becomes a plain hyphen. Fenced blocks, inline code and
 * addresses are left as written, and so is a double hyphen, which is how
 * command options are spelled. Text with no long dash comes back as it was.
 *
 * A text that would come out with nothing to read, because it held nothing
 * but dashes, gets a plain hyphen for each dash instead. Claude Code takes an
 * empty reply for no reply at all: it shows the owner nothing, and may ask
 * the model a second time.
 */
export const fixLongDashes = (text: string): string => {
  if (!LONG_DASH.test(text)) return text

  // Splitting on a captured line break keeps each break as written.
  const parts = text.split(/(\r?\n)/)
  const lines = parts.filter((_part, at) => at % 2 === 0)
  const isCode = maskFences(lines, GUARDED_OPEN, GUARDED_CLOSE)
  const fixed = parts
    .map((part, at) => (at % 2 === 1 || isCode[at / 2] === true ? part : fixLine(part)))
    .join('')

  return fixed.trim() === '' ? text.replace(EVERY_LONG_DASH, '-') : fixed
}

type Block = { readonly type: string; readonly [field: string]: unknown }
type Row = { readonly content: readonly Block[] }

/**
 * Fixes the long dashes in a row's text blocks, content only. A row with
 * nothing to fix comes back as the same object, so nothing is rewritten
 * needlessly; every block that is not text is passed on as it came.
 */
export const fixRowDashes = <Kept extends Row>(row: Kept): Kept => {
  let isFixed = false
  const content = row.content.map(block => {
    if (block.type !== 'text' || typeof block.text !== 'string') return block
    const text = fixLongDashes(block.text)
    if (text === block.text) return block
    isFixed = true

    return { ...block, text }
  })

  return isFixed ? { ...row, content } : row
}

// ---------------------------------------------------------------------------
// The hooks
// ---------------------------------------------------------------------------

// How long session start waits for the rules file. Session start is awaited
// before the first prompt, so on a disk that answers late the session opens
// without the fix, and the rules still land when the read comes back.
const START_WAIT_MS = 2000
// The engine lets one module put a single hook without a matcher on an event,
// and refuses to load the module on a second. The other parts of this plugin
// hook the same events, so every hook here carries a matcher; this one is
// passed by every session start.
const EVERY_SESSION = { isInteractive: [true, false] } as const
// The model name the engine puts on a row it wrote in the model's place.
const ENGINE_STAND_IN = '<synthetic>'

const findRules = async ($: EngineInterface, cwd: string): Promise<ReplyRules | undefined> => {
  for (const folder of foldersUp(cwd)) {
    const path = `${folder}/${RULES_FILE}`
    if (await $.fs.exists(path).catch(() => false)) return readReplyRules(await $.fs.read(path))
  }

  return undefined
}

/** Resolves when the work settles or the wait runs out, whichever is first. */
const settledWithin = ($: EngineInterface, work: Promise<void>, ms: number): Promise<void> =>
  new Promise<void>(resolve => {
    let timer: Timer | undefined
    try {
      timer = $.clock.after(ms, resolve)
    } catch {
      // No clock to wait on: the work alone decides.
    }
    const stop = (): void => {
      try {
        timer?.cancel()
      } catch {
        // A timer that cannot be stopped fires into a settled promise.
      }
      resolve()
    }
    work.then(stop, stop)
  })

// A fix that fails must never cost the owner a reply.
const quietly = (work: () => void): void => {
  try {
    work()
  } catch {
    // The row goes on as it came.
  }
}

export const registerReplyCheck = (on: On): void => {
  // Undefined until session start has read the project's Conversations.md,
  // and for good in a folder that has none: the hook then hands on.
  let rules: ReplyRules | undefined

  on('session.start', EVERY_SESSION, async ($, e, next) => {
    try {
      const reading = findRules($, e.cwd).then(
        found => {
          rules = found
        },
        () => {
          rules = undefined
        },
      )
      await settledWithin($, reading, START_WAIT_MS)
    } catch {
      // A folder that cannot be read keeps the fix off.
    }

    return next(e)
  })

  // Each block of the model's reply, as the conversation is about to keep it.
  // A subagent's rows belong to its own conversation and are left alone; a
  // tool call or thinking holds no text block, so it passes as the same row.
  // A line the engine writes in the model's place (a sign-in notice, an API
  // error) is not the model's reply either, and is not fixed.
  on('session.append', { door: 'response' }, ($, e, next) => {
    if (rules?.hasDashRule !== true || e.agentId !== undefined) return next(e)
    if (e.origin.kind === 'model' && e.origin.model === ENGINE_STAND_IN) return next(e)

    let message = e.message
    quietly(() => {
      message = fixRowDashes(e.message)
    })

    return message === e.message ? next(e) : next({ ...e, message })
  })
}
