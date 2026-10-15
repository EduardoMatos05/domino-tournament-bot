import { EventEmitter } from "node:events";
import { LAUNCH_STAGGER_MS } from "../config/defaults.js";
import { logger } from "../logger/logger.js";
import { PlayerBot, STATUS } from "../players/PlayerBot.js";
import { TournamentWatch, pointLabel } from "../players/disconnects.js";
import { sleep } from "../game/timing.js";

/**
 * Crea los 4 bots, los arranca y los detiene. Los bots son independientes:
 * el fallo de uno queda en su estado y en el log, y los demás siguen.
 * Emite "state" cada vez que cambia algo visible en la UI.
 */
export class TournamentRunner extends EventEmitter {
	constructor({ headless = false } = {}) {
		super();
		this.headless = headless;
		this.running = false;
		this.speed = { value: 2 };
		this.bots = [];
		this.log = logger.for("System");
		this.abort = null;
	}

	snapshot() {
		return {
			running: this.running,
			speed: this.speed.value,
			logFile: logger.filePath,
			players: this.bots.map((b) => ({
				name: b.name,
				username: b.account.username,
				status: b.status,
				detail: b.detail,
			})),
		};
	}

	setSpeed(seconds) {
		this.speed.value = seconds;
		if (this.running) this.log.info(`Game speed changed to ${seconds}s`);
	}

	async start({ tournament, speed, accounts, disconnects = [] }) {
		if (this.running) throw new Error("Ya hay una ejecución en curso.");
		// Navegadores que quedaron abiertos mostrando el resultado de la ejecución anterior.
		await Promise.allSettled(this.bots.map((b) => b.stop()));

		this.speed.value = speed;
		this.running = true;
		this.abort = new AbortController();
		const file = logger.startRun();

		this.log.info(`Run started. Log file: ${file}`);
		this.log.info(`Tournament: ${tournament.slug} (${tournament.origin})`);
		this.log.info(`Players (${accounts.length}): ${accounts.map((a) => a.username).join(", ")}`);
		this.log.info(`Game speed: ${speed}s`);
		for (const d of disconnects) {
			this.log.info(
				`Scheduled disconnect: Player ${d.player + 1} (${accounts[d.player].username}) ` +
					`at ${pointLabel(d.off)}, back at ${pointLabel(d.on)}`,
			);
		}

		// Lo que ve cada bot se comparte: uno desconectado sabe por los demás cuándo volver.
		const watch = new TournamentWatch();
		this.bots = accounts.map(
			(account, index) =>
				new PlayerBot({
					index,
					total: accounts.length,
					account,
					tournament,
					speed: this.speed,
					logger: logger.for(`Player ${index + 1}`),
					headless: this.headless,
					onChange: () => this.emit("state", this.snapshot()),
					disconnects: disconnects.filter((d) => d.player === index),
					watch,
				}),
		);
		this.emit("state", this.snapshot());

		this.runAll().catch((error) => this.log.error(`Unexpected runner error: ${error.message}`));
	}

	async runAll() {
		const signal = this.abort.signal;
		const runs = this.bots.map(async (bot, i) => {
			await sleep(i * LAUNCH_STAGGER_MS, signal); // ventanas y logins escalonados
			if (!signal.aborted) await bot.run();
		});
		await Promise.allSettled(runs);

		if (!signal.aborted) this.logSummary();
		this.running = false;
		this.emit("state", this.snapshot());
	}

	logSummary() {
		const done = this.bots.every((b) => b.status === STATUS.FINISHED || b.status === STATUS.CANCELLED);
		this.log.info(done ? "Tournament ended for all players." : "Run ended with problems:");
		for (const b of this.bots) {
			this.log.info(`${b.name} (${b.account.username}): ${b.status}${b.detail ? ` - ${b.detail}` : ""}`);
		}
	}

	async stop() {
		if (!this.running && this.bots.length === 0) return;
		this.log.info("Stopping all players");
		this.abort?.abort();
		await Promise.allSettled(this.bots.map((b) => b.stop()));
		this.running = false;
		this.log.info("All players stopped");
		this.emit("state", this.snapshot());
	}
}
