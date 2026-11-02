export function formatOrderLabel(orderId: string): string {
	const s = orderId.trim().toUpperCase();
	return `ORDER-${s}`;
}
