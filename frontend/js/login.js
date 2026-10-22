/* Globo Flow — login simples (MVP, item 1).
 * O nome e a função identificam quem aprovou cada alteração (US05).
 * Quando o backend tiver autenticação, este formulário passa a chamar a API. */
(function (GF) {
  GF.app.boot({ page: 'login', guard: false });
  var ui = GF.ui, icon = GF.icon;
  var next = GF.app.param('next') || 'index.html';
  if (!/^[\w-]+\.html(\?[\w=&%.-]*)?$/.test(next)) next = 'index.html';

  var ROLES = [
    { v: 'Apresentador', d: 'Lê o roteiro no ar' },
    { v: 'Jornalista / Editor', d: 'Prepara e aprova textos' },
    { v: 'Operador de teleprompter', d: 'Controla a exibição' },
    { v: 'Produtor', d: 'Envia mudanças de pauta' }
  ];
  var current = GF.store.currentUser();

  ui.$('#main').innerHTML =
    '<span class="brand"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span><span class="brand-word">GLOBO <b>FLOW</b></span></span>' +
    '<h1>Entrar</h1>' +
    '<form class="login-card" id="login-form" novalidate>' +
      '<div class="field"><label for="name">Seu nome</label>' +
        '<input class="input" id="name" name="name" autocomplete="name" required placeholder="Nome e sobrenome" value="' + ui.esc(current ? current.name : '') + '"></div>' +
      '<fieldset class="field" style="border:0;padding:0;margin:0"><legend style="font-size:13px;color:var(--fg-2);font-weight:500;margin-bottom:6px">Função</legend>' +
        '<div class="roles">' + ROLES.map(function (r, i) {
          var checked = current ? current.role === r.v : i === 1;
          return '<label class="role"><input type="radio" name="role" value="' + r.v + '"' + (checked ? ' checked' : '') + '><span>' + r.v + '<small>' + r.d + '</small></span></label>';
        }).join('') + '</div></fieldset>' +
      '<p class="form-error" id="err" hidden></p>' +
      '<button class="btn btn-primary btn-lg btn-block" type="submit">' + icon('arrow-right', { size: 18 }) + 'Entrar</button>' +
      '<p class="field-hint">Seu nome aparece no registro de aprovações e alterações.</p>' +    '</form>';

  ui.$('#login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = ui.$('#name').value.trim();
    var role = (ui.$('input[name=role]:checked') || {}).value;
    var err = ui.$('#err');
    if (name.length < 2) { err.textContent = 'Informe seu nome para continuar.'; err.hidden = false; ui.$('#name').focus(); return; }
    GF.store.setUser({ name: name, role: role || 'Jornalista / Editor', since: Date.now() });
    location.href = next;
  });
})(window.GF);
