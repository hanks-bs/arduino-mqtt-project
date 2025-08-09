// frontend/src/types/monitoring.ts
export interface LiveMetrics {
	ts: string;
	cpu: number;
	rssMB: number;
	heapUsedMB: number;
	heapTotalMB: number;
	externalMB: number;
	arrayBuffersMB: number;

	elu: number;
	elDelayP50Ms: number;
	elDelayP99Ms: number;
	elDelayMaxMs: number;

	wsClients: number;
	httpReqRate: number;
	wsMsgRate: number;

	httpBytesRate: number;
	wsBytesRate: number;
	httpAvgBytesPerReq: number;
	wsAvgBytesPerMsg: number;
	httpJitterMs: number;
	wsJitterMs: number;
	dataFreshnessMs: number;

	totalHttpRequests: number;
	totalWsMessages: number;
	totalHttpBytes: number;
	totalWsBytes: number;

	loadAvg1: number;
	uptimeSec: number;
}

export interface SessionConfig {
	label: string;
	mode: "ws" | "polling";
	pollingIntervalMs?: number;
	sampleCount?: number;
	durationSec?: number;
	/** Pomijaj pierwsze N sekund (stabilizacja) */
	warmupSec?: number;
	/** Pomijaj ostatnie N sekund (cooldown) */
	cooldownSec?: number;
	/** Dla WS: kontrolowany driver z ustaloną częstotliwością (Hz) */
	wsFixedRateHz?: number;
	/** Założony rozmiar payloadu w bajtach (gdy brak realnego) */
	assumedPayloadBytes?: number;
}

export interface SessionRecord {
	id: string;
	config: SessionConfig;
	startedAt: string;
	finishedAt?: string;
	samples: LiveMetrics[];
}
