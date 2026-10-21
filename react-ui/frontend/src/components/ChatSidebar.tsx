/**
 * The Docent. Owns the conversation with the agent (streaming, tool parsing, map updates)
 * and renders it as three overlays on the stage: the presenter's console at the bottom, the
 * step column at the left (the question, what the agent did, and its answer or brief), and a
 * transcript drawer at the right when the presenter wants the full record.
 */

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message, ToolCall, GeometryData, RasterData } from '../types.ts';
import { ToolCallDisplay } from './ToolCallDisplay.tsx';
import { StepColumn } from './StepColumn.tsx';
import { EarlierTurns } from './EarlierTurns.tsx';
import { NarrationLine } from './NarrationLine.tsx';
import { EvidencePlate } from './EvidencePlate.tsx';
import { Icon } from './Icons.tsx';
import { extractEvidence, type EvidenceItem } from '../utils/evidence.ts';
import { groupSteps, methaneDirFrom, parseTip, tipManifestUrl, type Tip } from '../utils/steps.ts';
import { useStageFiles } from '../hooks/useStageFiles.ts';
import { useReplayReveal } from '../hooks/useReplayReveal.ts';
import { currentBriefId, groundChecks } from '../utils/brief.ts';
import { BriefCard } from './BriefCard.tsx';
import { stagePunctuation } from '../utils/caption.ts';
import { blankDashCells } from '../utils/tables.ts';
import { profileFromFeatures, type ProfileData } from '../utils/profileSection.ts';
import {
  BACKEND_UNREACHABLE,
  STOPPED_LINE,
  failedTurnLine,
  isNetworkFailure,
  pastTurns,
  stageAnswerText,
  stageStatusLine,
} from '../utils/turns.ts';
import { boundedSaw, latestNarration, openTool, sawByTool, withSaw } from '../utils/narration.ts';
import { stepColumnMaxHeight } from '../utils/stageLayout.ts';
import { streamAgentInvoke, loadGeometry, stopRuntimeSession } from '../services/api.ts';
import {
  cleanStreamingText,
  finalAnswer,
  parseToolCalls,
  extractAllVisualizationData,
  extractLocationChanged,
} from '../utils/parsing.ts';
import { formatScenarioAnalysis, type ScenarioConfig } from '../utils/formatScenario';
import { stageAgentLabel, stageCopyFor } from '../utils/stageCopy.ts';
import type { RenderHint } from '../utils/render.ts';

/**
 * Load tool calls from scenario config
 */
function loadToolCallsFromConfig(config: ScenarioConfig): ToolCall[] {
  // Check if config has tool_calls defined
  const configToolCalls = (config as any).tool_calls;

  if (!configToolCalls || !Array.isArray(configToolCalls)) {
    console.warn('No tool_calls found in scenario config, returning empty array');
    return [];
  }

  // Convert config tool calls to ToolCall format with unique IDs
  return configToolCalls.map((tool: any, index: number) => ({
    name: tool.name,
    id: `tool_${Date.now()}_${index}`,
    params: tool.params || {},
    status: 'completed' as const,
    result: tool.result || `Completed ${tool.name}`,
  }));
}

/** A recorded call's `saw` (what the agent said it saw), by the replayed call's id; none recorded today. */
function recordedSaw(config: ScenarioConfig, tools: ToolCall[]): Record<string, string> | undefined {
  const calls: unknown = (config as { tool_calls?: unknown }).tool_calls;
  if (!Array.isArray(calls)) return undefined;
  const saw: Record<string, string> = {};
  calls.forEach((call: unknown, i: number) => {
    const text = boundedSaw(call && typeof call === 'object' ? (call as { saw?: unknown }).saw : undefined);
    if (text && tools[i]) saw[tools[i].id] = text;
  });
  return Object.keys(saw).length > 0 ? saw : undefined;
}

interface StreamNarration {
  latest: string | null;
  saw: Record<string, string>;
}
const NO_NARRATION: StreamNarration = { latest: null, saw: {} };



interface ChatSidebarProps {
  sessionId: string;
  /** Which agent runtime owns this session; omitted means the backend default. */
  agentId?: string;
  /** The selected agent's display name, shown as the docent's speaker label. */
  agentLabel?: string;
  scenarioId?: string;
  scenarioConfig?: ScenarioConfig | null;
  isLoadingScenario?: boolean;
  scenarioError?: string | null;
  onSessionReset: () => void;
  onGeometryUpdate: (geometry: GeometryData | null) => void;
  onRastersUpdate: (rasters: RasterData[]) => void;
  drawnGeometryMessage?: string | null;
  onDrawnGeometryMessageSent?: () => void;
  onToggleSidebar?: () => void;
  /** Told when the agent starts and stops working a turn (the map's watch globe turns meanwhile). */
  onWorkingChange?: (working: boolean) => void;
  /** The TROPOMI tips as they load, for the globe. */
  onTipsUpdate?: (tips: Tip[]) => void;
  /** Dark Vessels: told how many taskings the finished turns drafted (the map's tasking plate loads the newest). */
  onTaskingDrafted?: (count: number) => void;
  /** A prompt the stage sends on the presenter's behalf (the officer filed the tasking), once. */
  autoPrompt?: string | null;
  onAutoPromptSent?: () => void;
  /** The geometry on the map right now (the stage's state, whichever loader put it there), so
   * the column can draw the archaeologist's section when its transect lands. */
  geometry?: GeometryData | null;
}

export function ChatSidebar({
  sessionId,
  agentId,
  agentLabel,
  scenarioId,
  scenarioConfig,
  isLoadingScenario,
  scenarioError,
  onSessionReset,
  onGeometryUpdate,
  onRastersUpdate,
  drawnGeometryMessage,
  onDrawnGeometryMessageSent,
  onWorkingChange,
  onTipsUpdate,
  onTaskingDrafted,
  autoPrompt,
  onAutoPromptSent,
  geometry = null,
}: ChatSidebarProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  // The archaeologist's measured sections this session, by site id: harvested from the transect
  // GeoJSON when it lands on the map (live or replayed), kept when later geometry replaces it.
  const [profiles, setProfiles] = useState<Record<string, ProfileData>>({});
  useEffect(() => {
    if (!geometry?.features) return;
    const p = profileFromFeatures(geometry.features as Parameters<typeof profileFromFeatures>[0], geometry.sourceUrl);
    if (p) setProfiles((prev) => (prev[p.siteId] === p ? prev : { ...prev, [p.siteId]: p }));
  }, [geometry]);
  const [userInput, setUserInput] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [streamingTools, setStreamingTools] = useState<ToolCall[]>([]);
  // The agent's own words while it works: its latest finished sentence (under the lit step) and
  // what it said it saw after each inspect_image (under the chip), as utils/narration.ts reads them.
  const [streamNarration, setStreamNarration] = useState<StreamNarration>(NO_NARRATION);
  const [isStreaming, setIsStreaming] = useState(false);
  useEffect(() => {
    onWorkingChange?.(isStreaming);
  }, [isStreaming, onWorkingChange]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [openEvidence, setOpenEvidence] = useState<{ item: EvidenceItem; imageUrl: string } | null>(null);
  const closeEvidence = useCallback(() => setOpenEvidence(null), []);
  const scenarioDisplayedRef = useRef(false);
  // The replay on the stage, revealed one recorded call at a time (B10); null when there is none.
  const [replayKey, setReplayKey] = useState<string | null>(null);
  const replaySeq = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  // The live session id, readable from inside a stream loop that closed over an older one.
  const liveSessionRef = useRef(sessionId);
  // The session and agent behind the stream in flight, if any.
  const streamOwnerRef = useRef<{ sessionId: string; agentId?: string; processing: boolean }>({
    sessionId,
    agentId,
    processing: false,
  });
  // The turn in flight, if any. Ending it (New session, Stop, Esc, leaving the stage) aborts its
  // request, so the backend stops relaying the agent, and every step of the turn checks it is
  // still the current one before it touches the stage.
  const turnRef = useRef<{ id: number; ctl: AbortController } | null>(null);
  const turnSeq = useRef(0);

  useEffect(() => {
    // A new session while an agent is still streaming (act switched, New session pressed):
    // end the turn and stop that runtime; nothing more from the old turn reaches the stage.
    turnRef.current?.ctl.abort();
    turnRef.current = null;
    const owner = streamOwnerRef.current;
    if (owner.processing && owner.sessionId !== sessionId) {
      owner.processing = false;
      void stopRuntimeSession(owner.sessionId, owner.agentId);
    }
    liveSessionRef.current = sessionId;
    setOpenEvidence(null);
    setProfiles({});
    setMessages([]);
    setUserInput('');
    setStreamingText('');
    setStreamingTools([]);
    setStreamNarration(NO_NARRATION);
    setIsStreaming(false);
    setIsProcessing(false);
    setReplayKey(null);
    scenarioDisplayedRef.current = false;
    // Clear any cached raster URLs from previous session
    (window as any).__lastRasterUrls = '';

    // If this session was created to recover from a runtime crash, show a
    // friendly notice so the user knows what happened and that they can resend.
    if ((window as any).__runtimeCrashRecovery) {
      (window as any).__runtimeCrashRecovery = false;
      setMessages([
        {
          role: 'assistant',
          content:
            'The previous analysis session hit a runtime error and was automatically reset. ' +
            'Please re-enter your request.',
        },
      ]);
    }
  }, [sessionId]);

  // Leaving the stage (the replay gallery, How it works) mid-turn ends the turn and its runtime.
  useEffect(
    () => () => {
      const turn = turnRef.current;
      turnRef.current = null;
      if (!turn) return;
      turn.ctl.abort();
      const owner = streamOwnerRef.current;
      if (owner.processing) {
        owner.processing = false;
        void stopRuntimeSession(owner.sessionId, owner.agentId);
      }
    },
    []
  );

  // Handle drawn geometry message from map
  useEffect(() => {
    if (drawnGeometryMessage) {
      setUserInput(drawnGeometryMessage);
      inputRef.current?.focus();
      // Notify parent that message has been received
      if (onDrawnGeometryMessageSent) {
        onDrawnGeometryMessageSent();
      }
    }
  }, [drawnGeometryMessage, onDrawnGeometryMessageSent]);

  // Display scenario analysis when scenario config is loaded
  useEffect(() => {
    // Show loading message while scenario is loading
    if (isLoadingScenario && messages.length === 0) {
      setMessages([{ role: 'assistant', content: 'Loading the replay case…', tools: [] }]);
      scenarioDisplayedRef.current = false;
      return;
    }

    // Show error message if scenario failed to load
    if (scenarioError && !scenarioDisplayedRef.current) {
      console.error('Displaying scenario error');
      setMessages([
        {
          role: 'assistant',
          content: `**The replay case could not be loaded.**\n\n${scenarioError}\n\nRefresh the page, or pick another case.`,
          tools: [],
        },
      ]);
      scenarioDisplayedRef.current = true;
      return;
    }

    // Display scenario analysis once when config is loaded
    if (scenarioConfig && !scenarioDisplayedRef.current) {
      const analysisText = formatScenarioAnalysis(scenarioConfig);

      // Load tool calls from scenario config
      const simulatedTools = loadToolCallsFromConfig(scenarioConfig);

      // Set initial messages with scenario-specific user question
      const userQuestion = (scenarioConfig as any).user_question || 'Analyze this area';
      const saw = recordedSaw(scenarioConfig, simulatedTools);
      setMessages([
        { role: 'user', content: userQuestion },
        { role: 'assistant', content: analysisText, tools: simulatedTools, ...(saw ? { saw } : {}) },
      ]);
      setReplayKey(`${scenarioId ?? 'case'}#${++replaySeq.current}`);

      scenarioDisplayedRef.current = true;
    }
  }, [scenarioConfig, scenarioError, isLoadingScenario, messages.length, scenarioId]);

  // Keep the transcript pinned to the latest turn while it is open
  useEffect(() => {
    if (transcriptOpen) {
      transcriptEndRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [transcriptOpen, messages, streamingText]);

  const clearMapLayers = () => {
    onGeometryUpdate(null);
    onRastersUpdate([]);
  };

  // Stop (the button or Esc): the turn ends here and now. Its request is aborted, so the backend
  // stops relaying the agent and nothing more from it reaches the stage; the runtime is told to
  // stop in the background, and the console is free at once.
  const stopTurn = useCallback(() => {
    const turn = turnRef.current;
    if (!turn) return;
    turnRef.current = null;
    turn.ctl.abort();
    streamOwnerRef.current.processing = false;
    setIsStreaming(false);
    setIsProcessing(false);
    setMessages((prev) => [...prev, { role: 'assistant', content: STOPPED_LINE }]);
    console.log('Stopped the turn; stopping session:', sessionId);
    void stopRuntimeSession(sessionId, agentId).then((stopped) => {
      if (!stopped) console.error('Could not stop the runtime session', sessionId);
    });
  }, [sessionId, agentId]);

  // Esc stops a turn from anywhere on the stage (the console's input is disabled while the agent
  // works, so it cannot hold the focus). Controls that own Escape keep it: a dialog, the evidence
  // plate and the agent picker (they prevent the default), sliders, lists and fields.
  useEffect(() => {
    if (!isProcessing) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const target = e.target;
      if (
        target instanceof Element &&
        target.closest('input, select, [role="slider"], [role="listbox"], [role="menu"]')
      ) {
        return;
      }
      e.preventDefault();
      stopTurn();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isProcessing, stopTurn]);

  const sendMessage = async (override?: string) => {
    const prompt = (override ?? userInput).trim();
    if (!prompt || isProcessing) {
      return;
    }

    // This turn's token: anything still in flight from an earlier one is ended, and every step
    // below checks `stale()` before it changes the stage.
    turnRef.current?.ctl.abort();
    const myTurn = { id: ++turnSeq.current, ctl: new AbortController() };
    turnRef.current = myTurn;
    const stale = () => turnRef.current !== myTurn || liveSessionRef.current !== sessionId;
    const myOwner = { sessionId, agentId, processing: true };

    setUserInput('');
    setIsProcessing(true);
    streamOwnerRef.current = myOwner;

    setMessages((prev) => [...prev, { role: 'user', content: prompt }]);

    setIsStreaming(true);
    setStreamingText('');
    setStreamingTools([]);
    setStreamNarration(NO_NARRATION);
    // The words last put on the stage this turn, so a chunk that changes nothing re-renders nothing.
    let narrationKey = '';

    const locationChanged = extractLocationChanged('', []);

    if (locationChanged) {
      clearMapLayers();
    }

    // Track which geometry URLs have already been loaded so we can load ALL
    // geometries from a turn (AOI boundary, protected-area overlay, etc.) — not
    // just the first — while de-duping across streaming updates. Each loaded
    // geometry is pushed separately and stacks as its own layer on the map.
    const loadedGeometryUrls = new Set<string>();
    // A URL that fails twice (a file the model mistyped) is not asked for again on every chunk.
    const geometryFailures = new Map<string, number>();
    const loadNewGeometries = async (list: Array<{ url: string; title: string; render?: RenderHint; revision?: number }>) => {
      for (const g of list) {
        // A file the agent rewrote in place (Dark Vessels' targets) is loaded again per showing.
        const key = `${g.url}#${g.revision ?? 0}`;
        if (loadedGeometryUrls.has(key) || (geometryFailures.get(key) ?? 0) >= 2) continue;
        loadedGeometryUrls.add(key); // mark first so rapid stream updates don't double-load
        try {
          const geometry = await Promise.race([
            loadGeometry(g.url),
            new Promise<null>((_, reject) =>
              setTimeout(() => reject(new Error('Geometry loading timeout')), 15000)
            ),
          ]);
          // The turn ended while the file loaded: it never reaches the new session's map.
          if (stale()) return;
          if (geometry) {
            geometry.locationName = g.title;
            geometry.sourceUrl = g.url;
            if (g.render) geometry.render = g.render;
            onGeometryUpdate(geometry);
          } else {
            loadedGeometryUrls.delete(key);
            geometryFailures.set(key, (geometryFailures.get(key) ?? 0) + 1);
            console.error('Failed to load geometry (null) for:', g.url);
          }
        } catch (error) {
          loadedGeometryUrls.delete(key);
          geometryFailures.set(key, (geometryFailures.get(key) ?? 0) + 1);
          console.error(`Exception loading geometry from ${g.url}:`, error);
        }
      }
    };
    let lastRasterCount = 0;
    let fullResponse = '';
    let accumulatedTools: ToolCall[] = [];
    let streamCompletedNormally = false;

    try {
      for await (const event of streamAgentInvoke(prompt, sessionId, scenarioId, agentId, myTurn.ctl.signal)) {
        // Ended (New session, act switched, Stop, Esc): drop the rest of this stream.
        if (stale()) {
          return;
        }
        if (event.type === 'chunk' && event.content) {
          const cleaned = cleanStreamingText(event.content);
          if (cleaned) {
            fullResponse += cleaned;

            // Parse tools and get clean text (with JSON removed)
            let tools: ToolCall[] = [];
            let cleanText = '';
            try {
              const parsed = parseToolCalls(fullResponse);
              tools = parsed.tools;
              cleanText = parsed.cleanText;
            } catch (parseError) {
              console.error('Failed to parse tools from response:', parseError);
              cleanText = fullResponse; // Fallback to showing raw response
            }

            setStreamingText(cleanText);

            // A sentence a chip's "Saw:" line prints is not said again under the lit step (the
            // chips are this turn's inspect_image steps; Dark Vessels shows no Saw line).
            const chips = agentId !== 'vessels' ? new Set(extractEvidence(tools, sessionId).map((e) => e.toolId)) : null;
            const narration = {
              latest: latestNarration(fullResponse, chips ? { sawShown: (id) => chips.has(id) } : {}),
              saw: sawByTool(fullResponse),
            };
            const key = JSON.stringify(narration);
            if (key !== narrationKey) {
              narrationKey = key;
              setStreamNarration(narration);
            }

            // Update accumulated tools (merge with existing to avoid duplicates)
            const existingIds = new Set(accumulatedTools.map((t) => t.id));
            const newTools = tools.filter((t) => !existingIds.has(t.id));
            accumulatedTools = [...accumulatedTools, ...newTools];
            // The call the agent has started lights its step while the tool runs (A1 P1-2); the
            // layers, evidence and the turn's record keep only finished calls. Not on Dark Vessels.
            const started = agentId !== 'vessels' ? openTool(fullResponse) : null;
            setStreamingTools(
              started && !accumulatedTools.some((t) => t.id === started.id)
                ? [...accumulatedTools, { id: started.id, name: started.name, params: {}, status: 'executing' }]
                : accumulatedTools
            );

            const { rasters: allRasterData, geometries: allGeometryData } =
              extractAllVisualizationData(accumulatedTools);

            // Load any geometries not yet loaded (AOI boundary, protected-area
            // overlays, ...). Multiple geometries stack as separate map layers.
            if (allGeometryData.length > 0) {
              await loadNewGeometries(allGeometryData);
              if (stale()) return;
            }

            // Handle raster updates with debouncing to prevent excessive updates
            if (allRasterData.length > 0) {
              const currentUrls = allRasterData.map((r) => r.url).sort().join('|');
              const lastUrls = lastRasterCount > 0 ? (window as any).__lastRasterUrls || '' : '';

              if (currentUrls !== lastUrls) {
                const rasters: RasterData[] = allRasterData.map((r) => ({
                  url: r.url,
                  name: r.title,
                  date: r.date,
                  cloudCoverage: r.cloudCoverage,
                  ...(r.render ? { render: r.render } : {}),
                }));

                // Use setTimeout to defer raster updates and prevent blocking the stream
                setTimeout(() => {
                  if (!stale()) onRastersUpdate(rasters);
                }, 0);

                lastRasterCount = allRasterData.length;
                (window as any).__lastRasterUrls = currentUrls;
              }
            }
          }
        } else if (event.type === 'error') {
          console.error('Stream error from backend:', event.message);

          // A RUNTIME_CRASH means the AgentCore container died and this session
          // is now permanently poisoned — every further message on it returns the
          // same error. Recover automatically by rotating to a fresh session so
          // the user can simply resend, instead of the chat being bricked.
          const isRuntimeCrash =
            event.code === 'RUNTIME_CRASH' ||
            /starting the runtime|RuntimeClientError/i.test(event.message || '');

          if (isRuntimeCrash) {
            console.warn('Runtime crash detected, rotating to a fresh session');
            (window as any).__runtimeCrashRecovery = true;
            onSessionReset();
            return; // session reset; useEffect will seed a recovery notice
          }

          // The steps the agent finished stay on the stage above the failed line (A1 P1-9).
          const done = accumulatedTools;
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: `Error: ${event.message}`, ...(done.length > 0 ? { tools: done } : {}) },
          ]);
          return; // Exit early on error
        }
      }

      // Ended while the last event was in flight (or the stream closed because it was ended):
      // the turn's layers and answer never land in the session that follows.
      if (stale()) return;

      // Mark stream as completed normally
      streamCompletedNormally = true;

      // Final extraction with error handling
      let finalRasterData: any[] = [];
      let finalGeometryData: any[] = [];
      try {
        const extracted = extractAllVisualizationData(accumulatedTools);
        finalRasterData = extracted.rasters;
        finalGeometryData = extracted.geometries;
      } catch (error) {
        console.error('Failed to extract visualization data:', error);
      }

      // Final pass: load any geometries the streaming loop didn't get to.
      if (finalGeometryData.length > 0) {
        await loadNewGeometries(finalGeometryData);
        if (stale()) return;
      }

      // Handle final raster updates
      if (finalRasterData.length > 0) {
        const currentUrls = finalRasterData.map((r) => r.url).sort().join('|');
        const lastUrls = (window as any).__lastRasterUrls || '';

        if (currentUrls !== lastUrls || finalRasterData.length > lastRasterCount) {
          const rasters: RasterData[] = finalRasterData.map((r) => ({
            url: r.url,
            name: r.title,
            date: r.date,
            cloudCoverage: r.cloudCoverage,
            ...(r.render ? { render: r.render } : {}),
          }));

          // Defer final raster update to prevent blocking
          setTimeout(() => {
            if (!stale()) onRastersUpdate(rasters);
          }, 0);

          lastRasterCount = finalRasterData.length;
          (window as any).__lastRasterUrls = currentUrls;
        }
      }

      const { cleanText } = parseToolCalls(fullResponse);

      const completedTools = accumulatedTools.map((tool) => ({
        ...tool,
        status: 'completed' as const,
      }));

      if (stale()) return;
      const saw = sawByTool(fullResponse, { finished: true });
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: cleanText,
          answer: finalAnswer(fullResponse),
          tools: completedTools.length > 0 ? completedTools : undefined,
          ...(Object.keys(saw).length > 0 ? { saw } : {}),
        },
      ]);
    } catch (error) {
      console.error('Exception while calling agent:', error);

      // Show user-friendly error message, unless the turn was ended or a newer one owns the stage.
      // A request that never reached the backend says so (S8): the agent never started.
      if (!stale()) {
        const errorMessage = isNetworkFailure(error)
          ? BACKEND_UNREACHABLE
          : error instanceof Error ? error.message : String(error);
        const done = accumulatedTools;
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `Error: ${errorMessage}`, ...(done.length > 0 ? { tools: done } : {}) },
        ]);
      }
    } finally {
      // Only the turn that still owns the stage may clear the working state; an ended turn
      // finishing late must not stomp on a session or a turn that is already running again.
      if (turnRef.current === myTurn) {
        turnRef.current = null;
        setIsStreaming(false);
        setIsProcessing(false);
      }
      if (streamOwnerRef.current === myOwner) {
        myOwner.processing = false;
      }

      if (!streamCompletedNormally) {
        console.warn('Stream did not complete normally. Check logs above for errors.');
      }
    }
  };

  // Esc while working is the window listener above (this field is disabled then).
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  // What the room reads: the current streaming sentence, or the last thing the agent said.
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  // The question on the stage: the presenter's last prompt (the console clears on send).
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  // The answer on the stage: what the agent said after its last tool call (a replay's recorded
  // narrative, or a stopped or failed turn's one line, has no answer field and stands as is).
  // Two columns at most in the column (tables.ts): a third column the model wrote anyway folds
  // into the second, so the room never reads a value with its documented figure cut off.
  const answerText = !isStreaming && lastAssistant ? stageAnswerText(lastAssistant.answer ?? lastAssistant.content) : '';
  const answerFailed = /^Error:/.test(answerText);
  // The turns before the one on the stage, as records the presenter can reopen above its question.
  const lastUserIndex = messages.map((m) => m.role).lastIndexOf('user');
  const earlierTurns = useMemo(() => pastTurns(messages), [messages]);

  // A replay shows its work first: its recorded calls one at a time, the last lit, then the
  // answer (B10). Only while the replay is the only turn on the stage; not on Dark Vessels.
  const replayTools = !isStreaming && messages.length === 2 && replayKey ? lastAssistant?.tools ?? [] : [];
  const reducedMotion = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const reveal = useReplayReveal(replayKey, replayTools.length, reducedMotion);
  const revealing = reveal.revealing && replayTools.length > 0 && agentId !== 'vessels';
  // Where the agent is: this turn's tools while working, the last turn's when finished.
  const stepTools = isStreaming ? streamingTools : revealing ? replayTools.slice(0, reveal.shown) : lastAssistant?.tools || [];
  // What the agent looked at: the inspect_image steps of the same turn, each with what the agent
  // said it saw (Dark Vessels' chips keep their titles alone: its copy is its own act's).
  const showSaw = agentId !== 'vessels';
  const evidence = withSaw(
    extractEvidence(stepTools, sessionId),
    showSaw ? (isStreaming ? streamNarration.saw : lastAssistant?.saw) : undefined
  );
  // Where this session's methane files live (the pass filmstrip reads its manifest there): from
  // any s3_url a tool was given in this session, this turn first.
  const methaneDir = methaneDirFrom([...stepTools, ...messages.flatMap((m) => m.tools ?? [])], sessionId);
  // The draft brief on the stage, if the latest answer drafted one (or the decision on it is pending).
  const briefId = currentBriefId(messages);
  // The TROPOMI tips: one manifest per scanned area, read as the scans finish. The step column lists
  // them and the map draws them on the globe (via onTipsUpdate).
  const scanCalls = stepTools.filter((t) => t.name === 'scan_tropomi');
  const tipUrls = scanCalls.map((c) => tipManifestUrl(methaneDir, c)).filter((u): u is string => !!u);
  const tipFiles = useStageFiles<Tip>(tipUrls, (raw, url) => {
    const area = url.match(/tip_([a-z_]+)\.json$/)?.[1]?.replace(/_/g, ' ');
    return area ? parseTip(raw, area) : null;
  });
  const tipKey = tipUrls.join('\n');
  const tips = useMemo(
    () => (tipKey ? tipKey.split('\n') : []).map((u) => tipFiles[u]).filter((t): t is Tip => !!t),
    [tipFiles, tipKey]
  );
  useEffect(() => {
    onTipsUpdate?.(tips);
  }, [tips, onTipsUpdate]);
  // The brief card's last look (EMIT's newest pass at the site, the TROPOMI tip over it): the cues
  // and tips of the whole session, so the card reads the same through the analyst's decision turn.
  // The tips are the ones already loaded (useStageFiles keeps every file it read this session).
  const sessionTools = messages.flatMap((m) => m.tools ?? []);
  const briefCues = sessionTools.filter((t) => t.name === 'check_recent_passes');
  const briefTips = sessionTools
    .map((c) => tipManifestUrl(methaneDir, c))
    .map((u) => (u ? tipFiles[u] : undefined))
    .filter((t): t is Tip => !!t);
  // Dark Vessels: every finished draft_tasking puts the newest draft on the map's tasking plate.
  const taskingDrafts = messages.reduce((n, m) => n + (m.tools ?? []).filter((t) => t.name === 'draft_tasking').length, 0);
  useEffect(() => {
    if (!isStreaming) onTaskingDrafted?.(taskingDrafts);
  }, [taskingDrafts, isStreaming, onTaskingDrafted]);
  // The stage's own prompt (the officer filed on the map): sent once, when the agent is free.
  useEffect(() => {
    if (!autoPrompt || isProcessing) return;
    onAutoPromptSent?.();
    void sendMessage(autoPrompt);
    // sendMessage is recreated every render; the prompt is what triggers this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrompt, isProcessing]);
  // This act's prompts, placeholder and idle line; the room hears the act's name, not "(dev)".
  const copy = stageCopyFor(agentId);
  const speaker = stageAgentLabel(agentLabel) ?? 'Agent';

  const canSend = !isProcessing && userInput.trim().length > 0;

  // The step column: shown while the agent works and for the turn just finished. A turn that
  // drafted the brief ends on the brief card (it is the answer); any other turn ends on the answer.
  const draftedBrief = stepTools.some((t) => t.name === 'draft_brief');
  const showBrief = !!briefId && !isStreaming && !revealing;
  const showAnswer = !isStreaming && !revealing && !!answerText && !(showBrief && draftedBrief);
  const showColumn = isStreaming || revealing || stepTools.length > 0 || showAnswer || earlierTurns.length > 0;
  const columnTitle = isStreaming ? 'The agent is working' : stepTools.length > 0 ? 'What the agent did' : 'What the agent said';
  const [stepsOpen, setStepsOpen] = useState(true);
  // One status line for screen readers (S15): the lit step while working, then how the turn ended.
  const statusLine = lastUser
    ? stageStatusLine({
        working: isStreaming || revealing,
        tools: stepTools,
        answer: answerText,
        brief: showBrief && draftedBrief,
        failed: answerFailed ? failedTurnLine(answerText, { tools: stepTools }) : null,
      })
    : '';
  // The same count the column's "Show all N steps" uses (consecutive calls of one tool are one step).
  const stepCount = groupSteps(stepTools).length;

  // The column grows to the draw rail, or stops above the console where the two overlap
  // (a narrow screen); measured, since the console's height follows its wrapped prompts.
  const columnRef = useRef<HTMLElement>(null);
  const docentRef = useRef<HTMLDivElement>(null);
  const [columnMax, setColumnMax] = useState<number | null>(null);
  useLayoutEffect(() => {
    const column = columnRef.current;
    const docent = docentRef.current;
    const stage = column?.offsetParent as HTMLElement | null;
    if (!column || !docent || !stage) return;
    const measure = () => {
      const s = stage.getBoundingClientRect();
      const d = docent.getBoundingClientRect();
      const c = column.getBoundingClientRect();
      const rail = stage.querySelector('.map-rail')?.getBoundingClientRect();
      setColumnMax(
        stepColumnMaxHeight({
          stageHeight: s.height,
          columnRight: c.right - s.left,
          docentLeft: d.left - s.left,
          docentTop: d.top - s.top,
          railTop: rail ? rail.top - s.top : s.height - 120,
        }),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(docent);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [showColumn]);

  // When the turn ends, the answer's first line comes to the top of the column (under its head),
  // so the line to repeat is in view; a short answer cannot scroll that far and leaves the steps
  // above it (B5). The brief card scrolls itself into view.
  const answerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const column = columnRef.current;
    const answer = answerRef.current;
    if (!showAnswer || !stepsOpen || !column || !answer) return;
    // The column scrolls, never the stage behind it (scrollIntoView would move every ancestor).
    const head = column.querySelector<HTMLElement>('.stage-steps__head')?.offsetHeight ?? 52;
    const top = answer.getBoundingClientRect().top - column.getBoundingClientRect().top + column.scrollTop - head - 4;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    column.scrollTo?.({ top: Math.max(0, top), behavior: still ? 'auto' : 'smooth' });
  }, [showAnswer, stepsOpen, answerText]);
  // While the agent works, the lit step and its sentence stay in view under the earlier turns'
  // rows (unless the presenter has a record open).
  const liveEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!(isStreaming || revealing) || !stepsOpen || columnRef.current?.querySelector('.earlier-turn__record')) return;
    liveEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [isStreaming, revealing, stepsOpen, stepTools.length, streamNarration.latest]);

  return (
    <>
      {/* Always mounted, so the first step is announced too; the column's list is not a live region. */}
      <p className="stage-status" role="status">{statusLine}</p>
      {/* Left: the step column. The question, what the agent did, and its answer or brief. */}
      {showColumn && (
        <section
          ref={columnRef}
          className={`stage-steps${stepsOpen ? '' : ' stage-steps--closed'}`}
          aria-label="The agent's steps and answer"
          style={columnMax ? { maxHeight: columnMax } : undefined}
        >
          <div className="stage-steps__head">
            <button
              type="button"
              className="stage-steps__toggle"
              onClick={() => setStepsOpen((o) => !o)}
              aria-expanded={stepsOpen}
              title={stepsOpen ? 'Minimize to see more of the map' : 'Show the steps and the answer'}
            >
              <Icon name={stepsOpen ? 'chevron-down' : 'chevron-right'} size={14} />
              <h2 className="stage-steps__title">{columnTitle}</h2>
              {stepCount > 0 && <span className="stage-steps__count">{stepCount}</span>}
              {isStreaming && (
                <span className="docent-working" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              )}
            </button>
          </div>
          {stepsOpen && (
            <>
              {earlierTurns.length > 0 && (
                <EarlierTurns
                  // A new turn closes any record the presenter had open, so the live steps lead.
                  key={`earlier-${lastUserIndex}`}
                  turns={earlierTurns}
                  sessionId={sessionId}
                  speaker={speaker}
                  showSaw={showSaw}
                  onOpenEvidence={(item, imageUrl) => setOpenEvidence({ item, imageUrl })}
                  methaneDir={methaneDir}
                  profiles={profiles}
                />
              )}
              {lastUser && <p className="stage-steps__ask" title={lastUser.content}>{lastUser.content}</p>}
              {stepTools.length > 0 && (
                <StepColumn
                  steps={stepTools}
                  live={isStreaming || revealing}
                  evidence={evidence}
                  onOpenEvidence={(item, imageUrl) => setOpenEvidence({ item, imageUrl })}
                  methaneDir={methaneDir}
                  tips={tips}
                  compact={showBrief && draftedBrief}
                  profiles={profiles}
                  // One column per turn: a new turn starts with its earlier steps folded again.
                  key={`steps-${briefId ?? lastUserIndex}`}
                />
              )}
              {isStreaming && stepTools.length === 0 && <p className="stage-steps__reading">Reading the request</p>}
              {/* The agent's latest sentence, under the lit step (always the last row) while it works. */}
              {isStreaming && <NarrationLine key={`narration-${lastUserIndex}`} text={streamNarration.latest} />}
              {(isStreaming || revealing) && <div ref={liveEndRef} className="stage-steps__live-end" />}
              {showBrief && (
                <BriefCard
                  key={briefId}
                  briefId={briefId}
                  sessionId={sessionId}
                  caseId={scenarioId}
                  busy={isProcessing}
                  onDecision={(prompt) => void sendMessage(prompt)}
                  methaneDir={methaneDir}
                  cues={briefCues}
                  tips={briefTips}
                  checks={groundChecks(sessionTools)}
                />
              )}
              {showAnswer && (
                <div ref={answerRef} className={`stage-answer${answerFailed ? ' stage-answer--failed' : ''}`}>
                  <span className="stage-answer__who">{speaker}</span>
                  {answerFailed ? (
                    <p className="stage-answer__text">{failedTurnLine(answerText, { tools: stepTools })}</p>
                  ) : (
                    <div className="stage-answer__text markdown-content">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{answerText}</ReactMarkdown>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* Enlarged evidence, over everything on the stage */}
      {openEvidence && (
        <EvidencePlate
          item={openEvidence.item}
          imageUrl={openEvidence.imageUrl}
          onClose={closeEvidence}
        />
      )}

      {/* Bottom: the presenter's console and the prepared prompts. The answer is in the step column. */}
      <div className="stage-docent" ref={docentRef}>
        <form
          className="docent-console"
          onSubmit={(e) => {
            e.preventDefault();
            void sendMessage();
          }}
        >
          <textarea
            ref={inputRef}
            className="docent-input"
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isProcessing ? 'Working… press Esc to stop' : copy.placeholder}
            disabled={isProcessing}
            rows={1}
            aria-label="Prompt for the agent"
          />
          <div className="docent-actions">
            {isProcessing ? (
              <button type="button" className="stage-btn stage-btn--danger" onClick={stopTurn}>
                <Icon name="stop" size={14} />
                Stop
              </button>
            ) : (
              <button type="submit" className="stage-btn stage-btn--primary" disabled={!canSend}>
                <Icon name="send" size={16} />
                Send
              </button>
            )}
            <button
              type="button"
              className={`stage-btn stage-btn--icon stage-btn--quiet${transcriptOpen ? ' stage-btn--on' : ''}`}
              onClick={() => setTranscriptOpen((o) => !o)}
              aria-pressed={transcriptOpen}
              aria-label={transcriptOpen ? 'Hide transcript' : 'Show transcript'}
              title={transcriptOpen ? 'Hide transcript' : 'Show transcript'}
            >
              <Icon name="transcript" size={16} />
            </button>
            <button
              type="button"
              className="stage-btn stage-btn--icon stage-btn--quiet"
              onClick={onSessionReset}
              aria-label="New session"
              title="New session: clears the map and starts a fresh conversation"
            >
              <Icon name="reset" size={16} />
            </button>
          </div>
        </form>

        <div className="docent-prepared">
          <span className="docent-prepared__label">Prepared</span>
          {copy.prompts.map((p) => (
            <button
              key={p.label}
              type="button"
              className="docent-plate"
              disabled={isProcessing}
              onClick={() => {
                if (p.fill) {
                  // The presenter finishes the sentence (a region) and presses Enter.
                  setUserInput(p.prompt);
                  const el = inputRef.current;
                  if (el) {
                    el.focus();
                    requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
                  }
                } else {
                  void sendMessage(p.prompt);
                }
              }}
              title={p.fill ? `${p.prompt}…` : p.prompt}
            >
              {p.label}
            </button>
          ))}
          <span className="docent-session" title={sessionId}>
            session {sessionId.substring(0, 8)}
          </span>
        </div>
      </div>

      {/* Right: the transcript drawer */}
      {transcriptOpen && (
        <aside className="stage-transcript" aria-label="Transcript">
          <div className="stage-transcript__head">
            <span className="stage-transcript__title">Transcript</span>
            <button
              type="button"
              className="stage-btn stage-btn--icon stage-btn--quiet"
              onClick={() => setTranscriptOpen(false)}
              aria-label="Hide transcript"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
          <div className="stage-transcript__body">
            {messages.length === 0 && !isStreaming && (
              <p className="transcript-empty">
                Nothing yet. Every prompt and every answer, with the agent's steps, collects here.
              </p>
            )}
            {messages.map((msg, index) => (
              <div key={index} className={`transcript-turn transcript-turn--${msg.role}`}>
                <span className="transcript-turn__who">{msg.role === 'user' ? 'You' : 'Agent'}</span>
                <div className="transcript-turn__body">
                  <div className="markdown-content">
                    {/* A dash-only table cell is empty, not "," (A1 P1-5). */}
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{stagePunctuation(blankDashCells(msg.content))}</ReactMarkdown>
                  </div>
                  {msg.tools && msg.tools.length > 0 && (
                    <div className="transcript-turn__tools">
                      <ToolCallDisplay tools={msg.tools} />
                    </div>
                  )}
                </div>
              </div>
            ))}
            {isStreaming && (
              <div className="transcript-turn transcript-turn--assistant">
                <span className="transcript-turn__who">Agent</span>
                <div className="transcript-turn__body">
                  <div className="markdown-content">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {streamingText ? parseToolCalls(streamingText).cleanText : 'Working…'}
                    </ReactMarkdown>
                  </div>
                  {streamingTools.length > 0 && (
                    <div className="transcript-turn__tools">
                      <ToolCallDisplay tools={streamingTools} />
                    </div>
                  )}
                </div>
              </div>
            )}
            <div ref={transcriptEndRef} />
          </div>
        </aside>
      )}
    </>
  );
}
