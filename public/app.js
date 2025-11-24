/* public/app.js - Admin single script
   Contém: UI admin (setores), login overlay check, SSE, video controls (play/stop),
   e helpers defensivos. Substitua todo o arquivo atual por este.
*/

(() => {
  // ---------- util
  function el(id) { return document.getElementById(id); }
  function qs(sel) { return document.querySelector(sel); }
  function qsa(sel) { return Array.from(document.querySelectorAll(sel)); }
  function safeJsonText(resp) {
    // tenta parse JSON, se não puder, devolve texto
    return resp.text().then(txt => {
      try { return JSON.parse(txt); } catch(e) { return txt; }
    });
  }

  // ---------- UI: render de setores (admin) ----------
  function renderSectorsAdmin(list) {
    const container = el('sectors-list');
    if (!container) return;
    container.innerHTML = '';
    (Array.isArray(list) ? list : []).forEach(s => {
      const div = document.createElement('div');
      div.className = `sector-card ${s.status || ''}`;
      div.innerHTML = `<div><strong>${escapeHtml(s.name)}</strong>
        <div class="small">Status: ${escapeHtml(s.status || '')}${s.status==='Restrito' && s.reason ? ' — '+escapeHtml(s.reason) : ''}</div></div>
        <div><button type="button" data-id="${escapeHtml(s.id)}" class="btn-edit-sector">Editar</button></div>`;
      container.appendChild(div);
    });

    // rebuild select
    const sel = el('sector-select');
    if (sel) {
      sel.innerHTML = '';
      (Array.isArray(list) ? list : []).forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id; opt.text = s.name;
        sel.appendChild(opt);
      });
    }
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ---------- fetch helpers ----------
  async function safeFetchJson(url, opts = {}) {
    const cfg = Object.assign({ headers: { Accept: 'application/json' }, credentials: 'same-origin' }, opts);
    try {
      const resp = await fetch(url, cfg);
      if (resp.status === 401) { window.location.href = '/login'; return null; }
      const ct = resp.headers.get('content-type') || '';
      if (!resp.ok) {
        if (ct.includes('application/json')) {
          const j = await safeJsonText(resp).catch(()=>null);
          console.error('API error', j);
        } else {
          const txt = await resp.text().catch(()=>null);
          console.error('API error (text)', txt);
        }
        return null;
      }
      if (ct.includes('application/json')) return await resp.json();
      // recebeu HTML (provavelmente login) -> redireciona
      const txt = await resp.text().catch(()=>null);
      console.warn('Expected JSON but got HTML; redirecting to /login', txt && String(txt).slice(0,200));
      window.location.href = '/login';
      return null;
    } catch (err) {
      console.error('Network error', err);
      return null;
    }
  }

  // ---------- setores: fetch, select, save ----------
  async function fetchSectors() {
    const list = await safeFetchJson('/sectors');
    if (!list) return;
    renderSectorsAdmin(list);
    // restore selection logic
    const sel = el('sector-select');
    if (!sel) return;
    const lastSaved = localStorage.getItem('lastSectorId');
    if (lastSaved && list.some(s => s.id === lastSaved)) {
      sel.value = lastSaved;
      selectSector(lastSaved);
      return;
    }
    // else keep previous selection if exists
  }

  function selectSector(id) {
    try { localStorage.setItem('lastSectorId', id); } catch(e) {}
    // get sector details from server (simpler than relying on client state)
    safeFetchJson('/sectors').then(list => {
      if (!Array.isArray(list)) return;
      const s = list.find(x => x.id === id);
      if (!s) return;
      const statusEl = el('sector-status');
      const reasonInput = el('sector-reason');
      const etaSel = el('sector-eta');

      if (statusEl) statusEl.value = s.status || 'Aberto';
      if (reasonInput) reasonInput.value = s.reason || '';
      if (etaSel && typeof s.etaMinutes === 'number') etaSel.value = String(s.etaMinutes);

      // set active buttons
      qsa('#instruction-buttons .btn-group button').forEach(b => b.classList.remove('active'));
      if (s.instruction) {
        const match = qs(`#instruction-buttons .btn-group button[data-instruction="${CSS.escape(s.instruction)}"]`);
        if (match) match.classList.add('active');
      }
      qsa('#reason-buttons .btn-group button').forEach(b => b.classList.remove('active'));
      if (s.reason) {
        const match = qs(`#reason-buttons .btn-group button[data-reason="${CSS.escape(s.reason)}"]`);
        if (match) match.classList.add('active');
      }

      showOrHideRestrictControls(s.status);
    }).catch(console.error);
  }

  function populateEtaOptions(maxMinutes = 180, step = 5) {
    const sel = el('sector-eta');
    if (!sel) return;
    sel.innerHTML = '';
    for (let i = 0; i <= maxMinutes; i += step) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.text = `${i} min`;
      sel.appendChild(opt);
    }
  }

  function wireReasonButtons() {
    const group = qsa('#reason-buttons .btn-group button');
    group.forEach(b => {
      b.addEventListener('click', () => {
        group.forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        const reasonInput = el('sector-reason');
        if (reasonInput) reasonInput.value = '';
      });
    });
  }

  function wireInstructionButtons() {
    const group = qsa('#instruction-buttons .btn-group button');
    group.forEach(b => {
      b.addEventListener('click', () => {
        group.forEach(x => x.classList.remove('active'));
        b.classList.add('active');
      });
    });
  }

  function showOrHideRestrictControls(status) {
    const show = status === 'Restrito';
    const reasonBox = el('reason-buttons');
    const etaBox = el('eta-select');
    const instrBox = el('instruction-buttons');
    if (reasonBox) reasonBox.style.display = show ? 'block' : 'none';
    if (etaBox) etaBox.style.display = show ? 'block' : 'none';
    if (instrBox) instrBox.style.display = show ? 'block' : 'none';
  }

  function saveSector() {
    const sel = el('sector-select');
    const status = el('sector-status');
    const reasonInput = el('sector-reason');
    const etaSel = el('sector-eta');
    if (!sel || !status) {
      console.warn('saveSector: elementos obrigatórios ausentes');
      return;
    }
    const id = sel.value;
    const body = { status: status.value };

    if (status.value === 'Restrito') {
      const activeReasonBtn = qs('#reason-buttons .btn-group button.active');
      if (activeReasonBtn) body.reason = activeReasonBtn.getAttribute('data-reason');
      else if (reasonInput && reasonInput.value.trim()) body.reason = reasonInput.value.trim();

      if (etaSel) {
        const val = Number(etaSel.value);
        if (!Number.isNaN(val)) body.etaMinutes = val;
      }

      const activeInstr = qs('#instruction-buttons .btn-group button.active');
      if (activeInstr) body.instruction = activeInstr.getAttribute('data-instruction');
    }

    console.log('>>> POST /sectors/' + id + '  payload =', body);

    fetch(`/sectors/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body)
    })
      .then(async res => {
        const parsed = await safeJsonText(res).catch(()=>null);
        console.log('<<< response status:', res.status, parsed);
        if (!res.ok) throw new Error('HTTP '+res.status);
        // refresh
        await fetchSectors();
      })
      .catch(err => {
        console.error('Erro ao salvar setor:', err);
        alert('Erro ao salvar setor. Veja o console (F12) para detalhes.');
      });
  }

  // ---------- login overlay (defensivo) ----------
  function lockScreen() {
    const overlay = el('login-overlay');
    if (overlay) overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }
  function unlockScreen() {
    const overlay = el('login-overlay');
    if (overlay) overlay.style.display = 'none';
    document.body.style.overflow = '';
  }

  async function checkSessionAndUnlock() {
    try {
      const r = await fetch('/session-check', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (!r.ok) return;
      const j = await r.json().catch(()=>({ authenticated:false }));
      if (j.authenticated) unlockScreen();
    } catch(e) { console.warn('checkSession error', e); }
  }

  // ---------- admin video controls ----------
  async function adminPlayVideo(urlOrId, start = 0, mute = false) {
    try {
      const resp = await fetch('/play-video', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video: urlOrId, start, mute })
      });
      const j = await safeJsonText(resp).catch(()=>null);
      console.log('play-video resp', resp.status, j);
      return j;
    } catch(e) { console.error('adminPlayVideo error', e); return null; }
  }

  async function adminStopVideo() {
    try {
      const resp = await fetch('/stop-video', { method: 'POST', credentials: 'same-origin' });
      const j = await safeJsonText(resp).catch(()=>null);
      console.log('stop-video resp', resp.status, j);
      return j;
    } catch(e) { console.error('adminStopVideo error', e); return null; }
  }

  // ---------- SSE for admin to auto-update sectors (defensive) ----------
  function connectAdminSSE() {
    try {
      const es = new EventSource('/events');
      es.onopen = () => console.info('Admin SSE connected');
      es.onmessage = ev => {
        if (!ev.data) return;
        try {
          const data = JSON.parse(ev.data);
          if (!data || !data.type) return;
          if (data.type === 'snapshot' || data.type === 'sector') fetchSectors();
        } catch(e) { /* ignore parse errors */ }
      };
      es.onerror = err => {
        console.warn('Admin SSE error', err);
      };
    } catch(e) { console.warn('SSE not supported', e); }
  }

  // ---------- init bindings ----------
  document.addEventListener('DOMContentLoaded', () => {
    // UI init
    populateEtaOptions(180,5);
    wireReasonButtons();
    wireInstructionButtons();
    fetchSectors();

    // bind save
    const saveBtn = el('save-sector');
    if (saveBtn) saveBtn.addEventListener('click', saveSector);

    // select change
    const selMain = el('sector-select');
    if (selMain) {
      selMain.addEventListener('change', (e) => {
        const id = selMain.value;
        try { localStorage.setItem('lastSectorId', id); } catch(e) {}
        selectSector(id);
      });
      // try restore if option exists
      const saved = localStorage.getItem('lastSectorId');
      if (saved && selMain.querySelector(`option[value="${saved}"]`)) {
        selMain.value = saved;
        selectSector(saved);
      }
    }

    // wire play/stop buttons
    const btnPlay = el('btn-play-video');
    const btnStop = el('btn-stop-video');
    const inputUrl = el('video-url');
    const muteCheckbox = el('video-mute');

    if (btnPlay) {
      btnPlay.addEventListener('click', async () => {
        const url = inputUrl ? inputUrl.value.trim() : '';
        if (!url) { alert('Informe a URL/ID do YouTube'); return; }
        btnPlay.disabled = true;
        await adminPlayVideo(url, 0, !!(muteCheckbox && muteCheckbox.checked));
        btnPlay.disabled = false;
      });
    } else console.warn('#btn-play-video not found');

    if (btnStop) {
      btnStop.addEventListener('click', async () => {
        btnStop.disabled = true;
        await adminStopVideo();
        btnStop.disabled = false;
      });
    }

    // login overlay handling (form submit)
    const overlay = el('login-overlay');
    const form = el('login-form');
    const errorBox = el('login-error');
    if (overlay) lockScreen();
    checkSessionAndUnlock();

    if (form) {
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const username = el('login-username') ? el('login-username').value : '';
        const password = el('login-password') ? el('login-password').value : '';
        const body = new URLSearchParams({ username, password });
        try {
          const r = await fetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body
          });
          if (r.ok) { unlockScreen(); }
          else { if (errorBox) errorBox.style.display = 'block'; }
        } catch(e) {
          console.error('login submit error', e);
          if (errorBox) errorBox.style.display = 'block';
        }
      });
    }

    // SSE admin
    connectAdminSSE();
  });

})();
