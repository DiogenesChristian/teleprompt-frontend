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
 * Mudanças de última hora: se o roteiro for salvo no editor (outra aba,
 * janela ou, com backend, outro computador) durante a apresentação, o texto é
 * atualizado sem perder a posição e o trecho alterado fica destacado em azul.
 *
 * Tela de transmissão: o título principal fica no topo; a barra de tópicos
 * mostra o tópico atual e os próximos. O botão "Editar roteiro" (tecla E) abre
 * um painel ao lado do texto para mudar títulos, textos e tópicos sem parar o
 * teleprompter; ao salvar, a mudança entra na tela na hora.
 * A sessão guarda a posição no texto: indo ao editor e voltando, a leitura
 * retoma no mesmo ponto.
 *
 * Com backend (GF.config.API_BASE), o teleprompter abre uma conexão em tempo
 * real (GF.api.live). A fala vai para o servidor — pela API Deepgram ou pelo
 * reconhecimento do navegador — e o servidor devolve:
 *  - âncoras ditas, marcadas sozinhas;
 *  - âncoras que ficaram para trás, que sobem na lista e pulsam;
 *  - improviso: o trecho atual esmaece e aparece o cartão de "ponte" com uma
 *    frase curta para voltar ao roteiro;
 *  - plano de corte: com o tempo apertado, o que é cortável e o que é essencial.
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
    pxPerWord: 30, sheet: null, pop: null, drawer: false, wake: null,
    behind: [], off: false, bridge: null, cut: null, serverPos: null,
    arming: false, voiceLost: false
  };
  script.anchors.forEach(function (a) { st.anchors[a.id] = 'pendente'; });
  var restored = S.getActive();
  if (restored && restored.scriptId === script.id) {
    st.started = true; st.elapsedMs = restored.elapsedMs || 0; st.startedAt = restored.startedAt;
    Object.keys(restored.anchors || {}).forEach(function (k) { if (st.anchors[k]) st.anchors[k] = restored.anchors[k]; });
  }

  function blockAnchors(b) { return script.anchors.filter(function (a) { return a.blockId === b.id; }); }
  function coverTexts(b) { return (script.covers || []).filter(function (c) { return c.blockId === b.id; }).map(function (c) { return c.text; }); }
  /* Retranca: assunto do tópico em destaque, no padrão da redação ("[09]PREVISÃO DO TEMPO"). */
  function retranca(b, i) { return '[' + U.pad(i + 1) + ']' + (b.title.trim() ? U.esc(b.title) : 'SEM TÍTULO'); }
  function blockIndexOf(bid) { return script.blocks.findIndex(function (b) { return b.id === bid; }); }
  function anchorBlockIndex(a) { return blockIndexOf(a.blockId); }

  /* ---------------- estrutura ---------------- */
  root.innerHTML =
    '<header class="studio-bar">' +
      '<a class="icon-btn" href="index.html" aria-label="Voltar aos roteiros">' + icon('chevron-left') + '</a>' +
      '<div class="studio-title"><b id="s-title"></b><small id="s-sub"></small></div>' +
      '<span class="mob-time ok" id="mob-time" aria-hidden="true">0:00</span>' +
      '<div class="studio-tools">' +
        '<span class="upd-chip" id="upd-chip" role="status" hidden></span>' +
        '<span class="tally" id="tally"></span>' +
        '<span data-conn></span>' +
        '<button type="button" class="btn btn-sm edit-btn" id="btn-edit" aria-controls="live-edit" aria-expanded="false" title="Editar o roteiro sem parar o teleprompter (E)">' + icon('square-pen', { size: 16 }) + '<span>Editar roteiro</span></button>' +
        '<button type="button" class="icon-btn" id="btn-rail" aria-label="Âncoras (A)" title="Âncoras (A)">' + icon('anchor') + '</button>' +
        '<button type="button" class="icon-btn desk-only" id="btn-settings" aria-haspopup="true" aria-label="Ajustes de leitura" title="Ajustes de leitura">' + icon('type') + '</button>' +
        '<button type="button" class="icon-btn desk-only" id="btn-full" aria-label="Tela cheia (F)" title="Tela cheia (F)">' + icon('maximize') + '</button>' +
        '<button type="button" class="icon-btn" id="btn-lock" aria-label="Modo bloqueio (L)" title="Modo bloqueio: só o texto na tela (L)">' + icon('lock') + '</button>' +
      '</div>' +
    '</header>' +
    '<nav class="topic-bar" id="topic-bar" aria-label="Tópicos do roteiro"></nav>' +
    '<div class="studio-body" id="body">' +
      '<section class="stage" id="stage" aria-label="Texto do roteiro">' +
        '<div class="scroller" id="scroller"><div class="script" id="script"></div></div>' +
        '<div class="reading-line" id="rline" aria-hidden="true"></div>' +
        '<div class="upd-banner" id="upd-banner" role="status" hidden></div>' +
        '<div class="bridge" id="bridge" role="status" aria-live="polite" hidden></div>' +
        '<div id="pop"></div>' +
        '<div class="lock-shield" id="lock-shield" hidden>' +
          '<button type="button" class="lock-exit" id="lock-exit" aria-label="Segure para desbloquear">' +
            '<span class="lock-fill" aria-hidden="true"></span>' + icon('lock', { size: 16 }) + '<span class="lock-txt">Segure para desbloquear</span></button></div>' +
      '</section>' +
      '<aside class="rail" id="rail" aria-label="Âncoras"></aside>' +
      '<aside class="live-edit" id="live-edit" aria-label="Editar roteiro durante a transmissão" hidden></aside>' +
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
        '<button type="button" class="btn ctl" id="c-prev" aria-label="Tópico anterior" title="Tópico anterior (←)">' + icon('skip-back', { size: 20 }) + '</button>' +
        '<button type="button" class="btn ctl mob-only rel" id="c-anchors" aria-label="Âncoras">' + icon('anchor', { size: 20 }) + '<span class="badge" id="c-badge" hidden></span></button>' +
        '<button type="button" class="btn btn-primary ctl ctl-play" id="c-play"></button>' +
        '<button type="button" class="btn ctl" id="c-next" aria-label="Próximo tópico" title="Próximo tópico (→)">' + icon('skip-forward', { size: 20 }) + '</button>' +
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
      '<div class="tp-head"><span class="retranca">' + retranca(b, i) + '</span>' +
        (upd ? '<span class="tp-upd">' + icon('refresh-cw', { size: 13 }) + 'Atualizado às ' + U.time(upd.at) + '</span>' : '') + '</div>' +
      '<p class="tp-text">' + GF.renderText(b.text, blockAnchors(b), { updated: upd ? upd.parts : [], covered: coverTexts(b), anchorState: anchorClass }) + '</p></div>';
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
    document.body.classList.toggle('tp-upper', prefs.upper !== false); // padrão da redação: texto em maiúsculas
    ui.$('#rline').hidden = !prefs.readingLine;
    renderSpeed();
    setTimeout(measure, 280);
  }
  function setPref(k, v) { prefs[k] = v; S.setPrefs(prefs); applyPrefs(); }
  function setSpeed(v) {
    if (auto.on && st.running) manualTakeover(); else if (auto.on) setAuto(false);
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
    if (isJump && live) live.send({ type: 'position', wordIndex: wordAtLine() });
  }
  // Rolagem feita pela pessoa (roda do mouse, toque): o manual passa a mandar.
  var userScrollAt = 0;
  ['wheel', 'touchmove'].forEach(function (ev) { el.scroller.addEventListener(ev, function () { userScrollAt = Date.now(); }, { passive: true }); });
  el.scroller.addEventListener('scroll', function () {
    var delta = Math.abs(el.scroller.scrollTop - st.pos);
    if (delta < 2) return; // rolagem do próprio motor
    st.pos = el.scroller.scrollTop;
    if (Date.now() - userScrollAt < 400) manualTakeover();
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
      renderTopicBar(changed);
      markEditCurrent();
      renderRail();
    }
  }

  /* ---------------- tópico atual e próximos ----------------
   * Hoje o tópico atual é o que está na linha de leitura (rolagem, botões ou voz).
   * Quando o serviço de IA reconhecer o assunto falado, basta chamar
   * goBlock(índice) com o tópico identificado: esta barra acompanha sozinha. */
  function renderTopicBar(animate) {
    var i = st.cur, n = script.blocks.length, b = script.blocks[i];
    if (!b) return;
    var nx = script.blocks[i + 1];
    ui.$('#topic-bar').innerHTML =
      '<div class="tb-cur" aria-live="polite">' +
        '<b class="tb-title retranca' + (animate ? ' is-new' : '') + '" title="Tópico ' + (i + 1) + ' de ' + n + '">' + retranca(b, i) + '</b></div>' +
      (nx ? '<button type="button" class="tb-next" data-goblock="' + (i + 1) + '" title="Ir para o próximo tópico">' +
          '<span class="tb-label">A seguir</span><span class="tb-next-t">' + (nx.title.trim() ? U.esc(nx.title) : 'Sem título') + '</span></button>'
        : '<span class="tb-label">Último tópico</span>');
  }
  ui.$('#topic-bar').addEventListener('click', function (e) {
    var c = e.target.closest('[data-goblock]'); if (c) goBlock(+c.dataset.goblock);
  });

  function voiceTracked() { return !!(live && live.ready && auto.source === 'voz'); }
  /* âncoras que cruzam a linha de leitura durante a rolagem contínua */
  function crossAnchors() {
    var from = st.lastPos, to = st.pos, ly = lineY(), changed = false;
    // Com a voz analisada pelo servidor, só conta como dita a âncora que foi falada de verdade.
    if (to > from && !st.jump && st.running && prefs.autoMark !== false && !voiceTracked()) {
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
  var lastPersist = 0, lastAuto = 0, lastClock = 0;
  setInterval(function () {
    var now = performance.now();
    if (st.running) { st.elapsedMs += now - (st.lastTick || now); updateCurrent(); }
    st.lastTick = now;
    if (st.running && now - lastPersist > 1000) { lastPersist = now; persist(); }
    if (now - lastAuto > 500) { lastAuto = now; autoTick(); }
    if (live && st.started && now - lastClock > 2000) { lastClock = now; live.send({ type: 'clock', elapsedSec: Math.round(st.elapsedMs / 1000), wordIndex: voiceTracked() ? null : wordAtLine() }); }
    renderTiming();
  }, 250);


  /* ---------------- velocidade automática ---------------- */
  var P = GF.pace;
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var auto = { on: !!prefs.autoSpeed, source: null, engine: null, wpm: 150, rec: null, cloud: null, times: [], spoken: [], interim: [], lastWord: 0, waiting: false, voiceFailed: false, cloudFailed: false };
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
      // segura a rolagem em silêncio ou durante o improviso (o texto não "briga" com o apresentador)
      auto.waiting = now - auto.lastWord > 3000 || st.off;
      var base = P.spokenWpm(auto.times, now) || auto.wpm;
      // corrige a posição: acelera se a fala está à frente do texto, desacelera se está atrás.
      // Com backend, a posição vem do servidor; sem ele, é calculada aqui.
      var factor = 1, k = st.serverPos && now - st.serverPos.at < 2500 ? st.serverPos.k : P.locate(scriptWords, auto.spoken.concat(auto.interim), wordAtLine());
      if (k >= 0) {
        var diff = yOfWord(k) - (el.scroller.scrollTop + lineY());
        factor = 1 + Math.max(-0.5, Math.min(0.6, diff / (el.scroller.clientHeight * 0.4)));
      }
      if (!st.off) auto.wpm = P.clamp(auto.wpm + (base * factor - auto.wpm) * 0.4); // no improviso o ritmo fica parado
    }
    renderSpeed();
  }

  function startAuto() {
    if (!auto.on || !st.running) return;
    if (auto.source === 'tempo' || auto.rec || auto.cloud) return;
    if (GF.net.online() && (canCloud() || (SR && !auto.voiceFailed))) startVoice(); else useTime();
  }
  /* Voz pela API Deepgram, através do backend (a chave fica no servidor). */
  function canCloud() {
    return !!(live && live.ready && live.deepgram && !auto.cloudFailed && navigator.mediaDevices && window.MediaRecorder);
  }
  function resetHeard() { auto.lastWord = Date.now(); auto.times = []; auto.spoken = []; auto.interim = []; }
  function startVoice() {
    if (canCloud()) return startCloud();
    if (SR && !auto.voiceFailed) return startBrowserVoice();
    useTime();
  }
  function startCloud() {
    var c = {}; auto.cloud = c; auto.source = 'voz'; auto.engine = 'deepgram'; resetHeard();
    navigator.mediaDevices.getUserMedia({ audio: micConstraints() }).catch(function (err) {
      if (!prefs.micId) throw err;
      return navigator.mediaDevices.getUserMedia({ audio: micConstraints(true) }); // microfone escolhido sumiu: usa o padrão
    }).then(function (stream) {
      if (auto.cloud !== c) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      var mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].filter(function (m) { return MediaRecorder.isTypeSupported(m); })[0];
      var rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      c.stream = stream; c.rec = rec;
      live.send({ type: 'speech:start', engine: 'deepgram', mimeType: rec.mimeType });
      rec.ondataavailable = function (e) { if (e.data && e.data.size && auto.cloud === c) live.send(e.data); };
      rec.start(250); // envia um pedaço de áudio a cada 250 ms
    }, function () {
      if (auto.cloud !== c) return;
      auto.cloud = null; auto.cloudFailed = true; auto.voiceFailed = true;
      useTime('Microfone indisponível. A velocidade segue o tempo previsto.');
    });
    renderSpeed();
  }
  /* Entrada de áudio escolhida nos ajustes (ex.: microfone externo do estúdio). */
  function micConstraints(ignoreChoice) {
    var c = { echoCancellation: true, noiseSuppression: true };
    if (prefs.micId && !ignoreChoice) c.deviceId = { exact: prefs.micId };
    return c;
  }
  function fillMics(sel) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) { sel.disabled = true; return; }
    navigator.mediaDevices.enumerateDevices().then(function (list) {
      var mics = list.filter(function (d) { return d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications'; });
      sel.innerHTML = '<option value="">Padrão do sistema</option>' + mics.map(function (d, i) {
        return '<option value="' + U.esc(d.deviceId) + '"' + (d.deviceId === prefs.micId ? ' selected' : '') + '>' + U.esc(d.label || 'Microfone ' + (i + 1)) + '</option>';
      }).join('');
    }, function () { sel.disabled = true; });
  }
  function stopCloud() {
    var c = auto.cloud; auto.cloud = null;
    if (!c) return;
    try { if (c.rec && c.rec.state !== 'inactive') c.rec.stop(); } catch (e) { /* noop */ }
    if (c.stream) c.stream.getTracks().forEach(function (t) { t.stop(); });
    if (live) live.send({ type: 'speech:stop' });
  }
  /* Texto reconhecido (navegador ou Deepgram) → ritmo e posição da fala. */
  function feedWords(text, isFinal) {
    var now = Date.now(), ws = P.words(text);
    if (isFinal) {
      ws.forEach(function () { auto.times.push(now); });
      auto.spoken = auto.spoken.concat(ws).slice(-12);
      auto.interim = [];
    } else auto.interim = ws.slice(-6);
    auto.times = auto.times.slice(-60);
    if (ws.length) auto.lastWord = now;
    // esperando a leitura começar: a fala bateu com o roteiro perto do ponto atual?
    if (st.arming && isFinal) {
      var k = P.locate(scriptWords, auto.spoken, wordAtLine(), 40);
      if (k >= 0) readingStarted(k);
    }
  }
  /* Voz pelo reconhecimento do próprio navegador (sem chave da Deepgram ou como reserva). */
  function startBrowserVoice() {
    var r;
    try { r = new SR(); } catch (e) { return useTime(); }
    r.lang = 'pt-BR'; r.continuous = true; r.interimResults = true;
    r.onresult = function (e) {
      var interim = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var txt = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          feedWords(txt, true);
          if (live) live.send({ type: 'speech:text', text: txt, final: true }); // o servidor analisa âncoras e improviso
        } else interim += ' ' + txt;
      }
      if (interim) feedWords(interim, false);
    };
    r.onerror = function (e) {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      auto.voiceFailed = true;
      useTime(e.error === 'network' ? 'Sem conexão para reconhecer a fala. A velocidade segue o tempo previsto.'
        : 'Microfone indisponível. A velocidade segue o tempo previsto.');
    };
    r.onend = function () { if (auto.rec === r && ((auto.on && st.running) || st.arming)) { try { r.start(); } catch (err) { /* reinício já em curso */ } } };
    auto.rec = r; auto.source = 'voz'; auto.engine = 'navegador'; resetHeard();
    if (live) live.send({ type: 'speech:start', engine: 'browser' });
    try { r.start(); } catch (e) { auto.rec = null; useTime(); }
    renderSpeed();
  }
  function stopVoice() {
    var r = auto.rec; auto.rec = null;
    if (r) { try { r.stop(); } catch (e) { /* noop */ } }
    stopCloud();
    if (auto.source === 'voz') auto.source = null;
    auto.engine = null;
  }
  function useTime(msg) {
    if (st.arming) { // não dá para ouvir: volta ao início manual
      disarm();
      ui.toast('Não foi possível ouvir o microfone. Aperte Iniciar para começar.', 'warn', 4500);
      return;
    }
    if (msg) st.voiceLost = true; // a voz caiu: avisar quando voltar
    var r = auto.rec; auto.rec = null;
    if (r) { try { r.abort(); } catch (e) { /* noop */ } }
    stopCloud();
    auto.source = 'tempo'; auto.engine = null; auto.waiting = false;
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
    var label = !auto.on ? '' : auto.source === 'voz' ? (st.off ? 'Auto · fora do roteiro' : auto.waiting ? 'Auto · aguardando fala' : 'Auto · voz') : auto.source === 'tempo' ? 'Auto · tempo' : 'Auto';
    ui.$('#c-speed').textContent = auto.on ? (auto.source ? Math.round(auto.wpm) : '–') : prefs.speed;
    ui.$('#c-wpm').textContent = auto.on ? (auto.source === 'voz' ? 'voz' : auto.source === 'tempo' ? 'tempo' : 'auto') : manualWpm() + ' ppm';
    var ta = ui.$('#t-auto'); ta.hidden = !auto.on; ta.textContent = label;
  }

  /* ---------------- sessão ---------------- */
  function persist() {
    // wordIndex: posição no texto, para voltar ao mesmo ponto depois de ir ao editor.
    if (st.started) S.setActive({ scriptId: script.id, startedAt: st.startedAt, elapsedMs: Math.round(st.elapsedMs), anchors: st.anchors, wordIndex: wordAtLine() });
  }
  window.addEventListener('pagehide', persist);
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
  function toggle() {
    if (st.running) return pause();
    if (st.arming) { disarm(); return play(); }        // apertou de novo: começa já, sem esperar
    if (prefs.voiceStart && !st.started) return arm(); // espera o apresentador começar a ler
    play();
  }

  /* ---------------- começar quando o apresentador começa a ler ----------------
   * Com "Começar pela voz" ligado, o botão Iniciar deixa o microfone ouvindo.
   * Quando a fala bate com o começo do roteiro (no navegador ou, com backend,
   * pelo rastreador do servidor: tracker.reading), o teleprompter começa a rolar
   * sozinho a partir do ponto que está sendo lido. */
  function arm() {
    if (!GF.net.online() || !(canCloud() || (SR && !auto.voiceFailed))) {
      ui.toast('Sem reconhecimento de voz agora (internet ou microfone). Começando no manual.', 'info', 4000);
      return play();
    }
    st.arming = true;
    renderPlay();
    startVoice();
  }
  function disarm() {
    if (!st.arming) return;
    st.arming = false;
    if (!auto.on || !st.running) stopVoice();
    renderPlay();
  }
  function readingStarted(k) {
    if (!st.arming) return;
    st.arming = false;
    if (k > 0) goWord(Math.max(0, k - 1));
    var keepVoice = auto.on;
    play();
    if (!keepVoice) stopVoice(); // sem velocidade automática, a voz só serviu para dar a largada
    ui.toast('Leitura reconhecida: o teleprompter começou.', 'ok', 2200);
  }
  function counts() {
    var c = { total: 0, dita: 0, pulada: 0, pendente: 0, risco: 0 };
    script.anchors.forEach(function (a) { c.total++; c[st.anchors[a.id]]++; if (isBehind(a)) c.risco++; });
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
      if (live) live.close();
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
    if (live) live.send({ type: 'anchor', id: aid, state: state });
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
  function isBehind(a) { return st.anchors[a.id] === 'pendente' && (isPassed(a) || st.behind.indexOf(a.id) >= 0); }
  function cutTag(a) {
    if (!st.cut || st.anchors[a.id] !== 'pendente') return '';
    if (st.cut.essential.indexOf(a.id) >= 0) return ' · <b class="a-keep">essencial</b>';
    if (st.cut.cuttable.indexOf(a.id) >= 0) return ' · <span class="a-cut">pode cortar</span>';
    return '';
  }
  function anchorItem(a, risk) {
    var s = st.anchors[a.id], t = GF.ANCHOR_TYPES[a.type] || GF.ANCHOR_TYPES.obrigatoria;
    // durante o improviso, as pendentes que ficaram para trás e a âncora da ponte pulsam
    var pulse = st.off && s === 'pendente' && (risk || (st.bridge && st.bridge.anchorId === a.id));
    var mark = s === 'dita' ? icon('check', { size: 14, stroke: 3 }) : s === 'pulada' ? icon('minus', { size: 14, stroke: 3 }) : '';
    return '<li class="anchor' + (risk ? ' is-risk' : '') + (pulse ? ' is-pulse' : '') + (st.cut && st.cut.cuttable.indexOf(a.id) >= 0 && s === 'pendente' ? ' is-cuttable' : '') + ' st-' + s + (anchorBlockIndex(a) === st.cur ? ' is-current' : '') + '">' +
      '<button type="button" class="a-check" data-toggle="' + a.id + '" aria-pressed="' + (s === 'dita') + '" aria-label="' + U.esc(a.label) + ': ' + (s === 'dita' ? 'dita' : s === 'pulada' ? 'pulada' : 'pendente') + '. Marcar como ' + (s === 'dita' ? 'pendente' : 'dita') + '">' + mark + '</button>' +
      '<button type="button" class="a-main" data-go="' + a.id + '">' +
        '<span class="a-label">' + U.esc(a.label) + (a.priority === 'essencial' ? '<span class="a-ess" title="Essencial">' + icon('star', { size: 12 }) + '</span>' : '') + '</span>' +
        '<span class="a-meta">' + t.label + ' · tópico ' + (anchorBlockIndex(a) + 1) + (risk ? ' · <b>ficou para trás</b>' : s === 'pulada' ? ' · pulada' : '') + cutTag(a) + '</span></button>' +
      '<button type="button" class="a-skip" data-skip="' + a.id + '" aria-pressed="' + (s === 'pulada') + '" title="' + (s === 'pulada' ? 'Desfazer' : 'Marcar como pulada') + '" aria-label="' + (s === 'pulada' ? 'Desfazer pulada' : 'Marcar ' + U.esc(a.label) + ' como pulada') + '">' + icon(s === 'pulada' ? 'undo-2' : 'skip-forward', { size: 15 }) + '</button></li>';
  }
  function railHTML(inSheet) {
    var c = counts();
    var list = script.anchors.filter(function (a) {
      return st.filter === 'pendentes' ? st.anchors[a.id] === 'pendente' : st.filter === 'essenciais' ? a.priority === 'essencial' : true;
    });
    var risk = list.filter(function (a) { return isBehind(a) || (st.off && st.bridge && st.bridge.anchorId === a.id && st.anchors[a.id] === 'pendente'); })
      .sort(function (a, b) { return (b.priority === 'essencial') - (a.priority === 'essencial'); });
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
        cutHTML() +
        (risk.length ? '<p class="rail-sec warn">' + (st.off ? 'Para retomar' : 'Ficaram para trás') + '</p><ul class="anchors">' + risk.map(function (a) { return anchorItem(a, true); }).join('') + '</ul>' : '') +
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
    if (ed.open) { ui.toast('Feche a edição do roteiro para ver as âncoras.', 'info', 2600); return; }
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

  /* ---------------- plano de corte ---------------- */
  function cutHTML() {
    var c = st.cut;
    if (!c) return '';
    var blocks = (c.cuttableBlocks || []).slice(0, 3);
    return '<div class="cut-note" role="status">' + icon('scissors', { size: 16 }) + '<div><b>Tempo apertado</b>' +
      '<span>O texto que falta passa do tempo em cerca de ' + U.clock(c.deficitSec) + '. Mantenha as essenciais; as cortáveis podem sair.</span>' +
      (blocks.length ? '<span>Tópicos que podem sair: ' + blocks.map(function (b) { return U.esc(b.title) + ' (−' + U.clock(b.saveSec) + ')'; }).join(', ') + '</span>' : '') +
      '</div></div>';
  }

  /* ---------------- improviso e cartão de ponte ---------------- */
  function setOffScript(on, bridge) {
    var same = on === st.off && JSON.stringify(bridge || null) === JSON.stringify(st.bridgeRaw || null);
    if (same) return;
    var was = st.off;
    st.off = on; st.bridgeRaw = bridge || null;
    if (on && (!st.bridge || !bridge || st.bridge.text !== bridge.text)) st.bridge = bridge;
    if (!on) st.bridge = null;
    el.stage.classList.toggle('is-offscript', on);
    renderBridge(); renderSpeed();
    if (was !== on) renderRail();
  }
  function renderBridge() {
    var b = ui.$('#bridge'), br = st.bridge;
    if (!br) { b.hidden = true; b.innerHTML = ''; return; }
    var resume = br.resumeText && br.resumeText.length > 110 ? br.resumeText.slice(0, 107) + '…' : br.resumeText;
    b.hidden = false;
    b.innerHTML = '<div class="bridge-head">' + icon('message-square-quote', { size: 16 }) + '<span>Fora do roteiro · sugestão de ponte</span>' +
        '<button type="button" class="icon-btn" data-dismiss aria-label="Dispensar sugestão">' + icon('x', { size: 16 }) + '</button></div>' +
      '<p class="bridge-text">“' + U.esc(br.text) + '”</p>' +
      (resume ? '<p class="bridge-resume"><small>Depois, retome em</small>' + U.esc(resume) + '</p>' : '') +
      '<button type="button" class="btn btn-sm btn-primary" data-resume>' + icon('arrow-down', { size: 15 }) + 'Ir para o trecho</button>';
  }
  ui.$('#bridge').addEventListener('click', function (e) {
    var br = st.bridge; if (!br) return;
    if (e.target.closest('[data-resume]')) { goWord(br.resumeAt); st.bridge = null; renderBridge(); }
    else if (e.target.closest('[data-dismiss]')) { st.bridge = null; renderBridge(); }
  });
  function goWord(k) {
    setPos(yOfWord(k) + lineHeightPx() * 0.5 - lineY(), true);
    updateCurrent(true);
  }

  /* ---------------- tempo real (backend) ---------------- */
  var live = null;
  function onTracker(m) {
    var marked = false;
    if (prefs.autoMark !== false) {
      Object.keys(m.anchors || {}).forEach(function (id) {
        if (m.anchors[id] === 'dita' && st.anchors[id] === 'pendente') { st.anchors[id] = 'dita'; st.auto[id] = true; marked = true; }
      });
    }
    st.serverPos = { k: m.pos, at: Date.now() };
    if (st.arming && m.reading) readingStarted(m.pos);
    var behind = m.behind || [], cut = m.cutPlan && m.cutPlan.tight ? m.cutPlan : null;
    var railChanged = marked || JSON.stringify(behind) !== JSON.stringify(st.behind) || JSON.stringify(cut) !== JSON.stringify(st.cut);
    st.behind = behind; st.cut = cut;
    setOffScript(!!m.offScript, m.offScript ? m.bridge : null);
    if (marked) { refreshAnchorMarks(); persist(); }
    if (railChanged) renderRail();
  }
  /* O operador assumiu (rolou com a mão ou mexeu na velocidade): o automático
   * desliga e só volta quando alguém apertar Auto de novo. */
  function manualTakeover() {
    if (!auto.on || !st.running) return;
    setAuto(false);
    ui.toast('Modo manual: você assumiu a rolagem. Aperte Auto para a voz voltar a guiar.', 'info', 4000);
  }
  /* A voz ou a conexão voltou depois de cair. Quem está no manual continua no
   * manual (só recebe um aviso); quem estava no automático por tempo volta a seguir a fala. */
  function voiceBack() {
    if (!st.voiceLost) return;
    st.voiceLost = false;
    auto.voiceFailed = false; auto.cloudFailed = false;
    if (!st.running) return;
    if (!auto.on) { ui.toast('A voz voltou. Você continua no manual; aperte Auto para ela guiar de novo.', 'info', 4500); return; }
    if (auto.source === 'tempo') { auto.source = null; startAuto(); ui.toast('A voz voltou: a rolagem segue a fala de novo.', 'ok', 3000); }
  }
  window.addEventListener('offline', function () { if (auto.on && auto.source === 'voz') st.voiceLost = true; });
  window.addEventListener('online', voiceBack);

  function connectLive() {
    if (!GF.api.sync.enabled()) return;
    live = GF.api.live(script.id, script);
    live.on('tracker', onTracker);
    live.on('hello', function () { live.wasReady = true; });
    live.on('speech:transcript', function (m) { if (auto.engine === 'deepgram') feedWords(m.text, m.final); });
    live.on('speech:error', function (m) {
      if (auto.engine !== 'deepgram') return;
      stopCloud(); auto.cloudFailed = true; auto.source = null;
      ui.toast((m.message || 'Falha na API de voz.') + ' Usando o reconhecimento do navegador.', 'info', 4500);
      startAuto();
    });
    live.on('open', function () {
      voiceBack();
      // reenvia o estado das âncoras marcadas antes da conexão
      Object.keys(st.anchors).forEach(function (id) { if (st.anchors[id] !== 'pendente') live.send({ type: 'anchor', id: id, state: st.anchors[id] }); });
      live.send({ type: 'position', wordIndex: wordAtLine() });
      if (auto.on && st.running && auto.engine === 'navegador' && canCloud()) { stopVoice(); startAuto(); }
    });
    live.on('close', function () {
      if (live.wasReady) st.voiceLost = true;
      if (auto.engine === 'deepgram') { stopCloud(); auto.source = null; startAuto(); }
      setOffScript(false, null);
    });
    live.on('script:updated', function (m) {
      var fresh = Object.assign({}, m.script, { syncedAt: m.script.updatedAt });
      S.putScript(fresh);
      applyFresh(S.getScript(script.id) || fresh, m.by);
    });
  }

  /* ---------------- mudanças de última hora ---------------- */
  // Mesmo navegador: o editor salva no armazenamento local e o evento "storage"
  // chega às outras abas. Outro computador: chega pelo tempo real (script:updated).
  window.addEventListener('storage', function (e) {
    if (e.key !== 'globoflow:scripts') return;
    var fresh = S.getScript(script.id);
    if (fresh) applyFresh(fresh);
  });
  // Assinatura da estrutura: título principal, ordem, títulos e duração dos tópicos, âncoras.
  function structSig(s) {
    return s.title + '§' + s.blocks.map(function (b) { return b.id + '|' + b.title + '|' + b.durationSec; }).join('§') +
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
    if (!ed.open) return;
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
    else ui.$('#le-title', edEl).focus({ preventScroll: true });
  }
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
    if (!ed.open || !ed.dirty) return;
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
      if (out.status === 'aprovado') {
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
    if (st.arming) {
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
    t.innerHTML = '<i></i>' + (st.running ? 'No ar' : st.arming ? 'Aguardando leitura' : st.started ? 'Pausado' : 'Pronto');
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
      body: '<div class="shortcuts">' + [
        ['Espaço', 'Iniciar e pausar'], ['↑ ↓', 'Velocidade'], ['V', 'Velocidade automática'], ['+ −', 'Tamanho da fonte'], ['→ ←', 'Próximo e anterior tópico'], ['E', 'Editar roteiro sem parar'],
        ['Home', 'Voltar ao início'], ['D', 'Âncora mais próxima: dita'], ['S', 'Âncora mais próxima: pulada'],
        ['A', 'Lista de âncoras'], ['M', 'Espelhar'], ['F', 'Tela cheia'], ['L', 'Modo bloqueio (segure Esc para sair)'], ['Esc', 'Fechar painéis']
      ].map(function (k) { return '<div><span>' + k[1] + '</span><span>' + k[0].split(' ').map(function (x) { return '<span class="kbd">' + x + '</span>'; }).join(' ') + '</span></div>'; }).join('') + '</div>',
      actions: [{ label: 'Fechar', tone: 'primary' }]
    });
  }
  /* ---------------- modo bloqueio ----------------
   * Só o texto na tela: some menu, barras, painéis e controles, e cliques ou
   * teclas não mudam nada (o teleprompter continua como estava, rodando ou
   * pausado). Sair: segurar o cadeado ou a tecla Esc por 1,5 s. */
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
  document.addEventListener('keydown', function (e) {
    if (lock.on) { e.preventDefault(); if (e.key === 'Escape' && !e.repeat) holdStart(); return; }
    if (document.body.classList.contains('has-modal')) return;
    // Dentro do painel de edição, as teclas são do formulário (Esc fecha o painel).
    if (e.target.closest && e.target.closest('#live-edit')) { if (e.key === 'Escape') closeEdit(); return; }
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key;
    if (k === 'Escape') { if (st.pop) closePop(); else if (st.sheet) closeSheet(); else if (st.drawer) { st.drawer = false; layoutRail(); } else if (ed.open) closeEdit(); return; }
    if (k === 'e' || k === 'E') { e.preventDefault(); openEdit(); return; }
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
