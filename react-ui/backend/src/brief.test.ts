import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SNAPSHOT_MAX_BYTES,
  briefCard,
  caseBriefDraftKey,
  decodeSnapshot,
  fileRefusal,
  filedBy,
  filedMarkdown,
  isBriefId,
  isCaseId,
  isSessionId,
  sessionBriefKeys,
} from './brief';

const SID = '3f0c9a8e-1b2c-4d5e-8f90-123456789abc';
const BID = 'brief-20260925T201500-a1b2c3';

function draft(overrides: Record<string, unknown> = {}, brief: Record<string, unknown> = {}) {
  return {
    brief_id: BID,
    status: 'draft',
    session_id: SID,
    markdown: `**Methane Watch brief: Recurring methane** (draft \`${BID}\`, not filed)\n\nSite: near Hazar\n\nStatus: DRAFT, awaiting the analyst's decision.`,
    brief: {
      title: 'Recurring methane, south Caspian site',
      place: 'near Hazar',
      lat: 39.4741,
      lon: 53.6435,
      looks: 24,
      candidates: 4,
      passes_read: 4,
      confidence: 'high',
      explanations: [
        { id: 'unlit_flare', label: 'Unlit or malfunctioning flare', assessment: 'less likely', next_check: 'x' },
        { id: 'routine_venting', label: 'Routine venting', assessment: 'possible', next_check: 'x' },
        { id: 'non_oil_gas_source', label: 'Non-oil-and-gas source (landfill, coal, agriculture)', assessment: 'cannot assess', next_check: 'x' },
        { id: 'equipment_failure_or_leak', label: 'Equipment failure or leak', assessment: 'possible', next_check: 'x' },
      ],
      ...brief,
    },
    ...overrides,
  };
}

describe('ids and keys', () => {
  it('accepts only the tool\'s brief ids, session ids and case ids', () => {
    assert.equal(isBriefId(BID), true);
    for (const bad of ['brief-2026', `${BID}/../x`, `../${BID}`, 'BRIEF-20260925T201500-a1b2c3', 42, null]) {
      assert.equal(isBriefId(bad), false, String(bad));
    }
    assert.equal(isSessionId(SID), true);
    assert.equal(isSessionId('short'), false);
    assert.equal(isSessionId(`${SID}/../other`), false);
    assert.equal(isCaseId('methane-watch-south-caspian'), true);
    assert.equal(isCaseId('../x'), false);
  });

  it('keeps every key inside the session\'s briefs folder', () => {
    assert.deepEqual(sessionBriefKeys(SID, BID), {
      draft: `session_data/${SID}/briefs/${BID}.draft.json`,
      filed: `session_data/${SID}/briefs/${BID}.filed.json`,
      markdown: `session_data/${SID}/briefs/${BID}.md`,
      snapshot: `session_data/${SID}/briefs/${BID}.png`,
    });
    assert.equal(caseBriefDraftKey('methane-watch-south-caspian', BID), `use-cases/methane-watch-south-caspian/${BID}.draft.json`);
  });
});

describe('briefCard', () => {
  it('shows the counts, the confidence words and the top three hypotheses, possible first', () => {
    const card = briefCard(draft(), BID, SID)!;
    assert.equal(card.candidates, 4);
    assert.equal(card.confidence, 'high');
    assert.equal(card.singleExplanation, 'low without a ground or aircraft check');
    assert.deepEqual(card.hypotheses.map((h) => h.assessment), ['possible', 'possible', 'less likely']);
  });

  it('refuses another session\'s draft, another id, or a malformed brief', () => {
    assert.equal(briefCard(draft({ session_id: 'someone-else-0000000000000000000000' }), BID, SID), null);
    assert.equal(briefCard(draft(), 'brief-20260925T201500-ffffff', SID), null);
    assert.equal(briefCard(draft({}, { confidence: 'certain' }), BID, SID), null);
    assert.equal(briefCard(draft({}, { candidates: -1 }), BID, SID), null);
    assert.equal(briefCard(null, BID, SID), null);
    // A replay case has no live session to check.
    assert.ok(briefCard(draft({ session_id: 'recorded-session' }), BID, null));
  });

  it('drops hypotheses with an unknown assessment', () => {
    const card = briefCard(draft({}, { explanations: [{ label: 'Sabotage', assessment: 'confirmed' }] }), BID, SID)!;
    assert.deepEqual(card.hypotheses, []);
  });
});

describe('fileRefusal', () => {
  it('files only a draft of this session', () => {
    assert.equal(fileRefusal(draft(), BID, SID), null);
    assert.match(fileRefusal(draft({ status: 'filed' }), BID, SID)!, /Only a draft/);
    assert.match(fileRefusal(draft({ session_id: 'x' }), BID, SID)!, /does not belong/);
    assert.match(fileRefusal(draft({ markdown: 7 }), BID, SID)!, /no brief text/);
  });
});

describe('filedBy and filedMarkdown', () => {
  it('records the signed-in email, else "analyst"', () => {
    assert.equal(filedBy({ email: 'analyst@example.com' }), 'analyst@example.com');
    assert.equal(filedBy({ email: '<script>@x' }), 'analyst');
    assert.equal(filedBy(undefined), 'analyst');
  });

  it('replaces the draft status and marks who filed it', () => {
    const md = filedMarkdown(draft().markdown as string, 'analyst@example.com', '2026-09-25T20:20:00.000Z');
    assert.match(md, /Status: FILED by analyst@example\.com at 2026-09-25T20:20:00\.000Z\. Filed by the analyst, not by the agent\./);
    assert.doesNotMatch(md, /Status: DRAFT/);
    assert.match(md, new RegExp(`\\(\`${BID}\`, filed\\)`));
  });
});

describe('decodeSnapshot', () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
  it('accepts no snapshot or a small PNG data URL', () => {
    assert.deepEqual(decodeSnapshot(undefined), { ok: true, png: null });
    const shot = decodeSnapshot(`data:image/png;base64,${png.toString('base64')}`);
    assert.equal(shot.ok, true);
    assert.equal(shot.ok && shot.png?.length, png.length);
  });

  it('refuses other types, non-PNG bytes, junk and anything over 2 MB', () => {
    assert.equal(decodeSnapshot('data:image/jpeg;base64,AAAA').ok, false);
    assert.equal(decodeSnapshot(`data:image/png;base64,${Buffer.from('GIF89a-not-a-png').toString('base64')}`).ok, false);
    assert.equal(decodeSnapshot('data:image/png;base64,***').ok, false);
    assert.equal(decodeSnapshot({}).ok, false);
    const big = Buffer.concat([png, Buffer.alloc(SNAPSHOT_MAX_BYTES)]);
    const shot = decodeSnapshot(`data:image/png;base64,${big.toString('base64')}`);
    assert.equal(shot.ok, false);
    assert.match(!shot.ok ? shot.reason : '', /2 MB/);
  });
});
