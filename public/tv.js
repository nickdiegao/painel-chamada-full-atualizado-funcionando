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
