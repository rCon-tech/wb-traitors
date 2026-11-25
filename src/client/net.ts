import { useEffect, useState, useSyncExternalStore } from 'react';
import { io } from 'socket.io-client';
import type { Ack, View } from '../shared/types';

export const socket = io({ autoConnect: true });

interface Session {
  code: string;
  token: string;
}
interface State {
  view: View | null;
  connected: boolean;
  session: Session | null;
  toast: string | null;
  tvError: string | null;
}

const KEY = 'wbm:session';
const NAME_KEY = 'wbm:name';

const readSession = (): Session | null => {
  try {
    const raw = localStorage.getItem(KEY);
    const s = raw ? (JSON.parse(raw) as Session) : null;
    return s && typeof s.code === 'string' && typeof s.token === 'string' ? s : null;
  } catch {
    return null;
  }
};
export const saveSession = (s: Session) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode: rejoin after refresh just won't work */
  }
  set({ session: s });
};
export const clearSession = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  set({ session: null, view: null });
};
export const rememberedName = () => {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
};
export const rememberName = (n: string) => {
  try {
    localStorage.setItem(NAME_KEY, n);
  } catch {
    /* ignore */
  }
};

let state: State = { view: null, connected: socket.connected, session: readSession(), toast: null, tvError: null };
const listeners = new Set<() => void>();
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
  if (patch.toast) {
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ toast: null }), 4500);
  }
}
export const toast = (message: string) => set({ toast: message });

// Registered at import time, so the very first connect is never missed.
socket.on('connect', () => set({ connected: true }));
socket.on('disconnect', () => set({ connected: false }));

export const useStore = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );

/** Server clock minus our clock, so countdowns agree across phones with wrong clocks. */
let offset = 0;
export const serverNow = () => Date.now() + offset;

export function emit(event: string, payload?: unknown): Promise<Ack> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ ok: false, code: 'TIMEOUT', message: 'No answer from the pub. Check your signal.' }), 8000);
    socket.emit(event, payload ?? {}, (a: Ack) => {
      clearTimeout(t);
      resolve(a);
    });
  });
}

/** Send a game action; surface errors as a toast. */
export async function act(event: string, payload?: unknown): Promise<Ack> {
  const a = await emit(event, payload);
  if (!a.ok) {
    if (a.code === 'NO_SESSION') clearSession();
    toast(a.message ?? 'That did not work.');
  }
  return a;
}

let playerStarted = false;
export function startPlayer() {
  if (playerStarted) return;
  playerStarted = true;
  const resume = async () => {
    const s = readSession();
    if (!s) return;
    const a = await emit('room:rejoin', s);
    if (!a.ok && (a.code === 'ROOM_NOT_FOUND' || a.code === 'BAD_TOKEN')) {
      clearSession();
      toast(a.message ?? 'That game has ended.');
    }
  };
  socket.on('state:view', (v: View) => {
    offset = v.serverNow - Date.now();
    set({ view: v });
  });
  socket.on('connect', () => void resume());
  socket.on('room:kicked', () => {
    clearSession();
    toast('The host has shown you the door.');
  });
  socket.on('room:closed', () => {
    clearSession();
    toast('That pub has closed for the night.');
  });
  if (socket.connected) void resume();
}

let tvStarted = false;
export function startTv(code: string) {
  if (tvStarted) return;
  tvStarted = true;
  const join = async () => {
    const a = await emit('tv:join', { code });
    set({ tvError: a.ok ? null : (a.message ?? 'Could not open the TV screen.') });
  };
  socket.on('state:public', (v: View) => {
    offset = v.serverNow - Date.now();
    set({ view: v });
  });
  socket.on('connect', () => void join());
  socket.on('room:closed', () => set({ tvError: 'This pub has closed for the night.', view: null }));
  if (socket.connected) void join();
}

/** Re-render regularly so countdowns tick. */
export function useTicker(ms = 250) {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

/** Seconds left in the current phase (frozen while paused), or null if untimed. */
export function secondsLeft(view: View): number | null {
  if (view.paused && view.pausedRemainingMs !== null) return Math.ceil(view.pausedRemainingMs / 1000);
  if (view.phaseEndsAt === null) return null;
  return Math.max(0, Math.ceil((view.phaseEndsAt - serverNow()) / 1000));
}
