import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { GameAction, GameSettings, Session } from "../shared/types.js";
import {
  acceptFriend,
  acceptGameInvite,
  createGameInvite,
  deleteGuestUserIfInactive,
  listFriends,
  listGameInvites,
  listUsers,
  requestFriend,
  setUserBlocked,
  upsertUser,
  userProfile
} from "./db.js";
import { store } from "./store.js";

const port = Number(process.env.PORT || 3100);
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: true, credentials: true } });

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const wrap =
  (handler: express.RequestHandler): express.RequestHandler =>
  async (request, response, next) => {
    try {
      await handler(request, response, next);
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : "Error inesperado." });
    }
  };

const sessionSchema = z.object({
  id: z.string().min(3).optional(),
  name: z.string().trim().min(2).max(24),
  avatar: z.string().max(8).default("⚔️")
});

app.get("/api/health", (_request, response) => response.json({ ok: true, now: Date.now() }));

app.post(
  "/api/session",
  wrap((request, response) => {
    const input = sessionSchema.parse(request.body);
    const session: Session = {
      id: input.id ?? `guest-${nanoid(14)}`,
      name: input.name,
      avatar: input.avatar,
      registered: false,
      admin: false
    };
    upsertUser(session);
    response.json(session);
  })
);
app.delete(
  "/api/session/:id",
  wrap((request, response) => {
    response.json({ deleted: deleteGuestUserIfInactive(String(request.params.id)) });
  })
);

app.get("/api/profile/:id", wrap((request, response) => response.json(userProfile(String(request.params.id)) ?? null)));
app.get("/api/friends/:id", wrap((request, response) => response.json(listFriends(String(request.params.id)))));
app.post(
  "/api/friends/request",
  wrap((request, response) => {
    const body = z.object({ userId: z.string().min(3), friendName: z.string().trim().min(2).max(24) }).parse(request.body);
    requestFriend(body.userId, body.friendName);
    response.json(listFriends(body.userId));
  })
);
app.post(
  "/api/friends/accept",
  wrap((request, response) => {
    const body = z.object({ userId: z.string().min(3), friendId: z.string().min(3) }).parse(request.body);
    acceptFriend(body.userId, body.friendId);
    response.json(listFriends(body.userId));
  })
);
app.get("/api/invites/:id", wrap((request, response) => response.json(listGameInvites(String(request.params.id)))));
app.post(
  "/api/invites",
  wrap((request, response) => {
    const body = z.object({ gameId: z.string(), fromUserId: z.string(), toUserId: z.string() }).parse(request.body);
    const game = store.get(body.gameId);
    if (!game || game.hostId !== body.fromUserId || game.status !== "lobby") throw new Error("La invitación no es válida.");
    createGameInvite(nanoid(12), body.gameId, body.fromUserId, body.toUserId);
    response.json({ ok: true });
  })
);
app.post(
  "/api/invites/:id/accept",
  wrap((request, response) => {
    const userId = z.string().min(3).parse(request.body.userId);
    response.json({ code: acceptGameInvite(String(request.params.id), userId) });
  })
);
app.get("/api/games", (_request, response) => response.json(store.publicGames()));

app.post(
  "/api/games",
  wrap((request, response) => {
    const body = z
      .object({
        name: z.string().max(40).default("Mesa del reino"),
        host: sessionSchema.extend({ id: z.string().min(3) }),
        settings: z.object({
          visibility: z.enum(["public", "private", "local"]),
          maxPlayers: z.number().int().min(2).max(6),
          turnSeconds: z.number().int().min(30).max(300),
          spectators: z.boolean(),
          defensiveExchange: z.boolean()
        })
      })
      .parse(request.body);
    const host: Session = { ...body.host, registered: false, admin: false };
    upsertUser(host);
    const game = store.create(body.name, host, body.settings as GameSettings);
    response.json(store.view(game.id, host.id));
  })
);

app.post(
  "/api/games/join",
  wrap((request, response) => {
    const body = z.object({ code: z.string().min(4), session: sessionSchema.extend({ id: z.string().min(3) }) }).parse(request.body);
    const game = store.findByCode(body.code);
    if (!game) throw new Error("No existe una mesa con ese código.");
    if (game.settings.visibility === "local") throw new Error("Esa partida es local.");
    const session: Session = { ...body.session, registered: false, admin: false };
    upsertUser(session);
    if (game.status === "lobby") {
      store.join(game, session);
      io.to(game.id).emit("game:state", store.view(game.id));
    } else if (!game.settings.spectators) {
      throw new Error("Esta partida no admite espectadores.");
    }
    response.json(store.view(game.id, session.id));
  })
);

app.get(
  "/api/games/:id",
  wrap((request, response) => {
    const viewerId = typeof request.query.viewerId === "string" ? request.query.viewerId : undefined;
    response.json(store.view(String(request.params.id), viewerId));
  })
);

app.post(
  "/api/games/:id/bots",
  wrap((request, response) => {
    const game = store.get(String(request.params.id));
    if (!game || game.hostId !== request.body.actorId) throw new Error("Solo el anfitrión puede agregar bots.");
    store.addBot(game.id);
    io.to(game.id).emit("game:state", store.view(game.id));
    response.json(store.view(game.id, request.body.actorId));
  })
);

app.post(
  "/api/games/:id/start",
  wrap((request, response) => {
    const game = store.start(String(request.params.id), String(request.body.actorId));
    broadcast(game.id);
    response.json(store.view(game.id, request.body.actorId));
  })
);

function adminAllowed(request: express.Request) {
  const configured = process.env.ADMIN_PIN;
  return Boolean(configured) && request.header("x-admin-pin") === configured;
}

app.get("/api/admin/overview", (request, response) => {
  if (!adminAllowed(request)) return response.status(401).json({ error: "PIN incorrecto." });
  response.json({ users: listUsers(), games: store.allGames() });
});

app.get("/api/admin/games/:id/messages", (request, response) => {
  if (!adminAllowed(request)) return response.status(401).json({ error: "PIN incorrecto." });
  response.json(store.messages(String(request.params.id)));
});

app.post("/api/admin/users/:id/block", (request, response) => {
  if (!adminAllowed(request)) return response.status(401).json({ error: "PIN incorrecto." });
  setUserBlocked(String(request.params.id), Boolean(request.body.blocked));
  response.json({ ok: true });
});

app.post("/api/admin/games/:id/close", (request, response) => {
  if (!adminAllowed(request)) return response.status(401).json({ error: "PIN incorrecto." });
  const game = store.close(String(request.params.id));
  broadcast(game.id);
  response.json({ ok: true });
});

io.on("connection", (socket) => {
  socket.on("game:watch", ({ gameId, playerId }: { gameId: string; playerId?: string }) => {
    try {
      socket.join(gameId);
      socket.data.gameId = gameId;
      socket.data.playerId = playerId;
      if (playerId) store.connect(gameId, playerId, true);
      socket.emit("game:state", store.view(gameId, playerId));
      broadcast(gameId);
    } catch (error) {
      socket.emit("game:error", error instanceof Error ? error.message : "No se pudo entrar.");
    }
  });

  socket.on(
    "game:action",
    (
      payload: { gameId: string; playerId: string; action: GameAction },
      acknowledge?: (result: { ok: boolean; error?: string }) => void
    ) => {
      try {
        store.action(payload.gameId, payload.playerId, payload.action);
        broadcast(payload.gameId);
        acknowledge?.({ ok: true });
      } catch (error) {
        acknowledge?.({ ok: false, error: error instanceof Error ? error.message : "Acción inválida." });
      }
    }
  );

  socket.on("game:chat", (payload: { gameId: string; playerId: string; text: string }) => {
    try {
      store.message(payload.gameId, payload.playerId, payload.text);
      broadcast(payload.gameId);
    } catch (error) {
      socket.emit("game:error", error instanceof Error ? error.message : "No se pudo enviar.");
    }
  });

  socket.on("disconnect", () => {
    const { gameId, playerId } = socket.data as { gameId?: string; playerId?: string };
    if (gameId && playerId) {
      try {
        store.connect(gameId, playerId, false);
        broadcast(gameId);
      } catch {
        // La partida pudo haber sido eliminada durante la desconexión.
      }
    }
  });
});

function broadcast(gameId: string) {
  for (const socket of io.sockets.sockets.values()) {
    if (socket.rooms.has(gameId)) {
      socket.emit("game:state", store.view(gameId, socket.data.playerId));
    }
  }
}

setInterval(() => {
  for (const game of store.tick()) broadcast(game.id);
}, 500);

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(process.cwd(), "dist");
app.use(express.static(webDist));
app.get("*", (_request, response) => response.sendFile(path.join(webDist, "index.html")));

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`TEG Online disponible en http://localhost:${port}`);
});
