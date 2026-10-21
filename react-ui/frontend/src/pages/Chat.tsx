/**
 * The Stage. The map fills the frame edge to edge; the docent's overlays (step column,
 * caption band, transcript drawer) float over it and never reflow the map.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { useAgents } from '../agentContext';
import { caseAgent } from '../utils/caseAgent';
import { getApiUrl, loadArchaeologyRecord, loadMethaneBaseline, loadVesselRest, prewarmSession } from '../services/api';
import { taskingFiledMessage, type VesselRest } from '../utils/vesselLayers';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import { MapView } from '../components/MapView';
import { ChatSidebar } from '../components/ChatSidebar';
import type { GeometryData, RasterData } from '../types';
import { getIdToken } from '../utils/auth';
import { parseRenderHint } from '../utils/render';
import type { Tip } from '../utils/steps';
import '../stage.css';

interface ScenarioToolCall {
  name: string;
  params: Record<string, any>;
  result: string;
}

interface ScenarioConfig {
  id: string;
  name: string;
  description: string;
  location: string;
  user_question?: string;
  index_type?: 'nbr' | 'ndvi' | 'ndwi';
  dates: {
    before?: string;
    after?: string;
    fire_start?: string;
  };
  narrative: string;
  tool_calls?: ScenarioToolCall[];
  /** The act the case belongs to (e.g. `methane`); the stage selects it when the case loads. */
  agent?: string;
  assets: {
    /** The case's own map, in order (backend-validated URLs inside the case's prefix). */
    layers?: Array<{ s3_url: string; title: string; render?: unknown }>;
    geometry_url: string;
    before: {
      tci: string;
      nbr?: string;
      ndvi?: string;
      ndwi?: string;
      [key: string]: string | undefined;
    };
    after: {
      tci: string;
      nbr?: string;
      ndvi?: string;
      ndwi?: string;
      [key: string]: string | undefined;
    };
  };
}

export function Chat() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const scenarioId = searchParams.get('scenario');

  // The stage's URL has one writer. Each edit builds on the last search the stage wrote this tick
  // (React Router's setSearchParams reads the render's params, so a reset and the act sync in one
  // tick would otherwise undo each other) and replaces the history entry.
  const pendingSearch = useRef<string | null>(null);
  useEffect(() => {
    pendingSearch.current = null;
  }, [location.search]);
  const editStageUrl = useCallback(
    (edit: (params: URLSearchParams) => void) => {
      const base = new URLSearchParams(pendingSearch.current ?? location.search);
      const next = new URLSearchParams(base);
      edit(next);
      if (next.toString() === base.toString()) return;
      pendingSearch.current = `?${next.toString()}`;
      setSearchParams(next, { replace: true });
    },
    [location.search, setSearchParams]
  );

  const { agents, selectedAgentId, selectedAgent, selectAgent, defaultAgentId } = useAgents();

  // A pre-warmed session (scripts/prewarm.py prints `/?session=<uuid>`) is adopted on load so
  // the first prompt on stage skips the runtime cold start. Anything else gets a fresh id.
  const [sessionId, setSessionId] = useState(() => {
    const warmed = searchParams.get('session');
    return warmed && UUID_PATTERN.test(warmed) ? warmed : uuidv4();
  });
  const [currentGeometry, setCurrentGeometry] = useState<GeometryData | null>(null);
  const [currentRasters, setCurrentRasters] = useState<RasterData[]>([]);
  const [drawnGeometryMessage, setDrawnGeometryMessage] = useState<string | null>(null);
  const [scenarioConfig, setScenarioConfig] = useState<ScenarioConfig | null>(null);
  const [isLoadingScenario, setIsLoadingScenario] = useState(false);
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(true); // Controls MapView render delay on scenario switch
  const [agentWorking, setAgentWorking] = useState(false);
  const [tips, setTips] = useState<Tip[]>([]);
  // Dark Vessels: the act's resting state, the session's tasking drafts, and the prompt the stage
  // sends once the officer has filed on the map.
  const [vesselRest, setVesselRest] = useState<VesselRest | null>(null);
  const [taskingKey, setTaskingKey] = useState(0);
  const [autoPrompt, setAutoPrompt] = useState<string | null>(null);

  // Track if this is the first run of the scenario effect
  const isFirstScenarioLoad = useRef(true);
  // The case already loading or loaded. React's StrictMode (the dev server) runs this effect
  // twice on mount; two loads of the same case raced the map's same-kind layer replacement and
  // left the baseline listed twice. Production builds never did, but the rehearsal view should
  // match what the stage shows.
  const scenarioLoadedFor = useRef<string | null>(null);
  // The case whose act has been chosen (the case-agent effect below), once per loaded case.
  const agentCheckedFor = useRef<string | null>(null);

  // A fresh session on a clean stage: new id (a fresh map), no layers, tips or tasking.
  const resetStage = useCallback(() => {
    setSessionId(uuidv4());
    setCurrentGeometry(null);
    setCurrentRasters([]);
    setDrawnGeometryMessage(null);
    setScenarioConfig(null);
    setScenarioError(null);
    setIsLoadingScenario(false);
    setTips([]);
    setTaskingKey(0);
    setAutoPrompt(null);
  }, []);

  // Load scenario when scenarioId is present
  useEffect(() => {
    if (!scenarioId) {
      // Leaving a case (the rail's Stage link, browser back): its layers and session go with it,
      // and the act's resting state returns.
      if (scenarioLoadedFor.current) resetStage();
      setScenarioConfig(null);
      setScenarioError(null);
      isFirstScenarioLoad.current = true;
      scenarioLoadedFor.current = null;
      agentCheckedFor.current = null;
      return;
    }
    if (scenarioLoadedFor.current === scenarioId) return;
    scenarioLoadedFor.current = scenarioId;
    // A reset or another case while this one loads: what it fetched never reaches the stage.
    const superseded = () => scenarioLoadedFor.current !== scenarioId;

    // Only reset state when SWITCHING scenarios (not on initial mount)
    if (!isFirstScenarioLoad.current) {
      // Unmount MapView first to release WebGL context
      setMapReady(false);
      setCurrentGeometry(null);
      setCurrentRasters([]);
      setScenarioConfig(null);
      setDrawnGeometryMessage(null);
      // Generate new sessionId (used as key for fresh MapView)
      const newSessionId = uuidv4();
      // Delay remount to give browser time to release WebGL resources
      setTimeout(() => {
        setSessionId(newSessionId);
        setMapReady(true);
      }, 100);
    }
    isFirstScenarioLoad.current = false;

    const loadScenario = async () => {
      setIsLoadingScenario(true);
      setScenarioError(null);

      try {
        const API_URL = getApiUrl();

        // Fetch scenario config
        const idToken = getIdToken();
        const headers: HeadersInit = { 'Content-Type': 'application/json' };
        if (idToken) {
          headers['Authorization'] = `Bearer ${idToken}`;
        }
        const response = await fetch(`${API_URL}/api/scenario/${scenarioId}`, { headers });
        if (!response.ok) {
          throw new Error(`Failed to load scenario: ${response.statusText}`);
        }

        const config: ScenarioConfig = await response.json();
        if (superseded()) return;
        console.log('✅ Scenario config loaded:', config.name);
        setScenarioConfig(config);

        const { loadGeometry } = await import('../services/api');

        // A case that lists its own layers (the Methane Hunter's) renders exactly those, with
        // the agent's recorded render hints, re-validated here like live ones. The first raster
        // listed stacks on top.
        const layers = Array.isArray(config.assets?.layers) ? config.assets.layers : [];
        if (layers.length > 0) {
          const rasters: RasterData[] = [];
          for (const [i, layer] of layers.entries()) {
            const render = parseRenderHint(layer.render) ?? undefined;
            if (layer.s3_url.toLowerCase().endsWith('.geojson')) {
              const geometry = await loadGeometry(layer.s3_url);
              if (superseded()) return;
              if (geometry) {
                geometry.locationName = layer.title;
                geometry.sourceUrl = layer.s3_url;
                if (render && render.kind !== 'raster') geometry.render = render;
                setCurrentGeometry(geometry);
              }
            } else {
              const date = layer.s3_url.match(/(\d{4}-\d{2}-\d{2})/)?.[1];
              rasters.push({
                url: layer.s3_url,
                name: layer.title,
                date,
                zIndex: layers.length - i,
                ...(render?.kind === 'raster' ? { render } : {}),
              });
            }
          }
          setCurrentRasters(rasters);
          return;
        }

        // Pre-load geometry
        const geometry = await loadGeometry(config.assets.geometry_url);
        if (superseded()) return;
        if (geometry) {
          console.log('✅ Geometry pre-loaded');
          setCurrentGeometry(geometry);
        }

        // Pre-load key rasters with explicit zIndex for stacking
        // Higher zIndex = on top visually
        const rasters: RasterData[] = [];

        // TCI Before (pre-fire sat image) - zIndex 4 (top)
        if (config.assets.before?.tci) {
          rasters.push({
            url: config.assets.before.tci,
            name: 'TCI Before',
            date: config.dates.before,
            zIndex: 4,
          });
        }

        // TCI After (post-fire sat image) - zIndex 3
        if (config.assets.after?.tci) {
          rasters.push({
            url: config.assets.after.tci,
            name: 'TCI After',
            date: config.dates.after,
            zIndex: 3,
          });
        }

        // Load appropriate index based on index_type
        const indexType = config.index_type || 'nbr'; // Default to NBR for backward compatibility
        console.log(`📊 Loading index type: ${indexType}`);
        console.log('📋 Full config:', config);
        console.log('Available assets:', {
          before: Object.keys(config.assets.before || {}),
          after: Object.keys(config.assets.after || {}),
        });
        console.log('NDVI URLs:', {
          before: config.assets.before?.ndvi,
          after: config.assets.after?.ndvi,
        });
        
        if (indexType === 'ndvi') {
          // NDVI - Normalized Difference Vegetation Index (for vegetation/deforestation analysis)
          if (config.assets.before?.ndvi) {
            rasters.push({
              url: config.assets.before.ndvi,
              name: 'NDVI Before',
              date: config.dates.before,
              zIndex: 2,
            });
          }
          if (config.assets.after?.ndvi) {
            rasters.push({
              url: config.assets.after.ndvi,
              name: 'NDVI After',
              date: config.dates.after,
              zIndex: 1,
            });
          }
        } else if (indexType === 'ndwi') {
          // NDWI - Normalized Difference Water Index (for water/drought analysis)
          if (config.assets.before?.ndwi) {
            rasters.push({
              url: config.assets.before.ndwi,
              name: 'NDWI Before',
              date: config.dates.before,
              zIndex: 2,
            });
          }
          if (config.assets.after?.ndwi) {
            rasters.push({
              url: config.assets.after.ndwi,
              name: 'NDWI After',
              date: config.dates.after,
              zIndex: 1,
            });
          }
        } else if (indexType === 'nbr') {
          // NBR - Normalized Burn Ratio (for wildfire/burn analysis)
          if (config.assets.before?.nbr) {
            rasters.push({
              url: config.assets.before.nbr,
              name: 'NBR Before',
              date: config.dates.before,
              zIndex: 2,
            });
          }
          if (config.assets.after?.nbr) {
            rasters.push({
              url: config.assets.after.nbr,
              name: 'NBR After',
              date: config.dates.after,
              zIndex: 1,
            });
          }
        }

        console.log('✅ Pre-loading rasters:', rasters.map(r => `${r.name} (z:${r.zIndex})`));
        setCurrentRasters(rasters);

      } catch (error) {
        console.error('❌ Error loading scenario:', error);
        if (superseded()) return;
        const errorMessage = error instanceof Error ? error.message : 'Failed to load scenario';
        setScenarioError(errorMessage);
        setScenarioConfig(null);
      } finally {
        if (!superseded()) setIsLoadingScenario(false);
      }
    };

    loadScenario();
  }, [scenarioId, resetStage]);

  // New session (the console's button, a runtime crash, an act switch) clears the case too: the
  // URL drops `?scenario` (and a pre-warmed `?session`) and names the act, so later prompts never
  // carry the old case and the act's resting state returns.
  const handleSessionReset = () => {
    resetStage();
    scenarioLoadedFor.current = null;
    agentCheckedFor.current = null;
    isFirstScenarioLoad.current = true;
    editStageUrl((params) => {
      params.delete('scenario');
      params.delete('session');
      if (selectedAgentId) params.set('agent', selectedAgentId);
    });
  };

  // Switching acts on the rail starts a fresh session: new id, cleared map, empty transcript.
  // The first non-null value is the initial selection, not a switch, so it does not reset.
  const previousAgentId = useRef<string | null>(null);
  // A replay case selects its own act; that switch keeps the case on the stage.
  const scenarioAgentSwitch = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedAgentId) return;
    if (previousAgentId.current && previousAgentId.current !== selectedAgentId) {
      if (scenarioAgentSwitch.current === selectedAgentId) {
        scenarioAgentSwitch.current = null;
      } else {
        handleSessionReset();
      }
    }
    previousAgentId.current = selectedAgentId;
    // handleSessionReset is recreated every render; the effect only needs to fire on a switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAgentId]);

  // Once per loaded case: play it on its own act, else the act its link named (the gallery
  // writes `?agent=`, and nothing rewrites it while the case is choosing), else the backend's
  // default; never simply the act that happens to be selected. Switching keeps the case on the
  // stage, so the prompts, the caption's speaker and any follow-up go to the right runtime.
  useEffect(() => {
    if (!scenarioConfig || !selectedAgentId || agentCheckedFor.current === scenarioConfig.id) return;
    // A case the stage has just let go of (New session, an act switch) never picks the act again.
    if (scenarioLoadedFor.current !== scenarioConfig.id) return;
    agentCheckedFor.current = scenarioConfig.id;
    const wanted = caseAgent({
      caseAgent: scenarioConfig.agent,
      linkAgent: searchParams.get('agent'),
      defaultAgentId,
      offered: agents.map((a) => a.id),
    });
    if (wanted && wanted !== selectedAgentId) {
      scenarioAgentSwitch.current = wanted;
      selectAgent(wanted);
    }
  }, [scenarioConfig, selectedAgentId, agents, selectAgent, searchParams, defaultAgentId]);

  // The URL names the act on the stage (replacing the entry), so a refresh lands on it. A case
  // still choosing its act leaves the link's `?agent=` alone until it has chosen.
  useEffect(() => {
    if (!selectedAgentId) return;
    if (scenarioId && agentCheckedFor.current !== scenarioId) return;
    // The case's own switch is on its way: name that act once it is selected, not the one before.
    if (scenarioAgentSwitch.current && scenarioAgentSwitch.current !== selectedAgentId) return;
    if (searchParams.get('agent') === selectedAgentId) return;
    editStageUrl((params) => params.set('agent', selectedAgentId));
  }, [selectedAgentId, scenarioId, scenarioConfig, searchParams, editStageUrl]);

  // Every new session boots its runtime in the background the moment it exists, so the first
  // prompt on stage never pays the cold start. Once per session and agent (a replay case may
  // switch the agent without a new session).
  const prewarmedSessions = useRef(new Set<string>());
  useEffect(() => {
    const key = `${selectedAgentId}:${sessionId}`;
    if (!selectedAgentId || prewarmedSessions.current.has(key)) return;
    prewarmedSessions.current.add(key);
    void prewarmSession(sessionId, selectedAgentId);
  }, [sessionId, selectedAgentId]);

  // The Methane Hunter's resting state is the globe with the baseline on it: every EMIT repeat site
  // and the watch-area outlines, from the agent's own cache, shown the moment the act is chosen and
  // after every reset, before any prompt. The mission's own baseline step then replaces it (same
  // kind, same layer), so nothing is listed twice; a replay case brings its own.
  useEffect(() => {
    if (selectedAgentId !== 'methane' || scenarioId || !mapReady) return;
    let cancelled = false;
    void loadMethaneBaseline().then((baseline) => {
      if (cancelled || !baseline) return;
      setCurrentGeometry((current) => current ?? {
        ...baseline,
        locationName: 'EMIT Methane Watch: global repeat sites',
        sourceUrl: 's3://methane-baseline/watch_sites_v002.geojson',
        render: { kind: 'points', group: 'watch', property: 'repeat_dates', label: 'repeat_dates', units: 'dates' },
      });
    });
    return () => { cancelled = true; };
  }, [selectedAgentId, sessionId, scenarioId, mapReady]);

  // The AI Archaeologist's resting state is the record: every site in its catalogue as a fog mark
  // over the eastern United States, so the room sees "known sites" before a word is said. Every
  // one is already on the public record; the agent can show nothing else. The first prompt dives
  // to the ground; a replay case brings its own layers.
  useEffect(() => {
    if (selectedAgentId !== 'archaeologist' || scenarioId || !mapReady) return;
    let cancelled = false;
    void loadArchaeologyRecord().then((record) => {
      if (cancelled || !record) return;
      setCurrentGeometry((current) => current ?? {
        ...record,
        locationName: 'Sites on the public record',
        sourceUrl: 's3://archaeology-record/sites_public.geojson',
        render: { kind: 'points', group: 'terrain', label: 'name' },
      });
    });
    return () => { cancelled = true; };
  }, [selectedAgentId, sessionId, scenarioId, mapReady]);

  // Dark Vessels' resting state is the sea at night: the reserve, its ports, and the latest pass's
  // three days of AIS playing back over the seabed, the moment the act is chosen and after every
  // reset, before any prompt. Fetched once per act choice; every session's map reuses it.
  useEffect(() => {
    if (selectedAgentId !== 'vessels') {
      setVesselRest(null);
      return;
    }
    let cancelled = false;
    void loadVesselRest().then((rest) => {
      if (!cancelled) setVesselRest(rest);
    });
    return () => { cancelled = true; };
  }, [selectedAgentId]);

  const handleDrawnGeometry = (geojson: any) => {
    // Format the GeoJSON as a message to send to chat
    const message = `Analyze this area:\n\`\`\`json\n${JSON.stringify(geojson, null, 2)}\n\`\`\``;
    setDrawnGeometryMessage(message);
  };

  return (
    <div className="stage">
      <div className="stage__map">
        {mapReady && (
          <MapView
            key={sessionId}
            geometry={currentGeometry}
            rasters={currentRasters}
            // No drawing on the archaeologist's act: a shape over unrecorded ground is the one way
            // the stage could look as if it marked a new site (only the public record is shown).
            drawRail={selectedAgentId !== 'archaeologist'}
            onDrawnGeometry={selectedAgentId !== 'archaeologist' ? handleDrawnGeometry : undefined}
            working={agentWorking}
            tips={tips}
            vesselRest={selectedAgentId === 'vessels' ? vesselRest : null}
            tasking={{ sessionId, caseId: scenarioId || undefined, key: taskingKey }}
            onTaskingFiled={(id) => setAutoPrompt(taskingFiledMessage(id))}
          />
        )}
      </div>

      <div className="stage__overlay">
        <ChatSidebar
          sessionId={sessionId}
          agentId={selectedAgentId ?? undefined}
          agentLabel={selectedAgent?.label}
          scenarioId={scenarioId || undefined}
          scenarioConfig={scenarioConfig}
          isLoadingScenario={isLoadingScenario}
          scenarioError={scenarioError}
          onSessionReset={handleSessionReset}
          geometry={currentGeometry}
          onGeometryUpdate={setCurrentGeometry}
          onRastersUpdate={setCurrentRasters}
          drawnGeometryMessage={drawnGeometryMessage}
          onDrawnGeometryMessageSent={() => setDrawnGeometryMessage(null)}
          onWorkingChange={setAgentWorking}
          onTipsUpdate={setTips}
          onTaskingDrafted={setTaskingKey}
          autoPrompt={autoPrompt}
          onAutoPromptSent={() => setAutoPrompt(null)}
        />
      </div>
    </div>
  );
}
