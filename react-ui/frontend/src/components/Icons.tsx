/**
 * Icon set for the stage. One stroke weight (1.75), 16px grid, currentColor.
 * Authored here so no emoji or unicode glyph ever stands in for an icon.
 */
import type { ReactElement, SVGProps } from 'react';

export type IconName =
  | 'point'
  | 'polygon'
  | 'send'
  | 'trash'
  | 'chevron-down'
  | 'chevron-right'
  | 'close'
  | 'layers'
  | 'transcript'
  | 'stop'
  | 'reset'
  | 'compare'
  | 'zoom';

const paths: Record<IconName, ReactElement> = {
  point: (
    <>
      <path d="M8 14.5s-4.5-4-4.5-7.5a4.5 4.5 0 0 1 9 0c0 3.5-4.5 7.5-4.5 7.5Z" />
      <circle cx="8" cy="7" r="1.6" />
    </>
  ),
  polygon: (
    <>
      <path d="M3 5.5 8 2.5l5 3v5l-5 3-5-3v-5Z" />
      <circle cx="3" cy="5.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="13" cy="5.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="13.5" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  send: <path d="M2.5 8 13.5 3l-3 10-2.6-4.2L2.5 8Zm5.4.8L13.5 3" />,
  trash: (
    <>
      <path d="M3 4.5h10M6.5 4.5v-1a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1" />
      <path d="M4.5 4.5 5 13a1 1 0 0 0 1 .9h4a1 1 0 0 0 1-.9l.5-8.5" />
    </>
  ),
  'chevron-down': <path d="m4 6.5 4 4 4-4" />,
  'chevron-right': <path d="m6.5 4 4 4-4 4" />,
  close: <path d="m4 4 8 8M12 4l-8 8" />,
  layers: (
    <>
      <path d="m8 2.5 5.5 3L8 8.5 2.5 5.5 8 2.5Z" />
      <path d="M2.5 8.5 8 11.5l5.5-3M2.5 11.5 8 14.5l5.5-3" />
    </>
  ),
  transcript: (
    <>
      <path d="M3 3.5h10v7H6.5L3 13V3.5Z" />
      <path d="M5.5 6h5M5.5 8.2h3.5" />
    </>
  ),
  stop: <rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" stroke="none" />,
  reset: (
    <>
      <path d="M13 8a5 5 0 1 1-1.5-3.6" />
      <path d="M13 3v3h-3" />
    </>
  ),
  compare: (
    <>
      <rect x="2.5" y="3.5" width="11" height="9" rx="1" />
      <path d="M8 3.5v9" />
    </>
  ),
  zoom: (
    <>
      <circle cx="7" cy="7" r="4" />
      <path d="m10 10 3.5 3.5M7 5v4M5 7h4" />
    </>
  ),
};

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  /** Accessible label; omit when the icon sits beside visible text. */
  label?: string;
}

export function Icon({ name, size = 16, label, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable="false"
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}
