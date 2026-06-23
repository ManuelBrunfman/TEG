export type Visibility = "public" | "private" | "local";
export type GameStatus = "lobby" | "playing" | "finished";
export type Phase = "setup-5" | "setup-3" | "reinforce" | "attack" | "occupy" | "regroup" | "finished";
export type CardSymbol = "cañón" | "galeón" | "globo" | "comodín";
export type PlayerColor = "azul" | "rojo" | "negro" | "amarillo" | "verde" | "magenta";
export type ContinentId = "america-sur" | "america-norte" | "africa" | "oceania" | "europa" | "asia";

export interface CountryDefinition {
  id: number;
  name: string;
  continent: ContinentId;
  symbol: CardSymbol;
  x: number;
  y: number;
}

export interface CountryState {
  id: number;
  ownerId: string;
  armies: number;
}

export interface CountryCard {
  countryId: number;
  symbol: CardSymbol;
  used: boolean;
}

export interface PlayerState {
  id: string;
  name: string;
  color: PlayerColor;
  avatar: string;
  isBot: boolean;
  connected: boolean;
  eliminated: boolean;
  cards: CountryCard[];
  missionId: string;
  exchanges: number;
  countriesConqueredThisTurn: number;
}

export interface BattleResult {
  id: string;
  from: number;
  to: number;
  attackerDice: number[];
  defenderDice: number[];
  attackerLosses: number;
  defenderLosses: number;
  conquered: boolean;
}

export interface PendingConquest {
  from: number;
  to: number;
  minimum: number;
  maximum: number;
  moved: number;
}

export interface PlacementRecord {
  countryId: number;
  count: number;
  source: "base" | ContinentId;
}

export interface Pact {
  id: string;
  kind: "border" | "global" | "international-zone";
  proposerId: string;
  playerIds: string[];
  countryIds: number[];
  acceptedBy: string[];
  active: boolean;
}

export interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  text: string;
  createdAt: number;
  system?: boolean;
}

export interface GameSettings {
  visibility: Visibility;
  maxPlayers: number;
  turnSeconds: number;
  spectators: boolean;
  defensiveExchange: boolean;
}

export interface GameState {
  id: string;
  code: string;
  name: string;
  status: GameStatus;
  settings: GameSettings;
  hostId: string;
  players: PlayerState[];
  countries: CountryState[];
  activePlayerIndex: number;
  roundStarterIndex: number;
  roundStage: "reinforce" | "combat";
  phase: Phase;
  setupRound: number;
  reinforcements: number;
  baseReinforcements: number;
  continentReinforcements: Partial<Record<ContinentId, number>>;
  placementHistory: PlacementRecord[];
  turnDeadline: number | null;
  round: number;
  deck: CountryCard[];
  discard: CountryCard[];
  exchangeValue: number;
  lastBattle: BattleResult | null;
  pendingConquest: PendingConquest | null;
  winnerId: string | null;
  winnerReason: string | null;
  messages: ChatMessage[];
  pacts: Pact[];
  paused: boolean;
  pauseVotes: string[];
  pausedRemainingMs: number | null;
  regroupLocked: Record<number, number>;
  createdAt: number;
  updatedAt: number;
}

export interface PublicGameSummary {
  id: string;
  code: string;
  name: string;
  players: number;
  maxPlayers: number;
  status: GameStatus;
  turnSeconds: number;
}

export type GameAction =
  | { type: "place"; countryId: number; count: number; source?: "base" | ContinentId }
  | { type: "undo-place" }
  | { type: "confirm-placement" }
  | { type: "attack"; from: number; to: number; dice?: number }
  | { type: "occupy"; count: number }
  | { type: "end-attack" }
  | { type: "regroup"; from: number; to: number; count: number }
  | { type: "end-turn" }
  | { type: "exchange"; cardCountryIds: number[] }
  | { type: "propose-pact"; kind: Pact["kind"]; playerIds: string[]; countryIds: number[] }
  | { type: "accept-pact"; pactId: string }
  | { type: "vote-pause" }
  | { type: "resume" };

export interface Session {
  id: string;
  name: string;
  avatar: string;
  registered: boolean;
  admin: boolean;
}
