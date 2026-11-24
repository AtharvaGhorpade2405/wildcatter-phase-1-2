// GS1 EPCIS 2.0 event repository + hash-chained 21 CFR Part 11 audit trail
import { useState } from 'react';
import { api, qs } from '../api';
import { Badge, Json, Modal, PageHead, Table } from '../components/ui';
import { dateTime } from '../format';
import { useApi, useDebounced } from '../live';
import type { AuditRecord, EpcisEvent } from '../types';

const BIZ_STEPS = ['commissioning', 'packing', 'shipping', 'arriving', 'receiving', 'dispensing', 'holding', 'sensor_reporting', 'creating_class_instance', 'staging_outbound'];

interface ChainCheck { valid: boolean; records: number; brokenAt?: number; reason?: string }

export function Epcis() {
  const [batch, setBatch] = useState('');
  const [step, setStep] = useState('');
  const [open, setOpen] = useState<EpcisEvent | null>(null);
  const [chain, setChain] = useState<ChainCheck | null>(null);
  const dBatch = useDebounced(batch.trim(), 250);
  const { data: events } = useApi<EpcisEvent[]>(`/epcis/events${qs({ batchNo: dBatch, bizStep: step, limit: 150 })}`);
  const { data: audit } = useApi<AuditRecord[]>('/audit?limit=120');

  return (
    <>
      <PageHead title="GS1 EPCIS 2.0 Mesh & 21 CFR Part 11 Audit Trail" sub="Every physical and statutory event, standardised and tamper-evident" />
      <div className="card">
        <h2>EPCIS events <span className="spacer" />
          <input value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="Filter by batch" style={{ width: 180 }} />
          <select value={step} onChange={(e) => setStep(e.target.value)} style={{ width: 'auto' }}><option value="">All bizSteps</option>{BIZ_STEPS.map((s) => <option key={s}>{s}</option>)}</select>
        </h2>
        <Table cols={[{ label: 'Time' }, { label: 'Type' }, { label: 'bizStep' }, { label: 'Disposition' }, { label: 'Batch' }, { label: 'Summary' }]} empty="No events yet - ship something">
          {(events ?? []).map((e) => (
            <tr key={e.eventID} className="click" onClick={() => setOpen(e)}>
              <td className="small">{dateTime(e.eventTime)}</td><td className="small">{e.type}</td><td><Badge cls="b-blue">{e.bizStep}</Badge></td>
              <td><Badge cls={['recalled', 'damaged'].includes(e.disposition) ? 'b-red' : ''}>{e.disposition}</Badge></td>
              <td className="mono">{e['pcx:batchNo'] ?? ''}</td><td className="small">{e['pcx:summary']}</td>
            </tr>
          ))}
        </Table>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <h2>Audit trail (SHA-256 hash chain) <span className="spacer" />
          {chain && (chain.valid ? <Badge s="PASS">✓ {chain.records} records intact</Badge> : <Badge s="FAIL">Broken at #{chain.brokenAt}: {chain.reason}</Badge>)}
          <button onClick={() => api.get<ChainCheck>('/audit/verify').then(setChain)}>Verify chain integrity</button>
        </h2>
        <Table cols={[{ label: '#' }, { label: 'Time' }, { label: 'User' }, { label: 'Action' }, { label: 'Ref' }, { label: 'Hash' }, { label: 'Prev' }]}>
          {(audit ?? []).map((a) => (
            <tr key={a.seq}>
              <td className="num">{a.seq}</td><td className="small">{dateTime(a.ts)}</td><td className="small">{a.user}</td><td><Badge>{a.action}</Badge></td>
              <td className="mono">{a.ref ?? ''}</td><td className="mono small">{a.hash.slice(0, 12)}…</td><td className="mono small muted">{a.prevHash.slice(0, 12)}…</td>
            </tr>
          ))}
        </Table>
      </div>
      <Modal open={!!open} onClose={() => setOpen(null)}><h2>EPCIS 2.0 event (JSON-LD)</h2><Json value={open} /></Modal>
    </>
  );
}
