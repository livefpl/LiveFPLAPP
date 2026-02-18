// components/AppHeader.js
import React, { useState, useEffect } from 'react';
import { SafeAreaView, View, Image, Text, StyleSheet, TouchableOpacity, StatusBar, Alert } from 'react-native';

import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useTheme, useColors } from './theme';
import { assetImages } from './clubs';
import { usePro } from './ProContext';
import { setStoredLanguage } from './i18n';

import PaywallScreen from './Paywallscreen';

const DEFAULT_LOGO = assetImages?.livefplLogo ?? assetImages?.logo;
const SIDE_WIDTH = 70; // same on both sides to keep the logo centered

const LANG_CODES = ['en', 'es', 'ar', 'fr', 'de'];

export default function AppHeader({
  logoSource = DEFAULT_LOGO,
  showModeToggle = true,
  showChangeId = true,     // show ID button on the LEFT (next to Go Pro)
  showGoPro = true,       // controls the "Go Pro" pill
  showLanguage = true,    // show language icon on the RIGHT (next to theme)
  onPressChangeId,
  onPressGoPro,           // optional override; otherwise opens local PaywallScreen overlay
  style,
  pillBg,
  pillBorder,
}) {
  const { t, i18n } = useTranslation();
  const langCode = (i18n.language || 'en').split('-')[0].toUpperCase();
  const langLabel = LANG_CODES.includes(langCode.toLowerCase()) ? langCode : 'EN';
  const { navTheme, mode, setMode } = useTheme();
  const colors = useColors();
  const navigation = useNavigation();
  const { isPro } = usePro();

  const [paywallOpen, setPaywallOpen] = useState(false); // ← local page overlay

  const headerBg = navTheme?.colors?.background ?? colors.bg;
  const isDark = !!navTheme?.dark;
  const iconName = mode === 'dark' ? 'moon-waning-crescent' : 'white-balance-sunny';

  const onToggleMode = () => setMode(mode === 'dark' ? 'light' : 'dark');

  // Change ID: on the LEFT next to Go Pro
  const handleGoChangeId = () =>
    typeof onPressChangeId === 'function'
      ? onPressChangeId()
      : (setPaywallOpen(false), navigation.navigate('ID'));

  // Language picker: show alert with 5 options
  const showLanguagePicker = () => {
    Alert.alert(
      t('language.title'),
      null,
      [
        ...LANG_CODES.map((code) => ({
          text: t(`language.${code}`),
          onPress: () => setStoredLanguage(code),
        })),
        { text: t('common.cancel'), style: 'cancel' },
      ]
    );
  };

  // Local, no-navigation Go Pro handler → show page overlay
  const handleGoPro = () => {
    if (typeof onPressGoPro === 'function') return onPressGoPro();
    setPaywallOpen(true);
  };

useEffect(() => {
  const unsubBlur = navigation.addListener('blur', () => setPaywallOpen(false));
  const unsubTabPress = navigation.addListener('tabPress', () => setPaywallOpen(false));
  const unsubFocus = navigation.addListener('focus', () => setPaywallOpen(false));

  return () => {
    unsubBlur();
    unsubTabPress();
    unsubFocus();
  };
}, [navigation]);


  return (
    <>
      <SafeAreaView
        style={[styles.safe, style, { backgroundColor: headerBg }]}
        // Optional: prevent taps leaking to header while overlay is open
        pointerEvents={paywallOpen ? 'none' : 'auto'}
      >
        {/* Control the OS status bar color from here */}
        <StatusBar
          barStyle={isDark ? 'light-content' : 'dark-content'}
          backgroundColor={headerBg}
          translucent={false}
        />

        <View style={styles.row}>
          {/* LEFT: Go Pro pill + Change ID icon */}
          <View style={styles.sideLeft}>
            <View style={styles.iconRowLeft}>
              {showGoPro && (
                <TouchableOpacity
                  onPress={handleGoPro}
                  activeOpacity={isPro ? 1 : 0.9}
                  style={[
                    styles.proPill,
                    {
                      borderColor: colors.border2,
                      backgroundColor: colors.stripBg,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={isPro ? 'Premium' : 'Open Go Pro'}
                  testID="btn-go-pro"
                >
                  <MaterialCommunityIcons
                    name="crown-outline"
                    size={12}
                    color={isDark ? '#ffd76a' : '#8a5a00'}
                  />
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.proText,
                      { color: colors.ink, fontWeight: '700' },
                    ]}
                  >
                    {isPro ? 'Premium' : 'No Ads'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* CENTER logo pill */}
          <View
            style={[
              styles.logoPill,
              {
                backgroundColor: pillBg ?? '#0b0c10',
                borderColor: pillBorder ?? colors.border,
              },
            ]}
          >
            {logoSource ? (
              <Image source={logoSource} style={styles.logo} resizeMode="contain" />
            ) : (
              <Text style={[styles.title, { color: colors.ink }]}>LiveFPL</Text>
            )}
          </View>

          {/* RIGHT controls: Change ID + Language + theme toggle */}
          <View style={styles.sideRight}>
            <View style={styles.iconRowRight}>
              {showChangeId && (
                <TouchableOpacity
                  onPress={handleGoChangeId}
                  hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                  activeOpacity={0.85}
                  style={[styles.iconBtn, styles.iconBtnSmall, { backgroundColor: colors.stripBg, borderColor: colors.border2 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Open Change ID"
                  testID="btn-change-id"
                >
                  <MaterialCommunityIcons name="account-edit" size={16} color={colors.ink} />
                </TouchableOpacity>
              )}
              {showLanguage && (
                <TouchableOpacity
                  onPress={showLanguagePicker}
                  hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                  activeOpacity={0.85}
                  style={[styles.iconBtn, styles.iconBtnSmall, { backgroundColor: colors.stripBg, borderColor: colors.border2 }]}
                  accessibilityRole="button"
                  accessibilityLabel={t('language.title')}
                  testID="btn-language"
                >
                  <Text style={[styles.langLabel, { color: colors.ink }]} numberOfLines={1}>{langLabel}</Text>
                </TouchableOpacity>
              )}

              {showModeToggle && (
                <TouchableOpacity
                  onPress={onToggleMode}
                  onLongPress={() => setMode('system')}
                  activeOpacity={0.85}
                  style={[styles.iconBtn, styles.iconBtnSmall, { backgroundColor: colors.stripBg, borderColor: colors.border2 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Toggle theme"
                  testID="btn-toggle-theme"
                >
                  <MaterialCommunityIcons name={iconName} size={16} color={colors.ink} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </SafeAreaView>

      {/* Full-screen overlay page (no navigation, no Modal) */}
      {paywallOpen && (
        <View style={styles.fullscreen}>
          {/* PaywallScreen can call onClose() to dismiss */}
          <PaywallScreen onClose={() => setPaywallOpen(false)} />
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  safe: {
    // bg is provided dynamically via headerBg
  },
  row: {
    height: 44,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  // symmetric side containers
  sideLeft:  { width: SIDE_WIDTH, alignItems: 'flex-start',  justifyContent: 'center' },
  sideRight: { width: SIDE_WIDTH, alignItems: 'flex-end',    justifyContent: 'center' },

  iconRowLeft:  { flexDirection: 'row', gap: 8, alignItems: 'center' },
  iconRowRight: { flexDirection: 'row', gap: 8, alignItems: 'center', height: 24 },

  logoPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    minWidth: 120,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  logo: { height: 24, width: 160 },
  title: { fontWeight: '900', fontSize: 16 },

  iconBtn: {
    height: 32,
    width: 32,
    minWidth: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnSmall: {
    height: 24,
    width: 24,
    minWidth: 24,
    borderRadius: 12,
  },
  langLabel: {
    fontSize: 10,
    fontWeight: '700',
  },

  proPill: {
  height: 26,
  borderRadius: 999,
  borderWidth: 1,
  paddingHorizontal: 8,
  flexDirection: 'row',
  alignItems: 'center',      // vertical center (row axis)
  justifyContent: 'center',  // <-- horizontal center
  gap: 4,                    // space between icon & text
  alignSelf: 'center',       // (optional) center pill within the LEFT lane
},
proText: {
  fontWeight: '700',
  fontSize: 11,
  lineHeight: 14,
  textAlign: 'center',       // keep text centered if it wraps
},

  // Fullscreen overlay container for PaywallScreen
  fullscreen: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    // PaywallScreen controls its own background
  },
});
