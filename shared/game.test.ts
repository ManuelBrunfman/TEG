import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addPlayer, applyAction, createGame, runBotStep, startGame } from "./game.js";
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
    assert.ok(TERRITORY_SPRITES.every((sprite) =>
      sprite.markerX >= sprite.x &&
      sprite.markerX <= sprite.x + sprite.width &&
      sprite.markerY >= sprite.y &&
      sprite.markerY <= sprite.y + sprite.height
    ));
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

  it("completa partidas de dos a seis bots sin estados inválidos", (context) => {
    const originalRandom = Math.random;
    const results: Array<{ players: number; actions: number; rounds: number; winner?: string; reason: string | null }> = [];
    try {
      for (let playerCount = 2; playerCount <= 6; playerCount += 1) {
        let seed = 721347 + playerCount * 997;
        Math.random = () => {
          seed = (seed * 48271) % 0x7fffffff;
          return seed / 0x7fffffff;
        };

        const botSettings: GameSettings = { ...settings, maxPlayers: playerCount };
        const game = createGame({ name: `Simulación ${playerCount}`, host: { ...host, id: `bot-1-${playerCount}` }, settings: botSettings });
        game.players[0].isBot = true;
        game.players[0].connected = true;
        for (let index = 2; index <= playerCount; index += 1) addPlayer(game, { name: `Bot ${index}`, isBot: true });

        startGame(game);
        let actions = 0;
        while (game.status === "playing" && actions < 100000) {
          runBotStep(game);
          actions += 1;

          const validOwners = new Set(game.players.map((player) => player.id));
          assert.equal(game.countries.length, 50);
          assert.ok(game.countries.every((country) => validOwners.has(country.ownerId)));
          assert.ok(game.countries.every((country) => Number.isInteger(country.armies) && country.armies >= 1));
          assert.ok(game.activePlayerIndex >= 0 && game.activePlayerIndex < game.players.length);
        }

        assert.equal(game.status, "finished", `la simulación de ${playerCount} jugadores superó 100.000 acciones`);
        assert.ok(game.winnerId);
        assert.ok(game.round > 0);
        results.push({
          players: playerCount,
          actions,
          rounds: game.round,
          winner: game.players.find((player) => player.id === game.winnerId)?.name,
          reason: game.winnerReason
        });
      }
      context.diagnostic(JSON.stringify(results));
    } finally {
      Math.random = originalRandom;
    }
  });
});
