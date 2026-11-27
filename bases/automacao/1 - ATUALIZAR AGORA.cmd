@echo off
echo Atualizando os relatorios Excel da pasta Bases...
echo (o Excel vai aparecer trabalhando - nao mexa nele nem feche esta janela)
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0atualizar-relatorios.ps1" -Visivel -Forcar
echo.
pause
