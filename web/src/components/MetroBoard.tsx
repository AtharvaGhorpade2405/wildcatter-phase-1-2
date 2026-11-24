// Metro-Line signal board: Canvas 2D at 60 FPS, interpolating train positions between server ticks.
import { useEffect, useRef } from 'react';
import type { TowerState, Train } from '../types';

const SIG_COLOR = { green: '#22c55e', amber: '#f59e0b', red: '#ef4444' } as const;

interface Hit { x: number; y: number; w: number; h: number; train: Train }

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function MetroBoard({ state, selected, onSelect }: { state: TowerState | null; selected: string | null; onSelect: (t: Train | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Mutable render state lives in a ref so the animation loop never re-subscribes.
  const r = useRef({ state, received: performance.now(), selected, hover: null as string | null, hits: [] as Hit[], w: 0, h: 0 });

  useEffect(() => { r.current.state = state; r.current.received = performance.now(); }, [state]);
  useEffect(() => { r.current.selected = selected; }, [selected]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      r.current.w = rect.width; r.current.h = rect.height;
      canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const pos = (e: MouseEvent) => { const b = canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
    const hitTest = (p: { x: number; y: number }) => r.current.hits.find((h) => p.x >= h.x - 4 && p.x <= h.x + h.w + 4 && p.y >= h.y - 4 && p.y <= h.y + h.h + 4);
    const onClick = (e: MouseEvent) => onSelectRef.current(hitTest(pos(e))?.train ?? null);
    const onMove = (e: MouseEvent) => { const h = hitTest(pos(e)); r.current.hover = h ? h.train.id : null; canvas.style.cursor = h ? 'pointer' : 'crosshair'; };

    const draw = () => {
      const { w, h, state: s } = r.current;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#050913'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(56,189,248,0.04)'; ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 24) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = 0; y < h; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      if (!s) { ctx.fillStyle = '#8ea0bf'; ctx.font = '13px system-ui'; ctx.fillText('Connecting to control tower…', 20, 30); raf = requestAnimationFrame(draw); return; }

      const narrow = w < 640;
      const left = narrow ? 18 : 150, right = narrow ? 18 : 84, top = 70, bottom = narrow ? 70 : 64;
      const cats = s.categories;
      const gap = (h - top - bottom) / Math.max(1, cats.length - 1);
      const cols = [0, 1, 2, 3].map((i) => left + (i * (w - left - right)) / 3);
      const lineY: Record<string, number> = {};
      cats.forEach((c, i) => { lineY[c.id] = top + i * gap; });
      const now = performance.now();

      // tracks
      for (const c of cats) {
        ctx.strokeStyle = c.color; ctx.lineWidth = 6; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(cols[0], lineY[c.id]); ctx.lineTo(cols[3], lineY[c.id]); ctx.stroke();
        if (!narrow) { ctx.fillStyle = c.color; ctx.font = '600 11px system-ui'; ctx.textAlign = 'right'; ctx.fillText(c.name, cols[0] - 24, lineY[c.id] + 4); }
      }

      // stations (interchange capsules spanning every line)
      const yTop = lineY[cats[0].id] - 16, yBot = lineY[cats[cats.length - 1].id] + 16;
      s.stations.forEach((st, i) => {
        const x = cols[i];
        ctx.fillStyle = '#0b1020'; ctx.strokeStyle = '#e6ecf7'; ctx.lineWidth = 3;
        roundRect(ctx, x - 13, yTop, 26, yBot - yTop, 13); ctx.fill(); ctx.stroke();
        for (const c of cats) { ctx.beginPath(); ctx.fillStyle = '#e6ecf7'; ctx.arc(x, lineY[c.id], 4, 0, Math.PI * 2); ctx.fill(); }
        ctx.textAlign = i === 0 && narrow ? 'left' : i === 3 ? 'right' : 'center';
        const tx = i === 0 && narrow ? x - 10 : i === 3 ? x + 16 : x;
        ctx.fillStyle = '#e6ecf7'; ctx.font = '700 12px system-ui';
        ctx.fillText(narrow ? `S${i + 1}` : st.label, tx, yTop - 26);
        ctx.fillStyle = '#8ea0bf'; ctx.font = '11px system-ui';
        if (!narrow) ctx.fillText(st.entities.map((e) => e.name.split(' ')[0]).join(' · '), tx, yTop - 11);
        ctx.fillText(`${st.entities.length} node${st.entities.length === 1 ? '' : 's'}`, tx, yBot + 18);
      });

      // trains
      const hits: Hit[] = [];
      const slot: Record<string, number> = {};
      const blink = Math.floor(now / 450) % 2 === 0;
      for (const t of s.trains) {
        let p = t.progress;
        if (t.status === 'in_transit') p = Math.min(1, p + (now - r.current.received) / (t.durationMs || 45000));
        const x0 = cols[t.fromStage], x1 = cols[t.toStage];
        let x = x0 + (x1 - x0) * p;
        const key = `${t.category}:${Math.round(x / 40)}`;
        const n = (slot[key] = (slot[key] || 0) + 1) - 1;
        const y = (lineY[t.category] ?? lineY[cats[0].id]) + (n === 0 ? 0 : n % 2 ? -14 * Math.ceil(n / 2) : 14 * (n / 2));
        const tw = 30, th = 13;
        if (t.status === 'arrived') x = x1 - 22; // dwelling at the platform
        const color = SIG_COLOR[t.signal] ?? SIG_COLOR.green;
        const dim = t.signal === 'red' && !blink;
        ctx.save();
        ctx.shadowColor = color; ctx.shadowBlur = dim ? 4 : 16;
        ctx.fillStyle = dim ? color + '55' : color;
        roundRect(ctx, x - tw / 2, y - th / 2, tw, th, 6); ctx.fill();
        ctx.restore();
        if (r.current.selected === t.id || r.current.hover === t.id) {
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; roundRect(ctx, x - tw / 2 - 3, y - th / 2 - 3, tw + 6, th + 6, 8); ctx.stroke();
        }
        ctx.fillStyle = '#04101f'; ctx.font = '700 9px system-ui'; ctx.textAlign = 'center';
        ctx.fillText(t.coldChain ? '❄' : '▶', x, y + 3);
        if (!narrow || r.current.selected === t.id) {
          ctx.fillStyle = '#cbd5e1'; ctx.font = '10px system-ui';
          ctx.fillText(t.asnNo + (t.status === 'arrived' ? ' · dwell' : t.status === 'quarantined' ? ' · HALT' : ''), x, y - 11);
        }
        hits.push({ x: x - tw / 2, y: y - th / 2, w: tw, h: th, train: t });
      }
      r.current.hits = hits;
      ctx.textAlign = 'left';
      raf = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener('resize', resize);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('mousemove', onMove);
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('mousemove', onMove);
    };
  }, []);

  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  return <canvas id="metro" ref={canvasRef} />;
}
