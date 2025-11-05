// prices_v2.js — Minimal filters + layout tweaks per latest spec
// Changes in this version:
// 1) View toggle (List/Summary) on the LEFT; to its RIGHT: Hide low-owned (List only) + Help
// 2) "Hide low-owned" text never changes; just toggles active style
// 3) Position/Team default labels are "All Positions" / "All Teams"
// 4) If user searches OR chooses Position/Team while on Summary, switch to List and apply filters
// 5) Search stays half-width with Position/Team pills to its right (always visible)

import { useFocusEffect } from '@react-navigation/native';
import { Linking } from 'react-native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ThemedTextInput from './ThemedTextInput';
import { SafeAreaView } from 'react-native-safe-area-context';


import {
  View,
  Text,
  StyleSheet,
 
  
  TouchableOpacity,
  FlatList,
  ScrollView,
  Modal,
  RefreshControl,
  Image,
  Keyboard,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import FontAwesome from 'react-native-vector-icons/FontAwesome';
import AppHeader from './AppHeader';
import InfoBanner from './InfoBanner';
import { ClubCrest, assetImages } from './clubs';
import { useColors, useTheme } from './theme';
import { smartFetch } from './signedFetch';
Text.defaultProps = Text.defaultProps || {};
Text.defaultProps.allowFontScaling = false;

/* ───────── Constants & helpers ───────── */
const BOTTOM_INSET = 40;

const WATCHLIST_KEY = 'pricesWatchlist';
const EO_CUTOFF = 0.1; // percent ownership threshold
const MAYBE_THRESHOLD = 0.95;

const EO_TTL_MS = 10 * 60 * 1000; // 10 minutes

const SEEN_HELP_KEY = 'prices.seenHelpOnce';
const POS_ORDER = { GK: 0, GKP: 0, DEF: 1, MID: 2, FW: 3, FWD: 3 };
const posSort = (a, b) => (POS_ORDER[a] ?? 99) - (POS_ORDER[b] ?? 99) || a.localeCompare(b);

const pad2 = (n) => String(n).padStart(2, '0');
const fold = (s = '') =>
  String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/ø/g, 'o')
    .replace(/đ|ð/g, 'd')
    .replace(/þ/g, 'th')
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(/ł/g, 'l');

const computeCountdownToNext0130UTC = () => {
  const now = new Date();
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 1, 30, 0, 0));
  let next = base;
  const afterCut = now.getUTCHours() > 1 || (now.getUTCMinutes() >= 30 && now.getUTCHours() === 1);
  if (afterCut) next = new Date(base.getTime() + 24 * 60 * 60 * 1000);
  const diffMs = Math.max(0, next - now);
  const total = Math.floor(diffMs / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
};

const getPredictionBucket = (val, perHour) => {
  const in1d = val + perHour * 24;
  const in2d = val + perHour * 48;
  if (val >= 1) return 'tonight_up';
  if (val <= -1) return 'tonight_down';
  if (in1d >= 1) return 'tomorrow_up';
  if (in1d <= -1) return 'tomorrow_down';
  if (in2d >= 1) return '2days_up';
  if (in2d <= -1) return '2days_down';
  return 'later';
};

const BUCKET_GROUP_RANK = {
  tonight_up: 0,
  tonight_down: 1,
  tomorrow_up: 2,
  tomorrow_down: 3,
};
const rankBucket = (b) => (BUCKET_GROUP_RANK[b] ?? 4);

// Default sort: bucket urgency, then |progress_tonight|, then name
const defaultPriceSort = (a, b) => {
  const ra = rankBucket(a.bucket);
  const rb = rankBucket(b.bucket);
  if (ra !== rb) return ra - rb;
  const am = Math.abs(a.progress_tonight || 0);
  const bm = Math.abs(b.progress_tonight || 0);
  if (am !== bm) return bm - am;
  return String(a.name).localeCompare(String(b.name));
};


const detectDark = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return true;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const srgb = [r, g, b].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  const L = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
  return L < 0.5;
};

const pctSigned = (n) => {
  const v = Number(n || 0) * 100;
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}\u2060%`;
};

/* ───────── EO helpers (NEAR ONLY) ───────── */
const getEOFromStorage = async (key) => {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.t && parsed.data) {
      if (Date.now() - parsed.t > EO_TTL_MS) return null;
      return parsed.data;
    }
    return parsed;
  } catch { return null; }
};
const setEOToStorage = async (key, data) => { try { await AsyncStorage.setItem(key, JSON.stringify({ t: Date.now(), data })); } catch {} };
const buildEOMapNear = (json) => {
  const map = new Map(); if (!json) return map;
  const KEYS_NEAR = ['EO1','eo1','eo_near','EO_near','near','eoNear','EO_near_you','EO_NearYou'];
  const norm = (v) => { const n = Number(v); if (!Number.isFinite(n)) return null; return n >= 0 && n <= 1 ? n * 100 : n; };
  const pickEO = (obj) => { for (const k of KEYS_NEAR) if (obj && obj[k] != null) { const n = norm(obj[k]); if (n != null) return n; } if (obj && typeof obj === 'object') { for (const [k, v] of Object.entries(obj)) if (/eo/i.test(k)) { const n = norm(v); if (n != null) return n; } } return null; };
  const setOne = (idLike, v) => { const id = Number(idLike ?? v?.element ?? v?.id ?? v?.element_id ?? v?.player_id); if (!Number.isFinite(id) || id <= 0) return; if (typeof v === 'number') { const n = norm(v); if (n != null) map.set(id, n); return; } if (v && typeof v === 'object') { const n = pickEO(v); if (n != null) map.set(id, n); } };
  if (json.elements && typeof json.elements === 'object') { for (const [id, v] of Object.entries(json.elements)) setOne(id, v); return map; }
  if (typeof json === 'object' && !Array.isArray(json)) { for (const [id, v] of Object.entries(json)) setOne(id, v); return map; }
  if (Array.isArray(json)) { for (const row of json) if (row && typeof row === 'object') setOne(row?.element ?? row?.id ?? row?.element_id ?? row?.player_id, row); }
  return map;
};

/* ───────── Data hook ───────── */
function usePricesData() {
  const sFetch = smartFetch;
  const [players, setPlayers] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [countdown, setCountdown] = useState(computeCountdownToNext0130UTC());
  const [onlyAbove1Pct, setOnlyAbove1Pct] = useState(true);
  const [eoMap, setEoMap] = useState(new Map());
  const [watchlist, setWatchlist] = useState(new Set());
  const [myTeamIds, setMyTeamIds] = useState(new Set());

  useEffect(() => { const id = setInterval(() => setCountdown(computeCountdownToNext0130UTC()), 1000); return () => clearInterval(id); }, []);

  const fetchPrices = useCallback(async () => {
    const bucket = Math.floor(Date.now() / (10 * 60 * 1000));
    const url = `https://livefpl.us/api/prices.json`;
    const resp = await sFetch(url, { headers: { 'cache-control': 'no-cache' } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    const arr = Object.entries(json).map(([elStr, p]) => {
      const el = Number(elStr);
      return {
        ...p,
        name: String(p.name || ''), team: String(p.team || ''),
        _nameFold: fold(p?.name ?? ''), _teamFold: fold(p?.team ?? ''), _typeFold: fold(p?.type ?? ''),
        progress: Number(p.progress ?? 0), progress_tonight: Number(p.progress_tonight ?? 0), per_hour: Number(p.per_hour ?? 0),
        cost: Number(p.cost ?? 0), team_code: Number(p.team_code ?? 0), id: el, element: el, _el: el,
        _pid: `${fold(p.name)}|${Number(p.team_code ?? 0)}`, type: String(p.type || ''), type_code: Number(p.type_code ?? 0),
      };
    });
    setPlayers(arr);
  }, [sFetch]);

  const loadWatchlist = useCallback(async () => {
    const raw = await AsyncStorage.getItem(WATCHLIST_KEY);
    if (!raw) return setWatchlist(new Set());
    try { const ids = JSON.parse(raw); setWatchlist(new Set(Array.isArray(ids) ? ids : [])); } catch { setWatchlist(new Set()); }
  }, []);

  const toggleWatch = useCallback(async (p) => {
    setWatchlist((prev) => {
      const next = new Set(prev);
      const id = p._pid;
      if (next.has(id)) next.delete(id); else next.add(id);
      AsyncStorage.setItem(WATCHLIST_KEY, JSON.stringify(Array.from(next))).catch(() => {});
      return next;
    });
  }, []);

  const loadMyTeamFromRankCache = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem('fplData');
      if (!raw) { setMyTeamIds(new Set()); return; }
      const parsed = JSON.parse(raw); const payload = parsed?.data || parsed; const team = Array.isArray(payload?.team) ? payload.team : [];
      const idSet = new Set();
      team.forEach((pl) => { const el = Number(pl?.element ?? pl?.fpl_id ?? pl?.id); if (Number.isFinite(el)) idSet.add(el); });
      setMyTeamIds(idSet);
    } catch { setMyTeamIds(new Set()); }
  }, []);

  const loadNearEOMap = useCallback(async () => {
    try {
      const myId = await AsyncStorage.getItem('fplId');
      const rawLocal = (myId && (await AsyncStorage.getItem(`localGroup:${myId}`))) || (await AsyncStorage.getItem('localGroup'));
      const localNum = Number(rawLocal) || 1; const key = `EO:local:${localNum}`;
      const cached = await getEOFromStorage(key);
      if (cached) { const m = buildEOMapNear(cached); if (m.size > 0) { setEoMap(m); return; } }
      try {
        const res = await fetch('https://livefpl.us/elite.json', { headers: { 'cache-control': 'no-cache' } });
        if (res.ok) { const json = await res.json(); await setEOToStorage('EO:elite', json); const m = buildEOMapNear(json); setEoMap(m); return; }
      } catch {}
      setEoMap(new Map());
    } catch { setEoMap(new Map()); }
  }, []);

  useEffect(() => {
    (async () => {
      try { await fetchPrices(); } catch {}
      try { await loadWatchlist(); } catch {}
      try { await loadMyTeamFromRankCache(); } catch {}
      try { await loadNearEOMap(); } catch {}
    })();
  }, [fetchPrices, loadWatchlist, loadMyTeamFromRankCache, loadNearEOMap]);

  const handleRefresh = useCallback(async () => {
    try { setRefreshing(true); await Promise.all([fetchPrices(), loadWatchlist(), loadMyTeamFromRankCache(), loadNearEOMap()]); }
    finally { setRefreshing(false); }
  }, [fetchPrices, loadWatchlist, loadMyTeamFromRankCache, loadNearEOMap]);

  return { players, refreshing, handleRefresh, countdown, onlyAbove1Pct, setOnlyAbove1Pct, eoMap, watchlist, toggleWatch, myTeamIds };
}

/* ───────── UI building blocks ───────── */
const makeCardStyles = (C, isDark) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: isDark ? C.border2 : '#e2e8f0',
    backgroundColor: isDark ? C.card : '#ffffff',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    marginBottom: 4,
  },

  crest: { width: 22, height: 22 },

  main: { flex: 1, minWidth: 0 },
  topLine: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  name: { color: isDark ? C.ink : '#0f172a', fontSize: 13, fontWeight: '800', flexShrink: 1 },
  statusPillWrap: { flexShrink: 0 },
  topRight: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 8 },

  bottomLine: { marginTop: 2, flexDirection: 'row', alignItems: 'center', gap: 8 },
  meta: { color: isDark ? C.muted : '#64748b', fontSize: 11, flexShrink: 1, minWidth: 0 },

  progInlineWrap: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  progTrack: {
    width: 96,
    height: 8,
    backgroundColor: isDark ? '#0b1224' : '#e5e7eb',
    borderRadius: 4,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: isDark ? '#1b2642' : '#cbd5e1',
  },
  progPctBox: { width: 60, alignItems: 'flex-end' },
  progFill: { height: '100%', borderRadius: 4 },
  progFillUp: { backgroundColor: '#22c55e' },
  progFillDown: { backgroundColor: '#b91c1c' },
  progGoal: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 1, backgroundColor: isDark ? '#334155' : '#94a3b8' },
  progPctSmall: { fontSize: 10, fontWeight: '700' },

  starBtn: { paddingLeft: 6 },

  pillBase: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 2, paddingHorizontal: 8, borderRadius: 999, borderWidth: 1 },
  pillTxt: { fontSize: 10, fontWeight: '800' },
  pillUp: { backgroundColor: isDark ? '#166534' : '#dcfce7', borderColor: '#16a34a' },
  pillDown: { backgroundColor: isDark ? '#7C2D12' : '#fee2e2', borderColor: '#ef4444' },
  pillSoonUp: { backgroundColor: isDark ? '#0f1725' : '#eef2ff', borderColor: isDark ? '#1d4ed8' : '#93c5fd' },
  pillSoonDown: { backgroundColor: isDark ? '#1e1825' : '#f5f3ff', borderColor: isDark ? '#6d28d9' : '#c4b5fd' },
  barRow: { marginTop: 12 },
  barHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  barLabel: { fontWeight: '800', fontSize: 13 },
  barPct: { fontSize: 12, fontWeight: '900' },
  pillNeutral: { backgroundColor: isDark ? '#0f1525' : '#f8fafc', borderColor: isDark ? '#374151' : '#e5e7eb' },
});

const StatusPill = ({ bucket, styles, isDark }) => {
  const label =
    bucket === 'tonight_up' || bucket === 'tonight_down' ? 'Tonight' :
    bucket === 'tomorrow_up' || bucket === 'tomorrow_down' ? 'Tomorrow' : '>2d';

  const pillStyle =
    bucket === 'tonight_up' ? styles.pillUp :
    bucket === 'tonight_down' ? styles.pillDown :
    bucket === 'tomorrow_up' ? styles.pillSoonUp :
    bucket === 'tomorrow_down' ? styles.pillSoonDown :
    styles.pillNeutral;

  const showArrow = bucket.includes('up') || bucket.includes('down');

  return (
    <View style={[styles.pillBase, pillStyle]}>
      {showArrow && (
        <Image
          source={bucket.includes('up') ? assetImages.up : assetImages.down}
          style={{ width: 10, height: 10, resizeMode: 'contain' }}
        />
      )}
      <Text style={[styles.pillTxt, { color: isDark ? '#ffffff' : '#000000' }]}>{label}</Text>
    </View>
  );
};

const InlineProgress = ({ value, styles, isDark }) => {
  const raw = Number(value) || 0;
  const v = Math.max(0, Math.min(1, Math.abs(raw)));
  const theFill = raw >= 0 ? styles.progFillUp : styles.progFillDown;
  const pctTxtColor = raw >= 0 ? (isDark ? '#86efac' : '#166534') : (isDark ? '#fecaca' : '#991b1b');

  return (
    <View style={styles.progInlineWrap}>
      <View style={styles.progTrack}>
        <View style={styles.progGoal} />
        <View style={[styles.progFill, theFill, { width: `${v * 100}%` }]} />
      </View>
      <View style={styles.progPctBox}>
        <Text style={[styles.progPctSmall, { color: pctTxtColor }]} numberOfLines={1}>
          {pctSigned(raw)}
        </Text>
      </View>
    </View>
  );
};

/* ───────── Table-like Row for List view ───────── */
/* ───────── Table-like Row for List view ───────── */
/* ───────── Table-like Row for List view ───────── */
/* ───────── Compact, readable table row ───────── */
/* ───────── Compact, readable table row ───────── */
const tableRowS = (C, isDark) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,           // ↓ was 6
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderColor: isDark ? C.border2 : '#e2e8f0',
    backgroundColor: isDark ? C.card : '#ffffff',
    borderRadius: 8,
    marginBottom: 4,              // ↓ was 6
  },

  // LEFT: player info (bigger)
  cellInfo: { flex: 2.4, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 }, // ↑ was 1.3
  crest: { width: 20, height: 20 },                    // slightly smaller icon keeps row tight
  name: { color: isDark ? C.ink : '#0f172a', fontSize: 13, fontWeight: '900' },
  meta: { color: isDark ? C.muted : '#64748b', fontSize: 10 },

  // MIDDLE: bar + % inline
                    // ↓ was 10
  cellProg: { flex: 1, minWidth: 100, paddingLeft: 10,paddingRight: 8 },
  progLine: { flexDirection: 'column', alignItems: 'stretch', gap: 6 },
  progWrap: { flex: 1 }, // (kept; now just wraps the wider bar)
  track: {
    height: 10,                   // bigger bar
     backgroundColor: isDark ? '#0b1224' : '#eef2f7',

    borderRadius: 7,
     overflow: 'hidden',
     borderWidth: 1,
     borderColor: isDark ? '#1b2642' : '#cbd5e1',
   },
   fill: { height: '100%', borderRadius: 6 },

 pctTxt: { width: '100%', textAlign: 'right', fontSize: 10, fontWeight: '800', marginTop: 2 },


  // RIGHT: pill over star
cellRight: { width: 78, alignItems: 'flex-end', justifyContent: 'center', flexShrink: 0 },
  tagBox: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,              // ↓ was 6
    alignSelf: 'flex-end'
  },
  tagTxt: { fontSize: 10, fontWeight: '900' },
  arrow: { width: 11, height: 11, resizeMode: 'contain' },

  // tag variants
  tagTonightUp:   { backgroundColor: 'rgba(144,238,144,0.20)', borderColor: 'lightgreen' },
  tagTonightDown: { backgroundColor: 'rgba(255,50,90,0.15)',   borderColor: '#ff325a' },
  tagTomorrow:    { backgroundColor: isDark ? '#0f172a' : '#f1f5f9', borderColor: isDark ? '#334155' : '#e2e8f0' },
  tagLater:       { backgroundColor: isDark ? '#0f172a' : '#f8fafc', borderColor: isDark ? '#334155' : '#e2e8f0' },

  starHit: { padding: 4 },
});






const predictionLabelAndStyle = (bucket, s, isDark) => {
  if (bucket === 'tonight_up')   return { label: 'Tonight', style: [s.tagBase, s.tagTonightUp], arrow: 'up',  txtColor: isDark ? '#e6eefc' : '#0f172a' };
  if (bucket === 'tonight_down') return { label: 'Tonight', style: [s.tagBase, s.tagTonightDown], arrow: 'down', txtColor: isDark ? '#e6eefc' : '#0f172a' };
  if (bucket === 'tomorrow_up' || bucket === 'tomorrow_down')
    return { label: 'Tomorrow', style: [s.tagBase, s.tagTomorrow], arrow: null, txtColor: isDark ? '#e6eefc' : '#0f172a' };
  return { label: '>2d', style: [s.tagBase, s.tagLater], arrow: null, txtColor: isDark ? '#e6eefc' : '#0f172a' };
};


const TableRow = ({ player, starred, onToggleStar, onOpen, C, isDark }) => {
  const s = useMemo(() => tableRowS(C, isDark), [C, isDark]);

  // progress
  const prog = Number(player.progress) || 0;
  const widthPct = `${Math.max(0, Math.min(1, Math.abs(prog))) * 100}%`;
  const isUp = prog >= 0;
  const barColor = isUp ? 'lightgreen' : '#ff325a';
  const pctColor = isUp ? (isDark ? '#86efac' : '#166534') : (isDark ? '#fecaca' : '#991b1b');

  // prediction pill
  const bucket = getPredictionBucket(player.progress_tonight, player.per_hour);
  const tag = (() => {
    if (bucket === 'tonight_up')   return { label: 'Tonight', style: s.tagTonightUp,   arrow: assetImages.up };
    if (bucket === 'tonight_down') return { label: 'Tonight', style: s.tagTonightDown, arrow: assetImages.down };
    if (bucket === 'tomorrow_up' || bucket === 'tomorrow_down')
      return { label: 'Tomorrow', style: s.tagTomorrow, arrow: null };
    return { label: '>2d', style: s.tagLater, arrow: null };
  })();
  const tagTextColor = isDark ? '#e6eefc' : '#0f172a';

  return (
    <TouchableOpacity onPress={onOpen} activeOpacity={0.9} style={s.row}>
      {/* LEFT: crest + name + meta */}
      <View style={s.cellInfo}>
        <ClubCrest id={player.team_code} style={s.crest} resizeMode="contain" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.name} numberOfLines={1}>{player.name}</Text>
          <Text style={s.meta} numberOfLines={1}>
            {player.type} · £{player.cost.toFixed(1)} · {player.team}
          </Text>
        </View>
      </View>

      {/* MIDDLE: bar + % on one line */}
      <View style={s.cellProg}>
        <View style={s.progLine}>
          <View style={s.progWrap}>
            <View style={s.track}>
              <View style={[s.fill, { width: widthPct, backgroundColor: barColor }]} />
            </View>
          </View>
          <Text style={[s.pctTxt, { color: pctColor }]} numberOfLines={1}>
            {pctSigned(prog)}
          </Text>
        </View>
      </View>

      {/* RIGHT: pill over star */}
      <View style={s.cellRight}>
        <View style={[s.tagBox, tag.style]}>
          {tag.arrow && <Image source={tag.arrow} style={s.arrow} />}
          <Text style={[s.tagTxt, { color: tagTextColor }]}>{tag.label}</Text>
        </View>

        <TouchableOpacity
          onPress={() => onToggleStar(player)}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          style={s.starHit}
          accessibilityRole="button"
          accessibilityLabel={starred ? 'Remove from Watchlist' : 'Add to Watchlist'}
        >
          <FontAwesome
            name={starred ? 'star' : 'star-o'}
            size={18}
            color={starred ? '#facc15' : (isDark ? '#94a3b8' : '#64748b')}
          />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
};





const CompactCard = ({ player, starred, onToggleStar, onOpen, C, isDark }) => {
  const s = useMemo(() => makeCardStyles(C, isDark), [C, isDark]);
  return (
    <TouchableOpacity onPress={onOpen} activeOpacity={0.9} style={s.row}>
      <ClubCrest id={player.team_code} style={s.crest} resizeMode="contain" />

      <View style={s.main}>
        <View style={s.topLine}>
          <Text style={s.name} numberOfLines={1}>{player.name}</Text>

          <View style={s.topRight}>
            <View style={s.statusPillWrap}>
              <StatusPill bucket={player.bucket} styles={s} isDark={isDark} />
            </View>

            <TouchableOpacity
              onPress={() => onToggleStar(player)}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              style={s.starBtn}
              accessibilityRole="button"
              accessibilityLabel={starred ? 'Remove from Watchlist' : 'Add to Watchlist'}
            >
              <FontAwesome
                name={starred ? 'star' : 'star-o'}
                size={16}
                color={starred ? '#facc15' : (isDark ? '#94a3b8' : '#64748b')}
              />
            </TouchableOpacity>
          </View>
        </View>

        <View style={s.bottomLine}>
          <Text style={s.meta} numberOfLines={1}>
            {player.type} · £{player.cost.toFixed(1)} · {player.team}
          </Text>
          <InlineProgress value={player.progress} styles={s} isDark={isDark} />
        </View>
      </View>
    </TouchableOpacity>
  );
};

/* ───────── Tiny filter components ───────── */
const chipS = StyleSheet.create({
  base: { height: 40,borderRadius: 999, paddingVertical: 0,justifyContent: 'center',  paddingHorizontal: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  txt: { fontWeight: '800', fontSize: 12 },
});

const MiniSelectModal = ({ visible, title, options, selected, onSelect, onClose, C, isDark }) => (
  <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.45)', justifyContent:'center', alignItems:'center' }}>
      <View style={{
        width:'92%', maxHeight:'70%', borderRadius:16, padding:12,
        backgroundColor: isDark ? '#0b1224' : '#fff',
        borderWidth:1, borderColor: isDark ? '#1e2638' : '#e2e8f0'
      }}>
        <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
          <Text style={{ fontWeight:'900', color: isDark ? '#e6eefc' : '#0f172a' }}>{title}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top:8,bottom:8,left:8,right:8 }}>
            <Text style={{ fontSize:18, color: isDark ? '#cbd5e1' : '#334155' }}>✕</Text>
          </TouchableOpacity>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled">
          {options.map(opt => {
            const active = selected === opt.value || (selected == null && opt.value == null);
            return (
              <TouchableOpacity key={String(opt.value ?? 'all')} onPress={() => { onSelect(opt.value ?? null); onClose(); }} activeOpacity={0.85}>
                <View style={{
                  paddingVertical:10, paddingHorizontal:10,
                  borderTopWidth:1, borderColor: isDark ? '#1e2638' : '#e2e8f0',
                  backgroundColor: active ? (isDark ? '#1b2a4a' : '#dbeafe') : 'transparent'
                }}>
                  <Text style={{ fontWeight: active ? '900' : '700', color: active ? '#0f172a' : (isDark ? '#e6eefc' : '#0f172a') }}>
                    {opt.label}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </View>
  </Modal>
);

const FilterPill = ({ label, active, onPress, C, isDark }) => (
  <TouchableOpacity onPress={onPress} activeOpacity={0.85} hitSlop={{ top:6,bottom:6,left:6,right:6 }}>
    <View style={[
      chipS.base,
      active
        ? (isDark ? { backgroundColor: '#1b2a4a', borderColor: '#3b82f6' } : { backgroundColor: '#3b82f6', borderColor: '#3b82f6' })
        : { backgroundColor: isDark ? '#0b1224' : '#ffffff', borderColor: isDark ? '#1e2638' : '#e2e8f0' }
    ]}>
      <Text style={[chipS.txt, { color: active ? '#ffffff' : (isDark ? '#e6eefc' : '#0f172a') }]}>{label}</Text>
    </View>
  </TouchableOpacity>
);

/* Search with suggestions — half width */
const SearchBarWithSuggestions = ({ query, onChange, suggestions, onPick, C, isDark }) => (
  <View style={{ width: '40%' }}>
    <ThemedTextInput
      value={query}
      onChangeText={onChange}
      placeholder="Search players"
      placeholderTextColor={C.placeholder || (isDark ? '#93a4bf' : '#94a3b8')}
      style={{
        height: 40, borderWidth: 1, borderColor: isDark ? C.inputBorder : '#e2e8f0',
        backgroundColor: isDark ? C.inputBg : '#ffffff', color: isDark ? C.ink : '#0f172a',
        paddingHorizontal: 12, borderRadius: 10
      }}
      returnKeyType="search"
      onSubmitEditing={() => Keyboard.dismiss()}
    />
    {query?.trim().length > 1 && suggestions?.length > 0 && (
      <View style={{
        width: '100%',
        marginTop: 6, borderWidth: 1, borderColor: isDark ? C.border2 : '#e2e8f0',
        backgroundColor: isDark ? C.card : '#ffffff', borderRadius: 10, overflow: 'hidden', maxHeight: 240
      }}>
        <ScrollView keyboardShouldPersistTaps="handled">
          {suggestions.slice(0, 12).map((p, i) => (
            <TouchableOpacity
              key={`${p._el}|sugg`}
              activeOpacity={0.85}
              onPress={() => onPick?.(p)}
            >
              <View
                style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8,
                  borderTopWidth: i === 0 ? 0 : 1, borderColor: isDark ? C.border : '#f1f5f9' }}
              >
                <ClubCrest id={p.team_code} style={{ width: 18, height: 18, marginRight: 8 }} resizeMode="contain" />
                <Text style={{ flex: 1, color: isDark ? C.ink : '#0f172a' }} numberOfLines={1}>{p.name}</Text>
                <Text style={{ color: isDark ? C.muted : '#64748b' }}>£{p.cost.toFixed(1)}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    )}
  </View>
);

/* ───────── Clean Details Modal (drop-in) ───────── */
const sheetS = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  card: {
    width: '100%',
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
  },
  crestWrap: {
    width: 40, height: 40, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  titleBox: { flex: 1, minWidth: 0, marginLeft: 10 },
  name: { fontSize: 16, fontWeight: '900' },
  sub: { marginTop: 2, fontSize: 12, fontWeight: '600' },

  chipRow: {
    paddingHorizontal: 14,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  chip: {
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1,
  },
  chipTxt: { fontSize: 11, fontWeight: '800' },

  section: { paddingHorizontal: 14, paddingVertical: 10 },
  sectionHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8,
  },
  headTxt: { fontSize: 13, fontWeight: '900' },
  headSub: { fontSize: 11, fontWeight: '700' },

  track: { height: 12, borderRadius: 8, overflow: 'hidden', borderWidth: 1 },
  goal: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 2 },
  fill: { height: '100%' },

  statRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  statBox: {
    flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12,
  },
  statLabel: { fontSize: 11, fontWeight: '800', opacity: 0.9 },
  statValue: { marginTop: 4, fontSize: 16, fontWeight: '900' },

  footerRow: {
    paddingHorizontal: 14, paddingTop: 6, paddingBottom: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  actionBtn: {
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, flexDirection: 'row', gap: 8, alignItems: 'center',
  },
  actionTxt: { fontSize: 12, fontWeight: '900' },
});

const pct = (n) => `${(Number(n||0)*100).toFixed(2)}%`;

const bucketMeta = (bucket) => {
  if (bucket === 'tonight_up')   return { title: 'Likely Rise',     sub: 'Tonight',   icon: assetImages.up };
  if (bucket === 'tonight_down') return { title: 'Likely Fall',     sub: 'Tonight',   icon: assetImages.down };
  if (bucket === 'tomorrow_up')  return { title: 'Potential Rise',  sub: 'Tomorrow',  icon: assetImages.up };
  if (bucket === 'tomorrow_down')return { title: 'Potential Fall',  sub: 'Tomorrow',  icon: assetImages.down };
  return { title: 'Not Imminent', sub: '> 2 days', icon: null };
};

const PriceDetailsModal = ({ visible, onClose, player, starred, onToggleStar, C, isDark }) => {
  if (!player) return null;
  const bucket = getPredictionBucket(player.progress_tonight, player.per_hour);
  const meta = bucketMeta(bucket);

  const bg = isDark ? '#0b1224' : '#ffffff';
  const br = isDark ? '#1e2638' : '#e2e8f0';
  const ink = isDark ? C.ink : '#0f172a';
  const muted = isDark ? C.muted : '#64748b';
  const strip = isDark ? '#0f1525' : '#f8fafc';

  const progNow = Number(player.progress) || 0;
  const progTonight = Number(player.progress_tonight) || 0;
  const perHr = Number(player.per_hour) || 0;

  const nowFill = Math.min(1, Math.max(0, Math.abs(progNow))) * 100;
  const tonightFill = Math.min(1, Math.max(0, Math.abs(progTonight))) * 100;

  const upColor = isDark ? '#16a34a' : '#16a34a';
  const downColor = isDark ? '#ef4444' : '#ef4444';
  const barBg = isDark ? '#0b1224' : '#eef2f7';
  const barBr = isDark ? '#1b2642' : '#cbd5e1';
  const goalCol = isDark ? '#334155' : '#94a3b8';

  const fillNowCol = progNow >= 0 ? upColor : downColor;
  const fillTonightCol = progTonight >= 0 ? upColor : downColor;
  const valueNowCol = progNow >= 0 ? (isDark ? '#86efac' : '#166534') : (isDark ? '#fecaca' : '#991b1b');
  const valueTonightCol = progTonight >= 0 ? (isDark ? '#86efac' : '#166534') : (isDark ? '#fecaca' : '#991b1b');

  const chipStyle = (activeBg, activeBr) => ([
    sheetS.chip,
    { backgroundColor: activeBg, borderColor: activeBr }
  ]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={sheetS.overlay}>
        <View style={[sheetS.card, { backgroundColor: bg, borderColor: br }]}>
          {/* Header */}
          <View style={[sheetS.headerRow, { backgroundColor: strip, borderBottomWidth: 1, borderColor: br }]}>
            <View style={[sheetS.crestWrap, { borderColor: br, backgroundColor: isDark ? '#0b1224' : '#fff' }]}>
              <ClubCrest id={player.team_code} style={{ width: 28, height: 28 }} resizeMode="contain" />
            </View>
            <View style={sheetS.titleBox}>
              <Text style={[sheetS.name, { color: ink }]} numberOfLines={1}>{player.name}</Text>
              <Text style={[sheetS.sub, { color: muted }]} numberOfLines={1}>
                {player.type} · £{player.cost.toFixed(1)} · {player.team}
              </Text>
            </View>

            {/* Star + Close */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TouchableOpacity
                onPress={() => onToggleStar(player)}
                style={[sheetS.actionBtn, { borderColor: br, backgroundColor: isDark ? '#0b1224' : '#ffffff' }]}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={starred ? 'Remove from Watchlist' : 'Add to Watchlist'}
              >
                <FontAwesome
                  name={starred ? 'star' : 'star-o'}
                  size={16}
                  color={starred ? '#facc15' : (isDark ? '#94a3b8' : '#64748b')}
                />
                <Text style={[sheetS.actionTxt, { color: ink }]}>{starred ? 'Watching' : 'Watch'}</Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={{ fontSize: 20, color: muted }}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Chips row (status + quick facts) */}
          <View style={sheetS.chipRow}>
            <View style={chipStyle(isDark ? '#1b2a4a' : '#dbeafe', isDark ? C.accent : '#93c5fd')}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {meta.icon && <Image source={meta.icon} style={{ width: 12, height: 12, resizeMode: 'contain' }} />}
                <Text style={[sheetS.chipTxt, { color: ink }]}>{meta.title}</Text>
                <Text style={[sheetS.chipTxt, { color: muted }]}>· {meta.sub}</Text>
              </View>
            </View>

            <View style={chipStyle(isDark ? '#0b1224' : '#ffffff', br)}>
              <Text style={[sheetS.chipTxt, { color: muted }]}>Trend</Text>
              <Text style={[sheetS.chipTxt, { color: ink }]}>{pct(perHr)}/h</Text>
              
            </View>

            <View style={chipStyle(isDark ? '#0b1224' : '#ffffff', br)}>
              <Text style={[sheetS.chipTxt, { color: muted }]}>Now</Text>
              <Text style={[sheetS.chipTxt, { color: progNow >= 0 ? valueNowCol : valueNowCol }]}>{pct(progNow)}</Text>
            </View>

            <View style={chipStyle(isDark ? '#0b1224' : '#ffffff', br)}>
              <Text style={[sheetS.chipTxt, { color: muted }]}>at 01:30 UTC</Text>
              <Text style={[sheetS.chipTxt, { color: progTonight >= 0 ? valueTonightCol : valueTonightCol }]}>{pct(progTonight)}</Text>
            </View>
          </View>

          {/* Now bar */}
          <View style={sheetS.section}>
            <View style={sheetS.sectionHead}>
              <Text style={[sheetS.headTxt, { color: ink }]}>Progress (Now)</Text>
              <Text style={[sheetS.headSub, { color: valueNowCol }]}>{pct(progNow)}</Text>
            </View>
            <View style={[sheetS.track, { backgroundColor: barBg, borderColor: barBr }]}>
              <View style={[sheetS.goal, { backgroundColor: goalCol }]} />
              <View style={[sheetS.fill, { width: `${nowFill}%`, backgroundColor: fillNowCol }]} />
            </View>

            <View style={sheetS.statRow}>
              <View style={[sheetS.statBox, { borderColor: br, backgroundColor: isDark ? '#0f172a' : '#f8fafc' }]}>
                <Text style={[sheetS.statLabel, { color: muted }]}>Direction</Text>
                <Text style={[sheetS.statValue, { color: fillNowCol }]}>{progNow >= 0 ? 'Upwards' : 'Downwards'}</Text>
              </View>
              <View style={[sheetS.statBox, { borderColor: br, backgroundColor: isDark ? '#0f172a' : '#f8fafc' }]}>
                <Text style={[sheetS.statLabel, { color: muted }]}>Distance to Threshold</Text>
                <Text style={[sheetS.statValue, { color: ink }]}>
                  {progNow >= 0 ? `${(100 - nowFill).toFixed(0)}%` : `${(100 - nowFill).toFixed(0)}%`}
                </Text>
              </View>
            </View>
          </View>

          {/* Tonight bar */}
          <View style={[sheetS.section, { paddingTop: 2 }]}>
            <View style={sheetS.sectionHead}>
              <Text style={[sheetS.headTxt, { color: ink }]}>Projection (at 01:30 UTC)</Text>
              <Text style={[sheetS.headSub, { color: valueTonightCol }]}>{pct(progTonight)}</Text>
            </View>
            <View style={[sheetS.track, { backgroundColor: barBg, borderColor: barBr }]}>
              <View style={[sheetS.goal, { backgroundColor: goalCol }]} />
              <View style={[sheetS.fill, { width: `${tonightFill}%`, backgroundColor: fillTonightCol }]} />
            </View>
          </View>

          {/* Footer actions */}
          <View style={[sheetS.footerRow, { borderTopWidth: 1, borderColor: br }]}>
            <Text style={{ color: muted, fontSize: 11 }}>
              100% ≈ price change threshold. Green = likely rise, red = likely fall.
            </Text>
           
          </View>
        </View>
      </View>
    </Modal>
  );
};


/* ───────── Help Modal ───────── */
const HelpModal = ({ visible, onClose, C, isDark }) => (
  <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <View style={{ flex:1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent:'center', alignItems:'center' }}>
      <View style={{
        width: '92%', borderRadius: 16, padding: 16,
        backgroundColor: isDark ? '#0b1224' : '#ffffff',
        borderWidth: 1, borderColor: isDark ? '#1e2638' : '#e2e8f0'
      }}>
        <Text style={{ color: isDark ? '#e6eefc' : '#0f172a', fontWeight: '900', fontSize: 16, marginBottom: 8 }}>How it works</Text>
        <Text style={{ color: isDark ? '#cbd5e1' : '#334155', marginBottom: 8 }}>
          • Predictions are based on transfer trends. Moves usually process around <Text style={{ fontWeight: '800' }}>01:30 UTC</Text>.
        </Text>
        <Text style={{ color: isDark ? '#cbd5e1' : '#334155', marginBottom: 8 }}>
          • 100% ≈ very close to a price change. Watchlist to track players.
        </Text>
        <Text style={{ color: isDark ? '#cbd5e1' : '#334155' }}>
          • Use My Team (synced from Rank) to focus on your squad.
        </Text>

        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 14, gap: 16 }}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={{ color: C.accent || '#6366f1', fontWeight: '800' }}>Got it</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  </Modal>
);

/* ───────── Tabs ───────── */
const Tabs = ({ value, onChange, C, isDark }) => {
  const Tab = ({ id, label }) => {
    const active = value === id;
    return (
      <TouchableOpacity
        onPress={() => onChange(id)}
        activeOpacity={0.85}
        style={{ flex: 1 }}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <View style={{ paddingVertical: 10, borderBottomWidth: 3, borderColor: active ? (C.accent || '#6366f1') : 'transparent', backgroundColor: isDark ? '#0f172a' : '#f1f5f9', alignItems: 'center' }}>
          <Text style={{ fontWeight: '800', color: isDark ? '#e6eefc' : '#0f172a' }}>{label}</Text>
        </View>
      </TouchableOpacity>
    );
  };
  return (
    <View style={{ zIndex: 5, flexDirection: 'row', borderBottomWidth: 1, borderColor: isDark ? '#1e2638' : '#e2e8f0', borderTopLeftRadius: 10, borderTopRightRadius: 10, overflow: 'hidden' }}>
      <Tab id="overview" label="All Players" />
      <Tab id="watchlist" label="Watchlist" />
      <Tab id="myteam" label="My Team" />
    </View>
  );
};

/* ───────── Summary Table ───────── */
/* ───────── Summary Table ───────── */
const SummaryTable = ({ up, down, maybe = [], onOpen, C, isDark, eoMap, eoCutoff = EO_CUTOFF }) => {
  const Row = ({ p, dir }) => {
    const d = dir || p._dir || 'up';
    return (
      <TouchableOpacity
        onPress={() => onOpen(p)}
        activeOpacity={0.85}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 8,
          paddingHorizontal: 10,
          borderTopWidth: 1,
          borderColor: isDark ? C.border2 : '#e2e8f0',
        }}
      >
        <ClubCrest id={p.team_code} style={{ width: 18, height: 18, marginRight: 8 }} resizeMode="contain" />
        <Text style={{ flex: 1, color: isDark ? C.ink : '#0f172a' }} numberOfLines={1}>{p.name}</Text>
        <Text style={{ marginRight: 8, color: isDark ? C.muted : '#64748b' }}>£{p.cost.toFixed(1)}</Text>
        <Image source={(d === 'down') ? assetImages.down : assetImages.up} style={{ width: 12, height: 12 }} />
      </TouchableOpacity>
    );
  };

  const getEO = (p) => (eoMap instanceof Map ? (eoMap.get(Number(p.id)) || 0) : 100);
  const sortByProgress = (dir) => (a, b) => {
    const pa = Number(a.progress) || 0;
    const pb = Number(b.progress) || 0;
    return dir === 'down' ? pa - pb : pb - pa;
  };

  // Split falls into shown/hidden by EO cutoff (only for 'down')
  const splitAndSort = (list, dir) => {
    const show = [], hide = [];
    for (const p of list) ((dir === 'down' && getEO(p) < eoCutoff) ? hide : show).push(p);
    show.sort(sortByProgress(dir));
    hide.sort(sortByProgress(dir));
    return [show, hide];
  };

  // Build sections
  const upSorted      = [...up].sort(sortByProgress('up'));
  const maybeUp       = Array.isArray(maybe) ? maybe.filter(m => (m._dir || 'up') === 'up') : [];
  const maybeDown     = Array.isArray(maybe) ? maybe.filter(m => (m._dir || 'up') === 'down') : [];

  const [downShownMain, downHiddenMain]   = splitAndSort(down, 'down');
  const [maybeShownDown, maybeHiddenDown] = splitAndSort(maybeDown, 'down');

  // Local state for two toggles
  const [openHidden, setOpenHidden] = React.useState({ main:false, maybe:false });

  const Toggle = ({ open, onPress, count }) =>
    count > 0 ? (
      <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
        <View style={{ paddingVertical: 8, alignItems: 'center' }}>
          <Text style={{ color: isDark ? C.ink : '#0f172a' }}>
            {open ? 'Hide low owned' : `Show low owned (${count})`}
          </Text>
        </View>
      </TouchableOpacity>
    ) : null;

  const Card = ({ title, children }) => (
    <View
      style={{
        flex: 1,
        borderWidth: 1,
        borderColor: isDark ? C.border2 : '#e2e8f0',
        backgroundColor: isDark ? C.card : '#fff',
        borderRadius: 12,
        overflow: 'hidden'
      }}
    >
      <View
        style={{
          paddingVertical: 8,
          paddingHorizontal: 10,
          borderBottomWidth: 1,
          borderColor: isDark ? C.border2 : '#e2e8f0',
          backgroundColor: isDark ? C.stripBg : '#f8fafc'
        }}
      >
        <Text style={{ fontWeight: '800', color: isDark ? C.ink : '#0f172a' }}>{title}</Text>
      </View>
      {children}
    </View>
  );

  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      {/* Rises */}
      <Card title={`Predicted Rises tonight (${upSorted.length})`}>
        {upSorted.length === 0 ? (
          <View style={{ padding: 10 }}>
            <Text style={{ color: isDark ? C.muted : '#64748b' }}>None</Text>
          </View>
        ) : (
          upSorted.map((p) => <Row key={`up-${p._el}`} p={p} dir="up" />)
        )}

        <View style={{ height: 6, backgroundColor: isDark ? '#0f172a' : '#f8fafc' }} />

        <View style={{ paddingVertical: 6, paddingHorizontal: 10 }}>
          <Text style={{ fontWeight: '800', color: isDark ? C.ink : '#0f172a' }}>
            Maybe (≥95%){maybeUp.length ? ` (${maybeUp.length})` : ''}
          </Text>
        </View>

        {maybeUp.length === 0 ? (
          <View style={{ padding: 10, paddingTop: 0 }}>
            <Text style={{ color: isDark ? C.muted : '#64748b' }}>None</Text>
          </View>
        ) : (
          maybeUp.map((p) => <Row key={`maybe-up-${p._el}`} p={p} dir="up" />)
        )}
      </Card>

      {/* Falls */}
      <Card title={`Predicted Falls tonight (${down.length})`}>
        {/* Main falls: shown */}
        {downShownMain.length === 0 ? (
          <View style={{ padding: 10 }}>
            <Text style={{ color: isDark ? C.muted : '#64748b' }}>None Highly Owned</Text>
          </View>
        ) : (
          downShownMain.map((p) => <Row key={`down-s-${p._el}`} p={p} dir="down" />)
        )}

        {/* Main falls: hidden (when open) */}
        {openHidden.main && downHiddenMain.map((p) => <Row key={`down-h-${p._el}`} p={p} dir="down" />)}

        {/* Main falls: toggle AT BOTTOM */}
        <Toggle
          open={openHidden.main}
          onPress={() => setOpenHidden((s) => ({ ...s, main: !s.main }))}
          count={downHiddenMain.length}
        />

        <View style={{ height: 6, backgroundColor: isDark ? '#0f172a' : '#f8fafc' }} />

        {/* Maybe header */}
        <View style={{ paddingVertical: 6, paddingHorizontal: 10 }}>
          <Text style={{ fontWeight: '800', color: isDark ? C.ink : '#0f172a' }}>
            Maybe (≥95%){maybeDown.length ? ` (${maybeDown.length})` : ''}
          </Text>
        </View>

        {/* Maybe (down): shown */}
        {maybeShownDown.length === 0 ? (
          <View style={{ padding: 10, paddingTop: 0 }}>
            <Text style={{ color: isDark ? C.muted : '#64748b' }}>None Highly Owned</Text>
          </View>
        ) : (
          maybeShownDown.map((p) => <Row key={`maybe-down-s-${p._el}`} p={p} dir="down" />)
        )}

        {/* Maybe (down): hidden (when open) */}
        {openHidden.maybe && maybeHiddenDown.map((p) => <Row key={`maybe-down-h-${p._el}`} p={p} dir="down" />)}

        {/* Maybe (down): toggle AT BOTTOM */}
        <Toggle
          open={openHidden.maybe}
          onPress={() => setOpenHidden((s) => ({ ...s, maybe: !s.maybe }))}
          count={maybeHiddenDown.length}
        />
      </Card>
    </View>
  );
};


/* ───────── View mode toggle ───────── */
const ViewModeToggle = ({ mode, onChange, disabled, C, isDark ,compact=false}) => {
  const Base = ({ id, label }) => {
    const active = mode === id;
    return (
      <TouchableOpacity
        onPress={() => !disabled && onChange(id)}
        activeOpacity={disabled ? 1 : 0.85}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        style={{
          borderRadius: 999,
          paddingVertical: 6,
          paddingHorizontal: 12,
          borderWidth: 1,
          opacity: disabled ? 0.5 : 1,
          backgroundColor: active ? (isDark ? C.accentPillBg : C.accent) : (isDark ? C.card : '#fff'),
          borderColor: active ? C.accent : (isDark ? C.border2 : '#e2e8f0'),
          marginRight: 8,
        }}
      >
        <Text style={{ fontWeight: '800', fontSize: 12, color: active ? (C.accentOn || '#fff') : (isDark ? C.ink : '#0f172a') }}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: compact ? 0 : 8, marginBottom: compact ? 0 : 4 }}>
      <Base id="list" label="List view" />
      <Base id="summary" label="Summary" />
    </View>
  );
};
const getListComparator = (mode, dir = 'desc') => {
  if (mode === 'time') return defaultPriceSort;

  // "target": sort by progress_tonight signed; then by |progress|; then name
  return (a, b) => {
    const ap = Number(a.progress_tonight) || 0;
    const bp = Number(b.progress_tonight) || 0;

    // primary: signed progress_tonight
    if (ap !== bp) return dir === 'asc' ? ap - bp : bp - ap;

    // secondary: tonight movement magnitude (bigger first)
    const at = Math.abs(Number(a.progress) || 0);
    const bt = Math.abs(Number(b.progress) || 0);
    if (at !== bt) return bt - at;

    // tie: name
    return String(a.name).localeCompare(String(b.name));
  };
};



/* ───────── Overview ───────── */
function OverviewTab({
  data, ui, actions, searchQuery, setSearchQuery, onSearchChange,
  showHelp, setShowHelp,
  viewMode, setViewMode,sortMode, setSortMode,sortDir, setSortDir,
}) {
  const { C, isDark } = ui; const { players, eoMap, onlyAbove1Pct } = data; const { toggleWatch } = actions;
  const [open, setOpen] = useState(null);
const [showSort, setShowSort] = useState(false);
  // Position & Team filters (always visible)
  const [posFilter, setPosFilter] = useState(null);
  const [teamFilter, setTeamFilter] = useState(null);
  const [showPos, setShowPos] = useState(false);
  const [showTeam, setShowTeam] = useState(false);

  const suggestions = useMemo(() => {
    const q = fold(searchQuery.trim()); if (!q) return [];
    return players.filter((p) => p._nameFold.includes(q) || p._teamFold.includes(q) || p._typeFold.includes(q)).slice(0, 20);
  }, [players, searchQuery]);
const sortOptions = useMemo(() => ([
   { label: 'Time (Tonight first)', value: { mode:'time', dir:'desc' } },
   { label: 'Target — Rises first', value: { mode:'target', dir:'desc' } },
   { label: 'Target — Falls first',  value: { mode:'target', dir:'asc'  } },
 ]), []);

 const currentSortLabel = useMemo(() => {
   if (sortMode === 'time') return 'Sort: Time';
   return `Sort: ${sortDir === 'desc' ? 'Rises' : 'Falls'}`;
 }, [sortMode, sortDir]);

// When switching to Summary: clear filters (and search) so the summary actually renders
  const handleViewModeChange = (id) => {
    if (id === 'summary') {
      setPosFilter(null);
      setTeamFilter(null);
      if (searchQuery.trim().length > 0) setSearchQuery('');
      Keyboard.dismiss();
    }
    setViewMode(id);
  };
  const withBuckets = useMemo(() => players.map((p) => ({ ...p, bucket: getPredictionBucket(p.progress_tonight, p.per_hour) })), [players]);

  // Options
  const posOptions = useMemo(() => {
    const set = new Set();
    withBuckets.forEach(p => { if (p.type) set.add(String(p.type)); });
    return [{ label: 'All Positions', value: null }, ...Array.from(set).sort(posSort).map(t => ({ label: t, value: t }))];
  }, [withBuckets]);

  const teamOptions = useMemo(() => {
    const set = new Set();
    withBuckets.forEach(p => { if (p.team) set.add(String(p.team)); });
    return [{ label: 'All Clubs', value: null }, ...Array.from(set).sort().map(t => ({ label: t, value: t }))];
  }, [withBuckets]);

  // Summary lists (unfiltered)
  const tonightUpAll = useMemo(() => withBuckets.filter((p) => p.bucket === 'tonight_up'), [withBuckets]);
  const tonightDownAll = useMemo(() => withBuckets.filter((p) => p.bucket === 'tonight_down'), [withBuckets]);
  const maybeTonightAll = useMemo(
    () =>
      withBuckets
        .filter((p) => {
          const x = Number(p.progress_tonight) || 0;
          const a = Math.abs(x);
          return a >= MAYBE_THRESHOLD && a < 1;
        })
        .map((p) => ({ ...p, _dir: (p.progress_tonight >= 0 ? 'up' : 'down') })),
    [withBuckets]
  );

  // List dataset (filters apply)
  const filtered = useMemo(() => {
    let arr = withBuckets;

 
    // Hide low-owned:
    //  - If user enabled EO>1% (onlyAbove1Pct), OR
    //  - Always when sorting Target ↓ (positives first) — chip is hidden+disabled in this mode
    const forceHideLowEO = sortMode === 'target' && sortDir === 'desc';
    if (viewMode === 'list' && eoMap instanceof Map && data.onlyAbove1Pct &&  !forceHideLowEO) {
      arr = arr.filter((p) => (eoMap.get(Number(p.id)) || 0) >= EO_CUTOFF || p.progress_tonight > 0);
    }


    if (posFilter)  arr = arr.filter(p => String(p.type) === posFilter);
    if (teamFilter) arr = arr.filter(p => String(p.team) === teamFilter);

    const searching = searchQuery.trim().length > 0;
    if (searching) {
      const q = fold(searchQuery.trim());
      arr = arr.filter((p) => p._nameFold.includes(q) || p._teamFold.includes(q) || p._typeFold.includes(q));
    }
    return arr.sort(getListComparator(sortMode,sortDir));
  }, [withBuckets, eoMap, data.onlyAbove1Pct, viewMode, posFilter, teamFilter, searchQuery,sortMode,sortDir]);

  // Picking a suggestion -> open details, clear search
  const handlePickSuggestion = (p) => {
    setOpen(p);
    setSearchQuery('');
    Keyboard.dismiss();
  };

  // When opening pickers from Summary, switch to List first (and then open)
  const openPosPicker = () => {
    if (viewMode === 'summary') setViewMode('list');
    setShowPos(true);
  };
  const openTeamPicker = () => {
    if (viewMode === 'summary') setViewMode('list');
    setShowTeam(true);
  };

  // When a selection is made in the modal, enforce list view (per spec)
  const onSelectPos = (val) => {
    setViewMode('list');
    setPosFilter(val);
  };
  const onSelectTeam = (val) => {
    setViewMode('list');
    setTeamFilter(val);
  };

  /* ─ Top Controls Row (View toggle LEFT; right side: Hide low-owned (list only) + Help) ─ */
  const TopBar = (
    <View style={{ flexDirection:'row', alignItems:'center', gap:8, marginBottom:6 }}>
      {/* Left: view toggle */}
      <ViewModeToggle mode={viewMode} onChange={handleViewModeChange} disabled={false} C={C} isDark={isDark} compact />
      {/* Spacer pushes the next items to the right */}
      <View style={{ flex:1 }} />
      {/* Right: hide low-owned (only in List view) */}
      {/* Right: buttons styled like ViewModeToggle pills */}
      {(() => {
        const Btn = ({ active=false, onPress, children }) => (
          <TouchableOpacity
            onPress={onPress}
            activeOpacity={0.85}
            hitSlop={{ top:6,bottom:6,left:6,right:6 }}
            style={{
              borderRadius: 999,
              paddingVertical: 6,
              paddingHorizontal: 12,
              borderWidth: 1,
               backgroundColor: active ? (isDark ? C.accentPillBg : C.accent) : (isDark ? C.card : '#fff'),
             borderColor: active ? C.accent : (isDark ? C.border2 : '#e2e8f0'),
           
              marginLeft: 4,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {children}
          </TouchableOpacity>
        );
         const showEOChip = viewMode === 'list' && !(sortMode === 'target' && sortDir === 'desc');
        return (
          <>
            {/* Sort dropdown (FIRST) */}
            {viewMode === 'list' && (
              <Btn onPress={() => setShowSort(true)}>
                <Text style={{ fontWeight:'800', fontSize:12, color: isDark ? C.ink : '#0f172a' }}>
                  {currentSortLabel}
                </Text>
              </Btn>
            )}

            {/* EO chip (SECOND) */}
            {showEOChip && (
              <Btn
                active={!!data.onlyAbove1Pct}
                onPress={() => data.setOnlyAbove1Pct(!data.onlyAbove1Pct)}
              >
                <Text style={{ fontWeight:'800', fontSize:12, color: !!data.onlyAbove1Pct ? (C.accentOn || '#fff') : (isDark ? C.ink : '#0f172a') }}>
                  EO >1%
                </Text>
             </Btn>
            )}

            {/* Help (THIRD) */}
            {viewMode !== 'list' && (
              <Btn onPress={() => setShowHelp(true)}>
                <FontAwesome name="question-circle" size={14} color={isDark ? C.ink : '#0f172a'} />
                <Text style={{ fontWeight:'800', fontSize:12, color: isDark ? C.ink : '#0f172a' }}>Help</Text>
              </Btn>
            )}
          </>
        );
         })()}
  </View>
);

  /* ─ Second Controls Row: Search (half width) + Position/Team pills to its right ─ */
  const SecondBar = (
    <View style={{ flexDirection:'row', alignItems:'flex-start', gap:8, marginBottom:6 }}>
      <SearchBarWithSuggestions
        query={searchQuery}
        onChange={(t) => {
          // If typing while in summary, auto-switch to list
          if (viewMode === 'summary' && t.trim().length > 0 && searchQuery.trim().length === 0) {
            setViewMode('list');
          }
          onSearchChange(t);
        }}
        suggestions={suggestions}
        onPick={handlePickSuggestion}
        C={C}
        isDark={isDark}
      />
      <View style={{ flex:1, flexDirection:'row', flexWrap:'wrap', gap:8, justifyContent:'flex-start' }}>
        <FilterPill
          label={posFilter ? String(posFilter) : 'All Positions'}
          active={!!posFilter}
          onPress={openPosPicker}
          C={C}
          isDark={isDark}
        />
        <FilterPill
          label={teamFilter ? String(teamFilter) : 'All Clubs'}
          active={!!teamFilter}
          onPress={openTeamPicker}
          C={C}
          isDark={isDark}
        />
      </View>
    </View>
  );


  return (
    <View style={{ flex: 1 }}>
      {TopBar}
      {SecondBar}

      <View style={{ height: 8 }} />
      {viewMode === 'summary' && searchQuery.trim().length === 0 && !posFilter && !teamFilter ? (
        <ScrollView
          style={{ flex: 1 }}
           minimumZoomScale={1}
   maximumZoomScale={4}
    bouncesZoom
    automaticallyAdjustContentInsets={false}
          contentContainerStyle={{ paddingBottom: BOTTOM_INSET }}
          refreshControl={<RefreshControl refreshing={data.refreshing} onRefresh={data.handleRefresh} />}
          alwaysBounceVertical
        >
          <SummaryTable
            up={tonightUpAll}
            down={tonightDownAll}
            maybe={maybeTonightAll}
            onOpen={(p) => setOpen(p)}
            C={C}
            isDark={isDark}
            eoMap={eoMap}
            eoCutoff={EO_CUTOFF}
          />
        </ScrollView>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={filtered}
          keyExtractor={(item) => String(item._el)}
          renderItem={({ item }) => (
            <TableRow
              player={item}
              starred={data.watchlist.has(item._pid)}
              onToggleStar={toggleWatch}
              onOpen={() => setOpen(item)}
              C={C}
              isDark={isDark}
            />
          )}
          contentContainerStyle={{ paddingBottom: BOTTOM_INSET }}
          refreshControl={<RefreshControl refreshing={data.refreshing} onRefresh={data.handleRefresh} />}
          keyboardShouldPersistTaps="handled"
        />
      )}

      {/* Modals */}
      <PriceDetailsModal
        visible={!!open}
        onClose={() => setOpen(null)}
        player={open}
        starred={open ? data.watchlist.has(open._pid) : false}
        onToggleStar={toggleWatch}
        C={C}
        isDark={isDark}
      />
      <MiniSelectModal
        visible={showPos}
        title="Filter by position"
        options={posOptions}
        selected={posFilter}
        onSelect={onSelectPos}
        onClose={() => setShowPos(false)}
        C={C}
        isDark={isDark}
      />
      <MiniSelectModal
        visible={showTeam}
        title="Filter by team"
        options={teamOptions}
        selected={teamFilter}
        onSelect={onSelectTeam}
        onClose={() => setShowTeam(false)}
        C={C}
        isDark={isDark}
      />
      <HelpModal visible={showHelp} onClose={() => setShowHelp(false)} C={C} isDark={isDark} />
         

  {/* Sort dropdown modal */}
  <MiniSelectModal
    visible={showSort}
    title="Sort by"
    options={sortOptions}
    selected={`${sortMode}:${sortDir}`}
    onSelect={(v) => {
      if (v?.mode) setSortMode(v.mode);
      if (v?.dir)  setSortDir(v.dir);
    }}
    onClose={() => setShowSort(false)}
    C={C}
    isDark={isDark}
  />

    </View>
  );
}

/* ───────── Watchlist (search + Position/Team) ───────── */
function WatchlistTab({ data, ui, actions, searchQuery, setSearchQuery, onSearchChange, goOverviewClearFilters,sortMode ,sortDir  }) {
  const { C, isDark } = ui; const { players, watchlist } = data; const { toggleWatch } = actions; const [open, setOpen] = useState(null);

  const [posFilter, setPosFilter] = useState(null);
  const [teamFilter, setTeamFilter] = useState(null);
  const [showPos, setShowPos] = useState(false);
  const [showTeam, setShowTeam] = useState(false);

  const onChange = (t) => { onSearchChange(t);  };

  const watched = useMemo(
    () => players.filter((p) => watchlist.has(p._pid)).map((p) => ({ ...p, bucket: getPredictionBucket(p.progress_tonight, p.per_hour) })),
    [players, watchlist]
  );

  const posOptions = useMemo(() => {
    const set = new Set();
    watched.forEach(p => { if (p.type) set.add(String(p.type)); });
    return [{ label: 'All Positions', value: null }, ...Array.from(set).sort(posSort).map(t => ({ label: t, value: t }))];
  }, [watched]);

  const teamOptions = useMemo(() => {
    const set = new Set();
    watched.forEach(p => { if (p.team) set.add(String(p.team)); });
    return [{ label: 'All Clubs', value: null }, ...Array.from(set).sort().map(t => ({ label: t, value: t }))];
  }, [watched]);

  const list = useMemo(() => {
    const q = fold(searchQuery.trim());
    let arr = watched;

    if (posFilter)  arr = arr.filter(p => String(p.type) === posFilter);
    if (teamFilter) arr = arr.filter(p => String(p.team) === teamFilter);

    if (q) {
      arr = arr.filter((p) => p._nameFold.includes(q) || p._teamFold.includes(q) || p._typeFold.includes(q));
    }
    return [...arr].sort(getListComparator(sortMode,sortDir));
  }, [watched, searchQuery, posFilter, teamFilter,sortMode,sortDir ]);

  const handlePickSuggestion = (p) => {
    setOpen(p);
    setSearchQuery('');
    Keyboard.dismiss();
  };

  return (
    <View style={{ flex: 1 }}>
      {/* Row: search + position/team to the right */}
      <View style={{ flexDirection:'row', alignItems:'flex-start', gap:8, marginBottom:6 }}>
        <SearchBarWithSuggestions
          query={searchQuery}
          onChange={onChange}
          suggestions={watched}
          onPick={handlePickSuggestion}
          C={C}
          isDark={isDark}
        />
        <View style={{ flex:1, flexDirection:'row', flexWrap:'wrap', gap:8, justifyContent:'flex-start' }}>
          <FilterPill
            label={posFilter ? String(posFilter) : 'All Positions'}
            active={!!posFilter}
            onPress={() => setShowPos(true)}
            C={C}
            isDark={isDark}
          />
          <FilterPill
            label={teamFilter ? String(teamFilter) : 'All Clubs'}
            active={!!teamFilter}
            onPress={() => setShowTeam(true)}
            C={C}
            isDark={isDark}
          />
        </View>
      </View>

      {watched.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 24 }}>
          <Text style={{ color: isDark ? '#93a4bf' : '#64748b' }}>Star players to follow price moves.</Text>
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={list}
          keyExtractor={(item) => String(item._el)}
          renderItem={({ item }) => (
            <TableRow
              player={item}
              starred={watchlist.has(item._pid)}
              onToggleStar={toggleWatch}
              onOpen={() => setOpen(item)}
              C={C}
              isDark={isDark}
            />
          )}
          contentContainerStyle={{ paddingBottom: BOTTOM_INSET }}
          keyboardShouldPersistTaps="handled"
        />
      )}

      <PriceDetailsModal
        visible={!!open}
        onClose={() => setOpen(null)}
        player={open}
        starred={open ? watchlist.has(open._pid) : false}
        onToggleStar={toggleWatch}
        C={C}
        isDark={isDark}
      />
      <MiniSelectModal
        visible={showPos}
        title="Filter by position"
        options={posOptions}
        selected={posFilter}
        onSelect={setPosFilter}
        onClose={() => setShowPos(false)}
        C={C}
        isDark={isDark}
      />
      <MiniSelectModal
        visible={showTeam}
        title="Filter by team"
        options={teamOptions}
        selected={teamFilter}
        onSelect={setTeamFilter}
        onClose={() => setShowTeam(false)}
        C={C}
        isDark={isDark}
      />
    </View>
  );
}

/* ───────── My Team (search + Position/Team) ───────── */
function MyTeamTab({ data, ui, actions, searchQuery, setSearchQuery, onSearchChange, goOverviewClearFilters,sortMode,sortDir   }) {
  const { C, isDark } = ui; const { players, myTeamIds, watchlist } = data; const { toggleWatch } = actions; const [open, setOpen] = useState(null);

  const [posFilter, setPosFilter] = useState(null);
  const [teamFilter, setTeamFilter] = useState(null);
  const [showPos, setShowPos] = useState(false);
  const [showTeam, setShowTeam] = useState(false);

  const onChange = (t) => { onSearchChange(t);  };

  const mine = useMemo(
    () => players.filter((p) => myTeamIds.has(Number(p.id))).map((p) => ({ ...p, bucket: getPredictionBucket(p.progress_tonight, p.per_hour) })),
    [players, myTeamIds]
  );

  const posOptions = useMemo(() => {
    const set = new Set();
    mine.forEach(p => { if (p.type) set.add(String(p.type)); });
    return [{ label: 'All Positions', value: null }, ...Array.from(set).sort(posSort).map(t => ({ label: t, value: t }))];
  }, [mine]);

  const teamOptions = useMemo(() => {
    const set = new Set();
    mine.forEach(p => { if (p.team) set.add(String(p.team)); });
    return [{ label: 'All Clubs', value: null }, ...Array.from(set).sort().map(t => ({ label: t, value: t }))];
  }, [mine]);

  const list = useMemo(() => {
    const q = fold(searchQuery.trim());
    let arr = mine;

    if (posFilter)  arr = arr.filter(p => String(p.type) === posFilter);
    if (teamFilter) arr = arr.filter(p => String(p.team) === teamFilter);

    if (q) {
      arr = arr.filter((p) => p._nameFold.includes(q) || p._teamFold.includes(q) || p._typeFold.includes(q));
    }
    return [...arr].sort(getListComparator(sortMode,sortDir));
  }, [mine, searchQuery, posFilter, teamFilter,sortMode,sortDir ]);

  const handlePickSuggestion = (p) => {
    setOpen(p);
    setSearchQuery('');
    Keyboard.dismiss();
  };

  return (
    <View style={{ flex: 1 }}>
      {/* Row: search + position/team to the right */}
      <View style={{ flexDirection:'row', alignItems:'flex-start', gap:8, marginBottom:6 }}>
        <SearchBarWithSuggestions
          query={searchQuery}
          onChange={onChange}
          suggestions={mine}
          onPick={handlePickSuggestion}
          C={C}
          isDark={isDark}
        />
        <View style={{ flex:1, flexDirection:'row', flexWrap:'wrap', gap:8, justifyContent:'flex-start' }}>
          <FilterPill
            label={posFilter ? String(posFilter) : 'All Positions'}
            active={!!posFilter}
            onPress={() => setShowPos(true)}
            C={C}
            isDark={isDark}
          />
          <FilterPill
            label={teamFilter ? String(teamFilter) : 'All Clubs'}
            active={!!teamFilter}
            onPress={() => setShowTeam(true)}
            C={C}
            isDark={isDark}
          />
        </View>
      </View>

      {mine.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 24 }}>
          <Text style={{ color: isDark ? '#93a4bf' : '#64748b' }}>Load your team from Rank (sync).</Text>
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={list}
          keyExtractor={(item) => String(item._el)}
          renderItem={({ item }) => (
            <TableRow
              player={item}
              starred={watchlist.has(item._pid)}
              onToggleStar={toggleWatch}
              onOpen={() => setOpen(item)}
              C={C}
              isDark={isDark}
            />
          )}
          contentContainerStyle={{ paddingBottom: BOTTOM_INSET }}
          keyboardShouldPersistTaps="handled"
        />
      )}

      <PriceDetailsModal
        visible={!!open}
        onClose={() => setOpen(null)}
        player={open}
        starred={open ? watchlist.has(open._pid) : false}
        onToggleStar={toggleWatch}
        C={C}
        isDark={isDark}
      />
      <MiniSelectModal
        visible={showPos}
        title="Filter by position"
        options={posOptions}
        selected={posFilter}
        onSelect={setPosFilter}
        onClose={() => setShowPos(false)}
        C={C}
        isDark={isDark}
      />
      <MiniSelectModal
        visible={showTeam}
        title="Filter by team"
        options={teamOptions}
        selected={teamFilter}
        onSelect={setTeamFilter}
        onClose={() => setShowTeam(false)}
        C={C}
        isDark={isDark}
      />
    </View>
  );
}

/* ───────── Main Screen ───────── */
export default function PricesV2() {
  const [sortMode, setSortMode] = useState('target'); // 'time' | 'target'
const [sortDir, setSortDir]   = useState('desc');   // 'desc' | 'asc'

  const baseC = useColors(); const theme = useTheme?.() || {};
  const isDark = (typeof theme.isDark === 'boolean') ? theme.isDark : detectDark(baseC.bg);
  const C = useMemo(() => ({
    ...baseC,
    accentPillBg: baseC.accentPillBg ?? (isDark ? '#1b2a4a' : '#dbeafe'),
    accentOn: baseC.accentOn ?? '#ffffff',
    whiteHi: baseC.whiteHi ?? '#e6eefc',
    whiteMd: baseC.whiteMd ?? '#cbd5e1',
    placeholder: baseC.placeholder ?? (isDark ? '#93a4bf' : '#94a3b8'),
  }), [baseC, isDark]);

  const data = usePricesData();

  useFocusEffect(
    useCallback(() => {
      data.handleRefresh();
    }, [data.handleRefresh])
  );

  const [tab, setTab] = useState('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('summary');
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const seen = await AsyncStorage.getItem(SEEN_HELP_KEY);
        if (!seen) {
          setShowHelp(true);
          AsyncStorage.setItem(SEEN_HELP_KEY, '1').catch(() => {});
        }
      } catch {}
    })();
  }, []);

  // If typing while on summary, switch to list (handled in OverviewTab onChange hook)
  const onSearchChange = (text) => {
    const prev = searchQuery; setSearchQuery(text);
    if (text.trim().length > 0 && prev.trim().length === 0) {
      if (data.onlyAbove1Pct) data.setOnlyAbove1Pct(false); // keep existing behavior of relaxing EO when initiating a search
      if (tab === 'overview' && viewMode === 'summary') {
       /* no-op: let OverviewTab flip to List */
     }
      // viewMode change is handled inside OverviewTab to ensure timing with UI state
    }
  };

  const handleTabChange = (id) => {
    Keyboard.dismiss();
    setSearchQuery('');
    setTab(id);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['left', 'right']}>
    <AppHeader />
      <View style={{ flex: 1}}>
        
        <View style={{ flex: 1, paddingHorizontal: 10 }}>
        

        <View style={{
          borderWidth: 1, borderColor: isDark ? '#1e2638' : '#e2e8f0',
          backgroundColor: isDark ? '#0f1525' : '#f8fafc',
          borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 8
        }}>
          

<Text style={{ color: isDark ? '#cbd5e1' : '#334155', fontSize: 12, textAlign: 'center' }}>
  Prices tend to move at{' '}<Text style={{ fontWeight: '800', color: isDark ? '#e6eefc' : '#0f172a' }}>01:30 UTC</Text>.

  {' '}Next window in <Text style={{ fontWeight: '800', color: isDark ? '#e6eefc' : '#0f172a' }}>{data.countdown}</Text>.

  
  {' '}Transfer trends & past changes at{' '}
  <Text onPress={() => Linking.openURL('https://www.livefpl.net/prices')}>
    www.livefpl.net/prices
  </Text>
</Text>

        </View>

        <Tabs value={tab} onChange={handleTabChange} C={C} isDark={isDark} />

        <View style={{ flex: 1, paddingTop: 8 }}>
          {tab === 'overview' && (
            <OverviewTab
            sortMode={sortMode} setSortMode={setSortMode}
            sortDir={sortDir}   setSortDir={setSortDir}
              data={data}
              ui={{ C, isDark }}
              actions={{ toggleWatch: data.toggleWatch }}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              onSearchChange={onSearchChange}
              showHelp={showHelp}
              setShowHelp={setShowHelp}
              viewMode={viewMode}
              setViewMode={setViewMode}
            />
          )}
          {tab === 'watchlist' && (
            <WatchlistTab
            sortMode={sortMode} setSortMode={setSortMode}
            sortDir={sortDir}   setSortDir={setSortDir}
              data={data}
              ui={{ C, isDark }}
              actions={{ toggleWatch: data.toggleWatch }}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              onSearchChange={onSearchChange}
              goOverviewClearFilters={() => { if (data.onlyAbove1Pct) data.setOnlyAbove1Pct(false); setTab('overview'); }}
            />
          )}
          {tab === 'myteam' && (
            <MyTeamTab
            sortMode={sortMode} setSortMode={setSortMode}
            sortDir={sortDir}   setSortDir={setSortDir}
              data={data}
              ui={{ C, isDark }}
              actions={{ toggleWatch: data.toggleWatch }}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              onSearchChange={onSearchChange}
              goOverviewClearFilters={() => { if (data.onlyAbove1Pct) data.setOnlyAbove1Pct(false); setTab('overview'); }}
            />
          )}
        </View>
      </View></View>
      <View style={{ height: BOTTOM_INSET }} />
    </SafeAreaView>
  );
}
