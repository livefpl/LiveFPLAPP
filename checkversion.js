// checkversion.js
import React, { useEffect, useState } from 'react';
import { Platform, SafeAreaView, Text, ActivityIndicator, TouchableOpacity, Linking } from 'react-native';

/**
 * Props:
 *   localBuild: number
 *   configUrl: string
 *   updateUrl?: string
 *   defaultRemote: number   // ← used when fetch fails or JSON is invalid
 */
export default function ForceUpdateGate({ children, localBuild, configUrl, updateUrl, defaultRemote }) {
  const [checked, setChecked] = useState(false);
  const [mustUpdate, setMustUpdate] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const decide = (remote) => {
        const rv = Number(remote);
        const effective = Number.isFinite(rv) ? rv : Number(defaultRemote);
        setMustUpdate(Number.isFinite(effective) ? localBuild < effective : false);
        setChecked(true);
      };

      try {
        const url = `${configUrl}${configUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`Config fetch failed: ${res.status}`);
        const data = await res.json();
        const remoteRaw = (typeof data === 'number') ? data : data?.version;
        if (!cancelled) decide(remoteRaw);
      } catch {
        if (!cancelled) decide(defaultRemote); // ← fallback to coded default
      }
    })();
    return () => { cancelled = true; };
  }, [configUrl, localBuild, defaultRemote]);

  if (!checked) {
    return (
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8, opacity: 0.6 }}>Checking version…</Text>
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
          onPress={() => Linking.openURL(updateUrl || defaultStoreUrl)}
          style={{ paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10, borderWidth: 1 }}
        >
          <Text style={{ fontSize: 16 }}>Update now</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return <>{children}</>;
}
