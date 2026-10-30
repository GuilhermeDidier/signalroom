import request from 'supertest';
import { hashInviteToken } from '../src/tenants/invites.controller';
import { createTestApp, makeUser, makeWorld, PASSWORD, resetData, TestApp } from './helpers';

describe('auth, members and invites', () => {
  let t: TestApp;
  let w: Awaited<ReturnType<typeof makeWorld>>;

  beforeAll(async () => {
    t = await createTestApp({ INGEST_WORKER: 'false' });
    await resetData(t);
    w = await makeWorld(t);
  });
  afterAll(() => t.close());

  describe('login', () => {
    it('returns a token, the user and memberships, and audits the login', async () => {
      const res = await request(t.http).post('/auth/login').send({ email: 'OWNER@acme.test', password: PASSWORD }).expect(200);
      expect(res.body.token).toEqual(expect.any(String));
      expect(res.body.user).toEqual({ id: w.ownerA.id, email: 'owner@acme.test', name: 'owner' });
      expect(res.body.memberships).toEqual([{ tenant_id: w.a.id, tenant_name: 'acme Inc', tenant_slug: 'acme', role: 'owner' }]);
      expect(res.body.user.password_hash).toBeUndefined();
      const me = await request(t.http).get('/me').set('Authorization', `Bearer ${res.body.token}`).expect(200);
      expect(me.body.memberships).toHaveLength(1);
      const { rows } = await t.db.query(`SELECT 1 FROM audit_log WHERE action = 'auth.login' AND actor_id = $1`, [w.ownerA.id]);
      expect(rows.length).toBeGreaterThan(0);
    });

    it('rejects a wrong password and an unknown email with the same 401', async () => {
      const a = await request(t.http).post('/auth/login').send({ email: 'owner@acme.test', password: 'nope-nope' }).expect(401);
      const b = await request(t.http).post('/auth/login').send({ email: 'ghost@acme.test', password: 'nope-nope' }).expect(401);
      expect(a.body.message).toEqual(b.body.message);
    });

    it('rate-limits repeated login attempts per email', async () => {
      const email = 'brute@acme.test';
      for (let i = 0; i < 10; i++) await request(t.http).post('/auth/login').send({ email, password: 'x' }).expect(401);
      await request(t.http).post('/auth/login').send({ email, password: 'x' }).expect(429);
    });

    it('requires a token on /me', async () => {
      await request(t.http).get('/me').expect(401);
    });
  });

  describe('demo login', () => {
    it('logs in as the seeded demo user when DEMO_MODE=true', async () => {
      const demo = await makeUser(t, 'agent@acme.demo', [[w.a.id, 'agent']]);
      const res = await request(t.http).post('/auth/demo').send({ tenant_slug: 'acme', role: 'agent' }).expect(200);
      expect(res.body.user.id).toBe(demo.id);
      expect(res.body.memberships[0].role).toBe('agent');
    });

    it('is hidden (404) when DEMO_MODE is off', async () => {
      const prod = await createTestApp({ INGEST_WORKER: 'false', DEMO_MODE: 'false' });
      try {
        await request(prod.http).post('/auth/demo').send({ tenant_slug: 'acme', role: 'agent' }).expect(404);
      } finally {
        await prod.close();
      }
    });
  });

  describe('members', () => {
    it('lets the owner change a role and audits it', async () => {
      const u = await makeUser(t, 'promote@acme.test', [[w.a.id, 'agent']]);
      const res = await request(t.http).patch(`/tenants/${w.a.id}/members/${u.id}`).set(w.ownerA.auth).send({ role: 'admin' }).expect(200);
      expect(res.body).toEqual({ user_id: u.id, role: 'admin' });
      const { rows } = await t.db.query<{ metadata: unknown }>(`SELECT metadata FROM audit_log WHERE action = 'member.role_changed' AND target_id = $1`, [u.id]);
      expect(rows[0].metadata).toEqual({ from: 'agent', to: 'admin' });
    });

    it('refuses an admin changing roles, including their own (403)', async () => {
      await request(t.http).patch(`/tenants/${w.a.id}/members/${w.adminA.id}`).set(w.adminA.auth).send({ role: 'owner' }).expect(403);
      const { rows } = await t.db.query<{ role: string }>('SELECT role FROM memberships WHERE user_id = $1', [w.adminA.id]);
      expect(rows[0].role).toBe('admin');
    });

    it('keeps at least one owner (409)', async () => {
      await request(t.http).patch(`/tenants/${w.a.id}/members/${w.ownerA.id}`).set(w.ownerA.auth).send({ role: 'agent' }).expect(409);
    });

    it('404s for a user who is not in the tenant', async () => {
      await request(t.http).patch(`/tenants/${w.a.id}/members/${w.ownerB.id}`).set(w.ownerA.auth).send({ role: 'agent' }).expect(404);
    });
  });

  describe('invite flow', () => {
    it('create → show → accept → login payload; token stored hashed; single use', async () => {
      const created = await request(t.http)
        .post(`/tenants/${w.a.id}/invites`)
        .set(w.adminA.auth)
        .send({ email: 'New.Hire@Acme.test', role: 'agent' })
        .expect(201);
      const url: string = created.body.invite_url;
      expect(url).toMatch(/^http:\/\/web\.test\/invite\/[A-Za-z0-9_-]{43}$/);
      const token = url.split('/').pop()!;

      const stored = await t.db.query<{ token: string; email: string }>('SELECT token, email FROM invites WHERE id = $1', [created.body.id]);
      expect(stored.rows[0].token).toBe(hashInviteToken(token));
      expect(stored.rows[0].token).not.toContain(token);
      expect(stored.rows[0].email).toBe('new.hire@acme.test');

      const shown = await request(t.http).get(`/invites/${token}`).expect(200);
      expect(shown.body).toMatchObject({ tenant_name: 'acme Inc', email: 'new.hire@acme.test', role: 'agent' });

      const accepted = await request(t.http).post(`/invites/${token}/accept`).send({ name: 'New Hire', password: 'longenough1' }).expect(201);
      expect(accepted.body.token).toEqual(expect.any(String));
      expect(accepted.body.memberships).toEqual([expect.objectContaining({ tenant_id: w.a.id, role: 'agent' })]);

      // The new account can log in and act within its role.
      await request(t.http).post('/auth/login').send({ email: 'new.hire@acme.test', password: 'longenough1' }).expect(200);
      await request(t.http).get(`/tenants/${w.a.id}/documents`).set('Authorization', `Bearer ${accepted.body.token}`).expect(200);

      await request(t.http).post(`/invites/${token}/accept`).send({ name: 'Again', password: 'longenough1' }).expect(410);
      await request(t.http).get(`/invites/${token}`).expect(410);

      const audit = await t.db.query<{ action: string }>(
        `SELECT action FROM audit_log WHERE target_id = $1 ORDER BY id`,
        [created.body.id],
      );
      expect(audit.rows.map((r) => r.action)).toEqual(['invite.created', 'invite.accepted']);

      const list = await request(t.http).get(`/tenants/${w.a.id}/invites`).set(w.agentA.auth).expect(200);
      expect(list.body[0]).toMatchObject({ email: 'new.hire@acme.test', status: 'accepted' });
      expect(list.body[0].token).toBeUndefined();
    });

    it('refuses an expired invite (410) and an unknown token (404)', async () => {
      const created = await request(t.http).post(`/tenants/${w.a.id}/invites`).set(w.ownerA.auth).send({ email: 'late@acme.test', role: 'admin' }).expect(201);
      await t.db.query(`UPDATE invites SET expires_at = now() - interval '1 minute' WHERE id = $1`, [created.body.id]);
      const token = String(created.body.invite_url).split('/').pop()!;
      await request(t.http).post(`/invites/${token}/accept`).send({ name: 'Late', password: 'longenough1' }).expect(410);
      await request(t.http).post(`/invites/${'x'.repeat(43)}/accept`).send({ name: 'Nobody', password: 'longenough1' }).expect(404);
    });

    it('lets an existing account accept only while signed in as itself (no password oracle)', async () => {
      const created = await request(t.http).post(`/tenants/${w.a.id}/invites`).set(w.ownerA.auth).send({ email: 'owner@globex.test', role: 'agent' }).expect(201);
      const token = String(created.body.invite_url).split('/').pop()!;
      expect((await request(t.http).get(`/invites/${token}`).expect(200)).body.account_exists).toBe(true);

      // Anonymous, even with the right password: refused, and the password is never checked.
      await request(t.http).post(`/invites/${token}/accept`).send({ name: 'Hijack', password: PASSWORD }).expect(409);
      // Signed in as someone else (e.g. the inviter): refused.
      await request(t.http).post(`/invites/${token}/accept`).set(w.ownerA.auth).send({}).expect(409);
      // The invite is still usable after refusals (each refusal happens before the claim).
      const ok = await request(t.http).post(`/invites/${token}/accept`).set(w.ownerB.auth).send({}).expect(201);
      expect(ok.body.memberships.map((m: { tenant_slug: string }) => m.tenant_slug).sort()).toEqual(['acme', 'globex']);
    });

    it('requires name and password to create a new account', async () => {
      const created = await request(t.http).post(`/tenants/${w.a.id}/invites`).set(w.ownerA.auth).send({ email: 'fresh@acme.test', role: 'agent' }).expect(201);
      const token = String(created.body.invite_url).split('/').pop()!;
      await request(t.http).post(`/invites/${token}/accept`).send({}).expect(400);
      await request(t.http).post(`/invites/${token}/accept`).send({ name: 'Fresh', password: 'short' }).expect(400);
    });

    it('refuses inviting an existing member (409) and invalid input (400)', async () => {
      await request(t.http).post(`/tenants/${w.a.id}/invites`).set(w.ownerA.auth).send({ email: 'agent@acme.test', role: 'agent' }).expect(409);
      await request(t.http).post(`/tenants/${w.a.id}/invites`).set(w.ownerA.auth).send({ email: 'x@acme.test', role: 'owner' }).expect(400);
    });
  });

  describe('settings', () => {
    it('validates and audits a settings change', async () => {
      await request(t.http).patch(`/tenants/${w.a.id}/settings`).set(w.ownerA.auth).send({ allowed_origins: ['not a url'] }).expect(400);
      await request(t.http).patch(`/tenants/${w.a.id}/settings`).set(w.ownerA.auth).send({ confidence_threshold: 2 }).expect(400);
      const res = await request(t.http)
        .patch(`/tenants/${w.a.id}/settings`)
        .set(w.ownerA.auth)
        .send({ confidence_threshold: 0.6, allowed_origins: ['https://shop.example.com/'] })
        .expect(200);
      expect(res.body).toMatchObject({ confidence_threshold: 0.6, allowed_origins: ['https://shop.example.com'] });
      const { rows } = await t.db.query<{ metadata: { changes: Record<string, unknown> } }>(
        `SELECT metadata FROM audit_log WHERE action = 'settings.updated' ORDER BY id DESC LIMIT 1`,
      );
      expect(rows[0].metadata.changes.confidence_threshold).toEqual({ from: 0.55, to: 0.6 });
      const got = await request(t.http).get(`/tenants/${w.a.id}`).set(w.agentA.auth).expect(200);
      expect(got.body).toMatchObject({ slug: 'acme', widget_key: 'pk_test_acme', role: 'agent' });
    });
  });

  it('keeps the audit log append-only at the database level', async () => {
    await expect(t.db.query(`UPDATE audit_log SET action = 'x'`)).rejects.toThrow(/append-only/);
    await expect(t.db.query(`DELETE FROM audit_log`)).rejects.toThrow(/append-only/);
  });
});
