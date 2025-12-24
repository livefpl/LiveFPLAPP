// App.js
import React, { useEffect } from 'react';
import {
  View,
  StyleSheet,
  StatusBar,
  TouchableOpacity,
  Text as RNText,
  Text,
  Alert,
  TextInput,
} from 'react-native';

import { NavigationContainer, CommonActions, useNavigation } from '@react-navigation/native';
import { createBottomTabNavigator, BottomTabBar } from '@react-navigation/bottom-tabs';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { ThemeProvider, useTheme, useColors } from './theme';
import { ProProvider, usePro } from './ProContext';
import { FplIdProvider } from './FplIdContext';

import ForceUpdateGate from './checkversion';
import { initPlaywire } from './playwireInit';

import { setTrigger, setConfig, bump } from './meter';
import { showOnce, setAdGuard } from './AdInterstitial';

import Rank from './Rank.js';
import PricesPage from './Prices.js';
import Leagues from './league';
import Threats from './threats';
import PlannerScreen from './planner';
import WhatIf from './whatif';
import Games from './games';
import AdFooter from './ad';
import ChangeID from './ChangeID';
import Achievements from './achievements';
import TemplatesChipsAverages from './TemplatesChipsAverages';
import Paywallscreen from './Paywallscreen';

Text.defaultProps = Text.defaultProps || {};
Text.defaultProps.allowFontScaling = false;
TextInput.defaultProps = TextInput.defaultProps || {};
TextInput.defaultProps.allowFontScaling = false;

const LOCAL_BUILD = 1;
const CONFIG_URL = 'https://livefpl.us/version.json';
const DEFAULT_REMOTE_VERSION = 1;

setConfig({ N: 1000, cooldownMs: 5_000, dedupeTtlMs: 1_000 });

// Debug-only: if meter hits N but interstitial doesn't show, alert why.
const AD_DEBUG_MISSES = 0;
let _lastMissAlertAt = 0;

setTrigger(async (ctx) => {
  const res = await showOnce({ reason: `meter:${ctx.source}:${ctx.count}` });

  if (AD_DEBUG_MISSES && (!res || res.shown !== true)) {
    const now = Date.now();

    // Throttle so N=3 doesn't spam you if SDK isn't ready / no fill.
    if (now - _lastMissAlertAt > 1000) {
      _lastMissAlertAt = now;

      Alert.alert(
        'Interstitial missed',
        [
          `count=${ctx.count}`,
          `source=${ctx.source}`,
          `provider=${res?.provider || 'unknown'}`,
          `reason=${res?.reason || ''}`,
        ].join('\n')
      );
    }
  }

  return res;
});

const Tab = createBottomTabNavigator();
function Empty() {
  return null;
}

// This ensures interstitials are blocked until Pro state is known,
// and then blocked for Pro users.
function AdsProGate() {
  const { isReady, isPro } = usePro();

  useEffect(() => {
    setAdGuard(() => !isReady || !!isPro);
  }, [isReady, isPro]);

  return null;
}


/* ------------------------ Tabs ------------------------ */
function MyTabs() {
  const C = useColors();
  const navigation = useNavigation();

  // chromeH = combined height of AdFooter + BottomTabBar (measured)
  const [chromeH, setChromeH] = React.useState(60);
  const [moreOpen, setMoreOpen] = React.useState(false);

  const PopItem = ({ icon, label, target, onPress }) => {
    const handle =
      onPress ??
      (() => {
        setMoreOpen(false);
        navigation.navigate(target);
      });
    return (
      <TouchableOpacity
        onPress={handle}
        activeOpacity={0.9}
        style={[styles.moreRow, { borderColor: C.border, backgroundColor: C.card }]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <MaterialCommunityIcons name={icon} size={20} color={C.ink} />
          <RNText style={[styles.moreText, { color: C.ink }]}>{label}</RNText>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={20} color={C.muted} />
      </TouchableOpacity>
    );
  };

  const MorePopover = () => {
    if (!moreOpen) return null;
    return (
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        {/* Click-away area ABOVE chrome so tab bar stays clickable */}
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setMoreOpen(false)}
          style={[styles.clickAway, { bottom: chromeH }]}
        />

        {/* Card anchored just above the chrome */}
        <View
          style={[
            styles.moreCard,
            { backgroundColor: C.card, borderColor: C.border, bottom: chromeH + 8 },
          ]}
        >
          <View style={styles.moreHeader}>
            <RNText style={[styles.moreTitle, { color: C.ink }]}>More</RNText>
            <TouchableOpacity
              onPress={() => setMoreOpen(false)}
              style={[styles.closeBtn, { borderColor: C.border, backgroundColor: C.stripBg }]}
            >
              <MaterialCommunityIcons name="close" size={16} color={C.ink} />
              <RNText style={[styles.closeText, { color: C.ink }]}>Close</RNText>
            </TouchableOpacity>
          </View>

          {/* Keep only non-tab destinations here */}
          <PopItem icon="poker-chip" label="Templates, Chips & Averages" target="Templates" />
          <PopItem icon="medal" label="Gameweek Trophies" target="Trophies" />
          <PopItem icon="account-edit" label="Change FPL ID" target="ID" />
          <PopItem icon="crown" label="Premium/Remove Ads" target="Premium" />
        </View>
      </View>
    );
  };

  return (
    <>
      <Tab.Navigator
        initialRouteName="Rank"
        screenOptions={({ route }) => ({
          tabBarIcon: ({ color }) => {
            let iconName;
            switch (route.name) {
              case 'Battle':
                iconName = 'sword-cross';
                break;
              case 'Prices':
                iconName = 'finance';
                break;
              case 'Leagues':
                iconName = 'trophy';
                break;
              case 'Rank':
                iconName = 'chart-line';
                break;
              case 'Games':
                iconName = 'soccer';
                break;
              case 'Planner':
                iconName = 'calendar-edit';
                break;
              case 'What If':
                iconName = 'lightbulb-on-outline';
                break;
              case 'More':
                iconName = 'dots-horizontal';
                break;

              // Hidden routes (no tab button)
              case 'Templates':
                iconName = 'poker-chip';
                break;
              case 'Trophies':
                iconName = 'medal';
                break;
              case 'ID':
                iconName = 'account-edit';
                break;
              case 'Premium':
                iconName = 'crown';
                break;
              default:
                iconName = 'account';
                break;
            }
            return <MaterialCommunityIcons name={iconName} size={19} color={color} />;
          },
          headerShown: false,
          tabBarActiveTintColor: C.accent,
          tabBarInactiveTintColor: C.muted,
          tabBarStyle: {
            backgroundColor: C.bg,
            borderTopColor: C.border,
            borderTopWidth: 1,
          },
          tabBarLabelStyle: { fontSize: 10, fontWeight: '700' },
          tabBarIconStyle: { marginTop: 2 },
          tabBarItemStyle: { paddingVertical: 2 },
          tabBarHideOnKeyboard: true,
          tabBarPressColor: C.accentDark,
        })}
        tabBar={(props) => {
          const i = props.state.index;
          const activeRoute = props.state.routeNames[i];

          return (
            <View onLayout={(e) => setChromeH(e.nativeEvent.layout.height || 60)}>
              <MorePopover />
              <AdFooter />
              <BottomTabBar
                {...props}
                onTabPress={(e) => {
                  const { name } = e.target
                    ? props.state.routes.find((r) => r.key === e.target) || {}
                    : {};
                  if (name && name !== 'More') setMoreOpen(false);
                  props.onTabPress?.(e);
                }}
              />
            </View>
          );
        }}
      >
        {/* ✅ Desired order:
            rank battle leagues prices games planner what if more */}
        <Tab.Screen
          name="Rank"
          component={Rank}
          listeners={({ navigation }) => ({
            tabPress: () => {
              navigation.dispatch(CommonActions.navigate({ name: 'Rank', params: {}, merge: false }));
            },
          })}
        />
        <Tab.Screen name="Battle" component={Threats} />
        <Tab.Screen name="Leagues" component={Leagues} />
        <Tab.Screen name="Prices" component={PricesPage} />
        <Tab.Screen name="Games" component={Games} />
        <Tab.Screen name="Planner" component={PlannerScreen} />
        <Tab.Screen name="What If" component={WhatIf} />

        {/* Toggle-only tab for popover */}
        <Tab.Screen
          name="More"
          component={Empty}
          listeners={{
            tabPress: (e) => {
              e.preventDefault();
              setMoreOpen((v) => !v);
            },
          }}
        />

        {/* Hidden routes opened from “More” */}
        <Tab.Screen
          name="Templates"
          component={TemplatesChipsAverages}
          options={{ tabBarButton: () => null, tabBarIcon: () => null, tabBarLabel: () => null }}
        />
        <Tab.Screen
          name="Trophies"
          component={Achievements}
          options={{ tabBarButton: () => null, tabBarIcon: () => null, tabBarLabel: () => null }}
        />
        <Tab.Screen
          name="ID"
          component={ChangeID}
          options={{ tabBarButton: () => null, tabBarIcon: () => null, tabBarLabel: () => null }}
        />
        <Tab.Screen
          name="Premium"
          component={Paywallscreen}
          options={{ tabBarButton: () => null, tabBarIcon: () => null, tabBarLabel: () => null }}
        />
      </Tab.Navigator>
    </>
  );
}


/* -------- Root navigation (needs theme) -------- */
function RootNavigation({ navRef, onReady, onStateChange }) {
  const { navTheme } = useTheme();
  const isDark = navTheme?.dark;

  return (
    <>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <NavigationContainer
        ref={navRef}
        onReady={onReady}
        onStateChange={onStateChange}
        theme={navTheme}
      >
        <MyTabs />
      </NavigationContainer>
    </>
  );
}

/* ------------------------ App ------------------------ */
export default function App() {
  useEffect(() => {
    const publisherId =
      process.env.EXPO_PUBLIC_PLAYWIRE_PUBLISHER_ID ||
      require('./app.json').expo.extra.playwire.publisherId;
    const iosAppId =
      process.env.EXPO_PUBLIC_PLAYWIRE_IOS_APP_ID ||
      require('./app.json').expo.extra.playwire.iosAppId;
    const androidAppId =
      process.env.EXPO_PUBLIC_PLAYWIRE_ANDROID_APP_ID ||
      require('./app.json').expo.extra.playwire.androidAppId;

    initPlaywire({ publisherId, iosAppId, androidAppId });
  }, []);


  const bootGraceRef = React.useRef(true);

useEffect(() => {
  const t = setTimeout(() => {
    bootGraceRef.current = false;
  }, 4500); // 2.5s grace period after app mount
  return () => clearTimeout(t);
}, []);

  const navRef = React.useRef(null);
  const prevRouteNameRef = React.useRef(null);

  const onReady = () => {
    prevRouteNameRef.current = navRef.current?.getCurrentRoute?.()?.name ?? null;
  };

  const onStateChange = () => {
  const name = navRef.current?.getCurrentRoute?.()?.name;
  if (name && name !== prevRouteNameRef.current) {
    prevRouteNameRef.current = name;

    // ✅ Never try to show interstitials during the boot window
    if (bootGraceRef.current) return;

    // ✅ Don’t force interstitials; let cooldown / readiness handle it
    setTimeout(() => bump({ source: 'nav' }), 250);
  }
};


  return (
    <ThemeProvider>
      <ForceUpdateGate
        localBuild={LOCAL_BUILD}
        configUrl={CONFIG_URL}
        defaultRemote={DEFAULT_REMOTE_VERSION}
      >
        <FplIdProvider>
          <ThemeProvider>
            <ProProvider>
              <AdsProGate />
              <RootNavigation navRef={navRef} onReady={onReady} onStateChange={onStateChange} />
            </ProProvider>
          </ThemeProvider>
        </FplIdProvider>
      </ForceUpdateGate>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  clickAway: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  moreCard: {
    position: 'absolute',
    left: 10,
    right: 10,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
  moreHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  moreTitle: { fontSize: 14, fontWeight: '900' },
  closeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  closeText: { fontSize: 12, fontWeight: '800' },
  moreRow: {
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  moreText: { fontSize: 14, fontWeight: '800' },
});
