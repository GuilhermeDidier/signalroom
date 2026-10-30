import request from 'supertest';
import { createTestApp } from './helpers';

describe('GET /health', () => {
  it('reports db and redis ok', async () => {
    const t = await createTestApp({ INGEST_WORKER: 'false' });
    try {
      const res = await request(t.http).get('/health').expect(200);
      expect(res.body).toEqual({ ok: true, db: 'ok', redis: 'ok' });
    } finally {
      await t.close();
    }
  });

  it('returns 503 when the database is unreachable', async () => {
    const t = await createTestApp({ INGEST_WORKER: 'false', DATABASE_URL: 'postgres://nobody:nothing@127.0.0.1:1/none' });
    try {
      const res = await request(t.http).get('/health').expect(503);
      expect(res.body.ok).toBe(false);
      expect(res.body.redis).toBe('ok');
    } finally {
      await t.close();
    }
  });

  it('sends CORS headers only for configured origins', async () => {
    const t = await createTestApp({ INGEST_WORKER: 'false' });
    try {
      const ok = await request(t.http).get('/health').set('Origin', 'http://web.test');
      expect(ok.headers['access-control-allow-origin']).toBe('http://web.test');
      const bad = await request(t.http).get('/health').set('Origin', 'http://evil.test');
      expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await t.close();
    }
  });
});
