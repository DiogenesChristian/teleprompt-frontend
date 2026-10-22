/* Globo Flow — Teleprompter
 *
 * US01: roteiro em formato de teleprompter, rolagem automática, pausa,
 *       tela cheia e destaque do trecho atual.
 * US02: velocidade ajustável (botões e teclado), com mínimo e máximo.
 * US06: funciona sem internet e sem IA, com o roteiro salvo no aparelho.
 *
 * Âncoras: informações que não podem faltar (nomes, números, datas, chamadas).
 * Ficam em negrito no texto e numa lista lateral com o estado de cada uma.
 * Durante a rolagem contínua, a âncora que cruza a linha de leitura conta como
 * dita (opção que pode ser desligada). Saltos de bloco não marcam nada: as
 * âncoras puladas ficam pendentes e sobem na lista com destaque amarelo.
 *
 * Velocidade automática (botão Auto): com microfone, a rolagem acompanha o
 * ritmo da fala do apresentador e para quando ele para de falar; sem
 * microfone ou sem permissão, a velocidade se ajusta para terminar o roteiro
 * no tempo previsto. Os cálculos ficam em js/pace.js.
 *
 * Mudanças de última hora: se o roteiro for salvo no editor (outra aba ou
 * janela) durante a apresentação, o texto é atualizado sem perder a posição
 * e o trecho alterado fica destacado em azul.
 */
(function (GF) {
  if (!GF.app.boot({ page: 'estudio', title: 'Teleprompter', compactNav: true })) return;
  var ui = GF.ui, U = GF.util, icon = GF.icon, S = GF.store;
  var root = ui.$('#studio');

  var id = GF.app.param('id');
  var script = id ? S.getScript(id) : null;
  if (!script && !id) { var act = S.getActive(); if (act) script = S.getScript(act.scriptId); }
  if (!script) { renderPicker(); return; }
  GF.app.rememberScript(script.id);

  /* ---------------- estado ---------------- */
  var prefs = S.getPrefs();
  var st = {
    started: false, running: false, elapsedMs: 0, lastTick: 0, startedAt: null,
    pos: 0, lastPos: 0, jump: false, cur: 0,
    anchors: {}, auto: {}, filter: 'todas',
    updated: {}, unseen: [],
    pxPerWord: 30, sheet: null, pop: null, drawer: false, wake: null
  };
  script.anchors.forEach(function (a) { st.anchors[a.id] = 'pendente'; });
  var restored = S.getActive();
  if (restored && restored.scriptId === script.id) {
    st.started = true; st.elapsedMs = restored.elapsedMs || 0; st.startedAt = restored.startedAt;
    Object.keys(restored.anchors || {}).forEach(function (k) { if (st.anchors[k]) st.anchors[k] = restored.anchors[k]; });
  }

  function blockAnchors(b) { return script.anchors.filter(function (a) { return a.blockId === b.id; }); }
  function blockIndexOf(bid) { return script.blocks.findIndex(function (b) { return b.id === bid; }); }
  function anchorBlockIndex(a) { return blockIndexOf(a.blockId); }

  /* ---------------- estrutura ---------------- */
  root.innerHTML =
    '<header class="studio-bar">' +
      '<a class="icon-btn" href="index.html" aria-label="Voltar aos roteiros">' + icon('chevron-left') + '</a>' +
      '<div class="studio-title"><b id="s-title"></b><small id="s-sub"></small></div>' +
      '<span class="mob-time ok" id="mob-time" aria-hidden="true">0:00</span>' +
      '<div class="studio-tools">' +
        '<span class="tally" id="tally"></span>' +
        '<span data-conn></span>' +
        '<button type="button" class="icon-btn" id="btn-rail" aria-label="Âncoras (A)" title="Âncoras (A)">' + icon('anchor') + '</button>' +
        '<button type="button" class="icon-btn desk-only" id="btn-settings" aria-haspopup="true" aria-label="Ajustes de leitura" title="Ajustes de leitura">' + icon('type') + '</button>' +
        '<button type="button" class="icon-btn desk-only" id="btn-full" aria-label="Tela cheia (F)" title="Tela cheia (F)">' + icon('maximize') + '</button>' +
      '</div>' +
    '</header>' +
    '<div class="studio-body" id="body">' +
      '<section class="stage" id="stage" aria-label="Texto do roteiro">' +
        '<div class="scroller" id="scroller"><div class="script" id="script"></div></div>' +
        '<div class="reading-line" id="rline" aria-hidden="true"></div>' +
        '<div class="upd-banner" id="upd-banner" role="status" hidden></div>' +
        '<div id="pop"></div>' +
      '</section>' +
      '<aside class="rail" id="rail" aria-label="Âncoras"></aside>' +
    '</div>' +
    '<footer class="timing state-ok" id="timing">' +
      '<div class="t-time desk-only">' +
        '<b id="t-rem" class="tc">0:00</b>' +
        '<small><span id="t-el" class="tc">0:00</span> de <span id="t-plan" class="tc">0:00</span></small>' +
      '</div>' +
      '<div class="t-mid">' +
        '<div class="t-info"><span id="t-block"></span><span class="t-auto" id="t-auto" hidden></span><span class="t-state" id="t-state">Pronto</span></div>' +
        '<div class="t-progress" id="t-prog" role="progressbar" aria-label="Tempo decorrido" aria-valuemin="0" aria-valuemax="100"><span class="fill" id="t-fill"></span><span class="script-pos" id="t-pos" title="Posição no texto"></span></div>' +
      '</div>' +
      '<div class="t-controls" id="controls">' +
        '<button type="button" class="btn ctl" id="c-prev" aria-label="Bloco anterior">' + icon('skip-back', { size: 20 }) + '</button>' +
        '<button type="button" class="btn ctl mob-only rel" id="c-anchors" aria-label="Âncoras">' + icon('anchor', { size: 20 }) + '<span class="badge" id="c-badge" hidden></span></button>' +
        '<button type="button" class="btn btn-primary ctl ctl-play" id="c-play"></button>' +
        '<button type="button" class="btn ctl" id="c-next" aria-label="Próximo bloco">' + icon('skip-forward', { size: 20 }) + '</button>' +
        '<button type="button" class="btn ctl mob-only" id="c-more" aria-label="Ajustes de leitura">' + icon('type', { size: 20 }) + '</button>' +
        '<span class="speed desk-only" role="group" aria-label="Velocidade">' +
          '<button type="button" class="icon-btn" id="c-slow" aria-label="Mais devagar (seta para baixo)" title="Mais devagar (↓)">' + icon('minus', { size: 18 }) + '</button>' +
          '<span class="speed-val"><output id="c-speed" class="tc"></output><small id="c-wpm"></small></span>' +
          '<button type="button" class="icon-btn" id="c-fast" aria-label="Mais rápido (seta para cima)" title="Mais rápido (↑)">' + icon('plus', { size: 18 }) + '</button>' +
          '<button type="button" class="btn btn-sm auto-btn" id="c-auto" aria-pressed="false" title="Velocidade automática (V)">Auto</button></span>' +
        '<button type="button" class="btn btn-ghost desk-only" id="c-stop">Encerrar</button>' +
      '</div>' +
    '</footer>';

  var el = {
    stage: ui.$('#stage'), scroller: ui.$('#scroller'), script: ui.$('#script'),
    rail: ui.$('#rail'), pop: ui.$('#pop'), timing: ui.$('#timing'), body: ui.$('#body')
  };

  /* ---------------- texto ---------------- */
  function anchorClass(aid) {
    var s = st.anchors[aid];
    return s === 'dita' ? 'is-said' : s === 'pulada' ? 'is-skipped' : '';
  }
  function blockHTML(b, i) {
    var upd = st.updated[b.id];
    return '<div class="tp-block' + (upd ? ' is-updated' : '') + '" data-block="' + b.id + '">' +
      '<div class="tp-head"><span class="tc">' + U.pad(i + 1) + '</span><span>' + U.esc(b.title) + '</span>' +
        (upd ? '<span class="tp-upd">' + icon('refresh-cw', { size: 13 }) + 'Atualizado às ' + U.time(upd.at) + '</span>' : '') + '</div>' +
      '<p class="tp-text">' + GF.renderText(b.text, blockAnchors(b), { updated: upd ? upd.parts : [], anchorState: anchorClass }) + '</p></div>';
  }
  function renderScript() {
    indexWords();
    var cur = currentBlockEl();
    var ref = cur ? cur.offsetTop - el.scroller.scrollTop : null, curId = cur ? cur.dataset.block : null;
    el.script.innerHTML = script.blocks.map(blockHTML).join('') +
      '<div class="tp-end">' + icon('flag', { size: 14 }) + 'Fim do roteiro</div>';
    measure();
    if (curId) { var nb = el.script.querySelector('[data-block="' + curId + '"]'); if (nb) setPos(nb.offsetTop - ref, true); }
    updateCurrent(true);
  }
  function refreshAnchorMarks() {
    ui.$$('.anc', el.script).forEach(function (n) { n.className = 'anc ' + anchorClass(n.dataset.anchor); });
  }

  /* ---------------- leitura ---------------- */
  var LINE = 0.38;
  function lineY() { return el.scroller.clientHeight * LINE; }
  function manualWpm() { return 60 + prefs.speed * 20; } // 1 → 80 … 10 → 260 palavras por minuto
  function wpm() { return auto.on && auto.source ? Math.round(auto.wpm) : manualWpm(); }
  function applyPrefs() {
    var w = el.stage.clientWidth || window.innerWidth;
    var scale = Math.min(1, Math.max(0.6, w / 1000));
    el.script.style.setProperty('--fs', Math.round(prefs.fontSize * scale) + 'px');
    el.script.style.setProperty('--lh', prefs.lineHeight);
    el.stage.classList.toggle('is-mirror', !!prefs.mirror);
    document.body.classList.toggle('contrast-alto', prefs.contrast === 'alto');
    document.body.classList.toggle('hide-cues', !prefs.showCues);
    ui.$('#rline').hidden = !prefs.readingLine;
    renderSpeed();
    setTimeout(measure, 280);
  }
  function setPref(k, v) { prefs[k] = v; S.setPrefs(prefs); applyPrefs(); }
  function setSpeed(v) {
    if (auto.on) setAuto(false);
    setPref('speed', Math.max(GF.SPEED.min, Math.min(GF.SPEED.max, v)));
  }
  function lineHeightPx(node) {
    var fs = parseFloat(getComputedStyle(node || el.script).fontSize) || 40;
    return (parseFloat(prefs.lineHeight) || 1.5) * fs;
  }
  function measure() {
    el.script.style.paddingTop = lineY() + 'px';
    var first = el.script.querySelector('.tp-text');
    if (first) el.script.style.paddingTop = Math.max(0, 2 * lineY() - (first.offsetTop + lineHeightPx(first) * 0.55)) + 'px';
    var all = ui.$$('.tp-block', el.script);
    if (!all.length) return;
    var words = script.blocks.reduce(function (a, b) { return a + U.words(b.text); }, 0) || 1;
    var last = all[all.length - 1];
    st.pxPerWord = Math.max(4, (last.offsetTop + last.offsetHeight - all[0].offsetTop) / words);
  }
  function maxPos() { var all = ui.$$('.tp-block', el.script), l = all[all.length - 1]; return l ? l.offsetTop + l.offsetHeight - lineY() : 0; }
  function setPos(p, isJump) {
    st.pos = Math.max(0, Math.min(p, el.scroller.scrollHeight - el.scroller.clientHeight));
    if (isJump) { st.jump = true; st.lastPos = st.pos; }
    el.scroller.scrollTop = st.pos;
  }
  el.scroller.addEventListener('scroll', function () {
    var delta = Math.abs(el.scroller.scrollTop - st.pos);
    if (delta < 2) return; // rolagem do próprio motor
    st.pos = el.scroller.scrollTop;
    if (delta > el.scroller.clientHeight * 0.6) st.jump = true;
    updateCurrent();
  }, { passive: true });

  function currentBlockEl() { return el.script.querySelector('.tp-block.is-current'); }
  function blockAtLine() {
    var y = el.scroller.scrollTop + lineY(), found = 0;
    ui.$$('.tp-block', el.script).forEach(function (b, i) { if (b.offsetTop <= y + 2) found = i; });
    return found;
  }
  function anchorOffset(aid) {
    var n = el.script.querySelector('[data-anchor="' + aid + '"]');
    if (!n) return null;
    var top = 0, x = n;
    while (x && x !== el.script) { top += x.offsetTop; x = x.offsetParent; }
    return top;
  }
  function isPassed(a) { var y = anchorOffset(a.id); return y != null && y + 4 < el.scroller.scrollTop + lineY(); }
  function positionTime() {
    var blocks = ui.$$('.tp-block', el.script), y = el.scroller.scrollTop + lineY(), t = 0;
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i], d = script.blocks[i].durationSec;
      if (y >= b.offsetTop + b.offsetHeight) { t += d; continue; }
      if (y > b.offsetTop) t += d * (y - b.offsetTop) / b.offsetHeight;
      break;
    }
    return t;
  }

  function updateCurrent(force) {
    var i = blockAtLine(), changed = i !== st.cur;
    st.cur = i;
    ui.$$('.tp-block', el.script).forEach(function (b, j) {
      b.classList.toggle('is-current', j === i);
      b.classList.toggle('is-near', Math.abs(j - i) === 1);
    });
    crossAnchors();
    if (changed || force) {
      var b = script.blocks[i];
      ui.$('#t-block').textContent = (i + 1) + '/' + script.blocks.length + ' · ' + b.title;
      if (st.unseen.indexOf(b.id) >= 0) { st.unseen = st.unseen.filter(function (x) { return x !== b.id; }); renderUpdBanner(); }
      renderRail();
    }
  }

  /* âncoras que cruzam a linha de leitura durante a rolagem contínua */
  function crossAnchors() {
    var from = st.lastPos, to = st.pos, ly = lineY(), changed = false;
    if (to > from && !st.jump && st.running && prefs.autoMark !== false) {
      script.anchors.forEach(function (a) {
        if (st.anchors[a.id] !== 'pendente') return;
        var y = anchorOffset(a.id);
        if (y != null && y + 4 >= from + ly && y + 4 < to + ly) { st.anchors[a.id] = 'dita'; st.auto[a.id] = true; changed = true; }
      });
    }
    var jumped = st.jump;
    st.jump = false; st.lastPos = to;
    if (changed || jumped) { if (changed) refreshAnchorMarks(); renderRail(); persist(); }
  }

  /* ---------------- motor de rolagem e relógio ---------------- */
  var rafLast = 0;
  function frame(t) {
    if (st.running && !(auto.on && auto.waiting)) {
      var dt = rafLast ? Math.min(0.1, (t - rafLast) / 1000) : 0;
      var limit = maxPos();
      if (st.pos < limit) { st.pos = Math.min(limit, st.pos + wpm() / 60 * st.pxPerWord * dt); el.scroller.scrollTop = st.pos; }
    }
    rafLast = t;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  var lastPersist = 0, lastAuto = 0;
  setInterval(function () {
    var now = performance.now();
    if (st.running) { st.elapsedMs += now - (st.lastTick || now); updateCurrent(); }
    st.lastTick = now;
    if (st.running && now - lastPersist > 1000) { lastPersist = now; persist(); }
    if (now - lastAuto > 500) { lastAuto = now; autoTick(); }
    renderTiming();
  }, 250);


  /* ---------------- velocidade automática ---------------- */
  var P = GF.pace;
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var auto = { on: !!prefs.autoSpeed, source: null, wpm: 150, rec: null, times: [], spoken: [], interim: [], lastWord: 0, waiting: false, voiceFailed: false };
  var scriptWords = [], blockStart = [];

  function indexWords() {
    scriptWords = []; blockStart = [];
    script.blocks.forEach(function (b) { blockStart.push(scriptWords.length); scriptWords = scriptWords.concat(P.words(b.text)); });
  }
  function blockRange(i) { return [blockStart[i], i + 1 < blockStart.length ? blockStart[i + 1] : scriptWords.length]; }
  /* índice aproximado da palavra que está na linha de leitura */
  function wordAtLine() {
    var texts = ui.$$('.tp-text', el.script), y = el.scroller.scrollTop + lineY();
    for (var i = 0; i < texts.length; i++) {
      var t = texts[i], r = blockRange(i);
      if (y < t.offsetTop + t.offsetHeight) {
        var f = Math.max(0, Math.min(1, (y - t.offsetTop) / t.offsetHeight));
        return r[0] + Math.round(f * (r[1] - r[0]));
      }
    }
    return scriptWords.length;
  }
  function yOfWord(k) {
    var texts = ui.$$('.tp-text', el.script);
    for (var i = 0; i < texts.length; i++) {
      var r = blockRange(i);
      if (k < r[1] || i === texts.length - 1) return texts[i].offsetTop + (k - r[0]) / Math.max(1, r[1] - r[0]) * texts[i].offsetHeight;
    }
    return 0;
  }

  function autoTick() {
    if (!auto.on || !st.running || !auto.source) return;
    if (auto.source === 'tempo') {
      var target = P.wpmForTime(scriptWords.length - wordAtLine(), script.durationSec - st.elapsedMs / 1000);
      auto.wpm += (target - auto.wpm) * 0.3;
    } else {
      var now = Date.now();
      auto.waiting = now - auto.lastWord > 3000;
      var base = P.spokenWpm(auto.times, now) || auto.wpm;
      // corrige a posição: acelera se a fala está à frente do texto, desacelera se está atrás
      var factor = 1, k = P.locate(scriptWords, auto.spoken.concat(auto.interim), wordAtLine());
      if (k >= 0) {
        var diff = yOfWord(k) - (el.scroller.scrollTop + lineY());
        factor = 1 + Math.max(-0.5, Math.min(0.6, diff / (el.scroller.clientHeight * 0.4)));
      }
      auto.wpm = P.clamp(auto.wpm + (base * factor - auto.wpm) * 0.4);
    }
    renderSpeed();
  }

  function startAuto() {
    if (!auto.on || !st.running) return;
    if (auto.source === 'tempo' || auto.rec) return;
    if (SR && !auto.voiceFailed && GF.net.online()) startVoice(); else useTime();
  }
  function startVoice() {
    var r;
    try { r = new SR(); } catch (e) { return useTime(); }
    r.lang = 'pt-BR'; r.continuous = true; r.interimResults = true;
    r.onresult = function (e) {
      var now = Date.now(), interim = [];
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var ws = P.words(e.results[i][0].transcript);
        if (e.results[i].isFinal) {
          ws.forEach(function () { auto.times.push(now); });
          auto.spoken = auto.spoken.concat(ws).slice(-12);
        } else interim = ws;
      }
      auto.interim = interim.slice(-6);
      auto.times = auto.times.slice(-60);
      auto.lastWord = now;
    };
    r.onerror = function (e) {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      auto.voiceFailed = true;
      useTime(e.error === 'network' ? 'Sem conexão para reconhecer a fala. A velocidade segue o tempo previsto.'
        : 'Microfone indisponível. A velocidade segue o tempo previsto.');
    };
    r.onend = function () { if (auto.rec === r && auto.on && st.running) { try { r.start(); } catch (err) { /* reinício já em curso */ } } };
    auto.rec = r; auto.source = 'voz'; auto.lastWord = Date.now(); auto.times = []; auto.spoken = []; auto.interim = [];
    try { r.start(); } catch (e) { auto.rec = null; useTime(); }
    renderSpeed();
  }
  function stopVoice() {
    var r = auto.rec; auto.rec = null;
    if (r) { try { r.stop(); } catch (e) { /* noop */ } }
    if (auto.source === 'voz') auto.source = null;
  }
  function useTime(msg) {
    var r = auto.rec; auto.rec = null;
    if (r) { try { r.abort(); } catch (e) { /* noop */ } }
    auto.source = 'tempo'; auto.waiting = false;
    if (msg) ui.toast(msg, 'info', 4000);
    renderSpeed();
  }
  function setAuto(on) {
    auto.on = on; prefs.autoSpeed = on; S.setPrefs(prefs);
    stopVoice(); auto.source = null; auto.waiting = false;
    if (on) { auto.wpm = manualWpm(); startAuto(); }
    renderSpeed();
  }
  function renderSpeed() {
    var b = ui.$('#c-auto'); if (!b) return;
    b.setAttribute('aria-pressed', String(auto.on));
    b.classList.toggle('is-on', auto.on);
    var label = !auto.on ? '' : auto.source === 'voz' ? (auto.waiting ? 'Auto · aguardando fala' : 'Auto · voz') : auto.source === 'tempo' ? 'Auto · tempo' : 'Auto';
    ui.$('#c-speed').textContent = auto.on ? (auto.source ? Math.round(auto.wpm) : '–') : prefs.speed;
    ui.$('#c-wpm').textContent = auto.on ? (auto.source === 'voz' ? 'voz' : auto.source === 'tempo' ? 'tempo' : 'auto') : manualWpm() + ' ppm';
    var ta = ui.$('#t-auto'); ta.hidden = !auto.on; ta.textContent = label;
  }

  /* ---------------- sessão ---------------- */
  function persist() {
    if (st.started) S.setActive({ scriptId: script.id, startedAt: st.startedAt, elapsedMs: Math.round(st.elapsedMs), anchors: st.anchors });
  }
  function play() {
    if (!st.started) { st.started = true; st.startedAt = Date.now(); st.elapsedMs = 0; }
    st.running = true; st.lastTick = performance.now();
    try { if (navigator.wakeLock && !st.wake) navigator.wakeLock.request('screen').then(function (w) { st.wake = w; }, function () {}); } catch (e) { /* opcional */ }
    persist(); renderPlay();
    if (auto.on) startAuto();
  }
  function pause() {
    st.running = false; persist(); renderPlay();
    stopVoice(); auto.waiting = false; renderSpeed();
    try { if (st.wake) { st.wake.release(); st.wake = null; } } catch (e) { /* noop */ }
  }
  function toggle() { if (st.running) pause(); else play(); }
  function counts() {
    var c = { total: 0, dita: 0, pulada: 0, pendente: 0, risco: 0 };
    script.anchors.forEach(function (a) { c.total++; c[st.anchors[a.id]]++; if (st.anchors[a.id] === 'pendente' && isPassed(a)) c.risco++; });
    return c;
  }
  function stop() {
    if (!st.started) { location.href = 'index.html'; return; }
    var was = st.running; pause();
    var c = counts();
    ui.confirm({
      title: 'Encerrar apresentação?',
      message: 'Duração: <b class="tc" style="color:var(--fg)">' + U.clock(st.elapsedMs / 1000) + '</b> de ' + U.clock(script.durationSec) + '. Âncoras ditas: ' + c.dita + ' de ' + c.total + '. A sessão vai para o histórico.',
      confirmLabel: 'Encerrar', tone: 'danger'
    }).then(function (ok) {
      if (!ok) { if (was) play(); return; }
      S.addSession({
        id: U.uid('ss'), scriptId: script.id, scriptTitle: script.title, program: script.program, presenter: script.presenter,
        startedAt: st.startedAt || Date.now(), plannedSec: script.durationSec, realSec: Math.round(st.elapsedMs / 1000),
        anchors: { total: c.total, dita: c.dita, pulada: c.pulada, pendente: c.pendente },
        details: script.anchors.map(function (a) { return { label: a.label, type: a.type, priority: a.priority, state: st.anchors[a.id], block: (script.blocks[anchorBlockIndex(a)] || {}).title }; })
      });
      S.setActive(null);
      location.href = 'historico.html';
    });
  }

  /* ---------------- navegação ---------------- */
  function goBlock(i) {
    i = Math.max(0, Math.min(script.blocks.length - 1, i));
    var b = ui.$$('.tp-block', el.script)[i]; if (!b) return;
    var t = b.querySelector('.tp-text');
    setPos((t ? t.offsetTop : b.offsetTop) + lineHeightPx(t) * 0.55 - lineY(), true);
    updateCurrent(true);
  }
  function goAnchor(aid) {
    var y = anchorOffset(aid); if (y == null) return;
    setPos(y + lineHeightPx() * 0.5 - lineY(), true);
    updateCurrent(true);
    var n = el.script.querySelector('[data-anchor="' + aid + '"]');
    if (n) { n.classList.add('is-flash'); setTimeout(function () { n.classList.remove('is-flash'); }, 1400); }
  }
  function setAnchor(aid, state) {
    st.anchors[aid] = state; delete st.auto[aid];
    refreshAnchorMarks(); renderRail(); persist();
  }
  function markNearest(state) {
    var ly = el.scroller.scrollTop + lineY(), best = null, bd = 1e9;
    script.anchors.forEach(function (a) {
      if (st.anchors[a.id] !== 'pendente') return;
      var y = anchorOffset(a.id); if (y == null) return;
      var d = Math.abs(y - ly); if (d < bd) { bd = d; best = a; }
    });
    if (best) setAnchor(best.id, state);
  }

  /* ---------------- painel de âncoras ---------------- */
  function anchorItem(a, risk) {
    var s = st.anchors[a.id], t = GF.ANCHOR_TYPES[a.type] || GF.ANCHOR_TYPES.obrigatoria;
    var mark = s === 'dita' ? icon('check', { size: 14, stroke: 3 }) : s === 'pulada' ? icon('minus', { size: 14, stroke: 3 }) : '';
    return '<li class="anchor' + (risk ? ' is-risk' : '') + ' st-' + s + (anchorBlockIndex(a) === st.cur ? ' is-current' : '') + '">' +
      '<button type="button" class="a-check" data-toggle="' + a.id + '" aria-pressed="' + (s === 'dita') + '" aria-label="' + U.esc(a.label) + ': ' + (s === 'dita' ? 'dita' : s === 'pulada' ? 'pulada' : 'pendente') + '. Marcar como ' + (s === 'dita' ? 'pendente' : 'dita') + '">' + mark + '</button>' +
      '<button type="button" class="a-main" data-go="' + a.id + '">' +
        '<span class="a-label">' + U.esc(a.label) + (a.priority === 'essencial' ? '<span class="a-ess" title="Essencial">' + icon('star', { size: 12 }) + '</span>' : '') + '</span>' +
        '<span class="a-meta">' + t.label + ' · bloco ' + (anchorBlockIndex(a) + 1) + (risk ? ' · <b>ficou para trás</b>' : s === 'pulada' ? ' · pulada' : '') + '</span></button>' +
      '<button type="button" class="a-skip" data-skip="' + a.id + '" aria-pressed="' + (s === 'pulada') + '" title="' + (s === 'pulada' ? 'Desfazer' : 'Marcar como pulada') + '" aria-label="' + (s === 'pulada' ? 'Desfazer pulada' : 'Marcar ' + U.esc(a.label) + ' como pulada') + '">' + icon(s === 'pulada' ? 'undo-2' : 'skip-forward', { size: 15 }) + '</button></li>';
  }
  function railHTML(inSheet) {
    var c = counts();
    var list = script.anchors.filter(function (a) {
      return st.filter === 'pendentes' ? st.anchors[a.id] === 'pendente' : st.filter === 'essenciais' ? a.priority === 'essencial' : true;
    });
    var risk = list.filter(function (a) { return st.anchors[a.id] === 'pendente' && isPassed(a); });
    var rest = list.filter(function (a) { return risk.indexOf(a) < 0; })
      .sort(function (a, b) { return anchorBlockIndex(a) - anchorBlockIndex(b) || (anchorOffset(a.id) || 0) - (anchorOffset(b.id) || 0); });
    var pct = c.total ? c.dita / c.total * 100 : 0;
    return '<div class="rail-head">' +
        '<div><h2>Âncoras</h2><p class="muted"><b class="tc" style="color:var(--fg)">' + c.dita + '</b> de ' + c.total + ' ditas' + (c.pulada ? ' · ' + c.pulada + ' puladas' : '') + '</p></div>' +
        '<button type="button" class="icon-btn rail-close" data-close-rail aria-label="Fechar"' + (inSheet ? ' style="display:inline-grid"' : '') + '>' + icon('x', { size: 18 }) + '</button></div>' +
      '<div class="rail-bar" aria-hidden="true"><i style="width:' + pct + '%"></i></div>' +
      '<div class="seg seg-full" role="radiogroup" aria-label="Filtrar âncoras">' +
        [['todas', 'Todas'], ['pendentes', 'Pendentes'], ['essenciais', 'Essenciais']].map(function (f) {
          return '<button type="button" role="radio" data-filter="' + f[0] + '" aria-pressed="' + (st.filter === f[0]) + '" aria-checked="' + (st.filter === f[0]) + '">' + f[1] + '</button>';
        }).join('') + '</div>' +
      '<div class="rail-list">' +
        (risk.length ? '<p class="rail-sec warn">Ficaram para trás</p><ul class="anchors">' + risk.map(function (a) { return anchorItem(a, true); }).join('') + '</ul>' : '') +
        (rest.length ? (risk.length ? '<p class="rail-sec">No roteiro</p>' : '') + '<ul class="anchors">' + rest.map(function (a) { return anchorItem(a, false); }).join('') + '</ul>' : '') +
        (!list.length ? '<p class="muted rail-empty">' + (script.anchors.length ? 'Nada neste filtro.' : 'Este roteiro não tem âncoras. Marque-as no editor.') + '</p>' : '') +
      '</div>';
  }
  function renderRail() {
    var keep = function (host) { var l = ui.$('.rail-list', host); return l ? l.scrollTop : 0; };
    var s1 = keep(el.rail);
    el.rail.innerHTML = railHTML(false);
    var l1 = ui.$('.rail-list', el.rail); if (l1) l1.scrollTop = s1;
    if (st.sheet) {
      var host = ui.$('.sheet-content', st.sheet), s2 = keep(host);
      host.innerHTML = railHTML(true);
      var l2 = ui.$('.rail-list', host); if (l2) l2.scrollTop = s2;
    }
    var c = counts(), bd = ui.$('#c-badge');
    bd.hidden = !c.pendente; bd.textContent = c.risco || c.pendente;
    bd.classList.toggle('is-warn', !!c.risco);
  }
  function onRailClick(e) {
    var f = e.target.closest('[data-filter]'); if (f) { st.filter = f.dataset.filter; renderRail(); return; }
    var t = e.target.closest('[data-toggle]'); if (t) { setAnchor(t.dataset.toggle, st.anchors[t.dataset.toggle] === 'dita' ? 'pendente' : 'dita'); return; }
    var k = e.target.closest('[data-skip]'); if (k) { setAnchor(k.dataset.skip, st.anchors[k.dataset.skip] === 'pulada' ? 'pendente' : 'pulada'); return; }
    var g = e.target.closest('[data-go]'); if (g) { goAnchor(g.dataset.go); if (st.sheet) closeSheet(); return; }
    if (e.target.closest('[data-close-rail]')) { if (st.sheet) closeSheet(); else { st.drawer = false; layoutRail(); } }
  }
  el.rail.addEventListener('click', onRailClick);

  /* fixo (≥1280), gaveta (tablet) ou painel inferior (celular) */
  function layoutRail() {
    var w = window.innerWidth;
    el.rail.classList.toggle('is-drawer', w >= 768 && w < 1280 && st.drawer);
    el.body.classList.toggle('rail-closed', w >= 1280 && prefs.railOpen === false);
    ui.$('#btn-rail').classList.toggle('is-on', w >= 1280 ? prefs.railOpen !== false : st.drawer);
  }
  function toggleRail() {
    var w = window.innerWidth;
    if (w < 768) return st.sheet ? closeSheet() : openSheet();
    if (w < 1280) { st.drawer = !st.drawer; layoutRail(); return; }
    setPref('railOpen', prefs.railOpen === false); layoutRail();
  }
  function openSheet() {
    var bd = ui.h('<div class="sheet-backdrop"></div>');
    var sh = ui.h('<div class="sheet" role="dialog" aria-modal="true" aria-label="Âncoras"><div class="sheet-grab" aria-hidden="true"></div><div class="sheet-content"></div></div>');
    document.body.appendChild(bd); document.body.appendChild(sh);
    st.sheet = sh; st.sheetBd = bd;
    renderRail();
    sh.addEventListener('click', onRailClick);
    bd.addEventListener('click', closeSheet);
    var y0 = null;
    sh.addEventListener('touchstart', function (e) { if (e.target.closest('.sheet-grab, .rail-head')) y0 = e.touches[0].clientY; }, { passive: true });
    sh.addEventListener('touchend', function (e) { if (y0 != null && e.changedTouches[0].clientY - y0 > 60) closeSheet(); y0 = null; });
    var f = ui.$('[data-close-rail]', sh); f && f.focus();
  }
  function closeSheet() {
    if (!st.sheet) return;
    st.sheet.remove(); st.sheetBd.remove(); st.sheet = null;
    ui.$('#c-anchors').focus();
  }

  /* ---------------- mudanças de última hora ---------------- */
  // O editor salva no armazenamento local; o evento "storage" chega às outras abas.
  window.addEventListener('storage', function (e) {
    if (e.key !== 'globoflow:scripts') return;
    var fresh = S.getScript(script.id);
    if (!fresh) return;
    var changedBlocks = [];
    fresh.blocks.forEach(function (nb) {
      var ob = script.blocks.filter(function (b) { return b.id === nb.id; })[0];
      if (!ob || ob.text !== nb.text) changedBlocks.push({ id: nb.id, parts: newParts(ob ? ob.text : '', nb.text) });
    });
    var structural = fresh.blocks.length !== script.blocks.length || fresh.anchors.length !== script.anchors.length;
    if (!changedBlocks.length && !structural && fresh.title === script.title) return;
    fresh.anchors.forEach(function (a) { if (!st.anchors[a.id]) st.anchors[a.id] = 'pendente'; });
    script = fresh;
    changedBlocks.forEach(function (c) {
      st.updated[c.id] = { at: Date.now(), parts: c.parts };
      if (blockIndexOf(c.id) !== st.cur && st.unseen.indexOf(c.id) < 0) st.unseen.push(c.id);
    });
    renderHeader(); renderScript(); renderRail(); renderUpdBanner();
  });
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

  /* ---------------- cabeçalho e rodapé ---------------- */
  function renderHeader() {
    ui.$('#s-title').textContent = script.title;
    ui.$('#s-sub').innerHTML = U.esc([script.program, script.presenter].filter(Boolean).join(' · ')) +
      (script.status !== 'aprovado' ? ' <span class="pill pill-warn">Não aprovado</span>' : '');
  }
  function renderPlay() {
    var b = ui.$('#c-play');
    var label = st.running ? 'Pausar' : st.started ? 'Retomar' : 'Iniciar';
    b.innerHTML = icon(st.running ? 'pause' : 'play', { size: 22 }) + '<span>' + label + '</span>';
    b.setAttribute('aria-label', label + ' (espaço)');
    var t = ui.$('#tally');
    t.className = 'tally' + (st.running ? ' is-live' : '');
    t.innerHTML = '<i></i>' + (st.running ? 'No ar' : st.started ? 'Pausado' : 'Pronto');
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
      '<div class="pop-switches">' +
        sw('p-autospeed', 'Velocidade automática', auto.on) +
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
      var map = { 'p-mirror': 'mirror', 'p-line': 'readingLine', 'p-cues': 'showCues', 'p-auto': 'autoMark' };
      if (map[e.target.id]) setPref(map[e.target.id], e.target.checked);
    });
    p.addEventListener('click', function (e) {
      if (e.target.closest('[data-closepop]')) return closePop();
      var c = e.target.closest('#p-ct button');
      if (c) { setPref('contrast', c.dataset.v); ui.$$('#p-ct button', p).forEach(function (x) { x.setAttribute('aria-pressed', String(x === c)); }); }
      if (e.target.closest('[data-full]')) fullscreen();
      if (e.target.closest('[data-keys]')) { closePop(); showKeys(); }
      if (e.target.closest('[data-stop]')) { closePop(); stop(); }
    });
    ui.$('input', p).focus();
  }
  function showKeys() {
    ui.modal({
      title: 'Atalhos de teclado',
      body: '<div class="shortcuts">' + [
        ['Espaço', 'Iniciar e pausar'], ['↑ ↓', 'Velocidade'], ['V', 'Velocidade automática'], ['+ −', 'Tamanho da fonte'], ['→ ←', 'Próximo e anterior bloco'],
        ['Home', 'Voltar ao início'], ['D', 'Âncora mais próxima: dita'], ['S', 'Âncora mais próxima: pulada'],
        ['A', 'Lista de âncoras'], ['M', 'Espelhar'], ['F', 'Tela cheia'], ['Esc', 'Fechar painéis']
      ].map(function (k) { return '<div><span>' + k[1] + '</span><span>' + k[0].split(' ').map(function (x) { return '<span class="kbd">' + x + '</span>'; }).join(' ') + '</span></div>'; }).join('') + '</div>',
      actions: [{ label: 'Fechar', tone: 'primary' }]
    });
  }
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
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { measure(); updateCurrent(true); });
  document.addEventListener('click', function (e) {
    if (st.pop && !e.target.closest('#pop, #btn-settings, #c-more')) closePop();
  });
  document.addEventListener('keydown', function (e) {
    if (document.body.classList.contains('has-modal')) return;
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key;
    if (k === 'Escape') { if (st.pop) closePop(); else if (st.sheet) closeSheet(); else if (st.drawer) { st.drawer = false; layoutRail(); } return; }
    if (k === ' ' && tag !== 'button') { e.preventDefault(); toggle(); }
    else if (k === 'ArrowUp') { e.preventDefault(); setSpeed(prefs.speed + 1); }
    else if (k === 'ArrowDown') { e.preventDefault(); setSpeed(prefs.speed - 1); }
    else if (k === 'ArrowRight' || k === 'PageDown') { e.preventDefault(); goBlock(st.cur + 1); }
    else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); goBlock(st.cur - 1); }
    else if (k === 'Home') { e.preventDefault(); setPos(0, true); updateCurrent(true); }
    else if (k === '+' || k === '=') setPref('fontSize', Math.min(96, prefs.fontSize + 4));
    else if (k === '-' || k === '_') setPref('fontSize', Math.max(24, prefs.fontSize - 4));
    else if (k === 'd' || k === 'D') markNearest('dita');
    else if (k === 's' || k === 'S') markNearest('pulada');
    else if (k === 'a' || k === 'A') toggleRail();
    else if (k === 'm' || k === 'M') setPref('mirror', !prefs.mirror);
    else if (k === 'f' || k === 'F') fullscreen();
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
