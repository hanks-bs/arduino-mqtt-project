// src/routes/monitorRoutes.ts
import MonitorController from 'App/controllers/MonitorController';
import { Router } from 'express';

const monitorRoutes = Router();

monitorRoutes.get('/api/monitor/live', MonitorController.live);
monitorRoutes.get('/api/monitor/live-emit', MonitorController.liveEmitStatus);
monitorRoutes.post('/api/monitor/live-emit', MonitorController.liveEmitSet);
monitorRoutes.get('/api/monitor/sessions', MonitorController.sessions);
monitorRoutes.get('/api/monitor/sessions/:id', MonitorController.session);
monitorRoutes.post('/api/monitor/start', MonitorController.start);
monitorRoutes.post('/api/monitor/stop', MonitorController.stop);
monitorRoutes.post('/api/monitor/reset', MonitorController.reset);

export default monitorRoutes;
