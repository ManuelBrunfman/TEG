import assert from "node:assert/strict";
import { it } from "node:test";
import { Presence } from "./presence.js";

it("cerrar una pestaña mantiene conectado al jugador en la otra", () => {
  const presence = new Presence();
  presence.watch("tab-one", "game", "Manualete");
  presence.watch("tab-two", "game", "Manualete");
  presence.leave("tab-one");
  assert.equal(presence.connected("game", "Manualete"), true);
  presence.leave("tab-two");
  assert.equal(presence.connected("game", "Manualete"), false);
});
it("cambiar de sala o de jugador actualiza la presencia sin duplicarla", () => {
  const presence = new Presence();
  presence.watch("tab", "first", "Manualete");
  presence.watch("tab", "first", "Manualete");
  assert.deepEqual(presence.watch("tab", "second", "Ana"), { gameId: "first", playerId: "Manualete" });
  assert.equal(presence.connected("first", "Manualete"), false);
  assert.equal(presence.connected("second", "Ana"), true);
  presence.watch("spectator", "first");
  assert.equal(presence.connected("first", "Manualete"), false);
  presence.leave("tab");
  assert.equal(presence.connected("second", "Ana"), false);
});
