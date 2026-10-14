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

  it('gives the AI Archaeologist its three beats and a placeholder that asks for a known site (Week 5)', () => {
    const copy = stageCopyFor('archaeologist');
    expect(copy.prompts.map((p) => p.label)).toEqual(['The Octagon, from space', 'Measure the Great Circle', 'Where else, like this']);
    expect(copy.prompts.every((p) => !p.fill)).toBe(true);
    expect(copy.placeholder).toBe('Name a known site, or ask how they built it');
    expect(copy.placeholder).not.toMatch(/any place/i);
  });

  it('falls back to the Earth Analyst for dev, stable, unknown and absent ids', () => {
    const earth = stageCopyFor(undefined);
    expect(earth.prompts).toHaveLength(5);
    for (const id of ['dev', 'stable', 'nope', 'toString', '__proto__']) {
      expect(stageCopyFor(id)).toBe(earth);
    }
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
    expect(stepName('some_new_tool')).toBe('some new tool');
    expect(stepName('constructor')).toBe('constructor');
  });
});
