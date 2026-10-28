/* Globo Flow — armazenamento local e utilitários.
 *
 * Roteiros, sessões, preferências e usuário ficam no localStorage do
 * navegador. É o cache que mantém o teleprompter funcionando sem internet
 * (US06). Com o backend ligado (GF.config.API_BASE), js/api.js sincroniza
 * roteiros e sessões com a API, e este módulo continua como cópia local
 * (o teleprompter segue funcionando se a conexão cair).
 *
 * Se o localStorage estiver bloqueado (aba anônima, política do navegador),
 * os dados ficam só em memória até a página ser fechada.
 */
(function (root) {
  var PREFIX = 'globoflow:';
  var memory = {};
  var persistent = true;

  function rawGet(key) {
    try { var v = root.localStorage.getItem(PREFIX + key); return v === null ? memory[key] || null : v; }
    catch (e) { persistent = false; return memory[key] || null; }
  }
  function rawSet(key, value) {
    memory[key] = value;
    try { root.localStorage.setItem(PREFIX + key, value); }
    catch (e) { persistent = false; }
  }
  function rawDel(key) {
    delete memory[key];
    try { root.localStorage.removeItem(PREFIX + key); } catch (e) { persistent = false; }
  }
  function read(key, fallback) {
    var v = rawGet(key);
    if (v === null || v === undefined) return fallback;
    try { return JSON.parse(v); } catch (e) { return fallback; }
  }
  function write(key, value) {
    rawSet(key, JSON.stringify(value));
    try { root.dispatchEvent(new CustomEvent('gf:store', { detail: { key: key } })); } catch (e) { /* noop */ }
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ---------- utilitários ---------- */
  var util = {
    uid: function (p) { return (p || 'id') + '-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3); },
    pad: function (n) { return (n < 10 ? '0' : '') + n; },
    clock: function (sec, signed) {
      var neg = sec < 0; sec = Math.abs(Math.round(sec));
      var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
      var t = (h ? h + ':' + util.pad(m) : m) + ':' + util.pad(s);
      return (neg ? '−' : (signed ? '+' : '')) + t;
    },
    parseClock: function (str) {
      if (typeof str === 'number') return str;
      var parts = String(str || '').trim().split(':').map(function (x) { return parseInt(x, 10) || 0; });
      if (parts.length === 1) return parts[0] * 60;
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    },
    date: function (ts, opts) {
      return new Date(ts).toLocaleDateString('pt-BR', opts || { day: '2-digit', month: 'short' });
    },
    time: function (ts) { return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); },
    dayLabel: function (ts) {
      var d = new Date(ts), t = new Date();
      var a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      var b = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
      var diff = Math.round((a - b) / 86400000);
      if (diff === 0) return 'Hoje';
      if (diff === 1) return 'Amanhã';
      if (diff === -1) return 'Ontem';
      var s = d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
      return s.charAt(0).toUpperCase() + s.slice(1);
    },
    rel: function (ts) {
      var s = Math.round((Date.now() - ts) / 1000);
      if (s < 45) return 'agora há pouco';
      if (s < 3600) return 'há ' + Math.round(s / 60) + ' min';
      if (s < 86400) return 'há ' + Math.round(s / 3600) + ' h';
      return 'há ' + Math.round(s / 86400) + ' d';
    },
    esc: function (s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    },
    CUE_RE: /\[(PAUSA|ÊNFASE|ENFASE|CÂMERA \d|CAMERA \d|VINHETA|ENTRA VT|SOBE SOM|CORTA)\]/g,
    stripCues: function (t) { return String(t || '').replace(util.CUE_RE, ' ').replace(/\s{2,}/g, ' ').trim(); },
    words: function (t) { var s = util.stripCues(t); return s ? s.split(/\s+/).length : 0; },
    // Ritmo de referência para telejornal: ~150 palavras por minuto.
    WPM: 150,
    estimateSec: function (t) { return Math.round(util.words(t) / util.WPM * 60); },
    initials: function (name) {
      return String(name || '?').trim().split(/\s+/).slice(0, 2).map(function (p) { return p.charAt(0).toUpperCase(); }).join('');
    }
  };

  var STATUS = {
    rascunho: { label: 'Rascunho', tone: 'neutral' },
    'em-revisao': { label: 'Em revisão', tone: 'warn' },
    aprovado: { label: 'Aprovado', tone: 'ok' }
  };
  var ANCHOR_TYPES = {
    nome: { label: 'Nome', icon: 'user-round' },
    data: { label: 'Data', icon: 'calendar' },
    valor: { label: 'Valor', icon: 'banknote' },
    numero: { label: 'Número', icon: 'hash' },
    termo: { label: 'Termo técnico', icon: 'type' },
    obrigatoria: { label: 'Informação obrigatória', icon: 'lock' },
    cta: { label: 'Chamada para ação', icon: 'megaphone' },
    encerramento: { label: 'Encerramento', icon: 'flag' }
  };

  var DEFAULT_PREFS = {
    fontSize: 48,        // px no desktop; o estúdio reduz proporcionalmente em telas pequenas
    speed: 4,            // 1–10
    lineHeight: 1.5,
    contrast: 'padrao',  // 'padrao' | 'alto'
    mirror: false,
    readingLine: true,
    showCues: true,
    autoMark: true,
    railOpen: true
  };
  var SPEED = { min: 1, max: 10 };

  /* ---------- inicialização ---------- */
  function init() {
    var cfg = root.GF.config || {};
    var v = read('seedVersion', 0);
    if (cfg.SEED_EXAMPLES && root.GF.seed && v !== root.GF.seed.version) {
      write('scripts', root.GF.seed.scripts());
      write('sessions', root.GF.seed.sessions());
      write('seedVersion', root.GF.seed.version);
    }
  }

  /* ---------- roteiros ---------- */
  function getScripts() { return read('scripts', []); }
  function getScript(id) {
    var s = getScripts().filter(function (x) { return x.id === id; })[0];
    return s ? clone(s) : null;
  }
  function saveScript(script) {
    var list = getScripts();
    script.updatedAt = Date.now();
    var i = list.findIndex(function (x) { return x.id === script.id; });
    if (i >= 0) list[i] = script; else list.unshift(script);
    write('scripts', list);
    sync('pushScript', script);
    return script;
  }
  function deleteScript(id) {
    write('scripts', getScripts().filter(function (x) { return x.id !== id; }));
    sync('removeScript', id);
  }
  /* Com o backend ligado, cada gravação local também vai para a API (js/api.js). */
  function sync(fn, arg) {
    var s = root.GF.api && root.GF.api.sync;
    if (s && s.enabled()) { try { s[fn](clone(arg)); } catch (e) { /* segue local */ } }
  }
  /* Gravação vinda do servidor: não volta para o servidor. */
  function putScripts(list) { write('scripts', list); }
  function putScript(script) {
    var list = getScripts(), i = list.findIndex(function (x) { return x.id === script.id; });
    if (i >= 0) list[i] = script; else list.unshift(script);
    write('scripts', list);
  }
  function markSynced(id, updatedAt) {
    var list = getScripts(), s = list.filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    s.syncedAt = updatedAt; s.updatedAt = updatedAt; // relógio do servidor é a referência
    write('scripts', list);
  }
  function blankScript(partial) {
    var bid = util.uid('b');
    return Object.assign({
      id: util.uid('rt'), title: 'Novo roteiro', program: '', presenter: currentUser() ? currentUser().name : '',
      status: 'rascunho', approvedBy: null, approvedAt: null,
      scheduledAt: null, updatedAt: Date.now(), durationSec: 60,
      blocks: [{ id: bid, title: 'Abertura', durationSec: 60, text: '' }],
      anchors: [], revisions: []
    }, partial || {});
  }
  function createScript(partial) { return saveScript(blankScript(partial)); }
  function duplicateScript(id) {
    var s = getScript(id); if (!s) return null;
    s.id = util.uid('rt'); s.title = s.title + ' (cópia)'; s.status = 'rascunho';
    s.approvedBy = null; s.approvedAt = null; s.revisions = [];
    return saveScript(s);
  }
  function addRevision(script, rev) {
    script.revisions = script.revisions || [];
    script.revisions.unshift(Object.assign({ id: util.uid('rv'), at: Date.now(), by: currentUser() ? currentUser().name : 'Usuário' }, rev));
    return script;
  }

  /* ---------- sessões (histórico de apresentações) ---------- */
  function getSessions() { return read('sessions', []).sort(function (a, b) { return b.startedAt - a.startedAt; }); }
  function addSession(s) { var l = read('sessions', []); l.push(s); write('sessions', l); sync('pushSession', s); }
  function putSessions(list) { write('sessions', list); }
  function getActive() { return read('active', null); }
  function setActive(v) { if (v) write('active', v); else { rawDel('active'); write('activeCleared', Date.now()); } }

  /* ---------- usuário (login simples, local) ---------- */
  function currentUser() { return read('user', null); }
  function setUser(u) { write('user', u); }
  function logout() { rawDel('user'); setActive(null); }

  /* ---------- preferências e opções de teste ---------- */
  function getPrefs() { return Object.assign({}, DEFAULT_PREFS, read('prefs', {})); }
  function setPrefs(p) { write('prefs', Object.assign(getPrefs(), p)); }

  function clearAll() {
    ['scripts', 'sessions', 'active', 'prefs', 'seedVersion'].forEach(rawDel);
    write('scripts', []); write('sessions', []); write('seedVersion', root.GF.seed ? root.GF.seed.version : -1);
  }
  function exportAll() {
    return { exportadoEm: new Date().toISOString(), scripts: getScripts(), sessions: getSessions(), prefs: getPrefs() };
  }
  function storageInfo() {
    var bytes = 0;
    try {
      for (var i = 0; i < root.localStorage.length; i++) {
        var k = root.localStorage.key(i);
        if (k && k.indexOf(PREFIX) === 0) bytes += (k.length + (root.localStorage.getItem(k) || '').length) * 2;
      }
    } catch (e) { /* noop */ }
    return { bytes: bytes, persistent: persistent };
  }

  root.GF = root.GF || {};
  root.GF.util = util;
  root.GF.STATUS = STATUS;
  root.GF.ANCHOR_TYPES = ANCHOR_TYPES;
  root.GF.SPEED = SPEED;
  root.GF.store = {
    init: init,
    getScripts: getScripts, getScript: getScript, saveScript: saveScript, deleteScript: deleteScript,
    createScript: createScript, blankScript: blankScript, duplicateScript: duplicateScript,
    addRevision: addRevision, putScripts: putScripts, putScript: putScript, markSynced: markSynced, putSessions: putSessions,
    getSessions: getSessions, addSession: addSession, getActive: getActive, setActive: setActive,
    currentUser: currentUser, setUser: setUser, logout: logout,
    getPrefs: getPrefs, setPrefs: setPrefs,
    clearAll: clearAll, exportAll: exportAll, storageInfo: storageInfo,
    isPersistent: function () { return persistent; }
  };
})(window);
