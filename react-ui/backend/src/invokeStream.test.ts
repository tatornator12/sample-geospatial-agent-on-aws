import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { abortOnClientClose, relayAgentStream, type RelayResult } from './invokeStream';

const enc = (s: string) => new TextEncoder().encode(s);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await sleep(10);
  }
  return check();
}

interface Seen {
  signal?: AbortSignal;
  result?: RelayResult;
}

/** A scratch SSE server shaped like /api/agent/invoke: express.json(), then the relay. */
async function scratchServer(makeStream: (signal: AbortSignal) => AsyncIterable<unknown>) {
  const seen: Seen = {};
  const app = express();
  app.use(express.json());
  app.post('/invoke', async (_req, res) => {
    const signal = abortOnClientClose(res).signal;
    seen.signal = signal;
    res.setHeader('Content-Type', 'text/event-stream');
    res.flushHeaders();
    res.write(': connected\n\n');
    const result = await relayAgentStream(makeStream(signal), res, signal);
    seen.result = result;
    if (!result.aborted) {
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    }
  });
  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  return { seen, port, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

/** POST a prompt and hand every parsed `data:` event to `onEvent` (which may drop the request). */
function invoke(port: number, onEvent: (event: { type: string; content?: string }, req: http.ClientRequest) => void) {
  return new Promise<void>((resolve) => {
    const body = JSON.stringify({ prompt: 'q', sessionId: 'x'.repeat(36) });
    const req = http.request(
      { port, path: '/invoke', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        let buffer = '';
        res.setEncoding('utf8');
        res.on('data', (text: string) => {
          buffer += text;
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (line.startsWith('data: ')) onEvent(JSON.parse(line.slice(6)), req);
          }
        });
        res.on('end', () => resolve());
        res.on('close', () => resolve());
        res.on('error', () => resolve());
      },
    );
    req.on('error', () => resolve());
    req.end(body);
  });
}

describe('abortOnClientClose and relayAgentStream', () => {
  it('stops reading the agent within a second of the client leaving', async () => {
    const agent = { finallyRan: false };
    const { seen, port, close } = await scratchServer(async function* (signal) {
      try {
        yield enc('data: "hello"\n');
        // The agent goes quiet (a long tool), until the client has gone.
        await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
        yield enc('data: "never sent"\n');
      } finally {
        agent.finallyRan = true;
      }
    });
    try {
      const events: Array<{ type: string; content?: string }> = [];
      let droppedAt = 0;
      await invoke(port, (event, req) => {
        events.push(event);
        droppedAt = Date.now();
        req.destroy();
      });
      assert.deepEqual(events, [{ type: 'chunk', content: 'hello' }]);

      assert.ok(await waitFor(() => !!seen.signal?.aborted, 1000), 'the signal aborts when the client leaves');
      assert.ok(await waitFor(() => !!seen.result, 1000), 'the relay returns');
      assert.ok(Date.now() - droppedAt < 1000);
      assert.equal(seen.result?.aborted, true);
      assert.equal(seen.result?.chunks, 1);
      assert.ok(await waitFor(() => agent.finallyRan, 1000), "the agent stream's finally ran");
    } finally {
      await close();
    }
  });

  it('relays a stream that ends, in order, and never aborts after the response ends', async () => {
    const { seen, port, close } = await scratchServer(async function* () {
      yield enc('data: "first"\n');
      yield enc('data: "second"\n');
    });
    try {
      const events: Array<{ type: string; content?: string }> = [];
      await invoke(port, (event) => events.push(event));
      assert.deepEqual(events, [
        { type: 'chunk', content: 'first' },
        { type: 'chunk', content: 'second' },
        { type: 'done' },
      ]);
      // `res` closes after a finished response too: that must not read as the client leaving.
      await sleep(100);
      assert.equal(seen.result?.aborted, false);
      assert.equal(seen.signal?.aborted, false);
    } finally {
      await close();
    }
  });
});

describe('relayAgentStream parsing (unchanged from the inline loop)', () => {
  async function relayed(chunks: Array<string | Uint8Array>) {
    const written: string[] = [];
    const result = await relayAgentStream(
      (async function* () {
        for (const c of chunks) yield c;
      })(),
      { write: (s: string) => written.push(s) },
      new AbortController().signal,
    );
    return { result, events: written.map((w) => JSON.parse(w.replace(/^data: /, '').trim())) };
  }

  it('unquotes and unescapes a tool object', async () => {
    const { events } = await relayed([enc('data: "{\\"toolUseId\\": \\"x\\"}"\n')]);
    assert.deepEqual(events, [{ type: 'chunk', content: '{"toolUseId": "x"}' }]);
  });

  it('joins lines split across chunks and flushes a trailing line without a newline', async () => {
    const { events, result } = await relayed([enc('data: "par'), enc('tial"\ndata: "tail"')]);
    assert.deepEqual(events, [
      { type: 'chunk', content: 'partial' },
      { type: 'chunk', content: 'tail' },
    ]);
    assert.deepEqual(result, { chunks: 2, bytes: 28, aborted: false });
  });

  it('drops [DONE], comments and empty data lines; plain data passes as sent', async () => {
    const { events } = await relayed(['data: [DONE]\n: keepalive\ndata: \ndata: plain text\n']);
    assert.deepEqual(events, [{ type: 'chunk', content: 'plain text' }]);
  });

  it('writes nothing when the signal is already aborted', async () => {
    const written: string[] = [];
    const ctl = new AbortController();
    ctl.abort();
    const result = await relayAgentStream(
      (async function* () {
        yield enc('data: "x"\n');
      })(),
      { write: (s: string) => written.push(s) },
      ctl.signal,
    );
    assert.equal(result.aborted, true);
    assert.deepEqual(written, []);
  });
});
