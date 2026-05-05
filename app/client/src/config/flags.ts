export interface FeatureFlags {
  /** Promote v2 project page to default `/projects/:id` route. */
  USE_V2_PROJECT: boolean;
}

const DEFAULTS: FeatureFlags = {
  // Phase 6a: v2 is the default. `?v1=true` opts out for the current load
  // (and clears the localStorage opt-in if it was set).
  USE_V2_PROJECT: true,
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

/**
 * Per-render flag check that re-reads `?v1=true` / `?v2=true` from the
 * provided search string. Useful inside React components that should respond
 * to navigation without a full reload.
 */
export function isV2EnabledForLocation(search: string | undefined | null): boolean {
  if (!search) return flags.USE_V2_PROJECT;
  try {
    const params = new URLSearchParams(search);
    const v1 = params.get('v1');
    const v2 = params.get('v2');
    if (v1 === 'true' || v1 === '1') return false;
    if (v2 === 'true' || v2 === '1') return true;
  } catch { /* ignore */ }
  return flags.USE_V2_PROJECT;
}
