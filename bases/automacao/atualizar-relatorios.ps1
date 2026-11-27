<#
  ATUALIZAR RELATÓRIOS EXCEL — Central de Estoque (CD Cajamar)
  ------------------------------------------------------------
  Abre cada .xlsx da pasta, clica "Atualizar tudo" (Power Query: Snowflake pelo
  ODBC, fluxos de dados...), espera terminar, salva e fecha. Um arquivo de cada vez.
  Relatório novo na pasta entra sozinho na próxima rodada.

  NÃO TEM SENHA AQUI. O login do Snowflake fica guardado pelo próprio Excel
  (na primeira vez que ele pedir, no seu computador).

  Uso:  powershell -NoProfile -ExecutionPolicy Bypass -File atualizar-relatorios.ps1 -Pasta "C:\...\Excel"
  O registro de cada rodada fica em  <Pasta>\_registro\atualizacao.log
  e o horário da última rodada boa em <Pasta>\_registro\ultima-atualizacao.txt
#>
param(
  [Parameter(Mandatory = $true)][string]$Pasta,
  [int]$MinutosMaximoPorArquivo = 20
)

$ErrorActionPreference = 'Stop'
$registro = Join-Path $Pasta '_registro'
New-Item -ItemType Directory -Force -Path $registro | Out-Null
$log = Join-Path $registro 'atualizacao.log'
function Anotar([string]$texto) {
  $linha = (Get-Date -Format 'dd/MM/yyyy HH:mm:ss') + '  ' + $texto
  Add-Content -Path $log -Value $linha -Encoding UTF8
  Write-Host $linha
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
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.AskToUpdateLinks = $false

  foreach ($arq in $arquivos) {
    $inicio = Get-Date
    $livro = $null
    try {
      $livro = $excel.Workbooks.Open($arq.FullName, 0, $false)
      if ($livro.ReadOnly) { throw 'arquivo aberto por outra pessoa/programa (somente leitura)' }

      # Atualização em segundo plano desligada: assim o "Atualizar tudo" só
      # devolve quando terminou de verdade, e o arquivo é salvo já com os dados novos.
      foreach ($c in $livro.Connections) {
        try { $c.OLEDBConnection.BackgroundQuery = $false } catch {}
        try { $c.ODBCConnection.BackgroundQuery = $false } catch {}
      }
      $livro.RefreshAll()
      $excel.CalculateUntilAsyncQueriesDone()

      if (((Get-Date) - $inicio).TotalMinutes -gt $MinutosMaximoPorArquivo) {
        Anotar ("AVISO " + $arq.Name + ": demorou mais de " + $MinutosMaximoPorArquivo + " min.")
      }
      $livro.Save()
      $ok++
      Anotar ("OK    " + $arq.Name + " (" + [int]((Get-Date) - $inicio).TotalSeconds + " s)")
    } catch {
      $falhas++
      Anotar ("ERRO  " + $arq.Name + ": " + $_.Exception.Message)
    } finally {
      if ($livro) { try { $livro.Close($false) } catch {}; [void][Runtime.InteropServices.Marshal]::ReleaseComObject($livro) }
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
    try { $excel.Quit() } catch {}
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
  }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
  $trava.ReleaseMutex()
}
if ($falhas -gt 0) { exit 1 } else { exit 0 }
