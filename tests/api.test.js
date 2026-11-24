// End-to-end API test: walks a batch through all four stages over HTTP.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../server/app');

let server, base, ctx;

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcx-test-'));
  ctx = createApp({ dataDir: dir, tickMs: 100000 }); // manual ticks only
  await new Promise((r) => { server = ctx.app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
test.after(() => { ctx.stop(); server.close(); });

const call = async (method, p, body) => {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};
const arrive = (id) => { const s = ctx.store.db.shipments.find((x) => x.id === id); s.progress = 1; ctx.svc.tick(1); };

test('health + openapi', async () => {
  assert.equal((await call('GET', '/health')).body.ok, true);
  const spec = (await call('GET', '/openapi.json')).body;
  assert.equal(spec.openapi, '3.0.3');
  assert.ok(Object.keys(spec.paths).length > 40);
});

test('full chain: API batch → release → formulation → serialization → stockist → invoice → pharmacy sale', async () => {
  // Stage 1
  const b = (await call('POST', '/stage1/batches', { salt: 'Atorvastatin', batchSizeKg: 30, ksmTheoreticalKg: 20, ksmAssayPct: 99, ksmLodPct: 0.3 })).body;
  assert.equal(b.status, 'in_process');
  await call('POST', `/stage1/batches/${b.id}/qc`, { assay: 99.8, lod: 0.1, totalImpurities: 0.2, kfWater: 0.1 });
  assert.equal((await call('POST', `/stage1/batches/${b.id}/sign`, { role: 'QA', user: 'QA Early' })).status, 409); // order enforced
  await call('POST', `/stage1/batches/${b.id}/sign`, { role: 'MAKER', user: 'Maker One' });
  assert.equal((await call('POST', `/stage1/batches/${b.id}/sign`, { role: 'CHECKER', user: 'maker one' })).status, 409); // segregation of duties
  await call('POST', `/stage1/batches/${b.id}/sign`, { role: 'CHECKER', user: 'Checker Two' });
  assert.equal((await call('POST', `/stage1/batches/${b.id}/release-agent`)).body.agentReport.verdict, 'PASS');
  const rel = (await call('POST', `/stage1/batches/${b.id}/sign`, { role: 'QA', user: 'QA Three' })).body;
  assert.equal(rel.status, 'released');
  assert.ok(rel.coa.coaNo);

  const s1 = (await call('POST', `/stage1/batches/${b.id}/ship`, { toId: 'E002', qtyKg: 10 })).body;
  assert.equal((await call('POST', `/shipments/${s1.id}/receive`, { scanned: s1.ssccs })).status, 409); // not arrived
  arrive(s1.id);
  assert.equal((await call('POST', `/shipments/${s1.id}/receive`, { scanned: s1.ssccs.slice(1) })).status, 422 - (s1.ssccs.length > 1 ? 0 : 0));
  assert.equal((await call('POST', `/shipments/${s1.id}/receive`, { scanned: s1.ssccs })).status, 200);

  // Stage 2
  const fg = (await call('POST', '/stage2/batches', { productId: 'P006', packs: 500, apiBatchNo: b.batchNo })).body;
  assert.equal(fg.apiBatchNo, b.batchNo);
  assert.equal((await call('POST', '/stage2/ship', { toId: 'E004', productId: 'P006', packs: 10, batchNo: fg.batchNo })).status, 409); // FEFO/unserialized
  const ser = (await call('POST', `/stage2/batches/${fg.id}/serialize`)).body;
  assert.equal(ser.samples.length, 5);
  const s2 = (await call('POST', '/stage2/ship', { toId: 'E004', productId: 'P006', packs: 100, batchNo: fg.batchNo, overrideFefo: true })).body;
  arrive(s2.id);
  assert.equal((await call('POST', `/shipments/${s2.id}/receive`, { scanned: s2.ssccs })).status, 200);

  // Stage 3
  const quote = (await call('POST', '/stage3/invoices/quote', { sellerId: 'E004', buyerId: 'E006', lines: [{ productId: 'P001', qty: 22 }] })).body;
  assert.equal(quote.lines[0].free, 2);
  assert.equal(quote.interState, false);
  const inv = (await call('POST', '/stage3/invoices', { sellerId: 'E004', buyerId: 'E007', lines: [{ productId: 'P001', qty: 22 }] })).body;
  assert.equal(inv.interState, true); // MH → KA
  assert.equal(inv.irn.length, 64);
  assert.ok((await call('GET', '/stage3/claims?entityId=E004')).body.some((c) => c.invoiceNo === inv.invoiceNo));

  // Stage 4
  const r = await call('POST', '/stage4/sales', { entityId: 'E006', lines: [{ productId: 'P009', qty: 1 }, { productId: 'P010', qty: 1 }], prescriber: { name: 'Dr X', regNo: 'MMC-1' }, patient: { name: 'A' } });
  assert.equal(r.status, 409); // warfarin + clopidogrel
  assert.ok(r.body.details.alerts.length);
  assert.equal((await call('POST', '/stage4/sales', { entityId: 'E006', lines: [{ productId: 'P004', qty: 1 }] })).status, 422); // H1 without Rx
  const pack = (await call('GET', '/stage4/sample-pack?entityId=E006&productId=P001')).body;
  assert.equal((await call('POST', '/stage4/verify', { code: pack.code })).body.status, 'AUTHENTIC');
  const sale = (await call('POST', '/stage4/sales', { entityId: 'E006', lines: [{ productId: 'P001', qty: 5, unit: 'loose' }], scannedCodes: [pack.code] })).body;
  assert.equal(sale.lines[0].packs, Math.round((5 / 15) * 1000) / 1000);
  assert.equal((await call('POST', '/stage4/verify', { code: pack.code })).body.status, 'ALREADY_DISPENSED');
  assert.equal((await call('POST', '/stage4/verify', { code: '(01)08901234999990(21)1(10)X(17)270101' })).body.status, 'SUSPECT_COUNTERFEIT');
});

test('recall brake cascades from API batch to downstream FG batches', async () => {
  const res = (await call('POST', '/tower/quarantine', { batchNo: 'APB2611001', reason: 'test recall' })).body;
  assert.ok(res.cascade.length > 1);
  const inv = ctx.store.db.inventory.filter((r) => res.cascade.includes(r.batchNo));
  assert.ok(inv.every((r) => r.quarantined));
  const lifted = (await call('POST', '/tower/lift-quarantine', { batchNo: 'APB2611001' })).body;
  assert.equal(lifted.released.length, res.cascade.length);
});

test('OOS result auto-quarantines via release agent', async () => {
  const b = (await call('POST', '/stage1/batches', { salt: 'Metformin', batchSizeKg: 10, ksmTheoreticalKg: 8, ksmAssayPct: 99, ksmLodPct: 0.3 })).body;
  await call('POST', `/stage1/batches/${b.id}/qc`, { assay: 95.2, lod: 0.1, totalImpurities: 0.2, kfWater: 0.1 });
  const r = (await call('POST', `/stage1/batches/${b.id}/release-agent`)).body;
  assert.equal(r.agentReport.verdict, 'FAIL');
  assert.equal(r.status, 'quarantined');
  assert.ok(r.agentReport.deviationDraft);
});

test('cold-chain excursion quarantines shipment', async () => {
  const s = ctx.store.db.shipments.find((x) => x.coldChain && x.status === 'in_transit');
  for (let i = 0; i < 6; i++) await call('POST', `/shipments/${s.id}/telemetry`, { tempC: 18 });
  assert.equal(ctx.store.db.shipments.find((x) => x.id === s.id).status, 'quarantined');
});

test('data lake: GSTIN validation + dedupe + harvest', async () => {
  const dup = (await call('POST', '/entities', { name: 'X', type: 'STOCKIST', gstin: ctx.store.db.entities[3].gstin })).body;
  assert.equal(dup.status, 'duplicate');
  const bad = (await call('POST', '/entities', { name: 'New Chem', type: 'PHARMACY', gstin: '27ABCDE1234F1Z1' })).body;
  assert.equal(bad.status, 'unverified');
  const h = (await call('POST', '/datalake/harvest', { count: 10 })).body;
  assert.equal(h.discovered, 10);
});

test('copilot + audit chain integrity', async () => {
  assert.match((await call('POST', '/tower/copilot', { query: 'trace APB2611001' })).body.answer, /APB2611001/);
  assert.equal((await call('GET', '/audit/verify')).body.valid, true);
  assert.ok((await call('GET', '/epcis/events?bizStep=shipping')).body.length > 0);
});

