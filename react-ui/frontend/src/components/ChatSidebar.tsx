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
import { EvidencePlate } from './EvidencePlate.tsx';
import { Icon } from './Icons.tsx';
import { extractEvidence, type EvidenceItem } from '../utils/evidence.ts';
import { groupSteps, methaneDirFrom, parseTip, tipManifestUrl, type Tip } from '../utils/steps.ts';
import { useStageFiles } from '../hooks/useStageFiles.ts';
import { currentBriefId } from '../utils/brief.ts';
import { BriefCard } from './BriefCard.tsx';
import { stagePunctuation } from '../utils/caption.ts';
import { twoColumnTables } from '../utils/tables.ts';
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
}: ChatSidebarProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [userInput, setUserInput] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [streamingTools, setStreamingTools] = useState<ToolCall[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  useEffect(() => {
    onWorkingChange?.(isStreaming);
  }, [isStreaming, onWorkingChange]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [openEvidence, setOpenEvidence] = useState<{ item: EvidenceItem; imageUrl: string } | null>(null);
  const closeEvidence = useCallback(() => setOpenEvidence(null), []);
  const scenarioDisplayedRef = useRef(false);
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

  useEffect(() => {
    // A new session while an agent is still streaming (act switched, New session pressed):
    // stop that runtime; the old loop sees liveSessionRef move on and drops its events.
    const owner = streamOwnerRef.current;
    if (owner.processing && owner.sessionId !== sessionId) {
      owner.processing = false;
      void stopRuntimeSession(owner.sessionId, owner.agentId);
    }
    liveSessionRef.current = sessionId;
    setOpenEvidence(null);
    setMessages([]);
    setUserInput('');
    setStreamingText('');
    setStreamingTools([]);
    setIsStreaming(false);
    setIsProcessing(false);
    setIsCancelling(false);
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
      setMessages([
        { role: 'user', content: userQuestion },
        { role: 'assistant', content: analysisText, tools: simulatedTools },
      ]);

      scenarioDisplayedRef.current = true;
    }
  }, [scenarioConfig, scenarioError, isLoadingScenario, messages.length]);

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

  const handleCancelSession = async () => {
    if (!isProcessing) return;

    setIsCancelling(true);
    console.log('Cancelling session:', sessionId);

    const success = await stopRuntimeSession(sessionId, agentId);

    if (success) {
      setIsStreaming(false);
      setIsProcessing(false);
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Stopped by the presenter.' }]);
    } else {
      console.error('Failed to cancel session');
    }

    setIsCancelling(false);
  };

  const sendMessage = async (override?: string) => {
    const prompt = (override ?? userInput).trim();
    if (!prompt || isProcessing) {
      return;
    }

    setUserInput('');
    setIsProcessing(true);
    streamOwnerRef.current = { sessionId, agentId, processing: true };

    setMessages((prev) => [...prev, { role: 'user', content: prompt }]);

    setIsStreaming(true);
    setStreamingText('');
    setStreamingTools([]);

    const locationChanged = extractLocationChanged('', []);

    if (locationChanged) {
      clearMapLayers();
    }

    // Track which geometry URLs have already been loaded so we can load ALL
    // geometries from a turn (AOI boundary, protected-area overlay, etc.) — not
    // just the first — while de-duping across streaming updates. Each loaded
    // geometry is pushed separately and stacks as its own layer on the map.
    const loadedGeometryUrls = new Set<string>();
    const loadNewGeometries = async (list: Array<{ url: string; title: string; render?: RenderHint }>) => {
      for (const g of list) {
        if (loadedGeometryUrls.has(g.url)) continue;
        loadedGeometryUrls.add(g.url); // mark first so rapid stream updates don't double-load
        try {
          const geometry = await Promise.race([
            loadGeometry(g.url),
            new Promise<null>((_, reject) =>
              setTimeout(() => reject(new Error('Geometry loading timeout')), 15000)
            ),
          ]);
          if (geometry) {
            geometry.locationName = g.title;
            geometry.sourceUrl = g.url;
            if (g.render) geometry.render = g.render;
            onGeometryUpdate(geometry);
          } else {
            loadedGeometryUrls.delete(g.url);
            console.error('Failed to load geometry (null) for:', g.url);
          }
        } catch (error) {
          loadedGeometryUrls.delete(g.url);
          console.error(`Exception loading geometry from ${g.url}:`, error);
        }
      }
    };
    let lastRasterCount = 0;
    let fullResponse = '';
    let accumulatedTools: ToolCall[] = [];
    let streamCompletedNormally = false;

    try {
      for await (const event of streamAgentInvoke(prompt, sessionId, scenarioId, agentId)) {
        // Superseded by a newer session (act switched mid-run): drop the rest of this stream.
        if (liveSessionRef.current !== sessionId) {
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

            // Update accumulated tools (merge with existing to avoid duplicates)
            const existingIds = new Set(accumulatedTools.map((t) => t.id));
            const newTools = tools.filter((t) => !existingIds.has(t.id));
            accumulatedTools = [...accumulatedTools, ...newTools];
            setStreamingTools(accumulatedTools);

            const { rasters: allRasterData, geometries: allGeometryData } =
              extractAllVisualizationData(accumulatedTools);

            // Load any geometries not yet loaded (AOI boundary, protected-area
            // overlays, ...). Multiple geometries stack as separate map layers.
            if (allGeometryData.length > 0) {
              await loadNewGeometries(allGeometryData);
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
                  onRastersUpdate(rasters);
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

          setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${event.message}` }]);
          return; // Exit early on error
        }
      }

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
            onRastersUpdate(rasters);
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

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: cleanText,
          answer: finalAnswer(fullResponse),
          tools: completedTools.length > 0 ? completedTools : undefined,
        },
      ]);
    } catch (error) {
      console.error('Exception while calling agent:', error);

      // Show user-friendly error message, unless a newer session owns the stage now.
      if (liveSessionRef.current === sessionId) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${errorMessage}` }]);
      }
    } finally {
      // Only the stream that still owns the stage may clear the working state; a superseded
      // stream finishing late must not stomp on a session that is already running again.
      if (liveSessionRef.current === sessionId) {
        setIsStreaming(false);
        setIsProcessing(false);
      }
      if (streamOwnerRef.current.sessionId === sessionId) {
        streamOwnerRef.current.processing = false;
      }

      if (!streamCompletedNormally) {
        console.warn('Stream did not complete normally. Check logs above for errors.');
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
    if (e.key === 'Escape' && isProcessing) {
      e.preventDefault();
      void handleCancelSession();
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
  const answerText = !isStreaming && lastAssistant
    ? twoColumnTables(stagePunctuation((lastAssistant.answer ?? lastAssistant.content).trim()))
    : '';
  const answerFailed = /^Error:/.test(answerText);

  // Where the agent is: this turn's tools while working, the last turn's when finished.
  const stepTools = isStreaming ? streamingTools : lastAssistant?.tools || [];
  // What the agent looked at: the inspect_image steps of the same turn.
  const evidence = extractEvidence(stepTools, sessionId);
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
  // This act's prompts, placeholder and idle line; the room hears the act's name, not "(dev)".
  const copy = stageCopyFor(agentId);
  const speaker = stageAgentLabel(agentLabel) ?? 'Agent';

  const canSend = !isProcessing && userInput.trim().length > 0;

  // The step column: shown while the agent works and for the turn just finished. A turn that
  // drafted the brief ends on the brief card (it is the answer); any other turn ends on the answer.
  const draftedBrief = stepTools.some((t) => t.name === 'draft_brief');
  const showBrief = !!briefId && !isStreaming;
  const showAnswer = !isStreaming && !!answerText && !(showBrief && draftedBrief);
  const showColumn = isStreaming || stepTools.length > 0 || showAnswer;
  const columnTitle = isStreaming ? 'The agent is working' : stepTools.length > 0 ? 'What the agent did' : 'What the agent said';
  const [stepsOpen, setStepsOpen] = useState(true);
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

  // The answer lands in view when the turn ends (the brief card scrolls itself into view).
  const answerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (showAnswer && stepsOpen) answerRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [showAnswer, stepsOpen, answerText]);

  return (
    <>
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
              {lastUser && <p className="stage-steps__ask" title={lastUser.content}>{lastUser.content}</p>}
              {stepTools.length > 0 && (
                <StepColumn
                  steps={stepTools}
                  live={isStreaming}
                  evidence={evidence}
                  onOpenEvidence={(item, imageUrl) => setOpenEvidence({ item, imageUrl })}
                  methaneDir={methaneDir}
                  tips={tips}
                  compact={showBrief && draftedBrief}
                  key={`steps-${briefId ?? 'live'}`}
                />
              )}
              {isStreaming && stepTools.length === 0 && <p className="stage-steps__reading">Reading the request</p>}
              {showBrief && (
                <BriefCard
                  key={briefId}
                  briefId={briefId}
                  sessionId={sessionId}
                  caseId={scenarioId}
                  busy={isProcessing}
                  onDecision={(prompt) => void sendMessage(prompt)}
                />
              )}
              {showAnswer && (
                <div ref={answerRef} className={`stage-answer${answerFailed ? ' stage-answer--failed' : ''}`} aria-live="polite">
                  <span className="stage-answer__who">{speaker}</span>
                  {answerFailed ? (
                    <p className="stage-answer__text">
                      The agent stopped before it answered. Send the prompt again, or open the transcript for the error.
                    </p>
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
              <button
                type="button"
                className="stage-btn stage-btn--danger"
                onClick={handleCancelSession}
                disabled={isCancelling}
              >
                <Icon name="stop" size={14} />
                {isCancelling ? 'Stopping' : 'Stop'}
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
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{stagePunctuation(msg.content)}</ReactMarkdown>
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
