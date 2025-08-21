"use client";
import type { ResearchRunStatus } from "@/types";
import {
	Box,
	Button,
	Card,
	CardContent,
	CardHeader,
	FormControl,
	InputLabel,
	MenuItem,
	Select,
	Stack,
	ToggleButton,
	ToggleButtonGroup,
	Typography,
} from "@mui/material";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

const ApexChart = dynamic(() => import("react-apexcharts"), { ssr: false });

interface Props {
	run?: ResearchRunStatus | null;
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:5000";

export default function ResearchRunResults({ run }: Props) {
	interface TimelineSessionSample {
		tSec: number;
		rate: number;
		bytesRate: number;
		payloadBytes?: number; // średni payload (B) wyliczony lokalnie
		jitterMs: number;
		freshnessMs: number;
		cpu?: number;
		rssMB?: number;
	}
	interface TimelineSession {
		label: string;
		mode: "ws" | "polling";
		warmupSec: number;
		cooldownSec: number;
		hz?: number;
		loadPct?: number;
		clients?: number;
		payloadBytes?: number;
		samples: TimelineSessionSample[];
	}
	const [sessions, setSessions] = useState<TimelineSession[] | null>(null);
	const [modeFilter, setModeFilter] = useState<"both" | "ws" | "polling">(
		"both"
	);
	// Wybór konkretnej kombinacji parametrów (hz, load, clients, payload) dla której istnieją WS i HTTP
	const [configKey, setConfigKey] = useState<string | null>(null);
	// Metryka musi być zdefiniowana przed ewentualnymi returnami aby kolejność hooków była stała
	type MetricKey =
		| "rate"
		| "bytesRate"
		| "payloadBytes"
		| "jitterMs"
		| "freshnessMs"
		| "cpu"
		| "rssMB";
	const [metric, setMetric] = useState<MetricKey>("rate");

	const load = async () => {
		if (!run?.id || !run.outDir || !run.finishedAt) return;
		// nadal pobieramy summary dla przycisków (download) ale nie zapisujemy do stanu (redukcja szumu)
		try {
			await fetch(`${API_BASE}/api/research/run/${run.id}/results`);
		} catch (e) {
			console.error("[results] fetch error", e);
		}
		try {
			const res2 = await fetch(
				`${API_BASE}/api/research/run/${run.id}/sessions`
			);
			const json2 = await res2.json();
			if (json2.success) setSessions(json2.data.sessions);
		} catch (e) {
			console.error("[sessions] fetch error", e);
		}
	};

	useEffect(() => {
		load();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [run?.id]);

	const timelineReady = sessions && sessions.length > 0;

	// Lista parowalnych konfiguracji (ma WS i HTTP) + auto-wybór pierwszej
	const configOptions = useMemo(() => {
		if (!sessions)
			return [] as Array<{
				key: string;
				label: string;
				hasWs: boolean;
				hasHttp: boolean;
			}>;
		const map = new Map<
			string,
			{
				key: string;
				hz?: number;
				load?: number;
				clients?: number;
				payload?: number;
				modes: Set<string>;
			}
		>();
		for (const s of sessions) {
			const key = [
				s.hz ?? "—",
				s.loadPct ?? 0,
				s.clients ?? 0,
				s.payloadBytes ?? "—",
			].join("|");
			if (!map.has(key))
				map.set(key, {
					key,
					hz: s.hz,
					load: s.loadPct,
					clients: s.clients,
					payload: s.payloadBytes,
					modes: new Set(),
				});
			map.get(key)!.modes.add(s.mode);
		}
		const out = Array.from(map.values())
			.filter(v => v.modes.has("ws") && v.modes.has("polling"))
			.sort(
				(a, b) =>
					(a.hz || 0) - (b.hz || 0) ||
					(a.load || 0) - (b.load || 0) ||
					(a.clients || 0) - (b.clients || 0)
			);
		return out.map(v => ({
			key: v.key,
			label: `Hz=${v.hz ?? "—"} | Load=${v.load ?? 0}% | Clients=${
				v.clients ?? 0
			} | Payload=${v.payload ?? "—"}B`,
			hasWs: true,
			hasHttp: true,
		}));
	}, [sessions]);

	useEffect(() => {
		if (!configKey && configOptions.length) setConfigKey(configOptions[0].key);
	}, [configOptions, configKey]);

	if (!run) return null;
	if (!run.finishedAt) {
		return (
			<Card variant='outlined' sx={{ mt: 2 }}>
				<CardHeader
					title='Wyniki runu'
					subheader='Run jeszcze trwa – wyniki pojawią się po zakończeniu.'
				/>
			</Card>
		);
	}
	const metricLabel: Record<MetricKey, string> = {
		rate: "Rate (/s)",
		bytesRate: "Bytes/s",
		payloadBytes: "Payload (B)",
		jitterMs: "Jitter (ms)",
		freshnessMs: "Staleness (ms)",
		cpu: "CPU (%)",
		rssMB: "RSS (MB)",
	};
	const metricDesc: Record<MetricKey, string> = {
		rate: "Średnia liczba komunikatów / żądań na sekundę (wyżej=lepiej). Wykres liniowy pozwala obserwować stabilność tempa.",
		bytesRate:
			"Średni strumień bajtów na sekundę (niżej=efektywniej przy zachowaniu tego samego Rate). Linia ujawnia skoki obciążenia sieci.",
		payloadBytes:
			"Średni rozmiar pojedynczego ładunku (B). Dla HTTP = BytesRate/Rate; dla WS skorygowane o liczbę klientów (BytesRate/(Rate×N)). Pozwala ocenić efektywność kodowania.",
		jitterMs:
			"Wahania odstępów czasowych między zdarzeniami (niżej=lepiej, stabilniejsze dostarczanie). Pożądany wykres płaski możliwie nisko.",
		freshnessMs:
			"Staleness (opóźnienie danych od momentu generacji do użycia); niżej=lepsza świeżość. Szukamy niskiej i stabilnej linii.",
		cpu: "Średnie zużycie CPU procesu backend (niżej=lepiej przy podobnych metrykach jakości). Wahania wskazują na skoki obciążenia.",
		rssMB:
			"Zużycie pamięci RSS (niżej=lepiej/stabilniej). Trend rosnący może sugerować wycieki lub akumulację.",
	};
	const timelineSeries: Array<{ name: string; data: (number | null)[] }> = [];
	// Dodatkowe serie: różnica (WS-HTTP) – wyliczona po zbudowaniu podstawowych
	let deltaSeries: (number | null)[] = [];
	// Agregaty globalne dla aktualnie wybranej konfiguracji (mean, median, p95 w przyszłości)
	interface AggregateRow {
		metric: MetricKey;
		ws?: number;
		http?: number;
		delta?: number; // ws - http
		pct?: number; // (ws-http)/http * 100
	}
	const aggregateRows: AggregateRow[] = [];
	const betterDirection: Record<MetricKey, "higher" | "lower"> = {
		rate: "higher",
		bytesRate: "lower", // mniejszy koszt przy zachowaniu rate
		payloadBytes: "lower", // mniejszy payload przy tym samym znaczeniu
		jitterMs: "lower",
		freshnessMs: "lower",
		cpu: "lower",
		rssMB: "lower",
	};
	const repInfo = { ws: 0, http: 0 };
	let timelineCategories: number[] = [];
	if (timelineReady) {
		// Oś X = indeks próbki (tick) po trimie warmup/cooldown, wyrównanie do najdłuższej serii
		const filtered = sessions
			.filter(s => (modeFilter === "both" ? true : s.mode === modeFilter))
			.filter(s =>
				configKey
					? [
							s.hz ?? "—",
							s.loadPct ?? 0,
							s.clients ?? 0,
							s.payloadBytes ?? "—",
					  ].join("|") === configKey
					: true
			);

		// Grupowanie po (mode,hz,loadPct,clients,payloadBytes) i uśrednianie powtórzeń tick-po-tick
		interface KeyGroup {
			key: string;
			mode: string;
			samples: TimelineSessionSample[][];
		}
		const map = new Map<string, KeyGroup>();
		for (const s of filtered) {
			const key = [s.mode, s.hz, s.loadPct, s.clients, s.payloadBytes].join(
				"|"
			);
			if (!map.has(key)) map.set(key, { key, mode: s.mode, samples: [] });
			map.get(key)!.samples.push(s.samples);
		}
		const grouped: { mode: string; samples: TimelineSessionSample[] }[] = [];
		// policz repy dla pary
		if (configKey) {
			const [hz, load, clients, payload] = configKey.split("|");
			repInfo.ws = filtered.filter(
				s =>
					s.mode === "ws" &&
					String(s.hz ?? "—") === hz &&
					String(s.loadPct ?? 0) === load &&
					String(s.clients ?? 0) === clients &&
					String(s.payloadBytes ?? "—") === payload
			).length;
			repInfo.http = filtered.filter(
				s =>
					s.mode === "polling" &&
					String(s.hz ?? "—") === hz &&
					String(s.loadPct ?? 0) === load &&
					String(s.clients ?? 0) === clients &&
					String(s.payloadBytes ?? "—") === payload
			).length;
		}
		for (const g of map.values()) {
			// znajdź max długość
			const maxLen = g.samples.reduce((m, arr) => Math.max(m, arr.length), 0);
			const merged: TimelineSessionSample[] = [];
			for (let i = 0; i < maxLen; i++) {
				const bucket = g.samples
					.map(arr => arr[i])
					.filter(Boolean) as TimelineSessionSample[];
				if (!bucket.length) continue;
				// uśrednij każdą metrykę numeryczną
				const avgNum = (
					sel: (s: TimelineSessionSample) => number | undefined
				) => {
					const vals = bucket
						.map(sel)
						.filter(v => v != null && Number.isFinite(v)) as number[];
					return vals.length
						? vals.reduce((a, b) => a + b, 0) / vals.length
						: undefined;
				};
				const rateAvg = avgNum(b => b.rate) || 0;
				const bytesRateAvg = avgNum(b => b.bytesRate) || 0;
				let payloadBytes: number | undefined;
				if (rateAvg > 0) {
					if (g.mode === "polling") {
						payloadBytes = bytesRateAvg / rateAvg;
					} else {
						// WS – korekcja o liczbę klientów:
						// label key format: mode|hz|load|clients|payload – rozbij aby uzyskać clients
						const parts = g.key.split("|");
						const clients = Number(parts[3]) || 0;
						if (clients > 0) payloadBytes = bytesRateAvg / (rateAvg * clients);
						else payloadBytes = bytesRateAvg / rateAvg; // fallback
					}
				}
				merged.push({
					tSec: bucket[0].tSec,
					rate: rateAvg,
					bytesRate: bytesRateAvg,
					payloadBytes,
					jitterMs: avgNum(b => b.jitterMs) || 0,
					freshnessMs: avgNum(b => b.freshnessMs) || 0,
					cpu: avgNum(b => b.cpu) || 0,
					rssMB: avgNum(b => b.rssMB) || 0,
				});
			}
			grouped.push({ mode: g.mode as "ws" | "polling", samples: merged });
		}

		const modeFiltered = grouped;
		const maxLen = modeFiltered.reduce(
			(m, s) => Math.max(m, s.samples.length),
			0
		);
		const wsSum: number[] = Array(maxLen).fill(0);
		const wsCnt: number[] = Array(maxLen).fill(0);
		const httpSum: number[] = Array(maxLen).fill(0);
		const httpCnt: number[] = Array(maxLen).fill(0);
		for (const sess of modeFiltered) {
			for (let i = 0; i < sess.samples.length; i++) {
				const sm = sess.samples[i];
				let val: number | undefined;
				if (metric === "payloadBytes") val = sm.payloadBytes;
				else
					val = sm[metric as keyof TimelineSessionSample] as number | undefined;
				if (!Number.isFinite(val)) continue;
				if (sess.mode === "ws") {
					wsSum[i] += val!;
					wsCnt[i] += 1;
				} else {
					httpSum[i] += val!;
					httpCnt[i] += 1;
				}
			}
		}
		const formatVal = (v: number | null): number | null => {
			if (v == null) return null;
			// Dwa miejsca po przecinku (dla jitter/freshness można 1 ale wymaganie: 2 wszędzie)
			return Number(v.toFixed(2));
		};
		const wsData: (number | null)[] = wsSum.map((s, i) =>
			wsCnt[i] ? formatVal(s / wsCnt[i]) : null
		);
		const httpData: (number | null)[] = httpSum.map((s, i) =>
			httpCnt[i] ? formatVal(s / httpCnt[i]) : null
		);
		timelineCategories = Array.from({ length: maxLen }, (_, i) => i + 1); // 1..N
		const legendSuffix = metricLabel[metric];
		if (wsData.some(v => v != null))
			timelineSeries.push({ name: `WS ${legendSuffix}`, data: wsData });
		if (httpData.some(v => v != null))
			timelineSeries.push({ name: `HTTP ${legendSuffix}`, data: httpData });

		// Δ seria (WS - HTTP) dla punktów gdzie mamy obie wartości
		deltaSeries = wsData.map((w, i) => {
			const h = httpData[i];
			if (w == null || h == null) return null;
			return Number((w - h).toFixed(2));
		});
		if (deltaSeries.some(v => v != null)) {
			// Dodajemy po głównych dwóch (użyjemy secondary y-axis w options)
			timelineSeries.push({
				name: `Δ WS-HTTP (${legendSuffix})`,
				data: deltaSeries,
			});
		}

		// Agregaty globalne (średnia po tickach z danymi)
		const avg = (arr: (number | null)[]) => {
			const vals = arr.filter(
				(v): v is number => v != null && Number.isFinite(v)
			);
			if (!vals.length) return undefined;
			return Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2));
		};
		const pushAggregate = (
			m: MetricKey,
			wsDataIn: (number | null)[],
			httpDataIn: (number | null)[]
		) => {
			const aws = avg(wsDataIn);
			const ahttp = avg(httpDataIn);
			let delta: number | undefined;
			let pct: number | undefined;
			if (aws != null && ahttp != null) {
				delta = Number((aws - ahttp).toFixed(2));
				pct =
					ahttp !== 0
						? Number((((aws - ahttp) / ahttp) * 100).toFixed(1))
						: undefined;
			}
			aggregateRows.push({ metric: m, ws: aws, http: ahttp, delta, pct });
		};
		// Wyliczamy agregaty dla wszystkich metryk niezależnie od aktualnie wybranej, by pokazać pełne porównanie
		// Bazujemy na already grouped 'grouped' strukturze - musimy więc policzyć jeszcze raz dla każdej metryki.
		const collectMetricData = (
			m: MetricKey
		): { ws: (number | null)[]; http: (number | null)[] } => {
			const wsTmp: number[] = [];
			const httpTmp: number[] = [];
			for (const sess of grouped) {
				const data = sess.samples.map(sm => {
					if (m === "payloadBytes") return sm.payloadBytes;
					return sm[m as keyof typeof sm] as number | undefined;
				});
				const avgSess = avg(data as (number | null)[]); // średnia z sesji
				if (avgSess != null) {
					if (sess.mode === "ws") wsTmp.push(avgSess);
					else httpTmp.push(avgSess);
				}
			}
			return { ws: wsTmp, http: httpTmp };
		};
		(
			[
				"rate",
				"bytesRate",
				"payloadBytes",
				"jitterMs",
				"freshnessMs",
				"cpu",
				"rssMB",
			] as MetricKey[]
		).forEach(mkey => {
			const collected = collectMetricData(mkey);
			pushAggregate(mkey, collected.ws, collected.http);
		});
	}

	return (
		<Card variant='outlined' sx={{ mt: 2 }}>
			<CardHeader
				title='Wyniki runu (timeline)'
				subheader={run.outDir?.split("/").pop()}
				action={
					<Stack direction='row' spacing={1}>
						<Button size='small' onClick={load}>
							Odśwież
						</Button>
						<Button
							size='small'
							component='a'
							href={`${API_BASE}/api/research/run/${run.id}/results`}
							target='_blank'
							rel='noreferrer'>
							summary.json
						</Button>
						<Button
							size='small'
							component='a'
							href={`${API_BASE}/api/research/run/${run.id}/sessions`}
							target='_blank'
							rel='noreferrer'>
							sessions.json
						</Button>
					</Stack>
				}
			/>
			<CardContent>
				<Stack
					direction={{ xs: "column", md: "row" }}
					spacing={2}
					sx={{ mb: 2 }}>
					<ToggleButtonGroup
						value={modeFilter}
						exclusive
						size='small'
						onChange={(_, v) => v && setModeFilter(v)}>
						<ToggleButton value='both'>WS+HTTP</ToggleButton>
						<ToggleButton value='ws'>WS</ToggleButton>
						<ToggleButton value='polling'>HTTP</ToggleButton>
					</ToggleButtonGroup>
					<FormControl size='small' sx={{ minWidth: 150 }}>
						<InputLabel>Metryka</InputLabel>
						<Select
							label='Metryka'
							value={metric}
							onChange={e => setMetric(e.target.value as typeof metric)}>
							<MenuItem value='rate'>Rate (/s)</MenuItem>
							<MenuItem value='bytesRate'>Bytes/s</MenuItem>
							<MenuItem value='payloadBytes'>Payload (B)</MenuItem>
							<MenuItem value='jitterMs'>Jitter (ms)</MenuItem>
							<MenuItem value='freshnessMs'>Staleness (ms)</MenuItem>
							<MenuItem value='cpu'>CPU (%)</MenuItem>
							<MenuItem value='rssMB'>RSS (MB)</MenuItem>
						</Select>
					</FormControl>
					{configOptions.length > 0 && (
						<FormControl size='small' sx={{ minWidth: 260 }}>
							<InputLabel>Konfiguracja (para WS/HTTP)</InputLabel>
							<Select
								label='Konfiguracja (para WS/HTTP)'
								value={configKey || ""}
								onChange={e => setConfigKey(e.target.value || null)}>
								{configOptions.map(o => (
									<MenuItem key={o.key} value={o.key}>
										{o.label}
									</MenuItem>
								))}
							</Select>
						</FormControl>
					)}
				</Stack>
				{configKey && (
					<Stack direction='row' spacing={1} sx={{ mb: 1 }}>
						<Box
							sx={{
								px: 1,
								py: 0.5,
								borderRadius: 1,
								fontSize: 12,
								bgcolor: "#e3f2fd",
								color: "#1565c0",
							}}>
							WS reps: {repInfo.ws || "—"}
						</Box>
						<Box
							sx={{
								px: 1,
								py: 0.5,
								borderRadius: 1,
								fontSize: 12,
								bgcolor: "#e8f5e9",
								color: "#2e7d32",
							}}>
							HTTP reps: {repInfo.http || "—"}
						</Box>
						<Box
							sx={{
								px: 1,
								py: 0.5,
								borderRadius: 1,
								fontSize: 12,
								bgcolor: "#eceff1",
								color: "#455a64",
							}}>
							{configOptions.find(c => c.key === configKey)?.label}
						</Box>
					</Stack>
				)}
				{timelineReady ? (
					<Box>
						<ApexChart
							type='line'
							height={360}
							series={timelineSeries}
							options={{
								chart: {
									id: "research-timeline",
									toolbar: { show: true },
									animations: { enabled: false },
								},
								stroke: { width: [2, 2, 1], curve: "straight" },
								xaxis: {
									categories: timelineCategories,
									title: { text: "Próbka (tick) – po trimie warmup/cooldown" },
								},
								yaxis: [
									{ title: { text: metricLabel[metric] } },
									{
										opposite: true,
										title: { text: "Δ WS-HTTP" },
										decimalsInFloat: 2,
									},
								],
								colors: ["#1e88e5", "#2e7d32", "#ff9100"],
								tooltip: {
									shared: true,
									custom: ({ series, dataPointIndex, w }) => {
										type SeriesCfg = { name: string };
										const wsIdx = (w.config.series as SeriesCfg[]).findIndex(
											s => s.name.startsWith("WS ")
										);
										const httpIdx = (w.config.series as SeriesCfg[]).findIndex(
											s => s.name.startsWith("HTTP ")
										);
										const deltaIdx = (w.config.series as SeriesCfg[]).findIndex(
											s => s.name.startsWith("Δ WS-HTTP")
										);
										const wsVal =
											wsIdx >= 0 ? series[wsIdx][dataPointIndex] : null;
										const httpVal =
											httpIdx >= 0 ? series[httpIdx][dataPointIndex] : null;
										const deltaVal =
											deltaIdx >= 0 ? series[deltaIdx][dataPointIndex] : null;
										let diffHtml = "";
										if (deltaVal != null && wsVal != null && httpVal != null) {
											const rel =
												httpVal !== 0 ? ((wsVal - httpVal) / httpVal) * 100 : 0;
											diffHtml = `<tr><td colspan=2 style=\"padding-top:4px;border-top:1px solid #ccc;font-size:11px\">Δ: ${(
												wsVal - httpVal
											).toFixed(2)} (${rel.toFixed(1)}%)</td></tr>`;
										}
										return `<div style=\"padding:6px 8px;font-size:12px\">Tick: ${
											dataPointIndex + 1
										}<br/><table style=\"border-collapse:collapse\"><tr><td style=\"color:#1e88e5;padding-right:8px\">WS</td><td>${
											wsVal != null ? wsVal.toFixed(2) : "—"
										}</td></tr><tr><td style=\"color:#2e7d32;padding-right:8px\">HTTP</td><td>${
											httpVal != null ? httpVal.toFixed(2) : "—"
										}</td></tr>${diffHtml}</table></div>`;
									},
								},
								legend: { position: "top" },
							}}
						/>
						<Typography
							variant='caption'
							color='text.secondary'
							sx={{ mt: 1, display: "block" }}>
							{metricDesc[metric]} Kierunek lepszy:{" "}
							{betterDirection[metric] === "higher" ? "wyżej" : "niżej"}. Δ = WS
							- HTTP. Średnie tickowe uśredniają wszystkie repetycje (n=WS:
							{repInfo.ws} / HTTP:{repInfo.http}).
						</Typography>
						{/* Tabela agregatów wszystkich metryk dla tej konfiguracji */}
						<Box sx={{ mt: 2 }}>
							<Typography variant='subtitle2' gutterBottom>
								Podsumowanie agregatów (średnie po sesjach) – wybrana
								konfiguracja
							</Typography>
							<Box sx={{ overflowX: "auto" }}>
								<table
									style={{
										borderCollapse: "collapse",
										fontSize: 12,
										minWidth: 520,
									}}>
									<thead>
										<tr>
											<th style={{ textAlign: "left", padding: 4 }}>Metryka</th>
											<th style={{ textAlign: "right", padding: 4 }}>WS</th>
											<th style={{ textAlign: "right", padding: 4 }}>HTTP</th>
											<th style={{ textAlign: "right", padding: 4 }}>
												Δ (abs)
											</th>
											<th style={{ textAlign: "right", padding: 4 }}>Δ %</th>
											<th style={{ textAlign: "left", padding: 4 }}>Lepsze</th>
										</tr>
									</thead>
									<tbody>
										{aggregateRows.map(r => {
											const dir = betterDirection[r.metric];
											let better: string = "—";
											if (r.ws != null && r.http != null && r.delta != null) {
												if (r.delta === 0) better = "≈";
												else if (dir === "higher")
													better = r.delta > 0 ? "WS" : "HTTP";
												else better = r.delta < 0 ? "WS" : "HTTP";
											}
											return (
												<tr
													key={r.metric}
													style={{
														background:
															r.metric === metric
																? "rgba(25,118,210,0.08)"
																: undefined,
													}}>
													<td style={{ padding: 4 }}>
														{metricLabel[r.metric]}
													</td>
													<td style={{ padding: 4, textAlign: "right" }}>
														{r.ws != null ? r.ws.toFixed(2) : "—"}
													</td>
													<td style={{ padding: 4, textAlign: "right" }}>
														{r.http != null ? r.http.toFixed(2) : "—"}
													</td>
													<td style={{ padding: 4, textAlign: "right" }}>
														{r.delta != null ? r.delta.toFixed(2) : "—"}
													</td>
													<td style={{ padding: 4, textAlign: "right" }}>
														{r.pct != null ? r.pct.toFixed(1) + "%" : "—"}
													</td>
													<td style={{ padding: 4 }}>{better}</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							</Box>
							<Typography
								variant='caption'
								color='text.secondary'
								sx={{ mt: 1, display: "block" }}>
								Kolumna „Lepsze” ocenia wprost na podstawie kierunku metryki; Δ%
								= (WS-HTTP)/HTTP*100. Przy kolejnych iteracjach można dodać
								mediany i percentyle.
							</Typography>
						</Box>
					</Box>
				) : (
					<Typography variant='body2' color='text.secondary'>
						Brak danych timeline.
					</Typography>
				)}
			</CardContent>
		</Card>
	);
}
