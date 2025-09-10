// SettingsModal.js
import React, { useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Switch,
  Pressable,
  StyleSheet,
  ScrollView,
  Linking,
} from 'react-native';
import { useTheme, useColors } from './theme';

export default function SettingsModal({
  visible,
  onClose,
  displaySettings,
  setDisplaySettings,
}) {
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const { mode, setMode } = useTheme();
  const C = useColors();

  const toggles = useMemo(
    () => [
      { key: 'showEOs',         label: 'Show Effective Ownership (EO)' },
      { key: 'showEvents',      label: 'Show event icons under players' },
      { key: 'includeSubs',     label: 'Include subs in rank (post-rank)' },
      { key: 'showManagerName', label: 'Show manager name at top' },
    ],
    []
  );

  const toggleKey = (key) => (val) =>
    setDisplaySettings((prev) => ({ ...prev, [key]: val }));

  const styles = useMemo(
    () =>
      StyleSheet.create({
        backdrop: {
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.45)',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
        },
        sheet: {
          width: '100%',
          maxWidth: 520,
          borderRadius: 16,
          backgroundColor: C.card,
          borderWidth: 1,
          borderColor: C.border,
          padding: 16,
        },
        title: {
          fontSize: 18,
          fontWeight: '700',
          color: C.ink,
          marginBottom: 12,
          textAlign: 'center',
        },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 10,
          justifyContent: 'space-between',
        },
        rowLabel: {
          color: C.ink,
          flex: 1,
          paddingRight: 12,
          fontSize: 14,
        },

        // Appearance picker
        sectionTitle: { color: C.muted, fontSize: 12, marginTop: 4, marginBottom: 6 },
        modeRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
        modeChip: {
          paddingVertical: 6,
          paddingHorizontal: 10,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: C.border,
          backgroundColor: C.card,
          marginRight: 8,
        },
        modeChipActive: {
          backgroundColor: C.accent,
          borderColor: C.accentDark,
        },
        modeChipText: { color: C.ink, fontWeight: '600' },
        modeChipTextActive: { color: '#fff', fontWeight: '700' },

        divider: { height: 1, backgroundColor: C.border, marginVertical: 12 },
        glossary: { maxHeight: 260 },
        glossTitle: { color: C.ink, fontWeight: '700', marginBottom: 4 },
        glossItem: { color: C.ink, opacity: 0.9, lineHeight: 19, marginBottom: 6 },
        bold: { fontWeight: '700' },
        link: { color: C.accent, textDecorationLine: 'underline' },

        closeBtn: {
          marginTop: 10,
          alignSelf: 'center',
          paddingHorizontal: 16,
          paddingVertical: 8,
          borderRadius: 10,
          backgroundColor: C.accent,
        },
        closeText: { color: '#fff', fontWeight: '700' },

        glossaryToggle: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        },
        chevron: { color: C.ink, fontSize: 14, opacity: 0.9 },
      }),
    [C]
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Display Settings</Text>

          {/* Appearance */}
          <Text style={styles.sectionTitle}>Appearance</Text>
          <View style={styles.modeRow}>
            {[ 'light', 'dark'].map((m) => {
              const active = mode === m;
              return (
                <Pressable
                  key={m}
                  onPress={() => setMode(m)}
                  style={[styles.modeChip, active && styles.modeChipActive]}
                  accessibilityRole="button"
                  accessibilityLabel={`Set theme: ${m}`}
                >
                  <Text style={[styles.modeChipText, active && styles.modeChipTextActive]}>
                    {m === 'Light' ? 'Light' : m[0].toUpperCase() + m.slice(1)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Toggles */}
          {toggles.map(({ key, label }) => (
            <View key={key} style={styles.row}>
              <Text style={styles.rowLabel}>{label}</Text>
              <Switch
                value={!!displaySettings[key]}
                onValueChange={toggleKey(key)}
                trackColor={{ false: C.border2, true: C.ok }}
                ios_backgroundColor={C.border2}
                thumbColor={displaySettings[key] ? '#fff' : '#ddd'}
              />
            </View>
          ))}

          {/* Links */}
          <Text style={[styles.glossItem, { marginTop: 6 }]}>
            More tools for rank tiers and team ratings at{' '}
            <Text
              style={styles.link}
              accessibilityRole="link"
              onPress={() => Linking.openURL('https://www.livefpl.net')}
            >
              livefpl.net
            </Text>{' '}
            • EO table{' '}
            <Text
              style={styles.link}
              accessibilityRole="link"
              onPress={() => Linking.openURL('https://www.livefpl.net/EO')}
            >
              livefpl.net/EO
            </Text>
          </Text>

          <View style={styles.divider} />

          {/* Collapsible Glossary */}
          <Pressable
            style={styles.glossaryToggle}
            onPress={() => setGlossaryOpen((o) => !o)}
            accessibilityRole="button"
            accessibilityLabel="Toggle glossary"
          >
            <Text style={styles.glossTitle}>Glossary</Text>
            <Text style={styles.chevron}>{glossaryOpen ? '▲' : '▼'}</Text>
          </Pressable>

          {glossaryOpen && (
            <ScrollView style={styles.glossary}>
              {/* EO quick explainer */}
              <Text style={styles.glossItem}>
                <Text style={styles.bold}>EO:</Text> Effective Ownership = own% + captain% + triple-captain%.
                It’s the sample’s average multiplier on that player.
              </Text>
              <Text style={styles.glossItem}>
                <Text style={styles.bold}>Example:</Text> EO 50% → each point adds 0.5 to the sample; everyone
                owning + captaining → EO 200%.
              </Text>

              {/* Emoji legend */}
              <Text style={[styles.glossTitle, { marginTop: 8 }]}>Emoji legend</Text>
              <Text style={styles.glossItem}>🎲 Differential — low EO; big gains if he hauls.</Text>
              <Text style={styles.glossItem}>😴 Template — very common pick; returns keep you level.</Text>
              <Text style={styles.glossItem}>
                🕵 Spy — A player whose points will hurt you despite you owning him, as he's highly captained by others.
              </Text>
              <Text style={styles.glossItem}>⭐ Star — Your differential delivering the points.</Text>
              <Text style={styles.glossItem}>🔃 Sub — Autosubbed.</Text>
            </ScrollView>
          )}

          <Pressable style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
