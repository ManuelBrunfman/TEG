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
  defensiveExchange: false
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

function finishInitialPlacement(game: ReturnType<typeof startedGame>) {
  while (game.phase === "setup-5" || game.phase === "setup-3") {
    const player = game.players[game.activePlayerIndex];
    const country = game.countries.find((item) => item.ownerId === player.id)!;
    applyAction(game, player.id, { type: "place", countryId: country.id, count: game.reinforcements });
    applyAction(game, player.id, { type: "confirm-placement" });
  }
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

  it("completa las disposiciones iniciales y comienza atacando sin nuevos refuerzos", () => {
    const game = startedGame();
    finishInitialPlacement(game);
    assert.equal(game.phase, "attack");
    assert.equal(game.round, 1);
    assert.equal(game.reinforcements, 0);
    assert.equal(game.roundStage, "combat");
  });

  it("otorga un mínimo de 3 refuerzos y separa la colocación de los ataques", () => {
    const game = startedGame();
    const first = game.players[0];
    const second = game.players[1];
    game.roundStarterIndex = 0;
    game.activePlayerIndex = 0;
    game.roundStage = "combat";
    game.round = 1;
    game.phase = "regroup";
    game.countries.forEach((country) => {
      country.ownerId = first.id;
      country.armies = 1;
    });
    game.countries[1].ownerId = second.id;

    applyAction(game, first.id, { type: "end-turn" });
    assert.equal(game.phase, "attack");
    assert.equal(game.activePlayerIndex, 1);

    game.phase = "regroup";
    applyAction(game, second.id, { type: "end-turn" });
    assert.equal(game.phase, "reinforce");
    assert.equal(game.round, 2);
    assert.equal(game.activePlayerIndex, 1);
    assert.equal(game.baseReinforcements, 3);

    applyAction(game, second.id, { type: "place", countryId: 1, count: 3 });
    assert.equal(game.activePlayerIndex, 1);
    applyAction(game, second.id, { type: "confirm-placement" });
    assert.equal(game.phase, "reinforce");
    assert.equal(game.activePlayerIndex, 0);
  });

  it("separa los ejércitos libres del bonus continental", () => {
    const game = startedGame();
    const player = game.players[0];
    const rival = game.players[1];

    game.activePlayerIndex = 0;
    game.roundStarterIndex = 1;
    game.phase = "reinforce";
    game.countries.forEach((country) => {
      country.ownerId = rival.id;
      country.armies = 1;
    });
    for (const countryId of [0, 1, 2, 3, 4, 5, 26]) {
      game.countries[countryId].ownerId = player.id;
    }
    game.reinforcements = 5;
    game.baseReinforcements = 2;
    game.continentReinforcements = { "america-sur": 3 };

    assert.throws(
      () => applyAction(game, player.id, { type: "place", countryId: 26, count: 1, source: "america-sur" }),
      /solo puede colocarse/
    );

    applyAction(game, player.id, { type: "place", countryId: 0, count: 2, source: "base" });
    assert.equal(game.continentReinforcements["america-sur"], 3);
    assert.equal(game.baseReinforcements, 0);
    assert.equal(game.reinforcements, 3);

    applyAction(game, player.id, { type: "place", countryId: 0, count: 3, source: "america-sur" });
    assert.equal(game.continentReinforcements["america-sur"], 0);
    assert.equal(game.reinforcements, 0);
    applyAction(game, player.id, { type: "confirm-placement" });
    assert.equal(game.phase, "attack");
    assert.equal(game.baseReinforcements, 0);
  });

  it("permite deshacer la última colocación antes de confirmarla", () => {
    const game = startedGame();
    const player = game.players[0];
    const country = game.countries.find((item) => item.ownerId === player.id)!;
    const originalArmies = country.armies;

    applyAction(game, player.id, { type: "place", countryId: country.id, count: 2, source: "base" });
    assert.equal(country.armies, originalArmies + 2);
    assert.equal(game.reinforcements, 3);
    applyAction(game, player.id, { type: "undo-place" });
    assert.equal(country.armies, originalArmies);
    assert.equal(game.reinforcements, 5);
    assert.equal(game.baseReinforcements, 5);
  });

  it("resuelve dados y permite elegir de 1 a 3 ejércitos para ocupar", () => {
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
      assert.equal(game.phase, "occupy");
      assert.deepEqual([game.pendingConquest?.minimum, game.pendingConquest?.maximum], [1, 3]);
      applyAction(game, attacker.id, { type: "occupy", count: 3 });
      assert.equal(game.phase, "attack");
      assert.equal(game.countries[1].armies, 3);
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

  it("no realiza canjes automáticos al defensor", () => {
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
      { countryId: 6, symbol: "cañón", used: false },
      { countryId: 7, symbol: "cañón", used: false },
      { countryId: 8, symbol: "cañón", used: false }
    ];
    const originalRandom = Math.random;
    const rolls = [0.99, 0.99, 0.99, 0];
    Math.random = () => rolls.shift() ?? 0;
    try {
      applyAction(game, attacker.id, { type: "attack", from: 0, to: 1 });
      assert.equal(defender.cards.length, 3);
      assert.equal(defender.exchanges, 0);
      assert.equal(game.countries[1].ownerId, attacker.id);
    } finally {
      Math.random = originalRandom;
    }
  });

  it("suma una sola vez los 2 ejércitos al conquistar un país cuya tarjeta conserva", () => {
    const game = startedGame();
    game.phase = "attack";
    game.activePlayerIndex = 0;
    game.roundStarterIndex = 0;
    const attacker = game.players[0];
    const defender = game.players[1];
    game.countries.forEach((country) => {
      country.ownerId = defender.id;
      country.armies = 1;
    });
    game.countries[0].ownerId = attacker.id;
    game.countries[0].armies = 6;
    attacker.cards = [{ countryId: 1, symbol: "galeón", used: false }];
    const originalRandom = Math.random;
    const rolls = [0.99, 0.99, 0.99, 0];
    Math.random = () => rolls.shift() ?? 0;
    try {
      applyAction(game, attacker.id, { type: "attack", from: 0, to: 1 });
      applyAction(game, attacker.id, { type: "occupy", count: 1 });
      applyAction(game, attacker.id, { type: "end-attack" });
      applyAction(game, attacker.id, { type: "end-turn" });
      assert.equal(game.countries[1].armies, 3);
      assert.equal(attacker.cards[0].used, true);
    } finally {
      Math.random = originalRandom;
    }
  });

  it("permite elegir manualmente tres cartas válidas sólo durante refuerzos", () => {
    const game = startedGame();
    const player = game.players[0];
    game.activePlayerIndex = 0;
    game.roundStarterIndex = 1;
    game.phase = "reinforce";
    game.reinforcements = 3;
    game.baseReinforcements = 3;
    player.cards = [
      { countryId: 6, symbol: "cañón", used: false },
      { countryId: 7, symbol: "cañón", used: false },
      { countryId: 8, symbol: "cañón", used: false },
      { countryId: 9, symbol: "galeón", used: false }
    ];

    assert.throws(
      () => applyAction(game, player.id, { type: "exchange", cardCountryIds: [6, 6, 6] }),
      /tres tarjetas diferentes/
    );
    applyAction(game, player.id, { type: "exchange", cardCountryIds: [6, 7, 8] });
    assert.equal(player.cards.length, 1);
    assert.equal(player.exchanges, 1);
    assert.equal(game.baseReinforcements, 7);
    assert.equal(game.reinforcements, 7);

    game.phase = "attack";
    assert.throws(
      () => applyAction(game, player.id, { type: "exchange", cardCountryIds: [6, 7, 8] }),
      /fase de refuerzos/
    );

    const distinctGame = startedGame();
    const distinctPlayer = distinctGame.players[0];
    distinctGame.activePlayerIndex = 0;
    distinctGame.phase = "reinforce";
    distinctGame.reinforcements = 3;
    distinctGame.baseReinforcements = 3;
    distinctPlayer.cards = [
      { countryId: 6, symbol: "cañón", used: false },
      { countryId: 9, symbol: "galeón", used: false },
      { countryId: 11, symbol: "globo", used: false }
    ];
    applyAction(distinctGame, distinctPlayer.id, { type: "exchange", cardCountryIds: [6, 9, 11] });
    assert.equal(distinctPlayer.cards.length, 0);
  });

  it("exige dos conquistas para recibir tarjeta desde el tercer canje y nunca supera cinco", () => {
    const game = startedGame();
    const player = game.players[0];
    game.activePlayerIndex = 0;
    game.roundStarterIndex = 0;
    game.phase = "regroup";
    player.exchanges = 3;
    player.countriesConqueredThisTurn = 1;
    game.deck = [{ countryId: 49, symbol: "cañón", used: false }];
    applyAction(game, player.id, { type: "end-turn" });
    assert.equal(player.cards.length, 0);

    game.activePlayerIndex = 0;
    game.phase = "regroup";
    player.countriesConqueredThisTurn = 2;
    player.cards = [
      { countryId: 6, symbol: "cañón", used: false },
      { countryId: 7, symbol: "cañón", used: false },
      { countryId: 8, symbol: "cañón", used: false },
      { countryId: 9, symbol: "galeón", used: false },
      { countryId: 10, symbol: "galeón", used: false }
    ];
    applyAction(game, player.id, { type: "end-turn" });
    assert.equal(player.cards.length, 5);
  });

  it("permite reagrupar más de tres ejércitos sin volver a mover los recibidos", () => {
    const game = startedGame();
    const player = game.players[0];
    game.activePlayerIndex = 0;
    game.phase = "regroup";
    game.countries[0].ownerId = player.id;
    game.countries[1].ownerId = player.id;
    game.countries[0].armies = 10;
    game.countries[1].armies = 1;
    applyAction(game, player.id, { type: "regroup", from: 0, to: 1, count: 7 });
    assert.equal(game.countries[0].armies, 3);
    assert.equal(game.countries[1].armies, 8);
    assert.throws(
      () => applyAction(game, player.id, { type: "regroup", from: 1, to: 0, count: 1 }),
      /Cantidad inválida/
    );
  });

  it("el jugador desconectado coloca fichas pero no ataca automáticamente", () => {
    const game = startedGame();
    const player = game.players[0];
    player.connected = false;
    game.activePlayerIndex = 0;
    game.phase = "attack";
    game.countries[0].ownerId = player.id;
    game.countries[0].armies = 20;
    game.countries[1].ownerId = game.players[1].id;
    game.countries[1].armies = 1;
    runBotStep(game);
    assert.equal(game.phase, "regroup");
    assert.equal(game.lastBattle, null);
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
          assert.ok(game.players.every((player) => player.cards.length <= 50));
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
