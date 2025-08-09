// components/ChartSection.tsx
"use client";
import type { ArduinoDataPayload } from "@/types";
import { Grid, Paper, Typography } from "@mui/material";
import type { ApexOptions } from "apexcharts";
import dynamic from "next/dynamic";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });
const MAX = 50;

export default function ChartSection({
	payload,
}: {
	payload: ArduinoDataPayload;
}) {
	const { history, lastMeasurement } = payload;

	const tData = [...history, lastMeasurement]
		.map(m => ({
			x: new Date(m.timestamp),
			y: parseFloat(m.temperature.toFixed(2)),
		}))
		.slice(-MAX);
	const pData = [...history, lastMeasurement]
		.map(m => ({
			x: new Date(m.timestamp),
			y: parseFloat(((m.potValue / 1023) * 100).toFixed(2)),
		}))
		.slice(-MAX);

	const lastTemp = tData[tData.length - 1];
	const lastPot = pData[pData.length - 1];

	const baseOptions: ApexOptions = {
		chart: {
			// removed easing, using only supported props
			animations: {
				enabled: true,
				speed: 300, // overall animation speed
				animateGradually: {
					enabled: true,
					delay: 100, // staggered animation delay
				},
				dynamicAnimation: {
					enabled: true,
					speed: 300, // animation speed on data update
				},
			},
			toolbar: { show: true },
			zoom: { enabled: true },
		},
		xaxis: {
			title: { text: "Czas" },
			type: "datetime",
			labels: { datetimeUTC: false },
			tickAmount: 8,
		},
		tooltip: {
			x: {
				formatter: (val: number) =>
					new Date(val).toLocaleString("pl-PL", {
						day: "2-digit",
						month: "2-digit",
						year: "numeric",
						hour: "2-digit",
						minute: "2-digit",
						second: "2-digit",
					}),
			},
		},
		grid: { padding: { left: 5, right: 5 } },
	};

	// Obliczamy dynamiczny zakres Y dla temperatury: max + 20°
	const tempValues = tData.map(point => point.y);
	const highestTemp = Math.max(...tempValues, 0);
	const yMaxTemp = parseFloat((highestTemp + 10).toFixed(0));

	const tempOptions: ApexOptions = {
		...baseOptions,

		yaxis: {
			title: { text: "°C" },
			min: 0,
			max: yMaxTemp,
			labels: { formatter: v => `${v.toFixed(2)}°C` },
		},
		annotations: {
			points: [
				{
					x: lastTemp.x.getTime(),
					y: lastTemp.y,
					marker: {
						size: 8,
						fillColor: "#fff",
						strokeColor: "#1976d2",
					},
					label: {
						borderColor: "#1976d2",

						style: { color: "#1976d2", background: "#fff" },
						text: `${lastTemp.y.toFixed(2)}°C`,
					},
				},
			],
		},
	};

	const potOptions: ApexOptions = {
		...baseOptions,

		yaxis: {
			title: { text: "%" },
			min: 0,
			max: 100,
			labels: { formatter: v => `${v.toFixed(2)}%` },
		},
		markers: { size: 4, hover: { sizeOffset: 2 } },
		annotations: {
			points: [
				{
					x: lastPot.x.getTime(),
					y: lastPot.y,
					marker: {
						size: 8,
						fillColor: "#fff",
						strokeColor: "#a4d219ff",
					},
					label: {
						borderColor: "#1976d2",
						offsetY: -10,
						style: { color: "#19d263ff", background: "#fff" },
						text: `${lastPot.y.toFixed(2)}%`,
					},
				},
			],
		},
	};

	return (
		<Grid container spacing={2}>
			<Grid size={{ xs: 12, md: 6 }}>
				<Paper sx={{ p: 2 }}>
					<Typography variant='h6'>Temperatura (°C)</Typography>
					<Chart
						options={tempOptions}
						series={[{ name: "Temp", data: tData }]}
						type='line'
						height={250}
					/>
				</Paper>
			</Grid>
			<Grid size={{ xs: 12, md: 6 }}>
				<Paper sx={{ p: 2 }}>
					<Typography variant='h6'>Potencjometr (%)</Typography>
					<Chart
						options={potOptions}
						series={[{ name: "Pot", data: pData }]}
						type='line'
						height={250}
					/>
				</Paper>
			</Grid>
		</Grid>
	);
}
