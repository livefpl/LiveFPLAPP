// playwireInit.js
import { Platform } from 'react-native';
import { Playwire } from '@intergi/react-native-playwire-sdk';
import { markPlaywireInitialized, preloadInterstitial } from './AdInterstitial';

// TEMPORARY: always use Playwire test mode until real demand is live
Playwire.setTest(true);
Playwire.startConsoleLogger();

/** ---- SDK Ready gate ---- */
let _initStarted = false;
let _sdkReady = false;
let _waiters = [];

export function isPlaywireReady() {
  return _sdkReady;
}

export function onPlaywireReady(cb) {
  if (_sdkReady) cb();
  else _waiters.push(cb);
}

function _setReady() {
  if (_sdkReady) return;
  _sdkReady = true;
  const ws = _waiters;
  _waiters = [];
  ws.forEach((fn) => {
    try { fn(); } catch {}
  });
}

export function initPlaywire({ publisherId, iosAppId, androidAppId }) {
  if (_initStarted) return; // <-- important: avoid double init
  _initStarted = true;

  console.log('[Playwire] initPlaywire inputs', {
    platform: Platform.OS,
    publisherId: publisherId ? 'present' : 'missing',
    iosAppId: iosAppId ? 'present' : 'missing',
    androidAppId: androidAppId ? 'present' : 'missing',
  });

  const appId = Platform.select({
    ios: iosAppId,
    android: androidAppId,
  });

  if (!publisherId || !appId) {
    console.warn('Playwire init skipped: missing publisherId or platform appId', {
      platform: Platform.OS,
      publisherId,
      appId,
    });
    return;
  }

  try {
    console.log('[Playwire] calling initializeSDK', { platform: Platform.OS, publisherId, appId });

    Playwire.initializeSDK(publisherId, appId, async () => {
      console.log('[Playwire] initializeSDK callback fired ✅');

      // Mark ready FIRST (unblocks banner mounting)
      _setReady();

      // Your existing debug/HUD init state
      try { markPlaywireInitialized(); } catch (e) {
        console.log('[Playwire] markPlaywireInitialized failed:', e);
      }

      // Preload an interstitial ASAP after init
      try {
        const ok = await preloadInterstitial();
        console.log('[Playwire] preloadInterstitial result:', ok);
      } catch (e) {
        console.log('[Playwire] preloadInterstitial threw:', e);
      }
    });
  } catch (e) {
    console.warn('Playwire.initializeSDK threw an error:', e);
  }
}
