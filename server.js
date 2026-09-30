const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const distDir = path.join(__dirname, 'dist');
const applications = new Map();
const idempotency = new Map();
const inFlightRequests = new Map();
const events = [];

const lenders = [
  { id: 'northstar', name: 'Northstar Bank', color: '#5267e8', rate: 10.4, fee: 1499, delay: 420 },
  { id: 'harbor', name: 'Harbor Finance', color: '#159c83', rate: 11.2, fee: 999, delay: 700 },
  { id: 'summit', name: 'Summit Credit', color: '#d88138', rate: 9.9, fee: 1999, delay: 560 },
];

function record(type, applicationId, message, details = {}) {
  const event = { id: crypto.randomUUID(), type, applicationId, message, details, at: new Date().toISOString() };
  events.unshift(event);
  if (events.length > 100) events.pop();
  return event;
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 20_000) reject(new Error('Request body too large')); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function withTimeout(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Lender request timed out')), ms); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function queryLender(lender, application, scenario) {
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    record('lender.requested', application.id, `Request sent to ${lender.name}`, { lenderId: lender.id, attempt });
    try {
      const shouldFail = scenario === 'one-timeout' && lender.id === 'harbor';
      await withTimeout((async () => {
        await sleep(shouldFail ? 1300 : lender.delay);
        return true;
      })(), 900);
      const principal = Number(application.amount);
      const months = Number(application.tenure);
      const monthlyRate = lender.rate / 1200;
      const emi = Math.round(principal * monthlyRate * (1 + monthlyRate) ** months / ((1 + monthlyRate) ** months - 1));
      record('lender.offer_received', application.id, `Offer received from ${lender.name}`, { lenderId: lender.id, attempt });
      return { lenderId: lender.id, lender: lender.name, status: 'offer', rate: lender.rate, fee: lender.fee, emi, attempts: attempt };
    } catch (error) {
      record('lender.retry', application.id, `${lender.name} timed out · ${attempt < maxAttempts ? 'retrying once' : 'no more retries'}`, { lenderId: lender.id, attempt });
      if (attempt === maxAttempts) return { lenderId: lender.id, lender: lender.name, status: 'unavailable', error: 'Timed out after retry', attempts: attempt };
    }
  }
}

async function createApplication(input, key) {
  const app = {
    id: `APP-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
    amount: Number(input.amount), tenure: Number(input.tenure), product: input.product,
    scenario: input.scenario || 'normal', status: 'processing', createdAt: new Date().toISOString(), offers: [],
  };
  applications.set(app.id, app);
  idempotency.set(key, app.id);
  record('application.created', app.id, 'Application accepted for lender matching', { product: app.product, amount: app.amount });
  const results = await Promise.all(lenders.map(lender => queryLender(lender, app, app.scenario)));
  app.offers = results;
  app.status = results.some(result => result.status === 'offer') ? 'completed' : 'no_offers';
  app.completedAt = new Date().toISOString();
  record('application.completed', app.id, app.status === 'completed' ? 'Lender matching completed' : 'No lenders returned an offer', { availableOffers: results.filter(result => result.status === 'offer').length });
  return app;
}

function getApplication(id) {
  const app = applications.get(id);
  if (!app) return null;
  return { ...app, events: events.filter(event => event.applicationId === id).reverse() };
}

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true, service: 'lender-orchestrator', mode: 'mock' });
    if (req.method === 'GET' && url.pathname === '/api/events') return send(res, 200, { events: events.slice(0, 30) });
    if (req.method === 'GET' && url.pathname.startsWith('/api/applications/')) {
      const app = getApplication(decodeURIComponent(url.pathname.split('/').pop()));
      return app ? send(res, 200, app) : send(res, 404, { error: 'Application not found' });
    }
    if (req.method === 'POST' && url.pathname === '/api/applications') {
      const input = await readBody(req);
      if (!['used-car', 'two-wheeler'].includes(input.product)) return send(res, 400, { error: 'Choose used-car or two-wheeler financing.' });
      if (!Number.isFinite(Number(input.amount)) || Number(input.amount) < 25000 || Number(input.amount) > 2500000) return send(res, 400, { error: 'Amount must be between ₹25,000 and ₹25,00,000.' });
      if (![12, 24, 36, 48, 60].includes(Number(input.tenure))) return send(res, 400, { error: 'Choose a supported tenure.' });
      const key = String(req.headers['idempotency-key'] || '').trim();
      if (!key || key.length > 100) return send(res, 400, { error: 'A valid Idempotency-Key header is required.' });
      if (idempotency.has(key)) {
        const existingId = idempotency.get(key);
        const pending = inFlightRequests.get(key);
        const existing = pending ? await pending : applications.get(existingId);
        record('application.duplicate_prevented', existing.id, 'Duplicate request returned the original application', { key });
        return send(res, 200, { ...getApplication(existing.id), idempotentReplay: true });
      }
      const pending = createApplication(input, key);
      inFlightRequests.set(key, pending);
      let app;
      try { app = await pending; } finally { inFlightRequests.delete(key); }
      return send(res, 201, app);
    }
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
      if (!fs.existsSync(path.join(distDir, 'index.html'))) return send(res, 503, { error: 'Build the React app first with npm run build.' });
      const pathname = path.normalize(decodeURIComponent(url.pathname)).replace(/^([.][.][/\\])+/, '');
      const candidate = path.join(distDir, pathname === '/' ? 'index.html' : pathname);
      const file = candidate.startsWith(distDir + path.sep) && fs.existsSync(candidate) ? candidate : path.join(distDir, 'index.html');
      if (!file.startsWith(distDir + path.sep)) return send(res, 403, { error: 'Forbidden' });
      fs.readFile(file, (error, data) => {
        if (error) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      });
      return;
    }
    send(res, 404, { error: 'Route not found' });
  } catch (error) {
    send(res, 400, { error: error.message || 'Unexpected error' });
  }
});

server.listen(PORT, () => console.log(`Lender orchestration demo running at http://localhost:${PORT}`));
