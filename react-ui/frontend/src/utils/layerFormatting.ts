/**
 * Utility functions for formatting and categorizing map layers
 */

import type { RenderHint } from './render.ts';

export interface LayerMetadata {
  id: string;
  sourceId: string;
  name: string;
  url: string;
  date?: string;
  type: 'raster' | 'geometry';
  bounds?: [number, number, number, number]; // [west, south, east, north]
  render?: RenderHint; // the agent's validated styling hint, when it sent one
}

// Constants
export const BASEMAP_LAYER_ID = 'esri-world-imagery-layer';

/**
 * Format date to short format (Jan 06 2025)
 */
export function formatDate(date: string): string {
  if (!date) return '';

  // A calendar date (the agent's file names): read it as written. `new Date('2023-12-28')` is
  // UTC midnight, which prints as Dec 27 anywhere west of Greenwich.
  const ymd = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) {
    const monthIndex = Number(ymd[2]) - 1;
    if (monthIndex >= 0 && monthIndex < 12) return `${MONTH_ABBR[monthIndex]} ${ymd[3]} ${ymd[1]}`;
  }

  try {
    const dateObj = new Date(date);
    // Check if date is valid
    if (isNaN(dateObj.getTime())) {
      return date; // Return original if invalid
    }

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = monthNames[dateObj.getMonth()];
    const day = String(dateObj.getDate()).padStart(2, '0');
    const year = dateObj.getFullYear();
    return `${month} ${day} ${year}`;
  } catch (e) {
    return date; // Fallback to original if parsing fails
  }
}

/**
 * Extract location and clean up layer name from tool response
 */
export function cleanLayerName(name: string): string {
  // Extract location from patterns like "Satellite Image of Hyde Park, London - October 6, 2025"
  const ofMatch = name.match(/of\s+([^-]+?)(?:\s+-|$)/i);
  if (ofMatch) {
    return ofMatch[1].trim();
  }

  // Remove common verbose prefixes and suffixes
  let cleaned = name
    .replace(/^Satellite Image of\s+/i, '')
    .replace(/^True Color Image of\s+/i, '')
    .replace(/^TCI of\s+/i, '')
    .replace(/^NDVI Vegetation Map of\s+/i, '')
    .replace(/^NBR Burn Severity Map of\s+/i, '')
    .replace(/^NDWI Water Map of\s+/i, '')
    .replace(/\s+-\s+\w+\s+\d+,\s+\d{4}.*$/i, '') // Remove verbose dates at end
    .trim();
  
  // Remove redundant suffixes like "NDVI - Vegetation Status", "NBR - Burn Severity"
  cleaned = cleaned
    .replace(/\s+NDVI\s+-\s+.*$/i, ' NDVI')
    .replace(/\s+NBR\s+-\s+.*$/i, ' NBR')
    .replace(/\s+NDWI\s+-\s+.*$/i, ' NDWI')
    .replace(/\s+Change Detection\s+-\s+.*$/i, ' Change Detection')
    .trim();
  
  return cleaned;
}

/**
 * Map technical spectral index names to friendly names
 */
export function getFriendlyIndexName(name: string): string {
  const nameLower = name.toLowerCase();
  if (nameLower.includes('change_detection') || nameLower.includes('change detection')) {
    return 'Change Detection';
  } else if (nameLower.includes('ndvi')) {
    return 'Vegetation Index';
  } else if (nameLower.includes('nbr')) {
    return 'Burn Rate';
  } else if (nameLower.includes('ndwi')) {
    return 'Water Index';
  }
  return name; // Fallback to original name
}

/**
 * Check if a layer is a change detection layer
 */
export function isChangeDetection(layer: LayerMetadata): boolean {
  const nameLower = layer.name.toLowerCase();
  const urlLower = (layer.url || '').toLowerCase();
  return nameLower.includes('change detection') ||
         nameLower.includes('change_detection') ||
         urlLower.includes('change_detection');
}

/**
 * Check if a layer is a spectral index (NDVI, NBR, NDWI) or change detection
 */
export function isSpectralIndex(layer: LayerMetadata): boolean {
  const nameLower = layer.name.toLowerCase();
  return nameLower.includes('ndvi') ||
         nameLower.includes('nbr') ||
         nameLower.includes('ndwi') ||
         isChangeDetection(layer);
}

/**
 * A "similar places" result from find_similar_places: a .geojson whose file name starts with
 * `similar_` (the tool writes `similar_<example>_<region>_<yyyymm>.geojson`). Detected from the
 * URL, never from the layer title, so a model-written title cannot move a layer between groups.
 */
export function isSimilarityLayer(layer: LayerMetadata): boolean {
  if (layer.type !== 'geometry') return false;
  const basename = (layer.url || '').split('/').pop()?.toLowerCase() ?? '';
  return basename.startsWith('similar_') && basename.endsWith('.geojson');
}

/**
 * A Methane Hunter layer: by the agent's hint (`group: 'methane'`), or, when the hint is absent
 * or was dropped, by the tools' own file names (`ch4plm_<granule>.tif` plume rasters,
 * `.../methane/plumes_*.geojson` footprints). Never by the model-written title.
 */
export function isMethaneLayer(layer: LayerMetadata): boolean {
  if (layer.render?.group === 'methane') return true;
  const url = (layer.url || '').toLowerCase();
  const basename = url.split('/').pop() ?? '';
  if (layer.type === 'raster') return /^ch4plm_.+\.tiff?$/.test(basename);
  return url.includes('/methane/') && basename.startsWith('plumes_') && basename.endsWith('.geojson');
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "Places like <example> · <Mon YYYY>" from a similarity file name; falls back to the title.
 * The example slug's last token before the `_<yyyymm>` suffix is the region, which the row
 * does not repeat (the group header already says where the search ran).
 */
export function formatSimilarityLabel(layer: LayerMetadata): string {
  const basename = (layer.url || '').split('/').pop() ?? '';
  const m = basename.match(/^similar_(.+)_(\d{4})(\d{2})\.geojson$/i);
  if (!m) return layer.name;
  const monthIndex = Number(m[3]) - 1;
  const when = monthIndex >= 0 && monthIndex < 12 ? `${MONTH_ABBR[monthIndex]} ${m[2]}` : m[2];
  // The slug is "<example>_<region>"; the example may itself contain underscores, so take the
  // title's example name when the model gave one ("Places like Central Park"), else the slug.
  // Titles seen from the model: "Places like Central Park across New York",
  // "Places Similar to Central Park — New York State, July 2025". Stop at a dash, a comma,
  // or a locating preposition.
  const fromTitle = layer.name.match(/(?:like|similar to|resembling)\s+(.+?)(?:\s*[—–-]|,|\s+(?:in|across|around|within)\b|$)/i);
  const example = fromTitle ? fromTitle[1].trim() : m[1].replace(/_/g, ' ');
  return `Places like ${example} · ${when}`;
}

/**
 * The place a clipped raster belongs to, from the agent's own file naming
 * (`<band>_clipped_<location>_<YYYY-MM-DD>.tif` in sentinel_utils): the basename without the
 * band prefix, the date suffix and the extension. Null when the URL is not in that form.
 */
export function rasterPlaceKey(layer: LayerMetadata): string | null {
  const basename = (layer.url || '').split('/').pop() ?? '';
  const m = basename.match(/^[a-z0-9]+_clipped_(.+)_(\d{4}-\d{2}-\d{2})\.tiff?$/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * The before/after pair for the compare slider: two true-colour scenes of the SAME place on
 * DIFFERENT dates. Two scenes of two different places (the eyes on two similarity matches, say)
 * are not a before and after, so no pair is returned for them. When one place has more than
 * two dates, the earliest and the latest are the pair.
 */
export function findComparePair(tciLayers: LayerMetadata[]): { left: LayerMetadata; right: LayerMetadata } | null {
  const byPlace = new Map<string, LayerMetadata[]>();
  for (const layer of tciLayers) {
    const key = rasterPlaceKey(layer);
    if (!key) continue;
    const list = byPlace.get(key) ?? [];
    list.push(layer);
    byPlace.set(key, list);
  }
  for (const layers of byPlace.values()) {
    const dated = layers
      .filter(l => !!l.date)
      .sort((a, b) => (a.date as string).localeCompare(b.date as string));
    const distinctDates = new Set(dated.map(l => l.date));
    if (distinctDates.size >= 2) {
      return { left: dated[0], right: dated[dated.length - 1] };
    }
  }
  return null;
}

/** Whether `inner` lies entirely inside `outer` ([west, south, east, north]). */
export function boundsWithin(
  inner: [number, number, number, number] | undefined,
  outer: [number, number, number, number] | undefined,
): boolean {
  if (!inner || !outer) return false;
  return inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];
}

/**
 * Format layer display text based on layer type
 */
export function formatLayerDisplayText(layer: LayerMetadata, layerType: 'tci' | 'spectral' | 'geometry' | 'similar'): string {
  if (layerType === 'similar') {
    return formatSimilarityLabel(layer);
  }
  const cleanedName = cleanLayerName(layer.name);
  // The title often already carries the date ("… Midland, Texas, 2023-12-28"); say it once.
  const formattedDate = layer.date && !cleanedName.includes(layer.date) ? formatDate(layer.date) : '';

  if (layerType === 'spectral') {
    // Use same format as TCI: "Location Index Name - Date"
    return formattedDate ? `${cleanedName} - ${formattedDate}` : cleanedName;
  } else if (layerType === 'tci') {
    return formattedDate ? `${cleanedName} - ${formattedDate}` : cleanedName;
  } else {
    // Geometry layers
    return layer.name;
  }
}

/**
 * Group layers by type for organized display
 */
export function groupLayers(layers: LayerMetadata[]) {
  const methane = layers.filter(isMethaneLayer);
  const rest = layers.filter(l => !isMethaneLayer(l));
  return {
    changeDetection: rest.filter(l =>
      l.type === 'raster' &&
      l.id !== BASEMAP_LAYER_ID &&
      isChangeDetection(l)
    ),
    methane,
    tci: rest.filter(l =>
      l.type === 'raster' &&
      l.id !== BASEMAP_LAYER_ID &&
      !isSpectralIndex(l)
    ),
    spectralIndices: rest.filter(l =>
      l.type === 'raster' &&
      l.id !== BASEMAP_LAYER_ID &&
      isSpectralIndex(l) &&
      !isChangeDetection(l)
    ),
    similarPlaces: rest.filter(l => isSimilarityLayer(l)),
    geometries: rest.filter(l => l.type === 'geometry' && !isSimilarityLayer(l)),
    basemap: layers.filter(l => l.id === BASEMAP_LAYER_ID),
  };
}
