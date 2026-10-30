import { SseParser } from './sse';

describe('SseParser', () => {
  it('parses events split across arbitrary chunk boundaries', () => {
    const p = new SseParser();
    const stream = 'event: meta\ndata: {"a":1}\n\n: comment\n\nevent: token\r\ndata: {"text":"hi"}\r\n\r\ndata: multi\ndata: line\n\n';
    const events = [];
    for (let i = 0; i < stream.length; i += 3) events.push(...p.push(stream.slice(i, i + 3)));
    events.push(...p.end());
    expect(events).toEqual([
      { event: 'meta', data: '{"a":1}' },
      { event: 'token', data: '{"text":"hi"}' },
      { event: 'message', data: 'multi\nline' },
    ]);
  });

  it('flushes an unterminated final event', () => {
    const p = new SseParser();
    expect(p.push('event: done\ndata: {}')).toEqual([]);
    expect(p.end()).toEqual([{ event: 'done', data: '{}' }]);
  });
});
