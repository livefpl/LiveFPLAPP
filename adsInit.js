// adsInit.js — AppLovin MAX init for the Freestar test build
import { Platform } from 'react-native';
import { markAdsInitialized, preloadInterstitial } from './AdInterstitial';
import { MAX_SDK_KEY } from './adsConfig';

let _initStarted = false;
let _sdkReady = false;
let _waiters = [];
let _lastInitErr = null;
let _initAttempts = 0;

export function isAdsReady() {
  return _sdkReady;
}

export function getAdsInitDebug() {
  return {
    sdkReady: _sdkReady,
    initStarted: _initStarted,
    initAttempts: _initAttempts,
    lastInitErr: _lastInitErr,
    provider: 'max',
  };
}

export function onAdsReady(cb) {
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

function _getMax() {
  try {
    return require('react-native-applovin-max');
  } catch {
    return null;
  }
}

async function _applyTrackingAndConsent(AppLovinMAX, Privacy) {
  let granted = true;
  if (Platform.OS === 'ios') {
    try {
      const { requestTrackingPermissionsAsync } = require('expo-tracking-transparency');
      const res = await requestTrackingPermissionsAsync();
      granted = res?.status === 'granted';
    } catch {}
  }
  try {
    if (Privacy?.setHasUserConsent) Privacy.setHasUserConsent(granted);
    else AppLovinMAX?.setHasUserConsent?.(granted);
  } catch {}
}

export function initAds() {
  if (_sdkReady) return true;
  if (_initStarted) return false;

  _initStarted = true;
  _initAttempts += 1;
  _lastInitErr = null;

  const run = async () => {
    const max = _getMax();
    const AppLovinMAX = max?.default || max;
    if (!AppLovinMAX?.initialize) {
      _lastInitErr = { kind: 'sdk_missing' };
      _initStarted = false;
      return false;
    }

    try {
      try {
        AppLovinMAX.setVerboseLogging?.(false);
      } catch {}

      await _applyTrackingAndConsent(AppLovinMAX, max?.Privacy);
      await AppLovinMAX.initialize(MAX_SDK_KEY);

      _setReady();
      try {
        markAdsInitialized();
      } catch {}
      try {
        await preloadInterstitial();
      } catch {}

      return true;
    } catch (e) {
      _lastInitErr = { kind: 'exception', msg: String(e?.message || e).slice(0, 200) };
      _initStarted = false;
      return false;
    }
  };

  run().catch((e) => {
    _lastInitErr = { kind: 'exception', msg: String(e?.message || e).slice(0, 200) };
    _initStarted = false;
  });

  return true;
}

export function retryAdsInit() {
  if (_sdkReady) return true;
  _initStarted = false;
  return initAds();
}
