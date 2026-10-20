/**
 * The agent's stream relayed to the stage as SSE, and stopped the moment the stage leaves.
 *
 * New session, Stop and Esc abort the browser's request. Without this the backend kept reading
 * AgentCore and writing keepalives until the agent finished (a 23 s tail in the Oct 20 review),
 * holding the runtime busy for a turn nobody was reading.
 */
import type { ServerResponse } from 'http';

type ClosingResponse = Pick<ServerResponse, 'on' | 'writableFinished'>;
type ChunkWriter = { write(chunk: string): unknown };

/**
 * An AbortController that aborts when the client goes away before the response finished.
 *
 * `res` close, not `req` close: since Node 16 a request emits `close` once its body has been read,
 * and `express.json()` has read it before the route runs, so a `req` listener would abort every
 * turn (or never fire). `res` closes for both a finished response and a dropped client; only the
 * second has `writableFinished` false.
 */
export function abortOnClientClose(res: ClosingResponse): AbortController {
  const ctl = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) ctl.abort();
  });
  return ctl;
}

export interface RelayResult {
  chunks: number;
  bytes: number;
  /** The client left before the agent finished; nothing was written after that. */
  aborted: boolean;
}

/** One SSE `data:` line from AgentCore as the stage's chunk text, or null for nothing to send. */
function cleanDataLine(line: string): string | null {
  if (!line.startsWith('data: ')) return null;
  const data = line.substring(6).trim();
  if (!data || data === '[DONE]') return null;
  // Remove outer quotes if present (SSE wraps data in quotes)
  let cleaned = data;
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.slice(1, -1);
    // After removing outer quotes, unescape the content
    // This converts {\"toolUseId\": ...} back to {"toolUseId": ...}
    cleaned = cleaned.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
  }
  return cleaned || null;
}

/**
 * Relay AgentCore's SSE byte stream to the client as `{"type":"chunk"}` events (mimicking Python's
 * iter_lines()), until it ends or `signal` aborts. On abort the read stops at once, even mid-wait,
 * the agent's stream is destroyed (closing the connection to AgentCore) and nothing more is written.
 */
export async function relayAgentStream(
  stream: AsyncIterable<unknown> & { destroy?: (error?: Error) => void },
  res: ChunkWriter,
  signal: AbortSignal,
): Promise<RelayResult> {
  let buffer = '';
  let chunkCount = 0;
  let totalBytes = 0;
  const send = (content: string) => {
    if (!signal.aborted) res.write(`data: ${JSON.stringify({ type: 'chunk', content })}\n\n`);
  };

  const iterator = stream[Symbol.asyncIterator]();
  let onAbort: () => void = () => {};
  const abortedWait = new Promise<'aborted'>((resolve) => {
    onAbort = () => resolve('aborted');
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });

  try {
    while (!signal.aborted) {
      const pending = iterator.next();
      // A read still pending when the client leaves may reject once the stream is destroyed.
      pending.catch(() => {});
      const next = await Promise.race([pending, abortedWait]);
      if (next === 'aborted' || next.done) break;
      const chunk = next.value;
      if (!chunk) continue;

      chunkCount++;
      // Decode the chunk
      const chunkText = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk as Uint8Array);
      totalBytes += chunkText.length;
      buffer += chunkText;

      if (chunkCount <= 3 || chunkCount % 10 === 0) {
        console.log(`📦 Chunk #${chunkCount}: ${chunkText.length} bytes (total: ${totalBytes})`);
      }

      // Process complete lines (SSE format: "data: ...")
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        const cleaned = cleanDataLine(line);
        if (cleaned) {
          send(cleaned);
        } else if (line.trim() && !line.startsWith('data: ') && !line.startsWith(':')) {
          // Log non-empty, non-comment lines that aren't data: prefixed
          console.log(`⚠️ Non-data SSE line: ${line.substring(0, 100)}`);
        }
      }
    }
  } catch (streamError) {
    if (!signal.aborted) {
      console.error(`❌ Error reading from Bedrock stream after ${chunkCount} chunks, ${totalBytes} bytes:`, streamError);
      throw streamError;
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
  }

  if (signal.aborted) {
    // Stop reading AgentCore: close its stream (and the connection under it) and let the
    // iterator finish whenever it next can.
    try {
      stream.destroy?.();
    } catch {
      // already closed
    }
    iterator.return?.().catch(() => {});
    return { chunks: chunkCount, bytes: totalBytes, aborted: true };
  }
  console.log(`✅ Bedrock stream completed successfully (${chunkCount} chunks, ${totalBytes} bytes)`);

  // Process any remaining data in buffer
  if (buffer.trim()) {
    const cleaned = cleanDataLine(buffer);
    if (cleaned) send(cleaned);
  }
  return { chunks: chunkCount, bytes: totalBytes, aborted: false };
}
