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
      // get body
      const dataString = await ArduinoDataController.getLatestString();
      const payload = { success: true, data: dataString };
      const bodyStr = JSON.stringify(payload);

      // measure exact bytes written on the socket for THIS response
      const sock = req.socket || (res as any).socket;
      const start =
        sock && typeof sock.bytesWritten === 'number' ? sock.bytesWritten : 0;
      res.once('finish', () => {
        try {
          const end =
            sock && typeof sock.bytesWritten === 'number'
              ? sock.bytesWritten
              : start;
          const delta = Math.max(0, end - start);
          ResourceMonitor.onHttpResponse(delta);
        } catch {}
      });

      // send (express will set Content-Length automatically; counting is done on 'finish')
      return res.status(200).type('application/json').send(bodyStr);
    } catch (err) {
      return next(err);
    }
  },
);

export default globalRoutes;
