/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import type {
	LiveMetrics,
	SessionConfig,
	SessionRecord,
} from "@/types/monitoring";
import {
	Alert,
	Box,
	Button,
	Chip,
	Checkbox,
	Divider,
	FormControlLabel,
	Grid,
	MenuItem,
	Paper,
	Stack,
	TextField,
	Tooltip,
	Typography,
} from "@mui/material";
import type { ApexOptions } from "apexcharts";
import { useTheme } from "@mui/material/styles";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:5000";
const API = API_BASE;

/* -------------------------------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------------------------------- */

/** Simple helper to fetch JSON. */
async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
	const res = await fetch(url, {
		...init,
		headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
	});
	const json = await res.json();
	if (!json.success) throw new Error(json.error || "Request failed");
	return json.data as T;
}

/** Returns protocol label for the session. */
function protoLabel(s: SessionRecord): "HTTP" | "WebSocket" {
	return s.config.mode === "polling" ? "HTTP" : "WebSocket";
}

/** Builds a human-readable series name. */
function seriesName(s: SessionRecord, metric: string, unit: string) {
	return `${s.config.label} [${protoLabel(s)}] — ${metric}${
		unit ? " " + unit : ""
	}`.trim();
}

/** Maps samples to (x=index, y=value). Index is 1-based. */
function toIndexSeries<T extends LiveMetrics>(
	samples: T[] | undefined,
	selector: (m: T) => number
) {
	if (!samples?.length) return [];
	return samples.map((m, i) => ({ x: i + 1, y: selector(m) }));
}

/** Base options with numeric X axis (sample index). */
function baseOptions(title: string, yTitle: string): ApexOptions {
	return {
		chart: { toolbar: { show: true }, animations: { enabled: false } },
		xaxis: {
			type: "numeric",
			title: { text: "Numer próbki" },
			labels: { formatter: val => `${Number(val).toFixed(0)}` },
		},
		yaxis: { title: { text: yTitle } },
		stroke: { curve: "smooth", width: 2 },
		legend: { position: "top" },
		tooltip: {
			shared: true,
			intersect: false,
			x: { formatter: val => `Próbka #${Number(val).toFixed(0)}` },
		},
		title: { text: title, align: "center" },
	};
}

/** Returns true if two sessions overlap in time window. */
function overlap(a: SessionRecord, b: SessionRecord): boolean {
	const aStart = new Date(a.startedAt).getTime();
	const aEnd = a.finishedAt
		? new Date(a.finishedAt).getTime()
		: Number.MAX_SAFE_INTEGER;
	const bStart = new Date(b.startedAt).getTime();
	const bEnd = b.finishedAt
		? new Date(b.finishedAt).getTime()
		: Number.MAX_SAFE_INTEGER;
	return aStart <= bEnd && bStart <= aEnd;
}

/* -------------------------------------------------------------------------------------------------
 * Component
 * ------------------------------------------------------------------------------------------------- */

export default function SessionPanel() {
	const theme = useTheme();
	// Sessions state
	const [sessions, setSessions] = useState<SessionRecord[]>([]);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [loading, setLoading] = useState(false);

	// New session form
	const [label, setLabel] = useState("Test 1");
	const [mode, setMode] = useState<"ws" | "polling">("ws");
	const [pollMs, setPollMs] = useState(2000);
	const [sampleCount, setSampleCount] = useState(120);
	const [durationSec, setDurationSec] = useState<number | undefined>(undefined);

	const reload = useCallback(async () => {
		const list = await fetchJSON<SessionRecord[]>(
			`${API}/api/monitor/sessions`
		);
		setSessions(list);

		// Initial auto-select: pick the newest session of each mode if nothing selected
		if (selectedIds.size === 0 && list.length) {
			const newestWs = list.find(s => s.config.mode === "ws");
			const newestHttp = list.find(s => s.config.mode === "polling");
			const next = new Set<string>();
			if (newestWs) next.add(newestWs.id);
			if (newestHttp) next.add(newestHttp.id);
			if (next.size === 0) {
				// fallback: select newest overall
				next.add(list[0].id);
			}
			setSelectedIds(next);
		} else {
			// drop selections for removed sessions
			const still = new Set(list.map(s => s.id));
			setSelectedIds(prev => new Set([...prev].filter(id => still.has(id))));
		}
	}, [selectedIds.size]);

	useEffect(() => {
		reload().catch(console.error);
		const it = setInterval(reload, 5000);
		return () => clearInterval(it);
	}, [reload]);

	const activeSession = useMemo(
		() => sessions.find(s => !s.finishedAt),
		[sessions]
	);

	const toggleSelect = (id: string) => {
		setSelectedIds(prev => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const start = async () => {
		if (activeSession) return; // UI guard
		setLoading(true);
		try {
			const cfg: SessionConfig = {
				label,
				mode,
				pollingIntervalMs: pollMs,
				sampleCount,
				durationSec,
			};
			await fetchJSON<SessionRecord>(`${API}/api/monitor/start`, {
				method: "POST",
				body: JSON.stringify(cfg),
			});
			await reload();
		} finally {
			setLoading(false);
		}
	};

	const stop = async (id: string) => {
		setLoading(true);
		try {
			await fetchJSON<SessionRecord>(`${API}/api/monitor/stop`, {
				method: "POST",
				body: JSON.stringify({ id }),
			});
			await reload();
		} finally {
			setLoading(false);
		}
	};

	const resetAll = async () => {
		setLoading(true);
		try {
			await fetchJSON<{ cleared: number }>(`${API}/api/monitor/reset`, {
				method: "POST",
			});
			setSelectedIds(new Set());
			await reload();
		} finally {
			setLoading(false);
		}
	};

	const exportSessions = () => {
		const data = JSON.stringify(sessions, null, 2);
		const blob = new Blob([data], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `sessions-export-${new Date().toISOString()}.json`;
		a.click();
		URL.revokeObjectURL(url);
	};

	const selectedSessions = useMemo(
		() => sessions.filter(s => selectedIds.has(s.id)),
		[sessions, selectedIds]
	);

	const firstSelected = selectedSessions[0];

	interface Aggregates {
		id: string;
		label: string;
		mode: "ws" | "polling";
		count: number;
		avgCpu: number;
		avgRss: number;
		avgElu: number;
		avgDelayP99: number;
		avgRate: number;
		avgBytesRate: number;
		cpuPerUnit: number;
		bytesPerUnit: number;
		avgBytesPayload: number;
		avgJitterMs: number;
		avgFreshnessMs: number;
	}

	const aggregates: Aggregates[] = useMemo(() => {
		return selectedSessions.map(s => {
			const n = s.samples.length || 1;
			const sum = s.samples.reduce(
				(acc, m) => {
					acc.cpu += m.cpu;
					acc.rss += m.rssMB;
					acc.elu += m.elu;
					acc.delay += m.elDelayP99Ms;
					acc.fresh += m.dataFreshnessMs;
					if (s.config.mode === "polling") {
						acc.rate += m.httpReqRate;
						acc.bytes += m.httpBytesRate;
						acc.bytesPayload += m.httpAvgBytesPerReq;
						acc.jitter += m.httpJitterMs;
					} else {
						acc.rate += m.wsMsgRate;
						acc.bytes += m.wsBytesRate;
						acc.bytesPayload += m.wsAvgBytesPerMsg;
						acc.jitter += m.wsJitterMs;
					}
					return acc;
				},
				{
					cpu: 0,
					rss: 0,
					elu: 0,
					delay: 0,
					rate: 0,
					bytes: 0,
					bytesPayload: 0,
					jitter: 0,
					fresh: 0,
				}
			);
			const avgCpu = sum.cpu / n;
			const avgRss = sum.rss / n;
			const avgElu = sum.elu / n;
			const avgDelayP99 = sum.delay / n;
			const avgRate = sum.rate / n;
			const avgBytesRate = sum.bytes / n;
			const avgBytesPayload = sum.bytesPayload / n;
			const avgJitterMs = sum.jitter / n;
			const avgFreshnessMs = sum.fresh / n;
			const cpuPerUnit = avgCpu / Math.max(avgRate, 1);
			const bytesPerUnit = avgBytesRate / Math.max(avgRate, 1);
			return {
				id: s.id,
				label: s.config.label,
				mode: s.config.mode,
				count: n,
				avgCpu,
				avgRss,
				avgElu,
				avgDelayP99,
				avgRate,
				avgBytesRate,
				cpuPerUnit,
				bytesPerUnit,
				avgBytesPayload,
				avgJitterMs,
				avgFreshnessMs,
			};
		});
	}, [selectedSessions]);

	// -------------------------- Scoring & expectations --------------------------
	const thresholds = {
		p99MsGood: 20,
		p99MsWarn: 40,
		eluGood: 0.5,
		eluWarn: 0.7,
		jitterGood: 20,
		jitterWarn: 40,
		freshGood: 1500,
		freshWarn: 3000,
	};

	function rankValues(values: number[], lowerIsBetter = true): number[] {
		const sorted = [...values]
			.map((v, i) => ({ v, i }))
			.sort((a, b) => (lowerIsBetter ? a.v - b.v : b.v - a.v));
		const ranks: number[] = Array(values.length).fill(0);
		sorted.forEach((item, idx) => (ranks[item.i] = idx + 1));
		return ranks;
	}

	const bestAggregate = useMemo(() => {
		if (aggregates.length === 0) return null;
		// Build arrays
		const cpuPer = aggregates.map(a => a.cpuPerUnit);
		const bytesPer = aggregates.map(a => a.bytesPerUnit);
		const p99 = aggregates.map(a => a.avgDelayP99);
		const jitter = aggregates.map(a => a.avgJitterMs);
		const fresh = aggregates.map(a => a.avgFreshnessMs);
		const elu = aggregates.map(a => a.avgElu);
		// Ranks (lower is better for all)
		const rCpu = rankValues(cpuPer, true);
		const rBytes = rankValues(bytesPer, true);
		const rP99 = rankValues(p99, true);
		const rJit = rankValues(jitter, true);
		const rFresh = rankValues(fresh, true);
		const rElu = rankValues(elu, true);
		// Weighted sum (weights ~ importance)
		const weights = { cpu: 3, bytes: 2, p99: 3, jitter: 2, fresh: 1, elu: 2 } as const;
		const scores = aggregates.map((_, i) =>
			weights.cpu * rCpu[i] +
			weights.bytes * rBytes[i] +
			weights.p99 * rP99[i] +
			weights.jitter * rJit[i] +
			weights.fresh * rFresh[i] +
			weights.elu * rElu[i]
		);
		let bestIdx = 0;
		let bestScore = scores[0];
		for (let i = 1; i < scores.length; i++) {
			if (scores[i] < bestScore) {
				bestScore = scores[i];
				bestIdx = i;
			}
		}
		return { item: aggregates[bestIdx], score: bestScore };
	}, [aggregates]);

	function colorFor(value: number, kind: "p99" | "elu" | "jitter" | "fresh") {
		if (kind === "p99") {
			if (value < thresholds.p99MsGood) return theme.palette.success.main;
			if (value < thresholds.p99MsWarn) return theme.palette.warning.main;
			return theme.palette.error.main;
		}
		if (kind === "elu") {
			if (value < thresholds.eluGood) return theme.palette.success.main;
			if (value < thresholds.eluWarn) return theme.palette.warning.main;
			return theme.palette.error.main;
		}
		if (kind === "jitter") {
			if (value < thresholds.jitterGood) return theme.palette.success.main;
			if (value < thresholds.jitterWarn) return theme.palette.warning.main;
			return theme.palette.error.main;
		}
		// fresh
		if (value < thresholds.freshGood) return theme.palette.success.main;
		if (value < thresholds.freshWarn) return theme.palette.warning.main;
		return theme.palette.error.main;
	}

	const overheadRatio = useMemo(() => {
		const ws = aggregates.find(a => a.mode === "ws");
		const http = aggregates.find(a => a.mode === "polling");
		if (!ws || !http) return null;
		return http.cpuPerUnit / ws.cpuPerUnit;
	}, [aggregates]);

	// Warn if selected sessions overlap in time (we expect sequential tests).
	const haveOverlap = useMemo(() => {
		for (let i = 0; i < selectedSessions.length; i++) {
			for (let j = i + 1; j < selectedSessions.length; j++) {
				if (overlap(selectedSessions[i], selectedSessions[j])) return true;
			}
		}
		return false;
	}, [selectedSessions]);

	/* --------------------------- Series builders --------------------------- */

	// CPU — one series per session
	const cpuSeries = useMemo(() => {
		return selectedSessions.map(s => ({
			name: seriesName(s, "CPU", "%"),
			data: toIndexSeries(s.samples, m => m.cpu),
		}));
	}, [selectedSessions]);

	// Helper: map mode to color for consistent legend coloring
	const modeColor = (mode: "ws" | "polling") =>
		mode === "ws" ? theme.palette.info.main : theme.palette.secondary.main;
	const modeColorLight = (mode: "ws" | "polling") =>
		mode === "ws" ? theme.palette.info.light : theme.palette.secondary.light;
	const modeColorStrong = modeColor;

	// Colors arrays matching series ordering
	const colorsForSeries = (items: { mode: "ws" | "polling" }[]) =>
		items.map(i => modeColor(i.mode));

	// Memory (RSS + Heap) — two physical sub-metrics, still acceptable to plot together
	const memSeries = useMemo(() => {
		const rss = selectedSessions.map(s => ({
			name: seriesName(s, "RSS", "MB"),
			data: toIndexSeries(s.samples, m => m.rssMB),
		}));
		const heap = selectedSessions.map(s => ({
			name: seriesName(s, "Heap", "MB"),
			data: toIndexSeries(s.samples, m => m.heapUsedMB),
		}));
		return [...rss, ...heap];
	}, [selectedSessions]);

	// ELU — one series per session
	const eluSeries = useMemo(() => {
		return selectedSessions.map(s => ({
			name: seriesName(s, "ELU", ""),
			data: toIndexSeries(s.samples, m => m.elu),
		}));
	}, [selectedSessions]);

	// Loop delay p99 only — one series per session
	const loopP99Series = useMemo(() => {
		return selectedSessions.map(s => ({
			name: seriesName(s, "opóźnienie p99", "ms"),
			data: toIndexSeries(s.samples, m => m.elDelayP99Ms),
		}));
	}, [selectedSessions]);

	// Events per second — exactly one series per session, depends on protocol
	const eventsSeries = useMemo(() => {
		return selectedSessions.map(s => {
			const isHttp = s.config.mode === "polling";
			const metric = isHttp
				? (m: LiveMetrics) => m.httpReqRate
				: (m: LiveMetrics) => m.wsMsgRate;
			const label = isHttp ? "zdarzenia/s (req/s)" : "zdarzenia/s (msg/s)";
			return {
				name: seriesName(s, label, "/s"),
				data: toIndexSeries(s.samples, metric),
			};
		});
	}, [selectedSessions]);

	// Bytes per second — exactly one series per session, depends on protocol
	const bytesSeries = useMemo(() => {
		return selectedSessions.map(s => {
			const isHttp = s.config.mode === "polling";
			const metric = isHttp
				? (m: LiveMetrics) => m.httpBytesRate
				: (m: LiveMetrics) => m.wsBytesRate;
			const label = isHttp ? "bajty/s (HTTP)" : "bajty/s (WS)";
			return {
				name: seriesName(s, label, "B/s"),
				data: toIndexSeries(s.samples, metric),
			};
		});
	}, [selectedSessions]);

	// Avg payload size per message/request
	const payloadSizeSeries = useMemo(() => {
		return selectedSessions.map(s => {
			const isHttp = s.config.mode === "polling";
			const metric = isHttp
				? (m: LiveMetrics) => m.httpAvgBytesPerReq
				: (m: LiveMetrics) => m.wsAvgBytesPerMsg;
			const label = isHttp
				? "Śr. rozmiar payloadu (HTTP)"
				: "Śr. rozmiar payloadu (WS)";
			return {
				name: seriesName(s, label, "B"),
				data: toIndexSeries(s.samples, metric),
			};
		});
	}, [selectedSessions]);

	// Jitter (inter-arrival std dev)
	const jitterSeries = useMemo(() => {
		return selectedSessions.map(s => {
			const isHttp = s.config.mode === "polling";
			const metric = isHttp
				? (m: LiveMetrics) => m.httpJitterMs
				: (m: LiveMetrics) => m.wsJitterMs;
			const label = isHttp
				? "Jitter inter-arrival (HTTP)"
				: "Jitter inter-arrival (WS)";
			return {
				name: seriesName(s, label, "ms"),
				data: toIndexSeries(s.samples, metric),
			};
		});
	}, [selectedSessions]);

	// CPU per unit (derived per sample)
	const cpuPerUnitSeries = useMemo(() => {
		return selectedSessions.map(s => {
			const isHttp = s.config.mode === "polling";
			const seriesData = toIndexSeries(s.samples, m => {
				const rate = isHttp ? m.httpReqRate : m.wsMsgRate;
				return rate > 0 ? m.cpu / rate : 0;
			});
			return {
				name: seriesName(s, "CPU/jednostkę", "%/evt"),
				data: seriesData,
			};
		});
	}, [selectedSessions]);

	// Bytes per unit (derived per sample)
	const bytesPerUnitSeries = useMemo(() => {
		return selectedSessions.map(s => {
			const isHttp = s.config.mode === "polling";
			const seriesData = toIndexSeries(s.samples, m => {
				const rate = isHttp ? m.httpReqRate : m.wsMsgRate;
				const bytesRate = isHttp ? m.httpBytesRate : m.wsBytesRate;
				return rate > 0 ? bytesRate / rate : 0;
			});
			return {
				name: seriesName(s, "B/jednostkę", "B/evt"),
				data: seriesData,
			};
		});
	}, [selectedSessions]);

	/* ------------------------------- Options ------------------------------- */

	const cpuOptions: ApexOptions = {
		...baseOptions("Zużycie CPU (%)", "%"),
		colors: colorsForSeries(selectedSessions.map(s => ({ mode: s.config.mode }))),
	};
	const memOptions: ApexOptions = {
		...baseOptions("Pamięć procesu (MB)", "MB"),
		colors: [
			...selectedSessions.map(s => modeColorStrong(s.config.mode)), // RSS
			...selectedSessions.map(s => modeColorLight(s.config.mode)), // Heap
		],
		stroke: {
			curve: "smooth",
			width: 2,
			dashArray: [
				...Array(selectedSessions.length).fill(0), // RSS solid
				...Array(selectedSessions.length).fill(5), // Heap dashed
			],
		},
	};
	const eluOptions: ApexOptions = {
		...baseOptions("Wykorzystanie pętli zdarzeń (ELU)", "ELU"),
		colors: colorsForSeries(selectedSessions.map(s => ({ mode: s.config.mode }))),
	};
	const loopOptions: ApexOptions = {
		...baseOptions("Opóźnienie pętli zdarzeń p99 (ms)", "ms"),
		colors: colorsForSeries(selectedSessions.map(s => ({ mode: s.config.mode }))),
	};
	const eventsOptions: ApexOptions = {
		...baseOptions("Zdarzenia na sekundę (/s)", "/s"),
		colors: colorsForSeries(selectedSessions.map(s => ({ mode: s.config.mode }))),
	};
	const bytesOptions: ApexOptions = {
		...baseOptions("Przepływ bajtów (B/s)", "B/s"),
		colors: colorsForSeries(selectedSessions.map(s => ({ mode: s.config.mode }))),
	};
	const payloadSizeOptions: ApexOptions = {
		...baseOptions("Średni rozmiar payloadu", "B"),
		colors: colorsForSeries(selectedSessions.map(s => ({ mode: s.config.mode }))),
	};
	const jitterOptions: ApexOptions = {
		...baseOptions("Jitter inter-arrival (odch. std)", "ms"),
		colors: colorsForSeries(selectedSessions.map(s => ({ mode: s.config.mode }))),
	};
	const cpuPerUnitOptions: ApexOptions = {
		...baseOptions("CPU na jednostkę danych", "%/evt"),
		colors: colorsForSeries(selectedSessions.map(s => ({ mode: s.config.mode }))),
	};
	const bytesPerUnitOptions: ApexOptions = {
		...baseOptions("Bajty na jednostkę danych", "B/evt"),
		colors: colorsForSeries(selectedSessions.map(s => ({ mode: s.config.mode }))),
	};

	(eluOptions.yaxis as any).min = 0;
	(eluOptions.yaxis as any).max = 1;

	/* -------------------------------- Render -------------------------------- */

	return (
		<Box>
			{/* Expectations & optimality summary */}
			<Paper sx={{ p: 2, mb: 3 }}>
				<Typography variant='subtitle1' gutterBottom>
					Oczekiwane wyniki (kryteria) i optymalność
				</Typography>
				<Stack direction='row' spacing={1} sx={{ flexWrap: "wrap", mb: 1 }}>
					<Chip color='success' variant='outlined' label='p99 opóźnienia < 20 ms (lepiej < 20, ostrzeżenie < 40)' />
					<Chip color='success' variant='outlined' label='ELU < 0.5 (ostrz. < 0.7)' />
					<Chip color='success' variant='outlined' label='Jitter inter-arrival niski (stabilny)' />
					<Chip color='success' variant='outlined' label='CPU/jednostkę – jak najniżej' />
					<Chip color='success' variant='outlined' label='Bajty/jednostkę – jak najniżej' />
					<Chip color='success' variant='outlined' label='Świeżość danych – jak najniższa (ms)' />
				</Stack>
				{bestAggregate && (
					<Alert severity='success'>
						Najbardziej optymalna (wg powyższych kryteriów):
						<strong> {bestAggregate.item.label}</strong> [{bestAggregate.item.mode === "ws" ? "WS" : "HTTP"}]
					</Alert>
				)}
				<Typography variant='body2' sx={{ mt: 1 }}>
					Skrót aspektów projektu badawczego: porównanie strategii dostarczania danych
					(WebSocket push vs HTTP polling) pod kątem kosztu CPU, ELU/opóźnień pętli,
					stabilności (jitter), narzutu bajtowego i świeżości danych.
				</Typography>
			</Paper>
			<Typography variant='h6' gutterBottom>
				Sesje pomiarowe
			</Typography>

			{aggregates.length > 0 && (
				<Paper sx={{ p: 2, mb: 3 }}>
					<Typography variant='subtitle1' gutterBottom>
						Zestawienie statystyk (wybrane sesje)
					</Typography>
					<Box sx={{ overflowX: "auto" }}>
						<table style={{ width: "100%", borderCollapse: "collapse" }}>
							<thead>
								<tr>
									<th style={{ textAlign: "left", padding: 4 }}>Sesja</th>
									<th style={{ textAlign: "right", padding: 4 }}>Tryb</th>
									<th style={{ textAlign: "right", padding: 4 }}>Próbki</th>
									<th style={{ textAlign: "right", padding: 4 }}>CPU % avg</th>
									<th style={{ textAlign: "right", padding: 4 }}>RSS MB avg</th>
									<th style={{ textAlign: "right", padding: 4 }}>ELU avg</th>
									<th style={{ textAlign: "right", padding: 4 }}>
										Delay p99 ms
									</th>
									<th style={{ textAlign: "right", padding: 4 }}>Rate /s</th>
									<th style={{ textAlign: "right", padding: 4 }}>Bytes /s</th>
									<th style={{ textAlign: "right", padding: 4 }}>CPU/jedn.</th>
									<th style={{ textAlign: "right", padding: 4 }}>B/jedn.</th>
									<th style={{ textAlign: "right", padding: 4 }}>
										Śr. B/payload
									</th>
									<th style={{ textAlign: "right", padding: 4 }}>Jitter ms</th>
								</tr>
							</thead>
							<tbody>
								{aggregates.map(a => (
									<tr key={a.id}>
										<td style={{ padding: 4 }}>{a.label}</td>
										<td style={{ padding: 4, textAlign: "right" }}>
											{a.mode === "ws" ? "WS" : "HTTP"}
										</td>
										<td style={{ padding: 4, textAlign: "right" }}>
											{a.count}
										</td>
										<td style={{ padding: 4, textAlign: "right" }}>
											{a.avgCpu.toFixed(1)}
										</td>
										<td style={{ padding: 4, textAlign: "right" }}>
											{a.avgRss.toFixed(1)}
										</td>
										<td style={{ padding: 4, textAlign: "right" }}>
											<span style={{ color: colorFor(a.avgElu, "elu") }}>
												{a.avgElu.toFixed(2)}
											</span>
										</td>
										<td style={{ padding: 4, textAlign: "right" }}>
											<span style={{ color: colorFor(a.avgDelayP99, "p99") }}>
												{a.avgDelayP99.toFixed(1)}
											</span>
										</td>
										<td style={{ padding: 4, textAlign: "right" }}>
											{a.avgRate.toFixed(2)}
										</td>
										<td style={{ padding: 4, textAlign: "right" }}>
											{a.avgBytesRate.toFixed(0)}
										</td>
										<td style={{ padding: 4, textAlign: "right" }}>
											{a.cpuPerUnit.toFixed(3)}
										</td>
										<td style={{ padding: 4, textAlign: "right" }}>
											{a.bytesPerUnit.toFixed(1)}
										</td>
										<td style={{ padding: 4, textAlign: "right" }}>
											{a.avgBytesPayload.toFixed(0)}
										</td>
										<td style={{ padding: 4, textAlign: "right" }}>
											<span style={{ color: colorFor(a.avgJitterMs, "jitter") }}>
												{a.avgJitterMs.toFixed(1)}
											</span>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</Box>
					{overheadRatio && (
						<Typography variant='body2' sx={{ mt: 1 }}>
							<strong>Overhead ratio (CPU jednostkowe HTTP / WS):</strong>{" "}
							{overheadRatio.toFixed(2)} — wartości &gt; 1 oznaczają wyższy
							koszt Polling.
						</Typography>
					)}
				</Paper>
			)}

			{/* Highlights: największe różnice WS vs HTTP */}
			{aggregates.filter(a => a.mode === "ws").length &&
			aggregates.filter(a => a.mode === "polling").length ? (
				<Paper sx={{ p: 2, mb: 3 }}>
					<Typography variant='subtitle1' gutterBottom>
						Największe różnice (WS vs HTTP)
					</Typography>
					{(() => {
						const ws = aggregates.find(a => a.mode === "ws");
						const http = aggregates.find(a => a.mode === "polling");
						if (!ws || !http) return null;
						const cpuRatio = http.cpuPerUnit / ws.cpuPerUnit;
						const bytesRatio = http.bytesPerUnit / ws.bytesPerUnit;
						const jitterDelta = http.avgJitterMs - ws.avgJitterMs;
						const p99Delta = http.avgDelayP99 - ws.avgDelayP99;
						const freshDelta = http.avgFreshnessMs - ws.avgFreshnessMs;
						return (
							<Box component='ul' sx={{ pl: 3, mb: 0 }}>
								<li>
									<strong>CPU/jednostkę:</strong> HTTP/WS ={" "}
									{cpuRatio.toFixed(2)} (niżej = lepiej dla WS)
								</li>
								<li>
									<strong>Bajty/jednostkę:</strong> HTTP/WS ={" "}
									{bytesRatio.toFixed(2)} (niżej = lepiej dla WS)
								</li>
								<li>
									<strong>Jitter (ms):</strong> Δ HTTP–WS ={" "}
									{jitterDelta.toFixed(1)} (niżej = stabilniej)
								</li>
								<li>
									<strong>Opóźnienie p99 (ms):</strong> Δ HTTP–WS ={" "}
									{p99Delta.toFixed(1)} (niżej = lepiej)
								</li>
								<li>
									<strong>Świeżość danych (ms):</strong> Δ HTTP–WS ={" "}
									{freshDelta.toFixed(0)} (niżej = świeższe)
								</li>
							</Box>
						);
					})()}
				</Paper>
			) : null}

			{firstSelected && (
				<Paper sx={{ p: 2, mb: 3 }}>
					<Stack
						direction='row'
						justifyContent='space-between'
						alignItems='center'
						mb={1}>
						<Typography variant='subtitle1'>
							Próbki (pierwsza wybrana sesja): {firstSelected.config.label}
						</Typography>
						<Stack direction='row' spacing={2}>
							<Button
								size='small'
								href={`${API}/api/monitor/sessions/export/csv`}
								target='_blank'
								rel='noopener noreferrer'>
								Eksport CSV
							</Button>
						</Stack>
					</Stack>
					<Box sx={{ maxHeight: 280, overflow: "auto" }}>
						<table
							style={{
								width: "100%",
								fontSize: 12,
								borderCollapse: "collapse",
							}}>
							<thead>
								<tr>
									<th style={{ textAlign: "left", padding: 4 }}>#</th>
									<th style={{ textAlign: "right", padding: 4 }}>CPU%</th>
									<th style={{ textAlign: "right", padding: 4 }}>RSS</th>
									<th style={{ textAlign: "right", padding: 4 }}>ELU</th>
									<th style={{ textAlign: "right", padding: 4 }}>p99 ms</th>
									<th style={{ textAlign: "right", padding: 4 }}>Rate</th>
									<th style={{ textAlign: "right", padding: 4 }}>B/s</th>
									<th style={{ textAlign: "right", padding: 4 }}>B/payload</th>
									<th style={{ textAlign: "right", padding: 4 }}>Jitter</th>
									<th style={{ textAlign: "right", padding: 4 }}>Fresh ms</th>
								</tr>
							</thead>
							<tbody>
								{(() => {
									const all = firstSelected.samples;
									const slice = all.slice(-200);
									const startIndex = Math.max(0, all.length - slice.length);
									const isHttp = firstSelected.config.mode === "polling";
									return slice.map((m, i) => {
										const rate = isHttp ? m.httpReqRate : m.wsMsgRate;
										const bytes = isHttp ? m.httpBytesRate : m.wsBytesRate;
										const payloadSz = isHttp
											? m.httpAvgBytesPerReq
											: m.wsAvgBytesPerMsg;
										const jitter = isHttp ? m.httpJitterMs : m.wsJitterMs;
										return (
											<tr key={m.ts + i}>
												<td style={{ padding: 2 }}>{startIndex + i + 1}</td>
												<td style={{ padding: 2, textAlign: "right" }}>
													{m.cpu.toFixed(1)}
												</td>
												<td style={{ padding: 2, textAlign: "right" }}>
													{m.rssMB.toFixed(1)}
												</td>
												<td style={{ padding: 2, textAlign: "right" }}>
													{m.elu.toFixed(2)}
												</td>
												<td style={{ padding: 2, textAlign: "right" }}>
													{m.elDelayP99Ms.toFixed(1)}
												</td>
												<td style={{ padding: 2, textAlign: "right" }}>
													{rate.toFixed(2)}
												</td>
												<td style={{ padding: 2, textAlign: "right" }}>
													{bytes.toFixed(0)}
												</td>
												<td style={{ padding: 2, textAlign: "right" }}>
													{payloadSz.toFixed(0)}
												</td>
												<td style={{ padding: 2, textAlign: "right" }}>
													{jitter.toFixed(1)}
												</td>
												<td style={{ padding: 2, textAlign: "right" }}>
													{m.dataFreshnessMs.toFixed(0)}
												</td>
											</tr>
										);
									});
								})()}
							</tbody>
						</table>
					</Box>
				</Paper>
			)}

			{activeSession && (
				<Alert severity='info' sx={{ mb: 2 }}>
					Aktywna sesja: <strong>{activeSession.config.label}</strong> [
					{protoLabel(activeSession)}] — rozpoczęta{" "}
					{new Date(activeSession.startedAt).toLocaleString()}. Nie można
					uruchomić nowej sesji, dopóki ta nie zostanie zakończona.
				</Alert>
			)}

			{haveOverlap && selectedSessions.length > 1 && (
				<Alert severity='warning' sx={{ mb: 2 }}>
					Wybrane sesje nakładają się czasowo. Rekomendacja: testy dla różnych
					metod powinny być wykonywane sekwencyjnie, a następnie porównywane.
					Rozważ ponowne uruchomienie pomiarów.
				</Alert>
			)}

			{/* Control panel */}
			<Paper sx={{ p: 2, mb: 2 }}>
				<Stack spacing={2}>
					<Typography variant='subtitle1'>Nowa sesja</Typography>
					<Stack direction={{ xs: "column", md: "row" }} spacing={2}>
						<TextField
							label='Etykieta'
							value={label}
							onChange={e => setLabel(e.target.value)}
							fullWidth
						/>
						<TextField
							label='Tryb'
							value={mode}
							onChange={e => setMode(e.target.value as any)}
							select
							sx={{ minWidth: 180 }}>
							<MenuItem value='ws'>WebSocket</MenuItem>
							<MenuItem value='polling'>HTTP</MenuItem>
						</TextField>
						<TextField
							label='Interwał pollingu (ms)'
							type='number'
							value={pollMs}
							onChange={e => setPollMs(Number(e.target.value))}
							disabled={mode !== "polling"}
						/>
						<TextField
							label='Liczba próbek'
							type='number'
							value={sampleCount}
							onChange={e => setSampleCount(Number(e.target.value))}
						/>
						<TextField
							label='Czas trwania (s) – opcjonalnie'
							type='number'
							value={durationSec ?? ""}
							onChange={e =>
								setDurationSec(
									e.target.value ? Number(e.target.value) : undefined
								)
							}
						/>
					</Stack>
					<Stack
						direction='row'
						spacing={2}
						alignItems='center'
						flexWrap='wrap'>
						<Button
							variant='contained'
							onClick={start}
							disabled={loading || !!activeSession}
							title={activeSession ? "Najpierw zakończ bieżącą sesję" : ""}>
							Start
						</Button>
						{activeSession && (
							<Button
								color='warning'
								variant='outlined'
								onClick={() => stop(activeSession.id)}
								disabled={loading}>
								Stop
							</Button>
						)}
						<Button
							color='error'
							variant='outlined'
							onClick={resetAll}
							disabled={loading}>
							Resetuj sesje
						</Button>
						<Tooltip title='Eksportuje wszystkie sesje (w tym próbki) do pliku JSON'>
							<span>
								<Button
									variant='outlined'
									onClick={exportSessions}
									disabled={sessions.length === 0}>
									Eksport JSON
								</Button>
							</span>
						</Tooltip>
					</Stack>
				</Stack>
			</Paper>

			<Paper sx={{ p: 2, mb: 3 }}>
				<Typography variant='subtitle1' gutterBottom>
					Założenia metodologiczne i metryki
				</Typography>
				<Typography variant='body2' paragraph>
					Celem eksperymentu jest porównanie efektywności mechanizmu{" "}
					<strong>push (WebSocket)</strong> oraz{" "}
					<strong>pull (HTTP Polling)</strong> dla identycznego strumienia
					danych czujnikowych.
				</Typography>
				<ul style={{ marginTop: 0 }}>
					<li>
						<strong>CPU% / jednostkę</strong> – koszt procesora przypadający na
						pojedynczą dostarczoną wiadomość (niższy = lepiej).
					</li>
					<li>
						<strong>Bajty/s oraz Śr. bajty/payload</strong> – całkowity i
						jednostkowy narzut transmisji (niższy = lepiej).
					</li>
					<li>
						<strong>ELU i opóźnienie p99</strong> – wpływ na responsywność pętli
						zdarzeń (niżej i stabilnie = lepiej).
					</li>
					<li>
						<strong>Jitter inter-arrival</strong> – stabilność odstępów między
						kolejnymi dostawami danych (niższy = bardziej deterministyczne).
					</li>
				</ul>
				<Typography variant='body2'>
					Testy wykonuj sekwencyjnie, z identycznymi parametrami częstotliwości,
					w możliwie izolatowanym środowisku. Następnie porównuj wartości
					agregatów i wskaźniki pochodne (CPU/jedn., B/jedn., jitter).
				</Typography>
			</Paper>

			{/* Sessions list with selection */}
			<Paper sx={{ p: 2, mb: 3 }}>
				<Typography variant='subtitle1' gutterBottom>
					Wybierz sesje do porównania
				</Typography>
				<Box component='ul' sx={{ pl: 2, mb: 0 }}>
					{sessions.map(s => {
						const running = !s.finishedAt;
						const modeLbl = protoLabel(s);
						return (
							<li key={s.id}>
								<FormControlLabel
									control={
										<Checkbox
											checked={selectedIds.has(s.id)}
											onChange={() => toggleSelect(s.id)}
										/>
									}
									label={
										<span>
											<strong>{s.config.label}</strong> [{modeLbl}] —{" "}
											{new Date(s.startedAt).toLocaleString()}
											{running ? " — TRWA" : ` — ${s.samples.length} próbek`}
										</span>
									}
								/>
							</li>
						);
					})}
				</Box>
			</Paper>

			{/* Charts */}
			<Grid container spacing={2}>
				{/* CPU */}
				<Grid size={{ xs: 12, md: 6 }}>
					<Paper sx={{ p: 2 }}>
						<Chart
							options={cpuOptions}
							series={cpuSeries}
							type='line'
							height={260}
						/>
						<Divider sx={{ my: 1 }} />
						<Typography variant='body2'>
							<strong>CPU:</strong> oczekujemy możliwie niskiego i stabilnego
							poziomu. Piki powinny być krótkie. Optymalna metoda zużywa mniej
							CPU przy tej samej częstotliwości danych.
						</Typography>
					</Paper>
				</Grid>

				{/* Memory (RSS + Heap) */}
				<Grid size={{ xs: 12, md: 6 }}>
					<Paper sx={{ p: 2 }}>
						<Chart
							options={memOptions}
							series={memSeries}
							type='line'
							height={260}
						/>
						<Divider sx={{ my: 1 }} />
						<Typography variant='body2'>
							<strong>Pamięć:</strong> RSS i „Heap Used” powinny być stabilne,
							bez trendu wzrostowego. Najlepsza metoda ma niższe, płaskie
							przebiegi.
						</Typography>
					</Paper>
				</Grid>

				{/* ELU */}
				<Grid size={{ xs: 12, md: 6 }}>
					<Paper sx={{ p: 2 }}>
						<Chart
							options={eluOptions}
							series={eluSeries}
							type='line'
							height={260}
						/>
						<Divider sx={{ my: 1 }} />
						<Typography variant='body2'>
							<strong>ELU:</strong> niższa wartość oznacza mniejsze obciążenie
							pętli zdarzeń. Długotrwałe wartości &gt; 0,7 są niepożądane.
							Optymalna metoda utrzymuje ELU możliwie nisko.
						</Typography>
					</Paper>
				</Grid>

				{/* Loop delay p99 — one series per session */}
				<Grid size={{ xs: 12, md: 6 }}>
					<Paper sx={{ p: 2 }}>
						<Chart
							options={loopOptions}
							series={loopP99Series}
							type='line'
							height={260}
						/>
						<Divider sx={{ my: 1 }} />
						<Typography variant='body2'>
							<strong>Opóźnienie p99:</strong> kluczowy wskaźnik responsywności.
							Dążymy do wartości &lt; 20&nbsp;ms i stabilnej linii. Piki
							sugerują blokady CPU, GC lub I/O. Porównując sesje, preferuj
							niższe i stabilniejsze p99.
						</Typography>
					</Paper>
				</Grid>

				{/* Events per second — one series per session, protocol-specific */}
				<Grid size={{ xs: 12, md: 6 }}>
					<Paper sx={{ p: 2 }}>
						<Chart
							options={eventsOptions}
							series={eventsSeries}
							type='line'
							height={260}
						/>
						<Divider sx={{ my: 1 }} />
						<Typography variant='body2'>
							<strong>Zdarzenia/s:</strong> dla WebSocket oczekujemy stabilnego
							„msg/s” odpowiadającego częstotliwości publikacji. Dla HTTP liczba
							„req/s” rośnie wraz z obniżaniem interwału. Optymalna metoda
							zaspokaja wymagania świeżości przy minimalnej liczbie zdarzeń/s.
						</Typography>
					</Paper>
				</Grid>

				{/* Dodatkowe metryki */}
				<Grid container spacing={2} sx={{ mt: 0 }}>
					{/* Avg payload size */}
					<Grid size={{ xs: 12, md: 6 }}>
						<Paper sx={{ p: 2 }}>
							<Chart
								options={payloadSizeOptions}
								series={payloadSizeSeries}
								type='line'
								height={260}
							/>
							<Divider sx={{ my: 1 }} />
							<Typography variant='body2'>
								<strong>Śr. rozmiar payloadu:</strong> ułatwia ocenę narzutu
								protokołu. Wyższy rozmiar przy tej samej semantyce danych
								wskazuje na dodatkowy overhead.
							</Typography>
						</Paper>
					</Grid>
					{/* Jitter */}
					<Grid size={{ xs: 12, md: 6 }}>
						<Paper sx={{ p: 2 }}>
							<Chart
								options={jitterOptions}
								series={jitterSeries}
								type='line'
								height={260}
							/>
							<Divider sx={{ my: 1 }} />
							<Typography variant='body2'>
								<strong>Jitter:</strong> stabilniejsze (niższe) wartości
								oznaczają bardziej przewidywalne dostarczanie danych.
							</Typography>
						</Paper>
					</Grid>
					{/* CPU per unit */}
					<Grid size={{ xs: 12, md: 6 }}>
						<Paper sx={{ p: 2 }}>
							<Chart
								options={cpuPerUnitOptions}
								series={cpuPerUnitSeries}
								type='line'
								height={260}
							/>
							<Divider sx={{ my: 1 }} />
							<Typography variant='body2'>
								<strong>CPU/jednostkę:</strong> niższy koszt per wiadomość =
								lepsza skalowalność.
							</Typography>
						</Paper>
					</Grid>
					{/* Bytes per unit */}
					<Grid size={{ xs: 12, md: 6 }}>
						<Paper sx={{ p: 2 }}>
							<Chart
								options={bytesPerUnitOptions}
								series={bytesPerUnitSeries}
								type='line'
								height={260}
							/>
							<Divider sx={{ my: 1 }} />
							<Typography variant='body2'>
								<strong>Bajty/jednostkę:</strong> niższe wartości wskazują
								mniejszy narzut na dostarczoną porcję danych.
							</Typography>
						</Paper>
					</Grid>
					{/* Bytes per second */}
					<Grid size={{ xs: 12, md: 6 }}>
						<Paper sx={{ p: 2 }}>
							<Chart
								options={bytesOptions}
								series={bytesSeries}
								type='line'
								height={260}
							/>
							<Divider sx={{ my: 1 }} />
							<Typography variant='body2'>
								<strong>Bajty/s:</strong> mniejszy i stabilniejszy przepływ przy
								tej samej jakości danych jest preferowany.
							</Typography>
						</Paper>
					</Grid>
				</Grid>
			</Grid>
		</Box>
	);
}
