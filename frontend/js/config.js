/* Globo Flow — configuração do ambiente.
 * Ajuste estes valores ao publicar. Nada aqui é exibido ao usuário.
 */
window.GF = window.GF || {};
window.GF.config = {
  // Endereço do backend Node.js (ex.: 'https://api.suaredacao.com.br').
  // Vazio = sem backend: os roteiros ficam só no navegador.
  API_BASE: '',

  // Tempo máximo de espera pela IA (documentação, seção 3.2).
  AI_TIMEOUT_MS: 10000,

  // Sem backend, usa o revisor local por regras (gramática, repetição,
  // leitura oral) para o botão "Revisar com IA". Em produção com backend,
  // as sugestões vêm de POST {API_BASE}/api/ai/review.
  LOCAL_REVIEW_FALLBACK: true,

  // Cria roteiros de exemplo na primeira abertura (útil em homologação).
  // Desligue em produção.
  SEED_EXAMPLES: true
};
