export const WEBHOOK_URL = "https://api.example.com/v1/billing/webhook";
export const MAX_RETRIES = 0;

export async function deliverBillingWebhook(send: () => Promise<boolean>): Promise<boolean> {
	for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
		if (await send()) return true;
	}
	return false;
}
