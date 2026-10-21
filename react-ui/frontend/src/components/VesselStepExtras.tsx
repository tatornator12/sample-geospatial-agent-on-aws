/**
 * Dark Vessels' step column (Act 3, the one open question; redesign §3.8.1, §3.11). StepColumn
 * renders this for a turn that called the act's tools, keyed by the turn's send time, so every
 * question loads its own files afresh whether or not StepColumn stays mounted between turns
 * (review L3).
 *
 * It loads, through useStageFiles, this turn's board (passes_<list_passes id>.json), one decision
 * file per streamed decide call and the coverage file of each pass whose received area reached the
 * map, and renders the steps in the act's grammar (utils/vesselSteps.ts): the board under "Weigh
 * the passes on file", one "Decided:" or "Checked:" line per accepted decision and check, the
 * radar's chip under "Look at the radar" and the evidence chips under "Gather the evidence".
 * Every word under a row comes from the files' enums and numbers; a refused decision wrote no file,
 * so it shows no line; a candidate count waits for the map's reveal (`revealed`, held by Chat.tsx
 * from MapView's onCandidatesRevealed). While the agent works, the lit row and its line are kept
 * in view. The rows themselves look as they do on every act: one grammar for the platform.
 */
import { useEffect, useRef, useState } from 'react';
import type { ToolCall } from '../types.ts';
import { theme } from '../theme';
import type { EvidenceItem } from '../utils/evidence.ts';
import { useStageFiles } from '../hooks/useStageFiles.ts';
import { passOf, vesselKind } from '../utils/vesselLayers.ts';
import {
  DECISION_KEYS,
  boardAccepted,
  boardUrl,
  decisionUrl,
  litKey,
  litScrollOptions,
  parseBoard,
  parseDecision,
  parseHeard,
  vesselColumn,
  vesselGroupName,
  vesselsDirFrom,
  type Board,
  type CoverageCheck,
  type Decision,
  type StepLine,
} from '../utils/vesselSteps.ts';
import { EvidenceChip } from './EvidenceChip.tsx';
import { PassBoard } from './PassBoard.tsx';

/** What the live stage hands the act's column: whose files to read, and what the map has revealed. */
export interface VesselStage {
  sessionId: string;
  /** The project bucket from the rest file (validated in loadVesselRest), or null. */
  bucket?: string | null;
  /** The replay case on the stage, if any. */
  caseId?: string | null;
  /** When the presenter sent this turn (ms); the column remounts on it. */
  turnSentAt: number;
  /** The passes whose candidates the map has revealed, with the count it revealed. */
  revealed: Readonly<Record<string, number>>;
}

interface VesselStepExtrasProps {
  steps: ToolCall[];
  live: boolean;
  evidence?: EvidenceItem[];
  onOpenEvidence?: (item: EvidenceItem, imageUrl: string) => void;
  /** Absent in an earlier turn's record: the steps in the act's grammar, with no files read. */
  stage?: VesselStage;
}

const MAX_VISIBLE = 9;
const NOTHING_REVEALED: Readonly<Record<string, number>> = {};

const urlOf = (call: ToolCall): string | undefined => (typeof call.params?.s3_url === 'string' ? call.params.s3_url : undefined);

/**
 * A line's numbers for the mono face, without the sentence's own punctuation: "Oct 12:" sets "12" in
 * mono and the colon in the body face ("box 1:" otherwise reads "box 1 :" from the mono cell).
 */
function lineRuns(text: string): Array<{ text: string; num: boolean }> {
  const out: Array<{ text: string; num: boolean }> = [];
  // Not a digit inside a name ("S1-D"): figures, dates and times only.
  const re = /(?<![A-Za-z])\d+(?:[:.,]\d+)*%?(?:\s?UTC)?/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), num: false });
    out.push({ text: m[0], num: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), num: false });
  return out;
}

/** One line under a step: "Decided:" in fog, "Checked:" in label grey, 15 px, numbers in mono. */
function LineText({ line }: { line: StepLine }) {
  const decided = line.label === 'Decided:';
  return (
    <span className={`step-detail step-line step-line--${decided ? 'decided' : 'checked'}`} style={{ color: decided ? 'var(--fog)' : 'var(--label)' }}>
      <span>
        <span style={{ fontWeight: 600 }}>{line.label}</span>{' '}
        {lineRuns(line.text).map((r, i) => (
          r.num
            ? <span key={i} style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>{r.text}</span>
            : <span key={i}>{r.text}</span>
        ))}
      </span>
    </span>
  );
}

export function VesselStepExtras({ steps, live, evidence = [], onOpenEvidence, stage }: VesselStepExtrasProps) {
  const [expanded, setExpanded] = useState(false);
  const turnSentAt = stage?.turnSentAt ?? 0;
  const revealed = stage?.revealed ?? NOTHING_REVEALED;

  // Where this question's files are: this session's (or case's) vessels folder, from a streamed
  // s3_url or, before one has streamed, the rest file's bucket (none in an earlier turn's record).
  const dir = stage ? vesselsDirFrom(steps, stage.sessionId, { bucket: stage.bucket, caseId: stage.caseId }) : null;

  // The board: this turn's latest list_passes call's own file.
  const boardFile = boardUrl(dir, steps);
  const boards = useStageFiles<Board>(boardFile ? [boardFile] : [], (raw) => parseBoard(raw));
  const loaded = boardFile && Object.prototype.hasOwnProperty.call(boards, boardFile) ? boards[boardFile] : null;
  const board = loaded && boardAccepted(loaded, DECISION_KEYS, turnSentAt) ? loaded : null;

  // One file per streamed decide call, in the board's question (a refused call never writes one).
  const decideUrls = new Map<string, string>();
  for (const call of steps) {
    if (call.name !== 'decide') continue;
    const url = decisionUrl(dir, board?.questionId ?? null, call);
    if (url) decideUrls.set(call.id, url);
  }
  const decisionFiles = useStageFiles<Decision>([...new Set(decideUrls.values())], (raw) => parseDecision(raw));
  const decisions: Record<string, Decision> = {};
  decideUrls.forEach((url, id) => {
    if (Object.prototype.hasOwnProperty.call(decisionFiles, url)) decisions[id] = decisionFiles[url];
  });

  // The coverage check of each pass whose received area has streamed to the map.
  const heardPasses = [...new Set(steps
    .filter((c) => c.name === 'display_visual' && vesselKind(urlOf(c)) === 'heard')
    .map((c) => passOf(urlOf(c)))
    .filter((p): p is string => !!p))];
  const heardUrl = (pass: string) => `${dir}heard_${pass}.geojson`;
  const heardFiles = useStageFiles<CoverageCheck>(dir ? heardPasses.map(heardUrl) : [], (raw) => parseHeard(raw));
  const heard: Record<string, CoverageCheck> = {};
  if (dir) {
    for (const pass of heardPasses) {
      const url = heardUrl(pass);
      if (Object.prototype.hasOwnProperty.call(heardFiles, url)) heard[pass] = heardFiles[url];
    }
  }

  const column = vesselColumn(steps, { board, decisions, heard, revealed });

  // While working: the lit row and its line in view whenever the lit step changes or a line lands
  // under it (unless the presenter has an earlier turn's record open). Instant under reduced motion.
  const litRef = useRef<HTMLLIElement>(null);
  const key = litKey(column, live);
  useEffect(() => {
    const row = litRef.current;
    if (!key || !row || row.closest('.stage-steps')?.querySelector('.earlier-turn__record')) return;
    const reduced = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    row.scrollIntoView(litScrollOptions(reduced));
  }, [key]);

  const groups = column.groups;
  if (groups.length === 0) return null;

  // The last nine steps, with the board's step pinned so it never scrolls away under "Show N earlier".
  const tail = groups.slice(-MAX_VISIBLE);
  const pinned = groups.slice(0, groups.length - tail.length).filter((g) => g.id === column.boardGroup && !!board);
  const visible = expanded ? groups : [...pinned, ...tail];
  const earlier = groups.length - pinned.length - tail.length;
  const litIndex = live ? visible.length - 1 : -1;
  const evidenceByTool = new Map(evidence.map((item) => [item.toolId, item]));

  return (
    <ol
      className="stage-step-column"
      aria-label={live ? 'Agent steps, in progress' : 'Agent steps, completed'}
      aria-live="polite"
      style={{ margin: 0, padding: 0, listStyle: 'none' }}
    >
      {earlier > 0 && (
        <li className="step-toggle">
          <button type="button" className="stage-btn stage-btn--quiet" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
            {expanded ? 'Hide the earlier steps' : earlier === 1 ? 'Show 1 earlier step' : `Show ${earlier} earlier steps`}
          </button>
        </li>
      )}
      {visible.map((group, i) => {
        const lit = i === litIndex;
        const done = !lit;
        const n = groups.indexOf(group) + 1;
        const lines = column.lines[group.id] ?? [];
        // The radar's chip under its look, the evidence chips (folded inspections) under the evidence step.
        const items = [...group.calls, ...group.folded]
          .map((c) => evidenceByTool.get(c.id))
          .filter((x): x is EvidenceItem => !!x);
        return (
          <li
            key={group.id || `${group.name}-${n}`}
            ref={lit ? litRef : undefined}
            aria-current={lit ? 'step' : undefined}
            style={{
              display: 'grid',
              // The dot, its gap and a two-digit number at 15px (the Back Row Rule) on one line.
              gridTemplateColumns: '32px 1fr',
              alignItems: 'center',
              columnGap: theme.spacing.sm,
              padding: '6px 0',
              // Scrolled into view clear of the column's sticky head and its foot's fade.
              scrollMarginTop: '52px',
              scrollMarginBottom: '24px',
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
              {vesselGroupName(group)}
              {lit && (
                <span
                  style={{
                    ...theme.typography.labelCaps,
                    fontSize: '15px',
                    letterSpacing: 'normal',
                    textTransform: 'none',
                    color: theme.colors.primary,
                    marginLeft: theme.spacing.sm,
                    display: 'inline-block',
                    whiteSpace: 'nowrap',
                  }}
                >
                  working
                </span>
              )}
            </span>
            {group.id === column.boardGroup && board && (
              <div style={{ gridColumn: '2 / -1' }}>
                <PassBoard rows={board.rows} states={column.states} />
              </div>
            )}
            {lines.map((line, j) => <LineText key={`${line.label}-${j}`} line={line} />)}
            {onOpenEvidence && items.map((item) => (
              <div key={item.toolId} style={{ gridColumn: '1 / -1' }}>
                <EvidenceChip item={item} onOpen={onOpenEvidence} />
              </div>
            ))}
          </li>
        );
      })}
    </ol>
  );
}
