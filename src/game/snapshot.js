import { FACE, SEL, handTileSelector } from "./selectors.js";

/**
 * Una sola lectura del DOM (un viaje a la página) con todo lo que hace falta
 * para decidir en qué estado está el jugador. Sin lógica de decisión: eso es classify.js.
 */
export function takeSnapshot(page) {
	return page.evaluate(
		({ sel, face }) => {
			const texts = (nodes) => [...nodes].map((n) => (n.textContent ?? "").trim());

			// Mano: botones de ficha dentro de la mesa. El aria-label termina en "N-N" en cualquier idioma.
			const hand = [...document.querySelectorAll(`${sel.gameTable} button[aria-label]`)]
				.map((b) => b.getAttribute("aria-label") ?? "")
				.filter((label) => /\d+-\d+\s*$/.test(label));

			// Mi carita de turno: la del asiento que contiene mi mano.
			let myFace = null;
			let myFaceSrc = null;
			const firstTile = hand.length
				? document.querySelector(`${sel.gameTable} button[aria-label="${hand[0]}"]`)
				: null;
			for (let n = firstTile; n && n !== document.body; n = n.parentElement) {
				const img = n.querySelector(sel.turnFace);
				if (!img) continue;
				myFaceSrc = img.getAttribute("src") ?? "";
				myFace = myFaceSrc.includes(face.mine)
					? "mine"
					: myFaceSrc.includes(face.skipped)
						? "skipped"
						: myFaceSrc.includes(face.idle)
							? "idle"
							: "unknown";
				break;
			}

			const sideModal = document.querySelector(sel.sideModal);
			return {
				path: location.pathname,
				text: document.body?.innerText ?? "",
				hasGameTable: !!document.querySelector(sel.gameTable),
				hand,
				myFace,
				myFaceSrc: myFace === "unknown" ? myFaceSrc : null,
				modalHeaders: texts(document.querySelectorAll(sel.modalHeader)),
				modalButtons: texts(document.querySelectorAll(sel.modalButton)),
				sideModal: !!sideModal,
				sideOptions: sideModal ? texts(sideModal.querySelectorAll(sel.sideModalOptions)) : [],
				portalPlayers: texts(document.querySelectorAll(sel.portalPlayers)),
			};
		},
		{ sel: SEL, face: FACE },
	);
}
