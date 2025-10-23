// Achievements.js — Trophy Room (Light Blue theme) + modal + base-points fixes
import { useNavigation } from '@react-navigation/native';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Animated,
  Easing,
  Dimensions,
  Modal, // ← modal
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AppHeader from './AppHeader';
import { useColors } from './theme';


// ----------------------------- helpers -----------------------------
const isValidFplId = (v) => /^\d{2,10}$/.test(String(v || '').trim());
const pickPayload = (json, id) => {
  if (!json) return null;
  if (json[id]) return json[id];
  if (json[String(id)]) return json[String(id)];
  const keys = Object.keys(json);
  if (keys.length === 1 && typeof json[keys[0]] === 'object') return json[keys[0]];
  return json;
};
const sum = (arr) => arr.reduce((a, b) => a + b, 0);
const toInt = (v) => Number(v) || 0;
const statsMap = (statsArr = []) => {
  const m = {};
  for (const [k, times, pts] of statsArr) {
    const key = String(k || '').toLowerCase();
    if (!m[key]) m[key] = { times: 0, pts: 0 };
    m[key].times += Number(times) || 0;
    m[key].pts += Number(pts) || 0;
  }
  return m;
};
// Base points (pre-multiplier) for a player: sum of points from their stats rows
const basePointsFromStats = (p) => sum((p?.stats || []).map((x) => Number(x?.[2]) || 0));
const minutesFromStats = (p) => (statsMap(p?.stats)?.minutes?.times ?? 0);
const top10kEOFrac = (p) => Number(p?.EO1 ?? 0);
const sliceTeam = (payload) => {
  const team = Array.isArray(payload?.team) ? payload.team : [];
  const starters = team.filter((p) => ['s', 'c', 'v'].includes(String(p?.role)));
  const bench = team.filter((p) => String(p?.role) === 'b');
  const cap = team.find((p) => String(p?.role) === 'c' || String(p?.role) === 'tc') || null;
  const gks = team.filter((p) => Number(p?.position) === 1);
  const defs = team.filter((p) => Number(p?.position) === 2);
  const mids = team.filter((p) => Number(p?.position) === 3);
  const fwds = team.filter((p) => Number(p?.position) === 4);
  return { starters, bench, cap, gks, defs, mids, fwds, team };
};
const nice = (n) => (Number(n) || 0).toLocaleString();
const isUnsettled = (p) => {
  const s = String(p?.status || '').toLowerCase();
  return s === 'y' || s === 'l' || (minutesFromStats(p) === 0 && s !== 'm');
};

// ----------------------------- icon mapping -----------------------------
const iconFor = (id) => {
  switch (id) {
    case 1: return 'crown';
    case 2: return 'sword-cross';
    case 3: return 'trending-up';
    case 5: return 'run';
    case 7: return 'arrow-up-bold';
    case 10: return 'shield-check';
    case 12: return 'alien-outline';
    case 114: return 'handshake';
    case 16: return 'soccer';
    case 17: return 'hand-back-right';
    case 19: return 'shield-off-outline';
    case 20: return 'whistle';
    case 21: return 'target';
    case 24: return 'shield';
    case 25: return 'cards-outline';
    case 26: return 'alert-octagon-outline';
    case 27: return 'emoticon-neutral-outline';
    case 31: return 'star-outline';
    case 34: return 'backup-restore';
    case 36: return 'shield-key-outline';
    case 37: return 'medal-outline';
    case 39: return 'emoticon-cry-outline';
    case 41: return 'wall';
    case 49: return 'magnet';
    case 50: return 'broom';
    case 54: return 'party-popper';
    case 55: return 'swap-horizontal-circle-outline';
    case 56: return 'bullseye-arrow';
    case 58: return 'account-multiple-plus-outline';
    case 60: return 'shield-check-outline';
    case 61: return 'target-variant';
    case 62: return 'target-account';
    case 201: return 'numeric-2-box-multiple-outline';
    case 202: return 'palette-swatch-outline';
    case 203: return 'shield-home-outline';
    case 204: return 'sword';
    case 205: return 'cards-playing-outline';
    case 206: return 'check-decagram-outline';
    case 207: return 'account-group-outline';
    // Oopsies
    case 1002: return 'shield-alert-outline';
    case 1003: return 'shield-alert';
    case 1005: return 'cards';
    case 1006: return 'close-octagon-outline';
    case 1007: return 'block-helper';
    case 1011: return 'treasure-chest';
    case 1012: return 'treasure-chest-outline';
    case 1015: return 'ghost';
    case 1018: return 'water-off-outline';
    case 1031: return 'numeric-3-box-multiple-outline';
    case 1033: return 'emoticon-confused-outline';
    case 1034: return 'food-off-outline';
    case 1037: return 'ban';
    case 1056: return 'shield-off';
    case 1057: return 'emoticon-sad-outline';
    default: return 'trophy-outline';
  }
};

// ----------------------------- Light Blue theme -----------------------------
const luminanceIsDark = (hex) => {
  const h = String(hex || '').replace('#', '');
  if (h.length < 6) return true;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L < 0.5;
};
// -------- theme-driven palette (no blue fallback) --------
const hexToRgb = (hex, fallback = '#000000') => {
  const pick = (h) => {
    const s = String(h || '').trim();
    if (s.startsWith('#') && s.length === 7) return s.slice(1);
    return null;
  };
  const h = pick(hex) || pick(fallback);
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return { r, g, b };
};
const rgba = (hex, a = 0.1, fallback = '#000000') => {
  const { r, g, b } = hexToRgb(hex, fallback);
  return `rgba(${r},${g},${b},${a})`;
};

const makePlatinum = (C) => {
  // Neutral ink-driven accents to avoid “blue everywhere”
  const INK = C?.ink || '#111111';
  const SUCCESS = C?.success || '#22C55E';

  return {
    // Keep legacy keys but point them to neutral ink so text/icons are calm
    silverDeep: INK,
    silver:     INK,
    silverSoft: rgba(INK, 0.06, INK),
    glow:       rgba(INK, 0.08, INK),
    chip:       rgba(INK, 0.05, INK),

    // Subtle “yay” palette (used only for tiny accents on unlocked)
    successDeep: SUCCESS,
    successSoft: rgba(SUCCESS, 0.10, INK),
    successGlow: rgba(SUCCESS, 0.16, INK),

    // Surfaces & text from theme
    card:   C.card,
    border: C.border,
    muted:  C.muted,
    ink:    C.ink,
    bg:     C.bg,
  };
};




// ----------------------------- badge UI -----------------------------
const TrophyBadge = ({ id, unlocked, title, desc, progress, colors, pending, who = [], onPress }) => {
  const T = makePlatinum(colors);
  const iconName = iconFor(id);

  const isCelebratory = unlocked && !pending;
  const rowOpacity = isCelebratory ? 1 : 0.5;


  // Neutral surface always; success shows as a slim left stripe + subtle icon chip
  const bg        = T.card;
  const border    = T.border;
  const iconColor = isCelebratory ? T.successDeep : T.ink;
  const iconBg    = isCelebratory ? T.successSoft : T.chip;

  return (
    <TouchableOpacity activeOpacity={0.8} onPress={onPress}>
      <View
        style={[
          styles.badgeRow,
          {
            backgroundColor: bg,
            borderColor: border,
            shadowColor: '#000',
            shadowOpacity: 0.08,
            shadowRadius: 3,
            shadowOffset: { width: 0, height: 2 },
            elevation: 1,
            overflow: 'hidden',
            opacity: rowOpacity,   
          },
        ]}
      >
        {/* subtle success stripe */}
        {isCelebratory ? (
          <View
            style={{
              position: 'absolute',
              left: 0, top: 0, bottom: 0,
              width: 3,
              backgroundColor: T.successDeep,
              opacity: 0.9,
              borderTopLeftRadius: 12,
              borderBottomLeftRadius: 12,
            }}
          />
        ) : null}

        <View style={[styles.badgeIconWrap, { backgroundColor: iconBg, borderColor: border }]}>
          <MaterialCommunityIcons name={iconName} size={22} color={iconColor} />
          {(!unlocked || pending) ? (
            <View style={styles.lockOverlay}>
              <MaterialCommunityIcons name="lock" size={12} color="black" />
            </View>
          ) : null}
        </View>

        <View style={{ flex: 1, paddingRight: 6 }}>
          <Text
            style={[styles.badgeTitle, { color: T.ink }]}
            numberOfLines={1}
          >
            {unlocked ? '✅ ' : pending ? '⏳ ' : '🔒 '} {title}
          </Text>
          <Text style={[styles.badgeDesc, { color: T.muted }]} numberOfLines={2}>{desc}</Text>

          {pending ? (
            <Text style={[styles.progress, { color: T.muted }]} numberOfLines={1}>
              Pending — GW still live
            </Text>
          ) : (!unlocked && progress) ? (
            <Text style={[styles.progress, { color: T.muted }]} numberOfLines={1}>
              Progress: {progress}
            </Text>
          ) : null}

          {!!who?.length && unlocked && !pending ? (
            <Text style={[styles.progress, { color: T.muted }]} numberOfLines={1} ellipsizeMode="tail">
              By: {who.join(', ')}
            </Text>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
};



// ----------------------------- tiny built-in emoji burst -----------------------------
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

function EmojiBurst({ visible, onDone }) {
  const [anims, setAnims] = useState([]);

  useEffect(() => {
    if (!visible) return;
    const count = 36;
    const arr = Array.from({ length: count }).map((_, i) => {
      return {
        id: i,
        emoji: ['🎉', '✨', '🎊'][i % 3],
        x: Math.random() * SCREEN_W,
        y: new Animated.Value(-20),
        rot: new Animated.Value(0),
        dur: 1600 + Math.random() * 900,
        drift: (Math.random() - 0.5) * 80,
      };
    });
    setAnims(arr);

    const animations = arr.map((p) =>
      Animated.parallel([
        Animated.timing(p.y, {
          toValue: SCREEN_H + 40,
          duration: p.dur,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(p.rot, {
          toValue: 1,
          duration: p.dur,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ])
    );

    Animated.stagger(12, animations).start(() => {
      onDone && onDone();
    });
  }, [visible, onDone]);

  if (!visible) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {anims.map((p) => {
        const rotate = p.rot.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', `${Math.random() > 0.5 ? '' : '-'}360deg`],
        });
        return (
          <Animated.Text
            key={p.id}
            style={{
              position: 'absolute',
              fontSize: 18 + Math.round(Math.random() * 10),
              transform: [
                { translateX: p.x + p.drift },
                { translateY: p.y },
                { rotate },
              ],
            }}
          >
            {p.emoji}
          </Animated.Text>
        );
      })}
    </View>
  );
}

// ----------------------------- main -----------------------------
export default function Achievements() {
  const C = useColors();
  const T = makePlatinum(C);

  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showEarnedOnly, setShowEarnedOnly] = useState(false);
  const [expanded, setExpanded] = useState({
    'Legendary 🥇': false,
    'Uncommon 🥈': false,
    'Common 🥉': false,
    'Oopsies 🙃': false,
  });

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalAch, setModalAch] = useState(null);

  const [prevUnlockedIds, setPrevUnlockedIds] = useState(new Set());
  const [burstVisible, setBurstVisible] = useState(false);


  const navigation = useNavigation();
const handleBack = useCallback(() => {
  if (navigation?.canGoBack?.()) navigation.goBack();
  else navigation.navigate('Rank'); // fallback route name
}, [navigation]);


  // subtle celebration each focus
  const burstTimerRef = useRef(null);
  useFocusEffect(
    React.useCallback(() => {
      setBurstVisible(true);
      if (burstTimerRef.current) clearTimeout(burstTimerRef.current);
      burstTimerRef.current = setTimeout(() => setBurstVisible(false), 2400);
      return () => {
        if (burstTimerRef.current) {
          clearTimeout(burstTimerRef.current);
          burstTimerRef.current = null;
        }
        setBurstVisible(false);
      };
    }, [])
  );
// Read the most recent Rank payload without any network calls
const readRankCache = async () => {
  try {
    const rawId = await AsyncStorage.getItem('fplId');
    const id = String(rawId || '').trim();
    // 1) Per-ID cache saved by Rank
    if (isValidFplId(id)) {
      const byId = await AsyncStorage.getItem(`latestRankData:${id}`);
      if (byId) {
        try {
          const j = JSON.parse(byId);
          const pl = pickPayload(j, id);
          if (pl) return pl;
        } catch {}
      }
    }
    // 2) Rank’s consolidated cache { data, gen, timestamp, id }
    const fplData = await AsyncStorage.getItem('fplData');
    if (fplData) {
      try {
        const parsed = JSON.parse(fplData);
        if (parsed?.data) return parsed.data;
        if (isValidFplId(id)) {
          const pl = pickPayload(parsed, id);
          if (pl) return pl;
        }
      } catch {}
    }
    // 3) Legacy key (fallback)
    const legacy = await AsyncStorage.getItem('latestRankData');
    if (legacy) {
      try { return JSON.parse(legacy); } catch {}
    }
  } catch {}
  return null;
};
const loadFromCache = useCallback(async () => {
   const pl = await readRankCache();
   if (pl) setPayload(pl);
   try {
     const rawPrev = await AsyncStorage.getItem('achUnlockedPrev');
     if (rawPrev) {
       const arr = JSON.parse(rawPrev);
       setPrevUnlockedIds(new Set(Array.isArray(arr) ? arr : []));
     }
   } catch {}
 }, []);


  useEffect(() => {
    (async () => {
    await loadFromCache();
    setLoading(false);
  })();
}, [loadFromCache]);

  useFocusEffect(useCallback(() => {
    let mounted = true;
  (async () => {
    if (!mounted) return;
    setRefreshing(true);
    try {
      await loadFromCache();
    } finally {
      if (mounted) setRefreshing(false);
    }
  })();
  return () => { mounted = false; };
}, [loadFromCache]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
  
    await loadFromCache();
    setRefreshing(false);
  }, [ loadFromCache]);

  // ----------------------------- metrics & achievements -----------------------------
  const safe = payload || {};
  const { starters, bench, cap, gks, defs, mids, fwds } = sliceTeam(safe);

  const unsettledXI = starters.some((p) => isUnsettled(p));
  const live = toInt(safe?.live_points);
  const benchPts = toInt(safe?.bench_points);
  const hit = toInt(safe?.hit);
  const safety = toInt(safe?.safety);
  const pointsFinal = live + benchPts + hit;
  const oldRank = toInt(safe?.old_rank);
  const postRank = toInt(safe?.post_rank ?? safe?.displayrank);
  const rankDelta = oldRank && postRank ? (oldRank - postRank) : 0;
  const rankPctGain = oldRank > 0 ? ((oldRank - postRank) / oldRank) * 100 : 0;

  // Build rich per-starter info including BASE (pre-multiplier)
  const startersInfo = starters.map((p) => {
    const m = statsMap(p?.stats);
    return {
      raw: p,
      name: String(p?.name || ''),
      points: toInt(p?.points),       // may include captain multiplier
      base: basePointsFromStats(p),   // ALWAYS pre-multiplier
      mins: minutesFromStats(p),
      goals: m.goals_scored?.times || 0,
      assists: m.assists?.times || 0,
      bonusPts: m.bonus?.pts || 0,
      defcon: m.defensive_contribution?.times || 0,
      yc: m.yellow_cards?.times || 0,
      rc: m.red_cards?.times || 0,
      og: m.own_goals?.times || 0,
      pensMiss: m.penalties_missed?.times || 0,
      top10kEO: top10kEOFrac(p),
      isGK: Number(p?.position) === 1,
      isDEF: Number(p?.position) === 2,
      isMID: Number(p?.position) === 3,
      isFWD: Number(p?.position) === 4,
    };
  });

  const capBase = cap ? basePointsFromStats(cap) : 0;

  const teamGoals = sum(startersInfo.map((x) => x.goals));
  const teamAssists = sum(startersInfo.map((x) => x.assists));
  const teamBonus = sum(startersInfo.map((x) => x.bonusPts));

  const gk = gks[0] || null;
  const gkMap = gk ? statsMap(gk?.stats) : {};
  const gkSaves = gkMap.saves?.times || 0;
  const gkCS = (gkMap.clean_sheets?.times || 0) > 0;

  const reds = sum(startersInfo.map((x) => x.rc));
  const yellows = sum(startersInfo.map((x) => x.yc));
  const ownGoals = sum(startersInfo.map((x) => x.og));
  const pensMissed = sum(startersInfo.map((x) => x.pensMiss));

  // Forwards that produced returns (goals/assists OR base>=5 threshold for “returns”)
  const fwdReturns = startersInfo.filter((x) => x.isFWD && (x.base >= 5 || x.goals > 0 || x.assists > 0)).length;

  const everyonePlayed = startersInfo.every((x) => x.mins > 0);
  const all60 = startersInfo.every((x) => x.mins >= 60);

  const benchTotal = sum(bench.map((p) => toInt(p?.points)));
  const benchSubbedOn = bench.filter((p) => String(p?.emoji || '').toLowerCase() === 'sub');
  const superSub10 = benchSubbedOn.some((p) => toInt(p?.points) >= 10);

  // ✅ All “points-based” checks use BASE (pre-multiplier) now:
  const ddCount = startersInfo.filter((x) => x.base >= 10).length;
  const midsAllDD = startersInfo.filter((x) => x.isMID).every((x) => x.base >= 10) && startersInfo.some(x => x.isMID);
  const defsAllDD = startersInfo.filter((x) => x.isDEF).every((x) => x.base >= 10) && startersInfo.some(x => x.isDEF);
  const fwdsAllDD = startersInfo.filter((x) => x.isFWD).every((x) => x.base >= 10) && startersInfo.some(x => x.isFWD);
  const xiAllDD = startersInfo.length > 0 && startersInfo.every((x) => x.base >= 10);
  const noBlanksXI = startersInfo.every((x) => x.base > 3);

  const diffDelight = startersInfo.some((x) => x.top10kEO < 0.10 && x.base >= 10);
  const vsSafety = pointsFinal - safety;

  const defconPlayersCount = startersInfo.filter((x) => x.defcon > 0).length;
  const hatTrickPlayers = startersInfo.filter((x) => x.goals >= 3).length;
  const no25EOStarters = startersInfo.every((x) => x.top10kEO < 0.25);
  const greenArrow = rankDelta > 0;

  // ---------- Who contributed snapshots (use base where relevant) ----------
  const names = (arr, mapFn = (x) => x.name) => arr.map(mapFn);
  const namesWith = (arr, labelFn) => arr.map((x) => `${x.name}${labelFn ? ` (${labelFn(x)})` : ''}`);

  const whoCaptainMarvelous = cap && capBase >= 20 ? [String(cap.name || '')] : [];
  const whoGoalRush = startersInfo.filter(x => x.goals > 0);
  const whoAssistMachine = startersInfo.filter(x => x.assists >= 2);
  const whoBonusBonanza = startersInfo.filter(x => x.bonusPts > 0);
  const whoHatTrick = startersInfo.filter(x => x.goals >= 3);
  const whoBoxToBox2 = startersInfo.filter(x => (x.isDEF || x.isMID) && x.base >= 10);
  const whoForwardFrenzy = startersInfo.filter(x => x.isFWD && x.base >= 17);
  const whoDoubleDigits = startersInfo.filter(x => x.base >= 10);
  const whoCleanSheetHoarder = defs
    .filter(p => (statsMap(p.stats).clean_sheets?.times || 0) > 0)
    .map(p => String(p.name || ''));
  const whoGKStuff = gk ? [String(gk.name || '')] : [];
  const whoDefcon = startersInfo.filter(x => x.defcon > 0);
  const whoDiffDelight = startersInfo.filter(x => x.top10kEO < 0.10 && x.base >= 10);
  const whoPenaltyMiss = startersInfo.filter(x => x.pensMiss > 0);
  const whoOwnGoals = startersInfo.filter(x => x.og > 0);
  const whoYellows = startersInfo.filter(x => x.yc > 0);
  const whoNoFwdReturns = fwdReturns === 0 ? startersInfo.filter(x => x.isFWD) : [];

  // ----------------------------- achievements -----------------------------
  const positives = [
    { id: 1, title: 'Captain Marvelous', desc: 'Captain’s BASE score reached 20+ (pre-multiplier).',
      unlocked: capBase >= 20, progress: `${capBase}/20`, deferIfLive: false,
      who: capBase >= 20 ? whoCaptainMarvelous : [] },

    { id: 2, title: 'Giant Slayer', desc: 'Beat the GW Safety score by 20+ points.',
      unlocked: vsSafety >= 20, progress: `${vsSafety}/20`, deferIfLive: true },

    { id: 3, title: 'Mega Climber', desc: 'Improved overall rank by ≥70%.',
      unlocked: rankPctGain >= 70, progress: `${rankPctGain.toFixed(1)}%/70%`, deferIfLive: true },

    { id: 5, title: 'All-Action XI', desc: 'Every starter played 60+ minutes.',
      unlocked: all60, progress: all60 ? '' : `${startersInfo.filter((x) => x.mins >= 60).length}/${startersInfo.length} at 60′`, deferIfLive: false },

    { id: 7, title: 'Green Arrow', desc: 'Overall rank improved this week.',
      unlocked: greenArrow, progress: `${nice(rankDelta)} ${greenArrow ? '↑' : ''}`, deferIfLive: true },

    { id: 10, title: 'Clean Sheet Hoarder', desc: 'Four or more defenders kept a clean sheet.',
      unlocked: whoCleanSheetHoarder.length >= 4,
      progress: `${whoCleanSheetHoarder.length}/4`, deferIfLive: true,
      who: whoCleanSheetHoarder },

    { id: 12, title: 'Differential Delight', desc: 'A <10% Top10k EO starter scored 10+ (BASE).',
      unlocked: diffDelight, progress: '', deferIfLive: false,
      who: namesWith(whoDiffDelight, x => `${Math.round(x.top10kEO*100)}% • ${x.base}`) },

    { id: 114, title: 'Creator Crew', desc: 'Team delivered 5+ assists.',
      unlocked: teamAssists >= 5, progress: `${teamAssists}/5`, deferIfLive: false,
      who: namesWith(startersInfo.filter(x => x.assists > 0), x => `${x.assists}A`) },

    { id: 16, title: 'Goal Rush', desc: 'Team scored 10+ goals (total across starters).',
      unlocked: teamGoals >= 10, progress: `${teamGoals}/10`, deferIfLive: false,
      who: teamGoals >= 10 ? namesWith(whoGoalRush, x => `${x.goals}g`) : [] },

    { id: 17, title: 'Gloves Are On Fire', desc: 'Your keeper made 8+ saves.',
      unlocked: gkSaves >= 8, progress: `${gkSaves}/8`, deferIfLive: false,
      who: gkSaves >= 8 ? whoGKStuff : [] },

    { id: 19, title: 'No-Hit Wonder', desc: 'Took no transfer hits.',
      unlocked: hit === 0, progress: hit ? `Hit ${hit}` : '', deferIfLive: false },

    { id: 20, title: 'On the Pitch', desc: 'Every starter played some minutes.',
      unlocked: everyonePlayed, progress: `${startersInfo.filter((x) => x.mins > 0).length}/${startersInfo.length} played`, deferIfLive: false },

    { id: 21, title: 'Close to Safety', desc: 'Within ±10 of the GW Safety score.',
      unlocked: Math.abs(vsSafety) <= 10, progress: `${vsSafety >= 0 ? '+' : ''}${vsSafety} vs Safety`, deferIfLive: true },

    { id: 24, title: 'Keeper of Cleanliness', desc: 'Your GK kept a clean sheet.',
      unlocked: !!gkCS, progress: '', deferIfLive: true,
      who: gkCS ? whoGKStuff : [] },

    { id: 25, title: 'Card Control', desc: 'No red cards among starters.',
      unlocked: reds === 0, progress: `${reds} reds`, deferIfLive: true },

    { id: 26, title: 'Minor Peril', desc: 'No own goals conceded by starters.',
      unlocked: ownGoals === 0, progress: `${ownGoals} OG`, deferIfLive: true },

    { id: 27, title: 'Steady Hands', desc: 'Two or fewer yellow cards among starters.',
      unlocked: yellows <= 2, progress: `${yellows} yellows`, deferIfLive: true },

    { id: 31, title: 'Double-Digits Club', desc: 'Three or more starters hit 10+ (BASE).',
      unlocked: ddCount >= 3, progress: `${ddCount}/3`, deferIfLive: false,
      who: namesWith(whoDoubleDigits, x => x.base) },

    { id: 34, title: 'Super Sub', desc: 'A bench player came on and scored 10+.',
      unlocked: superSub10, progress: '', deferIfLive: false,
      who: superSub10 ? benchSubbedOn.filter(p=>toInt(p.points)>=10).map(p=>`${p.name} (${toInt(p.points)})`) : [] },

    { id: 36, title: 'Spot-Kick Sheriff', desc: 'Your GK saved a penalty.',
      unlocked: (gkMap.penalties_saved?.times || 0) > 0, progress: `${gkMap.penalties_saved?.times || 0} PS`, deferIfLive: false,
      who: (gkMap.penalties_saved?.times || 0) > 0 ? whoGKStuff : [] },

    { id: 37, title: 'Bonus Bonanza', desc: 'Your team earned 12+ bonus points.',
      unlocked: teamBonus >= 12, progress: `${teamBonus}/12`, deferIfLive: true,
      who: teamBonus >= 12 ? namesWith(whoBonusBonanza, x => `${x.bonusPts}BP`) : [] },

    { id: 39, title: 'Penalty Heartbreak', desc: 'Someone in your XI missed a penalty.',
      unlocked: pensMissed > 0, progress: `${pensMissed} PM`, deferIfLive: false,
      who: names(whoPenaltyMiss) },

    { id: 41, title: 'The Wall', desc: '≥4 different players earned Defensive Contribution bonus.',
      unlocked: defconPlayersCount >= 4, progress: `${defconPlayersCount}/4`, deferIfLive: true,
      who: names(whoDefcon) },

    { id: 49, title: 'Bonus Magnet', desc: 'Your team collected 9+ bonus points.',
      unlocked: teamBonus >= 9, progress: `${teamBonus}/9`, deferIfLive: true,
      who: teamBonus >= 9 ? namesWith(whoBonusBonanza, x => `${x.bonusPts}BP`) : [] },

    { id: 50, title: 'Clean Living', desc: 'Zero yellow cards in your starting XI.',
      unlocked: yellows === 0, progress: `${yellows} yellows`, deferIfLive: true },

    { id: 54, title: 'Hat-trick Hero (Squad)', desc: 'At least one player scored 3+ goals.',
      unlocked: hatTrickPlayers >= 1, progress: '', deferIfLive: false,
      who: namesWith(whoHatTrick, x => `${x.goals}g`) },

    { id: 55, title: 'Box-to-Box', desc: 'A DEF or MID scored 10+ (BASE).',
      unlocked: whoBoxToBox2.length > 0, progress: '', deferIfLive: false,
      who: whoBoxToBox2.map(x => `${x.name} (${x.base})`) },

    { id: 56, title: 'Poacher’s Instinct', desc: 'A FWD scored 17+ (BASE).',
      unlocked: whoForwardFrenzy.length > 0, progress: '', deferIfLive: false,
      who: whoForwardFrenzy.map(x => `${x.name} (${x.base})`) },

    { id: 58, title: 'Assist Machine', desc: 'A single player provided 2+ assists.',
      unlocked: startersInfo.some((x) => x.assists >= 2), progress: '', deferIfLive: false,
      who: namesWith(whoAssistMachine, x => `${x.assists}A`) },

    { id: 60, title: 'Super Safe', desc: 'Beat Safety by any margin (≥ +1).',
      unlocked: vsSafety >= 1, progress: `${vsSafety >= 0 ? '+' : ''}${vsSafety}`, deferIfLive: true },

    { id: 61, title: 'Safety Sniper', desc: 'Beat Safety by 10+.',
      unlocked: vsSafety >= 10, progress: `${vsSafety}/10`, deferIfLive: true },

    { id: 62, title: 'Safety Destroyer', desc: 'Beat Safety by 35+.',
      unlocked: vsSafety >= 35, progress: `${vsSafety}/35`, deferIfLive: true },

    { id: 201, title: 'Double Hat-Trick Delight', desc: 'Two different players scored hat-tricks.',
      unlocked: hatTrickPlayers >= 2, progress: `${hatTrickPlayers}/2`, deferIfLive: false,
      who: namesWith(whoHatTrick, x => `${x.goals}g`) },

    { id: 202, title: 'Midfield Masterpiece', desc: 'All starting midfielders scored 10+ (BASE).',
      unlocked: midsAllDD, progress: '', deferIfLive: false,
      who: midsAllDD ? startersInfo.filter(x => x.isMID).map(x => `${x.name} (${x.base})`) : [] },

    { id: 203, title: 'Fortress Backline', desc: 'All starting defenders scored 10+ (BASE).',
      unlocked: defsAllDD, progress: '', deferIfLive: false,
      who: defsAllDD ? startersInfo.filter(x => x.isDEF).map(x => `${x.name} (${x.base})`) : [] },

    { id: 204, title: 'Forward Frenzy', desc: 'All starting forwards scored 10+ (BASE).',
      unlocked: fwdsAllDD, progress: '', deferIfLive: false,
      who: fwdsAllDD ? startersInfo.filter(x => x.isFWD).map(x => `${x.name} (${x.base})`) : [] },

    { id: 205, title: 'Full House', desc: 'All XI starters scored 10+ (BASE).',
      unlocked: xiAllDD, progress: '', deferIfLive: false,
      who: xiAllDD ? startersInfo.map(x => `${x.name} (${x.base})`) : [] },

    { id: 206, title: 'No Blanks XI', desc: 'None of your starters blanked (all BASE >3).',
      unlocked: noBlanksXI, progress: '', deferIfLive: false,
      who: noBlanksXI ? startersInfo.map(x => `${x.name} (${x.base})`) : [] },

    { id: 207, title: 'Differential Arrow', desc: 'No starter had ≥25% Top10k EO and you still got a green arrow.',
      unlocked: no25EOStarters && greenArrow, progress: "", deferIfLive: true,
      who: (no25EOStarters && greenArrow) ? startersInfo.map(x => x.name) : [] },
  ];

  const oopsies = [
    { id: 1002, title: 'Safety Miss+', desc: 'Finished ≥10 below Safety.',
      unlocked: vsSafety <= -10, progress: `${vsSafety}`, deferIfLive: true },

    { id: 1003, title: 'Safety Collapse', desc: 'Finished ≥25 below Safety.',
      unlocked: vsSafety <= -25, progress: `${vsSafety}`, deferIfLive: true },

    { id: 1005, title: 'Yellow Parade', desc: '5+ yellows across your XI.',
      unlocked: yellows >= 5, progress: `${yellows}/5`, deferIfLive: true,
      who: names(whoYellows) },

    { id: 1006, title: 'Own-Goal Orchestra', desc: 'Any starter scored an own goal.',
      unlocked: ownGoals > 0, progress: `${ownGoals} OG`, deferIfLive: false,
      who: names(whoOwnGoals) },

    { id: 1007, title: 'Penalty Panic', desc: 'A starter missed a penalty.',
      unlocked: pensMissed > 0, progress: `${pensMissed} PM`, deferIfLive: false,
      who: names(whoPenaltyMiss) },

    { id: 1011, title: 'Bench Treasure', desc: '20+ points stranded on the bench.',
      unlocked: benchTotal >= 20, progress: `${benchTotal}/20`, deferIfLive: true },

    { id: 1012, title: 'Bench Dragon Hoard', desc: '30+ points stranded on the bench.',
      unlocked: benchTotal >= 30, progress: `${benchTotal}/30`, deferIfLive: true },

    { id: 1015, title: 'Ghost XI', desc: '2+ starters with 0 minutes.',
      unlocked: startersInfo.filter((x) => x.mins === 0).length >= 2,
      progress: `${startersInfo.filter((x) => x.mins === 0).length}/2`, deferIfLive: true },

    { id: 1018, title: 'Goal Drought', desc: 'Starters scored 0 team goals.',
      unlocked: teamGoals === 0, progress: `0 goals`, deferIfLive: true,
      who: teamGoals === 0 ? startersInfo.map(x => x.name) : [] },

    { id: 1031, title: 'Triple Trouble', desc: 'Triple Captain used; captain BASE ≤5.',
      unlocked: String(cap?.role).toLowerCase() === 'tc' && capBase <= 5, progress: `${capBase}/5`, deferIfLive: true,
      who: (String(cap?.role).toLowerCase() === 'tc' && capBase <= 5) ? whoCaptainMarvelous : [] },

    { id: 1033, title: 'Template Tears', desc: '5+ starters Top10k EO ≥70% and still below Safety.',
      unlocked: startersInfo.filter((x) => x.top10kEO >= 0.70).length >= 5 && vsSafety < 0,
      progress: `${startersInfo.filter((x) => x.top10kEO >= 0.70).length} templaters`, deferIfLive: true },

    { id: 1034, title: 'FWD Famine', desc: 'Forwards produced no goals/assists.',
      unlocked: fwdReturns === 0, progress: `0 FWD returns`, deferIfLive: true,
      who: names(whoNoFwdReturns) },

    { id: 1037, title: 'Bonus Ban', desc: 'Team earned 0 bonus points.',
      unlocked: teamBonus === 0, progress: `0 bonus`, deferIfLive: true,
      who: teamBonus === 0 ? startersInfo.map(x => x.name) : [] },

    { id: 1056, title: 'Defcon None', desc: '0 players earned Defensive Contribution bonus.',
      unlocked: defconPlayersCount === 0, progress: `0 players`, deferIfLive: true },

    { id: 1057, title: 'Keeper Komedy', desc: 'GK 90m, 0 saves, no CS, ≤1 point.',
      unlocked: minutesFromStats(gk) >= 90 && (gkMap.saves?.times || 0) === 0 && !gkCS && toInt(gk?.points) <= 1,
      progress: `${toInt(gk?.points)} pts`, deferIfLive: true,
      who: (minutesFromStats(gk) >= 90 && (gkMap.saves?.times || 0) === 0 && !gkCS && toInt(gk?.points) <= 1) ? whoGKStuff : [] },
  ];

  const markPending = (ach) =>
    (unsettledXI && ach.deferIfLive
      ? { ...ach, pending: true, unlocked: false, progress: '', who: [] }
      : { ...ach, pending: false });

  const legendaryUnf = [
    1, 2, 3, 16, 17, 34, 41, 56, 62, 201, 202, 203, 204, 205, 206, 207,
  ].map((id) => positives.find((a) => a.id === id)).filter(Boolean).map(markPending);

  const uncommonUnf = [
    10, 12, 114, 31, 36, 37, 39, 49, 50, 54, 55, 58, 61,
  ].map((id) => positives.find((a) => a.id === id)).filter(Boolean).map(markPending);

  const commonUnf = [
    5, 7, 19, 20, 21, 24, 25, 26, 27, 60,
  ].map((id) => positives.find((a) => a.id === id)).filter(Boolean).map(markPending);

  const oopsiesUnf = oopsies.map(markPending);

  const gwNum = Number(safe?.gw ?? safe?.GW ?? safe?.gameweek ?? 0);
  const posEarned =
    legendaryUnf.filter(a => a.unlocked).length +
    uncommonUnf.filter(a => a.unlocked).length +
    commonUnf.filter(a => a.unlocked).length;
  const posTotal = legendaryUnf.length + uncommonUnf.length + commonUnf.length;
  const oopsEarned = oopsiesUnf.filter(a => a.unlocked).length;
  const oopsTotal  = oopsiesUnf.length;

  useEffect(() => {
    (async () => {
      if (!gwNum) return;
      try {
        await AsyncStorage.setItem(
          `ach.counts:${gwNum}`,
          JSON.stringify({
            gw: gwNum,
            earned: posEarned,
            total: posTotal,
            earnedOops: oopsEarned,
            totalOops: oopsTotal,
            updatedAt: Date.now(),
          })
        );
      } catch {}
    })();
  }, [gwNum, posEarned, posTotal, oopsEarned, oopsTotal]);

  const filterByEarned = (arr) => (showEarnedOnly ? arr.filter((a) => a.unlocked) : arr);
  const sortUnlockedFirst = (arr) =>
    [...arr].sort((a, b) => {
      if (!!b.unlocked - !!a.unlocked) return !!b.unlocked - !!a.unlocked;
      if ((a.pending ? 1 : 0) - (b.pending ? 1 : 0)) return (a.pending ? 1 : 0) - (b.pending ? 1 : 0);
      return String(a.title).localeCompare(String(b.title));
    });

  const buckets = [
    { label: 'Legendary 🥇', items: sortUnlockedFirst(filterByEarned(legendaryUnf)) },
    { label: 'Uncommon 🥈', items: sortUnlockedFirst(filterByEarned(uncommonUnf)) },
    { label: 'Common 🥉',   items: sortUnlockedFirst(filterByEarned(commonUnf)) },
    { label: 'Oopsies 🙃',  items: sortUnlockedFirst(filterByEarned(oopsiesUnf)) },
  ];

  const anyItems = buckets.some((b) => b.items.length > 0);
  const toggleSection = (label) => setExpanded((prev) => ({ ...prev, [label]: !prev[label] }));

  const currentUnlockedIds = [...legendaryUnf, ...uncommonUnf, ...commonUnf, ...oopsiesUnf]
    .filter((a) => a.unlocked)
    .map((a) => a.id);

  useEffect(() => {
    const prev = prevUnlockedIds;
    const newly = currentUnlockedIds.filter((id) => !prev.has(id));
    if (newly.length > 0) {
      setBurstVisible(true);
      const t = setTimeout(() => setBurstVisible(false), 2600);
      const nextSet = new Set(currentUnlockedIds);
      setPrevUnlockedIds(nextSet);
      AsyncStorage.setItem('achUnlockedPrev', JSON.stringify([...nextSet])).catch(() => {});
      return () => clearTimeout(t);
    } else {
      const nextSet = new Set(currentUnlockedIds);
      setPrevUnlockedIds(nextSet);
      AsyncStorage.setItem('achUnlockedPrev', JSON.stringify([...nextSet])).catch(() => {});
    }
  }, [payload, currentUnlockedIds.join('|')]);

  // ----------------------------- render -----------------------------
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]} edges={['left', 'right']}>
      <AppHeader  />
<View style={styles.backRow}>
  <TouchableOpacity
    onPress={handleBack}
    style={[styles.backBtn, { borderColor: T.border, backgroundColor: T.card }]}
    hitSlop={{ top:8, bottom:8, left:8, right:8 }}
  >
    <MaterialCommunityIcons name="arrow-left" size={16} color={T.silverDeep} />
    <Text style={[styles.backText, { color: T.silverDeep }]}>Back to Rank</Text>
  </TouchableOpacity>
</View>

      <View style={[
        styles.pageHero,
        {
          borderColor: T.border,
          backgroundColor: T.card,
          shadowColor: '#000',
          shadowOpacity: 0.10,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
          elevation: 2,
        }
      ]}>
        <Text style={[styles.pageTitle, { color: T.silverDeep }]}>Trophy Room</Text>
        <Text style={[styles.pageSub, { color: T.muted }]}>
          Your weekly haul — unlock badges as your GW unfolds.
        </Text>
      </View>

      <EmojiBurst visible={burstVisible} onDone={() => setBurstVisible(false)} />

      <ScrollView
        contentContainerStyle={{ padding: 14, paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.silverDeep} />}
      >
        <View style={styles.headerRow}>
          <Text style={[styles.sectionTitle, { color: T.silverDeep }]}>
            Gameweek {safe?.gw ?? safe?.GW ?? safe?.gameweek ?? (payload ? '?' : '—')}
          </Text>

          {/* Earned / All toggle */}
          <View style={[styles.toggleWrap, { borderColor: T.border, backgroundColor: T.card }]}>
            <TouchableOpacity
              onPress={() => setShowEarnedOnly(false)}
              style={[styles.toggleBtn, { backgroundColor: !showEarnedOnly ? T.silverDeep : 'transparent' }]}
            >
              <Text style={[styles.toggleText, { color: !showEarnedOnly ? C.bg : T.silverDeep }]}>All</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setShowEarnedOnly(true)}
              style={[styles.toggleBtn, { backgroundColor: showEarnedOnly ? T.silverDeep : 'transparent' }]}
            >
              <Text style={[styles.toggleText, { color: showEarnedOnly ? C.bg : T.silverDeep }]}>Earned</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={onRefresh}
            style={[styles.refreshBtn, { borderColor: T.border, backgroundColor: T.card }]}
          >
            <MaterialCommunityIcons name="refresh" size={16} color={T.silverDeep} />
            <Text style={[styles.refreshText, { color: T.silverDeep }]}>Refresh</Text>
          </TouchableOpacity>
        </View>

        {loading && !payload ? (
          <ActivityIndicator style={{ marginTop: 20 }} color={T.silverDeep} />
        ) : !payload ? (
          <View style={{ marginTop: 12 }}>
            <Text style={[styles.text, { color: T.muted }]}>No gameweek data found yet.</Text>
          </View>
        ) : (
          <Text style={[styles.text, { color: T.muted, marginBottom: 10 }]}>
            Points: {nice(pointsFinal)} | Safety: {nice(safety)} | Rank Δ: {rankDelta > 0 ? `+${nice(rankDelta)}` : nice(rankDelta)} ({rankPctGain.toFixed(1)}%)
          </Text>
        )}

        {buckets.map((b) => {
  const open = !!expanded[b.label];

  const cnt = {
    earned:
      b.label === 'Legendary 🥇' ? legendaryUnf.filter((a) => a.unlocked).length :
      b.label === 'Uncommon 🥈' ? uncommonUnf.filter((a) => a.unlocked).length :
      b.label === 'Common 🥉'   ? commonUnf.filter((a) => a.unlocked).length   :
      oopsiesUnf.filter((a) => a.unlocked).length,
    total:
      b.label === 'Legendary 🥇' ? legendaryUnf.length :
      b.label === 'Uncommon 🥈' ? uncommonUnf.length :
      b.label === 'Common 🥉'   ? commonUnf.length   :
      oopsiesUnf.length,
  };

  return (
    <View
      key={b.label}
      style={[
        styles.section,
        {
          backgroundColor: T.card,
          borderColor: T.border,
          shadowColor: '#000',
          shadowOpacity: 0.08,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 3 },
          elevation: 2,
        }
      ]}
    >
      <TouchableOpacity
        onPress={() => toggleSection(b.label)}
        activeOpacity={0.7}
        style={styles.sectionHeader}
      >
        <Text style={[styles.catTitle, { color: T.ink }]}>
          {b.label}{'  '}
          <Text style={{ color: T.silverDeep, fontWeight: '800' }}>
            {cnt.earned}/{cnt.total}
          </Text>
        </Text>
        <MaterialCommunityIcons
          name={open ? 'chevron-down' : 'chevron-right'}
          size={22}
          color={T.ink}
        />
      </TouchableOpacity>

      {open && (
        b.items.length ? (
          b.items.map((ach) => (
            <TrophyBadge
              key={`${b.label}-${ach.id}`}
              id={ach.id}
              unlocked={!!ach.unlocked}
              title={ach.title}
              desc={ach.desc}
              progress={ach.progress}
              colors={C}
              pending={!!ach.pending}
              who={ach.who || []}
              onPress={() => { setModalAch(ach); setModalOpen(true); }}
            />
          ))
        ) : (
          <Text style={[styles.text, { color: T.muted, paddingVertical: 6 }]}>
            {showEarnedOnly ? 'No earned yet in this category.' : 'No items to show.'}
          </Text>
        )
      )}
    </View>
  );
})}


        {!anyItems && (
          <Text style={[styles.text, { color: T.muted, marginTop: 12 }]}>
            No achievements to show here yet.
          </Text>
        )}
      </ScrollView>

      {/* -------- Achievement Details Modal -------- */}
      <Modal
        animationType="fade"
        transparent
        visible={modalOpen}
        onRequestClose={() => setModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: T.card, borderColor: T.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: T.ink }]}>
                {modalAch?.unlocked ? '✅ ' : modalAch?.pending ? '⏳ ' : '🔒 '}{modalAch?.title || 'Achievement'}
              </Text>
              <TouchableOpacity onPress={() => setModalOpen(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <MaterialCommunityIcons name="close" size={20} color={T.ink} />
              </TouchableOpacity>
            </View>

            {!!modalAch?.desc && (
              <Text style={[styles.modalDesc, { color: T.muted }]}>{modalAch.desc}</Text>
            )}

            {!!modalAch?.pending && (
              <Text style={[styles.modalStatus, { color: T.muted }]}>Pending — GW still live</Text>
            )}

            {(!modalAch?.pending && modalAch?.progress) ? (
              <Text style={[styles.modalStatus, { color: T.ink }]}>Progress: {modalAch.progress}</Text>
            ) : null}

            {!!modalAch?.who?.length && !modalAch?.pending && (
              <View style={styles.modalWhoWrap}>
                <Text style={[styles.modalWhoTitle, { color: T.silverDeep }]}>Who contributed</Text>
                {modalAch.who.slice(0, 12).map((line, i) => (
                  <Text key={i} style={[styles.modalWhoItem, { color: T.muted }]} numberOfLines={1} ellipsizeMode="tail">
                    • {line}
                  </Text>
                ))}
                {modalAch.who.length > 12 ? (
                  <Text style={[styles.modalWhoItem, { color: T.muted }]}>…and {modalAch.who.length - 12} more</Text>
                ) : null}
              </View>
            )}

            <View style={styles.modalFooterRow}>
              <View style={[styles.modalPill, { borderColor: T.border, backgroundColor: T.card }]}>
                <MaterialCommunityIcons
                  name={iconFor(modalAch?.id || 0)}
                  size={16}
                  color={T.silverDeep}
                />
               
              </View>
              <View style={{ flex: 1 }} />
              <TouchableOpacity
                style={[styles.modalCloseBtn, { borderColor: T.border, backgroundColor: T.card }]}
                onPress={() => setModalOpen(false)}
              >
                <Text style={[styles.modalCloseText, { color: T.ink }]}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      {/* -------- end modal -------- */}
    </SafeAreaView>
  );
}

// ----------------------------- styles -----------------------------
const styles = StyleSheet.create({
  container: { flex: 1 },

  pageHero: {
    marginHorizontal: 14,
    marginTop: 10,
    marginBottom: 6,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  pageTitle: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  pageSub: {
    fontSize: 12,
    marginTop: 4,
  },

  section: {
    borderRadius: 14,
    padding: 12,
    marginBottom: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  catTitle: { fontSize: 18, fontWeight: '800' },
  sectionTitle: { fontWeight: '900', fontSize: 18 },
  text: { fontSize: 13 },

  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  badgeIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    position: 'relative',
  },
  backRow: {
  marginHorizontal: 14,
  marginTop: 6,
  marginBottom: 2,
  alignItems: 'flex-start',
},
backBtn: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 6,
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: 10,
  borderWidth: StyleSheet.hairlineWidth,
},
backText: { fontWeight: '900', fontSize: 12 },

  lockOverlay: {
    position: 'absolute',
    right: -4,
    top: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  badgeTitle: { fontSize: 14, fontWeight: '900', letterSpacing: 0.1 },
  badgeDesc: { fontSize: 12, marginTop: 2 },
  progress: { fontSize: 11, marginTop: 3 },

  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  refreshText: { fontWeight: '900', fontSize: 12 },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 6,
  },
  toggleWrap: {
    flexDirection: 'row',
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  toggleBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  toggleText: { fontWeight: '900', fontSize: 12 },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 540,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  modalTitle: { fontSize: 18, fontWeight: '900' },
  modalDesc: { fontSize: 13, marginTop: 2 },
  modalStatus: { fontSize: 12, marginTop: 6, fontWeight: '700' },
  modalWhoWrap: { marginTop: 10 },
  modalWhoTitle: { fontWeight: '900', marginBottom: 6 },
  modalWhoItem: { fontSize: 12, marginBottom: 2 },

  modalFooterRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  modalPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  modalPillText: { fontWeight: '900', fontSize: 12 },
  modalCloseBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  modalCloseText: { fontWeight: '800', fontSize: 12 },
});
