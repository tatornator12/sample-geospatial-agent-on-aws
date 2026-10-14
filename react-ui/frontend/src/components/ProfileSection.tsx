/**
 * The cross-section under the "Measure across the earthwork" step: the ground along the transect
 * as the LiDAR measured it, the baseline dashed, a filled dot at each bank and a ring at each ditch
 * (the map's own marks), the heights on a signed axis in the mono face. The line draws itself on
 * when it lands, the way an instrument trace does; nothing moves after that.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { sectionDescription, sectionLayout, type ProfileData } from '../utils/profileSection.ts';

const HEIGHT = 128;

export function ProfileSection({ profile }: { profile: ProfileData }) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [drawn, setDrawn] = useState(false);

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

  const layout = width > 120 ? sectionLayout(profile, width, HEIGHT) : null;
  const description = layout ? sectionDescription(profile, layout.exaggeration) : '';

  return (
    <div ref={host} className="profile-section">
      {layout && (
        <svg
          className={`profile-section__svg${drawn ? ' profile-section__svg--drawn' : ''}`}
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-label={description}
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
        </svg>
      )}
      <span className="profile-section__caption">
        {profile.label || 'the transect'}
        {profile.spanM !== null && (
          <>
            , <span className="profile-section__num">{Math.round(profile.spanM)} m</span> bank to bank
          </>
        )}
      </span>
    </div>
  );
}
