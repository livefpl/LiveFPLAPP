// StatsStrip.js
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { useColors } from './theme';

// Helpers: accept numbers/strings/arrays uniformly
const asPlain = (v) => (Array.isArray(v) ? v.filter(Boolean).join(' / ') : v);
const fmtValue = (v) => {
  const x = asPlain(v);
  return typeof x === 'number' ? x.toLocaleString() : String(x ?? '');
};
const fmtSub = (v) => String(asPlain(v) ?? '');

export default function StatsStrip({ items = [] }) {
  const C = useColors();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        strip: {
          backgroundColor: C.card,
          borderColor: C.border,
          borderWidth: 1,
          borderRadius: 12,
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 6,
          paddingHorizontal: 8,
          minHeight: 56, // compact
        },

        item: {
          flex: 1,
          paddingHorizontal: 6,
          minWidth: 0, // allow children to shrink in flex layouts (Android critical)
        },

        itemDivider: {
          borderLeftWidth: 1,
          borderLeftColor: C.border,
        },

        title: {
          fontSize: 10,
          fontWeight: '700',
          color: C.muted,
          textAlign: 'center',
          marginBottom: 2,
        },

        valueRow: {
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          minWidth: 0, // prevent overflow clipping
        },

        value: {
          fontSize: 16,
          fontWeight: '800',
          color: C.ink,
          textAlign: 'center',
          flexShrink: 1,
          minWidth: 0,
        },

        icon: {
          width: 16,
          height: 16,
          marginTop: 1,
          marginLeft: 6, // spacing from value
        },

        sub: {
          fontSize: 10,
          color: C.muted,
          textAlign: 'center',
          marginTop: 2,
          flexShrink: 1,
          minWidth: 0,
        },
      }),
    [C]
  );

  return (
    <View style={styles.strip}>
      {items.map((it, idx) => (
        <View
          key={idx}
          style={[
            styles.item,
            idx > 0 && styles.itemDivider,
            it.flex && { flex: it.flex }, // optional: give a segment more space
          ]}
        >
          {!!it.title && (
            <Text style={styles.title} numberOfLines={1} ellipsizeMode="tail">
              {it.title}
            </Text>
          )}

          <View style={styles.valueRow}>
            <Text
              style={styles.value}
              numberOfLines={1}
              ellipsizeMode="tail"
              adjustsFontSizeToFit
              minimumFontScale={0.85}
            >
              {fmtValue(it.value)}
            </Text>
            {!!it.icon && <Image source={it.icon} style={styles.icon} resizeMode="contain" />}
          </View>

          {!!it.sub && (
            <Text
              style={styles.sub}
              numberOfLines={2}        // allow wrap on tiny phones
              ellipsizeMode="middle"   // keep both start and the (%)
              adjustsFontSizeToFit
              minimumFontScale={0.85}
            >
              {fmtSub(it.sub)}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}
