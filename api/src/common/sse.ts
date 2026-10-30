import type { Response } from 'express';

/** Prepares an Express response for Server-Sent Events and flushes headers. */
export function openSse(res: Response): void {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable proxy buffering (nginx/Render)
  res.flushHeaders();
}

export function isOpen(res: Response): boolean {
  return !res.writableEnded && !res.destroyed;
}

/** Writes one SSE frame. `data` is sent verbatim when already a string (relay case). */
export function writeSse(res: Response, event: string, data: unknown): void {
  if (!isOpen(res)) return;
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  const lines = payload.split('\n').map((l) => `data: ${l}`).join('\n');
  res.write(`event: ${event}\n${lines}\n\n`);
}

export interface SseEvent {
  event: string;
  data: string;
}

/**
 * Incremental SSE parser (WHATWG event-stream subset: `event:`, `data:`,
 * comments, CRLF/LF). Feed decoded text chunks; get complete events back.
 */
export class SseParser {
  private buffer = '';
  private pendingCr = false;

  push(chunk: string): SseEvent[] {
    // A CRLF can be split across chunks: hold a trailing CR until we see what follows.
    let text = (this.pendingCr ? '\r' : '') + chunk;
    this.pendingCr = text.endsWith('\r');
    if (this.pendingCr) text = text.slice(0, -1);
    this.buffer += text.replace(/\r\n?/g, '\n');
    const events: SseEvent[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf('\n\n')) !== -1) {
      const block = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      const parsed = parseBlock(block);
      if (parsed) events.push(parsed);
    }
    return events;
  }

  /** Flushes a trailing event that wasn't terminated by a blank line. */
  end(): SseEvent[] {
    if (this.pendingCr) this.buffer += '\n';
    this.pendingCr = false;
    const rest = this.buffer.trim();
    this.buffer = '';
    const parsed = rest ? parseBlock(rest) : null;
    return parsed ? [parsed] : [];
  }
}

function parseBlock(block: string): SseEvent | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  if (data.length === 0) return null;
  return { event, data: data.join('\n') };
}
