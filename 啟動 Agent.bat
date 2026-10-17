@echo off
cd /d "%~dp0"
echo Starting Agent...
echo To stop: press Ctrl+C or close this window.
call npm start
echo.
echo Agent stopped. Press any key to close...
pause >nul
