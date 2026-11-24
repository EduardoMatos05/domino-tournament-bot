# Domino Tournament Bot — v0.3.0

Juega un torneo **online** de dominó con **las cuentas reales que quieras** (sin límite) desde una computadora: abre un
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

1. Pega la URL del torneo, escribe cuántos jugadores y pulsa Aceptar: se llenan solos con las cuentas de prueba
   (jugador N = usuario `torneoN` y contraseña `torneoN`). Puedes cambiar cualquiera a mano antes de iniciar.
2. Elige la velocidad: lo que tarda cada bot en tirar desde que empieza su turno (±20 %). Se puede cambiar en marcha.
3. Opcional: **Disconnect bots** (ver abajo).
4. Pulsa **START TOURNAMENT**. No cierres ni minimices las ventanas. **STOP** cierra todo; al terminar el torneo
   las ventanas quedan abiertas hasta **CLOSE BROWSERS**.

## Jugar desde GitHub (sin instalar nada)

La máquina la pone GitHub; se usa desde cualquier navegador con una cuenta colaboradora del repositorio.

1. Abre [Jugar torneo](https://github.com/EduardoMatos05/domino-tournament-bot/actions/workflows/jugar-torneo.yml) y
   pulsa **Run workflow**.
2. Llena la URL del torneo, los jugadores (cuentas `torneo1` … `torneoN`, ya inscritas) y la velocidad.
3. Pulsa el botón verde **Run workflow**. En unos segundos aparece la corrida: ábrela y entra a **Jugar** para ver el
   avance. Ya puedes cerrar la página o apagar tu computadora; el bot sigue.
4. Para detenerlo: **Cancel workflow**. Al final quedan el resultado de cada jugador y el log para descargar.

| Límite | Valor |
|---|---|
| Tiempo por corrida | 6 horas, contando la espera antes del torneo: iníciala unos 10 minutos antes |
| Partidas por torneo | Hasta 40 a velocidad máxima (de 6 a 8 min por partida, 3 de ellos del descanso del servidor) |
| Jugadores | Hasta 40 (probado con 40) |
| Torneos a la vez | Uno; otra corrida espera a que termine la primera. No dejes más de una en espera: la anterior se cancela |

**Desconexiones** (opcional): `3 1.2 1.3` = el bot 3 sale en el certamen 1, partida 2, y vuelve en la partida 3. Con
`confirmar` al final, confirma asistencia antes de salir. Varias se separan con `;`.

El repositorio es público: la URL del torneo y los usuarios se ven en los logs. Usa solo cuentas de prueba.

## Cola de torneos (Next tournaments)

Con **+** agregas otro torneo que se juega cuando termina el de arriba: su URL y cuántos jugadores. Puedes agregar
varios; se juegan en orden, uno tras otro, sin tocar nada.

- Cada torneo de la cola usa las cuentas de prueba `torneo1` … `torneoN` (N = jugadores de esa fila), ya inscritas.
- Cuando todos los bots del torneo actual terminan, se cierran sus ventanas y se abren las del siguiente, que esperan
  en el portal ("Waiting for lobby to open") hasta que abra.
- Si un bot no alcanza a ver el final, se cierra a los 5 min de que otro lo vio, para que la cola no se atore.
- La hora de inicio la pone el servidor, no el bot. Deja colchón entre torneos: si el anterior se alarga, el siguiente
  empieza sin los bots y estos entran en cuanto el anterior termina.
- La velocidad es la misma para todos; las desconexiones programadas solo aplican al primer torneo.
- Cada torneo deja su propio archivo en `logs/`. **STOP** detiene el torneo actual y cancela el resto de la cola.

## Disconnect bots

Con **+** agregas una fila: el bot, en qué certamen/concurso y partida se desconecta y en cuál vuelve (por
defecto, la siguiente). En la mesa de espera de esa partida el bot cierra su ventana sin confirmar asistencia;
cuando terminan las demás mesas y el portal pasa a "Siguiente juego", la vuelve a abrir y sigue normal.

- El número de certamen/concurso es el de su nombre ("Certamen 1", "Concurso 2"), como lo muestra la mesa. Si
  hay "Certamen 1" y "Concurso 1", el 1 vale para el que empiece primero.
- Con la casilla **Confirmar** marcada, el bot primero pulsa "Confirmar" en la mesa de espera y luego cierra su
  ventana (cuenta como presente, pero no juega). Si vuelve varias partidas después, hace lo mismo en cada una.
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
