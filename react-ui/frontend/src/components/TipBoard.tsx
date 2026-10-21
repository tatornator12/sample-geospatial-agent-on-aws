/**
 * The tip board: every watch area the agent scanned, strongest TROPOMI tip first, so the room sees
 * the whole field before the agent commits to a site. One row per area: its name and country (from
 * the stage's own table, never from the model), the anomaly in mono on a bar in the TROPOMI
 * legend's own ramp (ice, 0–60 ppb), and whether EMIT can look there. The sites EMIT was cued on
 * carry a ring and, once their passes are read, the reason for the choice ("2 of 4 candidate passes ·
 * latest 2025-08-20"); the one the agent followed is set in fog. Numbers come from the tools' manifests.
 */
import { rampGradient } from '../utils/render.ts';
import { TROPOMI_RAMP } from '../utils/methaneLayers.ts';
import type { CueTally, Tip } from '../utils/steps.ts';

const BAR_MAX_PPB = 60;

interface TipBoardProps {
  tips: Tip[];
  /** Area names EMIT was cued on this turn. */
  cued: string[];
  /** The area the agent followed into the dive, once it has committed. */
  chosen?: string | null;
  /** How many areas the scans covered (rows still loading show as pending). */
  expected: number;
  /**
   * The reason for the choice, by area name: each cued site's candidate passes out of those read and
   * its newest candidate (from the cue manifests' numbers), printed under its row.
   */
  tallies?: Record<string, CueTally>;
  /**
   * The mission's end frame: the strongest `limit` rows and any cued one, then "+N more areas"
   * (A2 P1-2); the full list is one press away ("Show all N steps").
   */
  limit?: number;
}

/** "2 of 4 candidate passes · latest 2026-04-25", the numbers in mono (the same words as cueTallyText). */
function CueLine({ tally }: { tally: CueTally }) {
  return (
    <span role="cell" className="tip-row__cue">
      <span className="tip-row__num">{tally.candidates}</span> of <span className="tip-row__num">{tally.read}</span>{' '}
      {tally.read === 1 ? 'candidate pass' : 'candidate passes'}
      {tally.latest && (
        <>
          {' · '}
          {/* "latest 2025-08-20" wraps as one piece: a date split at its hyphen misreads. */}
          <span className="tip-row__latest">
            latest <span className="tip-row__num">{tally.latest}</span>
          </span>
        </>
      )}
    </span>
  );
}

export function TipBoard({ tips, cued, chosen = null, expected, tallies = {}, limit }: TipBoardProps) {
  if (tips.length === 0) return null;
  const gradient = rampGradient(TROPOMI_RAMP) ?? undefined;
  const pending = Math.max(0, expected - tips.length);
  const shown = limit === undefined ? tips : tips.filter((tip, i) => i < limit || cued.includes(tip.area.name));
  const more = tips.length - shown.length;
  return (
    <div className="tip-board" role="table" aria-label="TROPOMI tips by watch area, strongest first">
      {shown.map((tip) => {
        const isCued = cued.includes(tip.area.name);
        const isChosen = chosen === tip.area.name;
        const tally = isCued && Object.prototype.hasOwnProperty.call(tallies, tip.area.name) ? tallies[tip.area.name] : undefined;
        const ppb = tip.anomalyPpb;
        const width = ppb === null ? 0 : Math.max(2, Math.min(100, (ppb / BAR_MAX_PPB) * 100));
        return (
          <div
            key={tip.area.name}
            role="row"
            className={`tip-row${isCued ? ' tip-row--cued' : ''}${isChosen ? ' tip-row--chosen' : ''}`}
          >
            <span className="tip-row__mark" aria-hidden="true" />
            <span role="cell" className="tip-row__label">
              {tip.area.label}
              {!tip.emit && <span className="tip-row__flag"> TROPOMI only</span>}
              {isChosen && <span className="tip-row__flag tip-row__flag--chosen"> following</span>}
            </span>
            <span role="cell" className="tip-row__value">
              {ppb === null ? 'no hotspot' : `${ppb >= 0 ? '+' : ''}${ppb.toFixed(1)} ppb`}
            </span>
            <span className="tip-row__bar" aria-hidden="true">
              {/* The full ramp is laid across the bar; the fill reveals as much of it as the anomaly earns. */}
              <span className="tip-row__fill" style={{ transform: `scaleX(${width / 100})`, backgroundImage: gradient }} />
            </span>
            {tally && <CueLine tally={tally} />}
          </div>
        );
      })}
      {more > 0 && (
        <div role="row" className="tip-row tip-row--more">
          <span className="tip-row__mark" aria-hidden="true" />
          <span role="cell" className="tip-row__label">+{more} more {more === 1 ? 'area' : 'areas'}</span>
        </div>
      )}
      {pending > 0 && (
        <div role="row" className="tip-row tip-row--pending">
          <span className="tip-row__mark" aria-hidden="true" />
          <span role="cell" className="tip-row__label">{pending} more {pending === 1 ? 'area' : 'areas'} scanning</span>
        </div>
      )}
    </div>
  );
}
