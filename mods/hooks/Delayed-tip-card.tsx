// Delayed-tip-card.tsx: what a card holds when it should wait before showing.
//
// WHAT IT DOES. The card around this is hidden until the pointer rests on its
// button, as every card is, and the app opens it at once. This draws nothing
// for the first second it has room, then the words on their background. The
// app has no delay to set and a hover reaches no code of the mod's, so the
// wait lives here (owner, 2026-11-05: a second, tried on one button first).
//
// HOW IT KNOWS. A hidden card has no room. So time is counted only while the
// module's region has columns, and goes back to nothing when it has none.

import type { ClientModule } from 'claude-code'

type Props = { words: string; background: string; color: string }

type State = { isShown: boolean }

// How long the card stays empty after it opens (owner, 2026-11-05).
const WAIT_MS = 1_000
// How often the room is looked at, so the wait is this much off at most.
const LOOK_MS = 100

export const DelayedTipCard: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements

  // The clock is started once, while there is no state yet.
  if (surface.state === undefined) {
    let waited = 0

    surface.every(LOOK_MS, () => {
      waited = surface.columns > 0 ? waited + LOOK_MS : 0

      const isShown = waited >= WAIT_MS

      if (isShown !== surface.state?.isShown) {
        surface.setState({ isShown })
      }
    })
    surface.setState({ isShown: false })
  }

  return surface.state?.isShown === true ? (
    <Box backgroundColor={props.background} paddingX={1} flexShrink={0}>
      <Text color={props.color}>{props.words}</Text>
    </Box>
  ) : (
    <Box />
  )
}
