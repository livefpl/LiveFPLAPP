// playwireInit.js — lazy-loads Playwire SDK after first init
import { Platform } from 'react-native';
import { markPlaywireInitialized, preloadInterstitial } from './AdInterstitial';

const PLAYWIRE_TEST_MODE = false;

let _initStarted = false;
let _sdkReady = false;
let _waiters = [];
let _lastInitErr = null;
let _initAttempts = 0;

export function isPlaywireReady() {
  return _sdkReady;
}

export function getPlaywireInitDebug() {
  return {
    sdkReady: _sdkReady,
    initStarted: _initStarted,
    initAttempts: _initAttempts,
    lastInitErr: _lastInitErr,
  };
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
    try { fn(); } catch {}
  });
}

export function initPlaywire({ publisherId, iosAppId, androidAppId }) {
  // If already ready, nothing to do.
  if (_sdkReady) return true;

  const appId = Platform.select({ ios: iosAppId, android: androidAppId });

  // IMPORTANT: Do NOT permanently lock if config missing.
  if (!publisherId || !appId) {
    _lastInitErr = { kind: 'missing_config', publisherId: !!publisherId, appId: !!appId };
    return false;
  }

  // Avoid parallel init attempts.
  if (_initStarted) return false;

  _initStarted = true;
  _initAttempts += 1;
  _lastInitErr = null;

  try {
    const { Playwire } = require('@intergi/react-native-playwire-sdk');
    Playwire.setTest(!!PLAYWIRE_TEST_MODE);

    Playwire.initializeSDK(publisherId, appId, async () => {
      _setReady();

      try { markPlaywireInitialized(); } catch {}
      try { await preloadInterstitial(); } catch {}
    });

    return true;
  } catch (e) {
    // Allow retry within the same run.
    _lastInitErr = { kind: 'exception', msg: String(e?.message || e).slice(0, 200) };
    _initStarted = false;
    return false;
  }
}

// Optional: manual “self-heal” hook if you detect stuck init.
export function retryPlaywireInit(args) {
  if (_sdkReady) return true;
  _initStarted = false;
  return initPlaywire(args);
}
