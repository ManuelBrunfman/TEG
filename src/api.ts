import type { ChatMessage, GameSettings, GameState, PublicGameSummary, Session } from "@shared/types";

export interface FriendSummary {
  id: string;
  name: string;
  avatar: string;
}

export interface FriendsState {
  accepted: FriendSummary[];
  incoming: FriendSummary[];
  outgoing: FriendSummary[];
}

export interface AdminUser {
  id: string;
  name: string;
  avatar: string;
  registered: number;
  games_played: number;
  games_won: number;
  blocked: number;
  created_at: number;
}

export interface GameInvite {
  id: string;
  gameId: string;
  code: string;
  fromName: string;
  gameName: string;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "No se pudo completar la operación.");
  return data as T;
}

export const api = {
  session: (name: string, avatar: string, id?: string) =>
    request<Session>("/api/session", { method: "POST", body: JSON.stringify({ name, avatar, id }) }),
  deleteGuestSession: (userId: string) =>
    request<{ deleted: boolean }>(`/api/session/${userId}`, { method: "DELETE" }),
  publicGames: () => request<PublicGameSummary[]>("/api/games"),
  createGame: (name: string, host: Session, settings: GameSettings) =>
    request<GameState>("/api/games", { method: "POST", body: JSON.stringify({ name, host, settings }) }),
  joinGame: (code: string, session: Session) =>
    request<GameState>("/api/games/join", { method: "POST", body: JSON.stringify({ code, session }) }),
  addBot: (gameId: string, actorId: string) =>
    request<GameState>(`/api/games/${gameId}/bots`, { method: "POST", body: JSON.stringify({ actorId }) }),
  startGame: (gameId: string, actorId: string) =>
    request<GameState>(`/api/games/${gameId}/start`, { method: "POST", body: JSON.stringify({ actorId }) }),
  friends: (userId: string) => request<FriendsState>(`/api/friends/${userId}`),
  requestFriend: (userId: string, friendName: string) =>
    request<FriendsState>("/api/friends/request", { method: "POST", body: JSON.stringify({ userId, friendName }) }),
  acceptFriend: (userId: string, friendId: string) =>
    request<FriendsState>("/api/friends/accept", { method: "POST", body: JSON.stringify({ userId, friendId }) }),
  invites: (userId: string) => request<GameInvite[]>(`/api/invites/${userId}`),
  inviteFriend: (gameId: string, fromUserId: string, toUserId: string) =>
    request<{ ok: boolean }>("/api/invites", { method: "POST", body: JSON.stringify({ gameId, fromUserId, toUserId }) }),
  acceptInvite: (inviteId: string, userId: string) =>
    request<{ code: string }>(`/api/invites/${inviteId}/accept`, { method: "POST", body: JSON.stringify({ userId }) }),
  adminOverview: (pin: string) =>
    request<{ users: AdminUser[]; games: PublicGameSummary[] }>("/api/admin/overview", {
      headers: { "x-admin-pin": pin }
    }),
  blockUser: (pin: string, userId: string, blocked: boolean) =>
    request<{ ok: boolean }>(`/api/admin/users/${userId}/block`, {
      method: "POST",
      headers: { "x-admin-pin": pin },
      body: JSON.stringify({ blocked })
    }),
  closeGame: (pin: string, gameId: string) =>
    request<{ ok: boolean }>(`/api/admin/games/${gameId}/close`, {
      method: "POST",
      headers: { "x-admin-pin": pin },
      body: "{}"
    }),
  gameMessages: (pin: string, gameId: string) =>
    request<ChatMessage[]>(`/api/admin/games/${gameId}/messages`, { headers: { "x-admin-pin": pin } })
};
