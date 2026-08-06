@echo off
REM Stopper sandboxen. Samme som "start.bat -d".
cd /d "%~dp0"
call "%~dp0start.bat" -d %*
