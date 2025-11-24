/* public/tv.js - SSE + polling fallback + safe fetch + defensive rendering
   Single IIFE: render, SSE, polling, YouTube player helpers. */
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

  // ---- admin-side render (defensiva)
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

  // ---- simple implementations for physicians/patients
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
    try { renderTVSectors(data); } catch(e){ console.error('renderTVSectors failed', e); }
    try { renderSectorsAdmin(data); } catch(e){ /* ignore */ }
  }

  // ---- YouTube player helpers (kept inside same scope)
  let ytApiReady = false;
  let ytPlayer = null;

  function stopYouTube() {
    try {
      if (ytPlayer && typeof ytPlayer.destroy === 'function') {
        ytPlayer.destroy();
        ytPlayer = null;
      }
    } catch(e) { console.error('stopYouTube destroy error', e); }
    const ov = document.getElementById('tv-video-overlay');
    if (ov) { ov.style.display = 'none'; ov.setAttribute('aria-hidden','true'); }
  }

  function ensureYouTubeApi() {
    return new Promise((resolve) => {
      if (ytApiReady) return resolve();
      if (window.YT && window.YT.Player) { ytApiReady = true; return resolve(); }

      // inject script once
      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const s = document.createElement('script');
        s.src = "https://www.youtube.com/iframe_api";
        document.head.appendChild(s);
      }

      // global callback required by API
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function() {
        ytApiReady = true;
        if (typeof prev === 'function') try { prev(); } catch(e){}
        resolve();
      };

      // safety: if API loads quickly and sets window.YT before our handler assigned
      setTimeout(() => {
        if (window.YT && window.YT.Player) {
          ytApiReady = true;
          resolve();
        }
      }, 2000);
    });
  }

  async function playYouTube(videoId, start = 0, mute = false) {
    try {
      await ensureYouTubeApi();
    } catch(e) {
      console.error('YouTube API load failed', e);
      return;
    }
    const ov = document.getElementById('tv-video-overlay');
    if (!ov) {
      console.warn('tv-video-overlay not found in DOM');
      return;
    }
    ov.style.display = 'flex';
    ov.setAttribute('aria-hidden','false');

    // reuse player if exists
    if (ytPlayer) {
      try {
        ytPlayer.loadVideoById({ videoId: videoId, startSeconds: start });
        if (mute) ytPlayer.mute(); else ytPlayer.unMute();
        return;
      } catch (e) {
        try { ytPlayer.destroy(); } catch(e){}
        ytPlayer = null;
      }
    }

    // create player
    ytPlayer = new YT.Player('tv-player', {
      videoId: videoId,
      playerVars: {
        autoplay: 1,
        controls: 1,
        rel: 0,
        start: start,
        modestbranding: 1,
        playsinline: 1
      },
      events: {
        onReady: function(event) {
          try {
            if (mute) event.target.mute(); else event.target.unMute();
            event.target.playVideo();
          } catch(e) { console.error('player onReady error', e); }
        },
        onStateChange: function(event) {
          try {
            if (event.data === YT.PlayerState.ENDED) {
              hideVideoOverlay(); // gracefully hide when ends
            }
          } catch(e){ console.error('player onStateChange error', e); }
        }
      }
    });
  }

  function hideVideoOverlay() {
    const ov = document.getElementById('tv-video-overlay');
    if (!ov) return;
    ov.style.display = 'none';
    ov.setAttribute('aria-hidden', 'true');
    try { if (ytPlayer && typeof ytPlayer.destroy === 'function') { ytPlayer.destroy(); ytPlayer = null; } } catch(e){}
  }

  // ---- SSE connection (single, defensive) ----
  let es = null;
  function connectSSE() {
    if (es && (es.readyState === EventSource.OPEN || es.readyState === EventSource.CONNECTING)) return;
    try {
      es = new EventSource('/events');
      es.onopen = () => console.info('SSE connected (client)');
      es.onmessage = ev => {
        if (!ev.data) return;
        console.debug('SSE raw data:', ev.data);
        try {
          const data = JSON.parse(ev.data);
          console.debug('SSE parsed:', data);

          if (!data || !data.type) return;

          if (data.type === 'snapshot') {
            renderTVSectors(data.payload?.sectors || []);
            renderSectorsAdmin(data.payload?.sectors || []);
            renderPhysicians(data.payload?.physicians || []);
            renderPatients(data.payload?.patients || []);
            return;
          }

          if (data.type === 'sector') {
            try { upsertSectorAdmin(data.payload); } catch(e){}
            fetchSectorsOnce();
            return;
          }

          if (data.type === 'physician') { try { upsertPhysician(data.payload); } catch(e){}; return; }
          if (data.type === 'patient') { try { upsertPatient(data.payload); } catch(e){}; return; }

          if (data.type === 'playVideo') {
            console.log('→ PLAY VIDEO', data.payload);
            playYouTube(data.payload.videoId, data.payload.start || 0, !!data.payload.mute);
            return;
          }

          if (data.type === 'stopVideo') {
            console.log('→ STOP VIDEO');
            stopYouTube();
            return;
          }

        } catch (err) {
          console.error('SSE parse error', err, ev.data);
        }
      };
      es.onerror = err => {
        console.warn('SSE error event, readyState=', es.readyState, err);
        // EventSource will auto-reconnect; fallback polling handles absence
      };
    } catch (e) {
      console.error('SSE create error', e);
    }
  }

  // ---- polling fallback ----
  let pollH = null;
  function startPolling() {
    if (pollH) clearInterval(pollH);
    pollH = setInterval(()=>{ if (es && es.readyState === EventSource.OPEN) return; fetchSectorsOnce(); }, 6000);
  }

  // ---- bootstrap DOM listeners ----
  document.addEventListener('DOMContentLoaded', () => {
    // initial load
    fetchSectorsOnce().finally(()=>{ connectSSE(); startPolling(); });

    // close overlay button
    const closeBtn = document.getElementById('tv-video-close');
    if (closeBtn) closeBtn.addEventListener('click', () => hideVideoOverlay());

    // ensure we close EventSource when navigating away
    window.addEventListener('beforeunload', ()=>{ try{ if (es) es.close(); }catch(e){} });
  });

})();
