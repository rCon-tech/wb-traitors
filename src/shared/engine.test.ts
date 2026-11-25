import { describe, expect, it } from 'vitest';
import {
  addPlayer,
  checkWin,
  createGame,
  defaultMafiaCount,
  extendPhase,
  getPlayer,
  hostPause,
  hostResume,
  kickPlayer,
  markReady,
  maxMafia,
  nightOptions,
  resetToLobby,
  setConnected,
  skipPhase,
  startGame,
  submitNightAction,
  submitVote,
  tick,
  updateSettings,
  type Rng,
} from './engine';
import { viewFor } from './views';
import { dayLengthSecs, estimatedDayMinutes, plannedRounds, MAX_DAY_SECS, MIN_DAY_SECS } from './schedule';
import type { Game, Player, Role } from './types';

function seeded(seed = 1): Rng {
  let a = seed;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    int: (max) => Math.floor(next() * max),
    token: (len) => Array.from({ length: len }, () => Math.floor(next() * 16).toString(16)).join(''),
  };
}

const T0 = 1_000_000;

function lobby(n: number, rng = seeded()): { game: Game; host: Player; ps: Player[] } {
  const c = createGame('ABCD', 'Host', T0, rng);
  if (!c.ok) throw new Error('create failed');
  c.game.settings.targetMinutes = null; // the older tests assume the fixed 5 minute day
  const ps = [c.player];
  for (let i = 1; i < n; i++) {
    const r = addPlayer(c.game, `Player${i}`, T0, rng);
    if (!r.ok) throw new Error(r.message);
    ps.push(r.player);
  }
  return { game: c.game, host: c.player, ps };
}

/** Start a game and rig the roles so tests are deterministic. */
function rigged(roles: Role[], rng = seeded(), simple = false): { game: Game; ps: Player[]; rng: Rng } {
  const { game, host, ps } = lobby(roles.length, rng);
  game.settings.simpleMode = simple;
  const s = startGame(game, host.id, T0, rng, 4);
  if (!s.ok) throw new Error(s.message);
  ps.forEach((p, i) => (p.role = roles[i]));
  return { game, ps, rng };
}

/** Everyone ready -> night. */
function toNight(game: Game, ps: Player[], rng: Rng, now = T0) {
  ps.forEach((p) => markReady(game, p.id));
  expect(tick(game, now, rng)).toBe(true);
  expect(game.phase).toBe('night');
}

/** Lock in a pick for each listed player (id -> target) and let the night resolve. */
function night(game: Game, picks: Record<string, string>, rng: Rng, now: number) {
  for (const [id, target] of Object.entries(picks)) {
    const r = submitNightAction(game, id, target);
    if (!r.ok) throw new Error(`${id}: ${r.message}`);
  }
  // Everyone else just locks in anyone legal so the night ends early.
  for (const p of game.players) {
    if (p.alive && !(p.id in game.nightPicks)) {
      submitNightAction(game, p.id, nightOptions(game, p.id)[0] as string);
    }
  }
  tick(game, now + 31_000, rng);
}

describe('setup', () => {
  it('scales the Mafia count with the player count', () => {
    expect([6, 7, 8, 11, 12, 15, 16, 20].map(defaultMafiaCount)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    expect(maxMafia(6)).toBe(2);
    expect(maxMafia(20)).toBe(9);
  });

  it('rejects bad and duplicate names (case-insensitive) and a started game', () => {
    const rng = seeded();
    const { game } = lobby(2, rng);
    expect(addPlayer(game, 'x', T0, rng)).toMatchObject({ ok: false, code: 'BAD_NAME' });
    expect(addPlayer(game, '<script>', T0, rng)).toMatchObject({ ok: false, code: 'BAD_NAME' });
    expect(addPlayer(game, 'player1', T0, rng)).toMatchObject({ ok: false, code: 'NAME_TAKEN' });
    expect(addPlayer(game, '  Séamus   O Brien ', T0, rng)).toMatchObject({ ok: true });
    expect(game.players.at(-1)?.name).toBe('Séamus O Brien');
  });

  it('caps the room at 20 players', () => {
    const rng = seeded();
    const { game } = lobby(20, rng);
    expect(addPlayer(game, 'Twentyone', T0, rng)).toMatchObject({ ok: false, code: 'ROOM_FULL' });
  });

  it.each([6, 7, 8, 11, 12, 15, 16, 20])('deals the right roles for %i players', (n) => {
    const rng = seeded(n);
    const { game, host } = lobby(n, rng);
    expect(startGame(game, host.id, T0, rng)).toMatchObject({ ok: true });
    const count = (r: Role) => game.players.filter((p) => p.role === r).length;
    expect(count('mafia')).toBe(defaultMafiaCount(n));
    expect(count('detective')).toBe(1);
    expect(count('doctor')).toBe(1);
    expect(count('villager')).toBe(n - defaultMafiaCount(n) - 2);
    expect(game.phase).toBe('roleReveal');
  });

  it('refuses to start with too few players or from a non-host', () => {
    const rng = seeded();
    const { game, host, ps } = lobby(5, rng);
    expect(startGame(game, host.id, T0, rng)).toMatchObject({ ok: false, code: 'NOT_ENOUGH_PLAYERS' });
    expect(startGame(game, ps[1]!.id, T0, rng, 4)).toMatchObject({ ok: false, code: 'NOT_HOST' });
  });

  it('clamps a silly Mafia setting', () => {
    const rng = seeded();
    const { game, host } = lobby(6, rng);
    expect(updateSettings(game, host.id, { mafiaCount: 6 })).toMatchObject({ ok: true });
    startGame(game, host.id, T0, rng);
    expect(game.players.filter((p) => p.role === 'mafia').length).toBe(2);
  });

  it('validates settings and restricts them to the host in the lobby', () => {
    const rng = seeded();
    const { game, host, ps } = lobby(6, rng);
    expect(updateSettings(game, ps[1]!.id, { christmas: false })).toMatchObject({ code: 'NOT_HOST' });
    expect(updateSettings(game, host.id, { discussSecs: 5 })).toMatchObject({ code: 'BAD_SETTING' });
    expect(updateSettings(game, host.id, { voteSecs: 'x' })).toMatchObject({ code: 'BAD_SETTING' });
    expect(updateSettings(game, host.id, { discussSecs: 180, christmas: false })).toMatchObject({ ok: true });
    expect(game.settings.discussSecs).toBe(180);
  });
});

describe('night', () => {
  // 0 Mafia, 1 Mafia, 2 Detective, 3 Doctor, 4-7 Villagers
  const ROLES: Role[] = ['mafia', 'mafia', 'detective', 'doctor', 'villager', 'villager', 'villager', 'villager'];

  it('only lets each role pick legal targets', () => {
    const { game, ps, rng } = rigged(ROLES);
    toNight(game, ps, rng);
    const [m0, m1, det, doc, v0] = ps as [Player, Player, Player, Player, Player];
    expect(nightOptions(game, m0.id)).not.toContain(m1.id); // can't target a teammate
    expect(nightOptions(game, m0.id)).not.toContain(m0.id);
    expect(nightOptions(game, det.id)).not.toContain(det.id);
    expect(nightOptions(game, doc.id)).toContain(doc.id); // first self-save is allowed
    expect(submitNightAction(game, m0.id, m1.id)).toMatchObject({ ok: false, code: 'BAD_TARGET' });
    expect(submitNightAction(game, v0.id, 'nobody')).toMatchObject({ ok: false, code: 'BAD_TARGET' });
    expect(submitNightAction(game, v0.id, det.id)).toMatchObject({ ok: true });
    expect(submitNightAction(game, v0.id, doc.id)).toMatchObject({ ok: false, code: 'ALREADY_LOCKED' });
  });

  it('kills the Mafia target when nobody protects them', () => {
    const { game, ps, rng } = rigged(ROLES);
    toNight(game, ps, rng);
    night(game, { [ps[0]!.id]: ps[4]!.id, [ps[1]!.id]: ps[4]!.id, [ps[3]!.id]: ps[5]!.id }, rng, T0);
    expect(game.phase).toBe('dawn');
    expect(game.dawn).toEqual({ killedId: ps[4]!.id, saved: false });
    expect(ps[4]!.alive).toBe(false);
    expect(ps[4]!.revealed).toBe(true);
  });

  it('cancels the kill when the Doctor protects the target', () => {
    const { game, ps, rng } = rigged(ROLES);
    toNight(game, ps, rng);
    night(game, { [ps[0]!.id]: ps[4]!.id, [ps[1]!.id]: ps[4]!.id, [ps[3]!.id]: ps[4]!.id }, rng, T0);
    expect(game.dawn).toEqual({ killedId: undefined, saved: true });
    expect(ps[4]!.alive).toBe(true);
    expect(game.narration?.text).not.toContain(ps[4]!.name); // a save never names the victim
  });

  it('lets the Doctor save themself once only, and never the same person twice running', () => {
    const { game, ps, rng } = rigged(ROLES);
    const doc = ps[3]!;
    toNight(game, ps, rng);
    night(game, { [doc.id]: doc.id }, rng, T0);
    expect(doc.doctorSelfSaveUsed).toBe(true);
    // next night
    tick(game, T0 + 31_000 + 12_000, rng); // dawn -> day
    expect(game.phase).toBe('day');
    game.phase = 'night'; // jump straight to the next night for this rule check
    game.nightPicks = {};
    expect(nightOptions(game, doc.id)).not.toContain(doc.id);
    game.nightPicks = {};
    doc.doctorSelfSaveUsed = false;
    // lastProtectedId is the doctor, so even with the flag cleared they can't repeat
    expect(nightOptions(game, doc.id)).not.toContain(doc.id);
    expect(nightOptions(game, doc.id)).toContain(ps[4]!.id);
  });

  it('breaks a Mafia tie at random between the tied targets only', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { game, ps, rng } = rigged(ROLES, seeded(seed));
      toNight(game, ps, rng);
      night(game, { [ps[0]!.id]: ps[4]!.id, [ps[1]!.id]: ps[5]!.id }, rng, T0);
      expect([ps[4]!.id, ps[5]!.id]).toContain(game.dawn?.killedId);
    }
  });

  it('uses the majority when the Mafia disagree among three', () => {
    const roles: Role[] = ['mafia', 'mafia', 'mafia', 'detective', 'doctor', 'villager', 'villager', 'villager', 'villager', 'villager', 'villager', 'villager'];
    const { game, ps, rng } = rigged(roles);
    toNight(game, ps, rng);
    night(game, { [ps[0]!.id]: ps[5]!.id, [ps[1]!.id]: ps[5]!.id, [ps[2]!.id]: ps[6]!.id }, rng, T0);
    expect(game.dawn?.killedId).toBe(ps[5]!.id);
  });

  it('tells the Detective the truth, privately', () => {
    const { game, ps, rng } = rigged(ROLES);
    const det = ps[2]!;
    toNight(game, ps, rng);
    night(game, { [det.id]: ps[0]!.id }, rng, T0);
    expect(game.detectiveNotes).toEqual([{ round: 1, targetId: ps[0]!.id, isMafia: true }]);
    expect(viewFor(game, det.id, T0, 4).detectiveNotes).toHaveLength(1);
    expect(viewFor(game, ps[4]!.id, T0, 4).detectiveNotes).toBeUndefined();
    expect(viewFor(game, undefined, T0, 4).detectiveNotes).toBeUndefined();
  });

  it('records a Detective result even if the Detective dies the same night', () => {
    const { game, ps, rng } = rigged(ROLES);
    const det = ps[2]!;
    toNight(game, ps, rng);
    night(game, { [det.id]: ps[1]!.id, [ps[0]!.id]: det.id, [ps[1]!.id]: det.id }, rng, T0);
    expect(det.alive).toBe(false);
    expect(game.detectiveNotes).toHaveLength(1);
  });

  it('waits for the minimum night time even when everyone is locked in', () => {
    const { game, ps, rng } = rigged(ROLES);
    toNight(game, ps, rng);
    for (const p of ps) submitNightAction(game, p.id, nightOptions(game, p.id)[0] as string);
    expect(tick(game, T0 + 5_000, rng)).toBe(false);
    expect(game.phase).toBe('night');
    expect(tick(game, T0 + 30_000, rng)).toBe(true);
    expect(game.phase).toBe('dawn');
  });

  it('resolves on timeout with missing actions: no Mafia pick means no kill', () => {
    const { game, ps, rng } = rigged(ROLES);
    toNight(game, ps, rng);
    expect(tick(game, T0 + 89_000, rng)).toBe(false);
    expect(tick(game, T0 + 90_000, rng)).toBe(true);
    expect(game.dawn).toEqual({ killedId: undefined, saved: false });
    expect(ps.every((p) => p.alive)).toBe(true);
  });

  it('does not wait on disconnected players', () => {
    const { game, ps, rng } = rigged(ROLES);
    toNight(game, ps, rng);
    setConnected(game, ps[7]!.id, false, T0);
    for (const p of ps.slice(0, 7)) submitNightAction(game, p.id, nightOptions(game, p.id)[0] as string);
    expect(tick(game, T0 + 30_000, rng)).toBe(true);
  });

  it('hides the roles when reveal-on-death is off', () => {
    const { game, ps, rng } = rigged(ROLES);
    game.settings.revealOnDeath = false;
    toNight(game, ps, rng);
    night(game, { [ps[0]!.id]: ps[4]!.id, [ps[1]!.id]: ps[4]!.id }, rng, T0);
    expect(ps[4]!.revealed).toBe(false);
    expect(game.narration?.text).not.toMatch(/They were/);
    // a living villager cannot see the victim's role; the victim (a ghost) can see everything
    expect(viewFor(game, ps[5]!.id, T0, 4).players.find((p) => p.id === ps[4]!.id)?.role).toBeUndefined();
    expect(viewFor(game, ps[4]!.id, T0, 4).players.find((p) => p.id === ps[0]!.id)?.role).toBe('mafia');
  });
});

describe('day, vote and winning', () => {
  const ROLES: Role[] = ['mafia', 'mafia', 'detective', 'doctor', 'villager', 'villager', 'villager', 'villager'];

  function toVote() {
    const ctx = rigged(ROLES);
    const { game, ps, rng } = ctx;
    toNight(game, ps, rng);
    tick(game, T0 + 90_000, rng); // empty night
    tick(game, T0 + 90_000 + 12_000, rng); // dawn -> day
    expect(game.phase).toBe('day');
    tick(game, T0 + 90_000 + 12_000 + 300_000, rng);
    expect(game.phase).toBe('vote');
    return { ...ctx, now: T0 + 90_000 + 12_000 + 300_000 };
  }

  it('bars the player with strictly the most votes and reveals them', () => {
    const { game, ps, rng, now } = toVote();
    for (const p of ps) submitVote(game, p.id, p.id === ps[0]!.id ? ps[4]!.id : ps[0]!.id);
    submitVote(game, ps[4]!.id, ps[0]!.id);
    expect(tick(game, now + 1, rng)).toBe(true);
    expect(game.phase).toBe('verdict');
    expect(game.verdict?.eliminatedId).toBe(ps[0]!.id);
    expect(ps[0]!.alive).toBe(false);
    expect(game.verdict?.tally[ps[0]!.id]).toBe(7);
  });

  it('bars nobody on a tie or when "No one" ties the leader', () => {
    {
      const { game, ps, rng, now } = toVote();
      ps.forEach((p, i) => submitVote(game, p.id, i < 4 ? (i === 0 ? ps[1]!.id : ps[0]!.id) : i < 6 ? ps[1]!.id : ps[0]!.id));
      // ps[0] gets votes from 1,2,3,6,7 (5) vs ps[1] from 0,4,5 (3): not a tie, sanity check below instead
      tick(game, now + 1, rng);
      expect(game.verdict?.eliminatedId).toBe(ps[0]!.id);
    }
    {
      const { game, ps, rng, now } = toVote();
      submitVote(game, ps[0]!.id, ps[1]!.id);
      submitVote(game, ps[1]!.id, ps[0]!.id);
      for (const p of ps.slice(2)) submitVote(game, p.id, 'none');
      tick(game, now + 1, rng);
      expect(game.verdict?.eliminatedId).toBeUndefined();
      expect(game.players.every((p) => p.alive)).toBe(true);
    }
    {
      const { game, ps, rng, now } = toVote();
      for (const p of ps.slice(0, 4)) submitVote(game, p.id, ps[5]!.id);
      for (const p of ps.slice(4)) submitVote(game, p.id, ps[6]!.id === p.id ? ps[5]!.id : ps[6]!.id);
      tick(game, now + 1, rng);
      // ps[5] has 4 + (ps[6]'s vote) = 5, ps[6] has 3: ps[5] barred
      expect(game.verdict?.eliminatedId).toBe(ps[5]!.id);
    }
    {
      const { game, ps, rng, now } = toVote();
      for (const p of ps.slice(0, 4)) submitVote(game, p.id, ps[5]!.id === p.id ? 'none' : ps[5]!.id);
      for (const p of ps.slice(4)) submitVote(game, p.id, 'none');
      tick(game, now + 1, rng);
      expect(game.verdict?.eliminatedId).toBeUndefined();
    }
  });

  it('lets players change their vote, forbids self-votes and ghost votes', () => {
    const { game, ps } = toVote();
    expect(submitVote(game, ps[0]!.id, ps[0]!.id)).toMatchObject({ ok: false, code: 'BAD_TARGET' });
    expect(submitVote(game, ps[0]!.id, ps[1]!.id)).toMatchObject({ ok: true });
    expect(submitVote(game, ps[0]!.id, ps[2]!.id)).toMatchObject({ ok: true });
    expect(game.dayVotes[ps[0]!.id]).toBe(ps[2]!.id);
    ps[3]!.alive = false;
    expect(submitVote(game, ps[3]!.id, ps[1]!.id)).toMatchObject({ ok: false, code: 'NOT_ALIVE' });
  });

  it('village wins when the last Mafia is barred, and everything is revealed', () => {
    const { game, ps, rng, now } = toVote();
    ps[1]!.alive = false; // one Mafia already gone
    for (const p of ps.filter((q) => q.alive)) submitVote(game, p.id, p.id === ps[0]!.id ? 'none' : ps[0]!.id);
    tick(game, now + 1, rng);
    expect(game.phase).toBe('verdict');
    expect(game.winner).toBe('village');
    tick(game, now + 1 + 10_000, rng);
    expect(game.phase).toBe('gameOver');
    expect(game.players.every((p) => p.revealed)).toBe(true);
    expect(viewFor(game, ps[4]!.id, now, 4).players.find((p) => p.id === ps[0]!.id)?.role).toBe('mafia');
  });

  it('Mafia win when they equal the rest', () => {
    const rng = seeded();
    const { game, ps } = rigged(['mafia', 'villager', 'villager', 'detective'], rng);
    expect(checkWin(game)).toBeUndefined();
    ps[1]!.alive = false;
    expect(checkWin(game)).toBeUndefined(); // 1 mafia vs 2 others
    ps[2]!.alive = false;
    expect(checkWin(game)).toBe('mafia'); // 1 vs 1
  });

  it('a night kill that gives the Mafia parity ends the game after dawn', () => {
    const rng = seeded();
    const { game, ps } = rigged(['mafia', 'villager', 'villager', 'detective', 'doctor'], rng);
    ps[1]!.alive = false;
    toNight(game, ps, rng);
    // 1 mafia vs villager2, detective, doctor. Kill villager2 -> 1 vs 2, no. Kill another to get to parity first.
    ps[3]!.alive = false;
    night(game, { [ps[0]!.id]: ps[2]!.id }, rng, T0);
    expect(game.winner).toBe('mafia');
    expect(game.phase).toBe('dawn');
    tick(game, T0 + 31_000 + 12_000, rng);
    expect(game.phase).toBe('gameOver');
  });

  it('keeps the loop going: verdict -> next night with an incremented round', () => {
    const { game, ps, rng, now } = toVote();
    for (const p of ps) submitVote(game, p.id, 'none');
    tick(game, now + 1, rng);
    expect(game.verdict?.eliminatedId).toBeUndefined();
    tick(game, now + 1 + 10_000, rng);
    expect(game.phase).toBe('night');
    expect(game.round).toBe(2);
    expect(game.nightPicks).toEqual({});
  });
});

describe('host tools and connections', () => {
  const ROLES: Role[] = ['mafia', 'mafia', 'detective', 'doctor', 'villager', 'villager', 'villager', 'villager'];

  it('pause freezes the clock and resume shifts every deadline', () => {
    const { game, ps, rng } = rigged(ROLES);
    toNight(game, ps, rng);
    expect(hostPause(game, ps[1]!.id, T0 + 10_000)).toMatchObject({ code: 'NOT_HOST' });
    expect(hostPause(game, game.players.find((p) => p.isHost)!.id, T0 + 10_000)).toMatchObject({ ok: true });
    expect(tick(game, T0 + 500_000, rng)).toBe(false);
    expect(game.phase).toBe('night');
    expect(submitNightAction(game, ps[4]!.id, ps[5]!.id)).toMatchObject({ code: 'PAUSED' });
    hostResume(game, game.players.find((p) => p.isHost)!.id, T0 + 70_000);
    expect(game.phaseEndsAt).toBe(T0 + 90_000 + 60_000);
    expect(tick(game, T0 + 70_000 + 79_000, rng)).toBe(false);
    expect(tick(game, T0 + 70_000 + 80_000, rng)).toBe(true);
  });

  it('auto-pauses when everyone disconnects and resumes when someone returns', () => {
    const { game, ps, rng } = rigged(ROLES);
    toNight(game, ps, rng);
    ps.forEach((p) => setConnected(game, p.id, false, T0 + 1_000));
    expect(game.pausedAt).toBeDefined();
    expect(tick(game, T0 + 10 * 60_000, rng)).toBe(false);
    setConnected(game, ps[2]!.id, true, T0 + 600_000);
    expect(game.pausedAt).toBeUndefined();
    expect(game.phaseEndsAt).toBe(T0 + 90_000 + (600_000 - 1_000));
  });

  it('extends once and skips (but never skips the night)', () => {
    const { game, ps, rng } = rigged(ROLES);
    const hostId = game.players.find((p) => p.isHost)!.id;
    toNight(game, ps, rng);
    expect(skipPhase(game, hostId, T0)).toMatchObject({ code: 'BAD_PHASE' });
    tick(game, T0 + 90_000, rng); // dawn
    expect(skipPhase(game, hostId, T0 + 91_000)).toMatchObject({ ok: true });
    tick(game, T0 + 91_000, rng);
    expect(game.phase).toBe('day');
    const end = game.phaseEndsAt!;
    expect(extendPhase(game, hostId)).toMatchObject({ ok: true });
    expect(game.phaseEndsAt).toBe(end + 60_000);
    expect(extendPhase(game, hostId)).toMatchObject({ code: 'ALREADY_EXTENDED' });
  });

  it('hands the host role to the longest-standing connected player after 60s', () => {
    const { game, ps, rng } = rigged(ROLES);
    const host = game.players.find((p) => p.isHost)!;
    game.phaseEndsAt = T0 + 10 * 60_000; // keep the phase clock out of the way
    setConnected(game, host.id, false, T0);
    expect(tick(game, T0 + 59_000, rng)).toBe(false);
    expect(host.isHost).toBe(true);
    expect(tick(game, T0 + 60_000, rng)).toBe(true);
    expect(host.isHost).toBe(false);
    expect(game.players.filter((p) => p.isHost)).toHaveLength(1);
    expect(ps.find((p) => p.isHost)).toBeDefined();
  });

  it('kicking mid-game eliminates and reveals; kicking in the lobby removes', () => {
    const rng = seeded();
    const l = lobby(4, rng);
    expect(kickPlayer(l.game, l.host.id, l.ps[2]!.id, T0, rng)).toMatchObject({ ok: true });
    expect(l.game.players).toHaveLength(3);
    expect(kickPlayer(l.game, l.host.id, l.host.id, T0, rng)).toMatchObject({ code: 'BAD_TARGET' });

    const { game, ps, rng: r2 } = rigged(['mafia', 'villager', 'villager', 'detective'], seeded(3));
    const hostId = game.players.find((p) => p.isHost)!.id;
    const victim = ps.find((p) => p.id !== hostId && p.role === 'villager')!;
    expect(kickPlayer(game, hostId, victim.id, T0, r2)).toMatchObject({ ok: true });
    expect(victim.alive).toBe(false);
    expect(victim.revealed).toBe(true);
  });

  it('lobby drops players who have been gone a minute, but not the host', () => {
    const rng = seeded();
    const { game, ps } = lobby(3, rng);
    setConnected(game, ps[2]!.id, false, T0);
    expect(tick(game, T0 + 61_000, rng)).toBe(true);
    expect(game.players).toHaveLength(2);
  });

  it('play again returns to the lobby with fresh state and drops absent players', () => {
    const { game, ps, rng } = rigged(ROLES);
    const hostId = game.players.find((p) => p.isHost)!.id;
    toNight(game, ps, rng);
    setConnected(game, ps[7]!.id, false, T0 + 1);
    expect(resetToLobby(game, hostId)).toMatchObject({ ok: true });
    expect(game.phase).toBe('lobby');
    expect(game.players).toHaveLength(7);
    expect(game.players.every((p) => p.role === undefined && p.alive)).toBe(true);
    expect(game.round).toBe(0);
    expect(getPlayer(game, ps[7]!.id)).toBeUndefined();
  });
});

describe('privacy of views', () => {
  it('never leaks a hidden role to a living player who is not allowed to see it', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rng = seeded(seed);
      const { game, host, ps } = lobby(12, rng);
      startGame(game, host.id, T0, rng);
      for (const viewer of ps) {
        const v = viewFor(game, viewer.id, T0, 6);
        const mine = getPlayer(game, viewer.id)!;
        for (const pp of v.players) {
          const target = getPlayer(game, pp.id)!;
          const allowed = target.id === viewer.id || (mine.role === 'mafia' && target.role === 'mafia');
          if (!allowed) expect(pp.role, `${viewer.name} must not see ${target.name}`).toBeUndefined();
        }
        expect(JSON.stringify(v)).not.toContain(mine.token);
        for (const q of ps) expect(JSON.stringify(v)).not.toContain(q.token);
        if (mine.role !== 'mafia') expect(v.me?.teammates).toEqual([]);
      }
      const tv = viewFor(game, undefined, T0, 6);
      expect(tv.players.every((p) => p.role === undefined)).toBe(true);
      expect(tv.me).toBeUndefined();
    }
  });

  it('only shows Mafia their teammates\' night picks', () => {
    const ROLES: Role[] = ['mafia', 'mafia', 'detective', 'doctor', 'villager', 'villager', 'villager', 'villager'];
    const { game, ps, rng } = rigged(ROLES);
    toNight(game, ps, rng);
    submitNightAction(game, ps[0]!.id, ps[4]!.id);
    expect(viewFor(game, ps[1]!.id, T0, 4).night?.mafiaPicks).toEqual({ [ps[0]!.id]: ps[4]!.id });
    expect(viewFor(game, ps[5]!.id, T0, 4).night?.mafiaPicks).toBeUndefined();
    expect(viewFor(game, undefined, T0, 4).night?.pick).toBeUndefined();
    // every living player gets a night block of the same shape
    const shape = (id: string) => Object.keys(viewFor(game, id, T0, 4).night!).filter((k) => k !== 'mafiaPicks').sort();
    expect(shape(ps[4]!.id)).toEqual(shape(ps[2]!.id));
    expect(shape(ps[4]!.id)).toEqual(shape(ps[0]!.id));
  });

  it('gives ghosts the whole board and history', () => {
    const ROLES: Role[] = ['mafia', 'mafia', 'detective', 'doctor', 'villager', 'villager', 'villager', 'villager'];
    const { game, ps, rng } = rigged(ROLES);
    toNight(game, ps, rng);
    night(game, { [ps[0]!.id]: ps[4]!.id, [ps[1]!.id]: ps[4]!.id }, rng, T0);
    const ghost = viewFor(game, ps[4]!.id, T0, 4);
    expect(ghost.players.map((p) => p.role)).toEqual(ROLES);
    expect(ghost.history).toHaveLength(1);
    const living = viewFor(game, ps[5]!.id, T0, 4);
    expect(living.history).toBeUndefined();
    expect(living.players.filter((p) => p.role).map((p) => p.id)).toEqual([ps[4]!.id, ps[5]!.id]);
  });
});

describe('game length plan', () => {
  const base = { targetMinutes: 120, players: 12, scheduleStart: T0, voteSecs: 60, verdictSecs: 10 };

  it('plans about half as many rounds as players, never fewer than three', () => {
    expect([4, 6, 8, 12, 16, 20].map(plannedRounds)).toEqual([3, 3, 4, 6, 8, 10]);
  });

  it('sizes the day so the vote lands on the planned minute', () => {
    // 12 players, 2 hours: 6 rounds of 20 minutes. Round 1 day starts 102s in; vote at 1200 - 70 = 1130s.
    expect(dayLengthSecs({ ...base, round: 1, now: T0 + 102_000 })).toBe(1028);
    // Same plan, round 3, starting on time at 2 x 1200 + 102 seconds.
    expect(dayLengthSecs({ ...base, round: 3, now: T0 + 2 * 1_200_000 + 102_000 })).toBe(1028);
  });

  it('shortens the day when the game is behind and lengthens it when ahead', () => {
    const onTime = dayLengthSecs({ ...base, round: 2, now: T0 + 1_200_000 + 102_000 });
    const behind = dayLengthSecs({ ...base, round: 2, now: T0 + 1_200_000 + 102_000 + 300_000 });
    const ahead = dayLengthSecs({ ...base, round: 2, now: T0 + 1_200_000 + 102_000 - 300_000 });
    expect(behind).toBe(onTime - 300);
    expect(ahead).toBe(onTime + 300);
  });

  it('never goes below one minute or above thirty', () => {
    expect(dayLengthSecs({ ...base, round: 1, now: T0 + 10 * 3_600_000 })).toBe(MIN_DAY_SECS);
    expect(dayLengthSecs({ ...base, targetMinutes: 240, players: 6, round: 1, now: T0 })).toBe(MAX_DAY_SECS);
  });

  it('estimates the discussion length for the lobby hint', () => {
    expect(estimatedDayMinutes(120, 12, 60, 10)).toBe(17);
    expect(estimatedDayMinutes(120, 8, 60, 10)).toBe(27);
    expect(estimatedDayMinutes(60, 8, 60, 10)).toBe(12);
  });

  it('holds every vote to the plan across several rounds, with no one doing anything', () => {
    const roles: Role[] = ['mafia', 'mafia', 'mafia', 'detective', 'doctor', ...Array<Role>(7).fill('villager')];
    const { game, ps, rng } = rigged(roles);
    game.settings.targetMinutes = 120;
    ps.forEach((p) => markReady(game, p.id));
    tick(game, T0, rng);
    expect(game.scheduleStart).toBe(T0);

    const voteStarts: number[] = [];
    for (let r = 1; r <= 4; r++) {
      for (let guard = 0; game.phase !== 'vote' && guard < 10; guard++) tick(game, game.phaseEndsAt!, rng);
      expect(game.phase).toBe('vote');
      voteStarts.push(game.phaseEndsAt! - game.settings.voteSecs * 1000);
      tick(game, game.phaseEndsAt!, rng); // vote times out: nobody voted, nobody barred
      tick(game, game.phaseEndsAt!, rng); // verdict ends: next night
      expect(game.phase).toBe('night');
      expect(game.round).toBe(r + 1);
    }
    expect(voteStarts).toEqual([1, 2, 3, 4].map((r) => T0 + r * 1_200_000 - 70_000));
    // and the whole rounds line up: each night begins exactly one round after the last
    expect(game.phaseEndsAt).toBe(T0 + 4 * 1_200_000 + 90_000);
  });

  it('self-corrects after the host skips ahead', () => {
    const roles: Role[] = ['mafia', 'mafia', 'mafia', 'detective', 'doctor', ...Array<Role>(7).fill('villager')];
    const { game, ps, rng } = rigged(roles);
    const hostId = game.players.find((p) => p.isHost)!.id;
    game.settings.targetMinutes = 120;
    ps.forEach((p) => markReady(game, p.id));
    tick(game, T0, rng);
    const day1Start = advanceTo(game, 'day', rng);
    const day1Len = game.phaseEndsAt! - day1Start;
    expect(day1Len).toBe(1_028_000);
    // The host skips the discussion a minute in, so voting starts about 16 minutes early.
    const skipAt = day1Start + 60_000;
    skipPhase(game, hostId, skipAt);
    tick(game, skipAt, rng);
    expect(game.phase).toBe('vote');
    advanceTo(game, 'night', rng);
    const day2Start = advanceTo(game, 'day', rng);
    const day2Len = game.phaseEndsAt! - day2Start;
    // Day 2 gets the saved time back (here limited by the 30 minute cap).
    expect(day2Len).toBeGreaterThan(day1Len);
    expect(day2Len).toBe(MAX_DAY_SECS * 1000);
  });

  it('shifts the plan forward while the game is paused, so a break is not "lost time"', () => {
    const { game, ps, rng } = rigged(['mafia', 'villager', 'villager', 'detective', 'doctor', 'villager']);
    const hostId = game.players.find((p) => p.isHost)!.id;
    ps.forEach((p) => markReady(game, p.id));
    tick(game, T0, rng);
    hostPause(game, hostId, T0 + 10_000);
    hostResume(game, hostId, T0 + 10_000 + 15 * 60_000);
    expect(game.scheduleStart).toBe(T0 + 15 * 60_000);
  });

  it('uses the fixed discussion time in manual mode', () => {
    const { game, ps, rng } = rigged(['mafia', 'villager', 'villager', 'detective', 'doctor', 'villager']);
    expect(game.settings.targetMinutes).toBeNull();
    ps.forEach((p) => markReady(game, p.id));
    tick(game, T0, rng);
    const dayStart = advanceTo(game, 'day', rng);
    expect(game.phaseEndsAt! - dayStart).toBe(300_000);
  });

  it('validates the game length setting and exposes the schedule in views', () => {
    const rng = seeded();
    const { game, host } = lobby(6, rng);
    expect(updateSettings(game, host.id, { targetMinutes: 5 })).toMatchObject({ code: 'BAD_SETTING' });
    expect(updateSettings(game, host.id, { targetMinutes: 'x' })).toMatchObject({ code: 'BAD_SETTING' });
    expect(updateSettings(game, host.id, { targetMinutes: 90 })).toMatchObject({ ok: true });
    expect(viewFor(game, host.id, T0, 6).settings.targetMinutes).toBe(90);
    expect(viewFor(game, host.id, T0, 6).schedule).toBeUndefined(); // not started yet
    expect(updateSettings(game, host.id, { targetMinutes: null })).toMatchObject({ ok: true });
    updateSettings(game, host.id, { targetMinutes: 120 });
    startGame(game, host.id, T0, rng);
    game.players.forEach((p) => markReady(game, p.id));
    tick(game, T0 + 1_000, rng);
    expect(viewFor(game, host.id, T0, 6).schedule).toEqual({ startedAt: T0 + 1_000, targetMinutes: 120 });
  });

  it('starts a fresh clock for a rematch', () => {
    const { game, ps, rng } = rigged(['mafia', 'villager', 'villager', 'detective', 'doctor', 'villager']);
    const hostId = game.players.find((p) => p.isHost)!.id;
    ps.forEach((p) => markReady(game, p.id));
    tick(game, T0, rng);
    expect(game.scheduleStart).toBe(T0);
    resetToLobby(game, hostId);
    expect(game.scheduleStart).toBeUndefined();
  });
});

/** Tick the game forward, deadline by deadline, until it enters `phase`. Returns the time at which it did. */
function advanceTo(game: Game, phase: Game['phase'], rng: Rng): number {
  let now = 0;
  for (let guard = 0; game.phase !== phase; guard++) {
    if (guard > 20) throw new Error(`never reached ${phase}; stuck in ${game.phase}`);
    now = game.phaseEndsAt!;
    tick(game, now, rng);
  }
  return now;
}

describe('simple mode', () => {
  // 0 Mafia, 1 Mafia, 2-7 Villagers
  const ROLES: Role[] = ['mafia', 'mafia', 'villager', 'villager', 'villager', 'villager', 'villager', 'villager'];

  it('is off by default and only the host can switch it, in the lobby', () => {
    const rng = seeded();
    const { game, host, ps } = lobby(6, rng);
    expect(game.settings.simpleMode).toBe(false);
    expect(updateSettings(game, ps[1]!.id, { simpleMode: true })).toMatchObject({ code: 'NOT_HOST' });
    expect(updateSettings(game, host.id, { simpleMode: 'yes' })).toMatchObject({ code: 'BAD_SETTING' });
    expect(updateSettings(game, host.id, { simpleMode: true })).toMatchObject({ ok: true });
    startGame(game, host.id, T0, rng);
    expect(updateSettings(game, host.id, { simpleMode: false })).toMatchObject({ code: 'BAD_PHASE' });
  });

  it.each([6, 8, 12, 20])('deals only Mafia and Villagers for %i players', (n) => {
    const rng = seeded(n);
    const { game, host } = lobby(n, rng);
    updateSettings(game, host.id, { simpleMode: true });
    expect(startGame(game, host.id, T0, rng)).toMatchObject({ ok: true });
    const count = (r: Role) => game.players.filter((p) => p.role === r).length;
    expect(count('mafia')).toBe(defaultMafiaCount(n));
    expect(count('detective')).toBe(0);
    expect(count('doctor')).toBe(0);
    expect(count('villager')).toBe(n - defaultMafiaCount(n));
    const view = viewFor(game, host.id, T0, 6);
    expect(view.roleCounts).toEqual({ mafia: defaultMafiaCount(n), detective: 0, doctor: 0, villager: n - defaultMafiaCount(n) });
    expect(view.settings.simpleMode).toBe(true);
  });

  it('ends the night when the Mafia have locked in, without waiting for villagers', () => {
    const { game, ps, rng } = rigged(ROLES, seeded(), true);
    toNight(game, ps, rng);
    submitNightAction(game, ps[0]!.id, ps[4]!.id);
    submitNightAction(game, ps[1]!.id, ps[4]!.id);
    expect(tick(game, T0 + 29_000, rng)).toBe(false); // still inside the minimum night
    expect(tick(game, T0 + 30_000, rng)).toBe(true); // no villager locked in, and that is fine
    expect(game.phase).toBe('dawn');
    expect(game.dawn).toEqual({ killedId: ps[4]!.id, saved: false });
    expect(game.detectiveNotes).toEqual([]);
    expect(game.history[0]).toMatchObject({ kind: 'night', doctorTarget: undefined, detectiveTarget: undefined });
  });

  it('still waits for a Mafia member who has not chosen', () => {
    const { game, ps, rng } = rigged(ROLES, seeded(), true);
    toNight(game, ps, rng);
    submitNightAction(game, ps[0]!.id, ps[4]!.id);
    for (const v of ps.slice(2)) submitNightAction(game, v.id, nightOptions(game, v.id)[0] as string); // all villagers done
    expect(tick(game, T0 + 60_000, rng)).toBe(false); // Mafia #2 is still thinking
    expect(tick(game, T0 + 90_000, rng)).toBe(true); // timeout resolves with the one vote
    expect(game.dawn?.killedId).toBe(ps[4]!.id);
  });

  it('does not wait for a disconnected Mafia member', () => {
    const { game, ps, rng } = rigged(ROLES, seeded(), true);
    toNight(game, ps, rng);
    setConnected(game, ps[1]!.id, false, T0);
    submitNightAction(game, ps[0]!.id, ps[5]!.id);
    expect(tick(game, T0 + 30_000, rng)).toBe(true);
    expect(game.dawn?.killedId).toBe(ps[5]!.id);
  });

  it('accepts an optional villager tap that changes nothing', () => {
    const { game, ps, rng } = rigged(ROLES, seeded(), true);
    toNight(game, ps, rng);
    expect(submitNightAction(game, ps[3]!.id, ps[4]!.id)).toMatchObject({ ok: true });
    submitNightAction(game, ps[0]!.id, ps[5]!.id);
    submitNightAction(game, ps[1]!.id, ps[5]!.id);
    tick(game, T0 + 30_000, rng);
    expect(game.dawn?.killedId).toBe(ps[5]!.id); // ps[4] was "picked" by a villager and is fine
    expect(ps[4]!.alive).toBe(true);
  });

  it('shows the same night screen shape to everyone and flags only villagers as optional', () => {
    const { game, ps, rng } = rigged(ROLES, seeded(), true);
    toNight(game, ps, rng);
    const shape = (id: string) => Object.keys(viewFor(game, id, T0, 4).night!).filter((k) => k !== 'mafiaPicks').sort();
    expect(shape(ps[0]!.id)).toEqual(shape(ps[4]!.id));
    expect(viewFor(game, ps[4]!.id, T0, 4).night?.optional).toBe(true);
    expect(viewFor(game, ps[0]!.id, T0, 4).night?.optional).toBe(false);
    expect(viewFor(game, undefined, T0, 4).night?.optional).toBe(false);
  });

  it('counts only the Mafia in night progress, for everybody', () => {
    const { game, ps, rng } = rigged(ROLES, seeded(), true);
    toNight(game, ps, rng);
    submitNightAction(game, ps[0]!.id, ps[4]!.id);
    submitNightAction(game, ps[5]!.id, ps[4]!.id); // a villager tapping must not move the bar
    for (const id of [ps[0]!.id, ps[5]!.id, undefined]) {
      expect(viewFor(game, id, T0, 4).night?.progress).toEqual({ done: 1, total: 2 });
    }
  });

  it('plays the whole loop: kill, vote, Mafia win', () => {
    const { game, ps, rng } = rigged(['mafia', 'villager', 'villager', 'villager'], seeded(), true);
    toNight(game, ps, rng);
    submitNightAction(game, ps[0]!.id, ps[1]!.id);
    tick(game, T0 + 30_000, rng); // dawn: 1 Mafia vs 2 villagers
    expect(game.winner).toBeUndefined();
    tick(game, T0 + 30_000 + 12_000, rng); // day
    tick(game, game.phaseEndsAt!, rng); // vote
    expect(game.phase).toBe('vote');
    for (const p of ps.filter((q) => q.alive)) submitVote(game, p.id, p.id === ps[2]!.id ? ps[3]!.id : ps[2]!.id); // bar a villager
    tick(game, game.phaseEndsAt! - 1_000, rng);
    expect(game.phase).toBe('verdict');
    expect(game.winner).toBe('mafia'); // 1 Mafia vs 1 villager
    tick(game, game.phaseEndsAt!, rng);
    expect(game.phase).toBe('gameOver');
  });

  it('still lets the village win by voting out the Mafia', () => {
    const { game, ps, rng } = rigged(ROLES, seeded(), true);
    ps[1]!.alive = false; // one Mafia already gone
    toNight(game, ps, rng);
    submitNightAction(game, ps[0]!.id, ps[7]!.id);
    tick(game, T0 + 30_000, rng);
    tick(game, game.phaseEndsAt!, rng); // day
    tick(game, game.phaseEndsAt!, rng); // vote
    for (const p of ps.filter((q) => q.alive)) submitVote(game, p.id, p.id === ps[0]!.id ? 'none' : ps[0]!.id);
    tick(game, game.phaseEndsAt! - 1_000, rng);
    expect(game.winner).toBe('village');
  });
});
