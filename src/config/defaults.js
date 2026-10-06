// Un certamen online necesita 8 jugadores (el engine solo tiene mesas para 8, 12 y 16); 4 sirve para pruebas.
export const PLAYER_COUNTS = [4, 8];
export const MAX_PLAYERS = Math.max(...PLAYER_COUNTS);
export const DEFAULT_PLAYER_COUNT = 8;

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

export const MAX_RELOGINS = 5;
export const MAX_CONSECUTIVE_ERRORS = 10;

export const WINDOW = { width: 800, height: 600 };
export const LANGUAGE = "es"; // los selectores dependen de textos en español
export const LAUNCH_STAGGER_MS = 1_500;

export const UI_PORT = Number(process.env.BOT_UI_PORT) || 4173;
