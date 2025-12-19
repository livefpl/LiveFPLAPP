// ad.js
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { PlaywireBannerView } from '@intergi/react-native-playwire-sdk';
import { useColors } from './theme';
import { usePro } from './ProContext';
import { getInterstitialDebugState } from './AdInterstitial';

export const AD_FOOTER_HEIGHT = 50;

const BANNER_SIZE = { width: 320, height: 50 };
const AD_ALIAS = 'banner-320x50';
const TIMEOUT_MS = 18000;

export default function AdFooter() {
  const C = useColors();
  const { isPro } = usePro();

  // Hard gate: Pro users see absolutely nothing ad-related.
  if (isPro) return null;

  // We reuse the existing “SDK initialized hint” (set by markPlaywireInitialized())
  const [sdkReady, setSdkReady] = useState(() => getInterstitialDebugState().initializedHint === 'yes');

  // Poll lightly until sdk is ready (no UI, no logs). This avoids mounting banner too early.
  useEffect(() => {
    if (sdkReady) return;
    let mounted = true;
    const t0 = Date.now();

    const tick = () => {
      if (!mounted) return;
      const s = getInterstitialDebugState();
      const ok = s.initializedHint === 'yes';
      if (ok) {
        setSdkReady(true);
        return;
      }
      if (Date.now() - t0 > TIMEOUT_MS) return; // give up silently
      setTimeout(tick, 350);
    };

    tick();
    return () => {
      mounted = false;
    };
  }, [sdkReady]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          height: AD_FOOTER_HEIGHT,
          backgroundColor: C.bg,
          borderTopWidth: 1,
          borderTopColor: C.border,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 8,
        },
        bannerFrame: {
          width: BANNER_SIZE.width,
          height: BANNER_SIZE.height,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          backgroundColor: 'transparent',
        },
      }),
    [C]
  );

  // If SDK isn't ready yet, keep the reserved space but render nothing (no user-facing text).
  if (!sdkReady) {
    return <View style={styles.container} />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.bannerFrame}>
        <PlaywireBannerView
          adUnitId={AD_ALIAS}
          size={BANNER_SIZE}
          style={{ width: BANNER_SIZE.width, height: BANNER_SIZE.height }}
        />
      </View>
    </View>
  );
}
