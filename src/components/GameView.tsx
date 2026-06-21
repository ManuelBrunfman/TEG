import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { ADJACENCY, COUNTRIES, areAdjacent } from "@shared/map";
import { missionText } from "@shared/missions";
import { applyAction, findValidExchangeCards, handleTimeout, runBotStep } from "@shared/game";
import type { GameAction, GameState, Session } from "@shared/types";
import { api, type FriendsState } from "../api";
import { MapBoard } from "./MapBoard";

interface Props {
  initialGame: GameState;
  session: Session;
  local: boolean;
  onExit: () => void;
}

const phaseText: Record<GameState["phase"], string> = {
  "setup-5": "Disposición inicial · 5 ejércitos",
  "setup-3": "Segunda disposición · 3 ejércitos",
  reinforce: "Refuerzos",
  attack: "Ataque",
  regroup: "Reagrupamiento",
  finished: "Campaña finalizada"
};

export function GameView({ initialGame, session, local, onExit }: Props) {
  const [game, setGame] = useState<GameState>(() => ({
    ...initialGame,
    paused: initialGame.paused ?? false,
    pauseVotes: initialGame.pauseVotes ?? [],
    pausedRemainingMs: initialGame.pausedRemainingMs ?? null,
    regroupLocked: initialGame.regroupLocked ?? {}
  }));
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"ordenes" | "chat" | "cartas" | "pactos">("ordenes");
  const [chat, setChat] = useState("");
  const [colorBlind, setColorBlind] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [pactCountryId, setPactCountryId] = useState<number | "">("");
  const [lobbyFriends, setLobbyFriends] = useState<FriendsState>({ accepted: [], incoming: [], outgoing: [] });
  const [invitedFriends, setInvitedFriends] = useState<string[]>([]);
  const [localRevealed, setLocalRevealed] = useState(!local);
  const [now, setNow] = useState(Date.now());
  const socketRef = useRef<Socket | null>(null);
  const active = game.players[game.activePlayerIndex];
  const me = local ? active : game.players.find((player) => player.id === session.id);
  const isMyTurn = local ? true : active?.id === session.id;

  useEffect(() => {
    if (local && active && !active.isBot) setLocalRevealed(false);
  }, [active?.id, local]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!local) return;
    const timer = window.setInterval(() => {
      setGame((current) => {
        if (current.status !== "playing") return current;
        const next = structuredClone(current);
        const before = next.updatedAt;
        handleTimeout(next);
        const currentPlayer = next.players[next.activePlayerIndex];
        if (currentPlayer?.isBot) runBotStep(next);
        return next.updatedAt === before ? current : next;
      });
    }, 500);
    return () => window.clearInterval(timer);
  }, [local]);

  useEffect(() => {
    if (local) return;
    const socket = io();
    socketRef.current = socket;
    socket.emit("game:watch", { gameId: game.id, playerId: session.id });
    socket.on("game:state", (next: GameState) => {
      setGame(next);
      setSelected(null);
    });
    socket.on("game:error", setError);
    return () => {
      socket.disconnect();
    };
  }, [game.id, local, session.id]);

  useEffect(() => {
    if (!local && game.status === "lobby" && game.hostId === session.id) {
      void api.friends(session.id).then(setLobbyFriends).catch(() => undefined);
    }
  }, [game.hostId, game.status, local, session.id]);

  useEffect(() => {
    if (local) localStorage.setItem("reinos-local-game", JSON.stringify(game));
  }, [game, local]);

  useEffect(() => {
    if (!game.lastBattle) return;
    if (soundOn) {
      const AudioContextClass = window.AudioContext;
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(game.lastBattle.conquered ? 180 : 120, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(game.lastBattle.conquered ? 520 : 220, context.currentTime + 0.18);
      gain.gain.setValueAtTime(0.07, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.22);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.23);
      oscillator.addEventListener("ended", () => void context.close());
    }
    navigator.vibrate?.(game.lastBattle.conquered ? [45, 40, 80] : 45);
  }, [game.lastBattle, soundOn]);

  const dispatch = (action: GameAction) => {
    setError("");
    if (local) {
      try {
        const next = structuredClone(game);
        applyAction(next, active.id, action);
        setGame(next);
        setSelected(null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Acción inválida.");
      }
      return;
    }
    socketRef.current?.emit(
      "game:action",
      { gameId: game.id, playerId: session.id, action },
      (result: { ok: boolean; error?: string }) => {
        if (!result.ok) setError(result.error || "Acción inválida.");
      }
    );
  };

  const selectCountry = (countryId: number) => {
    if (!isMyTurn || game.status !== "playing") return;
    const country = game.countries[countryId];
    if (["setup-5", "setup-3", "reinforce"].includes(game.phase)) {
      if (country.ownerId === active.id) dispatch({ type: "place", countryId, count: 1 });
      else setError("Solo podés reforzar territorios propios.");
      return;
    }
    if (selected === null) {
      if (country.ownerId !== active.id) setError("Primero elegí un territorio propio.");
      else setSelected(countryId);
      return;
    }
    if (selected === countryId) {
      setSelected(null);
      return;
    }
    const from = game.countries[selected];
    if (!areAdjacent(selected, countryId)) {
      setError("Los territorios elegidos no son limítrofes.");
      setSelected(country.ownerId === active.id ? countryId : null);
      return;
    }
    if (game.phase === "attack") {
      if (country.ownerId === active.id) setSelected(countryId);
      else dispatch({ type: "attack", from: selected, to: countryId });
    } else if (game.phase === "regroup") {
      if (from.ownerId === active.id && country.ownerId === active.id) {
        const amount = Math.min(3, from.armies - 1 - (game.regroupLocked[selected] ?? 0));
        if (amount > 0) dispatch({ type: "regroup", from: selected, to: countryId, count: amount });
        else setError("Esos ejércitos ya fueron reagrupados o deben dejar una ficha en origen.");
      } else setError("El reagrupamiento se realiza entre territorios propios.");
    }
  };

  const seconds = Math.max(0, Math.ceil(((game.turnDeadline ?? now) - now) / 1000));
  const selectedState = selected === null ? null : game.countries[selected];
  const myCards = me?.cards ?? [];
  const validCardSet = findValidExchangeCards(myCards);
  const selectedName = selected === null ? "" : COUNTRIES[selected].name;
  const winner = game.players.find((player) => player.id === game.winnerId);
  const canStart = game.status === "lobby" && game.hostId === session.id;
  const battleText = useMemo(() => {
    if (!game.lastBattle) return null;
    const battle = game.lastBattle;
    return `${COUNTRIES[battle.from].name} ${battle.attackerDice.join("·")} vs ${COUNTRIES[battle.to].name} ${battle.defenderDice.join("·")}`;
  }, [game.lastBattle]);

  const sendChat = () => {
    if (!chat.trim() || local) return;
    socketRef.current?.emit("game:chat", { gameId: game.id, playerId: session.id, text: chat });
    setChat("");
  };

  if (game.status === "lobby") {
    return (
      <main className="lobby-room page-shell">
        <button className="text-button" onClick={onExit}>← Volver</button>
        <section className="panel lobby-card">
          <p className="eyebrow">Sala de guerra</p>
          <h1>{game.name}</h1>
          <div className="invite-code"><span>Código</span><strong>{game.code}</strong></div>
          <div className="player-grid">
            {game.players.map((player) => (
              <div className="player-tile" key={player.id}>
                <span className={`player-shield color-${player.color}`}>{player.avatar}</span>
                <strong>{player.name}</strong>
                <small>{player.isBot ? "Bot" : player.id === game.hostId ? "Anfitrión" : "Listo"}</small>
              </div>
            ))}
            {Array.from({ length: game.settings.maxPlayers - game.players.length }, (_, index) => (
              <div className="player-tile player-tile--empty" key={index}>Lugar disponible</div>
            ))}
          </div>
          {canStart && lobbyFriends.accepted.length > 0 && (
            <div className="lobby-friends">
              <div className="lobby-friends-title">
                <strong>Invitar compañeros</strong>
                <button onClick={async () => {
                  for (const friend of lobbyFriends.accepted) {
                    await api.inviteFriend(game.id, session.id, friend.id);
                  }
                  setInvitedFriends(lobbyFriends.accepted.map((friend) => friend.id));
                }}>Invitar a todos</button>
              </div>
              {lobbyFriends.accepted.map((friend) => (
                <button
                  key={friend.id}
                  disabled={invitedFriends.includes(friend.id)}
                  onClick={async () => {
                    await api.inviteFriend(game.id, session.id, friend.id);
                    setInvitedFriends((current) => [...current, friend.id]);
                  }}
                >
                  <span>{friend.avatar}</span>{friend.name}<small>{invitedFriends.includes(friend.id) ? "Invitado" : "Invitar"}</small>
                </button>
              ))}
            </div>
          )}
          {canStart && (
            <div className="button-row">
              {game.players.length < game.settings.maxPlayers && (
                <button className="button button--secondary" onClick={async () => {
                  const response = await fetch(`/api/games/${game.id}/bots`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ actorId: session.id })
                  });
                  if (!response.ok) setError((await response.json()).error);
                }}>+ Agregar bot</button>
              )}
              <button className="button" onClick={async () => {
                const response = await fetch(`/api/games/${game.id}/start`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ actorId: session.id })
                });
                if (!response.ok) setError((await response.json()).error);
              }}>Comenzar campaña</button>
            </div>
          )}
          {!canStart && <p className="muted">Esperando que el anfitrión inicie la campaña…</p>}
          {error && <div className="error-banner">{error}</div>}
        </section>
      </main>
    );
  }

  return (
    <main className="game-screen">
      <header className="war-bar">
        <button className="icon-button" onClick={onExit} aria-label="Salir">☰</button>
        <div>
          <strong>{game.name}</strong>
          <small>Ronda {game.round || "inicial"} · {phaseText[game.phase]}</small>
        </div>
        <div className={`turn-clock ${seconds <= 15 ? "turn-clock--danger" : ""}`}>
          <span>⌛</span><strong>{seconds}s</strong>
        </div>
      </header>

      <section className="player-ribbon">
        {game.players.map((player, index) => (
          <div className={`player-chip ${index === game.activePlayerIndex ? "player-chip--active" : ""} ${player.eliminated ? "player-chip--out" : ""}`} key={player.id}>
            <span className={`player-dot color-${player.color}`}>{player.avatar}</span>
            <span><strong>{player.name}</strong><small>{game.countries.filter((c) => c.ownerId === player.id).length} territorios</small></span>
            {!player.connected && !player.isBot && <em>auto</em>}
          </div>
        ))}
      </section>

      <div className="board-layout">
        <section className="board-wrap">
          <MapBoard game={game} selected={selected} onSelect={selectCountry} colorBlind={colorBlind} />
          {battleText && <div className="battle-toast">⚔ {battleText}</div>}
          {error && <button className="error-banner error-banner--floating" onClick={() => setError("")}>{error} ×</button>}
          {game.status === "finished" && (
            <div className="victory-overlay">
              <div className="panel">
                <span className="victory-crown">♛</span>
                <p className="eyebrow">Victoria</p>
                <h2>{winner?.name}</h2>
                <p>{game.winnerReason}</p>
                <button className="button" onClick={onExit}>Volver al salón</button>
              </div>
            </div>
          )}
        </section>

        <aside className="command-panel">
          <nav className="command-tabs">
            <button className={tab === "ordenes" ? "active" : ""} onClick={() => setTab("ordenes")}>Órdenes</button>
            <button className={tab === "cartas" ? "active" : ""} onClick={() => setTab("cartas")}>Cartas <b>{myCards.length}</b></button>
            <button className={tab === "pactos" ? "active" : ""} onClick={() => setTab("pactos")}>Pactos</button>
            <button className={tab === "chat" ? "active" : ""} onClick={() => setTab("chat")}>Chat</button>
          </nav>

          {tab === "ordenes" && (
            <div className="command-content">
              <p className="eyebrow">{isMyTurn ? "Tu turno" : `Turno de ${active?.name}`}</p>
              <h2>{phaseText[game.phase]}</h2>
              {["setup-5", "setup-3", "reinforce"].includes(game.phase) && (
                <>
                  <div className="army-count"><strong>{game.reinforcements}</strong><span>ejércitos por ubicar</span></div>
                  <p>Tocá un territorio propio para colocar una ficha.</p>
                  {selectedState?.ownerId === active.id && (
                    <button className="button" onClick={() => dispatch({ type: "place", countryId: selected!, count: game.reinforcements })}>
                      Colocar todos en {selectedName}
                    </button>
                  )}
                </>
              )}
              {game.phase === "attack" && (
                <>
                  <p>Elegí un territorio propio y luego uno enemigo limítrofe. Los dados se tiran automáticamente.</p>
                  {selected !== null && <div className="selection-card">Atacante: <strong>{selectedName}</strong></div>}
                  <button className="button button--secondary" disabled={!isMyTurn} onClick={() => dispatch({ type: "end-attack" })}>
                    Finalizar ataques
                  </button>
                </>
              )}
              {game.phase === "regroup" && (
                <>
                  <p>Elegí dos territorios propios limítrofes. Se moverán hasta 3 ejércitos y no podrán volver a moverse en este turno.</p>
                  <button className="button" disabled={!isMyTurn} onClick={() => dispatch({ type: "end-turn" })}>Finalizar turno</button>
                </>
              )}
              <div className="mission-scroll">
                <span>Objetivo secreto</span>
                <p>{missionText(me?.missionId ?? "hidden")}</p>
              </div>
              <label className="toggle-row">
                <input type="checkbox" checked={colorBlind} onChange={(event) => setColorBlind(event.target.checked)} />
                <span>Identificar colores con letras</span>
              </label>
              <label className="toggle-row">
                <input type="checkbox" checked={soundOn} onChange={(event) => setSoundOn(event.target.checked)} />
                <span>Sonidos de batalla</span>
              </label>
              {game.settings.visibility !== "public" && me && (
                <button className="button button--secondary" onClick={() => dispatch({ type: "vote-pause" })}>
                  Solicitar pausa ({game.pauseVotes?.length ?? 0}/{game.players.filter((player) => !player.isBot && !player.eliminated).length})
                </button>
              )}
            </div>
          )}

          {tab === "cartas" && (
            <div className="command-content">
              <h2>Tarjetas de territorio</h2>
              <div className="card-list">
                {myCards.map((card) => (
                  <div className="country-card" key={card.countryId}>
                    <span>{card.symbol === "cañón" ? "☄" : card.symbol === "galeón" ? "⛵" : card.symbol === "globo" ? "◉" : "★"}</span>
                    <strong>{COUNTRIES[card.countryId].name}</strong>
                    <small>{card.symbol}</small>
                  </div>
                ))}
                {!myCards.length && <p className="muted">Todavía no obtuviste tarjetas.</p>}
              </div>
              {validCardSet && (
                <button className="button" onClick={() => dispatch({ type: "exchange", cardCountryIds: validCardSet.map((card) => card.countryId) })}>
                  Canjear combinación válida
                </button>
              )}
            </div>
          )}

          {tab === "chat" && (
            <div className="command-content chat-panel">
              <div className="chat-messages">
                {game.messages.slice(-60).map((message) => (
                  <div className={message.system ? "chat-message chat-message--system" : "chat-message"} key={message.id}>
                    <strong>{message.playerName}</strong><p>{message.text}</p>
                  </div>
                ))}
              </div>
              {!local && me && (
                <form className="chat-form" onSubmit={(event) => { event.preventDefault(); sendChat(); }}>
                  <input value={chat} onChange={(event) => setChat(event.target.value)} placeholder="Escribí al consejo…" maxLength={400} />
                  <button>Enviar</button>
                </form>
              )}
            </div>
          )}

          {tab === "pactos" && (
            <div className="command-content">
              <h2>Consejo diplomático</h2>
              <p>Los pactos aceptados bloquean automáticamente los ataques que los contradigan.</p>
              {isMyTurn && (
                <label className="pact-country-select">
                  <span>Territorio para pactos de frontera o zona</span>
                  <select value={pactCountryId} onChange={(event) => setPactCountryId(event.target.value === "" ? "" : Number(event.target.value))}>
                    <option value="">Elegir territorio</option>
                    {game.countries.filter((country) => country.ownerId === active.id).map((country) => (
                      <option value={country.id} key={country.id}>{COUNTRIES[country.id].name}</option>
                    ))}
                  </select>
                </label>
              )}
              {isMyTurn && game.players.filter((player) => !player.eliminated && player.id !== active.id).map((player) => {
                const borderCountry = pactCountryId === ""
                  ? undefined
                  : (ADJACENCY[pactCountryId] ?? []).find((id) => game.countries[id].ownerId === player.id);
                return (
                  <div className="pact-proposal" key={player.id}>
                    <strong>{player.name}</strong>
                    <button className="button button--secondary" onClick={() => dispatch({ type: "propose-pact", kind: "global", playerIds: [player.id], countryIds: [] })}>
                      No agresión mundial
                    </button>
                    <button
                      className="button button--secondary"
                      disabled={pactCountryId === ""}
                      onClick={() => dispatch({ type: "propose-pact", kind: "international-zone", playerIds: [player.id], countryIds: [Number(pactCountryId)] })}
                    >
                      Zona internacional
                    </button>
                    <button
                      className="button button--secondary"
                      disabled={pactCountryId === "" || borderCountry === undefined}
                      onClick={() => dispatch({ type: "propose-pact", kind: "border", playerIds: [player.id], countryIds: [Number(pactCountryId), borderCountry!] })}
                    >
                      No agresión fronteriza
                    </button>
                  </div>
                );
              })}
              <div className="pact-list">
                {game.pacts.map((pact) => {
                  const participants = pact.playerIds
                    .map((id) => game.players.find((player) => player.id === id)?.name)
                    .filter(Boolean)
                    .join(" · ");
                  const canAccept = me && pact.playerIds.includes(me.id) && !pact.acceptedBy.includes(me.id);
                  return (
                    <article className="pact-card" key={pact.id}>
                      <strong>{pact.kind === "global" ? "No agresión mundial" : pact.kind === "border" ? "Frontera neutral" : "Zona internacional"}</strong>
                      <span>{participants}</span>
                      <small>{pact.active ? "Vigente" : `Aceptado por ${pact.acceptedBy.length}/${pact.playerIds.length}`}</small>
                      {canAccept && <button className="button button--small" onClick={() => dispatch({ type: "accept-pact", pactId: pact.id })}>Aceptar</button>}
                    </article>
                  );
                })}
                {!game.pacts.length && <p className="muted">No hay pactos propuestos.</p>}
              </div>
            </div>
          )}
        </aside>
      </div>
      {local && active && !active.isBot && !localRevealed && game.status === "playing" && (
        <div className="pass-overlay">
          <div className="panel">
            <span className={`pass-shield color-${active.color}`}>{active.avatar}</span>
            <p className="eyebrow">Cambio de comandante</p>
            <h2>Pasale el dispositivo a {active.name}</h2>
            <p>El objetivo y las tarjetas permanecerán ocultos hasta que confirme.</p>
            <button className="button button--large" onClick={() => setLocalRevealed(true)}>Estoy listo</button>
          </div>
        </div>
      )}
      {game.paused && (
        <div className="pause-overlay">
          <div className="panel">
            <span className="victory-crown">Ⅱ</span>
            <p className="eyebrow">Campaña pausada</p>
            <h2>El consejo detuvo el reloj</h2>
            <button className="button button--large" onClick={() => dispatch({ type: "resume" })}>Reanudar partida</button>
          </div>
        </div>
      )}
    </main>
  );
}
