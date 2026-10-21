/**
 * "Saw: …" under an evidence chip sits beside the button, not in its accessible name; the plate
 * labels the question "Asked:" only when the agent's words are there to tell it apart from.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { EvidenceItem } from '../utils/evidence.ts';

vi.mock('../services/api.ts', () => ({
  getPresignedUrl: vi.fn().mockResolvedValue(null),
}));

import { EvidenceChip } from './EvidenceChip.tsx';
import { EvidencePlate } from './EvidencePlate.tsx';

afterEach(cleanup);

const ITEM: EvidenceItem = {
  toolId: 'i1',
  title: 'Newark Octagon, Sentinel-2 true colour',
  question: 'What is visible from space?',
  sourceUrl: 's3://b/use-cases/archaeologist-newark/tci_clipped_newark_octagon_2026-10-05.tif',
  evidenceUrls: ['s3://b/use-cases/archaeologist-newark/inspections/tci_clipped_newark_octagon_2026-10-05.jpg'],
};

describe('EvidenceChip', () => {
  it('prints what the agent saw outside the button', () => {
    render(<EvidenceChip item={{ ...ITEM, saw: 'The walls show as a ring of trees.' }} onOpen={() => {}} />);
    const saw = document.querySelector('.evidence-chip__saw') as HTMLElement;
    expect(saw.textContent).toBe('Saw: The walls show as a ring of trees.');
    const button = screen.getByRole('button');
    expect(button.contains(saw)).toBe(false);
    expect(button.getAttribute('aria-label')).not.toMatch(/Saw/);
    expect(button.textContent).not.toMatch(/Saw/);
  });

  it('prints nothing more without it', () => {
    render(<EvidenceChip item={ITEM} onOpen={() => {}} />);
    expect(document.querySelector('.evidence-chip__saw')).toBeNull();
  });
});

describe('EvidencePlate', () => {
  it('reads "Asked:" then "Saw:" when the agent said what it saw', () => {
    render(<EvidencePlate item={{ ...ITEM, saw: 'The walls show as a ring of trees.' }} imageUrl="data:," onClose={() => {}} />);
    const question = document.querySelector('.evidence-plate__question') as HTMLElement;
    const saw = document.querySelector('.evidence-plate__saw') as HTMLElement;
    expect(question.textContent).toBe('Asked: What is visible from space?');
    expect(saw.textContent).toBe('Saw: The walls show as a ring of trees.');
    expect(question.compareDocumentPosition(saw) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('img').getAttribute('alt')).toBe(ITEM.title);
  });

  it('keeps the question (or a filmstrip reason) on its own, unlabelled, without it', () => {
    render(<EvidencePlate item={{ ...ITEM, question: '2 candidates, peak 2,828.3 ppm·m' }} imageUrl="data:," onClose={() => {}} />);
    expect((document.querySelector('.evidence-plate__question') as HTMLElement).textContent).toBe('2 candidates, peak 2,828.3 ppm·m');
    expect(screen.queryByText(/Asked:/)).toBeNull();
    expect(document.querySelector('.evidence-plate__saw')).toBeNull();
  });
});
