/**
 * La URL de un torneo es `https://plataforma.<dominio>/<tour_domain>/...`.
 * El ID del torneo no aparece; solo el primer segmento de la ruta (tour_domain).
 */
export function parseTournamentUrl(input) {
	let url;
	try {
		url = new URL(String(input ?? "").trim());
	} catch {
		throw new Error("La URL del torneo no es válida.");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("La URL del torneo debe empezar con http:// o https://");
	}

	const slug = url.pathname.split("/").filter(Boolean)[0];
	if (!slug) {
		throw new Error(
			"La URL no contiene el torneo. Debe verse como https://plataforma.<dominio>/<torneo>/...",
		);
	}

	// El enlace público de inscripción vive en `torneos.`; el juego se juega en `plataforma.`.
	let host = url.host;
	if (host.startsWith("torneos.")) host = `plataforma.${host.slice("torneos.".length)}`;

	const origin = `${url.protocol}//${host}`;
	const base = `${origin}/${slug}`;
	return {
		origin,
		slug,
		loginUrl: `${base}/login`,
		portalUrl: `${base}/portal-comunicacion`,
	};
}
