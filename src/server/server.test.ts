import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Bot, playFullGame } from '../../scripts/bots';
import type { Ack, View } from '../shared/types';

const PORT = 3900 + Math.floor(Math.random() * 90);
const URL = `http://localhost:${PORT}`;
let proc: ChildProcess;
let dir: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wbm-'));
  proc = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), WBM_FAST: '1', WBM_MIN_PLAYERS: '4', WBM_DATA_DIR: dir },
    stdio: ['ignore', 'pipe', 'inherit'],
    detached: false,
  });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 20_000);
    proc.stdout!.on('data', (d: Buffer) => {
      if (String(d).includes('is open')) {
        clearTimeout(t);
        resolve();
      }
    });
    proc.on('exit', (c) => reject(new Error(`server exited ${c}`)));
  });
}, 30_000);

afterAll(() => {
  proc?.kill('SIGTERM');
  fs.rmSync(dir, { recursive: true, force: true });
});

const connect = (): Promise<Socket> =>
  new Promise((resolve) => {
    const s = io(URL, { transports: ['websocket'], forceNew: true });
    s.on('connect', () => resolve(s));
  });

const emit = (s: Socket, event: string, payload: unknown): Promise<Ack> =>
  new Promise((resolve) => s.emit(event, payload, resolve));

const nextView = (s: Socket, event = 'state:view', pred: (v: View) => boolean = () => true) =>
  new Promise<View>((resolve) => {
    const h = (v: View) => {
      if (pred(v)) {
        s.off(event, h);
        resolve(v);
      }
    };
    s.on(event, h);
  });

describe('full games over real sockets', () => {
  it('plays 8 bots from lobby to game over with no role leaks', async () => {
    const r = await playFullGame(URL, 8);
    expect(r.winner === 'village' || r.winner === 'mafia').toBe(true);
    expect(r.rounds).toBeGreaterThanOrEqual(1);
    expect(r.privacyViolations).toEqual([]);
  }, 100_000);

  it('plays a Simple Mode game: only Mafia and Villagers ever exist, and the game still finishes', async () => {
    for (const n of [6, 9]) {
      const r = await playFullGame(URL, n, 90_000, { simpleMode: true });
      expect(['village', 'mafia']).toContain(r.winner);
      expect(r.privacyViolations).toEqual([]);
      expect(r.finalRoles).toHaveLength(n);
      expect(new Set(r.finalRoles)).toEqual(new Set(['mafia', 'villager']));
    }
  }, 150_000);

  it('plays 3 games at once without them touching each other', async () => {
    const results = await Promise.all([playFullGame(URL, 6), playFullGame(URL, 10), playFullGame(URL, 7)]);
    for (const r of results) {
      expect(['village', 'mafia']).toContain(r.winner);
      expect(r.privacyViolations).toEqual([]);
    }
    expect(new Set(results.map((r) => r.code)).size).toBe(3);
  }, 150_000);
});

describe('lobby, rejoin and TV', () => {
  it('creates, joins, rejects bad codes and duplicate names, and rejoins by token', async () => {
    const host = await connect();
    const created = await emit(host, 'room:create', { name: 'Seamus' });
    expect(created.ok).toBe(true);
    expect(created.code).toMatch(/^[A-HJ-NP-Z]{4}$/);

    const guest = await connect();
    expect(await emit(guest, 'room:join', { code: 'ZZZZ', name: 'Niamh' })).toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
    expect(await emit(guest, 'room:join', { code: created.code, name: 'seamus' })).toMatchObject({ ok: false, code: 'NAME_TAKEN' });
    const joined = await emit(guest, 'room:join', { code: String(created.code).toLowerCase(), name: 'Niamh' });
    expect(joined.ok).toBe(true);

    // The guest's phone locks: a brand new socket rejoins with the saved token.
    guest.disconnect();
    const guest2 = await connect();
    const viewP = nextView(guest2);
    expect(await emit(guest2, 'room:rejoin', { code: created.code, token: joined.token })).toMatchObject({ ok: true });
    const v = await viewP;
    expect(v.me?.name).toBe('Niamh');
    expect(v.players.map((p) => p.name)).toEqual(['Seamus', 'Niamh']);

    expect(await emit(guest2, 'room:rejoin', { code: created.code, token: 'nope' })).toMatchObject({ ok: false, code: 'BAD_TOKEN' });
    expect(await emit(guest2, 'host:start', {})).toMatchObject({ ok: false, code: 'NOT_HOST' });
    expect(await emit(host, 'host:start', {})).toMatchObject({ ok: false, code: 'NOT_ENOUGH_PLAYERS' });
    host.disconnect();
    guest2.disconnect();
  });

  it('shows the TV a public view with no roles or tokens, even at night', async () => {
    const bots = ['A', 'B', 'C', 'D', 'E'].map((n) => new Bot(`Tv${n}`, URL, n === 'A' ? 5 : undefined));
    const code = await bots[0]!.create();
    const tv = await connect();
    const first = nextView(tv, 'state:public');
    expect(await emit(tv, 'tv:join', { code })).toMatchObject({ ok: true });
    await first;
    const seen: View[] = [];
    tv.on('state:public', (v: View) => seen.push(v));
    for (const b of bots.slice(1)) await b.join(code);
    await nextView(tv, 'state:public', (v) => v.phase === 'night');
    await new Promise((r) => setTimeout(r, 800));
    expect(seen.length).toBeGreaterThan(3);
    for (const v of seen) {
      // Only players who have been barred or killed may have a public role; nobody still living does.
      if (v.phase !== 'gameOver') expect(v.players.filter((p) => p.alive).every((p) => p.role === undefined)).toBe(true);
      expect(v.me).toBeUndefined();
      expect(JSON.stringify(v)).not.toMatch(/"token"/);
    }
    bots.forEach((b) => b.close());
    tv.disconnect();
  }, 30_000);

  it('removes a kicked player and tells them', async () => {
    const host = await connect();
    const c = await emit(host, 'room:create', { name: 'Host' });
    const g = await connect();
    const j = await emit(g, 'room:join', { code: c.code, name: 'Rowdy' });
    const kicked = new Promise<void>((resolve) => g.on('room:kicked', () => resolve()));
    expect(await emit(host, 'host:kick', { playerId: j.playerId })).toMatchObject({ ok: true });
    await kicked;
    const probe = await connect();
    expect(await emit(probe, 'room:rejoin', { code: c.code, token: j.token })).toMatchObject({ ok: false, code: 'BAD_TOKEN' });
    host.disconnect();
    probe.disconnect();
  });

  it('rejects malformed payloads without crashing the server', async () => {
    const s = await connect();
    expect(await emit(s, 'room:create', null)).toMatchObject({ ok: false });
    expect(await emit(s, 'room:create', { name: { evil: true } })).toMatchObject({ ok: false, code: 'BAD_NAME' });
    expect(await emit(s, 'room:join', 'garbage')).toMatchObject({ ok: false });
    expect(await emit(s, 'night:action', { targetId: 5 })).toMatchObject({ ok: false, code: 'NO_SESSION' });
    const ok = await emit(s, 'room:create', { name: 'StillUp' });
    expect(ok.ok).toBe(true);
    s.disconnect();
  });
});
