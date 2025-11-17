/* debug-app-saveSector.js - substitua o conteúdo de public/app.js por isso (temporário) */
/* Este arquivo mantém a UI do admin mas adiciona logs detalhados ao salvar */

function renderSectorsAdmin(list) {
  const el = document.getElementById('sectors-list');
  if (!el) return;
  el.innerHTML = '';
  list.forEach(s => {
    const div = document.createElement('div');
    div.className = `sector-card ${s.status}`;
    div.innerHTML = `<div><strong>${s.name}</strong><div class="small">Status: ${s.status}${s.status==='Restrito' && s.reason ? ' — '+s.reason : ''}</div></div>
    <div><button onclick="selectSector('${s.id}')">Editar</button></div>`;
    el.appendChild(div);
  });

  const sel = document.getElementById('sector-select');
  if (sel) {
    sel.innerHTML = '';
    list.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.text = s.name;
      sel.appendChild(opt);
    });
  }
}

// fetchSectors seguro + restaura seleção via localStorage
async function fetchSectors() {
  // guarda seleção atual (antes do fetch)
  const selBefore = document.getElementById('sector-select');
  const previousSelected = selBefore ? selBefore.value : null;

  const res = await fetch('/sectors');
  const sectors = await res.json();

  renderSectorsAdmin(sectors);

  // tenta restaurar seleção guardada no localStorage primeiro
  const sel = document.getElementById('sector-select');
  if (!sel) return;

  const lastSaved = localStorage.getItem('lastSectorId');

  if (lastSaved && sectors.some(s => s.id === lastSaved)) {
    // se o id salvo ainda existe, restaura e carrega os dados do setor
    sel.value = lastSaved;
    // carrega detalhes no formulário (não dispara se já estiver carregado)
    selectSector(lastSaved);
    return;
  }

  // se não há id no storage, tenta restaurar a seleção anterior (por compatibilidade)
  if (previousSelected && sectors.some(s => s.id === previousSelected)) {
    sel.value = previousSelected;
    selectSector(previousSelected);
    return;
  }

  // se não há seleção para restaurar, não alteramos o select (mantemos como está)
}


function selectSector(id) {
  // guarda no storage para persistir entre recarregamentos
  try { localStorage.setItem('lastSectorId', id); } catch(e) { /* ignore storage errors */ }

  // fetch current sectors and find the requested one
  fetch('/sectors').then(r => r.json()).then(list => {
    const s = list.find(x => x.id === id);
    if (!s) return;

    // elements (checar existência antes de setar)
    const statusEl = document.getElementById('sector-status');
    const reasonInput = document.getElementById('sector-reason');
    const sel = document.getElementById('sector-select');
    const etaSel = document.getElementById('sector-eta');

    if (statusEl) statusEl.value = s.status || 'Aberto';
    if (reasonInput) reasonInput.value = s.reason || '';
    if (sel) sel.value = s.id;
    if (etaSel && typeof s.etaMinutes === 'number') etaSel.value = String(s.etaMinutes);

    // instruction buttons: set active
    const instrBtns = document.querySelectorAll('#instruction-buttons .btn-group button');
    instrBtns.forEach(b => b.classList.remove('active'));
    if (s.instruction) {
      const match = document.querySelector(`#instruction-buttons .btn-group button[data-instruction="${s.instruction}"]`);
      if (match) match.classList.add('active');
    }

    // reason buttons: set active
    const reasonBtns = document.querySelectorAll('#reason-buttons .btn-group button');
    reasonBtns.forEach(b => b.classList.remove('active'));
    if (s.reason) {
      const match = document.querySelector(`#reason-buttons .btn-group button[data-reason="${s.reason}"]`);
      if (match) match.classList.add('active');
    }

    // show/hide controls conforme status
    showOrHideRestrictControls(s.status);
  }).catch(console.error);
}


function saveSector() {
  const sel = document.getElementById('sector-select');
  const status = document.getElementById('sector-status');
  const reasonInput = document.getElementById('sector-reason');
  const etaSel = document.getElementById('sector-eta');

  if (!sel || !status) {
    console.warn('saveSector: elementos obrigatórios ausentes');
    return;
  }
  const id = sel.value;
  const body = { status: status.value };

  if (status.value === 'Restrito') {
    const activeReasonBtn = document.querySelector('#reason-buttons .btn-group button.active');
    if (activeReasonBtn) body.reason = activeReasonBtn.getAttribute('data-reason');
    else if (reasonInput && reasonInput.value.trim()) body.reason = reasonInput.value.trim();

    if (etaSel) {
      const val = Number(etaSel.value);
      if (!Number.isNaN(val)) body.etaMinutes = val;
    }

    const activeInstr = document.querySelector('#instruction-buttons .btn-group button.active');
    if (activeInstr) body.instruction = activeInstr.getAttribute('data-instruction');
  }

  console.log('>>> POST /sectors/' + id + '  payload =', body);

  fetch(`/sectors/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
    .then(async res => {
      const txt = await res.text();
      let parsed;
      try { parsed = JSON.parse(txt); } catch(e) { parsed = txt; }
      console.log('<<< response status:', res.status, parsed);
      if (!res.ok) throw new Error('HTTP '+res.status);
      // after save, fetch single sector to confirm server stored fields
      const single = await (await fetch('/sectors')).json();
      console.debug('After save, server sectors ->', single);
      fetchSectors();
    })
    .catch(err => {
      console.error('Erro ao salvar setor:', err);
      alert('Erro ao salvar setor. Veja o console (F12) para detalhes.');
    });
}

/* helpers (populateEtaOptions, wire buttons, show/hide) — copy from previous file */
function populateEtaOptions(maxMinutes = 180, step = 5) {
  const sel = document.getElementById('sector-eta');
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
  const group = document.querySelectorAll('#reason-buttons .btn-group button');
  group.forEach(b => {
    b.addEventListener('click', () => {
      group.forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      const reasonInput = document.getElementById('sector-reason');
      if (reasonInput) reasonInput.value = '';
    });
  });
}
function wireInstructionButtons() {
  const group = document.querySelectorAll('#instruction-buttons .btn-group button');
  group.forEach(b => {
    b.addEventListener('click', () => {
      group.forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    });
  });
}
function showOrHideRestrictControls(status) {
  const show = status === 'Restrito';
  const reasonBox = document.getElementById('reason-buttons');
  const etaBox = document.getElementById('eta-select');
  const instrBox = document.getElementById('instruction-buttons');
  if (reasonBox) reasonBox.style.display = show ? 'block' : 'none';
  if (etaBox) etaBox.style.display = show ? 'block' : 'none';
  if (instrBox) instrBox.style.display = show ? 'block' : 'none';
}

/* init */
document.addEventListener('DOMContentLoaded', () => {
  populateEtaOptions(180,5);
  wireReasonButtons();
  wireInstructionButtons();
  fetchSectors();
  const saveBtn = document.getElementById('save-sector');
  if (saveBtn) saveBtn.addEventListener('click', saveSector);
  const statusEl = document.getElementById('sector-status');
  if (statusEl) statusEl.addEventListener('change', (e)=>showOrHideRestrictControls(e.target.value));

  // SSE to update admin
  try {
    const es = new EventSource('/events');
    es.onmessage = ev => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === 'snapshot' || data.type === 'sector') fetchSectors();
      } catch(e){}
    };
  } catch(e){ console.warn('SSE not available', e); }

    // quando o usuário trocar o select manualmente, salvar e carregar o setor
  const selMain = document.getElementById('sector-select');
  if (selMain) {
    selMain.addEventListener('change', (e) => {
      const id = selMain.value;
      try { localStorage.setItem('lastSectorId', id); } catch(e) {}
      // carrega dados do setor selecionado
      selectSector(id);
    });

    // se houver id salvo e o select já tem opções, restaurar uma vez
    const saved = localStorage.getItem('lastSectorId');
    if (saved && selMain.querySelector(`option[value="${saved}"]`)) {
      selMain.value = saved;
      // preenche o formulário com os dados salvos
      selectSector(saved);
    }
  }
});
