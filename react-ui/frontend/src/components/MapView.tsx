import { useEffect, useRef, useState, useMemo } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../utils/maplibreWorker.ts';
import MapboxDraw from 'maplibre-gl-draw';
import 'maplibre-gl-draw/dist/mapbox-gl-draw.css';
import { getPresignedUrl } from '../services/api.ts';
import type { GeometryData, RasterData } from '../types.ts';
import { TITILER_URL, TITILER_API_KEY } from '../config.ts';
import {
  formatLayerDisplayText,
  groupLayers,
  type LayerMetadata,
} from '../utils/layerFormatting';
import { CompareView } from './CompareView';
import { Icon } from './Icons.tsx';
import { theme } from '../theme';
import '../stage.css';

interface MapViewProps {
  geometry: GeometryData | null;
  rasters: RasterData[];
  onDrawnGeometry?: (geojson: any) => void;
}

export function MapView({ geometry, rasters, onDrawnGeometry }: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const draw = useRef<MapboxDraw | null>(null);
  const [allLayers, setAllLayers] = useState<LayerMetadata[]>([]); // Persistent layer tracking
  const addedRasterUrls = useRef<Set<string>>(new Set()); // Track added raster URLs to prevent duplicates
  const [rasterVisibility, setRasterVisibility] = useState<Record<string, boolean>>({});
  const [isLayerControlOpen, setIsLayerControlOpen] = useState(true);
  const [drawMode, setDrawMode] = useState<'none' | 'point' | 'polygon'>('none');
  const [hasDrawnFeatures, setHasDrawnFeatures] = useState(false);
  const [baseMapStyle, setBaseMapStyle] = useState<'dark' | 'google-roads' | 'google-satellite' | 'esri-satellite'>('esri-satellite');
  const [compareMode, setCompareMode] = useState<{ left: LayerMetadata; right: LayerMetadata; center?: [number, number]; zoom?: number } | null>(null);

  // Memoize layer groups to avoid repeated filtering on each render
  const layerGroups = useMemo(() => groupLayers(allLayers), [allLayers]);

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
  };

  // Handle base map style changes
  useEffect(() => {
    if (!map.current || !map.current.loaded()) return;
    updateBaseMapLayer(baseMapStyle);
  }, [baseMapStyle]);

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

    // Add global error listener
    map.current.on('error', (e) => {
      console.error('MapLibre error:', e);
    });

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

    return () => {
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

        try {
          currentMap.addSource(geometryId, {
            type: 'geojson',
            data: geometry,
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

          // Detect a similarity result from find_similar_places: match cells carry a numeric
          // `similarity` and `tier: 'match'`; the example is `tier: 'query'`. Evidence colour:
          // a single-hue violet ramp (light = less alike, deep = more alike), never the accent.
          const isSimilarity = Array.isArray(geometry.features) &&
            geometry.features.some((f) =>
              f?.properties && f.properties.tier === 'match' && typeof f.properties.similarity === 'number');

          if (isSimilarity) {
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
            // Rank labels at the cell centres (Back Row rule: 24 px, mono, halo). The style has
            // no glyphs server; maplibre >= 5.11 renders text-font with local fonts.
            currentMap.addLayer({
              id: `${geometryId}-labels`,
              type: 'symbol',
              source: geometryId,
              filter: ['==', ['get', 'tier'], 'match'],
              layout: {
                'symbol-placement': 'point',
                'text-field': ['to-string', ['get', 'rank']],
                'text-font': ['Atkinson Hyperlegible Mono', 'monospace'],
                'text-size': 24,
                'text-allow-overlap': true,
                'text-ignore-placement': true,
                visibility: 'visible',
              },
              paint: {
                'text-color': '#ffffff',
                'text-halo-color': '#2a1240',
                'text-halo-width': 2,
              },
            });
            // Popup with the numbers only (rank, similarity, centre) so nothing model-written
            // is ever injected into setHTML.
            currentMap.on('click', fillLayerId, (e: maplibregl.MapLayerMouseEvent) => {
              const p: Record<string, unknown> = (e.features && e.features[0] && e.features[0].properties) || {};
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
            });
            currentMap.on('mouseenter', fillLayerId, () => {
              currentMap.getCanvas().style.cursor = 'pointer';
            });
            currentMap.on('mouseleave', fillLayerId, () => {
              currentMap.getCanvas().style.cursor = '';
            });
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
          bounds: boundsArray
        }]);
        
        console.log(`✅ Geometry added:`, name, `bounds:`, boundsArray);

        currentMap.fitBounds(bounds, { padding: 50, duration: 1500, maxZoom: 15 });
        console.log(`🎯 fitBounds called`);
      };

      if (currentMap.isStyleLoaded()) {
        doAdd();
      } else {
        currentMap.once('styledata', doAdd);
      }
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
  const flyToLayer = (layerId: string) => {
    if (!map.current) return;
    
    const layer = allLayers.find(l => l.id === layerId);
    if (!layer || !layer.bounds) return;
    
    const mapInstance = map.current;
    const [west, south, east, north] = layer.bounds;
    
    mapInstance.fitBounds(
      [[west, south], [east, north]],
      {
        padding: 50,
        duration: 1500,
        maxZoom: 15,
      }
    );
    
    console.log(`🎯 Flying to layer:`, layer.name);
  };

  // A geometry's fill layer travels with its companions: the outline, and for a similarity
  // result the dashed query outline and the rank labels.
  const geometryCompanionIds = (fillLayerId: string) =>
    ['-outline', '-query', '-labels'].map(suffix => fillLayerId.replace('-fill', suffix));

  // Remove a specific layer
  const removeLayer = (layerId: string) => {
    if (!map.current) return;

    const layer = allLayers.find(l => l.id === layerId);
    if (!layer) return;

    const mapInstance = map.current;

    if (layer.type === 'geometry') {
      // Geometry has a fill layer plus its companion layers
      [layer.id, ...geometryCompanionIds(layer.id)].forEach(id => {
        if (mapInstance.getLayer(id)) {
          mapInstance.removeLayer(id);
        }
      });
      if (mapInstance.getSource(layer.sourceId)) {
        mapInstance.removeSource(layer.sourceId);
      }
    } else {
      // Raster layer
      if (mapInstance.getLayer(layer.id)) {
        mapInstance.removeLayer(layer.id);
      }
      if (mapInstance.getSource(layer.sourceId)) {
        mapInstance.removeSource(layer.sourceId);
      }
      // Remove URL from tracking ref
      addedRasterUrls.current.delete(layer.url);
    }
    
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

    allLayers.forEach(layer => {
      if (layer.type === 'geometry') {
        // Geometry has a fill layer plus its companion layers
        [layer.id, ...geometryCompanionIds(layer.id)].forEach(id => {
          if (mapInstance.getLayer(id)) {
            mapInstance.removeLayer(id);
          }
        });
        if (mapInstance.getSource(layer.sourceId)) {
          mapInstance.removeSource(layer.sourceId);
        }
      } else {
        // Raster layer
        if (mapInstance.getLayer(layer.id)) {
          mapInstance.removeLayer(layer.id);
        }
        if (mapInstance.getSource(layer.sourceId)) {
          mapInstance.removeSource(layer.sourceId);
        }
      }
    });

    // Clear all layers (basemap is dynamic and not tracked here)
    setAllLayers([]);
    setRasterVisibility({});
    addedRasterUrls.current.clear(); // Clear the URL tracking ref

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

          if (urlLower.includes('change_detection') || urlLower.includes('change-detection')) {
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
          let sourceMinZoom = 0;
          if (bounds) {
            const lonExtent = bounds[2] - bounds[0]; // east - west
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
            bounds: bounds,
          });

          const isVisible = rasterVisibility[layerId] !== undefined ? rasterVisibility[layerId] : true;
          setRasterVisibility(prev => ({ ...prev, [layerId]: isVisible }));

          // Find the correct insertion point for layer ordering
          // Change detection layers go on TOP of all other rasters
          // Other rasters (TCI, NDVI, etc.) go at the bottom of the COG stack
          const mapLayers = mapInstance.getStyle().layers || [];
          const basemapLayerIds = ['dark-base', 'google-roads-base', 'google-satellite-base', 'esri-satellite-base'];
          const isChangeDetection = urlLower.includes('change_detection') || urlLower.includes('change-detection');

          let beforeId: string | undefined;
          if (isChangeDetection) {
            // Change detection: add on top (no beforeId = top of stack)
            beforeId = undefined;
          } else {
            // Other rasters: add above basemaps but below existing COG layers
            const firstNonBasemapRaster = mapLayers.find((l: any) =>
              l.type === 'raster' &&
              !basemapLayerIds.includes(l.id)
            );
            beforeId = firstNonBasemapRaster ? firstNonBasemapRaster.id : undefined;
          }

          // Add raster layer (above basemaps, beforeId places new layers at bottom of COG stack)
          mapInstance.addLayer({
            id: layerId,
            type: 'raster',
            source: sourceId,
            paint: {
              'raster-opacity': 1.0,
            },
            layout: {
              visibility: isVisible ? 'visible' : 'none',
            },
          }, beforeId);

          // Track this layer with metadata
          newLayerMetadata.push({
            id: layerId,
            sourceId: sourceId,
            name: raster.name,
            url: raster.url,
            date: raster.date,
            type: 'raster',
            bounds: bounds
          });

          // CRITICAL FIX: Only add URL to ref AFTER layer is successfully added to map
          // This prevents race condition where ref is updated but layer isn't added due to abort
          addedRasterUrls.current.add(raster.url);

          console.log(`✅ [${i}] Raster successfully added to map:`, raster.name, `Layer ID: ${layerId}`, `Visible: ${isVisible}`);

          // Add error listener for tile loading
          mapInstance.on('error', (e: any) => {
            if (e.sourceId === sourceId) {
              console.error(`❌ Tile loading error for ${raster.name}:`, e);
            }
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
      
      // For geometry layers, also update the companion layers (outline, query, labels)
      if (layerId.includes('geometry') && layerId.includes('-fill')) {
        geometryCompanionIds(layerId).forEach(id => {
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


  // One row per layer: visibility toggle, name (click to fly there), remove.
  const renderLayerRow = (layer: LayerMetadata, label: string) => {
    const isVisible = rasterVisibility[layer.id] !== false;
    return (
      <div key={layer.id} className={`map-row${isVisible ? '' : ' map-row--off'}`}>
        <input
          type="checkbox"
          className="map-row__check"
          checked={isVisible}
          onChange={(e) => {
            e.stopPropagation();
            setRasterVisibility((prev) => ({ ...prev, [layer.id]: e.target.checked }));
          }}
          aria-label={`${isVisible ? 'Hide' : 'Show'} ${label}`}
        />
        <button
          type="button"
          className="map-row__name"
          onClick={() => flyToLayer(layer.id)}
          title="Fly to this layer"
        >
          {label}
        </button>
        <button
          type="button"
          className="map-row__remove"
          onClick={() => removeLayer(layer.id)}
          aria-label={`Remove ${label}`}
          title="Remove layer"
        >
          <Icon name="close" size={14} />
        </button>
      </div>
    );
  };

  const openCompare = () => {
    const sorted = [...layerGroups.tci].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const currentMap = map.current;
    const center = currentMap ? currentMap.getCenter() : { lng: 0, lat: 20 };
    const zoom = currentMap ? currentMap.getZoom() : 2;
    setCompareMode({ left: sorted[0], right: sorted[sorted.length - 1], center: [center.lng, center.lat], zoom });
  };

  return (
    <div className="map-frame">
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
      <div ref={mapContainer} className="map-canvas" />

      {/* Top right: the layers plate */}
      {allLayers.length > 0 && (
        <section className="map-plate map-layers" aria-label="Map layers">
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
              {/* Change detection always leads: it is the finding. */}
              {layerGroups.changeDetection.length > 0 && (
                <div>
                  <h3 className="map-group__title">Change detection</h3>
                  {layerGroups.changeDetection.map((layer) =>
                    renderLayerRow(layer, formatLayerDisplayText(layer, 'spectral'))
                  )}
                </div>
              )}

              {/* Search by example: ranked look-alikes, with the release's one legend. */}
              {layerGroups.similarPlaces.length > 0 && (
                <div>
                  <h3 className="map-group__title">Similar places</h3>
                  {layerGroups.similarPlaces.map((layer) =>
                    renderLayerRow(layer, formatLayerDisplayText(layer, 'similar'))
                  )}
                  <div className="map-legend" role="img" aria-label="Colour ramp: lighter violet is less alike, deeper violet is more alike">
                    <span className="map-legend__label">less alike</span>
                    <span className="map-legend__ramp" aria-hidden="true" />
                    <span className="map-legend__label">more alike</span>
                  </div>
                </div>
              )}

              {layerGroups.tci.length > 0 && (
                <div>
                  <h3 className="map-group__title">Satellite imagery</h3>
                  {layerGroups.tci.map((layer) => renderLayerRow(layer, formatLayerDisplayText(layer, 'tci')))}
                  {layerGroups.tci.length >= 2 && (
                    <button type="button" className="stage-btn map-group__action" onClick={openCompare}>
                      <Icon name="compare" size={16} />
                      Compare before and after
                    </button>
                  )}
                </div>
              )}

              {layerGroups.spectralIndices.length > 0 && (
                <div>
                  <h3 className="map-group__title">Spectral indices</h3>
                  {layerGroups.spectralIndices.map((layer) =>
                    renderLayerRow(layer, formatLayerDisplayText(layer, 'spectral'))
                  )}
                </div>
              )}

              {layerGroups.geometries.length > 0 && (
                <div>
                  <h3 className="map-group__title">Boundaries</h3>
                  {layerGroups.geometries.map((layer) => renderLayerRow(layer, layer.name))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* Bottom left: the draw rail */}
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

      {/* Bottom right: the basemap plate */}
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
    </div>
  );
}
