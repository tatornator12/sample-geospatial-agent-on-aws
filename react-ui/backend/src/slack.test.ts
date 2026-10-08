import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { BriefCard } from './brief';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  WORKFLOW_VARIABLES,
  filedMessage,
  notifyFiled,
  payloadFor,
  postToSlack,
  slackWebhookUrl,
  webhookKind,
  workflowPayload,
  type FiledBrief,
} from './slack';

// Well-formed, fake webhooks assembled at run time: the literals must never sit in the source,
// or GitHub's push protection reads them as leaked Slack webhooks.
const HOST = 'hooks.slack.com';
const PATH = ['services', 'T0123456789', 'B0123456789', 'abcdefghijklmnopqrstuvwx'].join('/');
const URL = `https://${HOST}/${PATH}`;
const WORKFLOW_PATH = ['triggers', 'T0123456789', '9876543210987', 'abcdef0123456789abcdef0123456789'].join('/');
const WORKFLOW_URL = `https://${HOST}/${WORKFLOW_PATH}`;

function card(over: Partial<BriefCard> = {}): BriefCard {
  return {
    briefId: 'brief-20260925T201500-a1b2c3',
    title: 'Recurring methane, Shanxi coal basin site near Shahe City',
    place: 'near Shahe City, Xingtai, Hebei',
    lat: 36.9782,
    lon: 114.2629,
    looks: 12,
    candidates: 6,
    passesRead: 7,
    confidence: 'high',
    singleExplanation: 'low without a ground or aircraft check',
    hypotheses: [
      { label: 'Routine venting', assessment: 'possible', nextCheck: 'Operating logs for the dates would confirm it.' },
      { label: 'Maintenance blowdown', assessment: 'less likely' },
    ],
    checks: [
      'VIIRS saw no heat source within 1 km over the last 30 nights; flaring was not observed.',
      'Overture Maps shows within 2 km: 1 pipeline (0 km); nothing mapped for mining, waste, wetland.',
    ],
    gaps: ['EMIT only sees the site on its passes.'],
    nextCollection: 'Next EMIT pass and an aircraft survey.',
    ...over,
  };
}

function filed(over: Partial<FiledBrief> = {}): FiledBrief {
  return {
    card: card(),
    sessionId: '3f0c9a8e-1b2c-4d5e-8f90-123456789abc',
    filedBy: 'analyst@example.com',
    filedAt: '2026-10-06T20:30:00.000Z',
    markdownKey: 'session_data/3f0c9a8e-1b2c-4d5e-8f90-123456789abc/briefs/brief-20260925T201500-a1b2c3.md',
    bucket: 'demo-bucket',
    ...over,
  };
}

describe('slackWebhookUrl', () => {
  it('accepts only the two Slack webhook shapes, so the backend posts to Slack or to nowhere', () => {
    assert.equal(slackWebhookUrl({ SLACK_WEBHOOK_URL: URL }), URL);
    assert.equal(webhookKind(URL), 'incoming');
    assert.equal(slackWebhookUrl({ SLACK_WEBHOOK_URL: WORKFLOW_URL }), WORKFLOW_URL);
    assert.equal(webhookKind(WORKFLOW_URL), 'workflow');
    assert.equal(slackWebhookUrl({ SLACK_WEBHOOK_URL: ` ${URL}\n` }), URL);
    assert.equal(slackWebhookUrl({}), null);
    assert.equal(slackWebhookUrl({ SLACK_WEBHOOK_URL: '' }), null);
    assert.equal(slackWebhookUrl({ SLACK_WEBHOOK_URL: 'placeholder-set-me' }), null);          // the unset secret
    assert.equal(slackWebhookUrl({ SLACK_WEBHOOK_URL: `http://${HOST}/${PATH}` }), null);           // not https
    assert.equal(slackWebhookUrl({ SLACK_WEBHOOK_URL: `https://evil.example/${PATH}` }), null);     // not Slack
    assert.equal(slackWebhookUrl({ SLACK_WEBHOOK_URL: `${URL}?x=1` }), null);
  });
});

describe('filedMessage', () => {
  it('carries what the card shows: title, place, counts, confidence, the ground record, who filed and the ids', () => {
    const text = JSON.stringify(filedMessage(filed()));
    for (const expected of [
      'Methane Watch brief filed',
      'Recurring methane, Shanxi coal basin site near Shahe City',
      'near Shahe City, Xingtai, Hebei',
      '36.9782, 114.2629',
      '6 of 7 recent passes are candidates; EMIT looked 12 times.',
      'high',
      'low without a ground or aircraft check',
      '• Routine venting: possible\\n    Operating logs for the dates would confirm it.',
      '• Maintenance blowdown: less likely',
      'Gaps:\\n• EMIT only sees the site on its passes.',
      'Next look: Next EMIT pass and an aircraft survey.',
      'VIIRS saw no heat source',
      'Overture Maps shows within 2 km',
      'Filed by analyst@example.com at 2026-10-06T20:30:00.000Z',
      'The analyst decided; the agent drafted.',
      'brief-20260925T201500-a1b2c3',
      's3://demo-bucket/session_data/3f0c9a8e-1b2c-4d5e-8f90-123456789abc/briefs/brief-20260925T201500-a1b2c3.md',
    ]) {
      assert.ok(text.includes(expected), expected);
    }
  });

  it('escapes mrkdwn control characters and says when no checks were run', () => {
    const msg = filedMessage(filed({ card: card({ title: 'A <b>bold</b> & odd title', checks: [] }), filedBy: '<analyst>' }));
    const text = JSON.stringify(msg);
    assert.ok(text.includes('A &lt;b&gt;bold&lt;/b&gt; &amp; odd title'));
    assert.ok(!text.includes('<b>'));
    assert.ok(text.includes('Filed by &lt;analyst&gt;'));
    assert.ok(text.includes('No ground-record checks were run.'));
  });
});

describe('workflowPayload', () => {
  it('is a flat object of plain-text variables, one per key the trigger declares, and nothing else', () => {
    const payload = workflowPayload(filed());
    assert.deepEqual(Object.keys(payload).sort(), [...WORKFLOW_VARIABLES].sort());
    for (const value of Object.values(payload)) assert.equal(typeof value, 'string');
    assert.equal(payload.title, 'Recurring methane, Shanxi coal basin site near Shahe City');
    assert.equal(payload.coordinates, '36.9782, 114.2629');
    assert.equal(payload.evidence, '6 of 7 recent passes are candidates; EMIT looked 12 times.');
    assert.equal(payload.confidence, 'high');
    assert.equal(payload.hypotheses, '• Routine venting: possible\n    Operating logs for the dates would confirm it.\n• Maintenance blowdown: less likely');
    assert.equal(payload.ground_record.split('\n').length, 5);                     // 2 checks, "Gaps:", 1 gap, the next look
    assert.ok(payload.ground_record.startsWith('• VIIRS saw no heat source') && payload.ground_record.endsWith('Next look: Next EMIT pass and an aircraft survey.'));
    assert.equal(payload.filed_at, '2026-10-06 20:30 UTC');
    assert.equal(payload.filed_by, 'analyst@example.com');
    assert.equal(payload.brief_id, 'brief-20260925T201500-a1b2c3');
    assert.ok(payload.markdown_key.startsWith('s3://demo-bucket/session_data/'));
    assert.equal(workflowPayload(filed({ card: card({ checks: [], hypotheses: [], gaps: [], nextCollection: undefined }) })).ground_record, '• No ground-record checks were run.');
    assert.equal(workflowPayload(filed({ card: card({ hypotheses: [] }) })).hypotheses, '• none listed');
  });

  it('is what a workflow trigger receives, while an incoming webhook receives the Block Kit message', () => {
    assert.ok(!('blocks' in payloadFor(WORKFLOW_URL, filed())));
    assert.ok('blocks' in payloadFor(URL, filed()));
  });

  it('declares every variable in the README so whoever builds the workflow types the same keys', () => {
    const readme = readFileSync(join(__dirname, '..', '..', '..', 'agents', 'methane-hunter', 'README.md'), 'utf8');
    for (const name of WORKFLOW_VARIABLES) assert.ok(readme.includes(`\`${name}\``), `README lacks ${name}`);
  });
});

describe('postToSlack', () => {
  it('posts JSON and reports success', async () => {
    const calls: Array<{ url: string; body: string; method: string }> = [];
    const ok = await postToSlack(URL, { text: 'hi' }, async (url, init) => {
      calls.push({ url, body: init.body, method: init.method });
      return { ok: true, status: 200 };
    });
    assert.equal(ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, URL);
    assert.equal(calls[0].method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].body), { text: 'hi' });
  });

  it('never throws: a rejection, a non-2xx or a timeout is a false and a log line without the URL', async () => {
    const warned: string[] = [];
    const original = console.warn;
    console.warn = (line: string) => { warned.push(line); };
    try {
      assert.equal(await postToSlack(URL, {}, async () => ({ ok: false, status: 403 })), false);
      assert.equal(await postToSlack(URL, {}, async () => { throw new TypeError('fetch failed'); }), false);
      assert.equal(await postToSlack(URL, {}, (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }), 20), false);
    } finally {
      console.warn = original;
    }
    assert.deepEqual(warned, ['Slack: 403', 'Slack: TypeError', 'Slack: AbortError']);
    assert.ok(warned.every((w) => !w.includes('hooks.slack.com')));
  });
});

describe('notifyFiled', () => {
  it('is a no-op without a configured webhook', () => {
    // Would throw on a real fetch to an undefined URL; with no webhook nothing is attempted.
    assert.doesNotThrow(() => notifyFiled(filed(), {}));
    assert.doesNotThrow(() => notifyFiled(filed(), { SLACK_WEBHOOK_URL: 'not-a-webhook' }));
  });
});
