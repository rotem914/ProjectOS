<#
Multiple-claude-accounts.ps1: gives each client their own Claude Desktop, kept apart
from your personal one.

Each client gets:
  C:\ClaudeProfiles\<Client>   the desktop app's own data: login, chats, app settings
  C:\ClaudeConfigs\<Client>    Claude Code's own settings, history, login, MCPs
  a desktop icon "Claude - <Client>" that opens Claude with both.

Your personal Claude stays where it is and is never written to. It is only
read, once per new client, to copy in your personal rules (CLAUDE.md), your
settings, your keybindings and your skills.

First run: run this file once. It sets itself up in C:\ClaudeProfiles\_Tools
and puts two icons on your desktop, "Claude - Personal" and "New Claude client",
then asks for the first client's name.
Every client after that: double-click "New Claude client" and type the name.

Other ways to run it:
  -Name <Client>   make that client without asking
  -Check <Client>  say whether that client is really kept apart
  -UpdateSkills    update every client's copied skills with git pull

What stays shared, whatever this script does: the same Windows user, so git
and GitHub logins, SSH keys, Chrome and its extensions, and every project
folder on disk. Links that open Claude from a browser (claude://) always go to
the personal app.
#>
param(
  [string]$Name,
  [string]$Check,
  [switch]$UpdateSkills
)

$ErrorActionPreference = 'Stop'
$ProfilesRoot = 'C:\ClaudeProfiles'
$ConfigsRoot  = 'C:\ClaudeConfigs'
$Tools        = Join-Path $ProfilesRoot '_Tools'
$Alias        = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\claude-desktop.exe'
$Personal     = Join-Path $env:USERPROFILE '.claude'
$Desktop      = [Environment]::GetFolderPath('Desktop')
$PowerShell   = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$Interactive  = -not ($Name -or $Check -or $UpdateSkills)
# What a new client copies from your personal Claude Code folder. Never the
# login (.credentials.json, .claude.json), history, projects or plugins.
$CopiedFiles  = @('CLAUDE.md', 'settings.json', 'keybindings.json')

function Say([string]$text) { Write-Host $text }
function Warn([string]$text) { Write-Host $text -ForegroundColor Yellow }
function Done([int]$code) {
  if ($Interactive) { Read-Host 'Press Enter to close' | Out-Null }
  exit $code
}

# The folder name for a client: letters, digits, dash and underscore only.
function Folder-Of([string]$display) {
  return (($display.Trim() -replace '\s+', '') -replace '[^A-Za-z0-9_-]', '')
}

# The Claude icon, saved once as a file, so the shortcuts keep it after the app
# updates itself into a new version folder.
function Get-ClaudeIcon {
  $ico = Join-Path $Tools 'Claude.ico'
  if (Test-Path -LiteralPath $ico) { return "$ico,0" }
  try {
    $pkg = Get-AppxPackage -Name Claude | Select-Object -First 1
    $exe = Join-Path $pkg.InstallLocation 'app\claude.exe'
    Add-Type -AssemblyName System.Drawing
    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($exe)
    $fs = [System.IO.File]::Create($ico)
    try { $icon.Save($fs) } finally { $fs.Close() }
    return "$ico,0"
  } catch {
    return $null
  }
}

function New-Shortcut([string]$path, [string]$target, [string]$arguments) {
  $shell = New-Object -ComObject WScript.Shell
  $lnk = $shell.CreateShortcut($path)
  $lnk.TargetPath = $target
  $lnk.Arguments = $arguments
  $lnk.WorkingDirectory = $Tools
  $icon = Get-ClaudeIcon
  if ($icon) { $lnk.IconLocation = $icon }
  $lnk.Save()
}

# ---- setup, safe to repeat ------------------------------------------------------
function Install-Tools {
  foreach ($dir in @($ProfilesRoot, $ConfigsRoot, $Tools)) {
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  }
  $self = Join-Path $Tools 'Multiple-claude-accounts.ps1'
  if ($PSCommandPath -and ($PSCommandPath -ne $self)) {
    Copy-Item -LiteralPath $PSCommandPath -Destination $self -Force
  }
  $personalLnk = Join-Path $Desktop 'Claude - Personal.lnk'
  if (-not (Test-Path -LiteralPath $personalLnk)) {
    New-Shortcut $personalLnk $Alias ''
    Say 'Added the desktop icon "Claude - Personal": your Claude as it is today.'
  }
  $newLnk = Join-Path $Desktop 'New Claude client.lnk'
  if (-not (Test-Path -LiteralPath $newLnk)) {
    New-Shortcut $newLnk $PowerShell "-NoProfile -ExecutionPolicy Bypass -File `"$self`""
    Say 'Added the desktop icon "New Claude client": double-click it for each new client.'
  }
}

# ---- a new client ----------------------------------------------------------------
function New-Client([string]$display) {
  $display = $display.Trim()
  $folder = Folder-Of $display
  if (-not $folder) { Warn "`"$display`" has no letters or digits to name a folder with. Nothing was changed."; Done 1 }
  if ($folder -ieq 'Personal' -or $folder.StartsWith('_')) { Warn "`"$display`" is reserved. Pick another name. Nothing was changed."; Done 1 }
  $prof = Join-Path $ProfilesRoot $folder
  $conf = Join-Path $ConfigsRoot $folder
  if ((Test-Path -LiteralPath $prof) -or (Test-Path -LiteralPath $conf)) {
    Warn "$display already exists ($prof). Nothing was changed."
    Done 1
  }

  New-Item -ItemType Directory -Path $prof | Out-Null
  New-Item -ItemType Directory -Path $conf | Out-Null
  $copied = @()
  foreach ($f in $CopiedFiles) {
    $src = Join-Path $Personal $f
    if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination $conf; $copied += $f }
  }
  $skills = Join-Path $Personal 'skills'
  if (Test-Path -LiteralPath $skills) {
    Copy-Item -LiteralPath $skills -Destination (Join-Path $conf 'skills') -Recurse -Force
    $copied += 'skills'
  }

  $launcher = Join-Path $Tools "Start-$folder.ps1"
  $lines = @(
    "# Opens Claude for $display, kept apart from your personal Claude.",
    "`$env:CLAUDE_CONFIG_DIR = '$conf'",
    "Start-Process -FilePath '$Alias' -ArgumentList '--user-data-dir=`"$prof`"'"
  )
  Set-Content -LiteralPath $launcher -Value $lines -Encoding ASCII
  New-Shortcut (Join-Path $Desktop "Claude - $display.lnk") $PowerShell "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`""

  Say ''
  Say "Made $display."
  Say "  App data:     $prof"
  Say "  Claude Code:  $conf (copied from your personal Claude: $($copied -join ', '))"
  Say "  Desktop icon: Claude - $display"
  Say ''
  Say "Opening Claude for $display to check it really is a separate copy..."
  & $PowerShell -NoProfile -ExecutionPolicy Bypass -File $launcher
  $deadline = (Get-Date).AddSeconds(30)
  do {
    Start-Sleep -Seconds 2
    $n = @(Get-ChildItem -LiteralPath $prof -Force -ErrorAction SilentlyContinue).Count
  } while ($n -eq 0 -and (Get-Date) -lt $deadline)
  Say ''
  if ($n -gt 0) {
    Say "OK: Claude opened a separate copy for $display."
    Say "1. Sign in with $display's account in that window."
    Say '   If signing in through the browser lands you in your personal window,'
    Say '   sign in with the email code instead.'
    Say "2. Open the Code tab there and start a session in $display's project folder."
    Say '3. Then check that Claude Code is kept apart too, by running:'
    Say "   powershell -NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $Tools 'Multiple-claude-accounts.ps1')`" -Check $folder"
  } else {
    Warn "Claude did not open a separate copy for $display within 30 seconds."
    Warn 'The window you see is probably your personal one, so this version of the'
    Warn 'desktop app may not support separate copies. Nothing of your personal'
    Warn 'Claude was changed. To remove this client, delete these two folders and the icon:'
    Warn "  $prof"
    Warn "  $conf"
  }
}

# ---- is a client really kept apart? ------------------------------------------------
function Test-Client([string]$display) {
  $folder = Folder-Of $display
  $prof = Join-Path $ProfilesRoot $folder
  $conf = Join-Path $ConfigsRoot $folder
  if (-not (Test-Path -LiteralPath $conf)) { Warn "There is no client named $display ($conf)."; return }
  $appFiles = @(Get-ChildItem -LiteralPath $prof -Force -ErrorAction SilentlyContinue).Count
  $codeNew = @(Get-ChildItem -LiteralPath $conf -Force | Where-Object { ($CopiedFiles + 'skills') -notcontains $_.Name })
  if ($appFiles -gt 0) { Say "Desktop app: kept apart. Its data is in $prof." }
  else { Warn 'Desktop app: NOT kept apart. Nothing was written to its own folder.' }
  if ($codeNew.Count -gt 0) { Say "Claude Code: kept apart. It wrote $($codeNew.Count) item(s) of its own into $conf." }
  else {
    Warn "Claude Code: nothing of its own in $conf yet."
    Warn "Start a session in the Code tab of the $display window, then check again."
    Warn 'If it still says this, the Code tab uses your personal settings and login.'
  }
}

# ---- update copied skills ----------------------------------------------------------
function Update-Skills {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Warn 'git was not found, so nothing was updated.'; return }
  Get-ChildItem -LiteralPath $ConfigsRoot -Directory | Where-Object { -not $_.Name.StartsWith('_') } | ForEach-Object {
    $client = $_.Name
    Get-ChildItem -LiteralPath (Join-Path $_.FullName 'skills') -Directory -ErrorAction SilentlyContinue |
      Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName '.git') } |
      ForEach-Object {
        Say "$client / $($_.Name):"
        git -C $_.FullName pull --ff-only
      }
  }
}

# ---- main ------------------------------------------------------------------------
if (-not (Test-Path -LiteralPath $Alias)) {
  Warn "Claude Desktop's launcher was not found at $Alias."
  Warn 'Install the Claude app from claude.ai/download, then run this again. Nothing was changed.'
  Done 1
}
if ($UpdateSkills) { Update-Skills; Done 0 }
if ($Check) { Test-Client $Check; Done 0 }

Install-Tools
if (-not $Name) { $Name = Read-Host 'New client name (for example Darrow)' }
if (-not $Name -or -not $Name.Trim()) { Say 'No name given, so no client was made.'; Done 0 }
New-Client $Name
Done 0
