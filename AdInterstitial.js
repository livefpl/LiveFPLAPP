// adManager.js
// Minimal mock interstitial wrapper with single-flight & no UI.
// Safe to import; does nothing visible unless you call showOnce().
 import { Alert } from 'react-native';
let inflight = null;

export function isShowing() {
  return !!inflight;
}

/**
 * showOnce({ reason })
 * - Single-flight: concurrent calls coalesce into one.
 * - Always resolves; never throws.
 * - Mock delay simulates load/show without UI.
 */
export function showOnce(opts = {}) {
  if (inflight) return inflight;

  const { reason = 'unspecified' } = opts;

  inflight = new Promise((resolve) => {
    // Small async delay to ensure we’re off any UI/navigation stack
    setTimeout(() => {
      // Replace this block with real AdMob later.
      // Intentionally minimal: no UI, just a console signal for now.
      try {
        // eslint-disable-next-line no-console
        console.warn('[adManager] MOCK interstitial shown (no UI). reason =', reason);
        Alert.alert('Mock Ad', 'This is a test interstitial (no real ad yet).');
    
      } catch (_) { /* ignore */ }
      resolve({ shown: true, provider: 'mock', reason });
      inflight = null;
    }, 400);
  });

  return inflight;
}
