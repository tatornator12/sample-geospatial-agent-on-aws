/**
 * The Stage. The map fills the frame edge to edge; the docent's overlays (step column,
 * caption band, transcript drawer) float over it and never reflow the map.
 */
import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { useAgents } from '../agentContext';
import { prewarmSession } from '../services/api';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import { MapView } from '../components/MapView';
import { ChatSidebar } from '../components/ChatSidebar';
import type { GeometryData, RasterData } from '../types';
import { getIdToken } from '../utils/auth';
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
  assets: {
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
  const [searchParams] = useSearchParams();
  const scenarioId = searchParams.get('scenario');

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

  // Track if this is the first run of the scenario effect
  const isFirstScenarioLoad = useRef(true);

  // Load scenario when scenarioId is present
  useEffect(() => {
    if (!scenarioId) {
      setScenarioConfig(null);
      setScenarioError(null);
      isFirstScenarioLoad.current = true;
      return;
    }

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
        // Get API URL with same logic as api.ts
        const getApiUrl = () => {
          if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
          if (import.meta.env.VITE_DEV_MODE === 'true' || window.location.hostname === 'localhost') {
            return 'http://localhost:3001';
          }
          return window.location.origin;
        };
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
        console.log('✅ Scenario config loaded:', config.name);
        setScenarioConfig(config);

        // Pre-load geometry
        const { loadGeometry } = await import('../services/api');
        const geometry = await loadGeometry(config.assets.geometry_url);
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
        const errorMessage = error instanceof Error ? error.message : 'Failed to load scenario';
        setScenarioError(errorMessage);
        setScenarioConfig(null);
      } finally {
        setIsLoadingScenario(false);
      }
    };

    loadScenario();
  }, [scenarioId]);

  const handleSessionReset = () => {
    setSessionId(uuidv4());
    setCurrentGeometry(null);
    setCurrentRasters([]);
    setDrawnGeometryMessage(null);
    setScenarioConfig(null);
    setScenarioError(null);
    setIsLoadingScenario(false);
  };

  // Switching acts on the rail starts a fresh session: new id, cleared map, empty transcript.
  // The first non-null value is the initial selection, not a switch, so it does not reset.
  const { selectedAgentId, selectedAgent } = useAgents();
  const previousAgentId = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedAgentId) return;
    if (previousAgentId.current && previousAgentId.current !== selectedAgentId) {
      handleSessionReset();
    }
    previousAgentId.current = selectedAgentId;
    // handleSessionReset is recreated every render; the effect only needs to fire on a switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAgentId]);

  // Every new session boots its runtime in the background the moment it exists, so the first
  // prompt on stage never pays the cold start. Once per session id.
  const prewarmedSessions = useRef(new Set<string>());
  useEffect(() => {
    if (!selectedAgentId || prewarmedSessions.current.has(sessionId)) return;
    prewarmedSessions.current.add(sessionId);
    void prewarmSession(sessionId, selectedAgentId);
  }, [sessionId, selectedAgentId]);

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
            onDrawnGeometry={handleDrawnGeometry}
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
          onGeometryUpdate={setCurrentGeometry}
          onRastersUpdate={setCurrentRasters}
          drawnGeometryMessage={drawnGeometryMessage}
          onDrawnGeometryMessageSent={() => setDrawnGeometryMessage(null)}
        />
      </div>
    </div>
  );
}
