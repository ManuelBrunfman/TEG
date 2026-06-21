import type { ContinentId, GameState, PlayerState } from "./types.js";
import { ADJACENCY, COUNTRIES } from "./map.js";

export interface MissionDefinition {
  id: string;
  text: string;
  continents?: Partial<Record<ContinentId, number>>;
  adjacent?: number;
  destroyColor?: PlayerState["color"];
}

export const OCCUPATION_MISSIONS: MissionDefinition[] = [
  {
    id: "africa-na5-eu4",
    text: "Ocupar África, 5 territorios de América del Norte y 4 de Europa.",
    continents: { africa: 6, "america-norte": 5, europa: 4 }
  },
  {
    id: "sa-eu7-adj3",
    text: "Ocupar América del Sur, 7 territorios de Europa y 3 territorios limítrofes entre sí.",
    continents: { "america-sur": 6, europa: 7 },
    adjacent: 3
  },
  {
    id: "asia-sa2",
    text: "Ocupar Asia y 2 territorios de América del Sur.",
    continents: { asia: 15, "america-sur": 2 }
  },
  {
    id: "europa-asia4-sa2",
    text: "Ocupar Europa, 4 territorios de Asia y 2 de América del Sur.",
    continents: { europa: 9, asia: 4, "america-sur": 2 }
  },
  {
    id: "na-oceania2-asia4",
    text: "Ocupar América del Norte, 2 territorios de Oceanía y 4 de Asia.",
    continents: { "america-norte": 10, oceania: 2, asia: 4 }
  },
  {
    id: "receta",
    text: "Ocupar 2 territorios de Oceanía, África y América del Sur; 3 de Europa; 4 de América del Norte y 3 de Asia.",
    continents: { oceania: 2, africa: 2, "america-sur": 2, europa: 3, "america-norte": 4, asia: 3 }
  },
  {
    id: "oceania-na-eu2",
    text: "Ocupar Oceanía, América del Norte y 2 territorios de Europa.",
    continents: { oceania: 4, "america-norte": 10, europa: 2 }
  },
  {
    id: "sa-africa-na5",
    text: "Ocupar América del Sur, África y 5 territorios de América del Norte.",
    continents: { "america-sur": 6, africa: 6, "america-norte": 5 }
  }
];

export const missionText = (missionId: string) => {
  if (missionId === "world") return "Conquistar los 50 territorios.";
  if (missionId.startsWith("destroy:")) {
    return `Destruir al ejército ${missionId.split(":")[1]}; si no fuera posible, eliminar al jugador de la derecha.`;
  }
  return OCCUPATION_MISSIONS.find((mission) => mission.id === missionId)?.text ?? "Ocupar 30 territorios.";
};

export function occupationMissionCompleted(state: GameState, player: PlayerState): boolean {
  if (state.players.length <= 3) return state.countries.every((country) => country.ownerId === player.id);
  const owned = state.countries.filter((country) => country.ownerId === player.id);
  if (owned.length >= 30) return true;
  const mission = OCCUPATION_MISSIONS.find((item) => item.id === player.missionId);
  if (!mission?.continents) return false;
  for (const [continent, required] of Object.entries(mission.continents)) {
    const count = owned.filter((country) => COUNTRIES[country.id].continent === continent).length;
    if (count < (required ?? 0)) return false;
  }
  if (mission.adjacent) {
    const ownedIds = new Set(owned.map((country) => country.id));
    const seek = (countryId: number, visited: Set<number>): boolean => {
      if (visited.size >= mission.adjacent!) return true;
      return (ADJACENCY[countryId] ?? [])
        .filter((neighbor) => ownedIds.has(neighbor) && !visited.has(neighbor))
        .some((neighbor) => seek(neighbor, new Set([...visited, neighbor])));
    };
    const hasChain = owned.some((country) => seek(country.id, new Set([country.id])));
    if (!hasChain) return false;
  }
  return true;
}
