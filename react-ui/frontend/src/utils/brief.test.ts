import { describe, expect, it } from 'vitest';
import type { Message } from '../types.ts';
import { anotherLookMessage, approvedMessage, currentBriefId, draftBriefId } from './brief.ts';

const ID = 'brief-20260925T201500-a1b2c3';
const ID2 = 'brief-20260925T203000-ffffff';
const draftText = (id: string) => `**Methane Watch brief: Recurring methane** (draft \`${id}\`, not filed)\n\nDecision: analyst's.`;
const user = (content: string): Message => ({ role: 'user', content }) as Message;
const agent = (content: string): Message => ({ role: 'assistant', content }) as Message;

describe('draftBriefId', () => {
  it('reads the id the brief names as a draft, the last one when there are two', () => {
    expect(draftBriefId(draftText(ID))).toBe(ID);
    expect(draftBriefId(`${draftText(ID)}\n${draftText(ID2)}`)).toBe(ID2);
    expect(draftBriefId(`I filed ${ID}`)).toBeNull();
    expect(draftBriefId('draft `brief-2026`')).toBeNull();
  });
});

describe('currentBriefId', () => {
  it('shows the brief the latest answer drafted', () => {
    expect(currentBriefId([user('Brief me'), agent(draftText(ID))])).toBe(ID);
  });

  it('keeps it on the stage through the analyst\'s decision and the answer to it', () => {
    expect(currentBriefId([user('Brief me'), agent(draftText(ID)), user(approvedMessage(ID))])).toBe(ID);
    expect(currentBriefId([user('Brief me'), agent(draftText(ID)), user(approvedMessage(ID)), agent('The analyst filed it.')])).toBe(ID);
    expect(currentBriefId([agent(draftText(ID)), user(anotherLookMessage(ID)), agent(draftText(ID2))])).toBe(ID2);
  });

  it('lets it go once the conversation moves on', () => {
    expect(currentBriefId([agent(draftText(ID)), user('Show me the Permian'), agent('39 plumes')])).toBeNull();
    // A typed message that merely mentions the id is not a decision.
    expect(currentBriefId([agent(draftText(ID)), user(`what about ${ID}?`)])).toBeNull();
    expect(currentBriefId([])).toBeNull();
  });
});
