/** Unit tests for the stage's punctuation (utils/caption.ts). */
import { describe, expect, it } from 'vitest';
import { stagePunctuation } from './caption';

describe('stagePunctuation', () => {
  it('turns an em dash into a comma and a numeric range into words', () => {
    expect(stagePunctuation('Shanxi 6 of 7 — following Shanxi')).toBe('Shanxi 6 of 7, following Shanxi');
    expect(stagePunctuation('2024–2025')).toBe('2024 to 2025');
    expect(stagePunctuation('no dashes here')).toBe('no dashes here');
  });

  it('drops a horizontal rule on its own line, never a table row or a dash in prose', () => {
    expect(stagePunctuation('T04 is a streak.\n\n---\n\n**Four candidates**')).toBe('T04 is a streak.\n\n\n\n**Four candidates**');
    expect(stagePunctuation('a\n  * * *\nb\n___')).toBe('a\n\nb\n');
    expect(stagePunctuation('| Box | Share |\n|---|---|\n| 1 | 9% |')).toBe('| Box | Share |\n|---|---|\n| 1 | 9% |');
    expect(stagePunctuation('- T01: 31 km\n- T02: 31 km')).toBe('- T01: 31 km\n- T02: 31 km');
    expect(stagePunctuation('a -- b')).toBe('a -- b');
  });
});

describe('a bearing range (P2, Act 2)', () => {
  it('reads "NNW to SSE", never "NNW, SSE"', () => {
    expect(stagePunctuation('The plume runs NNW–SSE for 2 km.')).toBe('The plume runs NNW to SSE for 2 km.');
    expect(stagePunctuation('A line E—W through the centre.')).toBe('A line E to W through the centre.');
    // A dash between words still reads as a comma.
    expect(stagePunctuation('Clear — the walls show.')).toBe('Clear, the walls show.');
  });
});
