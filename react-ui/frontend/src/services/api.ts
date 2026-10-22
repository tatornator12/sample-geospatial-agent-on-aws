import type { GeometryData, StreamEvent } from '../types.ts';
import type { VesselRest } from '../utils/vesselLayers.ts';
import { validBucket } from '../utils/vesselSteps.ts';
import { getIdToken } from '../utils/auth';

// API URL: In production (when served from same origin), use current origin
// In development, use localhost:3001 or VITE_API_URL from env
export const getApiUrl = () => {
  // If explicitly set in env, use it
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }

  // Local development (vite dev server) talks to the local backend. Decided by where the page
  // is served from, never by a build flag: a production bundle must always call its own origin.
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') {
    return 'http://localhost:3001';
  }

  // Production: use same origin (CloudFront/ALB serves both frontend + backend)
  return window.location.origin;
};

const API_URL = getApiUrl();

/**
 * Get authentication headers for API requests
 * Includes Authorization header with ID token if available
 */
function getAuthHeaders(): HeadersInit {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  // Add Authorization header if user is authenticated
  const idToken = getIdToken();
  if (idToken) {
    headers['Authorization'] = `Bearer ${idToken}`;
  }

  return headers;
}

interface AgentInvokePayload {
  prompt: string;
  sessionId: string;
  scenario_id?: string;
  agentId?: string;
}

/** One agent the backend can route to. Public fields only; the ARN never leaves the server. */
export interface AgentSummary {
  id: string;
  label: string;
  description: string;
}

export interface AgentList {
  defaultAgentId: string | null;
  agents: AgentSummary[];
}

/**
 * List the agents the presenter can switch between (GET /api/agents).
 */
export async function listAgents(): Promise<AgentList> {
  const response = await fetch(`${API_URL}/api/agents`, { headers: getAuthHeaders() });
  if (!response.ok) {
    throw new Error(`Could not list agents (HTTP ${response.status})`);
  }
  const data = (await response.json()) as Partial<AgentList>;
  return {
    defaultAgentId: data.defaultAgentId ?? null,
    agents: Array.isArray(data.agents) ? data.agents : [],
  };
}

/**
 * Stream agent responses using Server-Sent Events.
 *
 * `signal` ends the turn: the request is aborted, the body is cancelled (so the backend sees the
 * client leave and stops the agent's stream), and the generator returns quietly.
 */
export async function* streamAgentInvoke(
  prompt: string,
  sessionId: string,
  scenarioId?: string,
  agentId?: string,
  signal?: AbortSignal
): AsyncGenerator<StreamEvent> {
  const payload: AgentInvokePayload = { prompt, sessionId };
  if (scenarioId) {
    payload.scenario_id = scenarioId;
    console.log('🔥 Sending request with scenario_id:', scenarioId);
  }
  if (agentId) {
    payload.agentId = agentId;
  }
  console.log('📤 Agent payload:', payload);

  const isAbort = (error: unknown) =>
    !!signal?.aborted || (error instanceof Error && error.name === 'AbortError');

  if (signal?.aborted) return;
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/agent/invoke`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    if (isAbort(error)) return; // the turn was ended before the stream opened
    throw error;
  }

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let receivedDoneEvent = false;
  // The stream ran to its end (the reader finished, or the backend said done).
  let finished = false;
  // Ending the turn cancels the body at once, so a pending read resolves and the connection closes.
  const cancelBody = () => {
    reader.cancel().catch(() => {
      // already closed
    });
  };
  signal?.addEventListener('abort', cancelBody);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (signal?.aborted) return;

      if (done) {
        console.log('📡 Stream reader done');
        finished = true;
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE messages
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data.trim()) {
            try {
              const event: StreamEvent = JSON.parse(data);
              // When we receive 'done' event, mark it and exit the read loop
              if (event.type === 'done') {
                console.log('📡 Received done event from backend - exiting read loop');
                receivedDoneEvent = true;
                finished = true;
                // Break out of both loops
                return;
              }
              yield event;
              if (signal?.aborted) return;
            } catch (e) {
              console.error('Failed to parse SSE data:', e);
            }
          }
        }
      }
    }
  } catch (error) {
    // The turn was ended (New session, Stop, Esc): not an error, nothing more to read.
    if (isAbort(error)) return;

    // If we received a 'done' event and then got a network error, treat it as normal completion
    if (receivedDoneEvent && error instanceof Error && error.message === 'network error') {
      console.log('📡 Network error after done event - treating as normal completion');
      return;
    }
    
    // Check if this is a network error that might be due to connection closing
    const isNetworkError = error instanceof Error && error.message === 'network error';
    const isTypeError = error instanceof TypeError;
    
    if (isNetworkError || isTypeError) {
      console.warn('⚠️ Network/Type error during stream read - this may be due to connection closing');
      console.warn('⚠️ Received done event:', receivedDoneEvent);
      console.warn('⚠️ Buffer remaining:', buffer.length, 'bytes');
      
      // If we got a network error but haven't received done event, 
      // and we have some content, treat as partial success
      if (!receivedDoneEvent && buffer.length === 0) {
        console.log('📡 Network error with no remaining buffer - treating as normal completion');
        return;
      }
    }
    
    // Only throw error if it's not a connection closing issue
    if (!isNetworkError && !isTypeError) {
      console.error('❌ Stream read error:', error);
      console.error('❌ Error type:', error instanceof Error ? error.constructor.name : typeof error);
      console.error('❌ Error message:', error instanceof Error ? error.message : String(error));
      throw error;
    } else {
      // Log but don't throw for network/type errors (connection closing)
      console.warn('⚠️ Stream connection closed, treating as completion');
      return;
    }
  } finally {
    signal?.removeEventListener('abort', cancelBody);
    // Left before the end (aborted, or the caller stopped reading): close the connection too,
    // so the backend stops relaying a turn nobody is reading.
    if (!finished) cancelBody();
    try {
      reader.releaseLock();
      console.log('📡 Reader lock released');
    } catch (e) {
      console.warn('⚠️ Error releasing reader lock:', e);
    }
  }
  
  console.log('✅ Stream completed successfully');
}

/**
 * Get pre-signed URL for private S3 object
 */
export async function getPresignedUrl(s3Url: string): Promise<string | null> {
  try {
    const response = await fetch(
      `${API_URL}/api/presigned-url?s3Url=${encodeURIComponent(s3Url)}`,
      { headers: getAuthHeaders() }
    );

    if (!response.ok) {
      console.error(`❌ Pre-signed URL failed (${response.status}) for:`, s3Url);
      const errorData = await response.json().catch(() => null);
      if (errorData) console.error('Error:', errorData);
      return null;
    }

    const data = await response.json();
    return data.presignedUrl;
  } catch (error) {
    console.error('❌ Pre-signed URL error:', error);
    return null;
  }
}

/**
 * Load geometry from S3 via backend proxy
 */
export async function loadGeometry(s3Url: string): Promise<GeometryData | null> {
  try {
    const response = await fetch(
      `${API_URL}/api/geometry?s3Url=${encodeURIComponent(s3Url)}`,
      { headers: getAuthHeaders() }
    );

    if (!response.ok) {
      console.error('Failed to load geometry:', response.statusText);
      return null;
    }

    const data = await response.json();
    return data as GeometryData;
  } catch (error) {
    console.error('Error loading geometry:', error);
    return null;
  }
}

/**
 * The Methane Watch baseline the agent last cached (every EMIT repeat site and the watch-area
 * outlines), for the globe the stage shows before the first prompt. Null when none is cached yet.
 */
export async function loadMethaneBaseline(): Promise<GeometryData | null> {
  try {
    const response = await fetch(`${API_URL}/api/methane/baseline`, { headers: getAuthHeaders() });
    if (!response.ok) return null;
    return (await response.json()) as GeometryData;
  } catch {
    return null;
  }
}

/**
 * The AI Archaeologist's record: one point per site in its catalogue (all already on the public
 * record), for the map the stage shows before the first prompt. Null when it is not published.
 */
export async function loadArchaeologyRecord(): Promise<GeometryData | null> {
  try {
    const response = await fetch(`${API_URL}/api/archaeology/record`, { headers: getAuthHeaders() });
    if (!response.ok) return null;
    return (await response.json()) as GeometryData;
  } catch {
    return null;
  }
}

/**
 * Dark Vessels' resting state: the star pass's AIS replay, the reserve, its ports and the island
 * names (all already scrubbed of identity at the build). Null when it is not published. Its
 * `bucket` is kept only when it passes the bucket rule; a missing or bad one is null, which leaves
 * the step column's early-board fallback off (it waits for a streamed s3_url; review M3).
 */
export async function loadVesselRest(): Promise<VesselRest | null> {
  try {
    const response = await fetch(`${API_URL}/api/vessels/rest`, { headers: getAuthHeaders() });
    if (!response.ok) return null;
    const body = (await response.json()) as VesselRest;
    if (!body || body.version !== 1 || !Array.isArray(body.replay?.tracks)) return null;
    return { ...body, bucket: validBucket(body.bucket) };
  } catch {
    return null;
  }
}

/** The tasking card (validated server-side from the draft in S3; see backend/src/tasking.ts). */
export interface TaskingLook {
  satellite: string;
  start: string;
  share: number;
  text: string;
}
export interface TaskingBox {
  box: number;
  bounds: [number, number, number, number];
  share: number;
  look: TaskingLook | null;
}
export interface TaskingCandidate {
  id: string;
  lon: number;
  lat: number;
  port: string;
  portKm: number;
  nearestBroadcastKm: number | null;
}
export interface TaskingCardData {
  taskingId: string;
  draftedAt: string;
  passId: string;
  passSensed: string;
  counts: { broadcasting: number; port: number; unproven: number; seen_once: number; candidate: number };
  heardShare: number;
  box: TaskingBox;
  candidates: TaskingCandidate[];
  check: { hit: number; total: number; lift: number } | null;
  notes: string[];
  sentence: string;
  attribution: string;
}
export interface TaskingState {
  status: 'draft' | 'filed' | 'replay';
  filedAt?: string;
  filedBy?: string;
  choice?: { box: number; candidateIds: string[] } | null;
  card: TaskingCardData;
  boxes: TaskingBox[];
}

/** The session's newest tasking draft (or a replay case's), or null when there is none (yet). */
export async function getTasking(where: { sessionId: string } | { caseId: string }): Promise<TaskingState | null> {
  try {
    const params = new URLSearchParams(where);
    const response = await fetch(`${API_URL}/api/tasking?${params.toString()}`, { headers: getAuthHeaders() });
    if (!response.ok) return null;
    return (await response.json()) as TaskingState;
  } catch {
    return null;
  }
}

/** The officer files the tasking with the box and the candidates chosen on the map. */
export async function approveTasking(
  sessionId: string,
  taskingId: string,
  box: number,
  candidateIds: string[],
  snapshot?: string | null,
): Promise<{ ok: true; filedAt?: string; filedBy?: string } | { ok: false; error: string }> {
  try {
    const response = await fetch(`${API_URL}/api/tasking/approve`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ sessionId, taskingId, box, candidateIds, ...(snapshot ? { snapshot } : {}) }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: typeof body?.error === 'string' ? body.error : `HTTP ${response.status}` };
    return { ok: true, filedAt: body.filedAt, filedBy: body.filedBy };
  } catch {
    return { ok: false, error: 'The backend could not be reached.' };
  }
}

/**
 * Ask the backend to boot the runtime for a session before the first prompt (fire and forget).
 * Returns true when the backend accepted the request; never throws.
 */
export async function prewarmSession(sessionId: string, agentId?: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/api/agent/prewarm`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(agentId ? { sessionId, agentId } : { sessionId }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Stop an active AgentCore runtime session
 */
export async function stopRuntimeSession(sessionId: string, agentId?: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/api/agent/stop-session`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(agentId ? { sessionId, agentId } : { sessionId }),
    });

    if (!response.ok) {
      console.error('Failed to stop session:', response.statusText);
      return false;
    }

    const data = await response.json();
    console.log('✅ Session stopped:', data.message);
    return true;
  } catch (error) {
    console.error('Error stopping session:', error);
    return false;
  }
}

/** The brief card's data (validated server-side from the draft in S3; see backend/src/brief.ts). */
export interface BriefCardData {
  briefId: string;
  title: string;
  place: string;
  lat: number;
  lon: number;
  /** The watch area whose scan tipped the site (provenance, not location). */
  watchArea?: string;
  looks: number;
  candidates: number;
  passesRead: number;
  /** First day of the window the passes were read in (YYYY-MM-DD). */
  passesSince?: string;
  confidence: 'low' | 'moderate' | 'high';
  singleExplanation: string;
  /** Every hypothesis the brief lists, "possible" first, with what would confirm or rule it out. */
  hypotheses: Array<{ label: string; assessment: string; nextCheck?: string }>;
  /** The ground-record checks' sentences (VIIRS heat, Overture Maps types, the public registry and
   *  the field the site lies in), from the tools. */
  checks?: string[];
  /** What the data cannot show, and the recommended next look. */
  gaps?: string[];
  nextCollection?: string;
  /** Carbon Mapper's independent detections at the site, the tool's own sentence with its source. */
  independent?: string;
}

export interface BriefState {
  status: 'draft' | 'filed' | 'replay';
  filedAt?: string;
  filedBy?: string;
  card: BriefCardData;
}

/** A draft brief of this session (or of a replay case), or null when it is not there (yet). */
export async function getBrief(briefId: string, where: { sessionId: string } | { caseId: string }): Promise<BriefState | null> {
  try {
    const params = new URLSearchParams({ briefId, ...where });
    const response = await fetch(`${API_URL}/api/brief?${params.toString()}`, { headers: getAuthHeaders() });
    if (!response.ok) return null;
    return (await response.json()) as BriefState;
  } catch {
    return null;
  }
}

/** The analyst files the brief. The backend does the filing; the agent is only told afterwards. */
export async function approveBrief(
  sessionId: string,
  briefId: string,
  snapshot?: string | null
): Promise<{ ok: true; filedAt?: string; filedBy?: string } | { ok: false; error: string }> {
  try {
    const response = await fetch(`${API_URL}/api/brief/approve`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(snapshot ? { sessionId, briefId, snapshot } : { sessionId, briefId }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: typeof body?.error === 'string' ? body.error : `HTTP ${response.status}` };
    return { ok: true, filedAt: body.filedAt, filedBy: body.filedBy };
  } catch {
    return { ok: false, error: 'The backend could not be reached.' };
  }
}
