// Project-band.tsx: the band above the message box.
//
// WHAT IT SHOWS. One compact row with three things the owner asked for: whose
// window this is (a small colored label), what is waiting in the folder the
// session was opened in (files not committed, commits to push, an update for
// the plugin copy of the kit), and the buttons that act on it.
//
// WHY IT NEVER SLOWS A SESSION. Drawing reads values the session already
// holds and does no git, file or network work. The values are gathered in the
// background, and each part is written the moment it is known: whose window
// this is as the session starts, the repository once the row has been looked
// at, and the plugin copy from a pass of its own, so a network that does not
// answer never holds the label or the counts back. A session nobody looks at
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
  ProjectBandProfile,
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
// A conversation that takes the place of another in the same window: after
// /clear, a resume, a compaction or a fork. No session start comes with it.
const NEW_CONVERSATION = { source: ['clear', 'resume', 'compact', 'fork'] } as const

// The shortcuts a button exists for, in the order More lists them. A button
// appears only when the project's CLAUDE.md carries the phrase as a heading,
// so a project without the kit never gets a button that does nothing.
const SHORTCUTS = [
  'Go commit',
  'Go backup',
  'Go audit',
  'Go update kit',
  'Go code review',
] as const
const MAIN_SHORTCUT = 'Go commit'

const REFRESH_MS = 60_000
const PLUGIN_CHECK_MS = 30 * 60_000
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
// check per half hour.
const PLUGIN_CHECK_KEY = 'band.pluginCheck'

// A missing sign-in must fail instead of waiting for an answer nobody can
// type: no prompt in a terminal, and no sign-in window from the credential
// manager.
const QUIET_GIT = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }

// The label colors. All are dark enough for white text. Red is left out
// because it reads as an error.
const LABEL_COLORS = [
  '#2563eb',
  '#7c3aed',
  '#a21caf',
  '#be185d',
  '#c2410c',
  '#a16207',
  '#15803d',
  '#0f766e',
] as const
const PERSONAL_COLOR = '#6b7280'
const LABEL_TEXT_COLOR = '#ffffff'
const LABEL_MAX = 24

const SHA = /^[0-9a-f]{40,64}$/

type Dollar = EngineInterface

// Every surface has these three elements, so one drawing serves them all.
type Table = Pick<Elements['mobile'], 'Box' | 'Text' | 'Button'>

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
}

type RowPlan = {
  /** The label's name, cut shorter when the row is very narrow. */
  name: string
  words: string
  hasCommit: boolean
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

function profileOf(
  configDir: string | undefined,
  home: string | undefined,
): { name: string; isPersonal: boolean } {
  const personal = { name: 'Personal', isPersonal: true }

  if (configDir === undefined) {
    return personal
  }

  // A profile pointed at the home folder's own .claude is the personal one,
  // whatever set the variable.
  if (home !== undefined && isSamePath(configDir, joinPath(home, '.claude'))) {
    return personal
  }

  const name = nameOf(configDir)

  if (name === '') {
    return personal
  }

  return {
    name: name.length > LABEL_MAX ? `${name.slice(0, LABEL_MAX - 1)}\u2026` : name,
    isPersonal: false,
  }
}

// The place in the color list a name lands on by itself: a small stable hash
// (FNV-1a), the same in every window and every session.
function ownColorOf(name: string): number {
  let hash = 0x811c9dc5

  for (const letter of name.toLowerCase()) {
    hash ^= letter.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return hash % LABEL_COLORS.length
}

// The color of one client folder among the folders beside it. Every folder
// would take the color of its own name, and two names often land on the same
// one. So the folders are walked in name order, and one whose color is taken
// moves on to the next free color: up to eight clients get eight colors, and
// each window works out the same answer. Past eight, and for a folder that is
// not in the list, the color of the name stands.
function colorOf(folder: string, siblings: readonly string[]): string {
  const wanted = folder.toLowerCase()
  const taken = new Set<number>()

  for (const sibling of [...new Set(siblings.map(name => name.toLowerCase()))].sort()) {
    let place = ownColorOf(sibling)

    if (taken.size < LABEL_COLORS.length) {
      while (taken.has(place)) {
        place = (place + 1) % LABEL_COLORS.length
      }

      taken.add(place)
    }

    if (sibling === wanted) {
      return LABEL_COLORS[place] ?? PERSONAL_COLOR
    }
  }

  return LABEL_COLORS[ownColorOf(wanted)] ?? PERSONAL_COLOR
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

// What origin's main points at, asked online at most once per half hour. The
// claim is written before the question goes out, so several windows that
// refresh together send one question between them, and a network that does
// not answer is not asked again for half an hour either.
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

function wordsOf(known: ProjectBandFacts, isShort: boolean): string[] {
  const words: string[] = []
  const repo = known.repo

  if (repo === null) {
    return words
  }

  if (repo.files === 0) {
    words.push('all committed')
  } else if (repo.files !== null) {
    words.push(
      isShort
        ? `${repo.files} not committed`
        : `${countOf(repo.files, 'file')} not committed`,
    )
  }

  if (repo.online.kind === 'none') {
    words.push(isShort ? 'no online copy' : 'no online copy yet')
  } else if (repo.online.kind === 'tracked' && repo.online.ahead > 0) {
    // Where the row offers no Push because the project has a push step of
    // its own, the words say where to push from instead.
    words.push(
      isShort
        ? `${repo.online.ahead} to push`
        : repo.canPushHere
          ? `${countOf(repo.online.ahead, 'commit')} to push`
          : `${countOf(repo.online.ahead, 'commit')} to push from your git app`,
    )
  }

  if (known.pluginUpdate !== null) {
    words.push(isShort ? 'update ready' : 'plugin update ready')
  }

  return words
}

function pushLabelOf(state: ProjectBandBusy): string {
  return state.isPushing ? 'Pushing...' : 'Push'
}

function updateLabelOf(state: ProjectBandBusy): string {
  return state.isUpdating ? 'Updating...' : 'Update plugin'
}

// The cells a run of buttons takes as the terminal draws them: a button is
// its label and four more cells, and one cell separates neighbors.
function buttonsWidth(labels: readonly string[]): number {
  return labels.reduce((sum, text) => sum + 1 + text.length + 4, 0)
}

// The row must fit the width it is given. When it cannot, the words get
// shorter first, then Go commit moves behind More, then Update plugin does.
// Past that the layout cuts the words, down to a handful of cells and then
// away, and when even the label and the buttons do not fit, the label's name
// is cut. Push stays in every step.
function planOf(
  known: ProjectBandFacts,
  state: ProjectBandBusy,
  columns: number,
): RowPlan {
  const isInRepo = known.repo !== null
  const hasMain = isInRepo && known.shortcuts.includes(MAIN_SHORTCUT)
  const others = isInRepo
    ? SHORTCUTS.filter(
        phrase => phrase !== MAIN_SHORTCUT && known.shortcuts.includes(phrase),
      )
    : []
  const canPush = pushTarget(known.repo) !== null
  const canUpdate = isInRepo && known.pluginUpdate !== null
  const fullName = known.profile.name
  const steps = [
    { isShort: false, hasCommit: hasMain, hasUpdate: canUpdate },
    { isShort: true, hasCommit: hasMain, hasUpdate: canUpdate },
    { isShort: true, hasCommit: false, hasUpdate: canUpdate },
    { isShort: true, hasCommit: false, hasUpdate: false },
  ]
  let plan: RowPlan = {
    name: fullName,
    words: '',
    hasCommit: false,
    hasUpdate: false,
    more: [],
    moreHasUpdate: false,
  }
  let fixed = 0

  for (const step of steps) {
    const words = wordsOf(known, step.isShort).join(' \u00b7 ')
    const more = [...(hasMain && !step.hasCommit ? [MAIN_SHORTCUT] : []), ...others]
    const moreHasUpdate = canUpdate && !step.hasUpdate
    const buttons = [
      ...(step.hasCommit ? [MAIN_SHORTCUT] : []),
      ...(canPush ? [pushLabelOf(state)] : []),
      ...(step.hasUpdate ? [updateLabelOf(state)] : []),
      ...(more.length > 0 || moreHasUpdate ? ['More'] : []),
    ]

    fixed = buttonsWidth(buttons)
    plan = {
      name: fullName,
      words,
      hasCommit: step.hasCommit,
      hasUpdate: step.hasUpdate,
      more,
      moreHasUpdate,
    }

    if (fullName.length + 2 + (words === '' ? 0 : 1 + words.length) + fixed <= columns) {
      return plan
    }
  }

  // The layout cuts the words to the cells that are left after the label,
  // the buttons and the one cell between. Too few to read anything in, and
  // the words are left out.
  const wordsRoom = columns - (fullName.length + 2) - fixed - 1
  const words = wordsRoom >= WORDS_MIN_CELLS ? plan.words : ''
  // The label is the name between two spaces. What the buttons leave is all
  // it can have, and never less than one letter and the mark of a cut.
  const room = Math.max(columns - fixed - 2, 2)

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
    ...(plan.hasCommit ? ['go-commit'] : []),
    ...(pushTarget(known.repo) !== null ? ['push'] : []),
    ...(plan.hasUpdate ? ['update-plugin'] : []),
    ...(plan.more.length > 0 || plan.moreHasUpdate ? ['more'] : []),
  ]
}

function keyOf(phrase: string): string {
  return phrase.toLowerCase().replace(/\s+/g, '-')
}

function drawLabel({ Box, Text }: Table, profile: ProjectBandProfile, name: string): RenderElement {
  return (
    <Box flexShrink={0}>
      <Text backgroundColor={profile.color} color={LABEL_TEXT_COLOR} bold>
        {` ${name} `}
      </Text>
    </Box>
  )
}

function drawRow(table: Table, look: Look, acts: Acts): RenderElement {
  const { Box, Text, Button } = table
  const { known, state } = look
  const plan = planOf(known, state, look.columns)
  const files = known.repo?.files ?? null
  const canPush = pushTarget(known.repo) !== null
  const hasMore = plan.more.length > 0 || plan.moreHasUpdate
  // Nothing waiting reads quieter than something waiting.
  const isCalm =
    (files === null || files === 0) &&
    !(known.repo?.online.kind === 'tracked' && known.repo.online.ahead > 0) &&
    known.pluginUpdate === null
  // Go commit is the main action only while there is something to commit.
  const mainLook = files !== null && files > 0 ? { variant: 'primary' as const } : {}
  const hasButtons = plan.hasCommit || canPush || plan.hasUpdate || hasMore

  // Centered across the row: on the desktop a button is taller than a line of
  // text, and the label and the words should sit level with it.
  return (
    <Box flexDirection="row" alignItems="center" gap={1} paddingRight={look.reserve}>
      {drawLabel(table, known.profile, plan.name)}
      {plan.words !== '' && (
        <Box flexShrink={1}>
          <Text wrap="truncate-end" dimColor={isCalm}>
            {plan.words}
          </Text>
        </Box>
      )}
      {hasButtons && (
        <Box flexDirection="row" gap={1} flexShrink={0}>
          {plan.hasCommit && (
            <Button
              key="go-commit"
              label={MAIN_SHORTCUT}
              {...mainLook}
              onPress={() => acts.shortcut(MAIN_SHORTCUT)}
            />
          )}
          {canPush && (
            <Button key="push" label={pushLabelOf(state)} onPress={() => acts.askPush()} />
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
  )
}

// A question takes the row's place until it is answered. Cancel comes first
// and the keyboard starts on it: a stray Enter then takes the question back,
// and only a deliberate press pushes or pulls. The words are never cut, so
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
  const name = look.known.profile.name
  const isOneRow =
    name.length + 2 + 1 + said.length + buttonsWidth(['Cancel', yes.label]) <= look.columns
  const buttons = (
    <Box flexDirection="row" gap={1} flexShrink={0}>
      <Button key="cancel" label="Cancel" autoFocus onPress={() => acts.cancel()} />
      <Button key={yes.key} label={yes.label} variant="primary" onPress={yes.onPress} />
    </Box>
  )

  if (isOneRow) {
    return (
      <Box flexDirection="row" alignItems="center" gap={1} paddingRight={look.reserve}>
        {drawLabel(table, look.known.profile, name)}
        <Box flexShrink={1}>
          <Text bold>{said}</Text>
        </Box>
        {buttons}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" paddingRight={look.reserve}>
      <Box flexDirection="row" gap={1}>
        {drawLabel(table, look.known.profile, name)}
        <Box flexShrink={1}>
          <Text bold wrap="wrap">
            {said}
          </Text>
        </Box>
      </Box>
      {buttons}
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
  const files = look.known.repo?.files ?? null

  return (
    <Box
      flexDirection="row"
      flexWrap="wrap"
      alignItems="center"
      columnGap={1}
      paddingRight={look.reserve}
    >
      {drawLabel(table, look.known.profile, look.known.profile.name)}
      {open.phrases.map(phrase => (
        <Button
          key={keyOf(phrase)}
          label={phrase}
          {...(phrase === MAIN_SHORTCUT && files !== null && files > 0
            ? { variant: 'primary' as const }
            : {})}
          onPress={() => acts.shortcut(phrase)}
        />
      ))}
      {open.hasUpdate && (
        <Button key="update-plugin" label="Update plugin" onPress={() => acts.askUpdate()} />
      )}
      <Button key="cancel" label="Back" onPress={() => acts.cancel()} />
    </Box>
  )
}

function drawBand(table: Table, look: Look, acts: Acts): RenderElement {
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
} = {
  startFolder: '',
  isSeen: false,
  wake: null,
  bandId: 'above-prompt',
  isGathering: false,
  isAnotherPassWanted: false,
  passes: 0,
  isCheckingPlugin: false,
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

// Whose window this is. Three reads of the environment and one look at the
// folders beside the profile's own, for the color: no git, so it is written
// first and the label is there before anything else is known.
async function writeProfile($: Dollar): Promise<void> {
  const configDir = nonEmpty(await $.env.get('CLAUDE_CONFIG_DIR'))
  const named = profileOf(configDir, await homeOf($))
  let color: string = PERSONAL_COLOR

  if (!named.isPersonal && configDir !== undefined) {
    let siblings: string[] = []

    try {
      const beside = parentOf(configDir)

      if (beside !== null) {
        siblings = (await $.fs.list(beside))
          .filter(entry => entry.kind === 'dir')
          .map(entry => entry.name)
      }
    } catch {
      // A folder that cannot be listed: the name alone picks the color.
    }

    color = colorOf(nameOf(configDir), siblings)
  }

  const profile: ProjectBandProfile = { ...named, color }

  await writeFacts($, now =>
    now === null
      ? { profile, repo: null, shortcuts: [], pluginUpdate: null }
      : { ...now, profile },
  )
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

// The repository the session is in: the branch, its online copy, the
// shortcuts, and the count of files.
async function passRepo($: Dollar): Promise<void> {
  const home = await homeOf($)
  const folder = await folderOf($)
  const where = folder === '' ? null : await whereOf($, folder, home)

  // Outside a git repository the row is the label alone.
  if (where === null) {
    await writeFacts($, now =>
      now === null ? now : { ...now, repo: null, shortcuts: [], pluginUpdate: null },
    )

    return
  }

  startPluginPass($)

  const counting = countFiles($, where.top)
  const [part, shortcuts] = await Promise.all([
    branchPartOf($, where, home),
    shortcutsOf($, [where.top, folder]),
  ])
  const counted = await countWithin($, counting, FILES_GRACE_MS)

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
        await writeProfile($)
      }

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

  // The exact phrase, as the owner's own words: the project's CLAUDE.md
  // answers to the phrase itself. A prompt waits its turn behind a running
  // turn, so nothing here waits for it to enter.
  inBackground($, `submitting ${phrase} failed`, async () => {
    try {
      await $.prompt.submit({ text: phrase, asUser: true })
    } catch (error) {
      // A press that did nothing would leave the owner waiting for a commit
      // that never starts.
      note($, `submitting ${phrase} failed`, error)
      $.ui.toast(`Could not send "${phrase}". Type it in the message box instead.`, {
        timeoutMs: LONG_TOAST_MS,
      })
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
// may still be on its way, so the mark is put back. Then the label, and a
// pass when somebody is looking and the first look has not started one.
async function begin($: Dollar, isNewCode: boolean): Promise<void> {
  const passesBefore = work.passes

  await syncBusy($)

  if (isNewCode) {
    await closeAsk($)
  }

  await writeProfile($)

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
      inBackground($, 'starting failed', () => begin($, true))
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
      inBackground($, 'starting the new conversation failed', () => begin($, false))
    } catch (error) {
      note($, 'starting the new conversation failed', error)
    }

    return next(e)
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
          const columns = (e.props.bodyColumns > 0 ? e.props.bodyColumns : 1_000) - reserve
          const look: Look = {
            known,
            state: await read($, busy),
            open: await read($, ask),
            columns,
            reserve,
          }

          // The presses that ask are handed back to the engine, which waits
          // for them. The two that push or pull run on in the background:
          // they can take minutes, and nothing should wait that long.
          row = drawBand($.ui.resolve(e), look, {
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
