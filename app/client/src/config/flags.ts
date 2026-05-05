export interface FeatureFlags {
  /** Promote v2 project page to default `/projects/:id` route. */
  USE_V2_PROJECT: boolean;
}

const DEFAULTS: FeatureFlags = {
  // Phase 1: v2 lives behind an opt-in. Use `?v2=true` to try it.
  USE_V2_PROJECT: false,
};

const STORAGE_KEY = 'codeguru.v2';

function readOverride(): Partial<FeatureFlags> {
  if (typeof window === 'undefined') return {};

  try {
    const params = new URLSearchParams(window.location.search);
    const v2 = params.get('v2');
    const v1 = params.get('v1');

    if (v2 === 'true' || v2 === '1') {
      try { window.localStorage.setItem(STORAGE_KEY, '1'); } catch { /* ignore */ }
      return { USE_V2_PROJECT: true };
    }
    if (v1 === 'true' || v1 === '1') {
      try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      return { USE_V2_PROJECT: false };
    }
    if (window.localStorage.getItem(STORAGE_KEY) === '1') {
      return { USE_V2_PROJECT: true };
    }
  } catch {
    // SSR / locked-down browser — fall through to defaults
  }
  return {};
}

export const flags: FeatureFlags = {
  ...DEFAULTS,
  ...readOverride(),
};

export function isV2Enabled(): boolean {
  return flags.USE_V2_PROJECT;
}
