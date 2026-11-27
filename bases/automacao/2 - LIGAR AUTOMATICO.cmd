@echo off
echo Ligando a atualizacao automatica (a cada 30 minutos)...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0agendar.ps1" -Minutos 30
echo.
pause
