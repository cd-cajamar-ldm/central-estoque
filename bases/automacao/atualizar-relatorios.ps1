<#
  ATUALIZAR RELATÓRIOS EXCEL — Central de Estoque (CD Cajamar)
  ------------------------------------------------------------
  Roda a cada 15 min, mas só atualiza o relatório cujo horário (escolhido no
  Almoxarifado da Oficina, gravado em _automacao\horarios.json) já chegou.
  Copia cada .xlsx da pasta para o computador, abre, clica "Atualizar tudo" (Power Query: Snowflake pelo
  ODBC, fluxos de dados...), espera terminar, salva e fecha. Um arquivo de cada vez.
  Relatório novo na pasta entra sozinho na próxima rodada.

  NÃO TEM SENHA AQUI. O login do Snowflake fica guardado pelo próprio Excel
  (na primeira vez que ele pedir, no seu computador).

  Uso:  dois cliques em "1 - ATUALIZAR AGORA.cmd" (o script fica em Bases\_automacao)
  O registro de cada rodada fica em  <Pasta>\_registro\atualizacao.log
  e o horário da última rodada boa em <Pasta>\_registro\ultima-atualizacao.txt
#>
param(
  # Sem -Pasta: usa a pasta de cima (o script mora em Bases\_automacao).
  [string]$Pasta = (Split-Path -Parent $PSScriptRoot),
  [int]$MinutosMaximoPorArquivo = 20,
  # -Visivel: mostra o Excel trabalhando (usado no "ATUALIZAR AGORA", para ver se
  # alguma janelinha do Excel está esperando resposta).
  [switch]$Visivel,
  # -Forcar: atualiza todos agora, sem olhar os horários (usado no "ATUALIZAR AGORA").
  [switch]$Forcar
)
$Pasta = (Resolve-Path $Pasta).Path

$ErrorActionPreference = 'Stop'
$registro = Join-Path $Pasta '_registro'
New-Item -ItemType Directory -Force -Path $registro | Out-Null
$log = Join-Path $registro 'atualizacao.log'
$estadoArq = Join-Path $registro 'estado.json'
$horariosArq = Join-Path $PSScriptRoot 'horarios.json'

# JSON -> tabela (o PowerShell 5 devolve objetos; o resto do script usa tabelas).
function ParaTabela($obj) {
  $t = @{}
  if ($obj) { foreach ($p in $obj.PSObject.Properties) { $t[$p.Name] = $p.Value } }
  return $t
}
function LerJson([string]$arquivo) {
  if (-not (Test-Path -LiteralPath $arquivo)) { return $null }
  try { return (Get-Content -LiteralPath $arquivo -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return $null }
}
function GravarJson([string]$arquivo, $valor) {
  $json = $valor | ConvertTo-Json -Depth 6
  [IO.File]::WriteAllText($arquivo, $json, (New-Object Text.UTF8Encoding($false)))
}

# Horários de cada relatório (editados no Almoxarifado da Oficina):
# { "padrao": ["06:00"], "relatorios": { "QRY0390 - Snow": ["06:00","08:00"] } }
$cfg = LerJson $horariosArq
$padrao = @('06:00')
if ($cfg -and $cfg.padrao) { $padrao = @($cfg.padrao) }
$porRelatorio = ParaTabela ($(if ($cfg) { $cfg.relatorios } else { $null }))

# O que aconteceu com cada relatório (o Almoxarifado lê daqui a "Última" e a "Situação").
$estado = ParaTabela (LerJson $estadoArq)

# O horário marcado mais recente que já passou (hoje; se nenhum passou ainda, o último de ontem).
function HorarioDaVez($lista, [datetime]$agora) {
  $hoje = $agora.Date
  $passados = @()
  $todos = @()
  foreach ($h in $lista) {
    $ts = [timespan]::Zero
    if (-not [timespan]::TryParse([string]$h, [ref]$ts)) { continue }
    $todos += $ts
    if ($hoje.Add($ts) -le $agora) { $passados += $hoje.Add($ts) }
  }
  if ($passados.Count) { return ($passados | Sort-Object | Select-Object -Last 1) }
  if ($todos.Count) { return $hoje.AddDays(-1).Add(($todos | Sort-Object | Select-Object -Last 1)) }
  return $null
}

function Anotar([string]$texto) {
  $linha = (Get-Date -Format 'dd/MM/yyyy HH:mm:ss') + '  ' + $texto
  Add-Content -Path $log -Value $linha -Encoding UTF8
  Write-Host $linha
}

# O Excel às vezes responde "ocupado" (chamada rejeitada) enquanto abre um arquivo
# ou carrega algo. Em vez de desistir, espera meio segundo e tenta de novo (até 2 min).
function Excel([scriptblock]$acao) {
  $tentativas = 0
  while ($true) {
    try { return (& $acao) }
    catch {
      $ex = $_.Exception
      while ($ex.InnerException) { $ex = $ex.InnerException }
      $ocupado = ($ex.HResult -eq -2147418111) -or ($ex.HResult -eq -2147417846)  # 0x80010001 / 0x8001010A
      if (-not $ocupado -or $tentativas -ge 240) { throw }
      $tentativas++
      Start-Sleep -Milliseconds 500
    }
  }
}

# Uma rodada por vez: se a anterior ainda estiver rodando, esta desiste.
$trava = New-Object System.Threading.Mutex($false, 'Global\CentralEstoqueAtualizarRelatorios')
if (-not $trava.WaitOne(0)) { Anotar 'Rodada anterior ainda em andamento — pulando esta.'; exit 0 }

$excel = $null
$falhas = 0
$ok = 0
try {
  $arquivos = Get-ChildItem -Path $Pasta -Filter '*.xlsx' -File |
    Where-Object { $_.Name -notlike '~$*' } | Sort-Object Name
  if (-not $arquivos) { Anotar 'Nenhum .xlsx na pasta.'; exit 0 }

  $agora = Get-Date
  if (-not $Forcar) {
    $arquivos = @($arquivos | Where-Object {
      $nome = $_.BaseName
      $lista = if ($porRelatorio.ContainsKey($nome)) { @($porRelatorio[$nome]) } else { $padrao }
      $vez = HorarioDaVez $lista $agora
      if (-not $vez) { return $false }
      $e = $estado[$nome]
      $ultimaOk = if ($e -and $e.ultimaOk) { [datetime]$e.ultimaOk } else { [datetime]::MinValue }
      return ($ultimaOk -lt $vez)
    })
    # Nada na hora: nem abre o Excel.
    if (-not $arquivos) { exit 0 }
  }

  Anotar ("Início da rodada: " + $arquivos.Count + " arquivo(s)" + $(if ($Forcar) { ' (forçada)' } else { '' }) + ".")
  $excel = New-Object -ComObject Excel.Application
  Start-Sleep -Seconds 3
  Excel { $excel.Visible = [bool]$Visivel }
  Excel { $excel.DisplayAlerts = $false }
  Excel { $excel.AskToUpdateLinks = $false }
  # Arquivo que a pessoa abrir com dois cliques NÃO pode cair neste Excel escondido
  # (ele seria fechado junto no fim, sem salvar). Desligado de novo antes de sair,
  # porque essa opção fica gravada no Excel do computador.
  Excel { $excel.IgnoreRemoteRequests = $true }

  # Cada arquivo é atualizado numa CÓPIA no computador (pasta temporária) e só
  # depois volta para a pasta Bases. Abrir direto o arquivo sincronizado faz o
  # Excel "registrar" no SharePoint que ele está aberto; se uma rodada trava, o
  # SharePoint fica achando que continua aberto e as próximas não conseguem abrir.
  $temp = Join-Path $env:TEMP 'CentralEstoque-relatorios'
  New-Item -ItemType Directory -Force -Path $temp | Out-Null

  foreach ($arq in $arquivos) {
    $inicio = Get-Date
    $livro = $null
    $copia = Join-Path $temp $arq.Name
    # Avisa o Almoxarifado que este relatório está sendo atualizado agora.
    $ant = $estado[$arq.BaseName]
    $estado[$arq.BaseName] = @{
      status = 'atualizando'; inicio = (Get-Date -Format 's'); mensagem = ''
      ultima = $(if ($ant) { $ant.ultima } else { $null })
      ultimaOk = $(if ($ant -and $ant.ultimaOk) { $ant.ultimaOk } else { $null })
      linhas = $(if ($ant) { $ant.linhas } else { $null })
    }
    try { GravarJson $estadoArq $estado } catch {}
    try {
      Copy-Item -LiteralPath $arq.FullName -Destination $copia -Force
      $livro = Excel { $excel.Workbooks.Open($copia, 0, $false) }

      # Atualização em segundo plano desligada: assim o "Atualizar tudo" só
      # devolve quando terminou de verdade, e o arquivo é salvo já com os dados novos.
      # Planilha feita à mão (sem consulta para atualizar): não mexe nem salva,
      # senão a data do arquivo muda a cada rodada e os apps importam de novo à toa.
      if ((Excel { $livro.Connections.Count }) -eq 0) {
        Excel { $livro.Close($false) }
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($livro)
        $livro = $null
        $quando = (Get-Date -Format 's')
        $estado[$arq.BaseName] = @{ ultima = $quando; ultimaOk = $quando; status = 'ok'; mensagem = 'planilha manual (sem consulta)'; linhas = $(if ($ant) { $ant.linhas } else { $null }); segundos = 0 }
        GravarJson $estadoArq $estado
        $ok++
        Anotar ("OK    " + $arq.Name + " (manual, sem consulta: não mexido)")
        continue
      }
      foreach ($c in (Excel { @($livro.Connections) })) {
        try { Excel { $c.OLEDBConnection.BackgroundQuery = $false } } catch {}
        try { Excel { $c.ODBCConnection.BackgroundQuery = $false } } catch {}
      }
      Excel { $livro.RefreshAll() }
      Excel { $excel.CalculateUntilAsyncQueriesDone() }
      $linhas = $null
      try {
        $plan = Excel { $livro.Worksheets.Item(1) }
        if ((Excel { $plan.ListObjects.Count }) -gt 0) { $linhas = Excel { $plan.ListObjects.Item(1).ListRows.Count } }
        else { $linhas = (Excel { $plan.UsedRange.Rows.Count }) - 1 }
      } catch {}
      Excel { $livro.Save() }
      Excel { $livro.Close($false) }
      [void][Runtime.InteropServices.Marshal]::ReleaseComObject($livro)
      $livro = $null

      # Devolve para a pasta Bases. Se alguém estiver com o arquivo aberto, tenta
      # por 1 minuto; se não der, fica para a próxima rodada.
      $devolvido = $false
      for ($t = 0; $t -lt 12 -and -not $devolvido; $t++) {
        try { Copy-Item -LiteralPath $copia -Destination $arq.FullName -Force; $devolvido = $true }
        catch { Start-Sleep -Seconds 5 }
      }
      if (-not $devolvido) { throw 'atualizou, mas não consegui devolver para a pasta (arquivo aberto por alguém?)' }

      if (((Get-Date) - $inicio).TotalMinutes -gt $MinutosMaximoPorArquivo) {
        Anotar ("AVISO " + $arq.Name + ": demorou mais de " + $MinutosMaximoPorArquivo + " min.")
      }
      $ok++
      $seg = [int]((Get-Date) - $inicio).TotalSeconds
      $quando = (Get-Date -Format 's')
      $estado[$arq.BaseName] = @{ ultima = $quando; ultimaOk = $quando; status = 'ok'; mensagem = ''; linhas = $linhas; segundos = $seg }
      GravarJson $estadoArq $estado
      Anotar ("OK    " + $arq.Name + " (" + $seg + " s)")
    } catch {
      $falhas++
      $anterior = $estado[$arq.BaseName]
      $estado[$arq.BaseName] = @{
        ultima = (Get-Date -Format 's'); status = 'erro'; mensagem = $_.Exception.Message
        ultimaOk = $(if ($anterior -and $anterior.ultimaOk) { $anterior.ultimaOk } else { $null })
        linhas = $(if ($anterior) { $anterior.linhas } else { $null })
      }
      GravarJson $estadoArq $estado
      Anotar ("ERRO  " + $arq.Name + ": " + $_.Exception.Message)
    } finally {
      if ($livro) { try { Excel { $livro.Close($false) } } catch {}; [void][Runtime.InteropServices.Marshal]::ReleaseComObject($livro) }
      Remove-Item -LiteralPath $copia -Force -ErrorAction SilentlyContinue
    }
  }

  if ($ok -gt 0) {
    Set-Content -Path (Join-Path $registro 'ultima-atualizacao.txt') -Encoding UTF8 `
      -Value ((Get-Date -Format 'HH:mm dd/MM/yyyy') + "  ($ok ok, $falhas com erro)")
  }
  Anotar ("Fim da rodada: $ok ok, $falhas com erro.")
} catch {
  Anotar ("ERRO GERAL: " + $_.Exception.Message)
  $falhas++
} finally {
  if ($excel) {
    try { Excel { $excel.IgnoreRemoteRequests = $false } } catch {}
    try { Excel { $excel.Quit() } } catch {}
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
  }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
  $trava.ReleaseMutex()
}
if ($falhas -gt 0) { exit 1 } else { exit 0 }
