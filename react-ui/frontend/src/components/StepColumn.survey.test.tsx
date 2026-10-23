/**
 * The archaeologist's condition survey in the step column (decision 10): a row per accepted verdict,
 * read from the tool's file and worded by the stage, with the relief the agent looked at moved into
 * the row; a refused verdict (no file) and a file that is not the call's show nothing; the rows stay
 * in view when the earlier steps fold.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ToolCall } from '../types.ts';

vi.mock('../services/api.ts', () => ({
  getPresignedUrl: vi.fn().mockResolvedValue(null),
  loadGeometry: vi.fn(),
}));

import { StepColumn } from './StepColumn.tsx';
import { loadGeometry } from '../services/api.ts';
import { extractEvidence } from '../utils/evidence.ts';

const SID = 'a1b2c3d4-0000-4111-8222-333344445555-abcd1234';
const TERRAIN = `s3://geo-bucket/session_data/${SID}/terrain/`;
const DIR = `s3://geo-bucket/session_data/${SID}/archaeology/`;

let files: Record<string, unknown> = {};

const call = (id: string, name: string, params: Record<string, unknown> = {}): ToolCall => ({ id, name, params, status: 'completed' });
const verdict = (id: string, site: string, v: string, because: string, n: number, rank: number, km: number) => ({
  turn_id: '0123456789ab', tool_use_id: id, n, site_id: site, verdict: v, because, example_id: 'newark-octagon', rank, distance_km: km,
});

/** One site surveyed: its relief, the look, the verdict, the map. */
const site = (k: string, id: string) => [
  call(`show-${k}`, 'show_terrain', { site_id: id, product: 'lrm' }),
  call(`look-${k}`, 'inspect_image', { s3_url: `${TERRAIN}lrm03_${id}.tif`, title: `${id} model title`, question: 'walls?' }),
  call(`judge-${k}`, 'record_condition', { site_id: id, verdict: 'visible', because: 'ploughed_but_traced' }),
  call(`map-${k}`, 'display_visual', { s3_url: `${TERRAIN}lrm03_${id}.tif`, title: 'x' }),
];

const steps = [
  call('similar', 'find_similar_sites', { site_id: 'newark-octagon', top_k: 3 }),
  ...site('a', 'hopeton-earthworks'),
  ...site('b', 'high-bank-works'),
  ...site('c', 'seip-earthworks'),
];

beforeEach(() => {
  files = {
    [`${DIR}survey_judge-a.json`]: verdict('judge-a', 'hopeton-earthworks', 'visible', 'ploughed_but_traced', 1, 1, 87),
    [`${DIR}survey_judge-b.json`]: verdict('judge-b', 'high-bank-works', 'faint', 'ploughed_but_traced', 2, 2, 93),
    // judge-c was refused: the tool wrote nothing.
  };
  vi.mocked(loadGeometry).mockImplementation(async (url: string) => (files[url] as never) ?? null);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const mount = (tools: ToolCall[] = steps) => render(
  <StepColumn steps={tools} live={false} evidence={extractEvidence(tools, SID)} onOpenEvidence={() => {}} archaeologyDir={DIR} />,
);

describe('the survey rows', () => {
  it('shows a row per accepted verdict, in the stage\'s words, and none for a refused one', async () => {
    mount();
    await waitFor(() => expect(document.querySelectorAll('.survey-row')).toHaveLength(2));
    const rows = Array.from(document.querySelectorAll('.survey-row')).map((r) => r.textContent);
    expect(rows[0]).toBe('Hopeton Earthworks 87 kmStill shows: ploughed down, still traced');
    expect(rows[1]).toBe('High Bank Works 93 kmFaint: ploughed down, still traced');
    expect(document.body.textContent).not.toContain('Seip Earthworks');
  });

  it('moves the look\'s chip into its row, titled in the stage\'s words', async () => {
    mount();
    await waitFor(() => expect(document.querySelectorAll('.survey-row')).toHaveLength(2));
    const inRow = document.querySelectorAll('.survey-row .evidence-chip--compact');
    expect(inRow).toHaveLength(2);
    expect(inRow[0].getAttribute('aria-label')).toBe('Hopeton Earthworks, local relief: the agent is looking');
    // The surveyed sites' chips are no longer under their look steps; the refused one's still is.
    const loose = Array.from(document.querySelectorAll('.evidence-chip:not(.evidence-chip--compact)'));
    expect(loose.map((c) => c.getAttribute('aria-label'))).toEqual(['seip-earthworks model title: the agent is looking']);
    expect(document.body.textContent).not.toContain('hopeton-earthworks model title');
  });

  it('shows nothing from a file that is not the call\'s own', async () => {
    files[`${DIR}survey_judge-a.json`] = verdict('judge-a', 'seip-earthworks', 'visible', 'walls_in_relief', 1, 3, 112);
    files[`${DIR}survey_judge-b.json`] = { ...verdict('judge-b', 'high-bank-works', 'visible', 'no_form_seen', 2, 2, 93) };
    mount();
    // Both files read (a rejected file is retried, and still shows nothing).
    await waitFor(() => {
      const asked = new Set(vi.mocked(loadGeometry).mock.calls.map(([url]) => url));
      expect(asked).toEqual(new Set([`${DIR}survey_judge-a.json`, `${DIR}survey_judge-b.json`, `${DIR}survey_judge-c.json`]));
    });
    expect(document.querySelectorAll('.survey-row')).toHaveLength(0);
  });

  it('keeps the rows in view when the earlier steps fold', async () => {
    mount();
    await waitFor(() => expect(document.querySelectorAll('.survey-row')).toHaveLength(2));
    // 13 steps: the first four fold under the toggle, but the first verdict's step stays.
    expect(screen.getByRole('button', { name: /earlier step/ })).toBeTruthy();
    expect(document.body.textContent).toContain('Hopeton Earthworks');
  });

  it('names the steps and says where the matches come from', async () => {
    const batched = [
      steps[0],
      call('j1', 'record_condition', { site_id: 'hopeton-earthworks' }),
      call('j2', 'record_condition', { site_id: 'high-bank-works' }),
    ];
    mount(batched);
    expect(screen.getByText('Find sites of the same form')).toBeTruthy();
    expect(screen.getByText("Matched on the public record's descriptions")).toBeTruthy();
    expect(screen.getByText('Judge 2 sites')).toBeTruthy();
  });

  it('counts the sites judged, so a refused verdict and its retry are one', () => {
    const retried = [
      steps[0],
      call('j1', 'record_condition', { site_id: 'high-bank-works', verdict: 'visible', because: 'walls_in_relief' }),
      call('j1b', 'record_condition', { site_id: 'high-bank-works', verdict: 'visible', because: 'ploughed_but_traced' }),
    ];
    mount(retried);
    expect(screen.getByText('Judge what still shows')).toBeTruthy();
    cleanup();
    mount([...retried, call('j2', 'record_condition', { site_id: 'seip-earthworks' })]);
    expect(screen.getByText('Judge 2 sites')).toBeTruthy();
  });

  it('puts the look before the verdict in its row, never a look after it', async () => {
    const later = call('look-a2', 'inspect_image', {
      s3_url: `${TERRAIN}lrm03_hopeton-earthworks_site.tif`, title: 'a look after the verdict', question: 'walls?',
    });
    // One site, so no step folds: the find, the relief, the look, the verdict, then a second look.
    const [similar, showA, lookA, judgeA] = steps;
    mount([similar, showA, lookA, judgeA, later]);
    await waitFor(() => expect(document.querySelectorAll('.survey-row')).toHaveLength(1));
    const loose = Array.from(document.querySelectorAll('.evidence-chip:not(.evidence-chip--compact)'))
      .map((c) => c.getAttribute('aria-label'));
    // The row holds the look made before judge-a, so the later look keeps its own chip under its step.
    expect(loose).toContain('a look after the verdict: the agent is looking');
    expect(document.body.textContent).not.toContain('hopeton-earthworks model title');
  });

  it('reads no files without a folder (an earlier record with none, another act)', () => {
    render(<StepColumn steps={steps} live={false} />);
    expect(vi.mocked(loadGeometry)).not.toHaveBeenCalled();
    expect(document.querySelectorAll('.survey-row')).toHaveLength(0);
  });
});
