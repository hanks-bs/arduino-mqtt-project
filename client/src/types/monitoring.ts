// frontend/src/types/monitoring.ts
export interface LiveMetrics {
	ts: string;
	cpu: number;
	rssMB: number;
	heapUsedMB: number;
	heapTotalMB: number;
	externalMB: number;
	arrayBuffersMB: number;

	/** Faktyczny odstęp między próbkami (monotonicznie) [ms] */
	tickMs: number;

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

// Typy Session* zostały usunięte z klienta – logika sesji jest teraz
// zarządzana wyłącznie po stronie API / narzędzi badawczych.
