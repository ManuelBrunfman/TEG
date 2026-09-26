import type { Session } from "../shared/types.js";

export interface SavedOnlineGame {
  id: string;
  code: string;
  name: string;
  playerId?: string;
}

interface RememberedPlayer {
  session: Session;
  game?: SavedOnlineGame;
}

const sessionKey = "reinos-session";
const gameKey = "reinos-online-game";
const playersKey = "reinos-remembered-players";
const normalizedName = (name: string) => name.trim().toLocaleLowerCase("es-AR");

function read<T>(storage: Storage, key: string, fallback: T): T {
  try {
    return JSON.parse(storage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}

export function savedSession(storage: Storage = localStorage): Session | null {
  const session = read<Session | null>(storage, sessionKey, null);
  return session && typeof session.id === "string" && typeof session.name === "string" ? session : null;
}

function players(storage: Storage): RememberedPlayer[] {
  const saved = read<RememberedPlayer[]>(storage, playersKey, []);
  const result = Array.isArray(saved) ? saved.filter((item) => item?.session?.id && item.session.name) : [];
  // Migrate the previously saved guest before leaving the welcome screen or signing out.
  const active = savedSession(storage);
  if (active && !result.some((item) => item.session.id === active.id)) {
    const legacy = read<SavedOnlineGame | null>(storage, gameKey, null);
    result.push({ session: active, game: legacy && (!legacy.playerId || legacy.playerId === active.id) ? legacy : undefined });
  }
  return result;
}

export function rememberedSession(name?: string, storage: Storage = localStorage): Session | null {
  const remembered = players(storage);
  if (name === undefined) return remembered.at(-1)?.session ?? null;
  return remembered.find((item) => normalizedName(item.session.name) === normalizedName(name))?.session ?? null;
}

export function rememberSession(session: Session, storage: Storage = localStorage) {
  const remembered = players(storage);
  const previous = remembered.find((item) => item.session.id === session.id);
  storage.setItem(playersKey, JSON.stringify([
    ...remembered.filter((item) => item.session.id !== session.id),
    { ...previous, session }
  ]));
  storage.setItem(sessionKey, JSON.stringify(session));
}

export function leaveSession(storage: Storage = localStorage) {
  storage.setItem(playersKey, JSON.stringify(players(storage)));
  storage.removeItem(sessionKey);
}

export function savedOnlineGame(playerId: string, storage: Storage = localStorage): SavedOnlineGame | null {
  return players(storage).find((item) => item.session.id === playerId)?.game ?? null;
}

export function rememberOnlineGame(game: SavedOnlineGame, session: Session, storage: Storage = localStorage) {
  rememberSession(session, storage);
  const saved = { ...game, playerId: session.id };
  storage.setItem(playersKey, JSON.stringify(players(storage).map((item) =>
    item.session.id === session.id ? { ...item, game: saved } : item
  )));
  storage.setItem(gameKey, JSON.stringify(saved));
}

export function forgetOnlineGame(playerId: string, storage: Storage = localStorage) {
  storage.setItem(playersKey, JSON.stringify(players(storage).map((item) =>
    item.session.id === playerId ? { session: item.session } : item
  )));
  const legacy = read<SavedOnlineGame | null>(storage, gameKey, null);
  if (legacy && (!legacy.playerId || legacy.playerId === playerId)) storage.removeItem(gameKey);
}
