import Database from "better-sqlite3";
import { io } from "socket.io-client";

const baseUrl = process.env.TEG_URL ?? "http://127.0.0.1:3100";
const suffix = Date.now().toString(36).slice(-6);
let gameId;
let firstId;
let secondId;
let firstSocket;
let secondSocket;

function waitFor(socket, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Tiempo agotado esperando ${event}.`));
    }, timeoutMs);
    const handler = (payload) => {
      clearTimeout(timer);
      resolve(payload);
    };
    socket.once(event, handler);
  });
}

function emitWithAck(socket, event, payload, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    socket.timeout(timeoutMs).emit(event, payload, (timeoutError, result) => {
      if (timeoutError) reject(timeoutError);
      else if (!result?.ok) reject(new Error(result?.error || `${event} fue rechazado.`));
      else resolve(result);
    });
  });
}

async function json(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers }
  });
  if (!response.ok) throw new Error((await response.json()).error || `${response.status} ${response.statusText}`);
  return response.json();
}

try {
  const first = await json("/api/session", {
    method: "POST",
    body: JSON.stringify({ name: `VozA${suffix}`, avatar: "A" })
  });
  const second = await json("/api/session", {
    method: "POST",
    body: JSON.stringify({ name: `VozB${suffix}`, avatar: "B" })
  });
  firstId = first.id;
  secondId = second.id;

  const game = await json("/api/games", {
    method: "POST",
    body: JSON.stringify({
      name: `Prueba voz ${suffix}`,
      host: first,
      settings: {
        visibility: "private",
        maxPlayers: 2,
        turnSeconds: 60,
        spectators: false,
        defensiveExchange: false
      }
    })
  });
  gameId = game.id;
  await json("/api/games/join", {
    method: "POST",
    body: JSON.stringify({ code: game.code, session: second })
  });

  firstSocket = io(baseUrl, { transports: ["websocket"] });
  secondSocket = io(baseUrl, { transports: ["websocket"] });
  await Promise.all([waitFor(firstSocket, "connect"), waitFor(secondSocket, "connect")]);
  await Promise.all([
    emitWithAck(firstSocket, "game:watch", { gameId, playerId: first.id }),
    emitWithAck(secondSocket, "game:watch", { gameId, playerId: second.id })
  ]);

  const joinedNotice = waitFor(firstSocket, "game:voice-peer-joined");
  const firstVoice = await emitWithAck(firstSocket, "game:voice-join", { gameId });
  const secondVoice = await emitWithAck(secondSocket, "game:voice-join", { gameId });
  const joinedPeer = await joinedNotice;
  if (firstVoice.peers.length !== 0) throw new Error("La primera conexión recibió pares inesperados.");
  if (secondVoice.peers.length !== 1 || secondVoice.peers[0].socketId !== firstSocket.id) {
    throw new Error("La segunda conexión no recibió al primer jugador.");
  }
  if (joinedPeer.socketId !== secondSocket.id) throw new Error("No se notificó correctamente el ingreso a voz.");

  const signalNotice = waitFor(firstSocket, "game:voice-signal");
  secondSocket.emit("game:voice-signal", {
    gameId,
    target: firstSocket.id,
    description: { type: "offer", sdp: "voice-smoke-test" }
  });
  const signal = await signalNotice;
  if (signal.from !== secondSocket.id || signal.description?.sdp !== "voice-smoke-test") {
    throw new Error("La señal WebRTC no fue reenviada correctamente.");
  }

  const leftNotice = waitFor(firstSocket, "game:voice-peer-left");
  secondSocket.emit("game:voice-leave");
  const leftPeer = await leftNotice;
  if (leftPeer.socketId !== secondSocket.id) throw new Error("No se notificó correctamente la salida de voz.");

  console.log("Voice signaling smoke test: OK");
} finally {
  firstSocket?.disconnect();
  secondSocket?.disconnect();
  if (gameId || firstId || secondId) {
    const db = new Database("data/reinos.sqlite");
    if (gameId) db.prepare("DELETE FROM games WHERE id = ?").run(gameId);
    if (firstId) db.prepare("DELETE FROM users WHERE id = ?").run(firstId);
    if (secondId) db.prepare("DELETE FROM users WHERE id = ?").run(secondId);
    db.close();
  }
}
