import { useEffect } from 'react';
import { Header } from './components/header/Header';
import { MapView } from './components/map/MapView';
import { Lightbox } from './components/panel/Lightbox';
import { RightPanel } from './components/panel/RightPanel';
import { Rail, useSmall } from './components/rail/Rail';
import { BottomPanel } from './components/table/BottomPanel';
import { TipProvider } from './components/ui/Tip';
import { Splash } from './components/auth/Splash';
import { Toasts } from './components/map/Toasts';
import { HEADER_H, LEFT_W, RIGHT_W } from './data/constants';
import { ParcelsProvider } from './hooks/useParcels';
import { useSettingsSync } from './hooks/useSettingsSync';
import { patchApp, useApp } from './store/useApp';
import { setLeft } from './store/actions';

export default function App() {
  const small = useSmall();
  const leftOpen = useApp(s => s.leftOpen);
  const rightOpen = useApp(s => s.rightOpen);
  const layoutMode = useApp(s => s.layoutMode);
  const landOn = useApp(s => s.landOn);
  const bottomH = useApp(s => s.bottomH);
  const theme = useApp(s => s.theme);
  const accentColor = useApp(s => s.accentColor);
  const reduce = useApp(s => s.reduceMotion);

/* theme + reduce-motion live on <body> so CSS variables / selectors apply to portals too */
  useEffect(() => { document.body.dataset.theme = theme; }, [theme]);
  /* custom primary colour overrides the theme accent (index.css reads [data-accent]) */
  useEffect(() => {
    if (accentColor) {
      document.body.dataset.accent = 'custom';
      document.body.style.setProperty('--accent-user', accentColor);
    } else {
      delete document.body.dataset.accent;
      document.body.style.removeProperty('--accent-user');
    }
  }, [accentColor]);
  useEffect(() => { document.body.classList.toggle('reduce-motion', reduce); }, [reduce]);

  /* small screens start with both panels closed (they overlay the map) */
  useEffect(() => { if (small) patchApp({ leftOpen: false, rightOpen: false }); }, [small]);

  /* swipe in from the left edge to reveal the rail on small screens */
  useEffect(() => {
    if (!small) return;
    let sx: number | null = null;
    const start = (e: TouchEvent) => { if (!useApp.getState().leftOpen && e.touches[0].clientX <= 36) sx = e.touches[0].clientX; };
    const move = (e: TouchEvent) => { if (sx != null && e.touches[0].clientX - sx > 48) { sx = null; setLeft(true); } };
    const end = () => { sx = null; };
    window.addEventListener('touchstart', start, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', end, { passive: true });
    return () => { window.removeEventListener('touchstart', start); window.removeEventListener('touchmove', move); window.removeEventListener('touchend', end); };
  }, [small]);

  /* the header is one grid row holding two bars: the main bar + search strip */
  const style = small
    ? { gridTemplateColumns: '0 minmax(0,1fr)', gridTemplateRows: `${HEADER_H}px minmax(0,1fr)`, gridTemplateAreas: '"hd hd" "mp mp"' }
    : layoutMode === 'floating'
      ? {
          gridTemplateColumns: `minmax(0,1fr) ${rightOpen ? RIGHT_W : 0}px`,
          gridTemplateRows: `${HEADER_H}px minmax(0,1fr) ${landOn ? bottomH : 0}px`,
          gridTemplateAreas: '"hd hd" "mp rp" "bp bp"',
        }
      : {
          gridTemplateColumns: `${leftOpen ? LEFT_W : 0}px minmax(0,1fr) ${rightOpen ? RIGHT_W : 0}px`,
          gridTemplateRows: `${HEADER_H}px minmax(0,1fr) ${landOn ? bottomH : 0}px`,
          gridTemplateAreas: '"hd hd hd" "rail mp rp" "rail bp bp"',
        };

  const signedIn = useApp(s => s.signedIn);
  /* Pull the signed-in user's settings from Postgres and push changes back, so
     their table layout and annotations follow the account rather than the
     browser. Mounted here because this is the first component that only exists
     once signed in. */
  useSettingsSync();

  if (!signedIn) return <><Splash /><Toasts /></>;

  return (
    <TipProvider>
      <ParcelsProvider>
        <div className="fixed inset-0 grid transition-[grid-template-columns,grid-template-rows] duration-300 ease-panel" style={style}>
        <Header small={small} />
          <Rail small={small} floating={layoutMode === 'floating'} />
          <MapView />
          <RightPanel small={small} />
          <BottomPanel small={small} />
        </div>
        <Lightbox />
        <Toasts />
      </ParcelsProvider>
    </TipProvider>
  );
}
