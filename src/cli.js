// Juega sin interfaz ni ventanas, con los datos en variables de entorno (lo usa GitHub Actions):
//   BOT_URL            URL del torneo
//   BOT_JUGADORES      cuántas cuentas de prueba (torneo1..torneoN)
//   BOT_VELOCIDAD      segundos por jugada; se usa el número del principio ("0.1 (máxima)" = 0.1)
//   BOT_DESCONEXIONES  opcional: "3 1.2 1.3; 5 1.4 1.6 confirmar" = el bot 3 sale en el certamen 1 partida 2 y
//                      vuelve en la 3; el bot 5 confirma, sale en la 4 y vuelve en la 6
// Termina con código 0 solo si todos los jugadores vieron el final del torneo.
import fs from "node:fs";
import { SPEED } from "./config/defaults.js";
import { testAccounts, validateRunConfig } from "./config/settings.js";
import { logger } from "./logger/logger.js";
import { STATUS } from "./players/PlayerBot.js";
import { TournamentRunner } from "./runner/TournamentRunner.js";

export function parseDisconnectText(text) {
	return String(text ?? "")
		.split(";")
		.map((part) => part.trim())
		.filter(Boolean)
		.map((part) => {
			const m = /^(\d+)\s+(\d+)\.(\d+)\s+(\d+)\.(\d+)(\s+confirmar)?$/i.exec(part);
			if (!m) throw new Error(`Desconexión no válida: "${part}". Ejemplo: 3 1.2 1.3 confirmar`);
			const [player, offEvent, offGame, onEvent, onGame] = m.slice(1, 6).map(Number);
			return {
				player: player - 1,
				off: { event: offEvent, game: offGame },
				on: { event: onEvent, game: onGame },
				confirm: Boolean(m[6]),
			};
		});
}

async function main(env) {
	const count = Number(env.BOT_JUGADORES);
	if (!Number.isInteger(count) || count < 1) throw new Error("El número de jugadores debe ser un entero de 1 o más.");
	const config = validateRunConfig({
		tournamentUrl: env.BOT_URL,
		speed: env.BOT_VELOCIDAD ? Number.parseFloat(env.BOT_VELOCIDAD) : SPEED.default,
		players: testAccounts(count),
		disconnects: parseDisconnectText(env.BOT_DESCONEXIONES),
	});

	const runner = new TournamentRunner({ headless: true });
	for (const signal of ["SIGINT", "SIGTERM"]) {
		process.once(signal, () => {
			runner
				.stop()
				.catch(() => {})
				.finally(() => process.exit(130));
		});
	}
	const done = new Promise((resolve) => {
		runner.on("state", (s) => {
			if (!s.running) resolve();
		});
	});
	await runner.start(config);
	await done;

	const { players } = runner.snapshot();
	await runner.stop();
	logger.close();
	if (env.GITHUB_STEP_SUMMARY) {
		const rows = players.map((p) => `| ${p.username} | ${p.status} | ${p.detail.replaceAll("|", "/")} |`);
		fs.appendFileSync(
			env.GITHUB_STEP_SUMMARY,
			["| Jugador | Resultado | Detalle |", "|---|---|---|", ...rows, ""].join("\n"),
		);
	}
	return players.every((p) => p.status === STATUS.FINISHED || p.status === STATUS.CANCELLED) ? 0 : 1;
}

if (import.meta.main ?? process.argv[1]?.endsWith("cli.js")) {
	try {
		process.exitCode = await main(process.env);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
