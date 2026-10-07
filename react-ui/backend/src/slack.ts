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
 * Manager secret injected by the ECS task in production). It is validated to be a Slack
 * incoming-webhook URL, never logged, and when it is absent or malformed the feature is simply
 * off: filing never waits on Slack and never fails because of it.
 */
import type { BriefCard } from './brief';

/** An incoming-webhook URL and nothing else: this backend posts to Slack or to nowhere. */
export const SLACK_WEBHOOK = /^https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]{5,}\/B[A-Z0-9]{5,}\/[A-Za-z0-9]{16,}$/;
export const SLACK_TIMEOUT_MS = 5000;

export function slackWebhookUrl(env: Record<string, string | undefined> = process.env): string | null {
  const value = (env.SLACK_WEBHOOK_URL ?? '').trim();
  return SLACK_WEBHOOK.test(value) ? value : null;
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

/** The Block Kit payload for a filed brief. Pure, so the message is tested without Slack. */
export function filedMessage(filed: FiledBrief): Record<string, unknown> {
  const { card } = filed;
  const summary = `${card.candidates} of ${card.passesRead} recent passes are candidates; EMIT looked ${card.looks} times.`;
  const record = card.checks.length > 0 ? card.checks.map((c) => `• ${plain(c)}`).join('\n') : '• No ground-record checks were run.';
  const hypotheses = card.hypotheses.length > 0
    ? card.hypotheses.map((h) => `${plain(h.label)}: _${h.assessment}_`).join('  ·  ')
    : 'none listed';
  return {
    text: `Methane Watch brief filed: ${plain(card.title)} (${plain(card.place)})`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'Methane Watch brief filed', emoji: false } },
      { type: 'section', text: { type: 'mrkdwn', text: `*${plain(card.title)}*\n${plain(card.place)} · \`${card.lat.toFixed(4)}, ${card.lon.toFixed(4)}\`` } },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Evidence*\n${summary}` },
          { type: 'mrkdwn', text: `*Methane recurs here*\n${card.confidence}` },
          { type: 'mrkdwn', text: `*Any single explanation*\n${card.singleExplanation}` },
          { type: 'mrkdwn', text: `*Unconfirmed hypotheses*\n${hypotheses}` },
        ],
      },
      { type: 'section', text: { type: 'mrkdwn', text: `*Ground record*\n${record}` } },
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
  void postToSlack(url, filedMessage(filed)).then((ok) => {
    if (ok) console.log(`📣 Slack told about ${filed.card.briefId}`);
  });
}
