/* Globo Flow — Histórico de apresentações */
(function (GF) {
  if (!GF.app.boot({ page: 'historico', title: 'Histórico' })) return;
  var ui = GF.ui, U = GF.util, icon = GF.icon, S = GF.store;

  function tone(s) {
    var d = Math.abs(s.realSec - s.plannedSec) / (s.plannedSec || 1);
    return d <= 0.05 ? 'd-ok' : d <= 0.15 ? 'd-warn' : 'd-crit';
  }

  function render() {
    var list = S.getSessions();
    ui.$('#main').innerHTML = '<div class="page-head"><h1>Histórico</h1></div>' +
      (list.length ? '<div>' + list.map(function (s) {
        var pct = s.anchors.total ? s.anchors.dita / s.anchors.total * 100 : 0;
        return '<button type="button" class="h-row" data-session="' + s.id + '">' +
          '<span style="min-width:0"><span class="s-title" style="display:block">' + ui.esc(s.scriptTitle) + '</span>' +
            '<span class="h-meta">' + U.dayLabel(s.startedAt) + ', ' + U.time(s.startedAt) + ' · ' + ui.esc(s.program || '') + '</span></span>' +
          '<span style="display:grid;gap:4px;justify-items:end">' +
            '<span class="h-time">' + U.clock(s.realSec) + ' <span class="' + tone(s) + '">' + U.clock(s.realSec - s.plannedSec, true) + '</span></span>' +
            '<span class="h-anchors"><span class="bar"><i style="width:' + pct + '%"></i></span>' + s.anchors.dita + '/' + s.anchors.total + ' âncoras</span></span>' +
        '</button>';
      }).join('') + '</div>'
      : '<div class="empty">' + icon('history', { size: 32 }) + '<h2>Nenhuma apresentação ainda</h2><p>Ao encerrar uma apresentação no teleprompter, ela aparece aqui.</p></div>');
  }

  ui.$('#main').addEventListener('click', function (e) {
    var r = e.target.closest('[data-session]'); if (!r) return;
    var s = S.getSessions().filter(function (x) { return x.id === r.dataset.session; })[0];
    var STATE = { dita: 'Dita', pulada: 'Pulada', pendente: 'Ficou pendente' };
    ui.modal({
      title: ui.esc(s.scriptTitle), wide: true,
      body: '<p class="muted">' + ui.esc([s.program, s.presenter].filter(Boolean).join(' · ')) + ' · ' + U.dayLabel(s.startedAt) + ', ' + U.time(s.startedAt) + '</p>' +
        '<div class="stats">' +
          '<div class="stat"><small>Previsto</small><b>' + U.clock(s.plannedSec) + '</b></div>' +
          '<div class="stat"><small>Real</small><b class="' + tone(s) + '">' + U.clock(s.realSec) + '</b></div>' +
          '<div class="stat"><small>Âncoras ditas</small><b>' + s.anchors.dita + '/' + s.anchors.total + '</b></div></div>' +
        (s.details && s.details.length ? '<ul class="detail-list">' + s.details.map(function (d) {
          return '<li><span>' + ui.esc(d.label) + (d.priority === 'essencial' ? ' <span class="muted">· essencial</span>' : '') + '</span>' +
            '<span class="' + (d.state === 'dita' ? 'd-ok' : d.state === 'pendente' ? 'd-warn' : 'muted') + '">' + STATE[d.state] + '</span></li>';
        }).join('') + '</ul>' : ''),
      actions: [{ label: 'Fechar', tone: 'primary' }]
    });
  });
  render();
  window.addEventListener('gf:synced', render); // dados atualizados pelo servidor
})(window.GF);
