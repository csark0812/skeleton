export function refundCents(amountCents: number, fraction: number): number {
	return Math.floor(amountCents * fraction);
}
