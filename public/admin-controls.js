// admin-controls.js (controle remoto de vídeo + sessão + testes)
(function () {

  // utilidade rápida
  function byId(id) {
    return document.getElementById(id);
  }

  function showMsg(txt, level = 'info') {
    const el = byId('admin-msg');
    if (!el) return;
    el.textContent = txt;
    el.style.color = (level === 'err') ? 'crimson' : '#333';
    clearTimeout(showMsg._t);
    showMsg._t = setTimeout(() => {
      if (el) el.textContent = '';
    }, 6000);
  }

  // ---- PLAY VIDEO ----
  async function adminPlayVideo(urlOrId, start = 0, mute = false) {
    try {
      const resp = await fetch('/play-video', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video: urlOrId, start, mute })
      });

      const j = await resp.json().catch(() => null);

      if (!resp.ok) {
        showMsg('Erro ao enviar vídeo: ' + resp.status, 'err');
        return null;
      }

      showMsg('Vídeo enviado para a TV: ' + (j?.videoId || 'ok'));
      return j;

    } catch (err) {
      console.error('adminPlayVideo error:', err);
      showMsg('Falha de rede ao enviar vídeo.', 'err');
      return null;
    }
  }

  // ---- STOP VIDEO ----
  async function adminStopVideo() {
    try {
      const resp = await fetch('/stop-video', {
        method: 'POST',
        credentials: 'same-origin'
      });

      if (!resp.ok) {
        showMsg('Erro ao parar vídeo: ' + resp.status, 'err');
        return null;
      }

      const j = await resp.json().catch(() => null);
      showMsg('Stop enviado.');
      return j;

    } catch (err) {
      console.error('adminStopVideo error:', err);
      showMsg('Falha de rede ao parar vídeo.', 'err');
      return null;
    }
  }

  // ---- CHECK SESSION ----
  async function checkSession() {
    try {
      const resp = await fetch('/session-check', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });

      if (!resp.ok) {
        byId('session-status').textContent = 'Não autenticado';
        return false;
      }

      const j = await resp.json().catch(() => ({ authenticated: false }));

      byId('session-status').textContent =
        j.authenticated ? 'Autenticado' : 'Não autenticado';

      return !!j.authenticated;

    } catch (err) {
      console.error('checkSession error:', err);
      byId('session-status').textContent = 'Erro';
      return false;
    }
  }

  // ---- LOGOUT ----
  async function doLogout() {
    try {
      await fetch('/logout', {
        method: 'POST',
        credentials: 'same-origin'
      });
    } catch (e) { }
    window.location.href = '/login';
  }

  // ---- REFRESH SECTORS (teste rápido) ----
  async function refreshSectors() {
    try {
      const resp = await fetch('/sectors', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });

      const data = await resp.json().catch(() => null);

      if (!resp.ok || !data) {
        showMsg('Erro ao atualizar setores.', 'err');
        return;
      }

      showMsg('Setores atualizados (' + data.length + ' encontrados).');
    } catch (err) {
      showMsg('Falha ao buscar setores.', 'err');
    }
  }

  // ---- EVENTOS (ligar botões ao DOM) ----
  document.addEventListener('DOMContentLoaded', () => {

    const btnPlay = byId('btn-play-video');
    const btnStop = byId('btn-stop-video');
    const btnCheck = byId('btn-check-session');
    const btnLogout = byId('btn-logout');
    const btnRefresh = byId('btn-refresh-sectors');
    const inputUrl = byId('video-url');
    const muteCheckbox = byId('video-mute');

    // PLAY
    if (btnPlay) btnPlay.addEventListener('click', async () => {
      const url = inputUrl ? inputUrl.value.trim() : '';
      if (!url) {
        showMsg('Informe o link/ID do YouTube!', 'err');
        return;
      }

      btnPlay.disabled = true;
      await adminPlayVideo(url, 0, !!(muteCheckbox && muteCheckbox.checked));
      btnPlay.disabled = false;
    });

    // STOP
    if (btnStop) btnStop.addEventListener('click', async () => {
      btnStop.disabled = true;
      await adminStopVideo();
      btnStop.disabled = false;
    });

    // CHECK SESSION
    if (btnCheck) btnCheck.addEventListener('click', () => checkSession());

    // LOGOUT
    if (btnLogout) btnLogout.addEventListener('click', () => doLogout());

    // REFRESH SECTORS
    if (btnRefresh) btnRefresh.addEventListener('click', () => refreshSectors());

    // verifica sessão ao abrir a página
    checkSession();
  });
})();
