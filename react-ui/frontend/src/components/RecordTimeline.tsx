/**
 * The followed site's record (Methane Watch, the following beat): one date axis from January 2025 to
 * the TROPOMI tip, a row per source, and one bracket from the latest fine-scale confirmation to the
 * tip, worded "about N months" (or "N days"). The room sees why the agent recommends a new look:
 * the methane has been seen here before, and the newest close look is months older than the tip.
 *
 * Built from the tools' manifests only (utils/record.ts); every word is the stage's own. Colour says
 * the source (EMIT plasma orange, Carbon Mapper mint as on the map, TROPOMI pale ice), shape says
 * what a look found (filled: methane seen; ring: too faint or within noise; tick: clouded out).
 */
import type { CSSProperties } from 'react';
import { dayMonthYear, windowWords, type RecordTimelineModel } from '../utils/record.ts';

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export function RecordTimeline({ model }: { model: RecordTimelineModel }) {
  const { band, emit, carbonMapper, latest } = model;
  const seen = emit.filter((m) => m.kind === 'seen').length;
  const faint = emit.filter((m) => m.kind === 'faint').length;
  const clouded = emit.filter((m) => m.kind === 'clouded').length;
  const bracket = latest && latest.days > 0 ? { from: latest.at, to: band.from } : null;
  const ppb = band.ppb !== null ? `${band.ppb >= 0 ? '+' : ''}${band.ppb.toFixed(1)}` : null;

  return (
    <section className="record-timeline" aria-label="The site's record since January 2025">
      <div className="record-timeline__row" data-row="tropomi">
        <p className="record-timeline__label">
          TROPOMI{' '}
          <span className="record-timeline__note">
            {ppb && <><span className="record-timeline__num">{ppb}</span> ppb, </>}
            <span className="record-timeline__num">{windowWords(band.start, band.end)}</span>
          </span>
        </p>
        <div className="record-timeline__track" role="img" aria-label={`TROPOMI tip from ${dayMonthYear(band.start)} to ${dayMonthYear(band.end)}`}>
          <span className="record-timeline__band" data-mark style={{ width: `max(8px, ${pct(band.to - band.from)})` }} />
        </div>
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
        <div
          className="record-timeline__track"
          role="img"
          aria-label={emit.length === 0 ? 'EMIT: no look since January 2025'
            : `EMIT looked on ${plural(emit.length, 'day', 'days')}: methane seen on ${seen}, too faint or within noise on ${faint}, clouded out on ${clouded}`}
        >
          {emit.map((m) => (
            <span
              key={m.date}
              data-mark
              className={`record-timeline__mark record-timeline__mark--${m.kind}`}
              style={{ left: pct(m.at) } as CSSProperties}
              title={dayMonthYear(m.date)}
            />
          ))}
        </div>
      </div>

      <div className="record-timeline__row" data-row="carbon_mapper">
        <p className="record-timeline__label">
          Carbon Mapper <span className="record-timeline__note">plumes within <span className="record-timeline__num">7</span> km</span>
        </p>
        <div
          className="record-timeline__track"
          role="img"
          aria-label={carbonMapper.length === 0 ? 'Carbon Mapper: no plume within 7 km since January 2025'
            : `Carbon Mapper: plumes on ${plural(carbonMapper.length, 'day', 'days')} within 7 km`}
        >
          {carbonMapper.map((m) => (
            <span key={m.date} data-mark className="record-timeline__mark record-timeline__mark--plume"
              style={{ left: pct(m.at) } as CSSProperties} title={dayMonthYear(m.date)} />
          ))}
        </div>
      </div>

      {/* The gap: a bracket from the latest confirmation's mark to the tip's first day, and its words. */}
      {bracket && (
        <div className="record-timeline__gap" aria-hidden="true">
          <span className="record-timeline__bracket" style={{ left: pct(bracket.from), width: pct(bracket.to - bracket.from) }} />
        </div>
      )}
      <p className="record-timeline__gap-words">
        {latest && bracket ? (
          <><span className="record-timeline__num">{dayMonthYear(latest.date)}</span> to the tip: {latest.words}</>
        ) : latest ? (
          <><span className="record-timeline__num">{dayMonthYear(latest.date)}</span>, inside the tip's window</>
        ) : (
          <>No fine-scale confirmation since <span className="record-timeline__num">Jan 2025</span></>
        )}
      </p>
      <p className="record-timeline__axis" aria-hidden="true">
        <span className="record-timeline__num">Jan 2025</span>{' '}
        <span className="record-timeline__num">{dayMonthYear(model.axisEnd)}</span>
      </p>
    </section>
  );
}
