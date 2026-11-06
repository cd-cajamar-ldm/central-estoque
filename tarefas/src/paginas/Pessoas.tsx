import { useState } from 'react';
import { Aviso, Campo, Modal, Selo, Vazio } from '@/componentes/ui';
import { excluirPessoa, mensagemDeErro, salvarPessoa } from '@/estado/dados';
import { usePermissoes } from '@/estado/sessao';
import type { Papel, Pessoa } from '@/dominio/tipos';
import { PAPEIS, explicacaoDoPapel, rotuloPapel } from '@/dominio/tipos';

interface Props {
  pessoas: Pessoa[];
  recarregar: () => Promise<void>;
}

export default function Pessoas({ pessoas, recarregar }: Props) {
  const permissoes = usePermissoes();
  const [emEdicao, setEmEdicao] = useState<Pessoa | 'nova' | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <Aviso tipo="info">
        Este cadastro <strong>é</strong> o controle de acesso. Quem entra no módulo precisa
        estar aqui, ativo, com o e-mail exatamente igual ao que vai usar no login — é por
        ele que o sistema reconhece a pessoa no primeiro acesso. O papel decide o que cada
        um faz: leitor {explicacaoDoPapel.leitor}; editor {explicacaoDoPapel.editor};
        administrador {explicacaoDoPapel.admin}.
      </Aviso>

      {erro && <Aviso>{erro}</Aviso>}

      <div className="cartao overflow-hidden">
        <div className="flex items-center justify-between border-b border-linha px-4 py-3">
          <h2 className="font-titulo text-sm font-extrabold">Pessoas</h2>
          {permissoes.ehAdmin && (
            <button className="botao-primario" onClick={() => setEmEdicao('nova')}>Cadastrar pessoa</button>
          )}
        </div>
        {pessoas.length ? (
          <table className="w-full text-sm">
            <thead className="bg-papel text-left text-[11px] uppercase tracking-wider text-tinta-suave">
              <tr>
                <th className="px-4 py-2 font-bold">Nome</th>
                <th className="px-4 py-2 font-bold">E-mail</th>
                <th className="px-4 py-2 font-bold">Área</th>
                <th className="px-4 py-2 font-bold">Papel</th>
                <th className="px-4 py-2 font-bold">Situação</th>
                <th className="px-4 py-2 font-bold">Login</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {pessoas.map((p) => (
                <tr key={p.id} className="border-t border-linha">
                  <td className="px-4 py-2 font-semibold">{p.nome}</td>
                  <td className="px-4 py-2 text-tinta-suave">{p.email}</td>
                  <td className="px-4 py-2 text-tinta-suave">{p.area ?? '—'}</td>
                  <td className="px-4 py-2">
                    <Selo cor={p.papel === 'admin' ? '#166534' : p.papel === 'editor' ? '#2A3AA8' : '#6A6F94'}>
                      {rotuloPapel[p.papel]}
                    </Selo>
                  </td>
                  <td className="px-4 py-2">
                    <Selo cor={p.ativo ? '#16A34A' : '#6A6F94'}>{p.ativo ? 'Ativa' : 'Inativa'}</Selo>
                  </td>
                  <td className="px-4 py-2 text-xs text-tinta-suave">
                    {p.user_id ? 'já entrou' : 'aguardando 1º acesso'}
                  </td>
                  <td className="px-4 py-2 text-right text-xs">
                    {!permissoes.ehAdmin ? <span className="text-tinta-suave">—</span> : <>
                    <button className="mr-3 font-bold text-laranja-escuro" onClick={() => setEmEdicao(p)}>Editar</button>
                    <button
                      className="font-bold text-vermelho"
                      onClick={async () => {
                        if (!confirm(`Remover ${p.nome} do cadastro?`)) return;
                        try { await excluirPessoa(p.id); await recarregar(); }
                        catch (falha) { setErro(mensagemDeErro(falha)); }
                      }}
                    >Remover</button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Vazio>Nenhuma pessoa cadastrada.</Vazio>}
      </div>

      <FormularioPessoa
        pessoa={emEdicao} aoFechar={() => setEmEdicao(null)} recarregar={recarregar}
      />
    </div>
  );
}

function FormularioPessoa({ pessoa, aoFechar, recarregar }: {
  pessoa: Pessoa | 'nova' | null; aoFechar: () => void; recarregar: () => Promise<void>;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const atual = pessoa === 'nova' ? null : pessoa;

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await salvarPessoa({
        nome: String(f.get('nome')),
        email: String(f.get('email')),
        area: String(f.get('area')) || null,
        papel: f.get('papel') as Papel,
        ativo: f.get('ativo') === 'on',
      }, atual?.id);
      await recarregar();
      aoFechar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }

  return (
    <Modal aberto={!!pessoa} aoFechar={aoFechar} titulo={atual ? 'Editar pessoa' : 'Cadastrar pessoa'} largura="max-w-lg">
      <form onSubmit={enviar} className="space-y-3">
        <Campo rotulo="Nome *"><input name="nome" required defaultValue={atual?.nome ?? ''} className="campo" /></Campo>
        <Campo rotulo="E-mail *">
          <input name="email" type="email" required defaultValue={atual?.email ?? ''} className="campo"
            placeholder="nome@lojadomecanico.com.br" />
        </Campo>
        <Campo rotulo="Área"><input name="area" defaultValue={atual?.area ?? ''} className="campo" /></Campo>
        <Campo rotulo="Papel *">
          <select name="papel" defaultValue={atual?.papel ?? 'leitor'} className="campo">
            {PAPEIS.map((p) => (
              <option key={p} value={p}>{rotuloPapel[p]}: {explicacaoDoPapel[p]}</option>
            ))}
          </select>
        </Campo>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="ativo" defaultChecked={atual?.ativo ?? true} />
          Pessoa ativa (pode entrar no módulo e aparece nas listas de responsável)
        </label>
        {erro && <Aviso>{erro}</Aviso>}
        <div className="flex justify-end gap-2">
          <button type="button" className="botao-neutro" onClick={aoFechar}>Cancelar</button>
          <button type="submit" className="botao-primario">Salvar</button>
        </div>
      </form>
    </Modal>
  );
}
