$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

& npm.cmd run package:win
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$source = Join-Path $projectRoot 'build\win-unpacked'
$serialBinding = Join-Path $source 'resources\app.asar.unpacked\node_modules\@serialport\bindings-cpp'
if (Test-Path -LiteralPath $serialBinding) {
    $resolvedSource = [System.IO.Path]::GetFullPath($source)
    $sourceFiles = Join-Path $serialBinding 'src'
    if (Test-Path -LiteralPath $sourceFiles) {
        $resolvedSourceFiles = [System.IO.Path]::GetFullPath($sourceFiles)
        if (-not $resolvedSourceFiles.StartsWith($resolvedSource + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'SerialPort source cleanup escaped the packaged runtime.' }
        Remove-Item -LiteralPath $resolvedSourceFiles -Recurse -Force
    }
    $prebuilds = Join-Path $serialBinding 'prebuilds'
    foreach ($platform in Get-ChildItem -LiteralPath $prebuilds -Directory | Where-Object Name -ne 'win32-x64') {
        $resolvedPlatform = [System.IO.Path]::GetFullPath($platform.FullName)
        if (-not $resolvedPlatform.StartsWith($resolvedSource + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'SerialPort platform cleanup escaped the packaged runtime.' }
        Remove-Item -LiteralPath $resolvedPlatform -Recurse -Force
    }
}
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
