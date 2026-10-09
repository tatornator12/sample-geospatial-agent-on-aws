import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { LayerStack, type StackRow } from './LayerStack.tsx';

const ROWS: StackRow[] = [
  { id: 'ndvi', label: 'NDVI Lake Mead' },
  { id: 'tci-new', label: 'True colour, Jan 2025' },
  { id: 'tci-old', label: 'True colour, Jan 2022' },
];
const ROW_PX = 36;

// jsdom does no layout: every row is 36px tall, stacked from the list's top.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      return this.tagName === 'LI' ? ROW_PX : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get() {
      if (this.tagName !== 'LI') return 0;
      return Array.from(this.parentElement?.children ?? []).indexOf(this) * ROW_PX;
    },
  });
  // The list's box on screen: 300px wide at the origin, as tall as its rows.
  const box = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.tagName !== 'OL') return box.call(this);
    const height = this.children.length * ROW_PX;
    return { x: 0, y: 0, left: 0, top: 0, right: 300, bottom: height, width: 300, height, toJSON: () => ({}) } as DOMRect;
  };
});
afterEach(cleanup);

function Harness({ onCommit, onPreview }: { onCommit?: (o: string[]) => void; onPreview?: (o: string[]) => void }) {
  const [rows, setRows] = useState(ROWS);
  return (
    <>
      <h3 id="t">Imagery · top first</h3>
      <LayerStack
        rows={rows}
        labelledBy="t"
        onPreview={(o) => onPreview?.(o)}
        onCommit={(o) => {
          onCommit?.(o);
          setRows(o.map((id) => rows.find((r) => r.id === id)!));
        }}
        renderControls={(row) => <span>{row.label}</span>}
      />
      <button type="button">Elsewhere</button>
    </>
  );
}

const grip = (label: string) => screen.getByRole('button', { name: new RegExp(`^Reorder ${label}`) });
const order = () => screen.getAllByRole('listitem').map((li) => li.textContent);
const status = () => screen.getByRole('status').textContent;

describe('LayerStack', () => {
  it('lists the rows in draw order with a labelled grip each', () => {
    render(<Harness />);
    expect(screen.getByRole('list', { name: 'Imagery · top first' })).toBeTruthy();
    expect(order()).toEqual(['NDVI Lake Mead', 'True colour, Jan 2025', 'True colour, Jan 2022']);
    expect(grip('NDVI Lake Mead').getAttribute('aria-label')).toBe('Reorder NDVI Lake Mead, 1 of 3 in the imagery stack');
  });

  it('shows no grip when there is nothing to reorder', () => {
    render(
      <LayerStack rows={[ROWS[0]]} labelledBy="t" onPreview={() => {}} onCommit={() => {}} renderControls={(r) => r.label} />,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('moves a row with the arrow keys, Home and End, and keeps focus on its grip', () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    const g = grip('True colour, Jan 2022');
    g.focus();
    fireEvent.keyDown(g, { key: 'ArrowUp' });
    expect(onCommit).toHaveBeenLastCalledWith(['ndvi', 'tci-old', 'tci-new']);
    expect(order()[1]).toBe('True colour, Jan 2022');
    expect(document.activeElement).toBe(grip('True colour, Jan 2022'));
    expect(status()).toBe('True colour, Jan 2022 moved to 2 of 3.');

    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(onCommit).toHaveBeenLastCalledWith(['tci-old', 'ndvi', 'tci-new']);
    expect(status()).toBe('True colour, Jan 2022 moved to the top, drawn over the other imagery.');

    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(onCommit).toHaveBeenLastCalledWith(['ndvi', 'tci-new', 'tci-old']);
    expect(document.activeElement).toBe(grip('True colour, Jan 2022'));
  });

  it('says so at the ends instead of moving', () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    fireEvent.keyDown(grip('NDVI Lake Mead'), { key: 'ArrowUp' });
    expect(onCommit).not.toHaveBeenCalled();
    expect(status()).toBe('NDVI Lake Mead is already on top.');
  });

  it('lifts with a click and places with a click on another grip', () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    fireEvent.click(grip('True colour, Jan 2022'));
    expect(grip('True colour, Jan 2022').getAttribute('aria-pressed')).toBe('true');
    const target = screen.getByRole('button', { name: 'Put True colour, Jan 2022 here, 1 of 3' });
    fireEvent.click(target);
    expect(onCommit).toHaveBeenLastCalledWith(['tci-old', 'ndvi', 'tci-new']);
    expect(order()[0]).toBe('True colour, Jan 2022');
    expect(grip('True colour, Jan 2022').getAttribute('aria-pressed')).toBe('false');
  });

  it('puts a lifted row down with Escape or a press outside', () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    fireEvent.click(grip('NDVI Lake Mead'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(grip('NDVI Lake Mead').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(grip('NDVI Lake Mead'));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(grip('NDVI Lake Mead').getAttribute('aria-pressed')).toBe('false');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('drags a row past half a neighbour, previews live and commits on drop', () => {
    const onCommit = vi.fn();
    const onPreview = vi.fn();
    render(<Harness onCommit={onCommit} onPreview={onPreview} />);
    const g = grip('NDVI Lake Mead');
    fireEvent.pointerDown(g, { button: 0, pointerId: 1, clientX: 10, clientY: 18 });
    // Under the 4px threshold: still a press.
    fireEvent.pointerMove(g, { pointerId: 1, clientX: 10, clientY: 21 });
    expect(onPreview).not.toHaveBeenCalled();
    // 40px down: the bottom edge passes the second row's midpoint.
    fireEvent.pointerMove(g, { pointerId: 1, clientX: 10, clientY: 58 });
    expect(onPreview).toHaveBeenLastCalledWith(['tci-new', 'ndvi', 'tci-old']);
    expect(document.querySelector('.map-stack__slot')).not.toBeNull();
    fireEvent.pointerUp(g, { pointerId: 1, clientX: 10, clientY: 58 });
    fireEvent.click(g); // the click that follows a drag must not lift the row
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenLastCalledWith(['tci-new', 'ndvi', 'tci-old']);
    expect(order()).toEqual(['True colour, Jan 2025', 'NDVI Lake Mead', 'True colour, Jan 2022']);
    expect(grip('NDVI Lake Mead').getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('.map-stack__slot')).toBeNull();
  });

  it('puts everything back on Escape mid-drag', () => {
    const onCommit = vi.fn();
    const onPreview = vi.fn();
    render(<Harness onCommit={onCommit} onPreview={onPreview} />);
    const g = grip('NDVI Lake Mead');
    fireEvent.pointerDown(g, { button: 0, pointerId: 1, clientX: 10, clientY: 18 });
    fireEvent.pointerMove(g, { pointerId: 1, clientX: 10, clientY: 90 });
    expect(onPreview).toHaveBeenLastCalledWith(['tci-new', 'tci-old', 'ndvi']);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onPreview).toHaveBeenLastCalledWith(['ndvi', 'tci-new', 'tci-old']);
    expect(onCommit).not.toHaveBeenCalled();
    expect(status()).toBe('NDVI Lake Mead stays at 1 of 3.');
  });

  it('drops at the top when the pointer overshoots the list inside the plate', () => {
    const onCommit = vi.fn();
    render(
      <div style={{ overflowY: 'auto' }} data-testid="scroller">
        <Harness onCommit={onCommit} />
      </div>,
    );
    // The plate's scroll area reaches 200px above the imagery list (the "On top" section).
    const scroller = screen.getByTestId('scroller');
    scroller.getBoundingClientRect = () =>
      ({ x: 0, y: -200, left: 0, top: -200, right: 300, bottom: 200, width: 300, height: 400, toJSON: () => ({}) }) as DOMRect;
    const g = grip('True colour, Jan 2022');
    fireEvent.pointerDown(g, { button: 0, pointerId: 1, clientX: 10, clientY: 90 });
    fireEvent.pointerMove(g, { pointerId: 1, clientX: 10, clientY: -120 });
    fireEvent.pointerUp(g, { pointerId: 1, clientX: 10, clientY: -120 });
    expect(onCommit).toHaveBeenLastCalledWith(['tci-old', 'ndvi', 'tci-new']);
  });

  it('puts everything back on a drop outside the plate (onto the map)', () => {
    const onCommit = vi.fn();
    const onPreview = vi.fn();
    render(<Harness onCommit={onCommit} onPreview={onPreview} />);
    const g = grip('NDVI Lake Mead');
    fireEvent.pointerDown(g, { button: 0, pointerId: 1, clientX: 10, clientY: 18 });
    fireEvent.pointerMove(g, { pointerId: 1, clientX: 10, clientY: 58 });
    fireEvent.pointerUp(g, { pointerId: 1, clientX: -200, clientY: 58 });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onPreview).toHaveBeenLastCalledWith(['ndvi', 'tci-new', 'tci-old']);
    expect(order()[0]).toBe('NDVI Lake Mead');
  });
});
