/**
 * The step column: where the agent is right now, readable from the back of the room.
 * A numbered list of the turn's steps with exactly one lit marker. Consecutive calls of one tool
 * are one step ("Scan 7 watch areas"); a watch mission shows its plan above the steps
 * (Baseline · Tip · Cue · Check · Brief), the tip board under the scan (every area, strongest
 * first, before the agent commits), and a filmstrip of judged passes under each cued site.
 * Sits at the left edge of the stage while the agent works and for the turn just finished.
 */
import { useState } from 'react';
import type { ToolCall } from '../types.ts';
import { theme } from '../theme';
import type { EvidenceItem } from '../utils/evidence.ts';
import { EvidenceChip } from './EvidenceChip.tsx';
import { PassFilmstrip } from './PassFilmstrip.tsx';
import { ProfileSection } from './ProfileSection.tsx';
import { TipBoard } from './TipBoard.tsx';
import { useStageFiles } from '../hooks/useStageFiles.ts';
import type { ProfileData } from '../utils/profileSection.ts';
import {
  PLAN_STAGES,
  chosenCue,
  cueTally,
  endFrameFilms,
  groupDetail,
  groupName,
  groupSteps,
  parseManifest,
  passManifestUrl,
  planStage,
  rankTips,
  tipCued,
  type CueTally,
  type PassFrame,
  type StepGroup,
  type Tip,
} from '../utils/steps.ts';

interface StepColumnProps {
  steps: ToolCall[];
  /** True while the agent is still streaming; the last step is the lit one. */
  live: boolean;
  /** Images the agent looked at this turn, keyed to the inspect_image step by tool id. */
  evidence?: EvidenceItem[];
  onOpenEvidence?: (item: EvidenceItem, imageUrl: string) => void;
  /** Where this session's (or replay case's) methane files live; enables the filmstrips and the board. */
  methaneDir?: string | null;
  /** The TROPOMI tips loaded so far, by area (ChatSidebar loads them; the map shows them too). */
  tips?: Tip[];
  /** The mission's end frame (a brief card follows): the plan and the self-check, steps on demand. */
  compact?: boolean;
  /** The archaeologist's measured sections, by site id, drawn under the measure step that made them. */
  profiles?: Record<string, ProfileData>;
}

const MAX_VISIBLE = 9;

/**
 * The sections a measure step produced: by the site id it was called with; when the call carries
 * none the stage falls back to the one section there is, so a replay recorded before the id was
 * stored still shows its drawing.
 */
function sectionsFor(group: StepGroup, profiles: Record<string, ProfileData>): ProfileData[] {
  const ids = group.calls
    .map((c) => (c.params as Record<string, unknown> | undefined)?.site_id)
    .filter((id): id is string => typeof id === 'string');
  const hits = ids.map((id) => profiles[id]).filter((p): p is ProfileData => !!p);
  if (hits.length > 0) return [...new Map(hits.map((p) => [p.siteId, p])).values()];
  const all = Object.values(profiles);
  return ids.length === 0 && all.length === 1 ? all : [];
}

export function StepColumn({
  steps, live, evidence = [], onOpenEvidence, methaneDir = null, tips = [], compact = false, profiles = {},
}: StepColumnProps) {
  const [expanded, setExpanded] = useState(false);

  // The cue steps' manifests (one per cued site), loaded here so the end frame can tell which site
  // the agent followed: the one whose passes include the scene it then put on the map.
  const cues = steps.filter((c) => c.name === 'check_recent_passes');
  const manifestUrls = cues.map((c) => passManifestUrl(methaneDir, c)).filter((u): u is string => !!u);
  const manifests = useStageFiles<PassFrame[]>(manifestUrls, (raw) => (methaneDir ? parseManifest(raw, methaneDir) : null));
  const framesFor = (call: ToolCall): PassFrame[] | null => {
    const url = passManifestUrl(methaneDir, call);
    return url ? manifests[url] ?? null : null;
  };

  if (steps.length === 0) return null;

  const groups = groupSteps(steps);
  const lastCue = steps.map((s) => s.name).lastIndexOf('check_recent_passes');
  const chosen = chosenCue(cues, cues.map(framesFor), steps.slice(lastCue + 1));
  const cuedAreas = tips.filter((t) => tipCued(t, cues)).map((t) => t.area.name);
  const chosenArea = chosen !== null ? tips.find((t) => tipCued(t, [cues[chosen]]))?.area.name ?? null : null;
  // The reason for the choice on the board: each cued site's candidate passes and newest candidate.
  const tallies: Record<string, CueTally> = {};
  tips.forEach((t) => {
    const cue = cues.find((c) => tipCued(t, [c]));
    const frames = cue ? framesFor(cue) : null;
    if (frames && frames.length > 0) tallies[t.area.name] = cueTally(frames);
  });

  const hasFilm = (g: StepGroup) => g.name === 'check_recent_passes' && manifestUrls.length > 0;
  const hasBoard = (g: StepGroup) => g.name === 'scan_tropomi' && tips.length > 0;
  // The end frame of a mission: the plan, the tip board, the chosen site's filmstrip and the brief;
  // the full list of steps is one click away. While working, the last steps, with the board and the
  // cue pinned so they never scroll away under "+N earlier".
  const collapsed = compact && !live && !expanded;
  const showAll = expanded;   // "Show all N steps" or "Show N earlier steps": every step, 01 included
  const tail = groups.slice(-MAX_VISIBLE);
  const pinned = groups.slice(0, groups.length - tail.length).filter((g) => hasFilm(g) || hasBoard(g));
  const visible = collapsed ? groups.filter((g) => hasFilm(g) || hasBoard(g)) : showAll ? groups : [...pinned, ...tail];
  const earlier = groups.length - pinned.length - tail.length;
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
        ) : earlier > 0 && (
          // The steps above the last nine, one press away (while working too; the lit step stays last).
          <li className="step-toggle">
            <button type="button" className="stage-btn stage-btn--quiet" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
              {expanded ? 'Hide the earlier steps' : earlier === 1 ? 'Show 1 earlier step' : `Show ${earlier} earlier steps`}
            </button>
          </li>
        )}
        {visible.map((group, i) => {
          const lit = i === litIndex;
          const done = !lit;
          const at = groups.indexOf(group);
          const n = at + 1;
          const detail = groupDetail(group, groups.slice(0, at));
          const items = group.calls.map((c) => evidenceByTool.get(c.id)).filter((x): x is EvidenceItem => !!x);
          // The filmstrips under a cue step: every cued site while working and in the full list; in
          // the end frame the site the agent followed with its frames, the others as their summary line.
          const allFilms = group.name === 'check_recent_passes'
            ? group.calls.map((call) => ({ call, frames: framesFor(call) })).filter((f) => f.frames !== null)
            : [];
          const films = endFrameFilms(allFilms, chosen !== null ? cues[chosen] : null, collapsed);
          const board = hasBoard(group);
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
              {/* The board replaces the scan's area list; two filmstrips label their own sites. */}
              {detail && !board && (
                <span className="step-detail">
                  {detail.text}
                  {detail.mono && films.length < 2 && <span className="step-detail__mono">{detail.mono}</span>}
                </span>
              )}
              {board && (
                <div style={{ gridColumn: '2 / -1' }}>
                  <TipBoard tips={rankTips(tips)} cued={cuedAreas} chosen={chosenArea} expected={group.calls.length} tallies={tallies} />
                </div>
              )}
              {films.map(({ call, frames, summaryOnly }) => {
                const j = group.calls.indexOf(call);
                const site = tips.find((t) => tipCued(t, [call]));
                return (
                  <div key={call.id || String(j)} style={{ gridColumn: '2 / -1' }}>
                    {(films.length > 1 || collapsed) && (
                      <span className="step-detail__mono pass-film__site">
                        {site ? site.area.label : detail?.points?.[j] ?? ''}
                      </span>
                    )}
                    <PassFilmstrip toolId={call.id} frames={frames!} onOpen={onOpenEvidence} summaryOnly={summaryOnly} />
                  </div>
                );
              })}
              {onOpenEvidence && items.map((item) => (
                <div key={item.toolId} style={{ gridColumn: '1 / -1' }}>
                  <EvidenceChip item={item} onOpen={onOpenEvidence} />
                </div>
              ))}
              {/* The archaeologist's cross-section lands under the step that measured it. */}
              {group.name === 'measure_profile' && sectionsFor(group, profiles).map((p) => (
                <div key={p.siteId} style={{ gridColumn: '1 / -1' }}>
                  <ProfileSection profile={p} />
                </div>
              ))}
            </li>
          );
        })}
      </ol>
    </>
  );
}
