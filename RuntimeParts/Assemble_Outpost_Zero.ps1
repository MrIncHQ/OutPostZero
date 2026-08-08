$ErrorActionPreference = 'Stop'

$partsDirectory = $PSScriptRoot
$portableRoot = Split-Path -Parent $partsDirectory
$outputPath = Join-Path $portableRoot 'Outpost Zero.exe'
$temporaryPath = Join-Path $portableRoot 'Outpost Zero.exe.assembling'
$expectedHash = 'F5DF149F7C20A42DF76026A0DB66AFEA6678B05549B998778EE46F6FFB2434AD'
$partNames = @(
    'OutpostZero.exe.001',
    'OutpostZero.exe.002',
    'OutpostZero.exe.003'
)

if (Test-Path -LiteralPath $outputPath) {
    $existingHash = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash
    if ($existingHash -eq $expectedHash) {
        return
    }
    throw 'The existing Outpost Zero.exe failed verification. Delete it and run the launcher again.'
}

foreach ($partName in $partNames) {
    $partPath = Join-Path $partsDirectory $partName
    if (-not (Test-Path -LiteralPath $partPath)) {
        throw "Required runtime part is missing: $partName"
    }
}

if (Test-Path -LiteralPath $temporaryPath) {
    Remove-Item -LiteralPath $temporaryPath -Force
}

$output = [System.IO.File]::Create($temporaryPath)
try {
    foreach ($partName in $partNames) {
        $partPath = Join-Path $partsDirectory $partName
        $input = [System.IO.File]::OpenRead($partPath)
        try {
            $input.CopyTo($output)
        }
        finally {
            $input.Dispose()
        }
    }
    $output.Flush($true)
}
finally {
    $output.Dispose()
}

$assembledHash = (Get-FileHash -LiteralPath $temporaryPath -Algorithm SHA256).Hash
if ($assembledHash -ne $expectedHash) {
    Remove-Item -LiteralPath $temporaryPath -Force
    throw 'The assembled executable failed SHA-256 verification. Download a fresh copy.'
}

Move-Item -LiteralPath $temporaryPath -Destination $outputPath

foreach ($partName in $partNames) {
    Remove-Item -LiteralPath (Join-Path $partsDirectory $partName) -Force
}
