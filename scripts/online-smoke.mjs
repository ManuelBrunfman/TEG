import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { io } from "socket.io-client";

const root = fileURLToPath(new URL("../", import.meta.url));
const dataDir = await mkdtemp(path.join(tmpdir(), "teg-online-test-"));
const sockets = [];
let server;
let baseUrl;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startServer() {
  server = spawn(process.execPath, [path.join(root, "dist-server/server/index.js")], {
    cwd: root, env: { ...process.env, PORT: "0", TEG_DATA_DIR: dataDir }, windowsHide: true
  });
  baseUrl = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`El servidor no arrancó: ${output}`)), 10000);
    server.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); }
    });
    server.stderr.on("data", (chunk) => { output += chunk; });
    server.once("error", (error) => { clearTimeout(timer); reject(error); });
    server.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Servidor terminó (${code}): ${output}`)); });
  });
}
async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const stopped = once(server, "exit");
  server.kill();
  await stopped;
}
async function json(route, body) {
  const response = await fetch(`${baseUrl}${route}`, body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  } : undefined);
  const value = await response.json();
  assert.equal(response.ok, true, value.error);
  return value;
}
async function watch(gameId, playerId) {
  const socket = io(baseUrl, { transports: ["websocket"], autoConnect: false });
  sockets.push(socket);
  socket.on("game:state", (game) => { socket.snapshot = game; });
  const connected = once(socket, "connect");
  socket.connect();
  await connected;
  const ack = await new Promise((resolve, reject) => socket.timeout(5000).emit(
    "game:watch", { gameId, playerId }, (error, value) => error ? reject(error) : resolve(value)
  ));
  assert.equal(ack.ok, true, ack.error);
  assert.ok(Math.abs(ack.serverNow - Date.now()) < 2000);
  return socket;
}
async function waitUntil(check, milliseconds = 5000) {
  const deadline = Date.now() + milliseconds;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("El estado esperado no llegó.");
    await delay(25);
  }
}

try {
  await startServer();
  const host = await json("/api/session", { name: "Manualete", avatar: "M" });
  const family = await json("/api/session", { name: "Familia", avatar: "F" });
  const game = await json("/api/games", {
    name: "Prueba familiar", host,
    settings: { visibility: "private", maxPlayers: 2, turnSeconds: 30, spectators: false, defensiveExchange: false }
  });
  await json("/api/games/join", { code: game.code, session: family });
  const observer = await watch(game.id, family.id);
  const tabOne = await watch(game.id, host.id);
  const tabTwo = await watch(game.id, host.id);
  await json(`/api/games/${game.id}/start`, { actorId: host.id });
  await waitUntil(() => observer.snapshot?.status === "playing");
  const started = observer.snapshot;
  const activeId = started.players[started.activePlayerIndex].id;
  const activeSession = activeId === host.id ? host : family;
  const deadline = started.turnDeadline;
  const armyCount = started.countries.reduce((sum, country) => sum + country.armies, 0);

  tabOne.disconnect();
  await delay(200);
  assert.equal(observer.snapshot.players.find((player) => player.id === host.id).connected, true);
  tabTwo.disconnect();
  observer.disconnect();
  await delay(900);
  const disconnected = await json(`/api/games/${game.id}?viewerId=${activeId}`);
  assert.equal(disconnected.turnDeadline, deadline);
  assert.equal(disconnected.activePlayerIndex, started.activePlayerIndex);
  assert.equal(disconnected.countries.reduce((sum, country) => sum + country.armies, 0), armyCount);
  console.log("OK: cerrar pestañas no adelanta el turno ni reinicia el reloj.");

  const returning = await json("/api/session", { id: activeSession.id, name: activeSession.name, avatar: activeSession.avatar });
  assert.equal(returning.id, activeId);
  const resumed = await json("/api/games/join", { code: game.code, session: returning });
  assert.equal(resumed.turnDeadline, deadline);
  const restored = await watch(game.id, activeId);
  assert.notEqual(restored.snapshot.players.find((player) => player.id === activeId).missionId, "hidden");
  await json("/api/games/join", { code: game.code, session: activeId === host.id ? family : host });
  await delay(100);
  assert.notEqual(restored.snapshot.players.find((player) => player.id === activeId).missionId, "hidden");
  assert.equal(restored.snapshot.turnDeadline, deadline);
  console.log("OK: mismo invitado recupera su lugar, objetivo y tiempo restante.");

  restored.disconnect();
  await stopServer();
  await startServer();
  const persisted = await json(`/api/games/${game.id}?viewerId=${activeId}`);
  assert.equal(persisted.turnDeadline, deadline);
  assert.equal(persisted.players[persisted.activePlayerIndex].id, activeId);
  const spectator = await watch(game.id, activeId === host.id ? family.id : host.id);
  await waitUntil(() => spectator.snapshot?.activePlayerIndex !== started.activePlayerIndex, Math.max(1000, deadline - Date.now() + 2500));
  assert.equal(spectator.snapshot.countries.reduce((sum, country) => sum + country.armies, 0), armyCount + started.reinforcements);
  assert.ok(spectator.snapshot.messages.some((message) => message.text.includes("se agotó")));
  assert.equal(spectator.snapshot.players.find((player) => player.id === activeId).connected, false);
  console.log("OK: el servidor conserva la partida y avanza sólo al agotarse el reloj.");
} finally {
  sockets.forEach((socket) => socket.disconnect());
  await stopServer();
  await rm(dataDir, { recursive: true, force: true });
}
