// Module 6 · National Pharma Entity Data Lake
import { useEffect, useState } from 'react';
import { api, qs } from '../api';
import { Badge, Field, Kpis, PageHead, Table } from '../components/ui';
import { useApi, useDebounced, useFail, useToast } from '../live';
import type { Entity, EntityType } from '../types';

const TYPES: EntityType[] = ['API_MANUFACTURER', 'FORMULATOR', 'CNF_AGENT', 'STOCKIST', 'PHARMACY', 'HOSPITAL_PHARMACY'];

interface Stats { total: number; participants: number; byVerification: Record<string, number>; byState: Record<string, number> }
interface GstinCheck { valid: boolean; errors: string[]; state: string | null; pan: string | null }
interface HarvestResult { agent: string; discovered: number; verified: number; unverified: number; duplicateSuspects: number; exactDuplicatesMerged: number }

export function DataLake() {
  const toast = useToast();
  const fail = useFail();
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [ver, setVer] = useState('');
  const dSearch = useDebounced(search, 200);
  const { data: stats } = useApi<Stats>('/entities/stats');
  const { data: list } = useApi<Entity[]>(`/entities${qs({ q: dSearch, type, verification: ver })}`);

  const [form, setForm] = useState({ name: '', type: 'PHARMACY' as EntityType, gstin: '', licenseNo: '', city: '' });
  const [check, setCheck] = useState<GstinCheck | null>(null);
  const [count, setCount] = useState(8);
  const [harvest, setHarvest] = useState<HarvestResult | null>(null);

  const dGstin = useDebounced(form.gstin.trim(), 250);
  useEffect(() => {
    if (!dGstin) { setCheck(null); return; }
    api.post<GstinCheck>('/entities/validate-gstin', { gstin: dGstin }).then(setCheck).catch(() => setCheck(null));
  }, [dGstin]);

  async function add() {
    try {
      const r = await api.post<{ status: string; message?: string; entity: Entity }>('/entities', form);
      toast(r.status === 'duplicate' ? `Duplicate - ${r.message}` : `Added ${r.entity.name} · ${r.status}`, r.status === 'verified' ? 'ok' : 'warn');
    } catch (e) { fail(e); }
  }
  async function runSwarm() {
    try { setHarvest(await api.post<HarvestResult>('/datalake/harvest', { count })); } catch (e) { fail(e); }
  }
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <>
      <PageHead title="National Pharma Entity Data Lake" sub="Golden records for every manufacturer, C&F, stockist and pharmacy - GSTIN checksum verified, de-duplicated"
        actions={<><input type="number" value={count} onChange={(e) => setCount(Number(e.target.value))} style={{ width: 70 }} /><button className="primary" onClick={runSwarm}>Run discovery swarm</button></>} />
      {stats && (
        <Kpis items={[
          ['Golden records', stats.total], ['Verified', stats.byVerification.verified || 0, 'green'], ['Unverified', stats.byVerification.unverified || 0, 'red'],
          ['Duplicate suspects', stats.byVerification.duplicate_suspect || 0, 'amber'], ['On network', stats.participants], ['States', Object.keys(stats.byState).length],
        ]} />
      )}
      <div className="grid g-tower">
        <div className="card">
          <div className="row" style={{ marginBottom: 8 }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, city, GSTIN, licence…" style={{ flex: 2 }} />
            <select value={type} onChange={(e) => setType(e.target.value)} style={{ flex: 1 }}><option value="">All types</option>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
            <select value={ver} onChange={(e) => setVer(e.target.value)} style={{ flex: 1 }}><option value="">All statuses</option><option value="verified">verified</option><option value="unverified">unverified</option><option value="duplicate_suspect">duplicate suspect</option></select>
          </div>
          <Table cols={[{ label: 'Entity' }, { label: 'Type' }, { label: 'GSTIN' }, { label: 'Licence' }, { label: 'Source' }, { label: 'Status' }]}>
            {(list ?? []).slice().reverse().slice(0, 150).map((e) => (
              <tr key={e.id}>
                <td><b>{e.name}</b>{e.participant && <> <Badge cls="b-blue">network</Badge></>}<div className="muted small">{e.city}, {e.state}</div></td>
                <td className="small">{e.type.replace(/_/g, ' ')}</td><td className="mono">{e.gstin}</td><td className="small">{e.licenseNo || '-'}</td>
                <td className="small muted">{e.source}</td><td><Badge s={e.verification} />{e.verificationNote && <div className="muted small">{e.verificationNote}</div>}</td>
              </tr>
            ))}
          </Table>
        </div>
        <div className="stack">
          <div className="card">
            <h2>Add / verify entity</h2>
            <Field label="Name"><input value={form.name} onChange={set('name')} /></Field>
            <Field label="Type"><select value={form.type} onChange={set('type')}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
            <Field label="GSTIN"><input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })} placeholder="27AAPFS6610D1Z…" /></Field>
            {check && (
              <div className="small" style={{ margin: '-4px 0 8px' }}>
                {check.valid ? <><Badge s="verified">valid</Badge> {check.state} · PAN {check.pan}</> : <><Badge s="unverified">invalid</Badge> {check.errors.join('; ')}</>}
              </div>
            )}
            <Field label="Drug licence (Form 20/21/25/28)"><input value={form.licenseNo} onChange={set('licenseNo')} /></Field>
            <Field label="City"><input value={form.city} onChange={set('city')} /></Field>
            <button className="primary" onClick={add}>Add to golden record</button>
          </div>
          <div className="card">
            <h2>Last swarm run</h2>
            <div className="small muted">
              {harvest ? (
                <><b>{harvest.agent}</b><br />Discovered {harvest.discovered} · <Badge s="verified">{harvest.verified} verified</Badge> <Badge s="unverified">{harvest.unverified} unverified</Badge> <Badge s="duplicate_suspect">{harvest.duplicateSuspects} dup suspects</Badge> <Badge>{harvest.exactDuplicatesMerged} merged</Badge></>
              ) : 'Discovery agents mine CDSCO, State FDA, GST, AIOCD and Pharmacy Council sources (simulated in this MVP), verify GSTIN checksums and de-duplicate.'}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
