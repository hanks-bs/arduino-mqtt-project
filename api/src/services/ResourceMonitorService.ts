// src/services/ResourceMonitorService.ts
import crypto from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import {
  monitorEventLoopDelay,
  performance,
  type EventLoopUtilization as ELU,
} from 'node:perf_hooks';
import pidusage from 'pidusage';
import { Server as SocketIOServer } from 'socket.io';

/* -------------------------------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------------------------------- */

export interface LiveMetrics {
  ts: string; // ISO timestamp
  cpu: number; // process CPU %, from pidusage
  rssMB: number;
  heapUsedMB: number;
  heapTotalMB: number;
  externalMB: number;
  arrayBuffersMB: number;

  elu: number; // Event Loop Utilization (0..1)
  elDelayP50Ms: number; // event loop delay percentiles
  elDelayP99Ms: number;
  elDelayMaxMs: number;

  wsClients: number; // connected WS clients (namespace '/')
  httpReqRate: number; // requests / s (recent)
  wsMsgRate: number; // WS messages / s (recent)

  httpBytesRate: number; // bytes / s (recent)
  wsBytesRate: number; // bytes / s (recent)
  httpAvgBytesPerReq: number; // average HTTP response size in bytes (rolling window)
  wsAvgBytesPerMsg: number; // average WebSocket message size in bytes (rolling window)

  httpJitterMs: number; // standard deviation of intervals between HTTP responses (ms, rolling)
  wsJitterMs: number; // standard deviation of intervals between WS messages (ms, rolling)
  dataFreshnessMs: number; // difference (now - timestamp of the last measurement); lower is fresher

  totalHttpRequests: number; // cumulative since process start
  totalWsMessages: number; // cumulative since process start
  totalHttpBytes: number; // cumulative
  totalWsBytes: number; // cumulative

  loadAvg1: number; // OS 1-min load
  uptimeSec: number; // process uptime
}

export interface SessionConfig {
  /** Human readable label for the session, shown in UI. */
  label: string;
  /** 'ws' for WebSocket scenario or 'polling' for HTTP polling scenario. */
  mode: 'ws' | 'polling';
  /** Polling interval in milliseconds, used only when mode === 'polling'. */
  pollingIntervalMs?: number;
  /** Optional: stop after N samples (each sample ~1s). */
  sampleCount?: number;
  /** Optional: stop after duration seconds. */
  durationSec?: number;
  /** Optional: ignore initial N seconds in analysis (stabilization). */
  warmupSec?: number;
  /** Optional: ignore last N seconds in analysis (cooldown). */
  cooldownSec?: number;
  /** Optional: for WS sessions, run a controlled driver at fixed rate (Hz). */
  wsFixedRateHz?: number;
  /** Optional: assumed payload bytes if no observed Arduino payload yet (used by controlled WS). */
  assumedPayloadBytes?: number;
}

export interface SessionRecord {
  id: string;
  config: SessionConfig;
  startedAt: string;
  finishedAt?: string;
  samples: LiveMetrics[];
  meta?: {
    nodeVersion: string;
    sensorIntervalMs: number;
    mqttTopic?: string;
    envMode?: string;
  };
}

/* -------------------------------------------------------------------------------------------------
 * Implementation
 * ------------------------------------------------------------------------------------------------- */

/**
 * Aggregates process/resource metrics, emits live samples over Socket.IO,
 * and records measurement sessions.
 *
 * Contract:
 * - Inputs: HTTP/WS byte counters via onHttpResponse/onWsEmit; last Arduino timestamp.
 * - Outputs: periodic 'metrics' WS events and session records accessible via controller.
 * - Error modes: timer loop is shielded (never throws), internal HTTP driver errors are swallowed.
 * - Success: stable 1 Hz samples with rolling rates and jitter computed from deltas.
 */
class ResourceMonitorService {
  private io?: SocketIOServer;
  // controls whether real-time WS emissions ('metrics', 'arduinoData', etc.) are allowed
  private liveEmitEnabled: boolean = (() => {
    const raw = (
      process.env.LIVE_REALTIME_ENABLED ??
      process.env.LIVE_EMIT_ENABLED ??
      '1'
    )
      .toString()
      .toLowerCase();
    return !['0', 'false', 'off', 'no'].includes(raw);
  })();

  // cumulative counters
  private totalHttpRequests = 0;
  private totalWsMessages = 0;
  private totalHttpBytes = 0;
  private totalWsBytes = 0;

  // rolling for per-second rates
  private lastTickAt = Date.now();
  private lastHttpRequests = 0;
  private lastWsMessages = 0;
  private lastHttpBytes = 0;
  private lastWsBytes = 0;

  // inter-arrival intervals (ms) used to compute jitter
  private wsIntervals: number[] = [];
  private httpIntervals: number[] = [];
  private lastWsMessageAt: number | null = null;
  private lastHttpResponseAt: number | null = null;
  private lastArduinoTimestamp: string | null = null;

  private tickInterval: NodeJS.Timeout | null = null;
  private histogram = monitorEventLoopDelay({ resolution: 20 });
  private lastElu: ELU = performance.eventLoopUtilization();
  private readonly monitorTickMs: number = (() => {
    const v = Number(
      process.env.MONITOR_TICK_MS ||
        process.env.LIVE_MONITOR_TICK_MS ||
        1000,
    );
    return Number.isFinite(v) && v >= 200 ? v : 1000;
  })();

  // sessions
  private sessions = new Map<string, SessionRecord>();
  private activeSessionId: string | null = null;
  // remember previous liveEmit flag when forcing it during 'ws' sessions
  private prevLiveEmitBeforeSession: boolean | null = null;
  private forcedEmitForSession: boolean = false;
  // controlled WS driver state (for fair comparison at fixed rate)
  private wsDriverTimer: NodeJS.Timeout | null = null;
  private isWsControlled: boolean = false;
  private lastArduinoPayloadBytes: number = 400; // updated by noteArduinoPayloadSize

  // internal HTTP polling driver for measurement sessions
  private selfPollTimer: NodeJS.Timeout | null = null;
  private readonly selfPollUrl =
    process.env.SELF_POLL_URL || 'http://localhost:5000/api/arduino-data';
  private readonly httpAgent = new http.Agent({ keepAlive: true });

  /**
   * Must be called once after Socket.IO is ready.
   */
  init(io: SocketIOServer) {
    this.io = io;
    this.histogram.enable();
  // Informational log only once at startup
    try {
      console.log(
        `[ResourceMonitor] Real-time WS emissions: ${this.liveEmitEnabled ? 'ENABLED' : 'DISABLED'} (set via LIVE_REALTIME_ENABLED)`,
      );
    } catch {}

    if (!this.tickInterval) {
      this.tickInterval = setInterval(() => this.tick(), this.monitorTickMs);
      // do not keep the process alive solely because of this timer
      this.tickInterval.unref();
    }
  }

  /**
   * Stops internal timers and drivers. Use in tests to avoid leaks.
   */
  shutdown() {
    try {
      if (this.tickInterval) {
        clearInterval(this.tickInterval);
        this.tickInterval = null;
      }
      try {
        this.histogram.disable();
      } catch {}
      this.stopSelfPolling();
      this.stopWsDriver();
    } catch {}
  }

  /**
   * Records that an HTTP response with given bytes was sent.
   * Call this from your route wrapping the Arduino endpoint.
   */
  onHttpResponse(bytes: number) {
    this.totalHttpRequests += 1;
    this.totalHttpBytes += bytes;
    const now = Date.now();
    if (this.lastHttpResponseAt) {
      const delta = now - this.lastHttpResponseAt;
      if (delta >= 0) this.pushInterval(this.httpIntervals, delta);
    }
    this.lastHttpResponseAt = now;
  }

  /**
   * Records that a WS payload with given size (bytes) was emitted.
   * Call this where you emit 'arduinoData'.
   */
  onWsEmit(bytes: number) {
    this.totalWsMessages += 1;
    this.totalWsBytes += bytes;
    const now = Date.now();
    if (this.lastWsMessageAt) {
      const delta = now - this.lastWsMessageAt;
      if (delta >= 0) this.pushInterval(this.wsIntervals, delta);
    }
    this.lastWsMessageAt = now;
  }

  /** Enables/disables real‑time WS emissions (useful for test/benchmark isolation). */
  setLiveEmitEnabled(enabled: boolean) {
    this.liveEmitEnabled = !!enabled;
  }

  /** Returns whether real‑time WS emissions are currently enabled. */
  isLiveEmitEnabled(): boolean {
    return this.liveEmitEnabled;
  }

  /** Returns whether a controlled WS driver is active (session-fixed mode). */
  isWsControlledMode(): boolean {
    return this.isWsControlled;
  }

  /** Updates last Arduino timestamp for data freshness calculations. */
  setLastArduinoTimestamp(ts: string) {
    this.lastArduinoTimestamp = ts;
  }

  /** Inform the monitor about the last observed Arduino payload size (bytes). */
  noteArduinoPayloadSize(bytes: number) {
    if (Number.isFinite(bytes) && bytes > 0) this.lastArduinoPayloadBytes = bytes;
  }

  /**
   * Returns snapshots of all sessions.
   */
  listSessions(): SessionRecord[] {
    return Array.from(this.sessions.values()).sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );
  }

  getSession(id: string): SessionRecord | undefined {
    return this.sessions.get(id);
  }

  /**
   * Starts a measurement session. Any ongoing session will be finished first.
   * For `mode: 'polling'` an internal HTTP driver will generate deterministic traffic.
   */
  startSession(config: SessionConfig): SessionRecord {
    // finish any previous session defensively
    if (this.activeSessionId) {
      this.finishSession(this.activeSessionId);
    }

    const id = crypto.randomUUID();
    const cfg: SessionConfig = {
      ...config,
      pollingIntervalMs:
        config.mode === 'polling'
          ? Math.max(100, config.pollingIntervalMs ?? 1000)
          : config.pollingIntervalMs,
    };

    const rec: SessionRecord = {
      id,
      config: cfg,
      startedAt: new Date().toISOString(),
      samples: [],
      meta: {
        nodeVersion: process.versions.node,
        sensorIntervalMs: Number(process.env.SENSOR_SAMPLE_MS || 500),
        mqttTopic: process.env.MQTT_TOPIC,
        envMode: process.env.NODE_ENV,
      },
    };

    this.sessions.set(id, rec);
    this.activeSessionId = id;

    // start internal HTTP driver if needed
    if (cfg.mode === 'polling') {
      const every = cfg.pollingIntervalMs ?? 1000;
      this.startSelfPolling(every);
    } else {
      this.stopSelfPolling(); // ensure it's off
      // ensure WS emissions are enabled during a WS session
      if (this.prevLiveEmitBeforeSession === null) {
        this.prevLiveEmitBeforeSession = this.liveEmitEnabled;
      }
  // mark if we actually force-enable (so we know whether to restore later)
  this.forcedEmitForSession = !this.liveEmitEnabled;
  if (this.forcedEmitForSession) this.setLiveEmitEnabled(true);
      // optional controlled WS driver at fixed rate
      const hz = cfg.wsFixedRateHz && cfg.wsFixedRateHz > 0 ? cfg.wsFixedRateHz : 0;
      if (hz > 0) {
        this.startWsDriver(hz, cfg.assumedPayloadBytes);
      }
    }

    // optional duration guard
    if (cfg.durationSec) {
      setTimeout(() => {
        if (this.activeSessionId === id) this.finishSession(id);
      }, cfg.durationSec * 1000).unref();
    }

    return rec;
  }

  /**
   * Finishes a session. Stops internal driver if it was a polling session.
   */
  finishSession(id: string): SessionRecord | undefined {
    const rec = this.sessions.get(id);
    if (!rec || rec.finishedAt) return rec;

    rec.finishedAt = new Date().toISOString();
    if (this.activeSessionId === id) this.activeSessionId = null;

    if (rec.config.mode === 'polling') {
      this.stopSelfPolling();
    }
    if (rec.config.mode === 'ws') {
      this.stopWsDriver();
    }
    // restore previous WS emission flag after a WS session ends
    if (
      rec.config.mode === 'ws' &&
      this.prevLiveEmitBeforeSession !== null &&
      this.forcedEmitForSession
    ) {
      this.setLiveEmitEnabled(this.prevLiveEmitBeforeSession);
    }
    // clear remembered state
    this.prevLiveEmitBeforeSession = null;
    this.forcedEmitForSession = false;
    return rec;
  }

  /**
   * Clears all sessions and stops any active drivers.
   * @returns number of cleared sessions
   */
  resetSessions(): number {
    const count = this.sessions.size;
    this.sessions.clear();
    this.activeSessionId = null;
    this.stopSelfPolling();
  this.stopWsDriver();
    // restore emission flag if it was overridden
    if (this.prevLiveEmitBeforeSession !== null && this.forcedEmitForSession) {
      this.setLiveEmitEnabled(this.prevLiveEmitBeforeSession);
    }
    this.prevLiveEmitBeforeSession = null;
    this.forcedEmitForSession = false;
    return count;
  }

  /**
   * Deletes single session by id.
   */
  deleteSession(id: string): boolean {
    if (this.activeSessionId === id) this.activeSessionId = null;
    return this.sessions.delete(id);
  }

  /**
   * Returns an on-demand snapshot of live metrics.
   */
  async sampleNow(): Promise<LiveMetrics> {
    return this.computeMetrics();
  }

  /* -------------------------------------------------------------------------------------------------
   * Internals
   * ------------------------------------------------------------------------------------------------- */

  private async tick() {
    try {
      const metrics = await this.computeMetrics();

      // emit to clients (real-time monitoring)
      if (this.liveEmitEnabled) {
        this.io?.emit('metrics', metrics);
      }

      // append to active session if any
      if (this.activeSessionId) {
        const rec = this.sessions.get(this.activeSessionId);
        if (rec && !rec.finishedAt) {
          rec.samples.push(metrics);
          const { sampleCount } = rec.config;
          if (sampleCount && rec.samples.length >= sampleCount) {
            this.finishSession(rec.id);
          }
        }
      }
    } catch (e) {
      // never throw from timer
      console.error('ResourceMonitor tick error:', e);
    }
  }

  private async computeMetrics(): Promise<LiveMetrics> {
    const now = Date.now();
    const dtSec = Math.max(0.001, (now - this.lastTickAt) / 1000);

    const usage = await pidusage(process.pid);

    // ELU delta
    const currentElu = performance.eventLoopUtilization(this.lastElu);
    this.lastElu = currentElu;

    // event loop delay percentiles (nanoseconds -> ms)
    const p50 = this.histogram.percentile(50) / 1e6;
    const p99 = this.histogram.percentile(99) / 1e6;
    const pMax = this.histogram.max / 1e6;

    // memory
    const mem = process.memoryUsage();

    // ws clients in default namespace
    const wsClients = this.io ? this.io.of('/').sockets.size : 0;

    // compute per-second rates from deltas
    const httpReqDelta = this.totalHttpRequests - this.lastHttpRequests;
    const wsMsgDelta = this.totalWsMessages - this.lastWsMessages;
    const httpBytesDelta = this.totalHttpBytes - this.lastHttpBytes;
    const wsBytesDelta = this.totalWsBytes - this.lastWsBytes;

    const httpReqRate = httpReqDelta / dtSec;
    const wsMsgRate = wsMsgDelta / dtSec;
    const httpBytesRate = httpBytesDelta / dtSec;
    const wsBytesRate = wsBytesDelta / dtSec;

    const httpAvgBytesPerReq =
      httpReqDelta > 0 ? httpBytesDelta / httpReqDelta : 0;
    const wsAvgBytesPerMsg = wsMsgDelta > 0 ? wsBytesDelta / wsMsgDelta : 0;

    const httpJitterMs = this.stdDev(this.httpIntervals);
    const wsJitterMs = this.stdDev(this.wsIntervals);
    let dataFreshnessMs = 0;
    if (this.lastArduinoTimestamp) {
      const t = Date.parse(this.lastArduinoTimestamp);
      if (!Number.isNaN(t)) dataFreshnessMs = Date.now() - t;
    }

    // update "last" counters
    this.lastTickAt = now;
    this.lastHttpRequests = this.totalHttpRequests;
    this.lastWsMessages = this.totalWsMessages;
    this.lastHttpBytes = this.totalHttpBytes;
    this.lastWsBytes = this.totalWsBytes;

    return {
      ts: new Date().toISOString(),
      cpu: usage.cpu, // %
      rssMB: usage.memory / 1024 / 1024,
      heapUsedMB: mem.heapUsed / 1024 / 1024,
      heapTotalMB: mem.heapTotal / 1024 / 1024,
      externalMB: mem.external / 1024 / 1024,
      arrayBuffersMB:
        // arrayBuffers is not present in very old Node versions
        (mem as any).arrayBuffers ? (mem as any).arrayBuffers / 1024 / 1024 : 0,

      elu: currentElu.utilization,
      elDelayP50Ms: p50,
      elDelayP99Ms: p99,
      elDelayMaxMs: pMax,

      wsClients,
      httpReqRate,
      wsMsgRate,
      httpBytesRate,
      wsBytesRate,
      httpAvgBytesPerReq,
      wsAvgBytesPerMsg,
      httpJitterMs,
      wsJitterMs,
      dataFreshnessMs,

      totalHttpRequests: this.totalHttpRequests,
      totalWsMessages: this.totalWsMessages,
      totalHttpBytes: this.totalHttpBytes,
      totalWsBytes: this.totalWsBytes,

      loadAvg1: os.loadavg()[0] ?? 0,
      uptimeSec: process.uptime(),
    };
  }

  /* --------------------------- Internal HTTP driver --------------------------- */

  /**
   * Starts internal HTTP polling driver to hit /api/arduino-data at a given interval.
   * This guarantees deterministic traffic for 'polling' sessions, independent of the UI.
   */
  private startSelfPolling(intervalMs: number) {
    this.stopSelfPolling(); // safety

    const every = Math.max(50, intervalMs);

    const doOnce = () => {
      try {
        const url = new URL(this.selfPollUrl);
        const req = http.request(
          {
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port || 80,
            path: url.pathname + (url.search || ''),
            method: 'GET',
            agent: this.httpAgent,
            timeout: Math.max(1000, every - 10),
          },
          res => {
            // consume and discard body to free socket
            res.on('data', () => {});
            res.on('end', () => {});
          },
        );
        req.on('error', () => {
          // Swallow errors to keep the driver running; consider logging in development.
        });
        req.end();
      } catch {
        // ignore
      }
    };

    // kick-off immediately
    doOnce();
    this.selfPollTimer = setInterval(doOnce, every);
    this.selfPollTimer.unref();
  }

  /**
   * Stops internal HTTP polling driver if running.
   */
  private stopSelfPolling() {
    if (this.selfPollTimer) {
      clearInterval(this.selfPollTimer);
      this.selfPollTimer = null;
    }
  }

  /** Starts a controlled WS driver at fixed rate, incrementing WS counters fairly. */
  private startWsDriver(hz: number, assumedBytes?: number) {
    this.stopWsDriver();
    const every = Math.max(5, Math.floor(1000 / hz));
    this.isWsControlled = true;
    const payloadBytes = Math.max(1, Math.floor(assumedBytes || this.lastArduinoPayloadBytes));
    const doOnce = () => {
      try {
        // Count WS emission with approximate payload size; keep freshness up-to-date
        this.onWsEmit(payloadBytes);
        this.setLastArduinoTimestamp(new Date().toISOString());
      } catch {}
    };
    doOnce();
    this.wsDriverTimer = setInterval(doOnce, every);
    this.wsDriverTimer.unref();
  }

  /** Stops the controlled WS driver if running. */
  private stopWsDriver() {
    if (this.wsDriverTimer) {
      clearInterval(this.wsDriverTimer);
      this.wsDriverTimer = null;
    }
    this.isWsControlled = false;
  }

  /** Maintains a bounded rolling window of recent intervals */
  private pushInterval(store: number[], value: number, max = 200) {
    store.push(value);
    if (store.length > max) store.splice(0, store.length - max);
  }

  /** Standard deviation (ms) */
  private stdDev(arr: number[]): number {
    if (arr.length < 2) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance =
      arr.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (arr.length - 1);
    return Math.sqrt(variance);
  }
}

export const ResourceMonitor = new ResourceMonitorService();
export default ResourceMonitorService;
