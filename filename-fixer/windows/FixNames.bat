@echo off
rem Mac filename fixer (NFD -> NFC). Drag files or folders onto this .bat.
rem Keep FixNames.bat and FixNames.ps1 together in the same folder.
chcp 65001 >nul
setlocal
if not exist "%~dp0FixNames.ps1" (
  echo [ERROR] FixNames.ps1 not found next to this file.
  echo Please keep FixNames.bat and FixNames.ps1 in the SAME folder.
  echo.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0FixNames.ps1" %*
echo.
pause
