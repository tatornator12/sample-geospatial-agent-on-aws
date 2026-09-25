/**
 * The analyst's decision, UI side. The brief id comes from the agent's answer (the brief's
 * markdown names it: "(draft `brief-…`, not filed)"); the card's contents come from the backend,
 * which reads the draft from S3, so nothing model-written in the answer reaches the card.
 */
import type { Message } from '../types.ts';

const DRAFT_ID = /draft `(brief-\d{8}T\d{6}-[0-9a-f]{6})`/g;
const ANY_ID = /\bbrief-\d{8}T\d{6}-[0-9a-f]{6}\b/;

/** The last brief id a text names as a draft, or null. */
export function draftBriefId(text: string): string | null {
  let last: string | null = null;
  for (const m of text.matchAll(DRAFT_ID)) last = m[1];
  return last;
}

/** The two things the analyst can say, as the agent's prompt expects them (methane_config.py). */
export const approvedMessage = (briefId: string) => `The analyst approved and filed brief ${briefId}`;
export const anotherLookMessage = (briefId: string) => `Request another look at brief ${briefId}`;

/**
 * The brief the stage should show: the one the latest answer drafted, or, while the analyst's
 * decision on it is being answered, that one. Null once the conversation has moved on.
 */
export function currentBriefId(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'assistant') {
      const drafted = draftBriefId(m.content || '');
      if (drafted) return drafted;
      continue;
    }
    // A user turn: a decision about a brief keeps it on the stage; anything else ends it.
    const content = m.content || '';
    const named = content.match(ANY_ID)?.[0] ?? null;
    if (named && (content === approvedMessage(named) || content === anotherLookMessage(named))) return named;
    return null;
  }
  return null;
}
