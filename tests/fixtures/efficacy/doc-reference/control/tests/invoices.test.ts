import { expect, test } from "bun:test";
import { formatInvoiceNumber, sendInvoiceReminder } from "../src/invoices";

test("formats invoice numbers", () => {
	expect(formatInvoiceNumber(42)).toBe("INV-00042");
});

test("sends one reminder with the invoice number", async () => {
	const sent: string[] = [];
	await sendInvoiceReminder(async (invoiceNumber) => {
		sent.push(invoiceNumber);
	}, 42);
	expect(sent).toEqual(["INV-00042"]);
});
