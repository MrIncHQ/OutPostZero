param(
    [Parameter(Mandatory = $true)][string]$PortableRoot,
    [Parameter(Mandatory = $true)][string]$ArchivePath,
    [Parameter(Mandatory = $true)][string]$StagingRoot
)

$ErrorActionPreference = 'Stop'
$portableRootPath = [System.IO.Path]::GetFullPath($PortableRoot)
$archiveFullPath = [System.IO.Path]::GetFullPath($ArchivePath)
$stagingRootPath = [System.IO.Path]::GetFullPath($StagingRoot)
$modulesPath = Join-Path $portableRootPath 'Modules'
$modulesPrefix = $modulesPath + [System.IO.Path]::DirectorySeparatorChar
$stagingPrefix = $stagingRootPath + [System.IO.Path]::DirectorySeparatorChar

if (-not (Test-Path -LiteralPath (Join-Path $portableRootPath '.outpost-zero-root'))) {
    throw 'Portable root marker is missing.'
}
if (-not $archiveFullPath.StartsWith($modulesPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Kiwix archive is outside the portable Modules directory.'
}
if (-not $stagingRootPath.StartsWith($modulesPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Kiwix staging directory is outside the portable Modules directory.'
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($archiveFullPath)
try {
    foreach ($entry in $archive.Entries) {
        $relative = $entry.FullName.Replace('\', '/')
        if ([string]::IsNullOrWhiteSpace($relative) -or [System.IO.Path]::IsPathRooted($relative)) {
            throw "Kiwix archive contains an invalid path: $relative"
        }
        $segments = $relative.Split('/', [System.StringSplitOptions]::RemoveEmptyEntries)
        if ($segments -contains '..' -or $segments.Count -eq 0) {
            throw "Kiwix archive contains path traversal: $relative"
        }
        $target = [System.IO.Path]::GetFullPath((Join-Path $stagingRootPath $relative))
        if (-not $target.StartsWith($stagingPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Kiwix archive escaped staging: $relative"
        }
    }
}
finally {
    $archive.Dispose()
}

[System.IO.Compression.ZipFile]::ExtractToDirectory($archiveFullPath, $stagingRootPath)
