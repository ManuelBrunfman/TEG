import { ADJACENCY, COLOR_HEX, COUNTRIES } from "@shared/map";
import { TERRITORY_SPRITES } from "@shared/territories";
import type { GameState } from "@shared/types";

interface Props {
  game: GameState;
  selected: number | null;
  onSelect: (countryId: number) => void;
  colorBlind: boolean;
}

const asset = (file: string) => `/map/teg/${file}`;

export function MapBoard({ game, selected, onSelect, colorBlind }: Props) {
  const selectedNeighbors = new Set(selected === null ? [] : ADJACENCY[selected] ?? []);

  return (
    <div className="map-scroll">
      <svg className="world-map" viewBox="0 0 860 520" role="img" aria-label="Mapa mundial de TEG">
        <defs>
          <filter id="army-shadow">
            <feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity=".6" />
          </filter>
          <filter id="territory-glow">
            <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#fff0a8" floodOpacity=".95" />
          </filter>
          {TERRITORY_SPRITES.map((sprite) => (
            <mask
              id={`territory-mask-${sprite.id}`}
              key={sprite.id}
              x={sprite.x}
              y={sprite.y}
              width={sprite.width}
              height={sprite.height}
              maskUnits="userSpaceOnUse"
              className="territory-mask"
            >
              <image
                href={asset(sprite.file)}
                x={sprite.x}
                y={sprite.y}
                width={sprite.width}
                height={sprite.height}
              />
            </mask>
          ))}
        </defs>

        <image href={asset("map.png")} x="0" y="0" width="860" height="520" className="teg-map-base" />

        {TERRITORY_SPRITES.map((sprite) => {
          const state = game.countries[sprite.id];
          if (!state) return null;
          const owner = game.players.find((player) => player.id === state.ownerId);
          const isSelected = selected === sprite.id;
          const isNeighbor = selectedNeighbors.has(sprite.id);
          return (
            <g
              key={sprite.id}
              className={`territory-piece ${isSelected ? "territory-piece--selected" : ""} ${isNeighbor ? "territory-piece--neighbor" : ""}`}
              role="button"
              tabIndex={0}
              aria-label={`${COUNTRIES[sprite.id].name}, ${state.armies} ejércitos`}
              onClick={() => onSelect(sprite.id)}
              onKeyDown={(event) => event.key === "Enter" && onSelect(sprite.id)}
            >
              <rect
                x={sprite.x}
                y={sprite.y}
                width={sprite.width}
                height={sprite.height}
                fill={owner ? COLOR_HEX[owner.color] : "#777"}
                mask={`url(#territory-mask-${sprite.id})`}
                className="territory-owner"
              />
              <image
                href={asset(sprite.file)}
                x={sprite.x}
                y={sprite.y}
                width={sprite.width}
                height={sprite.height}
                className="territory-hit"
              />
            </g>
          );
        })}

        <image href={asset("map.png")} x="0" y="0" width="860" height="520" className="teg-map-detail" />

        {TERRITORY_SPRITES.map((sprite) => {
          const state = game.countries[sprite.id];
          if (!state) return null;
          const owner = game.players.find((player) => player.id === state.ownerId);
          return (
            <g
              key={`army-${sprite.id}`}
              className={`army-marker ${selected === sprite.id ? "army-marker--selected" : ""}`}
              onClick={() => onSelect(sprite.id)}
              role="button"
              aria-label={`${COUNTRIES[sprite.id].name}, ${state.armies} ejércitos`}
            >
              <circle
                cx={sprite.markerX}
                cy={sprite.markerY}
                r="11"
                fill={owner ? COLOR_HEX[owner.color] : "#777"}
                filter="url(#army-shadow)"
              />
              {colorBlind && (
                <text x={sprite.markerX} y={sprite.markerY - 4} textAnchor="middle" className="army-color-letter">
                  {owner?.color.slice(0, 1).toUpperCase()}
                </text>
              )}
              <text
                x={sprite.markerX}
                y={sprite.markerY + (colorBlind ? 6 : 4)}
                textAnchor="middle"
                className={`country-army ${colorBlind ? "country-army--small" : ""}`}
              >
                {state.armies}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
