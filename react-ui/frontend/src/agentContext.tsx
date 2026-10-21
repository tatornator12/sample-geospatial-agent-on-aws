/**
 * Which agent the presenter is talking to.
 *
 * The exhibit rail shows the acts (one per AgentCore runtime) and the stage sends every prompt
 * to the selected one. The list comes from the backend (`GET /api/agents`) and is offered in show
 * order with the room's names (utils/acts.ts); dev runtimes only in rehearsal. The choice is kept
 * in localStorage so a refresh between rehearsals lands on the same act, and a stored id that is
 * not offered falls back to the backend's default.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { listAgents } from './services/api';
import { offeredAgents, rehearsalMode, type StageAgent } from './utils/acts';

const STORAGE_KEY = 'agentic-earth.agent';

type AgentStatus = 'loading' | 'ready' | 'error';

interface AgentContextValue {
  /** The runtimes the switcher offers, in show order (rehearsal runtimes last). */
  agents: StageAgent[];
  /** Null until the list has loaded; after that always one of `agents`, or null if the list is empty. */
  selectedAgentId: string | null;
  selectedAgent: StageAgent | null;
  /** The backend's default act (`GET /api/agents`), or null before the list loads or if it has none. */
  defaultAgentId: string | null;
  status: AgentStatus;
  /** The dev server or `?dev=1`: dev runtimes are offered too. */
  rehearsal: boolean;
  selectAgent: (id: string) => void;
}

const AgentContext = createContext<AgentContextValue | null>(null);

function readStoredAgentId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeAgentId(id: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Private mode or a full store: the choice simply does not survive a refresh.
  }
}

function readRehearsal(): boolean {
  let storage: Storage | null = null;
  try {
    storage = window.sessionStorage;
  } catch {
    storage = null;
  }
  return rehearsalMode({ dev: import.meta.env.DEV, search: window.location.search, storage });
}

export function AgentProvider({ children }: { children: ReactNode }) {
  const [agents, setAgents] = useState<StageAgent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [backendDefault, setBackendDefault] = useState<string | null>(null);
  const [status, setStatus] = useState<AgentStatus>('loading');
  const [rehearsal] = useState(readRehearsal);

  useEffect(() => {
    let cancelled = false;
    listAgents()
      .then(({ agents: runtimes, defaultAgentId }) => {
        if (cancelled) return;
        const list = offeredAgents(runtimes, rehearsal);
        setAgents(list);
        setBackendDefault(defaultAgentId);
        // `?agent=<id>` (printed by scripts/prewarm.py) wins over the remembered choice, so a
        // pre-warmed session is opened on the agent that was warmed. The stage keeps `?agent=`
        // on the act it shows (pages/Chat.tsx), so a refresh lands on that act too. An id the
        // switcher does not offer (a dev runtime on the live site) falls through to the default.
        const fromUrl = new URLSearchParams(window.location.search).get('agent');
        const stored = readStoredAgentId();
        const initial =
          (fromUrl && list.some((a) => a.id === fromUrl) && fromUrl) ||
          (stored && list.some((a) => a.id === stored) && stored) ||
          (defaultAgentId && list.some((a) => a.id === defaultAgentId) && defaultAgentId) ||
          list[0]?.id ||
          null;
        if (initial) storeAgentId(initial);
        setSelectedAgentId(initial);
        setStatus('ready');
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Could not load the agent list; prompts will use the backend default.', error);
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [rehearsal]);

  const selectAgent = useCallback(
    (id: string) => {
      if (!agents.some((a) => a.id === id)) return;
      storeAgentId(id);
      setSelectedAgentId((current) => (current === id ? current : id));
    },
    [agents]
  );

  const value = useMemo<AgentContextValue>(
    () => ({
      agents,
      selectedAgentId,
      selectedAgent: agents.find((a) => a.id === selectedAgentId) ?? null,
      defaultAgentId: backendDefault,
      status,
      rehearsal,
      selectAgent,
    }),
    [agents, selectedAgentId, backendDefault, status, rehearsal, selectAgent]
  );

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

export function useAgents(): AgentContextValue {
  const value = useContext(AgentContext);
  if (!value) {
    throw new Error('useAgents must be used inside <AgentProvider>');
  }
  return value;
}
