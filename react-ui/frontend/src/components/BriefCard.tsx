/**
 * The brief card: the mission's end frame and the human decision (requirement 12).
 *
 * The agent drafts; the analyst decides. The card shows what the draft says in the words the
 * room needs (the count, how confident, the leading unconfirmed hypotheses) and two choices:
 * "Approve and file", which the BACKEND executes (it reads the draft from S3 and writes the filed
 * record; the agent is told only afterwards and checks with brief_status), and "Request another
 * look", which asks the agent to read more passes. In a replay case the card is inert: a
 * recorded decision would be theatre.
 */
import { useEffect, useRef, useState } from 'react';
import { approveBrief, getBrief, type BriefState } from '../services/api.ts';
import { SNAPSHOT_MAX_CHARS, mapSnapshot } from '../utils/snapshot.ts';
import { anotherLookMessage, approvedMessage } from '../utils/brief.ts';

const RETRY_MS = 2000;
const GIVE_UP_MS = 30_000;

interface BriefCardProps {
  briefId: string;
  sessionId: string;
  /** A replay case: the card reads the case's draft and offers no decision. */
  caseId?: string;
  /** The agent is working: the choices wait. */
  busy: boolean;
  /** Sends the analyst's decision to the agent as the next prompt. */
  onDecision: (prompt: string) => void;
}

const CONFIDENCE_WORDS: Record<string, string> = {
  high: 'High',
  moderate: 'Moderate',
  low: 'Low',
};

export function BriefCard({ briefId, sessionId, caseId, busy, onDecision }: BriefCardProps) {
  const [state, setState] = useState<BriefState | null>(null);
  const [filing, setFiling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    setState(null);
    const attempt = async () => {
      const loaded = await getBrief(briefId, caseId ? { caseId } : { sessionId });
      if (cancelled) return;
      if (loaded) setState(loaded);
      else if (Date.now() - started < GIVE_UP_MS) timer = setTimeout(attempt, RETRY_MS);
    };
    void attempt();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [briefId, sessionId, caseId]);

  // The end frame: bring the card into view when it lands.
  useEffect(() => {
    if (state) cardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [state]);

  if (!state) return null;
  const { card } = state;
  const replay = state.status === 'replay';
  const filed = state.status === 'filed';

  const approve = async () => {
    setFiling(true);
    setError(null);
    const snapshot = await mapSnapshot();
    const result = await approveBrief(sessionId, briefId, snapshot && snapshot.length <= SNAPSHOT_MAX_CHARS ? snapshot : null);
    setFiling(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setState({ ...state, status: 'filed', filedAt: result.filedAt, filedBy: result.filedBy });
    onDecision(approvedMessage(briefId));
  };

  return (
    <section ref={cardRef} className="brief-card" aria-label="Draft brief">
      <p className="brief-card__kicker">{filed ? 'Brief, filed' : 'Draft brief'}</p>
      <h3 className="brief-card__title">{card.title}</h3>
      <p className="brief-card__line">
        <span className="brief-card__num">{card.candidates} of {card.passesRead}</span> recent passes are candidates;
        EMIT looked <span className="brief-card__num">{card.looks}</span> times.
      </p>
      <dl className="brief-card__confidence">
        <div>
          <dt>Methane recurs here</dt>
          <dd>{CONFIDENCE_WORDS[card.confidence]}</dd>
        </div>
        <div>
          <dt>Any single explanation</dt>
          <dd>{card.singleExplanation}</dd>
        </div>
      </dl>
      {card.hypotheses.length > 0 && (
        <>
          <p className="brief-card__subhead">Unconfirmed hypotheses</p>
          <ul className="brief-card__hypotheses">
            {card.hypotheses.map((h) => (
              <li key={h.label}>
                <span>{h.label}</span>
                <span className="brief-card__assessment">{h.assessment}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {filed ? (
        <p className="brief-card__status" role="status">
          {/* Who filed it is in the S3 record; the stage says only that a person did. */}
          Filed by the analyst
          {typeof state.filedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(state.filedAt)
            ? <> at <span className="brief-card__num">{state.filedAt.slice(0, 16).replace('T', ' ')}</span> UTC</>
            : null}
          . The agent did not file it.
        </p>
      ) : replay ? (
        <p className="brief-card__status">Recorded case: the decision is made live, not replayed.</p>
      ) : (
        <>
          <p className="brief-card__status">Decision: analyst's.</p>
          <div className="brief-card__actions">
            <button type="button" className="stage-btn stage-btn--primary" onClick={() => void approve()} disabled={busy || filing}>
              {filing ? 'Filing' : 'Approve and file'}
            </button>
            <button
              type="button"
              className="stage-btn stage-btn--quiet"
              onClick={() => onDecision(anotherLookMessage(briefId))}
              disabled={busy || filing}
            >
              Request another look
            </button>
          </div>
          {error && <p className="brief-card__error" role="alert">{error}</p>}
        </>
      )}
    </section>
  );
}
