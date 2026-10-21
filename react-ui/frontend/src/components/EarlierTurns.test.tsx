/**
 * "Earlier in this session": a row per earlier turn (its question and "· N steps"), each a
 * disclosure that reopens the turn's steps and answer in the column; one open at a time.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ToolCall } from '../types.ts';
import type { PastTurn } from '../utils/turns.ts';

vi.mock('../services/api.ts', () => ({
  getPresignedUrl: vi.fn().mockResolvedValue(null),
  loadGeometry: vi.fn().mockResolvedValue(null),
}));

import { EarlierTurns } from './EarlierTurns.tsx';

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});
afterEach(cleanup);

const tool = (name: string, id: string, params: Record<string, unknown> = {}): ToolCall => ({ name, id, params, status: 'completed' });
const RASTER = 's3://bucket/use-cases/archaeologist-newark/tci_clipped_newark_octagon_2026-10-05.tif';

const turn = (i: number, over: Partial<PastTurn> = {}): PastTurn => ({
  key: `turn-${i * 2}`,
  question: `Question ${i}`,
  tools: [tool('find_location_boundary', `a${i}`), tool('get_rasters', `b${i}`)],
  answer: `Answer ${i}.`,
  failed: false,
  ...over,
});

const row = (name: RegExp) => screen.getByRole('button', { name });

describe('EarlierTurns', () => {
  it('lists each turn with its question and step count, closed', () => {
    render(<EarlierTurns turns={[turn(1), turn(2, { tools: [] })]} sessionId="s" speaker="Earth Analyst" />);
    expect(screen.getByRole('region', { name: 'Earlier in this session' })).toBeTruthy();
    expect(row(/Question 1/).textContent).toContain('· 2 steps');
    expect(row(/Question 2/).textContent).toContain('· no steps');
    expect(row(/Question 1/).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Answer 1.')).toBeNull();
  });

  it("opens a turn's record with its steps, chip and answer, one at a time", async () => {
    const first = turn(1, {
      tools: [tool('get_rasters', 'r1'), tool('inspect_image', 'i1', { s3_url: RASTER, title: 'Newark Octagon, true colour' })],
      saw: { i1: 'The walls show as a ring of trees.' },
    });
    render(<EarlierTurns turns={[first, turn(2)]} sessionId="s" speaker="Earth Analyst" onOpenEvidence={() => {}} />);

    await act(async () => {
      fireEvent.click(row(/Question 1/));
    });
    const opened = row(/Question 1/);
    expect(opened.getAttribute('aria-expanded')).toBe('true');
    const record = document.getElementById(opened.getAttribute('aria-controls')!);
    expect(record).toBeTruthy();
    expect(record!.textContent).toContain('A record of this turn. The map shows the latest.');
    expect(record!.textContent).toContain('Fetch Sentinel-2');
    expect(record!.textContent).toContain('Look at the image');
    expect(record!.textContent).toContain('Newark Octagon, true colour');
    expect(record!.textContent).toContain('Saw: The walls show as a ring of trees.');
    expect(record!.textContent).toContain('Answer 1.');
    expect(record!.textContent).toContain('Earth Analyst');

    await act(async () => {
      fireEvent.click(row(/Question 2/));
    });
    expect(row(/Question 1/).getAttribute('aria-expanded')).toBe('false');
    expect(row(/Question 2/).getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByText('Answer 1.')).toBeNull();
    expect(screen.getByText('Answer 2.')).toBeTruthy();

    await act(async () => {
      fireEvent.click(row(/Question 2/));
    });
    expect(screen.queryByText('Answer 2.')).toBeNull();
  });

  it('leaves the Saw line out where the act does not show it', async () => {
    const first = turn(1, {
      tools: [tool('inspect_image', 'i1', { s3_url: RASTER, title: 'Chip' })],
      saw: { i1: 'A bright target with a wake.' },
    });
    render(<EarlierTurns turns={[first]} sessionId="s" speaker="Dark Vessels" showSaw={false} onOpenEvidence={() => {}} />);
    await act(async () => {
      fireEvent.click(row(/Question 1/));
    });
    expect(screen.queryByText(/A bright target/)).toBeNull();
  });

  it('says a failed turn stopped before it answered', async () => {
    render(<EarlierTurns turns={[turn(1, { answer: 'Error: boom', failed: true })]} sessionId="s" speaker="Earth Analyst" />);
    await act(async () => {
      fireEvent.click(row(/Question 1/));
    });
    expect(screen.getByText('The agent stopped before it answered.')).toBeTruthy();
    expect(screen.queryByText(/boom/)).toBeNull();
  });

  it('shows the latest four rows, the older ones behind "Show N more"', async () => {
    const turns = [1, 2, 3, 4, 5, 6].map((i) => turn(i));
    render(<EarlierTurns turns={turns} sessionId="s" speaker="Earth Analyst" />);
    expect(screen.queryByRole('button', { name: /Question 1/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Question 2/ })).toBeNull();
    expect(row(/Question 3/)).toBeTruthy();
    expect(row(/Question 6/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Show 2 more' }));
    });
    expect(row(/Question 1/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /more$/ })).toBeNull();
  });

  it('renders nothing with no earlier turns', () => {
    const { container } = render(<EarlierTurns turns={[]} sessionId="s" speaker="Earth Analyst" />);
    expect(container.innerHTML).toBe('');
  });
});
