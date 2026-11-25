import { randomBytes, randomInt } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import {
  addPlayer,
  createGame,
  extendPhase,
  getPlayer,
  hostPause,
  hostResume,
  kickPlayer,
  markReady,
  pauseGame,
  resetToLobby,
  setConnected,
  skipPhase,
  startGame,
  submitNightAction,
  submitVote,
  tick,
  updateSettings,
  type Res,
  type Rng,
} from '../shared/engine';
import { viewFor } from '../shared/views';
import { CODE_LENGTH, CODE_LETTERS, MIN_PLAYERS, type Ack, type Game } from '../shared/types';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT ?? 3000);
const DATA_DIR = process.env.WBM_DATA_DIR ?? path.resolve(process.cwd(), 'data');
const FAST = process.env.WBM_FAST === '1'; // tiny timers, for automated tests
const DEMO = process.env.WBM_FAST === '2'; // moderate timers, for screenshots and rehearsals
const MIN = Math.max(4, Number(process.env.WBM_MIN_PLAYERS ?? MIN_PLAYERS));
const ROOM_IDLE_MS = 12 * 60 * 60 * 1000;
const SNAPSHOT_FILE = path.join(DATA_DIR, 'games.json');

export const rng: Rng = {
  int: (max) => randomInt(max),
  token: (length) => randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length),
};

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

interface Room {
  game: Game;
  sockets: Map<string, string>; // playerId -> socket id
  tvs: Set<string>; // socket ids
}

const rooms = new Map<string, Room>();
let dirty = false;

const touch = (room: Room, now = Date.now()) => {
  room.game.updatedAt = now;
  dirty = true;
};

function newCode(): string {
  for (let tries = 0; tries < 1000; tries++) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_LETTERS[randomInt(CODE_LETTERS.length)];
    if (!rooms.has(code)) return code;
  }
  throw new Error('No room codes left');
}

function applyFast(game: Game) {
  if (DEMO) {
    Object.assign(game.settings, { targetMinutes: null, revealSecs: 12, nightSecs: 12, nightMinSecs: 6, dawnSecs: 6, discussSecs: 30, voteSecs: 20, verdictSecs: 6 });
    return;
  }
  if (!FAST) return;
  Object.assign(game.settings, {
    targetMinutes: null,
    revealSecs: 2,
    nightSecs: 3,
    nightMinSecs: 0,
    dawnSecs: 1,
    discussSecs: 3,
    voteSecs: 3,
    verdictSecs: 1,
  });
}

// ---------------------------------------------------------------------------
// HTTP + sockets
// ---------------------------------------------------------------------------

const app = express();
app.disable('x-powered-by');
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 10_000, pingInterval: 10_000, pingTimeout: 15_000 });

app.get('/healthz', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

const clientDir = fileURLToPath(new URL('../../dist/client', import.meta.url));
if (fs.existsSync(clientDir)) {
  app.use(express.static(clientDir, { maxAge: '1h', index: false }));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDir, 'index.html')));
} else {
  app.get('/', (_req, res) => res.type('text').send('Client not built. Run "npm run build", or "npm run dev" for development.'));
}

function broadcast(room: Room) {
  const now = Date.now();
  for (const [playerId, socketId] of room.sockets) {
    io.to(socketId).emit('state:view', viewFor(room.game, playerId, now, MIN));
  }
  if (room.tvs.size) {
    const pub = viewFor(room.game, undefined, now, MIN);
    for (const id of room.tvs) io.to(id).emit('state:public', pub);
  }
}

const failAck = (code: string, message: string): Ack => ({ ok: false, code, message });
const toAck = (r: Res): Ack => (r.ok ? { ok: true } : failAck(r.code, r.message));

// Slow down anyone guessing room codes.
const misses = new Map<string, number[]>();
function tooManyMisses(ip: string): boolean {
  const now = Date.now();
  const list = (misses.get(ip) ?? []).filter((t) => now - t < 60_000);
  misses.set(ip, list);
  return list.length >= 10;
}
const recordMiss = (ip: string) => misses.set(ip, [...(misses.get(ip) ?? []), Date.now()]);
const clientIp = (s: Socket) => String(s.handshake.headers['x-forwarded-for'] ?? s.handshake.address).split(',')[0]!.trim();

type Handler<T> = (payload: T, ack: (a: Ack) => void) => void;

function safe<T>(fn: Handler<T>): (payload: T, ack?: (a: Ack) => void) => void {
  return (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => undefined;
    try {
      fn((payload ?? {}) as T, reply);
    } catch (err) {
      console.error('handler error', err);
      reply(failAck('SERVER_ERROR', 'Something went wrong. Try again.'));
    }
  };
}

const str = (v: unknown, max = 64) => (typeof v === 'string' ? v.slice(0, max) : '');

function attach(socket: Socket, room: Room, playerId: string) {
  detach(socket);
  const prev = room.sockets.get(playerId);
  if (prev && prev !== socket.id) io.sockets.sockets.get(prev)?.disconnect(true);
  room.sockets.set(playerId, socket.id);
  socket.data.code = room.game.code;
  socket.data.playerId = playerId;
  setConnected(room.game, playerId, true, Date.now());
  touch(room);
}

function detach(socket: Socket) {
  const { code, playerId } = socket.data as { code?: string; playerId?: string };
  const room = code ? rooms.get(code) : undefined;
  if (room && playerId && room.sockets.get(playerId) === socket.id) {
    room.sockets.delete(playerId);
    setConnected(room.game, playerId, false, Date.now());
    dirty = true;
    broadcast(room);
  }
  if (room) room.tvs.delete(socket.id);
  socket.data.code = undefined;
  socket.data.playerId = undefined;
}

function sessionOf(socket: Socket): { room: Room; playerId: string } | undefined {
  const { code, playerId } = socket.data as { code?: string; playerId?: string };
  const room = code ? rooms.get(code) : undefined;
  if (!room || !playerId || !getPlayer(room.game, playerId)) return undefined;
  return { room, playerId };
}

io.on('connection', (socket) => {
  socket.on(
    'room:create',
    safe<{ name?: unknown }>(({ name }, ack) => {
      if (rooms.size >= 200) return ack(failAck('SERVER_BUSY', 'Too many pubs open. Try later.'));
      const code = newCode();
      const created = createGame(code, name, Date.now(), rng);
      if (!created.ok) return ack(failAck(created.code, created.message));
      applyFast(created.game);
      const room: Room = { game: created.game, sockets: new Map(), tvs: new Set() };
      rooms.set(code, room);
      attach(socket, room, created.player.id);
      ack({ ok: true, code, token: created.player.token, playerId: created.player.id });
      broadcast(room);
    }),
  );

  socket.on(
    'room:join',
    safe<{ code?: unknown; name?: unknown }>(({ code, name }, ack) => {
      const ip = clientIp(socket);
      if (tooManyMisses(ip)) return ack(failAck('TOO_MANY', 'Too many wrong codes. Wait a minute.'));
      const room = rooms.get(str(code, 8).toUpperCase());
      if (!room) {
        recordMiss(ip);
        return ack(failAck('ROOM_NOT_FOUND', "No pub with that code. Check the TV or ask the host."));
      }
      const r = addPlayer(room.game, name, Date.now(), rng);
      if (!r.ok) return ack(failAck(r.code, r.message));
      attach(socket, room, r.player.id);
      ack({ ok: true, code: room.game.code, token: r.player.token, playerId: r.player.id });
      broadcast(room);
    }),
  );

  socket.on(
    'room:rejoin',
    safe<{ code?: unknown; token?: unknown }>(({ code, token }, ack) => {
      const ip = clientIp(socket);
      if (tooManyMisses(ip)) return ack(failAck('TOO_MANY', 'Too many tries. Wait a minute.'));
      const room = rooms.get(str(code, 8).toUpperCase());
      if (!room) {
        recordMiss(ip);
        return ack(failAck('ROOM_NOT_FOUND', 'That pub has closed.'));
      }
      const t = str(token, 64);
      const player = t ? room.game.players.find((p) => p.token === t) : undefined;
      if (!player) {
        recordMiss(ip);
        return ack(failAck('BAD_TOKEN', 'You are not in that game any more.'));
      }
      attach(socket, room, player.id);
      ack({ ok: true, code: room.game.code, playerId: player.id });
      broadcast(room);
    }),
  );

  socket.on(
    'tv:join',
    safe<{ code?: unknown }>(({ code }, ack) => {
      const ip = clientIp(socket);
      if (tooManyMisses(ip)) return ack(failAck('TOO_MANY', 'Too many wrong codes. Wait a minute.'));
      const room = rooms.get(str(code, 8).toUpperCase());
      if (!room) {
        recordMiss(ip);
        return ack(failAck('ROOM_NOT_FOUND', 'No pub with that code.'));
      }
      detach(socket);
      room.tvs.add(socket.id);
      socket.data.code = room.game.code;
      ack({ ok: true });
      socket.emit('state:public', viewFor(room.game, undefined, Date.now(), MIN));
    }),
  );

  socket.on(
    'room:leave',
    safe<unknown>((_p, ack) => {
      const s = sessionOf(socket);
      if (s && s.room.game.phase === 'lobby') {
        const wasHost = getPlayer(s.room.game, s.playerId)?.isHost;
        s.room.sockets.delete(s.playerId);
        s.room.game.players = s.room.game.players.filter((p) => p.id !== s.playerId);
        if (wasHost) {
          const next = s.room.game.players.find((p) => p.connected);
          if (next) next.isHost = true;
        }
        socket.data.code = undefined;
        socket.data.playerId = undefined;
        touch(s.room);
        if (s.room.game.players.length === 0) rooms.delete(s.room.game.code);
        else broadcast(s.room);
      } else {
        detach(socket);
      }
      ack({ ok: true });
    }),
  );

  // Every in-room action goes through here: find the session, run the engine, advance the clock, broadcast.
  const action = <T>(event: string, run: (game: Game, playerId: string, payload: T) => Res) =>
    socket.on(
      event,
      safe<T>((payload, ack) => {
        const s = sessionOf(socket);
        if (!s) return ack(failAck('NO_SESSION', 'You are not in a game. Refresh and rejoin.'));
        const now = Date.now();
        const r = run(s.room.game, s.playerId, payload);
        if (r.ok) {
          touch(s.room, now);
          tick(s.room.game, now, rng); // e.g. everyone has now locked in
          broadcast(s.room);
        }
        ack(toAck(r));
      }),
    );

  action<{ settings?: Record<string, unknown> }>('host:settings', (g, id, p) => {
    const r = updateSettings(g, id, p.settings && typeof p.settings === 'object' ? p.settings : {});
    if (r.ok) applyFastIfLobby(g);
    return r;
  });
  action<unknown>('host:start', (g, id) => {
    const r = startGame(g, id, Date.now(), rng, MIN);
    return r;
  });
  action<unknown>('host:pause', (g, id) => hostPause(g, id, Date.now()));
  action<unknown>('host:resume', (g, id) => hostResume(g, id, Date.now()));
  action<unknown>('host:extend', (g, id) => extendPhase(g, id));
  action<unknown>('host:skip', (g, id) => skipPhase(g, id, Date.now()));
  action<unknown>('host:reset', (g, id) => resetToLobby(g, id));
  action<{ playerId?: unknown }>('host:kick', (g, id, p) => {
    const target = str(p.playerId);
    const r = kickPlayer(g, id, target, Date.now(), rng);
    if (r.ok) {
      for (const room of rooms.values()) {
        if (room.game === g) {
          const sid = room.sockets.get(target);
          if (sid) {
            io.to(sid).emit('room:kicked');
            room.sockets.delete(target);
            io.sockets.sockets.get(sid)?.disconnect(true);
          }
        }
      }
    }
    return r;
  });
  action<unknown>('role:ready', (g, id) => markReady(g, id));
  action<{ targetId?: unknown }>('night:action', (g, id, p) => submitNightAction(g, id, p.targetId));
  action<{ targetId?: unknown }>('day:vote', (g, id, p) => submitVote(g, id, p.targetId));

  socket.on('disconnect', () => detach(socket));
});

/** In fast test mode, settings edits must not undo the shortened timers. */
function applyFastIfLobby(g: Game) {
  if (g.phase === 'lobby') applyFast(g);
}

// ---------------------------------------------------------------------------
// The clock: every half second, advance any game whose deadline has passed.
// ---------------------------------------------------------------------------

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.game.updatedAt > ROOM_IDLE_MS) {
      for (const id of [...room.sockets.values(), ...room.tvs]) io.to(id).emit('room:closed');
      rooms.delete(code);
      dirty = true;
      continue;
    }
    if (tick(room.game, now, rng)) {
      dirty = true;
      broadcast(room);
    }
  }
}, 500);

// ---------------------------------------------------------------------------
// Snapshots: a server restart should not end the party.
// ---------------------------------------------------------------------------

function saveSnapshot() {
  if (!dirty) return;
  dirty = false;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${SNAPSHOT_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify([...rooms.values()].map((r) => r.game)));
    fs.renameSync(tmp, SNAPSHOT_FILE);
  } catch (err) {
    console.error('snapshot failed', err);
  }
}

function loadSnapshot() {
  try {
    if (!fs.existsSync(SNAPSHOT_FILE)) return;
    const games = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8')) as Game[];
    const now = Date.now();
    for (const game of games) {
      if (now - game.updatedAt > ROOM_IDLE_MS) continue;
      for (const p of game.players) {
        p.connected = false;
        p.disconnectedAt = now;
      }
      pauseGame(game, now, true); // nobody is connected yet; resumes when the first player returns
      rooms.set(game.code, { game, sockets: new Map(), tvs: new Set() });
    }
    if (rooms.size) console.log(`Restored ${rooms.size} game(s) from snapshot`);
  } catch (err) {
    console.error('could not load snapshot', err);
  }
}

setInterval(saveSnapshot, 2000);
function shutdown() {
  dirty = true;
  saveSnapshot();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

loadSnapshot();
server.listen(PORT, () => console.log(`The W.B. Mates Traitors is open on http://localhost:${PORT}${FAST || DEMO ? ' (test timers)' : ''}`));

