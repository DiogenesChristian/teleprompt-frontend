/* Globo Flow — revisão de roteiro (US03, US04, US05).
 *
 * Este arquivo NÃO usa IA. Ele contém:
 *  1. analyze(): um verificador local por regras (gramática comum, repetição,
 *     espaçamento, frases longas, siglas). É o que roda enquanto o serviço de
 *     IA em Python não existe, e também serve de contingência se a IA cair.
 *  2. guard(): a trava editorial. Toda sugestão — do verificador local ou do
 *     futuro serviço de IA — passa por ela antes de chegar à tela:
 *       • se a sugestão traz número, data ou nome que não estava no roteiro,
 *         ela é BLOQUEADA ("a IA não deve criar fatos novos");
 *       • se altera número, data, nome ou âncora já existente, ela só pode
 *         ser aceita com confirmação explícita.
 *  3. diff(): comparação palavra a palavra entre original e sugestão.
 *
 * Nada é aplicado ao roteiro sem aceite humano (ver js/editor.js).
 * Funciona no navegador (window.GF.suggestions) e no Node (testes).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.GF = root.GF || {}; root.GF.suggestions = api; }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var CUE_RE = /\[(PAUSA|ÊNFASE|ENFASE|CÂMERA \d|CAMERA \d|VINHETA|ENTRA VT|SOBE SOM|CORTA)\]/g;
  var L = 'A-Za-zÀ-ÖØ-öø-ÿ';
  var UP = 'A-ZÀ-ÖØ-Þ';

  var STOP = ('a o e é as os um uma uns umas de do da dos das no na nos nas em ao aos à às por para com sem que se ' +
    'mais mas como foi ser são está estão isso esse essa este esta aquele aquela também já não sim seu sua seus suas ' +
    'ele ela eles elas nós você vocês muito pouco onde quando qual quais entre sobre até desde após antes depois ' +
    'pelo pela pelos pelas cada todo toda todos todas outro outra outros outras mesmo mesma ainda apenas hoje boa noite ' +
    'bom dia tarde gente nossa nosso porque pode deve vai vão foram tem têm teve isso aqui ali então').split(' ');
  var MONTHS = 'janeiro fevereiro março abril maio junho julho agosto setembro outubro novembro dezembro'.split(' ');
  var WEEKDAYS = 'segunda-feira terça-feira quarta-feira quinta-feira sexta-feira sábado domingo'.split(' ');
  var SIGLA_IGNORE = ['BR', 'VT', 'TV', 'OK', 'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XI', 'XX', 'XXI', 'R'];

  var GRAMMAR = [
    { re: /\b(H|h)ouveram\b/g, fix: function (m, h) { return h + 'ouve'; }, cat: 'Gramática', conf: 'alta',
      msg: '“Haver” no sentido de existir não vai para o plural: use “houve”.' },
    { re: /\b(A|a) nível de\b/g, fix: function (m, a) { return a === 'A' ? 'Em termos de' : 'em termos de'; }, cat: 'Gramática', conf: 'media',
      msg: '“A nível de” é considerado inadequado. Prefira “em termos de” ou reformule.' },
    { re: /\b(F|f)azem (\d+|dois|duas|três|quatro|cinco|seis|sete|oito|nove|dez) (anos|meses|dias|semanas|horas)\b/g,
      fix: function (m, f, n, u) { return f + 'az ' + n + ' ' + u; }, cat: 'Gramática', conf: 'alta',
      msg: '“Fazer” indicando tempo decorrido é impessoal: use “faz”.' },
    { re: /\bmenas\b/g, fix: function () { return 'menos'; }, cat: 'Gramática', conf: 'alta', msg: '“Menas” não existe na norma padrão: use “menos”.' },
    { re: /\b(S|s)eje\b/g, fix: function (m, s) { return s + 'eja'; }, cat: 'Gramática', conf: 'alta', msg: 'Forma correta: “seja”.' },
    { re: /\b(E|e)steje\b/g, fix: function (m, e) { return e + 'steja'; }, cat: 'Gramática', conf: 'alta', msg: 'Forma correta: “esteja”.' },
    { re: /\b(C|c)oncerteza\b/g, fix: function (m, c) { return c + 'om certeza'; }, cat: 'Gramática', conf: 'alta', msg: 'Escreve-se separado: “com certeza”.' },
    { re: /\b(D|d)errepente\b/g, fix: function (m, d) { return d + 'e repente'; }, cat: 'Gramática', conf: 'alta', msg: 'Escreve-se separado: “de repente”.' },
    { re: /\b(P|p)orisso\b/g, fix: function (m, p) { return p + 'or isso'; }, cat: 'Gramática', conf: 'alta', msg: 'Escreve-se separado: “por isso”.' },
    { re: /\b(A|a)fim de\b/g, fix: function (m, a) { return a + ' fim de'; }, cat: 'Gramática', conf: 'media',
      msg: 'Com sentido de finalidade, escreve-se “a fim de”.' },
    { re: /\bmais melhor\b/g, fix: function () { return 'melhor'; }, cat: 'Gramática', conf: 'alta', msg: '“Melhor” já é comparativo.' },
    { re: /\bentre eu e\b/g, fix: function () { return 'entre mim e'; }, cat: 'Gramática', conf: 'alta', msg: 'Depois de preposição, use “mim”.' }
  ];

  function uid() { return 's-' + Math.random().toString(36).slice(2, 9); }
  function stripCues(t) { return String(t || '').replace(CUE_RE, ' '); }
  function wordsOf(t) { return stripCues(t).match(new RegExp('[' + L + '0-9][' + L + '0-9-]*', 'g')) || []; }

  /* Intervalos ocupados por marcações técnicas — nada é sugerido dentro deles. */
  function cueRanges(text) {
    var r = [], m; CUE_RE.lastIndex = 0;
    while ((m = CUE_RE.exec(text))) r.push([m.index, m.index + m[0].length]);
    return r;
  }
  function inRanges(i, ranges) { return ranges.some(function (r) { return i >= r[0] && i < r[1]; }); }

  /* ---------- elementos protegidos ---------- */
  // Números, valores, percentuais, anos, meses, dias da semana, siglas e
  // palavras com inicial maiúscula fora do início de frase (nomes próprios).
  function protectedTokens(text) {
    var t = stripCues(text);
    var out = [];
    var numRe = /(R\$\s?)?\d[\d.,]*(\s?%|\s(mil|milhão|milhões|bilhão|bilhões|trilhão|trilhões))?/g, m;
    while ((m = numRe.exec(t))) out.push(m[0].replace(/\s+/g, ' ').trim());
    var wordRe = new RegExp('[' + L + '][' + L + '-]*', 'g');
    while ((m = wordRe.exec(t))) {
      var w = m[0], lw = w.toLowerCase();
      if (MONTHS.indexOf(lw) >= 0 || WEEKDAYS.indexOf(lw) >= 0) { out.push(lw); continue; }
      if (new RegExp('^[' + UP + ']{2,}$').test(w) && w.length <= 8) { out.push(w); continue; }
      if (new RegExp('^[' + UP + ']').test(w) && STOP.indexOf(lw) < 0) {
        var before = t.slice(0, m.index).replace(/\s+$/, '');
        var sentenceStart = before === '' || /[.!?:"“]$/.test(before);
        if (!sentenceStart) out.push(w);
      }
    }
    return out;
  }
  function multiset(arr) { var o = {}; arr.forEach(function (x) { o[x] = (o[x] || 0) + 1; }); return o; }

  /* Verifica uma sugestão aplicada ao texto do bloco inteiro. */
  function guard(blockText, original, suggestion, anchors) {
    var res = { newFacts: [], changed: [], anchors: [], blocked: false, needsConfirm: false };
    if (suggestion == null) return res;
    var idx = blockText.indexOf(original);
    if (idx < 0) { res.blocked = true; res.stale = true; return res; }
    var after = blockText.slice(0, idx) + suggestion + blockText.slice(idx + original.length);
    var a = multiset(protectedTokens(blockText)), b = multiset(protectedTokens(after));
    Object.keys(b).forEach(function (k) { if ((a[k] || 0) < b[k]) res.newFacts.push(k); });
    Object.keys(a).forEach(function (k) { if ((b[k] || 0) < a[k]) res.changed.push(k); });
    (anchors || []).forEach(function (an) {
      if (blockText.indexOf(an.text) >= 0 && after.indexOf(an.text) < 0) res.anchors.push(an.label || an.text);
    });
    res.blocked = res.newFacts.length > 0;
    res.needsConfirm = !res.blocked && (res.changed.length > 0 || res.anchors.length > 0);
    return res;
  }

  /* ---------- verificador local ---------- */
  function analyzeBlock(block, anchors, shared) {
    shared = shared || { siglas: {} };
    var text = block.text || '';
    var cues = cueRanges(text);
    var out = [];
    function push(o) {
      if (o.index != null && inRanges(o.index, cues)) return;
      o.id = uid(); o.blockId = block.id; o.blockTitle = block.title;
      if (o.suggestion != null) o.guard = guard(text, o.original, o.suggestion, anchors);
      out.push(o);
    }
    var anchorText = anchors.map(function (a) { return a.text; }).join(' ');

    GRAMMAR.forEach(function (g) {
      var m; g.re.lastIndex = 0;
      while ((m = g.re.exec(text))) {
        push({ kind: 'replace', category: g.cat, confidence: g.conf, message: g.msg, original: m[0],
          suggestion: g.fix.apply(null, m), index: m.index });
      }
    });

    // Palavra repetida em sequência ("o o")
    var dupRe = new RegExp('(^|[^' + L + '])([' + L + ']+)\\s+\\2(?![' + L + '])', 'gi'), m;
    while ((m = dupRe.exec(text))) {
      var dup = m[0].slice(m[1].length);
      push({ kind: 'replace', category: 'Repetição', confidence: 'alta', message: 'Palavra repetida em sequência.',
        original: dup, suggestion: m[2], index: m.index + m[1].length });
    }

    // Espaço duplo e espaço antes de pontuação
    var spRe = /([^\s]) {2,}([^\s])/g;
    while ((m = spRe.exec(text))) {
      push({ kind: 'replace', category: 'Pontuação', confidence: 'alta', message: 'Espaço duplo entre palavras.',
        original: m[0], suggestion: m[1] + ' ' + m[2], index: m.index });
    }
    var spp = /([^\s]) +([,.;:!?])/g;
    while ((m = spp.exec(text))) {
      push({ kind: 'replace', category: 'Pontuação', confidence: 'alta', message: 'Espaço antes da pontuação.',
        original: m[0], suggestion: m[1] + m[2], index: m.index });
    }

    // Frases longas para leitura em voz alta (US04)
    var sentRe = /[^.!?]+[.!?]+/g;
    while ((m = sentRe.exec(text))) {
      var sentence = m[0];
      var n = wordsOf(sentence).length;
      if (n <= 28) continue;
      var start = m.index;
      var split = /, (e|mas) ([a-zà-ÿ]+)/g, best = null, s2, mid = sentence.length / 2;
      while ((s2 = split.exec(sentence))) {
        if (!best || Math.abs(s2.index - mid) < Math.abs(best.index - mid)) best = s2;
      }
      if (best) {
        var next = best[2];
        var conj = best[1] === 'mas' ? 'Mas ' + next : next.charAt(0).toUpperCase() + next.slice(1);
        push({ kind: 'replace', category: 'Leitura oral', confidence: 'media',
          message: 'Frase com ' + n + ' palavras é difícil de ler em voz alta. Sugestão: dividir em duas.',
          original: best[0], suggestion: '. ' + conj, index: start + best.index });
      } else {
        push({ kind: 'alert', category: 'Leitura oral', confidence: 'media',
          message: 'Frase com ' + n + ' palavras. Considere dividir para facilitar a leitura em voz alta.',
          original: sentence.trim().slice(0, 80) + (sentence.length > 80 ? '…' : ''), suggestion: null, index: start });
      }
    }

    // Repetição de palavra em trecho curto
    var tokens = [], wr = new RegExp('[' + L + '][' + L + '-]*', 'g');
    var plain = text;
    while ((m = wr.exec(plain))) tokens.push({ w: m[0], i: m.index });
    var seen = {};
    for (var i = 0; i < tokens.length; i++) {
      var w = tokens[i].w, lw = w.toLowerCase();
      if (lw.length < 5 || STOP.indexOf(lw) >= 0 || seen[lw] || inRanges(tokens[i].i, cues)) continue;
      for (var j = i + 1; j < Math.min(tokens.length, i + 26); j++) {
        if (tokens[j].w.toLowerCase() === lw) {
          seen[lw] = true;
          var proper = /^[A-ZÀ-Þ]/.test(tokens[j].w);
          var label = tokens[j].w;
          if (proper) { // junta nomes compostos: "Defesa Civil"
            var k = 1;
            while (tokens[i + k] && tokens[j + k] && tokens[i + k].w === tokens[j + k].w && /^[A-ZÀ-Þ]/.test(tokens[j + k].w)) {
              seen[tokens[j + k].w.toLowerCase()] = true; label += ' ' + tokens[j + k].w; k++;
            }
          }
          var isAnchor = anchorText.toLowerCase().indexOf(lw) >= 0;
          push({ kind: 'alert', category: 'Repetição', confidence: proper || isAnchor ? 'baixa' : 'media',
            message: proper || isAnchor
              ? '“' + label + '” aparece duas vezes em sequência curta. Como é nome ou informação protegida, mantenha se for importante para a clareza.'
              : '“' + w + '” aparece duas vezes em sequência curta. Considere um sinônimo ou um pronome.',
            original: label, suggestion: null, index: tokens[j].i });
          break;
        }
      }
    }

    // Siglas e números difíceis de ler
    var sig = new RegExp('(?<![' + L + '])[' + UP + ']{2,6}(?![' + L + '])', 'g'), seenSig = shared.siglas;
    while ((m = sig.exec(text))) {
      var s = m[0];
      if (SIGLA_IGNORE.indexOf(s) >= 0 || seenSig[s] || inRanges(m.index, cues)) continue;
      if (text.charAt(m.index + s.length) === '-') continue; // códigos como BR-232
      seenSig[s] = true;
      push({ kind: 'alert', category: 'Termo difícil', confidence: 'media',
        message: 'Sigla “' + s + '”: confira como deve ser lida e, se o público não conhecer, diga o nome por extenso na primeira menção.',
        original: s, suggestion: null, index: m.index });
    }
    var big = /\d{1,3}(\.\d{3}){2,}/g;
    while ((m = big.exec(text))) {
      push({ kind: 'alert', category: 'Termo difícil', confidence: 'media',
        message: 'Número longo é difícil de ler em voz alta. Números são protegidos: se quiser simplificar a forma, edite manualmente.',
        original: m[0], suggestion: null, index: m.index });
    }
    var par = /\([^)]{1,80}\)/g;
    while ((m = par.exec(text))) {
      push({ kind: 'alert', category: 'Leitura oral', confidence: 'baixa',
        message: 'Parênteses não são percebidos na fala. Avalie transformar em frase ou retirar.',
        original: m[0], suggestion: null, index: m.index });
    }

    return out.sort(function (x, y) { return x.index - y.index; });
  }

  function analyze(script) {
    var anchors = script.anchors || [];
    var all = [], shared = { siglas: {} };
    (script.blocks || []).forEach(function (b) {
      all = all.concat(analyzeBlock(b, anchors.filter(function (a) { return a.blockId === b.id; }), shared));
    });
    return all;
  }

  /* ---------- diff por palavras (LCS) ---------- */
  function diff(a, b) {
    var A = String(a).split(/(\s+)/), B = String(b).split(/(\s+)/);
    var n = A.length, m = B.length, dp = [];
    for (var i = 0; i <= n; i++) { dp.push(new Array(m + 1).fill(0)); }
    for (i = n - 1; i >= 0; i--) for (var j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    var out = []; i = 0; j = 0;
    function add(t, v) { if (out.length && out[out.length - 1].t === t) out[out.length - 1].v += v; else out.push({ t: t, v: v }); }
    while (i < n && j < m) {
      if (A[i] === B[j]) { add('eq', A[i]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { add('del', A[i]); i++; }
      else { add('ins', B[j]); j++; }
    }
    while (i < n) add('del', A[i++]);
    while (j < m) add('ins', B[j++]);
    return out.filter(function (p) { return p.v !== ''; });
  }

  /* Trecho de contexto ao redor da sugestão, para exibir original × sugerido. */
  function context(blockText, original, suggestion, radius) {
    radius = radius || 60;
    var i = blockText.indexOf(original);
    if (i < 0) return null;
    var s = Math.max(0, blockText.lastIndexOf(' ', Math.max(0, i - radius)));
    var e = blockText.indexOf(' ', Math.min(blockText.length, i + original.length + radius));
    if (e < 0) e = blockText.length;
    var pre = (s > 0 ? '…' : '') + blockText.slice(s, i).replace(/^\s/, '');
    var post = blockText.slice(i + original.length, e) + (e < blockText.length ? '…' : '');
    return { before: pre + original + post, after: pre + (suggestion == null ? original : suggestion) + post };
  }

  return { analyze: analyze, analyzeBlock: analyzeBlock, guard: guard, diff: diff, context: context, protectedTokens: protectedTokens };
});
