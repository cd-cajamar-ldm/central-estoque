/* Lê as planilhas fora da tela (a QRY0390 tem ~100 mil linhas) e devolve o
   painel já montado. Nada sai do navegador. */
importScripts('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
importScripts('./regras.js');

function linhasDe(buf){
  const wb = XLSX.read(buf, {type: 'array'});
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {header: 1, raw: true, defval: null});
}
const aviso = (texto, pct) => self.postMessage({tipo: 'progresso', texto, pct});

self.onmessage = e => {
  try {
    const {buf051, buf390, estrutura} = e.data;
    let pais;
    if (buf051){
      aviso('Lendo a ZBIQ0051…', 10);
      pais = EM_REGRAS.lerEstrutura(linhasDe(buf051));
    } else {
      pais = new Map(estrutura);
    }
    aviso('Lendo a QRY0390 (pode levar alguns segundos)…', 30);
    const estoque = EM_REGRAS.lerEstoque(linhasDe(buf390));
    aviso('Montando os conjuntos…', 85);
    const painel = EM_REGRAS.montar(pais, estoque);
    self.postMessage({tipo: 'pronto', painel, estrutura: [...pais.entries()]});
  } catch (err){
    self.postMessage({tipo: 'erro', texto: err.message || String(err)});
  }
};
