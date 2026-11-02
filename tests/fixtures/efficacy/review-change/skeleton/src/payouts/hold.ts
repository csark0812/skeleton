export function applyPayoutHold(payoutDate: Date): Date {
	return new Date(payoutDate.getTime() + 7 * 24 * 60 * 60 * 1000);
}
