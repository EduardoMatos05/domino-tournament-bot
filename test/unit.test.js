import assert from "node:assert/strict";
import test from "node:test";
import { SPEED_JITTER } from "../src/config/defaults.js";
import { validateRunConfig } from "../src/config/settings.js";
import { parseTournamentUrl } from "../src/config/tournamentUrl.js";
import { KIND, classify, portalBanner, roomGame, roomTournamentId } from "../src/game/classify.js";
import { tileName } from "../src/game/selectors.js";
import { moveDelayMs, shuffle } from "../src/game/timing.js";
import { describeLoginFailure } from "../src/players/auth.js";
import { DisconnectSchedule, TournamentWatch } from "../src/players/disconnects.js";

test("parseTournamentUrl toma el slug y apunta a login y portal", () => {
	const t = parseTournamentUrl("https://plataforma.amigosxeldomino.com/mi-torneo/portal-comunicacion?x=1");
	assert.equal(t.slug, "mi-torneo");
	assert.equal(t.loginUrl, "https://plataforma.amigosxeldomino.com/mi-torneo/login");
	assert.equal(t.portalUrl, "https://plataforma.amigosxeldomino.com/mi-torneo/portal-comunicacion");
});

test("parseTournamentUrl corrige torneos.* a plataforma.* y rechaza URLs sin torneo", () => {
	assert.equal(parseTournamentUrl("https://torneos.ejemplo.com/abc/").origin, "https://plataforma.ejemplo.com");
	assert.throws(() => parseTournamentUrl("https://plataforma.ejemplo.com/"), /no contiene el torneo/);
	assert.throws(() => parseTournamentUrl("no es url"), /no es válida/);
	assert.throws(() => parseTournamentUrl("ftp://x.com/a"), /http/);
});

const players = (...names) => names.map((username) => ({ username, password: "x" }));

test("validateRunConfig acepta una cantidad par de jugadores de 2 a 16, con usuarios distintos de hasta 8 caracteres", () => {
	const base = { tournamentUrl: "https://plataforma.x.com/t/login", speed: 2 };
	const named = (n) => players(...Array.from({ length: n }, (_, i) => `u${i + 1}`));

	for (const n of [2, 4, 6, 8, 10, 12, 14, 16]) {
		assert.equal(validateRunConfig({ ...base, players: named(n) }).accounts.length, n);
	}
	for (const n of [0, 1, 3, 5, 7, 15, 17, 18]) {
		assert.throws(() => validateRunConfig({ ...base, players: named(n) }), /par, de 2 a 16/, `${n} jugadores`);
	}
	assert.throws(() => validateRunConfig({ ...base, players: players("a1", "b2", "c3", "demasiadolargo") }), /1 a 8/);
	assert.throws(() => validateRunConfig({ ...base, players: players("a1", "A1") }), /repetido/);
	assert.throws(() => validateRunConfig({ ...base, speed: 9, players: players("a", "b") }), /velocidad/);
});

test("moveDelayMs varía alrededor de la velocidad y nunca se sale del margen", () => {
	assert.equal(moveDelayMs(2, () => 0.5), 2000);
	assert.equal(moveDelayMs(2, () => 0), Math.round(2000 * (1 - SPEED_JITTER)));
	for (let i = 0; i < 200; i++) {
		const ms = moveDelayMs(2);
		assert.ok(ms >= 2000 * (1 - SPEED_JITTER) - 1 && ms <= 2000 * (1 + SPEED_JITTER) + 1);
	}
	const distinct = new Set(Array.from({ length: 20 }, () => moveDelayMs(2)));
	assert.ok(distinct.size > 1, "los bots no deben actuar al mismo instante");
});

test("shuffle conserva los elementos y no muta la entrada", () => {
	const input = [1, 2, 3, 4, 5];
	const out = shuffle(input);
	assert.deepEqual([...out].sort(), input);
	assert.deepEqual(input, [1, 2, 3, 4, 5]);
});

test("tileName extrae los pips del aria-label", () => {
	assert.equal(tileName("Jugar ficha 5-3"), "5-3");
	assert.equal(tileName("Play tile 0-0"), "0-0");
});

test("describeLoginFailure da motivos legibles", () => {
	assert.match(describeLoginFailure(200, "user no exist"), /no existe/);
	assert.match(describeLoginFailure(404, "Not could find requested information"), /contraseña/);
	assert.match(describeLoginFailure(401, "InvalidCredentials"), /contraseña incorrecta$/);
	assert.match(describeLoginFailure(404, "TournamentNotFound"), /torneo no existe/);
	assert.match(describeLoginFailure(400, "MissingCredentials"), /faltan/);
	assert.match(describeLoginFailure(500, "TournamentAccessUnavailable"), /error del engine/);
	assert.match(describeLoginFailure(403, "TournamentNotAvailable"), /no está disponible/);
	assert.match(describeLoginFailure(403, "UserBan"), /baneado/);
});

const snap = (over) => ({
	path: "/torneo/portal-comunicacion",
	text: "",
	hasGameTable: false,
	hand: [],
	myFace: null,
	modalHeaders: [],
	...over,
});
const room = (over) => snap({ path: "/torneo/room/TOUR_1_MESA_1", hasGameTable: true, ...over });

test("classify: login, portal y fin de torneo", () => {
	assert.equal(classify(snap({ path: "/torneo/login" })).kind, KIND.LOGGED_OUT);
	const portal = (extra) => snap({ text: `Portal de comunicación (torneo1 - 10:00 CDMX) ${extra}` });
	assert.equal(classify(portal("Siguiente juego 02:00")).kind, KIND.WAITING_MATCH);
	assert.equal(classify(snap({ text: "" })).kind, KIND.LOADING, "página sin pintar");
	assert.equal(classify(snap({ text: "Cargando..." })).kind, KIND.LOADING);
	assert.equal(classify(snap({ text: "El portal de comunicación estará disponible hasta mañana" })).kind, KIND.LOBBY_CLOSED);
	assert.equal(classify(snap({ text: "Certamen finalizado" })).kind, KIND.TOURNAMENT_FINISHED);
	assert.equal(classify(snap({ text: "Torneo cancelado" })).kind, KIND.TOURNAMENT_CANCELLED);
	assert.equal(classify(snap({ path: "/torneo/competitor" })).kind, KIND.OTHER);
});

test("classify: modales y turnos dentro de la mesa", () => {
	const hand = ["Jugar ficha 6-1"];
	assert.equal(classify(room({ modalHeaders: ["Confirmar asistencia"] })).kind, KIND.CONFIRM_ATTENDANCE);
	assert.equal(classify(room({ modalHeaders: ["Mano 3 terminada"] })).kind, KIND.HAND_ENDED);
	assert.equal(classify(room({ modalHeaders: ["Juego terminado"] })).kind, KIND.GAME_ENDED);
	assert.equal(classify(room({ text: "Partida pausada" })).kind, KIND.PAUSED);
	assert.equal(classify(room({ text: "La partida inicia en 00:05", myFace: "mine", hand })).kind, KIND.PRE_START);
	assert.equal(classify(room({ myFace: "mine", hand })).kind, KIND.MY_TURN);
	assert.equal(classify(room({ myFace: "idle", hand })).kind, KIND.OPPONENT_TURN);
	assert.equal(classify(room({ myFace: "skipped", hand })).kind, KIND.OPPONENT_TURN);
	assert.equal(classify(room({ hasGameTable: false })).kind, KIND.ROOM_LOADING);
});

test("portalBanner reconoce la fase que muestra el portal", () => {
	assert.equal(portalBanner("Portal de comunicación Siguiente juego 02:00"), "Siguiente juego");
	assert.equal(portalBanner("Partidas en curso Hay 2 mesa(s)"), "Partidas en curso");
	assert.equal(portalBanner("Torneo o evento en pausa Reanudación: ..."), "Torneo o evento en pausa");
	assert.equal(portalBanner("Certamen finalizado"), "Certamen finalizado");
	assert.equal(portalBanner("texto sin fase"), null);
	assert.equal(portalBanner(undefined), null);
});

test("roomTournamentId saca el número del torneo del nombre de la mesa", () => {
	assert.equal(roomTournamentId("TOUR_151_RUN_1791308499319_MESA_1"), 151);
	assert.equal(roomTournamentId("TOUR_146_RUN_1_MESA_2_DEFAULT_x"), 146);
	assert.equal(roomTournamentId("sala-cualquiera"), null);
	assert.equal(roomTournamentId(undefined), null);
});

// ------------------------------------------------------------------ desconexiones programadas

test("roomGame lee el certamen/concurso y la partida del recuadro de la mesa", () => {
	const table = (event, game) => `Confirmar asistencia\nConfirmar\n1\nCertamen/Concurso: ${event}\nPartida: ${game}\nReloj general: N/D`;
	assert.deepEqual(roomGame(table("Certamen 1", 2)), { name: "Certamen 1", event: 1, game: 2 });
	assert.deepEqual(roomGame(table("Concurso 3", 12)), { name: "Concurso 3", event: 3, game: 12 });
	assert.deepEqual(roomGame(table("Mi certamen", 1)), { name: "Mi certamen", event: null, game: 1 });
	assert.equal(roomGame(table("N/D", 2)), null, "el engine aún no dijo el certamen");
	assert.equal(roomGame(table("Certamen 1", "N/D")), null, "el engine aún no dijo la partida");
	assert.equal(roomGame("Partida pausada"), null);
	assert.equal(roomGame(undefined), null);
});

test("validateRunConfig valida las desconexiones programadas", () => {
	const base = { tournamentUrl: "https://plataforma.x.com/t/login", speed: 2, players: players("a", "b", "c", "d") };
	const plan = (...disconnects) => validateRunConfig({ ...base, disconnects }).disconnects;
	const at = (event, game) => ({ event, game });

	assert.deepEqual(validateRunConfig(base).disconnects, [], "sin desconexiones");
	assert.deepEqual(plan({ player: 3, off: at(1, 2), on: at(1, 3) }), [
		{ player: 3, off: at(1, 2), on: at(1, 3), confirm: false },
	]);
	assert.equal(plan({ player: 3, off: at(1, 2), on: at(1, 3), confirm: true })[0].confirm, true, "con Confirmar");
	assert.equal(plan({ player: 3, off: at(1, 2), on: at(1, 3), confirm: "sí" })[0].confirm, false, "solo true cuenta");
	assert.equal(plan({ player: 0, off: at(1, 4), on: at(2, 1) }).length, 1, "puede volver en otro certamen/concurso");

	assert.throws(() => plan({ player: 4, off: at(1, 1), on: at(1, 2) }), /elige el bot/, "solo hay 4 jugadores");
	assert.throws(() => plan({ player: null, off: at(1, 1), on: at(1, 2) }), /elige el bot/);
	assert.throws(() => plan({ player: 0, off: at(0, 1), on: at(1, 2) }), /números de 1 a 99/);
	assert.throws(() => plan({ player: 0, off: at(1, 1), on: at(1, 1.5) }), /números de 1 a 99/);
	assert.throws(() => plan({ player: 0, off: at(1, 3), on: at(1, 3) }), /posterior/);
	assert.throws(() => plan({ player: 0, off: at(1, 3), on: at(1, 2) }), /posterior/);
	assert.throws(() => validateRunConfig({ ...base, disconnects: "x" }), /no son válidas/);
});

const game = (name, number) => ({ name, event: Number(/\d+$/.exec(name)?.[0]) || null, game: number });

test("DisconnectSchedule: se activa en su partida de desconexión y termina en la de regreso", () => {
	const schedule = new DisconnectSchedule([{ off: { event: 1, game: 2 }, on: { event: 1, game: 4 } }]);
	assert.equal(schedule.see(game("Certamen 1", 1)).started.length, 0);
	assert.equal(schedule.active, null);

	const [rule] = schedule.see(game("Certamen 1", 2)).started;
	assert.equal(schedule.active, rule);
	schedule.see(game("Certamen 1", 3));
	assert.equal(schedule.active, rule, "sigue desconectado hasta la partida de regreso");

	assert.deepEqual(schedule.see(game("Certamen 1", 4)).ended, [rule]);
	assert.equal(schedule.active, null);
	schedule.see(game("Certamen 1", 2));
	assert.equal(schedule.active, null, "una desconexión ocurre una sola vez");
});

test("DisconnectSchedule: el número del certamen/concurso sale del nombre y se encadenan desconexiones", () => {
	const schedule = new DisconnectSchedule([
		{ off: { event: 2, game: 1 }, on: { event: 2, game: 2 } },
		{ off: { event: 2, game: 2 }, on: { event: 2, game: 3 } },
	]);
	schedule.see(game("Concurso 2", 1));
	assert.ok(schedule.active, "Concurso 2 cuenta como certamen/concurso 2");
	const change = schedule.see(game("Concurso 2", 2));
	assert.equal(change.ended.length, 1, "termina la primera...");
	assert.equal(change.started.length, 1, "...y en la misma partida empieza la segunda");
	assert.ok(schedule.active);
	schedule.see(game("Concurso 2", 3));
	assert.equal(schedule.active, null);
	assert.equal(new DisconnectSchedule([{ off: { event: 1, game: 1 }, on: { event: 1, game: 2 } }]).see(game("Mi certamen", 1)).started.length, 0);
});

test("TournamentWatch: partidas sin repetir y quién sigue mirando el juego", () => {
	const watch = new TournamentWatch();
	watch.sawGame(game("Certamen 1", 1));
	watch.sawGame(game("Certamen 1", 1));
	watch.sawGame(game("Concurso 1", 1));
	watch.sawGame(game("Certamen 1", 1)); // lectura vieja de una mesa que todavía mostraba la partida anterior
	assert.deepEqual(watch.games.map((g) => `${g.name} · ${g.game}`), ["Certamen 1 · 1", "Concurso 1 · 1"]);

	assert.equal(watch.othersWatching(0), false);
	watch.look(0);
	assert.equal(watch.othersWatching(0), false, "el propio jugador no cuenta");
	watch.look(1);
	assert.equal(watch.othersWatching(0), true);
	assert.equal(watch.othersWatching(0, Date.now() + 60_000), false, "hace mucho que no mira");
});
