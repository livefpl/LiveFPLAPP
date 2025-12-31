// ad.js
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { PlaywireBannerView } from '@intergi/react-native-playwire-sdk';
import { usePro } from './ProContext';
import { getInterstitialDebugState } from './AdInterstitial';
import { ThemeProvider, useTheme, useColors } from './theme';
import { onPlaywireReady } from './playwireInit';

export const AD_FOOTER_HEIGHT = 50;

const BANNER_SIZE = { width: 320, height: 50 };
const AD_ALIAS = 'banner-320x50';
const TIMEOUT_MS = 18000;

export default function AdFooter() {
  const C = useColors();
  const { isPro } = usePro();
const { navTheme } = useTheme();
const isDark = navTheme?.dark;

  // Hard gate: Pro users see absolutely nothing ad-related.
  if (isPro) return null;

  // We reuse the existing “SDK initialized hint” (set by markPlaywireInitialized())
  const [sdkReady, setSdkReady] = useState(() => getInterstitialDebugState().initializedHint === 'yes');
  // Delay mounting the native banner view a bit to avoid cold-start native crashes
  const [canMountBanner, setCanMountBanner] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setCanMountBanner(true), 1500);
    return () => clearTimeout(t);
  }, []);

    // If banners stay blank, force a remount occasionally to trigger a fresh request.
  const [bannerKey, setBannerKey] = useState(0);

 useEffect(() => {
  if (!canMountBanner || !sdkReady) return;


  let tries = 0;
  let stopped = false;
  let intervalId = null;

  const startTimer = setTimeout(() => {
    if (stopped) return;

    intervalId = setInterval(() => {
      tries += 1;
      setBannerKey((k) => k + 1);

      if (tries >= 6) {
        clearInterval(intervalId);
        intervalId = null;
        stopped = true;
      }
    }, 20_000);
  }, 12_000);

  return () => {
    stopped = true;
    clearTimeout(startTimer);
    if (intervalId) clearInterval(intervalId);
  };
}, [canMountBanner,sdkReady]);

  useEffect(() => {
  if (sdkReady) return;
  onPlaywireReady(() => setSdkReady(true));
}, [sdkReady]);


  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
  height: AD_FOOTER_HEIGHT,
  backgroundColor: isDark ? '#ced4da' : '#ffffff',
       // <- force light background so ad text stays visible
  borderTopWidth: 1,
  borderTopColor: 'rgba(0,0,0,0.12)', // <- neutral border (don’t use C.border)
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
    [C,isDark]
  );

    if (!canMountBanner || !sdkReady) {
    return <View style={styles.container} />;
  }


  return (
    <View style={styles.container}>
      <View style={styles.bannerFrame}>
        <PlaywireBannerView
        key={`pw_banner_${bannerKey}`}
          adUnitId={AD_ALIAS}
          size={BANNER_SIZE}
          style={{ width: BANNER_SIZE.width, height: BANNER_SIZE.height }}
        />
      </View>
    </View>
  );
}
