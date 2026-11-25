import { useEffect, useRef, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { ROLE_INFO, type HistoryEntry, type Role, type View } from '../shared/types';
import { secondsLeft, serverNow, useTicker } from './net';

// Put the year the group started here to show "Est. 2009" on the pub sign. Leave empty to hide it.
export const FOUNDED_YEAR = '';

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <svg className={small ? 'logo logo-small' : 'logo'} viewBox="0 0 320 150" role="img" aria-label="The W.B. Mates pub sign">
      <path d="M70 0v30M250 0v30" stroke="#C9A227" strokeWidth="5" strokeDasharray="8 4" />
      <rect x="14" y="30" width="292" height="112" rx="14" fill="#4A2C1D" stroke="#C9A227" strokeWidth="6" />
      <rect x="24" y="40" width="272" height="92" rx="8" fill="none" stroke="#C9A22755" strokeWidth="2" />
      <text x="160" y="80" textAnchor="middle" fontFamily="Rye, Georgia, serif" fontSize="32" fill="#F3E9D2" textLength="236" lengthAdjust="spacingAndGlyphs">
        The W.B. Mates
      </text>
      <text x="160" y="101" textAnchor="middle" fontFamily="Lora, Georgia, serif" fontSize="11" fill="#C9A227" textLength={FOUNDED_YEAR ? 232 : 190} lengthAdjust="spacing">
        {FOUNDED_YEAR ? `EST. ${FOUNDED_YEAR} · ` : ''}TRAITORS AT THE BAR
      </text>
      {/* shamrock */}
      <g fill="#2a8f58" transform="translate(128 119)">
        <circle cx="-5" cy="-5" r="5" /><circle cx="5" cy="-5" r="5" /><circle cx="0" cy="3" r="5" />
        <path d="M0 3l3 10" stroke="#2a8f58" strokeWidth="2" fill="none" />
      </g>
      {/* pint */}
      <g transform="translate(184 111) scale(0.8)">
        <path d="M-8 -8h22l-3 26a3 3 0 0 1-3 3h-10a3 3 0 0 1-3-3z" fill="#1B1410" stroke="#F3E9D2" strokeWidth="1.5" />
        <path d="M-8 -8h22l-.8 6h-20.4z" fill="#F3E9D2" />
      </g>
    </svg>
  );
}

export function Lights() {
  return <div className="lights" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ animationDelay: `${(i % 5) * 0.35}s` }} />)}</div>;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function Countdown({ view, label }: { view: View; label?: string }) {
  useTicker(250);
  const s = secondsLeft(view);
  if (s === null) return null;
  const mm = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  return (
    <div className={`countdown ${s <= 10 && !view.paused ? 'urgent' : ''}`} aria-live="off">
      {label && <span className="countdown-label">{label}</span>}
      <span className="countdown-time">{mm}:{ss}</span>
      {view.paused && <span className="countdown-label">paused</span>}
    </div>
  );
}

export function nameOf(view: View, id: string | undefined): string {
  if (!id) return 'Nobody';
  if (id === 'none') return 'No one';
  return view.players.find((p) => p.id === id)?.name ?? 'Someone';
}

export const roleName = (r: Role) => ROLE_INFO[r].name;

export function RoleTag({ role }: { role?: Role }) {
  if (!role) return null;
  return <span className={`roletag roletag-${role}`}>{roleName(role)}</span>;
}

export function PlayerList({ view, showRoles = true, onKick }: { view: View; showRoles?: boolean; onKick?: (id: string) => void }) {
  return (
    <ul className="plist">
      {view.players.map((p) => (
        <li key={p.id} className={`${p.alive ? '' : 'dead'} ${view.me?.id === p.id ? 'me' : ''}`}>
          <span className={`dot ${p.connected ? 'on' : 'off'}`} title={p.connected ? 'here' : 'away'} />
          <span className="pname">{p.name}{p.isHost && <small className="host-badge">host</small>}{view.me?.id === p.id && <small className="you-badge">you</small>}</span>
          {showRoles && <RoleTag role={p.role} />}
          {!p.alive && <small className="ghost-badge">{p.kicked ? 'barred by host' : 'ghost'}</small>}
          {onKick && !p.isHost && <button className="kick" onClick={() => onKick(p.id)} aria-label={`Remove ${p.name}`}>✕</button>}
        </li>
      ))}
    </ul>
  );
}

export function describeHistory(view: View, h: HistoryEntry): string {
  const n = (id?: string) => nameOf(view, id);
  if (h.kind === 'vote') {
    return `Day ${h.round}: ${h.eliminatedId ? `${n(h.eliminatedId)} was barred.` : 'Nobody was barred.'}`;
  }
  const parts = [`Night ${h.round}:`];
  parts.push(h.mafiaTarget ? `Traitors went for ${n(h.mafiaTarget)}.` : 'The Traitors did not agree on anyone.');
  if (h.doctorTarget) parts.push(`Doctor protected ${n(h.doctorTarget)}.`);
  if (h.detectiveTarget) parts.push(`Detective checked ${n(h.detectiveTarget)} (${h.detectiveResult ? 'Mafia' : 'not Mafia'}).`);
  parts.push(h.killedId ? `${n(h.killedId)} was lost.` : h.saved ? 'The save worked: nobody was lost.' : 'Nobody was lost.');
  return parts.join(' ');
}

export function Timeline({ view }: { view: View }) {
  if (!view.history?.length) return null;
  return (
    <ol className="timeline">
      {view.history.map((h, i) => <li key={i}>{describeHistory(view, h)}</li>)}
    </ol>
  );
}

export function Qr({ text, size = 220 }: { text: string; size?: number }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(text, { margin: 1, width: size * 2, color: { dark: '#1B1410', light: '#F3E9D2' } })
      .then((u) => live && setSrc(u))
      .catch(() => live && setSrc(''));
    return () => { live = false; };
  }, [text, size]);
  if (!src) return <div className="qr qr-empty" style={{ width: size, height: size }} />;
  return <img className="qr" src={src} width={size} height={size} alt={`QR code to join with room code`} />;
}

export const joinUrl = (code: string) => `${location.origin}/?room=${code}`;

export function fmtMinutes(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** "47 min in, aiming for about 2 h", or null when there is no game-length plan. */
export function gameClock(view: View): string | null {
  if (!view.schedule) return null;
  const elapsed = Math.max(0, Math.floor((serverNow() - view.schedule.startedAt) / 60000));
  return `${fmtMinutes(elapsed)} in, aiming to finish around ${fmtMinutes(view.schedule.targetMinutes)}`;
}

/**
 * True during the last five minutes of a long discussion, so phones and the TV can warn that voting is coming.
 * Only applies to days that began with more than five minutes on the clock, so short days stay quiet.
 * Phones also buzz once as the warning starts.
 */
export function useCallingTimeWarning(view: View | null, vibrate: boolean): boolean {
  useTicker(500);
  const day = view?.phase === 'day' ? view : null;
  const s = day ? secondsLeft(day) : null;
  const seen = useRef<{ round: number; start: number } | null>(null);
  if (!day) seen.current = null;
  else if (s !== null && (!seen.current || seen.current.round !== day.round)) seen.current = { round: day.round, start: s };
  const applies = !!seen.current && seen.current.start > 330;
  const warn = !!day && applies && s !== null && s > 0 && s <= 300 && !day.paused;
  const fired = useRef(-1);
  const round = view?.round ?? -1;
  useEffect(() => {
    if (warn && fired.current !== round) {
      fired.current = round;
      if (vibrate) navigator.vibrate?.([200, 100, 200]);
    }
  }, [warn, round, vibrate]);
  return warn;
}
