import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	DEFAULT_PLAYER_COUNT,
	MAX_GAME_NUMBER,
	MAX_PLAYERS,
	MIN_PLAYERS,
	SPEED,
	USERNAME_PATTERN,
	isValidPlayerCount,
} from "./defaults.js";
import { parseTournamentUrl } from "./tournamentUrl.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const SETTINGS_FILE = path.join(ROOT, "config", "settings.local.json");

export function emptySettings() {
	return {
		tournamentUrl: "",
		speed: SPEED.default,
		playerCount: DEFAULT_PLAYER_COUNT,
		players: Array.from({ length: MAX_PLAYERS }, () => ({ username: "", password: "" })),
		disconnects: [],
	};
}

export function loadSettings(file = SETTINGS_FILE) {
	const base = emptySettings();
	try {
		const saved = JSON.parse(fs.readFileSync(file, "utf8"));
		base.tournamentUrl = typeof saved.tournamentUrl === "string" ? saved.tournamentUrl : "";
		if (Number.isFinite(saved.speed)) base.speed = saved.speed;
		if (isValidPlayerCount(saved.playerCount)) base.playerCount = saved.playerCount;
		if (Array.isArray(saved.players)) {
			base.players = base.players.map((_, i) => ({
				username: String(saved.players[i]?.username ?? ""),
				password: String(saved.players[i]?.password ?? ""),
			}));
		}
		try {
			base.disconnects = parseDisconnects(saved.disconnects, MAX_PLAYERS);
		} catch {
			// desconexiones guardadas inválidas: se descartan
		}
	} catch {
		// sin archivo guardado todavía
	}
	return base;
}

export function saveSettings(settings, file = SETTINGS_FILE) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify(settings, null, 2), { mode: 0o600 });
}

/** Valida lo que llega de la UI y devuelve la configuración lista para ejecutar. */
export function validateRunConfig(input) {
	const tournament = parseTournamentUrl(input?.tournamentUrl);

	const speed = Number(input?.speed);
	if (!Number.isFinite(speed) || speed < SPEED.min || speed > SPEED.max) {
		throw new Error(`La velocidad debe estar entre ${SPEED.min}s y ${SPEED.max}s.`);
	}

	const players = input?.players;
	if (!Array.isArray(players) || !isValidPlayerCount(players.length)) {
		throw new Error(`El número de jugadores debe ser par, de ${MIN_PLAYERS} a ${MAX_PLAYERS}.`);
	}
	const seen = new Set();
	const accounts = players.map((p, i) => {
		const username = String(p?.username ?? "").trim();
		const password = String(p?.password ?? "");
		if (!USERNAME_PATTERN.test(username)) {
			throw new Error(
				`Jugador ${i + 1}: el usuario debe tener de 1 a 8 letras o números (el login del juego no admite más).`,
			);
		}
		if (!password) throw new Error(`Jugador ${i + 1}: falta la contraseña.`);
		if (seen.has(username.toLowerCase())) {
			throw new Error(`Jugador ${i + 1}: el usuario "${username}" está repetido.`);
		}
		seen.add(username.toLowerCase());
		return { username, password };
	});

	const disconnects = parseDisconnects(input?.disconnects, accounts.length);
	return { tournament, speed, accounts, disconnects };
}

/**
 * Desconexiones programadas: [{ player, off: {event, game}, on: {event, game} }], con player = índice del
 * jugador (0..N-1) y event = número del certamen/concurso. Se desconecta en `off` y vuelve en `on`.
 */
export function parseDisconnects(input, playerCount) {
	if (input == null) return [];
	if (!Array.isArray(input)) throw new Error("Las desconexiones programadas no son válidas.");
	const isNumber = (n) => Number.isInteger(n) && n >= 1 && n <= MAX_GAME_NUMBER;
	return input.map((d, i) => {
		const name = `Desconexión ${i + 1}`;
		const { player, off, on } = d ?? {};
		if (!Number.isInteger(player) || player < 0 || player >= playerCount) {
			throw new Error(`${name}: elige el bot que se desconecta.`);
		}
		for (const point of [off, on]) {
			if (!isNumber(point?.event) || !isNumber(point?.game)) {
				throw new Error(`${name}: el certamen/concurso y la partida deben ser números de 1 a ${MAX_GAME_NUMBER}.`);
			}
		}
		if (on.event === off.event && on.game <= off.game) {
			throw new Error(`${name}: la partida de regreso debe ser posterior a la de desconexión.`);
		}
		return { player, off: { event: off.event, game: off.game }, on: { event: on.event, game: on.game } };
	});
}
