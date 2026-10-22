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

Testes (Node 18+), 31 casos:

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

- **Roteiros** (`index.html`): próximo roteiro no ar, busca e lista.
- **Editor** (`editor.html`): título, programa, apresentador, duração e horário; blocos com duração própria; marcação de âncoras pela seleção do texto; marcações técnicas ([PAUSA], [ÊNFASE], [CÂMERA 1/2], [VINHETA], [ENTRA VT]); revisão com IA; aprovação; registro de alterações com restauração do original.
- **Teleprompter** (`teleprompter.html`): rolagem automática, velocidade de 1 a 10 (~80 a ~260 palavras/min) ou automática, pausa, blocos anterior/próximo, tempo restante com estado verde/amarelo/vermelho, lista de âncoras, ajustes de fonte, espaçamento, contraste e espelhamento, tela cheia, atalhos de teclado.
- **Histórico** (`historico.html`): apresentações encerradas, com tempo real e âncoras ditas.
- **Configurações** (`configuracoes.html`): preferências de leitura, dados do aparelho, instalação do app.
- **Login** (`login.html`): nome e função, usados no registro de aprovações.

## Comportamentos importantes

- **Âncoras**: informações que não podem faltar. No teleprompter ficam em negrito e numa lista com estado (pendente, dita, pulada). Na rolagem contínua, a âncora que cruza a linha de leitura conta como dita (pode ser desligado). Ao pular blocos, as âncoras não lidas ficam pendentes e sobem na lista em amarelo.
- **Velocidade automática** (botão **Auto** ou tecla `V`): com microfone, a rolagem acompanha o ritmo da fala, corrige a posição quando o apresentador está à frente ou atrás do texto e para quando ele para de falar. Usa o reconhecimento de fala do navegador (Chrome, Edge e Safari; precisa de internet). Sem microfone, sem permissão ou sem conexão, ajusta a velocidade para terminar o roteiro no tempo previsto. Sempre entre 80 e 260 palavras/min. Mexer na velocidade manualmente desliga o modo automático.
- **Tempo**: o estado compara o tempo decorrido com o tempo planejado até o ponto do texto. Amarelo nos últimos 20% ou com atraso moderado; vermelho com tempo esgotado ou atraso crítico.
- **Mudança de última hora**: se o roteiro for salvo no editor enquanto está aberto no teleprompter (outra aba ou janela do mesmo navegador), o texto é atualizado sem perder a posição e o trecho novo aparece em azul.
- **Aprovação humana (US05)**: só o perfil Jornalista / Editor aprova o roteiro e aceita ou rejeita sugestões; as outras funções veem o status. Nenhuma sugestão é aplicada sem aceite. Sugestões que inserem informação nova são bloqueadas; as que alteram número, data, nome ou âncora exigem confirmação. Editar o texto depois da aprovação devolve o roteiro para revisão.
- **Sem internet ou sem IA (US06)**: roteiros ficam no armazenamento local e as telas em cache; a revisão mostra a mensagem de indisponibilidade e o teleprompter segue normalmente.

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
  js/pace.js          cálculo de ritmo da velocidade automática
  js/app.js           estrutura comum (menu, barra superior, janelas)
  js/teleprompter.js  js/editor.js  js/roteiros.js  js/historico.js  js/configuracoes.js  js/login.js
  js/icons.js         ícones Lucide embutidos (licença ISC)
  js/data.js          roteiros de exemplo (usados só com SEED_EXAMPLES)
tests/frontend/
  suggestions.test.js   revisor local e trava editorial
  api.test.js           casos de erro da revisão (MVP 11): sem conexão, timeout, cancelamento, 503, falha de rede, HTTP 500
  pace.test.js          velocidade automática
```

## Atalhos do teleprompter

`Espaço` iniciar/pausar · `↑` `↓` velocidade · `V` velocidade automática · `+` `−` fonte · `→` `←` bloco · `Home` início · `D` âncora mais próxima dita · `S` pulada · `A` lista de âncoras · `M` espelhar · `F` tela cheia · `Esc` fechar painéis

## Próximas integrações

Backend Node.js + Express com MongoDB (roteiros e autenticação), serviço de IA em Python, sincronização entre produtor e apresentador em aparelhos diferentes.
