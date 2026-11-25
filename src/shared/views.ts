// Builds what each client is allowed to see. This is the only place game state leaves the server,
// so it is also where secrets are protected: a player's role is included only if they may know it.

import {
  effectiveMafiaCount,
  getPlayer,
  maxMafia,
  nightOptions,
  roleCounts,
  voteOptions,
} from './engine';
import { MAX_PLAYERS, type Game, type Player, type PublicPlayer, type View } from './types';

function canSeeRole(game: Game, viewer: Player | undefined, target: Player): boolean {
  if (game.phase === 'gameOver') return true;
  if (target.revealed) return true;
  if (!viewer) return false;
  if (viewer.id === target.id) return true;
  if (!viewer.alive) return true; // ghosts see the whole board
  return viewer.role === 'mafia' && target.role === 'mafia';
}

export function viewFor(game: Game, viewerId: string | undefined, now: number, minPlayers: number): View {
  const viewer = getPlayer(game, viewerId);
  const gameOver = game.phase === 'gameOver';
  const ghost = !!viewer && !viewer.alive;
  const n = game.players.length;
  const mafia = effectiveMafiaCount(game);
  const paused = game.pausedAt !== undefined;

  const players: PublicPlayer[] = game.players.map((p) => ({
    id: p.id,
    name: p.name,
    alive: p.alive,
    connected: p.connected,
    isHost: p.isHost,
    kicked: p.kicked || undefined,
    role: canSeeRole(game, viewer, p) ? p.role : undefined,
  }));

  const present = game.players.filter((p) => p.connected && p.alive);
  const view: View = {
    serverNow: now,
    code: game.code,
    phase: game.phase,
    round: game.round,
    phaseEndsAt: game.phaseEndsAt ?? null,
    paused,
    pausedRemainingMs: paused && game.phaseEndsAt !== undefined ? Math.max(0, game.phaseEndsAt - (game.pausedAt as number)) : null,
    settings: {
      mafiaCount: game.settings.mafiaCount,
      targetMinutes: game.settings.targetMinutes ?? null,
      simpleMode: !!game.settings.simpleMode,
      revealOnDeath: game.settings.revealOnDeath,
      christmas: game.settings.christmas,
      discussSecs: game.settings.discussSecs,
      voteSecs: game.settings.voteSecs,
    },
    roleCounts: roleCounts(n, mafia, !!game.settings.simpleMode),
    minPlayers,
    maxPlayers: MAX_PLAYERS,
    maxMafia: maxMafia(n),
    schedule:
      game.scheduleStart !== undefined && game.settings.targetMinutes && game.phase !== 'gameOver'
        ? { startedAt: game.scheduleStart, targetMinutes: game.settings.targetMinutes }
        : undefined,
    canExtend: (game.phase === 'day' || game.phase === 'vote') && !game.extended,
    players,
    narration: game.narration,
    winner: gameOver ? game.winner : undefined,
  };

  if (viewer) {
    const isMafia = viewer.role === 'mafia';
    view.me = {
      id: viewer.id,
      name: viewer.name,
      role: viewer.role,
      alive: viewer.alive,
      isHost: viewer.isHost,
      teammates: isMafia ? game.players.filter((p) => p.role === 'mafia' && p.id !== viewer.id).map((p) => p.id) : [],
      ready: !!game.ready[viewer.id],
    };
  }

  if (game.phase === 'roleReveal') {
    const here = game.players.filter((p) => p.connected);
    view.readyProgress = { done: here.filter((p) => game.ready[p.id]).length, total: here.length };
  }

  if (game.phase === 'night') {
    // In Simple Mode only the Mafia are waited on, so progress counts only them (their number is public anyway).
    const counted = game.settings.simpleMode ? present.filter((p) => p.role === 'mafia') : present;
    const done = counted.filter((p) => p.id in game.nightPicks).length;
    view.night = {
      optional: !!game.settings.simpleMode && viewer?.role === 'villager',
      locked: !!viewer && viewer.id in game.nightPicks,
      pick: viewer ? game.nightPicks[viewer.id] : undefined,
      options: viewer ? nightOptions(game, viewer.id) : [],
      progress: { done, total: counted.length },
    };
    if (viewer?.alive && viewer.role === 'mafia') {
      const picks: Record<string, string> = {};
      for (const p of game.players) {
        const t = game.nightPicks[p.id];
        if (p.role === 'mafia' && p.alive && t) picks[p.id] = t;
      }
      view.night.mafiaPicks = picks;
    }
  }

  if (game.phase === 'vote') {
    const done = present.filter((p) => p.id in game.dayVotes).length;
    view.vote = {
      myVote: viewer ? game.dayVotes[viewer.id] : undefined,
      options: viewer ? voteOptions(game, viewer.id) : [],
      progress: { done, total: present.length },
    };
  }

  if (game.phase === 'dawn' || game.phase === 'day' || game.phase === 'vote' || game.phase === 'verdict' || gameOver) {
    if (game.dawn) view.dawn = game.dawn;
  }
  if (game.phase === 'verdict' || gameOver) {
    if (game.verdict) view.verdict = game.verdict;
  }

  if (viewer && (viewer.role === 'detective' || ghost || gameOver)) {
    // Only the Detective, ghosts and everyone at game over. The TV (no viewer) gets them at game over only.
    view.detectiveNotes = game.detectiveNotes;
  }
  if (ghost || gameOver) view.history = game.history;

  return view;
}
