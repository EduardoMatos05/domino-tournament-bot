import assert from "node:assert/strict";
import test from "node:test";
import { launchPlayerBrowser } from "../src/browser/launch.js";
import { playRandomMove, watchDialogs } from "../src/game/moves.js";
import { parseTournamentUrl } from "../src/config/tournamentUrl.js";
import { logger } from "../src/logger/logger.js";
import { PlayerBot, STATUS } from "../src/players/PlayerBot.js";
import { TournamentRunner } from "../src/runner/TournamentRunner.js";
import { startFakeTournament } from "./helpers/fakeTournament.js";

// Prueba de punta a punta contra un "juego" falso que imita el DOM real (ver helpers/fakeTournament.js).
function makeBot(fake, password) {
	const lines = [];
	const logger = {
		info: (m) => lines.push(m),
		warn: (m) => lines.push(`WARN ${m}`),
		error: (m) => lines.push(`ERROR ${m}`),
	};
	const bot = new PlayerBot({
		index: 0,
		account: { username: "jugador", password },
		tournament: parseTournamentUrl(`${fake.origin}/${fake.slug}/login`),
		speed: { value: 0.5 },
		logger,
		headless: true,
		onChange: () => {},
	});
	return { bot, lines };
}

test("un bot completo: login, asistencia, jugadas legales, modales y fin de torneo", { timeout: 90_000 }, async () => {
	const fake = await startFakeTournament();
	const { bot, lines } = makeBot(fake, "ok");
	try {
		await bot.run();
		console.log(lines.join("\n"));

		assert.equal(bot.status, STATUS.FINISHED, `estado final: ${bot.status} ${bot.detail}`);
		assert.equal(fake.moves.length, 3, "3 jugadas llegaron al servidor");
		for (const m of fake.moves) assert.ok(["unica", "arriba", "abajo"].includes(m.side));

		const log = lines.join("\n");
		for (const expected of [
			"Login successful",
			"Tournament id: 146",
			"Match detected",
			"Attendance confirmed",
			"My turn",
			"Selected tile",
			"Move completed",
			"Hand accepted",
			"Match result accepted",
			"Tournament finished",
		]) {
			assert.ok(log.includes(expected), `falta en el log: ${expected}`);
		}
	} finally {
		await bot.stop();
		fake.close();
	}
});

test("credenciales incorrectas: error claro y no reintenta", { timeout: 60_000 }, async () => {
	const fake = await startFakeTournament();
	const { bot, lines } = makeBot(fake, "mala");
	try {
		await bot.run();
		assert.equal(bot.status, STATUS.ERROR);
		assert.match(bot.detail, /contraseña incorrecta/);
		assert.ok(lines.some((l) => l.startsWith("ERROR Login failed")));
	} finally {
		await bot.stop();
		fake.close();
	}
});

test("ficha que encaja en ambos extremos: elige una sección y descarta fichas que no caben", { timeout: 60_000 }, async () => {
	const fake = await startFakeTournament();
	const { browser, page } = await launchPlayerBrowser(0, { headless: true });
	const lines = [];
	const log = { info: (m) => lines.push(m), warn: (m) => lines.push(`WARN ${m}`), error: (m) => lines.push(m) };
	try {
		const dialogs = watchDialogs(page);
		// Extremos 3 y 5: 3-5 encaja en los dos lados; 6-6 no encaja en ninguno.
		await page.goto(`${fake.origin}/${fake.slug}/room/X?hand=6-6,3-5`);
		await page.getByRole("button", { name: "Confirmar", exact: true }).click();
		await page.waitForSelector('#face[src*="carita_base"]');

		const result = await playRandomMove(page, dialogs, log);
		assert.equal(result.played, true, lines.join("\n"));
		assert.deepEqual(fake.moves.map((m) => m.tile), ["3-5"]);
		assert.ok(["arriba", "abajo"].includes(fake.moves[0].side));
		assert.ok(lines.some((l) => l.startsWith("Available positions: Sección 1 (arriba), Sección 3 (abajo)")));
		assert.ok(lines.some((l) => l.startsWith("Selected position:")));
	} finally {
		await browser.close();
		fake.close();
	}
});

test("8 jugadores a la vez a través del runner: todos terminan el torneo", { timeout: 180_000 }, async () => {
	const fake = await startFakeTournament();
	const runner = new TournamentRunner({ headless: true });
	try {
		await runner.start({
			tournament: parseTournamentUrl(`${fake.origin}/${fake.slug}/login`),
			speed: 0.5,
			accounts: Array.from({ length: 8 }, (_, i) => ({ username: `bot${i + 1}`, password: "ok" })),
		});
		const deadline = Date.now() + 170_000;
		while (runner.running && Date.now() < deadline) await new Promise((r) => setTimeout(r, 500));

		const final = runner.snapshot().players.map((p) => `${p.name}:${p.status}`);
		assert.equal(runner.running, false, `sigue corriendo: ${final.join(", ")}`);
		assert.equal(final.length, 8);
		assert.ok(final.every((f) => f.endsWith(STATUS.FINISHED)), final.join(", "));
		assert.equal(fake.moves.length, 8 * 3, "3 jugadas por bot llegaron al servidor");
	} finally {
		await runner.stop();
		fake.close();
	}
});

test("2 jugadores (el mínimo) a través del runner", { timeout: 90_000 }, async () => {
	const fake = await startFakeTournament();
	const runner = new TournamentRunner({ headless: true });
	try {
		await runner.start({
			tournament: parseTournamentUrl(`${fake.origin}/${fake.slug}/login`),
			speed: 0.5,
			accounts: [
				{ username: "uno", password: "ok" },
				{ username: "dos", password: "ok" },
			],
		});
		const deadline = Date.now() + 80_000;
		while (runner.running && Date.now() < deadline) await new Promise((r) => setTimeout(r, 500));

		const final = runner.snapshot().players.map((p) => `${p.name}:${p.status}`);
		assert.equal(runner.running, false, final.join(", "));
		assert.deepEqual(final, [`Player 1:${STATUS.FINISHED}`, `Player 2:${STATUS.FINISHED}`]);
	} finally {
		await runner.stop();
		fake.close();
	}
});

test("avisa cuando el engine manda a la cuenta a una mesa de otro torneo", { timeout: 90_000 }, async () => {
	const fake = await startFakeTournament({ tournamentId: 146, roomTournamentId: 151 });
	const { bot, lines } = makeBot(fake, "ok");
	try {
		await bot.run();
		assert.ok(
			lines.some((l) => l.startsWith("WARN This table belongs to tournament 151, but this run is for tournament 146")),
			lines.join("\n"),
		);
	} finally {
		await bot.stop();
		fake.close();
	}
});

test("desconexión programada: cierra la ventana sin confirmar y vuelve a jugar en su partida de regreso", { timeout: 180_000 }, async () => {
	const names = ["uno", "dos", "tres", "cuatro"];
	const fake = await startFakeTournament({
		games: [1, 2, 3].map((game) => ({ event: "Certamen 1", game })),
		players: names,
	});
	const runner = new TournamentRunner({ headless: true });
	const lines = [];
	const collect = (line) => lines.push(line.text);
	logger.on("line", collect);
	try {
		await runner.start({
			tournament: parseTournamentUrl(`${fake.origin}/${fake.slug}/login`),
			speed: 0.5,
			accounts: names.map((username) => ({ username, password: "ok" })),
			disconnects: [
				{ player: 1, off: { event: 1, game: 1 }, on: { event: 1, game: 2 } }, // dos: falta a la 1 y vuelve en la siguiente
				{ player: 2, off: { event: 1, game: 1 }, on: { event: 1, game: 3 } }, // tres: falta a la 1 y a la 2
			],
		});
		const deadline = Date.now() + 170_000;
		while (runner.running && Date.now() < deadline) await new Promise((r) => setTimeout(r, 500));

		const final = runner.snapshot().players.map((p) => `${p.name}:${p.status}`);
		assert.equal(runner.running, false, `sigue corriendo: ${final.join(", ")}`);
		assert.ok(final.every((f) => f.endsWith(STATUS.FINISHED)), final.join(", "));

		// Lo que vio el "servidor": quién confirmó asistencia en cada partida y cuántas jugadas llegaron.
		assert.deepEqual(
			[...fake.tour.confirmed].sort(),
			["cuatro#1", "cuatro#2", "cuatro#3", "dos#2", "dos#3", "tres#3", "uno#1", "uno#2", "uno#3"],
		);
		assert.equal(fake.moves.length, 3 * (3 + 3 + 2 + 1), "3 jugadas por cada partida jugada");

		const logOf = (n) => lines.filter((l) => l.startsWith(`[Player ${n}] `)).map((l) => l.slice(`[Player ${n}] `.length));
		const assertInOrder = (log, expected) => {
			let at = -1;
			for (const text of expected) {
				const next = log.findIndex((l, i) => i > at && l.startsWith(text));
				assert.ok(next > at, `falta "${text}" (en ese orden) en:\n${log.join("\n")}`);
				at = next;
			}
		};
		const reconnect = "The tournament is waiting for the next game: reconnecting";
		assertInOrder(logOf(2), [
			"Scheduled disconnect at Certamen 1 · Partida 1: not confirming attendance",
			"Window closed until the wait for the next game (back at Certamen/Concurso 1 · Partida 2)",
			reconnect,
			"Login successful",
			"Back at Certamen 1 · Partida 2: playing normally",
			"Attendance confirmed",
			"Tournament finished",
		]);
		assertInOrder(logOf(3), [
			"Scheduled disconnect at Certamen 1 · Partida 1: not confirming attendance",
			reconnect,
			"Still disconnected (Certamen 1 · Partida 2): not confirming attendance",
			reconnect,
			"Back at Certamen 1 · Partida 3: playing normally",
			"Attendance confirmed",
			"Tournament finished",
		]);
	} finally {
		logger.off("line", collect);
		await runner.stop();
		fake.close();
	}
});

test("si el servidor ignora las jugadas: un solo aviso por ficha, aviso de racha y reintentos cada vez más espaciados", { timeout: 120_000 }, async () => {
	const fake = await startFakeTournament({ ignoreMoves: true });
	const { bot, lines } = makeBot(fake, "ok");
	try {
		const running = bot.run();
		const deadline = Date.now() + 100_000;
		while (!lines.some((l) => l.includes("moves in a row were not accepted")) && Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 500));
		}
		await bot.stop();
		await running;

		const single = lines.filter((l) => l.includes("was clicked but the game did not take it"));
		const streak = lines.filter((l) => l.includes("3 moves in a row were not accepted"));
		assert.equal(single.length, 1, "el aviso individual sale una sola vez, no en cada reintento");
		assert.equal(streak.length, 1, lines.join("\n"));
		assert.match(streak[0], /tour\) logs/);
	} finally {
		await bot.stop();
		fake.close();
	}
});
