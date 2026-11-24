// Demo seed data: fictional companies, products and stock across the 4 stages.
const gs1 = require('./domain/gs1');
const gstin = require('./domain/gstin');
const audit = require('./domain/audit');
const { evaluateQc, dispensingQty } = require('./domain/pharma');

const day = 86400000;
const iso = (offsetDays, base = Date.now()) => new Date(base + offsetDays * day).toISOString();
const COMPANY_PREFIX = '8901234';

const CATEGORIES = [
  { id: 'analgesic', name: 'Analgesic Line', color: '#3b82f6' },
  { id: 'anti-infective', name: 'Anti-Infective Line', color: '#a855f7' },
  { id: 'cardio-diabetic', name: 'Cardio-Diabetic Line', color: '#14b8a6' },
  { id: 'cns', name: 'CNS / Controlled Line', color: '#ec4899' },
  { id: 'cold-chain', name: 'Cold-Chain Lane (2-8 °C)', color: '#38bdf8' },
];

// brand, salt, strengthMg, form, packSize, schedule, category, gst%, mrp, ptr, pts, ceiling, coldChain, drugClass, scheme
const PRODUCT_ROWS = [
  ['Feverex 500', 'Paracetamol', 500, 'Tablet', 15, 'OTC', 'analgesic', 12, 30, 24, 21.4, 30.6, false, 'analgesic', { type: 'free', buy: 10, free: 1 }],
  ['Paracetamol 500 (Generic)', 'Paracetamol', 500, 'Tablet', 15, 'OTC', 'analgesic', 12, 18, 9, 7.5, 30.6, false, 'analgesic', { type: 'slab', slabs: [{ minQty: 50, pct: 5 }, { minQty: 100, pct: 8 }] }],
  ['Amoxa 500', 'Amoxicillin', 500, 'Capsule', 10, 'H', 'anti-infective', 12, 98, 78.4, 70, 102.5, false, 'penicillin', { type: 'cd', cdPct: 3 }],
  ['Cefixa 200', 'Cefixime', 200, 'Tablet', 10, 'H1', 'anti-infective', 12, 109, 87.2, 78.5, null, false, 'cephalosporin', { type: 'free', buy: 10, free: 1 }],
  ['Clarith 500', 'Clarithromycin', 500, 'Tablet', 10, 'H', 'anti-infective', 12, 285, 228, 205, null, false, 'macrolide', null],
  ['Atorva 10', 'Atorvastatin', 10, 'Tablet', 15, 'H', 'cardio-diabetic', 12, 110, 88, 79, 115.2, false, 'statin', { type: 'free', buy: 5, free: 1, cdPct: 2 }],
  ['Atorvastatin 10 (Generic)', 'Atorvastatin', 10, 'Tablet', 15, 'H', 'cardio-diabetic', 12, 62, 31, 26, 115.2, false, 'statin', { type: 'slab', slabs: [{ minQty: 30, pct: 4 }, { minQty: 60, pct: 7 }] }],
  ['Glucomet 500', 'Metformin', 500, 'Tablet', 20, 'H', 'cardio-diabetic', 12, 36, 28.8, 25.9, 38, false, 'biguanide', { type: 'free', buy: 10, free: 1 }],
  ['Warfin 5', 'Warfarin', 5, 'Tablet', 10, 'H', 'cardio-diabetic', 12, 52, 41.6, 37.4, null, false, 'anticoagulant', null],
  ['Asprin 75', 'Aspirin', 75, 'Tablet', 14, 'OTC', 'cardio-diabetic', 12, 6, 4.8, 4.3, 6.5, false, 'antiplatelet', null],
  ['Clopirel 75', 'Clopidogrel', 75, 'Tablet', 10, 'H', 'cardio-diabetic', 12, 82, 65.6, 59, 90, false, 'antiplatelet', { type: 'cd', cdPct: 2 }],
  ['Omepra 20', 'Omeprazole', 20, 'Capsule', 15, 'H', 'analgesic', 12, 64, 51.2, 46, 70, false, 'ppi', { type: 'free', buy: 10, free: 1 }],
  ['Glarzin 100IU Pen', 'Insulin Glargine', 300, 'Injection (3 ml pen)', 1, 'H', 'cold-chain', 5, 690, 552, 497, 720, true, 'insulin', null],
  ['Calmazol 0.5', 'Alprazolam', 0.5, 'Tablet', 15, 'H1', 'cns', 12, 32, 25.6, 23, null, false, 'benzodiazepine', null],
  ['Methylin 10', 'Methylphenidate', 10, 'Tablet', 10, 'X', 'cns', 12, 140, 112, 100.8, null, false, 'stimulant', null],
];

function buildProducts() {
  return PRODUCT_ROWS.map((r, i) => {
    const [brand, salt, strengthMg, form, packSize, schedule, category, gstPct, mrp, ptr, pts, ceiling, coldChain, drugClass, scheme] = r;
    return {
      id: `P${String(i + 1).padStart(3, '0')}`,
      brand, salt, strengthMg, form, packSize, schedule, category, gstPct, mrp, ptr, pts,
      ceilingPrice: ceiling, coldChain, drugClass, scheme,
      gtin: gs1.makeGtin13(COMPANY_PREFIX + String(10001 + i).slice(-5)),
      hsn: coldChain ? '30043110' : '30049099',
      manufacturerId: 'E002',
    };
  });
}

function entity(id, name, type, state, pan, city, licenseNo, extra = {}) {
  const g = gstin.build(state, pan);
  return {
    id, name, type, gstin: g, gstValid: true, licenseNo, city,
    stateCode: state, state: gstin.STATES[state],
    verification: 'verified', source: extra.source || 'Onboarded participant',
    participant: !!extra.participant, createdAt: iso(-200),
    ...extra,
  };
}

function buildEntities() {
  const list = [
    entity('E001', 'Deccan Synthesis Pvt Ltd', 'API_MANUFACTURER', '36', 'AADCD4521K', 'Hyderabad', 'Form 25 & 28: TS/HYD/25/2019/1123', { participant: true, source: 'CDSCO + USFDA DMF registry' }),
    entity('E002', 'Ganga Formulations Ltd', 'FORMULATOR', '02', 'AABCG7710M', 'Baddi', 'Form 25 & 28: HP/SOL/2017/0456', { participant: true, source: 'CDSCO manufacturing license registry' }),
    entity('E003', 'Western C&F Logistics', 'CNF_AGENT', '27', 'AAFFW3301Q', 'Bhiwandi', 'Form 20B & 21B: MH-TZ5-20B-55310', { source: 'GST public registry' }),
    entity('E004', 'Shree Balaji Pharma Distributors', 'STOCKIST', '27', 'AAPFS6610D', 'Pune', 'Form 20B & 21B: MH-PZ1-20B-71245', { participant: true, source: 'AIOCD directory' }),
    entity('E005', 'Lifeline Medical Agencies', 'STOCKIST', '29', 'AAKFL2208C', 'Bengaluru', 'Form 20B & 21B: KA-B20-21B-30881', { participant: true, source: 'AIOCD directory' }),
    entity('E006', 'CarePlus Chemists', 'PHARMACY', '27', 'ACPPC9087R', 'Pune', 'Form 20 & 21: MH-PZ2-20-204417', { participant: true, source: 'State Pharmacy Council' }),
    entity('E007', 'Arogya Hospital Pharmacy', 'HOSPITAL_PHARMACY', '29', 'AABTA4402H', 'Bengaluru', 'Form 20 & 21: KA-B21-20-118702', { participant: true, source: 'State FDA register' }),
  ];
  // Data-lake only records (harvested, not yet trading on the network)
  const extra = [
    ['Konkan Fine Chemicals Ltd', 'API_MANUFACTURER', '27', 'AACCK1192P', 'Tarapur', 'Form 25: MH-TZ3-25-1180'],
    ['Vizag Bulk Actives Pvt Ltd', 'API_MANUFACTURER', '37', 'AAECV5534L', 'Visakhapatnam', 'Form 25: AP/VSP/25/2020/0771'],
    ['Narmada Lifesciences Ltd', 'FORMULATOR', '24', 'AABCN8812F', 'Ahmedabad', 'Form 25 & 28: G/25/1882'],
    ['Sikkim Health Formulations', 'FORMULATOR', '02', 'AAGCS7281B', 'Baddi', 'Form 25 & 28: HP/SOL/2015/0212'],
    ['Eastern C&F Services', 'CNF_AGENT', '19', 'AAFFE6620J', 'Kolkata', 'Form 20B & 21B: WB/KOL/20B/4471'],
    ['Om Sai Medical Agencies', 'STOCKIST', '27', 'AAQFO2210K', 'Nashik', 'Form 20B & 21B: MH-NS1-20B-40193'],
    ['Delhi Drug House', 'STOCKIST', '07', 'AABFD3399E', 'New Delhi', 'Form 20B & 21B: DL-ND-20B-77120'],
    ['Chennai Pharma Distributors', 'STOCKIST', '33', 'AAJFC1145N', 'Chennai', 'Form 20B & 21B: TN-CH-20B-11873'],
    ['Jeevan Medicals', 'PHARMACY', '27', 'BJPPJ4410A', 'Mumbai', 'Form 20 & 21: MH-MZ4-20-889120'],
    ['Sanjivani Chemists', 'PHARMACY', '09', 'CSNPS7721L', 'Lucknow', 'Form 20 & 21: UP-LKO-20-55102'],
    ['Navjeevan Pharmacy', 'PHARMACY', '24', 'ANVPN3390G', 'Surat', 'Form 20 & 21: GJ-SUR-20-33017'],
    ['Amrit Medical Stores', 'PHARMACY', '03', 'BAMPA6612Q', 'Ludhiana', 'Form 20 & 21: PB-LDH-20-20991'],
    ['City Care Hospital Pharmacy', 'HOSPITAL_PHARMACY', '33', 'AAATC2287M', 'Chennai', 'Form 20 & 21: TN-CH-20-71820'],
  ];
  extra.forEach((r, i) => list.push(entity(`E${String(10 + i).padStart(3, '0')}`, r[0], r[1], r[2], r[3], r[4], r[5], { source: ['CDSCO', 'GST public registry', 'AIOCD directory', 'State Pharmacy Council', 'State FDA register'][i % 5] })));
  // a record whose GSTIN fails checksum (harvested with a typo)
  list.push({ ...entity('E030', 'Shiv Shakti Medicos', 'PHARMACY', '08', 'BSHPS1123P', 'Jaipur', 'Form 20 & 21: RJ-JPR-20-10022', { source: 'Scraped web listing' }), gstin: '08BSHPS1123P1Z0', gstValid: false, verification: 'unverified', verificationNote: 'GSTIN checksum mismatch' });
  // a near-duplicate of a participant (dedupe demo)
  list.push({ ...entity('E031', 'Shri Balaji Pharma Distributor', 'STOCKIST', '27', 'AAPFS6610D', 'Pune', 'Form 20B & 21B: MH-PZ1-20B-71245', { source: 'Scraped web listing' }), verification: 'duplicate_suspect', duplicateOf: 'E004', verificationNote: 'Same PAN & license as E004' });
  return list;
}

function seed() {
  const now = Date.now();
  const products = buildProducts();
  const entities = buildEntities();
  const db = {
    meta: { version: 1, seededAt: new Date(now).toISOString(), companyPrefix: COMPANY_PREFIX },
    counters: {},
    categories: CATEGORIES,
    entities, products,
    apiBatches: [], fgBatches: [], inventory: [], shipments: [],
    invoices: [], claims: [], sales: [], registers: [], creditNotes: [],
    events: [], audit: [], alerts: [], demand: {},
  };
  const next = (p) => { db.counters[p] = (db.counters[p] || 0) + 1; return `${p}-${String(db.counters[p]).padStart(4, '0')}`; };
  const inv = (entityId, kind, ref, batchNo, qty, uom, expiry, cost) =>
    db.inventory.push({ id: next('INV'), entityId, kind, ref, batchNo, qty, uom, expiry, cost, quarantined: false });

  audit.append(db.audit, { user: 'system', action: 'SYSTEM_INIT', ref: null, data: { note: 'Demo network seeded' } });

  // ---- Stage 1: API batches ----
  const apiDefs = [
    ['Paracetamol', 500, 'released', [{ e: 'E001', q: 100 }, { e: 'E002', q: 320 }]],
    ['Atorvastatin', 50, 'released', [{ e: 'E002', q: 40 }]],
    ['Metformin', 400, 'released', [{ e: 'E001', q: 400 }]],
    ['Amoxicillin', 200, 'qc_pending', []],
    ['Clarithromycin', 80, 'in_process', []],
  ];
  const goodQc = { assay: 99.4, lod: 0.21, totalImpurities: 0.32, kfWater: 0.18, analyst: 'R. Iyer (QC)' };
  apiDefs.forEach(([salt, kg, status, stock], i) => {
    const batchNo = `APB${String(2611001 + i)}`;
    const signatures = [];
    if (status !== 'in_process') {
      signatures.push({ role: 'MAKER', user: 'A. Kulkarni', meaning: 'Executed', ts: iso(-12 + i, now), hash: audit.sha256(batchNo + 'MAKER') });
      signatures.push({ role: 'CHECKER', user: 'S. Reddy', meaning: 'Verified', ts: iso(-11 + i, now), hash: audit.sha256(batchNo + 'CHECKER') });
    }
    if (status === 'released') signatures.push({ role: 'QA', user: 'Dr. M. Rao (QA Head)', meaning: 'Approved for release', ts: iso(-10 + i, now), hash: audit.sha256(batchNo + 'QA') });
    const qc = status === 'in_process' ? null : goodQc;
    const b = {
      id: next('APB'), batchNo, salt, entityId: 'E001', quantityKg: kg,
      dispensing: (() => { const x = dispensingQty({ theoreticalKg: kg * 0.62, assayPct: 98.6, lodPct: 0.4 }); return { ...x, capturedKg: x.actualKg, scale: 'WS-01 (simulated RS-232 capture)', withinTolerance: true }; })(),
      status, qc, qcEval: qc ? evaluateQc(qc) : null,
      agentReport: status === 'released' ? { verdict: 'PASS', summary: 'All CQAs within specification. Release recommended.', ts: iso(-10 + i, now) } : null,
      signatures, retestDate: iso(720 - i * 10, now), createdAt: iso(-14 + i, now),
      drumLabels: status === 'released' ? Array.from({ length: 3 }, (_, k) => gs1.makeSscc(COMPANY_PREFIX, 100000 + i * 10 + k)) : [],
    };
    db.apiBatches.push(b);
    for (const s of stock) inv(s.e, 'api', salt, batchNo, s.q, 'kg', b.retestDate, 1200);
  });

  // ---- Stage 2: finished-goods batches + downstream stock ----
  products.forEach((p, i) => {
    const expA = 25 + ((i * 23) % 170);
    const expB = 420 + i * 15;
    for (const [suffix, expDays] of [['A', expA], ['B', expB]]) {
      const batchNo = `${p.brand.replace(/[^A-Z]/gi, '').slice(0, 3).toUpperCase()}${suffix}${2600 + i}`;
      const expiry = iso(expDays, now);
      db.fgBatches.push({
        id: next('FGB'), batchNo, productId: p.id, apiBatchNo: i % 3 === 0 ? 'APB2611001' : null,
        packs: 6000, mfgDate: new Date(new Date(expiry).getTime() - 730 * day).toISOString(), expDate: expiry,
        status: 'serialized', serialized: true, serialStart: 100001, entityId: 'E002', createdAt: iso(-60, now),
      });
      if (suffix === 'B') inv('E002', 'fg', p.id, batchNo, 4000, 'pack', expiry, p.pts * 0.8);
      inv('E004', 'fg', p.id, batchNo, suffix === 'A' ? 120 : 300, 'pack', expiry, p.pts);
      if (suffix === 'B') inv('E005', 'fg', p.id, batchNo, 250, 'pack', expiry, p.pts);
      const low = [2, 5, 9].includes(i); // a few SKUs running low at the pharmacy
      inv('E006', 'fg', p.id, batchNo, low ? 2 : suffix === 'A' ? 10 : 30, 'pack', expiry, p.ptr);
      if (suffix === 'B') inv('E007', 'fg', p.id, batchNo, 25, 'pack', expiry, p.ptr);
    }
    db.demand[p.id] = { E004: 8 + ((i * 7) % 15), E005: 3 + ((i * 11) % 22) };
  });

  // ---- In-flight shipments to animate the Control Tower ----
  const fg = (pid, suffix) => db.fgBatches.find((b) => b.productId === pid && b.batchNo.includes(suffix));
  const mk = (from, to, kind, item, progress, status, extra = {}) => {
    const id = next('SHP');
    const p = products.find((x) => x.id === item.productId) || products.find((x) => x.salt === item.ref);
    db.shipments.push({
      id, asnNo: `ASN-${id.slice(4)}`, kind, fromId: from, toId: to,
      items: [item], ssccs: Array.from({ length: Math.max(1, Math.ceil(item.qty / (kind === 'api' ? 50 : 50))) }, (_, k) => gs1.makeSscc(COMPANY_PREFIX, 300000 + db.shipments.length * 100 + k)).slice(0, 12),
      status, progress, durationMs: 45000, category: p ? p.category : 'analgesic', coldChain: !!(p && p.coldChain),
      temps: [], mkt: null, signal: 'green', createdAt: new Date(now - progress * 45000).toISOString(),
      arrivedAt: status === 'arrived' ? new Date(now - 120000).toISOString() : null, ...extra,
    });
  };
  mk('E001', 'E002', 'api', { kind: 'api', ref: 'Metformin', batchNo: 'APB2611003', qty: 150, uom: 'kg', expiry: db.apiBatches[2].retestDate }, 0.3, 'in_transit');
  const g = fg('P013', 'B');
  mk('E002', 'E004', 'fg', { kind: 'fg', ref: 'P013', productId: 'P013', batchNo: g.batchNo, qty: 200, uom: 'pack', expiry: g.expDate }, 0.55, 'in_transit', { temps: [4.8, 5.1, 5.6, 5.2, 4.9, 5.4], ewayBill: '391044582213' });
  const a = fg('P006', 'B');
  mk('E002', 'E005', 'fg', { kind: 'fg', ref: 'P006', productId: 'P006', batchNo: a.batchNo, qty: 300, uom: 'pack', expiry: a.expDate }, 0.1, 'in_transit', { ewayBill: '391044582377' });
  const f = fg('P001', 'B');
  mk('E004', 'E006', 'fg', { kind: 'fg', ref: 'P001', productId: 'P001', batchNo: f.batchNo, qty: 50, uom: 'pack', expiry: f.expDate }, 1, 'arrived');
  const c = fg('P004', 'B');
  mk('E005', 'E007', 'fg', { kind: 'fg', ref: 'P004', productId: 'P004', batchNo: c.batchNo, qty: 40, uom: 'pack', expiry: c.expDate }, 0.45, 'in_transit');

  return db;
}

module.exports = { seed, COMPANY_PREFIX, CATEGORIES };
