/**
 * The act picker on the exhibit rail: which agent is on stage.
 *
 * A quiet trigger showing the current act's name opens a floating plate listing the acts in
 * show order, each with its room name and the intro deck's line (utils/acts.ts), never a
 * runtime suffix, a deploy note or an act number. In rehearsal (the dev server or `?dev=1`)
 * the other runtimes follow under "Rehearsal", each named for its act with its `?agent=` id in
 * mono. Selection is a listbox (arrow keys, Home/End, Enter/Space, Escape) so the presenter can
 * switch acts without the mouse; the "Rehearsal" heading is not an option. The picker renders
 * nothing when only one agent is offered: a single-runtime deployment keeps its plain rail.
 */
import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { useAgents } from '../agentContext';
import { theme } from '../theme';
import { Icon } from './Icons';

/** A rehearsal runtime's `?agent=` id beside its act's name, so two runtimes of one act differ. */
function RuntimeId({ id }: { id: string }) {
  return (
    <span
      className="mono"
      style={{ marginLeft: '6px', fontSize: '15px', fontWeight: 400, color: theme.colors.secondary }}
    >
      · {id}
    </span>
  );
}

export function AgentPicker() {
  const { agents, selectedAgentId, selectedAgent, selectAgent, status } = useAgents();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listboxId = useId();

  // Close when the pointer lands anywhere outside the picker.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  // Opening puts keyboard focus on the list, with the current agent as the active option.
  useEffect(() => {
    if (open) {
      const index = agents.findIndex((a) => a.id === selectedAgentId);
      setActiveIndex(index >= 0 ? index : 0);
      listRef.current?.focus();
    }
  }, [open, agents, selectedAgentId]);

  if (status !== 'ready' || agents.length < 2 || !selectedAgent) {
    return null;
  }

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  const choose = (id: string) => {
    selectAgent(id);
    close(true);
  };

  const onListKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, agents.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(agents.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        choose(agents[activeIndex].id);
        break;
      case 'Escape':
        event.preventDefault();
        close(true);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  };

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing.sm,
          padding: `6px ${theme.spacing.md}`,
          color: theme.colors.onBackground,
          border: `1px solid ${theme.colors.outline}`,
          borderRadius: theme.borderRadius.md,
          ...theme.typography.labelLarge,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = theme.colors.outlineVariant;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = theme.colors.outline;
        }}
      >
        <span style={{ ...theme.typography.labelCaps, fontSize: '11px', color: theme.colors.secondary }}>
          Agent
        </span>
        <span>{selectedAgent.roomName}</span>
        {selectedAgent.rehearsalOnly && <RuntimeId id={selectedAgent.id} />}
        <Icon
          name="chevron-down"
          size={14}
          style={{
            color: theme.colors.secondary,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: `transform ${theme.transitions.short}`,
          }}
        />
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label="Agent"
          aria-activedescendant={`${listboxId}-${agents[activeIndex].id}`}
          tabIndex={0}
          onKeyDown={onListKeyDown}
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: '340px',
            margin: 0,
            padding: '6px',
            listStyle: 'none',
            background: 'color-mix(in srgb, #161c25 96%, transparent)',
            border: `1px solid ${theme.colors.outline}`,
            borderRadius: '10px',
            boxShadow: theme.elevation.level3,
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            zIndex: 110,
          }}
        >
          {agents.map((agent, index) => {
            const isSelected = agent.id === selectedAgentId;
            const isActive = index === activeIndex;
            // The first rehearsal runtime opens its own group, under a heading that is not an option.
            const opensRehearsal = agent.rehearsalOnly && !agents[index - 1]?.rehearsalOnly;
            return (
              <Fragment key={agent.id}>
                {opensRehearsal && (
                  <li
                    role="presentation"
                    style={{
                      ...theme.typography.labelCaps,
                      fontSize: '11px',
                      color: theme.colors.secondary,
                      padding: '12px 12px 6px',
                      marginTop: '6px',
                      borderTop: `1px solid ${theme.colors.outline}`,
                    }}
                  >
                    Rehearsal
                  </li>
                )}
                <li
                  id={`${listboxId}-${agent.id}`}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(agent.id)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    backgroundColor: isSelected
                      ? theme.colors.primaryContainer
                      : isActive
                        ? theme.states.hover
                        : 'transparent',
                    transition: `background-color ${theme.transitions.short}`,
                  }}
                >
                  <span
                    style={{
                      display: 'block',
                      fontSize: '15px',
                      fontWeight: 600,
                      lineHeight: 1.4,
                      color: isSelected ? theme.colors.primary : theme.colors.onSurface,
                    }}
                  >
                    {agent.roomName}
                    {agent.rehearsalOnly && <RuntimeId id={agent.id} />}
                  </span>
                  {agent.roomDescription && (
                    <span
                      style={{
                        display: 'block',
                        fontSize: '15px',
                        lineHeight: 1.4,
                        color: theme.colors.secondary,
                      }}
                    >
                      {agent.roomDescription}
                    </span>
                  )}
                </li>
              </Fragment>
            );
          })}
        </ul>
      )}
    </div>
  );
}
