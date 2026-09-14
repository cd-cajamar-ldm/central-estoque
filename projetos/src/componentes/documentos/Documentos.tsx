import { useEffect, useMemo, useRef, useState } from 'react';
import { Aviso, Campo, Carregando, Modal, Vazio } from '@/componentes/ui';
import { mensagemDeErro } from '@/estado/dados';
import { importarModulo } from '@/lib/importar';
import {
  anexarDocumentoGerado, excluirDocumento, proximoNumero, salvarDocumento, useDocumentos,
} from '@/estado/documentos';
import { usePaginas } from '@/estado/paginas';
import { montarBriefing, lerConteudoColado } from '@/dominio/briefing';
import { lerTextoCorrido } from '@/dominio/texto';
import { faltamCamposParaRascunho, montarRascunho } from '@/dominio/rascunho';
import {
  dataPorExtenso, documentoVazio, ESFORCOS, nomeDoArquivo,
} from '@/dominio/documento';
import type {
  DadosDoDocumento, Documento, ImagemDoDocumento, Par, PrioridadeDoDocumento, Trio,
} from '@/dominio/documento';
import { formatarData } from '@/dominio/regras';
import { urlDoAnexo } from '@/estado/dados';
import type { Anexo, Marco, Pessoa, Projeto, Tarefa } from '@/dominio/tipos';

interface Props {
  projeto: Projeto;
  pessoas: Pessoa[];
  marcos: Marco[];
  tarefas: Tarefa[];
  anexos: Anexo[];
  /* O documento gerado entra na lista de anexos; sem recarregar, a
     secao de cima continuaria dizendo que nao ha nada. */
  recarregarAnexos: () => Promise<void>;
}

/* Listas e tabelas do documento sao editadas como texto: uma linha por
   item, colunas separadas por barra. Um editor de linhas com botoes
   custaria muito mais codigo e seria mais lento de preencher do que
   digitar ou colar direto. */
const paraLinhas = (itens: string[]) => itens.join('\n');
const dasLinhas = (texto: string) => texto.split('\n').map((l) => l.trim()).filter(Boolean);

const paraPares = (itens: Par[]) => itens.map((i) => `${i.a} | ${i.b}`).join('\n');
const dosPares = (texto: string): Par[] => dasLinhas(texto).map((l) => {
  const [a, ...resto] = l.split('|');
  return { a: a.trim(), b: resto.join('|').trim() };
});

const paraTrios = (itens: Trio[]) => itens.map((i) => `${i.a} | ${i.b} | ${i.c}`).join('\n');
const dosTrios = (texto: string): Trio[] => dasLinhas(texto).map((l) => {
  const [a, b, ...resto] = l.split('|');
  return { a: (a ?? '').trim(), b: (b ?? '').trim(), c: resto.join('|').trim() };
});

function baixar(blob: Blob, nome: string) {
  const endereco = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = endereco;
  link.download = nome;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(endereco);
}

export default function Documentos({
  projeto, pessoas, marcos, tarefas, anexos, recarregarAnexos,
}: Props) {
  const carteira = useDocumentos(projeto.id);
  const carteiraDePaginas = usePaginas(projeto.id);
  const [editando, setEditando] = useState<Documento | 'novo' | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function novo() {
    setErro(null);
    try {
      setEditando('novo');
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }

  async function remover(d: Documento) {
    if (!confirm(`Excluir o documento ${String(d.numero).padStart(2, '0')} "${d.titulo}"?`)) return;
    try {
      await excluirDocumento(d.id);
      await carteira.recarregar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }

  if (editando) {
    return (
      <Formulario
        projeto={projeto} pessoas={pessoas} marcos={marcos} tarefas={tarefas} anexos={anexos}
        recarregarAnexos={recarregarAnexos}
        paginas={carteiraDePaginas.paginas}
        documento={editando === 'novo' ? null : editando}
        aoFechar={() => setEditando(null)}
        aoSalvar={carteira.recarregar}
      />
    );
  }

  return (
    <section data-guia="documentos" className="cartao overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-linha px-4 py-3">
        <h2 className="font-titulo text-sm font-extrabold">
          Documentos {carteira.documentos.length > 0 && <span className="text-tinta-suave">({carteira.documentos.length})</span>}
        </h2>
        <button className="botao-primario" onClick={() => void novo()}>Criar documento</button>
      </div>

      {(erro || carteira.erro) && <div className="p-4"><Aviso>{erro ?? carteira.erro}</Aviso></div>}

      {carteira.carregando ? <Carregando /> : !carteira.documentos.length ? (
        <Vazio>
          Nenhuma proposta gerada. O documento sai no padrão Bseller: capa, 15 seções,
          cabeçalho, rodapé e nome de arquivo numerado.
        </Vazio>
      ) : (
        <ul className="divide-y divide-linha">
          {carteira.documentos.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="rounded bg-papel px-2 py-1 text-xs font-extrabold text-roxo-escuro">
                {String(d.numero).padStart(2, '0')}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{d.titulo}</p>
                <p className="truncate text-xs text-tinta-suave">
                  {d.subtitulo || 'sem subtítulo'} · atualizado em {formatarData(d.atualizado_em)}
                  {d.gerado_por && ` por ${d.gerado_por}`}
                </p>
              </div>
              <button className="botao-neutro py-1 text-xs" onClick={() => setEditando(d)}>Abrir</button>
              <button className="text-xs font-bold text-vermelho" onClick={() => void remover(d)}>Excluir</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ---------------- Formulário (o questionário) ---------------- */

/* O que fica guardado no navegador entre uma sessão e outra. */
interface RascunhoLocal {
  quando: string;
  autor: string;
  dados: DadosDoDocumento;
  /* O texto do pedido tambem se perde ao fechar a aba, e reescrever
     dele e o trabalho maior. */
  texto?: string;
}

interface PropsDoFormulario extends Props {
  paginas: ReturnType<typeof usePaginas>['paginas'];
  documento: Documento | null;
  aoFechar: () => void;
  aoSalvar: () => Promise<void>;
}

function Formulario({
  projeto, pessoas, marcos, tarefas, anexos, paginas, documento, aoFechar, aoSalvar,
  recarregarAnexos,
}: PropsDoFormulario) {
  const [dados, setDados] = useState<DadosDoDocumento | null>(null);
  const [id, setId] = useState<string | undefined>(documento?.id);
  const [autor, setAutor] = useState(documento?.gerado_por ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [colando, setColando] = useState(false);
  const [textoColado, setTextoColado] = useState('');
  const [textoDoPedido, setTextoDoPedido] = useState('');
  const [mapaDoTexto, setMapaDoTexto] = useState<{ titulo: string; destino: string }[]>([]);
  const [faltandoNoTexto, setFaltandoNoTexto] = useState<string[]>([]);

  /* Rascunho no proprio navegador.

     O formulario e longo e so vira registro no banco quando alguem
     clica em salvar ou gerar. Ate ali, fechar a aba, cair a internet ou
     dar erro na geracao levava embora tudo o que foi digitado — foi o
     que aconteceu na primeira proposta escrita de verdade.

     Guardar a cada tecla no localStorage e barato e resolve: ao voltar,
     a tela oferece o que ficou pela metade em vez de abrir em branco.
     Fica no navegador de quem escreveu, nao no banco: e trabalho ainda
     nao entregue, e nao deveria aparecer para a equipe. */
  const chaveDoRascunho = useMemo(
    () => `projetos.rascunho-documento.${projeto.id}.${documento?.id ?? 'novo'}`,
    [projeto.id, documento?.id],
  );
  const guardadoAoAbrir = useRef<RascunhoLocal | null>(null);
  const [rascunhoLido, setRascunhoLido] = useState(false);
  const [oferta, setOferta] = useState<RascunhoLocal | null>(null);

  const imagensDisponiveis = useMemo(
    () => anexos.filter((a) => a.tipo_mime?.startsWith('image/')),
    [anexos],
  );
  const fluxosDisponiveis = useMemo(
    () => paginas.flatMap((p) => p.blocos
      .filter((b) => b.tipo === 'fluxo')
      .map((b, i) => ({ titulo: `${p.titulo}${i ? ` (${i + 1})` : ''}`, codigo: b.conteudo }))),
    [paginas],
  );

  /* Documento novo nasce com o que o projeto ja sabe: titulo, area,
     prioridade, marcos viram fases de implantacao. */
  useEffect(() => {
    let vivo = true;
    (async () => {
      if (documento) { setDados(documento.dados); return; }
      const numero = await proximoNumero().catch(() => 1);
      if (!vivo) return;
      const base = documentoVazio(numero);
      setDados({
        ...base,
        titulo: projeto.nome,
        categoria: projeto.area ?? '',
        data: dataPorExtenso(new Date()),
        prioridade: (projeto.prioridade === 'critica' || projeto.prioridade === 'alta'
          ? 'ALTA'
          : projeto.prioridade === 'baixa' ? 'BAIXA' : 'MÉDIA') as PrioridadeDoDocumento,
        /* O chamado e o vinculo com o BSeller: quem le a proposta
           precisa saber a qual pedido ela responde. */
        documento_relacionado: [
          projeto.chamado ? `Chamado BSeller #${projeto.chamado.replace(/^#/, '')}` : '',
          projeto.ticket_jira ? `Jira ${projeto.ticket_jira}` : '',
        ].filter(Boolean).join(' · '),
        rollout: marcos.map((m, i) => ({
          a: `Fase ${i + 1} | ${m.nome}`,
          b: m.data_prevista ? `Previsto para ${formatarData(m.data_prevista)}` : 'Data a definir',
        })),
      });
    })();
    return () => { vivo = false; };
  }, [documento, projeto, marcos]);

  useEffect(() => {
    try {
      const cru = localStorage.getItem(chaveDoRascunho);
      guardadoAoAbrir.current = cru ? (JSON.parse(cru) as RascunhoLocal) : null;
    } catch {
      guardadoAoAbrir.current = null;
    }
    setRascunhoLido(true);
  }, [chaveDoRascunho]);

  /* A oferta so aparece se o guardado for diferente do que esta na tela:
     rascunho igual ao salvo nao e novidade nenhuma. */
  useEffect(() => {
    if (!rascunhoLido || !dados) return;
    const guardado = guardadoAoAbrir.current;
    guardadoAoAbrir.current = null;
    if (guardado && JSON.stringify(guardado.dados) !== JSON.stringify(dados)) setOferta(guardado);
  }, [rascunhoLido, dados]);

  useEffect(() => {
    if (!rascunhoLido || !dados) return;
    try {
      localStorage.setItem(chaveDoRascunho, JSON.stringify({
        quando: new Date().toISOString(), autor, dados, texto: textoDoPedido,
      } satisfies RascunhoLocal));
    } catch {
      /* Sem espaco ou modo anonimo: o formulario continua funcionando,
         so nao ha rede de seguranca. */
    }
  }, [dados, autor, textoDoPedido, chaveDoRascunho, rascunhoLido]);

  function esquecerRascunho() {
    try { localStorage.removeItem(chaveDoRascunho); } catch { /* nada a fazer */ }
  }

  if (!dados) return <div className="cartao"><Carregando /></div>;

  const mudar = (campo: keyof DadosDoDocumento, valor: unknown) =>
    setDados((atual) => (atual ? { ...atual, [campo]: valor } : atual));

  async function copiarBriefing() {
    const texto = montarBriefing(
      projeto, pessoas, marcos, tarefas, anexos, paginas, dados!.numero, dados!.objetivo,
    );
    try {
      await navigator.clipboard.writeText(texto);
      setAviso('Briefing copiado. Cole no chat, peça o conteúdo e volte com "Colar conteúdo".');
      setErro(null);
    } catch {
      /* Área de transferência bloqueada (navegador antigo, sem HTTPS):
         o texto ainda precisa chegar à pessoa de alguma forma. */
      setTextoColado(texto);
      setColando(true);
      setAviso('Copie o texto da caixa e cole no chat.');
    }
  }

  function gerarRascunho() {
    const faltando = faltamCamposParaRascunho(dados!);
    if (faltando.length) {
      setErro(`Antes do rascunho, preencha: ${faltando.join(', ')}.`);
      setAviso(null);
      return;
    }
    setDados(montarRascunho(dados!, { projeto, marcos, tarefas }));
    setErro(null);
    setAviso('Rascunho montado. Revise as seções antes de gerar o Word.');
  }

  /* Preenche o documento a partir do texto corrido e completa o resto
     com as mesmas regras do "Gerar rascunho": o que o texto nao disser
     fica marcado como a definir, nunca inventado. */
  function aplicarTexto(): DadosDoDocumento | null {
    try {
      const { dados: lido, mapa } = lerTextoCorrido(textoDoPedido, dados!);
      /* O que o texto nao deu sai no Word como "a definir". Avisar aqui
         e o que evita descobrir isso so depois de abrir o arquivo. */
      const faltando = faltamCamposParaRascunho(lido);
      const completo = montarRascunho(lido, { projeto, marcos, tarefas });
      setDados(completo);
      setMapaDoTexto(mapa);
      setErro(null);
      setFaltandoNoTexto(faltando);
      setAviso(faltando.length
        ? null
        : 'Documento preenchido a partir do texto. Confira as seções abaixo antes de gerar.');
      return completo;
    } catch (falha) {
      setErro(mensagemDeErro(falha));
      setAviso(null);
      setFaltandoNoTexto([]);
      return null;
    }
  }

  async function aplicarTextoEGerar() {
    const completo = aplicarTexto();
    if (completo) await gerar(completo);
  }

  function aplicarConteudo() {
    try {
      setDados(lerConteudoColado(textoColado, dados!));
      setColando(false);
      setTextoColado('');
      setAviso('Conteúdo aplicado. Confira os campos antes de gerar.');
      setErro(null);
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }

  async function salvar(base?: DadosDoDocumento): Promise<string | undefined> {
    setOcupado('salvando');
    setErro(null);
    try {
      const salvo = await salvarDocumento(projeto.id, base ?? dados!, autor || null, id);
      setId(salvo);
      await aoSalvar();
      /* Guardado no banco, o rascunho local perdeu a serventia. */
      esquecerRascunho();
      setAviso('Documento salvo.');
      return salvo;
    } catch (falha) {
      setErro(mensagemDeErro(falha));
      return undefined;
    } finally {
      setOcupado(null);
    }
  }

  async function gerar(base?: DadosDoDocumento) {
    /* Os dados podem chegar por parametro porque "Preencher e gerar"
       monta o documento e gera na mesma acao: o estado do React so
       estaria atualizado no proximo desenho da tela. */
    const atual = base ?? dados!;
    if (!atual.titulo.trim()) { setErro('O documento precisa de um título.'); return; }
    setOcupado('gerando');
    setErro(null);
    try {
      /* Salvar antes de gerar: se a geracao falhar (imagem que nao baixa,
         versao nova do app na aba antiga), o que foi preenchido nao se
         perde junto. */
      const documentoId = await salvar(atual);
      if (!documentoId) return;
      setOcupado('gerando');

      const [{ gerarDocumentoWord }, { baixarImagem, fluxogramaEmPng }] = await Promise.all([
        importarModulo(() => import('@/exportar/documentoWord')),
        importarModulo(() => import('@/lib/imagensParaWord')),
      ]);

      const recursos: { logo?: Awaited<ReturnType<typeof baixarImagem>>; imagens: Record<string, Awaited<ReturnType<typeof baixarImagem>>> } = { imagens: {} };
      /* O logo da capa e o da marca em fundo claro; falha ao baixar nao
         impede a geracao, so tira a imagem do documento. */
      recursos.logo = await baixarImagem('./brand/Logo_LDM_hor_2.png').catch(() => undefined);

      for (const img of atual.imagens) {
        const baixada = await baixarImagem(img.url).catch(() => undefined);
        if (baixada) recursos.imagens[img.url] = baixada;
      }
      for (const fluxo of atual.fluxogramas) {
        const desenho = await fluxogramaEmPng(fluxo.codigo).catch(() => undefined);
        if (desenho) recursos.imagens[`fluxo:${fluxo.titulo}`] = desenho;
      }

      const { blob, nome } = await gerarDocumentoWord(atual, recursos);
      baixar(blob, nome);

      /* O arquivo tambem fica guardado na atividade, sempre no mesmo
         lugar: gerar de novo substitui a versao anterior. */
      try {
        await anexarDocumentoGerado(projeto.id, documentoId, blob, nome, autor || null);
        await recarregarAnexos();
        setAviso(`Documento salvo, baixado e anexado à atividade como ${nome}.`);
      } catch (falhaNoAnexo) {
        setAviso(null);
        setErro(`O Word foi gerado e baixado, mas não consegui anexá-lo: ${mensagemDeErro(falhaNoAnexo)}`);
      }
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setOcupado(null);
    }
  }

  const trocarImagem = (url: string, secao: string) => {
    const outras = dados!.imagens.filter((i) => i.url !== url);
    if (!secao) { mudar('imagens', outras); return; }
    const anexo = imagensDisponiveis.find((a) => urlDoAnexo(a.caminho) === url);
    const nova: ImagemDoDocumento = {
      url,
      legenda: anexo?.legenda ?? anexo?.nome_arquivo ?? '',
      secao: secao as ImagemDoDocumento['secao'],
    };
    mudar('imagens', [...outras, nova]);
  };

  return (
    <section className="cartao overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-linha px-4 py-3">
        <h2 className="font-titulo text-sm font-extrabold">
          Documento {String(dados.numero).padStart(2, '0')} · Proposta de Melhoria Sistêmica
        </h2>
        <div className="flex flex-wrap gap-2">
          <button className="botao-neutro" onClick={aoFechar}>Fechar</button>
          <button className="botao-neutro" onClick={() => void salvar()} disabled={!!ocupado}>
            {ocupado === 'salvando' ? 'Salvando…' : 'Salvar'}
          </button>
          <button className="botao-primario" onClick={() => void gerar()} disabled={!!ocupado}>
            {ocupado === 'gerando' ? 'Gerando…' : 'Gerar Word e anexar'}
          </button>
        </div>
      </div>

      <div className="space-y-5 p-4">
        {/* O que ficou pela metade na última vez: oferecido, nunca
            aplicado sozinho — sobrescrever o que está na tela sem
            perguntar seria pior do que a perda que isto evita. */}
        {oferta && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-ambar bg-ambar/10 px-3 py-2">
            <p className="flex-1 text-sm">
              <strong>Há um rascunho não salvo</strong> deste documento, de{' '}
              {new Date(oferta.quando).toLocaleString('pt-BR')}
              {oferta.autor && ` (${oferta.autor})`}. Ele ficou guardado neste navegador.
            </p>
            <button
              className="botao-primario py-1 text-xs"
              onClick={() => {
                setDados(oferta.dados);
                if (oferta.texto) setTextoDoPedido(oferta.texto);
                if (oferta.autor) setAutor(oferta.autor);
                setOferta(null);
                setAviso('Rascunho recuperado. Confira antes de salvar.');
              }}
            >Recuperar</button>
            <button
              className="text-xs font-bold text-tinta-suave hover:text-vermelho"
              onClick={() => { esquecerRascunho(); setOferta(null); }}
            >Descartar</button>
          </div>
        )}

        <div className="rounded-xl border border-linha bg-papel p-3">
          <p className="text-sm font-bold text-navy">Escrever de um texto só</p>
          <p className="mt-1 text-xs text-tinta-suave">
            Cole aqui o pedido do jeito que você escreveria no chamado, com os títulos de sempre
            (<em>Objetivo, Comportamento atual, Comportamento esperado, Justificativa</em>…). Cada
            bloco entra na seção correspondente do documento, as listas viram itens e o que sobrar
            fica nas regras de negócio, com o título original na frente. Não precisa de JSON.
          </p>
          <textarea
            rows={8} className="campo mt-2 text-sm" value={textoDoPedido}
            onChange={(e) => setTextoDoPedido(e.target.value)}
            placeholder={'Solicitamos a inclusão de quatro novas colunas na consulta QRY0730.\n\nObjetivo da melhoria:\n...\n\nComportamento atual:\n...\n\nComportamento esperado:\n...\n\nJustificativa:\n...'}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button className="botao-neutro py-1 text-xs" onClick={() => aplicarTexto()} disabled={!textoDoPedido.trim() || !!ocupado}>
              Preencher com este texto
            </button>
            <button className="botao-primario py-1 text-xs" onClick={() => void aplicarTextoEGerar()} disabled={!textoDoPedido.trim() || !!ocupado}>
              {ocupado === 'gerando' ? 'Gerando…' : 'Preencher e gerar Word'}
            </button>
          </div>
          {/* Onde cada trecho foi parar: sem isto, quem cola o texto so
              descobre o destino de cada bloco abrindo o Word. */}
          {mapaDoTexto.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1">
              {mapaDoTexto.map((m, i) => (
                <li key={`${m.titulo}-${i}`} className="rounded-full bg-white px-2 py-0.5 text-[11px] text-tinta-suave">
                  {m.titulo || 'Abertura'} <span aria-hidden>»</span> <strong className="text-navy">{m.destino}</strong>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-linha bg-papel p-3">
          <p className="text-sm font-bold text-navy">Montar o documento a partir do objetivo</p>
          <p className="mt-1 text-xs text-tinta-suave">
            Preencha <strong>objetivo</strong>, <strong>dor atual</strong>, <strong>o que muda</strong> e
            o <strong>problema central</strong>. O botão abaixo escreve as demais seções recombinando
            esses textos e o que o projeto já tem: ganhos, impactos, riscos, critérios de aceite,
            KPIs, rollout, ROI e resumo executivo. Onde não há base, deixa marcado como a definir.
            Nada do que você já escreveu é sobrescrito.
          </p>
          <div className="mt-2">
            <button className="botao-primario py-1 text-xs" onClick={gerarRascunho}>Gerar rascunho</button>
          </div>
        </div>

        <div className="rounded-xl border border-roxo-claro bg-roxo-suave p-3">
          <p className="text-sm font-bold text-roxo-escuro">Escrever com ajuda do chat (opcional)</p>
          <p className="mt-1 text-xs text-tinta-suave">
            Preencha o objetivo abaixo, clique em <strong>Copiar briefing</strong> e cole no chat.
            O texto já leva marcos, tarefas, anexos e páginas deste projeto. Depois volte com
            <strong> Colar conteúdo</strong> e confira os campos.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="botao-neutro py-1 text-xs" onClick={() => void copiarBriefing()}>Copiar briefing</button>
            <button className="botao-neutro py-1 text-xs" onClick={() => { setTextoColado(''); setColando(true); }}>Colar conteúdo</button>
          </div>
        </div>

        {faltandoNoTexto.length > 0 && (
          <Aviso tipo="atencao">
            Preenchido, mas o texto não trouxe <strong>{faltandoNoTexto.join(', ')}</strong>.
            Essas seções saem como “a definir” no Word. Escreva nos campos abaixo, ou cole o texto
            de novo usando os títulos (<em>Objetivo, Comportamento atual, Comportamento esperado</em>).
          </Aviso>
        )}
        {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
        {erro && <Aviso>{erro}</Aviso>}

        <Bloco titulo="A. Identificação">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Campo rotulo="Número"><input type="number" className="campo" value={dados.numero} onChange={(e) => mudar('numero', Number(e.target.value))} /></Campo>
            <Campo rotulo="Categoria"><input className="campo" value={dados.categoria} onChange={(e) => mudar('categoria', e.target.value)} /></Campo>
            <Campo rotulo="Versão"><input className="campo" value={dados.versao} onChange={(e) => mudar('versao', e.target.value)} /></Campo>
            <Campo rotulo="Status"><input className="campo" value={dados.status} onChange={(e) => mudar('status', e.target.value)} /></Campo>
          </div>
          <Campo rotulo="Título da melhoria *"><input className="campo" value={dados.titulo} onChange={(e) => mudar('titulo', e.target.value)} /></Campo>
          <Campo rotulo="Subtítulo técnico"><input className="campo" value={dados.subtitulo} onChange={(e) => mudar('subtitulo', e.target.value)} /></Campo>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Elaborado por"><input className="campo" value={dados.elaborado_por} onChange={(e) => mudar('elaborado_por', e.target.value)} /></Campo>
            <Campo rotulo="Destinatário"><input className="campo" value={dados.destinatario} onChange={(e) => mudar('destinatario', e.target.value)} /></Campo>
            <Campo rotulo="Data"><input className="campo" value={dados.data} onChange={(e) => mudar('data', e.target.value)} /></Campo>
            <Campo rotulo="Documento relacionado"><input className="campo" value={dados.documento_relacionado} onChange={(e) => mudar('documento_relacionado', e.target.value)} /></Campo>
          </div>
          <Campo rotulo="Contexto especial (fica só no corpo, nunca na capa)">
            <input className="campo" value={dados.contexto_especial} onChange={(e) => mudar('contexto_especial', e.target.value)} />
          </Campo>
        </Bloco>

        <Bloco titulo="B. Essência da melhoria">
          <Campo rotulo="Objetivo *"><textarea rows={3} className="campo" value={dados.objetivo} onChange={(e) => mudar('objetivo', e.target.value)} /></Campo>
          <Campo rotulo="Dor atual, o AS IS *"><textarea rows={3} className="campo" value={dados.dor} onChange={(e) => mudar('dor', e.target.value)} /></Campo>
          <Campo rotulo="O que muda, o TO BE *"><textarea rows={3} className="campo" value={dados.to_be} onChange={(e) => mudar('to_be', e.target.value)} /></Campo>
          <Campo rotulo="Problema central em uma frase *"><input className="campo" value={dados.problema_central} onChange={(e) => mudar('problema_central', e.target.value)} /></Campo>
          <Lista rotulo="Ganho direto (dimensão | ganho)" valor={paraPares(dados.ganhos)} aoMudar={(t) => mudar('ganhos', dosPares(t))} />
          <Campo rotulo="Exemplo prático"><textarea rows={3} className="campo" value={dados.exemplo_pratico} onChange={(e) => mudar('exemplo_pratico', e.target.value)} /></Campo>
        </Bloco>

        <Bloco titulo="C. Regras e fluxo">
          <Lista rotulo="Regras de negócio (uma por linha)" valor={paraLinhas(dados.regras_negocio)} aoMudar={(t) => mudar('regras_negocio', dasLinhas(t))} />
          <Lista rotulo="Pontos em aberto (um por linha)" valor={paraLinhas(dados.pontos_aberto)} aoMudar={(t) => mudar('pontos_aberto', dasLinhas(t))} />
          <Lista rotulo="Fluxo (etapa | como é hoje | como fica)" valor={paraTrios(dados.fluxo)} aoMudar={(t) => mudar('fluxo', dosTrios(t))} />
        </Bloco>

        <Bloco titulo="D. Consequências">
          <Lista rotulo="Impactos esperados (dimensão | descrição)" valor={paraPares(dados.impactos)} aoMudar={(t) => mudar('impactos', dosPares(t))} />
          <Lista rotulo="Riscos e dependências (item | descrição)" valor={paraPares(dados.riscos)} aoMudar={(t) => mudar('riscos', dosPares(t))} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Esforço">
              <select className="campo" value={dados.esforco} onChange={(e) => mudar('esforco', e.target.value)}>
                {ESFORCOS.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            </Campo>
            <Campo rotulo="Prioridade">
              <select className="campo" value={dados.prioridade} onChange={(e) => mudar('prioridade', e.target.value)}>
                <option value="ALTA">Alta</option>
                <option value="MÉDIA">Média</option>
                <option value="BAIXA">Baixa</option>
              </select>
            </Campo>
          </div>
          <Campo rotulo="Justificativa do esforço"><textarea rows={2} className="campo" value={dados.esforco_justificativa} onChange={(e) => mudar('esforco_justificativa', e.target.value)} /></Campo>
          <Campo rotulo="Justificativa da prioridade"><textarea rows={2} className="campo" value={dados.prioridade_justificativa} onChange={(e) => mudar('prioridade_justificativa', e.target.value)} /></Campo>
        </Bloco>

        <Bloco titulo="E. Validação e resultado">
          <Lista rotulo="Critérios de aceite (um por linha)" valor={paraLinhas(dados.criterios_aceite)} aoMudar={(t) => mudar('criterios_aceite', dasLinhas(t))} />
          <Lista rotulo="Cenários de validação (um por linha)" valor={paraLinhas(dados.cenarios_validacao)} aoMudar={(t) => mudar('cenarios_validacao', dasLinhas(t))} />
          <Lista rotulo="KPIs (indicador | meta TO BE)" valor={paraPares(dados.kpis)} aoMudar={(t) => mudar('kpis', dosPares(t))} />
          <Lista rotulo="Rollout (fase | atividades)" valor={paraPares(dados.rollout)} aoMudar={(t) => mudar('rollout', dosPares(t))} />
          <Lista rotulo="ROI (um ganho por linha)" valor={paraLinhas(dados.roi_bullets)} aoMudar={(t) => mudar('roi_bullets', dasLinhas(t))} />
          <Campo rotulo="Fechamento do ROI"><textarea rows={2} className="campo" value={dados.roi_fechamento} onChange={(e) => mudar('roi_fechamento', e.target.value)} /></Campo>
          <Campo rotulo="Resumo executivo"><textarea rows={4} className="campo" value={dados.resumo_executivo} onChange={(e) => mudar('resumo_executivo', e.target.value)} /></Campo>
        </Bloco>

        <Bloco titulo="F. Material visual do projeto">
          {imagensDisponiveis.length ? (
            <div className="space-y-2">
              <p className="rotulo">Prints e fotos dos anexos</p>
              {imagensDisponiveis.map((a) => {
                const url = urlDoAnexo(a.caminho);
                const atual = dados.imagens.find((i) => i.url === url);
                return (
                  <div key={a.id} className="flex items-center gap-3">
                    <img src={url} alt="" className="h-10 w-14 rounded border border-linha object-cover" />
                    <span className="min-w-0 flex-1 truncate text-sm">{a.legenda || a.nome_arquivo}</span>
                    <select
                      className="campo w-40 py-1 text-xs" value={atual?.secao ?? ''}
                      onChange={(e) => trocarImagem(url, e.target.value)}
                    >
                      <option value="">Não incluir</option>
                      <option value="as_is">Seção 3 | AS IS</option>
                      <option value="to_be">Seção 5 | TO BE</option>
                      <option value="anexo">Anexos, no fim</option>
                    </select>
                  </div>
                );
              })}
            </div>
          ) : <p className="text-xs text-tinta-suave">Nenhuma imagem nos anexos deste projeto.</p>}

          {fluxosDisponiveis.length > 0 && (
            <div className="mt-3 space-y-1">
              <p className="rotulo">Fluxogramas das páginas</p>
              {fluxosDisponiveis.map((f) => (
                <label key={f.titulo} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={dados.fluxogramas.some((x) => x.titulo === f.titulo)}
                    onChange={(e) => mudar('fluxogramas', e.target.checked
                      ? [...dados.fluxogramas, f]
                      : dados.fluxogramas.filter((x) => x.titulo !== f.titulo))}
                  />
                  {f.titulo}
                </label>
              ))}
              <p className="text-[11px] text-tinta-suave">O desenho vira imagem na seção 7 do documento.</p>
            </div>
          )}
        </Bloco>

        <div className="flex flex-wrap items-end justify-between gap-3 border-t border-linha pt-4">
          <Campo rotulo="Gerado por">
            <select className="campo w-56" value={autor} onChange={(e) => setAutor(e.target.value)}>
              <option value="">Não informado</option>
              {pessoas.map((p) => <option key={p.id} value={p.nome}>{p.nome}</option>)}
            </select>
          </Campo>
          <p className="text-xs text-tinta-suave">
            Arquivo: <strong>{nomeDoArquivo(dados)}</strong>
          </p>
        </div>
      </div>

      <Modal aberto={colando} aoFechar={() => setColando(false)} titulo="Conteúdo vindo do chat" largura="max-w-2xl">
        <p className="mb-2 text-xs text-tinta-suave">
          Cole aqui o JSON que o chat devolveu. Os campos preenchidos substituem os atuais;
          número, imagens e fluxogramas continuam como estão.
        </p>
        <textarea
          rows={12} className="campo font-mono text-xs" value={textoColado}
          onChange={(e) => setTextoColado(e.target.value)}
        />
        <div className="mt-3 flex justify-end gap-2">
          <button className="botao-neutro" onClick={() => setColando(false)}>Cancelar</button>
          <button className="botao-primario" onClick={aplicarConteudo}>Aplicar</button>
        </div>
      </Modal>
    </section>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-xl border border-linha p-3">
      <h3 className="font-titulo text-sm font-extrabold text-navy">{titulo}</h3>
      {children}
    </div>
  );
}

/* Campo de varias linhas que vira lista.

   O valor que chega ja passou pela conversao texto -> lista -> texto, e
   essa volta apara espacos e joga fora linha vazia. Ligado direto no
   textarea, o espaco sumia no instante em que era digitado: "Tela no
   bseller" virava "Telanobseller".

   Enquanto o campo esta em foco vale o texto de quem digita; o valor de
   fora so entra quando ninguem esta escrevendo — que e o caso de "Gerar
   rascunho" e "Colar conteudo". Ao sair, o texto arrumado assume. */
function Lista({ rotulo, valor, aoMudar }: { rotulo: string; valor: string; aoMudar: (t: string) => void }) {
  const [texto, setTexto] = useState(valor);
  const escrevendo = useRef(false);

  useEffect(() => { if (!escrevendo.current) setTexto(valor); }, [valor]);

  return (
    <Campo rotulo={rotulo}>
      <textarea
        rows={Math.min(10, Math.max(3, texto.split('\n').length + 1))}
        className="campo" value={texto}
        onFocus={() => { escrevendo.current = true; }}
        onBlur={() => { escrevendo.current = false; setTexto(valor); }}
        onChange={(e) => { setTexto(e.target.value); aoMudar(e.target.value); }}
      />
    </Campo>
  );
}
