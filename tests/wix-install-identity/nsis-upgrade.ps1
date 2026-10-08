# Only disposable native Windows CI; never install into a user's machine.
param([Parameter(Mandatory=$true)][string]$Candidate)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows') { throw 'Isolated GitHub Windows runner required' }
$Candidate = (Resolve-Path $Candidate).Path
$evidence = Join-Path $env:RUNNER_TEMP 'nsis805-evidence'
New-Item -ItemType Directory -Force $evidence | Out-Null
Start-Transcript -Path (Join-Path $evidence 'upgrade.log')
try {
  $old = Join-Path $evidence 'published-0.2.224.exe'
  Invoke-WebRequest 'https://github.com/sleep2agi/agent-network-app/releases/download/desktop-v0.2.224/Agent.Network_0.2.224_x64-setup.exe' -OutFile $old
  if ((Get-FileHash $old -Algorithm SHA256).Hash.ToLower() -ne '4afe1a6242234da67755ee584497c88db5931df02ab91c4a29135c34eba3b9c4') { throw 'Published NSIS hash mismatch' }
  function Entries {
    @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*') |
      ForEach-Object { Get-ItemProperty $_ -ErrorAction SilentlyContinue } |
      Where-Object { $_.DisplayName -in @('Agent Network', 'ANet') }
  }
  function Run-Installer([string]$File, [string]$Arguments) {
    $p = Start-Process $File -ArgumentList $Arguments -PassThru
    if (-not $p.WaitForExit(120000)) { throw 'Installer did not finish within 120 seconds' }
    if ($p.ExitCode -ne 0) { throw "Installer failed: $($p.ExitCode)" }
  }
  if (@(Entries).Count) { throw 'Runner already has an ANet installation' }
  $data = Join-Path $env:USERPROFILE '.anet\app\nsis805-fixture'
  New-Item -ItemType Directory -Force $data | Out-Null
  Set-Content (Join-Path $data 'account-sentinel') 'fixture-not-real-credentials'
  foreach ($case in @('default', 'custom')) {
    # NSIS /D= is deliberately last and unquoted, including when it has spaces.
    $argsOld = if ($case -eq 'custom') { "/S /D=$env:RUNNER_TEMP\Chosen NSIS Directory" } else { '/S' }
    Run-Installer $old $argsOld
    $beforeEntries = @(Entries)
    if ($beforeEntries.Count -ne 1) { throw 'Expected one published NSIS registration' }
    $before = $beforeEntries[0].InstallLocation.Trim('"').TrimEnd('\')
    $expected = if ($case -eq 'custom') { "$env:RUNNER_TEMP\Chosen NSIS Directory" } else { "$env:LOCALAPPDATA\Agent Network" }
    if ($before -ne $expected) { throw "Unexpected old $case path: $before" }
    $dirs = @([Environment]::GetFolderPath('DesktopDirectory'), [Environment]::GetFolderPath('Programs'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'Agent Network'))
    $oldDirs = @($dirs | Where-Object { Test-Path (Join-Path $_ 'Agent Network.lnk') })
    if ($oldDirs.Count -lt 2) { throw 'Published NSIS desktop/menu shortcuts missing' }
    Run-Installer $Candidate '/S /UPDATE'
    $after = @(Entries)
    if ($after.Count -ne 1 -or $after[0].DisplayName -ne 'ANet' -or $after[0].DisplayVersion -ne '0.2.227') { throw 'Expected one renamed NSIS registration' }
    if ($after[0].InstallLocation.Trim('"').TrimEnd('\') -ne $before) { throw 'NSIS installation directory changed' }
    if (-not (Test-Path (Join-Path $before 'agent-network-desktop.exe'))) { throw 'Installed binary missing' }
    foreach ($dir in $oldDirs) {
      if (Test-Path (Join-Path $dir 'Agent Network.lnk')) { throw 'Legacy shortcut remains' }
      if (-not (Test-Path (Join-Path $dir 'ANet.lnk'))) { throw 'Renamed shortcut missing' }
    }
    if ((Get-Content (Join-Path $data 'account-sentinel')).Trim() -ne 'fixture-not-real-credentials') { throw 'Fixture data changed' }
    Write-Host "PASS published NSIS .224 -> ANet: $case path retained, one registration, shortcuts migrated, fixture data retained"
    # _?= runs this disposable uninstaller in place so WaitForExit observes it.
    Run-Installer (Join-Path $before 'uninstall.exe') "/S _?=$before"
    if (@(Entries).Count) { throw 'NSIS candidate uninstall registration remains' }
  }
} finally { Stop-Transcript }
