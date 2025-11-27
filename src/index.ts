// src/app.ts (corrigido)
import express from 'express';
import cors from 'cors';
import path from 'path';
import session from 'express-session';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import fs from 'fs';
import bcrypt from 'bcryptjs';

export { createUser, deleteUser };

// modelos (mantive seu import original)
import { Sector, Physician, Patient, PanelUpdate, SectorStatus, PhysicianStatus, Route } from './models';

dotenv.config();

type UserAccount = { username: string; passwordHash: string };

const usersFile = path.join(__dirname, "..", "users.json");

// --- helpers de usuários (tipados) ---
function ensureUsersFileExists() {
  if (!fs.existsSync(usersFile)) {
    fs.writeFileSync(usersFile, JSON.stringify([], null, 2), 'utf8');
  }
}

function loadUsers(): UserAccount[] {
  try {
    ensureUsersFileExists();
    const raw = fs.readFileSync(usersFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as UserAccount[];
  } catch (e) {
    console.error('loadUsers error', e);
    return [];
  }
}

function saveUsers(arr: UserAccount[]) {
  fs.writeFileSync(usersFile, JSON.stringify(arr, null, 2), 'utf8');
}

function findUser(username: string): UserAccount | undefined {
  const users = loadUsers();
  return users.find(u => u.username === username);
}

function createUser(username: string, plainPassword: string): UserAccount {
  const users = loadUsers();
  if (users.find(u => u.username === username)) throw new Error("user exists");
  const hash = bcrypt.hashSync(plainPassword, 10);
  const u: UserAccount = { username, passwordHash: hash };
  users.push(u);
  saveUsers(users);
  return u;
}

function deleteUser(username: string) {
  const users = loadUsers();
  const filtered = users.filter(u => u.username !== username);
  saveUsers(filtered);
  return filtered.length !== users.length; // return true if deleted
}

// Opcional: bootstrap - cria um admin padrão e um master se users.json estiver vazio
(function bootstrapAdmin() {
  try {
    ensureUsersFileExists();
    const users = loadUsers();
    if (users.length === 0) {
      // ler e normalizar env vars
      const adminUser = (process.env.ADMIN_USER || 'admin').toString().trim();
      const adminPass = (process.env.ADMIN_PASS || 'senha123').toString().trim();

      try {
        createUser(adminUser, adminPass);
        console.log(`Bootstrap: created default admin '${adminUser}'`);
      } catch (err) {
        if (err instanceof Error) {
          console.warn(err.message);
        } else {
          console.warn(err);
        }
      }

      // criar master opcional apenas se as duas variáveis existirem e não vazias
      const masterUser = process.env.MASTER_USER ? process.env.MASTER_USER.toString().trim() : '';
      const masterPass = process.env.MASTER_PASS ? process.env.MASTER_PASS.toString().trim() : '';
      if (masterUser && masterPass) {
        try {
          createUser(masterUser, masterPass);
          console.log(`Bootstrap: created master user '${masterUser}'`);
        } catch (err) {
            if (err instanceof Error) {
              console.warn(err.message);
            } else {
              console.warn(err);
            }
          }
        }
      }
    } catch (e) {
      console.warn('bootstrapAdmin failed', e);
  }
})();


// ---------- setup Express ----------
const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const publicPath = path.join(__dirname, '..', 'public');
// serve static sem index automático (protege index.html)
app.use(express.static(publicPath, { index: false }));

app.use(cookieParser());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'troque-isto-por-uma-chave-secreta',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 2 },
  })
);

const PORT = process.env.PORT ? Number(process.env.PORT) : 3333;

// ---------- in-memory state (mantive seu código) ----------
const sectors = new Map<string, Sector>();
const physicians = new Map<string, Physician>();
const patients = new Map<string, Patient>();

sectors.set('s1', { id: 's1', name: 'Emergência Adulto', status: 'Aberto' });
sectors.set('s2', { id: 's2', name: 'Emergência Pediátrica', status: 'Restrito', reason: 'Superlotação' });
sectors.set('s3', { id: 's3', name: 'Emergência Odontológica', status: 'Aberto' });

physicians.set('doc1', { id: 'doc1', name: 'Dr. Silva', availabilityStatus: 'Disponível' });
physicians.set('doc2', { id: 'doc2', name: 'Dra. Souza', availabilityStatus: 'Ocupado' });

patients.set('p1', { id: 'p1', name: 'João', routedTo: 'Aguardando' });
patients.set('p2', { id: 'p2', name: 'Maria', routedTo: 'Aguardando' });

// SSE clients
const clients: Array<{ id: string; res: express.Response }> = [];
// --- SSE broadcast seguro ---
function sendEvent(update: PanelUpdate) {
  const payload = `data: ${JSON.stringify(update)}\n\n`;
  console.log('Broadcasting SSE update -> clients:', clients.length, ' type:', update.type);
  for (let i = clients.length - 1; i >= 0; i--) {
    const c = clients[i];
    try {
      c.res.write(payload);
      console.log(' -> wrote to', c.id);
    } catch (err) {
      console.warn(' -> write failed, removing client', c.id, err);
      // remove client morto
      clients.splice(i, 1);
      try { c.res.end(); } catch(e) {}
    }
  }
}

// ---------- Authentication helpers ----------
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.session && (req.session as any).isAdmin) return next();

  const wantsJson =
    req.xhr ||
    (req.headers['accept'] && (req.headers['accept'] as string).includes('application/json')) ||
    (req.headers['content-type'] && (req.headers['content-type'] as string).includes('application/json'));

  if (wantsJson) return res.status(401).json({ error: 'not authenticated' });
  return res.redirect('/login');
}

// ---------- Auth endpoints ----------
// Serve a página de login (arquivo public/login.html)
app.get('/login', (req, res) => {
  return res.sendFile(path.join(publicPath, '../public/Login/login.html'));
});

// POST /login - único handler (usa users.json + bcrypt)
app.post('/login', (req, res) => {
  console.log('POST /login - body:', req.body);
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ ok: false, error: 'username/password missing' });

  const user = findUser(username);
  if (!user) {
    console.log('Login failed for', username, '- user not found');
    return res.status(401).json({ ok: false, error: 'Credenciais inválidas' });
  }

  const ok = bcrypt.compareSync(password, user.passwordHash);
  console.log('Password compare for', username, '=>', ok);
  if (!ok) return res.status(401).json({ ok: false, error: 'Credenciais inválidas' });

  (req.session as any).isAdmin = true;
  (req.session as any).user = username;
  return res.json({ ok: true });
});

app.post('/delete-user', requireAuth, (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ ok:false, error:'missing username' });

  const users = loadUsers();
  if (!users.find(u => u.username === username))
    return res.status(404).json({ ok:false, error:'user not found' });

  const updated = users.filter(u => u.username !== username);
  saveUsers(updated);

  return res.json({ ok:true });
});

// session-check (para o frontend saber se já está logado)
app.get('/session-check', (req, res) => {
  const authed = !!(req.session && (req.session as any).isAdmin);
  return res.json({ authenticated: authed });
});

// logout
app.post('/logout', (req, res) => {
  req.session?.destroy(() => {
    return res.json({ ok: true });
  });
});

// ---------- SSE endpoint (público para TVs) ----------
// ------- SSE: TV recebe atualizações -------
// SSE robusto - cole em src/app.ts substituindo a rota events existente
app.get('/events', (req, res) => {
  try {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    // evita que middlewares de compressão/transform interfiram
    res.flushHeaders?.();

    // garante socket sem timeout
    req.socket.setTimeout(0);

    const clientId = Date.now().toString() + '-' + Math.floor(Math.random()*1000);
    clients.push({ id: clientId, res });
    console.log('SSE client connected', clientId, 'total:', clients.length);

    // send initial ping + snapshot
    res.write(':connected\n\n');
    const snapshot: PanelUpdate = {
      type: 'snapshot',
      payload: {
        sectors: Array.from(sectors.values()),
        physicians: Array.from(physicians.values()),
        patients: Array.from(patients.values())
      },
      timestamp: new Date().toISOString()
    };
    res.write(`data: ${JSON.stringify(snapshot)}\n\n`);

    // heartbeat every 15s
    const hb = setInterval(() => {
      try { res.write(':hb\n\n'); } catch (err) { /* ignore */ }
    }, 15000);

    req.on('close', () => {
      clearInterval(hb);
      const idx = clients.findIndex(c => c.id === clientId);
      if (idx >= 0) clients.splice(idx, 1);
      console.log('SSE client disconnected', clientId, 'total:', clients.length);
    });

  } catch (err) {
    console.error('SSE setup error', err);
    try { res.end(); } catch(e) {}
  }
});



// ---------- REST endpoints (protegidos) ----------
app.get('/sectors', requireAuth, (_req, res) => res.json(Array.from(sectors.values())));
app.post('/sectors/:id', requireAuth, (req, res) => {
  // ... (mantive exatamente sua lógica original)
  const id = req.params.id as string;
  const sector = sectors.get(id);
  if (!sector) return res.status(404).json({ error: 'sector not found' });

  const status = req.body.status as SectorStatus | undefined;
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : undefined;
  const etaRaw = req.body.etaMinutes;
  const eta = (typeof etaRaw === 'number') ? etaRaw : (typeof etaRaw === 'string' && etaRaw !== '' ? Number(etaRaw) : undefined);
  const instruction = typeof req.body.instruction === 'string' ? req.body.instruction.trim() : undefined;

  if (status) {
    const allowed: SectorStatus[] = ['Aberto', 'Restrito'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'invalid status' });
    sector.status = status;
    if (status !== 'Restrito') {
      delete sector.reason;
      delete sector.etaMinutes;
      delete sector.instruction;
    }
  }

  if (typeof reason === 'string' && reason.length) sector.reason = reason;
  if (typeof eta === 'number' && !Number.isNaN(eta)) sector.etaMinutes = eta;
  if (typeof instruction === 'string' && instruction.length) sector.instruction = instruction;

  const update: PanelUpdate = { type: 'sector', payload: sector, timestamp: new Date().toISOString() };
  sendEvent(update);
  return res.json(sector);
});

// demais endpoints (physicians, patients) - mantenha seus handlers originais e adicione requireAuth
app.get('/physicians', requireAuth, (_req, res) => res.json(Array.from(physicians.values())));
app.post('/physicians', requireAuth, (req, res) => {
  const { id, name, availabilityStatus } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id and name required' });
  if (physicians.has(id)) return res.status(409).json({ error: 'id exists' });
  const status = (availabilityStatus as PhysicianStatus) || 'Disponível';
  const doc: Physician = { id, name, availabilityStatus: status };
  physicians.set(id, doc);
  const update: PanelUpdate = { type: 'physician', payload: doc, timestamp: new Date().toISOString() };
  sendEvent(update);
  res.status(201).json(doc);
});
app.post('/physicians/:id/status', requireAuth, (req, res) => { /* ... keep logic ... */ });
app.delete('/physicians/:id', requireAuth, (req, res) => { /* ... keep logic ... */ });

app.get('/patients', requireAuth, (_req, res) => res.json(Array.from(patients.values())));
app.post('/patients', requireAuth, (req, res) => { /* ... keep logic ... */ });
app.post('/patients/:id/route', requireAuth, (req, res) => { /* ... keep logic ... */ });
app.delete('/patients/:id', requireAuth, (req, res) => { /* ... keep logic ... */ });

// TV route
app.get('/tv', (req, res) => res.sendFile(path.join(publicPath, '../public/TV/tv.html')));

// proteger index.html
app.get('index.html', requireAuth, (req, res) => res.sendFile(path.join(publicPath, '../public/Admin Panel/index.html')));
app.get('/', (req, res) => {
  if (req.session && (req.session as any).isAdmin) return res.sendFile(path.join(publicPath, '../public/Admin Panel/index.html'));
  return res.redirect('/login');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on 0.0.0.0:${PORT}`);
});

// helper: extrai videoId de um URL do YouTube (aceita forms: youtu.be/ID, youtube.com/watch?v=ID, embed/ID)
function extractYouTubeId(urlOrId: string): string | null {
  if (!urlOrId) return null;
  // se já for um id curto (sem caracteres inválidos)
  if (/^[A-Za-z0-9_-]{6,}$/.test(urlOrId)) return urlOrId;
  try {
    const u = new URL(urlOrId);
    if (u.hostname.includes('youtu.be')) {
      return u.pathname.slice(1);
    }
    if (u.hostname.includes('youtube.com')) {
      if (u.searchParams.has('v')) return u.searchParams.get('v');
      const parts = u.pathname.split('/');
      return parts.pop() || null;
    }
  } catch (e) {
    // não é uma URL — talvez seja só o id
    if (/^[A-Za-z0-9_-]{6,}$/.test(urlOrId)) return urlOrId;
  }
  return null;
}

// Endpoint: tocar vídeo (body: { video: "<url-ou-id>", start?: number, mute?: boolean })
app.post('/play-video', requireAuth, (req, res) => {
  console.log('POST /play-video body:', req.body);
  const { video, start = 0, mute = false } = req.body || {};
  const id = extractYouTubeId(String(video || ''));
  console.log('extracted videoId =>', id, 'start=', start, 'mute=', mute);
  if (!id) return res.status(400).json({ error: 'invalid video id/url' });

  // envia evento SSE para TVs
  const update: PanelUpdate = { type: 'playVideo', payload: { videoId: id, start: Number(start) || 0, mute: !!mute }, timestamp: new Date().toISOString() };
  sendEvent(update);

  return res.json({ ok: true, videoId: id });
});

// Endpoint: parar vídeo
app.post('/stop-video', requireAuth, (_req, res) => {
  const update: PanelUpdate = { type: 'stopVideo', payload: {}, timestamp: new Date().toISOString() };
  sendEvent(update);
  return res.json({ ok: true });
});