import React from 'react';
import { View, Text, StyleSheet, Linking } from 'react-native';
import { useColors } from './theme';

const ensureHttp = (url) => (/^https?:\/\//i.test(url) ? url : `https://${url}`);

export default function InfoBanner({ text, link }) {
  const C = useColors();
  if (!text || !link) return null;

  const styles = StyleSheet.create({
    container: {
      paddingVertical: 8,
      paddingHorizontal: 10,
      backgroundColor: C.card,
      borderBottomWidth: 1,
      borderBottomColor: C.border,
    },
    text: { fontSize: 12, color: C.muted },
    link: { color: C.accent, textDecorationLine: 'underline' },
  });

  return (
    <View style={styles.container}>
      <Text style={styles.text}>
        {text}{' '}
        <Text
          style={styles.link}
          accessibilityRole="link"
          onPress={() => Linking.openURL(ensureHttp(link))}
        >
          {link}
        </Text>
      </Text>
    </View>
  );
}
