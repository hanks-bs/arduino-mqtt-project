"use client";

import { Alert, Box, List, ListItem, Typography } from "@mui/material";

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
				Przewodnik aspektu badawczego
			</Typography>
			<Typography variant='body2' paragraph>
				Ten moduł pozwala porównać efektywność <strong>WebSocket (push)</strong>{" "}
				oraz <strong>HTTP Polling</strong> w kontekście zużycia zasobów i
				opóźnień. Postępuj zgodnie z krokami poniżej, aby uzyskać powtarzalne
				wyniki i móc wyciągnąć wnioski do części badawczej pracy magisterskiej.
			</Typography>
			<List dense>
				<ListItem>
					<strong>Krok 1.</strong>&nbsp;Ustal stabilne źródło danych (Arduino
					generuje podobne wielkości) – unikaj gwałtownych zmian.
				</ListItem>
				<ListItem>
					<strong>Krok 2.</strong>&nbsp;Wybierz tryb odbioru (WebSocket lub
					Polling) – sekcja „Tryb danych”. Dla Polling ustaw interwał.
				</ListItem>
				<ListItem>
					<strong>Krok 3.</strong>&nbsp;W sekcji „Sesje pomiarowe” skonfiguruj
					parametry (liczba próbek lub czas trwania) i uruchom sesję – prowadź
					testy <em>sekwencyjnie</em>.
				</ListItem>
				<ListItem>
					<strong>Krok 4.</strong>&nbsp;Po zakończeniu sesji dodaj test dla
					drugiego trybu z identycznymi parametrami częstotliwości.
				</ListItem>
				<ListItem>
					<strong>Krok 5.</strong>&nbsp;Zaznacz sesje do porównania – pojawi się
					tabela statystyk i wskaźników pochodnych.
				</ListItem>
				<ListItem>
					<strong>Krok 6.</strong>&nbsp;Wyeksportuj dane (JSON) do dalszej
					analizy (Python / R).
				</ListItem>
			</List>
			<Alert severity='info' sx={{ mt: 2 }}>
				Rekomendacja: przed serią pomiarów zresetuj sesje i zadbaj o brak innych
				obciążających procesów systemowych.
			</Alert>
		</Box>
	);
}
