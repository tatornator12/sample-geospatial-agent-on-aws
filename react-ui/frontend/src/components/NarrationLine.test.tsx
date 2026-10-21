import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { NARRATION_INTERVAL_MS, NarrationLine } from './NarrationLine.tsx';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const line = () => document.querySelector('.stage-narration') as HTMLElement;
const advance = (ms: number) => act(() => {
  vi.advanceTimersByTime(ms);
});

describe('NarrationLine', () => {
  it('is a polite, atomic live region from the start of the turn', () => {
    render(<NarrationLine text={null} />);
    expect(line().getAttribute('aria-live')).toBe('polite');
    expect(line().getAttribute('aria-atomic')).toBe('true');
    expect(line().textContent).toBe('');
  });

  it('shows the first sentence at once and the next only after the interval', async () => {
    const view = render(<NarrationLine text="The scene is clear over the park." />);
    await advance(0);
    expect(line().textContent).toBe('“The scene is clear over the park.”');

    await advance(1000);
    view.rerender(<NarrationLine text="Dense canopy fills the park." />);
    await advance(1000);
    expect(line().textContent).toBe('“The scene is clear over the park.”');
    await advance(NARRATION_INTERVAL_MS - 2000);
    expect(line().textContent).toBe('“Dense canopy fills the park.”');
  });

  it('lands only the newest of several waiting sentences', async () => {
    const view = render(<NarrationLine text="First sentence of the turn." />);
    await advance(0);
    view.rerender(<NarrationLine text="Second sentence of the turn." />);
    await advance(500);
    view.rerender(<NarrationLine text="Third sentence of the turn." />);
    await advance(NARRATION_INTERVAL_MS);
    expect(line().textContent).toBe('“Third sentence of the turn.”');
  });

  it('never commits the same sentence again', async () => {
    const view = render(<NarrationLine text="The scene is clear over the park." />);
    await advance(0);
    const first = line().querySelector('span');
    view.rerender(<NarrationLine text="The scene is clear over the park." />);
    await advance(NARRATION_INTERVAL_MS * 2);
    expect(line().querySelector('span')).toBe(first);

    view.rerender(<NarrationLine text="Dense canopy fills the park." />);
    await advance(NARRATION_INTERVAL_MS);
    view.rerender(<NarrationLine text="The scene is clear over the park." />);
    await advance(NARRATION_INTERVAL_MS * 2);
    expect(line().textContent).toBe('“Dense canopy fills the park.”');
  });
});
