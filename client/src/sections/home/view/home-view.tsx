"use client";

import type { ArduinoDataPayload } from "@/types";
import {
	useSocketIOActivation,
	useSocketIOEvent,
	useSocketIOStatus,
} from "@/websocket/providers/websocket-provider";
import { Paper, Skeleton } from "@mui/material";
import Stack from "@mui/material/Stack";
import { useEffect, useRef, useState } from "react";
import ChartSection from "../charts-section";
import ConnectionStatus from "../components/connection-status";
import LiveEmitToggle from "../components/live-emit-toggle";
import LiveKpis from "../components/live-kpis";
import ModeSelector from "../components/mode-selector";
import RefreshSettings from "../components/refresh-settings";
import ResearchGuide from "../research-guide";
import ResearchRunPanel from "../research-run-panel";
import ResourceMonitor from "../resource-monitor";
import ThesisInfo from "../thesis-info";

/**
 * HomeView aggregates all controls and wykresy.
 */
export function HomeView() {
	const thesisTitle =
		"Aplikacja pomiarowa do zdalnego monitorowania i wizualizacji wybranych wielkości fizycznych w architekturze wielowarstwowej.";
	const thesisAuthor = "Wiktor Poniewierski";
	const thesisSupervisor = "dr inż. Paweł Król";
	const thesisYear = "2024/2025";

	// Socket.IO
	const isSocketConnected = useSocketIOStatus();
	const { setActive: setWsActive } = useSocketIOActivation();
	const socketPayload = useSocketIOEvent<ArduinoDataPayload>("arduinoData");

	// tryb pobierania: 'ws' lub 'polling'
	const [mode, setMode] = useState<"ws" | "polling">("ws");
	// ujednolicony stan danych
	const [payload, setPayload] = useState<ArduinoDataPayload | null>(null);

	// polling
	const [intervalSec, setIntervalSec] = useState(3);
	const [auto, setAuto] = useState(true);
	const pollingRef = useRef<number | null>(null);
	// sygnał do wymuszenia snapshotu metryk (inkrementacja powoduje fetch w ResourceMonitor)
	const [metricsRefreshToken, setMetricsRefreshToken] = useState(0);

	// przełącz aktywność WS zależnie od trybu
	useEffect(() => {
		setWsActive(mode === "ws");
	}, [mode, setWsActive]);

	// aktualizacja payload z WS
	useEffect(() => {
		if (mode === "ws" && socketPayload) {
			setPayload(socketPayload);
		}
	}, [mode, socketPayload]);

	// efekty polling: auto lub ręczne
	useEffect(() => {
		// czyścimy poprzedni timer
		if (pollingRef.current) {
			clearInterval(pollingRef.current);
			pollingRef.current = null;
		}
		if (mode === "polling" && auto) {
			const API_BASE =
				process.env.NEXT_PUBLIC_API_BASE || "http://localhost:5000";
			const fetchData = async () => {
				try {
					const res = await fetch(`${API_BASE}/api/arduino-data`);
					const json = await res.json();
					if (json.success && typeof json.data === "string") {
						setPayload(JSON.parse(json.data));
					}
				} catch (e) {
					console.error("Polling error:", e);
				} finally {
					// po każdej próbie (udanej lub nie) sygnalizuj refresh metryk
					setMetricsRefreshToken(t => t + 1);
				}
			};
			fetchData();
			pollingRef.current = window.setInterval(fetchData, intervalSec * 1000);
		}
		return () => {
			if (pollingRef.current) {
				clearInterval(pollingRef.current);
				pollingRef.current = null;
			}
		};
	}, [mode, auto, intervalSec]);

	// ręczne odświeżenie w trybie manualnym
	const manualRefresh = async () => {
		const API_BASE =
			process.env.NEXT_PUBLIC_API_BASE || "http://localhost:5000";
		try {
			const res = await fetch(`${API_BASE}/api/arduino-data`);
			const json = await res.json();
			if (json.success && typeof json.data === "string") {
				setPayload(JSON.parse(json.data));
			}
		} catch (e) {
			console.error("Manual refresh error:", e);
		} finally {
			// wymuś snapshot metryk (polling)
			setMetricsRefreshToken(t => t + 1);
		}
	};

	return (
		<Stack spacing={2} sx={{ pb: 6 }}>
			{/* [1] Render diploma info before everything else */}
			<ThesisInfo
				title={thesisTitle}
				author={thesisAuthor}
				supervisor={thesisSupervisor}
				year={thesisYear}
			/>
			<ResearchGuide />
			<ConnectionStatus connected={isSocketConnected} />
			<ModeSelector mode={mode} onChange={setMode} />
			<LiveEmitToggle />
			{mode === "polling" && (
				<RefreshSettings
					interval={intervalSec}
					onIntervalChange={setIntervalSec}
					auto={auto}
					onAutoChange={setAuto}
					onManualRefresh={manualRefresh}
				/>
			)}
			{payload?.lastMeasurement && Array.isArray(payload.history) && (
				<LiveKpis payload={payload} />
			)}
			{payload?.lastMeasurement && Array.isArray(payload.history) ? (
				<ChartSection payload={payload} />
			) : (
				<Stack spacing={2}>
					<Paper sx={{ p: 2 }}>
						<Skeleton variant='text' width={180} height={28} />
						<Skeleton variant='rectangular' height={220} />
					</Paper>
					<Paper sx={{ p: 2 }}>
						<Skeleton variant='text' width={220} height={28} />
						<Skeleton variant='rectangular' height={220} />
					</Paper>
				</Stack>
			)}
			{payload && (
				<ResourceMonitor
					mode={mode}
					metricsIntervalSec={intervalSec}
					refreshSignal={metricsRefreshToken}
				/>
			)}
			{/* Panel uruchamiania zautomatyzowanych runów badawczych */}
			<ResearchRunPanel />
		</Stack>
	);
}
