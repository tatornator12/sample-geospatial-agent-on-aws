/**
 * The replay gallery (S10). Every available replay case opens on its own act (S3): the Earth
 * Analyst cases name Act 1, so a rehearsal that ended on another act does not play them under
 * that act's speaker. The page is titled "Replay cases", groups the cases by act in show order,
 * opens each case from a real button, and shows the Act 3 card as the Act 3 run wrote it (the one
 * open question, available since task 9).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { UseCaseGallery } from './UseCaseGallery.tsx';

let landed = '';

function Stage() {
  const location = useLocation();
  landed = location.pathname + location.search;
  return null;
}

function renderGallery() {
  render(
    <MemoryRouter initialEntries={['/use-cases']}>
      <Routes>
        <Route path="/use-cases" element={<UseCaseGallery />} />
        <Route path="/" element={<Stage />} />
      </Routes>
    </MemoryRouter>
  );
}

function open(name: string) {
  renderGallery();
  fireEvent.click(screen.getByRole('button', { name: `Open the replay: ${name}` }));
  return landed;
}

const card = (name: string) => screen.getByRole('heading', { name, level: 3 }).closest('li') as HTMLElement;

afterEach(() => {
  cleanup();
  landed = '';
});

describe('UseCaseGallery', () => {
  it.each([
    ['LA Palisades Fire', '/?scenario=la-fires-2025&agent=stable'],
    ['Places like Central Park', '/?scenario=earth-places-like-central-park&agent=stable'],
    ['Amazon Deforestation', '/?scenario=amazon-deforestation&agent=stable'],
    ['Lake Mead Drought', '/?scenario=lake-mead-water&agent=stable'],
  ])('opens the Earth Analyst case %s on Act 1', (name, url) => {
    expect(open(name)).toBe(url);
  });

  it('prints the Act 1 figures the cases support, and none of the wrong ones (A1 P0-4)', () => {
    renderGallery();
    const text = (name: string) => card(name).textContent ?? '';
    // The re-recorded take's own figures (D9), not the perimeter's.
    expect(text('LA Palisades Fire')).toContain('46.1 km²');
    expect(text('LA Palisades Fire')).toContain('8,147.5 ha (31.9%)');
    expect(text('LA Palisades Fire')).not.toContain('23,700 acres');
    expect(text('Places like Central Park')).toContain('190,329');
    expect(text('Places like Central Park')).toContain('West Point, 0.957');
    expect(text('Amazon Deforestation')).toContain('Forest lost since 2020');
    expect(text('Amazon Deforestation')).toContain('8.28 km² (23.2% of field)');
    expect(text('Amazon Deforestation')).toContain('EUDR Status');
    const page = document.body.textContent ?? '';
    for (const wrong of ['21,000', '29.4%', '15.71', 'Dense Vegetation Loss', 'High Severity Burn']) {
      expect(page).not.toContain(wrong);
    }
  });

  it('opens the Dark Vessels case on Act 3, available, in the words that stay true across re-records (task 9, §3.8.5)', () => {
    expect(open('Dark Vessels, Galápagos: one open question')).toBe('/?scenario=vessels-open-question&agent=vessels');
    cleanup();
    renderGallery();
    const vessels = card('Dark Vessels, Galápagos: one open question');
    expect(within(vessels).getByRole('button').textContent).toBe('Open the replay');
    expect(within(vessels).queryByText('Coming soon')).toBeNull();
    const text = vessels.textContent ?? '';
    expect(text).toContain(
      'One question about the Galápagos Marine Reserve: the agent weighs the radar passes on file, checks whether AIS reception there is good enough, chooses what to check next, and drafts a patrol tasking for the officer.'
    );
    expect(text).not.toMatch(/22 on the Oct 12 pass|heard water/);
    expect(text).toContain('Agent decisions');
    expect(text).toContain('the pass, what follows a thin pass, the box');
    expect(text).toContain('Passes weighed');
    expect(text).toContain('every pass on file');
    expect(text).toContain('Candidates, never accusations.');
  });

  it('still opens the other acts\u2019 cases on their own act', () => {
    expect(open('Permian Basin Methane')).toBe('/?scenario=methane-permian-2024&agent=methane');
    cleanup();
    expect(open('Methane Watch brief')).toBe('/?scenario=methane-watch-record&agent=methane');
    cleanup();
    expect(open('Newark Earthworks')).toBe('/?scenario=archaeologist-newark&agent=archaeologist');
    cleanup();
    expect(open('The Great Circle, measured')).toBe('/?scenario=archaeologist-great-circle&agent=archaeologist');
    cleanup();
    expect(open('Sites like the Octagon, surveyed')).toBe('/?scenario=archaeologist-survey&agent=archaeologist');
  });

  it('is titled "Replay cases" and groups the cases by act in show order, with no act numbers', () => {
    renderGallery();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Replay cases');
    const acts = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(acts).toEqual(['Earth Analyst', 'AI Archaeologist', 'Methane Watch', 'Dark Vessels']);
    const cases = (act: string) =>
      within(screen.getByRole('region', { name: act }))
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent);
    expect(cases('Earth Analyst')).toEqual(['LA Palisades Fire', 'Places like Central Park', 'Amazon Deforestation', 'Lake Mead Drought']);
    expect(cases('AI Archaeologist')).toEqual(['Newark Earthworks', 'Sites like the Octagon, surveyed', 'The Great Circle, measured']);
    expect(cases('Methane Watch')).toEqual(['Permian Basin Methane', 'Methane Watch brief']);
    expect(cases('Dark Vessels')).toEqual(['Dark Vessels, Galápagos: one open question']);
    const page = document.body.textContent ?? '';
    expect(page).not.toMatch(/Featured|View Analysis|Act \d/);
  });

  it('opens every available case from one native button (Tab, Enter and Space are the browser’s own)', () => {
    renderGallery();
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(10);
    for (const button of buttons) {
      expect(button.tagName).toBe('BUTTON');
      expect(button.getAttribute('type')).toBe('button');
      expect(button.textContent).toBe('Open the replay');
      expect(button.getAttribute('aria-label')).toMatch(/^Open the replay: /);
      expect(button.hasAttribute('disabled')).toBe(false);
      expect(button.getAttribute('tabindex')).toBeNull();
    }
  });

  it('treats the case images as decoration next to their headings', () => {
    renderGallery();
    for (const image of document.querySelectorAll('.case-card__image')) {
      expect(image.getAttribute('alt')).toBe('');
    }
  });
});
