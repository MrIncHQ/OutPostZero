@echo off
setlocal
cd /d "%~dp0"
call npm.cmd install
if errorlevel 1 (
  echo Setup failed.
  pause
  exit /b 1
)
echo.
echo Setup complete. Run Run_Outpost_Zero_Dev.bat to launch Outpost Zero.
pause
endlocal
