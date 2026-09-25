/**
 * The step column: where the agent is right now, readable from the back of the room.
 * A numbered list of the turn's steps with exactly one lit marker. Consecutive calls of one tool
 * are one step ("Scan 7 watch areas"); a watch mission shows its plan above the steps
 * (Baseline · Tip · Cue · Brief) and the cue step carries the filmstrip of passes it judged.
 * Sits at the left edge of the stage while the agent works and for the turn just finished.
 */
import { useState } from 'react';
import type { ToolCall } from '../types.ts';
import { theme } from '../theme';
import type { EvidenceItem } from '../utils/evidence.ts';
import { EvidenceChip } from './EvidenceChip.tsx';
import { PassFilmstrip } from './PassFilmstrip.tsx';
import { PLAN_STAGES, groupDetail, groupName, groupSteps, passManifestUrl, planStage, type StepGroup } from '../utils/steps.ts';

interface StepColumnProps {
  steps: ToolCall[];
  /** True while the agent is still streaming; the last step is the lit one. */
  live: boolean;
  /** Images the agent looked at this turn, keyed to the inspect_image step by tool id. */
  evidence?: EvidenceItem[];
  onOpenEvidence?: (item: EvidenceItem, imageUrl: string) => void;
  /** Where this session's (or replay case's) methane files live; enables the pass filmstrip. */
  methaneDir?: string | null;
  /** The mission's end frame (a brief card follows): the plan and the self-check, steps on demand. */
  compact?: boolean;
}

const MAX_VISIBLE = 9;

export function StepColumn({ steps, live, evidence = [], onOpenEvidence, methaneDir = null, compact = false }: StepColumnProps) {
  const [expanded, setExpanded] = useState(false);
  if (steps.length === 0) return null;

  const groups = groupSteps(steps);
  const hasFilm = (g: StepGroup) => !!methaneDir && g.calls.some((c) => passManifestUrl(methaneDir, c) !== null);
  // The end frame of a mission: the plan, the self-check (the cue's filmstrip) and the brief;
  // the full list of steps is one click away. While working, the last steps, with the cue pinned
  // so its filmstrip never scrolls away under "+N earlier".
  const collapsed = compact && !live && !expanded;
  const tail = groups.slice(-MAX_VISIBLE);
  const pinned = groups.slice(0, groups.length - tail.length).filter(hasFilm);
  const visible = collapsed ? groups.filter(hasFilm) : [...pinned, ...tail];
  const hidden = groups.length - visible.length;
  const litIndex = live ? visible.length - 1 : -1;
  const evidenceByTool = new Map(evidence.map((item) => [item.toolId, item]));
  const stage = planStage(steps);

  return (
    <>
      {stage !== null && (
        <ol className="plan-strip" aria-label={`The watch plan, at ${PLAN_STAGES[stage]}`}>
          {PLAN_STAGES.map((name, i) => (
            <li
              key={name}
              // Amber only while working (the One Spotlight Rule: once done, the brief's primary action owns it).
              className={`plan-strip__stage${i < stage || (!live && i === stage) ? ' plan-strip__stage--done' : ''}${live && i === stage ? ' plan-strip__stage--now' : ''}`}
              aria-current={live && i === stage ? 'step' : undefined}
            >
              {name}
            </li>
          ))}
        </ol>
      )}
      <ol
        className="stage-step-column"
        aria-label={live ? 'Agent steps, in progress' : 'Agent steps, completed'}
        aria-live="polite"
        style={{ margin: 0, padding: 0, listStyle: 'none' }}
      >
        {compact && !live ? (
          <li className="step-toggle">
            <button type="button" className="stage-btn stage-btn--quiet" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
              {expanded ? 'Show the summary' : groups.length === 1 ? 'Show the step' : `Show all ${groups.length} steps`}
            </button>
          </li>
        ) : hidden > 0 && (
          <li
            style={{
              ...theme.typography.mono,
              fontSize: '15px',
              color: theme.colors.secondary,
              padding: '2px 0 6px 36px',
            }}
          >
            +{hidden} earlier
          </li>
        )}
        {visible.map((group, i) => {
          const lit = i === litIndex;
          const done = !lit;
          const at = groups.indexOf(group);
          const n = at + 1;
          const fullDetail = groupDetail(group, groups.slice(0, at));
          // The end frame shows the chosen site only (the first cue); the runner-up is in the full list.
          const detail = fullDetail && collapsed && fullDetail.points?.length
            ? { ...fullDetail, mono: fullDetail.points[0] }
            : fullDetail;
          const items = group.calls.map((c) => evidenceByTool.get(c.id)).filter((x): x is EvidenceItem => !!x);
          const allFilms = group.calls
            .map((c) => ({ call: c, url: passManifestUrl(methaneDir, c) }))
            .filter((f): f is { call: ToolCall; url: string } => !!f.url);
          const films = collapsed ? allFilms.slice(0, 1) : allFilms;
          return (
            <li
              key={group.id || `${group.name}-${n}`}
              aria-current={lit ? 'step' : undefined}
              style={{
                display: 'grid',
                gridTemplateColumns: '28px 1fr',
                alignItems: 'center',
                columnGap: theme.spacing.sm,
                padding: '6px 0',
                color: lit ? theme.colors.onSurface : theme.colors.secondary,
                transition: `color ${theme.transitions.short}`,
              }}
            >
              <span
                style={{
                  ...theme.typography.mono,
                  fontSize: '13px',
                  color: lit ? theme.colors.primary : done ? theme.colors.success : theme.colors.secondary,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    display: 'inline-block',
                    backgroundColor: lit ? theme.colors.primary : done ? theme.colors.success : theme.colors.outlineVariant,
                    boxShadow: lit ? `0 0 0 5px ${theme.colors.primaryContainer}` : 'none',
                    transition: `box-shadow ${theme.transitions.medium}, background-color ${theme.transitions.short}`,
                  }}
                />
                {String(n).padStart(2, '0')}
              </span>
              <span
                style={{
                  ...theme.typography.bodyMedium,
                  fontSize: lit ? '17px' : '15px',
                  fontWeight: lit ? 600 : 400,
                  lineHeight: 1.25,
                  letterSpacing: '0.005em',
                }}
              >
                {groupName(group)}
                {lit && (
                  <span
                    style={{
                      ...theme.typography.labelCaps,
                      fontSize: '11px',
                      color: theme.colors.primary,
                      marginLeft: theme.spacing.sm,
                    }}
                  >
                    working
                  </span>
                )}
              </span>
              {detail && (
                <span className="step-detail">
                  {detail.text}
                  {/* Two filmstrips label their own sites; one line of both points would say it twice. */}
                  {detail.mono && films.length < 2 && <span className="step-detail__mono">{detail.mono}</span>}
                </span>
              )}
              {methaneDir && films.map(({ call, url }, j) => (
                <div key={call.id || url} style={{ gridColumn: '2 / -1' }}>
                  {/* Two sites cued: each strip says whose passes it shows (points and films share the calls' order). */}
                  {films.length > 1 && fullDetail?.points?.[j] && (
                    <span className="step-detail__mono pass-film__site">{fullDetail.points[j]}</span>
                  )}
                  <PassFilmstrip
                    toolId={call.id}
                    manifestUrl={url}
                    dir={methaneDir}
                    ready={call.status === 'completed' || !live}
                    onOpen={onOpenEvidence}
                  />
                </div>
              ))}
              {onOpenEvidence && items.map((item) => (
                <div key={item.toolId} style={{ gridColumn: '1 / -1' }}>
                  <EvidenceChip item={item} onOpen={onOpenEvidence} />
                </div>
              ))}
            </li>
          );
        })}
      </ol>
    </>
  );
}
