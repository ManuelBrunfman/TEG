import { type PointerEvent, useEffect, useRef, useState } from "react";
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

const asset = (file: string) => `${import.meta.env.BASE_URL}map/teg/${file}`;
const armyRadius = (armies: number) => armies >= 100 ? 14 : armies >= 10 ? 12 : 10;
const colorLabels = { azul: "AZ", amarillo: "AM", rojo: "R", negro: "N", verde: "V", magenta: "M" };

export function MapBoard({ game, selected, onSelect, colorBlind, showCountryNames }: Props) {
  const selectedNeighbors = new Set(selected === null ? [] : ADJACENCY[selected] ?? []);
  const viewportRef = useRef<HTMLDivElement>(null);
  const centerRef = useRef({ x: 0.5, y: 0.5 });
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  const [viewport, setViewport] = useState({ width: 860, height: 520 });
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const pointersRef = useRef(new Map<number, { x: number; y: number; startX: number; startY: number; left: number; top: number }>());
  const ignoreClickUntil = useRef(0);

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
  const mapScale = fitScale * zoom;
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
    const value = Math.max(1, Math.min(4, next));
    zoomRef.current = value;
    setZoom(value);
  };

  const pointerDistance = () => {
    const [first, second] = [...pointersRef.current.values()];
    return Math.hypot(second.x - first.x, second.y - first.y);
  };

  const beginGesture = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const element = event.currentTarget;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, left: element.scrollLeft, top: element.scrollTop });
    if (pointersRef.current.size === 2) {
      pinchRef.current = { distance: pointerDistance(), zoom: zoomRef.current };
      ignoreClickUntil.current = Date.now() + 500;
    }
  };

  const moveGesture = (event: PointerEvent<HTMLDivElement>) => {
    const pointer = pointersRef.current.get(event.pointerId);
    if (!pointer) return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    const moved = Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) > 6;
    if (!moved && pointersRef.current.size < 2) return;
    event.preventDefault();
    ignoreClickUntil.current = Date.now() + 500;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pointersRef.current.size === 2 && pinchRef.current) {
      setMapZoom(pinchRef.current.zoom * (pointerDistance() / Math.max(1, pinchRef.current.distance)));
    } else {
      event.currentTarget.scrollLeft = pointer.left - (pointer.x - pointer.startX);
      event.currentTarget.scrollTop = pointer.top - (pointer.y - pointer.startY);
    }
  };

  const endGesture = (event: PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    for (const pointer of pointersRef.current.values()) {
      pointer.startX = pointer.x;
      pointer.startY = pointer.y;
      pointer.left = event.currentTarget.scrollLeft;
      pointer.top = event.currentTarget.scrollTop;
    }
  };

  return (
    <div className="map-shell">
      <div
        className="map-scroll"
        ref={viewportRef}
        onPointerDown={beginGesture}
        onPointerMove={moveGesture}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onClickCapture={(event) => {
          if (Date.now() < ignoreClickUntil.current || event.detail > 1) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        <div className="map-stage" style={{ width: stageWidth, height: stageHeight }}>
      <svg
        className="world-map"
        viewBox="0 0 860 520"
        role="group"
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
              aria-label={`${COUNTRIES[sprite.id].name}, ${owner?.color ?? "sin dueño"}, ${state.armies} ejércitos`}
              aria-pressed={isSelected}
              onClick={() => onSelect(sprite.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(sprite.id);
                }
              }}
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
              aria-hidden="true"
              transform={`translate(${sprite.markerX} ${sprite.markerY}) scale(${1 / mapScale})`}
            >
              <circle
                r={colorBlind ? Math.max(13, armyRadius(state.armies)) : armyRadius(state.armies)}
                fill={owner ? COLOR_HEX[owner.color] : "#777"}
                filter="url(#army-shadow)"
              />
              {colorBlind && (
                <text y={-4} textAnchor="middle" className="army-color-letter">
                  {owner ? colorLabels[owner.color] : ""}
                </text>
              )}
              <text
                y={colorBlind ? 7 : 4}
                textAnchor="middle"
                className={`country-army ${colorBlind || state.armies < 10 ? "country-army--small" : ""}`}
              >
                {state.armies}
              </text>
              {showCountryNames && (
                <text
                  y={-armyRadius(state.armies) - 6}
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
      <nav className="map-controls" aria-label="Zoom del mapa">
        <button type="button" aria-label="Alejar mapa" disabled={zoom <= 1} onClick={() => setMapZoom(zoomRef.current / 1.3)}>−</button>
        <button type="button" aria-label="Acercar mapa" disabled={zoom >= 4} onClick={() => setMapZoom(zoomRef.current * 1.3)}>+</button>
        <button type="button" onClick={() => { centerRef.current = { x: .5, y: .5 }; zoomRef.current = 1; setZoom(1); const element = viewportRef.current; if (element) { element.scrollLeft = 0; element.scrollTop = 0; } }}>Ver todo</button>
      </nav>
    </div>
  );
}
