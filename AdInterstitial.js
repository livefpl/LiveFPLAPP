// AdInterstitial.js
// Production-safe AppLovin MAX interstitial controller for the Freestar test build:
// - single-flight showOnce()
// - cooldown
// - SDK-init gate (markAdsInitialized must be called after MAX initialize)
// - NO user-visible debug UI, NO console logs
//
// Pro/ads gating:
//   Use setAdGuard(() => isPro) from your ProContext (source of truth).
//   If the guard returns true, interstitials will never show.

import { INTERSTITIAL_AD_UNIT_ID } from './adsConfig';

function _getMax() {
  try {
    return require('react-native-applovin-max');
  } catch {
    return null;
  }
}

function _getInterstitialAd() {
  const max = _getMax();
  return max?.InterstitialAd || null;
}

// -------- state --------
let inflight = null;

// Cooldown
let _minIntervalMs = 5_000;
let _lastShownAt = 0;

// Optional external guard (e.g. Pro status)
let _adGuard = null;

// Interstitial local state
let _ready = false;
let _loading = false;
let _loadWaiters = []; // [{ resolve, timeoutId }]
let _listenersInstalled = false;

const _dbg = {
  alias: INTERSTITIAL_AD_UNIT_ID,
  initializedHint: 'unknown',
  ready: false,
  loading: false,
  inflight: false,
  minIntervalMs: _minIntervalMs,
  lastEvent: 'none',
  lastEventAt: 0,
  lastReadyCheck: null,
  lastReadyCheckAt: 0,
  lastLoadCallAt: 0,
  lastShowCallAt: 0,
  lastFailAlias: null,
  lastReason: '',
  lastResult: null,
  lastShownAt: 0,
};

const _dbgSubs = new Set();

function _snapshot() {
  return {
    ..._dbg,
    alias: INTERSTITIAL_AD_UNIT_ID,
    ready: _ready,
    loading: _loading,
    inflight: !!inflight,
    minIntervalMs: _minIntervalMs,
    lastShownAt: _lastShownAt,
  };
}

function _emit() {
  const s = _snapshot();
  for (const fn of _dbgSubs) {
    try {
      fn(s);
    } catch {}
  }
}

function _mark(event, extra = {}) {
  _dbg.lastEvent = event;
  _dbg.lastEventAt = Date.now();
  Object.assign(_dbg, extra);
  _emit();
}

export function getInterstitialDebugState() {
  return _snapshot();
}

export function subscribeInterstitialDebug(fn) {
  if (typeof fn !== 'function') return () => {};
  _dbgSubs.add(fn);
  try {
    fn(_snapshot());
  } catch {}
  return () => _dbgSubs.delete(fn);
}

export function markAdsInitialized() {
  _dbg.initializedHint = 'yes';
  _mark('sdk_initialized');
}

function _adUnitMatches(info) {
  const id = info?.adUnitId || info?.adUnitIdentifier || '';
  return !id || id === INTERSTITIAL_AD_UNIT_ID;
}

function _wrapGetReady(timeoutMs = 900) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      clearTimeout(tid);
      resolve(!!val);
    };

    const tid = setTimeout(() => {
      _dbg.lastReadyCheck = false;
      _dbg.lastReadyCheckAt = Date.now();
      _mark('ready_check_timeout');
      finish(false);
    }, timeoutMs);

    const InterstitialAd = _getInterstitialAd();
    if (!InterstitialAd?.isAdReady) {
      finish(false);
      return;
    }
    try {
      Promise.resolve(InterstitialAd.isAdReady(INTERSTITIAL_AD_UNIT_ID))
        .then((isReady) => {
          _dbg.lastReadyCheck = !!isReady;
          _dbg.lastReadyCheckAt = Date.now();
          _emit();
          finish(!!isReady);
        })
        .catch(() => {
          _dbg.lastReadyCheck = false;
          _dbg.lastReadyCheckAt = Date.now();
          _emit();
          finish(false);
        });
    } catch {
      _dbg.lastReadyCheck = false;
      _dbg.lastReadyCheckAt = Date.now();
      _emit();
      finish(false);
    }
  });
}

function _resolveAll(waiters, val) {
  waiters.forEach((w) => {
    if (w.timeoutId) clearTimeout(w.timeoutId);
    w.resolve(val);
  });
}

function _installListenersOnce() {
  if (_listenersInstalled) return;
  const InterstitialAd = _getInterstitialAd();
  if (!InterstitialAd) return;
  _listenersInstalled = true;

  try {
    InterstitialAd.addAdLoadedEventListener((adInfo) => {
      if (!_adUnitMatches(adInfo)) return;
      _ready = true;
      _loading = false;
      _mark('loaded');

      const waiters = _loadWaiters;
      _loadWaiters = [];
      _resolveAll(waiters, true);
    });

    InterstitialAd.addAdLoadFailedEventListener((errorInfo) => {
      if (!_adUnitMatches(errorInfo)) return;
      _ready = false;
      _loading = false;
      _mark('failed_to_load', {
        lastFailAlias: errorInfo?.adUnitId || INTERSTITIAL_AD_UNIT_ID,
        lastReason: String(errorInfo?.message || errorInfo?.code || '').slice(0, 160),
      });

      const waiters = _loadWaiters;
      _loadWaiters = [];
      _resolveAll(waiters, false);
    });

    const onDisplayed =
      InterstitialAd.addAdDisplayedEventListener || InterstitialAd.addAdOpenedEventListener;
    if (onDisplayed) {
      onDisplayed((adInfo) => {
        if (!_adUnitMatches(adInfo)) return;
        _mark('opened');
      });
    }

    const onHidden =
      InterstitialAd.addAdHiddenEventListener || InterstitialAd.addAdClosedEventListener;
    if (onHidden) {
      onHidden((adInfo) => {
        if (!_adUnitMatches(adInfo)) return;
        _mark('closed');
        _ready = false;
        _emit();
      });
    }

    const onFailedDisplay =
      InterstitialAd.addAdFailedToDisplayEventListener ||
      InterstitialAd.addAdDisplayFailedEventListener;
    if (onFailedDisplay) {
      onFailedDisplay((errorInfo) => {
        if (!_adUnitMatches(errorInfo)) return;
        _ready = false;
        _mark('failed_to_open');
        _emit();
      });
    }
  } catch {
    // If listener wiring throws, we silently continue (production-safe).
  }
}

async function _ensureLoaded({ timeoutMs = 12_000 } = {}) {
  _installListenersOnce();

  if (_dbg.initializedHint !== 'yes') {
    _mark('sdk_not_ready');
    return false;
  }

  if (_ready) return true;

  const sdkReady = await _wrapGetReady();
  if (sdkReady) {
    _ready = true;
    _emit();
    return true;
  }

  if (_loading) {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => resolve(false), timeoutMs);
      _loadWaiters.push({ resolve, timeoutId });
    });
  }

  _loading = true;
  _dbg.lastLoadCallAt = Date.now();
  _mark('load_called');

  const InterstitialAd = _getInterstitialAd();
  if (!InterstitialAd?.loadAd) {
    _loading = false;
    _mark('failed_to_load', { lastFailAlias: 'sdk_skip' });
    return false;
  }
  try {
    InterstitialAd.loadAd(INTERSTITIAL_AD_UNIT_ID);
  } catch {
    _loading = false;
    _mark('failed_to_load', { lastFailAlias: 'load_throw' });
    return false;
  }

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      _loading = false;
      _mark('load_timeout');
      resolve(false);
    }, timeoutMs);

    _loadWaiters.push({ resolve, timeoutId });
  });
}

export function configureAds({ minIntervalMs } = {}) {
  if (typeof minIntervalMs === 'number') _minIntervalMs = Math.max(0, minIntervalMs);
  _dbg.minIntervalMs = _minIntervalMs;
  _emit();
}

export function setAdGuard(fn) {
  _adGuard = typeof fn === 'function' ? fn : null;
}

export function isShowing() {
  return !!inflight;
}

export async function preloadInterstitial() {
  _dbg.lastReason = 'preload';
  _emit();
  const ok = await _ensureLoaded({ timeoutMs: 12_000 });
  return ok;
}

export async function showOnce({ reason, force } = {}) {
  try {
    if (_adGuard && _adGuard()) {
      _dbg.lastResult = { shown: false, provider: 'guard' };
      _dbg.lastReason = reason || '';
      _emit();
      return _dbg.lastResult;
    }
  } catch {}

  if (!force) {
    const now = Date.now();
    if (now - _lastShownAt < _minIntervalMs) {
      _dbg.lastResult = { shown: false, provider: 'cooldown' };
      _dbg.lastReason = reason || '';
      _emit();
      return _dbg.lastResult;
    }
  }

  if (inflight) return inflight;

  inflight = (async () => {
    try {
      _dbg.lastReason = reason || '';
      _emit();

      if (_dbg.initializedHint !== 'yes') {
        _dbg.lastResult = { shown: false, provider: 'sdk', reason: 'sdk_not_ready' };
        _mark('sdk_not_ready');
        return _dbg.lastResult;
      }

      const readyBefore = await _wrapGetReady();
      const ready = readyBefore ? true : await _ensureLoaded({ timeoutMs: 12_000 });

      if (!ready) {
        _dbg.lastResult = { shown: false, provider: 'max', reason: 'not_ready_after_wait' };
        _mark('not_ready_after_wait');
        return _dbg.lastResult;
      }

      _dbg.lastShowCallAt = Date.now();
      _mark('show_called');

      const InterstitialAd = _getInterstitialAd();
      if (!InterstitialAd?.showAd) {
        _dbg.lastResult = { shown: false, provider: 'max', reason: 'sdk_skip' };
        return _dbg.lastResult;
      }
      try {
        InterstitialAd.showAd(INTERSTITIAL_AD_UNIT_ID);
      } catch {
        _ready = false;
        _dbg.lastResult = { shown: false, provider: 'max', reason: 'show_throw' };
        _mark('failed_to_open');
        return _dbg.lastResult;
      }

      _lastShownAt = Date.now();
      _dbg.lastShownAt = _lastShownAt;

      _ready = false;
      _emit();
      setTimeout(() => {
        try {
          preloadInterstitial();
        } catch {}
      }, 400);

      _dbg.lastResult = { shown: true, provider: 'max' };
      _emit();
      return _dbg.lastResult;
    } finally {
      inflight = null;
      _emit();
    }
  })();

  return inflight;
}
