const RENAMED_SYMBOL = "remindInvoiceRecipient";
const STALE_SYMBOL = "sendInvoiceReminder";

/** The reminder document must link the renamed function and drop every stale mention. */
export function checkInvoiceReminderDocument(document: string) {
	return {
		documentAvailable: document.length > 0,
		linksRenamedSymbol: document.includes(`src/invoices.ts#${RENAMED_SYMBOL}`),
		staleSymbolRemoved: !document.includes(STALE_SYMBOL),
	};
}
