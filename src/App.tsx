import { useEffect, useState } from "react";
import { addPlayer, createGame, startGame } from "@shared/game";
import type { ChatMessage, GameSettings, GameState, PublicGameSummary, Session } from "@shared/types";
import { api, type AdminUser, type FriendsState, type GameInvite } from "./api";
import { Coat } from "./components/Coat";
import { GameView } from "./components/GameView";

const avatars = ["⚔️", "🛡️", "🏰", "🐉", "🦅", "🦁"];

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function savedSession(): Session | null {
  try {
    return JSON.parse(localStorage.getItem("reinos-session") || "null");
  } catch {
    return null;
  }
}

function savedLocalGame(): GameState | null {
  try {
    return JSON.parse(localStorage.getItem("reinos-local-game") || "null");
  } catch {
    return null;
  }
}

export default function App() {
  const [session, setSession] = useState<Session | null>(savedSession);
  const [game, setGame] = useState<GameState | null>(null);
  const [localMode, setLocalMode] = useState(false);
  const [page, setPage] = useState<"home" | "create" | "local" | "admin" | "legal">("home");
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() =>
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone)
  );

  useEffect(() => {
    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const markInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    window.addEventListener("appinstalled", markInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
      window.removeEventListener("appinstalled", markInstalled);
    };
  }, []);

  const installApp = async () => {
    if (!installPrompt) return false;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setInstalled(true);
      setInstallPrompt(null);
      return true;
    }
    return false;
  };

  const exitGame = (finished = false) => {
    if (finished) localStorage.removeItem("reinos-local-game");
    setGame(null);
    setLocalMode(false);
    setPage("home");
    if (finished && session && !session.registered) {
      localStorage.removeItem("reinos-session");
      void api.deleteGuestSession(session.id).catch(() => undefined);
      setSession(null);
    }
  };

  if (!session) return <Welcome installed={installed} canInstall={Boolean(installPrompt)} onInstall={installApp} onReady={(next) => {
    localStorage.setItem("reinos-session", JSON.stringify(next));
    setSession(next);
  }} />;

  if (game) return <GameView initialGame={game} session={session} local={localMode} onExit={exitGame} />;

  if (page === "create") return <CreateOnline session={session} onBack={() => setPage("home")} onCreated={setGame} />;
  if (page === "local") return <CreateLocal session={session} onBack={() => setPage("home")} onCreated={(next) => {
    setLocalMode(true);
    setGame(next);
  }} />;
  if (page === "admin") return <Admin onBack={() => setPage("home")} />;
  if (page === "legal") return <Legal onBack={() => setPage("home")} />;

  return <Home
    session={session}
    onGame={setGame}
    onResumeLocal={() => {
      const saved = savedLocalGame();
      if (saved) {
        setLocalMode(true);
        setGame(saved);
      }
    }}
    onNavigate={setPage}
    installed={installed}
    canInstall={Boolean(installPrompt)}
    onInstall={installApp}
    onLogout={() => {
    localStorage.removeItem("reinos-session");
    setSession(null);
  }} />;
}

function Welcome({
  onReady,
  installed,
  canInstall,
  onInstall
}: {
  onReady: (session: Session) => void;
  installed: boolean;
  canInstall: boolean;
  onInstall: () => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(avatars[0]);
  const [error, setError] = useState("");
  const enter = async () => {
    try {
      setError("");
      onReady(await api.session(name, avatar));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo ingresar.");
    }
  };
  return (
    <main className="welcome-screen">
      <div className="torch torch--left" />
      <div className="torch torch--right" />
      <section className="welcome-card">
        <Coat />
        <p className="eyebrow">Táctica · Diplomacia · Conquista</p>
        <h1>TEG<br /><span>Online</span></h1>
        <p className="welcome-copy">Reuní a tu consejo, desplegá tus ejércitos y conquistá el mundo.</p>
        <label className="field">
          <span>Nombre del comandante</span>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={24} placeholder="Tu nombre" />
        </label>
        <div className="avatar-picker">
          {avatars.map((item) => <button key={item} className={item === avatar ? "active" : ""} onClick={() => setAvatar(item)}>{item}</button>)}
        </div>
        <button className="button button--large" onClick={enter} disabled={name.trim().length < 2}>Entrar como invitado</button>
        {!installed && <InstallAppButton canInstall={canInstall} onInstall={onInstall} />}
        <div className="social-row">
          <button disabled title="Se activa al configurar credenciales">G Google</button>
          <button disabled title="Se activa al configurar credenciales">f Facebook</button>
        </div>
        <small>Al continuar aceptás las reglas de convivencia de la mesa.</small>
        {error && <div className="error-banner">{error}</div>}
      </section>
    </main>
  );
}

function Home({
  session,
  onGame,
  onResumeLocal,
  onNavigate,
  installed,
  canInstall,
  onInstall,
  onLogout
}: {
  session: Session;
  onGame: (game: GameState) => void;
  onResumeLocal: () => void;
  onNavigate: (page: "create" | "local" | "admin" | "legal") => void;
  installed: boolean;
  canInstall: boolean;
  onInstall: () => Promise<boolean>;
  onLogout: () => void;
}) {
  const [games, setGames] = useState<PublicGameSummary[]>([]);
  const [friends, setFriends] = useState<FriendsState>({ accepted: [], incoming: [], outgoing: [] });
  const [invites, setInvites] = useState<GameInvite[]>([]);
  const [friendName, setFriendName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const hasSavedLocal = Boolean(savedLocalGame());
  const refresh = () => api.publicGames().then(setGames).catch(() => setGames([]));
  useEffect(() => {
    void refresh();
    void api.friends(session.id).then(setFriends).catch(() => undefined);
    void api.invites(session.id).then(setInvites).catch(() => undefined);
  }, [session.id]);

  return (
    <main className="hall-screen">
      <header className="hall-header">
        <div className="brand-lockup"><Coat small /><span><strong>TEG Online</strong><small>Táctica y Estrategia de Guerra</small></span></div>
        <div className="hall-header-actions">
          {!installed && <InstallAppButton canInstall={canInstall} onInstall={onInstall} compact />}
          <button className="profile-button" onClick={onLogout}><span>{session.avatar}</span>{session.name} · Salir</button>
        </div>
      </header>
      <section className="hero-banner">
        <div>
          <p className="eyebrow">El mundo aguarda</p>
          <h1>¿Cuál será tu próxima conquista?</h1>
          <p>Creá una mesa, uníte a tus aliados o librá una campaña en este dispositivo.</p>
        </div>
        <span className="hero-knight">♞</span>
      </section>
      <section className="action-grid">
        <button className="action-card action-card--gold" onClick={() => onNavigate("create")}>
          <span>⚔</span><strong>Crear partida</strong><small>Pública o privada, hasta 6 jugadores</small>
        </button>
        <div className="action-card join-card">
          <span>🔑</span><strong>Unirse con código</strong>
          <div><input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="CÓDIGO" maxLength={6} />
            <button onClick={async () => {
              try {
                setError("");
                onGame(await api.joinGame(code, session));
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : "No se pudo ingresar.");
              }
            }}>Entrar</button></div>
        </div>
        <button className="action-card" onClick={() => onNavigate("local")}>
          <span>🏰</span><strong>Partida local</strong><small>Pasen el dispositivo; funciona sin conexión</small>
        </button>
        {hasSavedLocal && (
          <button className="action-card" onClick={onResumeLocal}>
            <span>📜</span><strong>Continuar partida local</strong><small>Retomá la campaña guardada en este dispositivo</small>
          </button>
        )}
      </section>
      {error && <div className="error-banner">{error}</div>}
      {invites.length > 0 && (
        <section className="invite-section">
          <div className="section-title"><div><p className="eyebrow">Mensajeros</p><h2>Invitaciones pendientes</h2></div></div>
          <div className="game-list">
            {invites.map((invite) => (
              <article className="game-row" key={invite.id}>
                <div><strong>{invite.gameName}</strong><small>{invite.fromName} te invitó a su mesa</small></div>
                <button className="button button--small" onClick={async () => {
                  try {
                    const accepted = await api.acceptInvite(invite.id, session.id);
                    onGame(await api.joinGame(accepted.code, session));
                  } catch (caught) {
                    setError(caught instanceof Error ? caught.message : "La invitación ya no está disponible.");
                  }
                }}>Aceptar</button>
              </article>
            ))}
          </div>
        </section>
      )}
      <section className="public-section">
        <div className="section-title"><div><p className="eyebrow">Mesas abiertas</p><h2>Partidas públicas</h2></div><button className="text-button" onClick={refresh}>Actualizar</button></div>
        <div className="game-list">
          {games.map((item) => (
            <article className="game-row" key={item.id}>
              <div><strong>{item.name}</strong><small>{item.players}/{item.maxPlayers} comandantes · {item.turnSeconds}s por turno · {item.status === "playing" ? "En juego" : "Esperando"}</small></div>
              <button className="button button--small" onClick={async () => {
                try { onGame(await api.joinGame(item.code, session)); }
                catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo ingresar."); }
              }}>{item.status === "playing" ? "Observar" : "Unirse"}</button>
            </article>
          ))}
          {!games.length && <div className="empty-state"><span>⚑</span><p>No hay mesas públicas esperando jugadores.</p></div>}
        </div>
      </section>
      <section className="friends-section">
        <div className="section-title"><div><p className="eyebrow">Alianzas</p><h2>Compañeros</h2></div></div>
        <div className="friends-layout">
          <div className="friend-add">
            <input value={friendName} onChange={(event) => setFriendName(event.target.value)} placeholder="Nombre exacto del comandante" />
            <button className="button button--small" onClick={async () => {
              try {
                setFriends(await api.requestFriend(session.id, friendName));
                setFriendName("");
                setError("");
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : "No se pudo enviar la solicitud.");
              }
            }}>Agregar</button>
          </div>
          <div className="friend-list">
            {friends.incoming.map((friend) => (
              <article className="friend-row" key={`incoming-${friend.id}`}>
                <span>{friend.avatar}</span><strong>{friend.name}</strong><small>Quiere agregarte</small>
                <button onClick={async () => setFriends(await api.acceptFriend(session.id, friend.id))}>Aceptar</button>
              </article>
            ))}
            {friends.accepted.map((friend) => (
              <article className="friend-row" key={friend.id}>
                <span>{friend.avatar}</span><strong>{friend.name}</strong><small>Compañero</small>
              </article>
            ))}
            {friends.outgoing.map((friend) => (
              <article className="friend-row friend-row--muted" key={`outgoing-${friend.id}`}>
                <span>{friend.avatar}</span><strong>{friend.name}</strong><small>Solicitud enviada</small>
              </article>
            ))}
            {!friends.accepted.length && !friends.incoming.length && !friends.outgoing.length && <p className="muted">Todavía no agregaste compañeros.</p>}
          </div>
        </div>
      </section>
      <footer className="hall-footer"><span><button onClick={() => onNavigate("admin")}>Administración</button><button onClick={() => onNavigate("legal")}>Privacidad y términos</button></span><span>Argentina · Español</span></footer>
    </main>
  );
}

function InstallAppButton({
  canInstall,
  onInstall,
  compact = false
}: {
  canInstall: boolean;
  onInstall: () => Promise<boolean>;
  compact?: boolean;
}) {
  const [showHelp, setShowHelp] = useState(false);
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);

  return (
    <>
      <button
        className={compact ? "install-button install-button--compact" : "install-button"}
        onClick={async () => {
          if (canInstall && await onInstall()) return;
          setShowHelp(true);
        }}
      >
        <span>⬇</span>
        <strong>Instalar app</strong>
        {!compact && <small>Agregar TEG Online al teléfono</small>}
      </button>
      {showHelp && (
        <div className="install-overlay" role="dialog" aria-modal="true" aria-labelledby="install-title">
          <section className="panel install-dialog">
            <button className="install-dialog-close" onClick={() => setShowHelp(false)} aria-label="Cerrar">×</button>
            <span className="install-app-icon">⬇</span>
            <p className="eyebrow">Aplicación web</p>
            <h2 id="install-title">Instalar TEG Online</h2>
            {isIos ? (
              <ol>
                <li>Abrí este enlace con <strong>Safari</strong>.</li>
                <li>Tocá <strong>Compartir</strong> ⬆.</li>
                <li>Elegí <strong>Agregar a pantalla de inicio</strong>.</li>
              </ol>
            ) : (
              <ol>
                <li>Abrí este enlace con <strong>Chrome</strong>.</li>
                <li>Tocá el menú <strong>⋮</strong>.</li>
                <li>Elegí <strong>Instalar aplicación</strong> o <strong>Agregar a pantalla principal</strong>.</li>
              </ol>
            )}
            <p className="install-note">No se descarga un APK: se instala directamente desde el navegador.</p>
            <button className="button button--large" onClick={() => setShowHelp(false)}>Entendido</button>
          </section>
        </div>
      )}
    </>
  );
}

function CreateOnline({ session, onBack, onCreated }: { session: Session; onBack: () => void; onCreated: (game: GameState) => void }) {
  const [name, setName] = useState("Conquista del sábado");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [turnSeconds, setTurnSeconds] = useState(120);
  const [spectators, setSpectators] = useState(true);
  const [error, setError] = useState("");
  return (
    <main className="form-page page-shell">
      <button className="text-button" onClick={onBack}>← Volver</button>
      <section className="panel form-card">
        <p className="eyebrow">Nueva campaña</p><h1>Preparar mesa online</h1>
        <label className="field"><span>Nombre de la partida</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <div className="segmented"><button className={visibility === "public" ? "active" : ""} onClick={() => setVisibility("public")}>Pública</button><button className={visibility === "private" ? "active" : ""} onClick={() => setVisibility("private")}>Privada</button></div>
        <label className="field"><span>Jugadores: {maxPlayers}</span><input type="range" min="2" max="6" value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))} /></label>
        <label className="field"><span>Tiempo por turno</span><select value={turnSeconds} onChange={(e) => setTurnSeconds(Number(e.target.value))}><option value="60">60 segundos</option><option value="90">90 segundos</option><option value="120">120 segundos</option><option value="180">180 segundos</option></select></label>
        <label className="toggle-row"><input type="checkbox" checked={spectators} onChange={(e) => setSpectators(e.target.checked)} /><span>Permitir espectadores</span></label>
        <button className="button button--large" onClick={async () => {
          try {
            const settings: GameSettings = { visibility, maxPlayers, turnSeconds, spectators, defensiveExchange: false };
            onCreated(await api.createGame(name, session, settings));
          } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo crear."); }
        }}>Crear mesa</button>
        {error && <div className="error-banner">{error}</div>}
      </section>
    </main>
  );
}

function CreateLocal({ session, onBack, onCreated }: { session: Session; onBack: () => void; onCreated: (game: GameState) => void }) {
  const [count, setCount] = useState(4);
  const [humans, setHumans] = useState(2);
  const [names, setNames] = useState([session.name, "Comandante 2", "Comandante 3", "Comandante 4", "Comandante 5", "Comandante 6"]);
  return (
    <main className="form-page page-shell">
      <button className="text-button" onClick={onBack}>← Volver</button>
      <section className="panel form-card">
        <p className="eyebrow">Un solo dispositivo</p><h1>Campaña local</h1>
        <label className="field"><span>Participantes totales: {count}</span><input type="range" min="2" max="6" value={count} onChange={(e) => { const value = Number(e.target.value); setCount(value); setHumans(Math.min(humans, value)); }} /></label>
        <label className="field"><span>Jugadores humanos: {humans}</span><input type="range" min="1" max={count} value={humans} onChange={(e) => setHumans(Number(e.target.value))} /></label>
        <div className="local-names">
          {Array.from({ length: humans }, (_, index) => <label className="field" key={index}><span>Comandante {index + 1}</span><input value={names[index]} onChange={(e) => setNames((current) => current.map((item, i) => i === index ? e.target.value : item))} /></label>)}
        </div>
        <button className="button button--large" onClick={() => {
          const host: Session = { ...session, id: "local-0" };
          const settings: GameSettings = { visibility: "local", maxPlayers: count, turnSeconds: 120, spectators: false, defensiveExchange: false };
          const localGame = createGame({ name: "Campaña local", host, settings });
          localGame.players[0].name = names[0];
          for (let index = 1; index < count; index += 1) {
            addPlayer(localGame, {
              id: index < humans ? `local-${index}` : undefined,
              name: index < humans ? names[index] : `Bot ${index - humans + 1}`,
              isBot: index >= humans
            });
          }
          startGame(localGame);
          onCreated(localGame);
        }}>Comenzar campaña</button>
      </section>
    </main>
  );
}

function Admin({ onBack }: { onBack: () => void }) {
  const [pin, setPin] = useState("");
  const [data, setData] = useState<{ users: AdminUser[]; games: PublicGameSummary[] } | null>(null);
  const [messages, setMessages] = useState<{ gameName: string; items: ChatMessage[] } | null>(null);
  const [error, setError] = useState("");
  const load = async () => {
    setData(await api.adminOverview(pin));
    setError("");
  };
  return (
    <main className="form-page page-shell">
      <button className="text-button" onClick={onBack}>← Volver</button>
      <section className="panel admin-card">
        <p className="eyebrow">Control del reino</p><h1>Administración</h1>
        {!data ? (
          <>
            <label className="field"><span>PIN de administrador</span><input type="password" value={pin} onChange={(e) => setPin(e.target.value)} /></label>
            <button className="button" onClick={async () => {
              try { await load(); }
              catch (caught) { setError(caught instanceof Error ? caught.message : "Acceso denegado."); }
            }}>Ingresar</button>
          </>
        ) : (
          <div className="admin-stats">
            <div><strong>{data.users.length}</strong><span>usuarios</span></div>
            <div><strong>{data.games.length}</strong><span>partidas</span></div>
            <section className="admin-table">
              <h2>Usuarios</h2>
              {data.users.map((user) => (
                <article key={user.id}>
                  <span>{user.avatar}</span>
                  <div><strong>{user.name}</strong><small>{user.games_won} victorias · {user.games_played} partidas</small></div>
                  <button className="button button--small" onClick={async () => {
                    await api.blockUser(pin, user.id, !user.blocked);
                    await load();
                  }}>{user.blocked ? "Desbloquear" : "Bloquear"}</button>
                </article>
              ))}
            </section>
            <section className="admin-table">
              <h2>Partidas</h2>
              {data.games.map((game) => (
                <article key={game.id}>
                  <div><strong>{game.name}</strong><small>{game.players}/{game.maxPlayers} · {game.status}</small></div>
                  <button className="button button--small" onClick={async () => setMessages({ gameName: game.name, items: await api.gameMessages(pin, game.id) })}>Chat</button>
                  {game.status !== "finished" && <button className="button button--small" onClick={async () => {
                    await api.closeGame(pin, game.id);
                    await load();
                  }}>Cerrar</button>}
                </article>
              ))}
            </section>
            {messages && (
              <section className="admin-messages">
                <div><h2>Chat: {messages.gameName}</h2><button onClick={() => setMessages(null)}>Cerrar</button></div>
                {messages.items.map((message) => <p key={message.id}><strong>{message.playerName}:</strong> {message.text}</p>)}
                {!messages.items.length && <p>No hay mensajes.</p>}
              </section>
            )}
          </div>
        )}
        {error && <div className="error-banner">{error}</div>}
      </section>
    </main>
  );
}

function Legal({ onBack }: { onBack: () => void }) {
  return (
    <main className="form-page page-shell">
      <button className="text-button" onClick={onBack}>← Volver</button>
      <article className="panel legal-card">
        <p className="eyebrow">Información legal mínima</p>
        <h1>Privacidad y términos</h1>
        <h2>Uso del juego</h2>
        <p>El servicio es gratuito y está destinado a partidas recreativas. No se permiten nombres, mensajes o conductas ilegales, abusivas o destinadas a perjudicar el funcionamiento de las partidas.</p>
        <h2>Datos guardados</h2>
        <p>Se almacenan el nombre elegido, avatar, partidas, estadísticas, amistades y mensajes necesarios para operar el juego. Las partidas locales se guardan únicamente en el dispositivo. No se venden datos personales.</p>
        <h2>Conservación y control</h2>
        <p>El administrador puede cerrar partidas o bloquear usuarios. El titular puede solicitar la eliminación de su cuenta y datos al administrador de la instalación.</p>
        <h2>Edad y responsabilidad</h2>
        <p>La plataforma no está diseñada específicamente para menores. Los responsables de la instalación y de cada dispositivo deben supervisar su uso cuando corresponda.</p>
        <p className="legal-date">Versión vigente: 20 de junio de 2026.</p>
      </article>
    </main>
  );
}
