import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LOG_DIR = path.join(ROOT, "logs");
const BUFFER_LINES = 500;

const pad = (n) => String(n).padStart(2, "0");
function stamp(d = new Date()) {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

/**
 * Logger único: consola + archivo logs/AAAA-MM-DD_HH-mm-ss.log + evento "line" para la UI.
 * Un archivo nuevo por ejecución (se abre al llamar a `startRun`).
 */
class Logger extends EventEmitter {
	constructor() {
		super();
		this.buffer = [];
		this.file = null;
		this.filePath = null;
	}

	startRun() {
		fs.mkdirSync(LOG_DIR, { recursive: true });
		this.file?.end();
		this.filePath = path.join(LOG_DIR, `${stamp()}.log`);
		this.file = fs.createWriteStream(this.filePath, { flags: "a" });
		return this.filePath;
	}

	/** @param {string|null} who "Player 1", "System"... @param {"info"|"warn"|"error"} level */
	write(who, level, message) {
		const time = new Date().toISOString();
		const text = who ? `[${who}] ${message}` : message;
		const line = { time, level, text };

		this.buffer.push(line);
		if (this.buffer.length > BUFFER_LINES) this.buffer.shift();

		const out = `${time} ${level.toUpperCase().padEnd(5)} ${text}`;
		if (level === "error") console.error(out);
		else console.log(out);
		this.file?.write(`${out}\n`);
		this.emit("line", line);
	}

	/** Logger con prefijo fijo, p. ej. `logger.for("Player 1").info("Logged in")`. */
	for(who) {
		return {
			info: (m) => this.write(who, "info", m),
			warn: (m) => this.write(who, "warn", m),
			error: (m) => this.write(who, "error", m),
		};
	}

	close() {
		this.file?.end();
		this.file = null;
	}
}

export const logger = new Logger();
