// Express app factory - used by the standalone server and the Electron desktop shell.
const fs = require('fs');
const path = require('path');
const express = require('express');
const { Store } = require('./store');
const { seed } = require('./seed');
const { createServices } = require('./services');
const openapi = require('./openapi');

function createApp({ dataDir, tickMs = 1000 } = {}) {
  const store = new Store(dataDir || path.join(__dirname, '..', 'data')).load(seed);
  const svc = createServices(store);
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  // Open CORS so third-party apps can build on the API
  app.use('/api', (req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  const api = express.Router();
  const h = (fn) => (req, res) => {
    try {
      const out = fn(req);
      res.json(out);
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e);
      res.status(status).json({ error: e.message, details: e.extra || null });
    }
  };
  const b = (req) => req.body || {};
  const q = (req) => req.query || {};

  // System
  api.get('/health', h(() => ({ ok: true, service: 'pharmachain-os', version: '0.1.0', time: new Date().toISOString() })));
  api.get('/openapi.json', (req, res) => res.json(openapi.build(`${req.protocol}://${req.get('host')}`)));
  api.get('/stream', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    res.write(`event: hello\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`);
    const unsub = store.subscribe((msg) => res.write(`event: ${msg.type}\ndata: ${JSON.stringify(msg)}\n\n`));
    req.on('close', unsub);
  });

  // Master data & Data Lake
  api.get('/products', h(() => svc.products()));
  api.get('/inventory', h((r) => svc.inventory(q(r))));
  api.get('/entities/stats', h(() => svc.dataLakeStats()));
  api.get('/entities', h((r) => svc.listEntities(q(r))));
  api.get('/entities/:id', h((r) => svc.getEntity(r.params.id)));
  api.post('/entities', h((r) => svc.addEntity(b(r))));
  api.post('/entities/validate-gstin', h((r) => svc.validateGstin(b(r).gstin)));
  api.post('/datalake/harvest', h((r) => svc.harvest(b(r))));

  // Stage 1
  api.get('/stage1/batches', h(() => svc.apiBatches()));
  api.get('/stage1/salts', h(() => svc.apiSalts()));
  api.get('/stage1/spec', h(() => svc.spec()));
  api.get('/stage1/batches/:id', h((r) => svc.getApiBatch(r.params.id)));
  api.post('/stage1/dispensing/calc', h((r) => svc.dispensingCalc(b(r))));
  api.post('/stage1/batches', h((r) => svc.createApiBatch(b(r))));
  api.post('/stage1/batches/:id/qc', h((r) => svc.recordQc(r.params.id, b(r), b(r).analyst)));
  api.post('/stage1/batches/:id/sign', h((r) => svc.signBatch(r.params.id, b(r))));
  api.post('/stage1/batches/:id/release-agent', h((r) => svc.runReleaseAgent(r.params.id)));
  api.post('/stage1/batches/:id/ship', h((r) => svc.shipApi(r.params.id, b(r))));

  // Stage 2
  api.get('/stage2/batches', h(() => svc.fgBatches()));
  api.get('/stage2/batches/:id', h((r) => svc.fgBatchDetail(r.params.id)));
  api.post('/stage2/batches', h((r) => svc.createFgBatch(b(r))));
  api.post('/stage2/batches/:id/serialize', h((r) => svc.serializeFg(r.params.id, b(r))));
  api.post('/stage2/ship', h((r) => svc.shipFg(b(r))));
  api.post('/stage2/price-check', h((r) => svc.priceCheck(b(r))));
  api.get('/stage2/demand-sensing', h(() => svc.demandSensing()));

  // Shipments / mesh
  api.get('/shipments', h((r) => svc.listShipments(q(r))));
  api.get('/shipments/:id', h((r) => svc.getShipment(r.params.id)));
  api.post('/shipments/:id/receive', h((r) => svc.receiveShipment(r.params.id, b(r))));
  api.post('/shipments/:id/telemetry', h((r) => svc.addTelemetry(r.params.id, b(r))));
  api.post('/shipments/:id/inject-excursion', h((r) => svc.injectExcursion(r.params.id)));

  // Stage 3
  api.post('/stage3/invoices/quote', h((r) => svc.quoteInvoice(b(r))));
  api.post('/stage3/invoices', h((r) => svc.createInvoice(b(r))));
  api.get('/stage3/invoices', h((r) => svc.invoices(q(r))));
  api.get('/stage3/claims', h((r) => svc.claims(q(r))));
  api.get('/stage3/expiry-alerts', h((r) => svc.expiryAlerts(q(r).entityId || 'E004')));
  api.post('/stage3/returns', h((r) => svc.returnNearExpiry(b(r))));
  api.get('/stage3/credit-notes', h(() => svc.creditNotes()));

  // Stage 4
  api.get('/stage4/search', h((r) => svc.search(q(r))));
  api.post('/stage4/clinical-check', h((r) => svc.clinicalCheck(b(r))));
  api.post('/stage4/verify', h((r) => svc.verifyPack(b(r))));
  api.get('/stage4/sample-pack', h((r) => svc.samplePack(q(r))));
  api.post('/stage4/sales', h((r) => svc.createSale(b(r))));
  api.get('/stage4/sales', h((r) => svc.sales(q(r))));
  api.get('/stage4/registers', h((r) => svc.registers(q(r))));
  api.get('/stage4/procurement', h((r) => svc.procurementAgent(q(r).entityId || 'E006')));
  api.post('/stage4/procurement/place', h((r) => svc.placeProcurement(b(r).entityId || 'E006')));

  // Control tower
  api.get('/tower/state', h(() => svc.towerState()));
  api.post('/tower/quarantine', h((r) => svc.quarantineBatch(b(r).batchNo, b(r).reason || 'Emergency Quarantine Recall Brake', b(r).user || 'Control Room')));
  api.post('/tower/lift-quarantine', h((r) => svc.liftQuarantine(b(r).batchNo, b(r))));
  api.get('/tower/trace/:batchNo', h((r) => svc.traceBatch(r.params.batchNo) || (() => { throw new svc.HttpError(404, 'Batch not found'); })()));
  api.post('/tower/copilot', h((r) => svc.copilot(b(r))));
  api.get('/alerts', h(() => svc.alerts()));

  // EPCIS & audit
  api.get('/epcis/events', h((r) => svc.events(q(r))));
  api.get('/audit', h((r) => svc.auditTrail(q(r))));
  api.get('/audit/verify', h(() => svc.verifyAudit()));

  // Demo
  api.post('/demo/scenario', h(() => svc.runScenario()));
  api.post('/demo/reset', h(() => svc.reset()));

  api.use((req, res) => res.status(404).json({ error: `No route ${req.method} ${req.path}` }));
  app.use('/api/v1', api);

  // Android Trusted Web Activity: Digital Asset Links proving this site owns the Play Store app.
  // The real file holds your package name + signing-key fingerprint, so it lives (git-ignored) at
  // <project>/assetlinks.json on the server. See assetlinks.example.json.
  const assetLinksFile = process.env.ASSETLINKS_FILE || path.join(__dirname, '..', 'assetlinks.json');
  app.get('/.well-known/assetlinks.json', (req, res) => {
    if (!fs.existsSync(assetLinksFile)) return res.status(404).json({ error: 'assetlinks.json not configured on this server' });
    res.type('application/json').sendFile(path.resolve(assetLinksFile));
  });

  // React frontend (built by Vite into dist-web/)
  const webDir = path.join(__dirname, '..', 'dist-web');
  app.use(express.static(webDir));
  app.get('/', (req, res) => {
    if (fs.existsSync(path.join(webDir, 'index.html'))) return res.sendFile(path.join(webDir, 'index.html'));
    res.status(503).send('Frontend not built yet. Run <code>npm run build</code> (or use <code>npm run dev</code> for hot reload).');
  });

  const timer = setInterval(() => svc.tick(tickMs), tickMs);
  timer.unref();

  return { app, store, svc, stop: () => { clearInterval(timer); store.saveNow(); } };
}

module.exports = { createApp };
