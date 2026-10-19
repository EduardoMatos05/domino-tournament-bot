import {
	ALONE_RECONNECT_MS,
	CONFIRM_THEN_LEAVE_MS,
	GAME_INFO_WAIT_MS,
	HEARTBEAT_LOG_MS,
	KEEPALIVE_MS,
	LOBBY_CLOSED_RELOAD_MS,
	MAX_CONSECUTIVE_ERRORS,
	MAX_RELOGINS,
	MOVE_CONFIRM_TIMEOUT_MS,
	POLL_MS,
	PORTAL_RELOAD_MS,
	PREPARE_MS,
	ROOM_POLL_MS,
	TERMINAL_CONFIRMATIONS,
	UNCONFIRMED_BACKOFF_MS,
} from "../config/defaults.js";
import { launchPlayerBrowser } from "../browser/launch.js";
import { KIND, WAITING_BANNERS, classify, isRoom, portalBanner, roomGame, roomTournamentId } from "../game/classify.js";
import { playRandomMove, watchDialogs } from "../game/moves.js";
import { TEXT } from "../game/selectors.js";
import { takeSnapshot } from "../game/snapshot.js";
import { moveDelayMs, sleep } from "../game/timing.js";
import { LoginError, goToPortal, login } from "./auth.js";
import { DisconnectSchedule, TournamentWatch, gameLabel, pointLabel } from "./disconnects.js";

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
	DISCONNECTED: "Disconnected", // desconexión programada: ventana cerrada hasta la espera de la siguiente partida
	FINISHED: "Tournament finished",
	CANCELLED: "Tournament cancelled",
	ERROR: "Error",
	STOPPED: "Stopped",
};

const TERMINAL = new Set([STATUS.FINISHED, STATUS.CANCELLED, STATUS.ERROR, STATUS.STOPPED]);

// Mensaje al entrar en cada estado de la mesa (los de espera sencilla se registran una sola vez por cambio).
const ROOM_MESSAGES = {
	[KIND.ROOM_LOADING]: "Table loading",
	[KIND.PRE_START]: "Match starting",
	[KIND.HAND_ENDED]: "Hand ended",
	[KIND.GAME_ENDED]: "Match finished",
	[KIND.PAUSED]: "Match paused",
};

/** La página navegó justo mientras se leía: es normal y se reintenta sin ruido. */
const isNavigationRace = (error) =>
	/Execution context was destroyed|most likely because of a navigation|Frame was detached/i.test(error?.message ?? "");

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
	 * @param {{off:{event:number,game:number}, on:{event:number,game:number}, confirm?:boolean}[]} [o.disconnects]  desconexiones programadas de este jugador
	 * @param {TournamentWatch} [o.watch]  lo que ven todos los bots de la corrida (compartido)
	 */
	constructor({ index, total, account, tournament, speed, logger, headless, onChange, disconnects = [], watch }) {
		this.index = index;
		this.total = total;
		this.name = `Player ${index + 1}`;
		this.account = account;
		this.tournament = tournament;
		this.speed = speed;
		// Cada línea de log marca la hora, para avisar con una línea de "sigue vivo" si pasa mucho sin novedades.
		const touch = () => {
			this.lastLogAt = Date.now();
		};
		this.log = {
			info: (m) => (touch(), logger.info(m)),
			warn: (m) => (touch(), logger.warn(m)),
			error: (m) => (touch(), logger.error(m)),
		};
		this.lastLogAt = Date.now();
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
		this.tournamentId = null; // número del torneo de esta corrida (sale de la sesión del jugador)
		this.lastBanner = null;
		this.unconfirmed = 0; // jugadas seguidas que la pantalla aceptó y el servidor no
		this.loggedOutHits = 0;
		this.warnedFace = false;
		this.lastText = "";
		this.finished = false;

		this.schedule = new DisconnectSchedule(disconnects);
		this.watch = watch ?? new TournamentWatch();
		this.gamesSeen = 0; // cuántas partidas de watch.games ya se revisaron contra las desconexiones
		this.room = null; // mesa actual y su partida (cuando la mesa la muestra)
		this.roomSince = 0;
		this.game = null;
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
			await this.readTournamentId();
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
				if (isNavigationRace(error) && !this.session?.page.isClosed()) {
					await sleep(300, this.abort.signal);
					continue;
				}
				consecutiveErrors += 1;
				this.log.error(`Error: ${error.message.split("\n")[0]}`);
				if (!this.session) throw error; // no se pudo volver a abrir el navegador tras una desconexión programada
				if (this.session.page.isClosed()) throw new Error("the browser window was closed");
				if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) throw new Error("too many consecutive errors");
				await sleep(1_000, this.abort.signal);
			}
			await sleep(this.lastKind && isRoom(this.lastKind) ? ROOM_POLL_MS : POLL_MS, this.abort.signal);
		}
	}

	async step() {
		const { page } = this.session;
		this.watch.look(this.index);
		await this.keepAlive(page);

		const snap = await takeSnapshot(page);
		this.lastText = snap.text;
		const state = classify(snap);
		this.noteTransition(state);
		this.noteBanner(state, snap.text);
		this.noteGame(state, snap.text);
		if (Date.now() - this.lastLogAt >= HEARTBEAT_LOG_MS) {
			this.log.info(`Still: ${this.status}${this.detail ? ` (${this.detail})` : ""}`);
		}

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

			case KIND.LOADING:
				return; // la página todavía está pintando

			case KIND.LOBBY_CLOSED:
				this.setStatus(STATUS.WAITING_LOBBY);
				return this.reloadPortalIf(LOBBY_CLOSED_RELOAD_MS);

			case KIND.WAITING_MATCH: {
				// Empezó la partida de desconexión y este jugador no tiene mesa en ella (la vieron otros bots).
				const [rule] = this.syncGames();
				if (rule) return this.goOffline(rule, `Scheduled disconnect at ${pointLabel(rule.off)}`);
				this.setStatus(STATUS.WAITING_MATCH);
				return this.reloadPortalIf(PORTAL_RELOAD_MS);
			}

			case KIND.TOURNAMENT_FINISHED:
			case KIND.TOURNAMENT_CANCELLED:
				return this.confirmTerminal(state.kind);

			case KIND.CONFIRM_ATTENDANCE:
				return this.attend(page);

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
			this.unconfirmed = 0;
			// Tiempo real desde que el bot notó su turno hasta que la jugada salió hacia el servidor.
			this.log.info(`Move sent ${((result.sentAt - turnStartedAt) / 1000).toFixed(1)}s after my turn started`);
			return;
		}

		if (result.reason === "unconfirmed") {
			this.unconfirmed += 1;
			const n = this.unconfirmed;
			if (n === 1) {
				this.log.warn(
					`Tile ${result.tile} was clicked but the game did not take it (still in my hand after ${MOVE_CONFIRM_TIMEOUT_MS / 1000}s)`,
				);
			} else if (n === 3 || n % 10 === 0) {
				this.log.warn(
					`${n} moves in a row were not accepted: the screen takes the tile but the server ignores it. ` +
						"Check the engine (tour) logs; an account enrolled in two active tournaments can cause this.",
				);
			}
			await sleep(UNCONFIRMED_BACKOFF_MS[Math.min(n, UNCONFIRMED_BACKOFF_MS.length) - 1], this.abort.signal);
			return;
		}

		await sleep(1_000, this.abort.signal); // no martillar el click
	}

	/**
	 * Mesa de espera. Antes de confirmar asistencia se mira qué partida es: si este jugador tiene una
	 * desconexión programada que empieza (o sigue) en esta partida, cierra su ventana sin confirmar
	 * (o, si la desconexión lleva "Confirmar", después de confirmar).
	 */
	async attend(page) {
		this.setStatus(STATUS.CONFIRMING);
		if (this.schedule.rules.length > 0) {
			// La mesa muestra la partida junto con este modal; si tarda, se espera un poco antes de decidir.
			if (!this.game && Date.now() - this.roomSince < GAME_INFO_WAIT_MS) return;
			if (!this.game && this.cooldown("no-game-info", 60_000)) {
				this.log.warn("This table does not show which game it is; scheduled disconnects only use what other bots saw");
			}
			const started = this.syncGames();
			const rule = this.schedule.active;
			if (rule) {
				const at = this.game ? gameLabel(this.game) : null;
				const reason = started.includes(rule)
					? `Scheduled disconnect at ${at ?? pointLabel(rule.off)}`
					: `Still disconnected${at ? ` (${at})` : ""}`;
				if (!rule.confirm) return this.goOffline(rule, `${reason}: not confirming attendance`);
				// Si el botón todavía no está, se reintenta en la siguiente vuelta (la regla ya quedó activa).
				if (!(await this.clickOnce(page, "attendance", TEXT.confirmButton, "Attendance confirmed"))) return;
				await sleep(CONFIRM_THEN_LEAVE_MS, this.abort.signal); // el juego avisa al servidor por socket: que salga antes de cerrar
				if (this.abort.signal.aborted) return;
				return this.goOffline(rule, `${reason}: attendance confirmed, closing window`);
			}
		}
		return this.clickOnce(page, "attendance", TEXT.confirmButton, "Attendance confirmed");
	}

	/**
	 * Desconexión programada: cierra la ventana de este jugador y la vuelve a abrir cuando el torneo pasa a la
	 * espera de la siguiente partida (lo avisan los demás bots). Si esa partida todavía no es la de regreso,
	 * al llegar a su mesa se vuelve a desconectar sin confirmar.
	 */
	async goOffline(rule, reason) {
		this.log.info(reason);
		await this.closeSession();
		this.log.info(`Window closed until the wait for the next game (back at ${pointLabel(rule.on)})`);
		this.setStatus(STATUS.DISCONNECTED, `back at ${pointLabel(rule.on)}`);

		const since = Date.now();
		let aloneSince = null;
		while (!this.abort.signal.aborted) {
			if (this.watch.waitingAt > since) {
				this.log.info("The tournament is waiting for the next game: reconnecting");
				break;
			}
			// Si ningún otro bot mira el torneo nadie avisará: se vuelve a entrar de vez en cuando a revisarlo.
			if (this.watch.othersWatching(this.index)) aloneSince = null;
			else aloneSince ??= Date.now();
			if (aloneSince && Date.now() - aloneSince >= ALONE_RECONNECT_MS) {
				this.log.warn("No other bot is watching the tournament: reconnecting to check it myself");
				break;
			}
			if (Date.now() - this.lastLogAt >= HEARTBEAT_LOG_MS) this.log.info(`Still: ${this.status} (${this.detail})`);
			await sleep(1_000, this.abort.signal);
		}
		if (this.abort.signal.aborted) return;

		this.lastKind = null;
		this.lastBanner = null;
		this.room = null;
		this.game = null;
		this.setStatus(STATUS.STARTING);
		await this.openSession();
		if (this.abort.signal.aborted) {
			await this.closeSession(); // Stop mientras se abría el navegador
			return;
		}
		await this.loginOrFail();
	}

	/** Avanza las desconexiones programadas con las partidas que vio cualquier bot. Devuelve las que acaban de empezar. */
	syncGames() {
		const started = [];
		while (this.gamesSeen < this.watch.games.length) {
			const game = this.watch.games[this.gamesSeen++];
			const change = this.schedule.see(game);
			started.push(...change.started);
			if (change.ended.length > 0) this.log.info(`Back at ${gameLabel(game)}: playing normally`);
		}
		return started;
	}

	/** Devuelve si hizo click. */
	async clickOnce(page, key, buttonText, doneMessage) {
		if (!this.cooldown(key, 2_000)) return false;
		const button = page.locator("div.fixed.z-50 button").filter({ hasText: new RegExp(`^\\s*${buttonText}\\s*$`) });
		if ((await button.count()) === 0) return false;
		await button.first().click({ timeout: 3_000 });
		this.log.info(doneMessage);
		return true;
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
		this.watch.sawWaiting(); // los bots desconectados vuelven a entrar para ver el final ellos también
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

	cooldown(key, ms) {
		const now = Date.now();
		if (now < (this.cooldowns.get(key) ?? 0)) return false;
		this.cooldowns.set(key, now + ms);
		return true;
	}

	noteTransition(state) {
		const was = this.lastKind;
		if (state.kind === was || state.kind === KIND.LOADING) return;
		this.lastKind = state.kind;

		if (state.kind === KIND.LOBBY_CLOSED) {
			this.log.info("Waiting for the portal to open");
		} else if (state.kind === KIND.WAITING_MATCH) {
			this.log.info(was && isRoom(was) ? "Match ended, waiting for next match" : "Waiting for match");
		} else if (isRoom(state.kind) && !(was && isRoom(was))) {
			this.log.info(`Match detected (${state.room})`);
			this.unconfirmed = 0;
			this.lastBanner = null;
			this.checkRoomTournament(state.room);
		} else if (state.kind === KIND.OPPONENT_TURN) {
			if (was !== KIND.ROOM_LOADING) this.log.info("Waiting for turn");
		} else if (ROOM_MESSAGES[state.kind]) {
			this.log.info(ROOM_MESSAGES[state.kind]);
		}
	}

	/** Registra el título de fase del portal ("Siguiente juego", "Partidas en curso"...) cuando cambia. */
	noteBanner(state, text) {
		if (![KIND.WAITING_MATCH, KIND.LOBBY_CLOSED].includes(state.kind)) return;
		const banner = portalBanner(text);
		if (!banner || banner === this.lastBanner) return;
		this.lastBanner = banner;
		this.log.info(`Portal: ${banner}`);
		if (WAITING_BANNERS.includes(banner)) this.watch.sawWaiting();
	}

	/** Qué partida es la de esta mesa: se registra una vez por mesa y se comparte con los demás bots. */
	noteGame(state, text) {
		if (!state.room) return;
		if (state.room !== this.room) {
			this.room = state.room;
			this.roomSince = Date.now();
			this.game = null;
		}
		if (this.game) return;
		this.game = roomGame(text);
		if (!this.game) return;
		this.log.info(`Game: ${gameLabel(this.game)}`);
		this.watch.sawGame(this.game);
	}

	/** Si la mesa es de otro torneo, el engine mezcló a esta cuenta con otro torneo activo. */
	checkRoomTournament(room) {
		const roomTournament = roomTournamentId(room);
		if (!this.tournamentId || !roomTournament || roomTournament === this.tournamentId) return;
		this.log.warn(
			`This table belongs to tournament ${roomTournament}, but this run is for tournament ${this.tournamentId} ` +
				`("${this.tournament.slug}"). The account is enrolled in another active tournament and the engine sent it there.`,
		);
	}

	/** Número del torneo de esta corrida, tomado de la sesión que guarda el propio juego tras el login. */
	async readTournamentId() {
		for (let attempt = 0; attempt < 6 && !this.abort.signal.aborted; attempt++) {
			const id = await this.session.page
				.evaluate(() => {
					try {
						return Number(JSON.parse(sessionStorage.getItem("Context") ?? "{}").id_tournament) || null;
					} catch {
						return null;
					}
				})
				.catch(() => null);
			if (id) {
				this.tournamentId = id;
				this.log.info(`Tournament id: ${id}`);
				return;
			}
			await sleep(500, this.abort.signal);
		}
	}
}
