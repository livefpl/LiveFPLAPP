// rank.js — clean (no metrics/interstitials)
import InfoBanner from './InfoBanner';
import AppHeader from './AppHeader';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Sharing from 'expo-sharing';
import PlayerInfoModal from './PlayerInfoModal';
import EventFeed from './EventFeed';
import messaging from '@react-native-firebase/messaging';

import { TouchableWithoutFeedback } from 'react-native';
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  StyleSheet,
  Text,
  Animated,
  Platform,
  View,
  Image,
  ImageBackground,
  Dimensions,
  ScrollView,
  TouchableOpacity,
  Modal,
  RefreshControl,
  ActivityIndicator,
  Linking,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ThemedTextInput from './ThemedTextInput';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { useFplId } from './FplIdContext';
import { FontAwesome, MaterialCommunityIcons } from '@expo/vector-icons';
import { CommonActions } from '@react-navigation/native';
import StatsStrip from './StatsStrip';
import SettingsModal from './SettingsModal';
import { clubCrestUri, assetImages } from './clubs';
import { smartFetch } from './signedFetch';
import { useColors } from './theme';
import { useTranslation } from 'react-i18next';
import { captureRef } from 'react-native-view-shot';
Text.defaultProps = Text.defaultProps || {};
Text.defaultProps.allowFontScaling = false;



async function persistExposureForPayload(payload, effectiveId) {
  try {
    const exposure = {};
    for (const p of payload?.team ?? []) {
      const id = Number(p?.fpl_id ?? p?.element ?? p?.id ?? p?.code);
      if (!id) continue;
      const role = String(p?.role ?? '').toLowerCase();
      const mul = role === 'b' ? 0 : role === 'tc' ? 3 : role === 'c' ? 2 : 1;
      exposure[id] = mul;
    }
    const val = JSON.stringify(exposure);
    await AsyncStorage.multiSet([
      ['myExposure', val],
      [`myExposure:${String(effectiveId)}`, val],
    ]);
  } catch {}
}


import Svg, { Circle, Text as SvgText, Polyline, Line } from 'react-native-svg';

const LetterCircle = ({
  label = 'A',
  size = 16,
  bg = 'black',
  fg = 'white',
  stroke = 'transparent',
  strokeWidth = 0,
}) => {
  const L = String(label).toUpperCase();

  // iOS: SVG (already perfect)
  if (Platform.OS === 'ios') {
    return (
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={(size - strokeWidth) / 2}
          fill={bg}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
        <SvgText
          x={size / 2}
          y={size / 2}
          fill={fg}
          fontSize={size * 0.72}
          fontWeight="700"
          textAnchor="middle"
          alignmentBaseline="central"
        >
          {L}
        </SvgText>
      </Svg>
    );
  }

  // Android: View/Text (exact center via layout, no SVG baseline issues)
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        borderWidth: strokeWidth,
        borderColor: stroke,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <Text
        numberOfLines={1}
        style={{
          color: fg,
          fontWeight: '700',
          // letter fills the circle nicely
          fontSize: size * 0.62,
          // vertical centering without extra font padding
          lineHeight: size,
          includeFontPadding: false,
          textAlign: 'center',
          textAlignVertical: 'center',
        }}
        allowFontScaling={false}
      >
        {L}
      </Text>
    </View>
  );
};


async function getNotifPrefsFromStorage() {
  try {
    const raw = await AsyncStorage.getItem('notif.prefs.v1');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function updateMyTeamPushSubsOncePerGW({ gw, players, fplId }) {
  const gwNum = Number(gw) || 0;
  if (!gwNum || !Array.isArray(players) || players.length === 0) return;
  
  const prefs = (await getNotifPrefsFromStorage()) || null;
const wantPlayers = !(prefs && prefs.myTeamGoalsAssists === false);
  const wantPrices = !(prefs && prefs.priceWarnings === false);

  const key = `push.subs.myteam:${String(fplId || '')}`;

    // Only skip if same GW AND prefs haven't changed.
  let prev = null;
  try {
    const prevRaw = await AsyncStorage.getItem(key);
    prev = prevRaw ? JSON.parse(prevRaw) : null;

    const sameGw = !!(prev?.gw && Number(prev.gw) === gwNum);
    const samePrefs =
      !!prev &&
      prev.wantPlayers === wantPlayers &&
      prev.wantPrices === wantPrices;

    if (sameGw && samePrefs) return;
  } catch {}


  const ids = Array.from(
    new Set(
      players
        .map((p) => Number(p?.pid ?? p?.id ?? p?.element ?? p?.fpl_id))
        .filter((n) => Number.isFinite(n) && n > 0)
    )
  );

  if (!ids.length) return;

  

  if (wantPlayers) {
    const prevIds = Array.isArray(prev?.players) ? prev.players.map(Number).filter((n) => n > 0) : [];
    const prevSet = new Set(prevIds);
    const nextSet = new Set(ids);

    const toUnsub = prevIds.filter((id) => !nextSet.has(id)).map((id) => String(id));
    const toSub = ids.filter((id) => !prevSet.has(id)).map((id) => String(id));

    try {
      for (const t of toUnsub) await messaging().unsubscribeFromTopic(t);
      for (const t of toSub) await messaging().subscribeToTopic(t);
      if (__DEV__) console.log('[PUSH TOPICS] myteam players', { sub: toSub.length, unsub: toUnsub.length });
    } catch (e) {
      console.warn('[PUSH TOPICS] myteam player topic update failed', e);
    }
  } else {
    // if user disabled player notifs, unsubscribe ALL previous player topics (once, when GW changes)
    const prevIds = Array.isArray(prev?.players) ? prev.players.map(Number).filter((n) => n > 0) : [];
    try {
      for (const id of prevIds) await messaging().unsubscribeFromTopic(String(id));
      if (__DEV__) console.log('[PUSH TOPICS] myteam players disabled → unsub all', prevIds.length);
    } catch (e) {
      console.warn('[PUSH TOPICS] myteam player disable unsub failed', e);
    }
  }

  // Prices: single global topic
  try {
    if (wantPrices) {
      await messaging().subscribeToTopic('prices');
      if (__DEV__) console.log('[PUSH TOPICS] subscribed to prices');
    } else {
      await messaging().unsubscribeFromTopic('prices');
      if (__DEV__) console.log('[PUSH TOPICS] unsubscribed from prices');
    }
  } catch (e) {
    console.warn('[PUSH TOPICS] prices topic update failed', e);
  }
  try {
    await AsyncStorage.setItem(
      key,
      JSON.stringify({
  gw: gwNum,
  players: ids,
  wantPlayers: wantPlayers,
  wantPrices: wantPrices,
  updatedAt: Date.now()
})

    );
  } catch {}
}


async function applyMyTeamTopicsForCurrentPrefs({ fplId, notifPrefs }) {
  const key = `push.subs.myteam:${String(fplId || '')}`;

  try {
    const raw = await AsyncStorage.getItem(key);
    const prev = raw ? JSON.parse(raw) : null;
    const ids = Array.isArray(prev?.players) ? prev.players.map(Number).filter(n => n > 0) : [];

    const wantPlayers = !(notifPrefs && notifPrefs.myTeamGoalsAssists === false);
    const wantPrices  = !(notifPrefs && notifPrefs.priceWarnings === false);

    // player topics: resub or unsub-all (based on stored list)
    if (ids.length) {
      if (wantPlayers) {
        for (const id of ids) await messaging().subscribeToTopic(String(id));
        if (__DEV__) console.log('[PUSH TOPICS] prefs -> players ON (resub)', ids.length);
      } else {
        for (const id of ids) await messaging().unsubscribeFromTopic(String(id));
        if (__DEV__) console.log('[PUSH TOPICS] prefs -> players OFF (unsub)', ids.length);
      }
    }

    // prices topic
    if (wantPrices) {
      await messaging().subscribeToTopic('prices');
      if (__DEV__) console.log('[PUSH TOPICS] prefs -> prices ON');
    } else {
      await messaging().unsubscribeFromTopic('prices');
      if (__DEV__) console.log('[PUSH TOPICS] prefs -> prices OFF');
    }
  } catch (e) {
    console.warn('[PUSH TOPICS] apply prefs now failed', e);
  }
}


const Crest = ({ team, size = 28 }) => (
  <Image source={{ uri: clubCrestUri(team || 1) }} style={{ width: size, height: size, borderRadius: size/2 }} />
);

const EOMicro = ({ top10k = 0, local = 0, C }) => {
  const { t: tI18n } = useTranslation();
  const norm = (v) => {
    const raw = Number(v ?? 0);
    const bar = Math.max(0, Math.min(100, raw));
    const txt = Number.isFinite(raw) ? raw : 0;
    return { bar, txt };
  };

  const tVal = norm(top10k);
  const lVal = norm(local);

  const rows = [
    { label: tI18n('rank.top10k'), val: tVal },
    { label: tI18n('rank.nearYou'), val: lVal },
  ];

  return (
    <View style={{ gap: 6 }}>
      {rows.map(({ label, val }) => (
        <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontSize: 10, color: C.muted, width: 56 }}>{label}</Text>
          <View
            style={{
              flex: 1,
              height: 6,
              borderRadius: 999,
              overflow: 'hidden',
              backgroundColor: C.sunken || (C.bg === '#000' ? '#0b1224' : '#e5e7eb'),
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: C.border,
            }}
          >
            <View style={{ width: `${val.bar}%`, height: '100%', backgroundColor: C.accent, opacity: 0.9 }} />
          </View>
          <Text
            style={{
              fontSize: 10,
              fontVariant: ['tabular-nums'],
              color: C.ink,
              width: 56,
              textAlign: 'right',
            }}
          >
            {val.txt.toFixed(2)}%
          </Text>
        </View>
      ))}
    </View>
  );
};

const emojiInfo = (code = '', tFn) => {
  const labels = tFn ? {
    d: tFn('rank.differential'),
    t: tFn('rank.templatePick'),
    s: tFn('rank.spy'),
    ds: tFn('rank.differential'),
    f: tFn('rank.inForm'),
    sub: tFn('rank.autosubbed'),
    '': '',
  } : { d: 'Differential', t: 'Template Pick', s: 'Spy', ds: 'Differential', f: 'In form', sub: 'Autosubbed', '': '' };
  const label = labels[String(code).toLowerCase()] || String(code).toUpperCase();
  return { label };
};

// Tiny chip styles for clean inline pills
const Chip = ({ children, C, tone = 'neutral' }) => {
  const bg = tone === 'pos' ? (C.good || '#10b981')
            : tone === 'neg' ? (C.bad || '#ef4444')
            : C.card2;
  const col = tone === 'neutral' ? C.ink : 'white';
  return (
    <View style={{
      flexDirection:'row', alignItems:'center', gap:4,
      paddingHorizontal:6, paddingVertical:4,
      borderRadius:999, backgroundColor:bg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tone === 'neutral' ? C.border : 'transparent',
    }}>
      {React.Children.map(children, (c) => c)}
    </View>
  );
};


// -------- Layout helpers --------
const CACHE_TTL_MS = 60_000; // 30s cache
let rem = Dimensions.get('window').width / 380;
let vrem = Dimensions.get('window').height / 380;
const imgwidth = Math.round(rem * 55);
const imgheight = 12;


// Unified shirt sizing/positions
const SHIRT_SCALE = 0.7; // tune once for both platforms
const SHIRT_ASPECT = 5.6 / 5; // width / height
const PLAYER_IMAGE_WIDTH = (imgwidth * SHIRT_SCALE * vrem) / 2.2;
const PLAYER_IMAGE_HEIGHT = PLAYER_IMAGE_WIDTH / SHIRT_ASPECT;
const CAP_TOP = PLAYER_IMAGE_HEIGHT * 0.34; // badge circle vertical position
const EMOJI_TOP = PLAYER_IMAGE_HEIGHT * 0.35; // emoji vertical position

// Lock the pitch height cross-platform and derive row height
const PITCH_RATIO = 540 / 405;
const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;
let PITCH_HEIGHT = Math.min(SCREEN_W * PITCH_RATIO, SCREEN_H * 0.8);

const SMALL_SCREEN = 640;
PITCH_HEIGHT = Math.min(
  SCREEN_W * PITCH_RATIO,
  SCREEN_H * (SCREEN_H < SMALL_SCREEN ? 0.58 : 0.65)
);
const ROW_GAP = 6 * vrem; // tiny vertical gap between lines
const ROW_HEIGHT = Math.floor((PITCH_HEIGHT - ROW_GAP * 4) / 5);
const GEN_URL = 'https://livefpl.us/version.json';
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
const SCALE_KEY = 'ui.rank.pitchScale';


// ---------- Helpers that don't need styles ----------
// DGW: "minutes Game 2" etc. → treat as same stat as "minutes" (sum across games)
function normalizeExplainKey(key) {
  const k = String(key ?? '').trim();
  return k.replace(/\s+Game\s+\d+$/i, '').trim() || k;
}

function getEventCounts(pl) {
  const counts = {
    goals_scored: 0,
    assists: 0,
    yellow_cards: 0,
    red_cards: 0,
    clean_sheets: 0,
    saves: 0,
    penalties_saved: 0,
    penalties_missed: 0,
    bonus: 0,
    defensive_contribution: 0,
    minutes: 0,
    minutesGame2: 0, // DGW: only "minutes Game 2" for live display
  };
  (pl.stats || []).forEach(([raw, c]) => {
    const rawStr = String(raw ?? '');
    const key = normalizeExplainKey(rawStr).toLowerCase();
    const val = Number(c) || 0;
    if (key in counts) counts[key] += val;
    if (key === 'minutes' && rawStr.includes(' Game 2')) counts.minutesGame2 += val;
  });
  return counts;
}



function find_emoji(s) {
  const d = { d: '🎲', t: '😴', s: '🕵', ds: '⭐', '': '', f: '🔥', sub: '🔃' };
  return d[s] || '';
}
function find_status(s) {
  const d = { y: 'yet', m: 'missed', d: 'played', l: 'live' };
  return d[s] || 'played';
}

const FootballLineupWithImages = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
    // 🔔 DEV ONLY: verify push subscriptions in AsyncStorage
  useEffect(() => {
    if (!__DEV__) return;

    (async () => {
      const keys = await AsyncStorage.getAllKeys();
      console.log('[PUSH DEBUG] keys:', keys);

      for (const k of keys.filter(k => k.startsWith('push.subs'))) {
        console.log('[PUSH DEBUG]', k, await AsyncStorage.getItem(k));
      }
    })();
  }, []);

  const [adHeight, setAdHeight] = useState(0); // 0 when no ad/failed/hidden
// help modal for "Points" tile
const [helpVisible, setHelpVisible] = useState(false);
const [onePt, setOnePt] = useState(null);

 // near other refs
const hydratedRef = useRef(false); // becomes true once we've loaded from AsyncStorage (or decided there's nothing to load)
const [rankTab, setRankTab] = useState('pitch'); // 'pitch' | 'feed'
// -----------------------------
// History tab (FPL entry history)
// -----------------------------
const [historyLoading, setHistoryLoading] = useState(false);
const [historyErr, setHistoryErr] = useState(null);
const [historyData, setHistoryData] = useState(null);
const [quickBarOpen, setQuickBarOpen] = useState(false);

const HISTORY_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const historyCacheKey = (id) => `fpl.entry.history.v1:${String(id || '')}`;
const managerBarRef = useRef(null);
const [quickOpen, setQuickOpen] = useState(false);
const quickJustOpenedRef = useRef(0);

const [quickAnchor, setQuickAnchor] = useState({ x: 12, y: 0, w: 320, h: 0 });

const openQuick = useCallback(() => {
  quickJustOpenedRef.current = Date.now(); // <-- add this
  requestAnimationFrame(() => {
    try {
      managerBarRef.current?.measureInWindow((x, y, w, h) => {
        setQuickAnchor({ x, y, w, h });
        setQuickOpen(true);
      });
    } catch {
      setQuickOpen(true);
    }
  });
}, []);

const CHIP_ABBR = {
  bboost: 'BB',
  wildcard: 'WC',
  freehit: 'FH',
  '3xc': 'TC',
};

const buildChipByGw = (chips = []) => {
  const m = {};
  (chips || []).forEach((c) => {
    const gw = Number(c?.event);
    const name = String(c?.name || '').toLowerCase();
    if (!gw || !name) return;
    m[gw] = CHIP_ABBR[name] || name.toUpperCase();
  });
  return m;
};

const fmtShort = (n) => {
  const x = Number(n);
  if (!Number.isFinite(x)) return '-';
  if (x >= 1e6) return `${(x / 1e6).toFixed(x >= 10e6 ? 0 : 1)}M`;
  if (x >= 1e3) return `${(x / 1e3).toFixed(x >= 10e3 ? 0 : 1)}K`;
  return String(Math.round(x));
};

const loadHistory = useCallback(async (id) => {
  const fpl = Number(id);
  if (!fpl) return;

  setHistoryErr(null);

  // cache
  try {
    const raw = await AsyncStorage.getItem(historyCacheKey(fpl));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.ts && Date.now() - parsed.ts < HISTORY_TTL_MS && parsed?.data) {
        setHistoryData(parsed.data);
        return;
      }
    }
  } catch {}

  setHistoryLoading(true);
  try {
    const url = `https://fantasy.premierleague.com/api/entry/${fpl}/history/`;
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`FPL history fetch failed (${res.status})`);
    const json = await res.json();
    // tag with id so we can detect switching viewFplId
    json._fplId = fpl;

    setHistoryData(json);
    try {
      await AsyncStorage.setItem(historyCacheKey(fpl), JSON.stringify({ ts: Date.now(), data: json }));
    } catch {}
  } catch (e) {
    setHistoryErr(String(e?.message || e));
  } finally {
    setHistoryLoading(false);
  }
}, []);

// auto-load when user opens History tab
useEffect(() => {
  if (rankTab !== 'history') return;
  const effectiveId = Number(viewFplId ?? fplId);
  if (!effectiveId) return;
  if (historyData?._fplId === effectiveId) return;
  loadHistory(effectiveId);
}, [rankTab, viewFplId, fplId, loadHistory, historyData?._fplId]);

const [pitchScale, setPitchScale] = useState(1);
const scaleRef = useRef(1);
const MIN_SCALE = 0.8;
const MAX_SCALE = 1.1;
const STEP = 0.01;
const EPS = 0.001;

const persistScale = useCallback(async (v) => {
  try { await AsyncStorage.setItem(SCALE_KEY, String(v)); } catch {}
}, []);
const INCLUDE_SUBS_KEY = 'ui.rank.includeSubs.pref'; // '1' = Post, '0' = Pre

const setIncludeSubs = useCallback(async (v) => {
  try { await AsyncStorage.setItem(INCLUDE_SUBS_KEY, v ? '1' : '0'); } catch {}
  setDisplaySettings((s) => ({ ...s, includeSubs: !!v }));
}, []);
useEffect(() => {
  (async () => {
    try {
      const saved = await AsyncStorage.getItem(INCLUDE_SUBS_KEY);
      if (saved === '1' || saved === '0') {
        setDisplaySettings((s) => ({ ...s, includeSubs: saved === '1' }));
      }
    } catch {}
  })();
}, []);

const setScale = useCallback((next) => {
  const snapped = parseFloat(next.toFixed(2));
  const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, snapped));
  if (Math.abs(clamped - scaleRef.current) < EPS) return;
  scaleRef.current = clamped;
  setPitchScale(clamped);
  persistScale(clamped);
}, [persistScale]);

const bumpScale = useCallback((delta) => {
  const prev = scaleRef.current;
  if ((delta > 0 && prev >= MAX_SCALE - EPS) || (delta < 0 && prev <= MIN_SCALE + EPS)) return;
  setScale(prev + delta);
}, [setScale]);

const atMin = pitchScale <= MIN_SCALE + EPS;
const atMax = pitchScale >= MAX_SCALE - EPS;



  // update rem/vrem based on current window (keeps existing sizing logic consistent)
  rem = winW / 380;
  vrem = winH / 380;

  const pitchHeight = useMemo(() => {
    // space the non-pitch UI roughly takes above/below the pitch. Tweak if needed.
    const uiOverhead = 220;
    const maxByWidth = winW * PITCH_RATIO; // keep aspect
    const maxByScreen = Math.max(
      180,
      winH - insets.top - insets.bottom - adHeight - uiOverhead
    );
    return Math.min(maxByWidth, maxByScreen);
  }, [winW, winH, insets.top, insets.bottom, adHeight]);

  const ROW_GAP = 6 * vrem;
  const rowHeight = useMemo(
    () => Math.floor((pitchHeight - ROW_GAP * 4) / 5),
    [pitchHeight, ROW_GAP]
  );

  const viewFplId = route?.params?.viewFplId;
  const { fplId, triggerRefetch } = useFplId();
  const { t } = useTranslation();
  // Rank.js (inside component)
  const C = useColors();

const [infoOpen, setInfoOpen] = useState(false);
const [infoPlayer, setInfoPlayer] = useState({
  id: null,
  name: '',
  teamShort: '',
  position: '',
});

const openPlayerInfo = (pOrId) => {
  const p = typeof pOrId === 'object' && pOrId !== null ? pOrId : { pid: pOrId };

  const id =
    p?.pid ??
    p?.id ??
    p?.element ??
    p?.playerId ??
    p?.data?.id ??
    null;

  // Try to get a decent display name
  const name =
    p?.name ??
    p?.web_name ??
    p?.second_name ??
    p?.data?.web_name ??
    (id ? `Player #${id}` : '');

  const posMap = { 1: t('rank.gk'), 2: t('rank.def'), 3: t('rank.mid'), 4: t('rank.fwd'), Bench: t('rank.bench') };
  const position =
    posMap[p?.position] ??
    p?.position_short ??
    p?.posShort ??
    p?.position ??
    '';

  // We don’t have a team short in this file—leave blank; the modal can still
  // resolve opponent shorts internally if you later pass getTeamShort
  const teamShort =
    p?.team_short ??
    p?.team_short_name ??
    p?.team?.short_name ??
    '';

  setInfoPlayer({ id, name, teamShort, position });
  setInfoOpen(true);
};


  
  const SubsToggle = ({ value, onChange }) => {
  // value === true  -> Post (include subs)
  // value === false -> Pre  (no subs)
  return (
    <View
      style={{
        flexDirection: 'row',
        borderRadius: 10,
        overflow: 'hidden',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: C.border,
        backgroundColor: C.card,
      }}
    >
      <TouchableOpacity
        onPress={() => onChange(false)}
        style={{
          paddingHorizontal: 6,
          height: 20,
          justifyContent: 'center',
          backgroundColor: !value ? C.accent : 'transparent',
        }}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        accessibilityRole="button"
        accessibilityLabel={t('rank.showPreSubsRank')}
      >
        <Text style={{ fontSize: 10, fontWeight: '700', color: !value ? 'white' : C.muted }}>
          {t('rank.pre')}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => onChange(true)}
        style={{
          paddingHorizontal: 6,
          height: 20,
          justifyContent: 'center',
          backgroundColor: value ? C.accent : 'transparent',
        }}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        accessibilityRole="button"
        accessibilityLabel={t('rank.showPostSubsRank')}
      >
        <Text style={{ fontSize: 10, fontWeight: '700', color: value ? 'white' : C.muted }}>
          {t('rank.post')}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const PitchFeedToggle = ({ value, onChange }) => {
  const isPitch = value === 'pitch';
  const isFeed = value === 'feed';
  const isHistory = value === 'history';

  const Btn = ({ active, label, onPress }) => (
    <TouchableOpacity
      onPress={onPress}
      style={{
        paddingHorizontal: 6,
        height: 20,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: active ? C.accent : 'transparent',
      }}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
    >
      <Text
        numberOfLines={1}
        ellipsizeMode="clip"
        style={{
          fontSize: 9,
          fontWeight: '700',
          color: active ? 'white' : C.muted,
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View
      style={{
        flexDirection: 'row',
        borderRadius: 10,
        overflow: 'hidden',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: C.border,
        backgroundColor: C.card,
      }}
    >
      <Btn active={isPitch} label={t('rank.pitch')} onPress={() => onChange('pitch')} />
      <Btn active={isFeed} label={t('rank.feed')} onPress={() => onChange('feed')} />
      <Btn active={isHistory} label={t('rank.history')} onPress={() => onChange('history')} />
    </View>
  );
};




  // Hidden capture target (off-screen clone)
  const shareTargetRef = useRef(null);

  // Theme-aware styles inside component
  const isDark = useMemo(() => {
    const hex = String(C.bg || '#000').replace('#', '');
    if (hex.length < 6) return true;
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return l < 0.5;
  }, [C.bg]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, alignItems: 'center', width: '100%', justifyContent: 'center', paddingTop: 4 },

        loadingOverlay: {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.35)',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 999,
        },
        loadingCard: {
          backgroundColor: C.card,
          borderWidth: 1,
          borderColor: C.border,
          borderRadius: 12,
          paddingVertical: 14,
          paddingHorizontal: 16,
          minWidth: 180,
          alignItems: 'center',
        },
        loadingText: { marginTop: 8, color: 'white', fontWeight: '600' },

        pitchBg: {
          position: 'relative',
          width: '100%',
          height: pitchHeight,
          justifyContent: 'space-between',
          paddingBottom: 8,
        },

        firstLineupContainer: {
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          width: '100%',
          height: rowHeight,
          marginVertical: ROW_GAP / 3,
        },
        lineupContainer: {
          flexDirection: 'row',
          justifyContent: 'space-evenly',
          alignItems: 'center',
          width: '100%',
          height: rowHeight,
          marginVertical: ROW_GAP / 3,
        },

        positionContainer: { alignItems: 'center', width: '20%',},
        playerContainer: { alignItems: 'center' },

        playerImage: { width: PLAYER_IMAGE_WIDTH, height: undefined, aspectRatio: SHIRT_ASPECT, resizeMode: 'contain' },

        settingsButton: { padding: 2, borderRadius: 8 },
        switch: {
          position: 'absolute',
          top: 25 * vrem,
          left: 18 * rem,
          borderRadius: 6,
          
          alignItems: 'center',
          flexDirection: 'column',
          zIndex: 9999,          // <- stay on top (iOS)
  elevation: 50,         // <- stay on top (Android)
        },

        scoresheet: {
          backgroundColor: C.card2,
          borderWidth: 1,
          borderColor: C.border,
          position: 'absolute',
          top: 23 * vrem,
          right: 7 * rem,
          borderRadius: 6,
          justifyContent: 'center',
          paddingVertical: 2,
          paddingHorizontal: 6,
          alignItems: 'center',
        },
        scoresheetMain: { fontSize: 12 * rem, marginTop: 7 * rem, fontWeight: 'bold', textAlign: 'center', color: 'white' },
        scoresheetSub: { fontSize: 10 * rem, marginTop: 7 * rem, textAlign: 'center', color: 'white' },

        centeredView: { flex: 1, justifyContent: 'center', alignItems: 'center', marginTop: 7 * vrem },
        modalCard: {
   width: '92%',
   maxWidth: 560,
   maxHeight: '78%',
   backgroundColor: C.card,
   borderRadius: 16,
   overflow: 'hidden',
   borderWidth: 1,
   borderColor: C.border,
   shadowColor: '#000',
   shadowOpacity: 0.15,
   shadowRadius: 10,
   shadowOffset: { width: 0, height: 6 },
   elevation: 8,
 },
 modalHeader: {
   flexDirection: 'row',
   alignItems: 'center',
   justifyContent: 'space-between',
   paddingHorizontal: 14,
   paddingVertical: 12,
   backgroundColor: C.card,
   borderBottomWidth: StyleSheet.hairlineWidth,
   borderColor: C.border,
 },
 modalName: {
   fontSize: 16,
   fontWeight: '800',
   color: C.ink,
 },
 modalSub: {
   fontSize: 11,
   color: C.muted,
 },
 iconBtn: {
   padding: 6,
   borderRadius: 10,
   backgroundColor: C.card2,
   borderWidth: StyleSheet.hairlineWidth,
   borderColor: C.border,
 },
 ghostBtn: {
   paddingVertical: 6,
   paddingHorizontal: 10,
   borderRadius: 999,
   borderWidth: StyleSheet.hairlineWidth,
   borderColor: C.border,
   backgroundColor: 'transparent',
   flexDirection: 'row',
   alignItems: 'center',
   gap: 6,
 },
 ghostBtnText: {
   color: C.ink,
   fontWeight: '700',
   fontSize: 12,
 },
        eoSection: { alignSelf: 'stretch', marginTop: 6, marginBottom: 12 },
        eoRow: { marginTop: 8 },
        eoLabelRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', marginBottom: 4 },
        eoLabel: { fontWeight: '800', color: C.ink, fontSize: 12 },
        eoValue: { fontWeight: '900', color: C.ink, fontVariant: ['tabular-nums'] },
        eoTrack: {
          height: 10, borderRadius: 6, overflow: 'hidden',
          backgroundColor: isDark ? '#0b1224' : '#e5e7eb',
          borderWidth: 1, borderColor: isDark ? '#1b2642' : '#cbd5e1',
        },
        eoFillTop:   { height: '100%', backgroundColor: C.accent || '#3b82f6' },
        eoFillLocal: { height: '100%', backgroundColor: isDark ? '#16a34a' : '#22c55e' },
        // tiny close button for modal
        modalClose: {
          position: 'absolute',
          top: 10,
          right: 10,
          padding: 6,
          borderRadius: 16,
        },
modalView: {
  margin: 20,
   backgroundColor: C.card,
   color: 'white',
   borderRadius: 20,
   padding: 20,
   alignItems: 'center',
   shadowColor: '#000',
   shadowOffset: { width: 0, height: 2 },
   shadowOpacity: 0.25,
   shadowRadius: 4,
   elevation: 5,
   borderWidth: 1,
   borderColor: C.border,
 },
 modalTitle: { marginBottom: 15, textAlign: 'center', fontSize: 20, fontWeight: 'bold', color: 'white' },
        statsHeader: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 10,
          paddingVertical: 6,
          backgroundColor: C.card,
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8,
          borderWidth: 1,
          borderColor: C.border,
          width: '100%',
        },
        statRow: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 10,
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderBottomColor: C.border,
          width: '100%',
        },

        headerText: { flex: 1, textAlign: 'center', fontWeight: 'bold', fontSize: 16, color: 'white' },
        statName: { flex: 1, fontSize: 12, color: 'white' },
        statValue: { flex: 1, textAlign: 'center', fontSize: 14, color: 'white' },

        emoji: { position: 'absolute', left: -4 * rem, top: EMOJI_TOP },
        cap: {
          position: 'absolute',
          top: CAP_TOP,
          right: -6 * rem,
          backgroundColor: 'black',
          width: 16 * rem,
          height: 16 * rem,
          borderRadius: 8 * rem,
          justifyContent: 'center',
          alignItems: 'center',
        },
        capText: { color: 'white', fontSize: 12 * rem, lineHeight: 16 * rem },

        topRounded: { borderTopLeftRadius: 4, borderTopRightRadius: 4, overflow: 'hidden' },
        bottomRounded: { borderBottomLeftRadius: 4, borderBottomRightRadius: 4, overflow: 'hidden' },

        managerName: { fontSize: 16, fontWeight: '600', marginTop: 0, marginBottom: 0, color: 'white', textAlign: 'center' },
        managerRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          alignSelf: 'center',
          paddingHorizontal: 12,
          paddingVertical: 1,
          borderRadius: 12,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: C.border,
          backgroundColor: C.card,     // calm pill that matches the page
        },
        managerLabel: { color: C.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
        managerNameStrong: { color: C.ink, fontSize: 14, fontWeight: '800' },
        shareTiny: { padding: 4, borderRadius: 8, opacity: 0.9 }, // tiny share icon

        EOs: { flexDirection: 'row', width: imgwidth, alignSelf: 'center' },
        EOsRow: { overflow: 'hidden' },
        EO1: {
          fontSize: 9,
          lineHeight: 12,
          includeFontPadding: false,
          backgroundColor: isDark ? '#111827' : 'white',
          color:           isDark ? '#FFFFFF' : 'black',
          width: imgwidth / 2,
          textAlign: 'center',
          overflow: 'hidden',
        },
        EO2: {
          fontSize: 9,
          lineHeight: 12,
          includeFontPadding: false,
          backgroundColor: isDark ? '#243B5A' : 'lightgreen',
          color:           isDark ? '#FFFFFF' : 'black',
          width: imgwidth / 2,
          textAlign: 'center',
          overflow: 'hidden',
        },

        eventsSlot: {
  minHeight: 18,                 // one-line height
   justifyContent: 'center',
   alignItems: 'center',
 },
eventsIconsRow: {
  flexDirection: 'row',
   alignItems: 'center',
   justifyContent: 'center',
   // no wrap; ScrollView keeps it one line and scrolls if needed
   paddingHorizontal: 2,
   gap: 1,
 }   ,    eventsChip: {
          alignSelf: 'center',
          paddingHorizontal: 0,
          paddingVertical: 2,
          borderRadius: 10,
          backgroundColor: 'rgba(255,255,255,0.04)',
        },
        cardYellow: { width: 10, height: 14, borderRadius: 2, backgroundColor: '#ffd400', borderWidth: 0.5, borderColor: '#333' },
        cardRed: { width: 10, height: 14, borderRadius: 2, backgroundColor: '#e11d48', borderWidth: 0.5, borderColor: '#333' },
        assistPill: {  borderRadius: 6, paddingHorizontal: 2, paddingVertical: 0, borderWidth: 0.5 },
        assistText: { fontSize: 10, fontWeight: '700' },

        arrow: { width: 12 * rem, height: 12 * rem, marginBottom: 20 },
        statusPill: {
  paddingHorizontal: 3,
  paddingVertical: 2,
  borderRadius: 999,
  borderWidth: 1,
  marginBottom: 3,
},
statusLive: { backgroundColor: 'rgba(255, 213, 79, 0.12)', borderColor: C.yellow },
statusPillText: { color: C.goal, fontSize: 9, fontWeight: '600' },
fxLiveDot: { width: 6, height: 6, borderRadius: 999, marginTop: 4, backgroundColor: C.yellow },


        playerName: {
          fontSize: 10,
          lineHeight: imgheight,
          includeFontPadding: false,
          fontWeight: 'bold',
          marginTop: 0,
          marginBottom: 0,
          backgroundColor: 'black',
          color: 'white',
          width: imgwidth,
          textAlign: 'center',
          overflow: 'hidden',
           marginBottom: -1, 
        },

        played: {
          fontSize: 11,
          lineHeight: imgheight,
          includeFontPadding: false,
          width: imgwidth,
          textAlign: 'center',
          overflow: 'hidden',
          backgroundColor: isDark ? '#1f2937' : 'white',
          color:         isDark ? C.ink : 'black',
        },
        live: {
          fontSize: 11,
          lineHeight: imgheight,
          includeFontPadding: false,
          width: imgwidth,
          textAlign: 'center',
          overflow: 'hidden',
          backgroundColor: 'orange',
          color: 'black',
        },
        missed: {
          fontSize: 11,
          lineHeight: imgheight,
          includeFontPadding: false,
          width: imgwidth,
          textAlign: 'center',
          overflow: 'hidden',
          backgroundColor: 'red',
          color: 'white',
        },
        yet: {
          fontSize: 11,
          lineHeight: imgheight,
          includeFontPadding: false,
          width: imgwidth,
          textAlign: 'center',
          overflow: 'hidden',
          backgroundColor: '#1e9770',
          color: 'white',
        },
        input: {
          height: 40,
          alignSelf: 'stretch',
          minWidth: 240,
          borderWidth: 1,
          borderColor: C.border,
          backgroundColor: C.card,
          color: C.ink,
          paddingHorizontal: 10,
          borderRadius: 8,
          marginTop: 6,
        },
        modalBtnRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
        modalBtn: {
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: C.border,
          backgroundColor: C.card,
        },
        modalBtnText: { color: C.ink, fontWeight: '700' },


pitchDarkOverlay: {
  ...StyleSheet.absoluteFillObject,
  backgroundColor: 'rgba(0,0,0,0.35)', // tweak the 0.35 to taste (0.25–0.5)
}
,
        eoLegendInline: { marginLeft: 8, alignItems: 'center' },
        eoLegendCell: { fontSize: 7, lineHeight: 14 },
trophyPill: {
  width: '100%',
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: 10,
  borderWidth: StyleSheet.hairlineWidth,
},
eoLegendBlock: {
  width: '100%',
  alignItems: 'stretch',
  marginTop: 6,
},

        badgecontainer: {
          width: '100%',
          backgroundColor: C.card,
          borderTopWidth: 0,
          borderBottomWidth: 0,
          borderColor: C.border,
          flexDirection: 'row',
          justifyContent: 'space-around',
          alignItems: 'center',
          paddingVertical: 10 * rem,
          minHeight: 70 * rem,
          marginTop: 35 * vrem,
        },

        // Hidden off-screen clone container
        hiddenClone: {
          position: 'absolute',
          left: -10000,
          top: 0,
          width: SCREEN_W,
        },
      }),
    [C,pitchHeight, rowHeight, ROW_GAP, vrem, rem]
  );

  const SoccerWithCheck = ({ size = 12, color = 'darkblue', badgeColor = '#22c55e', ink = 'white' }) => (
  <View style={{ width: size, height: size }}>
    <MaterialCommunityIcons name="soccer" size={size} color={color} />
    <View
      style={{
        position: 'absolute',
        right: -size * 0.10,
        top: -size * 0.10,
        width: size * 0.55,
        height: size * 0.55,
        borderRadius: (size * 0.55) / 2,
        backgroundColor: badgeColor, // green
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(0,0,0,0.25)',
      }}
    >
      <MaterialCommunityIcons
        name="check-bold"
        size={size * 0.40}
        color={ink}
      />
    </View>
  </View>
);


  // Put this near EventIcon
const SoccerWithX = ({ size = 16, color = 'darkblue', badgeColor = '#ef4444', ink = '#fff' }) => (
  <View style={{ width: size, height: size }}>
    <MaterialCommunityIcons name="soccer" size={size} color={color} />
    <View
      style={{
        position: 'absolute',
        right: -size * 0.10,
        top: -size * 0.10,
        width: size * 0.55,
        height: size * 0.55,
        borderRadius: (size * 0.55) / 2,
        backgroundColor: badgeColor, // red
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(0,0,0,0.25)',
      }}
    >
      <Text
        style={{
          color: ink,
          fontSize: size * 0.45,
          lineHeight: size * 0.55,
          fontWeight: '900',
          includeFontPadding: false,
          textAlign: 'center',
        }}
      >
        ×
      </Text>
    </View>
  </View>
);


  // replace EventIcon with this version (adds dark-mode color only when used in modal)
  const EventIcon = ({ type, count, size = 12, forModal = false }) => {
    if (!count) return null;
    const wrap = { flexDirection: 'row', alignItems: 'center', marginHorizontal: 2 };
    const txt = { fontSize: 10, marginLeft: 2,  color: 'darkblue' };
    const iconColor = forModal ? C.ink : undefined;
    const K = {
     goal:  'darkblue', // green
     assist:'#3b82f6', // blue
     cs:    'darkblue', // cyan
     save:  '#a855f7', // purple
     bonus: 'gold', // amber
     def:   'darkblue', // emerald
   };
   const ICON_BG_DARK = 'rgba(0,0,0,0.55)';
 const ICON_BG_LIGHT = 'rgba(255,255,255,0.85)';
    const Count = () => (count > 1 ? <Text style={txt}>{count}</Text> : null);

    switch (type) {
      case 'goals_scored':
        return (
          <View style={wrap}>
            <MaterialCommunityIcons name="soccer" size={size} color={forModal ?  iconColor:  K.goal } />
            <Count />
          </View>
        );
        case 'minutes':
      return (
        <View style={wrap}>
          <MaterialCommunityIcons
            name="clock-outline"
            size={size}
            color={forModal ?  iconColor:  K.goal }
          />
          <Count />
        </View>
      );
    case 'assists':
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 2 }}>
      <LetterCircle
        label="A"
        size={12}
        bg="transparent"
        fg={forModal ? C.ink : 'darkblue'}
        stroke={forModal ? C.ink : '#333'}
        strokeWidth={1}
      />
      {count > 1 ? (
        <Text style={{ fontSize: 10, marginLeft: 2, color: forModal ? C.ink : 'darkblue' }}>
          {count}
        </Text>
      ) : null}
    </View>
  );


case 'penalties_saved':
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 2 }}>
      <SoccerWithCheck
        size={size}
        color={forModal ? iconColor : 'darkblue'}
        badgeColor={C.good || '#22c55e'}
        ink="white"
      />
      {count > 1 ? (
        <Text style={{ fontSize: 10, marginLeft: 2, color: forModal ? C.ink : 'darkblue' }}>
          {count}
        </Text>
      ) : null}
    </View>
  );


  case 'penalties_missed':
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 2 }}>
      <SoccerWithX
        size={size}
        color={forModal ? iconColor : 'darkblue'}
        badgeColor={C.bad || '#ef4444'}
        ink="white"
      />
      {count > 1 ? (
        <Text style={{ fontSize: 10, marginLeft: 2, color: forModal ? C.ink : 'darkblue' }}>
          {count}
        </Text>
      ) : null}
    </View>
  );



      case 'yellow_cards':
        return (
          <View style={wrap}>
            <View style={styles.cardYellow} />
          </View>
        );
      case 'red_cards':
        return (
          <View style={wrap}>
            <View style={styles.cardRed} />
          </View>
        );
      case 'clean_sheets':
        return (
          <View style={wrap}>
            <MaterialCommunityIcons name="shield-check" size={size} color={forModal ?  iconColor:K.cs} />
          </View>
        );
      case 'saves':
        return (
          <View style={wrap}>
            <MaterialCommunityIcons name="hand-back-right" size={size} color={forModal ?  iconColor:K.def} />
            <Count />
          </View>
        );
      case 'bonus':
        return (
          <View style={wrap}>
            <MaterialCommunityIcons name="star" size={size} color={forModal ?  iconColor:K.bonus} />
            <Count />
          </View>
        );
      case 'defensive_contribution':
        return (
          <View style={wrap}>
            <MaterialCommunityIcons name="wall" size={size} color={forModal ?  iconColor:K.def} />
          </View>
        );
      default:
        return null;
    }
  };

  // put near EventIcon / helpers
  const EONumbers = ({ top10k = 0, local = 0 }) => {
    const topVal = Number(top10k) || 0;
    const locVal = Number(local) || 0;
    return (
      <View style={styles.eoSection}>
        <View style={styles.eoLabelRow}>
          <Text style={styles.eoLabel}>{t('rank.top10kEo')}</Text>
          <Text style={styles.eoValue}>{locVal.toFixed(2)}%</Text>
        </View>
        <View style={styles.eoLabelRow}>
          <Text style={styles.eoLabel}>{t('rank.localEo')}</Text>
          <Text style={styles.eoValue}>{topVal.toFixed(2)}%</Text>
        </View>
      </View>
    );
  };

  const EventsRow = ({ counts, isLive = false }) => {
    const sum =
      counts.goals_scored +
      counts.assists +
      counts.yellow_cards +
      counts.red_cards +
      counts.clean_sheets +
      counts.saves +
      counts.penalties_saved +     // ← add this
  counts.penalties_missed +  
      counts.bonus +
     counts.defensive_contribution +
    (isLive ? (counts.minutesGame2 > 0 ? counts.minutesGame2 : counts.minutes) : 0);

    if (!sum) return null;

    return (
      <View style={styles.eventsChip}>
        <View style={styles.eventsIconsRow}>
        {isLive && (
  <>
    <View style={[styles.statusPill, styles.statusLive]}>
      <Text style={styles.statusPillText}>
        {(counts.minutesGame2 > 0 ? counts.minutesGame2 : counts.minutes)}'
      </Text>
    </View>
   
  </>
)}

          <EventIcon type="goals_scored" count={counts.goals_scored} />
          <EventIcon type="assists" count={counts.assists} />
          <EventIcon type="yellow_cards" count={counts.yellow_cards} />
          <EventIcon type="red_cards" count={counts.red_cards} />
          <EventIcon type="clean_sheets" count={counts.clean_sheets} />
          <EventIcon type="penalties_saved" count={counts.penalties_saved} />
          <EventIcon type="penalties_missed" count={counts.penalties_missed} />
          <EventIcon type="saves" count={counts.saves} />
          <EventIcon type="bonus" count={counts.bonus} />
          <EventIcon type="defensive_contribution" count={counts.defensive_contribution} />

        </View>
      </View>
    );
  };
// exposure map: { [pid]: 0|1|2|3 }
const [exposureMap, setExposureMap] = useState({});


const deriveMul = (p) => {
  if (!p) return 0;
  // Bench is 0×
  if (p.position === 'Bench') return 0;
  // Captaincy
  const cap = String(p.Cap || '').toLowerCase();
  if (cap === 'tc') return 3;
  if (cap === 'c') return 2;
  // Starter, not capped
  return 1;
};


useEffect(() => {
  // refresh whenever the modal opens to keep it up to date
  if (!modalVisible) return;
  (async () => {
    try {
      const raw = await AsyncStorage.getItem('myExposure');
      setExposureMap(raw ? JSON.parse(raw) : {});
    } catch {
      setExposureMap({});
    }
  })();
}, [modalVisible]);

  const [customManagerName, setCustomManagerName] = useState('');
  const [editNameVisible, setEditNameVisible] = useState(false);
  const [editNameText, setEditNameText] = useState('');
  const [info, setInfo] = useState({
    Points: '',
    Pointsfinal: 0,
    Newrank: '',
    arrow: 'same',
    GWrank: '',
    Safety: 0,
    Ranksubs: undefined,
    Ranknosubs: undefined,
    diffpercent: '',
    diffpercentsubs: '',
    diffpercentnosubs: '',
    oldRank: 0,
    diffPctSubsStr: '',
    diffPctNosubsStr: '',
    arrowsubs: 'same',
    arrownosubs: 'same',
    gw: '',
  });

  const [achCounts, setAchCounts] = useState(null);

useFocusEffect(
  useCallback(() => {
    let mounted = true;
    (async () => {
      try {
        const gw = Number(info?.gw || 0);
        if (!gw) { if (mounted) setAchCounts(null); return; }
        const raw = await AsyncStorage.getItem(`ach.counts:${gw}`);
        if (mounted) setAchCounts(raw ? JSON.parse(raw) : null);
      } catch {
        if (mounted) setAchCounts(null);
      }
    })();
    return () => { mounted = false; };
  }, [info.gw])
);

  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [settingsmodalVisible, setsettingsModalVisible] = useState(false);
  const [displaySettings, setDisplaySettings] = useState({
    showEOs: true,
    showEvents: true,
    includeSubs: false,
    showManagerName: true,
  });
    const DEFAULT_NOTIF_PREFS = {
    myTeamGoalsAssists: true,
    top10Threats: true,
    priceWarnings: true,
  };

  const [notifPrefs, setNotifPrefs] = useState(DEFAULT_NOTIF_PREFS);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('notif.prefs.v1');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (mounted && parsed && typeof parsed === 'object') {
            setNotifPrefs({ ...DEFAULT_NOTIF_PREFS, ...parsed });
            return;
          }
        }
      } catch {}

      // Seed defaults once if missing / bad
      try { await AsyncStorage.setItem('notif.prefs.v1', JSON.stringify(DEFAULT_NOTIF_PREFS)); } catch {}
      if (mounted) setNotifPrefs(DEFAULT_NOTIF_PREFS);
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await AsyncStorage.setItem('notif.prefs.v1', JSON.stringify(notifPrefs || DEFAULT_NOTIF_PREFS));
      } catch {}
    })();
  }, [notifPrefs]);

  const lastPrefsSigRef = useRef('');

useEffect(() => {
  // Only apply after prefs have loaded, and only for "my" team id
  if (!fplId) return;

  const sig = JSON.stringify(notifPrefs || {});
  if (sig === lastPrefsSigRef.current) return;
  lastPrefsSigRef.current = sig;

  applyMyTeamTopicsForCurrentPrefs({ fplId, notifPrefs });
}, [fplId, notifPrefs]);



  const [modalVisible, setModalVisible] = useState(false);
  const [selectedPlayerStats, setSelectedPlayerStats] = useState([]);
  const [selectedPlayerName, setSelectedPlayerName] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState(null);

  const handlePressPlayer = (player) => {
    setSelectedPlayerName(player.name);
    setSelectedPlayerStats(player.stats || []);
    setSelectedPlayer(player);
    setModalVisible(true);
  };

const HistoryChart = ({ rows, chips, width, height }) => {
  const pts = (rows || [])
    .filter((r) => Number.isFinite(Number(r?.event)) && Number.isFinite(Number(r?.overall_rank)))
    .map((r) => ({ x: Number(r.event), y: Number(r.overall_rank) }))
    .sort((a, b) => a.x - b.x);

  if (pts.length < 2) return null;

  const chipByGw = buildChipByGw(chips);

  // Make sure we use the provided width (screen fit), no forced min width.
  const w = Math.max(280, Number(width) || 320);
  const h = Math.max(170, Number(height) || 190);

  const padL = 44;
  const padR = 10;
  const padT = 10;
  const padB = 34;

  const xMin = Math.min(...pts.map((p) => p.x));
  const xMax = Math.max(...pts.map((p) => p.x));
  

  const X = (x) =>
    xMax === xMin ? padL : padL + ((x - xMin) / (xMax - xMin)) * (w - padL - padR);

  const yMinRaw = Math.min(...pts.map((p) => p.y));
const yMaxRaw = Math.max(...pts.map((p) => p.y));

// More detail at the top + always show these
const BENCH_ALWAYS = [ 100_000, 1_000_000];

const yMin = Math.max(1, Math.min(yMinRaw, ...BENCH_ALWAYS));
const yMax = Math.max(yMaxRaw, ...BENCH_ALWAYS);

// log scale helpers
const log10 = (v) => Math.log(v) / Math.LN10;
const yMinL = log10(yMin);
const yMaxL = log10(yMax);

// Smaller rank (better) should be higher on screen
const Y = (y) => {
  const yy = Math.max(1, Number(y) || 1);
  const yl = log10(yy);
  return yMaxL === yMinL
    ? padT
    : padT + ((yl - yMinL) / (yMaxL - yMinL)) * (h - padT - padB);
};

  const poly = pts.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');


let yTicks = [...BENCH_ALWAYS]; // always show these

// also include endpoints (nice framing)
const pushIfMissing = (v) => {
  if (!yTicks.some((t) => Math.abs(t - v) < 1)) yTicks.push(v);
};
pushIfMissing(yMinRaw);
pushIfMissing(yMaxRaw);

yTicks = yTicks.slice().sort((a, b) => a - b);

  
  

  const xVals = pts.map((p) => p.x);

  // Chip markers: only those GWs that exist in our pts
  const chipMarks = Object.keys(chipByGw)
    .map((k) => Number(k))
    .filter((gw) => pts.some((p) => p.x === gw))
    .sort((a, b) => a - b);

  const yAtGw = (gw) => {
    const hit = pts.find((p) => p.x === gw);
    return hit ? hit.y : null;
  };

  return (
    <View
      style={{
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: C.border,
        backgroundColor: C.card,
        borderRadius: 12,
        padding: 10,
        marginBottom: 10,
      }}
    >
      <Text style={{ color: C.ink, fontWeight: '800', marginBottom: 8 }}>Overall Rank Trend</Text>

      <Svg width={w} height={h}>
        {/* Y grid + labels */}
        {yTicks.map((val, i) => {
          const yy = Y(val);
          return (
            <React.Fragment key={`y-${i}`}>
              <Line x1={padL} y1={yy} x2={w - padR} y2={yy} stroke={C.border} strokeWidth={1} />
              <SvgText
                x={padL - 6}
                y={yy}
                fill={C.muted}
                fontSize={10}
                fontWeight="700"
                textAnchor="end"
                alignmentBaseline="middle"
              >
                {fmtShort(val)}
              </SvgText>
            </React.Fragment>
          );
        })}

        {/* Trend line */}
        <Polyline points={poly} fill="none" stroke={C.accent} strokeWidth={2.5} />

        

        {/* Chip labels (BB/WC/TC/FH) */}
        {chipMarks.map((gw) => {
          const yv = yAtGw(gw);
          if (!Number.isFinite(yv)) return null;
          const xx = X(gw);
          const yy = Y(yv);

          return (
            <React.Fragment key={`chip-${gw}`}>
              {/* small dot above point */}
              <SvgText
                x={xx}
                y={Math.max(padT + 2, yy - 14)}
                fill={C.ink}
                fontSize={9}
                fontWeight="900"
                textAnchor="middle"
                alignmentBaseline="baseline"
              >
                {chipByGw[gw]}
              </SvgText>
            </React.Fragment>
          );
        })}

        {/* X labels: just numbers 1,2,3,... */}
        {xVals.map((ev, i) => (
          <SvgText
            key={`x-${ev}-${i}`}
            x={X(ev)}
            y={h - 8}
            fill={C.muted}
            fontSize={8}
            fontWeight="800"
            textAnchor="middle"
          >
            {String(ev)}
          </SvgText>
        ))}
      </Svg>

      <Text style={{ color: C.muted, fontSize: 11, marginTop: 6 }}>
        (Higher on the chart = better rank)
      </Text>
    </View>
  );
};

const QuickActionsBar = () => (
  <View style={{ width: '100%', paddingHorizontal: 12, marginTop: 6 }}>
    <View
      style={[
        styles.managerRow,
        {
          justifyContent: 'space-between',
          paddingVertical: 8,
          gap: 10,
        },
      ]}
    >
      {[
        {
          key: 'share',
          icon: 'share-variant',
          label: t('rank.share'),
          onPress: handleShare,
          disabled: false,
        },
        {
          key: 'out',
          icon: 'magnify-minus',
          label: t('rank.zoomMinus'),
          onPress: () => bumpScale(-STEP),
          disabled: atMin,
        },
        {
          key: 'in',
          icon: 'magnify-plus',
          label: t('rank.zoomPlus'),
          onPress: () => bumpScale(+STEP),
          disabled: atMax,
        },
        {
          key: 'trophies',
          icon: 'trophy-outline',
          label: t('rank.trophies'),
          onPress: () => navigation.navigate('Trophies'),
          disabled: false,
        },
      ].map((b) => (
        <TouchableOpacity
          key={b.key}
          onPress={b.onPress}
          disabled={b.disabled}
          style={{
            flex: 1,
            opacity: b.disabled ? 0.35 : 1,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            backgroundColor: C.card2,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: C.border,
            borderRadius: 12,
            paddingVertical: 8,
          }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialCommunityIcons name={b.icon} size={18} color={C.ink} />
          <Text style={{ color: C.ink, fontSize: 11, fontWeight: '800' }}>
            {b.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  </View>
);


const HistoryTable = ({ rows, chips }) => {
  const data = (rows || []).slice().sort((a, b) => Number(b?.event || 0) - Number(a?.event || 0));
  const chipByGw = buildChipByGw(chips);

  const col = {
    gw: 44,
    chip: 44,
    or: 86,
    gwr: 76,
    chg: 66,
    arr: 26,
  };

  const calc = (item, prev) => {
  const cur = Number(item?.overall_rank);
  const prv = Number(prev?.overall_rank);
  const hasPrev = Number.isFinite(cur) && Number.isFinite(prv) && prv > 0;

  const diff = hasPrev ? (prv - cur) : 0; // + = improved
  const pct = hasPrev ? (diff / prv) * 100 : null;

  const improved = pct == null ? null : diff >= 0;
  const arrowKey = improved == null ? null : improved ? 'up' : 'down';
  return { pct, arrowKey };
};


  const fixed = { gw: 44, chip: 44, arr: 26 }; // keep these fixed
const flex = { or: 1.15, gwr: 1.0, chg: 1.0 }; // these expand/shrink nicely

const HeaderCell = ({ w, flexGrow, children, align = 'left', minW = 0 }) => (
  <Text
    style={{
      ...(w ? { width: w } : { flexGrow: flexGrow ?? 1, flexBasis: 0, minWidth: minW }),
      color: C.muted,
      fontWeight: '900',
      fontSize: 11,
      textAlign: align,
    }}
    numberOfLines={1}
  >
    {children}
  </Text>
);

const Cell = ({ w, flexGrow, children, align = 'left', color = C.ink, bold = false, minW = 0 }) => (
  <Text
    style={{
      ...(w ? { width: w } : { flexGrow: flexGrow ?? 1, flexBasis: 0, minWidth: minW }),
      color,
      fontWeight: bold ? '900' : '700',
      fontSize: 12,
      textAlign: align,
      fontVariant: ['tabular-nums'],
    }}
    numberOfLines={1}
    ellipsizeMode="clip"
  >
    {children}
  </Text>
);


  return (
    <View
      style={{
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: C.border,
        backgroundColor: C.card,
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          paddingVertical: 10,
          paddingHorizontal: 10,
          backgroundColor: C.card2,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderColor: C.border,
        }}
      >
        <Text style={{ color: C.ink, fontWeight: '900' }}>{t('rank.history')}</Text>
        <Text style={{ color: C.muted, marginTop: 2, fontSize: 11 }}>
          {t('rank.historySubtitle')}
        </Text>
      </View>

      {/* table header row */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 10,
          paddingVertical: 8,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderColor: C.border,
        }}
      >
        <HeaderCell w={fixed.gw}>GW</HeaderCell>
<HeaderCell w={fixed.chip} align="center">Chip</HeaderCell>
<HeaderCell w={fixed.arr} align="center"> </HeaderCell>

<HeaderCell flexGrow={flex.or}  minW={78}>{t('rank.or')}</HeaderCell>
<HeaderCell flexGrow={flex.gwr} minW={92} align="right">{t('rank.gwRank')}</HeaderCell>
<HeaderCell flexGrow={flex.chg} minW={74} align="right">Δ%</HeaderCell>

      </View>

      {data.map((item, idx) => {
        const prev = data[idx + 1];
        const { pct, arrowKey } = calc(item, prev);

        const gw = Number(item?.event);
        const chip = chipByGw[gw] || '—';

        return (
          <View
            key={`gw-${item?.event}-${idx}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 10,
              paddingVertical: 10,
              borderBottomWidth: idx === data.length - 1 ? 0 : StyleSheet.hairlineWidth,
              borderColor: C.border,
            }}
          >
            <Cell w={fixed.gw} bold>{String(item?.event ?? '')}</Cell>

<Cell w={fixed.chip} align="center" bold color={chip === '—' ? C.muted : C.ink}>
  {chip}
</Cell>

<View style={{ width: fixed.arr, alignItems: 'center', justifyContent: 'center' }}>
  {arrowKey ? (
    <Image source={assetImages[arrowKey]} style={{ width: 14, height: 14, resizeMode: 'contain' }} />
  ) : (
    <Text style={{ color: C.muted, fontWeight: '900' }}>•</Text>
  )}
</View>

<Cell flexGrow={flex.or}  minW={78} bold>{fmtShort(item?.overall_rank)}</Cell>
<Cell flexGrow={flex.gwr} minW={92} align="right">{fmtShort(item?.rank)}</Cell>

<Cell
  flexGrow={flex.chg}
  minW={74}
  align="right"
  color={pct == null ? C.muted : (pct >= 0 ? (C.good || '#22c55e') : (C.bad || '#ef4444'))}
  bold
>
  {pct == null ? '-' : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`}
</Cell>

          </View>
        );
      })}
    </View>
  );
};


const renderStatsListCompact = (stats = [], C) => {
  if (!stats?.length) {
    return (
      <View style={{
        paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10,
        borderWidth: 1, borderColor: C.border, backgroundColor: C.card
      }}>
        <Text style={{ color: C.muted, textAlign: 'center' }}>No stats available</Text>
      </View>
    );
  }

  const Row = ({ k, c, pts }) => (
    <View style={{
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingVertical: 10, paddingHorizontal: 12,
      borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
        <EventIcon type={k} count={1} size={16} forModal />
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={{ color: C.ink, fontSize: 13, fontWeight: '600', flex: 1 }}
        >
          {String(k).replace(/_/g, ' ').toUpperCase()}
        </Text>
      </View>

      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: C.card2, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border,
        paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999
      }}>
        <Text style={{ color: C.ink, fontSize: 12, fontVariant: ['tabular-nums'] }}>
          {Number(c || 0)}
        </Text>
        <Text style={{ color: C.muted, fontSize: 12 }}>•</Text>
        <Text style={{ color: C.ink, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
          {Number(pts || 0)}
        </Text>
      </View>
    </View>
  );

  return (
    <View style={{ borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: C.border, backgroundColor: C.card }}>
      {stats.map((item, i) => {
        const k = String(item?.[0] ?? '').toLowerCase();
        const c = item?.[1];
        const p = item?.[2];
        return <Row key={`${k}-${i}`} k={k} c={c} pts={p} />;
      })}
    </View>
  );
};

  const renderStatsTable = (stats) => {
    if (!stats || stats.length === 0) return <Text>No stats available</Text>;

    return (
      <View style={{ width: '100%' }}>
        <View style={styles.statsHeader}>
          <Text style={[styles.headerText, { color: C.ink, flex: 3, textAlign: 'left' }]}>{t('rank.event')}</Text>
          <Text style={[styles.headerText, { color: C.ink, flex: 1, textAlign: 'center' }]}>{t('rank.count')}</Text>
          <Text style={[styles.headerText, { color: C.ink, flex: 1, textAlign: 'center' }]}>{t('rank.points')}</Text>
        </View>

        {stats.map((item, index) => {
          const key = String(item[0]).toLowerCase();
          return (
            <View key={index} style={styles.statRow}>
              <View style={{ flex: 3, flexDirection: 'row', alignItems: 'center' }}>
                <EventIcon type={key} count={1} size={14} forModal />
                <Text
                  style={[styles.statName, { color: C.ink, marginLeft: 6 }]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {String(item[0]).replace(/_/g, ' ').toUpperCase()}
                </Text>
              </View>
              <Text style={[styles.statValue, { color: C.ink, flex: 1, textAlign: 'center' }]}>{item[1]}</Text>
              <Text style={[styles.statValue, { color: C.ink, flex: 1, textAlign: 'center' }]}>{item[2]}</Text>
            </View>
          );
        })}
      </View>
    );
  };

  const LIVE_FORCE_TTL_MS = 5 * 60 * 1000;

function hasLiveGamesFromPayload(p) {
  if (!p) return false;

  // common flags
  if (p.has_live_games === true || p.live_games === true || p.is_live === true) return true;

  // ✅ Rank payload usually knows "live" via players (status: 'l')
  const team = p.team || p.Team;
  if (Array.isArray(team)) {
    if (team.some(pl => String(pl?.status ?? '').toLowerCase() === 'l')) return true;
    // if status is already mapped somewhere, this also works:
    // if (team.some(pl => find_status(pl?.status ?? 'd') === 'live')) return true;
  }

  // fallback: games/fixtures shapes (your existing logic)
  const games = p.games || p.Games || p.fixtures || p.Fixtures;
  if (!Array.isArray(games)) return false;

  return games.some(g => {
    const status = String(g?.status ?? g?.Status ?? '').toLowerCase();
    if (status.includes('live') || status.includes('playing') || status.includes('in play')) return true;

    const started = g?.started ?? g?.Started;
    const finished = g?.finished ?? g?.Finished ?? g?.ended ?? g?.Ended;
    if (started === true && finished !== true) return true;

    const minute = g?.minute ?? g?.Minute ?? g?.min ?? g?.Min;
    if (Number.isFinite(Number(minute)) && Number(minute) > 0 && finished !== true) return true;

    return false;
  });
}


  const pickPayload = (json, id) => {
    if (!json) return null;
    if (json[id]) return json[id];
    if (json[String(id)]) return json[String(id)];
    const keys = Object.keys(json);
    if (keys.length === 1 && typeof json[keys[0]] === 'object') {
      return json[keys[0]];
    }
    return json;
  };
  const isValidFplId = (v) => {
    const s = String(v ?? '').trim();
    if (!s) return false;
    if (s === '0' || s === 'null' || s === 'undefined') return false;
    return /^\d{2,10}$/.test(s) && Number(s) > 0;
  };

  // ---- NEW: guards to prevent duplicate requests ----
  const inFlightRef = useRef(null);      // coalesce concurrent triggers
  const abortRef = useRef(null);         // cancel stale requests

  const fetchData = useCallback(async () => {
  // Coalesce: if a request is already in-flight, reuse it
  if (inFlightRef.current) return inFlightRef.current;

  // Start a new request promise
  inFlightRef.current = (async () => {
    // Abort any previous (stale) request
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError(null);

    try {
      const stored = await AsyncStorage.getItem('fplId');
      const rawId = viewFplId ?? stored ?? fplId;
      const effectiveId = isValidFplId(rawId) ? String(rawId) : null;
      // --- Housekeep legacy keys so WhatIf never sees another account's rank ---
  try {
    // If the signed-in id changed, update it and nuke the legacy 'fplData'
    const myIdStr = String(fplId || '');
    const storedMyId = stored || '';
    if (myIdStr && storedMyId !== myIdStr) {
      await AsyncStorage.setItem('fplId', myIdStr);
      try { await AsyncStorage.removeItem('fplData'); } catch {}
    }
  } catch {}

      if (!effectiveId) {
        requestAnimationFrame(() => {
          navigation.dispatch(
            CommonActions.navigate({ name: 'ID', params: {}, merge: false })
          );
        });
        return;
      }

      const now = Date.now();
      let payload = null;

      // --- Read remote gen from CDN (cheap, no auth)
      let remoteGen = null;
      try {
        const vres = await fetch(`${GEN_URL}?t=${Date.now()}`, { cache: 'no-store', signal: ctrl.signal });
        if (vres.ok) {
          const vjson = await vres.json();
          const raw = (typeof vjson === 'number') ? vjson : vjson?.gen;
          const g = Number(raw);
          if (Number.isFinite(g)) remoteGen = g;
        }
      } catch {
        // soft-fail: fall back to time-based cache logic below
      }

      // 🔁 Read from a per-entry cache (works for both my team and viewFplId)
  const cacheKey = `fplData:${effectiveId}`;
  const legacyKey = 'fplData'; // keep for backward-compat with existing readers

  try {
    // Prefer per-entry cache; fall back to legacy if it matches this id
    const rawScoped = await AsyncStorage.getItem(cacheKey);
    const rawLegacy = !rawScoped ? await AsyncStorage.getItem(legacyKey) : null;
    const parsed = rawScoped
      ? JSON.parse(rawScoped)
      : rawLegacy
      ? JSON.parse(rawLegacy)
      : null;

    if (parsed?.id === effectiveId) {
      const cachedTs  = Number(parsed?.timestamp || 0);
      const cachedGen = Number(parsed?.gen);
      const tooOld    = cachedTs ? (now - cachedTs > TWO_DAYS_MS) : true;
      if (!tooOld) {
        const genMatches = Number.isFinite(remoteGen) && Number.isFinite(cachedGen) && (remoteGen === cachedGen);

if (genMatches) {
  const ageMs = now - cachedTs;
  const cachedHasLive = hasLiveGamesFromPayload(parsed.data);

  // If live games + cache older than 5 minutes: don't trust it even if gen matches.
  if (!(cachedHasLive && ageMs > LIVE_FORCE_TTL_MS)) {
    payload = parsed.data; // fresh enough
  }
} else if (!Number.isFinite(remoteGen) && (now - cachedTs < CACHE_TTL_MS)) {
  payload = parsed.data; // CDN down → honor short TTL
}

      }
    }
  } catch { /* ignore cache read errors */ }


      if (!payload) {
        const resp = await smartFetch(
  `/LH_api2/${encodeURIComponent(effectiveId)}`,
  { signal: ctrl.signal }
);

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();
        try {
          if (effectiveId) {
            await AsyncStorage.setItem(`latestRankData:${effectiveId}`, JSON.stringify(json));
          }
        } catch (e) {
          console.warn('Failed to cache rank data', e);
        }

        payload = pickPayload(json, effectiveId);

        

        const localGroup = Number(payload?.local ?? payload?.Local ?? payload?.local_group ?? payload?.group);
        if (localGroup) {
          try {
            await AsyncStorage.setItem('localGroup', String(localGroup));
          } catch {}
        }

        

        // ✅ Persist per-entry cache for ANY entry we open
    await AsyncStorage.setItem(
      cacheKey,
      JSON.stringify({ data: payload, timestamp: now, id: effectiveId, gen: remoteGen })
    );
    // Also write legacy key only for "my" team to avoid breaking old readers
    if (!viewFplId && effectiveId === String(fplId)) {
      await AsyncStorage.setItem(
        legacyKey,
        JSON.stringify({ data: payload, timestamp: now, id: effectiveId, gen: remoteGen })
      );
    }
      }

      // Ensure local group is persisted even when reading from cache
      try {
        const lg = Number(
          payload?.local ??
          payload?.Local ??
          payload?.local_group ??
          payload?.group
        );
        if (Number.isFinite(lg) && lg > 0) {
          await AsyncStorage.setItem('localGroup', String(lg));
          try {
          await AsyncStorage.setItem(`localGroup:${String(effectiveId)}`, String(lg));
        } catch {}
        }
      } catch {}

      // ✅ Always persist exposure for this ID (works for cache or network)
     try {
       await persistExposureForPayload(payload, effectiveId);
     } catch {}
     
     // ✅ Keep WhatIf’s legacy reader fresh when we’re viewing *my* team,
     // even if Rank used the cached payload (WhatIf reads 'fplData')
     try {
       const entry = JSON.stringify({
         data: payload,
         timestamp: Date.now(),
         id: effectiveId,
         gen: remoteGen,
       });
       // Maintain the per-id cache for completeness
       await AsyncStorage.setItem(`fplData:${effectiveId}`, entry);
       // Only refresh legacy key for "my" team (WhatIf reads this)
       if (!viewFplId && effectiveId === String(fplId)) {
         await AsyncStorage.setItem('fplData', entry);
       }
     } catch {}

      try {
       await persistExposureForPayload(payload, effectiveId);
     } catch {}
setOnePt(payload?.one_pt ?? payload?.onePt ?? payload?.one_pt_est ?? null);

      // ---- downstream: unchanged UI mapping ----
      const live = Number(payload?.live_points ?? 0);
      const bench = Number(payload?.bench_points ?? 0);
      const hit = Number(payload?.hit ?? 0);
      const livePlusBench = live + bench;
      const pointsfinal = livePlusBench + hit;

      // Respect saved user preference if present, else fallback to API's 'aut', else current UI state
 let includeVal = displaySettings.includeSubs;
 try {
   const saved = await AsyncStorage.getItem(INCLUDE_SUBS_KEY);
   if (saved === '1' || saved === '0') includeVal = (saved === '1');
   else if (payload?.aut != null) includeVal = !!payload.aut;
 } catch {}
 setDisplaySettings((prev) => ({ ...prev, includeSubs: includeVal }));

      const displayRank = includeVal
        ? payload?.post_rank ?? payload?.displayrank
        : payload?.pre_rank ?? payload?.displayrank;

      const arrowDirection =
        (displayRank ?? 0) > (payload?.old_rank ?? 0)
          ? 'down'
          : (payload?.old_rank ?? 0) > (displayRank ?? 0)
          ? 'up'
          : 'same';

      const safetyVal = Number(payload?.safety ?? 0);
const difference = pointsfinal - safetyVal;
const fmtDelta = (n) => (n > 0 ? `+${n}` : n < 0 ? `${n}` : '0');
const subText = t('rank.safetyDelta', { safety: safetyVal, delta: fmtDelta(difference) });


      const safeDiv = (n, d) => (d ? (n * 100) / d : 0);
      const diffrank = -(displayRank ?? 0) + (payload?.old_rank ?? 0);
      const diffpercent = safeDiv(diffrank, payload?.old_rank ?? 0).toFixed(2);
      const diffpercentText = t('rank.oldRankPct', { rank: (payload?.old_rank ?? 0).toLocaleString(), pct: `${Number(diffpercent) > 0 ? '+' : ''}${diffpercent}` });

      const diffranksubs = -(payload?.post_rank ?? 0) + (payload?.old_rank ?? 0);
      const diffpercentsubs = safeDiv(diffranksubs, payload?.old_rank ?? 0).toFixed(2);
      const diffpercentsubsText = t('rank.oldRankPct', { rank: (payload?.old_rank ?? 0).toLocaleString(), pct: `${Number(diffpercentsubs) > 0 ? '+' : ''}${diffpercentsubs}` });

      const diffranknosubs = -(payload?.pre_rank ?? 0) + (payload?.old_rank ?? 0);
      const diffpercentnosubs = safeDiv(diffranknosubs, payload?.old_rank ?? 0).toFixed(2);
      const diffpercentnosubsText = t('rank.oldRankPct', { rank: (payload?.old_rank ?? 0).toLocaleString(), pct: `${Number(diffpercentnosubs) > 0 ? '+' : ''}${diffpercentnosubs}` });

      const arrowsubs =
        (payload?.post_rank ?? 0) > (payload?.old_rank ?? 0)
          ? 'down'
          : (payload?.old_rank ?? 0) > (payload?.post_rank ?? 0)
          ? 'up'
          : 'same';

      const arrownosubs =
        (payload?.pre_rank ?? 0) > (payload?.old_rank ?? 0)
          ? 'down'
          : (payload?.old_rank ?? 0) > (payload?.pre_rank ?? 0)
          ? 'up'
          : 'same';

      // Persist current GW so other screens can bust cache by GW
      try {
        const gwNum = Number(payload?.gw ?? payload?.GW ?? payload?.gameweek);
        if (Number.isFinite(gwNum) && gwNum > 0) {
          await AsyncStorage.setItem('gw.current', String(gwNum));
          await AsyncStorage.setItem('gw.current.t', String(Date.now())); // optional: when seen
        }
      } catch {}

      // --- Persist anchor info for What-If ---
      try {
        const seasonTotal = Number(payload?.total_points ?? payload?.total ?? payload?.season_total ?? 0);

        const usedLiveRank = (() => {
          if (includeVal) return Number(payload?.post_rank ?? payload?.displayrank ?? 0);
          return Number(payload?.pre_rank ?? payload?.displayrank ?? 0);
        })();

        const anchor = {
          seasonTotal,
          liveRank: usedLiveRank,
          oldRank: Number(payload?.old_rank ?? 0),
          includeSubs: !!includeVal,
          gw: Number(payload?.gw ?? payload?.GW ?? payload?.gameweek ?? 0),
          livePoints: Number(payload?.live_points ?? 0),
          benchPoints: Number(payload?.bench_points ?? 0),
          hit: Number(payload?.hit ?? 0),
          safety: Number(payload?.safety ?? 0),
          when: Date.now(),
        };

        await AsyncStorage.setItem('whatif.anchor', JSON.stringify(anchor));
      } catch (e) {
        // non-fatal
      }

      setInfo({
        diffrank,
        diffpercent: diffpercentText,
        subsafety: subText,
        Pointsfinal: pointsfinal,
        Hit: hit,
        Points: `${livePlusBench}(${hit})=${pointsfinal}`,
        Newrank: displayRank,
        arrow: arrowDirection,
        Safety: Number(payload?.safety ?? 0),
        Ranksubs: payload?.post_rank,
        Ranknosubs: payload?.pre_rank,
        diffpercentsubs: diffpercentsubsText,
        diffpercentnosubs: diffpercentnosubsText,
        oldRank: payload?.old_rank ?? 0,
        diffPctSubsStr: `${Number(diffpercentsubs) > 0 ? '+' : ''}${diffpercentsubs}`,
        diffPctNosubsStr: `${Number(diffpercentnosubs) > 0 ? '+' : ''}${diffpercentnosubs}`,
        arrowsubs,
        arrownosubs,
        GWrank: payload?.GWrank,
        gw: payload?.gw,
        manager: payload?.manager ?? '',
      });

      const playersData = (payload?.team ?? []).map((player) => {
        const EO1p = Number(player?.EO1 ?? 0) * 100;
        const EO2p = Number(player?.EO2 ?? 0) * 100;
        const fmt = (x) => (x > 0 ? Math.round(x) : x.toFixed(1));
        const role = player?.role;
        const isBench = role === 'b';
        const pos = isBench ? 'Bench' : Number(player?.position ?? 0);
        const statsFiltered = (player?.stats ?? []).filter((stat) => String(stat[0]).toLowerCase() !== 'bps');
        const pid = Number(player?.fpl_id ?? player?.element ?? player?.id ?? player?.code);

        return {
          pid,
          key: String(player?.code ?? player?.fpl_id ?? player?.name),
          name: String(player?.name ?? ''),
          position: pos,
          team: Number(player?.club ?? 0),
          EO: fmt(EO1p),
          EO2: fmt(EO2p),
          EO_local: EO1p,   // precise numeric for modal
          EO_top10k: EO2p,  // precise numeric for modal
          Emoji: find_emoji(player?.emoji ?? ''),
          emojiCode: String(player?.emoji ?? ''),
          Status: find_status(player?.status ?? 'd'),
          Points: Number(player?.points ?? 0),
          Cap: !isBench && role !== 's' ? role : '',
          imageUri: clubCrestUri(player?.club ?? 1),
          stats: statsFiltered,
        };
      });
      const exposureFromPlayers = {};
for (const p of playersData) {
  exposureFromPlayers[p.pid] = deriveMul(p);
}
setExposureMap(exposureFromPlayers);
            // Push subs: update once per GW when the team loads successfully (own team only)
      if (!viewFplId) {
        await updateMyTeamPushSubsOncePerGW({ gw: payload?.gw, players: playersData, fplId: fplId });
      }

      setPlayers(playersData);
    } catch (e) {
      // Swallow aborts, surface real errors
      if (e?.name !== 'AbortError') {
        console.error('Failed to fetch data:', e);
        setError(String(e?.message ?? e));
      }
    } finally {
      setLoading(false);
      // Clear in-flight marker
      inFlightRef.current = null;
    }
  })();

  return inFlightRef.current;
}, [fplId, navigation, viewFplId]);


  // 🚫 Removed the extra useEffect that also called fetchData()
  // It was racing with useFocusEffect and duplicating network calls.
 // Run once when an ID first becomes available (cold start)
 
  useFocusEffect(
    useCallback(() => {
      setRankTab('pitch');
      setQuickBarOpen(false);
    setQuickOpen(false);
      // kick off fetch
      fetchData();

      return () => {};
    }, [fetchData, triggerRefetch]) 
  );

  // ✅ Preload cached data for this ID (so Achievements can use it immediately)
useEffect(() => {
  (async () => {
    const storedId = viewFplId ?? fplId;
    if (!storedId) return;
        const cached = await AsyncStorage.getItem(`latestRankData:${storedId}`);

    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        // only set if it's valid data (not empty)
        if (parsed && typeof parsed === 'object') {
          // no harm to re-set players/info early
          // Achievements will read same key
        }
      } catch {}
    }
  })();
}, [fplId, viewFplId]);

useEffect(() => {
  (async () => {
    try {
      const s = await AsyncStorage.getItem(SCALE_KEY);
      const v = s ? Number(s) : NaN;
      if (Number.isFinite(v)) {
        const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, parseFloat(v.toFixed(2))));
        scaleRef.current = clamped;
        setPitchScale(clamped);
      }
    } catch {}
  })();
}, []);


useEffect(() => {
   return () => {
     if (abortRef.current) {
       try { abortRef.current.abort(); } catch {}
     }
   };
 }, []);
  const handleRefresh = () => {
    setRefreshing(true);
    fetchData().finally(() => setRefreshing(false));
  };

  // Share handler — captures the hidden off-screen clone
// Share handler — captures the hidden off-screen clone
const handleShare = useCallback(async () => {
  try {
    // Let the hidden clone lay out
    await new Promise((r) => requestAnimationFrame(() => r()));

    // Always capture to a real tmp file with a .png extension
    const uri = await captureRef(shareTargetRef.current, {
      format: 'png',
      quality: 1,
      result: 'tmpfile',
      fileName: `livefpl-rank-${Date.now()}`, // ensures .../livefpl-rank-12345.png
    });

    if (Platform.OS === 'ios') {
      // iOS: real file URL makes "Save Image" reliably appear on TestFlight/App Store builds
      await Share.share({ url: uri });
      return;
    }

    // Android: keep using expo-sharing with a MIME hint
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        dialogTitle: `GW${info.gw} — LiveFPL Rank`,
        mimeType: 'image/png',
      });
    } else {
      await Share.share({ url: uri });
    }
  } catch (e) {
    console.error('Share failed:', e);
    setError('Could not prepare image to share');
  }
}, [info.gw]);




  const playersWithStats = players;
  const goalkeepers = playersWithStats.filter((p) => p.position === 1);
  const defenders = playersWithStats.filter((p) => p.position === 2);
  const midfielders = playersWithStats.filter((p) => p.position === 3);
  const forwards = playersWithStats.filter((p) => p.position === 4);
  const bench = playersWithStats.filter((p) => p.position === 'Bench');
  const items = [goalkeepers, defenders, midfielders, forwards, bench];
  const effectiveIdForLink = useMemo(() => {
    const override = route?.params?.viewFplId;
    return (override && String(override)) || (fplId && String(fplId)) || null;
  }, [route?.params?.viewFplId, fplId]);

  // Key scoped to the active FPL id
  const managerStorageKey = useMemo(
    () => (effectiveIdForLink ? `mgrOverride:${effectiveIdForLink}` : null),
    [effectiveIdForLink]
  );

  // Load override whenever id changes (or when a fresh API name arrives)
  useEffect(() => {
    if (!managerStorageKey) { setCustomManagerName(''); return; }
    (async () => {
      try {
        const v = await AsyncStorage.getItem(managerStorageKey);
        setCustomManagerName(v || '');
      } catch {}
    })();
  }, [managerStorageKey, info.manager]);

  // What to show: local override if set, else API name
  const displayManagerName = customManagerName || info.manager;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['left', 'right']}>
      <AppHeader title={t('rank.title')} />

      <ScrollView
        minimumZoomScale={1}
        maximumZoomScale={4}
        style={{ backgroundColor: C.bg }}
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <View style={styles.container}>
          <Modal
            visible={editNameVisible}
            transparent
            animationType="fade"
            onRequestClose={() => setEditNameVisible(false)}
          >
            <View style={styles.centeredView}>
              <View style={styles.modalView}>
                <TouchableOpacity
                  onPress={() => setEditNameVisible(false)}
                  style={styles.modalClose}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('rank.closeRename')}
                >
                  <MaterialCommunityIcons name="close" size={20} color={C.ink} />
                </TouchableOpacity>

                <Text style={[styles.modalTitle, { color: C.ink }]}>{t('rank.editManagerName')}</Text>

                <ThemedTextInput
                  value={editNameText}
                  onChangeText={setEditNameText}
                  placeholder={t('rank.managerNamePlaceholder')}
                  placeholderTextColor={C.placeholder || (isDark ? '#93a4bf' : '#94a3b8')}
                  style={styles.input}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={async () => {
                    if (!managerStorageKey) return;
                    const t = (editNameText || '').trim();
                    if (t) {
                      await AsyncStorage.setItem(managerStorageKey, t);
                      setCustomManagerName(t);
                    } else {
                      await AsyncStorage.removeItem(managerStorageKey);
                      setCustomManagerName('');
                    }
                    setEditNameVisible(false);
                  }}
                />

                <View style={styles.modalBtnRow}>
                  <TouchableOpacity
                    onPress={async () => {
                      if (!managerStorageKey) return;
                      await AsyncStorage.removeItem(managerStorageKey);
                      setCustomManagerName('');
                      setEditNameVisible(false);
                    }}
                    style={styles.modalBtn}
                  >
                    <Text style={styles.modalBtnText}>Reset</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={async () => {
                      if (!managerStorageKey) return;
                      const t = (editNameText || '').trim();
                      if (t) {
                        await AsyncStorage.setItem(managerStorageKey, t);
                        setCustomManagerName(t);
                      } else {
                        await AsyncStorage.removeItem(managerStorageKey);
                        setCustomManagerName('');
                      }
                      setEditNameVisible(false);
                    }}
                    style={[styles.modalBtn, { borderColor: C.accent }]}
                  >
                    <Text style={[styles.modalBtnText, { color: C.accent }]}>Save</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
          <PlayerInfoModal
  visible={infoOpen}
  onClose={() => setInfoOpen(false)}
  playerId={infoPlayer.id}
  playerName={infoPlayer.name}
  teamShort={infoPlayer.teamShort}
  position={infoPlayer.position}
/>
<Modal
  transparent
  visible={quickOpen}
  animationType="fade"
  onRequestClose={() => setQuickOpen(false)}
>
  <TouchableWithoutFeedback
    onPress={() => {
      // Prevent “open tap” from immediately closing the modal
      if (Date.now() - quickJustOpenedRef.current < 250) return;
      setQuickOpen(false);
    }}
  >
    <View style={{ flex: 1 }}>
      <TouchableWithoutFeedback>
        <View
          style={{
            position: 'absolute',
            left: Math.max(12, quickAnchor.x),
            width: Math.min(
              Dimensions.get('window').width - 24,
              quickAnchor.w || (Dimensions.get('window').width - 24)
            ),
            top: Math.min(
              Dimensions.get('window').height - 160,
              (quickAnchor.y || 0) + (quickAnchor.h || 0) + 8
            ),
            backgroundColor: C.card,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: C.border,
            borderRadius: 14,
            paddingVertical: 10,
            paddingHorizontal: 10,
            shadowColor: '#000',
            shadowOpacity: 0.18,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 6 },
            elevation: 10,
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
            {[
              {
                key: 'share',
                icon: 'share-variant',
                label: t('rank.share'),
                onPress: () => { setQuickOpen(false); handleShare(); },
              },
              {
                key: 'out',
                icon: 'magnify-minus',
                label: t('rank.zoomMinus'),
                disabled: atMin,
                onPress: () => bumpScale(-STEP),
              },
              {
                key: 'in',
                icon: 'magnify-plus',
                label: t('rank.zoomPlus'),
                disabled: atMax,
                onPress: () => bumpScale(+STEP),
              },
              {
                key: 'trophies',
                icon: 'trophy-outline',
                label: t('rank.trophies'),
                onPress: () => { setQuickOpen(false); navigation.navigate('Trophies'); },
              },
            ].map((b) => (
              <TouchableOpacity
                key={b.key}
                onPress={b.onPress}
                disabled={!!b.disabled}
                style={{
                  flex: 1,
                  opacity: b.disabled ? 0.35 : 1,
                  backgroundColor: C.card2,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: C.border,
                  borderRadius: 12,
                  paddingVertical: 10,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialCommunityIcons name={b.icon} size={22} color={C.ink} />
                <Text style={{ color: C.ink, fontSize: 11, fontWeight: '800' }}>
                  {b.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </TouchableWithoutFeedback>
    </View>
  </TouchableWithoutFeedback>
</Modal>


<Modal
  animationType="fade"
  transparent
  visible={helpVisible}
  onRequestClose={() => setHelpVisible(false)}
>
  <TouchableWithoutFeedback onPress={() => setHelpVisible(false)}>
    <View style={styles.centeredView}>
      <TouchableWithoutFeedback>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalName}>What does this mean?</Text>
            <TouchableOpacity
              onPress={() => setHelpVisible(false)}
              style={styles.iconBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialCommunityIcons name="close" size={20} color={C.ink} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={{ maxHeight: '100%' }}
            contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 14, gap: 12 }}
            showsVerticalScrollIndicator={false}
          >
            <View style={{ gap: 10 }}>
              <Text style={{ color: C.ink, fontSize: 14, fontWeight: '800' }}>{t('rank.safetyHelpTitle')}</Text>
              <Text style={{ color: C.ink }}>
                {t('rank.safetyHelpBody')}
                
              </Text>

              <Text style={{ color: C.ink, fontSize: 14, fontWeight: '800', marginTop: 6 }}>{t('rank.preVsPost')}</Text>
              <Text style={{ color: C.ink }}>
                {t('rank.preHelpBody')}{'\n'}
                {t('rank.postHelpBody')}
              </Text>

              <Text style={{ color: C.ink, fontSize: 14, fontWeight: '800', marginTop: 6 }}>{t('rank.eoHelpTitle')}</Text>
              <Text style={{ color: C.ink }}>
                {t('rank.eoHelpBody')}
              </Text>

              <Text style={{ color: C.ink, fontSize: 14, fontWeight: '800', marginTop: 6 }}>{t('rank.playerDetailsHelpTitle')}</Text>
              <Text style={{ color: C.ink }}>
                {t('rank.playerDetailsHelpBody')}
              </Text>

              <Text style={{ color: C.ink, fontSize: 14, fontWeight: '800', marginTop: 6 }}>{t('rank.trophiesHelpTitle')}</Text>
              <Text style={{ color: C.ink }}>
                {t('rank.trophiesHelpBody')}
              </Text>

              <Text style={{ color: C.ink, fontSize: 14, fontWeight: '800', marginTop: 6 }}>{t('rank.moreInsightsTitle')}</Text>
<Text style={{ color: C.ink }}>
  {t('rank.moreInsightsBody')}{' '}
  <Text
    style={{ color: C.accent, textDecorationLine: 'underline', fontWeight: '800' }}
    accessibilityRole="link"
    onPress={() => {
      const url = `https://www.livefpl.net/${effectiveIdForLink || ''}`;
      try { Linking.openURL(url); } catch {}
    }}
  >
    {`livefpl.net/${effectiveIdForLink || ''}`}
  </Text>.
</Text>

            </View>
          </ScrollView>
        </View>
      </TouchableWithoutFeedback>
    </View>
  </TouchableWithoutFeedback>
</Modal>

          <Modal
  animationType="fade"
  transparent
  visible={modalVisible}
  onRequestClose={() => setModalVisible(false)}
>
  <TouchableWithoutFeedback onPress={() => setModalVisible(false)}>
    <View style={styles.centeredView}>
      <TouchableWithoutFeedback>
        <View style={styles.modalCard}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
              <Crest team={selectedPlayer?.team} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  style={styles.modalName}
                >
                  {selectedPlayerName}
                </Text>
                <Text numberOfLines={1} style={styles.modalSub}>
                  {(() => {
                    const posMap = { 1: t('rank.gk'), 2: t('rank.def'), 3: t('rank.mid'), 4: t('rank.fwd'), Bench: t('rank.bench') };
                    const pos = posMap[selectedPlayer?.position] || '—';
                    return `${pos}`;
                  })()}
                </Text>
              </View>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
  {!!selectedPlayer?.pid && (
    <TouchableOpacity
      onPress={() => {
        setModalVisible(false);
        navigation.navigate('Planner', { openCompareWithPid: selectedPlayer.pid });
      }}
      style={styles.ghostBtn}
      accessibilityRole="button"
      accessibilityLabel={t('rank.compareInPlanner')}
    >
      <MaterialCommunityIcons name="scale-balance" size={18} color={C.ink} />
      <Text style={styles.ghostBtnText}>{t('rank.compare')}</Text>
    </TouchableOpacity>
  )}
  <TouchableOpacity
    onPress={() => {
      setModalVisible(false);
      openPlayerInfo(selectedPlayer);
    }}
    style={[styles.ghostBtn, { marginLeft: 4 }]}
    hitSlop={{ top: 8, left: 8, right: 8, bottom: 8 }}
    accessibilityRole="button"
    accessibilityLabel={t('rank.openPlayerInfo')}
  >
    <MaterialCommunityIcons name="information-outline" size={18} color={C.ink} />
    <Text style={styles.ghostBtnText}>{t('playerInfo.info')}</Text>
  </TouchableOpacity>

  <TouchableOpacity
    onPress={() => setModalVisible(false)}
    style={styles.iconBtn}
    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    accessibilityRole="button"
    accessibilityLabel={t('rank.closePlayerStats')}
  >
    <MaterialCommunityIcons name="close" size={20} color={C.ink} />
  </TouchableOpacity>
</View>


          </View>

          {/* Content scroll */}
          <ScrollView
            style={{ maxHeight: '100%' }}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 14, gap: 14 }}
            showsVerticalScrollIndicator={false}
          >
          {/* Top insight row: Gain% and Emoji meaning */}
{selectedPlayer && (
  <View style={{ flexDirection:'row', alignItems:'center', gap:10, flexWrap:'wrap' }}>
    {/* Gain % = (our multiplier * 100) - local EO */}
    {(() => {
      const mulFromMap =
   exposureMap?.[selectedPlayer.pid] ??
   exposureMap?.[String(selectedPlayer.pid)] ??
   null;
 const mul = Number.isFinite(Number(mulFromMap))
   ? Number(mulFromMap)
   : deriveMul(selectedPlayer); // <- solid fallback
      const local = Number(selectedPlayer.EO_top10k || 0);         // %
      const gain = mul * 100 - local;                             // percentage points
      const tone = gain > 0 ? 'pos' : gain < 0 ? 'neg' : 'neutral';
      return (
        <Chip C={C} tone={tone}>
          <MaterialCommunityIcons name="trending-up" size={16} color={tone === 'neutral' ? C.ink : 'white'} />
          <Text style={{ fontWeight:'800', color: tone === 'neutral' ? C.ink : 'white', fontVariant:['tabular-nums'] }}>
            {gain > 0 ? '+' : ''}{gain.toFixed(1)}%
          </Text>
          <Text style={{ color: tone === 'neutral' ? C.muted : 'white', fontSize:12 }}>
            {t('playerInfo.gainPct')}
          </Text>
        </Chip>
      );
    })()}

    {/* Emoji meaning (if any) */}
    {selectedPlayer.Emoji ? (() => {
      const { label } = emojiInfo(selectedPlayer.emojiCode, t);
      return (
        <Chip C={C} tone="neutral">
          <Text style={{ fontSize:16 }}>{selectedPlayer.Emoji}</Text>
          <Text style={{ color: C.ink, fontWeight:'700' }}>{label}</Text>
        </Chip>
      );
    })() : null}
  </View>
)}

            {/* EO micro */}
            {selectedPlayer ? (
              <EOMicro
                top10k={selectedPlayer.EO_local}
                local={selectedPlayer.EO_top10k}
                C={C}
              />
            ) : null}

            {/* Stats list */}
            {renderStatsListCompact(selectedPlayerStats, C)}
          </ScrollView>
        </View>
      </TouchableWithoutFeedback>
    </View>
  </TouchableWithoutFeedback>
</Modal>



          <View style={styles.container}>
            <InfoBanner
              text={t('rank.fullExtendedInfoAt')}
              link={`www.livefpl.net/${effectiveIdForLink ? effectiveIdForLink : ''}`}
            />
            <View style={{ width: '100%', paddingHorizontal: 12, marginBottom: 6, position: 'relative' }}>

              <StatsStrip
                items={[
                  { title: t('rank.gwRankTitle', { gw: info.gw }), value: info.GWrank },
                  {
                    title: (
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontSize: 10, fontWeight: '700', color: C.muted, marginRight: 6 }}>
                          {t('rank.liveRank')}
                        </Text>
                        <SubsToggle
   value={displaySettings.includeSubs}
   onChange={setIncludeSubs}
 />
                      </View>
                    ),
                    value: displaySettings.includeSubs ? info.Ranksubs : info.Ranknosubs,
                    icon: assetImages[displaySettings.includeSubs ? info.arrowsubs : info.arrownosubs],
                    sub: t('rank.oldRankPct', { rank: (info.oldRank ?? 0).toLocaleString(), pct: displaySettings.includeSubs ? (info.diffPctSubsStr ?? '') : (info.diffPctNosubsStr ?? '') }),
                    flex: 1.3,
                  },
                  
 {
   title: (
     <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
       <Text style={{ fontSize: 10, fontWeight: '700', color: C.muted, marginRight: 6 }}>
         {t('rank.points')}
       </Text>
       <TouchableOpacity
         onPress={() => setHelpVisible(true)}
         hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
         accessibilityLabel={t('rank.openHelpPoints')}
       >
         <MaterialCommunityIcons name="help-circle-outline" size={16} color={C.ink} />
       </TouchableOpacity>
     </View>
  ),
   value: info.Points
  .replace(/\s*=\s*-?\d+\s*$/, '')           // drop "= 50"
  .replace(/\s*\(\s*[+-]?0\s*\)\s*$/, '')    // drop "(0)" / "(+0)" / "(-0)"
  .replace(/(\d)\s*\(\s*([+-]?\d+)\s*\)\s*$/, '$1 ($2)'), // normalize: "54(-4)" -> "54 (-4)"


   sub: t('rank.safetyDelta', { safety: info.Safety, delta: (info.Pointsfinal - info.Safety) > 0 ? '+' + (info.Pointsfinal - info.Safety) : (info.Pointsfinal - info.Safety) < 0 ? String(info.Pointsfinal - info.Safety) : '0' }),
 },

                ]}
              />

              <View style={{ width: '100%', paddingHorizontal: 12, marginTop: 6 }}>
  
</View>

             
            </View>
            

            { info.manager ? (
              <View style={{ width: '100%', paddingHorizontal: 12, marginBottom: 2 }}>
                <View style={styles.managerRow}>
<PitchFeedToggle value={rankTab} onChange={(v) => { setQuickOpen(false); setQuickBarOpen(false);setRankTab(v); }} />
                  
                  {displaySettings.showManagerName && (
  <>
  
    <View style={{ maxWidth: '30%' /* or 160 */, minWidth: 0,flexShrink: 1, }}>
  <Text
    style={styles.managerNameStrong}
    numberOfLines={1}
    ellipsizeMode="tail"
  >
    {displayManagerName}
  </Text>
</View>

    {/* Edit name (uses themed input in a modal) */}
    <TouchableOpacity
      onPress={() => { setEditNameText(displayManagerName || ''); setEditNameVisible(true); }}
      style={styles.shareTiny}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      accessibilityLabel={t('rank.editManagerName')}
    >
      <MaterialCommunityIcons name="pencil" size={18} color={C.ink} />
    </TouchableOpacity>
  </>
)}

                 
      {/* Settings cog moved here */}
<TouchableOpacity
  onPress={() => setsettingsModalVisible(true)}
  style={styles.shareTiny}
  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
  accessibilityLabel={t('rank.openSettings')}
>
  <MaterialCommunityIcons name="cog" size={18} color={C.ink} />
</TouchableOpacity>
<TouchableOpacity
  onPress={handleRefresh}
  disabled={refreshing || loading}
  style={[styles.shareTiny, (refreshing || loading) && { opacity: 0.35 }]}
  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
  accessibilityLabel={t('rank.refreshRankData')}
>
  <MaterialCommunityIcons name="refresh" size={18} color={C.ink} />
</TouchableOpacity>

 <TouchableOpacity
  onPress={() => setQuickBarOpen((v) => !v)}
  style={styles.shareTiny}
  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
  accessibilityLabel={t('rank.openQuickActions')}
>
  <MaterialCommunityIcons name={quickBarOpen ? 'minus' : 'plus'} size={18} color={C.ink} />
</TouchableOpacity>

                </View>
                {quickBarOpen ? <QuickActionsBar /> : null}

              </View>
            ) : null}
{rankTab === 'feed' ? (
  <View style={{ height: pitchHeight, width: '100%' }}>
    <EventFeed
      gw={Number(info?.gw ?? 0)}
      effectiveId={viewFplId ?? fplId}
      onePt={onePt}
      height={pitchHeight}
      impactThreshold={0.01}
    />
  </View>
) : rankTab === 'history' ? (
  <ScrollView
    style={{ width: '100%' }}
    contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 18 }}
    refreshControl={
      <RefreshControl
        refreshing={historyLoading}
        onRefresh={() => loadHistory(viewFplId ?? fplId)}
        tintColor={C.ink}
      />
    }
  >
    {historyErr ? (
      <View
        style={{
          backgroundColor: C.card,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: C.border,
          borderRadius: 12,
          padding: 12,
          marginBottom: 10,
        }}
      >
        <Text style={{ color: C.bad || '#ef4444', fontWeight: '900' }}>Couldn’t load history</Text>
        <Text style={{ color: C.muted, marginTop: 6 }}>{historyErr}</Text>
      </View>
    ) : null}

    {historyLoading && !historyData ? (
      <View style={{ paddingVertical: 22, alignItems: 'center' }}>
        <ActivityIndicator />
        <Text style={{ color: C.muted, marginTop: 8 }}>Loading history…</Text>
      </View>
    ) : null}

    {!!historyData?.current?.length ? (
      <>
        <HistoryChart rows={historyData.current} chips={historyData.chips} width={winW - 24} height={190} />
<HistoryTable rows={historyData.current} chips={historyData.chips} />

      </>
    ) : !historyLoading ? (
      <View
        style={{
          backgroundColor: C.card,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: C.border,
          borderRadius: 12,
          padding: 14,
        }}
      >
        <Text style={{ color: C.muted, textAlign: 'center' }}>No history data.</Text>
      </View>
    ) : null}
  </ScrollView>
) : (
  

            <ImageBackground
              source={assetImages.pitch}
              style={[styles.pitchBg, isDark && { opacity: 1 }]}
              imageStyle={{ resizeMode: 'cover' }}  // optional: ensures full cover
            >

               

              <View style={styles.switch}>
                
<View style={{ width: imgwidth /* 👈 exact same width for both rows */ }}>
  <TouchableOpacity
    onPress={() => navigation.navigate('Trophies')}
    activeOpacity={0.85}
    style={[styles.trophyPill, { borderColor: C.border, backgroundColor: C.card2, display:'none'}]}
    accessibilityRole="button"
    accessibilityLabel={t('rank.openTrophies')}
  >
    <MaterialCommunityIcons name="trophy-outline" size={16} color={C.ink} />
    <Text style={{ fontSize: 8, fontWeight: '600', color: C.ink }}>
      {achCounts ? `${achCounts.earned}/${achCounts.total}` : t('rank.trophies')}
    </Text>
  </TouchableOpacity>



  {displaySettings.showEOs && (
    <View style={styles.eoLegendBlock}>
      <View
        style={[
          styles.EOs,
          styles.EOsRow,
          styles.bottomRounded,
          { borderRadius: 6, overflow: 'hidden', width: '100%' }, // 👈 force same width
        ]}
      >
        <Text numberOfLines={1} allowFontScaling={false} style={[styles.EO1, styles.eoLegendCell]}>
          {t('rank.top10k')}
        </Text>
        <Text numberOfLines={1} allowFontScaling={false} style={[styles.EO2, styles.eoLegendCell]}>
          {t('rank.nearYou')}
        </Text>
      </View>
    </View>
  )}
</View>


                <SettingsModal
                  visible={settingsmodalVisible}
                  onClose={() => setsettingsModalVisible(false)}
                  displaySettings={displaySettings}
                  setDisplaySettings={setDisplaySettings}
                    notifPrefs={notifPrefs}
                  setNotifPrefs={setNotifPrefs}

                />
              </View>

              <View style={styles.scoresheet}>
                <Text style={[styles.scoresheetMain, { color: C.ink }]}>{info.Points}</Text>
                <Text style={[styles.scoresheetSub, { color: C.ink }]}>
                  {displaySettings.includeSubs ? (
                    <>
                      {info.Ranksubs?.toLocaleString?.()}{' '}
                      <Image source={assetImages[info.arrowsubs]} style={styles.arrow} />
                    </>
                  ) : (
                    <>
                      {info.Ranknosubs?.toLocaleString?.()}{' '}
                      <Image source={assetImages[info.arrownosubs]} style={styles.arrow} />
                    </>
                  )}
                </Text>
              </View>
<View style={{ transform:[{ scale: pitchScale }], alignItems:'center', width:'100%' }}>
              {items.map((item, rowIdx) => {
                const containerStyle =
                  rowIdx === 0 && items[4].length === 0 ? styles.firstLineupContainer : styles.lineupContainer;

                return (
                  <View key={`row-${rowIdx}`} style={containerStyle}>
                    {item.map((player) => {
                      const counts = getEventCounts(player);

                      return (
                        <View style={styles.positionContainer} key={player.key}>
                          <View style={styles.playerContainer}>
                            <TouchableOpacity onPress={() => handlePressPlayer(player)}>
                              <Image source={{ uri: player.imageUri }} style={styles.playerImage} />
                            </TouchableOpacity>

                            <Text style={styles.emoji}>{player.Emoji}</Text>

                            {!!player.Cap && (
  <View style={{ position: 'absolute', top: CAP_TOP, right: -6 * rem }}>
    <LetterCircle label={player.Cap} size={14 * rem} bg="black" fg="white" />
  </View>
)}




                            {/* Player name with top-rounded corners */}
                            <Text
                              numberOfLines={1}
                              ellipsizeMode="tail"
                              allowFontScaling={false}
                              style={[styles.playerName, styles.topRounded]}
                            >
                              {player.name}
                            </Text>

                            {/* Points (rounded bottom if EOs hidden) */}
                            

                            <TouchableOpacity
  activeOpacity={0.7}
  onPress={() => handlePressPlayer(player)}
>
  <Text
    numberOfLines={1}
    ellipsizeMode="tail"
    allowFontScaling={false}
    style={[styles[player.Status], !displaySettings.showEOs && styles.bottomRounded]}
  >
    {player.Points}
  </Text>
</TouchableOpacity>

{displaySettings.showEOs && (
  <TouchableOpacity
    activeOpacity={0.7}
    onPress={() => handlePressPlayer(player)}
  >
    <View style={[styles.EOs, styles.EOsRow, styles.bottomRounded]}>
      <Text numberOfLines={1} ellipsizeMode="tail" allowFontScaling={false} style={styles.EO1}>
        {player.EO}%
      </Text>
      <Text numberOfLines={1} ellipsizeMode="tail" allowFontScaling={false} style={styles.EO2}>
        {player.EO2}%
      </Text>
    </View>
  </TouchableOpacity>
)}


                            {/* Events chip (icons) */}
                            <View style={styles.eventsSlot}>{displaySettings.showEvents && <EventsRow counts={counts} isLive={player.Status === 'live'}/>}</View>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                );
              })}
              </View>
            </ImageBackground>
            )}

            {/* --------- HIDDEN OFF-SCREEN CLONE (for capture) ---------- */}
            <View ref={shareTargetRef} style={styles.hiddenClone} collapsable={false} pointerEvents="none">
              <View style={{ width: '100%', paddingHorizontal: 12, marginBottom: 6 }}>
                <StatsStrip
                  items={[
                    { title: t('rank.gwRankTitle', { gw: info.gw }), value: info.GWrank },
                    {
                      title: t('rank.liveRank'),
                      value: displaySettings.includeSubs ? info.Ranksubs : info.Ranknosubs,
                      icon: assetImages[displaySettings.includeSubs ? info.arrowsubs : info.arrownosubs],
                      sub: t('rank.oldRankPct', { rank: (info.oldRank ?? 0).toLocaleString(), pct: displaySettings.includeSubs ? (info.diffPctSubsStr ?? '') : (info.diffPctNosubsStr ?? '') }),
                      flex: 1.3,
                    },
                    { title: t('rank.points'), value: info.Points, sub: t('rank.safetyDelta', { safety: info.Safety, delta: (info.Pointsfinal - info.Safety) > 0 ? '+' + (info.Pointsfinal - info.Safety) : (info.Pointsfinal - info.Safety) < 0 ? String(info.Pointsfinal - info.Safety) : '0' }) },
                  ]}
                />
              </View>

              {displaySettings.showManagerName && info.manager ? (
                <View style={{ width: '100%', paddingHorizontal: 12, marginBottom: 2 }}>
                  <View style={styles.managerRow}>
                    <MaterialCommunityIcons name="account-circle-outline" size={18} color={C.muted} />
                    <Text style={styles.managerLabel}>{t('rank.manager')}</Text>
                    <Text style={styles.managerNameStrong} numberOfLines={1}>{displayManagerName}</Text>

                    {/* (No share icon here, so it won't appear in the image) */}
                    

                  </View>

                </View>
              ) : null}

              <ImageBackground
                source={assetImages.pitch}
                style={[styles.pitchBg]}
                imageStyle={{ resizeMode: 'cover' }}
              >
                <View style={styles.scoresheet}>
                  <Text style={[styles.scoresheetMain, { color: C.ink }]}>{info.Points}</Text>
                  <Text style={[styles.scoresheetSub, { color: C.ink }]}>
                    {displaySettings.includeSubs ? (
                      <>
                        {info.Ranksubs?.toLocaleString?.()}{' '}
                        <Image source={assetImages[info.arrowsubs]} style={styles.arrow} />
                      </>
                    ) : (
                      <>
                        {info.Ranknosubs?.toLocaleString?.()}{' '}
                        <Image source={assetImages[info.arrownosubs]} style={styles.arrow} />
                      </>
                    )}
                  </Text>
                </View>

                {items.map((item, rowIdx) => {
                  const containerStyle =
                    rowIdx === 0 && items[4].length === 0 ? styles.firstLineupContainer : styles.lineupContainer;

                  return (
                    <View key={`rowc-${rowIdx}`} style={containerStyle}>
                      {item.map((player) => {
                        const counts = getEventCounts(player);

                        return (
                          <View style={styles.positionContainer} key={`c-${player.key}`}>
                            <View style={styles.playerContainer}>
                              <Image source={{ uri: player.imageUri }} style={styles.playerImage} />
                              <Text style={styles.emoji}>{player.Emoji}</Text>
                              {!!player.Cap && (
                                <View style={styles.cap}>
                                  <Text style={styles.capText}>{player.Cap}</Text>
                                </View>
                              )}
                              <Text
                                numberOfLines={1}
                                ellipsizeMode="tail"
                                allowFontScaling={false}
                                style={[styles.playerName, styles.topRounded]}
                              >
                                {player.name}
                              </Text>
                              <Text
                                numberOfLines={1}
                                ellipsizeMode="tail"
                                allowFontScaling={false}
                                style={[styles[player.Status], !displaySettings.showEOs && styles.bottomRounded]}
                              >
                                {player.Points}
                              </Text>
                              {displaySettings.showEOs && (
                                <View style={[styles.EOs, styles.EOsRow, styles.bottomRounded]}>
                                  <Text numberOfLines={1} ellipsizeMode="tail" allowFontScaling={false} style={styles.EO1}>
                                    {player.EO}%
                                  </Text>
                                  <Text numberOfLines={1} ellipsizeMode="tail" allowFontScaling={false} style={styles.EO2}>
                                    {player.EO2}%
                                  </Text>
                                </View>
                              )}
                              <View style={styles.eventsSlot}>
                                {displaySettings.showEvents && <EventsRow counts={counts} isLive={player.Status === 'live'} />}
                              </View>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  );
                })}
              </ImageBackground>
            </View>
            {/* --------- END HIDDEN CLONE ---------- */}
          </View>
        </View>

        {loading && !refreshing && (
          <View style={styles.loadingOverlay}>
            <View style={styles.loadingCard}>
              <ActivityIndicator size="large" />
              <Text style={[styles.loadingText, { color: C.ink }]}>Loading latest data…</Text>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

export default FootballLineupWithImages;