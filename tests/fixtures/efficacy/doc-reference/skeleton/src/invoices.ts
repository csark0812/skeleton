export const INVOICE_PREFIX = "INV";

export function formatInvoiceNumber(sequence: number): string {
	return `${INVOICE_PREFIX}-${String(sequence).padStart(5, "0")}`;
}

export async function sendInvoiceReminder(
	send: (invoiceNumber: string) => Promise<void>,
	sequence: number,
): Promise<void> {
	await send(formatInvoiceNumber(sequence));
}
