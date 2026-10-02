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
#   success  -> exit 0, a `<project>_<stamp>.zip` exists in backups/, every
#               file and folder the walk found is listed in that archive by
#               name, and the git history in it opens (THE HISTORY CHECK
#               below). Outside .git, names are checked, not contents: a
#               damaged entry is not caught.
#   failure  -> exit 1, the reason on stderr, and no ZIP from this run left
#               behind (a ZIP of the same name from an EARLIER run can be).
# There is deliberately no third "mostly worked" outcome. A backup that quietly
# skipped a locked file or an unreadable folder is the one kind that hurts you,
# because the gap shows up only when you are already restoring.
# On success it also prints "Left out by name:", every folder the walk skipped
# because of its name. A source folder on that line means the list below needs
# changing.
#
# THE HISTORY CHECK (2026-10-02). Folders go into the ZIP as entries of their
# own, so a folder that holds no file comes back on a restore. Git packs its
# refs into one file now and then, at the end of a commit or a pull, and
# leaves .git/refs holding only empty folders; a ZIP of files alone then
# restored a .git without refs, which git refuses to call a repository, while
# the run had said OK. So whenever the ZIP holds the project's .git, the run
# proves that history opens before it calls the ZIP good: .git/HEAD,
# .git/objects and .git/refs must be in the archive, and where git is on this
# machine, every entry under .git is copied out of the finished archive into a
# folder of its own in backups/, git opens that copy and reads its latest
# commit, and the folder is removed again. Without git, the three parts alone
# are checked, and the run says so.
#
# WHAT IS NEVER IN THE ZIP, whatever the list below says: the backups/ and .tmp/
# (scratch) folders at the project root, the assistant's personal settings
# (.claude/settings.local.json and its .backup copy, which can hold keys and
# this machine's paths), its worktree copies (.claude/worktrees, whole copies
# of the repository), the .codex folder at any depth, atomic-write leftovers
# (*.tmp, *.tmp.*), and the env files (.env*, .dev.vars*; a template such as
# .env.example, .env.sample or .dev.vars.template is kept), so a restore
# recreates them by hand from the templates. The rest of .claude travels: the
# committed settings.json, which can carry the team's guard wiring, and the
# project's own commands, agents and skills (review 2026-09-28: leaving the
# whole folder out restored a project with no guards, and the next commit
# could record the team's settings file as deleted). Common key files stay out
# too, by name ($KeyFilePatterns below). A secret saved under any other name
# travels in the ZIP, so keep those outside the project. The env and key file
# rules skip the project's own .git, so a branch called fix/credentials
# travels with the history (2026-10-02).
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
# Common key files stay on this machine too, by name (owner, 2026-10-01,
# widened 2026-10-02 after the common real names were found travelling): a
# certificate or private key store (.pem, .p12, .pfx, .jks, .keystore), an
# Apple or PuTTY private key (.p8, .ppk), an SSH private key (id_rsa, id_dsa,
# id_ecdsa, id_ed25519, and the same with a suffix such as id_rsa_work, since
# ssh-keygen users name one key per host), a cloud credentials file (a file
# named credentials in any folder, as AWS names it, and credentials, client
# secret, service account and Firebase adminsdk JSON), an env file named the
# other way round (production.env), the npm, PyPI, netrc and git login files,
# and terraform state, which holds every secret the infrastructure was given.
# A copy of any of them, the name followed by one of $KeyCopyEndings
# (id_rsa.old, key.pem.bak), stays out too. An SSH public key (.pub) is not a
# secret and travels.
# Forced like the lists above, so editing the setup block cannot widen it. A
# run names every key file it left out, since a restore has to bring them
# back by hand. A secret saved under any other name still travels.
# A Keynote deck ends in .key, so that ending is deliberately not listed.
$KeyFilePatterns = @('*.pem', '*.p12', '*.pfx', '*.jks', '*.keystore', '*.p8', '*.ppk', 'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', 'id_rsa_*', 'id_dsa_*', 'id_ecdsa_*', 'id_ed25519_*', 'credentials', '*credentials*.json', 'client_secret*.json', '*service-account*.json', '*service_account*.json', '*serviceAccount*.json', '*adminsdk*.json', '*.env', '.npmrc', '.pypirc', '.netrc', '.git-credentials', '*.tfstate', '*.tfstate.*')
$KeyCopyEndings = @('.bak', '.old', '.orig')
$PublicKeyPatterns = @('*.pub')
# A template travels, key file and env file alike (2026-10-01): a name whose
# last dot-separated part, or the part just before its ending, is one of
# these words, so .env.sample, .env.production.example and
# credentials.example.json all go in. The word has to be a whole part at the
# end of the name. A test for the word anywhere let a real certificate such
# as www.example.com.pem or tls.sample-site.pem into the ZIP unnamed.
# Compared after lowering the name, ordinally, so nothing about this
# machine's culture can make the twins disagree.
$TemplateWords = @('example', 'sample', 'template')
function Test-Template([string]$name) {
    $parts = $name.ToLowerInvariant().Split('.')
    $last  = $parts.Count - 1
    foreach ($i in @($last, ($last - 1))) {
        if ($i -lt 0) { continue }
        foreach ($w in $TemplateWords) {
            if ([string]::Equals($parts[$i], $w, [StringComparison]::Ordinal)) { return $true }
        }
    }
    return $false
}
function Test-KeyName([string]$name) {
    if (Test-Template $name) { return $false }
    foreach ($p in $PublicKeyPatterns) { if ($name -like $p) { return $false } }
    foreach ($p in $KeyFilePatterns)   { if ($name -like $p) { return $true } }
    return $false
}
# A copy is judged by the name it was copied from, so id_rsa.pub.bak travels
# like id_rsa.pub, and a template's copy travels like the template.
function Test-KeyFile([string]$name) {
    if (Test-KeyName $name) { return $true }
    $lower = $name.ToLowerInvariant()
    foreach ($e in $KeyCopyEndings) {
        if ($lower.Length -gt $e.Length -and $lower.EndsWith($e, [StringComparison]::Ordinal)) {
            return (Test-KeyName $name.Substring(0, $name.Length - $e.Length))
        }
    }
    return $false
}

# The key-file line prints in one order on every machine and in both twins:
# ASCII letters compared without case, every other character by its UTF-16
# code unit, and the exact name breaking a tie. Sort-Object sorted by this
# machine's culture and the Node twin by its own collation, so the same key
# files printed in two orders (2026-10-01). The sort key is the folded name, a
# NUL that no file name holds, then the name itself, compared ordinally.
function Get-NameSortKey([string]$s) {
    $chars = $s.ToCharArray()
    for ($i = 0; $i -lt $chars.Length; $i++) {
        $c = [int]$chars[$i]
        if ($c -ge 97 -and $c -le 122) { $chars[$i] = [char]($c - 32) }
    }
    (-join $chars) + [char]0 + $s
}
function Sort-Names([string[]]$names) {
    $items = [string[]]@($names)
    $keys  = [string[]]@($items | ForEach-Object { Get-NameSortKey $_ })
    [Array]::Sort($keys, $items, [StringComparer]::Ordinal)
    $items
}

$stamp   = Get-Date -Format 'yyyy-MM-dd_HH-mm'
$backups = Join-Path $root 'backups'
$zipPath = Join-Path $backups "${RepoName}_${stamp}.zip"

New-Item -ItemType Directory -Force -Path $backups | Out-Null

$script:enumErrors = @()
$script:pruned     = @()
$script:keyFiles   = @()
$script:folders    = New-Object 'System.Collections.Generic.List[object]'

# $inGit is true under the project's own .git folder, where the name rules for
# env and key files do not apply.
function Get-BackupFiles($dir, [bool]$inGit = $false) {
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
            $script:folders.Add($entry)
            Get-BackupFiles $entry.FullName ($inGit -or (($dir -eq $root) -and ($entry.Name -eq '.git')))
            continue
        }
        # The assistant's personal settings stay on this machine.
        if ($inClaude -and ($ClaudeLocalFiles -contains $entry.Name)) { continue }
        # Atomic-write leftovers.
        if ($entry.Name -like '*.tmp' -or $entry.Name -like '*.tmp.*') { continue }
        # Env files and the common key files stay on this machine; the
        # templates travel. A secret under any other name still goes in.
        # An env file named the other way round (production.env) is a key file
        # instead, so the run names it.
        # Neither rule applies under the project's own .git: git's files there are
        # never secrets by name, and a branch called fix/credentials is a ref file
        # the restored history needs. Left out, the restore lost that branch, and
        # the history check failed whenever it was checked out (2026-10-02).
        if (-not $inGit -and (($entry.Name -like '.env*') -or ($entry.Name -like '.dev.vars*')) -and -not (Test-Template $entry.Name)) { continue }
        if (-not $inGit -and (Test-KeyFile $entry.Name)) {
            $script:keyFiles += $entry.FullName.Substring($root.Length + 1).Replace('\', '/')
            continue
        }
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

# The folder the history check copies the history into, removed again on
# every path out.
$script:checkDir = $null
function Remove-CheckDir {
    if ($null -eq $script:checkDir) { return $true }
    # Retried for a moment, as the twin's rmSync is: a virus scanner can hold
    # a file it just saw being written.
    for ($i = 0; $i -lt 6 -and (Test-Path -LiteralPath $script:checkDir); $i++) {
        if ($i -gt 0) { Start-Sleep -Milliseconds 200 }
        Remove-Item -LiteralPath $script:checkDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    return (-not (Test-Path -LiteralPath $script:checkDir))
}
function Get-CheckDirLeft { "The history check folder could not be removed, delete it by hand: $($script:checkDir)" }

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
    if (-not (Remove-CheckDir)) { [Console]::Error.WriteLine((Get-CheckDirLeft)) }
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
# what the archive actually ended up holding. A folder's name ends in a slash,
# as its entry's does.
$expected = New-Object 'System.Collections.Generic.HashSet[string]'
$relByPath = @{}
# ToArray, not @(): Windows PowerShell 5.1 fails to join @() of a generic list
# to another array ("Argument types do not match").
foreach ($f in $script:folders.ToArray() + $files) {
    # Forward slashes so the entry names are portable (zip spec + any tool).
    $rel = $f.FullName.Substring($root.Length + 1).Replace('\', '/')
    if ($f.PSIsContainer) { $rel += '/' }
    [void]$expected.Add($rel)
    $relByPath[$f.FullName] = $rel
}

$added        = 0
$addedFolders = 0
$skipped      = @()
$zip = [System.IO.Compression.ZipFile]::Open($partial, 'Create')
try {
    # A folder goes in as an entry of its own, with no data, so a folder that
    # holds no file still comes back on a restore (THE HISTORY CHECK above).
    foreach ($d in $script:folders) {
        $rel = $relByPath[$d.FullName]
        try {
            $folderEntry = $zip.CreateEntry($rel)
            # The folder's own time, made to fit the format as
            # CreateEntryFromFile does for a file.
            $when = $d.LastWriteTime
            if ($when.Year -lt 1980 -or $when.Year -gt 2107) { $when = New-Object DateTime 1980, 1, 1 }
            $folderEntry.LastWriteTime = $when
            $addedFolders++
        } catch {
            $skipped += "${rel}: $($_.Exception.Message)"
        }
    }
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
# unreadable, and any entry-name mangling. Outside .git it reads names only:
# an entry whose content was damaged still passes, and so does anything the
# walk itself skipped, since the expected list comes from that same walk.
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

# The history check (THE HISTORY CHECK in the header).

# What git looks for before it calls a folder a repository.
$HistoryParts = @('HEAD', 'objects/', 'refs/')

# git runs with every GIT_ variable dropped, so a hook's GIT_DIR or
# GIT_OBJECT_DIRECTORY cannot point the check at the live history, and with
# safe.directory opened for that one call, since the copy sits in a folder no
# safe.directory setting names. Each argument is quoted for the command line.
function Invoke-GitCommand([string[]]$gitArgs) {
    try {
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $script:gitExe
        $quoted = foreach ($a in $gitArgs) { '"' + (($a -replace '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1') + '"' }
        $psi.Arguments = $quoted -join ' '
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow = $true
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        foreach ($k in @($psi.EnvironmentVariables.Keys)) {
            if ($k -like 'GIT_*') { $psi.EnvironmentVariables.Remove($k) }
        }
        $p = [System.Diagnostics.Process]::Start($psi)
        $errTask = $p.StandardError.ReadToEndAsync()
        $out = $p.StandardOutput.ReadToEnd()
        $p.WaitForExit()
        $err = $errTask.Result.Trim()
        if (-not $err) { $err = "git exited with $($p.ExitCode)" }
        return [pscustomobject]@{ Ok = ($p.ExitCode -eq 0); Out = $out.Trim(); Err = $err }
    } catch {
        return [pscustomobject]@{ Ok = $false; Out = ''; Err = $_.Exception.Message }
    }
}
function Invoke-Git([string]$gitDir, [string[]]$gitArgs) {
    Invoke-GitCommand (@('-c', 'safe.directory=*', "--git-dir=$gitDir") + $gitArgs)
}
function Test-GitFound {
    $cmd = Get-Command git -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $cmd) { return $false }
    $script:gitExe = $cmd.Path
    return (Invoke-GitCommand @('--version')).Ok
}

# Proves the snapshot's history opens, or stops the run. It returns the line
# the run prints about it.
function Get-HistoryLine($gitFolder, [string]$gitName, $names) {
    $anyCase = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($n in $names) { [void]$anyCase.Add($n) }
    $absent = @()
    foreach ($p in $HistoryParts) {
        if (-not $anyCase.Contains("$gitName/$p")) { $absent += "$gitName/$p" }
    }
    if ($absent.Count -gt 0) {
        # Every name the walk found is in the archive by now, so the project's
        # own .git lacks the part too.
        Stop-WithFailure "the snapshot's history would not open: git needs $gitName/HEAD, $gitName/objects and $gitName/refs, and $($absent.Count) of them are not in the archive" (@($absent) + "the project's own $gitName lacks it too, so git cannot open this project's history either")
    }
    $parts = "$gitName/HEAD, $gitName/objects and $gitName/refs are in the archive"
    if (-not (Test-GitFound)) { return "History check: git was not found, so only the parts git needs were checked: $parts." }

    # Every entry under .git is copied out of the finished archive, as any
    # unzip would: a folder entry becomes a folder, a file entry its file.
    try {
        $script:checkDir = Join-Path $backups ('history-check-' + [IO.Path]::GetRandomFileName().Replace('.', '').Substring(0, 6))
        [void][IO.Directory]::CreateDirectory($script:checkDir)
        $reader = [System.IO.Compression.ZipFile]::OpenRead($partial)
        try {
            foreach ($entry in $reader.Entries) {
                if (-not $entry.FullName.StartsWith("$gitName/", [StringComparison]::Ordinal)) { continue }
                $out = [IO.Path]::Combine($script:checkDir, $entry.FullName.Replace('/', [IO.Path]::DirectorySeparatorChar))
                if ($entry.FullName.EndsWith('/')) {
                    [void][IO.Directory]::CreateDirectory($out)
                    continue
                }
                [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($out))
                [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $out, $true)
            }
        } finally {
            $reader.Dispose()
        }
    } catch {
        Stop-WithFailure "the snapshot's history could not be copied out of the archive to check it" @($_.Exception.Message)
    }
    $copy = Join-Path $script:checkDir $gitName
    $opens = Invoke-Git $copy @('rev-parse', '--git-dir')
    if (-not $opens.Ok) {
        if ((Invoke-Git $gitFolder.FullName @('rev-parse', '--git-dir')).Ok) {
            Stop-WithFailure "the snapshot's history does not open with git, although this project's does" @($opens.Err)
        }
        return "History check: git cannot open this project's own history either, so only the parts git needs were checked: $parts."
    }
    # Reading the latest commit proves the refs lead somewhere and the object
    # they name comes out of the archive whole. Signatures are kept out of that
    # read: with log.showSignature set, in the user's git config or the
    # project's own, git log prints its signature lines on the same output as
    # the hash, and a signed latest commit failed every run (2026-10-02). As a
    # -c setting rather than a flag, so a git too old to know it ignores it.
    $head = Invoke-Git $copy @('rev-parse', '--verify', '--quiet', 'HEAD')
    if ($head.Ok) {
        $log = Invoke-Git $copy @('-c', 'log.showSignature=false', 'log', '-1', '--format=%H')
        if (-not $log.Ok -or $log.Out -cne $head.Out) {
            $why = if ($log.Ok) { "git log names $($log.Out), HEAD names $($head.Out)" } else { $log.Err }
            Stop-WithFailure "the snapshot's latest commit cannot be read back with git" @($why)
        }
        return "History check: the snapshot's history opens with git, latest commit $($head.Out)."
    }
    # No latest commit in the copy is right only for a project with none yet.
    $liveHead = Invoke-Git $gitFolder.FullName @('rev-parse', '--verify', '--quiet', 'HEAD')
    if ($liveHead.Ok) {
        Stop-WithFailure "the snapshot's history has no latest commit, although this project's has one" @("this project's latest commit: $($liveHead.Out)")
    }
    return "History check: the snapshot's history opens with git and holds no commit yet."
}

# The project's .git, when the walk took it in: the setup block can leave it
# out for a working-tree-only ZIP, and then there is no history to check.
$gitFolder = $null
foreach ($d in $script:folders) {
    if ($relByPath[$d.FullName] -eq '.git/') { $gitFolder = $d; break }
}
$historyLine = $null
if ($null -ne $gitFolder) {
    $historyLine = Get-HistoryLine $gitFolder $relByPath[$gitFolder.FullName].TrimEnd('/') $actual
}
$checkDirStays = -not (Remove-CheckDir)

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
Write-Host "Added $added file(s) and $addedFolders folder(s), all $($actual.Count) verified present in the archive by name."
if ($null -ne $historyLine) { Write-Host $historyLine }
if ($script:pruned.Count -gt 0) {
    Write-Host ("Left out by name: " + ((Sort-Names $script:pruned) -join ', '))
}
if ($script:keyFiles.Count -gt 0) {
    Write-Host ("Left out as key files (bring them back by hand on a restore): " + ((Sort-Names $script:keyFiles) -join ', '))
}
if ($checkDirStays) { Write-Host (Get-CheckDirLeft) }
