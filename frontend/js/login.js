/* Globo Flow — login (MVP, item 1).
 * O nome e a função identificam quem aprovou cada alteração (US05).
 * Com backend (GF.config.API_BASE), entra com senha: se o nome ainda não
 * existe, a conta é criada com a função escolhida. A função de quem já tem
 * conta vem do servidor, que também confere quem pode aprovar. */
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
  var remote = GF.api.auth.enabled();

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
      (remote ? '<div class="field"><label for="pass">Senha</label>' +
        '<input class="input" id="pass" name="pass" type="password" autocomplete="current-password" required minlength="4" placeholder="Mínimo de 4 caracteres"></div>' +
        '<div class="field" id="code-field" hidden><label for="code">Código de editor <span class="muted">(só no primeiro acesso, se a coordenação definiu um)</span></label>' +
        '<input class="input" id="code" name="code" autocomplete="off"></div>' : '') +
      '<p class="form-error" id="err" hidden></p>' +
      '<button class="btn btn-primary btn-lg btn-block" type="submit">' + icon('arrow-right', { size: 18 }) + 'Entrar</button>' +
      '<p class="field-hint">' + (remote ? 'Primeiro acesso? A conta é criada com o nome, a senha e a função escolhidos. ' : '') + 'Seu nome aparece no registro de aprovações e alterações.</p>' +    '</form>';

  ui.$('#login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = ui.$('#name').value.trim();
    var role = (ui.$('input[name=role]:checked') || {}).value;
    var err = ui.$('#err');
    if (name.length < 2) { err.textContent = 'Informe seu nome para continuar.'; err.hidden = false; ui.$('#name').focus(); return; }
    if (!remote) {
      GF.store.setUser({ name: name, role: role || 'Jornalista / Editor', since: Date.now() });
      location.href = next;
      return;
    }
    var pass = ui.$('#pass').value;
    if (pass.length < 4) { err.textContent = 'A senha precisa ter pelo menos 4 caracteres.'; err.hidden = false; ui.$('#pass').focus(); return; }
    var btn = ui.$('#login-form [type=submit]'); btn.disabled = true;
    err.hidden = true;
    GF.api.auth.enter(name, pass, role || 'Jornalista / Editor', ui.$('#code').value.trim()).then(function (user) {
      GF.store.setUser(user);
      if (role && user.role !== role) GF.ui.toast('Você entrou como ' + user.role + ', a função cadastrada na sua conta.', 'info', 4000);
      return GF.api.sync.pull();
    }).then(function () { location.href = next; }, function (e) {
      btn.disabled = false;
      err.textContent = e.status ? e.message : 'Não foi possível falar com o servidor. Verifique a conexão.';
      err.hidden = false;
    });
  });
  function syncCode() {
    var f = ui.$('#code-field'); if (!f) return;
    var r = (ui.$('input[name=role]:checked') || {}).value;
    f.hidden = r !== 'Jornalista / Editor';
  }
  ui.$('#login-form').addEventListener('change', syncCode);
  syncCode();
})(window.GF);
