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
        /* Azul oficial da marca (Pantone 2747 C): faixa atras do topo do
           kanban. Diferente de "azul", que e o azul de "em andamento". */
        marca: { DEFAULT: '#001A72' },
        azul: '#2F6FE0',
        ambar: '#C79212',
        vermelho: '#D2453A',
      },
      maxWidth: { tela: '1760px' },
      fontFamily: { titulo: ['Poppins', 'Inter', 'sans-serif'], texto: ['Inter', 'sans-serif'] },
      boxShadow: {
        card: '0 1px 3px rgba(20,24,60,.08), 0 1px 2px rgba(20,24,60,.04)',
        alto: '0 14px 30px -20px rgba(20,24,60,.35)',
        coluna: '0 6px 18px -12px rgba(0,26,114,.5)',
      },
      keyframes: {
        entra: { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        pula: { '50%': { transform: 'scale(1.3)' } },
      },
      animation: {
        entra: 'entra .35s ease backwards',
        pula: 'pula .4s ease',
      },
    },
  },
  plugins: [],
};
