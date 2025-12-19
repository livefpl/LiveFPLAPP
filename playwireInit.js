// playwireInit.js
import { Platform } from 'react-native';
import { Playwire } from '@intergi/react-native-playwire-sdk';
import { markPlaywireInitialized, preloadInterstitial } from './AdInterstitial';

// Production defaults:
// - no console logger
// - no noisy logs
// - no test mode
const PLAYWIRE_TEST_MODE = false;

let _initStarted = false;
let _sdkReady = false;
let _waiters = [];

export function isPlaywireReady() {
  return _sdkReady;
}

export function onPlaywireReady(cb) {
  if (typeof cb !== 'function') return;
  if (_sdkReady) cb();
  else _waiters.push(cb);
}

function _setReady() {
  if (_sdkReady) return;
  _sdkReady = true;
  const ws = _waiters;
  _waiters = [];
  ws.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
}

export function initPlaywire({ publisherId, iosAppId, androidAppId }) {
  if (_initStarted) return;
  _initStarted = true;

  const appId = Platform.select({
    ios: iosAppId,
    android: androidAppId,
  });

  // If config missing, fail silently in production.
  if (!publisherId || !appId) return;

  try {
    // Keep this *before* initializeSDK.
    Playwire.setTest(!!PLAYWIRE_TEST_MODE);

    Playwire.initializeSDK(publisherId, appId, async () => {
      // SDK finished init callback
      _setReady();

      // Let interstitial module know SDK is ready
      try {
        markPlaywireInitialized();
      } catch {}

      // Preload an interstitial (silent)
      try {
        await preloadInterstitial();
      } catch {}
    });
  } catch {
    // Silent in production
  }
}
