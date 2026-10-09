/**
 * The imagery stack: a list in draw order (the top row is drawn on top) that the presenter
 * restacks by dragging a row's grip. The map follows live while a row is held; Escape, or a
 * drop outside the plate, puts everything back.
 *
 * Every drag has a non-drag path (WCAG 2.1.1, 2.5.7): on the grip, the arrow keys move a row one
 * place and Home / End to the top and the bottom; a click lifts a row and a click on another
 * row's grip puts it there. Each move is announced, and focus stays on the moved row's grip.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { Icon } from './Icons.tsx';
import { clampDrag, moveItem, moveSentence, slotIndex, slotLayout } from '../utils/layerStack.ts';

export interface StackRow {
  id: string;
  label: string;
}

interface LayerStackProps {
  /** Top first: the first row is drawn on top of the imagery. */
  rows: StackRow[];
  /** The id of the heading that names the list. */
  labelledBy: string;
  /** Put this order on the map now, without committing it (a held row, or a cancelled drag). */
  onPreview: (order: string[]) => void;
  /** The new order: a drop, a key press or a click-to-place. */
  onCommit: (order: string[]) => void;
  /** The row's own controls after the grip: visibility, name, remove. */
  renderControls: (row: StackRow) => ReactNode;
  rowClassName?: (row: StackRow) => string;
}

/** Pointer travel before a press on the grip becomes a drag (below it, the press is a click). */
export const DRAG_THRESHOLD_PX = 4;
/** Auto-scroll band at the scroller's top and bottom edges, and its top speed per frame. */
const EDGE_PX = 32;
const MAX_SCROLL_PX = 12;
/** A drop this far outside the list puts everything back. */
const OUTSIDE_PX = 48;
/** The amber wash on a row that just landed (stage.css: map-row-settle). */
const SETTLE_MS = 300;

/** The row under the pointer, from press to release. Not state: it changes on every move. */
interface Held {
  id: string;
  from: number;
  pointerId: number;
  startY: number;
  lastY: number;
  started: boolean;
  scroller: HTMLElement | null;
  startScroll: number;
  tops: number[];
  heights: number[];
  to: number;
  origin: string[];
}

/** What the list draws while a row is held. */
interface DragView {
  id: string;
  from: number;
  dy: number;
  to: number;
  tops: number[];
  heights: number[];
}

function scrollParentOf(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const overflow = getComputedStyle(p).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return p;
  }
  return null;
}

export function LayerStack({ rows, labelledBy, onPreview, onCommit, renderControls, rowClassName }: LayerStackProps) {
  const hintId = useId();
  const listRef = useRef<HTMLOListElement>(null);
  const itemRefs = useRef(new Map<string, HTMLLIElement>());
  const gripRefs = useRef(new Map<string, HTMLButtonElement>());
  const held = useRef<Held | null>(null);
  const frame = useRef(0);
  const suppressClick = useRef(false);
  const focusAfter = useRef<string | null>(null);
  const settleTimer = useRef<number | undefined>(undefined);
  // The latest props for the pointer handlers and the auto-scroll loop, which outlive a render.
  const latest = useRef({ rows, onPreview, onCommit });
  useLayoutEffect(() => {
    latest.current = { rows, onPreview, onCommit };
  });

  const [drag, setDrag] = useState<DragView | null>(null);
  const [lifted, setLifted] = useState<string | null>(null);
  const [settled, setSettled] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const ids = rows.map((r) => r.id);
  const count = rows.length;
  const signature = ids.join('|');
  const liftedId = lifted && ids.includes(lifted) ? lifted : null;
  const dragging = drag !== null;

  // The drag engine: stable functions over refs, so a held row survives re-renders.
  const engine = useMemo(() => {
    const labelOf = (id: string) => latest.current.rows.find((r) => r.id === id)?.label ?? 'Layer';

    const settle = (id: string) => {
      window.clearTimeout(settleTimer.current);
      setSettled(null);
      requestAnimationFrame(() => setSettled(id));
      settleTimer.current = window.setTimeout(() => setSettled(null), SETTLE_MS + 40);
    };

    // Where the held row is: it follows the pointer (and the scroller), clamped to the list; the
    // map previews the order each time the slot changes.
    const update = () => {
      const h = held.current;
      if (!h || !h.started) return;
      const scrolled = (h.scroller?.scrollTop ?? 0) - h.startScroll;
      const dy = clampDrag(h.tops, h.heights, h.from, h.lastY - h.startY + scrolled);
      const to = slotIndex(h.tops, h.heights, h.from, dy);
      if (to !== h.to) {
        h.to = to;
        latest.current.onPreview(moveItem(h.origin, h.from, to));
      }
      setDrag({ id: h.id, from: h.from, dy, to, tops: h.tops, heights: h.heights });
    };

    // Near the scroller's edges the list scrolls under the held row.
    const tick = () => {
      const h = held.current;
      if (!h || !h.started) return;
      const s = h.scroller;
      if (s) {
        const r = s.getBoundingClientRect();
        let v = 0;
        if (h.lastY < r.top + EDGE_PX) v = -((r.top + EDGE_PX - h.lastY) / EDGE_PX) * MAX_SCROLL_PX;
        else if (h.lastY > r.bottom - EDGE_PX) v = ((h.lastY - (r.bottom - EDGE_PX)) / EDGE_PX) * MAX_SCROLL_PX;
        v = Math.max(-MAX_SCROLL_PX, Math.min(MAX_SCROLL_PX, Math.round(v)));
        if (v !== 0) {
          const before = s.scrollTop;
          s.scrollTop = before + v;
          if (s.scrollTop !== before) update();
        }
      }
      frame.current = requestAnimationFrame(tick);
    };

    const finish = (mode: 'drop' | 'cancel') => {
      const h = held.current;
      held.current = null;
      cancelAnimationFrame(frame.current);
      setDrag(null);
      if (!h || !h.started) return;
      const label = labelOf(h.id);
      if (mode === 'cancel' || h.to === h.from) {
        latest.current.onPreview(h.origin);
        setMessage(`${label} stays at ${h.from + 1} of ${h.origin.length}.`);
        return;
      }
      latest.current.onCommit(moveItem(h.origin, h.from, h.to));
      settle(h.id);
      setMessage(moveSentence(label, h.to, h.origin.length));
    };

    return { labelOf, settle, update, tick, finish };
  }, []);

  /** A committed move from the keyboard or a click: the map, the wash, the focus, the sentence. */
  const commit = (order: string[], id: string, to: number) => {
    onCommit(order);
    engine.settle(id);
    focusAfter.current = id;
    setMessage(moveSentence(engine.labelOf(id), to, count));
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>, row: StackRow, index: number) => {
    suppressClick.current = false;
    if (e.button !== 0 || count < 2) return;
    const scroller = scrollParentOf(listRef.current);
    held.current = {
      id: row.id,
      from: index,
      pointerId: e.pointerId,
      startY: e.clientY,
      lastY: e.clientY,
      started: false,
      scroller,
      startScroll: scroller?.scrollTop ?? 0,
      tops: [],
      heights: [],
      to: index,
      origin: ids,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const h = held.current;
    if (!h || h.pointerId !== e.pointerId) return;
    h.lastY = e.clientY;
    if (!h.started) {
      if (Math.abs(e.clientY - h.startY) < DRAG_THRESHOLD_PX) return;
      // Measured once, at lift: offsets inside the list ignore the transforms applied after.
      const items = h.origin.map((id) => itemRefs.current.get(id));
      if (items.some((el) => !el)) return;
      h.tops = items.map((el) => el!.offsetTop);
      h.heights = items.map((el) => el!.offsetHeight);
      h.started = true;
      setLifted(null);
      frame.current = requestAnimationFrame(engine.tick);
    }
    engine.update();
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const h = held.current;
    if (!h || h.pointerId !== e.pointerId) return;
    if (!h.started) {
      held.current = null;
      return; // a press without travel: the click handler lifts the row
    }
    suppressClick.current = true;
    // Outside means off the plate: sideways off the list (onto the map), or above or below the
    // plate's scroll area. Overshooting the list inside the plate (up over "On top") still drops
    // at the clamped slot: that is how a row is put on top.
    const box = listRef.current?.getBoundingClientRect();
    const area = h.scroller?.getBoundingClientRect() ?? box;
    const outside =
      !box ||
      !area ||
      e.clientX < box.left - OUTSIDE_PX ||
      e.clientX > box.right + OUTSIDE_PX ||
      e.clientY < area.top - OUTSIDE_PX ||
      e.clientY > area.bottom + OUTSIDE_PX;
    focusAfter.current = h.id;
    engine.finish(outside ? 'cancel' : 'drop');
  };

  const onPointerCancel = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (held.current?.pointerId === e.pointerId) engine.finish('cancel');
  };

  // Click-to-lift, click-to-place: the single-pointer path that needs no dragging.
  const onClick = (row: StackRow, index: number) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (count < 2) return;
    if (!liftedId) {
      setLifted(row.id);
      setMessage(
        `${row.label} lifted, ${index + 1} of ${count}. Choose another row's handle to put it there, or use the arrow keys. Escape puts it down.`,
      );
      return;
    }
    if (liftedId === row.id) {
      setLifted(null);
      setMessage(`${row.label} put down at ${index + 1} of ${count}.`);
      return;
    }
    const from = ids.indexOf(liftedId);
    setLifted(null);
    commit(moveItem(ids, from, index), liftedId, index);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>, row: StackRow, index: number) => {
    if (e.key === 'Escape') {
      if (held.current?.started) {
        e.preventDefault();
        engine.finish('cancel');
      } else if (liftedId) {
        e.preventDefault();
        setLifted(null);
        setMessage(`${engine.labelOf(liftedId)} put down at ${ids.indexOf(liftedId) + 1} of ${count}.`);
      }
      return;
    }
    const to =
      e.key === 'ArrowUp' ? index - 1 : e.key === 'ArrowDown' ? index + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? count - 1 : null;
    if (to === null || held.current?.started) return;
    e.preventDefault();
    if (to < 0 || to >= count || to === index) {
      setMessage(index === 0 ? `${row.label} is already on top.` : `${row.label} is already at the bottom.`);
      return;
    }
    commit(moveItem(ids, index, to), row.id, to);
  };

  // Escape anywhere, or a press outside the list, puts a lifted row down; Escape cancels a drag
  // even when the grip did not take focus (Safari does not focus buttons on press).
  useEffect(() => {
    if (!liftedId && !dragging) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (held.current?.started) engine.finish('cancel');
      else if (liftedId) {
        setLifted(null);
        setMessage(`${engine.labelOf(liftedId)} put down.`);
      }
    };
    const onDown = (e: PointerEvent) => {
      if (liftedId && listRef.current && !listRef.current.contains(e.target as Node)) setLifted(null);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [liftedId, dragging, engine]);

  // A layer that lands or leaves mid-drag: the held order is stale, so everything goes back.
  useEffect(() => {
    const h = held.current;
    if (h?.started && h.origin.join('|') !== signature) engine.finish('cancel');
  }, [signature, engine]);

  // Focus stays on the moved row's grip after React reorders the list.
  useLayoutEffect(() => {
    const id = focusAfter.current;
    if (!id) return;
    focusAfter.current = null;
    const grip = gripRefs.current.get(id);
    if (grip && document.activeElement !== grip) grip.focus();
  }, [signature, dragging]);

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      window.clearTimeout(settleTimer.current);
    },
    [],
  );

  const layout = drag ? slotLayout(drag.tops, drag.heights, drag.from, drag.to) : null;
  const listClass = ['map-stack', dragging ? 'map-stack--dragging' : '', liftedId ? 'map-stack--lifting' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className="map-stack-wrap">
      {drag && layout && (
        <div
          className="map-stack__slot"
          aria-hidden="true"
          style={{ height: drag.heights[drag.from], transform: `translateY(${layout.slotTop}px)` }}
        />
      )}
      <ol ref={listRef} className={listClass} aria-labelledby={labelledBy}>
        {rows.map((row, index) => {
          const isHeld = drag?.id === row.id;
          const shift = drag && layout ? (isHeld ? drag.dy : layout.shifts[index]) : 0;
          const isTarget = !!liftedId && liftedId !== row.id;
          const className = [
            'map-row',
            'map-row--stack',
            rowClassName?.(row) ?? '',
            isHeld ? 'map-row--dragging' : '',
            liftedId === row.id ? 'map-row--lifted' : '',
            settled === row.id ? 'map-row--settle' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <li
              key={row.id}
              ref={(el) => {
                if (el) itemRefs.current.set(row.id, el);
                else itemRefs.current.delete(row.id);
              }}
              className={className}
              data-layer-id={row.id}
              style={shift ? { transform: `translateY(${shift}px)` } : undefined}
            >
              {count > 1 && (
                <button
                  type="button"
                  ref={(el) => {
                    if (el) gripRefs.current.set(row.id, el);
                    else gripRefs.current.delete(row.id);
                  }}
                  className={`map-row__grip${isTarget ? ' map-row__grip--target' : ''}`}
                  aria-label={
                    isTarget
                      ? `Put ${rows.find((r) => r.id === liftedId)?.label ?? 'the lifted layer'} here, ${index + 1} of ${count}`
                      : `Reorder ${row.label}, ${index + 1} of ${count} in the imagery stack`
                  }
                  aria-describedby={hintId}
                  aria-pressed={liftedId === row.id}
                  title={isTarget ? 'Put it here' : 'Drag to restack'}
                  onPointerDown={(e) => onPointerDown(e, row, index)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerCancel}
                  onClick={() => onClick(row, index)}
                  onKeyDown={(e) => onKeyDown(e, row, index)}
                >
                  <Icon name="grip" size={16} />
                </button>
              )}
              {renderControls(row)}
            </li>
          );
        })}
      </ol>
      {count > 1 && (
        <p id={hintId} className="map-stack__sr">
          The top row is drawn on top. Drag a handle to restack, or use the arrow keys on it, with Home and End for the
          top and the bottom. A press lifts a row; a press on another row's handle puts it there.
        </p>
      )}
      <p className="map-stack__sr" role="status">
        {message}
      </p>
    </div>
  );
}
