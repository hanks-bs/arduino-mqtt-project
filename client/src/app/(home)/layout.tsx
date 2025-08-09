import Header from "@/sections/home/header";
import { Container } from "@mui/material";
import { Metadata } from "next";
import { type ReactNode } from "react";

export const metadata: Metadata = {
	title: "Strona Dyplomowa",
};

/**
 * Layout wraps Header and page content in Grid container.
 */
export default function Layout({ children }: { children: ReactNode }) {
	return (
		<>
			<Header />
			<Container sx={{ mt: 4 }}>{children}</Container>
		</>
	);
}
