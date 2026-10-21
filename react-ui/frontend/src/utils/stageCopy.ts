/**
 * What the stage says for each act: the prepared prompts, the console placeholder, the speaker
 * label, and plain-language names for the agent's steps.
 */

export interface PreparedPrompt {
  label: string;
  prompt: string;
  /** Put the prompt in the console for the presenter to finish (a place name) instead of sending it. */
  fill?: boolean;
}

export interface AgentStageCopy {
  prompts: PreparedPrompt[];
  placeholder: string;
}

// Keyed by agent id (AGENT_RUNTIMES); `default` is the Earth Analyst (the `dev` and `stable`
// runtimes, and a backend with a single runtime).
const STAGE_COPY: Record<string, AgentStageCopy> = {
  // In the order the presenter clicks them on stage (Act 1 is built around Clay): the judgement
  // beat, then the similarity search; the rest are spares. Prompts are the golden ones, word for word.
  default: {
    prompts: [
      // The judgement beat (the golden prompt cloudy-scene, word for word): the first scene is cloudy
      // over the city, so the agent turns it down and fetches the next one.
      { label: 'A cloudy day, Bergen', prompt: 'Show vegetation health for Bergen, Norway as of 2025-09-15' },
      { label: 'Places like Central Park', prompt: 'Find places across New York State that look like Central Park' },
      { label: 'Vegetation, Central Park', prompt: 'Show vegetation health for Central Park, New York' },
      { label: 'Water, Folsom Lake', prompt: 'Compare water levels for Folsom Lake, California 2021 vs 2022' },
      { label: 'Scan Colorado', prompt: 'Scan Colorado for land change between 2019 and 2024' },
      {
        label: 'Wildfire, Pacific Palisades',
        prompt: 'Assess wildfire damage near Pacific Palisades, Los Angeles in January 2025',
      },
    ],
    placeholder: 'Ask about any place on Earth',
  },
  // The Methane Hunter's two beats (design.md, Act 2 run sheet); the prompts are the golden ones.
  methane: {
    prompts: [
      // Act 2 v2: the mission; the two beats below are the fallback run sheet. Not "still active"
      // (EMIT's last look can be a year old; the card says when) and not "super-emitters" (the brief
      // gives no rate): A2 P0-2 (c), P1-11. It keeps the mission's trigger words "brief me",
      // "watch areas" and "how confident" (methane_config.py), word for word the golden prompt watch-mission.
      {
        label: 'Methane Watch brief',
        prompt: 'Brief me on the watch areas where methane keeps showing up, and how confident you are.',
      },
      // The two beats work anywhere: the presenter names the region (a watch area, a basin the
      // search tool knows, or any place the geocoder finds) and presses Enter.
      {
        label: 'Find and rank plumes over…',
        prompt: 'Find the methane plumes EMIT detected in 2024 and rank them by how much methane they carry over ',
        fill: true,
      },
      { label: 'Strongest plume ever, and the ground', prompt: 'Find the strongest methane plume EMIT has ever seen, anywhere, and show me what is on the ground beneath it' },
    ],
    placeholder: 'Ask for a Methane Watch brief, or name a region and a year',
  },
  // The AI Archaeologist's beats (design.md, Act 4 run sheet); known sites only, so the
  // placeholder asks for a name on the record, never for "any place". The prompts are the golden ones.
  archaeologist: {
    prompts: [
      { label: 'The Octagon, from space', prompt: 'Show me the Newark Octagon the way an archaeologist sees it' },
      // The agent picks the line from the local relief (decision 9; golden octagon-wall-measure).
      { label: 'Measure an Octagon wall', prompt: 'Measure across a wall of the Newark Octagon, on a line you choose from the local relief.' },
      // What the LiDAR can answer, not "how was it built?", which prompt rule 4 limits (stage review D10, act4 P1-10).
      { label: 'Measure the Great Circle', prompt: 'Measure the Great Circle: how wide is it, how high is the bank, how deep is the ditch?' },
      { label: 'Where else, like this', prompt: 'Where else did they build like this?' },
    ],
    placeholder: 'Name a known site, or ask how they built it',
  },
  // Dark Vessels' four turns (design.md, Act 3 run sheet); the prompts are the golden ones. Passes on
  // file only, so the placeholder asks about a radar pass, never about live traffic.
  vessels: {
    prompts: [
      { label: 'Who is in the reserve unseen?', prompt: 'Who is in the reserve unseen?' },
      { label: 'Has a vessel gone silent?', prompt: 'Has a vessel gone silent near here?' },
      { label: 'Where should we look next?', prompt: 'Where should we look next?' },
      { label: 'Draft the patrol tasking', prompt: 'Draft the patrol tasking' },
    ],
    placeholder: 'Ask about a radar pass over the reserve',
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
  run_change_detection: 'Map the change',
  find_similar_places: 'Find similar places',
  protected_area_context: 'Check protected areas',
  watch_baseline: 'Build the baseline',
  scan_tropomi: 'Scan with TROPOMI',
  check_recent_passes: 'Cue EMIT',
  site_history: 'Check the site history',
  draft_brief: 'Draft the brief',
  brief_status: 'Check the brief',
  thermal_anomalies: 'Check for heat',
  nearby_infrastructure: 'Check what is mapped nearby',
  registry_lookup: 'Check the public registry',
  // The AI Archaeologist's four tools.
  find_known_site: 'Look up the public record',
  show_terrain: 'Show the 1 m LiDAR',
  measure_profile: 'Measure across the earthwork',
  find_similar_sites: 'Find sites of the same form',
  // Dark Vessels' tools.
  find_pass: 'Find the radar pass',
  detect_vessels: 'Find targets on the water',
  check_ais_coverage: 'Check where AIS could be heard',
  match_ais: 'Match targets to broadcasts',
  gather_evidence: 'Gather the evidence',
  predict_hotspots: 'Predict where to look',
  fleet_pattern: "Read the fleet's pattern",
  next_look: 'When the radar looks again',
  reachable_area: 'Where it could have gone',
  draft_tasking: 'Draft the tasking',
  tasking_status: 'Check the tasking',
};

export function stepName(toolName: string): string {
  return (Object.prototype.hasOwnProperty.call(STEP_NAMES, toolName) && STEP_NAMES[toolName]) || toolName.replace(/_/g, ' ');
}
