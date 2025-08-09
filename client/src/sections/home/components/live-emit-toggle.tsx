"use client";

import { FormControlLabel, Switch, Tooltip } from "@mui/material";
import { useCallback, useEffect, useState, type ChangeEvent } from "react";

/**
 * LiveEmitToggle — przełącznik włącz/wyłącz emisje WS po stronie API.
 * Działa przez endpointy:
 *  GET  http://localhost:5000/api/monitor/live-emit -> { success, data: { enabled } }
 *  POST http://localhost:5000/api/monitor/live-emit { enabled }
 */
export default function LiveEmitToggle() {
	const [enabled, setEnabled] = useState<boolean | null>(null);
	const [loading, setLoading] = useState(false);
	const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:5000";

	const fetchStatus = useCallback(async () => {
		try {
			const res = await fetch(`${API_BASE}/api/monitor/live-emit`);
			const json = await res.json();
			if (json?.success && typeof json?.data?.enabled === "boolean") {
				setEnabled(json.data.enabled);
			}
		} catch {
			// ignore
		}
	}, [API_BASE]);

	useEffect(() => {
		fetchStatus();
	}, [fetchStatus]);

	const onToggle = async (
		_evt: ChangeEvent<HTMLInputElement>,
		checked: boolean
	) => {
		setLoading(true);
		try {
			const res = await fetch(`${API_BASE}/api/monitor/live-emit`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ enabled: checked }),
			});
			const json = await res.json();
			if (json?.success) {
				setEnabled(checked);
			}
		} catch {
			// ignore
		} finally {
			setLoading(false);
		}
	};

	return (
		<Tooltip title='Włącza/wyłącza emisję danych przez WebSocket (zmniejsza narzut w testach)'>
			<span>
				<FormControlLabel
					control={
						<Switch
							color='primary'
							checked={!!enabled}
							onChange={onToggle}
							disabled={enabled === null || loading}
						/>
					}
					label={`Emisja WS: ${enabled ? "włączona" : "wyłączona"}`}
				/>
			</span>
		</Tooltip>
	);
}
