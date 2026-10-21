import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { holdAfterLanding, holdMs, scheduleHeld } from './heldLayers.ts';

describe('holdMs', () => {
  it('keeps a whole number of milliseconds up to 15 s and lands anything else at once', () => {
    expect([8000, 1, 15000, 15001, 0, -5, 2.5, '8000', null, undefined, NaN].map(holdMs)).toEqual([
      8000, 1, 15000, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });
});

describe('scheduleHeld', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('lands each item after its own wait, not before', () => {
    const landed: string[] = [];
    scheduleHeld([{ item: 'hillshade', delayMs: 8000 }, { item: 'relief', delayMs: 3000 }], (x) => landed.push(x), () => false);
    vi.advanceTimersByTime(2999);
    expect(landed).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(landed).toEqual(['relief']);
    vi.advanceTimersByTime(4999);
    expect(landed).toEqual(['relief']);
    vi.advanceTimersByTime(1);
    expect(landed).toEqual(['relief', 'hillshade']);
  });

  it('never lands an item once the case has been let go of', () => {
    const landed: string[] = [];
    let gone = false;
    scheduleHeld([{ item: 'hillshade', delayMs: 8000 }], (x) => landed.push(x), () => gone);
    vi.advanceTimersByTime(5000);
    gone = true;
    vi.advanceTimersByTime(5000);
    expect(landed).toEqual([]);
  });

  it('waits for the scene before it to land, then for the whole hold', () => {
    const landed: string[] = [];
    const hold = holdAfterLanding(['tci.tif'], [{ item: 'hillshade', delayMs: 8000 }], (x) => landed.push(x), () => false);
    vi.advanceTimersByTime(3000); // the true colour is still on its way
    hold.landed('other.tif');
    expect(landed).toEqual([]);
    hold.landed('tci.tif');
    vi.advanceTimersByTime(7999);
    expect(landed).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(landed).toEqual(['hillshade']);
  });

  it('starts the hold anyway when the scene never lands, and cancels like the rest', () => {
    const landed: string[] = [];
    holdAfterLanding(['tci.tif'], [{ item: 'hillshade', delayMs: 8000 }], (x) => landed.push(x), () => false, undefined, 15000);
    vi.advanceTimersByTime(15000 + 8000);
    expect(landed).toEqual(['hillshade']);
    const cancelled = holdAfterLanding(['tci.tif'], [{ item: 'relief', delayMs: 1000 }], (x) => landed.push(x), () => false);
    cancelled.landed('tci.tif');
    cancelled.cancel();
    vi.advanceTimersByTime(30000);
    expect(landed).toEqual(['hillshade']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels every timer still waiting', () => {
    const landed: string[] = [];
    const cancel = scheduleHeld([{ item: 'a', delayMs: 1000 }, { item: 'b', delayMs: 9000 }], (x) => landed.push(x), () => false);
    vi.advanceTimersByTime(1000);
    cancel();
    vi.advanceTimersByTime(20000);
    expect(landed).toEqual(['a']);
    expect(vi.getTimerCount()).toBe(0);
  });
});
