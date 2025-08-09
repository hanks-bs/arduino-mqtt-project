"use client";

import { FormControl, InputLabel, MenuItem, Select } from "@mui/material";

interface ModeSelectorProps {
	mode: "ws" | "polling";
	onChange: (mode: "ws" | "polling") => void;
}

/**
 * ModeSelector pozwala wybrać tryb: WebSocket lub HTTP Polling.
 */
export default function ModeSelector({ mode, onChange }: ModeSelectorProps) {
	return (
		<FormControl fullWidth>
			<InputLabel id='mode-label'>Tryb pobierania</InputLabel>
			<Select
				labelId='mode-label'
				value={mode}
				label='Tryb pobierania'
				onChange={e => onChange(e.target.value as "ws" | "polling")}>
				<MenuItem value='ws'>WebSocket</MenuItem>
				<MenuItem value='polling'>HTTP Polling</MenuItem>
			</Select>
		</FormControl>
	);
}
