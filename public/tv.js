/* public/tv.js - SSE + YouTube player + layout integration (corrigido) */
(function () {

  // DEBUG / áudio
  let audioEnabled = false;
  document.addEventListener("click", () => { audioEnabled = true; }, { once: true });

  const lastStatusBySector = new Map();
  const lastPlayTime = new Map();
  // para DEBUG coloque 0; depois volte para 25*1000
  const COOLDOWN_MS = 0; // <= defina 0 para testar; depois volte pra 25000

  let audioCtx = null;
  
  const audioQueue = [];
  let audioPlaying = false;

  function playSound(src) {
    return new Promise(resolve => {
      if (!audioEnabled) {
        console.warn('playSound blocked: audio not enabled by user gesture', src);
        return resolve();
      }
      try {
        console.debug('playSound: creating audio', src);
        const audio = new Audio(src);
        audio.preload = 'auto';
        audio.volume = 1.0;

        let resolved = false;
        const onDone = () => { if (!resolved) { resolved = true; cleanup(); resolve(); } };
        const cleanup = () => {
          audio.onended = null;
          audio.onerror = null;
          clearTimeout(timeoutId);
          try { audio.pause(); } catch (e) {}
        };

        audio.onended = onDone;
        audio.onerror = () => {
          console.error('playSound: audio error for', src);
          onDone();
        };

        // safety timeout: se o audio travar, resolvemos depois de 8s
        const timeoutId = setTimeout(() => {
          console.warn('playSound: timeout reached for', src);
          onDone();
        }, 8000);

        audio.play().catch(err => {
          console.error('playSound: play() rejected', src, err);
          onDone();
        });
      } catch (e) {
        console.error('playSound exception', e);
        resolve();
      }
    });
  }

  // enfileira, mas tenta checar se o arquivo existe (fetch HEAD)
  function queueAudio(src) {
    console.debug('queueAudio requested:', src);
    // tentar HEAD (não obrigatório); se falhar, ainda enfileira para permitir fallback
    fetch(src, { method: 'HEAD' }).then(r => {
      if (!r.ok) {
        console.warn('queueAudio: HEAD failed', src, r.status);
        // opcional: não enfileirar se 404 -> return;
      }
    }).catch(err => {
      console.debug('queueAudio: HEAD request error (ok):', src, err);
    }).finally(() => {
      audioQueue.push(src);
      processAudioQueue();
    });
  }

  async function processAudioQueue() {
    if (audioPlaying) {
      // já tocando
      return;
    }
    if (audioQueue.length === 0) {
      // fila vazia
      return;
    }
    audioPlaying = true;
    const src = audioQueue.shift();
    console.debug('processAudioQueue: playing', src, 'remaining queue', audioQueue.length);
    try {
      await playSound(src);
      // pequeno gap entre sons
      await new Promise(r => setTimeout(r, 180));
    } catch (e) {
      console.error('processAudioQueue error', e);
    } finally {
      audioPlaying = false;
      // próxima execução (se houver)
      if (audioQueue.length > 0) {
        // usar setTimeout pequeno para evitar recursão sincronizada
        setTimeout(processAudioQueue, 60);
      }
    }
  }

  // slug helper (remova acentos / espaços)
  function slug(name) {
    if (!name) return '';
    return String(name)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function duckYouTubeVolume() {
    if (!ytPlayer || typeof ytPlayer.getVolume !== "function") return;

    try {
      // Salva volume atual uma única vez
      if (!ytMutedBySystem) {
        ytVideoOriginalVolume = ytPlayer.getVolume();
      }

      ytMutedBySystem = true;

      // Diminui suavemente (volume 20%)
      ytPlayer.setVolume(10);

      // Se já tinha timeout, cancela
      if (ytDuckTimeout) clearTimeout(ytDuckTimeout);

      // Após X segundos restaura
      ytDuckTimeout = setTimeout(() => {
        try {
          if (ytPlayer && ytMutedBySystem) {
            ytPlayer.setVolume(ytVideoOriginalVolume);
          }
        } catch(e){}
        ytMutedBySystem = false;
      }, YT_DUCK_MS);

    } catch(e){
      console.warn("duckYouTubeVolume error", e);
    }
  }


  function announceSectorChange(sectorName, newStatus) {
    try {
      const id = slug(sectorName || '');
      const now = Date.now();

      // se não mudou desde último status, ignora
      const prev = (lastStatusBySector.get(id) || '').toString();
      if (prev === (newStatus || '').toString()) {
        console.debug('announceSectorChange: status igual, ignorando', id, newStatus);
        return;
      }

      // cooldown: evita tocar repetidamente em flaps rápidos
      const last = lastPlayTime.get(id) || 0;
      if (now - last < COOLDOWN_MS) {
        console.debug('announceSectorChange: cooldown ativo, ignorando', id, newStatus, { now, last, cooldown: COOLDOWN_MS });
        // atualiza status interno mesmo sem tocar som
        lastStatusBySector.set(id, newStatus);
        return;
      }

      // atualiza status
      lastStatusBySector.set(id, newStatus);
      lastPlayTime.set(id, now);

      // caminhos
      const bell = '/sons/aeroporto-camp.mp3';
      const base = (String(newStatus || '').toLowerCase().includes('restrito')) ? '/sons/restrito' : '/sons/aberto';
      const voicePath = `${base}/${id}.mp3`;

      // enfileira som: campainha -> voz do setor
      duckYouTubeVolume();   // abaixa o volume do vídeo
      queueAudio(bell);
      queueAudio(voicePath);

      console.info('announceSectorChange queued', { sectorName, id, newStatus, bell, voicePath });

    } catch (err) {
      console.error('announceSectorChange error', err && err.message ? err.message : err);
    }
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ---- render TV sectors (mantive seu markup)
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

  // ---- safe fetch JSON
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
      const txt = await resp.text().catch(()=>null);
      console.warn('Expected JSON but got HTML; redirecting to /login', txt && String(txt).slice(0,200));
      window.location.href = '/login';
      return null;
    } catch (err) {
      console.error('Network error', err);
      return null;
    }
  }

  // ---- fetch once
  async function fetchSectorsOnce() {
    const data = await safeFetchJson('/sectors');
    if (!data) return;
    try { renderTVSectors(data); } catch(e){ console.error('renderTVSectors failed', e); }
  }

  // ---- YouTube player logic (robusto)
  let ytApiReady = false;
  let ytPlayer = null;
  const tvBody = () => document.getElementById('tv-body');
  const videoOverlay = () => document.getElementById('tv-video-overlay');

  let ytVideoOriginalVolume = 100;   // volume padrão do YouTube
  let ytMutedBySystem = false;       // controle interno
  let YT_DUCK_MS = 8000;             // tempo para restaurar (8s)
  let ytDuckTimeout = null;

  function ensureYouTubeApi() {
    return new Promise((resolve) => {
      if (ytApiReady) return resolve();
      if (window.YT && window.YT.Player) { ytApiReady = true; return resolve(); }
      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const s = document.createElement('script');
        s.src = "https://www.youtube.com/iframe_api";
        document.head.appendChild(s);
      }
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function() {
        ytApiReady = true;
        if (typeof prev === 'function') try { prev(); } catch(e){}
        resolve();
      };
      // fallback short delay
      setTimeout(() => {
        if (window.YT && window.YT.Player) {
          ytApiReady = true;
          resolve();
        }
      }, 2000);
    });
  }

  async function playYouTube(videoId, start = 0, mute = false) {
    if (!videoId) return;
    try {
      await ensureYouTubeApi();
    } catch (e) {
      console.error('YouTube API failed', e);
      return;
    }

    const body = tvBody();
    const overlay = videoOverlay();
    if (body) {
      // AZUL: tornar vídeo maior e centralizado
      // tornar vídeo maior, porém com limite melhor para evitar caixas pretas
      body.style.setProperty('--video-width', 'clamp(560px, 44vw, 950px)');
      body.classList.add('with-video');
    }
    if (overlay) {
      overlay.style.opacity = '1';
      overlay.style.pointerEvents = 'auto';
      overlay.style.display = 'block';
      overlay.setAttribute('aria-hidden','false');
    }

    // reuse player if exists
    if (ytPlayer) {
      try {
        ytPlayer.loadVideoById({ videoId, startSeconds: start });
        if (mute) ytPlayer.mute(); else ytPlayer.unMute();
        return;
      } catch (e) {
        try { ytPlayer.destroy(); } catch(e){}
        ytPlayer = null;
      }
    }

    // create new player inside #tv-player
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
            // ENDED -> esconder e notificar servidor para sync
            if (event.data === YT.PlayerState.ENDED) {
              try { fetch('/stop-video', { method:'POST', credentials:'same-origin' }).catch(()=>{}); } catch(e){}
              hideVideoOverlay();
            }
          } catch(e){ console.error('player onStateChange error', e); }
        }
      }
    });
  }

  function hideVideoOverlay() {
    const body = tvBody();
    const overlay = videoOverlay();
    if (!body) return;
    // colapsa coluna do vídeo (grid) antes de remover classe
    body.style.setProperty('--video-width', '0px');
    body.classList.remove('with-video');

    if (overlay) {
      overlay.setAttribute('aria-hidden','true');
      overlay.style.pointerEvents = 'none';
    }

    // esperar transição terminar e então destruir player
    setTimeout(() => {
      try { if (ytPlayer && typeof ytPlayer.destroy === 'function') { ytPlayer.destroy(); ytPlayer = null; } } catch(e){ console.error(e); }
      const playerNode = document.getElementById('tv-player');
      if (playerNode) playerNode.innerHTML = '';
      if (overlay) overlay.style.display = 'none';
      // limpar variáveis CSS opcionais
      try {
        body.style.removeProperty('--panel-scale-active');
        body.style.removeProperty('--sector-scale-active');
        body.style.removeProperty('--sector-scale-alert');
      } catch(e){}
    }, 650);
  }

  // close button handler (delegated after DOM ready)
  function setupCloseButton() {
    const closeBtn = document.getElementById('tv-video-close');
    if (!closeBtn) return;
    closeBtn.addEventListener('click', () => {
      // notificar servidor (mantém TVs sincronizadas)
      fetch('/stop-video', { method:'POST', credentials:'same-origin' }).catch(()=>{});
      hideVideoOverlay();
    });
  }

  // ---- SSE handling (robusto) ----
  let es = null;
  function connectSSE() {
    if (es && (es.readyState === EventSource.OPEN || es.readyState === EventSource.CONNECTING)) return;
    try {
      es = new EventSource('/events');
      es.onopen = () => console.info('SSE connected (client)');
      es.onmessage = ev => {
        if (!ev.data) return;
        try {
          const data = JSON.parse(ev.data);
          if (!data || !data.type) return;

          if (data.type === 'snapshot') {
              const list = data.payload?.sectors || [];

              // Inicializar estados sem tocar áudio
              list.forEach(s => {
                  lastStatusBySector.set(slug(s.name), s.status);
              });

              renderTVSectors(list);
              return;
          }
          if (data.type === 'sector') {
              const s = data.payload;

              const name = s.name || s.setor || "setor";
              const status = s.status || "";

              announceSectorChange(name, status);

              try { upsertSectorAdmin(s); } catch(e){}
              fetchSectorsOnce();
              return;
          }
          if (data.type === 'playVideo') {
            const payload = data.payload || {};
            playYouTube(payload.videoId || payload.video || null, payload.start || 0, !!payload.mute);
            return;
          }
          if (data.type === 'stopVideo') {
            hideVideoOverlay();
            return;
          }
        } catch (err) {
          console.error('SSE parse error', err, ev.data);
        }
      };
      es.onerror = err => {
        console.warn('SSE error event, readyState=', es && es.readyState, err);
      };
    } catch (e) {
      console.error('SSE create error', e);
    }
  }

  // polling fallback
  let pollH = null;
  function startPolling() {
    if (pollH) clearInterval(pollH);
    pollH = setInterval(()=>{ if (es && es.readyState === EventSource.OPEN) return; fetchSectorsOnce(); }, 6000);
  }

  // ---- DOM ready bootstrap ----
  document.addEventListener('DOMContentLoaded', () => {
    // initial load
    fetchSectorsOnce().finally(()=>{ connectSSE(); startPolling(); setupCloseButton(); });

    // cleanup on unload
    window.addEventListener('beforeunload', ()=>{ try{ if (es) es.close(); }catch(e){} });
  });

  function enableAudio() {
  try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();

      // Tocar buffer silencioso (obrigatório para desbloquear autoplay)
      const buffer = audioCtx.createBuffer(1, 1, 22050);
      const src = audioCtx.createBufferSource();
      src.buffer = buffer;
      src.connect(audioCtx.destination);
      src.start(0);

      audioEnabled = true;
      document.getElementById("enable-sound-btn")?.classList.add("hidden");

      console.warn("🔊 Áudio liberado!");
    } catch (e) {
      console.error("Erro ao liberar áudio", e);
      audioEnabled = true; // fallback
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("enable-sound-btn");
    if (btn) btn.addEventListener("click", enableAudio);
  });

})();