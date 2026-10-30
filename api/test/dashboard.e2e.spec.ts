import request from 'supertest';
import { createTestApp, makeWorld, resetData, TestApp } from './helpers';

/**
 * Conversations, tickets and analytics over a hand-built fixture whose
 * numbers are known, so the analytics formulas are checked exactly.
 */
describe('conversations, tickets, analytics', () => {
  let t: TestApp;
  let w: Awaited<ReturnType<typeof makeWorld>>;
  const ids: Record<string, string> = {};

  async function conversation(
    name: string,
    opts: { daysAgo: number; status?: string; turns: { q: string; intent: string; confidence: number; escalated?: boolean }[]; tenantId?: string },
  ) {
    const { rows } = await t.db.query<{ id: string }>(
      `INSERT INTO conversations (tenant_id, visitor_id, status, created_at, last_message_at)
       VALUES ($1, $2, $3, now() - make_interval(days => $4), now() - make_interval(days => $4)) RETURNING id`,
      [opts.tenantId ?? w.a.id, name, opts.status ?? 'open', opts.daysAgo],
    );
    const id = rows[0].id;
    ids[name] = id;
    let i = 0;
    for (const turn of opts.turns) {
      await t.db.query(
        `INSERT INTO messages (conversation_id, tenant_id, role, content, intent, created_at)
         VALUES ($1, $2, 'user', $3, $4, now() - make_interval(days => $5) + make_interval(secs => $6))`,
        [id, opts.tenantId ?? w.a.id, turn.q, turn.intent, opts.daysAgo, i++],
      );
      await t.db.query(
        `INSERT INTO messages (conversation_id, tenant_id, role, content, intent, confidence, escalated, created_at)
         VALUES ($1, $2, 'assistant', 'answer', $3, $4, $5, now() - make_interval(days => $6) + make_interval(secs => $7))`,
        [id, opts.tenantId ?? w.a.id, turn.intent, turn.confidence, turn.escalated ?? false, opts.daysAgo, i++],
      );
    }
    return id;
  }

  beforeAll(async () => {
    t = await createTestApp({ INGEST_WORKER: 'false' });
    await resetData(t);
    w = await makeWorld(t);
    // Threshold 0.55. In the 14-day window: 4 answered conversations, 1 escalated, 2 low-confidence.
    await conversation('c1', { daysAgo: 0, turns: [{ q: 'warranty?', intent: 'how_to', confidence: 0.9 }] });
    await conversation('c2', { daysAgo: 1, turns: [{ q: 'refund now', intent: 'billing', confidence: 0.8 }, { q: 'and tax?', intent: 'billing', confidence: 0.4 }] });
    await conversation('c3', { daysAgo: 1, status: 'escalated', turns: [{ q: 'lawyer!', intent: 'complaint', confidence: 0.3, escalated: true }] });
    await conversation('c4', { daysAgo: 5, turns: [{ q: 'battery', intent: 'how_to', confidence: 0.6 }] });
    // Not counted: no assistant answer; outside the window; other tenant.
    ids.empty = (await t.db.query<{ id: string }>(`INSERT INTO conversations (tenant_id, visitor_id) VALUES ($1, 'empty') RETURNING id`, [w.a.id])).rows[0].id;
    await conversation('old', { daysAgo: 30, turns: [{ q: 'old', intent: 'how_to', confidence: 0.1, escalated: true }] });
    await conversation('other', { daysAgo: 0, tenantId: w.b.id, turns: [{ q: 'B secret', intent: 'how_to', confidence: 0.1, escalated: true }] });
    ids.ticket = (
      await t.db.query<{ id: string }>(
        `INSERT INTO tickets (tenant_id, conversation_id, subject, summary, priority, source) VALUES ($1, $2, 'Legal', 'x', 'urgent', 'ai_tool') RETURNING id`,
        [w.a.id, ids.c3],
      )
    ).rows[0].id;
  });
  afterAll(() => t.close());

  it('computes analytics with the contract formulas', async () => {
    const res = await request(t.http).get(`/tenants/${w.a.id}/analytics?days=14`).set(w.agentA.auth).expect(200);
    const a = res.body;
    expect(a).toMatchObject({ conversations: 4, ai_resolved: 3, escalated: 1, deflection_rate: 0.75, low_confidence: 2 });
    expect(a.avg_confidence).toBeCloseTo((0.9 + 0.8 + 0.4 + 0.3 + 0.6) / 5, 4);
    expect(a.by_intent).toEqual([
      { intent: 'billing', count: 2 },
      { intent: 'how_to', count: 2 },
      { intent: 'complaint', count: 1 },
    ]);
    expect(a.daily).toHaveLength(14);
    expect(a.daily.at(-1)).toMatchObject({ conversations: 1, escalated: 0 });
    expect(a.daily.at(-2)).toMatchObject({ conversations: 2, escalated: 1 });
    expect(a.daily.reduce((s: number, d: { conversations: number }) => s + d.conversations, 0)).toBe(4);
    expect(a.top_unanswered.map((u: { question: string; confidence: number }) => [u.question, u.confidence])).toEqual([
      ['lawyer!', 0.3],
      ['and tax?', 0.4],
    ]);
    expect(JSON.stringify(a)).not.toContain('B secret');
  });

  it('returns zeros, not NaN, for an empty tenant', async () => {
    const res = await request(t.http).get(`/tenants/${w.b.id}/analytics?days=1`).set(w.ownerB.auth).expect(200);
    expect(res.body).toMatchObject({ conversations: 1, deflection_rate: 0 });
    await request(t.http).get(`/tenants/${w.b.id}/analytics?days=0`).set(w.ownerB.auth).expect(400);
  });

  it('lists conversations with filters', async () => {
    const all = await request(t.http).get(`/tenants/${w.a.id}/conversations`).set(w.agentA.auth).expect(200);
    expect(all.body).toHaveLength(6);
    const low = await request(t.http).get(`/tenants/${w.a.id}/conversations?filter=low_confidence`).set(w.agentA.auth).expect(200);
    expect(low.body.map((c: { visitor_id: string }) => c.visitor_id).sort()).toEqual(['c2', 'c3', 'old']);
    const esc = await request(t.http).get(`/tenants/${w.a.id}/conversations?filter=escalated`).set(w.agentA.auth).expect(200);
    expect(esc.body).toEqual([expect.objectContaining({ visitor_id: 'c3', ticket: expect.objectContaining({ priority: 'urgent' }) })]);
    await request(t.http).get(`/tenants/${w.a.id}/conversations?filter=bogus`).set(w.agentA.auth).expect(400);
  });

  it('returns a conversation with messages and tickets, 404 across tenants', async () => {
    const res = await request(t.http).get(`/tenants/${w.a.id}/conversations/${ids.c2}`).set(w.agentA.auth).expect(200);
    expect(res.body.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(res.body.messages[1].confidence).toBe(0.8);
    await request(t.http).get(`/tenants/${w.a.id}/conversations/${ids.other}`).set(w.agentA.auth).expect(404);
    await request(t.http).get(`/tenants/${w.b.id}/conversations/${ids.c2}`).set(w.ownerB.auth).expect(404);
  });

  it('stores a human reply as human_agent and audits it', async () => {
    const res = await request(t.http)
      .post(`/tenants/${w.a.id}/conversations/${ids.c3}/reply`)
      .set(w.agentA.auth)
      .send({ content: 'Hi, this is Priya from support.' })
      .expect(201);
    expect(res.body).toMatchObject({ role: 'human_agent', author_user_id: w.agentA.id });
    const detail = await request(t.http).get(`/tenants/${w.a.id}/conversations/${ids.c3}`).set(w.agentA.auth).expect(200);
    expect(detail.body.messages.at(-1)).toMatchObject({ role: 'human_agent', author_name: 'agent' });
    const { rows } = await t.db.query(`SELECT 1 FROM audit_log WHERE action = 'human.replied' AND target_id = $1`, [ids.c3]);
    expect(rows).toHaveLength(1);
    await request(t.http).post(`/tenants/${w.a.id}/conversations/${ids.c3}/reply`).set(w.agentA.auth).send({ content: '' }).expect(400);
    await request(t.http).post(`/tenants/${w.a.id}/conversations/${ids.other}/reply`).set(w.agentA.auth).send({ content: 'x' }).expect(404);
  });

  it('updates tickets (status, assignee) with validation and audit', async () => {
    const res = await request(t.http)
      .patch(`/tenants/${w.a.id}/tickets/${ids.ticket}`)
      .set(w.agentA.auth)
      .send({ status: 'pending', assignee_user_id: w.agentA.id })
      .expect(200);
    expect(res.body).toMatchObject({ status: 'pending', assignee_user_id: w.agentA.id, assignee_name: 'agent' });
    await request(t.http).patch(`/tenants/${w.a.id}/tickets/${ids.ticket}`).set(w.agentA.auth).send({ assignee_user_id: w.ownerB.id }).expect(400);
    await request(t.http).patch(`/tenants/${w.a.id}/tickets/${ids.ticket}`).set(w.agentA.auth).send({ status: 'archived' }).expect(400);
    const unassigned = await request(t.http).patch(`/tenants/${w.a.id}/tickets/${ids.ticket}`).set(w.agentA.auth).send({ assignee_user_id: null }).expect(200);
    expect(unassigned.body.assignee_user_id).toBeNull();
    const { rows } = await t.db.query<{ metadata: { changes: object } }>(
      `SELECT metadata FROM audit_log WHERE action = 'ticket.updated' AND target_id = $1 ORDER BY id`,
      [ids.ticket],
    );
    expect(rows[0].metadata.changes).toEqual({ status: { from: 'open', to: 'pending' }, assignee_user_id: { from: null, to: w.agentA.id } });
    const list = await request(t.http).get(`/tenants/${w.a.id}/tickets?status=pending`).set(w.agentA.auth).expect(200);
    expect(list.body).toHaveLength(1);
  });

  it('lists the audit log newest first for owner/admin', async () => {
    const res = await request(t.http).get(`/tenants/${w.a.id}/audit?limit=2`).set(w.adminA.auth).expect(200);
    expect(res.body).toHaveLength(2);
    expect(Number(res.body[0].id)).toBeGreaterThan(Number(res.body[1].id));
    const filtered = await request(t.http).get(`/tenants/${w.a.id}/audit?action=ticket`).set(w.adminA.auth).expect(200);
    expect(filtered.body.every((r: { action: string }) => r.action.startsWith('ticket.'))).toBe(true);
  });
});
