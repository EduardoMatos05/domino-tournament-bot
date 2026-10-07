/**
 * Todo lo que el bot sabe del DOM del juego vive aquí (y en snapshot.js).
 * El frontend no tiene data-testid; estos selectores salen de su código:
 *   - mano:        gamePlatform/components/Chip.tsx        (button[aria-label="Jugar ficha 5-3"])
 *   - mesa:        components/Game/DominoView.tsx          ([data-game-table], img[alt="turno de jugador"])
 *   - modal lado:  gamePlatform/components/ModalGame.tsx   (#modalGame)
 *   - modales:     components/Modal/ModalLayout.tsx        (div.fixed.z-50 > header)
 *   - login:       components/Login/Login.tsx              (input[name=user_email|user_password])
 *   - portal:      organizerPlatform/view/Competitor/WaitingView.tsx
 */
export const SEL = {
	loginUser: 'input[name="user_email"]',
	loginPassword: 'input[name="user_password"]',

	gameTable: "[data-game-table]",
	turnFace: 'img[alt="turno de jugador"]',

	sideModal: "#modalGame",
	sideModalOptions: "#modalGame .flex.flex-col.gap-3 button",

	modalHeader: "div.fixed.z-50 header",
	modalButton: "div.fixed.z-50 button",
};

export const handTileSelector = (label) => `[data-game-table] button[aria-label="${label}"]`;

// Textos (el bot fija el idioma del juego a español).
export const TEXT = {
	confirmAttendance: "Confirmar asistencia", // título del modal
	confirmButton: "Confirmar",
	acceptButton: "Aceptar",
	gameEnded: "Juego terminado",
	handEnded: /^Mano\s+\d+\s+terminada/i,
	paused: "Partida pausada",
	preStart: "La partida inicia en",
	tournamentFinished: "Certamen finalizado",
	tournamentCancelled: "Torneo cancelado",
	lobbyClosed: "El portal de comunicación estará disponible",
};

// Nombre de archivo del icono de turno (Vite le añade un hash).
export const FACE = { mine: "carita_base", skipped: "carita_roja", idle: "emptyface" };

/** "Jugar ficha 5-3" -> "5-3" */
export function tileName(ariaLabel) {
	const m = /(\d+)-(\d+)\s*$/.exec(ariaLabel ?? "");
	return m ? `${m[1]}-${m[2]}` : String(ariaLabel);
}
