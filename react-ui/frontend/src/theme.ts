// Agentic AI for Earth: "The Planetarium Show"
// A mid-dark dome surround, fog-white captions, one accent (spotlight amber) that marks
// whatever is active. Components read these tokens; CSS variables in index.css mirror them
// for browser surfaces (selection, caret, scrollbars, focus rings).
export const theme = {
  colors: {
    // Spotlight amber: the single accent. Active act, active step, active layer, primary action.
    primary: '#f5a524',
    primaryHover: '#ffbd4f',
    onPrimary: '#0f141b',
    // A dim amber wash for selected rows and the active act's plate.
    primaryContainer: 'rgba(245, 165, 36, 0.16)',
    // Label grey: secondary text and quiet controls. Tinted from the dome, never neutral grey.
    secondary: '#8fa3b8',
    onSecondary: '#0f141b',
    // Label plates and panels that float over the map.
    surface: '#161c25',
    onSurface: '#e9eef3',
    surfaceVariant: '#1d2530',
    // The dome ground.
    background: '#0f141b',
    onBackground: '#e9eef3',
    error: '#ff7a70',
    onError: '#0f141b',
    success: '#7bd88f',
    // Hairlines: light on dark, low alpha so they read as etched rules, not borders.
    outline: 'rgba(233, 238, 243, 0.14)',
    outlineVariant: 'rgba(233, 238, 243, 0.24)',
  },

  // Real shadows: an offset and a soft blur, tinted by the dome so they sit in the room.
  elevation: {
    level0: 'none',
    level1: '0 1px 2px rgba(3, 6, 10, 0.5)',
    level2: '0 4px 12px rgba(3, 6, 10, 0.45)',
    level3: '0 10px 28px rgba(3, 6, 10, 0.5)',
    level4: '0 18px 44px rgba(3, 6, 10, 0.55)',
  },

  spacing: {
    xs: '4px',
    sm: '8px',
    md: '16px',
    lg: '24px',
    xl: '32px',
    xxl: '40px',
  },

  borderRadius: {
    sm: '4px',
    md: '8px',
    lg: '12px',
    full: '50%',
  },

  fonts: {
    display: '"Bricolage Grotesque", "Atkinson Hyperlegible Next", system-ui, sans-serif',
    body: '"Atkinson Hyperlegible Next", system-ui, sans-serif',
    mono: '"Atkinson Hyperlegible Mono", ui-monospace, "SF Mono", Menlo, monospace',
  },

  // Sizes are set for a projector read from the back of a room: nothing on the stage under 15px.
  typography: {
    headlineLarge: {
      fontFamily: '"Bricolage Grotesque", "Atkinson Hyperlegible Next", system-ui, sans-serif',
      fontSize: '40px',
      fontWeight: 500,
      lineHeight: 1.1,
      letterSpacing: '-0.01em',
    },
    headlineMedium: {
      fontFamily: '"Bricolage Grotesque", "Atkinson Hyperlegible Next", system-ui, sans-serif',
      fontSize: '30px',
      fontWeight: 500,
      lineHeight: 1.2,
      letterSpacing: '-0.01em',
    },
    titleLarge: {
      fontFamily: '"Bricolage Grotesque", "Atkinson Hyperlegible Next", system-ui, sans-serif',
      fontSize: '24px',
      fontWeight: 500,
      lineHeight: 1.3,
    },
    titleMedium: {
      fontSize: '18px',
      fontWeight: 600,
      lineHeight: 1.4,
    },
    bodyLarge: {
      fontSize: '18px',
      fontWeight: 400,
      lineHeight: 1.5,
    },
    bodyMedium: {
      fontSize: '16px',
      fontWeight: 400,
      lineHeight: 1.5,
    },
    labelLarge: {
      fontSize: '15px',
      fontWeight: 500,
      lineHeight: 1.4,
      letterSpacing: '0.01em',
    },
    // Exhibit label: small caps, tracked, for object names and section titles on plates.
    labelCaps: {
      fontFamily: '"Bricolage Grotesque", "Atkinson Hyperlegible Next", system-ui, sans-serif',
      fontSize: '13px',
      fontWeight: 600,
      lineHeight: 1.2,
      letterSpacing: '0.12em',
      textTransform: 'uppercase' as const,
    },
    // Numerics: coordinates, areas, dates, ids. Always this register, always tabular.
    mono: {
      fontFamily: '"Atkinson Hyperlegible Mono", ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: '14px',
      fontWeight: 400,
      lineHeight: 1.4,
      fontVariantNumeric: 'tabular-nums' as const,
    },
  },

  // One motion grammar: exponential ease-out from a visible default. Nothing bounces.
  transitions: {
    short: '200ms cubic-bezier(0.16, 1, 0.3, 1)',
    medium: '360ms cubic-bezier(0.16, 1, 0.3, 1)',
    spotlight: '900ms cubic-bezier(0.16, 1, 0.3, 1)',
  },

  states: {
    hover: 'rgba(233, 238, 243, 0.06)',
    active: 'rgba(233, 238, 243, 0.12)',
    disabled: 0.55,
  },
};
