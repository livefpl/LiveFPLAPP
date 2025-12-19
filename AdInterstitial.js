// AdInterstitial.js
// Production-safe Playwire interstitial controller:
// - single-flight showOnce()
// - cooldown
// - SDK-init gate (markPlaywireInitialized must be called from Playwire.initializeSDK callback)
// - NO user-visible debug UI, NO console logs
//
// Pro/ads gating:
//   Use setAdGuard(() => isPro) from your ProContext (source of truth).
//   If the guard returns true, interstitials will never show.

import { Playwire } from '@intergi/react-native-playwire-sdk';

const INTERSTITIAL_ALIAS = 'interstitial'; // must match your Playwire alias exactly

// -------- state --------
let inflight = null;

// Cooldown
let _minIntervalMs = 90_000;
let _lastShownAt = 0;

// Optional external guard (e.g. Pro status)
let _adGuard = null;

// Interstitial local state
let _ready = false;
let _loading = false;
let _loadWaiters = []; // [{ resolve, timeoutId }]
let _listenersInstalled = false;

// -------- debug state (internal; you can subscribe if you want) --------
// Note: this is NOT shown to users unless you build UI for it.
const _dbg = {
  alias: INTERSTITIAL_ALIAS,
  initializedHint: 'unknown', // 'yes' after markPlaywireInitialized()
  ready: false,
  loading: false,
  inflight: false,
  minIntervalMs: _minIntervalMs,
  lastEvent: 'none', // loaded | failed_to_load | opened | closed | failed_to_open | load_called | show_called | load_timeout | sdk_not_ready | ...
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
    alias: INTERSTITIAL_ALIAS,
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

// Call this from Playwire.initializeSDK callback (your playwireInit.js already does this).
export function markPlaywireInitialized() {
  _dbg.initializedHint = 'yes';
  _mark('sdk_initialized');
}

// -------- Playwire helpers --------
function _wrapGetReady(adUnitId) {
  return new Promise((resolve) => {
    try {
      Playwire.getInterstitialReady(adUnitId, (isReady) => {
        _dbg.lastReadyCheck = !!isReady;
        _dbg.lastReadyCheckAt = Date.now();
        _emit();
        resolve(!!isReady);
      });
    } catch {
      _dbg.lastReadyCheck = false;
      _dbg.lastReadyCheckAt = Date.now();
      _emit();
      resolve(false);
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
  _listenersInstalled = true;

  try {
    Playwire.addInterstitialLoadedEventListener((adUnitId) => {
      if (adUnitId !== INTERSTITIAL_ALIAS) return;
      _ready = true;
      _loading = false;
      _mark('loaded');

      const waiters = _loadWaiters;
      _loadWaiters = [];
      _resolveAll(waiters, true);
    });

    Playwire.addInterstitialFailedToLoadEventListener((adUnitId) => {
      if (adUnitId !== INTERSTITIAL_ALIAS) return;
      _ready = false;
      _loading = false;
      _mark('failed_to_load', { lastFailAlias: adUnitId });

      const waiters = _loadWaiters;
      _loadWaiters = [];
      _resolveAll(waiters, false);
    });

    Playwire.addInterstitialOpenedEventListener((adUnitId) => {
      if (adUnitId !== INTERSTITIAL_ALIAS) return;
      _mark('opened');
    });

    Playwire.addInterstitialClosedEventListener((adUnitId) => {
      if (adUnitId !== INTERSTITIAL_ALIAS) return;
      _mark('closed');
      _ready = false; // consumed
      _emit();
    });

    Playwire.addInterstitialFailedToOpenEventListener((adUnitId) => {
      if (adUnitId !== INTERSTITIAL_ALIAS) return;
      _ready = false;
      _mark('failed_to_open');
      _emit();
    });
  } catch {
    // If listener wiring throws, we silently continue (production-safe).
  }
}

async function _ensureLoaded({ timeoutMs = 12_000 } = {}) {
  _installListenersOnce();

  // Hard gate: do not call Playwire load/getReady until SDK init callback has fired
  if (_dbg.initializedHint !== 'yes') {
    _mark('sdk_not_ready');
    return false;
  }

  if (_ready) return true;

  // If SDK says ready, accept it.
  const sdkReady = await _wrapGetReady(INTERSTITIAL_ALIAS);
  if (sdkReady) {
    _ready = true;
    _emit();
    return true;
  }

  // If already loading, wait.
  if (_loading) {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => resolve(false), timeoutMs);
      _loadWaiters.push({ resolve, timeoutId });
    });
  }

  _loading = true;
  _dbg.lastLoadCallAt = Date.now();
  _mark('load_called');

  try {
    Playwire.loadInterstitial(INTERSTITIAL_ALIAS);
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

// -------- Public API --------
export function configureAds({ minIntervalMs } = {}) {
  if (typeof minIntervalMs === 'number') _minIntervalMs = Math.max(0, minIntervalMs);
  _dbg.minIntervalMs = _minIntervalMs;
  _emit();
}

// If fn() returns true => block ads (e.g. user is Pro)
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
  // External guard (Pro, etc.)
  try {
    if (_adGuard && _adGuard()) {
      _dbg.lastResult = { shown: false, provider: 'guard' };
      _dbg.lastReason = reason || '';
      _emit();
      return _dbg.lastResult;
    }
  } catch {}

  // Cooldown
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

      // SDK init gate
      if (_dbg.initializedHint !== 'yes') {
        _dbg.lastResult = { shown: false, provider: 'sdk', reason: 'sdk_not_ready' };
        _mark('sdk_not_ready');
        return _dbg.lastResult;
      }

      const readyBefore = await _wrapGetReady(INTERSTITIAL_ALIAS);
      const ready = readyBefore ? true : await _ensureLoaded({ timeoutMs: 12_000 });

      if (!ready) {
        _dbg.lastResult = { shown: false, provider: 'playwire', reason: 'not_ready_after_wait' };
        _mark('not_ready_after_wait');
        return _dbg.lastResult;
      }

      _dbg.lastShowCallAt = Date.now();
      _mark('show_called');

      try {
        Playwire.showInterstitial(INTERSTITIAL_ALIAS);
      } catch {
        _ready = false;
        _dbg.lastResult = { shown: false, provider: 'playwire', reason: 'show_throw' };
        _mark('failed_to_open');
        return _dbg.lastResult;
      }

      _lastShownAt = Date.now();
      _dbg.lastShownAt = _lastShownAt;

      // One-time-use: request next (silent best-effort)
      _ready = false;
      _emit();
      setTimeout(() => {
        try {
          preloadInterstitial();
        } catch {}
      }, 400);

      _dbg.lastResult = { shown: true, provider: 'playwire' };
      _emit();
      return _dbg.lastResult;
    } finally {
      inflight = null;
      _emit();
    }
  })();

  return inflight;
}
