/**
 * The agent's own words on the stage: the sentence it is saying now (under the lit step while a
 * turn streams) and what it said it saw after each `inspect_image` call ("Saw: …" under the chip).
 *
 * The words are the model's, so nothing here rewrites them: a sentence is shown as written (with
 * the stage's punctuation and the markdown taken off, and a bracketed technical aside such as
 * "(aoi_cloud_pct 0%)" left out) or not at all. A sentence that names a tool, a file, a URL or
 * code is dropped rather than edited, and a sentence still streaming is never shown half-written.
 */
import type { EvidenceItem } from './evidence.ts';
import { stagePunctuation } from './caption.ts';
import { stepName } from './stageCopy.ts';

const TOOL_START = '{"toolUseId":';

/** The narration line's length, and the Saw line's, in characters (an ellipsis ends a cut). */
export const NARRATION_MAX = 120;
export const SAW_MAX = 140;

export interface ToolSpan {
  start: number;
  end: number;
  id: string;
  name: string;
}

/** The index just past the brace that closes the object opened at `start`, or -1 while it is open. */
function closingBrace(raw: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * The tool objects in the stream, in order (the same balanced-brace scan as utils/parsing.ts), and
 * where an unfinished one starts (null when none is streaming).
 */
export function toolSpans(raw: string): { spans: ToolSpan[]; openFrom: number | null } {
  const spans: ToolSpan[] = [];
  let pos = 0;
  while (pos < raw.length) {
    const start = raw.indexOf(TOOL_START, pos);
    if (start === -1) break;
    const end = closingBrace(raw, start);
    if (end === -1) return { spans, openFrom: start };
    let id = '';
    let name = '';
    try {
      const obj = JSON.parse(raw.slice(start, end)) as Record<string, unknown>;
      if (typeof obj.toolUseId === 'string') id = obj.toolUseId;
      if (typeof obj.name === 'string') name = obj.name;
    } catch {
      // A balanced object that is not JSON is still not prose.
    }
    spans.push({ start, end, id, name });
    pos = end;
  }
  return { spans, openFrom: null };
}

const OPEN_TOOL = /^\{"toolUseId":\s*"([A-Za-z0-9_-]{1,128})",\s*"name":\s*"([a-z_][a-z0-9_]{0,63})"/;

/**
 * The tool the agent has started and not yet finished: every runtime streams a call's opening
 * `{"toolUseId": "…", "name": "…", "input": "` when the model starts it and closes it only once
 * the tool has run and the next text or call begins. So the step lights while the tool works,
 * not after (A1 P1-2). Only an id and a tool name of the expected shape; null when none is open.
 */
export function openTool(raw: string): { id: string; name: string } | null {
  const { openFrom } = toolSpans(raw);
  if (openFrom === null) return null;
  const m = raw.slice(openFrom, openFrom + 260).match(OPEN_TOOL);
  return m ? { id: m[1], name: m[2] } : null;
}

interface Segment {
  text: string;
  /** Still streaming: nothing after it yet, so its last sentence may be half-written. */
  open: boolean;
  /** The tool call the segment follows. */
  after?: ToolSpan;
}

/** The prose between the tool calls, in order. */
function segments(raw: string, finished: boolean): Segment[] {
  const { spans, openFrom } = toolSpans(raw);
  const out: Segment[] = [];
  let from = 0;
  let prev: ToolSpan | undefined;
  for (const span of spans) {
    out.push({ text: raw.slice(from, span.start), open: false, after: prev });
    from = span.end;
    prev = span;
  }
  out.push({ text: raw.slice(from, openFrom ?? raw.length), open: openFrom === null && !finished, after: prev });
  return out;
}

const LIST_MARKER = /^([-*+]|\d{1,3}[.)])\s+/;
const TABLE_ROW = /^\|/;
const HEADING = /^#{1,6}(\s|$)/;
const RULE = /^([-*_])(\s*\1){2,}$/;
const FENCE = /^(```|~~~)/;

/** Paragraphs and list items as single lines; tables, headings, rules and code are not prose. */
function blocks(text: string): string[] {
  const out: string[] = [];
  let current: string[] = [];
  let inFence = false;
  const flush = () => {
    if (current.length) out.push(current.join(' '));
    current = [];
  };
  for (const raw of text.split('\n')) {
    let line = raw.trim().replace(/^(>\s?)+/, '').trim();
    if (FENCE.test(line)) {
      inFence = !inFence;
      flush();
      continue;
    }
    if (inFence) continue;
    if (!line || TABLE_ROW.test(line) || HEADING.test(line) || RULE.test(line)) {
      flush();
      continue;
    }
    if (LIST_MARKER.test(line)) {
      flush();
      line = line.replace(LIST_MARKER, '');
    }
    current.push(line);
  }
  flush();
  return out;
}

/** The markdown taken off a line: images go, links keep their words, emphasis keeps its text. */
function unwrap(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|[^\w])_([^_\s][^_]*?)_(?=[^\w]|$)/g, '$1$2')
    .replace(/\*+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// A sentence ends at . ! ? or … (a closing quote or bracket may follow) before a capital, a digit
// or an opening quote; "0.65" and "40.78, -73.96" stay whole.
const SENTENCE_BREAK = /(?<=[.!?…]["”’)]?)\s+(?=[A-Z0-9“"‘(])/;
const ENDS_SENTENCE = /[.!?…]["”’)]?$/;
const SNAKE_CASE = /\b[a-z0-9]+_[a-z0-9_]+\b/i;
const NOT_PROSE = /[`{}|]|s3:\/\/|\bhttps?\b|www\./i;

/** A tool's own name (`calculator` has no underscore; stepName knows it). */
function isToolName(word: string): boolean {
  return stepName(word) !== word.replace(/_/g, ' ');
}

/**
 * A technical aside in brackets goes, the sentence around it stays: "perfectly clear over Central
 * Park (aoi_cloud_pct 0%); the park reads…" loses only "(aoi_cloud_pct 0%)". An aside in words stays.
 */
function withoutTechnicalAsides(sentence: string): string {
  return sentence
    .replace(/\s*\(([^()]*)\)/g, (aside, inner: string) => {
      const words = inner.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
      return NOT_PROSE.test(inner) || SNAKE_CASE.test(inner) || words.some(isToolName) ? '' : aside;
    })
    .replace(/\s+([,;:.!?…])/g, '$1');
}

function passes(sentence: string): boolean {
  if (NOT_PROSE.test(sentence) || SNAKE_CASE.test(sentence)) return false;
  if (!ENDS_SENTENCE.test(sentence)) return false;
  const words = sentence.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  return words.length >= 3 && !words.some(isToolName);
}

/**
 * The prose's sentences as the stage may print them, in order. With `open`, the text is still
 * streaming and its last sentence counts only once the next one has begun.
 */
export function stageSentences(text: string, { open = false }: { open?: boolean } = {}): string[] {
  const pieces = blocks(text)
    .flatMap((b) => unwrap(b).split(SENTENCE_BREAK))
    .map((s) => s.trim())
    .filter(Boolean);
  if (open) pieces.pop();
  return pieces
    .map(withoutTechnicalAsides)
    .filter(passes)
    .map((s) => stagePunctuation(s).replace(/\s+/g, ' ').trim());
}

/** At most `max` characters, cut at a word and ended with an ellipsis. */
export function capWords(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.lastIndexOf(' ', max - 1);
  const head = (cut > 0 ? s.slice(0, cut) : s.slice(0, max - 1)).replace(/[\s,;:.–—-]+$/, '');
  return `${head}…`;
}

/**
 * The latest sentence the agent finished saying this turn, for the line under the lit step. A
 * sentence a chip's "Saw:" line already prints (`sawShown` says which inspect_image calls have a
 * chip with a Saw line on the stage) is skipped, so the room reads it once, under the chip: the
 * line keeps the sentence before it, and moves on with the next one that is not a Saw (a "Next
 * I'll…" sentence, the next step's words).
 */
export function latestNarration(raw: string, { sawShown }: { sawShown?: (toolId: string) => boolean } = {}): string | null {
  const segs = segments(raw, false);
  for (let i = segs.length - 1; i >= 0; i--) {
    let sentences = stageSentences(segs[i].text, { open: segs[i].open });
    const after = segs[i].after;
    if (sawShown && after?.name === 'inspect_image' && after.id && sawShown(after.id)) {
      // The same sentences, picked the same way, as sawByTool gives the chip.
      const said = new Set(sawParts(sentences).used);
      sentences = sentences.filter((s) => !said.has(s));
    }
    if (sentences.length > 0) return capWords(sentences[sentences.length - 1], NARRATION_MAX);
  }
  return null;
}

// "Next I'll compute the index" says what comes next, not what the agent saw.
const PLANNING = /^(now|next|then|first|let me|i[’']?ll|i will|i[’']?m going to|i am going to)\b/i;

/** The first sentences that describe, up to SAW_MAX (null when there are none), and which they are. */
function sawParts(sentences: string[]): { text: string | null; used: string[] } {
  let text = '';
  const used: string[] = [];
  for (const s of sentences.filter((x) => !PLANNING.test(x))) {
    const next = text ? `${text} ${s}` : s;
    if (next.length > SAW_MAX) {
      if (!text) {
        text = capWords(s, SAW_MAX);
        used.push(s);
      }
      break;
    }
    text = next;
    used.push(s);
  }
  return { text: text || null, used };
}

function sawFrom(sentences: string[]): string | null {
  return sawParts(sentences).text;
}

/**
 * What the agent said it saw after each inspect_image call (its words up to the next tool call),
 * by tool id. While the turn streams, only finished sentences count.
 */
export function sawByTool(raw: string, { finished = false }: { finished?: boolean } = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const seg of segments(raw, finished)) {
    if (seg.after?.name !== 'inspect_image' || !seg.after.id) continue;
    const saw = sawFrom(stageSentences(seg.text, { open: seg.open }));
    if (saw) out[seg.after.id] = saw;
  }
  return out;
}

/** A recorded observation (a replay case's `saw`), held to the same rules; null when none passes. */
export function boundedSaw(value: unknown): string | null {
  return typeof value === 'string' ? sawFrom(stageSentences(value.slice(0, 2000))) : null;
}

/** The evidence items with what the agent saw beside each, where it said. */
export function withSaw(items: EvidenceItem[], saw?: Record<string, string> | null): EvidenceItem[] {
  if (!saw) return items;
  return items.map((item) =>
    Object.prototype.hasOwnProperty.call(saw, item.toolId) && saw[item.toolId] ? { ...item, saw: saw[item.toolId] } : item
  );
}
