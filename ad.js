// ad.js
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { useColors } from './theme';
import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';

export const AD_FOOTER_HEIGHT = 50;

const COPY = {
  Rank: 'Your ad here — Rank page',
  Leagues: 'Your ad here — Leagues page',
  Prices: 'Your ad here — Prices page',
  Statistics: 'Your ad here — Stats page',
  Games: 'Your ad here — Games page',
  'Change ID': 'Your ad here — Change ID',
  Default: 'Your ad here',
};

// TODO: replace with your *real* ad unit IDs per platform
const ANDROID_BANNER_ID = 'ca-app-pub-7466981426984905/7940807725';
const IOS_BANNER_ID     = 'ca-app-pub-7466981426984905/7940807725';

const PROD_UNIT_ID = Platform.select({
  android: ANDROID_BANNER_ID,
  ios: IOS_BANNER_ID,
});

export default function AdFooter({
  slot = 'Default',
  // You can swap to BannerAdSize.ANCHORED_ADAPTIVE_BANNER later if you want adaptive height.
  size = BannerAdSize.BANNER,
  requestNonPersonalizedAdsOnly = true,
}) {
  const C = useColors();
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
        testLabel: {
          position: 'absolute',
          top: 4,
          fontSize: 11,
          color: C.muted,
        },
        fallbackText: { fontSize: 12, color: C.muted },
      }),
    [C]
  );

  const [failed, setFailed] = useState(false);

  // Test ad in dev, real ad in prod
  const unitId = __DEV__ ? TestIds.BANNER : PROD_UNIT_ID;

  return (
    <View style={styles.container} accessibilityLabel="Ad footer">
      {failed ? (
        <Text style={styles.fallbackText}>{COPY[slot] || COPY.Default}</Text>
      ) : (
        <>
          {__DEV__ && <Text style={styles.testLabel}>Test Ad • {slot}</Text>}
          <BannerAd
            unitId={unitId}
            size={size}
            requestOptions={{ requestNonPersonalizedAdsOnly }}
            onAdFailedToLoad={() => setFailed(true)}
          />
        </>
      )}
    </View>
  );
}
