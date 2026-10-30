import request from 'supertest';
import { createTestApp, makeWorld, resetData, TestApp } from './helpers';

/**
 * Authorization matrix for every write route (plus the role-restricted reads).
 * Each route is attacked three ways: no token (401), a member of another
 * tenant (404, so tenant ids can't be probed) and, where the route is
 * role-restricted, an under-privileged member (403).
 */
describe('RBAC on write routes', () => {
  let t: TestApp;
  let w: Awaited<ReturnType<typeof makeWorld>>;
  let docId: string;
  let convId: string;
  let ticketId: string;

  beforeAll(async () => {
    t = await createTestApp({ INGEST_WORKER: 'false' });
    await resetData(t);
    w = await makeWorld(t);
    docId = (
      await t.db.query<{ id: string }>(
        `INSERT INTO documents (tenant_id, title, source_type, status) VALUES ($1, 'Doc', 'text', 'indexed') RETURNING id`,
        [w.a.id],
      )
    ).rows[0].id;
    convId = (await t.db.query<{ id: string }>(`INSERT INTO conversations (tenant_id, visitor_id) VALUES ($1, 'v1') RETURNING id`, [w.a.id])).rows[0].id;
    ticketId = (
      await t.db.query<{ id: string }>(
        `INSERT INTO tickets (tenant_id, conversation_id, subject, summary, source) VALUES ($1, $2, 's', 'x', 'human') RETURNING id`,
        [w.a.id, convId],
      )
    ).rows[0].id;
  });
  afterAll(() => t.close());

  type Method = 'post' | 'patch' | 'delete' | 'get';
  interface Route {
    name: string;
    method: Method;
    path: () => string;
    body?: () => object;
    forbidden: ('admin' | 'agent')[]; // roles that must get 403
  }

  const routes: Route[] = [
    { name: 'PATCH settings', method: 'patch', path: () => `/tenants/${w.a.id}/settings`, body: () => ({ brand_color: '#000000' }), forbidden: ['admin', 'agent'] },
    { name: 'PATCH member role', method: 'patch', path: () => `/tenants/${w.a.id}/members/${w.agentA.id}`, body: () => ({ role: 'admin' }), forbidden: ['admin', 'agent'] },
    { name: 'POST invite', method: 'post', path: () => `/tenants/${w.a.id}/invites`, body: () => ({ email: 'new@x.test', role: 'agent' }), forbidden: ['agent'] },
    { name: 'POST document (url)', method: 'post', path: () => `/tenants/${w.a.id}/documents`, body: () => ({ url: 'https://example.com/help' }), forbidden: ['agent'] },
    { name: 'POST reindex', method: 'post', path: () => `/tenants/${w.a.id}/documents/${docId}/reindex`, forbidden: ['agent'] },
    { name: 'DELETE document', method: 'delete', path: () => `/tenants/${w.a.id}/documents/${docId}`, forbidden: ['agent'] },
    { name: 'POST conversation reply', method: 'post', path: () => `/tenants/${w.a.id}/conversations/${convId}/reply`, body: () => ({ content: 'hi' }), forbidden: [] },
    { name: 'PATCH ticket', method: 'patch', path: () => `/tenants/${w.a.id}/tickets/${ticketId}`, body: () => ({ status: 'pending' }), forbidden: [] },
    { name: 'GET audit', method: 'get', path: () => `/tenants/${w.a.id}/audit`, forbidden: ['agent'] },
  ];

  const send = (r: Route, headers: Record<string, string> = {}) => {
    const req = request(t.http)[r.method](r.path()).set(headers);
    return r.body ? req.send(r.body()) : req;
  };

  describe.each(routes)('$name', (r) => {
    it('refuses a request without a token (401)', async () => {
      await send(r).expect(401);
    });

    it('refuses a forged token (401)', async () => {
      const forged = t.jwt.sign({ sub: w.ownerA.id, email: w.ownerA.email }, { secret: 'not-the-real-secret-123' });
      await send(r, { Authorization: `Bearer ${forged}` }).expect(401);
    });

    it('hides the tenant from a member of another tenant (404)', async () => {
      await send(r, w.ownerB.auth).expect(404);
    });

    if (r.forbidden.length) {
      it.each(r.forbidden)('refuses role %s (403)', async (role) => {
        const user = role === 'admin' ? w.adminA : w.agentA;
        await send(r, user.auth).expect(403);
      });
    }
  });

  it('ignores any role claim in the token: the role comes from memberships', async () => {
    const lying = t.jwt.sign({ sub: w.agentA.id, email: w.agentA.email, role: 'owner' });
    await request(t.http)
      .patch(`/tenants/${w.a.id}/settings`)
      .set('Authorization', `Bearer ${lying}`)
      .send({ brand_color: '#123456' })
      .expect(403);
  });

  it('applies a membership change immediately (no stale role in the token)', async () => {
    await t.db.query(`UPDATE memberships SET role = 'agent' WHERE user_id = $1`, [w.adminA.id]);
    await request(t.http).post(`/tenants/${w.a.id}/invites`).set(w.adminA.auth).send({ email: 'z@x.test', role: 'agent' }).expect(403);
    await t.db.query(`UPDATE memberships SET role = 'admin' WHERE user_id = $1`, [w.adminA.id]);
  });

  it("returns 404 for another tenant's resource even through your own tenant path", async () => {
    const otherDoc = (
      await t.db.query<{ id: string }>(`INSERT INTO documents (tenant_id, title, source_type) VALUES ($1, 'B doc', 'text') RETURNING id`, [w.b.id])
    ).rows[0].id;
    await request(t.http).delete(`/tenants/${w.a.id}/documents/${otherDoc}`).set(w.ownerA.auth).expect(404);
    await request(t.http).post(`/tenants/${w.a.id}/documents/${otherDoc}/reindex`).set(w.ownerA.auth).expect(404);
    const { rows } = await t.db.query('SELECT 1 FROM documents WHERE id = $1', [otherDoc]);
    expect(rows).toHaveLength(1);
  });

  it('returns 404 for a non-uuid or unknown tenant id', async () => {
    await request(t.http).get('/tenants/not-a-uuid/documents').set(w.ownerA.auth).expect(404);
    await request(t.http).get('/tenants/00000000-0000-0000-0000-000000000000/documents').set(w.ownerA.auth).expect(404);
  });

  it('lets every role read tenant data', async () => {
    for (const u of [w.ownerA, w.adminA, w.agentA]) {
      await request(t.http).get(`/tenants/${w.a.id}/conversations`).set(u.auth).expect(200);
      await request(t.http).get(`/tenants/${w.a.id}/tickets`).set(u.auth).expect(200);
      await request(t.http).get(`/tenants/${w.a.id}/analytics`).set(u.auth).expect(200);
    }
  });

  it('allows the privileged roles through (sanity check of the matrix)', async () => {
    await request(t.http).patch(`/tenants/${w.a.id}/settings`).set(w.ownerA.auth).send({ brand_color: '#0a0b0c' }).expect(200);
    await request(t.http).post(`/tenants/${w.a.id}/invites`).set(w.adminA.auth).send({ email: 'ok@x.test', role: 'agent' }).expect(201);
    await request(t.http).post(`/tenants/${w.a.id}/conversations/${convId}/reply`).set(w.agentA.auth).send({ content: 'On it' }).expect(201);
    await request(t.http).patch(`/tenants/${w.a.id}/tickets/${ticketId}`).set(w.agentA.auth).send({ status: 'pending' }).expect(200);
    await request(t.http).get(`/tenants/${w.a.id}/audit`).set(w.adminA.auth).expect(200);
  });
});
