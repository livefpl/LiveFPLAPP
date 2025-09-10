// components/AppHeader.js
import React from 'react';
import { SafeAreaView, View, Image, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme, useColors } from './theme';
import { assetImages } from './clubs';

const DEFAULT_LOGO = assetImages?.livefplLogo ?? assetImages?.logo;

export default function AppHeader({
  logoSource = DEFAULT_LOGO,
  showModeToggle = true,
  style,
  pillBg,       // optional override for the logo pill background
  pillBorder,   // optional override for the pill border
}) {
  const colors = useColors();
  const { mode, setMode } = useTheme();

  // cycle: dark -> light -> system -> dark
  const onToggleMode = () => {
    if (mode === 'dark') setMode('light');
    
    else setMode('dark');
  };

  const iconName =
    mode === 'light' ? 'white-balance-sunny' :
    mode === 'dark'  ? 'moon-waning-crescent' :
                       'theme-light-dark';

  return (
    <SafeAreaView style={[styles.safe, style]}>
      <View style={styles.row}>
        {/* left spacer keeps logo centered */}
        <View style={styles.sideSpacer} />

        {/* centered logo in a compact pill */}
        <View
          style={[
            styles.logoPill,
            {
              backgroundColor: pillBg ?? '#0b0c10',        // fixed dark for contrast in light mode
              borderColor: pillBorder ?? colors.border,    // themed border
            },
          ]}
        >
          {logoSource ? (
            <Image source={logoSource} style={styles.logo} resizeMode="contain" />
          ) : (
            <Text style={[styles.title, { color: colors.ink }]}>LiveFPL</Text>
          )}
        </View>

        {/* right side: tiny icon toggle */}
        <View style={styles.sideRight}>
          {showModeToggle && (
            <TouchableOpacity
              onPress={onToggleMode}
              onLongPress={() => setMode('system')}
              activeOpacity={0.8}
              style={[
                styles.iconBtn,
                { backgroundColor: colors.stripBg, borderColor: colors.border2 },
              ]}
              accessibilityLabel="Toggle theme"
            >
              <MaterialCommunityIcons name={iconName} size={18} color={colors.ink} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: 'transparent',
  },
  row: {
    height: 44,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sideSpacer: { width: 44 },  // roughly matches the toggle width so center stays centered
  sideRight: {
    width: 44,
    alignItems: 'flex-end',
  },
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
  logo: {
    height: 24,
    width: 160,
  },
  title: {
    fontWeight: '900',
    fontSize: 16,
  },
  iconBtn: {
    height: 32,
    width: 32,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
