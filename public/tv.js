/* debug-tv.js - polling + SSE + detailed logs */
function renderTVSectors(list){
  const el = document.getElementById('tv-sectors');
  if (!el) { console.warn('tv: no container'); return; }
  el.innerHTML = '';
  if (!Array.isArray(list)) return;
  list.forEach(s => {
    const d = document.createElement('div');
    const status = (s.status||'').toString();
    d.className = `tv-sector ${status}`;
    const reason = s.reason || s.motivo || '';
    const eta = (typeof s.etaMinutes === 'number') ? s.etaMinutes : (s.eta ? Number(s.eta) : null);
    const instr = s.instruction || s.orientacao || '';
    d.innerHTML = `
      <h3>${s.name}</h3>
      <div class="bigstatus">${status.toUpperCase()}</div>
      ${status==='Restrito' && reason ? `<div class="reason">⚠️ Motivo: ${reason}</div>` : ''}
      ${status==='Restrito' && eta !== null ? `<div class="eta">Previsão: ${eta} minutos</div>` : ''}
      ${status==='Restrito' && instr ? `<div class="instruction">Orientação: ${instr}</div>` : ''}
    `;
    el.appendChild(d);
  });
  console.debug('TV rendered', list);
}

async function fetchSectorsOnce() {
  try {
    const r = await fetch('/sectors');
    const data = await r.json();
    console.debug('tv fetch /sectors ->', data);
    renderTVSectors(data);
    return data;
  } catch(e) {
    console.error('tv fetch error', e);
    return null;
  }
}

function connectTVSSE() {
  try {
    const es = new EventSource('/events');
    es.onmessage = ev => {
      try {
        const data = JSON.parse(ev.data);
        console.debug('tv SSE', data);
        if (data.type === 'snapshot') renderTVSectors(data.payload?.sectors || []);
        else if (data.type === 'sector') fetchSectorsOnce();
      } catch(e) { console.error('tv SSE parse', e); }
    };
    es.onerror = e => console.warn('tv SSE error', e);
  } catch(e) { console.warn('tv SSE create error', e); }
}

// fallback polling every 6s (in case SSE fails or snapshot incomplete)
let pollingInterval = null;
document.addEventListener('DOMContentLoaded', () => {
  fetchSectorsOnce();
  connectTVSSE();
  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = setInterval(fetchSectorsOnce, 6000);
});

// tv.js - conecta em /events e processa snapshot + updates
(function () {
  const es = new EventSource('/events');

  es.addEventListener('message', (ev) => {
    // mensagem textual genérica — pode ser snapshot ou update (depende do payload.type)
    try {
      const data = JSON.parse(ev.data);
      handleEvent(data);
    } catch (err) {
      console.error('failed parse SSE data', err, ev.data);
    }
  });

  es.addEventListener('error', (err) => {
    console.error('SSE error', err);
    // o EventSource tenta reconectar automaticamente; você pode mostrar alert visual se quiser
  });

  function handleEvent(update) {
    // update.type: 'snapshot' | 'sector' | 'physician' | 'patient'
    if (!update || !update.type) return;
    if (update.type === 'snapshot') {
      // repõe todo o estado
      renderSectors(update.payload.sectors || []);
      renderPhysicians(update.payload.physicians || []);
      renderPatients(update.payload.patients || []);
      return;
    }

    // updates incrementais — atualize elemento específico
    if (update.type === 'sector') {
      upsertSector(update.payload);
      return;
    }
    if (update.type === 'physician') {
      upsertPhysician(update.payload);
      return;
    }
    if (update.type === 'patient') {
      upsertPatient(update.payload);
      return;
    }
  }

  // implemente estas funções conforme seu DOM:
  function renderSectors(sectors) {
    // ex: limpar e redesenhar lista de setores
    const el = document.getElementById('sectors-list');
    if (!el) return;
    el.innerHTML = '';
    sectors.forEach(s => {
      const div = document.createElement('div');
      div.className = 'sector';
      div.id = `sector-${s.id}`;
      div.textContent = `${s.name} — ${s.status}${s.reason ? ' — ' + s.reason : ''}`;
      el.appendChild(div);
    });
  }

  function upsertSector(s) {
    const id = `sector-${s.id}`;
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.className = 'sector';
      document.getElementById('sectors-list')?.appendChild(el);
    }
    el.textContent = `${s.name} — ${s.status}${s.reason ? ' — ' + s.reason : ''}`;
  }

  function renderPhysicians(list) {
    // adaptar similar a renderSectors
  }
  function upsertPhysician(p) { /* ... */ }
  function renderPatients(list) { /* ... */ }
  function upsertPatient(p) { /* ... */ }
})();
