@echo off
echo Atualizando os relatorios Excel da pasta Bases...
echo (pode levar alguns minutos - nao feche esta janela)
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0atualizar-relatorios.ps1"
echo.
pause
