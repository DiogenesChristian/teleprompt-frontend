# Globo Flow — Teleprompter Inteligente

Frontend do teleprompter aumentado por IA para jornalistas, apresentadores e operadores.
HTML, CSS e JavaScript puros, sem build, seguindo a stack e a estrutura de pastas do documento de projeto.

> A IA auxilia na preparação e revisão do roteiro. O profissional mantém o controle editorial e a aprovação final.

## Como rodar

```bash
cd frontend
python3 -m http.server 8080      # ou: npx serve .
```

Abra `http://localhost:8080`. O service worker (modo offline) exige `http://localhost` ou `https://`.

Com o backend (`teleprompt-backend`), coloque `API_BASE: 'http://localhost:4000'` em `frontend/js/config.js`.

Testes (Node 18+), 34 casos:

```bash
npm test
```

## Configuração

Tudo fica em `frontend/js/config.js`:

| Chave | Padrão | Uso |
|---|---|---|
| `API_BASE` | `''` | Endereço do backend Node.js. Vazio: roteiros só no navegador |
| `AI_TIMEOUT_MS` | `10000` | Limite de espera pela revisão (seção 3.2) |
| `LOCAL_REVIEW_FALLBACK` | `true` | Sem backend, usa o revisor local por regras no botão “Revisar com IA” |
| `SEED_EXAMPLES` | `true` | Cria três roteiros de exemplo na primeira abertura. **Desligue em produção** |

## Telas

- **Roteiros** (`index.html`): próximo roteiro no ar, busca e lista (com o número de tópicos).
- **Editor** (`editor.html`): título principal, programa, apresentador, duração e horário; **tópicos** com título, texto e duração, que podem ser criados, movidos e excluídos; visão **Roteiro completo** (só leitura); âncoras; **nota coberta**; marcações técnicas; revisão com IA; aprovação; registro de alterações. Salva sozinho enquanto a pessoa digita. O botão **Transmissão** abre a tela ao vivo (ou **Voltar à transmissão**, se já houver uma em andamento).
- **Teleprompter / transmissão** (`teleprompter.html`): retranca e tópico atual no topo, próximo tópico, rolagem manual ou automática pela voz, edição sem parar, modo bloqueio, espelho, âncoras, tempo, ajustes de leitura e atalhos.
- **Histórico** (`historico.html`): apresentações encerradas, com tempo real e âncoras ditas.
- **Configurações** (`configuracoes.html`): preferências de leitura, atalhos do teleprompter, dados do aparelho, instalação do app.
- **Login** (`login.html`): nome, função e senha. Funções: Apresentador, Jornalista / Editor e Produtor.

## Comportamentos importantes

- **Padrão da redação:** cada tópico começa com a **retranca** (`[09]PREVISÃO DO TEMPO`), e a do tópico atual fica fixa no topo. O texto aparece em maiúsculas (pode desligar em Ajustes).
- **Nota coberta:** no editor, selecione o trecho e clique em **Nota coberta**. Ele aparece sublinhado no teleprompter, para o DTV saber quando entra a imagem do VT.
- **Edição durante o ao vivo:** botão **Editar roteiro** (tecla `E`). O painel abre ao lado do texto, o teleprompter continua rodando e cada alteração entra na tela logo depois que a pessoa para de digitar. Com o editor numa tela e o teleprompter em outra, toda alteração aparece na hora (mesmo navegador: evento `storage`; outro computador: backend). O trecho alterado fica em azul.
- **Quem pode editar no ar e aprovação:** quem decide é o servidor (`LIVE_EDIT_ROLES` e `LIVE_EDIT_APPROVAL` no backend). Se a função não puder editar, aparece um aviso só uma vez, a edição trava e a tela volta à versão do servidor. Sem backend, alterar o texto de um roteiro aprovado o devolve para revisão.
- **Duas pessoas salvando ao mesmo tempo:** o servidor recusa a versão antiga (409) e a tela recebe a versão atual com um aviso.
- **Voz:**
  - **Começar pela voz** (Ajustes): o botão vira **Iniciar pela voz** e o teleprompter só começa a rolar quando a fala bate com o roteiro. Apertar de novo começa na hora.
  - **Velocidade automática** (`V`): a rolagem segue a fala, mesmo com palavras trocadas, e para no silêncio ou no improviso. O tópico e a retranca acompanham o que está sendo falado.
  - **O manual tem prioridade:** rolar com o mouse ou mexer na velocidade desliga o automático. Quando a voz cai e volta, quem está no manual continua no manual (só recebe um aviso).
  - **Microfone:** escolhido em Ajustes (vale para a voz pelo servidor; o reconhecimento do navegador usa o padrão do sistema).
- **Modo bloqueio** (cadeado ou `L`): só o texto na tela. As teclas de leitura continuam funcionando sem mostrar nada (pode desligar em Configurações). Para sair, segure o cadeado ou `Esc` por 1,5 s.
- **Espelho (Disaster Recovery):** a primeira tela que abre o roteiro é a **principal**; as outras viram **espelho** e seguem posição, velocidade e tempo. Se a principal cair, o espelho continua rolando e assume em 1,5 s, no manual; se ela travar sem cair, aparece **Assumir controle**. Quem volta vira espelho. Funciona entre computadores (backend) e entre janelas do mesmo navegador (sem backend). Em Ajustes, **Esta tela: Espelho (reserva)** faz a tela só acompanhar.
- **Navegação:** saindo para o editor e voltando, a transmissão retoma pausada no mesmo ponto, com o mesmo tempo e as mesmas âncoras. **Encerrar** manda a apresentação para o histórico.
- **Âncoras:** informações que não podem faltar. Ficam em negrito e numa lista com estado (pendente, dita, pulada); com voz, são marcadas pela fala.
- **Tempo:** compara o tempo decorrido com o planejado até o ponto do texto (verde, amarelo, vermelho).
- **Sem internet ou sem IA (US06):** roteiros ficam no aparelho e as telas em cache; a revisão mostra indisponibilidade e o teleprompter segue no manual.

## Contrato esperado do backend

```http
POST {API_BASE}/api/ai/review
{ "scriptId": "...", "blocks": [{ "id", "title", "text" }], "anchors": [{ "id", "blockId", "text", "label", "type", "priority" }] }

200 { "suggestions": [{ "blockId", "original", "suggestion" | null, "category", "confidence": "alta|media|baixa", "message" }] }
503 → serviço indisponível
```

| Situação | Tratamento |
|---|---|
| Latência | Indicador com tempo decorrido e botão Cancelar; editor e teleprompter não bloqueiam |
| Timeout | Interrompe no limite configurado e mantém o roteiro original |
| Erro ou indisponibilidade | Mensagem e roteiro original intacto |
| Sem conexão | Revisão desativada; roteiro salvo continua disponível |

## Estrutura

```
frontend/
  index.html  login.html  editor.html  teleprompter.html  historico.html  configuracoes.html
  offline.html  manifest.webmanifest  sw.js  icons/
  css/style.css
  js/config.js        configuração do ambiente
  js/api.js           chamadas ao backend e à IA (timeout, cancelamento, fallback)
  js/store.js         armazenamento local e utilitários
  js/suggestions.js   revisor local, trava editorial e diff
  js/pace.js          ritmo da velocidade automática e localização da fala no texto (tolerante a palavras trocadas)
  js/app.js           estrutura comum (menu, barra superior, janelas), texto com âncoras e nota coberta, atalhos
  js/teleprompter.js  js/editor.js  js/roteiros.js  js/historico.js  js/configuracoes.js  js/login.js
  js/icons.js         ícones Lucide embutidos (licença ISC)
  js/data.js          roteiros de exemplo (usados só com SEED_EXAMPLES)
tests/frontend/
  suggestions.test.js   revisor local e trava editorial
  api.test.js           casos de erro da revisão (MVP 11): sem conexão, timeout, cancelamento, 503, falha de rede, HTTP 500
  pace.test.js          velocidade automática e localização da fala
```

## Atalhos do teleprompter

Teclas de leitura (trocáveis em **Configurações**, funcionam também no modo bloqueio): `Espaço` pausar/continuar · `↑` `↓` velocidade · `→` `←` próximo/anterior tópico · `Page Down` `Page Up` adiantar/recuar o texto · `Home` início.

Teclas fixas: `E` editar roteiro · `V` velocidade automática · `+` `−` fonte · `D` âncora mais próxima dita · `S` pulada · `A` lista de âncoras · `M` espelhar texto · `F` tela cheia · `L` modo bloqueio · `?` lista de atalhos · `Esc` fechar painéis (segurar: sair do bloqueio)

## Backend

Repositório `teleprompt-backend` (Node.js + Express + WebSocket + MongoDB, serviço de IA em Python, voz pela Deepgram). Regras de edição, aprovação e mensagens de tempo real estão no README de lá.
