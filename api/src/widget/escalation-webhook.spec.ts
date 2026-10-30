import { createHmac } from 'node:crypto';
import { signBody, verifySignature } from './escalation-webhook';

describe('escalation webhook signature', () => {
  const body = JSON.stringify({ event: 'ticket.escalated', ticket: { id: 't1' } });

  it('is sha256=<hex HMAC of the raw body>', () => {
    const hex = createHmac('sha256', 's3cret').update(body).digest('hex');
    expect(signBody(body, 's3cret')).toBe(`sha256=${hex}`);
  });

  it('verifies only the exact body with the right secret', () => {
    const sig = signBody(body, 's3cret');
    expect(verifySignature(body, sig, 's3cret')).toBe(true);
    expect(verifySignature(body + ' ', sig, 's3cret')).toBe(false);
    expect(verifySignature(body, sig, 'other')).toBe(false);
    expect(verifySignature(body, undefined, 's3cret')).toBe(false);
    expect(verifySignature(body, 'sha256=short', 's3cret')).toBe(false);
  });
});
