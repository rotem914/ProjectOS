// Path-guard.mjs - PreToolUse hook. Refuses the file writes it recognises that
// are aimed outside the project folder, before they happen.
//
// A rule in a document depends on the assistant reading and remembering it,
// and a permission prompt only ASKS. This does not ask. It reads every write the
// file tools make and every Bash / PowerShell command (redirections, writing
// programs, cmdlets, wrappers, inline shells, inline scripts, `cd` moves) and
// exits 2 on any write it recognises whose target it cannot prove is inside
// the project. A delete, and a move's source, count as writes.
//
// Installed by `node project-os/Install-project-hooks.mjs`, which wires it as:
//   PreToolUse, matcher "Write|Edit|NotebookEdit|Bash|PowerShell|Monitor",
//   command: node "<project root>/project-os/guards/Path-guard.mjs"
//
// The project root comes from the session (CLAUDE_PROJECT_DIR, then the
// payload's cwd), never from where this file happens to sit, so one copy guards
// whichever project is open. It runs on Windows, macOS and Linux: a POSIX
// absolute path is a real path when the project root is POSIX, and the MSYS
// drive spelling Git Bash produces (`/c/...`) is folded back to `C:/...` only
// when the root itself has a drive letter.
//
// Fail OPEN: any error, unreadable payload or unknown tool exits 0. A guard bug
// must never trap the owner. The only thing it blocks on purpose is a write it
// cannot prove is inside the project.
//
// Two narrow exceptions, both owner-editable constants below:
//   ALLOW_CLAUDE_MEMORY  the assistant's own memory folder, markdown only.
//   EXTRA_ROOTS          other folders the owner has explicitly approved writes
//                        into, named literally; agent config and env files stay
//                        refused even there. Empty by default.
//
// Read as well (review 2026-09-28): the body of a here-document that feeds an
// interpreter or a shell (`python3 - <<'EOF'`, `bash <<'EOF'`); the commands
// inside `$( )`, backticks and `<( )`; a bash `{ }` group and a PowerShell
// script block; `find -exec`; `eval` and `Invoke-Expression`; .NET calls such
// as `[IO.File]::WriteAllText`; a cmdlet after `$null =` or `[void](`; and a
// `#` comment, which ends the words of a command.
//
// Read as well (kit fix list, 2026-10-02): the command after a loop or a
// condition word (`do`, `then`, `else`, a case pattern), with a rename loop over
// literal names in the project still allowed; a PowerShell here-string and a
// here-document inside a quoted `$( )` as text; a script piped into an
// interpreter or a shell; the paths a PowerShell writer takes from its
// pipeline, and the files `find` hands to `-exec`; git changing a repository
// in another folder; and sed's `-e` value as its script, never a file.
//
// What it does NOT cover, stated plainly: it recognises the common ways a
// command writes a file, and a command it does not recognise runs unchecked, so
// it is a safety net, not a wall. The assistant's own storage (session
// transcripts, sub-agent logs, overflow of long tool output) is written by the
// application, not by the assistant, and cannot be redirected.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOW = 0;
const BLOCK = 2;
const MAX_DEPTH = 5;

// Claude's memory folder is required by its own system prompt, so blocking it
// would simply stop memory working. Allowed by exception, narrowly: only
// markdown, only under ~/.claude/projects/<project>/memory/ in the user's home.
// Set this to false and memory stops, the owner's call, one edit.
const ALLOW_CLAUDE_MEMORY = true;

const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '');
const HOME = norm(os.homedir() || '').toLowerCase();
const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Folders OUTSIDE the project the owner has explicitly approved writes into,
// named literally, one per line, forward slashes. Empty by default. A write may
// land in one of them only when the session is inside the project or inside one
// of them, and agent config and env files stay refused even there, so a session
// can never widen another folder's permissions or touch its secrets. Set
// ALLOW_EXTRA_ROOTS to false and the list is ignored.
const ALLOW_EXTRA_ROOTS = true;
const EXTRA_ROOTS = [
  // 'C:/code/other-project',
].map((r) => norm(r).toLowerCase());

// ---------------------------------------------------------------------------
// Quote-aware splitting & tokenizing
// ---------------------------------------------------------------------------

/**
 * Split a command line into executable segments on unquoted ; | & and newlines,
 * and strip here-document BODIES.
 *
 * A here-doc body is data the shell hands to a program: writing `echo hi >
 * C:/x` inside one documents a command, it does not run it. Treating those lines
 * as segments blocked a perfectly legal write to a file inside the project
 * (review 2026-08-02).
 *
 * Redirection operators that CONTAIN a separator character (`>|`, `>&`, `&>`)
 * are kept whole: splitting them apart is how `>| C:/outside` used to slip
 * through as two harmless halves.
 *
 * A MULTI-LINE INLINE SCRIPT STAYS ONE ARGUMENT (2026-09-24). A `node -e "..."`
 * (or python -c, perl -e, ruby -e, deno eval) script written over several lines
 * used to be cut at every newline, so each script line was read as a shell
 * command: the `>` of a JavaScript arrow (`x=>x.name`) became a redirection, and
 * after a `cd` out of the folder it blocked a script that wrote nothing.
 *
 * The fix is deliberately narrow. The joining pass keeps a quoted string whole
 * across lines ONLY when it is the script argument of one of those non-shell
 * interpreters, where the inline-script checks in checkSegment read it. Any
 * other string that crosses a line, or a quote left open at the end, and the
 * whole command is read the old line-by-line way instead. A review found that
 * joining every multi-line string hid real writes from the guard (eval,
 * `bash -ce`, `iex`, heredocs, comments, here-strings), because the old reading
 * caught them only by cutting at newlines. Anything that is not a multi-line
 * interpreter script is read exactly as before.
 *
 * One more kind of string is kept whole since round two of the kit fix list
 * (2026-10-02, R8): text its program takes as data, such as a commit message,
 * a gh body or what echo prints (see takesDataText). Cut at newlines, a
 * message line like "Install now copies the plugin into ~/.claude/skills" was
 * read as a command and the commit refused. The same text given to eval,
 * `bash -c` or iex is still read line by line.
 *
 * Two more rules, read per shell (review 2026-09-25):
 *  - The escape character is the shell's own: a backslash in bash, a backtick
 *    in PowerShell. PowerShell does not treat a backslash as special, so
 *    "C:\Users\" is a closed string there. Read as an escape, its closing quote
 *    swallowed the `;` after it and hid the next command from the guard.
 *  - A line that ends in that escape character, outside quotes and outside a
 *    comment, continues on the next line. Both shells run the two lines as one
 *    command, so they are read as one: bash drops the backslash and the line
 *    break, PowerShell reads them as a space. Cut at the line break, a long
 *    download or copy split over two lines had its destination read as a
 *    command of its own, and the destination went unchecked.
 */
function splitSegments(command, shell = 'bash') {
  return splitJoiningInlineScripts(command, shell) ?? splitSegmentsByLine(command, shell);
}

/** Does an unquoted `#` at `i` start a comment? Only at the start of a word, in both shells. */
const opensComment = (line, i) => line[i] === '#' && (i === 0 || /[\s;&|(]/.test(line[i - 1]));

/** What a line continuation leaves in its place: nothing in bash, a space in PowerShell. */
const continuationGap = (shell) => (shell === 'powershell' ? ' ' : '');

/**
 * A here-document opener at `i` of `line`: `<<` or `<<-`, then a delimiter,
 * quoted or bare. Null for a `<<<` here-string, for a `<<` inside a comment,
 * and where no delimiter follows. A bare delimiter runs to the next space or
 * shell metacharacter, and a leading backslash quotes it, as in bash: `<<END.`
 * ends at a line reading END., and `<<\EOF` at EOF. Read as `<< "abc"`, a
 * here-string used to open a here-document nobody closes, so every line after
 * it went unread (review 2026-09-28).
 */
function heredocOpener(line, i, comment) {
  if (comment || line[i] !== '<' || line[i + 1] !== '<' || line[i + 2] === '<') return null;
  const m = /^<<(-?)\s*(?:"([^"]+)"|'([^']+)'|\\?([^\s;&|<>()"'`$]+))/.exec(line.slice(i));
  if (!m) return null;
  return { delim: m[2] || m[3] || m[4], stripTabs: m[1] === '-', len: m[0].length, lines: [], seg: null };
}

/**
 * The segments of a command, each with the here-document bodies its command
 * reads: `{ text, docs }`. A body is data to most programs, so it is never read
 * as commands here; analyze() reads it as a script when the program is an
 * interpreter or a shell (review 2026-09-28: `python3 - <<'EOF'` used to run
 * unread). A body opened on a line that pushed no segment belongs to nobody.
 *
 * Two more things ride along (kit fix list, 2026-10-02). `strings` are the
 * PowerShell here-strings written in the segment, each with the text that
 * stands in for it (see hereString), and the bodies of here-documents opened
 * inside a quoted `$( )` (see quotedStep). `prev` is the stage a `|` feeds
 * into this one, so a script piped into an interpreter, and the paths a
 * writer takes from its pipeline, can be read. push() is told what ended the
 * segment (`sep`); a `{ }` block keeps the pipeline of the command around it
 * apart, so in `Get-ChildItem x | Where-Object { ... } | Remove-Item` the
 * delete is fed by Where-Object, which Get-ChildItem feeds.
 */
function segmentList() {
  const segs = [];
  let unowned = [];
  let strings = [];
  let level = { last: null, piped: false };
  const levels = [];
  return {
    segs,
    push(text, sep) {
      if (text.trim()) {
        const seg = { text, docs: [], strings, prev: level.piped ? level.last : null };
        strings = [];
        segs.push(seg);
        for (const d of unowned) d.seg = seg;
        unowned = [];
        level.last = seg;
        level.piped = false;
      }
      if (sep === '|') level.piped = level.last !== null;
      else if (sep === '{') { levels.push(level); level = { last: null, piped: false }; }
      else if (sep === '}') level = levels.pop() ?? { last: null, piped: false };
      // A line that ends in `|` goes on in the next one, in both shells.
      else if (sep !== undefined && (text.trim() || sep !== '\n')) level = { last: null, piped: false };
    },
    open(doc) { unowned.push(doc); },
    close(doc) { if (doc.seg) doc.seg.docs.push(doc.lines.join('\n')); },
    string(s) { strings.push(s); },
  };
}

/**
 * A PowerShell here-string that opens at `i` of `line`: `@'` or `@"` with
 * nothing after it on the line. Its body runs to the line that starts with
 * `'@` or `"@`. Null when none opens here.
 */
function hereStringOpener(line, i) {
  if (line[i] !== '@' || (line[i + 1] !== "'" && line[i + 1] !== '"')) return null;
  if (line.slice(i + 2).trim() !== '') return null;
  return { close: `${line[i + 1]}@`, lines: [] };
}

/**
 * The text that stands in for a here-string in its segment: one single-quoted
 * PowerShell string holding the body, its own quotes doubled the way
 * PowerShell escapes them. So the body is one word of text, whatever quote
 * marks it holds (kit fix list, 2026-10-02, T9: an apostrophe in "It's" put
 * the reading of quotes out of step for every line after the block, and the
 * commands after a `;` on those lines ran unread).
 */
function hereString(hs) {
  const body = hs.lines.join('\n');
  return { body, placeholder: `'${body.replace(/'/g, "''")}'` };
}

/**
 * Where the bodies of the here-documents `docs` end, read one after another
 * from `from`, the start of the line after their opener: the index of the
 * line break after the last closing line, or the end of the text. Used for
 * one opened inside a quoted `$( )`, whose body is text inside that string.
 */
function heredocBodiesEnd(text, from, docs) {
  let at = from;
  for (const doc of docs) {
    for (;;) {
      const next = text.indexOf('\n', at);
      if (next < 0) return text.length;
      const line = text.slice(at, next);
      at = next + 1;
      if (closesDoc(doc, line)) break;
    }
  }
  return at - 1;
}

// A `{ }` block holds commands of its own, so its braces end the segment
// before them, the same way the delete guard beside this file reads them
// (review 2026-09-28: `ForEach-Object { Copy-Item $_ C:\... }` and
// `{ cp a /c/x; }` were read as one command named ForEach-Object or `{`, and
// the write inside was never checked).
//
// In PowerShell a `{` opens a block after a space, `(`, `)`, `;`, `|` or `&`,
// or glued to a bare word, `%`, `?`, `.` or a -Parameter (`try{`, `%{`,
// `-ScriptBlock{`). After `$` or `@`, or as `{}`, it is text: `${x}`, `@{...}`
// and `HEAD@{1}` stay whole. Every `{` is remembered, so a `}` ends the block
// its own `{` opened.
//
// In bash a `{` followed by a space opens a group only where a command can
// start: the start of a segment, after then, do, else, elif, if, while, until,
// time, coproc, `!` or `(`, after a word ending in `)` (a function header like
// `f()`, a case pattern like `dist)`), and after `function NAME` or
// `coproc NAME`. A `}` closes one only as the first word of a segment.
// Anywhere else a brace is part of the arguments: a literal word, or a brace
// list like `{src,lib}`, which tokenize expands.
const BASH_GROUP_AFTER = /^(then|do|else|elif|if|while|until|time|coproc|!|\(|[^\\()]*\)|[^\\?*+@!()$<>]*\(\))$/;
const PS_GLUED_BLOCK = /^([%?.]|[A-Za-z][\w-]*|-[A-Za-z][\w-]*)$/i;

/** Does the brace at `i` of `line` open or close a block? `braces` remembers PowerShell's open ones. */
function braceEndsSegment(line, i, cur, shell, braces) {
  const ch = line[i];
  const prev = i > 0 ? line[i - 1] : ' ';
  if (shell === 'bash') {
    const words = cur.trim().split(/\s+/);
    const atCommand = cur.trim() === '' || BASH_GROUP_AFTER.test(words[words.length - 1])
      || /^(function|coproc)$/.test(words[words.length - 2] ?? '');
    return (ch === '{' && atCommand && /\s/.test(line[i + 1] ?? '')) || (ch === '}' && cur.trim() === '');
  }
  if (shell !== 'powershell') return false;
  if (ch === '{') {
    const word = cur.match(/[^\s();|&]*$/)[0];
    const block = line[i + 1] !== '}' && (/[\s();|&]/.test(prev) || PS_GLUED_BLOCK.test(word));
    braces.push(block);
    return block;
  }
  return braces.length > 0 ? braces.pop() : /[\s;]/.test(prev);
}

/**
 * Does the quote about to open here start an inline interpreter's script? The
 * quote starts its own word after the script's switch, or is glued to the
 * switch (`--eval="`, `-c"`, `-e'`), which the interpreters read the same way.
 */
function opensInlineScript(before, shell) {
  const word = /\S*$/.exec(before)[0];
  const tokens = tokenize(before.slice(0, before.length - word.length), shell);
  const pi = programIndex(tokens, shell);
  if (pi < 0) return false;
  const prog = programName(tokens[pi]);
  const flag = INLINE_SCRIPT[prog];
  if (!flag) return false;
  if (word) return prog === 'node' ? /^--(?:eval|print)=$/.test(word) : flag.test(word);
  const last = tokens[tokens.length - 1];
  return tokens.length - 1 > pi && isWord(last) && flag.test(last.text);
}

// Programs that print every argument they are given, in each shell.
const PRINTS_TEXT = { bash: /^(echo|printf)$/, powershell: /^(echo|printf|write-host|write-output|write)$/ };
// Of those, the ones whose printed text can flow on into a pipeline.
const PRINTS_TO_PIPE = /^(echo|printf|write-output|write)$/;
// git's own options that take the next word as their value, before the subcommand.
const GIT_GLOBAL_VALUE = /^(-C|-c|--git-dir|--work-tree|--namespace|--config-env)$/;

/**
 * Does the quote about to open hold text the program takes as data, never as
 * commands (kit fix list round two, 2026-10-02, R8)? A git commit or tag
 * message (`-m`, `--message`), gh's `--title` and `--body`, anything echo,
 * printf, Write-Host or Write-Output prints, and the value of a PowerShell
 * `-Value` or `-Message`. The delete guard beside this file reads every
 * quoted word that way; read line by line here, a message line that began
 * with a command name and named a folder outside had the whole commit refused.
 *
 * `before` is the command up to the word the quote sits in, and `word` what
 * that word holds before the quote: a glued flag (`-m"`, `--body="`) or an
 * earlier quoted part of the same word. Kept narrow on purpose, since the
 * line reading catches text that is run later: text inside `$( )`, `<( )` or
 * backticks, text kept in a variable (`$m = Write-Output "..."`,
 * `printf -v m "..."`), and a quote this pass cannot read truly (one in a
 * comment, bash's `$'...'`, PowerShell's `<# #>`) are none of these. Returns
 * 'pipe' for a printer whose text could flow on into a pipeline, which the
 * caller watches for.
 */
function takesDataText(before, word, shell) {
  if (shell !== 'bash' && shell !== 'powershell') return false;
  const upTo = before + word;
  if (/\$\(|[<>]\(/.test(upTo)) return false;
  if (shell === 'bash' ? /`|\$'/.test(upTo) : upTo.includes('<#')) return false;
  const tokens = tokenize(before, shell);
  const pi = programIndex(tokens, shell);
  if (pi < 0) return false;
  if (shell === 'powershell' && tokens.slice(0, pi).some((t) => /^[-+*/]?=$/.test(t.text))) return false;
  const last = tokens.length - 1 > pi ? tokens[tokens.length - 1] : null;
  const prog = programName(tokens[pi]);
  const args = tokens.slice(pi + 1).filter((t) => !t.redirect);
  if (PRINTS_TEXT[shell].test(prog)) {
    if (prog === 'printf' && args.some((t) => /^-v/.test(t.text))) return false;
    return PRINTS_TO_PIPE.test(prog) ? 'pipe' : true;
  }
  const glued = /^[^'"]*/.exec(word)[0];
  const flag = glued.startsWith('-') ? glued.replace(/[=:]$/, '') : last && isWord(last) ? last.text : '';
  if (shell === 'powershell' && /^-(value|message)$/i.test(flag)) return true;
  if (prog === 'gh') return /^(--title|--body|-t|-b)$/.test(flag);
  if (prog !== 'git') return false;
  let sub = '';
  for (let k = 0; k < args.length && !sub; k++) {
    if (!args[k].text.startsWith('-')) sub = args[k].text;
    else if (GIT_GLOBAL_VALUE.test(args[k].text)) k++;
  }
  return /^(commit|tag)$/.test(sub) && /^(-[a-z]*m|--message)$/.test(flag);
}

/** The separator a `;`, `|` or `&` at `i` starts, as one: `||` and `&&` end a pipeline, `|&` goes on with it. */
function separatorAt(line, i) {
  const ch = line[i];
  if ((ch === '|' || ch === '&') && line[i + 1] === ch) return ch + ch;
  if (ch === '|' && line[i + 1] === '&') return '|&';
  return ch;
}

/**
 * One step inside a bash double-quoted string, for the `$( )` it holds.
 * `subs` is the stack of what is open there: c a command substitution, a an
 * arithmetic `$(( ))`, p a parenthesis. Returns how many characters the step
 * takes (0 for an ordinary character), and the here-document that a `<<`
 * inside a command substitution opens. In arithmetic `<<` is a shift.
 *
 * Kit fix list, 2026-10-02 (T9): the usual commit message,
 * `git commit -m "$(cat <<'EOF' ... EOF )"`, had its body read for quote
 * marks, so one stray `"` in the message hid every command after it. The
 * body is passed over as text only when the string is still open at the end
 * of the opener's line, the way that message is written; when it closes on
 * that line (`"$(cat <<EOF)"`), the lines after it are read as before.
 */
function quotedStep(line, i, subs) {
  const ch = line[i];
  if (ch === '$' && line[i + 1] === '(') {
    const arith = line[i + 2] === '(';
    subs.push(arith ? 'a' : 'c');
    return { take: arith ? 3 : 2 };
  }
  if (ch === '(' && subs.length > 0) { subs.push('p'); return { take: 1 }; }
  if (ch === ')' && subs.length > 0) return { take: subs.pop() === 'a' && line[i + 1] === ')' ? 2 : 1 };
  if (ch === '<' && subs.includes('c') && !subs.includes('a')) {
    const nl = line.indexOf('\n', i);
    const doc = heredocOpener(nl < 0 ? line : line.slice(0, nl), i, false);
    if (doc) return { take: doc.len, doc };
  }
  return { take: 0 };
}

/** Does this line close the here-document `doc`? */
const closesDoc = (doc, line) => (doc.stripTabs ? line.replace(/^\t+/, '') : line).trim() === doc.delim;

/**
 * The joining pass. Returns null (read the old way) unless every string that
 * crosses a line is an inline interpreter's script or text its program takes
 * as data (see takesDataText), and every quote closes. Escapes are read per
 * shell: backslash in bash, backtick in PowerShell, and PowerShell's
 * typographic quotes count as quotes, as they do in PowerShell.
 *
 * Two kinds of lines are text and are passed over whole (kit fix list,
 * 2026-10-02, T9): a PowerShell here-string's body, which becomes one quoted
 * word in its segment (see hereString), and the body of a here-document
 * opened inside a quoted `$( )`, which stays inside that string.
 *
 * Text that echo, printf or Write-Output printed over several lines is read
 * the old way once a `|` follows it anywhere in the command (round two, R8):
 * a shell or iex down that pipe runs each line, and the old reading is what
 * catches the ones that write outside. (A redirection into `>( )` is refused
 * on its own, as a file name built at run time.)
 */
function splitJoiningInlineScripts(command, shell) {
  const text = shell === 'powershell'
    ? String(command).replace(/[‘’‚‛]/g, "'").replace(/[“”„]/g, '"')
    : String(command);
  const esc = shell === 'bash' ? '\\' : shell === 'powershell' ? '`' : null;
  const list = segmentList();
  const braces = [];
  const queue = [];
  let cur = '';
  let wordStart = 0; // where the word being read starts in `cur`
  let q = null;
  let qInline = false;
  let qData = null; // does the open quote hold data text? null until a line ends inside it
  let qAt = 0; // where the open quote starts in `cur`
  let qWord = 0; // and where its word starts
  let printed = false; // printed text was joined, so a later `|` sends the command to the line reading
  let joined = false;
  let heredoc = null;
  let hs = null; // an open here-string
  const qsubs = []; // what is open inside the current double-quoted string
  const qdocs = []; // here-documents opened inside it on this line
  let qbody = null; // the one whose body is being passed over
  const lines = text.split(/\r?\n/);

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (heredoc) {
      const probe = heredoc.stripTabs ? line.replace(/^\t+/, '') : line;
      if (probe.trim() === heredoc.delim) { list.close(heredoc); heredoc = queue.shift() ?? null; }
      else heredoc.lines.push(probe);
      continue;
    }
    if (qbody) {
      cur += `${line}\n`;
      if (!closesDoc(qbody, line)) { qbody.lines.push(line); continue; }
      list.string({ body: qbody.lines.join('\n'), placeholder: null });
      qbody = qdocs.shift() ?? null;
      continue;
    }
    let from = 0;
    if (hs) {
      if (!line.startsWith(hs.close)) { hs.lines.push(line); continue; }
      const s = hereString(hs);
      cur += s.placeholder;
      list.string(s);
      hs = null;
      from = 2;
    }
    let comment = false;
    let continues = false;
    for (let i = from; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (q === '"' && esc && ch === esc) { cur += ch + (line[i + 1] ?? ''); i++; continue; }
        if (q === '"' && shell === 'bash') {
          const step = quotedStep(line, i, qsubs);
          if (step.take) {
            if (step.doc) qdocs.push(step.doc);
            cur += line.slice(i, i + step.take);
            i += step.take - 1;
            continue;
          }
        }
        if (ch === q) { q = null; qInline = false; qsubs.length = 0; qdocs.length = 0; }
        cur += ch;
        continue;
      }
      if (shell === 'powershell' && !comment) {
        const open = hereStringOpener(line, i);
        if (open) { hs = open; break; }
      }
      if (ch === "'" || ch === '"') {
        qInline = opensInlineScript(cur, shell);
        qData = comment ? false : null; // a quote mark in a comment is no quote
        qAt = cur.length;
        qWord = wordStart;
        q = ch;
        cur += ch;
        continue;
      }
      if (esc && ch === esc) {
        if (i === line.length - 1 && !comment) { continues = true; break; }
        cur += ch + (line[i + 1] ?? '');
        i++;
        continue;
      }
      if (opensComment(line, i)) comment = true;
      if (ch === '<' && line[i + 1] === '<' && line[i + 2] === '<') { cur += '<<<'; i += 2; continue; }
      const doc = heredocOpener(line, i, comment);
      if (doc) {
        list.open(doc);
        if (heredoc) queue.push(doc); else heredoc = doc;
        i += doc.len - 1;
        continue;
      }
      if (ch === '>' || (ch === '&' && line[i + 1] === '>')) {
        let op = '';
        if (ch === '&') { op = '&>'; i++; if (line[i + 1] === '>') { op = '&>>'; i++; } }
        else {
          op = '>';
          if (line[i + 1] === '>') { op = '>>'; i++; }
          else if (line[i + 1] === '|') { op = '>|'; i++; }
          else if (line[i + 1] === '&') { op = '>&'; i++; }
        }
        cur += op;
        continue;
      }
      if (!comment && (ch === '{' || ch === '}') && braceEndsSegment(line, i, cur, shell, braces)) {
        list.push(cur, ch);
        cur = '';
        wordStart = 0;
        continue;
      }
      if (ch === ';' || ch === '|' || ch === '&') {
        const sep = separatorAt(line, i);
        i += sep.length - 1;
        if (printed && (sep === '|' || sep === '|&')) return null;
        list.push(cur, sep === '|&' ? '|' : sep);
        cur = '';
        wordStart = 0;
        continue;
      }
      cur += ch;
      if (/\s/.test(ch)) wordStart = cur.length;
    }
    if (hs) continue; // a here-string opened on this line holds the segment open
    if (qdocs.length > 0) { qbody = qdocs.shift(); cur += '\n'; continue; }
    if (q) {
      if (!qInline) {
        if (qData === null) qData = takesDataText(cur.slice(0, qWord), cur.slice(qWord, qAt), shell);
        if (!qData) return null; // a multi-line string that is neither an interpreter script nor data
        if (qData === 'pipe') printed = true;
      }
      cur += '\n';
      joined = true;
      continue;
    }
    if (continues) {
      cur += continuationGap(shell);
      if (/\s$/.test(cur)) wordStart = cur.length;
      continue;
    }
    list.push(cur, '\n');
    cur = '';
    wordStart = 0;
  }
  if (q || !joined || heredoc || hs || qbody) return null;
  list.push(cur, '\n');
  return list.segs;
}

/**
 * The original reading: every line is a fresh command, unless it ends in a
 * line continuation (see splitSegments). The escape character is the shell's
 * own; 'other' (cmd) keeps the backslash it always had. A here-string's body
 * and a here-document inside a quoted `$( )` are text here too (see
 * splitJoiningInlineScripts).
 */
function splitSegmentsByLine(command, shell = 'bash') {
  const esc = shell === 'powershell' ? '`' : '\\';
  const list = segmentList();
  const braces = [];
  const queue = [];
  let cur = '';
  let q = null;
  let heredoc = null;
  let hs = null;
  const qsubs = [];
  const qdocs = [];
  let qbody = null;
  const lines = String(command).split(/\r?\n/);

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (heredoc) {
      const probe = heredoc.stripTabs ? line.replace(/^\t+/, '') : line;
      if (probe.trim() === heredoc.delim) { list.close(heredoc); heredoc = queue.shift() ?? null; }
      else heredoc.lines.push(probe);
      continue; // body is data, never a command; analyze() reads it as a script where it is one
    }
    if (qbody) {
      cur += `${line}\n`;
      if (!closesDoc(qbody, line)) { qbody.lines.push(line); continue; }
      list.string({ body: qbody.lines.join('\n'), placeholder: null });
      qbody = qdocs.shift() ?? null;
      continue;
    }
    let from = 0;
    if (hs) {
      if (!line.startsWith(hs.close)) { hs.lines.push(line); continue; }
      const s = hereString(hs);
      cur += s.placeholder;
      list.string(s);
      hs = null;
      from = 2;
    }
    let comment = false;
    let continues = false;
    for (let i = from; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (q === '"' && ch === esc) { cur += ch + (line[i + 1] ?? ''); i++; continue; }
        if (q === '"' && shell === 'bash') {
          const step = quotedStep(line, i, qsubs);
          if (step.take) {
            if (step.doc) qdocs.push(step.doc);
            cur += line.slice(i, i + step.take);
            i += step.take - 1;
            continue;
          }
        }
        if (ch === q) { q = null; qsubs.length = 0; qdocs.length = 0; }
        cur += ch;
        continue;
      }
      if (shell === 'powershell' && !comment) {
        const open = hereStringOpener(line, i);
        if (open) { hs = open; break; }
      }
      if (ch === "'" || ch === '"') { q = ch; cur += ch; continue; }
      if (ch === esc) {
        if (i === line.length - 1 && !comment && shell !== 'other') { continues = true; break; }
        cur += ch + (line[i + 1] ?? '');
        i++;
        continue;
      }
      if (opensComment(line, i)) comment = true;
      if (ch === '<' && line[i + 1] === '<' && line[i + 2] === '<') { cur += '<<<'; i += 2; continue; }
      const doc = heredocOpener(line, i, comment);
      if (doc) {
        list.open(doc);
        if (heredoc) queue.push(doc); else heredoc = doc;
        i += doc.len - 1;
        continue;
      }
      // Keep multi-character redirection operators intact.
      if (ch === '>' || (ch === '&' && line[i + 1] === '>')) {
        let op = '';
        if (ch === '&') { op = '&>'; i++; if (line[i + 1] === '>') { op = '&>>'; i++; } }
        else {
          op = '>';
          if (line[i + 1] === '>') { op = '>>'; i++; }
          else if (line[i + 1] === '|') { op = '>|'; i++; }
          else if (line[i + 1] === '&') { op = '>&'; i++; }
        }
        cur += op;
        continue;
      }
      if (!comment && (ch === '{' || ch === '}') && braceEndsSegment(line, i, cur, shell, braces)) {
        list.push(cur, ch);
        cur = '';
        continue;
      }
      if (ch === ';' || ch === '|' || ch === '&') {
        const sep = separatorAt(line, i);
        i += sep.length - 1;
        list.push(cur, sep === '|&' ? '|' : sep);
        cur = '';
        continue;
      }
      cur += ch;
    }
    if (hs) continue;
    if (qdocs.length > 0) { qbody = qdocs.shift(); cur += '\n'; continue; }
    if (continues) { cur += continuationGap(shell); continue; }
    list.push(cur, '\n');
    cur = '';
  }
  // A here-string nothing closes is text to the end.
  if (hs) {
    const s = hereString(hs);
    cur += s.placeholder;
    list.string(s);
  }
  list.push(cur, '\n');
  return list.segs;
}
/**
 * Tokenize one segment; a redirection operator becomes its own marked token.
 *
 * Two more things happen here (review 2026-09-25):
 *  - In bash, a word holding an unquoted brace list becomes every word the
 *    shell makes of it: `touch {a,/c/x}.txt` touches `a.txt` AND `/c/x.txt`,
 *    so each is judged on its own (see braceWords). The word after a
 *    redirection stays one token and carries the words in `alts`.
 *  - An unquoted `)` that closes nothing opened in its word closes a subshell,
 *    a `$( )` or a PowerShell group begun earlier, so it ends the file name a
 *    redirection writes to: `x=$(git rev-parse HEAD 2>/dev/null)` writes to
 *    /dev/null, not to a file called "/dev/null)".
 */
function tokenize(segment, shell) {
  const bashEscapes = shell === 'bash';
  const tokens = [];
  let cur = '';
  let lit = []; // per character of cur: 0 as typed, 1 quoted, 2 backslash-escaped
  let depth = 0; // unquoted ( still open in this word
  let cut = -1; // where the first unquoted ) that closes nothing in this word sits
  let has = false;
  let q = null;
  const subs = []; // what is open inside a double-quoted string (see quotedStep)
  const docs = []; // here-documents opened inside it on the current line
  const add = (s, how = 0) => {
    cur += s;
    lit.push(how);
    has = true;
  };
  const push = () => {
    if (has) {
      const prev = tokens[tokens.length - 1];
      if (prev && prev.redirect) {
        const end = cut < 0 ? cur.length : cut;
        const text = cur.slice(0, end);
        tokens.push({ text: cur, alts: bashEscapes ? braceWords(text, lit.slice(0, end)) : [text] });
      } else {
        const words = bashEscapes && cur.includes('{') ? braceWords(cur, lit) : [cur];
        // `lit` rides along so a PowerShell comma list is split only at its
        // unquoted commas (psList).
        if (words.length === 1 && words[0] === cur) tokens.push({ text: cur, lit });
        else for (const w of words) tokens.push({ text: w });
      }
    }
    cur = '';
    lit = [];
    depth = 0;
    cut = -1;
    has = false;
  };
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (q) {
      if (q === '"' && ch === '\\' && bashEscapes) {
        // Inside double quotes bash drops the backslash only before $ ` " \ and
        // a newline; anywhere else it stays, so "J:\Projects\x" keeps its
        // backslashes (2026-09-24: dropping them turned a `cd` into the project
        // into an unknown folder).
        const n = segment[i + 1];
        if (n !== undefined && '$`"\\\n'.includes(n)) { add(n, 1); i++; continue; }
        add(ch, 1);
        continue;
      }
      // PowerShell writes a quote inside a single-quoted string as two.
      if (q === "'" && shell === 'powershell' && ch === "'" && segment[i + 1] === "'") { add("'", 1); i++; continue; }
      // A here-document opened inside a quoted `$( )` is text from the end
      // of its line to its closing line, whatever quote marks it holds.
      if (q === '"' && bashEscapes) {
        const step = quotedStep(segment, i, subs);
        if (step.take) {
          if (step.doc) docs.push(step.doc);
          for (let k = i; k < i + step.take; k++) add(segment[k], 1);
          i += step.take - 1;
          continue;
        }
        if (ch === '\n' && docs.length > 0) {
          const stop = heredocBodiesEnd(segment, i + 1, docs.splice(0));
          for (let k = i; k < stop; k++) add(segment[k], 1);
          i = stop - 1;
          continue;
        }
      }
      if (ch === q) { q = null; subs.length = 0; docs.length = 0; continue; }
      add(ch, 1);
      continue;
    }
    if (ch === "'" || ch === '"') { q = ch; has = true; continue; }
    if (ch === '\\' && bashEscapes) {
      const n = segment[i + 1];
      // A backslash-escaped space is part of the path, not a separator.
      if (n !== undefined) { add(n, 2); i++; }
      continue;
    }
    if (ch === '(') { add(ch); depth++; continue; }
    if (ch === ')') {
      if (depth > 0) depth--;
      else if (cut < 0) cut = cur.length;
      add(ch);
      continue;
    }
    if (ch === '>' || (ch === '&' && segment[i + 1] === '>')) {
      push();
      let op;
      if (ch === '&') {
        op = '&>'; i++;
        if (segment[i + 1] === '>') { op = '&>>'; i++; }
      } else {
        op = '>';
        if (segment[i + 1] === '>') { op = '>>'; i++; }
        else if (segment[i + 1] === '|') { op = '>|'; i++; }
        else if (segment[i + 1] === '&') { op = '>&'; i++; }
      }
      tokens.push({ text: op, redirect: true });
      continue;
    }
    if (/\s/.test(ch)) { push(); continue; }
    // An unquoted `#` that starts a word opens a comment, and the rest of the
    // segment is text. Read as words, `cp a.txt /c/x # note` took `note` for
    // the copy's destination (review 2026-09-28). cmd has no comments.
    if (ch === '#' && !has && shell !== 'other' && (i === 0 || /\s/.test(segment[i - 1]))) break;
    // A leading file-descriptor digit belongs to the operator, not to a word.
    if (/\d/.test(ch) && cur === '' && segment[i + 1] === '>') continue;
    add(ch);
  }
  push();
  return tokens;
}

// A brace list with more words than this is not spelled out; the word is then
// unprovable, like a path built from a variable.
const BRACE_CAP = 1024;
const UNPROVABLE = '\u0000';
const TOO_MANY = new Error('brace list too long');

/**
 * Every word bash makes of one word by brace expansion (review 2026-09-25).
 *
 * `touch {a,/c/x}.txt` touches a.txt and /c/x.txt, and `cp a.txt {.tmp,/c/x}`
 * copies into /c/x. Read as one path, the word was joined under the project
 * and judged inside. This follows bash's own rules, so a quoted or escaped
 * brace (`lit`, from tokenize) stays literal, `${...}` and `$( )` are left
 * alone, `{a}` and `{}` are not lists, `{1..3}` and `{a..c}` are sequences, and
 * an empty word is dropped. A list longer than BRACE_CAP, or one too deeply
 * nested to read, comes back as one word marked UNPROVABLE.
 */
function braceWords(text, lit) {
  if (!text.includes('{')) return text === '' ? [] : [text];
  try {
    return expandBraces(text, lit).filter((w) => w !== '');
  } catch {
    return [UNPROVABLE + text];
  }
}

/** One step of bash's brace expansion: the first list in `text`, then the rest of the word. */
function expandBraces(text, lit) {
  let open = -1;
  let close = -1;
  for (let from = 0; ;) {
    const o = braceScan(text, lit, from, '{');
    if (o < 0) break;
    const c = braceScan(text, lit, o + 1, '}');
    if (c >= 0) { open = o; close = c; break; }
    from = o + 1;
  }
  if (open < 0) return [text];
  const amble = text.slice(open + 1, close);
  const ambleLit = lit.slice(open + 1, close);
  let middle;
  if (ambleLit.some((how, j) => how !== 2 && amble[j] === ',')) {
    middle = [];
    for (let start = 0; ;) {
      const comma = braceScan(amble, ambleLit, start, ',');
      const end = comma < 0 ? amble.length : comma;
      middle.push(...expandBraces(amble.slice(start, end), ambleLit.slice(start, end)));
      if (middle.length > BRACE_CAP) throw TOO_MANY;
      if (comma < 0) break;
      start = comma + 1;
    }
  } else {
    middle = braceSequence(amble, ambleLit);
    if (!middle) {
      if (close + 1 >= text.length) return [text];
      middle = [text.slice(open, close + 1)];
    }
  }
  const pre = text.slice(0, open);
  const post = close + 1 < text.length ? expandBraces(text.slice(close + 1), lit.slice(close + 1)) : [''];
  const out = [];
  for (const m of middle) {
    for (const p of post) {
      out.push(pre + m + p);
      if (out.length > BRACE_CAP) throw TOO_MANY;
    }
  }
  return out;
}

/**
 * Where the next unquoted `satisfy` at the top level sits, from `i`, the way
 * bash's brace_gobbler finds it; -1 when there is none. A `}` only closes a
 * list once a comma or a `..` has been seen at its level.
 */
function braceScan(text, lit, i, satisfy) {
  let level = 0;
  let commas = satisfy === '}' ? 0 : 1;
  for (; i < text.length; i++) {
    if (lit[i]) continue;
    const c = text[i];
    const next = lit[i + 1] ? '' : text[i + 1];
    if (c === '$' && next === '{') { level++; i++; continue; }
    if ((c === '$' || c === '<') && next === '(') {
      // A `$( )` is passed over whole.
      let d = 0;
      for (i++; i < text.length; i++) {
        if (lit[i]) continue;
        if (text[i] === '(') d++;
        else if (text[i] === ')' && --d === 0) break;
      }
      continue;
    }
    if (c === satisfy && level === 0 && commas > 0) {
      // A `{` alone, or `{}` at the start of the word, is not a list.
      if (c === '{' && i === 0 && (i + 1 === text.length || next === '}')) continue;
      return i;
    }
    if (c === '{') level++;
    else if (c === '}' && level > 0) level--;
    else if (satisfy === '}' && level === 0 && (c === ',' || (c === '.' && next === '.' && text[i + 2] !== '}'))) commas++;
  }
  return -1;
}

/** `{1..9}`, `{a..e}` and `{1..9..2}`, as bash spells them out; null when `amble` is not one. */
function braceSequence(amble, ambleLit) {
  if (ambleLit.some(Boolean)) return null;
  const num = /^([+-]?\d+)\.\.([+-]?\d+)(?:\.\.([+-]?\d+))?$/.exec(amble);
  const chr = num ? null : /^([A-Za-z])\.\.([A-Za-z])(?:\.\.([+-]?\d+))?$/.exec(amble);
  const m = num || chr;
  if (!m) return null;
  const from = num ? Number(m[1]) : m[1].charCodeAt(0);
  const to = num ? Number(m[2]) : m[2].charCodeAt(0);
  const step = Math.abs(Number(m[3] ?? 1)) || 1;
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to)) return null;
  if (Math.floor(Math.abs(to - from) / step) + 1 > BRACE_CAP) throw TOO_MANY;
  const pad = num && [m[1], m[2]].some((s) => /^[+-]?0\d/.test(s)) ? Math.max(m[1].length, m[2].length) : 0;
  const out = [];
  for (let n = from; from <= to ? n <= to : n >= to; n += from <= to ? step : -step) {
    if (!num) out.push(String.fromCharCode(n));
    else if (pad) out.push((n < 0 ? '-' : '') + String(Math.abs(n)).padStart(pad - (n < 0 ? 1 : 0), '0'));
    else out.push(String(n));
  }
  return out;
}

/** Can this token act as a flag or a subcommand? Never used on path arguments. */
const isWord = (t) => t.text.length > 0 && !/\s/.test(t.text);

/**
 * Flag test, per shell. Under bash a leading `/` opens an ABSOLUTE PATH; only
 * cmd-style shells use `/X` switches, and those are one to three letters. This
 * single character is what the first cut got wrong.
 */
const isFlag = (t, shell) =>
  shell === 'bash' ? /^-/.test(t.text) : /^-/.test(t.text) || /^\/[A-Za-z?]{1,3}$/.test(t.text);

/**
 * Path-argument candidates: everything that is not a flag or an operator, and
 * not the word right after a redirection. That word is where the redirection
 * points (`2>&1`, `> log.txt`), and step 1 of checkSegment checks it on its
 * own. Read as a positional, the `1` of a trailing `2>&1` became the LAST
 * argument, so cp, mv, rsync and git clone took it for their destination and
 * never looked at the real one (review 2026-09-25).
 */
const positionals = (tokens, shell) =>
  tokens.filter((t, i) => !t.redirect && !(i > 0 && tokens[i - 1].redirect) && t.text.length > 0 && !isFlag(t, shell));

// ---------------------------------------------------------------------------
// Where the project is, and whether a path is inside it
// ---------------------------------------------------------------------------

/**
 * The folder writes must stay inside.
 *
 * Read from the session first, not from this script's own location, so the
 * permitted area is the project that is OPEN, whatever folder this file sits in.
 */
function projectRoot(payload) {
  for (const c of [process.env.CLAUDE_PROJECT_DIR, payload && payload.cwd, SCRIPT_ROOT]) {
    if (typeof c === 'string' && c.trim()) return norm(kitRootAbove(c) ?? c);
  }
  return norm(SCRIPT_ROOT);
}

// The kit's marker, in both spellings: a project installed before the kit's
// files were renamed carries the lowercase one.
const MARKERS = ['Hooks-settings.json', 'hooks-settings.json'];

/**
 * The nearest folder at or above `start` that carries the kit's marker, or
 * null. On macOS and Linux a session opened in a subfolder names that
 * subfolder as CLAUDE_PROJECT_DIR while loading the project's own settings,
 * so the guard ran there with the subfolder as the whole project and refused
 * the project's own files (review 2026-09-28). The plugin finds the root the
 * same way. Never throws: a folder that is not on disk finds nothing.
 */
function kitRootAbove(start) {
  try {
    let dir = path.resolve(String(start));
    for (let i = 0; i < 64; i++) {
      if (MARKERS.some((m) => fs.existsSync(path.join(dir, 'project-os', m)))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  } catch {
    // fall through: the raw value stands
  }
  return null;
}

/** Discard sinks, which are not files in any of the three shells. */
const SINKS = new Set(['-', '/dev/null', '/dev/stdout', '/dev/stderr', '$null', 'nul', 'con']);

/**
 * Resolve a STATIC path against `root`. Returns { dynamic: true } when the path
 * cannot be proven, { full } otherwise (lower-cased for comparison).
 *
 * Handles the MSYS spelling Git Bash produces: `/c/Users/...` is `C:/Users/...`,
 * and `/c/code/project/...` is the project itself. Without this the guard
 * both missed real escapes and refused the project's own path.
 */
function resolveStatic(target, root) {
  // A word that starts with `(`, `$(` or `@(` is an expression, never a path:
  // `-Path (Join-Path $env:USERPROFILE x)` used to read as a file called
  // "(Join-Path" inside the project (review 2026-09-28).
  if (/[$`\u0000]|%[^%\s]*%|^~|\$\(|\{\{|^@?\(/.test(target)) return { dynamic: true };
  let raw = norm(target);

  // `C:file` is relative to that DRIVE's current directory, which is per-process
  // state this guard cannot see. Unprovable by construction.
  if (/^[A-Za-z]:(?![/])./.test(raw)) return { dynamic: true };

  // On a Windows root, Git Bash spells drives as `/c/...`; fold that back to
  // `C:/...`. On a POSIX root, `/c/...` is an ordinary folder and stays as is.
  const rootHasDrive = /^[A-Za-z]:/.test(root);
  const msys = rootHasDrive ? raw.match(/^\/([A-Za-z])(?=\/|$)(.*)$/) : null;
  if (msys) raw = `${msys[1]}:${msys[2] || '/'}`;

  const hasDrive = /^[A-Za-z]:/.test(raw);
  const posixAbs = !hasDrive && raw.startsWith('/');
  // On a Windows root a drive-less absolute path is the MSYS install root
  // (/tmp, /etc, /usr ...) and can never be inside the project. On a POSIX root
  // it is simply an absolute path, and is resolved like any other.
  if (posixAbs && rootHasDrive) return { full: '\u0000msys' + raw.toLowerCase() };

  const joined = (hasDrive || posixAbs) ? raw : root + '/' + raw;
  const drive = (joined.match(/^[A-Za-z]:/) || [''])[0];
  const body = drive ? joined.slice(2) : joined;
  const out = [];
  for (const part of body.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length === 0) return { dynamic: true }; // escapes its own root
      out.pop();
      continue;
    }
    out.push(part);
  }
  return { full: (drive + '/' + out.join('/')).toLowerCase() };
}

/**
 * Claude's own memory folder, the one allowed exception: a markdown file
 * directly in ~/.claude/projects/<project>/memory/. Any folder called "memory"
 * elsewhere under ~/.claude (skills, rules, commands, agents) used to match,
 * and those load into every session on the machine (review 2026-09-25).
 */
function isMemoryFile(full) {
  if (!ALLOW_CLAUDE_MEMORY || !HOME) return false;
  const base = HOME + '/.claude/projects/';
  return full.startsWith(base) && /^[^/]+\/memory\/[^/]+\.md$/.test(full.slice(base.length));
}

/** Is `full` inside `root` (or root itself)? Both must already be lowercased. */
const inside = (full, root) => full === root || full.startsWith(root + '/');

/**
 * A folder in EXTRA_ROOTS, the second allowed exception. Both ends are checked:
 * the write must LAND in an approved folder, and the session must be in the
 * project or in one of them. Agent config and env files are refused even there.
 */
function isExtraRoot(full, rootKey) {
  if (!ALLOW_EXTRA_ROOTS || EXTRA_ROOTS.length === 0) return false;
  if (!EXTRA_ROOTS.some((r) => inside(full, r))) return false;
  if (full.includes('/.claude/') || full.includes('/.codex/')) return false;
  if (/(^|\/)\.env(\.|$)/.test(full)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Rename loops over literal names (kit fix list, 2026-10-02, T8)
// ---------------------------------------------------------------------------
//
// Once the guard read the command after `do`, the everyday rename loop,
// `for f in *.jpeg; do mv "$f" "${f%.jpeg}.jpg"; done`, would have been refused
// as a path built at run time. The owner's call: a target built from a loop
// variable counts as inside when the loop's list is literal relative names or
// globs (no `..`, no absolute path, no variable), the target keeps it
// relative with no `..` and no leading slash, and the working folder is inside
// the project. Everything else built at run time is refused as before.

// The loop variables of the bash command being read that hold only safe
// values (see loopRules), or null. Set by analyze() around checkSegment, and
// cleared while a script is read: a `$f` in a script is the script's own.
let LOOP_VARS = null;

/**
 * Can a loop over this list word only ever give a relative name with no `..`
 * in it? A literal or a glob, relative, with no `..`, no variable, no `~`, and
 * no part that is or can match a name of dots only (`.*` matches `..`). Its
 * last part must hold something other than dots, so the value never ends in
 * `.` and a `.` written after it cannot make `..`.
 */
function safeLoopWord(w) {
  if (!w || /[$`\u0000\\~]/.test(w) || w.includes('..') || /^(?:\/|[A-Za-z]:)/.test(w)) return false;
  if (/[@!+*?]\(/.test(w)) return false; // an extended glob
  const parts = w.split('/').filter((p) => p !== '');
  while (parts.length > 1 && parts[0] === '.') parts.shift();
  if (parts.length === 0) return false;
  for (const p of parts) {
    if (!/[*?[]/.test(p)) continue;
    const plain = p.replace(/\[[^\]]*\]/g, '').replace(/[*?]/g, '');
    if (!/[^.]/.test(plain)) return false;
  }
  return /[^.]/.test(parts[parts.length - 1]);
}

/**
 * Which loop variables of a bash command hold only safe values: name -> true
 * when every `for` or `select` over it walks a list of safe words
 * (safeLoopWord) and nothing else in the command gives it a value (an
 * assignment, `read`, `local`, `${f:=x}`, arithmetic). A loop can run its
 * body again after a later line changed the variable, so one other binding
 * anywhere makes it unsafe everywhere.
 */
function loopRules(command) {
  const rules = new Map();
  for (const m of command.matchAll(/(?:^|[;&|\n({\s])(?:for|select)\s+([A-Za-z_]\w*)(?:\s+in\b([^;&|\n]*))?/g)) {
    const words = m[2] === undefined ? [] : tokenize(m[2], 'bash').filter((t) => !t.redirect).map((t) => t.text);
    rules.set(m[1], (rules.get(m[1]) ?? true) && words.length > 0 && words.every(safeLoopWord));
  }
  for (const [name, ok] of rules) {
    if (!ok) continue;
    const bound = new RegExp(`(?<![\\w$-])(?<!\\$\\{)${name}(?:\\[[^\\]]*\\])?\\s*(?:[-+*/%&|^]?=(?!=)|\\+\\+|--)`
      + `|\\$\\{${name}:?=`
      + `|(?:^|[;&|\\n({\\s])(?:read|getopts|mapfile|readarray|declare|typeset|local|export|readonly|unset|let|printf)\\b[^;&|\\n]*?(?<![\\w$-])(?<!\\$\\{)${name}\\b`);
    if (bound.test(command)) rules.set(name, false);
  }
  return rules;
}

/**
 * A write target built from safe loop variables, as a path that stands for
 * every value it can take, or null when it is not one. Each `$f`, `${f}`,
 * `${f%pattern}` or `${f%%pattern}` becomes one plain name; the rest of the
 * target must be literal, relative and free of `..`. A `${f%...}` can be cut
 * down to nothing or to `.`, so it may not begin the target before a `/`,
 * nor be followed by `.` and then a dot or a slash; and no value may follow a
 * part made of dots only, where it could close a `..`.
 */
function loopValue(target) {
  if (!LOOP_VARS || LOOP_VARS.size === 0 || !target.includes('$')) return null;
  if (target.includes('..') || /^(?:[\\/~]|[A-Za-z]:)|[`\u0000]/.test(target)) return null;
  let out = '';
  let part = ''; // the literal part being written since the last slash
  let cut = false; // the last thing written was a value that can be cut short
  for (let i = 0; i < target.length;) {
    if (target[i] !== '$') {
      if (cut && target[i] === '.' && !/^\.[^./\\$]/.test(target.slice(i))) return null;
      cut = false;
      part = /[\\/]/.test(target[i]) ? '' : part + target[i];
      out += target[i];
      i++;
      continue;
    }
    const m = /^\$(?:([A-Za-z_]\w*)|\{([A-Za-z_]\w*)(?:(%%?)([^}$`'"]*))?\})/.exec(target.slice(i));
    if (!m || !LOOP_VARS.has(m[1] ?? m[2])) return null;
    if (cut || (part !== '' && /^\.+$/.test(part))) return null;
    i += m[0].length;
    cut = Boolean(m[3]);
    if (cut && out === '' && /^[\\/]/.test(target.slice(i))) return null;
    out += 'loopvalue';
    part = 'loopvalue';
  }
  return out;
}

/**
 * Verdict for one write target: null = fine, string = the reason to refuse.
 *
 * `root` is the project: the only place a write may land, and it never moves.
 * `base` is the directory a RELATIVE path resolves against, which a `cd` earlier
 * in the same command does move. Keeping them apart is the whole point: the
 * first cut used one value for both, so `cd C:/Users/User && echo x > y.txt`
 * moved the permitted area along with the working directory and allowed itself
 * (review 2026-08-02).
 */
function checkTarget(target, root, what, base = root) {
  if (!target) return null;
  if (SINKS.has(target.toLowerCase())) return null;
  const rootKey = root.toLowerCase();
  const r = resolveStatic(loopValue(target) ?? target, base.toLowerCase());
  if (r.dynamic) {
    return `${what} writes to "${target.replace(/\u0000/g, '')}", a path built at runtime, so it cannot be proven to be inside the project folder. Use a literal path under the project, or the Write tool`;
  }
  if (inside(r.full, rootKey)) return null;
  if (isMemoryFile(r.full)) return null;
  if (isExtraRoot(r.full, rootKey)) return null;
  return `${what} writes to "${target}", which is outside the project folder (${root})`;
}

// ---------------------------------------------------------------------------
// Which commands write, and where their targets are
// ---------------------------------------------------------------------------

// Every trailing positional is a destination. A delete counts as a write
// (review 2026-09-25): `rm` of a file outside the folder was allowed while the
// same delete written as an inline script was refused.
const BASH_WRITE_ALL = new Set(['tee', 'touch', 'mkdir', 'truncate', 'split', 'rm', 'rmdir', 'unlink', 'shred']);
// The LAST positional is the destination; earlier ones are sources, which cp,
// install and rsync only read. A move's source is not checked either: moving
// a file INTO the project from another folder is allowed, the owner's choice
// (2026-09-26).
const BASH_WRITE_LAST = new Set(['cp', 'mv', 'install', 'rsync']);
// tar in create, append or update mode writes the archive named by -f.
const TAR_FILE_FLAG = { letters: 'f', stops: 'CTXbgILKNF', long: ['file'] };
// sort -o writes its output file.
const SORT_OUTPUT_FLAG = { letters: 'o', stops: 'kStT', long: ['output'] };
// scp's other end: `host:path` or `user@host:path`, never a drive letter.
const REMOTE_PATH = /^(?:[^@/\\:\s]+@)?[^@/\\:\s]{2,}:/;
// Flag-valued destinations, read in every spelling the tools accept (review
// 2026-09-25): `--name=V`, `--name V`, and a single-dash cluster holding one of
// the `letters`, whose value is the rest of the word or, when the letter comes
// last, the next word (`-oPATH`, `-sSLo PATH`, `-qO PATH`, `-CPATH`). A letter
// in `stops` takes a value of its own, so the rest of the word is that value
// and the cluster ends there: `-HAuthorization:x` is a header, not a file.
const BASH_FLAG_TARGETS = {
  curl: { letters: 'o', stops: 'AbcCdDeEFHKmPQrtTuUwxXyYz', long: ['output', 'output-dir'] },
  wget: { letters: 'OP', stops: 'aoiBetTwQlARDXIU', long: ['output-document', 'directory-prefix'] },
  tar: { letters: 'C', stops: 'fTXbHVgILKNF', long: ['directory'] },
  unzip: { letters: 'd', stops: 'xP', long: [] },
};
// cp, mv and install name their destination folder first with -t.
const TARGET_DIR_FLAG = { letters: 't', stops: 'Smog', long: ['target-directory'] };
// Programs that carry a whole script in an argument. The script is scanned as
// text, since a real parse is out of reach. The switch can sit in a cluster
// with others that take no value (kit fix list, 2026-10-02, T1: `node -pe`
// and `python -Bc` ran unread): python's `-Bc`, perl's `-lne`, ruby's `-ne`.
// A letter that takes a value of its own (python -W, perl -i, ruby -r) ends
// a cluster, so it is left out: perl's `-pie` is -p with -i given "e".
const PY_SCRIPT = /^-[bBdEhiIOPqRsSuvx]*c$/;
const INLINE_SCRIPT = { node: /^(-e|--eval|-p|--print|-pe)$/, python: PY_SCRIPT, python3: PY_SCRIPT, py: PY_SCRIPT, perl: /^-[aclnpsStTuUwWX0-9]*[eE]$/, ruby: /^-[acdlnpsSvwWy0-9]*e$/, deno: /^eval$/ };
// The same switches with the script glued on: node's `--eval=...`, and the
// rest of a python, perl or ruby cluster after its script letter, which each
// of them reads as the script (`-c"..."`, `-e'...'`).
const INLINE_GLUED = {
  node: /^--(?:eval|print)=([\s\S]*)$/,
  python: /^-[bBdEhiIOPqRsSuvx]*c([\s\S]+)$/,
  perl: /^-[aclnpsStTuUwWX0-9]*[eE]([\s\S]+)$/,
  ruby: /^-[acdlnpsSvwWy0-9]*e([\s\S]+)$/,
};
INLINE_GLUED.python3 = INLINE_GLUED.python;
INLINE_GLUED.py = INLINE_GLUED.python;

/**
 * The scripts a command line hands to an inline interpreter `prog`, read from
 * the words after it: [{ body, after }], `after` being the index of the last
 * word the script used. Empty when there is none.
 */
function inlineScripts(prog, rest) {
  const flag = INLINE_SCRIPT[prog];
  const glued = INLINE_GLUED[prog];
  const out = [];
  if (!flag) return out;
  for (let k = 0; k < rest.length; k++) {
    const t = rest[k];
    if (t.redirect || (k > 0 && rest[k - 1].redirect)) continue;
    if (isWord(t) && flag.test(t.text)) {
      if (rest[k + 1] && !rest[k + 1].redirect) out.push({ body: rest[k + 1].text, after: k + 1 });
      continue;
    }
    const g = glued && !(t.lit && t.lit[0]) ? glued.exec(t.text) : null;
    if (g) out.push({ body: g[1], after: k });
  }
  return out;
}

// PowerShell. Aliases included: `cp`/`mv`/`rni` really are Copy/Move/Rename-Item.
// `mkdir` and `md` make folders, from PowerShell and from `cmd /c` alike, and
// the delete cmdlets and their aliases count as writes (review 2026-09-25).
const PS_WRITE_FIRST = new Set([
  'out-file', 'set-content', 'add-content', 'new-item', 'export-csv', 'export-clixml',
  'start-transcript', 'tee-object', 'sc', 'ac', 'ni', 'epcsv', 'tee',
  'compress-archive', 'expand-archive', 'invoke-webrequest', 'iwr', 'curl', 'wget',
  'invoke-restmethod', 'irm', 'mkdir', 'md',
  'remove-item', 'ri', 'rm', 'del', 'erase', 'rd', 'rmdir', 'clear-content', 'clc',
]);
const PS_WRITE_LAST = new Set(['copy-item', 'move-item', 'rename-item', 'cpi', 'copy', 'cp', 'mi', 'move', 'mv', 'rni', 'ren', 'rename']);
// A rename lands beside the item it renames, so a bare new name is resolved
// against the item's own folder, not the current one (review 2026-09-28:
// `Rename-Item C:\Users\x\Downloads\a.png b.png` read b.png as inside).
const PS_RENAME = new Set(['rename-item', 'rni', 'ren', 'rename']);
const PS_MOVE = new Set(['move-item', 'mi', 'move', 'mv']);
// Writers that take the paths they write from their pipeline when they name
// none: a delete, an overwrite, an emptying (kit fix list, 2026-10-02, T10).
const PS_PIPE_TARGET = new Set([
  'remove-item', 'ri', 'rm', 'del', 'erase', 'rd', 'rmdir',
  'clear-content', 'clc', 'set-content', 'sc', 'add-content', 'ac',
]);
// The start of a pipeline whose items can be read: a command that lists the
// path it is given (the current folder when none is), and the stages that
// only filter or sort what passes through.
const PS_LISTERS = new Set(['get-childitem', 'gci', 'ls', 'dir', 'get-item', 'gi', 'resolve-path', 'rvpa']);
const PS_FILTERS = new Set(['where-object', 'where', '?', 'sort-object', 'sort', 'select-object', 'select', 'get-unique', 'gu']);
// A lister's switches; any other parameter takes the next word as its value.
const PS_LIST_SWITCH = /^(recurse|force|file|directory|hidden|readonly|system|name|followsymlink|ad|af|ah|ar|as|verbose|vb|debug|db)$/;
// Words that make PowerShell run text as commands: Invoke-Expression, a
// script block, a job, a new PowerShell, the call or dot-source operator in
// front of something to run, and a script file named to be run.
const PS_RUNS_TEXT = /(?:^|[^\w-])(?:invoke-expression|iex|invoke-command|icm|start-job|sajb|powershell|pwsh|scriptblock)(?![\w-])|(?:^|[\s;|({])&\s*[^\s&>]|(?:^|[;|({\n])\s*\.\s+\S|[\w)\]]\.(?:ps1|psm1|cmd|bat)\b/i;
// The same in bash: eval, source and its dot, and a shell given a script.
const BASH_RUNS_TEXT = /(?:^|[\s;&|(!{`])(?:eval|source|\.)\s|(?:^|[^\w-])(?:bash|sh|zsh|dash|ksh)(?:\s+-[A-Za-z]+)*\s+-[A-Za-z]*c\b|\|\s*(?:bash|sh|zsh|dash|ksh)\b/;
// Start-Process writes only where it is told to send the output.
const PS_START = new Set(['start-process', 'saps', 'start']);
const PS_START_DEST = /^-(redirectstandardoutput|redirectstandarderror|rso|rse)(:|=|$)/i;
// .NET calls that write, and which arguments they write to (review
// 2026-09-28: `[IO.File]::WriteAllText('C:\Users\x\a.txt', ...)` is the usual
// way to write UTF-8 without a BOM from Windows PowerShell, and it ran
// unread). `Open` is left out: its mode decides whether it writes.
const DOTNET_WRITE = /\[(?:System\.)?IO\.(File|Directory)\]::(\w+)\s*\(/gi;
const DOTNET_DEST = {
  file: { writealltext: [0], writealllines: [0], writeallbytes: [0], appendalltext: [0], appendalllines: [0], create: [0], createtext: [0], appendtext: [0], openwrite: [0], copy: [1], move: [1], replace: [1, 2], delete: [0], encrypt: [0], decrypt: [0], setattributes: [0] },
  directory: { createdirectory: [0], delete: [0], move: [1] },
};
// Parameters whose VALUE is a write destination.
const PS_DEST_PARAMS = /^-(destination|newname|destinationpath|outfile|literalpath|path|filepath|outputfile|target)(:|=|$)/i;
// For copy, rename and the two archive cmdlets, only these are destinations:
// `-Path` is the SOURCE, a read, and checking it refused copying a file, or
// unzipping an export, INTO the project from outside. A move's source is not
// checked either: moving a file into the project from another folder is
// allowed, the owner's choice (2026-09-26).
const PS_DEST_ONLY = /^-(destination|newname|destinationpath)(:|=|$)/i;
// The source parameter of a copy, a move or an archive, with its aliases.
const PS_SOURCE_PARAM = /^-(path|literalpath|pspath|lp)$/i;
const PS_SOURCE_GLUED = /^-(?:path|literalpath|pspath|lp)[:=](.+)$/i;
// Parameters whose value is content, not a path.
const PS_VALUE_PARAMS = /^-(value|body|encoding|name|itemtype|filter|include|exclude|delimiter|separator)(:|=|$)/i;

// Wrappers that sit in front of the real program: the delete guard's list.
const WRAPPERS = new Set(['sudo', 'doas', 'env', 'nohup', 'command', 'time', 'timeout', 'stdbuf', 'nice', 'ionice', 'xargs', 'exec', 'builtin']);
// Wrapper flags whose value is the next word (`xargs -I {}`, `timeout -k 5`,
// `sudo -u me`): that word is not the program (review 2026-09-28: `sudo -u me
// cp ...` read `me` as the program and never checked the copy).
const WRAPPER_VALUE_FLAGS = {
  xargs: /^-[IndPLEsa]$/, env: /^-[uCS]$/, timeout: /^-[sk]$/, nice: /^-n$/,
  ionice: /^-[cnp]$/, stdbuf: /^-[ioe]$/, sudo: /^-[ugCDpRrtTU]$/, doas: /^-[uC]$/,
};
// A lone `{`, `}`, `!`, `.` or `(` in front of a command: a group brace the
// splitter left in place, a negation, PowerShell dot-sourcing (or the bash
// `source` dot), a subshell. The command comes after it.
const LEADING_WORDS = /^([{}!.]|\(+)$/;
// Words that open or continue a loop or a condition: the command comes after
// them, as the delete guard beside this file reads them (kit fix list,
// 2026-10-02, T8: after `do`, `then` or `else` the word itself was taken for
// the program, so a copy, a delete or a script inside a one-line loop or
// if-block ran unread).
const SHELL_KEYWORDS = /^(if|then|else|elif|while|until|do)$/;

/**
 * Is this word a bash case pattern, `x)`, `*)`, `b)` after a `|`, or `(x)`
 * right after `case WORD in`? A word whose `)` closes nothing it opened, and
 * not a `$( )` or `<( )`.
 */
function casePattern(t, afterCase) {
  if (t.redirect || !t.text.endsWith(')') || (t.lit && t.lit[t.text.length - 1])) return false;
  if (/^[$<>]\(/.test(t.text)) return false;
  let opens = 0;
  let closes = 0;
  for (let i = 0; i < t.text.length; i++) {
    if (t.lit && t.lit[i]) continue;
    if (t.text[i] === '(') opens++;
    else if (t.text[i] === ')') closes++;
  }
  return closes > opens || (afterCase && t.text.startsWith('(') && !(t.lit && t.lit[0]));
}

// A PowerShell cast in front of a command (`[void](New-Item ...)`), or an
// assignment glued to it (`$null=New-Item ...`), is not the command's name
// (review 2026-09-28).
const programName = (t) => t.text.replace(/^\$[\w:]+[-+*/]?=/, '').replace(/^(?:\[[\w.]+\])?[({\s]+/, '').split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase();

/** Advance past env assignments, wrappers and their flags to the real program. */
function programIndex(tokens, shell) {
  let i = 0;
  for (let hops = 0; hops < 8 && i < tokens.length; hops++) {
    while (i < tokens.length && (tokens[i].redirect
      || (isWord(tokens[i]) && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i].text) || LEADING_WORDS.test(tokens[i].text) || SHELL_KEYWORDS.test(tokens[i].text))))) i++;
    // In bash, `case WORD in` and a pattern come before the command they pick.
    if (shell === 'bash' && i < tokens.length) {
      if (tokens[i].text === 'case' && !(tokens[i].lit && tokens[i].lit[0])) {
        if (!tokens[i + 2] || tokens[i + 2].text !== 'in') return -1;
        i += 3;
        if (i < tokens.length && casePattern(tokens[i], true)) i++;
        continue;
      }
      if (casePattern(tokens[i], false)) { i++; continue; }
    }
    // PowerShell runs the command after `$null =` or `$x +=` and keeps its
    // output (review 2026-09-28: `$null = New-Item ...` is the usual way to
    // make a folder quietly, and `$null` was read as the program).
    if (shell === 'powershell' && i + 1 < tokens.length && /^\$[\w:]+$/.test(tokens[i].text) && /^[-+*/]?=$/.test(tokens[i + 1].text)) {
      i += 2;
      continue;
    }
    if (i >= tokens.length) return -1;
    const wrapper = programName(tokens[i]);
    if (!WRAPPERS.has(wrapper)) return i;
    i++;
    // Skip the wrapper's own flags (with the value of one that takes a value),
    // and a duration or a priority: `timeout 5`, `timeout 10s`, `nice 10`.
    while (i < tokens.length && isFlag(tokens[i], shell)) {
      i += WRAPPER_VALUE_FLAGS[wrapper] && WRAPPER_VALUE_FLAGS[wrapper].test(tokens[i].text) ? 2 : 1;
    }
    if ((wrapper === 'timeout' || wrapper === 'nice') && i < tokens.length && /^\d+(\.\d+)?[smhd]?$/.test(tokens[i].text)) i++;
  }
  return i < tokens.length ? i : -1;
}

/**
 * Where an inline script writes (2026-09-24).
 *
 * Reading a multi-line script as one argument (see splitSegments) stopped its
 * lines being misread as shell commands. Some of those misreadings had been
 * blocking real writes by accident, so the checks below look at what the
 * script actually writes, in one-line and multi-line scripts alike:
 *   - the DESTINATION of every write call (the file written, not the files
 *     read): a literal must land inside the project, a path built from the
 *     home, temp or environment folders is refused, and a path built at run
 *     time is refused when the command runs outside the project (`cd` out),
 *     when the script also uses the home, temp or environment folders, or
 *     when it names a folder outside the project by its absolute path
 *     (2026-10-01, see namedOutside);
 *   - every command the script hands to a shell (`execSync`, `os.system`,
 *     `subprocess` with a shell, an argument list starting `bash -c`), also
 *     when the command is kept in a variable first. It is read by this guard's
 *     own shell reading, exactly like a command typed at the prompt, so a `>`
 *     inside a quoted sed or grep pattern is data and a `mkdir` or `cp` inside
 *     the command is checked like any other.
 * Reads are never checked here: a script may read any folder it likes. The
 * first cut of this checked every literal and every statement and blocked
 * everyday read-only scripts (two reviews, 2026-09-24). A third review found
 * writes reached through a variable or through a call the list did not name,
 * and quoted `>` characters in sed and grep patterns read as redirections.
 *
 * The review of 2026-10-01 found writes that only the old literal scan of
 * one-line scripts had been stopping, so the reading grew (see prepareScript
 * and inlineScriptRisk), and a final review that day brought the scan back
 * for one-line scripts as well, extended to every script on 2026-10-02 (see
 * outsidePathRisk). The reading now also sees a
 * script that changes its own folder (`process.chdir`, `os.chdir`,
 * `Dir.chdir`), code run through eval, exec or new Function, a method named by
 * a string (`fs['writeFileSync']`), Perl and Ruby calls written without
 * parentheses, an argument list handed to a program (`execFileSync('cp',
 * [...])`), and calls that make a file without the word write in their name
 * (`sqlite3.connect`, `tempfile.mkstemp`).
 */
const SCRIPT_WRITE_CALLS = [
  // `dest` lists the arguments written; 'receiver' is the object the method is
  // called on (`Path('x').touch()`). A move writes both of its ends.
  // Deno's writers, Ruby's File.delete, the calls that change a file's mode,
  // owner or times, and unpacking an archive joined the list on 2026-10-01,
  // when one-line scripts stopped being refused for every absolute path in
  // them: each of those writes was refused that way until then.
  // A file the script makes without the word write in the call's name counts
  // the same way (2026-10-01): a named pipe, a log file handler, an Excel
  // writer, Ruby's binwrite and the FileUtils spellings that remove or make.
  { re: /\b(writeFile(?:Sync)?|writeTextFile(?:Sync)?|appendFile(?:Sync)?|createWriteStream|mkdir(?:Sync)?|mkdtemp(?:Sync)?|rm(?:Sync)?|rmdir(?:Sync)?|unlink(?:Sync)?|truncate(?:Sync)?|makedirs|removedirs|mkfifo|mknod|os\.remove|shutil\.rmtree|File\.write|File\.binwrite|File\.delete|Dir\.delete|IO\.write|IO\.binwrite|Deno\.(?:remove|create|utime)(?:Sync)?|FileUtils\.(?:touch|mkdir_p|mkdir|makedirs|mkpath|rm_rf|rm_r|rm_f|rm|rmtree|remove_dir|remove_entry_secure|remove_entry|remove_file|remove)|l?chmod(?:Sync)?|l?chown(?:Sync)?|l?utimes(?:Sync)?|os\.utime|shutil\.chown|(?:logging\.(?:handlers\.)?)?(?:Timed)?(?:Rotating|Watched)?FileHandler|ExcelWriter)\s*\(/g, dest: [0] },
  { re: /\b(copyFile(?:Sync)?|cp(?:Sync)?|shutil\.(?:copy|copy2|copyfile|copytree|unpack_archive)|FileUtils\.(?:cp_r|cp|copy_file|copy_entry|copy|install))\s*\(/g, dest: [1] },
  // A SQLite database is created by connecting to it. `:memory:`, an empty
  // name and a read-only URI make no file (see sqliteTarget).
  { re: /\b(?:sqlite3|dbapi2)\.connect\s*\(/g, sqlite: true },
  // logging.basicConfig names its log file by keyword, wherever it sits.
  { re: /\bbasicConfig\s*\(/g, keyword: 'filename' },
  // An archive's extract() and extractall() name the folder they unpack into,
  // but pandas spells a regular expression the same way, so only a literal
  // that names a folder on this computer counts (FS_ABSOLUTE).
  { re: /\.extractall\s*\(/g, dest: [0], fsLiteral: true },
  { re: /\.extract\s*\(/g, dest: [1], fsLiteral: true },
  // A link is a door out of the folder, so where it POINTS is checked as well
  // as where it is made, as for `ln`, a junction and mklink (2026-10-01).
  { re: /\b(linkSync|symlink(?:Sync)?|FileUtils\.(?:ln_sf|ln_s|ln|symlink))\s*\(/g, dest: [0, 1] },
  // A bare link() is too common a name to read anywhere, so only the one a
  // file module owns counts: os.link, fs.link, Deno.link (2026-10-01).
  { re: /\.link\s*\(/g, dest: [0, 1], moduleOnly: true },
  { re: /\.(symlink_to|hardlink_to)\s*\(/g, dest: ['receiver', 0] },
  { re: /\b(rename(?:Sync)?|os\.renames|os\.replace|shutil\.move|FileUtils\.(?:mv|move))\s*\(/g, dest: [0, 1] },
  // pathlib's replace() is a move; a string's replace() is not, so only a
  // `Path(...)` receiver counts.
  { re: /\.replace\s*\(/g, dest: ['receiver', 0], pathReceiver: true },
  { re: /\b(open|openSync|ZipFile|h5py\.File|File\.new)\s*\(/g, open: true },
  { re: /\.(write_text|write_bytes|touch|mkdir|rmdir|unlink|rename|chmod|lchmod)\s*\(/g, dest: ['receiver'] },
  // A call that saves a file by a name it is given (a data frame, a figure,
  // an image, a download, an archive). Read only where that name is a literal
  // that is absolute or climbs out of the folder, since a data argument is
  // never one (review 2026-09-28: `df.to_csv('C:/Users/x/r.csv')` over
  // several lines ran unread, while the one-line form was refused).
  { re: /\b(to_(?:csv|json|excel|parquet|pickle|html|feather|hdf|xml|markdown|latex|orc|stata)|savefig|save|savetxt|savez|savez_compressed|save_image|imwrite|imsave|urlretrieve|make_archive|write_image|write_html|save_screenshot|screenshot)\s*\(/g, dest: [0, 1], literalOnly: true },
];
// A write function under another name: `const { writeFileSync: w } =
// require('fs')`, `import { rm as remove }`, `from shutil import rmtree as rt`,
// `const w = fs.writeFileSync`. Each alias is read like the name it stands
// for (review 2026-09-28).
const ALIAS_NAMES = /^(writeFile(?:Sync)?|appendFile(?:Sync)?|createWriteStream|mkdir(?:Sync)?|mkdtemp(?:Sync)?|rm(?:Sync)?|rmdir(?:Sync)?|unlink(?:Sync)?|truncate(?:Sync)?|makedirs|removedirs|copyFile(?:Sync)?|cp(?:Sync)?|rename(?:Sync)?|(?:shutil\.)?(?:rmtree|copytree|copyfile|copy2|copy|move)|os\.remove|os\.replace)$/;
// The keyword an argument can carry and still name the file written.
const DEST_KEYWORD = /^(file|path|dst|name|filename|fname|filepath|path_or_buf|target|extract_dir|database)\s*=(?!=)\s*/;
const SCRIPT_SPAWN_CALLS = /\b(execSync|exec|execFile(?:Sync)?|spawn(?:Sync)?|os\.system|os\.popen|subprocess\.(?:run|call|check_call|check_output|Popen)|system)\s*\(/g;
// More calls that start a program, read by this guard only (2026-10-01). The
// delete guard beside this file shares SCRIPT_SPAWN_CALLS, so these live apart
// and leave its verdicts as they were. See argvCallCommands.
const SCRIPT_ARGV_CALLS = /\b(os\.(?:spawn|exec)[lv]p?e?|os\.posix_spawnp?|fork|(?:asyncio\.)?create_subprocess_(?:exec|shell)|subprocess\.(?:getoutput|getstatusoutput)|IO\.popen|Open3\.(?:capture2e|capture2|capture3|popen2e|popen2|popen3|pipeline_rw|pipeline_r|pipeline_w|pipeline_start|pipeline))\s*\(/g;
// The environment variables that name the home, temp and application folders,
// in every spelling a script reads them by. Deno's env.get, Node's
// process.env[...] and Ruby's ENV[...] joined on 2026-10-01.
const HOME_VARS = '(?:HOME|USERPROFILE|APPDATA|LOCALAPPDATA|TEMP|TMP|TMPDIR)';
const SCRIPT_HOME = new RegExp([
  `\\b(?:os\\.homedir|homedir\\s*\\(|os\\.tmpdir|tmpdir\\s*\\(|expanduser|expandvars|Path\\.home|gettempdir|Dir\\.home|Dir\\.tmpdir)`,
  `\\bprocess\\.env\\.${HOME_VARS}\\b`,
  `\\bprocess\\.env\\s*\\[\\s*['"\`]${HOME_VARS}['"\`]`,
  `\\bos\\.environ(?:\\.get)?\\s*[[(]\\s*['"]${HOME_VARS}['"]`,
  `\\bos\\.getenv\\s*\\(\\s*['"]${HOME_VARS}['"]`,
  `\\bDeno\\.env\\.get\\s*\\(\\s*['"\`]${HOME_VARS}['"\`]`,
  `\\bENV\\s*(?:\\[|\\.fetch\\s*\\()\\s*['"]${HOME_VARS}['"]`,
  '\\$ENV\\{',
].join('|'));
const SCRIPT_STRINGS = /(['"`])((?:\\[\s\S]|(?!\1)[^\\])*?)\1/g;
// A method called on one of these is a module function, not a call on a path.
const MODULE_RECEIVER = /^(?:fs|fsp|os|io|codecs|shutil|FileUtils|File|IO|Dir|Deno|promises|fs\.promises|zipfile|tarfile|gzip|bz2|lzma|shelve|dbm(?:\.\w+)?|h5py|require\([^()]*\)(?:\.promises)?)$/;
// Modules whose methods write. A method of one chosen at run time
// (`fs[name](...)`, `getattr(os, name)`, `File.send(m, ...)`) cannot be proven
// harmless (2026-10-01, see unprovableKeys).
const WRITE_MODULE = /^(?:fs|fsp|fs\.promises|promises|os|shutil|pathlib|Path|Deno|File|FileUtils|IO|Dir|child_process|subprocess|require\(\s*['"`](?:node:)?(?:fs|fs\/promises|child_process)['"`]\s*\)(?:\.promises)?)$/;
// Perl's file functions, read with Perl's own argument order (2026-10-01):
// unlink and the File::Path calls take a list of paths, chmod a mode and then
// paths, chown and utime two values and then paths. File::Copy's copy and
// move, link and dbmopen follow the usual source and destination order.
const PERL_WRITE_CALLS = [
  { re: /\b(unlink|make_path|mkpath|remove_tree|rmtree)\s*\(/g, from: 0 },
  { re: /\bchmod\s*\(/g, from: 1 },
  { re: /\b(chown|utime)\s*\(/g, from: 2 },
  { re: /\b(copy|cp|dbmopen)\s*\(/g, dest: [1] },
  { re: /\b(move|mv|link)\s*\(/g, dest: [0, 1] },
  { re: /\bsysopen\s*\(/g, sysopen: true },
];
// Calls Perl and Ruby let a script write without parentheses (`unlink "x"`,
// `File.write "x", "a"`). parenthesizeBare adds them, so every later reading
// sees the usual `name(...)` (2026-10-01).
const BARE_CALLS = {
  perl: /\b(unlink|mkdir|rmdir|rename|open|sysopen|symlink|link|copy|move|cp|mv|chmod|chown|utime|truncate|make_path|mkpath|remove_tree|rmtree|chdir|eval|system|exec|dbmopen)\b/g,
  ruby: /\b(write|binwrite|delete|unlink|rename|symlink|link|open|new|mkdir|mkdir_p|makedirs|mkpath|rmdir|rm|rm_r|rm_rf|rm_f|rmtree|remove|remove_dir|remove_entry|remove_entry_secure|remove_file|cp|cp_r|copy|copy_file|copy_entry|install|mv|move|touch|ln|ln_s|ln_sf|chmod|chown|truncate|chdir|cd|eval|instance_eval|class_eval|module_eval|system|exec|spawn|send|public_send|__send__)\b/g,
};
// Words that end a call written without parentheses, or that can never be
// its first argument.
const BARE_STOP_WORDS = 'or|and|if|unless|while|until|do|then|not|xor|for|foreach|end|rescue';
const BARE_ARG = new RegExp(`^[ \\t]+(?!(?:${BARE_STOP_WORDS})\\b)(?=["'$@\\w\\[:\\\\])`);
const BARE_END = new RegExp(`\\|\\||&&|[ \\t](?:${BARE_STOP_WORDS})\\b`, 'y');
// The calls that run a string as code, per language. Their receivers are
// checked in evalReceiverOk, so `model.eval()` and `re.compile()` are not them.
const EVAL_CALLS = {
  js: /\b(eval|Function|runInThisContext|runInNewContext|runInContext|compileFunction|Script|constructor)\b/g,
  py: /\b(eval|exec|compile)\b/g,
  ruby: /\b(eval|instance_eval|class_eval|module_eval)\b/g,
  perl: /\b(eval)\b/g,
};
// How far a script that runs its own strings as code is spelled out, and how
// long it may grow: past either, the rest is unprovable.
const EVAL_BUDGET = 32;
const EVAL_MAX_TEXT = 200000;
// Where tempfile's calls take their folder when it is not given by keyword.
const TEMP_DIR_AT = { mkstemp: 2, mkdtemp: 2, TemporaryDirectory: 2, NamedTemporaryFile: 6, TemporaryFile: 6, SpooledTemporaryFile: 7 };
const POSIX_SHELL = /^(?:.*[\\/])?(?:bash|sh|zsh|dash)(?:\.exe)?$/i;
const CMD_SHELL = /^(?:.*[\\/])?cmd(?:\.exe)?$/i;
const PS_SHELL = /^(?:.*[\\/])?(?:powershell|pwsh)(?:\.exe)?$/i;
// Characters cmd.exe treats as plain text, swapped for look-alikes the bash
// reading also treats as plain text, and swapped back in the message.
const CMD_PLAIN = { "'": 'ʼ', $: '＄', '`': 'ˋ' };
const CMD_BACK = { 'ʼ': "'", '＄': '$', 'ˋ': '`' };
let inlineDepth = 0; // a script that starts a script that starts a script stops somewhere

/** The top-level arguments of the call whose `(` sits at `open`; `.end` is just past its `)`. */
function callArgs(text, open) {
  const args = [];
  let depth = 0;
  let cur = '';
  let q = null;
  for (let i = open + 1; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      cur += ch;
      if (ch === '\\') { cur += text[i + 1] ?? ''; i++; continue; }
      if (ch === q) q = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; cur += ch; continue; }
    if ('([{'.includes(ch)) { depth++; cur += ch; continue; }
    if (')]}'.includes(ch)) {
      if (depth === 0) { args.push(cur.trim()); args.end = i + 1; return args; }
      depth--; cur += ch; continue;
    }
    if (ch === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  args.push(cur.trim());
  args.end = text.length;
  return args;
}

/**
 * The string literal that starts at `i`, in JavaScript or Python spelling
 * (prefixes like r'' and f'', triple quotes, templates). `text` is its value
 * with each interpolation replaced by %X%, which the shell reading treats as a
 * value known only at run time; `prefix` is the fixed part before the
 * first interpolation, or null when there is none. Null when no literal starts here.
 */
function stringLiteralAt(src, i) {
  let j = i;
  let pre = '';
  while (pre.length < 2 && /[rRbBuUfF]/.test(src[j] ?? '')) { pre += src[j]; j++; }
  if (pre && i > 0 && /[\w$]/.test(src[i - 1])) return null;
  const q = src[j];
  if (q !== "'" && q !== '"' && q !== '`') return null;
  if (pre && q === '`') return null;
  const raw = /r/i.test(pre);
  const fmt = /f/i.test(pre);
  const close = q !== '`' && src.startsWith(q.repeat(3), j) ? q.repeat(3) : q;
  let inner = '';
  for (let k = j + close.length; k < src.length;) {
    if (src[k] === '\\') { inner += src.slice(k, k + 2); k += 2; continue; }
    if (src.startsWith(close, k)) {
      const hole = q === '`' ? /\$\{[^}]*\}/g : fmt ? /\{\{|\}\}|\{[^{}]*\}/g : null;
      const decode = (s) => (raw ? s : s.replace(/\\([\s\S])/g, (m, c) => ({ n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', '`': '`', '\n': '' }[c] ?? m)));
      let first = -1;
      const text = hole
        ? inner.replace(hole, (m, at) => {
          if (m === '{{') return '{';
          if (m === '}}') return '}';
          if (first < 0) first = at;
          return '%X%';
        })
        : inner;
      return { text: decode(text), prefix: first < 0 ? null : decode(inner.slice(0, first)), end: k + close.length };
    }
    inner += src[k];
    k++;
  }
  return null;
}

/** The script with every string's contents blanked, so a call NAMED in a string is not a call. */
function maskStrings(body) {
  return body.replace(SCRIPT_STRINGS, (m, q, inner) => q + ' '.repeat(inner.length) + q);
}

/** The expression a method is called on, read backward from its `.`. */
function receiverBefore(src, dot) {
  const skipBack = (at) => {
    let depth = 0;
    for (let k = at; k >= 0; k--) {
      const ch = src[k];
      if (ch === "'" || ch === '"' || ch === '`') { k = src.lastIndexOf(ch, k - 1); if (k < 0) return -1; continue; }
      if (')]}'.includes(ch)) depth++;
      else if ('([{'.includes(ch) && --depth === 0) return k;
    }
    return -1;
  };
  let i = dot;
  while (i > 0) {
    const ch = src[i - 1];
    if (ch === ')' || ch === ']') {
      const open = skipBack(i - 1);
      if (open < 0) break;
      i = open;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const open = src.lastIndexOf(ch, i - 2);
      if (open < 0) break;
      i = open;
      continue;
    }
    if (/[\w$.]/.test(ch)) { i--; continue; }
    break;
  }
  return src.slice(i, dot).trim();
}

/** Does this argument list open a file for writing? The first mode given decides. */
function writeModeIn(args) {
  for (const a of args) {
    const kw = /^(\w+)\s*=(?!=)\s*([\s\S]*)$/.exec(a);
    if (kw && !/^(mode|flags?)$/.test(kw[1])) continue;
    const v = (kw ? kw[2] : a).trim();
    if (/\bO_(WRONLY|RDWR|CREAT|TRUNC|APPEND)\b/.test(v)) return true;
    // An options object: Deno.open(p, { write: true }), fs.open(p, { flags:
    // 'w' }). One that names neither is not a mode, so the next argument is
    // read (2026-10-01).
    if (v.startsWith('{')) {
      if (/\b(?:write|append|create|createNew|truncate)\s*:\s*true\b/.test(v)) return true;
      const flags = /\bflags?\s*:\s*(['"`])([^'"`]*)\1/.exec(v);
      if (flags) return /[wax+]/.test(flags[2]);
      continue;
    }
    const l = stringLiteralAt(v, 0);
    // tarfile spells a compressed mode `w:gz` or `r|bz2`: the letters before
    // the separator are the mode.
    if (l && l.end === v.length) {
      const mode = l.text.split(/[:|]/)[0];
      return /^[rwxabts+U]+$/.test(mode) && /[wax+]/.test(mode);
    }
  }
  return false;
}

/** The aliases a script gives its write functions: alias -> the name it stands for. */
function scriptAliases(body) {
  const out = new Map();
  const code = maskStrings(body);
  const add = (name, alias) => { if (ALIAS_NAMES.test(name) && alias !== name && !out.has(alias)) out.set(alias, name); };
  // `{ writeFileSync: w }`, `{ rm as remove }`, `import rmtree as rt`
  for (const m of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*(?::|\s+as)\s*([A-Za-z_$][\w$]*)/g)) add(m[1], m[2]);
  // `from shutil import rmtree as rt`: the name lives under its module here.
  for (const m of code.matchAll(/\bfrom\s+(shutil|os)\s+import\s+([^\n;]+)/g)) {
    for (const item of m[2].split(',')) {
      const as = /^\s*(\w+)\s+as\s+(\w+)\s*$/.exec(item);
      if (as) add(`${m[1]}.${as[1]}`, as[2]);
    }
  }
  // `const w = fs.writeFileSync`, `w = shutil.rmtree`
  for (const m of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*=\s*((?:fs|fsp|shutil|os|require\([^()]*\))\.[A-Za-z_]\w*)\s*(?=[;\n]|$)/g)) {
    add(m[2].replace(/^(?:fs|fsp|require\([^()]*\))\./, ''), m[1]);
  }
  return out;
}

/** The write-call rule an alias inherits: the one whose pattern matches its real name. */
function specFor(name) {
  return SCRIPT_WRITE_CALLS.find((c) => new RegExp(c.re.source).test(`${name}(`)) || null;
}

/**
 * The expressions a script writes to, as written in the script: `dests` for
 * the calls that always write there, `loose` for the save-style calls whose
 * argument counts only as a literal path, and `fsLoose` for the extract calls,
 * whose argument counts only as a literal that names a folder on this
 * computer (see SCRIPT_WRITE_CALLS).
 *
 * Each entry is `{ expr, at }` (an expression as written), `{ shape, at }`
 * (one already worked out), or `{ temp: true, at }` (a file made in the system
 * temp folder). `at` is where the call sits, so a folder change before it is
 * taken into account (2026-10-01, see folderMoves). `fam` is the script's
 * language (scriptFamily); Perl's own argument orders apply only to Perl.
 */
function writeDestinations(body, fam = 'other') {
  const out = { dests: [], loose: [], fsLoose: [] };
  const code = maskStrings(body);
  const specs = [...SCRIPT_WRITE_CALLS, ...(fam === 'perl' ? PERL_WRITE_CALLS : [])];
  for (const [alias, name] of scriptAliases(body)) {
    const spec = specFor(name);
    if (spec) specs.push({ ...spec, re: new RegExp(`\\b(${alias.replace(/\$/g, '\\$')})\\s*\\(`, 'g') });
  }
  const entry = (target, at) => (typeof target === 'string' ? { expr: target, at } : { shape: target.shape, at });
  for (const call of specs) {
    const into = call.literalOnly ? out.loose : call.fsLiteral ? out.fsLoose : out.dests;
    for (const m of code.matchAll(call.re)) {
      const at = m.index;
      const open = m.index + m[0].length - 1;
      const dot = code[m.index] === '.' ? m.index : code[m.index - 1] === '.' ? m.index - 1 : -1;
      const receiver = dot >= 0 ? receiverBefore(body, dot) : '';
      const onModule = dot < 0 || MODULE_RECEIVER.test(receiver);
      const args = callArgs(body, open);
      // A keyword argument names the file too: `open(file='x', mode='w')`,
      // `shutil.copy(src, dst='x')` (review 2026-09-28).
      const argAt = (k) => {
        const a = args[k];
        if (!a) return null;
        if (!/^\w+\s*=(?!=)/.test(a)) return a;
        const kw = DEST_KEYWORD.exec(a);
        return kw ? a.slice(kw[0].length) : null;
      };
      if (call.open) {
        const perl = perlOpenTarget(args);
        if (perl) {
          into.push(entry(perl, at)); // open(my $fh, '>', 'x'), open(FH, '>x')
        } else if (/^(?:shelve|dbm(?:\.\w+)?)$/.test(receiver)) {
          // shelve.open makes its file unless told to only read ('r'), and
          // dbm.open makes one with 'c', 'n' or 'w' (2026-10-01).
          const flag = dbmFlag(args);
          const writes = receiver === 'shelve' ? flag !== 'r' : flag !== null && /[cnw]/.test(flag);
          if (writes && argAt(0)) into.push(entry(argAt(0), at));
        } else if (onModule) {
          if (argAt(0) && writeModeIn(args.slice(1))) into.push(entry(argAt(0), at)); // open(path, 'w')
        } else if (receiver && writeModeIn(args)) {
          into.push(entry(receiver, at)); // Path('x').open('w')
        }
        continue;
      }
      if (call.sysopen) {
        // Perl's sysopen(FH, path, flags) writes when its flags say so.
        if (args[1] && writeModeIn(args.slice(2))) into.push(entry(args[1], at));
        continue;
      }
      if (call.sqlite) {
        const target = sqliteTarget(argAt(0));
        if (target) into.push(entry(target, at));
        continue;
      }
      if (call.keyword) {
        const kw = new RegExp(`^${call.keyword}\\s*=(?!=)\\s*`);
        for (const a of args) {
          const k = kw.exec(a);
          if (k) into.push(entry(a.slice(k[0].length), at));
        }
        continue;
      }
      if (call.from !== undefined) {
        // A Perl list of paths; an options hash among them is not one.
        for (const a of args.slice(call.from)) if (a && !a.startsWith('{')) into.push(entry(a, at));
        continue;
      }
      if (call.moduleOnly && !(dot >= 0 && MODULE_RECEIVER.test(receiver))) continue;
      if (call.pathReceiver && !PATH_CALL.test(receiver)) continue;
      for (const d of call.dest) {
        if (d === 'receiver') {
          if (!onModule && receiver) into.push(entry(receiver, at));
        } else if (argAt(d)) {
          into.push(entry(argAt(d), at));
        }
      }
    }
  }
  // Perl's open without parentheses, its usual spelling: `open my $fh, '>',
  // 'x' or die`. The arguments run to the end of the statement, or to the
  // `or die` after them. (In a Perl script parenthesizeBare has already
  // added the parentheses; this keeps the reading for the other languages.)
  for (const m of code.matchAll(/\bopen\s+(?=[$*\w])/g)) {
    const start = m.index + m[0].length;
    const stop = code.slice(start).search(/[;\n]|\b(?:or|and)\b|\|\||&&/);
    const target = perlOpenTarget(callArgs(`(${body.slice(start, stop < 0 ? body.length : start + stop)})`, 0));
    if (target) out.dests.push(entry(target, m.index));
  }
  // tempfile makes its file or folder in the folder it is given, and in the
  // system temp folder when it is given none, which is outside the project
  // the same way `mktemp` with no folder is (2026-10-01).
  if (fam === 'py') {
    for (const m of code.matchAll(/\b(mkstemp|mkdtemp|NamedTemporaryFile|TemporaryFile|TemporaryDirectory|SpooledTemporaryFile)\s*\(/g)) {
      const dot = code[m.index - 1] === '.' ? m.index - 1 : -1;
      if (dot >= 0 && receiverBefore(body, dot) !== 'tempfile') continue;
      const args = callArgs(body, m.index + m[0].length - 1);
      let dir = null;
      for (const a of args) {
        const kw = /^dir\s*=(?!=)\s*([\s\S]+)$/.exec(a);
        if (kw) dir = kw[1].trim();
      }
      const p = args[TEMP_DIR_AT[m[1]]];
      if (dir === null && p && !/^\w+\s*=(?!=)/.test(p)) dir = p.trim();
      out.dests.push(dir === null || dir === 'None' ? { temp: true, at: m.index } : { expr: dir, at: m.index });
    }
  }
  if (fam === 'js') {
    for (const m of code.matchAll(/\bDeno\.makeTemp(?:File|Dir)(?:Sync)?\s*\(/g)) {
      const args = callArgs(body, m.index + m[0].length - 1);
      let dir = null;
      if (args[0] && args[0].startsWith('{')) {
        for (const e of callArgs(args[0], 0)) {
          const d = /^(?:dir|['"]dir['"])\s*(?::\s*([\s\S]+))?$/.exec(e.trim());
          if (d) dir = (d[1] ?? 'dir').trim();
        }
      }
      out.dests.push(dir === null ? { temp: true, at: m.index } : { expr: dir, at: m.index });
    }
  }
  return out;
}

/** The flag a shelve.open or dbm.open call is given: its text, '?' when it is not a literal, null when there is none. */
function dbmFlag(args) {
  for (const a of args.slice(1)) {
    const kw = /^(\w+)\s*=(?!=)\s*([\s\S]+)$/.exec(a);
    if (kw && kw[1] !== 'flag') continue;
    const v = (kw ? kw[2] : a).trim();
    const l = stringLiteralAt(v, 0);
    return l && l.end === v.length ? l.text : '?';
  }
  return null;
}

/**
 * Where sqlite3.connect makes its database: the expression, or a worked-out
 * shape for a `file:` URI. Null for `:memory:`, an empty name (a temporary
 * database) and a URI opened read-only or in memory, which make no file.
 */
function sqliteTarget(expr) {
  if (!expr) return null;
  const e = expr.trim();
  const l = stringLiteralAt(e, 0);
  if (!l || l.end !== e.length || l.prefix !== null) return e;
  if (l.text === '' || l.text === ':memory:') return null;
  if (!/^file:/i.test(l.text)) return e;
  if (/[?&]mode=(?:ro|memory)\b/i.test(l.text)) return null;
  return { shape: { full: l.text.replace(/^file:(?:\/\/)?/i, '').replace(/\?.*$/, '') } };
}

// A `Path(...)` call, the receiver pathlib's methods are called on.
const PATH_CALL = /^(?:pathlib\.)?(?:Pure)?(?:Windows|Posix)?Path\s*\(/;

/**
 * Where a Perl `open` writes, from its arguments: the handle, then `'>', 'x'`
 * (three arguments) or `'>x'` (two), with `>>`, `+<` and `+>` as well. Perl
 * fills in a `$` or `@` in the path, so only the part before it is known.
 * Null when the mode reads or the arguments are not Perl's: Python's
 * `open(p, 'w')` has no `>` (2026-10-01). A string is an expression for
 * writeShape to read; an object carries the shape already worked out.
 */
function perlOpenTarget(args) {
  const lit = (a) => {
    const e = String(a ?? '').trim();
    const l = stringLiteralAt(e, 0);
    return l && l.end === e.length && l.prefix === null ? l.text : null;
  };
  const known = (text) => {
    const at = text.search(/[$@]/);
    return { shape: at < 0 ? { full: text } : at > 0 ? { prefix: text.slice(0, at) } : {} };
  };
  const mode = lit(args[1]);
  if (mode === null) return null;
  if (args.length >= 3 && /^\s*(?:\+?>>?|\+<)\s*(?::.*)?$/.test(mode)) {
    const p = lit(args[2]);
    return p === null ? String(args[2]).trim() : known(p);
  }
  const two = /^\s*(?:\+?>>?|\+<)\s*(\S.*)$/.exec(mode);
  return args.length === 2 && two ? known(two[1].trim()) : null;
}

/**
 * What a destination expression is known to be: { full } for a fixed path,
 * { prefix } for a path whose start is fixed, {} when it is built at run time.
 * A variable given exactly one literal and nothing else counts as that literal,
 * and a path built with `Path(...)` or `path.join(...)` from a fixed first
 * part starts there (`Path('.tmp', p.name)` lands in .tmp). That start is as
 * far as a guard can see; a later part could still climb out, the same as the
 * rest of a template string could.
 */
function destShape(expr, body, depth = 0) {
  const e = String(expr).trim();
  const lit = stringLiteralAt(e, 0);
  if (lit && lit.end === e.length) return lit.prefix === null ? { full: lit.text } : { prefix: lit.prefix };
  if (/^[A-Za-z_$][\w$]*$/.test(e) && depth < 3) {
    const name = e.replace(/\$/g, '\\$');
    const given = [...body.matchAll(new RegExp(`(?:^|[^\\w$.])${name}\\s*\\+?=(?![=>])\\s*`, 'g'))];
    if (given.length === 1 && !/\+=\s*$/.test(given[0][0])) {
      const at = given[0].index + given[0][0].length;
      const l = stringLiteralAt(body, at);
      if (l && /^\s*(?:[;\n]|$)/.test(body.slice(l.end))) return l.prefix === null ? { full: l.text } : { prefix: l.prefix };
    }
    return {};
  }
  const call = /^((?:pathlib\.)?(?:Pure)?(?:Windows|Posix)?Path|os\.path\.join|path\.(?:posix\.)?(?:join|resolve))\s*\(/.exec(e);
  if (call) {
    const args = callArgs(e, call[0].length - 1);
    if (args.end === e.length && args[0]) {
      const parts = args.map((a) => destShape(a, body, depth + 1));
      if (parts.every((p) => p.full !== undefined)) {
        // A later absolute part restarts the path, as pathlib does.
        let full = '';
        for (const p of parts) full = full === '' || /^([A-Za-z]:)?[\\/]/.test(p.full) ? p.full : `${full}/${p.full}`;
        return { full };
      }
      if (parts[0].full !== undefined) return { prefix: `${parts[0].full}/` };
      if (parts[0].prefix) return parts[0];
    }
  }
  return {};
}

/** The texts an expression can be: a literal's value, or every literal a variable is given. */
function exprTexts(expr, body) {
  const e = String(expr).trim();
  if (!e) return [];
  const lit = stringLiteralAt(e, 0);
  if (lit && lit.end === e.length) return [lit.text];
  const out = [];
  if (/^[A-Za-z_$][\w$]*$/.test(e)) {
    const name = e.replace(/\$/g, '\\$');
    for (const m of body.matchAll(new RegExp(`(?:^|[^\\w$.])${name}\\s*\\+?=(?![=>])\\s*`, 'g'))) {
      const l = stringLiteralAt(body, m.index + m[0].length);
      if (l) out.push(l.text);
    }
    return out;
  }
  // Anything else (a concatenation, a call): every literal inside it, each on its own.
  for (let i = 0; i < e.length; i++) {
    const l = stringLiteralAt(e, i);
    if (l) { out.push(l.text); i = l.end - 1; }
  }
  return out;
}

/**
 * Every command a spawn call hands to a shell or to another inline script:
 * [{ text, shell }], shell being 'bash', 'cmd', 'powershell', or an
 * interpreter name for a nested inline script. No shell parses an argument
 * list, so a `>` in it is only a character.
 *
 * With `opts.argv` (this guard's own reading, 2026-10-01) an argument list
 * that starts any other program is read as that program's command line,
 * each item one quoted word: `execFileSync('cp', ['a', 'C:/x'])` is judged
 * like `cp 'a' 'C:/x'` typed at the prompt. Perl's and Ruby's multi-argument
 * exec, system and spawn are read the same way. The delete guard beside this
 * file calls without it and keeps the reading it was written against.
 */
function spawnedCommands(name, args, body, prog, opts = {}) {
  const out = [];
  const platformShell = process.platform === 'win32' ? 'cmd' : 'bash';
  const literal = (expr) => {
    const e = String(expr ?? '').trim();
    const l = stringLiteralAt(e, 0);
    return l && l.end === e.length ? l.text : null;
  };
  const add = (expr, shell) => { for (const text of exprTexts(expr, body)) out.push({ text, shell }); };
  const isList = (expr) => /^[[(]/.test(String(expr ?? '').trim());
  const items = (expr) => callArgs(String(expr).trim(), 0).filter((a) => a !== '');
  const shellOption = (rest) => {
    const m = /\bshell\s*[:=]\s*(?:(['"`])([^'"`]*)\1|(\w+))/.exec(rest.join(','));
    if (!m) return null;
    if (m[2] !== undefined) {
      if (POSIX_SHELL.test(m[2])) return 'bash';
      if (PS_SHELL.test(m[2])) return 'powershell';
      return CMD_SHELL.test(m[2]) ? 'cmd' : platformShell;
    }
    return /^(true|True|1)$/.test(m[3]) ? platformShell : null;
  };
  // An argument list that starts a shell or an interpreter: `bash -c <script>`.
  // With opts.argv, one that starts any other program is its command line.
  const argv = (list) => {
    const head = opts.argv ? knownWord(list[0], body) : literal(list[0]);
    if (!head) return;
    const flagAt = (re) => list.findIndex((a, k) => k > 0 && re.test(literal(a) ?? ''));
    const joinFrom = (k) => list.slice(k).map((a) => literal(a) ?? '%X%').join(' ');
    const interp = programName({ text: head });
    if (POSIX_SHELL.test(head)) {
      const k = flagAt(/^-[a-z]*c$/);
      if (k > 0 && list[k + 1]) add(list[k + 1], 'bash');
    } else if (CMD_SHELL.test(head)) {
      const k = flagAt(/^\/c$/i);
      if (k > 0) out.push({ text: joinFrom(k + 1), shell: 'cmd' });
    } else if (PS_SHELL.test(head)) {
      const k = flagAt(/^-c(o(m(m(a(n(d)?)?)?)?)?)?$/i);
      if (k > 0) out.push({ text: joinFrom(k + 1), shell: 'powershell' });
    } else if (INLINE_SCRIPT[interp]) {
      const k = flagAt(INLINE_SCRIPT[interp]);
      if (k > 0 && list[k + 1]) add(list[k + 1], interp);
    } else if (opts.argv) {
      out.push(...commandLine(list, body));
    }
  };
  const rest = args.slice(1);
  // Perl and Ruby take a program and its arguments as separate arguments of
  // exec, system and spawn; a Ruby options hash or keyword is not one of them.
  const varargs = opts.argv && (prog === 'perl' || prog === 'ruby');
  const words = () => args.filter((a) => a !== '' && !a.startsWith('{') && !/^[A-Za-z_]\w*:\s/.test(a));
  if (name === 'exec' || name === 'execSync') {
    if (/^python/.test(prog)) return out; // Python's exec() runs Python, not a shell
    if (varargs && name === 'exec' && words().length > 1) argv(words());
    else add(args[0], shellOption(rest) ?? platformShell);
  } else if (varargs && /^spawn/.test(name) && !isList(args[1])) {
    if (words().length > 1) argv(words());
    else add(args[0], platformShell);
  } else if (/^(execFile|spawn)/.test(name)) {
    const list = isList(args[1]) ? items(args[1]) : [];
    const shell = shellOption(rest);
    if (shell) out.push({ text: [args[0], ...list].map((a) => literal(a) ?? '%X%').join(' '), shell });
    else argv([args[0], ...list]);
  } else if (name.startsWith('subprocess.')) {
    const exe = /\bexecutable\s*=\s*(['"])([^'"]*)\1/.exec(rest.join(','));
    let shell = shellOption(rest);
    if (shell && exe) shell = POSIX_SHELL.test(exe[2]) ? 'bash' : PS_SHELL.test(exe[2]) ? 'powershell' : shell;
    if (isList(args[0])) {
      const list = items(args[0]);
      if (shell) out.push({ text: list.map((a) => literal(a) ?? '%X%').join(' '), shell });
      else argv(list);
    } else if (shell) {
      add(args[0], shell);
    }
  } else if (name === 'os.system' || name === 'os.popen') {
    add(args[0], platformShell);
  } else if (name === 'system') {
    if (args.length === 1) add(args[0], platformShell);
    else argv(varargs ? words() : args);
  }
  return out;
}

/**
 * What an expression is known to be as a word of a command line: a literal's
 * text, or the fixed text writeShape works out (a variable, a join, a `+`);
 * null when any part is built at run time, as a template or f-string with a
 * hole is, the same as `$X` in a command typed at the prompt.
 */
function knownWord(expr, body) {
  const e = String(expr ?? '').trim();
  if (!e) return null;
  const l = stringLiteralAt(e, 0);
  if (l && l.end === e.length) return l.prefix === null ? l.text : null;
  const shape = writeShape(e, body);
  return shape.full !== undefined ? shape.full : null;
}

/**
 * An argument list as the command line it runs: [{ text, shell: 'bash' }],
 * each item one single-quoted word, so the bash reading takes it exactly as
 * the program receives it (2026-10-01). An item built at run time becomes
 * %X%, which is unprovable as a path, the same as `$X` typed at the prompt.
 * Nothing comes back when the program itself is not known.
 */
function commandLine(list, body) {
  const words = list.map((a) => knownWord(a, body));
  if (!words[0]) return [];
  const quote = (w) => `'${String(w).replace(/[\r\n]+/g, ' ').replace(/'/g, "'\\''")}'`;
  return [{ text: words.map((w) => quote(w ?? '%X%')).join(' '), shell: 'bash' }];
}

/**
 * The commands a call from SCRIPT_ARGV_CALLS starts (2026-10-01): os.spawn*
 * and os.exec* with their argument lists or arguments, posix_spawn, Node's
 * fork, asyncio's subprocess calls, subprocess.getoutput, and Ruby's IO.popen
 * and Open3. A string is a shell command; a list, or separate arguments, is
 * a command line (commandLine).
 */
function argvCallCommands(name, args, body, prog) {
  const platformShell = process.platform === 'win32' ? 'cmd' : 'bash';
  const isList = (e) => /^[[(]/.test(String(e ?? '').trim());
  const items = (e) => callArgs(String(e).trim(), 0).filter((a) => a !== '');
  // Keyword arguments and option hashes are not words of the command line.
  const pos = args.filter((a) => a !== '' && !/^\*\*/.test(a) && !/^[A-Za-z_]\w*\s*=(?!=)/.test(a) && !/^[A-Za-z_]\w*:\s/.test(a) && !a.startsWith('{'));
  const shellText = (e) => exprTexts(e, body).map((text) => ({ text, shell: platformShell }));
  // A list given as a variable is a list nobody can read: one unknown word.
  const listOf = (e) => (isList(e) ? items(e) : ['', e]);
  let m;
  if ((m = /^os\.(spawn|exec)([lv])p?(e?)$/.exec(name))) {
    // os.spawn* take a mode first; argv[0] is the program's own name, so the
    // command line is the program, then the arguments after argv[0].
    const at = m[1] === 'spawn' ? 1 : 0;
    let rest = m[2] === 'v' ? listOf(pos[at + 1]) : pos.slice(at + 1);
    if (m[2] === 'l' && m[3]) rest = rest.slice(0, -1); // the environment comes last
    return commandLine([pos[at], ...rest.slice(1)], body);
  }
  if (/^os\.posix_spawnp?$/.test(name)) return commandLine([pos[0], ...listOf(pos[1]).slice(1)], body);
  if (name === 'fork') {
    // Node's fork(module, args) runs that module with node; Python's
    // os.fork() starts no program.
    if (prog !== 'node' && prog !== 'deno') return [];
    return pos[0] ? commandLine(["'node'", pos[0], ...(isList(pos[1]) ? items(pos[1]) : [])], body) : [];
  }
  if (/create_subprocess_exec$/.test(name)) return commandLine(pos, body);
  if (/create_subprocess_shell$|getoutput$|getstatusoutput$/.test(name)) return pos[0] ? shellText(pos[0]) : [];
  if (name === 'IO.popen') {
    // IO.popen(command, mode): a string is a shell command, a list a command line.
    if (!pos[0]) return [];
    return isList(pos[0]) ? commandLine(items(pos[0]), body) : shellText(pos[0]);
  }
  if (/^Open3\.pipeline/.test(name)) {
    // Every argument is a command of its own.
    return pos.flatMap((p) => (isList(p) ? commandLine(items(p), body) : shellText(p)));
  }
  if (name.startsWith('Open3.')) {
    if (pos.length === 1 && !isList(pos[0])) return shellText(pos[0]);
    return commandLine(isList(pos[0]) ? items(pos[0]) : pos, body);
  }
  return [];
}

/**
 * A write destination's shape (see destShape), where a path joined with `+`,
 * Python's `%` or `.format()` is also read from its known start (2026-10-01):
 * `'C:/x/' + n` starts at C:/x/, and `dir + '/x.txt'` at the literal `dir` was
 * given. Kept apart from destShape, which the delete guard beside this file
 * reads with its own meaning.
 */
function writeShape(expr, body, depth = 0) {
  const shape = destShape(expr, body);
  if (shape.full !== undefined || shape.prefix !== undefined) return shape;
  const e = String(expr).trim();
  const built = depth < 6 ? builtShape(e, body, depth) : null;
  if (built) return built;
  // A variable given one value that is not a plain literal is read through
  // that value: `out = os.path.join('.tmp', name)` lands in .tmp.
  if (/^[A-Za-z_$][\w$]*$/.test(e)) {
    const value = depth < 3 ? soleValue(e, body) : null;
    return value ? writeShape(value, body, depth + 1) : shape;
  }
  const lit = stringLiteralAt(e, 0);
  if (lit && lit.prefix === null) {
    const after = e.slice(lit.end).trimStart();
    if (/^%(?!=)/.test(after)) return { prefix: lit.text.split('%')[0] };
    if (/^\.format\s*\(/.test(after)) return { prefix: lit.text.split('{')[0] };
  }
  const parts = topLevelPlus(e);
  if (parts.length < 2) return shape;
  let known = '';
  for (const p of parts) {
    const s = depth < 3 ? writeShape(p, body, depth + 1) : destShape(p, body);
    if (s.full === undefined) return { prefix: known + (s.prefix ?? '') };
    known += s.full;
  }
  return { full: known };
}

// The path modules, under the names a script reaches them by.
const PATH_MODULE = /^(?:path(?:\.posix|\.win32)?|os\.path|posixpath|ntpath|require\(\s*['"`](?:node:)?path(?:\/posix|\/win32)?['"`]\s*\))$/;

/**
 * More shapes a write destination is built in (kit fix list, 2026-10-02,
 * T1), each read from the parts it is made of; null when `e` is none of them:
 *  - the folder the script runs in, `process.cwd()`, `os.getcwd()`,
 *    `Path.cwd()` and `__dirname` (which `node -e` sets to it), as `.`, so a
 *    climb out of it (`process.cwd() + '/../x'`) is seen;
 *  - a parent, `x.parent` and `os.path.dirname(x)`, as `x/..`;
 *  - a join by a path module under another name (`const p = require('path');
 *    p.join(...)`), or of parts that are known but not all literals;
 *  - pathlib's `/` operator, `Path.cwd().parent / 'x.txt'`;
 *  - `new URL('file:///C:/x')`, and a list of literals joined into a path.
 */
function builtShape(e, body, depth) {
  const sub = (x) => writeShape(x, body, depth + 1);
  // Only a path whose every part is known: a part built at run time can be
  // absolute and restart the path (Python's os.path.join does), so a known
  // start proves nothing here, and the reading of a path built at run time
  // stays as it was.
  const joinParts = (parts) => {
    if (!parts.every((p) => p.full !== undefined)) return null;
    let full = '';
    for (const p of parts) full = full === '' || /^([A-Za-z]:)?[\\/]/.test(p.full) ? p.full : `${full}/${p.full}`;
    return { full };
  };
  if (CWD_CALL.test(e) || /^(?:__dirname|os\.curdir)$/.test(e)) return { full: '.' };
  if (e.startsWith('(')) {
    const inner = callArgs(e, 0);
    if (inner.end === e.length && inner.length === 1 && inner[0]) return sub(inner[0]);
  }
  const parent = /^([\s\S]+?)\s*\.\s*parent$/.exec(e);
  if (parent) {
    const s = sub(parent[1]);
    return s.full !== undefined ? { full: `${s.full}/..` } : null;
  }
  const dir = /^(?:os\.path|path(?:\.posix|\.win32)?|posixpath|ntpath)\.dirname\s*\(/.exec(e);
  if (dir) {
    const args = callArgs(e, dir[0].length - 1);
    const s = args.end === e.length && args[0] ? sub(args[0]) : {};
    return s.full !== undefined ? { full: `${s.full}/..` } : null;
  }
  const join = /^([\w$.]+|require\([^()]*\))\s*\.\s*(?:join|resolve)\s*\(/.exec(e);
  if (join) {
    const value = /^[A-Za-z_$][\w$]*$/.test(join[1]) ? soleValue(join[1], body) : null;
    if (PATH_MODULE.test(join[1]) || PATH_MODULE.test(value ?? '')) {
      const args = callArgs(e, join[0].length - 1);
      return args.end === e.length && args[0] ? joinParts(args.map(sub)) : null;
    }
  }
  const slash = topLevelSplit(e, '/');
  if (slash.length >= 2 && /^(?:\(\s*)?(?:(?:pathlib\.)?(?:Pure)?(?:Windows|Posix)?Path\s*[.(]|os\.getcwd\s*\()/.test(slash[0])) {
    return joinParts(slash.map(sub));
  }
  const url = /^new\s+URL\s*\(/.exec(e);
  if (url) {
    const args = callArgs(e, url[0].length - 1);
    const t = args.end === e.length && args.length === 1 ? wholeLiteral(args[0]) : null;
    return t !== null && /^file:/i.test(t) ? { full: t.replace(/^file:(?:\/\/(?:localhost)?)?/i, '').replace(/^\/(?=[A-Za-z]:)/, '') } : null;
  }
  // ['C:', 'Users', 'x'].join('/'), and Python's '/'.join([...]).
  let items = null;
  let sep = null;
  if (e.startsWith('[')) {
    const list = callArgs(e, 0);
    const call = /^\s*\.\s*join\s*\(/.exec(e.slice(list.end));
    if (call) {
      const rest = e.slice(list.end);
      const args = callArgs(rest, call[0].length - 1);
      if (args.end === rest.length) { items = list; sep = args[0] ? wholeLiteral(args[0]) : ','; }
    }
  } else {
    const lit = stringLiteralAt(e, 0);
    const call = lit && lit.prefix === null ? /^\s*\.\s*join\s*\(/.exec(e.slice(lit.end)) : null;
    if (call) {
      const rest = e.slice(lit.end);
      const args = callArgs(rest, call[0].length - 1);
      if (args.end === rest.length && args.length === 1 && /^[[(]/.test(args[0].trim())) { items = callArgs(args[0].trim(), 0); sep = lit.text; }
    }
  }
  if (items && sep !== null) {
    const texts = items.filter((a) => a !== '').map(wholeLiteral);
    return texts.every((t) => t !== null) ? { full: texts.join(sep) } : null;
  }
  return null;
}

/** The parts of `e` at its top level split at `ch`, outside strings and brackets; a doubled `ch` splits nothing. */
function topLevelSplit(e, ch) {
  const parts = [];
  let depth = 0;
  let q = null;
  let start = 0;
  for (let i = 0; i < e.length; i++) {
    const c = e[i];
    if (q) {
      if (c === '\\') i++;
      else if (c === q) q = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') q = c;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ch && depth === 0) {
      if (e[i + 1] === ch) return [];
      parts.push(e.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(e.slice(start).trim());
  return parts.some((p) => p === '') ? [] : parts;
}

/**
 * The expression a variable is given, when it is given exactly one (`x = ...`,
 * never `x += ...`), up to the end of that statement; null otherwise.
 */
function soleValue(name, body) {
  const re = new RegExp(`(?:^|[^\\w$.])${name.replace(/\$/g, '\\$')}\\s*\\+?=(?![=>])\\s*`, 'g');
  const given = [...body.matchAll(re)];
  if (given.length !== 1 || /\+=\s*$/.test(given[0][0])) return null;
  const start = given[0].index + given[0][0].length;
  let depth = 0;
  let q = null;
  let i = start;
  for (; i < body.length; i++) {
    const ch = body[i];
    if (q) {
      if (ch === '\\') i++;
      else if (ch === q) q = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') q = ch;
    else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) { if (depth === 0) break; depth--; }
    else if (depth === 0 && (ch === ';' || ch === '\n' || ch === ',')) break;
  }
  const value = body.slice(start, i).trim();
  return value || null;
}

/** The parts of `a + b + c` at its top level; fewer than two when it is not a sum. */
function topLevelPlus(e) {
  const parts = [];
  let depth = 0;
  let q = null;
  let start = 0;
  for (let i = 0; i < e.length; i++) {
    const ch = e[i];
    if (q) {
      if (ch === '\\') i++;
      else if (ch === q) q = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') q = ch;
    else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === '+' && depth === 0 && e[i + 1] !== '+' && e[i + 1] !== '=' && e[i - 1] !== '+') {
      parts.push(e.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(e.slice(start).trim());
  return parts.some((p) => p === '') ? [] : parts;
}

// An absolute path in the spellings that name a folder on this computer: a
// drive (`C:/`, `C:\`), a network share, `~/`, the Git Bash drive spelling
// (`/c/`), or a POSIX path under one of the system's own top folders. A web
// route such as `/projects/` is not one.
const FS_ABSOLUTE = /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]|~[\\/]|\/(?:[A-Za-z]|home|Users|tmp|var|etc|usr|opt|root|mnt|private|Volumes|srv|media|Library|Applications|System|proc|sys|dev|run|snap|nix|bin|sbin|lib|lib64|boot)(?:\/|$))/;

/**
 * The first absolute path outside the project that a script names, or null.
 * A write to a path built at run time cannot be proven inside when the script
 * also names a folder outside, the same as when it uses the home folder:
 * `['C:/x/a.txt'].forEach((p) => fs.writeFileSync(p, ''))` writes there. This
 * keeps such writes refused in a script of any length and lets its reads
 * through; a script is also refused for the path itself unless it is
 * provably a read (outsidePathRisk). A word after the script that is built
 * at run time (`"$HOME/x.txt"`) counts the same way (kit fix list,
 * 2026-10-02, T1): the script can write to it through process.argv.
 */
function namedOutside(body, root, base) {
  for (let i = 0; i < body.length; i++) {
    const l = stringLiteralAt(body, i);
    if (!l) continue;
    i = l.end - 1;
    const text = l.prefix ?? l.text;
    if (FS_ABSOLUTE.test(text) && checkTarget(text, root, '', base)) return text;
  }
  return null;
}

/** The language an inline script is written in, by the program that runs it. */
function scriptFamily(prog) {
  if (prog === 'node' || prog === 'deno') return 'js';
  if (prog === 'python' || prog === 'python3' || prog === 'py') return 'py';
  if (prog === 'perl' || prog === 'ruby') return prog;
  return 'other';
}

/**
 * A Perl or Ruby script with parentheses added to the calls BARE_CALLS names
 * where they are written without them: `unlink "x" if -e "x"` is read as
 * `unlink("x") if -e "x"`. The arguments run to the end of the statement, to
 * a bracket that closes something opened before, or to a word such as `or`,
 * `if` or `do` (2026-10-01: `perl -e 'unlink "C:/x"'` ran unread). A block
 * (`eval { ... }`) and a variable (`$open`) are left alone.
 */
function parenthesizeBare(text, fam) {
  const names = BARE_CALLS[fam];
  if (!names) return text;
  // Every call is found in one pass over the script as written, and each
  // parenthesis is one character put in at a fixed place, so they go in from
  // the end backward and a call inside another's arguments keeps its place.
  // One pass, not one call per pass: a cap on passes was a way past the
  // reading for a script that padded itself with harmless calls.
  const code = maskStrings(text);
  const marks = [];
  for (const m of code.matchAll(names)) {
    if (/[$@%]/.test(code[m.index - 1] ?? '')) continue;
    const nameEnd = m.index + m[0].length;
    const gap = BARE_ARG.exec(code.slice(nameEnd, nameEnd + 64));
    if (!gap) continue;
    const argStart = nameEnd + gap[0].length;
    const end = bareArgsEnd(code, argStart);
    const kept = text.slice(argStart, end).trimEnd().length;
    if (kept === 0) continue;
    marks.push({ at: nameEnd, ch: '(' }, { at: argStart + kept, ch: ')' });
  }
  marks.sort((a, b) => b.at - a.at);
  for (const { at, ch } of marks) text = text.slice(0, at) + ch + text.slice(at);
  return text;
}

/** Where the arguments of a call written without parentheses end, in the masked script. */
function bareArgsEnd(code, from) {
  let depth = 0;
  for (let i = from; i < code.length; i++) {
    const ch = code[i];
    if (ch === '(' || ch === '[' || ch === '{') { depth++; continue; }
    if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) return i;
      depth--;
      continue;
    }
    if (depth > 0) continue;
    if (ch === ';' || ch === '\n' || (ch === '#' && /\s/.test(code[i - 1] ?? ''))) return i;
    BARE_END.lastIndex = i;
    if (BARE_END.test(code)) return i;
  }
  return code.length;
}

/** Where the `]` that closes the `[` at `open` sits in the masked script; -1 when none does. */
function closingBracket(code, open) {
  let depth = 0;
  for (let j = open; j < code.length; j++) {
    if (code[j] === '[') depth++;
    else if (code[j] === ']' && --depth === 0) return j;
  }
  return -1;
}

/**
 * Members named by a literal, read as plain names (2026-10-01):
 * `require('fs')['writeFileSync'](...)` is `require('fs').writeFileSync(...)`,
 * Python's `getattr(os, 'remove')` is `os.remove`, and Ruby's
 * `File.send(:write, ...)` and `File.method(:write).call(...)` are
 * `File.write(...)`. Every later reading then finds the call by its name. An
 * environment lookup (`os.environ['HOME']`) keeps its spelling, which
 * SCRIPT_HOME reads.
 */
function literalMembers(text, fam) {
  const nameIn = (expr) => {
    const e = String(expr ?? '').trim();
    if (fam === 'ruby' && /^:[A-Za-z_]\w*[?!]?$/.test(e)) return e.slice(1);
    const l = stringLiteralAt(e, 0);
    return l && l.end === e.length && l.prefix === null && /^[A-Za-z_$][\w$]*$/.test(l.text) ? l.text : null;
  };
  // Each kind is rewritten everywhere in one pass, from the end backward so
  // the places found stay true. A pass repeats only while a rewrite inside
  // another (`getattr(getattr(os, 'path'), 'join')`) still waits, so padding
  // a script with harmless lookups cannot use up the passes.
  const apply = (edits) => {
    let last = Infinity;
    let changed = false;
    for (const [start, end, put] of edits.sort((a, b) => b[0] - a[0])) {
      if (end > last) continue; // overlaps one already made; the next pass takes it
      text = text.slice(0, start) + put + text.slice(end);
      last = start;
      changed = true;
    }
    return changed;
  };
  for (let round = 0; round < 64; round++) {
    let changed = false;
    let code = maskStrings(text);
    const keys = [];
    for (let i = 1; i < code.length; i++) {
      if (code[i] !== '[' || !/[\w$)\]]/.test(code[i - 1])) continue;
      const close = closingBracket(code, i);
      const key = close < 0 ? null : nameIn(text.slice(i + 1, close));
      if (!key || /(?:^|\.)(?:environ|env|ENV)$/.test(receiverBefore(text, i))) continue;
      keys.push([i, close + 1, `.${key}`]);
    }
    changed = apply(keys) || changed;
    if (fam === 'py') {
      code = maskStrings(text);
      const edits = [];
      for (const m of code.matchAll(/\bgetattr\s*\(/g)) {
        const args = callArgs(text, m.index + m[0].length - 1);
        const key = args.length >= 2 ? nameIn(args[1]) : null;
        if (key && args[0]) edits.push([m.index, args.end, `${args[0]}.${key}`]);
      }
      changed = apply(edits) || changed;
    }
    if (fam === 'ruby') {
      code = maskStrings(text);
      const edits = [];
      for (const m of code.matchAll(/\.(public_send|__send__|send|method)\s*\(/g)) {
        const args = callArgs(text, m.index + m[0].length - 1);
        const key = nameIn(args[0]);
        if (!key) continue;
        if (m[1] === 'method') {
          const call = /^\s*\.\s*call\s*\(/.exec(code.slice(args.end, args.end + 32));
          if (call) edits.push([m.index, args.end + call[0].length, `.${key}(`]);
        } else {
          edits.push([m.index, args.end, `.${key}(${args.slice(1).join(', ')})`]);
        }
      }
      changed = apply(edits) || changed;
    }
    if (!changed) break;
  }
  return text;
}

/** May a call named `name` on `receiver` run a string as code? See EVAL_CALLS. */
function evalReceiverOk(fam, name, receiver, dot) {
  if (fam === 'js') {
    if (name === 'eval' || name === 'Function') return dot < 0 || /^(?:globalThis|window|global|self)$/.test(receiver);
    if (name === 'Script') return /^(?:vm|require\(\s*['"`](?:node:)?vm['"`]\s*\))$/.test(receiver);
    if (name === 'constructor') return dot >= 0; // `(() => {}).constructor(s)` is Function; a class's own constructor is not called
    return true; // vm's runIn*Context and compileFunction, on vm or by name
  }
  if (fam === 'py') return dot < 0 || /^(?:builtins|__builtins__)$/.test(receiver);
  if (fam === 'ruby') return name !== 'eval' || dot < 0 || /(?:^|\.)(?:Kernel|binding)$/.test(receiver);
  return true;
}

/**
 * Does the word eval (or exec) written without a call hide one? In
 * JavaScript `(0, eval)(s)` and `const e = eval` run code; in Python
 * `f = exec` does; a Perl `eval;` runs `$_`. A Perl `eval { ... }` is a
 * block, and a Ruby `instance_eval do ... end` takes one.
 */
function bareEvalHides(fam, name, code, at) {
  const after = code.slice(at + name.length).trimStart();
  if (fam === 'js') return name === 'eval' && !after.startsWith(':');
  if (fam === 'py') return (name === 'eval' || name === 'exec') && !/^=(?!=)/.test(after);
  if (fam === 'ruby') return name === 'eval';
  if (fam === 'perl') return !after.startsWith('{');
  return false;
}

/**
 * The code an argument of eval holds: every text it can be when each is a
 * literal (a string, Python's `compile(<string>, ...)`, or a variable only
 * ever given strings), and null when any part is built at run time.
 */
function scriptTexts(expr, text, depth = 0) {
  const e = String(expr ?? '').trim();
  if (!e || depth > 3) return null;
  const l = stringLiteralAt(e, 0);
  if (l && l.end === e.length) return l.prefix === null ? [l.text] : null;
  const compile = /^compile\s*\(/.exec(e);
  if (compile) {
    const args = callArgs(e, compile[0].length - 1);
    return args.end === e.length ? scriptTexts(args[0], text, depth + 1) : null;
  }
  if (!/^[A-Za-z_$][\w$]*$/.test(e)) return null;
  const out = [];
  for (const m of text.matchAll(new RegExp(`(?:^|[^\\w$.])${e.replace(/\$/g, '\\$')}\\s*\\+?=(?![=>])\\s*`, 'g'))) {
    if (/\+=\s*$/.test(m[0])) return null;
    const v = stringLiteralAt(text, m.index + m[0].length);
    if (!v || v.prefix !== null || !/^\s*(?:[;\n,)]|$)/.test(text.slice(v.end))) return null;
    out.push(v.text);
  }
  return out.length > 0 ? out : null;
}

/**
 * The next call at or after `from` that runs a string as code, or a bare
 * eval that hides one: { start, end, inner, texts, name }. `texts` is the code
 * it runs when every part is a literal, null when any part is built at run
 * time. `inner` is where its arguments start, so a call inside them is still
 * found when this one cannot be read. `code` is `text` masked, and `cache`
 * keeps each argument's texts while the text stays the same.
 */
function nextEval(text, code, fam, from, cache) {
  const src = EVAL_CALLS[fam];
  if (!src) return null;
  const re = new RegExp(src.source, 'g');
  re.lastIndex = from;
  for (let m; (m = re.exec(code));) {
    const name = m[1];
    const at = m.index;
    // In Perl a `.` joins strings; it never calls a method.
    const dot = code[at - 1] === '.' && fam !== 'perl' ? at - 1 : -1;
    const receiver = dot >= 0 ? receiverBefore(text, dot) : '';
    if (!evalReceiverOk(fam, name, receiver, dot)) continue;
    const paren = /^\s*\(/.exec(code.slice(at + name.length, at + name.length + 32));
    if (!paren) {
      if (!bareEvalHides(fam, name, code, at)) continue;
      return { start: at, end: at + name.length, inner: at + name.length, texts: null, name };
    }
    const open = at + name.length + paren[0].length - 1;
    const args = callArgs(text, open);
    let start = dot >= 0 ? Math.max(0, text.lastIndexOf(receiver, dot)) : at;
    const isNew = /\bnew\s+$/.exec(code.slice(Math.max(0, start - 16), start));
    if (isNew) start -= isNew[0].length;
    // Function and a constructor take parameter names before the body, and a
    // default value among them is code too, so every argument is read.
    const exprs = (name === 'Function' || name === 'constructor' ? args : args.slice(0, 1)).filter((a) => a !== '');
    let texts = exprs.length === 0 && fam === 'perl' ? null : []; // Perl's eval() runs $_
    for (const e of exprs) {
      if (!cache.has(e)) cache.set(e, scriptTexts(e, text));
      const t = cache.get(e);
      if (!t) { texts = null; break; }
      texts.push(...t);
    }
    return { start, end: args.end, inner: open + 1, texts, name };
  }
  return null;
}

/**
 * Aliases a script gives the modules that write: `const f = require('fs')`,
 * `import * as f from 'node:fs'`, `import shutil as sh`.
 */
function writeModuleAliases(text) {
  const out = new Set();
  for (const m of text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"`](?:node:)?(?:fs|fs\/promises|child_process)['"`]\s*\)/g)) out.add(m[1]);
  for (const m of text.matchAll(/\bimport\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s+from\s+['"`](?:node:)?(?:fs|fs\/promises|child_process)['"`]/g)) out.add(m[1]);
  for (const m of text.matchAll(/\bimport\s+(?:os|shutil|subprocess|pathlib)\s+as\s+(\w+)/g)) out.add(m[1]);
  return out;
}

/**
 * Methods of a module that writes, chosen at run time (2026-10-01):
 * `fs[name](...)`, `getattr(os, name)`, `File.send(m, ...)`. Which one runs
 * cannot be known, so each is listed for inlineScriptRisk to weigh.
 */
function unprovableKeys(text, fam) {
  const code = maskStrings(text);
  const aliases = writeModuleAliases(text);
  const writer = (r) => WRITE_MODULE.test(r) || aliases.has(r);
  const literal = (e) => {
    const s = String(e ?? '').trim();
    const l = stringLiteralAt(s, 0);
    return (l && l.end === s.length && l.prefix === null) || (fam === 'ruby' && /^:\w+[?!]?$/.test(s));
  };
  const out = [];
  for (let i = 1; i < code.length; i++) {
    if (code[i] !== '[' || !/[\w$)\]]/.test(code[i - 1])) continue;
    const close = closingBracket(code, i);
    if (close < 0 || literal(text.slice(i + 1, close))) continue;
    const receiver = receiverBefore(text, i);
    if (writer(receiver)) out.push({ at: i, kind: 'key', receiver });
  }
  if (fam === 'py') {
    for (const m of code.matchAll(/\bgetattr\s*\(/g)) {
      const args = callArgs(text, m.index + m[0].length - 1);
      if (args.length >= 2 && writer(args[0].trim()) && !literal(args[1])) out.push({ at: m.index, kind: 'key', receiver: args[0].trim() });
    }
  }
  if (fam === 'ruby') {
    for (const m of code.matchAll(/\.(?:public_send|__send__|send|method)\s*\(/g)) {
      const receiver = receiverBefore(text, m.index);
      const args = callArgs(text, m.index + m[0].length - 1);
      if (writer(receiver) && !literal(args[0])) out.push({ at: m.index, kind: 'key', receiver });
    }
  }
  return out;
}

// Python modules whose calls this guard reads by the module's own name.
const PY_NAMED_MODULES = /^(?:os|os\.path|shutil|subprocess|pathlib|io|tempfile|sqlite3|zipfile|tarfile|logging)$/;

/**
 * A Python script with its imports spelled out (kit fix list, 2026-10-02,
 * T1): after `import shutil as s`, `s.rmtree(p)` is read as
 * `shutil.rmtree(p)`; after `from shutil import rmtree`, `rmtree(p)` is; and
 * `__import__('os')` is `os`. The calls are then found by the names the rest
 * of this file reads, in a script of any length. The import lines themselves
 * keep their words, which the read check (foreignModule) reads.
 */
function pyImports(text) {
  let out = text.replace(/\b(?:__import__|importlib\.import_module)\s*\(\s*(['"])([\w.]+)\1\s*\)/g, '$2');
  const code = maskStrings(out);
  const names = new Map();
  const imports = [];
  for (const m of code.matchAll(/(?:^|[;\n])[ \t]*(?:from[ \t]+([\w.]+)[ \t]+)?import[ \t]+([^;\n]+)/g)) {
    imports.push([m.index, m.index + m[0].length]);
    for (const item of m[2].replace(/[()]/g, '').split(',')) {
      const [name, as, alias] = item.trim().split(/\s+/);
      const local = as === 'as' && alias ? alias : null;
      if (m[1] !== undefined) {
        if (PY_NAMED_MODULES.test(m[1]) && /^\w+$/.test(name ?? '')) names.set(local ?? name, `${m[1]}.${name}`);
      } else if (local && PY_NAMED_MODULES.test(name)) {
        names.set(local, name);
      }
    }
  }
  if (names.size === 0) return out;
  const re = new RegExp(`(?<![\\w.$])(${[...names.keys()].join('|')})(?![\\w$])`, 'g');
  const edits = [...code.matchAll(re)].filter((m) => !imports.some(([a, b]) => m.index >= a && m.index < b));
  for (const m of edits.reverse()) out = out.slice(0, m.index) + names.get(m[1]) + out.slice(m.index + m[1].length);
  return out;
}

/**
 * The script as this guard reads it (2026-10-01): Perl and Ruby calls given
 * their parentheses, members named by a literal read as names, and every
 * string the script runs as code spelled out in place of the call that runs
 * it, so the writes in it are read like the rest of the script and see the
 * same variables and the same folder. `unprovable` lists the code built at
 * run time and the methods of a write module chosen at run time.
 */
function prepareScript(body, fam) {
  let text = fam === 'py' ? pyImports(String(body)) : String(body);
  const unprovable = [];
  let from = 0;
  let budget = EVAL_BUDGET;
  // The rewrites, the masked text and the variable lookups are worked out
  // again only when spelling out a string changed the text.
  let changed = true;
  let code = '';
  let cache = new Map();
  for (;;) {
    if (changed) {
      text = literalMembers(parenthesizeBare(text, fam), fam);
      code = maskStrings(text);
      cache = new Map();
      changed = false;
    }
    const call = nextEval(text, code, fam, from, cache);
    if (!call) break;
    if (call.texts && budget > 0 && text.length <= EVAL_MAX_TEXT) {
      budget--;
      text = `${text.slice(0, call.start)}\n${call.texts.join('\n')}\n${text.slice(call.end)}`;
      from = call.start;
      changed = true;
    } else {
      unprovable.push({ at: call.start, kind: 'eval', name: call.name });
      from = call.inner;
    }
  }
  unprovable.push(...unprovableKeys(text, fam));
  return { text, unprovable };
}

// Calls and values that name the folder a script is already in.
const CWD_CALL = /^(?:(?:os\.getcwd|process\.cwd|Deno\.cwd|(?:pathlib\.)?Path\.cwd)\s*\(\s*\)|Dir\.(?:pwd|getwd))$/;

/**
 * The folder `expr` names, resolved from the folder `from`: a lower-cased
 * full path, or UNKNOWN_DIR when it is built at run time. A path whose start
 * is fixed stands for a folder under that start, as destShape reads it.
 */
function resolveFolder(expr, from, text) {
  const e = String(expr).trim();
  const value = /^[A-Za-z_$][\w$]*$/.test(e) ? soleValue(e, text) : null;
  if (CWD_CALL.test(e) || (value && CWD_CALL.test(value))) return from;
  const shape = writeShape(e, text);
  const target = shape.full !== undefined ? shape.full : shape.prefix ? `${shape.prefix}x` : null;
  if (target === null) return UNKNOWN_DIR;
  const r = resolveStatic(target.replace(/\\{2,}/g, '\\'), from);
  return r.dynamic || !r.full ? UNKNOWN_DIR : r.full;
}

/**
 * Where a script moves its own working folder (2026-10-01): process.chdir,
 * os.chdir, Dir.chdir, Deno.chdir, contextlib.chdir, FileUtils.cd and Perl's
 * chdir, in order, each resolved from the folder the move before it left:
 * [{ at, dir }]. A move to a folder built at run time, os.fchdir, and a Perl
 * or Ruby chdir with no folder (which goes home) lead to an unknown folder,
 * so every relative write after one is unprovable, as after a `cd $X`.
 */
function folderMoves(text, code, fam, base) {
  const aliases = [...code.matchAll(/\b([A-Za-z_$][\w$]*)\s*=\s*(?:[\w$.]+\.)?chdir\b(?!\s*\()/g)].map((m) => m[1]);
  for (const m of code.matchAll(/\bimport\s+[^\n;]*?\bchdir\s+as\s+(\w+)/g)) aliases.push(m[1]);
  const names = ['fchdir', 'chdir', 'cd', ...aliases].map((n) => n.replace(/\$/g, '\\$')).join('|');
  const moves = [];
  let here = base;
  for (const m of code.matchAll(new RegExp(`(?<![\\w$])(${names})(?![\\w$])`, 'g'))) {
    const name = m[1];
    const dot = code[m.index - 1] === '.' ? m.index - 1 : -1;
    if (name === 'cd' && !aliases.includes('cd') && (dot < 0 || receiverBefore(text, dot) !== 'FileUtils')) continue;
    const after = code.slice(m.index + name.length, m.index + name.length + 16);
    const call = /^\s*\(/.exec(after);
    // Only Perl and Ruby move with a bare chdir. Elsewhere the word without a
    // call is an import or a reference, and a key (`chdir: x`) is an option
    // of a started program (see spawnFolders).
    if (!call && (!(fam === 'perl' || fam === 'ruby') || name !== 'chdir' || /^\s*(?::(?!:)|=>|=(?!=)|,|\))/.test(after))) continue;
    let dir = UNKNOWN_DIR;
    if (call && name !== 'fchdir') {
      const args = callArgs(text, m.index + name.length + call[0].length - 1);
      if (args[0]) dir = resolveFolder(args[0], here, text);
    }
    here = dir;
    moves.push({ at: m.index, dir });
  }
  return moves;
}

/**
 * The folders a started command runs in: the script's own `folders`, or the
 * one its `cwd` option (Node, Python) or `chdir:` option (Ruby) names
 * (2026-10-01). Options kept in a variable, in a script that sets such an
 * option somewhere, leave the folder unknown.
 */
function spawnFolders(args, code, text, folders) {
  let expr = null;
  let unknown = false;
  args.forEach((a, k) => {
    const s = String(a).trim();
    const kw = /^(?:cwd|chdir)\s*(?:=(?![=>])|:(?!:))\s*([\s\S]+)$/.exec(s);
    if (kw) {
      expr = kw[1];
      return;
    }
    if (s.startsWith('{')) {
      for (const e of callArgs(s, 0)) {
        const t = e.trim();
        const m = /^(?:['"]?(?:cwd|chdir)['"]?|:chdir)\s*(?::|=>)\s*([\s\S]+)$/.exec(t);
        if (m) expr = m[1];
        else if (t === 'cwd') expr = 'cwd';
        else if (t.startsWith('...') || t.startsWith('**')) unknown = true;
      }
      return;
    }
    const lastOption = k > 0 && k === args.length - 1 && /^(?:\*\*|\.\.\.)?[A-Za-z_$][\w$]*$/.test(s);
    if (lastOption && /\b(?:cwd|chdir)\s*(?::(?!:)|=(?![=>])|=>)/.test(code)) unknown = true;
  });
  if (unknown) return [UNKNOWN_DIR];
  // No option, or one set to nothing (`cwd=None`), runs in the script's folder.
  if (expr === null || /^(?:None|null|undefined|nil)$/.test(expr.trim())) return folders;
  return [...new Set(folders.map((f) => resolveFolder(expr, f, text)))];
}

/**
 * Does this text (a string in the script, or a word after it on the command
 * line) hold a call that writes or starts a program? Read by name only, since
 * it is code that may be run later, not code being read now.
 */
function stringWrites(s) {
  for (const c of SCRIPT_WRITE_CALLS) {
    if (c.literalOnly || c.fsLiteral || c.pathReceiver) continue;
    if (s.search(c.re) < 0) continue;
    if (!c.open) return true;
    if (/(['"])(?:[rbtU]*[wax+][rwxabt+U]*|\+?>>?[^'"]*)\1|\bO_(?:WRONLY|RDWR|CREAT|TRUNC|APPEND)\b|\b(?:write|append|create)\s*:\s*true/.test(s)) return true;
  }
  return s.search(SCRIPT_SPAWN_CALLS) >= 0 || s.search(SCRIPT_ARGV_CALLS) >= 0;
}

/**
 * Does the script write anything, start any program, or carry code that
 * does? `calls` are the programs it starts (see spawnCalls).
 */
function scriptWrites(text, written, calls, argv) {
  if (written.dests.length > 0 || written.loose.length > 0 || written.fsLoose.length > 0) return true;
  if (calls.length > 0) return true;
  for (let i = 0; i < text.length; i++) {
    const l = stringLiteralAt(text, i);
    if (!l) continue;
    if (stringWrites(l.text)) return true;
    i = l.end - 1;
  }
  return argv.some(stringWrites);
}

/**
 * Every place the script starts a program: [{ at, args, commands }], with the
 * commands each one runs as far as they can be read. Python's exec() runs
 * Python, and a regular expression's exec() is a match, so neither is one.
 */
function spawnCalls(text, code, prog) {
  const calls = [];
  for (const m of code.matchAll(SCRIPT_SPAWN_CALLS)) {
    if (m[1] === 'exec' && /^python|^py$/.test(prog)) continue;
    // `/re/.exec(text)` is a regular expression, not a process.
    if (m[1] === 'exec' && code[m.index - 1] === '.' && /^(\/|new RegExp)/.test(receiverBefore(text, m.index - 1))) continue;
    const args = callArgs(text, m.index + m[0].length - 1);
    calls.push({ at: m.index, args, commands: spawnedCommands(m[1], args, text, prog, { argv: true }) });
  }
  for (const m of code.matchAll(SCRIPT_ARGV_CALLS)) {
    if (m[1] === 'fork' && prog !== 'node' && prog !== 'deno') continue; // Python's os.fork() starts no program
    const args = callArgs(text, m.index + m[0].length - 1);
    calls.push({ at: m.index, args, commands: argvCallCommands(m[1], args, text, prog) });
  }
  return calls;
}

/**
 * Why a script passed to an interpreter cannot be proven to write only inside
 * the project folder, or null. `argv` are the words after the script on its
 * command line, which the script can read as paths or as code
 * (process.argv, sys.argv). A `$f` in the script is the script's own, never
 * a loop variable of the shell around it (see loopValue).
 */
function inlineScriptRisk(body, prog, root, base, argv = []) {
  const saved = LOOP_VARS;
  LOOP_VARS = null;
  try {
    return scriptWriteRisk(body, prog, root, base, argv);
  } finally {
    LOOP_VARS = saved;
  }
}

/** The reading inlineScriptRisk makes. */
function scriptWriteRisk(body, prog, root, base, argv) {
  const what = `the script passed to \`${prog}\``;
  const fam = scriptFamily(prog);
  const { text, unprovable } = prepareScript(body, fam);
  const code = maskStrings(text);
  // The folders the script can be working in at a point. A relative path is
  // judged from the folder the last move before it left, and also from every
  // folder a later move goes to: unlike a line of shell, a script runs a loop
  // again and calls a function written above the move, so a write written
  // before a chdir can run after it (2026-10-01).
  const moves = folderMoves(text, code, fam, base);
  const foldersAt = (at) => {
    let here = base;
    const later = [];
    for (const mv of moves) {
      if (mv.at < at) here = mv.dir;
      else later.push(mv.dir);
    }
    return [...new Set([here, ...later])];
  };
  const outsideAt = (at) => foldersAt(at).some((f) => checkTarget('.', root, what, f));
  const judge = (target, at) => {
    for (const f of foldersAt(at)) {
      const reason = checkTarget(target.replace(/\\{2,}/g, '\\'), root, what, f);
      if (!reason) continue;
      if (f === base) return reason;
      return `${reason}, after the script moved its working folder to ${f.includes('\u0000') ? 'a folder chosen at run time' : `"${f}"`}`;
    }
    return null;
  };
  const usesHome = SCRIPT_HOME.test(text);
  const written = writeDestinations(text, fam);
  // A save-style call: only a literal name that is absolute, or climbs out of
  // the folder, is read, and a relative one only where the script runs
  // outside the project. Its other arguments are data.
  const literalName = (d, absolute) => {
    const shape = destShape(d.expr, text);
    if (shape.full === undefined) return null;
    if (absolute.test(shape.full) || /^\.\.(?:[\\/]|$)/.test(shape.full)) return shape.full;
    return !/^(?:[\\/~]|[A-Za-z]:)/.test(shape.full) && outsideAt(d.at) ? shape.full : null;
  };
  for (const d of written.loose) {
    const name = literalName(d, /^(?:[A-Za-z]:[\\/]|\/)/);
    const reason = name ? judge(name, d.at) : null;
    if (reason) return reason;
  }
  for (const d of written.fsLoose) {
    const name = literalName(d, FS_ABSOLUTE);
    const reason = name ? judge(name, d.at) : null;
    if (reason) return reason;
  }
  // The first absolute path outside the project the script, or a word after
  // it, names. Worked out once, and only when it is needed. A word after it
  // that is built at run time (`"$HOME/x.txt"`, `$env:USERPROFILE`) counts
  // too (kit fix list, 2026-10-02, T1): the script can write there through
  // process.argv or sys.argv.
  let named;
  const nameOutside = () => {
    if (named === undefined) {
      named = namedOutside(text, root, base)
        ?? argv.find((w) => (FS_ABSOLUTE.test(w) || resolveStatic(w, base.toLowerCase()).dynamic) && checkTarget(w, root, '', base))
        ?? null;
    }
    return named;
  };
  const namedPhrase = () => (resolveStatic(named, base.toLowerCase()).dynamic
    ? `"${named}", a path built at run time`
    : `"${named}", outside the project folder`);
  for (const d of written.dests) {
    if (d.temp) {
      return `${what} makes a file in the system temp folder, which is outside the project folder. Make it under the project's own .tmp/ folder instead`;
    }
    const expr = d.expr ?? '';
    // A number is a mode or a count (Perl's chmod 0755, LIST), never a path.
    if (/^(?:0[xob])?[\d_]+$/i.test(expr.trim())) continue;
    const shape = d.shape ?? writeShape(expr, text);
    if (shape.full !== undefined) {
      const reason = judge(shape.full, d.at);
      if (reason) return reason;
      continue;
    }
    if (shape.prefix) {
      const reason = judge(`${shape.prefix}x`, d.at);
      if (reason) return reason;
      continue;
    }
    if (SCRIPT_HOME.test(expr)) {
      return `${what} writes to a path built from the home, temp or environment folders, which cannot be proven to be inside the project folder`;
    }
    if (usesHome) {
      return `${what} writes to a path built at run time in a script that also uses the home, temp or environment folders, so it cannot be proven to be inside the project folder`;
    }
    if (outsideAt(d.at)) {
      return `${what} writes to a path built at run time while the command runs outside the project folder, so it cannot be proven inside`;
    }
    if (nameOutside()) {
      return `${what} writes to a path built at run time in a script that also names ${namedPhrase()}, so it cannot be proven to be inside the project folder`;
    }
  }
  // Code built at run time, and a write module's method chosen at run time
  // (2026-10-01). Either is refused where a path built at run time would be:
  // the script names a folder outside, uses the home folder, or runs outside.
  // Code built at run time is refused as well when the script writes or
  // starts anything, since that code is very likely what does the writing.
  const calls = spawnCalls(text, code, prog);
  let writes;
  for (const u of unprovable) {
    const why = nameOutside() ? `it also names ${namedPhrase()}`
      : usesHome ? 'it also uses the home, temp or environment folders'
        : outsideAt(u.at) ? 'it runs outside the project folder'
          : null;
    if (u.kind === 'eval') {
      if (why === null && writes === undefined) writes = scriptWrites(text, written, calls, argv);
      const because = why ?? (writes ? 'it also writes files or starts programs' : null);
      if (because) {
        return `${what} runs code it builds at run time (${u.name}), which cannot be proven to write only inside the project folder, and ${because}`;
      }
    } else if (why) {
      return `${what} calls a method of \`${u.receiver}\` chosen at run time, which cannot be proven to write only inside the project folder, and ${why}`;
    }
  }
  // Every program the script starts, read like a command typed at the prompt
  // in the folder it starts in.
  for (const call of calls) {
    const folders = spawnFolders(call.args, code, text, foldersAt(call.at));
    for (const { text: command, shell } of call.commands) {
      for (const folder of folders) {
        if (inlineDepth >= MAX_DEPTH) return null;
        inlineDepth++;
        let reason;
        try {
          if (INLINE_SCRIPT[shell]) {
            reason = inlineScriptRisk(command, shell, root, folder);
          } else if (shell === 'powershell') {
            reason = analyze(command, 'powershell', root, 0, folder);
          } else {
            // cmd.exe, the shell these calls get on Windows, has no single
            // quotes, no backslash escapes and no $ variables: read it that way.
            const asRead = shell === 'cmd' ? command.replace(/['$`]/g, (c) => CMD_PLAIN[c]).replace(/\\/g, '/') : command;
            reason = analyze(asRead, 'bash', root, 0, folder);
          }
        } finally {
          inlineDepth--;
        }
        if (reason) return INLINE_SCRIPT[shell] ? reason : `inside ${what}, ${reason.replace(/[ʼ＄ˋ]/g, (c) => CMD_BACK[c])}`;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Inline scripts: a path outside the project is named only to be read
// ---------------------------------------------------------------------------
//
// Until 2026-10-01 every absolute path literal in a one-line inline script was
// checked like the target of a write, so a script that only READ a file
// outside the project was refused. The same day that scan was dropped and the
// reading of a script's writes was left to judge one-line scripts alone, and a
// review found 31 one-line writes it let through, each spelled in a way that
// reading does not know (`fs.writeFileSync.call`, `__import__('os').remove`,
// Perl's `qx`, a mode kept in a variable). So the scan came back for one-line
// scripts, and a script that names a path outside the project passes it only
// when it is provably a read (see whyNotARead).
//
// The kit fix list of 2026-10-02 (T1) found the same writes passing in a
// script written over several lines, which was judged by its writes alone.
// The owner's call: a script of any length follows this rule, and he accepts
// that some harmless multi-line scripts that read outside and write inside
// are refused. Round two of that list (R9) narrowed it for multi-line scripts
// to paths that name a folder on this computer, unless the script builds a
// path to write to, so a web route like '/projects/' in a script that reads
// and writes only inside passes (see outsidePathRisk).

/**
 * Why a script handed to an interpreter cannot be proven to write only inside
 * the project folder, by where it writes or by a path outside it names, or
 * null. Every reading of an inline script, a here-document script and a
 * piped one goes through here.
 */
function scriptRisk(body, prog, root, base, argv = []) {
  return inlineScriptRisk(body, prog, root, base, argv) ?? outsidePathRisk(body, prog, root, base, argv);
}

/**
 * Absolute-looking path literals in an inline script, found the way the scan
 * before 2026-10-01 found them: every quoted text on one line that starts
 * with a drive or a slash. `at` is its opening quote and `end` is just past
 * its closing one.
 *
 * The quantifier must have no minimum: with `{3,}` the engine skipped the
 * short literal `'fs'` and then paired the WRONG quotes, the closing one of
 * `'fs'` with the opening one of the path, so the path was never seen (caught
 * by the test, 2026-08-02).
 */
function scriptLiterals(text) {
  return [...String(text).matchAll(/(['"])([^'"\n]+)\1/g)]
    .filter((m) => /^([A-Za-z]:[\\/]|\/)/.test(m[2]))
    .map((m) => ({ text: m[2], at: m.index, end: m.index + m[0].length }));
}

// The names a script naming a path outside must not hold anywhere, its
// strings included, to pass as a read (2026-10-01): each writes, starts a
// program or runs code this guard cannot read. Case does not matter. The
// first list is found anywhere in a word (`writeFileSync`, `createWriteStream`
// and `os.unlink` each hold one), the second only as a whole word or a call,
// where a longer word is harmless (`literal_eval`, `System32`). The lists err
// wide on purpose: a read refused costs one retry, and a write let through is
// what this guard exists to stop.
const NOT_A_READ_PART = /write|append|unlink|remove|rmtree|rmdir|rm_rf|rmsync|mkdir|makedirs|rename|copy|move|link|chmod|chown|truncate|utime|fileio|os\.open|exec|spawn|fork|popen|__import__|getattr|importlib|subprocess|child_process|shutil|sqlite|tempfile|set-content|out-file|new-item|remove-item|copy-item|move-item|rename-item|add-content|start-process|invoke-expression/i;
const NOT_A_READ_WORD = /\b(?:system|eval|function|reflect|qx|iex)\b|\.\s*(?:call|apply|bind)\s*\(|%x\s*[^\w\s]/i;
// More of the same kind, looked for in the script's code only, since a folder
// can carry one of these words in its name: a temporary file, a pipe, a device
// node or a key-value store made; a file opened by a system call or sent to
// another; code run from a file or a binding; a module, function or method
// reached by a name; a stream sent somewhere else; and a file deleted or
// touched by a short name; Ruby's FileUtils, Perl's tie to a database file
// and Deno.run, which exist to write or to start a program.
const NOT_A_READ_CODE = /mkdtemp|maketemp|mknod|mkfifo|sysopen|syscall|dbmopen|openkv|startfile|sendfile|chflags|setxattr|__dict__|builtins|ctypes|winreg|const_get|instance_eval|class_eval|module_eval|define_method|alias_method|runin\w*context|compilefunction|dlopen|binding|core::global|file::temp|fileutils|deno\.run\b|\b(?:rm|cp|cpsync|delete|touch|send|__send__|public_send|constructor|prototype|globalthis|vm|worker|command|breakpoint|vars|globals|locals|reopen|chroot|alias|refine|method_missing|tie)\b/i;
// Shapes that do the same in one language, each a way to reach a function by
// a name built at run time or to run code the rest of this check cannot see.
// Perl: a command in backticks, code and glob references, a method or a code
// reference called through a variable, `can`, the symbol table, the in-place
// edit switch, `do FILE`, code inside a pattern and a substitution run as
// code (`s/x/.../e`). Ruby: backticks, `method(...)` and its `.()` call,
// `methods`, `bind_call`, `to_proc` and ObjectSpace. Python: every name of a
// module at once (`from os import *`), the double-underscore names that reach
// any object's members, and operator's attrgetter and methodcaller.
// JavaScript: a module loaded by a value (`import(x)`), the double-underscore
// names, and Object's calls that hand out a module's functions or replace them.
const NOT_A_READ_SHAPES = {
  perl: /`|&\s*[{$]|->\s*[$&(]|\bcan\s*\(|\*\s*\{|::\s*\{|%(?:main)?::|\$\^I|\bdo\s+["'$]|\(\?\??\{|\bs\s*([^\w\s{(\[<])(?:\\.|(?!\1)[^\\\n])*\1(?:\\.|(?!\1)[^\\\n])*\1[a-z]*e|\bs\s*[{(\[<][^})\]>]*[})\]>]\s*[{(\[<][^})\]>]*[})\]>][a-z]*e/,
  ruby: /`|\b(?:public_|instance_|singleton_)?methods?\s*[(\b]|\.\s*\(|\bbind_call\b|\bto_proc\b|\bObjectSpace\b/,
  py: /\bfrom\s+[\w.]+\s+import\s+\*|__(?!name__|file__|main__|doc__)\w+__|\b(?:attrgetter|methodcaller)\b/,
  js: /\bimport\s*\(|__\w+__|\bObject\s*\.\s*(?:values|entries|getOwnProperty\w*|defineProperty|defineProperties|assign|setPrototypeOf|getPrototypeOf|fromEntries)\b/,
};
// The modules such a script may load and still pass as a read. Each one
// writes only through calls the rest of this check refuses; a module not
// listed (a third-party library, a database, a process pool) may write by a
// name this guard has never heard of.
const READ_SAFE_MODULES = {
  js: /^(?:node:)?(?:fs|fs\/promises|path|path\/posix|path\/win32|os|url|util|crypto|buffer|assert|events|string_decoder|querystring|readline|zlib|timers|perf_hooks)$/,
  py: /^(?:os|sys|json|glob|pathlib|re|csv|hashlib|hmac|ast|datetime|time|calendar|collections|itertools|functools|operator|math|statistics|string|textwrap|pprint|base64|binascii|struct|codecs|io|unicodedata|platform|locale|fnmatch|stat|difflib|enum|typing|dataclasses|decimal|fractions|random|uuid|html|xml|mimetypes|filecmp|zipfile|tarfile|gzip|bz2|lzma|zlib|pickle|shlex|heapq|bisect|array|tomllib|configparser|getpass|keyword|numbers|secrets|warnings|contextlib|urllib)$/,
  perl: /^(?:strict|warnings|utf8|feature|open|constant|File::Basename|File::Spec(?:::Functions)?|Cwd|Data::Dumper|JSON::PP|List::Util|Scalar::Util|Encode|Time::Local|Time::HiRes|Digest::MD5|Digest::SHA|MIME::Base64|Getopt::Long|Text::Wrap|v?[\d._]+)$/,
  ruby: /^(?:json|set|pp|digest(?:\/\w+)?|time|date|csv|yaml|psych|English|shellwords|securerandom|base64|zlib|stringio|ostruct|optparse|find)$/,
};
// What `from os import ...` may bring in by name: the path helpers and the
// calls that only read. Anything else from os is a write by a short name.
const PY_OS_READ_NAMES = /^(?:path|sep|linesep|pathsep|curdir|pardir|name|environ|getenv|getcwd|listdir|walk|scandir|stat|lstat|fspath)$/;
// The calls a path outside the project may be the path argument of, per
// language, by what sits just before the path's opening quote: each one reads
// and nothing else. The name must be the call's own, not the end of a longer one.
const READ_CALL_BEFORE = {
  js: /(?:^|[^\w$])(readFileSync|readFile|existsSync|statSync|lstatSync|readdirSync|accessSync|createReadStream|readTextFileSync|readDirSync)\s*\(\s*$/,
  py: /(?:^|[^\w.])(open|os\.listdir|os\.path\.(?:exists|isfile|isdir|getsize)|glob\.glob|(?:pathlib\.)?(?:Pure)?(?:Windows|Posix)?Path)\s*\(\s*([rRbBuU]{0,2})$/,
  perl: /(?:^|[^\w$@%&])(open)\s*\(\s*(?:(?:my|our|local)\s+)?[$*]?\w+\s*,\s*(['"])<(?::[^'"]*)?\2\s*,\s*$/,
  ruby: /(?:^|[^\w:.])(File\.(?:read|readlines|exist\?|file\?|directory\?)|IO\.readlines|Dir\.(?:glob|entries|children))(\s*\(\s*|\s+)$/,
};
// The read calls by their bare names, for hiddenSpelling's check that none of
// them is given another meaning.
const READ_CALL_NAMES = {
  js: 'readFileSync|readFile|existsSync|statSync|lstatSync|readdirSync|accessSync|createReadStream|readTextFileSync|readDirSync',
  py: 'open|listdir|exists|isfile|isdir|getsize|glob|(?:Pure)?(?:Windows|Posix)?Path|read_text|read_bytes|is_file|is_dir|iterdir|stat',
  perl: 'open',
  ruby: 'read|readlines|exist\\?|file\\?|directory\\?|glob|entries|children',
};
// The methods a `Path(...)` built from a path outside may be read with.
const PATH_READ_METHOD = /^\s*\.\s*(?:read_text|read_bytes|exists|is_file|is_dir|iterdir|stat)\s*\(/;
// Modes that only read. tarfile spells a compressed one `r:gz`.
const PY_READ_MODE = /^(?:r[bt]?|[bt]r|r[:|][\w*]*)$/;
const RUBY_READ_MODE = /^r[bt]?(?::[\w|-]+)*$/;
const JS_ENCODING = /^(?:utf-?8|utf-?16le|ucs-?2|latin1|binary|base64(?:url)?|hex|ascii)$/i;
// Python modules whose open() takes the path first and the mode second.
const PY_OPEN_MODULE = /^(?:io|codecs|tarfile|gzip|bz2|lzma|zipfile|dbm(?:\.\w+)?|shelve|wave|aifc|sunau|urllib\.request|request)$/;

/** The text of the string literal that is the whole of `expr`, or null. */
function wholeLiteral(expr) {
  const e = String(expr ?? '').trim();
  const l = stringLiteralAt(e, 0);
  return l && l.end === e.length && l.prefix === null ? l.text : null;
}

/**
 * Is this options object one that only reads? `{ encoding: 'utf8' }`,
 * `{ flag: 'r' }`, `{ read: true }`. A spread, a computed key or a `flag`
 * given by a variable (`{ flag }`, `{ flag: f }`) can each be a write.
 */
function readOptions(s) {
  if (writeModeIn([s]) || /\.\.\.|\[/.test(s)) return false;
  for (const m of s.matchAll(/\bflags?\b/g)) {
    if (!/^\s*:\s*(['"`])(?:r|rs|sr)\1/.test(s.slice(m.index + m[0].length))) return false;
  }
  return true;
}

/**
 * Python open() arguments after the path (or every argument, for a method):
 * the mode, if given, only reads. The seventh one after the mode, or an
 * `opener=`, is a function that opens the file itself, so it is refused.
 */
function pyOpenArgs(args) {
  let positional = 0;
  for (const a of args.filter((x) => x !== '')) {
    const kw = /^(\w+)\s*=(?!=)\s*([\s\S]*)$/.exec(a);
    if (kw) {
      if (/^(?:mode|flag|flags)$/.test(kw[1]) && !PY_READ_MODE.test(wholeLiteral(kw[2]) ?? '')) return false;
      if (kw[1] === 'opener') return false;
      continue;
    }
    if (positional === 0 && !PY_READ_MODE.test(wholeLiteral(a) ?? '')) return false;
    if (positional > 5) return false;
    positional++;
  }
  return true;
}

/** Ruby open arguments after the path: a mode, if given, only reads, and no flags are passed. */
function rubyOpenArgs(args) {
  let positional = 0;
  for (const a of args.filter((x) => x !== '')) {
    const kw = /^:?(\w+)(?::(?!:)\s*|\s*=>\s*)([\s\S]+)$/.exec(a);
    if (kw) {
      if (kw[1] === 'mode' && !RUBY_READ_MODE.test(wholeLiteral(kw[2]) ?? '')) return false;
      if (/^(?:flags|open_args)$/.test(kw[1])) return false;
      continue;
    }
    if (positional === 0 && !RUBY_READ_MODE.test(wholeLiteral(a) ?? '')) return false;
    positional++;
  }
  return true;
}

/** Perl open arguments: a three-argument open with a `<` mode, or a two-argument one whose literal only reads. */
function perlOpenArgs(args) {
  if (args.length === 3) return /^<(?::\S*)?$/.test(wholeLiteral(args[1]) ?? '');
  if (args.length !== 2) return false;
  const t = wholeLiteral(args[1]);
  if (t === null || t.includes('|')) return false;
  const s = t.trim();
  return s.startsWith('<') || (!/[$@]/.test(s) && !/^[>+&-]/.test(s));
}

/**
 * Does every call in the script that opens a file open it only to read? A
 * mode kept in a variable, a numeric flag or an options object that writes
 * all count against it, as does Ruby's Kernel#open (and IO.read) of a path
 * that is not a literal, which may be a `|command`. So does an open function
 * named without being called (`o = open`, `from io import open as o`,
 * `File.method(:open)`, `*CORE::open`): what it is later called with is not
 * read here.
 */
function opensOnlyToRead(text, code, fam) {
  const re = { js: /\b\w*open(?:Sync)?\s*\(/g, py: /\b\w*(?:open|File)\s*\(/g, ruby: /\b(?:open|new|read|readlines|foreach|binread)\s*\(/g, perl: /\bopen\s*\(/g }[fam];
  const named = { js: /\b\w*open(?:Sync)?\b(?!\s*\()/, py: /\b\w*(?:open|File)\b(?!\s*\()/, ruby: /\bopen\b(?!\s*\()/, perl: /\bopen\b(?!\s*\()/ }[fam];
  if (!re || named.test(code)) return false;
  for (const m of code.matchAll(re)) {
    const at = m.index;
    if (/[$@%&]/.test(code[at - 1] ?? '')) continue; // a Perl or Ruby variable called open
    const word = m[0].replace(/\s*\($/, '');
    const args = callArgs(text, at + m[0].length - 1);
    const dot = code[at - 1] === '.' ? at - 1 : -1;
    const receiver = dot >= 0 ? receiverBefore(text, dot) : '';
    if (fam === 'js') {
      const flags = (args[1] ?? '').trim();
      const ok = flags === '' || /^(?:r|rs|sr)$/.test(wholeLiteral(flags) ?? '')
        || (flags.startsWith('{') && readOptions(flags)) || /^(?:\([^()]*\)|[\w$]+)\s*=>/.test(flags);
      if (!ok) return false;
    } else if (fam === 'py') {
      const moduleForm = dot < 0 || word.endsWith('File') || PY_OPEN_MODULE.test(receiver);
      if (!pyOpenArgs(moduleForm ? args.slice(1) : args)) return false;
    } else if (fam === 'perl') {
      if (!perlOpenArgs(args)) return false;
    } else if (word === 'new') {
      if (/^(?:::)?(?:File|IO)$/.test(receiver) && !rubyOpenArgs(args.slice(1))) return false;
    } else if (word === 'open') {
      if (/^(?:|Kernel|URI)$/.test(receiver) && wholeLiteral(args[0]) === null) return false;
      if (!rubyOpenArgs(args.slice(1))) return false;
    } else if (/^(?:::)?IO$/.test(receiver) && wholeLiteral(args[0]) === null) {
      return false;
    }
  }
  return true;
}

/** Is the path literal `lit` the path argument of one of READ_CALL_BEFORE's calls, with nothing in the call that could write? */
function readCallHolds(text, lit, fam) {
  const before = text.slice(0, lit.at);
  const m = READ_CALL_BEFORE[fam]?.exec(before);
  if (!m) return false;
  const name = m[1];
  if (fam === 'ruby' && !m[2].includes('(')) {
    // Written without parentheses, the path must be the call's only argument.
    return /^\s*(?:$|[;)}\]]|(?:if|unless|or|and|do|then|end)\b)/.test(text.slice(lit.end));
  }
  // The call's own parenthesis, the first one after its name: a Perl mode
  // such as "<:encoding(UTF-8)" holds one of its own.
  const open = m.index + m[0].indexOf('(', m[0].indexOf(name) + name.length);
  const args = callArgs(text, open);
  const k = fam === 'perl' ? 2 : 0;
  if (args[k] !== `${fam === 'py' ? m[2] : ''}${text.slice(lit.at, lit.end)}`) return false;
  const rest = args.slice(k + 1).filter((a) => a !== '');
  if (fam === 'perl') return rest.length === 0;
  if (fam === 'js') {
    return rest.every((a) => {
      const l = wholeLiteral(a);
      if (l !== null) return JS_ENCODING.test(l);
      const flat = a.replace(/require\(\s*(['"])[\w:/]+\1\s*\)/g, 'm');
      return /^(?:null|undefined)$/.test(a) || /^[\w$.]*\b[RWXF]_OK(?:\s*\|\s*[\w$.]*\b[RWXF]_OK)*$/.test(flat)
        || (a.startsWith('{') && readOptions(a)) || /^(?:\([^()]*\)|[\w$]+)\s*=>/.test(a);
    });
  }
  if (fam === 'ruby') {
    return rest.every((a) => /^(?:\d+|File::FNM_\w+(?:\s*\|\s*File::FNM_\w+)*)$/.test(a)
      || (/^:?(?:encoding|chomp|base|sort|mode)(?::(?!:)|\s*=>)/.test(a) && rubyOpenArgs([a])));
  }
  if (name === 'open') return pyOpenArgs(rest);
  if (name === 'glob.glob') return rest.every((a) => /^(?:recursive|root_dir|include_hidden)\s*=(?!=)/.test(a));
  if (/Path$/.test(name)) return rest.length === 0 && PATH_READ_METHOD.test(text.slice(args.end));
  return rest.length === 0;
}

/** The first module the script loads that READ_SAFE_MODULES does not list, as a phrase, or null. */
function foreignModule(text, code, fam) {
  const safe = READ_SAFE_MODULES[fam];
  if (fam === 'js') {
    for (const m of code.matchAll(/\brequire\b/g)) {
      const paren = /^\s*\(/.exec(code.slice(m.index + 7));
      if (!paren) return '`require` by a value';
      const args = callArgs(text, m.index + 7 + paren[0].length - 1);
      const mod = args.length === 1 ? wholeLiteral(args[0]) : null;
      if (mod === null || !safe.test(mod)) return `\`${mod ?? args.join(', ')}\``;
    }
    for (const m of code.matchAll(/\bimport\b/g)) {
      const after = text.slice(m.index);
      if (/^import\s*\.\s*meta\b/.test(after)) continue;
      const stmt = /^import\s+(?:[\w$*{},\s]+?\s+from\s*)?(['"])([^'"]+)\1/.exec(after);
      if (!stmt || !safe.test(stmt[2])) return stmt ? `\`${stmt[2]}\`` : 'a module in a way this guard does not read';
    }
  } else if (fam === 'py') {
    for (const m of code.matchAll(/\bimport\b/g)) {
      const start = Math.max(code.lastIndexOf(';', m.index), code.lastIndexOf('\n', m.index)) + 1;
      const stop = code.slice(m.index).search(/[;\n]/);
      const stmt = text.slice(start, stop < 0 ? text.length : m.index + stop).trim();
      const from = /^from\s+([\w.]+)\s+import\s+([\s\S]+)$/.exec(stmt);
      const plain = /^import\s+([\s\S]+)$/.exec(stmt);
      if (from) {
        if (!safe.test(from[1].split('.')[0])) return `\`${from[1]}\``;
        if (from[1] !== 'os') continue;
        for (const item of from[2].replace(/[()]/g, '').split(',')) {
          const n = item.trim().split(/\s+/)[0];
          if (!PY_OS_READ_NAMES.test(n)) return `\`${n}\` from os`;
        }
      } else if (plain) {
        for (const item of plain[1].split(',')) {
          const [mod, as, alias] = item.trim().split(/\s+/);
          if (!safe.test(mod.split('.')[0])) return `\`${mod}\``;
          if (as === 'as' && alias && /^(?:os|pathlib)$/.test(mod)) return `\`${mod}\` under another name`;
        }
      } else {
        return 'a module in a way this guard does not read';
      }
    }
  } else if (fam === 'perl') {
    for (const m of code.matchAll(/(?:^|[^\w$@%&>:])(?:use|no|require)\b\s*([^;\s(]*)/g)) {
      if (!safe.test(m[1])) return `\`${m[1] || 'a file'}\``;
    }
  } else if (fam === 'ruby') {
    for (const m of code.matchAll(/(?:^|[^\w.:])(require|require_relative|load|autoload)\b/g)) {
      if (m[1] !== 'require') return `\`${m[1]}\``;
      const r = /^\s*\(?\s*(['"])([^'"]+)\1/.exec(text.slice(m.index + m[0].length));
      if (!r || !safe.test(r[2])) return r ? `\`${r[2]}\`` : 'a library by a value';
    }
  }
  return null;
}

/**
 * A spelling that hides what runs, as a phrase, or null: code inside a string
 * (a template's `${...}`, a Python f-string, Ruby's `#{...}`, Perl's `@{...}`
 * and `${...}`), which every reading of the code here leaves out with the
 * string; a read call given another meaning (assigned, defined, used as a key
 * or an alias, or named in a string); a JavaScript member reached by a key
 * that is not a plain number; a Python replace() that can be pathlib's move;
 * and a Perl or Ruby string that opens a command through a pipe.
 */
function hiddenSpelling(text, code, fam) {
  if ((fam === 'ruby' && /#\{/.test(text)) || (fam === 'perl' && /[@$]\{/.test(text))) return 'it runs code inside a string';
  const names = READ_CALL_NAMES[fam];
  const redefined = new RegExp(`(?:^|[^\\w$])(?:${names})\\s*(?:=(?![=>~])|:(?!:))|\\b(?:def|function|sub|class|let|const|var|get|set|static|async|as)\\s+(?:[\\w:]+\\.)?(?:${names})(?![\\w?])|:\\s*(?:${names})(?![\\w$?(])`);
  const re = redefined.exec(code);
  if (re) return `it gives a read call another meaning (\`${re[0].trim()}\`)`;
  const exact = new RegExp(`^(?:${names})$`);
  for (let i = 0; i < text.length; i++) {
    const l = stringLiteralAt(text, i);
    if (!l) continue;
    i = l.end - 1;
    if (l.prefix !== null) return 'it runs code inside a string';
    if (exact.test(l.text)) return `it names the read call \`${l.text}\` in a string`;
    const t = l.text.trim();
    if ((fam === 'perl' || fam === 'ruby') && (t.startsWith('|') || t.endsWith('|'))) return 'it opens a command through a pipe';
  }
  if (fam === 'js') {
    for (let i = 1; i < code.length; i++) {
      if (code[i] !== '[' || !/[\w$)\]]/.test(code[i - 1])) continue;
      const close = closingBracket(code, i);
      if (close < 0 || !/^\s*\d+\s*$/.test(code.slice(i + 1, close))) return 'it reaches a member by a key that is not a plain number';
    }
  }
  if (fam === 'py') {
    for (const m of code.matchAll(/\.\s*replace\s*\(/g)) {
      // A string's replace() takes two arguments; pathlib's, a move, takes one.
      if (callArgs(text, m.index + m[0].length - 1).filter((a) => a !== '').length < 2) return 'it calls a replace() that can move a file';
    }
  }
  return null;
}

/**
 * The path literals in a script that name a place outside the project; with
 * `onlyFolders`, only the ones shaped like a folder on this computer
 * (FS_ABSOLUTE). See outsidePathRisk for when that applies.
 */
function outsideLiterals(text, onlyFolders, root, base, what = '') {
  return scriptLiterals(text).filter((l) => (!onlyFolders || FS_ABSOLUTE.test(l.text)) && checkTarget(l.text, root, what, base));
}

/**
 * Does a script write to a path it builds at run time, or run code it
 * builds? Then a literal shaped like a web route can be the end of that path
 * (`process.env.OneDrive + '/x.txt'`), not a route.
 */
function buildsWritePath(body, prog) {
  const fam = scriptFamily(prog);
  const { text, unprovable } = prepareScript(body, fam);
  if (unprovable.length > 0) return true;
  return writeDestinations(text, fam).dests.some((d) => {
    const expr = d.expr ?? '';
    // A number is a mode or a count, as in the reading of writes.
    if (d.temp || /^(?:0[xob])?[\d_]+$/i.test(expr.trim())) return false;
    const shape = d.shape ?? writeShape(expr, text);
    return shape.full === undefined && !shape.prefix;
  });
}

/**
 * Why a script that names the paths `outside` (outside the project) is not
 * provably a read, as { lit, why }, or null when it is one: every such
 * path is the path argument of a known read call (READ_CALL_BEFORE), and the
 * script holds nothing that could write. "Nothing that could write" is read
 * wide: no name from the NOT_A_READ lists, no module outside
 * READ_SAFE_MODULES, no write, program or run-time code that the reading of
 * writes finds (its own functions, asked here only whether they find anything
 * at all, wherever it lands), no hidden spelling, and no file opened in a mode
 * that is not a plain read.
 */
function whyNotARead(body, prog, root, base, argv, outside, onlyFolders) {
  const fam = scriptFamily(prog);
  const no = (why, lit = outside[0].text) => ({ lit, why });
  if (!READ_CALL_BEFORE[fam]) return no('a script in this language is never read as one that only reads');
  const word = NOT_A_READ_PART.exec(body) ?? NOT_A_READ_WORD.exec(body);
  if (word) return no(`it also holds \`${word[0].trim()}\`, which can write, start a program or run code`);
  const { text, unprovable } = prepareScript(body, fam);
  const code = maskStrings(text);
  const more = NOT_A_READ_CODE.exec(code) ?? NOT_A_READ_SHAPES[fam]?.exec(code);
  // Quoted from the script itself: the copy searched has its strings blanked.
  if (more) return no(`it also holds \`${text.slice(more.index, more.index + more[0].length).trim().slice(0, 40)}\`, which can write, start a program or run code`);
  const module = foreignModule(text, code, fam);
  if (module) return no(`it loads ${module}, which this guard does not know to be read-only`);
  if (unprovable.length > 0 || scriptWrites(text, writeDestinations(text, fam), spawnCalls(text, code, prog), argv)) {
    return no('it also writes files, starts a program or runs code built at run time');
  }
  const hidden = hiddenSpelling(text, code, fam);
  if (hidden) return no(hidden);
  if (!opensOnlyToRead(text, code, fam)) return no('it opens a file in a way that is not a plain read');
  const lits = outsideLiterals(text, onlyFolders, root, base);
  const missing = outside.find((o) => !lits.some((l) => l.text === o.text));
  if (missing) return no('that path is not the path of a plain read call', missing.text);
  const loose = lits.find((l) => !readCallHolds(text, l, fam));
  if (loose) return no('that path is not the path of a plain read call', loose.text);
  return null;
}

/**
 * Why an inline script naming a path outside the project is refused, or
 * null. The paths are the ones scriptLiterals finds; a script naming none, or
 * one that is provably a read (whyNotARead), passes. The reason names the
 * path, as the scan before 2026-10-01 did, and says what kept the script from
 * passing as a read. A script's own `$f` is never a loop variable of the
 * shell around it (see loopValue).
 *
 * In a script written over several lines, a literal that is not shaped like
 * a folder on this computer (FS_ABSOLUTE) counts only when the script writes
 * to a path it builds at run time (kit fix list round two, 2026-10-02, R9).
 * A web route such as '/projects/' names no folder, and a check over the
 * built pages in dist/ that held one was refused although it read and wrote
 * only inside. Where a path is built, `process.env.OneDrive + '/x.txt'`, the
 * same literal can end a path outside, and it is read as one. A one-line
 * script keeps the rule it has followed since 2026-10-01: every
 * absolute-looking literal counts.
 */
function outsidePathRisk(body, prog, root, base, argv) {
  const saved = LOOP_VARS;
  LOOP_VARS = null;
  try {
    const what = `the script passed to \`${prog}\``;
    const named = outsideLiterals(body, false, root, base, what);
    const onlyFolders = body.includes('\n') && named.some((l) => !FS_ABSOLUTE.test(l.text)) && !buildsWritePath(body, prog);
    const outside = onlyFolders ? named.filter((l) => FS_ABSOLUTE.test(l.text)) : named;
    if (outside.length === 0) return null;
    const blocked = whyNotARead(body, prog, root, base, argv, outside, onlyFolders);
    if (!blocked) return null;
    const where = resolveStatic(blocked.lit, base.toLowerCase()).dynamic
      ? 'which cannot be proven to be inside the project folder'
      : `which is outside the project folder (${root})`;
    return `${what} names "${blocked.lit}", ${where}, and ${blocked.why}. An inline script may name a path outside the project only as the path of a plain read call (readFileSync, open(path), os.listdir, File.read and the like), in a script with nothing else in it that could write`;
  } finally {
    LOOP_VARS = saved;
  }
}

/**
 * Every value a flag from `spec` is given (see BASH_FLAG_TARGETS): `--name=V`,
 * `--name V`, and a single-dash cluster holding one of the letters before any
 * letter that takes a value of its own; its value is the rest of the word, or
 * the next word when the letter comes last.
 */
function flagValues(words, spec) {
  const out = [];
  for (let k = 0; k < words.length; k++) {
    const t = words[k];
    // Not isWord: a glued value may hold a space (`-o"C:/My Docs/x.zip"`).
    if (t.redirect || (k > 0 && words[k - 1].redirect) || t.text === '') continue;
    const next = words[k + 1] && !words[k + 1].redirect ? words[k + 1] : null;
    const long = /^--([^=]+)(?:=(.*))?$/.exec(t.text);
    if (long) {
      if (!spec.long.includes(long[1])) continue;
      if (long[2] !== undefined) out.push(long[2]);
      else if (next) { out.push(next.text); k++; }
      continue;
    }
    if (!/^-[^-]/.test(t.text)) continue;
    let at = -1;
    for (let i = 1; i < t.text.length && at < 0; i++) {
      const c = t.text[i];
      if (spec.letters.includes(c)) at = i;
      else if (spec.stops.includes(c) || !/[A-Za-z0-9]/.test(c)) break;
    }
    if (at < 0) continue;
    const glued = t.text.slice(at + 1);
    if (glued) out.push(glued);
    else if (next) { out.push(next.text); k++; }
  }
  return out;
}

/** Is the character at `i` of this token a plain, unquoted `c`? */
const unquotedAt = (t, i, c) => i >= 0 && t.text[i] === c && !(t.lit && t.lit[i]);

/**
 * One PowerShell argument that is a comma list (review 2026-09-25): `a,b`,
 * `a, b` and `a ,b` are one array of two paths, and each is judged on its own.
 * Read whole, a list that began inside the project hid the paths after it.
 * Starts at `first`, the word at index `k` of `words` (or a stand-in for a
 * glued `-Param:value`), and returns every item, split at unquoted commas,
 * plus the index of the last word the list used.
 */
function psList(first, words, k) {
  const values = [];
  let t = first;
  for (;;) {
    let cur = '';
    for (let i = 0; i < t.text.length; i++) {
      if (unquotedAt(t, i, ',')) { if (cur) values.push(cur); cur = ''; continue; }
      cur += t.text[i];
    }
    if (cur) values.push(cur);
    const next = words[k + 1];
    if (!next || next.redirect || next.text === '') break;
    if (!unquotedAt(t, t.text.length - 1, ',') && !unquotedAt(next, 0, ',')) break;
    t = next;
    k++;
  }
  return { values, end: k };
}

/**
 * How sed or perl is told to edit (kit fix list, 2026-10-02, T138): whether it
 * edits in place, whether `-e` or `-f` gave the script, and the words that
 * are files. The value of `-e`, `--expression`, `-f` and `--file` is the
 * script, never a file it writes: read as a file, the install's own
 * placeholder step (`sed -i -e 's/<double-braced name>/Rotem/g' CLAUDE.md`)
 * was refused as a path built at run time. In a cluster, `i` takes the rest
 * of the word as its backup suffix (`-ie` keeps a copy ending in e), and
 * perl's -I, -M, -m, -F, -x, -C, -d and -D take the rest of the word as their
 * value.
 */
function editorWords(prog, rest) {
  let inPlace = false;
  let scripted = false;
  const words = [];
  for (let k = 0; k < rest.length; k++) {
    const t = rest[k];
    if (t.redirect) { k++; continue; }
    if (t.text === '') continue;
    if (t.text === '--') {
      for (const u of rest.slice(k + 1)) if (!u.redirect && u.text) words.push(u.text);
      break;
    }
    const long = /^--([\w-]+)(=[\s\S]*)?$/.exec(t.text);
    if (long) {
      if (long[1] === 'in-place') inPlace = true;
      if (long[1] === 'expression' || long[1] === 'file') scripted = true;
      if (/^(?:expression|file|line-length)$/.test(long[1]) && long[2] === undefined) k++;
      continue;
    }
    if (!/^-./.test(t.text) || (t.lit && t.lit[0])) { words.push(t.text); continue; }
    for (let i = 1; i < t.text.length; i++) {
      const c = t.text[i];
      if (c === 'i') { inPlace = true; break; }
      const script = prog === 'perl' ? c === 'e' || c === 'E' : c === 'e' || c === 'f';
      if (script || (prog === 'sed' && c === 'l')) {
        if (script) scripted = true;
        if (i === t.text.length - 1) k++; // the value is the next word
        break;
      }
      if (prog === 'perl' && /[IMmFxCdD]/.test(c)) break;
    }
  }
  return { inPlace, scripted, words };
}

// git subcommands that only read the repository they run in (kit fix list,
// 2026-10-02, T18). archive and format-patch read it too; where they write
// is checked on its own.
const GIT_READS = new Set([
  'status', 'log', 'diff', 'show', 'rev-parse', 'ls-files', 'ls-tree', 'ls-remote', 'blame', 'annotate',
  'grep', 'describe', 'rev-list', 'shortlog', 'cat-file', 'for-each-ref', 'show-ref', 'name-rev',
  'merge-base', 'diff-tree', 'diff-files', 'diff-index', 'whatchanged', 'count-objects', 'var', 'help',
  'version', 'check-ignore', 'check-attr', 'check-ref-format', 'check-mailmap', 'verify-commit',
  'verify-tag', 'verify-pack', 'cherry', 'range-diff', 'show-branch', 'difftool', 'get-tar-commit-id',
  'request-pull', 'archive', 'format-patch',
]);

/**
 * Does this git subcommand change files or history in the repository it runs
 * in? `args` are its other words, lower-cased, and `flags` its flags. clone
 * and init make a repository of their own and are checked by where it lands.
 * A subcommand this does not know counts as one that changes.
 */
function gitChanges(sub, args, flags) {
  if (sub === 'clone' || sub === 'init') return false;
  if (GIT_READS.has(sub)) return false;
  const first = args[0] ?? '';
  const has = (re) => flags.some((f) => re.test(f));
  const dryRun = /^(?:-[a-z]*n[a-z]*|--dry-run)$/;
  switch (sub) {
    case 'branch':
      if (has(/^-[a-z]*[dDmMcCfu]|^--(?:delete|move|copy|force|set-upstream-to|set-upstream|unset-upstream|edit-description|track|no-track|create-reflog)(?:=|$)/)) return true;
      return args.length > 0 && !has(/^-[a-z]*l|^--(?:list|contains|no-contains|merged|no-merged|points-at|show-current)(?:=|$)/);
    case 'tag':
      if (has(/^-[a-z]*[dasumFfe]|^--(?:delete|annotate|sign|local-user|message|file|force|edit|create-reflog)(?:=|$)/)) return true;
      return args.length > 0 && !has(/^-[a-z]*[lnv]|^--(?:list|verify|contains|no-contains|merged|no-merged|points-at)(?:=|$)/);
    case 'remote': return /^(?:add|remove|rm|rename|set-url|set-head|set-branches|prune|update)$/.test(first);
    case 'stash': return !/^(?:list|show)$/.test(first);
    case 'config':
      if (/^(?:get|list|get-color|get-colorbool)$/.test(first)) return false;
      if (/^(?:set|unset|rename-section|remove-section|edit)$/.test(first)) return true;
      if (has(/^(?:--unset|--unset-all|--add|--replace-all|--rename-section|--remove-section|--edit|-e)$/)) return true;
      if (has(/^(?:--get|--get-all|--get-regexp|--get-urlmatch|--get-color|--get-colorbool|--list|-l)$/)) return false;
      return args.length >= 2;
    case 'worktree': return first !== 'list';
    case 'notes': return first !== '' && !/^(?:list|show)$/.test(first);
    case 'submodule': return first !== '' && !/^(?:status|summary)$/.test(first);
    case 'symbolic-ref': return args.length >= 2 || has(/^(?:-d|--delete)$/);
    case 'reflog': return /^(?:expire|delete)$/.test(first);
    case 'bisect': return !/^(?:log|visualize|view|terms)$/.test(first);
    case 'sparse-checkout': return first !== 'list';
    case 'lfs': return !/^(?:ls-files|status|env|version)$/.test(first);
    case 'bundle': return first === 'unbundle';
    case 'hash-object': return has(/^-w$/);
    case 'fsck': return has(/^--lost-found$/);
    case 'apply': return has(/^--apply$/) || !has(/^--(?:check|stat|numstat|summary)$/);
    case 'clean': case 'add': case 'rm': case 'mv': return !has(dryRun);
    case 'commit': return !has(/^--dry-run$/);
    default: return true;
  }
}

/** Why git may not change the repository in `folder`, or null when it is inside the project or an approved folder. */
function gitFolderReason(folder, root, what) {
  const rootKey = root.toLowerCase();
  const f = String(folder).toLowerCase();
  if (f.includes('\u0000unknown')) {
    return `${what} changes the repository in a folder chosen at run time, so it cannot be proven to be inside the project folder`;
  }
  if (inside(f, rootKey) || isExtraRoot(f, rootKey)) return null;
  return `${what} changes the repository in "${f.replace(/^\u0000msys/, '')}", which is outside the project folder (${root}). Against another folder, git may only read (status, log, diff, show)`;
}

/**
 * Why one command cannot be proven to write only inside the project, or null.
 * `seg` is its segment, whose `prev` is the stage its pipeline feeds it from;
 * null where no pipeline applies (a command run by find -exec).
 */
function checkSegment(tokens, root, shell, base, depth = 0, seg = null) {
  // 1. Redirections, in either shell. `>&` / `&>` followed by a digit or `-` is
  //    a descriptor dup, not a file. Every word the target can be is checked
  //    (a bash brace list, see tokenize), without a `)` that closes a subshell.
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t.redirect) continue;
    const target = tokens[i + 1];
    if (!target || target.redirect) continue;
    for (const text of target.alts ?? [target.text]) {
      if (t.text.endsWith('&') && /^(\d+|-)$/.test(text)) continue;
      const reason = checkTarget(text, root, 'a redirection', base);
      if (reason) return reason;
    }
  }

  const pi = programIndex(tokens, shell);
  if (pi < 0) return null;
  const prog = programName(tokens[pi]);
  let rest = tokens.slice(pi + 1);

  // 2. Inline scripts: heuristic, and honest about it. Every script is judged
  //    by where it writes, and is also refused for every absolute path literal
  //    in it that lands outside the project, unless it is provably a read
  //    (scriptRisk). Until 2026-10-02 only a one-line script was read for its
  //    paths; the kit fix list that day (T1) found multi-line scripts writing
  //    outside by spellings the reading of writes does not know. The words
  //    after the script go along, since the script can read them as paths or
  //    as code.
  for (const { body, after: end } of inlineScripts(prog, rest)) {
    const after = rest.slice(end + 1).filter((t, i, a) => !t.redirect && !(i > 0 && a[i - 1].redirect)).map((t) => t.text);
    const risk = scriptRisk(shell === 'bash' ? catHeredocs(body) : body, prog, root, base, after);
    if (risk) return risk;
  }

  // 3. git makes a folder of its own, in either shell. PowerShell clones were
  //    never read before 2026-09-25, so a whole repository could land in the
  //    home folder while the same command in bash was refused. A clone with no
  //    destination lands in the current folder, so that folder is what counts.
  //
  //    The words are read the way git reads them (review 2026-09-25). The value
  //    of an option that takes one (`-b main`, `--depth 1`, `-c k=v`) is not
  //    a folder, so it is skipped: read as one, `clone -b main <source>` was
  //    refused and `worktree add -b feat <outside>` was allowed. A `-C <dir>`
  //    before the subcommand moves git into that folder, so the destination is
  //    read from there. `git init` makes a repository too, in the folder it is
  //    given or in the current one. `git archive -o`, `git format-patch -o`
  //    and `git bundle create` write a file where they are told to (review
  //    2026-09-28: "export the repo as a zip to my Desktop" ran unread).
  //
  //    git working on another folder's repository (kit fix list, 2026-10-02,
  //    T18): when its working folder is outside the project (`-C`,
  //    `--work-tree`, `--git-dir`, or a `cd` before it), a subcommand that
  //    changes files or history (commit, checkout, reset, pull, stash, clean
  //    and the like) is refused, and one that only reads (status, log, diff,
  //    show and the like) runs. An approved extra folder still passes. The
  //    `--output` file is checked for every subcommand, and so is the file a
  //    `git config --file` writes.
  if (prog === 'git') {
    const VALUE_OPT = /^(-[bBcCjou]|--(?:branch|revision|origin|config|config-env|depth|reference(?:-if-able)?|upload-pack|template|separate-git-dir|jobs|shallow-since|shallow-exclude|server-option|bundle-uri|initial-branch|object-format|ref-format|reason|git-dir|work-tree|namespace|filter|output|output-directory|format|prefix|remote))$/;
    let here = base;
    const elsewhere = []; // where --git-dir and --work-tree point
    const ps = [];
    const flags = []; // the subcommand's own flags
    const outputs = [];
    const shortO = [];
    const configFiles = [];
    const folder = (v) => {
      const moved = resolveStatic(v, here);
      return moved.dynamic || !moved.full ? UNKNOWN_DIR : moved.full;
    };
    for (let k = 0; k < rest.length; k++) {
      const t = rest[k];
      if (t.redirect) { k++; continue; }
      if (!t.text) continue;
      if (!isFlag(t, shell)) {
        // `git config --file <file>`: the file, not a key.
        if (ps[0] && ps[0].text.toLowerCase() === 'config' && /^(-f|--file|--blob)$/.test(rest[k - 1].text)) { configFiles.push(t.text); continue; }
        ps.push(t);
        continue;
      }
      if (ps.length > 0) flags.push(t.text);
      const glued = /^--separate-git-dir=(.+)$/.exec(t.text);
      if (glued) { const r = checkTarget(glued[1], root, '`git`', here); if (r) return r; continue; }
      const out = /^--output(?:-directory)?=(.+)$/.exec(t.text);
      if (out) { outputs.push(out[1]); continue; }
      const loc = /^--(?:git-dir|work-tree)=(.+)$/.exec(t.text);
      if (loc) { if (ps.length === 0) elsewhere.push(folder(loc[1])); continue; }
      const file = /^--file=(.+)$/.exec(t.text);
      if (file) { configFiles.push(file[1]); continue; }
      // A value never starts with a dash: `git diff -C --output=x` is no `-C x`.
      if (!VALUE_OPT.test(t.text) || !rest[k + 1] || /^-./.test(rest[k + 1].text)) continue;
      const v = rest[++k].text;
      if (t.text === '-C' && ps.length === 0) {
        here = folder(v);
      } else if (/^--(?:git-dir|work-tree)$/.test(t.text) && ps.length === 0) {
        elsewhere.push(folder(v));
      } else if (t.text === '--separate-git-dir') {
        const r = checkTarget(v, root, '`git`', here);
        if (r) return r;
      } else if (/^(--output|--output-directory)$/.test(t.text)) {
        outputs.push(v);
      } else if (t.text === '-o') {
        shortO.push(v);
      }
    }
    const sub = ps[0] ? ps[0].text.toLowerCase() : '';
    const args = ps.slice(1).map((t) => t.text.toLowerCase());
    const what = `\`git ${sub}\``;
    // `-o` names the output only for archive and format-patch.
    for (const o of [...outputs, ...(sub === 'archive' || sub === 'format-patch' ? shortO : [])]) {
      const r = checkTarget(o, root, what, here);
      if (r) return r;
    }
    if (sub && gitChanges(sub, args, flags)) {
      for (const f of sub === 'config' ? configFiles : []) {
        const r = checkTarget(f, root, '`git config --file`', here);
        if (r) return r;
      }
      for (const f of [here, ...elsewhere]) {
        const r = gitFolderReason(f, root, what);
        if (r) return r;
      }
    }
    if (sub === 'clone' && ps.length >= 2) return checkTarget(ps[2] ? ps[2].text : '.', root, '`git clone`', here);
    if (sub === 'init') return checkTarget(ps[1] ? ps[1].text : '.', root, '`git init`', here);
    if (sub === 'worktree' && ps.length >= 3 && ps[1].text.toLowerCase() === 'add') {
      return checkTarget(ps[2].text, root, '`git worktree add`', here);
    }
    if (sub === 'bundle' && ps[1] && ps[1].text.toLowerCase() === 'create' && ps[2]) {
      return checkTarget(ps[2].text, root, '`git bundle create`', here);
    }
    return null;
  }

  //    A project starter writes into the current folder, and into any folder
  //    it is named, in either shell: npm, pnpm, yarn or bun init or create,
  //    and npx, bunx or pnpm dlx running create-*, degit, giget or tiged. So
  //    does an install of dependencies, and `curl -O`, which saves the remote
  //    name into the current folder (review 2026-09-28: after a `cd` out, both
  //    wrote there unread). A global install (`-g`) is the machine's, not a
  //    folder's.
  {
    const pos = positionals(rest, shell);
    const sub = pos[0] ? pos[0].text.toLowerCase() : '';
    const global = rest.some((t) => isWord(t) && /^(-g|--global)$/.test(t.text));
    let at = -1;
    let what = '';
    if (['npm', 'pnpm', 'yarn', 'bun'].includes(prog) && ['init', 'create'].includes(sub) && !global) { at = 1; what = `\`${prog} ${sub}\``; }
    const dlx = ['npx', 'bunx'].includes(prog) ? 0 : prog === 'pnpm' && sub === 'dlx' ? 1 : -1;
    if (dlx >= 0 && pos[dlx] && /^(create-|@[^/]+\/create|degit|giget|tiged)/i.test(pos[dlx].text)) { at = dlx + 1; what = `\`${prog} ${pos[dlx].text}\``; }
    if (at >= 0) {
      for (const target of ['.', ...pos.slice(at).map((t) => t.text)]) {
        const r = checkTarget(target, root, what, base);
        if (r) return r;
      }
    }
    const installs = ['npm', 'pnpm', 'yarn', 'bun'].includes(prog) && /^(install|i|add|ci|update|up)$/.test(sub) && !global;
    const remoteName = prog === 'curl' && rest.some((t) => isWord(t) && (/^-[a-zA-Z]*O/.test(t.text) || /^--remote-name(-all)?$/.test(t.text)));
    if (installs || remoteName) {
      const r = checkTarget('.', root, `\`${prog} ${installs ? sub : '-O'}\``, base);
      if (r) return r;
    }
  }

  //    Flag-valued destinations, in either shell: Windows ships curl.exe and
  //    tar.exe, so `tar -xf a.tar -C <folder>` runs from PowerShell too.
  const flagSpec = BASH_FLAG_TARGETS[prog];
  if (flagSpec) {
    for (const v of flagValues(rest, flagSpec)) {
      const reason = checkTarget(v, root, `\`${prog}\``, base);
      if (reason) return reason;
    }
  }

  //    tar in create, append or update mode writes the archive named by -f,
  //    in every spelling: `-czf FILE`, `-cf FILE`, `--create --file=FILE`, and
  //    the old style with no dash (`tar czf FILE src`), where the letters take
  //    their values from the words after them (review 2026-09-28: a backup
  //    archive made in another folder ran unread; only -C was read).
  if (prog === 'tar') {
    const words = rest.filter((t) => !t.redirect && t.text !== '');
    const first = words[0] && isWord(words[0]) ? words[0].text : '';
    const oldStyle = /^[A-Za-z]+$/.test(first) ? first : '';
    const creating = /[cru]/.test(oldStyle)
      || rest.some((t) => isWord(t) && (/^-[A-Za-z]*[cru]/.test(t.text) || /^--(create|append|update)$/.test(t.text)));
    if (creating) {
      const files = flagValues(rest, TAR_FILE_FLAG);
      if (oldStyle.includes('f') && words[1]) files.push(words[1].text);
      for (const f of files) {
        const reason = checkTarget(f, root, '`tar`', base);
        if (reason) return reason;
      }
    }
  }

  //    robocopy and xcopy copy INTO their second word, and robocopy also
  //    writes its /LOG file. From PowerShell and from Git Bash alike.
  if (prog === 'robocopy' || prog === 'xcopy') {
    const ps = positionals(rest, shell).filter((t) => !/^\/[A-Za-z+]+(:.*)?$/.test(t.text));
    if (ps[1]) {
      const reason = checkTarget(ps[1].text, root, `\`${prog}\``, base);
      if (reason) return reason;
    }
    for (const t of rest) {
      const m = /^\/(?:UNI)?LOG\+?:(.+)$/i.exec(t.text);
      const reason = m && checkTarget(m[1], root, '`robocopy /LOG`', base);
      if (reason) return reason;
    }
    return null;
  }

  //    Writers found missing by the review of 2026-09-28: zip writes its
  //    first word, sort -o and scp write where they are told to, `install -d`
  //    makes every folder it is given, and mktemp makes a file or folder in
  //    the system temp folder unless it is pointed elsewhere.
  if (prog === 'zip') {
    const ps = positionals(rest, shell);
    return ps[0] ? checkTarget(ps[0].text, root, '`zip`', base) : null;
  }
  if (prog === 'sort') {
    for (const v of flagValues(rest, SORT_OUTPUT_FLAG)) {
      const reason = checkTarget(v, root, '`sort -o`', base);
      if (reason) return reason;
    }
    return null;
  }
  if (prog === 'scp') {
    const ps = positionals(rest, shell);
    const dest = ps.length >= 2 ? ps[ps.length - 1].text : null;
    if (!dest) return null;
    if (REMOTE_PATH.test(dest) && !/^[A-Za-z]:/.test(dest)) {
      return `\`scp\` copies to "${dest}", another computer, which is outside the project folder`;
    }
    return checkTarget(dest, root, '`scp`', base);
  }
  if (prog === 'mktemp') {
    const dirs = flagValues(rest, { letters: 'p', stops: '', long: ['tmpdir'] });
    const template = positionals(rest, shell)[0];
    if (dirs.length === 0 && (!template || !/[\\/]/.test(template.text))) {
      return '`mktemp` writes into the system temp folder, which is outside the project folder. Make the file under the project\'s own .tmp/ folder instead';
    }
    for (const target of [...dirs, ...(template ? [template.text] : [])]) {
      const reason = checkTarget(target, root, '`mktemp`', base);
      if (reason) return reason;
    }
    return null;
  }

  //    `find` runs a command on what it finds (`-exec cp {} <folder> \;`), and
  //    writes its own output files with -fprint, -fprintf and -fls. In
  //    PowerShell `find` is find.exe, which only searches text.
  //    The `{}` it hands the command is a file inside the folders it searches
  //    (kit fix list, 2026-10-02, T10): read as a name in the current folder,
  //    `find <outside> -exec sed -i ... {} +` edited files outside unread. So
  //    the command is read once per folder, with `{}` as a file in it; with
  //    -execdir the command runs in that folder, and `{}` is a file there.
  if (prog === 'find' && shell !== 'powershell') {
    let s = 0;
    while (s < rest.length && /^-([HLP]|O\d*|D)$/.test(rest[s].text)) s += rest[s].text === '-D' ? 2 : 1;
    const starts = [];
    for (; s < rest.length && !rest[s].redirect && rest[s].text !== '' && !/^[-(!)]/.test(rest[s].text); s++) starts.push(rest[s].text);
    if (starts.length === 0) starts.push('.');
    for (let k = 0; k < rest.length; k++) {
      const x = rest[k].text;
      if (/^-(fprint0?|fprintf|fls)$/.test(x) && rest[k + 1]) {
        const reason = checkTarget(rest[k + 1].text, root, `\`find ${x}\``, base);
        if (reason) return reason;
      }
      if (/^-(exec|execdir|ok|okdir)$/.test(x)) {
        let end = k + 1;
        while (end < rest.length && !/^[;+]$/.test(rest[end].text)) end++;
        const inDir = /dir$/.test(x);
        for (const start of starts) {
          const found = inDir ? './x' : `${start.replace(/[\\/]+$/, '')}/x`;
          const moved = inDir ? resolveStatic(start, base) : null;
          const where = !moved ? base : moved.dynamic || !moved.full ? UNKNOWN_DIR : moved.full;
          const inner = rest.slice(k + 1, end).map((t) => (t.text.includes('{}') ? { text: t.text.split('{}').join(found) } : t));
          const reason = checkSegment(inner, root, shell, where, depth) || innerShells(inner, root, shell, depth, where);
          if (reason) return reason;
        }
        k = end;
      }
    }
    return null;
  }

  if (shell !== 'powershell') {
    // 3a. bash writers.
    if (BASH_WRITE_ALL.has(prog)) {
      for (const t of positionals(rest, shell)) {
        const reason = checkTarget(t.text, root, `\`${prog}\``, base);
        if (reason) return reason;
      }
      return null;
    }
    if (BASH_WRITE_LAST.has(prog)) {
      const ps = positionals(rest, shell);
      // `-t <folder>` names the destination first, and every word after the
      // options is a source. Read as the last word, `cp -t <outside> a b`
      // checked a source and `cp -t .tmp <outside file>` refused a copy INTO
      // the project (review 2026-09-25). rsync's -t is --times, not a folder.
      const dirs = prog === 'rsync' ? [] : flagValues(rest, TARGET_DIR_FLAG);
      if (dirs.length > 0) {
        for (const d of dirs) {
          const reason = checkTarget(d, root, `\`${prog}\``, base);
          if (reason) return reason;
        }
        return null;
      }
      // `install -d` makes every folder it names.
      if (prog === 'install' && rest.some((t) => isWord(t) && /^(-d|--directory)$/.test(t.text))) {
        for (const t of ps) {
          const reason = checkTarget(t.text, root, '`install -d`', base);
          if (reason) return reason;
        }
        return null;
      }
      return ps.length >= 2 ? checkTarget(ps[ps.length - 1].text, root, `\`${prog}\``, base) : null;
    }
    // A link is a door out of the folder: check where it POINTS as well.
    if (prog === 'ln') {
      for (const t of positionals(rest, shell)) {
        const reason = checkTarget(t.text, root, '`ln`', base);
        if (reason) return reason;
      }
      return null;
    }
    // sed and perl edit a file in place with -i, in any cluster: `-Ei`, `-ni`,
    // `-i.bak`, perl's `-pi -e`. Only a word starting `-i` used to count
    // (review 2026-09-28).
    if (prog === 'sed' || prog === 'perl') {
      const { inPlace, scripted, words } = editorWords(prog, rest);
      if (!inPlace) return null;
      // The first word is the script unless -e or -f gave it.
      for (const w of scripted ? words : words.slice(1)) {
        const reason = checkTarget(w, root, `\`${prog} -i\``, base);
        if (reason) return reason;
      }
      return null;
    }
    // Every `of=` is checked: dd writes to the last one, and `of={a,b}` is two.
    if (prog === 'dd') {
      for (const t of rest) {
        const m = t.text.match(/^of=(.*)$/i);
        const reason = m && checkTarget(m[1], root, '`dd`', base);
        if (reason) return reason;
      }
      return null;
    }
    if (flagSpec) return null; // read above, in either shell
    if (prog === 'npm' || prog === 'pnpm' || prog === 'yarn') {
      for (let k = 0; k < rest.length; k++) {
        if (isWord(rest[k]) && rest[k].text === '--prefix' && rest[k + 1]) {
          const reason = checkTarget(rest[k + 1].text, root, `\`${prog} --prefix\``, base);
          if (reason) return reason;
        }
      }
      return null;
    }
    return null;
  }

  // 3b. PowerShell.
  // An expression in parentheses is one word to PowerShell, whatever spaces it
  // holds: `-Path (Join-Path $env:USERPROFILE 'x')` is one value, built at
  // run time (review 2026-09-28: read word by word, `(Join-Path` was a file
  // inside the project and the rest fell off the end).
  rest = psGroupParens(rest);
  // Start-Process writes only where -RedirectStandardOutput/Error point.
  if (PS_START.has(prog)) {
    for (let k = 0; k < rest.length; k++) {
      const t = rest[k];
      if (!isWord(t) || !PS_START_DEST.test(t.text)) continue;
      const glued = /^-[A-Za-z]+[:=](.+)$/.exec(t.text);
      const v = glued ? glued[1] : rest[k + 1] && !rest[k + 1].redirect ? rest[++k].text : null;
      const reason = v && checkTarget(v, root, '`start-process`', base);
      if (reason) return reason;
    }
    return null;
  }
  // A one-line Invoke-Expression runs its string as PowerShell.
  if (prog === 'invoke-expression' || prog === 'iex') {
    const ps = positionals(rest, shell);
    const named = rest.findIndex((t) => isWord(t) && /^-c(o(m(m(a(n(d)?)?)?)?)?)?$/i.test(t.text));
    const script = named >= 0 && rest[named + 1] ? rest[named + 1].text : ps[0] ? ps[0].text : null;
    return script && depth < MAX_DEPTH ? analyze(script, 'powershell', root, depth + 1, base) : null;
  }
  const isWriter = PS_WRITE_FIRST.has(prog) || PS_WRITE_LAST.has(prog);
  // A link is a door out of the folder, so where it POINTS is checked too:
  // New-Item's -Target, whose real name is -Value (review 2026-09-28: read as
  // content, `-Value C:\Users\x` made an unchecked junction), and mklink under
  // cmd, whose last word is the target.
  const linkish = (prog === 'new-item' && rest.some((t) => /^(junction|symboliclink|hardlink)$/i.test(t.text))) || prog === 'mklink';
  if (!isWriter && !linkish) return null;
  // Compress-Archive and Expand-Archive read their -Path and write only to
  // -DestinationPath, so they are read like a copy (review 2026-09-25):
  // unzipping an export from Downloads into the project is a read plus an
  // inside write, and was refused on Windows only.
  const archive = prog === 'compress-archive' || prog === 'expand-archive';
  const destOnly = PS_WRITE_LAST.has(prog) || archive;
  const what = `\`${prog}\``;
  const firstReason = (values) => {
    for (const v of values) {
      const reason = checkTarget(v, root, what, base);
      if (reason) return reason;
    }
    return null;
  };
  // A glued `-Param:value`, as a word of its own, keeping its quote marks.
  const gluedWord = (t, value) => ({ text: value, lit: t.lit && t.lit.slice(t.text.length - value.length) });

  // Words that are not paths: the value of a content parameter (`-Value
  // "C:\note.txt"`), of a common parameter (`-ErrorAction Stop`), and an
  // archive's named source. Read as positionals, a trailing `-ErrorAction
  // Stop` became a copy's destination and the real one went unchecked.
  const skip = new Set();
  let namedSource = false;
  for (let k = 0; k < rest.length; k++) {
    const t = rest[k];
    if (!isWord(t) || !/^-/.test(t.text)) continue;
    if (PS_SOURCE_GLUED.test(t.text)) namedSource = true;
    const next = rest[k + 1];
    if (!next || next.redirect || /[:=]/.test(t.text)) continue;
    const source = archive && PS_SOURCE_PARAM.test(t.text);
    if (source) namedSource = true;
    const content = PS_VALUE_PARAMS.test(t.text) && !(linkish && /^-value$/i.test(t.text));
    if (source || content || PS_COMMON_VALUE.test(t.text.slice(1).toLowerCase())) {
      const list = psList(next, rest, k + 1);
      for (let j = k + 1; j <= list.end; j++) skip.add(rest[j]);
      k = list.end;
    }
  }
  // The path words left, each comma list as one group of paths.
  const isPath = new Set(positionals(rest, shell).filter((t) => !skip.has(t)));
  const groups = [];
  for (let k = 0; k < rest.length; k++) {
    if (!isPath.has(rest[k])) continue;
    const list = psList(rest[k], rest, k);
    groups.push(list.values);
    k = list.end;
  }

  if (prog === 'mklink') return firstReason(groups.flat());

  // Named parameters, including PowerShell's `-Param:Value` and `-Param=Value`.
  let sawNamedDest = false;
  const named = [];
  let namedSrc = null;
  let namedName = null;
  for (let k = 0; k < rest.length; k++) {
    const t = rest[k];
    if (!isWord(t) || !/^-/.test(t.text)) continue;
    const glued = t.text.match(/^-[A-Za-z]+[:=](.+)$/);
    const value = () => (glued ? psList(gluedWord(t, glued[1]), rest, k) : rest[k + 1] && !rest[k + 1].redirect ? psList(rest[k + 1], rest, k + 1) : null);
    if (PS_RENAME.has(prog)) {
      // A rename is read below, from its source and its new name.
      const list = value();
      if (!list) continue;
      if (PS_SOURCE_PARAM.test(t.text.replace(/[:=].*$/, ''))) namedSrc = list.values[0] ?? null;
      else if (/^-newname(:|=|$)/i.test(t.text)) namedName = list.values[0] ?? null;
      else continue;
      if (!glued) k = list.end;
      continue;
    }
    const which = linkish ? /^-(path|literalpath|value|target)(:|=|$)/i
      : destOnly && !/^-target(:|=|$)/i.test(t.text) ? PS_DEST_ONLY : PS_DEST_PARAMS;
    if (!which.test(t.text)) continue;
    const list = value();
    if (!list) continue;
    named.push(...list.values);
    if (!glued) k = list.end;
    sawNamedDest = true;
  }
  if (PS_RENAME.has(prog)) {
    const pos = groups.flat().filter((v) => v !== namedSrc && v !== namedName);
    const src = namedSrc ?? pos[0] ?? null;
    const name = namedName ?? (namedSrc !== null ? pos[0] : pos[1]) ?? null;
    if (name && /[\\/]/.test(name)) return checkTarget(name, root, what, base);
    // A rename lands beside its item, so with no new name written out (a
    // script block, `-NewName { ... }`) the item's folder is still where it
    // writes. With no item of its own it renames what its pipeline hands it,
    // each beside where it sits (kit fix list, 2026-10-02, T10: a pipeline
    // from Downloads renamed every file there unread).
    const beside = (item) => `${folderOf(item)}/${name ?? 'x'}`;
    if (!src) {
      if (seg && seg.prev) return pipeReason(seg, shell, root, what, beside);
      return name ? checkTarget(name, root, what, base) : null;
    }
    if (resolveStatic(src, base.toLowerCase()).dynamic) return checkTarget(`\u0000${src}`, root, what, base);
    return checkTarget(beside(src), root, what, base);
  }
  if (sawNamedDest) return firstReason(named);

  // Positional fallback.
  if (archive) {
    // The first word is the source, unless -Path or -LiteralPath named it, and
    // every other word is a destination; with none, it lands in the current
    // folder. Never only the LAST word: `-CompressionLevel Fastest` can end it.
    const dests = namedSource ? groups : groups.slice(1);
    return firstReason(dests.length > 0 ? dests.flat() : ['.']);
  }
  if (groups.length === 0) {
    // A move with no destination moves into the current folder. A delete, an
    // overwrite or an emptying with no path of its own writes to what its
    // pipeline hands it (kit fix list, 2026-10-02, T10).
    if (PS_MOVE.has(prog)) return checkTarget('.', root, what, base);
    return PS_PIPE_TARGET.has(prog) ? pipeReason(seg, shell, root, what, (item) => item) : null;
  }
  if (destOnly) return firstReason(groups[groups.length - 1]);
  // The first word is the path, checked in full. A later word is usually the
  // content (`Set-Content x.txt $text`), so one built at run time is passed
  // over there; a literal path that points outside is still refused. A link's
  // second word is where it points, and is checked in full.
  const reason = firstReason(groups[0]);
  if (reason) return reason;
  if (linkish) return firstReason(groups.slice(1).flat());
  return firstReason(groups.slice(1).flat().filter((v) => !resolveStatic(v, base.toLowerCase()).dynamic));
}

/**
 * PowerShell words joined back into the parenthesised expression they came
 * from: `(Join-Path`, `$env:USERPROFILE`, `'x')` become one word starting
 * with `(`, which resolveStatic reads as built at run time. Quoted parentheses
 * are text (`lit`, from tokenize).
 */
function psGroupParens(tokens) {
  const out = [];
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.redirect || !/^[$@]?\(/.test(t.text) || (t.lit && t.lit[0])) { out.push(t); continue; }
    let depth = 0;
    const parts = [];
    let end = k;
    for (; end < tokens.length; end++) {
      const u = tokens[end];
      if (u.redirect) break;
      for (let i = 0; i < u.text.length; i++) {
        if (u.lit && u.lit[i]) continue;
        if (u.text[i] === '(') depth++;
        else if (u.text[i] === ')') depth--;
      }
      parts.push(u.text);
      if (depth <= 0) break;
    }
    out.push({ text: parts.join(' ') });
    k = end;
  }
  return out;
}

/**
 * A .NET call that writes, read from the segment's own text: the arguments
 * of `[IO.File]::WriteAllText('C:\x\a.txt', ...)`, `[IO.Directory]::
 * CreateDirectory(...)` and the rest of DOTNET_DEST. A single-quoted argument
 * is the path as written; a double-quoted one is, unless it holds a variable;
 * anything else is built at run time.
 */
function dotnetWrites(segment, root, base) {
  for (const m of segment.matchAll(DOTNET_WRITE)) {
    const dests = DOTNET_DEST[m[1].toLowerCase()][m[2].toLowerCase()];
    if (!dests) continue;
    const args = callArgs(segment, m.index + m[0].length - 1);
    for (const d of dests) {
      const a = args[d];
      if (a === undefined || a === '') continue;
      const lit = /^'([^']*)'$/.exec(a) || /^"([^"$`]*)"$/.exec(a);
      const reason = checkTarget(lit ? lit[1] : `\u0000${a}`, root, `\`[IO.${m[1]}]::${m[2]}\``, base);
      if (reason) return reason;
    }
  }
  return null;
}

/**
 * The commands inside `$( )`, backticks and `<( )` / `>( )` of one bash
 * segment, each read as a command of its own. Only single quotes hide them:
 * inside double quotes they still run (review 2026-09-28: `echo $(cp a
 * /c/x)` ran its copy unread, since only a segment's first program is judged).
 */
function substitutions(text) {
  const out = [];
  let q = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q === "'") { if (ch === "'") q = null; continue; }
    if (ch === '\\') { i++; continue; }
    if (ch === "'" && !q) { q = "'"; continue; }
    if (ch === '"') { q = q ? null : '"'; continue; }
    if (ch === '`') {
      let end = i + 1;
      while (end < text.length && text[end] !== '`') end += text[end] === '\\' ? 2 : 1;
      out.push(text.slice(i + 1, end));
      i = end;
      continue;
    }
    if ((ch === '$' || ch === '<' || ch === '>') && text[i + 1] === '(') {
      let depth = 0;
      let iq = null;
      let j = i + 1;
      const arith = text[i + 2] === '(';
      const docs = [];
      for (; j < text.length; j++) {
        const c = text[j];
        if (iq) { if (c === '\\') j++; else if (c === iq) iq = null; continue; }
        // A here-document's body, from the end of its line to its closing
        // line, is text, whatever quote marks it holds.
        if (!arith && c === '<' && text[j + 1] === '<' && text[j + 2] !== '<') {
          const nl = text.indexOf('\n', j);
          const doc = heredocOpener(nl < 0 ? text : text.slice(0, nl), j, false);
          if (doc) { docs.push(doc); j += doc.len - 1; continue; }
        }
        if (c === '\n' && docs.length > 0) { j = heredocBodiesEnd(text, j + 1, docs.splice(0)) - 1; continue; }
        if (c === "'" || c === '"') { iq = c; continue; }
        if (c === '\\') { j++; continue; }
        if (c === '(') depth++;
        else if (c === ')' && --depth === 0) break;
      }
      out.push(text.slice(i + 2, j));
      i = j;
    }
  }
  return out;
}

const BASH_SHELLS = new Set(['bash', 'sh', 'zsh', 'dash']);
const PS_SHELLS = new Set(['powershell', 'pwsh']);
const CD_PROGRAMS = new Set(['cd', 'pushd', 'chdir', 'set-location', 'sl', 'push-location']);
const PUSH_PROGRAMS = new Set(['pushd', 'push-location']);
const POP_PROGRAMS = new Set(['popd', 'pop-location']);
const UNKNOWN_DIR = '\u0000unknown';
// PowerShell's common parameters: these take a value, these are switches.
const PS_COMMON_VALUE = /^(erroraction|ea|warningaction|wa|informationaction|infa|progressaction|proga|errorvariable|ev|warningvariable|wv|informationvariable|iv|outvariable|ov|outbuffer|ob|pipelinevariable|pv)$/;
const PS_COMMON_SWITCH = /^(verbose|vb|debug|db)$/;

/** The folder a path sits in: what is before its last slash, `.` when it has none. */
const folderOf = (p) => (/[\\/]/.test(p) ? p.replace(/[\\/][^\\/]*$/, '') || '/' : '.');

/**
 * The values of a PowerShell segment that is only strings: `'a'`,
 * `"a", "b"`, or a here-string standing alone. Null when it is anything
 * else, a command or a variable.
 */
function literalList(tokens) {
  if (tokens.length === 0) return null;
  for (const t of tokens) {
    if (t.redirect || !t.lit || ![...t.text].every((c, i) => t.lit[i] || c === ',')) return null;
  }
  const list = psList(tokens[0], tokens, 0);
  return list.end === tokens.length - 1 ? list.values : null;
}

/**
 * Where the items a PowerShell writer takes from its pipeline sit (kit fix
 * list, 2026-10-02, T10): `{ items, here }`, each item a path standing for
 * what is listed (a folder Get-ChildItem lists stands for the files in it),
 * `here` the folder the start ran in; `{ unreadable }` with the stage that
 * cannot be read; or null when nothing is piped in. The pipeline is read
 * back to its start through stages that only filter or sort, and the start
 * must be a lister or strings written out in the command.
 */
function pipelineItems(seg, shell) {
  let stage = seg && seg.prev;
  if (!stage) return null;
  for (; stage.prev; stage = stage.prev) {
    const tokens = stage.tokens ?? [];
    const pi = programIndex(tokens, shell);
    if (pi < 0 || !PS_FILTERS.has(programName(tokens[pi])) || tokens.some((t) => t.text.includes('@{'))) return { unreadable: stage.text.trim() };
  }
  const tokens = stage.tokens ?? [];
  const list = literalList(tokens);
  if (list) return { items: list.flatMap((v) => v.split('\n')).map((v) => v.trim()).filter(Boolean), here: stage.here };
  const pi = programIndex(tokens, shell);
  const lister = pi >= 0 ? programName(tokens[pi]) : '';
  if (!PS_LISTERS.has(lister)) return { unreadable: stage.text.trim() };
  const rest = psGroupParens(tokens.slice(pi + 1));
  const paths = [];
  const loose = [];
  for (let k = 0; k < rest.length; k++) {
    const t = rest[k];
    if (t.redirect) { k++; continue; }
    if (!isWord(t) || !/^-[A-Za-z]/.test(t.text)) { loose.push(t); continue; }
    const glued = /^-([A-Za-z]+)[:=](.+)$/.exec(t.text);
    const name = (glued ? glued[1] : t.text.slice(1)).toLowerCase();
    const isPath = /^(path|literalpath|pspath|lp)$/.test(name);
    if (glued) { if (isPath) paths.push(...glued[2].split(',')); continue; }
    if (PS_LIST_SWITCH.test(name) || !rest[k + 1] || rest[k + 1].redirect) continue;
    const value = psList(rest[k + 1], rest, k + 1);
    if (isPath) paths.push(...value.values);
    k = value.end;
  }
  if (paths.length === 0 && loose.length > 0) paths.push(...psList(loose[0], loose, 0).values);
  if (paths.length === 0) paths.push('.');
  const children = /^(get-childitem|gci|ls|dir)$/.test(lister);
  return { items: paths.map((p) => (children && !/[*?[]/.test(p.replace(/^.*[\\/]/, '')) ? `${p}/x` : p)), here: stage.here };
}

/**
 * Why the paths a writer takes from its pipeline cannot be proven inside the
 * project folder, or null (see pipelineItems). `place` turns an item into the
 * path the writer writes: the item itself, or a rename beside it.
 */
function pipeReason(seg, shell, root, what, place) {
  const src = pipelineItems(seg, shell);
  if (!src) return null;
  if (src.unreadable !== undefined) {
    return `${what} writes to the paths its pipeline hands it, which starts at \`${src.unreadable.slice(0, 80)}\`, a list this guard cannot read, so they cannot be proven to be inside the project folder. Name the paths on the command itself`;
  }
  for (const item of src.items) {
    const reason = checkTarget(place(item), root, what, src.here);
    if (reason) return reason;
  }
  return null;
}

/**
 * The text a pipeline stage hands the next one, when it is written out in
 * the command: an echo, a printf or a Write-Output of words, a `cat` of a
 * here-document, or in PowerShell strings or a here-string standing alone.
 * Null for anything else (`cat x.js`, a download).
 */
function pipedText(stage, shell) {
  const tokens = stage.tokens ?? [];
  if (shell === 'powershell') {
    const list = literalList(tokens);
    if (list) return list.join('\n');
  }
  const pi = programIndex(tokens, shell);
  if (pi < 0) return null;
  const prog = programName(tokens[pi]);
  const words = tokens.slice(pi + 1).filter((t, i, a) => !t.redirect && !(i > 0 && a[i - 1].redirect)).map((t) => t.text);
  // A `$(cat <<'EOF' ... EOF)` among the words is its body (see catHeredocs).
  if (prog === 'echo' || (shell === 'powershell' && (prog === 'write-output' || prog === 'write'))) {
    const text = words.filter((w) => shell === 'powershell' || !/^-[neE]+$/.test(w)).join(' ');
    return shell === 'bash' ? catHeredocs(text) : text;
  }
  if (prog === 'printf' && shell !== 'powershell') return catHeredocs(words.join('\n'));
  if (prog === 'cat' && stage.docs.length > 0 && positionals(tokens.slice(pi + 1), shell).length === 0) return stage.docs.join('\n');
  return null;
}

/**
 * A script piped into an interpreter or a shell by the stage before it (kit
 * fix list, 2026-10-02, T1): `echo "..." | node`, `"..." | python -`,
 * `cat <<'EOF' | bash`, `"Remove-Item x" | iex`. Read like the same script
 * given in an argument. A program with a script of its own takes the piped
 * text as data, and text not written out in the command (`cat x.js | node`)
 * is not read, as a script file is not.
 */
function pipedScriptRisk(seg, prog, rest, root, shell, depth, here) {
  if (depth >= MAX_DEPTH) return null;
  const words = positionals(rest, shell === 'bash' ? 'bash' : 'powershell');
  let run = null;
  if (INLINE_SCRIPT[prog]) {
    if (inlineScripts(prog, rest).length > 0 || words.some((t) => t.text !== '-')) return null;
    run = (text) => scriptRisk(text, prog, root, here);
  } else if (BASH_SHELLS.has(prog)) {
    const stdin = rest.some((t) => isWord(t) && /^-[a-z]*s[a-z]*$/.test(t.text));
    if (!stdin && (words.length > 0 || rest.some((t) => isWord(t) && /^-[a-z]*c/.test(t.text)))) return null;
    run = (text) => analyze(text, 'bash', root, depth + 1, here);
  } else if (PS_SHELLS.has(prog)) {
    const ci = rest.findIndex((t) => isWord(t) && /^-(c(o(m(m(a(n(d)?)?)?)?)?)?|f(i(l(e)?)?)?|e(c|nc(odedcommand)?)?)$/i.test(t.text));
    if (ci >= 0 ? !(rest[ci + 1] && rest[ci + 1].text === '-') : words.length > 0) return null;
    run = (text) => analyze(text, 'powershell', root, depth + 1, here);
  } else if (prog === 'invoke-expression' || prog === 'iex') {
    if (words.length > 0 || rest.some((t) => isWord(t) && /^-c/i.test(t.text))) return null;
    run = (text) => analyze(text, 'powershell', root, depth + 1, here);
  }
  if (!run) return null;
  const text = pipedText(seg.prev, shell);
  return text === null ? null : run(text);
}

/**
 * A here-document read by an interpreter (`python3 - <<'EOF'`, `node <<'EOF'`)
 * or by a shell (`bash <<'EOF'`) is a script, not data: its body is read the
 * way an inline script or an inline shell is. A reader given a script file
 * (`python x.py <<EOF`) or a -c script takes the body as that script's input,
 * and every other reader (cat, tee, sort) takes it as data.
 */
function heredocRisk(prog, rest, docs, root, shell, depth, base) {
  if (shell === 'powershell' || depth >= MAX_DEPTH) return null;
  const files = positionals(rest, 'bash').filter((t) => t.text !== '-');
  if (files.length > 0) return null;
  if (INLINE_SCRIPT[prog] && inlineScripts(prog, rest).length === 0) {
    for (const body of docs) {
      const reason = scriptRisk(body, prog, root, base);
      if (reason) return reason;
    }
  } else if (BASH_SHELLS.has(prog) && !rest.some((t) => isWord(t) && /^-[a-z]*c/.test(t.text))) {
    for (const body of docs) {
      const reason = analyze(body, 'bash', root, depth + 1, base);
      if (reason) return reason;
    }
  }
  return null;
}

/**
 * A script given as `$(cat <<'EOF' ... EOF)` is the body of that
 * here-document, so each such substitution in `text` is spelled out as its
 * body. Once a here-document inside a quoted `$( )` became text (kit fix
 * list, 2026-10-02, T9), `bash -c "$(cat <<'EOF' ... EOF)"` would have run
 * its body unread; this keeps it read as the script it is.
 */
function catHeredocs(text) {
  if (!text.includes('<<')) return text;
  const open = /\$\(\s*cat\s+<<-?\s*(?:"([^"\n]+)"|'([^'\n]+)'|\\?([\w.-]+))[ \t]*\n/g;
  let out = '';
  let from = 0;
  // Spelled out up to EVAL_BUDGET times, each found in one pass from where it opens.
  for (let m, n = 0; n < EVAL_BUDGET && (m = open.exec(text)); n++) {
    const delim = m[1] ?? m[2] ?? m[3];
    const start = m.index + m[0].length;
    let end = -1;
    for (let at = start; at <= text.length;) {
      const nl = text.indexOf('\n', at);
      if (text.slice(at, nl < 0 ? text.length : nl).replace(/^\t+/, '').trim() === delim) { end = at; break; }
      if (nl < 0) break;
      at = nl + 1;
    }
    if (end < 0) break; // nothing closes it, and nothing after it is spelled out
    const close = /^[^\n]*(?:\n\s*)?\)/.exec(text.slice(end, end + delim.length + 4096));
    if (!close) continue;
    out += text.slice(from, m.index) + text.slice(start, Math.max(start, end - 1));
    from = end + close[0].length;
    open.lastIndex = from;
  }
  return out + text.slice(from);
}

/**
 * The shells and interpreters a command starts with a script in an argument,
 * read as commands of their own: `bash -c`, `-lc` and friends (the flag is
 * clustered), `powershell -Command`, `-EncodedCommand`, `cmd /c` and Git
 * Bash's `cmd //c` (review 2026-09-28: only `/c` was read), and `eval`.
 */
function innerShells(tokens, root, shell, depth, here) {
  if (depth >= MAX_DEPTH) return null;
  const pi = programIndex(tokens, shell);
  if (pi < 0) return null;
  const prog = programName(tokens[pi]);
  const rest = tokens.slice(pi + 1);
  if (BASH_SHELLS.has(prog)) {
    const ci = rest.findIndex((t) => isWord(t) && /^-[a-z]*c$/.test(t.text));
    if (ci >= 0 && rest[ci + 1]) return analyze(catHeredocs(rest[ci + 1].text), 'bash', root, depth + 1, here);
    return null;
  }
  if (prog === 'eval' && shell === 'bash') {
    return analyze(catHeredocs(rest.filter((t) => !t.redirect).map((t) => t.text).join(' ')), 'bash', root, depth + 1, here);
  }
  if (PS_SHELLS.has(prog)) {
    const ci = rest.findIndex((t) => isWord(t) && /^-c(o(m(m(a(n(d)?)?)?)?)?)?$/i.test(t.text));
    if (ci >= 0 && rest.length > ci + 1) {
      const inner = analyze(catHeredocs(rest.slice(ci + 1).map((t) => t.text).join(' ')), 'powershell', root, depth + 1, here);
      if (inner) return inner;
    }
    const ei = rest.findIndex((t) => isWord(t) && /^-e(c|nc(odedcommand)?)?$/i.test(t.text));
    if (ei >= 0) {
      // No value, or one that does not decode, is a command nobody can read.
      let decoded = '';
      try {
        decoded = rest[ei + 1] ? Buffer.from(rest[ei + 1].text, 'base64').toString('utf16le') : '';
      } catch {
        decoded = '';
      }
      if (!decoded) {
        return 'an encoded PowerShell command cannot be read, so it cannot be proven to write inside the project folder';
      }
      return analyze(decoded, 'powershell', root, depth + 1, here);
    }
    return null;
  }
  if (prog === 'cmd') {
    const ci = rest.findIndex((t) => isWord(t) && /^\/\/?c$/i.test(t.text));
    if (ci >= 0 && rest.length > ci + 1) return analyze(rest.slice(ci + 1).map((t) => t.text).join(' '), 'other', root, depth + 1, here);
  }
  return null;
}

/**
 * Where a cd, pushd, Set-Location or Push-Location goes: `dest` is the folder
 * word, or null when the move cannot be followed; `push` saves the current
 * folder for a later popd; `lost` means the directory stack can no longer be
 * followed either. `args` are the words after the program, redirections left
 * out.
 *
 * Only the plain forms are followed (review 2026-09-25). A pushd with no
 * folder swaps the top two entries, `pushd -n` saves without moving, `+N` and
 * `-N` rotate the stack, and a PowerShell -StackName (any spelling) works on a
 * stack of its own: none of them is modelled, so the folder and the stack both
 * become unknown. PowerShell's -Path and -LiteralPath are read first, the
 * values of the common parameters (-ErrorAction and the like) are skipped, and
 * any other parameter makes the folder unknown, because its value could have
 * been read as the folder (`-StackName s C:\x` went to a folder called "s").
 */
function locationMove(prog, args, shell) {
  const push = PUSH_PROGRAMS.has(prog);
  if (shell === 'bash') {
    const flags = args.filter((t) => isFlag(t, shell) && t.text !== '--');
    const words = positionals(args, shell);
    if (push) {
      if (flags.length > 0 || words.length !== 1 || /^\+\d+$/.test(words[0].text)) return { dest: null, lost: true };
      return { dest: words[0].text, push };
    }
    // `cd a b` fails with "too many arguments" and stays where it was.
    return { dest: words.length === 1 ? words[0].text : null };
  }
  let named = null;
  let stack = false;
  let bad = false;
  const pos = [];
  for (let k = 0; k < args.length; k++) {
    const t = args[k];
    const m = isWord(t) ? /^-([A-Za-z]+)(:(.*))?$/.exec(t.text) : null;
    if (!m) {
      if (/^-/.test(t.text)) bad = true;
      else if (!isFlag(t, shell)) pos.push(t);
      continue;
    }
    const name = m[1].toLowerCase();
    const value = () => (m[2] !== undefined ? m[3] : args[k + 1] ? args[++k].text : '');
    if ('stackname'.startsWith(name)) {
      stack = true;
      value();
    } else if ((name.length >= 3 && 'path'.startsWith(name)) || 'literalpath'.startsWith(name) || name === 'pspath' || name === 'lp') {
      named = value();
    } else if (PS_COMMON_VALUE.test(name)) {
      value();
    } else if (!PS_COMMON_SWITCH.test(name) && !(name.length >= 3 && 'passthru'.startsWith(name))) {
      bad = true;
    }
  }
  if (stack || (push && pos.some((t) => /^\+\d+$/.test(t.text)))) return { dest: null, lost: true };
  const dest = named !== null ? (pos.length === 0 ? named : '') : pos.length === 1 ? pos[0].text : '';
  if (bad || !dest) return { dest: null, lost: push };
  return { dest, push };
}

/**
 * Bash subshell parentheses in one segment: how many open at its start and how
 * many close in it. `(cd x && ls) && write` changes folder only inside the
 * parentheses, so the folder is restored where they close (review 2026-09-24:
 * the write after them was read as running in `x`). A `$(...)` is counted apart
 * so its closing parenthesis never ends a subshell.
 */
function subshellParens(segment) {
  const s = segment.trim();
  let opens = 0;
  let i = 0;
  while (s[i] === '(') {
    opens++;
    i++;
    while (/\s/.test(s[i] ?? '')) i++;
  }
  let closes = 0;
  let inner = 0;
  let q = null;
  for (; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '\\' && q === '"') { i++; continue; }
      if (ch === q) q = null;
      continue;
    }
    if (ch === "'" || ch === '"') { q = ch; continue; }
    if (ch === '\\') { i++; continue; }
    if (ch === '(') { inner++; continue; }
    if (ch === ')') {
      if (inner > 0) inner--;
      else closes++;
    }
  }
  return { opens, closes };
}

/**
 * @param root  the project, the only place a write may land. Never moves.
 * @param cwd   the directory relative paths resolve against. A `cd` moves this
 *              and ONLY this; conflating the two let a command walk out of the
 *              folder and take the permission with it.
 */
function analyze(command, shell, root, depth = 0, cwd = root) {
  if (depth > MAX_DEPTH) return null;
  let here = cwd;
  // What each open bash subshell returns to: its folder and a COPY of the
  // directory stack, since a popd inside ( ) takes an entry the outer shell
  // still has (review 2026-09-25).
  const outer = [];
  let pushed = []; // the folders pushd and Push-Location will return to
  let stackKnown = true; // false once the stack moved in a way this cannot follow
  const loseStack = () => {
    pushed = [];
    stackKnown = false;
  };
  const segs = splitSegments(command, shell);
  // The loop variables that hold only safe values so far (see loopRules).
  const loops = shell === 'bash' && /\b(?:for|select)\s+[A-Za-z_]/.test(command) ? loopRules(command) : null;
  const loopVars = new Set();
  // A here-string, and a here-document inside a quoted `$( )`, is text,
  // unless the command can run text as commands (Invoke-Expression, a script
  // block, a new PowerShell; eval, source, `bash -c`): then its body is read
  // as commands too, as it was before such text was passed over.
  const strings = segs.flatMap((s) => s.strings);
  const runsText = strings.length > 0 && (shell === 'powershell' ? PS_RUNS_TEXT : shell === 'bash' ? BASH_RUNS_TEXT : null)
    ?.test(strings.reduce((c, s) => c.split(s.body).join(''), command));
  for (const seg of segs) {
    const segment = seg.text;
    const tokens = tokenize(segment, shell);
    seg.tokens = tokens;
    seg.here = here;
    if (tokens.length === 0) continue;
    const parens = shell === 'bash' ? subshellParens(segment) : { opens: 0, closes: 0 };
    for (let k = 0; k < parens.opens; k++) outer.push({ here, pushed: pushed.slice(), stackKnown });
    const leave = () => {
      for (let k = 0; k < parens.closes && outer.length > 0; k++) ({ here, pushed, stackKnown } = outer.pop());
    };

    // The commands inside `$( )`, backticks and `<( )` run too, from the same
    // folder. A `cd` inside them moves nothing outside.
    if (shell === 'bash') {
      for (const inner of substitutions(segment)) {
        const reason = depth < MAX_DEPTH ? analyze(inner, 'bash', root, depth + 1, here) : null;
        if (reason) return reason;
      }
    } else if (shell === 'powershell') {
      // A here-string's text is not code, so its words are not read for calls.
      const code = seg.strings.reduce((c, s) => c.split(s.placeholder).join("''"), segment);
      const reason = dotnetWrites(code, root, here);
      if (reason) return reason;
    }
    for (const s of runsText && depth < MAX_DEPTH ? seg.strings : []) {
      const inner = analyze(s.body, shell, root, depth + 1, here);
      if (inner) return inner;
    }

    const pi = programIndex(tokens, shell);
    const prog = pi >= 0 ? programName(tokens[pi]) : '';
    const after = pi >= 0 ? tokens.slice(pi + 1) : [];
    const args = after.filter((t, i) => !t.redirect && !(i > 0 && after[i - 1].redirect));

    // A `for` or `select` over safe words makes its variable safe in the
    // targets after it (see loopValue).
    if (loops && (prog === 'for' || prog === 'select') && tokens[pi + 1]) {
      if (loops.get(tokens[pi + 1].text)) loopVars.add(tokens[pi + 1].text);
      else loopVars.delete(tokens[pi + 1].text);
    }

    // A directory change relocates every later relative write in the same
    // command. Follow it; if it cannot be followed, later writes are unprovable.
    // A bare `cd` goes home, which cannot be proven inside. PowerShell also
    // moves with its own `cd..`, `cd\`, `cd~` and a bare drive like `C:`.
    const psLoc = shell !== 'bash' && pi >= 0 ? /^(cd\.\.|cd\\|cd~|[a-z]:)$/i.exec(tokens[pi].text) : null;
    // popd and Pop-Location go back to where the matching push left from.
    // Following the push without the pop sent every later relative path to
    // the pushed folder (review 2026-09-25). Only a bare one is followed: with
    // any argument (`-n`, `+N`, -StackName) the folder and the stack are
    // unknown, and so is every pop after the stack was lost.
    if (POP_PROGRAMS.has(prog)) {
      if (args.length > 0 || !stackKnown) {
        here = UNKNOWN_DIR;
        loseStack();
      } else if (pushed.length > 0) {
        here = pushed.pop();
      }
      leave();
      continue;
    }
    // `dirs -c` empties the stack, and `dirs` with any flag is not modelled.
    if (shell === 'bash' && prog === 'dirs' && args.length > 0) loseStack();
    if (CD_PROGRAMS.has(prog) || psLoc) {
      const move = psLoc ? { dest: /^cd\.\.$/i.test(psLoc[1]) ? '..' : null } : locationMove(prog, args, shell);
      if (move.lost) loseStack();
      if (move.push) pushed.push(here);
      const moved = move.dest === null ? null : resolveStatic(move.dest, here);
      here = !moved || moved.dynamic || !moved.full ? UNKNOWN_DIR : moved.full;
      leave();
      continue;
    }

    const saved = LOOP_VARS;
    LOOP_VARS = loopVars;
    let reason;
    try {
      reason = checkSegment(tokens, root, shell === 'bash' ? 'bash' : 'powershell', here, depth, seg);
    } finally {
      LOOP_VARS = saved;
    }
    if (reason) return reason;

    if (pi < 0) { leave(); continue; }
    // Inline shells carry a whole script in an argument, so it is scanned too.
    const inner = innerShells(tokens, root, shell, depth, here);
    if (inner) return inner;
    // A here-document this command reads as a script.
    if (seg.docs.length > 0) {
      const doc = heredocRisk(prog, tokens.slice(pi + 1), seg.docs, root, shell, depth, here);
      if (doc) return doc;
    }
    // A script piped into an interpreter or a shell.
    if (seg.prev) {
      const piped = pipedScriptRisk(seg, prog, tokens.slice(pi + 1), root, shell, depth, here);
      if (piped) return piped;
    }
    leave();
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hook entry point
// ---------------------------------------------------------------------------

const SHELL_BY_TOOL = { Bash: 'bash', PowerShell: 'powershell', Monitor: 'bash' };
const FILE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);

/**
 * Where a RELATIVE path starts: the session's current folder (the payload's
 * cwd), which Claude Code keeps between calls and also resolves a relative
 * Write path from. The root does not move and stays the only place a write
 * may land. Starting at the root instead refused `../plans/x.md` from a
 * subfolder, and allowed a relative write after the shell had moved into an
 * added working folder (review 2026-09-25). No cwd, or one that cannot be
 * proven, starts at the root, as before.
 */
function startDir(payload, root) {
  const c = payload && payload.cwd;
  if (typeof c !== 'string' || !c.trim()) return root;
  const r = resolveStatic(c, root.toLowerCase());
  return r.dynamic || !r.full ? root : r.full;
}

export function verdict(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const root = projectRoot(payload);

  if (FILE_TOOLS.has(payload.tool_name)) {
    const file = payload.tool_input && (payload.tool_input.file_path ?? payload.tool_input.notebook_path);
    if (typeof file !== 'string' || file.length === 0) return null;
    return checkTarget(file, root, `the ${payload.tool_name} tool`, startDir(payload, root));
  }

  const shell = SHELL_BY_TOOL[payload.tool_name];
  if (!shell) return null;
  const command = payload.tool_input && payload.tool_input.command;
  if (typeof command !== 'string' || command.length === 0) return null;
  return analyze(command, shell, root, 0, startDir(payload, root));
}

function main() {
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    return ALLOW;
  }
  const reason = verdict(payload);
  if (reason) {
    process.stderr.write(
      `path-guard: blocked - ${reason}. Every file this project writes stays inside the project folder ` +
        '(CLAUDE.md, the rule "Every file you write stays inside the project root"). ' +
        "Scratch files go in the project's own .tmp/ folder. " +
        'If the owner explicitly asked for a write outside it, ask them to do it themselves.\n'
    );
    return BLOCK;
  }
  return ALLOW;
}

// Shared with the destructive guard beside this file: it reads inline scripts
// with these same helpers. Exporting runs nothing; only the direct run below
// reads stdin and exits.
export { INLINE_SCRIPT, SCRIPT_SPAWN_CALLS, maskStrings, callArgs, destShape, receiverBefore, spawnedCommands };

/**
 * Is this file the one node was started on? Compared by the real path as well
 * as the spelled one: node resolves the main module through junctions and
 * symbolic links, so a guard started through a linked project folder never
 * matched itself, read no stdin and allowed everything, silently (review
 * 2026-09-28).
 */
function isMainModule() {
  const arg = process.argv[1];
  if (!arg) return false;
  const self = norm(fileURLToPath(import.meta.url)).toLowerCase();
  const spellings = [path.resolve(arg)];
  try { spellings.push(fs.realpathSync(arg)); } catch { /* not on disk under that name */ }
  return spellings.some((s) => norm(s).toLowerCase() === self);
}

// Importable for the test; only the direct run touches stdin and exits.
if (isMainModule()) {
  let code = ALLOW;
  try {
    code = main();
  } catch {
    code = ALLOW; // fail open: a guard bug must never trap the owner
  }
  process.exit(code);
}
