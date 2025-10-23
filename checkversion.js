// checkversion.js
import React, { useEffect, useRef, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Platform,
  AppState,
  Text,
  ActivityIndicator,
  TouchableOpacity,
  Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setConfig } from './meter';

const STORAGE_LAST_CHECK = 'version.lastCheckAt';
const STORAGE_LAST_SEEN  = 'version.lastSeen';

export default function ForceUpdateGate({
  children,
  localBuild,
  configUrl,
  updateUrl,
  defaultRemote,
  pollEveryMs = 60 * 60 * 1000,       // hourly while foregrounded
  foregroundThrottleMs = 5 * 60 * 1000, // min spacing between resume checks
}) {
  const [checked, setChecked] = useState(false);
  const [mustUpdate, setMustUpdate] = useState(false);
  const [storeUrl, setStoreUrl] = useState(null);

  const inFlight = useRef(null);
  const appState = useRef(AppState.currentState);
  const intervalRef = useRef(null);
  const lastResumeCheckAtRef = useRef(0);

  const decide = (remoteVersion, payload) => {
    const rv = Number(remoteVersion);
    const effective = Number.isFinite(rv) ? rv : Number(defaultRemote);

    setMustUpdate(Number.isFinite(effective) ? localBuild < effective : false);

    const m = payload && typeof payload === 'object' ? payload.meter : null;
    if (m && typeof m === 'object') {
      const N = Number(m.N);
      const cooldown = Number(m.cooldown);     // seconds
      const dedupeTtl = Number(m.dedupeTtl);   // seconds
      setConfig({
        ...(Number.isFinite(N) ? { N } : {}),
        ...(Number.isFinite(cooldown) ? { cooldownMs: cooldown * 1000 } : {}),
        ...(Number.isFinite(dedupeTtl) ? { dedupeTtlMs: dedupeTtl * 1000 } : {}),
      });
    }

    const s = payload && typeof payload === 'object' ? payload.store : null;
    if (s && typeof s === 'object') {
      const platformUrl = Platform.select({ ios: s.ios, android: s.android }) || null;
      setStoreUrl(platformUrl);
    }

    setChecked(true);
  };

  const fetchVersion = async () => {
    if (inFlight.current) return inFlight.current;
    inFlight.current = (async () => {
      try {
        // Conditional fetch using ETag to get cheap 304s
        const lastSeen = JSON.parse((await AsyncStorage.getItem(STORAGE_LAST_SEEN)) || '{}');
        const headers = lastSeen.etag ? { 'If-None-Match': lastSeen.etag } : {};
        const res = await fetch(configUrl, { headers, cache: 'no-store' });

        const now = Date.now();
        await AsyncStorage.setItem(STORAGE_LAST_CHECK, String(now)).catch(() => {});

        if (res.status === 304) {
          // unchanged, keep current state (but we’re already “checked” if boot call)
          if (!checked) decide(lastSeen.version ?? defaultRemote, lastSeen.payload ?? null);
          return;
        }
        if (!res.ok) throw new Error(`Config fetch failed: ${res.status}`);

        // Accept either number or { version, meter, store }
        const data = await res.json();
        const remoteRaw = typeof data === 'number' ? data : data?.version;

        decide(remoteRaw, data);

        const etag = res.headers.get('etag') || null;
        await AsyncStorage.setItem(
          STORAGE_LAST_SEEN,
          JSON.stringify({ version: remoteRaw, etag, payload: data })
        ).catch(() => {});
      } catch {
        // Fall back to default once (only matters at boot)
        if (!checked) decide(defaultRemote, null);
      } finally {
        inFlight.current = null;
      }
    })();
    return inFlight.current;
  };

  // Boot check (same behavior as before)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await fetchVersion();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configUrl, localBuild, defaultRemote]);

  // Foreground polling: interval only while active + on resume (throttled)
  useEffect(() => {
    const startInterval = () => {
      if (intervalRef.current) return;
      intervalRef.current = setInterval(() => {
        fetchVersion();
      }, pollEveryMs);
    };
    const stopInterval = () => {
      if (!intervalRef.current) return;
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    };

    const sub = AppState.addEventListener('change', () => {
      const prev = appState.current;
      const next = AppState.currentState;
      appState.current = next;

      if (prev !== 'active' && next === 'active') {
        const now = Date.now();
        if (now - lastResumeCheckAtRef.current > foregroundThrottleMs) {
          lastResumeCheckAtRef.current = now;
          fetchVersion();
        }
        startInterval();
      } else if (next !== 'active') {
        stopInterval();
      }
    });

    if (appState.current === 'active') startInterval();

    return () => {
      sub?.remove?.();
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [pollEveryMs, foregroundThrottleMs]);

  if (!checked) {
    return (
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8, opacity: 0.6 }}>Initializing…</Text>
      </SafeAreaView>
    );
  }

  if (mustUpdate) {
    const defaultStoreUrl = Platform.select({
      ios: 'https://apps.apple.com',
      android: 'https://play.google.com/store',
    });

    return (
      <SafeAreaView style={{ flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 18, textAlign: 'center', marginBottom: 16 }}>
          A new version of LiveFPL is required to continue.
        </Text>
        <TouchableOpacity
          onPress={() => Linking.openURL(updateUrl || storeUrl || defaultStoreUrl)}
          style={{ paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10, borderWidth: 1 }}
        >
          <Text style={{ fontSize: 16 }}>Update now</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return <>{children}</>;
}
