/**
 * Dark Vessels' clock plate (top centre of the map): what the room is looking at, dated, in two
 * lines. Line one says what is on the map ("AIS replay 2026-10-12 06:00 UTC", "4 candidates");
 * line two what it means, from the tools' own numbers. Numbers are set in the mono face (the
 * Tabular Rule); words in the body face (the Two Voices Rule). Read from the back of the room:
 * 24 px and 17 px.
 */
import { clockLines, numberRuns, type SeaBeat, type SeaFacts } from '../utils/vesselLayers.ts';

function Runs({ text }: { text: string }) {
  return (
    <>
      {numberRuns(text).map((r, i) =>
        r.num ? <span key={i} className="sea-clock__num">{r.text}</span> : <span key={i}>{r.text}</span>,
      )}
    </>
  );
}

export function SeaClock({ beat, facts }: { beat: SeaBeat; facts: SeaFacts }) {
  const { lead, sub } = clockLines(beat, facts);
  // The replay's clock ticks several times a second: announced, it would talk over everything.
  // Each beat of the argument is announced once as it lands.
  const ticking = beat === 'rest' || beat === 'forward';
  return (
    <section className="map-plate sea-clock" aria-label="What the map shows" aria-live={ticking ? 'off' : 'polite'} aria-atomic="true">
      <p className="sea-clock__lead">
        <Runs text={lead} />
      </p>
      <p className="sea-clock__sub">
        <Runs text={sub} />
      </p>
    </section>
  );
}
