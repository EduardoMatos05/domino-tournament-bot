import { chromium } from "playwright";
import { LANGUAGE, WINDOW } from "../config/defaults.js";

// Con varias ventanas en una sola máquina, Chromium puede congelar las que quedan tapadas u ocultas.
const KEEP_ALIVE_FLAGS = [
	"--disable-renderer-backgrounding",
	"--disable-background-timer-throttling",
	"--disable-backgrounding-occluded-windows",
];

const FALLBACK_SCREEN = { width: 1440, height: 900 };
let screenSize = null; // se mide con la primera ventana visible

/** Reparte las ventanas por la pantalla: juntas si caben, solapadas (pero del mismo tamaño) si no. */
function placement(index, total) {
	const cols = total <= 4 ? 2 : 4;
	const rows = Math.ceil(total / cols);
	const screen = screenSize ?? FALLBACK_SCREEN;
	const spanX = Math.max(0, screen.width - WINDOW.width);
	const spanY = Math.max(0, screen.height - WINDOW.height);
	const col = index % cols;
	const row = Math.floor(index / cols);
	return {
		x: cols > 1 ? Math.round(Math.min(col * WINDOW.width, (col * spanX) / (cols - 1))) : 0,
		y: rows > 1 ? Math.round(Math.min(row * WINDOW.height, (row * spanY) / (rows - 1))) : 0,
	};
}

/**
 * Un Chromium propio por jugador: cookies, localStorage y sessionStorage totalmente
 * independientes, y si uno se cae los demás siguen jugando.
 */
export async function launchPlayerBrowser(index, { total = 4, headless = false } = {}) {
	const { x, y } = placement(index, total);

	const browser = await chromium.launch({
		headless,
		args: [
			...KEEP_ALIVE_FLAGS,
			`--window-position=${x},${y}`,
			`--window-size=${WINDOW.width},${WINDOW.height}`,
		],
	});
	const context = await browser.newContext({
		viewport: headless ? WINDOW : null,
		locale: "es-MX",
	});
	// El juego guarda el idioma en localStorage; los selectores esperan español.
	await context.addInitScript((lang) => {
		try {
			window.localStorage.setItem("amigos-language", lang);
		} catch {
			// almacenamiento no disponible
		}
	}, LANGUAGE);

	const page = await context.newPage();
	if (!headless && !screenSize) {
		screenSize = await page
			.evaluate(() => ({ width: screen.availWidth, height: screen.availHeight }))
			.catch(() => null);
	}
	return { browser, context, page };
}
