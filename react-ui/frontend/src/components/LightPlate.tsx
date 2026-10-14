/**
 * The light plate: the archaeologist's raking light as a thing the presenter holds. A dial shows
 * where the sun stands (drawn as the room sees the map, so the sun on the dial is where the light
 * comes from on screen); drag it round, or use the arrow keys, and every bank's shadow swings with
 * it. The height control drops the sun to the horizon (long shadows, the walls stand up) or lifts
 * it overhead (the ground reads flat). "Sweep the sun" replays the arrival: high to raking, then
 * once round the earthwork. Only on the stage while a live hillshade is.
 */
import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { LIGHT_ALTITUDE_RANGE, altitudeWords, compassName, dialAzimuth, stepLight } from '../utils/archaeoLayers.ts';

const SIZE = 120;
const R = 48;
const POINTS = [0, 45, 90, 135, 180, 225, 270, 315];

interface LightPlateProps {
  azimuth: number;
  altitude: number;
  /** The camera's bearing: the dial turns with the map. */
  bearing: number;
  sweeping: boolean;
  onChange: (azimuth: number, altitude: number) => void;
  onSweep: () => void;
}

export function LightPlate({ azimuth, altitude, bearing, sweeping, onChange, onSweep }: LightPlateProps) {
  const dial = useRef<HTMLDivElement>(null);
  const [held, setHeld] = useState(false);
  const az = Math.round(((azimuth % 360) + 360) % 360);
  const alt = Math.round(altitude);
  const from = compassName(az);

  // Screen angle of the sun on the dial: map azimuth less the camera's bearing.
  const screen = ((az - bearing) * Math.PI) / 180;
  const sunX = Math.sin(screen) * R;
  const sunY = -Math.cos(screen) * R;
  // The sun sits nearer the rim the lower it is: a high sun stands in towards the centre.
  const [lo, hi] = LIGHT_ALTITUDE_RANGE;
  const inset = 1 - 0.55 * ((Math.min(hi, Math.max(lo, alt)) - lo) / (hi - lo));

  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const el = dial.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    onChange(dialAzimuth(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2), bearing), alt);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = stepLight(az, e.key, 'azimuth');
    if (next === null) return;
    e.preventDefault();
    onChange(next, alt);
  };

  return (
    <section className="map-plate map-light" aria-label="Raking light">
      <div className="map-light__head">
        <span className="map-plate__title">Raking light</span>
        <button type="button" className="stage-btn map-light__sweep" onClick={onSweep} disabled={sweeping}>
          {sweeping ? 'The sun is moving' : 'Sweep the sun'}
        </button>
      </div>
      <div className="map-light__body">
        <div
          ref={dial}
          className={`map-light__dial${held ? ' map-light__dial--held' : ''}`}
          role="slider"
          tabIndex={0}
          aria-label="Where the light comes from"
          aria-valuemin={0}
          aria-valuemax={359}
          aria-valuenow={az}
          aria-valuetext={`from the ${from}, ${az} degrees`}
          onKeyDown={onKeyDown}
          onPointerDown={(e) => {
            setHeld(true);
            e.currentTarget.setPointerCapture(e.pointerId);
            fromPointer(e);
          }}
          onPointerMove={(e) => {
            if (held) fromPointer(e);
          }}
          onPointerUp={(e) => {
            setHeld(false);
            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => setHeld(false)}
        >
          <svg width={SIZE} height={SIZE} viewBox={`${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`} aria-hidden="true">
            <circle className="map-light__rim" r={R} />
            {/* The compass turns with the map: north is where the map's north is on screen. */}
            <g transform={`rotate(${-bearing})`}>
              {POINTS.map((p) => (
                <line
                  key={p}
                  className={`map-light__tick${p === 0 ? ' map-light__tick--north' : ''}`}
                  x1={0}
                  x2={0}
                  y1={-R + (p % 90 === 0 ? 9 : 5)}
                  y2={-R}
                  transform={`rotate(${p})`}
                />
              ))}
              <text className="map-light__north" x={0} y={-R + 22} textAnchor="middle" dominantBaseline="middle" transform={`rotate(${bearing} 0 ${-R + 22})`}>
                N
              </text>
            </g>
            <line className="map-light__ray" x1={0} y1={0} x2={sunX * inset} y2={sunY * inset} />
            <circle className="map-light__sun" cx={sunX * inset} cy={sunY * inset} r={9} />
          </svg>
        </div>
        <div className="map-light__read">
          <span className="map-light__from">
            from the {from} <span className="map-light__num">{az}°</span>
          </span>
          <label className="map-light__height">
            <span className="map-light__label">
              sun height <span className="map-light__num">{alt}°</span>
            </span>
            <input
              type="range"
              className="map-light__input"
              min={lo}
              max={hi}
              step={1}
              value={alt}
              onChange={(e) => onChange(az, Number(e.target.value))}
              aria-valuetext={`${alt} degrees above the horizon, ${altitudeWords(alt)}`}
            />
          </label>
          <span className="map-light__words">{altitudeWords(alt)}</span>
        </div>
      </div>
    </section>
  );
}
