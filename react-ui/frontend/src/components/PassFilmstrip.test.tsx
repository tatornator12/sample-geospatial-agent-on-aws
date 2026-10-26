import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import type { PassFrame } from '../utils/steps.ts';
import { PassFilmstrip } from './PassFilmstrip.tsx';

const { getPresignedUrl } = vi.hoisted(() => ({
  getPresignedUrl: vi.fn(async (url: string) => `https://signed.example/${url.split('/').pop()}`),
}));
vi.mock('../services/api.ts', () => ({ getPresignedUrl }));

const dir = 's3://b/use-cases/methane-watch-mission/';
const frames: PassFrame[] = [
  { date: '2026-04-25', verdict: 'candidate', short: 'candidate', reason: null, peak: 2600, chipUrl: `${dir}passchip_a.png` },
  { date: '2026-02-01', verdict: 'rejected', short: 'within noise', reason: null, peak: 2518.1, chipUrl: `${dir}passchip_b.png` },
  { date: '2025-06-18', verdict: 'rejected', short: 'cloud or gap', reason: null, peak: null, chipUrl: null },
];

beforeEach(() => {
  getPresignedUrl.mockClear();   // a hook that returns a function would have it run as teardown
});
afterEach(cleanup);

describe('PassFilmstrip', () => {
  it('summaryOnly renders the line in words and no frames, and never asks for a presigned URL', async () => {
    const { container } = render(<PassFilmstrip toolId="t1" frames={frames} summaryOnly />);
    expect(container.querySelector('.pass-film__summary')?.textContent).toBe('1 candidate · 1 within noise · 1 cloud or gap');
    expect(container.querySelectorAll('.pass-film__frame')).toHaveLength(0);
    expect(container.querySelector('.pass-film__frames')).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(getPresignedUrl).not.toHaveBeenCalled();
  });

  it('the whole strip has a frame per pass and loads the chips', async () => {
    const { container } = render(<PassFilmstrip toolId="t1" frames={frames} />);
    expect(container.querySelectorAll('.pass-film__frame')).toHaveLength(3);
    expect(container.querySelector('.pass-film__summary')?.textContent).toBe('1 candidate · 1 within noise · 1 cloud or gap');
    await waitFor(() => expect(getPresignedUrl).toHaveBeenCalledTimes(2));
  });

  it('reads oldest first like the axis above it, each frame with its date, methane seen in the record\'s orange', () => {
    const { container } = render(<PassFilmstrip toolId="t1" frames={frames} />);
    const cells = [...container.querySelectorAll('.pass-film__cell')];
    expect(cells.map((c) => c.querySelector('.pass-film__date')?.textContent)).toEqual(['18 Jun 2025', '1 Feb 2026', '25 Apr']);
    // The year where it starts: under the first frame and the first of each new year.
    expect([...container.querySelectorAll('.pass-film__year')].map((y) => y.textContent)).toEqual(['2025', '2026']);
    expect(cells.map((c) => c.querySelector('button')?.getAttribute('aria-label'))).toEqual([
      '18 Jun 2025, clouded out', '1 Feb 2026, within noise', '25 Apr 2026, methane seen']);
    expect(cells.map((c) => c.querySelector('button')?.className)).toEqual([
      'pass-film__frame pass-film__frame--rejected pass-film__frame--clouded',
      'pass-film__frame pass-film__frame--rejected',
      'pass-film__frame pass-film__frame--candidate']);
    // The date is the frame's sibling (a dimmed frame never dims its date); a seen pass's date is fog.
    expect(cells[2].querySelector('.pass-film__date--seen')).not.toBeNull();
    expect(cells[2].querySelector('button .pass-film__date')).toBeNull();
    expect(container.querySelector('.pass-film__caption')?.textContent).toBe('The 3 EMIT passes read');
    expect(container.querySelector('.pass-film__frames')?.getAttribute('aria-label')).toBe('The 3 EMIT passes read, oldest first');
  });

  it('shows the newest eight of more, oldest of them first, and opens a frame in the stage\'s words', async () => {
    const many: PassFrame[] = Array.from({ length: 11 }, (_, i): PassFrame => ({
      date: `2026-0${Math.floor(i / 2) + 1}-1${i % 2}`, verdict: i === 10 ? 'candidate' : 'rejected', short: i === 10 ? 'candidate' : 'too weak',
      reason: 'the tool\'s reason', peak: 900, chipUrl: `${dir}passchip_${i}.png`,
    })).reverse();   // the manifest's order: newest first
    const onOpen = vi.fn();
    const { container } = render(<PassFilmstrip toolId="t1" frames={many} onOpen={onOpen} />);
    const dates = [...container.querySelectorAll('.pass-film__date')].map((d) => d.textContent);
    expect(dates).toEqual(['11 Feb 2026', '10 Mar', '11 Mar', '10 Apr', '11 Apr', '10 May', '11 May', '10 Jun']);
    expect(container.querySelector('.pass-film__caption')?.textContent).toBe('Newest 8 of 11 EMIT passes');
    await waitFor(() => expect(container.querySelectorAll('.pass-film__frame:not(:disabled)')).toHaveLength(8));
    (container.querySelectorAll('.pass-film__frame')[7] as HTMLButtonElement).click();
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ title: 'EMIT pass, 10 Jun 2026: methane seen' }), expect.any(String));
  });

  it('two chipless passes on one date (two granules of one orbit) are two frames with their own keys', () => {
    // The Oct 22 watch recording reads 2026-06-17 twice over the south Caspian, both cloud or gap.
    const sameDay: PassFrame[] = [
      { date: '2026-06-17', verdict: 'rejected', short: 'cloud or gap', reason: null, peak: null, chipUrl: null },
      { date: '2026-06-17', verdict: 'rejected', short: 'cloud or gap', reason: null, peak: null, chipUrl: null },
      { date: '2025-09-27', verdict: 'rejected', short: 'too weak', reason: null, peak: 577.9, chipUrl: `${dir}passchip_c.png` },
    ];
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { container } = render(<PassFilmstrip toolId="t1" frames={sameDay} />);
      expect(container.querySelectorAll('.pass-film__frame')).toHaveLength(3);
      const keyWarnings = errors.mock.calls.filter((args) => args.some((a) => typeof a === 'string' && a.includes('same key')));
      expect(keyWarnings).toEqual([]);
    } finally {
      errors.mockRestore();
    }
  });
});
