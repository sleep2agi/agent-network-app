# Installation-stage helper for an isolated Windows rollback test runner only.
# Retained data and UI acceptance must be verified separately.
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Installer,
  [Parameter(Mandatory)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedSha256,
  [Parameter(Mandatory)][ValidateSet('nsis', 'msi')][string]$Kind,
  [Parameter(Mandatory)][string]$InstallDirectory,
  [Parameter(Mandatory)][string]$LogDirectory,
  [Parameter(Mandatory)][string]$InstalledExecutable,
  [Parameter(Mandatory)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$ExpectedVersion,
  [ValidateRange(1, 900)][int]$TimeoutSeconds = 180
)
$ErrorActionPreference = 'Stop'
$file = (Resolve-Path -LiteralPath $Installer).Path
if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $ExpectedSha256) {
  throw 'Installer SHA256 mismatch'
}
New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null
$logRoot = (Resolve-Path -LiteralPath $LogDirectory).Path
$id = [guid]::NewGuid().ToString('N')
if ($Kind -eq 'msi') {
  if ([IO.Path]::GetExtension($file) -ne '.msi') { throw 'Expected MSI file' }
  $exe = "$env:SystemRoot\System32\msiexec.exe"
  $arguments = "/i `"$file`" /qn /norestart /L*v `"$logRoot\$id-msi.log`""
} else {
  if ([IO.Path]::GetExtension($file) -ne '.exe') { throw 'Expected EXE file' }
  if (-not [IO.Path]::IsPathRooted($InstallDirectory) -or $InstallDirectory.Contains('"')) {
    throw 'NSIS install directory must be absolute and contain no quotes'
  }
  $exe = $file
  # NSIS requires /D to be last and unquoted, including paths with spaces.
  $arguments = "/S /D=$InstallDirectory"
}
$started = [DateTime]::UtcNow
$process = Start-Process -FilePath $exe -ArgumentList $arguments -PassThru
$completed = $process.WaitForExit($TimeoutSeconds * 1000)
$result = [ordered]@{
  installer = $file; sha256 = $ExpectedSha256; kind = $Kind
  startedUtc = $started.ToString('o'); finishedUtc = [DateTime]::UtcNow.ToString('o')
  pid = $process.Id; timedOut = -not $completed; exitCode = $null
}
if ($completed) { $result.exitCode = $process.ExitCode }
$result | ConvertTo-Json | Set-Content -LiteralPath "$logRoot\$id-result.json"
if (-not $completed) {
  throw 'Installer timed out; stop this test and discard the isolated runner. Do not run another installer.'
}
if ($process.ExitCode -ne 0) {
  throw "Installer did not complete cleanly (exit $($process.ExitCode)); no automatic uninstall or retry"
}
$binary = Get-Item -LiteralPath $InstalledExecutable
if ($binary.PSIsContainer -or $binary.Extension -ne '.exe') { throw 'Expected installed executable' }
$v = $binary.VersionInfo
$actualVersion = '{0}.{1}.{2}' -f $v.ProductMajorPart, $v.ProductMinorPart, $v.ProductBuildPart
[ordered]@{
  executable = $binary.FullName; expectedVersion = $ExpectedVersion
  actualVersion = $actualVersion; productVersion = $v.ProductVersion
  matches = ($actualVersion -eq $ExpectedVersion)
} | ConvertTo-Json | Set-Content -LiteralPath "$logRoot\$id-version.json"
if ($actualVersion -ne $ExpectedVersion) {
  throw "Installed version mismatch: expected $ExpectedVersion, got $actualVersion"
}
