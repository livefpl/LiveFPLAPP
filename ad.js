// ad.js
import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from './theme';
import { usePro } from './ProContext';
import { PlaywireBannerView } from '@intergi/react-native-playwire-sdk';

export const AD_FOOTER_HEIGHT = 50;

const BANNER_SIZE = { width: 320, height: 50 };
const AD_ALIAS = 'banner-320x50';
const TIMEOUT_MS = 18000;

export default function AdFooter({ slot = 'Default' }) {
  const C = useColors();
  const { isPro } = usePro();

  /** ---------------- PRO MODE ---------------- */
  if (isPro) {
    const styles = StyleSheet.create({
      container: {
        height: AD_FOOTER_HEIGHT,
        backgroundColor: C.card,
        borderTopWidth: 1,
        borderTopColor: C.border,
        alignItems: 'center',
        justifyContent: 'center',
      },
      text: { fontSize: 12, color: C.muted },
    });
    return (
      <View style={styles.container}>
        <Text style={styles.text}>Ads disabled (Pro)</Text>
      </View>
    );
  }

  /** ---------------- ADS MODE ---------------- */
  const [phase, setPhase] = useState('loading'); // 'loading' | 'loaded' | 'failed'
  const [errorText, setErrorText] = useState('');
  const timeoutRef = useRef(null);

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
        },
        bannerFrame: {
          width: BANNER_SIZE.width,
          height: BANNER_SIZE.height,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          backgroundColor: 'transparent',
          borderWidth: 0,
        },
        text: {
          fontSize: 12,
          color: C.muted,
          textAlign: 'center',
          paddingHorizontal: 8,
        },
      }),
    [C]
  );

  /** --- Timeout if no callback fired --- */
  useEffect(() => {
    timeoutRef.current = setTimeout(() => {
      if (phase === 'loading') {
        const msg = 'Banner timed out (no response from ad server).';
        setPhase('failed');
        setErrorText(msg);
      }
    }, TIMEOUT_MS);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [phase]);

  /** --- Callbacks --- */
  const onAdLoaded = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setPhase('loaded');
    setErrorText('');
  }, []);

  const onAdFailedToLoad = useCallback((e) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    const detail = e?.nativeEvent ?? e;

    let msg = '';
    try {
      msg = JSON.stringify(detail);
    } catch {
      msg =
        (detail && (detail.message || detail.error || detail.reason || detail.code)) ||
        (typeof detail === 'string' ? detail : '');
    }

    if (!msg) {
      msg = 'Unknown error';
    }

    setPhase('failed');
    setErrorText(String(msg));
  }, []);

  return (
    <View style={styles.container}>
      {phase === 'failed' ? (
        <Text style={styles.text}>
          Ad unavailable{errorText ? ` — ${errorText}` : ''}
        </Text>
      ) : (
        <View style={styles.bannerFrame}>
          <PlaywireBannerView
            adUnitId={AD_ALIAS}
            size={BANNER_SIZE}
            style={{ width: 320, height: 50 }}
            onAdLoaded={onAdLoaded}
            onAdFailedToLoad={onAdFailedToLoad}
          />
        </View>
      )}
    </View>
  );
}
