import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PLAYER_COUNT, MAX_PLAYERS, PLAYER_COUNTS, SPEED, USERNAME_PATTERN } from "./defaults.js";
import { parseTournamentUrl } from "./tournamentUrl.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const SETTINGS_FILE = path.join(ROOT, "config", "settings.local.json");

export function emptySettings() {
	return {
		tournamentUrl: "",
		speed: SPEED.default,
		playerCount: DEFAULT_PLAYER_COUNT,
		players: Array.from({ length: MAX_PLAYERS }, () => ({ username: "", password: "" })),
	};
}

export function loadSettings(file = SETTINGS_FILE) {
	const base = emptySettings();
	try {
		const saved = JSON.parse(fs.readFileSync(file, "utf8"));
		base.tournamentUrl = typeof saved.tournamentUrl === "string" ? saved.tournamentUrl : "";
		if (Number.isFinite(saved.speed)) base.speed = saved.speed;
		if (PLAYER_COUNTS.includes(saved.playerCount)) base.playerCount = saved.playerCount;
		if (Array.isArray(saved.players)) {
			base.players = base.players.map((_, i) => ({
				username: String(saved.players[i]?.username ?? ""),
				password: String(saved.players[i]?.password ?? ""),
			}));
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
	if (!Array.isArray(players) || !PLAYER_COUNTS.includes(players.length)) {
		throw new Error(`Se necesitan ${PLAYER_COUNTS.join(" u ")} jugadores.`);
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

	return { tournament, speed, accounts };
}
