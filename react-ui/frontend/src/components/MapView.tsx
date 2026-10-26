import { useEffect, useId, useLayoutEffect, useRef, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../utils/maplibreWorker.ts';
import MapboxDraw from 'maplibre-gl-draw';
import 'maplibre-gl-draw/dist/mapbox-gl-draw.css';
import { getPresignedUrl, type TaskingState } from '../services/api.ts';
import type { FeatureCollection } from 'geojson';
import type { GeometryData, RasterData } from '../types.ts';
import { TITILER_URL, TITILER_API_KEY, TERRAIN_TILES_URL } from '../config.ts';
import {
  boundsWithin,
  clickedMatch,
  findComparePair,
  groupLayers,
  isMethaneLayer,
  isSimilarityLayer,
  layerRowLabel,
  type LayerMetadata,
} from '../utils/layerFormatting';
import { indexLegendFor, rampExpression, rampGradient, tileParamsFor, type RenderHint } from '../utils/render.ts';
import {
  CARBON_MAPPER_SOURCE,
  COLUMN_METRES_PER_PPM_M,
  DETECTIONS_COLOUR,
  DETECTIONS_ROW,
  METHANE_RASTER,
  barLanding,
  compositeLandsHidden,
  isBarLayer,
  detectionPopupHtml,
  footprintFrame,
  isTropomiComposite,
  globeCentre,
  labelPointOutside,
  isoDay,
  methaneGeometryHint,
  methaneRasterHint,
  tickChanges,
  TROPOMI_RAMP,
} from '../utils/methaneLayers.ts';
import {
  insertInStack,
  layerLegend,
  outOfRange,
  stackCeiling,
  stackLegends,
  stackMoves,
  type StackLegend,
  type StackPlace,
} from '../utils/layerStack.ts';
import { barKind, type BarKind, type Follow } from '../utils/follow.ts';
import {
  FRAME_MAX_ZOOM,
  GROUND_BEARING,
  GROUND_PITCH,
  MARKS_MAX_ZOOM,
  RELIEF_EXAGGERATION,
  TRANSECT_MAX_ZOOM,
  isTerrainLayer,
  marksBounds,
  recordLabels,
  companionDem,
  signedMetres,
  reliefSite,
  siteWindow,
  siteWindowShare,
  terrainGeometryHint,
  terrainRasterHint,
  transectParts,
  LIGHT_ALTITUDE,
  LIGHT_AZIMUTH,
  LIGHT_EXAGGERATION,
  LIGHT_SWEEP_MS,
  MAX_PITCH,
  NO_SKY,
  PAPER_RESCALE,
  REST_BASEMAP,
  REST_BEARING,
  REST_EDGE,
  REST_EXAGGERATION,
  REST_LABEL_SIZE,
  REST_TOP_SHARE,
  REST_LIGHT,
  REST_PITCH,
  REST_RELIEF_HIGHLIGHT,
  REST_SKY,
  REVEAL_MS,
  compassName,
  demTilesUrl,
  isHillshadeHint,
  lightAltitude,
  lightSweep,
} from '../utils/archaeoLayers.ts';
import {
  ATTRIBUTION as SEA_ATTRIBUTION,
  FLEET_VIEW,
  aisKeyRow,
  aisLook,
  beatFor,
  boxCheckOf,
  coverageFacts,
  coverageKeyRows,
  featureBounds,
  filedFacts,
  forecastPass,
  growBounds,
  heatCheckOf,
  heatHoldLeft,
  heavyBounds,
  isVesselLayer,
  lookHoldLeft,
  lookStartFrom,
  passOf,
  prepareReplay,
  radarTileParams,
  recordedTaskingWait,
  replayWindow,
  revealBeat,
  seaPadding,
  targetCounts,
  targetKeyRows,
  toggled,
  vesselGeometryHint,
  vesselKind,
  vesselRasterHint,
  type SeaBeat,
  type SeaFacts,
  type SeaKeyRow,
  type VesselKind,
  type VesselRest,
} from '../utils/vesselLayers.ts';
import * as sea from './seaStage.ts';
import { SeaClock } from './SeaClock.tsx';
import { TaskingPlate } from './TaskingPlate.tsx';
import {
  TASKING_GAP,
  TASKING_MIN_BODY,
  TASKING_PLATE_WIDTH,
  globeZoom,
  stagePadding,
  taskingLeftOverhang,
  taskingPlateWidth,
  taskingSlot,
  type TaskingSlot,
} from '../utils/stageLayout.ts';
import { cameraForStage, fitStage, NO_PADDING, pointBox, releasePadding } from '../utils/stageCamera.ts';
import { fitPitched, labelPerspective, sizeAtLeast, type Camera } from '../utils/restCamera.ts';
import { cursorWords, heightAt, nearestAlong, pointAlong, profileFromFeatures, type ProfileData } from '../utils/profileSection.ts';
import { stageTransectFeatures } from '../utils/transectMarks.ts';
import { whenStyleReady } from '../utils/styleReady.ts';
import { createTileHealth } from '../utils/tileHealth.ts';
import { getSectionCursor, setSectionCursor, useSectionCursor } from '../utils/sectionCursor.ts';
import { Starfield } from './Starfield.tsx';
import { LightPlate } from './LightPlate.tsx';
import type { Tip } from '../utils/steps.ts';
import { CompareView } from './CompareView';
import { Icon } from './Icons.tsx';
import { LayerStack, type StackRow } from './LayerStack.tsx';
import { theme } from '../theme';
import '../stage.css';

const BASEMAP_IDS = ['dark-base', 'google-roads-base', 'google-satellite-base', 'esri-satellite-base'];

// The finding's frame: clear of the step column (left), the console (bottom) and the layers
// plate (right), so what the camera lands on is what the room sees. Read at each frame: the step
// column widens with the screen (utils/stageLayout.ts).
// Clear of the plates as they are now: the console measured, so a frame never lands under prompts
// that wrap to two rows (A1 P1-7, A2 P1-8).
const STAGE_PADDING_NOW = () => {
  if (typeof window === 'undefined') return stagePadding(1920);
  const consoleTop = document.querySelector('.stage-docent')?.getBoundingClientRect().top;
  return stagePadding(window.innerWidth, { viewportHeight: window.innerHeight, consoleTop });
};
// A ranked similarity map frames with room under its lowest dot for that match's rank label,
// which stands below the dot (24 px type and its offset), so no rank sits on the console.
const SIMILARITY_LABEL_ROOM = 48;
const SIMILARITY_PADDING_NOW = () => {
  const p = STAGE_PADDING_NOW();
  return { ...p, bottom: p.bottom + SIMILARITY_LABEL_ROOM };
};
// Dark Vessels frames its sea on the fixed padding, as before (its act is its own).
const SEA_PADDING_BASE = () => stagePadding(typeof window === 'undefined' ? 1920 : window.innerWidth);

// Ranks at or above this are lit and labelled; every other footprint is a hairline. 39 is the count; 3 is the story.
const LIT_RANKS = 3;
// The watch globe: how fast it turns (degrees of longitude per second: slowly at rest, faster
// while the agent works, so the speed-up itself says "working"), and the tilt the 3D columns are
// read at. Its size and centre fit the area the plates leave free (utils/stageLayout.ts).
const GLOBE_DEG_PER_S_WORKING = 4;
const GLOBE_DEG_PER_S_RESTING = 1.5;
const COLUMNS_PITCH = 55;
/** How close the camera comes when a bar layer lands, by kind (see the columns branch). */
const COLUMNS_MAX_ZOOM: Record<BarKind, number> = { tip: 11, emit: 13, carbon_mapper: 14.5 };
/** The tip bars' opacity once the ground scene is under them (0.9 before). */
const TIP_BARS_GROUND_OPACITY = 0.45;
// A coarse raster (TROPOMI) is dimmer than the finding so the EMIT candidate reads through it.
const COARSE_RASTER_OPACITY = 0.75;

const TIPS_SOURCE = 'watch-tips';
// The archaeologist's ground: the terrain-RGB source the 1 m products are draped on, and the
// relief the whole record is read on at rest (the same source, lit as a hillshade over the dimmed
// basemap: the archaeologist's map is landform, not imagery).
const GROUND_SOURCE = 'ground-dem';
const RELIEF_LAYER = 'rest-relief';
// A raster's companion (the live light over a hillshade) travels with it in the stack.
const LIGHT_SUFFIX = '-light';
// The section cursor on the map: an amber dot on the transect where the presenter points, and the
// height there beside it. It sits above the stack (like the presenter's drawn shapes).
const CURSOR_SOURCE = 'section-cursor';
// How close (px) the pointer must come to the transect on the map for the section to follow it.
const CURSOR_HIT_PX = 28;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A raster's real extent from TiTiler, or null (timeout, error, junk): the camera then keeps its fallback. */
async function fetchCogBounds(presignedUrl: string): Promise<[number, number, number, number] | null> {
  try {
    const response = await fetch(`${TITILER_URL}/cog/bounds?url=${encodeURIComponent(presignedUrl)}`, {
      headers: TITILER_API_KEY ? { 'x-api-key': TITILER_API_KEY } : {},
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const body = await response.json();
    const b = body?.bounds;
    if (!Array.isArray(b) || b.length !== 4 || !b.every((v: unknown) => typeof v === 'number' && Number.isFinite(v))) return null;
    const [w, s, e, n] = b as number[];
    return w < e && s < n && w >= -180 && e <= 180 && s >= -90 && n <= 90 ? [w, s, e, n] : null;
  } catch {
    return null;
  }
}

interface MapViewProps {
  geometry: GeometryData | null;
  rasters: RasterData[];
  onDrawnGeometry?: (geojson: any) => void;
  /** The draw rail (drop a point, draw a polygon). Off on the archaeologist's act: nothing is marked there that is not on the record. */
  drawRail?: boolean;
  /** The agent is working this turn: the watch globe turns until the first finding lands. */
  working?: boolean;
  /** The TROPOMI tips by watch area, drawn on the globe as they load. */
  tips?: Tip[];
  /** Dark Vessels' resting state (the AIS replay, the reserve, its ports): the act's sea comes with it. */
  vesselRest?: VesselRest | null;
  /** Dark Vessels' tasking: how many drafts this session (0 is none yet), for the session or the case. */
  tasking?: { sessionId: string; caseId?: string; key: number };
  /** Dark Vessels: the map revealed a pass's candidates (the count it revealed); the step column's counts wait for it. */
  onCandidatesRevealed?: (passId: string, count: number) => void;
  /** A raster is on the map (its URL): a replay's held layer waits for the scene before it. */
  onRasterLanded?: (url: string) => void;
  /** Methane Watch: the followed site's decision (follow.json); it dates the bar layers' legend rows. */
  follow?: Follow | null;
}

/** A sea file on the stage: its kind and pass (by its name), its data and its map ids. */
interface SeaFile {
  kind: VesselKind;
  pass: string | null;
  url: string;
  data: SeaFC | null;
  ids: sea.SeaIds;
}
type SeaFC = { type: 'FeatureCollection'; features: Array<{ type: 'Feature'; properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } | null }> };

/** A set with `id` in it, or the same set when it already was (so React keeps the render). */
const withId = (s: ReadonlySet<string>, id: string): ReadonlySet<string> => (s.has(id) ? s : new Set([...s, id]));
/** A set without `id`, or the same set when it never had it. */
const withoutId = (s: ReadonlySet<string>, id: string): ReadonlySet<string> => {
  if (!s.has(id)) return s;
  const next = new Set(s);
  next.delete(id);
  return next;
};

/** Run once the style can take layers (isStyleLoaded is false while tiles stream; idle is the backstop). */
function onStyle(m: maplibregl.Map, fn: () => void) {
  if (m.isStyleLoaded()) {
    fn();
    return;
  }
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    fn();
  };
  m.once('styledata', run);
  m.once('idle', run);
}

export function MapView({ geometry, rasters, onDrawnGeometry, drawRail = true, working = false, tips = [], vesselRest = null, tasking, onCandidatesRevealed, onRasterLanded, follow = null }: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const draw = useRef<MapboxDraw | null>(null);
  const [allLayers, setAllLayers] = useState<LayerMetadata[]>([]); // Persistent layer tracking
  const addedRasterUrls = useRef<Set<string>>(new Set()); // Track added raster URLs to prevent duplicates
  // The latest callback, read when a raster lands (the raster effect depends on `rasters` alone).
  const onRasterLandedRef = useRef(onRasterLanded);
  useEffect(() => {
    onRasterLandedRef.current = onRasterLanded;
  }, [onRasterLanded]);
  // Geometries waiting for the style (utils/styleReady.ts), cancelled if the map goes first.
  const styleWaits = useRef<Set<{ cancel: () => void }>>(new Set());
  // Rasters that have not drawn a tile (utils/tileHealth.ts): their rows say so and their legends
  // leave the plate. The listeners per raster layer, so a removed layer takes them with it.
  const tileHealth = useRef(createTileHealth());
  const tileWatch = useRef<Map<string, () => void>>(new Map());
  const [failedLayers, setFailedLayers] = useState<ReadonlySet<string>>(() => new Set());
  const [rasterVisibility, setRasterVisibility] = useState<Record<string, boolean>>({});
  // Mirror of the ticks for the loaders (a TROPOMI composite that lands after the bars lands unticked).
  const rasterVisibilityRef = useRef<Record<string, boolean>>({});
  useEffect(() => {
    rasterVisibilityRef.current = rasterVisibility;
  }, [rasterVisibility]);
  const [isLayerControlOpen, setIsLayerControlOpen] = useState(true);
  const [drawMode, setDrawMode] = useState<'none' | 'point' | 'polygon'>('none');
  const [hasDrawnFeatures, setHasDrawnFeatures] = useState(false);
  const [baseMapStyle, setBaseMapStyle] = useState<'dark' | 'google-roads' | 'google-satellite' | 'esri-satellite'>('esri-satellite');
  const [compareMode, setCompareMode] = useState<{ left: LayerMetadata; right: LayerMetadata; center?: [number, number]; zoom?: number } | null>(null);

  // The stack, top first: every layer the agent put on the map, in the order the layers plate
  // lists it and the map draws it (applyLayerOrder). The ref is for the loaders, which add several
  // layers before React commits the state.
  const [layerOrder, setLayerOrder] = useState<string[]>([]);
  const layerOrderRef = useRef<string[]>([]);
  // The camera's zoom, for the rows of coarse rasters the map hides this close in.
  const [zoom, setZoom] = useState(2);

  // Memoize layer groups to avoid repeated filtering on each render
  const layerGroups = useMemo(() => groupLayers(allLayers), [allLayers]);
  // The compare slider needs a before and an after of the SAME place; two scenes of two
  // different places (the eyes on two similarity matches) are not a pair.
  const comparePair = useMemo(() => findComparePair(layerGroups.tci), [layerGroups.tci]);
  // Mirror of allLayers for the async geometry loader, which otherwise closes over a stale list.
  const allLayersRef = useRef<LayerMetadata[]>([]);
  // Set the moment the camera frames a methane raster, before its metadata is committed: the
  // footprints (which can land later on a cold page load) must not pull the frame back out.
  const plumeFramed = useRef(false);
  useEffect(() => {
    allLayersRef.current = allLayers;
  }, [allLayers]);

  // The watch globe: on when a watch baseline lands, off when the map is cleared. It sits in space
  // (a still starfield behind the canvas, an atmosphere at its limb) and turns: slowly at rest,
  // faster while the agent works, until a methane raster takes the frame, the presenter grabs the
  // map, or the viewer asked for reduced motion.
  const [globeOn, setGlobeOn] = useState(false);
  const presenterHolding = useRef(false);
  useEffect(() => {
    const mapInstance = map.current;
    if (!mapInstance) return;
    const apply = () => {
      mapInstance.setProjection({ type: globeOn ? 'globe' : 'mercator' });
      // A thin blue limb at globe zooms, gone by the dive (zoom 7), so the ground scene is never tinted.
      mapInstance.setSky(
        globeOn
          ? {
              'sky-color': '#0b1a2e',
              'horizon-color': '#2b4a66',
              'fog-color': '#0b1a2e',
              'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.9, 5, 0.9, 7, 0],
            }
          : { 'atmosphere-blend': 0 },
      );
    };
    if (mapInstance.isStyleLoaded()) apply();
    else mapInstance.once('styledata', apply);
  }, [globeOn]);
  useEffect(() => {
    const mapInstance = map.current;
    if (!mapInstance || !globeOn || prefersReducedMotion()) return;
    const degPerS = working ? GLOBE_DEG_PER_S_WORKING : GLOBE_DEG_PER_S_RESTING;
    let frame = 0;
    let last = performance.now();
    const hold = () => { presenterHolding.current = true; };
    const release = () => { presenterHolding.current = false; last = performance.now(); };
    mapInstance.on('mousedown', hold);
    mapInstance.on('touchstart', hold);
    mapInstance.on('mouseup', release);
    mapInstance.on('touchend', release);
    const turn = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const idle = !presenterHolding.current && !plumeFramed.current && !mapInstance.isMoving();
      if (idle && mapInstance.getZoom() < 3) {
        const c = mapInstance.getCenter();
        mapInstance.setCenter([c.lng + degPerS * dt, c.lat]);
      }
      if (!plumeFramed.current) frame = requestAnimationFrame(turn);
    };
    frame = requestAnimationFrame(turn);
    return () => {
      cancelAnimationFrame(frame);
      mapInstance.off('mousedown', hold);
      mapInstance.off('touchstart', hold);
      mapInstance.off('mouseup', release);
      mapInstance.off('touchend', release);
    };
  }, [globeOn, working]);

  // The archaeologist's ground: on when the first terrain product lands, off when the map is
  // cleared. The map stands up its 3D terrain (a global terrain-RGB source, relief ×3, the
  // hillshade or relief draped on it), the camera reads it from a low oblique angle looking
  // north-east across the hillshade's light, and a metre scale sits above the basemap plate.
  // The other acts never see any of this: the Earth Analyst is flat, the Methane Hunter orbits.
  const [groundOn, setGroundOn] = useState(false);
  const groundOnRef = useRef(false);
  const scaleControl = useRef<maplibregl.ScaleControl | null>(null);
  // The record at rest reads on relief: while the catalogue marks are on the stage and no terrain
  // product has stood the ground up, the same terrain tiles are lit as a hillshade just above the
  // dimmed basemap, so the Appalachians and the river valleys the mound builders chose read as
  // landform. The first LiDAR product takes over (the 1 m hillshade is the relief then).
  const reliefOn = useMemo(
    () => !groundOn && allLayers.some((l) =>
      l.type === 'geometry' && terrainGeometryHint(l.render, l.url)?.kind === 'points' && rasterVisibility[l.id] !== false),
    [groundOn, allLayers, rasterVisibility],
  );
  const reliefOnRef = useRef(false);
  // The record at rest proper: nothing on the stage but the catalogue. The continent stands up
  // (relief ×6), the camera stands low over the Gulf looking up the valleys, and the horizon has
  // the last light on it. The first thing the agent lands (a site's frame, a scene) ends it.
  const restOn = useMemo(
    () => reliefOn && allLayers.every((l) => l.type === 'geometry' && terrainGeometryHint(l.render, l.url)?.kind === 'points'),
    [reliefOn, allLayers],
  );
  const restOnRef = useRef(false);
  const ensureGroundSource = (mapInstance: maplibregl.Map) => {
    if (mapInstance.getSource(GROUND_SOURCE)) return;
    mapInstance.addSource(GROUND_SOURCE, {
      type: 'raster-dem',
      tiles: [TERRAIN_TILES_URL],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 15,
      attribution: 'Terrain: AWS Terrain Tiles (USGS 3DEP)',
    });
  };
  const dropGroundSource = (mapInstance: maplibregl.Map) => {
    // Never from under the terrain: the rest view's or the ground's must go first.
    const terrainOnIt = mapInstance.getTerrain()?.source === GROUND_SOURCE;
    if (!groundOnRef.current && !reliefOnRef.current && !restOnRef.current && !terrainOnIt && mapInstance.getSource(GROUND_SOURCE)) {
      mapInstance.removeSource(GROUND_SOURCE);
    }
  };
  useEffect(() => {
    groundOnRef.current = groundOn;
    const mapInstance = map.current;
    if (!mapInstance) return;
    const apply = () => {
      if (groundOn) {
        ensureGroundSource(mapInstance);
        mapInstance.setTerrain({ source: GROUND_SOURCE, exaggeration: RELIEF_EXAGGERATION });
        if (!scaleControl.current) {
          scaleControl.current = new maplibregl.ScaleControl({ maxWidth: 160, unit: 'metric' });
          mapInstance.addControl(scaleControl.current, 'bottom-right');
        }
      } else {
        if (mapInstance.getTerrain()) mapInstance.setTerrain(null);
        dropGroundSource(mapInstance);
        if (scaleControl.current) {
          mapInstance.removeControl(scaleControl.current);
          scaleControl.current = null;
        }
      }
    };
    if (mapInstance.isStyleLoaded()) apply();
    else mapInstance.once('styledata', apply);
  }, [groundOn]);
  useEffect(() => {
    reliefOnRef.current = reliefOn;
    const mapInstance = map.current;
    if (!mapInstance) return;
    const apply = () => {
      if (reliefOn) {
        ensureGroundSource(mapInstance);
        if (!mapInstance.getLayer(RELIEF_LAYER)) {
          // Just above the basemap: the stack (marks, frames, products) draws over it.
          const above = mapInstance.getLayersOrder().find((id) => !BASEMAP_IDS.includes(id));
          mapInstance.addLayer({
            id: RELIEF_LAYER,
            type: 'hillshade',
            source: GROUND_SOURCE,
            paint: {
              // A low sun from the west (the GDAL model: it knows the sun's height): west faces
              // catch the last light in bone, east faces go to the dome, flat ground stays clear.
              'hillshade-method': 'basic',
              'hillshade-illumination-direction': REST_LIGHT.azimuth,
              'hillshade-illumination-altitude': REST_LIGHT.altitude,
              'hillshade-illumination-anchor': 'map',
              'hillshade-exaggeration': 0.8,
              'hillshade-shadow-color': '#05070a',
              'hillshade-highlight-color': REST_RELIEF_HIGHLIGHT,
              'hillshade-accent-color': '#0f141b',
            },
          }, above);
        }
      } else {
        if (mapInstance.getLayer(RELIEF_LAYER)) mapInstance.removeLayer(RELIEF_LAYER);
        dropGroundSource(mapInstance);
      }
    };
    if (mapInstance.isStyleLoaded()) apply();
    else mapInstance.once('styledata', apply);
  }, [reliefOn]);
  // The rest view's terrain and sky: on with the record alone, off (to flat, no sky) the moment
  // anything else lands; the ground scene's own terrain (×3) is the groundOn effect's.
  useEffect(() => {
    restOnRef.current = restOn;
    const mapInstance = map.current;
    if (!mapInstance) return;
    const apply = () => {
      if (restOn) {
        ensureGroundSource(mapInstance);
        mapInstance.setTerrain({ source: GROUND_SOURCE, exaggeration: REST_EXAGGERATION });
        mapInstance.setSky({ ...REST_SKY });
      } else {
        if (!groundOnRef.current && mapInstance.getTerrain()) mapInstance.setTerrain(null);
        mapInstance.setSky({ ...NO_SKY });
        dropGroundSource(mapInstance);
      }
    };
    if (mapInstance.isStyleLoaded()) apply();
    else mapInstance.once('styledata', apply);
  }, [restOn]);

  // Dark Vessels' sea at night (design component 11): on with the act's resting state or any of its
  // files, off when the map is cleared of both. The satellite basemap goes; the ground is the seabed;
  // three days of AIS play back over it and stop at the radar pass's minute when the pass lands. Every
  // file the agent shows is styled by its own name (utils/vesselLayers.ts) and lands as one beat of
  // the argument, in the order the tools run: the radar, the claim, the coverage, only then the
  // candidates; then the forecast, the fleet, the next look, the tasking.
  const vesselOnStage = useMemo(() => allLayers.some(isVesselLayer), [allLayers]);
  const seaOn = !!vesselRest || vesselOnStage;
  const seaOnRef = useRef(false);
  const [seaBeat, setSeaBeatState] = useState<SeaBeat>('rest');
  const seaBeatRef = useRef<SeaBeat>('rest');
  // A replay case's draft (status 'replay'), once the plate has loaded it, and the timer that brings
  // the clock back to its tasking after the beats of the files that land after it.
  const recordedDraft = useRef(false);
  const recordedBack = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setSeaBeat = (beat: SeaBeat) => {
    seaBeatRef.current = beat;
    setSeaBeatState(beat);
    // A replay case lands every file at once, in network order: its draft loads first, then each
    // file's beat takes the clock from the tasking. Once that beat has held, the clock comes back to
    // the tasking, the act's last beat. A live draft is the turn's last tool, so this never runs live.
    if (recordedBack.current) clearTimeout(recordedBack.current);
    recordedBack.current = null;
    const wait = recordedDraft.current ? recordedTaskingWait(beat, heatShownAt.current, Date.now()) : null;
    if (wait === null) return;
    recordedBack.current = setTimeout(() => {
      recordedBack.current = null;
      if (recordedDraft.current && seaBeatRef.current === beat) setSeaBeat('tasking');
    }, wait);
    // Cleared with the act's other timers (a cleared map, an unmount).
    seaTimers.current.push(recordedBack.current);
  };
  const [seaFacts, setSeaFacts] = useState<SeaFacts>({});
  // The pass the stage is showing (a radar, its targets, its coverage, an earlier pass's reach).
  const [stagePass, setStagePass] = useState<string | null>(null);
  const stagePassRef = useRef<string | null>(null);
  const seaFiles = useRef(new Map<string, SeaFile>());
  const revealed = useRef(new Set<string>());
  const [candidatesShown, setCandidatesShown] = useState(false);
  // The reveal is told to the stage (the step column's counts wait for it), through the latest prop.
  const onRevealRef = useRef(onCandidatesRevealed);
  onRevealRef.current = onCandidatesRevealed;
  // When the heat went on (ms): its beat holds HEAT_HOLD_MS before the boxes' beat.
  const heatShownAt = useRef<number | null>(null);
  // When the boxes' beat came up (ms): it holds BOXES_HOLD_MS before the next look lands (gate B, W1).
  const boxesShownAt = useRef<number | null>(null);
  const seaTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const sweeps = useRef(new Map<string, () => void>());
  const player = useRef<sea.ReplayPlayer | null>(null);
  const preparedReplay = useMemo(() => (vesselRest ? prepareReplay(vesselRest.replay.tracks) : []), [vesselRest]);
  // True once this MapView's map has loaded. The sea effects below are declared before the map is
  // made, so on a remount (New session keys the map by session) they first run with no map;
  // this in their deps runs them again on the new map with the rest the stage already holds.
  const [mapLive, setMapLive] = useState(false);
  // Layers the date reset hid (another pass's), so the reset can bring back exactly those.
  const dateHidden = useRef(new Set<string>());
  // The tasking on the map: the draft (from the backend), the officer's box and the candidates left out.
  const [taskingState, setTaskingState] = useState<TaskingState | null>(null);
  const [taskBox, setTaskBox] = useState<number | null>(null);
  const [taskExcluded, setTaskExcluded] = useState<string[]>([]);
  const [taskingDismissed, setTaskingDismissed] = useState(0);
  const taskingOn = seaOn && !!tasking && tasking.key > 0 && taskingDismissed !== tasking.key;
  // Where the tasking plate stands (measured: under the map key on the right, or over the finished
  // steps on the left), and what it is measured against. It renders in the stage's overlay, the
  // layer above the step column, so it can stand in the column's slot where the right is too short.
  const frameRef = useRef<HTMLDivElement>(null);
  const layersRef = useRef<HTMLElement>(null);
  const taskingRef = useRef<HTMLElement>(null);
  const [overlayEl, setOverlayEl] = useState<HTMLElement | null>(null);
  const [taskingPlace, setTaskingPlace] = useState<TaskingSlot | null>(null);

  const seaLater = (fn: () => void, ms: number) => {
    seaTimers.current.push(setTimeout(fn, ms));
  };
  const seaFileOf = (kind: VesselKind, pass?: string | null) =>
    [...seaFiles.current.entries()].find(([, f]) => f.kind === kind && (pass === undefined || f.pass === pass)) ?? null;
  // The view the room sees, inside the plates (labels land there).
  const seaView = (m: maplibregl.Map): [number, number, number, number] => {
    const p = seaPadding(SEA_PADDING_BASE());
    const box = m.getContainer();
    const sw = m.unproject([p.left, box.clientHeight - p.bottom]);
    const ne = m.unproject([box.clientWidth - p.right, p.top]);
    if (!(sw.lng < ne.lng && sw.lat < ne.lat)) {
      const b = m.getBounds();
      return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    }
    return [sw.lng, sw.lat, ne.lng, ne.lat];
  };
  const seaFit = (
    m: maplibregl.Map,
    b: [number, number, number, number],
    opts: { maxZoom?: number; duration?: number; extra?: { left?: number; right?: number } } = {},
  ) => {
    const pad = seaPadding(SEA_PADDING_BASE());
    m.fitBounds([[b[0], b[1]], [b[2], b[3]]], {
      padding: { ...pad, left: pad.left + (opts.extra?.left ?? 0), right: pad.right + (opts.extra?.right ?? 0) },
      duration: prefersReducedMotion() ? 0 : opts.duration ?? 1800,
      maxZoom: opts.maxZoom ?? 10,
      pitch: 0,
      bearing: 0,
    });
  };
  // The rest view: the whole reserve, clear of the clock plate (and of the step column when it is up).
  const fitSeaRest = (m: maplibregl.Map, duration = 1600) => {
    if (!vesselRest) return;
    const b = featureBounds([{ type: 'Feature', properties: {}, geometry: vesselRest.reserve as never }]);
    if (!b) return;
    const stage = SEA_PADDING_BASE();
    const columnUp = typeof document !== 'undefined' && !!document.querySelector('.stage-steps');
    m.fitBounds([[b[0], b[1]], [b[2], b[3]]], {
      padding: { top: 140, bottom: stage.bottom, left: columnUp ? stage.left : 90, right: allLayersRef.current.length ? stage.right : 90 },
      duration: prefersReducedMotion() ? 0 : duration,
      pitch: 0,
      bearing: 0,
    });
  };

  // The date reset: one pass on the stage at a time. A pass's layers landing hide another pass's; the
  // forecast's (no pass) bring back the pass the argument ended on. The AIS replay is the rest's pass's, so
  // over another pass it is not drawn (the paint effect below).
  const showPass = (pass: string | null) => {
    if (!pass) return;
    stagePassRef.current = pass;
    setStagePass(pass);
    const changes: Record<string, boolean> = {};
    seaFiles.current.forEach((f, id) => {
      if (!f.pass) return;
      if (f.pass !== pass) {
        changes[id] = false;
        dateHidden.current.add(id);
      } else if (dateHidden.current.has(id)) {
        changes[id] = true;
        dateHidden.current.delete(id);
      }
    });
    if (Object.keys(changes).length) setRasterVisibility((prev) => ({ ...prev, ...changes }));
  };
  // The forecast's beats return to the pass the argument ended on (the last one matched, else the
  // last with targets), so on the thin path the set-aside pass does not come back (§3.8.4).
  const backToForecastPass = () => {
    const pass = forecastPass(seaFiles.current.values()) ?? vesselRest?.pass.pass_id ?? null;
    if (pass && stagePassRef.current !== pass) showPass(pass);
  };

  // The candidates' reveal waits for the coverage of the same pass to be on the map, then a breath.
  const maybeReveal = () => {
    const m = map.current;
    if (!m) return;
    seaFiles.current.forEach((f, id) => {
      if (f.kind !== 'targets' || revealed.current.has(id) || !f.data) return;
      if (!targetCounts(f.data.features).matched) return;
      const coverage = [...seaFiles.current.values()].some((x) => (x.kind === 'heard' || x.kind === 'unproven') && x.pass === f.pass);
      if (!coverage) {
        console.warn('🛟 Candidates held: the coverage check is not on the map yet for', f.pass);
        return;
      }
      revealed.current.add(id);
      seaLater(() => {
        if (!m.getLayer(id)) return;
        sea.revealCandidates(m, id, [], prefersReducedMotion());
        seaFiles.current.forEach((x, xid) => {
          if ((x.kind === 'heard' || x.kind === 'unproven') && x.pass === f.pass) sea.quietCoverageLabels(m, xid);
        });
        setCandidatesShown(true);
        // The candidates' beat only from the coverage's: in a replay case the heat (or the tasking)
        // may be up by now, and the clock stays on it.
        const next = revealBeat(seaBeatRef.current);
        if (next) setSeaBeat(next);
        // The column's candidate count (and any "no candidates" line) waits for this moment (R4.2).
        const shown = seaFiles.current.get(id);
        if (f.pass && shown?.data) onRevealRef.current?.(f.pass, targetCounts(shown.data.features).candidate);
      }, prefersReducedMotion() ? 0 : 1400);
    });
  };

  // Debounced: the heat and the boxes land together; the camera frames both once.
  const forecastFit = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fitForecast = () => {
    if (forecastFit.current) clearTimeout(forecastFit.current);
    forecastFit.current = setTimeout(() => {
      const m = map.current;
      if (!m) return;
      const heat = seaFileOf('heat')?.[1].data;
      const boxes = seaFileOf('boxes')?.[1].data;
      const parts = [heat ? heavyBounds(heat.features, 0.15) : null, boxes ? featureBounds(boxes.features) : null]
        .filter((b): b is [number, number, number, number] => !!b);
      if (!parts.length) return;
      const b: [number, number, number, number] = [
        Math.min(...parts.map((p) => p[0])), Math.min(...parts.map((p) => p[1])),
        Math.max(...parts.map((p) => p[2])), Math.max(...parts.map((p) => p[3])),
      ];
      seaFit(m, growBounds(b, 0.12));
    }, 450);
  };

  // The fleet's pull-back: up and out to the fleet's lights off Peru, then back to the reserve.
  const fleetBack = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pullBackToFleet = (m: maplibregl.Map) => {
    const before = { center: m.getCenter(), zoom: m.getZoom() };
    const beatBefore = seaBeatRef.current === 'fleet' ? 'boxes' : seaBeatRef.current;
    seaFit(m, FLEET_VIEW, { duration: 2600, maxZoom: 6 });
    if (fleetBack.current) clearTimeout(fleetBack.current);
    fleetBack.current = setTimeout(() => {
      if (!map.current || seaBeatRef.current !== 'fleet') return;
      map.current.flyTo({ center: before.center, zoom: before.zoom, duration: prefersReducedMotion() ? 0 : 2600 });
      setSeaBeat(beatBefore);
    }, (prefersReducedMotion() ? 0 : 2600) + 7000);
  };

  // A targets file landed (first time, or statuses changed in place): counts, the beat, the reveal.
  const landTargets = (m: maplibregl.Map, id: string, f: SeaFile, first: boolean) => {
    if (!f.data) return;
    const counts = targetCounts(f.data.features);
    setSeaFacts((x) => ({ ...x, counts, passId: f.pass ?? x.passId }));
    if (first) {
      showPass(f.pass);
      const b = featureBounds(f.data.features);
      if (b) seaFit(m, growBounds(b, 0.18));
    }
    if (counts.matched) {
      if (!revealed.current.has(id)) setSeaBeat('coverage');
      maybeReveal();
    } else {
      setSeaBeat('targets');
    }
  };

  // Every other sea file: its beat, its facts, the camera's rule, the date reset.
  const landSeaFile = (m: maplibregl.Map, id: string, f: SeaFile) => {
    const feats = f.data?.features ?? [];
    switch (f.kind) {
      case 'targets':
        landTargets(m, id, f, true);
        return;
      case 'heard': {
        // This pass's own shares (validated), never a previous pass's: what it can check, the standard.
        const facts = coverageFacts(feats);
        setSeaFacts((x) => ({ ...x, heardShare: undefined, checkable: undefined, standard: undefined, ...facts }));
        showPass(f.pass);
        setSeaBeat('coverage');
        maybeReveal();
        return;
      }
      case 'unproven':
        showPass(f.pass);
        if (!revealed.current.size) setSeaBeat('coverage');
        maybeReveal();
        return;
      case 'heat':
      case 'boxes': {
        backToForecastPass();
        // Each figure from its own file: the top 5% from the heat, the boxes' from the boxes.
        if (f.kind === 'heat') {
          const heatCheck = heatCheckOf(feats);
          setSeaFacts((x) => ({ ...x, heatCheck }));
          heatShownAt.current = Date.now();
          boxesShownAt.current = null;
          setSeaBeat('heat');
        } else {
          const boxCheck = boxCheckOf(feats);
          setSeaFacts((x) => ({ ...x, boxCheck }));
        }
        // They land together: the heat's beat holds 5 s, then the boxes' (each figure beside its layer).
        if (seaFileOf('boxes')) {
          const showBoxes = () => {
            boxesShownAt.current = Date.now();
            setSeaBeat('boxes');
          };
          const wait = heatHoldLeft(seaFileOf('heat') ? heatShownAt.current : null, Date.now());
          if (wait === 0) showBoxes();
          else seaLater(() => { if (seaBeatRef.current === 'heat') showBoxes(); }, wait);
        }
        fitForecast();
        return;
      }
      case 'fleet': {
        backToForecastPass();
        const month = f.url.match(/fleet_(\d{4})-(\d{2})\.geojson/i);
        const words = month ? new Date(Date.UTC(Number(month[1]), Number(month[2]) - 1, 1)).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : undefined;
        setSeaFacts((x) => ({ ...x, fleetMonth: words }));
        pullBackToFleet(m);
        setSeaBeat('fleet');
        return;
      }
      case 'look': {
        backToForecastPass();
        const label = String(feats.find((x) => typeof x.properties?.label === 'string')?.properties.label ?? '');
        setSeaFacts((x) => ({ ...x, look: label || undefined, lookStart: lookStartFrom(label, Date.now()) ?? undefined, now: Date.now() }));
        // Once the tasking plate is up (a replay lands every file at once), the clock stays on it.
        if (seaBeatRef.current !== 'tasking' && seaBeatRef.current !== 'filed') setSeaBeat('look');
        return;
      }
      case 'reach': {
        showPass(f.pass);
        const area = feats.find((x) => x.properties?.kind === 'reach');
        setSeaFacts((x) => ({ ...x, passId: f.pass ?? x.passId, reach: area ? String(area.properties.label ?? '') : undefined }));
        setSeaBeat('reach');
        const b = featureBounds(feats);
        if (b) seaFit(m, growBounds(b, 0.08), { maxZoom: 9 });
        seaLater(() => sea.revealBackOn(m, id), prefersReducedMotion() ? 0 : 4200);
        return;
      }
      default:
        setSeaBeat(beatFor(f.kind));
    }
  };

  // A sea file from display_visual: its layers by its kind, in the stack, and its beat.
  const addSeaGeometry = (m: maplibregl.Map, data: GeometryData, geometryId: string, fillId: string) => {
    const url = data.sourceUrl ?? '';
    const kind = vesselKind(url);
    const hint = vesselGeometryHint(data.render, url);
    if (!kind || kind === 'radar' || !hint) return;
    // The boxes' beat holds 3 s before the next look's swath and countdown replace it (gate B, W1).
    if (kind === 'look') {
      const wait = lookHoldLeft(heatShownAt.current, boxesShownAt.current, Date.now());
      if (wait > 0) {
        seaLater(() => {
          if (map.current === m && m.getStyle()) addSeaGeometry(m, data, geometryId, fillId);
        }, wait);
        return;
      }
    }
    const fc = data as unknown as SeaFC;
    // The same file again: match_ais rewrites the targets in place (statuses only), so the layer
    // stays and its data changes; any other file shown twice replaces its first showing.
    const same = [...seaFiles.current.entries()].find(([, f]) => f.url === url);
    if (same && kind === 'targets') {
      const [id, f] = same;
      sea.updateTargets(m, f.ids, fc);
      f.data = fc;
      landTargets(m, id, f, false);
      return;
    }
    if (same) removeLayer(same[0]);
    // One next look on the stage at a time.
    if (kind === 'look') [...seaFiles.current.entries()].filter(([, f]) => f.kind === 'look').forEach(([id]) => removeLayer(id));
    const ids: sea.SeaIds = { source: geometryId, points: `${geometryId}-points`, fill: fillId };
    const pass = passOf(url);
    const avoid: Array<[number, number]> = [];
    seaFiles.current.forEach((f) => {
      if (f.kind === 'targets' && (!pass || f.pass === pass)) {
        f.data?.features.forEach((x) => x.geometry?.type === 'Point' && avoid.push(x.geometry.coordinates as [number, number]));
      }
    });
    try {
      sea.addSeaLayers(m, kind, ids, fc, { view: seaView(m), avoid, reduced: prefersReducedMotion(), url });
    } catch (err) {
      console.error('❌ Error adding a sea layer:', err);
      return;
    }
    const file: SeaFile = { kind, pass, url, data: fc, ids };
    seaFiles.current.set(fillId, file);
    const b = featureBounds(fc.features);
    setAllLayers((prev) => [...prev, {
      id: fillId,
      sourceId: geometryId,
      name: data.locationName || hint.legend || 'Sea layer',
      url,
      type: 'geometry',
      ...(b ? { bounds: b } : {}),
      render: hint,
    }]);
    placeInStack(fillId, 'top');
    requestAnimationFrame(() => sea.arrive(m, kind, fillId));
    landSeaFile(m, fillId, file);
  };

  // Something of this pass beyond its radar (its targets, coverage or reach) is already on the stage.
  const seaPassMovedOn = (pass: string | null) =>
    !!pass && [...seaFiles.current.values()].some((f) => f.kind !== 'radar' && f.pass === pass);

  // A radar pass from display_visual (the raster effect adds the tiles at 0): the beat, the date
  // reset, and the sweep along the satellite's track; a dissolve under reduced motion.
  const landRadar = (m: maplibregl.Map, layerId: string, sourceId: string, url: string, presigned: string, bounds: [number, number, number, number] | undefined) => {
    const pass = passOf(url);
    seaFiles.current.set(layerId, { kind: 'radar', pass, url, data: null, ids: { source: sourceId, points: '', fill: layerId } });
    showPass(pass);
    setSeaFacts((x) => ({ ...x, passId: pass ?? x.passId }));
    // The tiles can land after the pass's own targets (the raster waits on TiTiler): the beat never
    // goes back to the radar once the argument on that pass has moved on.
    if (!seaPassMovedOn(pass)) setSeaBeat('radar');
    const target = aisLook('radar').radar;
    const settle = (ms: number) => {
      sweeps.current.delete(layerId);
      if (!m.getLayer(layerId)) return;
      m.setPaintProperty(layerId, 'raster-opacity-transition', { duration: ms, delay: 0 });
      m.setPaintProperty(layerId, 'raster-opacity', aisLook(seaBeatRef.current).radar);
    };
    if (prefersReducedMotion() || !bounds) {
      settle(1200);
      return;
    }
    sweeps.current.set(layerId, () => {});
    const ascending = (vesselRest?.passes.find((p) => p.pass_id === pass)?.orbit_state ?? 'ascending') !== 'descending';
    void sea.radarPreview(presigned).then((image) => {
      if (!sweeps.current.has(layerId) || !m.getLayer(layerId)) return;
      if (!image) {
        settle(900);
        return;
      }
      // The sweep starts as the camera settles on the pass.
      seaLater(() => {
        if (!sweeps.current.has(layerId) || !m.getLayer(layerId)) return;
        const cancel = sea.sweepRadar(m, layerId, image, bounds, ascending, target, () => {
          settle(0);
          seaLater(() => sea.dropSweep(m, layerId), 300);
        });
        sweeps.current.set(layerId, cancel);
      }, m.isMoving() ? 1400 : 200);
    });
  };

  // The floor: the seabed in, the basemap out (and back when the sea goes).
  useEffect(() => {
    seaOnRef.current = seaOn;
    const m = map.current;
    if (!m) return;
    onStyle(m, () => {
      if (!map.current) return;
      if (seaOnRef.current) {
        sea.seaFloorOn(m, BASEMAP_IDS);
        sea.seaImages(m);
      } else {
        sea.seaFloorOff(m, BASEMAP_IDS);
      }
    });
  }, [seaOn, mapLive]);

  // The furniture and the replay, with the resting state; the rest view and the seabed's tiles.
  useEffect(() => {
    const m = map.current;
    if (!m || !vesselRest) return;
    let disposed = false;
    const warm = new AbortController();
    onStyle(m, () => {
      if (disposed || !map.current) return;
      sea.seaImages(m);
      sea.furnitureOn(m, vesselRest, preparedReplay);
      const p = new sea.ReplayPlayer(m, preparedReplay, replayWindow(vesselRest), (t, n) =>
        setSeaFacts((f) => (f.replayAt === t && f.vessels === n ? f : { ...f, replayAt: t, vessels: n })));
      player.current = p;
      p.setMode(prefersReducedMotion() || allLayersRef.current.some(isVesselLayer) ? 'hold' : 'loop');
      if (allLayersRef.current.length === 0) fitSeaRest(m, 0);
      const b = featureBounds([{ type: 'Feature', properties: {}, geometry: vesselRest.reserve as never }]);
      if (b) sea.prefetchSeabed(b, [6, 7, 8, 9], warm.signal);
      // And the fleet's pull-back, off Peru and Chile.
      sea.prefetchSeabed(FLEET_VIEW, [3, 4, 5], warm.signal);
    });
    return () => {
      disposed = true;
      warm.abort();
      player.current?.stop();
      player.current = null;
      try {
        if (map.current?.getStyle()) sea.furnitureOff(map.current);
      } catch {
        // the map is already gone (unmount)
      }
    };
    // fitSeaRest reads refs and the rest itself; the furniture follows the rest (and the map) only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vesselRest, preparedReplay, mapLive]);

  // The replay's mode: loop at rest, run on to the pass while the agent works, hold once the pass is on.
  useEffect(() => {
    // The clock's choose beat (§3.2, §3.8.2): "while the agent chooses a radar pass", from the click
    // until the first file of the argument lands; back to the rest if the turn ends with none.
    if (working && !vesselOnStage && seaBeatRef.current === 'rest') {
      seaBeatRef.current = 'forward';
      setSeaBeatState('forward');
    } else if (!working && seaBeatRef.current === 'forward') {
      seaBeatRef.current = 'rest';
      setSeaBeatState('rest');
    }
    const p = player.current;
    if (!p) return;
    p.setMode(prefersReducedMotion() || vesselOnStage ? 'hold' : working ? 'forward' : 'loop');
  }, [working, vesselOnStage]);

  // The beat's look on the traffic and the radar.
  useEffect(() => {
    const m = map.current;
    if (!m || !seaOn) return;
    const earlier = !!stagePass && !!vesselRest && stagePass !== vesselRest.pass.pass_id;
    const look = aisLook(seaBeat, earlier);
    onStyle(m, () => {
      sea.paintAis(m, look);
      seaFiles.current.forEach((f, id) => {
        if (f.kind === 'heard' || f.kind === 'unproven') sea.paintCoverage(m, f.kind, id, look.quietCoverage);
        if (f.kind !== 'radar' || sweeps.current.has(id) || !m.getLayer(id)) return;
        m.setPaintProperty(id, 'raster-opacity-transition', { duration: 700, delay: 0 });
        m.setPaintProperty(id, 'raster-opacity', look.radar);
      });
    });
  }, [seaBeat, stagePass, vesselRest, seaOn, mapLive]);

  // The tasking: the draft loaded (the beat, the officer's starting choice). The layers plate folds
  // its list while the plate is up; its map key stays, and the plate stands under it.
  const onTaskingLoaded = (state: TaskingState) => {
    recordedDraft.current = state.status === 'replay';
    setTaskingState(state);
    setTaskBox(state.choice?.box ?? state.card.box.box);
    const ids = state.card.candidates.map((c) => c.id);
    setTaskExcluded(state.choice ? ids.filter((x) => !state.choice!.candidateIds.includes(x)) : []);
    setSeaBeat(state.status === 'filed' ? 'filed' : 'tasking');
    setIsLayerControlOpen(false);
    backToForecastPass();
    // Once per draft, everything the officer chooses from in the window between the plates (on a
    // 1280 screen the boxes otherwise sit under the step column). Later loads (filed) keep the view.
    const m = map.current;
    if (m && taskingFramed.current !== state.card.taskingId) {
      taskingFramed.current = state.card.taskingId;
      frameTasking(m, state, state.choice?.box ?? state.card.box.box);
    }
  };
  const taskingFramed = useRef<string | null>(null);
  // The box the camera last framed for the tasking (a narrow window frames one box at a time).
  const taskingFramedBox = useRef<number | null>(null);
  const taskingNarrow = (m: maplibregl.Map) => {
    const pad = seaPadding(SEA_PADDING_BASE());
    // A 1280 screen leaves about 570 px between the step column and the plate.
    return m.getContainer().clientWidth - pad.left - pad.right < 800;
  };
  // Everything the officer chooses from in the window between the plates (on a 1280 screen the
  // boxes otherwise sit under the step column). A narrow window takes the chosen box and the
  // candidates only; the plate lists the other boxes.
  const frameTasking = (m: maplibregl.Map, state: TaskingState, box: number) => {
    taskingFramedBox.current = box;
    const narrow = taskingNarrow(m);
    const labels = new Set(state.card.candidates.map((c) => c.id));
    const feats = [
      ...(seaFileOf('boxes')?.[1].data?.features ?? []).filter((f) => !narrow || f.properties?.box === box),
      ...(seaFileOf('targets', state.card.passId)?.[1].data?.features ?? []).filter((f) => labels.has(String(f.properties?.label ?? ''))),
    ];
    const b = featureBounds(feats);
    // A candidate's label runs about 130 px to one side of its ring, either side: room for it on
    // both, so no label ends under the step column or the plate. On a screen where the plate may
    // stand over the step column, the frame also clears the plate's reach past the column.
    // On a wide screen the right column widens while the plate is up (taskingPlateWidth): the frame
    // keeps that much more clear on the right too.
    const vw = typeof window === 'undefined' ? 1920 : window.innerWidth;
    const wider = taskingPlateWidth(vw) - TASKING_PLATE_WIDTH;
    if (b) seaFit(m, b, { maxZoom: 9, extra: { left: 130 + taskingLeftOverhang(vw), right: 140 + wider } });
  };
  // The latest render's framer, for the effect below (it reads the sea files, which live in refs).
  const frameTaskingRef = useRef(frameTasking);
  frameTaskingRef.current = frameTasking;
  // On a narrow window a box chosen from the plate comes into view (a wide one shows all three).
  useEffect(() => {
    const m = map.current;
    if (!m || !taskingOn || taskingState?.status !== 'draft' || taskBox == null) return;
    if (taskBox === taskingFramedBox.current || !taskingNarrow(m)) return;
    frameTaskingRef.current(m, taskingState, taskBox);
  }, [taskBox, taskingOn, taskingState]);
  useEffect(() => {
    // A new draft starts with nothing chosen (and is no replay case's until it loads as one).
    recordedDraft.current = false;
    setTaskingState(null);
    setTaskExcluded([]);
  }, [tasking?.key]);

  // The plate's place in the stage's overlay (the layer the step column and the console live in):
  // its own first child, so the plate comes before the steps and the console in the tab order.
  useEffect(() => {
    const overlay = frameRef.current?.closest('.stage')?.querySelector<HTMLElement>('.stage__overlay');
    if (!overlay) return;
    const slot = document.createElement('div');
    slot.className = 'stage__tasking';
    overlay.prepend(slot);
    setOverlayEl(slot);
    return () => {
      slot.remove();
      setOverlayEl(null);
    };
  }, []);

  // Over the step column the plate takes the column's place: the finished steps under it are hidden
  // and out of the tab order and the reading order (inert) until the plate moves or goes.
  useEffect(() => {
    const steps = document.querySelector<HTMLElement>('.stage-steps');
    if (!steps || !taskingOn || taskingPlace?.side !== 'left') return;
    steps.inert = true;
    steps.style.visibility = 'hidden';
    return () => {
      steps.inert = false;
      steps.style.visibility = '';
    };
  }, [taskingOn, taskingPlace?.side]);

  // The plate's place, measured whenever the plate, the key or the stage changes size: under the
  // key on the right where it is usable there, else in the step column's slot (stageLayout.taskingSlot).
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!taskingOn || !frame) {
      setTaskingPlace(null);
      return;
    }
    // A part's height and its own margins; the foot's top margin is left out (on the left it is
    // `auto`, the slot's free space, which is not something the plate needs).
    const outer = (el: Element) => {
      const cs = getComputedStyle(el);
      const top = el.classList.contains('tasking-plate__foot') ? 0 : parseFloat(cs.marginTop || '0');
      return (el as HTMLElement).offsetHeight + top + parseFloat(cs.marginBottom || '0');
    };
    const place = () => {
      const plate = taskingRef.current;
      if (!plate) return;
      const f = frame.getBoundingClientRect();
      const body = plate.querySelector<HTMLElement>('.tasking-plate__body');
      const cs = getComputedStyle(plate);
      const chrome = [cs.paddingTop, cs.paddingBottom, cs.borderTopWidth, cs.borderBottomWidth].reduce((s, v) => s + (parseFloat(v) || 0), 0);
      // The head and the foot never scroll; the choices between them do.
      const fixed = chrome + [...plate.children].filter((c) => c !== body).reduce((s, c) => s + outer(c), 0);
      const need = fixed + (body ? body.scrollHeight : 0);
      const min = fixed + (body ? Math.min(TASKING_MIN_BODY, body.scrollHeight) : 0);
      const layers = layersRef.current?.getBoundingClientRect();
      const docent = document.querySelector('.stage-docent')?.getBoundingClientRect();
      const basemap = frame.querySelector('.map-basemap')?.getBoundingClientRect();
      const rail = frame.querySelector('.map-rail')?.getBoundingClientRect();
      const width = plate.offsetWidth;
      // The console stands under a column when the two overlap side to side (narrow screens).
      const under = (x0: number, x1: number) =>
        !!docent && docent.height > 0 && docent.left - f.left < x1 + 16 && docent.right - f.left > x0 - 16;
      const consoleFloor = docent ? docent.top - f.top - 16 : Infinity;
      const rightFloor = Math.min(
        basemap && basemap.height > 0 ? basemap.top - f.top - TASKING_GAP : f.height - 76,
        under(f.width - 16 - width, f.width - 16) ? consoleFloor : Infinity,
      );
      const leftFloor = Math.min(rail && rail.height > 0 ? rail.top - f.top - 16 : f.height - 16, under(16, 16 + width) ? consoleFloor : Infinity);
      const slot = taskingSlot({ keyBottom: layers ? layers.bottom - f.top : 0, rightFloor, leftFloor, need, min });
      setTaskingPlace((p) => (p && slot && p.side === slot.side && p.top === slot.top && p.maxHeight === slot.maxHeight && p.scrolls === slot.scrolls ? p : slot));
    };
    place();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    [frame, layersRef.current, taskingRef.current, taskingRef.current?.querySelector('.tasking-plate__body')]
      .forEach((el) => el && ro?.observe(el));
    window.addEventListener('resize', place);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [taskingOn, tasking?.key, taskingState, isLayerControlOpen, overlayEl, allLayers.length]);

  // The officer's choice on the map.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const boxes = seaFileOf('boxes')?.[0] ?? null;
    const pass = taskingState?.card.passId;
    const targets = (pass ? seaFileOf('targets', pass) : seaFileOf('targets'))?.[0] ?? null;
    const paint = () => sea.paintTasking(m, boxes, targets, taskingOn && taskingState ? taskBox : null,
      taskingOn ? taskExcluded : [], !!targets && revealed.current.has(targets));
    // At once: the officer's click shows on the map the moment it lands. isStyleLoaded() stays false
    // while the seabed's tiles stream after a camera move, and waiting for idle lagged the choice by
    // seconds; the layers are already there, so only a style still loading waits.
    try {
      paint();
    } catch {
      onStyle(m, paint);
    }
  }, [taskingOn, taskingState, taskBox, taskExcluded, candidatesShown]);

  // Clicks on the map choose: a box selects it, a candidate's ring drops or restores it.
  useEffect(() => {
    const m = map.current;
    if (!m || !taskingOn || taskingState?.status !== 'draft') return;
    const ids = new Set(taskingState.card.candidates.map((c) => c.id));
    const layersFor = () => {
      const boxes = seaFileOf('boxes')?.[0];
      const targets = seaFileOf('targets', taskingState.card.passId)?.[0];
      return {
        rings: targets ? [sea.cid(targets, '-cand'), targets, sea.cid(targets, '-notes')].filter((id) => m.getLayer(id)) : [],
        boxes: boxes && m.getLayer(sea.cid(boxes, '-hit')) ? [sea.cid(boxes, '-hit')] : [],
      };
    };
    const hit = (e: maplibregl.MapMouseEvent) => {
      const { rings, boxes } = layersFor();
      const near: [maplibregl.PointLike, maplibregl.PointLike] = [[e.point.x - 12, e.point.y - 12], [e.point.x + 12, e.point.y + 12]];
      const ring = rings.length ? m.queryRenderedFeatures(near, { layers: rings }).find((f) => f.properties?.status === 'candidate' && ids.has(String(f.properties?.label))) : undefined;
      if (ring) return { candidate: String(ring.properties.label) };
      const box = boxes.length ? m.queryRenderedFeatures(e.point, { layers: boxes })[0] : undefined;
      const n = Number(box?.properties?.box);
      return Number.isInteger(n) && taskingState.boxes.some((b) => b.box === n) ? { box: n } : null;
    };
    const onClick = (e: maplibregl.MapMouseEvent) => {
      if (working) return;
      const h = hit(e);
      if (h && 'candidate' in h) setTaskExcluded((x) => toggled(x, h.candidate!));
      else if (h && 'box' in h) setTaskBox(h.box!);
    };
    const onMove = (e: maplibregl.MapMouseEvent) => {
      m.getCanvas().style.cursor = hit(e) ? 'pointer' : '';
    };
    m.on('click', onClick);
    m.on('mousemove', onMove);
    return () => {
      m.off('click', onClick);
      m.off('mousemove', onMove);
      m.getCanvas().style.cursor = '';
    };
  }, [taskingOn, taskingState, working]);

  // Every sea timer and sweep stops with the map.
  useEffect(() => () => {
    seaTimers.current.forEach(clearTimeout);
    sweeps.current.forEach((cancel) => cancel());
    if (forecastFit.current) clearTimeout(forecastFit.current);
    if (fleetBack.current) clearTimeout(fleetBack.current);
  }, []);

  // The light over a hillshade: the live layers (one per hillshade on the stage), the sun's
  // azimuth the dial shows, and the sweep in flight when the LiDAR lands.
  const lightLayers = useRef<Set<string>>(new Set());
  const [lightCount, setLightCount] = useState(0);
  const [lightAzimuth, setLightAzimuth] = useState(LIGHT_AZIMUTH);
  const [lightHeight, setLightHeight] = useState(LIGHT_ALTITUDE);
  const [sweeping, setSweeping] = useState(false);
  // The camera's bearing: the light plate's dial is drawn as the room sees the map.
  const [bearing, setBearing] = useState(0);
  const sweepFrame = useRef(0);
  const paintLight = (mapInstance: maplibregl.Map, id: string, azimuth: number, altitude: number) => {
    mapInstance.setPaintProperty(id, 'hillshade-illumination-direction', azimuth);
    mapInstance.setPaintProperty(id, 'hillshade-illumination-altitude', altitude);
  };
  const setLight = (azimuth: number, altitude: number) => {
    const mapInstance = map.current;
    if (!mapInstance) return;
    lightLayers.current.forEach((id) => {
      if (mapInstance.getLayer(id)) paintLight(mapInstance, id, azimuth, altitude);
    });
  };
  const stopSweep = () => {
    if (sweepFrame.current) cancelAnimationFrame(sweepFrame.current);
    sweepFrame.current = 0;
    setSweeping(false);
  };
  // The sun sinks from high (the ground flat) to raking (the walls stand up), goes once round the
  // earthwork, and settles where the baked hillshade was lit. The plate follows it as it moves.
  const sweepLight = () => {
    const mapInstance = map.current;
    if (!mapInstance || lightLayers.current.size === 0) return;
    stopSweep();
    setSweeping(true);
    const t0 = performance.now();
    let lastShown = 0;
    const step = (now: number) => {
      const live = [...lightLayers.current].filter((id) => mapInstance.getLayer(id));
      if (live.length === 0) {
        stopSweep();
        return;
      }
      const t = (now - t0) / LIGHT_SWEEP_MS;
      const az = lightSweep(t);
      const alt = lightAltitude(t);
      live.forEach((id) => paintLight(mapInstance, id, az, alt));
      // The plate's dial and readout at ~15 fps: enough to follow, cheap for React.
      if (now - lastShown > 66) {
        lastShown = now;
        setLightAzimuth(az);
        setLightHeight(alt);
      }
      if (t < 1) {
        sweepFrame.current = requestAnimationFrame(step);
      } else {
        sweepFrame.current = 0;
        setSweeping(false);
        setLightAzimuth(LIGHT_AZIMUTH);
        setLightHeight(LIGHT_ALTITUDE);
        setLight(LIGHT_AZIMUTH, LIGHT_ALTITUDE);
      }
    };
    sweepFrame.current = requestAnimationFrame(step);
  };
  const forgetLight = (lightId: string) => {
    if (lightLayers.current.delete(lightId)) setLightCount(lightLayers.current.size);
  };
  // The presenter moves the sun from the light plate: the sweep stops where it is held.
  const holdLight = (azimuth: number, altitude: number) => {
    stopSweep();
    setLightAzimuth(azimuth);
    setLightHeight(altitude);
    setLight(azimuth, altitude);
  };

  // The transects on the map, by site: their line (for the cursor's dot) and their section (for the
  // height beside it), and the fill layer that draws the line (so a removed one is forgotten).
  const transects = useRef<Map<string, { coords: Array<[number, number]>; profile: ProfileData; layerId: string }>>(new Map());

  // The section cursor on the map: wherever the presenter points on the section, an amber dot on the
  // transect and the height there in mono; pointing at the line on the map moves both.
  const sectionCursor = useSectionCursor();
  useEffect(() => {
    const mapInstance = map.current;
    if (!mapInstance) return;
    const t = sectionCursor ? transects.current.get(sectionCursor.siteId) : undefined;
    const at = sectionCursor && t ? pointAlong(t.coords, sectionCursor.atM / Math.max(1, t.profile.lengthM)) : null;
    const data: FeatureCollection = {
      type: 'FeatureCollection',
      features: at && sectionCursor && t
        ? [{
            type: 'Feature',
            geometry: { type: 'Point', coordinates: at },
            properties: { label: cursorWords(sectionCursor.atM, heightAt(t.profile, sectionCursor.atM)).replace(/^at /, '') },
          }]
        : [],
    };
    // While the cursor stands on a transect its bank and ditch labels step aside, so the reading at
    // the cursor is the one the room reads (the marks stay; the labels come back on letting go).
    transects.current.forEach((tr, siteId) => {
      const labels = tr.layerId.replace('-fill', '-labels');
      if (mapInstance.getLayer(labels)) {
        mapInstance.setPaintProperty(labels, 'text-opacity', at && sectionCursor?.siteId === siteId ? 0 : 1);
      }
    });
    const source = mapInstance.getSource(CURSOR_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
      // Keep it over anything that landed since.
      [`${CURSOR_SOURCE}-dot`, `${CURSOR_SOURCE}-label`].forEach((id) => mapInstance.getLayer(id) && mapInstance.moveLayer(id));
      return;
    }
    if (!at || !mapInstance.isStyleLoaded()) return;
    mapInstance.addSource(CURSOR_SOURCE, { type: 'geojson', data });
    mapInstance.addLayer({
      id: `${CURSOR_SOURCE}-dot`,
      type: 'circle',
      source: CURSOR_SOURCE,
      paint: {
        'circle-color': theme.colors.primary,
        'circle-radius': 7,
        'circle-stroke-color': '#0f141b',
        'circle-stroke-width': 2.5,
        'circle-pitch-alignment': 'viewport',
      },
    });
    mapInstance.addLayer({
      id: `${CURSOR_SOURCE}-label`,
      type: 'symbol',
      source: CURSOR_SOURCE,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Atkinson Hyperlegible Mono', 'monospace'],
        'text-size': 18,
        'text-anchor': 'bottom',
        'text-offset': [0, -1.1],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { 'text-color': '#e9eef3', 'text-halo-color': '#0f141b', 'text-halo-width': 2.5 },
    });
  }, [sectionCursor]);

  // The other way: the pointer near a transect on the map points the section at the same spot.
  // Registered once when the map is made (see the init effect); reads refs only.
  const listenForTransects = (mapInstance: maplibregl.Map) => {
    const onMove = (e: maplibregl.MapMouseEvent) => {
      let best: { siteId: string; atM: number; px: number } | null = null;
      transects.current.forEach((t, siteId) => {
        if (!mapInstance.getLayer(t.layerId) || mapInstance.getLayoutProperty(t.layerId, 'visibility') === 'none') return;
        const f = nearestAlong(t.coords, [e.lngLat.lng, e.lngLat.lat]);
        const on = f === null ? null : pointAlong(t.coords, f);
        if (f === null || !on) return;
        const p = mapInstance.project(on);
        const px = Math.hypot(p.x - e.point.x, p.y - e.point.y);
        if (px <= CURSOR_HIT_PX && (!best || px < best.px)) best = { siteId, atM: f * t.profile.lengthM, px };
      });
      const hit = best as { siteId: string; atM: number; px: number } | null;
      if (hit) {
        setSectionCursor({ siteId: hit.siteId, atM: hit.atM, from: 'map' });
        mapInstance.getCanvas().style.cursor = 'crosshair';
      } else if (getSectionCursor()?.from === 'map') {
        setSectionCursor(null);
        mapInstance.getCanvas().style.cursor = '';
      }
    };
    const onLeave = () => {
      if (getSectionCursor()?.from === 'map') setSectionCursor(null);
    };
    mapInstance.on('mousemove', onMove);
    mapInstance.on('mouseout', onLeave);
  };

  // The tips on the globe: one mark per scanned watch area at its hotspot (or its centre when the
  // scan found none), sized and coloured by the anomaly on the TROPOMI legend's own ramp (ice),
  // labelled with the area's short name and "+86 ppb" in mono. Hidden once the camera dives
  // (zoom 5), where the composite itself takes over. Fog stroke; nothing amber on the map.
  useEffect(() => {
    const mapInstance = map.current;
    if (!mapInstance) return;
    const features = tips.map((t) => ({
      type: 'Feature' as const,
      properties: {
        short: t.area.short,
        anomaly: t.anomalyPpb ?? 0,
        label: t.anomalyPpb === null ? 'no hotspot' : `${t.anomalyPpb >= 0 ? '+' : ''}${t.anomalyPpb.toFixed(0)} ppb`,
        emit: t.emit ? 1 : 0,
      },
      geometry: { type: 'Point' as const, coordinates: t.point ?? t.area.centre },
    }));
    const apply = () => {
      const src = mapInstance.getSource(TIPS_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (features.length === 0) {
        [`${TIPS_SOURCE}-labels`, `${TIPS_SOURCE}-marks`].forEach((id) => { if (mapInstance.getLayer(id)) mapInstance.removeLayer(id); });
        if (src) mapInstance.removeSource(TIPS_SOURCE);
        return;
      }
      const data = { type: 'FeatureCollection' as const, features };
      if (src) {
        src.setData(data);
        return;
      }
      mapInstance.addSource(TIPS_SOURCE, { type: 'geojson', data });
      const ramp = rampExpression(TROPOMI_RAMP, 'anomaly', 0, 60) as maplibregl.ExpressionSpecification;
      mapInstance.addLayer({
        id: `${TIPS_SOURCE}-marks`,
        type: 'circle',
        source: TIPS_SOURCE,
        maxzoom: 5,
        paint: {
          'circle-color': ramp,
          'circle-opacity': 0.9,
          'circle-radius': ['interpolate', ['linear'], ['get', 'anomaly'], 0, 6, 60, 16],
          'circle-stroke-color': '#e9eef3',
          'circle-stroke-width': ['case', ['==', ['get', 'emit'], 1], 1.5, 0.75],
          'circle-stroke-opacity': 0.9,
          'circle-pitch-alignment': 'map',
        },
      });
      mapInstance.addLayer({
        id: `${TIPS_SOURCE}-labels`,
        type: 'symbol',
        source: TIPS_SOURCE,
        maxzoom: 5,
        layout: {
          'symbol-sort-key': ['-', 0, ['get', 'anomaly']],
          'text-field': ['format', ['get', 'short'], { 'font-scale': 1 }, '\n', {}, ['get', 'label'], { 'font-scale': 0.85 }],
          'text-font': ['Atkinson Hyperlegible Mono', 'monospace'],
          'text-size': 17,
          'text-variable-anchor': ['right', 'left', 'top', 'bottom'],
          'text-radial-offset': 1.3,
          'text-justify': 'auto',
          'text-padding': 6,
        },
        paint: { 'text-color': '#e9eef3', 'text-halo-color': '#0f141b', 'text-halo-width': 2.5 },
      });
    };
    if (mapInstance.isStyleLoaded()) apply();
    else mapInstance.once('styledata', apply);
  }, [tips]);

  // The Dim Rule's current state, readable when a basemap layer is (re)created: the dim can be
  // decided before the basemap exists (a replay case lands every layer at once on load).
  const methaneOnStageRef = useRef(false);
  // The archaeologist's rest goes further: the satellite ground nearly gone, grey, under the relief.
  const applyBasemapDim = (mapInstance: maplibregl.Map, on: boolean, rest = restOnRef.current) => {
    const brightness = rest ? REST_BASEMAP.brightness : on ? 0.45 : 1;
    const saturation = rest ? REST_BASEMAP.saturation : on ? -0.6 : 0;
    BASEMAP_IDS.forEach((id) => {
      if (!mapInstance.getLayer(id)) return;
      mapInstance.setPaintProperty(id, 'raster-brightness-max-transition', { duration: 600, delay: 0 });
      mapInstance.setPaintProperty(id, 'raster-saturation-transition', { duration: 600, delay: 0 });
      mapInstance.setPaintProperty(id, 'raster-brightness-max', brightness);
      mapInstance.setPaintProperty(id, 'raster-saturation', saturation);
    });
  };

  // Function to update base map layer
  const updateBaseMapLayer = (style: 'dark' | 'google-roads' | 'google-satellite' | 'esri-satellite') => {
    if (!map.current) return;

    const mapInstance = map.current;

    // Remove existing base map layers
    ['dark-base', 'google-roads-base', 'google-satellite-base', 'esri-satellite-base'].forEach(layerId => {
      if (mapInstance.getLayer(layerId)) {
        mapInstance.removeLayer(layerId);
      }
    });

    // Remove existing base map sources
    ['dark-source', 'google-roads-source', 'google-satellite-source', 'esri-satellite-source'].forEach(sourceId => {
      if (mapInstance.getSource(sourceId)) {
        mapInstance.removeSource(sourceId);
      }
    });

    // Get first non-basemap layer for proper ordering
    const layers = mapInstance.getStyle().layers || [];
    const baseLayerIds = ['dark-base', 'google-roads-base', 'google-satellite-base', 'esri-satellite-base'];
    const firstNonBase = layers.find(layer => !baseLayerIds.includes(layer.id));
    const beforeId = firstNonBase?.id;

    // Add new base map layer based on style
    if (style === 'dark') {
      mapInstance.addSource('dark-source', {
        type: 'raster',
        tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '&copy; OpenStreetMap &copy; CARTO'
      });

      mapInstance.addLayer({
        id: 'dark-base',
        type: 'raster',
        source: 'dark-source',
        minzoom: 0,
        maxzoom: 22
      }, beforeId);
    } else if (style === 'google-roads') {
      mapInstance.addSource('google-roads-source', {
        type: 'raster',
        tiles: ['https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}'],
        tileSize: 256,
        attribution: '&copy; Google Maps'
      });

      mapInstance.addLayer({
        id: 'google-roads-base',
        type: 'raster',
        source: 'google-roads-source',
        minzoom: 0,
        maxzoom: 22
      }, beforeId);
    } else if (style === 'google-satellite') {
      mapInstance.addSource('google-satellite-source', {
        type: 'raster',
        tiles: ['https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'],
        tileSize: 256,
        attribution: '&copy; Google Maps'
      });

      mapInstance.addLayer({
        id: 'google-satellite-base',
        type: 'raster',
        source: 'google-satellite-source',
        minzoom: 0,
        maxzoom: 22
      }, beforeId);
    } else if (style === 'esri-satellite') {
      mapInstance.addSource('esri-satellite-source', {
        type: 'raster',
        tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        attribution: '© Esri'
      });

      mapInstance.addLayer({
        id: 'esri-satellite-base',
        type: 'raster',
        source: 'esri-satellite-source',
        minzoom: 0,
        maxzoom: 22
      }, beforeId);
    }
    // The sea hides whatever basemap is (re)created: the act's ground is the seabed.
    if (seaOnRef.current) sea.seaBasemap(mapInstance, BASEMAP_IDS, true);
  };

  // Handle base map style changes
  useEffect(() => {
    if (!map.current || !map.current.loaded()) return;
    updateBaseMapLayer(baseMapStyle);
  }, [baseMapStyle]);

  // Everything else dims while methane is on the stage: plasma only reads on dark ground. The same
  // for a regional change scan: its grid of squares vanished into the satellite basemap at state
  // scale, so the ground dims while the scan is the finding. Runs after the basemap effect above,
  // so a basemap switch mid-act comes back dimmed too.
  // And for the archaeologist's terrain: the hillshade is the lit specimen, the satellite ground
  // around its 3 km frame recedes to monochrome.
  const methaneOnStage = useMemo(
    () => layerGroups.methane.some((l) => rasterVisibility[l.id] !== false)
      || layerGroups.changeDetection.some((l) => rasterVisibility[l.id] !== false)
      // The regional scan's grid (scan_hotspots_*.geojson, cells with a change_score).
      || layerGroups.geometries.some((l) => /scan_hotspots|change_score/.test(l.url) && rasterVisibility[l.id] !== false)
      || allLayers.some((l) => l.type === 'raster' && isTerrainLayer(l) && rasterVisibility[l.id] !== false)
      // And the record at rest: the relief reads on a dark monochrome ground.
      || reliefOn,
    [layerGroups.methane, layerGroups.changeDetection, layerGroups.geometries, allLayers, rasterVisibility, reliefOn]
  );
  useEffect(() => {
    methaneOnStageRef.current = methaneOnStage;
    const mapInstance = map.current;
    if (!mapInstance) return;
    // Paint properties apply to any layer that exists, loaded tiles or not; waiting for `idle`
    // alone left a cold replay load bright while its tiles streamed in. Idle is the backstop for
    // a basemap that is still being created.
    const apply = () => applyBasemapDim(mapInstance, methaneOnStageRef.current, restOn);
    apply();
    mapInstance.once('idle', apply);
  }, [methaneOnStage, baseMapStyle, restOn]);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {},
        layers: []
      },
      center: [0, 20],
      zoom: 2,
      // The archaeologist's rest view stands at 65°; every other camera names its own pitch.
      maxPitch: MAX_PITCH,
      // Compact attribution: a small info button in the corner instead of a white bar under the plates.
      attributionControl: { compact: true },
      // maplibre-gl >= 5 takes WebGL context attributes in one nested object.
      canvasContextAttributes: {
        preserveDrawingBuffer: true,
        failIfMajorPerformanceCaveat: false,
      },
      transformRequest: (url) => {
        // Add API key for TiTiler requests
        if (url.startsWith(TITILER_URL) && TITILER_API_KEY) {
          return {
            url: url,
            headers: { 'x-api-key': TITILER_API_KEY }
          };
        }
        return { url };
      },
    });
    // Live once it has loaded: the sea's replay repaints its source every frame, and started on a
    // map that has not fired `load` yet, it keeps `load` from ever firing (no basemap, no drawing).
    const created = map.current;
    created.once('load', () => {
      if (map.current === created) setMapLive(true);
    });

    // Add global error listener
    map.current.on('error', (e) => {
      console.error('MapLibre error:', e);
    });
    // The layers plate tells a coarse raster's row when the map hides it this close in.
    map.current.on('zoomend', () => {
      if (map.current) setZoom(map.current.getZoom());
    });
    // The light plate's dial turns with the camera, once a move has settled.
    map.current.on('moveend', () => {
      if (map.current) setBearing(Math.round(map.current.getBearing()));
    });
    listenForTransects(map.current);
    // The headless capture harness reads the camera through this in a dev build; never in production.
    if (import.meta.env.DEV) {
      (window as unknown as { __stageMap?: maplibregl.Map }).__stageMap = map.current;
      (window as unknown as { __stageCamera?: () => unknown }).__stageCamera = () => {
        const m = map.current;
        if (!m) return null;
        const c = m.getCenter();
        const light = [...lightLayers.current].filter((id) => m.getLayer(id)).map((id) => ({
          id,
          azimuth: m.getPaintProperty(id, 'hillshade-illumination-direction'),
          altitude: m.getPaintProperty(id, 'hillshade-illumination-altitude'),
        }));
        const cursor = m.getSource(CURSOR_SOURCE) as maplibregl.GeoJSONSource | undefined;
        return {
          zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing(), lon: c.lng, lat: c.lat,
          terrain: m.getTerrain()?.exaggeration ?? null, relief: !!m.getLayer(RELIEF_LAYER), rest: restOnRef.current,
          light, cursor: !!cursor, transects: [...transects.current.keys()],
        };
      };
    }

    // Handle WebGL context loss - recreate map if context can't be restored
    const canvas = map.current.getCanvas();
    
    canvas.addEventListener('webglcontextlost', (e) => {
      console.warn('⚠️ WebGL context lost');
      e.preventDefault();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      console.log('✅ WebGL context restored');
      if (map.current) {
        map.current.resize();
        map.current.triggerRepaint();
      }
    });

    // Load initial basemap (dynamic, controlled by baseMapStyle state)
    map.current.once('load', () => {
      updateBaseMapLayer(baseMapStyle);
      // A replay case can put methane on the stage before the basemap exists: dim it on arrival.
      if (map.current) applyBasemapDim(map.current, methaneOnStageRef.current);
    });

    // Initialize draw control
    draw.current = new MapboxDraw({
      displayControlsDefault: false,
      controls: {},
      styles: [
        // Polygon fill
        {
          id: 'gl-draw-polygon-fill',
          type: 'fill',
          filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
          paint: {
            'fill-color': theme.colors.primary,
            'fill-opacity': 0.25
          }
        },
        // Polygon outline
        {
          id: 'gl-draw-polygon-stroke-active',
          type: 'line',
          filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
          paint: {
            'line-color': theme.colors.primary,
            'line-width': 3
          }
        },
        // Point
        {
          id: 'gl-draw-point',
          type: 'circle',
          filter: ['all', ['==', '$type', 'Point'], ['!=', 'mode', 'static']],
          paint: {
            'circle-radius': 8,
            'circle-color': theme.colors.primary,
            'circle-stroke-width': 2,
            'circle-stroke-color': theme.colors.onPrimary
          }
        },
        // Vertex points
        {
          id: 'gl-draw-polygon-and-line-vertex-active',
          type: 'circle',
          filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point']],
          paint: {
            'circle-radius': 5,
            'circle-color': theme.colors.onSurface
          }
        }
      ]
    });

    map.current.addControl(draw.current as any);

    // Listen for draw events. maplibre-gl-draw fires its own `draw.*` events on the map,
    // which maplibre-gl 6's strictly typed `on` does not know about, so widen the type here.
    const drawEvents = map.current as unknown as { on(type: string, listener: () => void): void };

    drawEvents.on('draw.create', () => {
      setHasDrawnFeatures(true);
    });

    drawEvents.on('draw.delete', () => {
      const data = draw.current?.getAll();
      setHasDrawnFeatures(data ? data.features.length > 0 : false);
    });

    drawEvents.on('draw.update', () => {
      setHasDrawnFeatures(true);
    });

    const waits = styleWaits.current;
    return () => {
      setMapLive(false);
      waits.forEach((w) => w.cancel());
      waits.clear();
      map.current?.remove();
    };
  }, []);

  // Add geometry when new geometry is loaded (persistent across turns)
  useEffect(() => {
    console.log(`📍 MapView geometry effect triggered. Geometry:`, geometry ? 'present' : 'null', geometry?.locationName);
    
    // Use requestAnimationFrame to ensure the map canvas is ready
    // before adding geometry. This avoids race conditions with map initialization.
    requestAnimationFrame(() => {
      if (!map.current || !geometry) return;
      const currentMap = map.current;
      
      const doAdd = () => {
        console.log(`📍 Processing geometry:`, geometry.locationName || 'unnamed');
        
        const timestamp = Date.now();
        const geometryId = `geometry-${timestamp}`;
        const fillLayerId = `${geometryId}-fill`;
        const outlineLayerId = `${geometryId}-outline`;
        
        console.log(`➕ Adding new geometry to map`);

        // Dark Vessels' files are the stage's by their own names: styled, stacked and staged as beats.
        if (vesselGeometryHint(geometry.render, geometry.sourceUrl)) {
          addSeaGeometry(currentMap, geometry, geometryId, fillLayerId);
          return;
        }

        // Detect a similarity result from find_similar_places: match cells carry a numeric
        // `similarity` and `tier: 'match'`; the example is `tier: 'query'`. Evidence colour:
        // a single-hue violet ramp (light = less alike, deep = more alike), never the accent.
        const isSimilarity = Array.isArray(geometry.features) &&
          geometry.features.some((f) =>
            f?.properties && f.properties.tier === 'match' && typeof f.properties.similarity === 'number');

        // Methane Watch layers: footprints (vector), the watch baseline (points) and the 3D
        // columns, by the validated hint or by the tools' own file names.
        const methaneHint: RenderHint | null = methaneGeometryHint(geometry.render, geometry.sourceUrl);
        const isMethane = methaneHint !== null;
        // The archaeologist's vectors: the transect across an earthwork, a site's frame, and the
        // catalogue's marks at rest. Fog, never a data ramp: these are places on the record.
        const terrainHint: RenderHint | null = isMethane ? null : terrainGeometryHint(geometry.render, geometry.sourceUrl);
        const isTerrain = terrainHint !== null;
        // The transect's marks carry the words the map prints (utils/transectMarks.ts).
        const isTransect = !!terrainHint && terrainHint.kind !== 'points' && !!terrainHint.label;

        try {
          currentMap.addSource(geometryId, {
            type: 'geojson',
            data: isTransect && terrainHint?.label
              ? { ...geometry, features: stageTransectFeatures(geometry.features, terrainHint.label) }
              : geometry,
          });

          // Detect a change-scan layer: cells carry a numeric change_score.
          // These render as a graduated density layer (green→red) with the
          // top-N hotspots (tier === 'top') highlighted by a bold outline.
          const isChangeScan = Array.isArray(geometry.features) &&
            geometry.features.some((f: any) =>
              f?.properties && typeof f.properties.change_score === 'number');

          // Detect a protected-area overlay (WDPA) emitted by protected_area_context.
          // These render as translucent purple polygons with a clickable info popup.
          const isProtectedArea = Array.isArray(geometry.features) &&
            geometry.features.some((f: any) =>
              f?.properties && f.properties.__layer_type === 'protected_area');

          if (terrainHint?.kind === 'points') {
            // The record at rest: a fog dot per catalogue site, a ring on a World Heritage one, the
            // name in mono beside it where it fits (the Hopewell cluster thins itself out). Gone
            // once the camera dives to a site.
            const heritage: maplibregl.FilterSpecification = ['==', ['get', 'world_heritage'], true];
            currentMap.addLayer({
              id: fillLayerId,
              type: 'circle',
              source: geometryId,
              maxzoom: MARKS_MAX_ZOOM,
              paint: {
                'circle-color': '#e9eef3',
                'circle-opacity': 0.9,
                'circle-radius': 4,
                // Upright to the room: at the rest view's 65° a ground-aligned dot is a dash.
                'circle-pitch-alignment': 'viewport',
              },
              layout: { visibility: 'visible' },
            });
            currentMap.addLayer({
              id: outlineLayerId,
              type: 'circle',
              source: geometryId,
              filter: heritage,
              maxzoom: MARKS_MAX_ZOOM,
              paint: {
                'circle-opacity': 0,
                'circle-radius': 9,
                'circle-stroke-color': '#e9eef3',
                'circle-stroke-width': 2,
                'circle-stroke-opacity': 0.9,
                'circle-pitch-alignment': 'viewport',
              },
              layout: { visibility: 'visible' },
            });
            // The names ride on their own points (utils/archaeoLayers.ts recordLabels): short names,
            // and one label for the eight Hopewell components that would otherwise collide into none.
            // Each carries the size that lands it at 15 px at the rest view's depth (sizeRestLabels).
            currentMap.addSource(`${geometryId}-points`, {
              type: 'geojson',
              data: recordLabels(geometry.features as Parameters<typeof recordLabels>[0]),
            });
            currentMap.addLayer({
              id: `${geometryId}-labels`,
              type: 'symbol',
              source: `${geometryId}-points`,
              maxzoom: MARKS_MAX_ZOOM,
              layout: {
                'symbol-sort-key': ['case', ['==', ['get', 'heritage'], true], 0, 1],
                'text-field': ['get', 'label'],
                'text-font': ['Atkinson Hyperlegible Mono', 'monospace'],
                'text-size': ['coalesce', ['get', 'size'], REST_LABEL_SIZE],
                'text-max-width': 9,
                'text-variable-anchor': ['left', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'],
                'text-radial-offset': 0.9,
                'text-justify': 'auto',
                'text-padding': 3,
                'text-optional': true,
                visibility: 'visible',
              },
              paint: { 'text-color': '#e9eef3', 'text-halo-color': '#0f141b', 'text-halo-width': 2 },
            });
            // The dots keep the names off them: an unseen glyph on each named site's dot (a ring's is
            // larger), placed before the names (it is above them) and always, so a name never covers
            // a neighbour's dot. The shared Hopewell label sits between its dots and keeps nothing out.
            currentMap.addLayer({
              id: `${geometryId}-keepout`,
              type: 'symbol',
              source: `${geometryId}-points`,
              filter: ['!=', ['get', 'group'], true],
              maxzoom: MARKS_MAX_ZOOM,
              layout: {
                // Any glyph the font surely has: only its box counts.
                'text-field': 'O',
                'text-font': ['Atkinson Hyperlegible Mono', 'monospace'],
                'text-size': ['case', ['==', ['get', 'heritage'], true], 16, 12],
                'text-allow-overlap': true,
                'text-ignore-placement': false,
                visibility: 'visible',
              },
              paint: { 'text-opacity': 0 },
            });
          } else if (isTerrain && terrainHint.label) {
            // The transect: a fog line across the earthwork on a dark casing (the relief model's
            // middle is near-white, and a bare fog line vanished into it), a mark where each bank
            // and ditch was read, and the tool's own label ("bank +1.8 m", "ditch −2.5 m") in mono
            // beside the four marks that define the span; the rises inside the ring are the
            // section's to read.
            const { line } = transectParts(geometry.features as Parameters<typeof transectParts>[0]);
            // The section cursor's line: where on the map a distance along the section falls.
            const profile = profileFromFeatures(geometry.features as Parameters<typeof profileFromFeatures>[0], geometry.sourceUrl);
            const lineCoords = (line?.geometry?.coordinates as Array<[number, number]> | undefined)
              ?.filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]));
            if (profile && lineCoords && lineCoords.length >= 2) {
              transects.current.set(profile.siteId, { coords: lineCoords.map((c) => [c[0], c[1]]), profile, layerId: fillLayerId });
            }
            const isLine: maplibregl.FilterSpecification = ['==', ['geometry-type'], 'LineString'];
            const isBank: maplibregl.FilterSpecification = ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'kind'], 'bank']];
            const isDitch: maplibregl.FilterSpecification = ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'kind'], 'ditch']];
            // Dome, not amber: amber on this line is the section cursor's dot alone.
            currentMap.addLayer({
              id: `${geometryId}-casing`,
              type: 'line',
              source: geometryId,
              filter: isLine,
              paint: { 'line-color': '#0f141b', 'line-width': 5.5, 'line-opacity': 0.85 },
              layout: { visibility: 'visible', 'line-cap': 'round' },
            });
            currentMap.addLayer({
              id: fillLayerId,
              type: 'line',
              source: geometryId,
              filter: isLine,
              paint: { 'line-color': '#e9eef3', 'line-width': 3, 'line-opacity': 0.95 },
              layout: { visibility: 'visible', 'line-cap': 'round' },
            });
            // A bank is a filled dot (the ground rises), a ditch a ring (the ground drops).
            currentMap.addLayer({
              id: outlineLayerId,
              type: 'circle',
              source: geometryId,
              filter: isBank,
              paint: { 'circle-color': '#e9eef3', 'circle-radius': 5, 'circle-opacity': 0.95, 'circle-pitch-alignment': 'map' },
              layout: { visibility: 'visible' },
            });
            currentMap.addLayer({
              id: `${geometryId}-hairline`,
              type: 'circle',
              source: geometryId,
              filter: isDitch,
              paint: {
                'circle-opacity': 0,
                'circle-radius': 5,
                'circle-stroke-color': '#e9eef3',
                'circle-stroke-width': 2,
                'circle-stroke-opacity': 0.95,
                'circle-pitch-alignment': 'map',
              },
              layout: { visibility: 'visible' },
            });
            // Placed with collision checks: a bank and its ditch 12 m apart take opposite sides
            // (the variable anchors), and a label that cannot fit is dropped, never overprinted.
            currentMap.addLayer({
              id: `${geometryId}-labels`,
              type: 'symbol',
              source: geometryId,
              filter: ['all', ['==', ['geometry-type'], 'Point'], ['!=', ['coalesce', ['get', 'stage_label'], ''], '']],
              layout: {
                'text-field': ['get', 'stage_label'],
                'text-font': ['Atkinson Hyperlegible Mono', 'monospace'],
                'text-size': 18,
                'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
                'text-radial-offset': 0.8,
                'text-justify': 'auto',
                'text-padding': 4,
                'text-allow-overlap': false,
                visibility: 'visible',
              },
              paint: { 'text-color': '#e9eef3', 'text-halo-color': '#0f141b', 'text-halo-width': 2.5 },
            });
          } else if (isTerrain) {
            // A site's frame: a dashed fog hairline, nothing filled; the ground inside it is the finding.
            currentMap.addLayer({
              id: fillLayerId,
              type: 'fill',
              source: geometryId,
              paint: { 'fill-color': '#e9eef3', 'fill-opacity': 0 },
              layout: { visibility: 'visible' },
            });
            currentMap.addLayer({
              id: outlineLayerId,
              type: 'line',
              source: geometryId,
              paint: { 'line-color': '#e9eef3', 'line-opacity': 0.5, 'line-width': 1.5, 'line-dasharray': [3, 2] },
              layout: { visibility: 'visible' },
            });
          } else if (methaneHint?.kind === 'points') {
            // The watch baseline on the globe: every site a small fog dot, sites seen on five or
            // more dates ringed and labelled "×N", the watch areas as dashed hairlines. Counts and
            // shapes only: no names. Fog, not plasma: dates are a count, not a measurement.
            const property = methaneHint.property ?? 'repeat_dates';
            const count: maplibregl.ExpressionSpecification = ['to-number', ['get', property], 1];
            const isPoint: maplibregl.FilterSpecification = ['==', ['geometry-type'], 'Point'];
            const repeat: maplibregl.FilterSpecification = ['all', isPoint, ['==', ['get', 'tier'], 'repeat']];
            currentMap.addLayer({
              id: `${geometryId}-hairline`,
              type: 'line',
              source: geometryId,
              filter: ['==', ['get', 'tier'], 'watch_area'],
              paint: { 'line-color': '#e9eef3', 'line-opacity': 0.5, 'line-width': 1.5, 'line-dasharray': [3, 2] },
              layout: { visibility: 'visible' },
            });
            currentMap.addLayer({
              id: fillLayerId,
              type: 'circle',
              source: geometryId,
              filter: isPoint,
              paint: {
                'circle-color': '#e9eef3',
                'circle-opacity': ['case', ['==', ['get', 'tier'], 'repeat'], 0.95, 0.55],
                'circle-radius': ['interpolate', ['linear'], count, 1, 2.5, 5, 4, 20, 6],
                'circle-pitch-alignment': 'map',
              },
              layout: { visibility: 'visible' },
            });
            currentMap.addLayer({
              id: outlineLayerId,
              type: 'circle',
              source: geometryId,
              filter: repeat,
              paint: {
                'circle-opacity': 0,
                'circle-radius': ['interpolate', ['linear'], count, 5, 9, 20, 15],
                'circle-stroke-color': '#e9eef3',
                'circle-stroke-width': 2,
                'circle-stroke-opacity': 0.9,
                'circle-pitch-alignment': 'map',
              },
              layout: { visibility: 'visible' },
            });
            currentMap.addLayer({
              id: `${geometryId}-labels`,
              type: 'symbol',
              source: geometryId,
              filter: repeat,
              layout: {
                'symbol-sort-key': ['-', 0, count],
                'text-field': ['concat', '×', ['to-string', count]],
                'text-font': ['Atkinson Hyperlegible Mono', 'monospace'],
                'text-size': 18,
                'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
                'text-radial-offset': 1.2,
                'text-padding': 4,
                visibility: 'visible',
              },
              paint: { 'text-color': '#e9eef3', 'text-halo-color': '#0f141b', 'text-halo-width': 2.5 },
            });
            // Popup: counts and ISO dates only; nothing model- or CMR-written reaches setHTML.
            currentMap.on('click', fillLayerId, (e: maplibregl.MapLayerMouseEvent) => {
              const p: Record<string, unknown> = (e.features && e.features[0] && e.features[0].properties) || {};
              const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 }) : 'n/a');
              const html =
                `<strong>Plumes on ${num(p[property])} ${Number(p[property]) === 1 ? 'date' : 'dates'}</strong>` +
                `<div class="similar-popup__row"><span>NASA plumes</span><code>${num(p.plumes)}</code></div>` +
                `<div class="similar-popup__row"><span>First</span><code>${isoDay(p.first)}</code></div>` +
                `<div class="similar-popup__row"><span>Last</span><code>${isoDay(p.last)}</code></div>`;
              new maplibregl.Popup({ className: 'similar-popup' }).setLngLat(e.lngLat).setHTML(html).addTo(currentMap);
            });
            currentMap.on('mouseenter', fillLayerId, () => {
              currentMap.getCanvas().style.cursor = 'pointer';
            });
            currentMap.on('mouseleave', fillLayerId, () => {
              currentMap.getCanvas().style.cursor = '';
            });
          } else if (methaneHint?.kind === 'detections') {
            // Carbon Mapper's plumes near the site: a mint ring on a dark halo each, flat on the
            // ground under the tilt, a second look from another catalogue (never a ramp: its rate
            // is in the popup and the board, as Carbon Mapper's estimate).
            const isPoint: maplibregl.FilterSpecification = ['==', ['geometry-type'], 'Point'];
            currentMap.addLayer({
              id: outlineLayerId,
              type: 'circle',
              source: geometryId,
              filter: isPoint,
              paint: {
                'circle-opacity': 0,
                'circle-radius': 7,
                'circle-stroke-color': '#0f141b',
                'circle-stroke-width': 5,
                'circle-stroke-opacity': 0.85,
                'circle-pitch-alignment': 'map',
              },
              layout: { visibility: 'visible' },
            });
            currentMap.addLayer({
              id: fillLayerId,
              type: 'circle',
              source: geometryId,
              filter: isPoint,
              paint: {
                'circle-color': DETECTIONS_COLOUR,
                'circle-opacity': 0.2,
                'circle-radius': 7,
                'circle-stroke-color': DETECTIONS_COLOUR,
                'circle-stroke-width': 2.5,
                'circle-pitch-alignment': 'map',
              },
              layout: { visibility: 'visible' },
            });
            // Popup: a date, a rate and an instrument word from the tool's own numbers and codes,
            // escaped by construction (detectionPopupRows returns only those), with the source.
            currentMap.on('click', fillLayerId, (e: maplibregl.MapLayerMouseEvent) => {
              const p: Record<string, unknown> = (e.features && e.features[0] && e.features[0].properties) || {};
              const html = detectionPopupHtml(p);
              new maplibregl.Popup({ className: 'similar-popup' }).setLngLat(e.lngLat).setHTML(html).addTo(currentMap);
            });
            currentMap.on('mouseenter', fillLayerId, () => {
              currentMap.getCanvas().style.cursor = 'pointer';
            });
            currentMap.on('mouseleave', fillLayerId, () => {
              currentMap.getCanvas().style.cursor = '';
            });
          } else if (methaneHint?.kind === 'columns') {
            // The strongest pass in 3D: one column per enhanced pixel, as tall as its ppm·m and
            // coloured on the same plasma ramp as the plume, read at a tilt.
            const property = methaneHint.property ?? 'ppm_m';
            const [lo, hi] = methaneHint.rescale ?? [0, 1500];
            const ramp =
              (rampExpression(methaneHint.ramp ?? 'plasma', property, lo, hi) as maplibregl.ExpressionSpecification | null) ??
              '#f89540';
            currentMap.addLayer({
              id: fillLayerId,
              type: 'fill-extrusion',
              source: geometryId,
              paint: {
                'fill-extrusion-color': ramp,
                // A hint may carry its own metres per unit (the tip bars' ppb); never below the ground.
                'fill-extrusion-height': ['max', 0, ['*', ['to-number', ['get', property], 0], methaneHint.height_scale ?? COLUMN_METRES_PER_PPM_M]],
                'fill-extrusion-base': 0,
                'fill-extrusion-opacity': 0.9,
              },
              layout: { visibility: 'visible' },
            });
          } else if (isMethane && methaneHint) {
            // Ranks 1-3 are lit: plasma outline graduated by the hint's property, a light fill, and
            // "#1 · 8,131 ppm·m" labels. Every other footprint is a fog hairline, a little brighter
            // before triage (nothing is ranked yet, so the count itself is the finding).
            const property = methaneHint.property ?? 'max_ppm_m';
            const [lo, hi] = methaneHint.rescale ?? [0, 1500];
            const ramp =
              (rampExpression(methaneHint.ramp ?? 'plasma', property, lo, hi) as maplibregl.ExpressionSpecification | null) ??
              '#f89540';
            const lit: maplibregl.FilterSpecification = ['<=', ['to-number', ['get', 'rank'], 9999], LIT_RANKS];
            const unlit: maplibregl.FilterSpecification = ['>', ['to-number', ['get', 'rank'], 9999], LIT_RANKS];
            const anyRanked = geometry.features.some((f) => Number.isFinite(Number(f?.properties?.rank)));
            const units = methaneHint.units ?? 'ppm·m';
            currentMap.addLayer({
              id: fillLayerId,
              type: 'fill',
              source: geometryId,
              filter: lit,
              // A breath of fill: some footprints are 70 km tall, and the outline carries the colour.
              paint: { 'fill-color': ramp, 'fill-opacity': 0.1 },
              layout: { visibility: 'visible' },
            });
            currentMap.addLayer({
              id: `${geometryId}-hairline`,
              type: 'line',
              source: geometryId,
              filter: unlit,
              paint: { 'line-color': '#e9eef3', 'line-opacity': anyRanked ? 0.4 : 0.75, 'line-width': anyRanked ? 1 : 1.5 },
              layout: { visibility: 'visible' },
            });
            currentMap.addLayer({
              id: outlineLayerId,
              type: 'line',
              source: geometryId,
              filter: lit,
              paint: { 'line-color': ramp, 'line-width': 3 },
              layout: { visibility: 'visible' },
            });
            // Labels stand on each footprint's east edge at its centre's latitude, beside the plume
            // and never across it (A2 P1-6), placed by rank with collision checks so #2 and #3
            // never print over each other.
            const centres = geometry.features.flatMap((f) => {
              const at = labelPointOutside(f as Parameters<typeof labelPointOutside>[0]);
              if (!at) return [];
              return [{ type: 'Feature' as const, properties: f?.properties ?? {}, geometry: { type: 'Point' as const, coordinates: at } }];
            });
            currentMap.addSource(`${geometryId}-points`, {
              type: 'geojson',
              data: { type: 'FeatureCollection', features: centres },
            });
            currentMap.addLayer({
              id: `${geometryId}-labels`,
              type: 'symbol',
              source: `${geometryId}-points`,
              filter: lit,
              layout: {
                'symbol-placement': 'point',
                'symbol-sort-key': ['to-number', ['get', 'rank'], 9999],
                'text-variable-anchor': ['left', 'top', 'bottom', 'right'],
                'text-radial-offset': 0.6,
                'text-field': [
                  'format',
                  ['concat', '#', ['to-string', ['get', 'rank']]], { 'font-scale': 1 },
                  '  ', {},
                  // One decimal, as in the table and the caption, so the room reads the same number everywhere.
                  ['concat', ['number-format', ['to-number', ['get', property], 0], { locale: 'en-US', 'max-fraction-digits': 1 }], ` ${units}`],
                  { 'font-scale': 0.75 },
                ] as maplibregl.ExpressionSpecification,
                'text-font': ['Atkinson Hyperlegible Mono', 'monospace'],
                'text-size': 24,
                'text-justify': 'auto',
                'text-padding': 4,
                visibility: 'visible',
              },
              paint: { 'text-color': '#e9eef3', 'text-halo-color': '#0f141b', 'text-halo-width': 2.5 },
            });
            // Popup: numbers and an ISO date only, so nothing model- or CMR-written reaches setHTML.
            currentMap.on('click', fillLayerId, (e: maplibregl.MapLayerMouseEvent) => {
              const p: Record<string, unknown> = (e.features && e.features[0] && e.features[0].properties) || {};
              const num = (v: unknown, digits: number) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString('en-US', { maximumFractionDigits: digits }) : '—');
              const acquired = typeof p.acquired === 'string' && /^\d{4}-\d{2}-\d{2}/.test(p.acquired) ? p.acquired.slice(0, 10) : '—';
              const html =
                `<strong>Plume ${num(p.rank, 0)}</strong>` +
                `<div class="similar-popup__row"><span>Peak</span><code>${num(p[property], 1)} ppm·m</code></div>` +
                `<div class="similar-popup__row"><span>Area ≥ 500</span><code>${num(p.plume_area_km2, 1)} km²</code></div>` +
                `<div class="similar-popup__row"><span>Acquired</span><code>${acquired}</code></div>`;
              new maplibregl.Popup({ className: 'similar-popup' }).setLngLat(e.lngLat).setHTML(html).addTo(currentMap);
            });
            currentMap.on('mouseenter', fillLayerId, () => {
              currentMap.getCanvas().style.cursor = 'pointer';
            });
            currentMap.on('mouseleave', fillLayerId, () => {
              currentMap.getCanvas().style.cursor = '';
            });
          } else if (isSimilarity) {
            const sims = geometry.features
              .map((f) => f?.properties?.similarity)
              .filter((s: unknown): s is number => typeof s === 'number');
            const lo = Math.min(...sims);
            const hi = Math.max(...sims);
            // Spread the ramp over the actual range so ten matches within 0.03 of each other
            // still read as a gradient; collapse to a flat colour when there is no range.
            const rampLo = hi - lo > 0.005 ? lo : hi - 0.01;
            currentMap.addLayer({
              id: fillLayerId,
              type: 'fill',
              source: geometryId,
              filter: ['==', ['get', 'tier'], 'match'],
              paint: {
                'fill-color': [
                  'interpolate', ['linear'], ['get', 'similarity'],
                  rampLo, '#e8dcf5',
                  (rampLo + hi) / 2, '#a678d6',
                  hi, '#5b2a86',
                ],
                'fill-opacity': 0.55,
              },
              layout: { visibility: 'visible' },
            });
            currentMap.addLayer({
              id: outlineLayerId,
              type: 'line',
              source: geometryId,
              filter: ['==', ['get', 'tier'], 'match'],
              paint: { 'line-color': '#5b2a86', 'line-width': 2 },
              layout: { visibility: 'visible' },
            });
            // The example itself: dashed cyan outline, no fill, so it reads as "the question".
            currentMap.addLayer({
              id: `${geometryId}-query`,
              type: 'line',
              source: geometryId,
              filter: ['==', ['get', 'tier'], 'query'],
              paint: { 'line-color': '#0FF', 'line-width': 2, 'line-dasharray': [2, 1.5] },
              layout: { visibility: 'visible' },
            });
            // Each match as a dot at its centre (the tool's center_lat/lon, else its box's middle),
            // so the matches read at state zoom where a 1 km cell is a speck; gone from zoom 9,
            // where the cells themselves are big enough.
            const matchCentres = geometry.features.flatMap((f) => {
              const p = f?.properties ?? {};
              if (p.tier !== 'match') return [];
              let lon = Number(p.center_lon);
              let lat = Number(p.center_lat);
              if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
                const b = featureBounds([f as Parameters<typeof featureBounds>[0][number]]);
                if (!b) return [];
                lon = (b[0] + b[2]) / 2;
                lat = (b[1] + b[3]) / 2;
              }
              return [{ type: 'Feature' as const, properties: p, geometry: { type: 'Point' as const, coordinates: [lon, lat] } }];
            });
            currentMap.addSource(`${geometryId}-points`, {
              type: 'geojson',
              data: { type: 'FeatureCollection', features: matchCentres },
            });
            currentMap.addLayer({
              id: `${geometryId}-dots`,
              type: 'circle',
              source: `${geometryId}-points`,
              maxzoom: 9,
              paint: {
                'circle-radius': 6,
                'circle-color': [
                  'interpolate', ['linear'], ['get', 'similarity'],
                  rampLo, '#e8dcf5',
                  (rampLo + hi) / 2, '#a678d6',
                  hi, '#5b2a86',
                ],
                'circle-stroke-color': '#0f141b',
                'circle-stroke-width': 1.5,
              },
              layout: { visibility: 'visible' },
            });
            // Rank labels beside the dots (Back Row rule: 24 px, mono, halo), ranks 1 to 5 only (the
            // answer's table stops at five), placed by rank with collision checks so no two numerals
            // print over each other. The style has no glyphs server; maplibre >= 5.11 renders
            // text-font with local fonts.
            currentMap.addLayer({
              id: `${geometryId}-labels`,
              type: 'symbol',
              source: `${geometryId}-points`,
              filter: ['<=', ['to-number', ['get', 'rank'], 99], 5],
              layout: {
                'symbol-placement': 'point',
                'symbol-sort-key': ['to-number', ['get', 'rank'], 99],
                'text-field': ['to-string', ['get', 'rank']],
                'text-font': ['Atkinson Hyperlegible Mono', 'monospace'],
                'text-size': 24,
                'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
                'text-radial-offset': 0.9,
                'text-allow-overlap': false,
                'text-ignore-placement': false,
                'text-padding': 4,
                visibility: 'visible',
              },
              paint: {
                'text-color': '#ffffff',
                'text-halo-color': '#2a1240',
                'text-halo-width': 2,
              },
            });
            // Popup with the numbers only (rank, similarity, centre) so nothing model-written
            // is ever injected into setHTML. A match opens from its cell, its dot or its rank:
            // one listener for the three layers, so a rank label standing over another match's
            // cell opens one popup, for the label's own match (clickedMatch).
            const matchLayers = [`${geometryId}-labels`, `${geometryId}-dots`, fillLayerId];
            const openMatch = (e: maplibregl.MapLayerMouseEvent) => {
              const p: Record<string, unknown> = clickedMatch(e.features, matchLayers)?.properties || {};
              const rank = Number.isFinite(Number(p.rank)) ? Number(p.rank) : null;
              const sim = Number.isFinite(Number(p.similarity)) ? Number(p.similarity).toFixed(4) : null;
              const lat = Number.isFinite(Number(p.center_lat)) ? Number(p.center_lat).toFixed(4) : null;
              const lon = Number.isFinite(Number(p.center_lon)) ? Number(p.center_lon).toFixed(4) : null;
              const km = Number.isFinite(Number(p.distance_km)) ? Number(p.distance_km).toFixed(1) : null;
              const html =
                `<strong>${rank !== null ? `Match ${rank}` : 'Match'}</strong>` +
                `<div class="similar-popup__row"><span>Similarity</span><code>${sim ?? '—'}</code></div>` +
                `<div class="similar-popup__row"><span>Centre</span><code>${lat ?? '—'}, ${lon ?? '—'}</code></div>` +
                (km !== null ? `<div class="similar-popup__row"><span>From example</span><code>${km} km</code></div>` : '');
              new maplibregl.Popup({ className: 'similar-popup' }).setLngLat(e.lngLat).setHTML(html).addTo(currentMap);
            };
            currentMap.on('click', matchLayers, openMatch);
            for (const id of matchLayers) {
              currentMap.on('mouseenter', id, () => {
                currentMap.getCanvas().style.cursor = 'pointer';
              });
              currentMap.on('mouseleave', id, () => {
                currentMap.getCanvas().style.cursor = '';
              });
            }
          } else if (isChangeScan) {
            currentMap.addLayer({
              id: fillLayerId,
              type: 'fill',
              source: geometryId,
              paint: {
                'fill-color': [
                  'interpolate', ['linear'], ['get', 'change_score'],
                  0.0, '#1a9850',
                  0.25, '#a6d96a',
                  0.5, '#fee08b',
                  0.75, '#fdae61',
                  1.0, '#d73027',
                ],
                'fill-opacity': 0.5,
              },
              layout: { visibility: 'visible' },
            });
            // Highlight ONLY the top-N hotspots with a bold, bright outline
            currentMap.addLayer({
              id: outlineLayerId,
              type: 'line',
              source: geometryId,
              filter: ['==', ['get', 'tier'], 'top'],
              paint: { 'line-color': '#00e5ff', 'line-width': 3 },
              layout: { visibility: 'visible' },
            });
          } else if (isProtectedArea) {
            // Protected areas (WDPA): translucent purple fill + purple outline
            currentMap.addLayer({
              id: fillLayerId,
              type: 'fill',
              source: geometryId,
              paint: { 'fill-color': '#8e44ad', 'fill-opacity': 0.25 },
              layout: { visibility: 'visible' },
            });
            currentMap.addLayer({
              id: outlineLayerId,
              type: 'line',
              source: geometryId,
              paint: { 'line-color': '#8e44ad', 'line-width': 2 },
              layout: { visibility: 'visible' },
            });
            // Clickable popup showing the protected area's attributes
            currentMap.on('click', fillLayerId, (e: any) => {
              const p = (e.features && e.features[0] && e.features[0].properties) || {};
              const html =
                `<strong>${p.name || 'Protected Area'}</strong><br/>` +
                (p.designation ? `${p.designation}<br/>` : '') +
                (p.iucn_cat ? `IUCN: ${p.iucn_cat}<br/>` : '') +
                (p.status_yr ? `Designated: ${p.status_yr}` : '');
              new maplibregl.Popup().setLngLat(e.lngLat).setHTML(html).addTo(currentMap);
            });
            currentMap.on('mouseenter', fillLayerId, () => {
              currentMap.getCanvas().style.cursor = 'pointer';
            });
            currentMap.on('mouseleave', fillLayerId, () => {
              currentMap.getCanvas().style.cursor = '';
            });
          } else {
            // Boundary geometry: transparent fill + cyan outline (default)
            currentMap.addLayer({
              id: fillLayerId,
              type: 'fill',
              source: geometryId,
              paint: { 'fill-color': '#088', 'fill-opacity': 0 },
              layout: { visibility: 'visible' },
            });

            currentMap.addLayer({
              id: outlineLayerId,
              type: 'line',
              source: geometryId,
              paint: { 'line-color': '#0FF', 'line-width': 3 },
              layout: { visibility: 'visible' },
            });
          }
        } catch (err) {
          console.error('❌ Error adding geometry to map:', err);
          return;
        }

        let name = geometry.locationName || 'Boundary';
        if (!geometry.locationName && geometry.features.length > 0 && geometry.features[0].properties) {
          const props = geometry.features[0].properties;
          name = props.name || props.location || props.display_name || 
                 props.place_name || props.title || 'Boundary';
        }
        
        const bounds = new maplibregl.LngLatBounds();
        let coordCount = 0;
        geometry.features.forEach((feature) => {
          const geom = feature.geometry;
          if (!geom) return;
          if (geom.type === 'Polygon') {
            geom.coordinates[0].forEach((coord: number[]) => {
              if (Array.isArray(coord) && coord.length >= 2) {
                bounds.extend(coord as [number, number]);
                coordCount++;
              }
            });
          } else if (geom.type === 'MultiPolygon') {
            geom.coordinates.forEach((polygon: number[][][]) => {
              polygon[0].forEach((coord: number[]) => {
                if (Array.isArray(coord) && coord.length >= 2) {
                  bounds.extend(coord as [number, number]);
                  coordCount++;
                }
              });
            });
          } else if (geom.type === 'Point') {
            bounds.extend(geom.coordinates as [number, number]);
            coordCount++;
          } else if (geom.type === 'LineString') {
            geom.coordinates.forEach((coord: number[]) => {
              if (Array.isArray(coord) && coord.length >= 2) {
                bounds.extend(coord as [number, number]);
                coordCount++;
              }
            });
          }
        });

        // Guard against an empty/degenerate geometry: getSouthWest() throws on
        // never-extended bounds (e.g. a FeatureCollection with no features),
        // which previously crashed the whole map. Register the layer without
        // bounds and skip fitBounds in that case.
        if (coordCount === 0) {
          console.warn(`⚠️ Geometry "${name}" has no usable coordinates; skipping fitBounds`);
          setAllLayers(prev => [...prev, {
            id: fillLayerId,
            sourceId: geometryId,
            name: name,
            url: JSON.stringify(geometry.features).substring(0, 200),
            type: 'geometry',
            bounds: undefined
          }]);
          placeInStack(fillLayerId, 'top');
          return;
        }

        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        const boundsArray: [number, number, number, number] = [sw.lng, sw.lat, ne.lng, ne.lat];

        setAllLayers(prev => [...prev, {
          id: fillLayerId,
          sourceId: geometryId,
          name: name,
          // The s3:// URL when the collection came from display_visual (drives the layers-plate
          // grouping); a features excerpt for drawn/ad-hoc geometry.
          url: geometry.sourceUrl || JSON.stringify(geometry.features).substring(0, 200),
          type: 'geometry',
          bounds: boundsArray,
          ...(methaneHint ? { render: methaneHint } : terrainHint ? { render: terrainHint } : {}),
        }]);
        // A new vector lands on top; the watch baseline (sites, rings, watch areas) lands under the
        // other vectors and over the imagery, so the columns and footprints read over it.
        placeInStack(fillLayerId, isMethane && methaneHint?.kind === 'points' ? 'aboveImagery' : 'top');
        
        console.log(`✅ Geometry added:`, name, `bounds:`, boundsArray);

        if (isTerrain) {
          // One record on the map at a time (a reset re-lands it); a second transect of the same
          // site replaces the first.
          allLayersRef.current
            .filter((l) => l.type === 'geometry' && l.id !== fillLayerId && isTerrainLayer(l) &&
              (terrainGeometryHint(l.render, l.url)?.kind ?? 'vector') === terrainHint.kind &&
              (terrainHint.kind === 'points' || !!terrainGeometryHint(l.render, l.url)?.label === !!terrainHint.label))
            .forEach((l) => removeLayer(l.id));
          if (terrainHint.kind === 'points') {
            // The record at rest: the whole catalogue in the frame, clear of the plates, seen from
            // low over the Gulf with the horizon in view (see restCameraFor). With anything else
            // already on the stage (a record re-landed mid-act) it frames flat, as before.
            const onlyRecord = allLayersRef.current.every((l) => l.id === fillLayerId ||
              (l.type === 'geometry' && terrainGeometryHint(l.render, l.url)?.kind === 'points'));
            const cam = onlyRecord && !groundOnRef.current ? restCameraFor(currentMap, geometry.features) : null;
            if (cam) {
              sizeRestLabels(currentMap, geometryId, geometry.features, cam);
              currentMap.flyTo({ ...cam, duration: 2400 });
            } else {
              const all = marksBounds(geometry.features as Parameters<typeof marksBounds>[0]) ?? boundsArray;
              fitStage(currentMap, [[all[0], all[1]], [all[2], all[3]]], {
                padding: STAGE_PADDING_NOW(), duration: 1800, maxZoom: 6, pitch: 0, bearing: 0,
              });
            }
          } else if (terrainHint.label) {
            // The transect: the camera comes down to the earthwork, on the ground's own tilt.
            fitStage(currentMap, bounds, {
              padding: STAGE_PADDING_NOW(), duration: 1800, maxZoom: TRANSECT_MAX_ZOOM,
              pitch: groundOnRef.current ? GROUND_PITCH : 0, bearing: groundOnRef.current ? GROUND_BEARING : 0,
            });
          } else if (!groundOnRef.current) {
            // A site's frame before any terrain: frame it flat (out of the rest view's tilt); the
            // terrain that follows tilts the view.
            fitStage(currentMap, bounds, { padding: STAGE_PADDING_NOW(), duration: 1500, maxZoom: FRAME_MAX_ZOOM, pitch: 0, bearing: 0 });
          }
          return;
        }

        // The ranked footprints replace the detected ones (same plumes, now measured): one set of
        // outlines on the stage, never two stacked.
        if (isMethane && methaneHint) {
          if (methaneHint.kind === 'columns') {
            // The bars (approved 2026-10-26): one bar layer stands on the map at a time, and the flat
            // TROPOMI composite steps back for them, but what they replace stays in the layers list,
            // unticked, so the presenter can tick it back (the tip bars under the record bars). Only
            // the same file shown again replaces its first showing.
            const { remove, hide } = barLanding(allLayersRef.current, {
              id: fillLayerId, type: 'geometry', url: geometry.sourceUrl || '', render: methaneHint,
            });
            remove.forEach((id) => removeLayer(id));
            if (hide.length > 0) setRasterVisibility((prev) => ({ ...prev, ...Object.fromEntries(hide.map((id) => [id, false])) }));
          } else {
            // Same kind replaces same kind (ranked footprints replace detected ones; a second
            // baseline replaces the first); the baseline stays under the columns and the footprints.
            allLayersRef.current
              .filter((l) => l.type === 'geometry' && l.id !== fillLayerId && isMethaneLayer(l) &&
                (methaneGeometryHint(l.render, l.url)?.kind ?? 'vector') === methaneHint.kind)
              .forEach((l) => removeLayer(l.id));
          }
          const rasterOnStage = plumeFramed.current || allLayersRef.current.some((l) => l.type === 'raster' && isMethaneLayer(l));
          if (methaneHint.kind === 'points') {
            // The watch globe: the whole baseline at once, facing the watch areas.
            setGlobeOn(true);
            if (!rasterOnStage) {
              const centre = globeCentre(geometry.features as Parameters<typeof globeCentre>[0]);
              // The globe sits in space between the plates: the column and the layers plate at the
              // sides, the console below (as measured), a margin at the top (no plate there at
              // rest). Padding, not an offset: on the globe an offset only turns the sphere, and
              // the disc stayed in the middle of the frame, under the console at 1280x720. The
              // map keeps this padding until the next finding's fit eases it out (fitStage), or a
              // clear lets it go: no fit is ever padded twice (GB-R2).
              const globePad = { ...STAGE_PADDING_NOW(), top: 24 };
              const box = currentMap.getContainer();
              currentMap.easeTo({
                center: centre ?? [40, 30],
                zoom: globeZoom(box.clientWidth, box.clientHeight, globePad),
                padding: globePad,
                pitch: 0,
                bearing: 0,
                duration: 2000,
              });
            }
          } else if (methaneHint.kind === 'detections') {
            // Carbon Mapper's rings land where the camera already is: the TROPOMI tip or the columns
            // own the frame, and the rings read when the dive reaches the site.
          } else if (methaneHint.kind === 'columns') {
            frameColumns(currentMap, boundsArray, geometry.sourceUrl);
          } else if (!rasterOnStage) {
            // The frame rule, methane edition: once a plume raster is on the stage it owns the frame
            // (a replay case lands the footprints and the plume together; the plume wins). A set
            // that spans the world frames its top ranks, or rank 1 (A2 P1-7), never the box's
            // middle (Utah to New South Wales is centred on Africa). Rank 1 alone is framed as a
            // point at zoom 5, clear of the plates, by a fit (an easeTo with padding would leave
            // it on the map, GB-R2), and eases so the globe stays a globe on the way.
            const frame = footprintFrame(geometry.features as Parameters<typeof footprintFrame>[0]);
            if (frame && 'center' in frame) {
              fitStage(currentMap, pointBox(frame.center), {
                padding: STAGE_PADDING_NOW(), maxZoom: frame.zoom, pitch: 0, bearing: 0, duration: 1800, linear: true,
              });
            } else {
              const b = frame?.bounds;
              fitStage(currentMap, b ? [[b[0], b[1]], [b[2], b[3]]] : bounds, { padding: STAGE_PADDING_NOW(), duration: 1500, maxZoom: 11 });
            }
          }
          return;
        }

        // The frame rule: once a ranked "similar places" map is on the stage, a geometry that
        // lies inside it (a match's bbox, a drill-down) does not steal the frame. The row's
        // name still flies there on demand. Anything outside the ranked map, or the ranked map
        // itself, fits as before.
        const rankedMap = allLayersRef.current.find(isSimilarityLayer);
        const keepFrame = !!rankedMap && !isSimilarity && boundsWithin(boundsArray, rankedMap.bounds);
        if (keepFrame) {
          console.log(`🖼️ Keeping the ranked map in frame; not fitting to`, name);
        } else {
          // Every act frames its finding clear of the plates (the step column, the caption band,
          // the layers plate), so what the camera lands on is what the room sees.
          fitStage(currentMap, bounds, {
            padding: isSimilarity ? SIMILARITY_PADDING_NOW() : STAGE_PADDING_NOW(), duration: 1500, maxZoom: 15,
            ...(groundOnRef.current ? { pitch: GROUND_PITCH, bearing: GROUND_BEARING } : {}),
          });
          console.log(`🎯 fitBounds called`);
        }
      };

      // isStyleLoaded() is false while any source is loading (the basemap's tiles streaming, the
      // source the geometry before this one just added), and the events it waited for may never
      // come: the similarity map was lost that way (P0-3). The wait polls, and once the style's
      // JSON is in it adds the geometry while the tiles stream (utils/styleReady.ts).
      const wait = { cancel: () => {} };
      let ran = false;
      wait.cancel = whenStyleReady(currentMap, () => {
        ran = true;
        styleWaits.current.delete(wait);
        if (map.current === currentMap) doAdd();
      }, { label: `Geometry "${geometry.locationName || 'unnamed'}"` });
      if (!ran) styleWaits.current.add(wait);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry]);



  // Handle drawing mode changes
  const handleDrawMode = (mode: 'none' | 'point' | 'polygon') => {
    if (!draw.current) return;

    setDrawMode(mode);

    if (mode === 'none') {
      draw.current.changeMode('simple_select');
    } else if (mode === 'point') {
      draw.current.changeMode('draw_point');
    } else if (mode === 'polygon') {
      draw.current.changeMode('draw_polygon');
    }
  };

  // Clear all drawn features
  const clearDrawnFeatures = () => {
    if (!draw.current) return;
    draw.current.deleteAll();
    setHasDrawnFeatures(false);
    setDrawMode('none');
  };

  // The rail leaves (the archaeologist's act): no drawing mode or drawn shape stays behind it.
  useEffect(() => {
    if (drawRail) return;
    try {
      draw.current?.deleteAll();
      draw.current?.changeMode('simple_select');
    } catch {
      // The draw control is not connected yet (the map is still loading): nothing is drawn.
    }
    setDrawMode('none');
    setHasDrawnFeatures(false);
  }, [drawRail]);

  // Send drawn geometry to chat
  const sendDrawnGeometryToChat = () => {
    if (!draw.current || !onDrawnGeometry) return;

    const data = draw.current.getAll();
    if (data.features.length === 0) return;

    // Send the GeoJSON to the parent component
    onDrawnGeometry(data);

    // Clear the drawn features after sending
    clearDrawnFeatures();
  };

  // Fly to a specific layer's bounds
  // The rest view's camera for the record: pitched 65°, looking up the valleys, fitted by looking
  // (fitBounds picks its zoom as if flat). The sites keep below the top fifth of the window so the
  // land runs on to a horizon above them; the jumps are undone before anything is drawn.
  const restCameraFor = (mapInstance: maplibregl.Map, features: GeometryData['features']): Camera | null => {
    const points = (features ?? [])
      .flatMap((f) => (f?.geometry?.type === 'Point' ? [f.geometry.coordinates as [number, number]] : []))
      .filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]));
    const b = marksBounds(features as Parameters<typeof marksBounds>[0]);
    if (points.length < 2 || !b) return null;
    const box = mapInstance.getContainer();
    const size = { width: box.clientWidth, height: box.clientHeight };
    const stage = STAGE_PADDING_NOW();
    // Room for the names beside the dots, and the sky band over the farthest site. At rest the step
    // column is down, so the record takes the stage's whole width; with steps up it keeps clear.
    const columnUp = typeof document !== 'undefined' && !!document.querySelector('.stage-steps');
    const pad = {
      top: Math.max(stage.top, Math.round(size.height * REST_TOP_SHARE)),
      bottom: stage.bottom,
      left: columnUp ? stage.left + 40 : REST_EDGE,
      right: stage.right + 40,
    };
    const flat = mapInstance.cameraForBounds([[b[0], b[1]], [b[2], b[3]]], { padding: stage, bearing: REST_BEARING });
    if (!flat?.center || typeof flat.zoom !== 'number') return null;
    const c = maplibregl.LngLat.convert(flat.center);
    const start: Camera = { center: [c.lng, c.lat], zoom: flat.zoom, pitch: REST_PITCH, bearing: REST_BEARING };
    const before = { center: mapInstance.getCenter(), zoom: mapInstance.getZoom(), pitch: mapInstance.getPitch(), bearing: mapInstance.getBearing() };
    const lens = (cam: Camera) => {
      mapInstance.jumpTo(cam);
      return {
        project: (p: [number, number]): [number, number] => {
          const q = mapInstance.project(p);
          return [q.x, q.y];
        },
        unproject: (px: [number, number]): [number, number] => {
          const q = mapInstance.unproject(px);
          return [q.lng, q.lat];
        },
      };
    };
    let cam: Camera;
    try {
      cam = fitPitched(points, start, size, pad, lens);
    } finally {
      mapInstance.jumpTo(before);
    }
    // A fit that ran off (a point projected past the horizon on the way) falls back to the flat
    // fit's centre, a little closer in: the view is still pitched and still holds the record.
    const sane = Number.isFinite(cam.zoom) && cam.zoom > flat.zoom - 1 && cam.zoom < flat.zoom + 2.5 &&
      Number.isFinite(cam.center[0]) && Number.isFinite(cam.center[1]);
    return sane ? cam : { ...start, zoom: flat.zoom + 0.5 };
  };

  // The record's names at the rest camera: MapLibre draws a name smaller the farther off it is, so
  // each gets the size that lands it at no less than 15 px there (utils/restCamera.ts sizeAtLeast).
  // The jump is undone before anything is drawn.
  const sizeRestLabels = (mapInstance: maplibregl.Map, sourceId: string, features: GeometryData['features'], cam: Camera) => {
    const src = mapInstance.getSource(`${sourceId}-points`) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const labels = recordLabels(features as Parameters<typeof recordLabels>[0]);
    const height = mapInstance.getContainer().clientHeight;
    const p = mapInstance.getPadding();
    const top = p.top ?? 0, bottom = p.bottom ?? 0;
    const centreY = top + (height - top - bottom) / 2;
    const fov = mapInstance.getVerticalFieldOfView();
    const before = { center: mapInstance.getCenter(), zoom: mapInstance.getZoom(), pitch: mapInstance.getPitch(), bearing: mapInstance.getBearing() };
    try {
      mapInstance.jumpTo(cam);
      for (const f of labels.features) {
        const y = mapInstance.project(f.geometry.coordinates).y;
        if (Number.isFinite(y)) f.properties.size = sizeAtLeast(REST_LABEL_SIZE, labelPerspective(y, height, cam.pitch, fov, centreY));
      }
    } finally {
      mapInstance.jumpTo(before);
    }
    src.setData(labels);
  };

  // The columns are read at a tilt, over the pass they were built from: as they land, and when the
  // presenter ticks a kept bar layer back on. Framed with the stage's padding only; any padding the
  // globe left on the map eases out on the way.
  const frameColumns = (mapInstance: maplibregl.Map, box: [number, number, number, number], url: string | undefined) => {
    const cam = cameraForStage(mapInstance, [[box[0], box[1]], [box[2], box[3]]], { padding: STAGE_PADDING_NOW() });
    plumeFramed.current = true;
    mapInstance.easeTo({
      ...(cam?.center ? { center: cam.center } : {}),
      // The tip bars span ±15 km, so they are read from further out; Carbon Mapper's 30 m plume
      // image is about 1.5 km across, so it is read closer in; EMIT's 60 m columns in between.
      zoom: Math.min(cam?.zoom ?? 12, COLUMNS_MAX_ZOOM[barKind(url) ?? 'emit']),
      pitch: COLUMNS_PITCH,
      bearing: -20,
      padding: NO_PADDING,
      duration: 2200,
    });
  };

  const flyToLayer = (layerId: string) => {
    if (!map.current) return;
    
    const layer = allLayersRef.current.find(l => l.id === layerId);
    if (!layer || !layer.bounds) return;
    
    const mapInstance = map.current;
    // The record's row at rest goes back to the rest view, not to a flat fit of its bounds.
    if (restOnRef.current && layer.type === 'geometry' && terrainGeometryHint(layer.render, layer.url)?.kind === 'points') {
      const src = mapInstance.getSource(layer.sourceId) as maplibregl.GeoJSONSource | undefined;
      const data = src?.serialize().data as GeometryData | undefined;
      const cam = data && typeof data === 'object' && Array.isArray(data.features) ? restCameraFor(mapInstance, data.features) : null;
      if (cam && data) {
        sizeRestLabels(mapInstance, layer.sourceId, data.features, cam);
        mapInstance.flyTo({ ...cam, duration: 1500 });
        return;
      }
    }
    const [west, south, east, north] = layer.bounds;
    // A coarse raster is only drawn below its zoom cap: land half a level under it.
    const cap = layer.type === 'raster' ? layer.render?.max_zoom : undefined;
    
    fitStage(
      mapInstance,
      [[west, south], [east, north]],
      {
        padding: isSimilarityLayer(layer) ? SIMILARITY_PADDING_NOW() : STAGE_PADDING_NOW(),
        duration: 1500,
        maxZoom: typeof cap === 'number' ? Math.max(1, cap - 0.5) : groundOnRef.current ? TRANSECT_MAX_ZOOM : 15,
        // On the archaeologist's ground every flight keeps the low oblique view.
        ...(groundOnRef.current ? { pitch: GROUND_PITCH, bearing: GROUND_BEARING } : {}),
      }
    );
    
    console.log(`🎯 Flying to layer:`, layer.name);
  };

  // A geometry's fill layer travels with its companions: the outline, and for a similarity
  // result the dashed query outline and the rank labels.
  // Dark Vessels' files carry more (their rings, halos, hairlines, hit areas: seaStage.ts).
  const geometryCompanionIds = (fillLayerId: string) =>
    ['-casing', '-outline', '-query', '-dots', '-labels', '-keepout', '-hairline', ...sea.SEA_COMPANION_SUFFIXES].map(suffix => fillLayerId.replace('-fill', suffix));
  // Every map layer that travels with a listed one: a geometry's fill companions, a raster's light
  // (and the radar's sweep while it draws).
  const companionIds = (id: string) => (id.startsWith('cogLayer-') ? [`${id}${LIGHT_SUFFIX}`, `${id}-sweep`] : geometryCompanionIds(id));

  // Put the stack (top first) on the map: per listed layer, its map layers in their current order
  // (a geometry's fill, hairline, outline, labels travel together), bottom group first, each
  // directly beneath the ceiling (the presenter's drawn shapes and the globe's tips stay on top).
  // Also the live preview while a row is held in the layers plate.
  const applyLayerOrder = (order: string[]) => {
    const mapInstance = map.current;
    if (!mapInstance) return;
    const style = mapInstance.getLayersOrder();
    const groups = order
      .map((id) => {
        const members = new Set([id, ...companionIds(id)]);
        return style.filter((sid) => members.has(sid));
      })
      .filter((g) => g.length > 0);
    // The rest relief and the seabed are part of the floor, like the basemap: the stack draws over them.
    const ceiling = stackCeiling(style, new Set(groups.flat()), [...BASEMAP_IDS, RELIEF_LAYER, ...sea.SEA_FLOOR_IDS]);
    for (const [id, beforeId] of stackMoves(groups, ceiling)) {
      mapInstance.moveLayer(id, beforeId);
    }
  };

  // A new layer joins the stack (see insertInStack for where), and the map follows.
  const placeInStack = (id: string, place: StackPlace) => {
    const rasterIds = new Set(allLayersRef.current.filter((l) => l.type === 'raster').map((l) => l.id));
    const isRaster = (x: string) => rasterIds.has(x) || x.startsWith('cogLayer-');
    layerOrderRef.current = insertInStack(layerOrderRef.current, id, place, isRaster);
    applyLayerOrder(layerOrderRef.current);
    setLayerOrder(layerOrderRef.current);
  };
  const dropFromStack = (id: string) => {
    layerOrderRef.current = layerOrderRef.current.filter((x) => x !== id);
    setLayerOrder(layerOrderRef.current);
  };

  // A reorder from the layers plate: the state, the ref and the map. A layer that landed while
  // the row was held (not in `order`) keeps the place it was given.
  const commitLayerOrder = (order: string[]) => {
    const current = layerOrderRef.current;
    const kept = order.filter((id) => current.includes(id));
    const next = [...kept];
    current.forEach((id, i) => {
      if (!kept.includes(id)) next.splice(Math.min(i, next.length), 0, id);
    });
    layerOrderRef.current = next;
    setLayerOrder(next);
    applyLayerOrder(next);
  };

  // Remove a specific layer. Reads the ref, not the state, so the geometry loader (which closes
  // over an older render) can replace a layer it did not see in its own closure.
  const removeLayer = (layerId: string) => {
    if (!map.current) return;

    const layer = allLayersRef.current.find(l => l.id === layerId);
    if (!layer) return;

    const mapInstance = map.current;

    if (layer.type === 'geometry') {
      // Geometry has a fill layer plus its companion layers
      [layer.id, ...geometryCompanionIds(layer.id)].forEach(id => {
        if (mapInstance.getLayer(id)) {
          mapInstance.removeLayer(id);
        }
      });
      // The geometry's own source, and the label points a methane layer adds beside it.
      [layer.sourceId, `${layer.sourceId}-points`].forEach(id => {
        if (mapInstance.getSource(id)) mapInstance.removeSource(id);
      });
      // A transect that leaves takes the section cursor's line with it.
      transects.current.forEach((t, siteId) => {
        if (t.layerId === layer.id) {
          transects.current.delete(siteId);
          if (getSectionCursor()?.siteId === siteId) setSectionCursor(null);
        }
      });
    } else {
      // Raster layer, and the live light over a hillshade with its DEM source.
      [layer.id, `${layer.id}${LIGHT_SUFFIX}`].forEach((id) => {
        if (mapInstance.getLayer(id)) mapInstance.removeLayer(id);
      });
      [layer.sourceId, `${layer.sourceId}-dem`].forEach((id) => {
        if (mapInstance.getSource(id)) mapInstance.removeSource(id);
      });
      forgetLight(`${layer.id}${LIGHT_SUFFIX}`);
      // Its tile listeners and its failed flag go with it.
      tileWatch.current.get(layer.id)?.();
      tileWatch.current.delete(layer.id);
      tileHealth.current.forget(layer.sourceId);
      // A radar still sweeping stops, and its sweep goes with it.
      sweeps.current.get(layer.id)?.();
      sweeps.current.delete(layer.id);
      sea.dropSweep(mapInstance, layer.id);
      // Remove URL from tracking ref
      addedRasterUrls.current.delete(layer.url);
    }
    seaFiles.current.delete(layer.id);
    revealed.current.delete(layer.id);
    dateHidden.current.delete(layer.id);
    dropFromStack(layer.id);
    setFailedLayers((prev) => withoutId(prev, layerId));
    
    setAllLayers(prev => prev.filter(l => l.id !== layerId));
    setRasterVisibility(prev => {
      const newVis = { ...prev };
      delete newVis[layerId];
      return newVis;
    });
    
    console.log(`🗑️ Removed layer:`, layer.name);
  };

  // Clear all layers from map (basemap is dynamic and separate)
  const clearAllLayers = () => {
    if (!map.current) return;

    const mapInstance = map.current;
    const count = allLayers.length;
    // The watch globe's padding goes with the globe, before any rest frame below is fitted (GB-R2).
    releasePadding(mapInstance);

    allLayers.forEach(layer => {
      if (layer.type === 'geometry') {
        // Geometry has a fill layer plus its companion layers
        [layer.id, ...geometryCompanionIds(layer.id)].forEach(id => {
          if (mapInstance.getLayer(id)) {
            mapInstance.removeLayer(id);
          }
        });
        [layer.sourceId, `${layer.sourceId}-points`].forEach(id => {
          if (mapInstance.getSource(id)) mapInstance.removeSource(id);
        });
      } else {
        // Raster layer, and the live light over a hillshade with its DEM source.
        [layer.id, `${layer.id}${LIGHT_SUFFIX}`].forEach((id) => {
          if (mapInstance.getLayer(id)) mapInstance.removeLayer(id);
        });
        [layer.sourceId, `${layer.sourceId}-dem`].forEach((id) => {
          if (mapInstance.getSource(id)) mapInstance.removeSource(id);
        });
        sea.dropSweep(mapInstance, layer.id);
      }
    });
    // The sea goes back to its rest: the replay loops again, the clock reads the replay, the reserve in frame.
    sweeps.current.forEach((cancel) => cancel());
    sweeps.current.clear();
    seaTimers.current.forEach(clearTimeout);
    seaTimers.current = [];
    if (forecastFit.current) clearTimeout(forecastFit.current);
    if (fleetBack.current) clearTimeout(fleetBack.current);
    seaFiles.current.clear();
    revealed.current.clear();
    dateHidden.current.clear();
    heatShownAt.current = null;
    boxesShownAt.current = null;
    stagePassRef.current = null;
    setStagePass(null);
    setCandidatesShown(false);
    recordedDraft.current = false;
    setSeaBeat('rest');
    setSeaFacts((f) => ({ replayAt: f.replayAt, vessels: f.vessels }));
    setTaskingState(null);
    setTaskExcluded([]);
    if (tasking) setTaskingDismissed(tasking.key);
    if (vesselRest) fitSeaRest(mapInstance);
    stopSweep();
    lightLayers.current.clear();
    setLightCount(0);
    setLightAzimuth(LIGHT_AZIMUTH);
    setLightHeight(LIGHT_ALTITUDE);
    transects.current.clear();
    setSectionCursor(null);
    tileWatch.current.forEach((off) => off());
    tileWatch.current.clear();
    tileHealth.current = createTileHealth();
    setFailedLayers(new Set());

    // Clear all layers (basemap is dynamic and not tracked here)
    setAllLayers([]);
    setRasterVisibility({});
    layerOrderRef.current = [];
    setLayerOrder([]);
    addedRasterUrls.current.clear(); // Clear the URL tracking ref
    plumeFramed.current = false;
    // Back to the flat, upright map the other acts expect: no globe, no ground.
    setGlobeOn(false);
    groundOnRef.current = false;
    setGroundOn(false);
    if (mapInstance.getPitch() !== 0 || mapInstance.getBearing() !== 0) mapInstance.easeTo({ pitch: 0, bearing: 0, duration: 600 });

    console.log(`🗑️ Cleared ${count} layers`);
  };

  // Add COG raster layers when raster data is available
  useEffect(() => {
    console.log(`🗺️ MapView raster effect triggered. Rasters:`, rasters.length, rasters.map(r => ({ name: r.name, url: r.url.substring(0, 80) })));

    if (!map.current) {
      console.log(`⚠️ Map not initialized yet`);
      return;
    }

    const mapInstance = map.current;

    // Create an abort controller for this effect run
    const abortController = new AbortController();

    const updateRasters = async () => {
      console.log(`🔧 updateRasters() called for ${rasters.length} rasters`);

      if (abortController.signal.aborted) {
        console.log(`⏭️ Update aborted (new rasters arrived)`);
        return;
      }

      // If no rasters, just return
      if (rasters.length === 0) return;

      // Deduplicate rasters by URL within this batch
      const uniqueRasters = rasters.filter((raster, index, self) =>
        index === self.findIndex(r => r.url === raster.url)
      );
      console.log(`🔍 After deduplication: ${uniqueRasters.length} unique rasters`);

      // Filter to .tif files only and sort by zIndex (higher = on top)
      const rastersToAdd = uniqueRasters
        .filter(r => r.url.toLowerCase().endsWith('.tif'))
        .sort((a, b) => {
          // Both have zIndex: sort by zIndex (higher first)
          if (a.zIndex !== undefined && b.zIndex !== undefined) {
            return b.zIndex - a.zIndex;
          }
          // Only a has zIndex: a comes first
          if (a.zIndex !== undefined) return -1;
          // Only b has zIndex: b comes first
          if (b.zIndex !== undefined) return 1;
          // Neither has zIndex: maintain original order
          return 0;
        });
      console.log(`🔍 After .tif filter and zIndex sort: ${rastersToAdd.length} rasters to add:`, rastersToAdd.map(r => `${r.name} (z:${r.zIndex || 'none'})`));

      if (rastersToAdd.length === 0) {
        console.log(`✅ No rasters to add (no .tif files in batch)`);
        return;
      }

      console.log(`📊 Starting to add ${rastersToAdd.length} rasters to map`);

      // Calculate bounds from geometry once (used for all rasters)
      let bounds: [number, number, number, number] | undefined;
      if (geometry) {
        const boundsObj = new maplibregl.LngLatBounds();
        geometry.features.forEach((feature) => {
          const geom = feature.geometry;
          if (geom.type === 'Polygon') {
            geom.coordinates[0].forEach((coord: number[]) => {
              boundsObj.extend(coord as [number, number]);
            });
          } else if (geom.type === 'MultiPolygon') {
            geom.coordinates.forEach((polygon: number[][][]) => {
              polygon[0].forEach((coord: number[]) => {
                boundsObj.extend(coord as [number, number]);
              });
            });
          } else if (geom.type === 'Point') {
            boundsObj.extend(geom.coordinates as [number, number]);
          } else if (geom.type === 'LineString') {
            geom.coordinates.forEach((coord: number[]) => {
              boundsObj.extend(coord as [number, number]);
            });
          }
        });

        // Convert to [west, south, east, north] format
        const sw = boundsObj.getSouthWest();
        const ne = boundsObj.getNorthEast();
        bounds = [sw.lng, sw.lat, ne.lng, ne.lat];
      }

      // Process in order (zIndex already sorted, higher first)
      // With beforeId logic, first added = top visually
      const newLayerMetadata: LayerMetadata[] = [];

      // Generate base timestamp once for this batch to ensure uniqueness
      const baseTimestamp = Date.now();

      for (let i = 0; i < rastersToAdd.length; i++) {
        // Check for abort at the beginning of each iteration
        if (abortController.signal.aborted) {
          console.log(`⏭️ [${i}] Loop aborted by new rasters arriving`);
          break;
        }

        const raster = rastersToAdd[i];

        // Check if this raster URL has already been added using ref (avoids stale closure)
        if (addedRasterUrls.current.has(raster.url)) {
          console.log(`⏭️ [${i}] Raster already on map, skipping:`, raster.name, `URL:`, raster.url);
          continue;
        }

        console.log(`✅ [${i}] Raster NOT in ref, will add:`, raster.name, `URL:`, raster.url);
        console.log(`📋 Current ref contents:`, Array.from(addedRasterUrls.current));

        // Use base timestamp + index for unique IDs across conversation turns
        const layerId = `cogLayer-raster-${baseTimestamp}-${i}`;
        const sourceId = `cogSource-raster-${baseTimestamp}-${i}`;

        console.log(`🔄 [${i}] Starting to add raster:`, raster.name, `URL:`, raster.url.substring(0, 80));

        try {
          // Check for abort before async operation
          if (abortController.signal.aborted) {
            console.log(`⏭️ [${i}] Aborted before getPresignedUrl for:`, raster.name);
            break;
          }

          console.log(`🔄 [${i}] Getting presigned URL for:`, raster.name);
          const presignedUrl = await getPresignedUrl(raster.url);

          // Check for abort after async operation
          if (abortController.signal.aborted) {
            console.log(`⏭️ [${i}] Aborted after getPresignedUrl for:`, raster.name);
            break;
          }

          console.log(`✅ [${i}] Pre-signed URL generated for:`, raster.name);
          if (!presignedUrl) {
            console.error(`❌ [${i}] Pre-signed URL failed:`, raster.name, raster.url);
            continue;
          }

          const encodedUrl = encodeURIComponent(presignedUrl);

          // Detect raster type from URL and apply appropriate colormap
          const urlLower = raster.url.toLowerCase();
          let tileUrl: string;

          // A methane plume raster: by its validated hint, or by the tool's own file name.
          const probe: LayerMetadata = { id: '', sourceId: '', name: raster.name, url: raster.url, type: 'raster', render: raster.render };
          const isMethaneRaster = isMethaneLayer(probe);
          // The archaeologist's terrain (a hillshade, a local relief model), by hint or file name.
          const terrainHint = isMethaneRaster ? null : terrainRasterHint(raster.render, raster.url);
          const isTerrainRaster = terrainHint !== null;
          // Dark Vessels' radar pass: tinted over its local sea, swept in along the satellite's track.
          const seaRadar = isMethaneRaster || isTerrainRaster ? null : vesselRasterHint(raster.render, raster.url);
          const hint: RenderHint | undefined =
            seaRadar ?? methaneRasterHint(raster.render, raster.url) ?? terrainHint ?? raster.render ?? (isMethaneRaster ? METHANE_RASTER : undefined);
          // The camera follows the methane act (the plume on arrival, then the ground scene after
          // it) and the archaeologist's: the scene "from space" lands flat on the site, then every
          // terrain product lands on the ground, tilted. The record on the stage marks that act.
          const inArchaeoAct = isTerrainRaster || groundOnRef.current ||
            allLayersRef.current.some(isTerrainLayer) || newLayerMetadata.some(isTerrainLayer);
          const followCamera =
            !!seaRadar || isMethaneRaster || inArchaeoAct || raster.frame === true ||
            allLayersRef.current.some((l) => l.type === 'raster' && isMethaneLayer(l)) ||
            newLayerMetadata.some((l) => isMethaneLayer(l));
          const hintParams = tileParamsFor(hint);

          // A hillshade that names its DEM gets a live light: the DEM is served as terrain-RGB and
          // lit by the map itself (the sweep when it lands, the dial after), and the baked hillshade
          // under it becomes a flat grey sheet so the light reads on paper, not on imagery.
          // The DEM comes from the hint, or (when the model passed the hint on without it) from the
          // tool's own naming beside the hillshade, checked with TiTiler before the paper goes down:
          // the light must not depend on the model copying one key.
          let demPresigned: string | null = null;
          const demUrl = isTerrainRaster && isHillshadeHint(hint) ? (hint?.dem ?? companionDem(raster.url)) : null;
          if (demUrl) {
            demPresigned = await getPresignedUrl(demUrl);
            if (demPresigned && !hint?.dem && !(await fetchCogBounds(demPresigned))) demPresigned = null;
            if (abortController.signal.aborted) break;
            if (demPresigned && !hint?.dem) console.log(`💡 Live light from the companion DEM (the hint had none):`, demUrl);
          }
          const liveLight = demPresigned !== null;

          if (seaRadar) {
            // The stage's tint, whatever the hint said (utils/vesselLayers.ts radarColormap).
            tileUrl = `${TITILER_URL}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=${encodedUrl}&${radarTileParams()}`;
          } else if (liveLight) {
            tileUrl = `${TITILER_URL}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=${encodedUrl}&bidx=1&rescale=${PAPER_RESCALE[0]},${PAPER_RESCALE[1]}&colormap_name=gray`;
          } else if (hintParams) {
            // The agent said how this layer looks (validated in utils/render.ts).
            tileUrl = `${TITILER_URL}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=${encodedUrl}&${hintParams}`;
          } else if (urlLower.includes('change_detection') || urlLower.includes('change-detection')) {
            // Change Detection: 0 to 1 range, reversed RdYlGn (green=no change, red=high change)
            tileUrl = `${TITILER_URL}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=${encodedUrl}&bidx=1&rescale=0,0.5&colormap_name=rdylgn_r`;
          } else if (urlLower.includes('ndvi_') || urlLower.includes('ndvi-')) {
            // NDVI: 0 to 1 range, green colormap for vegetation
            tileUrl = `${TITILER_URL}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=${encodedUrl}&bidx=1&rescale=0,1&colormap_name=rdylgn`;
          } else if (urlLower.includes('ndwi_') || urlLower.includes('ndwi-')) {
            // NDWI: -1 to 1, blue colormap for water
            tileUrl = `${TITILER_URL}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=${encodedUrl}&bidx=1&rescale=-1,1&colormap_name=blues`;
          } else if (urlLower.includes('nbr_') || urlLower.includes('nbr-') || urlLower.includes('/nbr.')) {
            // NBR: -1 to 1, spectral colormap for burn severity
            tileUrl = `${TITILER_URL}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=${encodedUrl}&bidx=1&rescale=-1,1&colormap_name=spectral`;
          } else {
            // TCI and other satellite images: no colormap needed (RGB)
            tileUrl = `${TITILER_URL}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=${encodedUrl}`;
          }

          // Check for abort before adding to map
          if (abortController.signal.aborted) {
            console.log(`⏭️ [${i}] Aborted before adding source/layer for:`, raster.name);
            break;
          }

          // Calculate appropriate minzoom from bounds to prevent requesting tiles at
          // zoom levels where the COG is too small relative to the tile extent.
          // At low zooms, TiTiler times out trying to render a tiny COG into a world-scale tile.
          // This raster's own extent when the act needs it (the camera goes there): the hint's bounds,
          // else TiTiler's; otherwise the current geometry's, as before.
          let rasterBounds = bounds;
          if (seaRadar) {
            // The sweep draws the COG's own preview over its own extent: TiTiler's bounds first.
            rasterBounds = (await fetchCogBounds(presignedUrl)) ?? hint?.bounds ?? bounds;
            if (abortController.signal.aborted) break;
          } else if (followCamera) {
            rasterBounds = hint?.bounds ?? (await fetchCogBounds(presignedUrl)) ?? bounds;
            if (abortController.signal.aborted) break;
          }

          let sourceMinZoom = 0;
          if (rasterBounds) {
            const lonExtent = rasterBounds[2] - rasterBounds[0]; // east - west
            // At zoom z, each tile covers 360/2^z degrees of longitude.
            // We want the COG to fill at least ~10% of a tile before requesting.
            for (let z = 0; z <= 18; z++) {
              const tileLonExtent = 360 / Math.pow(2, z);
              if (lonExtent / tileLonExtent > 0.1) {
                sourceMinZoom = z;
                break;
              }
            }
          }

          mapInstance.addSource(sourceId, {
            type: 'raster',
            tiles: [tileUrl],
            tileSize: 256,
            minzoom: sourceMinZoom,
            maxzoom: 22,
            bounds: rasterBounds,
          });

          // A flat TROPOMI composite that lands while a bar layer is on the map (a replay's layers load
          // in any order) lands listed but unticked: the bars replaced it, as they do when it came first.
          const behindBars = isTropomiComposite({ id: layerId, type: 'raster', url: raster.url }) &&
            compositeLandsHidden(allLayersRef.current, (id) => rasterVisibilityRef.current[id] !== false);
          const isVisible = rasterVisibility[layerId] !== undefined ? rasterVisibility[layerId] : !behindBars;
          setRasterVisibility(prev => ({ ...prev, [layerId]: isVisible }));

          // Stacking: the finding sits on the ground. An index (NDVI, NBR, NDWI, change), a methane
          // plume or anything the hint marks as an index or a change layer joins the TOP of the
          // imagery (under the boundaries, footprints and sites drawn over it); true-colour imagery
          // and other scenes join the bottom, just above the basemap, so an NDVI displayed after
          // its scene is never hidden under it. The layers plate lists the stack in the order the
          // map draws it, and the presenter can restack anything from there.
          const isFinding = !!seaRadar || isMethaneRaster || isTerrainRaster || indexLegendFor(raster.url) !== null
            || hint?.group === 'index' || hint?.group === 'change';

          // A coarse raster (the hint caps its zoom: TROPOMI's ~4 km cells) is hidden above that
          // zoom and dimmed below it, so it tips the eye without walling off the finding.
          const coarse = typeof hint?.max_zoom === 'number';
          // A terrain product surfaces through the scene under it rather than snapping on: the
          // golf course dissolves and the earthwork is there. Not under reduced motion.
          const reveal = isTerrainRaster && !prefersReducedMotion();
          const targetOpacity = coarse ? COARSE_RASTER_OPACITY : 1.0;
          mapInstance.addLayer({
            id: layerId,
            type: 'raster',
            source: sourceId,
            ...(coarse ? { maxzoom: hint!.max_zoom } : {}),
            paint: {
              // The radar's tiles wait under its sweep (landRadar brings them in).
              'raster-opacity': reveal || seaRadar ? 0 : targetOpacity,
              ...(reveal ? { 'raster-opacity-transition': { duration: REVEAL_MS, delay: 0 } } : {}),
            },
            layout: {
              visibility: isVisible ? 'visible' : 'none',
            },
          });
          if (reveal) requestAnimationFrame(() => {
            if (mapInstance.getLayer(layerId)) mapInstance.setPaintProperty(layerId, 'raster-opacity', targetOpacity);
          });
          if (liveLight && demPresigned) {
            const demSourceId = `${sourceId}-dem`;
            const lightId = `${layerId}${LIGHT_SUFFIX}`;
            mapInstance.addSource(demSourceId, {
              type: 'raster-dem',
              tiles: [demTilesUrl(TITILER_URL, demPresigned)],
              encoding: 'terrarium',
              tileSize: 256,
              minzoom: Math.max(sourceMinZoom, 10),
              maxzoom: 17,
              ...(rasterBounds ? { bounds: rasterBounds } : {}),
            });
            const still = prefersReducedMotion();
            mapInstance.addLayer({
              id: lightId,
              type: 'hillshade',
              source: demSourceId,
              paint: {
                // The GDAL model: a sun with a height, so a low one rakes. Flat ground at the
                // settled 25° goes a shade darker than the paper; a bank's lit face goes to fog
                // and its far face to the dome.
                'hillshade-method': 'basic',
                'hillshade-illumination-direction': LIGHT_AZIMUTH,
                'hillshade-illumination-altitude': still ? LIGHT_ALTITUDE : lightAltitude(0),
                'hillshade-illumination-anchor': 'map',
                'hillshade-exaggeration': LIGHT_EXAGGERATION,
                'hillshade-shadow-color': '#0f141b',
                'hillshade-highlight-color': 'rgba(233, 238, 243, 0.9)',
                'hillshade-accent-color': '#0f141b',
              },
              layout: { visibility: isVisible ? 'visible' : 'none' },
            });
            lightLayers.current.add(lightId);
            setLightCount(lightLayers.current.size);
            setLightAzimuth(LIGHT_AZIMUTH);
            setLightHeight(still ? LIGHT_ALTITUDE : lightAltitude(0));
            if (!still) {
              // The sun moves once the camera has landed and the ground has loaded (idle), or
              // after four seconds regardless, so a slow tile never holds the act.
              let started = false;
              const start = () => {
                if (started) return;
                started = true;
                sweepLight();
              };
              mapInstance.once('idle', start);
              setTimeout(start, 4000);
            }
          }
          placeInStack(layerId, isFinding ? 'aboveImagery' : 'bottom');
          if (seaRadar) landRadar(mapInstance, layerId, sourceId, raster.url, presignedUrl, rasterBounds);

          // Track this layer with metadata
          newLayerMetadata.push({
            id: layerId,
            sourceId: sourceId,
            name: raster.name,
            url: raster.url,
            date: raster.date,
            type: 'raster',
            bounds: rasterBounds,
            ...(hint ? { render: hint } : {}),
          });

          // CRITICAL FIX: Only add URL to ref AFTER layer is successfully added to map
          // This prevents race condition where ref is updated but layer isn't added due to abort
          addedRasterUrls.current.add(raster.url);
          onRasterLandedRef.current?.(raster.url);


          // The archaeologist's ground stands up under the first terrain product and stays until
          // the map is cleared; a second site's products land on the same ground.
          if (isTerrainRaster && !groundOnRef.current) {
            groundOnRef.current = true;
            setGroundOn(true);
          }
          // A second site's relief: the earlier sites' reliefs are unticked (the row's own
          // checkbox path, not removed), so one relief legend reads at a time (A4 P1-6).
          const site = isTerrainRaster ? reliefSite(raster.url) : null;
          if (site) {
            const earlier = allLayersRef.current.filter((l) =>
              l.type === 'raster' && l.id !== layerId && reliefSite(l.url) !== null && reliefSite(l.url) !== site);
            if (earlier.length > 0) {
              setRasterVisibility((prev) => ({ ...prev, ...Object.fromEntries(earlier.map((l) => [l.id, false])) }));
            }
          }

          // The camera moves to the finding: the plume fills the frame; the ground scene after it
          // tightens a little further. In the methane act and the archaeologist's; other acts keep
          // today's framing.
          // A radar pass whose targets (or reach) landed first keeps their closer frame.
          const seaFramed = !!seaRadar && seaPassMovedOn(passOf(raster.url));
          if (followCamera && rasterBounds && !seaFramed) {
            plumeFramed.current = true;
            // On the ground the camera lands on the site in the middle of its 3 km frame, not on the
            // frame (a replay adds the scene after the hillshade, so this holds for any raster once
            // the ground is up); the scene "from space" before any terrain still frames the whole clip.
            // A ploughed site's ±0.3 m relief lands closer still (about 800 m), so its arcs read.
            const [w, s, e, n] = groundOnRef.current ? siteWindow(rasterBounds, siteWindowShare(raster.url)) : rasterBounds;
            // A coarse raster frames below its own cap so it is still on screen when the camera lands.
            const cap = seaRadar ? 9 : coarse ? Math.max(1, hint!.max_zoom! - 0.5) : inArchaeoAct ? FRAME_MAX_ZOOM : isMethaneRaster ? 13 : 14;
            // With the 3D columns on the stage the frame keeps their tilt; on the archaeologist's
            // ground it takes the low oblique view; otherwise it is flat.
            const columnsOnStage = allLayersRef.current.some((l) => methaneGeometryHint(l.render, l.url)?.kind === 'columns');
            // fitStage: with no padding held on the map (always so on the sea) this is fitBounds.
            fitStage(mapInstance, [[w, s], [e, n]], {
              padding: seaRadar ? seaPadding(SEA_PADDING_BASE()) : STAGE_PADDING_NOW(),
              duration: 1800,
              maxZoom: cap,
              pitch: groundOnRef.current ? GROUND_PITCH : columnsOnStage ? COLUMNS_PITCH : 0,
              ...(groundOnRef.current ? { bearing: GROUND_BEARING } : {}),
            });
          }

          // The ground beat: the tip bars (kilometres tall, over ~4 km cells) step back so the scene under
          // them reads; they stay on the map, as the card says. The record bars are 30 to 60 m cells and
          // stand on the scene as they are.
          if (!isMethaneRaster && !isTerrainRaster && !seaRadar) {
            allLayersRef.current
              .filter((l) => l.type === 'geometry' && barKind(l.url) === 'tip' && mapInstance.getLayer(l.id))
              .forEach((l) => mapInstance.setPaintProperty(l.id, 'fill-extrusion-opacity', TIP_BARS_GROUND_OPACITY));
          }

          console.log(`✅ [${i}] Raster successfully added to map:`, raster.name, `Layer ID: ${layerId}`, `Visible: ${isVisible}`);

          // Tile errors are logged; a raster that draws no tile at all says so in its row and its
          // legend leaves the plate, until a tile draws (utils/tileHealth.ts). Dark Vessels' radar
          // passes keep their own sweep and are not flagged (Act 3 is unchanged).
          const onTileError = (e: maplibregl.ErrorEvent & { sourceId?: string }) => {
            if (e.sourceId !== sourceId) return;
            console.error(`❌ Tile loading error for ${raster.name}:`, e);
            if (!seaRadar && tileHealth.current.failed(sourceId)) {
              console.warn(`⚠️ No tile of ${raster.name} has loaded: marked as not loaded`);
              setFailedLayers((prev) => withId(prev, layerId));
            }
          };
          const onTileData = (e: maplibregl.MapSourceDataEvent) => {
            if (e.sourceId === sourceId && e.tile && tileHealth.current.loaded(sourceId)) {
              setFailedLayers((prev) => withoutId(prev, layerId));
            }
          };
          mapInstance.on('error', onTileError);
          mapInstance.on('sourcedata', onTileData);
          tileWatch.current.set(layerId, () => {
            mapInstance.off('error', onTileError);
            mapInstance.off('sourcedata', onTileData);
          });
        } catch (error) {
          console.error(`❌ [${i}] Raster layer error for ${raster.name}:`, error);
          // Don't add to ref if there was an error
        }
      }
      
      console.log(`🏁 Finished processing loop. Added ${newLayerMetadata.length} layers to metadata`);

      // Update layer tracking with new layers (keep same order as zIndex)
      if (newLayerMetadata.length > 0) {
        console.log(`📋 Updating allLayers state with ${newLayerMetadata.length} new layers:`, newLayerMetadata.map(l => l.name));
        setAllLayers(prev => {
          const updated = [...prev, ...newLayerMetadata];
          console.log(`📋 Total layers after update: ${updated.length}`);
          return updated;
        });
      }
    };

    // Always call updateRasters directly - the map exists and is initialized
    // Note: mapInstance.loaded() can return false during layer operations even when map is ready
    console.log(`✅ Calling updateRasters()`);
    updateRasters();
    
    // Cleanup function to abort if new rasters arrive
    return () => {
      abortController.abort();
    };
  }, [rasters]); // Only depend on rasters - addedRasterUrls ref is always current

  // Handle layer visibility toggles (both rasters and geometries)
  useEffect(() => {
    if (!map.current) return;

    const mapInstance = map.current;

    // Update visibility for each layer
    Object.entries(rasterVisibility).forEach(([layerId, isVisible]) => {
      const visibility = isVisible ? 'visible' : 'none';
      
      // Update the main layer
      if (mapInstance.getLayer(layerId)) {
        mapInstance.setLayoutProperty(layerId, 'visibility', visibility);
      }
      
      // The companions follow: a geometry's outline, query, labels; a hillshade's live light.
      if ((layerId.includes('geometry') && layerId.includes('-fill')) || layerId.startsWith('cogLayer-')) {
        companionIds(layerId).forEach(id => {
          if (mapInstance.getLayer(id)) {
            mapInstance.setLayoutProperty(id, 'visibility', visibility);
          }
        });
      }
    });
  }, [rasterVisibility]);

  // Clear all layers when reset is triggered (geometry and rasters both become null/empty)
  useEffect(() => {
    if (!geometry && rasters.length === 0 && allLayers.length > 0) {
      console.log('🔄 Reset detected - clearing all layers');
      clearAllLayers();
    }
  }, [geometry, rasters, allLayers]);


  // The stack as rows, top first. A layer the order has not caught up with (none expected) is
  // listed at the top rather than dropped.
  const stackLayers = useMemo(() => {
    const byId = new Map(allLayers.map((l) => [l.id, l]));
    const ordered = layerOrder.filter((id) => byId.has(id)).map((id) => byId.get(id)!);
    return [...allLayers.filter((l) => !layerOrder.includes(l.id)), ...ordered];
  }, [allLayers, layerOrder]);
  const stackRows: StackRow[] = useMemo(
    () => stackLayers.map((l) => ({ id: l.id, label: layerRowLabel(l) })),
    [stackLayers],
  );

  const isShown = (id: string) => rasterVisibility[id] !== false;
  const isDrawn = (layer: LayerMetadata) => isShown(layer.id) && !outOfRange(layer, zoom);
  // A raster that drew no tile has no colours on the map to read, so its legend leaves the plate.
  const legends = stackLegends(stackLayers, (id) => {
    const layer = stackLayers.find((l) => l.id === id);
    return !!layer && isDrawn(layer) && !failedLayers.has(id);
  }, follow);

  // A row's own controls: visibility, the name (click to fly there; a ramp strip under a measured
  // layer ties the row to its legend; a coarse raster the map hides this close in says so),
  // remove. The stack adds the grip in front.
  const renderRowControls = (layer: LayerMetadata, label: string) => {
    const isVisible = isShown(layer.id);
    // A raster whose tiles all failed says so (the presenter must not describe what is not there).
    const failed = failedLayers.has(layer.id);
    const hiddenByZoom = isVisible && !failed && outOfRange(layer, zoom);
    const legend = layerLegend(layer, follow);
    const strip = legend && 'ramp' in legend ? rampGradient(legend.ramp) : null;
    const noteId = failed ? `${layer.id}-failed` : hiddenByZoom ? `${layer.id}-range` : undefined;
    return (
      <>
        <input
          type="checkbox"
          className="map-row__check"
          checked={isVisible}
          onChange={(e) => {
            e.stopPropagation();
            // A bar layer ticked on unticks the other bar layer (one stands on the map at a time) and
            // is framed as it was when it landed (the tip bars span ±15 km; the record bars ~1.5 km).
            const checked = e.target.checked;
            setRasterVisibility((prev) => ({ ...prev, ...tickChanges(allLayersRef.current, layer.id, checked, (id) => prev[id] !== false) }));
            if (checked && isBarLayer(layer) && layer.bounds && map.current) frameColumns(map.current, layer.bounds, layer.url);
          }}
          aria-label={`${isVisible ? 'Hide' : 'Show'} ${label}`}
        />
        <span className="map-row__main">
          <button
            type="button"
            className="map-row__name"
            onClick={() => flyToLayer(layer.id)}
            title={hiddenByZoom ? `Zoom out to ${label}` : `Fly to ${label}`}
            aria-describedby={noteId}
          >
            <span className="map-row__text">{label}</span>
          </button>
          {strip && !hiddenByZoom && !failed && <span className="map-row__ramp" style={{ background: strip }} aria-hidden="true" />}
          {failed && (
            <span className="map-row__note map-row__note--failed" id={`${layer.id}-failed`} role="status">
              {isTerrainLayer(layer) ? 'LiDAR did not load' : 'Did not load'}
            </span>
          )}
          {hiddenByZoom && (
            <span className="map-row__note" id={`${layer.id}-range`}>
              Shows only when zoomed out
            </span>
          )}
        </span>
        <button
          type="button"
          className="map-row__remove"
          onClick={() => removeLayer(layer.id)}
          aria-label={`Remove ${label}`}
          title="Remove layer"
        >
          <Icon name="close" size={14} />
        </button>
      </>
    );
  };

  // The legends under the list: the room reads the colours without being told. Index ends in
  // words; methane ends in the mono face with their units; the sites key draws a dot and a ring.
  const rampWords: Record<string, string> = {
    plasma: 'dark purple to yellow',
    ice: 'dark navy to pale cyan',
    viridis: 'dark violet to yellow-green',
  };
  // Dark Vessels' keys: one row per mark, its icon drawn as the map draws it (stage.css .sea-key--*).
  const seaKeyList = (key: string, label: string, rows: readonly SeaKeyRow[]) => (
    <ul key={key} className="map-legend map-legend--key" aria-label={label}>
      {rows.map((r) => (
        <li key={r.icon}>
          <span className={`sea-key ${r.icon}`} aria-hidden="true" />
          <span className="map-legend__label">{r.words}</span>
        </li>
      ))}
    </ul>
  );
  // The ships' dots in the key while the dots held at the radar minute are on the map (the same
  // rule as their paint: no row over the replay's loop, another pass or the spares).
  const earlierPassOnStage = !!stagePass && !!vesselRest && stagePass !== vesselRest.pass.pass_id;
  const aisRow = seaOn ? aisKeyRow(seaBeat, earlierPassOnStage) : null;
  const renderLegend = (lg: StackLegend) => {
    if (lg.kind === 'index') {
      return (
        <div key={lg.key} className="map-legend map-legend--stacked">
          <span className="map-legend__name">{lg.label}</span>
          <div className="map-legend__bar" role="img" aria-label={`Colour ramp: ${lg.label}, ${lg.low} to ${lg.high}`}>
            <span className="map-legend__label">{lg.low}</span>
            <span className="map-legend__ramp" style={{ background: rampGradient(lg.ramp) ?? undefined }} aria-hidden="true" />
            <span className="map-legend__label">{lg.high}</span>
          </div>
        </div>
      );
    }
    if (lg.kind === 'measure') {
      return (
        <div key={lg.key} className="map-legend map-legend--stacked">
          <span className="map-legend__name">{lg.label}</span>
          <div
            className="map-legend__bar"
            role="img"
            aria-label={`Colour ramp: ${lg.label} from ${lg.lo} to ${lg.hi} ${lg.units} and above, ${rampWords[lg.ramp] ?? 'low to high'}`}
          >
            <span className="map-legend__label map-legend__label--num">{lg.lo.toLocaleString('en-US')}</span>
            <span className="map-legend__ramp" style={{ background: rampGradient(lg.ramp) ?? undefined }} aria-hidden="true" />
            <span className="map-legend__label map-legend__label--num">
              {lg.hi.toLocaleString('en-US')}+ {lg.units}
            </span>
          </div>
          {lg.note && <span className="map-legend__label">{lg.note}</span>}
          {lg.source && <span className="map-legend__label map-legend__source">{lg.source}</span>}
        </div>
      );
    }
    if (lg.kind === 'sites') {
      return (
        <div
          key={lg.key}
          className="map-legend map-legend--sites"
          role="img"
          aria-label="A dot is a site where NASA mapped a methane plume; a ring marks plumes on five or more dates; ×N is the number of dates with a plume"
        >
          <span className="map-legend__dot" aria-hidden="true" />
          <span className="map-legend__label">NASA plume site</span>
          <span className="map-legend__ring" aria-hidden="true" />
          <span className="map-legend__label">plumes on 5+ dates</span>
        </div>
      );
    }
    if (lg.kind === 'detections') {
      // Carbon Mapper's key, with the source its licence asks for wherever its data shows.
      return (
        <div key={lg.key} className="map-legend map-legend--stacked map-legend--detections">
          <div className="map-legend__bar" role="img" aria-label="A mint ring is a methane plume Carbon Mapper published near the site since 2025">
            <span className="map-legend__detection" aria-hidden="true" />
            <span className="map-legend__label">{DETECTIONS_ROW}</span>
          </div>
          <span className="map-legend__label map-legend__source">{CARBON_MAPPER_SOURCE}</span>
        </div>
      );
    }
    if (lg.kind === 'relief') {
      // The archaeologist's local relief: the ground below its surroundings reads blue, above
      // reads red; the ends in signed metres (±1 m for standing walls, ±0.3 m for ploughed ones).
      const lo = signedMetres(lg.lo, lg.units);
      const hi = signedMetres(lg.hi, lg.units);
      return (
        <div key={lg.key} className="map-legend map-legend--stacked">
          <span className="map-legend__name">{lg.label}</span>
          <div
            className="map-legend__bar"
            role="img"
            aria-label={`Colour ramp: ${lg.label}, blue is ground lower than its surroundings down to ${lo}, red is higher up to ${hi}`}
          >
            <span className="map-legend__label">
              lower <span className="map-legend__num">{lo}</span>
            </span>
            <span className="map-legend__ramp" style={{ background: rampGradient(lg.ramp) ?? undefined }} aria-hidden="true" />
            <span className="map-legend__label">
              <span className="map-legend__num">{hi}</span> higher
            </span>
          </div>
        </div>
      );
    }
    if (lg.kind === 'hillshade') {
      // With a live light the sentence follows the sun; the light plate moves it.
      const from = lightCount > 0 ? compassName(lightAzimuth) : 'north-west';
      return (
        <div key={lg.key} className="map-legend map-legend--stacked">
          <span className="map-legend__name">Hillshade</span>
          <span className="map-legend__label">1 m LiDAR, lit from the {from}: banks cast shadows, ditches catch them</span>
        </div>
      );
    }
    if (lg.kind === 'vessels') {
      // Dark Vessels' targets by shape and words, never by colour alone, each icon the mark the map
      // draws (vesselLayers.targetKeyRows). The ships' dots lead it while they are on the map.
      // "Candidate" joins the key only once the stage has called one: nothing is called dark before
      // the coverage check.
      const rows = targetKeyRows({ revealed: candidatesShown, seenOnce: (seaFacts.counts?.seenOnce ?? 0) > 0, tied: (seaFacts.counts?.tied ?? 0) > 0 });
      return seaKeyList(lg.key, aisRow ? 'Ships and radar targets key' : 'Radar targets key', aisRow ? [aisRow, ...rows] : rows);
    }
    if (lg.kind === 'coverage') {
      // Both areas lie inside the radar when the coverage carries what the pass can check, so
      // reserve water outside the swath is plain sea, and the key says why (review L6).
      return seaKeyList(lg.key, 'AIS coverage key', coverageKeyRows({ outside: seaFacts.checkable !== undefined }));
    }
    if (lg.kind === 'seaheat') {
      return (
        <div key={lg.key} className="map-legend map-legend--stacked">
          <span className="map-legend__name">{lg.label}</span>
          <div className="map-legend__bar" role="img" aria-label={`${lg.label}: from clear, ${lg.low}, to bright, ${lg.high}`}>
            <span className="map-legend__label">{lg.low}</span>
            <span className="map-legend__ramp" style={{ background: `linear-gradient(90deg, transparent 0%, ${lg.colour} 70%, ${lg.end} 100%)` }} aria-hidden="true" />
            <span className="map-legend__label">{lg.high}</span>
          </div>
        </div>
      );
    }
    if (lg.kind === 'record') {
      return (
        <div key={lg.key} className="map-legend map-legend--sites" role="img" aria-label="A dot is a site on the public record; a ring marks a World Heritage site">
          <span className="map-legend__dot" aria-hidden="true" />
          <span className="map-legend__label">on the public record</span>
          <span className="map-legend__ring" aria-hidden="true" />
          <span className="map-legend__label">World Heritage</span>
        </div>
      );
    }
    return (
      <div key={lg.key} className="map-legend map-legend--stacked">
        <span className="map-legend__name">Similarity to the example</span>
        <div className="map-legend__bar" role="img" aria-label="Colour ramp: similarity to the example, lighter violet is less alike, deeper violet is more alike">
          <span className="map-legend__label">less alike</span>
          <span className="map-legend__ramp" aria-hidden="true" />
          <span className="map-legend__label">more alike</span>
        </div>
      </div>
    );
  };
  const stackTitleId = useId();

  const openCompare = () => {
    if (!comparePair) return;
    const currentMap = map.current;
    const center = currentMap ? currentMap.getCenter() : { lng: 0, lat: 20 };
    const zoom = currentMap ? currentMap.getZoom() : 2;
    setCompareMode({ left: comparePair.left, right: comparePair.right, center: [center.lng, center.lat], zoom });
  };

  // The legends: at the plate's foot, outside the scrolling rows, so a short screen never clips a
  // ramp or its ends (A2 P1-8), and Dark Vessels' key is never scrolled away (the list scrolls).
  // While the tasking plate is up the list folds and the key stays, with the plate under it.
  const keyStays = taskingOn && vesselOnStage;
  const aisAlone = !!aisRow && !legends.some((lg) => lg.kind === 'vessels');
  const legendsBlock = () =>
    legends.length > 0 || groundOn || restOn || aisAlone ? (
      <div className="map-layers__legends map-layers__legends--foot">
        {/* The ships' dots before the radar's targets are on the map (the radar beat). */}
        {aisRow && aisAlone && seaKeyList('ais', 'Ships key', [aisRow])}
        {legends.map(renderLegend)}
        {restOn && (
          // The rest view says what it is: the continent's relief stood up, lit at dusk.
          <div className="map-legend map-legend--ground">
            <span className="map-legend__label">
              relief <span className="map-legend__num">×{REST_EXAGGERATION}</span>, a low sun from the west
            </span>
          </div>
        )}
        {groundOn && (
          // The archaeologist's ground is a stated viewing aid: the 3D relief is exaggerated,
          // the hillshade and relief draped on it are not.
          <div className="map-legend map-legend--ground">
            <span className="map-legend__label">
              ground relief <span className="map-legend__num">×{RELIEF_EXAGGERATION}</span>, read from the south-west
            </span>
          </div>
        )}
      </div>
    ) : null;

  return (
    <div ref={frameRef} className={`map-frame${lightCount > 0 ? ' map-frame--light' : ''}${restOn ? ' map-frame--dusk' : ''}${seaOn ? ' map-frame--sea' : ''}${taskingOn ? ' map-frame--tasking' : ''}`}>
      {/* Compare overlay */}
      {compareMode && (
        <CompareView
          leftLayer={compareMode.left}
          rightLayer={compareMode.right}
          bounds={compareMode.left.bounds || compareMode.right.bounds}
          center={compareMode.center}
          zoom={compareMode.zoom}
          onClose={() => setCompareMode(null)}
        />
      )}
      {/* Space behind the watch globe; the canvas is transparent outside it. */}
      {globeOn && <Starfield />}
      <div ref={mapContainer} className="map-canvas" />

      {/* Top centre, Dark Vessels: what the room is looking at, dated. */}
      {seaOn && (
        <div className="sea-clock-band">
          <SeaClock
            beat={seaBeat}
            facts={{ ...seaFacts, replayPassId: vesselRest?.pass.pass_id, tasking: filedFacts(taskingState), taskingRecorded: taskingState?.status === 'replay' }}
          />
        </div>
      )}

      {/* Dark Vessels: the officer's decision, under the map key on the right, or over the finished
          steps where the right is too short (taskingPlace). It lives in the stage's overlay, above the
          step column; without one (no stage around the map) it stays in the frame. */}
      {taskingOn && tasking && (() => {
        const plate = (
          <TaskingPlate
            key={tasking.key}
            sessionId={tasking.sessionId}
            caseId={tasking.caseId}
            draftKey={tasking.key}
            busy={working}
            box={taskBox}
            excluded={taskExcluded}
            onLoaded={onTaskingLoaded}
            onBox={setTaskBox}
            onToggle={(id) => setTaskExcluded((x) => toggled(x, id))}
            // No onFiled: the officer's approval ends the act on the plate's filed line, and the
            // stage sends no follow-up turn (U4, R6.8).
            onDismiss={() => {
              setTaskingDismissed(tasking.key);
              setSeaBeat('boxes');
              // The plate folded the layer list; with the plate gone, the list comes back with its key.
              setIsLayerControlOpen(true);
            }}
            place={taskingPlace}
            sectionRef={taskingRef}
          />
        );
        return overlayEl ? createPortal(plate, overlayEl) : plate;
      })()}

      {/* Top right: the layers plate */}
      {allLayers.length > 0 && (
        <section ref={layersRef} className="map-plate map-layers" aria-label="Map layers">
          <div className={`map-layers__head${isLayerControlOpen ? ' map-layers__head--open' : ''}`}>
            <button
              type="button"
              className="map-layers__toggle"
              onClick={() => setIsLayerControlOpen(!isLayerControlOpen)}
              aria-expanded={isLayerControlOpen}
            >
              <Icon name={isLayerControlOpen ? 'chevron-down' : 'chevron-right'} size={14} />
              <span className="map-plate__title">Layers</span>
              <span className="map-layers__count">{allLayers.length}</span>
            </button>
            <button
              type="button"
              className="stage-btn stage-btn--quiet"
              onClick={clearAllLayers}
              title="Remove every layer from the map"
            >
              Clear
            </button>
          </div>

          {isLayerControlOpen && (
            <div className="map-layers__body">
              {/* One list in draw order, top row drawn on top; every row restacks. */}
              {stackRows.length > 0 && (
                <div>
                  <h3 className="map-group__title" id={stackTitleId}>Drawn top first</h3>
                  <LayerStack
                    rows={stackRows}
                    labelledBy={stackTitleId}
                    onPreview={applyLayerOrder}
                    onCommit={commitLayerOrder}
                    rowClassName={(row) => {
                      const layer = stackLayers.find((l) => l.id === row.id);
                      return layer && isDrawn(layer) ? '' : 'map-row--off';
                    }}
                    renderControls={(row) => {
                      const layer = stackLayers.find((l) => l.id === row.id);
                      return layer ? renderRowControls(layer, row.label) : null;
                    }}
                  />
                </div>
              )}

              {comparePair && (
                <button type="button" className="stage-btn map-group__action" onClick={openCompare}>
                  <Icon name="compare" size={16} />
                  Compare before and after
                </button>
              )}
            </div>
          )}
          {(isLayerControlOpen || keyStays) && legendsBlock()}

          {(isLayerControlOpen || keyStays) && vesselOnStage && (
            // Global Fishing Watch's data (the detections, the AIS, the fleet) is on the map. Its
            // attribution is the plate's foot, outside the scroll, so it stays in view at 720p too.
            <div className="map-layers__foot">
              <span className="map-legend__label">{SEA_ATTRIBUTION}</span>
            </div>
          )}
        </section>
      )}

      {/* Bottom right, over the metre scale: the raking light, while a live hillshade is on the stage. */}
      {lightCount > 0 && (
        <LightPlate
          azimuth={lightAzimuth}
          altitude={lightHeight}
          bearing={bearing}
          sweeping={sweeping}
          onChange={holdLight}
          onSweep={sweepLight}
        />
      )}

      {/* Bottom left: the draw rail (not on the archaeologist's act) */}
      {drawRail && (
      <nav className="map-plate map-rail" aria-label="Draw an area">
        <button
          type="button"
          className={`stage-btn stage-btn--icon ${drawMode === 'point' ? 'stage-btn--on' : 'stage-btn--quiet'}`}
          onClick={() => handleDrawMode('point')}
          aria-pressed={drawMode === 'point'}
          aria-label="Drop a point"
          title="Drop a point"
        >
          <Icon name="point" size={18} />
        </button>
        <button
          type="button"
          className={`stage-btn stage-btn--icon ${drawMode === 'polygon' ? 'stage-btn--on' : 'stage-btn--quiet'}`}
          onClick={() => handleDrawMode('polygon')}
          aria-pressed={drawMode === 'polygon'}
          aria-label="Draw a polygon"
          title="Draw a polygon"
        >
          <Icon name="polygon" size={18} />
        </button>
        {drawMode !== 'none' && (
          <button
            type="button"
            className="stage-btn stage-btn--icon stage-btn--quiet"
            onClick={() => handleDrawMode('none')}
            aria-label="Stop drawing"
            title="Stop drawing"
          >
            <Icon name="close" size={16} />
          </button>
        )}
        {hasDrawnFeatures && (
          <>
            <span className="map-rail__rule" aria-hidden="true" />
            <button
              type="button"
              className="stage-btn stage-btn--icon stage-btn--primary"
              onClick={sendDrawnGeometryToChat}
              disabled={!onDrawnGeometry}
              aria-label="Send the drawn area to the agent"
              title="Send the drawn area to the agent"
            >
              <Icon name="send" size={16} />
            </button>
            <button
              type="button"
              className="stage-btn stage-btn--icon stage-btn--danger"
              onClick={clearDrawnFeatures}
              aria-label="Clear the drawing"
              title="Clear the drawing"
            >
              <Icon name="trash" size={16} />
            </button>
          </>
        )}
      </nav>
      )}

      {/* Bottom right: the basemap plate (the sea's ground is the seabed, not a choice) */}
      {seaOn ? (
        <div className="map-plate map-basemap">
          <span className="map-plate__title">Base</span>
          <span className="map-basemap__fixed">Seabed</span>
        </div>
      ) : (
      <div className="map-plate map-basemap">
        <label className="map-plate__title" htmlFor="basemap-select">
          Base
        </label>
        <select
          id="basemap-select"
          className="map-select"
          value={baseMapStyle}
          onChange={(e) =>
            setBaseMapStyle(e.target.value as 'dark' | 'google-roads' | 'google-satellite' | 'esri-satellite')
          }
        >
          <option value="esri-satellite">Esri satellite</option>
          <option value="google-satellite">Google satellite</option>
          <option value="google-roads">Roads</option>
          <option value="dark">Dark</option>
        </select>
      </div>
      )}
    </div>
  );
}
