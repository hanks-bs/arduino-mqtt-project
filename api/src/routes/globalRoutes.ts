// src/routes/globalRoutes.ts
import ArduinoDataController from 'App/controllers/ArduinoDataController';
import { ResourceMonitor } from 'App/services/ResourceMonitorService';
import { NextFunction, Request, Response, Router } from 'express';
// --------------------------------------------------------------

const globalRoutes = Router();

/** Wrapper route that records response bytes for the Arduino endpoint */
globalRoutes.get(
  '/api/arduino-data',
  (req, _res, next) => {
    try {
      ResourceMonitor.noteIngest();
    } catch {}
    next();
  },
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // call controller to get data string
      const dataString = await ArduinoDataController.getLatestString();
      const payload = { success: true, data: dataString };
      const bodyStr = JSON.stringify(payload);
      const bytes = Buffer.byteLength(bodyStr, 'utf8');

      // record into monitor
      ResourceMonitor.onHttpResponse(bytes);

      // send
      return res.status(200).type('application/json').send(bodyStr);
    } catch (err) {
      return next(err);
    }
  },
);

export default globalRoutes;
