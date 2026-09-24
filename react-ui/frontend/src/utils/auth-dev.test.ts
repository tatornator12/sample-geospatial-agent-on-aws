/**
 * The dev-mode auth bypass must never activate off localhost, even when a bundle was built
 * with VITE_DEV_MODE=true (that happened on the 2026-09-24 CloudFront deploy). Each case
 * re-imports the module with a different hostname so the module-level constant is recomputed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

async function devModeAt(hostname: string, flag: string | undefined) {
  vi.resetModules();
  vi.stubEnv('VITE_DEV_MODE', flag as string);
  Object.defineProperty(window, 'location', {
    value: { ...window.location, hostname, origin: `https://${hostname}` },
    writable: true,
    configurable: true,
  });
  const mod = await import('./auth-dev.ts');
  return mod.isDevMode();
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isDevMode', () => {
  it('is on for a localhost page built with the flag', async () => {
    expect(await devModeAt('localhost', 'true')).toBe(true);
    expect(await devModeAt('127.0.0.1', 'true')).toBe(true);
  });

  it('is OFF on a real domain even when the flag was baked into the build', async () => {
    expect(await devModeAt('d3psp63cdugg2k.cloudfront.net', 'true')).toBe(false);
    expect(await devModeAt('demo.example.com', 'true')).toBe(false);
  });

  it('is off on localhost without the flag', async () => {
    expect(await devModeAt('localhost', undefined)).toBe(false);
    expect(await devModeAt('localhost', 'false')).toBe(false);
  });
});

describe('getApiUrl', () => {
  it('uses the page origin off localhost regardless of the dev flag', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_DEV_MODE', 'true');
    vi.stubEnv('VITE_API_URL', '');
    Object.defineProperty(window, 'location', {
      value: { ...window.location, hostname: 'd3psp63cdugg2k.cloudfront.net', origin: 'https://d3psp63cdugg2k.cloudfront.net' },
      writable: true,
      configurable: true,
    });
    const { getApiUrl } = await import('../services/api.ts');
    expect(getApiUrl()).toBe('https://d3psp63cdugg2k.cloudfront.net');
  });

  it('uses the local backend on localhost', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_API_URL', '');
    Object.defineProperty(window, 'location', {
      value: { ...window.location, hostname: 'localhost', origin: 'http://localhost:5173' },
      writable: true,
      configurable: true,
    });
    const { getApiUrl } = await import('../services/api.ts');
    expect(getApiUrl()).toBe('http://localhost:3001');
  });
});
