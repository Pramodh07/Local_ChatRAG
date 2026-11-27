#!/usr/bin/env pwsh
# Thin wrapper so PowerShell users can run the verification runner directly.
$ErrorActionPreference = "Stop"
node (Join-Path $PSScriptRoot "check.mjs") @args
exit $LASTEXITCODE
