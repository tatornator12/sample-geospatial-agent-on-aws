import { describe, expect, it } from 'vitest';
import type { ToolCall } from '../types.ts';
import type { EvidenceItem } from './evidence.ts';
import {
  BECAUSE_WORDS,
  SITE_NAMES,
  SURVEY_PAIRS,
  VERDICT_WORDS,
  archaeologyDirFrom,
  belongsTo,
  parseSurvey,
  surveyEvidence,
  surveyRowText,
  surveyUrl,
} from './survey.ts';

const SID = 'a1b2c3d4-0000-4111-8222-333344445555-abcd1234';
const BUCKET = 'geo-bucket';
const call = (id: string, name: string, params: Record<string, unknown> = {}): ToolCall => ({ id, name, params, status: 'completed' });
const file = (over: Record<string, unknown> = {}) => ({
  turn_id: '0123456789ab', tool_use_id: 'tooluse_1', n: 1, site_id: 'hopeton-earthworks', verdict: 'visible',
  because: 'ploughed_but_traced', example_id: 'newark-octagon', rank: 1, distance_km: 87, ...over,
});

describe('where the survey files are', () => {
  it('is this session\'s archaeology folder, read off its terrain folder', () => {
    const tools = [call('a', 'inspect_image', { s3_url: `s3://${BUCKET}/session_data/${SID}/terrain/lrm03_hopeton-earthworks.tif` })];
    expect(archaeologyDirFrom(tools, SID)).toBe(`s3://${BUCKET}/session_data/${SID}/archaeology/`);
  });
  it('never follows another session, or a folder that is not terrain', () => {
    const other = [call('a', 'inspect_image', { s3_url: `s3://${BUCKET}/session_data/someone-else/terrain/lrm_x.tif` })];
    expect(archaeologyDirFrom(other, SID)).toBeNull();
    const rasters = [call('a', 'inspect_image', { s3_url: `s3://${BUCKET}/session_data/${SID}/rasters/tci_x.tif` })];
    expect(archaeologyDirFrom(rasters, SID)).toBeNull();
    expect(archaeologyDirFrom([call('a', 'find_similar_sites', { site_id: 'newark-octagon' })], SID)).toBeNull();
  });
  it('is a replay case\'s own folder, its files flat', () => {
    const tools = [call('a', 'display_visual', { s3_url: `s3://${BUCKET}/use-cases/archaeologist-survey/lrm03_seip-earthworks.tif` })];
    expect(archaeologyDirFrom(tools, SID)).toBe(`s3://${BUCKET}/use-cases/archaeologist-survey/`);
    const vessels = [call('a', 'display_visual', { s3_url: `s3://${BUCKET}/use-cases/vessels-galapagos/radar_x.tif` })];
    expect(archaeologyDirFrom(vessels, SID)).toBeNull();
  });
});

describe('the file a verdict writes', () => {
  const dir = `s3://${BUCKET}/session_data/${SID}/archaeology/`;
  it('is named by the record_condition call\'s own id', () => {
    expect(surveyUrl(dir, call('tooluse_9', 'record_condition'))).toBe(`${dir}survey_tooluse_9.json`);
    expect(surveyUrl(dir, call('tooluse_9', 'inspect_image'))).toBeNull();
    expect(surveyUrl(dir, call('../x', 'record_condition'))).toBeNull();
    expect(surveyUrl(null, call('tooluse_9', 'record_condition'))).toBeNull();
  });
});

describe('parseSurvey', () => {
  it('takes a file of enums and numbers', () => {
    expect(parseSurvey(file())).toEqual({
      toolUseId: 'tooluse_1', siteId: 'hopeton-earthworks', verdict: 'visible', because: 'ploughed_but_traced',
      n: 1, rank: 1, distanceKm: 87, exampleId: 'newark-octagon',
    });
  });
  it.each([
    ['an unknown verdict', { verdict: 'seen' }],
    ['a reason the verdict does not take', { verdict: 'visible', because: 'no_form_seen' }],
    ['an unknown reason', { because: 'looks good' }],
    ['a site off the catalogue', { site_id: 'lost-city' }],
    ['the example judged as its own match', { site_id: 'newark-octagon' }],
    ['an unknown example', { example_id: 'atlantis' }],
    ['a bad tool-use id', { tool_use_id: '../../x' }],
    ['a bad turn id', { turn_id: 'not hex' }],
    ['a fractional distance', { distance_km: 87.5 }],
    ['a distance inside the same complex', { distance_km: 2 }],
    ['a rank out of range', { rank: 0 }],
    ['a free-text field in place of a number', { n: 'first' }],
  ])('refuses %s', (_why, over) => {
    expect(parseSurvey(file(over))).toBeNull();
  });
  it('refuses what is not an object', () => {
    for (const raw of [null, 'visible', 3, []]) expect(parseSurvey(raw)).toBeNull();
  });
});

describe('a row is the call\'s own and the stage\'s words', () => {
  const record = parseSurvey(file())!;
  it('belongs only to the call with its id and site', () => {
    expect(belongsTo(record, call('tooluse_1', 'record_condition', { site_id: 'hopeton-earthworks' }))).toBe(true);
    expect(belongsTo(record, call('tooluse_2', 'record_condition', { site_id: 'hopeton-earthworks' }))).toBe(false);
    expect(belongsTo(record, call('tooluse_1', 'record_condition', { site_id: 'seip-earthworks' }))).toBe(false);
  });
  it('words every verdict and reason the tool can write', () => {
    for (const [verdict, reasons] of Object.entries(SURVEY_PAIRS)) {
      for (const because of reasons) {
        const text = surveyRowText(parseSurvey(file({ verdict, because }))!);
        expect(text.verdict).toBe(VERDICT_WORDS[verdict as keyof typeof VERDICT_WORDS]);
        expect(text.because).toBe(BECAUSE_WORDS[because]);
      }
    }
    expect(surveyRowText(record)).toEqual({ site: 'Hopeton Earthworks', km: '87 km', verdict: 'Still shows', because: 'ploughed down, still traced' });
  });
  it('names a site in short, from the mirror', () => {
    expect(surveyRowText(parseSurvey(file({ site_id: 'fort-ancient', distance_km: 158 }))!).site).toBe('Fort Ancient Earthworks');
    expect(Object.keys(SITE_NAMES)).toHaveLength(28);
  });
});

describe('the evidence in a row', () => {
  const record = parseSurvey(file())!;
  const item = (toolId: string, url: string, title = 'Hopeton, the walls I see (model words)'): EvidenceItem => ({
    toolId, title, question: 'Can you see the walls?', saw: 'Faint red lines', sourceUrl: url, evidenceUrls: [`${url}.png`],
  });
  it('is the turn\'s latest look at that site\'s relief, re-titled with no model text', () => {
    const evidence = [
      item('i1', `s3://${BUCKET}/session_data/${SID}/terrain/lrm03_hopeton-earthworks.tif`),
      item('i2', `s3://${BUCKET}/session_data/${SID}/terrain/hillshade_hopeton-earthworks.tif`),
      item('i3', `s3://${BUCKET}/session_data/${SID}/terrain/lrm03_seip-earthworks.tif`),
    ];
    const chip = surveyEvidence(record, evidence)!;
    expect(chip.toolId).toBe('i1');
    expect(chip.title).toBe('Hopeton Earthworks, local relief');
    expect(chip.question).toBeUndefined();
    expect(chip.saw).toBeUndefined();
  });
  it('is the close look when that is what the agent inspected', () => {
    const close = item('i4', `s3://${BUCKET}/session_data/${SID}/terrain/lrm03_hopeton-earthworks_site.tif`);
    expect(surveyEvidence(record, [close])?.toolId).toBe('i4');
  });
  it('is the latest look before the verdict, never one after it', () => {
    const frame = item('i1', `s3://${BUCKET}/session_data/${SID}/terrain/lrm03_hopeton-earthworks.tif`);
    const close = item('i4', `s3://${BUCKET}/session_data/${SID}/terrain/lrm03_hopeton-earthworks_site.tif`);
    const after = item('i9', `s3://${BUCKET}/session_data/${SID}/terrain/lrm03_hopeton-earthworks_site.tif`);
    const order: Record<string, number> = { i1: 1, i4: 2, verdict: 3, i9: 4 };
    const before = (toolId: string) => (order[toolId] ?? Infinity) < order.verdict;
    expect(surveyEvidence(record, [frame, close, after], before)?.toolId).toBe('i4');
    expect(surveyEvidence(record, [after], before)).toBeNull();
    // With no order to go by, every look counts and the latest wins.
    expect(surveyEvidence(record, [frame, close, after])?.toolId).toBe('i9');
  });
  it('is none when the agent never looked at it', () => {
    expect(surveyEvidence(record, [item('i3', `s3://${BUCKET}/session_data/${SID}/terrain/lrm03_seip-earthworks.tif`)])).toBeNull();
  });
});
