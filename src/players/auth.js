import { LOGIN_TIMEOUT_MS } from "../config/defaults.js";
import { SEL } from "../game/selectors.js";
import { sleep } from "../game/timing.js";

export class LoginError extends Error {
	/** @param {boolean} fatal true = reintentar no sirve (credenciales, ban, torneo no disponible) */
	constructor(message, fatal = true) {
		super(message);
		this.fatal = fatal;
	}
}

const LOGIN_PATH = /\/(login|logout)\/?$/;

/**
 * Traduce la respuesta de POST /api/token/tournament a un motivo legible.
 * Cubre el engine actual (400/401/404/500 con nombre de error) y el anterior (404 genérico = contraseña).
 */
export function describeLoginFailure(status, body) {
	const text = String(body ?? "");
	if (text.includes("user no exist")) return "el usuario no existe";
	if (text.includes("MissingCredentials")) return "faltan usuario o contraseña";
	if (text.includes("InvalidCredentials") || status === 401) return "contraseña incorrecta";
	if (text.includes("TournamentNotFound")) return "el torneo no existe en este entorno (revisa la URL)";
	if (text.includes("TournamentAccessUnavailable")) {
		return "el servidor no pudo validar el acceso al torneo (error del engine; revisa sus logs)";
	}
	if (text.includes("UserBan") || (status === 403 && /ban/i.test(text))) return "el usuario está baneado";
	if (text.includes("TournamentNotAvailable")) return "el torneo no está disponible (debe estar aprobado y pagado)";
	if (text.includes("TournamentRequestNotApproved")) return "la solicitud del torneo no está aprobada";
	if (status === 410) return "la solicitud del torneo expiró";
	if (status === 404) return "contraseña incorrecta (engine anterior)";
	if (status === 403) return `acceso denegado: ${text.slice(0, 120)}`;
	return `respuesta inesperada del servidor (HTTP ${status}) ${text.slice(0, 120)}`;
}

/**
 * Login por la propia pantalla del torneo, igual que una persona.
 * Al terminar deja al jugador en el portal de comunicación.
 */
export async function login(page, tournament, account, log) {
	log.info("Opening tournament");
	await page.goto(tournament.loginUrl, { waitUntil: "domcontentloaded", timeout: LOGIN_TIMEOUT_MS });

	const user = page.locator(SEL.loginUser);
	try {
		await user.waitFor({ timeout: LOGIN_TIMEOUT_MS / 2 });
	} catch {
		// Sin formulario: o la sesión ya estaba abierta, o la página no es la esperada.
		if (!LOGIN_PATH.test(new URL(page.url()).pathname)) {
			log.info("Session already active");
			return;
		}
		throw new LoginError(
			"no apareció el formulario de login (¿URL del torneo correcta? ¿el torneo existe en este entorno?)",
			false,
		);
	}

	log.info("Logging in");
	await user.fill(account.username);
	const password = page.locator(SEL.loginPassword);
	await password.fill(account.password);

	const [response] = await Promise.all([
		page.waitForResponse(
			(r) => r.request().method() === "POST" && r.url().includes("/api/token/tournament"),
			{ timeout: LOGIN_TIMEOUT_MS },
		),
		password.press("Enter"), // envía el formulario sin depender del texto del botón
	]).catch((error) => {
		throw new LoginError(`no hubo respuesta del servidor de login (${error.message.split("\n")[0]})`, false);
	});

	// Tras un login correcto la página navega y el cuerpo de la respuesta puede dejar de estar disponible.
	const status = response.status();
	const body = await Promise.race([response.text().catch(() => null), sleep(3_000).then(() => null)]);
	if (body === null ? status !== 200 : !(status === 200 && body.includes("access_token"))) {
		throw new LoginError(describeLoginFailure(status, body));
	}

	try {
		await page.waitForURL((u) => !LOGIN_PATH.test(u.pathname), { timeout: LOGIN_TIMEOUT_MS / 2 });
	} catch {
		throw new LoginError("el login no avanzó después de enviar las credenciales", false);
	}
	log.info("Login successful");
	await goToPortal(page, tournament);
}

export async function goToPortal(page, tournament) {
	await page.goto(tournament.portalUrl, { waitUntil: "domcontentloaded", timeout: LOGIN_TIMEOUT_MS });
}
