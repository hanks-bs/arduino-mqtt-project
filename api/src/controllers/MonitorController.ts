// src/controllers/MonitorController.ts
import {
  ResourceMonitor,
  SessionConfig,
} from 'App/services/ResourceMonitorService';
import { NextFunction, Request, Response } from 'express';

class MonitorController {
  /**
   * GET /api/monitor/live
   * Returns a single snapshot of live metrics.
   */
  async live(req: Request, res: Response, next: NextFunction) {
    try {
      const m = await ResourceMonitor.sampleNow();
      return res.status(200).json({ success: true, data: m });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * GET /api/monitor/live-emit
   * Returns current status of the real-time emission toggle.
   */
  async liveEmitStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const enabled = ResourceMonitor.isLiveEmitEnabled();
      return res.status(200).json({ success: true, data: { enabled } });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/monitor/live-emit
   * Sets the real-time emission toggle.
   * Body: { enabled: boolean }
   */
  async liveEmitSet(req: Request, res: Response, next: NextFunction) {
    try {
      const { enabled } = req.body as { enabled?: boolean };
      if (typeof enabled !== 'boolean') {
        return res
          .status(400)
          .json({ success: false, error: 'enabled (boolean) is required' });
      }
      ResourceMonitor.setLiveEmitEnabled(enabled);
      return res.status(200).json({ success: true, data: { enabled } });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/monitor/start
   * Starts a new measurement session.
   */
  async start(req: Request, res: Response, next: NextFunction) {
    try {
      const body = req.body as Partial<SessionConfig>;
      if (!body?.label || !body?.mode) {
        return res
          .status(400)
          .json({ success: false, error: 'label and mode are required' });
      }
      const cfg: SessionConfig = {
        label: body.label,
        mode: body.mode,
        pollingIntervalMs: body.pollingIntervalMs,
        sampleCount: body.sampleCount,
        durationSec: body.durationSec,
        warmupSec: body.warmupSec,
        cooldownSec: body.cooldownSec,
        wsFixedRateHz: body.wsFixedRateHz,
        assumedPayloadBytes: body.assumedPayloadBytes,
        loadCpuPct: body.loadCpuPct,
        loadWorkers: body.loadWorkers,
        clientsHttp: body.clientsHttp,
        clientsWs: body.clientsWs,
      };
      const rec = ResourceMonitor.startSession(cfg);
      return res.status(201).json({ success: true, data: rec });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/monitor/stop
   * Stops the active session (if matches id).
   */
  async stop(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.body as { id: string };
      if (!id)
        return res
          .status(400)
          .json({ success: false, error: 'id is required' });
      const rec = ResourceMonitor.finishSession(id);
      if (!rec)
        return res
          .status(404)
          .json({ success: false, error: 'session not found' });
      return res.status(200).json({ success: true, data: rec });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * GET /api/monitor/sessions
   */
  async sessions(req: Request, res: Response, next: NextFunction) {
    try {
      const list = ResourceMonitor.listSessions();
      return res.status(200).json({ success: true, data: list });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * GET /api/monitor/sessions/:id
   */
  async session(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const rec = ResourceMonitor.getSession(id);
      if (!rec)
        return res.status(404).json({ success: false, error: 'not found' });
      return res.status(200).json({ success: true, data: rec });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/monitor/reset
   * Clears all measurement sessions.
   */
  async reset(req: Request, res: Response, next: NextFunction) {
    try {
      const cleared = ResourceMonitor.resetSessions();
      return res.status(200).json({ success: true, data: { cleared } });
    } catch (err) {
      return next(err);
    }
  }
}

export default new MonitorController();
