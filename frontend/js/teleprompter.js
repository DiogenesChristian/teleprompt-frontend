/* Globo Flow — Teleprompter
 *
 * US01: roteiro em …15250 tokens truncated… + b.durationSec; }).join('§') +
      '§' + s.anchors.map(function (a) { return a.id + '|' + a.text; }).join(',') +
      '§' + (s.covers || []).map(function (c) { return c.blockId + '|' + c.text; }).join(',');
  }
  /* Aplica uma versão nova do roteiro sem reiniciar o teleprompter: tempo,
   * âncoras e posição de leitura continuam. own = salva pelo painel desta tela. */
  function applyFresh(fresh, by, own) {
    var changedBlocks = [];
    fresh.blocks.forEach(function (nb) {
      var ob = script.blocks.filter(function (b) { return b.id === nb.id; })[0];
      if (!ob || ob.text !== nb.text || ob.title !== nb.title) changedBlocks.push({ id: nb.id, parts: !ob || ob.text !== nb.text ? newParts(ob ? ob.text : '', nb.text) : [] });
    });
    var structural = structSig(fresh) !== structSig(script);
    if (!changedBlocks.length && !structural) return false;
    fresh.anchors.forEach(function (a) { if (!st.anchors[a.id]) st.anchors[a.id] = 'pendente'; });
    script = fresh;
    changedBlocks.forEach(function (c) {
      st.updated[c.id] = { at: Date.now(), parts: c.parts };
      if (blockIndexOf(c.id) !== st.cur && st.unseen.indexOf(c.id) < 0) st.unseen.push(c.id);
    });
    st.unseen = st.unseen.filter(function (x) { return blockIndexOf(x) >= 0; }); // tópicos removidos
    ui.$$('#t-prog .tick').forEach(function (t) { t.remove(); }); ticks = false; // durações podem ter mudado
    renderHeader(); renderScript(); renderRail(); renderUpdBanner(); renderTopicBar(false);
    showUpdChip();
    if (by && changedBlocks.length) ui.toast('Roteiro atualizado por ' + U.esc(by) + '.', 'info', 3000);
    if (!own && ed.open) onEditExternal();
    return true;
  }
  /* Indicador no topo: "Atualizado às 19:20" (destacado por alguns segundos). */
  var chipTimer = null;
  function showUpdChip() {
    var c = ui.$('#upd-chip');
    c.hidden = false;
    c.innerHTML = icon('refresh-cw', { size: 14 }) + '<span>Atualizado às ' + U.time(Date.now()) + '</span>';
    c.classList.add('is-fresh');
    clearTimeout(chipTimer);
    chipTimer = setTimeout(function () { c.hidden = true; }, 6000);
  }
  function newParts(a, b) {
    return GF.suggestions.diff(a, b).filter(function (p) { return p.t === 'ins' && p.v.trim().length > 3; }).map(function (p) { return p.v.trim(); });
  }
  function renderUpdBanner() {
    var bn = ui.$('#upd-banner');
    var bid = st.unseen[0];
    if (!bid) { bn.hidden = true; return; }
    var b = script.blocks[blockIndexOf(bid)];
    bn.hidden = false;
    bn.innerHTML = icon('refresh-cw', { size: 16 }) + '<span>Roteiro atualizado · ' + U.esc(b ? b.title : '') + '</span>' +
      '<button type="button" class="btn btn-sm btn-primary" data-see>Ver</button>';
    ui.$('[data-see]', bn).addEventListener('click', function () { goBlock(blockIndexOf(bid)); });
  }

  /* ---------------- edição durante a transmissão ----------------
   * Painel ao lado do texto: o teleprompter continua rodando (rolagem, tempo,
   * voz). As mudanças ficam num rascunho e só entram na tela ao salvar.
   * Ao salvar: grava no aparelho (S.saveScript) e aplica aqui com applyFresh.
   * Com backend ligado, S.saveScript também envia ao servidor, que repassa aos
   * outros teleprompters abertos neste roteiro (script:updated). */
  var ed = { open: false, draft: null, dirty: false, conflict: false, savedAt: null, fresh: {} };
  var edEl = ui.$('#live-edit');
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function syncNote() {
    return GF.api.sync.enabled() ? 'enviado aos outros aparelhos' : 'só neste navegador';
  }
  function edTopicHTML(b, i) {
    var n = ed.draft.blocks.length, isCur = script.blocks[st.cur] && script.blocks[st.cur].id === b.id;
    var missing = ed.draft.anchors.filter(function (a) { return a.blockId === b.id && b.text.indexOf(a.text) < 0; }).length;
    return '<article class="le-topic' + (isCur ? ' is-current' : '') + '" data-le-block="' + b.id + '">' +
      '<div class="le-thead">' +
        '<span class="le-num">Tópico ' + U.pad(i + 1) + '</span>' +
        '<span class="le-now">· no ar</span>' +
        '<span class="le-acts">' +
          '<button type="button" class="icon-btn" data-le="up" title="Mover para cima" aria-label="Mover tópico ' + (i + 1) + ' para cima"' + (i === 0 ? ' disabled' : '') + '>' + icon('arrow-up', { size: 16 }) + '</button>' +
          '<button type="button" class="icon-btn" data-le="down" title="Mover para baixo" aria-label="Mover tópico ' + (i + 1) + ' para baixo"' + (i === n - 1 ? ' disabled' : '') + '>' + icon('arrow-down', { size: 16 }) + '</button>' +
          '<button type="button" class="icon-btn" data-le="del" title="Excluir tópico" aria-label="Excluir tópico ' + (i + 1) + '"' + (n === 1 ? ' disabled' : '') + '>' + icon('trash-2', { size: 16 }) + '</button>' +
        '</span></div>' +
      '<label class="sr-only" for="le-t-' + b.id + '">Título do tópico ' + (i + 1) + '</label>' +
      '<input class="le-ttitle" id="le-t-' + b.id + '" data-f="title" placeholder="Título do tópico" value="' + U.esc(b.title) + '">' +
      '<label class="sr-only" for="le-x-' + b.id + '">Texto do tópico ' + (i + 1) + '</label>' +
      '<textarea class="textarea le-text" id="le-x-' + b.id + '" data-f="text" placeholder="Texto do tópico">' + U.esc(b.text) + '</textarea>' +
      (missing ? '<p class="le-warn">' + missing + (missing === 1 ? ' âncora saiu do texto' : ' âncoras saíram do texto') + '</p>' : '') +
      '</article>';
  }
  function renderEdit() {
    var d = ed.draft;
    if (ed.denied) {
      edEl.innerHTML =
        '<div class="le-head"><div class="le-head-t"><h2>Editar roteiro</h2><p class="le-sub">Somente leitura</p></div>' +
          '<button type="button" class="icon-btn" data-le="close" aria-label="Fechar edição">' + icon('x', { size: 18 }) + '</button></div>' +
        '<div class="le-body"><div class="notice notice-warn" id="le-denied" tabindex="-1">' + icon('lock', { size: 16 }) + '<span>' + U.esc(ed.deniedMsg || 'O roteiro está no ar.') +
          ' Sua alteração não foi gravada e a tela mostra a versão do servidor.</span></div></div>';
      return;
    }
    edEl.innerHTML =
      '<div class="le-head"><div class="le-head-t"><h2>Editar roteiro</h2><p class="le-sub" id="le-sub"></p></div>' +
        '<button type="button" class="icon-btn" data-le="close" aria-label="Fechar edição">' + icon('x', { size: 18 }) + '</button></div>' +
      '<div class="le-body" id="le-body">' +
        '<div class="notice notice-warn le-conflict" id="le-conflict"' + (ed.conflict ? '' : ' hidden') + '>' + icon('triangle-alert', { size: 16 }) +
          '<span>O roteiro mudou em outro lugar. ' +
          '<button type="button" class="link" data-le="reload">Carregar a versão nova</button></span></div>' +
        '<div class="field"><label for="le-title">Título principal</label><input class="input le-main" id="le-title" value="' + U.esc(d.title) + '"></div>' +
        '<div class="le-topics" id="le-topics">' + d.blocks.map(edTopicHTML).join('') + '</div>' +
        '<button type="button" class="btn add-block btn-block" data-le="add">' + icon('plus', { size: 16 }) + 'Adicionar tópico</button>' +
      '</div>' +
      '<div class="le-foot"><p class="le-state" id="le-state" role="status"></p></div>';
    ui.$$('.le-text', edEl).forEach(grow);
    renderEditState();
  }
  function grow(t) { t.style.height = 'auto'; t.style.height = Math.max(96, t.scrollHeight + 2) + 'px'; }
  function renderEditState() {
    if (!ed.open || ed.denied) return;
    var sub = ui.$('#le-sub', edEl), state = ui.$('#le-state', edEl);
    sub.textContent = st.running ? 'A leitura continua enquanto você edita' : st.started ? 'Teleprompter pausado' : 'Teleprompter não iniciado';
    state.className = 'le-state' + (ed.dirty ? ' is-dirty' : '');
    state.textContent = ed.dirty ? 'Atualizando…' : ed.savedAt ? 'Na tela desde ' + U.time(ed.savedAt) + ' · ' + syncNote()
      : 'As alterações aparecem na tela enquanto você digita.';
  }
  function markEditCurrent() {
    if (!ed.open) return;
    var cur = script.blocks[st.cur];
    ui.$$('.le-topic', edEl).forEach(function (t) { t.classList.toggle('is-current', !!cur && t.dataset.leBlock === cur.id); });
  }
  /* Toda alteração vai para a tela logo depois que a pessoa para de digitar. */
  var LIVE_MS = 600, liveTimer = null;
  function setDirty() {
    ed.dirty = true; renderEditState();
    clearTimeout(liveTimer);
    liveTimer = setTimeout(saveEdit, LIVE_MS);
  }
  /* Rola só a lista do painel (scrollIntoView rolaria a página inteira do estúdio). */
  function panelScroll(node, where) {
    var body = ui.$('#le-body', edEl); if (!body || !node) return;
    var top = node.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 12;
    if (where === 'start') body.scrollTop = top;
    else if (top < body.scrollTop) body.scrollTop = top;
    else if (top + node.offsetHeight + 24 > body.scrollTop + body.clientHeight) body.scrollTop = top + node.offsetHeight + 24 - body.clientHeight;
  }

  /* Ao abrir ou fechar em telas largas, o texto muda de largura: mantém a mesma palavra na linha de leitura. */
  function relayout(change) {
    var k = wordAtLine();
    change();
    applyPrefs(); measure();
    goWord(k);
  }
  function openEdit() {
    if (ed.open) { var f = ui.$('.le-topic.is-current', edEl); if (f) { panelScroll(f, 'start'); ui.$('.le-text', f).focus({ preventScroll: true }); } return; }
    if (st.sheet) closeSheet();
    if (st.pop) closePop();
    st.drawer = false; layoutRail();
    ed.open = true; ed.draft = clone(script); ed.dirty = false; ed.conflict = false; ed.fresh = {}; ed.logged = false; ed.savedAt = null;
    renderEdit();
    relayout(function () { edEl.hidden = false; el.body.classList.add('is-editing'); });
    ui.$('#btn-edit').setAttribute('aria-expanded', 'true');
    ui.$('#btn-edit').classList.add('is-on');
    var cur = ui.$('.le-topic.is-current', edEl);
    if (cur) { panelScroll(cur, 'start'); ui.$('.le-text', cur).focus({ preventScroll: true }); }
    else { var tt = ui.$('#le-title', edEl) || ui.$('[data-le=close]', edEl); if (tt) tt.focus({ preventScroll: true }); }
  }
  /* Servidor recusou: o roteiro está no ar e esta função não pode alterar o texto agora. */
  window.addEventListener('gf:live-edit-denied', function (e) {
    var d = e.detail || {}; if (d.id !== script.id) return;
    ed.denied = true; ed.deniedMsg = d.message; ed.dirty = false; clearTimeout(liveTimer);
    if (ed.open) {
      var typing = edEl.contains(document.activeElement);
      renderEdit();
      // quem estava digitando continua com o foco no painel: as próximas teclas não viram atalhos
      if (typing) { var c = ui.$('#le-denied', edEl); if (c) c.focus({ preventScroll: true }); } // (num botão, o espaço apertaria o botão)
    }
  });
  /* Versão nova vinda do servidor (conflito, edição recusada, sincronização). */
  window.addEventListener('gf:synced', function () { var fresh = S.getScript(script.id); if (fresh) applyFresh(fresh); });
  /* Aprovação decidida pelo servidor depois de salvar. */
  window.addEventListener('gf:status', function (e) {
    var d = e.detail || {}; if (d.id !== script.id) return;
    script.status = d.status; script.approvedBy = d.approvedBy; script.approvedAt = d.approvedAt;
    renderHeader();
    if (d.before === 'aprovado' && d.status !== 'aprovado') ui.toast('Como o texto mudou, o roteiro voltou para revisão.', 'info', 3500);
  });
  function closeEdit(force) {
    if (!ed.open) return;
    if (ed.dirty) saveEdit(); // aplica o que ainda estava esperando
    ed.open = false; ed.draft = null; ed.dirty = false;
    relayout(function () { edEl.hidden = true; el.body.classList.remove('is-editing'); });
    edEl.innerHTML = '';
    ui.$('#btn-edit').setAttribute('aria-expanded', 'false');
    ui.$('#btn-edit').classList.remove('is-on');
    ui.$('#btn-edit').focus();
  }
  function onEditExternal() {
    // Outra aba, o editor completo ou outro computador salvou enquanto o painel estava aberto.
    if (ed.denied) return;
    if (!ed.dirty) {
      var a = document.activeElement, aid = a && edEl.contains(a) && a.id, s0 = a && a.selectionStart, s1 = a && a.selectionEnd;
      var keep = ui.$('#le-body', edEl).scrollTop;
      ed.draft = clone(script); renderEdit();
      ui.$('#le-body', edEl).scrollTop = keep;
      var back = aid && document.getElementById(aid);
      if (back) { back.focus({ preventScroll: true }); try { back.setSelectionRange(s0, s1); } catch (err) { /* sem seleção */ } }
      return;
    }
    ed.conflict = true;
    var c = ui.$('#le-conflict', edEl); if (c) c.hidden = false;
  }
  function saveEdit() {
    clearTimeout(liveTimer);
    if (!ed.open || !ed.dirty || ed.denied) return;
    var d = ed.draft;
    if (!d.title.trim()) { ed.dirty = false; renderEditState(); return; } // espera ter um título principal
    var contentSig = function (s) { return s.blocks.map(function (b) { return b.id + '|' + b.text; }).join('§'); };
    var latest = S.getScript(script.id) || script;
    // Do painel vêm título, tópicos, âncoras e notas cobertas; o resto (programa, aprovação, histórico) vem da versão salva.
    var out = Object.assign(clone(latest), {
      title: d.title,
      blocks: d.blocks.map(function (b, i) { return Object.assign({}, b, { title: b.title.trim() ? b.title : 'Tópico ' + (i + 1) }); }),
      anchors: clone(d.anchors), covers: clone(d.covers || [])
    });
    var backToReview = false;
    if (contentSig(out) !== contentSig(latest)) {
      if (out.status === 'aprovado' && !GF.api.sync.enabled()) { // sem backend, a regra é local; com backend, o servidor decide
        S.addRevision(out, { kind: 'edicao', blockId: null, before: '', after: '', note: 'Roteiro alterado durante a transmissão; voltou para revisão.' });
        out.status = 'em-revisao'; out.approvedBy = null; out.approvedAt = null;
        backToReview = true; ed.logged = true;
      } else if (!ed.logged) { // um registro por sessão de edição, não um por tecla
        S.addRevision(out, { kind: 'edicao', blockId: null, before: '', after: '', note: 'Roteiro alterado durante a transmissão.' });
        ed.logged = true;
      }
    }
    S.saveScript(out);
    applyFresh(S.getScript(script.id) || out, null, true);
    ed.dirty = false; ed.conflict = false; ed.savedAt = Date.now();
    var c = ui.$('#le-conflict', edEl); if (c) c.hidden = true;
    renderEditState(); // o rascunho continua o mesmo: quem está digitando não perde o foco
    if (backToReview) ui.toast('Como o texto mudou, o roteiro voltou para revisão.', 'info', 3500);
  }

  edEl.addEventListener('input', function (e) {
    if (ed.denied) return;
    var t = e.target;
    if (t.id === 'le-title') { ed.draft.title = t.value; return setDirty(); }
    var art = t.closest('[data-le-block]'); if (!art) return;
    var b = ed.draft.blocks.filter(function (x) { return x.id === art.dataset.leBlock; })[0];
    if (t.dataset.f === 'title') b.title = t.value;
    if (t.dataset.f === 'text') { b.text = t.value; grow(t); }
    setDirty();
  });
  edEl.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-le]'); if (!btn || btn.disabled) return;
    var act = btn.dataset.le, d = ed.draft;
    if (act === 'close') return closeEdit();
    if (act === 'reload') {
      ed.draft = clone(script); ed.dirty = false; ed.conflict = false; ed.fresh = {};
      renderEdit(); return;
    }
    var art = btn.closest('[data-le-block]');
    var i = art ? d.blocks.findIndex(function (x) { return x.id === art.dataset.leBlock; }) : -1;
    function rerender(focusSel) {
      var keep = ui.$('#le-body', edEl).scrollTop;
      ui.$('#le-topics', edEl).innerHTML = d.blocks.map(edTopicHTML).join('');
      ui.$$('.le-text', edEl).forEach(grow);
      ui.$('#le-body', edEl).scrollTop = keep;
      setDirty();
      var f = focusSel && ui.$(focusSel, edEl); if (f) f.focus({ preventScroll: true });
    }
    if (act === 'add' || act === 'insert') {
      var nb = { id: U.uid('b'), title: '', durationSec: 30, text: '' };
      var at = act === 'add' ? d.blocks.length : i + 1;
      d.blocks.splice(at, 0, nb); ed.fresh[nb.id] = true;
      rerender('#le-t-' + nb.id);
      var na = ui.$('[data-le-block="' + nb.id + '"]', edEl); if (na) panelScroll(na, 'nearest');
    } else if (act === 'up' || act === 'down') {
      var b = d.blocks.splice(i, 1)[0];
      d.blocks.splice(act === 'up' ? i - 1 : i + 1, 0, b);
      rerender('[data-le-block="' + b.id + '"] [data-le=' + act + ']:not(:disabled)');
    } else if (act === 'del') {
      var del = d.blocks[i];
      ui.confirm({ title: 'Excluir tópico?', message: '“' + U.esc(del.title || 'Sem título') + '” sai do roteiro e da tela.', confirmLabel: 'Excluir', tone: 'danger' })
        .then(function (ok) {
          if (!ok) return;
          d.blocks.splice(i, 1);
          d.anchors = d.anchors.filter(function (a) { return a.blockId !== del.id; });
          d.covers = (d.covers || []).filter(function (c) { return c.blockId !== del.id; });
          rerender();
        });
    }
  });
  ui.$('#btn-edit').addEventListener('click', function () { if (ed.open) closeEdit(); else openEdit(); });

  /* ---------------- cabeçalho e rodapé ---------------- */
  function renderHeader() {
    ui.$('#s-title').textContent = script.title;
    ui.$('#s-sub').innerHTML = U.esc([script.program, script.presenter].filter(Boolean).join(' · ')) +
      (script.status !== 'aprovado' ? ' <span class="pill pill-warn">Não aprovado</span>' : '');
  }
  function renderPlay() {
    var b = ui.$('#c-play');
    if (following()) {
      b.innerHTML = icon('radio', { size: 22 }) + '<span>Assumir controle</span>';
      b.setAttribute('aria-label', 'Esta tela é a reserva de ' + (mir.controller.by || 'a tela principal') + '. Assumir o controle');
      b.title = 'Reserva de ' + (mir.controller.by || 'a tela principal') + '. Aperte para assumir o controle.';
    } else if (st.arming) {
      b.innerHTML = icon('mic', { size: 22 }) + '<span>Ouvindo…</span>';
      b.setAttribute('aria-label', 'Esperando o apresentador começar a ler. Aperte para começar já (espaço)');
      b.title = 'Esperando a leitura. Aperte para começar já.';
    } else {
      var label = st.running ? 'Pausar' : st.started ? 'Retomar' : prefs.voiceStart ? 'Iniciar pela voz' : 'Iniciar';
      b.innerHTML = icon(st.running ? 'pause' : prefs.voiceStart && !st.started ? 'mic' : 'play', { size: 22 }) + '<span>' + label + '</span>';
      b.setAttribute('aria-label', label + ' (espaço)');
      b.title = '';
    }
    b.classList.toggle('is-arming', !!st.arming);
    var t = ui.$('#tally');
    t.className = 'tally' + (st.running ? ' is-live' : '');
    t.innerHTML = '<i></i>' + (following() ? (mir.lost ? 'Principal sem resposta' : 'Reserva') : st.running ? 'No ar' : st.arming ? 'Aguardando leitura' : st.started ? 'Pausado' : 'Pronto');
    t.title = following() ? 'Reserva: acompanha ' + (mir.controller.by || 'a tela principal') : '';
    renderRole();
    renderEditState();
  }
  var ticks = false;
  function renderTiming() {
    var planned = script.durationSec || 1, e = st.elapsedMs / 1000, rem = planned - e;
    var behind = e - positionTime(), state = 'ok', label;
    if (!st.started) label = 'Pronto';
    else if (rem <= 0) { state = 'crit'; label = 'Tempo esgotado'; }
    else if (behind > Math.max(15, planned * 0.15)) { state = 'crit'; label = 'Atrasado ' + U.clock(behind); }
    else if (rem <= planned * 0.2) { state = 'warn'; label = 'Reta final'; }
    else if (behind > Math.max(5, planned * 0.06)) { state = 'warn'; label = 'Atrasado ' + U.clock(behind); }
    else if (behind < -Math.max(8, planned * 0.08)) label = 'Adiantado ' + U.clock(-behind);
    else label = st.running ? 'No ritmo' : 'Pausado';
    el.timing.className = 'timing state-' + state;
    var remTxt = rem >= 0 ? U.clock(rem) : '+' + U.clock(-rem);
    ui.$('#t-rem').textContent = remTxt;
    ui.$('#t-el').textContent = U.clock(e);
    ui.$('#t-plan').textContent = U.clock(planned);
    var mt = ui.$('#mob-time'); mt.textContent = remTxt; mt.className = 'mob-time ' + state;
    ui.$('#t-state').textContent = label;
    var pct = Math.min(100, e / planned * 100);
    ui.$('#t-fill').style.width = pct + '%';
    ui.$('#t-pos').style.left = Math.min(100, positionTime() / planned * 100) + '%';
    var prog = ui.$('#t-prog');
    prog.setAttribute('aria-valuenow', Math.round(pct));
    prog.setAttribute('aria-valuetext', U.clock(e) + ' de ' + U.clock(planned) + ', ' + label);
    if (!ticks) {
      var acc = 0;
      script.blocks.slice(0, -1).forEach(function (b) { acc += b.durationSec; prog.appendChild(ui.h('<span class="tick" style="left:' + (acc / planned * 100) + '%"></span>')); });
      ticks = true;
    }
  }

  /* ---------------- ajustes de leitura ---------------- */
  function closePop() { el.pop.innerHTML = ''; st.pop = null; }
  function openSettings() {
    if (st.pop) return closePop();
    st.pop = 'settings';
    function rng(idn, label, min, max, step, val, fmt) {
      return '<div class="field"><label for="' + idn + '">' + label + '</label><div class="range-row"><input type="range" id="' + idn + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '"><output for="' + idn + '">' + fmt(val) + '</output></div></div>';
    }
    function sw(idn, label, on) { return '<label class="switch" for="' + idn + '"><span>' + label + '</span><input type="checkbox" id="' + idn + '"' + (on ? ' checked' : '') + '><span class="track"></span></label>'; }
    el.pop.innerHTML = '<div class="settings-pop" role="dialog" aria-label="Ajustes de leitura">' +
      '<div class="pop-head"><h2>Leitura</h2><button type="button" class="icon-btn" data-closepop aria-label="Fechar">' + icon('x', { size: 18 }) + '</button></div>' +
      rng('p-font', 'Tamanho da fonte', 24, 96, 2, prefs.fontSize, function (v) { return v + 'px'; }) +
      rng('p-speed', 'Velocidade', GF.SPEED.min, GF.SPEED.max, 1, prefs.speed, function (v) { return v; }) +
      rng('p-lh', 'Espaçamento', 1.2, 2.2, 0.1, prefs.lineHeight, function (v) { return (+v).toFixed(1); }) +
      '<div class="seg seg-full" role="radiogroup" aria-label="Contraste" id="p-ct">' +
        '<button type="button" data-v="padrao" aria-pressed="' + (prefs.contrast !== 'alto') + '">Contraste padrão</button>' +
        '<button type="button" data-v="alto" aria-pressed="' + (prefs.contrast === 'alto') + '">Alto contraste</button></div>' +
      '<div class="field"><label for="p-mic">Microfone</label><select class="select" id="p-mic"><option value="">Padrão do sistema</option></select>' +
        '<p class="field-hint">Usado na voz pelo servidor. Sem backend, vale o padrão do sistema.</p></div>' +
      '<div class="pop-switches">' +
        '<div class="field"><span class="field-label">Esta tela</span><div class="seg seg-full" role="radiogroup" aria-label="Papel desta tela" id="p-role">' +
          '<button type="button" data-v="principal" aria-pressed="' + (prefs.screenRole !== 'espelho') + '">Principal</button>' +
          '<button type="button" data-v="espelho" aria-pressed="' + (prefs.screenRole === 'espelho') + '">Reserva</button></div>' +
          '<p class="field-hint">' + (mir.controller ? (controlling() ? 'Esta tela está no controle.' : 'Esta tela é a reserva de ' + U.esc(mir.controller.by || 'outra tela') + '.') : mirReady() ? 'Nenhuma tela no controle.' : 'Sem outras telas conectadas.') + '</p></div>' +
        sw('p-voicestart', 'Começar pela voz', !!prefs.voiceStart) +
        sw('p-autospeed', 'Velocidade automática', auto.on) +
        sw('p-upper', 'Texto em maiúsculas', prefs.upper !== false) +
        sw('p-mirror', 'Espelhar texto', prefs.mirror) +
        sw('p-line', 'Linha de leitura', prefs.readingLine) +
        sw('p-cues', 'Marcações técnicas', prefs.showCues) +
        sw('p-auto', 'Marcar âncora ao passar pela linha', prefs.autoMark !== false) +
      '</div>' +
      '<div class="pop-actions">' +
        '<button type="button" class="btn btn-sm" data-full>' + icon('maximize', { size: 15 }) + 'Tela cheia</button>' +
        '<button type="button" class="btn btn-sm" data-keys>' + icon('keyboard', { size: 15 }) + 'Atalhos</button>' +
        '<button type="button" class="btn btn-sm btn-danger mob-only" data-stop>Encerrar</button>' +
      '</div></div>';
    var p = ui.$('.settings-pop', el.pop);
    p.addEventListener('input', function (e) {
      var t = e.target, out = t.nextElementSibling;
      if (t.id === 'p-font') { setPref('fontSize', +t.value); out.textContent = t.value + 'px'; }
      if (t.id === 'p-speed') { setSpeed(+t.value); out.textContent = t.value; var sa = ui.$('#p-autospeed', p); if (sa) sa.checked = false; }
      if (t.id === 'p-lh') { setPref('lineHeight', +t.value); out.textContent = (+t.value).toFixed(1); }
    });
    p.addEventListener('change', function (e) {
      if (e.target.id === 'p-autospeed') setAuto(e.target.checked);
      if (e.target.id === 'p-voicestart') { prefs.voiceStart = e.target.checked; S.setPrefs(prefs); if (!prefs.voiceStart) disarm(); renderPlay(); }
      if (e.target.id === 'p-mic') {
        prefs.micId = e.target.value || null; S.setPrefs(prefs);
        if (auto.cloud) { stopCloud(); auto.source = null; startAuto(); } // troca a entrada sem parar o teleprompter
      }
      var map = { 'p-upper': 'upper', 'p-mirror': 'mirror', 'p-line': 'readingLine', 'p-cues': 'showCues', 'p-auto': 'autoMark' };
      if (map[e.target.id]) setPref(map[e.target.id], e.target.checked);
    });
    p.addEventListener('click', function (e) {
      if (e.target.closest('[data-closepop]')) return closePop();
      var rb = e.target.closest('#p-role button');
      if (rb) { setRole(rb.dataset.v); ui.$$('#p-role button', p).forEach(function (x) { x.setAttribute('aria-pressed', String(x === rb)); }); }
      var c = e.target.closest('#p-ct button');
      if (c) { setPref('contrast', c.dataset.v); ui.$$('#p-ct button', p).forEach(function (x) { x.setAttribute('aria-pressed', String(x === c)); }); }
      if (e.target.closest('[data-full]')) fullscreen();
      if (e.target.closest('[data-keys]')) { closePop(); showKeys(); }
      if (e.target.closest('[data-stop]')) { closePop(); stop(); }
    });
    fillMics(ui.$('#p-mic', p));
    ui.$('input', p).focus();
  }
  function showKeys() {
    ui.modal({
      title: 'Atalhos de teclado',
      body: '<div class="shortcuts">' + GF.keys.ACTIONS.map(function (a) { return [GF.keys.label(keyMap[a.id]), a.label]; }).concat([
        ['V', 'Velocidade automática'], ['+ −', 'Tamanho da fonte'], ['E', 'Editar roteiro sem parar'],
        ['D', 'Âncora mais próxima: dita'], ['S', 'Âncora mais próxima: pulada'],
        ['A', 'Lista de âncoras'], ['M', 'Espelhar'], ['F', 'Tela cheia'], ['L', 'Modo bloqueio (segure Esc para sair)'], ['Esc', 'Fechar painéis']
      ]).map(function (k) { return '<div><span>' + k[1] + '</span><span>' + (k[0] === '+ −' ? '<span class="kbd">+</span> <span class="kbd">−</span>' : '<span class="kbd">' + U.esc(k[0]) + '</span>') + '</span></div>'; }).join('') + '</div>' +
        '<p class="field-hint">' + (prefs.lockKeys === false ? 'No modo bloqueio, as teclas estão desligadas.' : 'No modo bloqueio, as teclas de leitura continuam funcionando, sem mostrar nada na tela.') + ' Para trocar as teclas, vá em Configurações.</p>',
      actions: [{ label: 'Fechar', tone: 'primary' }]
    });
  }
  /* ---------------- modo bloqueio ----------------
   * Só o texto na tela: some menu, barras, painéis e controles, e cliques não
   * mudam nada. As teclas de leitura (pausar, avançar, velocidade, voltar ao
   * início — configuráveis em Configurações) continuam funcionando, sem mostrar
   * nada na tela. Sair: segurar o cadeado ou a tecla Esc por 1,5 s. */
  var lock = { on: false, timer: null, fs: false };
  var HOLD_MS = 1500;
  function setLock(on) {
    if (on === lock.on) return;
    if (on) {
      if (ed.open) closeEdit();
      if (st.pop) closePop();
      if (st.sheet) closeSheet();
      st.drawer = false; layoutRail();
    }
    lock.on = on;
    relayout(function () {
      document.body.classList.toggle('is-locked', on);
      ui.$('#lock-shield').hidden = !on;
    });
    if (on) {
      // tenta a tela cheia junto; se o navegador não deixar, segue só com o bloqueio
      try { if (!document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().then(function () { lock.fs = true; }, function () {}); } catch (e) { /* opcional */ }
    } else {
      if (lock.fs && document.fullscreenElement) { try { document.exitFullscreen(); } catch (e) { /* noop */ } }
      lock.fs = false;
      ui.$('#btn-lock').focus();
    }
  }
  function holdStart() {
    if (!lock.on || lock.timer) return;
    ui.$('#lock-exit').classList.add('is-holding');
    lock.timer = setTimeout(function () { holdEnd(); setLock(false); }, HOLD_MS);
  }
  function holdEnd() {
    clearTimeout(lock.timer); lock.timer = null;
    ui.$('#lock-exit').classList.remove('is-holding');
  }
  ui.$('#btn-lock').addEventListener('click', function () { setLock(true); });
  var exitBtn = ui.$('#lock-exit');
  exitBtn.addEventListener('pointerdown', function (e) { e.preventDefault(); holdStart(); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { exitBtn.addEventListener(ev, holdEnd); });
  exitBtn.addEventListener('contextmenu', function (e) { e.preventDefault(); }); // toque longo no celular
  // a "capa" sobre o texto engole cliques, toques e rolagem do mouse
  ui.$('#lock-shield').addEventListener('wheel', function (e) { e.preventDefault(); }, { passive: false });
  document.addEventListener('keyup', function (e) { if (lock.on && e.key === 'Escape') holdEnd(); });

  function fullscreen() {
    var d = document;
    try {
      if (d.fullscreenElement) d.exitFullscreen();
      else if (d.documentElement.requestFullscreen) d.documentElement.requestFullscreen().catch(function () { ui.toast('Tela cheia não disponível neste navegador.', 'info'); });
    } catch (e) { ui.toast('Tela cheia não disponível neste navegador.', 'info'); }
  }

  /* ---------------- eventos ---------------- */
  ui.$('#c-play').addEventListener('click', toggle);
  ui.$('#c-prev').addEventListener('click', function () { goBlock(st.cur - 1); });
  ui.$('#c-next').addEventListener('click', function () { goBlock(st.cur + 1); });
  ui.$('#c-anchors').addEventListener('click', toggleRail);
  ui.$('#btn-rail').addEventListener('click', toggleRail);
  ui.$('#c-more').addEventListener('click', openSettings);
  ui.$('#btn-settings').addEventListener('click', openSettings);
  ui.$('#btn-full').addEventListener('click', fullscreen);
  ui.$('#c-stop').addEventListener('click', stop);
  ui.$('#c-slow').addEventListener('click', function () { setSpeed(prefs.speed - 1); });
  ui.$('#c-auto').addEventListener('click', function () { setAuto(!auto.on); });
  ui.$('#c-fast').addEventListener('click', function () { setSpeed(prefs.speed + 1); });
  el.script.addEventListener('click', function (e) {
    var a = e.target.closest('[data-anchor]'); if (!a) return;
    setAnchor(a.dataset.anchor, st.anchors[a.dataset.anchor] === 'dita' ? 'pendente' : 'dita');
  });
  window.addEventListener('resize', function () { applyPrefs(); layoutRail(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () {
    measure();
    if (restoreWord != null && !st.running) goWord(restoreWord); // a fonte final muda a altura das linhas
    updateCurrent(true);
  });
  document.addEventListener('click', function (e) {
    if (st.pop && !e.target.closest('#pop, #btn-settings, #c-more')) closePop();
  });
  /* Ações de leitura com tecla configurável (Configurações → Atalhos). */
  var keyMap = GF.keys.map(prefs);
  function runKey(act) {
    if (following()) { if (act === 'toggle' && (!lock.on || mir.lost)) takeOver(); return; }
    if (act === 'toggle') toggle();
    else if (act === 'faster') setSpeed(prefs.speed + 1);
    else if (act === 'slower') setSpeed(prefs.speed - 1);
    else if (act === 'next') goBlock(st.cur + 1);
    else if (act === 'prev') goBlock(st.cur - 1);
    else if (act === 'forward' || act === 'back') { setPos(st.pos + (act === 'forward' ? 1 : -1) * lineHeightPx() * 2, true); updateCurrent(true); }
    else if (act === 'restart') { setPos(0, true); updateCurrent(true); }
  }
  // atalhos trocados em outra aba (Configurações) valem na hora
  window.addEventListener('storage', function (e) {
    if (e.key !== 'globoflow:prefs') return;
    var np = S.getPrefs(); prefs.keys = np.keys; prefs.lockKeys = np.lockKeys;
    keyMap = GF.keys.map(prefs);
  });

  document.addEventListener('keydown', function (e) {
    if (lock.on) {
      // bloqueado: só as teclas de leitura funcionam, sem mostrar nada; segurar Esc desbloqueia
      e.preventDefault();
      if (e.key === 'Escape') { if (!e.repeat) holdStart(); return; }
      if (prefs.lockKeys === false || e.ctrlKey || e.metaKey || e.altKey) return;
      var la = GF.keys.action(keyMap, e.key);
      if (la && !(e.repeat && (la === 'toggle' || la === 'restart'))) runKey(la);
      return;
    }
    if (document.body.classList.contains('has-modal')) return;
    // Dentro do painel de edição, as teclas são do formulário (Esc fecha o painel).
    if (e.target.closest && e.target.closest('#live-edit')) { if (e.key === 'Escape') closeEdit(); return; }
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key;
    if (k === 'Escape') { if (st.pop) closePop(); else if (st.sheet) closeSheet(); else if (st.drawer) { st.drawer = false; layoutRail(); } else if (ed.open) closeEdit(); return; }
    if (k === 'e' || k === 'E') { e.preventDefault(); openEdit(); return; }
    var act = GF.keys.action(keyMap, k);
    if (act) {
      if (act === 'toggle' && tag === 'button') return; // espaço num botão aperta o botão
      e.preventDefault(); if (!(e.repeat && (act === 'toggle' || act === 'restart'))) runKey(act); return;
    }
    if (k === '+' || k === '=') setPref('fontSize', Math.min(96, prefs.fontSize + 4));
    else if (k === '-' || k === '_') setPref('fontSize', Math.max(24, prefs.fontSize - 4));
    else if (k === 'd' || k === 'D') markNearest('dita');
    else if (k === 's' || k === 'S') markNearest('pulada');
    else if (k === 'a' || k === 'A') toggleRail();
    else if (k === 'm' || k === 'M') setPref('mirror', !prefs.mirror);
    else if (k === 'f' || k === 'F') fullscreen();
    else if (k === 'l' || k === 'L') setLock(true);
    else if (k === 'v' || k === 'V') setAuto(!auto.on);
    else if (k === '?') showKeys();
  });

  /* ---------------- início ---------------- */
  renderHeader();
  applyPrefs();
  renderScript();
  renderRail();
  renderPlay();
  layoutRail();
  renderTiming();
  // Voltando de outra tela (editor, roteiros): retoma no mesmo ponto do texto, pausado.
  var restoreWord = restored && restored.scriptId === script.id && restored.wordIndex ? restored.wordIndex : null;
  if (restoreWord != null) goWord(restoreWord);
  connectLive();
  connectLocalMirror();

  /* sem roteiro: lista para escolher */
  function renderPicker() {
    var list = S.getScripts().slice().sort(function (a, b) { return (a.scheduledAt || 9e15) - (b.scheduledAt || 9e15); });
    root.innerHTML = '<header class="studio-bar"><a class="icon-btn" href="index.html" aria-label="Voltar">' + icon('chevron-left') + '</a>' +
      '<div class="studio-title"><b>Teleprompter</b><small>Escolha um roteiro</small></div></header>' +
      '<div class="picker">' + (list.length ? '<ul class="s-list">' + list.map(function (s) {
        return '<li class="s-row"><a class="s-main" href="teleprompter.html?id=' + s.id + '"><span class="s-title">' + U.esc(s.title) + '</span>' +
          '<span class="s-sub">' + U.esc(s.program || '') + '</span></a><span class="s-dur tc">' + U.clock(s.durationSec) + '</span>' +
          '<span class="s-status">' + ui.statusPill(s.status) + '</span></li>';
      }).join('') + '</ul>' : '<div class="empty">' + icon('file-text', { size: 32 }) + '<h2>Nenhum roteiro</h2><a class="btn btn-primary" href="index.html">Ir para Roteiros</a></div>') + '</div>';
  }
})(window.GF);
