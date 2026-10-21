/**
 * The show's running order and the words the room reads for each act (S9).
 *
 * The backend lists runtimes (`GET /api/agents`): labels such as "Earth Analyst (stable)" and
 * descriptions such as "deployed from develop" describe the build, not the show. The stage owns
 * the room copy instead: each act's name, and the intro deck's slide 3 line for it, in the order
 * the acts are played. Act numbers are not printed (the running order no longer follows them).
 * Ids are never renamed: `?agent=<id>` keeps working for every runtime the switcher offers.
 *
 * Dev runtimes are offered only in rehearsal (the vite dev server, or a tab that has opened the
 * stage with `?dev=1`), under their own heading; the live site never offers them by default.
 */
import type { AgentSummary } from '../services/api.ts';

export interface ShowAct {
  /** The act's name on the switcher, the replay gallery and "How it works". */
  roomName: string;
  /** The intro deck's slide 3 line for the act, word for word. */
  line: string;
  /** The runtime ids that play this act, the one to offer first leading. */
  ids: readonly string[];
}

/** The acts in the order the show plays them. */
export const SHOW_ACTS: readonly ShowAct[] = [
  { roomName: 'Earth Analyst', line: 'Reads imagery, finds similar places', ids: ['stable', 'default', 'dev'] },
  { roomName: 'AI Archaeologist', line: 'LiDAR of known, public sites', ids: ['archaeologist'] },
  { roomName: 'Methane Watch', line: 'From satellite tip to draft brief', ids: ['methane'] },
  { roomName: 'Dark Vessels', line: 'Radar candidates, never accusations', ids: ['vessels'] },
];

/** One runtime as the stage offers it: the backend's fields plus the room's words. */
export interface StageAgent extends AgentSummary {
  /** The act's name for the room (never a runtime suffix or a deploy note). */
  roomName: string;
  /** One line under the name: the act's slide 3 line, or empty for a rehearsal runtime. */
  roomDescription: string;
  /** Listed under "Rehearsal": a second runtime of an act, or an id the show does not name. */
  rehearsalOnly: boolean;
}

/** The act a runtime id plays, if the show names it. */
export function actFor(id: string | null | undefined): ShowAct | undefined {
  if (!id) return undefined;
  return SHOW_ACTS.find((act) => act.ids.includes(id));
}

// The deployment suffixes the backend's labels carry (stageCopy.ts `stageAgentLabel`).
const DEV_SUFFIX = /\((dev|beta|test)\)\s*$/i;
const ANY_SUFFIX = /\s*\((dev|stable|beta|test)\)\s*$/i;

/** A development runtime: the Earth Analyst's `dev`, or any runtime labelled "(dev)", "(beta)" or "(test)". */
export function isDevRuntime(agent: Pick<AgentSummary, 'id' | 'label'>): boolean {
  return agent.id === 'dev' || DEV_SUFFIX.test(agent.label ?? '');
}

/** The tab's rehearsal flag: set by `?dev=1`, cleared by `?dev=0`, kept for the tab's life. */
export const REHEARSAL_KEY = 'agentic-earth.rehearsal';

type FlagStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface RehearsalInput {
  /** The vite dev server (`import.meta.env.DEV`): always a rehearsal. */
  dev: boolean;
  /** The page's query string (`window.location.search`). */
  search: string;
  /** Where the flag survives navigation inside the tab (`sessionStorage`); null when unavailable. */
  storage: FlagStore | null;
}

/**
 * Whether the stage offers dev runtimes: on the dev server, or in a tab that opened the stage with
 * `?dev=1` (a link inside the stage drops the query, so the flag is kept in the tab's storage).
 * `?dev=0` clears it. Anything else, the live site's default, is not a rehearsal.
 */
export function rehearsalMode({ dev, search, storage }: RehearsalInput): boolean {
  const flag = new URLSearchParams(search).get('dev');
  let remembered = false;
  try {
    if (flag === '1') storage?.setItem(REHEARSAL_KEY, '1');
    else if (flag === '0') storage?.removeItem(REHEARSAL_KEY);
    remembered = storage?.getItem(REHEARSAL_KEY) === '1';
  } catch {
    // Storage blocked: only this page's own `?dev=1` counts.
  }
  return dev || flag === '1' || (flag !== '0' && remembered);
}

/**
 * What the switcher offers, in show order. Outside rehearsal, dev runtimes are dropped, each act
 * takes its first offered id, and ids the show does not name are left out. In rehearsal, every
 * other runtime follows the four acts (marked `rehearsalOnly`), named for its act (or its label
 * without the runtime suffix), so it can be chosen by name and told apart by its id.
 */
export function offeredAgents(list: readonly AgentSummary[], rehearsal: boolean): StageAgent[] {
  const pool = rehearsal ? list : list.filter((agent) => !isDevRuntime(agent));
  const chosen = new Set<string>();
  const acts: StageAgent[] = [];
  for (const act of SHOW_ACTS) {
    const agent = act.ids.map((id) => pool.find((a) => a.id === id)).find((a) => a !== undefined);
    if (!agent) continue;
    chosen.add(agent.id);
    acts.push({ ...agent, roomName: act.roomName, roomDescription: act.line, rehearsalOnly: false });
  }
  if (!rehearsal) return acts;

  // The rest: each act's other runtimes in show order, then ids the show does not name.
  const rank = (id: string) => {
    const index = SHOW_ACTS.findIndex((act) => act.ids.includes(id));
    return index < 0 ? SHOW_ACTS.length : index;
  };
  const rest = pool
    .filter((agent) => !chosen.has(agent.id))
    .map((agent, order) => ({ agent, order }))
    .sort((a, b) => rank(a.agent.id) - rank(b.agent.id) || a.order - b.order)
    .map(({ agent }) => ({
      ...agent,
      roomName: actFor(agent.id)?.roomName ?? ((agent.label ?? '').replace(ANY_SUFFIX, '') || agent.id),
      roomDescription: '',
      rehearsalOnly: true,
    }));
  return [...acts, ...rest];
}
