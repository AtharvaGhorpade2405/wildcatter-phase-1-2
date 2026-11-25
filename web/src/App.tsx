// App shell: sidebar navigation + hash router (hash routing works in browser, PWA and Electron alike).
import { useEffect, useState, type ComponentType } from 'react';
import { useLive } from './live';
import { Tower } from './pages/Tower';
import { Stage1 } from './pages/Stage1';
import { Stage2 } from './pages/Stage2';
import { Stage3 } from './pages/Stage3';
import { Stage4 } from './pages/Stage4';
import { DataLake } from './pages/DataLake';
import { Epcis } from './pages/Epcis';
import { Developer } from './pages/Developer';

interface Route { path: string; label: string; icon: string; section: string; Page: ComponentType }

const ROUTES: Route[] = [
  { path: 'tower', label: 'Metro Control Tower', icon: '◉', section: 'Command', Page: Tower },
  { path: 'stage1', label: 'API Plant · ERP/MES/LIMS', icon: '1', section: 'Stage modules', Page: Stage1 },
  { path: 'stage2', label: 'Formulation & C&F', icon: '2', section: 'Stage modules', Page: Stage2 },
  { path: 'stage3', label: 'Stockist ERP', icon: '3', section: 'Stage modules', Page: Stage3 },
  { path: 'stage4', label: 'Pharmacy POS', icon: '4', section: 'Stage modules', Page: Stage4 },
  { path: 'datalake', label: 'Entity Data Lake', icon: '◇', section: 'Shared backbone', Page: DataLake },
  { path: 'epcis', label: 'EPCIS & Audit Trail', icon: '≡', section: 'Shared backbone', Page: Epcis },
  { path: 'developer', label: 'Developer API', icon: '{}', section: 'Shared backbone', Page: Developer },
];

const currentPath = () => location.hash.replace('#/', '').split('?')[0] || 'tower';

export function App() {
  const [path, setPath] = useState(currentPath);
  const [menuOpen, setMenuOpen] = useState(false);
  const { connected } = useLive();

  useEffect(() => {
    const onHash = () => { setPath(currentPath()); setMenuOpen(false); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => { document.body.classList.toggle('menu-open', menuOpen); }, [menuOpen]);

  const route = ROUTES.find((r) => r.path === path) ?? ROUTES[0];
  let lastSection = '';

  return (
    <>
      <button id="menu-btn" aria-label="Menu" onClick={() => setMenuOpen((o) => !o)}>☰</button>
      <aside id="sidebar">
        <div className="brand"><span className="logo">Rx</span><b>PharmaChain OS</b><small>AI-native 4-stage supply chain · MVP</small></div>
        <nav>
          {ROUTES.map((r) => {
            const header = r.section !== lastSection ? <div className="sec">{r.section}</div> : null;
            lastSection = r.section;
            return (
              <div key={r.path}>
                {header}
                <a href={`#/${r.path}`} className={r.path === route.path ? 'active' : ''}><span className="num">{r.icon}</span>{r.label}</a>
              </div>
            );
          })}
        </nav>
        <div className="side-foot">
          <span className={`live-dot ${connected ? 'on' : ''}`} />{connected ? 'Live · connected to mesh' : 'Reconnecting…'}
          <div style={{ marginTop: 6 }}><a href="./privacy.html" style={{ color: 'inherit' }}>Privacy policy</a></div>
        </div>
      </aside>
      <main id="view"><route.Page key={route.path} /></main>
    </>
  );
}
