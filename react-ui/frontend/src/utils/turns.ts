/**
 * The session's turns, for the step column's "Earlier in this session" rows. The column stages the
 * latest turn (the presenter's last prompt and what followed it); every turn before it is kept here
 * as a record the presenter can reopen: its question, its steps, and the answer the stage showed.
 */
import type { Message, ToolCall } from '../types.ts';
import { stagePunctuation } from './caption.ts';
import { twoColumnTables } from './tables.ts';

export interface PastTurn {
  /** Stable per session: the user message's position. */
  key: string;
  question: string;
  tools: ToolCall[];
  /** The answer as the stage showed it (stageAnswerText). */
  answer: string;
  /** What the agent said it saw, by inspect_image tool id. */
  saw?: Record<string, string>;
  /** The turn ended in an error; the stage says "The agent stopped before it answered" instead. */
  failed: boolean;
}

/**
 * The answer as the step column prints it: the stage's punctuation, then two columns at most per
 * table (a third column the model wrote anyway folds into the second).
 */
export function stageAnswerText(raw: string): string {
  return twoColumnTables(stagePunctuation(raw.trim()));
}

/**
 * Every turn before the one on the stage, oldest first. A turn is a presenter's prompt and the
 * agent's message after it. The turn on the stage is the last prompt and whatever followed it
 * (still streaming, or just finished), so it is never listed. A message from the agent with no
 * prompt before it (the crash notice, "Loading the replay case") is not a turn.
 */
export function pastTurns(messages: Message[]): PastTurn[] {
  const lastUser = messages.map((m) => m.role).lastIndexOf('user');
  const turns: PastTurn[] = [];
  for (let i = 0; i < lastUser; i++) {
    const user = messages[i];
    if (user.role !== 'user') continue;
    const reply = messages[i + 1]?.role === 'assistant' ? messages[i + 1] : undefined;
    const answer = reply ? stageAnswerText(reply.answer ?? reply.content) : '';
    turns.push({
      key: `turn-${i}`,
      question: user.content,
      tools: reply?.tools ?? [],
      answer,
      ...(reply?.saw ? { saw: reply.saw } : {}),
      failed: /^Error:/.test(answer),
    });
  }
  return turns;
}
