import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import path from 'path';
import { Sector, Physician, Patient, PanelUpdate, SectorStatus, PhysicianStatus, Route } from './models';

// const app = express();
// app.use(cors());
// app.use(bodyParser.json());

const app = express();
app.use(cors());
app.use(bodyParser.json());

// servir arquivos estáticos (index.html, tv.html, app.js, tv.js, estilos etc.)
// usa caminho relativo ao dist -> ../public
app.use(express.static(path.join(__dirname, '..', 'public')));


// serve static public files
app.use(express.static(path.join(__dirname, '..', 'public')));

const PORT = process.env.PORT ? Number(process.env.PORT) : 3333;

// in-memory state
const sectors = new Map<string, Sector>();
const physicians = new Map<string, Physician>();
const patients = new Map<string, Patient>();

// initial sample data
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
    try { c.res.write(payload); } catch(e) {}
  });
}

// SSE endpoint
app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const clientId = Date.now().toString();
  clients.push({ id: clientId, res });

  // send snapshot
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

  req.on('close', () => {
    const idx = clients.findIndex(c => c.id === clientId);
    if (idx >= 0) clients.splice(idx, 1);
  });
});

// REST endpoints - sectors
app.get('/sectors', (_req, res) => res.json(Array.from(sectors.values())));

// --- Handler: atualizar setor (status, reason, etaMinutes, instruction) ---
app.post('/sectors/:id', (req, res) => {
  const id = req.params.id as string;
  const sector = sectors.get(id);
  if (!sector) return res.status(404).json({ error: 'sector not found' });

  // pegar valores do body (aceita número para etaMinutes)
  const status = req.body.status as SectorStatus | undefined;
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : undefined;
  // converter explicitamente para número quando possível
  const etaRaw = req.body.etaMinutes;
  const eta = (typeof etaRaw === 'number') ? etaRaw : (typeof etaRaw === 'string' && etaRaw !== '' ? Number(etaRaw) : undefined);
  const instruction = typeof req.body.instruction === 'string' ? req.body.instruction.trim() : undefined;

  // valida status quando presente
  if (status) {
    const allowed: SectorStatus[] = ['Aberto', 'Restrito'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'invalid status' });
    sector.status = status;
    // se abriu, remover campos de restrição
    if (status !== 'Restrito') {
      delete sector.reason;
      delete sector.etaMinutes;
      delete sector.instruction;
    }
  }

  // só grava reason/eta/instruction quando vierem explicitamente
  if (typeof reason === 'string' && reason.length) sector.reason = reason;
  if (typeof eta === 'number' && !Number.isNaN(eta)) sector.etaMinutes = eta;
  if (typeof instruction === 'string' && instruction.length) sector.instruction = instruction;

  // enviar evento SSE (payload completo do setor)
  const update: PanelUpdate = { type: 'sector', payload: sector, timestamp: new Date().toISOString() };
  sendEvent(update);

  // e responder com o setor atualizado
  return res.json(sector);
});


// REST endpoints - physicians
app.get('/physicians', (_req, res) => res.json(Array.from(physicians.values())));

app.post('/physicians', (req, res) => {
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

app.post('/physicians/:id/status', (req, res) => {
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

app.delete('/physicians/:id', (req, res) => {
  const id = req.params.id as string;
  const existed = physicians.delete(id);
  if (!existed) return res.status(404).json({ error: 'physician not found' });
  const update: PanelUpdate = { type: 'physician', payload: { id, action: 'deleted' }, timestamp: new Date().toISOString() };
  sendEvent(update);
  res.status(204).send();
});

// REST endpoints - patients
app.get('/patients', (_req, res) => res.json(Array.from(patients.values())));

app.post('/patients', (req, res) => {
  const { id, name } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id and name required' });
  if (patients.has(id)) return res.status(409).json({ error: 'id exists' });
  const p: Patient = { id, name, routedTo: 'Aguardando' };
  patients.set(id, p);
  const update: PanelUpdate = { type: 'patient', payload: p, timestamp: new Date().toISOString() };
  sendEvent(update);
  res.status(201).json(p);
});

app.post('/patients/:id/route', (req, res) => {
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

app.delete('/patients/:id', (req, res) => {
  const id = req.params.id as string;
  const existed = patients.delete(id);
  if (!existed) return res.status(404).json({ error: 'patient not found' });
  const update: PanelUpdate = { type: 'patient', payload: { id, action: 'deleted' }, timestamp: new Date().toISOString() };
  sendEvent(update);
  res.status(204).send();
});

// TV route
app.get('/tv', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'tv.html'));
});

// fallback already served by express.static for public files

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
