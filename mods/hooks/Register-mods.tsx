// Register-mods.tsx: the one module Claude Code loads for this plugin.
//
// WHAT IT DOES. It switches on the plugin's parts, one after the other: the
// band above the message box and the live fix for long dashes. Each part
// lives in its own file beside this one, registers its own hooks and keeps
// its own rules. This file adds no behavior of its own.
//
// WHAT THE GUARDS DO, AND WHAT THEY CANNOT. Each part registers inside a
// guard of its own. A part that throws while it registers is left out, and
// the other part still loads. That is all a guard can catch. Claude Code
// reads this module's source before it runs any of it. When that reading
// finds something it does not accept, an event a newer Claude Code no longer
// has for one, it refuses the whole module: `register` never runs, no guard
// gets its turn, and both parts are off together. A plugin has one hooks
// module, so the two parts cannot be loaded apart either. The row then stops
// showing, long dashes stay as written, and the session itself is untouched.
//
// WHY A PART LEFT OUT IS WRITTEN DOWN. A guard that swallows a failure also
// hides its reason. So when a part is left out, one line about it goes to the
// debug log as the session starts, and nothing goes on screen. On a normal
// day every part registers, and this file then registers nothing of its own.
//
// WHY THE PARTS ARE SPELLED OUT ONE BY ONE. Claude Code reads this file
// before it loads it, and follows `on` only into a function called by name,
// on a line of its own. A list of parts walked by a loop would be shorter,
// and would be refused.

import type { Register } from 'claude-code'

import { registerProjectBand } from './Project-band'
import { registerReplyCheck } from './Reply-check'

// Claude Code lets one module put a single hook without a matcher on an
// event, and refuses the whole module on a second. The parts hook the start
// of a session too, so the hook below carries a matcher, one that every
// session start passes.
const EVERY_SESSION = { isInteractive: [true, false] } as const

// Long enough to name what went wrong, short enough for one line.
const REASON_MAX = 300

// The line to write down for a part whose registration failed.
function leftOutLine(part: string, error: unknown): string {
  const said = error instanceof Error ? error.message : String(error)

  return `${part} was left out: ${said.replace(/\s+/g, ' ').trim().slice(0, REASON_MAX)}`
}

export const register: Register = on => {
  const leftOut: string[] = []

  try {
    registerProjectBand(on)
  } catch (error) {
    leftOut.push(leftOutLine('the band above the message box', error))
  }

  try {
    registerReplyCheck(on)
  } catch (error) {
    leftOut.push(leftOutLine('the live reply check', error))
  }

  if (leftOut.length === 0) {
    return
  }

  try {
    on('session.start', EVERY_SESSION, ($, e, next) => {
      for (const line of leftOut) {
        try {
          $.ui.log(line, { to: 'debug' })
        } catch {
          // A line that cannot be written is not worth a second failure.
        }
      }

      return next(e)
    })
  } catch {
    // This hook could not be registered either. The parts that did register
    // still run, and there is nowhere left to say what was left out.
  }
}
