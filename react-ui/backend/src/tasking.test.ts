import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileDecision, type FilingPlan, type FilingStore } from './filing';
import {
  filedChoice,
  isTaskingId,
  newestTaskingId,
  sessionBoxes,
  sessionTaskingKeys,
  taskingCard,
  taskingChoice,
  taskingFiledRecord,
  taskingMarkdown,
  taskingMessage,
  taskingRefusal,
  taskingWorkflowPayload,
  type TaskingChoice,
} from './tasking';
import { taskingPayloadFor, taskingWebhookUrl, WORKFLOW_VARIABLES } from './slack';

const SID = '3f0c9a8e-1b2c-4d5e-8f90-123456789abc';
const TID = 'tasking-20261019T153000-a1b2c3';

/** A draft as tasking_tools.draft_tasking writes it (agents/dark-vessels). */
function draft(overrides: Record<string, unknown> = {}) {
  return {
    tasking_id: TID, status: 'draft', drafted_at: '2026-10-19T15:30:00Z', pass_id: 's1d-20261012t0018',
    pass_sensed: '2026-10-12T00:18:02Z',
    counts: { broadcasting: 4, port: 3, unproven: 2, seen_once: 9, candidate: 4 }, heard_share: 0.298,
    box: { box: 1, bounds: [-90.55, -0.5, -90.35, -0.3], share_of_past_dark_targets: 0.089 },
    look: { satellite: 'S1D', start: '2026-10-24T00:17:29Z', share: 1.0, text: 'S1-D Oct 24 00:17 UTC' },
    check: { top_5pct: { share_of_water: 0.05, held: 22, total: 49, hit: 0.449, lift: 9.0 } },
    candidates: [
      { id: 'T01', lon: -90.5465, lat: -0.5086, port: 'Baltra', port_km: 30.6, nearest_broadcast_km: 5.8 },
      { id: 'T02', lon: -90.43, lat: -0.47, port: 'Baltra', port_km: 31.0, nearest_broadcast_km: 10.2 },
      { id: 'T04', lon: -89.552, lat: -0.6858, port: 'Puerto Baquerizo Moreno', port_km: 24.6, nearest_broadcast_km: null },
    ],
    notes: [], sentence: 'A candidate is a radar target with no broadcast nearby; it is not an accusation.',
    attribution: 'Powered by Global Fishing Watch.',
    ...overrides,
  };
}

const HOTSPOTS = {
  boxes: [
    { box: 1, share_of_past_dark_targets: 0.089, bounds: [-90.55, -0.5, -90.35, -0.3],
      next_look: { satellite: 'S1D', start: '2026-10-24T00:17:29Z', share: 1.0, text: 'S1-D Oct 24 00:17 UTC' } },
    { box: 2, share_of_past_dark_targets: 0.051, bounds: [-91.55, -0.3, -91.35, -0.1],
      next_look: { satellite: 'S1D', start: '2026-10-29T00:25:37Z', share: 1.0, text: 'S1-D Oct 29 00:25 UTC' } },
    { box: 3, share_of_past_dark_targets: 0.049, bounds: [-90.2, -0.7, -90.0, -0.5], next_look: null },
  ],
};

describe('tasking ids and keys', () => {
  it('takes only the tool\'s ids and keeps the files in the session\'s taskings folder', () => {
    assert.ok(isTaskingId(TID));
    for (const bad of ['tasking-1', `${TID}/../x`, 'brief-20261019T153000-a1b2c3', '', 7]) assert.equal(isTaskingId(bad), false);
    assert.deepEqual(sessionTaskingKeys(SID, TID), {
      draft: `session_data/${SID}/taskings/${TID}.draft.json`, filed: `session_data/${SID}/taskings/${TID}.filed.json`,
      markdown: `session_data/${SID}/taskings/${TID}.md`, snapshot: `session_data/${SID}/taskings/${TID}.png`,
    });
  });

  it('finds the newest draft by its name, never a filed record or another file', () => {
    const p = `session_data/${SID}/taskings/`;
    assert.equal(newestTaskingId([`${p}tasking-20261019T150000-aaaaaa.draft.json`, `${p}${TID}.draft.json`,
      `${p}tasking-20261020T000000-bbbbbb.filed.json`, `${p}notes.json`]), TID);
    assert.equal(newestTaskingId([]), null);
  });
});

describe('taskingCard', () => {
  it('reads the draft field by field', () => {
    const card = taskingCard(draft(), TID)!;
    assert.equal(card.passId, 's1d-20261012t0018');
    assert.equal(card.box.box, 1);
    assert.equal(card.box.look?.text, 'S1-D Oct 24 00:17 UTC');
    assert.deepEqual(card.check, { hit: 0.449, total: 49, lift: 9.0 });
    assert.deepEqual(card.candidates.map((c) => c.id), ['T01', 'T02', 'T04']);
    assert.equal(card.candidates[2].nearestBroadcastKm, null);
  });

  it('refuses another tasking\'s draft, a malformed one, and any accusing or identifying text', () => {
    assert.equal(taskingCard(draft(), 'tasking-20261019T153000-ffffff'), null);
    assert.equal(taskingCard(draft({ pass_id: '../x' }), TID), null);
    assert.equal(taskingCard(draft({ heard_share: 3 }), TID), null);
    assert.equal(taskingCard(draft({ notes: ['The poacher went north'] }), TID), null);
    assert.equal(taskingCard(draft({ notes: ['Hail MMSI 123456789 first'] }), TID), null);
    assert.equal(taskingCard(draft({ candidates: [{ id: 'T01', lon: 0, lat: 0, port: 'x', port_km: 1 }, { id: 'T01', lon: 0, lat: 0, port: 'x', port_km: 1 }] }), TID), null);
    assert.equal(taskingRefusal(draft({ status: 'filed' }), TID), 'Only a draft can be filed.');
    assert.equal(taskingRefusal(draft(), TID), null);
  });
});

describe('taskingChoice', () => {
  const card = taskingCard(draft(), TID)!;
  const boxes = sessionBoxes(HOTSPOTS);

  it('defaults to the draft\'s box and every candidate', () => {
    const c = taskingChoice(card, boxes, undefined, undefined);
    assert.ok(c.ok && c.choice.box.box === 1 && c.choice.candidateIds.join() === 'T01,T02,T04');
  });

  it('takes another of the session\'s boxes, with its own next look, and drops candidates', () => {
    const c = taskingChoice(card, boxes, 2, ['T04', 'T01']);
    assert.ok(c.ok);
    if (c.ok) {
      assert.equal(c.choice.box.box, 2);
      assert.equal(c.choice.box.look?.text, 'S1-D Oct 29 00:25 UTC');
      assert.deepEqual(c.choice.candidateIds, ['T01', 'T04']);    // the draft's order
    }
  });

  it('refuses a box the session does not have and candidates the draft does not hold', () => {
    assert.equal(taskingChoice(card, boxes, 4, undefined).ok, false);
    assert.equal(taskingChoice(card, [], 2, undefined).ok, false);
    assert.equal(taskingChoice(card, boxes, 1, ['T09']).ok, false);
    assert.equal(taskingChoice(card, boxes, 1, ['<script>']).ok, false);
    assert.equal(taskingChoice(card, boxes, '1', undefined).ok, false);
  });
});

describe('the filed tasking', () => {
  const card = taskingCard(draft(), TID)!;
  const choice: TaskingChoice = { box: card.box, candidateIds: ['T01', 'T04'] };

  it('says who filed it, what the officer chose and left out, and never accuses', () => {
    const md = taskingMarkdown(card, choice, 'officer', '2026-10-19T15:31:00.000Z');
    assert.match(md, /^# Patrol tasking: box 1, Galápagos Marine Reserve/);
    assert.match(md, /Status: FILED by officer at 2026-10-19T15:31:00.000Z\. Filed by the officer, not by the agent\./);
    assert.match(md, /Candidates in this tasking \(2 of 3\)/);
    assert.match(md, /Left out by the officer: T02/);
    assert.match(md, /T04: 24\.6 km from Puerto Baquerizo Moreno; no broadcast at the pass/);
    assert.match(md, /top 5% of the water held 45% of the 49 dark targets checked \(9x chance\)/);
    assert.ok(md.includes(card.sentence) && md.includes('Powered by Global Fishing Watch.'));
    assert.doesNotMatch(md, /illegal|poach|suspect|culprit|—/i);
  });

  it('writes the record tasking_status reads, with the choice', () => {
    const keys = sessionTaskingKeys(SID, TID);
    const r = taskingFiledRecord(card, choice, SID, 'officer', '2026-10-19T15:31:00Z', keys, null);
    assert.equal(r.filed_at, '2026-10-19T15:31:00Z');
    assert.deepEqual(filedChoice(r), { box: 1, candidateIds: ['T01', 'T04'] });
    assert.equal(filedChoice({ box: 9, candidate_ids: [] }), null);
  });
});

describe('fileDecision (the filing core) with a tasking', () => {
  class MemoryStore implements FilingStore {
    objects = new Map<string, string | Buffer>();
    puts: string[] = [];
    async get(key: string) {
      const v = this.objects.get(key);
      return v === undefined ? null : v.toString();
    }
    async put(key: string, body: string | Buffer) {
      this.puts.push(key);
      this.objects.set(key, body);
    }
  }
  const keys = sessionTaskingKeys(SID, TID);
  const card = taskingCard(draft(), TID)!;
  const choice: TaskingChoice = { box: card.box, candidateIds: ['T01'] };
  const plan = (notified: string[]): FilingPlan => ({
    keys, draftMaxBytes: 100_000, notFound: 'Tasking not found',
    refusal: (r) => taskingRefusal(r, TID),
    markdown: (r, by, at) => taskingMarkdown(taskingCard(r, TID)!, choice, by, at),
    filedRecord: (r, by, at, snap) => taskingFiledRecord(taskingCard(r, TID)!, choice, SID, by, at, keys, snap),
    notify: () => notified.push(TID),
  });

  it('writes the markdown and the snapshot first and the filed record last, then tells Slack', async () => {
    const store = new MemoryStore();
    store.objects.set(keys.draft, JSON.stringify(draft()));
    const notified: string[] = [];
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
    const out = await fileDecision(store, plan(notified), png, 'officer', '2026-10-19T15:31:00Z');
    assert.equal(out.status, 200);
    assert.deepEqual(store.puts, [keys.markdown, keys.snapshot, keys.filed]);
    assert.deepEqual(notified, [TID]);
    const filed = JSON.parse(store.objects.get(keys.filed) as string);
    assert.equal(filed.snapshot_key, keys.snapshot);
    assert.deepEqual(filed.candidate_ids, ['T01']);
  });

  it('is idempotent: a second approval files nothing again and keeps the first choice', async () => {
    const store = new MemoryStore();
    store.objects.set(keys.draft, JSON.stringify(draft()));
    store.objects.set(keys.filed, JSON.stringify({ filed_at: '2026-10-19T15:31:00Z', filed_by: 'officer', box: 2, candidate_ids: [] }));
    const notified: string[] = [];
    const out = await fileDecision(store, plan(notified), null, 'someone', '2026-10-19T16:00:00Z');
    assert.deepEqual(out, { status: 200, body: { status: 'filed', filedAt: '2026-10-19T15:31:00Z', filedBy: 'officer', already: true } });
    assert.deepEqual(store.puts, []);
    assert.deepEqual(notified, []);
  });

  it('answers 404 without a draft and 409 for a draft that may not be filed, writing nothing', async () => {
    const store = new MemoryStore();
    assert.equal((await fileDecision(store, plan([]), null, 'officer', 'now')).status, 404);
    store.objects.set(keys.draft, JSON.stringify(draft({ status: 'filed' })));
    const out = await fileDecision(store, plan([]), null, 'officer', 'now');
    assert.equal(out.status, 409);
    assert.deepEqual(store.puts, []);
  });
});

describe('Slack for a filed tasking', () => {
  const parts = (...p: string[]) => p.join('/');
  const incoming = `https://hooks.slack.com/${parts('services', 'T0ABCDEF', 'B0ABCDEF', 'abcdefghijklmnop1234')}`;
  const workflow = `https://hooks.slack.com/${parts('triggers', 'T0ABCDEF', '1234567890', 'abcdefghijklmnop1234')}`;
  const card = taskingCard(draft(), TID)!;
  const filed = { card, choice: { box: card.box, candidateIds: ['T01', 'T02'] }, filedBy: 'officer',
                  filedAt: '2026-10-19T15:31:00Z', markdownKey: `session_data/${SID}/taskings/${TID}.md`, bucket: 'b' };

  it('never posts a tasking to the brief\'s workflow (its message says "brief")', () => {
    assert.equal(taskingWebhookUrl({ SLACK_WEBHOOK_URL: workflow }), null);
    assert.equal(taskingWebhookUrl({ SLACK_WEBHOOK_URL: incoming }), incoming);
    assert.equal(taskingWebhookUrl({ SLACK_WEBHOOK_URL: workflow, SLACK_TASKING_WEBHOOK_URL: workflow }), workflow);
    assert.equal(taskingWebhookUrl({ SLACK_TASKING_WEBHOOK_URL: 'https://example.com/x' }), null);
  });

  it('gives a workflow exactly the twelve variables, and an app a Block Kit message', () => {
    const vars = taskingPayloadFor(workflow, filed);
    assert.deepEqual(Object.keys(vars).sort(), [...WORKFLOW_VARIABLES].sort());
    assert.equal(vars.title, 'Patrol tasking: box 1, 2 of 3 candidates');
    assert.equal((taskingPayloadFor(incoming, filed) as { blocks: unknown[] }).blocks.length, 5);
    const text = JSON.stringify(taskingMessage(filed)) + JSON.stringify(taskingWorkflowPayload(filed));
    assert.doesNotMatch(text, /illegal|poach|suspect|culprit|MMSI/i);
  });
});
