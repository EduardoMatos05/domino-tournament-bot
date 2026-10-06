import { SPEED_JITTER } from "../config/defaults.js";

/** Espera aproximada antes de jugar: `speedSeconds` ± SPEED_JITTER, distinta para cada bot y cada jugada. */
export function moveDelayMs(speedSeconds, rng = Math.random) {
	const jitter = (rng() * 2 - 1) * SPEED_JITTER;
	return Math.max(50, Math.round(speedSeconds * 1000 * (1 + jitter)));
}

export function shuffle(items, rng = Math.random) {
	const copy = [...items];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
}

export function pick(items, rng = Math.random) {
	return items[Math.floor(rng() * items.length)];
}

/** sleep que se corta al abortar (Stop). */
export function sleep(ms, signal) {
	return new Promise((resolve) => {
		if (signal?.aborted) return resolve();
		const timer = setTimeout(done, ms);
		function done() {
			clearTimeout(timer);
			signal?.removeEventListener("abort", done);
			resolve();
		}
		signal?.addEventListener("abort", done, { once: true });
	});
}
