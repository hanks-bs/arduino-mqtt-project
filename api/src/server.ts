import { MODE } from 'config/config';
import cors, { CorsOptions } from 'cors';
import express from 'express';
import helmet from 'helmet';
import http from 'http';
import morgan from 'morgan';
import { Server as SocketIOServer } from 'socket.io';
import errorHandler from './middlewares/errorHandler';
import handleCorsError from './middlewares/handleCorsError';
import { initWebSockets } from './providers';
import { generalLimiter } from './rateLimiters/generalRateLimiter';
import globalRoutes from './routes/globalRoutes';
import monitorRoutes from './routes/monitorRoutes';
import ArduinoDataService from './services/ArduinoDataService';
import { initMqttSubscriber } from './services/MqttSubscriber';
import SerialService from './services/SerialService';
// ------------------------------------------------------------------------------

const maxQuerySize = '0.5mb';

const app = express();

// Parse JSON bodies (as sent by API clients)
app.use(express.json({ limit: maxQuerySize }));

// csrf error handler

if (MODE === 'production') {
  app.enable('trust proxy');

  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    helmet.dnsPrefetchControl({
      allow: true,
    }),
  );
  app.use(
    helmet.frameguard({
      action: 'deny',
    }),
  );
  app.use(helmet.hidePoweredBy());
  app.use(
    helmet.hsts({
      maxAge: 31536000,
      includeSubDomains: false,
    }),
  );
  app.use(helmet.ieNoOpen());
  app.use(helmet.noSniff());
  app.use(
    helmet.referrerPolicy({
      policy: ['origin', 'unsafe-url'],
    }),
  );

  app.use(helmet.xssFilter());
  app.use(helmet.crossOriginResourcePolicy({ policy: 'cross-origin' }));
  // adding morgan to log HTTP requests
  app.use(morgan('common'));
}

/* Routes */
app.use('/api/public', express.static(`${__dirname}/public`));

const corsOptions: CorsOptions = {
  methods: ['GET', 'POST'],
  origin: true,
};

app.use(cors(corsOptions));
app.use(handleCorsError);

app.use('*', (req, res, next) => {
  const query = (req.query as any).query || (req.body as any).query || '';
  if (typeof query === 'string' && query.length > 2000) {
    throw new Error('Query too large');
  }
  next();
});

app.use('/', [globalRoutes, monitorRoutes]);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', serialOpen: SerialService.isOpen?.() ?? false });
});

if (MODE === 'production') {
  app.use(generalLimiter);
}
app.use(errorHandler);

const server = http.createServer(app);

// Initialize Socket.IO in the HTTP server
const io: SocketIOServer = initWebSockets(server);

// Initialize MQTT subscription - save the latest data globally
initMqttSubscriber();

// Every 1 second we read data and publish to the broker (deduplicated)
setInterval(async () => {
  try {
    const { data, published } = await ArduinoDataService.process();
    if (published) {
      console.log('Opublikowano dane do broker’a');
    }
  } catch (error) {
    console.error('Błąd podczas odczytu i publikacji danych:', error);
  }
}, 1000).unref();

io.on('connection', socket => {
  console.log(`Nowy klient połączony przez WebSocket, id: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`Klient rozłączony, id: ${socket.id}`);
  });
});

export default server;

// Graceful shutdown
const shutdown = async (signal: string) => {
  console.log(`\n[Shutdown] Caught ${signal}, zamykanie...`);
  try {
    await SerialService.close().catch(() => {});
    server.close(() => {
      console.log('[Shutdown] HTTP server closed');
      process.exit(0);
    });
    // Force exit if hanging
    setTimeout(() => process.exit(1), 10000).unref();
  } catch (e) {
    console.error('[Shutdown] Błąd podczas zamykania', e);
    process.exit(1);
  }
};
['SIGINT', 'SIGTERM'].forEach(sig => process.on(sig, () => shutdown(sig)));
