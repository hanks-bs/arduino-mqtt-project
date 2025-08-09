"use client";

import { Box, Typography } from "@mui/material";

interface ConnectionStatusProps {
	connected: boolean;
}

/**
 * Wyświetla ikonę i tekst zależnie od stanu połączenia.
 */
export default function ConnectionStatus({ connected }: ConnectionStatusProps) {
	return (
		<Box my={2} role='status' aria-live='polite'>
			<Typography component='span'>
				Status Socket.IO:{" "}
				<Box component='span' fontWeight='bold'>
					{connected ? "🟢 Połączono" : "🔴 Rozłączono"}
				</Box>
			</Typography>
		</Box>
	);
}
