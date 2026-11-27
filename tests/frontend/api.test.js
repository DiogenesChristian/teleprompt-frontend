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
const jsonResponse = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });

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

function syncBrowser(storage, online, fetchImpl) {
  const api = loadApi({ online, fetchImpl });
  window.localStorage = storage;
  const storePath = path.resolve(__dirname, '../../frontend/js/store.js');
  delete require.cache[storePath];
  require(storePath);
  window.GF.store.setUser({ id: 'u1', token: 'token' });
  return { api, store: window.GF.store };
}

function localStorage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key)
  };
}

function syncResponse(status, body) {
  return Promise.resolve({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) });
}

test('exclusão offline sobrevive à reabertura e impede que a cópia remota reapareça', async () => {
  const storage = localStorage();
  const remote = script();
  const offline = syncBrowser(storage, false, () => assert.fail('fetch offline'));
  offline.store.putScript(remote);
  offline.store.deleteScript(remote.id);
  assert.equal(offline.store.getScript(remote.id), null);
  assert.equal(await offline.api.sync.pull(), false);

  let status = 403;
  let deleted = false;
  const calls = [];
  const { api, store } = syncBrowser(storage, true, (url, options) => {
    calls.push(options.method);
    if (options.method === 'DELETE') {
      deleted = status === 204;
      return syncResponse(status);
    }
    return syncResponse(200, url.endsWith('/sessions') ? { sessions: [] } : { scripts: deleted ? [] : [remote] });
  });

  assert.deepEqual(store.pendingDeletes(), [remote.id]);
  assert.equal(await api.sync.pull(), true);
  assert.equal(store.getScript(remote.id), null);
  assert.deepEqual(store.pendingDeletes(), [remote.id]);

  status = 204;
  assert.equal(await api.sync.pull(), true);
  assert.deepEqual(store.pendingDeletes(), []);
  assert.equal(await api.sync.pull(), true);
  assert.equal(store.getScript(remote.id), null);
  assert.deepEqual(calls, ['DELETE', 'GET', 'GET', 'DELETE', 'GET', 'GET', 'GET', 'GET']);
});

test('exclusão aguarda o PUT em andamento e cancela outro salvamento agendado', async () => {
  let completePut, startedPut;
  const started = new Promise((resolve) => { startedPut = resolve; });
  const calls = [];
  const { api, store } = syncBrowser(localStorage(), true, (_url, options) => {
    calls.push(options.method);
    if (options.method === 'PUT') {
      startedPut();
      return new Promise((resolve) => { completePut = resolve; });
    }
    return syncResponse(204);
  });
  const local = store.saveScript(script());
  await started;
  store.saveScript({ ...local, title: 'Última alteração' });
  store.deleteScript(local.id);
  const deletion = api.sync.removeScript(local.id);
  assert.deepEqual(calls, ['PUT']);
  completePut(await syncResponse(200, { script: local }));
  await deletion;
  assert.deepEqual(calls, ['PUT', 'DELETE']);
  assert.equal(store.getScript(local.id), null);
});

test('sincronização preserva uma edição offline baseada na versão do servidor', async () => {
  const storage = localStorage();
  const remote = { ...script(), title: 'Versão anterior', updatedAt: Date.now() + 60_000 };
  const offline = syncBrowser(storage, false);
  offline.store.putScript({ ...remote, syncedAt: remote.updatedAt });
  offline.store.saveScript({ ...offline.store.getScript(remote.id), title: 'Edição offline' });

  let sent;
  const uploaded = new Promise((resolve) => { sent = resolve; });
  const { api, store } = syncBrowser(storage, true, (url, options) => {
    if (options.method === 'PUT') {
      const saved = JSON.parse(options.body);
      sent(saved);
      return syncResponse(200, { script: saved });
    }
    return syncResponse(200, url.endsWith('/sessions') ? { sessions: [] } : { scripts: [remote] });
  });
  assert.equal(await api.sync.pull(), true);
  assert.equal(store.getScript(remote.id).title, 'Edição offline');
  assert.equal((await uploaded).title, 'Edição offline');
});

test('conflito HTTP preserva a edição enviada e a que chegou durante a gravação', async () => {
  let respond, requestStarted;
  const started = new Promise((resolve) => { requestStarted = resolve; });
  const api = loadApi({ fetchImpl: () => { requestStarted(); return new Promise((resolve) => { respond = resolve; }); } });
  const store = loadStore();
  const local = Object.assign(script(), { syncedAt: 100 });
  store.saveScript(local);
  await started;

  const newer = store.getScript(local.id);
  newer.blocks[0].text = 'Mais texto digitado durante o envio.';
  store.saveScript(newer);
  const remote = Object.assign(script(), { updatedAt: 200 });
  remote.blocks[0].text = 'Edição de outra pessoa.';
  const synced = new Promise((resolve) => window.addEventListener('gf:synced', resolve, { once: true }));
  respond(await jsonResponse(409, { error: 'Conflito', script: remote }));
  await synced;

  assert.deepEqual(store.getConflictDrafts(local.id), [local, newer]);
  assert.deepEqual(store.getScript(local.id), { ...remote, syncedAt: 200 });
  assert.equal(store.getScripts().length, 1);
});

test('evento de âncora incorpora os metadados e preserva o roteiro local pendente', () => {
  const api = loadApi();
  const store = loadStore();
  const local = Object.assign(script(), { updatedAt: 90, syncedAt: 80 });
  local.blocks[0].text = 'Texto local pendente.';
  store.putScript(local);

  const remote = Object.assign(script(), { updatedAt: 85 });
  Object.assign(remote.anchors[0], { label: 'Orçamento', priority: 'cortável' });
  api.sync.receiveScript(remote);
  api.sync.receiveScript(remote);
  api.sync.receiveScript({ ...remote, updatedAt: 84 });

  assert.deepEqual(store.getConflictDrafts(local.id), [local]);
  assert.deepEqual(store.getScript(local.id), { ...remote, syncedAt: 85 });
});

function loadStore() {
  const file = require.resolve('../../frontend/js/store.js');
  const values = new Map();
  const events = new EventTarget();
  Object.assign(window, {
    localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    dispatchEvent: events.dispatchEvent.bind(events),
    addEventListener: events.addEventListener.bind(events)
  });
  delete require.cache[file];
  require(file);
  window.GF.store.setUser({ id: 'editor-local', token: 'teste' });
  return window.GF.store;
}

test('bloco vazio ou inválido não é enviado para revisão', async () => {
  const api = loadApi({fetchImpl: () => assert.fail('não deve enviar dados inválidos')});
  for (const blocks of [[], [null], [{id:'b1',text:'  '}], [{id:'b1',text:42}], [script().blocks[0],script().blocks[0]]]) {
    await expectCode(api.review({...script(),blocks}), 'validation');
  }
});
test('exibe mensagem de validação enviada pelo backend', async () => {
  const api = loadApi({fetchImpl: () => jsonResponse(400,{error:'Bloco 1: texto inválido.'})});
  await assert.rejects(api.review(script()), e => e.code === 'validation' && e.message === 'Bloco 1: texto inválido.');
});
