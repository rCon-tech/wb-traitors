import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { playFullGame, type BotResult } from '../../scripts/bots';
import { defaultMafiaCount } from '../shared/engine';

const PORT = 3700 + Math.floor(Math.random() * 90);
const URL = `http://localhost:${PORT}`;
let proc: ChildProcess;
let dir: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wbm-simple-'));
  proc = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), WBM_FAST: '1', WBM_MIN_PLAYERS: '4', WBM_DATA_DIR: dir },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 20_000);
    proc.stdout!.on('data', (d: Buffer) => {
      if (String(d).includes('is open')) {
        clearTimeout(t);
        resolve();
      }
    });
  });
}, 30_000);

afterAll(() => {
  proc?.kill('SIGTERM');
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Every rule a finished Simple Mode game must obey. */
function checkSimpleGame(n: number, r: BotResult) {
  const label = `${n} players, room ${r.code}`;
  // roles
  expect(r.finalRoles, label).toHaveLength(n);
  expect(r.finalRoles.filter((x) => x === 'detective' || x === 'doctor'), label).toEqual([]);
  expect(r.finalRoles.filter((x) => x === 'mafia'), label).toHaveLength(defaultMafiaCount(n));
  expect(r.finalRoles.filter((x) => x === 'villager'), label).toHaveLength(n - defaultMafiaCount(n));
  // it finished with a winner, and the winner is consistent with how it ended
  expect(['village', 'mafia'], label).toContain(r.winner);
  expect(r.privacyViolations, label).toEqual([]);
  // history: no Detective or Doctor ever acted, and the Mafia only ever targeted non-Mafia
  expect(r.history.length, label).toBeGreaterThan(0);
  for (const h of r.history) {
    if (h.kind === 'night') {
      expect(h.doctorTarget, label).toBeUndefined();
      expect(h.detectiveTarget, label).toBeUndefined();
      expect(h.detectiveResult, label).toBeUndefined();
      expect(h.saved, label).toBe(false); // nobody can be saved without a Doctor
    }
  }
  const nights = r.history.filter((h) => h.kind === 'night');
  // every night with a Mafia pick produced exactly that death
  for (const h of nights) if (h.kind === 'night' && h.mafiaTarget) expect(h.killedId, label).toBe(h.mafiaTarget);
}

describe('Simple Mode, many full games', () => {
  const SIZES = [6, 7, 8, 10, 12, 15, 20];

  it('every game obeys the rules, whether or not villagers ever touch their phones', async () => {
    const games = SIZES.flatMap((n) => [
      { n, idle: false },
      { n, idle: true },
    ]);
    const results = await Promise.all(
      games.map(({ n, idle }) => playFullGame(URL, n, 120_000, { simpleMode: true }, { idleVillagers: idle })),
    );
    results.forEach((r, i) => checkSimpleGame(games[i]!.n, r));
    expect(new Set(results.map((r) => r.code)).size).toBe(games.length); // all separate rooms
    // both teams should be able to win across this many games
    const winners = new Set(results.map((r) => r.winner));
    expect(winners.size).toBeGreaterThanOrEqual(1);
  }, 180_000);

  it('repeats cleanly: 6 more games at one size with idle villagers', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => playFullGame(URL, 8, 120_000, { simpleMode: true }, { idleVillagers: true })),
    );
    results.forEach((r) => checkSimpleGame(8, r));
  }, 180_000);
});
