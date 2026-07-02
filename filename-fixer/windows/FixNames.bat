@echo off
rem Mac filename fixer (NFD -> NFC). Drag files or folders onto this .bat.
rem Dropped items are passed to FixNames.ps1 in the same folder.
chcp 65001 >nul
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0FixNames.ps1" %*
echo.
pause
