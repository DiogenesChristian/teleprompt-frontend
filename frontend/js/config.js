/* Globo Flow — configuração do ambiente.
 * Ajuste estes valores ao publicar. Nada aqui é exibido ao usuário.
 */
window.GF = window.GF || {};
window.GF.config = {
  // Endereço do backend Node.js. Rodando no seu computador: 'http://localhost:4000'.
  // Com backend: login com senha, roteiros no MongoDB, mudanças entre computadores,
  // voz pela API Deepgram, âncoras ditas automaticamente, ponte e plano de corte.
  // Vazio = sem backend: os roteiros ficam só no navegador (tudo continua funcionando).
  API_BASE: 'http://localhost:4000',

  // Tempo máximo de espera pela IA (documentação, seção 3.2).
  AI_TIMEOUT_MS: 10000,

  // Sem backend, usa o revisor local por regras (gramática, repetição,
  // leitura oral) para o botão "Revisar com IA". Em produção com backend,
  // as sugestões vêm de POST {API_BASE}/api/ai/review.
  LOCAL_REVIEW_FALLBACK: true,

  // Cria roteiros de exemplo na primeira abertura (útil em homologação).
  // Com backend, os exemplos sobem para o servidor no primeiro login de um Jornalista / Editor.
  // Desligue em produção.
  SEED_EXAMPLES: true
};
