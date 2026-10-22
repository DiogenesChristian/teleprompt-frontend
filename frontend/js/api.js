/* Globo Flow — acesso à API e à IA.
 *
 * Arquitetura (documentação, seção 3.2): o frontend nunca fala direto com a IA.
 *   Frontend → Backend Node.js (/api/...) → Serviço Python → modelo de IA
 *
 * review() envia o roteiro para POST {API_BASE}/api/ai/review e devolve só
 * sugestões: nada é aplicado ao roteiro sem aceite humano (US05).
 * Se o backend não estiver configurado e LOCAL_REVIEW_FALLBACK estiver ligado,
 * usa o revisor local por regras (js/suggestions.js).
 *
 * Em qualquer falha, o roteiro original continua disponível e o
 * teleprompter segue funcionando (US06).
 */
(function (root) {
  var GF = root.GF;
  var cfg = GF.config || {};
  var TIMEOUT_MS = cfg.AI_TIMEOUT_MS || 10000;

  var MESSAGES = {
    offline: 'Sem conexão. A revisão fica indisponível até a conexão voltar. O roteiro continua salvo neste aparelho.',
    timeout: 'A revisão não respondeu em ' + Math.round(TIMEOUT_MS / 1000) + ' segundos e foi interrompida. O roteiro não foi alterado.',
    unavailable: 'O serviço de revisão está indisponível. O roteiro não foi alterado; você pode seguir com a revisão manual.',
    cancelled: 'Revisão cancelada. O roteiro não foi alterado.',
    http: 'O servidor respondeu com erro. O roteiro não foi alterado.'
  };

  function ApiError(code, extra) {
    var e = new Error(MESSAGES[code] + (extra ? ' (' + extra + ')' : '')); e.code = code; return e;
  }
  function isOnline() { return root.navigator.onLine !== false; }
  function base() { return (cfg.API_BASE || '').replace(/\/+$/, ''); }

  /* Executa com limite de tempo e permite cancelar pelo signal externo. */
  function withTimeout(factory, signal) {
    var ctrl = new AbortController(), timedOut = false;
    var timer = setTimeout(function () { timedOut = true; ctrl.abort(); }, TIMEOUT_MS);
    if (signal) signal.addEventListener('abort', function () { ctrl.abort(); }, { once: true });
    return factory(ctrl.signal).then(function (r) { clearTimeout(timer); return r; }, function (err) {
      clearTimeout(timer);
      if (timedOut) throw ApiError('timeout');
      if (signal && signal.aborted) throw ApiError('cancelled');
      throw err;
    });
  }

  function remoteReview(script, signal) {
    return fetch(base() + '/api/ai/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scriptId: script.id, blocks: script.blocks, anchors: script.anchors }),
      signal: signal
    }).then(function (res) {
      if (res.status === 503) throw ApiError('unavailable');
      if (!res.ok) throw ApiError('http', 'HTTP ' + res.status);
      return res.json();
    }, function (err) {
      if (err && err.name === 'AbortError') throw err;
      throw ApiError('unavailable');
    }).then(function (data) { return data.suggestions || []; });
  }

  function localReview(script, signal) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { resolve(GF.suggestions.analyze(script)); }, 500);
      signal.addEventListener('abort', function () { clearTimeout(t); reject(new DOMException('abort', 'AbortError')); }, { once: true });
    });
  }

  /* A trava editorial roda no cliente para qualquer origem de sugestão. */
  function withGuard(script, list) {
    return list.map(function (s) {
      var block = script.blocks.filter(function (b) { return b.id === s.blockId; })[0];
      var anchors = script.anchors.filter(function (a) { return a.blockId === s.blockId; });
      var out = Object.assign({ id: GF.util.uid('s'), kind: s.suggestion == null ? 'alert' : 'replace', confidence: 'media', blockTitle: block ? block.title : '' }, s);
      if (s.suggestion != null && block) out.guard = GF.suggestions.guard(block.text, s.original, s.suggestion, anchors);
      return out;
    });
  }

  function review(script, opts) {
    opts = opts || {};
    if (!isOnline()) return Promise.reject(ApiError('offline'));
    var useRemote = !!base();
    if (!useRemote && !cfg.LOCAL_REVIEW_FALLBACK) return Promise.reject(ApiError('unavailable'));
    return withTimeout(function (s) { return useRemote ? remoteReview(script, s) : localReview(script, s); }, opts.signal)
      .then(function (list) { return withGuard(script, list); });
  }

  root.GF.api = { TIMEOUT_MS: TIMEOUT_MS, isOnline: isOnline, review: review };
})(window);
