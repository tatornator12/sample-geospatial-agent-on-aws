/**
 * The brief card: the mission's end frame and the human decision (requirement 12).
 *
 * The agent drafts; the analyst decides. The card leads with what the room should restate (where,
 * how many passes, does methane recur, is the cause known) and the decision, then the ground
 * record; the hypotheses' "what would confirm it" and the gaps open on request so the decision is
 * never below the fold. "Approve and file" is executed by the BACKEND (it reads the draft from S3
 * and writes the filed record; the agent is told only afterwards and checks with brief_status);
 * "Request another look" asks the agent to read more passes. In a replay case the card is inert: a
 * recorded decision would be theatre.
 */
import { useEffect, useRef, useState } from 'react';
import { approveBrief, getBrief, type BriefState } from '../services/api.ts';
import { SNAPSHOT_MAX_CHARS, mapSnapshot } from '../utils/snapshot.ts';
import { anotherLookMessage, approvedMessage } from '../utils/brief.ts';

const RETRY_MS = 2000;
const GIVE_UP_MS = 30_000;
const SHOW_WAITING_MS = 1500;

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

/** The single-explanation line as the room reads it: the claim is the same, the words are plainer. */
function causeWords(singleExplanation: string): string {
  return singleExplanation === 'low without a ground or aircraft check'
    ? 'unconfirmed until a ground or aircraft check'
    : singleExplanation;
}

function WorkingDots() {
  return (
    <span className="docent-working" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export function BriefCard({ briefId, sessionId, caseId, busy, onDecision }: BriefCardProps) {
  const [state, setState] = useState<BriefState | null>(null);
  const [load, setLoad] = useState<'loading' | 'waiting' | 'failed' | 'loaded'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [filing, setFiling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showChecks, setShowChecks] = useState(false);
  const [showGaps, setShowGaps] = useState(false);
  const cardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    setState(null);
    setLoad('loading');
    // Say the brief is coming if it takes longer than a beat; never a silent gap at the end frame.
    const waiting = setTimeout(() => !cancelled && setLoad((l) => (l === 'loading' ? 'waiting' : l)), SHOW_WAITING_MS);
    const tryOnce = async () => {
      const loaded = await getBrief(briefId, caseId ? { caseId } : { sessionId });
      if (cancelled) return;
      if (loaded) {
        setState(loaded);
        setLoad('loaded');
      } else if (Date.now() - started < GIVE_UP_MS) {
        timer = setTimeout(tryOnce, RETRY_MS);
      } else {
        setLoad('failed');
      }
    };
    void tryOnce();
    return () => {
      cancelled = true;
      clearTimeout(waiting);
      if (timer) clearTimeout(timer);
    };
  }, [briefId, sessionId, caseId, attempt]);

  // The end frame: bring the card's head (title through the decision) into view when it lands,
  // and the waiting or failure line when that is what there is to see.
  useEffect(() => {
    if (state || load === 'waiting' || load === 'failed') cardRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [state, load]);

  if (!state) {
    if (load === 'loading') return null;
    return (
      <section ref={cardRef} className="brief-card" aria-label="Draft brief" aria-busy={load === 'waiting'}>
        {load === 'waiting' ? (
          <p className="brief-card__line" role="status">
            Drafting the brief
            <WorkingDots />
          </p>
        ) : (
          <>
            <p className="brief-card__line" role="alert">
              The draft did not load. It is saved as <span className="brief-card__num">{briefId}</span>.
            </p>
            <div className="brief-card__actions">
              <button type="button" className="stage-btn stage-btn--quiet brief-card__retry" onClick={() => setAttempt((a) => a + 1)}>
                Try again
              </button>
            </div>
          </>
        )}
      </section>
    );
  }

  const { card } = state;
  const replay = state.status === 'replay';
  const filed = state.status === 'filed';
  const checksToShow = card.hypotheses.some((h) => h.nextCheck);
  const gapCount = (card.gaps?.length ?? 0) + (card.nextCollection ? 1 : 0);

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
    <section ref={cardRef} className="brief-card" aria-label={filed ? 'Filed brief' : 'Draft brief'}>
      {/* The title is the tool's: what the evidence supports, then the geocoded place. */}
      <h3 className="brief-card__title">
        <span className="brief-card__state">{filed ? 'Filed brief' : 'Draft brief'}</span> {card.title}
      </h3>
      {/* Where, in the step column's own coordinate format, and which scan tipped it: provenance,
          never location, so a site at the edge of a watch box is not read as inside its namesake. */}
      <p className="brief-card__where">
        <span className="brief-card__coords">{card.lat.toFixed(2)}, {card.lon.toFixed(2)}</span>
        {card.watchArea && <span> · tipped by the {card.watchArea} watch area</span>}
      </p>
      <p className="brief-card__line">
        <span className="brief-card__num">{card.candidates}</span> of <span className="brief-card__num">{card.passesRead}</span>{' '}
        passes read{card.passesSince ? <> since <span className="brief-card__num">{card.passesSince}</span></> : null} are candidates;
        EMIT looked <span className="brief-card__num">{card.looks}</span> times in all.
      </p>
      {/* The two lines the room restates, at the size it reads from the back. */}
      <dl className="brief-card__verdict">
        <div>
          <dt>Methane recurs here</dt>
          <dd>{CONFIDENCE_WORDS[card.confidence]}</dd>
        </div>
        <div>
          <dt>Cause</dt>
          <dd>{causeWords(card.singleExplanation)}</dd>
        </div>
      </dl>

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
              {filing ? <>Filing<WorkingDots /></> : 'Approve and file'}
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

      {(card.checks?.length ?? 0) > 0 && (
        <>
          <p className="brief-card__subhead">Ground record</p>
          <ul className="brief-card__checks">
            {card.checks!.map((line, i) => (
              <li key={`check-${i}`}>{line}</li>
            ))}
          </ul>
        </>
      )}
      {card.hypotheses.length > 0 && (
        <>
          <p className="brief-card__subhead">Unconfirmed hypotheses</p>
          <ul className="brief-card__hypotheses" id={`${briefId}-hypotheses`}>
            {card.hypotheses.map((h) => (
              <li key={h.label}>
                <span className="brief-card__hypothesis">{h.label}</span>
                <span className="brief-card__assessment">{h.assessment}</span>
                {/* What would confirm or rule it out: the brief's own words, on request. */}
                {showChecks && h.nextCheck && <span className="brief-card__next-check">{h.nextCheck}</span>}
              </li>
            ))}
          </ul>
          {checksToShow && (
            <button
              type="button"
              className="brief-card__toggle"
              onClick={() => setShowChecks((s) => !s)}
              aria-expanded={showChecks}
              aria-controls={`${briefId}-hypotheses`}
            >
              {showChecks ? 'Hide what would confirm each' : 'What would confirm each'}
            </button>
          )}
        </>
      )}
      {gapCount > 0 && (
        <>
          <button
            type="button"
            className="brief-card__toggle brief-card__toggle--section"
            onClick={() => setShowGaps((s) => !s)}
            aria-expanded={showGaps}
            aria-controls={`${briefId}-gaps`}
          >
            Gaps and next look <span className="brief-card__num">{gapCount}</span>
          </button>
          <ul className="brief-card__checks" id={`${briefId}-gaps`} hidden={!showGaps}>
            {card.gaps?.map((line, i) => (
              <li key={`gap-${i}`}>{line}</li>
            ))}
            {card.nextCollection && <li className="brief-card__next">Next: {card.nextCollection}</li>}
          </ul>
        </>
      )}
    </section>
  );
}
