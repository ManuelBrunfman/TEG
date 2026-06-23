import { nanoid } from "nanoid";
import { ADJACENCY, COLOR_HEX, CONTINENTS, COUNTRIES, PLAYER_COLORS, areAdjacent } from "./map.js";
import { OCCUPATION_MISSIONS, missionText, occupationMissionCompleted } from "./missions.js";
import type {
  CardSymbol,
  ContinentId,
  CountryCard,
  GameAction,
  GameSettings,
  GameState,
  Pact,
  PlayerState,
  Session
} from "./types.js";

const avatars = ["⚔️", "🛡️", "🏰", "🐉", "🦅", "🦁"];

const randomCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const shuffle = <T>(items: T[]) => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

export function createGame(params: {
  id?: string;
  name: string;
  host: Session;
  settings: GameSettings;
}): GameState {
  const now = Date.now();
  return {
    id: params.id ?? nanoid(),
    code: randomCode(),
    name: params.name.trim() || "Mesa del reino",
    status: "lobby",
    settings: params.settings,
    hostId: params.host.id,
    players: [
      {
        id: params.host.id,
        name: params.host.name,
        color: PLAYER_COLORS[0],
        avatar: params.host.avatar || avatars[0],
        isBot: false,
        connected: true,
        eliminated: false,
        cards: [],
        missionId: "",
        exchanges: 0,
        countriesConqueredThisTurn: 0
      }
    ],
    countries: [],
    activePlayerIndex: 0,
    roundStarterIndex: 0,
    roundStage: "combat",
    phase: "setup-5",
    setupRound: 0,
    reinforcements: 0,
    baseReinforcements: 0,
    continentReinforcements: {},
    placementHistory: [],
    turnDeadline: null,
    round: 0,
    deck: [],
    discard: [],
    exchangeValue: 4,
    lastBattle: null,
    pendingConquest: null,
    winnerId: null,
    winnerReason: null,
    messages: [],
    pacts: [],
    paused: false,
    pauseVotes: [],
    pausedRemainingMs: null,
    regroupLocked: {},
    createdAt: now,
    updatedAt: now
  };
}

export function addPlayer(
  state: GameState,
  input: { id?: string; name: string; avatar?: string; isBot?: boolean }
): GameState {
  if (input.id && state.players.some((player) => player.id === input.id)) return state;
  if (state.status !== "lobby") throw new Error("La partida ya comenzó.");
  if (state.players.length >= state.settings.maxPlayers) throw new Error("La mesa está completa.");
  const color = PLAYER_COLORS[state.players.length];
  state.players.push({
    id: input.id ?? `bot-${nanoid(8)}`,
    name: input.name.trim() || `Bot ${state.players.length + 1}`,
    color,
    avatar: input.avatar || avatars[state.players.length],
    isBot: input.isBot ?? false,
    connected: input.isBot ?? true,
    eliminated: false,
    cards: [],
    missionId: "",
    exchanges: 0,
    countriesConqueredThisTurn: 0
  });
  state.updatedAt = Date.now();
  return state;
}

export function removePlayer(state: GameState, playerId: string): GameState {
  if (state.status !== "lobby") throw new Error("No se puede abandonar una partida comenzada.");
  if (playerId === state.hostId) throw new Error("El anfitrión no puede retirarse sin cerrar la mesa.");
  state.players = state.players.filter((player) => player.id !== playerId);
  state.players.forEach((player, index) => {
    player.color = PLAYER_COLORS[index];
  });
  state.updatedAt = Date.now();
  return state;
}

function buildMissions(players: PlayerState[]): string[] {
  if (players.length <= 3) return players.map(() => "world");
  const occupation = shuffle(OCCUPATION_MISSIONS.map((mission) => mission.id));
  return players.map((player, index) => {
    if (index < Math.min(occupation.length, Math.ceil(players.length / 2))) return occupation[index];
    const possibleTargets = players.filter((candidate) => candidate.id !== player.id);
    const target = possibleTargets[index % possibleTargets.length];
    return `destroy:${target.color}`;
  });
}

export function startGame(state: GameState): GameState {
  if (state.status !== "lobby") throw new Error("La partida ya comenzó.");
  if (state.players.length < 2) throw new Error("Se necesitan al menos 2 jugadores.");
  while (state.players.length < state.settings.maxPlayers) {
    addPlayer(state, { name: `Bot ${state.players.length + 1}`, isBot: true });
  }

  const playerOrder = shuffle(state.players);
  state.players = playerOrder;
  state.hostId = state.players.some((player) => player.id === state.hostId) ? state.hostId : state.players[0].id;
  const territories = shuffle(COUNTRIES.map((country) => country.id));
  state.countries = territories
    .map((id, index) => ({
      id,
      ownerId: state.players[index % state.players.length].id,
      armies: 1
    }))
    .sort((a, b) => a.id - b.id);
  state.deck = shuffle(
    COUNTRIES.map((country) => ({
      countryId: country.id,
      symbol: country.symbol,
      used: false
    }))
  );
  const missions = buildMissions(state.players);
  state.players.forEach((player, index) => {
    player.missionId = missions[index];
  });
  state.status = "playing";
  state.phase = "setup-5";
  state.setupRound = 0;
  state.activePlayerIndex = 0;
  state.roundStarterIndex = 0;
  state.roundStage = "combat";
  state.reinforcements = 5;
  state.baseReinforcements = 5;
  state.continentReinforcements = {};
  state.placementHistory = [];
  state.pendingConquest = null;
  state.turnDeadline = Date.now() + state.settings.turnSeconds * 1000;
  state.messages.push(systemMessage("La campaña comenzó. Cada reino dispone sus primeros 5 ejércitos."));
  state.updatedAt = Date.now();
  return state;
}

const activePlayer = (state: GameState) => state.players[state.activePlayerIndex];
const ownedCountries = (state: GameState, playerId: string) =>
  state.countries.filter((country) => country.ownerId === playerId);

function continentReinforcementPlan(state: GameState, playerId: string) {
  return Object.entries(CONTINENTS).reduce<Partial<Record<ContinentId, number>>>((plan, [continentId, continent]) => {
    const all = COUNTRIES.filter((country) => country.continent === continentId);
    const controlsAll = all.every((definition) => state.countries[definition.id].ownerId === playerId);
    if (controlsAll) plan[continentId as ContinentId] = continent.bonus;
    return plan;
  }, {});
}

function beginReinforcements(state: GameState, playerId: string) {
  const countryCount = ownedCountries(state, playerId).length;
  state.baseReinforcements = countryCount <= 6 ? 3 : Math.floor(countryCount / 2);
  state.continentReinforcements = continentReinforcementPlan(state, playerId);
  state.reinforcements =
    state.baseReinforcements +
    Object.values(state.continentReinforcements).reduce((total, value) => total + (value ?? 0), 0);
  state.placementHistory = [];
}

function resetDeadline(state: GameState) {
  state.turnDeadline = Date.now() + state.settings.turnSeconds * 1000;
}

function nextLivingIndex(state: GameState, fromIndex: number) {
  let index = fromIndex;
  do {
    index = (index + 1) % state.players.length;
  } while (state.players[index].eliminated && index !== fromIndex);
  return index;
}

function finishPlacement(state: GameState) {
  if (state.reinforcements > 0) return;
  if (state.phase === "reinforce") {
    const nextIndex = nextLivingIndex(state, state.activePlayerIndex);
    state.baseReinforcements = 0;
    state.continentReinforcements = {};
    state.placementHistory = [];
    if (nextIndex === state.roundStarterIndex) {
      state.activePlayerIndex = state.roundStarterIndex;
      state.roundStage = "combat";
      state.phase = "attack";
      state.messages.push(systemMessage("Todos los reinos terminaron sus refuerzos. Comienza la fase de ataques."));
    } else {
      state.activePlayerIndex = nextIndex;
      beginReinforcements(state, activePlayer(state).id);
    }
    resetDeadline(state);
    return;
  }
  const wasLast = nextLivingIndex(state, state.activePlayerIndex) <= state.activePlayerIndex;
  state.activePlayerIndex = nextLivingIndex(state, state.activePlayerIndex);
  if (wasLast && state.phase === "setup-5") {
    state.phase = "setup-3";
    state.setupRound = 1;
    state.reinforcements = 3;
    state.baseReinforcements = 3;
    state.continentReinforcements = {};
    state.placementHistory = [];
    state.messages.push(systemMessage("Comienza la segunda disposición: 3 ejércitos por reino."));
  } else if (wasLast && state.phase === "setup-3") {
    state.phase = "attack";
    state.setupRound = 2;
    state.round = 1;
    state.activePlayerIndex = 0;
    state.roundStarterIndex = 0;
    state.roundStage = "combat";
    state.reinforcements = 0;
    state.baseReinforcements = 0;
    state.continentReinforcements = {};
    state.placementHistory = [];
    state.messages.push(systemMessage("La guerra comienza. En la primera ronda se ataca sin recibir nuevos refuerzos."));
  } else {
    state.reinforcements = state.phase === "setup-5" ? 5 : 3;
    state.baseReinforcements = state.reinforcements;
    state.continentReinforcements = {};
    state.placementHistory = [];
  }
  resetDeadline(state);
}

function place(state: GameState, countryId: number, count: number, requestedSource?: "base" | ContinentId) {
  if (!["setup-5", "setup-3", "reinforce"].includes(state.phase)) {
    throw new Error("No es el momento de colocar ejércitos.");
  }
  if (!Number.isInteger(count) || count < 1 || count > state.reinforcements) {
    throw new Error("Cantidad de ejércitos inválida.");
  }
  const country = state.countries[countryId];
  if (!country || country.ownerId !== activePlayer(state).id) {
    throw new Error("Ese territorio no pertenece al jugador activo.");
  }
  const continentId = COUNTRIES[countryId].continent;
  const continentAvailable = state.continentReinforcements[continentId] ?? 0;
  const source = requestedSource ?? (state.baseReinforcements > 0 ? "base" : continentId);
  if (source === "base") {
    if (count > state.baseReinforcements) throw new Error("No hay suficientes ejércitos libres disponibles.");
    state.baseReinforcements -= count;
  } else {
    if (source !== continentId) throw new Error("Ese bonus solo puede colocarse dentro de su continente.");
    if (count > continentAvailable) throw new Error("No hay suficientes ejércitos de ese continente.");
    state.continentReinforcements[continentId] = continentAvailable - count;
  }
  country.armies += count;
  state.reinforcements -= count;
  state.placementHistory.push({ countryId, count, source });
  resetDeadline(state);
}

function undoPlacement(state: GameState) {
  if (!["setup-5", "setup-3", "reinforce"].includes(state.phase)) {
    throw new Error("No hay una colocación para deshacer.");
  }
  const last = state.placementHistory.pop();
  if (!last) throw new Error("Todavía no colocaste ejércitos en este turno.");
  const country = state.countries[last.countryId];
  if (!country || country.ownerId !== activePlayer(state).id || country.armies - last.count < 1) {
    state.placementHistory.push(last);
    throw new Error("Esa colocación ya no se puede deshacer.");
  }
  country.armies -= last.count;
  state.reinforcements += last.count;
  if (last.source === "base") state.baseReinforcements += last.count;
  else state.continentReinforcements[last.source] = (state.continentReinforcements[last.source] ?? 0) + last.count;
  resetDeadline(state);
}

function confirmPlacement(state: GameState) {
  if (!["setup-5", "setup-3", "reinforce"].includes(state.phase)) {
    throw new Error("No es el momento de confirmar refuerzos.");
  }
  if (state.reinforcements > 0) throw new Error("Primero debés ubicar todos los ejércitos.");
  finishPlacement(state);
}

function attackBlockedByPact(state: GameState, attackerId: string, defenderId: string, from: number, to: number) {
  return state.pacts.some((pact) => {
    if (!pact.active || !pact.playerIds.includes(attackerId) || !pact.playerIds.includes(defenderId)) return false;
    if (pact.kind === "global") return true;
    if (pact.kind === "border") return pact.countryIds.includes(from) && pact.countryIds.includes(to);
    return pact.kind === "international-zone" && pact.countryIds.includes(to);
  });
}

function rollDice(count: number) {
  return Array.from({ length: count }, () => 1 + Math.floor(Math.random() * 6)).sort((a, b) => b - a);
}

function exchangeReward(exchangeNumber: number) {
  return exchangeNumber === 0 ? 4 : exchangeNumber === 1 ? 7 : exchangeNumber === 2 ? 10 : 10 + (exchangeNumber - 2) * 5;
}

export function validExchange(cards: CountryCard[]) {
  if (cards.length !== 3) return false;
  if (cards.some((card) => card.symbol === "comodín")) return true;
  const symbols = new Set<CardSymbol>(cards.map((card) => card.symbol));
  return symbols.size === 1 || symbols.size === 3;
}

export function findValidExchangeCards(cards: CountryCard[]): CountryCard[] | null {
  for (let a = 0; a < cards.length - 2; a += 1) {
    for (let b = a + 1; b < cards.length - 1; b += 1) {
      for (let c = b + 1; c < cards.length; c += 1) {
        const candidate = [cards[a], cards[b], cards[c]];
        if (validExchange(candidate)) return candidate;
      }
    }
  }
  return null;
}

function consumeExchange(state: GameState, player: PlayerState, cards: CountryCard[]) {
  const ids = cards.map((card) => card.countryId);
  player.cards = player.cards.filter((card) => !ids.includes(card.countryId));
  state.discard.push(...cards);
  const value = exchangeReward(player.exchanges);
  player.exchanges += 1;
  return value;
}

function attack(state: GameState, fromId: number, toId: number, requestedDice?: number) {
  if (state.phase !== "attack") throw new Error("No es la fase de ataque.");
  if (!areAdjacent(fromId, toId)) throw new Error("Los territorios no son limítrofes.");
  const attacker = activePlayer(state);
  const from = state.countries[fromId];
  const to = state.countries[toId];
  if (!from || !to || from.ownerId !== attacker.id || to.ownerId === attacker.id) {
    throw new Error("El ataque no es válido.");
  }
  if (from.armies < 2) throw new Error("Necesitás al menos 2 ejércitos para atacar.");
  if (attackBlockedByPact(state, attacker.id, to.ownerId, fromId, toId)) {
    throw new Error("Un pacto activo impide este ataque.");
  }

  const defenderPlayer = state.players.find((player) => player.id === to.ownerId)!;
  const attackerCount = Math.min(3, from.armies - 1, requestedDice ?? 3);
  const defenderCount = Math.min(3, to.armies);
  const attackerDice = rollDice(attackerCount);
  const defenderDice = rollDice(defenderCount);
  let attackerLosses = 0;
  let defenderLosses = 0;
  for (let index = 0; index < Math.min(attackerDice.length, defenderDice.length); index += 1) {
    if (attackerDice[index] > defenderDice[index]) defenderLosses += 1;
    else attackerLosses += 1;
  }
  from.armies -= attackerLosses;
  to.armies -= defenderLosses;
  let conquered = false;
  if (to.armies <= 0) {
    conquered = true;
    const priorOwnerId = to.ownerId;
    const maximum = Math.max(1, Math.min(3, from.armies - 1));
    const moved = 1;
    to.ownerId = attacker.id;
    to.armies = moved;
    from.armies -= moved;
    attacker.countriesConqueredThisTurn += 1;
    state.pendingConquest = { from: fromId, to: toId, minimum: 1, maximum, moved };
    state.phase = "occupy";

    if (ownedCountries(state, priorOwnerId).length === 0) {
      defenderPlayer.eliminated = true;
      attacker.cards.push(...defenderPlayer.cards);
      defenderPlayer.cards = [];
      state.messages.push(systemMessage(`${attacker.name} eliminó al reino de ${defenderPlayer.name}.`));
      if (attacker.missionId === `destroy:${defenderPlayer.color}`) {
        finishGame(state, attacker.id, `Cumplió su objetivo: destruir al ejército ${defenderPlayer.color}.`);
      }
      state.players.forEach((player, index) => {
        if (player.id === attacker.id || player.eliminated || player.missionId !== `destroy:${defenderPlayer.color}`) return;
        player.missionId = "common-30";
      });
      if (state.players[state.roundStarterIndex]?.eliminated) {
        state.roundStarterIndex = nextLivingIndex(state, state.roundStarterIndex);
      }
    }
  }
  state.lastBattle = {
    id: nanoid(10),
    from: fromId,
    to: toId,
    attackerDice,
    defenderDice,
    attackerLosses,
    defenderLosses,
    conquered
  };
  if (state.status !== "finished" && occupationMissionCompleted(state, attacker)) {
    const reason = state.players.length <= 3
      ? "Conquistó los 50 territorios."
      : ownedCountries(state, attacker.id).length >= 30
        ? "Ocupó 30 territorios."
        : missionText(attacker.missionId);
    finishGame(state, attacker.id, reason);
  }
  resetDeadline(state);
}

function occupy(state: GameState, count: number) {
  if (state.phase !== "occupy" || !state.pendingConquest) {
    throw new Error("No hay un territorio pendiente de ocupación.");
  }
  const pending = state.pendingConquest;
  if (!Number.isInteger(count) || count < pending.minimum || count > pending.maximum) {
    throw new Error(`Debés mover entre ${pending.minimum} y ${pending.maximum} ejércitos.`);
  }
  const additional = count - pending.moved;
  const from = state.countries[pending.from];
  const to = state.countries[pending.to];
  if (additional > from.armies - 1) throw new Error("Debe quedar al menos un ejército en el territorio atacante.");
  from.armies -= additional;
  to.armies += additional;
  state.pendingConquest = null;
  state.phase = "attack";
  resetDeadline(state);
}

function claimOwnedCardBonuses(state: GameState, player: PlayerState) {
  for (const card of player.cards) {
    if (card.used || state.countries[card.countryId].ownerId !== player.id) continue;
    state.countries[card.countryId].armies += 2;
    card.used = true;
    state.messages.push(systemMessage(`${player.name} utilizó la tarjeta de ${COUNTRIES[card.countryId].name} y sumó 2 ejércitos allí.`));
  }
}

function awardCard(state: GameState, player: PlayerState) {
  const requiredConquests = player.exchanges >= 3 ? 2 : 1;
  if (player.countriesConqueredThisTurn < requiredConquests) return;
  if (player.cards.length >= 5) {
    state.messages.push(systemMessage(`${player.name} no recibió tarjeta porque ya posee el máximo de 5.`));
    return;
  }
  if (state.deck.length === 0) {
    state.deck = shuffle(state.discard.map((card) => ({ ...card, used: false })));
    state.discard = [];
  }
  const card = state.deck.pop();
  if (!card) return;
  card.used = false;
  player.cards.push(card);
  const cardCountry = state.countries[card.countryId];
  if (cardCountry.ownerId === player.id) {
    cardCountry.armies += 2;
    card.used = true;
    state.messages.push(systemMessage(`${player.name} recibió ${COUNTRIES[card.countryId].name} y sumó 2 ejércitos allí.`));
  }
}

function beginNextCombatTurn(state: GameState) {
  const oldIndex = state.activePlayerIndex;
  const nextIndex = nextLivingIndex(state, oldIndex);
  if (nextIndex === state.roundStarterIndex) {
    state.roundStarterIndex = nextLivingIndex(state, state.roundStarterIndex);
    state.activePlayerIndex = state.roundStarterIndex;
    state.round += 1;
    state.roundStage = "reinforce";
    state.phase = "reinforce";
    beginReinforcements(state, activePlayer(state).id);
    state.messages.push(systemMessage(`Comienza la ronda ${state.round}. Todos los reinos deben colocar sus refuerzos.`));
  } else {
    state.activePlayerIndex = nextIndex;
    state.phase = "attack";
  }
  const player = activePlayer(state);
  player.countriesConqueredThisTurn = 0;
  state.lastBattle = null;
  state.pendingConquest = null;
  state.regroupLocked = {};
  resetDeadline(state);
}

function endTurn(state: GameState) {
  if (!["attack", "regroup"].includes(state.phase)) throw new Error("No se puede finalizar ahora.");
  const player = activePlayer(state);
  claimOwnedCardBonuses(state, player);
  awardCard(state, player);
  beginNextCombatTurn(state);
}

function regroup(state: GameState, fromId: number, toId: number, count: number) {
  if (state.phase !== "regroup") throw new Error("No es la fase de reagrupamiento.");
  if (!areAdjacent(fromId, toId)) throw new Error("Los territorios no son limítrofes.");
  const player = activePlayer(state);
  const from = state.countries[fromId];
  const to = state.countries[toId];
  if (from.ownerId !== player.id || to.ownerId !== player.id) throw new Error("Ambos territorios deben ser propios.");
  const movable = from.armies - 1 - (state.regroupLocked[fromId] ?? 0);
  if (!Number.isInteger(count) || count < 1 || count > movable) throw new Error("Cantidad inválida.");
  from.armies -= count;
  to.armies += count;
  state.regroupLocked[toId] = (state.regroupLocked[toId] ?? 0) + count;
  resetDeadline(state);
}

function exchange(state: GameState, ids: number[]) {
  if (state.phase !== "reinforce") throw new Error("El canje se realiza durante la fase de refuerzos.");
  const player = activePlayer(state);
  if (ids.length !== 3 || new Set(ids).size !== 3) throw new Error("Debés elegir tres tarjetas diferentes.");
  const cards = ids.map((id) => player.cards.find((card) => card.countryId === id)).filter(Boolean) as CountryCard[];
  if (!validExchange(cards)) throw new Error("La combinación de tarjetas no es válida.");
  const value = consumeExchange(state, player, cards);
  state.reinforcements += value;
  state.baseReinforcements += value;
  state.messages.push(systemMessage(`${player.name} realizó un canje por ${value} ejércitos.`));
  resetDeadline(state);
}

function proposePact(state: GameState, playerIds: string[], countryIds: number[], kind: Pact["kind"]) {
  const proposer = activePlayer(state);
  const uniquePlayers = [...new Set([proposer.id, ...playerIds])];
  if (uniquePlayers.length < 2) throw new Error("El pacto necesita al menos dos reinos.");
  state.pacts.push({
    id: nanoid(8),
    kind,
    proposerId: proposer.id,
    playerIds: uniquePlayers,
    countryIds: [...new Set(countryIds)],
    acceptedBy: [proposer.id],
    active: false
  });
}

function acceptPact(state: GameState, playerId: string, pactId: string) {
  const pact = state.pacts.find((item) => item.id === pactId);
  if (!pact || !pact.playerIds.includes(playerId)) throw new Error("Pacto inválido.");
  if (!pact.acceptedBy.includes(playerId)) pact.acceptedBy.push(playerId);
  pact.active = pact.playerIds.every((id) => pact.acceptedBy.includes(id));
  if (pact.active) state.messages.push(systemMessage("Un nuevo pacto entró en vigencia."));
}

function votePause(state: GameState, playerId: string) {
  if (state.settings.visibility === "public") throw new Error("Las partidas públicas no se pueden pausar.");
  if (state.paused) return;
  if (!state.pauseVotes.includes(playerId)) state.pauseVotes.push(playerId);
  const required = state.players.filter((player) => !player.isBot && !player.eliminated).map((player) => player.id);
  if (required.every((id) => state.pauseVotes.includes(id))) {
    state.paused = true;
    state.pausedRemainingMs = Math.max(1000, (state.turnDeadline ?? Date.now()) - Date.now());
    state.turnDeadline = null;
    state.messages.push(systemMessage("La campaña quedó pausada por acuerdo unánime."));
  }
}

function resumeGame(state: GameState) {
  if (!state.paused) return;
  state.paused = false;
  state.pauseVotes = [];
  state.turnDeadline = Date.now() + (state.pausedRemainingMs ?? state.settings.turnSeconds * 1000);
  state.pausedRemainingMs = null;
  state.messages.push(systemMessage("La campaña fue reanudada."));
}

function finishGame(state: GameState, winnerId: string, reason: string) {
  state.status = "finished";
  state.phase = "finished";
  state.winnerId = winnerId;
  state.winnerReason = reason;
  state.turnDeadline = null;
  const winner = state.players.find((player) => player.id === winnerId);
  state.messages.push(systemMessage(`${winner?.name ?? "Un reino"} ganó la partida.`));
}

export function applyAction(state: GameState, actorId: string, action: GameAction): GameState {
  if (state.status !== "playing") throw new Error("La partida no está en curso.");
  const actor = state.players.find((player) => player.id === actorId);
  if (!actor) throw new Error("No pertenecés a esta partida.");
  if (state.paused && action.type !== "resume") throw new Error("La partida está pausada.");
  if (!["accept-pact", "vote-pause", "resume"].includes(action.type) && activePlayer(state).id !== actorId) {
    throw new Error("No es tu turno.");
  }
  switch (action.type) {
    case "place":
      place(state, action.countryId, action.count, action.source);
      break;
    case "undo-place":
      undoPlacement(state);
      break;
    case "confirm-placement":
      confirmPlacement(state);
      break;
    case "attack":
      attack(state, action.from, action.to, action.dice);
      break;
    case "occupy":
      occupy(state, action.count);
      break;
    case "end-attack":
      if (state.phase !== "attack") throw new Error("No es la fase de ataque.");
      state.phase = "regroup";
      state.lastBattle = null;
      state.regroupLocked = {};
      resetDeadline(state);
      break;
    case "regroup":
      regroup(state, action.from, action.to, action.count);
      break;
    case "end-turn":
      endTurn(state);
      break;
    case "exchange":
      exchange(state, action.cardCountryIds);
      break;
    case "propose-pact":
      proposePact(state, action.playerIds, action.countryIds, action.kind);
      break;
    case "accept-pact":
      acceptPact(state, actorId, action.pactId);
      break;
    case "vote-pause":
      votePause(state, actorId);
      break;
    case "resume":
      resumeGame(state);
      break;
  }
  state.updatedAt = Date.now();
  return state;
}

export function handleTimeout(state: GameState): GameState {
  if (state.status !== "playing" || state.paused || !state.turnDeadline || Date.now() < state.turnDeadline) return state;
  const player = activePlayer(state);
  if (["setup-5", "setup-3", "reinforce"].includes(state.phase)) {
    const options = ownedCountries(state, player.id);
    while (state.reinforcements > 0 && options.length > 0) {
      const requiredContinent = Object.entries(state.continentReinforcements)
        .find(([, value]) => (value ?? 0) > 0)?.[0] as ContinentId | undefined;
      const choices = requiredContinent
        ? options.filter((country) => COUNTRIES[country.id].continent === requiredContinent)
        : options;
      const country = choices[Math.floor(Math.random() * choices.length)];
      place(state, country.id, 1, requiredContinent ?? "base");
      if (activePlayer(state).id !== player.id) break;
    }
    if (activePlayer(state).id === player.id && state.reinforcements === 0) confirmPlacement(state);
  } else if (state.phase === "occupy") {
    occupy(state, state.pendingConquest?.minimum ?? 1);
  } else if (state.phase === "attack") {
    state.phase = "regroup";
    endTurn(state);
  } else if (state.phase === "regroup") {
    endTurn(state);
  }
  state.messages.push(systemMessage(`El reloj de ${player.name} se agotó.`));
  state.updatedAt = Date.now();
  return state;
}

export function runBotStep(state: GameState): GameState {
  if (state.status !== "playing" || state.paused) return state;
  const player = activePlayer(state);
  if (!player.isBot && player.connected) return state;

  if (["setup-5", "setup-3", "reinforce"].includes(state.phase)) {
    if (state.reinforcements === 0) {
      return applyAction(state, player.id, { type: "confirm-placement" });
    }
    if (player.isBot && state.phase === "reinforce") {
      const exchangeCards = findValidExchangeCards(player.cards);
      if (exchangeCards) {
        return applyAction(state, player.id, {
          type: "exchange",
          cardCountryIds: exchangeCards.map((card) => card.countryId)
        });
      }
    }
    const owned = ownedCountries(state, player.id);
    const requiredContinent = Object.entries(state.continentReinforcements)
      .find(([, value]) => (value ?? 0) > 0)?.[0] as ContinentId | undefined;
    const eligible = requiredContinent
      ? owned.filter((country) => COUNTRIES[country.id].continent === requiredContinent)
      : owned;
    if (!player.isBot) {
      const randomCountry = eligible[Math.floor(Math.random() * eligible.length)];
      return applyAction(state, player.id, {
        type: "place",
        countryId: randomCountry.id,
        count: 1,
        source: requiredContinent ?? "base"
      });
    }
    const border = eligible.filter((country) =>
      (ADJACENCY[country.id] ?? []).some((neighbor) => state.countries[neighbor].ownerId !== player.id)
    );
    const choices = border.length ? border : eligible;
    const weakest = [...choices].sort((a, b) => a.armies - b.armies)[0];
    const continentAvailable = state.continentReinforcements[COUNTRIES[weakest.id].continent] ?? 0;
    const count = requiredContinent ? continentAvailable : state.baseReinforcements;
    return applyAction(state, player.id, {
      type: "place",
      countryId: weakest.id,
      count: Math.max(1, count),
      source: requiredContinent ?? "base"
    });
  }
  if (state.phase === "occupy") {
    return applyAction(state, player.id, {
      type: "occupy",
      count: player.isBot ? state.pendingConquest?.maximum ?? 1 : state.pendingConquest?.minimum ?? 1
    });
  }
  if (state.phase === "attack") {
    if (!player.isBot) return applyAction(state, player.id, { type: "end-attack" });
    const possible = ownedCountries(state, player.id)
      .flatMap((from) =>
        (ADJACENCY[from.id] ?? []).map((toId) => ({ from, to: state.countries[toId] }))
      )
      .filter(({ from, to }) => to.ownerId !== player.id && from.armies > to.armies + 1)
      .sort((a, b) => b.from.armies - a.from.armies);
    if (possible.length) {
      const choice = possible[0];
      return applyAction(state, player.id, { type: "attack", from: choice.from.id, to: choice.to.id });
    }
    return applyAction(state, player.id, { type: "end-attack" });
  }
  if (state.phase === "regroup") return applyAction(state, player.id, { type: "end-turn" });
  return state;
}

export function setConnection(state: GameState, playerId: string, connected: boolean) {
  const player = state.players.find((item) => item.id === playerId);
  if (player && !player.isBot) player.connected = connected;
  state.updatedAt = Date.now();
}

export function systemMessage(text: string) {
  return {
    id: nanoid(10),
    playerId: "system",
    playerName: "Heraldo",
    text,
    createdAt: Date.now(),
    system: true
  };
}

export function publicState(state: GameState, viewerId?: string): GameState {
  const copy = structuredClone(state);
  copy.players.forEach((player) => {
    if (player.id !== viewerId) {
      player.cards = [];
      player.missionId = "hidden";
    }
  });
  copy.deck = [];
  copy.discard = [];
  return copy;
}

export function gameSummary(state: GameState) {
  return {
    id: state.id,
    code: state.code,
    name: state.name,
    players: state.players.length,
    maxPlayers: state.settings.maxPlayers,
    status: state.status,
    turnSeconds: state.settings.turnSeconds
  };
}

export { COLOR_HEX };
