/**
 * Dark Vessels' tasking plate (design component 9): the officer's decision, on the map.
 *
 * The agent drafts; the officer decides. The three patrol boxes are on the map with their share and
 * next look; the officer picks one (here or by clicking it) and drops candidates (here or by
 * clicking their rings), and the plate says the choice and the countdown to the look. "Approve the
 * tasking" is executed by the BACKEND (it reads the draft from S3, checks the choice against it and
 * the session's boxes, and files it); the agent is told only afterwards and checks with
 * tasking_status. In a replay case the plate is inert: a recorded decision would be theatre.
 */
import { useEffect, useId, useState } from 'react';
import { approveTasking, getTasking, type TaskingBox, type TaskingState } from '../services/api.ts';
import { SNAPSHOT_MAX_CHARS, mapSnapshot } from '../utils/snapshot.ts';
import { countdown, numberRuns, taskingLine } from '../utils/vesselLayers.ts';

const RETRY_MS = 2000;
const GIVE_UP_MS = 30_000;
const SHOW_WAITING_MS = 1500;

export interface TaskingPlateProps {
  sessionId: string;
  /** A replay case: the plate reads the case's draft and offers no decision. */
  caseId?: string;
  /** Changes with every new draft (the plate reloads). */
  draftKey: number;
  /** The agent is working: the choices wait. */
  busy: boolean;
  /** The officer's choice, held by the map (clicks on the boxes and the rings change it too). */
  box: number | null;
  excluded: readonly string[];
  onLoaded: (state: TaskingState) => void;
  onBox: (box: number) => void;
  onToggle: (candidateId: string) => void;
  onFiled: (taskingId: string) => void;
  onDismiss: () => void;
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

/** Numbers in the mono face (the Tabular Rule), words in the body face. */
function Runs({ text }: { text: string }) {
  return (
    <>
      {numberRuns(text).map((r, i) => (r.num ? <span key={i} className="tasking-plate__num">{r.text}</span> : <span key={i}>{r.text}</span>))}
    </>
  );
}

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function lookWords(b: TaskingBox, now: number): string {
  if (!b.look) return 'no look planned yet';
  return `next look ${b.look.text}, ${countdown(b.look.start, now)}`;
}

export function TaskingPlate({ sessionId, caseId, draftKey, busy, box, excluded, onLoaded, onBox, onToggle, onFiled, onDismiss }: TaskingPlateProps) {
  const [state, setState] = useState<TaskingState | null>(null);
  const [load, setLoad] = useState<'loading' | 'waiting' | 'failed' | 'loaded'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [filing, setFiling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const boxesId = useId();
  const candidatesId = useId();
  const titleId = useId();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    setState(null);
    setLoad('loading');
    const waiting = setTimeout(() => !cancelled && setLoad((l) => (l === 'loading' ? 'waiting' : l)), SHOW_WAITING_MS);
    const tryOnce = async () => {
      const loaded = await getTasking(caseId ? { caseId } : { sessionId });
      if (cancelled) return;
      if (loaded) {
        setState(loaded);
        setLoad('loaded');
        onLoaded(loaded);
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
    // onLoaded is the map's setter; the plate reloads only for a new draft or a retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, caseId, draftKey, attempt]);

  // The countdown moves on while the plate is up (a minute is its finest step).
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (!state) {
    if (load === 'loading') return null;
    return (
      <section className="map-plate tasking-plate" aria-label="Patrol tasking" aria-busy={load === 'waiting'}>
        {load === 'waiting' ? (
          <p className="tasking-plate__line" role="status">
            Drafting the tasking
            <WorkingDots />
          </p>
        ) : (
          <>
            <p className="tasking-plate__line" role="alert">The draft did not load.</p>
            <div className="tasking-plate__actions">
              <button type="button" className="stage-btn stage-btn--quiet" onClick={() => setAttempt((a) => a + 1)}>
                Try again
              </button>
            </div>
          </>
        )}
      </section>
    );
  }

  const { card } = state;
  const filed = state.status === 'filed';
  const replay = state.status === 'replay';
  const inert = filed || replay;
  const boxes = state.boxes.length ? state.boxes : [card.box];
  const chosenBox = boxes.find((b) => b.box === box) ?? card.box;
  const kept = card.candidates.filter((c) => !excluded.includes(c.id));

  const approve = async () => {
    setFiling(true);
    setError(null);
    const snapshot = await mapSnapshot();
    const result = await approveTasking(
      sessionId,
      card.taskingId,
      chosenBox.box,
      kept.map((c) => c.id),
      snapshot && snapshot.length <= SNAPSHOT_MAX_CHARS ? snapshot : null,
    );
    setFiling(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const next: TaskingState = {
      ...state,
      status: 'filed',
      filedAt: result.filedAt,
      filedBy: result.filedBy,
      choice: { box: chosenBox.box, candidateIds: kept.map((c) => c.id) },
    };
    setState(next);
    onLoaded(next);
    onFiled(card.taskingId);
  };

  const filedAt = typeof state.filedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(state.filedAt)
    ? state.filedAt.slice(0, 16).replace('T', ' ')
    : null;

  return (
    <section className="map-plate tasking-plate" aria-labelledby={titleId}>
      <div className="tasking-plate__head">
        <h2 className="tasking-plate__title" id={titleId}>Patrol tasking</h2>
        <span className={`tasking-plate__state${filed ? ' tasking-plate__state--filed' : ''}`}>
          {filed ? 'filed' : replay ? 'recorded' : 'draft'}
        </span>
      </div>

      {/* The choice scrolls on a short screen; the summary and the decision stay in view below it. */}
      <div className="tasking-plate__body">
      <fieldset className="tasking-plate__group" disabled={inert || busy || filing}>
        <legend className="tasking-plate__legend">Patrol box</legend>
        {boxes.map((b) => (
          <label key={b.box} className={`tasking-plate__option${b.box === chosenBox.box ? ' tasking-plate__option--on' : ''}`}>
            <input type="radio" name={`${boxesId}-box`} checked={b.box === chosenBox.box} onChange={() => onBox(b.box)} />
            <span className="tasking-plate__option-text">
              <span className="tasking-plate__option-main">
                <Runs text={`Box ${b.box}  ${pct(b.share)} of past dark targets`} />
              </span>
              <span className="tasking-plate__option-sub">
                <Runs text={lookWords(b, now)} />
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {card.candidates.length > 0 && (
        <fieldset className="tasking-plate__group" disabled={inert || busy || filing} aria-describedby={candidatesId}>
          <legend className="tasking-plate__legend">Candidates</legend>
          <ul className="tasking-plate__candidates">
            {card.candidates.map((c) => (
              <li key={c.id}>
                <label className="tasking-plate__check">
                  <input type="checkbox" checked={!excluded.includes(c.id)} onChange={() => onToggle(c.id)} />
                  <span className="tasking-plate__id">{c.id}</span>
                  <span className="tasking-plate__where">
                    <Runs text={`${c.portKm.toFixed(0)} km from ${c.port}`} />
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <p className="tasking-plate__note" id={candidatesId}>{card.sentence}</p>
        </fieldset>
      )}
      </div>

      <div className="tasking-plate__foot">
      <p className="tasking-plate__summary">
        <Runs text={taskingLine(chosenBox.box, kept.length, card.candidates.length)} />
      </p>

      {filed ? (
        <p className="tasking-plate__status" role="status">
          {/* Who filed it is in the S3 record; the stage says only that a person did. */}
          Filed by the officer{filedAt ? <> at <span className="tasking-plate__num">{filedAt}</span> UTC</> : null}. The agent did not file it.
        </p>
      ) : replay ? (
        <p className="tasking-plate__status">Recorded case: the decision is made live, not replayed.</p>
      ) : (
        <>
          <p className="tasking-plate__status">Decision: the officer's.</p>
          <div className="tasking-plate__actions">
            <button type="button" className="stage-btn stage-btn--primary" onClick={() => void approve()} disabled={busy || filing}>
              {filing ? <>Filing<WorkingDots /></> : 'Approve the tasking'}
            </button>
            <button type="button" className="stage-btn stage-btn--quiet" onClick={onDismiss} disabled={filing}>
              Not now
            </button>
          </div>
          {error && <p className="tasking-plate__error" role="alert">{error}</p>}
        </>
      )}
      </div>
    </section>
  );
}
