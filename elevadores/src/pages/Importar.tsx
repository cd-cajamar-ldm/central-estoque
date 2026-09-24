/* ============================================================
   Tela de importacao manual do Excel (secao 2 do brief).
   A automacao via Power Automate foi bloqueada pela TI, entao o
   import manual pelo navegador e o caminho definitivo.
   ============================================================ */
import { useRef, useState } from 'react';
import { Botao, Cartao } from '../components/ui';

export function Importar({
  aoImportar,
  aoVerExemplo,
  erro,
}: {
  aoImportar: (
    arquivo: File,
    fotos: File | null,
    precos: File | null,
    saldo390: File | null
  ) => Promise<unknown>;
  aoVerExemplo: () => void;
  erro: string | null;
}) {
  const refPlanilha = useRef<HTMLInputElement>(null);
  const refFotos = useRef<HTMLInputElement>(null);
  const refPrecos = useRef<HTMLInputElement>(null);
  const refSaldo390 = useRef<HTMLInputElement>(null);
  const [planilha, setPlanilha] = useState<File | null>(null);
  const [fotos, setFotos] = useState<File | null>(null);
  const [precos, setPrecos] = useState<File | null>(null);
  const [saldo390, setSaldo390] = useState<File | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [arrastando, setArrastando] = useState(false);

  async function processar() {
    if (!planilha) return;
    setOcupado(true);
    try {
      await aoImportar(planilha, fotos, precos, saldo390);
    } catch {
      // A mensagem ja aparece pela prop erro.
    } finally {
      setOcupado(false);
    }
  }

  function soltar(e: React.DragEvent) {
    e.preventDefault();
    setArrastando(false);
    const arquivo = e.dataTransfer.files?.[0];
    if (arquivo) setPlanilha(arquivo);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Cartao>
        <h2 className="text-lg">Importar a planilha de equalização</h2>
        <p className="mt-1.5 text-[13px]" style={{ color: 'var(--ink-soft)' }}>
          Selecione o arquivo <b>08. Equalização de Elevadores CD CAJAMAR.xlsx</b>. São lidas apenas
          as abas <b>Multiplos</b> e <b>Projeto</b>; as abas pesadas de estoque e cadastros são
          ignoradas para a leitura não travar. Nada sai do seu navegador.
        </p>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setArrastando(true);
          }}
          onDragLeave={() => setArrastando(false)}
          onDrop={soltar}
          className="mt-5 flex flex-col items-center gap-2 rounded-xl px-5 py-8 text-center transition-colors"
          style={{
            border: `1.5px ${planilha ? 'solid' : 'dashed'} ${
              planilha || arrastando ? 'var(--laranja)' : 'var(--line)'
            }`,
            background: planilha || arrastando ? 'rgba(250,70,22,.05)' : 'var(--surface-2)',
          }}
        >
          <div className="text-2xl" aria-hidden="true">
            📄
          </div>
          <div className="text-[13.5px] font-semibold" style={{ fontFamily: 'Poppins, sans-serif' }}>
            {planilha ? planilha.name : 'Arraste a planilha aqui'}
          </div>
          <div className="text-[11.5px]" style={{ color: 'var(--ink-soft)' }}>
            {planilha ? `${(planilha.size / 1024 / 1024).toFixed(1)} MB` : 'ou clique para escolher'}
          </div>
          <input
            ref={refPlanilha}
            type="file"
            accept=".xlsx,.xlsm"
            className="hidden"
            onChange={(e) => setPlanilha(e.target.files?.[0] ?? null)}
          />
          <div className="mt-2">
            <Botao variante="secundario" aoClicar={() => refPlanilha.current?.click()}>
              Escolher arquivo
            </Botao>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 text-[12.5px]">
          <span style={{ color: 'var(--ink-soft)' }}>
            Fotos dos produtos <i>(opcional)</i>:
          </span>
          <input
            ref={refFotos}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => setFotos(e.target.files?.[0] ?? null)}
          />
          <Botao variante="secundario" aoClicar={() => refFotos.current?.click()}>
            {fotos ? fotos.name : 'Escolher DE_PARA_LINK_FOTO.xlsx'}
          </Botao>
          {fotos && (
            <button
              onClick={() => setFotos(null)}
              className="text-[11.5px] underline"
              style={{ color: 'var(--ink-soft)' }}
            >
              remover
            </button>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-[12.5px]">
          <span style={{ color: 'var(--ink-soft)' }}>
            Valor unitário · QRY0390 <i>(opcional, para o R$ parado)</i>:
          </span>
          <input
            ref={refSaldo390}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => setSaldo390(e.target.files?.[0] ?? null)}
          />
          <Botao variante="secundario" aoClicar={() => refSaldo390.current?.click()}>
            {saldo390 ? saldo390.name : 'Escolher QRY0390.xlsx'}
          </Botao>
          {saldo390 && (
            <button
              onClick={() => setSaldo390(null)}
              className="text-[11.5px] underline"
              style={{ color: 'var(--ink-soft)' }}
            >
              remover
            </button>
          )}
        </div>
        <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-soft)' }}>
          É a extração avulsa da query (não a aba EstoqueAtual de dentro da planilha principal, essa
          continua fora). Arquivo grande — a leitura pode demorar alguns segundos.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-[12.5px]">
          <span style={{ color: 'var(--ink-soft)' }}>
            Preço de custo do pai · SIGEQ278 <i>(opcional, reserva quando a 390 não tiver o preço)</i>:
          </span>
          <input
            ref={refPrecos}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => setPrecos(e.target.files?.[0] ?? null)}
          />
          <Botao variante="secundario" aoClicar={() => refPrecos.current?.click()}>
            {precos ? precos.name : 'Escolher SIGEQ278.xlsx'}
          </Botao>
          {precos && (
            <button
              onClick={() => setPrecos(null)}
              className="text-[11.5px] underline"
              style={{ color: 'var(--ink-soft)' }}
            >
              remover
            </button>
          )}
        </div>

        {erro && (
          <p
            className="mt-4 rounded-lg px-3 py-2.5 text-[12.5px]"
            style={{ background: 'rgba(250,70,22,.1)', color: 'var(--laranja-escuro)' }}
            role="alert"
          >
            {erro}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Botao aoClicar={processar} desabilitado={!planilha || ocupado}>
            {ocupado ? 'Processando…' : 'Processar planilha'}
          </Botao>
          <span className="text-[12px]" style={{ color: 'var(--ink-soft)' }}>
            ou
          </span>
          <Botao variante="secundario" aoClicar={aoVerExemplo}>
            Ver com dados de exemplo
          </Botao>
        </div>
        <p className="mt-2 text-[11.5px]" style={{ color: 'var(--ink-soft)' }}>
          Os dados de exemplo servem só para conhecer as telas. Não são os números do CD.
        </p>
      </Cartao>
    </div>
  );
}
