// AdInterstitial.js
// Playwire interstitial implementation (single-flight + Pro guard + cooldown)
// + visible debug state via subscribeInterstitialDebug().
// Tap/long-press HUD in ad.js can call preload/show to debug easily.

import { Platform } from 'react-native';
import Purchases from 'react-native-purchases';
import { Playwire } from '@intergi/react-native-playwire-sdk';

const INTERSTITIAL_ALIAS = 'interstitial'; // confirm exact alias with Playwire

let inflight = null;

// Cooldown
let _minIntervalMs = 90_000;
let _lastShownAt = 0;

// Optional external guard
let _adGuard = null;

// RevenueCat (iOS only)
const ENTITLEMENT_ID = 'Premium';
let _cachedIsPro = false;
let _lastProCheckAt = 0;
const _proTtlMs = 5 * 60_000;

// Interstitial local state
let _ready = false;
let _loading = false;
let _loadWaiters = []; // [{resolve,timeoutId}]
let _listenersInstalled = false;

// ---------- Debug state ----------
const _dbg = {
  alias: INTERSTITIAL_ALIAS,
  initializedHint: 'unknown', // set to 'yes' by markPlaywireInitialized()
  ready: false,
  loading: false,
  inflight: false,
  minIntervalMs: _minIntervalMs,
  lastEvent: 'none',          // loaded | failed_to_load | opened | closed | failed_to_open | load_called | show_called | load_timeout | sdk_not_ready | ...
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
    try { fn(s); } catch {}
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
  try { fn(_snapshot()); } catch {}
  return () => _dbgSubs.delete(fn);
}

// Call this from Playwire.initializeSDK callback
export function markPlaywireInitialized() {
  _dbg.initializedHint = 'yes';
  _mark('sdk_initialized');
}

// ---------------- RevenueCat ----------------
async function isProViaRevenueCat() {
  if (Platform.OS !== 'ios') return false;
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

// ---------------- Playwire helpers ----------------
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
    console.log('[Playwire] Interstitial opened:', adUnitId);
  });

  Playwire.addInterstitialClosedEventListener((adUnitId) => {
    if (adUnitId !== INTERSTITIAL_ALIAS) return;
    _mark('closed');
    console.log('[Playwire] Interstitial closed:', adUnitId);
    _ready = false; // consumed
    _emit();
  });

  Playwire.addInterstitialFailedToOpenEventListener((adUnitId) => {
    if (adUnitId !== INTERSTITIAL_ALIAS) return;
    _ready = false;
    _mark('failed_to_open');
    console.log('[Playwire] Interstitial failed to open:', adUnitId);
  });
}

async function _ensureLoaded({ timeoutMs = 12_000 } = {}) {
  _installListenersOnce();

  // Hard gate: do not call Playwire load/getReady until SDK init callback has fired
  if (_dbg.initializedHint !== 'yes') {
    _mark('sdk_not_ready');
    return false;
  }

  if (_ready) return true;

  const sdkReady = await _wrapGetReady(INTERSTITIAL_ALIAS);
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
  // Optional guard
  try {
    if (_adGuard && _adGuard()) {
      _dbg.lastResult = { shown: false, provider: 'guard' };
      _dbg.lastReason = reason || '';
      _emit();
      return _dbg.lastResult;
    }
  } catch {}

  // Pro check
  if (await isProViaRevenueCat()) {
    _dbg.lastResult = { shown: false, provider: 'pro' };
    _dbg.lastReason = reason || '';
    _emit();
    return _dbg.lastResult;
  }

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

      // Hard gate again for show path
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

      Playwire.showInterstitial(INTERSTITIAL_ALIAS);

      _lastShownAt = Date.now();
      _dbg.lastShownAt = _lastShownAt;

      // One-time-use: request next
      _ready = false;
      _loading = true;
      _dbg.lastLoadCallAt = Date.now();
      _mark('reload_after_show');

      try {
        Playwire.loadInterstitial(INTERSTITIAL_ALIAS);
      } catch {
        _loading = false;
        _emit();
      }

      _dbg.lastResult = { shown: true, provider: 'playwire' };
      _emit();
      return _dbg.lastResult;
    } catch {
      _dbg.lastResult = { shown: false, provider: 'playwire', reason: 'error' };
      _mark('error');
      return _dbg.lastResult;
    } finally {
      inflight = null;
      _emit();
    }
  })();

  return inflight;
}
