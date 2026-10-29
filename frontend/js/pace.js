/* Globo Flow — ritmo de leitura (velocidade automática).
 *
 * Funções puras, usadas pelo teleprompter e pelos testes:
 *  - spokenWpm(): palavras por minuto a partir das palavras reconhecidas na fala.
 *  - wpmForTime(): ritmo necessário para terminar o roteiro no tempo previsto.
 *  - locate(): onde, no roteiro, está o trecho que acabou de ser falado.
 *  - clamp(): mantém a velocidade entre o mínimo e o máximo (US02).
 * Funciona no navegador (window.GF.pace) e no Node (testes).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.GF = root.GF || {}; root.GF.pace = api; }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var MIN_WPM = 80, MAX_WPM = 260;
  var CUE_RE = /\[(PAUSA|ÊNFASE|ENFASE|CÂMERA \d|CAMERA \d|VINHETA|ENTRA VT|SOBE SOM|CORTA)\]/gi;

  function clamp(wpm) { return Math.max(MIN_WPM, Math.min(MAX_WPM, wpm)); }

  /* Texto → lista de palavras sem acento, pontuação ou marcações técnicas. */
  function words(text) {
    return String(text || '').replace(CUE_RE, ' ').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/r\$/g, ' ').replace(/[^a-z0-9%\s-]/g, ' ')
      .split(/[\s-]+/).filter(Boolean);
  }

  /* times: instantes (ms) em que cada palavra foi reconhecida. */
  function spokenWpm(times, now, windowMs) {
    windowMs = windowMs || 10000;
    var recent = times.filter(function (t) { return now - t <= windowMs; });
    if (recent.length < 4) return null;
    var span = Math.max(3000, now - recent[0]);
    return recent.length / span * 60000;
  }

  /* Ritmo para terminar no tempo: palavras restantes / segundos restantes. */
  function wpmForTime(remainingWords, remainingSec) {
    if (remainingWords <= 0) return MIN_WPM;
    if (remainingSec <= 5) return MAX_WPM;
    return clamp(remainingWords / remainingSec * 60);
  }

  /* Palavras que não ajudam a achar o trecho (artigos, preposições...). */
  var STOP = {};
  ('a o e as os um uma uns umas de do da dos das no na nos nas em ao aos por para com sem que se ' +
   'mais mas como foi ser sao esta isso esse essa este ja nao sim seu sua ele ela eles elas pelo pela').split(' ')
    .forEach(function (w) { STOP[w] = true; });

  /* Mesma palavra com tolerância: uma letra trocada (erro de reconhecimento) ou
   * singular/plural. Números precisam ser iguais. */
  function lev1(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    var i = 0, j = 0, edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
  }
  function stem(w) { return w.length >= 5 ? w.replace(/(oes|aes|ais|eis|res|es|s)$/, '').slice(0, 6) : w; }
  function near(a, b) {
    if (a === b) return true;
    if (!a || !b || /\d/.test(a) || /\d/.test(b)) return false;
    return a.length >= 5 && b.length >= 5 && (lev1(a, b) || stem(a) === stem(b));
  }

  /* Procura as últimas palavras faladas no roteiro, perto da posição atual.
   * Retorna o índice da palavra seguinte ao trecho encontrado, ou -1.
   * 1º tenta o trecho exato; depois com tolerância por palavra; por fim aceita
   * que o apresentador trocou ou pulou algumas palavras (a maioria das palavras
   * com conteúdo precisa aparecer na mesma ordem). */
  function locate(scriptWords, spoken, fromIdx, ahead) {
    var tail = spoken.slice(-3);
    if (tail.length < 2) return -1;
    var start = Math.max(0, fromIdx - 15), end = Math.min(scriptWords.length, fromIdx + (ahead || 80));
    function pass(eq) {
      for (var i = start; i <= end - tail.length; i++) {
        var ok = true;
        for (var j = 0; j < tail.length; j++) if (!eq(scriptWords[i + j], tail[j])) { ok = false; break; }
        if (ok) return i + tail.length;
      }
      return -1;
    }
    var k = pass(function (a, b) { return a === b; });
    if (k < 0) k = pass(near);
    if (k < 0) k = locateLoose(scriptWords, spoken, start, end);
    return k;
  }
  function locateLoose(scriptWords, spoken, start, end) {
    var tail = spoken.filter(function (w) { return !STOP[w]; }).slice(-6);
    if (tail.length < 3) return -1;
    var need = Math.max(3, Math.ceil(tail.length * 0.6)), best = -1, bestHits = 0;
    for (var i = start; i < end; i++) {
      var j = 0, k = i, hits = 0, last = -1, lim = Math.min(scriptWords.length, i + tail.length * 2 + 4);
      while (j < tail.length && k < lim) {
        if (STOP[scriptWords[k]]) { k++; continue; }
        var found = -1;
        for (var m = k; m < Math.min(lim, k + 4); m++) if (near(scriptWords[m], tail[j])) { found = m; break; }
        if (found >= 0) { hits++; last = found; k = found + 1; }
        j++;
      }
      if (hits >= need && hits > bestHits) { bestHits = hits; best = last + 1; }
    }
    return best;
  }

  return { MIN_WPM: MIN_WPM, MAX_WPM: MAX_WPM, clamp: clamp, words: words, spokenWpm: spokenWpm, wpmForTime: wpmForTime, locate: locate, near: near };
});
