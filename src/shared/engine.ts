// The whole game, as pure state transitions. No sockets, no timers, no I/O:
// everything that needs "now" or randomness takes it as an argument, so it is easy to test.

import { narrate } from './narration';
import { dayLengthSecs } from './schedule';
import {
  HOST_GRACE_MS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  NAME_MAX,
  NAME_MIN,
  type Game,
  type HistoryEntry,
  type Player,
  type Role,
  type Settings,
  type Team,
} from './types';

export interface Rng {
  /** Integer in [0, max). */
  int(max: number): number;
  /** Random hex string of the given length. */
  token(length: number): string;
}

export type Fail = { ok: false; code: string; message: string };
export type Res<T extends object = object> = ({ ok: true } & T) | Fail;
const fail = (code: string, message: string): Fail => ({ ok: false, code, message });
const OK = { ok: true } as const;

export const DEFAULT_SETTINGS: Settings = {
  mafiaCount: null,
  targetMinutes: 120,
  simpleMode: false,
  revealOnDeath: true,
  christmas: true,
  revealSecs: 25,
  nightSecs: 90,
  nightMinSecs: 30,
  dawnSecs: 12,
  discussSecs: 300,
  voteSecs: 60,
  verdictSecs: 10,
};

export function shuffle<T>(items: T[], rng: Rng): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

// ---------------------------------------------------------------------------
// Lookups and role arithmetic
// ---------------------------------------------------------------------------

export const getPlayer = (game: Game, id: string | undefined): Player | undefined =>
  id === undefined ? undefined : game.players.find((p) => p.id === id);

export const alivePlayers = (game: Game) => game.players.filter((p) => p.alive);

export function defaultMafiaCount(n: number): number {
  if (n <= 7) return 1;
  if (n <= 11) return 2;
  if (n <= 15) return 3;
  return 4;
}

/** Mafia must always start as a strict minority, with room left for the Detective and Doctor. */
export function maxMafia(n: number): number {
  return Math.max(1, Math.floor((n - 1) / 2));
}

export function effectiveMafiaCount(game: Game): number {
  const n = game.players.length;
  const wanted = game.settings.mafiaCount ?? defaultMafiaCount(n);
  return Math.min(Math.max(1, wanted), maxMafia(n));
}

export function roleCounts(n: number, mafia: number, simple = false): Record<Role, number> {
  if (simple) return { mafia, detective: 0, doctor: 0, villager: Math.max(0, n - mafia) };
  return { mafia, detective: 1, doctor: 1, villager: Math.max(0, n - mafia - 2) };
}

export function checkWin(game: Game): Team | undefined {
  const alive = alivePlayers(game);
  const mafia = alive.filter((p) => p.role === 'mafia').length;
  const others = alive.length - mafia;
  if (mafia === 0) return 'village';
  if (mafia >= others) return 'mafia';
  return undefined;
}

// ---------------------------------------------------------------------------
// Creating and joining
// ---------------------------------------------------------------------------

export function normaliseName(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
}

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} '.\-_]*$/u;

function validateName(existing: Player[], raw: unknown): Res<{ name: string }> {
  const name = normaliseName(raw);
  if (name.length < NAME_MIN || name.length > NAME_MAX || !NAME_RE.test(name)) {
    return fail('BAD_NAME', `Pick a name between ${NAME_MIN} and ${NAME_MAX} characters, letters and numbers only.`);
  }
  if (existing.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    return fail('NAME_TAKEN', `There's already a ${name} at the bar. Try another name.`);
  }
  return { ok: true, name };
}

function makePlayer(name: string, isHost: boolean, now: number, rng: Rng): Player {
  return {
    id: rng.token(8),
    token: rng.token(32),
    name,
    alive: true,
    connected: true,
    isHost,
    joinedAt: now,
    revealed: false,
    doctorSelfSaveUsed: false,
  };
}

export function createGame(code: string, hostName: unknown, now: number, rng: Rng): Res<{ game: Game; player: Player }> {
  const n = validateName([], hostName);
  if (!n.ok) return n;
  const player = makePlayer(n.name, true, now, rng);
  const game: Game = {
    code,
    phase: 'lobby',
    round: 0,
    players: [player],
    settings: { ...DEFAULT_SETTINGS },
    nightPicks: {},
    dayVotes: {},
    ready: {},
    extended: false,
    history: [],
    detectiveNotes: [],
    createdAt: now,
    updatedAt: now,
  };
  return { ok: true, game, player };
}

export function addPlayer(game: Game, rawName: unknown, now: number, rng: Rng): Res<{ player: Player }> {
  if (game.phase !== 'lobby') {
    return fail('GAME_STARTED', 'The doors are locked: a game is already under way. Ask for a rematch after it ends.');
  }
  if (game.players.length >= MAX_PLAYERS) return fail('ROOM_FULL', `The pub is full (${MAX_PLAYERS} players max).`);
  const n = validateName(game.players, rawName);
  if (!n.ok) return n;
  const player = makePlayer(n.name, false, now, rng);
  game.players.push(player);
  return { ok: true, player };
}

// ---------------------------------------------------------------------------
// Host controls
// ---------------------------------------------------------------------------

function requireHost(game: Game, id: string): Fail | undefined {
  const p = getPlayer(game, id);
  if (!p?.isHost) return fail('NOT_HOST', 'Only the host can do that.');
  return undefined;
}

const int = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : undefined;

export function updateSettings(game: Game, hostId: string, patch: Record<string, unknown>): Res {
  const err = requireHost(game, hostId);
  if (err) return err;
  if (game.phase !== 'lobby') return fail('BAD_PHASE', 'Settings can only change in the lobby.');
  const s = game.settings;
  if ('mafiaCount' in patch) {
    if (patch.mafiaCount === null) s.mafiaCount = null;
    else {
      const v = int(patch.mafiaCount, 1, MAX_PLAYERS);
      if (v === undefined) return fail('BAD_SETTING', 'Invalid Mafia count.');
      s.mafiaCount = v;
    }
  }
  if ('targetMinutes' in patch) {
    if (patch.targetMinutes === null) s.targetMinutes = null;
    else {
      const v = int(patch.targetMinutes, 30, 240);
      if (v === undefined) return fail('BAD_SETTING', 'Invalid game length.');
      s.targetMinutes = v;
    }
  }
  if ('simpleMode' in patch) {
    if (typeof patch.simpleMode !== 'boolean') return fail('BAD_SETTING', 'Invalid setting.');
    s.simpleMode = patch.simpleMode;
  }
  if ('revealOnDeath' in patch) {
    if (typeof patch.revealOnDeath !== 'boolean') return fail('BAD_SETTING', 'Invalid setting.');
    s.revealOnDeath = patch.revealOnDeath;
  }
  if ('christmas' in patch) {
    if (typeof patch.christmas !== 'boolean') return fail('BAD_SETTING', 'Invalid setting.');
    s.christmas = patch.christmas;
  }
  if ('discussSecs' in patch) {
    const v = int(patch.discussSecs, 30, 1800);
    if (v === undefined) return fail('BAD_SETTING', 'Invalid discussion time.');
    s.discussSecs = v;
  }
  if ('voteSecs' in patch) {
    const v = int(patch.voteSecs, 15, 300);
    if (v === undefined) return fail('BAD_SETTING', 'Invalid voting time.');
    s.voteSecs = v;
  }
  return OK;
}

export function startGame(game: Game, hostId: string, now: number, rng: Rng, minPlayers = MIN_PLAYERS): Res {
  const err = requireHost(game, hostId);
  if (err) return err;
  if (game.phase !== 'lobby') return fail('BAD_PHASE', 'The game has already started.');
  const n = game.players.length;
  if (n < minPlayers) return fail('NOT_ENOUGH_PLAYERS', `You need at least ${minPlayers} players (${n} here).`);

  const mafia = effectiveMafiaCount(game);
  const order = shuffle(game.players.map((p) => p.id), rng);
  const special: Role[] = game.settings.simpleMode ? [] : ['detective', 'doctor'];
  const roles: Role[] = [
    ...Array<Role>(mafia).fill('mafia'),
    ...special,
    ...Array<Role>(Math.max(0, n - mafia - special.length)).fill('villager'),
  ];
  order.forEach((id, i) => {
    const p = getPlayer(game, id) as Player;
    p.role = roles[i];
    p.alive = true;
    p.revealed = false;
    p.kicked = false;
    p.doctorSelfSaveUsed = false;
    p.lastProtectedId = undefined;
  });
  game.round = 0;
  game.history = [];
  game.detectiveNotes = [];
  game.nightPicks = {};
  game.dayVotes = {};
  game.ready = {};
  game.winner = undefined;
  game.dawn = undefined;
  game.verdict = undefined;
  game.pausedAt = undefined;
  game.autoPaused = false;
  game.scheduleStart = undefined;
  game.phase = 'roleReveal';
  game.phaseEndsAt = now + game.settings.revealSecs * 1000;
  game.narration = narrate.roleReveal(rng);
  return OK;
}

export function kickPlayer(game: Game, hostId: string, targetId: string, now: number, rng: Rng): Res {
  const err = requireHost(game, hostId);
  if (err) return err;
  const target = getPlayer(game, targetId);
  if (!target) return fail('NO_SUCH_PLAYER', 'No such player.');
  if (target.isHost) return fail('BAD_TARGET', "You can't kick yourself.");
  if (game.phase === 'lobby') {
    game.players = game.players.filter((p) => p.id !== targetId);
    return OK;
  }
  if (game.phase === 'gameOver') return fail('BAD_PHASE', 'The game is over.');
  if (target.alive) {
    target.alive = false;
    target.kicked = true;
    target.revealed = true;
    const w = checkWin(game);
    if (w) {
      game.winner = w;
      endGame(game, now, rng);
    }
  }
  return OK;
}

/** Back to the lobby with the same people. Used by "Play again" and "End game". */
export function resetToLobby(game: Game, hostId: string): Res {
  const err = requireHost(game, hostId);
  if (err) return err;
  if (game.phase === 'lobby') return fail('BAD_PHASE', "You're already in the lobby.");
  game.players = game.players.filter((p) => p.connected || p.isHost);
  for (const p of game.players) {
    p.role = undefined;
    p.alive = true;
    p.revealed = false;
    p.kicked = false;
    p.doctorSelfSaveUsed = false;
    p.lastProtectedId = undefined;
  }
  game.phase = 'lobby';
  game.round = 0;
  game.nightPicks = {};
  game.dayVotes = {};
  game.ready = {};
  game.history = [];
  game.detectiveNotes = [];
  game.winner = undefined;
  game.dawn = undefined;
  game.verdict = undefined;
  game.narration = undefined;
  game.phaseEndsAt = undefined;
  game.nightMinAt = undefined;
  game.scheduleStart = undefined;
  game.pausedAt = undefined;
  game.autoPaused = false;
  game.extended = false;
  return OK;
}

const TIMED: Game['phase'][] = ['roleReveal', 'night', 'dawn', 'day', 'vote', 'verdict'];

export function pauseGame(game: Game, now: number, auto = false): Res {
  if (!TIMED.includes(game.phase)) return fail('BAD_PHASE', "There's nothing to pause right now.");
  if (game.pausedAt !== undefined) return OK;
  game.pausedAt = now;
  game.autoPaused = auto;
  return OK;
}

export function resumeGame(game: Game, now: number): Res {
  if (game.pausedAt === undefined) return OK;
  const shift = now - game.pausedAt;
  if (game.phaseEndsAt !== undefined) game.phaseEndsAt += shift;
  if (game.nightMinAt !== undefined) game.nightMinAt += shift;
  if (game.scheduleStart !== undefined) game.scheduleStart += shift;
  game.pausedAt = undefined;
  game.autoPaused = false;
  return OK;
}

export function hostPause(game: Game, hostId: string, now: number): Res {
  return requireHost(game, hostId) ?? pauseGame(game, now, false);
}

export function hostResume(game: Game, hostId: string, now: number): Res {
  return requireHost(game, hostId) ?? resumeGame(game, now);
}

export function extendPhase(game: Game, hostId: string): Res {
  const err = requireHost(game, hostId);
  if (err) return err;
  if (game.phase !== 'day' && game.phase !== 'vote') return fail('BAD_PHASE', 'You can only extend the discussion or the vote.');
  if (game.extended) return fail('ALREADY_EXTENDED', 'You already extended this round.');
  game.extended = true;
  game.phaseEndsAt = (game.phaseEndsAt ?? 0) + 60_000;
  return OK;
}

/** Skip ahead. Never allowed at night, so nobody can speed through the secret actions. */
export function skipPhase(game: Game, hostId: string, now: number): Res {
  const err = requireHost(game, hostId);
  if (err) return err;
  if (!['roleReveal', 'dawn', 'day', 'vote', 'verdict'].includes(game.phase)) {
    return fail('BAD_PHASE', "You can't skip that part.");
  }
  if (game.pausedAt !== undefined) return fail('PAUSED', 'Resume the game first.');
  game.phaseEndsAt = now;
  return OK;
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

export function setConnected(game: Game, playerId: string, connected: boolean, now: number): void {
  const p = getPlayer(game, playerId);
  if (!p) return;
  p.connected = connected;
  p.disconnectedAt = connected ? undefined : now;
  const anyone = game.players.some((q) => q.connected);
  if (!anyone && game.pausedAt === undefined && TIMED.includes(game.phase)) {
    pauseGame(game, now, true);
  } else if (connected && game.autoPaused) {
    resumeGame(game, now);
  }
}

/** Host leaves for more than a minute: the longest-standing connected player takes over. */
function reassignHost(game: Game, now: number): boolean {
  const host = game.players.find((p) => p.isHost);
  const gone = !host || (!host.connected && host.disconnectedAt !== undefined && now - host.disconnectedAt >= HOST_GRACE_MS);
  if (!gone) return false;
  const next = game.players
    .filter((p) => p.connected && !p.kicked && p.id !== host?.id)
    .sort((a, b) => a.joinedAt - b.joinedAt)[0];
  if (!next) return false;
  if (host) host.isHost = false;
  next.isHost = true;
  return true;
}

// ---------------------------------------------------------------------------
// Role reveal
// ---------------------------------------------------------------------------

export function markReady(game: Game, playerId: string): Res {
  if (game.phase !== 'roleReveal') return fail('BAD_PHASE', 'Not now.');
  if (!getPlayer(game, playerId)) return fail('NO_SUCH_PLAYER', 'No such player.');
  game.ready[playerId] = true;
  return OK;
}

// ---------------------------------------------------------------------------
// Night
// ---------------------------------------------------------------------------

function enterNight(game: Game, now: number, rng: Rng): void {
  game.round += 1;
  if (game.round === 1) game.scheduleStart = now;
  game.phase = 'night';
  game.nightPicks = {};
  game.dawn = undefined;
  game.verdict = undefined;
  game.phaseEndsAt = now + game.settings.nightSecs * 1000;
  game.nightMinAt = now + game.settings.nightMinSecs * 1000;
  game.narration = narrate.night(rng);
}

/**
 * Who this player may pick tonight. Every living player picks someone, whatever their role,
 * so every phone looks and behaves the same and nobody can read roles off a screen.
 */
export function nightOptions(game: Game, playerId: string): string[] {
  const me = getPlayer(game, playerId);
  if (!me || !me.alive || game.phase !== 'night') return [];
  const living = alivePlayers(game);
  switch (me.role) {
    case 'mafia':
      return living.filter((p) => p.role !== 'mafia').map((p) => p.id);
    case 'doctor':
      return living
        .filter((p) => p.id !== me.lastProtectedId)
        .filter((p) => p.id !== me.id || !me.doctorSelfSaveUsed)
        .map((p) => p.id);
    default: // detective, villager
      return living.filter((p) => p.id !== me.id).map((p) => p.id);
  }
}

export function submitNightAction(game: Game, playerId: string, targetId: unknown): Res {
  if (game.phase !== 'night') return fail('BAD_PHASE', 'It is not night.');
  if (game.pausedAt !== undefined) return fail('PAUSED', 'The game is paused.');
  const me = getPlayer(game, playerId);
  if (!me || !me.alive) return fail('NOT_ALIVE', 'You are not in the game any more.');
  if (playerId in game.nightPicks) return fail('ALREADY_LOCKED', 'You have already locked in.');
  if (typeof targetId !== 'string' || !nightOptions(game, playerId).includes(targetId)) {
    return fail('BAD_TARGET', "You can't pick that person.");
  }
  game.nightPicks[playerId] = targetId;
  return OK;
}

function pickMostVoted(votes: string[], rng: Rng): string | undefined {
  if (votes.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const v of votes) counts.set(v, (counts.get(v) ?? 0) + 1);
  const top = Math.max(...counts.values());
  const tied = [...counts.entries()].filter(([, c]) => c === top).map(([id]) => id).sort();
  return tied[rng.int(tied.length)];
}

function resolveNight(game: Game, now: number, rng: Rng): void {
  const picks = game.nightPicks;
  const living = alivePlayers(game);
  const valid = (id: string | undefined) => (id && getPlayer(game, id)?.alive ? id : undefined);

  const mafiaVotes = living
    .filter((p) => p.role === 'mafia')
    .map((p) => valid(picks[p.id]))
    .filter((t): t is string => t !== undefined && getPlayer(game, t)?.role !== 'mafia');
  const mafiaTarget = pickMostVoted(mafiaVotes, rng);

  const doctor = living.find((p) => p.role === 'doctor');
  const doctorTarget = doctor ? valid(picks[doctor.id]) : undefined;
  if (doctor && doctorTarget) {
    doctor.lastProtectedId = doctorTarget;
    if (doctorTarget === doctor.id) doctor.doctorSelfSaveUsed = true;
  }

  const detective = living.find((p) => p.role === 'detective');
  const detectiveTarget = detective ? valid(picks[detective.id]) : undefined;
  let detectiveResult: boolean | undefined;
  if (detectiveTarget) {
    detectiveResult = getPlayer(game, detectiveTarget)?.role === 'mafia';
    game.detectiveNotes.push({ round: game.round, targetId: detectiveTarget, isMafia: detectiveResult });
  }

  const saved = mafiaTarget !== undefined && mafiaTarget === doctorTarget;
  const killedId = mafiaTarget !== undefined && !saved ? mafiaTarget : undefined;
  const killed = getPlayer(game, killedId);
  if (killed) {
    killed.alive = false;
    if (game.settings.revealOnDeath) killed.revealed = true;
  }

  const entry: HistoryEntry = {
    kind: 'night',
    round: game.round,
    mafiaTarget,
    doctorTarget,
    detectiveTarget,
    detectiveResult,
    killedId,
    saved,
  };
  game.history.push(entry);
  game.dawn = { killedId, saved };
  game.winner = checkWin(game);
  game.phase = 'dawn';
  game.phaseEndsAt = now + game.settings.dawnSecs * 1000;
  game.nightMinAt = undefined;
  game.narration = narrate.dawn(rng, {
    killedName: killed?.name,
    killedRole: killed && game.settings.revealOnDeath ? killed.role : undefined,
    saved,
  });
}

// ---------------------------------------------------------------------------
// Day and vote
// ---------------------------------------------------------------------------

/** Today's discussion length: sized to the game-length plan, or the fixed setting in manual mode. */
export function discussionSecs(game: Game, now: number): number {
  const target = game.settings.targetMinutes;
  if (!target || game.scheduleStart === undefined) return game.settings.discussSecs;
  return dayLengthSecs({
    targetMinutes: target,
    players: game.players.length,
    round: game.round,
    scheduleStart: game.scheduleStart,
    voteSecs: game.settings.voteSecs,
    verdictSecs: game.settings.verdictSecs,
    now,
  });
}

function enterDay(game: Game, now: number, rng: Rng): void {
  game.phase = 'day';
  game.extended = false;
  game.phaseEndsAt = now + discussionSecs(game, now) * 1000;
  game.narration = narrate.day(rng);
}

function enterVote(game: Game, now: number, rng: Rng): void {
  game.phase = 'vote';
  game.extended = false;
  game.dayVotes = {};
  game.phaseEndsAt = now + game.settings.voteSecs * 1000;
  game.narration = narrate.vote(rng);
}

export function voteOptions(game: Game, playerId: string): string[] {
  const me = getPlayer(game, playerId);
  if (!me || !me.alive || game.phase !== 'vote') return [];
  return [...alivePlayers(game).filter((p) => p.id !== me.id).map((p) => p.id), 'none'];
}

export function submitVote(game: Game, playerId: string, targetId: unknown): Res {
  if (game.phase !== 'vote') return fail('BAD_PHASE', 'Voting is not open.');
  if (game.pausedAt !== undefined) return fail('PAUSED', 'The game is paused.');
  const me = getPlayer(game, playerId);
  if (!me || !me.alive) return fail('NOT_ALIVE', 'Ghosts cannot vote.');
  if (typeof targetId !== 'string' || !voteOptions(game, playerId).includes(targetId)) {
    return fail('BAD_TARGET', "You can't vote for that.");
  }
  game.dayVotes[playerId] = targetId;
  return OK;
}

/** Strictly the most votes wins. A tie, or "No one" at least as popular, means nobody is barred. */
function resolveVote(game: Game, now: number, rng: Rng): void {
  const tally: Record<string, number> = { none: 0 };
  for (const voter of alivePlayers(game)) {
    const v = game.dayVotes[voter.id];
    if (!v) continue;
    if (v === 'none') tally.none = (tally.none ?? 0) + 1;
    else if (getPlayer(game, v)?.alive) tally[v] = (tally[v] ?? 0) + 1;
  }
  const named = Object.entries(tally).filter(([k]) => k !== 'none');
  const top = named.length ? Math.max(...named.map(([, c]) => c)) : 0;
  const leaders = named.filter(([, c]) => c === top);
  const only = leaders.length === 1 ? leaders[0] : undefined;
  const eliminatedId = only && top > (tally.none ?? 0) ? only[0] : undefined;
  const out = getPlayer(game, eliminatedId);
  if (out) {
    out.alive = false;
    if (game.settings.revealOnDeath) out.revealed = true;
  }
  game.history.push({ kind: 'vote', round: game.round, votes: { ...game.dayVotes }, eliminatedId });
  game.verdict = { eliminatedId, tally };
  game.winner = checkWin(game);
  game.phase = 'verdict';
  game.phaseEndsAt = now + game.settings.verdictSecs * 1000;
  game.narration = narrate.verdict(rng, {
    name: out?.name,
    role: out && game.settings.revealOnDeath ? out.role : undefined,
  });
}

function endGame(game: Game, now: number, rng: Rng): void {
  game.phase = 'gameOver';
  game.phaseEndsAt = undefined;
  game.nightMinAt = undefined;
  game.pausedAt = undefined;
  game.autoPaused = false;
  for (const p of game.players) p.revealed = true;
  if (game.winner) game.narration = narrate.win(rng, game.winner);
  void now;
}

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

/** Advance the game if a deadline passed or everyone has acted. Returns true if anything changed. */
export function tick(game: Game, now: number, rng: Rng): boolean {
  let changed = false;

  if (reassignHost(game, now)) changed = true;

  if (game.phase === 'lobby') {
    const before = game.players.length;
    game.players = game.players.filter(
      (p) => p.isHost || p.connected || p.disconnectedAt === undefined || now - p.disconnectedAt < HOST_GRACE_MS,
    );
    return changed || game.players.length !== before;
  }
  if (game.pausedAt !== undefined || game.phase === 'gameOver') return changed;

  const due = now >= (game.phaseEndsAt ?? Infinity);
  const present = game.players.filter((p) => p.connected);

  switch (game.phase) {
    case 'roleReveal': {
      const allReady = present.length > 0 && present.every((p) => game.ready[p.id]);
      if (allReady || due) {
        enterNight(game, now, rng);
        changed = true;
      }
      break;
    }
    case 'night': {
      // Simple Mode: only the Mafia have to act, so the night waits for them alone.
      const mustAct = present.filter((p) => p.alive && (!game.settings.simpleMode || p.role === 'mafia'));
      const allIn = mustAct.every((p) => p.id in game.nightPicks);
      if ((allIn && now >= (game.nightMinAt ?? 0)) || due) {
        resolveNight(game, now, rng);
        changed = true;
      }
      break;
    }
    case 'dawn':
      if (due) {
        if (game.winner) endGame(game, now, rng);
        else enterDay(game, now, rng);
        changed = true;
      }
      break;
    case 'day':
      if (due) {
        enterVote(game, now, rng);
        changed = true;
      }
      break;
    case 'vote': {
      const waitingOn = present.filter((p) => p.alive && !(p.id in game.dayVotes));
      if (waitingOn.length === 0 || due) {
        resolveVote(game, now, rng);
        changed = true;
      }
      break;
    }
    case 'verdict':
      if (due) {
        if (game.winner) endGame(game, now, rng);
        else enterNight(game, now, rng);
        changed = true;
      }
      break;
    default:
      break;
  }
  return changed;
}
