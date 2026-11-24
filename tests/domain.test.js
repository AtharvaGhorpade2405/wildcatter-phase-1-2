// Deterministic tests for the compliance/tax/clinical rules engines.
const test = require('node:test');
const assert = require('node:assert/strict');
const gs1 = require('../server/domain/gs1');
const gstin = require('../server/domain/gstin');
const pharma = require('../server/domain/pharma');
const coldchain = require('../server/domain/coldchain');
const schemes = require('../server/domain/schemes');
const fefo = require('../server/domain/fefo');
const clinical = require('../server/domain/clinical');
const audit = require('../server/domain/audit');

test('GS1 check digit matches known GTIN-13', () => {
  assert.equal(gs1.checkDigit('400638133393'), 1); // 4006381333931 is the canonical GS1 example
  assert.ok(gs1.isValidGs1Number('4006381333931'));
  assert.ok(!gs1.isValidGs1Number('4006381333932'));
});

test('SSCC is 18 digits with valid check digit', () => {
  const s = gs1.makeSscc('8901234', 42);
  assert.equal(s.length, 18);
  assert.ok(gs1.isValidGs1Number(s));
});

test('SGTIN element string round-trips through parser', () => {
  const str = gs1.sgtinElementString('8901234100016', 100005, 'FEVB2600', '2027-12-31T00:00:00Z');
  const p = gs1.parseElementString(str);
  assert.equal(p.gtin13, '8901234100016');
  assert.equal(p.serial, '100005');
  assert.equal(p.batchNo, 'FEVB2600');
  assert.equal(p.expiry, '271231');
});

test('GSTIN build/validate and checksum rejection', () => {
  const g = gstin.build('27', 'AAPFS6610D');
  assert.ok(gstin.validate(g).valid);
  const bad = g.slice(0, 14) + (g[14] === 'A' ? 'B' : 'A');
  const v = gstin.validate(bad);
  assert.ok(!v.valid);
  assert.match(v.errors[0], /Checksum/);
  assert.ok(!gstin.validate('XX123').valid);
});

test('GSTIN checksum property: every single-character mutation of the check char is rejected', () => {
  const g = gstin.build('36', 'AADCD4521K');
  for (const c of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    if (c === g[14]) continue;
    assert.ok(!gstin.validate(g.slice(0, 14) + c).valid);
  }
});

test('Potency + LOD dispensing formula', () => {
  const r = pharma.dispensingQty({ theoreticalKg: 100, assayPct: 98, lodPct: 2 });
  assert.equal(r.actualKg, Math.round(100 * (100 / 98) * (100 / 98) * 1000) / 1000);
  assert.throws(() => pharma.dispensingQty({ theoreticalKg: 100, assayPct: 0, lodPct: 1 }));
});

test('QC evaluation flags OOS', () => {
  assert.ok(pharma.evaluateQc({ assay: 99.5, lod: 0.2, totalImpurities: 0.3, kfWater: 0.2 }).pass);
  const r = pharma.evaluateQc({ assay: 96.1, lod: 0.2, totalImpurities: 0.3, kfWater: 0.2 });
  assert.ok(!r.pass);
  assert.equal(r.tests.find((t) => t.key === 'assay').pass, false);
});

test('MKT equals the constant for constant temperature and is >= arithmetic mean', () => {
  assert.equal(coldchain.mkt([5, 5, 5]), 5);
  const temps = [2, 4, 8, 12, 5];
  const mean = temps.reduce((a, b) => a + b) / temps.length;
  assert.ok(coldchain.mkt(temps) >= mean);
  assert.equal(coldchain.evaluate([5, 5, 9, 5]).signal, 'amber');
  assert.equal(coldchain.evaluate([12, 13, 14]).signal, 'red');
});

test('Scheme engine: 10+1 free, 5+1+2% CD, slabs, intra vs inter-state GST', () => {
  const free = schemes.priceLine({ qty: 25, rate: 10, gstPct: 12, scheme: { type: 'free', buy: 10, free: 1 } });
  assert.equal(free.free, 2);
  assert.equal(free.taxable, 250);
  assert.equal(free.cgst + free.sgst, 30);
  assert.equal(free.freeGoodsValue, 20);

  const combo = schemes.priceLine({ qty: 12, rate: 100, gstPct: 12, scheme: { type: 'free', buy: 5, free: 1, cdPct: 2 }, interState: true });
  assert.equal(combo.free, 2);
  assert.equal(combo.cashDiscount, 24);
  assert.equal(combo.taxable, 1176);
  assert.equal(combo.igst, 141.12);
  assert.equal(combo.cgst, 0);

  const slab = { type: 'slab', slabs: [{ minQty: 50, pct: 5 }, { minQty: 100, pct: 8 }] };
  assert.equal(schemes.priceLine({ qty: 49, rate: 1, gstPct: 12, scheme: slab }).tradeDiscountPct, 0);
  assert.equal(schemes.priceLine({ qty: 50, rate: 1, gstPct: 12, scheme: slab }).tradeDiscountPct, 5);
  assert.equal(schemes.priceLine({ qty: 150, rate: 1, gstPct: 12, scheme: slab }).tradeDiscountPct, 8);
});

test('Scheme property: free qty is monotonic and GST always equals rate x taxable', () => {
  const sc = { type: 'free', buy: 10, free: 1, cdPct: 2 };
  let prevFree = 0;
  for (let qty = 1; qty <= 500; qty++) {
    for (const gstPct of [5, 12, 18]) {
      const l = schemes.priceLine({ qty, rate: 37.5, gstPct, scheme: sc, interState: qty % 2 === 0 });
      assert.ok(Math.abs(l.gst - (l.taxable * gstPct) / 100) < 0.011);
      assert.ok(Math.abs(l.cgst + l.sgst + l.igst - l.gst) < 0.011);
      assert.ok(l.free >= prevFree);
      prevFree = l.free;
    }
  }
});

test('GST-inclusive split for MRP billing', () => {
  const s = schemes.splitInclusive(112, 12);
  assert.equal(s.taxable, 100);
  assert.equal(s.gst, 12);
});

test('FEFO allocates earliest expiry first and skips quarantined/expired stock', () => {
  const now = new Date('2026-01-01');
  const rows = [
    { batchNo: 'LATE', qty: 10, expiry: '2027-06-01' },
    { batchNo: 'EARLY', qty: 5, expiry: '2026-03-01' },
    { batchNo: 'Q', qty: 50, expiry: '2026-02-01', quarantined: true },
    { batchNo: 'EXP', qty: 50, expiry: '2025-12-01' },
  ];
  const r = fefo.allocate(rows, 8, now);
  assert.deepEqual(r.picks.map((p) => [p.batchNo, p.qty]), [['EARLY', 5], ['LATE', 3]]);
  assert.equal(r.shortfall, 0);
  assert.equal(fefo.allocate(rows, 100, now).shortfall, 85);
});

test('Clinical: DDI, allergy, pregnancy and paediatric alerts', () => {
  const P = (id, salt, drugClass) => ({ id, brand: id, salt, drugClass });
  const r = clinical.check([P('a', 'Warfarin', 'anticoagulant'), P('b', 'Aspirin', 'antiplatelet')], {});
  assert.ok(r.alerts.some((a) => a.type === 'ddi' && a.severity === 'major'));
  assert.ok(r.blocking);
  const al = clinical.check([P('c', 'Amoxicillin', 'penicillin')], { allergies: ['Penicillin'] });
  assert.equal(al.alerts[0].severity, 'contraindicated');
  assert.ok(clinical.check([P('d', 'Warfarin')], { pregnant: true }).blocking);
  assert.ok(clinical.check([P('e', 'Aspirin')], { age: 10 }).alerts.some((a) => a.type === 'paediatric'));
  assert.equal(clinical.check([P('f', 'Paracetamol')], {}).alerts.length, 0);
});

test('Audit chain detects tampering', () => {
  const log = [];
  audit.append(log, { user: 'a', action: 'X', data: { v: 1 } });
  audit.append(log, { user: 'b', action: 'Y', data: { v: 2 } });
  audit.append(log, { user: 'c', action: 'Z', data: { v: 3 } });
  assert.ok(audit.verify(log).valid);
  log[1].data.v = 999;
  const v = audit.verify(log);
  assert.ok(!v.valid);
  assert.equal(v.brokenAt, 2);
});
