// login.js - envia POST /login (form-urlencoded) e redireciona para / em caso de sucesso.
// Também verifica /session-check no carregamento para pular login se já autenticado.

(function () {
  const form = document.getElementById('login-form');
  const err = document.getElementById('error');
  const submitBtn = document.getElementById('submit');

  async function showError(msg){
    err.textContent = msg;
    err.hidden = false;
  }
  function clearError(){
    err.hidden = true;
    err.textContent = '';
  }

  // check session: se já autenticado, vai direto para painel raiz "/"
  async function checkSession(){
    try {
      const r = await fetch('/session-check', { credentials: 'same-origin' });
      if (!r.ok) return;    
      const j = await r.json();
      if (j && j.authenticated) {
        // já autenticado -> ir para a tela administrativa (raiz "/")
        window.location.href = '/';
      }
    } catch(e) {
      // ignore network errors, permanecer na tela de login
      console.debug('session-check error', e);
    }
  }

  checkSession();

  form.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    clearError();
    submitBtn.disabled = true;

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    if (!username || !password) {
      showError('Preencha usuário e senha.');
      submitBtn.disabled = false;
      return;
    }

    const body = new URLSearchParams();
    body.append('username', username);
    body.append('password', password);

    try {
      const r = await fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        credentials: 'same-origin'
      });

      const j = await r.json().catch(()=>null);

      if (r.ok && j && j.ok) {
        // login ok -> redireciona para a página administrativa (raiz)
        window.location.href = '/';
        return;
      }

      // falha de autenticação
      const message = (j && j.error) ? j.error : 'Credenciais incorretas.';
      showError(message);
    } catch (e) {
      showError('Erro de rede. Tente novamente.');
      console.error(e);
    } finally {
      submitBtn.disabled = false;
    }
  });
})();
