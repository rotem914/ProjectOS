# Backup-whole-project.ps1
# Its Node twin is Backup-whole-project.mjs, and the two must always change together.
# Why this exists: one local, self-contained ZIP snapshot of the whole project,
# for offline disaster recovery that does NOT depend on any git host or sync
# folder. Code, docs, content and the full git history in one file you can put
# on a drive. PowerShell so nothing has to be installed on Windows; regenerable
# build folders are left out so the ZIP stays small and restorable.
#
# Run it, from the project root:
#   powershell -NoProfile -ExecutionPolicy Bypass -File project-os/Backup-whole-project.ps1
#   pwsh -NoProfile -File project-os/Backup-whole-project.ps1          (macOS / Linux)
# It is wired to the `Go backup` shortcut in CLAUDE.md.
#
# FAILURE CONTRACT. This script has exactly two outcomes:
#   success  -> exit 0, a `<project>_<stamp>.zip` exists in backups/, and every
#               file the walk found is listed in that archive by name. Names
#               are checked, not contents: a damaged entry is not caught.
#   failure  -> exit 1, the reason on stderr, and no ZIP from this run left
#               behind (a ZIP of the same name from an EARLIER run can be).
# There is deliberately no third "mostly worked" outcome. A backup that quietly
# skipped a locked file or an unreadable folder is the one kind that hurts you,
# because the gap shows up only when you are already restoring.
# On success it also prints "Left out by name:", every folder the walk skipped
# because of its name. A source folder on that line means the list below needs
# changing.
#
# WHAT IS NEVER IN THE ZIP, whatever the list below says: the backups/ and .tmp/
# (scratch) folders at the project root, the assistant's personal settings
# (.claude/settings.local.json and its .backup copy, which can hold keys and
# this machine's paths), its worktree copies (.claude/worktrees, whole copies
# of the repository), the .codex folder at any depth, atomic-write leftovers
# (*.tmp, *.tmp.*), and the env files (.env*, .dev.vars*; the .env.example and
# .dev.vars.example templates are kept), so a restore recreates them by hand
# from the templates. The rest of .claude travels: the committed
# settings.json, which can carry the team's guard wiring, and the project's
# own commands, agents and skills (review 2026-09-28: leaving the whole folder
# out restored a project with no guards, and the next commit could record the
# team's settings file as deleted). Any other key file inside the project
# travels in the ZIP, so keep keys outside the project.
#
# A git worktree or submodule is refused: its .git is a file pointing at
# history kept in another folder, so the ZIP would hold no history. Commit
# there, then run this from the main project folder.

Add-Type -AssemblyName System.IO.Compression.FileSystem

# This file sits in project-os/, one level below the project root.
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path.TrimEnd('\')

# --- Setup block: check this list against the stack at install ---------------
# Folders that never belong in a restore snapshot because they are regenerated
# from what IS in it (dependencies, build output, caches). The walk prunes them
# as it descends, so it never even enters them. A listed name is skipped at
# EVERY depth, so a source folder such as src/dist is skipped too; the
# "Left out by name" line of each run shows what was. Add the stack's own;
# remove a name only if this project commits that folder on purpose. Add '.git'
# here for a smaller, working-tree-only ZIP without the history.
# The install adds build, target or any other output folder only when this project's own tools write output there.
$ExcludeDirs = @(
    'node_modules'   # npm / pnpm / yarn dependencies
    'dist'           # build output
    '.next'          # Next.js output and cache
    '.nuxt'          # Nuxt output and cache
    '.astro'         # Astro generated types and cache
    '.svelte-kit'    # SvelteKit output and cache
    '.cache'         # generic tool cache
    'coverage'       # test coverage output
    '.venv'          # Python virtualenvs
    '__pycache__'    # Python bytecode
)
# --- End of setup block -------------------------------------------------------

# The ZIP name: the project folder's leaf, spaces to underscores so the filename
# is safe everywhere.
$RepoName = ((Split-Path $root -Leaf) -replace '\s+', '_')

# Forced regardless of the list above: the .codex folder at any depth, the
# assistant's worktree copies under .claude, and at the project root only, the
# backup output (never nest the ZIP inside itself) and the scratch folder.
# Those are per-machine state; a restore recreates them. Forced so the secrets
# and local-state posture cannot be widened by editing the list. A folder
# called backups or .tmp deeper down is ordinary project content and travels.
foreach ($force in @('.codex')) {
    if ($ExcludeDirs -notcontains $force) { $ExcludeDirs = @($ExcludeDirs) + $force }
}
$RootOnlyDirs = @('backups', '.tmp')
# Inside any .claude folder: the personal settings file and its backup copy
# stay on this machine, and the worktrees folder is left out.
$ClaudeLocalFiles = @('settings.local.json', 'settings.local.json.backup', 'settings.json.backup')
$ClaudeLocalDirs  = @('worktrees')

$stamp   = Get-Date -Format 'yyyy-MM-dd_HH-mm'
$backups = Join-Path $root 'backups'
$zipPath = Join-Path $backups "${RepoName}_${stamp}.zip"

New-Item -ItemType Directory -Force -Path $backups | Out-Null

$script:enumErrors = @()
$script:pruned     = @()

function Get-BackupFiles($dir) {
    # Enumeration failure is FATAL, never silent. With -ErrorAction
    # SilentlyContinue an unreadable directory (permissions, a sync-client lock,
    # a path past MAX_PATH) yields zero entries for its ENTIRE subtree, recorded
    # nowhere, while the script still prints OK. A silently short ZIP is worse
    # than no ZIP, because it is trusted.
    $entries = $null
    try {
        $entries = Get-ChildItem -LiteralPath $dir -Force -ErrorAction Stop
    } catch {
        $script:enumErrors += "$dir  --  $($_.Exception.Message)"
        return
    }
    $inClaude = ((Split-Path $dir -Leaf) -eq '.claude')
    foreach ($entry in $entries) {
        if ($entry.PSIsContainer) {
            if (($ExcludeDirs -contains $entry.Name) -or
                (($dir -eq $root) -and ($RootOnlyDirs -contains $entry.Name)) -or
                ($inClaude -and ($ClaudeLocalDirs -contains $entry.Name))) {
                # Recorded, so a skipped source folder shows in the output.
                $script:pruned += $entry.FullName.Substring($root.Length + 1).Replace('\', '/')
                continue
            }
            Get-BackupFiles $entry.FullName
            continue
        }
        # The assistant's personal settings stay on this machine.
        if ($inClaude -and ($ClaudeLocalFiles -contains $entry.Name)) { continue }
        # Atomic-write leftovers.
        if ($entry.Name -like '*.tmp' -or $entry.Name -like '*.tmp.*') { continue }
        # Real secret files stay on this machine; the templates travel.
        if ($entry.Name -like '.env*' -and $entry.Name -ne '.env.example') { continue }
        if ($entry.Name -like '.dev.vars*' -and $entry.Name -ne '.dev.vars.example') { continue }
        $entry
    }
}

# Everything below writes to a PARTIAL name and only renames to the real .zip
# once the archive has been proved complete. A file called
# `<project>_<stamp>.zip` therefore means "verified"; a failed run never leaves
# one of its own, so a later restore can never pick up a half-written snapshot
# believing it is good.
$partial = "$zipPath.partial"
if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }

function Stop-WithFailure([string]$summary, [string[]]$details) {
    [Console]::Error.WriteLine("BACKUP FAILED: $summary")
    foreach ($d in $details) { [Console]::Error.WriteLine("  - $d") }
    # ASCII only inside these strings: Windows PowerShell 5.1 reads a UTF-8 file
    # without a BOM as ANSI, so a non-ASCII character here becomes mojibake and
    # can break parsing outright.
    [Console]::Error.WriteLine("No .zip was produced. Nothing here is a usable snapshot - fix the cause and re-run.")
    if (Test-Path -LiteralPath $partial) {
        Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
    }
    exit 1
}

# A .git FILE (not a folder) means a git worktree or submodule: its history
# lives in another folder, so a ZIP of this one would hold no history. Unless
# the setup block left .git out on purpose (a working-tree-only ZIP).
$dotGit = Join-Path $root '.git'
if (($ExcludeDirs -notcontains '.git') -and (Test-Path -LiteralPath $dotGit -PathType Leaf)) {
    $pointer = ''
    try { $pointer = [string](Get-Content -LiteralPath $dotGit -TotalCount 1 -ErrorAction Stop) } catch { }
    $pointer = $pointer -replace '^gitdir:\s*', ''
    Stop-WithFailure "this folder's .git is a file that points elsewhere (a git worktree or submodule), so a ZIP of it would hold no history" @("history lives in: $pointer", "commit the work here, then run Go backup from the main project folder")
}

$files = @(Get-BackupFiles $root)

if ($script:enumErrors.Count -gt 0) {
    Stop-WithFailure "could not read $($script:enumErrors.Count) directory/ies, so the file list is incomplete" $script:enumErrors
}
if ($files.Count -eq 0) {
    Stop-WithFailure "walked the project and found no files at all" @("root: $root")
}

# Expected contents, decided BEFORE writing so they can be compared against
# what the archive actually ended up holding.
$expected = New-Object 'System.Collections.Generic.HashSet[string]'
$relByPath = @{}
foreach ($f in $files) {
    # Forward slashes so the entry names are portable (zip spec + any tool).
    $rel = $f.FullName.Substring($root.Length + 1).Replace('\', '/')
    [void]$expected.Add($rel)
    $relByPath[$f.FullName] = $rel
}

$added   = 0
$skipped = @()
$zip = [System.IO.Compression.ZipFile]::Open($partial, 'Create')
try {
    foreach ($f in $files) {
        $rel = $relByPath[$f.FullName]
        try {
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $zip, $f.FullName, $rel,
                [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
            $added++
        } catch {
            # A locked file is fatal like any other omission: a snapshot missing
            # a file is not a snapshot.
            $skipped += "$rel  --  $($_.Exception.Message)"
        }
    }
} finally {
    $zip.Dispose()
}

if ($skipped.Count -gt 0) {
    Stop-WithFailure "$($skipped.Count) file(s) could not be added (locked or unreadable)" $skipped
}

# Independent read-back: trust what the archive HOLDS, not what the writer
# thought it wrote. Catches a missing entry, an archive a mid-write crash left
# unreadable, and any entry-name mangling. It reads names only: an entry whose
# content was damaged still passes, and so does anything the walk itself
# skipped, since the expected list comes from that same walk.
$actual = New-Object 'System.Collections.Generic.HashSet[string]'
try {
    $verify = [System.IO.Compression.ZipFile]::OpenRead($partial)
    try {
        foreach ($entry in $verify.Entries) { [void]$actual.Add($entry.FullName) }
    } finally {
        $verify.Dispose()
    }
} catch {
    Stop-WithFailure "the finished archive could not be re-opened for verification" @($_.Exception.Message)
}

$missing = @($expected | Where-Object { -not $actual.Contains($_) })
if ($missing.Count -gt 0) {
    Stop-WithFailure "$($missing.Count) expected file(s) are absent from the finished archive" $missing
}

# The rename is checked like every other step: a failed one used to print OK
# over an older ZIP of the same name, or over no ZIP at all. Another program
# can hold the name for a moment, so it is retried before it fails.
$moved   = $false
$lastErr = ''
for ($i = 0; $i -lt 5 -and -not $moved; $i++) {
    try {
        Move-Item -LiteralPath $partial -Destination $zipPath -Force -ErrorAction Stop
        $moved = $true
    } catch {
        $lastErr = $_.Exception.Message
        Start-Sleep -Milliseconds 500
    }
}
if (-not $moved -or -not (Test-Path -LiteralPath $zipPath)) {
    Stop-WithFailure "the verified archive could not be renamed to its final name" @($lastErr, "Any $zipPath already in backups is from an EARLIER run and does not hold this run's changes. Close whatever has it open and re-run.")
}

Write-Host "OK: $zipPath"
Write-Host "Added $added file(s), all $($actual.Count) verified present in the archive by name."
if ($script:pruned.Count -gt 0) {
    Write-Host ("Left out by name: " + ((@($script:pruned) | Sort-Object) -join ', '))
}
