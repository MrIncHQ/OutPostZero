$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

& npm.cmd run package:win
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$source = Join-Path $projectRoot 'build\win-unpacked'
$releaseRoot = Join-Path $projectRoot 'Releases'
$destination = Join-Path $releaseRoot 'OutpostZero-Windows-x64'
if (-not (Test-Path -LiteralPath $source)) { throw "Packaged application was not found at $source" }

New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
if (Test-Path -LiteralPath $destination) {
    $resolvedRelease = [System.IO.Path]::GetFullPath($releaseRoot)
    $resolvedDestination = [System.IO.Path]::GetFullPath($destination)
    if (-not $resolvedDestination.StartsWith($resolvedRelease, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove a destination outside Releases."
    }
    Remove-Item -LiteralPath $resolvedDestination -Recurse -Force
}
Copy-Item -LiteralPath $source -Destination $destination -Recurse

Write-Host ''
Write-Host 'Portable build ready:' -ForegroundColor Green
Write-Host $destination
Write-Host 'Copy that entire folder to the external drive, then run Run_Outpost_Zero.bat.'
