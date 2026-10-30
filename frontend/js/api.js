/* Globo Flow — acesso ao backend.
 *
 * Arquitetura (documentação, seção 3.2): o frontend nunca fala direto com a IA
 * nem com a API de voz.
 *   Frontend → Backend Node.js (/api/..., /ws) → Serviço Python (revisão)
 *                                             → Deepgram (reconhecimento de fala)
 *
 * Este arquivo reúne:
 *  - review():  revisão do roteiro (POST /api/ai/review). Nada é aplicado sem
 *               aceite humano (US05). Sem backend, usa o revisor local.
 *  - auth:      login e cadastro com senha (token JWT).
 *  - sync:      cópia dos roteiros e sessões entre o aparelho e o servidor.
 *  - live():    conexão em tempo real do teleprompter (voz, âncoras, ponte,
 *               mudanças de última hora vindas de outro computador).
 *
 * Com API_BASE vazio tudo funciona como antes, só no navegador (US06).
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
    http: 'O servidor respondeu com erro. O roteiro não foi alterado.',
    auth: 'Sua sessão expirou. Entre novamente.'
  };

  function ApiError(code, extra) {
    var e = new Error(MESSAGES[code] + (extra ? ' (' + extra + ')' : '')); e.code = code; return e;
  }
  function isOnline() { return root.navigator.onLine !== false; }
  function base() { return (cfg.API_BASE || '').replace(/\/+$/, ''); }
  function token() {
    var u = GF.store && GF.store.currentUser && GF.store.currentUser();
    return u && u.token ? u.token : null;
  }
  function headers() {
    var h = { 'Content-Type': 'application/json' }, t = token();
    if (t) h.Authorization = 'Bearer ' + t;
    return h;
  }
  function expired() {
    if (!GF.store || !root.location) return;
    GF.store.logout();
    var here = root.location.pathname.split('/').pop() + root.location.search;
    root.location.replace('login.html?next=' + encodeURIComponent(here || 'index.html'));
  }

  /* Chamada JSON genérica ao backend. */
  function call(method, path, body, extra) {
    return fetch(base() + path, Object.assign({ method: method, headers: headers(), body: body ? JSON.stringify(body) : undefined }, extra || {}))
      .then(function (res) {
        if (res.status === 401 && path.indexOf('/api/auth/') !== 0) { expired(); throw ApiError('auth'); }
        return res.text().then(function (t) {
          var data = null; try { data = t ? JSON.parse(t) : null; } catch (e) { /* resposta sem JSON */ }
          if (!res.ok) { var err = new Error((data && data.error) || 'HTTP ' + res.status); err.status = res.status; err.data = data; err.code = data && data.code; throw err; }
          return data;
        });
      });
  }

  /* ======================= revisão com IA ======================= */

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
      headers: headers(),
      body: JSON.stringify({ scriptId: script.id, blocks: script.blocks, anchors: script.anchors }),
      signal: signal
    }).then(function (res) {
      if (res.status === 503) throw ApiError('unavailable');
      if (res.status === 401) { expired(); throw ApiError('auth'); }
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

  /* ======================= login ======================= */

  var auth = {
    enabled: function () { return !!base(); },
    /* Entra; se o nome ainda não existe, cria a conta com a função escolhida. */
    enter: function (name, password, role, editorCode) {
      return call('POST', '/api/auth/login', { name: name, password: password }).catch(function (err) {
        if (err.status !== 404) throw err;
        return call('POST', '/api/auth/register', { name: name, password: password, role: role, editorCode: editorCode });
      }).then(function (data) {
        return { id: data.user.id, name: data.user.name, role: data.user.role, token: data.token, since: Date.now() };
      });
    }
  };

  /* ======================= sincronização ======================= */

  var pending = {};
  function notify(msg, tone) { if (GF.ui && GF.ui.toast) GF.ui.toast(msg, tone || 'warn', 4500); }

  function fire(type, detail) { try { root.dispatchEvent(new CustomEvent(type, { detail: detail })); } catch (e) { /* noop */ } }
  /* O servidor recusou a edição porque o roteiro está no ar e esta função não pode
   * alterar o texto agora. Avisa uma vez (não a cada tecla), traz de volta a versão
   * do servidor e avisa as telas para travar a edição. */
  var deniedAt = {};
  function liveEditDenied(id, message, quiet) {
    var now = Date.now();
    if (!quiet && (!deniedAt[id] || now - deniedAt[id] > 30000)) notify(message + ' Sua alteração não foi gravada.', 'crit');
    deniedAt[id] = now;
    fire('gf:live-edit-denied', { id: id, message: message });
    call('GET', '/api/scripts/' + encodeURIComponent(id)).then(function (d) {
      if (!d || !d.script) return;
      GF.store.putScript(Object.assign(d.script, { syncedAt: d.script.updatedAt }));
      fire('gf:synced', { id: id });
    }).catch(function () { /* sem conexão: fica como está */ });
  }

  var sync = {
    enabled: function () { return !!base() && !!token(); },

    /* Envia um roteiro (com pequena espera para juntar gravações seguidas). */
    pushScript: function (script, quiet) {
      clearTimeout(pending[script.id]);
      pending[script.id] = setTimeout(function () {
        delete pending[script.id];
        call('PUT', '/api/scripts/' + encodeURIComponent(script.id), script).then(function (data) {
          // a aprovação é decidida pelo servidor (regras da edição ao vivo): a tela adota o que ele gravou
          GF.store.markSynced(script.id, data.script.updatedAt, data.script);
        }, function (err) {
          // 409: outra pessoa salvou antes. O servidor devolve a versão atual; ela substitui a deste aparelho.
          if (err.status === 409 && err.data && err.data.script) {
            GF.store.putScript(Object.assign(err.data.script, { syncedAt: err.data.script.updatedAt }));
            try { root.dispatchEvent(new CustomEvent('gf:synced')); } catch (e) { /* noop */ }
            notify(err.message, 'crit');
            return;
          }
          if (err.status === 403 && err.code === 'live-edit') return liveEditDenied(script.id, err.message, quiet);
          if (err.status === 403 && !quiet) notify(err.message + ' A alteração ficou só neste aparelho.', 'crit');
          // sem conexão: fica salvo aqui e sobe na próxima sincronização
        });
      }, 400);
    },
    removeScript: function (id) {
      call('DELETE', '/api/scripts/' + encodeURIComponent(id)).catch(function () { /* removido localmente */ });
    },
    pushSession: function (s) {
      // keepalive: a gravação termina mesmo que a página mude para o histórico
      call('POST', '/api/sessions', s, { keepalive: true }).catch(function () { /* sobe na próxima sincronização */ });
    },

    /* Junta o que está no servidor com o que está no aparelho. */
    pull: function () {
      if (!sync.enabled() || !isOnline()) return Promise.resolve(false);
      return Promise.all([call('GET', '/api/scripts'), call('GET', '/api/sessions')]).then(function (r) {
        var server = r[0].scripts || [], S = GF.store;
        var local = S.getScripts(), byId = {}, out = [], uploads = [];
        server.forEach(function (s) { byId[s.id] = s; });
        local.forEach(function (l) {
          var s = byId[l.id];
          if (!s) { if (!l.syncedAt) { out.push(l); uploads.push(l); } return; } // apagado no servidor ou ainda não enviado
          if ((l.updatedAt || 0) > (s.updatedAt || 0) && l.syncedAt !== l.updatedAt) { out.push(l); uploads.push(l); }
          else out.push(Object.assign(s, { syncedAt: s.updatedAt }));
          delete byId[l.id];
        });
        Object.keys(byId).forEach(function (id) { out.push(Object.assign(byId[id], { syncedAt: byId[id].updatedAt })); });
        S.putScripts(out);
        uploads.forEach(function (s) { sync.pushScript(s, true); });

        var sessions = r[1].sessions || [], seen = {};
        sessions.forEach(function (s) { seen[s.id] = true; });
        var mine = S.getSessions().filter(function (s) { return !seen[s.id]; });
        mine.forEach(sync.pushSession);
        S.putSessions(sessions.concat(mine));
        try { root.dispatchEvent(new CustomEvent('gf:synced')); } catch (e) { /* noop */ }
        return true;
      }).catch(function () { return false; });
    }
  };

  /* ======================= tempo real ======================= */
  /* live(scriptId, script) abre o WebSocket do teleprompter e reconecta sozinho.
   * Eventos: 'open', 'close', 'hello', 'tracker', 'speech:transcript',
   * 'speech:error', 'script:updated', 'presence'. */
  function live(scriptId, script) {
    var handlers = {}, ws = null, closed = false, wait = 1000;
    var api = {
      ready: false, deepgram: false,
      on: function (type, fn) { (handlers[type] = handlers[type] || []).push(fn); return api; },
      send: function (msg) { if (ws && ws.readyState === 1) { ws.send(msg instanceof Blob ? msg : JSON.stringify(msg)); return true; } return false; },
      close: function () { closed = true; if (ws) ws.close(); }
    };
    function emit(type, data) { (handlers[type] || []).forEach(function (fn) { fn(data); }); }
    function connect() {
      if (closed || !token()) return;
      var url = base().replace(/^http/, 'ws') + '/ws?token=' + encodeURIComponent(token());
      try { ws = new WebSocket(url); } catch (e) { return retry(); }
      ws.onopen = function () {
        wait = 1000;
        ws.send(JSON.stringify({ type: 'join', scriptId: scriptId, script: script }));
      };
      ws.onmessage = function (e) {
        var msg; try { msg = JSON.parse(e.data); } catch (err) { return; }
        if (msg.type === 'hello') { api.ready = true; api.deepgram = !!(msg.speech && msg.speech.deepgram); emit('open', msg); }
        emit(msg.type, msg);
      };
      ws.onclose = function () { var was = api.ready; api.ready = false; if (was) emit('close'); retry(); };
      ws.onerror = function () { /* onclose cuida da reconexão */ };
    }
    function retry() { if (!closed) { setTimeout(connect, wait); wait = Math.min(15000, wait * 2); } }
    connect();
    return api;
  }

  root.GF.api = {
    TIMEOUT_MS: TIMEOUT_MS, isOnline: isOnline, review: review,
    enabled: function () { return !!base(); },
    auth: auth, sync: sync, live: live
  };
})(window);