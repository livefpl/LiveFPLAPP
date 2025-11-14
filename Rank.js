// rank.js — clean (no metrics/interstitials)
import InfoBanner from './InfoBanner';
import AppHeader from './AppHeader';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Sharing from 'expo-sharing';
import PlayerInfoModal from './PlayerInfoModal';

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


import Svg, { Circle, Text as SvgText } from 'react-native-svg';

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

const Crest = ({ team, size = 28 }) => (
  <Image source={{ uri: clubCrestUri(team || 1) }} style={{ width: size, height: size, borderRadius: size/2 }} />
);

const EOMicro = ({ top10k = 0, local = 0, C }) => {
  // raw values (unclamped) for display; clamped only for the bar width
  const norm = (v) => {
    const raw = Number(v ?? 0);
    const bar = Math.max(0, Math.min(100, raw));      // for width only
    const txt = Number.isFinite(raw) ? raw : 0;        // for label
    return { bar, txt };
  };

  const t = norm(top10k);
  const l = norm(local);

  const rows = [
    { label: 'Top10k', val: t },
    { label: 'Near You', val: l },
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

// Map backend emoji codes to a friendly label
const EMOJI_LABELS = {
  d:  'Differential',
  t:  'Template Pick',
  s:  'Spy',
  ds: 'Differential',
  f:  'In form',
  sub:'Autosubbed',
  '': '',
};

// Given a code like 'ds' and the rendered icon, return label (fallback to code)
const emojiInfo = (code = '') => {
  const label = EMOJI_LABELS[String(code).toLowerCase()] || String(code).toUpperCase();
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
  };
  (pl.stats || []).forEach(([raw, c]) => {
    const key = String(raw).toLowerCase();
    if (key in counts) counts[key] += Number(c) || 0;
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
  const [adHeight, setAdHeight] = useState(0); // 0 when no ad/failed/hidden
// help modal for "Points" tile
const [helpVisible, setHelpVisible] = useState(false);

 // near other refs
const hydratedRef = useRef(false); // becomes true once we've loaded from AsyncStorage (or decided there's nothing to load)

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

  // Map your numeric positions to short labels (same logic you use in the header)
  const posMap = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD', Bench: 'Bench' };
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
        accessibilityLabel="Show pre-subs rank"
      >
        <Text style={{ fontSize: 10, fontWeight: '700', color: !value ? 'white' : C.muted }}>
          Pre
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
        accessibilityLabel="Show post-subs rank"
      >
        <Text style={{ fontSize: 10, fontWeight: '700', color: value ? 'white' : C.muted }}>
          Post
        </Text>
      </TouchableOpacity>
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
    const t = Number(top10k) || 0;
    const l = Number(local) || 0;
    return (
      <View style={styles.eoSection}>
        <View style={styles.eoLabelRow}>
          <Text style={styles.eoLabel}>Top10k EO</Text>
          <Text style={styles.eoValue}>{l.toFixed(2)}%</Text>
        </View>
        <View style={styles.eoLabelRow}>
          <Text style={styles.eoLabel}>Local EO   </Text>
          <Text style={styles.eoValue}>{t.toFixed(2)}%</Text>
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
    (isLive ? counts.minutes : 0);

    if (!sum) return null;

    return (
      <View style={styles.eventsChip}>
        <View style={styles.eventsIconsRow}>
        {isLive && (
  <>
    <View style={[styles.statusPill, styles.statusLive]}>
      <Text style={styles.statusPillText}>{counts.minutes}'</Text>
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
          <Text style={[styles.headerText, { color: C.ink, flex: 3, textAlign: 'left' }]}>Event</Text>
          <Text style={[styles.headerText, { color: C.ink, flex: 1, textAlign: 'center' }]}>Count</Text>
          <Text style={[styles.headerText, { color: C.ink, flex: 1, textAlign: 'center' }]}>Points</Text>
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
          payload = parsed.data;                       // fresh by gen
        } else if (!Number.isFinite(remoteGen) && (now - cachedTs < CACHE_TTL_MS)) {
          payload = parsed.data;                       // CDN down → honor short TTL
        }
      }
    }
  } catch { /* ignore cache read errors */ }


      if (!payload) {
        const resp = await smartFetch(
          `https://livefpl-api-489391001748.europe-west4.run.app/LH_api/${effectiveId}`,
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
const subText = `Safety: ${safetyVal}  Δ:${fmtDelta(difference)}`;


      const safeDiv = (n, d) => (d ? (n * 100) / d : 0);
      const diffrank = -(displayRank ?? 0) + (payload?.old_rank ?? 0);
      const diffpercent = safeDiv(diffrank, payload?.old_rank ?? 0).toFixed(2);
      const diffpercentText = `Old: ${(payload?.old_rank ?? 0).toLocaleString()} (${Number(diffpercent) > 0 ? '+' : ''}${diffpercent}%)`;

      const diffranksubs = -(payload?.post_rank ?? 0) + (payload?.old_rank ?? 0);
      const diffpercentsubs = safeDiv(diffranksubs, payload?.old_rank ?? 0).toFixed(2);
      const diffpercentsubsText = `Old: ${(payload?.old_rank ?? 0).toLocaleString()} (${Number(diffpercentsubs) > 0 ? '+' : ''}${diffpercentsubs}%)`;

      const diffranknosubs = -(payload?.pre_rank ?? 0) + (payload?.old_rank ?? 0);
      const diffpercentnosubs = safeDiv(diffranknosubs, payload?.old_rank ?? 0).toFixed(2);
      const diffpercentnosubsText = `Old: ${(payload?.old_rank ?? 0).toLocaleString()} (${Number(diffpercentnosubs) > 0 ? '+' : ''}${diffpercentnosubs}%)`;

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
      <AppHeader title="Rank" />

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
                  accessibilityLabel="Close rename"
                >
                  <MaterialCommunityIcons name="close" size={20} color={C.ink} />
                </TouchableOpacity>

                <Text style={[styles.modalTitle, { color: C.ink }]}>Edit manager name</Text>

                <ThemedTextInput
                  value={editNameText}
                  onChangeText={setEditNameText}
                  placeholder="Manager name"
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
              <Text style={{ color: C.ink, fontSize: 14, fontWeight: '800' }}>Safety</Text>
              <Text style={{ color: C.ink }}>
                <Text style={{ fontWeight: '700' }}>Safety</Text> is the points needed to get a green arrow at your rank.
                
              </Text>

              <Text style={{ color: C.ink, fontSize: 14, fontWeight: '800', marginTop: 6 }}>Pre vs Post</Text>
              <Text style={{ color: C.ink }}>
                <Text style={{ fontWeight: '700' }}>Pre</Text> shows your live rank <Text style={{ fontWeight:'700' }}>excluding</Text> autosubs.{"\n"}
                <Text style={{ fontWeight: '700' }}>Post</Text> shows your live rank <Text style={{ fontWeight:'700' }}>including</Text> autosubs.
              </Text>

              <Text style={{ color: C.ink, fontSize: 14, fontWeight: '800', marginTop: 6 }}>EO (Effective Ownership)</Text>
              <Text style={{ color: C.ink }}>
                EO is the percentage of managers (in a group like Top10k or Near You) who effectively own the player, accounting for captaincy and triple captaincy. Higher EO means less potential gain from that player’s points.
              </Text>

              <Text style={{ color: C.ink, fontSize: 14, fontWeight: '800', marginTop: 6 }}>Player details</Text>
              <Text style={{ color: C.ink }}>
                Tap a player to see their points breakdown and how much they impacted your rank. From there, use{" "}
                <Text style={{ fontWeight:'700' }}>Compare</Text> to open their season stats.
              </Text>

              <Text style={{ color: C.ink, fontSize: 14, fontWeight: '800', marginTop: 6 }}>Trophies</Text>
              <Text style={{ color: C.ink }}>
                Tap the trophy to see how many achievements you unlocked this gameweek.
              </Text>

              <Text style={{ color: C.ink, fontSize: 14, fontWeight: '800', marginTop: 6 }}>More insights</Text>
<Text style={{ color: C.ink }}>
  Full details—per-player rank change, your template vs differential spread, team ratings, and clone counts—are available at{' '}
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
                    const posMap = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD', Bench: 'Bench' };
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
      accessibilityLabel="Compare this player in Planner"
    >
      <MaterialCommunityIcons name="scale-balance" size={18} color={C.ink} />
      <Text style={styles.ghostBtnText}>Compare</Text>
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
    accessibilityLabel="Open player info"
  >
    <MaterialCommunityIcons name="information-outline" size={18} color={C.ink} />
    <Text style={styles.ghostBtnText}>Info</Text>
  </TouchableOpacity>

  <TouchableOpacity
    onPress={() => setModalVisible(false)}
    style={styles.iconBtn}
    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    accessibilityRole="button"
    accessibilityLabel="Close player stats"
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
            Gain %
          </Text>
        </Chip>
      );
    })()}

    {/* Emoji meaning (if any) */}
    {selectedPlayer.Emoji ? (() => {
      const { label } = emojiInfo(selectedPlayer.emojiCode);
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
              text="Full extended info available at"
              link={`www.livefpl.net/${effectiveIdForLink ? effectiveIdForLink : ''}`}
            />
            <View style={{ width: '100%', paddingHorizontal: 12, marginBottom: 6, position: 'relative' }}>

              <StatsStrip
                items={[
                  { title: `GW${info.gw} Rank`, value: info.GWrank },
                  {
                    title: (
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontSize: 10, fontWeight: '700', color: C.muted, marginRight: 6 }}>
                          Live Rank
                        </Text>
                        <SubsToggle
   value={displaySettings.includeSubs}
   onChange={setIncludeSubs}
 />
                      </View>
                    ),
                    value: displaySettings.includeSubs ? info.Ranksubs : info.Ranknosubs,
                    icon: assetImages[displaySettings.includeSubs ? info.arrowsubs : info.arrownosubs],
                    sub: displaySettings.includeSubs ? info.diffpercentsubs : info.diffpercentnosubs,
                    flex: 1.3,
                  },
                  
 {
   title: (
     <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
       <Text style={{ fontSize: 10, fontWeight: '700', color: C.muted, marginRight: 6 }}>
         Points
       </Text>
       <TouchableOpacity
         onPress={() => setHelpVisible(true)}
         hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
         accessibilityLabel="Open help about points and safety"
       >
         <MaterialCommunityIcons name="help-circle-outline" size={16} color={C.ink} />
       </TouchableOpacity>
     </View>
  ),
   value: info.Points
  .replace(/\s*=\s*-?\d+\s*$/, '')           // drop "= 50"
  .replace(/\s*\(\s*[+-]?0\s*\)\s*$/, '')    // drop "(0)" / "(+0)" / "(-0)"
  .replace(/(\d)\s*\(\s*([+-]?\d+)\s*\)\s*$/, '$1 ($2)'), // normalize: "54(-4)" -> "54 (-4)"


   sub: info.subsafety,
 },

                ]}
              />

              <View style={{ width: '100%', paddingHorizontal: 12, marginTop: 6 }}>
  
</View>

             
            </View>
            

            { info.manager ? (
              <View style={{ width: '100%', paddingHorizontal: 12, marginBottom: 2 }}>
                <View style={styles.managerRow}>
                  
                  {displaySettings.showManagerName && (
  <>
  <MaterialCommunityIcons name="account-circle-outline" size={18} color={C.muted} />
    <Text style={styles.managerLabel}>Manager</Text>
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
      accessibilityLabel="Edit manager name"
    >
      <MaterialCommunityIcons name="pencil" size={18} color={C.ink} />
    </TouchableOpacity>
  </>
)}

                  {/* Tiny share button next to manager name (visible UI; not captured) */}
                  <TouchableOpacity onPress={handleShare} style={styles.shareTiny} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                    <MaterialCommunityIcons name="share-variant" size={18} color={C.ink} />
                  </TouchableOpacity>
                  <TouchableOpacity
   onPress={() => bumpScale(-STEP)}
   disabled={atMin}
   style={[styles.shareTiny, atMin && { opacity: 0.4 }]}
 >
        <MaterialCommunityIcons name="magnify-minus" size={20} color={C.ink} />
      </TouchableOpacity>
      <TouchableOpacity
   onPress={() => bumpScale(+STEP)}
   disabled={atMax}
   style={[styles.shareTiny, atMax && { opacity: 0.4 }]}
 >
        <MaterialCommunityIcons name="magnify-plus" size={20} color={C.ink} />
      </TouchableOpacity>
      <TouchableOpacity
  onPress={() => navigation.navigate('Trophies')}
  style={styles.shareTiny}
  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
  accessibilityLabel="Open trophies"
>
  <MaterialCommunityIcons name="trophy-outline" size={18} color={C.ink} />
</TouchableOpacity>

      {/* Settings cog moved here */}
<TouchableOpacity
  onPress={() => setsettingsModalVisible(true)}
  style={styles.shareTiny}
  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
  accessibilityLabel="Open settings"
>
  <MaterialCommunityIcons name="cog" size={18} color={C.ink} />
</TouchableOpacity>
                </View>
              </View>
            ) : null}

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
    accessibilityLabel="Open Trophies"
  >
    <MaterialCommunityIcons name="trophy-outline" size={16} color={C.ink} />
    <Text style={{ fontSize: 8, fontWeight: '600', color: C.ink }}>
      {achCounts ? `${achCounts.earned}/${achCounts.total}` : 'Trophies'}
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
          Top10k
        </Text>
        <Text numberOfLines={1} allowFontScaling={false} style={[styles.EO2, styles.eoLegendCell]}>
          Near U
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

            {/* --------- HIDDEN OFF-SCREEN CLONE (for capture) ---------- */}
            <View ref={shareTargetRef} style={styles.hiddenClone} collapsable={false} pointerEvents="none">
              <View style={{ width: '100%', paddingHorizontal: 12, marginBottom: 6 }}>
                <StatsStrip
                  items={[
                    { title: `GW${info.gw} Rank`, value: info.GWrank },
                    {
                      title: 'Live Rank',
                      value: displaySettings.includeSubs ? info.Ranksubs : info.Ranknosubs,
                      icon: assetImages[displaySettings.includeSubs ? info.arrowsubs : info.arrownosubs],
                      sub: displaySettings.includeSubs ? info.diffpercentsubs : info.diffpercentnosubs,
                      flex: 1.3,
                    },
                    { title: 'Points', value: info.Points, sub: info.subsafety },
                  ]}
                />
              </View>

              {displaySettings.showManagerName && info.manager ? (
                <View style={{ width: '100%', paddingHorizontal: 12, marginBottom: 2 }}>
                  <View style={styles.managerRow}>
                    <MaterialCommunityIcons name="account-circle-outline" size={18} color={C.muted} />
                    <Text style={styles.managerLabel}>Manager</Text>
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
