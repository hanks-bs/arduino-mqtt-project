// src/controllers/ArduinoDataController.ts
import { getLatestData } from 'App/services/MqttSubscriber';
import { NextFunction, Request, Response } from 'express';

class ArduinoDataController {
  /**
   * Returns latest data as string. Used internally to measure payload bytes.
   */
  async getLatestString(): Promise<string> {
    const data = getLatestData();
    return data;
  }

  /**
  * Legacy endpoint (kept for compatibility).
  * Prefer the wrapper in globalRoutes that counts bytes for monitoring.
   */
  async getLatest(req: Request, res: Response, next: NextFunction) {
    try {
      const data = getLatestData();
      return res.status(200).json({ success: true, data });
    } catch (error: any) {
      return next(error);
    }
  }
}

export default new ArduinoDataController();
