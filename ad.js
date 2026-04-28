// ad.js — lazy-loads Playwire SDK for the banner view
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Text, Platform, TouchableOpacity, Linking } from 'react-native';
import { usePro } from './ProContext';
import { getInterstitialDebugState } from './AdInterstitial';
import { useTranslation } from 'react-i18next';
import { useTheme, useColors } from './theme';
import { useNavigation } from '@react-navigation/native';

export const AD_FOOTER_HEIGHT = 50;

function LazyPlaywireBanner(props) {
  const { PlaywireBannerView } = require('@intergi/react-native-playwire-sdk');
  return <PlaywireBannerView {...props} />;
}

const BANNER_SIZE = { width: 320, height: 50 };
const AD_ALIAS = 'banner-320x50';

// Debug HUD toggle (leave false in prod)
const AD_DEBUG_FOOTER = false;

// Watchdog: if neither load nor fail arrives within this, treat as timeout
const BANNER_TIMEOUT_MS = 10_000;

// Auto-retry schedule (banner remounts until loaded)
const QUICK_DELAYS_MS = [1200, 2500, 5000, 9000];
const SLOW_DELAY_MS = 20_000;

function fmtMs(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m`;
}

export default function AdFooter({ routeKey = 'unknown', onGoPremium }) {
  const { t } = useTranslation();
  const C = useColors();
  const { isPro } = usePro();
  const navigation = useNavigation();

  const { navTheme } = useTheme();
  const isDark = navTheme?.dark;

  // SDK ready hint (set by your Playwire init)
  const [sdkReady, setSdkReady] = useState(
    () => getInterstitialDebugState().initializedHint === 'yes'
  );

  // Delay mounting native view a bit for cold-start stability
  const [canMountBanner, setCanMountBanner] = useState(false);

  // Banner remount key (only changes on retry)
  const [bannerKey, setBannerKey] = useState(0);

  // Banner lifecycle status
  // 'idle' | 'loading' | 'loaded' | 'failed' | 'timeout'
  const [bannerStatus, setBannerStatus] = useState('idle');
  const [lastEventAt, setLastEventAt] = useState(null);

  const [loads, setLoads] = useState(0);
  const [fails, setFails] = useState(0);
  const [timeouts, setTimeouts] = useState(0);
  const [impr, setImpr] = useState(0);
  const [clicks, setClicks] = useState(0);
  const [lastErr, setLastErr] = useState(null);

  // ✅ NEW: Show placeholder only until the FIRST successful banner load
  const [showPlaceholderUntilFirstLoad, setShowPlaceholderUntilFirstLoad] = useState(true);

  // Debug HUD state
  const mountAtRef = useRef(Date.now());
  const [nowTick, setNowTick] = useState(Date.now());
  const [sdkReadyAt, setSdkReadyAt] = useState(sdkReady ? Date.now() : null);
  const [lastRemountAt, setLastRemountAt] = useState(null);
  const remountCountRef = useRef(0);
  const [remountCount, setRemountCount] = useState(0);

  // Watchdog refs
  const watchdogRef = useRef(null);
  const terminalForKeyRef = useRef({}); // bannerKey -> true when loaded/failed/timeout

  // Retry timer ref (so we can cancel when loaded)
  const retryTimerRef = useRef(null);

  const clearRetryTimer = () => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  };

  useEffect(() => {
    const t = setTimeout(() => setCanMountBanner(true), 1500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (sdkReady && !sdkReadyAt) setSdkReadyAt(Date.now());
  }, [sdkReady, sdkReadyAt]);

  useEffect(() => {
    if (!AD_DEBUG_FOOTER) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Become ready when Playwire is ready
  useEffect(() => {
    if (sdkReady) return;
    const { onPlaywireReady } = require('./playwireInit');
    onPlaywireReady(() => setSdkReady(true));
  }, [sdkReady]);

  // When we become mountable, kick off the first request
  useEffect(() => {
    if (!canMountBanner || !sdkReady) return;
    setBannerStatus((s) => (s === 'loaded' ? 'loaded' : 'loading'));
    setLastErr(null);
  }, [canMountBanner, sdkReady]);

  // Start watchdog per bannerKey
  useEffect(() => {
    if (!canMountBanner || !sdkReady) return;

    // clear previous watchdog
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }

    terminalForKeyRef.current[bannerKey] = false;

    // we're attempting a load
    setBannerStatus((s) => (s === 'loaded' ? 'loaded' : 'loading'));

    watchdogRef.current = setTimeout(() => {
      if (terminalForKeyRef.current[bannerKey]) return;

      terminalForKeyRef.current[bannerKey] = true;
      setBannerStatus('timeout');
      setTimeouts((x) => x + 1);
      setLastErr({ kind: 'timeout', afterMs: BANNER_TIMEOUT_MS });
      setLastEventAt(Date.now());
    }, BANNER_TIMEOUT_MS);

    return () => {
      if (watchdogRef.current) {
        clearTimeout(watchdogRef.current);
        watchdogRef.current = null;
      }
    };
  }, [bannerKey, canMountBanner, sdkReady]);

  // ---- Banner callbacks ----
  const markTerminal = (status, errObj = null) => {
    terminalForKeyRef.current[bannerKey] = true;

    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }

    setBannerStatus(status);
    setLastErr(errObj);
    setLastEventAt(Date.now());
  };

  const onLoaded = () => {
    setLoads((x) => x + 1);
    clearRetryTimer();
    markTerminal('loaded', null);

    // ✅ NEW: once we ever load successfully, never show placeholder again
    setShowPlaceholderUntilFirstLoad(false);
  };

  const onFailed = (e) => {
    setFails((x) => x + 1);
    const msg =
      typeof e === 'string'
        ? e
        : e?.message || e?.error || e?.nativeEvent?.message || JSON.stringify(e || {});
    markTerminal('failed', { kind: 'failed', msg: String(msg).slice(0, 160) });
  };

  const onImpression = () => setImpr((x) => x + 1);
  const onClicked = () => setClicks((x) => x + 1);

  // ---- Auto-retry remount attempts until loaded ----
  useEffect(() => {
    if (!canMountBanner || !sdkReady) return;
    if (bannerStatus === 'loaded') return;

    let stopped = false;

    const doRemount = () => {
      if (stopped) return;

      remountCountRef.current += 1;
      setRemountCount(remountCountRef.current);
      setLastRemountAt(Date.now());

      setBannerStatus('loading');
      setLastErr(null);

      setBannerKey((k) => k + 1);
    };

    const missCount = (fails || 0) + (timeouts || 0);
    const nextDelay =
      missCount < QUICK_DELAYS_MS.length ? QUICK_DELAYS_MS[missCount] : SLOW_DELAY_MS;

    clearRetryTimer();
    retryTimerRef.current = setTimeout(doRemount, nextDelay);

    return () => {
      stopped = true;
      clearRetryTimer();
    };
  }, [canMountBanner, sdkReady, bannerStatus, fails, timeouts]);

  // ---- Placeholder visibility ----
  // ✅ Show placeholder ONLY before first ever successful load, and only while not loaded.
  const showPlaceholder = showPlaceholderUntilFirstLoad && bannerStatus !== 'loaded';

  const handleFallbackPress = () => {
    try {
      navigation.navigate('Premium');
      return;
    } catch (e) {}

    if (onGoPremium) {
      onGoPremium();
      return;
    }

    Linking.openURL('https://livefpl.net/remove_ads').catch(() => {});
  };

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          height: AD_FOOTER_HEIGHT,
          backgroundColor: isDark ? '#ced4da' : '#ffffff',
          borderTopWidth: 1,
          borderTopColor: 'rgba(0,0,0,0.12)',
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
        placeholderOverlay: {
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          alignItems: 'center',
          justifyContent: 'center',
        },
        fallback: {
          width: BANNER_SIZE.width,
          height: BANNER_SIZE.height,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: 'rgba(0,0,0,0.12)',
          backgroundColor: 'rgba(0,0,0,0.04)',
          paddingHorizontal: 10,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        },
        fallbackLeft: {
          flexShrink: 1,
          paddingRight: 8,
        },
        fallbackTitle: {
          fontSize: 11,
          fontWeight: '900',
          color: '#111',
        },
        fallbackSub: {
          marginTop: 1,
          fontSize: 9,
          fontWeight: '700',
          color: 'rgba(0,0,0,0.55)',
        },
        fallbackBtn: {
          paddingHorizontal: 10,
          paddingVertical: 7,
          borderRadius: 999,
          backgroundColor: C.accent,
        },
        fallbackBtnText: {
          fontSize: 10,
          fontWeight: '900',
          color: '#fff',
        },
        debugHud: {
          position: 'absolute',
          left: 6,
          right: 6,
          bottom: 2,
          paddingHorizontal: 6,
          paddingVertical: 3,
          borderRadius: 8,
          backgroundColor: 'rgba(0,0,0,0.55)',
        },
        debugText: {
          fontSize: 9,
          fontWeight: '800',
          color: '#fff',
        },
      }),
    [C, isDark]
  );

  const dbg = AD_DEBUG_FOOTER ? getInterstitialDebugState() : null;

  const debugLines = AD_DEBUG_FOOTER
    ? [
        `PW banner dbg | ${Platform.OS} | route=${routeKey}`,
        `sdkReady=${sdkReady ? 'yes' : 'no'} (${sdkReadyAt ? fmtMs(nowTick - sdkReadyAt) : '—'})  canMount=${canMountBanner ? 'yes' : 'no'}`,
        `status=${bannerStatus}  last=${lastEventAt ? fmtMs(nowTick - lastEventAt) : '—'}`,
        `loads=${loads}  fails=${fails}  timeouts=${timeouts}  impr=${impr}  clicks=${clicks}`,
        `bannerKey=${bannerKey}  remounts=${remountCount}  lastRemount=${lastRemountAt ? fmtMs(nowTick - lastRemountAt) : '—'}`,
        `appUptime=${fmtMs(nowTick - mountAtRef.current)}`,
        `initHint=${dbg?.initializedHint || '—'}  guard=${dbg?.guarded ? 'yes' : 'no'}`,
        `placeholderOnce=${showPlaceholderUntilFirstLoad ? 'yes' : 'no'}`,
        lastErr ? `lastErr=${JSON.stringify(lastErr).slice(0, 110)}` : null,
      ].filter(Boolean)
    : [];

  // Hard gate: Pro users see absolutely nothing ad-related (after all hooks to satisfy Rules of Hooks).
  if (isPro) return null;

  // Keep footer height stable even while not ready
  if (!canMountBanner || !sdkReady) {
    return (
      <View style={styles.container}>
        {AD_DEBUG_FOOTER ? (
          <View style={styles.debugHud} pointerEvents="none">
            {debugLines.map((l, i) => (
              <Text key={`debug-${i}-${String(l).slice(0, 20)}`} style={styles.debugText} numberOfLines={1}>
                {l}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.bannerFrame}>
        {/* Keep banner mounted. No opacity hacks. */}
        <View pointerEvents={showPlaceholder ? 'none' : 'auto'}>
          <LazyPlaywireBanner
            key={`pw_banner_${bannerKey}`}
            adUnitId={AD_ALIAS}
            size={BANNER_SIZE}
            style={{ width: BANNER_SIZE.width, height: BANNER_SIZE.height }}
            onAdLoaded={onLoaded}
            onAdFailedToLoad={onFailed}
            onAdImpression={onImpression}
            onAdClicked={onClicked}
          />
        </View>

        {/* Placeholder only before first successful load */}
        {showPlaceholder ? (
          <View style={styles.placeholderOverlay} pointerEvents="box-none">
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={handleFallbackPress}
              style={styles.fallback}
            >
              <View style={styles.fallbackLeft}>
                <Text style={styles.fallbackTitle} numberOfLines={1}>
                  {t('ad.placeholderTitle')}
                </Text>
                <Text style={styles.fallbackSub} numberOfLines={1}>
                  {t('ad.placeholderLine1')}
                </Text>
                <Text style={styles.fallbackSub} numberOfLines={1}>
                  {t('ad.placeholderLine2')}
                </Text>
              </View>
              <View style={styles.fallbackBtn}>
                <Text style={styles.fallbackBtnText}>{t('ad.goPremium')}</Text>
              </View>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      {AD_DEBUG_FOOTER ? (
        <View style={styles.debugHud} pointerEvents="none">
          {debugLines.map((l, i) => (
            <Text key={`debug-${i}-${String(l).slice(0, 20)}`} style={styles.debugText} numberOfLines={1}>
              {l}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}
