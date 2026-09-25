# Backup-whole-project.ps1
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
#               file the walk found was read back OUT of that archive by name.
#   failure  -> exit 1, the reason on stderr, and NO .zip left behind.
# There is deliberately no third "mostly worked" outcome. A backup that quietly
# skipped a locked file or an unreadable folder is the one kind that hurts you,
# because the gap shows up only when you are already restoring.
#
# WHAT IS NEVER IN THE ZIP, whatever the list below says: the backups/ folder
# itself, the assistant's machine-local folders (.claude, .codex), the scratch
# folder (.tmp), atomic-write leftovers (*.tmp, *.tmp.*), and the env files
# (.env*, .dev.vars*; the .env.example and .dev.vars.example templates are
# kept), so a restore recreates them by hand from the templates. Any other key
# file inside the project travels in the ZIP, so keep keys outside the project.

Add-Type -AssemblyName System.IO.Compression.FileSystem

# This file sits in project-os/, one level below the project root.
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path.TrimEnd('\')

# --- Setup block: check this list against the stack at install ---------------
# Folders that never belong in a restore snapshot because they are regenerated
# from what IS in it (dependencies, build output, caches). The walk prunes them
# as it descends, so it never even enters them. Add the stack's own; remove a
# name only if this project commits that folder on purpose. Add '.git' here for
# a smaller, working-tree-only ZIP without the history.
$ExcludeDirs = @(
    'node_modules'   # npm / pnpm / yarn dependencies
    'dist'           # build output
    'build'          # build output
    '.next'          # Next.js output and cache
    '.nuxt'          # Nuxt output and cache
    '.astro'         # Astro generated types and cache
    '.svelte-kit'    # SvelteKit output and cache
    '.cache'         # generic tool cache
    'coverage'       # test coverage output
    '.venv'          # Python virtualenvs
    '__pycache__'    # Python bytecode
    'target'         # Rust / Maven / Gradle output
)
# --- End of setup block -------------------------------------------------------

# The ZIP name: the project folder's leaf, spaces to underscores so the filename
# is safe everywhere.
$RepoName = ((Split-Path $root -Leaf) -replace '\s+', '_')

# Forced regardless of the list above: the backup output (never nest the ZIP
# inside itself), the assistant's machine-local folders, and the scratch folder.
# Those are per-machine state; a restore recreates them. Forced so the
# secrets and local-state posture cannot be widened by editing the list.
foreach ($force in @('backups', '.claude', '.codex', '.tmp')) {
    if ($ExcludeDirs -notcontains $force) { $ExcludeDirs = @($ExcludeDirs) + $force }
}

$stamp   = Get-Date -Format 'yyyy-MM-dd_HH-mm'
$backups = Join-Path $root 'backups'
$zipPath = Join-Path $backups "${RepoName}_${stamp}.zip"

New-Item -ItemType Directory -Force -Path $backups | Out-Null

$script:enumErrors = @()

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
    foreach ($entry in $entries) {
        if ($entry.PSIsContainer) {
            if ($ExcludeDirs -contains $entry.Name) { continue }
            Get-BackupFiles $entry.FullName
            continue
        }
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
# `<project>_<stamp>.zip` therefore means "verified"; a failed run leaves no
# such file, so a later restore can never pick up a half-written snapshot
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
# thought it wrote. Catches a silent truncation, a mid-write crash, and any
# entry-name mangling.
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

Move-Item -LiteralPath $partial -Destination $zipPath -Force

Write-Host "OK: $zipPath"
Write-Host "Added $added file(s), all $($actual.Count) verified present in the archive."
