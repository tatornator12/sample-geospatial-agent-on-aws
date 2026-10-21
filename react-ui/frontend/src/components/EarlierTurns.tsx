/**
 * "Earlier in this session": one row per turn before the one on the stage, above its question.
 * A row opens that turn's record in the step column: its steps (with their chips, filmstrips and
 * sections), and the answer the stage showed. It is a record, not a replay: the map keeps showing
 * the latest turn, and the record says so. One record is open at a time; the latest four rows
 * show, older ones are one press away.
 */
import { useEffect, useId, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Icon } from './Icons.tsx';
import { StepColumn } from './StepColumn.tsx';
import { extractEvidence, type EvidenceItem } from '../utils/evidence.ts';
import { withSaw } from '../utils/narration.ts';
import { groupSteps } from '../utils/steps.ts';
import { failedTurnLine, type PastTurn } from '../utils/turns.ts';
import type { ProfileData } from '../utils/profileSection.ts';

export const EARLIER_VISIBLE = 4;

interface EarlierTurnsProps {
  turns: PastTurn[];
  sessionId: string;
  /** The act's name, as the stage's answer is labelled. */
  speaker: string;
  /** Print "Saw: …" under a record's chips (not on Dark Vessels). */
  showSaw?: boolean;
  onOpenEvidence?: (item: EvidenceItem, imageUrl: string) => void;
  methaneDir?: string | null;
  profiles?: Record<string, ProfileData>;
}

function stepCount(n: number): string {
  if (n === 0) return 'no steps';
  return n === 1 ? '1 step' : `${n} steps`;
}

export function EarlierTurns({
  turns, sessionId, speaker, showSaw = true, onOpenEvidence, methaneDir = null, profiles = {},
}: EarlierTurnsProps) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [showOlder, setShowOlder] = useState(false);
  const openRef = useRef<HTMLLIElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const baseId = useId();

  // An opened record comes into view from its row down (the column scrolls inside itself), so the
  // row just pressed, and its focus ring, stay in sight under the column's head.
  // The first row brings its label along, so nothing lands half under the head.
  useEffect(() => {
    const row = openKey ? openRef.current : null;
    if (!row) return;
    const first = row.parentElement?.firstElementChild === row;
    (first ? sectionRef.current : row)?.scrollIntoView({ block: 'start' });
  }, [openKey]);

  if (turns.length === 0) return null;

  const older = turns.length - EARLIER_VISIBLE;
  const visible = showOlder || older <= 0 ? turns : turns.slice(-EARLIER_VISIBLE);

  return (
    <section ref={sectionRef} className="earlier-turns" aria-label="Earlier in this session">
      <h3 className="earlier-turns__label">Earlier in this session</h3>
      {older > 0 && !showOlder && (
        <button type="button" className="stage-btn stage-btn--quiet earlier-turns__more" onClick={() => setShowOlder(true)}>
          {older === 1 ? 'Show 1 more' : `Show ${older} more`}
        </button>
      )}
      <ul className="earlier-turns__list">
        {visible.map((turn) => {
          const open = openKey === turn.key;
          const recordId = `${baseId}-${turn.key}`;
          const n = groupSteps(turn.tools).length;
          const evidence = withSaw(extractEvidence(turn.tools, sessionId), showSaw ? turn.saw : undefined);
          return (
            <li key={turn.key} ref={open ? openRef : undefined} className={`earlier-turn${open ? ' earlier-turn--open' : ''}`}>
              <button
                type="button"
                className="earlier-turn__row"
                aria-expanded={open}
                aria-controls={recordId}
                title={turn.question}
                onClick={() => setOpenKey(open ? null : turn.key)}
              >
                <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} className="earlier-turn__chevron" />
                <span className="earlier-turn__question">{turn.question}</span>
                <span className="earlier-turn__count">· {stepCount(n)}</span>
              </button>
              {open && (
                <div id={recordId} className="earlier-turn__record">
                  <p className="earlier-turn__note">A record of this turn. The map shows the latest.</p>
                  {turn.tools.length > 0 && (
                    <StepColumn
                      steps={turn.tools}
                      live={false}
                      evidence={evidence}
                      onOpenEvidence={onOpenEvidence}
                      methaneDir={methaneDir}
                      profiles={profiles}
                    />
                  )}
                  {(turn.answer || turn.failed) && (
                    <div className={`stage-answer earlier-turn__answer${turn.failed ? ' stage-answer--failed' : ''}`}>
                      <span className="stage-answer__who">{speaker}</span>
                      {turn.failed ? (
                        <p className="stage-answer__text">{failedTurnLine(turn.answer, { record: true, tools: turn.tools })}</p>
                      ) : (
                        <div className="stage-answer__text markdown-content">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.answer}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
