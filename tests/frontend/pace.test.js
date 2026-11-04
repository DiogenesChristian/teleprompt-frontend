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
  assert.equal(script[k], P.words('um')[0]);
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
  assert.equal(script[k], P.words('um')[0]);
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

for (const wpm of [90, 150, 220]) {
  test(`rolagem acompanha ${wpm} ppm sem ultrapassar a fala`, () => {
    let pos = 0;
    const px = 20, dt = 1 / 60;
    for (let frame = 0; frame < 600; frame++) {
      const target = Math.floor(frame * dt * wpm / 60) * px;
      const next = P.followPosition(pos, target, wpm / 60 * px, dt);
      assert.ok(next >= pos && next <= target);
      pos = next;
    }
    const paused = pos;
    for (let frame = 0; frame < 120; frame++) pos = P.followPosition(pos, paused, 60, dt);
    assert.equal(pos, paused);
  });
}

test('retoma após repetição e mantém a posição ao reler', () => {
  const script = P.words('A ministra Helena Duarte afirmou que as obras começam pelo Nordeste.');
  const spoken = P.words('a ministra ministra Helena quer dizer Helena Duarte afirmou que as obras começam');
  const k = P.locate(script, spoken, 0);
  assert.equal(script[k], 'pelo');
  assert.equal(P.locate(script, P.words('ministra Helena Duarte'), k), -1);
});

test('não usa palavras antigas para localizar improviso', () => {
  const script = P.words('A ministra Helena Duarte anunciou obras no Nordeste.');
  assert.equal(P.locate(script, P.words('ministra Helena Duarte anunciou viagem completamente diferente'), 0), -1);
});

test('números por extenso usam a mesma posição que os algarismos', () => {
  assert.deepEqual(P.words('doze bilhões para quinze estados'), P.words('12 bilhões para 15 estados'));
});
