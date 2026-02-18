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
import { useTranslation } from 'react-i18next';
import { useTheme, useColors } from './theme';
import UpdatesDebugPanel from './UpdatesDebugPanel';

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

  const { t } = useTranslation();
  const { mode, setMode } = useTheme();
  const C = useColors();
  const navigation = useNavigation();

  const toggles = useMemo(
    () => [
      { key: 'showEOs',         labelKey: 'settings.showEO' },
      { key: 'showEvents',      labelKey: 'settings.showEventIcons' },
      { key: 'showManagerName', labelKey: 'settings.showManagerName' },
    ],
    []
  );

  const notifItems = useMemo(
    () => [
      { key: 'myTeamGoalsAssists', labelKey: 'settings.myTeamGoalsAssists' },
      { key: 'top10Threats', labelKey: 'settings.top10Threats' },
      { key: 'priceWarnings', labelKey: 'settings.priceWarnings' },
    ],
    []
  );

    useEffect(() => {
    if (visible) {
      setLocalSettings(displaySettings || {});
      setLocalNotifPrefs(notifPrefs || {});
    }
  }, [visible]); // intentionally NOT depending on displaySettings

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

          <Text style={styles.title}>{t('settings.displaySettings')}</Text>

          {/* Appearance */}
          <Text style={styles.sectionTitle}>{t('settings.appearance')}</Text>
          <View style={styles.modeRow}>
            {['light', 'dark'].map((m) => {
              const active = mode === m;
              return (
                <Pressable
                  key={m}
                  onPress={() => setMode(m)}
                  style={[styles.modeChip, active && styles.modeChipActive]}
                  accessibilityRole="button"
                  accessibilityLabel={t('settings.setTheme', { mode: m })}
                >
                  <Text style={[styles.modeChipText, active && styles.modeChipTextActive]}>
                    {t(m === 'light' ? 'settings.light' : 'settings.dark')}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Toggles */}
          {toggles.map(({ key, labelKey }) => (
            <View key={key} style={styles.row}>
              <Text style={styles.rowLabel}>{t(labelKey)}</Text>
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
          <Text style={styles.sectionTitle}>{t('settings.notifications')}</Text>

          {notifItems.map(({ key, labelKey }) => (
            <View key={key} style={styles.row}>
              <Text style={styles.rowLabel}>{t(labelKey)}</Text>
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
            {t('settings.moreToolsAt')}{' '}
            <Text
              style={styles.link}
              accessibilityRole="link"
              onPress={() => Linking.openURL('https://www.livefpl.net')}
            >
              {t('settings.livefplNet')}
            </Text>{' '}
            • {t('settings.eoTable')}{' '}
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
            accessibilityLabel={t('settings.toggleGlossary')}
          >
            <Text style={styles.glossTitle}>{t('settings.glossary')}</Text>
            <Text style={styles.chevron}>{glossaryOpen ? '▲' : '▼'}</Text>
          </Pressable>

          {glossaryOpen && (
            <ScrollView style={styles.glossary}>
              <Text style={styles.glossItem}>{t('settings.eoExplainer')}</Text>
              <Text style={styles.glossItem}>{t('settings.eoExample')}</Text>
              <Text style={[styles.glossTitle, { marginTop: 8 }]}>{t('settings.emojiLegend')}</Text>
              <Text style={styles.glossItem}>{t('settings.emojiDifferential')}</Text>
              <Text style={styles.glossItem}>{t('settings.emojiTemplate')}</Text>
              <Text style={styles.glossItem}>{t('settings.emojiSpy')}</Text>
              <Text style={styles.glossItem}>{t('settings.emojiStar')}</Text>
              <Text style={styles.glossItem}>{t('settings.emojiSub')}</Text>
            </ScrollView>
          )}

          {/* Actions */}
          <View style={styles.actionsRow}>
            <Pressable style={styles.idBtn} onPress={handleChangeId} accessibilityRole="button" accessibilityLabel={t('settings.changeId')}>
              <Text style={styles.idText}>{t('settings.changeId')}</Text>
            </Pressable>

            <Pressable style={styles.closeBtn} onPress={handleClose} accessibilityRole="button" accessibilityLabel={t('settings.closeSettings')}>
              <Text style={styles.closeText}>{t('common.close')}</Text>
            </Pressable>
          </View>
          </Pressable>
</Pressable>

    </Modal>
  );
}
