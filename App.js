// App.js
import React from 'react';
import { View, StyleSheet, StatusBar } from 'react-native';
import { NavigationContainer, CommonActions } from '@react-navigation/native';
import { createBottomTabNavigator, BottomTabBar } from '@react-navigation/bottom-tabs';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { setTrigger, setConfig, bump } from './meter';
import { showOnce } from './AdInterstitial';
import { ThemeProvider, useTheme, useColors } from './theme';

const LOCAL_BUILD = 1; // ← your hardcoded app build/version
const CONFIG_URL = 'https://www.livefpl.net/app_version.json';
const DEFAULT_REMOTE_VERSION = 1;
import ForceUpdateGate from './checkversion';

import Rank from './Rank.js';
import PricesPage from './Prices.js';
import { FplIdProvider } from './FplIdContext';
import Leagues from './league';
import Threats from './threats';
import Games from './games';
import AdFooter from './ad';
import ChangeID from './ChangeID';

// Configure once (safe even with HMR; no UI side effects)
setConfig({ N: 10, cooldownMs: 5_000, dedupeTtlMs: 1_000 });
setTrigger((ctx) => showOnce({ reason: `meter:${ctx.source}:${ctx.count}` }));

const Tab = createBottomTabNavigator();

/* ------------------------ Tabs ------------------------ */
function MyTabs() {
  const C = useColors();

  return (
    <Tab.Navigator
      initialRouteName="Rank"
      screenOptions={({ route }) => ({
        tabBarIcon: ({ color, size }) => {
          let iconName;
          switch (route.name) {
            case 'Battle': iconName = 'sword-cross'; break;
            case 'Prices': iconName = 'finance'; break;
            case 'Leagues': iconName = 'trophy'; break;
            case 'Rank': iconName = 'chart-line'; break;
            case 'Change ID': iconName = 'account-edit'; break;
            case 'Games': iconName = 'soccer'; break;
            default: iconName = 'account'; break;
          }
          return <MaterialCommunityIcons name={iconName} size={size} color={color} />;
        },

        headerShown: false,
        tabBarActiveTintColor: C.accent,
        tabBarInactiveTintColor: C.muted,
        tabBarStyle: {
          backgroundColor: C.bg,          // ← themed (dark in dark mode)
          borderTopColor: C.border,
          borderTopWidth: 1,
        },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '700' },
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
      <Tab.Screen
        name="Leagues"
        component={Leagues}
        options={{
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="trophy" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen name="Prices" component={PricesPage} />
      <Tab.Screen name="Games" component={Games} />
      <Tab.Screen name="Change ID" component={ChangeID} />
    </Tab.Navigator>
  );
}

/* -------- Root navigation (needs theme) -------- */
function RootNavigation({ navRef, onReady, onStateChange }) {
  const { navTheme } = useTheme();
  return (
    <>
      <StatusBar barStyle={navTheme.dark ? 'light-content' : 'dark-content'} />
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
    <ForceUpdateGate localBuild={LOCAL_BUILD} configUrl={CONFIG_URL} defaultRemote={DEFAULT_REMOTE_VERSION}>
      <FplIdProvider>
        <ThemeProvider>
          <RootNavigation navRef={navRef} onReady={onReady} onStateChange={onStateChange} />
        </ThemeProvider>
      </FplIdProvider>
    </ForceUpdateGate>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f2f2f2', // unused, safe to keep
  },
});
