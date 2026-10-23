/**
 * The AI Archaeologist's condition survey on the stage (decision 10, Oct 22): one row per site the
 * agent judged, its name, its verdict in the stage's own words, and the relief it looked at.
 *
 * record_condition (agents/ai-archaeologist/survey_tools.py) takes enums only and, when it accepts a
 * verdict, writes `survey_<toolUseId>.json` (this session's `archaeology/` folder, or a replay case's
 * folder) with enums and numbers. The stage reads that file, never the call's inputs alone, so a
 * refused verdict shows nothing; and it prints only its own words for the enums and the site's
 * name from the catalogue mirror below. No model-written text reaches a row.
 */
import type { ToolCall } from '../types.ts';
import type { EvidenceItem } from './evidence.ts';
import { reliefSite, shortSiteName } from './archaeoLayers.ts';

// The catalogue's sites and their first published names (agents/ai-archaeologist/data/sites_v1.json
// names[0]; pinned by tests/test_stage_mirror.py). A row names a site only from here.
export const SITE_NAMES: Readonly<Record<string, string>> = {
  'angel-mounds': 'Angel Mounds State Historic Site',
  'aztalan': 'Aztalan State Park',
  'cahokia-mounds': 'Cahokia Mounds State Historic Site',
  'effigy-mounds': 'Effigy Mounds National Monument',
  'emerald-mound': 'Emerald Mound',
  'etowah-mounds': 'Etowah Indian Mounds State Historic Site',
  'fort-ancient': 'Fort Ancient Earthworks & Nature Preserve',
  'fort-hill': 'Fort Hill Earthworks & Nature Preserve',
  'grave-creek-mound': 'Grave Creek Mound',
  'high-bank-works': 'High Bank Works',
  'hopeton-earthworks': 'Hopeton Earthworks',
  'hopewell-mound-group': 'Hopewell Mound Group',
  'kolomoki-mounds': 'Kolomoki Mounds State Park',
  'miamisburg-mound': 'Miamisburg Mound',
  'mound-city-group': 'Mound City Group',
  'mounds-state-park-great-mound': 'Great Mound (Mounds State Park)',
  'moundville': 'Moundville Archaeological Park',
  'newark-great-circle': 'Great Circle Earthworks',
  'newark-octagon': 'Octagon Earthworks',
  'ocmulgee-mounds': 'Ocmulgee Mounds National Historical Park',
  'pinson-mounds': 'Pinson Mounds State Archaeological Park',
  'plum-bayou-mounds': 'Plum Bayou Mounds Archeological State Park',
  'poverty-point': 'Monumental Earthworks of Poverty Point',
  'seip-earthworks': 'Seip Earthworks',
  'serpent-mound': 'Serpent Mound',
  'shiloh-indian-mounds': 'Shiloh Indian Mounds',
  'spiro-mounds': 'Spiro Mounds Archaeological Center',
  'winterville-mounds': 'Winterville Mounds',
};

export type SurveyVerdict = 'visible' | 'faint' | 'cannot_confirm';

// The reasons each verdict may give (survey_tools.PAIRS, same keys; pinned by tests/test_stage_mirror.py).
export const SURVEY_PAIRS: Readonly<Record<SurveyVerdict, readonly string[]>> = {
  visible: ['walls_in_relief', 'ploughed_but_traced'],
  faint: ['ploughed_but_traced', 'low_relief_only'],
  cannot_confirm: ['low_relief_only', 'no_form_seen'],
};

/** What the room reads for a verdict: plain words, said the same way in the agent's answer. */
export const VERDICT_WORDS: Readonly<Record<SurveyVerdict, string>> = {
  visible: 'Still shows',
  faint: 'Faint',
  cannot_confirm: 'Cannot confirm',
};

/** And for its reason. */
export const BECAUSE_WORDS: Readonly<Record<string, string>> = {
  walls_in_relief: 'the walls stand in relief',
  ploughed_but_traced: 'ploughed down, still traced',
  low_relief_only: 'only low, broad rises',
  no_form_seen: 'no form to trace',
};

const TOOL_USE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SESSION_ID = /^[A-Za-z0-9._-]{1,128}$/;
const TURN_ID_RE = /^[0-9a-f]{12}$/;
const BUCKET = '[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]';
const CASE_DIR = new RegExp(`^s3://(${BUCKET})/use-cases/(archaeologist-[a-z0-9-]{1,50})/[^/]+$`);
const SESSION_DIR = new RegExp(`^s3://(${BUCKET})/session_data/([A-Za-z0-9._-]{1,128})/terrain/[^/]+$`);

const own = (o: object, k: unknown): boolean => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);

/**
 * Where the survey files are: from any streamed s3_url, a replay case's folder (its files flat) or
 * THIS session's `archaeology/` folder, read off its `terrain/` folder (another session's id is
 * never followed). Null until one has streamed.
 */
export function archaeologyDirFrom(tools: readonly ToolCall[], sessionId: string | undefined): string | null {
  const sid = sessionId && SESSION_ID.test(sessionId) ? sessionId : null;
  for (const t of tools) {
    const url = t.params?.s3_url;
    if (typeof url !== 'string') continue;
    const replay = url.match(CASE_DIR);
    if (replay) return `s3://${replay[1]}/use-cases/${replay[2]}/`;
    const live = url.match(SESSION_DIR);
    if (live && sid && live[2] === sid) return `s3://${live[1]}/session_data/${sid}/archaeology/`;
  }
  return null;
}

/** The file a record_condition call writes when its verdict is accepted, by the call's own id. */
export function surveyUrl(dir: string | null, call: ToolCall): string | null {
  if (!dir || call.name !== 'record_condition' || !TOOL_USE_ID_RE.test(call.id)) return null;
  return `${dir}survey_${call.id}.json`;
}

export interface SurveyRecord {
  toolUseId: string;
  siteId: string;
  verdict: SurveyVerdict;
  because: string;
  /** Order of acceptance this turn, 1-based. */
  n: number;
  /** The match's rank in find_similar_sites, 1-based. */
  rank: number;
  distanceKm: number;
  exampleId: string;
}

const int = (v: unknown, lo: number, hi: number): number | null =>
  Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : null;

/** A survey file, field by field; null unless every field is one this stage can word. */
export function parseSurvey(raw: unknown): SurveyRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!own(SURVEY_PAIRS, r.verdict) || typeof r.because !== 'string') return null;
  const verdict = r.verdict as SurveyVerdict;
  if (!SURVEY_PAIRS[verdict].includes(r.because) || !own(BECAUSE_WORDS, r.because)) return null;
  if (!own(SITE_NAMES, r.site_id) || !own(SITE_NAMES, r.example_id) || r.site_id === r.example_id) return null;
  if (typeof r.tool_use_id !== 'string' || !TOOL_USE_ID_RE.test(r.tool_use_id)) return null;
  if (r.turn_id !== undefined && (typeof r.turn_id !== 'string' || !TURN_ID_RE.test(r.turn_id))) return null;
  const n = int(r.n, 1, 8);
  const rank = int(r.rank, 1, 8);
  const distanceKm = int(r.distance_km, 10, 5000);
  if (n === null || rank === null || distanceKm === null) return null;
  return {
    toolUseId: r.tool_use_id, siteId: r.site_id as string, verdict, because: r.because,
    n, rank, distanceKm, exampleId: r.example_id as string,
  };
}

/** The record is this call's: the same tool-use id and the site the call asked about. */
export function belongsTo(record: SurveyRecord, call: ToolCall): boolean {
  return record.toolUseId === call.id && record.siteId === call.params?.site_id;
}

export interface SurveyRowText {
  site: string;
  km: string;
  verdict: string;
  because: string;
}

/** A row's words: the site's short name, its distance, the verdict and the reason, all the stage's own. */
export function surveyRowText(record: SurveyRecord): SurveyRowText {
  return {
    site: shortSiteName(SITE_NAMES[record.siteId]),
    km: `${record.distanceKm.toLocaleString('en-GB')} km`,
    verdict: VERDICT_WORDS[record.verdict],
    because: BECAUSE_WORDS[record.because],
  };
}

/**
 * The relief the agent looked at before this verdict: the turn's latest inspection of that site's
 * local relief (lrm_ or lrm03_), re-titled in the stage's words so no model text rides in the row.
 */
export function surveyEvidence(
  record: SurveyRecord,
  evidence: readonly EvidenceItem[],
  /** Whether a look (by its tool id) came before this verdict's call; every look counts when absent. */
  before: (toolId: string) => boolean = () => true,
): EvidenceItem | null {
  const looked = evidence.filter((item) => reliefSite(item.sourceUrl) === record.siteId && before(item.toolId));
  const item = looked[looked.length - 1];
  if (!item) return null;
  return { ...item, title: `${shortSiteName(SITE_NAMES[record.siteId])}, local relief`, question: undefined, saw: undefined };
}
