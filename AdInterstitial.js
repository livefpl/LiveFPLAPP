// adManager.js
// Interstitial manager with single-flight + safe fallback.
// No cooldowns or scheduling logic here (handled elsewhere).
// Public API:
//   isShowing()
//   showOnce({ reason?, adUnitId?, fallbackToMock?, npa? })

import { Alert, Platform } from 'react-native';

let RNAds = null;
try {
  RNAds = require('react-native-google-mobile-ads');
} catch (_) {
  RNAds = null;
}

const InterstitialAd = RNAds?.InterstitialAd;
const AdEventType    = RNAds?.AdEventType;
const TestIds        = RNAds?.TestIds;

// ======= YOUR REAL INTERSTITIAL UNIT IDS (per platform) =======
// TODO: replace these with your actual AdMob interstitial unit IDs.
// Example format: "ca-app-pub-7466981426984905/1234567890"
const PROD_INTERSTITIAL_UNIT_ID = Platform.select({
  ios:     'ca-app-pub-7466981426984905/5106706926',     // <-- replace
  android: 'ca-app-pub-7466981426984905/5106706926', // <-- replace
  default: undefined,
});
// ===============================================================

let inflight = null;   // single-flight promise
let showing  = false;  // true while an interstitial is on screen

export function isShowing() {
  return showing;
}

/**
 * showOnce({ reason?, adUnitId?, fallbackToMock?, npa? })
 * - Always resolves; never throws.
 * - In dev/Expo Go: uses test/mock path.
 * - In native dev client/release: uses AdMob when possible.
 * Returns: { shown: boolean, provider: 'google'|'mock'|'mock-fallback', reason?: string }
 */
export function showOnce(opts = {}) {
  if (inflight) return inflight;

  inflight = (async () => {
    const {
      reason = 'unspecified',
      adUnitId,              // optional override
      fallbackToMock = true, // set false to silently fail instead of mock
      npa = true,            // request non-personalized ads only (until you wire consent)
    } = opts;

    // No native ads module (Expo Go or not installed) -> mock
    if (!InterstitialAd) {
      if (fallbackToMock) {
        try { Alert.alert('Mock Ad', 'Interstitial would show here.'); } catch {}
        inflight = null;
        return { shown: true, provider: 'mock', reason };
      }
      inflight = null;
      return { shown: false, provider: 'mock', reason: 'no-native-module' };
    }

    // Choose unit ID:
    // - DEV: always test id
    // - PROD: prefer explicit adUnitId, else baked-in per-platform id
    const unitId = __DEV__
      ? (TestIds?.INTERSTITIAL || 'ca-app-pub-3940256099942544/1033173712')
      : (adUnitId || PROD_INTERSTITIAL_UNIT_ID);

    // If we still don't have a real id in prod, use mock (to avoid accidental test ads)
    if (!__DEV__ && !unitId) {
      if (fallbackToMock) {
        try { Alert.alert('Mock Ad', 'Missing production interstitial unit id.'); } catch {}
        inflight = null;
        return { shown: true, provider: 'mock-fallback', reason: 'missing-unit-id' };
      }
      inflight = null;
      return { shown: false, provider: 'google', reason: 'missing-unit-id' };
    }

    // Create and load
    let cleanup = () => {};
    const ad = InterstitialAd.createForAdRequest(unitId, {
      requestNonPersonalizedAdsOnly: !!npa,
      keywords: ['sports', 'football', 'fantasy'],
    });

    const waitForLoadedOrError = () =>
      new Promise((resolve) => {
        const onLoaded = () => resolve('loaded');
        const onError  = () => resolve('error');
        const u1 = ad.addAdEventListener(AdEventType.LOADED, onLoaded);
        const u2 = ad.addAdEventListener(AdEventType.ERROR,  onError);
        cleanup = () => { try { u1(); u2(); } catch {} };
        try { ad.load(); } catch { resolve('error'); }
        setTimeout(() => resolve('error'), 7000); // safety timeout
      });

    const state = await waitForLoadedOrError();
    cleanup();

    if (state !== 'loaded') {
      if (fallbackToMock) {
        try { Alert.alert('Mock Ad', 'Interstitial failed to load (showing mock).'); } catch {}
        inflight = null;
        return { shown: true, provider: 'mock-fallback', reason: 'load-failed' };
      }
      inflight = null;
      return { shown: false, provider: 'google', reason: 'load-failed' };
    }

    // Show and wait for close
    try {
      showing = true;
      const closed = new Promise((resolve) => {
        const unsub = ad.addAdEventListener(AdEventType.CLOSED, () => {
          try { unsub(); } catch {}
          resolve();
        });
      });
      ad.show();
      await closed;
      showing = false;
      inflight = null;
      return { shown: true, provider: 'google', reason };
    } catch {
      showing = false;
      if (fallbackToMock) {
        try { Alert.alert('Mock Ad', 'Interstitial failed to show (mock fallback).'); } catch {}
        inflight = null;
        return { shown: true, provider: 'mock-fallback', reason: 'show-error' };
      }
      inflight = null;
      return { shown: false, provider: 'google', reason: 'show-error' };
    }
  })();

  return inflight;
}
