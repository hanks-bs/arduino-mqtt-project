// src/providers/index.ts
import { ResourceMonitor } from 'App/services/ResourceMonitorService';
import { Server as SocketIOServer } from 'socket.io';

let ioRef: SocketIOServer;

/**
 * Initializes a singleton Socket.IO server and wires ResourceMonitor to it.
 * Returns the created instance.
 */
export const initWebSockets = (
  server: import('http').Server,
): SocketIOServer => {
  ioRef = new SocketIOServer(server, {
    cors: {
      origin: true,
      methods: ['GET'],
    },
  });

  // Initialize ResourceMonitor with Socket.IO instance
  ResourceMonitor.init(ioRef);

  return ioRef;
};

/** Returns the initialized Socket.IO instance. */
export const getWebSockets = () => ioRef;
