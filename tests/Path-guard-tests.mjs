// Tests for the kit's write-location guard, project-os/guards/Path-guard.mjs.
//
// Run from the kit root:   node tests/Path-guard-tests.mjs
// It prints one line per failing case and a count at the end, and exits 1 when
// any case fails. It writes nothing and needs no install.
//
// This folder sits outside project-os/ on purpose: an install copies all of
// project-os/ into a client project, and these tests belong to the kit only.
//
// Copied from the twin suite in the project the kit grew out of, with three
// changes: the imports point at the kit copy, the cases for that project's own
// approved sibling folders became one case proving the kit's empty EXTRA_ROOTS
// refuses a sibling, and a block of cases runs the guard on a POSIX project
// root (macOS, Linux), where `/c/...` is an ordinary folder.
//
// What it has to prove:
//
//   1. a write inside the project folder is allowed (or the guard is useless);
//   2. a write outside is refused, in every shape it can take;
//   3. a broken payload is ALLOWED (fail open): a bug in a safety net must
//      never trap the owner mid-task;
//   4. the HOOK CONTRACT: run as a real process, a blocked write exits 2 with a
//      reason on stderr and an allowed one exits 0.
//
// A case marked [R] is one a review round found open. Only cases that pass
// today are seeded here; a known hole joins the file when it is fixed.
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verdict } from '../project-os/guards/Path-guard.mjs';
import * as guardModule from '../project-os/guards/Path-guard.mjs';

// The guard reads CLAUDE_PROJECT_DIR before the payload's cwd, so a session that
// sets it would override the stand-in roots below and every case would compare
// against the real project instead. Cleared here so the test means the same
// thing in every session.
delete process.env.CLAUDE_PROJECT_DIR;

// A stand-in project root. It does not need to exist: the guard compares paths,
// it never touches the disk, so the file runs the same on any machine.
const ROOT = 'J:/Projects/Rotem E';
const HOME = (os.homedir() || '').replace(/\\/g, '/');
const OUT = 'C:/Users/User/AppData/Local/Temp/claude/scratchpad';
const GUARD = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'project-os', 'guards', 'Path-guard.mjs');

let failures = 0;
let checks = 0;

function t(name, payload, shouldBlock) {
  checks += 1;
  let reason;
  try {
    reason = verdict({ cwd: ROOT, ...payload });
  } catch (err) {
    failures += 1;
    console.error(`  FAIL ${name}: the guard threw: ${err.message}`);
    return;
  }
  const blocked = Boolean(reason);
  if (blocked !== shouldBlock) {
    failures += 1;
    console.error(
      `  FAIL ${name}: expected ${shouldBlock ? 'BLOCK' : 'ALLOW'}, got ${blocked ? 'BLOCK' : 'ALLOW'}` +
        (reason ? ` (${reason})` : '')
    );
  }
}

const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const ps = (command) => ({ tool_name: 'PowerShell', tool_input: { command } });
const mon = (command) => ({ tool_name: 'Monitor', tool_input: { command } });
const write = (file_path) => ({ tool_name: 'Write', tool_input: { file_path } });

console.log('path-guard: file tools');
t('Write inside the project', write(`${ROOT}/plans/note.md`), false);
t('Write inside, relative path', write('plans/note.md'), false);
t('Write to the temp scratchpad', write(`${OUT}/note.md`), true);
t('Write to the user home', write(`${HOME}/note.md`), true);
t('Write to the global Claude config', write(`${HOME}/.claude/CLAUDE.md`), true);
t('Edit inside the project', { tool_name: 'Edit', tool_input: { file_path: `${ROOT}/src/lib/media.ts` } }, false);
t('Edit outside the project', { tool_name: 'Edit', tool_input: { file_path: 'C:/Windows/System32/hosts' } }, true);
t('NotebookEdit outside the project', { tool_name: 'NotebookEdit', tool_input: { notebook_path: `${OUT}/a.ipynb` } }, true);
t('a memory file is the one allowed exception', write(`${HOME}/.claude/projects/J--Projects-Rotem-E/memory/x.md`), false);
t('but not a non-markdown file in the memory folder', write(`${HOME}/.claude/projects/J--Projects-Rotem-E/memory/x.js`), true);
t('and not a sibling of the memory folder', write(`${HOME}/.claude/projects/J--Projects-Rotem-E/notes/x.md`), true);
// EXTRA_ROOTS, the second allowed exception, ships empty: a folder beside the
// project is refused like any other outside folder until the owner names it.
t('EXTRA_ROOTS empty refuses a sibling folder', write('J:/Projects/Sibling App/project-os/Conversations.md'), true);
t("a sibling's agent config is refused", write('J:/Projects/Donotello/Donotello/.claude/settings.json'), true);
t("a sibling's env file is refused", write('J:/Projects/DS Tiger/Product/.env'), true);
t("a sibling's env variant is refused", write('J:/Projects/DS Tiger/Product/.env.local'), true);
t('any other project is refused', write('J:/Projects/Some Other/plans/x.md'), true);
t('.. cannot climb out of the project', write(`${ROOT}/../escaped.md`), true);
t('.. inside the project is fine', write(`${ROOT}/plans/../src/x.ts`), false);
t('[R] the project written the Git Bash way', write('/j/Projects/Rotem E/plans/x.md'), false);
t('[R] a POSIX-absolute path outside', write('/c/Users/User/pwned.md'), true);
t('[R] a drive-relative path is unprovable', write('C:pwned.md'), true);

console.log('path-guard: redirections');
t('redirect inside the project', bash('node x.mjs > out/log.txt'), false);
t('redirect outside the project', bash(`node x.mjs > ${OUT}/log.txt`), true);
t('append outside the project', bash(`echo hi >> ${OUT}/log.txt`), true);
t('redirect with no space before the path', bash(`node x.mjs >${OUT}/log.txt`), true);
t('a file-descriptor redirect outside', bash(`node x.mjs 2> ${OUT}/err.txt`), true);
t('2>&1 is not a file write', bash('node x.mjs 2>&1'), false);
t('/dev/null is not a file write', bash('node x.mjs > /dev/null'), false);
t('[R] $null is not a file write', ps('npm run check > $null'), false);
t('[R] 2>$null is not a file write', ps('Get-ChildItem 2>$null'), false);
t('[R] NUL is not a file write', ps('npm run check > NUL'), false);
t('PowerShell redirect outside', ps(`Get-Date > ${OUT}/d.txt`), true);
t('[R] >| bypasses nothing', bash(`echo pwned >| ${OUT}/x.txt`), true);
t('[R] >& to a file bypasses nothing', bash(`node x.mjs >& ${OUT}/log.txt`), true);
t('[R] >&2 is still a descriptor dup', bash('echo oops >&2'), false);
t('[R] &> to a file outside', bash(`node x.mjs &> ${OUT}/log.txt`), true);
t('&> to a file inside', bash('node x.mjs &> .tmp/log.txt'), false);
t('heredoc into a project file', bash("cat >> project-os/History.md << 'ROW'\nrow\nROW"), false);
t('[R] a heredoc BODY is data, not commands', bash(`cat > plans/x.md << 'EOF'\nRun: echo hi > ${OUT}/log.txt\nEOF`), false);
t('[R] but the heredoc opener itself is still checked', bash(`cat > ${OUT}/x.md << 'EOF'\nhi\nEOF`), true);

// 2026-09-24: a multi-line inline interpreter script is ONE argument. A
// `node -e "..."` script written over several lines was cut at every newline,
// so a JavaScript arrow on its own line read as a redirection, and after a `cd`
// out of the folder a script that wrote nothing was blocked. Only interpreter
// scripts are joined; everything else is read line by line exactly as before.
const ARROW = "for(const v of r) console.log('-', v.items.map(x=>x.name+':'+x.ok+' ['+x.note+']').join(' || '));";
t('[R2] an arrow inside a multi-line node -e script is not a redirection', bash(`cd "${OUT}" && node -e "\nconst r=[];\n${ARROW}\n" 2>&1 | head -c 200`), false);
t('[R2] same script with no cd', bash(`node -e "\nconst r=[];\n${ARROW}\n"`), false);
t('[R2] same script in PowerShell', ps(`Set-Location "${OUT}"; node -e "\nconst r=[];\n${ARROW}\n"`), false);
t('[R2] python -c over several lines is joined the same way', bash(`cd "${OUT}" && python -c "\nr=[1]\nprint([x for x in r if x>0])\n"`), false);
t('[R2] a real redirect after the multi-line script is still caught', bash(`node -e "\nconsole.log(1)\n" > ${OUT}/x.txt`), true);
t('[R2] a redirect on the line after the string closes is still caught', bash(`node -e "\nconsole.log(1)\n"\necho hi > ${OUT}/x.txt`), true);
t('[R2] an outside path literal inside the multi-line script is still caught', bash(`node -e "\nrequire('fs').writeFileSync('${OUT}/x.txt','a')\n"`), true);
t('[R2] an apostrophe in a comment does not swallow the next line', bash(`# don't worry\necho hi > ${OUT}/x.txt`), true);
t('[R2] two apostrophe comments around a write do not hide it', bash(`# don't\necho hi > ${OUT}/x.txt\n# won't`), true);
t('[R2] an unterminated quote falls back to line by line', bash(`echo "abc\necho hi > ${OUT}/x.txt`), true);
t('[R2] PowerShell: a backtick-escaped quote does not open a string across lines', ps('Write-Output "say `"hi`""\nSet-Content ' + OUT + '/x.txt hi'), true);
t('[R2] PowerShell: a folder path ending in a backslash does not open a string', ps('Get-ChildItem "C:\\Users\\"\nSet-Content ' + OUT + '/x.txt hi'), true);

// What an inline script does that its literals do not show, one-line or not.
t('[R2] a script that writes, run after a cd out of the folder', bash(`cd "${OUT}" && node -e "require('fs').writeFileSync('a.txt','hi')"`), true);
t('[R2] the same, multi-line, the way the arrow used to catch it', bash(`cd /c/Users/User && node -e "\nconst fs = require('fs');\n['a'].forEach((n) => fs.writeFileSync(n + '.txt', 'hi'));\n"`), true);
t('[R2] a script that writes to a path built from the home folder', bash(`node -e "require('fs').writeFileSync(require('os').homedir() + '/x.txt', 'hi')"`), true);
t('[R2] a shell redirection inside the script text', bash(`node -e "require('child_process').execSync('echo hi > C:/Users/User/x.txt')"`), true);
t('[R2] a script that only reads, run after a cd out, is fine', bash(`cd "${OUT}" && node -e "\nconst d=require('fs').readdirSync('.');\nconsole.log(d.map(x=>x.length));\n"`), false);
t('[R2] a script that writes inside the project is fine', bash(`node -e "require('fs').writeFileSync('.tmp/a.txt', 'hi')"`), false);

// Every regression the 2026-09-24 review found in the first, broader version of
// this fix: each was blocked before it and must stay blocked.
t("[R2] review 01: an old block the narrow join keeps", bash("eval \"\necho start\ntouch /c/Users/User/pg-eval.txt\n\""), true);
t("[R2] review 02: an old block the narrow join keeps", bash("bash -ce \"\ncd /c/Users/User\necho hi > pg-ce.txt\n\""), true);
t("[R2] review 03: an old block the narrow join keeps", bash("bash -c -- '\ntouch /c/Users/User/pg-dashdash.txt\n'"), true);
t("[R2] review 04: an old block the narrow join keeps", bash("find . -maxdepth 0 -exec sh -c '\ntouch /c/Users/User/pg-find.txt\n' \\;"), true);
t("[R2] review 05: an old block the narrow join keeps", bash("echo '\ntouch /c/Users/User/pg-pipe.txt\n' | bash"), true);
t("[R2] review 06: an old block the narrow join keeps", bash("bash <<< \"\ntouch /c/Users/User/pg-herestr.txt\n\""), true);
t("[R2] review 07: an old block the narrow join keeps", bash("bash -c \"$(cat <<'EOF'\ncd /c/Users/User\necho hi > pg-catheredoc.txt\nEOF\n)\""), true);
t("[R2] review 08: an old block the narrow join keeps", bash("powershell -NoProfile \"\nWrite-Output hi > C:/Users/User/pg-psdefault.txt\n\""), true);
t("[R2] review 09: an old block the narrow join keeps", bash("node -e '\nconst fs = require(\"fs\"), os = require(\"os\");\n[\"a\"].forEach((f) => fs.writeFileSync(`${os.homedir()}/pg-${f}.txt`, \"hi\"));\n'"), true);
t("[R2] review 10: an old block the narrow join keeps", bash("cd /c/Users/User && node -e \"\nconst fs = require('fs');\n['a'].forEach((n) => fs.writeFileSync(n + '.txt', 'hi'));\n\""), true);
t("[R2] review 11: an old block the narrow join keeps", bash("echo start;#'\ntouch /c/Users/User/pg-comment.txt\necho end;#'"), true);
t("[R2] review 12: an old block the narrow join keeps", bash("echo a\\ #; touch /c/Users/User/pg-escspace.txt"), true);
t("[R2] review 13: an old block the narrow join keeps", bash("echo ${x:- #}; touch /c/Users/User/pg-brace.txt"), true);
t("[R2] review 14: an old block the narrow join keeps", bash("echo `echo #`; touch /c/Users/User/pg-backtick.txt"), true);
t("[R2] review 15: an old block the narrow join keeps", bash("x=\"$(echo 'x\"y')\"\ntouch /c/Users/User/pg-cmdsub.txt\necho it\\'s"), true);
t("[R2] review 16: an old block the narrow join keeps", bash("cat <<\\EOF > .tmp/review/a.txt\nhe said \"hi\nEOF\ntouch /c/Users/User/pg-bsheredoc.txt\ncat <<\\EOF > .tmp/review/b.txt\nshe said \"bye\nEOF"), true);
t("[R2] review 17: an old block the narrow join keeps", bash("echo $'it\\'s'\ntouch /c/Users/User/pg-ansic.txt\necho it\\'s"), true);
t("[R2] review 18: an old block the narrow join keeps", bash("node -e '\nconst cp = require(\"child_process\");\ncp.execSync(`echo hi > C:\\\\Users\\\\User\\\\pg-exec.txt`);\n'"), true);
t("[R2] review 19: an old block the narrow join keeps", bash("wsl bash -c '\ntouch /mnt/c/Users/User/pg-wsl.txt\n'"), true);
t("[R2] review 20: an old block the narrow join keeps", bash("echo '\nWrite-Output hi > C:/Users/User/pg-pspipe.txt\n' | powershell -NoProfile -Command -"), true);
t("[R2] review 21: an old block the narrow join keeps", ps("Invoke-Expression \"\nSet-Content C:\\Users\\User\\pg-iex.txt hi\n\""), true);
t("[R2] review 22: an old block the narrow join keeps", ps("\"\nSet-Content C:\\Users\\User\\pg-iexpipe.txt hi\n\" | iex"), true);
t("[R2] review 23: an old block the narrow join keeps", ps("powershell -NoProfile \"\nSet-Content C:\\Users\\User\\pg-psdefault2.txt hi\n\""), true);
t("[R2] review 24: an old block the narrow join keeps", ps("Write-Output ‘a\"b’\nSet-Content C:\\Users\\User\\pg-smart.txt hi\nWrite-Output ‘c\"d’"), true);
t("[R2] review 25: an old block the narrow join keeps", ps("$s = @\"\na \"b\n\"@\nSet-Content C:\\Users\\User\\pg-herestring.txt $s\n$t = @\"\nc \"d\n\"@"), true);
t("[R2] review 26: an old block the narrow join keeps", ps("Write-Output a` #; Set-Content C:\\Users\\User\\pg-btspace.txt hi"), true);
t("[R2] review 27: an old block the narrow join keeps", ps("Write-Output a <# note #>; Set-Content C:\\Users\\User\\pg-block.txt hi"), true);
t("[R2] review 28: an old block the narrow join keeps", ps("Write-Output start;#'\nSet-Content C:\\Users\\User\\pg-pscomment.txt hi\nWrite-Output end;#'"), true);
t("[R2] review 29: an old block the narrow join keeps", ps("& ([scriptblock]::Create(\"\nSet-Content C:\\Users\\User\\pg-sbcreate.txt hi\n\"))"), true);

// And every everyday read-only script the second review found blocked by the
// first cut of the inline-script rules: each must stay allowed.
t("[R3] review 01: an everyday read-only script stays allowed", bash("node -e \"const s=require('fs').readFileSync('dist/index.html','utf8'); console.log(s.replace(/<[^>]+>/g,' ').slice(0,500))\""), false);
t("[R3] review 02: an everyday read-only script stays allowed", ps("node -e \"const s=require('fs').readFileSync('dist/index.html','utf8'); console.log(s.replace(/<[^>]+>/g,' ').length)\""), false);
t("[R3] review 03: an everyday read-only script stays allowed", bash("node -e \"const t=require('fs').readFileSync('README.md','utf8'); console.log(t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'))\""), false);
t("[R3] review 04: an everyday read-only script stays allowed", bash("node -e 'const h=require(\"fs\").readFileSync(\"dist/index.html\",\"utf8\"); console.log(h.replace(/<br\\s*\\/?>/gi,\"\\n\").replace(/<[^>]+>/g,\"\"))'"), false);
t("[R3] review 05: an everyday read-only script stays allowed", bash("node -p \"require('fs').readFileSync('dist/about/index.html','utf8').match(/<h1[^>]*>(.*?)<\\/h1>/g)\""), false);
t("[R3] review 06: an everyday read-only script stays allowed", bash("node -e \"const fs=require('fs'); const s=fs.readFileSync('src/pages/index.astro','utf8'); console.log((s.match(/<\\/?section[^>]*>/g)||[]).length)\""), false);
t("[R3] review 07: an everyday read-only script stays allowed", ps("node -e \"console.log(require('fs').readFileSync('src/pages/index.astro','utf8').match(/<\\/?[a-z]+>/gi).length)\""), false);
t("[R3] review 08: an everyday read-only script stays allowed", bash("node -e \"const fs=require('fs'); for (const f of fs.readdirSync('src/content/projects')) console.log('<tr><td>/projects/'+f.replace('.yaml','')+'</td></tr>')\""), false);
t("[R3] review 09: an everyday read-only script stays allowed", bash("node -e \"const md=require('fs').readFileSync('project-os/History.md','utf8'); console.log(md.replace(/^> /gm,'').slice(0,200))\""), false);
t("[R3] review 10: an everyday read-only script stays allowed", bash("node -e \"const n=[3,1,2].filter(x => x > /* min */ 1); console.log(n)\""), false);
t("[R3] review 11: an everyday read-only script stays allowed", bash("node -e \"const fs=require('fs'),os=require('os'),path=require('path'); const d=path.join(os.homedir(),'.claude','projects'); fs.writeFileSync('.tmp/projects.txt', fs.readdirSync(d).join('\\n'))\""), false);
t("[R3] review 12: an everyday read-only script stays allowed", ps("node -e \"const os=require('os'),fs=require('fs'); const n=fs.readdirSync(require('path').join(os.homedir(),'.claude','projects')).length; fs.writeFileSync('.tmp/count.txt', String(n))\""), false);
t("[R3] review 13: an everyday read-only script stays allowed", bash("python -c \"import os, subprocess; print(subprocess.run(['git','status','--short'], capture_output=True, text=True, env={**os.environ, 'GIT_PAGER':'cat'}).stdout)\""), false);
t("[R3] review 14: an everyday read-only script stays allowed", ps("python -c \"import os, subprocess; print(subprocess.check_output(['git','log','-1']).decode()); print(os.environ.get('USERNAME'))\""), false);
t("[R3] review 15: an everyday read-only script stays allowed", bash("python -c \"import shutil, os; print(shutil.which('node')); print(os.environ.get('PATH'))\""), false);
t("[R3] review 16: an everyday read-only script stays allowed", bash("python -c \"import json, os; d=json.load(open(os.path.expanduser('~/.claude/settings.json'))); open('.tmp/hooks.json','w').write(json.dumps(d.get('hooks'), indent=2))\""), false);
t("[R3] review 17: an everyday read-only script stays allowed", bash("python -c \"\nimport os, glob\nfiles = glob.glob(os.path.expanduser('~/.claude/projects/J--Projects-Rotem-E/*.jsonl'))\nos.makedirs('.tmp', exist_ok=True)\nopen('.tmp/sessions.txt', 'w').write('\\n'.join(files))\n\""), false);
t("[R3] review 18: an everyday read-only script stays allowed", bash("python -c \"\nimport json, os, urllib.request\nreq = urllib.request.Request('https://api.github.com/repos/rotem914/RotemE/traffic/views', headers={'Authorization': 'token ' + os.environ['GH_TOKEN']})\ndata = json.load(urllib.request.urlopen(req))\njson.dump(data, open('.tmp/views.json', 'w'), indent=2)\n\""), false);
t("[R3] review 19: an everyday read-only script stays allowed", bash("node -e \"\nconst fs = require('fs');\nconst html = fs.readFileSync('dist/index.html', 'utf8');\nconst hrefs = [...html.matchAll(/href=\\\"([^\\\"]+)\\\"/g)].map(m => m[1]);\nconsole.log(hrefs.filter(h => h.startsWith('/projects/')).length);\n\""), false);
t("[R3] review 20: an everyday read-only script stays allowed", ps("node -e '\nconst fs = require(\"fs\");\nconst html = fs.readFileSync(\"dist/index.html\", \"utf8\");\nconst links = [...html.matchAll(/href=\"([^\"]+)\"/g)].map(m => m[1]);\nconsole.log(links.filter(h => h.startsWith(\"/projects/\")).join(\"\\n\"));\n'"), false);
t("[R3] review 21: an everyday read-only script stays allowed", bash("node -e \"\nconst fs = require('fs');\nconst t = fs.readFileSync('C:/Users/User/.claude/settings.json', 'utf8');\nconsole.log(Object.keys(JSON.parse(t).hooks || {}));\n\""), false);
t("[R3] cd-shaped 1: a script that starts git but writes no file stays allowed", bash("cd \"$(git rev-parse --show-toplevel)\" && node -e \"console.log(require('child_process').execSync('git status --short').toString())\""), false);
t("[R3] cd-shaped 2: a script that starts git but writes no file stays allowed", bash("cd \"J:\\Projects\\Rotem E\" && node -e \"const r=require('child_process').spawnSync('git',['diff','--stat'],{encoding:'utf8'}); console.log(r.stdout)\""), false);

// Third review: write destinations are checked, reads never are.
t("[R4] review 01: a script that writes only inside, or only reads, stays allowed", bash("node -e \"\nconst t = require('fs').readFileSync('C:/Users/User/.claude/settings.json', 'utf8');\nrequire('fs').writeFileSync('.tmp/summary.txt', String(t.length))\n\""), false);
t("[R4] review 02: a script that writes only inside, or only reads, stays allowed", bash("node -e \"require('fs').writeFileSync('note.txt', require('os').homedir())\""), false);
t("[R4] review 03: a script that writes only inside, or only reads, stays allowed", bash("cd /c/Windows\nnode -e \"require('fs').writeFileSync('J:/Projects/Rotem E/.tmp/x.txt','y')\""), false);
t("[R4] review 04: a script that writes only inside, or only reads, stays allowed", bash("node -e \"\nconst fs = require('fs');\nconst rows = fs.readFileSync('C:/Users/User/Downloads/ga-export.csv', 'utf8').split('\\n').map(l => l.split(','));\nconst top = rows.filter(r => Number(r[2]) > 100);\nfs.writeFileSync('.tmp/ga-top.json', JSON.stringify(top, null, 2));\nconsole.log(top.length);\n\""), false);
t("[R4] review 05: a script that writes only inside, or only reads, stays allowed", bash("python -c \"\nimport csv, json\nrows = list(csv.DictReader(open('C:/Users/User/Downloads/ga-pages.csv', encoding='utf-8')))\ntop = [r for r in rows if int(r['views']) > 50]\njson.dump(top, open('.tmp/ga-pages-top.json', 'w'), indent=2)\nprint(len(top), 'pages over 50 views')\n\""), false);
t("[R4] review 06: a script that writes only inside, or only reads, stays allowed", ps("node -e '\nconst fs = require(\"fs\");\nconst rows = fs.readFileSync(\"C:/Users/User/Downloads/ga.csv\", \"utf8\").split(\"\\n\");\nfs.writeFileSync(\".tmp/ga-rows.txt\", String(rows.length));\nconsole.log(rows.length);\n'"), false);
t("[R4] review 07: a script that writes only inside, or only reads, stays allowed", bash("python -c \"\nimport subprocess, json\nurls = ['/', '/projects/', '/articles/', '/about/']\nres = {}\nfor u in urls:\n    r = subprocess.run(['curl', '-s', '-o', '/dev/null', '-w', '%{http_code}', 'http://localhost:4321' + u], capture_output=True, text=True)\n    res[u] = r.stdout\nprint(json.dumps(res))\n\""), false);
t("[R4] review 08: a script that writes only inside, or only reads, stays allowed", bash("node -e \"\nconst fs = require('fs');\nconst html = fs.readFileSync('dist/index.html', 'utf8');\nconst want = ['/projects/', '/articles/', '/about/'];\nconst missing = want.filter(w => !html.includes('href=\\\"' + w));\nfs.writeFileSync('.tmp/missing-links.json', JSON.stringify(missing));\nconsole.log(missing.length > 0 ? 'missing: ' + missing.join(', ') : 'all links present');\n\""), false);
t("[R4] review 09: a script that writes only inside, or only reads, stays allowed", bash("node -e \"\nconst fs = require('fs');\nconst redirects = fs.readFileSync('public/_redirects', 'utf8').trim().split('\\n').map(l => l.split(/\\s+/));\nconst bad = redirects.filter(([from, to]) => !from.startsWith('/') || !to.startsWith('/articles/'));\nfs.writeFileSync('.tmp/bad-redirects.json', JSON.stringify(bad, null, 2));\nconsole.log(bad.length);\n\""), false);
t("[R4] review 10: a script that writes only inside, or only reads, stays allowed", bash("node -e \"\nconst { execSync } = require('child_process');\nlet out = '';\ntry { out = execSync('npx astro check', { encoding: 'utf8' }); } catch (e) { out = e.stdout || ''; }\nconst ours = out.split('\\n').filter(l => l.includes('/src/') && /error/i.test(l));\nconsole.log(ours.length > 0 ? ours.join('\\n') : 'no errors in src');\n\""), false);
t("[R4] review 11: a script that writes only inside, or only reads, stays allowed", bash("python -c \"\nimport re, json\nurls = [l.strip() for l in open('dist/sitemap-0.xml', encoding='utf-8') if '<loc>' in l]\nurls = [re.sub(r'/+$', '', re.sub(r'</?loc>', '', u)) for u in urls]\njson.dump(urls, open('.tmp/sitemap-urls.json', 'w'), indent=2)\nprint(len(urls))\n\""), false);
t("[R4] review 12: a script that writes only inside, or only reads, stays allowed", bash("node -e \"const fs=require('fs'),os=require('os'),path=require('path'); fs.copyFileSync(path.join(os.homedir(),'Downloads','hero.png'),'public/media/hero.png')\""), false);
t("[R4] review 13: a script that writes only inside, or only reads, stays allowed", bash("python -c \"import os, shutil; shutil.copy(os.path.expanduser('~/Downloads/report.csv'), '.tmp/report.csv')\""), false);
t("[R4] review 14: a script that writes only inside, or only reads, stays allowed", bash("node -e \"const fs=require('fs'),os=require('os'),path=require('path'); fs.writeFileSync('.tmp/claude-settings-copy.json', fs.readFileSync(path.join(os.homedir(),'.claude','settings.json'),'utf8'))\""), false);
t("[R4] review 15: a script that writes only inside, or only reads, stays allowed", ps("python -c \"import os, shutil; shutil.copy(os.path.join(os.environ['USERPROFILE'], 'Downloads', 'hero.png'), 'public/media/hero.png')\""), false);
t("[R4] review 16: a script that writes only inside, or only reads, stays allowed", bash("python -c \"from pathlib import Path; Path('.tmp/hero.png').write_bytes((Path.home() / 'Downloads' / 'hero.png').read_bytes())\""), false);
t("[R4] review 17: a script that writes only inside, or only reads, stays allowed", bash("node -e \"const fs=require('fs'),os=require('os'),path=require('path'); const files=fs.readdirSync('src/content/projects').map(f=>path.resolve('src/content/projects',f)); fs.writeFileSync('.tmp/project-files.txt', files.map(f => path.relative(os.homedir(), f)).join('\\n'))\""), false);
t("[R4] review 18: a script that writes only inside, or only reads, stays allowed", bash("node -e \"const src=require('fs').readFileSync('scripts/path-guard.mjs','utf8'); console.log(src.split('\\n').filter(l => l.includes('writeFileSync(') || l.includes('homedir(')).length)\""), false);
t("[R4] review 19: a script that writes only inside, or only reads, stays allowed", bash("cd \"J:\\Projects\\Rotem E\" && node -e \"require('fs').writeFileSync('.tmp/stamp.txt', new Date().toISOString())\""), false);
t("[R4] review 20: a script that writes only inside, or only reads, stays allowed", bash("cd /c/Users/User/Downloads && node -e \"require('fs').copyFileSync('hero.png', 'J:/Projects/Rotem E/public/media/hero.png')\""), false);
t("[R4] review 21: a script that writes only inside, or only reads, stays allowed", bash("node -e \"const {execSync}=require('child_process'); const fs=require('fs'); const pages=execSync('git ls-files src/pages').toString().trim().split('\\n'); fs.writeFileSync('.tmp/routes.html', '<h1>Routes</h1><ul><li>/</li>' + pages.map(p => '<li>' + p + '</li>').join('') + '</ul>')\""), false);
t("[R4] review 22: a script that writes only inside, or only reads, stays allowed", bash("node -e 'const {execSync}=require(\"child_process\"); const fs=require(\"fs\"); const pages=execSync(\"git ls-files src/content/projects\").toString().trim().split(\"\\n\").map(p => p.split(\"/\").pop().replace(\".yaml\", \"\")); fs.writeFileSync(\".tmp/projects.html\", pages.map(p => `<li><a href=\"/projects/${p}/\">/projects/${p}/</a></li>`).join(\"\"))'"), false);
t('[R4] a write whose destination is a template literal outside the project', bash("node -e '\nconst raw = \"a>b>c\";\nconst clean = raw.replace(/>/g, \"\");\nrequire(\"fs\").writeFileSync(`C:/Users/User/report.txt`, clean)\n'"), true);
t('[R4] a relative redirect escaping the folder inside an execSync string', bash("node -e \"\nconst raw = 'x>y';\nconst clean = raw.replace(/>/g, '');\nrequire('child_process').execSync('echo x > ../evil.txt')\n\""), true);
t('[R4] the same one-line relative escape', bash("node -e \"require('child_process').execSync('echo x > ../evil.txt')\""), true);
t('[R4] a backslash path in double quotes keeps its backslashes (cd into the project)', bash('cd "J:\\Projects\\Rotem E" && echo x > .tmp/a.txt'), false);
t('[R4] a backslash path in double quotes outside the project is still refused', bash('echo x > "C:\\Users\\User\\x.txt"'), true);
// [R5] The final review (2026-09-24): commands kept in variables, write calls the
// list did not name, quoted > in sed and grep patterns, and a subshell cd.
t("[R5] review 01: a bash command kept in a Python variable, run through bash -c", bash("python -c \"\nimport subprocess\ncmd = '''\necho hi > C:/Users/User/pg-triple-bash.txt\n'''\nsubprocess.run(['bash', '-c', cmd])\n\""), true);
t("[R5] review 02: a bash script kept in a JavaScript variable, run by execSync with bash", bash("node -e '\nconst { execSync } = require(\"child_process\");\nconst script = `\nmkdir -p /c/Users/User/pg-tpl\necho hi > /c/Users/User/pg-tpl/x.txt\n`;\nexecSync(script, { shell: \"bash\" });\n'"), true);
t("[R5] review 03: a write to a path built from the home folder through a callback", bash("node -e '\nconst fs = require(\"fs\"), os = require(\"os\");\nconst home = os.homedir();\nconst files = [\"a.txt\", \"b.txt\"].map(n => `${home}/${n}`);\nfiles.forEach(p => fs.writeFileSync(p, \"hi\"));\n'"), true);
t("[R5] review 04: openSync for writing after a cd outside the project", bash("cd /c/Users/User && node -e \"\nconst fs = require('fs');\n['a'].forEach((n) => fs.closeSync(fs.openSync(n + '.txt', 'w')));\n\""), true);
t("[R5] review 05: a pathlib touch after a cd outside the project", bash("cd /c/Users/User && python -c \"\nfrom pathlib import Path\nfor n in ['a', 'b']: Path(n + '.txt').touch() if len(n) > 0 else None\n\""), true);
t("[R5] review 07: an argument list with a > in a sed pattern (no shell reads it)", bash("python -c \"import subprocess; out = subprocess.check_output(['sed', '-e', 's/<[^>]*>//g', 'dist/index.html'], text=True); print(len(out.split()))\""), false);
t("[R5] review 09: execSync with a > inside a double-quoted sed pattern", bash("node -e 'const {execSync} = require(\"child_process\"); console.log(execSync(\"sed -n \\\"s/.*<title>\\\\(.*\\\\)<\\\\/title>.*/\\\\1/p\\\" dist/index.html\").toString())'"), false);
t("[R5] review 13: execSync with a > inside a double-quoted sed pattern, output kept in .tmp", bash("node -e '\nconst { execSync } = require(\"child_process\");\nconst text = execSync(\"sed -e \\\"s/<[^>]*>//g\\\" dist/about/index.html\", { encoding: \"utf8\" });\nrequire(\"fs\").writeFileSync(\".tmp/about.txt\", text);\nconsole.log(text.split(/\\s+/).length);\n'"), false);
t("[R5] review 14: a one-line script that only reads a backslash path in the home folder", bash("python -c \"import json; d = json.load(open(r'C:\\Users\\User\\.claude\\settings.json')); print(list(d.get('hooks', {}).keys()))\""), false);
t("[R5] review 15: a script that reads the home folder and writes a literal path under .tmp", bash("python -c \"\nimport os\nfrom pathlib import Path\nwith open(os.path.expanduser('~/.claude/settings.json')) as f: Path('.tmp/settings-copy.json').write_text(f.read())\nprint('copied')\n\""), false);
t("[R5] review 17: a write after a subshell that left the folder", bash("(cd /c/Users/User/Downloads && ls *.png) && node -e \"const fs=require('fs'),path=require('path'); fs.writeFileSync(path.join('.tmp','downloads-seen.txt'), 'ok')\""), false);
t("[R5] a one-line command kept in a variable, then run through bash -c", bash("python -c \"import subprocess; cmd = 'echo hi > C:/Users/User/x.txt'; subprocess.run(['bash', '-c', cmd])\""), true);
t("[R5] a mkdir inside a command string handed to bash", bash("node -e \"require('child_process').execSync('mkdir -p /c/Users/User/pg', { shell: 'bash' })\""), true);
t("[R5] a file opened for update (r+) outside the project", bash("python -c \"\nf = open('C:/Users/User/x.txt', 'r+')\nf.write('y')\n\""), true);
t("[R5] a pathlib touch outside the project", bash("python -c \"\nfrom pathlib import Path\nPath('C:/Users/User/x.txt').touch()\n\""), true);
t("[R5] a nested node script started through spawnSync", bash("node -e \"\nconst cp = require('child_process');\ncp.spawnSync('node', ['-e', 'require(\\'fs\\').writeFileSync(\\'C:/Users/User/x.txt\\', \\'y\\')']);\n\""), true);
t("[R5] a move that takes a file out of a folder outside the project", bash("node -e \"\nrequire('fs').renameSync('C:/Users/User/a.txt', '.tmp/a.txt')\n\""), true);
t("[R5] a cd inside a subshell still guards the writes inside it", bash("(cd /c/Users/User && touch x)"), true);
t("[R5] an f-string destination whose fixed start is outside", bash("python -c \"\nfor n in ['a', 'b']:\n    open(f'C:/Users/User/{n}.txt', 'w').write('x')\n\""), true);
t("[R5] a command given to cmd through spawnSync", bash("node -e \"\nrequire('child_process').spawnSync('cmd', ['/c', 'echo hi > C:\\\\Users\\\\User\\\\x.txt']);\n\""), true);
t("[R5] an execSync that only reads, with an arrow after it", bash("node -e \"\nconst { execSync } = require('child_process');\nconst out = execSync('git log --oneline -5', { encoding: 'utf8' });\nconsole.log(out.split('\\n').map(l => l.slice(0, 7)).join(', '));\n\""), false);
t("[R5] a regular expression's exec is not a process", bash("node -e \"\nconst m = /<title>(.*)<\\/title>/.exec(require('fs').readFileSync('dist/index.html', 'utf8'));\nconsole.log(m && m[1]);\n\""), false);
t("[R5] a pathlib mkdir with keyword arguments in a script that reads the home folder", bash("python -c \"\nimport os\nfrom pathlib import Path\nsrc = os.path.expanduser('~/Downloads/a.csv')\nPath('.tmp/csv').mkdir(parents=True, exist_ok=True)\nPath('.tmp/csv/a.csv').write_text(open(src).read())\n\""), false);
t("[R5] copies from the home folder into a path.join under .tmp", bash("node -e \"\nconst fs = require('fs'), os = require('os'), path = require('path');\nfor (const n of fs.readdirSync(path.join(os.homedir(), 'Downloads')).filter(f => f.endsWith('.png'))) fs.copyFileSync(path.join(os.homedir(), 'Downloads', n), path.join('.tmp', n));\n\""), false);
t("[R5] a redirect after a subshell that left the folder", bash("(cd /c/Users/User/Downloads && ls *.png) && echo ok > .tmp/seen.txt"), false);
t("[R5] an argument list handed to a program with no shell", bash("python -c \"\nimport subprocess\nout = subprocess.run(['grep', '-c', '<h1>', 'dist/index.html'], capture_output=True, text=True).stdout\nprint(out)\n\""), false);
t("[R5] execSync with shell true and an outside redirect", bash("node -e \"require('child_process').execSync('echo x > C:/Users/User/a.txt', { shell: true })\""), true);
t("[R5] execFileSync bash -lc with the command in a variable", bash("node -e \"\nconst cp = require('child_process');\nlet cmd = 'echo x > /c/Users/User/a.txt';\ncp.execFileSync('bash', ['-lc', cmd]);\n\""), true);
t("[R5] subprocess with shell=True and an outside redirect", bash("python -c \"import subprocess; subprocess.run('echo x > C:/Users/User/a.txt', shell=True)\""), true);
t("[R5] an f-string shell command whose target comes from the home folder", bash("python -c \"\nimport os, subprocess\nhome = os.path.expanduser('~')\nsubprocess.run(f'echo x > {home}/a.txt', shell=True)\n\""), true);
t("[R5] a cd inside os.system, then a relative write", bash("python -c \"import os; os.system('cd /c/Users/User && touch x')\""), true);
t("[R5] a nested python script started through subprocess with an argument list", bash("python -c \"\nimport subprocess\nsubprocess.run(['python', '-c', \\\"open('C:/Users/User/x.txt', 'w').write('y')\\\"])\n\""), true);
t("[R5] a copy into a folder outside through os.path.join of a literal", bash("python -c \"\nimport shutil, os\nfor n in ['a.png']:\n    shutil.copy(n, os.path.join('C:/Users/User/Desktop', n))\n\""), true);
t("[R5] a write to a variable given an outside literal", bash("node -e \"\nconst out = 'C:/Users/User/report.txt';\nrequire('fs').writeFileSync(out, 'x');\n\""), true);
t("[R5] npm run build through execSync", bash("node -e \"\nconst { execSync } = require('child_process');\nexecSync('npm run build', { stdio: 'inherit' });\nconsole.log(['a', 'b'].map(x => x + '!').join());\n\""), false);
t("[R5] a commit message with a greater-than sign", bash("node -e \"require('child_process').execSync('git commit -m \\\"a > b\\\" --dry-run')\""), false);
t("[R5] an echo of an html tag into .tmp through execSync", bash("node -e \"require('child_process').execSync(\\\"echo '<b>' > .tmp/x.html\\\")\""), false);
t("[R5] a template command that only reads, with an interpolated count", bash("node -e \"\nconst n = 5;\nconsole.log(require('child_process').execSync(\\`git log -n \\${n} --oneline\\`).toString());\n\""), false);
t("[R5] a variable given an inside literal, after a cd outside", bash("cd /c/Users/User/Downloads && node -e \"\nconst out = 'J:/Projects/Rotem E/.tmp/list.txt';\nrequire('fs').writeFileSync(out, require('fs').readdirSync('.').join('\\n'));\n\""), false);
t("[R5] webbrowser.open is not a file", bash("python -c \"\nimport webbrowser\nwebbrowser.open('http://localhost:4321/')\nprint('w')\n\""), false);
t("[R5] Image.open reads a picture", bash("python -c \"\nfrom PIL import Image\nim = Image.open('public/media/a.png')\nprint(im.size)\n\""), false);

console.log('path-guard: writing programs (bash)');
t('cp into the project', bash('cp a.png public/media/a.png'), false);
t('cp out of the project', bash(`cp a.png ${OUT}/a.png`), true);
t('cp INTO the project from outside is a read + an inside write', bash(`cp ${OUT}/a.png public/media/a.png`), false);
t('mv out of the project', bash(`mv a.png ${OUT}/a.png`), true);
t('tee out of the project', bash(`node x.mjs | tee ${OUT}/log.txt`), true);
t('touch out of the project', bash(`touch ${OUT}/marker`), true);
t('mkdir out of the project', bash(`mkdir -p ${OUT}/sub`), true);
t('dd out of the project', bash(`dd if=a.bin of=${OUT}/a.bin`), true);
t('[R] touch with a POSIX-absolute path', bash('touch /c/Users/User/pwned.txt'), true);
t('[R] cp to /tmp', bash('cp -r src /tmp/backup'), true);
t('[R] tee to a POSIX-absolute path', bash('node x.mjs | tee /c/Users/User/pwned.txt'), true);
t('[R] mkdir -p with a POSIX-absolute path', bash('mkdir -p /c/Users/User/evil'), true);
t('[R] rsync to a POSIX-absolute path', bash('rsync -a src/ /c/Users/User/backup/'), true);
t('[R] a POSIX-absolute path INSIDE the project is fine', bash('cp a.png "/j/Projects/Rotem E/public/media/a.png"'), false);
t('[R] a target with a space, quoted', bash('cp package.json "C:/Users/User/My Docs/pwned.json"'), true);
t('[R] a target with a space, backslash-escaped', bash('touch C:/Users/User/My\\ Docs/pwned.txt'), true);
t('[R] a spaced target inside the project is fine', bash('cp a.png "public/media/my folder/a.png"'), false);
t('[R] sed -i on a file outside', bash(`sed -i 's/a/b/' ${OUT}/x.txt`), true);
t('sed without -i is a read', bash(`sed 's/a/b/' ${OUT}/x.txt`), false);
t('[R] curl -o outside', bash(`curl -o ${OUT}/x.zip https://example.com/x.zip`), true);
t('[R] wget -O outside', bash(`wget -O ${OUT}/x.zip https://example.com/x.zip`), true);
t('[R] tar -C outside', bash(`tar -xf a.tar -C ${OUT}`), true);
t('[R] git clone into an outside folder', bash(`git clone https://e.com/r.git ${OUT}/r`), true);
t('git clone into the project', bash('git clone https://e.com/r.git .tmp/r'), false);
t('[R] git worktree add outside', bash(`git worktree add ${OUT}/wt`), true);
t('[R] npm --prefix outside', bash(`npm --prefix ${OUT}/app install`), true);
t('[R] ln -s pointing outside is a door out', bash('ln -s /c/Users/User .tmp/escape'), true);
t('[R] node -e writing outside', bash(`node -e "require('fs').writeFileSync('${OUT}/x.txt','x')"`), true);
t('node -e writing inside', bash("node -e \"require('fs').writeFileSync('.tmp/x.txt','x')\""), false);
t('[R] python -c writing outside', bash(`python -c "open('${OUT}/x.txt','w').write('x')"`), true);

console.log('path-guard: writing cmdlets (PowerShell)');
t('Copy-Item out of the project', ps(`Copy-Item a.png ${OUT}/a.png`), true);
t('Copy-Item with -Destination out of the project', ps(`Copy-Item -Path a.png -Destination ${OUT}/a.png`), true);
t('[R] Copy-Item INTO the project from outside', ps(`Copy-Item -Path ${OUT}/shot.png -Destination public/media/shot.png`), false);
t('[R] Move-Item INTO the project from outside', ps(`Move-Item -LiteralPath ${OUT}/shot.png -Destination public/media/shot.png`), false);
t('Set-Content out of the project', ps(`Set-Content -Path ${OUT}/x.txt -Value hi`), true);
t('Set-Content inside the project', ps('Set-Content -Path src/data/x.json -Value hi'), false);
t('Out-File out of the project', ps(`Get-Date | Out-File ${OUT}/d.txt`), true);
t('New-Item out of the project', ps(`New-Item -ItemType File ${OUT}/x.txt`), true);
t('New-Item inside the project', ps('New-Item -ItemType Directory .tmp/sub'), false);
t('Move-Item out of the project', ps(`Move-Item a.png ${OUT}/a.png`), true);
t('[R] the cp alias out of the project', ps(`cp package.json ${OUT}/pwned.json`), true);
t('[R] the mv alias out of the project', ps(`mv package.json ${OUT}/pwned.json`), true);
t('[R] the rni alias out of the project', ps(`rni package.json ${OUT}/pwned.json`), true);
t('[R] -Destination:Value colon form', ps(`Copy-Item package.json -Destination:${OUT}/pwned.json`), true);
t('[R] -FilePath:Value colon form', ps(`Get-Date | Out-File -FilePath:${OUT}/pwned.txt`), true);
t('[R] -Path:Value colon form', ps(`Set-Content -Path:${OUT}/x.txt -Value hi`), true);
t('[R] a -Value payload that looks like a path is content, not a target', ps(`Set-Content .tmp/x.txt -Value "${OUT}/note.txt"`), false);
t('[R] Compress-Archive to an outside destination', ps(`Compress-Archive -Path src -DestinationPath ${OUT}/repo.zip`), true);
t('[R] Invoke-WebRequest -OutFile outside', ps(`Invoke-WebRequest https://e.com/x -OutFile ${OUT}/x`), true);
t('[R] a junction pointing outside', ps(`New-Item -ItemType Junction -Path .tmp/escape -Target ${OUT}`), true);
t('[R] Set-Content to a bare drive root', ps('Set-Content /pwned.txt -Value hi'), true);

// [R6] Review 2026-09-25: a clone is read in PowerShell as well as bash, the
// word after a redirection is never a destination, git option values are not
// folders, and a project starter is checked where it writes.
console.log('path-guard: git, project starters and trailing redirections');
t('[R6] PowerShell clone into an outside folder', ps('git clone https://e.com/r.git C:\\Users\\User\\r'), true);
t('[R6] PowerShell clone into the home folder by variable', ps('git clone https://e.com/r.git "$env:USERPROFILE\\.claude\\skills\\projectos"'), true);
t('[R6] PowerShell clone into the project', ps('git clone --depth 1 https://e.com/r.git .tmp\\r'), false);
t('[R6] clone with no destination after a cd out', bash('cd /c/Users/User && git clone https://e.com/r.git'), true);
t('[R6] clone with no destination after Set-Location out', ps('Set-Location C:\\Users\\User; git clone https://e.com/r.git'), true);
t('[R6] clone with no destination after Push-Location out', ps('Push-Location C:\\Users\\User; git clone https://e.com/r.git'), true);
t('[R6] clone with no destination after PowerShell cd..', ps('cd..; git clone https://e.com/r.git'), true);
t('[R6] clone with no destination after a bare drive change', ps('C:; git clone https://e.com/r.git'), true);
t('[R6] clone with no destination after a bare cd home', bash('cd && git clone https://e.com/r.git'), true);
t('[R6] clone with no destination, inside the project', bash('git clone https://e.com/r.git'), false);
t('[R6] clone outside with a trailing 2>&1', bash(`git clone https://e.com/r.git ${OUT}/r 2>&1`), true);
t('[R6] clone outside with 2>&1 piped to tail', bash(`git clone https://e.com/r.git ${OUT}/r 2>&1 | tail -5`), true);
t('[R6] PowerShell clone outside with a trailing 2>&1', ps('git clone https://e.com/r.git C:\\Users\\User\\r 2>&1'), true);
t('[R6] clone outside with its log sent inside', bash(`git clone https://e.com/r.git ${OUT}/r > .tmp/log.txt`), true);
t('[R6] clone outside with an option after the folder', bash(`git clone https://e.com/r.git ${OUT}/r --depth 1`), true);
t('[R6] clone outside behind a git -c setting', bash(`git -c http.sslVerify=false clone https://e.com/r.git ${OUT}/r`), true);
t('[R6] git -C an outside folder, then clone', bash('git -C C:/Users/User clone https://e.com/r.git'), true);
t('[R6] git -C an outside folder, then clone to a relative name', bash('git -C /c/Users/User clone https://e.com/r.git r'), true);
t('[R6] clone --depth 1 into .tmp', bash('git clone --depth 1 https://e.com/r.git .tmp/x'), false);
t('[R6] clone -b main from a local source lands inside', bash('git clone -b main /c/src/repo'), false);
t('[R6] clone -b main --single-branch into .tmp, 2>&1 piped', bash('git clone -b main --single-branch https://e.com/r.git .tmp/r 2>&1 | tail -2'), false);
t('[R6] git init in an outside folder', bash(`git init ${OUT}/newrepo`), true);
t('[R6] git init -b main in an outside folder', bash(`git init -b main ${OUT}/newrepo`), true);
t('[R6] git init after a cd out', bash('cd /tmp && git init'), true);
t('[R6] git init with its git folder outside', bash(`git init --separate-git-dir ${OUT}/g.git`), true);
t('[R6] git init inside the project', bash('git init .tmp/r'), false);
t('[R6] worktree add -b to a sibling folder', bash('git worktree add -b feat ../proj-feat'), true);
t('[R6] worktree add -b to an outside folder', bash(`git worktree add -b feat ${OUT}/wt`), true);
t('[R6] worktree add -b inside the project', bash('git worktree add -b feat .claude/worktrees/feat'), false);
t('[R6] worktree add inside with -b after the folder', bash('git worktree add .claude/worktrees/feat -b feat'), false);
t('[R6] cp outside with a trailing 2>&1', bash(`cp a.txt ${OUT}/b.txt 2>&1`), true);
t('[R6] mv outside with a trailing 2>&1', bash(`mv a.txt ${OUT}/b.txt 2>&1`), true);
t('[R6] rsync outside with a trailing 2>&1', bash(`rsync -a src/ ${OUT}/dst/ 2>&1`), true);
t('[R6] Copy-Item outside with a trailing 2>&1', ps('Copy-Item a.txt C:\\Users\\User\\b.txt 2>&1'), true);
t('[R6] cp inside with a trailing 2>&1', bash('cp a.txt .tmp/b.txt 2>&1'), false);
t('[R6] npm init after a cd out', bash('cd /tmp && npm init -y'), true);
t('[R6] npm init after Set-Location out', ps('Set-Location C:\\Users\\User; npm init -y'), true);
t('[R6] degit into an outside folder', bash(`npx degit user/repo ${OUT}/site`), true);
t('[R6] npm create into an outside folder', bash(`npm create vite@latest ${OUT}/app`), true);
t('[R6] npm init inside the project', bash('npm init -y 2>&1'), false);
t('[R6] npx create-astro into .tmp', bash('npx create-astro@latest .tmp/site --template minimal'), false);
t('[R6] degit into .tmp', bash('npx degit user/repo .tmp/ref'), false);
t('[R6] py -c writing outside', ps(`py -c "open('${OUT}/x.txt','w').write('x')"`), true);
t('[R6] py -c that writes nothing', ps('py -c "print(1)"'), false);
t('[R6] everyday: git status piped with 2>&1', bash('git status --short 2>&1 | head -20'), false);
t('[R6] everyday: git commit with 2>&1', bash('git commit -m "Fix the header" 2>&1'), false);
t('[R6] everyday: git log -c', bash('git log -c -- src/lib/media.ts'), false);
t('[R6] everyday: git -c setting before status', bash('git -c core.quotepath=off status'), false);
t('[R6] everyday: git -C the project folder', bash('git -C "J:/Projects/Rotem E" status'), false);
t('[R6] everyday: git -C the kit folder, pull', bash('git -C "C:/Users/User/.claude/skills/projectos" pull'), false);
t('[R6] everyday: checkout -b and switch -c', bash('git checkout -b feat && git switch -c feat2'), false);
t('[R6] everyday: push -u with 2>&1', ps('git push -u origin main 2>&1'), false);
t('[R6] everyday: a bare cd, then a read', bash('cd; ls'), false);

console.log('path-guard: reads and non-writes are never touched');
t('reading a file outside the project', bash(`cat ${OUT}/log.txt`), false);
t('listing a folder outside the project', ps(`Get-ChildItem ${OUT}`), false);
t('Get-Content outside the project', ps(`Get-Content ${OUT}/x.txt`), false);
t('an ordinary build', bash('npm run build'), false);
t('a git commit whose message mentions an outside path', bash(`git commit -m "moved off ${OUT}/old.txt"`), false);
t('a grep for an outside path', bash(`rg "${OUT}" src`), false);
t('a plain git status', bash('git status --short'), false);
t('npm test', ps('npm test'), false);

console.log('path-guard: ambiguity blocks');
t('a target built from a variable', ps('Set-Content -Path $m -Value hi'), true);
t('a target built from a bash variable', bash('cp a.png "$DEST/a.png"'), true);
t('a target using ~', bash('cp a.png ~/a.png'), true);
t('a target using %TEMP%', ps('Copy-Item a.png %TEMP%/a.png'), true);
t('a Write tool path built from a variable', write('$HOME/x.md'), true);

console.log('path-guard: wrappers and inline shells');
t('bash -c hiding an outside write', bash(`bash -c "echo hi > ${OUT}/x.txt"`), true);
t('[R] bash -lc hiding an outside write', bash(`bash -lc "echo hi > ${OUT}/x.txt"`), true);
t('[R] sh -ec hiding an outside write', bash(`sh -ec "echo hi > ${OUT}/x.txt"`), true);
t('powershell -Command hiding an outside write', ps(`powershell -Command "Set-Content -Path ${OUT}/x.txt -Value hi"`), true);
t('bash -c writing inside the project', bash('bash -c "echo hi > plans/x.txt"'), false);
t('[R] env in front of a writer', bash(`env tee ${OUT}/pwned.txt`), true);
t('[R] nohup in front of a writer', bash(`nohup tee ${OUT}/pwned.txt`), true);
t('[R] timeout in front of a writer', bash(`timeout 5 tee ${OUT}/x.txt`), true);
t('[R] time in front of a writer', bash(`time cp a.txt ${OUT}/pwned.txt`), true);
t('[R] an unreadable encoded PowerShell command', ps('powershell -NoProfile -EncodedCommand ####'), true);

console.log('path-guard: a directory change moves the target');
t('[R7] Pop-Location returns to where Push-Location left, so a parent path is outside again', ps('Push-Location src; Pop-Location; Set-Content ..\\evil.txt -Value x'), true);
t('[R7] a push outside and a pop back, then a write into .tmp', ps('Push-Location C:/Users/User; Pop-Location; Set-Content .tmp\\x.txt -Value x'), false);
t('[R7] bash popd returns to where pushd left', bash('pushd src && popd && echo x > ../evil.txt'), true);
t('[R7] bash pushd outside and popd back, then a write into .tmp', bash('pushd /c/Users/User && popd && echo x > .tmp/x.txt'), false);
t('[R] cd outside, then a relative write', bash('cd /c/Users/User && echo pwned > pwned.txt'), true);
t('[R] cd .. then a relative write', bash('cd .. && echo pwned > escaped.txt'), true);
t('[R] Set-Location outside, then a relative write', ps('Set-Location C:/Users/User; Set-Content pwned.txt -Value hi'), true);
t('cd inside the project, then a relative write', bash('cd src && echo hi > x.ts'), false);
t('[R] cd to an unprovable place, then a relative write', bash('cd "$SOMEWHERE" && echo hi > x.txt'), true);

// [R8] Review 2026-09-25, second round: a bash brace list is every word bash
// makes of it, the directory stack is followed only in its plain forms, and a
// `)` that closes a subshell or a group is not part of a redirection target.
console.log('path-guard: brace lists, the directory stack and a closing parenthesis');
t('[R8] a brace list with an outside word, touch', bash('touch {a,/c/Users/User/Desktop/b}.txt'), true);
t('[R8] a brace list with an outside word, mkdir -p', bash('mkdir -p {.tmp/x,/c/Users/User/Desktop/y}'), true);
t('[R8] a brace list as the cp destination', bash('cp a.txt {.tmp,/c/Users/User/Desktop}'), true);
t('[R8] a brace list that climbs out of the folder', bash('touch {a,../../x}'), true);
t('[R8] a nested brace list with an outside word', bash('touch {a,{c,/c/Users/User/x}}'), true);
t('[R8] a redirection to a brace list that leaves one outside word', bash('echo hi > {,/c/Users/User/x.txt}'), true);
t('[R8] a dd of= brace list with an outside word', bash('dd if=a.bin of={.tmp/a.bin,/c/Users/User/a.bin}'), true);
t('[R8] dd with a second of= outside, the one dd writes to', bash('dd if=a.bin of=.tmp/a.bin of=/c/Users/User/a.bin'), true);
t('[R8] sed -i on a brace list with an outside word', bash('sed -i s/a/b/ {x,/c/Users/User/y}'), true);
t('[R8] a cd to a brace list fails, so the folder is unknown', bash('cd /c/Users/User; cd {"/j/Projects/Rotem E",x}; echo x > f.txt'), true);
t('[R8] a cd to a number sequence fails the same way', bash('cd /c/Users/User; cd "/j/Projects/Rotem E/"{1..2}; echo x > f.txt'), true);
t('[R8] a letter sequence is spelled out', bash('touch {b..a}/../../x'), true);
t('[R8] a brace list too long to spell out is unprovable', bash('touch x{a..z}{a..z}{a..z}'), true);
t('[R8] mkdir -p .tmp/{a,b} stays allowed', bash('mkdir -p .tmp/{a,b}'), false);
t('[R8] sequences inside the project stay allowed', bash('mkdir -p .tmp/{a..c} .tmp/d{1..3}'), false);
t('[R8] cp into a brace list inside the project', bash('cp a.txt .tmp/{b,c}.txt'), false);
t('[R8] a nested list whose words all stay inside', bash('touch {a,b{c,/c/Users/User/x}}'), false);
t('[R8] a single-quoted brace list is one literal name', bash("touch '{a,/c/Users/User/b}.txt'"), false);
t('[R8] a double-quoted brace list is one literal name', bash('touch "{a,/c/Users/User/b}.txt"'), false);
t('[R8] an escaped brace list is one literal name', bash('touch \\{a,/c/Users/User/b\\}.txt'), false);
t('[R8] a redirection to a brace list that leaves one inside word', bash('echo hi > {,.tmp/x.txt}'), false);
t('[R8] find -exec {} is not a brace list', bash("find . -name '*.md' -exec cp {} .tmp/ \\;"), false);
t('[R8] ${VAR} is not a brace list', bash('echo ${HOME} > .tmp/h.txt'), false);
t('[R8] an unquoted JSON body is not a destination', bash('curl -d {"a":1,"b":2} https://e.com -o .tmp/x.json'), false);
t('[R8] PowerShell does not expand braces', ps('Set-Content -Path .tmp\\{a,b}.txt -Value x'), false);

t('[R8] popd -n does not move, so the folder is unknown', bash('pushd /c/Users/User/Desktop && popd -n && echo x > f.txt'), true);
t('[R8] pushd -n does not move, and a later popd is unknown', bash('pushd -n /c/Users/User/Desktop; popd; echo x > f.txt'), true);
t('[R8] pushd +1 rotates the stack back outside', bash('cd /c/Users/User && pushd "/j/Projects/Rotem E" && pushd +1 && echo x > f.txt'), true);
t('[R8] pushd +1 after two pushes', bash('pushd /c/Users/User/Desktop && pushd "/j/Projects/Rotem E" && pushd +1 && echo x > a.txt'), true);
t('[R8] a bare pushd swaps the top two folders', bash('pushd /c/Users/User/Desktop; pushd; popd; popd; echo x > f.txt'), true);
t('[R8] a pushd inside a subshell is gone after it', bash('cd /c/Users/User; (cd "/j/Projects/Rotem E"; pushd .tmp); popd; echo x > f.txt'), true);
t('[R8] dirs -c empties the stack', bash('pushd /c/Users/User/Desktop; dirs -c; popd; echo x > f.txt'), true);
t('[R8] a pushd inside bash -c with popd -n', bash('bash -c "pushd .tmp && popd -n && echo x > y"'), true);
t('[R8] a plain pushd and popd with their output sent to /dev/null', bash('pushd .tmp > /dev/null && echo x > a.txt && popd > /dev/null && echo y > .tmp/b.txt'), false);
t('[R8] a popd inside a subshell leaves the outer stack whole', bash('pushd /c/Users/User/Desktop; (popd; true); popd; echo x > .tmp/f.txt'), false);
t('[R8] dirs with no flag changes nothing', bash('pushd /c/Users/User; dirs; popd; echo x > .tmp/f.txt'), false);

t('[R8] PowerShell: the -StackName value is not the folder', ps('Push-Location -StackName s C:\\Users\\User\\Desktop; Set-Content x.txt hi'), true);
t('[R8] PowerShell: -StackName with -Path', ps('Push-Location -StackName s -Path C:\\Users\\User\\Desktop; Set-Content x.txt hi'), true);
t('[R8] PowerShell: a push to a named stack, then a default pop', ps('Push-Location C:\\Users\\User\\Desktop -StackName s; Pop-Location; Set-Content x.txt hi'), true);
t('[R8] PowerShell: -StackName after -Path, then a default pop', ps('Push-Location -Path C:/Users/User -StackName s; Pop-Location; Set-Content f.txt x'), true);
t('[R8] PowerShell: a pop from a named stack', ps('Push-Location C:\\Users\\User\\Desktop; Pop-Location -StackName other; Set-Content x.txt hi'), true);
t('[R8] PowerShell: -StackName:s glued', ps('Push-Location -StackName:s C:\\Users\\User\\Desktop; Set-Content x.txt hi'), true);
t('[R8] PowerShell: -StackName shortened to -st', ps('Push-Location -st s C:\\Users\\User\\Desktop; Set-Content x.txt hi'), true);
t('[R8] PowerShell: Set-Location -StackName changes the stack a pop uses', ps('Set-Location -StackName s; Pop-Location; Set-Content x.txt hi'), true);
t('[R8] PowerShell: Set-Location -Path:value glued, outside', ps('Set-Location -Path:C:\\Users\\User; Set-Content x.txt hi'), true);
t('[R8] PowerShell: Set-Location -LiteralPath outside', ps('Set-Location -LiteralPath C:\\Users\\User; Set-Content x.txt hi'), true);
t('[R8] PowerShell: a common parameter value before the folder is not the folder', ps('Set-Location -ErrorAction Stop C:\\Users\\User; Set-Content x.txt hi'), true);
t('[R8] PowerShell: Set-Location -Path:value glued, inside', ps('Set-Location -Path:.tmp; Set-Content a.txt x'), false);
t('[R8] PowerShell: Set-Location -LiteralPath into the project', ps('Set-Location -LiteralPath "J:\\Projects\\Rotem E"; Set-Content .tmp\\a.txt x'), false);
t('[R8] PowerShell: Push-Location -Path and a plain Pop-Location', ps('Push-Location -Path .tmp; Set-Content a.txt x; Pop-Location; Set-Content .tmp\\b.txt x'), false);
t('[R8] PowerShell: -PassThru on Push-Location is a switch', ps('Push-Location C:/Users/User -PassThru; Pop-Location; Set-Content .tmp\\x.txt -Value x'), false);
t('[R8] PowerShell: -ErrorAction after the folder', ps('Set-Location .tmp -ErrorAction SilentlyContinue; Set-Content a.txt x'), false);

t('[R8] 2>/dev/null inside $( )', bash('x=$(git rev-parse HEAD 2>/dev/null)'), false);
t('[R8] 2>/dev/null before the ) of a subshell', bash('(echo a 2>/dev/null)'), false);
t('[R8] >/dev/null at the end of a cd subshell', bash('(cd src && ls >/dev/null)'), false);
t('[R8] 2>/dev/null twice in a subshell, piped', bash('(git show A 2>/dev/null || git show B 2>/dev/null) | grep x'), false);
t('[R8] 2>&1 before the ) of a subshell', bash('(node x.mjs 2>&1)'), false);
t('[R8] PowerShell: 2>$null inside $( )', ps('$h = $(git rev-parse HEAD 2>$null)'), false);
t('[R8] PowerShell: 2>$null inside ( )', ps('(git status 2>$null)'), false);
t('[R8] PowerShell: 2>$null in an assigned group', ps('$x = (Get-Content a.txt 2>$null)'), false);
t('[R8] PowerShell: 2>$null in a group with a method after it', ps('$v = (git rev-parse HEAD 2>$null).Trim()'), false);
t('[R8] a quoted outside target in a subshell is still refused', bash('(echo a > "C:/Windows/x")'), true);
t('[R8] an outside target inside $( ) is still refused', bash('x=$(ls >/tmp/x)'), true);
t('[R8] an escaped ) is part of the file name', bash('(echo a > /dev/null\\))'), true);
t('[R8] PowerShell: an outside target in a group', ps('(Get-Date > C:\\Users\\User\\x.txt)'), true);
t('[R8] PowerShell: an outside target in a group with a property after it', ps('$n = (Get-Date > C:/Users/User/x.txt).Length'), true);

console.log('path-guard: the Monitor tool runs shell commands too');
t('[R] Monitor writing outside', mon(`echo hi > ${OUT}/x.txt`), true);
t('Monitor writing inside', mon('echo hi > .tmp/x.txt'), false);

// On macOS and Linux the project root has no drive letter. There a path that
// starts with `/` is a real path, and `/c/...` is an ordinary folder, not the
// Git Bash spelling of drive C.
console.log('path-guard: a POSIX project root');
const PROOT = '/home/u/app';
const px = (payload) => ({ ...payload, cwd: PROOT });
t('POSIX: a write to a sibling folder is refused', px(write('/home/u/other/x.md')), true);
t('POSIX: a write inside the project is allowed', px(write('/home/u/app/x')), false);
t('POSIX: a relative write inside the project is allowed', px(write('plans/note.md')), false);
t('POSIX: .. cannot climb out of the project', px(write('/home/u/app/../other/x.md')), true);
t('POSIX: a write to /tmp is refused', px(write('/tmp/x.md')), true);
t('POSIX: a shell redirect to a sibling folder is refused', px(bash('echo hi > /home/u/other/x.txt')), true);
t('POSIX: a shell redirect inside the project is allowed', px(bash('echo hi > /home/u/app/.tmp/x.txt')), false);
t('POSIX: cd to a sibling, then a relative write, is refused', px(bash('cd /home/u/other && touch x')), true);
t('POSIX: /c/... is an ordinary folder outside the project', px(write('/c/Users/x.md')), true);
t('POSIX: a project that lives under /c/... is not read as drive C', { ...write('/c/work/app/x.md'), cwd: '/c/work/app' }, false);
t('POSIX: and its sibling under /c/... is still refused', { ...write('/c/work/other/x.md'), cwd: '/c/work/app' }, true);

console.log('path-guard: fail open');
t('null payload', /** @type {any} */ (null), false);
t('no tool_input', { tool_name: 'Bash' }, false);
t('empty command', bash(''), false);
t('an unknown tool', { tool_name: 'WebFetch', tool_input: { url: 'https://x' } }, false);
t('a non-string file_path', { tool_name: 'Write', tool_input: { file_path: 42 } }, false);

console.log('path-guard: the hook contract (run as a real process)');
/** @param {string} name @param {string} stdin @param {number} expected @param {string} [needle] */
function hook(name, stdin, expected, needle) {
  checks += 1;
  const r = spawnSync(process.execPath, [GUARD], { input: stdin, encoding: 'utf8' });
  if (r.status !== expected) {
    failures += 1;
    console.error(`  FAIL ${name}: expected exit ${expected}, got ${r.status}. stderr: ${r.stderr}`);
    return;
  }
  if (needle && !String(r.stderr).includes(needle)) {
    failures += 1;
    console.error(`  FAIL ${name}: stderr did not mention "${needle}". Got: ${r.stderr}`);
  }
}
const payload = (o) => JSON.stringify({ cwd: ROOT, ...o });
hook('an outside write exits 2 with a reason', payload(write(`${OUT}/x.md`)), 2, 'outside the project folder');
hook('an inside write exits 0', payload(write(`${ROOT}/.tmp/x.md`)), 0);
hook('an outside shell write exits 2', payload(bash(`echo hi > ${OUT}/x.txt`)), 2, 'path-guard: blocked');
hook('empty stdin exits 0 (fail open)', '', 0);
hook('garbage stdin exits 0 (fail open)', 'not json at all', 0);
hook('[R8] 2>/dev/null inside $( ) exits 0', payload(bash('x=$(git rev-parse HEAD 2>/dev/null)')), 0);
hook('[R8] a brace list with an outside word exits 2', payload(bash('touch {a,/c/Users/User/Desktop/b}.txt')), 2, 'outside the project folder');
hook('POSIX: a write to a sibling folder exits 2', JSON.stringify({ ...write('/home/u/other/x.md'), cwd: PROOT }), 2, 'outside the project folder');
hook('POSIX: a write inside the project exits 0', JSON.stringify({ ...write('/home/u/app/x'), cwd: PROOT }), 0);

// The root really does come from the session, not from where this file happens
// to live: the property that lets one copy of the guard serve every project.
checks += 1;
{
  const r = spawnSync(process.execPath, [GUARD], {
    input: JSON.stringify({ cwd: 'D:/Some Other Project', tool_input: { file_path: `${ROOT}/plans/x.md` }, tool_name: 'Write' }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: undefined },
  });
  if (r.status !== 2) {
    failures += 1;
    console.error(`  FAIL the project root follows the session: expected exit 2, got ${r.status}`);
  }
}

// The destructive guard beside this file reads inline scripts with these
// helpers. A rename here would switch that check off without a sound.
checks += 1;
{
  const shared = ['INLINE_SCRIPT', 'SCRIPT_SPAWN_CALLS', 'maskStrings', 'callArgs', 'destShape', 'receiverBefore', 'spawnedCommands'];
  const missing = shared.filter((name) => !guardModule[name]);
  if (missing.length > 0) {
    failures += 1;
    console.error(`  FAIL the helpers the destructive guard reuses are exported, missing: ${missing.join(', ')}`);
  }
}

if (failures > 0) {
  console.error(`Path-guard-tests.mjs: ${failures} of ${checks} case(s) failed.`);
  process.exit(1);
}
console.log(`Path-guard-tests.mjs: all ${checks} cases passed.`);
