"use client";

import type { Measurement } from "@/types";
import { Box, Card, CardContent, Grid, Typography } from "@mui/material";

interface CurrentResultsProps {
	/** Latest single measurement from Arduino */
	last: Measurement;
}

/**
 * Displays the latest Arduino measurement in a grid of cards.
 */
export default function CurrentResults({ last }: CurrentResultsProps) {
	// convert potentiometer to percentage
	const potPct = ((last.potValue / 1023) * 100).toFixed(2);

	return (
		<Box>
			<Typography variant='h6' gutterBottom>
				Aktualne wyniki
			</Typography>
			<Grid container spacing={2}>
				{/* Temperature */}
				<Grid size={{ xs: 6, sm: 4, md: 3 }}>
					<Card>
						<CardContent>
							<Typography variant='subtitle2' color='textSecondary'>
								Temperatura
							</Typography>
							<Typography variant='h5'>
								{last.temperature.toFixed(2)}°C
							</Typography>
						</CardContent>
					</Card>
				</Grid>
				{/* Potentiometer */}
				<Grid size={{ xs: 6, sm: 4, md: 3 }}>
					<Card>
						<CardContent>
							<Typography variant='subtitle2' color='textSecondary'>
								Potencjometr
							</Typography>
							<Typography variant='h5'>{potPct}%</Typography>
						</CardContent>
					</Card>
				</Grid>
				{/* Uptime */}
				<Grid size={{ xs: 6, sm: 4, md: 3 }}>
					<Card>
						<CardContent>
							<Typography variant='subtitle2' color='textSecondary'>
								Czas pracy
							</Typography>
							<Typography variant='h5'>{last.uptimeSec}s</Typography>
						</CardContent>
					</Card>
				</Grid>
				{/* Reading count */}
				<Grid size={{ xs: 6, sm: 4, md: 3 }}>
					<Card>
						<CardContent>
							<Typography variant='subtitle2' color='textSecondary'>
								Liczba odczytów
							</Typography>
							<Typography variant='h5'>{last.readingCount}</Typography>
						</CardContent>
					</Card>
				</Grid>
			</Grid>
		</Box>
	);
}
