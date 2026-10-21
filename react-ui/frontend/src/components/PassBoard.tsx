/**
 * The pass board (Act 3, the one open question): every radar pass on file, newest first, under
 * "Weigh the passes on file", so the room sees the alternatives before the agent chooses. One row
 * per pass: its date, its satellite and the share of the reserve it imaged, in mono at 15 px, then
 * what the question did with it ("reading", "read", "set aside", "no candidates"), from the
 * decision files only (utils/vesselSteps.ts boardStates). Fog for the passes read, label grey for
 * the rest; no amber (nothing here is the presenter's) and no orchid (that is the candidates').
 * Modelled on TipBoard. Rows come from the board file, validated by parseBoard.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { theme } from '../theme';
import {
  BOARD_STATE_WORDS,
  BOARD_WIDE_QUERY,
  boardLimit,
  visibleBoardRows,
  type BoardRow,
  type BoardState,
} from '../utils/vesselSteps.ts';

interface PassBoardProps {
  rows: BoardRow[];
  /** Each pass's state, from the accepted decisions (boardStates); a pass with none is unmarked. */
  states: Record<string, BoardState>;
}

const query = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(BOARD_WIDE_QUERY) : null);

/** 6 rows at 1600 px wide and over, 4 below (the column's height budget at 1280×720). */
function useWide(): boolean {
  const [wide, setWide] = useState(() => query()?.matches ?? false);
  useEffect(() => {
    const mq = query();
    if (!mq) return;
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return wide;
}

const READ: readonly BoardState[] = ['reading', 'read'];

// One line per row at 15 px (23 px tall): the figures in fixed mono widths so they align down the
// board, then the state. Measured in the stage's mono: date, satellite and share take 132 px, so
// "reading" and "set aside" fit beside them in the 222 px the column leaves at 1280; "no
// candidates" (late in the act) takes a second line rather than squeezing the figures.
const rowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  columnGap: '6px',
  fontFamily: 'var(--font-mono)',
  fontVariantNumeric: 'tabular-nums',
  fontSize: '15px',
  lineHeight: '23px',
};
// The share is 3ch ("53%"); a pass that imaged all of the reserve widens its own cell only.
const cell = (width: string, align: 'left' | 'right' = 'left'): CSSProperties => ({ flex: 'none', minWidth: width, textAlign: align, whiteSpace: 'nowrap' });

export function PassBoard({ rows, states }: PassBoardProps) {
  const wide = useWide();
  if (rows.length === 0) return null;
  const { rows: shown, older } = visibleBoardRows(rows, states, boardLimit(wide));
  return (
    <div className="pass-board" style={{ marginTop: theme.spacing.xs, marginBottom: theme.spacing.sm }}>
      <span className="step-detail">share of the reserve each pass imaged</span>
      <div role="table" aria-label="Radar passes on file, newest first, with the share of the reserve each imaged">
        {shown.map((row) => {
          const state = Object.prototype.hasOwnProperty.call(states, row.passId) ? states[row.passId] : undefined;
          const read = state !== undefined && READ.includes(state);
          return (
            <div
              key={row.passId}
              role="row"
              className={`pass-row${state ? ` pass-row--${state}` : ''}`}
              style={{ ...rowStyle, color: read ? 'var(--fog)' : 'var(--label)' }}
            >
              <span role="cell" style={cell('6ch')}>{row.day}</span>
              <span role="cell" style={cell('3ch')}>{row.satellite}</span>
              <span role="cell" style={cell('3ch', 'right')}>{Math.round(row.imaged * 100)}%</span>
              <span role="cell" style={{ flex: 'none', whiteSpace: 'nowrap' }}>
                {state === 'reading' && (
                  <span
                    aria-hidden="true"
                    style={{
                      display: 'inline-block', verticalAlign: 'middle', width: '8px', height: '8px', marginRight: '6px',
                      borderRadius: theme.borderRadius.full, background: 'var(--fog)',
                    }}
                  />
                )}
                {state ? BOARD_STATE_WORDS[state] : ''}
              </span>
            </div>
          );
        })}
      </div>
      {older > 0 && <span className="step-detail">and {older} older</span>}
    </div>
  );
}
