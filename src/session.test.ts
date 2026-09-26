import assert from "node:assert/strict";
import { it } from "node:test";
import type { Session } from "../shared/types.js";
import { forgetOnlineGame, leaveSession, rememberedSession, rememberOnlineGame, rememberSession, savedOnlineGame, savedSession } from "./session.js";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
const manualete: Session = { id: "guest-one", name: "Manualete", avatar: "⚔️", registered: false, admin: false };
const partida = { id: "game-one", code: "ABCDEF", name: "En familia" };

it("Salir conserva al invitado y su partida y reconoce el mismo nombre", () => {
  const storage = new MemoryStorage();
  rememberOnlineGame(partida, manualete, storage);
  leaveSession(storage);
  assert.equal(savedSession(storage), null);
  assert.equal(rememberedSession(" manualete ", storage)?.id, manualete.id);
  rememberSession({ ...manualete, avatar: "🛡️" }, storage);
  assert.equal(savedOnlineGame(manualete.id, storage)?.id, partida.id);
});
it("migra el invitado y la partida del navegador anterior al salir", () => {
  const storage = new MemoryStorage();
  storage.setItem("reinos-session", JSON.stringify(manualete));
  storage.setItem("reinos-online-game", JSON.stringify(partida));
  leaveSession(storage);
  assert.equal(rememberedSession(undefined, storage)?.id, manualete.id);
  assert.equal(savedOnlineGame(manualete.id, storage)?.code, partida.code);
});
it("cada persona del mismo navegador recupera su propia partida", () => {
  const storage = new MemoryStorage();
  const ana = { ...manualete, id: "guest-two", name: "Ana" };
  rememberOnlineGame(partida, manualete, storage);
  leaveSession(storage);
  rememberOnlineGame({ ...partida, id: "game-two", code: "OTHER" }, ana, storage);
  leaveSession(storage);
  assert.equal(rememberedSession("Manualete", storage)?.id, manualete.id);
  assert.equal(savedOnlineGame(manualete.id, storage)?.id, "game-one");
  assert.equal(savedOnlineGame(ana.id, storage)?.id, "game-two");
  forgetOnlineGame(ana.id, storage);
  assert.equal(savedOnlineGame(ana.id, storage), null);
  assert.equal(rememberedSession("Ana", storage)?.id, ana.id);
  assert.equal(savedOnlineGame(manualete.id, storage)?.id, "game-one");
});
it("ignora un almacenamiento ilegible", () => {
  const storage = new MemoryStorage();
  storage.setItem("reinos-remembered-players", "{");
  storage.setItem("reinos-session", "[]");
  assert.equal(savedSession(storage), null);
  assert.equal(rememberedSession("Manualete", storage), null);
});
