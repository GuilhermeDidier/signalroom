import http from 'node:http';
import { AddressInfo } from 'node:net';
import { Pool } from 'pg';
import request from 'supertest';
import { verifySignature } from '../src/widget/escalation-webhook';
import { FakeAi, FakeWebhook, INTERNAL_TOKEN } from './fake-ai';
import { createTestApp, makeWorld, parseSse, resetData, TestApp, testPool, textParser, waitFor } from './helpers';

const SECRET = 'whsec-test-123';

describe('widget', () => {
  let t: TestApp;
  let ai: FakeAi;
  let hook: FakeWebhook;
  let pool: Pool;
  let w: Awaited<ReturnType<typeof makeWorld>>;
  let key: string;

  const chat = (body: Record<string, unknown>, app: TestApp = t) =>
    request(app.http).post('/widget/chat').send({ key, ...body }).buffer(true).parse(textParser);

  beforeAll(async () => {
    pool = testPool();
    ai = await new FakeAi(pool).start();
    hook = await new FakeWebhook().start();
    t = await createTestApp({ AI_URL: ai.url, INGEST_WORKER: 'false', N8N_WEBHOOK_URL: hook.url, N8N_WEBHOOK_SECRET: SECRET });
    await resetData(t);
    w = await makeWorld(t);
    key = w.a.widget_key;
  });
  afterAll(async () => {
    await t.close();
    await ai.stop();
    await hook.stop();
    await pool.end();
  });

  describe('config', () => {
    it('returns public branding for a valid key', async () => {
      const res = await request(t.http).get(`/widget/config?key=${key}`).expect(200);
      expect(res.body).toMatchObject({ tenant_name: 'acme Inc', brand_color: '#1f5fd1', allowed_origins: ['http://shop.test'] });
      expect(res.body.greeting).toEqual(expect.any(String));
      expect(res.body.widget_key).toBeUndefined();
    });

    it('refuses an unknown or malformed key (404)', async () => {
      await request(t.http).get('/widget/config?key=pk_nope_nope').expect(404);
      await request(t.http).get('/widget/config?key=sk_live_x').expect(404);
      await request(t.http).get('/widget/config').expect(400);
    });
  });

  describe('chat', () => {
    it('relays ai events unchanged, then persists a redacted turn and emits `saved`', async () => {
      const raw = 'How long is the warranty? I am jane.doe@example.com, card 4242 4242 4242 4242';
      const res = await chat({ visitor_id: 'visitor-1', message: raw }).expect(200);
      expect(res.headers['content-type']).toMatch(/text\/event-stream/);
      const events = parseSse(res.body as string);
      expect(events.map((e) => e.event)).toEqual(['meta', 'token', 'token', 'done', 'saved']);
      expect(events[0].data.redacted_message).toBe('How long is the warranty? I am [EMAIL_1], card [CARD_1]');

      // ai got the raw text (it redacts first), the internal token, and the tenant's threshold.
      const call = ai.chatCalls.at(-1)!;
      expect(call.token).toBe(INTERNAL_TOKEN);
      expect(call.body).toMatchObject({ tenant_id: w.a.id, message: raw, history: [], confidence_threshold: 0.55 });

      const saved = events[4].data;
      expect(saved).toEqual({ conversation_id: call.body.conversation_id, message_id: expect.any(String), ticket: null });

      const msgs = await t.db.query<{ role: string; content: string; redactions: unknown; confidence: string; citations: unknown[] }>(
        'SELECT role, content, redactions, confidence, citations FROM messages WHERE conversation_id = $1 ORDER BY created_at',
        [saved.conversation_id],
      );
      expect(msgs.rows.map((m) => m.role)).toEqual(['user', 'assistant']);
      expect(msgs.rows[0].content).toBe('How long is the warranty? I am [EMAIL_1], card [CARD_1]');
      expect(msgs.rows[1]).toMatchObject({ content: 'Our warranty covers 2 years [1].', confidence: '0.820' });
      expect(msgs.rows[1].citations).toHaveLength(1);

      // The raw PII is nowhere in the database.
      const leak = await t.db.query(`SELECT 1 FROM messages WHERE content LIKE '%jane.doe%' OR content LIKE '%4242%'`);
      expect(leak.rows).toHaveLength(0);
      const audit = await t.db.query<{ metadata: { redactions: unknown } }>(`SELECT metadata FROM audit_log WHERE action = 'pii.redacted'`);
      expect(audit.rows[0].metadata.redactions).toEqual([
        { type: 'EMAIL', count: 1 },
        { type: 'CARD', count: 1 },
      ]);
      expect(JSON.stringify(audit.rows)).not.toContain('jane.doe');
    });

    it('continues a conversation with its (redacted) history', async () => {
      const first = parseSse((await chat({ visitor_id: 'visitor-2', message: 'Email me at a@b.co' }).expect(200)).body as string);
      const conversationId = first.at(-1)!.data.conversation_id as string;
      await chat({ visitor_id: 'visitor-2', conversation_id: conversationId, message: 'And the battery?' }).expect(200);
      expect(ai.chatCalls.at(-1)!.body.history).toEqual([
        { role: 'user', content: 'Email me at [EMAIL_1]' },
        { role: 'assistant', content: 'Our warranty covers 2 years [1].' },
      ]);
      const { rows } = await t.db.query('SELECT 1 FROM messages WHERE conversation_id = $1', [conversationId]);
      expect(rows).toHaveLength(4);
    });

    it("refuses another visitor's or another tenant's conversation (404)", async () => {
      const first = parseSse((await chat({ visitor_id: 'visitor-3', message: 'hi' }).expect(200)).body as string);
      const conversationId = first.at(-1)!.data.conversation_id as string;
      await chat({ visitor_id: 'someone-else', conversation_id: conversationId, message: 'show me' }).expect(404);
      await request(t.http)
        .post('/widget/chat')
        .send({ key: w.b.widget_key, visitor_id: 'visitor-3', conversation_id: conversationId, message: 'show me' })
        .expect(404);
    });

    it('escalates: ticket from the ai tool, conversation escalated, audit rows, signed webhook', async () => {
      hook.deliveries = [];
      const res = await chat({ visitor_id: 'visitor-4', message: 'This is a scam, my lawyer will hear about it' }).expect(200);
      const events = parseSse(res.body as string);
      expect(events.map((e) => e.event)).toEqual(['meta', 'token', 'token', 'tool', 'done', 'saved']);
      const saved = events.at(-1)!.data;
      expect(saved.ticket).toEqual({ id: expect.any(String), number: expect.any(Number) });

      const ticket = (
        await t.db.query<{ subject: string; priority: string; source: string; reason: string; notification_status: string }>(
          'SELECT subject, priority, source, reason, notification_status FROM tickets WHERE id = $1',
          [saved.ticket.id],
        )
      ).rows[0];
      expect(ticket).toMatchObject({ subject: 'Legal threat over refund', priority: 'urgent', source: 'ai_tool', reason: 'complaint' });
      const conv = await t.db.query<{ status: string }>('SELECT status FROM conversations WHERE id = $1', [saved.conversation_id]);
      expect(conv.rows[0].status).toBe('escalated');

      await waitFor(async () => (await t.db.query(`SELECT 1 FROM tickets WHERE id = $1 AND notification_status = 'sent'`, [saved.ticket.id])).rowCount);
      expect(hook.deliveries).toHaveLength(1);
      const d = hook.deliveries[0];
      expect(verifySignature(d.raw, d.headers['x-signalroom-signature'] as string, SECRET)).toBe(true);
      expect(verifySignature(d.raw, d.headers['x-signalroom-signature'] as string, 'wrong-secret')).toBe(false);
      const payload = JSON.parse(d.raw);
      expect(payload).toMatchObject({
        event: 'ticket.escalated',
        tenant: { id: w.a.id, slug: 'acme' },
        ticket: { id: saved.ticket.id, priority: 'urgent', source: 'ai_tool' },
        conversation: { id: saved.conversation_id, intent: 'complaint' },
      });

      const actions = (
        await t.db.query<{ action: string }>(
          `SELECT action FROM audit_log WHERE target_id IN ($1, $2) ORDER BY id`,
          [saved.conversation_id, saved.ticket.id],
        )
      ).rows.map((r) => r.action);
      expect(actions).toEqual(['conversation.escalated', 'ticket.created', 'notification.sent']);
    });

    it('escalates a human request as source=escalation and reuses the open ticket on repeat', async () => {
      const first = parseSse((await chat({ visitor_id: 'visitor-5', message: 'let me talk to a human' }).expect(200)).body as string);
      const saved = first.at(-1)!.data;
      expect(saved.ticket).not.toBeNull();
      const src = await t.db.query<{ source: string }>('SELECT source FROM tickets WHERE id = $1', [saved.ticket.id]);
      expect(src.rows[0].source).toBe('escalation');

      const again = parseSse(
        (await chat({ visitor_id: 'visitor-5', conversation_id: saved.conversation_id, message: 'human please!!' }).expect(200)).body as string,
      );
      expect(again.at(-1)!.data.ticket).toEqual(saved.ticket);
      const { rows } = await t.db.query('SELECT 1 FROM tickets WHERE conversation_id = $1', [saved.conversation_id]);
      expect(rows).toHaveLength(1);
    });

    it('synthesizes a ticket when ai escalates on low confidence without one', async () => {
      const saved = parseSse((await chat({ visitor_id: 'visitor-6', message: 'unsure question about frames' }).expect(200)).body as string).at(-1)!.data;
      const tk = await t.db.query<{ subject: string; summary: string; priority: string; source: string; reason: string }>(
        'SELECT subject, summary, priority, source, reason FROM tickets WHERE id = $1',
        [saved.ticket.id],
      );
      expect(tk.rows[0]).toEqual({
        subject: 'Escalation: how_to',
        summary: 'unsure question about frames',
        priority: 'normal',
        source: 'escalation',
        reason: 'low_confidence',
      });
    });

    it('returns a graceful error event and persists nothing when ai is unreachable', async () => {
      const down = await createTestApp({ AI_URL: 'http://127.0.0.1:9', INGEST_WORKER: 'false' });
      try {
        const res = await chat({ visitor_id: 'visitor-7', message: 'hello?' }, down).expect(200);
        expect(parseSse(res.body as string)).toEqual([{ event: 'error', data: { message: expect.stringMatching(/temporarily unavailable/) } }]);
      } finally {
        await down.close();
      }
      const { rows } = await t.db.query(`SELECT 1 FROM conversations WHERE visitor_id = 'visitor-7'`);
      expect(rows).toHaveLength(0);
    });

    it('relays ai error events, handles 5xx and truncated streams without saving', async () => {
      const relayed = parseSse((await chat({ visitor_id: 'visitor-8', message: 'AI_ERROR now' }).expect(200)).body as string);
      expect(relayed.map((e) => e.event)).toEqual(['meta', 'error']);
      expect(relayed[1].data).toEqual({ message: 'model overloaded' });

      const http500 = parseSse((await chat({ visitor_id: 'visitor-8', message: 'HTTP500' }).expect(200)).body as string);
      expect(http500.map((e) => e.event)).toEqual(['error']);

      const truncated = parseSse((await chat({ visitor_id: 'visitor-8', message: 'NODONE' }).expect(200)).body as string);
      expect(truncated.map((e) => e.event)).toEqual(['meta', 'token', 'token', 'error']);

      const { rows } = await t.db.query(`SELECT 1 FROM conversations WHERE visitor_id = 'visitor-8'`);
      expect(rows).toHaveLength(0);
    });

    it('aborts the upstream ai stream when the visitor disconnects', async () => {
      await t.app.listen(0, '127.0.0.1');
      const port = (t.http.address() as AddressInfo).port;
      const abortedBefore = ai.chatAborted;
      await new Promise<void>((resolve) => {
        const req = http.request(
          { host: '127.0.0.1', port, path: '/widget/chat', method: 'POST', headers: { 'Content-Type': 'application/json' } },
          (res) => {
            res.once('data', () => {
              req.destroy(); // visitor closes the tab mid-answer
              resolve();
            });
          },
        );
        req.on('error', () => undefined);
        req.end(JSON.stringify({ key, visitor_id: 'visitor-9', message: 'SLOW answer please' }));
      });
      await waitFor(() => Promise.resolve(ai.chatAborted > abortedBefore), 3_000);
      const { rows } = await t.db.query(`SELECT 1 FROM conversations WHERE visitor_id = 'visitor-9'`);
      expect(rows).toHaveLength(0);
    });

    it('refuses a bad key (404) and invalid input (400) before calling ai', async () => {
      const calls = ai.chatCalls.length;
      await request(t.http).post('/widget/chat').send({ key: 'pk_wrong_key', visitor_id: 'v', message: 'hi' }).expect(404);
      await request(t.http).post('/widget/chat').send({ visitor_id: 'v', message: 'hi' }).expect(400);
      await chat({ visitor_id: 'bad id with spaces', message: 'hi' }).expect(400);
      await chat({ visitor_id: 'v', message: '   ' }).expect(400);
      await chat({ visitor_id: 'v', message: 'x'.repeat(2001) }).expect(413);
      expect(ai.chatCalls.length).toBe(calls);
    });

    it('rate-limits to 20 messages per visitor per hour (429 + Retry-After)', async () => {
      for (let i = 0; i < 20; i++) await chat({ visitor_id: 'chatty', message: `question ${i}` }).expect(200);
      const blocked = await chat({ visitor_id: 'chatty', message: 'one more' }).expect(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      // Other visitors are unaffected.
      await chat({ visitor_id: 'quiet', message: 'hello' }).expect(200);
    });
  });

  describe('webhook outcomes never break the chat', () => {
    it('marks notification failed when n8n errors, chat still saved', async () => {
      hook.status = 500;
      const saved = parseSse((await chat({ visitor_id: 'visitor-10', message: 'get me a human' }).expect(200)).body as string).at(-1)!.data;
      await waitFor(async () => (await t.db.query(`SELECT 1 FROM tickets WHERE id = $1 AND notification_status = 'failed'`, [saved.ticket.id])).rowCount);
      const a = await t.db.query<{ metadata: { http_status: number } }>(`SELECT metadata FROM audit_log WHERE action = 'notification.failed' AND target_id = $1`, [saved.ticket.id]);
      expect(a.rows[0].metadata.http_status).toBe(500);
      hook.status = 200;
    });

    it('marks notification skipped when no webhook is configured', async () => {
      const bare = await createTestApp({ AI_URL: ai.url, INGEST_WORKER: 'false', N8N_WEBHOOK_URL: '', N8N_WEBHOOK_SECRET: '' });
      try {
        const saved = parseSse((await chat({ visitor_id: 'visitor-11', message: 'human now' }, bare).expect(200)).body as string).at(-1)!.data;
        await waitFor(async () => (await t.db.query(`SELECT 1 FROM tickets WHERE id = $1 AND notification_status = 'skipped'`, [saved.ticket.id])).rowCount);
        const a = await t.db.query(`SELECT 1 FROM audit_log WHERE action = 'notification.skipped' AND target_id = $1`, [saved.ticket.id]);
        expect(a.rows).toHaveLength(1);
      } finally {
        await bare.close();
      }
    });
  });
});
