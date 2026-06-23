import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { ADJACENCY, CONTINENTS, COUNTRIES, areAdjacent } from "@shared/map";
import { missionText } from "@shared/missions";
import { applyAction, findValidExchangeCards, handleTimeout, runBotStep, validExchange } from "@shared/game";
import type { BattleResult, ChatMessage, ContinentId, GameAction, GameState, Session } from "@shared/types";
import { api, type FriendsState } from "../api";
import { MapBoard } from "./MapBoard";

interface Props {
  initialGame: GameState;
  session: Session;
  local: boolean;
  onExit: (finished?: boolean) => void;
}

interface VoicePeer {
  socketId: string;
  playerId: string;
  name: string;
  avatar: string;
}

interface VoiceSignal extends Omit<VoicePeer, "socketId"> {
  from: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

const phaseText: Record<GameState["phase"], string> = {
  "setup-5": "Disposición inicial · 5 ejércitos",
  "setup-3": "Segunda disposición · 3 ejércitos",
  reinforce: "Refuerzos",
  attack: "Ataque",
  occupy: "Ocupación",
  regroup: "Reagrupamiento",
  finished: "Campaña finalizada"
};

const phaseDetails: Record<GameState["phase"], { icon: string; kind: string; step: number; instruction: string }> = {
  "setup-5": { icon: "⚑", kind: "placement", step: 1, instruction: "Tocá un territorio propio para colocar un ejército." },
  "setup-3": { icon: "⚑", kind: "placement", step: 1, instruction: "Tocá un territorio propio para completar la disposición inicial." },
  reinforce: { icon: "♜", kind: "placement", step: 1, instruction: "Ubicá todos tus refuerzos antes de atacar." },
  attack: { icon: "⚔", kind: "attack", step: 2, instruction: "Elegí un territorio propio y luego un enemigo limítrofe." },
  occupy: { icon: "⚑", kind: "attack", step: 2, instruction: "Elegí cuántos ejércitos pasan al territorio conquistado." },
  regroup: { icon: "↔", kind: "regroup", step: 3, instruction: "Elegí dos territorios propios limítrofes y la cantidad que querés mover." },
  finished: { icon: "♛", kind: "finished", step: 3, instruction: "La campaña ha finalizado." }
};

const diceFaces = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

const audioFiles = {
  music: `${import.meta.env.BASE_URL}audio/celebration.mp3`,
  dice: `${import.meta.env.BASE_URL}audio/dice-roll.mp3`,
  battle: `${import.meta.env.BASE_URL}audio/battle.mp3`
};

function createAudio(src: string, volume: number) {
  const audio = new Audio(src);
  audio.volume = volume;
  audio.preload = "auto";
  return audio;
}

export function GameView({ initialGame, session, local, onExit }: Props) {
  const [game, setGame] = useState<GameState>(() => ({
    ...initialGame,
    players: initialGame.players.map((player) => ({
      ...player,
      cards: player.cards.map((card) => ({
        ...card,
        used: card.used ?? (initialGame.countries[card.countryId]?.ownerId === player.id)
      }))
    })),
    roundStarterIndex: initialGame.roundStarterIndex ?? initialGame.activePlayerIndex,
    roundStage: initialGame.roundStage ?? (initialGame.phase === "reinforce" ? "reinforce" : "combat"),
    pendingConquest: initialGame.pendingConquest ?? null,
    baseReinforcements: initialGame.baseReinforcements ?? initialGame.reinforcements,
    continentReinforcements: initialGame.continentReinforcements ?? {},
    placementHistory: initialGame.placementHistory ?? [],
    paused: initialGame.paused ?? false,
    pauseVotes: initialGame.pauseVotes ?? [],
    pausedRemainingMs: initialGame.pausedRemainingMs ?? null,
    regroupLocked: initialGame.regroupLocked ?? {},
    lastBattle: initialGame.lastBattle
      ? { ...initialGame.lastBattle, id: initialGame.lastBattle.id ?? `legacy-${initialGame.updatedAt}` }
      : null
  }));
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"ordenes" | "chat" | "cartas" | "pactos">("ordenes");
  const [chat, setChat] = useState("");
  const [selectedCardIds, setSelectedCardIds] = useState<number[]>([]);
  const [regroupDraft, setRegroupDraft] = useState<{ from: number; to: number; maximum: number } | null>(null);
  const [regroupCount, setRegroupCount] = useState(1);
  const [chatStatus, setChatStatus] = useState<"connecting" | "connected" | "disconnected" | "sending">("connecting");
  const [colorBlind, setColorBlind] = useState(false);
  const [showCountryNames, setShowCountryNames] = useState(false);
  const [soundOn, setSoundOn] = useState(() => localStorage.getItem("teg-sound") !== "off");
  const [musicOn, setMusicOn] = useState(() => localStorage.getItem("teg-music") !== "off");
  const [reinforcementSource, setReinforcementSource] = useState<"base" | ContinentId>("base");
  const [battlePresentation, setBattlePresentation] = useState<{ battle: BattleResult; rolling: boolean } | null>(null);
  const [pactCountryId, setPactCountryId] = useState<number | "">("");
  const [lobbyFriends, setLobbyFriends] = useState<FriendsState>({ accepted: [], incoming: [], outgoing: [] });
  const [invitedFriends, setInvitedFriends] = useState<string[]>([]);
  const [localRevealed, setLocalRevealed] = useState(!local);
  const [now, setNow] = useState(Date.now());
  const [voiceStatus, setVoiceStatus] = useState<"off" | "connecting" | "active">("off");
  const [voicePeers, setVoicePeers] = useState<Record<string, VoicePeer>>({});
  const socketRef = useRef<Socket | null>(null);
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const localVoiceStreamRef = useRef<MediaStream | null>(null);
  const voiceConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const voiceAudioRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const pendingVoiceCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const active = game.players[game.activePlayerIndex];
  const me = local ? active : game.players.find((player) => player.id === session.id);
  const isMyTurn = local ? true : active?.id === session.id;

  const closeVoicePeer = (socketId: string) => {
    voiceConnectionsRef.current.get(socketId)?.close();
    voiceConnectionsRef.current.delete(socketId);
    const audio = voiceAudioRef.current.get(socketId);
    if (audio) {
      audio.pause();
      audio.srcObject = null;
    }
    voiceAudioRef.current.delete(socketId);
    pendingVoiceCandidatesRef.current.delete(socketId);
    setVoicePeers((current) => {
      if (!current[socketId]) return current;
      const next = { ...current };
      delete next[socketId];
      return next;
    });
  };

  const ensureVoicePeer = async (peer: VoicePeer, createOffer: boolean) => {
    const existing = voiceConnectionsRef.current.get(peer.socketId);
    if (existing) return existing;
    const stream = localVoiceStreamRef.current;
    const socket = socketRef.current;
    if (!stream || !socket) throw new Error("El micrófono todavía no está listo.");

    const connection = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
      ]
    });
    voiceConnectionsRef.current.set(peer.socketId, connection);
    setVoicePeers((current) => ({ ...current, [peer.socketId]: peer }));
    stream.getTracks().forEach((track) => connection.addTrack(track, stream));

    connection.onicecandidate = (event) => {
      if (!event.candidate) return;
      socket.emit("game:voice-signal", {
        gameId: game.id,
        target: peer.socketId,
        candidate: event.candidate.toJSON()
      });
    };
    connection.ontrack = (event) => {
      const audio = voiceAudioRef.current.get(peer.socketId) ?? new Audio();
      audio.autoplay = true;
      audio.srcObject = event.streams[0];
      voiceAudioRef.current.set(peer.socketId, audio);
      void audio.play().catch(() => undefined);
    };
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === "failed" || connection.connectionState === "closed") {
        closeVoicePeer(peer.socketId);
      }
    };

    if (createOffer) {
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      socket.emit("game:voice-signal", {
        gameId: game.id,
        target: peer.socketId,
        description: connection.localDescription
      });
    }
    return connection;
  };

  const stopVoice = (notifyServer = true) => {
    if (notifyServer) socketRef.current?.emit("game:voice-leave");
    for (const socketId of [...voiceConnectionsRef.current.keys()]) closeVoicePeer(socketId);
    localVoiceStreamRef.current?.getTracks().forEach((track) => track.stop());
    localVoiceStreamRef.current = null;
    setVoicePeers({});
    setVoiceStatus("off");
  };

  useEffect(() => {
    if (local && active && !active.isBot) setLocalRevealed(false);
  }, [active?.id, local]);

  useEffect(() => {
    setSelectedCardIds([]);
    setRegroupDraft(null);
  }, [game.activePlayerIndex, game.phase]);

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
    socket.on("connect", () => {
      setChatStatus("connecting");
      socket.timeout(5000).emit(
        "game:watch",
        { gameId: game.id, playerId: session.id },
        (timeoutError: Error | null, result?: { ok: boolean; error?: string }) => {
          if (timeoutError || !result?.ok) {
            setChatStatus("disconnected");
            setError(result?.error || "No se pudo conectar el chat.");
            return;
          }
          setChatStatus("connected");
        }
      );
    });
    socket.on("disconnect", () => {
      setChatStatus("disconnected");
      stopVoice(false);
    });
    socket.on("connect_error", () => setChatStatus("disconnected"));
    socket.on("game:state", (next: GameState) => {
      setGame({
        ...next,
        placementHistory: next.placementHistory ?? [],
        lastBattle: next.lastBattle
          ? { ...next.lastBattle, id: next.lastBattle.id ?? `legacy-${next.updatedAt}` }
          : null
      });
      setSelected(null);
      setRegroupDraft(null);
      setSelectedCardIds((current) =>
        current.filter((countryId) =>
          next.players.find((player) => player.id === session.id)?.cards.some((card) => card.countryId === countryId)
        )
      );
    });
    socket.on("game:chat-message", (message: ChatMessage) => {
      setGame((current) => {
        if (current.messages.some((item) => item.id === message.id)) return current;
        return { ...current, messages: [...current.messages, message].slice(-150) };
      });
    });
    socket.on("game:voice-peer-joined", (peer: VoicePeer) => {
      setVoicePeers((current) => ({ ...current, [peer.socketId]: peer }));
    });
    socket.on("game:voice-peer-left", ({ socketId }: { socketId: string }) => closeVoicePeer(socketId));
    socket.on("game:voice-signal", async (signal: VoiceSignal) => {
      try {
        const peer: VoicePeer = {
          socketId: signal.from,
          playerId: signal.playerId,
          name: signal.name,
          avatar: signal.avatar
        };
        const connection = await ensureVoicePeer(peer, false);
        if (signal.description) {
          await connection.setRemoteDescription(signal.description);
          const queued = pendingVoiceCandidatesRef.current.get(signal.from) ?? [];
          pendingVoiceCandidatesRef.current.delete(signal.from);
          for (const candidate of queued) await connection.addIceCandidate(candidate);
          if (signal.description.type === "offer") {
            const answer = await connection.createAnswer();
            await connection.setLocalDescription(answer);
            socket.emit("game:voice-signal", {
              gameId: game.id,
              target: signal.from,
              description: connection.localDescription
            });
          }
        }
        if (signal.candidate) {
          if (connection.remoteDescription) await connection.addIceCandidate(signal.candidate);
          else {
            const queued = pendingVoiceCandidatesRef.current.get(signal.from) ?? [];
            pendingVoiceCandidatesRef.current.set(signal.from, [...queued, signal.candidate]);
          }
        }
      } catch {
        closeVoicePeer(signal.from);
        setError("No se pudo conectar el audio con uno de los jugadores.");
      }
    });
    socket.on("game:error", setError);
    return () => {
      stopVoice(false);
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
    const battle = game.lastBattle;
    if (!battle) {
      setBattlePresentation(null);
      return;
    }
    setBattlePresentation({ battle, rolling: true });
    const settleTimer = window.setTimeout(() => {
      setBattlePresentation((current) => current ? { ...current, rolling: false } : null);
    }, 650);
    const hideTimer = window.setTimeout(() => setBattlePresentation(null), 2300);
    let diceAudio: HTMLAudioElement | null = null;
    let battleAudio: HTMLAudioElement | null = null;
    let battleSoundTimer: number | null = null;
    if (soundOn) {
      diceAudio = createAudio(audioFiles.dice, 0.5);
      void diceAudio.play().catch(() => undefined);
      battleSoundTimer = window.setTimeout(() => {
        battleAudio = createAudio(audioFiles.battle, battle.conquered ? 0.3 : 0.2);
        void battleAudio.play().catch(() => undefined);
      }, 620);
    }
    navigator.vibrate?.(battle.conquered ? [45, 40, 80] : 45);
    return () => {
      window.clearTimeout(settleTimer);
      window.clearTimeout(hideTimer);
      if (battleSoundTimer !== null) window.clearTimeout(battleSoundTimer);
      diceAudio?.pause();
      battleAudio?.pause();
    };
  }, [game.lastBattle?.id]);

  useEffect(() => {
    localStorage.setItem("teg-sound", soundOn ? "on" : "off");
  }, [soundOn]);

  useEffect(() => {
    localStorage.setItem("teg-music", musicOn ? "on" : "off");
    if (!musicOn) {
      musicRef.current?.pause();
      return;
    }
    const music = musicRef.current ?? createAudio(audioFiles.music, 0.16);
    music.loop = true;
    musicRef.current = music;
    const play = () => void music.play().catch(() => undefined);
    play();
    window.addEventListener("pointerdown", play, { once: true });
    window.addEventListener("keydown", play, { once: true });
    return () => {
      window.removeEventListener("pointerdown", play);
      window.removeEventListener("keydown", play);
    };
  }, [musicOn]);

  useEffect(() => () => {
    musicRef.current?.pause();
    musicRef.current = null;
  }, []);

  useEffect(() => {
    if (!["setup-5", "setup-3", "reinforce"].includes(game.phase)) return;
    if (reinforcementSource === "base" && game.baseReinforcements > 0) return;
    if (reinforcementSource !== "base" && (game.continentReinforcements[reinforcementSource] ?? 0) > 0) return;
    const continent = Object.entries(game.continentReinforcements)
      .find(([, count]) => (count ?? 0) > 0)?.[0] as ContinentId | undefined;
    setReinforcementSource(game.baseReinforcements > 0 ? "base" : continent ?? "base");
  }, [game.activePlayerIndex, game.baseReinforcements, game.continentReinforcements, game.phase, reinforcementSource]);

  const dispatch = (action: GameAction) => {
    setError("");
    if (local) {
      try {
        const next = structuredClone(game);
        applyAction(next, active.id, action);
        setGame(next);
        setSelected(null);
        setRegroupDraft(null);
        if (action.type === "exchange") setSelectedCardIds([]);
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
    if (game.phase === "occupy") return;
    const country = game.countries[countryId];
    if (["setup-5", "setup-3", "reinforce"].includes(game.phase)) {
      if (country.ownerId !== active.id) {
        setError("Solo podés reforzar territorios propios.");
        return;
      }
      if (reinforcementSource !== "base" && COUNTRIES[countryId].continent !== reinforcementSource) {
        setError(`El bonus de ${CONTINENTS[reinforcementSource].name} solo puede ubicarse dentro de ese continente.`);
        return;
      }
      dispatch({ type: "place", countryId, count: 1, source: reinforcementSource });
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
        const maximum = from.armies - 1 - (game.regroupLocked[selected] ?? 0);
        if (maximum > 0) {
          setRegroupDraft({ from: selected, to: countryId, maximum });
          setRegroupCount(maximum);
        }
        else setError("Esos ejércitos ya fueron reagrupados o deben dejar una ficha en origen.");
      } else setError("El reagrupamiento se realiza entre territorios propios.");
    }
  };

  const seconds = Math.max(0, Math.ceil(((game.turnDeadline ?? now) - now) / 1000));
  const myCards = me?.cards ?? [];
  const validCardSet = findValidExchangeCards(myCards);
  const selectedCards = myCards.filter((card) => selectedCardIds.includes(card.countryId));
  const selectedExchangeValid = validExchange(selectedCards);
  const nextExchangeValue = !me ? 4 : me.exchanges === 0 ? 4 : me.exchanges === 1 ? 7 : me.exchanges === 2 ? 10 : 10 + (me.exchanges - 2) * 5;
  const selectedName = selected === null ? "" : COUNTRIES[selected].name;
  const winner = game.players.find((player) => player.id === game.winnerId);
  const canStart = game.status === "lobby" && game.hostId === session.id;
  const phase = phaseDetails[game.phase];
  const phaseInstruction = isMyTurn ? phase.instruction : `Esperando a ${active?.name ?? "otro comandante"}.`;
  const orderedPlayers = useMemo(() => {
    const order = game.players.map((player, index) => ({ player, index }));
    return [
      ...order.slice(game.roundStarterIndex),
      ...order.slice(0, game.roundStarterIndex)
    ].filter(({ player }) => !player.eliminated);
  }, [game.players, game.roundStarterIndex]);
  const currentOrderPosition = orderedPlayers.findIndex(({ index }) => index === game.activePlayerIndex);

  const toggleMusic = () => setMusicOn((current) => !current);

  const startVoice = async () => {
    const socket = socketRef.current;
    if (!socket?.connected) {
      setError("La conexión está desconectada. No se pudo activar la voz.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Este navegador no permite usar el micrófono.");
      return;
    }
    setError("");
    setVoiceStatus("connecting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
      localVoiceStreamRef.current = stream;
      socket.timeout(5000).emit(
        "game:voice-join",
        { gameId: game.id },
        async (
          timeoutError: Error | null,
          result?: { ok: boolean; peers?: VoicePeer[]; error?: string }
        ) => {
          if (timeoutError || !result?.ok) {
            stopVoice(false);
            setError(result?.error || "No se pudo entrar a la sala de voz.");
            return;
          }
          setVoiceStatus("active");
          try {
            await Promise.all((result.peers ?? []).map((peer) => ensureVoicePeer(peer, true)));
          } catch {
            setError("No se pudo conectar el audio con todos los jugadores.");
          }
        }
      );
    } catch (caught) {
      stopVoice(false);
      const denied = caught instanceof DOMException && (caught.name === "NotAllowedError" || caught.name === "PermissionDeniedError");
      setError(denied ? "El permiso del micrófono fue rechazado." : "No se pudo acceder al micrófono.");
    }
  };

  const sendChat = () => {
    if (!chat.trim() || local) return;
    const socket = socketRef.current;
    if (!socket?.connected) {
      setError("El chat está desconectado. Esperá a que se restablezca la conexión.");
      setChatStatus("disconnected");
      return;
    }
    const text = chat.trim();
    setChatStatus("sending");
    socket.timeout(5000).emit(
      "game:chat",
      { gameId: game.id, text },
      (timeoutError: Error | null, result?: { ok: boolean; error?: string }) => {
        if (timeoutError) {
          setError("El servidor no respondió al mensaje. Probá nuevamente.");
          setChatStatus(socket.connected ? "connected" : "disconnected");
        } else if (result?.ok) {
          setChat("");
          setChatStatus("connected");
        } else {
          setError(result?.error || "No se pudo enviar el mensaje.");
          setChatStatus("connected");
        }
      }
    );
  };

  if (game.status === "lobby") {
    return (
      <main className="lobby-room page-shell">
        <button className="text-button" onClick={() => onExit(false)}>← Volver</button>
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
        <button className="icon-button" onClick={() => onExit(game.status === "finished")} aria-label="Salir">☰</button>
        <div>
          <strong>{game.name}</strong>
          <small>
            Ronda {game.round || "inicial"} · turno {Math.max(1, currentOrderPosition + 1)} de {orderedPlayers.length}
          </small>
        </div>
        <div className={`turn-clock ${seconds <= 15 ? "turn-clock--danger" : ""}`}>
          <span>⌛</span><strong>{seconds}s</strong>
        </div>
      </header>

      <section className="player-ribbon">
        <div className="turn-order-label">
          <small>Orden</small>
          <strong>{Math.max(1, currentOrderPosition + 1)}/{orderedPlayers.length}</strong>
        </div>
        {orderedPlayers.map(({ player, index }, orderIndex) => (
          <div className={`player-chip ${index === game.activePlayerIndex ? "player-chip--active" : ""}`} key={player.id}>
            <b className="player-order-number">{orderIndex + 1}º</b>
            <span className={`player-dot color-${player.color}`}>{player.avatar}</span>
            <span>
              <strong>{player.name}</strong>
              <small>{index === game.activePlayerIndex ? "JUGANDO AHORA" : orderIndex < currentOrderPosition ? "Ya jugó" : "Próximo"} · {game.countries.filter((c) => c.ownerId === player.id).length} territorios</small>
            </span>
            {!player.connected && !player.isBot && <em>auto</em>}
          </div>
        ))}
      </section>

      <div className="board-layout">
        <section className="board-wrap">
          <MapBoard
            game={game}
            selected={selected}
            onSelect={selectCountry}
            colorBlind={colorBlind}
            showCountryNames={showCountryNames}
          />
          <button
            className={`country-name-toggle ${showCountryNames ? "active" : ""}`}
            onClick={() => setShowCountryNames((current) => !current)}
            aria-pressed={showCountryNames}
          >
            {showCountryNames ? "Ocultar países" : "Mostrar países"}
          </button>
          <div className={`phase-banner phase-banner--${phase.kind}`}>
            <span className="phase-banner-icon">{phase.icon}</span>
            <div className="phase-banner-copy">
              <small>FASE ACTUAL · {isMyTurn ? "TU TURNO" : `TURNO DE ${active?.name?.toUpperCase()}`}</small>
              <strong>{phaseText[game.phase]}</strong>
              <p>{phaseInstruction}</p>
            </div>
            <div className="phase-progress" aria-label={`Paso ${phase.step} de 3`}>
              {[1, 2, 3].map((step) => <i className={step <= phase.step ? "active" : ""} key={step} />)}
              <span>{phase.step}/3</span>
            </div>
          </div>
          {battlePresentation && (
            <div className={`battle-result ${battlePresentation.rolling ? "battle-result--rolling" : ""}`}>
              <small>{battlePresentation.rolling ? "Los dados están rodando…" : "Resultado de la batalla"}</small>
              <div className="battle-result-countries">
                <strong>{COUNTRIES[battlePresentation.battle.from].name}</strong>
                <span>contra</span>
                <strong>{COUNTRIES[battlePresentation.battle.to].name}</strong>
              </div>
              <div className="dice-score">
                <div>
                  {battlePresentation.battle.attackerDice.map((die, index) => (
                    <i style={{ animationDelay: `${index * 70}ms` }} key={`attacker-${index}`}>{diceFaces[die - 1]}</i>
                  ))}
                </div>
                <b>⚔</b>
                <div>
                  {battlePresentation.battle.defenderDice.map((die, index) => (
                    <i style={{ animationDelay: `${index * 70 + 40}ms` }} key={`defender-${index}`}>{diceFaces[die - 1]}</i>
                  ))}
                </div>
              </div>
              {!battlePresentation.rolling && (
                <p>
                  Atacante −{battlePresentation.battle.attackerLosses} · Defensor −{battlePresentation.battle.defenderLosses}
                  {battlePresentation.battle.conquered ? " · Territorio conquistado" : ""}
                </p>
              )}
            </div>
          )}
          {error && <button className="error-banner error-banner--floating" onClick={() => setError("")}>{error} ×</button>}
          {game.status === "finished" && (
            <div className="victory-overlay">
              <div className="panel">
                <span className="victory-crown">♛</span>
                <p className="eyebrow">Victoria</p>
                <h2>{winner?.name}</h2>
                <p>{game.winnerReason}</p>
                <button className="button" onClick={() => onExit(true)}>Salir de la partida</button>
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
            <section className={`order-quickbar order-quickbar--${phase.kind}`} aria-label="Acciones del turno">
              <div className="order-quickbar-status">
                <small>{phaseText[game.phase]}</small>
                <strong>
                  {!isMyTurn
                    ? `Esperando a ${active?.name ?? "otro jugador"}`
                    : ["setup-5", "setup-3", "reinforce"].includes(game.phase)
                      ? game.reinforcements > 0 ? `${game.reinforcements} por ubicar` : "Listo para confirmar"
                      : game.phase === "attack"
                        ? selectedName || "Elegí atacante"
                        : game.phase === "regroup"
                          ? regroupDraft ? "Movimiento preparado" : selectedName || "Elegí origen"
                          : game.phase === "occupy"
                            ? "Elegí cuántos mover"
                            : "Turno finalizado"}
                </strong>
              </div>
              <div className="order-quickbar-actions">
                {["setup-5", "setup-3", "reinforce"].includes(game.phase) && (
                  <>
                    <button
                      className="button button--secondary button--compact"
                      disabled={!isMyTurn || game.placementHistory.length === 0}
                      onClick={() => dispatch({ type: "undo-place" })}
                    >
                      ↶ Deshacer
                    </button>
                    <button
                      className="button button--compact"
                      disabled={!isMyTurn || game.reinforcements > 0}
                      onClick={() => dispatch({ type: "confirm-placement" })}
                    >
                      Confirmar
                    </button>
                  </>
                )}
                {game.phase === "attack" && (
                  <button
                    className="button button--secondary button--compact"
                    disabled={!isMyTurn}
                    onClick={() => dispatch({ type: "end-attack" })}
                  >
                    Finalizar ataques
                  </button>
                )}
                {game.phase === "regroup" && regroupDraft && (
                  <>
                    <button
                      className="button button--compact"
                      disabled={!isMyTurn}
                      onClick={() => dispatch({
                        type: "regroup",
                        from: regroupDraft.from,
                        to: regroupDraft.to,
                        count: regroupCount
                      })}
                    >
                      Mover {regroupCount}
                    </button>
                    <button
                      className="button button--secondary button--compact"
                      onClick={() => {
                        setRegroupDraft(null);
                        setSelected(null);
                      }}
                    >
                      Cancelar
                    </button>
                  </>
                )}
                {game.phase === "regroup" && !regroupDraft && (
                  <button
                    className="button button--compact"
                    disabled={!isMyTurn}
                    onClick={() => dispatch({ type: "end-turn" })}
                  >
                    Finalizar turno
                  </button>
                )}
              </div>
            </section>
          )}

          {tab === "ordenes" && game.phase === "occupy" && game.pendingConquest && (
            <section className="order-focus order-focus--occupy" aria-label="Elegir ejércitos de ocupación">
              <div className="occupation-choice">
                <p>
                  Conquistaste <strong>{COUNTRIES[game.pendingConquest.to].name}</strong>. Pasá ejércitos desde{" "}
                  <strong>{COUNTRIES[game.pendingConquest.from].name}</strong>.
                </p>
                <div className="choice-buttons">
                  {Array.from(
                    { length: game.pendingConquest.maximum - game.pendingConquest.minimum + 1 },
                    (_, index) => game.pendingConquest!.minimum + index
                  ).map((count) => (
                    <button className="button" disabled={!isMyTurn} key={count} onClick={() => dispatch({ type: "occupy", count })}>
                      Mover {count}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          )}

          {tab === "ordenes" && game.phase === "regroup" && regroupDraft && (
            <section className="order-focus order-focus--regroup" aria-label="Elegir ejércitos para reagrupar">
              <div className="regroup-choice">
                <strong>{COUNTRIES[regroupDraft.from].name} → {COUNTRIES[regroupDraft.to].name}</strong>
                <label>
                  <span>Cantidad: <b>{regroupCount}</b></span>
                  <input
                    type="range"
                    min="1"
                    max={regroupDraft.maximum}
                    value={regroupCount}
                    onChange={(event) => setRegroupCount(Number(event.target.value))}
                  />
                </label>
              </div>
            </section>
          )}

          {tab === "ordenes" && (
            <div className="command-content command-content--orders">
              <div className="order-phase-heading">
                <p className="eyebrow">{isMyTurn ? "Tu turno" : `Turno de ${active?.name}`}</p>
                <h2>{phaseText[game.phase]}</h2>
              </div>
              {["setup-5", "setup-3", "reinforce"].includes(game.phase) && (
                <>
                  <div className="army-count"><strong>{game.reinforcements}</strong><span>ejércitos por ubicar</span></div>
                  {game.phase === "reinforce" && (
                    <div className="reinforcement-pools">
                      <button
                        className={reinforcementSource === "base" ? "active" : ""}
                        disabled={game.baseReinforcements < 1}
                        onClick={() => setReinforcementSource("base")}
                      >
                        <strong>{game.baseReinforcements}</strong>
                        <span>Libres<small>Cualquier territorio propio</small></span>
                      </button>
                      {Object.entries(game.continentReinforcements)
                        .filter(([, count]) => (count ?? 0) > 0)
                        .map(([continentId, count]) => (
                          <button
                            className={reinforcementSource === continentId ? "active" : ""}
                            key={continentId}
                            onClick={() => setReinforcementSource(continentId as ContinentId)}
                          >
                            <strong>{count}</strong>
                            <span>
                              {CONTINENTS[continentId as ContinentId].name}
                              <small>Solo dentro del continente</small>
                            </span>
                          </button>
                        ))}
                    </div>
                  )}
                  <p>
                    Tocá un territorio propio para colocar una ficha
                    {game.phase === "reinforce" && reinforcementSource !== "base"
                      ? ` del bonus de ${CONTINENTS[reinforcementSource].name}.`
                      : " libre."}
                  </p>
                </>
              )}
              {game.phase === "attack" && (
                <>
                  <p>Elegí un territorio propio y luego uno enemigo limítrofe. Los dados se tiran automáticamente.</p>
                  {selected !== null && <div className="selection-card">Atacante: <strong>{selectedName}</strong></div>}
                </>
              )}
              {game.phase === "occupy" && (
                <p>Debés dejar al menos un ejército en el territorio de origen. El movimiento se realiza al tocar una cantidad.</p>
              )}
              {game.phase === "regroup" && (
                <p>Elegí origen y destino. Podés mover todos los ejércitos disponibles, dejando uno en origen. Una ficha movida no puede volver a moverse este turno.</p>
              )}
              <div className="mission-scroll">
                <span>Objetivo secreto</span>
                <p>{missionText(me?.missionId ?? "hidden")}</p>
              </div>
              <label className="toggle-row">
                <input type="checkbox" checked={colorBlind} onChange={(event) => setColorBlind(event.target.checked)} />
                <span>Identificar colores con letras</span>
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
              {game.phase === "reinforce" && isMyTurn && validCardSet && (
                <p className={myCards.length >= 5 ? "card-warning" : "muted"}>
                  {myCards.length >= 5
                    ? "Tenés 5 tarjetas. Elegí tres válidas para canjear; mientras conserves cinco no recibirás otra."
                    : "Podés seleccionar manualmente tres iguales o tres diferentes."}
                </p>
              )}
              <div className="card-list">
                {myCards.map((card) => (
                  <button
                    type="button"
                    className={`country-card ${selectedCardIds.includes(card.countryId) ? "country-card--selected" : ""}`}
                    disabled={game.phase !== "reinforce" || !isMyTurn}
                    key={card.countryId}
                    onClick={() => setSelectedCardIds((current) => {
                      if (current.includes(card.countryId)) return current.filter((id) => id !== card.countryId);
                      if (current.length >= 3) return current;
                      return [...current, card.countryId];
                    })}
                  >
                    <span>{card.symbol === "cañón" ? "☄" : card.symbol === "galeón" ? "⛵" : card.symbol === "globo" ? "◉" : "★"}</span>
                    <strong>{COUNTRIES[card.countryId].name}</strong>
                    <small>{card.symbol} · {card.used ? "premio usado" : "premio disponible"}</small>
                  </button>
                ))}
                {!myCards.length && <p className="muted">Todavía no obtuviste tarjetas.</p>}
              </div>
              {game.phase === "reinforce" && isMyTurn && validCardSet && (
                <button
                  className="button"
                  disabled={!selectedExchangeValid}
                  onClick={() => dispatch({ type: "exchange", cardCountryIds: selectedCardIds })}
                >
                  {selectedCardIds.length === 3
                    ? selectedExchangeValid ? `Canjear por ${nextExchangeValue} ejércitos` : "La combinación no es válida"
                    : `Seleccioná 3 tarjetas (${selectedCardIds.length}/3)`}
                </button>
              )}
            </div>
          )}

          {tab === "chat" && (
            <div className="command-content chat-panel">
              <section className="chat-toolbar" aria-label="Chat y audio">
                <span
                  className={`chat-connection chat-connection--${chatStatus}`}
                  title={chatStatus === "connected" ? "Chat conectado" : chatStatus === "sending" ? "Enviando…" : chatStatus === "connecting" ? "Conectando…" : "Chat desconectado"}
                >
                  <i /> Chat
                </span>
                <button
                  className={voiceStatus === "active" ? "active" : ""}
                  disabled={local || !me || voiceStatus === "connecting"}
                  onClick={() => voiceStatus === "active" ? stopVoice() : void startVoice()}
                  aria-pressed={voiceStatus === "active"}
                  title={local ? "Disponible en partidas online" : voiceStatus === "active" ? `${Object.keys(voicePeers).length + 1} conectados · tocar para salir` : "Activar chat de voz"}
                >
                  <i className={`voice-icon ${voiceStatus === "active" ? "voice-icon--stop" : ""}`}>
                    {voiceStatus === "connecting" ? "…" : "🎙"}
                  </i>
                  <span>Voz</span>
                </button>
                <button className={soundOn ? "active" : ""} onClick={() => setSoundOn((current) => !current)} aria-pressed={soundOn} title="Efectos de sonido">
                  {soundOn ? "🔊" : "🔇"} <span>Efectos</span>
                </button>
                <button className={musicOn ? "active" : ""} onClick={toggleMusic} aria-pressed={musicOn} title="Música">
                  {musicOn ? "♫" : "♩"} <span>Música</span>
                </button>
              </section>
              <div className="chat-messages">
                {[...game.messages.slice(-60)].reverse().map((message) => (
                  <div className={message.system ? "chat-message chat-message--system" : "chat-message"} key={message.id}>
                    <strong>{message.playerName}</strong><p>{message.text}</p>
                  </div>
                ))}
                {!game.messages.length && <p className="chat-empty">Todavía no hay mensajes.</p>}
              </div>
              {!local && me && (
                <form className="chat-form" onSubmit={(event) => { event.preventDefault(); sendChat(); }}>
                  <input value={chat} onChange={(event) => setChat(event.target.value)} placeholder="Escribí al consejo…" maxLength={400} />
                  <button disabled={chatStatus !== "connected" || !chat.trim()}>Enviar</button>
                </form>
              )}
              {!local && !me && <p className="chat-readonly">Estás observando la partida. Los espectadores pueden leer, pero no escribir.</p>}
              {local && <p className="chat-readonly">El chat está disponible únicamente en partidas online.</p>}
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
