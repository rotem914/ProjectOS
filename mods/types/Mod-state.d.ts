// Mod-state.d.ts: every value the mods keep in the session, in one place.
//
// A plugin names one contract file, and Claude Code holds each stored value
// to the type written here. Every part of the plugin that keeps a value adds
// its types and its keys to this file, and imports the types from it.
//
// Today only the band above the message box keeps values. The band never
// runs git while it draws. It gathers these values in the background and
// draws from them, so a slow disk or a silent network can never hold up a
// prompt. The live reply check keeps nothing here: its few values live in
// its own module.

/**
 * Where the checked out branch stands against its online copy.
 *
 * `unknown` draws nothing: git did not answer, or there is no branch to
 * speak of. `none` is a branch that was never put online. `tracked` carries
 * the count of commits waiting to be pushed and where they would go; `url`
 * is null when git could not name the address, and then no Push is offered.
 */
export type ProjectBandOnline =
  | { kind: 'unknown' }
  | { kind: 'none' }
  | {
      kind: 'tracked'
      remote: string
      ref: string
      url: string | null
      ahead: number
    }

/** The git repository the session was opened in. */
export type ProjectBandRepo = {
  /** The repository's top folder, as git spells it. */
  top: string
  /** The branch checked out; null when there is none or git did not say. */
  branch: string | null
  /** Files with uncommitted changes; null when git did not answer in time. */
  files: number | null
  online: ProjectBandOnline
  /**
   * True when a push from the row does everything a push from the owner's git
   * app would. False when the project has a push step of its own (a check, an
   * upload of large files), which a push from the row would skip, and false
   * too when that could not be read.
   */
  canPushHere: boolean
}

/** Everything the row draws from. Each part is written as it is gathered. */
export type ProjectBandFacts = {
  /**
   * The project's name, which the row shows as its label: the repository's
   * name as its online address spells it, the top folder's name when it has
   * no online copy, or the session folder's name outside a repository. Null
   * until git has been asked. A value kept by an earlier version of the mod
   * has no such key, and reads the same as null.
   */
  project?: string | null
  /** Null outside a git repository, and until git has answered. */
  repo: ProjectBandRepo | null
  /** The shortcut phrases the project's CLAUDE.md carries as headings. */
  shortcuts: string[]
  /** Set only while the plugin copy of the kit is behind its online copy. */
  pluginUpdate: { dir: string } | null
  /**
   * How full the conversation is, as a whole percentage. Null before the
   * conversation's first answer and right after a compaction. A value kept by
   * an earlier version of the mod has no such key, and reads the same as null.
   */
  fill?: number | null
}

/**
 * The one question the row can have open. It is asked in the row itself,
 * where the keyboard already is. `askedAt` is when it was put: a yes that
 * comes right after it is the second half of a double press, and a question
 * nobody answers is taken back after a while.
 */
export type ProjectBandAsk =
  | {
      kind: 'push'
      top: string
      branch: string
      url: string
      commits: number
      askedAt: number
    }
  | { kind: 'update'; dir: string; url: string | null; askedAt: number }
  | { kind: 'more'; phrases: string[]; hasUpdate: boolean; askedAt: number }

/** What is running right now, so a second press does nothing. */
export type ProjectBandBusy = {
  isPushing: boolean
  isUpdating: boolean
}

// The keys are spelled out here, under the plugin's own name: the check that
// reads a plugin before it loads looks each key up in this block.
declare module 'claude-code' {
  interface PluginState {
    'projectos-mods': {
      bandFacts: ProjectBandFacts | null
      bandAsk: ProjectBandAsk | null
      bandBusy: ProjectBandBusy
    }
  }
}
