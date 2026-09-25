/**
 * What the stage says for each act: the prepared prompts, the console placeholder, the idle
 * caption, the speaker label, and plain-language names for the agent's steps.
 */

export interface AgentStageCopy {
  prompts: Array<{ label: string; prompt: string }>;
  placeholder: string;
  idle: string;
}

// Keyed by agent id (AGENT_RUNTIMES); `default` is the Earth Analyst (the `dev` and `stable`
// runtimes, and a backend with a single runtime).
const STAGE_COPY: Record<string, AgentStageCopy> = {
  default: {
    prompts: [
      { label: 'Vegetation, Central Park', prompt: 'Show vegetation health for Central Park, New York' },
      {
        label: 'Wildfire, Pacific Palisades',
        prompt: 'Assess wildfire damage near Pacific Palisades, Los Angeles in January 2025',
      },
      { label: 'Water, Folsom Lake', prompt: 'Compare water levels for Folsom Lake, California 2021 vs 2022' },
      { label: 'Scan Colorado', prompt: 'Scan Colorado for land change between 2019 and 2024' },
      { label: 'Places like Central Park', prompt: 'Find places across New York State that look like Central Park' },
    ],
    placeholder: 'Ask about any place on Earth',
    idle: 'Name a place and a question. The agent finds the imagery, runs the analysis, and puts the result on the map.',
  },
  // The Methane Hunter's two beats (design.md, Act 2 run sheet); the prompts are the golden ones.
  methane: {
    prompts: [
      // Act 2 v2: the mission (the golden prompt watch-mission); the two beats below are the fallback run sheet.
      {
        label: 'Methane Watch brief',
        prompt: 'Brief me on methane super-emitters in the watch areas that are still active, and how confident you are.',
      },
      {
        label: 'Find and rank Permian plumes',
        prompt: 'Find the methane plumes EMIT detected over the Permian Basin in 2024 and rank them by how much methane they carry',
      },
      { label: 'Strongest plume and the ground', prompt: 'Show me the strongest plume and what is on the ground beneath it' },
    ],
    placeholder: 'Name a basin and a year',
    idle: 'Name a basin and a year. The agent finds the methane plumes NASA EMIT saw, ranks them, and looks at the ground beneath the strongest.',
  },
};

export function stageCopyFor(agentId: string | undefined): AgentStageCopy {
  return (agentId && Object.prototype.hasOwnProperty.call(STAGE_COPY, agentId) && STAGE_COPY[agentId]) || STAGE_COPY.default;
}

/** The act's name for the room: the runtime label without its deployment suffix ("(dev)"). */
export function stageAgentLabel(label: string | undefined): string | undefined {
  if (!label) return label;
  return label.replace(/\s*\((dev|stable|beta|test)\)\s*$/i, '') || label;
}

// Plain-language names for the step column: what the agent is doing, not its function name.
const STEP_NAMES: Record<string, string> = {
  search_methane_plumes: 'Search EMIT plumes',
  triage_plumes: 'Rank by methane',
  show_plume: 'Open the plume',
  inspect_image: 'Look at the image',
  display_visual: 'Put it on the map',
  create_bbox_from_coordinates: 'Frame the ground',
  get_rasters: 'Fetch Sentinel-2',
  get_rasters_for_dates: 'Fetch Sentinel-2 scenes',
  reverse_geocode: 'Name the place',
  find_address_candidates: 'Find the place',
  find_location_boundary: 'Get the boundary',
  get_best_geometry: 'Pick the boundary',
  run_bandmath: 'Compute the index',
  calculator: 'Calculate',
  calculate_environmental_impact: 'Estimate the impact',
  scan_region_change: 'Scan for change',
  find_similar_places: 'Find similar places',
  protected_area_context: 'Check protected areas',
};

export function stepName(toolName: string): string {
  return (Object.prototype.hasOwnProperty.call(STEP_NAMES, toolName) && STEP_NAMES[toolName]) || toolName.replace(/_/g, ' ');
}
