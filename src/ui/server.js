import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SPEED } from "../config/defaults.js";
import { loadSettings, saveSettings, validateRunConfig } from "../config/settings.js";
import { logger } from "../logger/logger.js";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const FILES = {
	"/": ["index.html", "text/html; charset=utf-8"],
	"/app.js": ["app.js", "text/javascript; charset=utf-8"],
	"/style.css": ["style.css", "text/css; charset=utf-8"],
};

/**
 * Servidor local mínimo (solo 127.0.0.1) para la interfaz: formulario, estado y log en vivo.
 * Maneja contraseñas, así que rechaza otros hosts (DNS rebinding) y exige JSON en los POST.
 */
export function createUiServer({ runner, port }) {
	const clients = new Set();
	const send = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
	const broadcast = (event, data) => {
		for (const res of clients) send(res, event, data);
	};
	runner.on("state", (state) => broadcast("state", state));
	logger.on("line", (line) => broadcast("log", line));

	const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

	const server = http.createServer(async (req, res) => {
		try {
			if (!allowedHosts.has(req.headers.host ?? "")) return reply(res, 403, { error: "Host no permitido" });
			const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

			if (req.method === "GET" && FILES[url.pathname]) {
				const [file, type] = FILES[url.pathname];
				res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
				return res.end(fs.readFileSync(path.join(PUBLIC_DIR, file)));
			}

			if (req.method === "GET" && url.pathname === "/api/state") {
				return reply(res, 200, { settings: loadSettings(), speedRange: SPEED, state: runner.snapshot() });
			}

			if (req.method === "GET" && url.pathname === "/api/events") {
				res.writeHead(200, {
					"content-type": "text/event-stream",
					"cache-control": "no-store",
					connection: "keep-alive",
				});
				send(res, "state", runner.snapshot());
				for (const line of logger.buffer) send(res, "log", line);
				clients.add(res);
				req.on("close", () => clients.delete(res));
				return;
			}

			if (req.method === "POST") {
				if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) {
					return reply(res, 415, { error: "Se esperaba JSON" });
				}
				const body = await readJson(req);

				if (url.pathname === "/api/start") {
					const config = validateRunConfig(body);
					if (body.remember) {
						const previous = loadSettings();
						saveSettings({
							tournamentUrl: body.tournamentUrl,
							speed: config.speed,
							playerCount: body.players.length,
							// conserva las cuentas de los jugadores que esta vez no se usan
							players: previous.players.map((p, i) => body.players[i] ?? p),
						});
					}
					await runner.start(config);
					return reply(res, 200, { ok: true });
				}
				if (url.pathname === "/api/stop") {
					await runner.stop();
					return reply(res, 200, { ok: true });
				}
				if (url.pathname === "/api/speed") {
					const speed = Number(body.speed);
					if (!(speed >= SPEED.min && speed <= SPEED.max)) return reply(res, 400, { error: "Velocidad fuera de rango" });
					runner.setSpeed(speed);
					return reply(res, 200, { ok: true });
				}
			}

			reply(res, 404, { error: "No encontrado" });
		} catch (error) {
			reply(res, 400, { error: error.message });
		}
	});

	return {
		listen: () =>
			new Promise((resolve, reject) => {
				server.once("error", reject);
				server.listen(port, "127.0.0.1", () => resolve(`http://127.0.0.1:${port}`));
			}),
		close: () => {
			for (const res of clients) res.end();
			server.close();
		},
	};
}

function reply(res, status, body) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(body));
}

function readJson(req) {
	return new Promise((resolve, reject) => {
		let raw = "";
		req.on("data", (chunk) => {
			raw += chunk;
			if (raw.length > 100_000) reject(new Error("Petición demasiado grande"));
		});
		req.on("end", () => {
			try {
				resolve(raw ? JSON.parse(raw) : {});
			} catch {
				reject(new Error("JSON inválido"));
			}
		});
	});
}
