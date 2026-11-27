@echo off
echo Desligando a atualizacao automatica...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0agendar.ps1" -Remover
echo.
pause
