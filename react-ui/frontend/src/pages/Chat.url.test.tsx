/**
 * The stage's URL and its replay case (Bug 5 C, S6, S3): New session and an act switch clear the
 * case, the Stage link drops a case's layers, the URL names the act, and a case that names no act
 * plays on its link's act or the default, never the act that happens to be selected.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useNavigationType } from 'react-router-dom';

interface CapturedProps {
  [key: string]: unknown;
}

const h = vi.hoisted(() => ({
  offered: [] as string[],
  defaultAgentId: null as string | null,
  initial: null as string | null,
  selectCalls: [] as string[],
  select: (() => {}) as (id: string) => void,
  sidebar: {} as Record<string, unknown>,
  map: {} as Record<string, unknown>,
  sessions: [] as string[],
  location: { pathname: '', search: '' },
  navType: '',
  navigate: (() => {}) as (to: string) => void,
}));

vi.mock('../agentContext', async () => {
  const { useCallback, useState } = await import('react');
  return {
    useAgents: () => {
      const [selectedAgentId, setSelected] = useState<string | null>(h.initial);
      const selectAgent = useCallback((id: string) => {
        h.selectCalls.push(id);
        if (h.offered.includes(id)) setSelected(id);
      }, []);
      h.select = selectAgent;
      const agents = h.offered.map((id) => ({ id, label: id, description: '' }));
      return {
        agents,
        selectedAgentId,
        selectedAgent: agents.find((a) => a.id === selectedAgentId) ?? null,
        defaultAgentId: h.defaultAgentId,
        status: 'ready',
        selectAgent,
      };
    },
  };
});

vi.mock('../components/MapView', () => ({
  MapView: (props: CapturedProps) => {
    h.map = props;
    return null;
  },
}));

vi.mock('../components/ChatSidebar', () => ({
  ChatSidebar: (props: CapturedProps) => {
    h.sidebar = props;
    const id = props.sessionId as string;
    if (h.sessions[h.sessions.length - 1] !== id) h.sessions.push(id);
    return null;
  },
}));

vi.mock('../services/api', () => {
  const empty = () => Promise.resolve({ type: 'FeatureCollection', features: [] });
  return {
    getApiUrl: () => 'http://api.test',
    loadGeometry: vi.fn(empty),
    loadMethaneBaseline: vi.fn(empty),
    loadArchaeologyRecord: vi.fn(empty),
    loadVesselRest: vi.fn(() => Promise.resolve(null)),
    prewarmSession: vi.fn(() => Promise.resolve(true)),
  };
});

import { Chat } from './Chat.tsx';
import { prewarmSession } from '../services/api';

const WARM = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';

function caseConfig(id: string, agent?: string) {
  return {
    id,
    name: id,
    description: '',
    location: '',
    narrative: '',
    dates: {},
    ...(agent ? { agent } : {}),
    assets: {
      layers: [{ s3_url: `s3://bucket/use-cases/${id}/case.geojson`, title: `${id} layer` }],
      geometry_url: `s3://bucket/use-cases/${id}/geometry.geojson`,
      before: { tci: '' },
      after: { tci: '' },
    },
  };
}

const CASES: Record<string, ReturnType<typeof caseConfig>> = {
  'methane-watch-mission': caseConfig('methane-watch-mission', 'methane'),
  'la-fires-2025': caseConfig('la-fires-2025'),
  'lake-mead-water': caseConfig('lake-mead-water'),
};

function Probe() {
  const location = useLocation();
  h.location = { pathname: location.pathname, search: location.search };
  h.navType = useNavigationType();
  h.navigate = useNavigate();
  return null;
}

function renderStage(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <Chat />
              <Probe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

const params = () => new URLSearchParams(h.location.search);

beforeEach(() => {
  h.offered = ['stable', 'dev', 'methane', 'archaeologist', 'vessels'];
  h.defaultAgentId = 'stable';
  h.initial = 'methane';
  h.selectCalls = [];
  h.sidebar = {};
  h.map = {};
  h.sessions = [];
  vi.mocked(prewarmSession).mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const id = String(url).split('/api/scenario/')[1];
      const config = CASES[id];
      return config
        ? { ok: true, status: 200, statusText: 'OK', json: async () => config }
        : { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) };
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function caseLoaded(id: string) {
  await waitFor(() => expect((h.sidebar.scenarioConfig as { id?: string } | null)?.id).toBe(id));
}

describe('New session on a replay case (D2: clear the case)', () => {
  it('drops ?scenario and ?session, names the act, and starts a fresh session', async () => {
    renderStage(`/?scenario=methane-watch-mission&agent=methane&session=${WARM}`);
    await caseLoaded('methane-watch-mission');
    const before = h.sidebar.sessionId;
    expect(before).toBe(WARM);

    await act(async () => {
      (h.sidebar.onSessionReset as () => void)();
    });

    await waitFor(() => expect(h.location.search).toBe('?agent=methane'));
    expect(h.navType).toBe('REPLACE');
    expect(h.sidebar.scenarioId).toBeUndefined();
    expect(h.sidebar.scenarioConfig).toBeNull();
    expect(h.sidebar.sessionId).not.toBe(before);
  });
});

describe('Act switch with a case on', () => {
  it('clears the case, names the new act and starts exactly one new session', async () => {
    renderStage('/?scenario=methane-watch-mission&agent=methane');
    await caseLoaded('methane-watch-mission');
    const sessionsBefore = h.sessions.length;

    await act(async () => {
      h.select('archaeologist');
    });

    await waitFor(() => expect(h.location.search).toBe('?agent=archaeologist'));
    expect(h.sidebar.scenarioId).toBeUndefined();
    expect(h.sessions.length).toBe(sessionsBefore + 1);
  });
});

describe('Leaving a case by the Stage link', () => {
  it("drops the case's layers, starts a new session and names the act", async () => {
    renderStage('/?scenario=methane-watch-mission&agent=methane');
    await caseLoaded('methane-watch-mission');
    await waitFor(() => expect((h.map.geometry as { locationName?: string } | null)?.locationName).toBe('methane-watch-mission layer'));
    const before = h.sidebar.sessionId;

    await act(async () => {
      h.navigate('/');
    });

    await waitFor(() => expect(h.location.search).toBe('?agent=methane'));
    expect(h.sidebar.sessionId).not.toBe(before);
    expect(h.sidebar.scenarioId).toBeUndefined();
    // The case's layer is gone; the act's resting baseline may take its place.
    expect((h.map.geometry as { locationName?: string } | null)?.locationName).not.toBe('methane-watch-mission layer');
    expect(h.map.rasters).toEqual([]);
  });
});

describe('The URL names the act', () => {
  it('writes ?agent= on a switch without a case, replacing the entry', async () => {
    renderStage('/?agent=methane');
    await waitFor(() => expect(h.sidebar.sessionId).toBeTruthy());

    await act(async () => {
      h.select('vessels');
    });

    await waitFor(() => expect(h.location.search).toBe('?agent=vessels'));
    expect(h.navType).toBe('REPLACE');
  });

  it('keeps both edits when a reset and the act sync write in the same tick', async () => {
    renderStage(`/?agent=methane&session=${WARM}`);
    await waitFor(() => expect(h.sidebar.sessionId).toBe(WARM));

    // The switch resets (drops ?session, names the act) and the sync names the act: one tick.
    await act(async () => {
      h.select('archaeologist');
    });

    await waitFor(() => expect(params().get('agent')).toBe('archaeologist'));
    expect(params().has('session')).toBe(false);
    expect(h.location.search).toBe('?agent=archaeologist');
  });

  it('writes the act when the stage opens with none in the URL', async () => {
    renderStage('/');
    await waitFor(() => expect(h.location.search).toBe('?agent=methane'));
  });
});

describe('A case that names no act (S3)', () => {
  it("plays on the act its link named, not the selected one", async () => {
    h.initial = 'vessels';
    renderStage('/?scenario=la-fires-2025&agent=stable');
    await caseLoaded('la-fires-2025');

    await waitFor(() => expect(h.selectCalls).toEqual(['stable']));
    await waitFor(() => expect(params().get('agent')).toBe('stable'));
    expect(params().get('scenario')).toBe('la-fires-2025');
    expect(h.sidebar.agentId).toBe('stable');
  });

  it("falls back to the backend's default act when the link names none", async () => {
    h.initial = 'vessels';
    h.defaultAgentId = 'dev';
    renderStage('/?scenario=lake-mead-water');
    await caseLoaded('lake-mead-water');

    await waitFor(() => expect(h.selectCalls).toEqual(['dev']));
    await waitFor(() => expect(h.location.search).toBe('?scenario=lake-mead-water&agent=dev'));
    expect(h.sidebar.agentId).toBe('dev');
  });

  it('keeps a case that names its own act on that act', async () => {
    h.initial = 'vessels';
    renderStage('/?scenario=methane-watch-mission&agent=stable');
    await caseLoaded('methane-watch-mission');

    await waitFor(() => expect(h.selectCalls).toEqual(['methane']));
    await waitFor(() => expect(params().get('agent')).toBe('methane'));
  });
});

describe('Prewarm (B4, S12)', () => {
  const calls = () => vi.mocked(prewarmSession).mock.calls.map(([sid, agent]) => `${agent}:${sid}`);

  it('boots one runtime per act switch, for the new session only', async () => {
    h.initial = 'stable';
    renderStage('/?agent=stable');
    await waitFor(() => expect(calls()).toHaveLength(1));
    const first = h.sidebar.sessionId as string;
    expect(calls()).toEqual([`stable:${first}`]);

    await act(async () => {
      h.select('methane');
    });
    await waitFor(() => expect(h.sidebar.sessionId).not.toBe(first));
    const second = h.sidebar.sessionId as string;
    await waitFor(() => expect(calls()).toHaveLength(2));
    expect(calls()).toEqual([`stable:${first}`, `methane:${second}`]);

    await act(async () => {
      h.select('archaeologist');
    });
    await waitFor(() => expect(h.sidebar.sessionId).not.toBe(second));
    const third = h.sidebar.sessionId as string;
    await waitFor(() => expect(calls()).toHaveLength(3));
    expect(calls()).toEqual([`stable:${first}`, `methane:${second}`, `archaeologist:${third}`]);
  });

  it("boots the case's own act on the same session when a case switches the act", async () => {
    h.initial = 'stable';
    renderStage('/?scenario=methane-watch-mission&agent=stable');
    await caseLoaded('methane-watch-mission');
    await waitFor(() => expect(h.selectCalls).toEqual(['methane']));
    const sid = h.sidebar.sessionId as string;
    await waitFor(() => expect(calls()).toContain(`methane:${sid}`));
    expect(calls()).toEqual([`stable:${sid}`, `methane:${sid}`]);
  });
});
