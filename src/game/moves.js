import { MOVE_CONFIRM_TIMEOUT_MS, MOVE_SETTLE_MS } from "../config/defaults.js";
import { SEL, handTileSelector, tileName } from "./selectors.js";
import { takeSnapshot } from "./snapshot.js";
import { pick, shuffle, sleep } from "./timing.js";

/** El juego avisa con alert() cuando una ficha no cabe o no es el turno; los anotamos y aceptamos. */
export function watchDialogs(page) {
	const tracker = { count: 0, last: "" };
	page.on("dialog", (dialog) => {
		tracker.count += 1;
		tracker.last = dialog.message();
		dialog.accept().catch(() => {});
	});
	return tracker;
}

/**
 * Jugada aleatoria reproduciendo lo que hace una persona: click en una ficha y,
 * solo si la app lo pide, elegir la sección. La app es quien decide qué es legal:
 * una ficha que no cabe provoca un alert() y no se envía nada al servidor.
 * Se prueban las fichas en orden aleatorio hasta que una sea aceptada, de modo que
 * cada ficha jugable tiene la misma probabilidad y no se duplican las reglas del dominó.
 *
 * @returns {Promise<{played: boolean, sentAt?: number, reason?: "not-turn"|"none-playable"|"unconfirmed"}>}
 */
export async function playRandomMove(page, dialogs, log, signal, { rng = Math.random, hand, notBefore } = {}) {
	hand ??= (await takeSnapshot(page)).hand;
	log.info(`Hand: ${hand.map(tileName).join(", ")}`);
	// La mano ya está leída: se espera aquí, con todo listo, para que el click caiga justo a tiempo.
	if (notBefore) await sleep(notBefore - Date.now(), signal);

	for (const label of shuffle(hand, rng)) {
		if (signal?.aborted) return { played: false, reason: "not-turn" };
		const tile = tileName(label);
		const dialogsBefore = dialogs.count;

		log.info(`Trying tile: ${tile}`);
		await page.locator(handTileSelector(label)).first().click({ timeout: 3_000 });
		const clickedAt = Date.now(); // sin elección de lado, este click ya envía la jugada
		const rejected = await waitForDialogOrSettle(dialogs, dialogsBefore, signal);

		if (rejected) {
			if (/turno/i.test(dialogs.last)) {
				log.warn(`Game says it is not my turn ("${dialogs.last}")`);
				return { played: false, reason: "not-turn" };
			}
			log.info(`Tile ${tile} is not playable ("${dialogs.last}")`);
			continue;
		}

		log.info(`Selected tile: ${tile}`);
		let sentAt = clickedAt;
		if (await chooseSideIfAsked(page, log, rng)) sentAt = Date.now();

		if (await waitUntilTileLeavesHand(page, label, signal)) {
			log.info("Move completed");
			return { played: true, sentAt };
		}
		log.warn(`Tile ${tile} was clicked but is still in my hand after ${MOVE_CONFIRM_TIMEOUT_MS / 1000}s`);
		return { played: false, reason: "unconfirmed" };
	}

	log.warn("None of my tiles was accepted by the game");
	return { played: false, reason: "none-playable" };
}

/** Si la ficha encaja en los dos extremos, el juego abre #modalGame con una opción por lado. Devuelve true si eligió. */
async function chooseSideIfAsked(page, log, rng) {
	if ((await page.locator(SEL.sideModal).count()) === 0) return false;

	const options = page.locator(SEL.sideModalOptions);
	const labels = (await options.allTextContents()).map((t) => t.trim());
	if (labels.length === 0) {
		log.warn("Side modal opened but no options were found");
		return false;
	}
	log.info(`Available positions: ${labels.join(", ")}`);
	const chosen = pick(labels.map((_, i) => i), rng);
	log.info(`Selected position: ${labels[chosen]}`);
	await options.nth(chosen).click({ timeout: 3_000 });
	return true;
}

/** Un alert() rechaza la ficha casi al instante: se sale en cuanto aparece; si no aparece, se deja pasar MOVE_SETTLE_MS. */
async function waitForDialogOrSettle(dialogs, before, signal) {
	const end = Date.now() + MOVE_SETTLE_MS;
	while (Date.now() < end && dialogs.count === before) await sleep(25, signal);
	return dialogs.count > before;
}

async function waitUntilTileLeavesHand(page, label, signal) {
	const deadline = Date.now() + MOVE_CONFIRM_TIMEOUT_MS;
	while (Date.now() < deadline && !signal?.aborted) {
		const { hand } = await takeSnapshot(page);
		if (!hand.includes(label)) return true;
		await sleep(100, signal);
	}
	return false;
}
