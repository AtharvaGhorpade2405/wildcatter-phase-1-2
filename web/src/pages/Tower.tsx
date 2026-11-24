// Module 5 · Metro-Line Active Control Tower
import { useState } from 'react';
import { api } from '../api';
import { MetroBoard } from '../components/MetroBoard';
import { Badge, Bar, Field, Kpis, Modal, PageHead, Sig } from '../components/ui';
import { dateTime, num } from '../format';
import { useApi, useFail, useToast } from '../live';
import type { ApiBatch, FgBatch, TowerState, Train } from '../types';

const SUGGESTIONS = ['show red signals', 'any delays?', 'trace APB2611001', 'near expiry', 'stockout risk', 'where is Atorva stock?', 'quarantined batches'];

interface CopilotAnswer { answer: string; action?: { type: 'quarantine'; batchNo: string } }

export function Tower() {
  const { data: state } = useApi<TowerState>('/tower/state', { onTick: true });
  const { data: apiBatches } = useApi<ApiBatch[]>('/stage1/batches');
  const { data: fgBatches } = useApi<FgBatch[]>('/stage2/batches');
  const toast = useToast();
  const fail = useFail();
  const [selected, setSelected] = useState<string | null>(null);
  const [batchNo, setBatchNo] = useState('');
  const [reason, setReason] = useState('Market complaint - suspected contamination');
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState<CopilotAnswer | null>(null);
  const [demoLog, setDemoLog] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const train = state?.trains.find((t) => t.id === selected) ?? null;

  async function ask(q: string) {
    setQuery(q);
    setAnswer({ answer: 'Thinking…' });
    try { setAnswer(await api.post<CopilotAnswer>('/tower/copilot', { query: q })); } catch (e) { setAnswer({ answer: (e as Error).message }); }
  }

  async function pullBrake(target = batchNo) {
    if (!target.trim()) return toast('Enter a batch number', 'warn');
    if (!confirm(`Quarantine ${target} network-wide?\nAll stock is frozen and trains carrying it are halted.`)) return;
    try {
      const r = await api.post<{ cascade: string[]; inventoryRowsFrozen: number; shipmentsHalted: number }>('/tower/quarantine', { batchNo: target.trim(), reason });
      toast(<>🛑 Quarantined <b>{r.cascade.join(', ')}</b> · {r.inventoryRowsFrozen} stock locations · {r.shipmentsHalted} trains halted</>, 'err', 8000);
    } catch (e) { fail(e); }
  }

  async function runDemo() {
    setBusy(true);
    try { setDemoLog((await api.post<{ log: string[] }>('/demo/scenario')).log); } catch (e) { fail(e); }
    setBusy(false);
  }

  async function reset() {
    if (!confirm('Reset all demo data to the seeded state?')) return;
    await api.post('/demo/reset');
    setSelected(null);
    toast('Demo data reset', 'ok');
  }

  const k = state?.kpis;

  return (
    <>
      <PageHead
        title="Metro-Line Active Control Tower"
        sub="Every serialized batch and e-Way Bill shipment, live across all four stages. Click a train for details."
        actions={<><button className="primary" onClick={runDemo} disabled={busy}>▶ Run end-to-end demo</button><button className="ghost" onClick={reset}>Reset data</button></>}
      />
      {k && (
        <Kpis items={[
          ['In transit', k.inTransit], ['Green', k.green, 'green'], ['Amber', k.amber, 'amber'], ['Red', k.red, 'red'],
          ['Quarantined batches', k.quarantinedBatches, k.quarantinedBatches ? 'red' : ''], ['Lots ≤ 90d expiry', k.nearExpiryLots, 'amber'],
          ['Data-lake entities', k.entities], ['EPCIS events', k.epcisEvents],
        ]} />
      )}

      <div className="grid g-tower">
        <div className="stack">
          <div className="card tower-card">
            <div className="tower-head">
              <b>Signal board</b>
              <span className="legend"><span><Sig s="green" />Clear</span><span><Sig s="amber" />Dwell / near-expiry / transient excursion</span><span><Sig s="red" />Cold-chain excursion / OOS / recall</span></span>
              <span className="spacer" />
              <span className="legend">{state?.categories.map((c) => <span key={c.id}><i style={{ background: c.color }} />{c.name}</span>)}</span>
            </div>
            <MetroBoard state={state} selected={selected} onSelect={(t) => setSelected(t?.id ?? null)} />
          </div>
          <div className="card">
            <h2>Alerts</h2>
            <div className="alerts">
              {state?.alerts.length ? state.alerts.map((a) => (
                <div className="alert" key={a.id}><Sig s={a.level} /><div><div className="t">{a.title}</div><div className="d">{a.detail} · {dateTime(a.ts)}</div></div></div>
              )) : <div className="empty">No alerts</div>}
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <h2>🛑 Emergency Quarantine Recall Brake</h2>
            <Field label="Batch number (API batches cascade to every downstream FG batch)">
              <input value={batchNo} onChange={(e) => setBatchNo(e.target.value)} placeholder="e.g. APB2611001" list="batch-list" />
              <datalist id="batch-list">{[...(apiBatches ?? []), ...(fgBatches ?? [])].map((b) => <option key={b.id} value={b.batchNo} />)}</datalist>
            </Field>
            <Field label="Reason"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <button className="brake" onClick={() => pullBrake()}>PULL RECALL BRAKE</button>
            <div className="small" style={{ marginTop: 10 }}>
              {state?.quarantined.length ? (
                <><b>Under quarantine: </b>{state.quarantined.map((q) => (
                  <span key={q.batchNo}><Badge cls="b-red">{q.batchNo}</Badge>{' '}
                    <button className="sm ghost" onClick={() => api.post('/tower/lift-quarantine', { batchNo: q.batchNo, reason: 'QA investigation closed - no impact' }).then(() => toast('Quarantine lifted', 'ok')).catch(fail)}>lift</button>{' '}
                  </span>
                ))}</>
              ) : <span className="muted">No batches under quarantine.</span>}
            </div>
          </div>

          <div className="card">
            <h2>🤖 Control Room Copilot</h2>
            <div className="row">
              <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ask(query)} placeholder="Ask: show red signals, trace a batch…" style={{ flex: 1 }} />
              <button onClick={() => ask(query)}>Ask</button>
            </div>
            <div className="chips">{SUGGESTIONS.map((c) => <span key={c} className="chip" onClick={() => ask(c)}>{c}</span>)}</div>
            <div className="copilot-out">
              {answer ? answer.answer : 'Ask about any batch, shipment, signal or stock position.'}
              {answer?.action && <div style={{ marginTop: 8 }}><button className="sm danger" onClick={() => setBatchNo(answer.action!.batchNo)}>Stage recall for {answer.action.batchNo}</button></div>}
            </div>
          </div>

          <TrainCard train={train} onQuarantine={(b) => { setBatchNo(b); pullBrake(b); }} onTrace={(b) => ask('trace ' + b)} />
        </div>
      </div>

      <Modal open={!!demoLog} onClose={() => setDemoLog(null)}>
        <h2>End-to-end demo running</h2>
        <p className="muted">New trains are now moving through all four stages and will auto scan-verify on arrival.</p>
        <ol>{demoLog?.map((l, i) => <li key={i}>{l}</li>)}</ol>
        <button className="primary" onClick={() => setDemoLog(null)}>Watch the board</button>
      </Modal>
    </>
  );
}

function TrainCard({ train: t, onQuarantine, onTrace }: { train: Train | null; onQuarantine: (b: string) => void; onTrace: (b: string) => void }) {
  const toast = useToast();
  const fail = useFail();
  if (!t) return <div className="card"><h2>Selected train</h2><div className="muted small">Click a train on the board.</div></div>;
  return (
    <div className="card">
      <h2><Sig s={t.signal} /> {t.asnNo} <Badge s={t.status} /></h2>
      <div className="kv">
        <div>Route</div><div>{t.fromName} → {t.toName}</div>
        <div>Progress</div><div><Bar pct={t.progress} /></div>
        <div>Cargo</div><div>{t.items.map((i) => <div key={i.batchNo}>{i.label} · <b>{i.batchNo}</b> · {num(i.qty, 2)} {i.uom}</div>)}</div>
        {t.coldChain && <><div>Cold chain</div><div>Last {t.lastTemp ?? '-'} °C · MKT <b>{t.mkt ?? '-'} °C</b></div></>}
        {t.ewayBill && <><div>e-Way Bill</div><div className="mono">{t.ewayBill}</div></>}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        {t.items.map((i) => <button key={i.batchNo} className="sm danger" onClick={() => onQuarantine(i.batchNo)}>Quarantine {i.batchNo}</button>)}
        {t.coldChain && t.status === 'in_transit' && (
          <button className="sm" onClick={() => api.post(`/shipments/${t.id}/inject-excursion`).then(() => toast('Excursion injected - watch MKT climb', 'warn')).catch(fail)}>Inject excursion</button>
        )}
        <button className="sm" onClick={() => onTrace(t.items[0].batchNo)}>Trace</button>
      </div>
    </div>
  );
}
