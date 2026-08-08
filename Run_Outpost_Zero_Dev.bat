@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Dependencies are not installed. Run Setup_Outpost_Zero_Dev.bat first.
  pause
  exit /b 1
)
set "ELECTRON_RUN_AS_NODE="
call npm.cmd run dev
if errorlevel 1 pause
endlocal
