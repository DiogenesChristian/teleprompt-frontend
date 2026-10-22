/* MVP 11 — testes dos principais casos de erro da revisão (documentação, seção 3.2).
 * Em todos os casos de falha o roteiro original não pode ser alterado.
 * Rodar com:  npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const API = path.resolve(__dirname, '../../frontend/js/api.js');
const suggestions = require('../../frontend/js/suggestions.js');

/* Carrega api.js com configuração, conexão e fetch controlados. */
function loadApi({ config = {}, online = true, fetchImpl } = {}) {
  global.window = {
    navigator: { onLine: online },
    GF: {
      config: Object.assign({ API_BASE: 'https://api.teste', AI_TIMEOUT_MS: 80, LOCAL_REVIEW_FALLBACK: false }, config),
      util: { uid: (p) => p + Math.random().toString(36).slice(2) },
      suggestions
    }
  };
  global.fetch = fetchImpl || (() => Promise.reject(new Error('fetch não configurado')));
  delete require.cache[API];
  require(API);
  return global.window.GF.api;
}

/* fetch que só termina quando é cancelado (simula servidor lento) */
const hangingFetch = (_url, opts) => new Promise((_res, rej) => {
  opts.signal.addEventListener('abort', () => rej(Object.assign(new Error('abort'), { name: 'AbortError' })));
});
const jsonResponse = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });

const script = () => ({
  id: 'r1',
  blocks: [{ id: 'b1', title: 'Abertura', text: 'O programa prevê R$ 12 bilhões em recursos.' }],
  anchors: [{ id: 'a1', blockId: 'b1', text: 'R$ 12 bilhões', label: 'Valor', type: 'valor', priority: 'essencial' }]
});

async function expectCode(promise, code) {
  await assert.rejects(promise, (err) => { assert.equal(err.code, code); return true; });
}

test('sem conexão: recusa na hora, sem chamar o servidor', async () => {
  let called = false;
  const api = loadApi({ online: false, fetchImpl: () => { called = true; return jsonResponse(200, {}); } });
  const s = script();
  await expectCode(api.review(s), 'offline');
  assert.equal(called, false);
  assert.equal(s.blocks[0].text, script().blocks[0].text);
});

test('timeout: interrompe no limite configurado', async () => {
  const api = loadApi({ fetchImpl: hangingFetch });
  const t0 = Date.now();
  await expectCode(api.review(script()), 'timeout');
  assert.ok(Date.now() - t0 < 1000, 'deveria parar perto do limite de 80 ms');
});

test('cancelamento pelo usuário', async () => {
  const api = loadApi({ fetchImpl: hangingFetch });
  const ctrl = new AbortController();
  const p = api.review(script(), { signal: ctrl.signal });
  setTimeout(() => ctrl.abort(), 10);
  await expectCode(p, 'cancelled');
});

test('serviço de IA indisponível (HTTP 503)', async () => {
  const api = loadApi({ fetchImpl: () => jsonResponse(503, {}) });
  await expectCode(api.review(script()), 'unavailable');
});

test('falha de rede ao chamar o backend', async () => {
  const api = loadApi({ fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')) });
  await expectCode(api.review(script()), 'unavailable');
});

test('erro do servidor (HTTP 500)', async () => {
  const api = loadApi({ fetchImpl: () => jsonResponse(500, {}) });
  await expectCode(api.review(script()), 'http');
});

test('sem backend e sem revisor local: avisa indisponibilidade', async () => {
  const api = loadApi({ config: { API_BASE: '' } });
  await expectCode(api.review(script()), 'unavailable');
});

test('sem backend com revisor local: devolve sugestões', async () => {
  const api = loadApi({ config: { API_BASE: '', LOCAL_REVIEW_FALLBACK: true, AI_TIMEOUT_MS: 3000 } });
  const s = script(); s.blocks[0].text = 'Houveram registros em 12 bairros.';
  const list = await api.review(s);
  assert.ok(list.some((x) => x.suggestion === 'Houve'));
  assert.equal(s.blocks[0].text, 'Houveram registros em 12 bairros.', 'o roteiro não é alterado pela revisão');
});

test('resposta do backend passa pela trava editorial', async () => {
  const api = loadApi({
    fetchImpl: () => jsonResponse(200, {
      suggestions: [
        { blockId: 'b1', original: 'em recursos.', suggestion: 'em recursos e 40 mil empregos.', category: 'Leitura oral', confidence: 'media', message: 'x' },
        { blockId: 'b1', original: 'prevê R$ 12 bilhões em recursos', suggestion: 'prevê recursos', category: 'Leitura oral', confidence: 'baixa', message: 'y' }
      ]
    })
  });
  const [fatoNovo, protegido] = await api.review(script());
  assert.equal(fatoNovo.guard.blocked, true, 'fato novo bloqueado');
  assert.equal(protegido.guard.blocked, false);
  assert.equal(protegido.guard.needsConfirm, true, 'alteração de âncora exige confirmação');
});
