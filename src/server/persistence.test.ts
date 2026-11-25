import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { afterAll, describe, expect, it } from 'vitest';
import type { Ack, View } from '../shared/types';

const PORT = 3800 + Math.floor(Math.random() * 90);
const URL = `http://localhost:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wbm-persist-'));
let proc: ChildProcess | undefined;

async function startServer() {
  proc = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), WBM_FAST: '1', WBM_MIN_PLAYERS: '4', WBM_DATA_DIR: dir },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 20_000);
    proc!.stdout!.on('data', (d: Buffer) => {
      if (String(d).includes('is open')) {
        clearTimeout(t);
        resolve();
      }
    });
  });
}

function stopServer() {
  return new Promise<void>((resolve) => {
    if (!proc) return resolve();
    proc.once('exit', () => resolve());
    proc.kill('SIGTERM'); // the server writes a final snapshot on SIGTERM
  });
}

const connect = (): Promise<Socket> =>
  new Promise((resolve) => {
    const s = io(URL, { transports: ['websocket'], forceNew: true });
    s.on('connect', () => resolve(s));
  });
const emit = (s: Socket, event: string, payload: unknown): Promise<Ack> => new Promise((r) => s.emit(event, payload, r));

afterAll(async () => {
  await stopServer();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('server restart', () => {
  it('restores a game in progress, keeps roles, and lets everyone rejoin with their token', async () => {
    await startServer();
    const names = ['Aoife', 'Brian', 'Ciara', 'Declan'];
    const socks: Socket[] = [];
    const creds: { token: string; role?: string; name: string }[] = [];

    const host = await connect();
    const created = await emit(host, 'room:create', { name: names[0] });
    socks.push(host);
    creds.push({ token: created.token as string, name: names[0]! });
    for (const n of names.slice(1)) {
      const s = await connect();
      const j = await emit(s, 'room:join', { code: created.code, name: n });
      socks.push(s);
      creds.push({ token: j.token as string, name: n });
    }
    // Record each player's role as the server dealt it.
    const latest: View[] = [];
    socks.forEach((s, i) => s.on('state:view', (v: View) => (latest[i] = v)));
    expect(await emit(host, 'host:start', {})).toMatchObject({ ok: true });
    await new Promise((r) => setTimeout(r, 400));
    creds.forEach((c, i) => (c.role = latest[i]?.me?.role));
    expect(creds.every((c) => c.role)).toBe(true);

    await new Promise((r) => setTimeout(r, 2500)); // let a periodic snapshot land too
    socks.forEach((s) => s.disconnect());
    await stopServer();
    await startServer();

    // Everyone returns on fresh sockets with only their saved token.
    for (const [i, c] of creds.entries()) {
      const s = await connect();
      const viewP = new Promise<View>((resolve) => s.once('state:view', resolve));
      expect(await emit(s, 'room:rejoin', { code: created.code, token: c.token })).toMatchObject({ ok: true });
      const v = await viewP;
      expect(v.me?.name).toBe(c.name);
      expect(v.me?.role).toBe(c.role); // same role as before the restart
      expect(v.players).toHaveLength(4);
      expect(['roleReveal', 'night', 'dawn', 'day', 'vote', 'verdict', 'gameOver']).toContain(v.phase);
      if (i === 0) expect(v.me?.isHost).toBe(true);
      s.disconnect();
    }
  }, 60_000);
});
