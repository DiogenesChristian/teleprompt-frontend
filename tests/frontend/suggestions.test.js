/* Testes da revisão de roteiro e da trava editorial (seção 2.2 da documentação).
 * Rodar com:  node --test tests/
 * Fluxo verificado: texto original → resposta (sugestões) → decisão humana → resultado esperado.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../frontend/js/suggestions.js');

const block = (text, id = 'b1') => ({ id, title: 'Bloco', text });
const run = (text, anchors = []) => S.analyze({ blocks: [block(text)], anchors });
const apply = (text, s) => text.replace(s.original, s.suggestion);

test('erro gramatical: “houveram” vira “houve”, sem alterar o resto', () => {
  const text = 'Houveram registros de alagamento em 12 bairros.';
  const s = run(text).find((x) => x.category === 'Gramática');
  assert.ok(s, 'deveria sugerir correção');
  assert.equal(s.suggestion, 'Houve');
  assert.equal(apply(text, s), 'Houve registros de alagamento em 12 bairros.');
  assert.equal(s.guard.blocked, false);
  assert.equal(s.guard.needsConfirm, false);
});

test('a sugestão nunca altera o texto original sozinha', () => {
  const script = { blocks: [block('Houveram registros.')], anchors: [] };
  S.analyze(script);
  assert.equal(script.blocks[0].text, 'Houveram registros.');
});

test('texto sem erros não gera sugestões de troca', () => {
  const list = run('Boa noite. O governo anunciou hoje um novo pacote de investimentos.');
  assert.equal(list.filter((x) => x.kind === 'replace').length, 0);
});

test('palavra repetida em sequência e espaço duplo', () => {
  const list = run('Ligue para o o 199.  A central funciona 24 horas.');
  assert.ok(list.some((x) => x.original === 'o o' && x.suggestion === 'o'));
  assert.ok(list.some((x) => x.category === 'Pontuação'));
});

test('frase longa recebe sugestão de divisão sem mudar números', () => {
  const text = 'A agência registrou 86 milímetros de chuva em seis horas, o que equivale a quase metade do volume esperado para o mês inteiro, e a previsão indica que a chuva deve continuar ao longo da tarde e também durante a noite.';
  const s = run(text).find((x) => x.category === 'Leitura oral' && x.kind === 'replace');
  assert.ok(s);
  const after = apply(text, s);
  assert.match(after, /\. A previsão/);
  assert.equal(s.guard.changed.length, 0);
  assert.equal(s.guard.newFacts.length, 0);
});

test('sigla gera alerta, não substituição', () => {
  const s = run('A APAC confirmou o alerta.').find((x) => x.category === 'Termo difícil');
  assert.ok(s);
  assert.equal(s.suggestion, null);
});

test('marcações técnicas não são analisadas como texto', () => {
  const list = run('[CÂMERA 1] Olá. [PAUSA] Bom domingo.');
  assert.ok(!list.some((x) => /CÂMERA|PAUSA/.test(x.original)));
});

/* ---------- trava editorial ---------- */

test('bloqueia sugestão que cria fato novo (número inexistente)', () => {
  const text = 'O programa prevê R$ 12 bilhões em recursos.';
  const g = S.guard(text, 'em recursos.', 'em recursos e 40 mil empregos.', []);
  assert.equal(g.blocked, true);
  assert.deepEqual(g.newFacts, ['40 mil']);
});

test('bloqueia sugestão que troca um valor', () => {
  const text = 'O programa prevê R$ 12 bilhões em recursos.';
  const g = S.guard(text, 'R$ 12 bilhões', 'R$ 15 bilhões', [{ text: 'R$ 12 bilhões', label: 'Valor' }]);
  assert.equal(g.blocked, true);
  assert.ok(g.changed.includes('R$ 12 bilhões'));
});

test('exige confirmação ao remover nome próprio ou âncora', () => {
  const text = 'A ministra Helena Duarte afirmou que as obras começam em janeiro.';
  const g = S.guard(text, 'A ministra Helena Duarte afirmou', 'A ministra afirmou', [{ text: 'Helena Duarte', label: 'Ministra' }]);
  assert.equal(g.blocked, false);
  assert.equal(g.needsConfirm, true);
  assert.ok(g.changed.includes('Helena') && g.changed.includes('Duarte'));
  assert.deepEqual(g.anchors, ['Ministra']);
});

test('exige confirmação ao alterar data', () => {
  const text = 'As obras começam em janeiro.';
  const g = S.guard(text, 'em janeiro', 'no começo do ano', []);
  assert.equal(g.needsConfirm, true);
  assert.ok(g.changed.includes('janeiro'));
});

test('sugestão sobre trecho que mudou depois da revisão é bloqueada', () => {
  const g = S.guard('Texto novo.', 'Texto antigo', 'Texto revisado', []);
  assert.equal(g.blocked, true);
  assert.equal(g.stale, true);
});

test('início de frase em maiúscula não conta como nome próprio', () => {
  const text = 'Chove forte, e a previsão é de mais chuva.';
  const g = S.guard(text, ', e a', '. A', []);
  assert.equal(g.blocked, false);
  assert.equal(g.needsConfirm, false);
});

test('diff marca o que saiu e o que entrou', () => {
  const d = S.diff('apenas 40% das obras', 'menos da metade das obras');
  assert.ok(d.some((p) => p.t === 'del' && p.v.includes('40%')));
  assert.ok(d.some((p) => p.t === 'ins' && p.v.includes('metade')));
});
