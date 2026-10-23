/**
 * The analyst's decision, UI side. The brief id comes from the agent's answer (the brief's
 * markdown names it: "(draft `brief-…`, not filed)"); the card's contents come from the backend,
 * which reads the draft from S3, so nothing model-written in the answer reaches the card.
 */
import type { Message, ToolCall } from '../types.ts';
import { cueTally, type PassFrame, type Tip } from './steps.ts';

const DRAFT_ID = /draft `(brief-\d{8}T\d{6}-[0-9a-f]{6})`/g;
const ANY_ID = /\bbrief-\d{8}T\d{6}-[0-9a-f]{6}\b/;

/** The last brief id a text names as a draft, or null. */
export function draftBriefId(text: string): string | null {
  let last: string | null = null;
  for (const m of text.matchAll(DRAFT_ID)) last = m[1];
  return last;
}

/** The two things the analyst can say, as the agent's prompt expects them (methane_config.py). */
export const approvedMessage = (briefId: string) => `The analyst approved and filed brief ${briefId}`;
export const anotherLookMessage = (briefId: string) => `Request another look at brief ${briefId}`;

/** The same site to 2 decimals (the step column's coordinate format). */
function sameSite(lat: unknown, lon: unknown, cardLat: number, cardLon: number): boolean {
  const la = typeof lat === 'number' ? lat : typeof lat === 'string' ? Number(lat) : NaN;
  const lo = typeof lon === 'number' ? lon : typeof lon === 'string' ? Number(lon) : NaN;
  return Number.isFinite(la) && Number.isFinite(lo) && la.toFixed(2) === cardLat.toFixed(2) && lo.toFixed(2) === cardLon.toFixed(2);
}

/** The latest check_recent_passes call on the card's site, or null. */
export function siteCue(cues: ToolCall[], lat: number, lon: number): ToolCall | null {
  const hits = cues.filter((c) => c.name === 'check_recent_passes' && sameSite(c.params?.lat, c.params?.lon, lat, lon));
  return hits[hits.length - 1] ?? null;
}

/** The TROPOMI tip whose top hotspot is the card's site, or null. */
export function siteTip(tips: Tip[], lat: number, lon: number): Tip | null {
  return tips.find((t) => t.point && sameSite(t.point[1], t.point[0], lat, lon)) ?? null;
}

/** The ground checks a mission can run before it drafts (the plan's Check stage). */
export const GROUND_CHECKS = ['thermal_anomalies', 'nearby_infrastructure', 'registry_lookup'] as const;

/** How many of the ground checks the session ran (each counted once). */
export function groundChecks(tools: ToolCall[]): number {
  return new Set(tools.map((t) => t.name).filter((n) => (GROUND_CHECKS as readonly string[]).includes(n))).size;
}

export interface MissionChain {
  /** The TROPOMI tip over the card's site: the area's label (the stage's table) and its anomaly. */
  tip: { label: string; ppb: number } | null;
  /** EMIT's cue on the site: candidate passes of those read (the pass manifest). */
  cue: { candidates: number; read: number } | null;
  /** How many ground checks the session ran. */
  checks: number | null;
}

/**
 * The card's first line, tip to brief (A2 P1-2): "Tip <area> +<ppb> ppb → Cue <n> of <m> passes →
 * Check <k> records → Brief", from the tools' records only (the tip manifest, the pass manifest,
 * the session's calls). A part with no record is left out; the brief always ends it.
 */
export function missionChain({
  tip, frames, checks,
}: { tip?: Tip | null; frames?: PassFrame[] | null; checks?: number }): MissionChain {
  const tally = frames && frames.length > 0 ? cueTally(frames) : null;
  return {
    tip: tip && tip.anomalyPpb !== null ? { label: tip.area.label, ppb: tip.anomalyPpb } : null,
    cue: tally ? { candidates: tally.candidates, read: tally.read } : null,
    checks: typeof checks === 'number' && checks > 0 ? checks : null,
  };
}

/**
 * The brief the stage should show: the one the latest answer drafted, or, while the analyst's
 * decision on it is being answered, that one. Null once the conversation has moved on.
 */
export function currentBriefId(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'assistant') {
      const drafted = draftBriefId(m.content || '');
      if (drafted) return drafted;
      continue;
    }
    // A user turn: a decision about a brief keeps it on the stage; anything else ends it.
    const content = m.content || '';
    const named = content.match(ANY_ID)?.[0] ?? null;
    if (named && (content === approvedMessage(named) || content === anotherLookMessage(named))) return named;
    return null;
  }
  return null;
}
