/**
 * The record timeline (approved 2026-10-26): a row per source with its own words, TROPOMI then
 * Carbon Mapper then EMIT (its frames go under it), one mark per look or plume day, and the shared
 * date axis under the rows with the years, the latest close look's date, the gap in days and the
 * fortnight.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { RecordTimeline } from './RecordTimeline.tsx';
import { recordTimeline } from '../utils/record.ts';
import { stagePunctuation } from '../utils/caption.ts';
import { parseCmPlumes, parseTip, type PassFrame } from '../utils/steps.ts';

const TIP = parseTip({ area: 'shanxi coal basin', start: '2026-10-07', end: '2026-10-21', days: 14, emit_can_look: true,
  top: { lat: 37.8938, lon: 113.5625, anomaly_ppb: 124.7, valid_days: 3 } }, 'shanxi coal basin')!;
const frame = (date: string, verdict: PassFrame['verdict'], short: PassFrame['short']): PassFrame =>
  ({ date, verdict, short, reason: null, peak: null, chipUrl: null });
const FRAMES = [frame('2026-08-17', 'rejected', 'cloud or gap'), frame('2026-07-25', 'rejected', 'within noise'),
  frame('2025-08-18', 'candidate', 'candidate'), frame('2025-04-22', 'candidate', 'candidate')];
const CM = parseCmPlumes({ lat: 37.8938, lon: 113.5625, radius_km: 7, since: '2025-01-01', count: 2, latest: '2026-06-10',
  rate_kg_h: 2050, instrument: 'tanager', follow_radius_km: 7, dates: [
    { date: '2026-06-10', instrument: 'tanager', rate_kg_h: 2050, distance_km: 5.1 },
    { date: '2025-05-10', instrument: 'tanager', rate_kg_h: 100, distance_km: 5.1 }] })!;
const NO_CM = parseCmPlumes({ lat: 37.8938, lon: 113.5625, radius_km: 7, since: '2025-01-01', count: 0, latest: null,
  rate_kg_h: null, instrument: null, follow_radius_km: 7, dates: [] })!;

const words = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

afterEach(cleanup);

describe('RecordTimeline', () => {
  it('names each row, TROPOMI, Carbon Mapper, then EMIT, and draws its marks', () => {
    render(<RecordTimeline model={recordTimeline({ tip: TIP, frames: FRAMES, cm: CM })!} />);
    const rows = [...document.querySelectorAll('.record-timeline [data-row]')];
    expect(rows.map((r) => [r.getAttribute('data-row'), r.querySelectorAll('[data-mark]').length])).toEqual([
      ['tropomi', 1], ['carbon_mapper', 2], ['emit', 4]]);
    // The fortnight's dates over its band, at the right end; the year is the axis's.
    expect(words(rows[0].querySelector('.record-timeline__label'))).toBe('TROPOMI +124.7 ppb 7 to 21 Oct');
    expect(words(rows[0].querySelector('.record-timeline__fortnight'))).toBe('7 to 21 Oct');
    expect(words(rows[1].querySelector('.record-timeline__label'))).toBe('Carbon Mapper plumes within 7 km');
    expect(words(rows[2].querySelector('.record-timeline__label'))).toBe('EMIT methane seen too faint or within noise clouded out');
    expect([...rows[2].querySelectorAll('[data-mark]')].map((m) => m.className.replace('record-timeline__mark ', ''))).toEqual([
      'record-timeline__mark--seen', 'record-timeline__mark--seen', 'record-timeline__mark--faint', 'record-timeline__mark--clouded']);
    // The tracks say it in words for a screen reader.
    expect(rows[2].querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
      'EMIT looked on 4 days: methane seen on 2, too faint or within noise on 1, clouded out on 1');
  });

  it('puts the dates under the rows: the years, the latest close look at its mark, the gap in days', () => {
    render(<RecordTimeline model={recordTimeline({ tip: TIP, frames: FRAMES, cm: CM })!} />);
    expect([...document.querySelectorAll('.record-timeline__year')].map(words)).toEqual(['2025', '2026']);
    expect(document.querySelectorAll('.record-timeline__tick')).toHaveLength(22 + 2);   // 22 months, the latest look, the fortnight
    expect(document.querySelectorAll('.record-timeline__tick--year')).toHaveLength(2);
    expect(words(document.querySelector('.record-timeline__latest'))).toBe('10 Jun 2026');
    expect(document.querySelectorAll('.record-timeline__bracket')).toHaveLength(1);
    expect(words(document.querySelector('.record-timeline__gap-words'))).toBe('119 days to 7 Oct');
    expect([...document.querySelectorAll('.record-timeline__gap-words .record-timeline__num')].map(words)).toEqual(['119 days', '7 Oct']);
    // No lone start date over the frames any more, and no months.
    expect(words(document.querySelector('.record-timeline'))).not.toMatch(/Jan 2025|months?\b/);
    expect(document.querySelector('.record-timeline__axis')?.getAttribute('aria-label')).toBe(
      'Dates from January 2025 to 21 Oct 2026. Methane last seen up close on 10 Jun 2026, 119 days to 7 Oct, the first day of this fortnight.');
  });

  it('says so in an empty row, and draws no bracket without a close look', () => {
    render(<RecordTimeline model={recordTimeline({ tip: TIP, frames: [frame('2026-08-17', 'rejected', 'cloud or gap')], cm: NO_CM })!} />);
    const cm = document.querySelector('[data-row="carbon_mapper"]')!;
    expect(cm.querySelector('.record-timeline__track')).toBeNull();
    expect(words(cm.querySelector('.record-timeline__empty'))).toBe('none since January 2025');
    expect(document.querySelector('.record-timeline__bracket')).toBeNull();
    expect(document.querySelector('.record-timeline__latest')).toBeNull();
    expect(document.querySelector('.record-timeline__gap-words')).toBeNull();
  });

  it('a close look during the fortnight is said so, with no bracket', () => {
    render(<RecordTimeline model={recordTimeline({ tip: TIP, frames: [frame('2026-10-12', 'candidate', 'candidate')], cm: NO_CM })!} />);
    expect(document.querySelector('.record-timeline__bracket')).toBeNull();
    expect(words(document.querySelector('.record-timeline__latest'))).toBe('12 Oct 2026');
    expect(words(document.querySelector('.record-timeline__gap-words'))).toBe('during this fortnight');
  });

  it('writes only stage words: no dashes, no now, still, active or leaking', () => {
    render(<RecordTimeline model={recordTimeline({ tip: TIP, frames: FRAMES, cm: CM })!} />);
    const text = words(document.querySelector('.record-timeline'));
    expect(stagePunctuation(text)).toBe(text);
    expect(text).not.toMatch(/\b(now|still|active|leaking)\b/i);
  });
});
