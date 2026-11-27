<#
  ATUALIZAR RELATÓRIOS EXCEL — Central de Estoque (CD Cajamar)
  ------------------------------------------------------------
  Abre cada .xlsx da pasta, clica "Atualizar tudo" (Power Query: Snowflake pelo
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
  [switch]$Visivel
)
$Pasta = (Resolve-Path $Pasta).Path

$ErrorActionPreference = 'Stop'
$registro = Join-Path $Pasta '_registro'
New-Item -ItemType Directory -Force -Path $registro | Out-Null
$log = Join-Path $registro 'atualizacao.log'
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

  Anotar ("Início da rodada: " + $arquivos.Count + " arquivo(s).")
  $excel = New-Object -ComObject Excel.Application
  Start-Sleep -Seconds 3
  Excel { $excel.Visible = [bool]$Visivel }
  Excel { $excel.DisplayAlerts = $false }
  Excel { $excel.AskToUpdateLinks = $false }

  foreach ($arq in $arquivos) {
    $inicio = Get-Date
    $livro = $null
    try {
      $livro = Excel { $excel.Workbooks.Open($arq.FullName, 0, $false) }
      if (Excel { $livro.ReadOnly }) { throw 'arquivo aberto por outra pessoa/programa (somente leitura)' }

      # Atualização em segundo plano desligada: assim o "Atualizar tudo" só
      # devolve quando terminou de verdade, e o arquivo é salvo já com os dados novos.
      foreach ($c in (Excel { @($livro.Connections) })) {
        try { Excel { $c.OLEDBConnection.BackgroundQuery = $false } } catch {}
        try { Excel { $c.ODBCConnection.BackgroundQuery = $false } } catch {}
      }
      Excel { $livro.RefreshAll() }
      Excel { $excel.CalculateUntilAsyncQueriesDone() }

      if (((Get-Date) - $inicio).TotalMinutes -gt $MinutosMaximoPorArquivo) {
        Anotar ("AVISO " + $arq.Name + ": demorou mais de " + $MinutosMaximoPorArquivo + " min.")
      }
      Excel { $livro.Save() }
      $ok++
      Anotar ("OK    " + $arq.Name + " (" + [int]((Get-Date) - $inicio).TotalSeconds + " s)")
    } catch {
      $falhas++
      Anotar ("ERRO  " + $arq.Name + ": " + $_.Exception.Message)
    } finally {
      if ($livro) { try { Excel { $livro.Close($false) } } catch {}; [void][Runtime.InteropServices.Marshal]::ReleaseComObject($livro) }
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
    try { Excel { $excel.Quit() } } catch {}
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
  }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
  $trava.ReleaseMutex()
}
if ($falhas -gt 0) { exit 1 } else { exit 0 }
