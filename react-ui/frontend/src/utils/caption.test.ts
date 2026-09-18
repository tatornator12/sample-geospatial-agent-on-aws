import { describe, expect, it } from 'vitest';
import { docentCaption } from './caption';

const REPORT = [
  '## 🌿 Vegetation Health — Hyde Park, London (2026-07-29)',
  'The park is in excellent summer condition with a mean NDVI of **0.47**. Here is the breakdown:',
  '| Vegetation Class | Area | Coverage |',
  '|---|---|---|',
  '| 🟢 Very Dense Vegetation (NDVI > 0.7) | 338,000 m² | **24.3%** |',
  '| 🔴 No Vegetation (≤ 0) | 8,600 m² | **0.6%** |',
  '',
  '**Key findings:**',
  '- **~45% of the park** is dense-to-very-dense vegetation',
  '- Only **0.6%** shows no vegetation',
].join('\n');

describe('docentCaption', () => {
  it('returns the last paragraph with heading and list markers stripped', () => {
    expect(docentCaption(REPORT)).toBe(
      '**Key findings:**\n**~45% of the park** is dense-to-very-dense vegetation\nOnly **0.6%** shows no vegetation',
    );
  });

  it('never speaks a table: trailing table rows are dropped, the prose before them stays', () => {
    const tableLast = REPORT.split('\n\n')[0];
    expect(docentCaption(tableLast)).toBe(
      '🌿 Vegetation Health — Hyde Park, London (2026-07-29)\n' +
        'The park is in excellent summer condition with a mean NDVI of **0.47**. Here is the breakdown:',
    );
  });

  it('keeps showing the previous sentence while a table row is still being typed', () => {
    const midStream = 'Folsom Lake on 2022-07-10: 12.4 km² of open water.\n\n| Date | Water';
    expect(docentCaption(midStream)).toBe('Folsom Lake on 2022-07-10: 12.4 km² of open water.');
  });

  it('strips blockquote markers and horizontal rules', () => {
    const text = 'Summary above.\n\n---\n\n> **Context:** the lake hit historic lows in 2021.';
    expect(docentCaption(text)).toBe('**Context:** the lake hit historic lows in 2021.');
  });

  it('caps long paragraphs at a sentence boundary', () => {
    const sentence = 'This sentence is exactly long enough to matter for the caption band. ';
    const caption = docentCaption(sentence.repeat(8).trim());
    expect(caption.length).toBeLessThanOrEqual(320);
    expect(caption.startsWith('This sentence')).toBe(true);
  });

  it('is empty for empty or table-only input', () => {
    expect(docentCaption('')).toBe('');
    expect(docentCaption('| a | b |\n|---|---|\n| 1 | 2 |')).toBe('');
  });
});
