// ad.js
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { useColors } from './theme';
import { usePro } from './ProContext';
import { PlaywireBannerView } from '@intergi/react-native-playwire-sdk';

import {
  subscribeInterstitialDebug,
  getInterstitialDebugState,
  preloadInterstitial,
  showOnce as showInterstitialOnce,
} from './AdInterstitial';

export const AD_FOOTER_HEIGHT = 50;

const BANNER_SIZE = { width: 320, height: 50 };
const AD_ALIAS = 'banner-320x50';
const TIMEOUT_MS = 18000;

// Toggle this to false later when you're done debugging
const DEBUG_AD = true;

export default function AdFooter({ slot = 'Default' }) {
  const C = useColors();
  const { isPro } = usePro();

  // If Pro and not debugging, remove the footer entirely
  const skipAdForPro = isPro && !DEBUG_AD;
  if (skipAdForPro) return null;

  /** ---------------- Interstitial HUD (also carries sdk init hint) ---------------- */
  const [iState, setIState] = useState(() => getInterstitialDebugState());
  useEffect(() => {
    const unsub = subscribeInterstitialDebug(setIState);
    return unsub;
  }, []);

  // This is your “SDK ready” signal (set inside Playwire.initializeSDK callback)
  const sdkReady = iState.initializedHint === 'yes';

  /** ---------------- Banner ---------------- */
  const [phase, setPhase] = useState('waiting_sdk'); // waiting_sdk | loading | loaded | failed
  const [debugMessage, setDebugMessage] = useState(
    'Waiting for Playwire SDK init callback…'
  );
  const timeoutRef = useRef(null);

  // When SDK becomes ready, start loading banner
  useEffect(() => {
    if (!sdkReady) {
      // If SDK is not ready, never mount banner (prevents Playwire rejection)
      setPhase('waiting_sdk');
      setDebugMessage('Waiting for Playwire SDK init callback…');
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      return;
    }

    // SDK ready -> move to loading (banner will mount)
    setPhase((prev) => (prev === 'loaded' ? 'loaded' : 'loading'));
    setDebugMessage('SDK ready ✅ Mounting banner and waiting for callbacks…');
  }, [sdkReady]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          height: AD_FOOTER_HEIGHT,
          backgroundColor: C.card,
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
        text: {
          fontSize: 11,
          color: C.muted,
          textAlign: 'center',
        },
        debugText: {
          fontSize: 10,
          color: C.muted,
          textAlign: 'center',
          marginBottom: 1,
        },
        hudText: {
          fontSize: 10,
          color: C.muted,
          textAlign: 'center',
          marginBottom: 2,
        },
        phaseBorder_waiting_sdk: {
          borderWidth: 1,
          borderColor: '#8888',
          borderStyle: 'dashed',
        },
        phaseBorder_loading: {
          borderWidth: 1,
          borderColor: '#8888',
          borderStyle: 'dashed',
        },
        phaseBorder_loaded: {
          borderWidth: 1,
          borderColor: '#2e7d32',
        },
        phaseBorder_failed: {
          borderWidth: 1,
          borderColor: '#c62828',
        },
      }),
    [C]
  );

  /** --- Banner timeout if no callback fired while loading --- */
  useEffect(() => {
    if (phase !== 'loading') return;

    timeoutRef.current = setTimeout(() => {
      setPhase((prev) => {
        if (prev === 'loading') {
          const msg = 'Timeout: no banner callbacks (no fill, blocked request, or SDK issue).';
          setDebugMessage(msg);
          return 'failed';
        }
        return prev;
      });
    }, TIMEOUT_MS);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [phase]);

  const onAdLoaded = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setPhase('loaded');
    setDebugMessage(
      'onAdLoaded ✅ (If test mode is on, you should see a test banner / fill response.)'
    );
    console.log('[Playwire] Banner onAdLoaded', { alias: AD_ALIAS, slot });
  };

  const onAdFailedToLoad = (adUnitId) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setPhase('failed');
    const msg = `onAdFailedToLoad ❌ (adUnitId="${adUnitId}")`;
    setDebugMessage(msg);
    console.log('[Playwire] Banner onAdFailedToLoad', { adUnitId, slot });
  };

  const borderStyle =
    phase === 'loaded'
      ? styles.phaseBorder_loaded
      : phase === 'failed'
      ? styles.phaseBorder_failed
      : phase === 'waiting_sdk'
      ? styles.phaseBorder_waiting_sdk
      : styles.phaseBorder_loading;

  // Tap HUD = preload interstitial
  // Long press HUD = force show interstitial
  const onPressHud = async () => {
    try {
      await preloadInterstitial();
    } catch {}
  };
  const onLongPressHud = async () => {
    try {
      await showInterstitialOnce({ force: true, reason: 'manual_from_footer' });
    } catch {}
  };

  const sdkLine = `sdk=${sdkReady ? 'READY' : 'WAIT'} initHint=${iState.initializedHint}`;
  const bannerLine = `banner=${phase} alias=${AD_ALIAS} slot=${slot}`;

  return (
    <View style={[styles.container, borderStyle]}>
      <Text style={styles.debugText}>
        [{Platform.OS}] {sdkLine} | {bannerLine}
      </Text>

      {DEBUG_AD ? (
        <Pressable onPress={onPressHud} onLongPress={onLongPressHud}>
          <Text style={styles.hudText}>
            [Int] ready={String(iState.ready)} loading={String(iState.loading)} inflight={String(
              iState.inflight
            )} last={iState.lastEvent} err={iState.lastFailAlias || '-'}
          </Text>
        </Pressable>
      ) : null}

      {/* Status / failure text */}
      {phase === 'failed' ? (
        <Text style={styles.text}>
          Ad unavailable{debugMessage ? ` — ${debugMessage}` : ''}
        </Text>
      ) : !sdkReady ? (
        <Text style={styles.text}>{debugMessage}</Text>
      ) : (
        <View style={styles.bannerFrame}>
          <PlaywireBannerView
            adUnitId={AD_ALIAS}
            size={BANNER_SIZE}
            style={{ width: BANNER_SIZE.width, height: BANNER_SIZE.height }}
            onAdLoaded={onAdLoaded}
            onAdFailedToLoad={onAdFailedToLoad}
          />
        </View>
      )}
    </View>
  );
}
