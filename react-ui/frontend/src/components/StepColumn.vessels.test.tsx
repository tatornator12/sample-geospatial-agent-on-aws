/**
 * Dark Vessels' column as the stage mounts it (redesign §3.8.1, §3.14, review L3, M2, M3): the board
 * and the lines load from the tools' files, a refused decision shows nothing, a count waits for the
 * map's reveal, the column kept mounted across two turns shows the second question's board and
 * lines (not the first's), the board loads before the radar from the rest file's bucket, and the
 * lit row is scrolled into view while the agent works.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import type { ToolCall } from '../types.ts';
vi.mock('../services/api.ts', () => ({
  getPresignedUrl: vi.fn().mockResolvedValue(null),
  loadGeometry: vi.fn(),
}));
import { StepColumn } from './StepColumn.tsx';
import type { VesselStage } from './VesselStepExtras.tsx';
import { loadGeometry } from '../services/api.ts';

const SID = '0b6c9a0e-1111-4222-8333-444455556666';
const DIR = `s3://geo-bucket/session_data/${SID}/vessels/`;
const OCT12 = 's1d-20261012t0018';
const SEP18 = 's1d-20260918t0018';
const Q1 = 'a1b2c3d4e5f6';
const Q2 = 'b2c3d4e5f6a7';

/** The files on "S3", by URL; a URL that is not here is not written (yet). */
let files: Record<string, unknown> = {};
let scrolled: Array<{ el: Element; arg: unknown }> = [];

const call = (id: string, name: string, params: Record<string, unknown> = {}): ToolCall => ({ id, name, params, status: 'completed' });
const show = (id: string, file: string) => call(id, 'display_visual', { s3_url: `${DIR}${file}` });

const row = (pass_id: string, sensed: string, imaged_share: number) =>
  ({ pass_id, sensed, satellite: 'Sentinel-1D', orbit_state: 'ASCENDING', imaged_share });
const board = (questionId: string) => ({
  question_id: questionId, turn_id: 'f00dfeed0001', started_at: '2026-10-21T14:00:00Z', standard: 0.15,
  budget: { passes: 2 }, decision_keys: 'call',
  passes: [row(OCT12, '2026-10-12T00:18:02Z', 0.53), row(SEP18, '2026-09-18T00:18:02Z', 0.53)],
});
const decision = (questionId: string, callId: string, step: string, because: string, subject: unknown, facts: Record<string, unknown>, n = 1) =>
  ({ question_id: questionId, step, because, subject, facts, n, at: '2026-10-21T14:00:01.000000+00:00', tool_use_id: callId });
const heard = (checkable: number) => ({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: { kind: 'heard', share: 0.3, imaged: 0.53, checkable, standard: 0.15 }, geometry: null }],
});

/** One question on a pass, as the agent streams it, up to the map showing the matched targets. */
function question(p: string, ids: { list: string; read: string }, because: 'newest_wide' | 'asked') {
  return [
    call(ids.list, 'list_passes'),
    call(ids.read, 'decide', { step: 'read_pass', because, pass_id: p }),
    call(`${ids.list}-find`, 'find_pass', { when: p }),
    show(`${ids.list}-radar`, `radar_${p}.tif`),
    call(`${ids.list}-look`, 'inspect_image', { s3_url: `${DIR}radar_${p}.tif` }),
    call(`${ids.list}-detect`, 'detect_vessels', { pass_id: p }),
    show(`${ids.list}-targets1`, `targets_${p}.geojson`),
    call(`${ids.list}-coverage`, 'check_ais_coverage', { pass_id: p }),
    show(`${ids.list}-heard`, `heard_${p}.geojson`),
    show(`${ids.list}-unproven`, `unproven_${p}.geojson`),
    call(`${ids.list}-match`, 'match_ais', { pass_id: p }),
    show(`${ids.list}-targets2`, `targets_${p}.geojson`),
  ];
}

const stage = (over: Partial<VesselStage> = {}): VesselStage => ({ sessionId: SID, bucket: 'geo-bucket', caseId: null, turnSentAt: 1000, revealed: {}, ...over });
const text = () => document.querySelector('.stage-step-column')?.textContent ?? '';
const lines = () => Array.from(document.querySelectorAll('.step-line')).map((el) => el.textContent);
const boardStateOf = (day: string) =>
  Array.from(document.querySelectorAll('.pass-row')).find((r) => r.textContent?.startsWith(day))?.textContent ?? '';

beforeEach(() => {
  files = {};
  scrolled = [];
  Element.prototype.scrollIntoView = function (this: Element, arg?: unknown) {
    scrolled.push({ el: this, arg });
  } as typeof Element.prototype.scrollIntoView;
  vi.mocked(loadGeometry).mockReset().mockImplementation(async (url: string) =>
    (Object.prototype.hasOwnProperty.call(files, url) ? structuredClone(files[url]) : null) as never);
});
afterEach(cleanup);

describe('the board and the lines, from the files', () => {
  it('shows the board, one line per accepted decision and check, and nothing for a refused one', async () => {
    files[`${DIR}passes_list1.json`] = board(Q1);
    files[`${DIR}decision_${Q1}_read1.json`] = decision(Q1, 'read1', 'read_pass', 'newest_wide', OCT12, { imaged_pct: 53 });
    files[`${DIR}heard_${OCT12}.geojson`] = heard(0.19);
    // A second read, refused by decide: no file is ever written for it.
    const tools = [...question(OCT12, { list: 'list1', read: 'read1' }, 'newest_wide'), call('refused1', 'decide', { step: 'read_pass', because: 'widest', pass_id: SEP18 })];
    render(<StepColumn steps={tools} live={false} vessel={stage()} />);

    await waitFor(() => expect(lines()).toContain('Checked: This pass can check 19% of the reserve, over the 15% standard.'));
    expect(text()).toContain('Weigh the passes on file');
    expect(text()).toContain('Look at the radar');
    expect(text()).not.toMatch(/Put it on the map|could be heard/);
    // The board, newest first, the pass read marked from its decision file.
    expect(boardStateOf('Oct 12')).toMatch(/S1D\s*53%\s*reading/);
    expect(boardStateOf('Sep 18')).not.toMatch(/reading|read|set aside/);
    expect(lines()).toEqual([
      'Decided: Reading Oct 12: the newest pass that saw over half the reserve (53%).',
      'Checked: This pass can check 19% of the reserve, over the 15% standard.',
    ]);
    // The refused decide's file was asked for and never came: it shows no line.
    expect(vi.mocked(loadGeometry).mock.calls.map(([u]) => u)).toContain(`${DIR}decision_${Q1}_refused1.json`);
  });

  it('holds the candidates count, the no-candidates line and the board state until the map has revealed the pass (R4.2, review M2)', async () => {
    files[`${DIR}passes_list1.json`] = board(Q1);
    files[`${DIR}decision_${Q1}_read1.json`] = decision(Q1, 'read1', 'read_pass', 'newest_wide', OCT12, { imaged_pct: 53 });
    files[`${DIR}decision_${Q1}_fc1.json`] = decision(Q1, 'fc1', 'forecast', 'no_candidates', 'none', { from: OCT12, checkable_pct: 19 }, 2);
    files[`${DIR}heard_${OCT12}.geojson`] = heard(0.19);
    const tools = [
      ...question(OCT12, { list: 'list1', read: 'read1' }, 'newest_wide'),
      call('fc1', 'decide', { step: 'forecast', because: 'no_candidates' }),
      call('hot1', 'predict_hotspots', { pass_id: OCT12 }),
    ];
    const view = render(<StepColumn steps={tools} live={false} vessel={stage()} />);
    // Every file is loaded (the decision file was asked for), yet the map has not revealed the pass.
    await waitFor(() => expect(lines()).toContain('Checked: This pass can check 19% of the reserve, over the 15% standard.'));
    await waitFor(() => expect(vi.mocked(loadGeometry).mock.calls.map(([u]) => u)).toContain(`${DIR}decision_${Q1}_fc1.json`));
    await new Promise((r) => setTimeout(r, 30));
    expect(text()).not.toMatch(/No candidates|candidates where/);
    expect(boardStateOf('Oct 12')).toMatch(/reading/);

    // The map reveals the pass, with none: now the column says so, in one rule with the map.
    view.rerender(<StepColumn steps={tools} live={false} vessel={stage({ revealed: { [OCT12]: 0 } })} />);
    await waitFor(() => expect(lines()).toContain('Decided: No candidates on Oct 12 in the 19% it could check. Going to where to look next.'));
    expect(lines()).toContain('Checked: No candidates where AIS was received.');
    expect(boardStateOf('Oct 12')).toMatch(/no candidates/);
  });

  it('says the revealed count under the match', async () => {
    files[`${DIR}passes_list1.json`] = board(Q1);
    files[`${DIR}decision_${Q1}_read1.json`] = decision(Q1, 'read1', 'read_pass', 'newest_wide', OCT12, { imaged_pct: 53 });
    render(<StepColumn steps={question(OCT12, { list: 'list1', read: 'read1' }, 'newest_wide')} live={false} vessel={stage({ revealed: { [OCT12]: 4 } })} />);
    await waitFor(() => expect(lines()).toContain('Checked: 4 candidates where AIS was received, seen by both detectors.'));
  });
});

describe('two questions in one session (review L3)', () => {
  it('shows the second board and its lines, none of the first, with the column kept mounted', async () => {
    files[`${DIR}passes_list1.json`] = board(Q1);
    files[`${DIR}decision_${Q1}_read1.json`] = decision(Q1, 'read1', 'read_pass', 'newest_wide', OCT12, { imaged_pct: 53 });
    files[`${DIR}heard_${OCT12}.geojson`] = heard(0.19);
    const first = question(OCT12, { list: 'list1', read: 'read1' }, 'newest_wide');
    const view = render(<StepColumn steps={first} live={false} vessel={stage({ turnSentAt: 1000 })} />);
    await waitFor(() => expect(lines()).toContain('Checked: This pass can check 19% of the reserve, over the 15% standard.'));
    const column = document.querySelector('.stage-step-column');

    // The second question reads the same pass, so check_ais_coverage rewrites its heard file in place.
    files[`${DIR}passes_list2.json`] = board(Q2);
    files[`${DIR}decision_${Q2}_read2.json`] = decision(Q2, 'read2', 'read_pass', 'asked', OCT12, { imaged_pct: 53 });
    files[`${DIR}heard_${OCT12}.geojson`] = heard(0.22);
    const second = question(OCT12, { list: 'list2', read: 'read2' }, 'asked');
    // The same StepColumn instance (rerender, not a new mount), as when Bug 6's fix keeps it mounted.
    view.rerender(<StepColumn steps={second} live={false} vessel={stage({ turnSentAt: 2000 })} />);

    await waitFor(() => expect(lines()).toContain('Checked: This pass can check 22% of the reserve, over the 15% standard.'));
    expect(lines()).toEqual([
      'Decided: Reading Oct 12, as asked. It saw 53% of the reserve.',
      'Checked: This pass can check 22% of the reserve, over the 15% standard.',
    ]);
    expect(text()).not.toMatch(/newest pass that saw over half|19%/);
    // The list is the act's own, remounted by its key (the StepColumn around it stayed).
    expect(document.querySelector('.stage-step-column')).not.toBe(column);
    expect(vi.mocked(loadGeometry).mock.calls.map(([u]) => u)).toContain(`${DIR}passes_list2.json`);
  });
});

describe('where the files are', () => {
  it('reads the board from the bucket before any URL has streamed (N2), and waits without one (review M3)', async () => {
    files[`${DIR}passes_list1.json`] = board(Q1);
    const early = [call('list1', 'list_passes'), call('read1', 'decide', { step: 'read_pass', because: 'newest_wide', pass_id: OCT12 })];
    render(<StepColumn steps={early} live vessel={stage()} />);
    await waitFor(() => expect(boardStateOf('Oct 12')).toMatch(/S1D\s*53%/));
    expect(vi.mocked(loadGeometry).mock.calls.map(([u]) => u)).toContain(`${DIR}passes_list1.json`);

    // No bucket in the rest file (or one that failed the rule): nothing is read until a URL streams.
    cleanup();
    vi.mocked(loadGeometry).mockClear();
    render(<StepColumn steps={early} live vessel={stage({ bucket: null })} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(loadGeometry).not.toHaveBeenCalled();
    expect(document.querySelector('.pass-board')).toBeNull();
    expect(text()).toContain('Weigh the passes on file');
  });
});

describe('the lit row in view (R6.5)', () => {
  it('scrolls the lit row into view when the lit step changes or a line lands under it', async () => {
    files[`${DIR}passes_list1.json`] = board(Q1);
    files[`${DIR}decision_${Q1}_read1.json`] = decision(Q1, 'read1', 'read_pass', 'newest_wide', OCT12, { imaged_pct: 53 });
    const tools = question(OCT12, { list: 'list1', read: 'read1' }, 'newest_wide').slice(0, 3);
    const view = render(<StepColumn steps={tools} live vessel={stage()} />);
    // The find's line lands while it is lit: the lit row (with its line) is brought into view.
    await waitFor(() => expect(lines()).toContain('Decided: Reading Oct 12: the newest pass that saw over half the reserve (53%).'));
    await waitFor(() => expect(scrolled.some(({ el }) => el.getAttribute('aria-current') === 'step' && el.textContent?.includes('Decided: Reading Oct 12'))).toBe(true));
    const lit = scrolled.filter(({ el }) => el.getAttribute('aria-current') === 'step');
    expect(lit[lit.length - 1].arg).toEqual({ block: 'nearest', behavior: 'smooth' });

    scrolled = [];
    const next = question(OCT12, { list: 'list1', read: 'read1' }, 'newest_wide').slice(0, 6);
    view.rerender(<StepColumn steps={next} live vessel={stage()} />);
    await waitFor(() => expect(scrolled.some(({ el }) => el.getAttribute('aria-current') === 'step' && el.textContent?.startsWith('04Find targets on the water'))).toBe(true));
  });
});
