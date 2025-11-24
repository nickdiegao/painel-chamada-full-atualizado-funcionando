/* public/tv.js - SSE + polling fallback + safe fetch + defensive rendering */
(function () {
  // ---- util
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ---- TV render (grande tela)
  function renderTVSectors(list){
    const el = document.getElementById('tv-sectors');
    if (!el) { console.warn('tv: no container #tv-sectors'); return; }
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
        <h3>${escapeHtml(s.name)}</h3>
        <div class="bigstatus">${escapeHtml(status.toUpperCase())}</div>
        ${status==='Restrito' && reason ? `<div class="reason">⚠️ Motivo: ${escapeHtml(reason)}</div>` : ''}
        ${status==='Restrito' && eta !== null ? `<div class="eta">Previsão: ${escapeHtml(String(eta))} minutos</div>` : ''}
        ${status==='Restrito' && instr ? `<div class="instruction">Orientação: ${escapeHtml(instr)}</div>` : ''}
      `;
      el.appendChild(d);
    });
    console.debug('TV rendered', list?.length ?? 0);
  }

  // ---- admin-side render (defensiva; usada se painel aberto)
  function renderSectorsAdmin(list) {
    const el = document.getElementById('sectors-list');
    if (!el) return;
    el.innerHTML = '';
    if (!Array.isArray(list)) return;
    list.forEach(s => {
      const div = document.createElement('div');
      div.className = 'sector';
      div.id = `sector-${s.id}`;
      div.textContent = `${s.name} — ${s.status}${s.reason ? ' — ' + s.reason : ''}`;
      el.appendChild(div);
    });
  }

  function upsertSectorAdmin(s) {
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

  // ---- simple implementations for physicians/patients (avoid errors)
  function renderPhysicians(list) {
    const el = document.getElementById('physicians-list'); if (!el) return;
    el.innerHTML = ''; if (!Array.isArray(list)) return;
    list.forEach(p => { const d=document.createElement('div'); d.className='physician'; d.id=`phys-${p.id}`; d.textContent=`${p.name} — ${p.availabilityStatus}`; el.appendChild(d); });
  }
  function upsertPhysician(p) { const id=`phys-${p.id}`; let el=document.getElementById(id); if(!el){el=document.createElement('div'); el.id=id; el.className='physician'; document.getElementById('physicians-list')?.appendChild(el);} el.textContent=`${p.name} — ${p.availabilityStatus}`; }
  function renderPatients(list) { const el=document.getElementById('patients-list'); if(!el) return; el.innerHTML=''; if(!Array.isArray(list)) return; list.forEach(pt=>{const d=document.createElement('div'); d.className='patient'; d.id=`pat-${pt.id}`; d.textContent=`${pt.name} — ${pt.routedTo||''}`; el.appendChild(d); }); }
  function upsertPatient(p){ const id=`pat-${p.id}`; let el=document.getElementById(id); if(!el){el=document.createElement('div'); el.id=id; el.className='patient'; document.getElementById('patients-list')?.appendChild(el);} el.textContent=`${p.name} — ${p.routedTo||''}`; }

  // ---- safe fetch for JSON APIs
  async function safeFetchJson(url, opts = {}) {
    const cfg = Object.assign({ headers: { Accept: 'application/json' }, credentials: 'same-origin' }, opts);
    try {
      const resp = await fetch(url, cfg);
      if (resp.status === 401) { window.location.href = '/login'; return null; }
      const ct = resp.headers.get('content-type') || '';
      if (!resp.ok) {
        if (ct.includes('application/json')) { const j = await resp.json().catch(()=>null); console.error('API error', j); } 
        else { const t = await resp.text().catch(()=>null); console.error('API error (text)', t); }
        return null;
      }
      if (ct.includes('application/json')) return await resp.json();
      // got HTML (probably login) -> redirect
      const txt = await resp.text().catch(()=>null);
      console.warn('Expected JSON but got HTML; redirecting to /login', txt && String(txt).slice(0,200));
      window.location.href = '/login';
      return null;
    } catch (err) {
      console.error('Network error', err);
      return null;
    }
  }

  // ---- single fetch used by TV fallback and incremental updates
  async function fetchSectorsOnce() {
    const data = await safeFetchJson('/sectors');
    if (!data) return;
    // update TV and admin (defensive)
    try { renderTVSectors(data); } catch(e){ console.error('renderTVSectors failed', e); }
    try { renderSectorsAdmin(data); } catch(e){ /* ignore */ }
  }

  // ---- SSE connection (single, defensive)
  let es = null;
  function connectSSE() {
    if (es && (es.readyState === EventSource.OPEN || es.readyState === EventSource.CONNECTING)) return;
    try {
      es = new EventSource('/events');
      es.onopen = () => console.info('SSE connected');
      es.onmessage = ev => {
        if (!ev.data) return;
        try {
          const data = JSON.parse(ev.data);
          if (!data || !data.type) return;
          if (data.type === 'snapshot') {
            renderTVSectors(data.payload?.sectors || []);
            renderSectorsAdmin(data.payload?.sectors || []);
            renderPhysicians(data.payload?.physicians || []);
            renderPatients(data.payload?.patients || []);
            return;
          }
          if (data.type === 'sector') {
            // incremental: upsert admin and refresh TV snapshot for consistency
            try { upsertSectorAdmin(data.payload); } catch(e){}
            fetchSectorsOnce();
            return;
          }
          if (data.type === 'physician') { try { upsertPhysician(data.payload); } catch(e){}; return; }
          if (data.type === 'patient') { try { upsertPatient(data.payload); } catch(e){}; return; }
        } catch (err) {
          console.error('SSE parse error', err, ev.data);
        }
      };
      es.onerror = err => {
        console.warn('SSE error', err);
        // EventSource will auto-reconnect; fallback polling handles absence
      };
    } catch (e) {
      console.error('SSE create error', e);
    }
  }

  // ---- polling fallback
  let pollH = null;
  function startPolling() {
    if (pollH) clearInterval(pollH);
    pollH = setInterval(()=>{ if (es && es.readyState === EventSource.OPEN) return; fetchSectorsOnce(); }, 6000);
  }

  // ---- bootstrap
  document.addEventListener('DOMContentLoaded', () => {
    fetchSectorsOnce().finally(()=>{ connectSSE(); startPolling(); });
    window.addEventListener('beforeunload', ()=>{ try{ if (es) es.close(); }catch(e){} });
  });
})();