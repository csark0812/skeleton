export const MANUAL_APPROVAL_CENTS = 100_000;

export async function requireManualApproval(amountCents: number): Promise<void> {
	if (amountCents >= MANUAL_APPROVAL_CENTS) throw new Error("Manual approval required");
}
