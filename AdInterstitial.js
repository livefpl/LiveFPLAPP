// AdInterstitial.js
// Playwire interstitial implementation (single-flight + Pro guard + cooldown).
// Adds visible in-app debug via subscribeInterstitialStatus().

import { Platform } from 'react-native';
import Purchases from 'react-native-purchases';
import { Playwire } from '@intergi/react-native-playwire-sdk';

// ✅ Your alias
const INTERSTITIAL_ALIAS = 'interstitial';

let inflight = null;

// Cooldown to avoid spamming interstitials
let _minIntervalMs = 90_000; // 90s
let _lastShownAt = 0;

// Optional external guard; if it returns true -> suppress ads (kept for compatibility)
let _adGuard = null;

// Entitlement ID in RevenueCat (case-sensitive)
const ENTITLEMENT_ID = 'Premium';

// Small cache so we don't hit RC every time
let _cachedIsPro = false;
let _lastProCheckAt = 0;
const _proTtlMs = 5 * 60_000; // 5 minutes

// Basic interstitial state
let _ready = false;
let _loading = false;
let _loadWaiters = []; // [{resolve,timeoutId}]
let _listenersInstalled = false;

// ---------------- Visible Debug Status ----------------
let _status = {
  phase: 'idle', // 'idle'|'loading'|'loaded'|'failed'|'showing'|'opened'|'closed'
  alias: INTERSTITIAL_ALIAS,
  ready: false,
  loading: false,
  lastError: '',
  lastReason: '',
  lastEventAt: 0,
  lastShownAt: 0,
};

const _subs = new Set();

function _emit(patch = {}) {
  _status = {
    ..._status,
    ...patch,
    alias: INTERSTITIAL_ALIAS,
    ready: _ready,
    loading: _loading,
    lastEventAt: Date.now(),
    lastShownAt: _lastShownAt,
  };
  for (const fn of _subs) {
    try {
      fn(_status);
    } catch {}
  }
}

export function getInterstitialStatus() {
  return _status;
}

export function subscribeInterstitialStatus(fn) {
  if (typeof fn !== 'function') return () => {};
  _subs.add(fn);
  try {
    fn(_status);
  } catch {}
  return () => _subs.delete(fn);
}
// ------------------------------------------------------

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
    _cachedIsPro = false;
    _lastProCheckAt = now;
    return false;
  }
}

function _wrapGetReady(adUnitId) {
  return new Promise((resolve) => {
    try {
      Playwire.getInterstitialReady(adUnitId, (isReady) => resolve(!!isReady));
    } catch {
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

  Playwire.addInterstitialLoadedEventListener((adUnitId) => {
    if (adUnitId !== INTERSTITIAL_ALIAS) return;
    _ready = true;
    _loading = false;
    _emit({ phase: 'loaded', lastError: '' });

    const waiters = _loadWaiters;
    _loadWaiters = [];
    _resolveAll(waiters, true);
  });

  Playwire.addInterstitialFailedToLoadEventListener((adUnitId) => {
    if (adUnitId !== INTERSTITIAL_ALIAS) return;
    _ready = false;
    _loading = false;
    _emit({ phase: 'failed', lastError: 'failed_to_load' });

    const waiters = _loadWaiters;
    _loadWaiters = [];
    _resolveAll(waiters, false);
  });

  Playwire.addInterstitialOpenedEventListener((adUnitId) => {
    if (adUnitId !== INTERSTITIAL_ALIAS) return;
    _emit({ phase: 'opened', lastError: '' });
    console.log('[Playwire] Interstitial opened:', adUnitId);
  });

  Playwire.addInterstitialClosedEventListener((adUnitId) => {
    if (adUnitId !== INTERSTITIAL_ALIAS) return;
    _emit({ phase: 'closed', lastError: '' });

    // After close, interstitial is typically consumed; we keep _ready=false
    _ready = false;
    console.log('[Playwire] Interstitial closed:', adUnitId);
  });

  Playwire.addInterstitialFailedToOpenEventListener((adUnitId) => {
    if (adUnitId !== INTERSTITIAL_ALIAS) return;
    _ready = false;
    _emit({ phase: 'failed', lastError: 'failed_to_open' });
    console.log('[Playwire] Interstitial failed to open:', adUnitId);
  });
}

async function _ensureLoaded({ timeoutMs = 12_000 } = {}) {
  _installListenersOnce();

  if (_ready) return true;

  const sdkReady = await _wrapGetReady(INTERSTITIAL_ALIAS);
  if (sdkReady) {
    _ready = true;
    _emit({ phase: 'loaded', lastError: '' });
    return true;
  }

  if (_loading) {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => resolve(false), timeoutMs);
      _loadWaiters.push({ resolve, timeoutId });
    });
  }

  _loading = true;
  _emit({ phase: 'loading', lastError: '' });

  try {
    Playwire.loadInterstitial(INTERSTITIAL_ALIAS);
  } catch {
    _loading = false;
    _emit({ phase: 'failed', lastError: 'load_throw' });
    return false;
  }

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      _loading = false;
      _emit({ phase: 'failed', lastError: 'load_timeout' });
      resolve(false);
    }, timeoutMs);

    _loadWaiters.push({ resolve, timeoutId });
  });
}

/** Configure interstitials (cooldown). */
export function configureAds({ minIntervalMs } = {}) {
  if (typeof minIntervalMs === 'number') _minIntervalMs = Math.max(0, minIntervalMs);
}

/** Optional guard. If it returns true, ads are suppressed. */
export function setAdGuard(fn) {
  _adGuard = typeof fn === 'function' ? fn : null;
}

/** Returns true if an interstitial is currently inflight/showing */
export function isShowing() {
  return !!inflight;
}

/** Optional: call once after Playwire.initializeSDK(...) to preload. */
export async function preloadInterstitial() {
  _emit({ phase: 'loading', lastError: '', lastReason: 'preload' });
  return _ensureLoaded({ timeoutMs: 1 });
}

/**
 * showOnce({ reason, force })
 */
export async function showOnce({ reason, force } = {}) {
  // Guard first (optional)
  try {
    if (_adGuard && _adGuard()) {
      _emit({ phase: 'idle', lastError: 'guard', lastReason: reason || '' });
      return { shown: false, provider: 'guard' };
    }
  } catch {}

  // Premium check via RevenueCat (iOS only)
  if (await isProViaRevenueCat()) {
    _emit({ phase: 'idle', lastError: 'pro', lastReason: reason || '' });
    return { shown: false, provider: 'pro' };
  }

  // Cooldown
  if (!force) {
    const now = Date.now();
    if (now - _lastShownAt < _minIntervalMs) {
      _emit({ phase: 'idle', lastError: 'cooldown', lastReason: reason || '' });
      return { shown: false, provider: 'cooldown' };
    }
  }

  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const readyBefore = await _wrapGetReady(INTERSTITIAL_ALIAS);
      const ready = readyBefore ? true : await _ensureLoaded({ timeoutMs: 12_000 });

      if (!ready) {
        _emit({ phase: 'failed', lastError: readyBefore ? 'not_ready' : 'not_ready_after_wait', lastReason: reason || '' });
        return { shown: false, provider: 'playwire', reason: 'not_ready' };
      }

      _emit({ phase: 'showing', lastError: '', lastReason: reason || '' });

      Playwire.showInterstitial(INTERSTITIAL_ALIAS);

      _lastShownAt = Date.now();
      _emit({ phase: 'showing', lastError: '', lastReason: reason || '' });

      // Consumed: mark not ready and start loading the next one
      _ready = false;
      _loading = false;
      try {
        _loading = true;
        _emit({ phase: 'loading', lastError: '', lastReason: 'reload_after_show' });
        Playwire.loadInterstitial(INTERSTITIAL_ALIAS);
      } catch {
        _loading = false;
        _emit({ phase: 'failed', lastError: 'reload_throw', lastReason: 'reload_after_show' });
      }

      return { shown: true, provider: 'playwire' };
    } catch {
      _emit({ phase: 'failed', lastError: 'show_error', lastReason: reason || '' });
      return { shown: false, provider: 'playwire', reason: 'error' };
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
