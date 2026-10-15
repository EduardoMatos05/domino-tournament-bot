/**
 * Desconexiones programadas (sección "Disconnect bots" de la interfaz).
 *
 * Cada una dice: el jugador N se desconecta en "Certamen/Concurso X · Partida Y" y vuelve en
 * "Certamen/Concurso X' · Partida Y'". El bot no conoce el orden de partidas del torneo: lee en cada mesa
 * qué partida es (el juego lo muestra arriba a la derecha) y los bots si conectados pasan lo que ven, porque uno
 * desconectado no tiene ventana para ver.
 */

const WATCHING_MS = 10_000;

/** "Certamen/Concurso 1 · Partida 2": un punto elegido en la interfaz (solo números). */
export const pointLabel = ({ event, game }) => `Certamen/Concurso ${event} · Partida ${game}`;

/** "Certamen 1 · Partida 2": una partida leída en una mesa. */
export const gameLabel = ({ name, game }) => `${name} · Partida ${game}`;

/** El número del certamen/concurso es el de su nombre ("Concurso 2" -> 2), como lo muestra la mesa. */
const isAt = (game, point) => game.event === point.event && game.game === point.game;

/**
 * Desconexiones de un jugador. Cada una pasa por: pendiente -> activa (empezó su partida de desconexión)
 * -> terminada (empezó su partida de regreso). Mientras alguna está activa, el jugador no confirma asistencia.
 */
export class DisconnectSchedule {
	/** @param {{off:{event:number,game:number}, on:{event:number,game:number}}[]} rules */
	constructor(rules = []) {
		this.rules = rules.map((rule) => ({ ...rule, state: "pending" }));
	}

	get active() {
		return this.rules.find((rule) => rule.state === "active") ?? null;
	}

	/** Empezó una partida (la vio este jugador u otro). Devuelve las desconexiones que empezaron y las que terminaron con ella. */
	see(game) {
		const started = [];
		const ended = [];
		for (const rule of this.rules) {
			if (rule.state === "pending" && isAt(game, rule.off)) {
				rule.state = "active";
				started.push(rule);
			} else if (rule.state === "active" && isAt(game, rule.on)) {
				rule.state = "done";
				ended.push(rule);
			}
		}
		return { started, ended };
	}
}

/**
 * Lo que los bots van viendo del torneo, compartido entre todos. Así un bot desconectado sabe qué partidas
 * empezaron y cuándo volver: cuando el torneo pasa a la espera de la siguiente partida (o termina).
 */
export class TournamentWatch {
	constructor() {
		this.games = []; // partidas en el orden en que aparecieron en alguna mesa
		this.seen = new Set();
		this.waitingAt = 0; // última vez que algún portal pasó a la espera de la siguiente partida, o que el torneo terminó
		this.lastLook = new Map(); // jugador -> última vez que miró el juego
	}

	/** Cada vuelta del bucle de un jugador con la ventana abierta. */
	look(player) {
		this.lastLook.set(player, Date.now());
	}

	/** Una mesa mostró qué partida es. Una partida no se repite en un torneo: si ya estaba, es una lectura vieja. */
	sawGame(game) {
		const key = `${game.name}#${game.game}`;
		if (this.seen.has(key)) return;
		this.seen.add(key);
		this.games.push(game);
	}

	/** El torneo pasó a la espera de la siguiente partida, o terminó: los bots desconectados pueden volver. */
	sawWaiting() {
		this.waitingAt = Date.now();
	}

	/** ¿Algún otro jugador está mirando el juego ahora? */
	othersWatching(player, now = Date.now()) {
		for (const [other, at] of this.lastLook) {
			if (other !== player && now - at < WATCHING_MS) return true;
		}
		return false;
	}
}
