import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	output: "standalone",
	modularizeImports: {
		lodash: { transform: "lodash/{{member}}" },
		"@mui/icons-material": { transform: "@mui/icons-material/{{member}}" },
		"@mui/material": { transform: "@mui/material/{{member}}" },
		"@mui/lab": { transform: "@mui/lab/{{member}}" },
	},
	turbo: {
		rules: {
			"*.svg": { loaders: ["@svgr/webpack"], as: "*.js" },
		},
	},
};

export default nextConfig;
