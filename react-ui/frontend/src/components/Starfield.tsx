/**
 * Space behind the watch globe: a still field of faint stars on a deep navy, drawn behind the map
 * canvas (which is transparent outside the globe). Deterministic (a seeded generator, so every
 * load and every screenshot is the same sky), never animated (motion on the stage only shows the
 * agent working), and decorative only (hidden from assistive technology).
 */
import { memo, useMemo } from 'react';

interface Star {
  x: number;
  y: number;
  r: number;
  o: number;
  cool: boolean;
}

/** mulberry32: a small seeded generator, so the sky is the same on every load. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function starField(count: number, seed = 20261109): Star[] {
  const rand = seeded(seed);
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    const bright = rand() > 0.92;
    stars.push({
      x: Math.round(rand() * 1600 * 10) / 10,
      y: Math.round(rand() * 1000 * 10) / 10,
      r: bright ? 0.9 + rand() * 0.5 : 0.35 + rand() * 0.45,
      o: bright ? 0.55 + rand() * 0.3 : 0.18 + rand() * 0.32,
      cool: rand() > 0.7,
    });
  }
  return stars;
}

export const Starfield = memo(function Starfield() {
  const stars = useMemo(() => starField(220), []);
  return (
    <div className="map-space" aria-hidden="true">
      <svg className="map-space__stars" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" focusable="false">
        {stars.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} fill={s.cool ? '#c9dcf2' : '#e9eef3'} opacity={s.o} />
        ))}
      </svg>
    </div>
  );
});
