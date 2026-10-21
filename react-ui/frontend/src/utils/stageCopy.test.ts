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

  it('gives Dark Vessels its four turns (the golden prompts) and a placeholder about passes on file', () => {
    const copy = stageCopyFor('vessels');
    expect(copy.prompts.map((p) => p.prompt)).toEqual([
      'Who is in the reserve unseen?', 'Has a vessel gone silent near here?', 'Where should we look next?', 'Draft the patrol tasking',
    ]);
    expect(copy.prompts.every((p) => !p.fill)).toBe(true);
    expect(copy.placeholder).toBe('Ask about a radar pass over the reserve');
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
  it('puts the cloudy day second, sent as the golden prompt cloudy-scene', () => {
    const earth = stageCopyFor('dev');
    expect(earth.prompts.map((p) => p.label)).toEqual([
      'Vegetation, Central Park', 'A cloudy day, Bergen', 'Wildfire, Pacific Palisades', 'Water, Folsom Lake', 'Scan Colorado', 'Places like Central Park',
    ]);
    expect(earth.prompts[1]).toEqual({ label: 'A cloudy day, Bergen', prompt: 'Show vegetation health for Bergen, Norway as of 2025-09-15' });
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
    expect(stepName('check_ais_coverage')).toBe('Check where AIS could be heard');
    expect(stepName('match_ais')).toBe('Match targets to broadcasts');
    expect(stepName('draft_tasking')).toBe('Draft the tasking');
    expect(stepName('tasking_status')).toBe('Check the tasking');
    expect(stepName('run_change_detection')).toBe('Map the change');
    expect(stepName('some_new_tool')).toBe('some new tool');
    expect(stepName('constructor')).toBe('constructor');
  });
});
