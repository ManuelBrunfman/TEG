import {
  addPlayer,
  applyAction,
  createGame,
  gameSummary,
  handleTimeout,
  publicState,
  runBotStep,
  setConnection,
  startGame,
  systemMessage
} from "../shared/game.js";
import type { GameAction, GameSettings, GameState, Session } from "../shared/types.js";
import { loadGames, saveGame } from "./db.js";

class GameStore {
  private games = new Map<string, GameState>();

  constructor() {
    for (const game of loadGames()) {
      game.paused ??= false;
      game.pauseVotes ??= [];
      game.pausedRemainingMs ??= null;
      game.regroupLocked ??= {};
      game.players.forEach((player) => {
        if (!player.isBot) player.connected = false;
      });
      this.games.set(game.id, game);
    }
  }

  create(name: string, host: Session, settings: GameSettings) {
    const game = createGame({ name, host, settings });
    this.games.set(game.id, game);
    saveGame(game);
    return game;
  }

  get(gameId: string) {
    return this.games.get(gameId);
  }

  findByCode(code: string) {
    return [...this.games.values()].find((game) => game.code === code.toUpperCase());
  }

  publicGames() {
    return [...this.games.values()]
      .filter((game) => game.settings.visibility === "public" && game.status !== "finished")
      .map(gameSummary);
  }

  allGames() {
    return [...this.games.values()].map(gameSummary);
  }

  messages(gameId: string) {
    return this.required(gameId).messages.slice(-150);
  }

  join(game: GameState, session: Session) {
    addPlayer(game, { id: session.id, name: session.name, avatar: session.avatar });
    saveGame(game);
    return game;
  }

  addBot(gameId: string) {
    const game = this.required(gameId);
    addPlayer(game, { name: `Bot ${game.players.length + 1}`, isBot: true });
    saveGame(game);
    return game;
  }

  start(gameId: string, actorId: string) {
    const game = this.required(gameId);
    if (game.hostId !== actorId) throw new Error("Solo el anfitrión puede comenzar.");
    startGame(game);
    saveGame(game);
    return game;
  }

  action(gameId: string, actorId: string, action: GameAction) {
    const game = this.required(gameId);
    applyAction(game, actorId, action);
    saveGame(game);
    return game;
  }

  message(gameId: string, actorId: string, text: string) {
    const game = this.required(gameId);
    const player = game.players.find((item) => item.id === actorId);
    if (!player) throw new Error("Los espectadores no pueden escribir.");
    const clean = text.trim().slice(0, 400);
    if (!clean) return game;
    game.messages.push({
      id: crypto.randomUUID(),
      playerId: actorId,
      playerName: player.name,
      text: clean,
      createdAt: Date.now()
    });
    game.messages = game.messages.slice(-150);
    game.updatedAt = Date.now();
    saveGame(game);
    return game;
  }

  connect(gameId: string, playerId: string, connected: boolean) {
    const game = this.required(gameId);
    setConnection(game, playerId, connected);
    saveGame(game);
    return game;
  }

  close(gameId: string) {
    const game = this.required(gameId);
    game.status = "finished";
    game.phase = "finished";
    game.turnDeadline = null;
    game.winnerReason = "Partida cerrada por administración.";
    game.messages.push(systemMessage("La partida fue cerrada por administración."));
    saveGame(game);
    return game;
  }

  view(gameId: string, viewerId?: string) {
    return publicState(this.required(gameId), viewerId);
  }

  tick() {
    const changed: GameState[] = [];
    for (const game of this.games.values()) {
      if (game.status !== "playing") continue;
      const before = game.updatedAt;
      handleTimeout(game);
      const active = game.players[game.activePlayerIndex];
      if (active && (active.isBot || !active.connected) && Date.now() - game.updatedAt > 450) {
        runBotStep(game);
      }
      if (game.updatedAt !== before) {
        saveGame(game);
        changed.push(game);
      }
    }
    return changed;
  }

  private required(gameId: string) {
    const game = this.games.get(gameId);
    if (!game) throw new Error("Partida inexistente.");
    return game;
  }
}

export const store = new GameStore();
