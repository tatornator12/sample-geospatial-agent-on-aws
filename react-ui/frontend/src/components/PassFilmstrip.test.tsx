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
