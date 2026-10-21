/**
 * The step column's way back to its earlier steps: "Show N earlier steps" is a real button (it was
 * an inert "+N earlier" line), finished or still working, and the end frame's "Show all N steps"
 * is unchanged.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ToolCall } from '../types.ts';

vi.mock('../services/api.ts', () => ({
  getPresignedUrl: vi.fn().mockResolvedValue(null),
  loadGeometry: vi.fn().mockResolvedValue(null),
}));

import { StepColumn } from './StepColumn.tsx';

afterEach(cleanup);

const NAMES = [
  'find_location_boundary',
  'get_best_geometry',
  'create_bbox_from_coordinates',
  'get_rasters',
  'inspect_image',
  'run_bandmath',
  'display_visual',
  'calculator',
  'calculate_environmental_impact',
  'protected_area_context',
  'reverse_geocode',
];

const tools = (names: string[]): ToolCall[] =>
  names.map((name, i) => ({ name, id: `t${i + 1}`, params: {}, status: 'completed' as const }));

const numbers = () =>
  Array.from(document.querySelectorAll('.stage-step-column > li[style]')).map((li) => li.textContent?.match(/^\d{2}/)?.[0]);

describe('earlier steps', () => {
  it('opens and folds the steps above the last nine with a button', async () => {
    render(<StepColumn steps={tools(NAMES)} live={false} />);
    const toggle = screen.getByRole('button', { name: 'Show 2 earlier steps' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(numbers()).not.toContain('01');
    expect(screen.queryByText(/\+2 earlier/)).toBeNull();

    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(numbers()[0]).toBe('01');
    expect(numbers()).toHaveLength(11);
    const hide = screen.getByRole('button', { name: 'Hide the earlier steps' });
    expect(hide.getAttribute('aria-expanded')).toBe('true');

    await act(async () => {
      fireEvent.click(hide);
    });
    expect(numbers()).toHaveLength(9);
    expect(numbers()[0]).toBe('03');
  });

  it('says "1 earlier step" for one', () => {
    render(<StepColumn steps={tools(NAMES.slice(0, 10))} live={false} />);
    expect(screen.getByRole('button', { name: 'Show 1 earlier step' })).toBeTruthy();
  });

  it('shows no toggle when every step fits', () => {
    render(<StepColumn steps={tools(NAMES.slice(0, 9))} live={false} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('works while the agent is working, and the lit step stays last', async () => {
    render(<StepColumn steps={tools(NAMES)} live />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Show 2 earlier steps' }));
    });
    const rows = Array.from(document.querySelectorAll('.stage-step-column > li[style]'));
    expect(rows).toHaveLength(11);
    expect(rows[0].textContent).toMatch(/^01/);
    const lit = rows.filter((li) => li.getAttribute('aria-current') === 'step');
    expect(lit).toHaveLength(1);
    expect(lit[0]).toBe(rows[rows.length - 1]);
    expect(lit[0].textContent).toMatch(/^11/);
  });
});

describe('the end frame (compact)', () => {
  it('keeps "Show all N steps"', async () => {
    render(<StepColumn steps={tools(NAMES)} live={false} compact />);
    expect(numbers()).toHaveLength(0);
    const all = screen.getByRole('button', { name: 'Show all 11 steps' });
    await act(async () => {
      fireEvent.click(all);
    });
    expect(numbers()).toHaveLength(11);
    expect(screen.getByRole('button', { name: 'Show the summary' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /earlier/ })).toBeNull();
  });
});
