import { useEffect, useRef, useState } from 'react';
import { startTv, useStore, useTicker } from './net';
import { Countdown, gameClock, joinUrl, Lights, Logo, nameOf, PlayerList, Qr, Timeline, useCallingTimeWarning } from './ui';

function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  return voices.find((v) => v.lang === 'en-IE') ?? voices.find((v) => v.lang === 'en-GB') ?? voices.find((v) => v.lang.startsWith('en'));
}

export function Tv({ code }: { code: string }) {
  const { view, connected, tvError } = useStore();
  const [voice, setVoice] = useState(false);
  useEffect(() => startTv(code), [code]);
  useTicker(10_000); // keeps the game clock fresh
  const warn = useCallingTimeWarning(view, false);

  // Read the five-minute warning aloud once per day, if narration is on.
  const warnedRound = useRef(-1);
  useEffect(() => {
    if (!warn || !voice || !view || warnedRound.current === view.round || !('speechSynthesis' in window)) return;
    warnedRound.current = view.round;
    const u = new SpeechSynthesisUtterance('Five minutes until Calling Time.');
    const v = pickVoice();
    if (v) u.voice = v;
    window.speechSynthesis.speak(u);
  }, [warn, voice, view]);

  // Read the story aloud whenever the narration changes. Browsers need a click first, hence the button.
  const spoken = useRef('');
  const line = view?.narration ? `${view.phase}|${view.round}|${view.narration.text}` : '';
  useEffect(() => {
    if (!voice || !view?.narration || line === spoken.current || !('speechSynthesis' in window)) return;
    spoken.current = line;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(view.narration.text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.rate = 0.92;
    window.speechSynthesis.speak(u);
  }, [voice, line, view]);

  useEffect(() => {
    document.documentElement.dataset.phase = view?.phase ?? 'welcome';
    document.documentElement.dataset.xmas = !view || view.settings.christmas ? '1' : '0';
  }, [view]);

  if (tvError) return <div className="tv"><div className="tv-center"><Logo /><p className="tv-big">{tvError}</p></div></div>;
  if (!view) return <div className="tv"><div className="tv-center"><Logo /><p className="tv-big">Opening the TV for {code}...</p></div></div>;

  const alive = view.players.filter((p) => p.alive);
  let body: React.ReactNode;
  switch (view.phase) {
    case 'lobby':
      body = (
        <div className="tv-lobby">
          <div className="tv-lobby-left">
            <p className="tv-eyebrow">Join at {location.host}</p>
            <div className="tv-code">{view.code}</div>
            <Qr text={joinUrl(view.code)} size={280} />
          </div>
          <div className="tv-lobby-right">
            <h2>On the stools ({view.players.length})</h2>
            <ul className="tv-names">{view.players.map((p) => <li key={p.id} className={p.connected ? '' : 'away'}>{p.name}</li>)}</ul>
            <p className="tv-sub">{view.players.length < view.minPlayers ? `Need ${view.minPlayers - view.players.length} more to start` : 'Waiting for the host to start'}</p>
            <p className="tv-sub">New to it? {location.host}/how-to-play</p>
          </div>
        </div>
      );
      break;
    case 'roleReveal':
      body = (
        <div className="tv-center">
          <h1>Check your phones</h1>
          <p className="tv-big">{view.narration?.text}</p>
          <p className="tv-sub">{view.readyProgress?.done} of {view.readyProgress?.total} ready</p>
        </div>
      );
      break;
    case 'night':
      body = (
        <div className="tv-center">
          <h1>Night {view.round}</h1>
          <p className="tv-big">{view.narration?.text}</p>
          <p className="tv-sub">
            {view.settings.simpleMode ? 'The Traitors are deciding...' : `${view.night?.progress.done} of ${view.night?.progress.total} have settled up`}
          </p>
        </div>
      );
      break;
    case 'dawn':
      body = (
        <div className="tv-center">
          <h1>Dawn</h1>
          <p className="tv-big">{view.narration?.text}</p>
          {view.dawn?.killedId && <div className="lost tv-lost">{nameOf(view, view.dawn.killedId)} is out of the game</div>}
        </div>
      );
      break;
    case 'day':
      body = (
        <div className="tv-center">
          <h1>Who is the Traitor?</h1>
          <Countdown view={view} />
          {warn && <div className="warning tv-warning">Five minutes until Calling Time</div>}
          <ul className="tv-names">{alive.map((p) => <li key={p.id}>{p.name}</li>)}</ul>
          <p className="tv-sub">{alive.length} left at the bar</p>
        </div>
      );
      break;
    case 'vote':
      body = (
        <div className="tv-center">
          <h1>Calling Time</h1>
          <Countdown view={view} />
          <p className="tv-big">{view.vote?.progress.done} of {view.vote?.progress.total} votes cast</p>
        </div>
      );
      break;
    case 'verdict': {
      const tally = Object.entries(view.verdict?.tally ?? {}).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]);
      body = (
        <div className="tv-center">
          <h1>{view.narration?.title}</h1>
          <p className="tv-big">{view.narration?.text}</p>
          <ul className="tv-tally">{tally.map(([id, c]) => <li key={id}><span>{nameOf(view, id)}</span><b>{c}</b></li>)}</ul>
        </div>
      );
      break;
    }
    case 'gameOver':
      body = (
        <div className="tv-gameover">
          <h1>{view.narration?.title}</h1>
          <p className="tv-big">{view.narration?.text}</p>
          <div className="tv-two">
            <PlayerList view={view} />
            <Timeline view={view} />
          </div>
        </div>
      );
      break;
  }

  return (
    <div className="tv">
      {view.settings.christmas && <Lights />}
      <div className="tv-top">
        <Logo small />
        <span className="topbar-code">{view.code}</span>
        <button className="btn small ghost" onClick={() => { setVoice((v) => !v); if (voice) window.speechSynthesis?.cancel(); }}>
          {voice ? '🔊 Narration on' : '🔈 Turn on narration'}
        </button>
      </div>
      {!connected && <div className="offline">Reconnecting...</div>}
      {view.paused && <div className="tv-paused">Paused</div>}
      {gameClock(view) && view.phase !== 'gameOver' && <p className="tv-clock">{gameClock(view)}</p>}
      {body}
    </div>
  );
}
