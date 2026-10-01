// Archive-old-rows.mjs - keeps the files that grow forever cheap to read. Every
// ProjectOS file that accumulates forever is read at task pickup, so each one
// needs a ceiling: the live file keeps the newest material, and everything
// older MOVES verbatim into a sibling *-archive.md that is not read by default.
//
// Its twin is Archive-old-rows.ps1, the same script in PowerShell. Both read
// the same files and write the same bytes, so a project can use either one and
// switch at any time; this one runs wherever Node does, which is every machine
// that runs Claude Code. They MUST change together: a fix in one is a bug in the
// other until it lands there too, and tests/Archive-rows-tests.mjs runs every
// case against both and compares their output file by file (2026-10-01).
//
// MOVEMENT, NOT REWRITE. Rows and entries are relocated byte for byte. Nothing is
// compressed, edited, renumbered or deleted, and re-running is idempotent (an
// archive append skips only what the archive already held BEFORE the run, so two
// identical rows moved in one run both land). The order, the three engines
// (history, section, table) and what is never touched are described at the top
// of Archive-old-rows.ps1, and hold here unchanged.
//
// Preview (writes nothing):
//   node project-os/Archive-old-rows.mjs --dry-run
// Apply for real: the same line without --dry-run. It runs at `Go commit`.
//
// Flags, each the .ps1 parameter in kebab case, with the same default:
//   --dry-run                 (-DryRun)
//   --max-keep-rows 20        (-MaxKeepRows) hard cap on live deep rows
//   --row-char-budget 900     (-RowCharBudget) warn on longer live rows
//   --max-keep-scan-rows 80   (-MaxKeepScanRows) 0 never rotates the Scan log
//   --max-keep-decisions 25   (-MaxKeepDecisions)
//   --max-keep-backlog 40     (-MaxKeepBacklog)
//   --max-keep-mistakes 30    (-MaxKeepMistakes)
//   --max-keep-atlas 30       (-MaxKeepAtlas)
// A value is a number, written "--name 5" or "--name=5". A decimal one is
// turned into a whole number the way the .ps1's [int] parameters turn it:
// read as a double, then rounded half to even, so 3.7 is 4, 2.5 is 2 and 3.5
// is 4 (2026-10-01; until then this twin refused 3.7 while the .ps1 ran with
// 4). Any other option, or a value that is not a number, stops the run with
// exit code 1 before anything is read, the way PowerShell refuses a bad
// parameter.
//
// What "the same bytes" takes, since the .ps1 reads and writes through .NET:
//   - Files are read the way .NET's StreamReader reads them: a byte order mark
//     picks UTF-8, UTF-16 or UTF-32 and is dropped, a broken UTF-8 sequence
//     becomes U+FFFD by .NET's rules, and an unfinished one at the very end of
//     the file is dropped. Every write is UTF-8 without a mark.
//   - A rewritten file takes CRLF when it held at least one CRLF, LF otherwise,
//     and always ends with a line break.
//   - The patterns use .NET's meaning of \s, \d and \b (Unicode spaces, digits
//     and letters), match headings without regard to case, and Trim() strips
//     what .NET strips. A date that is not a real day stops the run with exit
//     code 1, as .NET's ParseExact does.
//   - The pointer lines and the archive headers name Archive-old-rows.ps1, so a
//     file reads the same whichever twin wrote it.
// Where .NET versions differ, this follows Windows PowerShell 5.1, the one
// every Windows machine ships and the one it was measured against. PowerShell 7
// runs a newer .NET whose text rules differ for a handful of rare characters.
// The console summary matches the .ps1 line for line, except for its own name,
// the --dry-run spelling, and sizes, always written 1,234.5 here while the .ps1
// follows the machine's number format.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = 'Archive-old-rows.mjs';

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------
const PARAMS = {
  'max-keep-rows': 20,
  'row-char-budget': 900,
  'max-keep-scan-rows': 80,
  'max-keep-decisions': 25,
  'max-keep-backlog': 40,
  'max-keep-mistakes': 30,
  'max-keep-atlas': 30,
};

class RunError extends Error {}

// A value as the .ps1's [int] parameters read it, or NaN when they refuse it.
// PowerShell reads the text as a double (sign, digits, an optional fraction
// and an optional exponent), then .NET's Convert.ToInt32 rounds it half to
// even and refuses a result outside the Int32 range. Measured on Windows
// PowerShell 5.1 through -File: 3.7 is 4, 2.5 is 2, 3.5 is 4, -2.5 is -2,
// 1e2 is 100, .5 is 0, 2147483647.5 is refused, -2147483648.5 is
// -2147483648, and 1e400, "3.7abc" and "1e2.5" are refused (2026-10-01).
function toInt32(text) {
  const t = String(text).trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return NaN;
  const x = Number(t);
  if (!Number.isFinite(x)) return NaN;
  // Round half to even. x - floor(x) is exact for every finite double.
  const f = Math.floor(x);
  const d = x - f;
  const n = (d > 0.5 || (d === 0.5 && f % 2 !== 0) ? f + 1 : f) + 0; // + 0 turns -0 into 0
  return n < -2147483648 || n > 2147483647 ? NaN : n;
}

function parseArgs(argv) {
  const opts = { ...PARAMS, 'dry-run': false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') { opts['dry-run'] = true; continue; }
    const m = /^--([a-z-]+)(?:=(.*))?$/s.exec(arg);
    if (!m || !Object.hasOwn(PARAMS, m[1])) {
      throw new RunError(`A parameter cannot be found that matches parameter name '${arg}'. Known: --dry-run, ${Object.keys(PARAMS).map((k) => `--${k}`).join(', ')}.`);
    }
    let value = m[2];
    if (value === undefined) {
      if (i + 1 >= argv.length) throw new RunError(`Missing an argument for parameter '--${m[1]}'. Specify a whole number and try again.`);
      value = argv[++i];
    }
    // The .ps1 parameters are [int], so the same conversion and range apply.
    const n = toInt32(value);
    if (Number.isNaN(n)) {
      throw new RunError(`Cannot process argument transformation on parameter '--${m[1]}'. Cannot convert value "${value}" to a number that rounds to a whole number between -2147483648 and 2147483647.`);
    }
    opts[m[1]] = n;
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Reading files the way .NET does
// ---------------------------------------------------------------------------
// File.ReadAllText and File.ReadAllLines go through StreamReader, which looks
// for a byte order mark first and never flushes its decoder, so bytes that
// start a character but end the file before it is complete are dropped.
function readNetText(file) {
  const b = fs.readFileSync(file);
  const n = b.length;
  if (n >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return decodeUtf8(b, 3);
  if (n >= 2 && b[0] === 0xFE && b[1] === 0xFF) return decodeUtf16(b, 2, true);
  if (n >= 2 && b[0] === 0xFF && b[1] === 0xFE) {
    if (n < 4 || b[2] !== 0 || b[3] !== 0) return decodeUtf16(b, 2, false);
    return decodeUtf32(b, 4, false);
  }
  if (n >= 4 && b[0] === 0 && b[1] === 0 && b[2] === 0xFE && b[3] === 0xFF) return decodeUtf32(b, 4, true);
  return decodeUtf8(b, 0);
}

// Collects UTF-16 code units and turns them into a string in slices, so a
// large file never hits the argument limit of String.fromCharCode.
function unitSink() {
  const parts = [];
  let buf = [];
  return {
    push(u) { buf.push(u); if (buf.length >= 8192) { parts.push(String.fromCharCode(...buf)); buf = []; } },
    code(cp) {
      if (cp > 0xFFFF) { cp -= 0x10000; this.push(0xD800 + (cp >> 10)); this.push(0xDC00 + (cp & 0x3FF)); } else this.push(cp);
    },
    done() { parts.push(String.fromCharCode(...buf)); return parts.join(''); },
  };
}

// .NET Framework's UTF-8 decoder, replacement mode. One U+FFFD stands for each
// broken sequence it consumed. Unlike the WHATWG decoder Node uses, it judges
// an overlong, surrogate or out-of-range sequence at its SECOND byte and
// consumes that byte with the lead, so "E0 80 80" is two U+FFFD, not three.
function decodeUtf8(b, start) {
  const out = unitSink();
  const n = b.length;
  let i = start;
  while (i < n) {
    const c = b[i];
    if (c < 0x80) { out.push(c); i++; continue; }
    if ((c & 0x40) === 0) { out.push(0xFFFD); i++; continue; }
    let need;
    let cp;
    if ((c & 0x20) === 0) {
      if ((c & 0x1F) <= 1) { out.push(0xFFFD); i++; continue; }
      need = 1; cp = c & 0x1F;
    } else if ((c & 0x10) === 0) {
      need = 2; cp = c & 0x0F;
    } else {
      if ((c & 0x0F) > 4) { out.push(0xFFFD); i++; continue; }
      need = 3; cp = c & 0x07;
    }
    let j = i + 1;
    let bad = false;
    for (let k = 1; k <= need; k++) {
      if (j >= n) return out.done();
      const cc = b[j];
      if ((cc & 0xC0) !== 0x80) { bad = true; break; }
      cp = (cp << 6) | (cc & 0x3F);
      j++;
      if (k === 1 && need === 2 && ((cp & 0x3E0) === 0 || (cp & 0x3E0) === 0x360)) { bad = true; break; }
      if (k === 1 && need === 3 && ((cp & 0x1F0) < 0x10 || (cp & 0x1F0) > 0x100)) { bad = true; break; }
    }
    if (bad) { out.push(0xFFFD); i = j; continue; }
    out.code(cp);
    i = j;
  }
  return out.done();
}

function decodeUtf16(b, start, bigEndian) {
  const units = [];
  for (let i = start; i + 1 < b.length; i += 2) units.push(bigEndian ? (b[i] << 8) | b[i + 1] : b[i] | (b[i + 1] << 8));
  const out = unitSink();
  for (let k = 0; k < units.length; k++) {
    const u = units[k];
    if (u >= 0xD800 && u <= 0xDBFF) {
      if (k + 1 >= units.length) break;
      const v = units[k + 1];
      if (v >= 0xDC00 && v <= 0xDFFF) { out.push(u); out.push(v); k++; } else out.push(0xFFFD);
    } else if (u >= 0xDC00 && u <= 0xDFFF) out.push(0xFFFD);
    else out.push(u);
  }
  return out.done();
}

function decodeUtf32(b, start, bigEndian) {
  const out = unitSink();
  for (let i = start; i + 3 < b.length; i += 4) {
    const cp = bigEndian
      ? ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
      : ((b[i + 3] << 24) | (b[i + 2] << 16) | (b[i + 1] << 8) | b[i]) >>> 0;
    if (cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) out.push(0xFFFD); else out.code(cp);
  }
  return out.done();
}

// Read-DocLines: the text split on CRLF or LF (a lone CR stays in its line),
// and the line ending the file is written back with.
function readDocLines(file) {
  const raw = readNetText(file);
  return { lines: raw.split(/\r?\n/), eol: raw.includes('\r\n') ? '\r\n' : '\n' };
}
// File.ReadAllLines: CR, LF and CRLF all end a line, and a final line break
// does not open an empty last line.
function readAllLines(file) {
  const lines = readNetText(file).split(/\r\n|\r|\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// ---------------------------------------------------------------------------
// .NET text rules
// ---------------------------------------------------------------------------
// .NET's \s and String.Trim() share one set: Char.IsWhiteSpace. JavaScript's
// differs in two characters (it adds U+FEFF and lacks U+0085).
const WS = '\\t\\n\\v\\f\\r\\x85\\p{Z}';
// .NET tests one UTF-16 unit at a time, so a character beyond U+FFFF is never
// a digit or a word character to it.
const BMP = '(?![\\u{10000}-\\u{10FFFF}])';
const D = `(?:${BMP}\\p{Nd})`;
// The characters .NET counts as a word for \b: letters, non-spacing marks,
// decimal digits, connectors, and the two zero-width joiners.
const WORD = `(?:${BMP}[\\p{L}\\p{Mn}\\p{Nd}\\p{Pc}\\u200C\\u200D])`;
const TRIM_RE = new RegExp(`^[${WS}]+|[${WS}]+$`, 'gu');
const netTrim = (s) => s.replace(TRIM_RE, '');

// PowerShell's -eq compares text the way Windows sorts words, and so does
// .NET's String.EndsWith. Both give no weight at all to the characters below,
// so to the .ps1 a line made only of them is blank (a stray U+FEFF, a soft
// hyphen, U+FFFD, a code point Windows has no entry for). Generated 2026-10-01
// on Windows PowerShell 5.1 (Windows 11, en-GB), every code point tested with
//   CultureInfo.CurrentCulture.CompareInfo.Compare(text, "", CompareOptions.IgnoreCase) == 0
// Hex code points and ranges. U+0000 counts for -eq only, never for EndsWith.
const IGNORABLE_RANGES = `
  0 ad 34f 378-379 37f-383 38b 38d 3a2 524-525 528-530 557-558 560 588 58b-590 5c8-5cf 5eb-5ef
  5f5-5ff 604-605 61c-61d 640 70e 74b-74c 7b2-7bf 7fb-7ff 82e-82f 83f 85c-85d 85f-900 978 980 984
  98d-98e 991-992 9a9 9b1 9b3-9b5 9ba-9bb 9c5-9c6 9c9-9ca 9cf-9d6 9d8-9db 9de 9e4-9e5 9fb-a00 a04
  a0b-a0e a11-a12 a29 a31 a34 a37 a3a-a3b a3d a43-a46 a49-a4a a4e-a50 a52-a58 a5d a5f-a65 a76-a80
  a84 a8e a92 aa9 ab1 ab4 aba-abb ac6 aca ace-acf ad1-adf ae4-ae5 af0 af2-b00 b04 b0d-b0e b11-b12
  b29 b31 b34 b3a-b3b b45-b46 b49-b4a b4e-b55 b58-b5b b5e b64-b65 b78-b81 b84 b8b-b8d b91 b96-b98
  b9b b9d ba0-ba2 ba5-ba7 bab-bad bba-bbd bc3-bc5 bc9 bce-bcf bd1-bd6 bd8-be5 bfb-c00 c04 c0d c11
  c29 c34 c3a-c3c c45 c49 c4e-c54 c57 c5a-c5f c64-c65 c70-c77 c80-c81 c84 c8d c91 ca9 cb4 cba-cbb
  cc5 cc9 cce-cd4 cd7-cdd cdf ce4-ce5 cf0 cf3-d01 d04 d0d d11 d3b-d3c d45 d49 d4f-d56 d58-d5f
  d64-d65 d76-d78 d80-d81 d84 d97-d99 db2 dbc dbe-dbf dc7-dc9 dcb-dce dd5 dd7 de0-df1 df5-e00
  e3b-e3e e5c-e80 e83 e85-e86 e89 e8b-e8c e8e-e93 e98 ea0 ea4 ea6 ea8-ea9 eac eba ebe-ebf ec5 ec7
  ecc ece-ecf eda-edb ede-eff f48 f6d-f70 f98 fbd fcd fdb-fff 10c6-10cf 10fd-10ff 1249 124e-124f
  1257 1259 125e-125f 1289 128e-128f 12b1 12b6-12b7 12bf 12c1 12c6-12c7 12d7 1311 1316-1317
  135b-135c 137d-137f 139a-139f 13f5-13ff 169d-169f 16f1-16ff 170d 1715-171f 1737-173f 1754-175f
  176d 1771 1774-177f 17de-17df 17ea-17ef 17fa-17ff 1806 180b-180d 180f 181a-181f 1878-187f
  18ab-18af 18f6-18ff 191d-191f 192c-192f 193c-193f 1941-1943 196e-196f 1975-197f 19ac-19af
  19ca-19cf 19db-19dd 1a1c-1a1d 1a5f 1a7d-1a7e 1a8a-1a8f 1a9a-1a9f 1aae-1aff 1b4c-1b4f 1b7d-1b7f
  1bab-1bad 1bba-1bbf 1bf4-1bfb 1c38-1c3a 1c4a-1c4c 1c80-1ccf 1cf3-1cff 1de7-1dfb 1f16-1f17
  1f1e-1f1f 1f46-1f47 1f4e-1f4f 1f58 1f5a 1f5c 1f5e 1f7e-1f7f 1fb5 1fc5 1fd4-1fd5 1fdc 1ff0-1ff1
  1ff5 1fff 200c-200f 202a-202e 2060-206f 2072-2073 208f 209d-209f 20b6-20b8 20bb-20cf 20f1-20ff
  218a-218f 23f4-23ff 2427-243f 244b-245f 26bd-26bf 2700 2795-2797 27b0 27bf 27cb 27cd 2b4d-2b4f
  2b5a-2bff 2c2f 2c5f 2cf2-2cf8 2d26-2d2f 2d66-2d6e 2d71-2d7e 2d97-2d9f 2da7 2daf 2db7 2dbf 2dc7
  2dcf 2dd7 2ddf 2e32-2e7f 2e9a 2ef4-2eff 2fd6-2fef 3040 3097-3098 3100-3104 312e-3130 318f-3191
  31bb-31bf 31e4-31ee 321f 32ff a48d-a48f a4c7-a4cf a62c-a63f a660-a661 a674-a67b a698-a69f
  a6f8-a6ff a78f a792-a79f a7aa-a7f9 a82c-a82f a836-a83f a878-a87f a8c5-a8cd a8da-a8f1 a8f8-a8fa
  a8fc-a8ff a954-a95e a97d-a97f a9ce a9da-a9dd a9e0-a9ff aa37-aa3f aa4e-aa4f aa5a-aa5b aa7c-aa7f
  aac3-aada aae0-ab00 ab07-ab08 ab0f-ab10 ab17-ab1f ab27 ab2f-abbf abee-abef abfa-abff d7a4-d7af
  d7c7-d7ca d7fc-d7ff fa6e-fa6f fada-faff fb07-fb12 fb18-fb1c fb37 fb3d fb3f fb42 fb45 fbb2-fbd2
  fd40-fd4f fd90-fd91 fdc8-fdef fdfe-fe0f fe1a-fe1f fe27-fe2f fe53 fe67 fe6c-fe6f fe75 fefd-ff00
  ffbf-ffc1 ffc8-ffc9 ffd0-ffd1 ffd8-ffd9 ffdd-ffdf ffe7 ffef-ffff e0100-e01ef
`;
const IGNORABLE = new Set();
for (const part of IGNORABLE_RANGES.trim().split(/\s+/)) {
  const [a, b = a] = part.split('-').map((h) => parseInt(h, 16));
  for (let c = a; c <= b; c++) IGNORABLE.add(c);
}
// `$text -eq ''`: true for '' and for text made only of ignorable characters.
function eqEmpty(s) {
  for (const ch of s) if (!IGNORABLE.has(ch.codePointAt(0))) return false;
  return true;
}
// `$s.Trim() -eq ''`.
const isBlank = (s) => eqEmpty(netTrim(s));
// `$s.EndsWith($value)`: ignorable characters anywhere in the tail are skipped.
function cultureEndsWith(s, value) {
  let i = s.length;
  for (let k = value.length - 1; k >= 0; k--) {
    for (;;) {
      if (i === 0) return false;
      let cp = s.charCodeAt(i - 1);
      let w = 1;
      if (cp >= 0xDC00 && cp <= 0xDFFF && i >= 2) {
        const hi = s.charCodeAt(i - 2);
        if (hi >= 0xD800 && hi <= 0xDBFF) { cp = ((hi - 0xD800) << 10) + (cp - 0xDC00) + 0x10000; w = 2; }
      }
      if (cp === 0 || !IGNORABLE.has(cp)) break;
      i -= w;
    }
    if (s.charCodeAt(i - 1) !== value.charCodeAt(k)) return false;
    i--;
  }
  return true;
}

const RE_ROW_DATE = new RegExp(`^\\|[${WS}]*(${D}{4}-${D}{2}-${D}{2})[${WS}]*\\|`, 'u');
const RE_DEEP_ROW = new RegExp(`^\\|[${WS}]*${D}{4}-${D}{2}-${D}{2}[${WS}]*\\|`, 'u');
const RE_SEPARATOR = new RegExp(`^\\|[${WS}\\-:|]+\\|[${WS}]*$`, 'u');
const RE_TABLE_LINE = new RegExp(`^\\|[^\\n]*\\|[${WS}]*$`, 'u');
const RE_DATE_HEADING = new RegExp(`^##[${WS}]+${D}{4}-${D}{2}-${D}{2}(?!${WORD})`, 'u');
const RE_H2 = new RegExp(`^##[${WS}]`, 'u');
const RE_FENCE = new RegExp(`^[${WS}]*(\`{3,}|~{3,})`, 'u');
const RE_EXAMPLE_BREAK = new RegExp(`^(-{3,}[${WS}]*$|###[${WS}])`, 'u');
const RE_ONLY_WS = new RegExp(`^[${WS}]*$`, 'u');
const RE_WS_RUN = new RegExp(`[${WS}]+`, 'gu');

// PowerShell's -match and -like ignore case the way .NET lowers a character:
// besides A-Z, the Kelvin sign lowers to k and the dotted capital I to i. The
// needles here are plain ASCII, so these are the only characters that matter.
function lowerUnit(u) {
  if (u >= 0x41 && u <= 0x5A) return u + 32;
  if (u === 0x212A) return 0x6B;
  if (u === 0x0130) return 0x69;
  return u;
}
function ciMatchAt(s, at, needle) {
  if (at + needle.length > s.length) return false;
  for (let k = 0; k < needle.length; k++) {
    if (lowerUnit(s.charCodeAt(at + k)) !== lowerUnit(needle.charCodeAt(k))) return false;
  }
  return true;
}
const ciStartsWith = (s, needle) => ciMatchAt(s, 0, needle);
function ciIncludes(s, needle) {
  for (let at = 0; at + needle.length <= s.length; at++) if (ciMatchAt(s, at, needle)) return true;
  return false;
}

const utf8Bytes = (s) => Buffer.byteLength(s, 'utf8');
const leaf = (p) => path.basename(p);
const preview = (text) => text.slice(0, Math.min(70, text.length)).replace(RE_WS_RUN, ' ');
const pad = (v, w) => String(v).padStart(w);
function fmtKB(bytes) {
  const s = (bytes / 1024).toFixed(1);
  const [int, frac] = s.split('.');
  const neg = int.startsWith('-');
  const digits = neg ? int.slice(1) : int;
  return `${pad(`${neg ? '-' : ''}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`, 7)} KB`;
}
function ensureEol(s, eol) { return cultureEndsWith(s, eol) ? s : s + eol; }
function writeAtomic(file, text) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, Buffer.from(text, 'utf8'));
  fs.renameSync(tmp, file);
}
// Get-BlockKey: every non-blank line, trimmed.
const blockKey = (block) => block.map(netTrim).filter((s) => !eqEmpty(s)).join('\n');

// Lines inside a fenced code block are invisible to the section and table
// engines, exactly as in the .ps1 (its Get-FenceMask).
function fenceMask(lines) {
  const mask = new Array(lines.length).fill(false);
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    const m = RE_FENCE.exec(lines[i]);
    if (open === null) {
      if (m) { open = m[1][0]; mask[i] = true; }
    } else {
      mask[i] = true;
      if (m && m[1].startsWith(open)) open = null;
    }
  }
  return mask;
}
function findSection(lines, mask, heading) {
  for (let i = 0; i < lines.length; i++) {
    if (mask[i]) continue;
    if (ciStartsWith(lines[i], heading) && RE_ONLY_WS.test(lines[i].slice(heading.length))) return i;
  }
  return -1;
}
function findSectionEnd(lines, mask, startIdx) {
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (mask[i]) continue;
    if (RE_H2.test(lines[i])) return i;
  }
  return lines.length;
}

// ---------------------------------------------------------------------------
// Calendar days, as .NET's DateTime counts them (years 1 to 9999)
// ---------------------------------------------------------------------------
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysInMonth = (y, m) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
function dayNumber(y, m, d) {
  const a = m <= 2 ? 1 : 0;
  const yy = y - a;
  const mm = m + (a ? 9 : -3);
  return 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) + Math.floor((153 * mm + 2) / 5) + d;
}
function fromDayNumber(n) {
  let y = Math.floor((n - 60) / 365.2425) - 1;
  while (dayNumber(y + 1, 1, 1) <= n) y++;
  let m = 1;
  while (m < 12 && dayNumber(y, m + 1, 1) <= n) m++;
  return { y, m, d: n - dayNumber(y, m, 1) + 1 };
}
const fmtDate = (n) => {
  const { y, m, d } = fromDayNumber(n);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};
// [datetime]::ParseExact(x, 'yyyy-MM-dd'): ASCII digits and a real day only.
function parseRowDate(s) {
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(s);
  if (!m) throw new RunError(`Exception calling "ParseExact" with "3" argument(s): "String was not recognized as a valid DateTime." (${s})`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) {
    throw new RunError(`Exception calling "ParseExact" with "3" argument(s): "The DateTime represented by the string is not supported in calendar System.Globalization.GregorianCalendar." (${s})`);
  }
  return dayNumber(y, mo, d);
}
function getRowDate(line) {
  const m = RE_ROW_DATE.exec(line);
  return m ? parseRowDate(m[1]) : null;
}

// Sort-Object Name sorts the way Windows compares words: case aside, and a
// hyphen or an apostrophe weighs nothing. Only the order of the summary
// depends on it; each feature's files are its own.
const COLLATOR = new Intl.Collator('en');
function compareNames(a, b) {
  return COLLATOR.compare(a.replace(/[-']/g, ''), b.replace(/[-']/g, '')) || COLLATOR.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}
// Get-ChildItem -Directory, without -Force: folders and links to folders,
// leaving out the hidden ones (a leading dot outside Windows).
function featureDirs(featuresDir) {
  if (!fs.existsSync(featuresDir)) return [];
  let entries;
  try { entries = fs.readdirSync(featuresDir, { withFileTypes: true }); } catch { return []; }
  const names = [];
  for (const e of entries) {
    if (process.platform !== 'win32' && e.name.startsWith('.')) continue;
    let dir = e.isDirectory();
    if (!dir && e.isSymbolicLink()) {
      try { dir = fs.statSync(path.join(featuresDir, e.name)).isDirectory(); } catch { dir = false; }
    }
    if (dir) names.push(e.name);
  }
  return names.sort(compareNames);
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------
function main(argv) {
  const opts = parseArgs(argv);
  const DryRun = opts['dry-run'];
  const MaxKeepRows = opts['max-keep-rows'];
  const RowCharBudget = opts['row-char-budget'];
  const MaxKeepScanRows = opts['max-keep-scan-rows'];
  const MaxKeepDecisions = opts['max-keep-decisions'];
  const MaxKeepBacklog = opts['max-keep-backlog'];
  const MaxKeepMistakes = opts['max-keep-mistakes'];
  const MaxKeepAtlas = opts['max-keep-atlas'];

  const log = (s = '') => console.log(s);
  // The kit installs into project-os/ at the repo root, so the root is one level up.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, '..');
  const pos = path.join(root, 'project-os');

  let grandMoved = 0;
  log(`${SELF}  ${DryRun ? '[DRY RUN - no files written]' : '[LIVE RUN]'}`);
  log('-'.repeat(78));

  // =========================================================================
  // ENGINE 1: History (deep-row tables + the Scan log)
  // =========================================================================
  const hasDeepRows = (file) => fs.existsSync(file)
    && readAllLines(file).some((ln) => RE_DEEP_ROW.test(ln));

  // Header + separator of a table, taken from the live file, so a NEW archive
  // opens with the same columns the rows were written under.
  function tableHead(allLines, fromIdx, toIdx) {
    let h = null;
    let s = null;
    for (let i = fromIdx + 1; i < toIdx; i++) {
      if (!RE_TABLE_LINE.test(allLines[i])) continue;
      if (RE_SEPARATOR.test(allLines[i])) {
        if (h !== null) { s = allLines[i]; break; }
      } else if (h === null) h = allLines[i];
    }
    return [h, s];
  }
  // Append rows verbatim to a row archive, scaffolding it if absent. Dedup is
  // checked against the archive as it was BEFORE this run.
  function writeRowArchive(archPath, liveName, blurb, hdr, sep, rows, eol) {
    const existing = new Set();
    const archiveLines = [];
    if (fs.existsSync(archPath)) {
      for (const ln of readAllLines(archPath)) { archiveLines.push(ln); existing.add(netTrim(ln)); }
    } else {
      archiveLines.push(`# ${liveName} - ${blurb}`, '',
        'NOT read by default - consult only when digging into old changes.',
        'Moved here verbatim by project-os/Archive-old-rows.ps1. Movement only: rows are never rewritten, compressed, or deleted.', '');
      if (hdr) archiveLines.push(hdr);
      if (sep) archiveLines.push(sep);
    }
    let appended = 0;
    let dupes = 0;
    for (const r of rows) {
      if (existing.has(netTrim(r.text))) { dupes++; continue; }
      archiveLines.push(r.text);
      appended++;
    }
    writeAtomic(archPath, ensureEol(archiveLines.join(eol), eol));
    return [appended, dupes];
  }

  const historyTargets = [{
    name: 'project-os/History.md (appendix + scan log)',
    live: path.join(pos, 'History.md'),
    arch: path.join(pos, 'History-archive.md'),
    sect: '## Appendix',
    scan: true,
    scanSect: '## Scan log',
    scanArch: path.join(pos, 'History-scan-archive.md'),
  }];
  const featuresDir = path.join(root, 'features');
  const features = featureDirs(featuresDir);
  for (const feat of features) {
    // Template dirs are COPIED to make a feature, never rotated.
    if (feat.startsWith('_')) continue;
    const live = path.join(featuresDir, feat, 'History.md');
    if (hasDeepRows(live)) {
      historyTargets.push({
        name: `features/${feat}/History.md`,
        live,
        arch: path.join(featuresDir, feat, 'History-archive.md'),
        sect: '## Log',
        scan: false,
        scanSect: null,
        scanArch: null,
      });
    }
  }

  const now = new Date();
  const today = dayNumber(now.getFullYear(), now.getMonth() + 1, now.getDate());
  log();
  log(`HISTORY  today ${fmtDate(today)} | keep newest ${MaxKeepRows} rows`);

  for (const t of historyTargets) {
    log();
    log(`=== ${t.name} ===`);
    if (!fs.existsSync(t.live)) { log('  (missing - skipped)'); continue; }

    const doc = readDocLines(t.live);
    const lines = doc.lines;
    const eolBytes = utf8Bytes(doc.eol);
    const lineBytes = lines.map(utf8Bytes);
    // Get-KeptBytes: the size of the file with the given lines left out.
    const keptBytes = (dropped) => {
      let sum = 0;
      let kept = 0;
      for (let i = 0; i < lines.length; i++) if (!dropped.has(i)) { sum += lineBytes[i]; kept++; }
      return sum + eolBytes * Math.max(kept - 1, 0);
    };
    const beforeBytes = keptBytes(new Set());

    let secIdx = -1;
    for (let i = 0; i < lines.length; i++) if (ciStartsWith(lines[i], t.sect)) { secIdx = i; break; }
    if (secIdx < 0) { log(`  section '${t.sect}' not found - skipped (no accidental rotation)`); continue; }

    // Rows AFTER the section header are rotatable; rows before it are the Scan
    // log, counted here and handled by position below.
    let scanCount = 0;
    const rotatable = [];
    for (let i = 0; i < lines.length; i++) {
      const d = getRowDate(lines[i]);
      if (d === null) continue;
      if (i > secIdx) rotatable.push({ index: i, date: d, text: lines[i] });
      else scanCount++;
    }

    // Protection floor: the newest rows are the TAIL of the oldest-first list.
    let protectedCount = MaxKeepRows;
    if (protectedCount > rotatable.length) protectedCount = rotatable.length;
    const candidateCount = rotatable.length - protectedCount;
    const candidates = candidateCount <= 0 ? [] : rotatable.slice(0, candidateCount);

    const move = [];
    const indexSet = (list) => new Set(list.map((m) => m.index));
    // Hard cap: never keep more than MaxKeepRows deep rows live.
    if (rotatable.length - move.length > MaxKeepRows) {
      const inMove = indexSet(move);
      const remaining = candidates.filter((r) => !inMove.has(r.index));
      let need = (rotatable.length - move.length) - MaxKeepRows;
      for (const r of remaining) { if (need <= 0) break; move.push(r); need--; }
    }

    // Scan log: rotated BY POSITION, not by date.
    const scanMove = [];
    let scanSecIdx = -1;
    let scanTotal = 0;
    if (t.scanSect && t.scanArch && MaxKeepScanRows > 0) {
      for (let i = 0; i < secIdx; i++) if (ciStartsWith(lines[i], t.scanSect)) { scanSecIdx = i; break; }
      if (scanSecIdx >= 0) {
        const scanRows = [];
        let sawSep = false;
        for (let i = scanSecIdx + 1; i < secIdx; i++) {
          if (!lines[i].startsWith('|')) continue;
          if (RE_SEPARATOR.test(lines[i])) { sawSep = true; continue; }
          if (!sawSep) continue;
          scanRows.push({ index: i, text: lines[i] });
        }
        scanTotal = scanRows.length;
        const scanExcess = scanRows.length - MaxKeepScanRows;
        for (let k = 0; k < scanExcess; k++) scanMove.push(scanRows[k]);
      }
    }
    const scanMovedCount = scanMove.length;
    const allMoved = [...move, ...scanMove];

    // Table hygiene: drop blank lines stranded between a table's separator and
    // its last row. Empty lines only, a row is never touched.
    const blankDrop = [];
    for (const span of [{ from: scanSecIdx, to: secIdx }, { from: secIdx, to: lines.length }]) {
      if (span.from < 0) continue;
      let sepIdx = -1;
      for (let i = span.from + 1; i < span.to; i++) if (RE_SEPARATOR.test(lines[i])) { sepIdx = i; break; }
      if (sepIdx < 0) continue;
      let lastRow = -1;
      for (let i = sepIdx + 1; i < span.to; i++) {
        if (lines[i].startsWith('|')) { lastRow = i; continue; }
        if (isBlank(lines[i])) continue;
        break;
      }
      if (lastRow < 0) continue;
      for (let i = sepIdx + 1; i < lastRow; i++) if (isBlank(lines[i])) blankDrop.push(i);
    }
    const blankDropCount = blankDrop.length;
    const allDropped = new Set([...allMoved.map((m) => m.index), ...blankDrop]);

    const afterBytes = keptBytes(allDropped);
    const movedCount = move.length;
    const keptCount = rotatable.length - movedCount;
    const overBudget = rotatable.filter((r) => r.text.length > RowCharBudget).length;
    grandMoved += movedCount + scanMovedCount;

    log(`  live size BEFORE     : ${fmtKB(beforeBytes)}`);
    log(`  deep rows total      : ${rotatable.length}`);
    log(`  protected by floor   : ${pad(protectedCount, 3)}   (cap ${MaxKeepRows})`);
    log(`  rows MOVED           : ${pad(movedCount, 3)}`);
    log(`  rows KEPT live       : ${pad(keptCount, 3)}`);
    log(`  live size AFTER (est): ${fmtKB(afterBytes)}`);
    log(`  rows > ${RowCharBudget} chars      : ${pad(overBudget, 3)}${overBudget > 0 ? '   (warning)' : ''}`);
    if (t.scan) {
      log(`  scan log rows        : ${pad(scanCount, 3)}   (cap ${MaxKeepScanRows > 0 ? MaxKeepScanRows : 'off'})`);
      if (scanMovedCount > 0) {
        log(`  scan rows MOVED      : ${pad(scanMovedCount, 3)}   -> ${leaf(t.scanArch)}`);
        log(`  scan rows KEPT live  : ${pad(scanTotal - scanMovedCount, 3)}`);
      }
    } else log('  scan log rows        : n/a (feature file)');
    if (blankDropCount > 0) log(`  stranded blank lines : ${pad(blankDropCount, 3)}   (inside a table - dropped; rows untouched)`);
    const sortedMove = [...move].sort((a, b) => a.date - b.date || a.index - b.index);
    if (movedCount > 0) {
      log(`  -> would move to ${leaf(t.arch)}:`);
      for (const r of sortedMove) log(`       ${fmtDate(r.date)}  ${preview(r.text)}...`);
    }
    if (scanMovedCount > 0) log(`  -> would move ${scanMovedCount} scan row(s) to ${leaf(t.scanArch)} (oldest first)`);

    if (!DryRun && (movedCount > 0 || scanMovedCount > 0 || blankDropCount > 0)) {
      const liveName = leaf(t.live);
      let appended = 0;
      let dupes = 0;
      if (movedCount > 0) {
        const [h, s] = tableHead(lines, secIdx, lines.length);
        [appended, dupes] = writeRowArchive(t.arch, liveName, 'History Archive (deep rows)', h, s, sortedMove, doc.eol);
      }
      let scanAppended = 0;
      let scanDupes = 0;
      if (scanMovedCount > 0) {
        const [h, s] = tableHead(lines, scanSecIdx, secIdx);
        [scanAppended, scanDupes] = writeRowArchive(t.scanArch, liveName, 'Scan-log Archive', h, s, scanMove, doc.eol);
      }

      // Live: drop every moved row; add a one-time pointer under each section,
      // written only by the rotation that earns it.
      let pointerPresent = lines.some((l) => ciIncludes(l, 'Older rows archived'));
      const pointer = `_Older rows archived -> see \`${leaf(t.arch)}\` (moved by project-os/Archive-old-rows.ps1, not rewritten)._`;
      let scanPointerPresent = lines.some((l) => ciIncludes(l, 'Older scan rows archived'));
      const scanPointer = t.scanArch ? `_Older scan rows archived -> see \`${leaf(t.scanArch)}\` (moved by project-os/Archive-old-rows.ps1, not rewritten)._` : null;
      const newLive = [];
      for (let i = 0; i < lines.length; i++) {
        if (allDropped.has(i)) continue;
        newLive.push(lines[i]);
        if (movedCount > 0 && !pointerPresent && i === secIdx) { newLive.push('', pointer); pointerPresent = true; }
        if (scanMovedCount > 0 && !scanPointerPresent && i === scanSecIdx) { newLive.push('', scanPointer); scanPointerPresent = true; }
      }
      writeAtomic(t.live, ensureEol(newLive.join(doc.eol), doc.eol));

      if (movedCount > 0) log(`  WROTE archive        : +${appended} new row(s), ${dupes} duplicate(s) skipped`);
      if (scanMovedCount > 0) log(`  WROTE scan archive   : +${scanAppended} new row(s), ${scanDupes} duplicate(s) skipped`);
      log(`  WROTE live           : ${fmtKB(afterBytes)}`);
    }
  }

  // =========================================================================
  // ENGINES 2 and 3: section blocks (Decisions) and tables (Backlog, Mistakes, BugAtlas)
  // =========================================================================
  // The archive is organised BY SECTION and appended to at each section's END,
  // so it reads oldest first however many runs fed it. A table row is keyed on
  // its trimmed text, a decision entry on its whole block.
  function writeArchiveSection(archPath, liveName, sectionName, headLines, payload, eol, dry) {
    const isEntries = sectionName === 'Archived decisions';
    let lines = [];
    if (fs.existsSync(archPath)) {
      lines = readAllLines(archPath);
    } else {
      const readNote = sectionName === 'Atlas'
        ? `NOT read at task pickup. When no row in the live ${liveName} matches a bug, search this file too: a bug class does not expire.`
        : 'NOT read by default - consult only when digging into an old entry.';
      lines.push(`# ${liveName} - Archive`, '', readNote,
        'Moved here verbatim by project-os/Archive-old-rows.ps1. Movement only: nothing is rewritten, compressed, or deleted.', '');
    }

    const arr = [...lines];
    const mask = fenceMask(arr);
    const existingLines = new Set(arr.map(netTrim));
    const existingBlocks = new Set();
    for (let i = 0; i < arr.length; i++) {
      if (mask[i] || !RE_DATE_HEADING.test(arr[i])) continue;
      const end = findSectionEnd(arr, mask, i);
      existingBlocks.add(blockKey(arr.slice(i, end)));
    }

    let lead = false;
    let insertAt;
    const secIdx = findSection(arr, mask, `## ${sectionName}`);
    if (secIdx < 0) {
      if (lines.length > 0 && !isBlank(lines[lines.length - 1])) lines.push('');
      lines.push(`## ${sectionName}`, '');
      let headCount = 0;
      for (const h of headLines) if (h) { lines.push(h); headCount++; }
      if (isEntries && headCount > 0) lines.push('');
      insertAt = lines.length;
    } else {
      insertAt = findSectionEnd(arr, mask, secIdx);
      // Each archived decision is itself a "## YYYY-MM-DD" heading, so the
      // section runs past all of them; insert after the last one.
      if (isEntries) {
        while (insertAt < arr.length && RE_DATE_HEADING.test(arr[insertAt])) insertAt = findSectionEnd(arr, mask, insertAt);
      }
      while (insertAt > secIdx + 1 && isBlank(lines[insertAt - 1])) insertAt--;
      // A new entry needs a blank line between it and the one above.
      lead = isEntries && !isBlank(lines[insertAt - 1]);
    }

    let added = 0;
    let dupes = 0;
    const toInsert = [];
    for (const block of payload) {
      const key = blockKey(block);
      if (eqEmpty(key)) continue;
      const seen = isEntries ? existingBlocks.has(key) : existingLines.has(key);
      if (seen) { dupes++; continue; }
      toInsert.push(...block);
      added++;
    }
    if (added > 0 && lead) toInsert.unshift('');
    if (toInsert.length > 0) lines.splice(insertAt, 0, ...toInsert);
    if (!dry && added > 0) writeAtomic(archPath, ensureEol(lines.join(eol), eol));
    return [added, dupes];
  }

  // Write the live file back with the moved lines removed, plus a one-time
  // pointer under the rotated section. Only the double blank left at a lift
  // seam is collapsed.
  function writeLive(target, lines, eol, dropIdx, secIdx, archName, dry) {
    const drop = new Set(dropIdx);
    const pointer = `_Older entries archived -> see \`${archName}\` (moved by project-os/Archive-old-rows.ps1, not rewritten)._`;
    let pointerPresent = lines.some((l) => ciIncludes(l, 'Older entries archived'));
    const clean = [];
    let justDropped = false;
    for (let i = 0; i < lines.length; i++) {
      if (drop.has(i)) { justDropped = true; continue; }
      const blank = isBlank(lines[i]);
      const prevBlank = clean.length > 0 && isBlank(clean[clean.length - 1]);
      if (blank && justDropped && prevBlank) continue;
      clean.push(lines[i]);
      if (!blank) justDropped = false;
      if (!pointerPresent && secIdx >= 0 && i === secIdx) { clean.push('', pointer); pointerPresent = true; }
    }
    if (!dry) writeAtomic(target, ensureEol(clean.join(eol), eol));
    return utf8Bytes(clean.join(eol));
  }

  const docTargets = [
    { name: 'project-os/Decisions.md', kind: 'section', live: path.join(pos, 'Decisions.md'), arch: path.join(pos, 'Decisions-archive.md'), sect: 'Index', keep: MaxKeepDecisions },
    { name: 'project-os/Backlog.md (Done)', kind: 'table', live: path.join(pos, 'Backlog.md'), arch: path.join(pos, 'Backlog-archive.md'), sect: 'Done', keep: MaxKeepBacklog },
    { name: 'project-os/BugAtlas.md', kind: 'table', live: path.join(pos, 'BugAtlas.md'), arch: path.join(pos, 'BugAtlas-archive.md'), sect: 'Atlas', keep: MaxKeepAtlas },
  ];
  for (const sect of ['Promoted', 'Retired']) {
    docTargets.push({ name: `project-os/Mistakes.md (${sect})`, kind: 'table', live: path.join(pos, 'Mistakes.md'), arch: path.join(pos, 'Mistakes-archive.md'), sect, keep: MaxKeepMistakes });
  }
  for (const feat of features) {
    if (feat.startsWith('_')) continue;
    const dir = path.join(featuresDir, feat);
    const dec = path.join(dir, 'Decisions.md');
    if (fs.existsSync(dec)) docTargets.push({ name: `features/${feat}/Decisions.md`, kind: 'section', live: dec, arch: path.join(dir, 'Decisions-archive.md'), sect: 'Index', keep: MaxKeepDecisions });
    const atlas = path.join(dir, 'BugAtlas.md');
    if (fs.existsSync(atlas)) docTargets.push({ name: `features/${feat}/BugAtlas.md`, kind: 'table', live: atlas, arch: path.join(dir, 'BugAtlas-archive.md'), sect: 'Atlas', keep: MaxKeepAtlas });
  }

  log();
  log(`DOCS  keep newest: decisions ${MaxKeepDecisions} | backlog ${MaxKeepBacklog} | mistakes ${MaxKeepMistakes} | atlas ${MaxKeepAtlas}`);

  for (const t of docTargets) {
    log();
    log(`=== ${t.name} ===`);
    if (!fs.existsSync(t.live)) { log('  (missing - skipped)'); continue; }

    const doc = readDocLines(t.live);
    const lines = doc.lines;
    const mask = fenceMask(lines);
    log(`  live size BEFORE     : ${fmtKB(utf8Bytes(lines.join(doc.eol)))}`);

    const blocks = [];
    let headLines = [];
    let pointerIdx = -1;
    let archSection = t.sect;

    if (t.kind === 'section') {
      // One block per "## YYYY-MM-DD ..." entry.
      for (let i = 0; i < lines.length; i++) {
        if (mask[i] || !RE_DATE_HEADING.test(lines[i])) continue;
        const to = findSectionEnd(lines, mask, i);
        const idx = [];
        for (let k = i; k < to; k++) idx.push(k);
        blocks.push({ index: i, idx, text: lines[i] });
      }
      pointerIdx = findSection(lines, mask, `## ${t.sect}`);
      archSection = 'Archived decisions';
      // Written once, under the section heading: a rotated entry is alive.
      headLines = [
        `Entries in this section still BIND the project: they only aged out of the live ${leaf(t.live)}.`,
        'Treat each one as if it were still there. If its line in the live Index is in italics, only the part that line names as replaced no longer holds.',
      ];
    } else {
      const secIdx = findSection(lines, mask, `## ${t.sect}`);
      if (secIdx < 0) { log(`  section '## ${t.sect}' not found - skipped (no accidental rotation)`); continue; }
      const secEnd = findSectionEnd(lines, mask, secIdx);
      let sawSep = false;
      let hdr = null;
      let sep = null;
      for (let i = secIdx + 1; i < secEnd; i++) {
        if (mask[i]) continue;
        // An example block below the table ("---" or a "### " heading) is not
        // part of it: its rows are not entries, its separator not ours.
        if (RE_EXAMPLE_BREAK.test(lines[i])) break;
        if (!lines[i].startsWith('|')) continue;
        // The FIRST separator is the table's. An empty placeholder row
        // ("| | | |") matches the same pattern and must not replace it.
        if (RE_SEPARATOR.test(lines[i])) { sawSep = true; if (sep === null) sep = lines[i]; continue; }
        if (!sawSep) { hdr = lines[i]; continue; }
        blocks.push({ index: i, idx: [i], text: lines[i] });
      }
      headLines = [hdr, sep];
      pointerIdx = secIdx;
    }

    const total = blocks.length;
    const excess = total - t.keep;
    log(`  entries total        : ${pad(total, 3)}   (keep newest ${t.keep})`);
    if (excess <= 0) { log('  nothing to move'); continue; }

    // A negative keep asks for more entries than exist. PowerShell then pads
    // the list with nulls and stops at the first one it previews.
    const move = blocks.slice(0, Math.min(excess, total));
    log(`  entries MOVED        : ${pad(excess, 3)}   -> ${leaf(t.arch)}`);
    for (const b of move) log(`       ${preview(b.text)}...`);
    if (excess > total) throw new RunError('You cannot call a method on a null-valued expression.');

    const payload = [];
    for (const b of move) {
      const block = b.idx.map((i) => lines[i]);
      while (block.length > 0 && isBlank(block[block.length - 1])) block.pop();
      if (t.kind === 'section') block.push('');
      payload.push(block);
    }

    const liveName = leaf(t.live);
    const [added, dupes] = writeArchiveSection(t.arch, liveName, archSection, headLines, payload, doc.eol, DryRun);
    log(`  archive              : +${added} new, ${dupes} duplicate(s) skipped`);

    const dropIdx = move.flatMap((b) => b.idx);
    const afterBytes = writeLive(t.live, lines, doc.eol, dropIdx, pointerIdx, leaf(t.arch), DryRun);
    log(`  live size AFTER      : ${fmtKB(afterBytes)}`);
    grandMoved += move.length;
  }

  log();
  log('-'.repeat(78));
  if (DryRun) log(`DRY RUN complete - nothing written. ${grandMoved} item(s) would move. Re-run without --dry-run to apply.`);
  else log(`DONE - ${grandMoved} item(s) moved.`);
}

try {
  main(process.argv.slice(2));
} catch (e) {
  // A stop mid-run leaves every file it already finished written, exactly as
  // the .ps1 does, and says why on stderr.
  console.error(`${SELF} : ${e instanceof RunError || (e && e.code) ? e.message : (e && e.stack) || e}`);
  process.exitCode = 1;
}
