/* Globo Flow — Editor de roteiro
 * Cadastro e edição (MVP 2), âncoras, marcações técnicas, duração por bloco,
 * revisão com IA com aprovação humana (US03, US04, US05) e registro de alterações. */
(function (GF) {
  if (!GF.app.boot({ page: 'editor', title: 'Editor' })) return;
  var ui = GF.ui, U = GF.util, icon = GF.icon, S = GF.store;

  var id = GF.app.param('id');
  var script = id ? S.getScript(id) : null;
  if (!script) {
    ui.$('#main').innerHTML = '<div class="empty">' + icon('file-text', { size: 32 }) + '<h2>Roteiro não encontrado</h2><a class="btn btn-primary" href="index.html">Ver roteiros</a></div>';
    return;
  }
  GF.app.rememberScript(script.id);

  var st = { dirty: false, contentChanged: false, sel: {}, review: { status: 'idle', decisions: {}, confirms: {} } };
  var CUES = ['PAUSA', 'ÊNFASE', 'CÂMERA 1', 'CÂMERA 2', 'VINHETA', 'ENTRA VT'];

  function toLocalInput(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return d.getFullYear() + '-' + U.pad(d.getMonth() + 1) + '-' + U.pad(d.getDate()) + 'T' + U.pad(d.getHours()) + ':' + U.pad(d.getMinutes());
  }

  /* ---------------- estrutura ---------------- */
  ui.$('#main').innerHTML =
    '<div class="ed-head">' +
      '<div class="ed-top"><a class="back" href="index.html">' + icon('chevron-left', { size: 16 }) + 'Roteiros</a>' +
        '<div class="actions" style="align-items:center"><span class="save-state" id="save-state" role="status"></span>' +
          '<button type="button" class="icon-btn" id="btn-history" title="Alterações" aria-label="Alterações">' + icon('history', { size: 18 }) + '</button>' +
          '<button type="button" class="btn" id="btn-save">Salvar</button>' +
          '<button type="button" class="btn btn-primary" id="btn-studio">' + icon('monitor-play', { size: 16 }) + 'Teleprompter</button></div></div>' +
      '<label class="sr-only" for="f-title">Título do roteiro</label>' +
      '<input class="title-input" id="f-title" placeholder="Título do roteiro" value="' + ui.esc(script.title) + '">' +
      '<div class="meta">' +
        '<div class="field"><label for="f-program">Programa</label><input class="input" id="f-program" value="' + ui.esc(script.program) + '"></div>' +
        '<div class="field"><label for="f-presenter">Apresentador</label><input class="input" id="f-presenter" value="' + ui.esc(script.presenter) + '"></div>' +
        '<div class="field"><label for="f-dur">Duração</label><input class="input input-tc" style="width:100%" id="f-dur" inputmode="numeric" value="' + U.clock(script.durationSec) + '"></div>' +
        '<div class="field"><label for="f-when">Vai ao ar</label><input class="input" type="datetime-local" id="f-when" value="' + toLocalInput(script.scheduledAt) + '"></div>' +
      '</div>' +
    '</div>' +
    '<div class="editor">' +
      '<div style="display:grid;gap:14px;min-width:0">' +
        '<div class="sum" id="sum"></div>' +
        '<div class="blocks" id="blocks"></div>' +
        '<button type="button" class="btn add-block btn-block" id="btn-add">' + icon('plus', { size: 16 }) + 'Adicionar bloco</button>' +
      '</div>' +
      '<aside class="ed-side">' +
        '<section class="card" aria-labelledby="h-appr"><div class="card-head"><h2 id="h-appr">Aprovação</h2><span id="appr-pill"></span></div><div id="approval" style="display:grid;gap:12px"></div></section>' +
        '<section class="card" aria-labelledby="h-ai"><div class="card-head"><h2 id="h-ai">Revisão com IA</h2><span id="ai-count" class="muted" style="font-size:13px"></span></div><div id="ai" style="display:grid;gap:12px"></div></section>' +
      '</aside>' +
    '</div>';

  /* ---------------- salvar ---------------- */
  function markDirty(content) { st.dirty = true; if (content) st.contentChanged = true; renderSaveState(); }
  function renderSaveState() {
    var el = ui.$('#save-state');
    el.className = 'save-state' + (st.dirty ? ' is-dirty' : '');
    el.textContent = st.dirty ? 'Não salvo' : 'Salvo às ' + U.time(script.updatedAt);
  }
  function save(silent) {
    if (script.status === 'aprovado' && st.contentChanged) {
      S.addRevision(script, { kind: 'edicao', blockId: null, before: '', after: '', note: 'Texto alterado depois da aprovação; roteiro voltou para revisão.' });
      script.status = 'em-revisao'; script.approvedBy = null; script.approvedAt = null;
      ui.toast('O texto mudou depois da aprovação. O roteiro voltou para revisão.', 'warn', 4500);
    }
    S.saveScript(script);
    st.dirty = false; st.contentChanged = false;
    renderSaveState(); renderApproval();
    if (!silent) ui.toast('Roteiro salvo.', 'ok', 1800);
  }

  /* ---------------- dados gerais ---------------- */
  ui.$('#f-title').addEventListener('input', function (e) { script.title = e.target.value; markDirty(false); });
  ui.$('#f-program').addEventListener('input', function (e) { script.program = e.target.value; markDirty(false); });
  ui.$('#f-presenter').addEventListener('input', function (e) { script.presenter = e.target.value; markDirty(false); });
  ui.$('#f-dur').addEventListener('change', function (e) { script.durationSec = Math.max(5, U.parseClock(e.target.value)); e.target.value = U.clock(script.durationSec); markDirty(false); renderSum(); });
  ui.$('#f-when').addEventListener('change', function (e) { script.scheduledAt = e.target.value ? new Date(e.target.value).getTime() : null; markDirty(false); });

  function renderSum() {
    var sum = script.blocks.reduce(function (a, b) { return a + (b.durationSec || 0); }, 0);
    var est = script.blocks.reduce(function (a, b) { return a + U.estimateSec(b.text); }, 0);
    var diff = sum - script.durationSec;
    ui.$('#sum').innerHTML = '<span>' + script.blocks.length + ' blocos</span>' +
      '<span>Soma dos blocos <b>' + U.clock(sum) + '</b></span>' +
      '<span>Leitura estimada <b>' + U.clock(est) + '</b></span>' +
      (Math.abs(diff) > 2 ? '<span class="warn">Blocos ' + (diff > 0 ? 'passam' : 'ficam') + ' ' + U.clock(Math.abs(diff)) + (diff > 0 ? ' da' : ' abaixo da') + ' duração · <button type="button" class="link" id="fix-dur">Ajustar duração</button></span>' : '');
    var fx = ui.$('#fix-dur');
    if (fx) fx.addEventListener('click', function () { script.durationSec = sum; ui.$('#f-dur').value = U.clock(sum); markDirty(false); renderSum(); });
  }

  /* ---------------- blocos ---------------- */
  function getBlock(bid) { return script.blocks.filter(function (b) { return b.id === bid; })[0]; }
  function blockAnchors(b) { return script.anchors.filter(function (a) { return a.blockId === b.id; }); }
  function blockEl(bid) { return ui.$('[data-block="' + bid + '"]'); }

  function statsHTML(b) {
    var est = U.estimateSec(b.text), over = est > b.durationSec * 1.1;
    return '<span class="block-stats' + (over ? ' warn' : '') + '" data-stats>' + U.words(b.text) + ' palavras · ~<span class="tc">' + U.clock(est) + '</span>' + (over ? ' · longo para o bloco' : '') + '</span>';
  }
  function chipsHTML(b) {
    return blockAnchors(b).map(function (a) {
      var t = GF.ANCHOR_TYPES[a.type] || GF.ANCHOR_TYPES.obrigatoria;
      var missing = b.text.indexOf(a.text) < 0;
      return '<span class="a-chip' + (missing ? ' is-missing' : '') + '" title="' + ui.esc(t.label + (a.priority === 'essencial' ? ' · essencial' : ' · cortável') + (missing ? ' · trecho não encontrado no texto' : '')) + '">' +
        icon(missing ? 'triangle-alert' : t.icon, { size: 14 }) +
        '<button type="button" class="link" style="color:var(--fg);font-weight:600" data-edit-anchor="' + a.id + '">' + ui.esc(a.label) + '</button>' +
        (a.priority === 'essencial' ? icon('star', { size: 12 }) : '') +
        '<button type="button" class="x" data-rm="' + a.id + '" aria-label="Remover âncora ' + ui.esc(a.label) + '">' + icon('x', { size: 14 }) + '</button></span>';
    }).join('');
  }
  function blockHTML(b, i) {
    var n = script.blocks.length;
    return '<article class="block" data-block="' + b.id + '">' +
      '<div class="block-head"><span class="block-num">' + U.pad(i + 1) + '</span>' +
        '<label class="sr-only" for="bt-' + b.id + '">Título do bloco</label><input class="block-title" id="bt-' + b.id + '" data-field="title" value="' + ui.esc(b.title) + '">' +
        '<label class="sr-only" for="bd-' + b.id + '">Duração do bloco</label><input class="input input-tc" id="bd-' + b.id + '" data-field="dur" value="' + U.clock(b.durationSec) + '" title="Duração do bloco">' +
        '<button type="button" class="icon-btn" data-act="up" aria-label="Mover para cima"' + (i === 0 ? ' disabled style="visibility:hidden"' : '') + '>' + icon('arrow-up', { size: 17 }) + '</button>' +
        '<button type="button" class="icon-btn" data-act="down" aria-label="Mover para baixo"' + (i === n - 1 ? ' disabled style="visibility:hidden"' : '') + '>' + icon('arrow-down', { size: 17 }) + '</button>' +
        '<button type="button" class="icon-btn" data-act="del" aria-label="Excluir bloco"' + (n === 1 ? ' disabled style="visibility:hidden"' : '') + '>' + icon('trash-2', { size: 17 }) + '</button></div>' +
      '<label class="sr-only" for="tx-' + b.id + '">Texto do bloco</label>' +
      '<textarea class="textarea" id="tx-' + b.id + '" data-field="text" placeholder="Texto que será lido">' + ui.esc(b.text) + '</textarea>' +
      '<div class="block-tools">' +
        '<button type="button" class="btn btn-sm" data-act="anchor" disabled title="Selecione um trecho do texto">' + icon('anchor', { size: 14 }) + 'Marcar âncora</button>' +
        '<label class="sr-only" for="cue-' + b.id + '">Inserir marcação técnica</label>' +
        '<select class="select" id="cue-' + b.id + '" data-cue><option value="">Inserir marcação</option>' + CUES.map(function (c) { return '<option value="' + c + '">[' + c + ']</option>'; }).join('') + '</select>' +
        statsHTML(b) + '</div>' +
      '<div class="chips" data-chips>' + chipsHTML(b) + '</div></article>';
  }
  function grow(t) { t.style.height = 'auto'; t.style.height = Math.max(110, t.scrollHeight + 2) + 'px'; }
  function renderBlocks() {
    ui.$('#blocks').innerHTML = script.blocks.map(blockHTML).join('');
    ui.$$('#blocks textarea').forEach(grow);
    renderSum();
  }
  function refreshBlock(b) {
    var el = blockEl(b.id); if (!el) return;
    ui.$('[data-stats]', el).outerHTML = statsHTML(b);
    ui.$('[data-chips]', el).innerHTML = chipsHTML(b);
    renderSum();
  }

  var blocksEl = ui.$('#blocks');
  blocksEl.addEventListener('input', function (e) {
    var el = e.target.closest('[data-block]'); if (!el) return;
    var b = getBlock(el.dataset.block), f = e.target.dataset.field;
    if (f === 'text') { b.text = e.target.value; grow(e.target); markDirty(true); refreshBlock(b); }
    if (f === 'title') { b.title = e.target.value; markDirty(false); }
  });
  blocksEl.addEventListener('change', function (e) {
    var el = e.target.closest('[data-block]'); if (!el) return;
    var b = getBlock(el.dataset.block);
    if (e.target.dataset.field === 'dur') { b.durationSec = Math.max(5, U.parseClock(e.target.value)); e.target.value = U.clock(b.durationSec); markDirty(false); refreshBlock(b); }
    if (e.target.hasAttribute('data-cue') && e.target.value) {
      var ta = ui.$('textarea', el), pos = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
      var before = ta.value.slice(0, pos), after = ta.value.slice(pos);
      var ins = (before && !/\s$/.test(before) ? ' ' : '') + '[' + e.target.value + ']' + (after && !/^\s/.test(after) ? ' ' : '');
      ta.value = before + ins + after; b.text = ta.value; e.target.value = '';
      ta.focus(); ta.selectionStart = ta.selectionEnd = pos + ins.length;
      grow(ta); markDirty(true); refreshBlock(b);
    }
  });
  function trackSel(e) {
    if (!e.target.matches || !e.target.matches('textarea')) return;
    var bid = e.target.closest('[data-block]').dataset.block;
    var s = e.target.selectionStart, en = e.target.selectionEnd;
    st.sel[bid] = e.target.value.slice(s, en).trim() ? [s, en] : null;
    ui.$('[data-act=anchor]', blockEl(bid)).disabled = !st.sel[bid];
  }
  ['select', 'keyup', 'mouseup'].forEach(function (ev) { blocksEl.addEventListener(ev, trackSel); });
  blocksEl.addEventListener('click', function (e) {
    var el = e.target.closest('[data-block]'), btn = e.target.closest('button');
    if (!el || !btn) return;
    var b = getBlock(el.dataset.block), i = script.blocks.indexOf(b), act = btn.dataset.act;
    if (act === 'up' || act === 'down') {
      script.blocks.splice(i, 1); script.blocks.splice(act === 'up' ? i - 1 : i + 1, 0, b);
      markDirty(true); renderBlocks();
      var nb = ui.$('[data-block="' + b.id + '"] [data-act=' + act + ']'); (nb && !nb.disabled ? nb : ui.$('#bt-' + b.id)).focus();
    } else if (act === 'del') {
      ui.confirm({ title: 'Excluir bloco?', message: '“' + ui.esc(b.title) + '” e suas âncoras serão removidos.', confirmLabel: 'Excluir', tone: 'danger' }).then(function (ok) {
        if (!ok) return;
        script.blocks.splice(i, 1);
        script.anchors = script.anchors.filter(function (a) { return a.blockId !== b.id; });
        markDirty(true); renderBlocks();
      });
    } else if (act === 'anchor') anchorModal(b, null);
    else if (btn.dataset.rm) { script.anchors = script.anchors.filter(function (a) { return a.id !== btn.dataset.rm; }); markDirty(false); refreshBlock(b); }
    else if (btn.dataset.editAnchor) anchorModal(b, script.anchors.filter(function (a) { return a.id === btn.dataset.editAnchor; })[0]);
  });
  ui.$('#btn-add').addEventListener('click', function () {
    var b = { id: U.uid('b'), title: 'Bloco ' + (script.blocks.length + 1), durationSec: 30, text: '' };
    script.blocks.push(b); markDirty(true); renderBlocks();
    ui.$('#tx-' + b.id).focus();
  });

  /* ---------------- âncoras ---------------- */
  function guessType(t) {
    if (/R\$|reais|bilh|milh|US\$|dólar/i.test(t)) return 'valor';
    if (/(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|segunda|terça|quarta|quinta|sexta|sábado|domingo|\b(19|20)\d{2}\b|\d{1,2}\/\d{1,2})/i.test(t)) return 'data';
    if (/\d/.test(t)) return 'numero';
    if (/^(acompanhe|acesse|mande|envie|ligue|participe|assista|visite)/i.test(t)) return 'cta';
    if (/^[A-ZÀ-Þ][\wÀ-ÿ]+(\s+(d[aeo]s?\s+)?[A-ZÀ-Þ][\wÀ-ÿ]+)*$/.test(t)) return 'nome';
    return 'obrigatoria';
  }
  function anchorModal(b, existing) {
    var text = existing ? existing.text : '';
    if (!existing) {
      var ta = ui.$('#tx-' + b.id), sel = st.sel[b.id];
      text = sel ? ta.value.slice(sel[0], sel[1]).trim().replace(/^[,.;:]+|[,.;:]+$/g, '').trim() : '';
      if (!text) return;
      U.CUE_RE.lastIndex = 0;
      if (U.CUE_RE.test(text)) { U.CUE_RE.lastIndex = 0; ui.toast('Marcações técnicas não viram âncoras.', 'warn'); return; }
    }
    var a = existing || { type: guessType(text), priority: 'essencial', label: text.length > 38 ? text.slice(0, 36) + '…' : text };
    ui.modal({
      title: existing ? 'Editar âncora' : 'Nova âncora',
      body: '<p class="muted">“<span style="color:var(--fg)">' + ui.esc(text) + '</span>”</p>' +
        '<div class="field"><label for="an-label">Nome curto</label><input class="input" id="an-label" maxlength="48" value="' + ui.esc(a.label) + '"></div>' +
        '<div class="field"><label for="an-type">Tipo</label><select class="select" id="an-type">' + Object.keys(GF.ANCHOR_TYPES).map(function (k) {
          return '<option value="' + k + '"' + (a.type === k ? ' selected' : '') + '>' + GF.ANCHOR_TYPES[k].label + '</option>'; }).join('') + '</select></div>' +
        '<label class="check"><input type="checkbox" id="an-ess"' + (a.priority === 'essencial' ? ' checked' : '') + '>Essencial: não pode ficar de fora</label>',
      actions: [{ label: 'Cancelar' }, {
        label: 'Salvar', tone: 'primary', onClick: function (w) {
          var label = ui.$('#an-label', w).value.trim();
          if (!label) { ui.$('#an-label', w).focus(); return false; }
          var data = { label: label, type: ui.$('#an-type', w).value, priority: ui.$('#an-ess', w).checked ? 'essencial' : 'cortavel' };
          if (existing) Object.assign(existing, data); else script.anchors.push(Object.assign({ id: U.uid('a'), blockId: b.id, text: text }, data));
          markDirty(false); refreshBlock(b);
        }
      }]
    });
  }

  /* ---------------- alterações ---------------- */
  var REV = { 'ia-aceita': 'Sugestão aceita', 'ia-rejeitada': 'Sugestão rejeitada', 'desfeita': 'Original restaurado', 'edicao': 'Edição', 'aprovacao': 'Aprovação', 'producao': 'Atualização' };
  function vis(v) { return /^\s+$/.test(v) ? v.replace(/ /g, '␣') : ui.esc(v); }
  function diffParts(a, b) { return GF.suggestions.diff(a, b); }
  function diffHTML(a, b) {
    return diffParts(a, b).map(function (p) { return p.t === 'eq' ? ui.esc(p.v) : p.t === 'del' ? '<del class="d">' + vis(p.v) + '</del>' : '<ins class="d">' + vis(p.v) + '</ins>'; }).join('');
  }
  ui.$('#btn-history').addEventListener('click', function () {
    var list = script.revisions || [];
    var m = ui.modal({
      title: 'Alterações', wide: true,
      body: list.length ? '<div>' + list.map(function (r) {
        var b = r.blockId ? getBlock(r.blockId) : null;
        var canUndo = r.kind === 'ia-aceita' && b && r.after && b.text.indexOf(r.after) >= 0 && !r.undone;
        return '<div class="rev"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b>' + (REV[r.kind] || 'Edição') + (b ? ' · ' + ui.esc(b.title) : '') + '</b>' +
          (canUndo ? '<button type="button" class="btn btn-sm btn-ghost" data-undo="' + r.id + '">Restaurar original</button>' : '') + '</div>' +
          '<small>' + ui.esc(r.by) + ' · ' + U.dayLabel(r.at) + ', ' + U.time(r.at) + '</small>' +
          (r.before || r.after ? '<p class="rev-diff">' + diffHTML(r.before, r.after) + '</p>' : r.note ? '<p class="rev-diff">' + ui.esc(r.note) + '</p>' : '') + '</div>';
      }).join('') + '</div>' : '<p class="muted">Nenhuma alteração registrada.</p>',
      actions: [{ label: 'Fechar', tone: 'primary' }]
    });
    m.el.addEventListener('click', function (e) {
      var u = e.target.closest('[data-undo]'); if (!u) return;
      var r = list.filter(function (x) { return x.id === u.dataset.undo; })[0], b = getBlock(r.blockId);
      b.text = b.text.replace(r.after, r.before); r.undone = true;
      S.addRevision(script, { kind: 'desfeita', blockId: b.id, before: r.after, after: r.before });
      markDirty(true); renderBlocks(); m.close();
      ui.toast('Texto original restaurado. Salve para confirmar.', 'ok');
    });
  });

  /* ---------------- aprovação (US05) ---------------- */
  /* US05: "como editor, quero aprovar alterações". Só Jornalista / Editor aprova
   * o roteiro e decide sobre sugestões da IA. Quando houver autenticação no
   * backend, a função virá da API e a mesma regra deve ser validada lá. */
  var APPROVER = 'Jornalista / Editor';
  function canApprove() { var u = S.currentUser(); return !!u && u.role === APPROVER; }
  var EDITOR_ONLY = '<p class="field-hint">Somente Jornalista / Editor pode aprovar.</p>';

  function pendingCount() {
    return st.review.status === 'done' ? st.review.result.filter(function (s) { return !st.review.decisions[s.id] && !(s.guard && s.guard.blocked); }).length : 0;
  }
  function renderApproval() {
    ui.$('#appr-pill').innerHTML = ui.statusPill(script.status);
    var p = pendingCount();
    ui.$('#approval').innerHTML =
      (script.approvedBy ? '<p class="muted" style="font-size:13px">Aprovado por ' + ui.esc(script.approvedBy) + ', ' + U.dayLabel(script.approvedAt).toLowerCase() + ' às ' + U.time(script.approvedAt) + '.</p>'
        : '<p class="muted" style="font-size:13px">O roteiro precisa de aprovação antes de ir ao ar.</p>') +
      (p ? '<div class="notice notice-warn">' + icon('triangle-alert', { size: 16 }) + '<span>' + p + ' sugestão(ões) sem decisão.</span></div>' : '') +
      (!canApprove() ? EDITOR_ONLY
        : script.status === 'aprovado'
        ? '<button type="button" class="btn btn-block" id="btn-unapprove">Voltar para revisão</button>'
        : '<button type="button" class="btn btn-ok btn-block" id="btn-approve">' + icon('badge-check', { size: 16 }) + 'Aprovar roteiro</button>');
    var ap = ui.$('#btn-approve'), un = ui.$('#btn-unapprove');
    if (ap) ap.addEventListener('click', function () {
      var user = S.currentUser();
      ui.confirm({ title: 'Aprovar roteiro?', message: 'Seu nome (' + ui.esc(user.name) + ') ficará registrado como responsável pela aprovação.' + (p ? ' Há ' + p + ' sugestão(ões) sem decisão.' : ''), confirmLabel: 'Aprovar' })
        .then(function (ok) {
          if (!ok) return;
          st.contentChanged = false;
          script.status = 'aprovado'; script.approvedBy = user.name + ' · ' + user.role; script.approvedAt = Date.now();
          S.addRevision(script, { kind: 'aprovacao', blockId: null, before: '', after: '', note: 'Roteiro aprovado.' });
          save(true); ui.toast('Roteiro aprovado.', 'ok');
        });
    });
    if (un) un.addEventListener('click', function () { script.status = 'em-revisao'; script.approvedBy = null; script.approvedAt = null; save(true); });
  }

  /* ---------------- revisão com IA (US03/US04) ---------------- */
  var timer = null;
  function startReview() {
    var ctrl = new AbortController();
    st.review = { status: 'loading', startedAt: Date.now(), ctrl: ctrl, decisions: {}, confirms: {} };
    renderAI();
    timer = setInterval(function () { var el = ui.$('#ai-elapsed'); if (el) el.textContent = Math.floor((Date.now() - st.review.startedAt) / 1000) + ' s'; }, 250);
    GF.api.review(JSON.parse(JSON.stringify(script)), { signal: ctrl.signal })
      .then(function (list) { st.review.status = 'done'; st.review.result = list; }, function (err) { st.review.status = 'error'; st.review.error = err; })
      .then(function () { clearInterval(timer); renderAI(); renderApproval(); });
  }
  function sugHTML(s) {
    var b = getBlock(s.blockId), dec = st.review.decisions[s.id], g = s.guard || {};
    var stale = s.suggestion != null && (!b || b.text.indexOf(s.original) < 0) && !dec;
    var blocked = g.blocked && !g.stale;
    var h = '<article class="sug' + (blocked ? ' is-blocked' : '') + (dec ? ' is-done' : '') + '" data-sug="' + s.id + '">' +
      '<div class="sug-head"><b>' + ui.esc(s.category || 'Sugestão') + '</b><span>' + ui.esc(b ? b.title : '') + (s.confidence === 'baixa' ? ' · <span class="conf-baixa">baixa confiança</span>' : '') + '</span></div>' +
      '<p class="sug-msg">' + ui.esc(s.message || '') + '</p>';
    if (s.suggestion != null && b) {
      var ctx = GF.suggestions.context(b.text, s.original, s.suggestion);
      if (ctx) {
        var parts = diffParts(ctx.before, ctx.after);
        h += '<div class="cmp"><div><small>Original</small>' + parts.map(function (p) { return p.t === 'eq' ? ui.esc(p.v) : p.t === 'del' ? '<del class="d">' + vis(p.v) + '</del>' : ''; }).join('') + '</div>' +
          '<div><small>Sugerido</small>' + parts.map(function (p) { return p.t === 'eq' ? ui.esc(p.v) : p.t === 'ins' ? '<ins class="d">' + vis(p.v) + '</ins>' : ''; }).join('') + '</div></div>';
      }
    }
    if (!dec && !canApprove()) return h + '<p class="field-hint">Aguardando decisão de Jornalista / Editor.</p></article>';
    if (dec) return h + '<p class="field-hint">' + { aceita: 'Aceita', rejeitada: 'Rejeitada', ciente: 'Vista', descartada: 'Descartada' }[dec.kind] + ' por ' + ui.esc(dec.by) + ' às ' + U.time(dec.at) + '</p></article>';
    if (stale) return h + '<p class="guard warn">O trecho mudou depois da revisão.</p><div class="sug-actions"><button type="button" class="btn btn-sm" data-dec="descartada">Descartar</button></div></article>';
    if (blocked) return h + '<p class="guard crit">Bloqueada: inclui informação que não está no roteiro (' + g.newFacts.map(ui.esc).join(', ') + ').</p><div class="sug-actions"><button type="button" class="btn btn-sm" data-dec="descartada">Descartar</button></div></article>';
    if (g.needsConfirm) {
      h += '<p class="guard warn">Altera informação protegida: ' + g.changed.concat(g.anchors).map(ui.esc).join(', ') + '.</p>' +
        '<label class="check"><input type="checkbox" data-confirm' + (st.review.confirms[s.id] ? ' checked' : '') + '>Confirmo a alteração</label>';
    }
    if (s.suggestion != null) {
      h += '<div class="sug-actions"><button type="button" class="btn btn-sm btn-ok" data-dec="aceita"' + (g.needsConfirm && !st.review.confirms[s.id] ? ' disabled' : '') + '>Aceitar</button>' +
        '<button type="button" class="btn btn-sm" data-dec="rejeitada">Rejeitar</button>' +
        '<button type="button" class="btn btn-sm btn-ghost" data-goto>Ver no texto</button></div>';
    } else {
      h += '<div class="sug-actions"><button type="button" class="btn btn-sm" data-dec="ciente">Ok</button><button type="button" class="btn btn-sm btn-ghost" data-goto>Ver no texto</button></div>';
    }
    return h + '</article>';
  }
  function renderAI() {
    var r = st.review, h = '';
    if (r.status === 'loading') {
      h = '<div class="ai-progress" role="status">' + icon('loader-circle', { size: 18, cls: 'spin' }) + '<span>Analisando… <span class="tc" id="ai-elapsed">0 s</span></span>' +
        '<button type="button" class="btn btn-sm" id="btn-cancel">Cancelar</button></div>';
    } else {
      h = '<button type="button" class="btn btn-primary btn-block" id="btn-review">' + icon('sparkles', { size: 16 }) + (r.status === 'done' ? 'Revisar novamente' : 'Revisar com IA') + '</button>';
      if (r.status === 'idle') h += '<p class="field-hint">Aponta erros, repetições e trechos difíceis de ler em voz alta. Nada muda sem o seu aceite.</p>';
      if (r.status === 'error') h += '<div class="notice' + (r.error.code === 'cancelled' ? '' : ' notice-warn') + '">' + icon(r.error.code === 'offline' ? 'wifi-off' : 'info', { size: 16 }) + '<span>' + ui.esc(r.error.message) + '</span></div>';
      if (r.status === 'done') h += r.result.length ? '<div class="sugs">' + r.result.map(sugHTML).join('') + '</div>'
        : '<div class="notice">' + icon('circle-check', { size: 16 }) + '<span>Nenhum problema encontrado.</span></div>';
    }
    ui.$('#ai').innerHTML = h;
    var left = r.status === 'done' ? r.result.filter(function (s) { return !r.decisions[s.id]; }).length : 0;
    ui.$('#ai-count').textContent = left ? left + ' pendente(s)' : '';
    var b1 = ui.$('#btn-review'); if (b1) b1.addEventListener('click', startReview);
    var b2 = ui.$('#btn-cancel'); if (b2) b2.addEventListener('click', function () { r.ctrl.abort(); });
  }
  ui.$('#ai').addEventListener('change', function (e) {
    if (!e.target.matches('[data-confirm]')) return;
    var sid = e.target.closest('[data-sug]').dataset.sug;
    st.review.confirms[sid] = e.target.checked;
    var acc = ui.$('[data-sug="' + sid + '"] [data-dec=aceita]'); if (acc) acc.disabled = !e.target.checked;
  });
  ui.$('#ai').addEventListener('click', function (e) {
    var card = e.target.closest('[data-sug]'); if (!card) return;
    var s = st.review.result.filter(function (x) { return x.id === card.dataset.sug; })[0], b = getBlock(s.blockId);
    if (e.target.closest('[data-goto]')) {
      var ta = ui.$('#tx-' + s.blockId); if (!ta) return;
      var i = ta.value.indexOf(s.original);
      ta.focus(); if (i >= 0) ta.setSelectionRange(i, i + s.original.length);
      ta.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    var d = e.target.closest('[data-dec]'); if (!d || !canApprove()) return;
    var kind = d.dataset.dec, user = S.currentUser();
    if (kind === 'aceita') {
      var idx = b.text.indexOf(s.original);
      if (idx < 0) { ui.toast('O trecho não foi encontrado. Revise novamente.', 'warn'); return; }
      var ctx = GF.suggestions.context(b.text, s.original, s.suggestion);
      b.text = b.text.slice(0, idx) + s.suggestion + b.text.slice(idx + s.original.length);
      S.addRevision(script, { kind: 'ia-aceita', blockId: b.id, before: ctx.before, after: ctx.after, note: s.message });
      var ta2 = ui.$('#tx-' + b.id); if (ta2) { ta2.value = b.text; grow(ta2); }
      markDirty(true); refreshBlock(b);
    } else if (kind === 'rejeitada' && s.suggestion != null) {
      var cx = GF.suggestions.context(b.text, s.original, s.suggestion);
      S.addRevision(script, { kind: 'ia-rejeitada', blockId: b.id, before: cx ? cx.before : s.original, after: cx ? cx.after : s.suggestion, note: s.message });
      markDirty(false);
    }
    st.review.decisions[s.id] = { kind: kind, by: user.name, at: Date.now() };
    renderAI(); renderApproval();
    var nx = ui.$('#ai .sug:not(.is-done) button:not(:disabled)'); if (nx) nx.focus();
  });

  /* ---------------- ações ---------------- */
  ui.$('#btn-save').addEventListener('click', function () { save(); });
  ui.$('#btn-studio').addEventListener('click', function () { if (st.dirty) save(true); location.href = 'teleprompter.html?id=' + script.id; });
  document.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } });
  window.addEventListener('beforeunload', function (e) { if (st.dirty) { e.preventDefault(); e.returnValue = ''; } });
  GF.net.on(function () { if (st.review.status !== 'loading') renderAI(); });

  renderBlocks();
  renderSaveState();
  renderApproval();
  renderAI();
})(window.GF);
