/**
 * Which agent the presenter is talking to.
 *
 * The exhibit rail shows the acts (one per AgentCore runtime) and the stage sends every prompt
 * to the selected one. The list comes from the backend (`GET /api/agents`), the choice is kept
 * in localStorage so a refresh between rehearsals lands on the same act, and a stored id that
 * no longer exists falls back to the backend's default.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { listAgents, type AgentSummary } from './services/api';

const STORAGE_KEY = 'agentic-earth.agent';

type AgentStatus = 'loading' | 'ready' | 'error';

interface AgentContextValue {
  agents: AgentSummary[];
  /** Null until the list has loaded; after that always one of `agents`, or null if the list is empty. */
  selectedAgentId: string | null;
  selectedAgent: AgentSummary | null;
  status: AgentStatus;
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

export function AgentProvider({ children }: { children: ReactNode }) {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [status, setStatus] = useState<AgentStatus>('loading');

  useEffect(() => {
    let cancelled = false;
    listAgents()
      .then(({ agents: list, defaultAgentId }) => {
        if (cancelled) return;
        setAgents(list);
        // `?agent=<id>` (printed by scripts/prewarm.py) wins over the remembered choice, so a
        // pre-warmed session is opened on the agent that was warmed.
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
  }, []);

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
      status,
      selectAgent,
    }),
    [agents, selectedAgentId, status, selectAgent]
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
