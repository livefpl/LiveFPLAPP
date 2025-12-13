// ad.js
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from './theme';
import { usePro } from './ProContext';
import { PlaywireBannerView } from '@intergi/react-native-playwire-sdk';
import { subscribeInterstitialStatus, getInterstitialStatus } from './AdInterstitial';

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

  /** ---------------- ADS MODE (Debuggable) ---------------- */
  const [phase, setPhase] = useState('loading'); // 'loading' | 'loaded' | 'failed'
  const [debugMessage, setDebugMessage] = useState('Banner created; waiting for callbacks…');
  const timeoutRef = useRef(null);

  // Interstitial debug status (only updates when DEBUG_AD is true)
  const [iStatus, setIStatus] = useState(() => getInterstitialStatus());

  useEffect(() => {
    if (!DEBUG_AD) return;
    const unsub = subscribeInterstitialStatus(setIStatus);
    return unsub;
  }, []);

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
          marginBottom: 2,
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

  /** --- Timeout if no callback fired while loading --- */
  useEffect(() => {
    if (phase !== 'loading') return;

    timeoutRef.current = setTimeout(() => {
      setPhase((prev) => {
        if (prev === 'loading') {
          const msg = 'Timeout: no response from ad server.';
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
    setDebugMessage('onAdLoaded fired (blue test banner should be visible if test mode is active).');
    console.log('[Playwire] Banner onAdLoaded for adUnitId:', AD_ALIAS);
  };

  // Per Playwire: this callback only receives the adUnitId string
  const onAdFailedToLoad = (adUnitId) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setPhase('failed');
    const msg = `onAdFailedToLoad fired (adUnitId="${adUnitId}")`;
    setDebugMessage(msg);
    console.log('[Playwire] Banner onAdFailedToLoad for adUnitId:', adUnitId);
  };

  const borderStyle =
    phase === 'loaded'
      ? styles.phaseBorder_loaded
      : phase === 'failed'
      ? styles.phaseBorder_failed
      : styles.phaseBorder_loading;

  return (
    <View style={[styles.container, borderStyle]}>
      {/* Banner debug line always visible */}
      <Text style={styles.debugText}>
        [Ad debug] phase={phase} | slot={slot} | alias={AD_ALIAS}
      </Text>

      {/* Interstitial debug line (only when DEBUG_AD is true) */}
      {DEBUG_AD ? (
        <Text style={styles.debugText}>
          [Int] {iStatus.phase} | ready={String(iStatus.ready)} | loading={String(iStatus.loading)} | err={iStatus.lastError || '-'}
        </Text>
      ) : null}

      {phase === 'failed' ? (
        <Text style={styles.text}>
          Ad unavailable{debugMessage ? ` — ${debugMessage}` : ''}
        </Text>
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
