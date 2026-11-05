// Delayed-tip-button.tsx: one button that can tell how long the pointer rests.
//
// WHAT IT DOES. It draws a button, and a second into a rest it tells the row,
// which only then puts the button's card in the drawing. The app shows a card
// at once and has no delay to set, and a hover reaches no code of the mod's.
// A module like this one is the only part of a mod that hears the pointer, so
// the wait lives here (owner, 2026-11-05: a second, tried on one button first).
//
// WHAT IT TELLS THE ROW. `{ kind: 'tip', isOn }` when the card should come or
// go, and `{ kind: 'press' }` for a press: the row owns what a press does, so
// the button here does nothing else. Project-band.tsx hears both.

import type { ClientModule } from 'claude-code'

// `name` is the button's key: the row's own name for it.
type Props = { label: string; name: string }

type State = { isListening: true }

// How long the pointer rests before the card shows (owner, 2026-11-05).
const TIP_DELAY_MS = 1_000

export const DelayedTipButton: ClientModule<Props, State> = (props, surface) => {
  const { Button } = surface.elements

  // The listener is set once. It keeps what it needs itself, since nothing
  // about a rest changes what this draws.
  if (surface.state === undefined) {
    let stopWaiting: (() => void) | null = null
    let isTold = false

    surface.onPointer(event => {
      if (event.type === 'leave') {
        stopWaiting?.()
        stopWaiting = null

        if (isTold) {
          isTold = false
          surface.post({ kind: 'tip', isOn: false })
        }

        return
      }

      // A surface may report the first move and no entry, so a move starts
      // the wait too; a move during it does not start it over.
      if ((event.type === 'enter' || event.type === 'move') && stopWaiting === null && !isTold) {
        stopWaiting = surface.every(TIP_DELAY_MS, () => {
          stopWaiting?.()
          stopWaiting = null
          isTold = true
          surface.post({ kind: 'tip', isOn: true })
        })
      }
    })
    surface.setState({ isListening: true })
  }

  return <Button key={props.name} label={props.label} onPress={() => surface.post({ kind: 'press' })} />
}
