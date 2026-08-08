param(
    [Parameter(Mandatory = $true)][string]$Updater,
    [Parameter(Mandatory = $true)][string]$PortableRoot,
    [Parameter(Mandatory = $true)][string]$StagingRoot,
    [Parameter(Mandatory = $true)][string]$PendingFile,
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][string]$HandshakeFile
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Updater -PathType Leaf)) {
    throw 'Portable updater helper is missing.'
}

function Quote-NativeArgument([string]$Value) {
    return '"' + $Value.Replace('"', '\"') + '"'
}

$arguments = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', (Quote-NativeArgument $Updater),
    '-PortableRoot', (Quote-NativeArgument $PortableRoot),
    '-StagingRoot', (Quote-NativeArgument $StagingRoot),
    '-PendingFile', (Quote-NativeArgument $PendingFile),
    '-ProcessId', [string]$ProcessId,
    '-HandshakeFile', (Quote-NativeArgument $HandshakeFile)
)

$worker = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WindowStyle Hidden -PassThru
$deadline = (Get-Date).AddSeconds(15)
while (-not (Test-Path -LiteralPath $HandshakeFile)) {
    if ($worker.HasExited) {
        throw "Portable updater exited before startup confirmation with code $($worker.ExitCode)."
    }
    if ((Get-Date) -ge $deadline) {
        Stop-Process -Id $worker.Id -Force -ErrorAction SilentlyContinue
        throw 'Portable updater did not confirm startup.'
    }
    Start-Sleep -Milliseconds 100
}
