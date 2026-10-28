/* Globo Flow — estrutura comum das telas (menu, barra superior, conexão,
 * avisos, janelas de confirmação e registro do service worker). */
(function (root) {
  var GF = root.GF;
  var U = GF.util, icon = GF.icon;
  var doc = root.document;

  /* ---------- helpers de interface ---------- */
  var ui = {
    $: function (sel, ctx) { return (ctx || doc).querySelector(sel); },
    $$: function (sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); },
    h: function (html) { var t = doc.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; },
    esc: U.esc,
    statusPill: function (status) {
      var s = GF.STATUS[status] || GF.STATUS.rascunho;
      return '<span class="pill pill-' + s.tone + '"><span class="pill-dot"></span>' + s.label + '</span>';
    },
    toast: function (msg, tone, ms) {
      var host = ui.$('#gf-toasts');
      if (!host) { host = ui.h('<div id="gf-toasts" class="toasts" role="status" aria-live="polite"></div>'); doc.body.appendChild(host); }
      var ic = tone === 'ok' ? 'circle-check' : tone === 'warn' ? 'triangle-alert' : tone === 'crit' ? 'triangle-alert' : 'info';
      var el = ui.h('<div class="toast toast-' + (tone || 'info') + '">' + icon(ic, { size: 18 }) + '<span>' + msg + '</span></div>');
      host.appendChild(el);
      setTimeout(function () { el.classList.add('toast-out'); setTimeout(function () { el.remove(); }, 250); }, ms || 3200);
    },
    /* Janela modal acessível. actions: [{label, tone, value}] */
    modal: function (opts) {
      var last = doc.activeElement;
      var wrap = ui.h(
        '<div class="modal-backdrop" role="presentation">' +
          '<div class="modal ' + (opts.wide ? 'modal-wide' : '') + '" role="dialog" aria-modal="true" aria-labelledby="modal-title">' +
            '<div class="modal-head"><h2 id="modal-title">' + opts.title + '</h2>' +
            '<button type="button" class="icon-btn" data-close aria-label="Fechar">' + icon('x') + '</button></div>' +
            '<div class="modal-body">' + (opts.body || '') + '</div>' +
            (opts.actions ? '<div class="modal-actions">' + opts.actions.map(function (a, i) {
              return '<button type="button" class="btn ' + (a.tone ? 'btn-' + a.tone : 'btn-ghost') + '" data-action="' + i + '">' + a.label + '</button>';
            }).join('') + '</div>' : '') +
          '</div></div>');
      doc.body.appendChild(wrap);
      doc.body.classList.add('has-modal');
      var resolveFn;
      var promise = new Promise(function (r) { resolveFn = r; });
      function close(value) {
        wrap.remove();
        if (!ui.$('.modal-backdrop')) doc.body.classList.remove('has-modal');
        doc.removeEventListener('keydown', onKey, true);
        if (last && last.focus) last.focus();
        resolveFn(value);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.stopPropagation(); close(undefined); }
        if (e.key === 'Tab') {
          var f = ui.$$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', wrap).filter(function (x) { return !x.disabled && x.offsetParent !== null; });
          if (!f.length) return;
          if (e.shiftKey && doc.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
          else if (!e.shiftKey && doc.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
        }
      }
      doc.addEventListener('keydown', onKey, true);
      wrap.addEventListener('click', function (e) {
        if (e.target === wrap || e.target.closest('[data-close]')) close(undefined);
        var b = e.target.closest('[data-action]');
        if (b) { var a = opts.actions[+b.dataset.action]; if (a.onClick && a.onClick(wrap) === false) return; close(a.value); }
      });
      setTimeout(function () {
        var first = ui.$('[autofocus], .modal-actions .btn-primary, .modal-actions .btn-danger, .modal-body input, .modal-actions button', wrap);
        (first || ui.$('[data-close]', wrap)).focus();
      }, 20);
      return { el: wrap, close: close, result: promise };
    },
    confirm: function (opts) {
      return ui.modal({
        title: opts.title,
        body: '<p class="muted">' + opts.message + '</p>',
        actions: [{ label: 'Cancelar', value: false }, { label: opts.confirmLabel || 'Confirmar', tone: opts.tone || 'primary', value: true }]
      }).result.then(function (v) { return !!v; });
    },
    copy: function (text) {
      if (root.navigator.clipboard && root.navigator.clipboard.writeText) {
        return root.navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; });
      }
      return Promise.resolve(false);
    }
  };

  /* ---------- conexão ---------- */
  var net = {
    listeners: [],
    online: function () { return GF.api.isOnline(); },
    on: function (fn) { net.listeners.push(fn); },
    emit: function () {
      var on = net.online();
      doc.body.classList.toggle('is-offline', !on);
      ui.$$('[data-conn]').forEach(renderConn);
      net.listeners.forEach(function (fn) { fn(on); });
    }
  };
  function renderConn(el) {
    var on = net.online();
    el.className = 'conn ' + (on ? 'conn-on' : 'conn-off');
    el.innerHTML = icon(on ? 'wifi' : 'wifi-off', { size: 16 }) + (on ? '' : '<span>Offline</span>');
    el.title = on ? 'Conectado' : 'Sem conexão: usando os roteiros salvos neste aparelho';
    el.setAttribute('aria-label', el.title);
  }

  /* ---------- navegação ---------- */
  var NAV = [
    { id: 'roteiros', href: 'index.html', label: 'Roteiros', icon: 'file-text' },
    { id: 'estudio', href: 'teleprompter.html', label: 'Teleprompter', icon: 'monitor-play' },
    { id: 'historico', href: 'historico.html', label: 'Histórico', icon: 'history' },
    { id: 'config', href: 'configuracoes.html', label: 'Configurações', icon: 'settings' }
  ];
  function param(name) { return new URLSearchParams(root.location.search).get(name); }
  function lastScriptId() { try { return root.localStorage.getItem('globoflow:lastScript'); } catch (e) { return null; } }
  function rememberScript(id) { try { root.localStorage.setItem('globoflow:lastScript', id); } catch (e) { /* noop */ } }
  function navHref(item) {
    if (item.id === 'estudio') {
      var id = lastScriptId();
      if (id && GF.store.getScript(id)) return item.href + '?id=' + encodeURIComponent(id);
    }
    return item.href;
  }

  function renderSidebar(page, compact) {
    var el = ui.$('#gf-sidebar'); if (!el) return;
    var collapsed = compact || (function () { try { return root.localStorage.getItem('globoflow:navCollapsed') === '1'; } catch (e) { return false; } })();
    el.classList.toggle('is-collapsed', collapsed);
    el.innerHTML =
      '<a class="brand" href="index.html" aria-label="Globo Flow — roteiros">' +
        '<span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>' +
        '<span class="brand-word">GLOBO <b>FLOW</b></span></a>' +
      '<nav class="side-nav" aria-label="Principal">' + NAV.map(function (n) {
        var cur = n.id === page || (page === 'editor' && n.id === 'roteiros');
        return '<a href="' + navHref(n) + '" class="side-link' + (cur ? ' is-current' : '') + '"' + (cur ? ' aria-current="page"' : '') + ' title="' + n.label + '">' +
          icon(n.icon) + '<span>' + n.label + '</span></a>';
      }).join('') + '</nav>' +
      (compact ? '' : '<div class="side-foot">' +
        '<button type="button" class="side-link side-toggle" data-nav-toggle aria-label="' + (collapsed ? 'Expandir menu' : 'Recolher menu') + '">' +
        icon(collapsed ? 'chevron-right' : 'chevron-left') + '<span>Recolher menu</span></button></div>');
    var t = ui.$('[data-nav-toggle]', el);
    if (t) t.addEventListener('click', function () {
      try { root.localStorage.setItem('globoflow:navCollapsed', collapsed ? '0' : '1'); } catch (e) { /* noop */ }
      renderSidebar(page, false);
    });
  }

  function renderTopbar(opts) {
    var el = ui.$('#gf-topbar'); if (!el) return;
    var user = GF.store.currentUser() || { name: '', role: '' };
    el.innerHTML =
      '<a class="brand brand-top" href="index.html" aria-label="Globo Flow — roteiros"><span class="brand-word">GLOBO <b>FLOW</b></span></a>' +
      '<span class="top-title">' + U.esc(opts.title || '') + '</span>' +
      '<div class="top-status">' +
        '<span data-conn></span>' +
        '<div class="profile">' +
          '<button type="button" class="profile-btn" aria-haspopup="true" aria-expanded="false" data-profile title="' + U.esc(user.name) + '">' +
            '<span class="avatar">' + U.esc(U.initials(user.name)) + '</span>' +
            '<span class="profile-text"><b>' + U.esc(user.name) + '</b><small>' + U.esc(user.role || '') + '</small></span></button>' +
          '<div class="menu" role="menu" hidden>' +
            '<a role="menuitem" href="configuracoes.html">' + icon('settings', { size: 16 }) + 'Configurações</a>' +
            '<button type="button" role="menuitem" data-logout>' + icon('log-out', { size: 16 }) + 'Sair</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    ui.$$('[data-conn]', el).forEach(renderConn);
    var btn = ui.$('[data-profile]', el), menu = ui.$('.menu', el);
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = menu.hidden; menu.hidden = !open; btn.setAttribute('aria-expanded', String(open));
      if (open) { var f = ui.$('[role=menuitem]', menu); f && f.focus(); }
    });
    doc.addEventListener('click', function () { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); });
    menu.addEventListener('keydown', function (e) { if (e.key === 'Escape') { menu.hidden = true; btn.focus(); } });
    ui.$('[data-logout]', el).addEventListener('click', function () { GF.store.logout(); root.location.href = 'login.html'; });
  }

  function renderBottomNav(page) {
    var el = ui.$('#gf-bottomnav'); if (!el) return;
    el.setAttribute('aria-label', 'Navegação');
    el.innerHTML = NAV.map(function (n) {
      var cur = n.id === page || (page === 'editor' && n.id === 'roteiros');
      return '<a href="' + navHref(n) + '" class="bn-link' + (cur ? ' is-current' : '') + '"' + (cur ? ' aria-current="page"' : '') + '>' +
        '<span class="bn-ic">' + icon(n.icon, { size: 22 }) + '</span><span>' + (n.id === 'config' ? 'Ajustes' : n.label) + '</span></a>';
    }).join('');
  }

  function offlineBanner() {
    if (ui.$('#gf-offline')) return;
    var b = ui.h('<div id="gf-offline" class="offline-banner" role="status">' + icon('wifi-off', { size: 16 }) +
      '<span>Sem conexão. Os roteiros salvos neste aparelho continuam disponíveis.</span></div>');
    var tb = ui.$('#gf-topbar');
    if (tb) tb.parentNode.insertBefore(b, tb.nextSibling);
  }

  /* ---------- service worker / instalação ---------- */
  var install = { prompt: null, listeners: [] };
  root.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); install.prompt = e;
    install.listeners.forEach(function (fn) { fn(); });
  });
  function registerSW() {
    if (!('serviceWorker' in root.navigator) || !/^https?:$/.test(root.location.protocol)) return;
    root.navigator.serviceWorker.register('sw.js').catch(function () { /* segue sem cache offline */ });
  }

  /* ---------- inicialização de cada tela ---------- */
  function boot(opts) {
    opts = opts || {};
    GF.store.init();
    var user = GF.store.currentUser();
    // Com backend, só vale o login feito no servidor (com token).
    if (user && GF.api.enabled() && !user.token) { GF.store.logout(); user = null; }
    if (opts.guard !== false && !user) {
      var here = root.location.pathname.split('/').pop() + root.location.search;
      root.location.replace('login.html?next=' + encodeURIComponent(here || 'index.html'));
      return false;
    }
    if (opts.page !== 'login') {
      renderSidebar(opts.page, opts.compactNav);
      renderTopbar(opts);
      renderBottomNav(opts.page);
      offlineBanner();
    }
    root.addEventListener('online', net.emit);
    root.addEventListener('offline', net.emit);
    net.emit();
    registerSW();
    // Sincroniza roteiros e histórico com o servidor; as telas escutam "gf:synced".
    if (opts.page !== 'login') {
      GF.api.sync.pull();
      root.addEventListener('online', function () { GF.api.sync.pull(); });
    }
    return true;
  }

  /* ---------- texto do roteiro com âncoras, marcações e trechos atualizados ----------
   * Usado no teleprompter e na pré-visualização do editor.
   * opts.updated: lista de trechos (strings) alterados pela produção. */
  var CUE_ICON = { 'PAUSA': 'circle-pause', 'ÊNFASE': 'zap', 'ENFASE': 'zap', 'VINHETA': 'film', 'ENTRA VT': 'clapperboard', 'SOBE SOM': 'activity', 'CORTA': 'scissors' };
  function cueHTML(label) {
    var key = label.toUpperCase();
    var cls = /C[ÂA]MERA/.test(key) ? 'cue-cam' : key === 'ENTRA VT' ? 'cue-vt' : key === 'PAUSA' ? 'cue-pausa' : '';
    var ic = /C[ÂA]MERA/.test(key) ? 'video' : CUE_ICON[key] || 'flag';
    return '<span class="cue ' + cls + '" aria-label="Instrução técnica: ' + U.esc(label) + '">' + icon(ic, { size: 14 }) + U.esc(label) + '</span>';
  }
  function renderText(text, anchors, opts) {
    opts = opts || {};
    text = String(text || '');
    var n = text.length;
    var anc = new Array(n), upd = new Array(n), cue = {};
    (anchors || []).slice().sort(function (a, b) { return b.text.length - a.text.length; }).forEach(function (a) {
      if (!a.text) return;
      var i = text.indexOf(a.text);
      if (i < 0) return;
      for (var k = i; k < i + a.text.length; k++) if (anc[k]) return;
      for (k = i; k < i + a.text.length; k++) anc[k] = a.id;
    });
    (opts.updated || []).forEach(function (u) {
      var i = text.indexOf(u); if (i < 0) return;
      for (var k = i; k < i + u.length; k++) upd[k] = true;
    });
    var re = new RegExp(U.CUE_RE.source, 'g'), m;
    while ((m = re.exec(text))) cue[m.index] = { end: m.index + m[0].length, label: m[1] };
    var out = '', i = 0;
    while (i < n) {
      if (cue[i]) { out += cueHTML(cue[i].label); i = cue[i].end; continue; }
      var a = anc[i], u = upd[i], j = i;
      while (j < n && anc[j] === a && upd[j] === u && !cue[j]) j++;
      var chunk = U.esc(text.slice(i, j));
      if (a) {
        var info = opts.anchorState ? opts.anchorState(a) : '';
        chunk = '<b class="anc ' + (info || '') + '" data-anchor="' + a + '"' + (j - i <= 24 ? ' style="white-space:nowrap"' : '') + '>' + chunk + '</b>';
      }
      if (u) chunk = '<span class="upd">' + chunk + '</span>';
      out += chunk;
      i = j;
    }
    return out;
  }

  GF.renderText = renderText;
  GF.ui = ui;
  GF.net = net;
  GF.install = install;
  GF.app = { boot: boot, param: param, rememberScript: rememberScript };
})(window);
