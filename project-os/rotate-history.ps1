# rotate-history.ps1
# Why this exists: keeps the "live" History files small enough to stay cheap to
# read every task, by MOVING (never rewriting) old deep-history rows into a
# sibling History-archive.md. The live file holds recent working context; the
# archive holds everything older and is NOT read by default — only when digging
# into an old change. Follows physical-backup.ps1 conventions (PowerShell, no
# Python; $PSScriptRoot-relative paths; atomic .tmp -> move).
#
# MOVEMENT, NOT REWRITE: rows are relocated verbatim. The script never compresses,
# edits, or deletes historical rows, never touches the root Scan log (the
# always-read index), and preserves the markdown tables. Archive append is
# idempotent — re-running never duplicates a row.
#
# PROTECTION FLOOR: the live file keeps the newest rows so recent working context
# stays put, even if that leaves the file above the size target. By DEFAULT this is
# a PURE COUNT — keep the newest MaxKeepRows rows — which is velocity-proof: it never
# balloons during an intense work sprint, the way a calendar window does. A calendar
# courtesy can be re-enabled with -MinKeepDays N, but the kept count is always
# clamped into [MinKeepRows .. MaxKeepRows].
#
# TARGETS: project-os/History.md (its Appendix table) is ALWAYS rotated; every
# features/*/History.md that has a deep-row table is auto-discovered; any
# $ExtraHistoryTargets from projectos.config.ps1 are added on top.
#
# Preview (writes nothing):
#   powershell -NoProfile -ExecutionPolicy Bypass -File project-os\rotate-history.ps1 -DryRun
# Apply for real:
#   powershell -NoProfile -ExecutionPolicy Bypass -File project-os\rotate-history.ps1

[CmdletBinding()]
param(
    [switch]$DryRun,
    # Size target per live file (soft — the row floors override it). Raised 40 ->
    # 80 on 2026-07-31: 40 was unreachable by arithmetic, not by neglect. The
    # rule-8 floor keeps 20 deep rows live and those now average ~1.7 KB each, so
    # the appendix alone is ~34 KB before a single scan row is counted. 80 KB is
    # what the two row caps below actually maintain.
    [int]$TargetKB      = 80,
    [int]$MaxMonths     = 3,    # rows older than this are rotation candidates
    [int]$MinKeepRows   = 20,   # never keep fewer than this many newest deep rows
    [int]$MaxKeepRows   = 20,   # HARD cap — never keep more than this (the jam-killer)
    [int]$MinKeepDays   = 0,    # calendar courtesy; 0 = pure count (the default)
    [int]$RowCharBudget = 400,  # warn (do not act) on live rows longer than this
    [int]$MaxKeepScanRows = 80  # newest Scan-log rows kept live (0 = never rotate the scan log)
)

$ErrorActionPreference = 'Stop'
$kb   = 1024.0
$utf8 = [System.Text.UTF8Encoding]::new($false)   # UTF-8, no BOM

# The kit installs into project-os\ at the repo root, so the root is one level up.
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path.TrimEnd([char]0x5C, [char]0x2F)

# Project config: dot-source projectos.config.ps1 if present; otherwise fall back
# to safe defaults. Only $ExtraHistoryTargets is consumed here.
$ExtraHistoryTargets = @()
$configPath = Join-Path $PSScriptRoot 'projectos.config.ps1'
if (Test-Path -LiteralPath $configPath) { . $configPath }
if ($null -eq $ExtraHistoryTargets) { $ExtraHistoryTargets = @() }

# A row table is "rotatable deep history" if the file has at least one data row:
# a markdown row whose first cell is a yyyy-MM-dd date.
function Test-HasDeepRows($path) {
    if (-not (Test-Path -LiteralPath $path)) { return $false }
    foreach ($ln in [System.IO.File]::ReadAllLines($path, [System.Text.Encoding]::UTF8)) {
        if ($ln -match '^\|\s*\d{4}-\d{2}-\d{2}\s*\|') { return $true }
    }
    return $false
}

# Targets: a live History file, the section header whose table is rotatable, and
# the sibling archive.
#  1) project-os/History.md — ALWAYS. ONLY the Appendix table rotates; the Scan
#     log above it is the always-read index and is never touched.
#  2) every features/*/History.md with a deep-row table — auto-discovered.
#  3) any $ExtraHistoryTargets from the config.
$targets = New-Object System.Collections.Generic.List[object]

$targets.Add([pscustomobject]@{
    Name     = 'project-os/History.md (appendix + scan log)'
    Live     = Join-Path (Join-Path $root 'project-os') 'History.md'
    Arch     = Join-Path (Join-Path $root 'project-os') 'History-archive.md'
    Sect     = '## Appendix'
    Scan     = $true
    # The Scan log rotates too, on the same move-only terms (added 2026-07-31).
    # It was exempt for a long time because History.md calls the scan log the
    # list you always read — but past a few hundred rows that list becomes a
    # quarter-megabyte read at every task pickup, and it makes the size
    # target unreachable no matter how hard the appendix was trimmed. Keeping
    # the newest $MaxKeepScanRows preserves the working window; everything older
    # moves verbatim into a sibling archive that is NOT read by default.
    ScanSect = '## Scan log'
    ScanArch = Join-Path (Join-Path $root 'project-os') 'History-scan-archive.md'
}) | Out-Null

$featuresDir = Join-Path $root 'features'
if (Test-Path -LiteralPath $featuresDir) {
    foreach ($feat in Get-ChildItem -LiteralPath $featuresDir -Directory -ErrorAction SilentlyContinue | Sort-Object Name) {
        # Scaffold/template dirs (e.g. _template) are COPIED to make a feature, not
        # rotated — never mutate the pristine template a new feature is copied from.
        if ($feat.Name -like '_*') { continue }
        $live = Join-Path $feat.FullName 'History.md'
        if (Test-HasDeepRows $live) {
            $targets.Add([pscustomobject]@{
                Name = ('features/{0}/History.md' -f $feat.Name)
                Live = $live
                Arch = Join-Path $feat.FullName 'History-archive.md'
                Sect = '## Log'
                Scan = $false
            }) | Out-Null
        }
    }
}

foreach ($extra in $ExtraHistoryTargets) {
    if ($null -ne $extra) { $targets.Add($extra) | Out-Null }
}

$today  = (Get-Date).Date
$cutoff = $today.AddMonths(-$MaxMonths)
$keepNewerThan = $today.AddDays(-$MinKeepDays)

function Read-DocLines($path) {
    $raw = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
    $eol = if ($raw -match "`r`n") { "`r`n" } else { "`n" }
    return [pscustomobject]@{ Lines = ([regex]::Split($raw, "`r?`n")); Eol = $eol }
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
function FmtKB($bytes) { '{0,7:N1} KB' -f ($bytes / $kb) }
function Ensure-Eol($s, $eol) { if ($s.EndsWith($eol)) { return $s } else { return $s + $eol } }

$floorDesc = if ($MinKeepDays -le 0 -and $MinKeepRows -eq $MaxKeepRows) {
    "keep newest $MaxKeepRows rows (pure count)"
} else {
    "keep newest $MinKeepRows-$MaxKeepRows rows, calendar window ${MinKeepDays}d"
}
Write-Host ("rotate-history.ps1  {0}" -f $(if ($DryRun) { '[DRY RUN - no files written]' } else { '[LIVE RUN]' }))
Write-Host ("  today {0:yyyy-MM-dd} | 3-month cutoff {1:yyyy-MM-dd} | {2} | target {3} KB" -f `
            $today, $cutoff, $floorDesc, $TargetKB)
Write-Host ('-' * 78)

$grandMoved = 0
foreach ($t in $targets) {
    Write-Host ''
    Write-Host ("=== {0} ===" -f $t.Name)

    if (-not (Test-Path -LiteralPath $t.Live)) { Write-Host '  (missing - skipped)'; continue }

    $doc   = Read-DocLines $t.Live
    $lines = $doc.Lines
    $beforeBytes = [System.Text.Encoding]::UTF8.GetByteCount(($lines -join $doc.Eol))

    # Locate the rotatable section header.
    $secIdx = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match ('^' + [regex]::Escape($t.Sect))) { $secIdx = $i; break }
    }
    if ($secIdx -lt 0) { Write-Host ("  section '{0}' not found - skipped (no accidental rotation)" -f $t.Sect); continue }

    # Classify data rows: those AFTER the section header are rotatable; those
    # before it (the Scan log index) are counted, never moved.
    $scanCount = 0
    $rotatable = New-Object System.Collections.Generic.List[object]
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $d = Get-RowDate $lines[$i]
        if ($null -eq $d) { continue }
        if ($i -gt $secIdx) { $rotatable.Add([pscustomobject]@{ Index = $i; Date = $d; Text = $lines[$i] }) | Out-Null }
        else                { $scanCount++ }
    }

    # Protection floor: keep the NEWEST rows live. Start from the calendar window,
    # then clamp into [MinKeepRows .. MaxKeepRows]. The MaxKeepRows cap is what makes
    # this velocity-proof — the kept count can never balloon during a sprint.
    #
    # $rotatable is in FILE order, which is OLDEST-first (index 0 = oldest; new rows
    # are appended at the bottom). The newest rows are therefore the TAIL: protect the
    # LAST $protectedCount entries, and the rotation candidates are the leading
    # (oldest) rows. (Earlier this protected the head and archived the tail — exactly
    # backwards — burying recent work in the not-read archive.)
    $within = @($rotatable | Where-Object { $_.Date -ge $keepNewerThan }).Count
    $protectedCount = [Math]::Max($MinKeepRows, $within)
    $protectedCount = [Math]::Min($protectedCount, $MaxKeepRows)
    if ($protectedCount -gt $rotatable.Count) { $protectedCount = $rotatable.Count }

    $candidateCount = $rotatable.Count - $protectedCount
    if   ($candidateCount -le 0) { $candidates = @() }
    else { $candidates = $rotatable[0..($candidateCount - 1)] }  # the oldest, non-protected rows (oldest-first)

    # Move set: non-protected rows older than the 3-month cutoff...
    $move = New-Object System.Collections.Generic.List[object]
    foreach ($r in $candidates) { if ($r.Date -lt $cutoff) { $move.Add($r) | Out-Null } }
    # ...then, if still over the size target, the oldest remaining candidates
    # ($candidates is oldest-first, so iterate in order to move oldest first).
    $targetBytes = $TargetKB * $kb
    if ((Get-KeptBytes $lines $doc.Eol $move) -gt $targetBytes) {
        $inMove = @{}; foreach ($m in $move) { $inMove[$m.Index] = $true }
        $remaining = @($candidates | Where-Object { -not $inMove.ContainsKey($_.Index) })  # oldest-first
        foreach ($r in $remaining) {
            if ((Get-KeptBytes $lines $doc.Eol $move) -le $targetBytes) { break }
            $move.Add($r) | Out-Null
        }
    }
    # Hard cap (the jam-killer): never keep more than MaxKeepRows deep rows live,
    # regardless of cutoff or size target. Move the oldest remaining candidates until
    # the kept count is at most MaxKeepRows. Cutoff and TargetKB only ever move MORE.
    if (($rotatable.Count - $move.Count) -gt $MaxKeepRows) {
        $inMove = @{}; foreach ($m in $move) { $inMove[$m.Index] = $true }
        $remaining = @($candidates | Where-Object { -not $inMove.ContainsKey($_.Index) })  # oldest-first
        $need = ($rotatable.Count - $move.Count) - $MaxKeepRows
        foreach ($r in $remaining) {
            if ($need -le 0) { break }
            $move.Add($r) | Out-Null; $need--
        }
    }

    # --- Scan log --------------------------------------------------------------
    # Rotated BY POSITION, not by date: the scan table is homogeneous, and a few
    # historic rows carry a loose date ("2026-07-23/24") that Get-RowDate cannot
    # parse. Taking every table line between the separator and the Appendix
    # header keeps those rows in the sequence instead of wedging them live
    # forever. Oldest-first in file order, so the newest are the TAIL.
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
                if ($lines[$i] -match '^\|[\s\-:|]+\|\s*$') { $sawSep = $true; continue }  # the |---|---| rule
                if (-not $sawSep) { continue }                                              # the header row
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

    # --- Table hygiene ---------------------------------------------------------
    # A blank line INSIDE a markdown table ends the table, so every row below it
    # renders as plain text. project-os/History.md had 35 such blanks scattered
    # through the Scan log (they pre-date rotation); moving 334 rows then
    # collapsed them into one run directly under the separator, which broke the
    # table at its very first row. Drop blank lines that sit between a section's
    # separator and its last table row. This removes EMPTY LINES ONLY — a row is
    # never touched, so it stays inside CLAUDE.md rule 4's "movement, not rewrite"
    # guarantee. Idempotent: a healed file yields an empty drop set.
    $blankDrop = New-Object System.Collections.Generic.List[int]
    foreach ($span in @(
        @{ From = $scanSecIdx; To = $secIdx }      # the Scan log table (-1 = absent)
        @{ From = $secIdx;     To = $lines.Count } # the deep-row table
    )) {
        if ($span.From -lt 0) { continue }
        $sepIdx = -1
        for ($i = $span.From + 1; $i -lt $span.To; $i++) {
            if ($lines[$i] -match '^\|[\s\-:|]+\|\s*$') { $sepIdx = $i; break }
        }
        if ($sepIdx -lt 0) { continue }
        # Stop at the END OF THIS TABLE, not at the end of the section. Scanning
        # on would reach a row inside a trailing example block, and every blank
        # line between here and there would be treated as stranded whitespace —
        # rewriting a file on a run that moved nothing.
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

    Write-Host ("  rotatable section    : {0}" -f $t.Sect)
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
    }
    else { Write-Host  '  scan log rows        : n/a (feature file)' }
    if ($blankDropCount -gt 0) {
        Write-Host ("  stranded blank lines : {0,3}   (inside a table - dropped; rows untouched)" -f $blankDropCount)
    }

    if ($movedCount -gt 0) {
        Write-Host ("  -> would move to {0}:" -f (Split-Path $t.Arch -Leaf))
        foreach ($r in ($move | Sort-Object Date, Index)) {
            $p = $r.Text.Substring(0, [Math]::Min(70, $r.Text.Length)) -replace '\s+', ' '
            Write-Host ("       {0:yyyy-MM-dd}  {1}..." -f $r.Date, $p)
        }
    }

    if ($scanMovedCount -gt 0) {
        Write-Host ("  -> would move {0} scan row(s) to {1} (oldest first)" -f $scanMovedCount, (Split-Path $t.ScanArch -Leaf))
    }

    if (-not $DryRun -and ($movedCount -gt 0 -or $scanMovedCount -gt 0 -or $blankDropCount -gt 0)) {
        # Header + separator of a table, taken from the live file, so a NEW
        # archive opens with the same columns the rows were written under.
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
        # Append rows verbatim to an archive, scaffolding it if absent. Dedup is
        # on the trimmed row text, so re-running never duplicates a row.
        function Write-Archive($archPath, $liveName, $blurb, $hdr, $sep, $rows, $eol, $enc) {
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
                $archiveLines.Add('Moved here verbatim by project-os/rotate-history.ps1. Movement only: rows are never rewritten, compressed, or deleted.') | Out-Null
                $archiveLines.Add('') | Out-Null
                if ($hdr) { $archiveLines.Add($hdr) | Out-Null }
                if ($sep) { $archiveLines.Add($sep) | Out-Null }
            }
            $appended = 0; $dupes = 0
            foreach ($r in $rows) {
                if ($existing.Contains($r.Text.Trim())) { $dupes++; continue }
                $archiveLines.Add($r.Text) | Out-Null; [void]$existing.Add($r.Text.Trim()); $appended++
            }
            $tmp = "$archPath.tmp"
            [System.IO.File]::WriteAllText($tmp, (Ensure-Eol ($archiveLines -join $eol) $eol), $enc)
            Move-Item -LiteralPath $tmp -Destination $archPath -Force
            return @($appended, $dupes)
        }

        $liveName = Split-Path $t.Live -Leaf
        $appended = 0; $dupes = 0
        if ($movedCount -gt 0) {
            $hs = Get-TableHead $lines $secIdx $lines.Count
            $r = Write-Archive $t.Arch $liveName 'History Archive (deep rows)' $hs[0] $hs[1] `
                 ($move | Sort-Object Date, Index) $doc.Eol $utf8
            $appended = $r[0]; $dupes = $r[1]
        }
        $scanAppended = 0; $scanDupes = 0
        if ($scanMovedCount -gt 0) {
            $hs = Get-TableHead $lines $scanSecIdx $secIdx
            $r = Write-Archive $t.ScanArch $liveName 'Scan-log Archive' $hs[0] $hs[1] `
                 $scanMove $doc.Eol $utf8
            $scanAppended = $r[0]; $scanDupes = $r[1]
        }

        # Live: drop every moved row; add a one-time pointer under each section.
        $idx = @{}; foreach ($m in $allDropped) { $idx[$m.Index] = $true }
        $pointerPresent = @($lines | Where-Object { $_ -like '*Older rows archived*' }).Count -gt 0
        $pointer = ('_Older rows archived -> see `{0}` (moved by project-os/rotate-history.ps1, not rewritten)._' -f (Split-Path $t.Arch -Leaf))
        $scanPointerPresent = @($lines | Where-Object { $_ -like '*Older scan rows archived*' }).Count -gt 0
        # Only project-os/History.md carries a scan log, so ScanArch is NULL on
        # every feature target and Split-Path THROWS on a null Path. This line
        # runs unconditionally, while the early-out above skips a target with
        # nothing to move — so the crash waited for the first feature file to
        # cross its 20-row floor, and hit it AFTER the archive was written but
        # BEFORE the live file lost the row, i.e. leaving a duplicate behind
        # (bit features/measurement, 2026-08-14). Re-running after this fix
        # heals it: Write-Archive dedups, and the live write then drops the row.
        $scanPointer = if ($t.ScanArch) {
            ('_Older scan rows archived -> see `{0}` (moved by project-os/rotate-history.ps1, not rewritten)._' -f (Split-Path $t.ScanArch -Leaf))
        } else { $null }
        $newLive = New-Object System.Collections.Generic.List[string]
        for ($i = 0; $i -lt $lines.Count; $i++) {
            if ($idx.ContainsKey($i)) { continue }
            $newLive.Add($lines[$i]) | Out-Null
            # Each pointer is written only by the rotation that earns it: a
            # heal-only or scan-only run must not stamp a link to a deep archive
            # nothing was just moved into (it may not even exist yet).
            if ($movedCount -gt 0 -and -not $pointerPresent -and $i -eq $secIdx) { $newLive.Add('') | Out-Null; $newLive.Add($pointer) | Out-Null; $pointerPresent = $true }
            if ($scanMovedCount -gt 0 -and -not $scanPointerPresent -and $i -eq $scanSecIdx) { $newLive.Add('') | Out-Null; $newLive.Add($scanPointer) | Out-Null; $scanPointerPresent = $true }
        }

        # Atomic write of the live file: .tmp -> move, UTF-8 no BOM, original EOL.
        $lTmp = "$($t.Live).tmp"
        [System.IO.File]::WriteAllText($lTmp, (Ensure-Eol ($newLive -join $doc.Eol) $doc.Eol), $utf8)
        Move-Item -LiteralPath $lTmp -Destination $t.Live -Force

        if ($movedCount -gt 0) {
            Write-Host ("  WROTE archive        : +{0} new row(s), {1} duplicate(s) skipped" -f $appended, $dupes)
        }
        if ($scanMovedCount -gt 0) {
            Write-Host ("  WROTE scan archive   : +{0} new row(s), {1} duplicate(s) skipped" -f $scanAppended, $scanDupes)
        }
        Write-Host ("  WROTE live           : {0}" -f (FmtKB ([System.Text.Encoding]::UTF8.GetByteCount(($newLive -join $doc.Eol)))))
    }
}

Write-Host ''
Write-Host ('-' * 78)
if ($DryRun) { Write-Host ("DRY RUN complete - nothing written. {0} row(s) would move. Re-run without -DryRun to apply." -f $grandMoved) }
else         { Write-Host ("DONE - {0} row(s) moved." -f $grandMoved) }
