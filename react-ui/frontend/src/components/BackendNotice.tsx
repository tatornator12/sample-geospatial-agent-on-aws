/**
 * The rail's word when the stage backend cannot be reached (S8). It stands where the act picker
 * sits, which has nothing to list without the backend: what is wrong, in the error colour, and
 * when the stage tries again, counting down, with a quiet "Retry now". The agent list is asked
 * for again on its own (agentContext.tsx); the first answer brings the picker back.
 *
 * Only the problem is a live region: the countdown changes every second and is read on focus,
 * not announced.
 */
import { useEffect, useState } from 'react';
import { useAgents } from '../agentContext';
import { theme } from '../theme';

export function BackendNotice() {
  const { status, retryAt, retry } = useAgents();
  const [now, setNow] = useState(() => Date.now());

  // A quarter-second clock while the notice shows, so the count never runs a second behind.
  useEffect(() => {
    if (status !== 'error') return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const clock = setInterval(tick, 250);
    return () => {
      clearTimeout(first);
      clearInterval(clock);
    };
  }, [status, retryAt]);

  if (status !== 'error') return null;

  const seconds = retryAt === null ? 0 : Math.max(0, Math.ceil((retryAt - now) / 1000));

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.md }}>
      <div style={{ ...theme.typography.labelLarge, lineHeight: 1.25, maxWidth: '260px' }}>
        <p role="status" style={{ margin: 0, color: theme.colors.error }}>
          Can't reach the stage backend.
        </p>
        <p style={{ margin: 0, color: theme.colors.secondary }}>
          {seconds > 0 ? (
            <>
              Retrying in <span className="mono">{seconds}</span> s.
            </>
          ) : (
            'Retrying now.'
          )}
        </p>
      </div>
      <button
        type="button"
        onClick={retry}
        style={{
          padding: `6px ${theme.spacing.md}`,
          color: theme.colors.secondary,
          border: `1px solid ${theme.colors.outline}`,
          borderRadius: theme.borderRadius.md,
          whiteSpace: 'nowrap',
          ...theme.typography.labelLarge,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = theme.colors.onBackground;
          e.currentTarget.style.borderColor = theme.colors.outlineVariant;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = theme.colors.secondary;
          e.currentTarget.style.borderColor = theme.colors.outline;
        }}
      >
        Retry now
      </button>
    </div>
  );
}
