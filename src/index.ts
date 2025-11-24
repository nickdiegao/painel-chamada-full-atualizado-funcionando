// src/app.ts
import express from 'express';
import cors from 'cors';
import path from 'path';
import session from 'express-session';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';

// modelos (mantive seu import original)
import { Sector, Physician, Patient, PanelUpdate, SectorStatus, PhysicianStatus, Route } from './models';

dotenv.config();

const app = express();
app.use(cors());

// parsers (usar apenas estes)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// static (aponta para ../public - funciona em ts-node e em dist)
// IMPORTANT: index:false -> evita que express sirva index.html automaticamente (prevenção de acesso direto)
const publicPath = path.join(__dirname, '..', 'public');
app.use(express.static(publicPath, { index: false }));

// cookie + session
app.use(cookieParser());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'troque-isto-por-uma-chave-secreta',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 2, // 2 horas
      // secure: true // habilite em produção com HTTPS
    },
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

function sendEvent(update: PanelUpdate) {
  const payload = `data: ${JSON.stringify(update)}\n\n`;
  clients.forEach(c => {
    try { c.res.write(payload); } catch(e) { /* ignore */ }
  });
}

// ---------- Authentication helpers ----------
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.session && (req.session as any).isAdmin) return next();

  // se for request AJAX/JSON, retorne 401 JSON; senão redirecione para /login
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
  return res.sendFile(path.join(publicPath, 'login.html'));
});

// POST /login - aceita form-urlencoded ou JSON, responde JSON { ok:true } em sucesso
app.post('/login', (req, res) => {
  console.log('POST /login - body:', req.body);
  const { username, password } = req.body || {};
  const ADMIN_USER = process.env.ADMIN_USER || 'admin';
  const ADMIN_PASS = process.env.ADMIN_PASS || 'senha123';

  if (!username || !password) {
    return res.status(400).json({ ok: false, error: 'username/password missing' });
  }

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    (req.session as any).isAdmin = true;
    (req.session as any).user = username;
    return res.json({ ok: true });
  }

  return res.status(401).json({ ok: false, error: 'Credenciais inválidas' });
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
// SSE endpoint robusto — substitua o atual por este
app.get('/events', (req, res) => {
  // headers obrigatórios para SSE
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  // evita que proxies ou compressão quebrem o fluxo
  // se você usa compression middleware globalmente, ele pode bufferizar. 
  // Uma medida é desabilitar compressão para esta rota (veja nota abaixo).
  // Força envio imediato dos headers
  res.flushHeaders && res.flushHeaders();

  // mantém socket aberto indefinidamente
  (req.socket as any).setTimeout && (req.socket as any).setTimeout(0);

  const clientId = Date.now().toString();
  clients.push({ id: clientId, res });

  // envia um heartbeat inicial de segurança (comentário)
  res.write(':ok\n\n');

  // envia snapshot inicial (conjunto completo)
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

  // envia heartbeats periódicos para manter conexão viva e detectar disconnect
  const heartbeat = setInterval(() => {
    try {
      res.write(`:heartbeat ${Date.now()}\n\n`);
    } catch (err) {
      // ignore
    }
  }, 15000); // 15s

  req.on('close', () => {
    clearInterval(heartbeat);
    const idx = clients.findIndex(c => c.id === clientId);
    if (idx >= 0) clients.splice(idx, 1);
  });
});


// ---------- REST endpoints (agora protegidos por requireAuth) ----------
app.get('/sectors', requireAuth, (_req, res) => res.json(Array.from(sectors.values())));

app.post('/sectors/:id', requireAuth, (req, res) => {
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

app.post('/physicians/:id/status', requireAuth, (req, res) => {
  const id = req.params.id as string;
  const status = req.body.status as PhysicianStatus;
  const allowed: PhysicianStatus[] = ['Disponível', 'Ocupado', 'Ausente'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'invalid status' });
  const doc = physicians.get(id);
  if (!doc) return res.status(404).json({ error: 'physician not found' });
  doc.availabilityStatus = status;
  const update: PanelUpdate = { type: 'physician', payload: doc, timestamp: new Date().toISOString() };
  sendEvent(update);
  res.json(doc);
});

app.delete('/physicians/:id', requireAuth, (req, res) => {
  const id = req.params.id as string;
  const existed = physicians.delete(id);
  if (!existed) return res.status(404).json({ error: 'physician not found' });
  const update: PanelUpdate = { type: 'physician', payload: { id, action: 'deleted' }, timestamp: new Date().toISOString() };
  sendEvent(update);
  res.status(204).send();
});

app.get('/patients', requireAuth, (_req, res) => res.json(Array.from(patients.values())));

app.post('/patients', requireAuth, (req, res) => {
  const { id, name } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id and name required' });
  if (patients.has(id)) return res.status(409).json({ error: 'id exists' });
  const p: Patient = { id, name, routedTo: 'Aguardando' };
  patients.set(id, p);
  const update: PanelUpdate = { type: 'patient', payload: p, timestamp: new Date().toISOString() };
  sendEvent(update);
  res.status(201).json(p);
});

app.post('/patients/:id/route', requireAuth, (req, res) => {
  const id = req.params.id as string;
  const route = req.body.route as Route;
  const allowed: Route[] = ['Sala Vermelha','Sala Amarela','Sala Verde','Aguardando'];
  if (!allowed.includes(route)) return res.status(400).json({ error: 'invalid route' });
  const patient = patients.get(id);
  if (!patient) return res.status(404).json({ error: 'patient not found' });
  patient.routedTo = route;
  const update: PanelUpdate = { type: 'patient', payload: patient, timestamp: new Date().toISOString() };
  sendEvent(update);
  res.json(patient);
});

app.delete('/patients/:id', requireAuth, (req, res) => {
  const id = req.params.id as string;
  const existed = patients.delete(id);
  if (!existed) return res.status(404).json({ error: 'patient not found' });
  const update: PanelUpdate = { type: 'patient', payload: { id, action: 'deleted' }, timestamp: new Date().toISOString() };
  sendEvent(update);
  res.status(204).send();
});

// TV route (mantive pública)
app.get('/tv', (req, res) => {
  res.sendFile(path.join(publicPath, 'tv.html'));
});

// proteger acesso direto ao index.html (se alguém tentar /index.html)
app.get('/index.html', requireAuth, (req, res) => {
  return res.sendFile(path.join(publicPath, 'index.html'));
});

// Root: serve painel (index.html) apenas se autenticado, caso contrário redireciona para /login
app.get('/', (req, res) => {
  if (req.session && (req.session as any).isAdmin) {
    return res.sendFile(path.join(publicPath, 'index.html'));
  }
  return res.redirect('/login');
});

// fallback: static already serve arquivos estáticos (css/js/images) do public (com index:false)

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on 0.0.0.0:${PORT}`);
});
