/**
 * Act 3's step column on synthetic streams (redesign §3.8.1, §3.14): the grammar, the board, the
 * line templates and where each line goes, and when a line may show (its file, its question, the
 * map's reveal).
 */
import { describe, expect, it } from 'vitest';
import type { ToolCall } from '../types.ts';
import {
  BOARD_CLOCK_SKEW_MS,
  DECIDE_PAIRS,
  MAX_LINE_CHARS,
  answerScrollBlock,
  boardAccepted,
  boardLimit,
  boardStates,
  boardUrl,
  candidatesLine,
  coverageLine,
  decisionLine,
  decisionUrl,
  decisionWaits,
  isVesselTurn,
  litKey,
  litScrollOptions,
  parseBoard,
  parseDecision,
  parseHeard,
  validBucket,
  vesselColumn,
  vesselGroupName,
  vesselGroups,
  vesselsDirFrom,
  visibleBoardRows,
  type Decision,
  type DecideStep,
  type VesselColumnFiles,
} from './vesselSteps.ts';

const SID = '0b6c9a0e-1111-4222-8333-444455556666';
const S = `s3://bucket/session_data/${SID}/vessels/`;
const QID = 'a1b2c3d4e5f6';
const OCT12 = 's1d-20261012t0018';
const SEP30 = 's1d-20260930t0018';
const SEP18 = 's1d-20260918t0018';
const SEP7 = 's1d-20260907t1141';
const AUG30 = 's1d-20260830t0026';

let n = 0;
function call(name: string, params: Record<string, unknown> = {}, id?: string): ToolCall {
  n += 1;
  return { id: id ?? `tooluse_${n}`, name, params, status: 'completed' };
}
const show = (file: string) => call('display_visual', { s3_url: `${S}${file}` });

/** The clean path, as the agent streams it: one pass with candidates, a box, the draft. */
function cleanPath(pass = OCT12) {
  const listing = call('list_passes', {}, 'tooluse_list1');
  const read = call('decide', { step: 'read_pass', because: 'newest_wide', pass_id: pass }, 'tooluse_dec1');
  const draft = call('decide', { step: 'draft', because: 'near_candidates', box: 3 }, 'tooluse_dec2');
  const tools = [
    listing, read,
    call('find_pass', { when: pass }), show(`radar_${pass}.tif`), call('inspect_image', { s3_url: `${S}radar_${pass}.tif` }),
    call('detect_vessels', { pass_id: pass }), show(`targets_${pass}.geojson`),
    call('check_ais_coverage', { pass_id: pass }), show(`heard_${pass}.geojson`), show(`unproven_${pass}.geojson`),
    call('match_ais', { pass_id: pass }), show(`targets_${pass}.geojson`),
    call('gather_evidence', { pass_id: pass }), call('inspect_image', { s3_url: `${S}chips/${pass}_T01.tif` }),
    call('predict_hotspots', { pass_id: pass }), show('hotspots.geojson'), show('boxes.geojson'),
    draft, call('next_look', { box: 3 }), show('look_3_2026-10-24t00.geojson'),
    call('draft_tasking', { box: 3 }),
  ];
  return { tools, listing, read, draft };
}

const row = (pass_id: string, sensed: string, imaged_share: number, satellite = 'Sentinel-1D') =>
  ({ pass_id, sensed, sensed_text: 'x', days_old: 9, satellite, orbit_state: 'ASCENDING', imaged_share, imaged_pct: Math.round(imaged_share * 100) });
const ROWS = [
  row(OCT12, '2026-10-12T00:18:02Z', 0.53), row(SEP30, '2026-09-30T00:18:02Z', 0.53), row(SEP18, '2026-09-18T00:18:02Z', 0.53),
  row(SEP7, '2026-09-07T11:41:47Z', 0.48), row(AUG30, '2026-08-30T00:26:09Z', 0.31),
];
const boardRaw = (extra: Record<string, unknown> = {}) => ({
  question_id: QID, turn_id: 'f00dfeed0001', started_at: '2026-10-21T14:00:00Z', standard: 0.15,
  budget: { passes: 2 }, decision_keys: 'call', passes: ROWS, ...extra,
});
const BOARD = parseBoard(boardRaw())!;

let seq = 0;
/** A decision file as decide writes it (decide_tools.py _decide), parsed. */
function file(callId: string, step: DecideStep, because: string, subject: string | number, facts: Record<string, unknown>, extra: Record<string, unknown> = {}): Decision {
  seq += 1;
  const d = parseDecision({ question_id: QID, step, because, subject, facts, n: seq, at: '2026-10-21T14:00:01.000000+00:00', tool_use_id: callId, ...extra });
  if (!d) throw new Error(`not a decision: ${step}/${because}`);
  return d;
}
const files = (over: Partial<VesselColumnFiles> = {}): VesselColumnFiles => ({ board: BOARD, decisions: {}, heard: {}, revealed: {}, ...over });

describe('the grammar', () => {
  it('folds the map calls and the chip into their steps: the clean path is 10 steps', () => {
    const { tools } = cleanPath();
    const groups = vesselGroups(tools);
    expect(groups.map((g) => g.name)).toEqual([
      'list_passes', 'find_pass', 'inspect_image', 'detect_vessels', 'check_ais_coverage', 'match_ais',
      'gather_evidence', 'predict_hotspots', 'next_look', 'draft_tasking',
    ]);
    expect(groups).toHaveLength(10);
    const folded = (name: string) => groups.find((g) => g.name === name)!.folded.map((c) => c.params.s3_url.split('/').pop());
    expect(folded('find_pass')).toEqual([`radar_${OCT12}.tif`]);
    // The targets fold into the detection, then (statuses changed in place) into the match.
    expect(folded('detect_vessels')).toEqual([`targets_${OCT12}.geojson`]);
    expect(folded('match_ais')).toEqual([`targets_${OCT12}.geojson`]);
    expect(folded('check_ais_coverage')).toEqual([`heard_${OCT12}.geojson`, `unproven_${OCT12}.geojson`]);
    expect(folded('gather_evidence')).toEqual([`${OCT12}_T01.tif`]);
    expect(folded('predict_hotspots')).toEqual(['hotspots.geojson', 'boxes.geojson']);
    expect(folded('next_look')).toEqual(['look_3_2026-10-24t00.geojson']);
    // The radar's own look is a step, in the act's words.
    expect(vesselGroupName(groups[2])).toBe('Look at the radar');
    expect(isVesselTurn(tools)).toBe(true);
    expect(isVesselTurn([call('get_rasters'), call('inspect_image')])).toBe(false);
  });

  it('reads the set-aside path as 14 steps, each pass with its own steps', () => {
    const tools = [
      call('list_passes'), call('decide', { step: 'read_pass', because: 'asked', pass_id: AUG30 }), call('find_pass', { when: AUG30 }),
      show(`radar_${AUG30}.tif`), call('inspect_image', { s3_url: `${S}radar_${AUG30}.tif` }), call('detect_vessels', { pass_id: AUG30 }),
      show(`targets_${AUG30}.geojson`), call('check_ais_coverage', { pass_id: AUG30 }), show(`heard_${AUG30}.geojson`), show(`unproven_${AUG30}.geojson`),
      call('decide', { step: 'read_pass', because: 'coverage_thin', pass_id: SEP30 }), call('find_pass', { when: SEP30 }),
      show(`radar_${SEP30}.tif`), call('inspect_image', { s3_url: `${S}radar_${SEP30}.tif` }), call('detect_vessels', { pass_id: SEP30 }),
      show(`targets_${SEP30}.geojson`), call('check_ais_coverage', { pass_id: SEP30 }), show(`heard_${SEP30}.geojson`), show(`unproven_${SEP30}.geojson`),
      call('match_ais', { pass_id: SEP30 }), show(`targets_${SEP30}.geojson`), call('gather_evidence', { pass_id: SEP30 }),
      call('predict_hotspots', { pass_id: SEP30 }), show('hotspots.geojson'), call('next_look', { box: 1 }), call('draft_tasking', { box: 1 }),
    ];
    const groups = vesselGroups(tools);
    expect(groups).toHaveLength(14);
    // Each pass's map files fold into that pass's own steps.
    const [, findA, , detectA, , findB, , detectB] = groups;
    expect(findA.folded[0].params.s3_url).toContain(AUG30);
    expect(findB.folded[0].params.s3_url).toContain(SEP30);
    expect(detectA.folded.map((c) => c.params.s3_url)).toEqual([`${S}targets_${AUG30}.geojson`]);
    expect(detectB.folded.map((c) => c.params.s3_url)).toEqual([`${S}targets_${SEP30}.geojson`]);
  });

  it('keeps a map call with nothing to fold into as a step, and folds nothing it does not know', () => {
    const groups = vesselGroups([call('display_visual', { s3_url: `${S}hotspots.geojson` }), call('display_visual', { s3_url: 's3://bucket/elsewhere/x.geojson' })]);
    expect(groups.map((g) => [g.name, g.calls.length])).toEqual([['display_visual', 2]]);
    expect(vesselGroupName(groups[0])).toBe('Put 2 layers on the map');
    // A chip with no evidence step yet stays a look of its own.
    expect(vesselGroups([call('inspect_image', { s3_url: `${S}chips/${OCT12}_T01.tif` })]).map((g) => g.name)).toEqual(['inspect_image']);
  });
});

describe('the lines: every template, from the files only', () => {
  // The longest values: three-digit shares, the longest dates, the longest look text.
  const longest: Array<[DecideStep, string, string | number, Record<string, unknown>]> = [
    ['read_pass', 'newest', SEP30, { pass_id: SEP30, satellite: 'Sentinel-1D', imaged_pct: 100 }],
    ['read_pass', 'widest', SEP30, { pass_id: SEP30, satellite: 'Sentinel-1D', imaged_pct: 100 }],
    ['read_pass', 'newest_wide', SEP30, { pass_id: SEP30, satellite: 'Sentinel-1D', imaged_pct: 100 }],
    ['read_pass', 'coverage_thin', SEP30, { pass_id: SEP30, satellite: 'Sentinel-1D', imaged_pct: 100, from: AUG30, checkable_pct: 100 }],
    ['read_pass', 'no_candidates', SEP30, { pass_id: SEP30, satellite: 'Sentinel-1D', imaged_pct: 100, from: AUG30, checkable_pct: 100 }],
    ['read_pass', 'asked', SEP30, { pass_id: SEP30, satellite: 'Sentinel-1D', imaged_pct: 100, asked_words: 'end of August' }],
    ['forecast', 'coverage_thin', 'none', { from: SEP30, checkable_pct: 100 }],
    ['forecast', 'no_candidates', 'none', { from: SEP30, checkable_pct: 100 }],
    ['draft', 'most_past_targets', 3, { box: 3, share_pct: 100 }],
    ['draft', 'soonest_look', 3, { box: 3, look: 'S1-D Sep 30 23:59 UTC' }],
    ['draft', 'near_candidates', 3, { box: 3, candidates_near: 12 }],
    ['draft', 'only_planned_look', 3, { box: 3 }],
    ['stop', 'no_checked_pass', 'none', { passes: [{ pass_id: SEP30, checkable_pct: 100 }], standard_pct: 100 }],
    ['stop', 'no_checked_pass', 'none', { passes: [{ pass_id: AUG30, checkable_pct: 100 }, { pass_id: SEP30, checkable_pct: 100 }], standard_pct: 15 }],
  ];

  it('words every pair, each line at most 100 characters with passDay dates; both stop lines read "Checked:"', () => {
    const pairs = new Set<string>();
    for (const [step, because, subject, facts] of longest) {
      const line = decisionLine(file('tooluse_x', step, because, subject, facts))!;
      pairs.add(`${step}/${because}`);
      const full = `${line.label} ${line.text}`;
      expect(full.length, full).toBeLessThanOrEqual(MAX_LINE_CHARS);
      // No ISO day, no pass id, no em dash (U+2014).
      expect(full).not.toMatch(/\d{4}-\d{2}-\d{2}|s1[a-d]-|\u2014/);
      expect(line.label).toBe(step === 'stop' ? 'Checked:' : 'Decided:');
    }
    // Every pair decide accepts has a template.
    expect(pairs).toEqual(new Set(Object.entries(DECIDE_PAIRS).flatMap(([s, bs]) => bs.map((b) => `${s}/${b}`))));
    // The longest, forecast/no_candidates with a three-digit share, measures 89.
    const longestLine = decisionLine(file('tooluse_x', 'forecast', 'no_candidates', 'none', { from: SEP30, checkable_pct: 100 }))!;
    expect(`${longestLine.label} ${longestLine.text}`).toHaveLength(89);
    // The checks too, with three-digit shares and counts.
    for (const line of [coverageLine({ checkable: 1, standard: 1 }), coverageLine({ checkable: 0.099, standard: 0.15 }), candidatesLine(120)]) {
      expect(`${line.label} ${line.text}`.length).toBeLessThanOrEqual(MAX_LINE_CHARS);
    }
  });

  it('says each line in the design\'s words, two-digit shares as the passes on file give them', () => {
    const say = (step: DecideStep, because: string, subject: string | number, facts: Record<string, unknown>) => {
      const l = decisionLine(file('tooluse_x', step, because, subject, facts))!;
      return `${l.label} ${l.text}`;
    };
    expect(say('read_pass', 'newest', OCT12, { pass_id: OCT12, imaged_pct: 53 })).toBe('Decided: Reading Oct 12: the newest pass on file. It saw 53% of the reserve.');
    expect(say('read_pass', 'widest', OCT12, { imaged_pct: 53 })).toBe('Decided: Reading Oct 12: of the passes on file, it saw the most of the reserve, 53%.');
    expect(say('read_pass', 'newest_wide', OCT12, { imaged_pct: 53 })).toBe('Decided: Reading Oct 12: the newest pass that saw over half the reserve (53%).');
    expect(say('read_pass', 'coverage_thin', SEP30, { imaged_pct: 53, from: AUG30, checkable_pct: 10 }))
      .toBe('Decided: Set Aug 30 aside: it can check only 10% of the reserve. Reading Sep 30.');
    expect(say('read_pass', 'no_candidates', SEP7, { imaged_pct: 48, from: SEP30, checkable_pct: 22 }))
      .toBe('Decided: No candidates on Sep 30 in the 22% it could check. Reading Sep 7 too.');
    expect(say('read_pass', 'asked', AUG30, { imaged_pct: 31, asked_words: 'end of August' })).toBe('Decided: Reading Aug 30, as asked. It saw 31% of the reserve.');
    expect(say('forecast', 'coverage_thin', 'none', { from: AUG30, checkable_pct: 10 })).toBe('Decided: Set Aug 30 aside: it can check only 10%. Going to where to look next.');
    expect(say('forecast', 'no_candidates', 'none', { from: OCT12, checkable_pct: 19 }))
      .toBe('Decided: No candidates on Oct 12 in the 19% it could check. Going to where to look next.');
    expect(say('draft', 'most_past_targets', 1, { box: 1, share_pct: 9 })).toBe('Decided: Drafting box 1: it held the most past dark targets, 9%.');
    expect(say('draft', 'soonest_look', 1, { box: 1, look: 'S1-D Oct 24 00:17 UTC' })).toBe('Decided: Drafting box 1: its radar look comes first, S1-D Oct 24 00:17 UTC.');
    expect(say('draft', 'near_candidates', 3, { box: 3, candidates_near: 2 })).toBe('Decided: Drafting box 3: 2 of the candidates lie in or near it.');
    expect(say('draft', 'only_planned_look', 2, { box: 2 })).toBe('Decided: Drafting box 2: the only box with a radar look planned.');
    expect(say('stop', 'no_checked_pass', 'none', { passes: [{ pass_id: AUG30, checkable_pct: 10 }], standard_pct: 15 }))
      .toBe('Checked: Aug 30 can check only 10%, under the 15% standard. No tasking can be drafted.');
    expect(say('stop', 'no_checked_pass', 'none', { passes: [{ pass_id: AUG30, checkable_pct: 10 }, { pass_id: SEP7, checkable_pct: 9 }], standard_pct: 15 }))
      .toBe('Checked: Aug 30 and Sep 7 can check only 10% and 9%. No tasking can be drafted.');
    expect(coverageLine({ checkable: 0.19, standard: 0.15 })).toEqual({ label: 'Checked:', text: 'This pass can check 19% of the reserve, over the 15% standard.' });
    expect(coverageLine({ checkable: 0.15, standard: 0.15 }).text).toBe('This pass can check 15% of the reserve, over the 15% standard.');
    expect(coverageLine({ checkable: 0.094, standard: 0.15 })).toEqual({ label: 'Checked:', text: 'This pass can check only 9% of the reserve, under the 15% standard.' });
    expect(candidatesLine(4).text).toBe('4 candidates where AIS was received, seen by both detectors.');
    expect(candidatesLine(1).text).toBe('1 candidate where AIS was received, seen by both detectors.');
    expect(candidatesLine(0).text).toBe('No candidates where AIS was received.');
  });

  it('reads a decision file only when it is one the tool writes; the model\'s words never reach a line', () => {
    const ok = { question_id: QID, step: 'read_pass', because: 'asked', subject: AUG30, facts: { pass_id: AUG30, imaged_pct: 31, asked_words: 'IGNORE <b>me</b>' }, tool_use_id: 'tooluse_a' };
    expect(parseDecision(ok)?.facts).toEqual({ imaged: 31 });
    expect(decisionLine(parseDecision(ok)!)!.text).not.toContain('IGNORE');
    expect(parseDecision({ ...ok, because: 'best' })).toBeNull();
    expect(parseDecision({ ...ok, step: 'draft' })).toBeNull();
    expect(parseDecision({ ...ok, question_id: 'nope' })).toBeNull();
    expect(parseDecision({ ...ok, subject: 'Sep 7' })).toBeNull();
    expect(parseDecision({ ...ok, facts: { pass_id: SEP7, imaged_pct: 31 } })).toBeNull();
    expect(parseDecision({ ...ok, facts: { imaged_pct: 131 } })).toBeNull();
    expect(parseDecision({ ...ok, facts: { imaged_pct: '31' } })).toBeNull();
    expect(parseDecision({ ...ok, tool_use_id: 'bad id!' })).toBeNull();
    expect(parseDecision({ ...ok, step: 'draft', because: 'soonest_look', subject: 1, facts: { box: 1, look: 'tomorrow, probably' } })).toBeNull();
    expect(parseDecision({ ...ok, step: 'draft', because: 'near_candidates', subject: 4, facts: { candidates_near: 1 } })).toBeNull();
    expect(parseDecision({ ...ok, step: 'stop', because: 'no_checked_pass', subject: 'none', facts: { passes: [], standard_pct: 15 } })).toBeNull();
    expect(parseDecision(null)).toBeNull();
  });
});

describe('where each line goes, and when it shows', () => {
  it('shows no line before its file loads, then one under the step it leads to', () => {
    const { tools, read } = cleanPath();
    const groups = vesselGroups(tools);
    const findId = groups.find((g) => g.name === 'find_pass')!.id;
    expect(vesselColumn(tools, files()).lines).toEqual({});
    const decisions = { [read.id]: file(read.id, 'read_pass', 'newest_wide', OCT12, { pass_id: OCT12, imaged_pct: 53 }) };
    expect(vesselColumn(tools, files({ decisions })).lines[findId]).toEqual([
      { label: 'Decided:', text: 'Reading Oct 12: the newest pass that saw over half the reserve (53%).' },
    ]);
    // No board yet (or not this turn's): no line, whatever is loaded.
    expect(vesselColumn(tools, files({ board: null, decisions })).lines).toEqual({});
  });

  it('shows no line for a refused call (no file), another question\'s file, or a file whose step and reason differ from the call', () => {
    const refused = call('decide', { step: 'read_pass', because: 'newest', pass_id: OCT12 });
    const retry = call('decide', { step: 'read_pass', because: 'newest_wide', pass_id: OCT12 });
    const tools = [call('list_passes'), refused, retry, call('find_pass', { when: OCT12 })];
    const good = file(retry.id, 'read_pass', 'newest_wide', OCT12, { imaged_pct: 53 });
    const column = vesselColumn(tools, files({ decisions: { [retry.id]: good } }));
    expect(Object.values(column.lines).flat()).toHaveLength(1);
    // The retry's line sits under the find, though the refused call came first.
    expect(column.lines[column.groups[1].id][0].text).toContain('newest pass that saw over half');
    const stale = file(retry.id, 'read_pass', 'newest_wide', OCT12, { imaged_pct: 53 }, { question_id: '0123456789ab' });
    expect(vesselColumn(tools, files({ decisions: { [retry.id]: stale } })).lines).toEqual({});
    const other = file(retry.id, 'read_pass', 'widest', OCT12, { imaged_pct: 53 });
    expect(vesselColumn(tools, files({ decisions: { [retry.id]: other } })).lines).toEqual({});
    const misfiled = file('tooluse_someone_else', 'read_pass', 'newest_wide', OCT12, { imaged_pct: 53 });
    expect(vesselColumn(tools, files({ decisions: { [retry.id]: misfiled } })).lines).toEqual({});
  });

  it('attaches a decide streamed after its action to the step before it, and waits for a step not yet streamed', () => {
    const after = call('decide', { step: 'read_pass', because: 'newest', pass_id: OCT12 });
    const tools = [call('list_passes'), call('find_pass', { when: OCT12 }), after];
    const decisions = { [after.id]: file(after.id, 'read_pass', 'newest', OCT12, { imaged_pct: 53 }) };
    const column = vesselColumn(tools, files({ decisions }));
    expect(column.lines[column.groups[1].id]).toHaveLength(1);
    // A second read announced before its find streamed: it never borrows the first pass's step.
    const first = call('decide', { step: 'read_pass', because: 'asked', pass_id: AUG30 });
    const second = call('decide', { step: 'read_pass', because: 'coverage_thin', pass_id: SEP30 });
    const thin = [call('list_passes'), first, call('find_pass', { when: AUG30 }), call('check_ais_coverage', { pass_id: AUG30 }), second];
    const both = {
      [first.id]: file(first.id, 'read_pass', 'asked', AUG30, { imaged_pct: 31 }),
      [second.id]: file(second.id, 'read_pass', 'coverage_thin', SEP30, { imaged_pct: 53, from: AUG30, checkable_pct: 10 }),
    };
    const waiting = vesselColumn(thin, files({ decisions: both }));
    expect(Object.values(waiting.lines).flat().map((l) => l.text)).toEqual(['Reading Aug 30, as asked. It saw 31% of the reserve.']);
    const landed = vesselColumn([...thin, call('find_pass', { when: SEP30 })], files({ decisions: both }));
    expect(landed.lines[landed.groups[3].id]).toEqual([{ label: 'Decided:', text: 'Set Aug 30 aside: it can check only 10% of the reserve. Reading Sep 30.' }]);
  });

  it('puts each read under the find called for its pass, before and after the second find streams', () => {
    const asked = 'Reading Aug 30, as asked. It saw 31% of the reserve.';
    const thin = 'Set Aug 30 aside: it can check only 10% of the reserve. Reading Sep 30.';
    const under = (c: ReturnType<typeof vesselColumn>) =>
      c.groups.filter((g) => g.name === 'find_pass').map((g) => (c.lines[g.id] ?? []).map((l) => l.text));
    // The first decide streams after its find, the second before its find; by id, then by day.
    for (const [aug, sep] of [[AUG30, SEP30], ['2026-08-30', '2026-09-30']]) {
      const first = call('decide', { step: 'read_pass', because: 'asked', pass_id: AUG30 });
      const second = call('decide', { step: 'read_pass', because: 'coverage_thin', pass_id: SEP30 });
      const decisions = {
        [first.id]: file(first.id, 'read_pass', 'asked', AUG30, { imaged_pct: 31 }),
        [second.id]: file(second.id, 'read_pass', 'coverage_thin', SEP30, { imaged_pct: 53, from: AUG30, checkable_pct: 10 }),
      };
      const stream = [call('list_passes'), call('find_pass', { when: aug }), first, call('check_ais_coverage', { pass_id: AUG30 }), second];
      expect(under(vesselColumn(stream, files({ decisions })))).toEqual([[asked]]);
      expect(under(vesselColumn([...stream, call('find_pass', { when: sep })], files({ decisions })))).toEqual([[asked], [thin]]);
    }
    // A find called for no pass ("latest") takes the read before it, never the next pass's find.
    const newest = call('decide', { step: 'read_pass', because: 'newest', pass_id: OCT12 });
    const next = call('decide', { step: 'read_pass', because: 'coverage_thin', pass_id: SEP30 });
    const decisions = {
      [newest.id]: file(newest.id, 'read_pass', 'newest', OCT12, { imaged_pct: 53 }),
      [next.id]: file(next.id, 'read_pass', 'coverage_thin', SEP30, { imaged_pct: 53, from: OCT12, checkable_pct: 12 }),
    };
    const stream = [
      call('list_passes'), call('find_pass', { when: 'latest' }), newest, call('check_ais_coverage', { pass_id: OCT12 }), next,
      call('find_pass', { when: SEP30 }),
    ];
    expect(under(vesselColumn(stream, files({ decisions })))).toEqual([
      ['Reading Oct 12: the newest pass on file. It saw 53% of the reserve.'],
      ['Set Oct 12 aside: it can check only 12% of the reserve. Reading Sep 30.'],
    ]);
  });

  it('puts the box under the next look (else the draft), the forecast under the prediction, and stop under the last step', () => {
    const { tools, read, draft } = cleanPath();
    const decided = {
      [read.id]: file(read.id, 'read_pass', 'newest_wide', OCT12, { imaged_pct: 53 }),
      [draft.id]: file(draft.id, 'draft', 'near_candidates', 3, { box: 3, candidates_near: 2 }),
    };
    const column = vesselColumn(tools, files({ decisions: decided, revealed: { [OCT12]: 4 } }));
    const look = column.groups.find((g) => g.name === 'next_look')!;
    expect(column.lines[look.id]).toEqual([{ label: 'Decided:', text: 'Drafting box 3: 2 of the candidates lie in or near it.' }]);
    // The boxes' candidate count waits for the map's reveal of the pass read.
    expect(vesselColumn(tools, files({ decisions: decided })).lines[look.id]).toBeUndefined();
    // With next_look cut, the line goes to the draft.
    const soonest = call('decide', { step: 'draft', because: 'soonest_look', box: 1 });
    const cut = [...tools.filter((t) => t !== draft && t.name !== 'next_look' && !String(t.params.s3_url ?? '').includes('look_')).slice(0, -1), soonest, call('draft_tasking', { box: 1 })];
    const noLook = vesselColumn(cut, files({ decisions: { [soonest.id]: file(soonest.id, 'draft', 'soonest_look', 1, { box: 1, look: 'S1-D Oct 24 00:17 UTC' }) } }));
    expect(noLook.groups.map((g) => g.name)).not.toContain('next_look');
    expect(noLook.lines[noLook.groups.find((g) => g.name === 'draft_tasking')!.id])
      .toEqual([{ label: 'Decided:', text: 'Drafting box 1: its radar look comes first, S1-D Oct 24 00:17 UTC.' }]);

    const fc = call('decide', { step: 'forecast', because: 'coverage_thin' });
    const stop = call('decide', { step: 'stop', because: 'no_checked_pass' });
    const ending = [
      call('list_passes'), call('find_pass', { when: AUG30 }), call('check_ais_coverage', { pass_id: AUG30 }), show(`heard_${AUG30}.geojson`),
      fc, call('predict_hotspots', { pass_id: AUG30 }), show('hotspots.geojson'), stop,
    ];
    const decisions = {
      [fc.id]: file(fc.id, 'forecast', 'coverage_thin', 'none', { from: AUG30, checkable_pct: 10 }),
      [stop.id]: file(stop.id, 'stop', 'no_checked_pass', 'none', { passes: [{ pass_id: AUG30, checkable_pct: 10 }], standard_pct: 15 }),
    };
    const end = vesselColumn(ending, files({ decisions, heard: { [AUG30]: { checkable: 0.1, standard: 0.15 } } }));
    const predict = end.groups[end.groups.length - 1];
    expect(predict.name).toBe('predict_hotspots');
    expect(end.lines[predict.id].map((l) => `${l.label} ${l.text}`)).toEqual([
      'Decided: Set Aug 30 aside: it can check only 10%. Going to where to look next.',
      'Checked: Aug 30 can check only 10%, under the 15% standard. No tasking can be drafted.',
    ]);
    expect(end.lines[end.groups[2].id]).toEqual([{ label: 'Checked:', text: 'This pass can check only 10% of the reserve, under the 15% standard.' }]);
    expect(end.states).toEqual({ [AUG30]: 'thin' });
  });

  it('shows the coverage line once its area has streamed and its file loaded, and the candidates line only after the map\'s reveal', () => {
    const { tools } = cleanPath();
    const heard = { [OCT12]: { checkable: 0.19, standard: 0.15 } };
    const coverage = (c: ReturnType<typeof vesselColumn>) => c.lines[c.groups.find((g) => g.name === 'check_ais_coverage')!.id];
    const match = (c: ReturnType<typeof vesselColumn>) => c.lines[c.groups.find((g) => g.name === 'match_ais')!.id];
    // The file is loaded but its area has not streamed to the map: no line.
    const early = tools.slice(0, tools.findIndex((t) => t.name === 'check_ais_coverage') + 1);
    expect(coverage(vesselColumn(early, files({ heard })))).toBeUndefined();
    expect(coverage(vesselColumn(tools, files({ heard })))).toEqual([{ label: 'Checked:', text: 'This pass can check 19% of the reserve, over the 15% standard.' }]);
    expect(match(vesselColumn(tools, files({ heard })))).toBeUndefined();
    expect(match(vesselColumn(tools, files({ heard, revealed: { [OCT12]: 4 } })))).toEqual([candidatesLine(4)]);
    // A reveal of a pass this turn did not match prints nothing.
    expect(Object.values(vesselColumn(tools, files({ revealed: { [SEP7]: 2 } })).lines).flat()).toEqual([]);
    expect(parseHeard({ features: [{ properties: { kind: 'heard', share: 0.3, imaged: 0.53, checkable: 0.19, standard: 0.15 } }] })).toEqual({ checkable: 0.19, standard: 0.15 });
    // A coverage file from before the checkable share (an earlier recording) prints no line.
    expect(parseHeard({ features: [{ properties: { kind: 'heard', share: 0.3 } }] })).toBeNull();
    expect(parseHeard({ features: [{ properties: { checkable: 1.9, standard: 0.15 } }] })).toBeNull();
  });

  it('waits for the reveal: a no_candidates file loaded before it shows no line and no board state until the map reveals that pass', () => {
    const read1 = call('decide', { step: 'read_pass', because: 'newest_wide', pass_id: OCT12 });
    const read2 = call('decide', { step: 'read_pass', because: 'no_candidates', pass_id: SEP7 });
    const tools = [
      call('list_passes'), read1, call('find_pass', { when: OCT12 }), call('match_ais', { pass_id: OCT12 }), show(`targets_${OCT12}.geojson`),
      read2, call('find_pass', { when: SEP7 }),
    ];
    const decisions = {
      [read1.id]: file(read1.id, 'read_pass', 'newest_wide', OCT12, { imaged_pct: 53 }),
      [read2.id]: file(read2.id, 'read_pass', 'no_candidates', SEP7, { imaged_pct: 48, from: OCT12, checkable_pct: 19 }),
    };
    const before = vesselColumn(tools, files({ decisions }));
    expect(Object.values(before.lines).flat().map((l) => l.text)).toEqual(['Reading Oct 12: the newest pass that saw over half the reserve (53%).']);
    expect(before.states).toEqual({ [OCT12]: 'read', [SEP7]: 'reading' });
    const after = vesselColumn(tools, files({ decisions, revealed: { [OCT12]: 0 } }));
    const secondFind = after.groups.filter((g) => g.name === 'find_pass')[1];
    expect(after.lines[secondFind.id]).toEqual([{ label: 'Decided:', text: 'No candidates on Oct 12 in the 19% it could check. Reading Sep 7 too.' }]);
    expect(after.lines[after.groups.find((g) => g.name === 'match_ais')!.id]).toEqual([{ label: 'Checked:', text: 'No candidates where AIS was received.' }]);
    expect(after.states).toEqual({ [OCT12]: 'empty', [SEP7]: 'reading' });
    // The forecast's no_candidates line and the boxes' candidate count wait the same way.
    const fc = file('tooluse_f', 'forecast', 'no_candidates', 'none', { from: SEP7, checkable_pct: 17 });
    expect(decisionWaits(fc, {}, SEP7)).toBe(true);
    expect(decisionWaits(fc, { [SEP7]: 0 }, SEP7)).toBe(false);
    const near = file('tooluse_n', 'draft', 'near_candidates', 3, { box: 3, candidates_near: 2 });
    expect(decisionWaits(near, {}, OCT12)).toBe(true);
    expect(decisionWaits(near, { [OCT12]: 4 }, OCT12)).toBe(false);
    expect(decisionWaits(file('tooluse_m', 'draft', 'most_past_targets', 1, { share_pct: 9 }), {}, null)).toBe(false);
  });
});

describe('the board', () => {
  it('validates each field, newest first, at most 12 rows', () => {
    expect(BOARD.rows.map((r) => [r.day, r.satellite, r.imaged])).toEqual([
      ['Oct 12', 'S1D', 0.53], ['Sep 30', 'S1D', 0.53], ['Sep 18', 'S1D', 0.53], ['Sep 7', 'S1D', 0.48], ['Aug 30', 'S1D', 0.31],
    ]);
    const bad = parseBoard(boardRaw({
      passes: [
        row(OCT12, '2026-10-12T00:18:02Z', 0.53, 'S1D'),
        row('S1D 20261001', '2026-10-01T00:18:02Z', 0.5),
        row(SEP30, 'Sep 30', 0.53),
        row(SEP18, '2026-09-18T00:18:02Z', 0.53, 'Sentinel-2A'),
        row(SEP7, '2026-09-07T11:41:47Z', 1.48),
        row(AUG30, '2026-08-30T00:26:09Z', 0.31, 'S1E'),
      ],
    }))!;
    expect(bad.rows.map((r) => r.passId)).toEqual([OCT12]);
    // Given oldest first, the board still reads newest first.
    expect(parseBoard(boardRaw({ passes: [...ROWS].reverse() }))!.rows[0].passId).toBe(OCT12);
    const many = Array.from({ length: 15 }, (_, i) => row(`s1d-202607${String(i + 1).padStart(2, '0')}t0018`, `2026-07-${String(i + 1).padStart(2, '0')}T00:18:00Z`, 0.5));
    expect(parseBoard(boardRaw({ passes: many }))!.rows).toHaveLength(12);
    expect(parseBoard(boardRaw({ question_id: 'x' }))).toBeNull();
    expect(parseBoard(boardRaw({ decision_keys: 'other' }))).toBeNull();
    expect(parseBoard(boardRaw({ passes: [] }))).toBeNull();
  });

  it('shows 4 rows below 1600 px and 6 at it, keeping every marked row in view', () => {
    const many = parseBoard(boardRaw({
      passes: [...ROWS, row('s1d-20260818t0026', '2026-08-18T00:26:09Z', 0.31), row('s1d-20260806t0026', '2026-08-06T00:26:09Z', 0.31)],
    }))!;
    expect(boardLimit(false)).toBe(4);
    expect(boardLimit(true)).toBe(6);
    const quiet = visibleBoardRows(many.rows, {}, 4);
    expect(quiet.rows.map((r) => r.day)).toEqual(['Oct 12', 'Sep 30', 'Sep 18', 'Sep 7']);
    expect(quiet.older).toBe(3);
    // The Aug 30 pass, set aside, replaces the oldest unmarked row in view; the reading row stays.
    const marked = visibleBoardRows(many.rows, { [AUG30]: 'thin', [SEP30]: 'reading' }, 4);
    expect(marked.rows.map((r) => r.day)).toEqual(['Oct 12', 'Sep 30', 'Sep 18', 'Aug 30']);
    expect(marked.older).toBe(3);
    expect(visibleBoardRows(many.rows, { 's1d-20260806t0026': 'read', [AUG30]: 'reading' }, 6).rows.map((r) => r.day))
      .toEqual(['Oct 12', 'Sep 30', 'Sep 18', 'Sep 7', 'Aug 30', 'Aug 6']);
  });

  it('takes its states from the decision files only', () => {
    const d1 = file('tooluse_1', 'read_pass', 'asked', AUG30, { imaged_pct: 31 });
    const d2 = file('tooluse_2', 'read_pass', 'coverage_thin', SEP30, { imaged_pct: 53, from: AUG30, checkable_pct: 10 });
    expect(boardStates([], {})).toEqual({});
    expect(boardStates([d1], {})).toEqual({ [AUG30]: 'reading' });
    expect(boardStates([d1, d2], {})).toEqual({ [AUG30]: 'thin', [SEP30]: 'reading' });
    // Out of stream order, the tool's own order (n) still says which pass is being read.
    expect(boardStates([d2, d1], {})).toEqual({ [AUG30]: 'thin', [SEP30]: 'reading' });
    // A refused call has no file, so a column with only the calls marks nothing.
    const listing = call('list_passes');
    const tools = [listing, call('decide', { step: 'read_pass', because: 'newest', pass_id: OCT12 }), call('find_pass', { when: OCT12 })];
    expect(vesselColumn(tools, files()).states).toEqual({});
    expect(vesselColumn(tools, files()).boardGroup).toBe(listing.id);
  });

  it('accepts a call-mode board as named; an inputs-mode board only when its question started no earlier than the turn less 30 s', () => {
    const sent = Date.parse('2026-10-21T14:00:20Z');
    expect(boardAccepted(BOARD, 'call', sent)).toBe(true);
    const inputs = parseBoard(boardRaw({ decision_keys: 'inputs' }))!;
    expect(boardAccepted(inputs, 'inputs', sent)).toBe(true);
    expect(boardAccepted(inputs, 'inputs', Date.parse('2026-10-21T14:00:00Z') + BOARD_CLOCK_SKEW_MS)).toBe(true);
    // A board from an earlier question (started before the turn, beyond the skew) never shows.
    expect(boardAccepted(inputs, 'inputs', Date.parse('2026-10-21T14:05:00Z'))).toBe(false);
    expect(boardAccepted(inputs, 'call', sent)).toBe(false);
    expect(boardAccepted(BOARD, 'inputs', sent)).toBe(false);
  });
});

describe('where the files are', () => {
  it('finds this session\'s folder or the case\'s from the stream, else from the rest file\'s bucket', () => {
    const { tools } = cleanPath();
    expect(vesselsDirFrom(tools, SID)).toBe(S);
    expect(vesselsDirFrom([call('list_passes')], SID, { bucket: 'geo-agent-bucket' })).toBe(`s3://geo-agent-bucket/session_data/${SID}/vessels/`);
    expect(vesselsDirFrom([call('list_passes')], SID, { bucket: 'geo-agent-bucket', caseId: 'vessels-open-question' }))
      .toBe('s3://geo-agent-bucket/use-cases/vessels-open-question/');
    expect(vesselsDirFrom([call('display_visual', { s3_url: 's3://b-1/use-cases/vessels-open-question/radar_s1d-20261012t0018.tif' })], SID))
      .toBe('s3://b-1/use-cases/vessels-open-question/');
    expect(vesselsDirFrom([call('inspect_image', { s3_url: 's3://b-1/use-cases/vessels-open-question/chips/s1d-20261012t0018_T01.tif' })], SID))
      .toBe('s3://b-1/use-cases/vessels-open-question/');
    // Another session's folder is never followed; the fallback is this session's.
    const foreign = [call('display_visual', { s3_url: 's3://bucket/session_data/someone-else/vessels/radar_s1d-20261012t0018.tif' })];
    expect(vesselsDirFrom(foreign, SID)).toBeNull();
    expect(vesselsDirFrom(foreign, SID, { bucket: 'bucket' })).toBe(S);
    // No bucket, or a bad one: the fallback is off and the column waits for a streamed s3_url.
    expect(vesselsDirFrom([call('list_passes')], SID)).toBeNull();
    expect(vesselsDirFrom([call('list_passes')], SID, { bucket: 'Bad_Bucket' })).toBeNull();
    expect(vesselsDirFrom([call('list_passes')], '../etc', { bucket: 'bucket' })).toBeNull();
    expect(vesselsDirFrom([call('list_passes')], SID, { bucket: 'bucket', caseId: 'methane-watch-mission' })).toBeNull();
    expect(validBucket('geo-agent-bucket')).toBe('geo-agent-bucket');
    expect(validBucket('x')).toBeNull();
    expect(validBucket(undefined)).toBeNull();
  });

  it('names the board and the decision files by the call ("call" mode) or by its inputs ("inputs" mode)', () => {
    const { tools, listing, read, draft } = cleanPath();
    expect(boardUrl(S, tools)).toBe(`${S}passes_${listing.id}.json`);
    expect(boardUrl(S, tools, 'inputs')).toBe(`${S}passes_on_file.json`);
    expect(boardUrl(S, [call('find_pass')])).toBeNull();
    expect(boardUrl(null, tools)).toBeNull();
    // The latest list_passes call's board: a second question in one turn shows its own.
    const again = call('list_passes', {}, 'tooluse_list2');
    expect(boardUrl(S, [...tools, again])).toBe(`${S}passes_tooluse_list2.json`);
    expect(decisionUrl(S, QID, read)).toBe(`${S}decision_${QID}_${read.id}.json`);
    expect(decisionUrl(S, QID, read, 'inputs')).toBe(`${S}decision_${QID}_read_pass_newest_wide_${OCT12}.json`);
    expect(decisionUrl(S, QID, draft, 'inputs')).toBe(`${S}decision_${QID}_draft_near_candidates_3.json`);
    expect(decisionUrl(S, QID, call('decide', { step: 'stop', because: 'no_checked_pass' }), 'inputs')).toBe(`${S}decision_${QID}_stop_no_checked_pass_none.json`);
    expect(decisionUrl(S, QID, call('decide', { step: 'read_pass', because: 'newest', pass_id: '../x' }), 'inputs')).toBeNull();
    expect(decisionUrl(S, QID, call('decide', { step: 'draft', because: 'soonest_look', box: 7 }), 'inputs')).toBeNull();
    expect(decisionUrl(S, QID, call('decide', {}, 'bad id'))).toBeNull();
    expect(decisionUrl(S, 'nope', read)).toBeNull();
    expect(decisionUrl(S, QID, listing)).toBeNull();
  });
});

describe('the height rules', () => {
  it('changes the lit key when the lit step changes or a line appears under it', () => {
    const { tools, read } = cleanPath();
    const upTo = (name: string) => tools.slice(0, tools.findIndex((t) => t.name === name) + 1);
    const a = litKey(vesselColumn(upTo('find_pass'), files()), true);
    const decisions = { [read.id]: file(read.id, 'read_pass', 'newest_wide', OCT12, { imaged_pct: 53 }) };
    const b = litKey(vesselColumn(upTo('find_pass'), files({ decisions })), true);
    const c = litKey(vesselColumn(upTo('detect_vessels'), files({ decisions })), true);
    expect(new Set([a, b, c]).size).toBe(3);
    // A map call folded into the lit step changes nothing.
    expect(litKey(vesselColumn(upTo('find_pass').concat(show(`radar_${OCT12}.tif`)), files({ decisions })), true)).toBe(b);
    expect(litKey(vesselColumn(tools, files()), false)).toBe('');
    expect(litScrollOptions(false)).toEqual({ block: 'nearest', behavior: 'smooth' });
    expect(litScrollOptions(true)).toEqual({ block: 'nearest', behavior: 'auto' });
  });

  it('scrolls a vessel answer taller than the column to its first line', () => {
    // At 1280 the answer at its cap (about 470 px) is taller than the 416 px left; at 1920 it fits.
    expect(answerScrollBlock(470, 416)).toBe('start');
    expect(answerScrollBlock(330, 797)).toBe('nearest');
    expect(answerScrollBlock(416, 416)).toBe('nearest');
  });
});
