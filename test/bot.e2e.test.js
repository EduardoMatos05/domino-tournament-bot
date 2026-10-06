import assert from "node:assert/strict";
import test from "node:test";
import { launchPlayerBrowser } from "../src/browser/launch.js";
import { playRandomMove, watchDialogs } from "../src/game/moves.js";
import { parseTournamentUrl } from "../src/config/tournamentUrl.js";
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
