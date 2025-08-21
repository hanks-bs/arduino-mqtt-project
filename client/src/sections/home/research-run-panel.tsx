"use client";
import ResearchRunResults from "@/sections/home/research-run-results";
import {
	ResearchPresetDescriptor,
	ResearchRunRequest,
	ResearchRunStatus,
} from "@/types";
import {
	Alert,
	Box,
	Button,
	Card,
	CardContent,
	CardHeader,
	Chip,
	Collapse,
	Divider,
	FormControl,
	FormControlLabel,
	Grid,
	IconButton,
	InputLabel,
	LinearProgress,
	MenuItem,
	Select,
	Stack,
	Switch,
	TextField,
	Tooltip,
	Typography,
} from "@mui/material";
import { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:5000";

// Presety (rozszerzone – odwzorowanie większości z researchCli.ts)
const PRESETS: ResearchPresetDescriptor[] = [
	{
		key: "sanity",
		label: "Sanity 12s",
		description: "12s, 1Hz, pair, szybka kontrola działania",
		config: {
			modes: ["ws", "polling"],
			hzSet: [1],
			loadSet: [0],
			durationSec: 12,
			tickMs: 200,
			warmupSec: 1,
			cooldownSec: 1,
			clientsHttp: 1,
			clientsWs: 1,
			pair: true,
		},
	},
	{
		key: "stable",
		label: "Stable 20s ×2",
		description: "20s×2, 1Hz baseline stabilizacyjny",
		config: {
			modes: ["ws", "polling"],
			hzSet: [1],
			loadSet: [0],
			durationSec: 20,
			tickMs: 200,
			warmupSec: 2,
			cooldownSec: 2,
			clientsHttp: 1,
			clientsWs: 1,
			repeats: 2,
			pair: true,
			cpuSampleMs: 1000,
		},
	},
	{
		key: "stable60",
		label: "Stable60 60s ×2",
		description: "60s×2, 1Hz baseline (ciasne CI)",
		config: {
			modes: ["ws", "polling"],
			hzSet: [1],
			loadSet: [0],
			durationSec: 60,
			tickMs: 200,
			warmupSec: 4,
			cooldownSec: 4,
			clientsHttp: 1,
			clientsWs: 1,
			repeats: 2,
			pair: true,
			cpuSampleMs: 1000,
		},
	},
	{
		key: "baseline",
		label: "Baseline (1Hz, 40s×2)",
		description:
			"40s sesja @1Hz, load=0, repeats=2 – stabilny punkt odniesienia",
		config: {
			modes: ["ws", "polling"],
			hzSet: [1],
			loadSet: [0],
			durationSec: 40,
			tickMs: 200,
			warmupSec: 4,
			cooldownSec: 4,
			clientsHttp: 1,
			clientsWs: 1,
			repeats: 2,
			pair: true,
			cpuSampleMs: 500,
		},
	},
	{
		key: "quick",
		label: "Quick podgląd (4s 1–2Hz)",
		description: "Szybki test poprawności: 4s, Hz=1,2, load=0",
		config: {
			modes: ["ws", "polling"],
			hzSet: [1, 2],
			loadSet: [0],
			durationSec: 4,
			tickMs: 200,
			// krótkie fazy nagrzewania/chłodzenia – dopuszczamy ułamki sekund
			warmupSec: 0.5,
			cooldownSec: 0.5,
			pair: true,
		},
	},
	{
		key: "safe",
		label: "Niskie Hz (4s 0.5–1Hz)",
		description: "4s, 0.5–1Hz, tick=500ms – bardzo lekkie obciążenie",
		config: {
			modes: ["ws", "polling"],
			hzSet: [0.5, 1],
			loadSet: [0],
			durationSec: 4,
			tickMs: 500,
			clientsHttp: 1,
			clientsWs: 1,
			warmupSec: 0.5,
			cooldownSec: 0.5,
			pair: true,
		},
	},
	{
		key: "viz",
		label: "Wizualizacja (30s×2, klienci)",
		description:
			"30s×2 @1Hz; load 0,50; klienci 1,10,25,50 – zróżnicowanie klientów",
		config: {
			modes: ["ws", "polling"],
			hzSet: [1],
			loadSet: [0, 50],
			durationSec: 30,
			tickMs: 200,
			warmupSec: 2,
			cooldownSec: 2,
			clientsHttpSet: [1, 10, 25, 50],
			clientsWsSet: [1, 10, 25, 50],
			repeats: 2,
			pair: true,
			cpuSampleMs: 1000,
		},
	},
	{
		key: "robust",
		label: "Robust (60s×2, Hz+Load)",
		description:
			"60s×2; Hz=0.5,1,2; load=0,25,50 – test stabilności przy różnych obciążeniach",
		config: {
			modes: ["ws", "polling"],
			hzSet: [0.5, 1, 2],
			loadSet: [0, 25, 50],
			durationSec: 60,
			tickMs: 200,
			warmupSec: 4,
			cooldownSec: 4,
			repeats: 2,
			pair: true,
			cpuSampleMs: 1000,
		},
	},
	{
		key: "clients",
		label: "Skalowanie klientów (60s×2)",
		description: "60s×2 @1Hz; load=0,25; klienci 1,10,25,50",
		config: {
			modes: ["ws", "polling"],
			hzSet: [1],
			loadSet: [0, 25],
			durationSec: 60,
			tickMs: 200,
			warmupSec: 4,
			cooldownSec: 4,
			clientsHttpSet: [1, 10, 25, 50],
			clientsWsSet: [1, 10, 25, 50],
			repeats: 2,
			pair: true,
			cpuSampleMs: 1000,
		},
	},
	{
		key: "freq",
		label: "Częstotliwości (30s×2)",
		description: "30s×2; Hz=0.5,1,2,4; load=0; klienci 1,10",
		config: {
			modes: ["ws", "polling"],
			hzSet: [0.5, 1, 2, 4],
			loadSet: [0],
			durationSec: 30,
			tickMs: 200,
			warmupSec: 2,
			cooldownSec: 2,
			clientsHttpSet: [1, 10],
			clientsWsSet: [1, 10],
			repeats: 2,
			pair: true,
			cpuSampleMs: 1000,
		},
	},
	{
		key: "highhz",
		label: "Wyższe Hz (45s×2)",
		description: "45s×2; Hz=2,4,8; load=0,25; klienci 1,10",
		config: {
			modes: ["ws", "polling"],
			hzSet: [2, 4, 8],
			loadSet: [0, 25],
			durationSec: 45,
			tickMs: 200,
			warmupSec: 3,
			cooldownSec: 3,
			clientsHttpSet: [1, 10],
			clientsWsSet: [1, 10],
			repeats: 2,
			pair: true,
			cpuSampleMs: 750,
		},
	},
	{
		key: "compare-load",
		label: "Porównanie obciążeń (40s×2)",
		description: "40s×2 @1Hz; load=0,25,50,75; klienci 10",
		config: {
			modes: ["ws", "polling"],
			hzSet: [1],
			loadSet: [0, 25, 50, 75],
			durationSec: 40,
			tickMs: 200,
			warmupSec: 4,
			cooldownSec: 4,
			clientsHttp: 10,
			clientsWs: 10,
			repeats: 2,
			pair: true,
			cpuSampleMs: 1000,
		},
	},
	{
		key: "stress",
		label: "Stress (50s)",
		description:
			"50s; Hz=2,4,8; load=0..75; klienci 25,50 – wysoka intensywność",
		config: {
			modes: ["ws", "polling"],
			hzSet: [2, 4, 8],
			loadSet: [0, 25, 50, 75],
			durationSec: 50,
			tickMs: 200,
			warmupSec: 5,
			cooldownSec: 5,
			clientsHttpSet: [25, 50],
			clientsWsSet: [25, 50],
			repeats: 1,
			pair: true,
			cpuSampleMs: 1000,
		},
	},
	{
		key: "latency",
		label: "Latency (60s×2)",
		description: "60s×2 @1Hz; load=0,50; klienci 1,25; tick=150ms",
		config: {
			modes: ["ws", "polling"],
			hzSet: [1],
			loadSet: [0, 50],
			durationSec: 60,
			tickMs: 150,
			warmupSec: 5,
			cooldownSec: 5,
			clientsHttpSet: [1, 25],
			clientsWsSet: [1, 25],
			repeats: 2,
			pair: true,
			cpuSampleMs: 750,
		},
	},
	// ---- Nowe presety ukierunkowane na skalowanie liczby klientów ----
	{
		key: "clients-fine",
		label: "Clients Fine (30s×2)",
		description:
			"Precyzyjny sweep klientów: 1,2,4,8,12,16,20 @1Hz load=0 – identyfikacja punktów załamania krzywej.",
		config: {
			modes: ["ws", "polling"],
			hzSet: [1],
			loadSet: [0],
			durationSec: 30,
			tickMs: 200,
			warmupSec: 3,
			cooldownSec: 3,
			clientsHttpSet: [1, 2, 4, 8, 12, 16, 20],
			clientsWsSet: [1, 2, 4, 8, 12, 16, 20],
			repeats: 2,
			pair: true,
			cpuSampleMs: 750,
		},
	},
	{
		key: "clients-wide",
		label: "Clients Wide (45s)",
		description:
			"Szerokie skalowanie klientów: 1,5,10,25,50,75,100 @1Hz load=0,25 – obserwacja degradacji i kosztu sieci.",
		config: {
			modes: ["ws", "polling"],
			hzSet: [1],
			loadSet: [0, 25],
			durationSec: 45,
			tickMs: 200,
			warmupSec: 4,
			cooldownSec: 4,
			clientsHttpSet: [1, 5, 10, 25, 50, 75, 100],
			clientsWsSet: [1, 5, 10, 25, 50, 75, 100],
			repeats: 1,
			pair: true,
			cpuSampleMs: 1000,
		},
	},
	{
		key: "clients-load-matrix",
		label: "Clients×Load (60s)",
		description:
			"Macierz: klienci 1,10,25,50 × load 0,25,50,75 @1Hz – analiza wpływu obciążenia CPU na skalowanie.",
		config: {
			modes: ["ws", "polling"],
			hzSet: [1],
			loadSet: [0, 25, 50, 75],
			durationSec: 60,
			tickMs: 200,
			warmupSec: 5,
			cooldownSec: 5,
			clientsHttpSet: [1, 10, 25, 50],
			clientsWsSet: [1, 10, 25, 50],
			repeats: 1,
			pair: true,
			cpuSampleMs: 1000,
		},
	},
	{
		key: "clients-latency-focus",
		label: "Clients Latency Focus (40s×2)",
		description:
			"40s×2 z krótszym tick=150ms, load=50, klienci 1,25,50 – wpływ większej presji na świeżość i jitter.",
		config: {
			modes: ["ws", "polling"],
			hzSet: [1],
			loadSet: [50],
			durationSec: 40,
			tickMs: 150,
			warmupSec: 4,
			cooldownSec: 4,
			clientsHttpSet: [1, 25, 50],
			clientsWsSet: [1, 25, 50],
			repeats: 2,
			pair: true,
			cpuSampleMs: 750,
		},
	},
	{
		key: "clients-saturation",
		label: "Clients Saturation (50s)",
		description:
			"Stopniowe dążenie do nasycenia: 1,10,25,50,75,100 @Hz=2 load=25 – test granicy przepustowości.",
		config: {
			modes: ["ws", "polling"],
			hzSet: [2],
			loadSet: [25],
			durationSec: 50,
			tickMs: 200,
			warmupSec: 5,
			cooldownSec: 5,
			clientsHttpSet: [1, 10, 25, 50, 75, 100],
			clientsWsSet: [1, 10, 25, 50, 75, 100],
			repeats: 1,
			pair: true,
			cpuSampleMs: 1000,
		},
	},
];

function parseNumberList(input: string): number[] | undefined {
	if (!input.trim()) return undefined;
	return input
		.split(/[,\s]+/)
		.map(s => s.trim())
		.filter(Boolean)
		.map(Number)
		.filter(n => !Number.isNaN(n));
}

// Przybliżone oszacowanie liczby scenariuszy (kombinacji) – uproszczone; może różnić się minimalnie
function countScenarios(cfg: ResearchRunRequest): number | undefined {
	const modes = cfg.modes?.length || 0;
	const hz = cfg.hzSet?.length || 0;
	const load = cfg.loadSet?.length || 0;
	const clientsHttp = cfg.clientsHttpSet?.length || (cfg.clientsHttp ? 1 : 0);
	const clientsWs = cfg.clientsWsSet?.length || (cfg.clientsWs ? 1 : 0);
	const repeats = cfg.repeats || 1;
	if (!modes || !hz || !load) return undefined;
	// Jeśli istnieją oba zestawy klientów, bierzemy max (pair zakłada równoległe parowanie WS/HTTP)
	const clientsDim = Math.max(clientsHttp || 1, clientsWs || 1);
	return modes * hz * load * clientsDim * repeats;
}

export default function ResearchRunPanel() {
	const [presetKey, setPresetKey] = useState<string>("baseline");
	const [formOpen, setFormOpen] = useState(false);

	// Zamknij formularz gdy wychodzimy z trybu 'custom'; opcjonalnie auto-otwórz gdy wchodzimy
	useEffect(() => {
		if (presetKey !== "custom") {
			setFormOpen(false);
		}
	}, [presetKey]);
	const [submitting, setSubmitting] = useState(false);
	const [currentRunId, setCurrentRunId] = useState<string | null>(null);
	const [runs, setRuns] = useState<ResearchRunStatus[]>([]);
	const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
	const [custom, setCustom] = useState<ResearchRunRequest>({});

	// Gdy użytkownik przełączy na 'custom' a brak ustawień — zainicjuj wartościami domyślnymi (jak backend przy braku parametrów)
	useEffect(() => {
		if (presetKey === "custom") {
			setCustom(c => {
				if (Object.keys(c).length > 0) return c; // już coś wpisano
				return {
					modes: ["ws", "polling"],
					hzSet: [1, 2],
					loadSet: [0],
					durationSec: 6,
					tickMs: 200, // MONITOR_TICK_MS env default (przyjęty lokalnie)
					warmupSec: 0,
					cooldownSec: 0,
					clientsHttp: 0,
					clientsWs: 0,
					// payload pozostawiamy nieustawiony: backend użyje 360B
				};
			});
		}
	}, [presetKey]);
	const [expectations, setExpectations] = useState<Record<string, number>>({});
	const pollRef = useRef<number | null>(null);

	const activeRun = runs.find(r => !r.finishedAt);
	const currentStatus = currentRunId
		? runs.find(r => r.id === currentRunId) || activeRun
		: activeRun;

	const selectedRun = selectedRunId
		? runs.find(r => r.id === selectedRunId) || null
		: null;

	const reload = async () => {
		try {
			const res = await fetch(`${API_BASE}/api/research/runs`);
			const json = await res.json();
			if (json.success) setRuns(json.data || []);
		} catch (e) {
			console.error("[research-panel] list error", e);
		}
	};

	useEffect(() => {
		reload();
		pollRef.current = window.setInterval(reload, 4000);
		return () => {
			if (pollRef.current) clearInterval(pollRef.current);
		};
	}, []);

	useEffect(() => {
		if (currentStatus && currentStatus.finishedAt) reload();
	}, [currentStatus]);

	const activePreset = useMemo(
		() => PRESETS.find(p => p.key === presetKey),
		[presetKey]
	);
	const requestBody: ResearchRunRequest = useMemo(() => {
		if (presetKey === "custom") return custom;
		return activePreset?.config || {};
	}, [presetKey, activePreset, custom]);

	const startRun = async () => {
		setSubmitting(true);
		try {
			// oszacowanie liczby scenariuszy zanim wyślemy
			const expected = countScenarios(requestBody);
			const res = await fetch(`${API_BASE}/api/research/run`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(requestBody),
			});
			const json = await res.json();
			if (json.success) {
				setCurrentRunId(json.data.runId);
				setSelectedRunId(json.data.runId); // auto wybór nowego runu
				if (expected)
					setExpectations(e => ({ ...e, [json.data.runId]: expected }));
				reload();
			}
		} catch (e) {
			console.error("[research-panel] start error", e);
		} finally {
			setSubmitting(false);
		}
	};

	const disabled = !!activeRun || submitting;

	const abortRun = async () => {
		if (!activeRun) return;
		try {
			await fetch(`${API_BASE}/api/research/run/${activeRun.id}`, {
				method: "DELETE",
			});
			reload();
		} catch (e) {
			console.error("[research-panel] abort error", e);
		}
	};

	return (
		<Box sx={{ mt: 2 }}>
			<Card variant='outlined'>
				<CardHeader
					title='Automatyczne runy badawcze'
					subheader='Uruchamiaj zdefiniowane zestawy scenariuszy (runMeasurements) lub własną konfigurację.'
					action={
						<IconButton onClick={() => reload()} aria-label='odśwież listę'>
							⟳
						</IconButton>
					}
				/>
				{activeRun && !activeRun.finishedAt && (
					<LinearProgress
						sx={{ height: 3 }}
						variant={
							activeRun.totalSessions && activeRun.completedSessions != null
								? "determinate"
								: "indeterminate"
						}
						value={
							activeRun.totalSessions && activeRun.completedSessions != null
								? (activeRun.completedSessions / activeRun.totalSessions) * 100
								: undefined
						}
					/>
				)}
				<CardContent>
					{activeRun && !activeRun.finishedAt && (
						<Alert severity='info' sx={{ mb: 2 }}>
							Trwa run: <strong>{activeRun.id}</strong> (start{" "}
							{new Date(activeRun.startedAt).toLocaleTimeString()}).{" "}
							{(() => {
								if (activeRun.totalSessions) {
									const done = activeRun.completedSessions || 0;
									const total = activeRun.totalSessions;
									const pct = ((done / total) * 100).toFixed(0);
									const scen =
										activeRun.scenarioIndex && activeRun.scenarioTotal
											? ` scenariusz ${activeRun.scenarioIndex}/${activeRun.scenarioTotal}`
											: "";
									const rep =
										activeRun.repIndex && activeRun.repTotal
											? ` rep ${activeRun.repIndex}/${activeRun.repTotal}`
											: "";
									const label = activeRun.currentLabel
										? ` (${activeRun.currentLabel})`
										: "";
									return ` Postęp: ${done}/${total} (${pct}%)${scen}${rep}${label}`;
								} else {
									const exp = expectations[activeRun.id];
									const done = activeRun.evaluatedCount;
									if (exp && done != null) {
										const pct = ((done / exp) * 100).toFixed(0);
										return ` Szacowany postęp: ${done}/${exp} (~${pct}%).`;
									}
								}
								return "";
							})()}
							{activeRun.aborting ? " (Kończenie po żądaniu abortu...)" : ""}
						</Alert>
					)}
					<Grid container spacing={2} alignItems='flex-start'>
						<Grid size={{ xs: 12, md: 4 }}>
							<FormControl fullWidth size='small'>
								<InputLabel id='preset-label'>Preset</InputLabel>
								<Select
									labelId='preset-label'
									label='Preset'
									value={presetKey}
									onChange={e => setPresetKey(e.target.value)}>
									{PRESETS.map(p => (
										<MenuItem key={p.key} value={p.key}>
											{p.label}
										</MenuItem>
									))}
									<MenuItem value='custom'>Własny…</MenuItem>
								</Select>
							</FormControl>
							<Typography
								variant='caption'
								color='text.secondary'
								sx={{ mt: 0.5, display: "block" }}>
								{presetKey !== "custom"
									? activePreset?.description
									: "Zdefiniuj parametry poniżej"}
							</Typography>
						</Grid>
						<Grid size={{ xs: 12, md: 8 }}>
							<Stack direction='row' spacing={1} flexWrap='wrap'>
								{requestBody.modes?.map(m => (
									<Chip key={m} label={m.toUpperCase()} size='small' />
								))}
								{requestBody.hzSet && (
									<Chip
										size='small'
										label={`Hz: ${requestBody.hzSet.join(",")}`}
									/>
								)}
								{requestBody.loadSet && (
									<Chip
										size='small'
										label={`Load: ${requestBody.loadSet.join(",")}`}
									/>
								)}
								{requestBody.clientsHttpSet && (
									<Chip
										size='small'
										label={`HTTP cli: ${requestBody.clientsHttpSet.join(",")}`}
									/>
								)}
								{requestBody.clientsWsSet && (
									<Chip
										size='small'
										label={`WS cli: ${requestBody.clientsWsSet.join(",")}`}
									/>
								)}
								{requestBody.durationSec && (
									<Chip size='small' label={`${requestBody.durationSec}s`} />
								)}
								{requestBody.repeats && requestBody.repeats > 1 && (
									<Chip size='small' label={`repeats=${requestBody.repeats}`} />
								)}
								{requestBody.pair && <Chip size='small' label='parowanie' />}
							</Stack>
						</Grid>
						<Grid size={{ xs: 12 }}>
							<Stack direction='row' spacing={1}>
								<Button
									variant='contained'
									onClick={startRun}
									disabled={disabled}>
									▶ Start
								</Button>
								{presetKey === "custom" && (
									<Tooltip title='Rozwiń / ukryj formularz konfiguracji własnej'>
										<Button
											variant='outlined'
											onClick={() => setFormOpen(v => !v)}>
											{formOpen ? "Ukryj parametry ▲" : "Parametry ▼"}
										</Button>
									</Tooltip>
								)}
							</Stack>
						</Grid>
						{activeRun && !activeRun.finishedAt && (
							<Button
								color='error'
								variant='outlined'
								onClick={abortRun}
								disabled={activeRun.aborting}>
								Abort
							</Button>
						)}
					</Grid>
					<Collapse
						in={presetKey === "custom" && formOpen}
						timeout='auto'
						unmountOnExit>
						<Divider sx={{ my: 2 }} />
						<Typography variant='subtitle2' gutterBottom>
							Własna konfiguracja
						</Typography>
						<Grid container spacing={2}>
							<Grid size={{ xs: 12, md: 4 }}>
								<TextField
									label='Modes (csv)'
									size='small'
									fullWidth
									placeholder='ws,polling'
									onChange={e =>
										setCustom(c => ({
											...c,
											modes: e.target.value
												.split(/[\,\s]+/)
												.map(s => s.trim())
												.filter(
													(s): s is "ws" | "polling" =>
														s === "ws" || s === "polling"
												),
										}))
									}
								/>
							</Grid>
							<Grid size={{ xs: 12, md: 4 }}>
								<TextField
									label='Hz set'
									size='small'
									fullWidth
									placeholder='1,2'
									onChange={e =>
										setCustom(c => ({
											...c,
											hzSet: parseNumberList(e.target.value),
										}))
									}
								/>
							</Grid>
							<Grid size={{ xs: 12, md: 4 }}>
								<TextField
									label='Load set (%)'
									size='small'
									fullWidth
									placeholder='0,25,50'
									onChange={e =>
										setCustom(c => ({
											...c,
											loadSet: parseNumberList(e.target.value),
										}))
									}
								/>
							</Grid>
							<Grid size={{ xs: 6, md: 3 }}>
								<TextField
									label='Duration (s)'
									size='small'
									type='number'
									fullWidth
									onChange={e =>
										setCustom(c => ({
											...c,
											durationSec: Number(e.target.value) || undefined,
										}))
									}
								/>
							</Grid>
							<Grid size={{ xs: 6, md: 3 }}>
								<TextField
									label='Tick (ms)'
									size='small'
									type='number'
									fullWidth
									onChange={e =>
										setCustom(c => ({
											...c,
											tickMs: Number(e.target.value) || undefined,
										}))
									}
								/>
							</Grid>
							<Grid size={{ xs: 6, md: 3 }}>
								<TextField
									label='Warmup (s)'
									size='small'
									type='number'
									fullWidth
									onChange={e =>
										setCustom(c => ({
											...c,
											warmupSec: Number(e.target.value) || undefined,
										}))
									}
								/>
							</Grid>
							<Grid size={{ xs: 6, md: 3 }}>
								<TextField
									label='Cooldown (s)'
									size='small'
									type='number'
									fullWidth
									onChange={e =>
										setCustom(c => ({
											...c,
											cooldownSec: Number(e.target.value) || undefined,
										}))
									}
								/>
							</Grid>
							<Grid size={{ xs: 6, md: 3 }}>
								<TextField
									label='Repeats'
									size='small'
									type='number'
									fullWidth
									onChange={e =>
										setCustom(c => ({
											...c,
											repeats: Number(e.target.value) || undefined,
										}))
									}
								/>
							</Grid>
							<Grid size={{ xs: 6, md: 3 }}>
								<FormControlLabel
									control={
										<Switch
											onChange={(_, v) =>
												setCustom(c => ({ ...c, pair: v || undefined }))
											}
										/>
									}
									label='Pair (pary WS/HTTP)'
								/>
							</Grid>
							<Grid size={{ xs: 6, md: 3 }}>
								<TextField
									label='HTTP clients'
									size='small'
									type='number'
									fullWidth
									onChange={e =>
										setCustom(c => ({
											...c,
											clientsHttp: Number(e.target.value) || undefined,
										}))
									}
								/>
							</Grid>
							<Grid size={{ xs: 6, md: 3 }}>
								<TextField
									label='WS clients'
									size='small'
									type='number'
									fullWidth
									onChange={e =>
										setCustom(c => ({
											...c,
											clientsWs: Number(e.target.value) || undefined,
										}))
									}
								/>
							</Grid>
							<Grid size={{ xs: 12, md: 6 }}>
								<TextField
									label='HTTP clients set'
									size='small'
									fullWidth
									placeholder='1,10,25'
									onChange={e =>
										setCustom(c => ({
											...c,
											clientsHttpSet: parseNumberList(e.target.value),
										}))
									}
								/>
							</Grid>
							<Grid size={{ xs: 12, md: 6 }}>
								<TextField
									label='WS clients set'
									size='small'
									fullWidth
									placeholder='1,10,25'
									onChange={e =>
										setCustom(c => ({
											...c,
											clientsWsSet: parseNumberList(e.target.value),
										}))
									}
								/>
							</Grid>
							<Grid size={{ xs: 6, md: 3 }}>
								<TextField
									label='Payload WS (B)'
									size='small'
									type='number'
									fullWidth
									onChange={e =>
										setCustom(c => ({
											...c,
											payloadWs: Number(e.target.value) || undefined,
										}))
									}
								/>
							</Grid>
							<Grid size={{ xs: 6, md: 3 }}>
								<TextField
									label='Payload HTTP (B)'
									size='small'
									type='number'
									fullWidth
									onChange={e =>
										setCustom(c => ({
											...c,
											payloadHttp: Number(e.target.value) || undefined,
										}))
									}
								/>
							</Grid>
							<Grid size={{ xs: 6, md: 3 }}>
								<TextField
									label='CPU sample (ms)'
									size='small'
									type='number'
									fullWidth
									onChange={e =>
										setCustom(c => ({
											...c,
											cpuSampleMs: Number(e.target.value) || undefined,
										}))
									}
								/>
							</Grid>
						</Grid>
					</Collapse>
					<Divider sx={{ my: 2 }} />
					<Typography variant='subtitle2' gutterBottom>
						Ostatnie runy
					</Typography>
					{runs.length === 0 && (
						<Typography variant='body2' color='text.secondary'>
							Brak (jeszcze nie uruchamiano).
						</Typography>
					)}
					{runs.length > 0 && (
						<Box sx={{ maxHeight: 260, overflow: "auto" }}>
							<table
								style={{
									width: "100%",
									fontSize: 12,
									borderCollapse: "collapse",
								}}>
								<thead>
									<tr>
										<th style={{ textAlign: "left", padding: 4 }}>ID</th>
										<th style={{ textAlign: "left", padding: 4 }}>
											Konfiguracja
										</th>
										<th style={{ textAlign: "left", padding: 4 }}>Start</th>
										<th style={{ textAlign: "left", padding: 4 }}>Stop</th>
										<th
											style={{ textAlign: "right", padding: 4 }}
											title='Liczba użytych podsumowań (scenariuszy) w summary'>
											n użyte
										</th>
										<th
											style={{ textAlign: "right", padding: 4 }}
											title='Szacowana liczba scenariuszy (modes × Hz × load × clients × repeats)'>
											Scen. (est.)
										</th>
										<th style={{ textAlign: "right", padding: 4 }}>Dir</th>
										<th style={{ textAlign: "left", padding: 4 }}>Status</th>
									</tr>
								</thead>
								<tbody>
									{runs.map(r => {
										const done = !!r.finishedAt;
										const exp = expectations[r.id];
										const selected = r.id === selectedRunId;
										return (
											<tr
												key={r.id}
												onClick={() => setSelectedRunId(r.id)}
												style={{
													background: selected
														? "rgba(25,118,210,0.18)"
														: r.id === currentRunId
														? "rgba(25,118,210,0.08)"
														: undefined,
													cursor: "pointer",
												}}>
												<td style={{ padding: 4 }}>{r.id}</td>
												<td
													style={{ padding: 4, maxWidth: 160 }}
													title={r.configLabel || ""}>
													{r.configLabel || ""}
												</td>
												<td style={{ padding: 4 }}>
													{new Date(r.startedAt).toLocaleTimeString()}
												</td>
												<td style={{ padding: 4 }}>
													{done
														? new Date(r.finishedAt!).toLocaleTimeString()
														: "—"}
												</td>
												<td style={{ padding: 4, textAlign: "right" }}>
													{r.evaluatedCount != null
														? r.evaluatedCount
														: r.finishedAt
														? 0
														: ""}
												</td>
												<td style={{ padding: 4, textAlign: "right" }}>
													{exp ? exp : ""}
												</td>
												<td
													style={{
														padding: 4,
														textAlign: "right",
														fontFamily: "monospace",
													}}>
													{r.outDir?.split("/").pop() || ""}
												</td>
												<td
													style={{
														padding: 4,
														color: r.error
															? "#d32f2f"
															: done
															? "#2e7d32"
															: "#ed6c02",
													}}>
													{r.error ? "ERROR" : done ? "OK" : "RUNNING"}
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</Box>
					)}
					{currentStatus && currentStatus.error && (
						<Alert severity='error' sx={{ mt: 2 }}>
							Błąd runu: {currentStatus.error}
						</Alert>
					)}
					{selectedRun && (
						<Box sx={{ mt: 3 }}>
							<Typography variant='subtitle2' gutterBottom>
								Wyniki wybranego runu: {selectedRun.id}
							</Typography>
							<ResearchRunResults run={selectedRun} />
						</Box>
					)}
				</CardContent>
			</Card>
		</Box>
	);
}
