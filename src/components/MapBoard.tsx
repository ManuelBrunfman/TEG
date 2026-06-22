import { type TouchEvent, useEffect, useRef, useState } from "react";
import { ADJACENCY, COLOR_HEX, COUNTRIES } from "@shared/map";
import { TERRITORY_SPRITES } from "@shared/territories";
import type { GameState } from "@shared/types";

interface Props {
  game: GameState;
  selected: number | null;
  onSelect: (countryId: number) => void;
  colorBlind: boolean;
  showCountryNames: boolean;
}

const asset = (file: string) => `/map/teg/${file}`;
const armyRadius = (armies: number) => {
  if (armies <= 2) return 7;
  if (armies <= 4) return 8;
  if (armies <= 6) return 9;
  if (armies <= 8) return 10;
  return 11;
};

export function MapBoard({ game, selected, onSelect, colorBlind, showCountryNames }: Props) {
  const selectedNeighbors = new Set(selected === null ? [] : ADJACENCY[selected] ?? []);
  const viewportRef = useRef<HTMLDivElement>(null);
  const centerRef = useRef({ x: 0.5, y: 0.5 });
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  const [viewport, setViewport] = useState({ width: 860, height: 520 });
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const resize = () => setViewport({ width: element.clientWidth, height: element.clientHeight });
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    requestAnimationFrame(() => {
      element.scrollLeft = centerRef.current.x * element.scrollWidth - element.clientWidth / 2;
      element.scrollTop = centerRef.current.y * element.scrollHeight - element.clientHeight / 2;
    });
  }, [zoom, viewport]);

  const fitScale = Math.max(0.1, Math.min((viewport.width - 32) / 860, (viewport.height - 32) / 520));
  const mapWidth = 860 * fitScale * zoom;
  const mapHeight = 520 * fitScale * zoom;
  const stageWidth = Math.max(viewport.width, mapWidth + 32);
  const stageHeight = Math.max(viewport.height, mapHeight + 32);

  const setMapZoom = (next: number) => {
    const element = viewportRef.current;
    if (element) {
      centerRef.current = {
        x: (element.scrollLeft + element.clientWidth / 2) / Math.max(1, element.scrollWidth),
        y: (element.scrollTop + element.clientHeight / 2) / Math.max(1, element.scrollHeight)
      };
    }
    setZoom(Math.max(1, Math.min(3, next)));
  };

  const touchDistance = (event: TouchEvent<HTMLDivElement>) => {
    const first = event.touches[0];
    const second = event.touches[1];
    return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
  };

  const beginPinch = (event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 2) pinchRef.current = { distance: touchDistance(event), zoom };
  };

  const movePinch = (event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2 || !pinchRef.current) return;
    event.preventDefault();
    setMapZoom(pinchRef.current.zoom * (touchDistance(event) / pinchRef.current.distance));
  };

  return (
    <div className="map-shell">
      <div
        className="map-scroll"
        ref={viewportRef}
        onTouchStart={beginPinch}
        onTouchMove={movePinch}
        onTouchEnd={(event) => {
          if (event.touches.length < 2) pinchRef.current = null;
        }}
        onDoubleClick={() => setMapZoom(zoom === 1 ? 2 : 1)}
      >
        <div className="map-stage" style={{ width: stageWidth, height: stageHeight }}>
      <svg
        className="world-map"
        viewBox="0 0 860 520"
        role="img"
        aria-label="Mapa mundial de TEG"
        style={{ width: mapWidth, height: mapHeight }}
      >
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
                r={armyRadius(state.armies)}
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
                y={sprite.markerY + (colorBlind ? 5 : 3.5)}
                textAnchor="middle"
                className={`country-army ${colorBlind || state.armies < 10 ? "country-army--small" : ""}`}
              >
                {state.armies}
              </text>
              {showCountryNames && (
                <text
                  x={sprite.markerX}
                  y={sprite.markerY - armyRadius(state.armies) - 5}
                  textAnchor="middle"
                  className="country-name"
                >
                  {COUNTRIES[sprite.id].name}
                </text>
              )}
            </g>
          );
        })}
      </svg>
        </div>
      </div>
    </div>
  );
}
