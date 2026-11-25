// "Game length" planning. Pure maths, shared by the engine (to set each day's timer) and the lobby (to explain it).

export const MIN_DAY_SECS = 60;
export const MAX_DAY_SECS = 30 * 60;
/** Typical night + dawn time, only used for the lobby's estimate. The real timer uses the actual clock. */
export const TYPICAL_NIGHT_DAWN_SECS = 90;

/** Each round removes about two players, so a game of n players lasts roughly n/2 rounds (at least 3). */
export const plannedRounds = (players: number): number => Math.max(3, Math.ceil(players / 2));

export const roundMs = (targetMinutes: number, players: number): number =>
  (targetMinutes * 60_000) / plannedRounds(players);

/**
 * How long today's discussion should be so that voting starts when the plan says it should.
 * Round r is planned to finish at start + r * roundLength, with the vote and verdict at its end,
 * so a game that ran ahead gets a longer day and one that ran behind gets a shorter day.
 */
export function dayLengthSecs(o: {
  targetMinutes: number;
  players: number;
  round: number;
  scheduleStart: number;
  voteSecs: number;
  verdictSecs: number;
  now: number;
}): number {
  const voteStartsAt = o.scheduleStart + o.round * roundMs(o.targetMinutes, o.players) - (o.voteSecs + o.verdictSecs) * 1000;
  const secs = Math.round((voteStartsAt - o.now) / 1000);
  return Math.min(MAX_DAY_SECS, Math.max(MIN_DAY_SECS, secs));
}

/** For the lobby hint: roughly how long each day's discussion will be. */
export function estimatedDayMinutes(targetMinutes: number, players: number, voteSecs: number, verdictSecs: number): number {
  const perRound = roundMs(targetMinutes, players) / 1000;
  const day = Math.min(MAX_DAY_SECS, Math.max(MIN_DAY_SECS, perRound - voteSecs - verdictSecs - TYPICAL_NIGHT_DAWN_SECS));
  return Math.round(day / 60);
}
