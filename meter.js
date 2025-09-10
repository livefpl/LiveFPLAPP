// meter.js
// Session-only counter + safe gate. No React, no side effects.
// Not wired to any ad provider until you call setTrigger().

let _counter = 0;
let _state = 'idle'; // 'idle' | 'loading_ad' | 'cooldown'
let _lastShownAt = 0;
let _cooldownTimer = null;

const _dedupe = new Map(); // key -> timestamp

const _cfg = {
  N: 10,                 // show after every N bumps
  cooldownMs: 10_000,    // block back-to-back shows
  dedupeTtlMs: 2_000,   // ignore same key within this window
};

// Default no-op trigger so importing this file does nothing visible.
let _trigger = async () => ({ shown: false, provider: 'noop' });

const now = () => Date.now();

function _withinTtl(ts, ttl) {
  return ts && now() - ts < ttl;
}

function _markDedupe(key) {
  if (!key) return;
  _dedupe.set(key, now());
}

function _isDeduped(key) {
  if (!key) return false;
  const ts = _dedupe.get(key) || 0;
  return _withinTtl(ts, _cfg.dedupeTtlMs);
}

export function setConfig(partial = {}) {
  if (typeof partial.N === 'number' && partial.N > 0) _cfg.N = Math.floor(partial.N);
  if (typeof partial.cooldownMs === 'number' && partial.cooldownMs >= 0) _cfg.cooldownMs = Math.floor(partial.cooldownMs);
  if (typeof partial.dedupeTtlMs === 'number' && partial.dedupeTtlMs >= 0) _cfg.dedupeTtlMs = Math.floor(partial.dedupeTtlMs);
  return { ..._cfg };
}

export function setTrigger(fn) {
  if (typeof fn === 'function') _trigger = fn;
  return !!fn;
}

export function getState() {
  return {
    counter: _counter,
    state: _state,
    lastShownAt: _lastShownAt,
    config: { ..._cfg },
  };
}

export function reset() {
  _counter = 0;
  _state = 'idle';
  _lastShownAt = 0;
  if (_cooldownTimer) clearTimeout(_cooldownTimer);
  _cooldownTimer = null;
  _dedupe.clear();
}

export async function bump(opts = {}) {
  const { source = 'unknown', key, force = false } = opts;

  // Optional dedupe for noisy actions
  if (!force && _isDeduped(key)) {
    return { counter: _counter, fired: false, reason: 'deduped' };
  }
  _markDedupe(key);

  _counter += 1;

  // Only consider firing when idle and threshold reached
  const atThreshold = _cfg.N > 0 && _counter % _cfg.N === 0;
  if (!atThreshold || _state !== 'idle') {
    return { counter: _counter, fired: false, reason: _state !== 'idle' ? _state : 'threshold_not_hit' };
  }

  _state = 'loading_ad';
  try {
    await Promise.resolve(_trigger({ count: _counter, source }));
  } catch {
    // Swallow errors; we always proceed to cooldown to avoid loops
  } finally {
    _state = 'cooldown';
    _lastShownAt = now();
    if (_cooldownTimer) clearTimeout(_cooldownTimer);
    _cooldownTimer = setTimeout(() => {
      _state = 'idle';
      _cooldownTimer = null;
    }, _cfg.cooldownMs);
  }

  return { counter: _counter, fired: true, reason: 'threshold' };
}
