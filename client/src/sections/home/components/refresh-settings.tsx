// components/RefreshSettings.tsx
"use client";

import {
	Box,
	FormControlLabel,
	Slider,
	Switch,
	Typography,
} from "@mui/material";

interface RefreshSettingsProps {
	interval: number;
	onIntervalChange: (value: number) => void;
	auto: boolean;
	onAutoChange: (value: boolean) => void;
	onManualRefresh: () => void;
}

/**
 * Pozwala ustawić interwał (w sekundach), tryb auto/manual
 * oraz ręczne odświeżenie.
 */
export default function RefreshSettings({
	interval,
	onIntervalChange,
	auto,
	onAutoChange,
	onManualRefresh,
}: RefreshSettingsProps) {
	return (
		<Box my={3}>
			<Typography gutterBottom>Interwał odświeżania: {interval}s</Typography>
			<Slider
				aria-label='Interwał odświeżania w sekundach'
				getAriaValueText={v => `${v} sekund`}
				aria-valuetext={`${interval} sekund`}
				value={interval}
				min={1}
				max={30}
				step={1}
				marks
				valueLabelDisplay='auto'
				onChange={(_, v) => onIntervalChange(v as number)}
			/>
			<FormControlLabel
				control={
					<Switch
						checked={auto}
						onChange={(_, checked) => onAutoChange(checked)}
					/>
				}
				label={auto ? "Automatyczne" : "Ręczne"}
			/>
			{!auto && (
				<Box mt={2}>
					<Typography
						variant='button'
						onClick={onManualRefresh}
						sx={{ cursor: "pointer", color: "primary.main" }}>
						Odśwież teraz
					</Typography>
				</Box>
			)}
		</Box>
	);
}
