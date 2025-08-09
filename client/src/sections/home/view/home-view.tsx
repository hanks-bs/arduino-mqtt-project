"use client";

import type { ArduinoDataPayload } from "@/types";
import {
	useSocketIOEvent,
	useSocketIOStatus,
} from "@/websocket/providers/websocket-provider";
import Stack from "@mui/material/Stack";
import { useEffect, useRef, useState } from "react";
import ChartSection from "../charts-section";
import ConnectionStatus from "../components/connection-status";
import LiveEmitToggle from "../components/live-emit-toggle";
import LiveKpis from "../components/live-kpis";
import ModeSelector from "../components/mode-selector";
import RefreshSettings from "../components/refresh-settings";
import CurrentResults from "../current-results";
import ResearchGuide from "../research-guide";
import ResourceMonitor from "../resource-monitor";
import SessionPanel from "../session-panel";
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
	const socketPayload = useSocketIOEvent<ArduinoDataPayload>("arduinoData");

	// tryb pobierania: 'ws' lub 'polling'
	const [mode, setMode] = useState<"ws" | "polling">("ws");
	// ujednolicony stan danych
	const [payload, setPayload] = useState<ArduinoDataPayload | null>(null);

	// polling
	const [intervalSec, setIntervalSec] = useState(3);
	const [auto, setAuto] = useState(true);
	const pollingRef = useRef<number | null>(null);

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
			const fetchData = async () => {
				try {
					const res = await fetch("http://localhost:5000/api/arduino-data");
					const json = await res.json();
					if (json.success && typeof json.data === "string") {
						setPayload(JSON.parse(json.data));
					}
				} catch (e) {
					console.error("Polling error:", e);
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
		try {
			const res = await fetch("http://localhost:5000/api/arduino-data");
			const json = await res.json();
			if (json.success && typeof json.data === "string") {
				setPayload(JSON.parse(json.data));
			}
		} catch (e) {
			console.error("Manual refresh error:", e);
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
			{payload && <LiveKpis payload={payload} />}
			{payload && <CurrentResults last={payload.lastMeasurement} />}
			{payload ? (
				<ChartSection payload={payload} />
			) : (
				<p>Oczekiwanie na dane…</p>
			)}
			{payload && <ResourceMonitor />}
			<SessionPanel />
		</Stack>
	);
}
