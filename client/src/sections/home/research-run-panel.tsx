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
	FormControlLabel,
	Grid,
	IconButton,
	LinearProgress,
	Paper,
	Stack,
	Switch,
	TextField,
	Tooltip,
	Typography,
} from "@mui/material";
import { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:5000";

// Kuracja presetów – tylko kluczowe zestawy różnicujące protokoły
const PRESETS: ResearchPresetDescriptor[] = [
	{
		key: "contrast",
		label: "Kontrast",
		description:
			"30s×2: Hz=1,2,4; Obc.=0/50; klienci 1/10/50 — wysoki kontrast WS vs HTTP",
		config: {
			modes: ["ws", "polling"],
			hzSet: [1, 2, 4],
			loadSet: [0, 50],
			durationSec: 30,
			tickMs: 200,
			warmupSec: 2,
			cooldownSec: 2,
			clientsHttpSet: [1, 10, 50],
			clientsWsSet: [1, 10, 50],
			repeats: 2,
			pair: true,
			cpuSampleMs: 1000,
		},
	},
	{
		key: "contrast-small",
		label: "Kontrast (mały ładunek)",
		description:
			"30s×2: Hz=1,2,4; Obc.=0/50; klienci 1/10/50; payload≈120B (eksponuje narzut HTTP)",
		config: {
			modes: ["ws", "polling"],
			hzSet: [1, 2, 4],
			loadSet: [0, 50],
			durationSec: 30,
			tickMs: 200,
			warmupSec: 2,
			cooldownSec: 2,
			clientsHttpSet: [1, 10, 50],
			clientsWsSet: [1, 10, 50],
			repeats: 2,
			pair: true,
			cpuSampleMs: 1000,
			// Zmniejsz payload, by uwydatnić narzut HTTP (nagłówki)
			payloadWs: 120,
			payloadHttp: 120,
		},
	},
	{
		key: "contrast-highhz",
		label: "Kontrast (4–8 Hz)",
		description:
			"40s×2: Hz=4,8; Obc.=0/25; klienci 1/10/50 — różnice jitter/wieku danych",
		config: {
			modes: ["ws", "polling"],
			hzSet: [4, 8],
			loadSet: [0, 25],
			durationSec: 40,
			tickMs: 200,
			warmupSec: 3,
			cooldownSec: 3,
			clientsHttpSet: [1, 10, 50],
			clientsWsSet: [1, 10, 50],
			repeats: 2,
			pair: true,
			cpuSampleMs: 750,
		},
	},
	{
		key: "quick",
		label: "Szybki 4s",
		description: "Szybka kontrola: 4s @Hz=1,2",
		config: {
			modes: ["ws", "polling"],
			hzSet: [1, 2],
			loadSet: [0],
			durationSec: 4,
			tickMs: 200,
			warmupSec: 0.5,
			cooldownSec: 0.5,
			pair: true,
		},
	},
	{
		key: "baseline",
		label: "Bazowy",
		description: "Stabilny punkt: 40s×2 @1Hz",
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
		key: "freq",
		label: "Częstotliwości",
		description: "30s×2: 0.5–4Hz – wpływ częstotliwości",
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
		key: "clients",
		label: "Skalowanie klientów",
		description: "60s×2: klienci 1–50 @1Hz",
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
		key: "compare-load",
		label: "Poziomy obciążenia",
		description: "40s×2: obciążenie 0–75% @1Hz",
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
		key: "latency",
		label: "Fokus na latencję",
		description: "60s×2: obciążenie 0/50, tick=150ms",
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
	{
		key: "stress",
		label: "Miks stresowy",
		description: "50s: Hz=2–8, obciążenie 0–75%",
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
		key: "clients-wide",
		label: "Szeroka skala",
		description: "45s: klienci 1–100",
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
	// Globalny przełącznik realData dla presetów; dla custom przechowujemy w obiekcie custom.realData
	const [realData, setRealData] = useState(false);

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
	// Nowy stan: bieżący status aktywnego runu (nie modyfikuje listy historii)
	const [activeStatus, setActiveStatus] = useState<ResearchRunStatus | null>(
		null
	);
	// Zapamiętuj czy run uruchomiony z UI miał Real Data (na potrzeby wyświetlania w trakcie trwania)
	const [startedRealData, setStartedRealData] = useState<
		Record<string, boolean>
	>({});

	// Preferuj status z aktywnego pollingu, a w drugiej kolejności z listy (jednorazowo po załadowaniu)
	const activeRun = activeStatus || runs.find(r => !r.finishedAt);
	const currentStatus =
		activeRun ||
		(currentRunId ? runs.find(r => r.id === currentRunId) || null : null);

	const selectedRun = selectedRunId
		? runs.find(r => r.id === selectedRunId) || null
		: null;

	const reload = async () => {
		try {
			const res = await fetch(`${API_BASE}/api/research/runs`);
			const json = await res.json();
			if (json.success) setRuns(json.data || []);
			// po pełnym reloadzie ustaw ewentualny aktywny status (bez dalszego odświeżania historii)
			const ar =
				(json.success ? json.data : [])?.find(
					(r: ResearchRunStatus) => !r.finishedAt
				) || null;
			setActiveStatus(ar || null);
		} catch (e) {
			console.error("[research-panel] list error", e);
		}
	};

	// Pierwsze załadowanie – pojedynczy reload, bez stałego odświeżania historii
	useEffect(() => {
		reload();
		return () => {
			if (pollRef.current) clearInterval(pollRef.current);
		};
	}, []);

	// Polling tylko statusu aktywnego runu (nie aktualizuje historii). Po zakończeniu: zatrzymaj i wykonaj pojedynczy reload listy.
	useEffect(() => {
		if (pollRef.current) {
			clearInterval(pollRef.current);
			pollRef.current = null;
		}
		if (activeRun && !activeRun.finishedAt) {
			pollRef.current = window.setInterval(async () => {
				try {
					const res = await fetch(`${API_BASE}/api/research/runs`);
					const json = await res.json();
					if (json.success) {
						const ar =
							json.data?.find((r: ResearchRunStatus) => !r.finishedAt) || null;
						if (ar) {
							setActiveStatus(ar);
						} else {
							// zakończono – zatrzymaj polling statusu i odśwież historię jednorazowo
							if (pollRef.current) {
								clearInterval(pollRef.current);
								pollRef.current = null;
							}
							setActiveStatus(null);
							reload();
						}
					}
				} catch (e) {
					console.error("[research-panel] status poll error", e);
				}
			}, 4000);
		}
		return () => {
			if (pollRef.current) {
				clearInterval(pollRef.current);
				pollRef.current = null;
			}
		};
	}, [activeRun?.id, activeRun?.finishedAt, activeRun]);

	useEffect(() => {
		if (currentStatus && currentStatus.finishedAt) reload();
	}, [currentStatus]);

	const activePreset = useMemo(
		() => PRESETS.find(p => p.key === presetKey),
		[presetKey]
	);
	// Efektywny stan realData (dla custom z obiektu custom, dla presetów z globalnego przełącznika)
	const effectiveRealData =
		presetKey === "custom" ? !!custom.realData : realData;
	const requestBody: ResearchRunRequest = useMemo(() => {
		if (presetKey === "custom")
			return { ...custom, realData: effectiveRealData || undefined };
		return {
			...(activePreset?.config || {}),
			realData: effectiveRealData || undefined,
		};
	}, [presetKey, activePreset, custom, effectiveRealData]);

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
				// zapamiętaj tryb realData dla tego runu (lokalnie, dopóki backend nie zwróci flag)
				setStartedRealData(m => ({
					...m,
					[json.data.runId]: !!requestBody.realData,
				}));
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
						<Grid size={{ xs: 12 }}>
							<Typography variant='subtitle2' sx={{ mb: 0.5 }}>
								Presety (kliknij aby wybrać)
							</Typography>
							<Box
								sx={{
									display: "flex",
									gap: 1,
									pb: 1,
									overflowX: "auto",
									"&::-webkit-scrollbar": { height: 6 },
									"&::-webkit-scrollbar-thumb": {
										background: "#90a4ae",
										borderRadius: 3,
									},
								}}
								role='listbox'
								aria-label='Presety badań'>
								{PRESETS.map(p => {
									const selected = p.key === presetKey;
									const cfg = p.config;
									const scen = countScenarios(cfg as ResearchRunRequest);
									const dur = cfg.durationSec || 0;
									const warm = cfg.warmupSec || 0;
									const cool = cfg.cooldownSec || 0;
									const per = dur + warm + cool;
									const est = scen ? Math.round(per * scen) : undefined;
									return (
										<Tooltip
											key={p.key}
											title={
												p.key === "contrast"
													? "Zestaw o wysokim kontraście: pokazuje różnice WS vs HTTP w tempie, koszcie sieci i stabilności."
													: p.key === "contrast-small"
													? "Mały ładunek (~120B): eksponuje narzut nagłówków HTTP oraz efektywność WS przy broadcast."
													: p.key === "contrast-highhz"
													? "Wyższe częstotliwości (4–8Hz): uwidaczniają różnice w jitterze i wieku danych."
													: p.description || ""
											}
											placement='top'
											enterDelay={400}
											arrow>
											<Paper
												tabIndex={0}
												role='option'
												aria-selected={selected}
												onClick={() => !disabled && setPresetKey(p.key)}
												onKeyDown={e => {
													if (e.key === "Enter" || e.key === " ") {
														e.preventDefault();
														if (!disabled) setPresetKey(p.key);
													}
												}}
												sx={{
													p: 1,
													minWidth: 170,
													cursor: disabled ? "not-allowed" : "pointer",
													border: theme =>
														`2px solid ${
															selected
																? theme.palette.primary.main
																: "transparent"
														}`,
													bgcolor: selected
														? "primary.light"
														: "background.paper",
													opacity: disabled ? 0.6 : 1,
													transition: "background-color .2s, border-color .2s",
													"&:focus-visible": {
														outline: theme =>
															`2px solid ${theme.palette.primary.main}`,
														outlineOffset: 2,
													},
												}}>
												<Typography
													variant='subtitle2'
													sx={{ lineHeight: 1.1 }}>
													{p.label}
												</Typography>
												<Typography
													variant='caption'
													color='text.secondary'
													sx={{ display: "block", mb: 0.5 }}>
													{p.description}
												</Typography>
												<Stack direction='row' spacing={0.5} flexWrap='wrap'>
													{cfg.hzSet && (
														<Chip
															size='small'
															label={`Hz:${cfg.hzSet.join("/")}`}
														/>
													)}
													{cfg.loadSet && cfg.loadSet.length > 1 && (
														<Chip
															size='small'
															label={`Obc.:${cfg.loadSet.length}`}
														/>
													)}
													{(cfg.clientsHttpSet || cfg.clientsWsSet) && (
														<Chip
															size='small'
															label={`Klienci:${Math.max(
																cfg.clientsHttpSet?.length || 0,
																cfg.clientsWsSet?.length || 0
															)}`}
														/>
													)}
													{scen && (
														<Chip
															size='small'
															variant='outlined'
															label={`Scen.:${scen}`}
														/>
													)}
													{est && (
														<Chip
															size='small'
															variant='outlined'
															label={`~${est}s`}
														/>
													)}
												</Stack>
											</Paper>
										</Tooltip>
									);
								})}
								<Paper
									key='custom'
									onClick={() => !disabled && setPresetKey("custom")}
									role='option'
									aria-selected={presetKey === "custom"}
									tabIndex={0}
									onKeyDown={e => {
										if ((e.key === "Enter" || e.key === " ") && !disabled) {
											e.preventDefault();
											setPresetKey("custom");
										}
									}}
									sx={{
										p: 1,
										minWidth: 140,
										cursor: disabled ? "not-allowed" : "pointer",
										border: theme =>
											`2px solid ${
												presetKey === "custom"
													? theme.palette.primary.main
													: "transparent"
											}`,
										bgcolor:
											presetKey === "custom"
												? "primary.light"
												: "background.paper",
									}}>
									<Typography variant='subtitle2'>Własny…</Typography>
									<Typography variant='caption' color='text.secondary'>
										Własne parametry
									</Typography>
								</Paper>
							</Box>
							{presetKey !== "custom" && (
								<Typography
									variant='caption'
									color='text.secondary'
									sx={{ mt: -0.5, display: "block" }}>
									{activePreset?.description}
								</Typography>
							)}
						</Grid>
						<Grid size={{ xs: 12 }}>
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
										label={`Obc.: ${requestBody.loadSet.join(",")}`}
									/>
								)}
								{requestBody.clientsHttpSet && (
									<Chip
										size='small'
										label={`HTTP klienci: ${requestBody.clientsHttpSet.join(
											","
										)}`}
									/>
								)}
								{requestBody.clientsWsSet && (
									<Chip
										size='small'
										label={`WS klienci: ${requestBody.clientsWsSet.join(",")}`}
									/>
								)}
								{requestBody.durationSec && (
									<Chip size='small' label={`${requestBody.durationSec}s`} />
								)}
								{requestBody.repeats && requestBody.repeats > 1 && (
									<Chip
										size='small'
										label={`powtórzenia=${requestBody.repeats}`}
									/>
								)}
								{requestBody.pair && <Chip size='small' label='parowanie' />}
								{effectiveRealData && (
									<Tooltip title='Real Data: pasywny pomiar rzeczywistego strumienia MQTT/HTTP (brak syntetycznego generowania).'>
										<Chip size='small' color='secondary' label='REAL DATA' />
									</Tooltip>
								)}
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
								{presetKey !== "custom" && (
									<FormControlLabel
										labelPlacement='end'
										control={
											<Switch
												size='small'
												checked={realData}
												onChange={e => setRealData(e.target.checked)}
											/>
										}
										label={
											<Tooltip title='Real Data: pasywny pomiar rzeczywistego strumienia (MQTT/HTTP). Wyłącza syntetyczne generowanie payloadów i kontrolowany wsFixedRate.'>
												<span style={{ fontSize: 12 }}>Real Data</span>
											</Tooltip>
										}
									/>
								)}
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
								Przerwij
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
							<Grid size={{ xs: 12 }}>
								<FormControlLabel
									control={
										<Switch
											checked={!!custom.realData}
											onChange={(_, v) =>
												setCustom(c => ({ ...c, realData: v || undefined }))
											}
										/>
									}
									label={
										<Tooltip title='Real Data (custom): pasywne wykorzystanie rzeczywistych danych. Ukrywa pola payload – rzeczywisty rozmiar pobierany z MQTT.'>
											<span style={{ fontSize: 12 }}>Real Data</span>
										</Tooltip>
									}
								/>
								{custom.realData && (
									<Typography
										variant='caption'
										color='text.secondary'
										sx={{ ml: 1 }}>
										Payloady będą ignorowane; rozmiar wyliczany z rzeczywistych
										komunikatów.
									</Typography>
								)}
							</Grid>
							<Grid size={{ xs: 12, md: 4 }}>
								<TextField
									label='Tryby (csv)'
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
									label='Zestaw Hz'
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
									label='Zestaw obciążenia (%)'
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
									label='Czas trwania (s)'
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
									label='Próbkowanie (ms)'
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
									label='Rozgrzewka (s)'
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
									label='Chłodzenie (s)'
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
									label='Powtórzenia'
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
									label='Klienci HTTP'
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
									label='Klienci WS'
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
									label='Zestaw klientów HTTP'
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
									label='Zestaw klientów WS'
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
							{!custom.realData && (
								<>
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
								</>
							)}
							<Grid size={{ xs: 6, md: 3 }}>
								<TextField
									label='Próbkowanie CPU (ms)'
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
										<th style={{ textAlign: "left", padding: 4 }}>Tryb</th>
										<th style={{ textAlign: "left", padding: 4 }}>Start</th>
										<th style={{ textAlign: "left", padding: 4 }}>Stop</th>
										<th style={{ textAlign: "right", padding: 4 }}>Dir</th>
										<th style={{ textAlign: "left", padding: 4 }}>Status</th>
									</tr>
								</thead>
								<tbody>
									{runs.map(r => {
										const done = !!r.finishedAt;
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
													{(() => {
														interface F {
															[k: string]: unknown;
															realData?: boolean;
														}
														const f = (r.flags || {}) as F;
														const isReal =
															f.realData ||
															(!r.finishedAt && startedRealData[r.id]);
														return isReal ? (
															<span
																style={{ color: "#6a1b9a", fontWeight: 500 }}>
																REAL
															</span>
														) : (
															<span style={{ color: "#455a64" }}>SYN</span>
														);
													})()}
												</td>
												<td style={{ padding: 4 }}>
													{new Date(r.startedAt).toLocaleTimeString()}
												</td>
												<td style={{ padding: 4 }}>
													{done
														? new Date(r.finishedAt!).toLocaleTimeString()
														: "—"}
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
