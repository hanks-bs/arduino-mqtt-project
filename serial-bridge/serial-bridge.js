#!/usr/bin/env node
// Mostek: czyta linie JSON z portu szeregowego Windows (COMx) i publikuje do MQTT.
// Dzięki temu kontener API nie musi widzieć fizycznego urządzenia.

require("dotenv").config();
const { SerialPort, ReadlineParser } = require("serialport");
const mqtt = require("mqtt");

const COM_PORT = process.env.COM_PORT || "COM3";
const BAUD = Number(process.env.BAUD_RATE || 9600);
const MQTT_URL = process.env.MQTT_BROKER || "mqtt://localhost:1883";
const TOPIC = process.env.MQTT_TOPIC || "arduino/sensordata";
const LOG_RAW = /^1|true|yes$/i.test(process.env.LOG_RAW || "0");

console.log(
	"[Bridge] Start – COM=%s baud=%d -> MQTT=%s topic=%s",
	COM_PORT,
	BAUD,
	MQTT_URL,
	TOPIC
);

const port = new SerialPort({ path: COM_PORT, baudRate: BAUD }, err => {
	if (err) {
		console.error("[Bridge] Błąd otwarcia portu:", err.message);
	}
});

port.on("open", () => console.log("[Bridge] Otwarty port %s", COM_PORT));
port.on("error", e => console.error("[Bridge] Serial error:", e.message));

const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

const client = mqtt.connect(MQTT_URL, { reconnectPeriod: 2000 });
client.on("connect", () => console.log("[Bridge] MQTT połączono"));
client.on("error", e => console.error("[Bridge] MQTT error:", e.message));

let sentCount = 0;
parser.on("data", line => {
	const raw = line.trim();
	if (!raw) return;
	if (LOG_RAW) console.log("[Bridge] RAW:", raw);
	if (raw === "Brak danych") return; // ignoruj placeholdery
	if (raw[0] !== "{") return; // oczekujemy JSON
	try {
		JSON.parse(raw); // walidacja
	} catch {
		return;
	}
	client.publish(TOPIC, raw, { qos: 0 }, err => {
		if (err) {
			console.error("[Bridge] Publish error:", err.message);
		} else if (++sentCount % 20 === 0) {
			console.log("[Bridge] Wysłano %d wiadomości", sentCount);
		}
	});
});

process.on("SIGINT", () => {
	console.log("\n[Bridge] Zamykam...");
	try {
		port.close();
	} catch {}
	client.end(true, () => process.exit(0));
});
