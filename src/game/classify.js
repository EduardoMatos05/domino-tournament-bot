import { TEXT } from "./selectors.js";

export const KIND = {
	LOGGED_OUT: "LOGGED_OUT",
	// portal de comunicación
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
