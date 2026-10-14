@echo off
setlocal
cd /d "%~dp0"
if not exist ".outpost-zero-root" (
  echo ERROR: Outpost Zero root marker is missing.
  pause
  exit /b 1
)
if not exist "Outpost Zero.exe" (
  if not exist "RuntimeParts\Assemble_Outpost_Zero.ps1" (
    echo ERROR: Outpost Zero runtime files are missing.
    pause
    exit /b 1
  )
  echo Preparing Outpost Zero for first launch...
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0RuntimeParts\Assemble_Outpost_Zero.ps1"
  if errorlevel 1 (
    echo ERROR: Outpost Zero could not be prepared.
    pause
    exit /b 1
  )
)
if not exist "Temp" mkdir "Temp"
if not exist "Data\State\Electron" mkdir "Data\State\Electron"
if not exist "Cache\Chromium\DiskCache" mkdir "Cache\Chromium\DiskCache"
set "ELECTRON_RUN_AS_NODE="
set "TEMP=%~dp0Temp"
set "TMP=%~dp0Temp"
set "TMPDIR=%~dp0Temp"
start "" /wait "%~dp0Outpost Zero.exe" --user-data-dir="%~dp0Data\State\Electron" --disk-cache-dir="%~dp0Cache\Chromium\DiskCache"
endlocal
