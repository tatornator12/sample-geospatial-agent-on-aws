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
import { RecordTimeline } from './RecordTimeline.tsx';
import { recordTimeline } from '../utils/record.ts';
import { barShown, decisionWords, recordBarsLine, samePoint, tipBarsLine, type Follow } from '../utils/follow.ts';
import { ProfileSection } from './ProfileSection.tsx';
import { SurveyRow } from './SurveyRow.tsx';
import { TipBoard } from './TipBoard.tsx';
import { VesselStepExtras, type VesselStage } from './VesselStepExtras.tsx';
import { useStageFiles } from '../hooks/useStageFiles.ts';
import { isVesselTurn } from '../utils/vesselSteps.ts';
import type { ProfileData } from '../utils/profileSection.ts';
import { belongsTo, parseSurvey, surveyEvidence, surveyUrl, type SurveyRecord } from '../utils/survey.ts';
import {
  PLAN_STAGES,
  chosenCue,
  cmPlumesUrl,
  cueTally,
  endFrameFilms,
  groupDetail,
  groupName,
  groupSteps,
  parseCmPlumes,
  parseManifest,
  passManifestUrl,
  planStage,
  rankTips,
  tipCued,
  type CmPlumes,
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
  /** Where the archaeologist's survey files live (this session's archaeology/ folder, or a replay case's). */
  archaeologyDir?: string | null;
  /** Dark Vessels: whose board and decision files to read, the turn's send time, the map's reveals. */
  vessel?: VesselStage;
  /** Methane Watch: the followed site's decision (follow.json): the decision line and the bars' plate lines. */
  follow?: Follow | null;
}

const MAX_VISIBLE = 9;

/** Two calls at the same point, to 4 decimals (the manifests' keys). */
function coordsMatch(a: ToolCall, b: ToolCall): boolean {
  const n = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN);
  const [la, lo, lb, mb] = [n(a.params?.lat), n(a.params?.lon), n(b.params?.lat), n(b.params?.lon)];
  return [la, lo, lb, mb].every(Number.isFinite) && la.toFixed(4) === lb.toFixed(4) && lo.toFixed(4) === mb.toFixed(4);
}

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
  archaeologyDir = null, vessel, follow = null,
}: StepColumnProps) {
  const [expanded, setExpanded] = useState(false);

  // The archaeologist's survey: one file per verdict record_condition accepted, named by the call's
  // id (a refused call writes none, so it shows no row); a file is shown only under its own call.
  const conditionUrls = new Map<string, string>();
  for (const call of steps) {
    const url = surveyUrl(archaeologyDir, call);
    if (url) conditionUrls.set(call.id, url);
  }
  const surveyFiles = useStageFiles<SurveyRecord>([...new Set(conditionUrls.values())], (raw) => parseSurvey(raw));
  const surveyByCall: Record<string, SurveyRecord> = {};
  for (const call of steps) {
    const url = conditionUrls.get(call.id);
    const record = url && Object.prototype.hasOwnProperty.call(surveyFiles, url) ? surveyFiles[url] : null;
    if (record && belongsTo(record, call)) surveyByCall[call.id] = record;
  }

  // The cue steps' manifests (one per cued site), loaded here so the end frame can tell which site
  // the agent followed: the one whose passes include the scene it then put on the map.
  const cues = steps.filter((c) => c.name === 'check_recent_passes');
  const manifestUrls = cues.map((c) => passManifestUrl(methaneDir, c)).filter((u): u is string => !!u);
  const manifests = useStageFiles<PassFrame[]>(manifestUrls, (raw) => (methaneDir ? parseManifest(raw, methaneDir) : null));
  const framesFor = (call: ToolCall): PassFrame[] | null => {
    const url = passManifestUrl(methaneDir, call);
    return url ? manifests[url] ?? null : null;
  };
  // Carbon Mapper's record per cued site (carbon_mapper_plumes), for the board's independent line.
  const cmCalls = steps.filter((c) => c.name === 'carbon_mapper_plumes');
  const cmUrls = cmCalls.map((c) => cmPlumesUrl(methaneDir, c)).filter((u): u is string => !!u);
  const cmRecords = useStageFiles<CmPlumes>(cmUrls, parseCmPlumes);

  if (steps.length === 0) return null;

  // Dark Vessels: the act's grammar, pass board and lines, remounted every turn by its send time so
  // each question loads its own files (redesign §3.8.1, review L3).
  if (isVesselTurn(steps)) {
    return <VesselStepExtras key={vessel?.turnSentAt ?? 0} steps={steps} live={live} evidence={evidence} onOpenEvidence={onOpenEvidence} stage={vessel} />;
  }

  const groups = groupSteps(steps);
  const stepIndex = new Map(steps.map((s, i) => [s.id, i]));
  const lastCue = steps.map((s) => s.name).lastIndexOf('check_recent_passes');
  // The followed site: follow_site's own record when it accepted a follow (the 90-day rule may follow
  // a spot ranked 2 or 3), else what the agent then looked at (missions recorded before it).
  const followed = follow ? cues.findIndex((c) => samePoint(follow.followed, c.params?.lat, c.params?.lon)) : -1;
  const chosen = followed >= 0 ? followed : chosenCue(cues, cues.map(framesFor), steps.slice(lastCue + 1));
  const cuedAreas = tips.filter((t) => tipCued(t, cues)).map((t) => t.area.name);
  const chosenArea = follow ? follow.followed.area
    : chosen !== null ? tips.find((t) => tipCued(t, [cues[chosen]]))?.area.name ?? null : null;
  // Carbon Mapper's record at a cue's own point (each checked spot has its own).
  const cmAt = (call: ToolCall): CmPlumes | null => {
    const at = cmCalls.find((c) => coordsMatch(c, call));
    const url = at ? cmPlumesUrl(methaneDir, at) : null;
    return url ? cmRecords[url] ?? null : null;
  };
  // The reason for the choice on the board: each cued site's candidate passes and newest candidate.
  const tallies: Record<string, CueTally> = {};
  tips.forEach((t) => {
    const cue = cues.find((c) => tipCued(t, [c]));
    const frames = cue ? framesFor(cue) : null;
    if (frames && frames.length > 0) tallies[t.area.name] = cueTally(frames);
  });
  // Carbon Mapper's line under each cued row: the record of the call made at that row's point.
  const cm: Record<string, CmPlumes> = {};
  tips.forEach((t) => {
    const call = cmCalls.find((c) => tipCued(t, [c]));
    const url = call ? cmPlumesUrl(methaneDir, call) : null;
    const record = url ? cmRecords[url] : undefined;
    if (record) cm[t.area.name] = record;
  });

  // The 90-day rule's step 2: a cue (or Carbon Mapper) step on spots none of which is an area's top
  // hotspot. It shows no filmstrips of its own (one point per beat), only the followed spot's record.
  const isExtra = (g: StepGroup) => (g.name === 'check_recent_passes' || g.name === 'carbon_mapper_plumes') &&
    tips.length > 0 && !tips.some((t) => tipCued(t, g.calls));
  const followSteps = groups.filter((g) => g.name === 'follow_site');
  const lastFollow = followSteps[followSteps.length - 1] ?? null;
  // The bar layers' display steps, from follow.json's own file names.
  const barOf = (g: StepGroup) => (g.name === 'display_visual' ? g.calls.map((c) => barShown(c, follow)).find((b) => b) ?? null : null);
  const hasFilm = (g: StepGroup) => g.name === 'check_recent_passes' && manifestUrls.length > 0 &&
    (!isExtra(g) || (chosen !== null && g.calls.includes(cues[chosen])));
  const hasBoard = (g: StepGroup) => g.name === 'scan_tropomi' && tips.length > 0;
  // A step with survey rows stays in view like the board: the verdicts never fold under "Show N earlier".
  // So do the follow decision and the two bar layers' lines: they are the following beat's point.
  const pinnedStep = (g: StepGroup) => hasFilm(g) || hasBoard(g) || surveyRows(g).length > 0 ||
    (!!follow && g === lastFollow) || barOf(g) !== null;
  // The survey's rows, each with the relief the agent looked at. That chip moves into its row (the
  // verdict beside its evidence), so the look step above no longer shows it a second time.
  function surveyRows(g: StepGroup): Array<{ record: SurveyRecord; item: EvidenceItem | null }> {
    if (g.name !== 'record_condition') return [];
    return g.calls
      .filter((c) => !!surveyByCall[c.id])
      .map((c) => {
        const record = surveyByCall[c.id];
        // The look the verdict was made on: the latest one before this call, never one after it.
        const at = stepIndex.get(c.id) ?? Infinity;
        return { record, item: surveyEvidence(record, evidence, (toolId) => (stepIndex.get(toolId) ?? Infinity) < at) };
      });
  }
  const inRows = new Set(
    groups.flatMap((g) => surveyRows(g)).map((r) => r.item?.toolId).filter((id): id is string => !!id),
  );
  // The end frame of a mission: the plan, the tip board, the chosen site's filmstrip and the brief;
  // the full list of steps is one click away. While working, the last steps, with the board and the
  // cue pinned so they never scroll away under "+N earlier".
  const collapsed = compact && !live && !expanded;
  const showAll = expanded;   // "Show all N steps" or "Show N earlier steps": every step, 01 included
  const tail = groups.slice(-MAX_VISIBLE);
  const pinned = groups.slice(0, groups.length - tail.length).filter(pinnedStep);
  const visible = collapsed ? groups.filter(pinnedStep) : showAll ? groups : [...pinned, ...tail];
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
          // A call still streaming has no inputs yet: its line waits for them rather than guess.
          const settled = group.calls.filter((c) => c.status !== 'executing');
          const bar = barOf(group);
          const extra = isExtra(group);
          // The stage's own words for the following beat (from follow.json), one point each: the
          // decision under the follow step, each bar layer's date under its display step.
          const ownLine = follow && group === lastFollow ? decisionWords(follow)
            : follow && bar === 'tip' ? tipBarsLine(follow)
              : follow && bar === 'record' ? recordBarsLine(follow)
                : null;
          const generic = settled.length > 0 ? groupDetail({ ...group, calls: settled }, groups.slice(0, at)) : null;
          const detail = ownLine ? { text: ownLine }
            : extra && generic && group.name === 'check_recent_passes'
              ? { ...generic, text: `The next ${group.calls.length === 1 ? 'spot' : `${group.calls.length} spots`} the scan ranked, by the 90-day rule` }
              : generic;
          const name = bar === 'tip' ? 'Show the tip in 3D' : bar === 'record' ? 'Show the latest close look in 3D'
            : extra && group.name === 'check_recent_passes' ? `Check ${group.calls.length} more ${group.calls.length === 1 ? 'spot' : 'spots'} with EMIT`
              : extra && group.name === 'carbon_mapper_plumes' ? `Check Carbon Mapper on ${group.calls.length} more ${group.calls.length === 1 ? 'spot' : 'spots'}`
                : groupName(group);
          const items = group.calls
            .map((c) => evidenceByTool.get(c.id))
            .filter((x): x is EvidenceItem => !!x && !inRows.has(x.toolId));
          const rows = surveyRows(group);
          // The filmstrips under a cue step: every cued site while working and in the full list; in
          // the end frame the site the agent followed with its frames, the others as their summary line.
          const allFilms = group.name === 'check_recent_passes'
            ? group.calls
              .filter((call) => !extra || (chosen !== null && call === cues[chosen]))
              .map((call) => ({ call, frames: framesFor(call) })).filter((f) => f.frames !== null)
            : [];
          const films = endFrameFilms(allFilms, chosen !== null ? cues[chosen] : null, collapsed);
          const board = hasBoard(group);
          return (
            <li
              key={group.id || `${group.name}-${n}`}
              aria-current={lit ? 'step' : undefined}
              style={{
                display: 'grid',
                // The dot, its gap and a two-digit number at 15px (the Back Row Rule) on one line.
                gridTemplateColumns: '32px 1fr',
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
                  fontSize: '15px',
                  color: lit ? theme.colors.primary : done ? theme.colors.success : theme.colors.secondary,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  whiteSpace: 'nowrap',
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
                {name}
                {lit && (
                  <span
                    style={{
                      ...theme.typography.labelCaps,
                      // 15px (the Back Row Rule) in sentence case, not tracked caps: at 15px the
                      // caps no longer fit beside a lit name in the 296px column at 1280, and a
                      // row that grows while lit shifts the list on every step.
                      fontSize: '15px',
                      letterSpacing: 'normal',
                      textTransform: 'none',
                      color: theme.colors.primary,
                      marginLeft: theme.spacing.sm,
                      // Kept whole: when a long name leaves no room, the label goes to the next line.
                      display: 'inline-block',
                      whiteSpace: 'nowrap',
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
                  <TipBoard
                    tips={rankTips(tips)}
                    cued={cuedAreas}
                    chosen={chosenArea}
                    expected={group.calls.length}
                    tallies={tallies}
                    cm={cm}
                    limit={collapsed ? 3 : undefined}
                  />
                </div>
              )}
              {films.map(({ call, frames, summaryOnly }) => {
                const j = group.calls.indexOf(call);
                const isFollowed = chosen !== null && call === cues[chosen];
                // A followed spot ranked 2 or 3 is not its area's top: its area's tip, with its own anomaly.
                const top = tips.find((t) => tipCued(t, [call]));
                const area = isFollowed && follow ? tips.find((t) => t.area.name === follow.followed.area) : undefined;
                const site = top ?? (area ? { ...area, anomalyPpb: follow!.followed.anomalyPpb } : undefined);
                // The following beat: the site the agent followed gets its record above its frames
                // (every look since 2025, Carbon Mapper's plumes, the gap to the tip). With a follow
                // decision on the plate, the timeline draws the marks and leaves the words to the plate.
                const record = !summaryOnly && isFollowed && site
                  ? recordTimeline({ tip: site, frames, cm: cmAt(call) ?? cm[site.area.name] })
                  : null;
                return (
                  <div key={call.id || String(j)} style={{ gridColumn: '2 / -1' }}>
                    {(films.length > 1 || collapsed) && (
                      <span className="step-detail__mono pass-film__site">
                        {site ? site.area.label : detail?.points?.[j] ?? ''}
                      </span>
                    )}
                    {record && <RecordTimeline model={record} plate={!!follow} />}
                    <PassFilmstrip toolId={call.id} frames={frames!} onOpen={onOpenEvidence} summaryOnly={summaryOnly}
                      noSummary={record !== null} />
                  </div>
                );
              })}
              {onOpenEvidence && items.map((item) => (
                <div key={item.toolId} style={{ gridColumn: '1 / -1' }}>
                  <EvidenceChip item={item} onOpen={onOpenEvidence} />
                </div>
              ))}
              {/* The archaeologist's survey: a row per site it judged, under the step that judged it. */}
              {rows.map(({ record, item }) => (
                <div key={record.toolUseId} style={{ gridColumn: '1 / -1' }}>
                  <SurveyRow record={record} evidence={item} onOpenEvidence={onOpenEvidence} />
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
