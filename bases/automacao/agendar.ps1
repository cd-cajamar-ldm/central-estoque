<#
  AGENDAR A ATUALIZAÇÃO — roda uma vez só, no computador que vai ficar ligado.
  Cria no Agendador de Tarefas do Windows a tarefa "Central de Estoque - Atualizar relatórios",
  que roda atualizar-relatorios.ps1 a cada N minutos, com você conectado (o Excel
  precisa da sua sessão; a tela pode ficar bloqueada). Não precisa de administrador.

  Uso:  powershell -NoProfile -ExecutionPolicy Bypass -File agendar.ps1 -Pasta "C:\...\Excel" -Minutos 30
  Para tirar: abra o Agendador de Tarefas e apague a tarefa, ou rode com -Remover.
#>
param(
  [string]$Pasta,
  [int]$Minutos = 30,
  [switch]$Remover
)
$nome = 'Central de Estoque - Atualizar relatórios'

if ($Remover) {
  Unregister-ScheduledTask -TaskName $nome -Confirm:$false
  Write-Host "Tarefa removida."
  exit 0
}
if (-not $Pasta -or -not (Test-Path $Pasta)) { throw "Informe -Pasta com o caminho da pasta dos Excel (ela precisa existir)." }

$script = Join-Path $PSScriptRoot 'atualizar-relatorios.ps1'
$argumentos = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $script + '" -Pasta "' + $Pasta + '"'
$acao = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argumentos
$gatilho = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes $Minutos) -RepetitionDuration (New-TimeSpan -Days 3650)
$quem = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$opcoes = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask -TaskName $nome -Action $acao -Trigger $gatilho -Principal $quem -Settings $opcoes -Force | Out-Null
Write-Host "Pronto: '$nome' vai rodar a cada $Minutos minutos (a primeira em 1 minuto)."
Write-Host "Registro: $Pasta\_registro\atualizacao.log"
