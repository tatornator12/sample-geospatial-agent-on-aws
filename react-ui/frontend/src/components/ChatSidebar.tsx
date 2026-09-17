/**
 * The Docent. Owns the conversation with the agent (streaming, tool parsing, map updates)
 * and renders it as three overlays on the stage: a caption band with the presenter's input
 * at the bottom, a step column at the left while the agent works, and a transcript drawer
 * at the right when the presenter wants the full record.
 */

import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message, ToolCall, GeometryData, RasterData } from '../types.ts';
import { ToolCallDisplay } from './ToolCallDisplay.tsx';
import { StepColumn } from './StepColumn.tsx';
import { Icon } from './Icons.tsx';
import { streamAgentInvoke, loadGeometry, stopRuntimeSession } from '../services/api.ts';
import {
  cleanStreamingText,
  parseToolCalls,
  extractAllVisualizationData,
  extractLocationChanged,
} from '../utils/parsing.ts';
import { formatScenarioAnalysis, type ScenarioConfig } from '../utils/formatScenario';

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

/**
 * Reduce a markdown response to the one thing the docent would say out loud right now:
 * the last paragraph, headings stripped, capped so it fits three caption lines.
 */
function docentCaption(text: string): string {
  const cleaned = text.replace(/\r/g, '').trim();
  if (!cleaned) return '';
  const paragraphs = cleaned
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  let last = paragraphs[paragraphs.length - 1] || cleaned;
  last = last.replace(/^#{1,6}\s+/gm, '').replace(/^[-*]\s+/gm, '');
  if (last.length > 320) {
    const tail = last.slice(-320);
    const cut = tail.search(/[.!?]\s+[A-Z]/);
    last = cut >= 0 ? tail.slice(cut + 2) : `…${tail}`;
  }
  return last;
}

const PREPARED_PROMPTS = [
  { label: 'Vegetation, Central Park', prompt: 'Show vegetation health for Central Park, New York' },
  {
    label: 'Wildfire, Pacific Palisades',
    prompt: 'Assess wildfire damage near Pacific Palisades, Los Angeles in January 2025',
  },
  { label: 'Water, Folsom Lake', prompt: 'Compare water levels for Folsom Lake, California 2021 vs 2022' },
  { label: 'Scan Colorado', prompt: 'Scan Colorado for land change between 2019 and 2024' },
];

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
}: ChatSidebarProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [userInput, setUserInput] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [streamingTools, setStreamingTools] = useState<ToolCall[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
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
    const loadNewGeometries = async (list: Array<{ url: string; title: string }>) => {
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
  const captionSource = isStreaming ? streamingText : lastAssistant?.content || '';
  const caption = docentCaption(captionSource);
  const idle = !isStreaming && !caption;

  // Where the agent is: this turn's tools while working, the last turn's when finished.
  const stepTools = isStreaming ? streamingTools : lastAssistant?.tools || [];

  const canSend = !isProcessing && userInput.trim().length > 0;

  return (
    <>
      {/* Left: the step column */}
      {stepTools.length > 0 && (
        <section className="stage-steps" aria-label="Agent steps">
          <h2 className="stage-steps__title">{isStreaming ? 'The agent is working' : 'What the agent did'}</h2>
          <StepColumn steps={stepTools} live={isStreaming} />
        </section>
      )}

      {/* Bottom: the docent's caption and the presenter's console */}
      <div className="stage-docent">
        <div
          className={`docent-caption${idle ? ' docent-caption--idle' : ''}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="docent-caption__who">{idle ? 'Ready' : agentLabel ?? 'Agent'}</span>
          <div className="docent-caption__text">
            {caption ? (
              <span className="markdown-content">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{caption}</ReactMarkdown>
              </span>
            ) : isStreaming ? (
              <span>Reading the request</span>
            ) : (
              <span>Name a place and a question. The agent finds the imagery, runs the analysis, and puts the result on the map.</span>
            )}
            {isStreaming && (
              <span className="docent-working" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            )}
          </div>
        </div>

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
            placeholder={isProcessing ? 'Working… press Esc to stop' : 'Ask about any place on Earth'}
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
          {PREPARED_PROMPTS.map((p) => (
            <button
              key={p.label}
              type="button"
              className="docent-plate"
              disabled={isProcessing}
              onClick={() => void sendMessage(p.prompt)}
              title={p.prompt}
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
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
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
