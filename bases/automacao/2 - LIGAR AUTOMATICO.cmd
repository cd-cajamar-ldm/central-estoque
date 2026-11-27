@echo off
echo Ligando a atualizacao automatica (confere a cada 15 minutos e atualiza nos horarios do Almoxarifado)...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0agendar.ps1" -Minutos 15
echo.
pause
