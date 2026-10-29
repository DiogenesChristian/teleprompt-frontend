/* Globo Flow — Configurações */
(function (GF) {
  if (!GF.app.boot({ page: 'config', title: 'Configurações' })) return;
  var ui = GF.ui, icon = GF.icon, S = GF.store;

  function sw(idn, label, on) {
    return '<label class="switch" for="' + idn + '"><span>' + label + '</span><input type="checkbox" id="' + idn + '"' + (on ? ' checked' : '') + '><span class="track"></span></label>';
  }
  function rng(idn, label, min, max, step, val, fmt) {
    return '<div class="field"><label for="' + idn + '">' + label + '</label><div class="range-row"><input type="range" id="' + idn + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '"><output for="' + idn + '">' + fmt(val) + '</output></div></div>';
  }
  var FMT = { 's-font': function (v) { return v + 'px'; }, 's-speed': function (v) { return v; }, 's-lh': function (v) { return (+v).toFixed(1); } };
  var KEY = { 's-font': 'fontSize', 's-speed': 'speed', 's-lh': 'lineHeight' };

  /* ---------- atalhos configuráveis ---------- */
  var capturing = null; // id da ação esperando a tecla nova
  function keyRowsHTML(p) {
    var m = GF.keys.map(p);
    return GF.keys.ACTIONS.map(function (a) {
      var wait = capturing === a.id;
      return '<div class="key-row"><span>' + a.label + '</span>' +
        '<span class="kbd' + (wait ? ' is-wait' : '') + '">' + (wait ? 'aperte uma tecla…' : ui.esc(GF.keys.label(m[a.id]))) + '</span>' +
        '<button type="button" class="btn btn-sm" data-key="' + a.id + '" aria-label="Alterar tecla de ' + a.label + '">' + (wait ? 'Cancelar' : 'Alterar') + '</button></div>';
    }).join('');
  }
  function renderKeys() { ui.$('#key-list').innerHTML = keyRowsHTML(S.getPrefs()); }
  function saveKey(id, key) {
    var p = S.getPrefs(), m = GF.keys.map(p), k = GF.keys.norm(key);
    if (GF.keys.FIXED[k]) { ui.toast('A tecla ' + ui.esc(GF.keys.label(k)) + ' já é usada para ' + GF.keys.FIXED[k] + '.', 'warn'); return false; }
    var other = GF.keys.action(m, k), msg = '';
    if (other && other !== id) { // troca: a outra ação fica com a tecla antiga desta
      m[other] = m[id];
      msg = ' Trocada com "' + GF.keys.ACTIONS.filter(function (a) { return a.id === other; })[0].label + '".';
    }
    m[id] = k;
    S.setPrefs({ keys: m });
    ui.toast('Atalho salvo.' + msg, 'ok', 2200);
    return true;
  }
  document.addEventListener('keydown', function (e) {
    if (!capturing) return;
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') { capturing = null; renderKeys(); return; }
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].indexOf(e.key) >= 0) return;
    var id = capturing;
    if (saveKey(id, e.key)) { capturing = null; renderKeys(); var b = ui.$('[data-key="' + id + '"]'); if (b) b.focus(); }
  }, true);
  ui.$('#main').addEventListener('click', function (e) {
    var b = e.target.closest('[data-key]');
    if (b) { capturing = capturing === b.dataset.key ? null : b.dataset.key; renderKeys(); var nb = ui.$('[data-key="' + b.dataset.key + '"]'); if (nb) nb.focus(); return; }
    if (e.target.closest('#keys-reset')) { capturing = null; S.setPrefs({ keys: {} }); renderKeys(); ui.toast('Atalhos padrão restaurados.', 'ok', 2200); }
  });

  function render() {
    var p = S.getPrefs(), u = S.currentUser(), info = S.storageInfo();
    ui.$('#main').innerHTML =
      '<div class="page-head"><h1>Configurações</h1></div>' +
      '<div class="settings">' +
        '<section class="card"><div class="set-row"><div style="display:flex;gap:12px;align-items:center">' +
          '<span class="avatar" style="width:40px;height:40px;font-size:14px">' + ui.esc(GF.util.initials(u.name)) + '</span>' +
          '<div><b>' + ui.esc(u.name) + '</b><div class="muted" style="font-size:13px">' + ui.esc(u.role) + '</div></div></div>' +
          '<a class="btn btn-sm" href="login.html?next=configuracoes.html">Trocar usuário</a></div></section>' +

        '<section class="card"><h2>Leitura no teleprompter</h2>' +
          rng('s-font', 'Tamanho da fonte', 24, 96, 2, p.fontSize, FMT['s-font']) +
          rng('s-speed', 'Velocidade inicial', GF.SPEED.min, GF.SPEED.max, 1, p.speed, FMT['s-speed']) +
          rng('s-lh', 'Espaçamento entre linhas', 1.2, 2.2, 0.1, p.lineHeight, FMT['s-lh']) +
          '<div class="seg seg-full" role="radiogroup" aria-label="Contraste" id="s-ct">' +
            '<button type="button" data-v="padrao" aria-pressed="' + (p.contrast !== 'alto') + '">Contraste padrão</button>' +
            '<button type="button" data-v="alto" aria-pressed="' + (p.contrast === 'alto') + '">Alto contraste</button></div>' +
          '<div>' + sw('s-upper', 'Texto em maiúsculas', p.upper !== false) + sw('s-mirror', 'Espelhar texto', p.mirror) + sw('s-line', 'Linha de leitura', p.readingLine) +
            sw('s-cues', 'Marcações técnicas', p.showCues) + sw('s-auto', 'Marcar âncora ao passar pela linha de leitura', p.autoMark !== false) + '</div>' +
        '</section>' +

        '<section class="card"><h2>Neste aparelho</h2>' +
          '<p class="muted" style="font-size:14px">Roteiros e histórico ficam guardados aqui para funcionar sem internet' + (info.persistent ? ' (' + (info.bytes / 1024).toFixed(1) + ' KB).' : '. O armazenamento do navegador está bloqueado: os dados duram só até fechar a página.') + '</p>' +
          '<div class="actions">' +
            '<button type="button" class="btn btn-sm" id="btn-install"' + (GF.install.prompt ? '' : ' hidden') + '>' + icon('download', { size: 15 }) + 'Instalar aplicativo</button>' +
            '<button type="button" class="btn btn-sm" id="btn-copy">' + icon('copy', { size: 15 }) + 'Copiar dados (JSON)</button>' +
            '<button type="button" class="btn btn-sm btn-danger" id="btn-clear">Apagar dados locais</button></div>' +
        '</section>' +

        '<section class="card" aria-labelledby="h-keys"><div class="card-head"><h2 id="h-keys">Atalhos do teleprompter</h2>' +
          '<button type="button" class="btn btn-sm btn-ghost" id="keys-reset">Restaurar padrão</button></div>' +
          sw('s-lockkeys', 'Funcionar também no modo bloqueio (sem aparecer nada na tela)', p.lockKeys !== false) +
          '<div class="key-list" id="key-list">' + keyRowsHTML(p) + '</div>' +
          '<p class="field-hint">Para trocar, clique em Alterar e aperte a tecla nova. Esc cancela.</p>' +
          '<details class="key-fixed"><summary>Outras teclas (fixas)</summary><div class="shortcuts">' + [
            ['E', 'Editar roteiro'], ['V', 'Velocidade automática'], ['+ −', 'Tamanho da fonte'], ['D', 'Âncora mais próxima: dita'], ['S', 'Âncora mais próxima: pulada'],
            ['A', 'Lista de âncoras'], ['M', 'Espelhar'], ['F', 'Tela cheia'], ['L', 'Modo bloqueio'], ['Esc', 'Segurar para sair do bloqueio']
          ].map(function (k) { return '<div><span>' + k[1] + '</span><span>' + k[0].split(' ').map(function (x) { return '<span class="kbd">' + x + '</span>'; }).join(' ') + '</span></div>'; }).join('') + '</div></details>' +
        '</section>' +
      '</div>';

    ui.$('#s-ct').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      S.setPrefs({ contrast: b.dataset.v });
      ui.$$('#s-ct button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    });
    ui.$('#btn-copy').addEventListener('click', function () {
      var json = JSON.stringify(S.exportAll(), null, 2);
      ui.copy(json).then(function (ok) {
        if (ok) return ui.toast('Dados copiados.', 'ok');
        var m = ui.modal({ title: 'Dados em JSON', wide: true, body: '<textarea class="textarea" id="json-out" style="min-height:260px;font:12px var(--mono)" readonly></textarea>', actions: [{ label: 'Fechar', tone: 'primary' }] });
        var ta = ui.$('#json-out', m.el); ta.value = json; ta.select();
      });
    });
    ui.$('#btn-clear').addEventListener('click', function () {
      ui.confirm({ title: 'Apagar dados locais?', message: 'Roteiros, histórico e preferências deste aparelho serão apagados. Essa ação não pode ser desfeita.', confirmLabel: 'Apagar', tone: 'danger' })
        .then(function (ok) { if (ok) { S.clearAll(); ui.toast('Dados apagados.', 'info'); render(); } });
    });
    var ib = ui.$('#btn-install');
    GF.install.listeners.push(function () { ib.hidden = false; });
    ib.addEventListener('click', function () {
      if (!GF.install.prompt) return;
      GF.install.prompt.prompt();
      GF.install.prompt.userChoice.then(function () { GF.install.prompt = null; ib.hidden = true; });
    });
  }

  ui.$('#main').addEventListener('input', function (e) {
    var t = e.target; if (!KEY[t.id]) return;
    var o = {}; o[KEY[t.id]] = +t.value; S.setPrefs(o);
    t.nextElementSibling.textContent = FMT[t.id](t.value);
  });
  ui.$('#main').addEventListener('change', function (e) {
    var map = { 's-lockkeys': 'lockKeys', 's-upper': 'upper', 's-mirror': 'mirror', 's-line': 'readingLine', 's-cues': 'showCues', 's-auto': 'autoMark' };
    if (map[e.target.id]) { var o = {}; o[map[e.target.id]] = e.target.checked; S.setPrefs(o); }
  });
  render();
})(window.GF);
