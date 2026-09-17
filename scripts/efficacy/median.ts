export function median(values: number[]): number {
	if (!values.length || values.some((value) => !Number.isFinite(value)))
		throw new Error("Median requires a nonempty list of finite numbers.");
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
