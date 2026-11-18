const $ = (id) => document.getElementById(id);
const form = $("form");
const speed = $("speed");
const logEl = $("log");
const disconnectsEl = $("disconnects");

const MIN_PLAYERS = 1;
const MAX_GAME = 99; // tope de los cuadros de certamen/concurso y partida

const playersEl = $("players");
const countInput = $("count");
// Cuentas con las que se llenan los espacios: las guardadas al abrir la página, o las de prueba al pulsar Aceptar.
let accounts = [];
const playerCount = () => playersEl.childElementCount;

/** Genera un espacio de usuario y contraseña por cada jugador. */
function renderPlayers(count) {
	playersEl.innerHTML = Array.from(
		{ length: count },
		(_, n) => `<fieldset data-player="${n}"><legend>PLAYER ${n + 1}</legend>
			<label>Username<input type="text" data-user="${n}" maxlength="8" pattern="[A-Za-z0-9]{1,8}" required /></label>
			<label>Password<input type="password" data-pass="${n}" required /></label></fieldset>`,
	).join("");
	for (let n = 0; n < count; n++) {
		document.querySelector(`[data-user="${n}"]`).value = accounts[n]?.username ?? "";
		document.querySelector(`[data-pass="${n}"]`).value = accounts[n]?.password ?? "";
	}
	countInput.value = String(count);
	refreshDisconnectPlayers();
}

// Cuentas de prueba de la base de datos: el jugador N usa "torneoN" como usuario y como contraseña.
const testAccount = (n) => ({ username: `torneo${n + 1}`, password: `torneo${n + 1}` });

function applyPlayerCount() {
	$("error").textContent = "";
	const count = Number(countInput.value);
	if (!Number.isInteger(count) || count < MIN_PLAYERS) {
		$("error").textContent = `El número de jugadores debe ser un entero de ${MIN_PLAYERS} o más.`;
		return;
	}
	// Aceptar llena todos los espacios con las cuentas de prueba; después se pueden editar a mano.
	accounts = Array.from({ length: count }, (_, n) => testAccount(n));
	renderPlayers(count);
}
$("applyCount").addEventListener("click", applyPlayerCount);
// Enter en el número de jugadores genera los espacios en lugar de iniciar el torneo.
countInput.addEventListener("keydown", (event) => {
	if (event.key !== "Enter") return;
	event.preventDefault();
	applyPlayerCount();
});

// Desconexiones programadas: cada fila es un bot, cuándo se desconecta y cuándo vuelve (certamen/concurso y partida).
const numberField = (label, key) =>
	`<label>${label}<input type="number" data-d="${key}" min="1" max="${MAX_GAME}" step="1" required /></label>`;
const pointFields = (title, prefix) => `<fieldset><legend>${title}</legend>
	${numberField("Certamen/Concurso", `${prefix}Event`)}${numberField("Partida", `${prefix}Game`)}</fieldset>`;
const field = (row, key) => row.querySelector(`[data-d="${key}"]`);

function fillPlayerSelect(select, selected) {
	const options = Array.from({ length: playerCount() }, (_, n) => {
		const user = document.querySelector(`[data-user="${n}"]`).value.trim();
		return `<option value="${n}">Player ${n + 1}${user ? ` · ${escapeHtml(user)}` : ""}</option>`;
	});
	select.innerHTML = `<option value="">Elige un bot</option>${options.join("")}`;
	select.value = selected !== "" && Number(selected) < playerCount() ? String(selected) : "";
}

/** La lista de bots sigue al número de jugadores y a sus usuarios. */
function refreshDisconnectPlayers() {
	for (const select of disconnectsEl.querySelectorAll('[data-d="player"]')) fillPlayerSelect(select, select.value);
}

function setPoint(row, prefix, { event, game }) {
	field(row, `${prefix}Event`).value = event;
	field(row, `${prefix}Game`).value = game;
}

function addDisconnect({ player = "", off = { event: 1, game: 1 }, on, confirm = false } = {}) {
	disconnectsEl.insertAdjacentHTML(
		"beforeend",
		`<div class="disconnect">
			<label>Bot<select data-d="player" required></select></label>
			${pointFields("Disconnect at", "off")}
			${pointFields("Reconnect at", "on")}
			<label class="confirm" title="Confirma asistencia y después se desconecta">
				<input type="checkbox" data-d="confirm" />Confirmar
			</label>
			<button type="button" class="remove" title="Quitar" aria-label="Quitar desconexión">×</button>
		</div>`,
	);
	const row = disconnectsEl.lastElementChild;
	fillPlayerSelect(field(row, "player"), player);
	setPoint(row, "off", off);
	setPoint(row, "on", on ?? { event: off.event, game: off.game + 1 });
	field(row, "confirm").checked = confirm;
}

const readPoint = (row, prefix) => ({
	event: Number(field(row, `${prefix}Event`).value),
	game: Number(field(row, `${prefix}Game`).value),
});

const disconnectPlan = () =>
	[...disconnectsEl.children].map((row) => {
		const player = field(row, "player").value;
		return {
			player: player === "" ? null : Number(player),
			off: readPoint(row, "off"),
			on: readPoint(row, "on"),
			confirm: field(row, "confirm").checked,
		};
	});

$("addDisconnect").addEventListener("click", () => addDisconnect());
disconnectsEl.addEventListener("click", (event) => {
	if (event.target.closest(".remove")) event.target.closest(".disconnect").remove();
});
// Al elegir cuándo se desconecta, el regreso se rellena con la partida siguiente (se puede cambiar después).
disconnectsEl.addEventListener("input", (event) => {
	const key = event.target.dataset.d;
	if (key !== "offEvent" && key !== "offGame") return;
	const row = event.target.closest(".disconnect");
	const off = readPoint(row, "off");
	if (off.event >= 1 && off.game >= 1) setPoint(row, "on", { event: off.event, game: Math.min(off.game + 1, MAX_GAME) });
});
$("players").addEventListener("input", (event) => {
	if (event.target.dataset.user !== undefined) refreshDisconnectPlayers();
});

const fmt = (v) => `${Number(v).toFixed(1)}s`;
speed.addEventListener("input", () => {
	$("speedValue").textContent = fmt(speed.value);
});
// Cambiar la velocidad con el torneo en marcha surte efecto en la siguiente jugada.
speed.addEventListener("change", () => {
	post("/api/speed", { speed: Number(speed.value) }).catch(() => {});
});

async function post(path, body = {}) {
	const res = await fetch(path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
	return data;
}

form.addEventListener("submit", async (event) => {
	event.preventDefault();
	$("error").textContent = "";
	try {
		await post("/api/start", {
			tournamentUrl: $("url").value.trim(),
			speed: Number(speed.value),
			remember: $("remember").checked,
			players: Array.from({ length: playerCount() }, (_, n) => ({
				username: document.querySelector(`[data-user="${n}"]`).value.trim(),
				password: document.querySelector(`[data-pass="${n}"]`).value,
			})),
			disconnects: disconnectPlan(),
		});
	} catch (error) {
		$("error").textContent = error.message;
	}
});

$("stop").addEventListener("click", () => post("/api/stop").catch((e) => ($("error").textContent = e.message)));

// Color del punto de estado de cada jugador.
const DOT = {
	"Tournament finished": "ok",
	Error: "bad",
	"Tournament cancelled": "bad",
	"My turn": "play",
	Disconnected: "off",
};

function renderState(state) {
	$("start").disabled = state.running;
	$("stop").disabled = !state.running && state.players.every((p) => p.status === "Stopped");
	$("stop").textContent = state.running ? "STOP" : "CLOSE BROWSERS";
	// Las desconexiones se fijan al iniciar: no se editan con el torneo en marcha.
	for (const el of form.querySelectorAll("input:not(#speed), select, #applyCount, #addDisconnect, .disconnect .remove")) {
		el.disabled = state.running;
	}

	$("status").innerHTML = state.players
		.map((p) => {
			const cls = DOT[p.status] ?? "";
			const detail = p.detail ? ` <small>(${escapeHtml(p.detail)})</small>` : "";
			return `<tr><td><span class="dot ${cls}"></span>${p.name} <small>${escapeHtml(p.username)}</small></td>
				<td class="status">${escapeHtml(p.status)}${detail}</td></tr>`;
		})
		.join("");
	$("logFile").textContent = state.logFile ? `Log: ${state.logFile}` : "";
}

function addLog({ time, level, text }) {
	const stick = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 24;
	const line = document.createElement("div");
	line.className = level;
	line.textContent = `${new Date(time).toLocaleTimeString()} ${text}`;
	logEl.append(line);
	while (logEl.childElementCount > 1000) logEl.firstChild.remove();
	if (stick) logEl.scrollTop = logEl.scrollHeight;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function init() {
	const { settings, speedRange, state } = await (await fetch("/api/state")).json();
	$("url").value = settings.tournamentUrl;
	speed.min = speedRange.min;
	speed.max = speedRange.max;
	speed.step = speedRange.step;
	speed.value = state.running ? state.speed : settings.speed;
	$("speedValue").textContent = fmt(speed.value);
	accounts = settings.players;
	renderPlayers(settings.playerCount);
	for (const d of settings.disconnects) addDisconnect(d);
	renderState(state);

	const events = new EventSource("/api/events");
	events.addEventListener("state", (e) => renderState(JSON.parse(e.data)));
	events.addEventListener("log", (e) => addLog(JSON.parse(e.data)));
}

init();
