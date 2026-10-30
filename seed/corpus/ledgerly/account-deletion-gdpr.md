# Account Deletion, Privacy and GDPR

## Removing a person vs deleting a workspace

These are two different things:

- **Removing a team member** (Settings > Team > Remove) takes away that person's access. The invoices they created stay in the workspace, and their name stays on the activity log. Their personal Ledgerly login is not deleted if they belong to other workspaces.
- **Deleting a workspace** removes the whole company account: invoices, clients, payments, attachments and settings.

To delete your own personal login entirely, you must first leave or delete every workspace you belong to, then go to **Profile > Delete my login**.

## How to delete a workspace

Only the workspace **Owner** can do this.

1. Export anything you want to keep. Deleted data can't be exported later.
2. Cancel any active subscription in **Settings > Billing**. You can't delete a workspace with an active paid plan.
3. Go to **Settings > Workspace > Delete workspace**.
4. Type the workspace name exactly as shown and confirm with your password (or SSO sign-in).
5. You'll get a confirmation email with a deletion reference starting with **DEL-**.

Enterprise workspaces are deleted by our team at the end of the contract term, following the steps in your order form.

## Recovery window

A deleted workspace isn't erased straight away. It's **deactivated for 30 days**. During that time nobody can sign in to it, scheduled exports and webhooks stop, and recurring invoices stop being sent.

To restore it within those 30 days, the Owner clicks the **Restore workspace** link in the confirmation email or contacts privacy@ledgerly.example.com. Restored workspaces come back exactly as they were, on the free read-only state until a plan is chosen.

After 30 days the workspace is **permanently deleted** from our live systems. Encrypted backups are kept on a rolling **35-day** cycle, so all copies are gone at most 35 days after permanent deletion. We can't restore individual workspaces from backups.

## What we keep, and for how long

Some records have to be kept even after deletion, because the law requires it or because they're needed to protect the service:

| Record | Kept for | Why |
|---|---|---|
| Receipts and payment records for your Ledgerly subscription | 7 years | Tax and accounting law |
| Security audit logs (sign-ins, permission changes) | 1 year | Fraud and abuse prevention |
| Records of a GDPR request and our reply | 3 years | Proof of compliance |
| Support conversations | 2 years | Handling follow-up questions |

The invoices **you** issued to **your** clients are your data, not ours. We delete them with the workspace. If your local tax law requires you to keep them (often 5 to 10 years), export them before deleting.

## Your privacy rights (DSAR)

Anyone whose personal data we hold can ask to access, correct, delete, restrict or port it. Send your request to privacy@ledgerly.example.com or use the form in **Profile > Privacy**.

- We confirm receipt within 3 business days.
- We respond within **30 days**. For complex or multiple requests we may extend this by up to **two further months**, and we'll tell you why within the first 30 days.
- We'll verify your identity by email before releasing data. We never ask for a copy of an ID document unless email verification is impossible.

### If you're our customer's client

If you received an invoice from a business that uses Ledgerly, that business controls your data and Ledgerly is its processor. Contact the business directly. If you write to us, we'll forward your request to them within 5 business days and let you know who they are.

## Data Processing Agreement

Our **Data Processing Agreement (DPA)** is pre-signed and available to every paid workspace in **Settings > Legal > DPA**. Download it, countersign it and keep it with your records; there's no need to send it back. The DPA includes the EU Standard Contractual Clauses and the UK International Data Transfer Addendum. Our list of sub-processors is in the same screen, and we give **30 days' notice** by email before adding a new one.

Enterprise customers can negotiate a custom DPA.

## Data residency

When you create a workspace you choose where its data is stored:

- **US** (United States, east coast region) — default for new workspaces
- **EU** (Frankfurt, Germany)
- **AU** (Sydney, Australia)

The EU and AU regions are available on **Scale and Enterprise**. Starter and Growth workspaces are hosted in the US region. Backups stay in the same region as the live data.

The region can't be changed by the customer after creation. Enterprise customers can request a one-time migration between regions, which takes up to 10 business days and requires a 4-hour maintenance window.

## Contact

Our Data Protection Officer can be reached at dpo@ledgerly.example.com.
