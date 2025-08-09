import { MQTT_BROKER, MQTT_TOPIC } from 'App/config/config';
import mqtt, { MqttClient } from 'mqtt';

/** Lightweight MQTT publisher used by ArduinoDataService. */
class MqttService {
  /**
   * Publishes a string payload to the configured MQTT topic using retain flag.
   * Establishes a short‑lived connection for each publish to keep the code simple
   * and avoid keeping idle sockets. In high‑throughput scenarios consider reusing
   * a single client instance.
   */
  async publishData(data: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        const client: MqttClient = mqtt.connect(MQTT_BROKER);

        client.on('connect', () => {
          client.publish(MQTT_TOPIC, data, { retain: true }, err => {
            client.end();
            if (err) {
              return reject(err);
            }
            resolve();
          });
        });

        client.on('error', err => {
          client.end();
          reject(err);
        });
      } catch (error) {
        reject(error);
      }
    });
  }
}

export default new MqttService();
