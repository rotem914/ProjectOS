// Project-band.tsx: the band above the message box.
//
// WHAT IT SHOWS. One compact row with three things the owner asked for: which
// project this window is in (the repository's name, in plain text), what is
// waiting in the folder the session was opened in (files to commit,
// commits to push, an update for the plugin copy of the kit), and the buttons
// that act on it.
//
// WHY IT NEVER SLOWS A SESSION. Drawing reads values the session already
// holds and does no git, file or network work. The values are gathered in the
// background, and each part is written the moment it is known: the project's
// name first, then the repository, once the row has been looked at, and the
// plugin copy from a pass of its own, so a network that does not answer
// never holds the name or the counts back. A session nobody looks at
// runs no git at all. Every git command has a time limit. A command that
// fails or runs out of time leaves its part of the row empty: a count that
// cannot be read is never guessed.
//
// WHY EVERY HOOK FALLS THROUGH. This mod loads in every Claude Code session on
// the owner's computer, in projects with the kit and without it. A mistake in
// it must cost a missing row and nothing else, so every hook catches its own
// failures and hands the event on unchanged.
//
// WHO PRESSES. Only the owner. Nothing here presses a button on the owner's
// behalf, and nothing is pushed or pulled before the owner answers a question.
// The question is asked in the row itself. A separate dialog was tried first:
// a terminal narrower than 144 columns never showed it, and one opened from
// the keyboard could not be answered from the keyboard, because the keys stay
// with the row that was pressed.

import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, On, RenderElement } from 'claude-code'

import type {
  ProjectBandAsk,
  ProjectBandBusy,
  ProjectBandFacts,
  ProjectBandOnline,
  ProjectBandRepo,
} from '../types/Mod-state'

const facts = atom({ plugin: 'projectos-mods', key: 'bandFacts' } as const, null)
const ask = atom({ plugin: 'projectos-mods', key: 'bandAsk' } as const, null)
const busy = atom({ plugin: 'projectos-mods', key: 'bandBusy' } as const, {
  isPushing: false,
  isUpdating: false,
})

// The engine lets one module put a single hook without a matcher on an event,
// and refuses to load the whole module on a second one. The other parts of
// this plugin hook the same events, so every hook here carries a matcher.
// The first two are passed by every session start and every end of a turn.
const EVERY_SESSION = { isInteractive: [true, false] } as const
const EVERY_TURN_END = { isAborted: [true, false] } as const
// Passed by every prompt, typed with or without the ask to wait its turn.
const EVERY_PROMPT = { wait: [true, false] } as const
// A conversation that takes the place of another in the same window: after
// /clear, a resume, a compaction or a fork. No session start comes with it.
const NEW_CONVERSATION = { source: ['clear', 'resume', 'compact', 'fork'] } as const

// The shortcuts a button exists for, in the order More lists them. A button
// appears only when the project's CLAUDE.md carries the phrase as a heading,
// so a project without the kit never gets a button that does nothing.
const SHORTCUTS = [
  'Go commit',
  'FAST MODE',
  'Go backup',
  'Go commit and backup',
  'Go audit',
  'Go update kit',
  'Go code review',
  'GO visual qa',
] as const
const MAIN_SHORTCUT = 'Go commit'
// The visual pass keeps the kit's heading as the words it sends, and reads
// "Go visual QA" on its button (owner, 2026-10-04).
const VISUAL_SHORTCUT = 'GO visual qa'
const VISUAL_LABEL = 'Go visual QA'
// Deep research is not a kit phrase but a command of Claude Code itself. Its
// button sits in the More list wherever this Claude Code offers the command,
// and a press runs it as /deep-research typed by the owner (2026-10-04).
const RESEARCH_SHORTCUT = '/deep-research'
const RESEARCH_COMMAND = 'deep-research'
const RESEARCH_LABEL = 'Deep Research'
// Fast mode sits beside Go commit in the row (owner, 2026-10-03). The kit's
// heading for it is the mode's name, the button reads shorter, and the words
// it sends are the ones that switch the mode on.
const FAST_SHORTCUT = 'FAST MODE'
const FAST_LABEL = 'Fast'
const FAST_SENT = 'FAST ON'
// While the mode is on the button says so, and a press switches it off
// (owner, 2026-10-04).
const FAST_ON_LABEL = 'Fast on'
const FAST_OFF_SENT = 'FAST OFF'
// The backup's age is read from the newest ZIP in the project's backups
// folder, where the kit's backup puts it. It is quiet words until the backup
// is this many days old, and a button from then on (owner, 2026-10-04).
// A press on the quiet words takes them out of the row, and runs no backup:
// they come back when the backup is a day older, or in the next conversation
// (owner, 2026-10-04).
const BACKUP_SHORTCUT = 'Go backup'
const BACKUP_FOLDER = 'backups'
const BACKUP_BUTTON_DAYS = 30
const DAY_MS = 24 * 60 * 60_000

const REFRESH_MS = 60_000
// Five minutes, where it was thirty: after the owner pushes the kit he should
// not wait half an hour for the row to say so (2026-10-04).
const PLUGIN_CHECK_MS = 5 * 60_000
// The kit's own listing of heavy files walks the whole project, so it runs
// in a pass of its own, this far apart, and is given this long.
const HEAVY_CHECK_MS = 30 * 60_000
const HEAVY_RUN_MS = 60_000
// Where a project keeps the listing: the kit's place, then the older one.
const HEAVY_SCRIPTS = ['project-os/Find-heavy-files.mjs', 'scripts/Find-heavy-files.mjs']
const LOCAL_GIT_MS = 10_000
const NETWORK_GIT_MS = 15_000
const PUSH_MS = 120_000
const REPEAT_PRESS_MS = 1_500
const LONG_TOAST_MS = 8_000

// Counting the files is the one question that can take long, in a very large
// project. After a count that ran out of time the next one waits this long,
// twice as long after each further one, and never longer than the last value.
const FILES_FIRST_WAIT_MS = 2 * 60_000
const FILES_LONGEST_WAIT_MS = 15 * 60_000
// How long the rest of a pass waits for the count before it writes what it
// already knows. The count follows when it lands.
const FILES_GRACE_MS = 1_500

// A yes this soon after its question is the second half of a double press.
// The question may be drawn right where the button was, so without this a
// double click on Push would ask and answer in one go.
const CONFIRM_GUARD_MS = 600
// A question nobody answers is taken back, so the row never stays stuck on it.
const ASK_KEEP_MS = 2 * 60_000

// Claude Code refuses a stored value for as long as a row is being drawn. A
// write waits for the row's own drawing to end, but not for longer than this,
// and a write refused all the same is tried again after a short wait, a few
// times.
const DRAWING_WAIT_MS = 2_000
const WRITE_TRIES = 5
const WRITE_WAIT_MS = 30

// The terminal draws its own collapse mark over the last cells of the band.
// The row keeps clear of them there, so the mark never covers a button.
const TERMINAL_MARK_CELLS = 4
// Words cut to fewer cells than this say nothing, so they are left out.
const WORDS_MIN_CELLS = 8

// Where the answer of the last online check of the plugin copy is kept. The
// store outlives the session, so every window of one profile shares the one
// check per five minutes.
const PLUGIN_CHECK_KEY = 'band.pluginCheck'

// A missing sign-in must fail instead of waiting for an answer nobody can
// type: no prompt in a terminal, and no sign-in window from the credential
// manager.
const QUIET_GIT = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }

// The longest name the label shows.
const LABEL_MAX = 24

const SHA = /^[0-9a-f]{40,64}$/

type Dollar = EngineInterface

// Every surface has these three elements, so one drawing serves them all.
// The mark before the name is a drawing, which the terminal cannot show: it
// is drawn only where the surface offers the element.
type Table = Pick<Elements['mobile'], 'Box' | 'Text' | 'Button'> & {
  Svg?: Elements['desktop']['Svg']
}

// The Rotem E mark: the light triangle on its blue tile, so it reads on a
// dark window and on a light one. One path, no nesting. The size, the tile's
// corners, the triangle's color and its 16% of air at each side are the
// owner's, set on a mock (2026-10-03).
const MARK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
  '<rect width="64" height="64" rx="13" fill="#192685"/>' +
  '<path fill="#B8BEEA" fill-rule="evenodd" ' +
  'transform="translate(10.24 17.01) scale(0.888) translate(-62 -42)" ' +
  'd="M86.5,58.7a3.465,3.465,0,1,1,3.548-3.464A3.507,3.507,0,0,1,86.5,58.7ZM108.866,42H64.132a2.069,2.069,0,0,0-1.816,3.09L63.022,46.1l5.76,0.085L68.1,46.1l36.987,0.088L89.321,68.39,86.5,72.415,71.315,50.372H66.248l13.808,20.1L84.5,76.817a1.965,1.965,0,0,0,.366.491,2.271,2.271,0,0,0,3.28-.014,1.953,1.953,0,0,0,.348-0.469L106.056,51.7l4.627-6.607A2.07,2.07,0,0,0,108.866,42Z"/>' +
  '</svg>'
const MARK_ALT = 'Rotem E'
// The mark's side on screen, and the cells of the row it and its gap take.
const MARK_PIXELS = 25
const MARK_CELLS = 4

// A kettlebell, in red: drawn before the words only while something heavy
// waits for the owner (2026-10-03). The terminal has the words alone.
const HEAVY_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
  '<path fill="#E5484D" fill-rule="evenodd" ' +
  'd="M8 3h8a2 2 0 0 1 2 2c0 1.2-.5 2.3-1.2 3.2A7.5 7.5 0 1 1 7.2 8.2 5.3 5.3 0 0 1 6 5a2 2 0 0 1 2-2Zm.2 2.2c.1.7.4 1.3.8 1.8a7.5 7.5 0 0 1 6 0c.4-.5.7-1.1.8-1.8Z"/>' +
  '</svg>'
const HEAVY_ALT = 'Heavy files'
const HEAVY_PIXELS = 16

// All committed: a check mark in a dark disc, drawn just before Go commit in
// place of the words (owner, 2026-10-04; the drawing is his). The terminal
// has no drawing and keeps the words.
const CHECK_SVG =
  '<svg width="29" height="29" viewBox="0 0 29 29" fill="none" xmlns="http://www.w3.org/2000/svg">' +
  '<circle cx="14.5" cy="14.5" r="14.5" fill="#383838"/>' +
  '<path d="M9 15.6056L12.4434 19.4359C12.9079 19.9527 13.7449 19.8498 14.0705 19.236L19.5 9" ' +
  'stroke="#B3B4BC" stroke-width="2" stroke-linecap="round"/>' +
  '</svg>'
const CHECK_ALT = 'All committed'
// 20, so that it measures about 29 on the owner's screen, which is scaled up.
const CHECK_PIXELS = 20
const CHECK_CELLS = 3

// The server light: a dot before the percentage, green while the project's
// local address answers and grey while it does not (owner, 2026-10-04). The
// sizes and both colors are his. The terminal has no drawing and shows none.
// 6, so that it measures about 8 on the owner's screen, which is scaled up:
// he asked for 8, saw 11, and chose this (2026-10-04).
const SERVER_PIXELS = 6
const SERVER_CELLS = 2
const SERVER_UP_COLOR = '#2E9B24'
const SERVER_DOWN_COLOR = '#646464'
const SERVER_UP_ALT = 'Local server is running'
const SERVER_DOWN_ALT = 'Local server is not running'
// How long an address may take to answer before it counts as closed.
const SERVER_WAIT_MS = 2_000
// The address a project works at on this computer, as its CLAUDE.md states
// it. The line that names it "Local app URL" wins over any other mention.
const SERVER_NAMED = /local app url[^\n]*?(https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?)/i
const SERVER_ANY = /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?/i

function serverDot(color: string): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8">' +
    `<circle cx="4" cy="4" r="4" fill="${color}"/>` +
    '</svg>'
  )
}

/** The local address a CLAUDE.md names, or null when it names none. */
export function serverUrlIn(text: string): string | null {
  return (SERVER_NAMED.exec(text)?.[1] ?? SERVER_ANY.exec(text)?.[0] ?? null)
}

type GitAnswer = {
  /** The exit code; null when git could not be run or was stopped. */
  code: number | null
  out: string
  err: string
  isTimeout: boolean
  /** True when the answer was longer than the engine reads: it is not whole. */
  isCut: boolean
}

type PluginCheck = {
  dir: string
  checkedAt: number
  remoteHead: string | null
}

/** The repository without its count of files: all a press needs to know. */
type BranchPart = Omit<ProjectBandRepo, 'files'>

/** What a button does. A promise is handed back to the engine, which waits. */
type Acts = {
  shortcut: (phrase: string) => Promise<void>
  askPush: () => Promise<void>
  askUpdate: () => Promise<void>
  askMore: (phrases: string[], hasUpdate: boolean) => Promise<void>
  compact: () => Promise<void>
  hideBackup: () => Promise<void>
  confirmPush: () => void
  confirmUpdate: () => void
  cancel: () => Promise<void>
}

/** What one drawing of the band is made from. */
type Look = {
  known: ProjectBandFacts
  state: ProjectBandBusy
  open: ProjectBandAsk | null
  /** The cells the row may fill. */
  columns: number
  /** The cells left free at the end of the row, for the terminal's own mark. */
  reserve: number
  /** True where a check mark stands in for the words "All committed". */
  isCheckDrawn: boolean
}

type RowPlan = {
  /** The label's name, cut shorter when the row is very narrow. */
  name: string
  /** How full the conversation is, as the row reads it; empty when unknown. */
  fill: string
  words: string
  hasCommit: boolean
  hasFast: boolean
  /** What the Fast button reads: the mode's state rides in it. */
  fastLabel: string
  /** What the backup button reads; empty when the row draws none. */
  backup: string
  /** The backup's age as quiet words a press hides; empty when not shown. */
  backupQuiet: string
  /** True once the newest backup is old enough to call for a new one. */
  isBackupDue: boolean
  hasUpdate: boolean
  more: string[]
  moreHasUpdate: boolean
}

// SMALL PURE HELPERS. Text in, text out: nothing here touches the session.

function firstLine(text: string): string {
  return (text.split(/\r?\n/)[0] ?? '').trim()
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = (value ?? '').trim()

  return trimmed === '' ? undefined : trimmed
}

function withoutTrailingSlash(path: string): string {
  return path.replace(/[\\/]+$/, '')
}

// A path is joined with the separator it already uses, so a Windows folder
// stays a Windows folder on screen.
function joinPath(dir: string, ...parts: string[]): string {
  const separator = dir.includes('\\') ? '\\' : '/'

  return [withoutTrailingSlash(dir), ...parts].join(separator)
}

function isSamePath(one: string, other: string): boolean {
  const plain = (path: string) =>
    withoutTrailingSlash(path).replace(/\\/g, '/').toLowerCase()

  return plain(one) === plain(other)
}

// True when a folder is the other folder itself, or sits anywhere inside it.
function isInside(folder: string, outer: string): boolean {
  const plain = (path: string) =>
    withoutTrailingSlash(path).replace(/\\/g, '/').toLowerCase()
  const inner = plain(folder)
  const around = plain(outer)

  return inner === around || inner.startsWith(`${around}/`)
}

// The last name in a path: the folder itself, without what it sits in.
function nameOf(path: string): string {
  return withoutTrailingSlash(path).split(/[\\/]/).pop() ?? ''
}

// The folder a path sits in. The root of a drive or of the disk keeps its
// separator, so it still names a folder.
function parentOf(path: string): string | null {
  const plain = withoutTrailingSlash(path)
  const cut = Math.max(plain.lastIndexOf('/'), plain.lastIndexOf('\\'))

  if (cut < 0) {
    return null
  }

  const parent = plain.slice(0, cut)

  return parent === '' || /^[A-Za-z]:$/.test(parent) ? plain.slice(0, cut + 1) : parent
}

// Where a path git named leads: itself when it is whole, under the home
// folder when it opens with a tilde, else under the folder git was asked in.
function placeOf(path: string, base: string, home: string | undefined): string | null {
  if (/^(?:[A-Za-z]:[\\/]|[\\/])/.test(path)) {
    return path
  }

  if (/^~[\\/]/.test(path)) {
    return home === undefined ? null : joinPath(home, path.slice(2))
  }

  return joinPath(base, path)
}

function countOf(count: number, one: string): string {
  return `${count} ${count === 1 ? one : `${one}s`}`
}

// A name too long for the label is cut, and ends on the mark of a cut.
function cutToLabel(name: string): string {
  return name.length > LABEL_MAX ? `${name.slice(0, LABEL_MAX - 1)}\u{2026}` : name
}

// The repository's name as its online address spells it: the last part,
// without the .git ending. https://github.com/owner/Name.git and
// git@github.com:owner/Name.git both answer Name.
function repoNameIn(url: string): string | undefined {
  const plain = withoutTrailingSlash(url.trim()).replace(/\.git$/i, '')

  return nonEmpty(plain.split(/[\\/:]/).pop())
}

// What the label says: the project's name, in plain text, and nothing until
// it is known. The row first named the window's owner there, Personal or a
// client, on a colored label. The owner asked for the repository's name
// instead, with no box around it, in every window (2026-10-03).
function labelOf(known: ProjectBandFacts): string {
  return known.project ?? ''
}

// An address can carry a sign-in token (https://name:token@host/...). It must
// never reach the screen or a log.
function shownUrl(url: string): string {
  const parts = /^([a-z][a-z0-9+.-]*:\/\/)([^/@]*)@(.*)$/i.exec(url)

  if (parts === null) {
    return url
  }

  const [, scheme = '', signIn = '', rest = ''] = parts

  if (/^https?:/i.test(scheme)) {
    return `${scheme}${rest}`
  }

  return `${scheme}${signIn.split(':')[0] ?? ''}@${rest}`
}

function withoutSecrets(text: string): string {
  return text.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi, '$1')
}

// What git said, in a few plain words the owner can act on. The full text
// goes to the debug log for whoever looks into it later.
function reasonOf(said: string): string {
  const rules: readonly [RegExp, string][] = [
    [
      /could not read (username|password)|authentication failed|terminal prompts disabled|interactivity has been disabled|permission denied|permission to \S+ denied|returned error: 40[13]|logon failed|invalid credentials/i,
      'sign-in is missing',
    ],
    [
      /non-fast-forward|fetch first|updates were rejected|\[rejected\]/i,
      'the online copy has newer work',
    ],
    [
      /protected branch|gh006|pre-receive hook declined|remote rejected/i,
      'the online copy refused it',
    ],
    [
      /repository not found|does not appear to be a git repository|returned error: 404/i,
      'the online copy was not found',
    ],
    [
      /could not resolve host|failed to connect|connection timed out|network is unreachable|could not read from remote repository|unable to access|connection reset/i,
      'no connection to the online copy',
    ],
    [
      /not possible to fast-forward|diverg/i,
      'this copy has changes of its own',
    ],
    [
      /would be overwritten|commit your changes or stash/i,
      'this copy has unsaved changes',
    ],
    [/no tracking information/i, 'this copy does not know where to update from'],
    [/index\.lock|\.lock': file exists|another git process/i, 'git is busy with something else'],
  ]

  for (const [pattern, words] of rules) {
    if (pattern.test(said)) {
      return words
    }
  }

  return 'git reported a problem'
}

// The kit writes a shortcut as a heading: three hashes, then the phrase
// wrapped in backticks, then maybe more words on the line. The closing
// backtick must follow the phrase directly, so the heading for
// "Go commit and backup" is not read as "Go commit". Lines inside a code
// fence are examples, not headings. A fence closes only on its own mark, at
// least as long as the one that opened it and alone on its line, so a longer
// fence can quote a shorter one; a fence left open runs to the end.
function shortcutsIn(text: string): Set<string> {
  const found = new Set<string>()
  let mark = ''
  let length = 0

  for (const line of text.split(/\r?\n/)) {
    if (mark !== '') {
      const closed = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(line)?.[1]

      if (closed !== undefined && closed.charAt(0) === mark && closed.length >= length) {
        mark = ''
        length = 0
      }

      continue
    }

    const opened = /^[ \t]*(`{3,}|~{3,})/.exec(line)?.[1]

    if (opened !== undefined) {
      mark = opened.charAt(0)
      length = opened.length
      continue
    }

    const heading = /^###[ \t]+`([^`]+)`(?=[ \t]|$)/.exec(line)
    const said = (heading?.[1] ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

    for (const phrase of SHORTCUTS) {
      if (said === phrase.toLowerCase()) {
        found.add(phrase)
      }
    }
  }

  return found
}

// What the kit's listing of heavy files prints: one line per thing, its size,
// its kind, its path. Only the two kinds the owner has to judge are counted.
// Dependencies, build output and git's own history are heavy in most
// projects and call for nothing, so they never raise the mark.
function heavyIn(out: string): number {
  return out
    .split(/\r?\n/)
    .filter(line => /^\s+[\d.]+ (?:KB|MB|GB)\s+(?:leftover|backups)\s+\S/.test(line)).length
}

// Whether fast mode is on after a prompt, going by the words the kit answers
// to: the two that switch it on, the two that switch it off, the commit
// shortcuts, which end it by themselves, and the plain words for leaving it.
// Any other prompt leaves the mode as it was.
function fastAfter(text: string, isOn: boolean): boolean {
  const said = text.trim().replace(/\s+/g, ' ').replace(/[.!]+$/, '').toLowerCase()

  if (said === 'fast on' || said === 'fast mode') {
    return true
  }

  if (
    said === 'fast off' ||
    said === 'fast mode off' ||
    said === 'go commit' ||
    said === 'go c' ||
    said === 'go commit and backup'
  ) {
    return false
  }

  if (/\b(?:exit|stop|end|leave|quit)\s+fast\s+mode\b|\bturn\s+off\s+fast\s+mode\b/.test(said)) {
    return false
  }

  return isOn
}

// How the row reads a backup's age: today, or its count of days.
function backupTextOf(days: number): string {
  return days === 0 ? 'Backup today' : `Backup ${days}d`
}

// What git's status answers in its second porcelain format: one line per
// changed file, which starts with the kind of change.
function filesIn(out: string): number {
  return out.split(/\r?\n/).filter(line => /^[12u?] /.test(line)).length
}

// How far the branch is ahead of its online copy, read from the words git's
// own listing of branches uses: nothing when both are level, "ahead 2",
// "behind 1", or both. Anything else is unknown and never read as zero:
// "gone" for one, which git says when the online copy was deleted.
function aheadIn(track: string): number | null {
  const said = /^(?:ahead (\d+))?(?:, )?(?:behind \d+)?$/.exec(track.trim())

  if (said === null) {
    return null
  }

  return said[1] === undefined ? 0 : Number(said[1])
}

// The folder a project keeps its own git hooks in, when it names one. Git
// lists every value with where it was set, the strongest last. Claude Code
// switches hooks off for the git it runs, with a setting of its own given on
// the command line: that one says nothing about the project, so it is skipped.
function hooksPathIn(out: string): string | null {
  let set: string | null = null

  for (const line of out.split(/\r?\n/)) {
    const cut = line.indexOf('\t')
    const scope = cut < 0 ? '' : line.slice(0, cut)
    const value = cut < 0 ? '' : line.slice(cut + 1).trim()

    if (scope !== '' && scope !== 'command' && value !== '') {
      set = value
    }
  }

  return set
}

function asPluginCheck(value: unknown): PluginCheck | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const { dir, checkedAt, remoteHead } = value as Record<string, unknown>

  if (typeof dir !== 'string' || typeof checkedAt !== 'number') {
    return null
  }

  // The kept commit goes back to git as an argument, so only something that
  // looks like a commit id is taken from the store.
  return {
    dir,
    checkedAt,
    remoteHead: typeof remoteHead === 'string' && SHA.test(remoteHead) ? remoteHead : null,
  }
}

function pushTarget(
  repo: BranchPart | null,
): { branch: string; remote: string; ref: string; url: string; ahead: number } | null {
  if (repo === null || repo.branch === null || repo.online.kind !== 'tracked') {
    return null
  }

  // A project with a push step of its own is pushed from the owner's git app:
  // a push from here would skip that step and still say Pushed.
  if (!repo.canPushHere) {
    return null
  }

  const { remote, ref, url, ahead } = repo.online

  // Without an address there is nothing to name in the question, so no Push.
  if (url === null || ahead <= 0) {
    return null
  }

  return { branch: repo.branch, remote, ref, url, ahead }
}

// GATHERING. Git, files and the network, always in the background and never
// while a row is being drawn.

async function git(
  $: Dollar,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
): Promise<GitAnswer> {
  try {
    const ran = await $.process.run(['git', ...args], {
      cwd,
      timeoutMs,
      env: QUIET_GIT,
    })

    return {
      code: ran.exitCode,
      out: ran.stdout,
      err: ran.stderr,
      isTimeout: false,
      isCut: ran.isStdoutTruncated,
    }
  } catch (error) {
    // The engine rejects when git cannot start or outlives its time limit,
    // and says "still running after" for the second.
    const said = error instanceof Error ? error.message : String(error)

    return {
      code: null,
      out: '',
      err: said,
      isTimeout: /still running after|timed out/i.test(said),
      isCut: false,
    }
  }
}

// The repository a folder is in: its top folder, and the folder git keeps its
// own files in, which is shared by every worktree of the repository.
async function whereOf(
  $: Dollar,
  folder: string,
  home: string | undefined,
): Promise<{ top: string; gitDir: string } | null> {
  const asked = await git(
    $,
    ['rev-parse', '--show-toplevel', '--git-common-dir'],
    folder,
    LOCAL_GIT_MS,
  )
  const [top = '', named = ''] = asked.out.split(/\r?\n/).map(line => line.trim())

  if (asked.code !== 0 || top === '') {
    return null
  }

  return {
    top,
    gitDir: (named === '' ? null : placeOf(named, folder, home)) ?? joinPath(top, '.git'),
  }
}

// The branch and its online copy, asked of git's own records of branches and
// never of the files. So it answers at once in a project of any size, and
// Push does not wait for the count of files.
async function branchOf(
  $: Dollar,
  top: string,
): Promise<{ branch: string | null; online: ProjectBandOnline }> {
  const head = await git($, ['symbolic-ref', '--quiet', '--short', 'HEAD'], top, LOCAL_GIT_MS)
  const branch = head.code === 0 ? (nonEmpty(firstLine(head.out)) ?? null) : null

  // No branch is checked out, or git did not say.
  if (branch === null) {
    return { branch, online: { kind: 'unknown' } }
  }

  // Which remote the upstream lives on, its name there, and how far ahead of
  // it this branch is. The short name (origin/main) cannot be split safely:
  // branch names hold slashes too.
  const asked = await git(
    $,
    [
      'for-each-ref',
      '--format=%(upstream:remotename)%09%(upstream:remoteref)%09%(upstream:track,nobracket)',
      `refs/heads/${branch}`,
    ],
    top,
    LOCAL_GIT_MS,
  )

  if (asked.code !== 0) {
    return { branch, online: { kind: 'unknown' } }
  }

  const [remote = '', ref = '', track = ''] = firstLine(asked.out).split('\t')

  // A branch with no upstream, or one that follows another local branch, has
  // no online copy.
  if (remote === '' || remote === '.') {
    return { branch, online: { kind: 'none' } }
  }

  // Both names go back to git as arguments later. Anything that does not look
  // like a remote and a full ref is not passed on.
  if (remote.startsWith('-') || !ref.startsWith('refs/')) {
    return { branch, online: { kind: 'unknown' } }
  }

  const ahead = aheadIn(track)

  if (ahead === null) {
    return { branch, online: { kind: 'unknown' } }
  }

  const address = await git($, ['remote', 'get-url', '--push', remote], top, LOCAL_GIT_MS)
  const url = address.code === 0 ? nonEmpty(firstLine(address.out)) : undefined

  return {
    branch,
    online: {
      kind: 'tracked',
      remote,
      ref,
      url: url === undefined ? null : shownUrl(url),
      ahead,
    },
  }
}

// Whether a push from the row does all that a push from the owner's git app
// would. Claude Code runs a plugin's git with the project's hooks switched
// off. A project that keeps large files in Git LFS uploads them from its push
// hook, and a project with push checks runs them there: pushed from here, the
// commits would go online without the files, or unchecked, and the row would
// still say Pushed. So a project with a push hook is left to the git app.
// Anything that cannot be read answers false: no Push from here.
async function canPushHereOf(
  $: Dollar,
  where: { top: string; gitDir: string },
  home: string | undefined,
): Promise<boolean> {
  try {
    const asked = await git(
      $,
      ['config', '--show-scope', '--get-all', 'core.hooksPath'],
      where.top,
      LOCAL_GIT_MS,
    )

    // Exit 1 is git's way of saying the setting is not there.
    if (asked.code !== 0 && asked.code !== 1) {
      return false
    }

    const named = hooksPathIn(asked.out)
    const dir = named === null ? joinPath(where.gitDir, 'hooks') : placeOf(named, where.top, home)

    if (dir === null) {
      return false
    }

    if (!(await $.fs.exists(joinPath(dir, 'pre-push')))) {
      return true
    }

    // Husky keeps a stand-in for every hook in its own folder. Each one only
    // runs the project's hook of the same name, one folder up, when the
    // project wrote one.
    if (/[\\/]\.husky[\\/]_$/.test(withoutTrailingSlash(dir))) {
      const above = parentOf(dir)

      return above !== null && !(await $.fs.exists(joinPath(above, 'pre-push')))
    }

    return false
  } catch (error) {
    note($, 'looking for a push hook failed', error)

    return false
  }
}

async function branchPartOf(
  $: Dollar,
  where: { top: string; gitDir: string },
  home: string | undefined,
): Promise<BranchPart> {
  const [named, canPushHere] = await Promise.all([
    branchOf($, where.top),
    canPushHereOf($, where, home),
  ])

  return { top: where.top, branch: named.branch, online: named.online, canPushHere }
}

// How many files have uncommitted changes. Two choices in this status. It
// takes no optional lock: a status run in the background must not hold the
// index while the session commits, or that commit could fail. And it lists
// every untracked file: a new folder with ten files counts as ten, not as
// one. After a count that ran out of time the next ones are skipped for a
// while, longer each time, so a very large project is not asked again and
// again for an answer it cannot give in time.
async function filesOf($: Dollar, top: string): Promise<number | null> {
  try {
    const now = await $.clock.now()

    if (!isSamePath(work.filesTop, top)) {
      work.filesTop = top
      work.filesWaitMs = 0
      work.filesNotBefore = 0
    }

    const wait = work.filesNotBefore - now

    if (wait > 0 && wait <= FILES_LONGEST_WAIT_MS) {
      return null
    }

    const asked = await git(
      $,
      ['--no-optional-locks', 'status', '--porcelain=v2', '--untracked-files=all'],
      top,
      LOCAL_GIT_MS,
    )

    if (asked.isTimeout) {
      work.filesWaitMs = Math.min(
        Math.max(work.filesWaitMs * 2, FILES_FIRST_WAIT_MS),
        FILES_LONGEST_WAIT_MS,
      )
      work.filesNotBefore = (await $.clock.now()) + work.filesWaitMs

      return null
    }

    work.filesWaitMs = 0
    work.filesNotBefore = 0

    // A list too long to be read whole cannot be counted, so it is not.
    return asked.code !== 0 || asked.isCut ? null : filesIn(asked.out)
  } catch (error) {
    note($, 'counting the files failed', error)

    return null
  }
}

// One count at a time: a pass that finds one under way waits for that one.
function countFiles($: Dollar, top: string): Promise<number | null> {
  if (work.counting !== null && isSamePath(work.countingTop, top)) {
    return work.counting
  }

  const counting = filesOf($, top).finally(() => {
    if (work.counting === counting) {
      work.counting = null
    }
  })

  work.counting = counting
  work.countingTop = top

  return counting
}

// Waits for the count, but not for long: `isDone` false means it is still
// under way and the pass goes on without it.
function countWithin(
  $: Dollar,
  counting: Promise<number | null>,
  ms: number,
): Promise<{ isDone: boolean; files: number | null }> {
  return new Promise(resolve => {
    let timer: { cancel: () => void } | null = null

    try {
      timer = $.clock.after(ms, () => resolve({ isDone: false, files: null }))
    } catch {
      // No clock to wait on: the count alone decides.
    }

    const done = (files: number | null): void => {
      try {
        timer?.cancel()
      } catch {
        // A timer that cannot be stopped fires into a settled promise.
      }

      resolve({ isDone: true, files })
    }

    counting.then(done, () => done(null))
  })
}

// The project's CLAUDE.md sits at the git top folder, or in the session
// folder when the project is a subfolder of a larger repository. A shortcut
// either file carries counts.
async function shortcutsOf($: Dollar, folders: readonly string[]): Promise<string[]> {
  const found = new Set<string>()
  const seen: string[] = []

  for (const folder of folders) {
    if (seen.some(other => isSamePath(other, folder))) {
      continue
    }

    seen.push(folder)

    try {
      const text = await $.fs.read(joinPath(folder, 'CLAUDE.md'))

      for (const phrase of shortcutsIn(text)) {
        found.add(phrase)
      }
    } catch {
      // No CLAUDE.md in this folder: no shortcuts from it.
    }
  }

  return SHORTCUTS.filter(phrase => found.has(phrase))
}

// What origin's main points at, asked online at most once per five minutes. The
// claim is written before the question goes out, so several windows that
// refresh together send one question between them, and a network that does
// not answer is not asked again for five minutes either.
async function remoteHeadOf($: Dollar, dir: string): Promise<string | null> {
  const now = await $.clock.now()
  const kept = asPluginCheck(await $.store.get(PLUGIN_CHECK_KEY))
  const mine = kept !== null && isSamePath(kept.dir, dir) ? kept : null
  const age = mine === null ? -1 : now - mine.checkedAt

  if (mine !== null && age >= 0 && age < PLUGIN_CHECK_MS) {
    return mine.remoteHead
  }

  await $.store.set(PLUGIN_CHECK_KEY, {
    dir,
    checkedAt: now,
    remoteHead: mine?.remoteHead ?? null,
  })

  const asked = await git($, ['ls-remote', 'origin', 'refs/heads/main'], dir, NETWORK_GIT_MS)
  const answer = /^([0-9a-f]{40,64})\s+refs\/heads\/main\s*$/m.exec(asked.out)
  const remoteHead = asked.code === 0 ? (answer?.[1] ?? null) : null

  await $.store.set(PLUGIN_CHECK_KEY, { dir, checkedAt: now, remoteHead })

  return remoteHead
}

// The plugin copy of the kit lives under the profile's config folder. It has
// an update ready when origin's main holds a commit this copy does not have.
// Anything that cannot be read (no folder, not a clone, no network) answers
// null, and the row then says nothing about the plugin.
async function pluginUpdateOf(
  $: Dollar,
  configDir: string | undefined,
  home: string | undefined,
): Promise<{ dir: string } | null> {
  try {
    const base = configDir ?? (home === undefined ? undefined : joinPath(home, '.claude'))

    if (base === undefined) {
      return null
    }

    const dir = joinPath(base, 'skills', 'projectos')

    // The folder itself must be the clone. Asking git alone is not enough: a
    // plain folder inside some other repository would answer with that
    // repository's commit.
    if (!(await $.fs.exists(joinPath(dir, '.git')))) {
      return null
    }

    const local = await git($, ['rev-parse', 'HEAD'], dir, LOCAL_GIT_MS)
    const head = firstLine(local.out)

    if (local.code !== 0 || !SHA.test(head)) {
      return null
    }

    const remoteHead = await remoteHeadOf($, dir)

    if (remoteHead === null || remoteHead === head) {
      return null
    }

    // The two differ. That is an update only when this copy lacks the online
    // commit: a copy that is ahead of the online one has nothing to pull.
    // Exit 0 means this copy already holds it; no exit code means git could
    // not say, and then nothing is shown.
    const held = await git(
      $,
      ['merge-base', '--is-ancestor', remoteHead, 'HEAD'],
      dir,
      LOCAL_GIT_MS,
    )

    return held.code === null || held.code === 0 ? null : { dir }
  } catch (error) {
    note($, 'checking the plugin copy failed', error)

    return null
  }
}

// DRAWING. Values in, a tree out: no git, no files, no waiting.

// Each message opens on a capital letter, or on its count (owner, 2026-10-03).
function wordsOf(
  known: ProjectBandFacts,
  isShort: boolean,
  isCountInButton: boolean,
  backupWords: string,
  isCheckDrawn: boolean,
): string[] {
  const words: string[] = []
  const repo = known.repo

  if (repo === null) {
    return words
  }

  if (repo.files === 0) {
    // Where the check mark is drawn it says this, and the words stay out.
    if (!isCheckDrawn) {
      words.push('All committed')
    }
  } else if (repo.files !== null && !isCountInButton) {
    // The count alone, at every width: the owner reads "1 to commit". While
    // Go commit is in the row the count rides in the button instead.
    words.push(`${repo.files} to commit`)
  }

  if (repo.online.kind === 'none') {
    words.push(isShort ? 'No online copy' : 'No online copy yet')
  } else if (
    repo.online.kind === 'tracked' &&
    repo.online.ahead > 0 &&
    pushTarget(repo) === null
  ) {
    // While Push is in the row the count rides in the button, as it does in
    // Go commit (owner, 2026-10-04). Where the row offers no Push, because
    // the project has a push step of its own or the online copy has no
    // address, the words carry the count and say where to push from.
    words.push(
      isShort || repo.canPushHere
        ? `${repo.online.ahead} to push`
        : `${repo.online.ahead} to push from your git app`,
    )
  }

  if (known.pluginUpdate !== null) {
    words.push(isShort ? 'Update ready' : 'Plugin update ready')
  }

  const heavy = known.heavy ?? 0

  if (heavy > 0) {
    words.push(isShort ? `${heavy} heavy` : countOf(heavy, 'heavy file'))
  }

  // The backup's age, while it is not riding in a button of its own.
  if (backupWords !== '') {
    words.push(backupWords)
  }

  return words
}

// Push carries the count of commits waiting, after a middle dot, as Go commit
// carries its files (owner, 2026-10-04).
function pushLabelOf(state: ProjectBandBusy, known: ProjectBandFacts): string {
  if (state.isPushing) {
    return 'Pushing...'
  }

  const ahead = pushTarget(known.repo)?.ahead ?? 0

  return ahead > 0 ? `Push \u00b7 ${ahead}` : 'Push'
}

function updateLabelOf(state: ProjectBandBusy): string {
  return state.isUpdating ? 'Updating...' : 'Update plugin'
}

// The cells a run of buttons takes as the terminal draws them: a button is
// its label and four more cells, and one cell separates neighbors.
function buttonsWidth(labels: readonly string[]): number {
  return labels.reduce((sum, text) => sum + 1 + text.length + 4, 0)
}

function fastLabelOf(isFast: boolean): string {
  return isFast ? FAST_ON_LABEL : FAST_LABEL
}

// What a shortcut's button reads, and the words a press of it sends.
function buttonTextOf(phrase: string, isFast: boolean): string {
  if (phrase === FAST_SHORTCUT) {
    return fastLabelOf(isFast)
  }

  if (phrase === VISUAL_SHORTCUT) {
    return VISUAL_LABEL
  }

  return phrase === RESEARCH_SHORTCUT ? RESEARCH_LABEL : phrase
}

// Go commit carries the count of files waiting, after a middle dot (owner,
// 2026-10-03). With nothing waiting, or before git has answered, it reads the
// phrase alone.
function commitLabelOf(known: ProjectBandFacts): string {
  const files = known.repo?.files ?? 0

  return files > 0 ? `${MAIN_SHORTCUT} · ${files}` : MAIN_SHORTCUT
}

function sentOf(phrase: string, isFast: boolean): string {
  if (phrase !== FAST_SHORTCUT) {
    return phrase
  }

  return isFast ? FAST_OFF_SENT : FAST_SENT
}

// The row must fit the width it is given. When it cannot, the words get
// shorter first, then Go commit, Fast and the backup button move behind More,
// then Update plugin does.
// Past that the layout cuts the words, down to a handful of cells and then
// away, and when even the label and the buttons do not fit, the label's name
// is cut. Push stays in every step.
function planOf(
  known: ProjectBandFacts,
  state: ProjectBandBusy,
  columns: number,
  isCheckDrawn = false,
): RowPlan {
  const isInRepo = known.repo !== null
  // Go commit shows only while there is something to commit (owner,
  // 2026-10-04): with nothing waiting, or before git has counted, it is in
  // neither the row nor the More list.
  const hasMain =
    isInRepo && known.shortcuts.includes(MAIN_SHORTCUT) && (known.repo?.files ?? 0) > 0
  const hasFast = isInRepo && known.shortcuts.includes(FAST_SHORTCUT)
  const others: string[] = isInRepo
    ? [
        ...SHORTCUTS.filter(
          phrase =>
            phrase !== MAIN_SHORTCUT &&
            phrase !== FAST_SHORTCUT &&
            known.shortcuts.includes(phrase),
        ),
        ...(known.hasResearch === true ? [RESEARCH_SHORTCUT] : []),
      ]
    : []
  const canPush = pushTarget(known.repo) !== null
  const canUpdate = isInRepo && known.pluginUpdate !== null
  const fastLabel = fastLabelOf(known.isFast === true)
  // The backup's age shows only where the project carries the shortcut that
  // makes one, and only once a backup was found.
  const backupDays =
    isInRepo && known.shortcuts.includes(BACKUP_SHORTCUT) ? (known.backup?.days ?? null) : null
  const backupText = backupDays === null ? '' : backupTextOf(backupDays)
  const isBackupDue = backupDays !== null && backupDays >= BACKUP_BUTTON_DAYS
  // Before it is due the row says nothing about the backup: the owner wanted
  // a reminder once a month, not a count of days (2026-10-04). The quiet
  // words that showed the age, and the press that hid them, are switched off
  // here and draw nothing.
  const backupQuiet: string = ''
  const quietCells = backupQuiet === '' ? 0 : backupQuiet.length + 1
  const fullName = labelOf(known)
  // The percentage alone, before the words (owner, 2026-10-03). It is drawn
  // without a frame, so it takes its own cells and the one that separates it.
  const fill = known.fill ?? null
  const fillText = fill === null ? '' : `${Math.round(fill)}%`
  const fillCells = fillText === '' ? 0 : fillText.length + 1
  const steps = [
    { isShort: false, isInRow: true, hasCommit: hasMain, hasUpdate: canUpdate },
    { isShort: true, isInRow: true, hasCommit: hasMain, hasUpdate: canUpdate },
    { isShort: true, isInRow: false, hasCommit: false, hasUpdate: canUpdate },
    { isShort: true, isInRow: false, hasCommit: false, hasUpdate: false },
  ]
  let plan: RowPlan = {
    name: fullName,
    fill: fillText,
    words: '',
    hasCommit: false,
    hasFast: false,
    fastLabel,
    backup: '',
    backupQuiet,
    isBackupDue,
    hasUpdate: false,
    more: [],
    moreHasUpdate: false,
  }
  let fixed = 0

  for (const step of steps) {
    // Fast keeps Go commit's company: in the row with it, behind More with it.
    // So does the backup button, which the row draws only for a backup that
    // is due. A due backup behind More has its age in the words.
    const isFastInRow = hasFast && step.isInRow
    const isBackupInRow = isBackupDue && step.isInRow
    const words = wordsOf(
      known,
      step.isShort,
      step.hasCommit,
      isBackupDue && !isBackupInRow ? backupText : '',
      isCheckDrawn,
    ).join(' \u00b7 ')
    const more = [
      ...(hasMain && !step.hasCommit ? [MAIN_SHORTCUT] : []),
      ...(hasFast && !isFastInRow ? [FAST_SHORTCUT] : []),
      ...others.filter(phrase => !(isBackupInRow && phrase === BACKUP_SHORTCUT)),
    ]
    const moreHasUpdate = canUpdate && !step.hasUpdate
    const buttons = [
      ...(step.hasCommit ? [commitLabelOf(known)] : []),
      ...(isFastInRow ? [fastLabel] : []),
      ...(canPush ? [pushLabelOf(state, known)] : []),
      ...(isBackupInRow ? [backupText] : []),
      ...(step.hasUpdate ? [updateLabelOf(state)] : []),
      ...(more.length > 0 || moreHasUpdate ? ['More'] : []),
    ]

    fixed = buttonsWidth(buttons) + fillCells + quietCells
    plan = {
      name: fullName,
      fill: fillText,
      words,
      hasCommit: step.hasCommit,
      hasFast: isFastInRow,
      fastLabel,
      backup: isBackupInRow ? backupText : '',
      backupQuiet,
      isBackupDue,
      hasUpdate: step.hasUpdate,
      more,
      moreHasUpdate,
    }

    if (fullName.length + (words === '' ? 0 : 1 + words.length) + fixed <= columns) {
      return plan
    }
  }

  // The layout cuts the words to the cells that are left after the label,
  // the buttons and the one cell between. Too few to read anything in, and
  // the words are left out.
  const wordsRoom = columns - fullName.length - fixed - 1
  const words = wordsRoom >= WORDS_MIN_CELLS ? plan.words : ''
  // What the buttons leave is all the name can have, and never less than one
  // letter and the mark of a cut.
  const room = Math.max(columns - fixed, 2)

  return {
    ...plan,
    words,
    name: fullName.length <= room ? fullName : `${fullName.slice(0, room - 1)}\u2026`,
  }
}

// The keys of the buttons the plain row draws at this width, in order.
function keysOf(known: ProjectBandFacts, state: ProjectBandBusy, columns: number): string[] {
  const plan = planOf(known, state, columns)

  return [
    ...(plan.fill !== '' ? ['fill'] : []),
    ...(plan.backupQuiet !== '' ? ['backup-age'] : []),
    ...(plan.hasCommit ? ['go-commit'] : []),
    ...(pushTarget(known.repo) !== null ? ['push'] : []),
    ...(plan.hasFast ? [keyOf(FAST_SHORTCUT)] : []),
    ...(plan.backup !== '' ? [keyOf(BACKUP_SHORTCUT)] : []),
    ...(plan.hasUpdate ? ['update-plugin'] : []),
    ...(plan.more.length > 0 || plan.moreHasUpdate ? ['more'] : []),
  ]
}

function keyOf(phrase: string): string {
  return phrase.toLowerCase().replace(/\s+/g, '-')
}

// The name's color is the owner's choice (2026-10-04), a quiet grey.
const NAME_COLOR = '#B3B4BC'

function drawLabel({ Box, Text, Svg }: Table, name: string): RenderElement {
  return (
    <Box flexDirection="row" alignItems="center" gap={1} flexShrink={0}>
      {Svg !== undefined && (
        <Svg source={MARK_SVG} alt={MARK_ALT} width={MARK_PIXELS} height={MARK_PIXELS} />
      )}
      <Text bold color={NAME_COLOR}>
        {name}
      </Text>
    </Box>
  )
}

// Go commit is drawn as every other button in the row, files waiting or not:
// the owner did not want the filled one (2026-10-03). Only the yes of a
// question is drawn as the main action.
function drawRow(table: Table, look: Look, acts: Acts): RenderElement | null {
  const { Box, Text, Button } = table
  const { known, state } = look
  const plan = planOf(known, state, look.columns, look.isCheckDrawn)
  const files = known.repo?.files ?? null
  const canPush = pushTarget(known.repo) !== null
  const hasMore = plan.more.length > 0 || plan.moreHasUpdate
  const isHeavy = known.repo !== null && (known.heavy ?? 0) > 0
  const server = known.repo !== null ? (known.server ?? null) : null
  // Nothing waiting reads quieter than something waiting.
  const isCalm =
    (files === null || files === 0) &&
    !(known.repo?.online.kind === 'tracked' && known.repo.online.ahead > 0) &&
    known.pluginUpdate === null &&
    !isHeavy &&
    !plan.isBackupDue
  const hasButtons =
    plan.hasCommit || plan.hasFast || canPush || plan.backup !== '' || plan.hasUpdate || hasMore

  // The row has nothing to say before git has named the project: no name, no
  // counts, no buttons. Nothing is drawn then, not an empty row.
  if (
    plan.name === '' &&
    plan.fill === '' &&
    plan.words === '' &&
    plan.backupQuiet === '' &&
    !hasButtons
  ) {
    return null
  }

  // Centered across the row: on the desktop a button is taller than a line of
  // text, and the label and the words should sit level with it. The name
  // stays at the start of the row; the words and the buttons take the room
  // that is left and sit at its far end (owner, 2026-10-03).
  return (
    <Box flexDirection="row" alignItems="center" gap={1} paddingRight={look.reserve}>
      {plan.name !== '' && drawLabel(table, plan.name)}
      <Box
        flexDirection="row"
        alignItems="center"
        justifyContent="flex-end"
        gap={1}
        flexGrow={1}
        flexShrink={1}
      >
        {server !== null && table.Svg !== undefined && (
          <Box flexShrink={0}>
            <table.Svg
              source={serverDot(server === 'up' ? SERVER_UP_COLOR : SERVER_DOWN_COLOR)}
              alt={server === 'up' ? SERVER_UP_ALT : SERVER_DOWN_ALT}
              width={SERVER_PIXELS}
              height={SERVER_PIXELS}
            />
          </Box>
        )}
        {plan.fill !== '' && (
          <Box flexShrink={0}>
            <Button key="fill" plain label={plan.fill} onPress={() => acts.compact()} />
          </Box>
        )}
        {isHeavy && plan.words !== '' && table.Svg !== undefined && (
          <table.Svg
            source={HEAVY_SVG}
            alt={HEAVY_ALT}
            width={HEAVY_PIXELS}
            height={HEAVY_PIXELS}
          />
        )}
        {plan.words !== '' && (
          <Box flexShrink={1}>
            <Text wrap="truncate-end" dimColor={isCalm}>
              {plan.words}
            </Text>
          </Box>
        )}
        {plan.backupQuiet !== '' && (
          <Box flexShrink={0}>
            <Button
              key="backup-age"
              plain
              label={plan.backupQuiet}
              onPress={() => acts.hideBackup()}
            />
          </Box>
        )}
        {look.isCheckDrawn && table.Svg !== undefined && (
          <Box flexShrink={0}>
            <table.Svg
              source={CHECK_SVG}
              alt={CHECK_ALT}
              width={CHECK_PIXELS}
              height={CHECK_PIXELS}
            />
          </Box>
        )}
        {hasButtons && (
          <Box flexDirection="row" gap={1} flexShrink={0}>
            {plan.hasCommit && (
              <Button
                key="go-commit"
                label={commitLabelOf(known)}
                onPress={() => acts.shortcut(MAIN_SHORTCUT)}
              />
            )}
            {/* Push sits before Fast (owner, 2026-10-04). */}
            {canPush && (
              <Button key="push" label={pushLabelOf(state, known)} onPress={() => acts.askPush()} />
            )}
            {plan.hasFast && (
              <Button
                key={keyOf(FAST_SHORTCUT)}
                label={plan.fastLabel}
                onPress={() => acts.shortcut(FAST_SHORTCUT)}
              />
            )}
            {plan.backup !== '' && (
              <Button
                key={keyOf(BACKUP_SHORTCUT)}
                label={plan.backup}
                onPress={() => acts.shortcut(BACKUP_SHORTCUT)}
              />
            )}
            {plan.hasUpdate && (
              <Button
                key="update-plugin"
                label={updateLabelOf(state)}
                onPress={() => acts.askUpdate()}
              />
            )}
            {hasMore && (
              <Button
                key="more"
                label="More"
                onPress={() => acts.askMore(plan.more, plan.moreHasUpdate)}
              />
            )}
          </Box>
        )}
      </Box>
    </Box>
  )
}

// A question takes the row's place until it is answered. Cancel comes first
// and the keyboard starts on it: a stray Enter then takes the question back,
// and only a deliberate press pushes or pulls. Like the plain row, the name
// stays at the start and the rest sits at the far end (owner, 2026-10-04). The words are never cut, so
// the address is always read whole: where they do not fit beside the
// buttons, they wrap and the buttons move to a row of their own.
function drawQuestion(
  table: Table,
  look: Look,
  said: string,
  yes: { key: string; label: string; onPress: () => void },
  acts: Acts,
): RenderElement {
  const { Box, Text, Button } = table
  const name = labelOf(look.known)
  const isOneRow =
    name.length + 1 + said.length + buttonsWidth(['Cancel', yes.label]) <= look.columns
  const buttons = (
    <Box flexDirection="row" gap={1} flexShrink={0}>
      <Button key="cancel" label="Cancel" autoFocus onPress={() => acts.cancel()} />
      <Button key={yes.key} label={yes.label} variant="primary" onPress={yes.onPress} />
    </Box>
  )

  if (isOneRow) {
    return (
      <Box flexDirection="row" alignItems="center" gap={1} paddingRight={look.reserve}>
        {name !== '' && drawLabel(table, name)}
        <Box
          flexDirection="row"
          alignItems="center"
          justifyContent="flex-end"
          gap={1}
          flexGrow={1}
          flexShrink={1}
        >
          <Box flexShrink={1}>
            <Text bold>{said}</Text>
          </Box>
          {buttons}
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" paddingRight={look.reserve}>
      <Box flexDirection="row" gap={1}>
        {name !== '' && drawLabel(table, name)}
        <Box flexDirection="row" justifyContent="flex-end" flexGrow={1} flexShrink={1}>
          <Text bold wrap="wrap">
            {said}
          </Text>
        </Box>
      </Box>
      <Box flexDirection="row" justifyContent="flex-end">
        {buttons}
      </Box>
    </Box>
  )
}

// More lists the shortcuts that have no room in the row, in the row's place.
// The buttons wrap onto further rows where one row is too narrow for them.
function drawMore(
  table: Table,
  look: Look,
  open: Extract<ProjectBandAsk, { kind: 'more' }>,
  acts: Acts,
): RenderElement {
  const { Box, Button } = table
  const name = labelOf(look.known)

  return (
    <Box flexDirection="row" alignItems="center" gap={1} paddingRight={look.reserve}>
      {name !== '' && drawLabel(table, name)}
      {/* The buttons sit at the far end, as in the plain row (owner, 2026-10-04). */}
      <Box
        flexDirection="row"
        flexWrap="wrap"
        alignItems="center"
        justifyContent="flex-end"
        columnGap={1}
        flexGrow={1}
        flexShrink={1}
      >
        {open.phrases.map(phrase => (
          <Button
            key={keyOf(phrase)}
            label={buttonTextOf(phrase, look.known.isFast === true)}
            onPress={() => acts.shortcut(phrase)}
          />
        ))}
        {open.hasUpdate && (
          <Button key="update-plugin" label="Update plugin" onPress={() => acts.askUpdate()} />
        )}
        <Button key="cancel" label="Back" onPress={() => acts.cancel()} />
      </Box>
    </Box>
  )
}

function drawBand(table: Table, look: Look, acts: Acts): RenderElement | null {
  const open = look.open

  if (open === null) {
    return drawRow(table, look, acts)
  }

  if (open.kind === 'push') {
    return drawQuestion(
      table,
      look,
      `Push ${countOf(open.commits, 'commit')} from ${open.branch} to ${open.url}?`,
      { key: 'confirm-push', label: 'Push', onPress: () => acts.confirmPush() },
      acts,
    )
  }

  if (open.kind === 'update') {
    return drawQuestion(
      table,
      look,
      open.url === null
        ? `Update the ProjectOS plugin in ${open.dir}?`
        : `Update the ProjectOS plugin in ${open.dir} from ${open.url}?`,
      { key: 'confirm-update', label: 'Update', onPress: () => acts.confirmUpdate() },
      acts,
    )
  }

  return drawMore(table, look, open, acts)
}

// THE WORK. Every function that is handed `$` sits at the top of this file:
// the engine reads a module before it loads it, and follows `$` only into
// functions declared here.

// What this copy of the code is doing right now. It lives in the module and
// not in the session's values: a reload that drops the code drops the work.
const work: {
  startFolder: string
  /** The row was asked for at least once, so somebody may be looking. */
  isSeen: boolean
  /** Starts the first pass; set when the session starts. */
  wake: (() => void) | null
  /** The band's own id, as the engine named it at the last drawing. */
  bandId: string
  isGathering: boolean
  isAnotherPassWanted: boolean
  /** How many passes were asked for so far. */
  passes: number
  isCheckingPlugin: boolean
  isCheckingHeavy: boolean
  isCheckingServer: boolean
  /** The repository the heavy files were last listed in, and when next. */
  heavyTop: string
  heavyNotBefore: number
  timer: { cancel: () => void } | null
  lastShortcut: { phrase: string; at: number } | null
  /** The push or update this copy of the code has in flight. */
  running: ProjectBandBusy
  /** The count of files under way, and the repository it counts. */
  counting: Promise<number | null> | null
  countingTop: string
  /** How the last count ended decides when the next may start. */
  filesTop: string
  filesWaitMs: number
  filesNotBefore: number
  /** How many drawings of the row are under way, and who waits for them. */
  drawing: number
  afterDrawing: (() => void)[]
  /** The project's name, as git gave it for one repository: asked once. */
  project: { top: string; name: string } | null
  /**
   * Whether fast mode is on in this conversation. Kept here too, because a
   * compaction empties the session's values while the mode goes on.
   */
  isFast: boolean
  /** The backup's age the owner hid its words at; kept here the same way. */
  backupHidden: number | null
} = {
  startFolder: '',
  isSeen: false,
  wake: null,
  bandId: 'above-prompt',
  isGathering: false,
  isAnotherPassWanted: false,
  passes: 0,
  isCheckingPlugin: false,
  isCheckingHeavy: false,
  isCheckingServer: false,
  heavyTop: '',
  heavyNotBefore: 0,
  timer: null,
  lastShortcut: null,
  running: { isPushing: false, isUpdating: false },
  counting: null,
  countingTop: '',
  filesTop: '',
  filesWaitMs: 0,
  filesNotBefore: 0,
  drawing: 0,
  afterDrawing: [],
  project: null,
  isFast: false,
  backupHidden: null,
}

function note($: Dollar, what: string, error: unknown): void {
  try {
    const said = error instanceof Error ? error.message : String(error)

    $.ui.log(`project band: ${what}: ${withoutSecrets(said).slice(0, 300)}`, {
      to: 'debug',
    })
  } catch {
    // A log line that cannot be written is not worth a second failure.
  }
}

// Work started by a press or a timer runs on after the hook returned, so
// nothing waits on it, and a failure in it lands in the debug log alone.
function inBackground($: Dollar, what: string, job: () => Promise<void>): void {
  void job().catch(error => note($, what, error))
}

// Resolves once no drawing of the row is under way. The wait is bounded: a
// drawing that never ends must not hold every later write back for good.
function drawingOver($: Dollar): Promise<void> {
  if (work.drawing <= 0) {
    return Promise.resolve()
  }

  return new Promise(resolve => {
    let timer: { cancel: () => void } | null = null
    const done = (): void => {
      try {
        timer?.cancel()
      } catch {
        // A timer that cannot be stopped fires into a settled promise.
      }

      resolve()
    }

    work.afterDrawing.push(done)

    try {
      timer = $.clock.after(DRAWING_WAIT_MS, done)
    } catch {
      // No clock to wait on: the end of the drawing alone decides.
    }
  })
}

// A write of one of the session's values. Claude Code refuses a write for as
// long as this plugin's row is being drawn, whoever makes it. So a write
// first lets the row's own drawing end. The moment can still be taken, by a
// drawing that has just been asked for or by another mod around this one, so
// a refused write waits a little and tries again, and only a write refused
// every time is given up.
async function retried($: Dollar, job: () => Promise<unknown>): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    if (work.drawing > 0) {
      await drawingOver($)
      // The drawing has ended here, but Claude Code has yet to hear of it.
      // One question to it first lets the answer of the drawing arrive.
      await $.clock.now()
    }

    try {
      await job()

      return
    } catch (error) {
      if (attempt >= WRITE_TRIES) {
        throw error
      }

      await $.clock.sleep(WRITE_WAIT_MS)
    }
  }
}

// An unchanged value is not written, so the row is not drawn again for it.
async function writeFacts(
  $: Dollar,
  change: (now: ProjectBandFacts | null) => ProjectBandFacts | null,
): Promise<void> {
  const now = await read($, facts)

  if (JSON.stringify(change(now)) !== JSON.stringify(now)) {
    await retried($, () => update($, facts, change))
  }
}

async function writeAsk($: Dollar, open: ProjectBandAsk | null): Promise<void> {
  await retried($, () => update($, ask, () => open))
}

async function writeBusy(
  $: Dollar,
  change: (now: ProjectBandBusy) => ProjectBandBusy,
): Promise<void> {
  await retried($, () => update($, busy, change))
}

async function homeOf($: Dollar): Promise<string | undefined> {
  return nonEmpty(await $.env.get('USERPROFILE')) ?? nonEmpty(await $.env.get('HOME'))
}

// The session's project root is the folder it was opened in. It follows a
// deliberate move (a worktree, /cd) and ignores a shell's cd.
async function folderOf($: Dollar): Promise<string> {
  try {
    const root = nonEmpty(await $.session.root())

    if (root !== undefined) {
      return root
    }
  } catch {
    // Fall back to the folder the session started in.
  }

  return work.startFolder
}

// The session's first value: nothing known yet. Every later write adds to
// it, so it has to be there before the first pass.
async function writeStart($: Dollar): Promise<void> {
  await writeFacts($, now =>
    now === null ? { project: null, repo: null, shortcuts: [], pluginUpdate: null } : now,
  )
}

// The project's name. Inside a repository it is the repository's name as its
// online address spells it, or the top folder's name when it has no online
// copy; git is asked once per repository and the answer is kept, so a later
// pass costs no git for it. Outside a repository it is the name of the folder
// the session was opened in.
async function projectOf($: Dollar, top: string | null, folder: string): Promise<string | null> {
  if (top === null) {
    // Git did not say where the folder is. Inside a repository whose name is
    // already known that is a git that failed for a moment, and the row keeps
    // the name it shows: a failure must not rename the project.
    if (work.project !== null && folder !== '' && isInside(folder, work.project.top)) {
      return work.project.name
    }

    const name = nonEmpty(nameOf(folder))

    return name === undefined ? null : cutToLabel(name)
  }

  if (work.project !== null && isSamePath(work.project.top, top)) {
    return work.project.name
  }

  const asked = await git($, ['remote', 'get-url', 'origin'], top, LOCAL_GIT_MS)
  const named = asked.code === 0 ? repoNameIn(firstLine(asked.out)) : undefined
  const name = named ?? nonEmpty(nameOf(top))

  if (name === undefined) {
    return null
  }

  // An answer that ran out of time is not kept: the next pass asks again.
  if (!asked.isTimeout) {
    work.project = { top, name: cutToLabel(name) }
  }

  return cutToLabel(name)
}

// The plugin copy of the kit, in a pass of its own: its online check can wait
// on the network for many seconds, and nothing else waits for it.
function startPluginPass($: Dollar): void {
  if (work.isCheckingPlugin) {
    return
  }

  work.isCheckingPlugin = true
  inBackground($, 'checking the plugin copy failed', async () => {
    try {
      const configDir = nonEmpty(await $.env.get('CLAUDE_CONFIG_DIR'))
      const pluginUpdate = await pluginUpdateOf($, configDir, await homeOf($))

      await writeFacts($, now => (now === null ? now : { ...now, pluginUpdate }))
    } finally {
      work.isCheckingPlugin = false
    }
  })
}

// The address the project's CLAUDE.md names, read the way the shortcuts are:
// the git top folder first, then the session folder.
async function serverUrlOf($: Dollar, folders: readonly string[]): Promise<string | null> {
  for (const folder of folders) {
    try {
      const url = serverUrlIn(await $.fs.read(joinPath(folder, 'CLAUDE.md')))

      if (url !== null) {
        return url
      }
    } catch {
      // No CLAUDE.md in this folder: no address from it.
    }
  }

  return null
}

// Whether the address answers, in a pass of its own so that nothing waits
// for it. Any answer at all counts as open, whatever its status: the server
// is there. No answer within the wait, or a refusal, counts as closed. Who
// started the server does not matter, only whether the address answers.
function startServerPass($: Dollar, folders: readonly string[]): void {
  if (work.isCheckingServer) {
    return
  }

  work.isCheckingServer = true
  inBackground($, 'checking the local server failed', async () => {
    try {
      const url = await serverUrlOf($, folders)

      if (url === null) {
        await writeFacts($, now => (now === null ? now : { ...now, server: null }))

        return
      }

      const isUp = await new Promise<boolean>(resolve => {
        let timer: { cancel: () => void } | null = null
        const done = (answer: boolean): void => {
          try {
            timer?.cancel()
          } catch {
            // A timer that cannot be stopped fires into a settled promise.
          }

          resolve(answer)
        }

        try {
          timer = $.clock.after(SERVER_WAIT_MS, () => done(false))
        } catch {
          // No clock to wait on: the address alone decides.
        }

        $.http.fetch(url).then(
          () => done(true),
          () => done(false),
        )
      })

      await writeFacts($, now => (now === null ? now : { ...now, server: isUp ? 'up' : 'down' }))
    } finally {
      work.isCheckingServer = false
    }
  })
}

// The heavy things in the project, in a pass of its own: the kit's listing
// walks every folder, which can take a while, and nothing waits for it. It
// runs where the project carries the listing, once per half hour. A run that
// failed keeps what the row shows.
function startHeavyPass($: Dollar, top: string): void {
  if (work.isCheckingHeavy) {
    return
  }

  work.isCheckingHeavy = true
  inBackground($, 'listing the heavy files failed', async () => {
    try {
      const now = await $.clock.now()

      if (isSamePath(work.heavyTop, top) && now < work.heavyNotBefore) {
        return
      }

      work.heavyTop = top
      work.heavyNotBefore = now + HEAVY_CHECK_MS

      let script: string | null = null

      for (const place of HEAVY_SCRIPTS) {
        if (script === null && (await $.fs.exists(`${top}/${place}`))) {
          script = place
        }
      }

      if (script === null) {
        await writeFacts($, now => (now === null ? now : { ...now, heavy: null }))

        return
      }

      const ran = await $.process.run(['node', script], { cwd: top, timeoutMs: HEAVY_RUN_MS })

      if (ran.exitCode === 0 && !ran.isStdoutTruncated) {
        const heavy = heavyIn(ran.stdout)

        await writeFacts($, now =>
          now === null ? now : { ...now, heavy: heavy > 0 ? heavy : null },
        )
      }
    } finally {
      work.isCheckingHeavy = false
    }
  })
}

// How old the newest backup is, in whole days. Asked only where the project
// carries the shortcut that makes one. A project with no backups folder, or
// with no ZIP in it, answers null and the row says nothing: the owner may
// keep the ZIPs somewhere else, so a missing one is not read as never.
async function backupOf(
  $: Dollar,
  top: string,
  shortcuts: readonly string[],
): Promise<{ days: number } | null> {
  try {
    if (!shortcuts.includes(BACKUP_SHORTCUT)) {
      return null
    }

    const dir = joinPath(top, BACKUP_FOLDER)

    if (!(await $.fs.exists(dir))) {
      return null
    }

    let newest = 0

    for (const entry of await $.fs.list(dir)) {
      if (entry.kind === 'file' && /\.zip$/i.test(entry.name) && entry.mtimeMs > newest) {
        newest = entry.mtimeMs
      }
    }

    if (newest === 0) {
      return null
    }

    return { days: Math.max(0, Math.floor(((await $.clock.now()) - newest) / DAY_MS)) }
  } catch (error) {
    note($, 'reading the age of the backup failed', error)

    return null
  }
}

// Writes whether fast mode is on, here and in the session's values.
async function setFast($: Dollar, isFast: boolean): Promise<void> {
  work.isFast = isFast
  await writeFacts($, now => (now === null ? now : { ...now, isFast }))
}

// A press on the backup's quiet words: they leave the row at the age they
// show, and nothing is sent. An older backup shows them again.
async function hideBackup($: Dollar): Promise<void> {
  const days = (await read($, facts))?.backup?.days

  if (days === undefined) {
    return
  }

  work.backupHidden = days
  await writeFacts($, now => (now === null ? now : { ...now, backupHidden: days }))
}

// The repository the session is in: the branch, its online copy, the
// shortcuts, and the count of files.
async function passRepo($: Dollar): Promise<void> {
  const home = await homeOf($)
  const folder = await folderOf($)
  const where = folder === '' ? null : await whereOf($, folder, home)
  const project = await projectOf($, where?.top ?? null, folder)

  // Outside a git repository the row is the label alone.
  if (where === null) {
    await writeFacts($, now =>
      now === null
        ? now
        : {
            ...now,
            project,
            repo: null,
            shortcuts: [],
            pluginUpdate: null,
            heavy: null,
            backup: null,
            server: null,
          },
    )

    return
  }

  // The project's name is written before the rest is asked: it is the row's
  // label, and the label never waits for the counts.
  await writeFacts($, now => (now === null ? now : { ...now, project }))

  startPluginPass($)
  startHeavyPass($, where.top)
  startServerPass($, [where.top, folder])

  const counting = countFiles($, where.top)
  const [part, shortcuts, hasResearch] = await Promise.all([
    branchPartOf($, where, home),
    shortcutsOf($, [where.top, folder]),
    // A Claude Code that cannot list its commands offers no such button.
    $.command.list().then(
      listed => listed.some(one => one.name === RESEARCH_COMMAND),
      () => false,
    ),
  ])
  const [counted, backup] = await Promise.all([
    countWithin($, counting, FILES_GRACE_MS),
    backupOf($, where.top, shortcuts),
  ])

  // While a count is still under way the row keeps the number it shows.
  await writeFacts($, now => {
    if (now === null) {
      return now
    }

    const shown =
      now.repo !== null && isSamePath(now.repo.top, part.top) ? now.repo.files : null

    return {
      ...now,
      repo: { ...part, files: counted.isDone ? counted.files : shown },
      shortcuts,
      hasResearch,
      backup,
    }
  })

  if (!counted.isDone) {
    inBackground($, 'writing the count of files failed', async () => {
      const files = await counting

      await writeFacts($, now =>
        now === null || now.repo === null || !isSamePath(now.repo.top, part.top)
          ? now
          : { ...now, repo: { ...now.repo, files } },
      )
    })
  }
}

// How full the conversation is. The session has no figure before its first
// answer, and none right after a compaction: the row shows nothing then. A
// reading that failed keeps the figure the row already shows.
async function passFill($: Dollar): Promise<void> {
  try {
    const fill = (await $.session.usage()).context.percent ?? null

    await writeFacts($, now => (now === null ? now : { ...now, fill }))
  } catch (error) {
    note($, 'reading how full the conversation is failed', error)
  }
}

async function closeAsk($: Dollar): Promise<void> {
  if ((await read($, ask)) !== null) {
    await writeAsk($, null)
  }
}

// One pass at a time. A pass asked for while one runs is not dropped: the
// running one goes round once more, so the row ends on the newest values.
async function refresh($: Dollar): Promise<void> {
  work.passes += 1

  if (work.isGathering) {
    work.isAnotherPassWanted = true

    return
  }

  work.isGathering = true

  try {
    do {
      work.isAnotherPassWanted = false

      const open = await read($, ask)

      if (open !== null && (await $.clock.now()) - open.askedAt >= ASK_KEEP_MS) {
        await closeAsk($)
      }

      await syncBusy($)

      if ((await read($, facts)) === null) {
        await writeStart($)
      }

      await passFill($)
      await passRepo($)
    } while (work.isAnotherPassWanted)
  } catch (error) {
    note($, 'gathering failed', error)
  } finally {
    work.isGathering = false
  }
}

// The branch and its online copy, read now: what a press needs before it
// asks or acts. No count of files, no network, nothing about the plugin copy.
async function branchNow($: Dollar): Promise<BranchPart | null> {
  const home = await homeOf($)
  const folder = await folderOf($)
  const where = folder === '' ? null : await whereOf($, folder, home)
  const part = where === null ? null : await branchPartOf($, where, home)

  await writeFacts($, now => {
    if (now === null) {
      return now
    }

    if (part === null) {
      return { ...now, repo: null, shortcuts: [], pluginUpdate: null }
    }

    const shown =
      now.repo !== null && isSamePath(now.repo.top, part.top) ? now.repo.files : null

    return { ...now, repo: { ...part, files: shown } }
  })

  return part
}

// Puts the keyboard on one of the row's buttons. The engine refuses when the
// row does not hold the keyboard, after a press with the mouse on the desktop
// for one. Nothing is lost by that: the owner presses with the mouse again.
async function moveRing($: Dollar, key: string): Promise<void> {
  try {
    await $.ui.focus({ requestId: work.bandId, key })
  } catch (error) {
    note($, 'moving the keyboard to a button failed', error)
  }
}

// After a question is gone, the keyboard goes back to the button that asked
// it, or to the first of `wanted` that the row draws at this width.
async function ringBack($: Dollar, wanted: readonly string[], columns: number): Promise<void> {
  const known = await read($, facts)

  if (known === null) {
    return
  }

  const drawn = keysOf(known, await read($, busy), columns)
  const key = wanted.find(one => drawn.includes(one))

  if (key !== undefined) {
    await moveRing($, key)
  }
}

// Takes the busy mark, and says whether this call was the one that took it.
// This copy of the code knows best what it has running: a cleared
// conversation starts with empty values while a push may still be on its way.
async function claim($: Dollar, what: keyof ProjectBandBusy): Promise<boolean> {
  if (work.running[what]) {
    return false
  }

  work.running[what] = true

  try {
    await writeBusy($, now =>
      what === 'isPushing' ? { ...now, isPushing: true } : { ...now, isUpdating: true },
    )
  } catch (error) {
    work.running[what] = false
    throw error
  }

  return true
}

// A mark that cannot be cleared here is put right by the next pass, which
// writes what this copy of the code has running.
async function release($: Dollar, what: keyof ProjectBandBusy): Promise<void> {
  work.running[what] = false

  try {
    await writeBusy($, now =>
      what === 'isPushing' ? { ...now, isPushing: false } : { ...now, isUpdating: false },
    )
  } catch (error) {
    note($, 'clearing the busy mark failed', error)
  }
}

// The busy mark on screen is the one this copy of the code has running. A
// reload of the code leaves the mark of a push that went with the old copy,
// and a new conversation starts without the mark of one still on its way.
async function syncBusy($: Dollar): Promise<void> {
  const state = await read($, busy)
  const isStale =
    state.isPushing !== work.running.isPushing ||
    state.isUpdating !== work.running.isUpdating

  if (isStale) {
    await writeBusy($, () => ({ ...work.running }))
  }
}

async function isTooSoon($: Dollar, askedAt: number): Promise<boolean> {
  const age = (await $.clock.now()) - askedAt

  return age >= 0 && age < CONFIRM_GUARD_MS
}

async function submitShortcut($: Dollar, phrase: string, columns: number): Promise<void> {
  const now = await $.clock.now()
  const last = work.lastShortcut
  const isRepeat =
    last !== null &&
    last.phrase === phrase &&
    now - last.at >= 0 &&
    now - last.at < REPEAT_PRESS_MS

  // A double click is one press: the second would queue the same prompt
  // again.
  if (isRepeat) {
    return
  }

  work.lastShortcut = { phrase, at: now }

  // Pressed in More: the list has done its job and the row comes back.
  if ((await read($, ask)) !== null) {
    await closeAsk($)
    await ringBack($, ['more'], columns)
  }

  // Deep research is a command, not words for the model: it is run as the
  // owner typing /deep-research would run it, and asks him for its topic.
  if (phrase === RESEARCH_SHORTCUT) {
    inBackground($, 'running /deep-research failed', async () => {
      try {
        await $.command.run({ command: RESEARCH_COMMAND })
      } catch (error) {
        note($, 'running /deep-research failed', error)
        $.ui.toast('Could not run /deep-research. Type it in the message box instead.', {
          timeoutMs: LONG_TOAST_MS,
        })
      }
    })

    return
  }

  // The exact phrase, as the owner's own words: the project's CLAUDE.md
  // answers to the phrase itself. A prompt waits its turn behind a running
  // turn, so nothing here waits for it to enter.
  const isFastNow = (await read($, facts))?.isFast === true
  const sent = sentOf(phrase, isFastNow)

  inBackground($, `submitting ${sent} failed`, async () => {
    try {
      await $.prompt.submit({ text: sent, asUser: true })

      // The row's own words do not pass its hook on prompts, so the mode is
      // followed here: Fast switches it, and Go commit ends it.
      const isFast = fastAfter(sent, isFastNow)

      if (isFast !== isFastNow) {
        await setFast($, isFast)
      }
    } catch (error) {
      // A press that did nothing would leave the owner waiting for a commit
      // that never starts.
      note($, `submitting ${sent} failed`, error)
      $.ui.toast(`Could not send "${sent}". Type it in the message box instead.`, {
        timeoutMs: LONG_TOAST_MS,
      })
    }
  })
}

// A press on the percentage compacts the conversation, as /compact typed by
// the owner does. The command waits its turn behind a running turn.
async function submitCompact($: Dollar): Promise<void> {
  const now = await $.clock.now()
  const last = work.lastShortcut
  const isRepeat =
    last !== null &&
    last.phrase === '/compact' &&
    now - last.at >= 0 &&
    now - last.at < REPEAT_PRESS_MS

  // A double click is one press: the second would compact once more.
  if (isRepeat) {
    return
  }

  work.lastShortcut = { phrase: '/compact', at: now }

  inBackground($, 'running /compact failed', async () => {
    try {
      await $.command.run({ command: 'compact' })
    } catch (error) {
      note($, 'running /compact failed', error)
      $.ui.toast('Could not run /compact. Type it in the message box instead.', {
        timeoutMs: LONG_TOAST_MS,
      })
    } finally {
      await refresh($)
    }
  })
}

async function askPush($: Dollar): Promise<void> {
  if (work.running.isPushing) {
    return
  }

  // Read again at the press, so the question names what is true now.
  const repo = await branchNow($)
  const target = pushTarget(repo)

  if (repo === null || target === null) {
    // Three different things, said apart: everything is online already, the
    // project is pushed from the git app, or git could not say what is
    // waiting. The last must not read like the first.
    const waiting = repo !== null && repo.online.kind === 'tracked' ? repo.online.ahead : null
    const isOwnPush = repo !== null && !repo.canPushHere && waiting !== null && waiting > 0

    $.ui.toast(
      waiting === 0
        ? 'Nothing to push. Everything is already online.'
        : isOwnPush
          ? 'This project has push steps of its own. Push it from your git app.'
          : 'Could not read what is waiting to be pushed. Try again in a moment.',
    )

    return
  }

  const askedAt = await $.clock.now()

  await writeAsk($, {
    kind: 'push',
    top: repo.top,
    branch: target.branch,
    url: target.url,
    commits: target.ahead,
    askedAt,
  })
  await moveRing($, 'cancel')
}

async function confirmPush($: Dollar, columns: number): Promise<void> {
  const open = await read($, ask)

  if (open === null || open.kind !== 'push' || (await isTooSoon($, open.askedAt))) {
    return
  }

  await closeAsk($)

  if (!(await claim($, 'isPushing'))) {
    return
  }

  let isSent = false

  try {
    await ringBack($, ['push', 'more'], columns)

    // One more read: the push must be the one the owner said yes to. Another
    // branch, another address or another number of commits is a different
    // push, and that one was never confirmed.
    const repo = await branchNow($)
    const target = pushTarget(repo)
    const isSamePlace =
      repo !== null &&
      isSamePath(repo.top, open.top) &&
      repo.branch === open.branch &&
      repo.online.kind === 'tracked' &&
      repo.online.url === open.url
    const isAlreadyOnline =
      isSamePlace && repo.online.kind === 'tracked' && repo.online.ahead === 0

    if (repo !== null && isAlreadyOnline) {
      $.ui.toast('Nothing to push. Everything is already online.')

      return
    }

    if (repo === null || target === null || !isSamePlace || target.ahead !== open.commits) {
      $.ui.toast(
        'Push did not go through: the branch changed since you asked. Nothing was pushed.',
        { timeoutMs: LONG_TOAST_MS },
      )

      return
    }

    // The current branch to its own upstream, both named in full. No force
    // and no tags, and naming both ends keeps a git setting from sending any
    // other branch along.
    isSent = true

    const ran = await git(
      $,
      [
        'push',
        '--no-follow-tags',
        target.remote,
        `refs/heads/${target.branch}:${target.ref}`,
      ],
      repo.top,
      PUSH_MS,
    )

    if (ran.code === 0) {
      $.ui.toast(`Pushed ${countOf(target.ahead, 'commit')}`)
    } else if (ran.isTimeout) {
      // A push stopped halfway may still have landed, so this one does not
      // promise that nothing changed.
      $.ui.toast(
        'Push did not go through: it took too long. Check the online copy before pushing again.',
        { timeoutMs: LONG_TOAST_MS },
      )
    } else {
      note($, 'push failed', `${ran.err}\n${ran.out}`)
      $.ui.toast(
        `Push did not go through: ${reasonOf(`${ran.err}\n${ran.out}`)}. Nothing changed.`,
        { timeoutMs: LONG_TOAST_MS },
      )
    }
  } catch (error) {
    note($, 'push failed', error)

    if (!isSent) {
      $.ui.toast(
        'Push did not go through: something went wrong on this side. Nothing changed.',
        { timeoutMs: LONG_TOAST_MS },
      )
    }
  } finally {
    await release($, 'isPushing')
    await refresh($)
  }
}

async function askUpdate($: Dollar): Promise<void> {
  const dir = (await read($, facts))?.pluginUpdate?.dir

  if (dir === undefined || work.running.isUpdating) {
    return
  }

  const from = await git($, ['remote', 'get-url', 'origin'], dir, LOCAL_GIT_MS)
  const url = from.code === 0 ? nonEmpty(firstLine(from.out)) : undefined
  const askedAt = await $.clock.now()

  await writeAsk($, {
    kind: 'update',
    dir,
    url: url === undefined ? null : shownUrl(url),
    askedAt,
  })
  await moveRing($, 'cancel')
}

async function confirmUpdate($: Dollar, columns: number): Promise<void> {
  const open = await read($, ask)

  if (open === null || open.kind !== 'update' || (await isTooSoon($, open.askedAt))) {
    return
  }

  await closeAsk($)

  if (!(await claim($, 'isUpdating'))) {
    return
  }

  try {
    await ringBack($, ['update-plugin', 'more'], columns)

    // Fast-forward only: the plugin copy either moves straight to the online
    // version or stays exactly as it is.
    const ran = await git($, ['pull', '--ff-only'], open.dir, PUSH_MS)

    if (ran.code === 0) {
      $.ui.toast(
        /already up to date/i.test(ran.out)
          ? 'The plugin was already up to date'
          : 'Plugin updated',
      )
    } else if (ran.isTimeout) {
      // Stopped halfway, so no promise about what did or did not change.
      $.ui.toast('Update did not go through: it took too long. Try again in a moment.', {
        timeoutMs: LONG_TOAST_MS,
      })
    } else {
      note($, 'plugin update failed', `${ran.err}\n${ran.out}`)
      $.ui.toast(
        `Update did not go through: ${reasonOf(`${ran.err}\n${ran.out}`)}. Nothing changed.`,
        { timeoutMs: LONG_TOAST_MS },
      )
    }
  } catch (error) {
    note($, 'plugin update failed', error)
  } finally {
    await release($, 'isUpdating')
    await refresh($)
  }
}

async function askMore($: Dollar, phrases: string[], hasUpdate: boolean): Promise<void> {
  const askedAt = await $.clock.now()
  const first = phrases[0]

  await writeAsk($, { kind: 'more', phrases, hasUpdate, askedAt })
  await moveRing($, first === undefined ? 'update-plugin' : keyOf(first))
}

// Cancel, and Back in More: the question goes and the row comes back.
async function cancelAsk($: Dollar, columns: number): Promise<void> {
  const open = await read($, ask)

  if (open === null) {
    return
  }

  await closeAsk($)
  await ringBack(
    $,
    open.kind === 'push'
      ? ['push', 'more']
      : open.kind === 'update'
        ? ['update-plugin', 'more']
        : ['more'],
    columns,
  )
}

// What a new copy of this code, or a new conversation in the same window,
// starts from. A reload of the code leaves the session's values behind: a
// push that was running in the old copy is gone with it, so a busy mark this
// copy did not set, and any question left open, are cleared. A new
// conversation starts with empty values instead, while a push of this copy
// may still be on its way, so the mark is put back. Then the first value, and
// a pass when somebody is looking and the first look has not started one.
//
// Fast mode belongs to one conversation. A new copy of the code takes it
// from the session's values, which a reload leaves in place and a new session
// starts without. A compaction goes on in the same conversation, so the mode
// is kept through it; any other new conversation starts with the mode off.
// The backup words the owner hid follow the same road.
async function begin($: Dollar, isNewCode: boolean, keepsFast: boolean): Promise<void> {
  const passesBefore = work.passes

  await syncBusy($)

  if (isNewCode) {
    await closeAsk($)
    const kept = await read($, facts)

    work.isFast = kept?.isFast === true
    work.backupHidden = kept?.backupHidden ?? null
  } else if (!keepsFast) {
    work.isFast = false
    work.backupHidden = null
  }

  await writeStart($)
  await setFast($, work.isFast)
  await writeFacts($, now =>
    now === null ? now : { ...now, backupHidden: work.backupHidden },
  )

  if (work.isSeen && work.passes === passesBefore) {
    await refresh($)
  }
}

/**
 * Registers the band above the message box. The plugin's hooks module calls
 * this once, from its own `register(on)`.
 */
export function registerProjectBand(on: On): void {
  on('session.start', EVERY_SESSION, ($, e, next) => {
    try {
      work.startFolder = e.cwd
      work.timer?.cancel()
      work.timer = $.clock.every(REFRESH_MS, () => {
        if (work.isSeen) {
          inBackground($, 'the timed pass failed', () => refresh($))
        }
      })
      work.wake = () => {
        inBackground($, 'the first pass failed', () => refresh($))
      }
      // Not awaited: the first prompt must never wait for this.
      inBackground($, 'starting failed', () => begin($, true, true))
    } catch (error) {
      note($, 'starting failed', error)
    }

    return next(e)
  })

  // /clear, a resume, a compaction or a fork puts another conversation in
  // the same window with no session start. The window's values start empty
  // then, so the label and the counts are gathered again at once.
  on('classic.SessionStart', NEW_CONVERSATION, ($, e, next) => {
    try {
      work.startFolder = e.cwd
      inBackground($, 'starting the new conversation failed', () =>
        begin($, false, e.source === 'compact'),
      )
    } catch (error) {
      note($, 'starting the new conversation failed', error)
    }

    return next(e)
  })

  // The mode is switched by words: the row's own button sends them, and the
  // owner types them. Either way they pass here, and the Fast button follows.
  // A prompt that did not enter changes nothing.
  on('prompt.submit', EVERY_PROMPT, async ($, e, next) => {
    const entered = await next(e)

    try {
      const isFast = fastAfter(e.text, work.isFast)

      if (!('drop' in entered) && isFast !== work.isFast) {
        work.isFast = isFast
        inBackground($, 'writing the fast mode failed', () => setFast($, isFast))
      }
    } catch (error) {
      note($, 'following the fast mode failed', error)
    }

    return entered
  })

  on('turn.complete', EVERY_TURN_END, ($, e, next) => {
    // A turn of the main conversation may have changed files or committed.
    // Subagents finish all the time; the main turn's end covers their work.
    if (e.agentId === undefined && work.isSeen) {
      inBackground($, 'the pass after a turn failed', () => refresh($))
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const isFirstLook = !work.isSeen
    const passesBefore = work.passes

    work.drawing += 1

    try {
      let row: RenderElement | null = null

      try {
        work.isSeen = true
        work.bandId = e.requestId

        // A survey holds the band while it runs; the row waits for it.
        const known = e.props.hasSurvey ? null : await read($, facts)

        if (known !== null) {
          const reserve = e.surface === 'terminal' ? TERMINAL_MARK_CELLS : 0
          const resolved: Table = $.ui.resolve(e)
          // The terminal has no drawing to show, whatever its table holds.
          const table: Table =
            e.surface === 'terminal'
              ? { Box: resolved.Box, Text: resolved.Text, Button: resolved.Button }
              : resolved
          // Where the mark is drawn, the row is planned without its cells.
          // The check mark belongs to the plain row: a question or the More
          // list in the row's place draws none, and gives up no cells for it.
          const open = await read($, ask)
          const isCheckDrawn =
            open === null && table.Svg !== undefined && known.repo?.files === 0
          const columns =
            (e.props.bodyColumns > 0 ? e.props.bodyColumns : 1_000) -
            reserve -
            (table.Svg !== undefined ? MARK_CELLS : 0) -
            (table.Svg !== undefined && (known.server ?? null) !== null ? SERVER_CELLS : 0) -
            (isCheckDrawn ? CHECK_CELLS : 0)
          const look: Look = {
            known,
            state: await read($, busy),
            open,
            columns,
            reserve,
            isCheckDrawn,
          }

          // The presses that ask are handed back to the engine, which waits
          // for them. The two that push or pull run on in the background:
          // they can take minutes, and nothing should wait that long.
          row = drawBand(table, look, {
            shortcut: phrase =>
              submitShortcut($, phrase, columns).catch(error =>
                note($, 'a shortcut press failed', error),
              ),
            askPush: () => askPush($).catch(error => note($, 'asking to push failed', error)),
            askUpdate: () =>
              askUpdate($).catch(error => note($, 'asking to update failed', error)),
            askMore: (phrases, hasUpdate) =>
              askMore($, phrases, hasUpdate).catch(error =>
                note($, 'opening More failed', error),
              ),
            compact: () =>
              submitCompact($).catch(error => note($, 'a press on the fill failed', error)),
            hideBackup: () =>
              hideBackup($).catch(error => note($, 'hiding the backup words failed', error)),
            confirmPush: () =>
              inBackground($, 'the push failed', () => confirmPush($, columns)),
            confirmUpdate: () =>
              inBackground($, 'the update failed', () => confirmUpdate($, columns)),
            cancel: () =>
              cancelAsk($, columns).catch(error =>
                note($, 'taking the question back failed', error),
              ),
          })
        }
      } catch (error) {
        note($, 'drawing the band failed', error)
        row = null
      }

      if (row === null) {
        return await next(e)
      }

      // Another mod may draw in the band too. Its tree stays, above this row;
      // the engine itself draws nothing here.
      try {
        const beneath = await next(e)

        if (beneath.type !== 'engine') {
          const { Box } = $.ui.resolve(e)

          return (
            <Box flexDirection="column">
              {beneath}
              {row}
            </Box>
          )
        }
      } catch (error) {
        note($, 'reading the band beneath failed', error)
      }

      return row
    } finally {
      // The drawing is over: the writes that waited for it go on.
      work.drawing -= 1

      if (work.drawing <= 0) {
        work.drawing = 0

        for (const goOn of work.afterDrawing.splice(0)) {
          goOn()
        }
      }

      // The first look at the row is what starts git: a session nobody looks
      // at runs none. It starts here, as the drawing ends, because nothing
      // may be written while a row is being drawn. The start of the session
      // may have sent a pass off while this row was being drawn, and one
      // look is worth one pass.
      if (isFirstLook && work.passes === passesBefore) {
        try {
          work.wake?.()
        } catch {
          // The next pass comes with the timer or the next finished turn.
        }
      }
    }
  })
}
