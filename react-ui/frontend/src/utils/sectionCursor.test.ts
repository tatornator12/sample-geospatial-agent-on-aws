import { afterEach, describe, expect, it } from 'vitest';
import { getSectionCursor, setSectionCursor, subscribeSectionCursor } from './sectionCursor.ts';

describe('the section cursor store', () => {
  afterEach(() => setSectionCursor(null));

  it('tells its listeners when the spot moves, and not when it stays put', () => {
    let calls = 0;
    const off = subscribeSectionCursor(() => { calls += 1; });
    setSectionCursor({ siteId: 'newark-octagon', atM: 100, from: 'section' });
    expect(getSectionCursor()).toEqual({ siteId: 'newark-octagon', atM: 100, from: 'section' });
    expect(calls).toBe(1);
    // A wobble under 5 cm from the same side is the same spot.
    setSectionCursor({ siteId: 'newark-octagon', atM: 100.01, from: 'section' });
    expect(calls).toBe(1);
    // The map taking over is news, even at the same distance.
    setSectionCursor({ siteId: 'newark-octagon', atM: 100, from: 'map' });
    expect(calls).toBe(2);
    setSectionCursor(null);
    expect(getSectionCursor()).toBeNull();
    expect(calls).toBe(3);
    setSectionCursor(null);
    expect(calls).toBe(3);
    off();
    setSectionCursor({ siteId: 'x', atM: 1, from: 'map' });
    expect(calls).toBe(3);
  });
});
