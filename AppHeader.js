// components/AppHeader.js
import React from 'react';
import { SafeAreaView, View, Image, Text, StyleSheet, TouchableOpacity, StatusBar, Platform } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTheme, useColors } from './theme';
import { assetImages } from './clubs';

const DEFAULT_LOGO = assetImages?.livefplLogo ?? assetImages?.logo;
const SIDE_WIDTH = 66; // same on both sides to keep the logo centered

export default function AppHeader({
  logoSource = DEFAULT_LOGO,
  showModeToggle = true,
  showChangeId = true, // show ID button on the LEFT
  onPressChangeId,
  style,
  pillBg,
  pillBorder,
}) {
  const { navTheme, mode, setMode } = useTheme();
  const colors = useColors();
  const navigation = useNavigation();

  const headerBg = navTheme?.colors?.background ?? colors.bg;
  const isDark = !!navTheme?.dark;
  const iconName = mode === 'dark' ? 'moon-waning-crescent' : 'white-balance-sunny';

  const onToggleMode = () => setMode(mode === 'dark' ? 'light' : 'dark');
  const handleGoChangeId = () =>
    typeof onPressChangeId === 'function' ? onPressChangeId() : navigation.navigate('ID');

  return (
    <SafeAreaView style={[styles.safe, style, { backgroundColor: headerBg }]}>
      {/* Control the OS status bar color *from here* so Android doesn't show white above the header */}
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={headerBg}      // Android uses this
        translucent={false}             // don't draw under the status bar
      />

      <View style={styles.row}>
        {/* LEFT controls (mirrors right): ID */}
        <View style={styles.sideLeft}>
          <View style={styles.iconRowLeft}>
            {showChangeId && (
              <TouchableOpacity
                onPress={handleGoChangeId}
                activeOpacity={0.85}
                style={[styles.iconBtn, { backgroundColor: colors.stripBg, borderColor: colors.border2 }]}
                accessibilityRole="button"
                accessibilityLabel="Open Change ID"
                testID="btn-change-id"
              >
                <MaterialCommunityIcons name="account-edit" size={18} color={colors.ink} />
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

        {/* RIGHT controls: theme toggle */}
        <View style={styles.sideRight}>
          <View style={styles.iconRowRight}>
            {showModeToggle && (
              <TouchableOpacity
                onPress={onToggleMode}
                onLongPress={() => setMode('system')}
                activeOpacity={0.85}
                style={[styles.iconBtn, { backgroundColor: colors.stripBg, borderColor: colors.border2 }]}
                accessibilityRole="button"
                accessibilityLabel="Toggle theme"
                testID="btn-toggle-theme"
              >
                <MaterialCommunityIcons name={iconName} size={18} color={colors.ink} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </SafeAreaView>
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

  iconRowLeft:  { flexDirection: 'row', gap: 8 },
  iconRowRight: { flexDirection: 'row', gap: 8 },

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
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
