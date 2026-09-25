import { describe, expect, it } from 'vitest';
import { stageAgentLabel, stageCopyFor, stepName } from './stageCopy.ts';

describe('stageCopyFor', () => {
  it('gives the Methane Hunter its mission, its two fallback beats and its own console copy', () => {
    const copy = stageCopyFor('methane');
    expect(copy.prompts.map((p) => p.label)).toEqual([
      'Methane Watch brief', 'Find and rank Permian plumes', 'Strongest plume and the ground',
    ]);
    expect(copy.placeholder).toBe('Name a basin and a year');
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
    expect(stepName('some_new_tool')).toBe('some new tool');
    expect(stepName('constructor')).toBe('constructor');
  });
});
