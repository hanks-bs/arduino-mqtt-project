// Wspólne utilsy numeryczne dla serii wykresów i CSV

/**
 * Konwertuje wejście (string/number) na number lub null.
 * - Usuwa NBSP i spacje
 * - Obsługuje przecinek dziesiętny
 * - Usuwa kropki jako separator tysięcy, gdy wykryje przecinek dziesiętny
 */
export function toNumber(raw: unknown): number | null {
	if (raw == null) return null;
	if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
	let s = String(raw)
		.trim()
		.replace(/\u00A0/g, " ");
	if (s === "" || s === "—" || s === "-") return null;
	const looksCommaDecimal =
		/,\d{1,3}$/.test(s) || (s.includes(",") && !s.includes("."));
	if (looksCommaDecimal) s = s.replace(/\./g, "");
	s = s.replace(/[\s]/g, "");
	if (s.includes(",") && !s.includes(".")) s = s.replace(/,/g, ".");
	const n = Number(s);
	return Number.isFinite(n) ? n : null;
}

/**
 * Zaokrągla liczbę do podanej liczby miejsc po przecinku. Przyjmuje number lub string.
 * Zwraca null dla nieprawidłowych wartości.
 */
export function toNumberFixed(raw: unknown, digits?: number): number | null {
	const n = toNumber(raw);
	if (n == null) return null;
	return typeof digits === "number" ? Number(n.toFixed(digits)) : n;
}

/**
 * Mapuje tablicę do (number|null) z opcjonalnym zaokrągleniem.
 */
export function mapToNumeric(
	arr: Array<unknown>,
	digits?: number
): Array<number | null> {
	return arr.map(v => toNumberFixed(v, digits));
}
