// Developer portal generated from the live OpenAPI spec.
import { useState } from 'react';
import { api } from '../api';
import { Json, Modal, PageHead, Table } from '../components/ui';
import { participants, useApi, useFail, useRef_ } from '../live';

interface Op { tags: string[]; summary: string; parameters: { name: string; in: string; example?: string }[]; requestBody?: { content: { 'application/json': { example: unknown } } } }
interface Spec { paths: Record<string, Record<string, Op>> }

export function Developer() {
  const { entities, products } = useRef_();
  const fail = useFail();
  const { data: spec } = useApi<Spec>('/openapi.json');
  const [tryResult, setTryResult] = useState<{ path: string; body: unknown } | null>(null);
  const base = location.origin + '/api/v1';

  const byTag: Record<string, { path: string; method: string; op: Op }[]> = {};
  for (const [path, methods] of Object.entries(spec?.paths ?? {}))
    for (const [method, op] of Object.entries(methods)) (byTag[op.tags[0]] ??= []).push({ path, method, op });

  const nodes = participants(entities, ['API_MANUFACTURER', 'FORMULATOR', 'STOCKIST', 'PHARMACY', 'HOSPITAL_PHARMACY']);

  return (
    <>
      <PageHead title="Developer API" sub="Open REST + Server-Sent Events so partners, ERPs (Marg / Tally / SAP) and other students can build on the mesh"
        actions={<a className="btn" href="/api/v1/openapi.json" target="_blank" rel="noreferrer">openapi.json</a>} />
      <div className="grid g2">
        <div className="card">
          <h2>Quick start</h2>
          <div className="kv">
            <div>Base URL</div><div className="mono">{base}</div>
            <div>Format</div><div>JSON in / JSON out · errors as <span className="mono">{'{error, details}'}</span></div>
            <div>CORS</div><div>Open (<span className="mono">*</span>)</div>
            <div>Live events</div><div className="mono">GET /api/v1/stream</div>
          </div>
          <h3>curl</h3>
          <pre className="json">{`curl ${base}/tower/state

curl -X POST ${base}/stage3/invoices/quote \\
  -H "Content-Type: application/json" \\
  -d '{"sellerId":"E004","buyerId":"E006","lines":[{"productId":"P001","qty":22}]}'`}</pre>
          <h3>JavaScript (live stream)</h3>
          <pre className="json">{`const es = new EventSource('${base}/stream');
es.addEventListener('epcis', e => console.log(JSON.parse(e.data)));
es.addEventListener('alert', e => console.log(JSON.parse(e.data)));`}</pre>
        </div>
        <div className="card">
          <h2>Entity & product IDs for testing</h2>
          <Table cols={[{ label: 'ID' }, { label: 'Name' }, { label: 'Role' }]}>
            {nodes.map((e) => <tr key={e.id}><td className="mono">{e.id}</td><td>{e.name}</td><td className="small">{e.type}</td></tr>)}
          </Table>
          <h3>Products</h3>
          <div className="small muted">{products.map((p) => <span key={p.id}><span className="mono">{p.id}</span> {p.brand} · </span>)}</div>
        </div>
      </div>

      {Object.entries(byTag).map(([tag, list]) => (
        <div className="card" style={{ marginTop: 14 }} key={tag}>
          <h2>{tag}</h2>
          <Table cols={[{ label: 'Method' }, { label: 'Path' }, { label: 'Description' }, { label: '' }]}>
            {list.map(({ path, method, op }) => {
              const example = op.requestBody?.content['application/json'].example;
              const query = op.parameters.filter((x) => x.in === 'query' && x.example).map((x) => `${x.name}=${x.example}`).join('&');
              const full = path + (query ? '?' + query : '');
              const canTry = method === 'get' && !path.includes('{') && !path.includes('stream');
              return (
                <tr key={method + path}>
                  <td><span className={`method ${method}`}>{method.toUpperCase()}</span></td>
                  <td className="mono">{path}{query && <span className="muted">?{query}</span>}</td>
                  <td className="small">{op.summary}{example !== undefined && <div className="mono muted" style={{ fontSize: 11 }}>{JSON.stringify(example)}</div>}</td>
                  <td>{canTry && <button className="sm" onClick={() => api.get(full).then((body) => setTryResult({ path: full, body })).catch(fail)}>Try</button>}</td>
                </tr>
              );
            })}
          </Table>
        </div>
      ))}

      <Modal open={!!tryResult} onClose={() => setTryResult(null)}><h2>GET {tryResult?.path}</h2><Json value={tryResult?.body} /></Modal>
    </>
  );
}
