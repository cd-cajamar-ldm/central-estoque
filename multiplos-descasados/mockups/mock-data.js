/* Dados de exemplo — só para os protótipos de layout. Não é dado real. */
const MOCK_PAIS = [
  {
    pai:'929051', nome:'RAMPA LADO ESQUERDO 1 ELETRICA P/ ALINHAMENTO VERMELHA 5T JM MAQUINAS',
    vendaveis:7, potencial:13, valor:59512.37,
    comps:[
      {componente:'8817231', nome:'CORPO DA RAMPA ESQUERDA', acao:'bloquear', qtd:6, wn:13, ai:0, local:'132564', endereco:'A-12-03', saldoLocal:6},
      {componente:'8817232', nome:'PINO DE TRAVA', acao:null, qtd:0, wn:7, ai:0}
    ]
  },
  {
    pai:'2807989', nome:'TORRE E TRAVESSA DE CAMERAS ALINHADOR TECHMAX 3D MAX-S3',
    vendaveis:3, potencial:5, valor:59198.97,
    comps:[
      {componente:'6621190', nome:'TORRE DE CAMERA', acao:'bloquear', qtd:2, wn:5, ai:0, local:'118820', endereco:'B-04-11', saldoLocal:2},
      {componente:'6621191', nome:'TRAVESSA', acao:null, qtd:0, wn:3, ai:0}
    ]
  },
  {
    pai:'2864738', nome:'COLUNA_ELEVADOR 2,5T ZZS VERMELHO 220V 11815001 KREBS',
    vendaveis:6, potencial:16, valor:56041.32,
    comps:[
      {componente:'4471002', nome:'COLUNA HIDRAULICA', acao:'bloquear', qtd:10, wn:16, ai:0, local:'104432', endereco:'C-01-07', saldoLocal:10},
      {componente:'4471003', nome:'BASE DA COLUNA', acao:null, qtd:0, wn:6, ai:0}
    ]
  },
  {
    pai:'3311420', nome:'KIT ELEVADOR PNEUMATICO 4T C/BLOQUEIO PRETO',
    vendaveis:2, potencial:9, valor:31840.00,
    comps:[
      {componente:'5591004', nome:'CILINDRO PNEUMATICO', acao:'liberar', qtd:7, wn:2, ai:7, local:'140021', endereco:'D-09-02', saldoLocal:7},
      {componente:'5591005', nome:'TRAVA DE SEGURANCA', acao:null, qtd:0, wn:9, ai:0}
    ]
  },
  {
    pai:'929059', nome:'RAMPAS_RAMPA PNEUMATICA 4000KG AMARELO JM MAQUINAS',
    vendaveis:3, potencial:7, valor:46264.97,
    comps:[
      {componente:'8817240', nome:'RAMPA PNEUMATICA', acao:'bloquear', qtd:4, wn:7, ai:0, local:'132570', endereco:'A-12-09', saldoLocal:4}
    ]
  },
  {
    pai:'4482210', nome:'BALANCEADORA DE RODAS AUTOMATICA DIGITAL 220V',
    vendaveis:4, potencial:10, valor:22150.50,
    comps:[
      {componente:'7712300', nome:'EIXO DE FIXACAO', acao:'liberar', qtd:6, wn:4, ai:6, local:'155002', endereco:'E-03-05', saldoLocal:6}
    ]
  },
  {
    pai:'3794247', nome:'RAMPA ESQUERDA_ELEVADOR P/ALINH PNEUMATICA 5.000KGS VERMELHO 6696 JM MAQUINAS',
    vendaveis:5, potencial:12, valor:39726.63,
    comps:[
      {componente:'8817250', nome:'CORPO RAMPA ESQUERDA', acao:'bloquear', qtd:7, wn:12, ai:0, local:'132580', endereco:'A-13-01', saldoLocal:7}
    ]
  },
  {
    pai:'2851999', nome:'COLUNAS_ELEVADOR HIDRAULICO 4T C/DOUBLE LOCK VM EG1000L FORTG',
    vendaveis:138, potencial:144, valor:39.90,
    comps:[
      {componente:'4471100', nome:'COLUNA DOUBLE LOCK', acao:'bloquear', qtd:6, wn:144, ai:0, local:'104500', endereco:'C-02-14', saldoLocal:6}
    ]
  }
];

const MOCK_SEM_PECA = [
  {pai:'5502341', nome:'ELEVADOR TESOURA 3T C/ACIONAMENTO ELETRICO', faltando:'PATOLA TRASEIRA (0 em WN e 0 em 86)'},
  {pai:'6610987', nome:'PRENSA HIDRAULICA 20T BANCADA', faltando:'CILINDRO PRINCIPAL (0 em WN e 0 em 86)'}
];
