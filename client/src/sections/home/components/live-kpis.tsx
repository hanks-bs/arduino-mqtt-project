"use client";

import type { ArduinoDataPayload } from "@/types";
import {
	Box,
	Card,
	CardContent,
	Chip,
	Divider,
	Grid,
	LinearProgress,
	Stack,
	Tooltip,
	Typography,
} from "@mui/material";
import dynamic from "next/dynamic";
import { useMemo } from "react";
import type { ApexOptions } from "apexcharts";

// Lekki sparkline (mini-wykres trendu) – ładowany dynamicznie (SSR off)
const Sparkline = dynamic(() => import("react-apexcharts"), { ssr: false });

interface LiveKpisProps {
	payload: ArduinoDataPayload;
}

// formatDelta usunięty (nieużywany po redesignie)

export default function LiveKpis({ payload }: LiveKpisProps) {
	const history = useMemo(
		() => (Array.isArray(payload?.history) ? payload.history : []),
		[payload?.history]
	);
	const { last, prev } = useMemo(() => {
		const lastCandidate =
			payload?.lastMeasurement ?? (history.length ? history.at(-1) : undefined);
		const safeLast =
			lastCandidate ??
			{
				potValue: 0,
				voltagePot: 0,
				lm35Value: 0,
				voltageLM35: 0,
				temperature: 0,
				readingTime: 0,
				uptimeSec: 0,
				readingCount: 0,
				timestamp: new Date().toISOString(),
			};
		return { last: safeLast, prev: history.length >= 2 ? history.at(-2) : undefined };
	}, [payload, history]);

	// Wartości podstawowe
	const temp = last.temperature ?? 0;
	const prevTemp = prev?.temperature;
	const potPct = (last.potValue / 1023) * 100;
	const prevPotPct = prev ? (prev.potValue / 1023) * 100 : undefined;

	// Trendy (ostatnie N próbek – domyślnie 40 lub cała historia jeśli krótsza)
	const WINDOW = 40;
	const tempSeries = useMemo(
		() =>
			history
				.slice(-WINDOW)
				.map(m => ({ x: new Date(m.timestamp).getTime(), y: m.temperature })),
		[history]
	);
	const potSeries = useMemo(
		() =>
			history.slice(-WINDOW).map(m => ({
				x: new Date(m.timestamp).getTime(),
				y: Number(((m.potValue / 1023) * 100).toFixed(2)),
			})),
		[history]
	);

	// Kolorystyka: temperatura dynamiczna, pot stały
	const tempColor =
		temp < 15
			? "#1976d2"
			: temp < 25
			? "#2e7d32"
			: temp < 30
			? "#ed6c02"
			: "#d32f2f";

	const sparkBase = (color: string, unit: string): ApexOptions => ({
		chart: {
			id: `spark-${unit}-${color}`,
			animations: { enabled: false },
			sparkline: { enabled: true },
			toolbar: { show: false },
		},
		stroke: { curve: "straight", width: 2 },
		colors: [color],
		xaxis: { type: "datetime" },
		yaxis: { labels: { show: false } },
		tooltip: {
			followCursor: false,
			y: {
				formatter: (v: number) => `${v.toFixed(2)}${unit}`,
			},
			x: { formatter: (val: number) => new Date(val).toLocaleTimeString() },
		},
	});

	const tempSparkOptions = sparkBase(tempColor, "°C");
	const potSparkOptions = sparkBase("#5e35b1", "%");

	function DeltaChip({
		value,
		prev,
		unit,
		precision = 2,
		pp = false,
	}: {
		value: number;
		prev: number | undefined;
		unit: string;
		precision?: number;
		pp?: boolean; // unit is percentage points
	}) {
		if (prev === undefined) return <Chip size='small' label='—' />;
		const diff = value - prev;
		const sign = diff > 0 ? "+" : diff < 0 ? "" : "";
		const color: "success" | "error" | undefined =
			diff > 0 ? "success" : diff < 0 ? "error" : undefined;
		return (
			<Chip
				size='small'
				color={color}
				variant={color ? "filled" : "outlined"}
				label={`${sign}${diff.toFixed(precision)}${pp ? " pp" : unit}`}
			/>
		);
	}

	return (
		<Box>
			<Typography variant='h6' gutterBottom>
				Aktualne wyniki
			</Typography>
			<Grid container spacing={2}>
				{/* TEMPERATURA */}
				<Grid size={{ xs: 12, md: 6, lg: 3 }}>
					<Card elevation={2} sx={{ height: "100%" }}>
						<CardContent sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
							<Typography variant='subtitle2' color='text.secondary'>Temperatura</Typography>
							<Stack direction='row' alignItems='baseline' spacing={1}>
								<Typography variant='h4' sx={{ color: tempColor }}>
									{temp.toFixed(2)}
								</Typography>
								<Typography variant='caption'>°C</Typography>
								<DeltaChip value={temp} prev={prevTemp} unit='°C' />
							</Stack>
							<Box sx={{ mt: 0.5 }}>
								<LinearProgress
									variant='determinate'
									value={Math.min(100, (temp / 50) * 100)}
									sx={{ height: 5, borderRadius: 2, [`& .MuiLinearProgress-bar`]: { backgroundColor: tempColor } }}
								/>
							</Box>
							{/* sparkline */}
							{tempSeries.length >= 2 && (
								<Box sx={{ mt: 0.5 }}>
									<Sparkline
										type='line'
										height={60}
										series={[{ name: "Temp", data: tempSeries }]}
										options={tempSparkOptions}
									/>
								</Box>
							)}
							<Typography variant='caption' color='text.secondary'>Ostatnie {Math.min(WINDOW, history.length)} próbek • trend</Typography>
						</CardContent>
					</Card>
				</Grid>
				{/* POTENCJOMETR */}
				<Grid size={{ xs: 12, md: 6, lg: 3 }}>
					<Card elevation={2} sx={{ height: "100%" }}>
						<CardContent sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
							<Typography variant='subtitle2' color='text.secondary'>Potencjometr</Typography>
							<Stack direction='row' alignItems='baseline' spacing={1}>
								<Typography variant='h4'>{potPct.toFixed(2)}</Typography>
								<Typography variant='caption'>%</Typography>
								<DeltaChip value={potPct} prev={prevPotPct} unit='%' pp />
							</Stack>
							<Box sx={{ mt: 0.5 }}>
								<LinearProgress
									variant='determinate'
									value={potPct}
									sx={{ height: 5, borderRadius: 2 }}
								/>
							</Box>
							{potSeries.length >= 2 && (
								<Box sx={{ mt: 0.5 }}>
									<Sparkline
										type='line'
										height={60}
										series={[{ name: "Pot%", data: potSeries }]}
										options={potSparkOptions}
									/>
								</Box>
							)}
							<Typography variant='caption' color='text.secondary'>Przedział 0–100% • trend</Typography>
						</CardContent>
					</Card>
				</Grid>
				{/* UPTIME + READINGS */}
				<Grid size={{ xs: 12, md: 6, lg: 3 }}>
					<Card elevation={2} sx={{ height: "100%" }}>
						<CardContent sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
							<Typography variant='subtitle2' color='text.secondary'>Czas pracy</Typography>
							<Stack direction='row' spacing={1} alignItems='baseline'>
								<Typography variant='h4'>{last.uptimeSec ?? 0}</Typography>
								<Typography variant='caption'>s</Typography>
							</Stack>
							<Typography variant='caption' color='text.secondary'>Odczyty: {last.readingCount}</Typography>
							<Divider flexItem sx={{ my: 0.5 }} />
							{(() => {
								// Instant tRead = różnica readingTime między ostatnimi dwoma próbkami (ms)
								const instant = prev && last.readingTime != null && prev.readingTime != null ? last.readingTime - prev.readingTime : undefined;
								// Średnia całkowita (fallback) = readingTime / readingCount
								const avg = last.readingTime != null && last.readingCount > 0 ? last.readingTime / last.readingCount : undefined;
								// Wybór wartości: preferujemy instant jeśli sensowny ( >0 i < 10×avg )
								let val = instant && instant > 0 ? instant : avg;
								if (instant && avg && instant > avg * 10) {
									// skrajny outlier – użyj średniej
									val = avg;
								}
								return (
									<Tooltip
										title={
											instant && avg
												? `Instant: ${instant.toFixed(1)} ms | Avg: ${avg?.toFixed(1)} ms`
											: "Szacowany czas pojedynczego odczytu (ms)"
										}>
										<Chip
											size='small'
											variant='outlined'
											label={`tRead ~${val ? val.toFixed(1) : '—'} ms`}
										/>
									</Tooltip>
								);
							})()}
						</CardContent>
					</Card>
				</Grid>
				{/* TIMESTAMP */}
				<Grid size={{ xs: 12, md: 6, lg: 3 }}>
					<Card elevation={2} sx={{ height: "100%" }}>
						<CardContent sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
							<Typography variant='subtitle2' color='text.secondary'>Znacznik czasu</Typography>
							<Typography variant='body2'>
								{new Date(last.timestamp ?? Date.now()).toLocaleTimeString()}
							</Typography>
							<Typography variant='caption' color='text.secondary'>ISO: {typeof last.timestamp === "string" ? last.timestamp.split("T")[1]?.replace("Z", "") : "—"}</Typography>
						</CardContent>
					</Card>
				</Grid>
			</Grid>
		</Box>
	);
}
