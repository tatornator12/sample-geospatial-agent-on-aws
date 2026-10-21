/**
 * "How it works" (S11): one honest page in the deck's slide 4 order, the four agents in show
 * order, and none of the sample's old words or overclaims.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Technology } from './Technology.tsx';

afterEach(cleanup);

describe('Technology ("How it works")', () => {
  it('has the title and the three sections', () => {
    render(<Technology />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('How it works');
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'What each agent works with',
      'How a turn runs',
      'A person decides',
    ]);
  });

  it('names the four agents in show order, each with its data', () => {
    const { container } = render(<Technology />);
    const names = Array.from(container.querySelectorAll('dt')).map((dt) => dt.textContent);
    expect(names).toEqual(['Earth Analyst', 'AI Archaeologist', 'Methane Watch', 'Dark Vessels']);
    for (const dd of container.querySelectorAll('dd')) expect(dd.textContent?.length).toBeGreaterThan(40);
    const text = container.textContent ?? '';
    for (const source of ['Sentinel-2', 'Clay embeddings', '3DEP', 'TROPOMI', 'EMIT', 'Sentinel-1', 'AIS']) {
      expect(text).toContain(source);
    }
  });

  it('says what slide 4 says: a runtime per agent, a model choosing tools, the stage, S3, a person', () => {
    const { container } = render(<Technology />);
    const text = container.textContent ?? '';
    expect(text).toContain('Each agent runs on its own Amazon Bedrock AgentCore runtime.');
    expect(text).toContain('A foundation model reads the question, then chooses the agent');
    expect(text).toContain('shared map stage');
    expect(text).toContain('Amazon S3');
    expect(text).toContain('The analyst files the methane brief, and the officer approves the patrol tasking.');
  });

  it('has no dash, overclaim, typo or old name', () => {
    const { container } = render(<Technology />);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/[\u2014\u2013]/);
    for (const word of [/autonomous/i, /\bbest\b/i, /GeoAgent/, /Geospatial Agent on AWS/, /reponses/, /workflowdata/]) {
      expect(text).not.toMatch(word);
    }
    // British spelling where it differs.
    expect(text).not.toMatch(/\bcolor\b|analyze|recognize/i);
    expect(container.querySelector('[aria-expanded]')).toBeNull();
  });
});
