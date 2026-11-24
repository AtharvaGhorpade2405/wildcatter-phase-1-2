// Stage 1 · API & bulk drug plant: synthesis ERP, 21 CFR Part 11 eBMR, LIMS, QA/QC Release Agent
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Badge, Field, Modal, PageHead, Table } from '../components/ui';
import { date, dateTime, num } from '../format';
import { participants, useApi, useDebounced, useFail, useRef_, useToast } from '../live';
import type { ApiBatch, InventoryRow } from '../types';

interface DispensingCalc { actualKg: number; potencyFactor: number; lodFactor: number; overageKg: number; formula: string }

const STEPS = ['Dispense (scale capture)', 'QC / LIMS results', 'Maker e-sign', 'Checker e-sign', 'QA/QC Release Agent', 'QA e-sign → Release', 'CoA + GS1-128 drums', 'Ship to Stage 2 (EPCIS)'];

export function Stage1() {
  const { E } = useRef_();
  const toast = useToast();
  const fail = useFail();
  const { data: salts } = useApi<string[]>('/stage1/salts');
  const { data: batches } = useApi<ApiBatch[]>('/stage1/batches');
  const { data: stock } = useApi<InventoryRow[]>('/inventory?entityId=E001&kind=api');
  const [form, setForm] = useState({ salt: 'Amoxicillin', size: 120, th: 80, assay: 98.6, lod: 0.4 });
  const [calc, setCalc] = useState<DispensingCalc | string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const calcInput = useDebounced({ th: form.th, assay: form.assay, lod: form.lod }, 250);
  useEffect(() => {
    let alive = true;
    api.post<DispensingCalc>('/stage1/dispensing/calc', { theoreticalKg: calcInput.th, assayPct: calcInput.assay, lodPct: calcInput.lod })
      .then((r) => alive && setCalc(r)).catch((e) => alive && setCalc(e.message));
    return () => { alive = false; };
  }, [calcInput]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: k === 'salt' ? e.target.value : Number(e.target.value) });

  async function create() {
    try {
      const b = await api.post<ApiBatch>('/stage1/batches', { salt: form.salt, batchSizeKg: form.size, ksmTheoreticalKg: form.th, ksmAssayPct: form.assay, ksmLodPct: form.lod });
      toast(<>Batch <b>{b.batchNo}</b> created · eBMR opened</>, 'ok');
      setOpenId(b.id);
    } catch (e) { fail(e); }
  }

  return (
    <>
      <PageHead title="Stage 1 · API & Bulk Drug Plant" sub={`${E.E001?.name} · Synthesis ERP, 21 CFR Part 11 eBMR, LIMS, QA/QC Release Agent`} />
      <div className="grid g2">
        <div className="card">
          <h2>Open new API batch (eBMR)</h2>
          <div className="fields">
            <Field label="API"><select value={form.salt} onChange={set('salt')}>{salts?.map((s) => <option key={s}>{s}</option>)}</select></Field>
            <Field label="Batch size (kg output)"><input type="number" value={form.size} onChange={set('size')} /></Field>
          </div>
          <h3>KSM dispensing - potency & LOD adjusted</h3>
          <div className="fields">
            <Field label="Theoretical KSM (kg)"><input type="number" value={form.th} onChange={set('th')} /></Field>
            <Field label="Assay / potency (%)"><input type="number" step="0.1" value={form.assay} onChange={set('assay')} /></Field>
            <Field label="Loss on drying (%)"><input type="number" step="0.01" value={form.lod} onChange={set('lod')} /></Field>
          </div>
          <div className="small muted">
            {typeof calc === 'string' ? calc : calc && <>Dispense <b style={{ color: '#fff' }}>{calc.actualKg} kg</b> (potency ×{calc.potencyFactor}, LOD ×{calc.lodFactor}, overage {calc.overageKg} kg) · <span className="mono">{calc.formula}</span></>}
          </div>
          <div className="row end" style={{ marginTop: 10 }}><button className="primary" onClick={create}>Create batch & open eBMR</button></div>
        </div>
        <div className="card">
          <h2>How Stage 1 works in this MVP</h2>
          <div className="steps">{STEPS.map((s) => <span key={s} className="step done">{s}</span>)}</div>
          <p className="muted small">Every action is written to a SHA-256 hash-chained audit trail (ALCOA+). Signatures enforce order and segregation of duties. Out-of-spec results auto-quarantine the batch and draft an OOS Phase I deviation.</p>
          <h3>API stock at plant</h3>
          <Table cols={[{ label: 'API' }, { label: 'Batch' }, { label: 'Qty (kg)', num: true }, { label: '' }]} empty="No released API in stock">
            {(stock ?? []).map((r) => <tr key={r.id}><td>{r.ref}</td><td className="mono">{r.batchNo}</td><td className="num">{num(r.qty, 2)}</td><td>{r.quarantined && <Badge s="quarantined" />}</td></tr>)}
          </Table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2>API batches</h2>
        <Table cols={[{ label: 'Batch' }, { label: 'API' }, { label: 'Size', num: true }, { label: 'Status' }, { label: 'eBMR signatures' }, { label: 'Agent' }, { label: 'Created' }, { label: '' }]}>
          {(batches ?? []).map((b) => (
            <tr key={b.id} className="click" onClick={() => setOpenId(b.id)}>
              <td className="mono">{b.batchNo}</td><td>{b.salt}</td><td className="num">{b.quantityKg} kg</td><td><Badge s={b.status} /></td>
              <td>{(['MAKER', 'CHECKER', 'QA'] as const).map((r) => <span key={r}><Badge cls={b.signatures.some((s) => s.role === r) ? 'b-green' : ''}>{r[0]}</Badge> </span>)}</td>
              <td>{b.agentReport ? <Badge s={b.agentReport.verdict} /> : '-'}</td><td>{dateTime(b.createdAt)}</td><td><button className="sm">Open</button></td>
            </tr>
          ))}
        </Table>
      </div>

      <Modal open={!!openId} onClose={() => setOpenId(null)}>{openId && <BatchDetail id={openId} onClose={() => setOpenId(null)} />}</Modal>
    </>
  );
}

function BatchDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { entities } = useRef_();
  const toast = useToast();
  const fail = useFail();
  const { data: b, reload } = useApi<ApiBatch>(`/stage1/batches/${id}`);
  const [qc, setQc] = useState({ assay: 99.4, lod: 0.2, totalImpurities: 0.35, kfWater: 0.2 });
  const [signer, setSigner] = useState('');
  const formulators = participants(entities, ['FORMULATOR']);
  const [shipTo, setShipTo] = useState(formulators[0]?.id ?? 'E002');
  const [shipKg, setShipKg] = useState(50);

  useEffect(() => { if (b?.qc) setQc({ assay: b.qc.assay, lod: b.qc.lod, totalImpurities: b.qc.totalImpurities, kfWater: b.qc.kfWater }); }, [b?.qc]);
  if (!b) return <div className="muted">Loading…</div>;

  const has = (r: string) => b.signatures.some((s) => s.role === r);
  const nextRole = !has('MAKER') ? 'MAKER' : !has('CHECKER') ? 'CHECKER' : !has('QA') ? 'QA' : null;
  const qcEditable = ['in_process', 'qc_pending'].includes(b.status);
  const act = async (fn: () => Promise<unknown>, msg?: string) => { try { await fn(); if (msg) toast(msg, 'ok'); setSigner(''); reload(); } catch (e) { fail(e); } };
  const qcField = (k: keyof typeof qc, label: string, step: string) => (
    <Field label={label}><input type="number" step={step} value={qc[k]} onChange={(e) => setQc({ ...qc, [k]: Number(e.target.value) })} /></Field>
  );

  return (
    <>
      <h2>{b.batchNo} · {b.salt} API <Badge s={b.status} /></h2>
      <div className="kv">
        <div>Batch size</div><div>{b.quantityKg} kg</div>
        <div>KSM dispensed</div><div>{b.dispensing.actualKg} kg required · {b.dispensing.capturedKg ?? '-'} kg captured ({b.dispensing.scale ?? 'scale'}) {b.dispensing.withinTolerance === false ? <Badge s="FAIL">out of tolerance</Badge> : <Badge s="PASS">within ±0.5%</Badge>}</div>
        <div>Retest date</div><div>{date(b.retestDate)}</div>
        {b.quarantineReason && <><div>Quarantine</div><div style={{ color: '#f87171' }}>{b.quarantineReason}</div></>}
      </div>

      <h3>LIMS · QC results vs specification</h3>
      {b.qcEval ? (
        <Table cols={[{ label: 'Test' }, { label: 'Result', num: true }, { label: 'Spec' }, { label: '' }]}>
          {b.qcEval.tests.map((t) => <tr key={t.key}><td>{t.label}</td><td className="num">{t.value ?? '-'} {t.unit}</td><td>{t.min} – {t.max} {t.unit}</td><td>{t.pass ? <Badge s="PASS" /> : <Badge s="FAIL">OOS</Badge>}</td></tr>)}
        </Table>
      ) : <div className="muted small">No QC results yet.</div>}
      {qcEditable && (
        <>
          <div className="fields" style={{ marginTop: 8 }}>
            {qcField('assay', 'Assay %', '0.1')}{qcField('lod', 'LOD %', '0.01')}{qcField('totalImpurities', 'Total impurities %', '0.01')}{qcField('kfWater', 'KF water %', '0.01')}
          </div>
          <div className="row">
            <button onClick={() => act(() => api.post(`/stage1/batches/${id}/qc`, { ...qc, analyst: 'QC Analyst' }), 'QC results recorded')}>Save QC results</button>
            <button className="ghost sm" onClick={() => setQc({ ...qc, assay: 96.4, totalImpurities: 1.6 })}>Fill an OOS example</button>
            <span className="muted small">Values as parsed from HPLC / KF instruments</span>
          </div>
        </>
      )}

      <h3>eBMR electronic signatures (21 CFR Part 11)</h3>
      <Table cols={[{ label: 'Role' }, { label: 'Signer' }, { label: 'Meaning' }, { label: 'Time' }, { label: 'Signature hash' }]} empty="No signatures yet">
        {b.signatures.map((s) => <tr key={s.role}><td>{s.role}</td><td>{s.user}</td><td>{s.meaning}</td><td>{dateTime(s.ts)}</td><td className="mono">{s.hash.slice(0, 16)}…</td></tr>)}
      </Table>
      {nextRole && !['quarantined', 'released'].includes(b.status) && (
        <div className="row" style={{ marginTop: 8 }}>
          <Badge cls="b-blue">Next: {nextRole}</Badge>
          <input value={signer} onChange={(e) => setSigner(e.target.value)} placeholder="Full name of signer" style={{ maxWidth: 240 }} />
          <button onClick={() => act(() => api.post(`/stage1/batches/${id}/sign`, { role: nextRole, user: signer }), `${nextRole} signature applied`)}>Sign as {nextRole}</button>
        </div>
      )}

      <h3>Autonomous QA/QC Release Agent</h3>
      {b.agentReport ? (
        <div className="card tight">
          <div className="row"><Badge s={b.agentReport.verdict} /><b>{b.agentReport.summary}</b></div>
          {!!b.agentReport.findings?.length && <ul className="small">{b.agentReport.findings.map((f) => <li key={f}>{f}</li>)}</ul>}
          {b.agentReport.deviationDraft && (
            <div className="small"><b>Draft deviation {b.agentReport.deviationDraft.deviationNo}</b> ({b.agentReport.deviationDraft.classification})<br />{b.agentReport.deviationDraft.immediateAction}<br /><i>{b.agentReport.deviationDraft.proposedCapa}</i></div>
          )}
          <div className="muted small">{b.agentReport.agent}</div>
        </div>
      ) : <div className="muted small">Not run yet.</div>}
      {b.qc && !['released', 'quarantined'].includes(b.status) && (
        <div className="row" style={{ marginTop: 8 }}><button className="primary" onClick={() => act(() => api.post(`/stage1/batches/${id}/release-agent`))}>Run QA/QC Release Agent</button></div>
      )}

      {b.status === 'released' && b.coa && (
        <>
          <h3>Digital Certificate of Analysis</h3>
          <div className="card tight small"><div className="kv">
            <div>CoA No</div><div className="mono">{b.coa.coaNo}</div>
            <div>Manufacturer</div><div>{b.coa.manufacturer} · {b.coa.license}</div>
            <div>Pharmacopoeia</div><div>{b.coa.pharmacopoeia}</div>
            <div>Conclusion</div><div><b>{b.coa.conclusion}</b> · released by {b.coa.releasedBy} · {dateTime(b.coa.releasedAt)}</div>
            <div>Signature</div><div className="mono">{b.coa.signatureHash.slice(0, 32)}…</div>
          </div></div>
          <h3>GS1-128 drum labels (SSCC)</h3>
          <div className="mono small">{b.drumLabels.slice(0, 8).map((s) => `(00)${s}`).join(' · ')}{b.drumLabels.length > 8 && ` · +${b.drumLabels.length - 8} more`}</div>
          <h3>Ship to Stage 2 formulator</h3>
          <div className="row">
            <select value={shipTo} onChange={(e) => setShipTo(e.target.value)} style={{ maxWidth: 260 }}>{formulators.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
            <input type="number" value={shipKg} onChange={(e) => setShipKg(Number(e.target.value))} style={{ maxWidth: 120 }} /><span className="muted">kg</span>
            <button className="primary" onClick={async () => {
              try { const s = await api.post<{ asnNo: string }>(`/stage1/batches/${id}/ship`, { toId: shipTo, qtyKg: shipKg }); toast(`Shipped · ${s.asnNo} is on the metro board`, 'ok'); onClose(); } catch (e) { fail(e); }
            }}>Ship with CoA + ASN</button>
          </div>
        </>
      )}
    </>
  );
}
