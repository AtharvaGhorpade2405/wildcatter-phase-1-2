// Inbound ASN list + zero-typing scan-verify GRN, shared by Stage 3 and Stage 4.
import { useState } from 'react';
import { api } from '../api';
import { useFail, useToast } from '../live';
import type { Shipment } from '../types';
import { Badge, Bar, Modal, Sig, Table } from './ui';

export function Inbound({ ships }: { ships: Shipment[] }) {
  const [open, setOpen] = useState<Shipment | null>(null);
  const rows = ships.filter((s) => s.status !== 'received' || (s.receivedAt && Date.now() - new Date(s.receivedAt).getTime() < 3600e3)).slice(0, 12);
  return (
    <>
      <Table cols={[{ label: 'ASN' }, { label: 'From' }, { label: 'Cargo' }, { label: 'Status' }, { label: '' }]} empty="No inbound shipments">
        {rows.map((s) => (
          <tr key={s.id}>
            <td><Sig s={s.signal} /><b>{s.asnNo}</b>{s.coldChain && ' ❄'}</td>
            <td className="small">{s.fromName}</td>
            <td className="small">{s.itemsLabel}</td>
            <td><Badge s={s.status} />{s.status === 'in_transit' && <div style={{ marginTop: 4 }}><Bar pct={s.progress} /></div>}</td>
            <td>{s.status === 'arrived' && <button className="sm primary" onClick={() => setOpen(s)}>Scan & inward</button>}</td>
          </tr>
        ))}
      </Table>
      <Modal open={!!open} onClose={() => setOpen(null)}>{open && <ScanReceive shipment={open} onDone={() => setOpen(null)} />}</Modal>
    </>
  );
}

function ScanReceive({ shipment: s, onDone }: { shipment: Shipment; onDone: () => void }) {
  const toast = useToast();
  const fail = useFail();
  const [scanned, setScanned] = useState<Set<string>>(new Set());
  const [input, setInput] = useState('');

  function scan() {
    const v = input.replace(/^\(00\)/, '').trim();
    if (s.ssccs.includes(v)) setScanned(new Set(scanned).add(v));
    else toast(`Unknown SSCC ${v} - not on this ASN`, 'err');
    setInput('');
  }
  async function post() {
    try {
      const r = await api.post<{ shipment: Shipment }>(`/shipments/${s.id}/receive`, { scanned: [...scanned] });
      toast(`GRN posted · ${r.shipment.itemsLabel}`, 'ok');
      onDone();
    } catch (e) { fail(e); }
  }

  return (
    <>
      <h2>Scan-verify inward · {s.asnNo}</h2>
      <p className="muted small">Zero-typing inwarding: scan every SSCC on the delivery. The system checks the ASN, VRS (batch genuine & not recalled) and only then posts stock.</p>
      <div className="row">
        <input autoFocus value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && scan()} placeholder="Scan / paste SSCC and press Enter" style={{ flex: 1 }} />
        <button onClick={() => setScanned(new Set(s.ssccs))}>Simulate scanner (scan all)</button>
      </div>
      <div className="mono small" style={{ marginTop: 10 }}>{s.ssccs.map((x) => <div key={x}>{scanned.has(x) ? '✅' : '⬜'} (00){x}</div>)}</div>
      <div className="row end" style={{ marginTop: 10 }}>
        <span className="muted">{scanned.size} / {s.ssccs.length} scanned</span>
        <button className="primary" onClick={post}>Post GRN</button>
      </div>
    </>
  );
}
