import { describe, expect, it } from 'vitest';
import type { Message, ToolCall } from '../types.ts';
import { BACKEND_UNREACHABLE, failedTurnLine, isNetworkFailure, pastTurns, stageAnswerText } from './turns.ts';
import { stagePunctuation } from './caption.ts';

const tool = (name: string, id: string): ToolCall => ({ name, id, params: {}, status: 'completed' });

describe('pastTurns', () => {
  it('pairs each prompt with the reply after it, and leaves the turn on the stage out', () => {
    const messages: Message[] = [
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'Narration. First answer.', answer: 'First answer.', tools: [tool('get_rasters', 'a')], saw: { a: 'A clear scene.' } },
      { role: 'user', content: 'Second question' },
      { role: 'assistant', content: 'Second answer.' },
      { role: 'user', content: 'Third question' },
      { role: 'assistant', content: 'Third answer.' },
    ];
    const turns = pastTurns(messages);
    expect(turns.map((t) => t.question)).toEqual(['First question', 'Second question']);
    expect(turns[0]).toEqual({
      key: 'turn-0',
      question: 'First question',
      tools: [tool('get_rasters', 'a')],
      answer: 'First answer.',
      saw: { a: 'A clear scene.' },
      failed: false,
    });
    expect(turns[1].answer).toBe('Second answer.');
    expect(turns[1].tools).toEqual([]);
  });

  it('while a turn streams, lists every finished turn but not the question being worked', () => {
    const messages: Message[] = [
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer.' },
      { role: 'user', content: 'Being worked on' },
    ];
    expect(pastTurns(messages).map((t) => t.question)).toEqual(['First question']);
  });

  it('skips a message from the agent with no prompt before it (the crash notice)', () => {
    const messages: Message[] = [
      { role: 'assistant', content: 'The previous analysis session hit a runtime error and was automatically reset.' },
      { role: 'user', content: 'Again' },
      { role: 'assistant', content: 'Answer.' },
      { role: 'user', content: 'Next' },
    ];
    const turns = pastTurns(messages);
    expect(turns).toHaveLength(1);
    expect(turns[0].question).toBe('Again');
    expect(turns[0].key).toBe('turn-1');
  });

  it('keeps a stopped turn and marks a failed one', () => {
    const messages: Message[] = [
      { role: 'user', content: 'Stopped one' },
      { role: 'assistant', content: 'Stopped by the presenter.' },
      { role: 'user', content: 'Failed one' },
      { role: 'assistant', content: 'Error: ThrottlingException: Rate exceeded' },
      { role: 'user', content: 'On stage' },
      { role: 'assistant', content: 'Answer.' },
    ];
    const [stopped, failed] = pastTurns(messages);
    expect(stopped.answer).toBe('Stopped by the presenter.');
    expect(stopped.failed).toBe(false);
    expect(failed.failed).toBe(true);
  });

  it('lists nothing for a single turn or an empty session', () => {
    expect(pastTurns([])).toEqual([]);
    expect(pastTurns([{ role: 'user', content: 'Q' }, { role: 'assistant', content: 'A.' }])).toEqual([]);
  });
});

describe('stageAnswerText', () => {
  const raw = [
    '  The **Octagon** is clear — the walls read as trees.',
    '',
    '| Feature | Measured | Documented |',
    '|---|---|---|',
    '| Area | 20 ha | — |',
    '| Wall | 1.5 m | 1.7 m |',
    '',
    '| Check | Result |',
    '|---|---|',
    '| Cloud | — |',
    '',
  ].join('\n');

  it('prints a dash-only cell as nothing, never "(,)" or "," (A1 P1-5)', () => {
    const text = stageAnswerText(raw);
    // Punctuation first (the old order) left the two-column table's "—" cell as ",".
    expect(stagePunctuation(raw.trim())).toContain('| Cloud |, |');
    expect(text).not.toContain('(,)');
    expect(text).not.toMatch(/\|\s*,\s*\|/);
    expect(text).toContain('| Area | 20 ha |');
    expect(text).toContain('| Cloud |  |');
  });

  it('folds the live Central Park table without "(,)"', () => {
    const text = stageAnswerText('| Mean NDVI | 0.65 | — |\n|---|---|---|\n| a | b | — |');
    expect(text).not.toContain('(,)');
    expect(text.split('\n')).toEqual(['| Mean NDVI | 0.65 |', '|---|---|', '| a | b |']);
  });

  it('keeps the rest as before: an em dash in prose reads as a comma, three columns fold to two', () => {
    const text = stageAnswerText(raw);
    expect(text.split('\n')[0]).toBe('The **Octagon** is clear, the walls read as trees.');
    expect(text).toContain('| Feature | Measured (documented) |');
    expect(text).toContain('| Wall | 1.5 m (1.7 m) |');
    expect(text).not.toContain('Documented |');
    expect(stageAnswerText('Built 2024–2025 — by hand.')).toBe('Built 2024 to 2025, by hand.');
  });
});

describe('isNetworkFailure', () => {
  it("is the browsers' words for a request that never reached the backend", () => {
    expect(isNetworkFailure(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkFailure(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(true);
    expect(isNetworkFailure(new TypeError('Load failed'))).toBe(true);
  });
  it('is not an HTTP error, a stream error or a bug in the stage', () => {
    expect(isNetworkFailure(new Error('HTTP error! status: 502'))).toBe(false);
    expect(isNetworkFailure(new Error('ThrottlingException: Rate exceeded'))).toBe(false);
    expect(isNetworkFailure(new TypeError("Cannot read properties of undefined (reading 'tools')"))).toBe(false);
    expect(isNetworkFailure(undefined)).toBe(false);
  });
});

describe('failedTurnLine', () => {
  const unreachable = stageAnswerText(`Error: ${BACKEND_UNREACHABLE}`);
  it('says the stage cannot reach the backend, on the stage and in a record', () => {
    const line = "The stage can't reach the backend. Check the connection, then send the prompt again.";
    expect(failedTurnLine(unreachable)).toBe(line);
    expect(failedTurnLine(unreachable, { record: true })).toBe(line);
  });
  it('keeps the agent-stopped lines for every other error', () => {
    expect(failedTurnLine('Error: HTTP error! status: 502')).toBe(
      'The agent stopped before it answered. Send the prompt again, or open the transcript for the error.'
    );
    expect(failedTurnLine('Error: boom', { record: true })).toBe('The agent stopped before it answered.');
  });
  it('names the last step a turn reached before it failed, numbered as the column numbers it (B2)', () => {
    const tools = [tool('find_location_boundary', 'a'), tool('get_rasters', 'b')];
    expect(failedTurnLine('Error: ThrottlingException: Rate exceeded', { tools })).toBe(
      'The agent stopped at step 02, Fetch Sentinel-2. Send the prompt again; the steps it finished are above.'
    );
    expect(failedTurnLine('Error: boom', { record: true, tools })).toBe('The agent stopped at step 02, Fetch Sentinel-2.');
    // The backend line still wins: the agent never started.
    expect(failedTurnLine(unreachable, { tools })).toMatch(/^The stage can't reach the backend\./);
    // No steps: today's line.
    expect(failedTurnLine('Error: boom', { tools: [] })).toMatch(/^The agent stopped before it answered\./);
  });
  it('keeps a failed turn\'s steps in its record', () => {
    const turns = pastTurns([
      { role: 'user', content: 'First' },
      { role: 'assistant', content: 'Error: Rate exceeded', tools: [tool('find_location_boundary', 'a')] },
      { role: 'user', content: 'Second' },
    ]);
    expect(turns[0].failed).toBe(true);
    expect(turns[0].tools.map((t) => t.id)).toEqual(['a']);
  });
  it('marks the turn failed in the session record', () => {
    const turns = pastTurns([
      { role: 'user', content: 'First' },
      { role: 'assistant', content: `Error: ${BACKEND_UNREACHABLE}` },
      { role: 'user', content: 'Second' },
    ]);
    expect(turns[0].failed).toBe(true);
    expect(failedTurnLine(turns[0].answer, { record: true })).toMatch(/^The stage can't reach the backend\./);
  });
});
