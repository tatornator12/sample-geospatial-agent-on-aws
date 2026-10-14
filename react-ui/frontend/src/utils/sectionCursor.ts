/**
 * The section cursor: the one spot on a transect the presenter is pointing at, shared by the
 * cross-section in the step column and the map (two components with no props between them). The
 * side that set it is recorded so each side knows whether to follow or to let go.
 */
import { useSyncExternalStore } from 'react';

export interface SectionCursor {
  siteId: string;
  /** Metres along the transect. */
  atM: number;
  from: 'section' | 'map';
}

let current: SectionCursor | null = null;
const listeners = new Set<() => void>();

export function getSectionCursor(): SectionCursor | null {
  return current;
}

export function setSectionCursor(next: SectionCursor | null): void {
  if (next === current) return;
  if (next && current && next.siteId === current.siteId && next.from === current.from && Math.abs(next.atM - current.atM) < 0.05) return;
  current = next;
  listeners.forEach((l) => l());
}

export function subscribeSectionCursor(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSectionCursor(): SectionCursor | null {
  return useSyncExternalStore(subscribeSectionCursor, getSectionCursor, getSectionCursor);
}
