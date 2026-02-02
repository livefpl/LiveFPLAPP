  // App.js
  import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  import { InteractionManager } from 'react-native';
  import { Platform } from 'react-native';


  import * as Notifications from 'expo-notifications';

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,     // <-- this makes it show while app is open
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });


  import { NavigationContainer, CommonActions, useNavigation } from '@react-navigation/native';
  import { createBottomTabNavigator, BottomTabBar } from '@react-navigation/bottom-tabs';
  import { MaterialCommunityIcons } from '@expo/vector-icons';

  import { ThemeProvider, useTheme, useColors } from './theme';
  import { ProProvider, usePro } from './ProContext';
  import { FplIdProvider,useFplId } from './FplIdContext';
  import '@react-native-firebase/app';
import { initPlaywire, retryPlaywireInit, getPlaywireInitDebug, isPlaywireReady } from './playwireInit';

  import messaging from '@react-native-firebase/messaging';

  import ForceUpdateGate from './checkversion';
  import { PlaywireBannerView } from '@intergi/react-native-playwire-sdk';

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
  const DEFAULT_REMOTE_VERSION = 2;

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
    const { fplId } = useFplId();
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
            <PopItem icon="medal" label="Gameweek Trophies" target="Trophies" />
            <PopItem icon="account-edit" label="Change FPL ID" target="ID" />
            <PopItem icon="crown" label="Premium/Remove Ads" target="Premium" />
            {String(fplId) === '114740' && (<PopItem icon="advertisements" label="Ad Banner Test" target="AdTest" />
            )}
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
            let activeRoute = props.state.routeNames[i];
            // 🔧 FORCE bottom tab to stay on Battle when viewing Templates
  if (activeRoute === 'Templates') {
    activeRoute = 'Battle';
  }

            return (
              <View onLayout={(e) => setChromeH(e.nativeEvent.layout.height || 60)}>
                <MorePopover />
                <AdFooter  routeKey={activeRoute} />
                <BottomTabBar
                  {...props}
                  state={{
      ...props.state,
      index: props.state.routeNames.indexOf(activeRoute),
    }}
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
          <Tab.Screen
            name="AdTest"
            component={BannerTestScreen}
            options={{ tabBarButton: () => null, tabBarIcon: () => null, tabBarLabel: () => null }}
          />
        </Tab.Navigator>
      </>
    );
  }



  /* -------- Banner-only test screen -------- */
  /* -------- Banner-only test screen -------- */
function BannerTestScreen() {
  const C = useColors();

  const [mounted, setMounted] = useState(true);
  const [bannerKey, setBannerKey] = useState(0);

  const [status, setStatus] = useState('loading'); // loading | loaded | failed | idle
  const [loads, setLoads] = useState(0);
  const [fails, setFails] = useState(0);
  const [impr, setImpr] = useState(0);
  const [clicks, setClicks] = useState(0);
  const [lastErr, setLastErr] = useState(null);

  // New: init/interstitial debug
  const [initDbgTick, setInitDbgTick] = useState(0);
  const [interstitialRes, setInterstitialRes] = useState(null);
  const [busy, setBusy] = useState(false);

  const BANNER_SIZE = { width: 320, height: 50 };
  const AD_ALIAS = 'banner-320x50';

  const getPlaywireConfig = () => {
    const publisherId =
      process.env.EXPO_PUBLIC_PLAYWIRE_PUBLISHER_ID ||
      require('./app.json').expo.extra.playwire.publisherId;

    const iosAppId =
      process.env.EXPO_PUBLIC_PLAYWIRE_IOS_APP_ID ||
      require('./app.json').expo.extra.playwire.iosAppId;

    const androidAppId =
      process.env.EXPO_PUBLIC_PLAYWIRE_ANDROID_APP_ID ||
      require('./app.json').expo.extra.playwire.androidAppId;

    return { publisherId, iosAppId, androidAppId };
  };

  const remount = () => {
    setLastErr(null);
    setStatus('loading');
    setBannerKey((k) => k + 1);
  };

  const resetCounters = () => {
    setLoads(0);
    setFails(0);
    setImpr(0);
    setClicks(0);
    setLastErr(null);
    setInterstitialRes(null);
    setStatus(mounted ? 'loading' : 'idle');
  };

  const onLoaded = () => {
    setLoads((x) => x + 1);
    setStatus('loaded');
  };

  const onFailed = (e) => {
    setFails((x) => x + 1);
    setStatus('failed');

    const msg =
      typeof e === 'string'
        ? e
        : e?.message || e?.error || e?.nativeEvent?.message || JSON.stringify(e || {});
    setLastErr(String(msg).slice(0, 260));
  };

  const onImpression = () => setImpr((x) => x + 1);
  const onClicked = () => setClicks((x) => x + 1);

  const forceReinitAndRemount = async () => {
    if (busy) return;
    setBusy(true);
    try {
      setLastErr(null);
      setInterstitialRes(null);

      const cfg = getPlaywireConfig();
      // Attempt re-init (will no-op if already ready; will retry if init got stuck)
      retryPlaywireInit(cfg);

      // Force a hard remount of the native view:
      // unmount -> small delay -> mount + new key
      setMounted(false);
      setStatus('idle');

      setTimeout(() => {
        setBannerKey((k) => k + 1);
        setMounted(true);
        setStatus('loading');
        setInitDbgTick((t) => t + 1);
      }, 250);
    } finally {
      setTimeout(() => setBusy(false), 350);
    }
  };

  const showInterstitial = async () => {
    if (busy) return;
    setBusy(true);
    try {
      setInterstitialRes(null);
      const res = await showOnce({ reason: 'adtest_button', force: true });
      setInterstitialRes(res || { shown: false, provider: 'unknown' });
    } catch (e) {
      setInterstitialRes({
        shown: false,
        provider: 'exception',
        reason: String(e?.message || e).slice(0, 140),
      });
    } finally {
      setBusy(false);
    }
  };

  const pill = (label, onPress) => (
    <TouchableOpacity
      onPress={onPress}
      disabled={busy}
      activeOpacity={0.9}
      style={[
        styles.adTestBtn,
        {
          backgroundColor: C.card,
          borderColor: C.border,
          opacity: busy ? 0.6 : 1,
        },
      ]}
    >
      <Text style={[styles.adTestBtnText, { color: C.ink }]}>{label}</Text>
    </TouchableOpacity>
  );

  const initDbg = getPlaywireInitDebug();

  return (
    <View style={[styles.adTestRoot, { backgroundColor: C.bg }]}>
      <View style={[styles.adTestCard, { backgroundColor: C.card, borderColor: C.border }]}>
        <Text style={[styles.adTestTitle, { color: C.ink }]}>Ad Banner Test</Text>
        <Text style={[styles.adTestSub, { color: C.muted }]}>
          This screen mounts a single Playwire banner (320×50). Use “Force Re-init + Remount” to
          simulate a bad run recovery.
        </Text>

        <View style={styles.adTestRow}>
          {pill('Remount', remount)}
          {pill(mounted ? 'Unmount' : 'Mount', () => {
            setMounted((m) => !m);
            setStatus((s) => (mounted ? 'idle' : 'loading'));
          })}
          {pill('Reset', resetCounters)}

          {/* New */}
          {pill('Force Re-init + Remount', forceReinitAndRemount)}
          {pill('Show Interstitial', showInterstitial)}
        </View>

        <View style={styles.adTestStats}>
          <Text style={[styles.adTestStat, { color: C.muted }]}>
            status: <Text style={{ color: C.ink, fontWeight: '900' }}>{status}</Text>
          </Text>

          <Text style={[styles.adTestStat, { color: C.muted }]}>
            loads: <Text style={{ color: C.ink, fontWeight: '900' }}>{loads}</Text> • fails:{' '}
            <Text style={{ color: C.ink, fontWeight: '900' }}>{fails}</Text> • impr:{' '}
            <Text style={{ color: C.ink, fontWeight: '900' }}>{impr}</Text> • clicks:{' '}
            <Text style={{ color: C.ink, fontWeight: '900' }}>{clicks}</Text>
          </Text>

          <Text style={[styles.adTestStat, { color: C.muted }]}>
            adUnitId: <Text style={{ color: C.ink, fontWeight: '900' }}>{AD_ALIAS}</Text>
          </Text>

          {/* New: init debug */}
          <Text style={[styles.adTestStat, { color: C.muted }]}>
            sdkReady:{' '}
            <Text style={{ color: C.ink, fontWeight: '900' }}>
              {initDbg.sdkReady ? 'yes' : 'no'}
            </Text>
            {'  '}• attempts:{' '}
            <Text style={{ color: C.ink, fontWeight: '900' }}>{initDbg.initAttempts}</Text>
            {!!initDbg.lastInitErr ? (
              <>
                {'  '}• lastInitErr:{' '}
                <Text style={{ color: C.ink, fontWeight: '900' }}>
                  {JSON.stringify(initDbg.lastInitErr).slice(0, 120)}
                </Text>
              </>
            ) : null}
          </Text>

          {/* New: interstitial result */}
          {!!interstitialRes ? (
            <Text style={[styles.adTestStat, { color: C.muted }]}>
              interstitial:{' '}
              <Text style={{ color: C.ink, fontWeight: '900' }}>
                {JSON.stringify(interstitialRes).slice(0, 180)}
              </Text>
            </Text>
          ) : null}
        </View>

        {!!lastErr && (
          <Text style={[styles.adTestErr, { color: '#ff6b6b' }]}>lastErr: {lastErr}</Text>
        )}

        <View style={[styles.adTestBannerBox, { borderColor: C.border, backgroundColor: C.bg }]}>
          {mounted ? (
            <PlaywireBannerView
              key={`pw_banner_test_${bannerKey}_${initDbgTick}`}
              adUnitId={AD_ALIAS}
              size={BANNER_SIZE}
              style={{ width: BANNER_SIZE.width, height: BANNER_SIZE.height }}
              onAdLoaded={onLoaded}
              onAdFailedToLoad={onFailed}
              onAdImpression={onImpression}
              onAdClicked={onClicked}
            />
          ) : (
            <Text style={{ color: C.muted, fontWeight: '800' }}>Banner unmounted</Text>
          )}
        </View>

        <Text style={[styles.adTestHint, { color: C.muted }]}>
          Tip: if a “bad run” gets fixed by Force Re-init + Remount, you’re likely dealing with an
          init-timing / native-view mount ordering issue rather than persistent no-fill.
        </Text>
      </View>
    </View>
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

  // Try immediately
  initPlaywire({ publisherId, iosAppId, androidAppId });

  // Watchdog: if init callback never arrives, retry
  const t = setTimeout(() => {
    if (!isPlaywireReady()) {
      retryPlaywireInit({ publisherId, iosAppId, androidAppId });
    }
  }, 8000);

  return () => clearTimeout(t);
}, []);





    const bootGraceRef = React.useRef(true);

  useEffect(() => {
    const t = setTimeout(() => {
      bootGraceRef.current = false;
    }, 4500); // 2.5s grace period after app mount
    return () => clearTimeout(t);
  }, []);

  async function ensureAndroidNotificationPermission() {
    if (Platform.OS !== 'android') return;

    const settings = await Notifications.getPermissionsAsync();

    if (settings.status !== 'granted') {
      await Notifications.requestPermissionsAsync();
    }
  }


  useEffect(() => {
    const initFCM = async () => {
      try {
        await ensureAndroidNotificationPermission();
        // iOS: ensure device is registered for remote messages
        await messaging().registerDeviceForRemoteMessages();

        const authStatus = await messaging().requestPermission();
        console.log('[FCM] authStatus:', authStatus);

        const enabled =
          authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
          authStatus === messaging.AuthorizationStatus.PROVISIONAL;

        console.log('[FCM] permission enabled:', enabled);

        const apns = await messaging().getAPNSToken();
        console.log('[FCM] apns token:', apns);

        const fcm = await messaging().getToken();
        console.log('[FCM] fcm token:', fcm);
      } catch (e) {
        console.error('[FCM] init error', e);
      }
    };

    initFCM();
  }, []);



    // Interstitial timer interval (ms) — default 30s, can be overridden by version.json "timer"
    const [adTimerMs, setAdTimerMs] = React.useState(30_000);

    useEffect(() => {
      let alive = true;

      async function loadTimer() {
        try {
          const r = await fetch(CONFIG_URL, { cache: 'no-store' });
          const j = await r.json();

          // Accept either seconds (e.g. 30) or ms (e.g. 30000)
          const tSec = Number(j?.meter?.timer); // timer is in SECONDS
          

          if (Number.isFinite(tSec) && tSec > 0) {
            const ms = Math.max(10_000, Math.min(600_000, tSec * 1000));
            

            if (alive) setAdTimerMs(ms);
          }
        } catch {
          // ignore; keep default
        }
      }

      loadTimer();
      return () => {
        alive = false;
      };
    }, []);

    useEffect(() => {
    const id = setInterval(() => {
      bump({ source: 'timer' });
    }, adTimerMs);

    return () => clearInterval(id);
  }, [adTimerMs]);

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
    // ----- Ad Banner Test screen -----
    adTestRoot: { flex: 1, paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) : 0 },
    adTestCard: {
      margin: 14,
      borderRadius: 16,
      borderWidth: 1,
      padding: 14,
    },
    adTestTitle: { fontSize: 18, fontWeight: '900' },
    adTestSub: { marginTop: 6, fontSize: 12, fontWeight: '700' },
    adTestRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
    adTestBtn: {
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 12,
      borderWidth: 1,
    },
    adTestBtnText: { fontSize: 12, fontWeight: '900' },
    adTestStats: { marginTop: 12 },
    adTestStat: { fontSize: 12, fontWeight: '700', marginTop: 4 },
    adTestErr: { marginTop: 10, fontSize: 11, fontWeight: '900' },
    adTestBannerBox: {
      marginTop: 16,
      alignSelf: 'center',
      width: 320,
      height: 50,
      borderRadius: 10,
      borderWidth: 1,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
    },
    adTestHint: { marginTop: 12, fontSize: 11, fontWeight: '700' },

  });
