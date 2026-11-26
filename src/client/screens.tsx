import { useEffect, useRef, useState } from 'react';
import { ROLE_INFO, type Role, type View } from '../shared/types';
import { act, emit, rememberName, rememberedName, saveSession } from './net';
import { estimatedDayMinutes, plannedRounds } from '../shared/schedule';
import { Card, Countdown, fmtMinutes, gameClock, joinUrl, Logo, nameOf, PlayerList, Qr, RoleTag, Timeline, roleName, useCallingTimeWarning } from './ui';

// ---------------------------------------------------------------------------
// Welcome
// ---------------------------------------------------------------------------

export function Welcome({ onGuide }: { onGuide: () => void }) {
  const params = new URLSearchParams(location.search);
  const [code, setCode] = useState((params.get('room') ?? '').toUpperCase().slice(0, 4));
  const [name, setName] = useState(rememberedName());
  const [mode, setMode] = useState<'join' | 'create'>(params.get('room') ? 'join' : 'join');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const a = mode === 'create' ? await emit('room:create', { name }) : await emit('room:join', { code, name });
    setBusy(false);
    if (!a.ok) return setError(a.message ?? 'Could not get in.');
    rememberName(name.trim());
    saveSession({ code: a.code as string, token: a.token as string });
    history.replaceState(null, '', '/');
  }

  return (
    <div className="welcome">
      <Logo />
      <p className="tagline">Nobody sits out. The pub runs the game.</p>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={mode === 'join'} className={mode === 'join' ? 'active' : ''} onClick={() => setMode('join')}>Join a game</button>
        <button role="tab" aria-selected={mode === 'create'} className={mode === 'create' ? 'active' : ''} onClick={() => setMode('create')}>Open a new pub</button>
      </div>
      <form className="card form" onSubmit={submit}>
        {mode === 'join' && (
          <label>
            Room code
            <input
              className="code-input"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))}
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="ABCD"
              maxLength={4}
              aria-label="Room code"
            />
          </label>
        )}
        <label>
          Your name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={16} autoComplete="off" placeholder="e.g. Seamus" aria-label="Your name" />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary" disabled={busy || name.trim().length < 2 || (mode === 'join' && code.length !== 4)}>
          {busy ? 'One moment...' : mode === 'join' ? 'Pull up a stool' : 'Open the pub'}
        </button>
      </form>
      <button className="btn ghost" type="button" onClick={onGuide}>New to it? How to play</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lobby ("The Snug")
// ---------------------------------------------------------------------------

export function Lobby({ view }: { view: View }) {
  const me = view.me!;
  const n = view.players.length;
  const need = Math.max(0, view.minPlayers - n);
  const mafia = view.roleCounts.mafia;
  const setSetting = (settings: Record<string, unknown>) => void act('host:settings', { settings });

  return (
    <div className="stack">
      <Card className="roomcode-card">
        <p className="eyebrow">The Snug · room code</p>
        <div className="roomcode" aria-label={`Room code ${view.code.split('').join(' ')}`}>{view.code}</div>
        <Qr text={joinUrl(view.code)} size={170} />
        <p className="hint">Friends scan this or type the code at <b>{location.host}</b>. For a big screen, open <code>/tv/{view.code}</code>.</p>
      </Card>

      <Card>
        <h2>On the stools ({n}/{view.maxPlayers})</h2>
        <PlayerList view={view} showRoles={false} onKick={me.isHost ? (id) => void act('host:kick', { playerId: id }) : undefined} />
      </Card>

      <Card>
        <h2>This game</h2>
        <p className="hint">
          {n} players: <b>{mafia}</b> Mafia, {view.settings.simpleMode ? '' : '1 Detective, 1 Doctor, '}{view.roleCounts.villager} Villagers.
        </p>
        {me.isHost ? (
          <div className="settings">
            <label className="row">
              <span>Simple mode</span>
              <input type="checkbox" checked={view.settings.simpleMode} onChange={(e) => setSetting({ simpleMode: e.target.checked })} />
            </label>
            {view.settings.simpleMode && (
              <p className="hint">Just Mafia and Villagers: a plain kill and vote. At night only the Mafia need to do anything, so everyone else can carry on partying.</p>
            )}
            <div className="row">
              <span>Mafia</span>
              <div className="stepper">
                <button className="btn small" onClick={() => setSetting({ mafiaCount: Math.max(1, mafia - 1) })} disabled={mafia <= 1} aria-label="Fewer Mafia">−</button>
                <b>{mafia}</b>
                <button className="btn small" onClick={() => setSetting({ mafiaCount: Math.min(view.maxMafia, mafia + 1) })} disabled={mafia >= view.maxMafia} aria-label="More Mafia">+</button>
                {view.settings.mafiaCount !== null && <button className="btn small ghost" onClick={() => setSetting({ mafiaCount: null })}>auto</button>}
              </div>
            </div>
            <label className="row">
              <span>Game length</span>
              <select
                value={view.settings.targetMinutes ?? 'manual'}
                onChange={(e) => setSetting({ targetMinutes: e.target.value === 'manual' ? null : Number(e.target.value) })}
              >
                {[60, 90, 120, 150, 180].map((m) => <option key={m} value={m}>about {fmtMinutes(m)}</option>)}
                <option value="manual">Manual (fixed timers)</option>
              </select>
            </label>
            {view.settings.targetMinutes !== null ? (
              <p className="hint">
                About {plannedRounds(n)} rounds, with roughly{' '}
                <b>{estimatedDayMinutes(view.settings.targetMinutes, n, view.settings.voteSecs, 10)} min</b> of discussion before each vote.
                The app lengthens or shortens each day to keep to the plan. Games can still end sooner if the Mafia are caught quickly.
              </p>
            ) : (
              <label className="row">
                <span>Discussion each day</span>
                <select value={view.settings.discussSecs} onChange={(e) => setSetting({ discussSecs: Number(e.target.value) })}>
                  {[180, 300, 480, 600, 900, 1200, 1800].map((s) => <option key={s} value={s}>{s / 60} min</option>)}
                </select>
              </label>
            )}
            <label className="row">
              <span>Voting</span>
              <select value={view.settings.voteSecs} onChange={(e) => setSetting({ voteSecs: Number(e.target.value) })}>
                {[45, 60, 90, 120].map((s) => <option key={s} value={s}>{s} sec</option>)}
              </select>
            </label>
            <label className="row">
              <span>Reveal role when someone goes</span>
              <input type="checkbox" checked={view.settings.revealOnDeath} onChange={(e) => setSetting({ revealOnDeath: e.target.checked })} />
            </label>
            <label className="row">
              <span>Christmas mode</span>
              <input type="checkbox" checked={view.settings.christmas} onChange={(e) => setSetting({ christmas: e.target.checked })} />
            </label>
          </div>
        ) : (
          <p className="hint">{view.settings.simpleMode ? 'Simple mode: just Mafia and Villagers, a plain kill and vote. ' : ''}Roles are dealt in secret when the host starts. {view.settings.revealOnDeath ? 'Roles are revealed when someone is lost.' : 'Roles stay hidden until the end.'}</p>
        )}
      </Card>

      {me.isHost ? (
        <div className="stickybar">
          <button className="btn primary big" disabled={need > 0} onClick={() => void act('host:start')}>
            {need > 0 ? `Need ${need} more ${need === 1 ? 'player' : 'players'}` : 'Start the game'}
          </button>
        </div>
      ) : (
        <p className="waiting">Waiting for the host to start...</p>
      )}
      <LeaveButton />
    </div>
  );
}

function LeaveButton() {
  return <button className="btn ghost" onClick={() => void act('room:leave').then(() => location.reload())}>Leave the pub</button>;
}

// ---------------------------------------------------------------------------
// Role reveal
// ---------------------------------------------------------------------------

export function RoleReveal({ view }: { view: View }) {
  const me = view.me!;
  const role = me.role as Role;
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const hide = () => { clearTimeout(timer.current); setShown(false); };
  const show = () => { setShown(true); clearTimeout(timer.current); timer.current = setTimeout(hide, 3000); };
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div className="stack center">
      <Countdown view={view} label="Cards close in" />
      <p className="narration-line">{view.narration?.text}</p>
      <button
        className={`rolecard ${shown ? `shown role-${role}` : ''}`}
        onPointerDown={show}
        onPointerUp={hide}
        onPointerLeave={hide}
        onPointerCancel={hide}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="Press and hold to see your role"
      >
        {shown ? (
          <>
            <span className="rolecard-name">{roleName(role)}</span>
            <span className="rolecard-blurb">{ROLE_INFO[role].blurb}</span>
            {role === 'mafia' && (
              <span className="rolecard-team">
                {me.teammates.length ? `Your fellow Traitors: ${me.teammates.map((id) => nameOf(view, id)).join(', ')}` : 'You are the only Traitor.'}
              </span>
            )}
          </>
        ) : (
          <>
            <span className="rolecard-back">🍺</span>
            <span className="rolecard-hint">Press and hold to see your role</span>
          </>
        )}
      </button>
      {me.ready ? (
        <p className="waiting">Ready. Waiting for the others ({view.readyProgress?.done}/{view.readyProgress?.total})...</p>
      ) : (
        <button className="btn primary big" onClick={() => void act('role:ready')}>I know my role</button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Night
// ---------------------------------------------------------------------------

const NIGHT_PROMPT: Record<Role, string> = {
  mafia: 'Who do you want gone?',
  doctor: 'Who do you want to protect?',
  detective: 'Who do you want to check?',
  villager: 'Who do you suspect the most?',
};

export function Night({ view }: { view: View }) {
  const me = view.me!;
  const night = view.night!;
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const picked = night.pick ?? sel;

  if (!me.alive) {
    return (
      <div className="stack center">
        <p className="narration-line">{view.narration?.text}</p>
        <p className="waiting">You're a ghost at the bar. Watch the night unfold below.</p>
        <Progress done={night.progress.done} total={night.progress.total} />
      </div>
    );
  }

  const lock = async () => {
    if (!sel || busy) return;
    setBusy(true);
    await act('night:action', { targetId: sel });
    setBusy(false);
  };

  return (
    <div className="stack">
      <Countdown view={view} label="Night ends in" />
      <p className="narration-line">{view.narration?.text}</p>
      {me.role === 'mafia' && me.teammates.length > 0 && (
        <p className="hint">Fellow Traitors: <b>{me.teammates.map((id) => nameOf(view, id)).join(', ')}</b></p>
      )}
      <h2 className="prompt">{night.locked ? 'Locked in.' : night.optional ? 'Optional: who do you suspect?' : NIGHT_PROMPT[me.role as Role]}</h2>
      <ul className="picklist">
        {view.players.filter((p) => p.alive).map((p) => {
          const allowed = night.options.includes(p.id);
          const chosen = picked === p.id;
          const mates = Object.entries(night.mafiaPicks ?? {}).filter(([, t]) => t === p.id).map(([m]) => nameOf(view, m));
          return (
            <li key={p.id}>
              <button
                className={`pick ${chosen ? 'chosen' : ''}`}
                disabled={!allowed || night.locked}
                aria-pressed={chosen}
                onClick={() => setSel(p.id)}
              >
                <span>{p.name}{view.me?.id === p.id ? ' (you)' : ''}</span>
                {mates.length > 0 && <small>{mates.join(', ')} picked</small>}
              </button>
            </li>
          );
        })}
      </ul>
      {night.locked ? (
        <>
          <p className="waiting">Waiting for the others...</p>
          <Progress done={night.progress.done} total={night.progress.total} />
        </>
      ) : (
        <div className="stickybar">
          <button className="btn primary big tap" disabled={!sel || busy} onClick={lock}>{night.optional ? 'Lock in (optional)' : 'Lock in'}</button>
          {night.optional && <p className="hint center-text">The night ends when the Traitors have decided. You can just wait.</p>}
        </div>
      )}
    </div>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="progress" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total}>
      <div style={{ width: `${pct}%` }} />
      <span>{done} of {total} settled up</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dawn, day, vote, verdict
// ---------------------------------------------------------------------------

export function Notebook({ view }: { view: View }) {
  if (view.me?.role !== 'detective' || !view.detectiveNotes?.length) return null;
  return (
    <Card className="notebook">
      <h2>Your notebook</h2>
      <ul>
        {view.detectiveNotes.map((n, i) => (
          <li key={i} className={n.isMafia ? 'bad' : 'good'}>
            Night {n.round}: <b>{nameOf(view, n.targetId)}</b> is {n.isMafia ? 'MAFIA' : 'not Mafia'}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function Dawn({ view }: { view: View }) {
  const killed = view.dawn?.killedId;
  return (
    <div className="stack center">
      <h2 className="eyebrow">Dawn</h2>
      <p className="narration-big">{view.narration?.text}</p>
      {killed && <div className="lost">{nameOf(view, killed)} is out of the game</div>}
      {!killed && view.dawn?.saved && <div className="saved">Saved by the Doctor</div>}
      <Notebook view={view} />
    </div>
  );
}

export function Day({ view }: { view: View }) {
  const warn = useCallingTimeWarning(view, true);
  const clock = gameClock(view);
  return (
    <div className="stack">
      <Countdown view={view} label="Time to talk" />
      {warn && <div className="warning" role="status">Calling Time is coming. Make your case.</div>}
      <p className="narration-line">{view.narration?.text}</p>
      <Notebook view={view} />
      <Card>
        <h2>At the bar</h2>
        <PlayerList view={view} />
      </Card>
      <p className="hint">Talk it out in person. Voting opens when the timer ends{view.me?.isHost ? ', or skip ahead with the host controls' : ''}.</p>
      {clock && <p className="hint">Game clock: {clock}.</p>}
    </div>
  );
}

export function Vote({ view }: { view: View }) {
  const me = view.me!;
  const vote = view.vote!;
  const [pending, setPending] = useState<string | null>(null);
  const current = pending ?? vote.myVote;
  const cast = async (id: string) => {
    setPending(id);
    const a = await act('day:vote', { targetId: id });
    if (!a.ok) setPending(null);
  };

  return (
    <div className="stack">
      <Countdown view={view} label="Calling Time" />
      <p className="narration-line">{view.narration?.text}</p>
      {me.alive ? (
        <>
          <h2 className="prompt">Who gets barred?</h2>
          <ul className="picklist">
            {view.players.filter((p) => p.alive && p.id !== me.id).map((p) => (
              <li key={p.id}>
                <button className={`pick ${current === p.id ? 'chosen' : ''}`} aria-pressed={current === p.id} onClick={() => void cast(p.id)}>
                  {p.name}
                </button>
              </li>
            ))}
            <li>
              <button className={`pick none ${current === 'none' ? 'chosen' : ''}`} aria-pressed={current === 'none'} onClick={() => void cast('none')}>
                No one
              </button>
            </li>
          </ul>
          <p className="hint">{current ? `You voted for ${nameOf(view, current)}. You can change it until time is called.` : 'Tap a name to vote.'}</p>
        </>
      ) : (
        <p className="waiting">Ghosts don't vote. Enjoy the show.</p>
      )}
      <Progress done={vote.progress.done} total={vote.progress.total} />
    </div>
  );
}

export function Verdict({ view }: { view: View }) {
  const tally = Object.entries(view.verdict?.tally ?? {}).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...tally.map(([, c]) => c));
  return (
    <div className="stack center">
      <h2 className="eyebrow">{view.narration?.title}</h2>
      <p className="narration-big">{view.narration?.text}</p>
      <Card className="tally">
        {tally.length === 0 && <p className="hint">Nobody voted.</p>}
        {tally.map(([id, count]) => (
          <div key={id} className="tally-row">
            <span>{nameOf(view, id)}</span>
            <div className="bar"><div style={{ width: `${(count / max) * 100}%` }} /></div>
            <b>{count}</b>
          </div>
        ))}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Game over
// ---------------------------------------------------------------------------

export function GameOver({ view }: { view: View }) {
  const me = view.me!;
  const mafiaWon = view.winner === 'mafia';
  const won = (me.role === 'mafia') === mafiaWon;
  return (
    <div className="stack">
      <div className={`banner ${mafiaWon ? 'banner-mafia' : 'banner-village'}`}>
        <h2>{view.narration?.title}</h2>
        <p>{view.narration?.text}</p>
        <p className="small">{won ? 'Your side won. Well played.' : 'Your side lost. There is always the rematch.'}</p>
      </div>
      <Card>
        <h2>Everyone's cards</h2>
        <PlayerList view={view} />
      </Card>
      <Card>
        <h2>How it went</h2>
        <Timeline view={view} />
      </Card>
      {me.isHost ? (
        <div className="stickybar"><button className="btn primary big" onClick={() => void act('host:reset')}>Play again</button></div>
      ) : (
        <p className="waiting">Waiting for the host to start a rematch...</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ghosts and the host panel
// ---------------------------------------------------------------------------

export function GhostBoard({ view }: { view: View }) {
  if (view.me?.alive !== false || view.phase === 'gameOver' || view.phase === 'lobby') return null;
  return (
    <details className="card ghostboard" open>
      <summary>👻 Ghost at the bar: the whole board</summary>
      <PlayerList view={view} />
      <Timeline view={view} />
      {view.me?.role === 'detective' && <Notebook view={view} />}
    </details>
  );
}

export function HostPanel({ view }: { view: View }) {
  if (!view.me?.isHost || view.phase === 'lobby' || view.phase === 'gameOver') return null;
  const canSkip = ['roleReveal', 'dawn', 'day', 'vote', 'verdict'].includes(view.phase);
  const end = () => {
    if (confirm('End this game and go back to the lobby?')) void act('host:reset');
  };
  return (
    <details className="hostpanel">
      <summary>Host controls</summary>
      <div className="hostbtns">
        {view.paused ? (
          <button className="btn small" onClick={() => void act('host:resume')}>Resume</button>
        ) : (
          <button className="btn small" onClick={() => void act('host:pause')}>Pause</button>
        )}
        {view.canExtend && <button className="btn small" onClick={() => void act('host:extend')}>+1 min</button>}
        {canSkip && <button className="btn small" onClick={() => void act('host:skip')}>Skip ahead</button>}
        <button className="btn small danger" onClick={end}>End game</button>
      </div>
      <p className="hint">Remove someone (they become a ghost and their role is revealed):</p>
      <PlayerList view={{ ...view, players: view.players.filter((p) => p.alive) }} showRoles={false} onKick={(id) => {
        if (confirm(`Remove ${nameOf(view, id)} from the game?`)) void act('host:kick', { playerId: id });
      }} />
    </details>
  );
}

export function PausedOverlay({ view }: { view: View }) {
  if (!view.paused) return null;
  return (
    <div className="overlay" role="alert">
      <h2>Paused</h2>
      <p>{view.me?.isHost ? 'Resume from the host controls when everyone is ready.' : 'The landlord has called a break.'}</p>
    </div>
  );
}

export { RoleTag };
