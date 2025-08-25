// frontend/src/resource-monitor.tsx
"use client";

import type { LiveMetrics } from "@/types/monitoring";
import { useSocketIOEvent } from "@/websocket/providers/websocket-provider";
import {
	Box,
	Chip,
	Grid,
	Paper,
	Stack,
	ToggleButton,
	ToggleButtonGroup,
	Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import type { ApexOptions } from "apexcharts";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

/**
 * ResourceMonitor renders real-time charts using Socket.IO "metrics" stream.
 * It maintains a sliding window of last N samples (default 300 = 5 minutes at 1s).
 */
interface Props {
	mode: "ws" | "polling";
	/** Interwał odświeżania metryk w trybie polling (sekundy). Jeśli nie podano używa 5s. */
	metricsIntervalSec?: number;
	/** Zmiana wartości powoduje natychmiastowy snapshot (tylko w trybie polling). */
	refreshSignal?: number;
}

export default function ResourceMonitor({
	mode,
	metricsIntervalSec = 5,
	refreshSignal,
}: Props) {
	const wsMetric = useSocketIOEvent<LiveMetrics>("metrics");
	const [series, setSeries] = useState<LiveMetrics[]>([]);
	const windowSize = 300; // ~5 min przy 1Hz
	const theme = useTheme();
	const pollingRef = useRef<number | null>(null);
	const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:5000";

	// Dopisywanie próbek z WS (tylko gdy tryb ws i istnieje nowa próbka)
	useEffect(() => {
		if (mode !== "ws" || !wsMetric) return;
		setSeries(prev => {
			const next = [...prev, wsMetric];
			if (next.length > windowSize) next.shift();
			return next;
		});
	}, [wsMetric, mode]);

	// Polling snapshotów metryk gdy tryb = polling (fallback bez WS)
	useEffect(() => {
		if (pollingRef.current) {
			clearInterval(pollingRef.current);
			pollingRef.current = null;
		}
		if (mode !== "polling") return;
		const fetchOnce = async () => {
			try {
				const res = await fetch(`${API_BASE}/api/monitor/live`);
				const json = await res.json();
				if (json.success && json.data) {
					const m: LiveMetrics = json.data;
					setSeries(prev => {
						const next = [...prev, m];
						if (next.length > windowSize) next.shift();
						return next;
					});
				}
			} catch {
				// cicho
			}
		};
		fetchOnce();
		pollingRef.current = window.setInterval(
			fetchOnce,
			Math.max(1000, metricsIntervalSec * 1000)
		);
		return () => {
			if (pollingRef.current) {
				clearInterval(pollingRef.current);
				pollingRef.current = null;
			}
		};
	}, [mode, metricsIntervalSec, API_BASE]);

	// Natychmiastowy snapshot metryk gdy refreshSignal się zmienia (tylko polling)
	useEffect(() => {
		if (mode !== "polling") return;
		const fetchOnce = async () => {
			try {
				const res = await fetch(`${API_BASE}/api/monitor/live`);
				const json = await res.json();
				if (json.success && json.data) {
					setSeries(prev => {
						const next = [...prev, json.data as LiveMetrics];
						if (next.length > windowSize) next.shift();
						return next;
					});
				}
			} catch {}
		};
		fetchOnce();
	}, [refreshSignal, mode, API_BASE]);

	const timestamps = useMemo(() => series.map(s => s.ts), [series]);

	const makeBase = (title: string, yTitle: string): ApexOptions => ({
		chart: {
			toolbar: { show: true },
			animations: { enabled: false },
			zoom: { enabled: true },
			group: "resource",
		},
		stroke: { curve: "smooth", width: 2 },
		xaxis: {
			type: "datetime",
			categories: timestamps,
			labels: { datetimeUTC: false },
		},
		tooltip: { shared: true, intersect: false },
		legend: { position: "top" },
		grid: { padding: { left: 10, right: 10, top: 10, bottom: 0 } },
		title: { text: title, align: "center" },
		yaxis: { title: { text: yTitle } },
	});

	const cpuSeries = [
		{ name: "CPU %", data: series.map(s => Number(s.cpu.toFixed(2))) },
	];
	const cpuOptions = {
		...makeBase("Zużycie CPU (%)", "%"),
		yaxis: { title: { text: "%" } },
	};

	const memSeries = [
		{ name: "RSS MB", data: series.map(s => Number(s.rssMB.toFixed(2))) },
		{
			name: "Heap Used MB",
			data: series.map(s => Number(s.heapUsedMB.toFixed(2))),
		},
	];
	const memOptions = {
		...makeBase("Pamięć (MB)", "MB"),
		colors: [theme.palette.info.main, theme.palette.info.light],
		stroke: { curve: "smooth", width: 2, dashArray: [0, 5] },
	} as ApexOptions;

	const eluSeries = [
		{ name: "ELU (0..1)", data: series.map(s => Number(s.elu.toFixed(4))) },
	];
	const eluOptions = {
		...makeBase("Event Loop Utilization", "ELU"),
		yaxis: { title: { text: "ELU" } },
	};

	const loopDelaySeries = [
		{
			name: "p50 (ms)",
			data: series.map(s => Number(s.elDelayP50Ms.toFixed(3))),
		},
		{
			name: "p99 (ms)",
			data: series.map(s => Number(s.elDelayP99Ms.toFixed(3))),
		},
		{
			name: "max (ms)",
			data: series.map(s => Number(s.elDelayMaxMs.toFixed(3))),
		},
	];
	const loopDelayOptions = {
		...makeBase("Opóźnienie pętli zdarzeń (ms)", "ms"),
		colors: [
			theme.palette.success.main, // p50
			theme.palette.warning.main, // p99
			theme.palette.error.main, // max
		],
		stroke: { curve: "smooth", width: 2, dashArray: [0, 5, 2] },
	} as ApexOptions;

	// ------------------ PORÓWNAWCZE SERIE (fair compare) ------------------
	// 1. Tempo: ws/ http + delta % i ratio
	const httpRateArr = series.map(s => s.httpReqRate);
	const wsRateArr = series.map(s => s.wsMsgRate);
	const rateDeltaPct = httpRateArr.map((v, i) => {
		const h = v;
		const w = wsRateArr[i];
		if (!Number.isFinite(h) || h === 0) return null;
		return Number((((w - h) / h) * 100).toFixed(2));
	});
	const tempoSeries = [
		{ name: "HTTP req/s", data: httpRateArr.map(v => Number(v.toFixed(3))) },
		{ name: "WS msg/s", data: wsRateArr.map(v => Number(v.toFixed(3))) },
		{ name: "Δ% (WS vs HTTP)", data: rateDeltaPct, type: "line" as const },
	];
	const tempoOptions: ApexOptions = {
		...makeBase("Tempo + Δ%", "/s"),
		yaxis: [
			{ title: { text: "req/s, msg/s" } },
			{ opposite: true, title: { text: "Δ%" } },
		],
		stroke: { width: [2, 2, 1], dashArray: [0, 0, 4] },
		tooltip: { shared: true },
	};

	// 2. Koszt sieci: total bytes/s + średni payload + delta kosztu %
	const httpBytesArr = series.map(s => s.httpBytesRate);
	const wsBytesArr = series.map(s => s.wsBytesRate);
	const bytesDeltaPct = httpBytesArr.map((v, i) => {
		const h = v;
		const w = wsBytesArr[i];
		if (!Number.isFinite(h) || h === 0) return null;
		return Number((((w - h) / h) * 100).toFixed(2));
	});
	const kosztSeries = [
		{
			name: "HTTP B/s (total)",
			data: httpBytesArr.map(v => Number(v.toFixed(0))),
		},
		{ name: "WS B/s (total)", data: wsBytesArr.map(v => Number(v.toFixed(0))) },
		{
			name: "HTTP avg B/req",
			data: series.map(s => Number(s.httpAvgBytesPerReq.toFixed(2))),
		},
		{
			name: "WS avg B/msg",
			data: series.map(s => Number(s.wsAvgBytesPerMsg.toFixed(2))),
		},
		{ name: "Δ% total B/s", data: bytesDeltaPct },
	];
	const kosztOptions: ApexOptions = {
		...makeBase("Koszt sieci i payload", "B/s"),
		yaxis: [
			{ title: { text: "B/s (total)" } },
			{ opposite: true, title: { text: "Avg B" } },
		],
		stroke: { width: [2, 2, 1, 1, 1], dashArray: [0, 0, 4, 4, 6] },
		tooltip: { shared: true },
	};

	// 3. Stabilność i świeżość: jitter & freshness + różnica jitter (WS-HTTP)
	const jitterDiff = series.map(s =>
		Number((s.wsJitterMs - s.httpJitterMs).toFixed(2))
	);
	const stabilitySeries = [
		{
			name: "HTTP jitter ms",
			data: series.map(s => Number(s.httpJitterMs.toFixed(2))),
		},
		{
			name: "WS jitter ms",
			data: series.map(s => Number(s.wsJitterMs.toFixed(2))),
		},
		{
			name: "Freshness ms",
			data: series.map(s => Number(s.dataFreshnessMs.toFixed(0))),
		},
		{ name: "Δ jitter (WS-HTTP)", data: jitterDiff },
	];
	const stabilityOptions: ApexOptions = {
		...makeBase("Jitter & Freshness + Δ", "ms"),
		stroke: { width: [2, 2, 2, 1], dashArray: [0, 0, 5, 4] },
		colors: [
			theme.palette.warning.main,
			theme.palette.info.main,
			theme.palette.success.main,
			theme.palette.error.main,
		],
		tooltip: { shared: true },
	};

	const last = series[series.length - 1];

	const [view, setView] = useState<"compare" | "system">("compare");

	return (
		<Box>
			<Stack direction='row' spacing={1} sx={{ mb: 1, flexWrap: "wrap" }}>
				<Chip label={`WS clients: ${last?.wsClients ?? 0}`} />
				<Chip label={`HTTP total: ${last?.totalHttpRequests ?? 0}`} />
				<Chip label={`WS total: ${last?.totalWsMessages ?? 0}`} />
				<Chip
					label={`HTTP bytes: ${last ? Math.round(last.totalHttpBytes) : 0}`}
				/>
				<Chip label={`WS bytes: ${last ? Math.round(last.totalWsBytes) : 0}`} />
				<Chip label={`LoadAvg1: ${last ? last.loadAvg1.toFixed(2) : "0.00"}`} />
				<Chip label={`Uptime: ${last ? Math.round(last.uptimeSec) : 0}s`} />
			</Stack>

			<Stack direction='row' spacing={2} sx={{ mb: 2 }}>
				<ToggleButtonGroup
					value={view}
					exclusive
					onChange={(_, v) => v && setView(v)}
					size='small'>
					<ToggleButton value='compare'>Porównanie protokołów</ToggleButton>
					<ToggleButton value='system'>Parametry systemowe</ToggleButton>
				</ToggleButtonGroup>
				{view === "compare" && (
					<Typography
						variant='caption'
						color='text.secondary'
						sx={{ alignSelf: "center" }}>
						Porównania liczą WS per komunikat (bez mnożenia przez klientów) dla
						tempa oraz per klient dla kosztu sieci.
					</Typography>
				)}
			</Stack>
			{view === "system" && (
				<Grid container spacing={2}>
					<Grid size={{ xs: 12, md: 6 }}>
						<Paper sx={{ p: 2 }}>
							<Chart
								options={cpuOptions}
								series={cpuSeries}
								type='line'
								height={220}
							/>
							<Box sx={{ mt: 1, fontSize: 12, color: "text.secondary" }}>
								CPU (%) procesu. Stabilnie niżej = większy zapas. Skoki
								oznaczają intensywne prace GC lub I/O.
							</Box>
						</Paper>
					</Grid>
					<Grid size={{ xs: 12, md: 6 }}>
						<Paper sx={{ p: 2 }}>
							<Chart
								options={memOptions}
								series={memSeries}
								type='line'
								height={220}
							/>
							<Box sx={{ mt: 1, fontSize: 12, color: "text.secondary" }}>
								Pamięć. Rosnący trend RSS/Heap Used może wskazywać na wycieki
								lub większe bufory.
							</Box>
						</Paper>
					</Grid>
					<Grid size={{ xs: 12, md: 6 }}>
						<Paper sx={{ p: 2 }}>
							<Chart
								options={eluOptions}
								series={eluSeries}
								type='line'
								height={220}
							/>
							<Box sx={{ mt: 1, fontSize: 12, color: "text.secondary" }}>
								ELU – wykorzystanie pętli zdarzeń. Blisko 1 = ryzyko opóźnień.
							</Box>
						</Paper>
					</Grid>
					<Grid size={{ xs: 12, md: 6 }}>
						<Paper sx={{ p: 2 }}>
							<Chart
								options={loopDelayOptions}
								series={loopDelaySeries}
								type='line'
								height={220}
							/>
							<Box sx={{ mt: 1, fontSize: 12, color: "text.secondary" }}>
								Opóźnienie pętli (p50/p99/max). Niżej = płynniejsze
								przetwarzanie.
							</Box>
						</Paper>
					</Grid>
				</Grid>
			)}
			{view === "compare" && (
				<Grid container spacing={2}>
					<Grid size={{ xs: 12, md: 6 }}>
						<Paper sx={{ p: 2 }}>
							<Chart
								options={cpuOptions}
								series={cpuSeries}
								type='line'
								height={220}
							/>
							<Box sx={{ mt: 1, fontSize: 12, color: "text.secondary" }}>
								CPU (% procesu). Niżej = mniejsze zużycie przy danym obciążeniu
								(więcej zapasu). Wysokie i rosnące wartości mogą ograniczyć
								skalowalność.
							</Box>
						</Paper>
					</Grid>
					<Grid size={{ xs: 12, md: 6 }}>
						<Paper sx={{ p: 2 }}>
							<Chart
								options={memOptions}
								series={memSeries}
								type='line'
								height={220}
							/>
							<Box sx={{ mt: 1, fontSize: 12, color: "text.secondary" }}>
								Pamięć (RSS + Heap Used). Stabilnie i niżej = lepiej.
								Skok/pełzanie w górę może sugerować wycieki lub presję GC.
							</Box>
						</Paper>
					</Grid>

					<Grid size={{ xs: 12, md: 6 }}>
						<Paper sx={{ p: 2 }}>
							<Chart
								options={eluOptions}
								series={eluSeries}
								type='line'
								height={220}
							/>
							<Box sx={{ mt: 1, fontSize: 12, color: "text.secondary" }}>
								ELU (Event Loop Utilization 0..1). Wyżej =&gt; bardziej zajęta
								pętla. Ciągłe wartości blisko 1 grożą rosnącym opóźnieniem
								reakcji.
							</Box>
						</Paper>
					</Grid>
					<Grid size={{ xs: 12, md: 6 }}>
						<Paper sx={{ p: 2 }}>
							<Chart
								options={loopDelayOptions}
								series={loopDelaySeries}
								type='line'
								height={220}
							/>
							<Box sx={{ mt: 1, fontSize: 12, color: "text.secondary" }}>
								Opóźnienie pętli zdarzeń (p50/p99/max). Niżej = mniejsze lagi
								aplikacji. Szczyty max to pojedyncze zacięcia.
							</Box>
						</Paper>
					</Grid>

					<Grid size={{ xs: 12, md: 6 }}>
						<Paper sx={{ p: 2 }}>
							<Chart
								options={tempoOptions}
								series={tempoSeries}
								type='line'
								height={260}
							/>
							<Box sx={{ mt: 1, fontSize: 12, color: "text.secondary" }}>
								Tempo zdarzeń: HTTP req/s (odpowiedzi), WS msg/s (komunikaty).
								Δ% = różnica względna (WS-HTTP)/HTTP. Wyżej = większa
								przepustowość. Fair: WS liczymy per komunikat (nie mnożymy przez
								klientów), by uniknąć sztucznego wzrostu przy broadcast.
							</Box>
						</Paper>
					</Grid>
					<Grid size={{ xs: 12, md: 6 }}>
						<Paper sx={{ p: 2 }}>
							<Chart
								options={kosztOptions}
								series={kosztSeries}
								type='line'
								height={260}
							/>
							<Box sx={{ mt: 1, fontSize: 12, color: "text.secondary" }}>
								Koszt sieci: total B/s = sumaryczne bajty (dla WS mnożone przez
								liczbę klientów – realny egress). Avg B/* = średni rozmiar
								ładunku (bez mnożenia). Δ% pokazuje względną różnicę kosztu.
								Niżej total B/s przy podobnym tempie = bardziej efektywne.
							</Box>
						</Paper>
					</Grid>
					<Grid size={{ xs: 12, md: 6 }}>
						<Paper sx={{ p: 2 }}>
							<Chart
								options={stabilityOptions}
								series={stabilitySeries}
								type='line'
								height={260}
							/>
							<Box sx={{ mt: 1, fontSize: 12, color: "text.secondary" }}>
								Stabilność i świeżość: jitter = zmienność interwałów
								(niżej=stabilniej), freshness = wiek danych (niżej=aktualniej).
								Δ jitter dodatni oznacza większą zmienność WS vs HTTP. Niższe
								jitter+freshness = szybsza reakcja systemu.
							</Box>
						</Paper>
					</Grid>
				</Grid>
			)}
		</Box>
	);
}
