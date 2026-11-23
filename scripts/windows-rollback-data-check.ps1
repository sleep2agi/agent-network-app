# Compare explicitly selected immutable test fixtures while the test app is stopped.
# Do not include live database files: normal migrations may change their bytes.
[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet('capture', 'verify')][string]$Mode,
  [Parameter(Mandatory)][string[]]$Files,
  [Parameter(Mandatory)][string]$Manifest
)
$ErrorActionPreference = 'Stop'
if ($Files.Count -eq 0) { throw 'Select at least one test fixture' }
$rows = @($Files | ForEach-Object {
  $f = Get-Item -LiteralPath $_
  if ($f.PSIsContainer) { throw 'Expected a file' }
  [pscustomobject]@{ path = $f.FullName; sha256 = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash }
})
if ($Mode -eq 'capture') {
  if (Test-Path -LiteralPath $Manifest) { throw 'Refusing to overwrite the baseline manifest' }
  ConvertTo-Json -InputObject $rows | Set-Content -LiteralPath $Manifest
} else {
  $baseline = @(Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json)
  if ($baseline.Count -ne $rows.Count) { throw 'Fixture count changed' }
  foreach ($row in $rows) {
    $matches = @($baseline | Where-Object { $_.path -eq $row.path })
    if ($matches.Count -ne 1 -or $matches[0].sha256 -ne $row.sha256) {
      throw "Fixture missing, duplicated, or changed: $($row.path)"
    }
  }
  Write-Output 'Selected immutable fixtures retained; database and UI acceptance remain separate.'
}
