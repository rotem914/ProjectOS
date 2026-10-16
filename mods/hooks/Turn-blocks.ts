// Turn-blocks.ts - the text blocks of the main loop's current turn, as the
// conversation keeps them, newest last. The row above the message box reads
// the words a reply asks for from the last block that asks, not from the
// turn's final text alone: a note or a wrap-up line written after the report
// is that final text, and carries no word (owner, 2026-10-16, twice in one
// project). The reply check notes each block as it is kept, since it already
// hooks that event; the band clears the list when a prompt is sent and reads
// it when the turn ends.
const blocks: string[] = []

/** The turn's text blocks so far, oldest first. */
export const turnBlocks = (): readonly string[] => blocks

/** Notes one kept row's text blocks, main loop only. */
export const noteTurnBlocks = (content: ReadonlyArray<{ readonly type: string; readonly [field: string]: unknown }>): void => {
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') blocks.push(block.text)
  }
}

/** A new prompt starts a new turn. */
export const clearTurnBlocks = (): void => {
  blocks.length = 0
}
