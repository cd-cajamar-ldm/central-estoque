/** @type {import('tailwindcss').Config} */
// Espelha src/config/tokens.ts. Os mesmos valores hex vivem la como
// fonte da verdade para o TypeScript; aqui viram utilitarios.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /* Verde e a cor de origem do card "Gerenciador de Tarefas" no hub
           (index.html da raiz) — verde porque e a cor de "concluido" em
           todo o resto da Central, e um gerenciador de tarefas e sobre
           terminar coisas. Navy e laranja seguem a marca Loja do Mecanico. */
        verde: { DEFAULT: '#16A34A', escuro: '#166534', medio: '#15803D', claro: '#86EFAC', suave: '#ECFDF5' },
        navy: { DEFAULT: '#0A0E3D', medio: '#161933', claro: '#2A3AA8' },
        laranja: '#FA4616',
        tinta: { DEFAULT: '#161933', suave: '#6A6F94' },
        linha: '#E7E8F5',
        papel: '#F3F4FB',
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
