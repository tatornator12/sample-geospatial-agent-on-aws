/**
 * The switcher's acts (S9): show order, the room's names and lines, dev runtimes only in
 * rehearsal, ids unchanged.
 */
import { describe, expect, it } from 'vitest';
import type { AgentSummary } from '../services/api.ts';
import { REHEARSAL_KEY, SHOW_ACTS, actFor, isDevRuntime, offeredAgents, rehearsalMode } from './acts.ts';

// The live site's list (backend AGENT_RUNTIMES, in its own order: Act 4 before Act 3).
const LIVE: AgentSummary[] = [
  { id: 'stable', label: 'Earth Analyst (stable)', description: 'Live demo runtime, deployed from demo-stable' },
  { id: 'dev', label: 'Earth Analyst (dev)', description: 'Development runtime, deployed from develop' },
  { id: 'methane', label: 'Methane Hunter', description: 'EMIT methane plumes, deployed from demo-stable' },
  { id: 'archaeologist', label: 'AI Archaeologist', description: 'Known earthworks in 1 m LiDAR, deployed from demo-stable' },
  { id: 'vessels', label: 'Dark Vessels', description: 'Radar targets with no AIS, deployed from demo-stable' },
];

// A local backend: every act but the Earth Analyst's stable runtime is a dev runtime.
const LOCAL: AgentSummary[] = [
  { id: 'stable', label: 'Earth Analyst (stable)', description: 'Live demo runtime, deployed from demo-stable' },
  { id: 'dev', label: 'Earth Analyst (dev)', description: 'Development runtime, deployed from develop' },
  { id: 'methane', label: 'Methane Hunter (dev)', description: 'EMIT methane plumes, deployed from develop' },
  { id: 'archaeologist', label: 'AI Archaeologist (dev)', description: 'Known earthworks on the public record' },
  { id: 'vessels', label: 'Dark Vessels (dev)', description: 'Radar passes, deployed from develop' },
];

const RUNTIME_WORDS = /\((dev|stable)\)|deployed|runtime|Act \d/i;

function memoryStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    data,
  };
}

describe('offeredAgents', () => {
  it('lists the live acts in show order with the room names and the deck lines', () => {
    const offered = offeredAgents(LIVE, false);
    expect(offered.map((a) => a.id)).toEqual(['stable', 'archaeologist', 'methane', 'vessels']);
    expect(offered.map((a) => a.roomName)).toEqual(['Earth Analyst', 'AI Archaeologist', 'Methane Watch', 'Dark Vessels']);
    expect(offered.map((a) => a.roomDescription)).toEqual([
      'Reads imagery, finds similar places',
      'LiDAR of known, public sites',
      'From satellite tip to draft brief',
      'Radar candidates, never accusations',
    ]);
    expect(offered.every((a) => !a.rehearsalOnly)).toBe(true);
  });

  it('keeps the backend label for the speaker and never renames an id', () => {
    const methane = offeredAgents(LIVE, false).find((a) => a.id === 'methane');
    expect(methane?.label).toBe('Methane Hunter');
    expect(offeredAgents(LIVE, true).map((a) => a.id).sort()).toEqual(LIVE.map((a) => a.id).sort());
  });

  it('hides the dev runtime outside rehearsal and lists it after the acts in rehearsal', () => {
    expect(offeredAgents(LIVE, false).some((a) => a.id === 'dev')).toBe(false);
    const rehearsal = offeredAgents(LIVE, true);
    expect(rehearsal.map((a) => a.id)).toEqual(['stable', 'archaeologist', 'methane', 'vessels', 'dev']);
    expect(rehearsal[4]).toMatchObject({ id: 'dev', roomName: 'Earth Analyst', roomDescription: '', rehearsalOnly: true });
  });

  it('on a local backend offers every act in rehearsal, and only the stable runtime without it', () => {
    expect(offeredAgents(LOCAL, false).map((a) => a.id)).toEqual(['stable']);
    const rehearsal = offeredAgents(LOCAL, true);
    expect(rehearsal.filter((a) => !a.rehearsalOnly).map((a) => a.roomName)).toEqual([
      'Earth Analyst',
      'AI Archaeologist',
      'Methane Watch',
      'Dark Vessels',
    ]);
    expect(rehearsal.filter((a) => a.rehearsalOnly).map((a) => a.id)).toEqual(['dev']);
  });

  it('prints no runtime word, deploy note or act number in either mode', () => {
    for (const list of [LIVE, LOCAL]) {
      for (const rehearsal of [false, true]) {
        for (const agent of offeredAgents(list, rehearsal)) {
          expect(`${agent.roomName} ${agent.roomDescription}`).not.toMatch(RUNTIME_WORDS);
        }
      }
    }
  });

  it('plays the Earth Analyst on a dev runtime in rehearsal when it is the only one', () => {
    const devOnly = LOCAL.filter((a) => a.id !== 'stable');
    expect(offeredAgents(devOnly, true)[0]).toMatchObject({ id: 'dev', roomName: 'Earth Analyst', rehearsalOnly: false });
    expect(offeredAgents(devOnly, false)).toEqual([]);
  });

  it('offers a single-runtime backend as the Earth Analyst', () => {
    const single = [{ id: 'default', label: 'Earth Analyst', description: '' }];
    expect(offeredAgents(single, false)).toMatchObject([{ id: 'default', roomName: 'Earth Analyst' }]);
  });

  it('offers an id the show does not name only in rehearsal, by its label without the suffix', () => {
    const extra = [...LIVE, { id: 'groundmotion', label: 'Ground Motion (stable)', description: 'deployed from develop' }];
    expect(offeredAgents(extra, false).some((a) => a.id === 'groundmotion')).toBe(false);
    const last = offeredAgents(extra, true).at(-1);
    expect(last).toMatchObject({ id: 'groundmotion', roomName: 'Ground Motion', roomDescription: '', rehearsalOnly: true });
  });
});

describe('isDevRuntime', () => {
  it('is the dev id or a dev, beta or test label', () => {
    expect(isDevRuntime({ id: 'dev', label: 'Earth Analyst' })).toBe(true);
    expect(isDevRuntime({ id: 'methane', label: 'Methane Hunter (dev)' })).toBe(true);
    expect(isDevRuntime({ id: 'x', label: 'X (Beta)' })).toBe(true);
    expect(isDevRuntime({ id: 'x', label: 'X (test)' })).toBe(true);
    expect(isDevRuntime({ id: 'stable', label: 'Earth Analyst (stable)' })).toBe(false);
    expect(isDevRuntime({ id: 'methane', label: 'Methane Hunter' })).toBe(false);
  });
});

describe('rehearsalMode', () => {
  it('is always on under the dev server', () => {
    expect(rehearsalMode({ dev: true, search: '', storage: null })).toBe(true);
  });

  it('is off on the live site by default', () => {
    expect(rehearsalMode({ dev: false, search: '?agent=stable', storage: memoryStorage() })).toBe(false);
  });

  it('turns on with ?dev=1 and stays on for the tab', () => {
    const storage = memoryStorage();
    expect(rehearsalMode({ dev: false, search: '?agent=stable&dev=1', storage })).toBe(true);
    expect(storage.data.get(REHEARSAL_KEY)).toBe('1');
    expect(rehearsalMode({ dev: false, search: '?scenario=la-fires-2025&agent=stable', storage })).toBe(true);
  });

  it('turns off with ?dev=0', () => {
    const storage = memoryStorage({ [REHEARSAL_KEY]: '1' });
    expect(rehearsalMode({ dev: false, search: '?dev=0', storage })).toBe(false);
    expect(storage.data.has(REHEARSAL_KEY)).toBe(false);
    expect(rehearsalMode({ dev: false, search: '', storage })).toBe(false);
  });

  it('counts only the page’s own flag when storage is blocked', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(rehearsalMode({ dev: false, search: '?dev=1', storage: blocked })).toBe(true);
    expect(rehearsalMode({ dev: false, search: '', storage: blocked })).toBe(false);
  });
});

describe('actFor', () => {
  it('maps every runtime id of an act to that act', () => {
    expect(actFor('stable')?.roomName).toBe('Earth Analyst');
    expect(actFor('dev')?.roomName).toBe('Earth Analyst');
    expect(actFor('methane')?.roomName).toBe('Methane Watch');
    expect(actFor('vessels')).toBe(SHOW_ACTS[3]);
    expect(actFor('nope')).toBeUndefined();
    expect(actFor(undefined)).toBeUndefined();
  });
});
