// AdInterstitial.js
// Minimal interstitial wrapper with single-flight & Pro guard.
// Safe to import; does nothing visible unless you call showOnce().
import { Alert } from 'react-native';

let inflight = null;
/** Guard function set by ProContext; return true to suppress ads */
let _adGuard = null;

/**
 * Register a guard that decides whether ads should be suppressed.
 * ProContext calls this with a function that reads its internal ref.
 */
export function setAdGuard(fn) {
  _adGuard = typeof fn === 'function' ? fn : null;
}

/** Returns true if an interstitial is currently inflight/showing */
export function isShowing() {
  return !!inflight;
}

/**
 * showOnce({ reason })
 * - Single-flight: concurrent calls coalesce into one.
 * - Always resolves; never throws.
 * - Suppressed if guard says ads should be hidden (Pro).
 */
export async function showOnce({ reason } = {}) {
  try {
    if (_adGuard && _adGuard()) {
      return; // Pro: do nothing
    }
  } catch {
    // ignore guard errors
  }

  if (inflight) return inflight;

  inflight = (async () => {
    try {
      // Replace this mock with your real interstitial call (AdMob etc.)
      // Keep this silent in production if you like.
      await new Promise((r) => setTimeout(r, 50));
      // Example debug UI (safe to remove):
      // Alert.alert('Ad', `Interstitial (${reason || 'no reason'})`, [{ text: 'OK' }]);
    } catch {
      // swallow errors
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
