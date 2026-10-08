# Disposable GitHub Windows runner only. Never run against a user's installation.
param([Parameter(Mandatory=$true)][string]$Candidate)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows') {
  throw 'Isolated GitHub Windows runner required'
}
$Candidate = (Resolve-Path $Candidate).Path
$evidence = Join-Path $env:RUNNER_TEMP 'wix807-evidence'
New-Item -ItemType Directory -Force $evidence | Out-Null
$old = Join-Path $evidence 'published-0.2.224.msi'
Invoke-WebRequest 'https://github.com/sleep2agi/agent-network-app/releases/download/desktop-v0.2.224/Agent.Network_0.2.224_x64_en-US.msi' -OutFile $old
if ((Get-FileHash $old -Algorithm SHA256).Hash.ToLower() -ne '6441607e12cf22de08205eb4224723109522a4d0ea242fca88777b4f0a8c7cac') { throw 'Published MSI hash mismatch' }
function Install-Msi([string]$Path, [string]$Log, [string]$Extra = '') {
  $p = Start-Process msiexec.exe -ArgumentList "/i `"$Path`" /qn /norestart /l*v `"$evidence\$Log.log`" $Extra" -Wait -PassThru
  if ($p.ExitCode -notin @(0, 3010)) { throw "MSI $Log failed: $($p.ExitCode)" }
}
function Entries {
  @('HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*') |
    ForEach-Object { Get-ItemProperty $_ -ErrorAction SilentlyContinue } |
    Where-Object { $_.DisplayName -in @('Agent Network', 'ANet') }
}
if (@(Entries).Count) { throw 'Runner already has an ANet installation' }
$key = 'HKCU:\Software\vansin\Agent Network'
$data = Join-Path $env:USERPROFILE '.anet\app\wix807-fixture'
New-Item -ItemType Directory -Force $data | Out-Null
Set-Content (Join-Path $data 'account-sentinel') 'retained-fixture-not-real-credentials'
foreach ($case in @('default', 'custom')) {
  $extra = if ($case -eq 'custom') { "INSTALLDIR=`"$env:RUNNER_TEMP\Chosen ANet Directory`"" } else { '' }
  Install-Msi $old "$case-old" $extra
  $before = (Get-ItemProperty $key).InstallDir.TrimEnd('\')
  $expected = if ($case -eq 'custom') { "$env:RUNNER_TEMP\Chosen ANet Directory" } else { "$env:ProgramFiles\Agent Network" }
  if ($before -ne $expected) { throw "Old $case directory unexpected: $before" }
  $shortcutDirs = @([Environment]::GetFolderPath('CommonDesktopDirectory'), [Environment]::GetFolderPath('DesktopDirectory'))
  $menuDirs = @([Environment]::GetFolderPath('CommonPrograms'), [Environment]::GetFolderPath('Programs')) |
    ForEach-Object { Join-Path $_ 'Agent Network' }
  $oldDesktop = @($shortcutDirs | Where-Object { Test-Path (Join-Path $_ 'Agent Network.lnk') })
  $oldMenu = @($menuDirs | Where-Object { Test-Path (Join-Path $_ 'Agent Network.lnk') })
  if (-not $oldDesktop.Count -or -not $oldMenu.Count) { throw 'Published shortcut baseline missing' }
  Install-Msi $Candidate "$case-new"
  $after = (Get-ItemProperty $key).InstallDir.TrimEnd('\')
  if ($after -ne $before) { throw "INSTALL_DIRECTORY_CHANGED: $before -> $after" }
  if (-not (Test-Path (Join-Path $before 'agent-network-desktop.exe'))) { throw 'Missing installed binary' }
  $entries = @(Entries)
  if ($entries.Count -ne 1 -or $entries[0].DisplayName -ne 'ANet' -or $entries[0].DisplayVersion -ne '0.2.227') { throw 'Expected exactly one updated uninstall registration' }
  foreach ($directory in @($oldDesktop) + @($oldMenu)) {
    if (Test-Path (Join-Path $directory 'Agent Network.lnk')) { throw "Legacy shortcut remains in $directory" }
    if (-not (Test-Path (Join-Path $directory 'ANet.lnk'))) { throw "Renamed shortcut missing in $directory" }
  }
  if (Test-Path (Join-Path $before 'Uninstall Agent Network.lnk')) { throw 'Legacy uninstall shortcut remains' }
  if ((Get-Content (Join-Path $data 'account-sentinel')).Trim() -ne 'retained-fixture-not-real-credentials') { throw 'Fixture account data changed' }
  Write-Host "PASS published .224 -> ANet: $case directory retained, one registration, shortcuts migrated, fixture data retained"
  $p = Start-Process msiexec.exe -ArgumentList "/x $($entries[0].PSChildName) /qn /norestart /l*v `"$evidence\$case-uninstall.log`"" -Wait -PassThru
  if ($p.ExitCode -notin @(0, 3010) -or @(Entries).Count) { throw 'Candidate cleanup failed' }
}
