// AdInterstitial.js
// Minimal interstitial wrapper: single-flight + built-in Pro guard via RevenueCat.
// No wiring required. It queries RC directly on iOS to see if 'Premium' is active.

import { Platform } from 'react-native';
import Purchases from 'react-native-purchases';

let inflight = null;

// Cooldown to avoid spamming interstitials
let _minIntervalMs = 90_000; // 90s
let _lastShownAt = 0;

// Optional external guard; if it returns true -> suppress ads (kept for compatibility)
let _adGuard = null;

// Entitlement ID in RevenueCat (case-sensitive, from your screenshot)
const ENTITLEMENT_ID = 'Premium';

// Small cache so we don't hit RC every time
let _cachedIsPro = false;
let _lastProCheckAt = 0;
const _proTtlMs = 5 * 60_000; // 5 minutes

async function isProViaRevenueCat() {
  if (Platform.OS !== 'ios') return false; // Android RC not set yet → show ads
  const now = Date.now();
  if (now - _lastProCheckAt < _proTtlMs) return _cachedIsPro;

  try {
    const info = await Purchases.getCustomerInfo();
    const active = !!info?.entitlements?.active?.[ENTITLEMENT_ID];
    _cachedIsPro = active;
    _lastProCheckAt = now;
    return active;
  } catch {
    // On any error, assume not pro (show ads) rather than silently suppressing
    _cachedIsPro = false;
    _lastProCheckAt = now;
    return false;
  }
}

/**
 * Configure interstitials (e.g., cooldown).
 * Optional—safe to ignore.
 */
export function configureAds({ minIntervalMs } = {}) {
  if (typeof minIntervalMs === 'number') _minIntervalMs = Math.max(0, minIntervalMs);
}

/**
 * Optional guard. If it returns true, ads are suppressed.
 * You don't need to call this at all; it's here for compatibility.
 */
export function setAdGuard(fn) {
  _adGuard = typeof fn === 'function' ? fn : null;
}

/** Returns true if an interstitial is currently inflight/showing */
export function isShowing() {
  return !!inflight;
}

/**
 * showOnce({ reason, force })
 * - Single-flight: concurrent calls coalesce into one.
 * - Suppressed if user has Premium on iOS (RevenueCat check) or guard says so.
 * - Cooldown respected unless force=true (still respects Premium/guard).
 * - Always resolves; never throws.
 */
export async function showOnce({ reason, force } = {}) {
  // Guard first (optional)
  try {
    if (_adGuard && _adGuard()) return;
  } catch {
    // if guard throws, just ignore it
  }

  // Premium check via RevenueCat (iOS only)
  if (await isProViaRevenueCat()) return;

  // Cooldown
  if (!force) {
    const now = Date.now();
    if (now - _lastShownAt < _minIntervalMs) return;
  }

  if (inflight) return inflight;

  inflight = (async () => {
    try {
      // TODO: replace this with your real interstitial call (AdMob/AppLovin/etc.)
      // Example skeleton:
      // const ready = await AdSDK.loadInterstitialIfNeeded();
      // if (ready) await AdSDK.showInterstitial();

      await new Promise((r) => setTimeout(r, 50)); // mock no-op
      _lastShownAt = Date.now();
    } catch {
      // swallow errors
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
