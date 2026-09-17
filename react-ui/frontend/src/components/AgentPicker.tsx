/**
 * The act picker on the exhibit rail: which agent is on stage.
 *
 * A quiet trigger showing the current agent's name opens a floating plate listing every
 * agent with its one-line description. Selection is a listbox (arrow keys, Home/End,
 * Enter/Space, Escape) so the presenter can switch acts without the mouse. The picker
 * renders nothing when only one agent is configured — a single-runtime deployment keeps
 * its plain rail.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { useAgents } from '../agentContext';
import { theme } from '../theme';
import { Icon } from './Icons';

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
        <span>{selectedAgent.label}</span>
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
            return (
              <li
                key={agent.id}
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
                  {agent.label}
                </span>
                {agent.description && (
                  <span
                    style={{
                      display: 'block',
                      fontSize: '15px',
                      lineHeight: 1.4,
                      color: theme.colors.secondary,
                    }}
                  >
                    {agent.description}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
