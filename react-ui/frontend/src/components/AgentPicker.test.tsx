/**
 * The switcher on the rail (S9), through the real AgentProvider: the acts in show order with the
 * room's names, dev runtimes only in rehearsal (under "Rehearsal", with the id in mono), and the
 * listbox keyboard unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../services/api', () => ({ listAgents: vi.fn() }));

import { listAgents } from '../services/api';
import { AgentProvider, useAgents } from '../agentContext';
import { AgentPicker } from './AgentPicker';

const LIVE = {
  defaultAgentId: 'stable',
  agents: [
    { id: 'stable', label: 'Earth Analyst (stable)', description: 'Live demo runtime, deployed from demo-stable' },
    { id: 'dev', label: 'Earth Analyst (dev)', description: 'Development runtime, deployed from develop' },
    { id: 'methane', label: 'Methane Hunter', description: 'EMIT methane plumes, deployed from demo-stable' },
    { id: 'archaeologist', label: 'AI Archaeologist', description: 'Known earthworks in 1 m LiDAR, deployed from demo-stable' },
    { id: 'vessels', label: 'Dark Vessels', description: 'Radar targets with no AIS, deployed from demo-stable' },
  ],
};

const RUNTIME_WORDS = /\((dev|stable)\)|deployed|runtime|Act \d/i;

let selected: string | null = null;
function Selected() {
  selected = useAgents().selectedAgentId;
  return null;
}

async function openPicker(url: string) {
  window.history.replaceState({}, '', url);
  render(
    <AgentProvider>
      <AgentPicker />
      <Selected />
    </AgentProvider>
  );
  const trigger = await screen.findByRole('button', { name: /Agent/ });
  await act(async () => {
    fireEvent.click(trigger);
  });
  return { trigger, list: screen.getByRole('listbox') };
}

const optionNames = () => screen.getAllByRole('option').map((o) => o.querySelector('span')?.textContent ?? '');

beforeEach(() => {
  vi.mocked(listAgents).mockReset().mockResolvedValue(LIVE);
  window.localStorage.clear();
  window.sessionStorage.clear();
  selected = null;
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  window.history.replaceState({}, '', '/');
});

describe('AgentPicker on the live site', () => {
  beforeEach(() => vi.stubEnv('DEV', false));

  it('lists the four acts in show order, by the room names, with the deck lines', async () => {
    const { trigger } = await openPicker('/?agent=stable');
    expect(trigger.textContent).toBe('AgentEarth Analyst');
    expect(optionNames()).toEqual(['Earth Analyst', 'AI Archaeologist', 'Methane Watch', 'Dark Vessels']);
    expect(screen.getAllByRole('option')[0].textContent).toBe('Earth AnalystReads imagery, finds similar places');
    expect(screen.queryByText('Rehearsal')).toBeNull();
  });

  it('prints no runtime word, deploy note or act number', async () => {
    await openPicker('/?agent=stable');
    for (const option of screen.getAllByRole('option')) {
      expect(option.textContent).not.toMatch(RUNTIME_WORDS);
    }
  });

  it('lands a link to the dev runtime on the backend default', async () => {
    window.history.replaceState({}, '', '/?agent=dev');
    render(
      <AgentProvider>
        <AgentPicker />
        <Selected />
      </AgentProvider>
    );
    await screen.findByRole('button', { name: /Agent/ });
    expect(selected).toBe('stable');
  });

  it('keeps the keyboard: arrows, Home, End, Enter and Escape', async () => {
    const { trigger, list } = await openPicker('/?agent=stable');
    const active = () => list.getAttribute('aria-activedescendant') ?? '';
    expect(active()).toMatch(/-stable$/);
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(active()).toMatch(/-archaeologist$/);
    fireEvent.keyDown(list, { key: 'End' });
    expect(active()).toMatch(/-vessels$/);
    fireEvent.keyDown(list, { key: 'Home' });
    expect(active()).toMatch(/-stable$/);
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    await act(async () => {
      fireEvent.keyDown(list, { key: 'Enter' });
    });
    expect(selected).toBe('methane');
    expect(trigger.textContent).toBe('AgentMethane Watch');
    expect(screen.queryByRole('listbox')).toBeNull();

    await act(async () => {
      fireEvent.click(trigger);
    });
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(selected).toBe('methane');
  });
});

describe('AgentPicker in rehearsal', () => {
  it('with ?dev=1 offers the dev runtime under "Rehearsal", named for its act with its id', async () => {
    vi.stubEnv('DEV', false);
    const { list } = await openPicker('/?agent=stable&dev=1');
    const heading = screen.getByText('Rehearsal');
    expect(heading.getAttribute('role')).toBe('presentation');
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      'Earth AnalystReads imagery, finds similar places',
      'AI ArchaeologistLiDAR of known, public sites',
      'Methane WatchFrom satellite tip to draft brief',
      'Dark VesselsRadar candidates, never accusations',
      'Earth Analyst· dev',
    ]);
    expect(options[4].querySelector('.mono')?.textContent).toBe('· dev');
    // The heading is not an option: End lands on the dev runtime, and Enter chooses it.
    fireEvent.keyDown(list, { key: 'End' });
    await act(async () => {
      fireEvent.keyDown(list, { key: 'Enter' });
    });
    expect(selected).toBe('dev');
    expect(screen.getByRole('button', { name: /Agent/ }).textContent).toBe('AgentEarth Analyst· dev');
  });

  it('is on under the dev server without any flag', async () => {
    vi.stubEnv('DEV', true);
    await openPicker('/?agent=stable');
    expect(screen.getByText('Rehearsal')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(5));
  });
});
