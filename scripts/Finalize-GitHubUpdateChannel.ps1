param(
    [Parameter(Mandatory = $true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
    [string]$BridgeRef = 'runtime-v0.15.4'
)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$distribution = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'Releases\GitHubDistribution'))
$rootManifest = Join-Path $distribution 'update-manifest.json'
$channelManifest = Join-Path $distribution 'UpdateChannel\update-manifest.json'

if (-not (Test-Path -LiteralPath (Join-Path $distribution '.git'))) { throw 'GitHubDistribution is not the expected distribution worktree.' }
if (-not (Test-Path -LiteralPath $rootManifest -PathType Leaf)) { throw 'The staged runtime manifest is missing.' }
if ([version]$Version -le [version]'0.15.4') { throw 'Channel finalization is only for releases after the frozen 0.15.4 bridge.' }

$channelBytes = [System.IO.File]::ReadAllBytes($rootManifest)
$envelope = Get-Content -LiteralPath $rootManifest -Raw | ConvertFrom-Json
$payloadJson = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([string]$envelope.signedPayload))
$payload = $payloadJson | ConvertFrom-Json
if ([string]$payload.version -ne $Version -or [string]$payload.releaseRef -ne "runtime-v$Version") {
    throw 'The staged signed manifest does not match the requested channel version.'
}

& git -C $distribution rev-parse --verify "$BridgeRef^{commit}" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "The frozen bridge reference does not exist: $BridgeRef" }

& git -C $distribution restore --source $BridgeRef --worktree --staged -- . ':(exclude)UpdateChannel/**' ':(exclude)Nature/**'
if ($LASTEXITCODE -ne 0) { throw 'Could not restore the frozen legacy bridge runtime.' }

New-Item -ItemType Directory -Path (Split-Path -Parent $channelManifest) -Force | Out-Null
[System.IO.File]::WriteAllBytes($channelManifest, $channelBytes)

& node (Join-Path $projectRoot 'scripts\verify-update-distribution.mjs') $distribution (Join-Path $projectRoot 'ReleaseSigning\public.pem')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Restored $BridgeRef at the repository root and staged channel v$Version." -ForegroundColor Green
