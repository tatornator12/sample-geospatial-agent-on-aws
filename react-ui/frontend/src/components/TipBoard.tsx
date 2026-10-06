/**
 * The tip board: every watch area the agent scanned, strongest TROPOMI tip first, so the room sees
 * the whole field before the agent commits to a site. One row per area: its name and country (from
 * the stage's own table, never from the model), the anomaly in mono on a viridis bar (the TROPOMI
 * legend's own ramp, 0–60 ppb), and whether EMIT can look there. The sites EMIT was cued on carry a
 * ring; the one the agent followed is set in fog. Numbers come from the scan tools' manifests.
 */
import { rampGradient } from '../utils/render.ts';
import type { Tip } from '../utils/steps.ts';

const BAR_MAX_PPB = 60;

interface TipBoardProps {
  tips: Tip[];
  /** Area names EMIT was cued on this turn. */
  cued: string[];
  /** The area the agent followed into the dive, once it has committed. */
  chosen?: string | null;
  /** How many areas the scans covered (rows still loading show as pending). */
  expected: number;
}

export function TipBoard({ tips, cued, chosen = null, expected }: TipBoardProps) {
  if (tips.length === 0) return null;
  const gradient = rampGradient('viridis') ?? undefined;
  const pending = Math.max(0, expected - tips.length);
  return (
    <div className="tip-board" role="table" aria-label="TROPOMI tips by watch area, strongest first">
      {tips.map((tip) => {
        const isCued = cued.includes(tip.area.name);
        const isChosen = chosen === tip.area.name;
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
          </div>
        );
      })}
      {pending > 0 && (
        <div role="row" className="tip-row tip-row--pending">
          <span className="tip-row__mark" aria-hidden="true" />
          <span role="cell" className="tip-row__label">{pending} more {pending === 1 ? 'area' : 'areas'} scanning</span>
        </div>
      )}
    </div>
  );
}
