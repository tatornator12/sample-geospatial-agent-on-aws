import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand, StopRuntimeSessionCommand } from '@aws-sdk/client-bedrock-agentcore';
import { S3Client, GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { checkS3Access } from './s3Access';
import { abortOnClientClose, relayAgentStream } from './invokeStream';
import { isScenarioId, scenarioAgent, scenarioLayers, scenarioToolCalls } from './scenario';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Readable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { authenticateToken } from './middleware/auth';
import {
  DRAFT_MAX_BYTES,
  SNAPSHOT_MAX_BYTES,
  briefCard,
  caseBriefDraftKey,
  decodeSnapshot,
  fileRefusal,
  filedBy,
  filedMarkdown,
  isBriefId,
  isCaseId,
  isSessionId,
  sessionBriefKeys,
} from './brief';
import { notifyFiled, notifyTaskingFiled, slackWebhookUrl, taskingWebhookUrl, webhookKind } from './slack';
import { fileDecision, type FilingPlan, type FilingStore } from './filing';
import {
  HOTSPOTS_MAX_BYTES,
  TASKING_DRAFT_MAX_BYTES,
  caseTaskingDraftKey,
  filedChoice,
  isTaskingId,
  newestTaskingId,
  sessionBoxes,
  sessionHotspotsKey,
  sessionTaskingKeys,
  taskingCard,
  taskingChoice,
  taskingFiledRecord,
  taskingMarkdown,
  taskingRefusal,
  type TaskingChoice,
} from './tasking';

const BRIEF_APPROVE_PATH = '/api/brief/approve';
const TASKING_APPROVE_PATH = '/api/tasking/approve';
// The two routes that may carry a map snapshot parse their own (larger) body, after authentication.
const LARGE_BODY_PATHS = new Set([BRIEF_APPROVE_PATH, TASKING_APPROVE_PATH]);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// ========================================
// Agent runtime registry
// ========================================
// The UI can switch between several AgentCore runtimes (stable demo agent, dev runtime,
// domain agents). They are configured with AGENT_RUNTIMES, a JSON object keyed by agentId:
//
//   { "default": { "arn": "arn:aws:bedrock-agentcore:...", "label": "Earth Analyst",
//                  "description": "Sentinel-2 analysis, change detection, protected areas" } }
//
// When AGENT_RUNTIMES is absent the single AGENT_RUNTIME_ARN becomes agent `default`, so an
// existing deployment keeps working unchanged. Requests that omit agentId use `default`, or
// the first configured agent when no `default` entry exists.
interface AgentRuntime {
  id: string;
  arn: string;
  label: string;
  description: string;
  region: string;
}

const AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const AGENT_ARN_PREFIX = 'arn:aws:bedrock-agentcore:';

// Region is the fourth ARN field (arn:aws:bedrock-agentcore:us-east-1:...), so each client
// targets the runtime's own region even when the frontend is deployed elsewhere.
function regionFromArn(arn: string): string {
  return arn.split(':')[3] || process.env.AWS_REGION || 'us-east-1';
}

function loadAgentRuntimes(): Map<string, AgentRuntime> {
  const agents = new Map<string, AgentRuntime>();
  const raw = process.env.AGENT_RUNTIMES;

  if (!raw) {
    const arn = process.env.AGENT_RUNTIME_ARN;
    if (arn) {
      agents.set('default', {
        id: 'default',
        arn,
        label: 'Earth Analyst',
        description: '',
        region: regionFromArn(arn),
      });
    }
    return agents;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`AGENT_RUNTIMES is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('AGENT_RUNTIMES must be a JSON object keyed by agentId');
  }

  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!AGENT_ID_PATTERN.test(id)) {
      throw new Error(`AGENT_RUNTIMES: agentId "${id}" must be lowercase letters, digits, "-" or "_" (max 64 chars)`);
    }
    const entry = (value ?? {}) as { arn?: unknown; label?: unknown; description?: unknown };
    if (typeof entry.arn !== 'string' || !entry.arn.startsWith(AGENT_ARN_PREFIX)) {
      throw new Error(`AGENT_RUNTIMES: agent "${id}" needs an "arn" starting with ${AGENT_ARN_PREFIX}`);
    }
    agents.set(id, {
      id,
      arn: entry.arn,
      label: typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : id,
      description: typeof entry.description === 'string' ? entry.description.trim() : '',
      region: regionFromArn(entry.arn),
    });
  }

  if (agents.size === 0) {
    throw new Error('AGENT_RUNTIMES is set but contains no agents');
  }
  return agents;
}

const agentRuntimes = loadAgentRuntimes();
const defaultAgent = agentRuntimes.get('default') ?? agentRuntimes.values().next().value;

if (!defaultAgent) {
  console.warn('⚠️ No agent runtime configured. Set AGENT_RUNTIMES or AGENT_RUNTIME_ARN; /api/agent/invoke will fail until one is set.');
}

// Resolve the runtime for a request. `undefined` means "not found" and the caller answers 400;
// an omitted agentId picks the default agent.
function resolveAgent(agentId: unknown): AgentRuntime | undefined {
  if (agentId === undefined || agentId === null || agentId === '') {
    return defaultAgent;
  }
  return typeof agentId === 'string' ? agentRuntimes.get(agentId) : undefined;
}

function unknownAgentResponse(res: Response, agentId: unknown) {
  return res.status(400).json({
    error: 'Unknown agentId',
    agentId: typeof agentId === 'string' ? agentId : String(agentId),
    available: Array.from(agentRuntimes.keys()),
  });
}

// AWS Clients
// One BedrockAgentCoreClient per region, created on first use.
const bedrockClients = new Map<string, BedrockAgentCoreClient>();
function bedrockClientFor(region: string): BedrockAgentCoreClient {
  let client = bedrockClients.get(region);
  if (!client) {
    client = new BedrockAgentCoreClient({
      region,
      requestHandler: new NodeHttpHandler({
        requestTimeout: 300000,       // 5 min - total request timeout
        connectionTimeout: 10000,     // 10s connection timeout
        socketTimeout: 300000,        // 5 min - socket idle timeout (key for streaming)
      }),
    });
    bedrockClients.set(region, client);
  }
  return client;
}

const s3Client = new S3Client({
  region: defaultAgent?.region || process.env.AWS_REGION || 'us-east-1',
});

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
// JSON bodies stay at the 100 kB default everywhere except the brief and tasking approvals, which
// may carry a map snapshot; those routes parse their own (larger) body AFTER authentication.
const defaultJson = express.json();
app.use((req, res, next) => (LARGE_BODY_PATHS.has(req.path) ? next() : defaultJson(req, res, next)));

// Health check (public, no auth required)
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Config endpoint (public, no auth required) - provides runtime config to frontend
app.get('/api/config', (req: Request, res: Response) => {
  res.json({
    cognito: {
      userPoolId: process.env.COGNITO_USER_POOL_ID,
      clientId: process.env.COGNITO_CLIENT_ID,
      region: process.env.COGNITO_REGION || 'us-east-1',
    },
  });
});

// Authentication middleware for all API routes
// In production: validates JWT tokens
// In development: bypasses validation
app.use('/api/*', authenticateToken);

// Helper function to sleep
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper function to check if error is a throttling error
function isThrottlingError(error: any): boolean {
  const errorName = error.name || '';
  const statusCode = error.$metadata?.httpStatusCode;

  return (
    errorName === 'ThrottlingException' ||
    errorName === 'TooManyRequestsException' ||
    errorName === 'ServiceUnavailableException' ||
    statusCode === 429 ||
    statusCode === 503 ||
    (error.message && error.message.includes('Rate exceeded'))
  );
}

// Agent payload interface
interface AgentPayload {
  prompt: string;
  scenario_id?: string;
}

// ========================================
// Pre-warm
// ========================================
// The UI calls this the moment a session id exists (page load, New session, agent switch).
// The agent answers {"prewarm": true} with "warm" as soon as its container is up, so the
// ~30 s cold start is paid while the presenter is still talking, not after the first prompt.
// A prompt that arrives while its session is still warming waits for the warm-up instead of
// racing it on the same session id.
const prewarmsInFlight = new Map<string, Promise<void>>();

async function prewarmSession(agent: AgentRuntime, sessionId: string): Promise<void> {
  const started = Date.now();
  const response = await bedrockClientFor(agent.region).send(new InvokeAgentRuntimeCommand({
    runtimeSessionId: sessionId,
    agentRuntimeArn: agent.arn,
    qualifier: 'DEFAULT',
    payload: new TextEncoder().encode(JSON.stringify({ prewarm: true })),
  }));
  // Drain the (tiny) stream so the invocation completes.
  if (response.response) {
    for await (const _chunk of response.response as any) { /* "warm" */ }
  }
  console.log(`🔥 Pre-warmed session ${sessionId} on "${agent.id}" in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

app.post('/api/agent/prewarm', async (req: Request, res: Response) => {
  const { sessionId, agentId } = req.body;
  if (!sessionId || typeof sessionId !== 'string' || sessionId.length < 33) {
    return res.status(400).json({ error: 'sessionId (33+ characters) is required' });
  }
  const agent = resolveAgent(agentId);
  if (!agent) {
    if (agentId !== undefined && agentId !== null && agentId !== '') {
      return unknownAgentResponse(res, agentId);
    }
    return res.status(503).json({ error: 'No agent runtime configured. Set AGENT_RUNTIMES or AGENT_RUNTIME_ARN.' });
  }

  if (!prewarmsInFlight.has(sessionId)) {
    const task = prewarmSession(agent, sessionId)
      .catch((error) => console.warn(`Pre-warm failed for ${sessionId}:`, error?.message || error))
      .finally(() => prewarmsInFlight.delete(sessionId));
    prewarmsInFlight.set(sessionId, task);
  }
  // Respond immediately; the warm-up continues in the background.
  res.status(202).json({ warming: true, sessionId, agentId: agent.id });
});

// List the agents the UI can switch between. Public fields only: no ARNs or regions.
app.get('/api/agents', (req: Request, res: Response) => {
  res.json({
    defaultAgentId: defaultAgent?.id ?? null,
    agents: Array.from(agentRuntimes.values()).map(({ id, label, description }) => ({ id, label, description })),
  });
});

// Stream agent response using Server-Sent Events
app.post('/api/agent/invoke', async (req: Request, res: Response) => {
  const { prompt, sessionId, scenario_id, agentId } = req.body;

  if (!prompt || !sessionId) {
    return res.status(400).json({ error: 'prompt and sessionId are required' });
  }
  // The runtime turns scenario_id into an S3 prefix: same rule as /api/scenario/:id.
  if (scenario_id !== undefined && scenario_id !== null && scenario_id !== '' && !isScenarioId(scenario_id)) {
    return res.status(400).json({ error: 'Invalid scenario_id' });
  }

  // Resolve the runtime before the response turns into an SSE stream, so a bad agentId is a
  // plain 400 the client can handle instead of an error event.
  const agent = resolveAgent(agentId);
  if (!agent) {
    if (agentId !== undefined && agentId !== null && agentId !== '') {
      return unknownAgentResponse(res, agentId);
    }
    return res.status(503).json({ error: 'No agent runtime configured. Set AGENT_RUNTIMES or AGENT_RUNTIME_ARN.' });
  }

  if (scenario_id) {
    console.log(`🔥 Scenario mode requested: ${scenario_id}`);
  }

  // The stage ends a turn (New session, Stop, Esc) by dropping this request: from then on nothing
  // is read from AgentCore or written here.
  const abortSignal = abortOnClientClose(res).signal;

  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable proxy buffering

  // Flush headers immediately so CloudFront sees the response has started,
  // then write an initial comment byte. This is critical: the agent may take
  // 30s+ to produce its first real chunk on a cold start (new AgentCore session
  // = fresh microVM booting heavy geo libraries). CloudFront's origin response
  // timeout (default 30s) is reset on every packet received, so we MUST start
  // emitting keepalive bytes BEFORE awaiting bedrockClient.send().
  res.flushHeaders();
  res.write(`: connected\n\n`);

  // Keepalive: send SSE comments every 10s to keep CloudFront's origin response
  // timeout from firing while the agent boots / runs a long-scanning tool.
  // Started here (before send) so cold starts don't blow past the 30s limit.
  const keepaliveInterval = setInterval(() => {
    if (!res.writableEnded) {
      res.write(`: keepalive\n\n`);
    }
  }, 10000);
  abortSignal.addEventListener('abort', () => {
    clearInterval(keepaliveInterval);
    console.log(`🛑 Client closed; aborted the agent stream (session ${sessionId}, agent "${agent.id}")`);
  }, { once: true });

  try {
    const bedrockClient = bedrockClientFor(agent.region);
    const warming = prewarmsInFlight.get(sessionId);
    if (warming) {
      console.log(`⏳ Session ${sessionId} is still warming; waiting before invoking`);
      await warming;
    }
    if (abortSignal.aborted) return;
    console.log(`Invoking agent "${agent.id}" (${agent.region}) with session: ${sessionId}`);

    // Build agent payload with proper typing
    const payloadData: AgentPayload = { prompt: prompt };
    if (scenario_id) {
      payloadData.scenario_id = scenario_id;
    }

    const input = {
      runtimeSessionId: sessionId,  // AgentCore requires the session ID to be at least 33 characters
      agentRuntimeArn: agent.arn,  // Full AgentCore runtime ARN
      qualifier: 'DEFAULT',
      payload: new TextEncoder().encode(JSON.stringify(payloadData)),
    };

    console.log(`📡 Sending InvokeAgentRuntimeCommand...`);
    const command = new InvokeAgentRuntimeCommand(input);

    // Retry logic for rate limiting
    const maxRetries = 3;
    let response;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        response = await bedrockClient.send(command, {
          requestTimeout: 300000,  // 5 min timeout for long tool executions
          abortSignal,
        });

        if (attempt > 1) {
          console.log(`✅ Agent invocation succeeded on attempt ${attempt}/${maxRetries}`);
          // Notify frontend about successful retry
          res.write(`data: ${JSON.stringify({ type: 'chunk', content: `\n[Retry successful after ${attempt} attempts]\n` })}\n\n`);
        }

        break; // Success - exit retry loop
      } catch (error) {
        lastError = error;

        // The client left: an aborted call is never retried.
        if (abortSignal.aborted) throw error;
        if (isThrottlingError(error) && attempt < maxRetries) {
          console.warn(`⏳ Rate limit hit on attempt ${attempt}/${maxRetries}. Waiting 5 seconds before retry...`);
          // Notify frontend about retry
          res.write(`data: ${JSON.stringify({ type: 'chunk', content: `\n[Rate limit hit, retrying in 5 seconds... (attempt ${attempt}/${maxRetries})]\n` })}\n\n`);
          await sleep(5000);
          if (abortSignal.aborted) return;
          continue; // Retry
        } else {
          // Non-throttling error or max retries exceeded
          throw error;
        }
      }
    }

    if (!response) {
      throw lastError || new Error('Failed to invoke agent after retries');
    }

    // Stream the response - mimicking Python's iter_lines() behavior (see invokeStream.ts)
    if (response.response) {
      try {
        const relay = await relayAgentStream(response.response as any, res, abortSignal);
        if (relay.aborted) {
          console.log(`🛑 Stopped relaying after ${relay.chunks} chunks, ${relay.bytes} bytes`);
          return;
        }
      } finally {
        clearInterval(keepaliveInterval);
      }
    }
    if (abortSignal.aborted) return;

    // Send completion event
    console.log('📡 Sending done event to frontend');
    clearInterval(keepaliveInterval);
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    
    // Give the client time to receive and process the done event
    // Then close the connection gracefully
    await sleep(500);
    
    console.log('📡 Closing SSE connection');
    res.end();

  } catch (error) {
    clearInterval(keepaliveInterval);
    // The client left (New session, Stop, Esc): the abort is the expected end, and nobody reads on.
    if (abortSignal.aborted) return;
    console.error('Error invoking agent:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Detect the AgentCore "runtime failed to start / crashed" condition.
    // When a session's container crashes, that session is permanently poisoned
    // and EVERY subsequent invoke on the same sessionId returns this error.
    // We flag it so the frontend can recover by rotating to a fresh session.
    const errName = (error as any)?.name || '';
    const isRuntimeCrash =
      errName === 'RuntimeClientError' ||
      /starting the runtime|when starting the runtime|RuntimeClientError/i.test(errorMessage);

    // Only write if response is still writable
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({
        type: 'error',
        message: errorMessage,
        ...(isRuntimeCrash ? { code: 'RUNTIME_CRASH' } : {}),
      })}\n\n`);
      res.end();
    }
  }
});

// Stop agent runtime session
app.post('/api/agent/stop-session', async (req: Request, res: Response) => {
  const { sessionId, agentId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  // Sessions belong to a runtime, so the stop must go to the same agent that was invoked.
  const agent = resolveAgent(agentId);
  if (!agent) {
    if (agentId !== undefined && agentId !== null && agentId !== '') {
      return unknownAgentResponse(res, agentId);
    }
    return res.status(503).json({ error: 'No agent runtime configured. Set AGENT_RUNTIMES or AGENT_RUNTIME_ARN.' });
  }

  try {
    console.log(`Stopping runtime session: ${sessionId} on agent "${agent.id}"`);

    const command = new StopRuntimeSessionCommand({
      runtimeSessionId: sessionId,
      agentRuntimeArn: agent.arn,
      qualifier: 'DEFAULT',
    });

    await bedrockClientFor(agent.region).send(command);

    console.log(`✅ Successfully stopped session: ${sessionId}`);
    res.json({ success: true, message: 'Session stopped successfully' });

  } catch (error) {
    console.error('Error stopping session:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: 'Failed to stop session', message: errorMessage });
  }
});

// Generate pre-signed URL for private S3 objects
app.get('/api/presigned-url', async (req: Request, res: Response) => {
  // Only the data bucket's displayable prefixes and file types (see s3Access.ts).
  const access = checkS3Access(req.query.s3Url, process.env.S3_BUCKET_NAME, 'render');
  if (!access.ok) {
    console.warn(`Refused pre-signed URL (${access.status}): ${access.reason}`);
    return res.status(access.status).json({ error: access.reason });
  }
  const { bucket, key } = access;

  try {
    // Generate pre-signed URL (valid for 1 hour)
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    console.log(`Generated pre-signed URL (expires in 1 hour)`);

    res.json({ presignedUrl });

  } catch (error) {
    console.error('Error generating pre-signed URL:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: 'Failed to generate pre-signed URL', message: errorMessage });
  }
});

// Fetch scenario configuration for frontend pre-loading
app.get('/api/scenario/:scenarioId', async (req: Request, res: Response) => {
  const { scenarioId } = req.params;

  if (!scenarioId) {
    return res.status(400).json({ error: 'scenarioId parameter is required' });
  }

  // Validate scenarioId to prevent path traversal attacks
  // Only allow lowercase letters, numbers, and hyphens
  const scenarioIdPattern = /^[a-z0-9-]+$/;
  if (!scenarioIdPattern.test(scenarioId)) {
    return res.status(400).json({
      error: 'Invalid scenarioId format',
      message: 'scenarioId must contain only lowercase letters, numbers, and hyphens'
    });
  }

  console.log(`Fetching scenario config for: ${scenarioId}`);

  try {
    const bucket = process.env.S3_BUCKET_NAME;
    if (!bucket) {
      throw new Error('S3_BUCKET_NAME environment variable is not configured');
    }

    const scenarioPrefix = `use-cases/${scenarioId}/`;

    // Fetch config.json
    const configKey = `${scenarioPrefix}config.json`;
    console.log(`Fetching config from: s3://${bucket}/${configKey}`);

    const configCommand = new GetObjectCommand({
      Bucket: bucket,
      Key: configKey,
    });

    const configResponse = await s3Client.send(configCommand);
    if (!configResponse.Body) {
      return res.status(404).json({ error: 'Scenario not found' });
    }

    // Parse config
    const configChunks: Uint8Array[] = [];
    const configStream = configResponse.Body as Readable;
    for await (const chunk of configStream) {
      configChunks.push(chunk);
    }
    const configBuffer = Buffer.concat(configChunks);
    const config = JSON.parse(configBuffer.toString('utf-8'));
    console.log(`📋 Config loaded from S3:`, JSON.stringify(config, null, 2));

    // Fetch narrative.md (optional)
    let narrative = '';
    try {
      const narrativeKey = `${scenarioPrefix}narrative.md`;
      const narrativeCommand = new GetObjectCommand({
        Bucket: bucket,
        Key: narrativeKey,
      });
      const narrativeResponse = await s3Client.send(narrativeCommand);
      if (narrativeResponse.Body) {
        const narrativeChunks: Uint8Array[] = [];
        const narrativeStream = narrativeResponse.Body as Readable;
        for await (const chunk of narrativeStream) {
          narrativeChunks.push(chunk);
        }
        narrative = Buffer.concat(narrativeChunks).toString('utf-8');
      }
    } catch (e) {
      console.log(`No narrative.md found for ${scenarioId}`);
    }

    // Build asset URLs with dates from config
    const s3Prefix = `s3://${bucket}/${scenarioPrefix}`;
    const beforeDate = config.dates?.before;
    const afterDate = config.dates?.after;

    const scenario = {
      id: scenarioId,
      name: config.name || scenarioId,
      description: config.description || '',
      location: config.location || '',
      user_question: config.user_question || 'Analyze this area',
      index_type: config.index_type,
      dates: config.dates || {},
      narrative: narrative,
      agent: scenarioAgent(config),
      tool_calls: scenarioToolCalls(config, bucket, scenarioId),
      assets: {
        // A case with its own layer list (the Methane Hunter's) renders exactly those; the
        // before/after URLs below stay for the Earth Analyst's cases.
        layers: scenarioLayers(config, bucket, scenarioId),
        geometry_url: `${s3Prefix}geometry.geojson`,
        before: {
          tci: beforeDate ? `${s3Prefix}before/tci-${beforeDate}.tif` : `${s3Prefix}before/tci.tif`,
          red: beforeDate ? `${s3Prefix}before/red-${beforeDate}.tif` : `${s3Prefix}before/red.tif`,
          nir08: beforeDate ? `${s3Prefix}before/nir08-${beforeDate}.tif` : `${s3Prefix}before/nir08.tif`,
          swir2: beforeDate ? `${s3Prefix}before/swir2-${beforeDate}.tif` : `${s3Prefix}before/swir2.tif`,
          nbr: beforeDate ? `${s3Prefix}before/nbr-${beforeDate}.tif` : `${s3Prefix}before/nbr.tif`,
          ndvi: beforeDate ? `${s3Prefix}before/ndvi-${beforeDate}.tif` : `${s3Prefix}before/ndvi.tif`,
          ndwi: beforeDate ? `${s3Prefix}before/ndwi-${beforeDate}.tif` : `${s3Prefix}before/ndwi.tif`,
        },
        after: {
          tci: afterDate ? `${s3Prefix}after/tci-${afterDate}.tif` : `${s3Prefix}after/tci.tif`,
          red: afterDate ? `${s3Prefix}after/red-${afterDate}.tif` : `${s3Prefix}after/red.tif`,
          nir08: afterDate ? `${s3Prefix}after/nir08-${afterDate}.tif` : `${s3Prefix}after/nir08.tif`,
          swir2: afterDate ? `${s3Prefix}after/swir2-${afterDate}.tif` : `${s3Prefix}after/swir2.tif`,
          nbr: afterDate ? `${s3Prefix}after/nbr-${afterDate}.tif` : `${s3Prefix}after/nbr.tif`,
          ndvi: afterDate ? `${s3Prefix}after/ndvi-${afterDate}.tif` : `${s3Prefix}after/ndvi.tif`,
          ndwi: afterDate ? `${s3Prefix}after/ndwi-${afterDate}.tif` : `${s3Prefix}after/ndwi.tif`,
        },
      },
    };

    console.log(`Successfully loaded scenario: ${scenario.name}`);
    console.log(`Index type: ${scenario.index_type}`);
    console.log(`NDVI URLs: before=${scenario.assets.before.ndvi}, after=${scenario.assets.after.ndvi}`);
    res.json(scenario);

  } catch (error) {
    console.error('Error loading scenario:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: 'Failed to load scenario', message: errorMessage });
  }
});

// Load geometry from S3 GeoJSON file
app.get('/api/geometry', async (req: Request, res: Response) => {
  // Only the data bucket's displayable prefixes, GeoJSON only (see s3Access.ts).
  const access = checkS3Access(req.query.s3Url, process.env.S3_BUCKET_NAME, 'geometry');
  if (!access.ok) {
    console.warn(`Refused geometry (${access.status}): ${access.reason}`);
    return res.status(access.status).json({ error: access.reason });
  }
  const { bucket, key } = access;

  try {
    console.log(`Fetching geometry from bucket: ${bucket}, key: ${key}`);

    // Fetch from S3
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await s3Client.send(command);

    if (!response.Body) {
      return res.status(404).json({ error: 'File not found in S3' });
    }

    // Read the stream and parse as JSON
    const chunks: Uint8Array[] = [];
    const stream = response.Body as Readable;

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    const buffer = Buffer.concat(chunks);
    const geojsonText = buffer.toString('utf-8');
    const geojson = JSON.parse(geojsonText);

    console.log(`Successfully loaded GeoJSON with ${geojson.features?.length || 0} features`);

    // Return the GeoJSON
    res.json(geojson);

  } catch (error) {
    console.error('Error loading geometry from S3:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: 'Failed to load geometry', message: errorMessage });
  }
});

// ========================================
// The analyst's decision on a Methane Watch brief (see brief.ts)
// ========================================

/** An S3 object's text (capped), or null when it does not exist. Other errors throw. */
async function readS3Text(bucket: string, key: string, maxBytes: number): Promise<string | null> {
  try {
    const response = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!response.Body) return null;
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response.Body as Readable) {
      size += chunk.length;
      if (size > maxBytes) throw new Error('object larger than its cap');
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf-8');
  } catch (error: any) {
    if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}

function parseJson(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The filing core's store (filing.ts) on the data bucket. */
function s3Store(bucket: string): FilingStore {
  return {
    get: (key, maxBytes) => readS3Text(bucket, key, maxBytes),
    put: async (key, body, contentType) => {
      await s3Client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    },
  };
}

/** The keys under a prefix (at most 200): the newest tasking draft is found by its name. */
async function listKeys(bucket: string, prefix: string): Promise<string[]> {
  const out = await s3Client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 200 }));
  return (out.Contents ?? []).map((o) => o.Key ?? '').filter(Boolean);
}

// Dark Vessels' resting state (Act 3): the star pass's AIS replay, the reserve, its ports and the
// island names, published beside the vessel cache by scripts/publish_vessel_rest.py. The stage plays
// the replay the moment the act is chosen, before any prompt. A fixed key: the browser never names one.
const VESSEL_REST_KEY = 'vessels/cache/v1/rest_v1.json';
app.get('/api/vessels/rest', async (_req: Request, res: Response) => {
  const bucket = process.env.S3_BUCKET_NAME;
  if (!bucket) return res.status(503).json({ error: 'S3 bucket not configured' });
  try {
    const rest = parseJson(await readS3Text(bucket, VESSEL_REST_KEY, 3_000_000)) as
      { version?: unknown; replay?: { tracks?: unknown }; reserve?: { type?: unknown } } | null;
    if (!rest || rest.version !== 1 || !Array.isArray(rest.replay?.tracks) || typeof rest.reserve?.type !== 'string') {
      return res.status(404).json({ error: 'No resting state published yet' });
    }
    res.set('Cache-Control', 'private, max-age=300');
    return res.json(rest);
  } catch (error) {
    console.error('Vessel rest read failed:', error instanceof Error ? error.message : error);
    return res.status(500).json({ error: 'Failed to read the resting state' });
  }
});

// The Methane Watch baseline (every EMIT repeat site plus the watch-area outlines), as the agent's
// watch_baseline tool last cached it. The stage puts it on the globe the moment the Methane Hunter
// is chosen, before any prompt. 404 until the first warm run has written it.
const WATCH_SITES_CACHE_KEY = 'methane/cache/watch_sites_v002.geojson';
app.get('/api/methane/baseline', async (_req: Request, res: Response) => {
  const bucket = process.env.S3_BUCKET_NAME;
  if (!bucket) return res.status(503).json({ error: 'S3 bucket not configured' });
  try {
    const collection = parseJson(await readS3Text(bucket, WATCH_SITES_CACHE_KEY, 5_000_000)) as { type?: unknown; features?: unknown } | null;
    if (!collection || collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
      return res.status(404).json({ error: 'No baseline cached yet' });
    }
    res.set('Cache-Control', 'private, max-age=300');
    return res.json(collection);
  } catch (error) {
    console.error('Baseline read failed:', error instanceof Error ? error.message : error);
    return res.status(500).json({ error: 'Failed to read the baseline' });
  }
});

// The AI Archaeologist's record: one point per catalogue site (name, culture, designation; every
// one already on the public record), published beside its terrain cache by
// scripts/publish_site_record.py. The stage puts it on the map the moment the act is chosen,
// before any prompt. 404 until it is published.
const SITE_RECORD_KEY = 'archaeology/cache/v1/sites_public.geojson';
app.get('/api/archaeology/record', async (_req: Request, res: Response) => {
  const bucket = process.env.S3_BUCKET_NAME;
  if (!bucket) return res.status(503).json({ error: 'S3 bucket not configured' });
  try {
    const collection = parseJson(await readS3Text(bucket, SITE_RECORD_KEY, 1_000_000)) as { type?: unknown; features?: unknown } | null;
    if (!collection || collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
      return res.status(404).json({ error: 'No site record published yet' });
    }
    res.set('Cache-Control', 'private, max-age=300');
    return res.json(collection);
  } catch (error) {
    console.error('Site record read failed:', error instanceof Error ? error.message : error);
    return res.status(500).json({ error: 'Failed to read the site record' });
  }
});

// The card for a draft: the live session's (sessionId), or a replay case's (caseId, never filed).
app.get('/api/brief', async (req: Request, res: Response) => {
  const bucket = process.env.S3_BUCKET_NAME;
  const { sessionId, caseId, briefId } = req.query;
  if (!bucket) return res.status(503).json({ error: 'S3 bucket not configured' });
  if (!isBriefId(briefId)) return res.status(400).json({ error: 'Invalid briefId' });
  const live = isSessionId(sessionId);
  if (!live && !isCaseId(caseId)) return res.status(400).json({ error: 'sessionId or caseId is required' });
  try {
    if (!live) {
      const record = parseJson(await readS3Text(bucket, caseBriefDraftKey(caseId as string, briefId), DRAFT_MAX_BYTES));
      const card = briefCard(record, briefId, null);
      return card ? res.json({ status: 'replay', card }) : res.status(404).json({ error: 'Brief not found' });
    }
    const keys = sessionBriefKeys(sessionId as string, briefId);
    const card = briefCard(parseJson(await readS3Text(bucket, keys.draft, DRAFT_MAX_BYTES)), briefId, sessionId as string);
    if (!card) return res.status(404).json({ error: 'Brief not found' });
    const filed = parseJson(await readS3Text(bucket, keys.filed, 10_000)) as { filed_at?: unknown; filed_by?: unknown } | null;
    return res.json(filed
      ? { status: 'filed', filedAt: filed.filed_at, filedBy: filed.filed_by, card }
      : { status: 'draft', card });
  } catch (error) {
    console.error('Brief read failed:', error instanceof Error ? error.message : error);
    return res.status(500).json({ error: 'Failed to read the brief' });
  }
});

// Approve and file: only the analyst's click does this. Idempotent: a filed brief stays filed.
app.post(BRIEF_APPROVE_PATH, express.json({ limit: Math.ceil(SNAPSHOT_MAX_BYTES * 1.4) + 4096 }), async (req: Request, res: Response) => {
  const bucket = process.env.S3_BUCKET_NAME;
  const { sessionId, briefId, snapshot } = req.body ?? {};
  if (!bucket) return res.status(503).json({ error: 'S3 bucket not configured' });
  if (!isSessionId(sessionId) || !isBriefId(briefId)) return res.status(400).json({ error: 'Invalid sessionId or briefId' });
  const shot = decodeSnapshot(snapshot);
  if (!shot.ok) return res.status(400).json({ error: shot.reason });
  const keys = sessionBriefKeys(sessionId, briefId);
  try {
    // The filing core (filing.ts): the markdown and the snapshot first, the filed record last
    // (brief_status reads it); Slack hears about the analyst's decision after, fire and forget.
    const plan: FilingPlan = {
      keys,
      draftMaxBytes: DRAFT_MAX_BYTES,
      notFound: 'Brief not found',
      refusal: (record) => fileRefusal(record, briefId, sessionId),
      markdown: (record, by, at) => filedMarkdown((record as { markdown: string }).markdown, by, at),
      filedRecord: (_record, by, at, snapshotKey) => ({
        brief_id: briefId, session_id: sessionId, status: 'filed', filed_at: at, filed_by: by,
        markdown_key: keys.markdown, snapshot_key: snapshotKey,
      }),
      notify: (record, by, at) => {
        const card = briefCard(record, briefId, sessionId);
        if (card) notifyFiled({ card, sessionId, filedBy: by, filedAt: at, markdownKey: keys.markdown, bucket });
      },
    };
    const result = await fileDecision(s3Store(bucket), plan, shot.png, filedBy((req as any).user), new Date().toISOString());
    if (result.status === 200 && !result.body.already) console.log(`📝 Brief ${briefId} filed by ${result.body.filedBy}`);
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('Brief filing failed:', error instanceof Error ? error.message : error);
    return res.status(500).json({ error: 'Failed to file the brief' });
  }
});

// ========================================
// The officer's decision on a Dark Vessels patrol tasking (see tasking.ts)
// ========================================

// The tasking on the stage: the session's newest draft (or the one named), its card, the session's
// patrol boxes to choose from, and whether it is filed; a replay case's draft is never filed.
app.get('/api/tasking', async (req: Request, res: Response) => {
  const bucket = process.env.S3_BUCKET_NAME;
  const { sessionId, caseId, taskingId } = req.query;
  if (!bucket) return res.status(503).json({ error: 'S3 bucket not configured' });
  if (taskingId !== undefined && !isTaskingId(taskingId)) return res.status(400).json({ error: 'Invalid taskingId' });
  const live = isSessionId(sessionId);
  if (!live && !isCaseId(caseId)) return res.status(400).json({ error: 'sessionId or caseId is required' });
  try {
    const prefix = live ? `session_data/${sessionId}/taskings/` : `use-cases/${caseId}/`;
    const id = (taskingId as string | undefined) ?? newestTaskingId(await listKeys(bucket, prefix));
    if (!id) return res.status(404).json({ error: 'No tasking drafted yet' });
    if (!live) {
      const card = taskingCard(parseJson(await readS3Text(bucket, caseTaskingDraftKey(caseId as string, id), TASKING_DRAFT_MAX_BYTES)), id);
      const boxes = sessionBoxes(parseJson(await readS3Text(bucket, `use-cases/${caseId}/hotspots.json`, HOTSPOTS_MAX_BYTES)));
      return card ? res.json({ status: 'replay', card, boxes }) : res.status(404).json({ error: 'Tasking not found' });
    }
    const keys = sessionTaskingKeys(sessionId as string, id);
    const card = taskingCard(parseJson(await readS3Text(bucket, keys.draft, TASKING_DRAFT_MAX_BYTES)), id);
    if (!card) return res.status(404).json({ error: 'Tasking not found' });
    const boxes = sessionBoxes(parseJson(await readS3Text(bucket, sessionHotspotsKey(sessionId as string), HOTSPOTS_MAX_BYTES)));
    const filed = parseJson(await readS3Text(bucket, keys.filed, 10_000)) as { filed_at?: unknown; filed_by?: unknown } | null;
    return res.json(filed
      ? { status: 'filed', filedAt: filed.filed_at, filedBy: filed.filed_by, choice: filedChoice(filed), card, boxes }
      : { status: 'draft', card, boxes });
  } catch (error) {
    console.error('Tasking read failed:', error instanceof Error ? error.message : error);
    return res.status(500).json({ error: 'Failed to read the tasking' });
  }
});

// Approve and file: only the officer's click does this, with the box and the candidates the officer
// chose on the map. Idempotent: a filed tasking stays filed (and keeps its first choice).
app.post(TASKING_APPROVE_PATH, express.json({ limit: Math.ceil(SNAPSHOT_MAX_BYTES * 1.4) + 4096 }), async (req: Request, res: Response) => {
  const bucket = process.env.S3_BUCKET_NAME;
  const { sessionId, taskingId, box, candidateIds, snapshot } = req.body ?? {};
  if (!bucket) return res.status(503).json({ error: 'S3 bucket not configured' });
  if (!isSessionId(sessionId) || !isTaskingId(taskingId)) return res.status(400).json({ error: 'Invalid sessionId or taskingId' });
  const shot = decodeSnapshot(snapshot);
  if (!shot.ok) return res.status(400).json({ error: shot.reason });
  const keys = sessionTaskingKeys(sessionId, taskingId);
  try {
    // The choice is checked against the draft and the session's own boxes before anything is written.
    const card = taskingCard(parseJson(await readS3Text(bucket, keys.draft, TASKING_DRAFT_MAX_BYTES)), taskingId);
    let choice: TaskingChoice | null = null;
    if (card) {
      const boxes = sessionBoxes(parseJson(await readS3Text(bucket, sessionHotspotsKey(sessionId), HOTSPOTS_MAX_BYTES)));
      const checked = taskingChoice(card, boxes, box, candidateIds);
      if (!checked.ok) return res.status(400).json({ error: checked.reason });
      choice = checked.choice;
    }
    const cardOf = (record: unknown) => taskingCard(record, taskingId);
    const plan: FilingPlan = {
      keys,
      draftMaxBytes: TASKING_DRAFT_MAX_BYTES,
      notFound: 'Tasking not found',
      refusal: (record) => taskingRefusal(record, taskingId) ?? (choice ? null : 'This draft is not a well-formed tasking of this session.'),
      markdown: (record, by, at) => taskingMarkdown(cardOf(record)!, choice!, by, at),
      filedRecord: (record, by, at, snapshotKey) => taskingFiledRecord(cardOf(record)!, choice!, sessionId, by, at, keys, snapshotKey),
      notify: (record, by, at) => notifyTaskingFiled({
        card: cardOf(record)!, choice: choice!, filedBy: by, filedAt: at, markdownKey: keys.markdown, bucket,
      }),
    };
    const result = await fileDecision(s3Store(bucket), plan, shot.png, filedBy((req as any).user, 'officer'), new Date().toISOString());
    if (result.status === 200 && !result.body.already) {
      console.log(`📝 Tasking ${taskingId} filed by ${result.body.filedBy}: box ${choice?.box.box}, ${choice?.candidateIds.length} candidates`);
    }
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('Tasking filing failed:', error instanceof Error ? error.message : error);
    return res.status(500).json({ error: 'Failed to file the tasking' });
  }
});

// Serve static frontend files in production (MUST be last - after all API routes)
if (process.env.NODE_ENV === 'production') {
  const frontendPath = path.join(__dirname, '..', 'public');
  console.log(`Serving static frontend from: ${frontendPath}`);

  app.use(express.static(frontendPath));

  // Handle React Router - send all non-API requests to index.html
  app.get('*', (req: Request, res: Response) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
  });
}

// Start server
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
  console.log(`CORS enabled for: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
  console.log(
    `Agents: ${Array.from(agentRuntimes.values()).map(a => `${a.id} (${a.region})`).join(', ') || 'none'}` +
    (defaultAgent ? `; default = ${defaultAgent.id}` : '')
  );
  // On or off only; the webhook URL itself is never printed.
  const slackUrl = slackWebhookUrl();
  console.log(`Slack on filed briefs: ${slackUrl ? `on (${webhookKind(slackUrl)} webhook)` : (process.env.SLACK_WEBHOOK_URL ? 'off (SLACK_WEBHOOK_URL is not a Slack webhook URL)' : 'off')}`);
  const taskingUrl = taskingWebhookUrl();
  console.log(`Slack on filed taskings: ${taskingUrl ? `on (${webhookKind(taskingUrl)} webhook)` : 'off (set SLACK_TASKING_WEBHOOK_URL; the brief\'s workflow says "brief")'}`);
  if (process.env.NODE_ENV === 'production') {
    console.log(`Frontend static files enabled`);
  }
});
