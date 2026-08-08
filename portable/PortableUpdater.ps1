param(
    [Parameter(Mandatory = $true)][string]$PortableRoot,
    [Parameter(Mandatory = $true)][string]$StagingRoot,
    [Parameter(Mandatory = $true)][string]$PendingFile,
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [switch]$NoRestart
)

$ErrorActionPreference = 'Stop'
$portableRootPath = [System.IO.Path]::GetFullPath($PortableRoot)
$stagingRootPath = [System.IO.Path]::GetFullPath($StagingRoot)
$pendingFilePath = [System.IO.Path]::GetFullPath($PendingFile)
$rootPrefix = $portableRootPath + [System.IO.Path]::DirectorySeparatorChar
$stagingPrefix = $stagingRootPath + [System.IO.Path]::DirectorySeparatorChar
$protectedRoots = @(
    'AI', 'Backups', 'Cache', 'Config', 'Content', 'Data', 'Downloads',
    'Exports', 'Logs', 'Modules', 'Profile', 'Temp', 'Updates'
)

if (-not (Test-Path -LiteralPath (Join-Path $portableRootPath '.outpost-zero-root'))) {
    throw 'Portable root marker is missing.'
}
if (-not $stagingRootPath.StartsWith((Join-Path $portableRootPath 'Updates') + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Update staging directory is outside the portable Updates directory.'
}
if (-not $pendingFilePath.StartsWith((Join-Path $portableRootPath 'Updates') + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Pending update file is outside the portable Updates directory.'
}

$pending = Get-Content -LiteralPath $pendingFilePath -Raw | ConvertFrom-Json
if (-not $pending.version -or -not $pending.files) {
    throw 'Pending update metadata is invalid.'
}

$logDirectory = Join-Path $portableRootPath 'Updates'
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$logPath = Join-Path $logDirectory 'update.log'
function Write-UpdateLog([string]$Message) {
    Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) $Message" -Encoding UTF8
}

Write-UpdateLog "Waiting for Outpost Zero process $ProcessId to exit."
$deadline = (Get-Date).AddSeconds(90)
while (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) {
    if ((Get-Date) -gt $deadline) {
        throw 'Outpost Zero did not exit before the update timeout.'
    }
    Start-Sleep -Milliseconds 250
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$rollbackRoot = Join-Path $portableRootPath "Updates\Rollback\$($pending.previousVersion)-$timestamp"
New-Item -ItemType Directory -Force -Path $rollbackRoot | Out-Null
$applied = New-Object System.Collections.Generic.List[object]

function Resolve-ControlledPath([string]$BasePath, [string]$RelativePath, [string]$RequiredPrefix) {
    if ([string]::IsNullOrWhiteSpace($RelativePath) -or [System.IO.Path]::IsPathRooted($RelativePath)) {
        throw "Update path must be relative: $RelativePath"
    }
    $normalized = $RelativePath.Replace('/', [System.IO.Path]::DirectorySeparatorChar)
    $segments = $normalized.Split([System.IO.Path]::DirectorySeparatorChar, [System.StringSplitOptions]::RemoveEmptyEntries)
    if ($segments -contains '..' -or $segments.Count -eq 0) {
        throw "Update path contains traversal: $RelativePath"
    }
    if ($BasePath -eq $portableRootPath -and $protectedRoots -contains $segments[0]) {
        throw "Update attempted to write protected user data: $RelativePath"
    }
    $resolved = [System.IO.Path]::GetFullPath((Join-Path $BasePath $normalized))
    if (-not $resolved.StartsWith($RequiredPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Update path escaped its allowed root: $RelativePath"
    }
    return $resolved
}

try {
    foreach ($file in $pending.files) {
        $relativePath = [string]$file.path
        $source = Resolve-ControlledPath $stagingRootPath $relativePath $stagingPrefix
        $destination = Resolve-ControlledPath $portableRootPath $relativePath $rootPrefix
        if (-not (Test-Path -LiteralPath $source)) {
            throw "Verified staged file is missing: $relativePath"
        }
        $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
        if ($sourceHash -ne [string]$file.sha256) {
            throw "Staged file failed verification: $relativePath"
        }

        $hadOriginal = Test-Path -LiteralPath $destination
        if ($hadOriginal) {
            $backupPath = Resolve-ControlledPath $rollbackRoot $relativePath ($rollbackRoot + [System.IO.Path]::DirectorySeparatorChar)
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $backupPath) | Out-Null
            Copy-Item -LiteralPath $destination -Destination $backupPath -Force
        }

        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
        Copy-Item -LiteralPath $source -Destination $destination -Force
        $destinationHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
        if ($destinationHash -ne [string]$file.sha256) {
            throw "Installed file failed verification: $relativePath"
        }
        $applied.Add([pscustomobject]@{ Path = $relativePath; HadOriginal = $hadOriginal })
        Write-UpdateLog "Installed $relativePath"
    }

    $installedStatePath = Join-Path $portableRootPath 'Data\State\installed-version.json'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $installedStatePath) | Out-Null
    [ordered]@{
        version = [string]$pending.version
        previousVersion = [string]$pending.previousVersion
        installedAt = (Get-Date).ToUniversalTime().ToString('o')
        rollbackPath = $rollbackRoot.Substring($portableRootPath.Length + 1).Replace('\', '/')
    } | ConvertTo-Json | Set-Content -LiteralPath $installedStatePath -Encoding UTF8
    Write-UpdateLog "Update to $($pending.version) completed successfully."
}
catch {
    Write-UpdateLog "Update failed: $($_.Exception.Message). Rolling back."
    for ($index = $applied.Count - 1; $index -ge 0; $index--) {
        $entry = $applied[$index]
        $destination = Resolve-ControlledPath $portableRootPath $entry.Path $rootPrefix
        if ($entry.HadOriginal) {
            $backupPath = Resolve-ControlledPath $rollbackRoot $entry.Path ($rollbackRoot + [System.IO.Path]::DirectorySeparatorChar)
            Copy-Item -LiteralPath $backupPath -Destination $destination -Force
        }
        elseif (Test-Path -LiteralPath $destination) {
            Remove-Item -LiteralPath $destination -Force
        }
    }
    throw
}

$launcher = Join-Path $portableRootPath 'Run_Outpost_Zero.bat'
if (-not $NoRestart -and (Test-Path -LiteralPath $launcher)) {
    Start-Process -FilePath $env:ComSpec -ArgumentList @('/c', "`"$launcher`"") -WorkingDirectory $portableRootPath -WindowStyle Hidden
}
