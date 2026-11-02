# Invoice reminders

<!-- source-of-truth: Invoice reminder delivery -->

<!-- doc-meta: owner=billing -->

<!-- review-deps: paths=src/invoices.ts#sendInvoiceReminder -->

Overdue invoices get one reminder. [`sendInvoiceReminder`](../src/invoices.ts#sendInvoiceReminder) sends it with the formatted invoice number.
