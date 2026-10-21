import { describe, expect, it } from 'vitest';
import {
  NARRATION_MAX,
  SAW_MAX,
  boundedSaw,
  capWords,
  latestNarration,
  openTool,
  sawByTool,
  stageSentences,
  toolSpans,
  withSaw,
} from './narration.ts';
import type { EvidenceItem } from './evidence.ts';

const tool = (id: string, name: string, input: Record<string, unknown> = {}) =>
  JSON.stringify({ toolUseId: id, name, input: JSON.stringify(input) });

describe('stageSentences (the sanitiser)', () => {
  it('takes the markdown off and keeps the words', () => {
    expect(stageSentences('The scene is **perfectly clear** and _dense_ canopy fills it. See [the index](https://x.example/ndvi) for more.')).toEqual([
      'The scene is perfectly clear and dense canopy fills it.',
      'See the index for more.',
    ]);
    expect(stageSentences('- Dense green canopy covers the park.\n- The Reservoir is clearly visible.')).toEqual([
      'Dense green canopy covers the park.',
      'The Reservoir is clearly visible.',
    ]);
    expect(stageSentences('> A quoted line of the record.')).toEqual(['A quoted line of the record.']);
  });

  it('reads an em dash as a comma', () => {
    expect(stageSentences('The walls are clear — the golf course runs inside them.')).toEqual([
      'The walls are clear, the golf course runs inside them.',
    ]);
  });

  it('leaves out a technical aside in brackets and keeps one in words', () => {
    expect(stageSentences('The scene is clear over the park (aoi_cloud_pct 0%); the canopy is dense.')).toEqual([
      'The scene is clear over the park; the canopy is dense.',
    ]);
    expect(stageSentences('The Reservoir (the largest water body) is clear.')).toEqual(['The Reservoir (the largest water body) is clear.']);
  });

  it('drops a sentence that names a tool, a URL, a file or code', () => {
    const text = [
      'Calling find_location_boundary for the park.',
      'The calculator gives 20 hectares.',
      'The file is at s3://bucket/key.tif today.',
      'Details are at https://example.com today.',
      'The value is `ndvi` here.',
      'The object {"a": 1} is here.',
      'The canopy is dense and healthy.',
    ].join(' ');
    expect(stageSentences(text)).toEqual(['The canopy is dense and healthy.']);
  });

  it('keeps decimals and coordinates whole', () => {
    expect(stageSentences('The mean NDVI is 0.65 across the park. The centre sits at 40.78, -73.96 in Manhattan.')).toEqual([
      'The mean NDVI is 0.65 across the park.',
      'The centre sits at 40.78, -73.96 in Manhattan.',
    ]);
  });

  it('skips tables, headings, rules, fences and images', () => {
    const text = [
      '## Results',
      '| Class | Area |',
      '|---|---|',
      '| Dense | 2.1 km² |',
      '---',
      '```',
      'Code that reads like a sentence here.',
      '```',
      '![a map](https://x.example/a.png)',
      'Only this sentence is prose here.',
    ].join('\n');
    expect(stageSentences(text)).toEqual(['Only this sentence is prose here.']);
  });

  it('holds back the last sentence of open text until the next begins', () => {
    expect(stageSentences('The scene is clear. The NDVI is 0.', { open: true })).toEqual(['The scene is clear.']);
    expect(stageSentences('The scene is clear.', { open: true })).toEqual([]);
  });
});

describe('capWords', () => {
  it('cuts at a word and ends with an ellipsis', () => {
    const s = 'The scene from 2026-10-06 is perfectly clear with dense green canopy across the whole park';
    const capped = capWords(s, 40);
    expect(capped.length).toBeLessThanOrEqual(40);
    expect(capped.endsWith('…')).toBe(true);
    expect(s.startsWith(capped.slice(0, -1))).toBe(true);
    expect(s[capped.length - 1]).toBe(' ');
    expect(capWords('Short.', 40)).toBe('Short.');
  });
});

describe('toolSpans', () => {
  it('finds complete tool objects and where an open one starts', () => {
    const raw = `Hello there. ${tool('t1', 'get_rasters')} More words. {"toolUseId": "t2", "name": "inspect_im`;
    const { spans, openFrom } = toolSpans(raw);
    expect(spans.map((s) => [s.id, s.name])).toEqual([['t1', 'get_rasters']]);
    expect(openFrom).toBe(raw.indexOf('{"toolUseId": "t2"'));
  });
});

describe('openTool (B1, A1 P1-2: the step lights while its tool runs)', () => {
  it('names the call the agent has opened and not closed, as every runtime streams it', () => {
    // geospatial_agent_on_aws.py: the opener with a space after each colon, then the input.
    const raw = `Done. ${tool('t1', 'find_location_boundary', { location: 'Central Park' })} Now the search. {"toolUseId": "tooluse_AbC-9", "name": "find_similar_places", "input": "{\\"bbox\\": [-79.8, 40.4`;
    expect(openTool(raw)).toEqual({ id: 'tooluse_AbC-9', name: 'find_similar_places' });
    // No space after the colons (the scratch harness and JSON.stringify).
    expect(openTool(`{"toolUseId":"t2","name":"get_rasters","input":"`)).toEqual({ id: 't2', name: 'get_rasters' });
  });

  it('is null when every call is closed, while the name is still streaming, or when the shape is wrong', () => {
    expect(openTool(`Words. ${tool('t1', 'get_rasters')} More words.`)).toBeNull();
    expect(openTool('No tools at all.')).toBeNull();
    expect(openTool('{"toolUseId": "t2", "name": "inspect_im')).toBeNull();
    expect(openTool('{"toolUseId": "t2", "name": "Not A Tool", "input": "')).toBeNull();
    expect(openTool('{"toolUseId": "bad id!", "name": "get_rasters", "input": "')).toBeNull();
    expect(openTool('{"toolUseId": "t2", "name": "get_rasters<script>", "input": "')).toBeNull();
  });
});

describe('latestNarration', () => {
  it('does not show a sentence still being written', () => {
    expect(latestNarration('I will find the park first. Then I fetch the')).toBe('I will find the park first.');
    expect(latestNarration('I will find the park first.')).toBeNull();
  });

  it("shows a closed segment's last sentence", () => {
    const raw = `I will find the park first. Looking up its boundary now. ${tool('t1', 'find_location_boundary')}`;
    expect(latestNarration(raw)).toBe('Looking up its boundary now.');
  });

  it('closes the segment before a tool object that is still streaming', () => {
    expect(latestNarration('Fetching the scene for the park. {"toolUseId": "t9", "na')).toBe('Fetching the scene for the park.');
  });

  it('skips tables and headings', () => {
    const raw = `The boundary is ready for the park. ${tool('t1', 'get_rasters')}## Results\n| A | B |\n|---|---|\n| 1 | 2 |\n`;
    expect(latestNarration(raw)).toBe('The boundary is ready for the park.');
  });

  it('falls back to the sentence before when the latest names a tool', () => {
    const raw = `The scene is clear over the park. Now calling run_bandmath on it. ${tool('t1', 'run_bandmath')}`;
    expect(latestNarration(raw)).toBe('The scene is clear over the park.');
  });

  it('caps a long sentence at the narration length', () => {
    const long = `${'The canopy runs on and on across the park '.repeat(6).trim()}.`;
    const out = latestNarration(`${long} ${tool('t1', 'get_rasters')}`)!;
    expect(out.length).toBeLessThanOrEqual(NARRATION_MAX);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('sawByTool', () => {
  const inspect = (id: string) => tool(id, 'inspect_image', { s3_url: 's3://b/x.tif', title: 'X' });

  it('keeps the words after inspect_image up to the next tool, without the plan', () => {
    const raw = `Looking now. ${inspect('i1')}The scene is clear, with no cloud over the site. The walls show as a ring of trees. Next I'll compute the index. ${tool('t2', 'run_bandmath')}The index is ready.`;
    expect(sawByTool(raw, { finished: true })).toEqual({
      i1: 'The scene is clear, with no cloud over the site. The walls show as a ring of trees.',
    });
  });

  it('gives nothing when the agent only said what it would do next', () => {
    const raw = `${inspect('i1')}Now I'll compute the vegetation index. ${tool('t2', 'run_bandmath')}`;
    expect(sawByTool(raw, { finished: true })).toEqual({});
  });

  it('while streaming, shows only finished sentences', () => {
    const raw = `${inspect('i1')}The scene is clear over the park. The Reservoir is clea`;
    expect(sawByTool(raw)).toEqual({ i1: 'The scene is clear over the park.' });
    expect(sawByTool(`${inspect('i1')}The scene is clear over the park.`)).toEqual({});
    expect(sawByTool(`${inspect('i1')}The scene is clear over the park.`, { finished: true })).toEqual({
      i1: 'The scene is clear over the park.',
    });
  });

  it('maps two inspections separately', () => {
    const raw = `${inspect('i1')}West Point has dense green canopy. ${inspect('i2')}Lake George shows open water and forest.`;
    expect(sawByTool(raw, { finished: true })).toEqual({
      i1: 'West Point has dense green canopy.',
      i2: 'Lake George shows open water and forest.',
    });
  });

  it('joins sentences up to the Saw length and never past it', () => {
    const s1 = 'The scene from 2026-10-06 is perfectly clear, with dense canopy across the park.';
    const s2 = 'The Reservoir is clearly visible in the middle of the park as open water.';
    const out = sawByTool(`${inspect('i1')}${s1} ${s2}`, { finished: true }).i1;
    expect(out).toBe(s1);
    expect(out.length).toBeLessThanOrEqual(SAW_MAX);
  });

  it('reads a trimmed live stream (Act 1, Central Park) the way the stage shows it', () => {
    // Trimmed from the shape of a live Earth Analyst turn: narration, the inspection, its words.
    const raw = [
      "I'll analyse vegetation health for Central Park. Let me start by getting its boundary.",
      tool('tooluse_a', 'find_location_boundary', { location: 'Central Park, New York' }),
      'Now let me fetch a recent Sentinel-2 scene.',
      tool('tooluse_b', 'get_rasters', { bbox: [-73.98, 40.76, -73.94, 40.8] }),
      'Let me look at the true colour scene before I compute the index.',
      tool('tooluse_c', 'inspect_image', { s3_url: 's3://b/session_data/s/rasters/tci_central_park_2026-10-06.tif', title: 'Sentinel-2 true colour, Central Park, 2026-10-06' }),
      'The scene from 2026-10-06 is perfectly clear — no cloud over the park. Dense green canopy fills the park, with the Reservoir clearly visible. Now I will compute the NDVI.',
      tool('tooluse_d', 'run_bandmath', { formula: 'ndvi' }),
      '## Vegetation health\n\n| Class | Area |\n|---|---|\n| Dense | 1.9 km² |',
    ].join('');
    const saw = sawByTool(raw, { finished: true });
    expect(saw).toEqual({
      tooluse_c:
        'The scene from 2026-10-06 is perfectly clear, no cloud over the park. Dense green canopy fills the park, with the Reservoir clearly visible.',
    });
    expect(saw.tooluse_c.length).toBeLessThanOrEqual(SAW_MAX);
    expect(latestNarration(raw.slice(0, raw.indexOf('{"toolUseId": "tooluse_d"')) + '{"toolUseId": "tooluse_d", "na')).toBe(
      'Now I will compute the NDVI.'
    );
  });
});

describe('the live capture (Act 1 dev, "Vegetation, Central Park", Oct 21)', () => {
  // Trimmed from RUN/evidence/g2/central-park.sse: the tool ids, names and the prose are as streamed,
  // the tool inputs are cut down. The agent says nothing between tools except after inspect_image,
  // and that one sentence carries a raw field name in brackets.
  const S3 = 's3://bucket/session_data/d96fe0e6/rasters';
  const prefix = [
    tool('tooluse_nEbrHHTs3T0h4DqL1aglDC', 'find_address_candidates', { singleLine: 'Central Park, New York, USA' }),
    tool('tooluse_rZ6fXtbLzDUHzUKDO6NHkP', 'find_location_boundary', {}),
    tool('tooluse_HQr7Yp44gQv5satzd4IAVb', 'get_best_geometry', {}),
    tool('tooluse_JgDeQ1uX05OjuYihcgyAnw', 'display_visual', { title: 'Central Park, New York - Boundary' }),
    tool('tooluse_paPZCTmqdIPaCpOxzK56UJ', 'get_rasters', {}),
    tool('tooluse_rwjq3T1pkqnbVkeEZcmOwV', 'inspect_image', {
      s3_url: `${S3}/tci_clipped_central_park_new_york_2026-10-06.tif`,
      title: 'Sentinel-2 true colour, Central Park, 2026-10-06',
      question: 'Is the park clear? What is the vegetation condition?',
    }),
    'The scene from 2026-10-06 is perfectly clear over Central Park (aoi_cloud_pct 0%); the park reads as dense dark green with the Jacqueline Kennedy Onassis Reservoir clearly visible and early autumn foliage tones appearing in some tree clusters.',
  ].join('');
  const rest = [
    tool('tooluse_LKu9d5HwWm0rAaKTF8PdkM', 'display_visual', { title: 'Sentinel-2 True Colour – Central Park, 2026-10-06' }),
    tool('tooluse_yGPbB78IFW5h4bIblsRss4', 'run_bandmath', {}),
    tool('tooluse_jzj9DVOYhe1Y1Caf11DjqK', 'display_visual', { title: 'NDVI – Central Park, New York, 2026-10-06' }),
    '**Central Park NDVI — 2026-10-06**\n\n| Class | Area (m²) | % |\n|---|---|---|\n| Very dense vegetation (NDVI 0.7–1.0) | 2,446,900 | 71.7% |\n| **Mean NDVI** | **0.65** | — |\n\n',
    'Central Park on 2026-10-06 shows a mean NDVI of 0.65, with 80% of the park in dense or very dense vegetation — a strong, healthy canopy even as early autumn begins to shift the foliage.',
  ].join('');
  const SAW =
    'The scene from 2026-10-06 is perfectly clear over Central Park; the park reads as dense dark green with the Jacqueline Kennedy Onassis…';

  it('says nothing on stage until the inspection sentence is finished', () => {
    expect(latestNarration(prefix)).toBeNull();
    expect(sawByTool(prefix)).toEqual({});
  });

  it('prints the inspection sentence, its bracketed field name left out, once the next tool starts', () => {
    const streaming = prefix + rest.slice(0, 20);
    expect(sawByTool(streaming)).toEqual({ tooluse_rwjq3T1pkqnbVkeEZcmOwV: SAW });
    const line = latestNarration(streaming)!;
    expect(line).toBe('The scene from 2026-10-06 is perfectly clear over Central Park; the park reads as dense dark green with the Jacqueline…');
    expect(line.length).toBeLessThanOrEqual(NARRATION_MAX);
    for (const text of [line, SAW]) {
      expect(text).not.toMatch(/_|s3:|\*|\u2014/);
    }
  });

  it('keeps that sentence as the line while the answer streams, and as the Saw at the end', () => {
    expect(latestNarration(prefix + rest)).toBe(latestNarration(prefix + rest.slice(0, 20)));
    expect(sawByTool(prefix + rest, { finished: true })).toEqual({ tooluse_rwjq3T1pkqnbVkeEZcmOwV: SAW });
    expect(SAW.length).toBeLessThanOrEqual(SAW_MAX);
  });

  it('beside its chip, shows the sentence once: under the chip, not again under the lit step', () => {
    const chip = (id: string) => id === 'tooluse_rwjq3T1pkqnbVkeEZcmOwV';
    // The live runtime says nothing else between tools, so the line stays empty; the Saw stays.
    expect(latestNarration(prefix + rest.slice(0, 20), { sawShown: chip })).toBeNull();
    expect(latestNarration(prefix + rest, { sawShown: chip })).toBeNull();
    expect(sawByTool(prefix + rest, { finished: true })).toEqual({ tooluse_rwjq3T1pkqnbVkeEZcmOwV: SAW });
  });
});

describe('latestNarration beside a Saw line (no sentence twice)', () => {
  const inspect = (id: string) => tool(id, 'inspect_image', { s3_url: 's3://b/x.tif', title: 'X' });
  const BEFORE = 'I found a clear Sentinel-2 scene from 2026-10-05.';
  const SAW1 = 'The scene is clear, with no cloud over the site.';
  const SAW2 = 'The walls of the Octagon show as a ring of trees around the golf course.';
  const NEXT = "Next I'll compute the vegetation index.";
  const shown = () => true;

  it('keeps the sentence before the inspection while the Saw sentences stream', () => {
    const raw = `${BEFORE} ${inspect('i1')}${SAW1} ${SAW2} `;
    // Without a chip on the stage (Dark Vessels), the line is the latest sentence, as before.
    expect(latestNarration(`${raw}Ne`)).toBe(SAW2);
    expect(latestNarration(`${raw}Ne`, { sawShown: shown })).toBe(BEFORE);
    expect(sawByTool(`${raw}Ne`)).toEqual({ i1: `${SAW1} ${SAW2}` });
  });

  it('moves on with the next sentence that is not a Saw (the plan, the next step)', () => {
    const raw = `${BEFORE} ${inspect('i1')}${SAW1} ${SAW2} ${NEXT} ${tool('t2', 'run_bandmath')}`;
    expect(latestNarration(raw, { sawShown: shown })).toBe(NEXT);
    expect(latestNarration(`${raw}The index is on the map now. `, { sawShown: shown })).toBe(NEXT);
    expect(latestNarration(`${raw}The index is on the map now. ${tool('t3', 'display_visual')}`, { sawShown: shown })).toBe(
      'The index is on the map now.'
    );
  });

  it('shows a sentence past the Saw length, which the chip does not print', () => {
    const long = 'Dense canopy covers the north half of the site, and the golf course greens show as lighter, mown grass inside the walls.';
    const raw = `${inspect('i1')}${SAW1} ${SAW2} ${long} ${tool('t2', 'run_bandmath')}`;
    expect(sawByTool(raw, { finished: true }).i1).toBe(`${SAW1} ${SAW2}`);
    expect(latestNarration(raw, { sawShown: shown })).toBe(capWords(long, NARRATION_MAX));
  });

  it('leaves an inspection with no chip on the stage alone', () => {
    const raw = `${BEFORE} ${inspect('i1')}${SAW1} ${tool('t2', 'run_bandmath')}`;
    expect(latestNarration(raw, { sawShown: (id) => id === 'other' })).toBe(SAW1);
    expect(latestNarration(raw, { sawShown: shown })).toBe(BEFORE);
  });
});

describe('boundedSaw and withSaw', () => {
  it('holds a recorded observation to the same rules', () => {
    expect(boundedSaw('A clear scene with **dense** canopy.')).toBe('A clear scene with dense canopy.');
    expect(boundedSaw('Next I will compute the index.')).toBeNull();
    expect(boundedSaw(42)).toBeNull();
  });

  it('puts the words on the evidence items they belong to', () => {
    const items: EvidenceItem[] = [
      { toolId: 'a', title: 'A', sourceUrl: 's3://b/a.tif', evidenceUrls: [] },
      { toolId: 'b', title: 'B', sourceUrl: 's3://b/b.tif', evidenceUrls: [] },
    ];
    const out = withSaw(items, { a: 'A clear scene.' });
    expect(out[0].saw).toBe('A clear scene.');
    expect(out[1].saw).toBeUndefined();
    expect(withSaw(items, undefined)).toBe(items);
  });
});
