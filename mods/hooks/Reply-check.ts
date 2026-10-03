// Reply-check.ts - the live reply check. In a project that keeps the kit's
// reply rules it does two things while the owner works, and nothing anywhere
// else:
//
//   1. Fixes long dashes on the spot. When the project's Conversations.md says
//      a dash is never "longer than a hyphen", each block of the reply is
//      rewritten as the conversation keeps it: a long dash between words
//      becomes a comma, and one set tight between two words or numbers, a
//      range, becomes a plain hyphen.
//   2. Notes the reply limits quietly. When the turn ends, the last text the
//      model wrote is counted against the limits the same file states, and
//      one status line says what ran over. The reply is never rewritten for
//      length and never blocked.
//
// WHY LIVE. A check that runs after the reply can only correct the next one,
// because the owner has already read this one. A dash can be fixed before the
// reply is kept, so it is. Length cannot be fixed without rewriting what the
// model said, so it is only counted, where the owner sees it at a glance.
//
// WHICH PROJECTS. Only one with project-os/Conversations.md at or above the
// folder the session was opened in. The file is looked for once, at session
// start, nearest folder first, and the answer is remembered. With no file,
// every hook here hands its event straight on. The numbers come from the
// project's own file, never from this one, so a project that changed its
// limits is counted by its own.
//
// A NEW CONVERSATION. After /clear, a resume or a fork another conversation
// sits in the same window. The note about the last reply belonged to the one
// that left, so it is taken off the screen there.
//
// NEVER IN THE WAY. Every hook passes its event on whatever happens inside
// it. Nothing here waits on a prompt, a tool call or a reply: the hooks on
// those do plain text work and wait on nothing, and the one call out, the
// status line, is sent and not waited for. The one read of the file happens
// at session start, with a short wait and no more.
//
// BESIDE THE OTHER PARTS. The engine loads a module with one hook per event
// that has no matcher, and refuses a second. Every hook here carries a
// matcher, so this part can be registered beside the others in one module.
// The status line is one per plugin, and this part sets and clears it.
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
  /** The stated limits; absent when the file does not state them. */
  limits?: ReplyLimits
}

/** The numbers of the "Short by default" sentence and what stands beside it. */
export type ReplyLimits = {
  /** How many prose lines a reply may run to. */
  lines: number
  /** How many words one prose line may hold. */
  words: number
  /** The ceiling for a report the owner asked for; undefined when not stated. */
  reportLines: number | undefined
  /** The file says a findings list has no ceiling. */
  hasOpenFindings: boolean
}

/** What one reply ran over; all zero and no `tooLong` for a clean one. */
export type ReplyCount = {
  /** Present when the reply has more prose lines than its ceiling. */
  tooLong?: { lines: number; limit: number }
  /** Prose lines past the word cap. */
  wordyLines: number
  /** Lines that pack two sentences. */
  packedLines: number
  /** Double hyphens standing alone between two words. */
  doubleHyphens: number
}

// ---------------------------------------------------------------------------
// Reading the rules
// ---------------------------------------------------------------------------

const RULES_FILE = 'project-os/Conversations.md'
const DASH_RULE = /longer\s+than\s+a\s+hyphen/i
// The mark after "default" is left open: the kit writes a colon, and a project
// whose copy of the rules is older writes the same sentence with a dash there.
const SHORT_BY_DEFAULT =
  /Short\s+by\s+default\W{1,4}(\d+)\s+prose\s+lines?,\s+each\s+at\s+most\s+(\d+)\s+words\./i
const PROSE_LINES = /(\d+)\s+prose\s+lines?/i
const OPEN_FINDINGS = /findings\s+list\b[^.\n]*\bhas\s+no\s+ceiling/i

/**
 * Reads the reply rules out of a Conversations.md. Only what the file states
 * is taken: a file without the sentences gives rules that ask for nothing.
 */
export const readReplyRules = (conversations: string): ReplyRules => {
  const hasDashRule = DASH_RULE.test(conversations)
  const stated = SHORT_BY_DEFAULT.exec(conversations)
  if (stated === null) return { hasDashRule }

  const lines = Number(stated[1])
  const words = Number(stated[2])
  if (!(lines >= 1) || !(words >= 1)) return { hasDashRule }

  // The report ceiling is the next count of prose lines after that sentence.
  const report = PROSE_LINES.exec(conversations.slice(stated.index + stated[0].length))
  const reportLines = report === null ? undefined : Number(report[1])

  return {
    hasDashRule,
    limits: {
      lines,
      words,
      reportLines: reportLines !== undefined && reportLines >= 1 ? reportLines : undefined,
      hasOpenFindings: OPEN_FINDINGS.test(conversations),
    },
  }
}

// The phrases that buy the long report: "full report" and "daily report" in
// any case, and their Hebrew forms, because the owner may type either
// language and the ceiling must not hinge on which. The escapes spell the
// Hebrew words doch male (full report) and doch yomi (daily report), the
// first word with or without the quote mark inside it.
const REPORT_ASK =
  /full[\s_-]*report|daily[\s_-]*report|\u{5d3}\u{5d5}[\u{5f4}"']?\u{5d7}\s*(?:\u{5de}\u{5dc}\u{5d0}|\u{5d9}\u{5d5}\u{5de}\u{5d9})/iu

/** Whether a prompt asks for a report, which lifts the line ceiling. */
export const isReportAsk = (prompt: string): boolean => REPORT_ASK.test(prompt)

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

// The counting reads fences the way the reply rules were first checked: a
// fence opens on a line that starts with three or more backticks or tildes
// (up to three spaces before them), closes on a later run of the same mark at
// least as long with nothing after it, and an unclosed one runs to the end.
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/

// The dash fix reads fences more widely, because it changes text and must
// never touch code: a fence nested in a list or a quote sits deeper than
// three spaces and is still a fence.
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

/** A row's text blocks joined, one per line; "" when it has none. */
const rowText = (row: Row): string =>
  row.content
    .flatMap(block => (block.type === 'text' && typeof block.text === 'string' ? [block.text] : []))
    .join('\n')

// ---------------------------------------------------------------------------
// The counting
// ---------------------------------------------------------------------------

const DIVIDER = /^-{3,}$/
const HEADING = /^#{1,6} /
// Inline code as one neutral word, so a file name or a flag in a span never
// counts as a sentence or as several words.
const INLINE_CODE = /`[^`\n]*`/g
const HAS_WORD = LETTER_OR_DIGIT
// A word or closing mark, then a full stop, then the capital that starts the
// next sentence.
const TWO_SENTENCES = /[\p{Ll}\p{Lu}\p{Nd})\]"'\u{201d}\u{2019}][.!?]\s+["'\u{201c}(]*[A-Z]/u
// Abbreviations whose full stop ends no sentence. The titles are matched in
// their own capitals only, so a lowercase "no." at a sentence's end still
// counts as an end.
const SHORT_FORMS = /(^|[\s(])(e\.g\.|i\.e\.|etc\.|vs\.|cf\.|a\.m\.|p\.m\.)(?=$|[\s),;:])/gi
const TITLES = /(^|[\s(])(Dr\.|Mr\.|Mrs\.|Ms\.|No\.|Fig\.|St\.|U\.S\.|Ph\.D\.)(?=$|[\s),;:])/g
// A findings list is known by its labels, each alone on its line.
const FINDING_LABELS = [/^Problem:$/, /^Proposal:$/]

const withoutStops = (_all: string, lead: string, short: string): string =>
  lead + short.replace(/\./g, ' ')

const packsTwoSentences = (line: string): boolean =>
  TWO_SENTENCES.test(
    line
      .replace(INLINE_CODE, 'code')
      .replace(SHORT_FORMS, withoutStops)
      .replace(TITLES, withoutStops)
      .trim(),
  )

const wordsIn = (line: string): number =>
  line
    .replace(INLINE_CODE, 'code')
    .split(/\s+/)
    .filter(word => HAS_WORD.test(word)).length

// A word beside a double hyphen: it holds a letter or a digit and no hyphen
// at its edge, so the bare pair that ends a command's options, with another
// option right after it, is not read as punctuation.
const isPlainWord = (word: string): boolean =>
  HAS_WORD.test(word) && !word.startsWith('-') && !word.endsWith('-')

/** Double hyphens standing alone between two words: a long dash by hand. */
const doubleHyphensIn = (line: string): number => {
  if (!line.includes('--')) return 0
  const words = hideLiterals(line).trim().split(/\s+/)
  let found = 0

  for (let at = 1; at < words.length - 1; at += 1) {
    const isBetweenWords = isPlainWord(words[at - 1] ?? '') && isPlainWord(words[at + 1] ?? '')
    if (words[at] === '--' && isBetweenWords) found += 1
  }

  return found
}

/**
 * Counts one reply against the rules. Prose lines leave out fenced blocks,
 * headings, dividers and blank lines. A findings list has no line ceiling
 * where the project says so, and the word cap still holds for it. A report
 * the owner asked for is held to the report ceiling instead of the default.
 */
export const countReply = (reply: string, rules: ReplyRules, isReport: boolean): ReplyCount => {
  const count: ReplyCount = { wordyLines: 0, packedLines: 0, doubleHyphens: 0 }
  const lines = reply.split(/\r?\n/)
  const limits = rules.limits

  if (limits !== undefined) {
    const isFenced = maskFences(lines, FENCE_OPEN, FENCE_CLOSE)
    const open = lines.filter((_line, at) => isFenced[at] !== true)
    const prose = open
      .map(line => line.trim())
      .filter(line => line !== '' && !DIVIDER.test(line) && !HEADING.test(line))
    const isOpenList =
      limits.hasOpenFindings &&
      FINDING_LABELS.every(label => open.some(line => label.test(line.trim())))
    const limit = isOpenList ? undefined : isReport ? limits.reportLines : limits.lines

    if (limit !== undefined && prose.length > limit) {
      count.tooLong = { lines: prose.length, limit }
    }
    count.wordyLines = prose.filter(line => wordsIn(line) > limits.words).length
    count.packedLines = open.filter(packsTwoSentences).length
  }

  if (rules.hasDashRule) {
    const isCode = maskFences(lines, GUARDED_OPEN, GUARDED_CLOSE)
    count.doubleHyphens = lines.reduce(
      (found, line, at) => (isCode[at] === true ? found : found + doubleHyphensIn(line)),
      0,
    )
  }

  return count
}

const counted = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`

/**
 * The one status line for a counted reply, the worst problem first, so a
 * narrow window cuts the least important part. Undefined for a clean reply,
 * and always for a project whose file states no limits.
 */
export const replyNote = (count: ReplyCount, rules: ReplyRules): string | undefined => {
  if (rules.limits === undefined) return undefined
  const problems: string[] = []

  if (count.tooLong !== undefined) {
    problems.push(`${count.tooLong.lines} lines, limit ${count.tooLong.limit}`)
  }
  if (count.wordyLines > 0) {
    problems.push(`${counted(count.wordyLines, 'line', 'lines')} over ${rules.limits.words} words`)
  }
  if (count.packedLines > 0) {
    problems.push(`${counted(count.packedLines, 'line holds', 'lines hold')} two sentences`)
  }
  if (count.doubleHyphens > 0) {
    problems.push(counted(count.doubleHyphens, 'double hyphen', 'double hyphens'))
  }

  // A middle dot between the problems, as a status line separates its parts.
  return problems.length === 0 ? undefined : `Reply: ${problems.join(' \xb7 ')}`
}

// ---------------------------------------------------------------------------
// The hooks
// ---------------------------------------------------------------------------

// How long session start waits for the rules file. Session start is awaited
// before the first prompt, so on a disk that answers late the session opens
// without the check, and the rules still land when the read comes back.
const START_WAIT_MS = 2000
// Whose prompt counts as the owner's own words: typed at the prompt, sent
// from the phone or the web, or handed in by the app that hosts the session.
const OWNER_PROMPT = { origin: { kind: /^(?:composer|bridge|sdk)$/ } } as const
// The engine lets one module put a single hook without a matcher on an event,
// and refuses to load the module on a second. The other parts of this plugin
// hook the same events, so every hook here carries a matcher; where the check
// wants every event, the matcher is one that every event passes.
const EVERY_SESSION = { isInteractive: [true, false] } as const
const EVERY_TURN = { turnId: /^/ } as const
// A conversation that takes the place of another in the same window: after
// /clear, a resume or a fork. A compaction is left out on purpose: it can
// come in the middle of a turn, and the conversation stays the same one.
const NEW_CONVERSATION = { source: ['clear', 'resume', 'fork'] } as const
// The model name the engine puts on a row it wrote in the model's place.
const ENGINE_STAND_IN = '<synthetic>'

type Turn = { id: string; isReport: boolean; reply: string | undefined }

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

// A check that fails must never cost the owner a prompt or a reply.
const quietly = (work: () => void): void => {
  try {
    work()
  } catch {
    // The event goes on unchecked.
  }
}

export const registerReplyCheck = (on: On): void => {
  // Undefined until session start has read the project's Conversations.md,
  // and for good in a folder that has none: every hook then hands on.
  let rules: ReplyRules | undefined
  // The main turn under way: whether the owner asked for a report, and the
  // last text the model wrote in it. Kept in the module, not in the session's
  // state, so that noting a row costs no call to the host.
  let turn: Turn | undefined

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
      // A folder that cannot be read keeps the check off.
    }

    return next(e)
  })

  // No session start comes with a new conversation in the same window, so
  // the note about a reply of the one that left would stay pinned under the
  // prompt until the next counted reply. It is taken off here instead.
  on('classic.SessionStart', NEW_CONVERSATION, ($, e, next) => {
    quietly(() => {
      if (rules?.limits === undefined) return
      turn = undefined
      $.ui.status(undefined)
    })

    return next(e)
  })

  on('turn.start', EVERY_TURN, ($, e, next) => {
    quietly(() => {
      if (rules?.limits === undefined) return
      turn = { id: e.turnId, isReport: isReportAsk(e.text), reply: undefined }
    })

    return next(e)
  })

  // A prompt the owner types over a running turn can be folded into it with
  // no turn of its own, so a report asked for that way lifts the running
  // turn's ceiling. A notification or another session's message never does.
  on('prompt.submit', OWNER_PROMPT, ($, e, next) => {
    quietly(() => {
      if (turn === undefined || e.turnId !== turn.id) return
      if (isReportAsk(e.text)) turn.isReport = true
    })

    return next(e)
  })

  // Each block of the model's reply, as the conversation is about to keep it.
  // A subagent's rows belong to its own conversation and are left alone; a
  // tool call or thinking holds no text block, so it passes as the same row.
  // A line the engine writes in the model's place (a sign-in notice, an API
  // error) is not the model's reply either: it is neither fixed nor counted.
  on('session.append', { door: 'response' }, ($, e, next) => {
    const active = rules
    if (active === undefined || e.agentId !== undefined) return next(e)
    if (e.origin.kind === 'model' && e.origin.model === ENGINE_STAND_IN) return next(e)

    let message = e.message
    quietly(() => {
      if (active.hasDashRule) message = fixRowDashes(e.message)
      const text = rowText(message)
      if (turn !== undefined && text.trim() !== '') turn.reply = text
    })

    return message === e.message ? next(e) : next({ ...e, message })
  })

  // Only a turn that ended on an answer: one that was interrupted, refused or
  // ended on an error left no reply to count. A subagent's turn is not the
  // reply either.
  on('turn.complete', { reason: 'answer' }, ($, e, next) => {
    quietly(() => {
      const active = rules
      if (active?.limits === undefined || e.agentId !== undefined) return

      const own = turn !== undefined && turn.id === e.turnId ? turn : undefined
      const reply = own?.reply ?? e.answer
      if (reply.trim() === '') return

      // One line, set or cleared: a clean reply takes the last note away.
      $.ui.status(replyNote(countReply(reply, active, own?.isReport ?? false), active))
    })

    return next(e)
  })
}
