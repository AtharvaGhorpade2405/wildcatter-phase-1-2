// Stage 2 · Formulation, serialization (Schedule H2 + DSCSA), C&F dispatch, cold chain, DPCO
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Badge, Field, Json, Modal, PageHead, Sig, Spark, Table } from '../components/ui';
import { date, firstWord, inr, num } from '../format';
import { participants, useApi, useDebounced, useFail, useRef_, useToast } from '../live';
import type { FgBatch, InventoryRow, Shipment } from '../types';

interface DemandResp {
  agent: string;
  products: { productId: string; brand: string; risk: boolean; nodes: { name: string; daysCover: number }[]; suggestions: { fromName: string; toName: string; packs: number }[] }[];
}
interface PriceCheck { compliant: boolean; message: string; ceilingPrice: number | null; mrp: number }

export function Stage2() {
  const { products, P, E } = useRef_();
  const toast = useToast();
  const fail = useFail();
  const { data: fg } = useApi<FgBatch[]>('/stage2/batches');
  const { data: stock } = useApi<InventoryRow[]>('/inventory?entityId=E002');
  const { data: ships } = useApi<Shipment[]>('/shipments');
  const { data: demand } = useApi<DemandResp>('/stage2/demand-sensing');

  const [prodId, setProdId] = useState(products[0].id);
  const [packs, setPacks] = useState(1000);
  const [apiBatch, setApiBatch] = useState('');
  const [pcProd, setPcProd] = useState(products[0].id);
  const [mrp, setMrp] = useState(products[0].mrp);
  const [pc, setPc] = useState<PriceCheck | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [shipBatch, setShipBatch] = useState<FgBatch | null>(null);

  const apiStock = (stock ?? []).filter((r) => r.kind === 'api');
  const fgStock = useMemo(() => Object.fromEntries((stock ?? []).filter((r) => r.kind === 'fg').map((r) => [r.batchNo, r.qty])), [stock]);
  const p = P[prodId];
  const needKg = ((packs * p.packSize * p.strengthMg) / 1e6) * 1.02;
  const apiRows = apiStock.filter((r) => r.ref === p.salt && !r.quarantined);
  const availKg = apiRows.reduce((s, r) => s + r.qty, 0);

  const pcInput = useDebounced({ pcProd, mrp }, 200);
  useEffect(() => {
    api.post<PriceCheck>('/stage2/price-check', { productId: pcInput.pcProd, mrp: pcInput.mrp }).then(setPc).catch(() => setPc(null));
  }, [pcInput]);

  async function manufacture() {
    try {
      const b = await api.post<FgBatch>('/stage2/batches', { productId: prodId, packs, apiBatchNo: apiBatch || undefined });
      toast(<>Batch <b>{b.batchNo}</b> manufactured from API {b.apiBatchNo}</>, 'ok');
    } catch (e) { fail(e); }
  }
  async function serialize(id: string) {
    try {
      const r = await api.post<FgBatch>(`/stage2/batches/${id}/serialize`);
      toast(`Serialized ${num(r.packs)} SGTINs in ${r.computeMs} ms → ${r.aggregation?.cases} cases, ${r.aggregation?.pallets} pallet(s)`, 'ok');
    } catch (e) { fail(e); }
  }

  const cold = (ships ?? []).filter((s) => s.coldChain && ['in_transit', 'arrived', 'quarantined'].includes(s.status));
  const risk = (demand?.products ?? []).filter((x) => x.risk).slice(0, 8);

  return (
    <>
      <PageHead title="Stage 2 · Formulation, Serialization & C&F" sub={`${E.E002?.name} · CoA-linked dosage-form batches, Schedule H2 QR + DSCSA serialization, FEFO dispatch, cold chain, DPCO`} />
      <div className="grid g3">
        <div className="card">
          <h2>New finished-goods batch</h2>
          <Field label="Product"><select value={prodId} onChange={(e) => { setProdId(e.target.value); setApiBatch(''); }}>{products.map((x) => <option key={x.id} value={x.id}>{x.brand} ({x.salt})</option>)}</select></Field>
          <div className="fields">
            <Field label="Packs"><input type="number" value={packs} onChange={(e) => setPacks(Number(e.target.value))} /></Field>
            <Field label="API batch (FEFO if blank)">
              <select value={apiBatch} onChange={(e) => setApiBatch(e.target.value)}>
                <option value="">FEFO auto-pick</option>
                {apiRows.map((r) => <option key={r.id} value={r.batchNo}>{r.batchNo} ({num(r.qty, 2)} kg)</option>)}
              </select>
            </Field>
          </div>
          <div className="small muted">{p.packSize} × {p.strengthMg} mg per pack → needs <b>{needKg.toFixed(3)} kg</b> {p.salt} API (incl. 2% overage). Available: <b style={{ color: availKg >= needKg ? '#4ade80' : '#f87171' }}>{num(availKg, 2)} kg</b></div>
          <div className="row end"><button className="primary" onClick={manufacture}>Manufacture batch</button></div>
        </div>
        <div className="card">
          <h2>NPPA / DPCO price guardrail</h2>
          <Field label="Product"><select value={pcProd} onChange={(e) => { setPcProd(e.target.value); setMrp(P[e.target.value].mrp); }}>{products.map((x) => <option key={x.id} value={x.id}>{x.brand}</option>)}</select></Field>
          <Field label="Proposed MRP (₹ per pack)"><input type="number" step="0.5" value={mrp} onChange={(e) => setMrp(Number(e.target.value))} /></Field>
          {pc && <div className="small"><Badge s={pc.compliant ? 'PASS' : 'FAIL'}>{pc.compliant ? 'compliant' : 'blocked'}</Badge> {pc.message}<br /><span className="muted">Ceiling: {pc.ceilingPrice == null ? 'not under DPCO' : inr(pc.ceilingPrice)} · MRP {inr(pc.mrp)}</span></div>}
        </div>
        <div className="card">
          <h2>API stock at formulator</h2>
          <Table cols={[{ label: 'API' }, { label: 'Batch' }, { label: 'kg', num: true }]} empty="Ship API from Stage 1">
            {apiStock.map((r) => <tr key={r.id}><td>{r.ref}</td><td className="mono">{r.batchNo} {r.quarantined && <Badge s="quarantined" />}</td><td className="num">{num(r.qty, 2)}</td></tr>)}
          </Table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2>Finished-goods batches</h2>
        <Table cols={[{ label: 'Batch' }, { label: 'Product' }, { label: 'Packs made', num: true }, { label: 'In stock', num: true }, { label: 'Expiry' }, { label: 'API batch' }, { label: 'Status' }, { label: '' }]}>
          {(fg ?? []).slice(0, 40).map((b) => (
            <tr key={b.id}>
              <td className="mono">{b.batchNo}</td><td>{b.brand}</td><td className="num">{num(b.packs)}</td><td className="num">{num(fgStock[b.batchNo] || 0)}</td>
              <td>{date(b.expDate)}</td><td className="mono small">{b.apiBatchNo || '-'}</td><td><Badge s={b.status} /></td>
              <td><div className="row" style={{ flexWrap: 'nowrap' }}>
                {!b.serialized && b.status !== 'quarantined' && <button className="sm primary" onClick={() => serialize(b.id)}>Serialize</button>}
                {b.serialized && !!fgStock[b.batchNo] && b.status !== 'quarantined' && <button className="sm" onClick={() => setShipBatch(b)}>Dispatch</button>}
                <button className="sm ghost" onClick={() => setDetailId(b.id)}>Details</button>
              </div></td>
            </tr>
          ))}
        </Table>
      </div>

      <div className="grid g2" style={{ marginTop: 14 }}>
        <div className="card">
          <h2>❄ Cold-chain IoT monitor (2-8 °C, MKT)</h2>
          <Table cols={[{ label: 'ASN' }, { label: 'Route' }, { label: 'Temp trend' }, { label: 'Last', num: true }, { label: 'MKT', num: true }, { label: '' }]} empty="No cold-chain shipments moving. Dispatch Glarzin 100IU Pen to start one.">
            {cold.map((s) => (
              <tr key={s.id}>
                <td><Sig s={s.signal} />{s.asnNo}</td><td className="small">{s.fromName} → {s.toName}</td><td><Spark vals={s.temps} /></td>
                <td className="num">{s.temps.length ? `${s.temps[s.temps.length - 1]} °C` : '-'}</td><td className="num"><b>{s.mkt ?? '-'}</b></td>
                <td>{s.status === 'in_transit' && !s.excursion
                  ? <button className="sm" onClick={() => api.post(`/shipments/${s.id}/inject-excursion`).then(() => toast('Reefer failure simulated - MKT will breach and auto-quarantine', 'warn')).catch(fail)}>Inject excursion</button>
                  : <Badge s={s.status} />}</td>
              </tr>
            ))}
          </Table>
        </div>
        <div className="card">
          <h2>🤖 AI Demand-Sensing & Reallocation Agent</h2>
          <div className="muted small" style={{ marginBottom: 6 }}>{demand?.agent}</div>
          <Table cols={[{ label: 'Product' }, { label: 'Days of cover' }, { label: 'Suggested action' }]} empty="No stock-out risk detected">
            {risk.map((x) => (
              <tr key={x.productId}>
                <td>{x.brand}</td>
                <td className="small">{x.nodes.map((n) => <div key={n.name}>{firstWord(n.name)}: <b style={{ color: n.daysCover < 20 ? '#f87171' : '#cbd5e1' }}>{n.daysCover}d</b></div>)}</td>
                <td className="small">{x.suggestions.length ? x.suggestions.map((s, i) => <div key={i}>Move <b>{num(s.packs)}</b> packs {firstWord(s.fromName)} → {firstWord(s.toName)}</div>) : '-'}</td>
              </tr>
            ))}
          </Table>
        </div>
      </div>

      <Modal open={!!detailId} onClose={() => setDetailId(null)}>{detailId && <FgDetail id={detailId} />}</Modal>
      <Modal open={!!shipBatch} onClose={() => setShipBatch(null)}>{shipBatch && <ShipForm batch={shipBatch} onDone={() => setShipBatch(null)} />}</Modal>
    </>
  );
}

function FgDetail({ id }: { id: string }) {
  const { data: b } = useApi<FgBatch>(`/stage2/batches/${id}`);
  if (!b || !b.product) return <div className="muted">Loading…</div>;
  return (
    <>
      <h2>{b.batchNo} · {b.product.brand} <Badge s={b.status} /></h2>
      <div className="kv">
        <div>Packs</div><div>{num(b.packs)} × {b.product.packSize} {b.product.form}</div>
        <div>API batch / CoA</div><div>{b.apiBatchNo || '-'} {(b.coaLinks ?? []).map((c) => <Badge key={c} cls="b-blue">{c}</Badge>)}</div>
        <div>Mfg / Expiry</div><div>{date(b.mfgDate)} → {date(b.expDate)}</div>
        <div>GTIN</div><div className="mono">{b.product.gtin}</div>
        {b.aggregation && <><div>Aggregation</div><div>{num(b.aggregation.packs)} packs → {b.aggregation.cases} cases (SSCC) → {b.aggregation.pallets} pallet(s)</div></>}
        {b.serialized && b.serialStart != null && <><div>Serial range</div><div className="mono">{b.serialStart} – {b.serialStart + b.packs - 1}</div></>}
      </div>
      {b.samples?.length ? (
        <>
          <h3>Sample pack identifiers</h3>
          {b.samples.map((s) => <div key={s.serial} className="card tight" style={{ marginBottom: 6 }}><div className="mono small">{s.gs1}</div><div className="mono small muted">{s.epc}</div></div>)}
          <h3>Schedule H2 QR payload (India)</h3>
          <Json value={b.samples[0].h2Qr} />
        </>
      ) : <p className="muted">Not serialized yet - serialization is required before dispatch (Schedule H2 / DSCSA).</p>}
    </>
  );
}

function ShipForm({ batch, onDone }: { batch: FgBatch; onDone: () => void }) {
  const { entities, P } = useRef_();
  const toast = useToast();
  const fail = useFail();
  const stockists = participants(entities, ['STOCKIST']);
  const [to, setTo] = useState(stockists[0]?.id ?? '');
  const [packs, setPacks] = useState(200);
  const [useBatch, setUseBatch] = useState(true);
  const [override, setOverride] = useState(false);

  async function go() {
    try {
      const s = await api.post<Shipment>('/stage2/ship', { toId: to, productId: batch.productId, packs, batchNo: useBatch ? batch.batchNo : undefined, overrideFefo: override });
      toast(`Dispatched · ${s.asnNo} with ${s.ssccs.length} SSCC(s)${s.ewayBill ? ' · e-Way Bill ' + s.ewayBill : ''}`, 'ok');
      onDone();
    } catch (e) { fail(e); }
  }

  return (
    <>
      <h2>Dispatch {P[batch.productId].brand} to stockist</h2>
      <div className="fields">
        <Field label="Stockist"><select value={to} onChange={(e) => setTo(e.target.value)}>{stockists.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Packs"><input type="number" value={packs} onChange={(e) => setPacks(Number(e.target.value))} /></Field>
      </div>
      <Field label={<><input type="checkbox" checked={useBatch} onChange={(e) => setUseBatch(e.target.checked)} /> Ship from batch {batch.batchNo} (uncheck for FEFO auto-pick)</>}>{null}</Field>
      <Field label={<><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> Override FEFO gatekeeper (logged to audit trail)</>}>{null}</Field>
      <div className="row end"><button className="primary" onClick={go}>Create ASN & dispatch</button></div>
    </>
  );
}
