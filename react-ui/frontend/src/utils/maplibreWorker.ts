/**
 * maplibre-gl 6 is ESM-only and resolves its Web Worker relative to `import.meta.url`
 * at runtime. Inside a Vite bundle that points at the app chunk, not the worker file, so
 * the map boots with "Worker failed to load" and never renders a tile. The documented fix
 * for Vite is to route the worker through Vite's `?worker&url` pipeline (which also
 * bundles the worker's `maplibre-gl-shared.mjs` sibling) and hand that URL to MapLibre
 * once, before any `Map` is constructed.
 *
 * Import this module from every file that creates a `maplibregl.Map`.
 */
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

setWorkerUrl(workerUrl);
