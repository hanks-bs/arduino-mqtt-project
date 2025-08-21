"use client";

import { Alert, Box, Divider, List, ListItem, Typography } from "@mui/material";

export default function ResearchGuide() {
	return (
		<Box
			sx={{
				p: 2,
				border: theme => `1px solid ${theme.palette.divider}`,
				borderRadius: 2,
				bgcolor: "background.paper",
			}}>
			<Typography variant='h6' gutterBottom>
				Przewodnik badań (dashboard)
			</Typography>
			<Typography variant='subtitle2' gutterBottom>
				Co przedstawia ten klient?
			</Typography>
			<Typography variant='body2' paragraph>
				Dashboard wizualizuje w czasie rzeczywistym strumień danych z Arduino
				(ostatnie pomiary) oraz kluczowe metryki infrastrukturalne po stronie
				API:
				<strong> CPU% </strong>, <strong>pamięć (RSS)</strong>,
				<strong> ELU / opóźnienie pętli zdarzeń</strong>,
				<strong> tempo zdarzeń (Rate)</strong>, <strong>przepływ bajtów</strong>
				,<strong> wielkość ładunku</strong>, <strong>jitter</strong> i
				<strong> staleness (wiek danych)</strong>. Służy jako narzędzie
				obserwacyjne do jakościowej (na żywo) i wstępnej ilościowej oceny różnic
				między strategią <em>push (WebSocket)</em> oraz{" "}
				<em>pull (HTTP Polling)</em>.
			</Typography>
			<Typography variant='subtitle2' gutterBottom>
				Metryki (skrót):
			</Typography>
			<List dense sx={{ pl: 3 }}>
				<ListItem>CPU% / RSS – koszt zasobów procesu API.</ListItem>
				<ListItem>
					ELU / p99 loop delay – presja na pętlę zdarzeń (responsywność).
				</ListItem>
				<ListItem>Rate (msg/s lub req/s) – tempo dostarczania danych.</ListItem>
				<ListItem>
					Bytes/s & Payload – narzut transferu i średni rozmiar ładunku.
				</ListItem>
				<ListItem>
					Jitter – stabilność odstępów między kolejnymi danymi.
				</ListItem>
				<ListItem>
					Staleness – świeżość danych (opóźnienie źródło → UI).
				</ListItem>
			</List>
			<Divider sx={{ my: 2 }} />
			<Typography variant='subtitle2' gutterBottom>
				Jak przeprowadzić badanie (skrót do pracy magisterskiej)
			</Typography>
			<List dense sx={{ pl: 3 }}>
				<ListItem>
					<strong>1. Warunki bazowe:</strong>&nbsp;Ustabilizuj źródło danych
					(Arduino / generator); zamknij inne obciążające procesy.
				</ListItem>
				<ListItem>
					<strong>2. Tryb:</strong>&nbsp;Wybierz WebSocket lub Polling (ustaw
					interwał). Odczekaj kilka sekund aż metryki się ustabilizują.
				</ListItem>
				<ListItem>
					<strong>3. Obserwacja:</strong>&nbsp;Odczytaj średnie / typowe
					wartości CPU, Rate, Bytes/s, Jitter, Staleness. Zanotuj (arkusz /
					notatki).
				</ListItem>
				<ListItem>
					<strong>4. Zmiana strategii:</strong>&nbsp;Przełącz na drugi tryb
					(push ↔ pull) zachowując porównywalny Rate (Hz lub interwał) i powtórz
					notatki.
				</ListItem>
				<ListItem>
					<strong>5. Wariacje:</strong>&nbsp;Powtórz dla innego interwału
					(niższy ms w Polling lub zmieniona częstotliwość ws drivera) oraz –
					jeśli chcesz – z obciążeniem CPU (skrypt po stronie API) albo większą
					liczbą klientów (symulacja po stronie API).
				</ListItem>
				<ListItem>
					<strong>6. Wnioski:</strong>&nbsp;Porównaj pary wyników (WS vs HTTP)
					pod kątem: staleness (niżej lepiej), jitter (niżej), CPU/Bytes/s
					(niżej), Rate/świeżość (wyżej / szybciej) – zidentyfikuj przewagi i
					kompromisy.
				</ListItem>
			</List>
			<Typography variant='body2' paragraph sx={{ mt: 1 }}>
				Pełne, zautomatyzowane przebiegi (macierze scenariuszy, powtórzenia,
				CI95) uruchamiane są skryptami w warstwie API (patrz dokument
				<code>docs/ASPEKT_BADAWCZY.md</code>). Ten panel służy do szybkiej,
				wizualnej inspekcji i ręcznego pozyskiwania przykładowych punktów
				danych.
			</Typography>
			<Alert severity='info' sx={{ mt: 2 }}>
				Automatyczne runy (presety i konfiguracja własna) możesz teraz
				uruchamiać bezpośrednio z panelu poniżej (
				<strong>Automatyczne runy badawcze</strong>). Wyniki i logi generowane
				są po stronie API (patrz katalog <code>api/benchmarks</code>). Szczegóły
				scenariuszy i metodologii: <code>docs/ASPEKT_BADAWCZY.md</code>.
			</Alert>
		</Box>
	);
}
