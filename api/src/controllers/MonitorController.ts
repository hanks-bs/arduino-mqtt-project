// src/controllers/MonitorController.ts
import { ResourceMonitor } from 'App/services/ResourceMonitorService';
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
}

export default new MonitorController();
