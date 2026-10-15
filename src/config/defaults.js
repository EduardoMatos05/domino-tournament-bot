// Cantidad de cuentas que maneja el bot: un número par de 2 a 16 (por defecto 8).
// Una mesa es de 4 jugadores y un certamen online usa 8, 12 o 16; lo que el bot no cubra lo ocupan otras personas.
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 16;
export const DEFAULT_PLAYER_COUNT = 8;
export const isValidPlayerCount = (n) => Number.isInteger(n) && n % 2 === 0 && n >= MIN_PLAYERS && n <= MAX_PLAYERS;

export const SPEED = { min: 0.5, max: 4.0, step: 0.1, default: 2.0 };
// Variación aleatoria (±) aplicada a la espera antes de cada jugada.
export const SPEED_JITTER = 0.2;

export const USERNAME_PATTERN = /^[A-Za-z0-9]{1,8}$/; // el login del juego recorta a 8 alfanuméricos

export const POLL_MS = 500; // cada cuánto un bot mira el estado real de la app (portal)
export const ROOM_POLL_MS = 150; // dentro de una mesa se mira más seguido para notar el turno casi al instante
export const LOGIN_TIMEOUT_MS = 30_000;
export const PREPARE_MS = 150; // margen para releer la mano antes de que se cumpla la espera
export const MOVE_SETTLE_MS = 250; // espera tras el click para ver si salió un alert o el modal de lado
export const MOVE_CONFIRM_TIMEOUT_MS = 4_000; // espera a que la ficha salga de la mano
export const TERMINAL_CONFIRMATIONS = 3; // sondeos seguidos para dar por cierto fin/cancelación del torneo

// El juego cierra la sesión tras 10 min sin eventos de puntero/teclado.
export const KEEPALIVE_MS = 4 * 60_000;
// El JWT dura 1 h y solo se renueva al recargar la página.
export const PORTAL_RELOAD_MS = 40 * 60_000;
export const LOBBY_CLOSED_RELOAD_MS = 60_000; // el portal no se actualiza solo cuando aún no abre

// Si el servidor no acepta una jugada que la pantalla sí aceptó, se espera cada vez más antes de reintentar.
export const UNCONFIRMED_BACKOFF_MS = [1_000, 2_000, 3_000, 5_000];
// Si pasa este tiempo sin ninguna línea de log de un jugador, se escribe una línea de "sigue vivo".
export const HEARTBEAT_LOG_MS = 120_000;

export const MAX_RELOGINS = 5;
export const MAX_CONSECUTIVE_ERRORS = 10;

// Desconexiones programadas (sección "Disconnect bots").
export const MAX_GAME_NUMBER = 99; // tope de los cuadros de certamen/concurso y partida
export const GAME_INFO_WAIT_MS = 5_000; // en la mesa de espera, cuánto esperar a leer qué partida es antes de confirmar igual
export const ALONE_RECONNECT_MS = 60_000; // si ningún otro bot mira el torneo, cada cuánto vuelve uno desconectado a revisarlo

export const WINDOW = { width: 800, height: 600 };
export const LANGUAGE = "es"; // los selectores dependen de textos en español
export const LAUNCH_STAGGER_MS = 1_500;

export const UI_PORT = Number(process.env.BOT_UI_PORT) || 4173;
