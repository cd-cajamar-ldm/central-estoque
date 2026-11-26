import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/* Carimbo da versao publicada, mesmo padrao do modulo de Projetos: sem
   ele nao da para saber, olhando a tela, se o navegador esta servindo
   o build novo ou um em cache. */
function versao(): string {
  return new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export default defineConfig({
  /* O site publicado fica em uma subpasta (central-estoque/gerenciador-tarefas),
     entao os arquivos nao podem ser buscados a partir da raiz. */
  base: './',
  define: { __VERSAO__: JSON.stringify(versao()) },
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
});
