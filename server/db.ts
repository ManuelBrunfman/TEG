import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { GameState, Session } from "../shared/types.js";

const dataDir = path.resolve(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, "reinos.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    avatar TEXT NOT NULL,
    registered INTEGER NOT NULL DEFAULT 0,
    games_played INTEGER NOT NULL DEFAULT 0,
    games_won INTEGER NOT NULL DEFAULT 0,
    blocked INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    visibility TEXT NOT NULL,
    status TEXT NOT NULL,
    state_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS friendships (
    user_id TEXT NOT NULL,
    friend_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, friend_id)
  );

  CREATE TABLE IF NOT EXISTS recorded_results (
    game_id TEXT PRIMARY KEY,
    recorded_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS game_invites (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    from_user_id TEXT NOT NULL,
    to_user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    UNIQUE(game_id, to_user_id)
  );
`);

const saveGameStatement = db.prepare(`
  INSERT INTO games (id, code, visibility, status, state_json, created_at, updated_at)
  VALUES (@id, @code, @visibility, @status, @stateJson, @createdAt, @updatedAt)
  ON CONFLICT(id) DO UPDATE SET
    code = excluded.code,
    visibility = excluded.visibility,
    status = excluded.status,
    state_json = excluded.state_json,
    updated_at = excluded.updated_at
`);

export function saveGame(state: GameState) {
  saveGameStatement.run({
    id: state.id,
    code: state.code,
    visibility: state.settings.visibility,
    status: state.status,
    stateJson: JSON.stringify(state),
    createdAt: state.createdAt,
    updatedAt: state.updatedAt
  });
  if (state.status === "finished") finalizeGame(state);
}

const finalizeGame = db.transaction((state: GameState) => {
  const inserted = db.prepare("INSERT OR IGNORE INTO recorded_results (game_id, recorded_at) VALUES (?, ?)").run(state.id, Date.now());
  if (!inserted.changes) return;
  for (const player of state.players.filter((item) => !item.isBot)) {
    const user = db.prepare("SELECT registered FROM users WHERE id = ?").get(player.id) as
      | { registered: number }
      | undefined;
    if (!user) continue;
    if (user.registered) {
      db.prepare("UPDATE users SET games_played = games_played + 1, updated_at = ? WHERE id = ?").run(Date.now(), player.id);
      if (state.winnerId === player.id) {
        db.prepare("UPDATE users SET games_won = games_won + 1, updated_at = ? WHERE id = ?").run(Date.now(), player.id);
      }
      continue;
    }

    const otherActiveGame = db.prepare(`
      SELECT 1
      FROM games g, json_each(g.state_json, '$.players') participant
      WHERE g.id <> ?
        AND g.status <> 'finished'
        AND json_extract(participant.value, '$.id') = ?
      LIMIT 1
    `).get(state.id, player.id);
    if (otherActiveGame) continue;

    db.prepare("DELETE FROM friendships WHERE user_id = ? OR friend_id = ?").run(player.id, player.id);
    db.prepare("DELETE FROM game_invites WHERE from_user_id = ? OR to_user_id = ?").run(player.id, player.id);
    db.prepare("DELETE FROM users WHERE id = ? AND registered = 0").run(player.id);
  }
});

export function loadGames(): GameState[] {
  const rows = db.prepare("SELECT state_json FROM games").all() as Array<{ state_json: string }>;
  return rows.map((row) => JSON.parse(row.state_json) as GameState);
}

export function upsertUser(session: Session) {
  const now = Date.now();
  const existing = db.prepare("SELECT id, blocked FROM users WHERE id = ?").get(session.id) as
    | { id: string; blocked: number }
    | undefined;
  if (existing?.blocked) throw new Error("Este usuario está bloqueado.");
  const sameName = db.prepare("SELECT id FROM users WHERE lower(name) = lower(?) AND id <> ?").get(session.name, session.id) as
    | { id: string }
    | undefined;
  if (sameName) throw new Error("Ese nombre ya está en uso.");
  db.prepare(`
    INSERT INTO users (id, name, avatar, registered, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, avatar = excluded.avatar, updated_at = excluded.updated_at
  `).run(session.id, session.name, session.avatar, session.registered ? 1 : 0, now, now);
}

export function deleteGuestUserIfInactive(userId: string) {
  const user = db.prepare("SELECT registered FROM users WHERE id = ?").get(userId) as
    | { registered: number }
    | undefined;
  if (!user || user.registered) return false;
  const activeGame = db.prepare(`
    SELECT 1
    FROM games g, json_each(g.state_json, '$.players') participant
    WHERE g.status <> 'finished'
      AND json_extract(participant.value, '$.id') = ?
    LIMIT 1
  `).get(userId);
  if (activeGame) return false;
  const remove = db.transaction(() => {
    db.prepare("DELETE FROM friendships WHERE user_id = ? OR friend_id = ?").run(userId, userId);
    db.prepare("DELETE FROM game_invites WHERE from_user_id = ? OR to_user_id = ?").run(userId, userId);
    return db.prepare("DELETE FROM users WHERE id = ? AND registered = 0").run(userId).changes > 0;
  });
  return remove();
}

export function purgeInactiveGuestUsers() {
  const guests = db.prepare("SELECT id FROM users WHERE registered = 0").all() as Array<{ id: string }>;
  return guests.reduce((deleted, guest) => deleted + (deleteGuestUserIfInactive(guest.id) ? 1 : 0), 0);
}

export function listUsers() {
  return db
    .prepare("SELECT id, name, avatar, registered, games_played, games_won, blocked, created_at FROM users ORDER BY updated_at DESC")
    .all();
}

export function setUserBlocked(userId: string, blocked: boolean) {
  db.prepare("UPDATE users SET blocked = ?, updated_at = ? WHERE id = ?").run(blocked ? 1 : 0, Date.now(), userId);
}

export function userProfile(userId: string) {
  return db
    .prepare("SELECT id, name, avatar, registered, games_played, games_won, created_at FROM users WHERE id = ?")
    .get(userId);
}

export function listFriends(userId: string) {
  const accepted = db.prepare(`
    SELECT u.id, u.name, u.avatar
    FROM friendships f JOIN users u ON u.id = f.friend_id
    WHERE f.user_id = ? AND f.status = 'accepted'
    ORDER BY lower(u.name)
  `).all(userId);
  const incoming = db.prepare(`
    SELECT u.id, u.name, u.avatar
    FROM friendships f JOIN users u ON u.id = f.user_id
    WHERE f.friend_id = ? AND f.status = 'pending'
    ORDER BY f.created_at DESC
  `).all(userId);
  const outgoing = db.prepare(`
    SELECT u.id, u.name, u.avatar
    FROM friendships f JOIN users u ON u.id = f.friend_id
    WHERE f.user_id = ? AND f.status = 'pending'
    ORDER BY f.created_at DESC
  `).all(userId);
  return { accepted, incoming, outgoing };
}

export function requestFriend(userId: string, friendName: string) {
  const friend = db.prepare("SELECT id FROM users WHERE lower(name) = lower(?)").get(friendName) as { id: string } | undefined;
  if (!friend) throw new Error("No existe un comandante con ese nombre.");
  if (friend.id === userId) throw new Error("No podés agregarte a vos mismo.");
  const reverse = db.prepare("SELECT status FROM friendships WHERE user_id = ? AND friend_id = ?").get(friend.id, userId) as
    | { status: string }
    | undefined;
  if (reverse?.status === "pending") {
    acceptFriend(userId, friend.id);
    return;
  }
  db.prepare(`
    INSERT INTO friendships (user_id, friend_id, status, created_at)
    VALUES (?, ?, 'pending', ?)
    ON CONFLICT(user_id, friend_id) DO NOTHING
  `).run(userId, friend.id, Date.now());
}

export function acceptFriend(userId: string, friendId: string) {
  const incoming = db.prepare(`
    UPDATE friendships SET status = 'accepted'
    WHERE user_id = ? AND friend_id = ? AND status = 'pending'
  `).run(friendId, userId);
  if (!incoming.changes) throw new Error("La solicitud ya no está pendiente.");
  db.prepare(`
    INSERT INTO friendships (user_id, friend_id, status, created_at)
    VALUES (?, ?, 'accepted', ?)
    ON CONFLICT(user_id, friend_id) DO UPDATE SET status = 'accepted'
  `).run(userId, friendId, Date.now());
}

export function createGameInvite(id: string, gameId: string, fromUserId: string, toUserId: string) {
  const friendship = db.prepare(`
    SELECT 1 FROM friendships
    WHERE user_id = ? AND friend_id = ? AND status = 'accepted'
  `).get(fromUserId, toUserId);
  if (!friendship) throw new Error("Solo podés invitar a tus compañeros.");
  db.prepare(`
    INSERT INTO game_invites (id, game_id, from_user_id, to_user_id, status, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?)
    ON CONFLICT(game_id, to_user_id) DO UPDATE SET status = 'pending', created_at = excluded.created_at
  `).run(id, gameId, fromUserId, toUserId, Date.now());
}

export function listGameInvites(userId: string) {
  return db.prepare(`
    SELECT i.id, i.game_id AS gameId, g.code, u.name AS fromName,
           json_extract(g.state_json, '$.name') AS gameName
    FROM game_invites i
    JOIN games g ON g.id = i.game_id
    JOIN users u ON u.id = i.from_user_id
    WHERE i.to_user_id = ? AND i.status = 'pending' AND g.status = 'lobby'
    ORDER BY i.created_at DESC
  `).all(userId);
}

export function acceptGameInvite(inviteId: string, userId: string) {
  const invite = db.prepare(`
    SELECT i.id, g.code
    FROM game_invites i JOIN games g ON g.id = i.game_id
    WHERE i.id = ? AND i.to_user_id = ? AND i.status = 'pending'
  `).get(inviteId, userId) as { id: string; code: string } | undefined;
  if (!invite) throw new Error("La invitación ya no está disponible.");
  db.prepare("UPDATE game_invites SET status = 'accepted' WHERE id = ?").run(inviteId);
  return invite.code;
}
