/** Unit tests for the stage's punctuation (utils/caption.ts). */
import { describe, expect, it } from 'vitest';
import { stagePunctuation } from './caption';

describe('stagePunctuation', () => {
  it('turns an em dash into a comma and a numeric range into words', () => {
    expect(stagePunctuation('Shanxi 6 of 7 — following Shanxi')).toBe('Shanxi 6 of 7, following Shanxi');
    expect(stagePunctuation('2024–2025')).toBe('2024 to 2025');
    expect(stagePunctuation('no dashes here')).toBe('no dashes here');
  });
});
