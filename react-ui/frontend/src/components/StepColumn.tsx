/**
 * The step column: where the agent is right now, readable from the back of the room.
 * A numbered list of tool calls for the current turn with exactly one lit marker.
 * Sits at the left edge of the stage while the agent works and for the turn just finished.
 */
import type { ToolCall } from '../types.ts';
import { theme } from '../theme';

interface StepColumnProps {
  steps: ToolCall[];
  /** True while the agent is still streaming; the last step is the lit one. */
  live: boolean;
}

const MAX_VISIBLE = 9;

function shortToolName(name: string): string {
  return name.replace(/_/g, ' ');
}

export function StepColumn({ steps, live }: StepColumnProps) {
  if (steps.length === 0) return null;

  const visible = steps.slice(-MAX_VISIBLE);
  const offset = steps.length - visible.length;
  const litIndex = live ? visible.length - 1 : -1;

  return (
    <ol
      className="stage-step-column"
      aria-label={live ? 'Agent steps, in progress' : 'Agent steps, completed'}
      aria-live="polite"
      style={{ margin: 0, padding: 0, listStyle: 'none' }}
    >
      {offset > 0 && (
        <li
          style={{
            ...theme.typography.mono,
            fontSize: '12px',
            color: theme.colors.secondary,
            padding: '2px 0 6px 36px',
          }}
        >
          +{offset} earlier
        </li>
      )}
      {visible.map((step, i) => {
        const lit = i === litIndex;
        const done = !lit;
        const n = offset + i + 1;
        return (
          <li
            key={step.id || `${step.name}-${n}`}
            aria-current={lit ? 'step' : undefined}
            style={{
              display: 'grid',
              gridTemplateColumns: '28px 1fr',
              alignItems: 'center',
              columnGap: theme.spacing.sm,
              padding: '6px 0',
              color: lit ? theme.colors.onSurface : theme.colors.secondary,
              transition: `color ${theme.transitions.short}`,
            }}
          >
            <span
              style={{
                ...theme.typography.mono,
                fontSize: '13px',
                color: lit ? theme.colors.primary : done ? theme.colors.success : theme.colors.secondary,
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
                  display: 'inline-block',
                  backgroundColor: lit ? theme.colors.primary : done ? theme.colors.success : theme.colors.outlineVariant,
                  boxShadow: lit ? `0 0 0 5px ${theme.colors.primaryContainer}` : 'none',
                  transition: `box-shadow ${theme.transitions.medium}, background-color ${theme.transitions.short}`,
                }}
              />
              {String(n).padStart(2, '0')}
            </span>
            <span
              style={{
                ...theme.typography.bodyMedium,
                fontSize: lit ? '17px' : '15px',
                fontWeight: lit ? 600 : 400,
                lineHeight: 1.25,
                letterSpacing: '0.005em',
              }}
            >
              {shortToolName(step.name)}
              {lit && (
                <span
                  style={{
                    ...theme.typography.labelCaps,
                    fontSize: '11px',
                    color: theme.colors.primary,
                    marginLeft: theme.spacing.sm,
                  }}
                >
                  working
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
