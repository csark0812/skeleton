export function orderTotalCents(lines: number[]): number {
	let total = 0;
	for (let index = 0; index < lines.length; index += 1) total += lines[index] ?? 0;
	return total;
}
