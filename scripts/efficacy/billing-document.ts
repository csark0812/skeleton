const CURRENT_ENDPOINT = "https://api.example.com/v2/billing/webhook";
const STALE_ENDPOINT = "https://api.example.com/v1/billing/webhook";

export function checkBillingDocument(document: string) {
	const normalized = document.toLowerCase().replace(/\s+/g, " ");
	return {
		documentAvailable: document.length > 0,
		currentEndpoint: document.includes(CURRENT_ENDPOINT),
		retryPolicy:
			normalized.includes("retried once") ||
			normalized.includes("retry once") ||
			normalized.includes("one retry"),
		staleEndpointRemoved: !document.includes(STALE_ENDPOINT),
		staleRetryPolicyRemoved: !normalized.includes("not retried"),
	};
}
