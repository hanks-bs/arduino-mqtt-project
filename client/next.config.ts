import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	output: "standalone",
	modularizeImports: {
		lodash: { transform: "lodash/{{member}}" },
		"@mui/icons-material": { transform: "@mui/icons-material/{{member}}" },
		"@mui/material": { transform: "@mui/material/{{member}}" },
		"@mui/lab": { transform: "@mui/lab/{{member}}" },
	},
};

export default nextConfig;
