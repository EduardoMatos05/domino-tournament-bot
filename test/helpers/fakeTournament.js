import http from "node:http";

/**
 * Mini "juego" de mentira que imita el DOM real (login, portal, mesa, modales y alert()),
 * solo para probar al bot sin depender de un torneo real. No es una copia de las reglas del juego.
 * Usuarios: cualquiera con contraseña "ok"; contraseña distinta -> 404 (como el login real).
 */
export function startFakeTournament({
	slug = "torneo",
	tournamentId = 146,
	roomTournamentId = tournamentId,
	ignoreMoves = false, // el "servidor" recibe las jugadas pero nunca las aplica (como el caso de la cuenta en dos torneos)
} = {}) {
	const moves = []; // lo que el "servidor" recibió: [{tile, side}]
	const server = http.createServer(async (req, res) => {
		const url = new URL(req.url, "http://x");
		if (req.method === "POST" && url.pathname === "/api/token/tournament") {
			let raw = "";
			for await (const c of req) raw += c;
			const { user_password } = JSON.parse(raw);
			if (user_password !== "ok") {
				res.writeHead(404, { "content-type": "text/plain" });
				return res.end("Not could find requested information");
			}
			res.writeHead(200, { "content-type": "application/json" });
			return res.end(JSON.stringify({ access_token: "jwt", refresh_token: "r" }));
		}
		if (req.method === "POST" && url.pathname === "/move") {
			let raw = "";
			for await (const c of req) raw += c;
			moves.push(JSON.parse(raw));
			res.writeHead(204);
			return res.end();
		}
		res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		const fill = (html) =>
			html.replaceAll("@TID@", tournamentId).replaceAll("@RTID@", roomTournamentId).replaceAll("@IGNORE@", String(ignoreMoves));
		if (url.pathname === `/${slug}/login`) return res.end(fill(LOGIN));
		if (url.pathname === `/${slug}/portal-comunicacion`) return res.end(fill(PORTAL));
		if (url.pathname.startsWith(`/${slug}/room/`)) return res.end(fill(ROOM));
		res.end(`<p>OTHER ${url.pathname}</p>`);
	});
	return new Promise((resolve) =>
		server.listen(0, "127.0.0.1", () =>
			resolve({
				origin: `http://127.0.0.1:${server.address().port}`,
				slug,
				moves,
				close: () => server.close(),
			}),
		),
	);
}

const LOGIN = `<!doctype html><body>
<input name="user_email" type="text"><input name="user_password" type="password">
<script>
const [u, p] = document.querySelectorAll('input');
p.addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  const r = await fetch('/api/token/tournament', { method: 'POST', body: JSON.stringify({ user_email: u.value, user_password: p.value }) });
  if (r.ok) sessionStorage.setItem('Context', JSON.stringify({ id_tournament: @TID@ }));
  if (r.ok) location.pathname = location.pathname.replace('/login', '/competitor');
});
</script></body>`;

// Portal: 1ª visita -> espera y "el servidor" asigna mesa; tras jugar -> "Certamen finalizado".
const PORTAL = `<!doctype html><body><div>Portal de comunicación (jugador - 10:00 CDMX)</div>
<div id="banner"></div>
<script>
const played = sessionStorage.getItem('played');
document.getElementById('banner').textContent = played ? 'Certamen finalizado' : 'Siguiente juego';
if (!played) setTimeout(() => { location.pathname = location.pathname.replace('portal-comunicacion', 'room/TOUR_@RTID@_RUN_1_MESA_1'); }, 1500);
</script></body>`;

const ROOM = `<!doctype html><body>
<div data-game-shell><div data-game-table>
  <div id="seat"><div><img id="face" alt="turno de jugador" src="/assets/emptyface-abc.svg"><span>yo</span></div><div id="hand"></div></div>
  <img alt="turno de jugador" src="/assets/carita_base-zzz.svg">
</div></div>
<div id="overlay"></div><div id="modals"></div>
<script>
let hand = (new URLSearchParams(location.search).get('hand') || '6-1,2-3,5-5,4-0,3-3,1-2,0-0').split(',');
let ends = [3, 5], myTurn = false, moveCount = 0, halted = true;
const $ = (id) => document.getElementById(id);
const modal = (title, button, onClick) => {
  $('modals').innerHTML = '<div class="fixed z-50"><div><header>' + title + '</header><button>' + button + '</button></div></div>';
  $('modals').querySelector('button').onclick = () => { $('modals').innerHTML = ''; onClick(); };
};
function render() {
  $('face').src = myTurn ? '/assets/carita_base-1a2b.svg' : '/assets/emptyface-9f9f.svg';
  $('hand').innerHTML = '';
  for (const t of hand) {
    const b = document.createElement('button');
    b.setAttribute('aria-label', 'Jugar ficha ' + t); b.textContent = t;
    b.onclick = () => click(t);
    $('hand').append(b);
  }
}
function click(tile) {
  if (halted) return;
  if (!myTurn) return alert('No es su turno');
  const [a, b] = tile.split('-').map(Number);
  const hits = ends.filter((e) => e === a || e === b);
  if (!hits.length) return alert('La ficha no tiene cabida');
  if (ends[0] !== ends[1] && ((a === ends[0] && b === ends[1]) || (b === ends[0] && a === ends[1]))) {
    $('modals').innerHTML = '<div id="modalGame"><button><span>Cerrar modal</span></button><div class="flex flex-col gap-3">' +
      '<button>Sección 1 (arriba)</button><button>Sección 3 (abajo)</button></div></div>';
    [...document.querySelectorAll('#modalGame .gap-3 button')].forEach((btn, i) => btn.onclick = () => { $('modals').innerHTML = ''; play(tile, i ? 'abajo' : 'arriba'); });
    return;
  }
  play(tile, 'unica');
}
function play(tile, side) {
  fetch('/move', { method: 'POST', body: JSON.stringify({ tile, side }) });
  if (@IGNORE@) return;
  setTimeout(() => { // el "servidor" confirma
    hand = hand.filter((t) => t !== tile); myTurn = false; moveCount++;
    const rest = hand.flatMap((t) => t.split('-').map(Number));
    ends = [rest[0] ?? 0, rest[rest.length - 1] ?? 0];
    render();
    if (moveCount === 3) return modal('Mano 1 terminada', 'Aceptar', () => setTimeout(() => modal('Juego terminado', 'Aceptar', () => {
      sessionStorage.setItem('played', '1'); location.pathname = location.pathname.replace(/room\\/.*/, 'portal-comunicacion');
    }), 400));
    setTimeout(() => { myTurn = true; render(); }, 600);
  }, 150);
}
render();
modal('Confirmar asistencia', 'Confirmar', () => {
  $('overlay').textContent = 'La partida inicia en 00:01';
  setTimeout(() => { $('overlay').textContent = ''; halted = false; myTurn = true; render(); }, 1000);
});
</script></body>`;
