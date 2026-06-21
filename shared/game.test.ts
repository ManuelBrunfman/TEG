import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addPlayer, applyAction, createGame, startGame } from "./game.js";
import type { GameSettings, Session } from "./types.js";
import { TERRITORY_SPRITES } from "./territories.js";

const settings: GameSettings = {
  visibility: "private",
  maxPlayers: 2,
  turnSeconds: 120,
  spectators: true,
  defensiveExchange: true
};

const host: Session = {
  id: "player-one",
  name: "Ana",
  avatar: "⚔️",
  registered: false,
  admin: false
};

function startedGame() {
  const game = createGame({ name: "Prueba", host, settings });
  addPlayer(game, { id: "player-two", name: "Beto", avatar: "🛡️" });
  startGame(game);
  return game;
}

describe("motor de Reinos en Guerra", () => {
  it("reparte los 50 territorios de forma equilibrada", () => {
    const game = startedGame();
    assert.equal(game.countries.length, 50);
    assert.deepEqual(game.players.map((player) => game.countries.filter((country) => country.ownerId === player.id).length), [25, 25]);
    assert.equal(game.phase, "setup-5");
    assert.equal(game.reinforcements, 5);
  });

  it("define una silueta cartográfica para cada uno de los 50 territorios", () => {
    assert.equal(TERRITORY_SPRITES.length, 50);
    assert.deepEqual(TERRITORY_SPRITES.map((sprite) => sprite.id), Array.from({ length: 50 }, (_, id) => id));
    assert.ok(TERRITORY_SPRITES.every((sprite) => sprite.width > 0 && sprite.height > 0));
  });

  it("completa las rondas iniciales de 5 y 3 ejércitos", () => {
    const game = startedGame();
    for (let round = 0; round < 4; round += 1) {
      const player = game.players[game.activePlayerIndex];
      const country = game.countries.find((item) => item.ownerId === player.id)!;
      applyAction(game, player.id, { type: "place", countryId: country.id, count: game.reinforcements });
    }
    assert.equal(game.phase, "reinforce");
    assert.equal(game.round, 1);
    assert.ok(game.reinforcements > 0);
  });

  it("resuelve dados ordenados y conquista al eliminar la última defensa", () => {
    const game = startedGame();
    game.phase = "attack";
    game.activePlayerIndex = 0;
    const attacker = game.players[0];
    const defender = game.players[1];
    game.countries.forEach((country) => {
      country.ownerId = defender.id;
      country.armies = 1;
    });
    game.countries[0].ownerId = attacker.id;
    game.countries[0].armies = 5;
    const originalRandom = Math.random;
    const rolls = [0.99, 0.99, 0.99, 0];
    Math.random = () => rolls.shift() ?? 0;
    try {
      applyAction(game, attacker.id, { type: "attack", from: 0, to: 1 });
      assert.equal(game.countries[1].ownerId, attacker.id);
      assert.equal(game.lastBattle?.conquered, true);
    } finally {
      Math.random = originalRandom;
    }
  });

  it("rechaza ataques entre territorios no limítrofes", () => {
    const game = startedGame();
    game.phase = "attack";
    game.activePlayerIndex = 0;
    const attacker = game.players[0];
    game.countries[0].ownerId = attacker.id;
    game.countries[0].armies = 5;
    game.countries[49].ownerId = game.players[1].id;
    assert.throws(
      () => applyAction(game, attacker.id, { type: "attack", from: 0, to: 49 }),
      /no son limítrofes/
    );
  });

  it("aplica el canje defensivo antes de tirar los dados", () => {
    const game = startedGame();
    game.phase = "attack";
    game.activePlayerIndex = 0;
    const attacker = game.players[0];
    const defender = game.players[1];
    game.countries.forEach((country) => {
      country.ownerId = defender.id;
      country.armies = 1;
    });
    game.countries[0].ownerId = attacker.id;
    game.countries[0].armies = 6;
    defender.cards = [
      { countryId: 6, symbol: "cañón" },
      { countryId: 7, symbol: "cañón" },
      { countryId: 8, symbol: "cañón" }
    ];
    const originalRandom = Math.random;
    const rolls = [0.99, 0.99, 0.99, 0, 0, 0];
    Math.random = () => rolls.shift() ?? 0;
    try {
      applyAction(game, attacker.id, { type: "attack", from: 0, to: 1 });
      assert.equal(defender.cards.length, 0);
      assert.equal(defender.exchanges, 1);
      assert.equal(game.countries[1].ownerId, defender.id);
      assert.ok(game.countries[1].armies >= 2);
    } finally {
      Math.random = originalRandom;
    }
  });

  it("pausa una partida privada solamente con acuerdo unánime", () => {
    const game = startedGame();
    const first = game.players[0];
    const second = game.players[1];
    applyAction(game, first.id, { type: "vote-pause" });
    assert.equal(game.paused, false);
    applyAction(game, second.id, { type: "vote-pause" });
    assert.equal(game.paused, true);
    assert.equal(game.turnDeadline, null);
    applyAction(game, first.id, { type: "resume" });
    assert.equal(game.paused, false);
    assert.ok(game.turnDeadline);
  });
});
