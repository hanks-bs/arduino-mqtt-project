import { MQTT_BROKER, MQTT_TOPIC } from 'App/config/config';
import { getWebSockets } from 'App/providers';
import mqtt, { MqttClient } from 'mqtt';
import { ResourceMonitor } from './ResourceMonitorService';
// --------------------------------------------------------------------------------

/**
 * Shape of a single Arduino JSON line emitted by the sketch.
 * Each line should be a valid JSON object containing numeric fields only.
 */
type ArduinoResponseType = {
  potValue: number;
  voltagePot: number;
  lm35Value: number;
  voltageLM35: number;
  temperature: number;
  readingTime: number;
  uptimeSec: number;
  readingCount: number;
};

/**
 * Arduino reading extended with an ISO timestamp added by the API.
 */
type ArduinoResponseTypeWithTimestamp = ArduinoResponseType & {
  timestamp: string;
};

/**
 * Composite payload sent to clients: the latest reading and a bounded history
 * (history excludes the current point to keep delta calculations meaningful on the UI).
 */
type ArduinoResponseTypeWithHistory = {
  lastMeasurement: ArduinoResponseTypeWithTimestamp;
  history: ArduinoResponseTypeWithTimestamp[];
};

/**
 * Runtime type guard validating the Arduino payload shape.
 * This keeps the pipeline resilient to garbage/non‑JSON lines.
 */
function isArduinoResponseType(obj: any): obj is ArduinoResponseType {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.potValue === 'number' &&
    typeof obj.voltagePot === 'number' &&
    typeof obj.lm35Value === 'number' &&
    typeof obj.voltageLM35 === 'number' &&
    typeof obj.temperature === 'number' &&
    typeof obj.readingTime === 'number' &&
    typeof obj.uptimeSec === 'number' &&
    typeof obj.readingCount === 'number'
  );
}

/**
 * Latest composite JSON string prepared for HTTP/WS consumers.
 */
let latestArduinoData: string = 'Brak danych';

/**
 * Rolling history of validated readings (capped to 1000 entries).
 */
const history: any[] = [];

/**
 * Initializes a resilient MQTT subscriber.
 * - Filters placeholders/non‑JSON lines
 * - Validates payload shape
 * - Appends timestamped record to history (bounded)
 * - Emits to WebSocket when live emissions are enabled
 * - Updates ResourceMonitor counters (WS bytes)
 */
export const initMqttSubscriber = (): void => {
  // lightweight diagnostic counters (help understand why visualization might be empty)
  let filteredNonJson = 0;
  let invalidJson = 0;
  let invalidSchema = 0;
  let accepted = 0;
  // periodic stats logging (~30s) – avoid console spam
  setInterval(() => {
    const total = filteredNonJson + invalidJson + invalidSchema + accepted;
    if (total === 0) return;
    console.log(
      `[MQTT diag] Przyjęte=${accepted} | Odfiltrowane(nie-JSON/placeholder)=${filteredNonJson} | Błędny JSON=${invalidJson} | Zła struktura=${invalidSchema} (suma=${total})`,
    );
  }, 30000).unref();
  const connect = () => {
    const client: MqttClient = mqtt.connect(MQTT_BROKER, {
      reconnectPeriod: 2000,
    });

    client.on('connect', () => {
      client.subscribe(MQTT_TOPIC, { qos: 0 }, err => {
        if (err) {
          console.error('Błąd subskrypcji MQTT:', err);
        } else {
          console.log(`Subskrybujemy temat: ${MQTT_TOPIC}`);
        }
      });
    });

    // Handling new messages from MQTT
    client.on('message', (topic: string, message: Buffer) => {
      if (topic === MQTT_TOPIC) {
        const rawString = message.toString();
        const trimmed = rawString.trim();
  // quick filter: empty, placeholder, or lacks opening brace
        if (!trimmed || trimmed === 'Brak danych' || trimmed[0] !== '{') {
          filteredNonJson++;
          return; // ignorujemy i NIE logujemy – ograniczenie spamu
        }
        let parsed: ArduinoResponseType;
        try {
          parsed = JSON.parse(trimmed);
        } catch (e) {
          invalidJson++;
          // limit noise: log only every 50th error
          if (invalidJson % 50 === 1) {
            console.error(
              'Błąd parsowania JSON (kolejny, skumulowane=',
              invalidJson,
              '):',
              (e as Error).message,
            );
          }
          return;
        }

  // validate structure (type guard)
        if (!isArduinoResponseType(parsed)) {
          invalidSchema++;
      if (invalidSchema % 50 === 1) {
            console.error(
        'Received invalid JSON structure (cumulative=',
              invalidSchema,
        '): keys=',
              Object.keys(parsed || {}),
            );
          }
          return;
        }
        accepted++;

        // If valid, we can proceed with using the data
        const recordWithTimestamp: ArduinoResponseTypeWithTimestamp = {
          ...parsed,
          timestamp: new Date().toISOString(), // e.g. "2025-01-28T12:34:56.789Z"
        };
        history.push(recordWithTimestamp);
        // update freshness marker
        try {
          ResourceMonitor.setLastArduinoTimestamp(
            recordWithTimestamp.timestamp,
          );
        } catch {}

        // Limit the history size to 1000 records, for example
        if (history.length > 1000) {
          history.shift(); // remove the oldest entry
        }

        // Build composite object: current data + history WITHOUT the current point
        const historyWithoutCurrent = history.slice(0, -1);
        const dataWithHistory: ArduinoResponseTypeWithHistory = {
          lastMeasurement: recordWithTimestamp,
          history: historyWithoutCurrent,
        };

        // Save as a string to latestArduinoData
        latestArduinoData = JSON.stringify(dataWithHistory);

        // Send data to WebSocket clients (if live emissions are enabled)
        if (ResourceMonitor.isLiveEmitEnabled()) {
          const io = getWebSockets();
          io.emit('arduinoData', latestArduinoData);
          // record bytes sent through WS
          try {
            const bytes = Buffer.byteLength(latestArduinoData, 'utf8');
            ResourceMonitor.onWsEmit(bytes);
          } catch (e) {
            // ignore
          }
        }
      }
    });

    client.on('error', err => {
      console.error('MQTT Subscriber error:', err.message);
    });
  };
  connect();
};

/** Returns the latest prepared Arduino payload as a JSON string. */
export const getLatestData = (): string => {
  return latestArduinoData;
};

/** Replaces the cached latest payload (testing/mocking helper). */
export const setLatestData = (data: string): void => {
  latestArduinoData = data;
};

/** Returns the rolling history array (most recent at the end). */
export const getHistory = (): any[] => {
  return history;
};

/** Clears the rolling history (used in tests/maintenance). */
export const clearHistory = (): void => {
  history.length = 0;
};
