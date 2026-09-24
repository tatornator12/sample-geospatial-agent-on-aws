/**
 * Utility functions for formatting and categorizing map layers
 */

export interface LayerMetadata {
  id: string;
  sourceId: string;
  name: string;
  url: string;
  date?: string;
  type: 'raster' | 'geometry';
  bounds?: [number, number, number, number]; // [west, south, east, north]
}

// Constants
export const BASEMAP_LAYER_ID = 'esri-world-imagery-layer';

/**
 * Format date to short format (Jan 06 2025)
 */
export function formatDate(date: string): string {
  if (!date) return '';

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
 * Format layer display text based on layer type
 */
export function formatLayerDisplayText(layer: LayerMetadata, layerType: 'tci' | 'spectral' | 'geometry' | 'similar'): string {
  if (layerType === 'similar') {
    return formatSimilarityLabel(layer);
  }
  const cleanedName = cleanLayerName(layer.name);
  const formattedDate = layer.date ? formatDate(layer.date) : '';

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
  return {
    changeDetection: layers.filter(l =>
      l.type === 'raster' &&
      l.id !== BASEMAP_LAYER_ID &&
      isChangeDetection(l)
    ),
    tci: layers.filter(l =>
      l.type === 'raster' &&
      l.id !== BASEMAP_LAYER_ID &&
      !isSpectralIndex(l)
    ),
    spectralIndices: layers.filter(l =>
      l.type === 'raster' &&
      l.id !== BASEMAP_LAYER_ID &&
      isSpectralIndex(l) &&
      !isChangeDetection(l)
    ),
    similarPlaces: layers.filter(l => isSimilarityLayer(l)),
    geometries: layers.filter(l => l.type === 'geometry' && !isSimilarityLayer(l)),
    basemap: layers.filter(l => l.id === BASEMAP_LAYER_ID),
  };
}
