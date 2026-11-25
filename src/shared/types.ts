// Shared between server and client. Types and constants only: no runtime dependencies.

export type Role = 'villager' | 'mafia' | 'detective' | 'doctor';
export type Team = 'village' | 'mafia';
export type Phase =
  | 'lobby'
  | 'roleReveal'
  | 'night'
  | 'dawn'
  | 'day'
  | 'vote'
  | 'verdict'
  | 'gameOver';

export const MIN_PLAYERS = 6;
export const MAX_PLAYERS = 20;
export const NAME_MIN = 2;
export const NAME_MAX = 16;
export const CODE_LENGTH = 4;
/** No I or O: they look like 1 and 0 on a phone in a dim pub. */
export const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const HOST_GRACE_MS = 60_000;

export interface Settings {
  /** null = automatic, based on player count. */
  mafiaCount: number | null;
  /** Planned length of the whole game in minutes. Each day's discussion is sized to fit. null = use discussSecs as is. */
  targetMinutes: number | null;
  /** Villagers and Mafia only: no Detective or Doctor, and the night waits only for the Mafia. */
  simpleMode: boolean;
  revealOnDeath: boolean;
  christmas: boolean;
  revealSecs: number;
  nightSecs: number;
  nightMinSecs: number;
  dawnSecs: number;
  discussSecs: number;
  voteSecs: number;
  verdictSecs: number;
}

export interface Player {
  id: string;
  /** Secret. Only ever sent to its owner, used to rejoin after a refresh. */
  token: string;
  name: string;
  role?: Role;
  alive: boolean;
  connected: boolean;
  isHost: boolean;
  joinedAt: number;
  disconnectedAt?: number;
  /** Role is public knowledge (died with reveal on, or game over). */
  revealed: boolean;
  kicked?: boolean;
  doctorSelfSaveUsed: boolean;
  lastProtectedId?: string;
}

export interface Narration {
  title: string;
  text: string;
}

export interface DawnResult {
  killedId?: string;
  saved: boolean;
}

export interface VerdictResult {
  eliminatedId?: string;
  /** targetId -> votes, plus the key "none". */
  tally: Record<string, number>;
}

export interface DetectiveNote {
  round: number;
  targetId: string;
  isMafia: boolean;
}

export type HistoryEntry =
  | {
      kind: 'night';
      round: number;
      mafiaTarget?: string;
      doctorTarget?: string;
      detectiveTarget?: string;
      detectiveResult?: boolean;
      killedId?: string;
      saved: boolean;
    }
  | {
      kind: 'vote';
      round: number;
      votes: Record<string, string>;
      eliminatedId?: string;
    };

export interface Game {
  code: string;
  phase: Phase;
  round: number;
  players: Player[];
  settings: Settings;
  /** playerId -> chosen target. Presence means "locked in". Every role picks, so every night looks the same. */
  nightPicks: Record<string, string>;
  /** playerId -> targetId | 'none' */
  dayVotes: Record<string, string>;
  ready: Record<string, boolean>;
  phaseEndsAt?: number;
  nightMinAt?: number;
  /** When the first night began; the game-length plan is measured from here. Shifts forward while paused. */
  scheduleStart?: number;
  pausedAt?: number;
  autoPaused?: boolean;
  extended: boolean;
  dawn?: DawnResult;
  verdict?: VerdictResult;
  narration?: Narration;
  history: HistoryEntry[];
  detectiveNotes: DetectiveNote[];
  winner?: Team;
  createdAt: number;
  /** Last human interaction; used to expire abandoned rooms. */
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// What a client is allowed to see.
// ---------------------------------------------------------------------------

export interface PublicPlayer {
  id: string;
  name: string;
  alive: boolean;
  connected: boolean;
  isHost: boolean;
  kicked?: boolean;
  /** Present only if this viewer is allowed to know it. */
  role?: Role;
}

export interface View {
  serverNow: number;
  code: string;
  phase: Phase;
  round: number;
  phaseEndsAt: number | null;
  paused: boolean;
  pausedRemainingMs: number | null;
  settings: {
    mafiaCount: number | null;
    targetMinutes: number | null;
    simpleMode: boolean;
    revealOnDeath: boolean;
    christmas: boolean;
    discussSecs: number;
    voteSecs: number;
  };
  roleCounts: Record<Role, number>;
  minPlayers: number;
  maxPlayers: number;
  maxMafia: number;
  canExtend: boolean;
  /** Present while a game-length plan is running. */
  schedule?: { startedAt: number; targetMinutes: number };
  players: PublicPlayer[];
  me?: {
    id: string;
    name: string;
    role?: Role;
    alive: boolean;
    isHost: boolean;
    teammates: string[];
    ready: boolean;
  };
  readyProgress?: { done: number; total: number };
  night?: {
    /** Simple Mode villagers: tapping is allowed but the night does not wait for it. */
    optional: boolean;
    locked: boolean;
    pick?: string;
    options: string[];
    /** Mafia only: teammates' current picks. */
    mafiaPicks?: Record<string, string>;
    progress: { done: number; total: number };
  };
  vote?: {
    myVote?: string;
    options: string[];
    progress: { done: number; total: number };
  };
  dawn?: DawnResult;
  verdict?: VerdictResult;
  narration?: Narration;
  detectiveNotes?: DetectiveNote[];
  /** Only for ghosts and at game over. */
  history?: HistoryEntry[];
  winner?: Team;
}

export interface Ack {
  ok: boolean;
  code?: string;
  message?: string;
  [key: string]: unknown;
}

export const ROLE_INFO: Record<Role, { name: string; team: Team; blurb: string }> = {
  villager: {
    name: 'Villager',
    team: 'village',
    blurb: 'A regular at the bar. Keep your eyes open and your pint steady. Find the Traitors and vote them out.',
  },
  mafia: {
    name: 'Mafia',
    team: 'mafia',
    blurb: 'A Traitor at the bar. Each night, agree with your fellow Traitors on who to get rid of. By day, blend in.',
  },
  detective: {
    name: 'Detective',
    team: 'village',
    blurb: 'Each night, check one person. You are told whether they are Mafia or not. Use it wisely.',
  },
  doctor: {
    name: 'Doctor',
    team: 'village',
    blurb: 'Each night, protect one person from the Traitors. You can save yourself only once, and never the same person two nights running.',
  },
};
