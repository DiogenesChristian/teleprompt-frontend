/* Globo Flow — roteiros de exemplo para homologação.
 * Só são criados quando GF.config.SEED_EXAMPLES estiver ligado.
 * Nomes, programas e números são fictícios.
 */
(function (root) {
  var MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;

  function at(dayOffset, hh, mm) {
    var d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hh, mm || 0, 0, 0);
    return d.getTime();
  }

  function scripts() {
    var now = Date.now();
    return [
      {
        id: 'rt-infra',
        title: 'Pacote de infraestrutura',
        program: 'Edição da Noite',
        presenter: 'Rafael Moreira',
        status: 'aprovado',
        approvedBy: 'Mariana Lopes · Editora',
        approvedAt: now - 2 * HOUR,
        scheduledAt: at(0, 21, 15),
        updatedAt: now - 35 * MIN,
        durationSec: 150,
        blocks: [
          {
            id: 'b1', title: 'Abertura', durationSec: 30,
            text: 'Boa noite. O Governo Federal anunciou hoje um novo pacote de investimentos em infraestrutura. O programa prevê R$ 12 bilhões em recursos e deve beneficiar 15 estados brasileiros a partir de janeiro.'
          },
          {
            id: 'b2', title: 'Distribuição dos recursos', durationSec: 40,
            text: 'Segundo o Ministério dos Transportes, a maior parte do dinheiro vai para rodovias e ferrovias. A ministra Helena Duarte afirmou que as primeiras obras começam pelo Nordeste, com prioridade para a duplicação da BR-232, entre Recife e Caruaru.'
          },
          {
            id: 'b3', title: 'Repercussão', durationSec: 45,
            text: 'Economistas ouvidos pela nossa equipe consideram o valor significativo, mas lembram do histórico de atrasos. Em 2023, apenas 40% das obras previstas em programas semelhantes foram concluídas no prazo. O governo promete um painel público de acompanhamento, com atualização mensal.'
          },
          {
            id: 'b4', title: 'Encerramento', durationSec: 35,
            text: 'Você pode acompanhar a lista completa de obras no nosso site. E fica com a gente: depois do intervalo, a previsão do tempo para o fim de semana. Boa noite.'
          }
        ],
        anchors: [
          { id: 'a1', blockId: 'b1', text: 'R$ 12 bilhões', label: 'Valor do pacote', type: 'valor', priority: 'essencial' },
          { id: 'a2', blockId: 'b1', text: '15 estados brasileiros', label: 'Estados beneficiados', type: 'numero', priority: 'essencial' },
          { id: 'a3', blockId: 'b1', text: 'janeiro', label: 'Início em janeiro', type: 'data', priority: 'essencial' },
          { id: 'a4', blockId: 'b2', text: 'Helena Duarte', label: 'Ministra Helena Duarte', type: 'nome', priority: 'essencial' },
          { id: 'a5', blockId: 'b2', text: 'BR-232', label: 'Duplicação da BR-232', type: 'termo', priority: 'essencial' },
          { id: 'a6', blockId: 'b2', text: 'Nordeste', label: 'Obras começam no Nordeste', type: 'obrigatoria', priority: 'cortavel' },
          { id: 'a7', blockId: 'b3', text: '40% das obras', label: '40% concluídas no prazo', type: 'numero', priority: 'essencial' },
          { id: 'a8', blockId: 'b3', text: 'Em 2023', label: 'Referência: 2023', type: 'data', priority: 'cortavel' },
          { id: 'a9', blockId: 'b3', text: 'painel público de acompanhamento', label: 'Painel público', type: 'obrigatoria', priority: 'cortavel' },
          { id: 'a10', blockId: 'b4', text: 'acompanhar a lista completa de obras no nosso site', label: 'Chamada para o site', type: 'cta', priority: 'essencial' },
          { id: 'a11', blockId: 'b4', text: 'depois do intervalo', label: 'Passagem para o intervalo', type: 'encerramento', priority: 'cortavel' }
        ],
        revisions: [
          { id: 'rv-1', at: now - 3 * HOUR, by: 'Mariana Lopes', kind: 'ia-aceita', blockId: 'b2', before: 'a maior parte dos recursos vai para rodovias', after: 'a maior parte do dinheiro vai para rodovias', note: 'Repetição: "recursos" já aparece na abertura.' },
          { id: 'rv-2', at: now - 3 * HOUR + 4 * MIN, by: 'Mariana Lopes', kind: 'ia-rejeitada', blockId: 'b3', before: 'Em 2023, apenas 40% das obras', after: 'Em 2023, menos da metade das obras', note: 'Rejeitada: alterava um número (elemento protegido).' },
          { id: 'rv-3', at: now - 2 * HOUR, by: 'Mariana Lopes', kind: 'aprovacao', blockId: null, before: '', after: '', note: 'Roteiro aprovado para exibição.' }
        ]
      },
      {
        id: 'rt-revista',
        title: 'Cidades que respiram',
        program: 'Revista de Domingo',
        presenter: 'Camila Rocha',
        status: 'aprovado',
        approvedBy: 'Paulo Nunes · Diretor',
        approvedAt: now - 1 * DAY,
        scheduledAt: at(2, 10, 0),
        updatedAt: now - 1 * DAY,
        durationSec: 240,
        blocks: [
          {
            id: 'c1', title: 'Cabeça da matéria', durationSec: 50,
            text: '[VINHETA] [CÂMERA 1] Olá, bom domingo. Hoje a gente vai mostrar como três cidades brasileiras estão trocando asfalto por sombra. [PAUSA] Em Curitiba, um programa municipal já plantou 18 mil árvores em calçadas desde o ano passado.'
          },
          {
            id: 'c2', title: 'Chamada do VT', durationSec: 60,
            text: '[CÂMERA 2] A repórter Lívia Campos acompanhou uma dessas equipes de plantio. [ÊNFASE] Em algumas ruas, a temperatura da calçada caiu até 9 graus no meio da tarde. [ENTRA VT]'
          },
          {
            id: 'c3', title: 'Volta do VT', durationSec: 70,
            text: '[CÂMERA 1] Impressionante a diferença, né? [PAUSA] E o modelo começa a ser copiado. Fortaleza e Belo Horizonte anunciaram projetos parecidos para o primeiro semestre. [CÂMERA 2] A prefeitura de Curitiba diz que a meta é chegar a 50 mil árvores até 2028.'
          },
          {
            id: 'c4', title: 'Encerramento', durationSec: 60,
            text: '[CÂMERA 1] Se você quer sugerir uma rua da sua cidade para receber árvores, mande sua mensagem pelo aplicativo do programa. [ÊNFASE] A gente lê todas. [PAUSA] Até o próximo domingo. [VINHETA]'
          }
        ],
        anchors: [
          { id: 'ca1', blockId: 'c1', text: '18 mil árvores', label: '18 mil árvores plantadas', type: 'numero', priority: 'essencial' },
          { id: 'ca2', blockId: 'c1', text: 'Curitiba', label: 'Curitiba', type: 'nome', priority: 'cortavel' },
          { id: 'ca3', blockId: 'c2', text: 'Lívia Campos', label: 'Repórter Lívia Campos', type: 'nome', priority: 'essencial' },
          { id: 'ca4', blockId: 'c2', text: 'até 9 graus', label: 'Queda de até 9 °C', type: 'numero', priority: 'essencial' },
          { id: 'ca5', blockId: 'c3', text: 'Fortaleza e Belo Horizonte', label: 'Fortaleza e BH', type: 'nome', priority: 'cortavel' },
          { id: 'ca6', blockId: 'c3', text: '50 mil árvores até 2028', label: 'Meta: 50 mil até 2028', type: 'data', priority: 'essencial' },
          { id: 'ca7', blockId: 'c4', text: 'mande sua mensagem pelo aplicativo do programa', label: 'Chamada para o aplicativo', type: 'cta', priority: 'essencial' },
          { id: 'ca8', blockId: 'c4', text: 'Até o próximo domingo', label: 'Despedida', type: 'encerramento', priority: 'cortavel' }
        ],
        revisions: []
      },
      {
        id: 'rt-chuvas',
        title: 'Chuvas no Grande Recife',
        program: 'Boletim da Tarde',
        presenter: 'Rafael Moreira',
        status: 'rascunho',
        approvedBy: null,
        approvedAt: null,
        scheduledAt: at(1, 13, 5),
        updatedAt: now - 20 * MIN,
        durationSec: 90,
        blocks: [
          {
            id: 'd1', title: 'Situação', durationSec: 45,
            text: 'Houveram registros de alagamento em pelo menos 12 bairros do Recife desde a madrugada desta quinta-feira.  A APAC registrou 86 milímetros de chuva em seis horas, o que equivale a quase metade do volume esperado para o mês inteiro, e a previsão indica que a chuva deve continuar ao longo da tarde e também durante a noite na região metropolitana.'
          },
          {
            id: 'd2', title: 'Orientação', durationSec: 45,
            text: 'A nível de prevenção, a Defesa Civil recomenda que os moradores evitem as áreas de risco. A Defesa Civil também informou que o telefone 199 funciona 24 horas. Em caso de emergência, ligue para o o 199.'
          }
        ],
        anchors: [
          { id: 'da1', blockId: 'd1', text: '12 bairros', label: '12 bairros afetados', type: 'numero', priority: 'essencial' },
          { id: 'da2', blockId: 'd1', text: '86 milímetros', label: '86 mm em seis horas', type: 'numero', priority: 'essencial' },
          { id: 'da3', blockId: 'd2', text: 'telefone 199', label: 'Telefone 199', type: 'cta', priority: 'essencial' }
        ],
        revisions: []
      }
    ];
  }

  function sessions() {
    return [
      { id: 'ss-1', scriptId: 'rt-infra', scriptTitle: 'Previsão de safra recorde', program: 'Edição da Noite', presenter: 'Rafael Moreira', startedAt: at(-1, 21, 14), plannedSec: 150, realSec: 158, anchors: { total: 9, dita: 9, pulada: 0, pendente: 0 }, details: [] },
      { id: 'ss-2', scriptId: 'rt-revista', scriptTitle: 'O mar que avança', program: 'Revista de Domingo', presenter: 'Camila Rocha', startedAt: at(-4, 9, 30), plannedSec: 240, realSec: 231, anchors: { total: 8, dita: 7, pulada: 1, pendente: 0 }, details: [] },
      { id: 'ss-3', scriptId: 'rt-infra', scriptTitle: 'Reajuste da tarifa de energia', program: 'Edição da Noite', presenter: 'Rafael Moreira', startedAt: at(-2, 21, 16), plannedSec: 120, realSec: 151, anchors: { total: 7, dita: 5, pulada: 1, pendente: 1 }, details: [] },
      { id: 'ss-4', scriptId: 'rt-chuvas', scriptTitle: 'Volta às aulas na rede estadual', program: 'Boletim da Tarde', presenter: 'Rafael Moreira', startedAt: at(-3, 13, 4), plannedSec: 90, realSec: 87, anchors: { total: 4, dita: 4, pulada: 0, pendente: 0 }, details: [] },
    ];
  }

  root.GF = root.GF || {};
  root.GF.seed = { scripts: scripts, sessions: sessions, version: 4 };
})(window);
