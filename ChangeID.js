import React, { useEffect, useState, useMemo, useRef } from 'react';
import AppHeader from './AppHeader';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  SafeAreaView,
  Linking,
  ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, CommonActions } from '@react-navigation/native';
import { useFplId } from './FplIdContext';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useColors, useTheme } from './theme';
import ThemedTextInput from './ThemedTextInput';

/* --- Helpers --- */
function extractIdFromText(s) {
  if (!s) return null;
  const str = String(s).trim();

  const m1 = str.match(/entry\/(\d{1,10})/i);
  if (m1) return m1[1];

  const m2 = str.match(/[?&]entry=(\d{1,10})\b/i);
  if (m2) return m2[1];

  const m3 = str.match(/\b(\d{4,10})\b/);
  if (m3) return m3[1];

  return null;
}

function sanitizeInput(text) {
  if (!text) return '';
  const digitMap = {
    '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9',
    '۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9',
  };
  let out = '';
  for (const ch of text) out += digitMap[ch] ?? ch;
  return out.replace(/[\u200E\u200F\u061C]/g, '').replace(/\?/g, '');
}

const openUrl = (url) => {
  const withProto = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  Linking.openURL(withProto).catch(() => {});
};

/* -------------------- Compact Value/Hero -------------------- */
function ValueProps({ C, styles }) {
  return (
    <View style={styles.valueCard} accessibilityRole="summary">
      <View style={styles.valueHeaderRow}>
        <Text style={styles.valueHeading}>
          The original, most-trusted FPL rank tool since 2018 ❤️
        </Text>
      </View>

      <TouchableOpacity
        onPress={() => openUrl('https://www.livefpl.net')}
        activeOpacity={0.8}
        style={styles.learnMoreLink}
        accessibilityRole="link"
        accessibilityLabel="Open the LiveFPL website"
      >
        <Text style={styles.learnMoreText}>Get the full experience on the website</Text>
        <MaterialCommunityIcons name="open-in-new" size={13} color={C.muted} />
      </TouchableOpacity>
    </View>
  );
}

/* -------------------- Screen -------------------- */
export default function ChangeID() {
  const navigation = useNavigation();
  const { fplId, updateFplId } = useFplId();
  const { mode, setMode } = useTheme();   // global theme sync
  const C = useColors();

  const isDark = useMemo(() => {
    const hex = String(C.bg || '#000000').replace('#', '');
    if (hex.length < 6) return true;
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return l < 0.5;
  }, [C.bg]);

  const styles = useMemo(() => createStyles(C, isDark), [C, isDark]);

  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [parsedId, setParsedId] = useState(null);

  const inputRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem('fplId');
        setValue(stored || fplId || '');
      } catch {}
      setLoading(false);
    })();
  }, [fplId]);

  // live parse feedback
  useEffect(() => {
    const trimmed = (value || '').trim();
    let next = null;
    if (/^\d+$/.test(trimmed)) next = trimmed;
    else next = extractIdFromText(trimmed);
    setParsedId(next);
    if (error && next) setError('');
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSave = async () => {
    setError('');
    let trimmed = (value || '').trim();

    if (!/^\d+$/.test(trimmed)) {
      const extracted = extractIdFromText(trimmed);
      if (extracted) trimmed = extracted;
    }

    if (!trimmed) {
      setError('Please enter your FPL ID.');
      return;
    }
    if (!/^\d+$/.test(trimmed)) {
      setError('FPL ID must be numbers only (you can paste a full FPL link).');
      return;
    }

    setSaving(true);
    try {
      await updateFplId(trimmed);
      navigation.dispatch(
        CommonActions.navigate({
          name: 'Rank',
          params: {},
          merge: false,
        })
      );
    } catch (e) {
      setError('Failed to save your ID. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color={C.accent} />
          <Text style={styles.muted}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const hasText = (value || '').length > 0;
  const isValid = !!parsedId;

  return (
    <SafeAreaView style={styles.safe}>
      <AppHeader />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.select({ ios: 'padding', android: undefined })}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          {/* Value / Hero */}
          <ValueProps C={C} styles={styles} />

          {/* Input Card */}
          <View style={styles.card}>
            {/* Theme toggle row */}
            <View style={styles.themeRow}>
              <Text style={styles.themeLabel}>Theme</Text>
              <View style={styles.themeSeg}>
                <TouchableOpacity
                  onPress={() => setMode('dark')}
                  activeOpacity={0.85}
                  style={[styles.segment, mode === 'dark' && styles.segmentActive]}
                  accessibilityRole="button"
                  accessibilityLabel="Switch to dark mode"
                >
                  <Text style={[styles.segmentText, mode === 'dark' && styles.segmentTextActive]}>
                    Dark
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setMode('light')}
                  activeOpacity={0.85}
                  style={[styles.segment, mode === 'light' && styles.segmentActive]}
                  accessibilityRole="button"
                  accessibilityLabel="Switch to light mode"
                >
                  <Text style={[styles.segmentText, mode === 'light' && styles.segmentTextActive]}>
                    Light
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <Text style={styles.title}>Enter your FPL ID</Text>
            <Text style={styles.subtitle}>
              We only use your public FPL ID on this device.
            </Text>

            <View
  style={[
    styles.inputRow,
    error && { borderColor: C.danger, backgroundColor: isDark ? 'rgba(220,38,38,0.08)' : '#fff5f5' },
    !error && isValid && { borderColor: C.ok, backgroundColor: isDark ? 'rgba(16,185,129,0.10)' : '#f0fff4' },
  ]}
>
  <ThemedTextInput
    ref={inputRef}
    style={styles.input} // transparent bg handled inside ThemedTextInput
    placeholder="e.g. 1234567 or paste a link"
    placeholderTextColor={C.muted}
    value={value}
    onChangeText={(t) => setValue(sanitizeInput(t))}
    keyboardType="number-pad"
    inputMode="numeric"
    returnKeyType="done"
    enterKeyHint="done"
    blurOnSubmit
    onSubmitEditing={() => inputRef.current?.blur()}
    autoCapitalize="none"
    autoCorrect={false}
    selectionColor={C.accent}
    accessibilityLabel="Your FPL ID"
    maxLength={10}
    textContentType={Platform.OS === 'ios' ? 'oneTimeCode' : 'none'}
  />
</View>


            {/* Live parsed feedback */}
            <View style={{ minHeight: 18, marginTop: 6 }}>
              {isValid ? (
                <Text style={styles.validHint}>
                  Detected ID: <Text style={styles.validId}>{parsedId}</Text>
                </Text>
              ) : hasText ? (
                <Text style={styles.mutedSmall}>Paste a full FPL link or enter digits only.</Text>
              ) : null}
            </View>

            <TouchableOpacity
              style={[styles.primaryBtn, saving && { opacity: 0.8 }]}
              onPress={onSave}
              disabled={saving}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Continue"
            >
              {saving ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.primaryBtnText}>Continue</Text>
              )}
            </TouchableOpacity>

            {!!error && (
              <View style={styles.errRow}>
                <MaterialCommunityIcons name="alert-circle-outline" size={16} color={C.danger} />
                <Text style={styles.error}>{'  '}{error}</Text>
              </View>
            )}

            {/* Help toggle + panel */}
            <TouchableOpacity
              onPress={() => setShowHelp((s) => !s)}
              activeOpacity={0.8}
              style={styles.helpToggle}
            >
              <MaterialCommunityIcons
                name={showHelp ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={C.muted}
              />
              <Text style={styles.helpToggleText}>
                {showHelp ? 'Hide help' : 'Don’t know your ID? Find it'}
              </Text>
            </TouchableOpacity>

            {showHelp && (
              <View style={styles.helpBox}>
                <Text style={styles.helpHeading}>Find your ID in 3 steps</Text>
                <Text style={styles.helpBullet}>
                  1) Log in at{' '}
                  <Text style={styles.linkish} onPress={() => openUrl('https://fantasy.premierleague.com')}>
                    fantasy.premierleague.com
                  </Text>
                </Text>
                <Text style={styles.helpBullet}>
                  2) Open <Text style={styles.bold}>Points</Text> or <Text style={styles.bold}>Gameweek History</Text>
                </Text>
                <Text style={styles.helpBullet}>
                  3) Copy the number after <Text style={styles.codeInline}>/entry/</Text>
                </Text>

                <View style={styles.codeBlock}>
                  <Text
                    selectable
                    style={styles.codeText}
                    onPress={() => openUrl('https://fantasy.premierleague.com/entry/1234567/event/1')}
                  >
                    https://fantasy.premierleague.com/entry/1234567/event/1
                  </Text>
                </View>

                <Text style={styles.tip}>
                  Tip: Paste your FPL link—we’ll extract the ID automatically.
                </Text>
              </View>
            )}
          </View>

          {/* Notice about free period / subscription (updated copy) */}
          <View style={styles.noticeCard}>
            <MaterialCommunityIcons
              name="information-outline"
              size={16}
              color={isDark ? '#C7D2FE' : '#4338CA'}
              style={{ marginRight: 8 }}
            />
            <Text style={styles.noticeText}>
              This is an initial test version of the app. All app features are free &amp; unlimited right now.
              In a few weeks, some features may require a subscription to allow unlimited use.
            </Text>
          </View>

          {/* Footer with Buy Me a Coffee */}
          <View style={styles.signatureWrap}>
            <Text style={styles.signatureText}>© LiveFPL by Ragabolly 2025</Text>
            <TouchableOpacity
              onPress={() => openUrl('https://buymeacoffee.com/ragabolly')}
              style={styles.coffeeBtn}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Buy me a coffee (opens external link)"
            >
              <MaterialCommunityIcons name="coffee" size={14} color={C.ink} />
              <Text style={styles.coffeeText}>Buy Ragabolly a coffee</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* -------------------- Styles (theme-driven) -------------------- */
const createStyles = (C, isDark) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: C.bg },

    /* Page container */
    container: {
      paddingHorizontal: 20,
      paddingTop: 18,
      paddingBottom: 20,
      alignItems: 'center',
      gap: 12,
    },

    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    muted: { color: C.muted, marginTop: 8 },
    mutedSmall: { color: C.muted, fontSize: 12 },

    /* Value / hero */
    valueCard: {
      width: '100%',
      maxWidth: 520,
      backgroundColor: C.card,
      borderRadius: 14,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: C.border,
    },
    valueHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      justifyContent: 'center',
    },
    valueHeading: {
      color: C.ink,
      fontWeight: '900',
      fontSize: 16,
      letterSpacing: 0.2,
      textAlign: 'center',
    },
    learnMoreLink: {
      alignSelf: 'center',
      marginTop: 6,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    learnMoreText: { color: C.muted, fontSize: 12, textDecorationLine: 'underline' },

    /* Notice card */
    noticeCard: {
      width: '100%',
      maxWidth: 520,
      flexDirection: 'row',
      alignItems: 'flex-start',
      borderRadius: 12,
      padding: 10,
      borderWidth: 1,
      borderColor: isDark ? '#243b5a' : '#c7d2fe',
      backgroundColor: isDark ? 'rgba(59,130,246,0.10)' : '#eef2ff',
    },
    noticeText: {
      flex: 1,
      color: C.ink,
      fontSize: 12,
      lineHeight: 18,
    },

    /* Input card */
    card: {
      width: '100%',
      maxWidth: 520,
      backgroundColor: C.card,
      borderRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor: C.border,
      shadowColor: '#000',
      shadowOpacity: isDark ? 0 : 0.16,
      shadowRadius: isDark ? 0 : 10,
      shadowOffset: { width: 0, height: isDark ? 0 : 4 },
      elevation: isDark ? 0 : 5,
    },

    /* Theme toggle */
    themeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 10,
    },
    themeLabel: { color: C.muted, fontWeight: '800', fontSize: 12 },
    themeSeg: { flexDirection: 'row', gap: 8 },
    segment: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.border,
      backgroundColor: C.chipBg ?? (isDark ? '#0f172a' : '#eef2ff'),
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 999,
      minHeight: 40,
      justifyContent: 'center',
    },
    segmentActive: {
      backgroundColor: C.accent,
      borderColor: C.accentDark,
    },
    segmentText: {
      color: isDark ? C.ink : '#0b1220',
      fontWeight: '800',
      fontSize: 12,
      letterSpacing: 0.2,
    },
    segmentTextActive: { color: '#ffffff' },

    title: { fontSize: 18, fontWeight: '900', color: C.ink, marginTop: 2 },
    subtitle: { fontSize: 12, color: C.muted, marginTop: 4, marginBottom: 10 },

    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 48,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: C.inputBorder,
      backgroundColor: C.inputBg,
      paddingHorizontal: 10,
      overflow: 'hidden',   // clip rounded corners so nothing bleeds
    },
    input: {
      flex: 1,
      color: C.ink,
      // paddingVertical handled in ThemedTextInput; keep here if you want overrides
    },
    clearBtn: {
      height: 40,
      minWidth: 32,
      alignItems: 'center',
      justifyContent: 'center',
      marginHorizontal: 2,
    },

    validHint: { color: C.muted, fontSize: 12 },
    validId: { color: C.ink, fontWeight: '800' },

    errRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
    error: { color: C.danger },

    /* Help toggle + panel */
    helpToggle: {
      marginTop: 12,
      alignSelf: 'center',
      paddingVertical: 6,
      paddingHorizontal: 8,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    helpToggleText: { color: C.muted, fontSize: 13 },

    linkish: { color: C.ink, textDecorationLine: 'underline' },

    helpBox: {
      marginTop: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: isDark ? C.border2 : '#e5e7eb',
      backgroundColor: isDark ? '#0c1322' : '#f9fafb',
      padding: 12,
    },
    helpHeading: {
      color: C.ink,
      fontWeight: '800',
      fontSize: 14,
      marginBottom: 6,
    },
    helpBullet: { color: C.muted, marginBottom: 4, lineHeight: 20 },
    bold: { fontWeight: '800', color: C.ink },

    codeBlock: {
      marginTop: 6,
      borderRadius: 8,
      backgroundColor: isDark ? C.codeBg : '#eef2ff',
      padding: 10,
    },
    codeText: {
      color: isDark ? C.codeInk : '#111827',
      textDecorationLine: 'underline',
      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    },
    codeInline: {
      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
      color: C.ink,
    },
    tip: { color: C.muted, marginTop: 8 },

    /* Footer */
    signatureWrap: {
      display:'none',
      width: '100%',
      maxWidth: 520,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 10,
      flexWrap: 'wrap',
      marginTop: 12,
      marginBottom: 12,
    },
    signatureText: {
      color: C.muted,
      fontSize: 12,
    },
    coffeeBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: isDark ? C.border2 : '#d1d5db',
      backgroundColor: isDark ? '#0b1320' : '#eef2ff',
    },
    coffeeText: {
      color: C.ink,
      fontSize: 12,
      fontWeight: '800',
    },

    /* Sticky CTA */
    ctaBar: {
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: C.border,
      backgroundColor: C.bg,
    },
    primaryBtn: {
      height: 48,
      borderRadius: 10,
      backgroundColor: C.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryBtnText: { color: '#ffffff', fontWeight: '900', fontSize: 15, letterSpacing: 0.2 },
  });
