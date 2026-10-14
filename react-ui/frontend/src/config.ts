// TiTiler Configuration (Required - deploy via titiler-cdk). Without its trailing slash, so the
// tile paths the map builds never carry a double slash.
export const TITILER_URL = (import.meta.env.VITE_TITILER_URL || '').replace(/\/+$/, '');
export const TITILER_API_KEY = import.meta.env.VITE_TITILER_API_KEY || '';

// The ground under the AI Archaeologist's act: a global terrain-RGB source (AWS Open Data's
// Terrain Tiles, Terrarium encoding; USGS 3DEP over the United States). The 1 m products the
// agent shows are draped on it. Overridable for another host.
export const TERRAIN_TILES_URL =
  import.meta.env.VITE_TERRAIN_TILES_URL || 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
