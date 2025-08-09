"use client";

import type { ArduinoDataPayload } from "@/types";
import {
	Box,
	Card,
	CardContent,
	Grid,
	LinearProgress,
	Typography,
} from "@mui/material";
import { useMemo } from "react";

interface LiveKpisProps {
	payload: ArduinoDataPayload;
}

function formatDelta(curr: number, prev: number | undefined, decimals = 2) {
	if (prev === undefined) return "—";
	const diff = curr - prev;
	if (Math.abs(diff) < 10 ** -(decimals + 1)) return "0";
	const sign = diff > 0 ? "+" : "";
	return `${sign}${diff.toFixed(decimals)}`;
}

export default function LiveKpis({ payload }: LiveKpisProps) {
	const { last, prev } = useMemo(() => {
		const history = Array.isArray(payload?.history) ? payload.history : [];
		const lastCandidate =
			payload?.lastMeasurement ??
			(history.length ? history[history.length - 1] : undefined);
		const safeLast = lastCandidate ?? {
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
		const prev = history.length >= 2 ? history[history.length - 2] : undefined;
		return { last: safeLast, prev };
	}, [payload]);

	const potPct = useMemo(
		() => (last ? (last.potValue / 1023) * 100 : 0),
		[last]
	);
	const prevPotPct = prev ? (prev.potValue / 1023) * 100 : undefined;
	const temp = last?.temperature ?? 0;
	const prevTemp = prev?.temperature;

	// Kolor temperatury (prosty gradient)
	const tempColor =
		temp < 15
			? "#1976d2"
			: temp < 25
			? "#2e7d32"
			: temp < 30
			? "#ed6c02"
			: "#d32f2f";

	return (
		<Grid container spacing={2} sx={{ mt: 1 }}>
			{/* Temperature KPI */}
			<Grid size={{ xs: 12, sm: 6, md: 3 }}>
				<Card sx={{ height: "100%" }}>
					<CardContent>
						<Typography variant='subtitle2' color='text.secondary'>
							Temperatura (°C)
						</Typography>
						<Typography variant='h4' sx={{ color: tempColor }}>
							{temp.toFixed(2)}
						</Typography>
						<Typography variant='caption' color='text.secondary'>
							Δ {formatDelta(temp, prevTemp, 2)}°C od poprzedniego
						</Typography>
						<Box sx={{ mt: 1 }}>
							<LinearProgress
								variant='determinate'
								value={Math.min(100, (temp / 50) * 100)}
								sx={{
									height: 6,
									borderRadius: 3,
									[`& .MuiLinearProgress-bar`]: { backgroundColor: tempColor },
								}}
							/>
						</Box>
					</CardContent>
				</Card>
			</Grid>
			{/* Potentiometer KPI */}
			<Grid size={{ xs: 12, sm: 6, md: 3 }}>
				<Card sx={{ height: "100%" }}>
					<CardContent>
						<Typography variant='subtitle2' color='text.secondary'>
							Potencjometr (%)
						</Typography>
						<Typography variant='h4'>{potPct.toFixed(2)}%</Typography>
						<Typography variant='caption' color='text.secondary'>
							Δ {formatDelta(potPct, prevPotPct, 2)} pp
						</Typography>
						<Box sx={{ mt: 1 }}>
							<LinearProgress
								variant='determinate'
								value={potPct}
								sx={{ height: 6, borderRadius: 3 }}
							/>
						</Box>
					</CardContent>
				</Card>
			</Grid>
			{/* Uptime */}
			<Grid size={{ xs: 12, sm: 6, md: 3 }}>
				<Card sx={{ height: "100%" }}>
					<CardContent>
						<Typography variant='subtitle2' color='text.secondary'>
							Czas pracy (s)
						</Typography>
						<Typography variant='h4'>{last.uptimeSec ?? 0}</Typography>
						<Typography variant='caption' color='text.secondary'>
							Liczba odczytów: {last.readingCount}
						</Typography>
					</CardContent>
				</Card>
			</Grid>
			{/* Timestamp */}
			<Grid size={{ xs: 12, sm: 6, md: 3 }}>
				<Card sx={{ height: "100%" }}>
					<CardContent>
						<Typography variant='subtitle2' color='text.secondary'>
							Znacznik czasu
						</Typography>
						<Typography variant='body2'>
							{new Date(last.timestamp ?? Date.now()).toLocaleTimeString()}
						</Typography>
						<Typography variant='caption' color='text.secondary'>
							ISO:{" "}
							{typeof last.timestamp === "string"
								? last.timestamp.split("T")[1]?.replace("Z", "")
								: "—"}
						</Typography>
					</CardContent>
				</Card>
			</Grid>
		</Grid>
	);
}
