import { TEXT } from "./selectors.js";

export const KIND = {
	LOGGED_OUT: "LOGGED_OUT",
	// portal de comunicación
	LOADING: "LOADING", // la página aún no pintó nada: no cambia ni se registra nada
	LOBBY_CLOSED: "LOBBY_CLOSED",
	WAITING_MATCH: "WAITING_MATCH",
	TOURNAMENT_FINISHED: "TOURNAMENT_FINISHED",
	TOURNAMENT_CANCELLED: "TOURNAMENT_CANCELLED",
	// mesa
	CONFIRM_ATTENDANCE: "CONFIRM_ATTENDANCE",
	HAND_ENDED: "HAND_ENDED",
	GAME_ENDED: "GAME_ENDED",
	PAUSED: "PAUSED",
	PRE_START: "PRE_START",
	MY_TURN: "MY_TURN",
	OPPONENT_TURN: "OPPONENT_TURN",
	ROOM_LOADING: "ROOM_LOADING",
	// cualquier otra pantalla (/competitor, clasificación...)
	OTHER: "OTHER",
};

const IN_ROOM = /\/room\/([^/?#]+)/;

/**
 * Función pura: snapshot del DOM -> estado real de la aplicación.
 * No usa esperas ni suposiciones de tiempo.
 */
export function classify(s) {
	if (/\/(login|logout)\/?$/.test(s.path)) return { kind: KIND.LOGGED_OUT };

	const room = IN_ROOM.exec(s.path)?.[1];
	if (room) return classifyRoom(s, decodeURIComponent(room));

	if (/portal-comunicacion/.test(s.path)) {
		if (s.text.includes(TEXT.tournamentFinished)) return { kind: KIND.TOURNAMENT_FINISHED };
		if (s.text.includes(TEXT.tournamentCancelled)) return { kind: KIND.TOURNAMENT_CANCELLED };
		if (s.text.includes(TEXT.lobbyClosed)) return { kind: KIND.LOBBY_CLOSED };
		if (s.text.trim().length < 40) return { kind: KIND.LOADING };
		return { kind: KIND.WAITING_MATCH };
	}

	return { kind: KIND.OTHER };
}

function classifyRoom(s, room) {
	const headers = s.modalHeaders;
	if (s.text.includes(TEXT.paused)) return { kind: KIND.PAUSED, room };
	if (headers.some((h) => h.includes(TEXT.confirmAttendance))) {
		return { kind: KIND.CONFIRM_ATTENDANCE, room };
	}
	if (headers.some((h) => TEXT.handEnded.test(h))) return { kind: KIND.HAND_ENDED, room };
	if (headers.some((h) => h.includes(TEXT.gameEnded))) return { kind: KIND.GAME_ENDED, room };
	if (s.text.includes(TEXT.preStart)) return { kind: KIND.PRE_START, room };
	if (!s.hasGameTable) return { kind: KIND.ROOM_LOADING, room };
	if (s.myFace === "mine" && s.hand.length > 0) return { kind: KIND.MY_TURN, room };
	return { kind: KIND.OPPONENT_TURN, room };
}

export const isRoom = (kind) =>
	[
		KIND.CONFIRM_ATTENDANCE,
		KIND.HAND_ENDED,
		KIND.GAME_ENDED,
		KIND.PAUSED,
		KIND.PRE_START,
		KIND.MY_TURN,
		KIND.OPPONENT_TURN,
		KIND.ROOM_LOADING,
	].includes(kind);

// Títulos que muestra el portal según la fase del torneo (WaitingView.tsx).
const PORTAL_BANNERS = [
	"Inicio del torneo",
	"Siguiente juego",
	"Partidas en curso",
	"Sincronizando",
	"Torneo o evento en pausa",
	"Pausa solicitada",
	"Certamen finalizado",
	"Torneo cancelado",
];

/** Título de la fase que muestra el portal en este momento, o null. */
export const portalBanner = (text) => PORTAL_BANNERS.find((title) => String(text ?? "").includes(title)) ?? null;

// Fases del portal en las que el torneo espera la siguiente partida (cuenta regresiva).
export const WAITING_BANNERS = ["Inicio del torneo", "Siguiente juego"];

/**
 * Qué partida se juega en esta mesa, según su recuadro "Certamen/Concurso: Certamen 1" / "Partida: 2".
 * -> { name: "Certamen 1", event: 1, game: 2 }, o null si la mesa aún no lo muestra.
 * El número del certamen/concurso es el de su nombre (null si el nombre no termina en número).
 */
export function roomGame(text) {
	const name = TEXT.eventLine.exec(String(text ?? ""))?.[1].trim();
	const game = Number(TEXT.gameLine.exec(String(text ?? ""))?.[1]);
	if (!name || name === "N/D" || !Number.isInteger(game) || game < 1) return null;
	const event = /(\d+)$/.exec(name)?.[1];
	return { name, event: event ? Number(event) : null, game };
}

/** "TOUR_151_RUN_..._MESA_1" -> 151 (número del torneo al que pertenece la mesa), o null. */
export const roomTournamentId = (room) => {
	const m = /^TOUR_(\d+)_/.exec(String(room ?? ""));
	return m ? Number(m[1]) : null;
};
