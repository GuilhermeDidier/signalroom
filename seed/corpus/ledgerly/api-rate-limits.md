# API Rate Limits, Pagination and Webhooks

## How limits work

The Ledgerly REST API (`https://api.ledgerly.example.com/v1`) limits how many requests each workspace can make. Limits are applied **per workspace**, not per API key: if you have three integrations using three keys, they share one budget.

There are two limits:

- **Sustained limit:** requests per minute, measured over a rolling 60-second window.
- **Burst limit:** requests per second, to protect against sudden spikes even when you're under the per-minute total.

| Plan | Requests per minute | Burst (requests per second) |
|---|---|---|
| Starter | 60 | 5 |
| Growth | 300 | 10 |
| Scale | 1,200 | 25 |
| Enterprise | 3,000 (can be raised by contract) | 50 |

Export jobs, file uploads and SCIM calls have separate limits and don't count against these numbers. Requests from sandbox workspaces (keys starting with `sk_test_`) are limited to 100 per minute on every plan.

## Rate limit headers

Every API response includes these headers so you can pace yourself:

- `X-RateLimit-Limit`: your per-minute limit.
- `X-RateLimit-Remaining`: requests left in the current window.
- `X-RateLimit-Reset`: Unix timestamp (seconds) when the window fully resets.

We recommend slowing down when `X-RateLimit-Remaining` drops below 10% of the limit rather than waiting for errors.

## When you hit a limit

Requests over the limit get **HTTP 429 Too Many Requests** with a `Retry-After` header that gives the number of seconds to wait. The JSON body tells you which limit you hit:

```
{"error": {"code": "LDG-429-RATE", "message": "Per-minute limit reached", "retry_after": 12}}
```

- `LDG-429-RATE`: you used up the per-minute budget. `Retry-After` is usually between 1 and 60 seconds.
- `LDG-429-BURST`: you sent too many requests in the same second. `Retry-After` is always 1. This usually means parallel workers are firing at once; add jitter or cap concurrency at the burst value for your plan.

Rejected requests still count toward the limit, so retrying in a tight loop makes things worse. Use exponential backoff starting at the `Retry-After` value. If a workspace keeps receiving 429s for more than 15 minutes straight, we may temporarily block its keys and email the Owner.

## Pagination

List endpoints (`GET /v1/invoices`, `/v1/clients`, `/v1/payments` and so on) use cursor-based pagination:

- `limit`: number of results per page. Default **25**, maximum **100**. Values over 100 return HTTP 400 with the code `LDG-400-LIMIT`.
- `starting_after`: the ID of the last object on the previous page.
- The response includes `has_more: true` when another page exists.

Offset-based pagination (`page=3`) was removed in API version **2025-06-01**. For more than about 10,000 objects, use a data export instead of paging through the whole list.

## Idempotency

`POST` requests accept an `Idempotency-Key` header (any unique string up to 255 characters). Retrying with the same key within **24 hours** returns the original result instead of creating a duplicate invoice or payment. This makes it safe to retry after a 429 or a timeout.

## Webhooks

Webhooks notify your endpoint when events happen, such as `invoice.sent`, `invoice.paid` or `payment.failed`. Configure them in **Settings > Developers > Webhooks**. Each workspace can have up to **10 endpoints**.

### Delivery and signatures

- Every delivery is an HTTPS `POST` with a JSON body.
- Each request carries a `Ledgerly-Signature` header: an HMAC-SHA256 of the timestamp and raw body using your endpoint's signing secret (starts with `whsec_`). Reject requests whose timestamp is more than 5 minutes old.
- Your endpoint must return a **2xx status within 10 seconds**. Anything else, including redirects, counts as a failure.

### Retry schedule

Failed deliveries are retried up to **7 times**, for a total of 8 attempts over about two days:

1. 1 minute after the first failure
2. 5 minutes
3. 30 minutes
4. 2 hours
5. 6 hours
6. 12 hours
7. 24 hours

Events can arrive more than once and out of order, so use the event `id` to deduplicate. After the last attempt fails, the event is marked `failed` and can be resent manually from the webhook log for up to **30 days**.

If an endpoint fails every delivery for **5 consecutive days**, it's automatically disabled and the Owner is emailed. Re-enable it from the webhooks screen after fixing the problem.

Webhook deliveries don't count against your API rate limit.

## Need more capacity?

Scale customers can buy a **Rate Limit Boost** add-on that doubles both limits for $49 per month. Enterprise limits are set in your contract.
