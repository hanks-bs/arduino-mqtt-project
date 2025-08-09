import MqttService from './MqttService';
import SerialService from './SerialService';

/**
 * Bridges SerialService to MQTT by publishing the latest serial line
 * (when it looks like JSON) to the configured topic with retain flag.
 */
class ArduinoDataService {
  /**
   * Reads the last serial line from SerialService and publishes it to MQTT with retain.
   * Placeholder/empty/non‑JSON lines are skipped to reduce broker noise.
   *
   * Returns the original line for diagnostics/upstream handlers.
   */
  async process(): Promise<string> {
    try {
      const data = SerialService.getLatestData();

      // Skip publishing placeholder / empty data
      if (!data || data === 'Brak danych' || data.trim()[0] !== '{') {
        return data;
      }

      await MqttService.publishData(data);
      return data;
    } catch (error) {
      throw error;
    }
  }
}

export default new ArduinoDataService();
