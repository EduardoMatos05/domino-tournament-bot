import {
	KEEPALIVE_MS,
	LOBBY_CLOSED_RELOAD_MS,
	MAX_CONSECUTIVE_ERRORS,
	MAX_RELOGINS,
	POLL_MS,
	PREPARE_MS,
	ROOM_POLL_MS,
	PORTAL_RELOAD_MS,
	TERMINAL_CONFIRMATIONS,
} from "../config/defaults.js";
import { launchPlayerBrowser } from "../browser/launch.js";
import { KIND, classify, isRoom } from "../game/classify.js";
import { playRandomMove, watchDialogs } from "../game/moves.js";
import { TEXT } from "../game/selectors.js";
import { takeSnapshot } from "../game/snapshot.js";
import { moveDelayMs, sleep } from "../game/timing.js";
import { LoginError, goToPortal, login } from "./auth.js";

export const STATUS = {
	IDLE: "Idle",
	STARTING: "Starting",
	LOGGING_IN: "Logging in",
	WAITING_LOBBY: "Waiting for lobby to open",
	WAITING_MATCH: "Waiting for match",
	CONFIRMING: "Confirming attendance",
	PRE_START: "Match starting",
	WAITING_TURN: "Waiting for turn",
	MY_TURN: "My turn",
	BETWEEN: "Waiting for next match",
	PAUSED: "Paused",
	FINISHED: "Tournament finished",
	CANCELLED: "Tournament cancelled",
	ERROR: "Error",
	STOPPED: "Stopped",
};

const TERMINAL = new Set([STATUS.FINISHED, STATUS.CANCELLED, STATUS.ERROR, STATUS.STOPPED]);
const SOCKET_WARNING_AFTER_MS = 45_000;

/**
 * Un jugador = un navegador + un bucle "mirar estado real -> actuar".
 * No sabe nada de formatos de torneo, rondas ni puntuaciones.
 */
export class PlayerBot {
	/**
	 * @param {object} o
	 * @param {number} o.index  0..(total-1)
	 * @param {number} o.total  cuántos jugadores hay en total (para repartir las ventanas)
	 * @param {{username:string,password:string}} o.account
	 * @param {ReturnType<import("../config/tournamentUrl.js").parseTournamentUrl>} o.tournament
	 * @param {{value:number}} o.speed  velocidad compartida (segundos), editable en vivo
	 * @param {object} o.logger  logger.for("Player N")
	 * @param {boolean} o.headless
	 * @param {(bot: PlayerBot) => void} o.onChange
	 */
	constructor({ index, total, account, tournament, speed, logger, headless, onChange }) {
		this.index = index;
		this.total = total;
		this.name = `Player ${index + 1}`;
		this.account = account;
		this.tournament = tournament;
		this.speed = speed;
		this.log = logger;
		this.headless = headless;
		this.onChange = onChange;

		this.status = STATUS.IDLE;
		this.detail = "";
		this.abort = new AbortController();
		this.session = null; // { browser, context, page }
		this.dialogs = null;

		this.lastKind = null;
		this.cooldowns = new Map();
		this.terminalHits = 0;
		this.relogins = 0;
		this.loadedAt = 0; // última carga completa de página (para renovar el JWT)
		this.lastKeepAlive = 0;
		this.socketWarned = false;
		this.portalSince = 0;
		this.loggedOutHits = 0;
		this.warnedFace = false;
		this.lastText = "";
		this.finished = false;
	}

	get isTerminal() {
		return TERMINAL.has(this.status);
	}

	setStatus(status, detail = "") {
		if (this.status === status && this.detail === detail) return;
		this.status = status;
		this.detail = detail;
		this.onChange?.(this);
	}

	/** Nunca lanza: cualquier fallo queda en el log y en el estado de este jugador. */
	async run() {
		try {
			this.setStatus(STATUS.STARTING);
			await this.openSession();
			await this.loginOrFail();
			if (this.finished) return;
			await this.loop();
		} catch (error) {
			if (!this.abort.signal.aborted) this.fail(error);
		} finally {
			if (this.abort.signal.aborted) this.setStatus(STATUS.STOPPED);
		}
	}

	async stop() {
		const alreadyDone = this.isTerminal; // conserva el estado final (Tournament finished / Error)
		this.abort.abort();
		await this.closeSession();
		if (!alreadyDone) this.setStatus(STATUS.STOPPED);
	}

	// ---------------------------------------------------------------- sesión

	async openSession() {
		this.session = await launchPlayerBrowser(this.index, { total: this.total, headless: this.headless });
		const { page } = this.session;
		this.dialogs = watchDialogs(page);
		page.on("pageerror", (e) => this.log.warn(`Page error: ${e.message}`));
		// "load" solo salta con cargas completas (no con la navegación interna de la SPA): ahí se renueva el JWT.
		page.on("load", () => {
			this.loadedAt = Date.now();
		});
		this.loadedAt = Date.now();
		this.lastKeepAlive = Date.now();
	}

	async closeSession() {
		const session = this.session;
		this.session = null;
		await session?.browser.close().catch(() => {});
	}

	async loginOrFail() {
		this.setStatus(STATUS.LOGGING_IN);
		try {
			await login(this.session.page, this.tournament, this.account, this.log);
			this.portalSince = Date.now();
		} catch (error) {
			if (error instanceof LoginError && error.fatal) {
				this.log.error(`Login failed: ${error.message}`);
				this.finishWith(STATUS.ERROR, `Login failed: ${error.message}`);
				return;
			}
			throw error;
		}
	}

	// ----------------------------------------------------------------- bucle

	async loop() {
		let consecutiveErrors = 0;
		while (!this.abort.signal.aborted && !this.finished) {
			try {
				await this.step();
				consecutiveErrors = 0;
			} catch (error) {
				if (this.abort.signal.aborted) return;
				consecutiveErrors += 1;
				this.log.error(`Error: ${error.message.split("\n")[0]}`);
				if (this.session?.page.isClosed()) throw new Error("the browser window was closed");
				if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) throw new Error("too many consecutive errors");
				await sleep(1_000, this.abort.signal);
			}
			await sleep(this.lastKind && isRoom(this.lastKind) ? ROOM_POLL_MS : POLL_MS, this.abort.signal);
		}
	}

	async step() {
		const { page } = this.session;
		await this.keepAlive(page);

		const snap = await takeSnapshot(page);
		this.lastText = snap.text;
		const state = classify(snap);
		this.noteTransition(state);

		if (state.kind !== KIND.TOURNAMENT_FINISHED && state.kind !== KIND.TOURNAMENT_CANCELLED) {
			this.terminalHits = 0;
		}
		if (state.kind !== KIND.LOGGED_OUT) this.loggedOutHits = 0;
		if (snap.myFace === "unknown" && !this.warnedFace) {
			this.warnedFace = true;
			this.log.warn(`Unrecognised turn icon (src=${snap.myFaceSrc}); turn detection may be wrong`);
		}

		switch (state.kind) {
			case KIND.LOGGED_OUT:
				// La app puede pasar un instante por /login al cargar; solo es real si se mantiene.
				this.loggedOutHits += 1;
				if (this.loggedOutHits < 3) return;
				this.loggedOutHits = 0;
				return this.relogin();

			case KIND.LOBBY_CLOSED:
				this.setStatus(STATUS.WAITING_LOBBY);
				return this.reloadPortalIf(LOBBY_CLOSED_RELOAD_MS);

			case KIND.WAITING_MATCH:
				this.setStatus(STATUS.WAITING_MATCH);
				this.warnIfSocketSilent(snap);
				return this.reloadPortalIf(PORTAL_RELOAD_MS);

			case KIND.TOURNAMENT_FINISHED:
			case KIND.TOURNAMENT_CANCELLED:
				return this.confirmTerminal(state.kind);

			case KIND.CONFIRM_ATTENDANCE:
				this.setStatus(STATUS.CONFIRMING);
				return this.clickOnce(page, "attendance", TEXT.confirmButton, "Attendance confirmed");

			case KIND.HAND_ENDED:
				this.setStatus(STATUS.WAITING_TURN, "Hand ended");
				return this.clickOnce(page, "hand", TEXT.acceptButton, "Hand accepted");

			case KIND.GAME_ENDED:
				this.setStatus(STATUS.BETWEEN, "Match ended");
				return this.clickOnce(page, "game", TEXT.acceptButton, "Match result accepted");

			case KIND.PAUSED:
				this.setStatus(STATUS.PAUSED);
				return;

			case KIND.PRE_START:
				this.setStatus(STATUS.PRE_START);
				return;

			case KIND.OPPONENT_TURN:
			case KIND.ROOM_LOADING:
				this.setStatus(STATUS.WAITING_TURN);
				return;

			case KIND.MY_TURN:
				return this.takeTurn(page);

			case KIND.OTHER:
				if (this.cooldown("portal", 5_000)) {
					this.log.info("Going back to the communication portal");
					await goToPortal(page, this.tournament);
				}
				return;
		}
	}

	// --------------------------------------------------------------- acciones

	/**
	 * La espera (velocidad ± variación) se cuenta desde que el bot nota que empezó su turno hasta que
	 * la ficha sale hacia el servidor. Todo lo demás (comprobar el turno, leer la mano) se hace
	 * antes de que se cumpla la espera, no después.
	 */
	async takeTurn(page) {
		this.setStatus(STATUS.MY_TURN);
		if (!this.cooldown("move", 700)) return;

		const turnStartedAt = Date.now();
		const delay = moveDelayMs(this.speed.value);
		this.log.info("My turn");
		this.log.info(`Thinking for ${(delay / 1000).toFixed(1)}s`);
		await sleep(Math.max(0, delay - PREPARE_MS), this.abort.signal);
		if (this.abort.signal.aborted) return;

		// El servidor pudo jugar solo (una única opción) o pasar el turno mientras esperábamos.
		const snap = await takeSnapshot(page);
		if (classify(snap).kind !== KIND.MY_TURN) {
			this.log.info("The turn passed while waiting");
			return;
		}

		const result = await playRandomMove(page, this.dialogs, this.log, this.abort.signal, {
			hand: snap.hand,
			notBefore: turnStartedAt + delay,
		});
		if (result.played) {
			// Tiempo real desde que el bot notó su turno hasta que la jugada salió hacia el servidor.
			this.log.info(`Move sent ${((result.sentAt - turnStartedAt) / 1000).toFixed(1)}s after my turn started`);
		} else {
			await sleep(1_000, this.abort.signal); // no martillar el click
		}
	}

	async clickOnce(page, key, buttonText, doneMessage) {
		if (!this.cooldown(key, 2_000)) return;
		const button = page.locator("div.fixed.z-50 button").filter({ hasText: new RegExp(`^\\s*${buttonText}\\s*$`) });
		if ((await button.count()) === 0) return;
		await button.first().click({ timeout: 3_000 });
		this.log.info(doneMessage);
	}

	async relogin() {
		if (this.relogins >= MAX_RELOGINS) {
			throw new Error(`the session keeps closing (${MAX_RELOGINS} re-logins already tried)`);
		}
		this.relogins += 1;
		this.log.warn(`Logged out of the game, logging in again (${this.relogins}/${MAX_RELOGINS})`);
		this.setStatus(STATUS.LOGGING_IN);
		await this.loginOrFail();
	}

	/** Fin/cancelación del torneo: se exige verlo varios sondeos seguidos para evitar parpadeos. */
	confirmTerminal(kind) {
		this.terminalHits += 1;
		if (this.terminalHits < TERMINAL_CONFIRMATIONS) return;
		if (kind === KIND.TOURNAMENT_FINISHED) {
			this.log.info("Tournament finished");
			this.finishWith(STATUS.FINISHED);
		} else {
			// El portal muestra el motivo que dio el engine bajo el título "Torneo cancelado".
			const reason = (/Torneo cancelado\s*([\s\S]{0,300})/.exec(this.lastText ?? "")?.[1] ?? "")
				.replace(/\s+/g, " ")
				.trim();
			this.log.warn(`Tournament cancelled${reason ? `: ${reason}` : ""}`);
			this.finishWith(STATUS.CANCELLED, reason);
		}
	}

	finishWith(status, detail = "") {
		this.finished = true;
		this.setStatus(status, detail);
	}

	fail(error) {
		this.log.error(`Stopped with error: ${error.message.split("\n")[0]}`);
		this.finishWith(STATUS.ERROR, error.message.split("\n")[0]);
	}

	// ------------------------------------------------------------ mantenimiento

	/** El juego cierra la sesión tras 10 min sin actividad de puntero/teclado. */
	async keepAlive(page) {
		if (Date.now() - this.lastKeepAlive < KEEPALIVE_MS) return;
		this.lastKeepAlive = Date.now();
		await page.evaluate(() => {
			window.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", bubbles: true }));
		});
	}

	/** El JWT dura 1 h y solo se renueva al cargar la página; se recarga solo en el portal, nunca en una mesa. */
	async reloadPortalIf(maxAgeMs) {
		if (Date.now() - this.loadedAt < maxAgeMs) return;
		this.log.info("Reloading portal");
		await this.session.page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
	}

	/** Si no aparezco como "en línea" en el portal, probablemente el socket /tour no conectó. */
	warnIfSocketSilent(snap) {
		if (this.socketWarned || Date.now() - this.portalSince < SOCKET_WARNING_AFTER_MS) return;
		const me = this.account.username.toLowerCase();
		if (snap.portalPlayers.some((p) => p.toLowerCase().includes(me))) return;
		this.socketWarned = true;
		this.log.warn(
			"I do not appear in the portal's online players list: the /tour socket may not be connected " +
				"(is the deployed frontend sending the real JWT in socket auth? it is required by the current engine)",
		);
	}

	cooldown(key, ms) {
		const now = Date.now();
		if (now < (this.cooldowns.get(key) ?? 0)) return false;
		this.cooldowns.set(key, now + ms);
		return true;
	}

	noteTransition(state) {
		const was = this.lastKind;
		if (state.kind === was) return;
		this.lastKind = state.kind;

		if (state.kind === KIND.WAITING_MATCH || state.kind === KIND.LOBBY_CLOSED) {
			this.portalSince = this.portalSince || Date.now();
			this.log.info(was && isRoom(was) ? "Match ended, waiting for next match" : "Waiting for match");
		} else if (isRoom(state.kind) && !(was && isRoom(was))) {
			this.log.info(`Match detected (${state.room})`);
		} else if (state.kind === KIND.OPPONENT_TURN && was !== KIND.ROOM_LOADING) {
			this.log.info("Waiting for turn");
		} else if (state.kind === KIND.PAUSED) {
			this.log.info("Match paused");
		}
	}
}
