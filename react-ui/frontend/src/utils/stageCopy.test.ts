import { describe, expect, it } from 'vitest';
import { stageAgentLabel, stageCopyFor, stepName } from './stageCopy.ts';

describe('stageCopyFor', () => {
  it('gives the Methane Hunter its mission, its two fallback beats and its own console copy', () => {
    const copy = stageCopyFor('methane');
    expect(copy.prompts.map((p) => p.label)).toEqual([
      'Methane Watch brief', 'Find and rank plumes over…', 'Strongest plume ever, and the ground',
    ]);
    // The rank plate is finished by the presenter (any region), so it fills the console instead of sending.
    expect(copy.prompts[1].fill).toBe(true);
    expect(copy.prompts[1].prompt.endsWith(' over ')).toBe(true);
    expect(copy.prompts[0].fill).toBeUndefined();
    expect(copy.placeholder).toBe('Ask for a Methane Watch brief, or name a region and a year');
  });

  it('asks the mission plate for recurrence, never "still active" or "super-emitters" (stage review D8)', () => {
    // The golden prompt watch-mission and build_replay_case.py's watch preset, word for word.
    const mission = stageCopyFor('methane').prompts[0].prompt;
    expect(mission).toBe('Brief me on the watch areas where methane keeps showing up, and how confident you are.');
    expect(mission).not.toMatch(/still active|super-emitter/i);
  });

  it('asks for the brief without "still active" or "super-emitters", and keeps the mission words (A2 P0-2)', () => {
    const copy = stageCopyFor('methane');
    for (const p of copy.prompts) {
      expect(p.prompt).not.toMatch(/still active/i);
      expect(p.prompt).not.toMatch(/super-emitters/i);
    }
    const brief = copy.prompts[0];
    expect(brief.label).toBe('Methane Watch brief');
    expect(brief.prompt).toBe('Brief me on the watch areas where methane keeps showing up, and how confident you are.');
    // The trigger words the agent's prompt routes the mission on (methane_config.py).
    for (const words of ['Brief me', 'watch areas', 'how confident']) expect(brief.prompt).toContain(words);
  });

  it('gives the AI Archaeologist its four plates and a placeholder that asks for a known site (Week 5)', () => {
    const copy = stageCopyFor('archaeologist');
    expect(copy.prompts.map((p) => p.label)).toEqual(['The Octagon, from space', 'Measure an Octagon wall', 'Measure the Great Circle', 'Where else, like this']);
    expect(copy.prompts.every((p) => !p.fill)).toBe(true);
    expect(copy.placeholder).toBe('Name a known site, or ask how they built it');
    expect(copy.placeholder).not.toMatch(/any place/i);
  });

  it('asks the measure plates what the LiDAR can answer, never how it was built (stage review D10)', () => {
    // The golden prompts octagon-wall-measure and great-circle-measure, word for word.
    const [, octagon, circle] = stageCopyFor('archaeologist').prompts;
    expect(octagon.prompt).toBe('Measure across a wall of the Newark Octagon, on a line you choose from the local relief.');
    expect(circle.prompt).toBe('Measure the Great Circle: how wide is it, how high is the bank, how deep is the ditch?');
    for (const p of [octagon, circle]) expect(p.prompt).not.toMatch(/built|build/i);
  });

  it('gives Dark Vessels one question and the spare plate (the golden prompts) and a placeholder about passes on file', () => {
    const copy = stageCopyFor('vessels');
    // open-question and thin-pass (agents/dark-vessels/golden_prompts.json), word for word.
    expect(copy.prompts.map((p) => p.prompt)).toEqual([
      'Is anyone in the reserve without broadcasting, and where should the patrol look next?',
      'Is anyone in the reserve without broadcasting at the end of August, and where should the patrol look next?',
    ]);
    expect(copy.prompts.map((p) => p.label)).toEqual(['Who is there without broadcasting, and where next?', 'Same question, end of August']);
    expect(copy.prompts.every((p) => !p.fill)).toBe(true);
    // No "fishing" (it presumes an activity the evidence cannot show), no em dash.
    for (const p of copy.prompts) expect(`${p.label} ${p.prompt}`).not.toMatch(/fishing|\u2014/i);
    expect(copy.placeholder).toBe('Ask about the reserve, or a radar pass on file');
    expect(copy.placeholder).not.toMatch(/live/i);
  });

  it('falls back to the Earth Analyst for dev, stable, unknown and absent ids', () => {
    const earth = stageCopyFor(undefined);
    expect(earth.prompts).toHaveLength(6);
    for (const id of ['dev', 'stable', 'nope', 'toString', '__proto__']) {
      expect(stageCopyFor(id)).toBe(earth);
    }
  });
});

describe('the Earth Analyst plates', () => {
  it('lists the plates in the order clicked on stage: Bergen, then Places like Central Park, then the spares (B0)', () => {
    const earth = stageCopyFor('dev');
    expect(earth.prompts.map((p) => p.label)).toEqual([
      'A cloudy day, Bergen', 'Places like Central Park', 'Vegetation, Central Park', 'Water, Folsom Lake', 'Scan Colorado', 'Wildfire, Pacific Palisades',
    ]);
  });

  it('keeps every prompt word for word (the golden prompts and the notes quote them)', () => {
    const byLabel = Object.fromEntries(stageCopyFor('dev').prompts.map((p) => [p.label, p.prompt]));
    expect(byLabel).toEqual({
      'A cloudy day, Bergen': 'Show vegetation health for Bergen, Norway as of 2025-09-15',
      'Places like Central Park': 'Find places across New York State that look like Central Park',
      'Vegetation, Central Park': 'Show vegetation health for Central Park, New York',
      'Water, Folsom Lake': 'Compare water levels for Folsom Lake, California 2021 vs 2022',
      'Scan Colorado': 'Scan Colorado for land change between 2019 and 2024',
      'Wildfire, Pacific Palisades': 'Assess wildfire damage near Pacific Palisades, Los Angeles in January 2025',
    });
    expect(stageCopyFor('dev').prompts.every((p) => !p.fill)).toBe(true);
  });
});

describe('stageAgentLabel', () => {
  it('drops the deployment suffix the room does not need', () => {
    expect(stageAgentLabel('Methane Hunter (dev)')).toBe('Methane Hunter');
    expect(stageAgentLabel('Earth Analyst (stable)')).toBe('Earth Analyst');
    expect(stageAgentLabel('Earth Analyst')).toBe('Earth Analyst');
    expect(stageAgentLabel(undefined)).toBeUndefined();
  });
});

describe('stepName', () => {
  it('names what the agent is doing, and falls back to the spaced tool name', () => {
    expect(stepName('create_bbox_from_coordinates')).toBe('Frame the ground');
    expect(stepName('triage_plumes')).toBe('Rank by methane');
    expect(stepName('find_known_site')).toBe('Look up the public record');
    expect(stepName('show_terrain')).toBe('Show the 1 m LiDAR');
    expect(stepName('measure_profile')).toBe('Measure across the earthwork');
    expect(stepName('find_similar_sites')).toBe('Find sites of the same form');
    expect(stepName('check_ais_coverage')).toBe('Check where AIS was received');
    expect(stepName('list_passes')).toBe('Weigh the passes on file');
    expect(stepName('match_ais')).toBe('Match targets to broadcasts');
    expect(stepName('draft_tasking')).toBe('Draft the tasking');
    expect(stepName('tasking_status')).toBe('Check the tasking');
    expect(stepName('run_change_detection')).toBe('Map the change');
    expect(stepName('some_new_tool')).toBe('some new tool');
    expect(stepName('constructor')).toBe('constructor');
  });
});
