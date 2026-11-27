$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot

Push-Location $projectRoot
try {
  foreach ($scriptName in @("typecheck", "lint", "test", "build")) {
    Write-Host "`n> pnpm run $scriptName" -ForegroundColor Cyan
    & pnpm run $scriptName
    if ($LASTEXITCODE -ne 0) {
      exit $LASTEXITCODE
    }
  }
}
finally {
  Pop-Location
}
