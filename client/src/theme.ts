"use client";
import { createTheme } from "@mui/material/styles";
import { Public_Sans } from "next/font/google";

const publicSans = Public_Sans({
	weight: ["300", "400", "500", "700"],
	subsets: ["latin"],
	display: "swap",
});

const theme = createTheme({
	colorSchemes: { light: true, dark: true },
	cssVariables: {
		colorSchemeSelector: "class",
	},
	typography: {
		fontFamily: publicSans.style.fontFamily,
	},
	components: {},
});

export default theme;
