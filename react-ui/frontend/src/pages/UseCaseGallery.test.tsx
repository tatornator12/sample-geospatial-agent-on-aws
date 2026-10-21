/**
 * Every available replay case opens on its own act (S3): the Earth Analyst cases name Act 1, so a
 * rehearsal that ended on another act does not play them under that act's speaker.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { UseCaseGallery } from './UseCaseGallery.tsx';

let landed = '';

function Stage() {
  const location = useLocation();
  landed = location.pathname + location.search;
  return null;
}

function open(name: string) {
  render(
    <MemoryRouter initialEntries={['/use-cases']}>
      <Routes>
        <Route path="/use-cases" element={<UseCaseGallery />} />
        <Route path="/" element={<Stage />} />
      </Routes>
    </MemoryRouter>
  );
  fireEvent.click(screen.getByRole('heading', { name }));
  return landed;
}

afterEach(() => {
  cleanup();
  landed = '';
});

describe('UseCaseGallery', () => {
  it.each([
    ['LA Palisades Fire', '/?scenario=la-fires-2025&agent=stable'],
    ['Amazon Deforestation', '/?scenario=amazon-deforestation&agent=stable'],
    ['Lake Mead Drought', '/?scenario=lake-mead-water&agent=stable'],
  ])('opens the Earth Analyst case %s on Act 1', (name, url) => {
    expect(open(name)).toBe(url);
  });

  it('prints the Act 1 figures the cases support, and none of the wrong ones (A1 P0-4)', () => {
    render(
      <MemoryRouter initialEntries={['/use-cases']}>
        <UseCaseGallery />
      </MemoryRouter>
    );
    const card = (name: string) => screen.getByRole('heading', { name }).parentElement!.textContent ?? '';
    expect(card('LA Palisades Fire')).toContain('Inside the perimeter');
    expect(card('LA Palisades Fire')).toContain('96 km² (23,700 acres)');
    expect(card('Amazon Deforestation')).toContain('Forest lost since 2020');
    expect(card('Amazon Deforestation')).toContain('8.28 km² (23.2% of field)');
    expect(card('Amazon Deforestation')).toContain('EUDR Status');
    const page = document.body.textContent ?? '';
    for (const wrong of ['21,000', '29.4%', '15.71', 'Dense Vegetation Loss', 'High Severity Burn']) {
      expect(page).not.toContain(wrong);
    }
  });

  it('still opens the other acts\u2019 cases on their own act', () => {
    expect(open('Permian Basin Methane')).toBe('/?scenario=methane-permian-2024&agent=methane');
    cleanup();
    expect(open('Methane Watch brief')).toBe('/?scenario=methane-watch-mission&agent=methane');
    cleanup();
    expect(open('Newark Earthworks')).toBe('/?scenario=archaeologist-newark&agent=archaeologist');
  });
});
