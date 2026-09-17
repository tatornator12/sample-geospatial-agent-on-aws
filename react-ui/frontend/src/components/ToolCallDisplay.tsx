/**
 * Tool calls inside the transcript: a numbered list of steps with one lit marker for the
 * running step. Expands to show inputs and output in the numeric register.
 */
import { useState } from 'react';
import type { ToolCall } from '../types.ts';
import { theme } from '../theme';
import { Icon } from './Icons';

interface ToolCallDisplayProps {
  tools: ToolCall[];
}

interface ToolCallItemProps {
  tool: ToolCall;
  index: number;
}

function ToolCallItem({ tool, index }: ToolCallItemProps) {
  const [expanded, setExpanded] = useState(false);
  const running = tool.status === 'executing';
  const markerColor = running ? theme.colors.primary : theme.colors.success;

  return (
    <div style={{ marginBottom: theme.spacing.xs }}>
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: `6px ${theme.spacing.sm}`,
          background: 'transparent',
          border: 'none',
          borderRadius: theme.borderRadius.sm,
          display: 'grid',
          gridTemplateColumns: '28px 1fr auto 16px',
          alignItems: 'center',
          gap: theme.spacing.sm,
          ...theme.typography.bodyMedium,
          color: theme.colors.onSurface,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = theme.states.hover;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent';
        }}
      >
        <span
          style={{
            ...theme.typography.mono,
            fontSize: '13px',
            color: markerColor,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: markerColor,
              boxShadow: running ? `0 0 0 4px ${theme.colors.primaryContainer}` : 'none',
              display: 'inline-block',
            }}
          />
          {String(index + 1).padStart(2, '0')}
        </span>
        <span style={{ ...theme.typography.mono, fontSize: '14px', color: theme.colors.onSurface }}>
          {tool.name}
        </span>
        <span
          style={{
            ...theme.typography.labelCaps,
            fontSize: '11px',
            color: markerColor,
          }}
        >
          {running ? 'Running' : 'Done'}
        </span>
        <span
          aria-hidden="true"
          style={{
            color: theme.colors.secondary,
            display: 'inline-flex',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: `transform ${theme.transitions.short}`,
          }}
        >
          <Icon name="chevron-down" size={14} />
        </span>
      </button>

      {expanded && (
        <div
          style={{
            marginTop: theme.spacing.xs,
            marginLeft: '36px',
            padding: theme.spacing.md,
            backgroundColor: theme.colors.surfaceVariant,
            borderRadius: theme.borderRadius.sm,
            ...theme.typography.bodyMedium,
          }}
        >
          {tool.params && Object.keys(tool.params).length > 0 && (
            <div style={{ marginBottom: tool.result ? theme.spacing.md : 0 }}>
              <div
                style={{
                  ...theme.typography.labelCaps,
                  color: theme.colors.secondary,
                  marginBottom: theme.spacing.sm,
                }}
              >
                Inputs
              </div>
              <dl
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'max-content 1fr',
                  columnGap: theme.spacing.md,
                  rowGap: '6px',
                  margin: 0,
                }}
              >
                {Object.entries(tool.params).map(([key, value]) => (
                  <div key={key} style={{ display: 'contents' }}>
                    <dt style={{ ...theme.typography.mono, fontSize: '13px', color: theme.colors.secondary }}>{key}</dt>
                    <dd
                      style={{
                        ...theme.typography.mono,
                        fontSize: '13px',
                        color: theme.colors.onSurface,
                        margin: 0,
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {String(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {tool.result && (
            <div>
              <div
                style={{
                  ...theme.typography.labelCaps,
                  color: theme.colors.secondary,
                  marginBottom: theme.spacing.sm,
                }}
              >
                Output
              </div>
              <pre
                style={{
                  padding: theme.spacing.sm,
                  backgroundColor: theme.colors.background,
                  borderRadius: theme.borderRadius.sm,
                  ...theme.typography.mono,
                  fontSize: '12.5px',
                  overflow: 'auto',
                  maxHeight: '300px',
                  whiteSpace: 'pre-wrap',
                  wordWrap: 'break-word',
                  border: `1px solid ${theme.colors.outline}`,
                  margin: 0,
                  color: theme.colors.onSurface,
                }}
              >
                {typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ToolCallDisplay({ tools }: ToolCallDisplayProps) {
  const [expanded, setExpanded] = useState(false);

  if (tools.length === 0) {
    return null;
  }

  const uniqueTools: Record<string, ToolCall> = {};
  for (const tool of tools) {
    const toolId = tool.id || `temp_${tool.name}`;
    uniqueTools[toolId] = tool;
  }

  const uniqueToolList = Object.values(uniqueTools);

  return (
    <div
      style={{
        borderRadius: theme.borderRadius.md,
        border: `1px solid ${theme.colors.outline}`,
        overflow: 'hidden',
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: `${theme.spacing.sm} ${theme.spacing.md}`,
          background: 'transparent',
          border: 'none',
          borderRadius: 0,
          ...theme.typography.labelCaps,
          color: theme.colors.secondary,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = theme.states.hover;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent';
        }}
      >
        <span>
          {uniqueToolList.length} step{uniqueToolList.length !== 1 ? 's' : ''}
        </span>
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: `transform ${theme.transitions.short}`,
          }}
        >
          <Icon name="chevron-down" size={14} />
        </span>
      </button>

      {expanded && (
        <div style={{ padding: `${theme.spacing.sm} ${theme.spacing.sm} ${theme.spacing.sm}` }}>
          {uniqueToolList.map((tool, index) => (
            <ToolCallItem key={tool.id || index} tool={tool} index={index} />
          ))}
        </div>
      )}
    </div>
  );
}
