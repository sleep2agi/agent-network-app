[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet('nsis', 'msi')][string]$Kind,
  [Parameter(Mandatory)][string]$Destination
)
$ErrorActionPreference = 'Stop'
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'windows-rollback-release-assets.json') -Raw | ConvertFrom-Json
if ($manifest.repository -ne 'sleep2agi/agent-network-app') { throw 'Unexpected release repository' }
$assets = @($manifest.assets | Where-Object { $_.kind -eq $Kind })
if ($assets.Count -ne 2) { throw 'Expected exactly two versioned assets' }
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
foreach ($asset in $assets) {
  if ($asset.version -notin @('0.2.615', '0.2.616') -or
      $asset.name -ne [IO.Path]::GetFileName($asset.name) -or
      $asset.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Invalid asset record' }
  $target = Join-Path $Destination $asset.name
  if (Test-Path -LiteralPath $target) { throw 'Use a fresh download directory' }
  $url = 'https://github.com/{0}/releases/download/desktop-v{1}/{2}' -f $manifest.repository, $asset.version, $asset.name
  Invoke-WebRequest -Uri $url -OutFile $target -TimeoutSec 120
  $file = Get-Item -LiteralPath $target
  $hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
  if ($file.Length -ne $asset.size -or $hash -ne $asset.sha256) {
    throw "Downloaded asset does not match pinned release evidence: $($asset.name)"
  }
  [pscustomobject]@{ version = $asset.version; kind = $Kind; path = $file.FullName; sha256 = $hash; size = $file.Length }
}
