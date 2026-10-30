import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { Pool } from 'pg';

export const INTERNAL_TOKEN = 'test-internal-token';

interface Call {
  token: string | undefined;
  body: Record<string, unknown>;
}

type Ev = [event: string, data: unknown];

/**
 * Minimal stand-in for the ai service, speaking the contract's HTTP + SSE
 * protocol. Chat behaviour is picked by keywords in the message so each test
 * reads as a scenario. /ingest mimics ai by writing the document status.
 */
export class FakeAi {
  server!: Server;
  url = '';
  ingestCalls: Call[] = [];
  chatCalls: Call[] = [];
  chatAborted = 0;
  /** Status codes to return for the next /ingest calls (then 200). */
  ingestFailures: number[] = [];

  constructor(private readonly pool: Pool) {}

  async start(): Promise<this> {
    this.server = createServer((req, res) => void this.route(req, res));
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  async stop() {
    this.server.closeAllConnections();
    await new Promise((r) => this.server.close(r));
  }

  private async route(req: IncomingMessage, res: ServerResponse) {
    const body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
    const token = req.headers['x-internal-token'] as string | undefined;
    if (token !== INTERNAL_TOKEN) {
      res.writeHead(401).end('{"detail":"unauthorized"}');
      return;
    }
    if (req.url === '/ingest') return this.ingest(body, token, res);
    if (req.url === '/chat') return this.chat(body, token, res);
    res.writeHead(404).end();
  }

  private async ingest(body: Record<string, unknown>, token: string, res: ServerResponse) {
    this.ingestCalls.push({ token, body });
    const fail = this.ingestFailures.shift();
    if (fail) {
      if (fail === 422) {
        await this.pool.query(`UPDATE documents SET status = 'failed', error = 'unreadable file' WHERE id = $1`, [body.document_id]);
      }
      res.writeHead(fail, { 'Content-Type': 'application/json' }).end('{"detail":"simulated"}');
      return;
    }
    await this.pool.query(
      `UPDATE documents SET status = 'indexed', chunk_count = 3, error = NULL, updated_at = now() WHERE id = $1`,
      [body.document_id],
    );
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ document_id: body.document_id, status: 'indexed', chunk_count: 3 }));
  }

  private async chat(body: Record<string, unknown>, token: string, res: ServerResponse) {
    this.chatCalls.push({ token, body });
    const message = String(body.message);
    if (message.includes('HTTP500')) {
      res.writeHead(500).end('boom');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.on('close', () => {
      if (!res.writableFinished) this.chatAborted++;
    });

    const { redacted, redactions } = redact(message);
    const send = ([event, data]: Ev) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const intent = message.includes('lawyer')
      ? 'complaint'
      : message.includes('human')
        ? 'human_request'
        : message.toLowerCase().includes('invoice')
          ? 'billing'
          : 'how_to';
    send(['meta', { intent, intent_reason: 'keyword', redacted_message: redacted, redactions }]);

    if (message.includes('AI_ERROR')) {
      send(['error', { message: 'model overloaded' }]);
      res.end();
      return;
    }
    if (message.includes('SLOW')) {
      for (let i = 0; i < 50 && !res.destroyed; i++) {
        send(['token', { text: `t${i} ` }]);
        await new Promise((r) => setTimeout(r, 100));
      }
      res.end();
      return;
    }
    send(['token', { text: 'Our warranty ' }]);
    send(['token', { text: 'covers 2 years [1].' }]);
    if (message.includes('NODONE')) {
      res.end();
      return;
    }

    let done: Record<string, unknown> = {
      answer: 'Our warranty covers 2 years [1].',
      intent,
      confidence: 0.82,
      confidence_breakdown: { retrieval: 0.9, coverage: 1, answerable: 1 },
      citations: [{ n: 1, chunk_id: 1, document_id: 'd', document_title: 'Warranty', heading: 'Coverage', page: null, snippet: '2 years' }],
      escalate: false,
      escalation_reason: null,
      ticket: null,
      usage: { input_tokens: 100, output_tokens: 20 },
    };
    if (intent === 'human_request') {
      send(['tool', { name: 'handoff_to_human', input: { reason: 'visitor asked for a human' } }]);
      done = { ...done, answer: 'Connecting you with a teammate.', confidence: 0.7, escalate: true, escalation_reason: 'human_request', ticket: { subject: 'Visitor wants a human', summary: `Visitor said: ${redacted}`, priority: 'normal' } };
    } else if (intent === 'complaint') {
      send(['tool', { name: 'create_ticket', input: { subject: 'Legal threat', priority: 'urgent' } }]);
      done = { ...done, answer: 'I have escalated this to our team.', confidence: 0.6, escalate: true, escalation_reason: 'complaint', ticket: { subject: 'Legal threat over refund', summary: redacted, priority: 'urgent' } };
    } else if (message.includes('unsure')) {
      done = { ...done, answer: "I'm not sure.", confidence: 0.3, escalate: true, escalation_reason: 'low_confidence', ticket: null };
    }
    send(['done', done]);
    res.end();
  }
}

function redact(text: string) {
  let emails = 0;
  let cards = 0;
  const redacted = text
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, () => `[EMAIL_${++emails}]`)
    .replace(/\b(?:\d[ -]?){15}\d\b/g, () => `[CARD_${++cards}]`);
  const redactions = [];
  if (emails) redactions.push({ type: 'EMAIL', count: emails });
  if (cards) redactions.push({ type: 'CARD', count: cards });
  return { redacted, redactions };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c: Buffer) => (data += c.toString()));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/** Records webhook deliveries; responds with `status`. */
export class FakeWebhook {
  server!: Server;
  url = '';
  status = 200;
  deliveries: { headers: IncomingMessage['headers']; raw: string }[] = [];

  async start(): Promise<this> {
    this.server = createServer((req, res) => {
      void readBody(req).then((raw) => {
        this.deliveries.push({ headers: req.headers, raw });
        res.writeHead(this.status).end('{}');
      });
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/webhook/signalroom-escalation`;
    return this;
  }

  async stop() {
    this.server.closeAllConnections();
    await new Promise((r) => this.server.close(r));
  }
}
