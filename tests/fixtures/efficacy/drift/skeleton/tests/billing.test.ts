import { expect, test } from "bun:test";
import { deliverBillingWebhook, MAX_RETRIES, WEBHOOK_URL } from "../src/billing";

test("uses the live webhook", () => {
	expect(WEBHOOK_URL).toBe("https://api.example.com/v1/billing/webhook");
});

test("does not retry failed delivery", async () => {
	let attempts = 0;
	await deliverBillingWebhook(async () => {
		attempts += 1;
		return false;
	});
	expect(MAX_RETRIES).toBe(0);
	expect(attempts).toBe(1);
});
