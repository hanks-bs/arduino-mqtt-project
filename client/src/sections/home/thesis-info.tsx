"use client";

import { Box, Paper, Typography } from "@mui/material";

interface ThesisInfoProps {
	/** Title of the diploma thesis */
	title: string;
	/** Author’s full name */
	author: string;
	/** Supervisor’s full name */
	supervisor: string;
	/** Year or academic year */
	year: string;
}

/**
 * Displays basic information about the diploma project.
 */
export default function ThesisInfo({
	title,
	author,
	supervisor,
	year,
}: ThesisInfoProps) {
	return (
		<Paper elevation={2} sx={{ p: 2 }}>
			<Box>
				<Box
					component='img'
					src={"/logo-wieik.svg"}
					alt='Logo wydziału'
					sx={{ height: 72, mb: 2 }}
				/>

				<Typography>
					<strong>Tytuł:</strong> {title}
				</Typography>
				<Typography>
					<strong>Autor:</strong> {author}
				</Typography>
				<Typography>
					<strong>Promotor:</strong> {supervisor}
				</Typography>
				<Typography>
					<strong>Rok akademicki:</strong> {year}
				</Typography>
			</Box>
		</Paper>
	);
}
