import MqttService from './MqttService';
import SerialService from './SerialService';

/**
 * Bridges SerialService to MQTT by publishing the latest serial line
 * (when it looks like JSON) to the configured topic with retain flag.
 */
class ArduinoDataService {
  private lastPublishedRaw?: string;
  /**
   * Reads the last serial line from SerialService and publishes it to MQTT with retain.
   * Placeholder/empty/non‑JSON lines are skipped to reduce broker noise.
   *
   * Returns the original line and whether it was actually published.
   */
  async process(): Promise<{ data: string | undefined; published: boolean }> {
    try {
      const data = SerialService.getLatestData();

      // Skip publishing placeholder / empty data
      if (!data || data === 'Brak danych' || data.trim()[0] !== '{') {
        return { data, published: false };
      }

      // Deduplicate: publish only if new raw payload differs from last published
      if (this.lastPublishedRaw === data) {
        return { data, published: false };
      }

      await MqttService.publishData(data);
      this.lastPublishedRaw = data;
      return { data, published: true };
    } catch (error) {
      throw error;
    }
  }
}

export default new ArduinoDataService();
