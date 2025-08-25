"use client";
import type { ResearchRunStatus } from "@/types";
import {
	Alert,
	Box,
	Button,
	Card,
	CardContent,
	CardHeader,
	Chip,
	Divider,
	FormControl,
	Grid,
	InputLabel,
	MenuItem,
	Paper,
	Select,
	Stack,
	ToggleButton,
	ToggleButtonGroup,
	Tooltip,
	Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

const ApexChart = dynamic(() => import("react-apexcharts"), { ssr: false });

interface Props {
	run?: ResearchRunStatus | null;
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:5000";

export default function ResearchRunResults({ run }: Props) {
	// Pomocniczy typ dla flag (backend zwraca Record<string,unknown>)
	interface RunFlags {
		[k: string]: unknown;
		realData?: boolean;
	}
	const flags = (run?.flags || {}) as RunFlags;

	interface TimelineSessionSample {
		tSec: number;
		rate: number;
		bytesRate: number;
		payloadBytes?: number; // średni payload (B) wyliczony lokalnie
		avgPayloadBytes?: number; // payload z API per próbkę (jeśli dostępny)
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

	// Stan sesji (wczytywany z API)
	const [sessions, setSessions] = useState<TimelineSession[] | null>(null);

	// Hooks (musi być blisko początku komponentu – przed wczesnymi returnami)
	const theme = useTheme();
	const compact = useMediaQuery(theme.breakpoints.down("sm"));
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
	const [viewMode, setViewMode] = useState<"timeline" | "summary" | "kpis">(
		"timeline"
	);

	// Stan dialogu payloadu + szczegóły
	const [payloadOpen, setPayloadOpen] = useState(false);
	const [payloadDetails, setPayloadDetails] = useState<{
		first?: { ws?: number; http?: number; wsTick?: number; httpTick?: number };
		last?: { ws?: number; http?: number; wsTick?: number; httpTick?: number };
		wsJsonPretty?: string; // aktualny JSON (WS)
		httpJsonPretty?: string; // aktualny JSON body (HTTP)
		wsNowBytes?: number; // rozmiar aktualnego JSON WS
		httpNowBytes?: number; // rozmiar aktualnego JSON body HTTP
	}>({});

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

	// Helper: policz wyrównane serie payloadu (B) dla bieżącej konfiguracji
	function computeAlignedPayloadSeries() {
		if (!sessions) return null;
		// Filtr pod wybraną konfigurację
		const filtered = sessions
			.filter(s => (modeFilter === "both" ? true : s.mode === modeFilter))
			.filter(s =>
				configKey
					? [
							String(s.hz ?? "—"),
							String(s.loadPct ?? 0),
							String(s.clients ?? 0),
							String(s.payloadBytes ?? "—"),
					  ].join("|") === configKey
					: true
			);
		if (!filtered.length) return null;
		// Grupowanie jak w timeline – ale licz tylko payloadBytes
		type GroupKey = string;
		const map = new Map<
			GroupKey,
			{
				key: GroupKey;
				mode: "ws" | "polling";
				samples: TimelineSessionSample[][];
			}
		>();
		for (const s of filtered) {
			const key = [s.mode, s.hz, s.loadPct, s.clients, s.payloadBytes].join(
				"|"
			) as GroupKey;
			if (!map.has(key)) map.set(key, { key, mode: s.mode, samples: [] });
			map.get(key)!.samples.push(s.samples);
		}
		const grouped: {
			key: GroupKey;
			mode: "ws" | "polling";
			samples: number[];
		}[] = [];
		for (const g of map.values()) {
			const maxLen = g.samples.reduce((m, arr) => Math.max(m, arr.length), 0);
			const merged: number[] = [];
			for (let i = 0; i < maxLen; i++) {
				const bucket = g.samples
					.map(arr => arr[i])
					.filter(Boolean) as TimelineSessionSample[];
				if (!bucket.length) continue;
				// Średnia payloadu per próbka z preferencją avgPayloadBytes
				const vals: number[] = [];
				for (const b of bucket) {
					let v: number | undefined = b.avgPayloadBytes;
					if (!(Number.isFinite(v) && (v as number) > 0)) {
						if (b.rate > 0) {
							const parts = g.key.split("|");
							const clients = g.mode === "ws" ? Number(parts[3] || 0) || 0 : 0;
							v =
								g.mode === "polling"
									? b.bytesRate / b.rate
									: clients > 0
									? b.bytesRate / (b.rate * clients)
									: b.bytesRate / b.rate;
						}
					}
					if (Number.isFinite(v) && (v as number) > 0) vals.push(v as number);
				}
				merged.push(
					vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN
				);
			}
			grouped.push({ key: g.key, mode: g.mode, samples: merged });
		}
		const ws = grouped.find(g => g.mode === "ws")?.samples || [];
		const http = grouped.find(g => g.mode === "polling")?.samples || [];
		const minLen = Math.min(ws.length || 0, http.length || 0);
		if (!minLen)
			return { wsAligned: ws, httpAligned: http } as {
				wsAligned: number[];
				httpAligned: number[];
			};
		return {
			wsAligned: ws.slice(0, minLen),
			httpAligned: http.slice(0, minLen),
		} as { wsAligned: number[]; httpAligned: number[] };
	}

	async function openPayloadDialog() {
		// policz pierwszy/ostatni payload (B) na podstawie danych sesji
		let firstWs: number | undefined;
		let firstHttp: number | undefined;
		let lastWs: number | undefined;
		let lastHttp: number | undefined;
		let firstWsTick: number | undefined;
		let firstHttpTick: number | undefined;
		let lastWsTick: number | undefined;
		let lastHttpTick: number | undefined;
		try {
			const aligned = computeAlignedPayloadSeries();
			if (aligned) {
				const { wsAligned, httpAligned } = aligned as {
					wsAligned: number[];
					httpAligned: number[];
				};
				const findFirst = (
					arr: number[]
				): { v: number | undefined; i: number | undefined } => {
					for (let i = 0; i < arr.length; i++)
						if (Number.isFinite(arr[i])) return { v: arr[i], i: i + 1 };
					return { v: undefined, i: undefined };
				};
				const findLast = (
					arr: number[]
				): { v: number | undefined; i: number | undefined } => {
					for (let i = arr.length - 1; i >= 0; i--)
						if (Number.isFinite(arr[i])) return { v: arr[i], i: i + 1 };
					return { v: undefined, i: undefined };
				};
				const fws = findFirst(wsAligned || []);
				const fhttp = findFirst(httpAligned || []);
				const lws = findLast(wsAligned || []);
				const lhttp = findLast(httpAligned || []);
				firstWs = fws.v;
				firstWsTick = fws.i;
				firstHttp = fhttp.v;
				firstHttpTick = fhttp.i;
				lastWs = lws.v;
				lastWsTick = lws.i;
				lastHttp = lhttp.v;
				lastHttpTick = lhttp.i;
			}
		} catch {}
		// Pobierz aktualny JSON (podgląd struktury)
		let wsJsonPretty: string | undefined;
		let httpJsonPretty: string | undefined;
		let wsNowBytes: number | undefined;
		let httpNowBytes: number | undefined;
		try {
			const res = await fetch(`${API_BASE}/api/arduino-data`);
			if (res.ok) {
				const body = await res.json();
				const dataStr =
					typeof body?.data === "string" ? body.data : body?.data?.data || "";
				try {
					const obj = JSON.parse(dataStr);
					wsJsonPretty = JSON.stringify(obj, null, 2);
				} catch {
					wsJsonPretty = dataStr;
				}
				// HTTP body to wrapper {success, data}
				const httpBodyObj = { success: !!body?.success, data: dataStr };
				httpJsonPretty = JSON.stringify(httpBodyObj, null, 2);
				// Byte sizes w przeglądarce – użyj Blob do policzenia bajtów UTF‑8
				wsNowBytes = new Blob([
					typeof wsJsonPretty === "string" ? wsJsonPretty : "",
				]).size;
				httpNowBytes = new Blob([JSON.stringify(httpBodyObj)]).size;
			}
		} catch {}
		setPayloadDetails({
			first: {
				ws:
					firstWs != null && Number.isFinite(firstWs)
						? Number(firstWs.toFixed(2))
						: undefined,
				http:
					firstHttp != null && Number.isFinite(firstHttp)
						? Number(firstHttp.toFixed(2))
						: undefined,
				wsTick: firstWsTick,
				httpTick: firstHttpTick,
			},
			last: {
				ws:
					lastWs != null && Number.isFinite(lastWs)
						? Number(lastWs.toFixed(2))
						: undefined,
				http:
					lastHttp != null && Number.isFinite(lastHttp)
						? Number(lastHttp.toFixed(2))
						: undefined,
				wsTick: lastWsTick,
				httpTick: lastHttpTick,
			},
			wsJsonPretty,
			httpJsonPretty,
			wsNowBytes,
			httpNowBytes,
		});
		setPayloadOpen(true);
	}

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
					modes: new Set<string>(),
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
			label: `Hz=${v.hz ?? "—"} | Obciążenie=${v.load ?? 0}% | Klienci=${
				v.clients ?? 0
			} | Ładunek=${v.payload ?? "—"}B`,
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
		rate: "Tempo (/s)",
		bytesRate: "B/s",
		payloadBytes: "Ładunek (B)",
		jitterMs: "Jitter (ms)",
		freshnessMs: "Wiek danych (ms)",
		cpu: "CPU (%)",
		rssMB: "RSS (MB)",
	};
	const metricDesc: Record<MetricKey, string> = {
		rate: "Średnia liczba komunikatów/żądań na sekundę (wyżej=lepiej). Linia pokazuje stabilność tempa.",
		bytesRate:
			"Średni strumień bajtów na sekundę (niżej=efektywniej przy zachowaniu tego samego tempa). Linia ujawnia skoki obciążenia sieci.",
		payloadBytes:
			"Średni rozmiar pojedynczego ładunku (B). Dla HTTP = B/s ÷ tempo; dla WS skorygowane o liczbę klientów (B/s ÷ (tempo×N)). Pozwala ocenić efektywność kodowania.",
		jitterMs:
			"Wahania odstępów czasowych między zdarzeniami (niżej=lepiej, stabilniejsze dostarczanie). Pożądany wykres płaski możliwie nisko.",
		freshnessMs:
			"Wiek danych (opóźnienie od generacji do użycia); niżej=lepiej. Szukamy niskiej i stabilnej linii.",
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
				// preferuj bezpośrednie avgPayloadBytes z API (per próbka)
				const directPayload = avgNum(
					b => b.avgPayloadBytes as number | undefined
				);
				if (directPayload != null && Number.isFinite(directPayload)) {
					payloadBytes = directPayload;
				} else if (rateAvg > 0) {
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
					avgPayloadBytes: directPayload,
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
		// Wyrównanie: jeśli porównujemy WS+HTTP, przytnij obie serie do wspólnej minimalnej długości
		// aby liczba ticków była identyczna dla obu protokołów (bez imputacji wartości).
		let wsAligned = wsData;
		let httpAligned = httpData;
		const hasWsSeries = wsData.some(v => v != null);
		const hasHttpSeries = httpData.some(v => v != null);
		if (modeFilter === "both" && hasWsSeries && hasHttpSeries) {
			const minLen = Math.min(wsData.length, httpData.length);
			if (minLen > 0) {
				wsAligned = wsData.slice(0, minLen);
				httpAligned = httpData.slice(0, minLen);
				timelineCategories = Array.from({ length: minLen }, (_, i) => i + 1);
			}
		} else {
			timelineCategories = Array.from(
				{ length: Math.max(wsData.length, httpData.length) },
				(_, i) => i + 1
			);
		}
		const legendSuffix = metricLabel[metric];
		if (wsAligned.some(v => v != null))
			timelineSeries.push({ name: `WS ${legendSuffix}`, data: wsAligned });
		if (httpAligned.some(v => v != null))
			timelineSeries.push({ name: `HTTP ${legendSuffix}`, data: httpAligned });

		// Δ seria (WS - HTTP) dla punktów gdzie mamy obie wartości
		deltaSeries = wsAligned.map((w, i) => {
			const h = httpAligned[i];
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

	// Funkcja renderująca karty porównawcze (summary)
	function renderSummary() {
		// W summary wykorzystujemy aggregateRows – jeśli brak, pokaż info
		if (!aggregateRows.length)
			return (
				<Typography variant='body2' color='text.secondary'>
					Brak agregatów do podsumowania.
				</Typography>
			);
		return (
			<Box>
				<Grid container spacing={2} sx={{ mt: 0 }}>
					{aggregateRows.map(r => {
						const dir = betterDirection[r.metric];
						let better: string | null = null;
						if (r.ws != null && r.http != null && r.delta != null) {
							if (r.delta === 0) better = "≈";
							else if (dir === "higher") better = r.delta > 0 ? "WS" : "HTTP";
							else better = r.delta < 0 ? "WS" : "HTTP";
						}
						// Kolor przewagi
						const advantageColor =
							better === "WS"
								? "#1e88e5"
								: better === "HTTP"
								? "#2e7d32"
								: undefined;
						return (
							<Grid key={r.metric} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
								<Paper
									sx={{
										p: 1.5,
										height: "100%",
										display: "flex",
										flexDirection: "column",
										gap: 0.75,
									}}
									variant='outlined'>
									<Tooltip title={metricDesc[r.metric]} placement='top'>
										<Typography
											variant='subtitle2'
											sx={{
												display: "flex",
												alignItems: "center",
												gap: 0.75,
												lineHeight: 1.1,
											}}>
											{metricLabel[r.metric]}
											{better && (
												<Chip
													size='small'
													label={better}
													sx={{
														bgcolor: advantageColor,
														color: advantageColor ? "#fff" : undefined,
													}}
												/>
											)}
										</Typography>
									</Tooltip>
									<Stack
										direction='row'
										spacing={0.75}
										alignItems='center'
										flexWrap='wrap'
										useFlexGap>
										<Chip
											size='small'
											sx={{ fontSize: 11 }}
											label={`WS ${r.ws != null ? r.ws.toFixed(2) : "—"}`}
										/>
										<Chip
											size='small'
											sx={{ fontSize: 11 }}
											label={`HTTP ${r.http != null ? r.http.toFixed(2) : "—"}`}
										/>
										<Chip
											size='small'
											variant='outlined'
											sx={{ fontSize: 11 }}
											label={`Δ ${r.delta != null ? r.delta.toFixed(2) : "—"}`}
										/>
										<Chip
											size='small'
											variant='outlined'
											sx={{ fontSize: 11 }}
											label={`Δ% ${
												r.pct != null ? r.pct.toFixed(1) + "%" : "—"
											}`}
										/>
									</Stack>
								</Paper>
							</Grid>
						);
					})}
				</Grid>
				<Typography
					variant='caption'
					color='text.secondary'
					sx={{ mt: 1, display: "block" }}>
					Podsumowanie: średnie wartości sesji (uśrednienie repów). Kolor chipu
					wskazuje przewagę zgodnie z kierunkiem metryki.
				</Typography>
			</Box>
		);
	}

	// Render podsumowania zbiorczego (timeline view) – tabela / karty w trybie compact
	function renderAggregateTable() {
		if (!aggregateRows.length) return null;
		if (compact) {
			return (
				<Stack spacing={1} sx={{ mt: 2 }}>
					{aggregateRows.map(r => {
						const dir = betterDirection[r.metric];
						let better: string = "—";
						if (r.ws != null && r.http != null && r.delta != null) {
							if (r.delta === 0) better = "≈";
							else if (dir === "higher") better = r.delta > 0 ? "WS" : "HTTP";
							else better = r.delta < 0 ? "WS" : "HTTP";
						}
						const highlight =
							better === "WS"
								? "#e3f2fd"
								: better === "HTTP"
								? "#e8f5e9"
								: undefined;
						return (
							<Paper
								key={r.metric}
								variant='outlined'
								sx={{ p: 1, bgcolor: highlight }}>
								<Stack
									direction='row'
									flexWrap='wrap'
									spacing={1}
									alignItems='center'>
									<Typography variant='subtitle2'>
										{metricLabel[r.metric]}
									</Typography>
									<Chip size='small' label={`WS ${r.ws ?? "—"}`} />
									<Chip size='small' label={`HTTP ${r.http ?? "—"}`} />
									<Chip
										size='small'
										variant='outlined'
										label={`Δ ${r.delta ?? "—"}`}
									/>
									<Chip
										size='small'
										variant='outlined'
										label={`Δ% ${r.pct != null ? r.pct + "%" : "—"}`}
									/>
									<Chip
										size='small'
										color={
											better === "WS"
												? "primary"
												: better === "HTTP"
												? "success"
												: "default"
										}
										label={better}
									/>
								</Stack>
							</Paper>
						);
					})}
				</Stack>
			);
		}
		// Desktop tabela
		return (
			<Box sx={{ overflowX: "auto", mt: 2 }}>
				<table
					style={{
						borderCollapse: "collapse",
						fontSize: 12,
						minWidth: 620,
						width: "100%",
					}}>
					<thead>
						<tr style={{ background: theme.palette.action.hover }}>
							<th style={{ textAlign: "left", padding: 6 }}>Metryka</th>
							<th style={{ textAlign: "right", padding: 6 }}>WS</th>
							<th style={{ textAlign: "right", padding: 6 }}>HTTP</th>
							<th style={{ textAlign: "right", padding: 6 }}>Δ (abs)</th>
							<th style={{ textAlign: "right", padding: 6 }}>Δ %</th>
							<th style={{ textAlign: "left", padding: 6 }}>Lepsze</th>
						</tr>
					</thead>
					<tbody>
						{aggregateRows.map((r, idx) => {
							const dir = betterDirection[r.metric];
							let better: string = "—";
							if (r.ws != null && r.http != null && r.delta != null) {
								if (r.delta === 0) better = "≈";
								else if (dir === "higher") better = r.delta > 0 ? "WS" : "HTTP";
								else better = r.delta < 0 ? "WS" : "HTTP";
							}
							const highlight = r.metric === metric;
							const bg = highlight
								? theme.palette.action.hover
								: idx % 2
								? "rgba(0,0,0,0.02)"
								: undefined;
							return (
								<tr key={r.metric} style={{ background: bg }}>
									<td style={{ padding: 6 }}>{metricLabel[r.metric]}</td>
									<td
										style={{
											padding: 6,
											textAlign: "right",
											fontVariantNumeric: "tabular-nums",
										}}>
										{r.ws != null ? r.ws.toFixed(2) : "—"}
									</td>
									<td
										style={{
											padding: 6,
											textAlign: "right",
											fontVariantNumeric: "tabular-nums",
										}}>
										{r.http != null ? r.http.toFixed(2) : "—"}
									</td>
									<td
										style={{
											padding: 6,
											textAlign: "right",
											fontVariantNumeric: "tabular-nums",
											color:
												better === "WS"
													? theme.palette.primary.main
													: better === "HTTP"
													? theme.palette.success.main
													: undefined,
										}}>
										{r.delta != null ? r.delta.toFixed(2) : "—"}
									</td>
									<td
										style={{
											padding: 6,
											textAlign: "right",
											fontVariantNumeric: "tabular-nums",
										}}>
										{r.pct != null ? r.pct.toFixed(1) + "%" : "—"}
									</td>
									<td style={{ padding: 6 }}>{better}</td>
								</tr>
							);
						})}
					</tbody>
				</table>
				<Typography
					variant='caption'
					color='text.secondary'
					sx={{ mt: 1, display: "block" }}>
					Kolumna „Lepsze” ocenia wprost na podstawie kierunku metryki; Δ% =
					(WS-HTTP)/HTTP*100. Przy kolejnych iteracjach można dodać mediany i
					percentyle.
				</Typography>
			</Box>
		);
	}

	return (
		<Card variant='outlined' sx={{ mt: 2 }}>
			<CardHeader
				title={`Wyniki runu — ${
					viewMode === "timeline"
						? "Oś czasu"
						: viewMode === "summary"
						? "Podsumowanie"
						: "KPI"
				}`}
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
						<Button
							size='small'
							variant='outlined'
							onClick={openPayloadDialog}
							disabled={!timelineReady || !configKey}>
							Szczegóły payloadu
						</Button>
						<ToggleButtonGroup
							value={viewMode}
							exclusive
							size='small'
							onChange={(_, v) => v && setViewMode(v)}
							orientation='horizontal'>
							<ToggleButton value='timeline'>Oś czasu</ToggleButton>
							<ToggleButton value='summary'>Podsumowanie</ToggleButton>
							<ToggleButton value='kpis'>KPI</ToggleButton>
						</ToggleButtonGroup>
					</Stack>
				}
			/>
			<CardContent>
				{flags.realData && (
					<Alert severity='info' sx={{ mb: 2 }}>
						<strong>Tryb Real Data:</strong> pasywny pomiar rzeczywistych
						komunikatów. Payload wyliczany z obserwowanych strumieni (HTTP:
						bytes/rate; WS: bytes/(rate×N klientów)). Jitter dla WS może być
						niższy (push), HTTP zawiera narzut opakowania treści i protokołu.
					</Alert>
				)}

				{/* FILTRY I WYBÓR KONFIGURACJI — na górze */}
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
							<MenuItem value='rate'>Tempo (/s)</MenuItem>
							<MenuItem value='bytesRate'>B/s</MenuItem>
							<MenuItem value='payloadBytes'>Ładunek (B)</MenuItem>
							<MenuItem value='jitterMs'>Jitter (ms)</MenuItem>
							<MenuItem value='freshnessMs'>Wiek danych (ms)</MenuItem>
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
					<Stack direction='row' spacing={1} sx={{ mb: 2 }}>
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

				{/* SEKCJE WIDOKÓW PONIŻEJ FILTRÓW */}
				{viewMode === "summary" && renderSummary()}
				{viewMode === "summary" && <Divider sx={{ my: 2 }} />}
				{viewMode === "kpis" && (
					<KpiSection sessions={sessions} configKey={configKey} />
				)}

				{viewMode === "timeline" &&
					(timelineReady ? (
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
									stroke: {
										width: (() => {
											const hasDelta = timelineSeries.some(s =>
												s.name.startsWith("Δ ")
											);
											const baseCount =
												timelineSeries.length - (hasDelta ? 1 : 0);
											const arr = Array.from({ length: baseCount }, () => 2);
											if (hasDelta) arr.push(1);
											return arr;
										})(),
										curve: "straight",
									},
									xaxis: {
										categories: timelineCategories,
										title: {
											text: "Próbka (tick) – po trimie warmup/cooldown",
										},
									},
									yaxis: { title: { text: metricLabel[metric] } },
									colors: ["#1e88e5", "#2e7d32", "#ff9100"],
									tooltip: {
										shared: true,
										custom: ({ series, dataPointIndex, w }) => {
											type SeriesCfg = { name: string };
											const wsIdx = (w.config.series as SeriesCfg[]).findIndex(
												s => s.name.startsWith("WS ")
											);
											const httpIdx = (
												w.config.series as SeriesCfg[]
											).findIndex(s => s.name.startsWith("HTTP "));
											const deltaIdx = (
												w.config.series as SeriesCfg[]
											).findIndex(s => s.name.startsWith("Δ WS-HTTP"));
											const wsVal =
												wsIdx >= 0 ? series[wsIdx][dataPointIndex] : null;
											const httpVal =
												httpIdx >= 0 ? series[httpIdx][dataPointIndex] : null;
											const deltaVal =
												deltaIdx >= 0 ? series[deltaIdx][dataPointIndex] : null;
											let diffHtml = "";
											if (
												deltaVal != null &&
												wsVal != null &&
												httpVal != null
											) {
												const rel =
													httpVal !== 0
														? ((wsVal - httpVal) / httpVal) * 100
														: 0;
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
								Jak czytać: {metricDesc[metric]} Kierunek lepszy:{" "}
								{betterDirection[metric] === "higher" ? "wyżej" : "niżej"}. Δ =
								WS - HTTP (punktowo). Serie WS/HTTP są uśrednione po repetycjach
								dla każdego ticka (n=WS: {repInfo.ws} / HTTP: {repInfo.http}).
								Oś X to indeks ticka po odcięciu warmup/cooldown.
							</Typography>
							{/* Agregaty (tabela lub karty) */}
							<Typography variant='subtitle2' gutterBottom sx={{ mt: 2 }}>
								Podsumowanie agregatów (średnie po sesjach) – wybrana
								konfiguracja
							</Typography>
							{renderAggregateTable()}
						</Box>
					) : (
						<Typography variant='body2' color='text.secondary'>
							Brak danych timeline.
						</Typography>
					))}
			</CardContent>
			{/* Dialog: Szczegóły payloadu */}
			{payloadOpen && (
				<Box /* portal-free lightweight dialog replacement */
					sx={{
						position: "fixed",
						inset: 0,
						zIndex: 1300,
						backgroundColor: "rgba(0,0,0,0.5)",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
					}}
					onClick={() => setPayloadOpen(false)}>
					<Paper
						elevation={3}
						onClick={e => e.stopPropagation()}
						sx={{
							maxWidth: 980,
							width: "96%",
							maxHeight: "90vh",
							overflow: "auto",
							p: 2,
						}}>
						<Stack
							direction='row'
							alignItems='center'
							justifyContent='space-between'
							sx={{ mb: 1 }}>
							<Typography variant='h6'>Szczegóły payloadu (B)</Typography>
							<Button size='small' onClick={() => setPayloadOpen(false)}>
								Zamknij
							</Button>
						</Stack>
						{configKey && (
							<Typography variant='body2' sx={{ mb: 1 }} color='text.secondary'>
								Konfiguracja: {configKey.replaceAll("|", " | ")}
							</Typography>
						)}
						<Grid container spacing={2}>
							<Grid size={{ xs: 12, md: 6 }}>
								<Paper variant='outlined' sx={{ p: 1.5 }}>
									<Typography variant='subtitle2'>
										Pierwszy payload (po trimie)
									</Typography>
									<Stack
										direction='row'
										spacing={1}
										alignItems='center'
										flexWrap='wrap'
										useFlexGap
										sx={{ mt: 1 }}>
										<Chip
											size='small'
											color='primary'
											label={`WS ${payloadDetails.first?.ws ?? "—"} B${
												payloadDetails.first?.wsTick
													? ` (tick ${payloadDetails.first?.wsTick})`
													: ""
											}`}
										/>
										<Chip
											size='small'
											color='success'
											label={`HTTP ${payloadDetails.first?.http ?? "—"} B${
												payloadDetails.first?.httpTick
													? ` (tick ${payloadDetails.first?.httpTick})`
													: ""
											}`}
										/>
									</Stack>
								</Paper>
							</Grid>
							<Grid size={{ xs: 12, md: 6 }}>
								<Paper variant='outlined' sx={{ p: 1.5 }}>
									<Typography variant='subtitle2'>
										Ostatni payload (po trimie)
									</Typography>
									<Stack
										direction='row'
										spacing={1}
										alignItems='center'
										flexWrap='wrap'
										useFlexGap
										sx={{ mt: 1 }}>
										<Chip
											size='small'
											color='primary'
											label={`WS ${payloadDetails.last?.ws ?? "—"} B${
												payloadDetails.last?.wsTick
													? ` (tick ${payloadDetails.last?.wsTick})`
													: ""
											}`}
										/>
										<Chip
											size='small'
											color='success'
											label={`HTTP ${payloadDetails.last?.http ?? "—"} B${
												payloadDetails.last?.httpTick
													? ` (tick ${payloadDetails.last?.httpTick})`
													: ""
											}`}
										/>
									</Stack>
								</Paper>
							</Grid>
							<Grid size={{ xs: 12 }}>
								<Alert severity='info' sx={{ mt: 1 }}>
									HTTP zwykle ma większy payload (B), bo body zawiera opakowanie{" "}
									{`{ success, data }`} i znakowane (escapowane) JSON w polu{" "}
									<em>data</em>. Uwaga: <strong>Bytes/s (total)</strong> dla
									HTTP obejmuje także narzut nagłówków protokołu (mierzony na
									serwerze), podczas gdy <strong>Śr. B/żądanie</strong> dotyczy
									samego body. Dla WS <strong>Bytes/s (total)</strong> to suma
									ładunków pomnożona przez liczbę klientów;{" "}
									<strong>Śr. B/komunikat</strong> to sam ładunek.
								</Alert>
							</Grid>
							<Grid size={{ xs: 12, md: 6 }}>
								<Typography variant='subtitle2' sx={{ mt: 1 }}>
									Podgląd JSON (WS – bieżący)
								</Typography>
								<Paper
									variant='outlined'
									sx={{
										p: 1,
										fontFamily: "monospace",
										fontSize: 12,
										maxHeight: 280,
										overflow: "auto",
										whiteSpace: "pre",
									}}>
									{payloadDetails.wsJsonPretty || "—"}
								</Paper>
								<Typography variant='caption' color='text.secondary'>
									Rozmiar bieżącego WS JSON: {payloadDetails.wsNowBytes ?? "—"}{" "}
									B
								</Typography>
							</Grid>
							<Grid size={{ xs: 12, md: 6 }}>
								<Typography variant='subtitle2' sx={{ mt: 1 }}>
									Podgląd JSON body (HTTP – bieżący)
								</Typography>
								<Paper
									variant='outlined'
									sx={{
										p: 1,
										fontFamily: "monospace",
										fontSize: 12,
										maxHeight: 280,
										overflow: "auto",
										whiteSpace: "pre",
									}}>
									{payloadDetails.httpJsonPretty || "—"}
								</Paper>
								<Typography variant='caption' color='text.secondary'>
									Rozmiar bieżącego HTTP body:{" "}
									{payloadDetails.httpNowBytes ?? "—"} B
								</Typography>
							</Grid>
						</Grid>
						<Typography
							variant='caption'
							color='text.secondary'
							sx={{ mt: 1, display: "block" }}>
							Uwaga: rzeczywista treść JSON z przebiegu nie jest zapisywana w
							wynikach (persistowane są metryki i rozmiary). Powyżej pokazujemy{" "}
							<strong>pierwszy/ostatni rozmiar (B)</strong> z sesji oraz{" "}
							<strong>bieżący</strong> kształt JSON.
						</Typography>
					</Paper>
				</Box>
			)}
		</Card>
	);
}

// Typy pomocnicze do sekcji KPI (współdzielone)
type KpiTimelineSessionSample = {
	tSec: number;
	rate: number;
	bytesRate: number;
	avgPayloadBytes?: number;
	jitterMs: number;
	freshnessMs: number;
};
type KpiTimelineSession = {
	mode: "ws" | "polling";
	clients?: number;
	hz?: number;
	loadPct?: number;
	payloadBytes?: number;
	samples: KpiTimelineSessionSample[];
};

// Sekcja KPI dla wybranej konfiguracji: 3 wykresy porównawcze WS vs HTTP
function KpiSection({
	sessions,
	configKey,
}: {
	sessions: KpiTimelineSession[] | null;
	configKey: string | null;
}) {
	const [perspective, setPerspective] = useState<"server" | "client">("server");
	if (!sessions || !configKey)
		return (
			<Typography variant='body2' color='text.secondary'>
				Brak danych KPI dla wybranej konfiguracji.
			</Typography>
		);

	const filtered = (sessions || []).filter(s => {
		const key = [
			s.hz ?? "—",
			s.loadPct ?? 0,
			s.clients ?? 0,
			s.payloadBytes ?? "—",
		].join("|");
		return key === configKey;
	});
	if (!filtered.length)
		return (
			<Typography variant='body2' color='text.secondary'>
				Brak dopasowanych sesji dla KPI.
			</Typography>
		);

	// Uśrednij repy dla każdej próbki osobno per protokół
	function avgSeries(metric: keyof KpiTimelineSessionSample) {
		const wsGroups = filtered.filter(s => s.mode === "ws").map(s => s.samples);
		const httpGroups = filtered
			.filter(s => s.mode === "polling")
			.map(s => s.samples);
		const maxLen = Math.max(
			wsGroups.reduce((m, a) => Math.max(m, a.length), 0),
			httpGroups.reduce((m, a) => Math.max(m, a.length), 0)
		);
		const avgFor = (
			groups: KpiTimelineSessionSample[][]
		): (number | null)[] => {
			const out: (number | null)[] = [];
			for (let i = 0; i < maxLen; i++) {
				const bucket = groups
					.map(g => g[i])
					.filter(Boolean) as KpiTimelineSessionSample[];
				if (!bucket.length) {
					out.push(null);
					continue;
				}
				if (metric === "avgPayloadBytes") {
					// payload: preferuj bezpośrednie avgPayloadBytes; jeśli brak, policz z bytesRate/rate
					const vals: number[] = [];
					for (const b of bucket) {
						let v: number | undefined = b.avgPayloadBytes;
						if (!(Number.isFinite(v) && (v as number) > 0)) {
							if (b.rate > 0) v = b.bytesRate / b.rate;
						}
						if (Number.isFinite(v)) vals.push(v as number);
					}
					out.push(
						vals.length
							? Number(
									(vals.reduce((a, c) => a + c, 0) / vals.length).toFixed(2)
							  )
							: null
					);
				} else {
					const vals = bucket
						.map(b => b[metric] as number | undefined)
						.filter(v => v != null && Number.isFinite(v)) as number[];
					out.push(
						vals.length
							? Number(
									(vals.reduce((a, c) => a + c, 0) / vals.length).toFixed(2)
							  )
							: null
					);
				}
			}
			return out;
		};
		return { ws: avgFor(wsGroups), http: avgFor(httpGroups) };
	}

	const rate = avgSeries("rate");
	// Koszt sieci total B/s (serwer) i per klient (klient)
	const bytes = avgSeries("bytesRate");
	// Avg payload: osobno liczymy dla WS (dzielenie przez liczbę klientów)
	const avgPayloadFor = (
		groups: KpiTimelineSession[],
		isWs: boolean
	): (number | null)[] => {
		const arr = groups.map(s => s.samples);
		const maxLen = arr.reduce((m, a) => Math.max(m, a.length), 0);
		const out: (number | null)[] = [];
		for (let i = 0; i < maxLen; i++) {
			const bucket = arr
				.map(g => g[i])
				.filter(Boolean) as KpiTimelineSessionSample[];
			if (!bucket.length) {
				out.push(null);
				continue;
			}
			const vals: number[] = [];
			for (let bi = 0; bi < bucket.length; bi++) {
				const b = bucket[bi];
				let v: number | undefined = b.avgPayloadBytes;
				if (!(Number.isFinite(v) && (v as number) > 0)) {
					if (b.rate > 0) v = b.bytesRate / b.rate;
				}
				if (Number.isFinite(v)) vals.push(v as number);
			}
			// Jeśli WS – skoryguj o liczbę klientów (średnia po sesjach z własnym N)
			if (isWs) {
				// znajdź średnie N klientów dla próbki i
				const clientsVals = groups
					.map(s => (s.samples[i] ? s.clients || 0 : null))
					.filter((v): v is number => v != null);
				const avgClients = clientsVals.length
					? clientsVals.reduce((a, c) => a + c, 0) / clientsVals.length
					: 0;
				out.push(
					vals.length
						? Number(
								(
									vals.reduce((a, c) => a + c, 0) /
									vals.length /
									(avgClients || 1)
								).toFixed(2)
						  )
						: null
				);
			} else {
				out.push(
					vals.length
						? Number((vals.reduce((a, c) => a + c, 0) / vals.length).toFixed(2))
						: null
				);
			}
		}
		return out;
	};
	const payload = {
		ws: avgPayloadFor(
			filtered.filter(s => s.mode === "ws"),
			true
		),
		http: avgPayloadFor(
			filtered.filter(s => s.mode === "polling"),
			false
		),
	};
	// Stabilność
	const jitter = avgSeries("jitterMs");
	const fresh = avgSeries("freshnessMs");

	// Wyrównaj długości do wspólnego minimum dla porównań na wykresach
	const minLen = Math.min(
		rate.ws.length,
		rate.http.length,
		bytes.ws.length,
		bytes.http.length,
		payload.ws.length,
		payload.http.length,
		jitter.ws.length,
		jitter.http.length,
		fresh.ws.length,
		fresh.http.length
	);
	const categories = Array.from({ length: minLen }, (_, i) => i + 1);
	function align(pair: { ws: (number | null)[]; http: (number | null)[] }) {
		return { ws: pair.ws.slice(0, minLen), http: pair.http.slice(0, minLen) };
	}
	const rateA = align(rate);
	const bytesA = align(bytes);
	const payloadA = align(payload);
	const jitterA = align(jitter);
	const freshA = align(fresh);

	// Przekształcenia wg perspektywy:
	// - server: pokazujemy total WS B/s (sumaryczny egress = bytesRate) oraz HTTP total B/s; rate pozostaje bez zmian
	// - client: normalizujemy do per‑client: HTTP => total/N, WS => rate i payload bez zmian, ale B/s per‑client = rate × payload
	function toClientPerspective() {
		// Pobierz średnią liczbę klientów dla wybranej konfiguracji (z sesji)
		const httpN = (() => {
			const vals = (sessions || [])
				.filter(s => s.mode === "polling")
				.filter(s => {
					const key = [
						s.hz ?? "—",
						s.loadPct ?? 0,
						s.clients ?? 0,
						s.payloadBytes ?? "—",
					].join("|");
					return key === configKey;
				})
				.map(s => s.clients || 0);
			return vals.length ? vals.reduce((a, c) => a + c, 0) / vals.length : 0;
		})();
		// Rate: HTTP per‑client = rate / N; WS per‑client = rate (broadcast)
		const rateCli = {
			ws: rateA.ws, // identyczne
			http: rateA.http.map(v =>
				v != null && httpN > 0 ? Number((v / httpN).toFixed(2)) : v
			),
		};
		// Bytes/s: HTTP per‑client = bytes/N; WS per‑client = rate × payload
		const bytesCli = {
			ws: payloadA.ws.map((p, i) => {
				const r = rateA.ws[i];
				if (p != null && r != null) return Number((p * r).toFixed(2));
				return null;
			}),
			http: bytesA.http.map(v =>
				v != null && httpN > 0 ? Number((v / httpN).toFixed(2)) : v
			),
		};
		return { rateCli, bytesCli };
	}
	const clientView = toClientPerspective();

	return (
		<Box sx={{ mb: 2 }}>
			<Stack direction='row' spacing={1} sx={{ mb: 1 }}>
				<ToggleButtonGroup
					size='small'
					exclusive
					value={perspective}
					onChange={(_, v) => v && setPerspective(v)}>
					<ToggleButton value='server'>Perspektywa: Serwer</ToggleButton>
					<ToggleButton value='client'>Perspektywa: Klient</ToggleButton>
				</ToggleButtonGroup>
				<Typography variant='caption' color='text.secondary'>
					Serwer: total B/s (HTTP zawiera nagłówki), WS total = ładunek×N.
					Klient: per‑client B/s (HTTP ÷ N; WS = rate×payload), rate/cli (HTTP ÷
					N; WS = rate).
				</Typography>
			</Stack>
			<Grid container spacing={2}>
				<Grid size={{ xs: 12, md: 6 }}>
					<Paper sx={{ p: 2 }}>
						<Typography variant='subtitle2'>
							Tempo ({perspective === "client" ? "per klient" : "całkowite"})
						</Typography>
						<ApexChart
							type='line'
							height={260}
							series={[
								{
									name: "WS komunikaty/s",
									data:
										perspective === "client" ? clientView.rateCli.ws : rateA.ws,
								},
								{
									name: "HTTP żądania/s",
									data:
										perspective === "client"
											? clientView.rateCli.http
											: rateA.http,
								},
							]}
							options={{
								chart: { animations: { enabled: false } },
								xaxis: { categories },
								yaxis: {
									title: {
										text:
											perspective === "client"
												? "/s (na klienta)"
												: "/s (łącznie)",
									},
								},
								stroke: { width: 2 },
								legend: { position: "top" },
							}}
						/>
						<Typography
							variant='caption'
							color='text.secondary'
							sx={{ display: "block", mt: 1 }}>
							Jak czytać: płaska linia = stabilne tempo. W perspektywie Klient
							HTTP dzielimy przez N, WS zostaje bez zmian (broadcast). Porównuj
							poziomy i ich stabilność.
						</Typography>
					</Paper>
				</Grid>
				<Grid size={{ xs: 12, md: 6 }}>
					<Paper sx={{ p: 2 }}>
						<Typography variant='subtitle2'>
							Koszt sieci i payload (
							{perspective === "client" ? "per klient" : "całkowite"})
						</Typography>
						<ApexChart
							type='line'
							height={260}
							series={[
								{
									name:
										perspective === "client"
											? "WS B/s (per klient)"
											: "WS B/s (total)",
									data:
										perspective === "client"
											? clientView.bytesCli.ws
											: bytesA.ws,
								},
								{
									name:
										perspective === "client"
											? "HTTP B/s (per klient)"
											: "HTTP B/s (total)",
									data:
										perspective === "client"
											? clientView.bytesCli.http
											: bytesA.http,
								},
								{ name: "WS Śr. B/komunikat", data: payloadA.ws },
								{ name: "HTTP Śr. B/żądanie", data: payloadA.http },
							]}
							options={{
								chart: { animations: { enabled: false } },
								xaxis: { categories },
								yaxis: [
									{
										title: {
											text:
												perspective === "client"
													? "B/s (per klient)"
													: "B/s (total)",
										},
									},
									{ opposite: true, title: { text: "Śr. B" } },
								],
								stroke: { width: [2, 2, 1, 1] },
								legend: { position: "top" },
								tooltip: { shared: true },
							}}
						/>
						<Typography
							variant='caption'
							color='text.secondary'
							sx={{ display: "block", mt: 1 }}>
							Jak czytać: linie B/s pokazują koszt sieci. HTTP (total) obejmuje
							nagłówki; w Klient dzielimy przez N. Linia avg B/* to rozmiar
							ładunku bez narzutu protokołu – mniejsza wartość przy tym samym
							tempie = większa efektywność.
						</Typography>
					</Paper>
				</Grid>
				<Grid size={{ xs: 12 }}>
					<Paper sx={{ p: 2 }}>
						<Typography variant='subtitle2'>
							Stabilność: jitter i świeżość
						</Typography>
						<ApexChart
							type='line'
							height={260}
							series={[
								{ name: "WS jitter (ms)", data: jitterA.ws },
								{ name: "HTTP jitter (ms)", data: jitterA.http },
								{ name: "WS wiek danych (ms)", data: freshA.ws },
								{ name: "HTTP wiek danych (ms)", data: freshA.http },
							]}
							options={{
								chart: { animations: { enabled: false } },
								xaxis: { categories },
								yaxis: { title: { text: "ms" } },
								stroke: { width: [2, 2, 1, 1] },
								legend: { position: "top" },
								tooltip: { shared: true },
							}}
						/>
						<Typography
							variant='caption'
							color='text.secondary'
							sx={{ display: "block", mt: 1 }}>
							Jak czytać: niższy jitter = bardziej regularne odstępy; niższa
							świeżość (staleness) = nowsze dane u odbiorcy. Stabilne, niskie
							przebiegi świadczą o lepszej jakości dostarczania.
						</Typography>
					</Paper>
				</Grid>
			</Grid>
		</Box>
	);
}
