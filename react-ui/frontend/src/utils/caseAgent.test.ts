import { describe, expect, it } from 'vitest';
import { caseAgent } from './caseAgent.ts';

const OFFERED = ['stable', 'dev', 'methane', 'archaeologist', 'vessels'];

describe('caseAgent', () => {
  it("plays a case on its own act when the backend offers it", () => {
    expect(caseAgent({ caseAgent: 'methane', linkAgent: 'stable', defaultAgentId: 'stable', offered: OFFERED })).toBe('methane');
  });

  it("uses the link's act when the case names none", () => {
    expect(caseAgent({ caseAgent: null, linkAgent: 'stable', defaultAgentId: 'dev', offered: OFFERED })).toBe('stable');
  });

  it('falls back to the default act, never the act that happens to be selected', () => {
    // Selected: vessels. The case and its link name no act.
    expect(caseAgent({ defaultAgentId: 'stable', offered: OFFERED })).toBe('stable');
    expect(caseAgent({ caseAgent: undefined, linkAgent: null, defaultAgentId: 'stable', offered: OFFERED })).not.toBe('vessels');
  });

  it('skips acts the backend does not offer', () => {
    expect(caseAgent({ caseAgent: 'gone', linkAgent: 'stable', defaultAgentId: 'dev', offered: ['dev'] })).toBe('dev');
  });

  it('returns null when nothing named is offered', () => {
    expect(caseAgent({ caseAgent: 'gone', linkAgent: 'also-gone', defaultAgentId: null, offered: OFFERED })).toBeNull();
    expect(caseAgent({ defaultAgentId: 'stable', offered: [] })).toBeNull();
  });
});
