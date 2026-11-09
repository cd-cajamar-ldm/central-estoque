/** @type {import('tailwindcss').Config} */
// Espelha src/config/tokens.ts. Os mesmos valores hex vivem la como
// fonte da verdade para o TypeScript; aqui viram utilitarios.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /* Mesma identidade visual da Oficina LDM usada em Inventário
           Rotativo: menu lateral navy, laranja de marca como destaque
           principal. Verde fica só para o significado de "concluída",
           nunca como cor de interface. */
        navy: { DEFAULT: '#0B1230', medio: '#161933', claro: '#2A3AA8' },
        laranja: { DEFAULT: '#FE5000', claro: '#FF8A4C', escuro: '#C83812' },
        sucesso: { DEFAULT: '#1F8A52', suave: '#ECFDF5' },
        tinta: { DEFAULT: '#161933', suave: '#6A6F94' },
        linha: '#E7E8F5',
        papel: '#F3F4FB',
        /* Fundo das colunas do kanban: um tom abaixo do papel da pagina,
           para a coluna aparecer e o cartao branco saltar dentro dela. */
        coluna: { DEFAULT: '#E6E8F4', borda: '#D3D7EA', tracejado: '#B9BEDB' },
        azul: '#2F6FE0',
        ambar: '#C79212',
        vermelho: '#D2453A',
      },
      maxWidth: { tela: '1760px' },
      fontFamily: { titulo: ['Poppins', 'Inter', 'sans-serif'], texto: ['Inter', 'sans-serif'] },
      boxShadow: {
        card: '0 1px 3px rgba(20,24,60,.08), 0 1px 2px rgba(20,24,60,.04)',
        alto: '0 14px 30px -20px rgba(20,24,60,.35)',
      },
    },
  },
  plugins: [],
};
