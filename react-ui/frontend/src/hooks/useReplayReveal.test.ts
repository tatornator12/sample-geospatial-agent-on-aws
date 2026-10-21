import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { revealStepMs, useReplayReveal } from './useReplayReveal.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('revealStepMs', () => {
  it('is 600 ms a call, less for a long mission, so the whole reveal is under 6 s', () => {
    expect(revealStepMs(7)).toBe(600);
    expect(revealStepMs(10)).toBe(600);
    expect(revealStepMs(30)).toBe(200);
    expect(30 * revealStepMs(30)).toBeLessThanOrEqual(6000);
    expect(revealStepMs(0)).toBe(600);
  });
});

describe('useReplayReveal (B10, A1 P1-1)', () => {
  it('shows the calls one at a time in order, then ends the reveal so the answer can follow', () => {
    const { result } = renderHook(({ k, n }) => useReplayReveal(k, n, false), { initialProps: { k: 'case#1' as string | null, n: 3 } });
    expect(result.current).toEqual({ shown: 1, revealing: true });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(result.current).toEqual({ shown: 2, revealing: true });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(result.current).toEqual({ shown: 3, revealing: true });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(result.current).toEqual({ shown: 3, revealing: false });
  });

  it('ends at once on a new session (no key), and starts over for another case', () => {
    const { result, rerender } = renderHook(({ k, n }) => useReplayReveal(k, n, false), { initialProps: { k: 'case#1' as string | null, n: 5 } });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(result.current.shown).toBe(2);
    rerender({ k: null, n: 0 });
    expect(result.current.revealing).toBe(false);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.revealing).toBe(false);
    rerender({ k: 'other#2', n: 4 });
    expect(result.current).toEqual({ shown: 1, revealing: true });
  });

  it('shows everything at once under prefers-reduced-motion', () => {
    const { result } = renderHook(() => useReplayReveal('case#1', 7, true));
    expect(result.current).toEqual({ shown: 7, revealing: false });
  });
});
