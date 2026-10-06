import { spawn } from "node:child_process";
import { UI_PORT } from "./config/defaults.js";
import { logger } from "./logger/logger.js";
import { TournamentRunner } from "./runner/TournamentRunner.js";
import { createUiServer } from "./ui/server.js";

try {
	process.loadEnvFile(); // .env opcional (ver .env.example)
} catch {
	// sin .env
}

const port = Number(process.env.BOT_UI_PORT) || UI_PORT;
const runner = new TournamentRunner({ headless: process.env.BOT_HEADLESS === "1" });
const ui = createUiServer({ runner, port });

let url;
try {
	url = await ui.listen();
} catch (error) {
	console.error(
		error.code === "EADDRINUSE"
			? `El puerto ${port} ya está en uso. ¿Ya hay un bot abierto? Cambia BOT_UI_PORT en .env.`
			: error.message,
	);
	process.exit(1);
}
console.log(`Domino Tournament Bot listo: ${url}`);
if (process.env.BOT_NO_OPEN !== "1" && !process.argv.includes("--no-open")) openInBrowser(url);

let closing = false;
async function shutdown() {
	if (closing) return;
	closing = true;
	console.log("\nCerrando...");
	await runner.stop().catch(() => {});
	logger.close();
	ui.close();
	process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Un error inesperado se registra; no tumba a los demás jugadores.
process.on("unhandledRejection", (reason) => logger.write("System", "error", `Unhandled rejection: ${reason}`));

function openInBrowser(target) {
	const [cmd, args] =
		process.platform === "darwin"
			? ["open", [target]]
			: process.platform === "win32"
				? ["cmd", ["/c", "start", "", target]]
				: ["xdg-open", [target]];
	try {
		spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
	} catch {
		// el usuario puede abrir la URL a mano
	}
}
