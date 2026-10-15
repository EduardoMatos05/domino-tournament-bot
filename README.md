# Domino Tournament Bot — v0.3.0

Juega un torneo **online** de dominó con **2 a 16 cuentas reales** (número par) desde una computadora: abre un
Chromium por jugador, inicia sesión y tira fichas legales al azar hasta que el torneo termina. No modifica el
juego: solo lee la pantalla y reacciona.

## Requisitos

- Node.js 20.12 o superior.
- Cuentas **inscritas a mano** en el torneo, con usuario de 1 a 8 letras o números y sin estar en otro torneo activo.
- Una mesa es de 4: los lugares que el bot no cubra los ocupan personas.
- 0.2–0.4 GB de RAM por jugador.

## Uso

```bash
npm install   # la primera vez (también descarga Chromium)
npm start     # abre http://127.0.0.1:4173
```

1. Pega la URL del torneo, elige cuántos jugadores y escribe su usuario y contraseña.
2. Elige la velocidad: lo que tarda cada bot en tirar desde que empieza su turno (±20 %). Se puede cambiar en marcha.
3. Opcional: **Disconnect bots** (ver abajo).
4. Pulsa **START TOURNAMENT**. No cierres ni minimices las ventanas. **STOP** cierra todo; al terminar el torneo
   las ventanas quedan abiertas hasta **CLOSE BROWSERS**.

## Disconnect bots

Con **+** agregas una fila: el bot, en qué certamen/concurso y partida se desconecta y en cuál vuelve (por
defecto, la siguiente). En la mesa de espera de esa partida el bot cierra su ventana sin confirmar asistencia;
cuando terminan las demás mesas y el portal pasa a "Siguiente juego", la vuelve a abrir y sigue normal.

- El número de certamen/concurso es el de su nombre ("Certamen 1", "Concurso 2"), como lo muestra la mesa. Si
  hay "Certamen 1" y "Concurso 1", el 1 vale para el que empiece primero.
- Si vuelve varias partidas después, se enciende en cada espera y se vuelve a apagar hasta llegar a la suya.
- Necesita otro bot conectado que le avise; si no hay ninguno, revisa cada minuto.

## Logs y problemas

Cada ejecución guarda `logs/AAAA-MM-DD_HH-mm-ss.log` y lo muestra en la interfaz. Si un jugador falla, queda en
`Error` con el motivo y los demás siguen.

| En el log | Qué hacer |
|---|---|
| `Login failed: ...` | Revisa usuario, contraseña y que la URL sea del torneo de ese entorno (aprobado y pagado) |
| `This table belongs to tournament X...` | La cuenta está en otro torneo activo: usa cuentas que solo estén en este |
| `Error: the session keeps closing` | Esa cuenta está abierta en otro navegador |
| `N moves in a row were not accepted` | El servidor ignora las jugadas: revisa los logs del servicio `tour` del engine |
| Una jugada llega tarde | Baja la velocidad |

## Notas

- "Recordar cuentas" las guarda en texto plano en `config/settings.local.json` (ignorado por Git). La interfaz
  solo escucha en `127.0.0.1`.
- `.env` opcional (ver `.env.example`): `BOT_UI_PORT`, `BOT_HEADLESS=1`, `BOT_NO_OPEN=1`.
- Si cambia el frontend del juego, los selectores están en `src/game/selectors.js` y `src/game/snapshot.js`.
- `npm test` prueba contra un juego simulado; no sustituye probar en un torneo real.
