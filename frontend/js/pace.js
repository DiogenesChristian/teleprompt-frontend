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

  /* Procura as últimas palavras faladas no roteiro, perto da posição atual.
   * Retorna o índice da palavra seguinte ao trecho encontrado, ou -1. */
  function locate(scriptWords, spoken, fromIdx, ahead) {
    var tail = spoken.slice(-3);
    if (tail.length < 2) return -1;
    var start = Math.max(0, fromIdx - 15), end = Math.min(scriptWords.length, fromIdx + (ahead || 80));
    for (var i = start; i <= end - tail.length; i++) {
      var ok = true;
      for (var j = 0; j < tail.length; j++) if (scriptWords[i + j] !== tail[j]) { ok = false; break; }
      if (ok) return i + tail.length;
    }
    return -1;
  }

  return { MIN_WPM: MIN_WPM, MAX_WPM: MAX_WPM, clamp: clamp, words: words, spokenWpm: spokenWpm, wpmForTime: wpmForTime, locate: locate };
});
