# Exporting Your Data

## Your data is yours

You can download everything in your Ledgerly workspace at any time, on every plan, including during a free trial and while a workspace is read-only for an unpaid balance. Exports are created by the Owner or by anyone with the Admin or Accountant role.

## Export formats

- **CSV**: one file per object type (invoices, line items, clients, payments, credit notes, tax rates, products), bundled in a ZIP archive. Dates use ISO 8601 (YYYY-MM-DD), amounts are in the invoice currency with a period as the decimal separator, and files are UTF-8 encoded with a header row.
- **JSON**: a single JSON Lines file per object type, also zipped. Each line is the same object you'd get from the API, including IDs, so it's the best choice for moving to another system.
- **PDF**: a ZIP of the rendered invoice and credit note PDFs exactly as your clients saw them, named `{invoice_number}.pdf`. PDF exports cover documents only, not clients or payments.

## What's included and what isn't

Included in CSV and JSON exports:

- Invoices, quotes, credit notes and their line items, including drafts and voided documents
- Clients and their contacts
- Payments, refunds and payment allocations
- Products, tax rates and recurring invoice schedules
- Custom fields

Not included:

- File attachments added to invoices. Download them from each invoice or use the API.
- The activity/audit log. It has its own export under **Settings > Security > Audit log**.
- Team members, passwords, API keys and SSO settings.
- Bank feed transactions older than 24 months.

## Size limits

A single export can contain up to **50,000 invoices** or **2 GB** of compressed data, whichever comes first. If your data is bigger, Ledgerly automatically splits it into numbered parts (`part-1.zip`, `part-2.zip`, ...), each with its own download link. You can also narrow an export by date range, client or status.

PDF exports are limited to **5,000 documents** per export because rendering takes longer. Use a date range for larger sets.

## Creating a one-off export

1. Go to **Settings > Data > Export**.
2. Choose the format and, optionally, a date range and filters.
3. Click **Start export**.
4. Most exports finish in under 5 minutes; very large workspaces can take up to an hour. We email the person who started it when it's ready.
5. Click the link in the email, or open **Settings > Data > Export history**, and download the file.

**Download links expire after 72 hours.** After that, the file is deleted and you'll need to run the export again. Export history (the list of past jobs, without files) is kept for 30 days.

## Scheduled exports

On **Growth** and higher plans you can schedule exports to run automatically:

- Frequency: daily (at 02:00 in the workspace time zone), weekly (Mondays) or monthly (1st of the month).
- Delivery by email link to up to 5 recipients, on Growth and higher.
- Delivery to your own **SFTP** server, on Scale and Enterprise. Ledgerly connects from fixed IP addresses listed in the SFTP settings panel so you can allow them through your firewall. Supported authentication is SSH key only.

If a scheduled SFTP delivery fails three times in a row, the schedule pauses and the Owner gets an email.

## Exporting through the API

You can create the same exports programmatically:

1. `POST /v1/exports` with a body such as `{"format": "json", "objects": ["invoices", "payments"], "from": "2026-01-01"}`.
2. The response returns an export ID starting with `exp_` and a status of `queued`.
3. Poll `GET /v1/exports/{id}` until the status changes to `ready` (other values: `processing`, `failed`). We recommend polling no more often than once every 30 seconds.
4. When ready, the response includes a `download_url` that is valid for 72 hours, the same as exports created in the app.

API exports need an API key with the `exports:read` scope. A workspace can have at most **3 exports running at the same time**; a fourth request returns HTTP 409 with the code `LDG-EXPORT-BUSY`.

## Accounting software formats

If you plan to import into a bookkeeping tool, choose **CSV (accounting layout)**. It produces a single journal-style file with one row per invoice line, debit and credit columns, and the account codes you've mapped in **Settings > Accounting > Chart of accounts**.

## Exporting before you leave

If you're closing your workspace, export first. Once a workspace has been permanently deleted, we can't recover or export its data.
