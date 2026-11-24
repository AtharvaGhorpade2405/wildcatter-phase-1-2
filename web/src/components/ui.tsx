// Small presentational building blocks shared by every page.
import { useEffect, type ReactNode } from 'react';
import type { Schedule, Signal } from '../types';

const STATUS_CLASS: Record<string, string> = {
  in_process: 'b-blue', qc_pending: 'b-amber', released: 'b-green', quarantined: 'b-red', packed: 'b-blue', serialized: 'b-green',
  in_transit: 'b-blue', arrived: 'b-amber', received: 'b-green', verified: 'b-green', unverified: 'b-red', duplicate_suspect: 'b-amber',
  dispatched: 'b-blue', delivered: 'b-green', raised: 'b-amber', PASS: 'b-green', FAIL: 'b-red', HOLD: 'b-amber',
  AUTHENTIC: 'b-green', SUSPECT_COUNTERFEIT: 'b-red', RECALLED: 'b-red', EXPIRED: 'b-red', ALREADY_DISPENSED: 'b-amber',
};

export function Badge({ s, children, cls }: { s?: string; children?: ReactNode; cls?: string }) {
  return <span className={`badge ${cls ?? STATUS_CLASS[s ?? ''] ?? ''}`}>{children ?? String(s ?? '').replace(/_/g, ' ')}</span>;
}

export function Sched({ s }: { s: Schedule }) {
  const cls = s === 'X' ? 'b-red' : s === 'H1' ? 'b-amber' : s === 'H' ? 'b-violet' : '';
  return <span className={`badge ${cls}`}>{s === 'OTC' ? 'OTC' : `Sch ${s}`}</span>;
}

export const Sig = ({ s }: { s: Signal }) => <span className={`sig ${s}`} />;

export function ExpBadge({ days }: { days: number }) {
  if (days < 0) return <Badge cls="b-red">expired</Badge>;
  const cls = days <= 30 ? 'b-red' : days <= 90 ? 'b-amber' : days <= 180 ? 'b-blue' : '';
  return <Badge cls={cls}>{days}d</Badge>;
}

export interface Col { label: string; num?: boolean }

export function Table({ cols, children, empty = 'Nothing here yet' }: { cols: Col[]; children: ReactNode[]; empty?: string }) {
  return (
    <div className="tbl-wrap">
      <table>
        <thead><tr>{cols.map((c, i) => <th key={i} className={c.num ? 'num' : ''}>{c.label}</th>)}</tr></thead>
        <tbody>{children.length ? children : <tr><td colSpan={cols.length} className="empty">{empty}</td></tr>}</tbody>
      </table>
    </div>
  );
}

export function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div id="modal-bg" className="open" onClick={(e) => (e.target as HTMLElement).id === 'modal-bg' && onClose()}>
      <div id="modal"><button className="x ghost sm" onClick={onClose}>✕</button>{children}</div>
    </div>
  );
}

export function PageHead({ title, sub, actions }: { title: string; sub: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1><p>{sub}</p></div>
      <div className="row">{actions}</div>
    </div>
  );
}

export function Kpis({ items }: { items: [string, number, string?][] }) {
  return (
    <div className="kpis">
      {items.map(([label, value, cls]) => (
        <div key={label} className={`kpi ${cls ?? ''}`}><div className="v">{Number(value).toLocaleString('en-IN')}</div><div className="l">{label}</div></div>
      ))}
    </div>
  );
}

export function Bar({ pct }: { pct: number }) {
  return <div className="bar"><i style={{ width: `${Math.round(pct * 100)}%` }} /></div>;
}

/** Temperature sparkline with the 2–8 °C band shaded. */
export function Spark({ vals, w = 90, h = 22, lo = 0, hi = 16 }: { vals: number[]; w?: number; h?: number; lo?: number; hi?: number }) {
  if (!vals || vals.length < 2) return null;
  const v = vals.slice(-40);
  const y = (t: number) => h - ((Math.min(hi, Math.max(lo, t)) - lo) / (hi - lo)) * h;
  const pts = v.map((t, i) => `${(i / (v.length - 1)) * w},${y(t)}`).join(' ');
  return (
    <svg className="spark" width={w} height={h}>
      <rect x="0" y={y(8)} width={w} height={y(2) - y(8)} fill="rgba(34,197,94,.12)" />
      <polyline fill="none" stroke="#38bdf8" strokeWidth="1.5" points={pts} />
    </svg>
  );
}

export function Field({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return <div className={`field ${className ?? ''}`}><label>{label}</label>{children}</div>;
}

export function Json({ value }: { value: unknown }) {
  return <pre className="json">{JSON.stringify(value, null, 2)}</pre>;
}
