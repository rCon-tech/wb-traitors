// Fake players for rehearsing and for automated tests.
//
//   npm run bots -- --url http://localhost:3000 --code ABCD --count 10   join a room you opened yourself
//   npm run bots -- --url http://localhost:3000 --count 8                bots open their own room and play it through

import { pathToFileURL } from 'node:url';
import { io, type Socket } from 'socket.io-client';
import type { Ack, HistoryEntry, View } from '../src/shared/types';

export interface BotResult {
  winner?: string;
  rounds: number;
  views: number;
  /** Everyone's role as revealed at game over. */
  finalRoles: string[];
  /** Full night/vote history as shown at game over. */
  history: HistoryEntry[];
  privacyViolations: string[];
  code: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pickRandom = <T,>(a: T[]): T | undefined => a[Math.floor(Math.random() * a.length)];

function emit(socket: Socket, event: string, payload: unknown): Promise<Ack> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ ok: false, code: 'TIMEOUT' }), 5000);
    socket.emit(event, payload, (a: Ack) => {
      clearTimeout(t);
      resolve(a);
    });
  });
}

export class Bot {
  socket: Socket;
  view?: View;
  token?: string;
  code = '';
  violations: string[] = [];
  viewCount = 0;
  private acting = false;

  private settingsSent = false;

  constructor(
    public name: string,
    url: string,
    private hostCount?: number,
    private hostSettings?: Record<string, unknown>,
    /** Villagers who never touch their phone at night (the Simple Mode promise). */
    private idleVillagers = false,
  ) {
    this.socket = io(url, { transports: ['websocket'], forceNew: true });
    this.socket.on('state:view', (v: View) => {
      this.view = v;
      this.viewCount++;
      this.checkPrivacy(v);
      void this.react(v);
    });
  }

  private checkPrivacy(v: View) {
    const me = v.me;
    if (!me || v.phase === 'gameOver') return;
    for (const p of v.players) {
      if (!p.role) continue;
      const mafiaPair = me.role === 'mafia' && p.role === 'mafia';
      if (p.id === me.id || !me.alive || !p.alive || mafiaPair) continue;
      this.violations.push(`${this.name} saw ${p.name}'s role (${p.role}) in ${v.phase}`);
    }
  }

  async create(): Promise<string> {
    await this.waitConnected();
    const a = await emit(this.socket, 'room:create', { name: this.name });
    if (!a.ok) throw new Error(`create failed: ${a.code}`);
    this.token = a.token as string;
    this.code = a.code as string;
    return this.code;
  }

  async join(code: string): Promise<void> {
    await this.waitConnected();
    const a = await emit(this.socket, 'room:join', { code, name: this.name });
    if (!a.ok) throw new Error(`join failed: ${a.code}`);
    this.token = a.token as string;
    this.code = code;
  }

  private waitConnected() {
    return new Promise<void>((resolve) => (this.socket.connected ? resolve() : this.socket.once('connect', () => resolve())));
  }

  private async react(v: View) {
    if (this.acting || !v.me) return;
    this.acting = true;
    try {
      await sleep(20 + Math.random() * 120);
      const me = v.me;
      if (v.phase === 'lobby' && me.isHost && this.hostCount && v.players.length >= this.hostCount) {
        if (this.hostSettings && !this.settingsSent) {
          this.settingsSent = true;
          await emit(this.socket, 'host:settings', { settings: this.hostSettings });
        }
        await emit(this.socket, 'host:start', {});
      } else if (v.phase === 'roleReveal' && !me.ready) {
        await emit(this.socket, 'role:ready', {});
      } else if (v.phase === 'night' && me.alive && v.night && !v.night.locked && !(this.idleVillagers && me.role === 'villager')) {
        const t = pickRandom(v.night.options);
        if (t) await emit(this.socket, 'night:action', { targetId: t });
      } else if (v.phase === 'vote' && me.alive && v.vote && v.vote.myVote === undefined) {
        const t = pickRandom(v.vote.options);
        if (t) await emit(this.socket, 'day:vote', { targetId: t });
      }
    } finally {
      this.acting = false;
    }
    // State may have changed while we were acting; look again.
    if (this.view && this.view !== v) void this.react(this.view);
  }

  close() {
    this.socket.disconnect();
  }
}

export async function playFullGame(
  url: string,
  count: number,
  timeoutMs = 90_000,
  settings?: Record<string, unknown>,
  opts: { idleVillagers?: boolean } = {},
): Promise<BotResult> {
  const bots = Array.from(
    { length: count },
    (_, i) => new Bot(`Bot${i + 1}`, url, i === 0 ? count : undefined, settings, opts.idleVillagers),
  );
  const code = await (bots[0] as Bot).create();
  for (const b of bots.slice(1)) await b.join(code);
  const started = Date.now();
  let maxRound = 0;
  try {
    for (;;) {
      const v = (bots[0] as Bot).view;
      if (v) maxRound = Math.max(maxRound, v.round);
      if (v?.phase === 'gameOver') {
        await sleep(300);
        break;
      }
      if (Date.now() - started > timeoutMs) throw new Error(`game did not finish; phase=${v?.phase} round=${v?.round}`);
      await sleep(100);
    }
    return {
      winner: (bots[0] as Bot).view?.winner,
      rounds: maxRound,
      views: bots.reduce((n, b) => n + b.viewCount, 0),
      finalRoles: ((bots[0] as Bot).view?.players ?? []).map((p) => p.role ?? 'unknown'),
      history: (bots[0] as Bot).view?.history ?? [],
      privacyViolations: bots.flatMap((b) => b.violations),
      code,
    };
  } finally {
    bots.forEach((b) => b.close());
  }
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (name: string, def?: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : def;
  };
  const url = arg('url', 'http://localhost:3000') as string;
  const count = Number(arg('count', '8'));
  const code = arg('code');
  if (!code) {
    console.log(`Bots are opening their own pub with ${count} players...`);
    const r = await playFullGame(url, count, 30 * 60_000);
    console.log(`Done. Winner: ${r.winner}. Rounds: ${r.rounds}. Privacy violations: ${r.privacyViolations.length}`);
    process.exit(r.privacyViolations.length ? 1 : 0);
  }
  console.log(`Adding ${count} bots to room ${code}. Start the game from your phone. Ctrl+C to stop.`);
  const bots = Array.from({ length: count }, (_, i) => new Bot(`Bot${i + 1}`, url));
  for (const b of bots) await b.join(code.toUpperCase());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
