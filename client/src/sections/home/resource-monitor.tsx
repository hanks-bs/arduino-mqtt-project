// frontend/src/resource-monitor.tsx
"use client";

import type { LiveMetrics } from "@/types/monitoring";
import { useSocketIOEvent } from "@/websocket/providers/websocket-provider";
import { Box, Chip, Grid, Paper, Stack } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import type { ApexOptions } from "apexcharts";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

/**
 * ResourceMonitor renders real-time charts using Socket.IO "metrics" stream.
 * It maintains a sliding window of last N samples (default 300 = 5 minutes at 1s).
 */
export default function ResourceMonitor() {
	const metric = useSocketIOEvent<LiveMetrics>("metrics");
	const [series, setSeries] = useState<LiveMetrics[]>([]);
	const windowSize = 300;
	const theme = useTheme();

	useEffect(() => {
		if (!metric) return;
		setSeries(prev => {
			const next = [...prev, metric];
			if (next.length > windowSize) next.shift();
			return next;
		});
	}, [metric]);

	const timestamps = useMemo(() => series.map(s => s.ts), [series]);

	const makeBase = (title: string, yTitle: string): ApexOptions => ({
		chart: {
			toolbar: { show: false },
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

	const rateSeries = [
		{
			name: "HTTP req/s",
			data: series.map(s => Number(s.httpReqRate.toFixed(3))),
		},
		{ name: "WS msg/s", data: series.map(s => Number(s.wsMsgRate.toFixed(3))) },
	];
	const rateOptions = makeBase("Tempo żądań/wiadomości (/s)", "/s");

	const bytesSeries = [
		{
			name: "HTTP B/s",
			data: series.map(s => Number(s.httpBytesRate.toFixed(0))),
		},
		{ name: "WS B/s", data: series.map(s => Number(s.wsBytesRate.toFixed(0))) },
	];
	const bytesOptions = makeBase("Przepływ bajtów (B/s)", "B/s");

	const last = series[series.length - 1];

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

			<Grid container spacing={2}>
				<Grid size={{ xs: 12, md: 6 }}>
					<Paper sx={{ p: 2 }}>
						<Chart
							options={cpuOptions}
							series={cpuSeries}
							type='line'
							height={220}
						/>
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
					</Paper>
				</Grid>

				<Grid size={{ xs: 12, md: 6 }}>
					<Paper sx={{ p: 2 }}>
						<Chart
							options={rateOptions}
							series={rateSeries}
							type='line'
							height={220}
						/>
					</Paper>
				</Grid>
				<Grid size={{ xs: 12, md: 6 }}>
					<Paper sx={{ p: 2 }}>
						<Chart
							options={bytesOptions}
							series={bytesSeries}
							type='line'
							height={220}
						/>
					</Paper>
				</Grid>
			</Grid>
		</Box>
	);
}
