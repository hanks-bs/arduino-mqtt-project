# Serial Bridge (Windows) — UART → MQTT

Ten tryb pozwala uruchomić API i broker w kontenerach, a jednocześnie czytać dane z portu COM na hoście Windows i publikować je do brokera MQTT.

## Założenia

- Broker Mosquitto jest dostępny na `localhost:1883` (z `docker-compose.yml` port jest zmapowany z kontenera `mosquitto`).
- API subskrybuje `MQTT_BROKER=mqtt://mosquitto:1883` i temat `MQTT_TOPIC=arduino/sensordata`.
- Mostek publikuje na `mqtt://localhost:1883` w ten sam temat, więc API odbiera te dane przez brokera.

## Oczekiwany format JSON

Każda linia (zakończona `\n`) powinna zawierać obiekt JSON o kluczach zgodnych z tymi z Arduino:

```json
{
	"potValue": 512,
	"voltagePot": 2.5,
	"lm35Value": 123,
	"voltageLM35": 0.62,
	"temperature": 21.7,
	"readingTime": 12,
	"uptimeSec": 345,
	"readingCount": 678
}
```

API dołoży własny `timestamp` i utrzyma historię (ostatnie 1000 wpisów).

## Przykładowy skrypt Node (szkic)

Poniższy szkic ilustruje ideę (niezależny od repo). Wymaga `serialport` i `mqtt`.

```js
// bridge.js
import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";
import mqtt from "mqtt";

const SERIAL = process.env.SERIAL || "COM3";
const BAUD = Number(process.env.BAUD || 9600);
const MQTT_URL = process.env.MQTT_URL || "mqtt://localhost:1883";
const TOPIC = process.env.TOPIC || "arduino/sensordata";

const client = mqtt.connect(MQTT_URL);
client.on("connect", () => console.log("[bridge] MQTT connected:", MQTT_URL));

const port = new SerialPort({ path: SERIAL, baudRate: BAUD });
const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

parser.on("data", line => {
	const trimmed = String(line).trim();
	if (!trimmed || trimmed === "Brak danych" || trimmed[0] !== "{") return;
	try {
		JSON.parse(trimmed); // minimalna walidacja
		client.publish(TOPIC, trimmed, { retain: true });
	} catch {
		/* ignoruj błędy pojedynczych linii */
	}
});

port.on("open", () => console.log("[bridge] Serial open", SERIAL, "@", BAUD));
port.on("error", e => console.error("[bridge] Serial error:", e.message));
```

Uruchomienie (PowerShell):

```pwsh
$env:SERIAL="COM3"; $env:BAUD="9600"; $env:MQTT_URL="mqtt://localhost:1883"; $env:TOPIC="arduino/sensordata"; node .\bridge.mjs
```

> Uwaga: w produkcji dodaj reconnect i solidniejsze logowanie.

## Weryfikacja

- `mosquitto_sub -h localhost -t arduino/sensordata -C 1` powinien zwrócić jedną wiadomość JSON.
- Dashboard z `docker compose` zacznie pokazywać nowe odczyty.
