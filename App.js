// App.js
import React from 'react';
import { View, StyleSheet, StatusBar, Platform } from 'react-native';
import { NavigationContainer, CommonActions } from '@react-navigation/native';
import { createBottomTabNavigator, BottomTabBar } from '@react-navigation/bottom-tabs';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ProProvider } from './ProContext';

import { setTrigger, setConfig, bump } from './meter';
import { showOnce } from './AdInterstitial';
import { ThemeProvider, useTheme, useColors } from './theme';
import { Text, TextInput } from 'react-native';
import { getTrackingPermissionsAsync, requestTrackingPermissionsAsync } from 'expo-tracking-transparency';

Text.defaultProps = Text.defaultProps || {};
Text.defaultProps.allowFontScaling = false;
TextInput.defaultProps = TextInput.defaultProps || {};
TextInput.defaultProps.allowFontScaling = false;

const LOCAL_BUILD = 1; // ← your hardcoded app build/version
const CONFIG_URL = 'https://livefpl.us/version.json';
const DEFAULT_REMOTE_VERSION = 1;
import ForceUpdateGate from './checkversion';

import Rank from './Rank.js';
import PricesPage from './Prices.js';
import { FplIdProvider } from './FplIdContext';
import Leagues from './league';
import Threats from './threats';
import PlannerScreen from './planner';
import WhatIf from './whatif';
import Games from './games';
import AdFooter from './ad';
import ChangeID from './ChangeID';
import Achievements from './achievements';

// Configure once (safe even with HMR; no UI side effects)
setConfig({ N: 1000, cooldownMs: 5_000, dedupeTtlMs: 1_000 });
setTrigger((ctx) => showOnce({ reason: `meter:${ctx.source}:${ctx.count}` }));

const Tab = createBottomTabNavigator();

/* ------------------------ Tabs ------------------------ */
function MyTabs() {
  const C = useColors();

  return (
    <Tab.Navigator
      initialRouteName="Rank"
      screenOptions={({ route }) => ({
        tabBarIcon: ({ color }) => {
          let iconName;
          switch (route.name) {
            case 'Battle': iconName = 'sword-cross'; break;
            case 'Prices': iconName = 'finance'; break;
            case 'Leagues': iconName = 'trophy'; break;
            case 'Rank': iconName = 'chart-line'; break;
            case 'ID': iconName = 'account-edit'; break;
            case 'Games': iconName = 'soccer'; break;
            case 'Trophies': iconName = 'medal'; break;
            case 'Planner': iconName = 'calendar-edit'; break;
            case 'What If': iconName = 'lightbulb-on-outline'; break;
            default: iconName = 'account'; break;
          }
          return <MaterialCommunityIcons name={iconName} size={19} color={color} />;
        },

        headerShown: false,
        tabBarActiveTintColor: C.accent,
        tabBarInactiveTintColor: C.muted,
        tabBarStyle: {
          backgroundColor: C.bg,          // ← themed (dark in dark mode)
          borderTopColor: C.border,
          borderTopWidth: 1,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700' },
        tabBarIconStyle: { marginTop: 2 },
        tabBarItemStyle: { paddingVertical: 2 },
        tabBarHideOnKeyboard: true,
        tabBarPressColor: C.accentDark,   // Android ripple (themed)
      })}
      // Keep your ad footer stacked above the real tab bar
      tabBar={(props) => {
        const i = props.state.index;
        const activeRoute = props.state.routeNames[i]; // e.g., 'Rank', 'Leagues', ...
        return (
          <View>
            <AdFooter key={`ad-${activeRoute}`} slot={activeRoute} />
            <BottomTabBar {...props} />
          </View>
        );
      }}
    >
      <Tab.Screen
        name="Rank"
        component={Rank}
        listeners={({ navigation }) => ({
          tabPress: () => {
            navigation.dispatch(
              CommonActions.navigate({
                name: 'Rank',
                params: {},   // wipe stale params like { viewFplId }
                merge: false, // do not merge with existing route params
              })
            );
          },
        })}
      />

      <Tab.Screen name="Battle" component={Threats} />
      <Tab.Screen name="Leagues" component={Leagues} />
      <Tab.Screen name="Prices" component={PricesPage} />
      <Tab.Screen name="Games" component={Games} />

      <Tab.Screen name="What If" component={WhatIf} />
      <Tab.Screen name="Planner" component={PlannerScreen} />
      <Tab.Screen
        name="Trophies"
        component={Achievements}
        options={{
          tabBarButton: () => null,   // hides it from the bottom bar
          tabBarIcon: () => null,     // (optional) don’t reserve icon space
          tabBarLabel: () => null,    // (optional) belt & suspenders
        }}
      />
      <Tab.Screen
        name="ID"
        component={ChangeID}
        options={{
          tabBarButton: () => null,   // hides it from the bottom bar
          tabBarIcon: () => null,     // (optional) don’t reserve icon space
          tabBarLabel: () => null,    // (optional) belt & suspenders
        }}
      />
    </Tab.Navigator>
  );
}

/* -------- Root navigation (needs theme) -------- */
function RootNavigation({ navRef, onReady, onStateChange, attStatus }) {
  const { navTheme } = useTheme();
  const C = useColors();
  const isDark = navTheme?.dark;

  return (
    <>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      {/* Tiny non-interactive badge to show ATT status */}
      <View
        pointerEvents="none"
        style={[
          styles.attBadge,
          { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', borderColor: C.border }
        ]}
      >
        <Text style={{ fontSize: 11, fontWeight: '800', color: C.ink }}>
          ATT: {attStatus}
        </Text>
      </View>

      <NavigationContainer ref={navRef} onReady={onReady} onStateChange={onStateChange} theme={navTheme}>
        <MyTabs />
      </NavigationContainer>
    </>
  );
}

/* ------------------------ App ------------------------ */
export default function App() {
  const navRef = React.useRef(null);
  const prevRouteNameRef = React.useRef(null);

  // --- Track and show ATT status in UI ---
  const [attStatus, setAttStatus] = React.useState(Platform.OS === 'ios' ? 'checking…' : 'N/A');

  React.useEffect(() => {
    (async () => {
      try {
        if (Platform.OS !== 'ios') return;
        const first = await getTrackingPermissionsAsync();
        setAttStatus(first?.status ?? 'unknown');

        if (first?.status === 'undetermined' || (first?.status === 'denied' && first?.canAskAgain)) {
          // Give the app a moment to fully mount before prompting
          await new Promise(r => setTimeout(r, 400));
          const after = await requestTrackingPermissionsAsync();
          setAttStatus(after?.status ?? 'unknown');
        }
      } catch {
        setAttStatus('unavailable');
      }
    })();
  }, []);

  const onReady = () => {
    prevRouteNameRef.current = navRef.current?.getCurrentRoute?.()?.name ?? null;
  };

  const onStateChange = () => {
    const name = navRef.current?.getCurrentRoute?.()?.name;
    if (name && name !== prevRouteNameRef.current) {
      prevRouteNameRef.current = name;
      setTimeout(() => bump({ source: 'nav', force: true }), 0); // keep your ad meter bump
    }
  };

  return (
    <ThemeProvider>
      <ForceUpdateGate localBuild={LOCAL_BUILD} configUrl={CONFIG_URL} defaultRemote={DEFAULT_REMOTE_VERSION}>
        <FplIdProvider>
          <ThemeProvider>
            <ProProvider>
              <RootNavigation
                navRef={navRef}
                onReady={onReady}
                onStateChange={onStateChange}
                attStatus={attStatus}
              />
            </ProProvider>
          </ThemeProvider>
        </FplIdProvider>
      </ForceUpdateGate>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f2f2f2', // unused, safe to keep
  },
  attBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 9999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    display:'none'
  },
});
