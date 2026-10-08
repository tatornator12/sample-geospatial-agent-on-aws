/**
 * Slack: one message when the analyst files a brief.
 *
 * The gate is the point of Act 2: the agent drafts, a person decides. So the notification is
 * tied to the analyst's click (POST /api/brief/approve, after the filed record is written), never
 * to anything the model says. It carries what the brief card shows and nothing more: the title
 * and place as the geocoder gave them, the counts, the confidence, the two ground-record
 * sentences the tools wrote, who filed it and when, and the ids an operator needs to find the
 * filed markdown in the bucket. No operator, company or government is ever named by the agent,
 * and the message is built from the card's validated fields, so none can reach Slack either.
 *
 * The webhook URL is a secret (`SLACK_WEBHOOK_URL`: the backend's .env locally, a Secrets
 * Manager secret injected by the ECS task in production). It is validated to be one of Slack's two
 * webhook shapes (an app's incoming webhook, or a Workflow Builder webhook trigger), never logged,
 * and when it is absent or malformed the feature is simply off: filing never waits on Slack and
 * never fails because of it.
 */
import type { BriefCard } from './brief';

/**
 * The two Slack webhook shapes, and nothing else: this backend posts to Slack or to nowhere.
 *   - a Slack app's incoming webhook (`/services/T…/B…/…`): takes a Block Kit message;
 *   - a Workflow Builder "From a webhook" trigger (`/triggers/T…/…/…`): takes a flat object of
 *     the variables declared on the trigger (see WORKFLOW_VARIABLES), which the workflow's own
 *     "Send a message" step lays out. This is the shape a workspace that does not let members
 *     create apps can still use.
 */
export const SLACK_INCOMING_WEBHOOK = /^https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]{5,}\/B[A-Z0-9]{5,}\/[A-Za-z0-9]{16,}$/;
export const SLACK_WORKFLOW_WEBHOOK = /^https:\/\/hooks\.slack\.com\/triggers\/[A-Za-z0-9]{5,}\/[A-Za-z0-9]{5,}\/[A-Za-z0-9]{16,}$/;
export const SLACK_TIMEOUT_MS = 5000;

export type WebhookKind = 'incoming' | 'workflow';

export function webhookKind(url: string): WebhookKind | null {
  if (SLACK_INCOMING_WEBHOOK.test(url)) return 'incoming';
  if (SLACK_WORKFLOW_WEBHOOK.test(url)) return 'workflow';
  return null;
}

export function slackWebhookUrl(env: Record<string, string | undefined> = process.env): string | null {
  const value = (env.SLACK_WEBHOOK_URL ?? '').trim();
  return webhookKind(value) ? value : null;
}

export interface FiledBrief {
  card: BriefCard;
  sessionId: string;
  filedBy: string;
  filedAt: string;
  markdownKey: string;
  bucket: string;
}

/** Slack mrkdwn: the control characters that could break out of a field or spoof a link. */
function plain(value: string): string {
  return value.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);
}

/** "6 of 8 recent passes are candidates; EMIT looked 12 times." */
function evidenceLine(card: BriefCard): string {
  return `${card.candidates} of ${card.passesRead} recent passes are candidates; EMIT looked ${card.looks} times.`;
}

/** One hypothesis per line, its assessment, then (indented) what would confirm or rule it out. */
function hypothesisLines(card: BriefCard, mark: (s: string) => string): string {
  if (card.hypotheses.length === 0) return '• none listed';
  return card.hypotheses
    .map((h) => `• ${mark(h.label)}: ${h.assessment}` + (h.nextCheck ? `\n    ${mark(h.nextCheck)}` : ''))
    .join('\n');
}

/** The ground record as bullets, then the gaps and the next look. */
function groundRecordLines(card: BriefCard, mark: (s: string) => string): string {
  const checks = card.checks.length > 0 ? card.checks.map((c) => `• ${mark(c)}`) : ['• No ground-record checks were run.'];
  const gaps = card.gaps.length > 0 ? ['Gaps:', ...card.gaps.map((g) => `• ${mark(g)}`)] : [];
  const next = card.nextCollection ? [`Next look: ${mark(card.nextCollection)}`] : [];
  return [...checks, ...gaps, ...next].join('\n');
}

/** The Block Kit payload for a filed brief. Pure, so the message is tested without Slack. */
export function filedMessage(filed: FiledBrief): Record<string, unknown> {
  const { card } = filed;
  return {
    text: `Methane Watch brief filed: ${plain(card.title)} (${plain(card.place)})`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'Methane Watch brief filed', emoji: false } },
      { type: 'section', text: { type: 'mrkdwn', text: `*${plain(card.title)}*\n${plain(card.place)} · \`${card.lat.toFixed(4)}, ${card.lon.toFixed(4)}\`` } },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Evidence*\n${evidenceLine(card)}` },
          { type: 'mrkdwn', text: `*Confidence*\nMethane recurs here: ${card.confidence}\nAny single explanation: ${card.singleExplanation}` },
        ],
      },
      { type: 'section', text: { type: 'mrkdwn', text: `*Unconfirmed hypotheses*\n${hypothesisLines(card, plain)}` } },
      { type: 'section', text: { type: 'mrkdwn', text: `*Ground record*\n${groundRecordLines(card, plain)}` } },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `Filed by ${plain(filed.filedBy)} at ${filed.filedAt}. The analyst decided; the agent drafted.` },
          { type: 'mrkdwn', text: `\`${card.briefId}\` · \`s3://${filed.bucket}/${filed.markdownKey}\`` },
        ],
      },
    ],
  };
}

/**
 * The variables a Workflow Builder webhook trigger must declare (all of data type Text), with the
 * exact keys: Slack matches the payload's keys to the trigger's variables by name. The README
 * lists them for whoever sets the workflow up; the test pins the list so the two never drift.
 */
export const WORKFLOW_VARIABLES = [
  'title', 'place', 'coordinates', 'evidence', 'confidence', 'single_explanation', 'hypotheses',
  'ground_record', 'filed_by', 'filed_at', 'brief_id', 'markdown_key',
] as const;

/**
 * The flat payload for a Workflow Builder trigger. The workflow inserts each value as text, so the
 * values that are lists arrive already laid out, one item per line with a bullet: `hypotheses`
 * (label, assessment, then what would confirm it) and `ground_record` (the two checks, the gaps,
 * the next look). The twelve keys are fixed: the workflow the user built declares exactly these.
 */
export function workflowPayload(filed: FiledBrief): Record<(typeof WORKFLOW_VARIABLES)[number], string> {
  const { card } = filed;
  const asIs = (s: string) => s;
  return {
    title: card.title,
    place: card.place,
    coordinates: `${card.lat.toFixed(4)}, ${card.lon.toFixed(4)}`,
    evidence: evidenceLine(card),
    confidence: card.confidence,
    single_explanation: card.singleExplanation,
    hypotheses: hypothesisLines(card, asIs),
    ground_record: groundRecordLines(card, asIs),
    filed_by: filed.filedBy,
    filed_at: filed.filedAt.slice(0, 16).replace('T', ' ') + ' UTC',
    brief_id: card.briefId,
    markdown_key: `s3://${filed.bucket}/${filed.markdownKey}`,
  };
}

/** What to post to this webhook: Block Kit to an app's incoming webhook, variables to a workflow trigger. */
export function payloadFor(url: string, filed: FiledBrief): Record<string, unknown> {
  return webhookKind(url) === 'workflow' ? workflowPayload(filed) : filedMessage(filed);
}

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

/**
 * Post the message. Resolves true when Slack accepted it; false otherwise. Never throws and never
 * puts the URL in a log line: a failure is "Slack: 403" or "Slack: AbortError", nothing more.
 */
export async function postToSlack(url: string, payload: Record<string, unknown>, fetchImpl: Fetch = fetch as unknown as Fetch,
                                  timeoutMs: number = SLACK_TIMEOUT_MS): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.warn(`Slack: ${response.status}`);
      return false;
    }
    return true;
  } catch (error) {
    console.warn(`Slack: ${error instanceof Error ? error.name : 'error'}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Fire and forget from the approve route: the analyst's response never waits for Slack. */
export function notifyFiled(filed: FiledBrief, env: Record<string, string | undefined> = process.env): void {
  const url = slackWebhookUrl(env);
  if (!url) return;
  void postToSlack(url, payloadFor(url, filed)).then((ok) => {
    if (ok) console.log(`📣 Slack told about ${filed.card.briefId}`);
  });
}
