# Setting Up SAML Single Sign-On

## Availability

SAML 2.0 single sign-on is included on the **Scale** and **Enterprise** plans. Automatic user provisioning with **SCIM 2.0** is available on **Enterprise only**. Starter and Growth workspaces can sign in with email and password plus optional two-factor authentication.

Only the workspace **Owner** can configure SSO.

## Supported identity providers

Ledgerly works with any identity provider (IdP) that supports SAML 2.0 with HTTP-POST binding and signed assertions. We publish tested setup templates for Keystone ID, Portalis Directory and OpenGate IAM, and a generic template for everything else. IdP-initiated and SP-initiated sign-in are both supported.

Requirements on the IdP side:

- Assertions must be signed with **RSA-SHA256**. SHA-1 signatures are rejected.
- The NameID format must be **emailAddress**.
- The certificate must be valid for at least 30 more days when you upload it.

## Values you'll need

Each workspace has a unique ID that starts with **ws_** (for example, ws_8f3k2q). You'll find it in **Settings > Security > Single sign-on**. Use it to build these values:

- **ACS URL (Reply URL):** `https://app.ledgerly.example.com/sso/saml/acs/{workspace_id}`
- **Entity ID (Audience URI):** `https://app.ledgerly.example.com/sso/saml/metadata/{workspace_id}`
- **Metadata XML:** available at the Entity ID URL, if your IdP can import it.

Required attributes: `email`. Optional attributes: `first_name`, `last_name` and `ledgerly_role` (values: admin, accountant, member, viewer).

## Step-by-step setup

1. **Verify your domain.** In **Settings > Security > Domains**, add your email domain. Ledgerly gives you a DNS TXT record in the form `ledgerly-verify=<token>`. Add it to your DNS; verification usually completes within 15 minutes and can take up to 48 hours.
2. **Create the app in your IdP.** Use a SAML app (or one of our templates) and paste the ACS URL and Entity ID above.
3. **Map attributes.** Map the user's primary email to `email`, and optionally the name and role attributes.
4. **Copy the IdP details into Ledgerly.** Paste the IdP SSO URL, the IdP Entity ID (Issuer) and upload the X.509 signing certificate.
5. **Test.** Click **Test connection**. A new window signs you in through the IdP and shows the attributes we received. SSO isn't switched on until a test succeeds.
6. **Enable.** Turn on **Allow SSO sign-in**. Users can then sign in either way.
7. **Enforce (optional).** Turn on **Require SSO** to block password sign-in for everyone on your verified domains.

### Break-glass access

When Require SSO is on, the workspace Owner can still sign in with a password and two-factor authentication at `https://app.ledgerly.example.com/login/owner`. Keep this in case your IdP has an outage. External accountants whose emails aren't on a verified domain also keep password sign-in.

## Just-in-time provisioning and SCIM

With SSO enabled, users who sign in for the first time are created automatically with the **Member** role, unless `ledgerly_role` says otherwise. Just-in-time users count toward your seat total.

On Enterprise, you can turn on SCIM in **Settings > Security > Provisioning**:

- **SCIM base URL:** `https://api.ledgerly.example.com/scim/v2/{workspace_id}`
- **Authentication:** bearer token generated in the same screen. Tokens are valid for **365 days**; you'll get an email 30 days before expiry.
- Deactivating a user in the IdP suspends them in Ledgerly within 5 minutes and frees their seat. Their invoices and history are kept.

## Timing and clock skew

Assertions are valid for **5 minutes** after they're issued. Ledgerly tolerates a clock difference of up to **3 minutes** between your IdP and our servers. If your IdP server's clock drifts further than that, sign-ins fail even though the setup is correct.

## Troubleshooting error codes

Errors appear on the sign-in screen and in **Settings > Security > SSO log** (kept for 90 days).

| Code | What it means | How to fix it |
|---|---|---|
| SAML-403 | The user authenticated but isn't allowed into this workspace: their email domain isn't verified, or the user is suspended | Verify the domain, or reactivate the user in Settings > Team |
| SAML-ASSERTION-EXPIRED | The assertion's timestamp is outside the 5-minute window plus the 3-minute skew | Sync the IdP server clock with NTP; ask the user to start sign-in again rather than using browser back |
| SAML-SIG-INVALID | The signature doesn't match the uploaded certificate | Re-download the current certificate from your IdP and upload it; check that the IdP uses RSA-SHA256 |
| SAML-AUD-MISMATCH | The Audience in the assertion doesn't match our Entity ID | Check that the Entity ID includes your exact workspace ID with the ws_ prefix |
| SAML-NAMEID-FORMAT | NameID isn't an email address | Set NameID format to emailAddress |

## Rotating certificates

Upload the new certificate under **Secondary certificate** before switching it on in your IdP. Ledgerly accepts assertions signed with either certificate until you remove the old one, so you can rotate without downtime.
