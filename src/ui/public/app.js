const $ = (id) => document.getElementById(id);
const form = $("form");
const speed = $("speed");
const logEl = $("log");

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 16;

// Campos de usuario y contraseña de cada jugador (los que sobran se ocultan según el número elegido).
$("players").innerHTML = Array.from(
	{ length: MAX_PLAYERS },
	(_, n) => `<fieldset data-player="${n}"><legend>PLAYER ${n + 1}</legend>
		<label>Username<input type="text" data-user="${n}" maxlength="8" pattern="[A-Za-z0-9]{1,8}" /></label>
		<label>Password<input type="password" data-pass="${n}" /></label></fieldset>`,
).join("");

const countSelect = $("count");
for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n += 2) {
	countSelect.insertAdjacentHTML("beforeend", `<option value="${n}">${n} jugadores</option>`);
}
const playerCount = () => Number(countSelect.value);

function applyPlayerCount() {
	const count = playerCount();
	document.querySelectorAll("fieldset[data-player]").forEach((fs) => {
		const active = Number(fs.dataset.player) < count;
		fs.hidden = !active;
		for (const input of fs.querySelectorAll("input")) input.required = active;
	});
}
countSelect.addEventListener("change", applyPlayerCount);
applyPlayerCount();

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
		});
	} catch (error) {
		$("error").textContent = error.message;
	}
});

$("stop").addEventListener("click", () => post("/api/stop").catch((e) => ($("error").textContent = e.message)));

const GOOD = new Set(["Tournament finished"]);
const BAD = new Set(["Error", "Tournament cancelled"]);
const PLAYING = new Set(["My turn"]);

function renderState(state) {
	$("start").disabled = state.running;
	$("stop").disabled = !state.running && state.players.every((p) => p.status === "Stopped");
	$("stop").textContent = state.running ? "STOP" : "CLOSE BROWSERS";
	for (const el of form.querySelectorAll("input:not(#speed), select")) el.disabled = state.running;

	$("status").innerHTML = state.players
		.map((p) => {
			const cls = GOOD.has(p.status) ? "ok" : BAD.has(p.status) ? "bad" : PLAYING.has(p.status) ? "play" : "";
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
	countSelect.value = String(settings.playerCount);
	applyPlayerCount();
	settings.players.forEach((p, n) => {
		document.querySelector(`[data-user="${n}"]`).value = p.username;
		document.querySelector(`[data-pass="${n}"]`).value = p.password;
	});
	renderState(state);

	const events = new EventSource("/api/events");
	events.addEventListener("state", (e) => renderState(JSON.parse(e.data)));
	events.addEventListener("log", (e) => addLog(JSON.parse(e.data)));
}

init();
