/* Globo Flow — Roteiros (tela inicial) */
(function (GF) {
  if (!GF.app.boot({ page: 'roteiros', title: 'Roteiros' })) return;
  var ui = GF.ui, U = GF.util, icon = GF.icon, S = GF.store;
  var q = '';

  function nextUp(list) {
    var now = Date.now() - 30 * 60000;
    return list.filter(function (s) { return s.scheduledAt && s.scheduledAt > now; })
      .sort(function (a, b) { return a.scheduledAt - b.scheduledAt; })[0];
  }

  function rowHTML(s) {
    return '<li class="s-row">' +
      '<a class="s-main" href="editor.html?id=' + s.id + '">' +
        '<span class="s-title">' + ui.esc(s.title || 'Sem título') + '</span>' +
        '<span class="s-sub">' + ui.esc([s.program, s.presenter].filter(Boolean).join(' · ') || '—') + '</span></a>' +
      '<span class="s-dur tc">' + U.clock(s.durationSec) + '</span>' +
      '<span class="s-status">' + ui.statusPill(s.status) + '</span>' +
      '<span class="s-when">' + (s.scheduledAt ? U.dayLabel(s.scheduledAt) + ', ' + U.time(s.scheduledAt) : 'Sem horário') + '</span>' +
      '<span class="s-acts">' +
        '<a class="icon-btn" href="teleprompter.html?id=' + s.id + '" title="Abrir no teleprompter" aria-label="Abrir ' + ui.esc(s.title) + ' no teleprompter">' + icon('monitor-play', { size: 18 }) + '</a>' +
        '<button type="button" class="icon-btn" data-more="' + s.id + '" aria-haspopup="true" aria-label="Mais ações para ' + ui.esc(s.title) + '">' + icon('ellipsis', { size: 18 }) + '</button>' +
      '</span></li>';
  }

  function render() {
    var all = S.getScripts().slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    var list = all.filter(function (s) {
      return !q || (s.title + ' ' + s.program + ' ' + s.presenter).toLowerCase().indexOf(q.toLowerCase()) >= 0;
    });
    var next = nextUp(all);

    ui.$('#main').innerHTML =
      '<div class="page-head"><h1>Roteiros</h1>' +
        '<button type="button" class="btn btn-primary" data-create>' + icon('plus', { size: 18 }) + 'Novo roteiro</button></div>' +

      (next ? '<section class="next" aria-label="Próximo no ar">' +
        '<div class="next-info"><span class="eyebrow">Próximo no ar · ' + U.dayLabel(next.scheduledAt) + ', ' + U.time(next.scheduledAt) + '</span>' +
          '<h2>' + ui.esc(next.title) + '</h2>' +
          '<p class="muted">' + ui.esc(next.program) + ' · ' + ui.esc(next.presenter) + ' · <span class="tc">' + U.clock(next.durationSec) + '</span></p></div>' +
        '<div class="actions">' +
          '<a class="btn btn-ghost" href="editor.html?id=' + next.id + '">Editar</a>' +
          '<a class="btn btn-primary" href="teleprompter.html?id=' + next.id + '">' + icon('play', { size: 16 }) + 'Abrir teleprompter</a></div>' +
      '</section>' : '') +

      (all.length ? '<div class="search">' + icon('search', { size: 18 }) +
        '<label class="sr-only" for="q">Buscar roteiro</label><input class="input" id="q" type="search" placeholder="Buscar roteiro" value="' + ui.esc(q) + '"></div>' : '') +

      (list.length ? '<ul class="s-list" aria-label="Roteiros">' + list.map(rowHTML).join('') + '</ul>'
        : all.length ? '<p class="empty">Nenhum roteiro encontrado.</p>'
        : '<div class="empty">' + icon('file-text', { size: 32 }) + '<h2>Nenhum roteiro ainda</h2><p>Crie o primeiro roteiro para levá-lo ao teleprompter.</p>' +
          '<button type="button" class="btn btn-primary" data-create>' + icon('plus', { size: 18 }) + 'Novo roteiro</button></div>');

    var input = ui.$('#q');
    if (input) input.addEventListener('input', function (e) {
      q = e.target.value; var pos = e.target.selectionStart; render();
      var i2 = ui.$('#q'); i2.focus(); i2.setSelectionRange(pos, pos);
    });
  }

  ui.$('#main').addEventListener('click', function (e) {
    if (e.target.closest('[data-create]')) { var s = S.createScript(); location.href = 'editor.html?id=' + s.id; return; }
    var more = e.target.closest('[data-more]');
    if (!more) return;
    e.stopPropagation();
    var old = ui.$('.row-menu'); if (old) old.remove();
    var sc = S.getScript(more.dataset.more);
    var menu = ui.h('<div class="menu row-menu" role="menu">' +
      '<a role="menuitem" href="editor.html?id=' + sc.id + '">' + icon('square-pen', { size: 16 }) + 'Editar</a>' +
      '<button type="button" role="menuitem" data-dup>' + icon('copy', { size: 16 }) + 'Duplicar</button>' +
      '<button type="button" role="menuitem" data-del class="danger">' + icon('trash-2', { size: 16 }) + 'Excluir</button></div>');
    more.parentNode.appendChild(menu);
    ui.$('[role=menuitem]', menu).focus();
    menu.addEventListener('keydown', function (k) { if (k.key === 'Escape') { menu.remove(); more.focus(); } });
    menu.addEventListener('click', function (k) {
      if (k.target.closest('[data-dup]')) { S.duplicateScript(sc.id); ui.toast('Roteiro duplicado.', 'ok'); render(); }
      if (k.target.closest('[data-del]')) {
        menu.remove();
        ui.confirm({ title: 'Excluir roteiro?', message: '“' + ui.esc(sc.title) + '” será removido. Essa ação não pode ser desfeita.', confirmLabel: 'Excluir', tone: 'danger' })
          .then(function (ok) { if (ok) { S.deleteScript(sc.id); ui.toast('Roteiro excluído.', 'info'); render(); } });
      }
    });
  });
  document.addEventListener('click', function () { var m = ui.$('.row-menu'); if (m) m.remove(); });
  render();
})(window.GF);
