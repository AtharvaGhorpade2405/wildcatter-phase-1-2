// Stage 4 · Pharmacy & hospital dispensary OS: keyboard-first POS, substitution, CDS, registers, VRS, procurement agent
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, qs } from '../api';
import { Inbound } from '../components/Inbound';
import { Badge, Field, PageHead, Sched, Table } from '../components/ui';
import { dateTime, firstWord, inr, num } from '../format';
import { participants, useApi, useDebounced, useFail, useRef_, useToast } from '../live';
import type { ClinicalResult, ProcurementRec, RegisterEntry, Sale, SearchResult, Shipment, VerifyResult } from '../types';

interface CartLine { productId: string; qty: number; unit: 'pack' | 'loose' }

export function Stage4() {
  const { entities, products, P } = useRef_();
  const toast = useToast();
  const fail = useFail();
  const pharmacies = participants(entities, ['PHARMACY', 'HOSPITAL_PHARMACY']);
  const [me, setMe] = useState(() => sessionStorage.getItem('s4') || pharmacies[0].id);
  useEffect(() => { sessionStorage.setItem('s4', me); }, [me]);

  // search
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchMs, setSearchMs] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const dq = useDebounced(q, 80);
  useEffect(() => {
    api.get<{ results: SearchResult[]; computeMs: number }>(`/stage4/search${qs({ q: dq, entityId: me })}`).then((r) => { setResults(r.results); setSearchMs(r.computeMs); setActive(0); });
  }, [dq, me]);

  // cart, patient, prescription
  const [cart, setCart] = useState<CartLine[]>([]);
  const [verified, setVerified] = useState<string[]>([]);
  const [patient, setPatient] = useState({ name: '', age: '', allergies: '', pregnant: false, idNo: '' });
  const [meds, setMeds] = useState<string[]>([]);
  const [rx, setRx] = useState({ name: '', regNo: '' });
  const [override, setOverride] = useState('');
  const [cds, setCds] = useState<ClinicalResult | null>(null);
  const [code, setCode] = useState('');
  const [vrs, setVrs] = useState<VerifyResult | null>(null);
  const [regSched, setRegSched] = useState('');

  const patientBody = () => ({
    name: patient.name, age: patient.age === '' ? undefined : Number(patient.age),
    allergies: patient.allergies.split(',').map((s) => s.trim()).filter(Boolean), pregnant: patient.pregnant, idNo: patient.idNo,
  });

  // Live clinical decision support
  const cdsKey = useDebounced(JSON.stringify({ ids: cart.map((c) => c.productId), patient, meds }), 150);
  useEffect(() => {
    if (!cart.length) { setCds(null); return; }
    api.post<ClinicalResult>('/stage4/clinical-check', { productIds: cart.map((c) => c.productId), patient: patientBody(), currentMeds: meds }).then(setCds).catch(() => {});
  }, [cdsKey]);

  const add = (pid: string) => {
    setCart((c) => (c.some((x) => x.productId === pid) ? c.map((x) => (x.productId === pid ? { ...x, qty: x.qty + 1 } : x)) : [...c, { productId: pid, qty: 1, unit: 'pack' }]));
    searchRef.current?.select();
  };
  const amount = (c: CartLine) => (c.unit === 'loose' ? (c.qty * P[c.productId].mrp) / P[c.productId].packSize : c.qty * P[c.productId].mrp);
  const total = cart.reduce((s, c) => s + amount(c), 0);

  async function checkout() {
    if (!cart.length) return toast('Cart is empty', 'warn');
    try {
      const sale = await api.post<Sale>('/stage4/sales', { entityId: me, lines: cart, patient: patientBody(), prescriber: rx, overrideReason: override || undefined, scannedCodes: verified, currentMeds: meds });
      toast(<>Bill <b>{sale.billNo}</b> · {inr(sale.totals.amount)} · processed in <b>{sale.computeMs} ms</b></>, 'ok');
      setCart([]); setVerified([]); setOverride(''); setVrs(null); searchRef.current?.focus();
    } catch (e) {
      if (e instanceof ApiError && (e.details as { alerts?: unknown })?.alerts) toast('Blocking clinical alert - enter an override reason to proceed', 'err');
      else fail(e);
    }
  }
  const checkoutRef = useRef(checkout);
  checkoutRef.current = checkout;

  // Keyboard shortcuts: F9 checkout, "/" focuses search
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'F9') { e.preventDefault(); checkoutRef.current(); }
      if (e.key === '/' && (document.activeElement as HTMLElement)?.tagName !== 'INPUT') { e.preventDefault(); searchRef.current?.focus(); }
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, []);

  async function verify(c = code) {
    try {
      const r = await api.post<VerifyResult>('/stage4/verify', { code: c.trim() });
      setVrs(r);
      if (r.verified && !verified.includes(c.trim())) { setVerified([...verified, c.trim()]); if (r.product) add(r.product.id); }
    } catch (e) { fail(e); }
  }

  const { data: ships } = useApi<Shipment[]>(`/shipments${qs({ entityId: me, direction: 'in' })}`);
  const { data: regs } = useApi<RegisterEntry[]>(`/stage4/registers${qs({ entityId: me, schedule: regSched })}`);
  const { data: sales } = useApi<Sale[]>(`/stage4/sales${qs({ entityId: me })}`);
  const { data: proc } = useApi<{ recommendations: ProcurementRec[] }>(`/stage4/procurement${qs({ entityId: me })}`);
  const recs = proc?.recommendations ?? [];

  return (
    <>
      <PageHead title="Stage 4 · Pharmacy & Hospital Dispensary OS"
        sub={<>Keyboard-first POS: <kbd>/</kbd> search · <kbd>↑↓</kbd> pick · <kbd>Enter</kbd> add · <kbd>F9</kbd> checkout</>}
        actions={<select value={me} onChange={(e) => setMe(e.target.value)} style={{ width: 'auto' }}>{pharmacies.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>} />

      <div className="grid g-pos">
        <div className="stack">
          <div className="card">
            <div className="row">
              <input ref={searchRef} autoFocus autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }}
                placeholder="Search brand or salt (e.g. atorva, paracetamol, warfarin)…"
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') { setActive((a) => Math.min(results.length - 1, a + 1)); e.preventDefault(); }
                  if (e.key === 'ArrowUp') { setActive((a) => Math.max(0, a - 1)); e.preventDefault(); }
                  if (e.key === 'Enter' && results[active]) add(results[active].id);
                }} />
              <span className="muted small">{searchMs != null && `${searchMs} ms`}</span>
            </div>
            <div className="results">
              {results.length ? results.map((p, i) => {
                const better = p.substitutes.find((s) => s.marginPct > p.marginPct && s.stock > 0);
                return (
                  <div key={p.id} className={`res ${i === active ? 'active' : ''}`} onClick={() => add(p.id)}>
                    <div className="row"><b>{p.brand}</b><Sched s={p.schedule} />{p.coldChain && <Badge cls="b-blue">❄ 2-8°C</Badge>}<span className="spacer" /><b>{inr(p.mrp)}</b></div>
                    <div className="sub">{p.salt} {p.strengthMg} mg · {p.form} × {p.packSize} · stock <b style={{ color: p.stock > 0 ? '#cbd5e1' : '#f87171' }}>{num(p.stock, 2)}</b> · margin {p.marginPct}%</div>
                    {better && (
                      <div className="sub-hint">💡 Bioequivalent: <b>{better.brand}</b> {inr(better.mrp)} · margin <b>{better.marginPct}%</b> (+{inr(better.marginRs - p.marginRs)}/pack){' '}
                        <button className="sm" onClick={(e) => { e.stopPropagation(); add(better.id); }}>Add instead</button></div>
                    )}
                  </div>
                );
              }) : <div className="empty">No match</div>}
            </div>
          </div>

          <div className="card">
            <h2>🧾 Cart</h2>
            <Table cols={[{ label: 'Item' }, { label: 'Qty' }, { label: 'Unit' }, { label: 'Amount', num: true }, { label: '' }]} empty="Cart is empty - search and press Enter">
              {cart.map((c, i) => {
                const p = P[c.productId];
                const upd = (patch: Partial<CartLine>) => setCart(cart.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                return (
                  <tr key={c.productId}>
                    <td>{p.brand} <Sched s={p.schedule} /><div className="muted small">MRP {inr(p.mrp)} / {p.packSize}</div></td>
                    <td><input type="number" min={1} value={c.qty} onChange={(e) => upd({ qty: Math.max(1, Number(e.target.value)) })} style={{ width: 70 }} /></td>
                    <td><select value={c.unit} onChange={(e) => upd({ unit: e.target.value as CartLine['unit'] })} style={{ width: 'auto' }}><option value="pack">pack</option><option value="loose">loose tab</option></select></td>
                    <td className="num">{inr(amount(c))}</td>
                    <td><button className="sm ghost" onClick={() => setCart(cart.filter((_, j) => j !== i))}>✕</button></td>
                  </tr>
                );
              })}
            </Table>
            <div className="row" style={{ marginTop: 10 }}>
              <input value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && verify()} placeholder="Scan pack QR / DataMatrix to verify (H2 / VRS)" style={{ flex: 1 }} />
              <button onClick={() => verify()}>Verify</button>
              <button className="ghost" onClick={() => api.get<{ code: string }>(`/stage4/sample-pack${qs({ entityId: me })}`).then((s) => setCode(s.code)).catch(fail)}>Sample code</button>
            </div>
            {vrs && (
              <div className="small" style={{ marginTop: 6 }}>
                <Badge s={vrs.status} /> {vrs.product && `${vrs.product.brand} · ${vrs.batchNo ?? ''}`}
                <div className="mono small" style={{ marginTop: 4 }}>{vrs.checks.map((c) => <div key={c.name}>{c.pass ? '✅' : '❌'} {c.name}: {c.detail}</div>)}</div>
              </div>
            )}
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <h2>Patient & prescription</h2>
            <div className="fields">
              <Field label="Patient name"><input value={patient.name} onChange={(e) => setPatient({ ...patient, name: e.target.value })} /></Field>
              <Field label="Age"><input type="number" value={patient.age} onChange={(e) => setPatient({ ...patient, age: e.target.value })} /></Field>
            </div>
            <div className="fields">
              <Field label="Allergies (comma)"><input value={patient.allergies} placeholder="penicillin, nsaid" onChange={(e) => setPatient({ ...patient, allergies: e.target.value })} /></Field>
              <Field label="Patient ID (Sch X)"><input value={patient.idNo} onChange={(e) => setPatient({ ...patient, idNo: e.target.value })} /></Field>
            </div>
            <Field label={<><input type="checkbox" checked={patient.pregnant} onChange={(e) => setPatient({ ...patient, pregnant: e.target.checked })} /> Pregnant</>}>{null}</Field>
            <Field label="Current medications (for DDI)">
              <select multiple size={3} value={meds} onChange={(e) => setMeds([...e.target.selectedOptions].map((o) => o.value))}>{products.map((p) => <option key={p.id} value={p.id}>{p.brand}</option>)}</select>
            </Field>
            <div className="fields">
              <Field label="Prescriber"><input value={rx.name} placeholder="Dr. name" onChange={(e) => setRx({ ...rx, name: e.target.value })} /></Field>
              <Field label="Reg. no (NMC/SMC)"><input value={rx.regNo} onChange={(e) => setRx({ ...rx, regNo: e.target.value })} /></Field>
            </div>
          </div>

          <div className="card">
            <h2>🩺 Clinical decision support</h2>
            {!cds ? <div className="muted small">Alerts appear as you add items.</div> : (
              <>
                {cds.alerts.length ? cds.alerts.map((a, i) => <div key={i} className={`cds ${a.severity}`}><b>{a.title}</b> <Badge>{a.severity}</Badge><div className="small">{a.detail}</div></div>)
                  : <div className="cds minor">✅ No interactions, allergies or duplicate therapy found.</div>}
                <div className="muted small">{cds.knowledgeBase}</div>
                {cds.blocking && <Field label="Pharmacist override reason (logged)" className="" ><input value={override} onChange={(e) => setOverride(e.target.value)} placeholder="e.g. Prescriber confirmed, INR monitored" /></Field>}
              </>
            )}
          </div>

          <div className="card">
            <div className="total-box" style={{ marginTop: 0 }}>
              <div className="muted small">{cart.length} item(s) · GST inclusive{verified.length > 0 && ` · ${verified.length} pack(s) verified`}</div>
              <div className="amt">{inr(total)}</div>
            </div>
            <button className="primary" onClick={checkout} style={{ width: '100%', marginTop: 10, justifyContent: 'center' }}>Checkout (F9)</button>
          </div>
        </div>
      </div>

      <div className="grid g2" style={{ marginTop: 14 }}>
        <div className="card">
          <h2>🤖 Multi-Distributor Procurement Agent</h2>
          <div className="muted small" style={{ marginBottom: 6 }}>Low-stock SKUs (&lt; 5 packs) · splits orders across distributors by best net landed cost after schemes.</div>
          <Table cols={[{ label: 'Product' }, { label: 'Stock', num: true }, { label: 'Order', num: true }, { label: 'Best offer' }, { label: 'Saving', num: true }]} empty="All SKUs above reorder level">
            {recs.map((r) => (
              <tr key={r.productId}>
                <td>{r.brand}</td><td className="num">{r.stock}</td><td className="num">{r.reorderQty}</td>
                <td className="small">{r.plan.map((p) => <div key={p.name}>{firstWord(p.name)} × {p.qty} @ {inr(p.netPerUnit)}</div>)}<div className="muted">{r.options.map((o) => `${firstWord(o.name)}: ${o.offer}`).join(' | ')}</div></td>
                <td className="num" style={{ color: '#4ade80' }}>{inr(r.savingVsWorst)}</td>
              </tr>
            ))}
          </Table>
          {recs.length > 0 && (
            <div className="row end" style={{ marginTop: 8 }}>
              <button className="primary" onClick={() => api.post<{ orders: { seller: string; total: number }[] }>('/stage4/procurement/place', { entityId: me })
                .then((r) => toast(`Placed ${r.orders.length} order(s): ${r.orders.map((o) => `${o.seller} ${inr(o.total)}`).join(', ')}`, 'ok')).catch(fail)}>Place agent orders</button>
            </div>
          )}
        </div>
        <div className="card"><h2>📦 Incoming deliveries (QR/ASN inward)</h2><Inbound ships={ships ?? []} /></div>
      </div>

      <div className="grid g2" style={{ marginTop: 14 }}>
        <div className="card">
          <h2>📒 Statutory registers
            <select value={regSched} onChange={(e) => setRegSched(e.target.value)} style={{ width: 'auto', marginLeft: 'auto' }}><option value="">All</option><option>H</option><option>H1</option><option>X</option></select>
          </h2>
          <Table cols={[{ label: 'Time' }, { label: 'Sch' }, { label: 'Drug / batch' }, { label: 'Patient' }, { label: 'Prescriber' }]} empty="Entries are created automatically when Schedule H/H1/X drugs are sold">
            {(regs ?? []).slice(0, 12).map((r) => (
              <tr key={r.id}>
                <td className="small">{dateTime(r.ts)}</td><td><Sched s={r.schedule} /></td>
                <td>{r.brand} × {r.qty} {r.unit}<div className="mono small muted">{r.batches}</div></td>
                <td className="small">{r.patientName} {r.patientAge !== '-' && `(${r.patientAge})`}<div className="muted">{r.patientId}</div></td>
                <td className="small">{r.prescriberName}<div className="muted">{r.prescriberRegNo}</div></td>
              </tr>
            ))}
          </Table>
        </div>
        <div className="card">
          <h2>Recent bills</h2>
          <Table cols={[{ label: 'Bill' }, { label: 'Time' }, { label: 'Items' }, { label: 'Amount', num: true }, { label: 'ms', num: true }]} empty="No bills yet">
            {(sales ?? []).slice(0, 8).map((s) => (
              <tr key={s.id}>
                <td className="mono">{s.billNo}</td><td className="small">{dateTime(s.ts)}</td>
                <td className="small">{s.lines.map((l) => l.brand).join(', ')} {s.overrideReason && <Badge cls="b-amber">override</Badge>}</td>
                <td className="num">{inr(s.totals.amount)}</td><td className="num">{s.computeMs}</td>
              </tr>
            ))}
          </Table>
        </div>
      </div>
    </>
  );
}
