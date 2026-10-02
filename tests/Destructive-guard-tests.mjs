// Tests for the kit's destructive-command guard,
// project-os/guards/Destructive-guard.mjs.
//
// Run from the kit root:   node tests/Destructive-guard-tests.mjs
// It prints one line per failing case and a count at the end, and exits 1 when
// any case fails.
//
// This folder sits outside project-os/ on purpose: an install copies all of
// project-os/ into a client project, and these tests belong to the kit only.
// Copied from the twin suite in the project the kit grew out of, pointed at the
// kit copy. Only cases that pass today are seeded; a known hole joins the file
// when it is fixed.
//
// Self-contained and NON-destructive: nothing is executed. Each case only
// pipes a hook JSON payload on stdin and asserts the guard's exit code
// (0 = allow, 2 = block) plus, for blocks, that stderr names the expected
// reason. Every case states the tool (Bash / PowerShell / Monitor) explicitly.
// Covers traversal containment, structural git-flag parsing (clusters, order,
// synonyms), rm, /bin/rm and PowerShell aliases, quoted-data false positives,
// fail-open behavior, wrappers, shell keywords and blocks, find, inline
// scripts, function bodies, compact PowerShell blocks, bash brace lists, a
// `)` glued to a delete target, PowerShell backslashes, continued lines,
// PowerShell common parameters and comma lists, Monitor read as bash, git rm
// and worktree remove, wrapped shells and git options with a value, text
// blocks (here-documents, here-strings, block comments), interpreter switches
// and scripts fed through a pipe, wildcard and piped deletes, the install's
// live probe, and a stale Path-guard.mjs beside the guard. Three groups read
// the disk, and they are the parts that write: a scratch folder inside tests/
// holding a git repository and a folder with links, and a copy of the guard
// beside a stub Path-guard.mjs, all removed at the end.
import { execFileSync, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../project-os/guards/Destructive-guard.mjs', import.meta.url));

// The session folder a hook may inherit is left out, so a case without a cwd
// reads the folder the suite runs from, wherever it is run.
const ENV = { ...process.env };
delete ENV.CLAUDE_PROJECT_DIR;

function run(input, script = SCRIPT) {
  try {
    execFileSync(process.execPath, [script], { input, stdio: ['pipe', 'pipe', 'pipe'], env: ENV });
    return { status: 0, stderr: '' };
  } catch (e) {
    return { status: e.status, stderr: String(e.stderr || '') };
  }
}

function payload(command, tool, cwd) {
  return JSON.stringify(cwd ? { tool_name: tool, tool_input: { command }, cwd } : { tool_name: tool, tool_input: { command } });
}

const TMP = os.tmpdir().replace(/\\/g, '/');

// [tool, command, expected exit, expected stderr substring (blocks only)]
const cases = [
  // --- 1. disposable-path containment ---
  ['Bash', 'rm -rf node_modules/../src', 2, 'non-disposable'],
  ['PowerShell', 'Remove-Item -Recurse node_modules\\..\\src', 2, 'non-disposable'],
  ['Bash', 'rm -rf /tmp/../home', 2, 'non-disposable'],
  ['Bash', 'rm -rf backups', 2, 'non-disposable'], // disaster-recovery ZIPs, never disposable
  ['Bash', 'rm -rf "$BUILD_DIR"', 2, 'non-disposable'], // dynamic variable, unprovable
  ['Bash', 'rm -rf $(pwd)/dist/..', 2, 'non-disposable'], // substitution, unprovable
  ['PowerShell', 'Remove-Item -Recurse -Force "$env:TEMP/scratch"', 2, 'non-disposable'], // dynamic, unprovable
  ['Bash', 'rm -rf ~/junk', 2, 'non-disposable'],
  ['Bash', 'rm -rf', 2, 'non-disposable'], // no target at all
  ['Bash', 'rm -rf node_modules', 0],
  ['Bash', 'rm -rf dist .astro', 0],
  ['Bash', 'rm -rf node_modules/.cache/../esbuild', 0], // traversal resolved, stays inside
  ['Bash', 'rm -rf /tmp/conv-lint-abc', 0],
  ['PowerShell', 'Remove-Item -Recurse -Force node_modules', 0],
  ['PowerShell', `Remove-Item -Recurse "${TMP}/claude/scratch"`, 0], // real OS temp dir
  // The project's own scratch folder: cleaning it must work.
  ['Bash', 'rm -rf .tmp', 0],
  ['Bash', 'rm -f .tmp/probe.mjs .tmp/notes.md', 0],
  ['Bash', 'rm -rf .tmp/scratch/probe', 0],
  ['PowerShell', 'Remove-Item -Recurse -Force .tmp/sub', 0],
  ['Bash', 'rm -rf .tmp/../src', 2, 'non-disposable'], // traversal out is still refused
  ['Monitor', 'npm run build && rm -rf src', 2, 'non-disposable'], // later segment still caught

  // --- 2. git parsed structurally ---
  ['Bash', 'git restore --worktree --staged file.yaml', 2, 'restore'],
  ['Bash', 'git restore -W --staged file.yaml', 2, 'restore'],
  ['Bash', 'git restore src/data/legacy-redirects.yaml', 2, 'restore'],
  ['Bash', 'git restore -S file.yaml', 0], // staged-only: safe
  ['Bash', 'git restore --staged file.yaml', 0],
  ['Bash', 'git switch -f main', 2, 'switch'],
  ['Bash', 'git switch --discard-changes main', 2, 'switch'],
  ['Bash', 'git switch main', 0],
  ['Bash', 'git switch -c feature-y', 0],
  ['Bash', 'git checkout -qf main', 2, 'checkout'],
  ['Bash', 'git checkout -f main', 2, 'checkout'],
  ['Bash', 'git checkout -- src/pages/index.astro', 2, 'checkout'],
  ['Bash', 'git checkout .', 2, 'checkout'],
  ['Bash', 'git checkout main', 0],
  ['Bash', 'git checkout -b feature-y', 0],
  ['Bash', 'git push origin +HEAD:main', 2, 'refspec'],
  ['Bash', 'git push origin :feature-x', 2, 'refspec'],
  ['Bash', 'git push -d origin feature', 2, 'remote refs'],
  ['Bash', 'git push origin --delete feature-x', 2, 'remote refs'],
  ['Bash', 'git push --mirror origin', 2, 'remote refs'],
  ['Bash', 'git push --force origin main', 2, 'force push'],
  ['Bash', 'git push -f', 2, 'force push'],
  ['Bash', 'git push --force-with-lease origin main', 2, 'force push'],
  ['Bash', 'git push origin main', 0],
  ['Bash', 'git push origin main:main', 0], // plain refspec, no + or :
  ['Bash', 'git branch -df feature', 2, 'branch'],
  ['Bash', 'git branch -D feature-x', 2, 'branch'],
  ['Bash', 'git branch --delete --force feature', 2, 'branch'],
  ['Bash', 'git branch -d merged-branch', 0], // safe merged-only delete
  ['Bash', 'git branch --list', 0],
  ['Bash', 'git reflog delete HEAD@{0}', 2, 'reflog'],
  ['Bash', 'git reflog expire --expire=now --all', 2, 'reflog'],
  ['Bash', 'git reflog', 0],
  ['Bash', 'git prune --expire now', 2, 'prune'],
  ['Bash', 'git prune -n', 0], // dry run
  ['Bash', 'git reset --hard HEAD~1', 2, 'reset'],
  ['Bash', 'git reset --merge', 2, 'reset'],
  ['Bash', 'git reset --soft HEAD~1', 0],
  ['Bash', 'git reset HEAD file.yaml', 0],
  ['Bash', 'git -C "J:/Projects/Rotem E" reset --hard', 2, 'reset'], // global opts skipped
  ['Bash', 'git stash drop', 2, 'stash'],
  ['Bash', 'git stash clear', 2, 'stash'],
  ['Bash', 'git stash list', 0],
  ['Bash', 'git stash pop', 0],
  ['Bash', 'git filter-branch --tree-filter "rm -f secret" HEAD', 2, 'history rewrite'],
  ['Bash', 'git filter-repo --path src', 2, 'history rewrite'],
  ['Bash', 'git gc --prune=now', 2, 'recovery points'],
  ['Bash', 'git gc', 0],
  ['Bash', 'git clean -fd', 2, 'clean'],
  ['Bash', 'git clean --force', 2, 'clean'],
  ['Bash', 'git clean -xfd', 2, 'clean'],
  ['Bash', 'git status', 0],
  ['Bash', 'git add -A; git commit -m "msg"', 0],

  // --- 3. real Bash / PowerShell deletion syntax ---
  ['Bash', '/bin/rm -rf src', 2, 'non-disposable'],
  ['Bash', 'rm -f src/file.yaml', 2, 'non-disposable'],
  ['Bash', 'rm --force src/file.yaml', 2, 'non-disposable'],
  ['Bash', 'rm -r "J:/Projects/Rotem E/src/content"', 2, 'non-disposable'],
  ['PowerShell', 'Remove-Item -R src', 2, 'non-disposable'],
  ['PowerShell', 'Remove-Item -Rec src', 2, 'non-disposable'],
  ['PowerShell', 'ri -Recurse src', 2, 'non-disposable'],
  ['PowerShell', 'del -Recurse src', 2, 'non-disposable'],
  ['PowerShell', 'erase /s /q src', 2, 'non-disposable'],
  ['PowerShell', 'Remove-Item foo.yaml -Force -Recurse', 2, 'non-disposable'],
  ['PowerShell', 'rd /s /q src', 2, 'non-disposable'],
  ['PowerShell', 'del /f /s /q src\\*.yaml', 2, 'non-disposable'],
  ['Bash', 'rm foo.tmp', 0], // no recursive/force flag
  ['PowerShell', 'del build.tmp.123', 0], // no switches
  ['PowerShell', 'Remove-Item file.yaml', 0], // no -Recurse/-Force

  // --- 4. false positives: dangerous TEXT is not a dangerous COMMAND ---
  ['Bash', 'echo "git reset --hard"', 0],
  ['Bash', 'git commit -m "Never use git reset --hard"', 0],
  ['PowerShell', 'git commit -m "cleanup: rm -rf the old dist logic"', 0],
  ['Bash', 'grep -r "rm -rf" scripts/', 0],
  ['Bash', 'git clean -n -fd', 0], // dry run
  ['PowerShell', 'Remove-Item -WhatIf -Recurse src', 0], // dry run
  ['Bash', 'git log --grep="reset --hard"', 0],
  // ...but genuinely executed inline shells are still scanned
  ['Bash', 'bash -c "rm -rf src"', 2, 'non-disposable'],
  ['Bash', 'sh -c "git reset --hard"', 2, 'reset'],
  ['PowerShell', 'powershell -Command git reset --hard', 2, 'reset'],
  ['Monitor', 'cmd /c rd /s /q src', 2, 'non-disposable'],

  // --- 5. Monitor tool is guarded like the shells ---
  ['Monitor', 'git reset --hard', 2, 'reset'],
  ['Monitor', 'git status', 0],

  // --- 6. quoting a flag or subcommand does NOT change the verdict (B1) ---
  // The whole of finding B1, 2026-07-26: the tokenizer used to treat any quoted
  // token as data, so quoting one flag flipped every rule below from block to
  // allow. The shell strips the quotes before git/rm ever see argv, so each pair
  // here is byte-identical to its unquoted form at execution time. Section 4
  // above is the other half of the invariant: these must block while quoted
  // PROSE (which contains whitespace) must not.
  ['Bash', 'git reset "--hard"', 2, 'reset'],
  ['Bash', "git reset '--hard'", 2, 'reset'],
  ['Bash', 'git reset --"hard"', 2, 'reset'],
  ['Bash', 'git reset --ha"rd"', 2, 'reset'],
  ['Bash', 'git "reset" --hard', 2, 'reset'],
  ['Bash', 'git re"set" --hard', 2, 'reset'],
  ['Bash', "git 'reset' '--hard'", 2, 'reset'],
  ['Bash', 'git push "--force" origin main', 2, 'force push'],
  ['Bash', "git push '--force-with-lease' origin main", 2, 'force push'],
  ['Bash', 'git clean "-fdx"', 2, 'clean'],
  ['Bash', 'git clean -f"d"x', 2, 'clean'],
  ['Bash', 'git branch "-D" main', 2, 'branch'],
  ['Bash', 'git switch "--discard-changes" main', 2, 'switch'],
  ['Bash', 'git stash "drop"', 2, 'stash'],
  ['Bash', 'rm "-rf" src', 2, 'non-disposable'],
  ['Bash', "rm '-rf' src", 2, 'non-disposable'],
  ['Bash', 'rm -r"f" src', 2, 'non-disposable'],
  ['Bash', '/bin/rm "-rf" src', 2, 'non-disposable'],
  ['PowerShell', 'Remove-Item "-Recurse" -Force src', 2, 'non-disposable'],
  ['PowerShell', "Remove-Item '-Recurse' '-Force' src", 2, 'non-disposable'],
  ['PowerShell', 'ri -Recurse "-Force" src', 2, 'non-disposable'],
  // quoted flags survive inline-shell recursion too
  ['Bash', 'bash -c \'git reset "--hard"\'', 2, 'reset'],
  ['Bash', 'bash "-c" "rm -rf src"', 2, 'non-disposable'],
  ['PowerShell', 'powershell "-Command" git reset --hard', 2, 'reset'],
  ['Monitor', 'cmd "/c" rd /s /q src', 2, 'non-disposable'],
  // ...and the quoted-prose exemption still holds, now resting on the
  // whitespace test rather than on the quote itself
  ['Bash', 'git commit -m "reset --hard"', 0],
  ['Bash', 'git commit -m "rm -rf everything"', 0],
  ['Bash', 'git commit -m "--hard"', 0], // one quoted word, but the subcommand is commit
  ['Bash', 'git log --oneline', 0],
  ['Bash', 'git stash push -m "drop"', 0], // "drop" is the message, not the subcommand
  ['Bash', 'git -C "J:/Projects/Rotem E" status', 0],
  ['Bash', 'git -C "J:/Projects/Rotem E" reset --hard', 2, 'reset'],

  // --- 7. disposable dirs cover the common stacks ---
  // The same list ships to every project, so a Next.js build dir has to be as
  // deletable as an Astro one. `build`/`out` stay non-disposable on purpose.
  ['Bash', 'rm -rf .next', 0],
  ['Bash', 'rm -rf .turbo .vite coverage', 0],
  ['PowerShell', 'Remove-Item -Recurse -Force .next', 0],
  ['Bash', 'rm -rf build', 2, 'non-disposable'],
  ['Bash', 'rm -rf out', 2, 'non-disposable'],

  // --- 8. the program behind a wrapper, a keyword or a block (review 2026-09-25) ---
  // Only the first word of a segment used to be read as the program, so every
  // form below deleted a folder with no refusal.
  ['Bash', 'env rm -rf src', 2, 'non-disposable'],
  ['Bash', '/usr/bin/env rm -rf src', 2, 'non-disposable'],
  ['Bash', 'env -u HOME rm -rf src', 2, 'non-disposable'],
  ['Bash', 'nohup rm -rf src', 2, 'non-disposable'],
  ['Bash', 'command rm -rf src', 2, 'non-disposable'],
  ['Bash', 'time rm -rf src', 2, 'non-disposable'],
  ['Bash', 'timeout 5 rm -rf src', 2, 'non-disposable'],
  ['Bash', 'timeout -s KILL 5s rm -rf src', 2, 'non-disposable'],
  ['Bash', 'nice -n 10 rm -rf src', 2, 'non-disposable'],
  ['Bash', 'exec rm -rf src', 2, 'non-disposable'],
  ['Bash', 'sudo -u root rm -rf src', 2, 'non-disposable'],
  ['Bash', 'ls | xargs rm -rf', 2, 'non-disposable'],
  ['Bash', 'echo src | xargs -I {} rm -rf {}', 2, 'non-disposable'],
  ['Bash', 'xargs -n 1 git branch -D < branches.txt', 2, 'branch'],
  ['Bash', 'env git reset --hard', 2, 'reset'],
  ['Bash', 'nohup git push --force', 2, 'force push'],
  ['Bash', 'cmd //c rd //s //q src', 2, 'non-disposable'], // Git Bash spelling of cmd /c rd /s /q
  ['Bash', 'cmd //c "rd //s //q src"', 2, 'non-disposable'],
  ['Bash', 'if [ -d src ]; then rm -rf src; fi', 2, 'non-disposable'],
  ['Bash', 'for d in src docs; do rm -rf $d; done', 2, 'non-disposable'],
  ['Bash', 'until false; do git push --force; done', 2, 'force push'],
  ['Bash', '{ rm -rf src; }', 2, 'non-disposable'],
  ['Bash', '( rm -rf src )', 2, 'non-disposable'],
  ['Bash', '! rm -rf src', 2, 'non-disposable'],
  ['Bash', "bash -c 'if [ -d src ]; then rm -rf src; fi'", 2, 'non-disposable'],
  ['Monitor', 'while true; do rm -rf src; sleep 5; done', 2, 'non-disposable'],
  ['PowerShell', 'if (Test-Path src) { Remove-Item src -Recurse -Force }', 2, 'non-disposable'],
  ['PowerShell', '# clean up`\nRemove-Item src -Recurse -Force', 2, 'non-disposable'],
  ['Bash', "echo hi # don't worry\nrm -rf src", 2, 'non-disposable'],
  ['PowerShell', "Write-Host hi # it's fine\nRemove-Item src -Recurse -Force", 2, 'non-disposable'],
  ['Bash', 'echo "a # b" && ls', 0],
  ['Bash', 'echo ${#arr[@]}', 0],
  ['PowerShell', 'Get-ChildItem . | %{git reset --hard}', 2, 'reset'],
  ['PowerShell', 'Get-ChildItem . | ?{Remove-Item src -Recurse -Force}', 2, 'non-disposable'],
  ['PowerShell', 'Get-ChildItem . | ForEach-Object{Remove-Item src -Recurse -Force}', 2, 'non-disposable'],
  ['Bash', 'rm -rf dist {src,lib}', 2, 'non-disposable'],
  ['Bash', 'rm -rf dist { src }', 2, 'non-disposable'],
  ['Bash', 'rm -rf node_modules {src,docs}/', 2, 'non-disposable'],
  ['Bash', 'if [ -d src ]; then { rm -rf src; }; fi', 2, 'non-disposable'],
  ['PowerShell', 'if (Test-Path src) {Remove-Item src -Recurse -Force}', 2, 'non-disposable'],
  ['PowerShell', 'if ($x) { git status } else { Remove-Item src -Recurse -Force }', 2, 'non-disposable'],
  ['PowerShell', 'Get-ChildItem src | ForEach-Object { Remove-Item $_.FullName -Recurse -Force }', 2, 'non-disposable'],
  ['PowerShell', 'try { Remove-Item src -Recurse -Force } catch {}', 2, 'non-disposable'],
  ['PowerShell', '& { Remove-Item -Recurse -Force src }', 2, 'non-disposable'],
  ['Bash', 'powershell -NoProfile -Command "if (Test-Path src) { Remove-Item src -Recurse -Force }"', 2, 'non-disposable'],
  ['Bash', 'constructor; rm -rf src', 2, 'non-disposable'], // a program named like an object key
  // A brace that is not a block stays whole, so these still block...
  ['Bash', 'git checkout HEAD@{1} -- src/a.txt', 2, 'checkout'],
  ['Bash', 'git reset --hard HEAD@{1}', 2, 'reset'],
  ['Bash', 'git stash drop stash@{0}', 2, 'stash'],
  ['Bash', 'rm -rf ${SRC}', 2, 'non-disposable'],
  ['Bash', 'rm -rf src/{a,b}', 2, 'non-disposable'],
  ['PowerShell', 'Remove-Item ${env:USERPROFILE}/x -Recurse -Force', 2, 'non-disposable'],
  // ...and everyday commands with wrappers, keywords and braces still run.
  ['Bash', 'time npm run build', 0],
  ['Bash', 'timeout 30 npm test', 0],
  ['Bash', 'nohup npm run dev > log.txt', 0],
  ['Bash', 'env NODE_ENV=production npm run build', 0],
  ['Bash', 'env rm -rf node_modules', 0],
  ['Bash', 'git ls-files | xargs wc -l', 0],
  ['Bash', 'cmd //c dir', 0],
  ['Bash', 'if [ -d dist ]; then rm -rf dist; fi', 0],
  ['Bash', 'if true; then git status; fi', 0],
  ['Bash', 'for f in *.md; do wc -l $f; done', 0],
  ['Bash', '{ echo a; echo b; } > out.txt', 0],
  ['Bash', "awk '{print $1}' file.txt", 0],
  ['Bash', 'echo {a,b}.txt', 0],
  ['Bash', "git log --format='%H {x}' -3", 0],
  ['Bash', 'rm -rf dist/{a,b}', 0],
  ['PowerShell', 'if (Test-Path node_modules) { Remove-Item node_modules -Recurse -Force }', 0],
  ['PowerShell', 'Get-ChildItem src | Where-Object { $_.Length -gt 1kb } | Select-Object Name', 0],
  ['PowerShell', '$h = @{ rm = 1; Recurse = $true }; $h.Keys', 0],
  ['PowerShell', 'try { git status } catch { Write-Output $_ }', 0],
  ['PowerShell', 'timeout /t 5', 0],

  // --- 9. find deletes under its start paths (review 2026-09-25) ---
  ['Bash', 'find src -delete', 2, 'find'],
  ['Bash', 'find -delete', 2, 'find'], // no start path means the current folder
  ['Bash', "find . -name '*.log' -delete", 2, 'find'], // same verdict as rm -f *.log
  ['Bash', 'find src -exec rm -rf {} +', 2, 'find'],
  ['Bash', 'find . -type d -name src -exec rm -r {} \\;', 2, 'find'],
  ['Bash', 'find -L src -execdir rm {} \\;', 2, 'find'],
  ['Bash', "find src -name '*.md'", 0],
  ['Bash', 'find src -exec grep -l TODO {} +', 0],
  ['Bash', 'find node_modules -delete', 0],
  ['Bash', "find node_modules -name '*.map' -delete", 0],
  ['Bash', 'find .tmp -type f -exec rm -f {} +', 0],
  ['PowerShell', 'find "TODO" notes.txt', 0], // Windows find.exe searches text

  // --- 10. inline scripts, read with Path-guard.mjs (review 2026-09-25) ---
  // If Path-guard.mjs ever stops exporting what this check needs, these cases
  // fail instead of the check quietly switching off.
  ['Bash', `node -e "require('fs').rmSync('src',{recursive:true,force:true})"`, 2, 'script passed to `node`'],
  ['PowerShell', `node -e "require('fs').rmSync('src',{recursive:true,force:true})"`, 2, 'script passed to `node`'],
  ['PowerShell', `node -e 'require("fs").rmSync("src",{recursive:true,force:true})'`, 2, 'script passed to `node`'],
  ['Bash', `node --eval "require('fs').rmSync('src',{recursive:true})"`, 2, 'script passed to `node`'],
  ['Bash', `node -e "const {rmSync}=require('fs'); rmSync('src',{recursive:true,force:true})"`, 2, 'rmSync'],
  ['Bash', `node -e "const p='src'; require('fs').rmSync(p,{recursive:true,force:true})"`, 2, 'rmSync'],
  ['Bash', `node -e "const o={recursive:true}; require('fs').rmSync('src',o)"`, 2, 'rmSync'],
  ['Bash', `node -e "require('fs').rmSync(require('path').join(__dirname,'src'),{recursive:true,force:true})"`, 2, 'rmSync'],
  ['Bash', `node -e "require('fs').rmSync(process.argv[1],{recursive:true,force:true})" src`, 2, 'rmSync'],
  ['Bash', `python -c "import shutil; shutil.rmtree('src')"`, 2, 'script passed to `python`'],
  ['Bash', `python3 -c "import shutil; shutil.rmtree('src')"`, 2, 'rmtree'],
  ['Bash', `py -c "import shutil; shutil.rmtree('src')"`, 2, 'rmtree'],
  ['PowerShell', `python -c "import shutil; shutil.rmtree('src')"`, 2, 'rmtree'],
  ['Bash', `perl -e "use File::Path; rmtree('src')"`, 2, 'rmtree'],
  ['Bash', `ruby -e "require 'fileutils'; FileUtils.rm_rf('src')"`, 2, 'rm_rf'],
  ['Bash', `node -e "require('child_process').execSync('git reset --hard')"`, 2, 'reset'],
  ['PowerShell', `node -e "require('child_process').execSync('git reset --hard')"`, 2, 'reset'],
  ['Bash', `node -e "require('child_process').execSync('rm -rf src')"`, 2, 'non-disposable'],
  ['Bash', `node -e "const {exec}=require('child_process'); exec('git push --force')"`, 2, 'force push'],
  ['PowerShell', `node -e "require('child_process').execSync('rd /s /q src')"`, 2, 'non-disposable'],
  ['Bash', `python3 -c "import os; os.system('rm -rf src')"`, 2, 'non-disposable'],
  ['Bash', `python3 -c "import subprocess; subprocess.run('git push --force', shell=True)"`, 2, 'force push'],
  ['Bash', `node -e "require('fs').rmSync('node_modules',{recursive:true,force:true})"`, 0],
  ['PowerShell', `node -e "require('fs').rmSync('node_modules',{recursive:true,force:true})"`, 0],
  ['Bash', `node -e "require('fs').rmSync('.tmp/x',{recursive:true,force:true})"`, 0],
  ['Bash', `python -c "import shutil; shutil.rmtree('dist')"`, 0],
  ['Bash', `ruby -e "require 'fileutils'; FileUtils.rm_rf('dist')"`, 0],
  ['Bash', `node -e "require('fs').rmSync('src/a.txt')"`, 0], // one file, not recursive or forced
  ['Bash', `node -e "require('fs').unlinkSync('src/a.txt')"`, 0],
  ['Bash', `node -e "console.log(require('fs').readdirSync('src'))"`, 0],
  ['Bash', `node -e "require('child_process').execSync('npm run build',{stdio:'inherit'})"`, 0],
  ['Bash', `python3 -c "print('rm -rf src')"`, 0], // a command inside a string is text
  ['Bash', `node -e "console.log('shutil.rmtree(x)')"`, 0],
  ['Bash', `node -e "console.log(/x/.exec('rm -rf src'))"`, 0], // a regular expression, not a process
  ['Bash', 'node -p 1+1', 0],

  // --- 11. bash function bodies and groups after a keyword (review 2026-09-25) ---
  // A `{` opened a group only after then, do, else, elif, `!` or `(`, so a delete
  // inside a one-line function body, or in a group after time, if, while, until
  // or coproc, was read as part of the word before it and never judged.
  ['Bash', 'cleanup() { rm -rf src; }; cleanup', 2, 'non-disposable'],
  ['Bash', 'f(){ rm -rf src; }; f', 2, 'non-disposable'],
  ['Bash', 'function f { rm -rf src; }; f', 2, 'non-disposable'],
  ['Bash', 'function f() { rm -rf src; }; f', 2, 'non-disposable'],
  ['Bash', 'f(){ git reset --hard; }; f', 2, 'reset'],
  ['Bash', 'time { rm -rf src; }', 2, 'non-disposable'],
  ['Bash', 'time { git clean -fdx; }', 2, 'clean'],
  ['Bash', 'time -p { rm -rf src; }', 2, 'non-disposable'],
  ['Bash', 'if { rm -rf src; }; then echo; fi', 2, 'non-disposable'],
  ['Bash', 'while { rm -rf src; }; do break; done', 2, 'non-disposable'],
  ['Bash', 'until { rm -rf src; }; do :; done', 2, 'non-disposable'],
  ['Bash', 'coproc { rm -rf src; }', 2, 'non-disposable'],
  ['Bash', 'coproc NAME { rm -rf src; }', 2, 'non-disposable'],
  ['Bash', 'case $x in dist) { rm -rf src; };; esac', 2, 'non-disposable'],
  ['Bash', 'rm -rf dist/a\\) { src }', 2, 'non-disposable'], // an escaped `)` ends a target, not a function header
  ['Bash', 'f() { echo hi; }; f', 0],
  ['Bash', 'f() { rm -rf dist; }; f', 0],
  ['Bash', 'time { npm run build; }', 0],
  ['Bash', 'echo $(pwd) {a,b}', 0],

  // --- 12. bash brace lists in delete targets (review 2026-09-25) ---
  // Bash turns `dist/{x,../src}` into dist/x and dist/../src before rm runs, so
  // every word a target becomes is judged, not the braces read as one path.
  ['Bash', 'rm -rf dist/{x,../src}', 2, 'non-disposable'],
  ['Bash', 'rm -rf {src,a/dist/b}', 2, 'non-disposable'],
  ['Bash', 'rm -rf src{,.tmp.}', 2, 'non-disposable'],
  ['Bash', 'rm -rf {src/old,apps/web/dist/assets}', 2, 'non-disposable'],
  ['Bash', 'rm -rf {src,a.tmp.x}', 2, 'non-disposable'],
  ['Bash', 'rm -rf node_modules/{,../src}', 2, 'non-disposable'],
  ['Bash', 'rm -rf -- {src,x/node_modules/y}', 2, 'non-disposable'],
  ['Bash', 'rm -rf packages/{core/dist,legacy}', 2, 'non-disposable'],
  ['Bash', 'rm -rf dist/{a,{b,../../src}}', 2, 'non-disposable'], // a list inside a list
  ['Bash', 'rm -rf node_modules/..{Z..a}', 2, 'non-disposable'], // the range from Z to a holds a backslash
  ['Bash', 'rm -rf {a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}/dist', 2, 'non-disposable'], // too many words to judge
  ['Bash', 'find dist/{x,../src} -delete', 2, 'find'],
  ['Bash', 'rm -rf dist/{client,server}', 0],
  ['Bash', 'rm -rf {dist,.astro}', 0],
  ['Bash', 'rm -rf dist/{a,{b,c}}', 0],
  ['Bash', 'rm -rf pre{x,y}post.tmp', 0],
  ['Bash', 'rm -rf dist/{1..3}', 0],
  ['Bash', "rm -rf 'dist/{x,../src}'", 0], // quoted, so not a list: one folder inside dist
  ['Bash', "find {node_modules,dist} -name '*.map' -delete", 0],
  ['PowerShell', "Remove-Item -Recurse -Force 'dist/{x,y}'", 0], // PowerShell has no brace lists: one folder inside dist
  // Unquoted, PowerShell cannot even parse it; its bare comma now splits it, and `y}` is no disposable path.
  ['PowerShell', 'Remove-Item -Recurse -Force dist/{x,y}', 2, 'non-disposable'],

  // --- 13. compact PowerShell blocks (review 2026-09-25) ---
  // A `}` closed a block only after a space or `;`, and a `{` glued to try, else
  // or a dot stayed in the word, so `{git reset --hard}` read a flag named `hard}`.
  ['PowerShell', 'if (1) {git reset --hard}', 2, 'reset'],
  ['PowerShell', 'if (1) {git push --force}', 2, 'force push'],
  ['PowerShell', 'if (1) {git stash drop}', 2, 'stash'],
  ['PowerShell', 'if (1) {git checkout .}', 2, 'checkout'],
  ['PowerShell', '1..1 | % {git reset --hard}', 2, 'reset'],
  ['PowerShell', '% {git push --force}', 2, 'force push'],
  ['PowerShell', '&{git reset --hard}', 2, 'reset'],
  ['PowerShell', 'try{git reset --hard}catch{}', 2, 'reset'],
  ['PowerShell', 'try{Remove-Item src -Recurse -Force}catch{}', 2, 'non-disposable'],
  ['PowerShell', 'try { git status } finally{Remove-Item src -Recurse -Force}', 2, 'non-disposable'],
  ['PowerShell', 'if (Test-Path x) {} else{Remove-Item src -Recurse -Force}', 2, 'non-disposable'],
  ['PowerShell', 'do{Remove-Item src -Recurse -Force}while($false)', 2, 'non-disposable'],
  ['PowerShell', 'Invoke-Command -ScriptBlock{Remove-Item src -Recurse -Force}', 2, 'non-disposable'],
  ['PowerShell', '.{Remove-Item src -Recurse}', 2, 'non-disposable'],
  ['PowerShell', '.{git reset --hard}', 2, 'reset'],
  ['PowerShell', '& {begin{} process{Remove-Item src -Recurse -Force} end{}}', 2, 'non-disposable'],
  ['PowerShell', 'if ($x) {if ($y) {git reset --hard}}', 2, 'reset'],
  ['PowerShell', 'if (Test-Path dist) {Remove-Item -Recurse -Force dist}', 0],
  ['PowerShell', 'if ($?) {Remove-Item src -Recurse -Force -WhatIf}', 0],
  ['PowerShell', '$h = @{a=1}; if ($h.a) {git status}', 0],
  ['PowerShell', 'Get-ChildItem | ForEach-Object {$_.Name}', 0],

  // --- 14. a `)` that closes a subshell is not part of the path (review 2026-09-25) ---
  ['Bash', '(rm -rf node_modules)', 0],
  ['Bash', '(cd web && rm -rf dist)', 0],
  ['Bash', '((rm -rf dist))', 0],
  ['Bash', '(rm -rf dist/{a,b})', 0],
  ['PowerShell', '(Remove-Item -Recurse -Force node_modules)', 0],
  ['Monitor', '(rm -rf dist)', 0],
  ['Bash', '(rm -rf "C:/Windows")', 2, 'non-disposable'],
  ['Bash', '(rm -rf src)', 2, 'non-disposable'],
  ['Bash', '(cd web && rm -rf src)', 2, 'non-disposable'],
  ['PowerShell', '(Remove-Item -Recurse -Force src)', 2, 'non-disposable'],
  ['Bash', 'rm -rf "dist)"', 2, 'non-disposable'], // a quoted `)` is part of the name
  ['Bash', 'rm -rf dist\\)', 2, 'non-disposable'], // so is an escaped one
  ['Bash', "rm -rf 'dist/a(b)'", 0], // as many `(` as `)`: nothing is taken off

  // --- 15. a PowerShell backslash is not an escape (kit review 2026-09-25, T1) ---
  // "C:\x\" is a closed string in PowerShell. Read as an escaped quote, it hid
  // everything after it on the line.
  ['PowerShell', 'Set-Location "J:\\Projects\\Rotem E\\"; git reset --hard', 2, 'reset'],
  ['PowerShell', 'Get-ChildItem "C:\\Users\\User\\"; Remove-Item src -Recurse -Force', 2, 'non-disposable'],
  ['PowerShell', '$root = "J:\\x\\"\nRemove-Item "$root\\src" -Recurse -Force', 2, 'non-disposable'],
  ['PowerShell', 'Get-ChildItem C:\\Users\\User\\;git reset --hard', 2, 'reset'],
  ['PowerShell', 'Write-Output "a`"; git reset --hard"', 0], // the backtick escapes the quote: all one string
  ['PowerShell', 'Get-ChildItem "C:\\Users\\User\\"; Remove-Item node_modules -Recurse -Force', 0],
  ['Bash', 'echo "a\\"; git reset --hard"', 0], // in bash the backslash still escapes the quote

  // --- 16. a command continued on the next line (kit review 2026-09-25, T2) ---
  ['PowerShell', 'Remove-Item -Path src `\n  -Recurse -Force', 2, 'non-disposable'],
  ['PowerShell', 'Remove-Item `\n  -Recurse -Force src', 2, 'non-disposable'],
  ['PowerShell', 'Remove-Item -Path src `\r\n  -Recurse -Force', 2, 'non-disposable'],
  ['PowerShell', 'git push origin main `\n  --force', 2, 'force push'],
  ['PowerShell', 'Remove-Item node_modules `\n  -Recurse -Force', 0],
  ['Bash', 'rm -rf node_modules \\\n  dist', 0], // the escaped newline is not a target
  ['Bash', 'rm -rf \\\n  src', 2, 'non-disposable'],
  ['Bash', 'git reset --ha\\\nrd', 2, 'reset'], // bash drops the pair, so this is --hard
  ['Bash', 'git push origin main \\\n  --force', 2, 'force push'],
  ['Monitor', 'rm -rf \\\n  src', 2, 'non-disposable'],

  // --- 17. PowerShell common parameters (kit review 2026-09-25, T4) ---
  // -ErrorAction is not a cluster of short flags: its `r` made the delete
  // recursive and its value a target.
  ['PowerShell', 'Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue', 0],
  ['PowerShell', 'Remove-Item dist -Recurse -Force -ea 0', 0],
  ['PowerShell', 'Remove-Item .tmp\\x.txt -ErrorAction Ignore', 0],
  ['PowerShell', 'Remove-Item src\\old.ts -ErrorAction SilentlyContinue', 0],
  ['PowerShell', 'try { Remove-Item .tmp\\x -Recurse -Force -ErrorAction Stop } catch {}', 0],
  ['PowerShell', 'Remove-Item -Recurse -Force -ErrorAction:Stop node_modules', 0],
  ['PowerShell', 'Remove-Item notes.txt -Verbose', 0],
  ['PowerShell', 'Remove-Item src -Recurse -Force -ErrorAction SilentlyContinue', 2, 'non-disposable'],
  ['PowerShell', 'Remove-Item -ErrorAction SilentlyContinue -Recurse -Force src', 2, 'non-disposable'],
  ['PowerShell', 'Remove-Item -Recurse -Force -ErrorAction:Stop src', 2, 'non-disposable'],
  ['PowerShell', 'Remove-Item src -Recurse -Verbose', 2, 'non-disposable'],
  ['Monitor', 'rm -rf src', 2, 'non-disposable'],

  // --- 18. PowerShell comma lists (kit review 2026-09-25, T5) ---
  // `a,b` is two paths in PowerShell, each judged on its own; in bash it is one name.
  ['PowerShell', 'Remove-Item -Recurse -Force node_modules, dist', 0],
  ['PowerShell', 'Remove-Item -Recurse -Force node_modules,dist', 0],
  ['PowerShell', 'Remove-Item -Recurse -Force .tmp/a,src', 2, 'non-disposable'],
  ['PowerShell', 'Remove-Item -Recurse -Force src,x.tmp', 2, 'non-disposable'],
  ['PowerShell', 'Remove-Item -Recurse -Force node_modules\\x,C:\\Users\\User\\Documents', 2, 'non-disposable'],
  ['PowerShell', 'Remove-Item -Recurse -Force "node_modules","src"', 2, 'non-disposable'],
  ['PowerShell', "Remove-Item -Recurse -Force 'node_modules/a,b'", 0], // a quoted comma is part of the name
  ['Bash', 'rm -rf .tmp/a,src', 0], // one folder named `a,src` inside .tmp

  // --- 19. Monitor reads commands as bash (kit review 2026-09-25, T32) ---
  ['Monitor', 'rm -rf dist/{x,../src}', 2, 'non-disposable'],
  ['Monitor', 'rm -rf node_modules/.\\./src', 2, 'non-disposable'],
  ['Monitor', 'rm -rf dist/{client,server}', 0],

  // --- 20. forced deletes through git (kit review 2026-09-25, T36) ---
  ['Bash', 'git rm -rf src', 2, 'git rm -f'],
  ['Bash', 'git rm -r --force src', 2, 'git rm -f'],
  ['Bash', 'git worktree remove --force .claude/worktrees/x', 2, 'worktree remove'],
  ['Bash', 'git worktree remove -f wt', 2, 'worktree remove'],
  ['Bash', 'git rm -r src', 0], // without -f git refuses to drop uncommitted changes
  ['Bash', 'git rm --cached .mcp.json', 0],
  ['Bash', 'git rm -r -f --cached src', 0], // the index only
  ['Bash', 'git rm -rfn src', 0], // dry run
  ['Bash', 'git worktree remove wt', 0],
  ['Bash', 'git worktree prune', 0],

  // --- 21. wrapped shells and git options with a value (review 2026-09-25, ASTRA T09) ---
  // Only an exact `-c` opened the script, and only -C/-c took a value, so each
  // of these wiped uncommitted work with no refusal.
  ['Bash', 'bash -lc "git reset --hard"', 2, 'reset'],
  ['Bash', 'bash -lc "rm -rf src"', 2, 'non-disposable'],
  ['PowerShell', 'bash -lc "rm -rf src"', 2, 'non-disposable'],
  ['Bash', 'sh -ec "rm -rf src"', 2, 'non-disposable'],
  ['Bash', 'bash -xc "git clean -fdx"', 2, 'clean'],
  ['Bash', 'bash -lic "git reset --hard"', 2, 'reset'],
  ['Bash', 'zsh -lc "git reset --hard"', 2, 'reset'],
  ['Bash', 'env bash -lc "git reset --hard"', 2, 'reset'],
  ['Bash', '/usr/bin/bash -lc "git reset --hard"', 2, 'reset'],
  ['PowerShell', '& "C:\\Program Files\\Git\\bin\\bash.exe" -lc "git reset --hard"', 2, 'reset'],
  ['Bash', 'bash -cl "rm -rf src"', 2, 'non-disposable'],
  ['Bash', 'bash -ce "rm -rf src"', 2, 'non-disposable'],
  ['Bash', 'bash -c -e "rm -rf src"', 2, 'non-disposable'],
  ['Bash', 'bash -c -- "rm -rf src"', 2, 'non-disposable'],
  ['Bash', 'bash -c -o pipefail "rm -rf src"', 2, 'non-disposable'],
  ['Bash', 'git --work-tree . reset --hard', 2, 'reset'],
  ['Bash', 'git --git-dir .git reset --hard', 2, 'reset'],
  ['Bash', 'git --namespace x reset --hard', 2, 'reset'],
  ['Bash', 'git --config-env k=V reset --hard', 2, 'reset'],
  ['Bash', 'git --attr-source HEAD reset --hard', 2, 'reset'],
  ['Bash', 'git --work-tree . clean -fdx', 2, 'clean'],
  ['Bash', 'git --git-dir .git push --force', 2, 'force push'],
  ['Bash', 'git --git-dir .git checkout -- .', 2, 'checkout'],
  ['Bash', 'git -C . --work-tree . reset --hard', 2, 'reset'],
  ['Bash', 'bash -lc "npm test"', 0],
  ['Bash', 'bash -lc "rm -rf node_modules"', 0],
  ['Bash', 'git --work-tree . status', 0],
  ['Bash', 'git --git-dir .git log', 0],
  ['Bash', 'git --exec-path', 0],

  // --- 22. redirections, dot-sourcing and here-document scripts (kit review 2026-09-28) ---
  // A redirection is not a target, so the usual quiet cleanup passes and the
  // real targets around it are still judged; a lone `.` runs the command after
  // it; a here-document fed to an interpreter is its script.
  ['Bash', 'rm -rf node_modules 2>/dev/null', 0],
  ['Bash', 'rm -rf node_modules 2> /dev/null', 0],
  ['Bash', 'rm -rf node_modules 2>&1', 0],
  ['Bash', 'rm -rf dist >/dev/null 2>&1', 0],
  ['Bash', 'rm -rf .tmp/x > .tmp/log.txt', 0],
  ['PowerShell', 'Remove-Item -Recurse -Force node_modules 2>$null', 0],
  ['PowerShell', 'Remove-Item -Recurse -Force dist 2> $null', 0],
  ['Bash', 'rm -rf src 2>/dev/null', 2, 'non-disposable'],
  ['Bash', 'rm -rf dist 2>&1 src', 2, 'non-disposable'],
  ['Bash', 'rm -rf node_modules 2>/dev/null src', 2, 'non-disposable'],
  ['PowerShell', 'Remove-Item -Recurse -Force src 2>$null', 2, 'non-disposable'],
  ['PowerShell', '. Remove-Item -Recurse -Force src', 2, 'non-disposable'],
  ['PowerShell', '. git reset --hard', 2, 'reset'],
  ['Bash', '. ./setup.sh; rm -rf src', 2, 'non-disposable'],
  ['PowerShell', '. Remove-Item -Recurse -Force node_modules', 0],
  ['Bash', '. ./setup.sh', 0],
  ['Bash', "python3 - <<'EOF'\nimport shutil\nshutil.rmtree('src')\nEOF", 2, 'rmtree'],
  ['Bash', "python3 <<'EOF'\nimport shutil; shutil.rmtree('src')\nEOF", 2, 'rmtree'],
  ['Bash', "node - <<'EOF'\nrequire('fs').rmSync('src', { recursive: true, force: true })\nEOF", 2, 'rmSync'],
  ['Bash', "node - <<'EOF'\nrequire('child_process').execSync('git reset --hard')\nEOF", 2, 'reset'],
  ['Bash', "bash <<'EOF'\nrm -rf src\nEOF", 2, 'non-disposable'],
  ['Bash', "python3 - <<'EOF'\nimport shutil\nshutil.rmtree('dist')\nEOF", 0],
  ['Bash', "python3 - <<'EOF'\nprint('rm -rf src')\nEOF", 0],
  ['Bash', "python3 tool.py <<'EOF'\nshutil.rmtree('src')\nEOF", 0],
  ['Bash', "cat <<'EOF'\nshutil.rmtree('src')\nEOF", 0],

  // --- 23. text blocks are text (kit review 2026-10-02, T9) ---
  // An apostrophe or a stray quote inside a here-string, a here-document or a
  // block comment used to open a quote that hid every command after the block.
  ['PowerShell', "@'\nIt's a note\n'@ | Set-Content .tmp\\note.md\nWrite-Host saved; Remove-Item -Recurse -Force C:\\Users\\User\\Documents", 2, 'non-disposable'],
  ['PowerShell', "@'\nIts a note\n'@ | Set-Content .tmp\\note.md\nWrite-Host saved; Remove-Item -Recurse -Force C:\\Users\\User\\Documents", 2, 'non-disposable'],
  ['PowerShell', '$t = @"\nsay "hi\n"@\nGet-Date; Remove-Item -Recurse -Force src', 2, 'non-disposable'],
  ['PowerShell', "$t = @'\ndon't\n'@; git reset --hard", 2, 'reset'],
  ['Bash', 'git commit -m "$(cat <<\'EOF\'\nsay "hi\nEOF\n)"\ntrue; rm -rf src', 2, 'non-disposable'],
  ['Bash', "cat > notes.md <<'EOF'\nIt's a note\nEOF\nrm -rf src", 2, 'non-disposable'],
  ['Bash', "cat <<-EOF\n\tIt's indented\n\tEOF\ngit reset --hard", 2, 'reset'],
  ['Bash', "cat <<A <<B\nIt's\nA\nmore\nB\nrm -rf src", 2, 'non-disposable'],
  ['PowerShell', "<# don't\nworry #> Remove-Item -Recurse -Force src", 2, 'non-disposable'],
  // A delimiter is read with bash's quote removal, and a here-document that
  // never closes is read line by line, so a misread end can hide nothing.
  ['Bash', 'cat <<E"O"F\nIt\'s\nEOF\nrm -rf src', 2, 'non-disposable'],
  ['Bash', 'cat <<EOF\nnever closed\nrm -rf src', 2, 'non-disposable'],
  ['Bash', 'echo $((1<<2)); rm -rf src', 2, 'non-disposable'], // a shift, not a here-document
  // ...and the text itself is never read as commands.
  ['Bash', 'git commit -m "$(cat <<\'EOF\'\nFix: rm -rf the old dist logic\nInstall step; It\'s done\n\nCo-Authored-By: x\nEOF\n)"', 0],
  ['Bash', "cat > notes.md <<'EOF'\nrm -rf src\ngit reset --hard\nEOF", 0],
  ['Bash', 'gh pr create --title x --body "$(cat <<\'EOF\'\n## Summary\n- rm -rf the dist logic\n- It\'s fine\nEOF\n)"', 0],
  ['Bash', "git commit -F - <<'EOF'\nrm -rf src\nEOF", 0],
  ['PowerShell', "@'\nRemove-Item src -Recurse -Force\nIt's a note\n'@ | Set-Content notes.md", 0],
  ['PowerShell', "$msg = @'\nFix: Remove-Item -Recurse -Force src was wrong\nIt's done\n'@\ngit commit -m $msg", 0],
  ['PowerShell', "<# don't worry #> Write-Host ok", 0],
  ['Bash', 'echo $((1<<2))', 0],
  // A text block fed to a shell or an interpreter is its script, and is read.
  ['Bash', "cat <<'EOF' | bash\nrm -rf src\nEOF", 2, 'non-disposable'],
  ['Bash', 'x="$(bash <<\'EOF\'\nrm -rf src\nEOF\n)"', 2, 'non-disposable'],
  ['Bash', 'bash -c "$(cat <<\'EOF\'\nrm -rf src\nEOF\n)"', 2, 'non-disposable'],
  ['Bash', "s=$(cat <<'EOF'\nrm -rf src\nEOF\n)\neval \"$s\"", 2, 'non-disposable'],
  ['Bash', "cat > .tmp/x.sh <<'EOF'\nrm -rf src\nEOF\nbash .tmp/x.sh", 2, 'non-disposable'],
  ['Bash', "cat > .tmp/x.sh <<'EOF'\ngit reset --hard\nEOF\n./.tmp/x.sh", 2, 'reset'],
  ['PowerShell', "@'\nRemove-Item src -Recurse -Force\n'@ | Set-Content x.ps1\n.\\x.ps1", 2, 'non-disposable'],
  ['PowerShell', "Set-Content -Path x.ps1 -Value 'Remove-Item src -Recurse -Force'; powershell -File x.ps1", 2, 'non-disposable'],
  ['PowerShell', "$s = @'\nRemove-Item src -Recurse -Force\n'@\niex $s", 2, 'non-disposable'],
  ['PowerShell', "$s = @'\ngit reset --hard\n'@\n$s | powershell -Command -", 2, 'reset'],
  ['PowerShell', "@'\ngit reset --hard\n'@ | Invoke-Expression", 2, 'reset'],
  ['PowerShell', "node -e @'\nrequire('fs').rmSync('src', { recursive: true })\n'@", 2, 'rmSync'],
  ['PowerShell', "@'\nrequire('fs').rmSync('src', { recursive: true })\n'@ | node", 2, 'rmSync'],
  ['Bash', "cat > .tmp/x.sh <<'EOF'\nrm -rf node_modules\nEOF\nbash .tmp/x.sh", 0],
  ['PowerShell', "$s = @'\nGet-ChildItem src\n'@\niex $s", 0],

  // --- 24. interpreter switches and scripts fed in (kit review 2026-10-02, T1) ---
  // The guard keeps its own list of switches: joined, glued and `=` forms
  // carried a script that was never read.
  ['Bash', `node -pe "require('fs').rmSync('src',{recursive:true})"`, 2, 'rmSync'],
  ['Bash', `node -p "require('fs').rmSync('src',{recursive:true})"`, 2, 'rmSync'],
  ['Bash', `node --eval="require('fs').rmSync('src',{recursive:true})"`, 2, 'rmSync'],
  ['Bash', `node --input-type=module -e "import fs from 'fs'; fs.rmSync('src',{recursive:true})"`, 2, 'rmSync'],
  ['Bash', `python -Bc "import shutil; shutil.rmtree('src')"`, 2, 'rmtree'],
  ['Bash', `python -uBc "import shutil; shutil.rmtree('src')"`, 2, 'rmtree'],
  ['Bash', `python -c"import shutil; shutil.rmtree('src')"`, 2, 'rmtree'],
  ['Bash', `python3 -X utf8 -c "import shutil; shutil.rmtree('src')"`, 2, 'rmtree'],
  ['PowerShell', `py -3 -Bc "import shutil; shutil.rmtree('src')"`, 2, 'rmtree'],
  ['Bash', `perl -le 'use File::Path; rmtree("src")'`, 2, 'rmtree'],
  ['Bash', `perl -MFile::Path -e 'rmtree("src")'`, 2, 'rmtree'],
  ['Bash', `ruby -rfileutils -e "FileUtils.rm_rf('src')"`, 2, 'rm_rf'],
  ['Bash', `echo "import shutil; shutil.rmtree('src')" | python3`, 2, 'rmtree'],
  ['Bash', `echo "require('fs').rmSync('src',{recursive:true})" | node -`, 2, 'rmSync'],
  ['Bash', `python3 - <<< "import shutil; shutil.rmtree('src')"`, 2, 'rmtree'],
  ['Bash', "python3 -X utf8 - <<'EOF'\nimport shutil\nshutil.rmtree('src')\nEOF", 2, 'rmtree'],
  ['Bash', 'echo "rm -rf src" | bash', 2, 'non-disposable'],
  ['Bash', "printf 'rm -rf src\\n' | sh", 2, 'non-disposable'],
  ['Bash', 'bash <<< "git reset --hard"', 2, 'reset'],
  ['PowerShell', '"git reset --hard" | powershell -NoProfile -Command -', 2, 'reset'],
  ['PowerShell', '"Remove-Item src -Recurse -Force" | pwsh -NoProfile -ExecutionPolicy Bypass', 2, 'non-disposable'],
  ['Bash', 'node -pe "1+1"', 0],
  ['Bash', 'python -Bc "print(1)"', 0],
  ['Bash', 'python -m pip install requests', 0],
  ['Bash', `python -Bc "import shutil; shutil.rmtree('dist')"`, 0],
  ['Bash', 'echo "rm -rf node_modules" | bash', 0],
  ['Bash', `echo "shutil.rmtree('src')" | python3 tool.py`, 0], // a script file: the pipe is its data
  ['Bash', 'echo "rm -rf src" | node build.mjs', 0],
  ['Bash', "cat data.json | node -e \"let s='';process.stdin.on('data',d=>s+=d)\"", 0],
  ['PowerShell', '"rm -rf src" | Set-Content notes.md', 0],

  // --- 25. git checkout that names files or folders (kit review 2026-10-02, T27) ---
  // The five spellings that discarded edits unseen; more in the disk group below.
  ['Bash', 'git checkout ./', 2, 'checkout'],
  ['Bash', 'git checkout :/', 2, 'checkout'],
  ['Bash', 'git checkout HEAD src/a.txt', 2, 'checkout'],
  ['Bash', 'git checkout src/', 2, 'checkout'],
  ['Bash', 'git checkout --pathspec-from-file=list.txt', 2, 'checkout'],
  ['PowerShell', 'git checkout main src\\a.txt', 2, 'checkout'],
  ['Bash', "git checkout '*.md'", 2, 'checkout'],
  ['Bash', 'git checkout .github/workflows', 2, 'checkout'],
  ['Bash', 'git checkout --ours a b', 2, 'checkout'],
  ['Bash', 'git checkout feature/login', 0], // no such path: a branch
  ['Bash', 'git checkout -', 0],
  ['Bash', 'git checkout HEAD~1', 0],
  ['Bash', 'git checkout main@{1}', 0],
  ['Bash', 'git checkout -b feature/x origin/main', 0],
  ['Bash', 'git checkout -B main origin/main', 0],
  ['Bash', 'git checkout -t origin/feature', 0],
  ['Bash', 'git checkout --track origin/feature/login', 0],
  ['Bash', 'git checkout --detach v1.2.3', 0],
  ['Bash', 'git checkout --orphan gh-pages', 0],
  ['Bash', 'git checkout $(git rev-parse HEAD~1)', 0], // one word once the shell runs it
  ['Bash', 'git checkout "$branch"', 0], // built at runtime: cannot be read, passes as before
  ['Bash', 'git checkout ./$f', 2, 'checkout'],

  // --- 26. many files at once, flags or not (kit review 2026-10-02, T36) ---
  // A wildcard, a PowerShell pipeline ending in a delete, and xargs rm are
  // judged like a recursive delete: allowed only inside throwaway folders.
  ['Bash', 'rm src/content/*.yaml', 2, 'wildcard'],
  ['Bash', 'rm *.log', 2, 'wildcard'],
  ['PowerShell', 'Remove-Item src\\content\\*.yaml', 2, 'wildcard'],
  ['PowerShell', "Remove-Item 'src\\content\\*.yaml'", 2, 'wildcard'], // PowerShell expands it quoted too
  ['PowerShell', 'del src\\*.yaml', 2, 'wildcard'],
  ['Monitor', 'cmd /c del src\\*.yaml', 2, 'wildcard'],
  ['PowerShell', 'Get-ChildItem src -Recurse -File | Remove-Item', 2, 'pipe'],
  ['PowerShell', 'Get-ChildItem src | Where-Object { $_.Length -gt 0 } | Remove-Item', 2, 'pipe'],
  ['PowerShell', 'Get-Item src | Remove-Item -Recurse -Force', 2, 'non-disposable'],
  ['PowerShell', 'Get-ChildItem *.log | Remove-Item', 2, 'pipe'],
  ['PowerShell', '$old | Remove-Item', 2, 'cannot be read'],
  ['Bash', 'find src -type f -name "*.yaml" | xargs rm', 2, 'xargs'],
  ['Bash', 'find src -type f | grep -v keep | xargs rm', 2, 'xargs'],
  ['Bash', 'find . -name "*.log" | xargs rm', 2, 'xargs'],
  ['Bash', 'xargs rm < list.txt', 2, 'cannot be read'],
  ['Bash', 'git ls-files -z | xargs -0 rm', 2, 'cannot be read'],
  ['Bash', 'echo src | xargs rm -rf node_modules', 2, 'non-disposable'],
  ['Bash', 'echo ../src | xargs -I{} rm -rf node_modules/{}', 2, 'non-disposable'],
  ['Bash', 'rm .tmp/*.log', 0],
  ['Bash', 'rm *.tmp', 0],
  ['Bash', 'rm -f .tmp/*', 0],
  ['PowerShell', 'Remove-Item .tmp\\*', 0],
  ['PowerShell', 'Get-ChildItem .tmp -Filter *.log | Remove-Item', 0],
  ['PowerShell', 'Get-ChildItem .tmp | Where-Object { $_.Length -gt 0 } | Remove-Item', 0],
  ['PowerShell', "'node_modules','dist' | Remove-Item", 0],
  ['PowerShell', 'Get-ChildItem dist -Recurse -File | Remove-Item', 0],
  ['Bash', "find node_modules -name '*.map' | xargs rm", 0],
  ['Bash', 'find dist -type f | xargs rm', 0],
  ['Bash', "find node_modules -name '*.map' | xargs -I{} rm {}", 0],
  ['Bash', 'echo node_modules dist | xargs rm', 0],
  // A recursive or forced delete still needs written targets that are all
  // disposable, as before: names fed in only ever add a refusal.
  ['PowerShell', "'node_modules','dist' | Remove-Item -Recurse -Force", 2, 'non-disposable'],
  ['Bash', 'find dist -type f | xargs rm -f', 2, 'non-disposable'],
  ['Bash', "rm 'a*b.txt'", 0], // quoted in bash: one file with a star in its name
  ['PowerShell', "Remove-Item -LiteralPath 'src/[slug].astro'", 0],
  ['Bash', 'rm src/a.txt', 0],
  ['PowerShell', 'Remove-Item src\\a.txt', 0],
  ['PowerShell', 'Get-ChildItem src | Select-Object Name', 0],
  ['Bash', 'ls src/*.md', 0],
];

let failures = 0;
let ran = 0;
for (const [tool, command, expected, reasonPart] of cases) {
  const { status, stderr } = run(payload(command, tool));
  ran++;
  try {
    assert.equal(status, expected, `[${tool}] "${command}" -> exit ${status}, expected ${expected}\n${stderr}`);
    if (expected === 2) {
      assert.ok(stderr.includes('destructive-guard: blocked'), `[${tool}] "${command}" blocked without the guard banner`);
      assert.ok(
        stderr.toLowerCase().includes(reasonPart.toLowerCase()),
        `[${tool}] "${command}" stderr missing reason "${reasonPart}": ${stderr}`
      );
    }
  } catch (e) {
    failures++;
    console.error(e.message);
  }
}

// --- the install's live probe (kit review 2026-10-02, T118) ---
// Refused with exactly this line and nothing else, so the install can read it
// back; every other echo is untouched.
const PROBE_LINE = 'ProjectOS live probe: the guards are on in this session. Nothing was run.\n';
const probeCases = [
  ['Bash', 'echo projectos-live-probe', 2],
  ['Bash', 'echo "projectos-live-probe"', 2],
  ['Bash', 'echo projectos-live-probe && git status', 2],
  ['Monitor', 'echo projectos-live-probe', 2],
  ['PowerShell', 'Write-Output projectos-live-probe', 2],
  ['PowerShell', "Write-Host 'projectos-live-probe'; Get-Date", 2],
  ['PowerShell', 'echo projectos-live-probe', 2],
  ['Bash', 'echo projectos-live-probe-1234', 0],
  ['Bash', 'echo projectos-live-probe extra', 0],
  ['Bash', 'ls; echo projectos-live-probe', 0],
  ['Bash', 'printf projectos-live-probe', 0],
  ['Bash', 'echo hello', 0],
  ['PowerShell', 'Write-Host done', 0],
];
for (const [tool, command, expected] of probeCases) {
  const { status, stderr } = run(payload(command, tool));
  ran++;
  try {
    assert.equal(status, expected, `probe [${tool}] "${command}" -> exit ${status}, expected ${expected}\n${stderr}`);
    if (expected === 2) assert.equal(stderr, PROBE_LINE, `probe [${tool}] "${command}" printed: ${stderr}`);
  } catch (e) {
    failures++;
    console.error(e.message);
  }
}

// --- the disk: a git repository and a folder with links (kit review 2026-10-02, T27 and T30) ---
// A word after `git checkout` that names something on disk is a path, and a
// dotted word git does not know is one too. A link inside node_modules that
// leads to a real source folder is not throwaway when the delete reaches
// through it. Built in a scratch folder inside tests/, so no disposable
// folder name sits above it, and removed at the end.
const scratchRoot = path.dirname(fileURLToPath(import.meta.url));
const diskDir = fs.mkdtempSync(path.join(scratchRoot, 'scratch-destructive-disk-'));
try {
  const repo = path.join(diskDir, 'repo');
  fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'README.md'), 'x');
  fs.writeFileSync(path.join(repo, 'docs', 'guide'), 'x');
  fs.writeFileSync(path.join(repo, 'sub', 'a.txt'), 'x');
  fs.writeFileSync(path.join(repo, 'Makefile'), 'x');
  const git = (...args) => spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, stdio: 'ignore' });
  const gitReady = git('init', '-q').status === 0 && git('add', '-A').status === 0 && git('commit', '-q', '-m', 'init').status === 0
    && git('branch', 'release-1.0').status === 0 && git('tag', 'v1.2.3').status === 0;

  const links = path.join(diskDir, 'links');
  for (const d of ['packages/lib/sub', 'node_modules/real', 'node_modules/.pnpm/foo/node_modules/foo', 'web/node_modules']) {
    fs.mkdirSync(path.join(links, d), { recursive: true });
  }
  fs.writeFileSync(path.join(links, 'packages/lib/index.js'), 'x');
  let linksReady = true;
  try {
    // 'junction' needs no rights on Windows, and is a plain folder link elsewhere.
    fs.symlinkSync(path.join(links, 'packages/lib'), path.join(links, 'node_modules/lib'), 'junction');
    fs.symlinkSync(path.join(links, 'node_modules/.pnpm/foo/node_modules/foo'), path.join(links, 'node_modules/foo'), 'junction');
    fs.symlinkSync(path.join(links, 'packages/lib'), path.join(links, 'web/node_modules/lib'), 'junction');
  } catch {
    linksReady = false;
  }

  // [tool, command, expected, reason, folder, needs]
  const diskCases = [
    ['Bash', 'git checkout docs', 2, 'checkout', repo],
    ['Bash', 'git checkout Makefile', 2, 'checkout', repo],
    ['Bash', 'git checkout README.md', 2, 'checkout', repo],
    ['Bash', 'cd sub && git checkout a.txt', 2, 'checkout', repo],
    ['PowerShell', 'Set-Location sub; git checkout a.txt', 2, 'checkout', repo],
    ['Bash', 'git -C sub checkout a.txt', 2, 'checkout', repo],
    ['Bash', 'git checkout notes.md', 2, 'checkout', repo, 'git'], // not on disk, not a ref: a path
    ['Bash', 'git checkout v9.9.9', 2, 'checkout', repo, 'git'],
    ['Bash', 'git checkout v1.2.3', 0, '', repo, 'git'], // a tag
    ['Bash', 'git checkout release-1.0', 0, '', repo, 'git'],
    ['Bash', 'git checkout feature/login', 0, '', repo],
    ['Bash', 'git checkout main', 0, '', repo],
    ['Bash', 'git switch docs', 0, '', repo],
    ['Bash', 'rm -rf node_modules/lib/', 2, 'link', links, 'links'],
    ['Bash', 'rm -rf node_modules/lib/*', 2, 'link', links, 'links'],
    ['Bash', 'rm node_modules/lib/*.js', 2, 'link', links, 'links'],
    ['Bash', 'find node_modules/lib/ -delete', 2, 'link', links, 'links'],
    ['Bash', 'find node_modules/lib -delete', 2, 'link', links, 'links'],
    ['Bash', 'rm -rf node_modules/lib/sub', 2, 'link', links, 'links'],
    ['Bash', 'rm -rf node_modules/*/sub', 2, 'link', links, 'links'],
    ['Bash', 'rm -rf node_modules/*/', 2, 'link', links, 'links'],
    ['Bash', 'cd web && rm -rf node_modules/lib/', 2, 'link', links, 'links'],
    ['PowerShell', 'Remove-Item -Recurse -Force node_modules\\lib\\*', 2, 'link', links, 'links'],
    ['PowerShell', 'Get-ChildItem node_modules\\lib | Remove-Item', 2, 'link', links, 'links'],
    ['PowerShell', 'cmd /c del /s /q node_modules\\lib', 2, 'link', links, 'links'],
    ['Bash', `node -e "require('fs').rmSync('node_modules/lib/sub',{recursive:true,force:true})"`, 2, 'link', links, 'links'],
    ['Bash', 'rm -rf node_modules/lib', 0, '', links, 'links'], // the link itself goes, not what it points to
    ['Bash', 'rm -rf node_modules', 0, '', links, 'links'],
    ['Bash', 'rm -rf node_modules/*', 0, '', links, 'links'],
    ['Bash', 'rm -rf node_modules/real/', 0, '', links, 'links'],
    ['Bash', 'rm -rf node_modules/foo/dist', 0, '', links, 'links'], // a pnpm link back into node_modules
    ['PowerShell', 'Remove-Item -Recurse -Force node_modules\\lib', 0, '', links, 'links'],
    ['PowerShell', 'cmd /c rd /s /q node_modules\\lib', 0, '', links, 'links'],
    ['PowerShell', 'Get-ChildItem node_modules | Remove-Item', 0, '', links, 'links'],
  ];
  for (const [tool, command, expected, reasonPart, cwd, needs] of diskCases) {
    if ((needs === 'git' && !gitReady) || (needs === 'links' && !linksReady)) {
      console.log(`skipped (no ${needs} here): [${tool}] "${command}"`);
      continue;
    }
    const { status, stderr } = run(payload(command, tool, cwd));
    ran++;
    try {
      assert.equal(status, expected, `disk [${tool}] "${command}" -> exit ${status}, expected ${expected}\n${stderr}`);
      if (expected === 2) {
        assert.ok(stderr.toLowerCase().includes(reasonPart), `disk [${tool}] "${command}" stderr missing "${reasonPart}": ${stderr}`);
      }
    } catch (e) {
      failures++;
      console.error(e.message);
    }
  }
  // Nothing the guard read was changed: the real folder behind the links is whole.
  ran++;
  if (!fs.existsSync(path.join(links, 'packages/lib/index.js'))) {
    failures++;
    console.error('disk: packages/lib/index.js is gone; the guard must only read');
  }
} finally {
  fs.rmSync(diskDir, { recursive: true, force: true });
}

// --- fail-open guards (intentional and observable) ---
const failOpen = [
  ['garbage stdin', 'not json'],
  ['null payload', 'null'],
  ['missing tool_input', JSON.stringify({ tool_name: 'Bash' })],
  ['non-string command', JSON.stringify({ tool_name: 'Bash', tool_input: { command: 42 } })],
  ['empty command', JSON.stringify({ tool_name: 'Bash', tool_input: { command: '' } })],
  ['unknown tool ignored', JSON.stringify({ tool_name: 'Edit', tool_input: { command: 'git reset --hard' } })],
];
for (const [label, input] of failOpen) {
  const { status, stderr } = run(input);
  ran++;
  try {
    assert.equal(status, 0, `${label}: expected fail-open exit 0, got ${status}`);
    assert.equal(stderr, '', `${label}: fail-open must be silent, got: ${stderr}`);
  } catch (e) {
    failures++;
    console.error(e.message);
  }
}

// --- an older or broken Path-guard.mjs skips ONLY the inline-script check ---
// The guard is copied into a scratch folder inside tests/, beside a
// Path-guard.mjs that loads without the helpers or throws while loading. Every
// other rule must still block (review 2026-09-25: an unchecked import switched
// the whole guard off beside a stale path guard). The file names keep the
// kit's capitals, so the copy finds its stub on a case-sensitive disk too.
const STUBS = {
  older: 'export function verdict() { return null; }\n',
  broken: "throw new Error('broken on purpose');\n",
};
const stubCases = [
  ['Bash', 'rm -rf src', 2],
  ['Bash', 'ls; git reset --hard', 2],
  ['PowerShell', 'if (Test-Path src) { Remove-Item src -Recurse -Force }', 2],
  ['Bash', 'find src -delete', 2],
  ['Bash', `node -e "require('fs').rmSync('src',{recursive:true,force:true})"`, 0], // the one check skipped
];
const stubDir = fs.mkdtempSync(path.join(scratchRoot, 'scratch-destructive-guard-'));
try {
  const guardCopy = path.join(stubDir, 'Destructive-guard.mjs');
  fs.copyFileSync(SCRIPT, guardCopy);
  for (const [kind, source] of Object.entries(STUBS)) {
    fs.writeFileSync(path.join(stubDir, 'Path-guard.mjs'), source);
    for (const [tool, command, expected] of stubCases) {
      const { status } = run(payload(command, tool), guardCopy);
      ran++;
      try {
        assert.equal(status, expected, `${kind} Path-guard: [${tool}] "${command}" -> exit ${status}, expected ${expected}`);
      } catch (e) {
        failures++;
        console.error(e.message);
      }
    }
  }
} finally {
  fs.rmSync(stubDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`Destructive-guard-tests.mjs: ${failures} of ${ran} cases FAILED`);
  process.exit(1);
}
console.log(`Destructive-guard-tests.mjs: all ${ran} cases passed (${cases.length} command cases + ${probeCases.length} live-probe cases + ${failOpen.length} fail-open cases + ${ran - cases.length - probeCases.length - failOpen.length} disk and stale Path-guard cases)`);
