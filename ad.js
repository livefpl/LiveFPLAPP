// ad.js
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from './theme';
import { usePro } from './ProContext';

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

export default function AdFooter({ slot = 'Default' }) {
  const C = useColors();
  const { isPro } = usePro();

  // Hide banner/footer entirely for Pro
  if (isPro) return null;
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
        text: { fontSize: 12, color: C.muted },
      }),
    [C]
  );

  return (
    <View style={styles.container}>
      <Text style={styles.text}>{COPY[slot] || COPY.Default}</Text>
    </View>
  );
}
