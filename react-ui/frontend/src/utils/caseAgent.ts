/**
 * Which act plays a replay case: the case's own act, else the act its link named, else the
 * backend's default; the first of those the backend offers. Never simply whatever act happens to
 * be selected (a rehearsal that ended on Dark Vessels must not play the Palisades burn under the
 * Dark Vessels speaker and send its follow-ups to that runtime).
 */
export interface CaseAgentInput {
  /** The case's own act (`agent` in its config), if it names one. */
  caseAgent?: string | null;
  /** `?agent=` on the link that opened the case (the gallery writes it). */
  linkAgent?: string | null;
  /** The backend's default act. */
  defaultAgentId?: string | null;
  /** The acts the backend offers. */
  offered: readonly string[];
}

export function caseAgent({ caseAgent: own, linkAgent, defaultAgentId, offered }: CaseAgentInput): string | null {
  for (const id of [own, linkAgent, defaultAgentId]) {
    if (id && offered.includes(id)) return id;
  }
  return null;
}
