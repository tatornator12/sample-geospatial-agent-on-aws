import { describe, expect, it } from 'vitest';
import type { Message, ToolCall } from '../types.ts';
import { pastTurns, stageAnswerText } from './turns.ts';
import { stagePunctuation } from './caption.ts';
import { twoColumnTables } from './tables.ts';

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
  it('prints the answer exactly as the stage did before (punctuation, then two columns)', () => {
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
    // The same order as before the earlier turns existed (Group 4 changes it, for the "(,)" cells).
    const text = stageAnswerText(raw);
    expect(text).toBe(twoColumnTables(stagePunctuation(raw.trim())));
    expect(text.split('\n')[0]).toBe('The **Octagon** is clear, the walls read as trees.');
    expect(text).toContain('| Feature | Measured (documented) |');
    expect(text).not.toContain('Documented |');
  });
});
