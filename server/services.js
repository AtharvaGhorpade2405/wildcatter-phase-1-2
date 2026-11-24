// Business services for all 6 modules. Routes and the demo scenario call these.
const crypto = require('crypto');
const gs1 = require('./domain/gs1');
const gstin = require('./domain/gstin');
const auditLog = require('./domain/audit');
const epcis = require('./domain/epcis');
const pharma = require('./domain/pharma');
const coldchain = require('./domain/coldchain');
const schemes = require('./domain/schemes');
const fefo = require('./domain/fefo');
const clinical = require('./domain/clinical');
const { seed, COMPANY_PREFIX } = require('./seed');

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
const fail = (status, msg, extra) => { throw new HttpError(status, msg, extra); };

const STAGE_OF_TYPE = { API_MANUFACTURER: 0, FORMULATOR: 1, CNF_AGENT: 1, STOCKIST: 2, PHARMACY: 3, HOSPITAL_PHARMACY: 3 };
const STAGE_LABELS = ['Stage 1 · API Plant', 'Stage 2 · Formulation & C&F', 'Stage 3 · Stockist', 'Stage 4 · Pharmacy'];
const DEFAULT_TRANSIT_MS = 45000;
const r2 = schemes.r2;
const hrms = (start) => Math.round(Number(process.hrtime.bigint() - start) / 1e4) / 100;

function createServices(store) {
  const db = () => store.db;
  const nowIso = () => new Date().toISOString();

  // ------------------------------------------------------------------ helpers
  const changed = (what, ref) => {
    store.save();
    store.emit({ type: 'change', what, ref: ref || null, ts: nowIso() });
  };
  const getProduct = (id) => db().products.find((p) => p.id === id) || fail(404, `Product ${id} not found`);
  const productByGtin = (g) => db().products.find((p) => p.gtin === g);
  const getEntity = (id) => db().entities.find((e) => e.id === id) || fail(404, `Entity ${id} not found`);
  const stageOf = (entityId) => STAGE_OF_TYPE[getEntity(entityId).type];
  const findBatch = (batchNo) =>
    db().apiBatches.find((b) => b.batchNo === batchNo) || db().fgBatches.find((b) => b.batchNo === batchNo) || null;
  const isQuarantined = (batchNo) => {
    const b = findBatch(batchNo);
    return !!(b && b.status === 'quarantined');
  };

  function record(user, action, ref, data) {
    return auditLog.append(db().audit, { user, action, ref, data });
  }

  function emitEvent(e, summary) {
    const ev = epcis.makeEvent(e);
    ev['pcx:batchNo'] = e.batchNo || null;
    ev['pcx:entityId'] = e.entityId || null;
    ev['pcx:summary'] = summary || '';
    db().events.push(ev);
    if (db().events.length > 3000) db().events.splice(0, db().events.length - 3000);
    store.emit({ type: 'epcis', event: { eventID: ev.eventID, bizStep: ev.bizStep, summary } });
    return ev;
  }

  function raiseAlert(level, title, detail, ref) {
    const a = { id: store.nextId('ALR'), level, title, detail, ref: ref || null, ts: nowIso() };
    db().alerts.unshift(a);
    if (db().alerts.length > 200) db().alerts.length = 200;
    store.emit({ type: 'alert', alert: a });
    return a;
  }

  const rowsFor = (entityId, kind, ref) =>
    db().inventory.filter((r) => r.entityId === entityId && r.kind === kind && (ref === undefined || r.ref === ref));

  function addInventory(entityId, kind, ref, batchNo, qty, uom, expiry, cost) {
    const existing = db().inventory.find((r) => r.entityId === entityId && r.kind === kind && r.ref === ref && r.batchNo === batchNo);
    if (existing) {
      existing.qty = r2(existing.qty + qty);
      return existing;
    }
    const row = { id: store.nextId('INV'), entityId, kind, ref, batchNo, qty, uom, expiry, cost, quarantined: isQuarantined(batchNo) };
    db().inventory.push(row);
    return row;
  }

  function deduct(picks) {
    for (const p of picks) p.row.qty = Math.round((p.row.qty - p.qty) * 1000) / 1000;
    db().inventory = db().inventory.filter((r) => r.qty > 0.0001);
  }

  const lgtin = (item) => {
    if (item.kind === 'fg') return epcis.lgtinUri(getProduct(item.productId).gtin, item.batchNo);
    return `urn:epc:class:lgtin:${COMPANY_PREFIX}.0${item.ref.slice(0, 4).toUpperCase()}.${item.batchNo}`;
  };

  const ewayBillNo = () => '39' + String(crypto.randomInt(1e9, 9.99e9)).slice(0, 10);

  // ------------------------------------------------------------------ shipments (shared mesh)
  function createShipment({ fromId, toId, kind, items, user, invoiceId, durationMs, autoReceive }) {
    getEntity(fromId); getEntity(toId);
    const first = items[0];
    const p = kind === 'fg' ? getProduct(first.productId) : db().products.find((x) => x.salt === first.ref);
    const totalQty = items.reduce((s, i) => s + i.qty, 0);
    const value = items.reduce((s, i) => s + i.qty * (i.cost || 0), 0);
    const perCase = kind === 'api' ? 25 : 50;
    const caseCount = Math.min(24, Math.max(1, Math.ceil(totalQty / perCase)));
    const ssccs = Array.from({ length: caseCount }, () => gs1.makeSscc(COMPANY_PREFIX, crypto.randomInt(1, 999999999)));
    const id = store.nextId('SHP');
    const s = {
      id, asnNo: `ASN-${id.slice(4)}`, kind, fromId, toId,
      items: items.map(({ row, ...rest }) => rest),
      ssccs, status: 'in_transit', progress: 0, durationMs: durationMs || DEFAULT_TRANSIT_MS,
      category: p ? p.category : 'analgesic', coldChain: !!(p && p.coldChain),
      temps: [], mkt: null, signal: 'green', createdAt: nowIso(), arrivedAt: null, receivedAt: null,
      ewayBill: value > 50000 ? ewayBillNo() : null, invoiceId: invoiceId || null, autoReceive: !!autoReceive,
      value: r2(value),
    };
    db().shipments.push(s);
    for (const it of s.items) {
      emitEvent({ type: 'AggregationEvent', action: 'ADD', bizStep: 'packing', disposition: 'in_progress', parentID: epcis.ssccUri(ssccs[0]), childQuantityList: undefined, quantityList: [{ epcClass: lgtin(it), quantity: it.qty, uom: it.uom === 'kg' ? 'KGM' : 'EA' }], entityId: fromId, batchNo: it.batchNo }, `Packed ${it.qty} ${it.uom} of ${it.batchNo} into ${ssccs.length} SSCC(s)`);
      emitEvent({
        type: 'ObjectEvent', action: 'OBSERVE', bizStep: 'shipping', disposition: 'in_transit',
        epcList: ssccs.map(epcis.ssccUri), quantityList: [{ epcClass: lgtin(it), quantity: it.qty, uom: it.uom === 'kg' ? 'KGM' : 'EA' }],
        bizTransactionList: [{ type: 'desadv', bizTransaction: `urn:pcx:asn:${s.asnNo}` }].concat(invoiceId ? [{ type: 'inv', bizTransaction: `urn:pcx:inv:${invoiceId}` }] : []),
        sourceList: [{ type: 'owning_party', source: epcis.sglnUri(fromId) }], destinationList: [{ type: 'owning_party', destination: epcis.sglnUri(toId) }],
        entityId: fromId, batchNo: it.batchNo,
      }, `Shipped ${it.qty} ${it.uom} ${it.batchNo} → ${getEntity(toId).name} (${s.asnNo})`);
    }
    record(user || 'system', 'SHIPMENT_CREATED', s.id, { asnNo: s.asnNo, fromId, toId, items: s.items, ssccs: ssccs.length });
    changed('shipment', s.id);
    return s;
  }

  function getShipment(id) {
    return db().shipments.find((s) => s.id === id || s.asnNo === id) || fail(404, `Shipment ${id} not found`);
  }

  function listShipments({ entityId, direction, status } = {}) {
    return db().shipments
      .filter((s) => !entityId || (direction === 'in' ? s.toId === entityId : direction === 'out' ? s.fromId === entityId : s.toId === entityId || s.fromId === entityId))
      .filter((s) => !status || s.status === status)
      .slice().reverse()
      .map(decorateShipment);
  }

  function decorateShipment(s) {
    const from = db().entities.find((e) => e.id === s.fromId);
    const to = db().entities.find((e) => e.id === s.toId);
    return {
      ...s,
      fromName: from ? from.name : s.fromId,
      toName: to ? to.name : s.toId,
      itemsLabel: s.items.map((i) => `${i.kind === 'fg' ? getProduct(i.productId).brand : i.ref + ' API'} · ${i.batchNo} · ${i.qty} ${i.uom}`).join('; '),
    };
  }

  function signalFor(s) {
    if (s.status === 'quarantined' || s.items.some((i) => isQuarantined(i.batchNo))) return 'red';
    if (s.coldChain && s.temps.length) {
      const ev = coldchain.evaluate(s.temps);
      if (ev.signal === 'red') return 'red';
      if (ev.signal === 'amber') return 'amber';
    }
    if (s.items.some((i) => fefo.daysToExpiry(i.expiry) < 90)) return 'amber';
    if (s.status === 'arrived' && s.arrivedAt && Date.now() - new Date(s.arrivedAt).getTime() > 60000) return 'amber';
    return 'green';
  }

  function applyTelemetry(s, tempC, source) {
    s.temps.push(r2(tempC));
    if (s.temps.length > 120) s.temps.shift();
    const ev = coldchain.evaluate(s.temps);
    s.mkt = ev.mkt;
    if (ev.signal === 'amber' && !s.amberRaised) {
      s.amberRaised = true;
      raiseAlert('amber', `Transient temperature excursion on ${s.asnNo}`, `Reading ${tempC} °C outside 2-8 °C; MKT ${ev.mkt} °C still within range.`, s.id);
    }
    if (ev.quarantine && s.status !== 'quarantined') {
      emitEvent({ type: 'ObjectEvent', action: 'OBSERVE', bizStep: 'sensor_reporting', disposition: 'damaged', epcList: s.ssccs.map(epcis.ssccUri), entityId: s.fromId, batchNo: s.items[0].batchNo,
        sensorElementList: [{ sensorMetadata: { time: nowIso() }, sensorReport: [{ type: 'Temperature', value: tempC, uom: 'CEL' }, { type: 'Temperature', value: ev.mkt, uom: 'CEL', component: 'mkt' }] }] },
      `MKT ${ev.mkt} °C breached 2-8 °C on ${s.asnNo}`);
      for (const it of s.items) quarantineBatch(it.batchNo, `Cold-chain MKT excursion (${ev.mkt} °C) on ${s.asnNo}`, 'Cold-Chain Stability Excursion Agent', { silent: true });
    }
    s.signal = signalFor(s);
    return ev;
  }

  /** Simulation clock: advances trains and synthesises IoT telemetry. */
  function tick(dtMs) {
    let moved = false;
    for (const s of db().shipments) {
      if (s.status === 'in_transit') {
        s.progress = Math.min(1, s.progress + dtMs / (s.durationMs || DEFAULT_TRANSIT_MS));
        if (s.coldChain) {
          const base = s.excursion ? 13.5 : 5;
          applyTelemetry(s, base + Math.sin(Date.now() / 7000 + s.progress * 9) * 1.1 + (Math.random() - 0.5) * 0.6);
        }
        if (s.progress >= 1 && s.status === 'in_transit') {
          s.status = 'arrived';
          s.arrivedAt = nowIso();
          emitEvent({ type: 'ObjectEvent', action: 'OBSERVE', bizStep: 'arriving', disposition: 'in_transit', epcList: s.ssccs.map(epcis.ssccUri), entityId: s.toId, batchNo: s.items[0].batchNo }, `${s.asnNo} arrived at ${getEntity(s.toId).name}`);
          if (s.autoReceive) {
            try { receiveShipment(s.id, { scanned: s.ssccs, user: 'demo-autoscan' }); } catch (e) { raiseAlert('amber', `Auto-inward failed for ${s.asnNo}`, e.message, s.id); }
          }
        }
        moved = true;
      }
      if (['in_transit', 'arrived', 'quarantined'].includes(s.status)) s.signal = signalFor(s);
    }
    if (moved) store.save();
    store.emit({ type: 'tick', ts: nowIso() });
  }

  function receiveShipment(id, { scanned = [], user } = {}) {
    const s = getShipment(id);
    if (s.status === 'received') fail(409, `${s.asnNo} already received`);
    if (s.status === 'quarantined') fail(409, `${s.asnNo} is under quarantine/recall - cannot be inwarded`);
    if (s.status !== 'arrived') fail(409, `${s.asnNo} has not arrived yet (progress ${Math.round(s.progress * 100)}%)`);
    const scannedSet = new Set(scanned.map((x) => String(x).trim()).filter(Boolean));
    const missing = s.ssccs.filter((x) => !scannedSet.has(x));
    const unknown = [...scannedSet].filter((x) => !s.ssccs.includes(x));
    if (unknown.length) fail(422, `Unknown SSCC scanned - possible counterfeit or mis-shipment`, { unknown });
    if (missing.length) fail(422, `${missing.length} SSCC(s) not yet scanned`, { missing });
    const vrs = s.items.map((it) => ({ batchNo: it.batchNo, verified: !isQuarantined(it.batchNo) && !!findBatch(it.batchNo) }));
    if (vrs.some((v) => !v.verified)) fail(422, 'VRS verification failed for one or more batches', { vrs });
    const stage = stageOf(s.toId);
    for (const it of s.items) {
      let cost = it.cost || 0;
      if (it.kind === 'fg') { const p = getProduct(it.productId); cost = stage === 2 ? p.pts : stage === 3 ? p.ptr : cost; }
      addInventory(s.toId, it.kind, it.ref, it.batchNo, it.qty, it.uom, it.expiry, cost);
      emitEvent({ type: 'ObjectEvent', action: 'OBSERVE', bizStep: 'receiving', disposition: 'in_progress', epcList: s.ssccs.map(epcis.ssccUri), quantityList: [{ epcClass: lgtin(it), quantity: it.qty, uom: it.uom === 'kg' ? 'KGM' : 'EA' }], entityId: s.toId, batchNo: it.batchNo }, `Scan-verified & inwarded ${it.qty} ${it.uom} ${it.batchNo} at ${getEntity(s.toId).name}`);
    }
    s.status = 'received';
    s.receivedAt = nowIso();
    s.signal = 'green';
    if (s.invoiceId) {
      const inv = db().invoices.find((i) => i.id === s.invoiceId);
      if (inv) { inv.status = 'delivered'; inv.podAt = s.receivedAt; }
    }
    record(user || 'system', 'SHIPMENT_RECEIVED', s.id, { asnNo: s.asnNo, scanned: s.ssccs.length, vrs });
    changed('shipment', s.id);
    return { shipment: decorateShipment(s), vrs };
  }

  // ------------------------------------------------------------------ quarantine / recall brake
  function quarantineBatch(batchNo, reason, user, opts = {}) {
    const root = findBatch(batchNo) || fail(404, `Batch ${batchNo} not found`);
    const affected = [root];
    if (db().apiBatches.includes(root)) affected.push(...db().fgBatches.filter((b) => b.apiBatchNo === batchNo)); // genealogy cascade
    const batchNos = affected.map((b) => b.batchNo);
    let rows = 0, units = 0, ships = 0;
    for (const b of affected) {
      if (b.status !== 'quarantined') b.prevStatus = b.status;
      b.status = 'quarantined';
      b.quarantineReason = reason;
    }
    for (const r of db().inventory) if (batchNos.includes(r.batchNo)) { r.quarantined = true; rows++; units += r.qty; }
    for (const s of db().shipments) {
      if (['in_transit', 'arrived'].includes(s.status) && s.items.some((i) => batchNos.includes(i.batchNo))) {
        s.prevStatus = s.status; s.status = 'quarantined'; s.signal = 'red'; ships++;
      }
    }
    for (const bn of batchNos) {
      emitEvent({ type: 'ObjectEvent', action: 'OBSERVE', bizStep: 'holding', disposition: 'recalled', entityId: affected.find((b) => b.batchNo === bn).entityId, batchNo: bn,
        quantityList: [{ epcClass: `urn:epc:class:lgtin:${COMPANY_PREFIX}.batch.${bn}`, quantity: 0 }] }, `QUARANTINE/RECALL ${bn}: ${reason}`);
    }
    record(user || 'system', 'QUARANTINE', batchNo, { reason, cascade: batchNos, inventoryRows: rows, shipments: ships });
    raiseAlert('red', `Quarantine: ${batchNos.join(', ')}`, `${reason} · ${rows} stock locations, ${ships} shipment(s) halted, ${r2(units)} units frozen`, batchNo);
    if (!opts.silent) changed('quarantine', batchNo);
    else store.save();
    return { batchNo, reason, cascade: batchNos, inventoryRowsFrozen: rows, unitsFrozen: r2(units), shipmentsHalted: ships };
  }

  function liftQuarantine(batchNo, { user, reason } = {}) {
    const root = findBatch(batchNo) || fail(404, `Batch ${batchNo} not found`);
    const affected = [root];
    if (db().apiBatches.includes(root)) affected.push(...db().fgBatches.filter((b) => b.apiBatchNo === batchNo && b.status === 'quarantined'));
    const batchNos = affected.map((b) => b.batchNo);
    for (const b of affected) { b.status = b.prevStatus && b.prevStatus !== 'quarantined' ? b.prevStatus : (b.serialized ? 'serialized' : 'released'); delete b.quarantineReason; }
    for (const r of db().inventory) if (batchNos.includes(r.batchNo)) r.quarantined = false;
    for (const s of db().shipments) {
      if (s.status === 'quarantined' && s.items.some((i) => batchNos.includes(i.batchNo))) {
        s.status = s.progress >= 1 ? 'arrived' : 'in_transit'; s.excursion = false; s.temps = []; s.mkt = null; s.amberRaised = false;
        if (s.status === 'arrived') s.arrivedAt = nowIso();
      }
    }
    record(user || 'QA', 'QUARANTINE_LIFTED', batchNo, { reason: reason || 'QA disposition: released', batches: batchNos });
    raiseAlert('green', `Quarantine lifted: ${batchNos.join(', ')}`, reason || 'QA disposition: released', batchNo);
    changed('quarantine', batchNo);
    return { batchNo, released: batchNos };
  }

  // ------------------------------------------------------------------ STAGE 1 · API plant
  const apiSalts = () => [...new Set(db().products.map((p) => p.salt))];

  function createApiBatch({ salt, batchSizeKg, ksmTheoreticalKg, ksmAssayPct, ksmLodPct, user = 'Production' }) {
    if (!apiSalts().includes(salt)) fail(400, `Unknown API '${salt}'. Known: ${apiSalts().join(', ')}`);
    if (!(Number(batchSizeKg) > 0)) fail(400, 'batchSizeKg must be > 0');
    let dispensing;
    try { dispensing = pharma.dispensingQty({ theoreticalKg: ksmTheoreticalKg, assayPct: ksmAssayPct, lodPct: ksmLodPct }); } catch (e) { fail(400, e.message); }
    dispensing.capturedKg = r2(dispensing.actualKg * (1 + (Math.random() - 0.5) * 0.002));
    dispensing.scale = 'WS-01 (simulated RS-232 capture)';
    dispensing.withinTolerance = Math.abs(dispensing.capturedKg - dispensing.actualKg) / dispensing.actualKg <= 0.005;
    const id = store.nextId('APB');
    const b = {
      id, batchNo: `APB${new Date().toISOString().slice(2, 4)}${String(Date.now()).slice(-5)}`, salt, entityId: 'E001',
      quantityKg: Number(batchSizeKg), dispensing, status: 'in_process', qc: null, qcEval: null, agentReport: null,
      signatures: [], retestDate: new Date(Date.now() + 730 * 86400000).toISOString(), createdAt: nowIso(), drumLabels: [],
    };
    db().apiBatches.push(b);
    record(user, 'API_BATCH_CREATED', b.batchNo, { salt, batchSizeKg: b.quantityKg, dispensing });
    changed('apiBatch', b.id);
    return b;
  }

  const getApiBatch = (idOrNo) => db().apiBatches.find((b) => b.id === idOrNo || b.batchNo === idOrNo) || fail(404, `API batch ${idOrNo} not found`);

  function recordQc(id, results, user = 'QC Analyst') {
    const b = getApiBatch(id);
    if (!['in_process', 'qc_pending'].includes(b.status)) fail(409, `Cannot record QC on a ${b.status} batch`);
    const qc = { assay: Number(results.assay), lod: Number(results.lod), totalImpurities: Number(results.totalImpurities), kfWater: Number(results.kfWater), analyst: results.analyst || user, instrument: results.instrument || 'HPLC-02 / KF-01 (parsed)', ts: nowIso() };
    b.qc = qc;
    b.qcEval = pharma.evaluateQc(qc);
    b.status = 'qc_pending';
    b.agentReport = null;
    record(user, 'QC_RESULTS_RECORDED', b.batchNo, qc);
    changed('apiBatch', b.id);
    return b;
  }

  function signBatch(id, { role, user, meaning }) {
    const b = getApiBatch(id);
    role = String(role || '').toUpperCase();
    if (!['MAKER', 'CHECKER', 'QA'].includes(role)) fail(400, 'role must be MAKER, CHECKER or QA');
    if (!user || String(user).trim().length < 2) fail(400, 'Signer name is required (21 CFR Part 11 §11.50)');
    if (b.signatures.some((s) => s.role === role)) fail(409, `${role} signature already applied`);
    if (b.signatures.some((s) => s.user.toLowerCase() === String(user).toLowerCase())) fail(409, 'Segregation of duties: the same person cannot sign twice');
    if (role === 'CHECKER' && !b.signatures.some((s) => s.role === 'MAKER')) fail(409, 'MAKER must sign before CHECKER');
    if (role === 'QA') {
      if (!b.signatures.some((s) => s.role === 'CHECKER')) fail(409, 'CHECKER must sign before QA');
      if (!b.agentReport || b.agentReport.verdict !== 'PASS') fail(409, 'QA release requires a PASS verdict from the QA/QC Release Agent');
    }
    if (b.status === 'quarantined') fail(409, 'Batch is quarantined');
    const ts = nowIso();
    const sig = { role, user: String(user).trim(), meaning: meaning || { MAKER: 'Executed', CHECKER: 'Verified', QA: 'Approved for release' }[role], ts };
    sig.hash = auditLog.sha256(JSON.stringify({ batchNo: b.batchNo, qc: b.qc, dispensing: b.dispensing, prior: b.signatures.map((s) => s.hash), ...sig }));
    b.signatures.push(sig);
    record(sig.user, `EBMR_SIGNED_${role}`, b.batchNo, { meaning: sig.meaning, hash: sig.hash });
    if (role === 'QA') releaseApiBatch(b, sig);
    changed('apiBatch', b.id);
    return b;
  }

  function releaseApiBatch(b, sig) {
    b.status = 'released';
    b.releasedAt = nowIso();
    const drums = Math.min(20, Math.ceil(b.quantityKg / 25));
    b.drumLabels = Array.from({ length: drums }, () => gs1.makeSscc(COMPANY_PREFIX, crypto.randomInt(1, 999999999)));
    b.coa = buildCoa(b, sig);
    addInventory('E001', 'api', b.salt, b.batchNo, b.quantityKg, 'kg', b.retestDate, 1200);
    emitEvent({ type: 'ObjectEvent', action: 'ADD', bizStep: 'commissioning', disposition: 'active', epcList: b.drumLabels.map(epcis.ssccUri),
      quantityList: [{ epcClass: `urn:epc:class:lgtin:${COMPANY_PREFIX}.0${b.salt.slice(0, 4).toUpperCase()}.${b.batchNo}`, quantity: b.quantityKg, uom: 'KGM' }],
      ilmd: { lotNumber: b.batchNo, itemExpirationDate: b.retestDate.slice(0, 10) }, entityId: 'E001', batchNo: b.batchNo }, `Released API ${b.salt} ${b.batchNo} (${b.quantityKg} kg, ${drums} GS1-128 drums) with digital CoA`);
    raiseAlert('green', `API batch released: ${b.batchNo}`, `${b.salt} ${b.quantityKg} kg released by ${sig.user}`, b.batchNo);
  }

  function buildCoa(b, sig) {
    return {
      coaNo: `COA-${b.batchNo}`, product: `${b.salt} (API)`, batchNo: b.batchNo, quantityKg: b.quantityKg,
      manufacturer: getEntity('E001').name, license: getEntity('E001').licenseNo, mfgDate: b.createdAt.slice(0, 10), retestDate: b.retestDate.slice(0, 10),
      pharmacopoeia: 'IP / USP / BP / EP (harmonised demo spec)', tests: b.qcEval.tests, conclusion: 'Complies',
      releasedBy: sig.user, releasedAt: sig.ts, signatureHash: sig.hash,
    };
  }

  function runReleaseAgent(id) {
    const b = getApiBatch(id);
    if (!b.qc) fail(409, 'No QC results recorded yet');
    if (b.status === 'released') fail(409, 'Batch already released');
    const ev = pharma.evaluateQc(b.qc);
    const findings = [];
    for (const t of ev.tests) if (!t.pass) findings.push(`${t.label}: ${t.missing ? 'missing' : t.value + t.unit} vs spec ${t.min}-${t.max}${t.unit} → OOS`);
    const ebmrComplete = ['MAKER', 'CHECKER'].every((r) => b.signatures.some((s) => s.role === r));
    if (!ebmrComplete) findings.push('eBMR incomplete: MAKER and CHECKER signatures required before release review');
    if (b.dispensing && b.dispensing.withinTolerance === false) findings.push('Dispensing weight outside ±0.5% tolerance');
    let verdict = 'PASS';
    if (!ev.pass) verdict = 'FAIL';
    else if (findings.length) verdict = 'HOLD';
    const report = {
      agent: 'Autonomous QA/QC Release Agent v0.1 (deterministic rules; LLM narrative pluggable)', ts: nowIso(), verdict, findings,
      tests: ev.tests,
      summary: verdict === 'PASS' ? 'All critical quality attributes within specification and eBMR complete. Release recommended to QA Head.'
        : verdict === 'HOLD' ? 'Results within specification but release prerequisites missing.'
          : `Out-of-Specification detected (${findings.length} finding(s)). Batch auto-quarantined; OOS Phase I investigation opened.`,
      deviationDraft: verdict === 'FAIL' ? {
        deviationNo: `DEV-${b.batchNo}`, classification: 'OOS - Phase I', description: findings.join('; '),
        immediateAction: 'Batch quarantined. Retain samples secured. Analyst & instrument checks initiated.',
        proposedCapa: 'Phase I lab investigation (calculation, instrument, standard, sample prep). If no assignable cause → Phase II full-scale investigation with production.',
      } : null,
    };
    b.agentReport = report;
    record('QA/QC Release Agent', 'RELEASE_AGENT_RUN', b.batchNo, { verdict, findings });
    if (verdict === 'FAIL') quarantineBatch(b.batchNo, 'OOS detected by QA/QC Release Agent', 'QA/QC Release Agent', { silent: true });
    changed('apiBatch', b.id);
    return b;
  }

  function shipApi(id, { toId = 'E002', qtyKg, user = 'Dispatch' }) {
    const b = getApiBatch(id);
    if (b.status !== 'released') fail(409, `Only released batches can ship (status: ${b.status})`);
    const row = rowsFor('E001', 'api', b.salt).find((r) => r.batchNo === b.batchNo);
    const qty = Number(qtyKg);
    if (!(qty > 0)) fail(400, 'qtyKg must be > 0');
    if (!row || row.qty < qty) fail(409, `Insufficient stock at plant (${row ? row.qty : 0} kg available)`);
    if (stageOf(toId) !== 1) fail(400, 'API ships to a Stage 2 formulator');
    deduct([{ row, qty }]);
    return createShipment({ fromId: 'E001', toId, kind: 'api', items: [{ kind: 'api', ref: b.salt, batchNo: b.batchNo, qty, uom: 'kg', expiry: b.retestDate, cost: 1200 }], user });
  }

  // ------------------------------------------------------------------ STAGE 2 · Formulation, serialization, C&F
  const getFgBatch = (idOrNo) => db().fgBatches.find((b) => b.id === idOrNo || b.batchNo === idOrNo) || fail(404, `FG batch ${idOrNo} not found`);

  function createFgBatch({ productId, apiBatchNo, packs, entityId = 'E002', user = 'Production' }) {
    const p = getProduct(productId);
    packs = Math.floor(Number(packs));
    if (!(packs > 0)) fail(400, 'packs must be > 0');
    const needKg = r2(pharma.apiConsumptionKg(packs, p.packSize, p.strengthMg) * 1.02); // 2% manufacturing overage
    const apiRows = rowsFor(entityId, 'api', p.salt).filter((r) => !r.quarantined && (!apiBatchNo || r.batchNo === apiBatchNo));
    const alloc = fefo.allocate(apiRows, needKg);
    if (alloc.shortfall > 0) fail(409, `Insufficient released ${p.salt} API at ${getEntity(entityId).name}: need ${needKg} kg, short ${r2(alloc.shortfall)} kg. Ship API from Stage 1 first.`);
    deduct(alloc.picks);
    const id = store.nextId('FGB');
    const expiry = new Date(Date.now() + (p.coldChain ? 540 : 730) * 86400000).toISOString();
    const b = {
      id, batchNo: `${p.brand.replace(/[^A-Z]/gi, '').slice(0, 3).toUpperCase()}F${id.slice(4)}`, productId, apiBatchNo: alloc.picks[0].batchNo,
      apiConsumedKg: needKg, coaLinks: alloc.picks.map((x) => `COA-${x.batchNo}`), packs, mfgDate: nowIso(), expDate: expiry,
      status: 'packed', serialized: false, serialStart: null, entityId, createdAt: nowIso(),
    };
    db().fgBatches.push(b);
    addInventory(entityId, 'fg', productId, b.batchNo, packs, 'pack', expiry, r2(p.pts * 0.8));
    emitEvent({ type: 'TransformationEvent', bizStep: 'creating_class_instance', disposition: 'active', entityId, batchNo: b.batchNo,
      inputQuantityList: undefined, quantityList: [{ epcClass: epcis.lgtinUri(p.gtin, b.batchNo), quantity: packs, uom: 'EA' }], ilmd: { lotNumber: b.batchNo, itemExpirationDate: expiry.slice(0, 10), inputApiBatches: alloc.picks.map((x) => x.batchNo) } },
    `Formulated ${packs} packs ${p.brand} ${b.batchNo} from API ${alloc.picks.map((x) => x.batchNo).join(', ')} (${needKg} kg)`);
    record(user, 'FG_BATCH_CREATED', b.batchNo, { productId, packs, apiConsumedKg: needKg, apiBatches: alloc.picks.map((x) => x.batchNo) });
    changed('fgBatch', b.id);
    return b;
  }

  function h2Payload(p, b, serial) {
    const mfr = getEntity(p.manufacturerId);
    return {
      upc: gs1.sgtinElementString(p.gtin, serial, b.batchNo, b.expDate),
      genericName: `${p.salt} ${p.strengthMg} mg ${p.form}`, brandName: p.brand,
      manufacturer: `${mfr.name}, ${mfr.city}, ${mfr.state}`, batchNo: b.batchNo,
      mfgDate: b.mfgDate.slice(0, 7), expDate: b.expDate.slice(0, 7), licenseNo: mfr.licenseNo,
    };
  }

  function serializeFg(id, { user = 'Packaging Line L3' } = {}) {
    const b = getFgBatch(id);
    if (b.serialized) fail(409, 'Batch already serialized');
    if (b.status === 'quarantined') fail(409, 'Batch is quarantined');
    const p = getProduct(b.productId);
    const start = process.hrtime.bigint();
    b.serialStart = 100001;
    b.serialized = true;
    b.status = 'serialized';
    const cases = Math.ceil(b.packs / 50), pallets = Math.ceil(cases / 40);
    b.aggregation = { packs: b.packs, cases, pallets, packsPerCase: 50, casesPerPallet: 40 };
    const sample = Array.from({ length: 5 }, (_, k) => b.serialStart + k);
    emitEvent({ type: 'ObjectEvent', action: 'ADD', bizStep: 'commissioning', disposition: 'active', epcList: sample.map((s) => epcis.sgtinUri(p.gtin, s)),
      quantityList: [{ epcClass: epcis.lgtinUri(p.gtin, b.batchNo), quantity: b.packs, uom: 'EA' }], ilmd: { lotNumber: b.batchNo, itemExpirationDate: b.expDate.slice(0, 10) }, entityId: b.entityId, batchNo: b.batchNo },
    `Commissioned ${b.packs} SGTINs for ${p.brand} ${b.batchNo} (serial ${b.serialStart}-${b.serialStart + b.packs - 1})`);
    emitEvent({ type: 'AggregationEvent', action: 'ADD', bizStep: 'packing', disposition: 'in_progress', parentID: epcis.ssccUri(gs1.makeSscc(COMPANY_PREFIX, crypto.randomInt(1, 999999999))),
      childEPCs: sample.map((s) => epcis.sgtinUri(p.gtin, s)), entityId: b.entityId, batchNo: b.batchNo }, `Aggregated ${b.packs} packs → ${cases} cases → ${pallets} pallet(s)`);
    record(user, 'FG_SERIALIZED', b.batchNo, { range: [b.serialStart, b.serialStart + b.packs - 1], aggregation: b.aggregation });
    changed('fgBatch', b.id);
    return { ...b, computeMs: hrms(start), samples: sample.map((s) => ({ serial: s, gs1: gs1.sgtinElementString(p.gtin, s, b.batchNo, b.expDate), epc: epcis.sgtinUri(p.gtin, s), h2Qr: h2Payload(p, b, s) })) };
  }

  function fgBatchDetail(id) {
    const b = getFgBatch(id);
    const p = getProduct(b.productId);
    const samples = b.serialized ? Array.from({ length: 3 }, (_, k) => b.serialStart + k).map((s) => ({ serial: s, gs1: gs1.sgtinElementString(p.gtin, s, b.batchNo, b.expDate), epc: epcis.sgtinUri(p.gtin, s), h2Qr: h2Payload(p, b, s) })) : [];
    return { ...b, product: p, samples };
  }

  function shipFg({ fromId = 'E002', toId, productId, packs, batchNo, overrideFefo, user = 'C&F Dispatch' }) {
    const p = getProduct(productId);
    packs = Math.floor(Number(packs));
    if (!(packs > 0)) fail(400, 'packs must be > 0');
    if (stageOf(toId) !== 2) fail(400, 'Formulator/C&F ships to a Stage 3 stockist');
    const rows = rowsFor(fromId, 'fg', productId).filter((r) => { const b = findBatch(r.batchNo); return b && b.serialized; });
    if (batchNo && !overrideFefo) {
      const fefoFirst = fefo.allocate(rows, 1).picks[0];
      if (fefoFirst && fefoFirst.batchNo !== batchNo) fail(409, `FEFO gatekeeper: batch ${fefoFirst.batchNo} expires earlier than ${batchNo} and must ship first`, { fefoBatch: fefoFirst.batchNo });
    }
    const alloc = fefo.allocate(batchNo ? rows.filter((r) => r.batchNo === batchNo) : rows, packs);
    if (alloc.shortfall > 0) fail(409, `Insufficient serialized stock of ${p.brand}: short ${alloc.shortfall} packs (unserialized batches cannot ship - Schedule H2 / DSCSA)`);
    deduct(alloc.picks);
    return createShipment({ fromId, toId, kind: 'fg', user, items: alloc.picks.map((x) => ({ kind: 'fg', ref: productId, productId, batchNo: x.batchNo, qty: x.qty, uom: 'pack', expiry: x.expiry, cost: p.pts })) });
  }

  function priceCheck({ productId, mrp }) {
    const p = getProduct(productId);
    const price = Number(mrp ?? p.mrp);
    if (p.ceilingPrice == null) return { productId, brand: p.brand, mrp: price, ceilingPrice: null, underDpco: false, compliant: true, message: 'Not a scheduled formulation under DPCO 2013 (non-NLEM): 10% annual MRP increase cap applies.' };
    const compliant = price <= p.ceilingPrice;
    return { productId, brand: p.brand, mrp: price, ceilingPrice: p.ceilingPrice, underDpco: true, compliant, headroom: r2(p.ceilingPrice - price), message: compliant ? 'Within NPPA ceiling price' : `Exceeds NPPA ceiling by ₹${r2(price - p.ceilingPrice)} - billing blocked` };
  }

  function addTelemetry(id, { tempC }) {
    const s = getShipment(id);
    if (!s.coldChain) fail(400, 'Not a cold-chain shipment');
    const t = Number(tempC);
    if (Number.isNaN(t)) fail(400, 'tempC must be numeric');
    const ev = applyTelemetry(s, t, 'api');
    changed('shipment', s.id);
    return { shipment: decorateShipment(s), evaluation: ev };
  }

  function injectExcursion(id) {
    const s = getShipment(id);
    if (!s.coldChain) fail(400, 'Only cold-chain shipments carry temperature loggers');
    if (s.status !== 'in_transit') fail(409, 'Shipment must be in transit');
    s.excursion = true;
    record('demo', 'EXCURSION_INJECTED', s.id, {});
    changed('shipment', s.id);
    return decorateShipment(s);
  }

  function demandSensing() {
    const stockists = db().entities.filter((e) => e.participant && e.type === 'STOCKIST');
    const out = [];
    for (const p of db().products) {
      const nodes = stockists.map((s) => {
        const stock = rowsFor(s.id, 'fg', p.id).filter((r) => !r.quarantined).reduce((t, r) => t + r.qty, 0);
        const daily = (db().demand[p.id] || {})[s.id] || 1;
        return { entityId: s.id, name: s.name, stock, avgDailySales: daily, daysCover: Math.round(stock / daily) };
      });
      const risk = nodes.filter((n) => n.daysCover < 20);
      const excess = nodes.filter((n) => n.daysCover > 45).sort((a, b) => b.daysCover - a.daysCover);
      const suggestions = [];
      for (const r of risk) {
        const need = Math.max(0, Math.round(r.avgDailySales * 30 - r.stock));
        const src = excess.find((e) => e.entityId !== r.entityId);
        if (src && need > 0) suggestions.push({ from: src.entityId, fromName: src.name, to: r.entityId, toName: r.name, packs: Math.min(need, Math.floor(src.stock - src.avgDailySales * 30)) });
        else if (need > 0) suggestions.push({ from: 'E002', fromName: getEntity('E002').name, to: r.entityId, toName: r.name, packs: need });
      }
      out.push({ productId: p.id, brand: p.brand, nodes, risk: risk.length > 0, suggestions: suggestions.filter((s) => s.packs > 0) });
    }
    return { agent: 'AI Demand-Sensing & Reallocation Agent v0.1 (moving-average baseline)', generatedAt: nowIso(), products: out.sort((a, b) => b.risk - a.risk) };
  }

  // ------------------------------------------------------------------ STAGE 3 · Stockist
  /** Stockist-specific commercial offer. E004 runs manufacturer schemes; E005 sells at a flat 3% lower rate. */
  function stockistOffer(stockistId, p) {
    if (stockistId === 'E005') return { rate: r2(p.ptr * 0.97), scheme: null, label: 'Flat rate (PTR - 3%)' };
    return { rate: p.ptr, scheme: p.scheme, label: schemes.describe(p.scheme) };
  }

  function quoteInvoice({ sellerId, buyerId, lines }) {
    const start = process.hrtime.bigint();
    const seller = getEntity(sellerId), buyer = getEntity(buyerId);
    if (stageOf(sellerId) !== 2) fail(400, 'Seller must be a Stage 3 stockist');
    if (!Array.isArray(lines) || !lines.length) fail(400, 'At least one line is required');
    const interState = seller.stateCode !== buyer.stateCode;
    const priced = lines.map((l) => {
      const p = getProduct(l.productId);
      const qty = Math.floor(Number(l.qty));
      if (!(qty > 0)) fail(400, `Invalid qty for ${p.brand}`);
      const offer = stockistOffer(sellerId, p);
      const pl = schemes.priceLine({ qty, rate: offer.rate, gstPct: p.gstPct, scheme: offer.scheme, interState });
      const alloc = fefo.allocate(rowsFor(sellerId, 'fg', p.id), pl.totalQty);
      return { productId: p.id, brand: p.brand, hsn: p.hsn, schedule: p.schedule, ...pl, picks: alloc.picks.map((x) => ({ batchNo: x.batchNo, qty: x.qty, expiry: x.expiry, row: x.row })), shortfall: alloc.shortfall };
    });
    const totals = schemes.totals(priced);
    return { sellerId, buyerId, sellerName: seller.name, buyerName: buyer.name, interState, supplyType: interState ? 'Inter-state (IGST)' : 'Intra-state (CGST+SGST)', lines: priced, totals, computeMs: hrms(start) };
  }

  const stripRows = (q) => ({ ...q, lines: q.lines.map((l) => ({ ...l, picks: l.picks.map(({ row, ...x }) => x) })) });

  function createInvoice({ sellerId, buyerId, lines, user = 'Billing Counter', autoReceive, durationMs }) {
    const start = process.hrtime.bigint();
    const q = quoteInvoice({ sellerId, buyerId, lines });
    const short = q.lines.filter((l) => l.shortfall > 0);
    if (short.length) fail(409, `Insufficient stock: ${short.map((l) => `${l.brand} short ${l.shortfall}`).join(', ')}`);
    for (const l of q.lines) deduct(l.picks);
    const seller = getEntity(sellerId);
    const id = store.nextId('BIL');
    const invoiceNo = `SB/26-27/${id.slice(4)}`;
    const irn = auditLog.sha256(`${seller.gstin}2026-27INV${invoiceNo}`);
    const inv = {
      id, invoiceNo, ts: nowIso(), ...stripRows(q), irn, ackNo: String(crypto.randomInt(1e9, 9.99e9)) + String(crypto.randomInt(1e4, 9.99e4)),
      irnNote: 'Simulated IRN (SHA-256 of GSTIN+FY+DocType+DocNo) - not registered with NIC IRP',
      ewayBill: q.totals.total > 50000 ? ewayBillNo() : null, status: 'dispatched', computeMs: 0,
    };
    db().invoices.push(inv);
    for (const l of q.lines) {
      if (l.freeGoodsValue > 0) {
        const p = getProduct(l.productId);
        db().claims.push({ id: store.nextId('CLM'), type: 'scheme_free_goods', debitNoteNo: `DN/${id.slice(4)}/${p.id}`, stockistId: sellerId, manufacturerId: p.manufacturerId, invoiceNo, productId: p.id, brand: p.brand, freeQty: l.free, value: l.freeGoodsValue, status: 'raised', ts: nowIso() });
      }
    }
    const items = q.lines.flatMap((l) => l.picks.map((x) => ({ kind: 'fg', ref: l.productId, productId: l.productId, batchNo: x.batchNo, qty: x.qty, uom: 'pack', expiry: x.expiry, cost: l.effectiveRate })));
    const s = createShipment({ fromId: sellerId, toId: buyerId, kind: 'fg', items, user, invoiceId: id, autoReceive, durationMs: durationMs || 30000 });
    inv.shipmentId = s.id;
    inv.asnNo = s.asnNo;
    inv.computeMs = hrms(start);
    record(user, 'INVOICE_CREATED', invoiceNo, { buyerId, total: q.totals.total, irn });
    changed('invoice', id);
    return inv;
  }

  function expiryAlerts(entityId) {
    const rows = rowsFor(entityId, 'fg').filter((r) => r.qty > 0);
    const buckets = { expired: [], 30: [], 60: [], 90: [], 180: [] };
    for (const r of rows) {
      const b = fefo.expiryBucket(r.expiry);
      if (b === 'ok') continue;
      const p = getProduct(r.ref);
      buckets[b].push({ inventoryId: r.id, productId: p.id, brand: p.brand, batchNo: r.batchNo, qty: r.qty, expiry: r.expiry, daysToExpiry: fefo.daysToExpiry(r.expiry), value: r2(r.qty * (r.cost || 0)), quarantined: r.quarantined });
    }
    const summary = Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, { count: v.length, value: r2(v.reduce((s, x) => s + x.value, 0)) }]));
    return { entityId, summary, buckets };
  }

  function returnNearExpiry({ entityId, inventoryId, qty, user = 'Returns Desk' }) {
    const row = db().inventory.find((r) => r.id === inventoryId && r.entityId === entityId) || fail(404, 'Inventory row not found');
    const days = fefo.daysToExpiry(row.expiry);
    if (days > 90) fail(409, `Batch ${row.batchNo} has ${days} days to expiry - returns accepted only within 90 days`);
    const q = Math.min(Number(qty || row.qty), row.qty);
    const p = getProduct(row.ref);
    const value = r2(q * (row.cost || p.pts));
    deduct([{ row, qty: q }]);
    const cn = { id: store.nextId('CN'), cnNo: `CN/${entityId}/${store.db.counters.CN}`, entityId, productId: p.id, brand: p.brand, batchNo: row.batchNo, qty: q, value, reason: days < 0 ? 'Expired stock return' : `Near-expiry return (${days} days)`, ts: nowIso() };
    db().creditNotes.push(cn);
    db().claims.push({ id: store.nextId('CLM'), type: 'expiry_return', debitNoteNo: `DN/EXP/${cn.id.slice(3)}`, stockistId: entityId, manufacturerId: p.manufacturerId, productId: p.id, brand: p.brand, batchNo: row.batchNo, freeQty: q, value, status: 'raised', ts: nowIso() });
    emitEvent({ type: 'ObjectEvent', action: 'OBSERVE', bizStep: 'staging_outbound', disposition: 'returned', quantityList: [{ epcClass: epcis.lgtinUri(p.gtin, row.batchNo), quantity: q, uom: 'EA' }], entityId, batchNo: row.batchNo }, `Expiry return ${q} packs ${p.brand} ${row.batchNo} - claim raised on manufacturer`);
    record(user, 'EXPIRY_RETURN', row.batchNo, cn);
    changed('creditNote', cn.id);
    return cn;
  }

  // ------------------------------------------------------------------ STAGE 4 · Pharmacy POS
  function stockAt(entityId, productId) {
    return r2(rowsFor(entityId, 'fg', productId).filter((r) => !r.quarantined && new Date(r.expiry) > new Date()).reduce((s, r) => s + r.qty, 0));
  }

  function search({ q = '', entityId = 'E006' }) {
    const start = process.hrtime.bigint();
    const term = String(q).toLowerCase().trim();
    const view = (p) => ({ id: p.id, brand: p.brand, salt: p.salt, strengthMg: p.strengthMg, form: p.form, packSize: p.packSize, schedule: p.schedule, mrp: p.mrp, ptr: p.ptr, gstPct: p.gstPct, coldChain: p.coldChain, ceilingPrice: p.ceilingPrice, stock: stockAt(entityId, p.id), marginPct: r2(((p.mrp - p.ptr) / p.mrp) * 100), marginRs: r2(p.mrp - p.ptr) });
    const hits = db().products.filter((p) => !term || p.brand.toLowerCase().includes(term) || p.salt.toLowerCase().includes(term));
    const results = hits.slice(0, 12).map((p) => ({
      ...view(p),
      substitutes: db().products.filter((x) => x.id !== p.id && x.salt === p.salt && x.strengthMg === p.strengthMg).map(view).sort((a, b) => b.marginPct - a.marginPct),
    }));
    return { q, entityId, results, computeMs: hrms(start) };
  }

  function clinicalCheck({ productIds = [], patient = {}, currentMeds = [] }) {
    const items = [...productIds, ...currentMeds].map(getProduct).map((p) => ({ id: p.id, brand: p.brand, salt: p.salt, drugClass: p.drugClass }));
    return clinical.check(items, patient);
  }

  function verifyPack({ code }) {
    const parsed = gs1.parseElementString(code || '');
    const checks = [];
    const add = (name, pass, detail) => checks.push({ name, pass, detail });
    const p = parsed.gtin13 ? productByGtin(parsed.gtin13) : null;
    add('GTIN check digit', !!parsed.gtin13 && gs1.isValidGs1Number(parsed.gtin13), parsed.gtin13 || 'missing (01)');
    add('GTIN registered in network', !!p, p ? p.brand : 'unknown product');
    const b = p && parsed.batchNo ? db().fgBatches.find((x) => x.batchNo === parsed.batchNo && x.productId === p.id) : null;
    add('Batch exists for product', !!b, parsed.batchNo || 'missing (10)');
    const serial = Number(parsed.serial);
    const inRange = !!(b && b.serialized && serial >= b.serialStart && serial < b.serialStart + b.packs);
    add('Serial commissioned', inRange, parsed.serial || 'missing (21)');
    if (b) add('Expiry matches master data', parsed.expiry === gs1.yymmdd(b.expDate), `${parsed.expiry} vs ${gs1.yymmdd(b.expDate)}`);
    const key = p ? `${p.gtin}:${parsed.serial}` : null;
    const dispensed = !!(key && db().decommissioned && db().decommissioned[key]);
    add('Not previously dispensed', !dispensed, dispensed ? `dispensed ${db().decommissioned[key]}` : 'active');
    const recalled = !!(b && b.status === 'quarantined');
    add('Not under recall/quarantine', !recalled, recalled ? b.quarantineReason : 'clear');
    const expired = !!(b && new Date(b.expDate) < new Date());
    add('Not expired', !expired, b ? b.expDate.slice(0, 10) : '-');
    let status = 'AUTHENTIC';
    if (!p || !b || !inRange || checks[0].pass === false) status = 'SUSPECT_COUNTERFEIT';
    else if (recalled) status = 'RECALLED';
    else if (dispensed) status = 'ALREADY_DISPENSED';
    else if (expired) status = 'EXPIRED';
    else if (checks.some((c) => !c.pass)) status = 'SUSPECT_COUNTERFEIT';
    return { code, status, verified: status === 'AUTHENTIC', parsed, product: p ? { id: p.id, brand: p.brand, salt: p.salt } : null, batchNo: b ? b.batchNo : null, checks, protocol: 'Schedule H2 QR / DSCSA VRS (network-local verification)' };
  }

  function samplePack({ entityId = 'E006', productId }) {
    const rows = rowsFor(entityId, 'fg').filter((r) => (!productId || r.ref === productId) && r.qty > 0);
    if (!rows.length) fail(404, 'No stock to sample');
    const row = rows[crypto.randomInt(0, rows.length)];
    const p = getProduct(row.ref);
    const b = db().fgBatches.find((x) => x.batchNo === row.batchNo);
    const serial = b.serialStart + crypto.randomInt(0, b.packs);
    return { code: gs1.sgtinElementString(p.gtin, serial, b.batchNo, b.expDate), productId: p.id, brand: p.brand, batchNo: b.batchNo };
  }

  function createSale({ entityId = 'E006', lines = [], patient = {}, prescriber = {}, overrideReason, scannedCodes = [], currentMeds = [], user = 'Pharmacist' }) {
    const start = process.hrtime.bigint();
    if (stageOf(entityId) !== 3) fail(400, 'Sales are made at a Stage 4 pharmacy');
    if (!lines.length) fail(400, 'Cart is empty');
    const prods = lines.map((l) => getProduct(l.productId));
    const scheds = new Set(prods.map((p) => p.schedule));
    const needsRx = ['H', 'H1', 'X'].some((s) => scheds.has(s));
    if (needsRx && (!prescriber.name || !prescriber.regNo)) fail(422, 'Prescription required: Schedule H/H1/X items need prescriber name and registration number');
    if ((scheds.has('H1') || scheds.has('X')) && !patient.name) fail(422, 'Schedule H1/X: patient name must be captured for the statutory register');
    if (scheds.has('X') && !patient.idNo) fail(422, 'Schedule X: patient ID number must be captured');
    for (const p of prods) {
      const pc = priceCheck({ productId: p.id });
      if (!pc.compliant) fail(409, `DPCO block: ${pc.message}`);
    }
    const cds = clinicalCheck({ productIds: prods.map((p) => p.id), patient, currentMeds });
    if (cds.blocking && !overrideReason) fail(409, 'Clinical alerts require pharmacist override', { alerts: cds.alerts });
    const verifications = scannedCodes.filter(Boolean).map((code) => verifyPack({ code }));
    const bad = verifications.find((v) => !v.verified);
    if (bad) fail(422, `Pack verification failed: ${bad.status}`, { verification: bad });

    const saleLines = lines.map((l, i) => {
      const p = prods[i];
      const unit = l.unit === 'loose' ? 'loose' : 'pack';
      const qty = Number(l.qty);
      if (!(qty > 0)) fail(400, `Invalid qty for ${p.brand}`);
      const packsNeeded = unit === 'loose' ? Math.round((qty / p.packSize) * 1000) / 1000 : qty;
      const alloc = fefo.allocate(rowsFor(entityId, 'fg', p.id), packsNeeded);
      if (alloc.shortfall > 0) fail(409, `Insufficient stock of ${p.brand} (short ${alloc.shortfall} packs)`);
      const amount = r2(unit === 'loose' ? (qty * p.mrp) / p.packSize : qty * p.mrp);
      const tax = schemes.splitInclusive(amount, p.gstPct);
      return { productId: p.id, brand: p.brand, salt: p.salt, schedule: p.schedule, unit, qty, packs: packsNeeded, mrp: p.mrp, ...tax, gstPct: p.gstPct, picks: alloc.picks };
    });
    for (const l of saleLines) deduct(l.picks);
    const id = store.nextId('SAL');
    const sale = {
      id, billNo: `CP/${id.slice(4)}`, ts: nowIso(), entityId,
      lines: saleLines.map(({ picks, ...l }) => ({ ...l, batches: picks.map((x) => ({ batchNo: x.batchNo, packs: x.qty })) })),
      totals: { amount: r2(saleLines.reduce((s, l) => s + l.amount, 0)), taxable: r2(saleLines.reduce((s, l) => s + l.taxable, 0)), gst: r2(saleLines.reduce((s, l) => s + l.gst, 0)) },
      patient: { name: patient.name || null, age: patient.age || null }, prescriber: prescriber.regNo ? prescriber : null,
      clinicalAlerts: cds.alerts, overrideReason: overrideReason || null, verifiedPacks: verifications.length, computeMs: 0,
    };
    db().sales.push(sale);
    db().decommissioned = db().decommissioned || {};
    for (const v of verifications) db().decommissioned[`${v.parsed.gtin13}:${v.parsed.serial}`] = sale.billNo;
    for (const l of sale.lines) {
      if (['H', 'H1', 'X'].includes(l.schedule)) {
        db().registers.push({ id: store.nextId('REG'), ts: sale.ts, entityId, schedule: l.schedule, billNo: sale.billNo, productId: l.productId, brand: l.brand, salt: l.salt, batches: l.batches.map((b) => b.batchNo).join(', '), qty: l.qty, unit: l.unit,
          patientName: patient.name || '-', patientAge: patient.age || '-', patientId: patient.idNo || '-', prescriberName: prescriber.name, prescriberRegNo: prescriber.regNo });
      }
      const p = getProduct(l.productId);
      emitEvent({ type: 'ObjectEvent', action: 'DELETE', bizStep: 'dispensing', disposition: 'dispensed', quantityList: l.batches.map((b) => ({ epcClass: epcis.lgtinUri(p.gtin, b.batchNo), quantity: b.packs, uom: 'EA' })), entityId, batchNo: l.batches[0].batchNo }, `Dispensed ${l.qty} ${l.unit} ${l.brand} (${sale.billNo})`);
    }
    if (overrideReason) record(user, 'CLINICAL_OVERRIDE', sale.billNo, { overrideReason, alerts: cds.alerts.map((a) => a.title) });
    record(user, 'SALE', sale.billNo, { total: sale.totals.amount, lines: sale.lines.length });
    sale.computeMs = hrms(start);
    changed('sale', id);
    return sale;
  }

  function procurementAgent(entityId = 'E006', { reorderBelow = 5, target = 20 } = {}) {
    const stockists = db().entities.filter((e) => e.participant && e.type === 'STOCKIST');
    const buyer = getEntity(entityId);
    const recs = [];
    for (const p of db().products) {
      const stock = stockAt(entityId, p.id);
      if (stock >= reorderBelow) continue;
      const qty = target - Math.floor(stock);
      const options = stockists.map((s) => {
        const offer = stockistOffer(s.id, p);
        const pl = schemes.priceLine({ qty, rate: offer.rate, gstPct: p.gstPct, scheme: offer.scheme, interState: s.stateCode !== buyer.stateCode });
        return { stockistId: s.id, name: s.name, offer: offer.label, available: stockAt(s.id, p.id), netPerUnit: r2(pl.taxable / pl.totalQty), freeQty: pl.free, taxable: pl.taxable };
      }).sort((a, b) => a.netPerUnit - b.netPerUnit);
      const plan = [];
      let left = qty;
      for (const o of options) {
        if (left <= 0) break;
        const take = Math.min(left, Math.floor(o.available));
        if (take > 0) { plan.push({ stockistId: o.stockistId, name: o.name, qty: take, netPerUnit: o.netPerUnit }); left -= take; }
      }
      const worst = options[options.length - 1];
      const saving = worst ? r2((worst.netPerUnit - options[0].netPerUnit) * qty) : 0;
      recs.push({ productId: p.id, brand: p.brand, stock, reorderQty: qty, options, plan, unfilled: left, savingVsWorst: saving });
    }
    return { agent: 'Autonomous Multi-Distributor Procurement Agent v0.1', entityId, generatedAt: nowIso(), recommendations: recs };
  }

  function placeProcurement(entityId = 'E006', { user = 'Procurement Agent' } = {}) {
    const { recommendations } = procurementAgent(entityId);
    const byStockist = {};
    for (const r of recommendations) for (const pl of r.plan) (byStockist[pl.stockistId] = byStockist[pl.stockistId] || []).push({ productId: r.productId, qty: pl.qty });
    const invoices = Object.entries(byStockist).map(([sellerId, lines]) => createInvoice({ sellerId, buyerId: entityId, lines, user }));
    return { orders: invoices.map((i) => ({ invoiceNo: i.invoiceNo, seller: i.sellerName, total: i.totals.total, asnNo: i.asnNo })) };
  }

  // ------------------------------------------------------------------ MODULE 6 · Entity Data Lake
  const normName = (s) => String(s).toLowerCase().replace(/\b(pvt|private|ltd|limited|the|and|&)\b/g, '').replace(/[^a-z0-9]/g, '').replace(/(s)$/, '');

  function listEntities({ q, type, state, verification } = {}) {
    const term = (q || '').toLowerCase();
    return db().entities.filter((e) =>
      (!term || [e.name, e.city, e.gstin, e.licenseNo, e.id].join(' ').toLowerCase().includes(term)) &&
      (!type || e.type === type) && (!state || e.stateCode === state || e.state === state) && (!verification || e.verification === verification));
  }

  function dataLakeStats() {
    const es = db().entities;
    const by = (k) => es.reduce((m, e) => ((m[e[k]] = (m[e[k]] || 0) + 1), m), {});
    return { total: es.length, byType: by('type'), byVerification: by('verification'), byState: by('state'), participants: es.filter((e) => e.participant).length };
  }

  function addEntity({ name, type, gstin: g, licenseNo, city, source = 'Manual entry', user = 'Data Steward' }) {
    if (!name || !type) fail(400, 'name and type are required');
    if (!(type in STAGE_OF_TYPE)) fail(400, `type must be one of ${Object.keys(STAGE_OF_TYPE).join(', ')}`);
    const v = gstin.validate(g);
    const exact = db().entities.find((e) => e.gstin === v.gstin);
    if (exact) return { status: 'duplicate', message: `GSTIN already on golden record ${exact.id}`, entity: exact, gstin: v };
    const samePan = v.pan && db().entities.find((e) => e.gstin.slice(2, 12) === v.pan && e.verification !== 'duplicate_suspect');
    const sameName = db().entities.find((e) => normName(e.name) === normName(name) && (!city || e.city.toLowerCase() === String(city).toLowerCase()));
    const dupOf = samePan || sameName;
    const e = {
      id: store.nextId('ENT'), name: String(name).trim(), type, gstin: v.gstin, gstValid: v.valid, licenseNo: licenseNo || null, city: city || null,
      stateCode: v.stateCode, state: v.state, source, participant: false, createdAt: nowIso(),
      verification: dupOf ? 'duplicate_suspect' : v.valid ? 'verified' : 'unverified',
      verificationNote: dupOf ? `Possible duplicate of ${dupOf.id} (${samePan ? 'same PAN' : 'same normalised name & city'})` : v.valid ? 'GSTIN format + checksum verified' : v.errors.join('; '),
      duplicateOf: dupOf ? dupOf.id : undefined,
    };
    db().entities.push(e);
    record(user, 'ENTITY_ADDED', e.id, { name: e.name, gstin: e.gstin, verification: e.verification });
    changed('entity', e.id);
    return { status: e.verification, entity: e, gstin: v };
  }

  const HARVEST = {
    first: ['Sai', 'Om', 'Sri Krishna', 'Jeevan', 'Sanjivani', 'Navjeevan', 'Amrit', 'Shiv', 'Ganesh', 'Lakshmi', 'Metro', 'Prime', 'Unity', 'Raj', 'Dhanvantari', 'Aadhya', 'Mahalaxmi', 'Sunrise'],
    suffix: { PHARMACY: ['Medicals', 'Chemists', 'Pharmacy', 'Medical Stores'], STOCKIST: ['Pharma Distributors', 'Medical Agencies', 'Drug House', 'Pharma Traders'], FORMULATOR: ['Lifesciences Ltd', 'Formulations Pvt Ltd'], API_MANUFACTURER: ['Fine Chemicals Ltd', 'Bulk Actives Pvt Ltd'] },
    places: [['Mumbai', '27'], ['Pune', '27'], ['Ahmedabad', '24'], ['Indore', '23'], ['Jaipur', '08'], ['Lucknow', '09'], ['Patna', '10'], ['Kolkata', '19'], ['Chennai', '33'], ['Kochi', '32'], ['Hyderabad', '36'], ['Bengaluru', '29'], ['Delhi', '07'], ['Guwahati', '18']],
    sources: ['CDSCO', 'State FDA register', 'GST public registry', 'AIOCD directory', 'State Pharmacy Council', 'USFDA DMF list'],
  };

  function harvest({ count = 6, user = 'Discovery Agent Swarm' } = {}) {
    const n = Math.min(50, Math.max(1, Number(count) || 6));
    const pick = (a) => a[crypto.randomInt(0, a.length)];
    const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const results = [];
    for (let i = 0; i < n; i++) {
      const roll = Math.random();
      if (roll < 0.12) { // re-discovery of an existing record → dedupe
        const existing = pick(db().entities.filter((e) => e.verification === 'verified'));
        results.push(addEntity({ name: existing.name, type: existing.type, gstin: existing.gstin, licenseNo: existing.licenseNo, city: existing.city, source: pick(HARVEST.sources) + ' (simulated)', user }));
        continue;
      }
      const type = roll < 0.6 ? 'PHARMACY' : roll < 0.85 ? 'STOCKIST' : roll < 0.95 ? 'FORMULATOR' : 'API_MANUFACTURER';
      const [city, sc] = pick(HARVEST.places);
      const name = `${pick(HARVEST.first)} ${pick(HARVEST.suffix[type])}`;
      const pan = Array.from({ length: 3 }, () => pick(L)).join('') + (type === 'PHARMACY' ? 'P' : type === 'STOCKIST' ? 'F' : 'C') + pick(L) + String(crypto.randomInt(1000, 9999)) + pick(L);
      let g = gstin.build(sc, pan);
      if (roll > 0.9) g = g.slice(0, 14) + (g[14] === 'A' ? 'B' : 'A'); // OCR/typo in source listing
      const lic = type === 'PHARMACY' ? `Form 20 & 21: ${sc}-${crypto.randomInt(100000, 999999)}` : type === 'STOCKIST' ? `Form 20B & 21B: ${sc}-${crypto.randomInt(10000, 99999)}` : `Form 25 & 28: ${sc}/${crypto.randomInt(1000, 9999)}`;
      results.push(addEntity({ name, type, gstin: g, licenseNo: lic, city, source: pick(HARVEST.sources) + ' (simulated)', user }));
    }
    const count2 = (s) => results.filter((r) => r.status === s).length;
    return { agent: 'Entity Discovery & Verification Swarm (simulated sources)', discovered: n, verified: count2('verified'), unverified: count2('unverified'), duplicateSuspects: count2('duplicate_suspect'), exactDuplicatesMerged: count2('duplicate'), results };
  }

  // ------------------------------------------------------------------ MODULE 5 · Control Tower
  function towerState() {
    const participants = db().entities.filter((e) => e.participant);
    const stations = STAGE_LABELS.map((label, i) => ({ stage: i, label, entities: participants.filter((e) => STAGE_OF_TYPE[e.type] === i).map((e) => ({ id: e.id, name: e.name, city: e.city })) }));
    const active = db().shipments.filter((s) => ['in_transit', 'arrived', 'quarantined'].includes(s.status));
    const trains = active.map((s) => {
      const d = decorateShipment(s);
      return { id: s.id, asnNo: s.asnNo, fromStage: stageOf(s.fromId), toStage: stageOf(s.toId), fromName: d.fromName, toName: d.toName, progress: s.progress, status: s.status, signal: s.signal || signalFor(s), category: s.category, coldChain: s.coldChain, mkt: s.mkt, lastTemp: s.temps.length ? s.temps[s.temps.length - 1] : null, durationMs: s.durationMs, items: s.items.map((i) => ({ batchNo: i.batchNo, qty: i.qty, uom: i.uom, label: i.kind === 'fg' ? getProduct(i.productId).brand : `${i.ref} API` })), ewayBill: s.ewayBill };
    });
    const quarantined = [...db().apiBatches, ...db().fgBatches].filter((b) => b.status === 'quarantined');
    const nearExpiry = db().inventory.filter((r) => r.kind === 'fg' && fefo.daysToExpiry(r.expiry) <= 90 && fefo.daysToExpiry(r.expiry) >= 0).length;
    return {
      ts: nowIso(), categories: db().categories, stations, trains,
      kpis: {
        inTransit: trains.filter((t) => t.status === 'in_transit').length,
        red: trains.filter((t) => t.signal === 'red').length,
        amber: trains.filter((t) => t.signal === 'amber').length,
        green: trains.filter((t) => t.signal === 'green').length,
        quarantinedBatches: quarantined.length,
        nearExpiryLots: nearExpiry,
        entities: db().entities.length,
        epcisEvents: db().events.length,
        salesToday: db().sales.filter((s) => s.ts.slice(0, 10) === nowIso().slice(0, 10)).length,
      },
      quarantined: quarantined.map((b) => ({ batchNo: b.batchNo, reason: b.quarantineReason })),
      alerts: db().alerts.slice(0, 20),
    };
  }

  function traceBatch(batchNo) {
    const b = findBatch(batchNo);
    if (!b) return null;
    const isApi = db().apiBatches.includes(b);
    const children = isApi ? db().fgBatches.filter((x) => x.apiBatchNo === batchNo).map((x) => x.batchNo) : [];
    const all = [batchNo, ...children];
    const locations = db().inventory.filter((r) => all.includes(r.batchNo)).map((r) => ({ batchNo: r.batchNo, entity: getEntity(r.entityId).name, qty: r.qty, uom: r.uom, quarantined: r.quarantined }));
    const ships = db().shipments.filter((s) => s.items.some((i) => all.includes(i.batchNo))).map((s) => ({ asnNo: s.asnNo, status: s.status, signal: s.signal, from: getEntity(s.fromId).name, to: getEntity(s.toId).name }));
    const events = db().events.filter((e) => all.includes(e['pcx:batchNo'])).length;
    return { batchNo, kind: isApi ? 'API' : 'Finished goods', status: b.status, product: isApi ? b.salt : getProduct(b.productId).brand, parent: isApi ? null : b.apiBatchNo, children, locations, shipments: ships, epcisEvents: events };
  }

  function copilot({ query }) {
    const q = String(query || '').trim();
    const ql = q.toLowerCase();
    const st = towerState();
    const fmtTrains = (ts) => ts.map((t) => `${t.asnNo} ${t.items.map((i) => i.label + ' ' + i.batchNo).join(', ')} (${t.fromName} → ${t.toName}, ${Math.round(t.progress * 100)}%)`);
    const allBatches = [...db().apiBatches, ...db().fgBatches].map((b) => b.batchNo);
    const token = allBatches.find((bn) => ql.includes(bn.toLowerCase()));
    if (token && /(quarantine|recall|block|stop)/.test(ql)) return { answer: `I can stage an Emergency Quarantine for ${token}. Confirm with the Recall Brake - I never quarantine without a human click.`, action: { type: 'quarantine', batchNo: token }, data: traceBatch(token) };
    if (token) {
      const t = traceBatch(token);
      return { answer: `${t.kind} batch ${token} (${t.product}) is ${t.status.toUpperCase()}. ${t.locations.length} stock location(s), ${t.shipments.length} shipment(s), ${t.epcisEvents} EPCIS events.${t.children.length ? ' Downstream FG batches: ' + t.children.join(', ') + '.' : ''}${t.parent ? ' Made from API batch ' + t.parent + '.' : ''}`, data: t };
    }
    if (/(red|excursion|problem|critical|danger)/.test(ql)) {
      const r = st.trains.filter((t) => t.signal === 'red');
      return { answer: r.length ? `${r.length} RED signal(s):\n• ` + fmtTrains(r).join('\n• ') : 'No red signals - network is clear of excursions, OOS and recalls in transit.', data: r };
    }
    if (/(amber|delay|dwell|late|warning)/.test(ql)) {
      const a = st.trains.filter((t) => t.signal === 'amber');
      return { answer: a.length ? `${a.length} AMBER signal(s) (dwell / near-expiry / transient excursion):\n• ` + fmtTrains(a).join('\n• ') : 'No amber signals right now.', data: a };
    }
    if (/(quarantin|recalled|on hold)/.test(ql)) return { answer: st.quarantined.length ? `${st.quarantined.length} batch(es) under quarantine:\n• ` + st.quarantined.map((x) => `${x.batchNo} - ${x.reason}`).join('\n• ') : 'No batches are quarantined.', data: st.quarantined };
    if (/(expir)/.test(ql)) {
      const rows = db().inventory.filter((r) => r.kind === 'fg' && fefo.daysToExpiry(r.expiry) <= 90).sort((a, b) => new Date(a.expiry) - new Date(b.expiry)).slice(0, 6);
      return { answer: `${st.kpis.nearExpiryLots} lots expire within 90 days. Most urgent:\n• ` + rows.map((r) => `${getProduct(r.ref).brand} ${r.batchNo} at ${getEntity(r.entityId).name}: ${r.qty} packs, ${fefo.daysToExpiry(r.expiry)} days`).join('\n• '), data: rows };
    }
    if (/(stockout|demand|shortage|run out)/.test(ql)) {
      const d = demandSensing().products.filter((p) => p.risk).slice(0, 6);
      return { answer: d.length ? 'Stock-out risk (<20 days cover):\n• ' + d.map((p) => `${p.brand}: ` + p.nodes.filter((n) => n.daysCover < 20).map((n) => `${n.name} ${n.daysCover}d`).join(', ')).join('\n• ') : 'No stockist is below 20 days of cover.', data: d };
    }
    const prod = db().products.find((p) => ql.includes(p.brand.toLowerCase().split(' ')[0]) || ql.includes(p.salt.toLowerCase()));
    if (prod && /(stock|where|inventory|how many|available)/.test(ql)) {
      const rows = db().inventory.filter((r) => r.kind === 'fg' && r.ref === prod.id);
      const byE = {};
      for (const r of rows) byE[r.entityId] = (byE[r.entityId] || 0) + r.qty;
      return { answer: `${prod.brand} stock across the network:\n• ` + Object.entries(byE).map(([e, q]) => `${getEntity(e).name}: ${q} packs`).join('\n• '), data: byE };
    }
    if (/(transit|moving|shipment|train)/.test(ql)) return { answer: `${st.kpis.inTransit} shipment(s) in transit (${st.kpis.green} green, ${st.kpis.amber} amber, ${st.kpis.red} red).\n• ` + fmtTrains(st.trains).join('\n• '), data: st.trains };
    return { answer: 'Try: "show red signals", "any delays?", "trace APB2611001", "where is Atorva stock?", "near expiry", "stockout risk", "quarantined batches".', data: null };
  }

  // ------------------------------------------------------------------ demo
  function runScenario() {
    const log = [];
    const amox = createApiBatch({ salt: 'Amoxicillin', batchSizeKg: 120, ksmTheoreticalKg: 80, ksmAssayPct: 98.7, ksmLodPct: 0.35, user: 'demo' });
    log.push(`Stage 1: created API batch ${amox.batchNo} (dispense ${amox.dispensing.actualKg} kg KSM)`);
    recordQc(amox.id, { assay: 99.6, lod: 0.18, totalImpurities: 0.27, kfWater: 0.22, analyst: 'demo QC' }, 'demo QC');
    signBatch(amox.id, { role: 'MAKER', user: 'Demo Operator' });
    signBatch(amox.id, { role: 'CHECKER', user: 'Demo Supervisor' });
    runReleaseAgent(amox.id);
    signBatch(amox.id, { role: 'QA', user: 'Demo QA Head' });
    log.push(`Stage 1: QC → eBMR maker/checker → QA agent PASS → QA released ${amox.batchNo}`);
    const s1 = createShipment({ fromId: 'E001', toId: 'E002', kind: 'api', items: [{ kind: 'api', ref: 'Amoxicillin', batchNo: amox.batchNo, qty: 60, uom: 'kg', expiry: amox.retestDate, cost: 1200 }], user: 'demo', durationMs: 20000, autoReceive: true });
    deduct([{ row: rowsFor('E001', 'api', 'Amoxicillin').find((r) => r.batchNo === amox.batchNo), qty: 60 }]);
    log.push(`Stage 1 → 2: shipped 60 kg (${s1.asnNo})`);
    const fgb = createFgBatch({ productId: 'P001', packs: 2000, user: 'demo' });
    serializeFg(fgb.id, { user: 'demo' });
    log.push(`Stage 2: formulated & serialized Feverex 500 ${fgb.batchNo} (2000 packs)`);
    const s2 = shipFg({ toId: 'E004', productId: 'P001', packs: 400, batchNo: undefined, user: 'demo' });
    s2.durationMs = 25000; s2.autoReceive = true;
    log.push(`Stage 2 → 3: ASN ${s2.asnNo} to Shree Balaji (FEFO-picked)`);
    const inv = createInvoice({ sellerId: 'E004', buyerId: 'E006', lines: [{ productId: 'P001', qty: 20 }, { productId: 'P006', qty: 10 }], user: 'demo', autoReceive: true, durationMs: 30000 });
    log.push(`Stage 3 → 4: invoice ${inv.invoiceNo} ₹${inv.totals.total} (IRN ${inv.irn.slice(0, 12)}…) in ${inv.computeMs} ms`);
    const ins = db().shipments.find((s) => s.coldChain && s.status === 'in_transit');
    if (ins) log.push(`Cold-chain: ${ins.asnNo} streaming telemetry (try "Inject excursion")`);
    changed('scenario');
    return { log };
  }

  function reset() {
    store.reset(seed);
    store.emit({ type: 'change', what: 'reset', ts: nowIso() });
    return { ok: true };
  }

  // ------------------------------------------------------------------ simple getters
  const decorateInv = (r) => {
    const p = r.kind === 'fg' ? getProduct(r.ref) : null;
    return { ...r, name: p ? p.brand : `${r.ref} (API)`, schedule: p ? p.schedule : null, category: p ? p.category : null, daysToExpiry: fefo.daysToExpiry(r.expiry), expiryBucket: fefo.expiryBucket(r.expiry) };
  };

  return {
    HttpError,
    // core
    products: () => db().products.map((p) => ({ ...p, schemeLabel: schemes.describe(p.scheme) })),
    getProduct, getEntity, listEntities, dataLakeStats, addEntity, harvest, validateGstin: (g) => gstin.validate(g),
    inventory: ({ entityId, kind } = {}) => db().inventory.filter((r) => (!entityId || r.entityId === entityId) && (!kind || r.kind === kind)).map(decorateInv).sort((a, b) => a.name.localeCompare(b.name) || new Date(a.expiry) - new Date(b.expiry)),
    // stage 1
    apiSalts, apiBatches: () => db().apiBatches.slice().reverse(), getApiBatch, createApiBatch, recordQc, signBatch, runReleaseAgent, shipApi,
    dispensingCalc: (b) => { try { return pharma.dispensingQty(b); } catch (e) { return fail(400, e.message); } },
    spec: () => pharma.API_SPEC,
    // stage 2
    fgBatches: () => db().fgBatches.slice().reverse().map((b) => ({ ...b, brand: getProduct(b.productId).brand })), fgBatchDetail, createFgBatch, serializeFg, shipFg, priceCheck, addTelemetry, injectExcursion, demandSensing,
    // shipments
    listShipments, getShipment: (id) => decorateShipment(getShipment(id)), receiveShipment,
    // stage 3
    quoteInvoice: (b) => stripRows(quoteInvoice(b)), createInvoice, invoices: ({ entityId } = {}) => db().invoices.filter((i) => !entityId || i.sellerId === entityId || i.buyerId === entityId).slice().reverse(),
    claims: ({ entityId } = {}) => db().claims.filter((c) => !entityId || c.stockistId === entityId).slice().reverse(), expiryAlerts, returnNearExpiry, creditNotes: () => db().creditNotes.slice().reverse(),
    // stage 4
    search, clinicalCheck, verifyPack, samplePack, createSale, sales: ({ entityId } = {}) => db().sales.filter((s) => !entityId || s.entityId === entityId).slice().reverse(),
    registers: ({ entityId, schedule } = {}) => db().registers.filter((r) => (!entityId || r.entityId === entityId) && (!schedule || r.schedule === schedule)).slice().reverse(),
    procurementAgent, placeProcurement,
    // tower & mesh
    towerState, copilot, traceBatch, quarantineBatch, liftQuarantine, alerts: () => db().alerts,
    events: ({ batchNo, bizStep, limit = 200 } = {}) => db().events.filter((e) => (!batchNo || e['pcx:batchNo'] === batchNo) && (!bizStep || e.bizStep === bizStep)).slice(-Number(limit)).reverse(),
    auditTrail: ({ limit = 300 } = {}) => db().audit.slice(-Number(limit)).reverse(), verifyAudit: () => auditLog.verify(db().audit),
    // sim
    tick, runScenario, reset,
  };
}

module.exports = { createServices, HttpError, STAGE_LABELS };
