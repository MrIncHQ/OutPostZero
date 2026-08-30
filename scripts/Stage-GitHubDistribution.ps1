param([Parameter(Mandatory = $true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version)
$ErrorActionPreference = 'Stop'
if ([version]$Version -gt [version]'0.15.4') { throw 'The legacy root update channel is frozen at 0.15.4. Publish later releases as immutable runtime tags and update only UpdateChannel/update-manifest.json.' }
$projectRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$releaseRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'Releases'))
$source = [System.IO.Path]::GetFullPath((Join-Path $releaseRoot 'OutpostZero-Windows-x64'))
$distribution = [System.IO.Path]::GetFullPath((Join-Path $releaseRoot 'GitHubDistribution'))
$privateKey = Join-Path $projectRoot 'ReleaseSigning\private.pem'

if (-not $source.StartsWith($releaseRoot, [System.StringComparison]::OrdinalIgnoreCase) -or -not $distribution.StartsWith($releaseRoot, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Release paths escaped the Releases directory.' }
if (-not (Test-Path -LiteralPath (Join-Path $source 'Outpost Zero.exe'))) { throw 'Build the portable Windows release first.' }
if (-not (Test-Path -LiteralPath (Join-Path $distribution '.git'))) { throw 'GitHubDistribution is not the expected distribution worktree.' }
if (-not (Test-Path -LiteralPath $privateKey)) { throw 'The local update signing key is missing.' }

$preserved = @('.git', '.gitattributes', 'README.md', 'update-manifest.json', 'RuntimeParts', 'Nature', 'UpdateChannel')
$sourceNames = @(Get-ChildItem -LiteralPath $source -Force | ForEach-Object Name)
foreach ($entry in Get-ChildItem -LiteralPath $distribution -Force) {
    if ($preserved -contains $entry.Name -or $sourceNames -contains $entry.Name) { continue }
    $target = [System.IO.Path]::GetFullPath($entry.FullName)
    if (-not $target.StartsWith($distribution + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Refusing to remove path outside distribution: $target" }
    Remove-Item -LiteralPath $target -Recurse -Force
}

foreach ($entry in Get-ChildItem -LiteralPath $source -Force | Where-Object Name -ne 'Outpost Zero.exe') {
    $target = Join-Path $distribution $entry.Name
    if ($entry.PSIsContainer) {
        $resolvedTarget = [System.IO.Path]::GetFullPath($target)
        if (-not $resolvedTarget.StartsWith($distribution + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Refusing to replace path outside distribution: $resolvedTarget" }
        if (Test-Path -LiteralPath $resolvedTarget) { Remove-Item -LiteralPath $resolvedTarget -Recurse -Force }
        Copy-Item -LiteralPath $entry.FullName -Destination $resolvedTarget -Recurse
    } else { Copy-Item -LiteralPath $entry.FullName -Destination $target -Force }
}

$runtimeParts = Join-Path $distribution 'RuntimeParts'
New-Item -ItemType Directory -Path $runtimeParts -Force | Out-Null
foreach ($partName in @('OutpostZero.exe.001', 'OutpostZero.exe.002', 'OutpostZero.exe.003', 'OutpostZero.exe.sha256')) {
    $partPath = Join-Path $runtimeParts $partName
    if (Test-Path -LiteralPath $partPath) { Remove-Item -LiteralPath $partPath -Force }
}
$executable = Join-Path $source 'Outpost Zero.exe'
$length = (Get-Item -LiteralPath $executable).Length
$partLength = [Math]::Ceiling($length / 3)
$input = [System.IO.File]::OpenRead($executable)
try {
    for ($index = 1; $index -le 3; $index++) {
        $partPath = Join-Path $runtimeParts ('OutpostZero.exe.{0:D3}' -f $index)
        $output = [System.IO.File]::Create($partPath)
        try {
            $remaining = [Math]::Min($partLength, $length - $input.Position)
            $buffer = New-Object byte[] (4MB)
            while ($remaining -gt 0) {
                $read = $input.Read($buffer, 0, [Math]::Min($buffer.Length, $remaining))
                if ($read -le 0) { throw 'Unexpected end of executable while splitting.' }
                $output.Write($buffer, 0, $read); $remaining -= $read
            }
        } finally { $output.Dispose() }
    }
} finally { $input.Dispose() }
$hash = (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash
Set-Content -LiteralPath (Join-Path $runtimeParts 'OutpostZero.exe.sha256') -Value "$hash  Outpost Zero.exe" -Encoding ascii

$readmePath = Join-Path $distribution 'README.md'
$readme = @'
# Outpost Zero

Outpost Zero is a portable, offline-first knowledge and tools platform. The application runs directly from its folder and keeps its controlled data on the same drive.

## Download

Select **Code**, then **Download ZIP** on this repository page.

## Run on Windows

1. Download the repository ZIP from GitHub.
2. Extract the complete folder to an external SSD or another local folder.
3. Keep all extracted files together.
4. Double-click `Run_Outpost_Zero.bat`.
5. Before removing an external drive, use **Prepare Drive for Removal**, close the app, and safely eject the drive.

On first launch, the launcher assembles and verifies the packaged executable from GitHub-compatible runtime parts. No installer, administrator access, Node.js installation, installed web browser, or internet account is required.

## Current release

Version: `{{VERSION}}`

SHA-256 for the assembled `Outpost Zero.exe`:

```text
{{HASH}}
```

This repository is used only to distribute ready-to-run Outpost Zero releases. Source code is not published here.
'@
$readme = $readme.Replace('{{VERSION}}', $Version).Replace('{{HASH}}', $hash)
Set-Content -LiteralPath $readmePath -Value $readme -Encoding utf8

& node (Join-Path $projectRoot 'scripts\sign-update-manifest.mjs') $distribution $privateKey $Version
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$channelManifest = Join-Path $distribution 'UpdateChannel\update-manifest.json'
New-Item -ItemType Directory -Path (Split-Path -Parent $channelManifest) -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $distribution 'update-manifest.json') -Destination $channelManifest -Force
& node (Join-Path $projectRoot 'scripts\verify-update-distribution.mjs') $distribution (Join-Path $projectRoot 'ReleaseSigning\public.pem')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "GitHub runtime distribution staged for v$Version ($hash)." -ForegroundColor Green
