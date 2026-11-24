// Live data layer: SSE connection to the mesh, reference data, toasts, and a refetching data hook.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';
import type { Entity, EntityType, Product } from './types';

interface LiveState {
  connected: boolean;
  version: number; // bumps on every server-side change (debounced)
  tick: number; // bumps on every simulation tick (~1 s)
}
interface RefData {
  products: Product[];
  P: Record<string, Product>;
  entities: Entity[];
  E: Record<string, Entity>;
}
type ToastType = 'info' | 'ok' | 'warn' | 'err';
interface Toast { id: number; type: ToastType; body: ReactNode }

const LiveCtx = createContext<LiveState>({ connected: false, version: 0, tick: 0 });
const RefCtx = createContext<RefData>({ products: [], P: {}, entities: [], E: {} });
const ToastCtx = createContext<(body: ReactNode, type?: ToastType, ms?: number) => void>(() => {});

export const useLive = () => useContext(LiveCtx);
export const useRef_ = () => useContext(RefCtx);
export const useToast = () => useContext(ToastCtx);

/** Toast helper for caught API errors. */
export function useFail() {
  const toast = useToast();
  return useCallback((e: unknown) => {
    const err = e as ApiError;
    toast(<><b>{err.status || 'Error'}</b> {err.message}</>, 'err', 6000);
  }, [toast]);
}

export function participants(entities: Entity[], types: EntityType[]) {
  return entities.filter((e) => e.participant && types.includes(e.type));
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const [live, setLive] = useState<LiveState>({ connected: false, version: 0, tick: 0 });
  const [ref, setRef] = useState<RefData | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [bootError, setBootError] = useState<string | null>(null);
  const nextId = useRef(1);

  const toast = useCallback((body: ReactNode, type: ToastType = 'info', ms = 4200) => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, type, body }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
  }, []);

  const loadRef = useCallback(async () => {
    const [products, entities] = await Promise.all([api.get<Product[]>('/products'), api.get<Entity[]>('/entities')]);
    setRef({ products, P: Object.fromEntries(products.map((p) => [p.id, p])), entities, E: Object.fromEntries(entities.map((e) => [e.id, e])) });
  }, []);

  useEffect(() => {
    loadRef().catch((e) => setBootError(e.message));
    const es = new EventSource('/api/v1/stream');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bump = () => { clearTimeout(timer); timer = setTimeout(() => setLive((s) => ({ ...s, version: s.version + 1 })), 300); };
    es.addEventListener('hello', () => setLive((s) => ({ ...s, connected: true })));
    es.addEventListener('tick', () => setLive((s) => ({ ...s, tick: s.tick + 1 })));
    es.addEventListener('change', (m) => {
      const msg = JSON.parse((m as MessageEvent).data);
      if (msg.what === 'reset' || msg.what === 'entity') loadRef().then(bump); else bump();
    });
    es.addEventListener('alert', (m) => {
      const a = JSON.parse((m as MessageEvent).data).alert;
      if (a.level === 'red') toast(<>🚨 <b>{a.title}</b><br /><span className="small">{a.detail}</span></>, 'err', 7000);
    });
    es.onerror = () => setLive((s) => ({ ...s, connected: false }));
    return () => { es.close(); clearTimeout(timer); };
  }, [loadRef, toast]);

  if (bootError) return <div className="card" style={{ margin: 20 }}>Cannot reach the API server: {bootError}</div>;
  if (!ref) return <div className="muted" style={{ margin: 20 }}>Loading PharmaChain OS…</div>;

  return (
    <LiveCtx.Provider value={live}>
      <RefCtx.Provider value={ref}>
        <ToastCtx.Provider value={toast}>
          {children}
          <div id="toasts">{toasts.map((t) => <div key={t.id} className={`toast ${t.type}`}>{t.body}</div>)}</div>
        </ToastCtx.Provider>
      </RefCtx.Provider>
    </LiveCtx.Provider>
  );
}

/**
 * Fetch `path` and refetch whenever the server reports a change (or every tick if `onTick`).
 * Pass `null` to skip fetching.
 */
export function useApi<T>(path: string | null, opts: { onTick?: boolean } = {}) {
  const { version, tick } = useLive();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(0);
  const trigger = opts.onTick ? tick : 0;
  useEffect(() => {
    if (!path) return;
    let alive = true;
    api.get<T>(path).then((d) => { if (alive) { setData(d); setError(null); } }).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [path, version, trigger, manual]);
  return { data, error, reload: () => setManual((n) => n + 1) };
}

/** Debounced value. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
