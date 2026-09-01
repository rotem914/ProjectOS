# rotate-docs.ps1
# Why this exists: History.md is not the only ProjectOS file that grows without a
# ceiling. Decisions.md, Backlog.md, Mistakes.md and each feature's BugAtlas.md
# all accumulate forever, and every one of them is read at task pickup. This
# script gives them the SAME mechanism History has: the live file keeps the
# newest entries, everything older MOVES verbatim into a sibling *-archive.md
# that is not read by default.
#
# MOVEMENT, NOT REWRITE. Entries and rows are relocated byte for byte. Nothing is
# compressed, edited, renumbered or deleted, and re-running is idempotent (the
# archive append dedups). This is what keeps the script inside CLAUDE.md rule 4.
#
# TWO ENGINES, because these files grow in two shapes:
#   section   Decisions.md, one "## YYYY-MM-DD - Title" block per decision.
#   table     Backlog / Mistakes / BugAtlas, one markdown row per item.
#
# WHAT IS NEVER TOUCHED: the always-read indexes. Decisions keeps its whole
# "## Index" list live (that is the part every task reads), Backlog keeps its
# "## Open" table, Mistakes keeps its "## Open" table. Only the closed, promoted,
# retired and superseded tails rotate.
#
# Preview (writes nothing):
#   powershell -NoProfile -ExecutionPolicy Bypass -File project-os/rotate-docs.ps1 -DryRun
# Apply for real:
#   powershell -NoProfile -ExecutionPolicy Bypass -File project-os/rotate-docs.ps1

[CmdletBinding()]
param(
    [switch]$DryRun,
    # Newest entries kept live, per section. Pure counts, like rotate-history's
    # hard cap: velocity-proof, and they never balloon during a sprint.
    [int]$MaxKeepDecisions = 25,   # newest decision entries kept in a Decisions.md
    [int]$MaxKeepBacklog   = 40,   # newest rows kept in Backlog.md "## Done"
    [int]$MaxKeepMistakes  = 30,   # newest rows kept in a Mistakes.md tail section
    [int]$MaxKeepAtlas     = 30    # newest rows kept in a BugAtlas.md "## Atlas"
)

$ErrorActionPreference = 'Stop'
$kb   = 1024.0
$utf8 = [System.Text.UTF8Encoding]::new($false)   # UTF-8, no BOM

# The kit installs into project-os\ at the repo root, so the root is one level up.
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path.TrimEnd([char]0x5C, [char]0x2F)

# Project config: dot-source projectos.config.ps1 if present. Only $ExtraDocTargets
# is consumed here, so a project can add its own growing file without editing this.
$ExtraDocTargets = @()
$configPath = Join-Path $PSScriptRoot 'projectos.config.ps1'
if (Test-Path -LiteralPath $configPath) { . $configPath }
if ($null -eq $ExtraDocTargets) { $ExtraDocTargets = @() }

function Read-DocLines($path) {
    $raw = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
    $eol = if ($raw -match "`r`n") { "`r`n" } else { "`n" }
    return [pscustomobject]@{ Lines = ([regex]::Split($raw, "`r?`n")); Eol = $eol }
}
function FmtKB($bytes) { '{0,7:N1} KB' -f ($bytes / $kb) }
function Ensure-Eol($s, $eol) { if ($s.EndsWith($eol)) { return $s } else { return $s + $eol } }

# Lines inside a fenced code block are INVISIBLE to both engines. The Decisions
# "Required format" example contains a literal "## YYYY-MM-DD - Decision title"
# heading; without this it would rotate as if it were a real decision.
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

# Index of the line holding a "## Section" heading, or -1. Fenced lines skipped.
function Find-Section($lines, $mask, $heading) {
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($mask[$i]) { continue }
        if ($lines[$i] -match ('^' + [regex]::Escape($heading) + '\s*$')) { return $i }
    }
    return -1
}

# Where a "## " section ends: the next unfenced "## " heading, or EOF.
function Find-SectionEnd($lines, $mask, $startIdx) {
    for ($i = $startIdx + 1; $i -lt $lines.Count; $i++) {
        if ($mask[$i]) { continue }
        if ($lines[$i] -match '^##\s') { return $i }
    }
    return $lines.Count
}

# ---------------------------------------------------------------------------
# Archive writer, shared by both engines.
# The archive is organised BY SECTION, so one file can hold several rotated
# tails (Mistakes has Promoted and Retired). A section is scaffolded on first
# use with the same table head the rows were written under, then appended to.
# Dedup is on the block's first non-empty line, so re-running never duplicates.
# ---------------------------------------------------------------------------
function Write-ArchiveSection($archPath, $liveName, $sectionName, $headLines, $payload, $eol, $enc, $dry) {
    $lines = New-Object System.Collections.Generic.List[string]
    if (Test-Path -LiteralPath $archPath) {
        foreach ($ln in [System.IO.File]::ReadAllLines($archPath, [System.Text.Encoding]::UTF8)) { $lines.Add($ln) | Out-Null }
    } else {
        $lines.Add(('# {0} - Archive' -f $liveName)) | Out-Null
        $lines.Add('') | Out-Null
        $lines.Add('NOT read by default - consult only when digging into an old entry.') | Out-Null
        $lines.Add('Moved here verbatim by project-os/rotate-docs.ps1. Movement only: nothing is rewritten, compressed, or deleted.') | Out-Null
        $lines.Add('') | Out-Null
    }

    $existing = New-Object System.Collections.Generic.HashSet[string]
    foreach ($ln in $lines) { [void]$existing.Add($ln.Trim()) }

    # Locate (or scaffold) this section, then find where it ends so new material
    # lands at ITS tail rather than at the end of the whole file.
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

    if (-not $dry -and $added -gt 0) {
        $tmp = "$archPath.tmp"
        [System.IO.File]::WriteAllText($tmp, (Ensure-Eol ($lines -join $eol) $eol), $enc)
        Move-Item -LiteralPath $tmp -Destination $archPath -Force
    }
    return @($added, $dupes)
}

# Write the live file back with the moved lines removed, plus a one-time pointer
# under the rotated section so a reader always knows where the tail went.
function Write-Live($target, $lines, $eol, $dropIdx, $secIdx, $archName, $enc, $dry) {
    $drop = @{}; foreach ($i in $dropIdx) { $drop[$i] = $true }
    $pointer = ('_Older entries archived -> see `{0}` (moved by project-os/rotate-docs.ps1, not rewritten)._' -f $archName)
    $pointerPresent = @($lines | Where-Object { $_ -like '*Older entries archived*' }).Count -gt 0
    # Collapse the double blank line left where a block was lifted out, and ONLY
    # there: the check is "the previous source line was dropped", so a blank line
    # far from the seam (inside a fenced example, between two sections) is never
    # touched. Blank lines only either way, a row or an entry is never edited.
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
    if (-not $dry) {
        $tmp = "$target.tmp"
        [System.IO.File]::WriteAllText($tmp, (Ensure-Eol ($clean -join $eol) $eol), $enc)
        Move-Item -LiteralPath $tmp -Destination $target -Force
    }
    return [System.Text.Encoding]::UTF8.GetByteCount(($clean -join $eol))
}

# ---------------------------------------------------------------------------
# Targets
# ---------------------------------------------------------------------------
$targets = New-Object System.Collections.Generic.List[object]

$targets.Add([pscustomobject]@{
    Name = 'project-os/Decisions.md'
    Kind = 'section'
    Live = Join-Path (Join-Path $root 'project-os') 'Decisions.md'
    Arch = Join-Path (Join-Path $root 'project-os') 'Decisions-archive.md'
    Sect = 'Index'          # the always-read list; the pointer is stamped under it
    Keep = $MaxKeepDecisions
}) | Out-Null

$targets.Add([pscustomobject]@{
    Name = 'project-os/Backlog.md (Done)'
    Kind = 'table'
    Live = Join-Path (Join-Path $root 'project-os') 'Backlog.md'
    Arch = Join-Path (Join-Path $root 'project-os') 'Backlog-archive.md'
    Sect = 'Done'
    Keep = $MaxKeepBacklog
}) | Out-Null

$targets.Add([pscustomobject]@{
    Name = 'project-os/BugAtlas.md'
    Kind = 'table'
    Live = Join-Path (Join-Path $root 'project-os') 'BugAtlas.md'
    Arch = Join-Path (Join-Path $root 'project-os') 'BugAtlas-archive.md'
    Sect = 'Atlas'
    Keep = $MaxKeepAtlas
}) | Out-Null

foreach ($sect in @('Promoted', 'Retired')) {
    $targets.Add([pscustomobject]@{
        Name = ('project-os/Mistakes.md ({0})' -f $sect)
        Kind = 'table'
        Live = Join-Path (Join-Path $root 'project-os') 'Mistakes.md'
        Arch = Join-Path (Join-Path $root 'project-os') 'Mistakes-archive.md'
        Sect = $sect
        Keep = $MaxKeepMistakes
    }) | Out-Null
}

# Feature files, auto-discovered. Template dirs are COPIED to make a feature, so
# they are never rotated.
$featuresDir = Join-Path $root 'features'
if (Test-Path -LiteralPath $featuresDir) {
    foreach ($feat in Get-ChildItem -LiteralPath $featuresDir -Directory -ErrorAction SilentlyContinue | Sort-Object Name) {
        if ($feat.Name -like '_*') { continue }
        $dec = Join-Path $feat.FullName 'Decisions.md'
        if (Test-Path -LiteralPath $dec) {
            $targets.Add([pscustomobject]@{
                Name = ('features/{0}/Decisions.md' -f $feat.Name)
                Kind = 'section'
                Live = $dec
                Arch = Join-Path $feat.FullName 'Decisions-archive.md'
                Sect = 'Index'
                Keep = $MaxKeepDecisions
            }) | Out-Null
        }
        $atlas = Join-Path $feat.FullName 'BugAtlas.md'
        if (Test-Path -LiteralPath $atlas) {
            $targets.Add([pscustomobject]@{
                Name = ('features/{0}/BugAtlas.md' -f $feat.Name)
                Kind = 'table'
                Live = $atlas
                Arch = Join-Path $feat.FullName 'BugAtlas-archive.md'
                Sect = 'Atlas'
                Keep = $MaxKeepAtlas
            }) | Out-Null
        }
    }
}

foreach ($extra in $ExtraDocTargets) { if ($null -ne $extra) { $targets.Add($extra) | Out-Null } }

$modeLabel = '[LIVE RUN]'
if ($DryRun) { $modeLabel = '[DRY RUN - no files written]' }
Write-Host ("rotate-docs.ps1  {0}" -f $modeLabel)
Write-Host ("  keep newest: decisions {0} | backlog {1} | mistakes {2} | atlas {3}" -f $MaxKeepDecisions, $MaxKeepBacklog, $MaxKeepMistakes, $MaxKeepAtlas)
Write-Host ('-' * 78)

$grandMoved = 0
foreach ($t in $targets) {
    Write-Host ''
    Write-Host ("=== {0} ===" -f $t.Name)
    if (-not (Test-Path -LiteralPath $t.Live)) { Write-Host '  (missing - skipped)'; continue }

    $doc   = Read-DocLines $t.Live
    $lines = $doc.Lines
    $mask  = Get-FenceMask $lines
    $beforeBytes = [System.Text.Encoding]::UTF8.GetByteCount(($lines -join $doc.Eol))
    Write-Host ("  live size BEFORE     : {0}" -f (FmtKB $beforeBytes))

    $blocks     = New-Object System.Collections.Generic.List[object]   # oldest-first
    $headLines  = @()
    $pointerIdx = -1
    $archSection = $t.Sect

    if ($t.Kind -eq 'section') {
        # One block per "## YYYY-MM-DD ..." entry, from its heading to the line
        # before the next "## " heading. Entries are appended at the bottom, so
        # file order is oldest-first and the newest are the TAIL.
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
    }
    else {
        $secIdx = Find-Section $lines $mask ('## ' + $t.Sect)
        if ($secIdx -lt 0) { Write-Host ("  section '## {0}' not found - skipped (no accidental rotation)" -f $t.Sect); continue }
        $secEnd = Find-SectionEnd $lines $mask $secIdx
        $sawSep = $false
        $hdr = $null; $sep = $null
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
        # Trim the trailing blank lines a section block carries, so the archive
        # keeps one clean separator between entries instead of growing gaps.
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
if ($DryRun) { Write-Host ("DRY RUN complete - nothing written. {0} entr(ies) would move. Re-run without -DryRun to apply." -f $grandMoved) }
else         { Write-Host ("DONE - {0} entr(ies) moved." -f $grandMoved) }
