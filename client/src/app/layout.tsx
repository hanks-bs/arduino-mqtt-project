import theme from "@/theme";
import { SocketIOProvider } from "@/websocket/providers/websocket-provider";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import CssBaseline from "@mui/material/CssBaseline";
import InitColorSchemeScript from "@mui/material/InitColorSchemeScript";
import { ThemeProvider } from "@mui/material/styles";
import { Metadata } from "next";
import * as React from "react";

export const metadata: Metadata = {
	icons: [
		{
			rel: "icon",
			url: `/favicon.ico`,
		},
	],
};

export default function RootLayout(props: { children: React.ReactNode }) {
	return (
		<html lang='en' suppressHydrationWarning>
			<body>
				<InitColorSchemeScript attribute='class' />
				<AppRouterCacheProvider options={{ enableCssLayer: true }}>
					<SocketIOProvider>
						<ThemeProvider theme={theme}>
							<CssBaseline />

							{props.children}
						</ThemeProvider>
					</SocketIOProvider>
				</AppRouterCacheProvider>
			</body>
		</html>
	);
}
