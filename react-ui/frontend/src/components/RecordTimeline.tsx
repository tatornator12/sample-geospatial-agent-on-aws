/**
 * The followed site's record (Methane Watch, the following beat): a row per source on one shared date
 * axis from January 2025 to the TROPOMI tip, read top to bottom as TROPOMI (the fortnight's band, its
 * dates over it), Carbon Mapper and EMIT (last, so its pass frames sit right under it, PassFilmstrip),
 * then the axis itself: a tick per month with the years at their Januaries, the latest close look's
 * date at its mark, and the bracket from it to the fortnight's first day with the gap in days
 * (approved 2026-10-26, after the presenter's run: "it doesn't show dates underneath").
 *
 * Built from the tools' manifests only (utils/record.ts); every word is the stage's own. Colour says
 * the source (EMIT plasma orange, Carbon Mapper mint as on the map, TROPOMI pale ice), shape says
 * what a look found (filled: methane seen; ring: too faint or within noise; tick: clouded out).
 * Nothing on the axis is ever set below 15 px: a label that does not fit goes to the next line
 * (axisLayout), measured against the axis's own width.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import {
  axisLayout, dayMonthYear, emptyRowWords, type AxisPart, type RecordTimelineModel,
} from '../utils/record.ts';

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
/** One label line under the ticks (15 px text at 1.3). */
const LINE_PX = 20;
/** Until the axis is measured (and in tests), the column's width at 1280 x 720. */
const FALLBACK_WIDTH = 222;

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function Parts({ parts }: { parts: AxisPart[] }) {
  return <>{parts.map((p, i) => (p.mono ? <span key={i} className="record-timeline__num">{p.text}</span> : <span key={i}>{p.text}</span>))}</>;
}

const text = (parts: AxisPart[]) => parts.map((p) => p.text).join('');

/** The axis's own width in px, kept up to date as the column resizes. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(el.clientWidth);
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export function RecordTimeline({ model }: { model: RecordTimelineModel }) {
  const { band, emit, carbonMapper, latest, axis } = model;
  const [axisRef, measured] = useWidth();
  const layout = axisLayout(axis, measured || FALLBACK_WIDTH);
  const seen = emit.filter((m) => m.kind === 'seen').length;
  const faint = emit.filter((m) => m.kind === 'faint').length;
  const clouded = emit.filter((m) => m.kind === 'clouded').length;
  const ppb = band.ppb !== null ? `${band.ppb >= 0 ? '+' : ''}${band.ppb.toFixed(1)}` : null;
  // The fortnight's first day, carried down the lower rows as a faint ice rule: the bracket's end.
  const now = <span className="record-timeline__now" aria-hidden="true" style={{ left: pct(band.from) }} />;
  const axisWords = [
    `Dates from January 2025 to ${dayMonthYear(band.end)}.`,
    latest && axis.gap ? `Methane last seen up close on ${dayMonthYear(latest.date)}, ${text(axis.gap.words)}, the first day of this fortnight.` : '',
    latest && axis.during ? `Methane seen up close on ${dayMonthYear(latest.date)}, during this fortnight.` : '',
  ].filter(Boolean).join(' ');

  return (
    <section className="record-timeline" aria-label="The site's record since January 2025">
      <div className="record-timeline__row" data-row="tropomi">
        <p className="record-timeline__label record-timeline__label--split">
          <span>
            TROPOMI{' '}
            {ppb && <span className="record-timeline__note"><span className="record-timeline__num">{ppb}</span> ppb</span>}
          </span>{' '}
          {/* The fortnight, over its own band at the axis's right end. */}
          <span className="record-timeline__num record-timeline__fortnight">{axis.fortnight}</span>
        </p>
        <div className="record-timeline__track" role="img" aria-label={`TROPOMI tip from ${dayMonthYear(band.start)} to ${dayMonthYear(band.end)}`}>
          <span className="record-timeline__band" data-mark style={{ width: `max(8px, ${pct(band.to - band.from)})` }} />
        </div>
      </div>

      <div className="record-timeline__row" data-row="carbon_mapper">
        <p className="record-timeline__label">
          Carbon Mapper{' '}
          <span className="record-timeline__note record-timeline__keys">
            <span>
              <span className="record-timeline__key record-timeline__key--plume" aria-hidden="true" />
              plumes within <span className="record-timeline__keep"><span className="record-timeline__num">7</span> km</span>
            </span>
          </span>
        </p>
        {carbonMapper.length === 0 ? (
          <p className="record-timeline__empty">{emptyRowWords('carbon_mapper', model.carbonMapperRead)}</p>
        ) : (
          <div className="record-timeline__track" role="img"
            aria-label={`Carbon Mapper: plumes on ${plural(carbonMapper.length, 'day', 'days')} within 7 km`}>
            {now}
            {carbonMapper.map((m) => (
              <span key={m.date} data-mark className="record-timeline__mark record-timeline__mark--plume"
                style={{ left: pct(m.at) } as CSSProperties} />
            ))}
          </div>
        )}
      </div>

      <div className="record-timeline__row" data-row="emit">
        <p className="record-timeline__label">
          EMIT{' '}
          <span className="record-timeline__note record-timeline__keys">
            <span><span className="record-timeline__key record-timeline__key--seen" aria-hidden="true" />methane seen</span>{' '}
            <span><span className="record-timeline__key record-timeline__key--faint" aria-hidden="true" />too faint or within noise</span>{' '}
            <span><span className="record-timeline__key record-timeline__key--clouded" aria-hidden="true" />clouded out</span>
          </span>
        </p>
        {emit.length === 0 ? (
          <p className="record-timeline__empty">{emptyRowWords('emit')}</p>
        ) : (
          <div
            className="record-timeline__track"
            role="img"
            aria-label={`EMIT looked on ${plural(emit.length, 'day', 'days')}: methane seen on ${seen}, too faint or within noise on ${faint}, clouded out on ${clouded}`}
          >
            {now}
            {emit.map((m) => (
              <span
                key={m.date}
                data-mark
                className={`record-timeline__mark record-timeline__mark--${m.kind}`}
                style={{ left: pct(m.at) } as CSSProperties}
              />
            ))}
          </div>
        )}
      </div>

      {/* The shared axis: the months, the years, the latest close look and the gap to the fortnight. */}
      <div className="record-timeline__axis" ref={axisRef} role="img" aria-label={axisWords}>
        <div className="record-timeline__ticks" aria-hidden="true">
          {axis.ticks.map((t) => (
            <span key={t.at} className={`record-timeline__tick${t.year ? ' record-timeline__tick--year' : ''}`} style={{ left: pct(t.at) }} />
          ))}
          {axis.latest && <span className="record-timeline__tick record-timeline__tick--latest" style={{ left: pct(axis.latest.at) }} />}
          <span className="record-timeline__tick record-timeline__tick--now" style={{ left: pct(band.from) }} />
        </div>
        <div className="record-timeline__labels" aria-hidden="true" style={{ height: layout.lines * LINE_PX }}>
          {layout.years.map((y) => (
            <span key={y.text} className="record-timeline__num record-timeline__year"
              style={{ left: y.left, top: y.line * LINE_PX }}>{y.text}</span>
          ))}
          {layout.latest && (
            <span className="record-timeline__num record-timeline__latest"
              style={{ left: layout.latest.left, top: layout.latest.line * LINE_PX }}>{layout.latest.text}</span>
          )}
          {layout.gap && (
            <>
              <span className="record-timeline__bracket" style={{
                left: layout.gap.bracket.left, width: layout.gap.bracket.right - layout.gap.bracket.left,
                top: layout.gap.bracket.line * LINE_PX + 4,
              }} />
              <span className="record-timeline__gap-words" style={{ left: layout.gap.left, top: layout.gap.line * LINE_PX }}>
                <Parts parts={layout.gap.words} />
              </span>
            </>
          )}
          {layout.during && (
            <span className="record-timeline__gap-words" style={{ left: layout.during.left, top: layout.during.line * LINE_PX }}>
              <Parts parts={layout.during.words} />
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
