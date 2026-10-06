/**
 * The stage's files: small JSON manifests the Methane Watch tools write beside their layers
 * (tips, passes), read through the backend's allowlisted geometry route and parsed by a validator
 * the caller supplies. A file that is not there yet (the tool is still running) is retried every
 * 2 s for up to 45 s, then given up quietly. Nothing here blocks the step column or the map.
 */
import { useEffect, useRef, useState } from 'react';
import { loadGeometry } from '../services/api.ts';

const RETRY_MS = 2000;
const GIVE_UP_MS = 45_000;

/**
 * Loads each URL once for the life of the component (a URL that joins the list while others are
 * still loading starts its own attempt; the others keep going) and returns the parsed values by
 * URL. `parse` returns null for a file that is not (yet) what we expect.
 */
export function useStageFiles<T>(urls: string[], parse: (raw: unknown, url: string) => T | null): Record<string, T> {
  const [loaded, setLoaded] = useState<Record<string, T>>({});
  const loadedRef = useRef<Record<string, T>>({});
  const inFlight = useRef(new Set<string>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const mounted = useRef(true);
  const parseRef = useRef(parse);
  parseRef.current = parse;
  const key = urls.join('\n');

  useEffect(() => {
    const pending = inFlight.current;
    const live = timers.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      live.forEach(clearTimeout);
      live.clear();
      pending.clear();
    };
  }, []);

  useEffect(() => {
    const wanted = key ? key.split('\n') : [];
    for (const url of wanted) {
      if (!url || inFlight.current.has(url) || loadedRef.current[url]) continue;
      inFlight.current.add(url);
      const started = Date.now();
      const attempt = async () => {
        const raw = await loadGeometry(url);
        if (!mounted.current) return;
        const value = raw ? parseRef.current(raw, url) : null;
        if (value !== null) {
          loadedRef.current = { ...loadedRef.current, [url]: value };
          setLoaded(loadedRef.current);
        } else if (Date.now() - started < GIVE_UP_MS) {
          const t = setTimeout(() => { timers.current.delete(t); void attempt(); }, RETRY_MS);
          timers.current.add(t);
        } else {
          inFlight.current.delete(url);   // a later render may try again
        }
      };
      void attempt();
    }
  }, [key]);

  return loaded;
}
