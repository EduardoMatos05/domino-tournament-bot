import { EventEmitter } from "node:events";
import { LAUNCH_STAGGER_MS, QUEUE_END_GRACE_MS } from "../config/defaults.js";
import { logger } from "../logger/logger.js";
import { PlayerBot, STATUS } from "../players/PlayerBot.js";
import { TournamentWatch, pointLabel } from "../players/disconnects.js";
import { sleep } from "../game/timing.js";

/**
 * Crea los bots, los arranca y los detiene. Los bots son independientes:
 * el fallo de uno queda en su estado y en el log, y los demás siguen.
 * Con una cola de torneos, al terminar uno cierra sus ventanas y arranca el siguiente.
 * Emite "state" cada vez que cambia algo visible en la UI.
 */
export class TournamentRunner extends EventEmitter {
	constructor({ headless = false, queueEndGraceMs = QUEUE_END_GRACE_MS } = {}) {
		super();
		this.headless = headless;
		this.queueEndGraceMs = queueEndGraceMs;
		this.running = false;
		this.speed = { value: 2 };
		this.bots = [];
		this.log = logger.for("System");
		this.abort = null;
		this.plan = []; // [{ tournament, accounts, disconnects }]: el torneo de la corrida y los de la cola
		this.position = 0; // índice en `plan` del torneo que se juega ahora
		this.endTimer = null;
	}

	snapshot() {
		return {
			running: this.running,
			speed: this.speed.value,
			logFile: logger.filePath,
			queue: {
				position: this.position + 1,
				total: this.plan.length,
				slugs: this.plan.map((p) => p.tournament.slug),
			},
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

	/** @param {{ tournament, speed, accounts, disconnects?, queue?: {tournament, accounts}[] }} config */
	async start({ tournament, speed, accounts, disconnects = [], queue = [] }) {
		if (this.running) throw new Error("Ya hay una ejecución en curso.");
		// Navegadores que quedaron abiertos mostrando el resultado de la ejecución anterior.
		await Promise.allSettled(this.bots.map((b) => b.stop()));

		this.speed.value = speed;
		this.running = true;
		this.abort = new AbortController();
		// Las desconexiones programadas solo aplican al primer torneo.
		this.plan = [{ tournament, accounts, disconnects }, ...queue.map((q) => ({ ...q, disconnects: [] }))];
		this.position = 0;
		this.launch();

		this.runQueue().catch((error) => this.log.error(`Unexpected runner error: ${error.message}`));
	}

	/** Prepara los bots del torneo `plan[position]` en un archivo de log nuevo. */
	launch() {
		const { tournament, accounts, disconnects } = this.plan[this.position];
		clearTimeout(this.endTimer);
		this.endTimer = null;
		const file = logger.startRun();

		this.log.info(`Run started. Log file: ${file}`);
		if (this.plan.length > 1) {
			this.log.info(
				`Tournament queue (${this.position + 1} of ${this.plan.length}): ` +
					this.plan.map((p, i) => (i === this.position ? `[${p.tournament.slug}]` : p.tournament.slug)).join(" -> "),
			);
		}
		this.log.info(`Tournament: ${tournament.slug} (${tournament.origin})`);
		this.log.info(`Players (${accounts.length}): ${accounts.map((a) => a.username).join(", ")}`);
		this.log.info(`Game speed: ${this.speed.value}s`);
		for (const d of disconnects) {
			this.log.info(
				`Scheduled disconnect: Player ${d.player + 1} (${accounts[d.player].username}) ` +
					`at ${pointLabel(d.off)}, back at ${pointLabel(d.on)}` +
					(d.confirm ? " (confirms attendance before disconnecting)" : ""),
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
					onChange: (bot) => {
						this.noteTournamentEnd(bot);
						this.emit("state", this.snapshot());
					},
					disconnects: disconnects.filter((d) => d.player === index),
					watch,
				}),
		);
		this.emit("state", this.snapshot());
	}

	get hasNext() {
		return this.position + 1 < this.plan.length;
	}

	/**
	 * Con más torneos en la cola: en cuanto un bot ve el final del torneo, los demás tienen un margen para verlo
	 * también; los que sigan sin terminar se cierran para que la cola no se quede atorada en este torneo.
	 */
	noteTournamentEnd(bot) {
		if (!this.hasNext || this.endTimer) return;
		if (bot.status !== STATUS.FINISHED && bot.status !== STATUS.CANCELLED) return;
		const bots = this.bots;
		this.endTimer = setTimeout(() => {
			const stuck = bots.filter((b) => !b.isTerminal);
			if (stuck.length === 0 || this.abort?.signal.aborted) return;
			this.log.warn(
				`Tournament is over but ${stuck.map((b) => b.name).join(", ")} did not see it; closing them to continue the queue`,
			);
			for (const b of stuck) b.stop().catch(() => {});
		}, this.queueEndGraceMs);
	}

	async runQueue() {
		const signal = this.abort.signal;
		for (;;) {
			await this.runAll(signal);
			if (signal.aborted) return; // stop() ya dejó todo detenido
			this.logSummary();
			if (!this.hasNext) break;

			// Cierra las ventanas del torneo que terminó y arranca el siguiente de la cola.
			await Promise.allSettled(this.bots.map((b) => b.stop()));
			if (signal.aborted) return;
			const next = this.plan[this.position + 1].tournament.slug;
			this.log.info(`Moving on to the next tournament in the queue: ${next}`);
			this.position += 1;
			this.launch();
		}
		clearTimeout(this.endTimer);
		this.endTimer = null;
		if (this.plan.length > 1) this.log.info("Tournament queue finished.");
		this.running = false;
		this.emit("state", this.snapshot());
	}

	async runAll(signal) {
		const runs = this.bots.map(async (bot, i) => {
			await sleep(i * LAUNCH_STAGGER_MS, signal); // ventanas y logins escalonados
			if (!signal.aborted) await bot.run();
		});
		await Promise.allSettled(runs);
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
		this.log.info(this.hasNext && this.running ? "Stopping all players and the tournament queue" : "Stopping all players");
		this.abort?.abort();
		clearTimeout(this.endTimer);
		this.endTimer = null;
		await Promise.allSettled(this.bots.map((b) => b.stop()));
		this.running = false;
		this.log.info("All players stopped");
		this.emit("state", this.snapshot());
	}
}
