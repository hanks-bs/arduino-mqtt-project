// Typy dla panelu uruchamiania badań (research runs)

export interface ResearchRunStatus {
	id: string;
	startedAt: string;
	finishedAt?: string;
	error?: string;
	outDir?: string;
	// echo z runMeasurements (parametry) – nie używamy szczegółowo po stronie klienta
	flags?: Record<string, unknown>;
	evaluatedCount?: number;
	config?: Record<string, unknown>;
	configLabel?: string;
	totalSessions?: number;
	completedSessions?: number;
	currentLabel?: string;
	scenarioIndex?: number;
	scenarioTotal?: number;
	repIndex?: number;
	repTotal?: number;
	aborting?: boolean;
}

// Minimalny zestaw opcji które panel może wysłać do /api/research/run
export interface ResearchRunRequest {
	modes?: ("ws" | "polling")[];
	hzSet?: number[];
	loadSet?: number[];
	durationSec?: number;
	tickMs?: number;
	warmupSec?: number;
	cooldownSec?: number;
	repeats?: number;
	pair?: boolean;
	clientsHttp?: number; // single value
	clientsWs?: number;
	clientsHttpSet?: number[]; // zestawy
	clientsWsSet?: number[];
	payloadWs?: number;
	payloadHttp?: number;
	cpuSampleMs?: number;
	realData?: boolean; // pasywny tryb pracy na rzeczywistych danych (MQTT+HTTP)
}

export interface ResearchPresetDescriptor {
	key: string;
	label: string;
	description: string;
	config: ResearchRunRequest;
}

// Struktura uproszczona summary.json (interesują nas podstawowe pola porównawcze)
export interface ResearchSummaryEntry {
	label: string;
	mode: "ws" | "polling";
	avgRate: number;
	avgBytesRate: number;
	avgPayload: number;
	avgCpu: number;
	avgRss: number;
	avgJitterMs: number;
	avgFreshnessMs: number;
	avgDelayP99: number;
	clients?: number;
	loadCpuPct?: number;
}

export interface ResearchSummaryResponse {
	summaries: ResearchSummaryEntry[]; // może być rozszerzone przez backend (posiadamy więcej pól)
	byLoad?: Record<string, unknown> | Array<Record<string, unknown>>;
	byClients?: Record<string, unknown> | Array<Record<string, unknown>>;
	flags?: Record<string, unknown>;
	runConfig?: Record<string, unknown>;
	runConfigs?: Record<string, unknown>[];
}
