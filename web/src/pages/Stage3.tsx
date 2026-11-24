// Stage 3 · Super stockist & wholesale ERP: scheme/GST billing, scan-verify WMS, FEFO, expiry & claims
import { useEffect, useState } from 'react';
import { api, qs } from '../api';
import { Inbound } from '../components/Inbound';
import { Badge, ExpBadge, Field, Modal, PageHead, Sched, Table } from '../components/ui';
import { inr, num } from '../format';
import { participants, useApi, useDebounced, useFail, useRef_, useToast } from '../live';
import type { Claim, ExpiryAlerts, InventoryRow, Invoice, Quote, Shipment } from '../types';

const BUCKETS: [string, string, string][] = [['expired', 'Expired', 'b-red'], ['30', '≤30d', 'b-red'], ['60', '≤60d', 'b-amber'], ['90', '≤90d', 'b-amber'], ['180', '≤180d', 'b-blue']];

export function Stage3() {
  const { entities, products } = useRef_();
  const toast = useToast();
  const fail = useFail();
  const stockists = participants(entities, ['STOCKIST']);
  const buyers = participants(entities, ['PHARMACY', 'HOSPITAL_PHARMACY']);
  const [me, setMe] = useState(() => sessionStorage.getItem('s3') || stockists[0].id);
  const [buyer, setBuyer] = useState(buyers[0].id);
  const [prod, setProd] = useState(products[0].id);
  const [qty, setQty] = useState(22);
  const [lines, setLines] = useState<{ productId: string; qty: number }[]>([]);
  const [quote, setQuote] = useState<Quote | string | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => { sessionStorage.setItem('s3', me); }, [me]);
  const { data: ships } = useApi<Shipment[]>(`/shipments${qs({ entityId: me, direction: 'in' })}`);
  const { data: inv } = useApi<InventoryRow[]>(`/inventory${qs({ entityId: me, kind: 'fg' })}`);
  const { data: exp } = useApi<ExpiryAlerts>(`/stage3/expiry-alerts${qs({ entityId: me })}`);
  const { data: invoices } = useApi<Invoice[]>(`/stage3/invoices${qs({ entityId: me })}`);
  const { data: claims } = useApi<Claim[]>(`/stage3/claims${qs({ entityId: me })}`);

  // Live re-pricing whenever the cart, buyer or seller changes.
  const quoteKey = useDebounced(JSON.stringify({ me, buyer, lines }), 120);
  useEffect(() => {
    if (!lines.length) { setQuote(null); return; }
    let alive = true;
    api.post<Quote>('/stage3/invoices/quote', { sellerId: me, buyerId: buyer, lines }).then((q) => alive && setQuote(q)).catch((e) => alive && setQuote(e.message));
    return () => { alive = false; };
  }, [quoteKey]);

  function addLine() {
    const ex = lines.find((l) => l.productId === prod);
    setLines(ex ? lines.map((l) => (l === ex ? { ...l, qty: l.qty + qty } : l)) : [...lines, { productId: prod, qty }]);
  }
  async function createInvoice() {
    try { setInvoice(await api.post<Invoice>('/stage3/invoices', { sellerId: me, buyerId: buyer, lines })); setLines([]); } catch (e) { fail(e); }
  }

  const q = typeof quote === 'object' ? quote : null;
  const short = q?.lines.some((l) => l.shortfall > 0);
  const urgent = exp ? [...exp.buckets.expired, ...exp.buckets['30'], ...exp.buckets['60'], ...exp.buckets['90']] : [];
  const f = filter.toLowerCase();

  return (
    <>
      <PageHead title="Stage 3 · Super Stockist & Wholesale ERP" sub="Scheme engine billing with GST/IRN, scan-verify WMS, FEFO picking, expiry & claims"
        actions={<select value={me} onChange={(e) => setMe(e.target.value)} style={{ width: 'auto' }}>{stockists.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>} />
      <div className="grid g2">
        <div className="card">
          <h2>⚡ Sales invoice (scheme + GST engine)</h2>
          <div className="fields"><Field label="Bill to"><select value={buyer} onChange={(e) => setBuyer(e.target.value)}>{buyers.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.state})</option>)}</select></Field></div>
          <div className="row">
            <select value={prod} onChange={(e) => setProd(e.target.value)} style={{ flex: 2 }}>{products.map((p) => <option key={p.id} value={p.id}>{p.brand} · {p.schemeLabel}</option>)}</select>
            <input type="number" value={qty} onChange={(e) => setQty(Number(e.target.value))} style={{ maxWidth: 90 }} />
            <button onClick={addLine}>Add line</button>
          </div>
          <div style={{ marginTop: 10 }}>
            {!lines.length && <div className="muted small">Add products to price the invoice. Try Feverex × 22 (10+1 free) or Atorva × 12 (5+1 + 2% CD).</div>}
            {typeof quote === 'string' && <div>{quote}</div>}
            {q && lines.length > 0 && (
              <>
                <Table cols={[{ label: 'Product' }, { label: 'Scheme' }, { label: 'Qty', num: true }, { label: 'Free', num: true }, { label: 'Disc', num: true }, { label: 'Taxable', num: true }, { label: 'GST', num: true }, { label: 'Total', num: true }, { label: '' }]}>
                  {q.lines.map((l, i) => (
                    <tr key={l.productId}>
                      <td>{l.brand}<div className="muted small">FEFO: {l.picks.map((p) => `${p.batchNo}×${p.qty}`).join(', ') || '-'}{l.shortfall > 0 && <span style={{ color: '#f87171' }}> short {l.shortfall}</span>}</div></td>
                      <td className="small">{l.scheme}</td><td className="num">{l.qty}</td><td className="num" style={{ color: '#4ade80' }}>{l.free || ''}</td>
                      <td className="num">{inr(l.tradeDiscount + l.cashDiscount)}</td><td className="num">{inr(l.taxable)}</td>
                      <td className="num">{inr(l.gst)}<div className="muted small">{l.igst ? 'IGST' : 'C+S'} {l.gstPct}%</div></td><td className="num">{inr(l.total)}</td>
                      <td><button className="sm ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button></td>
                    </tr>
                  ))}
                </Table>
                <div className="total-box">
                  <div className="small muted">{q.supplyType} · free goods value {inr(q.totals.freeGoodsValue)} (claimable)<br />Priced in <b style={{ color: '#4ade80' }}>{q.computeMs} ms</b></div>
                  <div className="amt">{inr(q.totals.total)}</div>
                </div>
              </>
            )}
          </div>
          <div className="row end" style={{ marginTop: 10 }}>
            <button className="ghost" onClick={() => setLines([])}>Clear</button>
            <button className="primary" disabled={!q || !lines.length || short} onClick={createInvoice}>Create invoice + IRN + ASN</button>
          </div>
        </div>

        <div className="stack">
          <div className="card"><h2>📦 Inbound ASNs (from C&F / manufacturer)</h2><Inbound ships={ships ?? []} /></div>
          <div className="card">
            <h2>⏳ Near-expiry & returns</h2>
            <div className="row">{exp && BUCKETS.map(([k, l, c]) => <Badge key={k} cls={c}>{l}: {exp.summary[k].count} lots · {inr(exp.summary[k].value)}</Badge>)}</div>
            <div style={{ marginTop: 8 }}>
              <Table cols={[{ label: 'Product' }, { label: 'Batch' }, { label: 'Qty', num: true }, { label: 'Expiry' }, { label: '' }]} empty="Nothing within 90 days">
                {urgent.map((x) => (
                  <tr key={x.inventoryId}>
                    <td>{x.brand}</td><td className="mono">{x.batchNo}</td><td className="num">{x.qty}</td><td><ExpBadge days={x.daysToExpiry} /></td>
                    <td><button className="sm" onClick={() => api.post<{ cnNo: string; value: number }>('/stage3/returns', { entityId: me, inventoryId: x.inventoryId })
                      .then((cn) => toast(`Credit note ${cn.cnNo} · ${inr(cn.value)} claim raised on manufacturer`, 'ok')).catch(fail)}>Return → claim</button></td>
                  </tr>
                ))}
              </Table>
            </div>
          </div>
        </div>
      </div>

      <div className="grid g2" style={{ marginTop: 14 }}>
        <div className="card">
          <h2>Inventory (FEFO order)</h2>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter…" style={{ marginBottom: 8 }} />
          <Table cols={[{ label: 'Product' }, { label: 'Batch' }, { label: 'Qty', num: true }, { label: 'Expiry' }, { label: '' }]}>
            {(inv ?? []).filter((r) => !f || r.name.toLowerCase().includes(f) || r.batchNo.toLowerCase().includes(f)).map((r) => (
              <tr key={r.id}><td>{r.name} {r.schedule && <Sched s={r.schedule} />}</td><td className="mono">{r.batchNo}</td><td className="num">{num(r.qty)}</td><td><ExpBadge days={r.daysToExpiry} /></td><td>{r.quarantined && <Badge s="quarantined" />}</td></tr>
            ))}
          </Table>
        </div>
        <div className="stack">
          <div className="card">
            <h2>Invoices</h2>
            <Table cols={[{ label: 'Invoice' }, { label: 'Buyer' }, { label: 'Total', num: true }, { label: 'Status' }, { label: 'ms', num: true }]} empty="No invoices yet">
              {(invoices ?? []).slice(0, 8).map((i) => <tr key={i.id}><td className="mono">{i.invoiceNo}</td><td className="small">{i.buyerName}</td><td className="num">{inr(i.totals.total)}</td><td><Badge s={i.status} /></td><td className="num">{i.computeMs}</td></tr>)}
            </Table>
          </div>
          <div className="card">
            <h2>Manufacturer claims (auto debit notes)</h2>
            <Table cols={[{ label: 'Debit note' }, { label: 'Type' }, { label: 'Product' }, { label: 'Qty', num: true }, { label: 'Value', num: true }]} empty="Claims appear automatically when scheme free goods are billed">
              {(claims ?? []).slice(0, 8).map((c) => <tr key={c.id}><td className="mono small">{c.debitNoteNo}</td><td><Badge cls={c.type === 'expiry_return' ? 'b-amber' : 'b-blue'}>{c.type === 'expiry_return' ? 'expiry' : 'scheme'}</Badge></td><td>{c.brand}</td><td className="num">{c.freeQty}</td><td className="num">{inr(c.value)}</td></tr>)}
            </Table>
          </div>
        </div>
      </div>

      <Modal open={!!invoice} onClose={() => setInvoice(null)}>
        {invoice && (
          <>
            <h2>Invoice {invoice.invoiceNo} <Badge s={invoice.status} /></h2>
            <div className="kv">
              <div>Buyer</div><div>{invoice.buyerName}</div>
              <div>Total</div><div><b>{inr(invoice.totals.total)}</b> ({invoice.supplyType})</div>
              <div>IRN</div><div className="mono small">{invoice.irn}</div>
              <div>Ack No</div><div className="mono">{invoice.ackNo}</div>
              <div>e-Way Bill</div><div>{invoice.ewayBill ? <span className="mono">{invoice.ewayBill}</span> : 'Not required (< ₹50,000)'}</div>
              <div>Delivery ASN</div><div>{invoice.asnNo} - van is on the metro board</div>
              <div>Processing time</div><div><b>{invoice.computeMs} ms</b> end-to-end (pricing + FEFO + IRN + claims + ASN)</div>
            </div>
            <p className="muted small">{invoice.irnNote}</p>
          </>
        )}
      </Modal>
    </>
  );
}
