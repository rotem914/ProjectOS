// Reply-format-check.mjs - reads the reply that ended a turn against the
// project's reply rules, and leaves a note for the next reply when it broke
// one that a script can check without guessing.
//
// WHY. The reply rules reach the assistant as text, and a rule that is only
// text gets broken while the rules around it are kept. It bit on 2026-10-21:
// a plan's three numbered points sat glued to the line above each of them,
// with the divider rule written in Conversations.md and nothing checking it.
// The checks below began in one project, where they had run since 2026-07-24,
// and came to the kit that day (owner, after asking why nothing caught it).
//
// WHAT THE OWNER SEES. Nothing. The reply is already on screen, and a hook
// that sent it back for a rewrite would show the owner the same answer twice,
// which is what the project it came from asked to stop. So it never blocks:
// it writes a note, and the plugin puts the note in front of the assistant
// with the owner's next message, once, then deletes it. The next reply is the
// one corrected, and the assistant is told never to resend this one.
//
// ONLY WHAT THE PROJECT'S RULES STATE. Each check runs only when its rule's
// own sentence is in project-os/Conversations.md or one of its continuation
// files (Conversations-2.md and on), and the note names the rule by the
// number of the heading that sentence sits under. A project that reworded or
// dropped a rule is not held to it, and a project that renumbered its rules
// is told its own numbers. The limits of rule 1 (the lines, the words, the
// lines of a full report and the phrases that ask for one) are read out of
// the rule itself, never set here, and so are rule 10's labels that mark a
// findings list.
//
// THE CHECKS. Each one is a rule a script can test with no judgment:
//   - the reply language, when the rules name English: no other script
//   - the line ceiling of a reply, which a findings list does not have
//   - the words in one line
//   - a divider directly above every `# H1`
//   - a divider above every bold point headline of a stacked list
//   - one sentence per line
//   - two asks in the closing section as a numbered list
//   - a link or a path written in full, inside a fence; in prose too when the
//     project's rule says even a name in backticks is written in full
// Every other rule needs judgment, and stays the assistant's.
//
// WHAT IS NOT READ. A fenced block is one object (rule 12), so the layout
// checks skip it; only the path check reads inside one, since a fence is
// where a link is given. The FAST MODE offer in CLAUDE.md is quoted verbatim
// and does not count against the reply it closes, so its quoted lines are
// skipped whole.
//
// DURING THE INSTALL. While Conversations.md still holds a setup placeholder,
// the rules are not yet the owner's, and the install's own question batch is
// long by design. So the check stays silent until the install fills them.
// The install's closing report comes after that, and rule 1 exempts it from
// the line ceiling too: it is known by its first and last sections.
//
// WHO RUNS IT. The ProjectOS plugin, from its own copy of this file, on the
// Stop event (hooks/dispatch.mjs, "stop"), through the environment:
//
//   CLAUDE_PROJECT_DIR   the project, whose rules are read
//   REPLY_CHECK_NOTE     a file outside the project, where the note waits
//
// A project whose own settings wire a reply check of its own keeps it, and
// the plugin stands down there.
//
// FAIL OPEN. Any error here, an unreadable transcript, no rules file: exit 0
// and no note. A hook bug must never trap the owner.
//
// Every character outside plain ASCII is spelled as an escape, so no editor
// or shell on the way can change one.
//
// Proven by tests/Reply-format-check-tests.mjs in the kit.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOW = 0;
const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const NOTE = process.env.REPLY_CHECK_NOTE || '';
const RULES_FILE = /^Conversations(?:-\d+)?\.md$/;
const SETUP_PLACEHOLDER = new RegExp('\\{\\{[A-Z][A-Z0-9_]*\\}\\}|Setup step: ' + 'replace this block');

// ---------------------------------------------------------------------------
// Reading the rules
// ---------------------------------------------------------------------------

/**
 * The project's reply rules as one text, the main file first and each
 * continuation after it in number order, or null when there is no main file.
 */
export function readRulesText(root) {
  const folder = path.join(root, 'project-os');
  let names;

  try {
    names = fs.readdirSync(folder).filter((name) => RULES_FILE.test(name));
  } catch {
    return null;
  }

  if (!names.includes('Conversations.md')) return null;

  const order = (name) => Number((/-(\d+)\.md$/.exec(name) ?? [0, 1])[1]);

  return names
    .sort((a, b) => order(a) - order(b))
    .map((name) => {
      try {
        return fs.readFileSync(path.join(folder, name), 'utf8');
      } catch {
        return '';
      }
    })
    .join('\n');
}

// The number of the `### N` heading above a place in the rules text.
const ruleNumberAt = (text, at) => {
  let number = null;
  const heading = /^#{2,4}\s+(\d+)\b/gm;
  let m;

  while ((m = heading.exec(text)) !== null && m.index <= at) number = m[1];

  return number;
};

// Finds a rule's sentence, and with it the number of the rule it sits under.
// The same words can come first in a passage above the numbered rules, so
// the first place that sits under a numbered heading wins.
const find = (text, sentence) => {
  const every = new RegExp(sentence.source, sentence.flags.includes('g') ? sentence.flags : `${sentence.flags}g`);
  let first = null;

  for (const m of text.matchAll(every)) {
    const number = ruleNumberAt(text, m.index);

    if (number !== null) return { number, match: m };
    first = first ?? { number, match: m };
  }

  return first;
};

// The phrases written in backticks on one line, an ending ellipsis dropped:
// "`full report`, `Daily report \u2026`" gives "full report" and "Daily report".
const backticked = (line) =>
  [...line.matchAll(/`([^`\n]+)`/g)]
    .map((m) => m[1].replace(/(?:\u2026|\.{3})\s*$/, '').trim())
    .filter(Boolean);

/**
 * What the project's reply rules ask of a reply, as far as a script can
 * check it. A rule whose sentence is missing comes back null, and its check
 * does not run.
 */
export function readReplyRules(text) {
  const lines = find(text, /(\d+)\s+prose lines,\s+each at most\s+(\d+)\s+words/i);
  // The sentence that lifts the ceiling, read inside rule 1 only (from its
  // sentence to the next heading), to its full stop, however it is wrapped.
  // A file name in it is a pointer, never a phrase that asks for the report.
  const ruleOne = lines ? text.slice(lines.match.index).split(/\n#{2,4}\s/)[0] : '';
  const liftAt = ruleOne.search(/\blifts\b/i);
  const lift = liftAt < 0 ? '' : ruleOne.slice(liftAt).split(/\.(?=\s|$)/)[0];
  const liftLines = /(\d+)\s+prose lines/i.exec(lift);
  // The labels of a stacked point, as rule 10 names them in backticks
  // (`Problem:`, `Proposal:`); its first two mark a findings list.
  const point = find(text, /\*\*bold\*\* headline with `-{3,}` above it/);
  const ruleTen = point ? text.slice(point.match.index).split(/\n#{2,4}\s/)[0] : '';
  const named = backticked(ruleTen).filter((label) => /^[^`\n]{1,30}:$/.test(label));
  const labels = named.length >= 2 ? named.slice(0, 2) : ['Problem:', 'Proposal:'];
  const paths = find(text, /\bFULL\b[^\n]{0,40}\bpath\b/);
  const routes = find(text, /\bFULL\b[^\n]{0,40}\b(?:address|URL)\b/);

  return {
    // The language block, as the install fills it ("Reply in English,
    // always."). Only English is checked: a reply in another language still
    // names code and tools in English, so letters alone cannot tell.
    english: /\breply in English\b|\bevery reply is in English\b/i.test(text),
    ceiling: lines
      ? {
          number: lines.number,
          lines: Number(lines.match[1]),
          words: Number(lines.match[2]),
          reportLines: liftLines ? Number(liftLines[1]) : null,
          reportPhrases: backticked(lift).filter((phrase) => !/\.[A-Za-z0-9]+$/.test(phrase)),
          findingsExempt: /\bfindings list\b[^\n]*\bno ceiling\b/i.test(text),
          labels,
        }
      : null,
    h1Divider: find(text, /directly above every\s+`# H1`/),
    pointDivider: point ? { ...point, labels } : null,
    // The rule's own sentence: the bare words also sit inside rule 10.
    oneSentence: find(text, /\bone sentence per line, never two\b/i),
    numberedAsks: (() => {
      const asks = find(text, /\bTwo asks are two numbered items\b/i);

      return asks ? { ...asks, labels } : null;
    })(),
    fullPaths:
      paths || routes
        ? {
            number: (paths ?? routes).number,
            // The project's rule may let a name given only to identify a file
            // stay inline; then only a fence is held to it.
            inProse: !/\bnamed only to identify\b/i.test(text),
          }
        : null,
  };
}

/** True while the install has not yet filled the rules in. */
export const isMidInstall = (text) => SETUP_PLACEHOLDER.test(text);

/** The project's local address, as CLAUDE.md names it, or null. */
export function localAddressIn(claudeMd) {
  const named = /local app url[^\n]*?(https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?)/i.exec(claudeMd);
  const any = /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?/i.exec(claudeMd);

  return named?.[1] ?? any?.[0] ?? null;
}

// ---------------------------------------------------------------------------
// Reading the transcript
// ---------------------------------------------------------------------------

const textOf = (content) => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
};

// Only the owner typing starts a turn. Not a tool's output handed back, and
// not what the harness writes on its own: a row marked isMeta (an image's
// caption, a skill's text, "Continue from where you left off."), the summary
// after a compaction, a background task's notice, a command's own output, or
// a copy of the request sent to the model (a row of another type).
const isOwnerTyping = (row, message) => {
  if (row.type !== undefined && row.type !== 'user') return false;
  if (row.isMeta || row.isCompactSummary) return false;

  const content = message.content;
  const typed = Array.isArray(content)
    ? content.some((block) => block && block.type !== 'tool_result')
    : typeof content === 'string';

  return typed && !/^\s*<(?:task-notification|local-command|command-name)/.test(textOf(content));
};

/**
 * The last reply of the current turn, and the owner's typed message that
 * started it. A reply from before the owner's last message belongs to an
 * earlier turn and is never read again: judging it twice was a false alarm.
 */
export function lastTurnIn(transcript) {
  let reply = null;
  let asked = '';

  for (const line of transcript.split(/\r?\n/)) {
    if (line.trim() === '') continue;

    let row;

    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }

    if (row === null || typeof row !== 'object') continue;

    const message = row.message ?? row;
    const role = message.role ?? row.role;

    if (role === 'user') {
      if (isOwnerTyping(row, message)) {
        asked = textOf(message.content);
        reply = null;
      }
      continue;
    }

    if (role !== 'assistant' || (row.type !== undefined && row.type !== 'assistant')) continue;

    const text = textOf(message.content);

    if (text.trim() !== '') reply = text;
  }

  return { reply, asked };
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

// One fence model for every check. A fence opens on a run of three or more
// backticks or tildes at the start of a line, indented or not (a fence inside
// a list item sits deeper), and closes on a later run of the same mark at
// least as long, with nothing after it. An unclosed fence runs to the end.
const FENCE_OPEN = /^\s*(`{3,}|~{3,})/;
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/;

/** The reply's lines, and which of them sit in a fence or the FAST MODE offer. */
export function linesOf(reply) {
  const lines = reply.split(/\r?\n/);
  const fenced = new Array(lines.length).fill(false);
  // Each fence's body, the lines between its two marks.
  const fences = [];
  let mark = null;
  let length = 0;

  for (let i = 0; i < lines.length; i += 1) {
    if (mark === null) {
      const open = FENCE_OPEN.exec(lines[i]);

      if (open) {
        mark = open[1][0];
        length = open[1].length;
        fenced[i] = true;
        fences.push({ from: i + 1, to: lines.length });
      }
    } else {
      fenced[i] = true;
      const close = FENCE_CLOSE.exec(lines[i]);

      if (close && close[1][0] === mark && close[1].length >= length) {
        mark = null;
        length = 0;
        fences[fences.length - 1].to = i;
      }
    }
  }

  // The FAST MODE offer: a run of quoted lines that carries `FAST ON`.
  const quoted = new Array(lines.length).fill(false);

  for (let i = 0; i < lines.length; ) {
    if (fenced[i] || !/^\s*>/.test(lines[i])) {
      i += 1;
      continue;
    }

    let end = i;

    while (end < lines.length && !fenced[end] && /^\s*>/.test(lines[end])) end += 1;

    if (lines.slice(i, end).some((line) => /\bFAST ON\b/.test(line))) {
      for (let j = i; j < end; j += 1) quoted[j] = true;
    }

    i = end;
  }

  return { lines, fenced, fences, skipped: lines.map((_, i) => fenced[i] || quoted[i]) };
}

const isDivider = (t) => /^-{3,}$/.test(t);
const isGap = (t) => /^(?:&nbsp;)+$/.test(t);
const isHeading = (t) => /^#{1,6} /.test(t);
const isScaffold = (t) => t === '' || isGap(t) || isDivider(t) || isHeading(t);

// Inline code becomes one placeholder word: its contents can trip nothing,
// and a sentence ending right after it still reads as a sentence.
const withoutCode = (line) => line.replace(/`[^`\n]*`/g, 'code');

// The prose lines that count: not fenced, not quoted in the offer, and not
// layout (a blank line, a gap line, a divider, a heading).
const proseOf = ({ lines, skipped }) =>
  lines.map((line, i) => ({ t: line.trim(), i })).filter(({ t, i }) => !skipped[i] && !isScaffold(t));

// Every line with text in it, headings included: the language and one
// sentence per line hold for a heading as for any line.
const textLines = ({ lines, skipped }) =>
  lines
    .map((line, i) => ({ t: line.trim(), i }))
    .filter(({ t, i }) => !skipped[i] && t !== '' && !isGap(t) && !isDivider(t));

// Quoted words are the quote's, not the reply's: a sentence inside one, or
// a question mark, is not a second sentence or a second ask.
const withoutQuotes = (line) => line.replace(/"[^"\n]*"|\u201c[^\u201d\n]*\u201d/g, 'quote');

const countWords = (line) =>
  withoutCode(line)
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

const DEFAULT_LABELS = ['Problem:', 'Proposal:'];
const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A label alone on its line, bold or plain.
const labelLine = (labels) => new RegExp(`^(?:\\*\\*)?(?:${labels.map(escaped).join('|')})(?:\\*\\*)?$`);

const isFindingsList = (view, labels = DEFAULT_LABELS) =>
  labels.every((label) => view.lines.some((line, i) => !view.skipped[i] && labelLine([label]).test(line.trim())));

// A word of a script other languages are written in: Hebrew, Arabic,
// Cyrillic, the Chinese, Japanese and Korean scripts, Thai, Devanagari. Two
// letters or more, so a lone symbol is never a language, and Greek is left
// out, since its letters are the symbols of maths and units (pi, delta, ohm).
// Inline code is cleared first, so a name quoted in it may hold any script.
const OTHER_SCRIPT =
  /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Cyrillic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Devanagari}]{2,}/u;

/** The language: the lines, headings included, that hold a word of another script. */
export const otherScript = (view) =>
  textLines(view)
    .filter(({ t }) => OTHER_SCRIPT.test(withoutCode(t)))
    .map(({ t }) => t);

// A phrase that asks for a full report, its words joined by a space, a
// hyphen, an underscore, a line break or nothing: "full-report" asks too.
const phraseIn = (phrase) =>
  new RegExp(
    phrase
      .trim()
      .split(/\s+/)
      .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[\\s_-]*'),
    'i',
  );

// The install's closing report is exempt from the line ceiling (rule 1, and
// Installation.md, step 8), as the question batch is. It is known by its
// first and its last section.
const isInstallReport = ({ lines, skipped }) => {
  const heads = lines
    .filter((line, i) => !skipped[i] && /^# /.test(line.trim()))
    .map((line) => line.trim().slice(2).trim().toLowerCase());

  return heads.includes('waiting on you') && (heads.includes('what was set') || heads.includes('rules not enforced'));
};

/** Rule 1: the prose lines over the ceiling, or null. */
export function overCeiling(view, ceiling, asked) {
  if (ceiling.findingsExempt && isFindingsList(view, ceiling.labels)) return null;
  if (isInstallReport(view)) return null;

  const wanted = ceiling.reportPhrases.some((phrase) => phraseIn(phrase).test(asked));
  const limit = wanted && ceiling.reportLines ? ceiling.reportLines : ceiling.lines;
  const count = proseOf(view).length;

  return count > limit ? { count, limit } : null;
}

/** Rule 1: the lines over the words in one line. */
export const overWords = (view, ceiling) =>
  proseOf(view)
    .filter(({ t }) => countWords(t) > ceiling.words)
    .map(({ t }) => t);

// Allowed above a heading or a point: the divider, or the divider and one
// blank line.
const dividedAbove = (lines, i) => {
  const one = (lines[i - 1] ?? '').trim();
  const two = (lines[i - 2] ?? '').trim();

  return isDivider(one) || (one === '' && isDivider(two));
};

/** Rule 3: the `# H1` headings with no divider above them. */
export const headingsWithoutDivider = ({ lines, skipped }) =>
  lines
    .map((line, i) => ({ t: line.trim(), i }))
    .filter(({ t, i }) => !skipped[i] && /^# /.test(t) && !dividedAbove(lines, i))
    .map(({ t }) => t);

// A point of a stacked list is known without guessing: its bold headline is
// numbered (`1 \u00b7`), or a `Problem:` or `Proposal:` label follows it
// before the next point. A bold status header (`**Done**`) is neither and
// takes no divider. A bold label ends on its colon, so it is never a
// headline, and a line holding two bold spans is prose.
const NUMBERED_POINT = /^\d+\s*(?:\u00b7|\.|\))\s+\S/;
const boldHeadline = (t) => {
  const m = /^\*\*(.+)\*\*$/.exec(t);

  return m && !m[1].includes('**') && !/:$/.test(m[1].trim()) ? m[1].trim() : null;
};

/** Rule 10: the bold point headlines with no divider above them. */
export function pointsWithoutDivider({ lines, skipped }, labels = DEFAULT_LABELS) {
  const bad = [];
  const label = labelLine(labels);

  for (let i = 0; i < lines.length; i += 1) {
    if (skipped[i]) continue;

    const t = lines[i].trim();
    const inner = boldHeadline(t);

    if (inner === null) continue;

    let isPoint = NUMBERED_POINT.test(inner);

    for (let j = i + 1; !isPoint && j < lines.length; j += 1) {
      if (skipped[j]) continue;

      const next = lines[j].trim();

      if (isDivider(next) || /^# /.test(next) || boldHeadline(next) !== null) break;
      isPoint = label.test(next);
    }

    if (isPoint && !dividedAbove(lines, i)) bad.push(t);
  }

  return bad;
}

// Rule 5. A word or a closing mark, an ending stop, space, then a capital
// letter opening the next sentence. Abbreviations are masked first, so the
// stops inside them are not read as sentence ends.
const TWO_SENTENCES = /[\p{Ll}\p{Lu}\p{Nd})\]"'\u201d\u2019][.!?]\s+["'\u201c(]*[A-Z]/u;
const ABBR_LATIN = /(^|[\s(])(e\.g\.|i\.e\.|etc\.|vs\.|cf\.|a\.m\.|p\.m\.)(?=$|[\s),;:])/gi;
const ABBR_TITLE =
  /(^|[\s(])(Dr\.|Mr\.|Mrs\.|Ms\.|No\.|Fig\.|St\.|Mt\.|Jr\.|Sr\.|Inc\.|Ltd\.|Co\.|U\.S\.|Ph\.D\.|approx\.|incl\.)(?=$|[\s),;:])/g;
// An initial, as in "J. K. Rowling": one capital and its stop.
const INITIAL = /(^|[\s(])([A-Z]\.)(?=\s+[A-Z])/g;
// A list item's own marker, "1." or "-", is not a sentence end.
const LIST_MARKER = /^(?:[-*+]|\d{1,3}[.)])\s+/;
const maskAbbr = (line) => {
  const blank = (_whole, before, abbr) => before + abbr.replace(/\./g, ' ');

  return line.replace(ABBR_LATIN, blank).replace(ABBR_TITLE, blank).replace(INITIAL, blank);
};

/** Rule 5: the lines, headings included, that hold two sentences or more. */
export const denseLines = (view) =>
  textLines(view)
    .filter(({ t }) => TWO_SENTENCES.test(maskAbbr(withoutQuotes(withoutCode(t.replace(LIST_MARKER, ''))))))
    .map(({ t }) => t);

// Rule 8. An ask is a word that asks at the start of a clause. After "and"
// or "or" only the words that ask the owner count: "and I pick the faster
// one" is the assistant's own clause. A question counts only in a closing
// section that asks with no such word: a question that leads in to its Say
// line is one ask, and a question mark inside a quote is the quote's.
const NUMBERED = /^\s*(?:\(?\d+[).]|\d+\s*[).])\s+\S/;
const ASK_SOURCE =
  /(?:^|[.!?;:]\s+|\s[\u2014\u2013-]\s*)(say|tell me|let me know|pick|choose|confirm|decide|give me)\b|\b(?:and|or)\s+(say|tell me|let me know|give me)\b/
    .source;

/** Rule 8: the closing section's asks when there are two or more and no list. */
export function unnumberedAsks({ lines, skipped }, labels = DEFAULT_LABELS) {
  let start = -1;

  for (let i = 0; i < lines.length; i += 1) {
    if (!skipped[i] && /^# /.test(lines[i].trim())) start = i;
  }

  if (start === -1) return null;

  const body = [];

  for (let i = start + 1; i < lines.length; i += 1) {
    const t = lines[i].trim();

    if (!skipped[i] && !isScaffold(t)) body.push(t);
  }

  if (body.length === 0 || body.some((t) => NUMBERED.test(t))) return null;
  // A findings list's Proposal lines say what the assistant would do, never
  // what the owner owes: a closing section that holds one is not judged.
  if (body.some((t) => labelLine(labels).test(t))) return null;

  let verbs = 0;
  let questions = 0;

  for (const t of body) {
    const plain = withoutQuotes(withoutCode(t)).replace(/\]\([^)\s]*\)/g, ']');

    for (const sentence of plain.split(/(?<=[.!?])\s+/)) {
      const found = (sentence.match(new RegExp(ASK_SOURCE, 'gi')) ?? []).length;

      verbs += found;
      if (found === 0 && /\?/.test(sentence)) questions += 1;
    }
  }

  const asks = verbs > 0 ? verbs : questions;

  return asks >= 2
    ? { asks, sample: body.filter((t) => /\?/.test(t) || new RegExp(ASK_SOURCE, 'i').test(t)) }
    : null;
}

// Rule 12. A route alone (`/admin/users`), a host without its scheme
// (`localhost:3000/x`, `example.com/x`), or a path relative to the project
// (`src/app.js`, `.tmp/x`, `~/x`) is half of what the owner needs. A full path
// from a drive and a full address are cleared first, so a path with a space
// in it never trips the check on its second half.
const namesIn = (dir, onlyFolders) => {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => !onlyFolders || entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
};

// The folders a full path starts from on macOS and Linux. A path that starts
// with one is whole, never a route.
const SYSTEM_ROOTS = ['/Users/', '/home/', '/Volumes/', '/tmp/', '/var/', '/opt/', '/etc/', '/usr/', '/mnt/', '/private/', '/root/', '/srv/'];

/**
 * The first parts of a page's address, the folders a path can start with,
 * and the starts of a full path.
 */
export function projectNames(root) {
  const pageFolders = [['src', 'pages'], ['pages'], ['app'], ['src', 'app'], ['src', 'routes'], ['app', 'routes']];
  const pages = pageFolders.flatMap((parts) => namesIn(path.join(root, ...parts), false));
  const posixRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');

  return {
    pageRoots: new Set(pages.map((name) => name.replace(/\.[A-Za-z0-9]+$/, ''))),
    pathRoots: new Set(['project-os', 'plans', 'features', 'src', 'scripts', 'tests', 'hooks', ...namesIn(root, true)]),
    fullStarts: posixRoot.startsWith('/') ? [`${posixRoot}/`, ...SYSTEM_ROOTS] : SYSTEM_ROOTS,
  };
}

const isHalfPath = (token, names) => {
  const t = token.replace(/^[`"'{]+/, '').replace(/[`"'}.,;:!?]+$/, '');

  if (t === '' || /^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^[A-Za-z]:[\\/]/.test(t)) return false;
  if ((names.fullStarts ?? []).some((start) => t.startsWith(start))) return false;

  if (/^\/\S/.test(t)) {
    const parts = t.slice(1).split('/');

    return parts.length > 1 || names.pageRoots.has(parts[0]);
  }

  if (/^(?:\.{1,2}|~|\.[A-Za-z][\w-]*)[\\/]/.test(t)) return true;
  if (/^localhost(?::\d+)?(?:\/|$)/.test(t)) return true;
  if (/^[\w-]+(?:\.[\w-]+)+\/\S/.test(t)) return true;

  const m = /^([A-Za-z0-9_-]+)[\\/](\S+)$/.exec(t);

  if (!m) return false;

  return names.pathRoots.has(m[1]) || (/[\\/]/.test(m[2]) && /\.[A-Za-z0-9]+$/.test(m[2]));
};

// A command line that starts by entering a folder by its full path, as rule 12
// asks, may name what is inside it by the short path after that.
const ENTERS_FOLDER = /^\s*(?:cd|pushd|set-location|sl)\s+(?:\/d\s+)?["']?(?:[A-Za-z]:[\\/]|\/)/i;

/**
 * Rule 12: the half links and paths. Where the project's rule lets a name
 * given only to identify a file stay inline, a fence that holds one address
 * or path and nothing else is the one case that cannot be read two ways: it
 * is there to be copied, as rule 12 gives each its own fence. A fence of
 * several lines is code or a file's content, written as the file needs it.
 * Where the rule wants every path in full, every word of every line is read,
 * fences included.
 */
export function halfPaths({ lines, fenced, fences, skipped }, names, inProse) {
  const bad = [];

  if (!inProse) {
    for (const { from, to } of fences) {
      const body = lines.slice(from, to).map((line) => line.trim()).filter(Boolean);

      if (body.length === 1 && !/\s/.test(body[0]) && isHalfPath(body[0], names)) bad.push(body[0]);
    }

    return bad;
  }

  lines.forEach((line, i) => {
    if (skipped[i] && !fenced[i]) return;
    if (ENTERS_FOLDER.test(line)) return;

    const cleared = line
      .replace(/[A-Za-z]:[\\/][^`"'<>\n]*/g, ' ')
      .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, ' ');

    for (const token of cleared.split(/[\s()[\]<>]+/)) {
      if (isHalfPath(token, names)) bad.push(token);
    }
  });

  return bad;
}

// ---------------------------------------------------------------------------
// The note
// ---------------------------------------------------------------------------

const clip = (line) => (line.length > 140 ? `${line.slice(0, 137)}...` : line);
const listed = (lines) => lines.slice(0, 3).map((line) => `  - ${clip(line)}`).join('\n');
const ruleName = (number) => (number ? `Rule ${number}` : 'The reply rules');

/**
 * The note for one reply, or '' when it kept every rule checked here.
 * `context` carries the project's root, its local address and its names.
 */
export function noteFor(reply, asked, rules, context) {
  const view = linesOf(reply);
  const parts = [];

  if (rules.english) {
    const bad = otherScript(view);

    if (bad.length) {
      parts.push(
        `The reply language (every reply in English, whatever language the owner wrote in), these lines hold ` +
          `another script. A word the owner must see in it is quoted in inline code:\n${listed(bad)}`,
      );
    }
  }

  if (rules.h1Divider) {
    const bad = headingsWithoutDivider(view);

    if (bad.length) {
      parts.push(`${ruleName(rules.h1Divider.number)} (a ---- divider directly above every # H1), these headings have none:\n${listed(bad)}`);
    }
  }

  if (rules.pointDivider) {
    const bad = pointsWithoutDivider(view, rules.pointDivider.labels);

    if (bad.length) {
      parts.push(
        `${ruleName(rules.pointDivider.number)} (a ---- divider above every bold point headline), these points have none, ` +
          `so each one runs into the line before it:\n${listed(bad)}`,
      );
    }
  }

  if (rules.oneSentence) {
    const bad = denseLines(view);

    if (bad.length) {
      parts.push(`${ruleName(rules.oneSentence.number)} (one sentence per line), these lines hold two or more:\n${listed(bad)}`);
    }
  }

  if (rules.numberedAsks) {
    const bad = unnumberedAsks(view, rules.numberedAsks.labels);

    if (bad) {
      parts.push(
        `${ruleName(rules.numberedAsks.number)} (two asks are two numbered items), the closing section asks ${bad.asks} ` +
          `things in one run of text, and the second gets buried:\n${listed(bad.sample)}\n` +
          'Next reply: one numbered line per ask.',
      );
    }
  }

  if (rules.ceiling) {
    const long = overCeiling(view, rules.ceiling, asked);

    if (long) {
      parts.push(
        `${ruleName(rules.ceiling.number)} (cut hard), ${long.count} prose lines where the ceiling is ${long.limit}.\n` +
          'Next reply: cut the content, never the layout. Drop what the owner already knows, every ' +
          'restatement and every option you are not recommending. Dividers, headings, blank lines and ' +
          'fences are not counted, and they stay.',
      );
    }

    const wordy = overWords(view, rules.ceiling);

    if (wordy.length) {
      parts.push(
        `${ruleName(rules.ceiling.number)} (${rules.ceiling.words} words in a line), these lines became paragraphs. ` +
          `Say the one thing each line is for, its problem and its reason, and stop:\n${listed(wordy)}`,
      );
    }
  }

  if (rules.fullPaths) {
    const bad = halfPaths(view, context.names, rules.fullPaths.inProse);

    if (bad.length) {
      const page = context.address ? `${context.address}/... for a page here` : 'the full address for a page';
      const file = `${context.root.replace(/[\\/]+$/, '')}${path.sep}... for a file`;

      parts.push(
        `${ruleName(rules.fullPaths.number)} (every link and path in full), these are a route without its address, ` +
          `a host without its scheme, or a path without its drive:\n${listed(bad)}\n` +
          `Next reply: ${page}, ${file}.`,
      );
    }
  }

  if (parts.length === 0) return '';

  return [
    'REPLY FORMAT: your reply broke the project\'s reply rules (project-os/Conversations.md).',
    'The owner has already read it. Never resend it and never mention this note: apply it to the reply',
    'you write now.',
    '',
    parts.join('\n\n'),
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function writeNote(text) {
  if (NOTE === '') return;

  try {
    fs.mkdirSync(path.dirname(NOTE), { recursive: true });

    const draft = `${NOTE}.${process.pid}.tmp`;

    // Created new or not at all: a file or a link already standing at that
    // name, in a temp folder others may share, is never written through.
    fs.writeFileSync(draft, text, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(draft, NOTE);
  } catch {
    // A note that cannot be kept is a correction lost, never an error.
  }
}

function main() {
  let payload = {};

  try {
    payload = JSON.parse(readStdin() || '{}') ?? {};
  } catch {
    process.exit(ALLOW);
  }

  // A second Stop in the same turn (the check when a turn ends sent the
  // assistant back) is read too: this check never blocks, so it cannot loop,
  // and the reply that closed the turn is the one the owner read last.
  const transcriptPath = payload.transcript_path;

  if (typeof transcriptPath !== 'string' || !fs.existsSync(transcriptPath)) process.exit(ALLOW);

  const text = readRulesText(ROOT);

  if (text === null || isMidInstall(text)) process.exit(ALLOW);

  const { reply, asked } = lastTurnIn(fs.readFileSync(transcriptPath, 'utf8'));

  if (!reply) process.exit(ALLOW);

  let claudeMd = '';

  try {
    claudeMd = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
  } catch {
    // No CLAUDE.md: no local address to suggest.
  }

  const note = noteFor(reply, asked, readReplyRules(text), {
    root: ROOT,
    address: localAddressIn(claudeMd),
    names: projectNames(ROOT),
  });

  if (note !== '') writeNote(note);

  process.exit(ALLOW);
}

const isRunDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isRunDirectly) {
  try {
    main();
  } catch {
    process.exit(ALLOW);
  }
}
