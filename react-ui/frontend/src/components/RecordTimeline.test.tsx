/**
 * The record timeline (approved 2026-10-23): a row per source with its own words, one mark per look
 * or plume day, and the bracket's words from the same function as the brief card's line.
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

const words = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

afterEach(cleanup);

describe('RecordTimeline', () => {
  it('names each row, draws its marks, and says the gap once', () => {
    render(<RecordTimeline model={recordTimeline({ tip: TIP, frames: FRAMES, cm: CM })!} />);
    const rows = [...document.querySelectorAll('.record-timeline [data-row]')];
    expect(rows.map((r) => [r.getAttribute('data-row'), r.querySelectorAll('[data-mark]').length])).toEqual([
      ['tropomi', 1], ['emit', 4], ['carbon_mapper', 2]]);
    expect(words(rows[0].querySelector('.record-timeline__label'))).toBe('TROPOMI +124.7 ppb, 7 to 21 Oct 2026');
    expect(words(rows[1].querySelector('.record-timeline__label'))).toBe('EMIT methane seen too faint or within noise clouded out');
    expect(words(rows[2].querySelector('.record-timeline__label'))).toBe('Carbon Mapper plumes within 7 km');
    expect([...rows[1].querySelectorAll('[data-mark]')].map((m) => m.className.replace('record-timeline__mark ', ''))).toEqual([
      'record-timeline__mark--seen', 'record-timeline__mark--seen', 'record-timeline__mark--faint', 'record-timeline__mark--clouded']);
    expect(document.querySelectorAll('.record-timeline__bracket')).toHaveLength(1);
    expect(words(document.querySelector('.record-timeline__gap-words'))).toBe('10 Jun 2026 to the tip: about 4 months');
    expect(words(document.querySelector('.record-timeline__axis'))).toBe('Jan 2025 21 Oct 2026');
    // The tracks say it in words for a screen reader.
    expect(rows[1].querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
      'EMIT looked on 4 days: methane seen on 2, too faint or within noise on 1, clouded out on 1');
  });

  it('says so when nothing fine-scale is on record, with no bracket', () => {
    render(<RecordTimeline model={recordTimeline({ tip: TIP, frames: [frame('2026-08-17', 'rejected', 'cloud or gap')], cm: null })!} />);
    expect(document.querySelector('.record-timeline__bracket')).toBeNull();
    expect(words(document.querySelector('.record-timeline__gap-words'))).toBe('No fine-scale confirmation on record');
  });

  it('writes only stage words: no dashes, no now, still, active or leaking', () => {
    render(<RecordTimeline model={recordTimeline({ tip: TIP, frames: FRAMES, cm: CM })!} />);
    const text = words(document.querySelector('.record-timeline'));
    expect(stagePunctuation(text)).toBe(text);
    expect(text).not.toMatch(/\b(now|still|active|leaking)\b/i);
  });
});
