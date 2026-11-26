import { useEffect, useState } from 'react';
import { startPlayer, useStore } from './net';
import {
  Dawn,
  Day,
  GameOver,
  GhostBoard,
  HostPanel,
  Lobby,
  Night,
  PausedOverlay,
  RoleReveal,
  Verdict,
  Vote,
  Welcome,
} from './screens';
import { GuidePage, GuideSheet } from './Guide';
import { Tv } from './tv';
import { Lights, Logo } from './ui';

export function App() {
  const tv = location.pathname.match(/^\/tv\/([A-Za-z]{4})\/?$/);
  if (/^\/how-to-play\/?$/.test(location.pathname)) return <GuidePage />;
  return tv ? <Tv code={(tv[1] as string).toUpperCase()} /> : <Player />;
}

function Player() {
  const { view, connected, session, toast } = useStore();
  const [guide, setGuide] = useState(false);
  useEffect(() => startPlayer(), []);

  const inGame = !!view && view.phase !== 'lobby';
  const phase = view?.phase;

  // Keep the screen awake during a game.
  useEffect(() => {
    if (!inGame || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const request = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
      } catch {
        /* not supported or denied: fine */
      }
    };
    void request();
    const onVisible = () => document.visibilityState === 'visible' && void request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, [inGame]);

  // A short buzz for public moments only, so vibration never gives a role away.
  useEffect(() => {
    if (phase === 'dawn' || phase === 'vote') navigator.vibrate?.(150);
  }, [phase]);

  const christmas = view ? view.settings.christmas : true;
  useEffect(() => {
    document.documentElement.dataset.phase = phase ?? 'welcome';
    document.documentElement.dataset.xmas = christmas ? '1' : '0';
  }, [phase, christmas]);

  let body: React.ReactNode;
  if (!view || !view.me) {
    body = session ? (
      <div className="stack center"><Logo /><p className="waiting">Finding your stool...</p></div>
    ) : (
      <Welcome onGuide={() => setGuide(true)} />
    );
  } else {
    switch (view.phase) {
      case 'lobby': body = <Lobby view={view} />; break;
      case 'roleReveal': body = <RoleReveal view={view} />; break;
      case 'night': body = <Night view={view} />; break;
      case 'dawn': body = <Dawn view={view} />; break;
      case 'day': body = <Day view={view} />; break;
      case 'vote': body = <Vote view={view} />; break;
      case 'verdict': body = <Verdict view={view} />; break;
      case 'gameOver': body = <GameOver view={view} />; break;
    }
  }

  return (
    <div className={`app ${view?.me?.isHost && inGame && phase !== 'gameOver' ? 'has-host' : ''}`}>
      {christmas && <Lights />}
      {view?.me && (
        <header className="topbar">
          <Logo small />
          <span className="topbar-right">
            <button className="help" onClick={() => setGuide(true)} aria-label="How to play">?</button>
            <span className="topbar-code">{view.code}</span>
          </span>
        </header>
      )}
      {!connected && <div className="offline" role="status">Reconnecting to the pub...</div>}
      <main>{body}</main>
      {view?.me && (
        <>
          <GhostBoard view={view} />
          <HostPanel view={view} />
          <PausedOverlay view={view} />
        </>
      )}
      {guide && <GuideSheet onClose={() => setGuide(false)} initialMode={view?.settings.simpleMode ? 'simple' : 'full'} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
