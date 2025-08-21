// src/routes/monitorRoutes.ts
import MonitorController from 'App/controllers/MonitorController';
import ResearchRunsController from 'App/controllers/ResearchRunsController';
import { Router } from 'express';

const monitorRoutes = Router();

monitorRoutes.get('/api/monitor/live', MonitorController.live);
monitorRoutes.get('/api/monitor/live-emit', MonitorController.liveEmitStatus);
monitorRoutes.post('/api/monitor/live-emit', MonitorController.liveEmitSet);
// Research run orchestration
monitorRoutes.post('/api/research/run', ResearchRunsController.start);
monitorRoutes.get('/api/research/run/:id', ResearchRunsController.status);
monitorRoutes.get(
  '/api/research/run/:id/results',
  ResearchRunsController.results,
);
monitorRoutes.get(
  '/api/research/run/:id/sessions',
  ResearchRunsController.sessions,
);
monitorRoutes.get('/api/research/runs', ResearchRunsController.list);
monitorRoutes.delete('/api/research/run/:id', ResearchRunsController.abort);

export default monitorRoutes;
