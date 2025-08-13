// src/routes/globalRoutes.ts
import ArduinoDataController from 'App/controllers/ArduinoDataController';
import {
  ResourceMonitor,
  ResourceMonitor as RM,
} from 'App/services/ResourceMonitorService';
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

// CSV export of sessions (after existing exports)
globalRoutes.get(
  '/api/monitor/sessions/export/csv',
  (req: Request, res: Response) => {
    const sessions = RM.listSessions();
    // Flatten samples with session metadata
    const rows: string[] = [];
    const header = [
      'sessionId',
      'label',
      'mode',
      'startedAt',
      'finishedAt',
      'sampleIndex',
      'ts',
      'cpu',
      'rssMB',
      'heapUsedMB',
      'elu',
      'elDelayP99Ms',
      'httpReqRate',
      'wsMsgRate',
      'httpBytesRate',
      'wsBytesRate',
      'httpAvgBytesPerReq',
      'wsAvgBytesPerMsg',
      'httpJitterMs',
      'wsJitterMs',
      'dataFreshnessMs',
    ];
    rows.push(header.join(','));
    sessions.forEach(s => {
      s.samples.forEach((sample, idx) => {
        rows.push(
          [
            s.id,
            JSON.stringify(s.config.label),
            s.config.mode,
            s.startedAt,
            s.finishedAt || '',
            String(idx + 1),
            sample.ts,
            sample.cpu.toFixed(3),
            sample.rssMB.toFixed(3),
            sample.heapUsedMB.toFixed(3),
            sample.elu.toFixed(4),
            sample.elDelayP99Ms.toFixed(2),
            sample.httpReqRate.toFixed(3),
            sample.wsMsgRate.toFixed(3),
            sample.httpBytesRate.toFixed(3),
            sample.wsBytesRate.toFixed(3),
            sample.httpAvgBytesPerReq.toFixed(2),
            sample.wsAvgBytesPerMsg.toFixed(2),
            sample.httpJitterMs.toFixed(2),
            sample.wsJitterMs.toFixed(2),
            sample.dataFreshnessMs.toFixed(0),
          ].join(','),
        );
      });
    });
    const csv = rows.join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="sessions.csv"');
    return res.send(csv);
  },
);
