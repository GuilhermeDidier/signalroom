import http from 'node:http';
import { AddressInfo } from 'node:net';
import request from 'supertest';
import { FakeAi, INTERNAL_TOKEN } from './fake-ai';
import { Pool } from 'pg';
import { createTestApp, makeWorld, resetData, TestApp, testPool, waitFor } from './helpers';

describe('documents + ingest queue', () => {
  let t: TestApp;
  let ai: FakeAi;
  let pool: Pool;
  let w: Awaited<ReturnType<typeof makeWorld>>;

  const status = async (id: string) =>
    (await t.db.query<{ status: string; attempts: number; error: string | null }>('SELECT status, attempts, error FROM documents WHERE id = $1', [id])).rows[0];

  beforeAll(async () => {
    pool = testPool();
    ai = await new FakeAi(pool).start();
    t = await createTestApp({ AI_URL: ai.url });
    await resetData(t);
    w = await makeWorld(t);
  });
  afterAll(async () => {
    await t.close();
    await ai.stop();
    await pool.end();
  });

  it('uploads a text file → 201 queued → worker calls ai /ingest with the internal token → indexed', async () => {
    const res = await request(t.http)
      .post(`/tenants/${w.a.id}/documents`)
      .set(w.adminA.auth)
      .attach('file', Buffer.from('# Returns\nYou can return a bike within 30 days.'), 'returns-policy.md')
      .expect(201);
    expect(res.body).toMatchObject({ title: 'returns-policy', source_type: 'text', mime: 'text/markdown', status: 'queued' });
    expect(res.body.content).toBeUndefined();

    const doc = await waitFor(async () => {
      const s = await status(res.body.id);
      return s.status === 'indexed' ? s : undefined;
    });
    expect(doc.attempts).toBe(1);
    const call = ai.ingestCalls.find((c) => c.body.document_id === res.body.id);
    expect(call?.token).toBe(INTERNAL_TOKEN);

    const { rows } = await t.db.query<{ action: string; metadata: { title: string } }>(
      `SELECT action, metadata FROM audit_log WHERE target_id = $1`,
      [res.body.id],
    );
    expect(rows).toEqual([expect.objectContaining({ action: 'document.uploaded', metadata: expect.objectContaining({ title: 'returns-policy' }) })]);
  });

  it('accepts a JSON {url} source', async () => {
    const res = await request(t.http)
      .post(`/tenants/${w.a.id}/documents`)
      .set(w.ownerA.auth)
      .send({ url: 'https://help.example.com/shipping' })
      .expect(201);
    expect(res.body).toMatchObject({ source_type: 'url', source_url: 'https://help.example.com/shipping', title: 'help.example.com/shipping' });
    await waitFor(async () => (await status(res.body.id)).status === 'indexed');
  });

  it('retries transient ai failures with backoff (500 → 500 → 200)', async () => {
    ai.ingestFailures = [500, 500];
    const res = await request(t.http)
      .post(`/tenants/${w.a.id}/documents`)
      .set(w.ownerA.auth)
      .attach('file', Buffer.from('battery care'), 'battery.txt')
      .expect(201);
    const doc = await waitFor(async () => {
      const s = await status(res.body.id);
      return s.status === 'indexed' ? s : undefined;
    });
    expect(doc.attempts).toBe(3);
  });

  it('does not retry a permanent 422 from ai', async () => {
    ai.ingestFailures = [422];
    const before = ai.ingestCalls.length;
    const res = await request(t.http)
      .post(`/tenants/${w.a.id}/documents`)
      .set(w.ownerA.auth)
      .attach('file', Buffer.from('%PDF-1.4 broken'), 'broken.pdf')
      .expect(201);
    await waitFor(async () => (await status(res.body.id)).status === 'failed');
    await new Promise((r) => setTimeout(r, 300));
    expect(ai.ingestCalls.length - before).toBe(1);
    expect((await status(res.body.id)).error).toBe('unreadable file');
  });

  it('marks the document failed after 3 attempts when ai is unreachable', async () => {
    const down = await createTestApp({ AI_URL: 'http://127.0.0.1:9', REDIS_PREFIX: 'srtest-down' });
    try {
      const res = await request(down.http)
        .post(`/tenants/${w.a.id}/documents`)
        .set(w.ownerA.auth)
        .attach('file', Buffer.from('servicing'), 'servicing.txt')
        .expect(201);
      const doc = await waitFor(async () => {
        const s = await status(res.body.id);
        return s.status === 'failed' ? s : undefined;
      });
      expect(doc.attempts).toBe(3);
      expect(doc.error).toMatch(/after 3 attempt\(s\): ai unreachable/);
    } finally {
      await down.close();
    }
  });

  it('refuses to reindex a document that is still being indexed (409)', async () => {
    const id = (
      await t.db.query<{ id: string }>(`INSERT INTO documents (tenant_id, title, source_type, status) VALUES ($1, 'Busy', 'text', 'embedding') RETURNING id`, [w.a.id])
    ).rows[0].id;
    await request(t.http).post(`/tenants/${w.a.id}/documents/${id}/reindex`).set(w.ownerA.auth).expect(409);
    expect((await status(id)).status).toBe('embedding');
  });

  it('validates uploads: type, content sniffing, size, missing input', async () => {
    const post = () => request(t.http).post(`/tenants/${w.a.id}/documents`).set(w.ownerA.auth);
    await post().attach('file', Buffer.from('MZ binary'), 'tool.exe').expect(400);
    await post().attach('file', Buffer.from('not a pdf'), 'fake.pdf').expect(400);
    await post().attach('file', Buffer.from([0x68, 0x00, 0x69]), 'nul.txt').expect(400);
    await post().attach('file', Buffer.alloc(10 * 1024 * 1024 + 1, 0x61), 'huge.txt').expect(413);
    await post().send({ url: 'ftp://example.com/file' }).expect(400);
    await post().send({}).expect(400);
  });

  it('agent cannot upload or delete documents (403)', async () => {
    await request(t.http).post(`/tenants/${w.a.id}/documents`).set(w.agentA.auth).attach('file', Buffer.from('x'), 'x.txt').expect(403);
    const { rows } = await t.db.query<{ id: string }>(`SELECT id FROM documents WHERE tenant_id = $1 LIMIT 1`, [w.a.id]);
    await request(t.http).delete(`/tenants/${w.a.id}/documents/${rows[0].id}`).set(w.agentA.auth).expect(403);
    await request(t.http).get(`/tenants/${w.a.id}/documents`).set(w.agentA.auth).expect(200);
  });

  it('reindex re-queues and audits; delete removes the row and audits', async () => {
    const { rows } = await t.db.query<{ id: string }>(`SELECT id FROM documents WHERE tenant_id = $1 AND status = 'indexed' LIMIT 1`, [w.a.id]);
    const id = rows[0].id;
    const calls = ai.ingestCalls.length;
    const re = await request(t.http).post(`/tenants/${w.a.id}/documents/${id}/reindex`).set(w.adminA.auth).expect(202);
    expect(re.body.status).toBe('queued');
    await waitFor(async () => ai.ingestCalls.length > calls && (await status(id)).status === 'indexed');

    await request(t.http).delete(`/tenants/${w.a.id}/documents/${id}`).set(w.adminA.auth).expect(204);
    expect(await status(id)).toBeUndefined();
    const audit = await t.db.query<{ action: string }>(`SELECT action FROM audit_log WHERE target_id = $1 ORDER BY id`, [id]);
    expect(audit.rows.map((r) => r.action)).toEqual(expect.arrayContaining(['document.reindexed', 'document.deleted']));
  });

  it('streams the document list over SSE and pushes status changes', async () => {
    await t.app.listen(0, '127.0.0.1');
    const port = (t.http.address() as AddressInfo).port;
    const docId = (
      await t.db.query<{ id: string }>(`INSERT INTO documents (tenant_id, title, source_type, status) VALUES ($1, 'Live', 'text', 'parsing') RETURNING id`, [w.a.id])
    ).rows[0].id;

    const events: { title: string; status: string }[][] = [];
    await new Promise<void>((resolve, reject) => {
      const req = http.get(
        { host: '127.0.0.1', port, path: `/tenants/${w.a.id}/documents/events`, headers: w.agentA.auth },
        (res) => {
          expect(res.headers['content-type']).toMatch(/text\/event-stream/);
          let buf = '';
          res.on('data', (c: Buffer) => {
            buf += c.toString();
            let i: number;
            while ((i = buf.indexOf('\n\n')) !== -1) {
              const block = buf.slice(0, i);
              buf = buf.slice(i + 2);
              if (!block.startsWith('event: documents')) continue;
              events.push(JSON.parse(block.split('\ndata: ')[1]) as { title: string; status: string }[]);
              if (events.length === 1) void t.db.query(`UPDATE documents SET status = 'indexed' WHERE id = $1`, [docId]);
              if (events.length === 2) {
                req.destroy();
                resolve();
              }
            }
          });
        },
      );
      req.on('error', (e) => (events.length >= 2 ? resolve() : reject(e)));
    });
    expect(events[0].find((d) => d.title === 'Live')?.status).toBe('parsing');
    expect(events[1].find((d) => d.title === 'Live')?.status).toBe('indexed');
  });

  it('refuses the SSE stream without a token or across tenants', async () => {
    await request(t.http).get(`/tenants/${w.a.id}/documents/events`).expect(401);
    await request(t.http).get(`/tenants/${w.a.id}/documents/events`).set(w.ownerB.auth).expect(404);
  });
});
