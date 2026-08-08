@echo off
setlocal
cd /d "%~dp0"
call npm.cmd run release:win
if errorlevel 1 pause
endlocal
