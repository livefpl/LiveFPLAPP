// SettingsModal.js
import React, { useMemo, useState, useEffect } from 'react';
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
import { useNavigation } from '@react-navigation/native';
import { useTheme, useColors } from './theme';

export default function SettingsModal({
  visible,
  onClose,
  displaySettings,
  setDisplaySettings,
  notifPrefs,
  setNotifPrefs,
}) {
  // Expanded by default
  const [glossaryOpen, setGlossaryOpen] = useState(false);

  // ✅ Local copy that controls all switches while the modal is open
  const [localSettings, setLocalSettings] = useState(displaySettings || {});
    const [localNotifPrefs, setLocalNotifPrefs] = useState(notifPrefs || {});

  const { mode, setMode } = useTheme();
  const C = useColors();
  const navigation = useNavigation();

    useEffect(() => {
    if (visible) {
      setLocalSettings(displaySettings || {});
      setLocalNotifPrefs(notifPrefs || {});
    }
  }, [visible]); // intentionally NOT depending on displaySettings

  const toggles = useMemo(
    () => [
      { key: 'showEOs',         label: 'Show Effective Ownership (EO)' },
      { key: 'showEvents',      label: 'Show event icons under players' },
      { key: 'includeSubs',     label: 'Include subs in rank (post-rank)' },
      { key: 'showManagerName', label: 'Show manager name at top' },
    ],
    []
  );

  // Update local state (not the parent) while open
  const toggleKey = (key) => (val) =>
    setLocalSettings((prev) => ({ ...prev, [key]: val }));

    const handleClose = () => {
    setDisplaySettings?.(localSettings);
    setNotifPrefs?.(localNotifPrefs);
    onClose?.();
  };


  const handleChangeId = () => {
    // Commit settings, navigate, then close modal
    setDisplaySettings(localSettings);
      setNotifPrefs?.(localNotifPrefs);

    try {
      navigation.navigate('ID');
    } catch {}
    onClose && onClose();
  };

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

        // Buttons
        actionsRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          marginTop: 12,
        },
        closeBtn: {
          paddingHorizontal: 16,
          paddingVertical: 8,
          borderRadius: 10,
          backgroundColor: C.accent,
        },
        closeText: { color: '#fff', fontWeight: '700' },
        idBtn: {
          paddingHorizontal: 16,
          paddingVertical: 8,
          borderRadius: 10,
          backgroundColor: C.card,
          borderWidth: 1,
          borderColor: C.border,
        },
        idText: { color: C.ink, fontWeight: '700' },

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
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose} // ensure hardware back commits too
    >
      <Pressable style={styles.backdrop} onPress={handleClose}>

          <Pressable style={styles.sheet} onPress={() => {}}>

          <Text style={styles.title}>Display Settings</Text>

          {/* Appearance */}
          <Text style={styles.sectionTitle}>Appearance</Text>
          <View style={styles.modeRow}>
            {['light', 'dark'].map((m) => {
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
                    {m[0].toUpperCase() + m.slice(1)}
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
                value={!!localSettings[key]}
                onValueChange={toggleKey(key)}
                trackColor={{ false: C.border2, true: C.ok }}
                ios_backgroundColor={C.border2}
                thumbColor={localSettings[key] ? '#fff' : '#ddd'}
              />
            </View>
          ))}

                    <View style={styles.divider} />

          {/* Notifications */}
          <Text style={styles.sectionTitle}>Notifications</Text>

          {[
            { key: 'myTeamGoalsAssists', label: 'My team: Goals & Assists' },
            { key: 'top10Threats', label: 'Top 10 threats: Goals & Assists' },
            { key: 'priceWarnings', label: 'Price change warnings' },
          ].map(({ key, label }) => (
            <View key={key} style={styles.row}>
              <Text style={styles.rowLabel}>{label}</Text>
              <Switch
                value={!!localNotifPrefs?.[key]}
                onValueChange={(v) => setLocalNotifPrefs((p) => ({ ...(p || {}), [key]: v }))}
                trackColor={{ false: C.border2, true: C.ok }}
                ios_backgroundColor={C.border2}
                thumbColor={localNotifPrefs?.[key] ? '#fff' : '#ddd'}
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

          {/* Collapsible Glossary (expanded by default) */}
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
                It is the true effect of that player accounting for captaincy and benching.
              </Text>
              <Text style={styles.glossItem}>
                <Text style={styles.bold}>Example:</Text> EO 50% → each point he scores adds 0.5 to the average. If everyone
                owns + captains a player → EO 200%.
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

          {/* Actions */}
          <View style={styles.actionsRow}>
            <Pressable style={styles.idBtn} onPress={handleChangeId} accessibilityRole="button" accessibilityLabel="Change ID">
              <Text style={styles.idText}>Change ID</Text>
            </Pressable>

            <Pressable style={styles.closeBtn} onPress={handleClose} accessibilityRole="button" accessibilityLabel="Close settings">
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </View>
          </Pressable>
</Pressable>

    </Modal>
  );
}
