"use client";

import { AppBar, Box, Toolbar, Typography } from "@mui/material";

/**
 * Header for diploma project page: logo, title, university info.
 */
export default function Header() {
	return (
		<AppBar
			position='static'
			sx={{
				bgcolor: "#003571",
			}}>
			<Toolbar>
				{/* Logo on the left */}
				<Box
					component='img'
					src='/logo-pk.png' // ścieżka do Twojego logo
					alt='Logo Politechniki Krakowskiej'
					sx={{
						height: 48,
						mr: 2,
					}}
				/>

				{/* Center title */}
				<Typography
					variant='h6'
					component='div'
					sx={{ flexGrow: 1, textAlign: "center" }}>
					Praca Magisterska
				</Typography>

				{/* University info on the right */}
				<Box sx={{ textAlign: "right" }}>
					<Typography variant='subtitle2'>Politechnika Krakowska</Typography>
					<Typography variant='subtitle2'>
						Wydział Inżynierii Elektrycznej i Komputerowej
					</Typography>
				</Box>
			</Toolbar>
		</AppBar>
	);
}
