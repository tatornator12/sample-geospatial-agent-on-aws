/**
 * The session's turns, for the step column's "Earlier in this session" rows. The column stages the
 * latest turn (the presenter's last prompt and what followed it); every turn before it is kept here
 * as a record the presenter can reopen: its question, its steps, and the answer the stage showed.
 */
import type { Message, ToolCall } from '../types.ts';
import { stagePunctuation } from './caption.ts';
import { blankDashCells, twoColumnTables } from './tables.ts';

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
 * The answer as the step column prints it: a table cell that is only the model's dash goes empty,
 * every table folds to two columns at most (a third column the model wrote anyway joins the
 * second), then the stage's punctuation. In that order, so a "—" cell is never folded in as "(,)"
 * or left as "," (A1 P1-5).
 */
export function stageAnswerText(raw: string): string {
  return stagePunctuation(twoColumnTables(blankDashCells(raw.trim())));
}

/** What the transcript records when the prompt never reached the stage backend (S8). */
export const BACKEND_UNREACHABLE = "The stage can't reach the backend.";

/**
 * The prompt's request failed before any answer: the browser's own words for a network failure
 * (Chrome "Failed to fetch", Firefox "NetworkError when attempting to fetch resource.", Safari
 * "Load failed"). Matched on the message, not the TypeError class, so a bug in the stage's own
 * code is never told as a dead connection.
 */
export function isNetworkFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /failed to fetch|networkerror|load failed/i.test(message);
}

/**
 * The line a failed turn shows instead of its error: on the stage (`record` false) and in an
 * earlier turn's record (`record` true). A prompt that never reached the backend says so, not
 * that the agent stopped (it never started).
 */
export function failedTurnLine(answer: string, { record = false }: { record?: boolean } = {}): string {
  if (answer.startsWith(`Error: ${BACKEND_UNREACHABLE}`)) {
    return `${BACKEND_UNREACHABLE} Check the connection, then send the prompt again.`;
  }
  return record
    ? 'The agent stopped before it answered.'
    : 'The agent stopped before it answered. Send the prompt again, or open the transcript for the error.';
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
