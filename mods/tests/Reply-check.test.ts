// Reply-check.test.ts - tests for the live reply check, hooks/Reply-check.ts.
//
// Run with the engine itself, from anywhere:
//
//   claude plugin test <the plugin folder>
//
// Two layers. The text work (the dash fix, reading the rules, the counting,
// the note) is pure, so the first half calls it directly, one rule at a time.
// The second half drives the hooks through the engine: each test stands in
// for the world beneath the plugin (the disk, the clock, the status line, the
// conversation's store) and raises the events a session raises, once as the
// terminal and once as the desktop app, since the check must not depend on
// where the session draws.
//
// Every long dash and every Hebrew letter the tests need as data is written
// as an escape, so this file obeys the rule it tests and no editor or shell
// on the way can change one.
import type { Args, Frozen, On, RenderSurface } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import {
  countReply,
  fixLongDashes,
  fixRowDashes,
  foldersUp,
  isReportAsk,
  readReplyRules,
  replyNote,
} from '../hooks/Reply-check'
import type { ReplyLimits, ReplyRules } from '../hooks/Reply-check'

const EM = '\u{2014}'
const EN = '\u{2013}'
// The middle dot the note puts between two problems.
const DOT = '\xb7'
// Hebrew for "hello" and "world": text that runs right to left beside a dash.
const SHALOM = '\u{5e9}\u{5dc}\u{5d5}\u{5dd}'
const OLAM = '\u{5e2}\u{5d5}\u{5dc}\u{5dd}'
// Hebrew for "report" in its three spellings (plain, with the Hebrew quote
// mark, with a typed double quote), then "full" and "daily".
const DOCH = '\u{5d3}\u{5d5}\u{5d7}'
const DOCH_MARKED = '\u{5d3}\u{5d5}\u{5f4}\u{5d7}'
const DOCH_QUOTED = '\u{5d3}\u{5d5}"\u{5d7}'
const MALE = '\u{5de}\u{5dc}\u{5d0}'
const YOMI = '\u{5d9}\u{5d5}\u{5de}\u{5d9}'

/** So many short prose lines, one sentence each. */
const lines = (count: number): string =>
  Array.from({ length: count }, (_, at) => `Line ${at + 1} is short.`).join('\n')

/** One line of so many words, with no capital and no full stop. */
const words = (count: number): string =>
  Array.from({ length: count }, (_, at) => `w${at + 1}`).join(' ')

// ---------------------------------------------------------------------------
// The dash fix, called directly
// ---------------------------------------------------------------------------

/** Checks a list of [written, kept] pairs, naming the one that fails. */
const expectFixes = (pairs: ReadonlyArray<readonly [string, string]>): void => {
  for (const [written, kept] of pairs) {
    expect(fixLongDashes(written), JSON.stringify(written)).toBe(kept)
  }
}

describe('the dash fix', () => {
  test('a long dash between words becomes a comma', () => {
    expectFixes([
      [`a ${EM} b`, 'a, b'],
      [`a${EM}b`, 'a, b'],
      [`a ${EN} b`, 'a, b'],
      [`a ${EN}b`, 'a, b'],
      [`a${EN} b`, 'a, b'],
      [`It works ${EM} mostly.`, 'It works, mostly.'],
      [`a ${EM}b and c${EM} d`, 'a, b and c, d'],
      [`a\xa0${EM}\xa0b`, 'a, b'],
    ])
  })

  // A comma here would turn a range into a list of two: "Monday, Friday" is
  // two days, "Monday-Friday" is five.
  test('an en dash set tight between two words or numbers is a range and becomes a hyphen', () => {
    expectFixes([
      [
        `Open Monday${EN}Friday, 9am${EN}5pm, versions v1.2${EN}v1.4.`,
        'Open Monday-Friday, 9am-5pm, versions v1.2-v1.4.',
      ],
      [`a${EN}b`, 'a-b'],
      [`v1${EN}v2`, 'v1-v2'],
      [`the London${EN}Paris train`, 'the London-Paris train'],
      [`COVID${EN}19`, 'COVID-19'],
      [`${SHALOM}${EN}${OLAM}`, `${SHALOM}-${OLAM}`],
      [`\`a\`${EN}\`b\``, '`a`-`b`'],
      // An em dash, or a space on either side, is a join and stays a comma.
      [`Monday${EM}Friday`, 'Monday, Friday'],
      [`Monday ${EN} Friday`, 'Monday, Friday'],
      [`x ${EN} y = 3`, 'x, y = 3'],
      // Beside a bracket it is no range between two words.
      [`(a)${EN}(b)`, '(a), (b)'],
    ])
  })

  test('a long dash that opens a line as a list mark becomes a hyphen', () => {
    expectFixes([
      [`${EN} first item\n${EN} second item`, '- first item\n- second item'],
      [`${EM} a new thought`, '- a new thought'],
      [`  ${EM} indented`, '  - indented'],
      [`first line\n${EM} second line`, 'first line\n- second line'],
      [`${EN}\xa0a wide space after it`, '- a wide space after it'],
      [`${EN} 5 items`, '- 5 items'],
    ])
  })

  test('elsewhere at the start of a line a long dash is dropped', () => {
    expectFixes([
      // After a quote mark, a list mark or a heading mark the line has its mark.
      [`> ${EM} the author`, '> the author'],
      [`- ${EM} a list item`, '- a list item'],
      [`1. ${EM} a numbered item`, '1. a numbered item'],
      [`### ${EM} a heading`, '### a heading'],
      // Set against the word it marks no list item.
      [`${EM}and then`, 'and then'],
      // With nothing after it there is no item to mark.
      [`a line\n${EM}\nanother line`, 'a line\n\nanother line'],
      [`a line\n${EM} \nanother line`, 'a line\n\nanother line'],
    ])
  })

  // Claude Code takes an empty reply for no reply at all: the owner is shown
  // nothing, and the model may be asked a second time.
  test('a text that held nothing but dashes keeps a plain hyphen for each', () => {
    expectFixes([
      [`${EM}`, '-'],
      [`${EN}`, '-'],
      [`  ${EM}  `, '  -  '],
      [`${EM}\n`, '-\n'],
      [`\n ${EM}\t\n`, '\n -\t\n'],
      [` ${EM} ${EN} `, ' - - '],
      [`${EM}\n${EN}`, '-\n-'],
      // With anything else to read, a dash alone on its line goes as before.
      [`${EM}\nword`, '\nword'],
    ])
  })

  test('a long dash before a line break becomes a comma at the end of the line', () => {
    expectFixes([
      [`first line ${EM}\nsecond line`, 'first line,\nsecond line'],
      [`first line${EM}\nsecond line`, 'first line,\nsecond line'],
      [`first line ${EN}\nsecond line`, 'first line,\nsecond line'],
      [`first line ${EM}  \nsecond line`, 'first line,\nsecond line'],
      [`the last line ${EM}`, 'the last line,'],
    ])
  })

  test('line breaks stay as they were written', () => {
    expectFixes([
      [`x ${EM}\r\ny ${EM} z\r\n`, 'x,\r\ny, z\r\n'],
      [`x ${EM} y\n\n\nz ${EM} w\n`, 'x, y\n\n\nz, w\n'],
    ])
  })

  test('an en dash between two digits becomes a plain hyphen', () => {
    expectFixes([
      [`pages 3${EN}5`, 'pages 3-5'],
      [`pages 3 ${EN} 5`, 'pages 3 - 5'],
      [`from 2019${EN}2024`, 'from 2019-2024'],
      [`10:00${EN}11:00`, '10:00-11:00'],
      // A number keeps the signs it is written with.
      [`$5${EN}$10 a month`, '$5-$10 a month'],
      [`5%${EN}10% faster`, '5%-10% faster'],
      [`5% ${EN} 10% faster`, '5% - 10% faster'],
      [`20\xb0${EN}30\xb0`, '20\xb0-30\xb0'],
      [`0.5${EN}.75`, '0.5-.75'],
      // Only an en dash: an em dash between numbers is a join, and so is an
      // en dash with a space beside it and a word after it.
      [`3${EM}5`, '3, 5'],
      [`step 2 ${EN} run it`, 'step 2, run it'],
    ])
  })

  test('an en dash that stands as a minus sign keeps the number its sign', () => {
    expectFixes([
      [`It was ${EN}5 outside`, 'It was -5 outside'],
      [`${EN}5 points for that`, '-5 points for that'],
      [`| change | ${EN}12% |`, '| change | -12% |'],
      [`| change | ${EN} 12 |`, '| change | - 12 |'],
      [`| change | ${EM}12 |`, '| change | -12 |'],
      [`(${EN}3)`, '(-3)'],
      [`x = ${EN}0.5`, 'x = -0.5'],
      [`a loss of ${EN}$5`, 'a loss of -$5'],
      // With a space after it, or an em dash, it is a join like any other.
      [`a list ${EN} 5 items`, 'a list, 5 items'],
      [`word ${EM}5`, 'word, 5'],
      // Set tight between a word and a number it is a compound, not a sign.
      [`word${EN}5`, 'word-5'],
    ])
  })

  test('nothing changes inside a fenced block, in either fence style', () => {
    expectFixes([
      [`\`\`\`\ncode ${EM} here\n\`\`\`\nprose ${EM} here`, `\`\`\`\ncode ${EM} here\n\`\`\`\nprose, here`],
      [`~~~\ncode ${EN} here\n~~~\nprose ${EN} here`, `~~~\ncode ${EN} here\n~~~\nprose, here`],
      [`\`\`\`ts\nconst a = '${EM}'\n\`\`\``, `\`\`\`ts\nconst a = '${EM}'\n\`\`\``],
      // A longer fence can quote a shorter one, and a tilde fence a backtick one.
      [
        `\`\`\`\`\n\`\`\`\nstill code ${EM}\n\`\`\`\n\`\`\`\`\nout ${EM} side`,
        `\`\`\`\`\n\`\`\`\nstill code ${EM}\n\`\`\`\n\`\`\`\`\nout, side`,
      ],
      [`~~~\n\`\`\`\nstill code ${EM}\n~~~\nout ${EM} side`, `~~~\n\`\`\`\nstill code ${EM}\n~~~\nout, side`],
      // An unclosed fence is code to the end.
      [`before ${EM} it\n\`\`\`\ncode ${EM} to the end`, `before, it\n\`\`\`\ncode ${EM} to the end`],
    ])
  })

  test('a fence nested in a list or a quote is still a fence', () => {
    expectFixes([
      [
        `1. Run this:\n\n    \`\`\`bash\n    echo ${EM}\n    \`\`\`\n\n   then wait ${EM} a little`,
        `1. Run this:\n\n    \`\`\`bash\n    echo ${EM}\n    \`\`\`\n\n   then wait, a little`,
      ],
      [
        `> \`\`\`\n> quoted code ${EM} x\n> \`\`\`\n> quoted ${EM} prose`,
        `> \`\`\`\n> quoted code ${EM} x\n> \`\`\`\n> quoted, prose`,
      ],
      [`- \`\`\`\n  code ${EM} x\n  \`\`\`\n- item ${EM} text`, `- \`\`\`\n  code ${EM} x\n  \`\`\`\n- item, text`],
    ])
  })

  test('nothing changes inside an inline code span', () => {
    expectFixes([
      [`\`a ${EM} b\` and c ${EM} d`, `\`a ${EM} b\` and c, d`],
      [`not \`${EM}\`, not \`${EN}\``, `not \`${EM}\`, not \`${EN}\``],
      // A span of two backticks may hold one, and still closes on two.
      [`\`\`code ${EM} \` here\`\` ${EM} after`, `\`\`code ${EM} \` here\`\`, after`],
      // A span beside the dash reads as a word.
      [`\`x\` ${EM} \`y\``, '`x`, `y`'],
      [`${EM} \`x\` first`, '- `x` first'],
      // One stray backtick opens no span.
      [`a stray \` mark ${EM} here`, 'a stray ` mark, here'],
    ])
  })

  test('a double hyphen is never rewritten', () => {
    expectFixes([
      ['this works -- mostly', 'this works -- mostly'],
      ['run it with --apply', 'run it with --apply'],
      ['npm test -- --watch', 'npm test -- --watch'],
      [`run --apply ${EM} then -- stop`, 'run --apply, then -- stop'],
    ])
  })

  test('dividers and table rows keep their shape', () => {
    expectFixes([
      [`----\n# Title ${EM} more\n----`, '----\n# Title, more\n----'],
      ['----\n---\n|---|---|\n| :-- | --: |', '----\n---\n|---|---|\n| :-- | --: |'],
      [`| a ${EM} b | c |\n|---|---|\n| d | e ${EN} f |`, '| a, b | c |\n|---|---|\n| d | e, f |'],
      // A dash alone in a cell means "nothing here": a hyphen says the same.
      [`| name | ${EM} |\n| ${EN} | value |`, '| name | - |\n| - | value |'],
      [`| name | ${EM}`, '| name | -'],
      [`| ${EM} text | text ${EM} |`, '| text | text |'],
      [`| 3${EN}5 | x |`, '| 3-5 | x |'],
    ])
  })

  test('Hebrew beside a dash is joined the same way', () => {
    expectFixes([
      [`${SHALOM} ${EM} ${OLAM}`, `${SHALOM}, ${OLAM}`],
      [`${SHALOM}${EM}${OLAM}`, `${SHALOM}, ${OLAM}`],
      [`${SHALOM} ${EM} done`, `${SHALOM}, done`],
      [`${EM} ${SHALOM}`, `- ${SHALOM}`],
      [`${SHALOM} ${EM}\n${OLAM}`, `${SHALOM},\n${OLAM}`],
    ])
  })

  test('punctuation, brackets and emphasis beside a dash take no second comma', () => {
    expectFixes([
      [`Done. ${EM} Next`, 'Done. Next'],
      [`word, ${EM} next`, 'word, next'],
      [`word ${EM}, next`, 'word, next'],
      [`word, ${EM}`, 'word,'],
      [`word ${EM}.`, 'word.'],
      [`(${EM} aside)`, '(aside)'],
      [`(aside ${EM})`, '(aside)'],
      [`word ${EM} (aside)`, 'word, (aside)'],
      [`- **Name** ${EM} what it does`, '- **Name**, what it does'],
      [`**${EM} text**`, '**text**'],
      [`word **${EM} text**`, 'word **text**'],
      [`**text ${EM}** more`, '**text,** more'],
      [`_text ${EM}_`, '_text,_'],
      [`word ${EM} *emphasis* after`, 'word, *emphasis* after'],
      [`"quoted" ${EM} said`, '"quoted", said'],
      [`\u{201c}quoted\u{201d} ${EM} said`, '\u{201c}quoted\u{201d}, said'],
      [`he said "wait${EM}" and left`, 'he said "wait" and left'],
      [`say "${EM} again"`, 'say "again"'],
      [`the users' ${EM} all of them`, "the users', all of them"],
      [`wait\u{2026} ${EM} what`, 'wait\u{2026} what'],
    ])
  })

  test('several dashes in a row are one join', () => {
    expectFixes([
      [`a ${EM}${EM} b`, 'a, b'],
      [`a ${EM} ${EM} b`, 'a, b'],
      [`a ${EN}${EM} b`, 'a, b'],
      [`a${EM}b${EN}c ${EM} d`, 'a, b-c, d'],
    ])
  })

  test('an address or a link target keeps its dash', () => {
    expectFixes([
      [
        `see https://example.org/wiki/Bose${EN}Einstein ${EM} a page`,
        `see https://example.org/wiki/Bose${EN}Einstein, a page`,
      ],
      [`[the ${EM} page](notes/a${EN}b.md) ${EM} read it`, `[the, page](notes/a${EN}b.md), read it`],
      // A link with a title: the address is kept, the title is prose.
      [
        `[page](notes/a${EN}b.md "the ${EM} title") ${EM} read`,
        `[page](notes/a${EN}b.md "the, title"), read`,
      ],
      // A target between angle brackets may hold spaces.
      [`[page](<my notes/a ${EN} b.md>) ${EM} read`, `[page](<my notes/a ${EN} b.md>), read`],
      // A link mark that never closes hides only up to the next space.
      [`see [this](half${EN}done and ${EM} more`, `see [this](half${EN}done and, more`],
    ])
  })

  // Each opening mark used to be read on to the end of the line, so a line
  // of a hundred thousand of them cost whole seconds while the reply's row
  // waited. A test has five seconds.
  test('one very long line of link marks that never close is fixed at once', () => {
    const tight = '[a]('.repeat(200_000)
    expect(fixLongDashes(`${tight} ${EM} x`)).toBe(`${tight}, x`)

    const spaced = '[a]( '.repeat(100_000)
    expect(fixLongDashes(`${spaced}${EM} x`)).toBe(`${spaced.trimEnd()}, x`)

    const angled = '[a](<'.repeat(100_000)
    expect(fixLongDashes(`${angled} ${EM} x`)).toBe(`${angled}, x`)
  })

  test('text with no long dash comes back as it was', () => {
    const plain = 'Nothing to fix here.\nA hyphen-ated word, a -- pair, a ---- line.'
    expect(fixLongDashes(plain)).toBe(plain)
    expect(fixLongDashes('')).toBe('')

    const coded = `\`${EM}\` and\n\`\`\`\n${EN}\n\`\`\``
    expect(fixLongDashes(coded)).toBe(coded)
  })

  test('a very long line is fixed in one pass', () => {
    const gap = ' '.repeat(20000)
    expect(fixLongDashes(`a ${EM}${gap}b`)).toBe('a, b')
    expect(fixLongDashes(`${'#'.repeat(20000)}x ${EM} y`)).toBe(`${'#'.repeat(20000)}x, y`)
    expect(fixLongDashes(`${`a ${EM} `.repeat(2000)}b`)).toBe(`${'a, '.repeat(2000)}b`)
  })
})

describe('a row of the conversation', () => {
  test('a row with nothing to fix comes back as the same object', () => {
    const row = {
      type: 'assistant',
      content: [
        { type: 'text', text: 'No long dash here, only a -- pair.' },
        { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: `echo ${EM}` } },
      ],
    }
    expect(fixRowDashes(row)).toBe(row)

    const empty = { type: 'assistant', content: [] }
    expect(fixRowDashes(empty)).toBe(empty)
  })

  test('only text blocks change, and every other block is passed on as it came', () => {
    const thinking = { type: 'thinking', thinking: `a ${EM} b`, signature: 'sig' }
    const toolUse = { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: `echo ${EM}` } }
    const clean = { type: 'text', text: 'already clean' }
    const odd = { type: 'text', text: 42 }
    const row = {
      type: 'assistant',
      role: 'assistant',
      content: [thinking, { type: 'text', text: `a ${EM} b`, citations: null }, toolUse, clean, odd],
    }
    const fixed = fixRowDashes(row)

    expect(fixed).not.toBe(row)
    expect(fixed.type).toBe('assistant')
    expect(fixed.role).toBe('assistant')
    expect(fixed.content).toHaveLength(5)
    expect(fixed.content[0]).toBe(thinking)
    expect(fixed.content[1]).toEqual({ type: 'text', text: 'a, b', citations: null })
    expect(fixed.content[2]).toBe(toolUse)
    expect(fixed.content[3]).toBe(clean)
    expect(fixed.content[4]).toBe(odd)
    // The row that came in is left as it was.
    expect(row.content[1]).toEqual({ type: 'text', text: `a ${EM} b`, citations: null })
  })

  test('a frozen row, as the engine hands it, is fixed without being written to', () => {
    const row = Object.freeze({
      type: 'assistant',
      content: Object.freeze([Object.freeze({ type: 'text', text: `a ${EM} b` })]),
    })
    expect(fixRowDashes(row).content).toEqual([{ type: 'text', text: 'a, b' }])
  })
})

// ---------------------------------------------------------------------------
// Reading the rules, called directly
// ---------------------------------------------------------------------------

// The sentences as the kit's own Conversations.md states them.
const KIT_RULES = [
  '### 1 Cut hard',
  '',
  'Short by default: 3 prose lines, each at most 16 WORDS.',
  '16 is a ceiling, not a target: use the fewest words that still explain.',
  'The ceiling holds for EVERY reply, work behind it or not.',
  'A findings list (rule 10) has no ceiling: every item in full.',
  'Otherwise it lifts ONLY when the owner asks for a `full report`: 16 prose lines,',
  'and twice more for the two messages `Installation.md` defines.',
  '',
  '### 18 Never a long dash',
  '',
  `Never write a dash longer than a hyphen: not \`${EM}\`, not \`${EN}\`, not a \`--\` pair.`,
].join('\n')

// The same rules as one project reworded them, with its own numbers.
const PROJECT_RULES = [
  'The prose budget dropped to 3 lines.',
  'Short by default: 3 prose lines, each at most 14 WORDS.',
  'A findings list (rule 10) has no ceiling.',
  'Otherwise it lifts ONLY on an owner report phrase, to 20 prose lines:',
  `Never write a dash longer than a hyphen: not \`${EM}\`, not \`${EN}\`, not a \`--\` pair.`,
].join('\n')

describe('reading the rules', () => {
  test('the kit wording gives the kit numbers', () => {
    expect(readReplyRules(KIT_RULES)).toEqual({
      hasDashRule: true,
      limits: { lines: 3, words: 16, reportLines: 16, hasOpenFindings: true },
    })
  })

  test('a project that reworded them is read by its own numbers', () => {
    expect(readReplyRules(PROJECT_RULES)).toEqual({
      hasDashRule: true,
      limits: { lines: 3, words: 14, reportLines: 20, hasOpenFindings: true },
    })
  })

  test('a file without the sentences asks for nothing', () => {
    const rules = readReplyRules('# Reply rules\n\nBe kind. Keep it short, 3 lines or so.')
    expect(rules.hasDashRule).toBe(false)
    expect(rules.limits).toBeUndefined()
    expect(readReplyRules('').limits).toBeUndefined()
  })

  test('each sentence is read on its own', () => {
    const onlyDashes = readReplyRules('Never write a dash longer than a hyphen.')
    expect(onlyDashes.hasDashRule).toBe(true)
    expect(onlyDashes.limits).toBeUndefined()

    const onlyLimits = readReplyRules('Short by default: 4 prose lines, each at most 12 WORDS.')
    expect(onlyLimits).toEqual({
      hasDashRule: false,
      limits: { lines: 4, words: 12, reportLines: undefined, hasOpenFindings: false },
    })
    expect(onlyLimits.limits?.reportLines).toBeUndefined()
  })

  test('the report ceiling is the next count of prose lines after the sentence', () => {
    const before = readReplyRules(
      'A report runs to 30 prose lines.\nShort by default: 3 prose lines, each at most 14 WORDS.',
    )
    expect(before.limits?.reportLines).toBeUndefined()

    const after = readReplyRules(
      [
        'A report runs to 30 prose lines.',
        'Short by default: 3 prose lines, each at most 14 WORDS.',
        'A report: 9 prose lines.',
        'Never 99 prose lines.',
      ].join('\n'),
    )
    expect(after.limits?.reportLines).toBe(9)
  })

  test('a sentence wrapped over two lines or in another case is still read', () => {
    const wrapped = readReplyRules(
      [
        'short by default: 5 prose',
        'lines, each at most 9 words.',
        'A findings',
        'list has no ceiling.',
        'longer than',
        'a hyphen',
      ].join('\n'),
    )
    expect(wrapped).toEqual({
      hasDashRule: true,
      limits: { lines: 5, words: 9, reportLines: undefined, hasOpenFindings: true },
    })
  })

  test('an older copy of the rules, with a dash after "default", is read the same', () => {
    const older = [
      `Short by default ${EM} 3 prose lines, each at most 16 WORDS.`,
      'It lifts ONLY when the owner asks for a `full report`: 16 prose lines.',
    ].join('\n')
    expect(readReplyRules(older)).toEqual({
      hasDashRule: false,
      limits: { lines: 3, words: 16, reportLines: 16, hasOpenFindings: false },
    })
    expect(readReplyRules('Short by default, 3 prose lines, each at most 16 WORDS.').limits?.lines).toBe(3)
    // Other words between "default" and the number are another sentence.
    expect(readReplyRules('Short by default it was 3 prose lines, each at most 16 WORDS.').limits).toBeUndefined()
  })

  test('zero is not a limit', () => {
    expect(readReplyRules('Short by default: 0 prose lines, each at most 14 WORDS.').limits).toBeUndefined()
    expect(readReplyRules('Short by default: 3 prose lines, each at most 0 WORDS.').limits).toBeUndefined()
  })
})

describe('asking for a report', () => {
  test('full report and daily report, in any case and either language', () => {
    const asks = [
      'full report',
      'Please give me a Full Report on this.',
      'FULL REPORT',
      'full-report',
      'full_report',
      'Daily report 2026-10-01',
      'daily report (2026-10-01-2026-10-03)',
      `${DOCH} ${MALE}`,
      `${DOCH_MARKED} ${MALE}`,
      `${DOCH_QUOTED} ${MALE}`,
      `${DOCH_MARKED} ${YOMI}`,
      `${SHALOM}, ${DOCH}${MALE} ${OLAM}`,
    ]
    for (const ask of asks) expect(isReportAsk(ask), ask).toBe(true)
  })

  test('any other prompt is not a report', () => {
    const others = [
      '',
      'report',
      'a full and honest report',
      'it was fully reported',
      'daily notes',
      DOCH,
      `${SHALOM} ${OLAM}`,
    ]
    for (const other of others) expect(isReportAsk(other), other).toBe(false)
  })
})

describe('the folders above', () => {
  test('a Windows folder walks up to its drive', () => {
    expect(foldersUp('C:\\work\\demo')).toEqual(['C:\\work\\demo', 'C:\\work', 'C:'])
    expect(foldersUp('C:\\work\\demo\\')).toEqual(['C:\\work\\demo', 'C:\\work', 'C:'])
    expect(foldersUp('C:/work/demo')).toEqual(['C:/work/demo', 'C:/work', 'C:'])
    expect(foldersUp('C:\\')).toEqual(['C:'])
    expect(foldersUp('J:\\Projects\\My Site/src')).toEqual([
      'J:\\Projects\\My Site/src',
      'J:\\Projects\\My Site',
      'J:\\Projects',
      'J:',
    ])
  })

  test('a network folder walks up to its share and no further', () => {
    expect(foldersUp('\\\\server\\share\\site\\src')).toEqual([
      '\\\\server\\share\\site\\src',
      '\\\\server\\share\\site',
      '\\\\server\\share',
    ])
    expect(foldersUp('\\\\server\\share\\')).toEqual(['\\\\server\\share'])
    expect(foldersUp('//server/share/site')).toEqual(['//server/share/site', '//server/share'])
  })

  test('a POSIX folder walks up to the root', () => {
    expect(foldersUp('/home/owner/site')).toEqual(['/home/owner/site', '/home/owner', '/home', ''])
    expect(foldersUp('/home/owner/site/')).toEqual(['/home/owner/site', '/home/owner', '/home', ''])
    expect(foldersUp('/')).toEqual([''])
  })

  test('the walk is bounded however deep the folder is', () => {
    const deep = `/${Array.from({ length: 200 }, (_, at) => `d${at}`).join('/')}`
    expect(foldersUp(deep)).toHaveLength(40)
    expect(foldersUp(deep)[0]).toBe(deep)
  })
})

// ---------------------------------------------------------------------------
// The counting and the note, called directly
// ---------------------------------------------------------------------------

/** Rules with the usual numbers, any of them replaced. */
const rulesWith = (limits: Partial<ReplyLimits> = {}, hasDashRule = true): ReplyRules => ({
  hasDashRule,
  limits: { lines: 3, words: 14, reportLines: 16, hasOpenFindings: true, ...limits },
})

const CLEAN = { wordyLines: 0, packedLines: 0, doubleHyphens: 0 }

const FINDINGS = [
  '----',
  '**1 Status column is unclear**',
  '',
  'Problem:',
  'The column shows the stage, not the item.',
  '',
  'Proposal:',
  'Pick one meaning and label it.',
  '',
  'In practice:',
  'Everyone reads the column the same way.',
  '',
  'Your workflow:',
  'No change for you.',
].join('\n')

describe('the counting', () => {
  test('prose lines leave out fenced blocks, headings, dividers and blank lines', () => {
    const scaffold = [
      '----',
      '# What changed',
      '',
      'The first line.',
      'The second line.',
      '```',
      'code line one',
      'code line two',
      '```',
      '~~~',
      'more code',
      'and more',
      '~~~',
      '---',
      '## A smaller heading',
      '   ',
      'The third line.',
    ].join('\n')

    expect(countReply(scaffold, rulesWith(), false)).toEqual(CLEAN)
    expect(countReply(`${scaffold}\nThe fourth line.`, rulesWith(), false)).toEqual({
      ...CLEAN,
      tooLong: { lines: 4, limit: 3 },
    })
    // The same reply with Windows line breaks counts the same.
    expect(countReply(`${scaffold}\nThe fourth line.`.replace(/\n/g, '\r\n'), rulesWith(), false)).toEqual({
      ...CLEAN,
      tooLong: { lines: 4, limit: 3 },
    })
  })

  test('a table row and a list item are prose lines like any other', () => {
    const table = '| a | b |\n|---|---|\n| c | d |\n- one more'
    expect(countReply(table, rulesWith(), false).tooLong).toEqual({ lines: 4, limit: 3 })
  })

  test('an unclosed fence hides everything after it', () => {
    const reply = `One line.\n\`\`\`\n${lines(9)}`
    expect(countReply(reply, rulesWith(), false)).toEqual(CLEAN)
  })

  test('a line past the word cap is counted, and the cap is the project number', () => {
    expect(countReply(words(14), rulesWith(), false)).toEqual(CLEAN)
    expect(countReply(words(15), rulesWith(), false)).toEqual({ ...CLEAN, wordyLines: 1 })
    expect(countReply(words(15), rulesWith({ words: 16 }), false)).toEqual(CLEAN)
    expect(countReply(`${words(15)}\n${words(3)}\n${words(20)}`, rulesWith(), false).wordyLines).toBe(2)
  })

  test('inline code is one word, and a mark with no letter is none', () => {
    const coded = `${words(12)} \`npm run build and then four more words\``
    expect(countReply(coded, rulesWith(), false)).toEqual(CLEAN)
    expect(countReply(`${words(14)} | -> + ...`, rulesWith(), false)).toEqual(CLEAN)
    // Hebrew words are words.
    expect(countReply(`${words(13)} ${SHALOM} ${OLAM}`, rulesWith(), false).wordyLines).toBe(1)
  })

  test('headings and fenced lines are never too wordy', () => {
    const reply = `# ${words(30)}\n\`\`\`\n${words(30)}\n\`\`\`\n~~~\n${words(30)}\n~~~`
    expect(countReply(reply, rulesWith(), false)).toEqual(CLEAN)
  })

  test('a line packs two sentences when a full stop is followed by another sentence', () => {
    const expectPacked = (reply: string, count: number): void => {
      expect(countReply(reply, rulesWith(), false).packedLines, reply).toBe(count)
    }

    expectPacked('It works. Next comes the test.', 1)
    expectPacked('Really? Yes it is.', 1)
    expectPacked('Done! Now the rest.', 1)
    expectPacked('It is version 2. Then came 3.', 1)
    expectPacked('He said "stop". Then he left.', 1)
    expectPacked('(An aside.) Then the point.', 0)
    expectPacked('(An aside). Then the point.', 1)
    expectPacked('Read `a.b`. Next the other file.', 1)

    expectPacked('It works.', 0)
    expectPacked('It works, and the test passes.', 0)
    expectPacked('lowercase follows. like this', 0)
    expectPacked('See e.g. The docs for more.', 0)
    expectPacked('Ask Dr. Smith first.', 0)
    expectPacked('It ships at 9 a.m. Monday.', 0)
    expectPacked('Run `one. Two` as written', 0)
    expectPacked('```\nOne. Two.\n```', 0)
    expectPacked('~~~\nOne. Two.\n~~~', 0)

    expectPacked('One. Two.\nThree. Four.\nFive only.', 2)
  })

  test('a findings list has no line ceiling where the project says so', () => {
    expect(countReply(FINDINGS, rulesWith(), false)).toEqual(CLEAN)
    // Where the project does not say so, the ceiling holds.
    expect(countReply(FINDINGS, rulesWith({ hasOpenFindings: false }), false)).toEqual({
      ...CLEAN,
      tooLong: { lines: 9, limit: 3 },
    })
  })

  test('the word cap still holds inside a findings list', () => {
    const wordy = FINDINGS.replace('Pick one meaning and label it.', words(15))
    expect(countReply(wordy, rulesWith(), false)).toEqual({ ...CLEAN, wordyLines: 1 })
  })

  test('the two labels must each stand alone on a line, outside a fence', () => {
    const tooLong = { lines: 5, limit: 3 }
    const inline = 'Problem: the column is unclear.\nProposal:\nOne.\nTwo.\nThree.'
    expect(countReply(inline, rulesWith(), false).tooLong).toEqual(tooLong)

    const onlyOne = 'Problem:\nOne.\nTwo.\nThree.\nFour.'
    expect(countReply(onlyOne, rulesWith(), false).tooLong).toEqual(tooLong)

    const fenced = '```\nProblem:\nProposal:\n```\nOne.\nTwo.\nThree.\nFour.\nFive.'
    expect(countReply(fenced, rulesWith(), false).tooLong).toEqual(tooLong)

    // Spaces around a label are fine.
    const spaced = '  Problem:  \nOne.\n Proposal: \nTwo.\nThree.'
    expect(countReply(spaced, rulesWith(), false).tooLong).toBeUndefined()
  })

  test('a report is held to the report ceiling', () => {
    expect(countReply(lines(16), rulesWith(), true)).toEqual(CLEAN)
    expect(countReply(lines(17), rulesWith(), true).tooLong).toEqual({ lines: 17, limit: 16 })
    expect(countReply(lines(16), rulesWith(), false).tooLong).toEqual({ lines: 16, limit: 3 })
    // A project that states no report ceiling has none for a report.
    expect(countReply(lines(40), rulesWith({ reportLines: undefined }), true)).toEqual(CLEAN)
    // The word cap holds for a report too.
    expect(countReply(`${lines(5)}\n${words(15)}`, rulesWith(), true)).toEqual({ ...CLEAN, wordyLines: 1 })
  })

  test('a double hyphen counts only alone between two words', () => {
    const pairs = (reply: string): number => countReply(reply, rulesWith(), false).doubleHyphens

    expect(pairs('This works -- mostly.')).toBe(1)
    expect(pairs('a -- b -- c')).toBe(2)
    expect(pairs(`${SHALOM} -- ${OLAM}`)).toBe(1)
    expect(pairs('one -- two\nthree -- four')).toBe(2)

    expect(pairs('Run it with --apply to write.')).toBe(0)
    expect(pairs('npm test -- --watch')).toBe(0)
    expect(pairs('a--b')).toBe(0)
    expect(pairs('-- at the start')).toBe(0)
    expect(pairs('at the end --')).toBe(0)
    expect(pairs('----\n---\n| -- | -- |\n|--|--|')).toBe(0)
    expect(pairs('`a -- b` in code')).toBe(0)
    expect(pairs('```\na -- b\n```')).toBe(0)
    expect(pairs('~~~\na -- b\n~~~')).toBe(0)
    expect(pairs('1. Run:\n\n    ```\n    git add -- file\n    ```')).toBe(0)
  })

  test('a double hyphen is counted only where the project has the dash rule', () => {
    expect(countReply('This works -- mostly.', rulesWith({}, false), false)).toEqual(CLEAN)
  })

  test('rules with no limits count no lines and no words', () => {
    const reply = `${lines(9)}\n${words(40)}\nOne. Two.\na -- b`
    expect(countReply(reply, { hasDashRule: true }, false)).toEqual({ ...CLEAN, doubleHyphens: 1 })
    expect(countReply(reply, { hasDashRule: false }, false)).toEqual(CLEAN)
  })
})

describe('the note', () => {
  test('a clean reply has no note', () => {
    expect(replyNote(CLEAN, rulesWith())).toBeUndefined()
  })

  test('each problem has its own plain words', () => {
    expect(replyNote({ ...CLEAN, tooLong: { lines: 5, limit: 3 } }, rulesWith())).toBe('Reply: 5 lines, limit 3')
    expect(replyNote({ ...CLEAN, wordyLines: 2 }, rulesWith())).toBe('Reply: 2 lines over 14 words')
    expect(replyNote({ ...CLEAN, wordyLines: 1 }, rulesWith({ words: 16 }))).toBe('Reply: 1 line over 16 words')
    expect(replyNote({ ...CLEAN, packedLines: 1 }, rulesWith())).toBe('Reply: 1 line holds two sentences')
    expect(replyNote({ ...CLEAN, packedLines: 2 }, rulesWith())).toBe('Reply: 2 lines hold two sentences')
    expect(replyNote({ ...CLEAN, doubleHyphens: 1 }, rulesWith())).toBe('Reply: 1 double hyphen')
    expect(replyNote({ ...CLEAN, doubleHyphens: 3 }, rulesWith())).toBe('Reply: 3 double hyphens')
  })

  test('several problems share the one line, the worst first', () => {
    const all = { tooLong: { lines: 5, limit: 3 }, wordyLines: 2, packedLines: 1, doubleHyphens: 3 }
    expect(replyNote(all, rulesWith())).toBe(
      `Reply: 5 lines, limit 3 ${DOT} 2 lines over 14 words ${DOT} 1 line holds two sentences ${DOT} 3 double hyphens`,
    )
  })

  test('a project that states no limits is never noted', () => {
    expect(replyNote({ ...CLEAN, doubleHyphens: 2 }, { hasDashRule: true })).toBeUndefined()
  })

  test('the note itself holds no long dash', () => {
    const all = { tooLong: { lines: 5, limit: 3 }, wordyLines: 2, packedLines: 1, doubleHyphens: 3 }
    const note = replyNote(all, rulesWith()) ?? ''
    expect(fixLongDashes(note)).toBe(note)
    expect(countReply(note, rulesWith(), false).doubleHyphens).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// The hooks, through the engine
// ---------------------------------------------------------------------------

type RowInput = Args<'session.append'>
type Content = RowInput['message']['content']

/** What a test saw the plugin do to the world beneath it. */
type Seen = {
  /** Every status line call, in order; undefined is a clear. */
  status: Array<string | undefined>
  /** Every row as it reached the conversation's store, in order. */
  kept: Array<Frozen<RowInput>>
  /** Every path the plugin looked for, in order. */
  asked: string[]
}

type Disk = {
  /** Every answer about the rules file waits this long on the test's clock. */
  delayMs?: number
  /** The disk refuses every question about the rules file. */
  isBroken?: boolean
  /** The file is listed and cannot be read. */
  isUnreadable?: boolean
}

const HOME = '/work/demo'
const RULES_PATH = `${HOME}/project-os/Conversations.md`
const LIMITS_TEXT = [
  'Short by default: 3 prose lines, each at most 14 WORDS.',
  'A findings list (rule 10) has no ceiling.',
  'Otherwise it lifts ONLY on an owner report phrase, to 6 prose lines:',
].join('\n')
const DASH_TEXT = `Never write a dash longer than a hyphen: not \`${EM}\`, not \`${EN}\`, not a \`--\` pair.`
const KIT_PROJECT = { [RULES_PATH]: `${LIMITS_TEXT}\n${DASH_TEXT}` }

// A path as the test wrote it: the engine hands a hook the path resolved for
// the machine it runs on, with that machine's separators and drive.
const place = (path: string): string => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

/**
 * Stands in for everything beneath the plugin: a disk holding `files`, a
 * clock that moves only when the test moves it, a status line, and the
 * engine's own end of each event the tests raise.
 *
 * Only the reply rules file is this disk's business. The plugin's other
 * parts hook the same session and may look for files of their own: to them
 * the disk is empty, at once, so nothing they do changes what is seen here.
 */
const world = (on: On, files: Readonly<Record<string, string>> = {}, disk: Disk = {}) => {
  const seen: Seen = { status: [], kept: [], asked: [] }
  const clock = mock.clock(on)

  on('fs.exists', async (_$, e) => {
    const path = place(e.path)
    if (!path.endsWith('/project-os/Conversations.md')) return { value: false }
    seen.asked.push(path)
    if (disk.delayMs !== undefined) await clock.sleep(disk.delayMs)
    if (disk.isBroken === true) return { deny: 'the disk is not answering' }

    return { value: Object.hasOwn(files, path) }
  })
  on('fs.read', (_$, e) => {
    const text = files[place(e.path)]
    if (text === undefined || disk.isUnreadable === true) return { deny: `cannot read ${e.path}` }

    return { value: text }
  })
  on('ui.status', (_$, e) => {
    seen.status.push(e.text)

    return { value: undefined }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('session.append', (_$, e, next) => {
    seen.kept.push(e)

    return next(e)
  })

  return { seen, clock }
}

const open = ($: Engine, surface: RenderSurface | null, cwd: string = HOME) =>
  $.session.start({ cwd, surface, isInteractive: surface !== null })

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

// The test kit of these builds (2.1.286 and 2.1.288) keeps no store beneath
// session.append: a row runs the whole chain down to the test's own hook, and
// the call then rejects for want of a store. What reached that hook is the
// row the conversation would keep, so the tests read it there (`seen.kept`)
// and let that one rejection go. Any other failure still fails the test.
const keep = async ($: Engine, input: RowInput): Promise<void> => {
  await $.session.append(input).then(
    () => undefined,
    (error: unknown) => {
      if (!String(error).includes('no implementation for session.append')) throw error
    },
  )
}

const keptTexts = (seen: Seen): unknown[] =>
  seen.kept.map(input => input.message.content.map(block => block.text))

/** One whole main turn: the prompt, the reply's text blocks, the end. */
const turn = async ($: Engine, id: string, prompt: string, blocks: readonly string[]) => {
  await $.turn.start({ text: prompt, turnId: id })
  for (const block of blocks) await keep($, row([text(block)]))

  return $.turn.complete({
    answer: blocks.at(-1) ?? '',
    durationMs: 1,
    isAborted: false,
    turnId: id,
    reason: 'answer',
  })
}

const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]

/** Declares one test per surface, so nothing here leans on where it draws. */
const onEachSurface = (
  name: string,
  body: ($: Engine, on: On, surface: Surface) => Promise<void>,
): void => {
  for (const surface of SURFACES) test(`${name}, on ${surface}`, ($, on) => body($, on, surface))
}

describe('the dash fix as the reply is kept', () => {
  onEachSurface('a long dash is fixed in the text block and nowhere else', async ($, on, surface) => {
    const { seen } = world(on, KIT_PROJECT)
    await open($, surface)

    const thinking = { type: 'thinking', thinking: `think ${EM} hard`, signature: 'sig' }
    const toolUse = { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: `echo ${EM}` } }
    const sent = row([thinking, text(`Done ${EM} it works.\nPages 3${EN}5 ${EM}\n${EM} and more.`), toolUse])
    await keep($, sent)

    expect(seen.kept).toHaveLength(1)
    expect(seen.kept[0]?.message.content).toEqual([
      thinking,
      text('Done, it works.\nPages 3-5,\n- and more.'),
      toolUse,
    ])
    // Everything but the content is the engine's and comes through as sent.
    expect(seen.kept[0]?.message.type).toBe('assistant')
    expect(seen.kept[0]?.message.role).toBe('assistant')
    expect(seen.kept[0]?.door).toBe('response')
    expect(seen.kept[0]?.origin).toEqual(sent.origin)
    expect(seen.kept[0]?.uuid).toBe(sent.uuid)
  })

  onEachSurface('a reply with no long dash is handed on as it came', async ($, on, surface) => {
    const { seen } = world(on, KIT_PROJECT)
    await open($, surface)

    const sent = row([text('All good here, with a -- pair and --apply.\n----\n| a | b |')])
    await keep($, sent)

    expect(seen.kept).toEqual([sent])
  })

  onEachSurface('code, fences and Hebrew in a kept reply', async ($, on, surface) => {
    const { seen } = world(on, KIT_PROJECT)
    await open($, surface)

    await keep(
      $,
      row([
        text(
          [
            `Use \`a ${EM} b\` here ${EM} always.`,
            '```',
            `code ${EM} stays`,
            '```',
            '~~~',
            `code ${EN} stays`,
            '~~~',
            `${SHALOM} ${EM} ${OLAM}`,
            `| a ${EM} b | ${EM} |`,
            'run --apply -- now',
          ].join('\n'),
        ),
      ]),
    )

    expect(keptTexts(seen)).toEqual([
      [
        [
          `Use \`a ${EM} b\` here, always.`,
          '```',
          `code ${EM} stays`,
          '```',
          '~~~',
          `code ${EN} stays`,
          '~~~',
          `${SHALOM}, ${OLAM}`,
          '| a, b | - |',
          'run --apply -- now',
        ].join('\n'),
      ],
    ])
  })

  onEachSurface('several text blocks in one row are each fixed', async ($, on, surface) => {
    const { seen } = world(on, KIT_PROJECT)
    await open($, surface)

    await keep($, row([text(`one ${EM} two`), text('nothing here'), text(`three${EN}four`)]))

    expect(keptTexts(seen)).toEqual([['one, two', 'nothing here', 'three-four']])
  })

  // Claude Code stores an emptied block as "(no content)", shows the owner
  // nothing, and may ask the model again in the same turn.
  onEachSurface('a reply that is only a dash is kept as a hyphen, never as nothing', async ($, on, surface) => {
    const { seen } = world(on, KIT_PROJECT)
    await open($, surface)

    await keep($, row([text(EM)]))
    await keep($, row([text(`  ${EM}  `)]))
    await keep($, row([text(`${EN}\n`), text('and words')]))

    expect(keptTexts(seen)).toEqual([['-'], ['  -  '], ['-\n', 'and words']])
    for (const kept of keptTexts(seen).flat()) expect(String(kept).trim()).not.toBe('')
  })

  onEachSurface('a range and a list keep their meaning in a kept reply', async ($, on, surface) => {
    const { seen } = world(on, KIT_PROJECT)
    await open($, surface)

    await keep(
      $,
      row([
        text(
          [
            `Open Monday${EN}Friday, 9am${EN}5pm, versions v1.2${EN}v1.4.`,
            `${EN} first item`,
            `${EN} second item`,
          ].join('\n'),
        ),
      ]),
    )

    expect(keptTexts(seen)).toEqual([
      [['Open Monday-Friday, 9am-5pm, versions v1.2-v1.4.', '- first item', '- second item'].join('\n')],
    ])
  })

  onEachSurface('a subagent row is never touched', async ($, on, surface) => {
    const { seen } = world(on, KIT_PROJECT)
    await open($, surface)

    const sent = row([text(`the helper wrote ${EM} this`)], { agentId: 'agent-7' })
    await keep($, sent)

    expect(seen.kept).toEqual([sent])
  })

  onEachSurface('a line the engine wrote in the model place is not fixed or counted', async ($, on, surface) => {
    const { seen } = world(on, KIT_PROJECT)
    await open($, surface)

    // As the engine appends its own notice: the model named as its stand-in.
    const sent = row([], {
      message: { type: 'assistant', content: [text(`Not signed in ${EM} please sign in\n${lines(9)}`)] },
      origin: { kind: 'model', model: '<synthetic>' },
    })
    await $.turn.start({ text: 'hello', turnId: 't1' })
    await keep($, sent)
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

    expect(seen.kept).toEqual([sent])
    expect(seen.status).toEqual([])
  })

  onEachSurface('a tool call, a tool result, thinking and the prompt are never touched', async ($, on, surface) => {
    const { seen } = world(on, KIT_PROJECT)
    await open($, surface)

    const toolCall = row([{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: `echo ${EM}` } }])
    const thinking = row([{ type: 'thinking', thinking: `a ${EM} b`, signature: 'sig' }])
    const toolResult = row([{ type: 'tool_result', tool_use_id: 'tool-1', content: `out ${EM} put` }], {
      message: {
        type: 'user',
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: `out ${EM} put` }],
      },
      door: 'tool-result',
      origin: { kind: 'tool', tool: 'Bash' },
    })
    const prompt = row([], {
      message: { type: 'user', role: 'user', content: [text(`the owner typed ${EM} this`)] },
      door: 'prompt',
      origin: { kind: 'composer' },
    })
    const notice = row([], {
      message: { type: 'system', name: 'informational', content: [text(`a notice ${EM} here`)] },
      door: 'notice',
      origin: { kind: 'composer' },
    })

    for (const sent of [toolCall, thinking, toolResult, prompt, notice]) await keep($, sent)

    expect(seen.kept).toEqual([toolCall, thinking, toolResult, prompt, notice])
  })
})

describe('which projects the check runs in', () => {
  onEachSurface('a project without Conversations.md is left alone', async ($, on, surface) => {
    const { seen } = world(on)
    expect(await open($, surface, `${HOME}/deep/er`)).toEqual({ cwd: `${HOME}/deep/er` })

    const sent = row([text(`a ${EM} b\n${lines(9)}\nOne. Two.\nc -- d`)])
    await $.turn.start({ text: 'hello', turnId: 't1' })
    await keep($, sent)
    await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

    expect(seen.kept).toEqual([sent])
    expect(seen.status).toEqual([])
    // It looked once in every folder from the session's own up to the root.
    expect(seen.asked).toEqual([
      '/work/demo/deep/er/project-os/Conversations.md',
      '/work/demo/deep/project-os/Conversations.md',
      '/work/demo/project-os/Conversations.md',
      '/work/project-os/Conversations.md',
      '/project-os/Conversations.md',
    ])
  })

  onEachSurface('a Conversations.md without the sentences is left alone', async ($, on, surface) => {
    const { seen } = world(on, { [RULES_PATH]: '# Reply rules\n\nBe kind. Keep it short.\n' })
    await open($, surface)

    const sent = row([text(`a ${EM} b\n${lines(9)}\nOne. Two.\nc -- d`)])
    await $.turn.start({ text: 'hello', turnId: 't1' })
    await keep($, sent)
    await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

    expect(seen.kept).toEqual([sent])
    expect(seen.status).toEqual([])
  })

  onEachSurface('with the dash rule alone, dashes are fixed and nothing is noted', async ($, on, surface) => {
    const { seen } = world(on, { [RULES_PATH]: DASH_TEXT })
    await open($, surface)

    await turn($, 't1', 'hello', [`a ${EM} b\n${lines(9)}\nOne. Two.\nc -- d`])

    expect(keptTexts(seen)).toEqual([[`a, b\n${lines(9)}\nOne. Two.\nc -- d`]])
    expect(seen.status).toEqual([])
  })

  onEachSurface('with the limits alone, dashes stay and the limits are noted', async ($, on, surface) => {
    const { seen } = world(on, { [RULES_PATH]: LIMITS_TEXT })
    await open($, surface)

    const reply = `a ${EM} b\n${lines(4)}\nc -- d`
    await turn($, 't1', 'hello', [reply])

    expect(keptTexts(seen)).toEqual([[reply]])
    expect(seen.status).toEqual(['Reply: 6 lines, limit 3'])
  })

  onEachSurface('the file is found in a folder above the one the session opened in', async ($, on, surface) => {
    const { seen } = world(on, KIT_PROJECT)
    await open($, surface, `${HOME}/src/deep`)

    await keep($, row([text(`a ${EM} b`)]))

    expect(keptTexts(seen)).toEqual([['a, b']])
    // Nearest first, and no further once it is found.
    expect(seen.asked).toEqual([
      '/work/demo/src/deep/project-os/Conversations.md',
      '/work/demo/src/project-os/Conversations.md',
      '/work/demo/project-os/Conversations.md',
    ])
  })

  onEachSurface('the nearest file decides', async ($, on, surface) => {
    const { seen } = world(on, {
      '/work/project-os/Conversations.md': LIMITS_TEXT,
      [RULES_PATH]: DASH_TEXT,
    })
    await open($, surface)

    await turn($, 't1', 'hello', [`a ${EM} b\n${lines(9)}`])

    expect(keptTexts(seen)).toEqual([[`a, b\n${lines(9)}`]])
    expect(seen.status).toEqual([])
    expect(seen.asked).toEqual([RULES_PATH])
  })

  onEachSurface('nothing is touched before session start has read the rules', async ($, on, surface) => {
    const { seen } = world(on, KIT_PROJECT)

    const sent = row([text(`a ${EM} b\n${lines(9)}`)])
    await $.turn.start({ text: `hello from ${surface}`, turnId: 't1' })
    await keep($, sent)
    await $.turn.complete({ answer: lines(9), durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

    expect(seen.kept).toEqual([sent])
    expect(seen.status).toEqual([])
    expect(seen.asked).toEqual([])
  })

  test('a session that draws nowhere yet is checked the same', async ($, on) => {
    const { seen } = world(on, KIT_PROJECT)
    expect(await open($, null)).toEqual({ cwd: HOME })

    await turn($, 't1', 'hello', [`a ${EM} b\n${lines(4)}`])

    expect(keptTexts(seen)).toEqual([[`a, b\n${lines(4)}`]])
    expect(seen.status).toEqual(['Reply: 5 lines, limit 3'])
  })
})

describe('the note when the turn ends', () => {
  onEachSurface('a long reply is noted and a clean one clears the note', async ($, on, surface) => {
    const { seen } = world(on, KIT_PROJECT)
    await open($, surface)

    expect(await turn($, 't1', 'hello', [lines(5)])).toEqual({ text: lines(5) })
    expect(seen.status).toEqual(['Reply: 5 lines, limit 3'])

    await turn($, 't2', 'and again', [lines(3)])
    expect(seen.status).toEqual(['Reply: 5 lines, limit 3', undefined])

    // The reply itself is never rewritten for length.
    expect(keptTexts(seen)).toEqual([[lines(5)], [lines(3)]])
  })

  onEachSurface('the numbers come from the project file', async ($, on, surface) => {
    const { seen } = world(on, {
      [RULES_PATH]: 'Short by default: 2 prose lines, each at most 5 WORDS.\nA report: 4 prose lines.',
    })
    await open($, surface)

    await turn($, 't1', 'hello', [`${words(5)}\n${words(6)}\n${words(2)}`])
    await turn($, 't2', 'a full report please', [lines(5)])

    expect(seen.status).toEqual([
      `Reply: 3 lines, limit 2 ${DOT} 1 line over 5 words`,
      'Reply: 5 lines, limit 4',
    ])
  })

  onEachSurface('two sentences on a line and a double hyphen are noted, not rewritten', async ($, on, surface) => {
    const { seen } = world(on, KIT_PROJECT)
    await open($, surface)

    const reply = 'It works. Next comes the test.\nThis part -- mostly.\nRun it with --apply.'
    await turn($, 't1', 'hello', [reply])

    expect(keptTexts(seen)).toEqual([[reply]])
    expect(seen.status).toEqual([`Reply: 1 line holds two sentences ${DOT} 1 double hyphen`])
  })

  onEachSurface('every problem is on the one line, the worst first', async ($, on, surface) => {
    const { seen } = world(on, KIT_PROJECT)
    await open($, surface)

    await turn($, 't1', 'hello', [`One. Two.\n${words(15)}\nThis part -- mostly.\nLine four.\nLine five.`])

    expect(seen.status).toEqual([
      `Reply: 5 lines, limit 3 ${DOT} 1 line over 14 words ${DOT} 1 line holds two sentences ${DOT} 1 double hyphen`,
    ])
  })

  onEachSurface('a report the owner asked for gets the report ceiling', async ($, on, surface) => {
    const { seen } = world(on, KIT_PROJECT)
    await open($, surface)

    await turn($, 't1', 'Please give me a full report on this', [lines(6)])
    await turn($, 't2', 'Daily report 2026-10-01', [lines(7)])
    await turn($, 't3', `${DOCH_MARKED} ${MALE}`, [lines(6)])
    await turn($, 't4', 'thanks', [lines(4)])

    expect(seen.status).toEqual([
      undefined,
      'Reply: 7 lines, limit 6',
      undefined,
      'Reply: 4 lines, limit 3',
    ])
  })

  onEachSurface('a report asked for over the running turn lifts that turn', async ($, on, surface) => {
    const { seen } = world(on, KIT_PROJECT)
    await open($, surface)

    const over = async (id: string, typed: Args<'prompt.submit'>) => {
      await $.turn.start({ text: 'hello', turnId: id })
      expect(await $.prompt.submit(typed)).toEqual({ text: typed.text })
      await keep($, row([text(lines(6))]))
      await $.turn.complete({ answer: lines(6), durationMs: 1, isAborted: false, turnId: id, reason: 'answer' })
    }

    // The owner's own words lift it, however they reach the session.
    await over('t1', { text: 'make it a FULL REPORT', wait: false, origin: { kind: 'composer' }, turnId: 't1' })
    await over('t2', { text: 'full report', wait: true, origin: { kind: 'bridge' }, turnId: 't2' })
    await over('t3', { text: 'daily report', wait: false, origin: { kind: 'sdk' }, turnId: 't3' })
    // A notification, another session, or a prompt over another turn do not.
    await over('t4', { text: 'full report', wait: false, origin: { kind: 'task-notification' }, turnId: 't4' })
    await over('t5', { text: 'full report', wait: false, origin: { kind: 'peer' }, turnId: 't5' })
    await over('t6', { text: 'full report', wait: false, origin: { kind: 'composer' }, turnId: 't-other' })
    await over('t7', { text: 'full report', wait: false, origin: { kind: 'composer' } })
    await over('t8', { text: 'no such ask', wait: false, origin: { kind: 'composer' }, turnId: 't8' })

    const noted = 'Reply: 6 lines, limit 3'
    expect(seen.status).toEqual([undefined, undefined, undefined, noted, noted, noted, noted, noted])
  })

  onEachSurface('a findings list has no line ceiling, and the word cap still holds', async ($, on, surface) => {
    const { seen } = world(on, KIT_PROJECT)
    await open($, surface)

    await turn($, 't1', 'the review please', [FINDINGS])
    await turn($, 't2', 'again', [FINDINGS.replace('Pick one meaning and label it.', words(15))])

    expect(seen.status).toEqual([undefined, 'Reply: 1 line over 14 words'])
  })

  onEachSurface('a findings list is held to the ceiling where the file does not lift it', async ($, on, surface) => {
    const { seen } = world(on, {
      [RULES_PATH]: 'Short by default: 3 prose lines, each at most 14 WORDS.',
    })
    await open($, surface)

    await turn($, 't1', 'the review please', [FINDINGS])

    expect(seen.status).toEqual(['Reply: 9 lines, limit 3'])
  })

  onEachSurface('the last text the model wrote in the turn is what is counted', async ($, on, surface) => {
    const { seen } = world(on, KIT_PROJECT)
    await open($, surface)

    await $.turn.start({ text: 'hello', turnId: 't1' })
    await keep($, row([text(lines(8))]))
    await keep($, row([{ type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'a.md' } }]))
    await keep($, row([{ type: 'thinking', thinking: lines(9), signature: 'sig' }]))
    await keep($, row([text(lines(9))], { agentId: 'agent-7' }))
    await keep($, row([text('   ')]))
    await keep($, row([text('All done.')]))
    await $.turn.complete({ answer: 'All done.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

    expect(seen.status).toEqual([undefined])
  })

  onEachSurface('a tool call or a blank block after the last text does not hide it', async ($, on, surface) => {
    const { seen } = world(on, KIT_PROJECT)
    await open($, surface)

    await $.turn.start({ text: 'hello', turnId: 't1' })
    await keep($, row([text(lines(5))]))
    await keep($, row([{ type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'a.md' } }]))
    await keep($, row([text(' \n ')]))
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

    expect(seen.status).toEqual(['Reply: 5 lines, limit 3'])
  })

  onEachSurface('the reply is counted as it was kept, after the dash fix', async ($, on, surface) => {
    const { seen } = world(on, KIT_PROJECT)
    await open($, surface)

    // Fourteen words as written, fifteen once the dash became a comma.
    await turn($, 't1', 'hello', [`${words(13)} x${EM}y`])

    expect(keptTexts(seen)).toEqual([[`${words(13)} x, y`]])
    expect(seen.status).toEqual(['Reply: 1 line over 14 words'])
  })

  onEachSurface('a subagent turn and a turn that did not end on an answer are not counted', async ($, on, surface) => {
    const { seen } = world(on, KIT_PROJECT)
    await open($, surface)

    await $.turn.start({ text: 'hello', turnId: 't1' })
    await keep($, row([text(lines(5))]))

    const ended = { answer: lines(9), durationMs: 1, turnId: 't1' }
    await $.turn.complete({ ...ended, isAborted: false, reason: 'answer', agentId: 'agent-7', turnId: 'helper-1' })
    await $.turn.complete({ ...ended, isAborted: true, reason: 'aborted' })
    await $.turn.complete({ ...ended, isAborted: false, reason: 'error' })
    await $.turn.complete({
      ...ended,
      isAborted: false,
      reason: 'refusal',
      refusal: { category: null, explanation: null },
    })
    expect(seen.status).toEqual([])

    // The same turn ending on its answer is counted, by its own rows.
    await $.turn.complete({ ...ended, isAborted: false, reason: 'answer' })
    expect(seen.status).toEqual(['Reply: 5 lines, limit 3'])
  })

  onEachSurface('with no row seen, the answer the turn ended on is counted', async ($, on, surface) => {
    const { seen } = world(on, KIT_PROJECT)
    await open($, surface)

    await $.turn.start({ text: 'hello', turnId: 't1' })
    await $.turn.complete({ answer: lines(5), durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(seen.status).toEqual(['Reply: 5 lines, limit 3'])

    // A turn the check never saw start is counted by its own answer too, and
    // never by what an earlier turn wrote or was asked for.
    await turn($, 't2', 'a full report', [lines(6)])
    await $.turn.complete({ answer: lines(4), durationMs: 1, isAborted: false, turnId: 't9', reason: 'answer' })
    expect(seen.status).toEqual(['Reply: 5 lines, limit 3', undefined, 'Reply: 4 lines, limit 3'])
  })

  onEachSurface('a turn with no text leaves the note as it stands', async ($, on, surface) => {
    const { seen } = world(on, KIT_PROJECT)
    await open($, surface)

    await turn($, 't1', 'hello', [lines(5)])
    await $.turn.start({ text: 'and now', turnId: 't2' })
    await keep($, row([{ type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'a.md' } }]))
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })

    expect(seen.status).toEqual(['Reply: 5 lines, limit 3'])
  })

  onEachSurface('every event is handed on with its answer unchanged', async ($, on, surface) => {
    world(on, KIT_PROJECT)

    expect(await open($, surface)).toEqual({ cwd: HOME })
    expect(await $.turn.start({ text: 'a full report', turnId: 't1' })).toEqual({ turnId: 't1' })
    expect(
      await $.prompt.submit({ text: 'typed over it', wait: false, origin: { kind: 'composer' }, turnId: 't1' }),
    ).toEqual({ text: 'typed over it' })
    expect(
      await $.turn.complete({ answer: lines(9), durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' }),
    ).toEqual({ text: lines(9) })
  })
})

describe('a new conversation in the same window', () => {
  // /clear, a resume or a fork puts another conversation in the window with
  // no session start. The note spoke of a reply of the one that left.
  for (const source of ['clear', 'resume', 'fork'] as const) {
    onEachSurface(`after ${source} the note of the old conversation is taken off`, async ($, on, surface) => {
      const { seen } = world(on, KIT_PROJECT)
      await open($, surface)

      await turn($, 't1', 'hello', [lines(5)])
      expect(seen.status).toEqual(['Reply: 5 lines, limit 3'])

      expect(await $.classic.SessionStart({ source })).toEqual({})
      expect(seen.status).toEqual(['Reply: 5 lines, limit 3', undefined])

      // The check itself is still on in the new conversation.
      await turn($, 't2', 'hello again', [`a ${EM} b\n${lines(4)}`])
      expect(keptTexts(seen).at(-1)).toEqual([`a, b\n${lines(4)}`])
      expect(seen.status).toEqual(['Reply: 5 lines, limit 3', undefined, 'Reply: 5 lines, limit 3'])
    })
  }

  onEachSurface('a turn of the old conversation is forgotten with it', async ($, on, surface) => {
    const { seen } = world(on, KIT_PROJECT)
    await open($, surface)

    // A report was asked for, and the conversation was cleared before the
    // turn ended. The same turn id ending later is counted by the plain limit.
    await $.turn.start({ text: 'a full report please', turnId: 't1' })
    await keep($, row([text(lines(6))]))
    await $.classic.SessionStart({ source: 'clear' })
    await $.turn.complete({ answer: lines(6), durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

    expect(seen.status).toEqual([undefined, 'Reply: 6 lines, limit 3'])
  })

  onEachSurface('a compaction leaves the note and the running turn alone', async ($, on, surface) => {
    const { seen } = world(on, KIT_PROJECT)
    await open($, surface)

    await turn($, 't1', 'hello', [lines(5)])

    // A compaction can come in the middle of a turn: the conversation stays
    // the same one, and the turn goes on as a report if it was asked as one.
    await $.turn.start({ text: 'a full report please', turnId: 't2' })
    await keep($, row([text(lines(6))]))
    expect(await $.classic.SessionStart({ source: 'compact' })).toEqual({})
    expect(seen.status).toEqual(['Reply: 5 lines, limit 3'])

    await $.turn.complete({ answer: lines(6), durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
    expect(seen.status).toEqual(['Reply: 5 lines, limit 3', undefined])
  })

  onEachSurface('in a project without the limits nothing is touched', async ($, on, surface) => {
    const { seen } = world(on, { [RULES_PATH]: DASH_TEXT })
    await open($, surface)

    expect(await $.classic.SessionStart({ source: 'clear' })).toEqual({})
    expect(seen.status).toEqual([])
  })

  onEachSurface('in a project without the kit nothing is touched either', async ($, on, surface) => {
    const { seen } = world(on)
    await open($, surface)

    expect(await $.classic.SessionStart({ source: 'resume' })).toEqual({})
    expect(seen.status).toEqual([])
  })
})

describe('a disk that is slow or broken', () => {
  test('the session opens when the disk answers late, and the rules land after', async ($, on) => {
    const { seen, clock } = world(on, KIT_PROJECT, { delayMs: 5000 })

    let isOpen = false
    const opening = open($, 'desktop').then(() => {
      isOpen = true
    })
    await clock.advance(1999)
    expect(isOpen).toBe(false)

    // The wait runs out: the session opens without the check.
    await clock.advance(1)
    await opening
    expect(isOpen).toBe(true)
    await keep($, row([text(`a ${EM} b`)]))
    expect(keptTexts(seen)).toEqual([[`a ${EM} b`]])

    // The disk answers at last, and the check is on from there.
    await clock.advance(3000)
    await keep($, row([text(`a ${EM} b`)]))
    expect(keptTexts(seen)).toEqual([[`a ${EM} b`], ['a, b']])
  })

  onEachSurface('a disk that refuses keeps the check off and the session opens', async ($, on, surface) => {
    const { seen } = world(on, KIT_PROJECT, { isBroken: true })
    expect(await open($, surface)).toEqual({ cwd: HOME })

    const sent = row([text(`a ${EM} b`)])
    await keep($, sent)
    await $.turn.complete({ answer: lines(9), durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

    expect(seen.kept).toEqual([sent])
    expect(seen.status).toEqual([])
  })

  onEachSurface('a file that cannot be read keeps the check off and the session opens', async ($, on, surface) => {
    const { seen } = world(on, KIT_PROJECT, { isUnreadable: true })
    expect(await open($, surface)).toEqual({ cwd: HOME })

    const sent = row([text(`a ${EM} b`)])
    await keep($, sent)
    await $.turn.complete({ answer: lines(9), durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

    expect(seen.kept).toEqual([sent])
    expect(seen.status).toEqual([])
  })

  onEachSurface('a later start that cannot read the file turns the check off', async ($, on, surface) => {
    const disk: Disk = {}
    const { seen } = world(on, KIT_PROJECT, disk)

    await open($, surface)
    await keep($, row([text(`a ${EM} b`)]))
    expect(keptTexts(seen)).toEqual([['a, b']])

    disk.isUnreadable = true
    await open($, surface)
    await keep($, row([text(`a ${EM} b`)]))
    expect(keptTexts(seen)).toEqual([['a, b'], [`a ${EM} b`]])
  })
})
