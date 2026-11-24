// OpenAPI 3.0 description of the public REST API (served at /api/v1/openapi.json).

const ops = [
  // tag, method, path, summary, body example
  ['System', 'get', '/health', 'Health check'],
  ['System', 'get', '/stream', 'Server-Sent Events stream (tick, change, epcis, alert)'],
  ['Master data', 'get', '/products', 'Product master (GTIN, schedule, GST, DPCO ceiling, scheme)'],
  ['Master data', 'get', '/inventory?entityId=E004&kind=fg', 'Inventory by entity / kind with expiry buckets'],
  ['Data Lake', 'get', '/entities?q=&type=STOCKIST&verification=verified', 'Search golden-record entity directory'],
  ['Data Lake', 'get', '/entities/stats', 'Data-lake statistics'],
  ['Data Lake', 'post', '/entities', 'Add entity (GSTIN checksum + dedupe)', { name: 'Sai Medicals', type: 'PHARMACY', gstin: '27ABCPS1234F1Z5', licenseNo: 'Form 20 & 21: MH-123', city: 'Pune' }],
  ['Data Lake', 'post', '/entities/validate-gstin', 'Validate a GSTIN', { gstin: '27AAPFS6610D1Z6' }],
  ['Data Lake', 'post', '/datalake/harvest', 'Run the discovery/verification agent swarm (simulated sources)', { count: 6 }],
  ['Stage 1 · API', 'get', '/stage1/batches', 'List API batches'],
  ['Stage 1 · API', 'get', '/stage1/spec', 'API release specification'],
  ['Stage 1 · API', 'post', '/stage1/dispensing/calc', 'Potency + LOD adjusted dispensing calculation', { theoreticalKg: 100, assayPct: 98.5, lodPct: 0.4 }],
  ['Stage 1 · API', 'post', '/stage1/batches', 'Create API batch (eBMR opened)', { salt: 'Amoxicillin', batchSizeKg: 120, ksmTheoreticalKg: 80, ksmAssayPct: 98.7, ksmLodPct: 0.35 }],
  ['Stage 1 · API', 'post', '/stage1/batches/{id}/qc', 'Record QC / LIMS results', { assay: 99.5, lod: 0.2, totalImpurities: 0.3, kfWater: 0.2, analyst: 'R. Iyer' }],
  ['Stage 1 · API', 'post', '/stage1/batches/{id}/sign', 'Apply eBMR e-signature (MAKER → CHECKER → QA)', { role: 'MAKER', user: 'A. Kulkarni', meaning: 'Executed' }],
  ['Stage 1 · API', 'post', '/stage1/batches/{id}/release-agent', 'Run Autonomous QA/QC Release Agent'],
  ['Stage 1 · API', 'post', '/stage1/batches/{id}/ship', 'Ship released API to a formulator', { toId: 'E002', qtyKg: 50 }],
  ['Stage 2 · Formulation', 'get', '/stage2/batches', 'List finished-goods batches'],
  ['Stage 2 · Formulation', 'get', '/stage2/batches/{id}', 'FG batch detail incl. sample SGTIN / Schedule H2 QR payloads'],
  ['Stage 2 · Formulation', 'post', '/stage2/batches', 'Create FG batch consuming API stock (CoA-linked)', { productId: 'P001', packs: 1000 }],
  ['Stage 2 · Formulation', 'post', '/stage2/batches/{id}/serialize', 'Serialize + aggregate (SGTIN → case → pallet SSCC)'],
  ['Stage 2 · Formulation', 'post', '/stage2/ship', 'FEFO-gated dispatch to stockist (creates ASN)', { toId: 'E004', productId: 'P001', packs: 200 }],
  ['Stage 2 · Formulation', 'post', '/stage2/price-check', 'NPPA / DPCO ceiling-price check', { productId: 'P001', mrp: 31 }],
  ['Stage 2 · Formulation', 'get', '/stage2/demand-sensing', 'AI demand-sensing & reallocation suggestions'],
  ['Shipments · Mesh', 'get', '/shipments?entityId=E004&direction=in', 'List shipments / ASNs'],
  ['Shipments · Mesh', 'get', '/shipments/{id}', 'Shipment detail'],
  ['Shipments · Mesh', 'post', '/shipments/{id}/receive', 'Scan-verify inward (all SSCCs must be scanned)', { scanned: ['<sscc>'] }],
  ['Shipments · Mesh', 'post', '/shipments/{id}/telemetry', 'Push IoT temperature reading (MKT recalculated)', { tempC: 6.2 }],
  ['Shipments · Mesh', 'post', '/shipments/{id}/inject-excursion', 'Demo: force a cold-chain excursion'],
  ['Stage 3 · Stockist', 'post', '/stage3/invoices/quote', 'Price an invoice (schemes, GST, FEFO) without saving', { sellerId: 'E004', buyerId: 'E006', lines: [{ productId: 'P001', qty: 20 }] }],
  ['Stage 3 · Stockist', 'post', '/stage3/invoices', 'Create invoice + IRN + claim debit notes + delivery ASN', { sellerId: 'E004', buyerId: 'E006', lines: [{ productId: 'P001', qty: 20 }] }],
  ['Stage 3 · Stockist', 'get', '/stage3/invoices?entityId=E004', 'List invoices'],
  ['Stage 3 · Stockist', 'get', '/stage3/claims?entityId=E004', 'Manufacturer claims (scheme free goods, expiry returns)'],
  ['Stage 3 · Stockist', 'get', '/stage3/expiry-alerts?entityId=E004', '180/90/60/30-day near-expiry buckets'],
  ['Stage 3 · Stockist', 'post', '/stage3/returns', 'Near-expiry / expired return → credit note + claim', { entityId: 'E004', inventoryId: 'INV-0001', qty: 10 }],
  ['Stage 4 · Pharmacy', 'get', '/stage4/search?q=atorva&entityId=E006', 'Brand / salt search with substitutes ranked by margin'],
  ['Stage 4 · Pharmacy', 'post', '/stage4/clinical-check', 'DDI, duplicate therapy, allergy, pregnancy, paediatric alerts', { productIds: ['P009', 'P010'], patient: { age: 64, allergies: ['penicillin'] } }],
  ['Stage 4 · Pharmacy', 'post', '/stage4/verify', 'Verify a pack code (Schedule H2 QR / DSCSA VRS)', { code: '(01)08901234100016(21)100001(10)FEVB2600(17)271231' }],
  ['Stage 4 · Pharmacy', 'get', '/stage4/sample-pack?entityId=E006', 'Demo: get a valid pack code from stock'],
  ['Stage 4 · Pharmacy', 'post', '/stage4/sales', 'POS sale (Rx rules, DPCO, CDS, FEFO, registers)', { entityId: 'E006', lines: [{ productId: 'P001', qty: 1, unit: 'pack' }], patient: { name: 'Walk-in' } }],
  ['Stage 4 · Pharmacy', 'get', '/stage4/sales?entityId=E006', 'List sales'],
  ['Stage 4 · Pharmacy', 'get', '/stage4/registers?entityId=E006&schedule=H1', 'Statutory Schedule H / H1 / X registers'],
  ['Stage 4 · Pharmacy', 'get', '/stage4/procurement?entityId=E006', 'Multi-distributor procurement agent recommendations'],
  ['Stage 4 · Pharmacy', 'post', '/stage4/procurement/place', 'Place the agent-recommended orders', { entityId: 'E006' }],
  ['Control Tower', 'get', '/tower/state', 'Metro-line tower state: stations, trains, signals, KPIs'],
  ['Control Tower', 'post', '/tower/quarantine', 'Emergency Quarantine / Recall Brake (cascades API → FG)', { batchNo: 'APB2611001', reason: 'Market complaint' }],
  ['Control Tower', 'post', '/tower/lift-quarantine', 'QA lifts a quarantine', { batchNo: 'APB2611001', reason: 'Investigation closed' }],
  ['Control Tower', 'get', '/tower/trace/{batchNo}', 'Batch genealogy & location trace'],
  ['Control Tower', 'post', '/tower/copilot', 'Natural-language Control Room Copilot', { query: 'show red signals' }],
  ['Control Tower', 'get', '/alerts', 'Alert feed'],
  ['EPCIS & Audit', 'get', '/epcis/events?batchNo=&bizStep=shipping', 'GS1 EPCIS 2.0 event repository (JSON-LD)'],
  ['EPCIS & Audit', 'get', '/audit', 'Hash-chained 21 CFR Part 11 audit trail'],
  ['EPCIS & Audit', 'get', '/audit/verify', 'Verify the audit hash chain'],
  ['Demo', 'post', '/demo/scenario', 'Run an end-to-end demo across all 4 stages'],
  ['Demo', 'post', '/demo/reset', 'Reset demo data'],
];

function build(baseUrl = '') {
  const paths = {};
  for (const [tag, method, rawPath, summary, example] of ops) {
    const [p, qs] = rawPath.split('?');
    const params = [];
    for (const m of p.matchAll(/\{(\w+)\}/g)) params.push({ name: m[1], in: 'path', required: true, schema: { type: 'string' } });
    if (qs) for (const kv of qs.split('&')) params.push({ name: kv.split('=')[0], in: 'query', required: false, schema: { type: 'string' }, example: kv.split('=')[1] || undefined });
    paths[p] = paths[p] || {};
    paths[p][method] = {
      tags: [tag], summary, parameters: params,
      ...(example ? { requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' }, example } } } } : {}),
      responses: { 200: { description: 'OK' }, 400: { description: 'Validation error' }, 404: { description: 'Not found' }, 409: { description: 'Business-rule conflict' }, 422: { description: 'Verification failed' } },
    };
  }
  return {
    openapi: '3.0.3',
    info: { title: 'PharmaChain OS API', version: '0.1.0', description: 'Open REST API for the 4-stage pharma supply chain MVP. Every stage module, the GS1/EPCIS mesh, the Metro-Line Control Tower and the Entity Data Lake are exposed so third parties can build on top. Errors return {error, details}.' },
    servers: [{ url: `${baseUrl}/api/v1` }],
    paths,
  };
}

module.exports = { build, ops };
