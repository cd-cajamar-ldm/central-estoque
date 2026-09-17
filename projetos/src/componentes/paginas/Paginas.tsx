import { useEffect, useMemo, useRef, useState } from 'react';
import EditorTexto from './EditorTexto';
import Fluxograma from './Fluxograma';
import { Aviso, Carregando, Modal, Selo, Vazio } from '@/componentes/ui';
import { coresStatusPagina } from '@/config/tokens';
import { mensagemDeErro } from '@/estado/dados';
import {
  alterarStatusDaPagina, blocoVazio, criarPagina, excluirPagina, listarVersoes,
  salvarPagina, usePaginas,
} from '@/estado/paginas';
import { limparHtml } from '@/lib/html';
import { nomeDoArquivoHtml, paginaParaHtml } from '@/exportar/paginaHtml';
import { formatarData } from '@/dominio/regras';
import type { Bloco, Pagina, Pessoa, StatusPagina, VersaoDePagina } from '@/dominio/tipos';
import { STATUS_PAGINA, rotuloStatusPagina } from '@/dominio/tipos';

/* A pagina vira um arquivo que abre em qualquer navegador: e assim que
   ela chega a quem nao tem login aqui (fornecedor, time do BSeller). O
   texto e os fluxogramas vao no mesmo arquivo, na ordem em que foram
   escritos — o fluxo desenhado em SVG, e o print colado dentro dele. */
function baixarHtml(html: string, nome: string) {
  const endereco = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = endereco;
  link.download = nome;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(endereco);
}

interface Props {
  projetoId: string;
  pessoas: Pessoa[];
}

export default function Paginas({ projetoId, pessoas }: Props) {
  const carteira = usePaginas(projetoId);
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [titulo, setTitulo] = useState('');
  const [blocos, setBlocos] = useState<Bloco[]>([]);
  const [autor, setAutor] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [versoes, setVersoes] = useState<VersaoDePagina[] | null>(null);
  /* Pagina recem-criada ja abre em edicao: quem clicou em "Nova pagina"
     nao devia ter de clicar em "Editar" logo em seguida. Sem esta
     marca, o efeito que roda quando a pagina termina de carregar
     desligava a edicao no mesmo instante. */
  const recemCriada = useRef<string | null>(null);

  const aberta = useMemo(
    () => carteira.paginas.find((p) => p.id === abertaId) ?? null,
    [carteira.paginas, abertaId],
  );

  /* A primeira pagina abre sozinha: cair numa lista com uma linha so e
     ter de clicar nela e passo a toa. */
  useEffect(() => {
    if (!abertaId && carteira.paginas.length) setAbertaId(carteira.paginas[0].id);
  }, [carteira.paginas, abertaId]);

  useEffect(() => {
    if (!aberta) return;
    setTitulo(aberta.titulo);
    setBlocos(aberta.blocos?.length ? aberta.blocos : [blocoVazio('texto')]);
    const nascendo = recemCriada.current === aberta.id;
    recemCriada.current = null;
    setEditando(nascendo);
  }, [aberta?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const sujo = !!aberta && (titulo !== aberta.titulo || JSON.stringify(blocos) !== JSON.stringify(aberta.blocos));

  async function nova() {
    try {
      const pagina = await criarPagina(projetoId, carteira.paginas.length);
      recemCriada.current = pagina.id;
      await carteira.recarregar();
      setAbertaId(pagina.id);
      setEditando(true);
      setTitulo(pagina.titulo);
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }

  async function salvar() {
    if (!aberta) return;
    setSalvando(true);
    setErro(null);
    try {
      await salvarPagina(aberta, titulo.trim() || 'Sem título', blocos, autor || null);
      await carteira.recarregar();
      setEditando(false);
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(p: Pagina) {
    if (!confirm(`Excluir a página "${p.titulo}"? O texto e o histórico dela vão junto.`)) return;
    try {
      await excluirPagina(p.id);
      setAbertaId(null);
      await carteira.recarregar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }

  async function trocarStatus(status: StatusPagina) {
    if (!aberta) return;
    try {
      await alterarStatusDaPagina(aberta.id, status);
      await carteira.recarregar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }

  async function abrirHistorico() {
    if (!aberta) return;
    try {
      setVersoes(await listarVersoes(aberta.id));
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }

  /* Compartilha o que esta na tela, e nao o que esta no banco: quem
     acabou de escrever espera mandar o que acabou de escrever. */
  function compartilhar() {
    if (!aberta) return;
    const html = paginaParaHtml({
      titulo: titulo.trim() || aberta.titulo,
      blocos,
      situacao: rotuloStatusPagina[aberta.status],
      atualizadoEm: formatarData(aberta.atualizado_em),
      atualizadoPor: aberta.atualizado_por,
    }, limparHtml);
    baixarHtml(html, nomeDoArquivoHtml(titulo.trim() || aberta.titulo));
  }

  function trocarBloco(id: string, conteudo: string) {
    setBlocos((atual) => atual.map((b) => (b.id === id ? { ...b, conteudo } : b)));
  }

  function adicionarBloco(tipo: Bloco['tipo'], depoisDe?: string) {
    setBlocos((atual) => {
      const novo = blocoVazio(tipo);
      if (!depoisDe) return [...atual, novo];
      const i = atual.findIndex((b) => b.id === depoisDe);
      return [...atual.slice(0, i + 1), novo, ...atual.slice(i + 1)];
    });
  }

  function moverBloco(id: string, direcao: -1 | 1) {
    setBlocos((atual) => {
      const i = atual.findIndex((b) => b.id === id);
      const j = i + direcao;
      if (i < 0 || j < 0 || j >= atual.length) return atual;
      const copia = [...atual];
      [copia[i], copia[j]] = [copia[j], copia[i]];
      return copia;
    });
  }

  function removerBloco(id: string) {
    setBlocos((atual) => (atual.length === 1 ? atual : atual.filter((b) => b.id !== id)));
  }

  return (
    <section data-guia="paginas" className="cartao overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-linha px-4 py-3">
        <h2 className="font-titulo text-sm font-extrabold">
          Páginas {carteira.paginas.length > 0 && <span className="text-tinta-suave">({carteira.paginas.length})</span>}
        </h2>
        <button className="text-sm font-bold text-roxo-escuro" onClick={() => void nova()}>+ Nova página</button>
      </div>

      {carteira.erro && <div className="p-4"><Aviso>{carteira.erro}</Aviso></div>}
      {erro && <div className="p-4"><Aviso>{erro}</Aviso></div>}

      {carteira.carregando ? <Carregando /> : !carteira.paginas.length ? (
        <Vazio>
          Nenhuma página ainda. Crie uma para descrever o comportamento da tela, com print no meio
          do texto e fluxograma logo abaixo.
        </Vazio>
      ) : (
        <div className="lg:flex">
          <nav className="border-b border-linha p-2 lg:w-56 lg:shrink-0 lg:border-b-0 lg:border-r">
            {carteira.paginas.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  if (sujo && !confirm('Há alterações não salvas nesta página. Sair mesmo assim?')) return;
                  setAbertaId(p.id);
                }}
                className={`mb-1 block w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                  p.id === abertaId ? 'bg-roxo-suave font-bold text-roxo-escuro' : 'text-tinta hover:bg-papel'
                }`}
                title={p.titulo}
              >
                <span className="block truncate">{p.titulo}</span>
                <span className="mt-1 block">
                  <Selo cor={coresStatusPagina[p.status]}>{rotuloStatusPagina[p.status]}</Selo>
                </span>
              </button>
            ))}
          </nav>

          <div className="min-w-0 flex-1 p-4">
            {!aberta ? <Vazio>Escolha uma página.</Vazio> : (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  {editando ? (
                    <input
                      className="campo flex-1 font-titulo text-lg font-extrabold"
                      value={titulo} onChange={(e) => setTitulo(e.target.value)}
                    />
                  ) : (
                    <h3 className="flex-1 font-titulo text-lg font-extrabold">{aberta.titulo}</h3>
                  )}

                  <select
                    className="campo w-36 py-1.5 text-xs font-bold"
                    value={aberta.status}
                    style={{ color: coresStatusPagina[aberta.status] }}
                    onChange={(e) => void trocarStatus(e.target.value as StatusPagina)}
                    title="Situação da página"
                  >
                    {STATUS_PAGINA.map((s) => (
                      <option key={s} value={s}>{rotuloStatusPagina[s]}</option>
                    ))}
                  </select>

                  {editando ? (
                    <>
                      <select className="campo w-44 py-1.5 text-xs" value={autor} onChange={(e) => setAutor(e.target.value)}>
                        <option value="">Quem está editando</option>
                        {pessoas.map((p) => <option key={p.id} value={p.nome}>{p.nome}</option>)}
                      </select>
                      <button className="botao-neutro" onClick={() => {
                        setTitulo(aberta.titulo);
                        setBlocos(aberta.blocos?.length ? aberta.blocos : [blocoVazio('texto')]);
                        setEditando(false);
                      }}>Cancelar</button>
                      <button className="botao-primario" onClick={() => void salvar()} disabled={salvando}>
                        {salvando ? 'Salvando…' : 'Salvar'}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="botao-neutro" onClick={compartilhar}
                        title="Baixar esta página como um arquivo HTML, com o texto e os fluxogramas"
                      >Compartilhar</button>
                      <button className="botao-neutro" onClick={() => void abrirHistorico()}>Histórico</button>
                      <button className="botao-neutro" onClick={() => void excluir(aberta)}>Excluir</button>
                      <button className="botao-primario" onClick={() => setEditando(true)}>Editar</button>
                    </>
                  )}
                </div>

                <p className="mb-3 text-xs text-tinta-suave">
                  Atualizada em {formatarData(aberta.atualizado_em)}
                  {aberta.atualizado_por && ` por ${aberta.atualizado_por}`}
                  {sujo && <span className="ml-2 font-bold text-ambar">alterações não salvas</span>}
                </p>

                <div className="space-y-3">
                  {blocos.map((b) => (
                    <div key={b.id}>
                      {editando && (
                        <div className="mb-1 flex items-center gap-2 text-[11px] text-tinta-suave">
                          <span className="font-bold uppercase tracking-wider">
                            {b.tipo === 'texto' ? 'Texto' : 'Fluxograma'}
                          </span>
                          <button className="hover:text-tinta" onClick={() => moverBloco(b.id, -1)} title="Mover para cima">↑</button>
                          <button className="hover:text-tinta" onClick={() => moverBloco(b.id, 1)} title="Mover para baixo">↓</button>
                          <button className="hover:text-tinta" onClick={() => adicionarBloco('texto', b.id)}>+ texto</button>
                          <button className="hover:text-tinta" onClick={() => adicionarBloco('fluxo', b.id)}>+ fluxograma</button>
                          {blocos.length > 1 && (
                            <button className="ml-auto font-bold text-vermelho" onClick={() => removerBloco(b.id)}>Remover</button>
                          )}
                        </div>
                      )}

                      {b.tipo === 'texto' ? (
                        editando ? (
                          <EditorTexto conteudo={b.conteudo} projetoId={projetoId} aoMudar={(html) => trocarBloco(b.id, html)} />
                        ) : (
                          <div className="prosa" dangerouslySetInnerHTML={{ __html: limparHtml(b.conteudo) }} />
                        )
                      ) : (
                        <Fluxograma conteudo={b.conteudo} editando={editando} aoMudar={(conteudo) => trocarBloco(b.id, conteudo)} />
                      )}
                    </div>
                  ))}
                </div>

                {editando && (
                  <div className="mt-3 flex gap-2">
                    <button className="botao-neutro" onClick={() => adicionarBloco('texto')}>+ Bloco de texto</button>
                    <button className="botao-neutro" onClick={() => adicionarBloco('fluxo')}>+ Fluxograma</button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <Modal aberto={!!versoes} aoFechar={() => setVersoes(null)} titulo="Histórico da página" largura="max-w-lg">
        {versoes?.length ? (
          <ul className="divide-y divide-linha">
            {versoes.map((v) => (
              <li key={v.id} className="flex items-center gap-3 py-2 text-sm">
                <div className="flex-1">
                  <p className="font-semibold">{v.titulo}</p>
                  <p className="text-xs text-tinta-suave">
                    {new Date(v.criado_em).toLocaleString('pt-BR')}
                    {v.salvo_por && ` · ${v.salvo_por}`}
                  </p>
                </div>
                <button
                  className="botao-neutro py-1 text-xs"
                  onClick={() => {
                    /* Restaurar so preenche o editor: o salvamento
                       continua explicito, e a versao atual vira
                       historico como qualquer outra edicao. */
                    setTitulo(v.titulo);
                    setBlocos(v.blocos);
                    setEditando(true);
                    setVersoes(null);
                  }}
                >Restaurar</button>
              </li>
            ))}
          </ul>
        ) : <Vazio>Esta página ainda não tem versões anteriores.</Vazio>}
      </Modal>
    </section>
  );
}
