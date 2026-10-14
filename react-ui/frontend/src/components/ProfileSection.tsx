/**
 * The cross-section under the "Measure across the earthwork" step: the ground along the transect
 * as the LiDAR measured it, the baseline dashed, a filled dot at each bank and a ring at each ditch
 * (the map's own marks), the heights on a signed axis in the mono face. The line draws itself on
 * when it lands, the way an instrument trace does.
 *
 * It is also a slider along the line: point at the section (or drag, or use the arrow keys) and an
 * amber rule and dot stand at that distance, the caption reads the height there, and the map puts
 * the same dot on the transect. Point at the line on the map and the section follows.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import {
  cursorWords,
  distanceAtX,
  heightAt,
  sectionDescription,
  sectionLayout,
  type ProfileData,
} from '../utils/profileSection.ts';
import { getSectionCursor, setSectionCursor, useSectionCursor } from '../utils/sectionCursor.ts';

const HEIGHT = 128;
/** Keyboard steps along the line, in metres. */
const STEP_M = 5;
const BIG_STEP_M = 25;

export function ProfileSection({ profile }: { profile: ProfileData }) {
  const host = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const [width, setWidth] = useState(0);
  const [drawn, setDrawn] = useState(false);
  const descId = useId();

  // The section fills the column; it is laid out in pixels so its type stays at the stage's sizes.
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => setWidth(Math.floor(el.getBoundingClientRect().width));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // One frame at length 0, then the trace draws on (CSS transition on the dash offset).
  useEffect(() => {
    const frame = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(frame);
  }, [profile]);

  // A section that leaves the column takes its cursor with it.
  useEffect(() => () => {
    const c = getSectionCursor();
    if (c?.siteId === profile.siteId && c.from === 'section') setSectionCursor(null);
  }, [profile.siteId]);

  const cursor = useSectionCursor();
  const atM = cursor && cursor.siteId === profile.siteId ? cursor.atM : null;

  const layout = width > 120 ? sectionLayout(profile, width, HEIGHT) : null;
  const description = layout ? sectionDescription(profile, layout.exaggeration) : '';
  const height = atM !== null ? heightAt(profile, atM) : null;
  const readout = atM !== null ? cursorWords(atM, height) : '';

  const point = (at: number) =>
    setSectionCursor({ siteId: profile.siteId, atM: Math.min(profile.lengthM, Math.max(0, at)), from: 'section' });
  const fromPointer = (e: PointerEvent<SVGSVGElement>) => {
    const el = svg.current;
    if (!el || !layout) return;
    const r = el.getBoundingClientRect();
    const x = ((e.clientX - r.left) / Math.max(1, r.width)) * layout.width;
    point(distanceAtX(layout, profile.lengthM, x));
  };
  const letGo = () => {
    const c = getSectionCursor();
    if (c?.siteId === profile.siteId && c.from === 'section') setSectionCursor(null);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const here = atM ?? 0;
    const step = e.shiftKey ? BIG_STEP_M : STEP_M;
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowUp' ? here + step
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? here - step
          : e.key === 'PageUp' ? here + BIG_STEP_M
            : e.key === 'PageDown' ? here - BIG_STEP_M
              : e.key === 'Home' ? 0
                : e.key === 'End' ? profile.lengthM
                  : null;
    if (e.key === 'Escape') {
      letGo();
      return;
    }
    if (next === null) return;
    e.preventDefault();
    point(next);
  };

  // The tallest bank is where the keyboard starts: the figure the answer quotes first.
  const startAt = () => {
    // Read the store, not the render: a click focuses the plot after its pointerdown has pointed.
    if (getSectionCursor()?.siteId === profile.siteId) return;
    const banks = profile.marks.filter((m) => m.kind === 'bank');
    const top = banks.reduce<(typeof banks)[number] | null>((a, m) => (!a || m.offsetM > a.offsetM ? m : a), null);
    point(top ? top.atM : profile.lengthM / 2);
  };

  const cx = layout && atM !== null ? layout.xFor(atM) : null;
  const cy = layout && height !== null ? layout.yFor(height) : null;

  return (
    <div ref={host} className="profile-section">
      {layout && (
        <div
          className="profile-section__plot"
          role="slider"
          tabIndex={0}
          aria-label={`Point along the transect${profile.label ? ` across ${profile.label}` : ''}`}
          aria-describedby={descId}
          aria-valuemin={0}
          aria-valuemax={Math.round(profile.lengthM)}
          aria-valuenow={Math.round(atM ?? 0)}
          aria-valuetext={readout || 'not pointing; use the arrow keys to move along the line'}
          onKeyDown={onKeyDown}
          onFocus={startAt}
          onBlur={letGo}
        >
          <svg
            ref={svg}
            className={`profile-section__svg${drawn ? ' profile-section__svg--drawn' : ''}`}
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            aria-hidden="true"
            onPointerDown={(e) => {
              dragging.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              fromPointer(e);
            }}
            onPointerMove={(e) => {
              // A mouse reads on hover; a finger or a pen reads while it is down.
              if (dragging.current || e.pointerType === 'mouse') fromPointer(e);
            }}
            onPointerUp={(e) => {
              dragging.current = false;
              if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
              if (e.pointerType !== 'mouse') letGo();
            }}
            onPointerCancel={() => {
              dragging.current = false;
              letGo();
            }}
            onPointerLeave={() => {
              if (!dragging.current) letGo();
            }}
          >
            {/* The axis: a rule per metre with its value; the baseline a little stronger. */}
            {layout.ticks.map((t) => (
              <g key={t.label}>
                <line
                  className={`profile-section__rule${t.label === '0' ? ' profile-section__rule--baseline' : ''}`}
                  x1={layout.x0}
                  x2={layout.x1}
                  y1={t.y}
                  y2={t.y}
                />
                <text className="profile-section__tick" x={layout.x0 - 8} y={t.y} textAnchor="end" dominantBaseline="middle">
                  {t.label}
                </text>
              </g>
            ))}
            <path className="profile-section__wash" d={layout.fill} />
            <path className="profile-section__ground" d={layout.path} pathLength={1} />
            {layout.marks.map((m, i) => (
              <g key={`${m.kind}-${m.atM}-${i}`} className="profile-section__mark" style={{ transitionDelay: `${900 + i * 90}ms` }}>
                {m.kind === 'bank' ? (
                  <circle className="profile-section__bank" cx={m.x} cy={m.y} r={4.5} />
                ) : (
                  <circle className="profile-section__ditch" cx={m.x} cy={m.y} r={4.5} />
                )}
                {m.labelled && (
                  <text className="profile-section__label" x={m.x} y={m.labelY} textAnchor={m.anchor} dominantBaseline="middle">
                    {m.label}
                  </text>
                )}
              </g>
            ))}
            {cx !== null && (
              <g className="profile-section__cursor">
                <line className="profile-section__cursor-rule" x1={cx} x2={cx} y1={6} y2={layout.height - 6} />
                {cy !== null && <circle className="profile-section__cursor-dot" cx={cx} cy={cy} r={5.5} />}
              </g>
            )}
            {/* A wide transparent band so the whole plot answers the pointer, gaps included. */}
            <rect className="profile-section__hit" x={layout.x0} y={0} width={layout.x1 - layout.x0} height={layout.height} />
          </svg>
          <span id={descId} className="profile-section__desc">{description}</span>
        </div>
      )}
      <span className="profile-section__caption">
        <span className={`profile-section__caption-text${readout ? ' profile-section__caption-text--hidden' : ''}`}>
          {profile.label || 'the transect'}
          {profile.spanM !== null && (
            <>
              , <span className="profile-section__num">{Math.round(profile.spanM)} m</span> bank to bank
            </>
          )}
        </span>
        <span
          className={`profile-section__caption-text profile-section__readout${readout ? '' : ' profile-section__caption-text--hidden'}`}
          aria-hidden="true"
        >
          {readout}
        </span>
      </span>
    </div>
  );
}
