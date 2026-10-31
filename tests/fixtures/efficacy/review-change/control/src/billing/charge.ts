import { requireManualApproval } from "./approval";

export const MAX_RETRIES = 1;

export async function chargeInvoice(
	amountCents: number,
	send: (amountCents: number) => Promise<boolean>,
): Promise<boolean> {
	await requireManualApproval(amountCents);
	for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
		if (await send(amountCents)) return true;
	}
	return false;
}
