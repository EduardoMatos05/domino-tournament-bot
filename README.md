# Domino Tournament Bot — v0.1.0

Bot externo que juega un torneo de dominó con **8 cuentas reales** (o 4) desde una sola computadora.
Abre un navegador Chromium independiente por jugador, inicia sesión como lo haría una
persona y juega fichas legales al azar hasta que el torneo termina. No modifica el juego.

El bot **no entiende el torneo**: no sabe de rondas, formatos ni puntuaciones. Solo mira el estado
real de la pantalla (¿hay partida?, ¿es mi turno?, ¿terminó?) y reacciona.

## Requisitos

- **Node.js 20.12 o superior** (<https://nodejs.org>, versión LTS). Funciona igual en Windows y macOS.
- Un certamen online necesita **8 jugadores** (el engine solo tiene mesas para 8, 12 y 16), así que el bot
  usa 8 cuentas por defecto. El modo de 4 sirve para competencias de 4 jugadores o pruebas.
- Las cuentas deben estar **inscritas manualmente** en un torneo **online** (no presencial).
- Cada usuario debe tener **de 1 a 8 letras o números** (el login del juego no admite más).

## Instalación

```bash
git clone <url-del-repo> domino-tournament-bot   # o copia la carpeta
cd domino-tournament-bot
npm install
```

`npm install` también descarga el Chromium que usa Playwright (≈ 100–200 MB, solo la primera vez).
Si se saltó ese paso, ejecuta `npx playwright install chromium`.

## Uso

```bash
npm start
```

Se abre la interfaz en <http://127.0.0.1:4173>:

1. Pega la **Tournament URL** (la del torneo, p. ej. `https://plataforma.<dominio>/<torneo>/...`).
   Solo importa el primer segmento de la ruta: el bot no necesita ID de torneo, ronda ni mesa.
2. Elige **8 o 4 jugadores** y escribe usuario y contraseña de cada uno.
3. Elige la **velocidad** (0.5 s – 4.0 s): lo que tarda cada bot, **desde que empieza su turno hasta que
   tira la ficha**, con ±20 % de variación distinta en cada bot y cada jugada (con 2 s, entre 1.6 y 2.4 s).
   Se puede mover mientras el torneo corre. En la práctica la ficha sale unos 0.1–0.2 s después de lo
   elegido (el bot nota el turno hasta ~0.15 s tarde) y, si una ficha no cabe, el intento de probar la
   siguiente suma ~0.1 s. El log muestra `Move sent X.Xs after my turn started` en cada jugada.
4. Pulsa **START TOURNAMENT**. Se abre una ventana por jugador (repartidas por la pantalla; con 8 se solapan, no las cierres ni minimices) y los bots juegan solos.

**STOP** detiene todo y cierra los navegadores. Al terminar el torneo los navegadores quedan abiertos
mostrando el resultado; el botón pasa a **CLOSE BROWSERS**.

> Deja las ventanas del bot abiertas y sin minimizar. Aunque queden tapadas por otras, siguen jugando;
> el estado de cada jugador y el log se ven en la interfaz.

### Qué hace el bot (y qué no)

| Situación | Acción |
|---|---|
| Portal de comunicación, sin partida | Espera. Recarga el portal cada ~40 min (renueva el token de 1 h) |
| Modal "Confirmar asistencia" | Pulsa **Confirmar** |
| Es su turno | Espera la velocidad elegida, prueba fichas en orden aleatorio hasta que el juego acepte una |
| La ficha encaja en los dos extremos | Elige una de las dos secciones al azar |
| "Mano N terminada" / "Juego terminado" | Pulsa **Aceptar** y espera la siguiente partida |
| Cada ~4 min | Simula actividad (el juego cierra la sesión a los 10 min de inactividad) |
| "Certamen finalizado" / "Torneo cancelado" | Lo registra y se detiene |

Las reglas del dominó **las aplica el propio juego**: si una ficha no cabe, el juego muestra un aviso
y no envía nada al servidor; el bot simplemente prueba otra. Por eso los logs dicen
`Trying tile: 5-5` / `Tile 5-5 is not playable` en vez de listar las fichas jugables.

## Logs

Cada ejecución crea `logs/AAAA-MM-DD_HH-mm-ss.log` y lo muestra en vivo en la interfaz:

```text
[Player 1] Opening tournament
[Player 1] Login successful
[Player 1] Waiting for match
[Player 1] Match detected (TOUR_12_RUN_1_MESA_3)
[Player 1] Attendance confirmed
[Player 1] My turn
[Player 1] Hand: 2-3, 6-1, 5-5
[Player 1] Trying tile: 5-5
[Player 1] Tile 5-5 is not playable ("La ficha no tiene cabida")
[Player 1] Trying tile: 6-1
[Player 1] Selected tile: 6-1
[Player 1] Available positions: Sección 1 (arriba), Sección 3 (abajo)
[Player 1] Selected position: Sección 3 (abajo)
[Player 1] Move completed
```

Un jugador con problemas (login fallido, ventana cerrada, errores repetidos) queda en estado
`Error` con el motivo; **los demás siguen jugando**.

## Seguridad

- Las cuentas se guardan, si marcas "Recordar cuentas", en `config/settings.local.json`
  (**texto plano, solo en tu equipo**). Ese archivo, `.env`, `logs/` y cualquier sesión/cookie están en `.gitignore`.
- Los logs **no** contienen contraseñas.
- La interfaz solo escucha en `127.0.0.1`; no es accesible desde la red.
- Los navegadores son perfiles temporales: no se guardan cookies ni sesiones en disco.

## Configuración opcional

Copia `.env.example` a `.env`: `BOT_UI_PORT` (puerto de la interfaz), `BOT_HEADLESS=1`
(sin ventanas; no recomendado en este MVP), `BOT_NO_OPEN=1` (no abrir el navegador solo).

## Problemas frecuentes

| Síntoma | Causa probable |
|---|---|
| `Login failed: el usuario no existe / contraseña incorrecta` | Credenciales mal escritas |
| `Login failed: el torneo no está disponible` | El torneo debe estar aprobado y pagado |
| `no apareció el formulario de login` | La URL no es la del torneo de ese entorno |
| Aviso "I do not appear in the portal's online players list" | El socket `/tour` no conectó. El engine actual exige el JWT real en el socket y las versiones antiguas del frontend envían el texto `"Token"`: el frontend desplegado debe estar actualizado |
| Un jugador pasa a `Error: the session keeps closing` | Esa cuenta está abierta en otro navegador (el juego permite una sesión por usuario) |
| Una jugada llega tarde y el equipo pierde la partida | Velocidad demasiado alta para el reloj de turno del torneo: baja la velocidad |

## Estructura

```text
src/
  main.js          arranque: servidor de la interfaz + abrir navegador
  config/          URL del torneo, cuentas guardadas, constantes
  browser/         lanzamiento de Chromium (uno por jugador)
  players/         PlayerBot (bucle estado→acción) y login
  game/            selectors (todo lo que se sabe del DOM), snapshot, classify (estado), moves, timing
  runner/          crea los 4 bots y los detiene
  logger/          consola + archivo + interfaz
  ui/              servidor local y página (formulario, estado, log)
test/              pruebas unitarias y de punta a punta contra un juego simulado
```

Los selectores del juego están centralizados en `src/game/selectors.js` y `src/game/snapshot.js`:
si el frontend cambia, se corrige ahí.

## Pruebas

```bash
npm test
```

Incluye pruebas completas (login → asistencia → jugadas → modales → fin de torneo, con 1 y con 8 bots a la vez) contra un juego
simulado que imita el DOM real. **No sustituye una prueba contra un torneo real.**

## Fuera del MVP (pensado en la arquitectura, no implementado)

12/16/32 jugadores (los tamaños permitidos están en `PLAYER_COUNTS`), perfiles de bots,
desconexiones simuladas, modo headless completo, historial.
