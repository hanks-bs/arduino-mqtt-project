import { toNumber, toNumberFixed } from "./num";

// Prosty split CSV wspierający cudzysłowy
export function splitCsvLine(line: string): string[] {
	const out: string[] = [];
	let cur = "";
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"') {
			if (inQuotes && line[i + 1] === '"') {
				cur += '"';
				i++;
			} else {
				inQuotes = !inQuotes;
			}
		} else if (ch === "," && !inQuotes) {
			out.push(cur);
			cur = "";
		} else {
			cur += ch;
		}
	}
	out.push(cur);
	return out.map(s => s.trim().replace(/^"(.*)"$/, "$1"));
}

export function parseResearchTimelineCsv(csv: string) {
	const lines = csv.trim().split(/\r?\n/);
	if (!lines.length)
		return {
			categories: [] as number[],
			series: [] as Array<{ name: string; data: (number | null)[] }>,
		};
	const header = splitCsvLine(lines[0]);
	const idxCategory = header.findIndex(h => h.toLowerCase() === "category");
	const seriesNames = header.filter((_, i) => i !== idxCategory);
	const seriesData: (number | null)[][] = seriesNames.map(() => []);
	const categories: number[] = [];
	for (let i = 1; i < lines.length; i++) {
		const cols = splitCsvLine(lines[i]);
		if (!cols.length) continue;
		const cat = toNumber(cols[idxCategory]);
		if (cat != null) categories.push(cat);
		seriesNames.forEach((_, si) => {
			const val = toNumberFixed(cols[si < idxCategory ? si : si + 1], 2);
			seriesData[si].push(val);
		});
	}
	return {
		categories,
		series: seriesNames.map((name, i) => ({ name, data: seriesData[i] })),
	};
}

export { toNumber, toNumberFixed } from "./num";
