# rotate.ps1
# Why this exists: every ProjectOS file that accumulates forever is read at task
# pickup, so each one needs a ceiling. This script gives all of them the same
# mechanism: the live file keeps the newest material, everything older MOVES
# verbatim into a sibling *-archive.md that is not read by default.
#
# MOVEMENT, NOT REWRITE. Rows and entries are relocated byte for byte. Nothing is
# compressed, edited, renumbered or deleted, and re-running is idempotent (every
# archive append dedups). That is what keeps this script inside CLAUDE.md rule 4.
#
# ONE SCRIPT, THREE ENGINES, because the files grow in three shapes:
#   history   History.md: a deep-row table (newest rows protected by a count
#             floor) plus, in project-os/History.md, the Scan log above it.
#   section   Decisions.md: one "## YYYY-MM-DD · Title" block per decision.
#   table     Backlog / Mistakes / BugAtlas: one markdown row per item.
#
# WHAT IS NEVER TOUCHED: the always-read parts. Decisions keeps its whole
# "## Index" list live, Backlog keeps its "## Open" table, Mistakes keeps its
# "## Open" table. The Scan log is trimmed by count but never edited.
#
# Preview (writes nothing):
#   powershell -NoProfile -ExecutionPolicy Bypass -File project-os/rotate.ps1 -DryRun
#   pwsh -NoProfile -File project-os/rotate.ps1 -DryRun
# Apply for real: the same lines without -DryRun. It runs at `Go commit`.

[CmdletBinding()]
param(
    [switch]$DryRun,

    # --- History engine ---------------------------------------------------
    # Size target per live History file (soft: the row floors override it).
    [int]$TargetKB        = 80,
    [int]$MaxMonths       = 3,    # deep rows older than this are rotation candidates
    [int]$MinKeepRows     = 20,   # never keep fewer than this many newest deep rows
    [int]$MaxKeepRows     = 20,   # HARD cap: never keep more than this (the jam-killer)
    [int]$MinKeepDays     = 0,    # calendar courtesy; 0 = pure count (the default)
    [int]$RowCharBudget   = 400,  # warn (do not act) on live rows longer than this
    [int]$MaxKeepScanRows = 80,   # newest Scan-log rows kept live (0 = never rotate it)

    # --- Section and table engines ---------------------------------------
    # Newest entries kept live, per section. Pure counts, velocity-proof.
    [int]$MaxKeepDecisions = 25,  # newest decision entries kept in a Decisions.md
    [int]$MaxKeepBacklog   = 40,  # newest rows kept in Backlog.md "## Done"
    [int]$MaxKeepMistakes  = 30,  # newest rows kept in a Mistakes.md tail section
    [int]$MaxKeepAtlas     = 30   # newest rows kept in a BugAtlas.md "## Atlas"
)

$ErrorActionPreference = 'Stop'
$kb   = 1024.0
$utf8 = [System.Text.UTF8Encoding]::new($false)   # UTF-8, no BOM

# The kit installs into project-os/ at the repo root, so the root is one level up.
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path.TrimEnd([char]0x5C, [char]0x2F)
$pos  = Join-Path $root 'project-os'

# Project config: dot-source projectos.config.ps1 if present. A project can add
# its own growing files through $ExtraHistoryTargets and $ExtraDocTargets
# without editing this script.
$ExtraHistoryTargets = @()
$ExtraDocTargets     = @()
$configPath = Join-Path $PSScriptRoot 'projectos.config.ps1'
if (Test-Path -LiteralPath $configPath) { . $configPath }
if ($null -eq $ExtraHistoryTargets) { $ExtraHistoryTargets = @() }
if ($null -eq $ExtraDocTargets)     { $ExtraDocTargets     = @() }

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------
function Read-DocLines($path) {
    $raw = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
    $eol = if ($raw -match "`r`n") { "`r`n" } else { "`n" }
    return [pscustomobject]@{ Lines = ([regex]::Split($raw, "`r?`n")); Eol = $eol }
}
function FmtKB($bytes) { '{0,7:N1} KB' -f ($bytes / $kb) }
function Ensure-Eol($s, $eol) { if ($s.EndsWith($eol)) { return $s } else { return $s + $eol } }
function Write-Atomic($path, $text, $enc) {
    $tmp = "$path.tmp"
    [System.IO.File]::WriteAllText($tmp, $text, $enc)
    Move-Item -LiteralPath $tmp -Destination $path -Force
}

# Lines inside a fenced code block are INVISIBLE to the section and table
# engines. The Decisions "Required format" example contains a literal
# "## YYYY-MM-DD" heading; without this it would rotate as if it were real.
function Get-FenceMask($lines) {
    $mask = New-Object 'bool[]' $lines.Count
    $open = $null
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $m = [regex]::Match($lines[$i], '^\s*(`{3,}|~{3,})')
        if ($null -eq $open) {
            if ($m.Success) { $open = $m.Groups[1].Value.Substring(0, 1); $mask[$i] = $true }
        } else {
            $mask[$i] = $true
            if ($m.Success -and $m.Groups[1].Value.StartsWith($open)) { $open = $null }
        }
    }
    return $mask
}
function Find-Section($lines, $mask, $heading) {
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($mask[$i]) { continue }
        if ($lines[$i] -match ('^' + [regex]::Escape($heading) + '\s*$')) { return $i }
    }
    return -1
}
function Find-SectionEnd($lines, $mask, $startIdx) {
    for ($i = $startIdx + 1; $i -lt $lines.Count; $i++) {
        if ($mask[$i]) { continue }
        if ($lines[$i] -match '^##\s') { return $i }
    }
    return $lines.Count
}

$grandMoved = 0
$modeLabel  = if ($DryRun) { '[DRY RUN - no files written]' } else { '[LIVE RUN]' }
Write-Host ("rotate.ps1  {0}" -f $modeLabel)
Write-Host ('-' * 78)

# ===========================================================================
# ENGINE 1: History (deep-row tables + the Scan log)
# ===========================================================================
function Test-HasDeepRows($path) {
    if (-not (Test-Path -LiteralPath $path)) { return $false }
    foreach ($ln in [System.IO.File]::ReadAllLines($path, [System.Text.Encoding]::UTF8)) {
        if ($ln -match '^\|\s*\d{4}-\d{2}-\d{2}\s*\|') { return $true }
    }
    return $false
}
function Get-RowDate($line) {
    $m = [regex]::Match($line, '^\|\s*(\d{4}-\d{2}-\d{2})\s*\|')
    if ($m.Success) { return [datetime]::ParseExact($m.Groups[1].Value, 'yyyy-MM-dd', $null) }
    return $null
}
function Get-KeptBytes($allLines, $eol, $moveList) {
    $idx = @{}; foreach ($m in $moveList) { $idx[$m.Index] = $true }
    $kept = New-Object System.Collections.Generic.List[string]
    for ($i = 0; $i -lt $allLines.Count; $i++) { if (-not $idx.ContainsKey($i)) { $kept.Add($allLines[$i]) | Out-Null } }
    return [System.Text.Encoding]::UTF8.GetByteCount(($kept -join $eol))
}
# Header + separator of a table, taken from the live file, so a NEW archive
# opens with the same columns the rows were written under.
function Get-TableHead($allLines, $fromIdx, $toIdx) {
    $h = $null; $s = $null
    for ($i = $fromIdx + 1; $i -lt $toIdx; $i++) {
        if ($allLines[$i] -match '^\|.*\|\s*$') {
            if ($allLines[$i] -match '^\|[\s\-:|]+\|\s*$') { if ($null -ne $h) { $s = $allLines[$i]; break } }
            elseif ($null -eq $h) { $h = $allLines[$i] }
        }
    }
    return @($h, $s)
}
# Append rows verbatim to a row archive, scaffolding it if absent. Dedup is on
# the trimmed row text, so re-running never duplicates a row.
function Write-RowArchive($archPath, $liveName, $blurb, $hdr, $sep, $rows, $eol, $enc) {
    $existing = New-Object System.Collections.Generic.HashSet[string]
    $archiveLines = New-Object System.Collections.Generic.List[string]
    if (Test-Path -LiteralPath $archPath) {
        foreach ($ln in [System.IO.File]::ReadAllLines($archPath, [System.Text.Encoding]::UTF8)) {
            $archiveLines.Add($ln) | Out-Null; [void]$existing.Add($ln.Trim())
        }
    } else {
        $archiveLines.Add(('# {0} - {1}' -f $liveName, $blurb)) | Out-Null
        $archiveLines.Add('') | Out-Null
        $archiveLines.Add('NOT read by default - consult only when digging into old changes.') | Out-Null
        $archiveLines.Add('Moved here verbatim by project-os/rotate.ps1. Movement only: rows are never rewritten, compressed, or deleted.') | Out-Null
        $archiveLines.Add('') | Out-Null
        if ($hdr) { $archiveLines.Add($hdr) | Out-Null }
        if ($sep) { $archiveLines.Add($sep) | Out-Null }
    }
    $appended = 0; $dupes = 0
    foreach ($r in $rows) {
        if ($existing.Contains($r.Text.Trim())) { $dupes++; continue }
        $archiveLines.Add($r.Text) | Out-Null; [void]$existing.Add($r.Text.Trim()); $appended++
    }
    Write-Atomic $archPath (Ensure-Eol ($archiveLines -join $eol) $eol) $enc
    return @($appended, $dupes)
}

$historyTargets = New-Object System.Collections.Generic.List[object]
$historyTargets.Add([pscustomobject]@{
    Name     = 'project-os/History.md (appendix + scan log)'
    Live     = Join-Path $pos 'History.md'
    Arch     = Join-Path $pos 'History-archive.md'
    Sect     = '## Appendix'
    Scan     = $true
    ScanSect = '## Scan log'
    ScanArch = Join-Path $pos 'History-scan-archive.md'
}) | Out-Null

$featuresDir = Join-Path $root 'features'
if (Test-Path -LiteralPath $featuresDir) {
    foreach ($feat in Get-ChildItem -LiteralPath $featuresDir -Directory -ErrorAction SilentlyContinue | Sort-Object Name) {
        # Template dirs are COPIED to make a feature, never rotated.
        if ($feat.Name -like '_*') { continue }
        $live = Join-Path $feat.FullName 'History.md'
        if (Test-HasDeepRows $live) {
            $historyTargets.Add([pscustomobject]@{
                Name = ('features/{0}/History.md' -f $feat.Name)
                Live = $live
                Arch = Join-Path $feat.FullName 'History-archive.md'
                Sect = '## Log'
                Scan = $false
            }) | Out-Null
        }
    }
}
foreach ($extra in $ExtraHistoryTargets) { if ($null -ne $extra) { $historyTargets.Add($extra) | Out-Null } }

$today  = (Get-Date).Date
$cutoff = $today.AddMonths(-$MaxMonths)
$keepNewerThan = $today.AddDays(-$MinKeepDays)
$floorDesc = if ($MinKeepDays -le 0 -and $MinKeepRows -eq $MaxKeepRows) { "keep newest $MaxKeepRows rows (pure count)" }
             else { "keep newest $MinKeepRows-$MaxKeepRows rows, calendar window ${MinKeepDays}d" }
Write-Host ''
Write-Host ("HISTORY  today {0:yyyy-MM-dd} | cutoff {1:yyyy-MM-dd} | {2} | target {3} KB" -f $today, $cutoff, $floorDesc, $TargetKB)

foreach ($t in $historyTargets) {
    Write-Host ''
    Write-Host ("=== {0} ===" -f $t.Name)
    if (-not (Test-Path -LiteralPath $t.Live)) { Write-Host '  (missing - skipped)'; continue }

    $doc   = Read-DocLines $t.Live
    $lines = $doc.Lines
    $beforeBytes = [System.Text.Encoding]::UTF8.GetByteCount(($lines -join $doc.Eol))

    $secIdx = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match ('^' + [regex]::Escape($t.Sect))) { $secIdx = $i; break }
    }
    if ($secIdx -lt 0) { Write-Host ("  section '{0}' not found - skipped (no accidental rotation)" -f $t.Sect); continue }

    # Rows AFTER the section header are rotatable; rows before it are the Scan
    # log, counted here and handled by position below.
    $scanCount = 0
    $rotatable = New-Object System.Collections.Generic.List[object]
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $d = Get-RowDate $lines[$i]
        if ($null -eq $d) { continue }
        if ($i -gt $secIdx) { $rotatable.Add([pscustomobject]@{ Index = $i; Date = $d; Text = $lines[$i] }) | Out-Null }
        else                { $scanCount++ }
    }

    # Protection floor: $rotatable is oldest-first (rows append at the bottom),
    # so the newest are the TAIL. Protect the last $protectedCount; candidates
    # are the leading, oldest rows.
    $within = @($rotatable | Where-Object { $_.Date -ge $keepNewerThan }).Count
    $protectedCount = [Math]::Max($MinKeepRows, $within)
    $protectedCount = [Math]::Min($protectedCount, $MaxKeepRows)
    if ($protectedCount -gt $rotatable.Count) { $protectedCount = $rotatable.Count }
    $candidateCount = $rotatable.Count - $protectedCount
    if   ($candidateCount -le 0) { $candidates = @() }
    else { $candidates = $rotatable[0..($candidateCount - 1)] }

    $move = New-Object System.Collections.Generic.List[object]
    foreach ($r in $candidates) { if ($r.Date -lt $cutoff) { $move.Add($r) | Out-Null } }
    $targetBytes = $TargetKB * $kb
    if ((Get-KeptBytes $lines $doc.Eol $move) -gt $targetBytes) {
        $inMove = @{}; foreach ($m in $move) { $inMove[$m.Index] = $true }
        $remaining = @($candidates | Where-Object { -not $inMove.ContainsKey($_.Index) })
        foreach ($r in $remaining) {
            if ((Get-KeptBytes $lines $doc.Eol $move) -le $targetBytes) { break }
            $move.Add($r) | Out-Null
        }
    }
    # Hard cap: never keep more than MaxKeepRows deep rows live.
    if (($rotatable.Count - $move.Count) -gt $MaxKeepRows) {
        $inMove = @{}; foreach ($m in $move) { $inMove[$m.Index] = $true }
        $remaining = @($candidates | Where-Object { -not $inMove.ContainsKey($_.Index) })
        $need = ($rotatable.Count - $move.Count) - $MaxKeepRows
        foreach ($r in $remaining) { if ($need -le 0) { break }; $move.Add($r) | Out-Null; $need-- }
    }

    # Scan log: rotated BY POSITION, not by date, so a row with a loose date
    # ("2026-07-23/24") stays in sequence instead of wedging live forever.
    $scanMove   = New-Object System.Collections.Generic.List[object]
    $scanSecIdx = -1
    $scanTotal  = 0
    if ($t.ScanSect -and $t.ScanArch -and $MaxKeepScanRows -gt 0) {
        for ($i = 0; $i -lt $secIdx; $i++) {
            if ($lines[$i] -match ('^' + [regex]::Escape($t.ScanSect))) { $scanSecIdx = $i; break }
        }
        if ($scanSecIdx -ge 0) {
            $scanRows = New-Object System.Collections.Generic.List[object]
            $sawSep = $false
            for ($i = $scanSecIdx + 1; $i -lt $secIdx; $i++) {
                if ($lines[$i] -notmatch '^\|') { continue }
                if ($lines[$i] -match '^\|[\s\-:|]+\|\s*$') { $sawSep = $true; continue }
                if (-not $sawSep) { continue }
                $scanRows.Add([pscustomobject]@{ Index = $i; Text = $lines[$i] }) | Out-Null
            }
            $scanTotal  = $scanRows.Count
            $scanExcess = $scanRows.Count - $MaxKeepScanRows
            for ($k = 0; $k -lt $scanExcess; $k++) { $scanMove.Add($scanRows[$k]) | Out-Null }
        }
    }
    $scanMovedCount = $scanMove.Count

    $allMoved = New-Object System.Collections.Generic.List[object]
    foreach ($m in $move)     { $allMoved.Add($m) | Out-Null }
    foreach ($m in $scanMove) { $allMoved.Add($m) | Out-Null }

    # Table hygiene: a blank line INSIDE a markdown table ends the table, so drop
    # blank lines between a section's separator and the last row OF THAT TABLE.
    # Empty lines only, a row is never touched. Scanning stops at the first
    # non-blank non-row line, so a trailing example block is never reached and
    # a run that moved nothing leaves the file byte-identical.
    $blankDrop = New-Object System.Collections.Generic.List[int]
    foreach ($span in @(
        @{ From = $scanSecIdx; To = $secIdx }
        @{ From = $secIdx;     To = $lines.Count }
    )) {
        if ($span.From -lt 0) { continue }
        $sepIdx = -1
        for ($i = $span.From + 1; $i -lt $span.To; $i++) {
            if ($lines[$i] -match '^\|[\s\-:|]+\|\s*$') { $sepIdx = $i; break }
        }
        if ($sepIdx -lt 0) { continue }
        $lastRow = -1
        for ($i = $sepIdx + 1; $i -lt $span.To; $i++) {
            if ($lines[$i] -match '^\|') { $lastRow = $i; continue }
            if ($lines[$i].Trim() -eq '') { continue }
            break
        }
        if ($lastRow -lt 0) { continue }
        for ($i = $sepIdx + 1; $i -lt $lastRow; $i++) {
            if ($lines[$i].Trim() -eq '') { $blankDrop.Add($i) | Out-Null }
        }
    }
    $blankDropCount = $blankDrop.Count

    $allDropped = New-Object System.Collections.Generic.List[object]
    foreach ($m in $allMoved)  { $allDropped.Add($m) | Out-Null }
    foreach ($b in $blankDrop) { $allDropped.Add([pscustomobject]@{ Index = $b }) | Out-Null }

    $afterBytes   = Get-KeptBytes $lines $doc.Eol $allDropped
    $movedCount   = $move.Count
    $keptCount    = $rotatable.Count - $movedCount
    $overBudget   = @($rotatable | Where-Object { $_.Text.Length -gt $RowCharBudget }).Count
    $floorBlocked = ($afterBytes -gt $targetBytes)
    $grandMoved  += $movedCount + $scanMovedCount

    Write-Host ("  live size BEFORE     : {0}" -f (FmtKB $beforeBytes))
    Write-Host ("  deep rows total      : {0}" -f $rotatable.Count)
    Write-Host ("  protected by floor   : {0,3}   (cap {1}, min {2}, within-{3}d {4})" -f $protectedCount, $MaxKeepRows, $MinKeepRows, $MinKeepDays, $within)
    Write-Host ("  rows MOVED           : {0,3}" -f $movedCount)
    Write-Host ("  rows KEPT live       : {0,3}" -f $keptCount)
    Write-Host ("  live size AFTER (est): {0}{1}" -f (FmtKB $afterBytes), $(if ($floorBlocked) { "   [above {0} KB target - held by protection floor]" -f $TargetKB } else { '' }))
    Write-Host ("  rows > {0} chars      : {1,3}{2}" -f $RowCharBudget, $overBudget, $(if ($overBudget -gt 0) { '   (warning)' } else { '' }))
    if ($t.Scan) {
        Write-Host ("  scan log rows        : {0,3}   (cap {1})" -f $scanCount, $(if ($MaxKeepScanRows -gt 0) { $MaxKeepScanRows } else { 'off' }))
        if ($scanMovedCount -gt 0) {
            Write-Host ("  scan rows MOVED      : {0,3}   -> {1}" -f $scanMovedCount, (Split-Path $t.ScanArch -Leaf))
            Write-Host ("  scan rows KEPT live  : {0,3}" -f ($scanTotal - $scanMovedCount))
        }
    } else { Write-Host '  scan log rows        : n/a (feature file)' }
    if ($blankDropCount -gt 0) { Write-Host ("  stranded blank lines : {0,3}   (inside a table - dropped; rows untouched)" -f $blankDropCount) }
    if ($movedCount -gt 0) {
        Write-Host ("  -> would move to {0}:" -f (Split-Path $t.Arch -Leaf))
        foreach ($r in ($move | Sort-Object Date, Index)) {
            $p = $r.Text.Substring(0, [Math]::Min(70, $r.Text.Length)) -replace '\s+', ' '
            Write-Host ("       {0:yyyy-MM-dd}  {1}..." -f $r.Date, $p)
        }
    }
    if ($scanMovedCount -gt 0) { Write-Host ("  -> would move {0} scan row(s) to {1} (oldest first)" -f $scanMovedCount, (Split-Path $t.ScanArch -Leaf)) }

    if (-not $DryRun -and ($movedCount -gt 0 -or $scanMovedCount -gt 0 -or $blankDropCount -gt 0)) {
        $liveName = Split-Path $t.Live -Leaf
        $appended = 0; $dupes = 0
        if ($movedCount -gt 0) {
            $hs = Get-TableHead $lines $secIdx $lines.Count
            $r = Write-RowArchive $t.Arch $liveName 'History Archive (deep rows)' $hs[0] $hs[1] ($move | Sort-Object Date, Index) $doc.Eol $utf8
            $appended = $r[0]; $dupes = $r[1]
        }
        $scanAppended = 0; $scanDupes = 0
        if ($scanMovedCount -gt 0) {
            $hs = Get-TableHead $lines $scanSecIdx $secIdx
            $r = Write-RowArchive $t.ScanArch $liveName 'Scan-log Archive' $hs[0] $hs[1] $scanMove $doc.Eol $utf8
            $scanAppended = $r[0]; $scanDupes = $r[1]
        }

        # Live: drop every moved row; add a one-time pointer under each section.
        # Each pointer is written only by the rotation that earns it. ScanArch is
        # NULL on feature targets, so it is guarded (Split-Path throws on null).
        $idx = @{}; foreach ($m in $allDropped) { $idx[$m.Index] = $true }
        $pointerPresent = @($lines | Where-Object { $_ -like '*Older rows archived*' }).Count -gt 0
        $pointer = ('_Older rows archived -> see `{0}` (moved by project-os/rotate.ps1, not rewritten)._' -f (Split-Path $t.Arch -Leaf))
        $scanPointerPresent = @($lines | Where-Object { $_ -like '*Older scan rows archived*' }).Count -gt 0
        $scanPointer = if ($t.ScanArch) { ('_Older scan rows archived -> see `{0}` (moved by project-os/rotate.ps1, not rewritten)._' -f (Split-Path $t.ScanArch -Leaf)) } else { $null }
        $newLive = New-Object System.Collections.Generic.List[string]
        for ($i = 0; $i -lt $lines.Count; $i++) {
            if ($idx.ContainsKey($i)) { continue }
            $newLive.Add($lines[$i]) | Out-Null
            if ($movedCount -gt 0 -and -not $pointerPresent -and $i -eq $secIdx) { $newLive.Add('') | Out-Null; $newLive.Add($pointer) | Out-Null; $pointerPresent = $true }
            if ($scanMovedCount -gt 0 -and -not $scanPointerPresent -and $i -eq $scanSecIdx) { $newLive.Add('') | Out-Null; $newLive.Add($scanPointer) | Out-Null; $scanPointerPresent = $true }
        }
        Write-Atomic $t.Live (Ensure-Eol ($newLive -join $doc.Eol) $doc.Eol) $utf8

        if ($movedCount -gt 0)     { Write-Host ("  WROTE archive        : +{0} new row(s), {1} duplicate(s) skipped" -f $appended, $dupes) }
        if ($scanMovedCount -gt 0) { Write-Host ("  WROTE scan archive   : +{0} new row(s), {1} duplicate(s) skipped" -f $scanAppended, $scanDupes) }
        Write-Host ("  WROTE live           : {0}" -f (FmtKB $afterBytes))
    }
}

# ===========================================================================
# ENGINES 2 and 3: section blocks (Decisions) and tables (Backlog, Mistakes, BugAtlas)
# ===========================================================================
# The archive is organised BY SECTION, so one file can hold several rotated
# tails (Mistakes has Promoted and Retired). A section is scaffolded on first
# use with the same table head the rows were written under, then appended to.
# Dedup is on the block's first non-empty line.
function Write-ArchiveSection($archPath, $liveName, $sectionName, $headLines, $payload, $eol, $enc, $dry) {
    $lines = New-Object System.Collections.Generic.List[string]
    if (Test-Path -LiteralPath $archPath) {
        foreach ($ln in [System.IO.File]::ReadAllLines($archPath, [System.Text.Encoding]::UTF8)) { $lines.Add($ln) | Out-Null }
    } else {
        $lines.Add(('# {0} - Archive' -f $liveName)) | Out-Null
        $lines.Add('') | Out-Null
        $lines.Add('NOT read by default - consult only when digging into an old entry.') | Out-Null
        $lines.Add('Moved here verbatim by project-os/rotate.ps1. Movement only: nothing is rewritten, compressed, or deleted.') | Out-Null
        $lines.Add('') | Out-Null
    }
    $existing = New-Object System.Collections.Generic.HashSet[string]
    foreach ($ln in $lines) { [void]$existing.Add($ln.Trim()) }

    $arr    = $lines.ToArray()
    $mask   = Get-FenceMask $arr
    $secIdx = Find-Section $arr $mask ('## ' + $sectionName)
    if ($secIdx -lt 0) {
        if ($lines.Count -gt 0 -and $lines[$lines.Count - 1].Trim() -ne '') { $lines.Add('') | Out-Null }
        $lines.Add('## ' + $sectionName) | Out-Null
        $lines.Add('') | Out-Null
        foreach ($h in $headLines) { if ($h) { $lines.Add($h) | Out-Null } }
        $insertAt = $lines.Count
    } else {
        $insertAt = Find-SectionEnd $arr $mask $secIdx
        while ($insertAt -gt $secIdx + 1 -and $lines[$insertAt - 1].Trim() -eq '') { $insertAt-- }
    }

    $added = 0; $dupes = 0
    $toInsert = New-Object System.Collections.Generic.List[string]
    foreach ($block in $payload) {
        $key = $null
        foreach ($ln in $block) { if ($ln.Trim() -ne '') { $key = $ln; break } }
        if ($null -eq $key) { continue }
        if ($existing.Contains($key.Trim())) { $dupes++; continue }
        foreach ($ln in $block) { $toInsert.Add($ln) | Out-Null }
        [void]$existing.Add($key.Trim())
        $added++
    }
    if ($toInsert.Count -gt 0) { $lines.InsertRange($insertAt, $toInsert) }
    if (-not $dry -and $added -gt 0) { Write-Atomic $archPath (Ensure-Eol ($lines -join $eol) $eol) $enc }
    return @($added, $dupes)
}

# Write the live file back with the moved lines removed, plus a one-time pointer
# under the rotated section. Only the double blank left at a lift seam is
# collapsed; blank lines elsewhere are never touched.
function Write-Live($target, $lines, $eol, $dropIdx, $secIdx, $archName, $enc, $dry) {
    $drop = @{}; foreach ($i in $dropIdx) { $drop[$i] = $true }
    $pointer = ('_Older entries archived -> see `{0}` (moved by project-os/rotate.ps1, not rewritten)._' -f $archName)
    $pointerPresent = @($lines | Where-Object { $_ -like '*Older entries archived*' }).Count -gt 0
    $clean = New-Object System.Collections.Generic.List[string]
    $justDropped = $false
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($drop.ContainsKey($i)) { $justDropped = $true; continue }
        $isBlank = ($lines[$i].Trim() -eq '')
        $prevBlank = ($clean.Count -gt 0 -and $clean[$clean.Count - 1].Trim() -eq '')
        if ($isBlank -and $justDropped -and $prevBlank) { continue }
        $clean.Add($lines[$i]) | Out-Null
        if (-not $isBlank) { $justDropped = $false }
        if (-not $pointerPresent -and $secIdx -ge 0 -and $i -eq $secIdx) {
            $clean.Add('') | Out-Null; $clean.Add($pointer) | Out-Null; $pointerPresent = $true
        }
    }
    if (-not $dry) { Write-Atomic $target (Ensure-Eol ($clean -join $eol) $eol) $enc }
    return [System.Text.Encoding]::UTF8.GetByteCount(($clean -join $eol))
}

$docTargets = New-Object System.Collections.Generic.List[object]
$docTargets.Add([pscustomobject]@{ Name = 'project-os/Decisions.md';        Kind = 'section'; Live = (Join-Path $pos 'Decisions.md'); Arch = (Join-Path $pos 'Decisions-archive.md'); Sect = 'Index'; Keep = $MaxKeepDecisions }) | Out-Null
$docTargets.Add([pscustomobject]@{ Name = 'project-os/Backlog.md (Done)';   Kind = 'table';   Live = (Join-Path $pos 'Backlog.md');   Arch = (Join-Path $pos 'Backlog-archive.md');   Sect = 'Done';  Keep = $MaxKeepBacklog }) | Out-Null
$docTargets.Add([pscustomobject]@{ Name = 'project-os/BugAtlas.md';         Kind = 'table';   Live = (Join-Path $pos 'BugAtlas.md');  Arch = (Join-Path $pos 'BugAtlas-archive.md');  Sect = 'Atlas'; Keep = $MaxKeepAtlas }) | Out-Null
foreach ($sect in @('Promoted', 'Retired')) {
    $docTargets.Add([pscustomobject]@{ Name = ('project-os/Mistakes.md ({0})' -f $sect); Kind = 'table'; Live = (Join-Path $pos 'Mistakes.md'); Arch = (Join-Path $pos 'Mistakes-archive.md'); Sect = $sect; Keep = $MaxKeepMistakes }) | Out-Null
}
if (Test-Path -LiteralPath $featuresDir) {
    foreach ($feat in Get-ChildItem -LiteralPath $featuresDir -Directory -ErrorAction SilentlyContinue | Sort-Object Name) {
        if ($feat.Name -like '_*') { continue }
        $dec = Join-Path $feat.FullName 'Decisions.md'
        if (Test-Path -LiteralPath $dec) {
            $docTargets.Add([pscustomobject]@{ Name = ('features/{0}/Decisions.md' -f $feat.Name); Kind = 'section'; Live = $dec; Arch = (Join-Path $feat.FullName 'Decisions-archive.md'); Sect = 'Index'; Keep = $MaxKeepDecisions }) | Out-Null
        }
        $atlas = Join-Path $feat.FullName 'BugAtlas.md'
        if (Test-Path -LiteralPath $atlas) {
            $docTargets.Add([pscustomobject]@{ Name = ('features/{0}/BugAtlas.md' -f $feat.Name); Kind = 'table'; Live = $atlas; Arch = (Join-Path $feat.FullName 'BugAtlas-archive.md'); Sect = 'Atlas'; Keep = $MaxKeepAtlas }) | Out-Null
        }
    }
}
foreach ($extra in $ExtraDocTargets) { if ($null -ne $extra) { $docTargets.Add($extra) | Out-Null } }

Write-Host ''
Write-Host ("DOCS  keep newest: decisions {0} | backlog {1} | mistakes {2} | atlas {3}" -f $MaxKeepDecisions, $MaxKeepBacklog, $MaxKeepMistakes, $MaxKeepAtlas)

foreach ($t in $docTargets) {
    Write-Host ''
    Write-Host ("=== {0} ===" -f $t.Name)
    if (-not (Test-Path -LiteralPath $t.Live)) { Write-Host '  (missing - skipped)'; continue }

    $doc   = Read-DocLines $t.Live
    $lines = $doc.Lines
    $mask  = Get-FenceMask $lines
    $beforeBytes = [System.Text.Encoding]::UTF8.GetByteCount(($lines -join $doc.Eol))
    Write-Host ("  live size BEFORE     : {0}" -f (FmtKB $beforeBytes))

    $blocks     = New-Object System.Collections.Generic.List[object]
    $headLines  = @()
    $pointerIdx = -1
    $archSection = $t.Sect

    if ($t.Kind -eq 'section') {
        # One block per "## YYYY-MM-DD ..." entry. The separator after the date
        # is not matched, so a dot, a hyphen or an older dash all rotate alike.
        $starts = New-Object System.Collections.Generic.List[int]
        for ($i = 0; $i -lt $lines.Count; $i++) {
            if ($mask[$i]) { continue }
            if ($lines[$i] -match '^##\s+\d{4}-\d{2}-\d{2}\b') { $starts.Add($i) | Out-Null }
        }
        foreach ($from in $starts) {
            $to  = Find-SectionEnd $lines $mask $from
            $idx = New-Object System.Collections.Generic.List[int]
            for ($i = $from; $i -lt $to; $i++) { $idx.Add($i) | Out-Null }
            $blocks.Add([pscustomobject]@{ Index = $from; Idx = $idx; Text = $lines[$from] }) | Out-Null
        }
        $pointerIdx  = Find-Section $lines $mask ('## ' + $t.Sect)
        $archSection = 'Archived decisions'
    } else {
        $secIdx = Find-Section $lines $mask ('## ' + $t.Sect)
        if ($secIdx -lt 0) { Write-Host ("  section '## {0}' not found - skipped (no accidental rotation)" -f $t.Sect); continue }
        $secEnd = Find-SectionEnd $lines $mask $secIdx
        $sawSep = $false; $hdr = $null; $sep = $null
        for ($i = $secIdx + 1; $i -lt $secEnd; $i++) {
            if ($mask[$i]) { continue }
            if ($lines[$i] -notmatch '^\|') { continue }
            if ($lines[$i] -match '^\|[\s\-:|]+\|\s*$') { $sawSep = $true; $sep = $lines[$i]; continue }
            if (-not $sawSep) { $hdr = $lines[$i]; continue }
            $idx = New-Object System.Collections.Generic.List[int]
            $idx.Add($i) | Out-Null
            $blocks.Add([pscustomobject]@{ Index = $i; Idx = $idx; Text = $lines[$i] }) | Out-Null
        }
        $headLines  = @($hdr, $sep)
        $pointerIdx = $secIdx
    }

    $total  = $blocks.Count
    $excess = $total - $t.Keep
    Write-Host ("  entries total        : {0,3}   (keep newest {1})" -f $total, $t.Keep)
    if ($excess -le 0) { Write-Host '  nothing to move'; continue }

    $move = @()
    for ($k = 0; $k -lt $excess; $k++) { $move += $blocks[$k] }
    Write-Host ("  entries MOVED        : {0,3}   -> {1}" -f $move.Count, (Split-Path $t.Arch -Leaf))
    foreach ($b in $move) {
        $p = $b.Text.Substring(0, [Math]::Min(70, $b.Text.Length)) -replace '\s+', ' '
        Write-Host ("       {0}..." -f $p)
    }

    $payload = @()
    foreach ($b in $move) {
        $block = @()
        foreach ($i in $b.Idx) { $block += $lines[$i] }
        while ($block.Count -gt 0 -and $block[$block.Count - 1].Trim() -eq '') { $block = @($block[0..($block.Count - 2)]) }
        if ($t.Kind -eq 'section') { $block += '' }
        $payload += , $block
    }

    $liveName = Split-Path $t.Live -Leaf
    $r = Write-ArchiveSection $t.Arch $liveName $archSection $headLines $payload $doc.Eol $utf8 $DryRun
    Write-Host ("  archive              : +{0} new, {1} duplicate(s) skipped" -f $r[0], $r[1])

    $dropIdx = New-Object System.Collections.Generic.List[int]
    foreach ($b in $move) { foreach ($i in $b.Idx) { $dropIdx.Add($i) | Out-Null } }
    $afterBytes = Write-Live $t.Live $lines $doc.Eol $dropIdx $pointerIdx (Split-Path $t.Arch -Leaf) $utf8 $DryRun
    Write-Host ("  live size AFTER      : {0}" -f (FmtKB $afterBytes))
    $grandMoved += $move.Count
}

Write-Host ''
Write-Host ('-' * 78)
if ($DryRun) { Write-Host ("DRY RUN complete - nothing written. {0} item(s) would move. Re-run without -DryRun to apply." -f $grandMoved) }
else         { Write-Host ("DONE - {0} item(s) moved." -f $grandMoved) }
