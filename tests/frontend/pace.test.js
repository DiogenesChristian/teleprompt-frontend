/* Velocidade automática (documentação: "estima o ritmo de leitura e ajusta a
 * velocidade de rolagem conforme o apresentador"). Rodar com: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../frontend/js/pace.js');

test('normaliza o texto falado e ignora marcações técnicas', () => {
  assert.deepEqual(P.words('[CÂMERA 1] Olá, Ministério! R$ 12 bilhões'), ['ola', 'ministerio', '12', 'bilhoes']);
});

test('ritmo da fala: 30 palavras em 12 s ≈ 150 palavras/min', () => {
  const now = 100000;
  const times = Array.from({ length: 30 }, (_, i) => now - 12000 + i * 400);
  assert.equal(Math.round(P.spokenWpm(times, now, 15000)), 150);
});

test('ritmo da fala: poucas palavras ainda não definem ritmo', () => {
  assert.equal(P.spokenWpm([1000, 1200], 1500), null);
});

test('ritmo pelo tempo: 300 palavras em 2 min = 150 palavras/min', () => {
  assert.equal(P.wpmForTime(300, 120), 150);
});

test('ritmo pelo tempo respeita mínimo e máximo', () => {
  assert.equal(P.wpmForTime(10, 600), P.MIN_WPM);
  assert.equal(P.wpmForTime(900, 60), P.MAX_WPM);
  assert.equal(P.wpmForTime(100, 2), P.MAX_WPM);
  assert.equal(P.wpmForTime(0, 60), P.MIN_WPM);
});

test('localiza no roteiro o trecho que acabou de ser falado', () => {
  const script = P.words('Boa noite. O governo anunciou hoje um novo pacote de investimentos em infraestrutura.');
  const spoken = P.words('o governo anunciou hoje');
  const k = P.locate(script, spoken, 0);
  assert.equal(script[k], 'um');
});

test('não localiza fala que não está no roteiro', () => {
  const script = P.words('Boa noite. O governo anunciou hoje um novo pacote.');
  assert.equal(P.locate(script, P.words('vamos ao intervalo'), 0), -1);
});

test('busca só perto da posição atual', () => {
  const script = P.words('a b c d e f ' + 'x '.repeat(200) + 'a b c');
  assert.equal(P.locate(script, ['b', 'c'], 0), 3);
});

/* ---------- ajustes da voz (Louise) ---------- */

test('localiza com uma letra errada no reconhecimento', () => {
  const script = P.words('Boa noite. O governo anunciou hoje um novo pacote de investimentos.');
  const k = P.locate(script, P.words('governu anunciou hoje'), 0);
  assert.equal(script[k], 'um');
});

test('localiza quando o apresentador troca algumas palavras', () => {
  const script = P.words('O Governo Federal anunciou hoje um pacote de R$ 12 bilhões para 15 estados brasileiros a partir de janeiro.');
  const spoken = P.words('o governo federal divulgou nesta segunda um pacote de doze bilhões para 15 estados');
  const k = P.locate(script, spoken, 0);
  assert.equal(script[k - 1], 'estados');
});

test('palavra no singular ou plural conta como a mesma', () => {
  assert.ok(P.near('estados', 'estado'));
  assert.ok(!P.near('12', '13'));
});
