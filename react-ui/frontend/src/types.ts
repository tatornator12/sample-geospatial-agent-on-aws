import type { RenderHint } from './utils/render.ts';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  tools?: ToolCall[];
}

export interface ToolCall {
  name: string;
  id: string;
  params: Record<string, any>;
  status: 'executing' | 'completed';
  result?: string;
}

// Use GeoJSON standard types for geometry
export interface GeometryData {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: Record<string, any>;
    geometry: {
      type: 'Point' | 'LineString' | 'Polygon' | 'MultiPoint' | 'MultiLineString' | 'MultiPolygon';
      coordinates: any;
    };
  }>;
  locationName?: string; // Optional location name from tool call
  sourceUrl?: string; // The s3:// URL the collection was loaded from (drives layer grouping)
  render?: RenderHint; // Validated display_visual `render` hint, when the agent sent one
}

export interface StreamEvent {
  type: 'chunk' | 'done' | 'error';
  content?: string;
  message?: string;
  code?: string;
}

export interface RasterData {
  url: string;
  name: string;
  date?: string; // Optional date from title or params
  cloudCoverage?: string; // Optional cloud coverage percentage
  zIndex?: number; // Layer stacking order (higher = on top)
  render?: RenderHint; // Validated display_visual `render` hint, when the agent sent one
}
