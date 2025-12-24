

// planner.js — rank-like pitch + action sheet + C/VC badges + sellOverrides
// Tap jersey -> actions (Cap, Vice, Transfer Out, Bench, Change Selling Price)
// Autosave + forward propagation of future GWs after edits
// Bench/XI swaps respected via user picks ordering
// NET transfer counting (no double-count if you re-buy same player)
// Bank & Hits from net squad difference
// "NEW" icon badge on right side of shirt
// Reset GW+ safe for current/future GWs
// *** Robust storage restore with GW pointer self-healing ***
// *** 2025-09 updates ***
// - FDR dark colors -> white text
// - Always-valid captain & vice (never equal, always present)
// - C/VC badges aligned; TC shows "TC" with golden border
// - Bench Boost shows bench on pitch; off -> back to bench row
// - Reset icon centered
// - Gameweek picker dropdown
// - Prev disabled at min GW
// - Transfer Summary modal + Season Ticker modal
// - Controls regrouped (Summary / Ticker / Reset / Chips)
// - Swapped rows order: (Prev/Next/GW/controls) first, then (Transfers/Bank/Cost)
//
// *** 2025-09-27 edits ***
// - Summary modal centered + visual table
// - Mini fixtures OFF by default (persisted via PREF_MINIS_KEY)
// - Transfer market: bottom-sheet (no RN Modal flicker), dropdown sort selector, debounced search,
//   "Affordable only" toggle (default ON), bank incl. outgoing, sticky header ("thead") for active stat
// - Dynamic stat discovery (no hard-wired SORT_FIELDS)
// - Ticker: editable FDR (tap to cycle 1..5, long-press to reset), saved locally, toggle My FDR / FPL FDR
//
// *** 2025-09-27 follow-ups ***
// 1) Summary: more room for transfers, remove Vice column, remove grey overlay, center modal
// 2) Ticker: takes most of screen + "Edit FDR" modal (start from FPL FDR, Save/Reset)
// 3) Search: reduce typing flicker (longer debounce + precomputed base list)
// 4) Stats: remove *Ids/*Codes keys; rename Costs->Price, Css->Clean Sheets, Forms->Form, Rcs->Red Cards, Ycs->Yellow Cards
//
// *** 2025-10-01 hotfixes ***
// - Bank editor (pencil on Bank) — override bank for a GW and propagate forward
// - Chips expire after GW19; fresh set starts GW20 (per-half usage enforcement)
// - GW16 starts with 5 Free Transfers
// - Search flicker fix: remove debounce; filter directly from raw input


import { InteractionManager } from 'react-native';
import PlayerInfoModal from './PlayerInfoModal';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Dimensions, ScrollView, TouchableOpacity, Image, ImageBackground, Pressable,
   ActivityIndicator, RefreshControl, FlatList, Platform, Switch,Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Share } from 'react-native';
 import * as Sharing from 'expo-sharing';
 import { captureRef } from 'react-native-view-shot';
import { Modal, KeyboardAvoidingView, TouchableWithoutFeedback, Keyboard } from 'react-native';
import ThemedTextInput from './ThemedTextInput';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation,useFocusEffect,useRoute  } from '@react-navigation/native';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';

import { useFplId } from './FplIdContext';
import { useColors } from './theme';
import { clubCrestUri, assetImages } from './clubs';
import { smartFetch } from './signedFetch';
import AppHeader from './AppHeader';
import InfoBanner from './InfoBanner';
import Svg, { G, Polygon, Circle, Text as SvgText, Line } from 'react-native-svg';

Text.defaultProps = Text.defaultProps || {};
Text.defaultProps.allowFontScaling = false;
// --- ANDROID scroll freeze helper ---

const androidFreeze = (cond) => (Platform.OS === 'android' ? !cond : true);
// Fixed-but-responsive width for the left stat label column
const STAT_COL_W = Math.min(
  156,                                   // hard cap
  Math.max(120, Math.round(Dimensions.get('window').width * 0.34)) // ~34% of screen
);
// ---------- constants ----------
const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;
const rem = SCREEN_W / 380;
const vrem = SCREEN_H / 380;
const CHIP_LABELS = {
  freehit: 'Free Hit',
  wildcard: 'Wildcard',
  bboost: 'Bench Boost',
  '3xc': 'Triple Captain',
};

const PITCH_RATIO = 540 / 405;
let PITCH_HEIGHT = Math.min(SCREEN_W * PITCH_RATIO, SCREEN_H * 0.8);
const SMALL_SCREEN = 640;
PITCH_HEIGHT = Math.min(SCREEN_W * PITCH_RATIO, SCREEN_H * (SCREEN_H < SMALL_SCREEN ? 0.58 : 0.65));
const NEW_BADGE_URI = 'https://livefpl.us/figures/new3.jpg';
const ROW_GAP = 6 * vrem;
const ROW_H = Math.floor((PITCH_HEIGHT - ROW_GAP * 4) / 5);

// Shirt sizing
const SHIRT_ASPECT = 5.6 / 5;
const IMG_W_BASE = rem * 55;
const SHIRT_SCALE = 0.7;
const PLAYER_IMG_W = (IMG_W_BASE * SHIRT_SCALE * vrem) / 2.2;
const PLAYER_IMG_H = PLAYER_IMG_W / SHIRT_ASPECT;
const STATIC_REFRESH_MS = 60 * 60 * 1000; // 1 hour
// Treat keys that look like per-90 metrics as /90 stats
const isPer90Key = (key = '') => {
  const k = String(key).toLowerCase();
  // common patterns: xg90, xg/90, xg_per90, xg_p90, per_90, _90
  return (
    /\/90$/.test(k) ||            // ".../90"
    /(?:^|_)(?:per)?90$/.test(k) || // "..._90" or "..._per90"
    /(?:^|_)(?:p90)$/.test(k) ||  // "..._p90"
    /90$/.test(k) && /[a-z]/.test(k) // ends with 90 and not just a number
  );
};

const getMinutesExt = (pid, extendedInfo) => {
  const row = extendedInfo?.[String(pid)] || extendedInfo?.[pid];
  const m = Number(row?.minutes ?? 0);
  return Number.isFinite(m) ? m : 0;
};

// Return the original "root out" for a currently-owned player pid,
// using the (already-collapsed) transfers array for this GW.
function rootOutFor(pid, transfers) {
  if (!Array.isArray(transfers) || transfers.length === 0) return pid;
  const prevOf = new Map(); // in -> out
  for (const [outId, inId] of transfers) prevOf.set(inId, outId);

  let cur = pid;
  const seen = new Set([cur]);
  while (prevOf.has(cur)) {
    const nxt = prevOf.get(cur);
    if (seen.has(nxt)) break; // cycle guard (paranoia)
    seen.add(nxt);
    cur = nxt;
  }
  return cur; // the true A
}




// Overlay positions
const OVERLAY_TOP = PLAYER_IMG_H * 0.10;
const ICON_OFFSET = -8 * rem;

const NAME_BAR_H = 12;
const LINE_H = 12;

const MAX_FT = 5; // set to 2 if you want classic FPL behavior
const HIT_COST = 4; // positive UI cost
const CACHE_TTL_MS = 9600_000;

const SNAPSHOT_URL = (id) => `https://livefpl-api-489391001748.europe-west4.run.app/LH_api2/planner/snapshot?id=${id}`;
const FDR_URL        = 'https://livefpl.us/planner/fdr.json';
const FDR_RATINGS_URL= 'https://livefpl.us/planner/fdr_ratings.json';
const FIX_NAMES_URL  = 'https://livefpl.us/planner/fixtures_names.json';
const API_ALL_INFO   = 'https://livefpl.us/planner/all_player_info.json';
const TEAMS_JSON     = 'https://livefpl.us/teams.json';
const EXT_API_URL     = 'https://livefpl.us/planner/extended_api.json';

const STATE_KEY = (id) => `planner_state_${id}`;
const PREF_MINIS_KEY = 'planner_pref_showMinis';
const ZOOM_KEY = 'planner_zoom_v1';
// New: local FDR override storage
const FDR_OVERRIDES_KEY = 'planner_fdr_overrides_v1';
const FDR_CUSTOM_ENABLED_KEY = 'planner_fdr_useCustom_v1';
const MARKET_AFFORDABLE_KEY = 'planner_market_affordable_only_v1';
// ---- Extended metrics → ranking (overall + by position type) ----

// Hide list consistent with your SeasonStatsModal (no "rank" keys; identity/meta removed)
const EXT_HIDE_KEYS = new Set([
  'id','element','web_name','first_name','second_name','photo','team','team_code',
  'can_select','can_transact','code','cost_change_event_fall','cost_change_start_fall',
  'removed','special','status','news','news_added','value_form','value_season',
  'has_temporary_code','birth_date','opta_code','region',
  'chance_of_playing_next_round','chance_of_playing_this_round',
  'corners_and_indirect_freekicks_order','corners_and_indirect_freekicks_text',
  'direct_freekicks_order','direct_freekicks_text','penalties_order','penalties_text',

  // Identity & meta
  'element_type','in_dreamteam','dreamteam_count','squad_number','team_join_date',
]);

// Keep numeric (including numeric strings), non-hidden, and not "*rank*"
const isRankableExtKey = (k, v) => {
  if (EXT_HIDE_KEYS.has(k)) return false;
  if (/rank/i.test(k)) return false;
  const n = Number(v);
  return Number.isFinite(n);
};

// Golden stars logic for KPI cards
const starCountFor = (overall) =>
  Number.isFinite(overall) ? (overall <= 10 ? 2 : overall <= 20 ? 1 : 0) : 0;

// Dense rank: 1,2,2,3 style (higher is better by default)
function denseRank(descPairs /* [ [pid, value], ... ] */) {
  const out = new Map();
  let rank = 0, prev = undefined, seen = 0;
  for (const [pid, val] of descPairs) {
    seen += 1;
    if (prev === undefined || val !== prev) rank = seen;
    out.set(pid, rank);
    prev = val;
  }
  return out; // Map<pid, rank>
}

// Build ranks for all metrics in extended_api:
// returns { overall: {metric: {pid: rank}}, byType: {metric: { [type]: {pid: rank} }}, keys: string[] }
function buildExtRanks(extendedInfo, typesMap) {
  const keysSet = new Set();

  // Discover rankable metric keys across all players
  for (const pidStr of Object.keys(extendedInfo || {})) {
    const row = extendedInfo[pidStr];
    if (!row || typeof row !== 'object') continue;
    for (const [k, v] of Object.entries(row)) {
      if (isRankableExtKey(k, v)) keysSet.add(k);
    }
  }
  const metricKeys = Array.from(keysSet).sort();

  const overall = {};
  const byType = {}; // metric -> type -> pid -> rank

  for (const k of metricKeys) {
    // Collect values
    const pairs = [];
    for (const pidStr of Object.keys(extendedInfo)) {
      const row = extendedInfo[pidStr];
      const v = row?.[k];
      if (isRankableExtKey(k, v)) {
        pairs.push([Number(pidStr), Number(v)]);
      }
    }
    // Overall (desc)
    pairs.sort((a,b) => b[1] - a[1]);
    const overallRanks = denseRank(pairs);
    overall[k] = Object.fromEntries(overallRanks);

    // By position type
    const perType = {}; // type -> entries
    for (const [pid, val] of pairs) {
      const t = typesMap?.[pid];
      if (!t) continue;
      (perType[t] ||= []).push([pid, val]);
    }
    byType[k] = {};
    for (const t of Object.keys(perType)) {
      perType[t].sort((a,b) => b[1] - a[1]);
      const ranks = denseRank(perType[t]);
      byType[k][t] = Object.fromEntries(ranks);
    }
  }

  return { overall, byType, keys: metricKeys };
}

// Helper: pretty label for stat keys
const pretty = (k='') => {
  const raw = String(k || '');
  const lower = raw.toLowerCase();
  // explicit renames
  const map = {
    costs: 'Price',
    css: 'Clean Sheets',
    forms: 'Form',
    rcs: 'Red Cards',
    ycs: 'Yellow Cards',

  };
  if (map[lower]) return map[lower];
  const hasDigit = /\d/.test(raw);
  const nums = raw.match(/\d+/g) || [];
const has90 = nums.some(n => Number(n) === 90);
  let lbl = raw
    .replace(/_/g,' ')
    // add spacing between letters↔digits for nicer titles
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .replace(/(?:^|\s)\S/g, c => c.toUpperCase())
    .replace(/\bPpg\b/,'Pts/G')
    .replace(/\bXg\b/,'xG')
    .replace(/\bExpected Goals\b/,'xG')
    .replace(/\bExpected Goal\b/,'xG')
    .replace(/\bExpected Assists\b/,'xA')
    .replace(/\bExpected Assist\b/,'xA')
    .replace(/\bEp\b/,'Expected points')
    .replace(/\bXa\b/,'xA')
    .replace(/\bEvent\b/,'GW')
    .replace(/\bDefensive Contribution\b/,'DEFCON')
    .replace(/\bTsb\b/,'Tsb%');
  if (hasDigit && !has90 && !/ownership/i.test(lbl)) lbl = `${lbl} Ownership`;
  return lbl;
};


// ---- CompareRadar: 2-player radar using ranks → percentiles ----
const RADAR_PREF_KEY = 'compare_radar_keys_v1';

// Map friendly names → extended_api keys (with robust fallbacks)
const STAT_KEY_MAP = {
  goals:            ['goals', 'goals_scored', 'npg'],             // non-pen goals if you prefer
  assists:          ['assists'],
  now_cost:         ['now_cost','price','costs'],
  total_points:     ['total_points','totals','points'],
  form:             ['form','forms'],
  xg_per_90:        ['xg_per_90','xg_p90','expected_goals_per_90','npxg_per_90','xg90'],
  defcon_per_90:    ['defcon_per_90','defensive_contribution_per_90','defcon_p90','defcon90'],
};

// Default 7 axes (user can edit)
const DEFAULT_KEYS = [
  'goals_scored',
  'assists',
  'now_cost',
  'total_points',
  'form',
  'expected_goals_per90',
  'defensive_contribution_per90',
];

// Find the first key that exists in extended row
function resolveExtKey(friendly, extRow) {
  const candidates = STAT_KEY_MAP[friendly] || [friendly];
  for (const k of candidates) {
    if (extRow && Object.prototype.hasOwnProperty.call(extRow, k)) return k;
  }
  // fallback: return the first candidate so ranks lookup still works
  return candidates[0];
}

function percentFromRanks(extRanks, metricKey, pid) {
  // ranks are 1 = best; convert to [0..1] percentile (1 = best)
  const table = extRanks?.overall?.[metricKey] || null;
  if (!table) return 0.0;
  const den = Object.keys(table).length || 0;
  const r = table[pid];
  if (!den || !r) return 0.0;
  return Math.max(0, Math.min(1, 1 - (r - 1) / den));
}

function usePersistentKeys() {
  const [keys, setKeys] = useState(DEFAULT_KEYS);
  useEffect(() => { (async () => {
    try { const raw = await AsyncStorage.getItem(RADAR_PREF_KEY);
      if (raw) setKeys(JSON.parse(raw));
    } catch {}
  })(); }, []);
  useEffect(() => { (async () => {
    try { await AsyncStorage.setItem(RADAR_PREF_KEY, JSON.stringify(keys)); } catch {}
  })(); }, [keys]);
  return [keys, setKeys];
}

// ==== CompareRadar v4 — direct stat normalization + delete X + full list ====
export function CompareRadar({
  pidA, pidB,
  nameA, nameB,
  extendedInfo,
  extRanks,             // not used for plotting now but kept for compatibility
  statOptions,          // full list of stats or objects [{key,label}]
  statLabelMap,
  statAliases,
  maxAxes = 7,
  height = 200,
}) {
  const C = useColors();
  const { width: screenW } = useWindowDimensions();

  // --- pretty labels ---
  const labelFor = (k) =>
    statLabelMap?.[k] ||
    (typeof statOptions?.[0] === 'object'
      ? statOptions.find(s => s.key === k)?.label
      : null) ||
    k.replace(/_/g, ' ').replace(/\b\w/g, s => s.toUpperCase());

  // --- aliases ---
  const DEFAULT_ALIASES = {
    goals: ['goals', 'goals_scored', 'npg'],
    assists: ['assists'],
    now_cost: ['now_cost', 'price', 'costs'],
    total_points: ['total_points', 'points'],
    form: ['form'],
    xg_per_90: ['xg_per_90', 'expected_goals_per90', 'npxg_per_90'],
    defcon_per_90: ['defcon_per_90', 'defensive_contribution_per90'],
  };
  const aliasMap = React.useMemo(
    () => ({ ...DEFAULT_ALIASES, ...(statAliases || {}) }),
    [statAliases]
  );
  const resolveExtKey = (friendly) => {
  const cands = aliasMap?.[friendly] || [friendly];
  for (const k of cands) {
    if (rowA && k in rowA) return k;
    if (rowB && k in rowB) return k;
  }
  return cands[0];
};


 // --- available stats list (union across entire extendedInfo, filtered) ---
const allCandidates = React.useMemo(() => {
  // If the caller passed a catalog, prefer it (objects or strings), but filter hidden/non-numeric
  if (Array.isArray(statOptions) && statOptions.length) {
    const rawKeys = (typeof statOptions[0] === 'object')
      ? statOptions.map(s => s.key)
      : statOptions;
    // Filter using the same rule you use elsewhere
    const sample = Object.values(extendedInfo || {})[0] || {};
    return Array.from(
      new Set(
        rawKeys.filter(k => isRankableExtKey(k, sample?.[k]))
      )
    );
  }

  // Otherwise: discover from ALL rows (robust; avoids depending on A or B only)
  const set = new Set();
  for (const row of Object.values(extendedInfo || {})) {
    if (!row || typeof row !== 'object') continue;
    for (const [k, v] of Object.entries(row)) {
      if (isRankableExtKey(k, v)) set.add(k);
    }
  }
  return Array.from(set).sort();
}, [statOptions, extendedInfo]);


  // --- defaults (your 7) ---
  const DEFAULT_KEYS = [
    'goals_scored',
    'assists',
    'now_cost',
    'total_points',
    'form',
    'expected_goals_per_90',
    'defensive_contribution_per_90',
  ];
  const RADAR_PREF_KEY = 'compare_radar_keys_v4';
  const [axesKeys, setAxesKeys] = React.useState(DEFAULT_KEYS);

  React.useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(RADAR_PREF_KEY);
        if (raw) {
          const saved = JSON.parse(raw);
          const filtered = saved.filter(k => allCandidates.includes(k));
          if (filtered.length) setAxesKeys(filtered);
        }
      } catch {}
    })();
  }, [allCandidates]);
  React.useEffect(() => {
    (async () => {
      try {
        await AsyncStorage.setItem(RADAR_PREF_KEY, JSON.stringify(axesKeys));
      } catch {}
    })();
  }, [axesKeys]);

  const keys = React.useMemo(() => axesKeys.slice(0, maxAxes), [axesKeys, maxAxes]);
  const rowA = extendedInfo?.[String(pidA)] || extendedInfo?.[pidA] || {};
  const rowB = extendedInfo?.[String(pidB)] || extendedInfo?.[pidB] || {};
  // ── Global max per metric across ALL players ──
// ── Helpers for per-90 detection + minutes extraction ──
// ── Helpers for per-90 detection + minutes extraction ──
const isPer90Metric = (k = '') => /(_per_90|\/90|per90)/i.test(String(k));
const minutesOfRow = (row) => {
  const v = row?.minutes ?? row?.mins ?? row?.minutes_played ?? row?.total_minutes;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// ── Global max per metric (overall) AND per position type (1=GK,2=DEF,3=MID,4=FWD) ──
//     * For per-90 stats, exclude rows with minutes < 180
const { globalMaxByMetric, typeMaxByMetric } = React.useMemo(() => {
  const overall = {};
  const perType = {}; // metric -> type -> max

  const rows = Object.entries(extendedInfo || {}); // [pid, row]
  for (const [, row] of rows) {
    if (!row || typeof row !== 'object') continue;
    const mins = minutesOfRow(row);
    const t = Number(row?.element_type); // prefer inline type from extended rows if present

    for (const [k, v] of Object.entries(row)) {
      if (isPer90Metric(k) && mins < 180) continue;     // skip low-mins for /90 axes
      const num = Number(v);
      if (!Number.isFinite(num)) continue;

      // overall
      overall[k] = Math.max(overall[k] || 0, num);

      // per-type (only if we have a valid type 1..4)
      if (Number.isFinite(t) && t >= 1 && t <= 4) {
        (perType[k] ||= {});
        perType[k][t] = Math.max(perType[k][t] || 0, num);
      }
    }
  }
  return { globalMaxByMetric: overall, typeMaxByMetric: perType };
}, [extendedInfo]);




  // ---- compute normalized values (each stat divided by max) ----
const concrete = React.useMemo(() => keys.map(k => ({
  friendly: k,
  metric: resolveExtKey(k),
})), [keys, rowA, rowB, aliasMap]);


 // ── Normalize vs per-type max if both players share a type; else vs overall max ──
const valsA = [];
const valsB = [];

const typeA = Number(rowA?.element_type);
const typeB = Number(rowB?.element_type);
const sameType = Number.isFinite(typeA) && typeA === typeB;

for (const { metric } of concrete) {
  const a = Number(rowA?.[metric] ?? 0);
  const b = Number(rowB?.[metric] ?? 0);

  let maxv;
  if (sameType && typeMaxByMetric?.[metric]?.[typeA] != null) {
    maxv = Number(typeMaxByMetric[metric][typeA]);
  } else {
    maxv = Number(globalMaxByMetric?.[metric] ?? 0);
  }
  maxv = Math.max(maxv, 1e-9); // avoid /0, keep within [0,1]

  valsA.push(Math.max(0, Math.min(1, a / maxv)));
  valsB.push(Math.max(0, Math.min(1, b / maxv)));
}


  // ---- geometry ----
  const size = Math.min(height, Math.max(160, Math.floor(screenW * 0.82)));
  const cx = size / 2, cy = size / 2;
  const radius = size * 0.34;
  const spokes = Math.max(3, concrete.length);
  const toXY = (i, t) => {
    const ang = (Math.PI * 2 * i / spokes) - Math.PI / 2;
    const r = radius * t;
    return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
  };
  const poly = vals => vals.map((t, i) => toXY(i, t || 0)).map(([x,y]) => `${x},${y}`).join(' ');



  // ---- editor ----
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const addKey = k => {
    if (keys.includes(k)) return;
    const next = keys.length < maxAxes ? [...keys, k] : [...keys.slice(1), k];
    setAxesKeys(next);
  };
  const removeKey = k => setAxesKeys(keys.filter(x => x !== k));
  const replaceKeyAt = (idx, k) => {
    const next = keys.slice();
    next[idx] = k;
    setAxesKeys([...new Set(next)].slice(0, maxAxes));
    setPickerOpen(false);
  };
const pad = 16; // visual padding around the chart
  return (
    <View style={{ paddingVertical: 6, paddingHorizontal: 8 }}>
      <View style={{ flexDirection:'row', justifyContent:'space-between', marginBottom:4 }}>
        <Text style={{ color:C.muted, fontSize:12 }}>Normalized stat values (A vs B)</Text>
        <TouchableOpacity onPress={() => setPickerOpen(true)}>
          <Text style={{ color:C.accent, fontSize:12, fontWeight:'700' }}>Edit stats</Text>
        </TouchableOpacity>
      </View>

      {/* Radar SVG with padded viewBox to prevent label clipping */}

<View style={{ alignSelf:'center', width:size }}>
  <Svg
    width="100%"
    height={size}
    viewBox={`${-pad} ${-pad} ${size + pad*2} ${size + pad*2}`}
  >
    <G transform={`translate(${pad},${pad})`}>
      {[0.25, 0.5, 0.75, 1].map((r, i) => (
        <Circle key={`ring-${i}`} cx={cx} cy={cy} r={radius*r}
          stroke={C.border} strokeWidth={1} fill="none" />
      ))}
      {concrete.map(({ friendly }, i) => {
        const [x, y] = toXY(i, 1.12); // slightly closer than 1.15 to be safe
        return (
          <G key={`sp-${i}`}>
            <Line x1={cx} y1={cy} x2={toXY(i,1)[0]} y2={toXY(i,1)[1]}
              stroke={C.border} strokeWidth={1}/>
            <SvgText x={x} y={y} fontSize="9" fill={C.ink} textAnchor="middle">
              {pretty(friendly)}
            </SvgText>
          </G>
        );
      })}
      <Polygon points={poly(valsA)} fill="none" stroke={C.accent} strokeWidth={2.5}/>
      <Polygon points={poly(valsB)} fill="none" stroke={C.info || C.muted} strokeWidth={2.5}/>
    </G>
  </Svg>
</View>


      {/* legend */}
      <View style={{ flexDirection:'row', justifyContent:'center', marginTop:-2 }}>
        <View style={{ flexDirection:'row', alignItems:'center' }}>
          <View style={{ width:14, height:4, backgroundColor:C.accent, borderRadius:2, marginRight:8 }}/>
          <Text style={{ color:C.ink, fontWeight:'700' }}>{nameA}</Text>
          <View style={{ width:14, height:4, backgroundColor:(C.info || C.muted), borderRadius:2, marginLeft:12, marginRight:8 }}/>
          <Text style={{ color:C.ink, fontWeight:'700' }}>{nameB}</Text>
        </View>
      </View>

      {/* chips with delete X */}
      <View style={{ flexDirection:'row', flexWrap:'wrap', gap:6, marginTop:8 }}>
        {keys.map(k => (
          <View key={k} style={{
            flexDirection:'row',
            alignItems:'center',
            paddingHorizontal:10, paddingVertical:6,
            borderRadius:999,
            backgroundColor:C.bg,
            borderWidth:1, borderColor:C.border
          }}>
            <Text style={{ color:C.ink, fontSize:12 }}>{labelFor(k)}</Text>
            <TouchableOpacity onPress={() => removeKey(k)} style={{ marginLeft:6 }}>
              <Text style={{ color:C.muted, fontSize:13 }}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}
        {keys.length < maxAxes && (
          <TouchableOpacity onPress={() => setPickerOpen(true)}
            style={{ paddingHorizontal:10, paddingVertical:6, borderRadius:999, borderWidth:1, borderColor:C.border }}>
            <Text style={{ color:C.accent, fontSize:12, fontWeight:'700' }}>+ Add</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* full catalog picker */}
      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={()=>setPickerOpen(false)}>
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.35)', justifyContent:'center', padding:20 }}>
          <View style={{ backgroundColor:C.card, borderRadius:14, padding:12, maxHeight:360 }}>
            <Text style={{ color:C.ink, fontWeight:'800', fontSize:14, marginBottom:6 }}>Choose a stat</Text>
            <FlatList
              data={allCandidates}
              keyExtractor={(s)=>String(s)}
              renderItem={({item}) => (
                <TouchableOpacity onPress={() => replaceKeyAt(Math.min(keys.length, maxAxes-1), item)} style={{ paddingVertical:10 }}>
                  <Text style={{ color: keys.includes(item) ? C.muted : C.ink, fontSize:13 }}>
                    {labelFor(item)}
                  </Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity onPress={()=>setPickerOpen(false)} style={{ alignSelf:'flex-end', marginTop:8 }}>
              <Text style={{ color:C.accent, fontWeight:'700' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}



// ---------- helpers ----------
const money = (tenths) => `£${(Number(tenths || 0) / 10).toFixed(1)}m`;
function applyTransfersToUserOrder(prevPicks, transfers) {
  if (!Array.isArray(prevPicks) || !transfers?.length) return prevPicks?.slice() || [];
  const next = prevPicks.slice();
  for (const [outId, inId] of transfers) {
    const idx = next.indexOf(outId);
    if (idx >= 0) next[idx] = inId;
  }
  return next;
}
function surname(full) {
  const parts = String(full || '').trim().split(/\s+/);
  return parts.length ? parts[parts.length - 1] : full;
}


// ---- Status & flag helpers (from extended_api.json) ----
function extFor(pid, ext) {
  if (!pid || !ext) return null;
  const e = ext[String(pid)] || ext[pid];
  return e || null;
}

// Extract 25/50/75 from the news string (fallback to 50 if not found)
function doubtPercentFromNews(news) {
  if (!news) return 50;
  const m = String(news).match(/\b(25|50|75)\b/);
  return m ? Number(m[1]) : 50;
}

function doubtColor(pct) {
  // 75 → #fbe772, 50 → #ffab1b, 25 → #d44401
  if (pct >= 70) return '#fbe772';
  if (pct <= 30) return '#d44401';
  return '#ffab1b';
}

function statusMeta(pid, ext) {
  const e = extFor(pid, ext);
  const status = (e?.status || 'a').trim(); // 'a','d','i','s','u'
  if (status === 'a') return { status, flag: null };
  if (status === 'd') {
    const pct = doubtPercentFromNews(e?.news);
    return { status, flag: { color: doubtColor(pct), label: String(pct) } };
  }
  // 'i','s','u' → red flag
  return { status, flag: { color: '#b2002d', label: null } };
}

// Determine Luma to flip text to white on dark colors
function isDarkRgb(r, g, b) {
  const l = 0.299 * (r/255) + 0.587 * (g/255) + 0.114 * (b/255);
  return l < 0.5;
}
function textColorForRgb(r, g, b) {
  return isDarkRgb(r, g, b) ? '#ffffff' : '#000000';
}
function sellPrice(nowCost, boughtValue) {
  const now = Number(nowCost || 0);
  const bv = Number(boughtValue || 0);
  if (!bv) return now;
  const gain = now - bv;
  if (gain <= 0) return now;
  return bv + Math.floor(gain / 2);
}
function nextFT(prevFT, used, chip) {
  const usedClamped = Math.max(0, used);
  if (chip === 'freehit' || chip === 'wildcard') {
    // No auto +1 after these chips; keep whatever remains (transfers are “free” here).
    return Math.min(MAX_FT, Math.max(0, prevFT - 0));
  }
  return Math.min(MAX_FT, Math.max(0, prevFT - usedClamped) + 1);
}
function crestFor(playerId, teamNums) {
  const t = Number(teamNums?.[String(playerId)] || 1);
  return clubCrestUri(t);
}
// Collapse transfer chains within a GW:
//   A->B->C->D => A->D
//   A->B and B->A => (removed)
// Stable, cycle-safe, order-agnostic.
function collapseTransfers(transfers) {
  if (!Array.isArray(transfers) || transfers.length === 0) return [];

  // Build out->in map (last edge wins)
  const nextOf = new Map();
  const insSet = new Set();
  const outsSet = new Set();
  for (const [outId, inId] of transfers) {
    nextOf.set(outId, inId);
    insSet.add(inId);
    outsSet.add(outId);
  }

  // Starts = nodes that are outs but never become ins
  const starts = [...outsSet].filter(o => !insSet.has(o));

  // If no starts (pure cycle), there’s nothing meaningful to show
  if (starts.length === 0) return [];

  const result = [];
  for (const start of starts) {
    let cur = start;
    const seen = new Set([cur]);
    while (nextOf.has(cur)) {
      const nxt = nextOf.get(cur);
      if (seen.has(nxt)) break; // cycle guard
      seen.add(nxt);
      cur = nxt;
    }
    if (String(start) !== String(cur)) result.push([start, cur]);
  }
  return result;
}



function shortFixture(label) {
  const s = String(label || '');
  const oppRaw = s.split('(')[0].trim().replace(/[^A-Za-z ]/g, '');
  const opp = oppRaw.replace(/\s+/g, ' ').toUpperCase().slice(0, 3);
  const ha = s.includes('(H)') ? '(H)' : s.includes('(A)') ? '(A)' : '';
  return ha ? `${opp} ${ha}` : opp;
}
function tinyFixture(label) {
  const s = shortFixture(label);
  const home = /\(H\)/.test(s);
  const opp = s.replace(/\s*\((H|A)\)\s*$/, '');
  return home ? opp.toUpperCase() : opp.toLowerCase();
}
function keysNum(obj) {
  return Object.keys(obj || {}).map(Number).filter((n) => !isNaN(n));
}

// Seed a clean week object from snapshot
function seedFromSnapshot(snap) {
  const base = Number(snap?.base_gw || snap?.gw || snap?.start_gw || 1);
  const stateWeek = {
    picks: (snap?.picks || []).slice(),
    bank: Number(snap?.bank || 0),
    ft: Number(snap?.FT || 1),
    chip: null, transfers: [], hits: 0, used: 0, newIns: [],
    bought: { ...(snap?.bought_values || {}) },
    sellOverrides: {},
    cap: snap?.captain || snap?.cap || null,
    vice: snap?.vice || null,
    __preFH__: null,
  };
  return { weeks: { [base]: stateWeek }, gw: base };
}

// ---------- main ----------
export default function Planner() {
  const { width: winW, height: winH } = useWindowDimensions();
 const insets = useSafeAreaInsets();

  // track ad height (0 when hidden/failed)
  const [adHeight, setAdHeight] = useState(0);
const [picker, setPicker] = useState({ visible: false, type: null }); // 'team' | 'pos' | 'stat' | null
const openPicker  = (type) => setPicker({ visible: true, type });
const closePicker = () => setPicker({ visible: false, type: null });
// PlayerInfoModal state
   const [infoOpen, setInfoOpen] = useState(false);
   const [infoPid, setInfoPid] = useState(null);

   const openInfo = useCallback((pid) => {
     setInfoPid(pid);
     setInfoOpen(true);
   }, []);
   const closeInfo = useCallback(() => setInfoOpen(false), []);

    // Dynamically size pitch so it never sits under the ad or system bars
  const pitchHeight = useMemo(() => {
    // conservative estimate of chrome above pitch (headers/controls); tune if needed
    const uiOverhead = 280;
    const maxByWidth = winW * PITCH_RATIO;           // keep aspect
    const maxByScreen = Math.max(
      180,                                           // never go below this
      winH - insets.top - insets.bottom - adHeight - uiOverhead
    );
    return Math.min(maxByWidth, maxByScreen);
  }, [winW, winH, insets.top, insets.bottom, adHeight]);

  const ROW_GAP_LOCAL = 6 * (winH / 380);
  const rowHeight = useMemo(() => {
    return Math.floor((pitchHeight - ROW_GAP_LOCAL * 4) / 5);
  }, [pitchHeight, ROW_GAP_LOCAL]);

  const C = useColors();
  const navigation = useNavigation();
  const route = useRoute();
  const { fplId } = useFplId();
  

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  // Zoom state (scales the whole pitch)
  const [zoom, setZoom] = useState(1);
  const [extRanks, setExtRanks] = useState({ overall: {}, byType: {}, keys: [] });


  const clampZoom = (z) => Math.max(0.75, Math.min(1.75, Number(z) || 1));
  useEffect(() => {
    (async () => {
      try {
        const z = await AsyncStorage.getItem(ZOOM_KEY);
        if (z != null) setZoom(clampZoom(parseFloat(z)));
      } catch {}
    })();
  }, []);
  useEffect(() => {
    (async () => {
      try { await AsyncStorage.setItem(ZOOM_KEY, String(zoom)); } catch {}
    })();
  }, [zoom]);

  // NEW: bank override editor state
  const [bankOverrides, setBankOverrides] = useState({}); // { [gw]: tenths }
  const [bankEditOpen, setBankEditOpen] = useState(false);
  const [bankDraftTenths, setBankDraftTenths] = useState(0); 

  // static datasets
  const [playersInfo, setPlayersInfo] = useState(null);
  const [extendedInfo, setExtendedInfo]   = useState(null); // { [pid]: extended row }
  const [fdr, setFdr] = useState(null);
  const [fdrRatingsBase, setFdrRatingsBase] = useState(null); // server FPL FDR (ratings + colors)
  const [fixturesNames, setFixturesNames] = useState(null);
  const [teamNums, setTeamNums] = useState(null);

  // FDR overrides
  const [fdrOverrides, setFdrOverrides] = useState({}); // { [label]: 1..5 }
  const [useCustomFdr, setUseCustomFdr] = useState(false);

  // base from server
  const [snapshot, setSnapshot] = useState(null);

  // plan state
  const [weeks, setWeeks] = useState({});
  const [gw, setGw] = useState(null);

  // UI
  const [transferMode, setTransferMode] = useState(null);
  const [benchFrom, setBenchFrom] = useState(null);

  // MARKET SHEET (no RN Modal)
  const [marketOpen, setMarketOpen] = useState(false);
  const shareTargetRef = useRef(null);
const pendingPidRef = useRef(null);
const transitionEndedRef = useRef(false);


  const searchRef = useRef(null);
  // REMOVE debounce state/effect (use raw directly)
  useEffect(() => {
  if (!extendedInfo || !playersInfo?.types) return;
  const r = buildExtRanks(extendedInfo, playersInfo.types);
  

  setExtRanks(r);
}, [extendedInfo, playersInfo]);

  // chips modal + preference for tiny fixtures visibility
  const [chipsOpen, setChipsOpen] = useState(false);
  const [showMinis, setShowMinis] = useState(false); // default OFF
const [settingsOpen, setSettingsOpen] = useState(false);
  // action sheet
  const [actionModal, setActionModal] = useState({ open: false, pid: null, sellText: '' });

  // summary + ticker + GW picker
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [tickerOpen, setTickerOpen] = useState(false);
  const [gwPickerOpen, setGwPickerOpen] = useState(false);
  // All-Players Stats modal state
const [allStatsOpen, setAllStatsOpen] = useState(false);


  const historyRef = useRef([]);

  // ---- persistent state (weeks/gw/bankOverrides) ----
const savePlannerState = useCallback(async (id, weeksObj, gwNum, bankOv) => {
  try {
    const payload = { weeks: weeksObj, gw: gwNum, bankOverrides: bankOv || {} };
    await AsyncStorage.setItem(STATE_KEY(id), JSON.stringify(payload));
  } catch {}
}, []);


// Planner data is considered ready when core datasets are loaded
const dataReady = useMemo(() => {
  return !!(extendedInfo && playersInfo?.types);
}, [extendedInfo, playersInfo]);

// --- maybeOpenCompare (one-shot + idle deferral) ---
const maybeOpenCompare = useCallback(() => {
  if (!transitionEndedRef.current) return;
  if (!dataReady) return;
  if (!pendingPidRef.current) return;
  if (compareOpen) return;
  if (openedFromParamRef.current) {
    pendingPidRef.current = null;
    return;
  }

  openedFromParamRef.current = true;
  const pid = Number(pendingPidRef.current);
  pendingPidRef.current = null;

  // Defer until after layout/animations settle
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      openCompareWith(pid);
    });
  });
}, [dataReady, compareOpen, openCompareWith]);




// If data becomes ready after the transition ended, try again
useEffect(() => {
  maybeOpenCompare();
}, [dataReady, maybeOpenCompare]);

// Overall rank for a metric (1 = best), or null
const getOverallRank = useCallback((pid, metric) => {
  return extRanks.overall?.[metric]?.[pid] ?? null;
}, [extRanks]);
 const handleShare = useCallback(async () => {
   try {
     // Give layout a tick just in case
     await new Promise((r) => setTimeout(r, 0));

     if (Platform.OS === 'ios') {
      const b64 = await captureRef(shareTargetRef.current, {
         format: 'png',
        quality: 1,
         result: 'base64',
       });
       const dataUrl = `data:image/png;base64,${b64}`;
       await Share.share({ url: dataUrl });
       return;
     }

     const uri = await captureRef(shareTargetRef.current, {
       format: 'png',
       quality: 1,
       result: 'tmpfile',
     });

     if (await Sharing.isAvailableAsync()) {
       await Sharing.shareAsync(uri, { dialogTitle: 'LiveFPL Planner', mimeType: 'image/png' });
     } else {
       await Share.share({ url: uri });
     }
   } catch (e) {
     console.error('Share failed:', e);
   }
 }, []);


// Rank sizes (denominators) on-demand
const getRankDenoms = useCallback((metric, pid) => {
  const overMap = extRanks.overall?.[metric] || {};
  const overallDen = Object.keys(overMap).length || null;
  const t = types?.[pid];
  const typeMap = (t != null) ? (extRanks.byType?.[metric]?.[t] || {}) : {};
  const typeDen = Object.keys(typeMap).length || null;
  return { overallDen, typeDen, elementType: t };
}, [extRanks, types]);

const asNumber = (x) => (x == null ? NaN : Number(x));

// Rank within same position type (GK=1, DEF=2, MID=3, FWD=4), or null
const getTypeRank = useCallback((pid, metric) => {
  const t = types?.[pid];
  if (!t) return null;
  return extRanks.byType?.[metric]?.[t]?.[pid] ?? null;
}, [extRanks, types]);
function beginTransferFor(pid) {
  const w = weeks?.[gw] || {};
  const rootOut = rootOutFor(pid, w.transfers || []); // use the helper we added earlier
  setTransferMode({
    outId: pid,                 // the currently shown player
    rootOut,                    // the original A (parent) for this chain
    outIdx: (w.picks || []).indexOf(pid),
  });
  setMarketOpen(true);
}
// ---- Toggle pill: Overall / Position ----
const RankModeToggle = ({ mode, onChange, C }) => (
  <View style={{ flexDirection:'row', alignSelf:'flex-start', backgroundColor:C.card, borderRadius:999, padding:4 }}>
    {['overall','type'].map(m => {
      const active = mode === m;
      return (
        <TouchableOpacity
          key={m}
          onPress={() => onChange(m)}
          style={{
            paddingHorizontal:12, paddingVertical:6, borderRadius:999,
            backgroundColor: active ? C.ink : 'transparent',
            borderWidth: active ? 0 : 1, borderColor: C.border, marginHorizontal:2
          }}>
          <Text style={{ fontSize:12, fontWeight:'700', color: active ? C.card : C.ink }}>
            {m === 'overall' ? 'Overall' : 'Position'}
          </Text>
        </TouchableOpacity>
        
      );
    })}
  </View>
);

// ---- Clean KPI Card (stars, value, rank pill, bar) ----
// Expects: getOverallRank, getTypeRank, getRankDenoms available in scope
const StatKPICard = ({ label, value, fmt, pid, statKey, mode, C }) => {
  const rankInfo = React.useMemo(() => {
    if (mode === 'overall') {
      const r = getOverallRank?.(pid, statKey);
      const d = getRankDenoms?.(statKey, pid)?.overallDen;
      return { rank:r, den:d, scope:'Overall' };
    } else {
      const r = getTypeRank?.(pid, statKey);
      const d = getRankDenoms?.(statKey, pid)?.typeDen;
      return { rank:r, den:d, scope:'Position' };
    }
  }, [pid, statKey, mode]);

  const shown = Number.isFinite(+value) ? +value : 0;
  const valTxt = fmt ? fmt(shown) : (Number.isInteger(shown) ? String(shown) : shown.toFixed(1));

  const rank = rankInfo.rank ?? null;
  const den  = rankInfo.den  ?? null;
  const pct  = rank && den ? Math.max(0, Math.min(1, 1 - (rank - 1) / den)) : 0;

  const star2 = rank && den && (rank <= Math.max(10, Math.round(den*0.002))); // top ~0.2% or ≤10
  const star1 = !star2 && rank && den && (rank <= Math.max(20, Math.round(den*0.004)));

  return (
    <View style={{
      width:'48%',
      backgroundColor:C.card,
      borderRadius:14,
      padding:12,
      borderWidth:1,
      borderColor:C.border,
      marginBottom:10,
      shadowColor:'#000', shadowOpacity:0.06, shadowRadius:6, shadowOffset:{width:0, height:3},
      elevation:1
    }}>
      {/* header */}
      <View style={{ flexDirection:'row', alignItems:'baseline', justifyContent:'space-between' }}>
        <Text style={{ fontSize:13, color:C.muted }} numberOfLines={1}>{label}</Text>
        {(star1 || star2) ? <Text style={{ fontSize:12, color:'#DAA520' }}>{star2 ? '⭐⭐' : '⭐'}</Text> : null}
      </View>

      {/* big value */}
      <Text style={{ fontSize:22, fontWeight:'800', color:C.ink, marginTop:2 }} numberOfLines={1}>
        {valTxt}
      </Text>

      {/* rank pill + scope */}
      <View style={{ flexDirection:'row', alignItems:'center', marginTop:6 }}>
        <View style={{
          paddingHorizontal:8, paddingVertical:4, borderRadius:999,
          backgroundColor:C.bg, borderWidth:1, borderColor:C.border, marginRight:8
        }}>
          <Text style={{ fontSize:11, color:C.ink }}>{rank && den ? `#${rank} / ${den}` : '—'}</Text>
        </View>
        <Text style={{ fontSize:11, color:C.muted }}>{rankInfo.scope}</Text>
      </View>

      {/* percentile bar */}
      <View style={{
        height:6, borderRadius:4, backgroundColor:C.bg,
        overflow:'hidden', borderWidth:1, borderColor:C.border, marginTop:6
      }}>
        <View style={{ width:`${(pct*100).toFixed(1)}%`, height:'100%', backgroundColor:C.accent }} />
      </View>
    </View>
  );
};
// Optional: list of metric keys you can rank on
const rankedMetricKeys = extRanks.keys; // e.g. ["assists","bonus","bps","creativity",...]

  // ---------- load data ----------
  const loadStatic = useCallback(async () => {
    const [ai, f1, f2, fx, tm,ext] = await Promise.all([
      fetch(API_ALL_INFO).then(r => r.json()),
      fetch(FDR_URL).then(r => r.json()),
      fetch(FDR_RATINGS_URL).then(r => r.json()),
      fetch(FIX_NAMES_URL).then(r => r.json()),
      fetch(TEAMS_JSON).then(r => r.json()),
      fetch(EXT_API_URL).then(r => r.json()),
    ]);
    setPlayersInfo(ai);
    setFdr(f1);
    setFdrRatingsBase(f2);
    setFixturesNames(fx);
    setTeamNums(tm);
    setExtendedInfo(ext);

    // Load FDR overrides + flag
    try {
      const raw = await AsyncStorage.getItem(FDR_OVERRIDES_KEY);
      setFdrOverrides(raw ? JSON.parse(raw) : {});
    } catch { setFdrOverrides({}); }
    try {
      const flag = await AsyncStorage.getItem(FDR_CUSTOM_ENABLED_KEY);
      setUseCustomFdr(flag === '1');
    } catch { setUseCustomFdr(false); }

    return { ai, f1, f2, fx, tm,ext };
  }, []);

  const loadSnapshot = useCallback(async (id, { revalidateIfGwAdvanced = false } = {}) => {
  const cacheKey = `planner_snap_${id}`;
  const now = Date.now();



  // Read cache first
  let cachedJson = null;
  try {
    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) cachedJson = JSON.parse(cached); // { t, data }
  } catch {}

  const cachedHasFreshTTL = cachedJson && (now - cachedJson.t < CACHE_TTL_MS);
  const cachedData = cachedJson?.data?.data;
  const cachedGw = Number(cachedData?.base_gw || cachedData?.gw || cachedData?.start_gw || 0);

  // Fast path: TTL valid and no revalidate request
  if (cachedHasFreshTTL && !revalidateIfGwAdvanced) {
    return cachedData;
  }

  // If we need to revalidate, fetch once and compare GWs
  try {
    const resp = await smartFetch(`${SNAPSHOT_URL(id)}&_=${now}`); // cache-bust
    if (!resp.ok) throw new Error(`Snapshot HTTP ${resp.status}`);
    const fresh = await resp.json();            // { data: {...} }
    const freshData = fresh?.data;
    const freshGw = Number(freshData?.base_gw || freshData?.gw || freshData?.start_gw || 0);

    // Save fresh copy
    try { await AsyncStorage.setItem(cacheKey, JSON.stringify({ t: now, data: fresh })); } catch {}

    // If GW advanced (or cache was stale), return fresh; otherwise keep fresh anyway
    if (!cachedData || freshGw !== cachedGw || !cachedHasFreshTTL) {
      return freshData;
    }
    // Same GW as cache: returning fresh keeps things consistent
    return freshData;
  } catch (e) {
    // Network failed: fall back to cache if we have it
    if (cachedData) return cachedData;
    throw e;
  }
}, []);
 // ---------- Anchored picker (Android-safe) ----------
 
  // new team/id → hide summary & clear undo history
  useEffect(() => {
    setSummaryOpen(false);
    historyRef.current = [];
  }, [fplId]);
// Hourly refresh of static datasets (incl. all_player_info.json)
useEffect(() => {
  const timer = setInterval(() => {
    (async () => {
      try {
        const { ai } = await loadStatic();        // refresh static files
        if (!snapshot) return;                    // wait until snapshot is loaded
        setWeeks(prev => recomputeAll(prev, snapshot, ai, bankOverrides));
      } catch (e) {
        // optional: console.warn('hourly static refresh failed', e);
      }
    })();
  }, STATIC_REFRESH_MS);

  return () => clearInterval(timer);
}, [loadStatic, snapshot, bankOverrides]);

  // preference for minis
  useEffect(() => {
    (async () => {
      try {
        const pref = await AsyncStorage.getItem(PREF_MINIS_KEY);
        if (pref != null) setShowMinis(pref === '1');
      } catch {}
    })();
  }, []);
  useEffect(() => {
    (async () => {
      try { await AsyncStorage.setItem(PREF_MINIS_KEY, showMinis ? '1' : '0'); } catch {}
    })();
  }, [showMinis]);


useEffect(() => {
  let mounted = true;
  (async () => {
    setLoading(true);
    try {
      // 1) Static datasets (returns ai etc so we don't wait on state setters)
      const { ai } = await loadStatic();

      // 2) Snapshot (uses your cache+TTL logic)
      const snap = await loadSnapshot(fplId);
      if (!mounted) return;
      setSnapshot(snap);

      // 3) Try restore
      let restoredWeeks = null, restoredGw = null, restoredBankOv = {};
      try {
        const raw = await AsyncStorage.getItem(STATE_KEY(fplId));
        if (raw) {
          const saved = JSON.parse(raw);
          restoredWeeks  = saved?.weeks || null;
          restoredGw     = Number(saved?.gw) || null;
          restoredBankOv = saved?.bankOverrides || {};
        }
      } catch {}

      if (restoredWeeks && Object.keys(restoredWeeks).length) {
        // Recompute everything against *current* snapshot & players info
        const recomputed = recomputeAll(restoredWeeks, snap, ai, restoredBankOv);
        setWeeks(recomputed);

        // Clamp/repair GW pointer
        const keys = Object.keys(recomputed).map(Number).filter(n => Number.isFinite(n));
        const minGw = keys.length ? Math.min(...keys) : Number(snap.base_gw || snap.gw || snap.start_gw || 1);
        const maxGw = keys.length ? Math.max(...keys) : minGw;
        const safeGw = Math.min(Math.max(restoredGw || minGw, minGw), maxGw);
        setGw(safeGw);

        // Restore bank overrides
        setBankOverrides(restoredBankOv || {});
      } else {
        // First run → seed from snapshot then recompute
        const seeded = seedFromSnapshot(snap);
        const recomputed = recomputeAll(seeded.weeks, snap, ai);
        setWeeks(recomputed);
        setGw(seeded.gw);
      }
    } catch (e) {
      // Fallback: seed minimally if anything failed
      try {
        const snap = await loadSnapshot(fplId);
        const seeded = seedFromSnapshot(snap);
        setSnapshot(snap);
        setWeeks(recomputeAll(seeded.weeks, snap, null));
        setGw(seeded.gw);
      } catch {}
    } finally {
      if (mounted) setLoading(false);
    }
  })();
  return () => { mounted = false; };
}, [fplId, loadStatic, loadSnapshot]);
useEffect(() => {
  if (!fplId) return;
  // avoid saving half-initialized state during boot
  if (loading) return;
  savePlannerState(fplId, weeks, gw, bankOverrides);
}, [fplId, weeks, gw, bankOverrides, loading, savePlannerState]);

function capFromSnapshot(snap) {
  if (!snap) return null;
  if (snap.captain != null) return snap.captain;
  if (snap.cap != null) return snap.cap;
  const arr = Array.isArray(snap.epicks) ? snap.epicks : null;
  return (arr && arr.length) ? arr[arr.length - 1] : null;
}

  // ---------- captain/vice guards ----------
  function ensureCapViceValid(weekObj) {
    if (!weekObj) return weekObj;
    const picks = Array.isArray(weekObj.picks) ? weekObj.picks : [];
    const xi = picks.slice(0, 11);
    if (xi.length === 0) return weekObj;

    const defaultCap = xi[xi.length - 1];
    let cap = weekObj.cap ?? defaultCap;
    let vice = weekObj.vice ?? [...xi].reverse().find((p) => p !== cap);

    if (cap == null || !xi.includes(cap)) cap = defaultCap;
    if (vice == null || cap === vice) {
      const alt = [...xi].reverse().find((p) => p !== cap);
      vice = alt ?? xi[0];
    }

    return { ...weekObj, cap, vice };
  }

  // ---------- propagation / recompute ----------
  function applyTransfersToBase(base, transfers) {
    const picks = base.picks.slice();
    for (const [outId, inId] of (transfers || [])) {
      const idx = picks.indexOf(outId);
      if (idx >= 0) picks[idx] = inId;
    }
    return picks;
  }

  function netImpact(base, finalPicks, costsMap) {
    const baseSet = new Set(base.picks);
    const finalSet = new Set(finalPicks);

    const ins = [];
    const outs = [];

    for (const p of finalSet) if (!baseSet.has(p)) ins.push(p);
    for (const p of baseSet)  if (!finalSet.has(p)) outs.push(p);

    let spend = 0;
    for (const pid of ins) spend += Number(costsMap?.[pid] || 0);
    let receive = 0;
    for (const pid of outs) {
      const bv = Number(base.bought?.[pid] || 0);
      const now = Number(costsMap?.[pid] || 0);
      const override = base.sellOverrides?.[pid];
      const sell = (typeof override === 'number') ? override : sellPrice(now, bv);
      receive += sell;
    }
    const delta = spend - receive;

    const boughtNext = { ...(base.bought || {}) };
    for (const pid of outs) delete boughtNext[pid];
    for (const pid of ins) boughtNext[pid] = Number(costsMap?.[pid] || 0);

    const sellOverridesNext = { ...(base.sellOverrides || {}) };
    for (const pid of outs) delete sellOverridesNext[pid];

    return {
      used: ins.length,
      ins,
      outs,
      bankAfter: base.bank - delta,
      boughtNext,
      sellOverridesNext,
    };
  }

  const baseGwNum = useMemo(() => Number(snapshot?.base_gw || snapshot?.gw || snapshot?.start_gw || 1), [snapshot]);

  // >>>>>>>>>> CORE: recompute with bank overrides, chip-halves, GW16 FT=5
  function recomputeAll(inputWeeks, snap, pinfo,bankOv) {
    if (!snap) return inputWeeks || {};
    const costsMap = pinfo?.costs || {};
    const startGw = Number(snap.base_gw || snap.gw || snap.start_gw || 1);
const ov = bankOv || bankOverrides || {};
    const keys = keysNum(inputWeeks);
    const lastGw  = keys.length ? Math.max(...keys) : startGw;

    let carry = {
      picks: (snap.picks || []).slice(),
      bank: Number(snap.bank || 0),
      ft: Number(snap.FT || 1),
      bought: { ...(snap.bought_values || {}) },
      sellOverrides: {},
      cap: capFromSnapshot(snap),
      vice: snap.vice || null,
    };

    const out = {};
    const usedFirst = new Set();   // chips used in GW1–19
    const usedSecond = new Set();  // chips used in GW20–38

    for (let g = startGw; g <= lastGw; g++) {
      const prevUserWeek = inputWeeks?.[g] || {};

      // Merge persistent overrides
      const overridesThisWeek = { ...(carry.sellOverrides || {}), ...(prevUserWeek.sellOverrides || {}) };

      // Base state, applying GW16 FT reset and bank override
      let base = {
        picks: carry.picks.slice(),
        bank: carry.bank,
        ft: (g === 16 ? 5 : carry.ft), // GW16 reset to 5 FT
        bought: { ...carry.bought },
        sellOverrides: overridesThisWeek,
        cap: carry.cap,
        vice: carry.vice,
      };
      

      // Respect half-season chip limits (first set GW1–19, second GW20–38)
      let chip = prevUserWeek.chip || null;
      if (chip) {
        if (g >= 20) {
          if (usedSecond.has(chip)) chip = null; else usedSecond.add(chip);
        } else {
          if (usedFirst.has(chip)) chip = null; else usedFirst.add(chip);
        }
      }

      

      const tCollapsed = collapseTransfers(prevUserWeek.transfers || []);

const seqPicks  = applyTransfersToBase(base, tCollapsed);
const finalPicks = (Array.isArray(prevUserWeek.picks) && prevUserWeek.picks.length)
  ? applyTransfersToUserOrder(prevUserWeek.picks, tCollapsed)
  : seqPicks.slice();


      // Apply bank override as the GW *starting* bank (so transfers still move it)
const hasOv = Object.prototype.hasOwnProperty.call(ov || {}, g);
const ovVal = hasOv ? Number(ov[g]) : NaN;
if (hasOv && Number.isFinite(ovVal)) {
  base = { ...base, bank: ovVal };
}

const { used, ins, bankAfter, boughtNext, sellOverridesNext } = netImpact(base, finalPicks, costsMap);

// Final bank should always reflect transfers
const bankFinal = bankAfter;

      const hits = (chip === 'freehit' || chip === 'wildcard') ? 0 : Math.max(0, used - base.ft) * HIT_COST;


 // One-time GW-start snapshot (before ANY transfers in this GW)
 const gwStart = prevUserWeek.__gwStart__ || {
   picks: base.picks.slice(),
   bank: base.bank,
   ft: base.ft,
   bought: { ...base.bought },
   sellOverrides: { ...base.sellOverrides },
   cap: base.cap,
   vice: base.vice,
};

 // If FH is ON now, use the immutable GW-start snapshot as the pre-FH image
 const preFH = (chip === 'freehit') ? gwStart : null;

      let weekObj = ensureCapViceValid({
        picks: finalPicks,
        bank: bankFinal,
        ft: base.ft,
        chip: chip || null,
        transfers: tCollapsed,
        used, hits, newIns: ins.slice(),
        bought: boughtNext, sellOverrides: sellOverridesNext,
        cap: prevUserWeek.cap ?? base.cap,
        vice: prevUserWeek.vice ?? base.vice,
        __preFH__: preFH,
        __gwStart__: prevUserWeek.__gwStart__ || gwStart,

      });

      out[g] = weekObj;

      const ftNext = nextFT(base.ft, used, chip);
      if (chip === 'freehit' && preFH) {
        // Always restore from the immutable snapshot taken BEFORE any FH-week edits
        const snap = preFH;
        carry = {
          picks: snap.picks.slice(),
          bank: snap.bank,
          ft: ftNext,
          bought: { ...snap.bought },
          sellOverrides: { ...snap.sellOverrides },
          cap: snap.cap,
          vice: snap.vice,
        };
      } else {
        carry = {
          picks: finalPicks.slice(),
          bank: bankFinal,
          ft: ftNext,
          bought: { ...boughtNext },
          sellOverrides: { ...sellOverridesNext },
          cap: weekObj.cap,
          vice: weekObj.vice,
        };
      }
    
  }
  return out;}

  function patchWeekAndPropagate(gwNum, patch, opts = {}) {
  setWeeks((prev) => {
    const baseWeek = (prev && prev[gwNum]) ? prev[gwNum] : {};
    const merged   = ensureCapViceValid({ ...baseWeek, ...patch });
    let candidate  = { ...(prev || {}), [gwNum]: merged };
    // ---------------- FH FIRST-ACTIVATION RESET ----------------
        // If FH has just been turned ON for this GW (OFF → ON),
    // wipe *future* weeks so they will be recomputed fresh from
    // the correct carry (which, for FH, is the pre-FH snapshot).
    const prevChip = baseWeek?.chip || null;
    const nextChip = merged?.chip || null;
    const fhJustActivated = (prevChip !== 'freehit' && nextChip === 'freehit');
    if (fhJustActivated) {
      const futureKeys = Object.keys(candidate)
        .map(k => +k)
        .filter(k => Number.isFinite(k) && k > gwNum);
      for (const k of futureKeys) {
        delete candidate[k];
      }
      // Optional: if you keep per-GW UI state/history, clear it too:
      // candidate.__history__ = (candidate.__history__ || []).filter(h => h.gw <= gwNum);
      // If you cache any per-GW AsyncStorage mirrors, consider clearing them as well.
    }
    // -----------------------------------------------------------
    // but we DO NOT propagate anything to future weeks.
   const isFH = ((merged?.chip ?? baseWeek?.chip) === 'freehit');


    // forward-prop captain to future GWs (only if still in XI)
    if (!isFH && opts.propagateCapPid != null) {
      const pid = opts.propagateCapPid;
      const future = keysNum(candidate).filter(k => k > gwNum).sort((a,b)=>a-b);
      for (const k of future) {
        const w = candidate[k]; if (!w) continue;
        const xi = (w.picks || []).slice(0, 11);
        if (!xi.includes(pid)) continue; // skip weeks where he's not starting
        const nextVice = (w.vice === pid) ? (xi.find(p => p !== pid) ?? w.vice) : w.vice;
        candidate[k] = { ...w, cap: pid, vice: nextVice };
      }
    }

    // forward-prop bench order to future GWs
     if (!isFH && opts.propagateBenchOrder) {
      const srcPicks = (merged?.picks || []).slice();
      const srcBench = srcPicks.slice(11);
      const pref = new Map(srcBench.map((p, i) => [p, i])); // smaller index = earlier bench

      const future = keysNum(candidate).filter(k => k > gwNum).sort((a,b)=>a-b);
      for (const k of future) {
        const w = candidate[k]; if (!w) continue;
        const picks = (w.picks || []).slice();
        const xi    = picks.slice(0, 11);
        let bench   = picks.slice(11);
        const gk    = bench.find(p => types?.[p] === 1);
        const nonGk = bench
          .filter(p => types?.[p] !== 1)
          .sort((a, b) => (pref.get(a) ?? 1e9) - (pref.get(b) ?? 1e9));
        bench = gk ? [gk, ...nonGk] : nonGk; // keep GK locked at B1 if present
        candidate[k] = { ...w, picks: xi.concat(bench) };
      }
    }

// forward-prop a roster swap (e.g. restore A in place of C across future GWs)
if (
  opts.propagateRosterSwap &&
  opts.propagateRosterSwap.from != null &&
  opts.propagateRosterSwap.to != null
) {
  const { from, to } = opts.propagateRosterSwap;
  const future = keysNum(candidate).filter(k => k > gwNum).sort((a, b) => a - b);

  for (const k of future) {
    const w = candidate[k]; 
    if (!w) continue;

    let changed = false;
    // 1) Update explicit future picks that still contain `from`
    if (Array.isArray(w.picks) && w.picks.length) {
      const nextPicks = w.picks.slice();
      const idx = nextPicks.indexOf(from);
      if (idx >= 0) {
        nextPicks[idx] = to;
        candidate[k] = { ...w, picks: nextPicks };
        changed = true;
      }
    }

    // 2) Update future transfers where `from` is planned to be sold later:
    //    [from -> X] becomes [to -> X]
    if (Array.isArray(w.transfers) && w.transfers.length) {
      const remapped = w.transfers.map(([outId, inId]) => [
        String(outId) === String(from) ? to : outId,
        inId,
      ]);
      // shallow compare
      const changedTransfers = remapped.some((p, i) => p[0] !== w.transfers[i][0] || p[1] !== w.transfers[i][1]);
      if (changedTransfers) {
        candidate[k] = { ...(candidate[k] || {}), transfers: remapped };
        changed = true;
      }
    }

    if (changed) {
      candidate[k] = ensureCapViceValid(candidate[k]);
    }
  }
}

    return recomputeAll(candidate, snapshot, playersInfo);
  });
}


  // ---------- mutators ----------
  function pushHistory(action) {
    historyRef.current.push({ gw, action, snapshot: JSON.parse(JSON.stringify(weeks)) });
  }
  function undoLast() {
    const last = historyRef.current.pop();
    if (!last) return;
    setWeeks(last.snapshot);
    setGw(last.gw);
  }

  // chips usage — split by half-season
  const chipsUsageHalf = useMemo(() => {
    const h1 = new Map(), h2 = new Map();
    for (const [gk, wk] of Object.entries(weeks || {})) {
      const gi = Number(gk);
      if (!wk?.chip) continue;
      const map = gi >= 20 ? h2 : h1;
      const arr = map.get(wk.chip) || [];
      arr.push(gi);
      map.set(wk.chip, arr);
    }
    return { h1, h2 };
  }, [weeks]);

  const baseChipAvail = useMemo(() => {
    const raw = snapshot?.chips_available || {};
    return {
      freehit: !!raw.freehit,
      wildcard: !!raw.wildcard,
      bboost:  !!raw.bboost,
      '3xc':   !!raw['3xc'],
    };
  }, [snapshot]);
function chipBaseAvailForGW(code, gwNum) {
   // Fresh set in the second half regardless of snapshot
   if (gwNum >= 20) return true;
   return !!baseChipAvail[code];
 }
  function chipIsSelectable(code, gwNum) {
    if (!chipBaseAvailForGW(code, gwNum)) return false;
    
    const half = gwNum >= 20 ? 'h2' : 'h1';
    const used = (chipsUsageHalf[half].get(code) || []).some(g => g !== gwNum);
    return !used;
  }
  function chipStatusLabel(code, gwNum, onHere) {
    if (!chipBaseAvailForGW(code, gwNum)) return 'USED';
    const half = gwNum >= 20 ? 'h2' : 'h1';
    const used = (chipsUsageHalf[half].get(code) || []).some(g => g !== gwNum);
    if (used) return 'USED';
    return onHere ? 'ON' : '—';
  }
  function toggleChip(code) {
    const w = weeks[gw];
    if (!w) return;
    const turningOn = w.chip !== code;
    if (turningOn && !chipIsSelectable(code, gw)) return;
    const on = w.chip === code;
    pushHistory({ type: 'toggle-chip', code });
    patchWeekAndPropagate(gw, { chip: on ? null : code });
  }

  const players = playersInfo?.players || {};
  const types   = playersInfo?.types   || {};
  const costs   = playersInfo?.costs   || {};
  const namesById = players;
  const teamNameByPid = useMemo(() => playersInfo?.teams || {}, [playersInfo]);
  function teamOf(pid) {
  return teamNameByPid?.[pid] || null;   // human name (e.g. "Arsenal")
}

function teamCounts(picks=[]) {
  const m = new Map();
  for (const p of picks) {
    const t = teamOf(p);
    if (!t) continue;
    m.set(t, (m.get(t) || 0) + 1);
  }
  return m;
}

function isValidSwapTarget(targetPid) {
  const w = weeks[gw];
  if (!benchFrom || !w) return false;
  const picks = w.picks || [];
  const xi  = picks.slice(0, 11);
  const bn  = picks.slice(11);

  const fromXi = xi.indexOf(benchFrom);
  const fromBn = bn.indexOf(benchFrom);
  const toXi   = xi.indexOf(targetPid);
  const toBn   = bn.indexOf(targetPid);

  // XI -> Bench: keep XI valid after putting target bench player in XI
  if (fromXi >= 0 && toBn >= 0) {
    const nextXI = xi.slice(); nextXI[fromXi] = targetPid;
    return isValidXI(nextXI);
  }

  // Bench -> XI: keep XI valid after bringing benchFrom into XI
  if (fromBn >= 0 && toXi >= 0) {
    const nextXI = xi.slice(); nextXI[toXi] = benchFrom;
    return isValidXI(nextXI);
  }

  // Bench -> Bench: allow only outfield bench spots (B2..B4). GK must remain B1.
  if (fromBn >= 0 && toBn >= 0) {
    const isGKFrom = types?.[benchFrom] === 1;
    const isGKTo   = types?.[targetPid] === 1;
    if (isGKFrom || isGKTo) return false;     // never move GK
    return fromBn > 0 && toBn > 0;            // only swap among outfield bench slots
  }

  return false;
}

  function isValidXI(nextXI) {
    const c = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const p of nextXI) c[types[p]] = (c[types[p]] || 0) + 1;
    return c[1] === 1 && c[2] >= 3 && c[3] >= 2 && c[4] >= 1 && nextXI.length === 11;
  }

  // ---------- bench & transfer handlers ----------
  function startBenchSwap(pid) {
    if (benchFrom === pid) { setBenchFrom(null); return; }
    setBenchFrom(pid);
  }
  function isValidBenchTarget(benchPid) {
    const w = weeks[gw];
    if (!benchFrom || !w) return false;
    const xi = w.picks.slice(0, 11);
    const bn = w.picks.slice(11);
    const fromIdx = xi.indexOf(benchFrom);
    const benchIdx = bn.indexOf(benchPid);
    if (fromIdx < 0 || benchIdx < 0) return false;
    const nextXI = xi.slice(); nextXI[fromIdx] = benchPid;
    return isValidXI(nextXI);
  }
  function completeBenchSwap(targetPid) {
  const w = weeks[gw];
  if (!benchFrom || !w) return;

  const picks = w.picks.slice();
  const xi  = picks.slice(0, 11);
  const bn  = picks.slice(11);

  const fromXi = xi.indexOf(benchFrom);
  const fromBn = bn.indexOf(benchFrom);
  const toXi   = xi.indexOf(targetPid);
  const toBn   = bn.indexOf(targetPid);

  // XI -> Bench
  if (fromXi >= 0 && toBn >= 0) {
    const nextXI = xi.slice(); nextXI[fromXi] = targetPid;
    if (!isValidXI(nextXI)) { setBenchFrom(null); return; }
    const nextBn = bn.slice(); nextBn[toBn] = benchFrom;

    pushHistory({ type: 'bench-swap', from: benchFrom, to: targetPid });
    patchWeekAndPropagate(gw, { picks: nextXI.concat(nextBn) }, { propagateBenchOrder: true });
    setBenchFrom(null);
    return;
  }

  // Bench -> XI
  if (fromBn >= 0 && toXi >= 0) {
    const nextXI = xi.slice(); nextXI[toXi] = benchFrom;
    if (!isValidXI(nextXI)) { setBenchFrom(null); return; }
    const nextBn = bn.slice(); nextBn[fromBn] = targetPid;

    pushHistory({ type: 'bench-swap', from: benchFrom, to: targetPid });
    patchWeekAndPropagate(gw, { picks: nextXI.concat(nextBn) }, { propagateBenchOrder: true });
    setBenchFrom(null);
    return;
  }

  // Bench <-> Bench (reorder; GK locked at B1)
  if (fromBn >= 0 && toBn >= 0) {
    const isGKFrom = types?.[benchFrom] === 1;
    const isGKTo   = types?.[targetPid] === 1;
    if (isGKFrom || isGKTo || fromBn === 0 || toBn === 0) { setBenchFrom(null); return; }

    const nextBn = bn.slice();
    [nextBn[fromBn], nextBn[toBn]] = [nextBn[toBn], nextBn[fromBn]];

    pushHistory({ type: 'bench-reorder', from: benchFrom, to: targetPid });
    patchWeekAndPropagate(gw, { picks: xi.concat(nextBn) }, { propagateBenchOrder: true });
    setBenchFrom(null);
    return;
  }

  setBenchFrom(null);
}

  function openTransfer(pid) {
  const w = weeks[gw];
  if (!w) return;

  // If this player is NEW this GW, offer to restore the original player instead of opening the market
  if (newInsSet.has(pid)) {
  const t = w.transfers || [];

  // Build maps: for each inId, know (outId, index)
  const inIndexByInId = new Map();
  const prevOf = new Map(); // inId -> outId
  t.forEach(([outId, inId], idx) => {
    inIndexByInId.set(inId, idx);
    prevOf.set(inId, outId);
  });

  // Walk back to the root (A) for this pid (which might be C)
  let root = pid;
  const toRemoveIdx = [];
  const chainIns = new Set(); // all "in" players in the chain we’re undoing
  while (prevOf.has(root)) {
    const idx = inIndexByInId.get(root);
    toRemoveIdx.push(idx);
    const stepOut = prevOf.get(root);
    chainIns.add(root); // root was an "in" at this step
    root = stepOut;
  }

  // If there's a meaningful root different from pid, offer restoring it
  if (String(root) !== String(pid)) {
    const curName  = namesById?.[pid]  || String(pid);
    const rootName = namesById?.[root] || String(root);

    Alert.alert(
      'Restore player?',
      `Replace ${curName} with ${rootName}?`,
      [
        {
          text: 'Choose another',
          style: 'cancel',
          onPress: () => beginTransferFor(pid)
        },
        {
          text: 'Restore',
          style: 'destructive',
          onPress: () => {
  // Remove the entire chain that led to pid
  const nextTransfers = t.filter((_, i) => !toRemoveIdx.includes(i));

  // Put the original root (A) back into this slot
  const nextPicks = applyTransfersToUserOrder(w.picks, [[pid, root]]);

  // Drop all "new" ins that were part of this undone chain (incl. pid)
  const nextNewIns = (w.newIns || []).filter(
    x => !chainIns.has(Number(x)) && String(x) !== String(pid)
  );

  patchWeekAndPropagate(
    gw,
    {
      picks: nextPicks,
      transfers: nextTransfers,
      newIns: nextNewIns,
    },
    {
      // ensure future GWs stop referencing the temporary player
      propagateRosterSwap: { from: pid, to: root },
    }
  );
}

        },
      ]
    );

    return; // don’t open market if we showed the restore alert
  }
}


  beginTransferFor(pid);
}


  function closeMarket() {
    setMarketOpen(false);
    setTransferMode(null);
  }
  function doTransfer(inPid) {
    const w = weeks[gw];
    if (!w || !transferMode) return;
    const outPidRoot = transferMode?.rootOut ?? transferMode?.outId; // A (root)
  const outPidShown = transferMode?.outId;                         // B (currently shown)
  const outIdx = transferMode?.outIdx ?? (w?.picks || []).indexOf(outPidShown);

    const appended  = [ ...(w.transfers || []), [outPidRoot, inPid] ];
const collapsed = collapseTransfers(appended);
// 2) update the *current* week's picks by slot index so UI changes immediately
 let nextPicks = (w?.picks || []).slice();
  if (outIdx >= 0) {
    nextPicks[outIdx] = inPid;
  }
    // Record the user action as they saw it (B -> C)
pushHistory({ type: 'transfer', outPid: outPidShown, inPid });

// Propagate using shown out (B), but STORE collapsed (A -> C),
// and also update picks immediately so the UI reflects the change.
const isFH = w?.chip === 'freehit';
patchWeekAndPropagate(
  gw,
  { picks: nextPicks, transfers: collapsed },
  isFH ? {} : { propagateRosterSwap: { from: outPidShown, to: inPid } }
);

closeMarket();

  }

  function setCaptain(pid) {
    const w = weeks[gw];
    if (!w) return;
    const inXI = w.picks.slice(0, 11).includes(pid);
    if (!inXI) return;
    pushHistory({ type: 'set-captain', pid });
    let next = { ...w, cap: pid };
    if (next.vice === pid) {
      const alt = w.picks.slice(0, 11).find((p) => p !== pid);
      next.vice = alt ?? next.vice;
    }
    const isFH = w?.chip === 'freehit';
    patchWeekAndPropagate(gw, ensureCapViceValid(next), isFH ? {} : { propagateCapPid: pid });
 
  }
  function setVice(pid) {
    const w = weeks[gw];
    if (!w) return;
    const inXI = w.picks.slice(0, 11).includes(pid);
    if (!inXI) return;
    pushHistory({ type: 'set-vice', pid });
    let next = { ...w, vice: pid };
    if (next.cap === pid) {
      const alt = w.picks.slice(0, 11).find((p) => p !== pid);
      next.cap = alt ?? next.cap;
    }
    const isFH = w?.chip === 'freehit';
  patchWeekAndPropagate(gw, ensureCapViceValid(next), isFH ? {} : undefined);
  }

  // Safe reset: remove target+future and re-seed if needed
  function resetFromGW(targetGw) {
    pushHistory({ type: 'reset-from-gw', gw: targetGw });
    setWeeks(prev => {
   // 1) prune weeks
   const candidate = { ...prev };
   for (const k of Object.keys(candidate)) {
     if (Number(k) >= targetGw) delete candidate[k];
   }
   // 2) prune bank overrides in the same move
   const prunedOverrides = Object.fromEntries(
     Object.entries(bankOverrides || {}).filter(([g]) => Number(g) < targetGw)
   );
   setBankOverrides(prunedOverrides); // update state so it persists/autosaves

   const remainingKeys = keysNum(candidate);
   if (remainingKeys.length === 0) {
     const seeded = seedFromSnapshot(snapshot);
     return recomputeAll(seeded.weeks, snapshot, playersInfo, prunedOverrides);
   }
   return recomputeAll(candidate, snapshot, playersInfo, prunedOverrides);
 });
  }
  function resetFromCurrentGW() { resetFromGW(gw); }

  const current = weeks[gw] || null;
  const newInsSet = useMemo(() => new Set(current?.newIns || []), [current?.newIns]);

  const getSellPriceTenths = useCallback((pid) => {
    const o = current?.sellOverrides?.[pid];
    if (typeof o === 'number') return o;
    const now = Number(costs?.[pid] || 0);
    const bv  = Number((current?.bought || {})[pid] || 0);
    return sellPrice(now, bv);
  }, [current?.sellOverrides, current?.bought, costs]);

  // ---------- FDR helpers (with overrides) ----------
  const colorForRating = useCallback((d) => {
    // 1 best (green) -> 5 worst (red)
    const palette = {
      1: [26, 171, 79],   // green
      2: [104, 197, 119], // light green
      3: [196, 196, 196], // gray
      4: [247, 180, 83],  // orange
      5: [220, 60, 60],   // red
    };
    const [r,g,b] = palette[d] || [196,196,196];
    return { bg: `rgb(${r},${g},${b})`, fg: textColorForRgb(r,g,b), rgb:[r,g,b] };
  }, []);

  const getRatingAndColor = useCallback((label) => {
    if (!label) return { d: 3, color: 'rgb(196,196,196)', text: '#000', rgb:[196,196,196] };

    // 1) If there is an override, use it
    const dOver = Number(fdrOverrides?.[label]);
    if (dOver >= 1 && dOver <= 5) {
      const { bg, fg, rgb } = colorForRating(dOver);
      return { d: dOver, color: bg, text: fg, rgb };
    }

    // 2) Else use FPL base from server
    const base = fdrRatingsBase?.[label];
    if (base) {
      const d = Array.isArray(base) ? base[0] : 3;
      const rgb = Array.isArray(base?.[1]) ? base[1] : [196,196,196];
      const [r,g,b] = rgb;
      return { d: Number.isFinite(d)?d:3, color:`rgb(${r},${g},${b})`, text: textColorForRgb(r,g,b), rgb };
    }

    // 3) Fallback
    const { bg, fg, rgb } = colorForRating(3);
    return { d:3, color:bg, text:fg, rgb };
  }, [fdrOverrides, fdrRatingsBase, colorForRating]);


  // fixtures helper with dark-text flip, using overrides
  const nextFixtures = useCallback((pid, startGw) => {
    const teamName = teamNameByPid?.[pid];
    if (!teamName || !fdr) return [];
    const perGw = fdr[teamName] || [];
    const startIdx = Math.max(0, (startGw || gw || 1) - 1);
    const take = 5;
    const out = [];
    for (let gi = startIdx; gi < perGw.length && out.length < take; gi++) {
      const g = perGw[gi] || [];
      for (const [label] of g) {
        const { color, text } = getRatingAndColor(label);
        out.push({ label, color, textColor: text, gw: gi + 1 });
        if (out.length >= take) break;
      }
    }
    return out;
  }, [fdr, teamNameByPid, gw, getRatingAndColor]);

  // ---------- GW navigation helpers ----------
  const allGwCount = useMemo(() => {
    if (fdr) {
      const anyTeam = Object.keys(fdr)[0];
      if (anyTeam) return (fdr[anyTeam] || []).length;
    }
    return 38;
  }, [fdr]);

  const minGw = useMemo(() => baseGwNum || 1, [baseGwNum]);
  const maxGw = useMemo(() => Math.max(allGwCount, baseGwNum || 1), [allGwCount, baseGwNum]);
  useFocusEffect(
    React.useCallback(() => {
      if (minGw != null) setGw(minGw);
      // no cleanup needed
      return undefined;
    }, [minGw])
  );

  // ---------- UI: rows & badges helpers ----------
  function rowsForDisplay() {
    const picks = current?.picks || [];
    const chip = current?.chip;
    if (chip === 'bboost') {
      const gks  = picks.filter((p) => types?.[p] === 1);
      const defs = picks.filter((p) => types?.[p] === 2).slice(0, 5);
      const mids = picks.filter((p) => types?.[p] === 3).slice(0, 5);
      const fwds = picks.filter((p) => types?.[p] === 4).slice(0, 3);
      return {
        gkRow: gks,
        defRow: defs,
        midRow: mids,
        fwdRow: fwds,
        benchRow: [],
        benchBoostOn: true,
      };
    }
    return {
      gkRow: picks.slice(0, 11).filter((p)=>types?.[p]===1),
      defRow: picks.slice(0, 11).filter((p)=>types?.[p]===2),
      midRow: picks.slice(0, 11).filter((p)=>types?.[p]===3),
      fwdRow: picks.slice(0, 11).filter((p)=>types?.[p]===4),
      benchRow: picks.slice(11),
      benchBoostOn: false,
    };
  }

  // ---------- INITIAL LOAD ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const id = fplId || (await AsyncStorage.getItem('fplId'));
        if (!id) {
          navigation.navigate('Change ID');
          setLoading(false);
          return;
        }
        const { ai } = await loadStatic();

        const snap = await loadSnapshot(id);
        if (cancelled) return;
        setSnapshot(snap);

        // Try restore, but heal if invalid
        let restored = null;
        try {
          const raw = await AsyncStorage.getItem(STATE_KEY(id));
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.weeks && parsed.gw != null) {
              restored = parsed;
            }
          }
        } catch {}
        if (restored?.bankOverrides && typeof restored.bankOverrides === 'object') {
          setBankOverrides(restored.bankOverrides);
        }
        if (restored) {
          let recomputed = recomputeAll(restored.weeks, snap, ai, restored.bankOverrides);

          let k = keysNum(recomputed);
          if (k.length === 0) {
            const seeded = seedFromSnapshot(snap);
            recomputed = recomputeAll(seeded.weeks, snap, ai, restored.bankOverrides);
 
            k = keysNum(recomputed);
          }
         const minGw   = Math.min(...k);
 setWeeks(recomputed);
 setGw(minGw);
        } else {
          const seeded = seedFromSnapshot(snap);
          const recomputed = recomputeAll(seeded.weeks, snap, ai);
          const k = keysNum(recomputed);
          const target = k.length ? Math.max(...k) : seeded.gw;
          setWeeks(recomputed);
          setGw(target);
        }
      } catch (e) {
        setError(String(e?.message || e));
      } finally {
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fplId, navigation, loadSnapshot, loadStatic]);

  useEffect(() => {
    if (!weeks || gw == null) return;
    if (weeks[gw]) return;
    setWeeks((prev) => recomputeAll({ ...prev, [gw]: prev[gw] || {} }, snapshot, playersInfo));
  }, [weeks, gw, snapshot, playersInfo]);

 

  // ---------- styles ----------
  const CACHED_IS_DARK = useMemo(() => {
    const hex = String(C.bg || '#000').replace('#', '');
    if (hex.length < 6) return true;
    const r = parseInt(hex.slice(0,2),16)/255;
    const g = parseInt(hex.slice(2,4),16)/255;
    const b = parseInt(hex.slice(4,6),16)/255;
    const l = 0.2126*r + 0.7152*g + 0.0722*b;
    return l < 0.5;
  }, [C.bg]);

  const S = useMemo(() => {
    const isDark = CACHED_IS_DARK;

    return StyleSheet.create({
      page: { flex: 1, backgroundColor: C.bg },
      container: { flex: 1, alignItems: 'center', width: '100%' },
sheetCloseBtn:{ position: 'absolute', top: 8, right: 10, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
      // controls row (Summary / Ticker / Reset / Chips)
      controlsRow: {
        flexDirection: 'row',
        gap: 4,
        paddingHorizontal: 12,
        marginTop: 8,
        width: '100%',
      },
      iconBtn: {
        flex: 1,
        minHeight: 22,
        backgroundColor: C.card,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: C.border,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 1,
      },
      iconBtnLabel: { fontSize: 11, color: C.ink, fontWeight: '800', marginTop: 2 },

      pitchWrap: { position: 'relative', width: '100%' },
      pitchBg: { position: 'relative', width: '100%', height: pitchHeight, justifyContent: 'space-between', paddingBottom: 2 },

      pitchStacked: { justifyContent: 'flex-start' },

      firstRow: { flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'center', width: '100%', height: rowHeight, marginVertical: ROW_GAP_LOCAL / 3 },
      row:      { flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'center', width: '100%', height: rowHeight, marginVertical: ROW_GAP_LOCAL / 3 },

      slot: { alignItems: 'center', width: '20%' },
      playerImage: { width: PLAYER_IMG_W, height: undefined, aspectRatio: SHIRT_ASPECT, resizeMode: 'contain' },
      playerImageBench: { width: PLAYER_IMG_W * 0.84, height: undefined, aspectRatio: SHIRT_ASPECT, resizeMode: 'contain' },

      tcOutline: {  },

      newBadgeWrap: {
        position: 'absolute',
        top: PLAYER_IMG_H * 0.48,
        right: 8*rem,
        width: 16 * rem,
        height: 16 * rem,
        borderRadius: 8 * rem,
        alignItems: 'center',
        justifyContent: 'center',
      },
miniBtn: {
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: 10,
  borderWidth: StyleSheet.hairlineWidth,
  borderColor: '#999',
  alignItems: 'center',
  justifyContent: 'center',
},
miniBtnTxt: {
  fontSize: 12,
},

      overlayBtn: {
        position: 'absolute',
        top: OVERLAY_TOP,
        width: 14, height: 14, borderRadius: 7,
        alignItems: 'center', justifyContent: 'center',
        borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.15)',
        ...Platform.select({ ios: { shadowColor:'#000', shadowOpacity:0.15, shadowRadius:3, shadowOffset:{width:0,height:1}}, android: { elevation: 2 }})
      },
      overlayLeft:  { left: -ICON_OFFSET, backgroundColor: '#ebff00' },
      overlayRight: { right: -ICON_OFFSET, backgroundColor: 'black' },

      // aligned badges
      capBadge: {
        position: 'absolute',
        top: PLAYER_IMG_H * 0.50,
        left: 8 * rem,
        backgroundColor: 'black', width: 14 * rem, height: 14 * rem, borderRadius: 8 * rem,
        alignItems: 'center', justifyContent: 'center',
        borderWidth: 1, borderColor: '#000',
      },
      vcBadge: {
        position: 'absolute',
        top: PLAYER_IMG_H * 0.50,
        left: 8 * rem,
        backgroundColor: 'black', width: 14 * rem, height: 14 * rem, borderRadius: 8 * rem,
        alignItems: 'center', justifyContent: 'center',
        borderWidth: 1, borderColor: '#000',
      },
      capText: { color: 'white', fontSize: 9, lineHeight: 14 * rem, fontWeight: '800' },
statsCard: { width: Math.min(SCREEN_W-16, 760), maxHeight: SCREEN_H*0.8, backgroundColor: C.bg, borderRadius: 16, borderWidth:1, borderColor: C.border, overflow:'hidden' },
statsHeader: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6, flexDirection:'row', alignItems:'center', justifyContent:'space-between' },
statsTitle: { color: C.ink, fontWeight:'900', fontSize: 16 },
statsRow: { flexDirection:'row', paddingHorizontal:12, paddingVertical:8, borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.border, alignItems:'flex-start', gap:8 },
statsTh: { flex: 0.8, color: C.muted, fontWeight:'900', fontSize:12 },
statsTd: { flex: 0.2, color: C.ink, fontWeight:'700', fontSize:12, flexWrap:'wrap' },

      benchHighlight: { borderWidth: 2, borderColor: '#10b981', borderRadius: 10, padding: 2 },
      benchFromGlow:  { borderWidth: 2, borderColor: '#60a5fa', borderRadius: 10, padding: 2 },

      nameBar: {
        fontSize: 10, lineHeight: NAME_BAR_H, includeFontPadding: false,
        fontWeight: 'bold', marginTop: 0, marginBottom: 0,
        backgroundColor: 'black', color: 'white', width: IMG_W_BASE, textAlign: 'center', overflow: 'hidden',
        borderTopLeftRadius: 4, borderTopRightRadius: 4,
      },
      fixNowBar: {
        fontSize: 9, lineHeight: LINE_H, includeFontPadding: false,
        width: IMG_W_BASE, textAlign: 'center', overflow: 'hidden',
      },
      priceBar: {
        fontSize: 11, lineHeight: LINE_H, includeFontPadding: false,
        width: IMG_W_BASE, textAlign: 'center', overflow: 'hidden',
        backgroundColor: isDark ? '#1f2937' : 'white', color: isDark ? C.ink : 'black',
      },
      bottomRounded: { borderBottomLeftRadius: 4, borderBottomRightRadius: 4, overflow: 'hidden' },

      miniRow: { flexDirection: 'row', width: IMG_W_BASE, alignSelf: 'center', overflow: 'hidden' },
      miniCell: {
        flex: 1, includeFontPadding: false,
        fontSize: 7, lineHeight: 10, letterSpacing: 0.15,
        textAlign: 'center', overflow: 'hidden',
        borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, borderColor: C.border,
      },

      // NAV row
      navRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 12, width: '100%', marginTop: 8, alignItems: 'stretch' },
      navBtn: { flex: 1, minHeight: 40, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },

      navBtnDisabled: { opacity: 0.45 },
      navTxt: { color: C.ink, fontWeight: '800' },
      gwPickerBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, flexDirection: 'row', alignItems: 'center', gap: 6 },
// --- KPI pills (mini FPL cards) ---
// in S = StyleSheet.create({ ... })
kpiWrap: {
  flexDirection: 'row',
  flexWrap: 'wrap',
  justifyContent: 'space-between',
  marginTop: 8,
},

kpiCard: {
   flexBasis: '31.5%',   // ~3 across with 8px gaps + side padding
   maxWidth: '31.5%',
   backgroundColor: C.card,
   borderRadius: 12,
   borderWidth: 1,
   borderColor: C.border,
   paddingVertical: 8,
   paddingHorizontal: 10,
   alignItems: 'center',
 },
kpiTitle: { fontSize: 11, fontWeight: '800', color: C.muted, textAlign: 'center' },
kpiValue: { fontSize: 16, fontWeight: '600', color: C.ink, marginTop: 2, textAlign: 'center' },
kpiSub:   { fontSize: 9, fontWeight: '800', color: C.muted, marginTop: 2, textAlign: 'center' },

// (full list rows already exist; add a subtle rank text style)
statRank: { color: C.muted, fontSize: 9, fontWeight: '800' },

      tickMine: {
        width: 92,
        paddingVertical: 4, paddingHorizontal: 6,
        backgroundColor: C.card,
        borderTopWidth: 1, borderBottomWidth: 1,
        borderColor: C.border,
        justifyContent: 'center',
        minHeight: 36,
      },
      tickMineTxt: {
        color: C.muted,
        fontWeight: '800',
        fontSize: 10,
        flexShrink: 1,
      },

      statRow: {
  flexDirection: 'row',
  alignItems: 'center',
  // keep your existing padding/borders
},

// NEW: fixed-width, non-shrinking label cell
statLabelCell: {
  width: STAT_COL_W,
  minWidth: STAT_COL_W,
  maxWidth: STAT_COL_W,
  flexShrink: 0,
  paddingRight: 8,
  overflow: 'hidden',
},

// NEW: label text styling
statLabelText: {
  fontSize: 13,            // keep your size
  fontWeight: '600',       // or your weight
  includeFontPadding: false,
  // color: C.muted,        // if you theme it
},

// NEW: value cells flex and are allowed to shrink
statValCell: {
  flex: 1,
  minWidth: 0,             // IMPORTANT so Text can elide on Android
  paddingLeft: 8,
},

statValText: {
  fontSize: 13,
  textAlign: 'right',      // if you right-align numbers
  includeFontPadding: false,
},


      // KPIs row
      topBar: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6, width: '100%' },
      card: { flex: 1, minHeight: 32, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingVertical: 2, paddingHorizontal: 10, justifyContent: 'center', alignItems: 'center' },
      cardTitle: { fontSize: 11, color: C.muted, fontWeight: '700', textAlign: 'center' },
      cardValue: { fontSize: 16, color: C.ink, fontWeight: '900', marginTop: 2, textAlign: 'center' },

      loadingOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', zIndex: 999 },
      loadingCard: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16, minWidth: 180, alignItems: 'center' },
      loadingText: { marginTop: 8, color: C.ink, fontWeight: '600' },

      // Generic modal wrappers
      modalWrap: {
       position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
       backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
        zIndex: 9999,
      },
      modalCard: { position:'relative', maxHeight: SCREEN_H * 0.78, backgroundColor: C.bg, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderWidth: 1, borderColor: C.border },

      // Action Sheet styles
     actionWrap: {
       
        position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
        zIndex: 9999,
      },
      newsBox: { paddingHorizontal: 16, paddingBottom: 8, marginTop: 8 },
newsText: { color: C.muted, fontSize: 12, lineHeight: 16, fontWeight: '700' },

      actionCard: { backgroundColor: C.bg, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderWidth: 1, borderColor: C.border, paddingBottom: 10 },
      actionHeader: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
      actionTitle: { color: C.ink, fontWeight: '900', fontSize: 16 },
      actionList: { paddingVertical: 6 },
      actionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.border },
      actionRowDisabled: { opacity: 0.4 },
      actionRowText: { color: C.ink, fontWeight: '800', fontSize: 14 },
      sellBox: { marginHorizontal: 16, marginTop: 8, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
chipMini: {
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: 10,
  borderWidth: 1,
  borderColor: C.border,
  backgroundColor: C.card,
  flexDirection: 'row',
  alignItems: 'center',
  gap: 6,
  // keep it compact so the three cards still fit nicely
  maxWidth: 128,
},
chipMiniTxt: {
  color: C.ink,
  fontWeight: '800',
  fontSize: 11,
},

      // Chips Modal
      chipsCard: { maxHeight: SCREEN_H * 0.6, backgroundColor: C.bg, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderWidth: 1, borderColor: C.border, paddingBottom: 10 },
      chipsHeader: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
      chipsTitle: { color: C.ink, fontWeight: '900', fontSize: 16 },
      chipsList: { paddingVertical: 6 },
      chipLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.border },
      chipName: { color: C.ink, fontWeight: '800', fontSize: 14 },
      footerPref: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
      prefTxt: { color: C.ink, fontWeight: '700' },
      marketMiniRow: {
  flexDirection: 'row',
  gap: 2,
  marginTop: 4,
  maxWidth: '85%',
},
expandWrap: {
  marginTop: 6,
  marginHorizontal: 12,
},
expandFade: {
  height: 6,
  marginBottom: 4,
  backgroundColor: 'transparent',
  // if you want a real fade, you can swap this for a LinearGradient
},
expandRow: {
  alignSelf: 'center',
  flexDirection: 'row',
  alignItems: 'center',
  gap: 6,
  paddingVertical: 6,
  paddingHorizontal: 10,
  borderRadius: 12,
  borderWidth: StyleSheet.hairlineWidth,
  borderColor: C.border,
  backgroundColor: C.card,
},
expandText: {
  color: C.ink,
  fontSize: 12,
  fontWeight: '600',
},

marketMiniCell: {
  flex: 1,
  textAlign: 'center',
  fontSize: 8,
  fontWeight: '800',
  paddingHorizontal: 4,
  paddingVertical: 2,
  borderRadius: 6,
  overflow: 'hidden',
  marginRight:1,
},


      // Market (bottom sheet) ----------
      sheetWrap: {
        position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
      },
      sheetBackdrop: {
        position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
      },
      rActions: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 8,
  paddingLeft: 8,
},
rIconBtn: {
  paddingVertical: 3,
  paddingHorizontal: 4,
  borderRadius: 8,
  borderWidth: StyleSheet.hairlineWidth,
  borderColor: C.border,
  backgroundColor: C.card, // or 'transparent' if you prefer
},
rItalicI: {
  fontStyle: 'italic',
  fontWeight: '700',
  fontSize: 14,
  color: C.ink,
},

rItalicI2: {
  fontStyle: 'italic',
  fontWeight: '700',
  fontSize: 10,
  color: C.ink,
},

      sheetCard: {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  top: Math.floor(SCREEN_H * 0.10), // leave ~10% space at the top
  backgroundColor: C.bg,
  borderTopLeftRadius: 16,
  borderTopRightRadius: 16,
  borderWidth: 1,
  borderColor: C.border,
  ...Platform.select({
    android: { elevation: 8 },
    ios: { shadowColor:'#000', shadowOpacity:0.2, shadowRadius:8, shadowOffset:{width:0,height:-2} }
  })
},
mFixRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 4, maxWidth: '100%' },
mFixPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, minWidth: 34, alignItems: 'center', justifyContent: 'center' },
mFixTxt: { fontSize: 10, fontWeight: '800' },

  settingsLayer: {
   ...StyleSheet.absoluteFillObject,
   zIndex: 40,                 // ensure above pitch & rows
   elevation: 8,               // Android z-index
 },
 settingsBackdrop: {
   ...StyleSheet.absoluteFillObject,
   backgroundColor: 'transparent',
 },
 settingsOverlayWrap: {
   position: 'absolute',
   left: 12,
   right: 12,
   top: -88,
 },
 settingsOverlay: {
   backgroundColor: C.card,
   justifyContent: 'center',
    alignItems: 'center',
   borderRadius: 12,
   borderWidth: 1,
   borderColor: C.border,
   paddingVertical: 8,
   paddingHorizontal: 10,
   flexDirection: 'row',

   gap: 10,
   ...Platform.select({
     ios: { shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
     android: { elevation: 6 },
   }),
 },

 settingsBtn: {
   paddingHorizontal: 10,
   paddingVertical: 6,
   borderRadius: 10,
   borderWidth: StyleSheet.hairlineWidth,
   borderColor: C.border,
   backgroundColor: C.card,
 },
 settingsBtnInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
 settingsTxt: { fontSize: 12, color: C.ink, fontWeight: '600' },
 // Transparent catcher to close when tapping outside (overlay doesn't change layout)
 settingsTouchCatcher: {
   ...StyleSheet.absoluteFillObject,
   backgroundColor: 'transparent',
 },

 settingsStrip: {
   width: '100%',
   alignSelf: 'stretch',
   flexDirection: 'row',
   flexWrap: 'wrap',
   gap: 8,
   paddingHorizontal: 12,
   paddingVertical: 8,
   marginTop: 6,
   backgroundColor: C.card,
   borderWidth: 1,
   borderColor: C.border,
   borderRadius: 12,
   
 },

      sheetIn:  { transform: [{ translateY: 0 }], opacity: 1 },
      sheetOut: { transform: [{ translateY: SCREEN_H }], opacity: 0.01 },

      marketHead: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12 },
      search: { flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, color: C.ink },
marketMeta: { paddingHorizontal: 12, paddingTop: 0, paddingBottom: 6 },
  marketMetaTxt: { color: C.muted, fontWeight: '900', fontSize: 12 },
      marketThead: { paddingHorizontal: 12, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border, backgroundColor: C.card, flexDirection:'row', justifyContent:'flex-end',
      zIndex: 2,                       // <— add this
  ...Platform.select({ android: { elevation: 2 } }), // <— and this on Android
       },
      theadLeft: { color: C.muted, fontWeight:'900', fontSize:12 },
      theadRight: { color: C.muted, fontWeight:'900', fontSize:12 },

      rowItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.border },
      rLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: '68%' },
      rName: { color: C.ink, fontWeight: '800' },
      rInlinePrice: { color: C.muted, fontWeight: '800',fontSize:9 },
      rSub: { color: C.muted, fontSize: 11 },
      rPrice: { color: C.ink, fontWeight: '900' },

      // GW Picker modal
      gwPickerCard: { maxHeight: SCREEN_H * 0.6, backgroundColor: C.bg, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderWidth: 1, borderColor: C.border, paddingBottom: 10 },
      gwHeader: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
      gwTitle: { color: C.ink, fontWeight: '900', fontSize: 16 },
      gwItem: { paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.border },
      gwItemTxt: { color: C.ink, fontWeight: '800' },

      // Summary modal (centered table)
      centerWrap: {
        position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
        backgroundColor: 'transparent',
        alignItems: 'center', justifyContent: 'center',
        padding: 16,
        zIndex: 9999,
      },
      centerWrapDim: {
        position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        alignItems: 'center', justifyContent: 'center',
        padding: 16,
        zIndex: 9999,
      },
      sumCardCenter: { width: Math.min(SCREEN_W-16, 760), maxHeight: SCREEN_H*0.8, backgroundColor: C.bg, borderRadius: 16, borderWidth:1, borderColor: C.border, overflow:'hidden' },
      sumHeader: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6, flexDirection: 'row', alignItems: 'center', justifyContent:'space-between' },
      sumTitle: { color: C.ink, fontWeight: '900', fontSize: 16 },
      tableRow: { flexDirection:'row', paddingHorizontal:12, paddingVertical:10, borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.border, alignItems:'flex-start', gap:8 },
      th: { color: C.muted, fontWeight:'900', fontSize:12 },
      td: { color: C.ink, fontWeight:'700', fontSize:12 },
      transferWrap: { flexDirection:'row', flexWrap:'wrap', gap:6 },
      pill: { paddingHorizontal:8, paddingVertical:4, borderRadius:10, borderWidth:1, borderColor:C.border },
      pillTxt: { fontSize:12, fontWeight:'800', color: C.ink },
kpiStars: {
  position: 'absolute',
  top: 6,
  right: 6,
  flexDirection: 'row',
  alignItems: 'center',
  gap: 2,
  opacity: 0.95,
},
kpiCardHasStars: {
  paddingTop: 16,     // gives the stars a lane so they don't overlap title
},
kpiTitleCompact: {
  fontSize: 11,
  lineHeight: 13,
  paddingRight: 34,   // reserve space under the stars on the right
},


      // Ticker modal
      tickCard: { height: SCREEN_H * 0.73, backgroundColor: C.bg, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderWidth: 1, borderColor: C.border },
      tickHeader: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
      tickTitle: { color: C.ink, fontWeight: '900', fontSize: 16 },
      tickOpts: { flexDirection:'row', alignItems:'center', gap:8, paddingHorizontal:16, paddingBottom:8, flexWrap:'wrap' },

      tickBody: { paddingBottom: 12 },
      tickRow: { flexDirection: 'row', alignItems: 'stretch', paddingHorizontal: 12, marginBottom: 6 },
      tickTeam: { width: 104, paddingVertical: 6, paddingHorizontal: 8, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderTopLeftRadius: 10, borderBottomLeftRadius: 10, justifyContent:'center' },
      tickTeamTxt: { color: C.ink, fontWeight: '900' },
      tickCellsWrap: { flex: 1, borderTopRightRadius: 10, borderBottomRightRadius: 10, overflow: 'hidden', borderWidth: 1, borderLeftWidth: 0, borderColor: C.border, backgroundColor: C.card },
      tickCells: { flexDirection: 'row' },
      tickCell: { width: 60, minHeight: 36, borderRightWidth: StyleSheet.hairlineWidth, borderColor: C.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, paddingVertical: 4 },
      tickCellTxt: { fontSize: 8, fontWeight: '800' },
      smallBtn: { flexDirection:'row', alignItems:'center', gap:6, paddingHorizontal:10, paddingVertical:6, borderRadius:10, borderWidth:1, borderColor:C.border, backgroundColor:C.card },
      smallBtnTxt: { color: C.ink, fontWeight:'800', fontSize:11 },
 statusBadge: {
        position: 'absolute',
        top: OVERLAY_TOP + 14,
        right: 8 * rem,
        minWidth: 14 * rem,
        height: 14 * rem,
        
        alignItems: 'center',
        justifyContent: 'center',
      },
      chipPill: {
  position: 'absolute',
  top: 62,
  left: 18,
  flexDirection: 'row',
  alignItems: 'center',
  gap: 6,
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: 10,
  borderWidth: 1,
  borderColor: C.border,
  backgroundColor: C.card,
},
chipPillTxt: { color: C.ink, fontWeight: '800', fontSize: 11, maxWidth: 160 },

      // FDR editor
      editorCard: { width: Math.min(SCREEN_W-16, 700), maxHeight: SCREEN_H*0.6, backgroundColor: C.bg, borderRadius: 16, borderWidth:1, borderColor:C.border, overflow:'hidden' },
      editorRow: { flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingVertical:10, borderTopWidth:StyleSheet.hairlineWidth, borderColor:C.border },
      editorLabel: { color:C.ink, fontWeight:'800', flex:1, paddingRight:12 },
      editorControls: { flexDirection:'row', alignItems:'center', gap:8 },
      badgeNum: { minWidth:28, textAlign:'center', fontWeight:'900', color:C.ink },
    });
  }, [C, CACHED_IS_DARK,pitchHeight, rowHeight, ROW_GAP_LOCAL]);


  // ---------- top UI ----------
  const TopBar = () => {
    const used = Number(current?.used || 0);
    const ftShown = (current?.chip === 'freehit' || current?.chip === 'wildcard') ? '∞' : (current?.ft ?? 1);

    const rawCost = Math.max(0, Number(current?.hits || 0));
    const cost = rawCost ? -rawCost : 0;
      const bankTenths = Number(current?.bank || 0); // <- add this
const chipLabel = current?.chip ? (CHIP_LABELS[current.chip] || String(current.chip)) : 'No chip';

  return (
    <View style={S.topBar}>
      {/* 👇 Tiny chip box (left of Transfers) */}
      <TouchableOpacity
        onPress={() => setChipsOpen(true)}
        style={S.chipMini}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        
        <Text style={S.chipMiniTxt} numberOfLines={1}>{chipLabel}</Text>
      </TouchableOpacity>
        <View style={S.card}>
          <Text style={S.cardTitle}>Transfers</Text>
          <Text style={S.cardValue}>{`${used}/${ftShown}`}</Text>
        </View>

        <View style={S.card}>
          <View style={{ flexDirection:'row', alignItems:'center', gap:6 }}>
            <Text style={S.cardTitle}>Bank</Text>
            <TouchableOpacity
  onPress={() => {
  // seed from CURRENT (final) bank shown on screen
  const seeded = Number(weeks?.[gw]?.bank ?? 0);
  setBankDraftTenths(seeded);
  setBankEditOpen(true);
}}

>
  <MaterialCommunityIcons name="pencil" size={14} color={C.muted} />
</TouchableOpacity>

          </View>
          <Text style={[S.cardValue, bankTenths < 0 && { color: '#ef4444' }]}>
          {money(bankTenths)}
        </Text>
        </View>

        <View style={S.card}>
          <Text style={S.cardTitle}>Cost</Text>
          <Text style={[S.cardValue, cost < 0 && { color: '#ef4444' }]}>{cost}</Text>
        </View>
      </View>
    );
  };

  const NavRow = () => {
    const canPrev = gw > (snapshot?.base_gw || 1);
    return (
      <View style={S.navRow}>
        <TouchableOpacity style={[S.navBtn, !canPrev && S.navBtnDisabled]} onPress={() => canPrev && setGw(gw - 1)} disabled={!canPrev}>
          <Ionicons name="chevron-back" size={16} color={C.ink} />
          <Text style={S.navTxt}>Prev</Text>
        </TouchableOpacity>

        <TouchableOpacity style={S.gwPickerBtn} onPress={() => setGwPickerOpen(true)}>
          <MaterialCommunityIcons name="calendar" size={16} color={C.ink} />
          <Text style={S.navTxt}>Gameweek {gw}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={S.navBtn} onPress={() => setGw(Math.min(maxGw, gw + 1))}>
          <Text style={S.navTxt}>Next</Text>
          <Ionicons name="chevron-forward" size={16} color={C.ink} />
        </TouchableOpacity>
      </View>
    );
  };

  const ControlsRow = () => (
    <View style={S.controlsRow}>
      <TouchableOpacity style={S.iconBtn} onPress={() => setSummaryOpen(true)}>
        <MaterialCommunityIcons name="clipboard-text-outline" size={18} color={C.ink} />
        <Text style={S.iconBtnLabel}>Summary</Text>
      </TouchableOpacity>
      <TouchableOpacity style={S.iconBtn} onPress={() => setTickerOpen(true)}>
        <MaterialCommunityIcons name="chart-timeline-variant" size={18} color={C.ink} />
        <Text style={S.iconBtnLabel}>Ticker</Text>
      </TouchableOpacity>
      <TouchableOpacity style={S.iconBtn} onPress={resetFromCurrentGW}>
        <MaterialCommunityIcons name="backup-restore" size={18} color="#ef4444" />
        <Text style={[S.iconBtnLabel, { color: '#ef4444' }]}>Reset GW+</Text>
      </TouchableOpacity>
      <TouchableOpacity
  style={S.iconBtn}
  onPress={() => setAllStatsOpen(true)}
  accessibilityLabel="Stats"
>
  <MaterialCommunityIcons name="chart-box-outline" size={18} color={C.ink} />
  <Text style={S.iconBtnLabel}>Stats</Text>
</TouchableOpacity>



      {/* Zoom controls */}
      <View style={{ flexDirection:'row', gap:4, flex:1 }}>
       
        <TouchableOpacity style={S.iconBtn} onPress={() => setSettingsOpen(o => !o)}>
   <MaterialCommunityIcons name="cog" size={16} color={C.ink} />
   <Text style={S.iconBtnLabel}>Settings</Text>
 </TouchableOpacity>
      </View>
    </View>
  );

  // ---------- player card ----------
  const PlayerSlot = ({ pid, isBenchRow }) => {
    const name = namesById?.[pid] || String(pid);
    const st = statusMeta(pid, extendedInfo);
    const fixtures = nextFixtures(pid, gw);
    const big = fixtures[0];
    const minis = fixtures.slice(1, 4);
    const inXI = current?.picks?.slice(0, 11).includes(pid);
    const isNew = newInsSet.has(pid);
    const tcOn = current?.chip === '3xc';
    const isCap = current?.cap === pid;
    const isVice = current?.vice === pid;

    const wStyle = isBenchRow ? S.playerImageBench : S.playerImage;
    const canReceiveBench = isBenchRow && benchFrom && isValidBenchTarget(pid);
    const canReceive    = benchFrom && isValidSwapTarget(pid);
    const isBenchSource = benchFrom === pid;

    const handleBenchQuick = () => {
      // First tap selects (XI or bench). Second tap completes to the target.
      if (!benchFrom) startBenchSwap(pid);
      else            completeBenchSwap(pid);
    };
    const handleTransferQuick = () => openTransfer(pid);

    const openActions = () => {
      const sp = getSellPriceTenths(pid) / 10;
      setActionModal({ open: true, pid, sellText: (sp || 0).toFixed(1) });
    };

    return (
      <View style={S.slot} key={pid}>
        <View style={[
          canReceive ? S.benchHighlight : isBenchSource ? S.benchFromGlow : null,
           
          (tcOn && isCap) ? S.tcOutline : null
        ]}>
          <TouchableOpacity onPress={openActions} activeOpacity={0.8}>
            <Image source={{ uri: crestFor(pid, teamNums) }} style={wStyle} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={handleBenchQuick} style={[S.overlayBtn, S.overlayLeft]} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <MaterialCommunityIcons name="swap-vertical" size={10} color="#000" />
        </TouchableOpacity>
        <TouchableOpacity onPress={handleTransferQuick} style={[S.overlayBtn, S.overlayRight]} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <MaterialCommunityIcons name="close-thick" size={10} color="#fff" />
        </TouchableOpacity>

        {isNew ? (
          <View style={S.newBadgeWrap}>
            <Image source={{ uri: NEW_BADGE_URI }} style={{ width: 12 * rem, height: 12 * rem }} />
          </View>
        ) : null}

        {isCap && (
          <View style={S.capBadge}>
            <Text style={S.capText}>{tcOn ? 'TC' : 'C'}</Text>
          </View>
        )}
        {isVice && (
          <View style={S.vcBadge}>
            <Text style={S.capText}>V</Text>
          </View>
        )}
        {(!!st.flag && !isNew) && (
          <View style={[S.statusBadge, { }]}>
            {true && <MaterialCommunityIcons name="flag-variant" size={13} color={st.flag.color} />}
          </View>
        )}

        <Text
          numberOfLines={1}
          ellipsizeMode="clip"
          allowFontScaling={false}
          style={[
            S.nameBar,
            (st.status != 'a') && { backgroundColor: st.flag.color, color: 'black' },
          ]}
        >
          {name}
        </Text>

        <Text
          numberOfLines={1}
          ellipsizeMode="clip"
          allowFontScaling={false}
          style={[
            S.fixNowBar,
            big
              ? { backgroundColor: big.color, color: big.textColor }
              : { backgroundColor: 'rgba(128,128,128,0.25)', color: '#000' },
          ]}
        >
          {big ? shortFixture(big.label) : '—'}
        </Text>

        <Text numberOfLines={1} ellipsizeMode="clip" allowFontScaling={false} style={[S.priceBar, !showMinis && S.bottomRounded]}>
          {money(getSellPriceTenths(pid))}
        </Text>

        {showMinis && minis.length > 0 && (
          <View style={[S.miniRow, S.bottomRounded]}>
            {minis.map((f, i) => (
              <Text
                key={`${pid}-m-${i}`}
                numberOfLines={1}
                ellipsizeMode="clip"
                allowFontScaling={false}
                style={[S.miniCell, { backgroundColor: f.color, color: f.textColor }]}
              >
                {tinyFixture(f.label)}
              </Text>
            ))}
            {Array.from({ length: Math.max(0, 3 - minis.length) }).map((_, i) => (
              <Text key={`pad-${pid}-${i}`} style={[S.miniCell, { color: '#000' }]}>{' '}</Text>
            ))}
          </View>
        )}
      </View>
    );
  };

  const TeamRow = ({ ids, isFirst, isBenchRow }) => (
    <View style={isFirst ? S.firstRow : S.row}>
      {ids.map((pid) => (
        <PlayerSlot key={pid} pid={pid} isBenchRow={isBenchRow} />
      ))}
    </View>
  );
const [statsOpen, setStatsOpen] = useState(false);
const [statsPid, setStatsPid] = useState(null); // ← hoist this out of TransferMarketModal
// Compare modal state
const [compareOpen, setCompareOpen] = useState(false);
const [statsListOpen, setStatsListOpen] = useState(false);

const [compareA, setCompareA] = useState(null);
const [compareB, setCompareB] = useState(null);


// Open compare prefilled with a player in slot A
const openCompareWith = useCallback((pid) => {
  setCompareA(pid);
  setCompareB(null);
  setCompareOpen(true);
}, []);
// Open compare with explicit A (outPid) and B (inPid)
const openCompareFromMarket = useCallback((outPid, inPid) => {
   setCompareA(outPid ?? null);
   setCompareB(inPid ?? null);
   setCompareOpen(true);
 }, []);

// ---- One-shot opener for openCompareWithPid (robust across re-focus) ----
// one-shot opener for openCompareWithPid
const openedFromParamRef = useRef(false);

// --- useFocusEffect block (no InteractionManager) ---
// --- useFocusEffect (capture param + always mark transition ended) ---
useFocusEffect(
  React.useCallback(() => {
    transitionEndedRef.current = false;
    openedFromParamRef.current = false;

    const pid = route?.params?.openCompareWithPid;
    if (pid) {
      pendingPidRef.current = Number(pid);
      try { navigation.setParams?.({ openCompareWithPid: undefined }); } catch {}

      // Immediate attempt for the “already focused / no animation” case:
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          transitionEndedRef.current = true;
          maybeOpenCompare();
        });
      });
    }

    const unsubscribe = navigation.addListener('transitionEnd', (e) => {
      if (e?.data?.closing) return;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          transitionEndedRef.current = true;
          maybeOpenCompare();
        });
      });
    });

    return () => {
      unsubscribe?.();
      transitionEndedRef.current = false;
    };
  }, [route?.params?.openCompareWithPid])
);





// formatted helper
const prettyVal = (k, v) => {
  if (v == null || Number.isNaN(Number(v))) return '—';
  const n = Number(v);
  if (/cost/i.test(k) || /^now_cost$/i.test(k) || /^costs?$/i.test(k)) return money(n);
  if (/_percent$/i.test(k) || /pct|ownership|tsb/i.test(k)) return `${(+n).toFixed(1)}%`;
  if (/^ep(_next|_this|_total)?$/i.test(k) || /^expected_points$/i.test(k)) return Number.isInteger(n) ? n : (+n).toFixed(1);
  return Number.isInteger(n) ? n : (+n).toFixed(2);
};


  // ---------- Action Sheet ----------
  const ActionSheet = () => {
    const pid = actionModal.pid;
    if (!pid || !current) return null;
    const name = namesById?.[pid] || String(pid);
    const st = statusMeta(pid, extendedInfo);
    const e = extFor(pid, extendedInfo);
const news = (e?.news || '').trim();
const [rankMode, setRankMode] = React.useState('overall'); // 'overall' | 'type'
const insets = useSafeAreaInsets();
    const inXI = current.picks.slice(0, 11).includes(pid);
  

 const nowPrice = money(Number(costs?.[pid] || 0));   // money() expects tenths

 const baseSell = useMemo(() => (getSellPriceTenths(pid) / 10), [pid, actionModal.open]);
 const [sellValue, setSellValue] = useState(() => baseSell);
 useEffect(() => { setSellValue(baseSell); }, [baseSell]);

 // Normalize current price to match sellValue units (x.y)
 const nowPriceNum = useMemo(() => {
   const tenths = Number(costs?.[pid] ?? e?.now_cost ?? 0); // tenths
   return isFinite(tenths) ? tenths / 10 : Infinity;        // x.y
 }, [pid, costs, e?.now_cost]);

 const STEP = 0.1;
 const EPS = 1e-9;
 const canInc = sellValue + EPS < nowPriceNum;  // recomputed every render


    

    const round1 = (n) => Math.round(n * 10) / 10;
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const minVal = useMemo(() => round1(baseSell - 0.5), [baseSell]);
    const maxVal = useMemo(() => round1(baseSell + 0.5), [baseSell]);
    const onStep = (delta) => setSellValue((v) => clamp(round1(v + delta), minVal, maxVal));
    const canSave = round1(sellValue) !== round1(baseSell);

    const onClose = () => setActionModal({ open: false, pid: null, sellText: '' });

    const doCap = () => { setCaptain(pid); onClose(); };
    const doVice = () => { setVice(pid); onClose(); };
    const doBench = () => {
      if (inXI) startBenchSwap(pid);
      else if (benchFrom) completeBenchSwap(pid);
      onClose();
    };
    const doTransferOut = () => { openTransfer(pid); onClose(); };

    const onSaveSell = () => {
      const sellTenths = Math.round(sellValue * 10);
      const nextOverrides = { ...(current.sellOverrides || {}) };
      nextOverrides[pid] = sellTenths;
      pushHistory({ type: 'edit-sell-override', pid, sell: sellTenths });
      patchWeekAndPropagate(gw, { sellOverrides: nextOverrides });
    };

// derive type + team safely
const typesMap = playersInfo?.types || {};
const teamsMap = playersInfo?.teams || {};
const elements  = playersInfo?.elements || {};

const ext = e || {}; // you already defined: const e = extFor(pid, extendedInfo);
const elementType = typesMap?.[pid] ?? ext?.element_type ?? elements?.[pid]?.element_type;
const posShort    = POS_NAME?.[elementType] || '';

const teamId      = ext?.team ?? elements?.[pid]?.team;

const teamLabel    = teamNameByPid?.[pid] || '';

const subtitle    = [posShort, teamLabel].filter(Boolean).join(' · ');
const fixtures    = nextFixtures(pid, gw) || [];
const headerTitle = subtitle ? `${name} — ${subtitle}` : name;

    return (
      <View pointerEvents={actionModal.open ? 'auto' : 'none'} style={[S.actionWrap, { display: actionModal.open ? 'flex' : 'none' }]}>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        // at the top of ActionSheet() add:

<View
  style={[
    S.actionCard,
    { maxHeight: SCREEN_H - insets.top - 16 } // <- cap by safe area
  ]}
>

          <View style={S.actionHeader}>
            <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
              {!!st.flag && (
                <MaterialCommunityIcons name="flag-variant" size={16} color={st.flag.color} />
              )}
              <Text style={S.actionTitle} numberOfLines={1}>{headerTitle}</Text>

{/* Compare button */}
<TouchableOpacity
  onPress={() => openCompareWith(pid)}
  style={{ marginLeft: 8, padding: 6, borderRadius: 12 }}
  hitSlop={{ top:8, bottom:8, left:8, right:8 }}
  accessibilityLabel="Compare player"
>
  <MaterialCommunityIcons name="scale-balance" size={18} color={C.ink} />
</TouchableOpacity>


  {/* X close in the top-right */}
  <TouchableOpacity onPress={onClose} style={S.sheetCloseBtn} hitSlop={8}>
    <MaterialCommunityIcons name="close" size={20} color={C.ink} />
  </TouchableOpacity>
            </View>
            

            {!!fixtures.length && (
  <View style={[S.marketMiniRow, { flexDirection:'row', alignItems:'center', justifyContent:'space-between' }]}>
    <View style={{ flex: 1, flexDirection:'row', flexWrap:'wrap' }}>
      {fixtures.slice(0, 7).map((f, i) => (
        <Text
          key={`asfx-${i}`}
          numberOfLines={1}
          style={[S.marketMiniCell, { backgroundColor: f.color, color: f.textColor }]}
        >
          {tinyFixture(f.label)}
        </Text>
      ))}
    </View>
    <TouchableOpacity
      onPress={() => openInfo(pid)}
      style={{ marginLeft: 8, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, flexShrink: 0, flexDirection:'row', alignItems:'center', gap:6 }}
      hitSlop={{ top:8, bottom:8, left:8, right:8 }}
      accessibilityLabel="Expand fixtures"
    >
      <MaterialCommunityIcons name="open-in-new" size={14} color={C.ink} />
      <Text style={{ color: C.ink, fontWeight: '700' }}>All Fixtures</Text>
    </TouchableOpacity>
  </View>
 )}
            

            
          </View>
          <ScrollView
    style={{ maxHeight: Math.floor(Dimensions.get('window').height * 0.7) }}
    contentContainerStyle={{ paddingBottom: 12 }}
    keyboardShouldPersistTaps="handled"
    nestedScrollEnabled
  >

  {news ? (
  <View style={S.newsBox}>
    <Text style={S.newsText}>{news}</Text>
  </View>
) : null}

  <View style={S.sellBox}>
            <Text style={{ color: C.ink, fontWeight: '800' }}>Sell price</Text>
            <View style={{ flexDirection:'row', alignItems:'center', gap: 6 }}>
              <TouchableOpacity onPress={() => onStep(-0.1)} style={S.smallBtn}><Text style={S.smallBtnTxt}>–</Text></TouchableOpacity>
              <Text style={[S.smallBtnTxt, { minWidth: 44, textAlign:'center' }]}>{sellValue.toFixed(1)}</Text>
              <TouchableOpacity
  onPress={() => canInc && setSellValue(v => Math.min(v + STEP, nowPriceNum))}
  disabled={!canInc}
  style={S.smallBtn}   // optional visual disable
  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
>
  <Text style={S.smallBtnTxt}>+</Text>
</TouchableOpacity>

            </View>
            <TouchableOpacity onPress={onSaveSell} disabled={!canSave} style={[S.smallBtn, !canSave && { opacity: 0.45 }]}>
              <MaterialCommunityIcons name="content-save" size={14} color={C.ink} />
              <Text style={S.smallBtnTxt}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} style={S.smallBtn}>
              <MaterialCommunityIcons name="close" size={14} color={C.ink} />
              <Text style={S.smallBtnTxt}>Close</Text>
            </TouchableOpacity>
          </View>

          <View style={S.actionList}>
          
<TouchableOpacity style={S.actionRow}  onPress={() => openCompareWith(pid)}>
              <MaterialCommunityIcons name="scale-balance" size={18} color={C.ink} />
              <Text style={S.actionRowText}>Compare</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[S.actionRow, !inXI && { opacity: 0.4 }]} disabled={!inXI} onPress={doCap}>
              <MaterialCommunityIcons name="crown-outline" size={18} color={C.ink} />
              <Text style={S.actionRowText}>Make Captain</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[S.actionRow, !inXI && { opacity: 0.4 }]} disabled={!inXI} onPress={doVice}>
              <MaterialCommunityIcons name="shield-star-outline" size={18} color={C.ink} />
              <Text style={S.actionRowText}>Make Vice Captain</Text>
            </TouchableOpacity>

            <TouchableOpacity style={S.actionRow} onPress={doTransferOut}>
              <MaterialCommunityIcons name="close-thick" size={18} color={C.ink} />
              <Text style={S.actionRowText}>Transfer Out</Text>
            </TouchableOpacity>

            <TouchableOpacity style={S.actionRow} onPress={doBench}>
              <MaterialCommunityIcons name="swap-vertical" size={18} color={C.ink} />
              <Text style={S.actionRowText}>{inXI ? 'Bench (start swap)' : (benchFrom ? 'Place from Bench (complete)' : 'Bench')}</Text>
            </TouchableOpacity>
          </View>
         
{/* --- Expand to full statistics (inline, under KPI grid) --- */}
<View style={S.expandWrap}>
  {/* optional subtle fade to imply more below */}
  <View style={S.expandFade} />

  <TouchableOpacity
    onPress={() => { setStatsPid(pid); setStatsOpen(true); }}
    style={S.expandRow}
    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    accessibilityLabel="Show all statistics"
  >
    <MaterialCommunityIcons name="chevron-down" size={16} color={C.ink} />
    <Text style={S.expandText}>Show all statistics</Text>
  </TouchableOpacity>
   {/* --- Major stats with ranks (FPL-like tiles) --- */}
{(() => {
  const e = extFor(pid, extendedInfo) || {};
  const priceTenths = Number(costs?.[pid] ?? e?.now_cost ?? 0);

  // Build the display list (graceful if missing)
  const majors = [
    { key: 'now_cost',            label: 'Price',        value: priceTenths,                     fmt: (v) => money(v) },
    { key: 'form',                label: 'Form',         value: asNumber(e?.form) },
    { key: 'points_per_game',     label: 'Pts / Match',  value: asNumber(e?.points_per_game) },
    { key: 'goals_scored',        label: `Goals`,  value: asNumber(e?.goals_scored) },
    { key: 'assists',        label: `Assists`,  value: asNumber(e?.assists) },
    { key: 'total_points',        label: 'Total Pts',    value: asNumber(e?.total_points) },
    { key: 'bonus',               label: 'Total Bonus',  value: asNumber(e?.bonus) },
    { key: 'ict_index',           label: 'ICT Index',    value: asNumber(e?.ict_index) },
    { key: 'selected_by_percent', label: 'TSB %',        value: asNumber(e?.selected_by_percent), fmt: (v)=> `${(+v).toFixed(1)}%` },
    { key: 'defensive_contribution_per_90',           label: 'DEFCON Per 90',    value: asNumber(e?.defensive_contribution_per_90) },
  ].filter(m => Number.isFinite(m.value));

  if (majors.length === 0) return null;

  return (
    
  

// ... later in the JSX where stats appear:

<View style={S.kpiWrap}>
<RankModeToggle mode={rankMode} onChange={setRankMode} C={C} />
<Text style={[S.kpiTitle, { textAlign: 'center', opacity: 0.7,marginBottom:4 }]} numberOfLines={2}>
            Toggle to view Overall or Position ranks. Stars mark top-10 (★★) and top-20 (★)
          </Text>
  {majors.map(m => (
    <StatKPICard
      key={`kpi-${m.key}`}
      label={m.label}
      value={m.value}
      fmt={m.fmt}
      pid={pid}
      statKey={m.key}
      mode={rankMode}
      C={C}
    />
  ))}
  
</View>



);

})()}
</View>


          
          </ScrollView>
        </View>
        
      </View>
    );
  };

// --- MiniSelectModal (Prices-style, smooth on Android; no isDark prop needed) ---
const MiniSelectModal = ({ visible, title, options, selected, onSelect, onClose, C }) => {
  if (!visible) return null;

  // Derive dark/light from C.bg (same luminance trick you use later in this file)
  let isDark = false;
  try {
    const hex = String(C.bg || '#ffffff').replace('#','');
    if (hex.length >= 6) {
      const r = parseInt(hex.slice(0,2),16)/255;
      const g = parseInt(hex.slice(2,4),16)/255;
      const b = parseInt(hex.slice(4,6),16)/255;
      const l = 0.2126*r + 0.7152*g + 0.0722*b;
      isDark = l < 0.5;
    }
  } catch {}

  return (
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
              const val = opt?.value ?? opt?.key ?? null;
              const label = String(opt?.label ?? val ?? '—');
              const active = selected === val || (selected == null && val == null);
              return (
                <TouchableOpacity key={String(val)} onPress={() => { onSelect(val); onClose(); }} activeOpacity={0.85}>
                  <View style={{
                    paddingVertical:10, paddingHorizontal:10,
                    borderTopWidth:1, borderColor: isDark ? '#1e2638' : '#e2e8f0',
                    backgroundColor: active ? (isDark ? '#1b2a4a' : '#dbeafe') : 'transparent'
                  }}>
                    <Text style={{ fontWeight: active ? '900' : '700', color: active ? '#0f172a' : (isDark ? '#e6eefc' : '#0f172a') }}>
                      {label}
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
};


 
const CompareModal = () => {
  const C = useColors();
  if (!compareOpen) return null;

// --- CONFIG: how many upcoming fixtures to compare
const FIX_HORIZON = 5; // change to 4/5 if you want

// expected shape for nextFixtures[pid][i]:
// { oppShort: 'BRE', fdr: 2|3|4|5, home: true|false, gw: number }
// If your shape differs, adapt the mapping in getFixturesForPid() below.
const safeNumber = (x, d=0) => (Number.isFinite(+x) ? +x : d);

// Pull next N fixtures for a player from your nextFixtures map
 const getFixturesForPid = (pid, n = FIX_HORIZON) => {
   const list = nextFixtures(pid, gw) || [];   // this already returns {label,color,textColor,gw}
   return list.slice(0, n).map(item => {
     const s = shortFixture(item.label);       // "BRE (H)" / "MCI (A)"
     const home = /\(H\)/.test(s);
     const opp  = s.replace(/\s*\((H|A)\)\s*$/, '');
     const { d } = getRatingAndColor(item.label);  // numeric FDR for the badge
     return { opp, home, gw: item.gw, fdr: d, color: item.color, textColor: item.textColor };
   });
 };

// Lower is easier (FDR: 1 easiest ... 5 hardest)
const fixturesEaseScore = (arr) => arr.reduce((s, fx) => s + safeNumber(fx.fdr, 3), 0);

// Tiny pill for one fixture
const FixturePill = ({ fx, C }) => (
  <View
    style={{
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: 10,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.border,
      backgroundColor: C.card,
      gap: 6,
      minHeight: 22,
    }}
  >
    <Text style={{ fontSize: 11, color: C.muted }}>
      {fx.opp}{fx.home ? ' (H)' : ' (A)'}
    </Text>
    <View
      style={{
        minWidth: 18,
        height: 18,
        borderRadius: 9,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: StyleSheet.hairlineWidth, borderColor: 'transparent',
      backgroundColor: fx.color ?? C.bg,
      }}
    >
      <Text style={{ fontSize: 11, color: fx.textColor ?? C.ink }}>{fx.fdr}</Text>
    </View>
  </View>
);

// A horizontal row of pills
const MiniFixturesStrip = ({ fixtures, C }) => (
  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
    {fixtures.map((fx, i) => <FixturePill key={i} fx={fx} C={C} />)}
  </View>
);

// The comparison row to inject at the top
const FixturesCompareRow = ({ pidA, pidB, C }) => {
  const fixturesA = useMemo(() => getFixturesForPid(pidA), [pidA, nextFixtures]);
  const fixturesB = useMemo(() => getFixturesForPid(pidB), [pidB, nextFixtures]);
const nameA = useMemo(() => (namesById?.[pidA] || String(pidA)), [pidA, namesById]);
  const nameB = useMemo(() => (namesById?.[pidB] || String(pidB)), [pidB, namesById]);
  const scoreA = fixturesEaseScore(fixturesA);
  const scoreB = fixturesEaseScore(fixturesB);
  const winner = scoreA < scoreB ? 'A' : scoreB < scoreA ? 'B' : 'TIE';

  const crown = (
    <View style={{
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
      backgroundColor: C.bg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.border,
      alignSelf: 'flex-start',
    }}>
      <Text style={{ fontSize: 11, color: C.ink }}>Easier</Text>
    </View>
  );

  return (
    <View
      style={{
        marginTop: 8,
        marginBottom: 8,
        padding: 12,
        backgroundColor: C.card,
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: C.border,
        gap: 10,
      }}
    >
      <Text style={[S.kpiTitle, { color: C.muted, textAlign: 'center' }]}>
        Fixtures (next {FIX_HORIZON})
      </Text>

      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={[S.kpiTitle, { color: C.ink }]}>{nameA}</Text>
            {winner === 'A' && crown}
          </View>
          <MiniFixturesStrip fixtures={fixturesA} C={C} />
          <Text style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
            Ease score: {scoreA} (lower is easier)
          </Text>
        </View>

        <View style={{ width: 1, backgroundColor: C.border, alignSelf: 'stretch' }} />

        <View style={{ flex: 1, gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={[S.kpiTitle, { color: C.ink }]}>{nameB}</Text>
            {winner === 'B' && crown}
          </View>
          <MiniFixturesStrip fixtures={fixturesB} C={C} />
          <Text style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
            Ease score: {scoreB} (lower is easier)
          </Text>
        </View>
      </View>
    </View>
  );
};

  // ---------- helpers ----------
  const STAT_LABELS = {
    now_cost: 'Price',
    cost: 'Price',
    selected_by_percent: 'Selected By %',
    ownership_percent: 'Ownership %',
    ict_index: 'ICT Index',
    influence: 'Influence',
    creativity: 'Creativity',
    threat: 'Threat',
    ep_next: 'Expected Pts (Next)',
    ep_this: 'Expected Pts (This)',
    ep_total: 'Expected Pts (Total)',
    expected_points: 'Expected Points',
    points_per_game: 'Pts/Game',
    form: 'Form',
    total_points: 'Total Points',
    goals_scored: 'Goals',
    assists: 'Assists',
    clean_sheets: 'Clean Sheets',
    saves: 'Saves',
    bonus: 'Bonus',
    bps: 'BPS',
    yellow_cards: 'Yellows',
    red_cards: 'Reds',
    penalties_missed: 'Pens Missed',
    penalties_saved: 'Pens Saved',
    minutes: 'Minutes',
    xg: 'xG',
    xa: 'xA',
    xgi: 'xGI',
    xgc: 'xGC',
    npxg: 'npxG',
    npxgi: 'npxGI',
    starts: 'Starts',
    xg_per90: 'xG/90',
    xa_per90: 'xA/90',
    xgi_per90: 'xGI/90',
    defcon: 'DefCon',
    defcon_per90: 'DefCon/90',
  };



  const titleCase = (s) =>
    String(s || '')
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/(^|\s)\S/g, (m) => m.toUpperCase());

  const getStatLabel = (k) => {
    if (!k) return '—';
    try {
      if (typeof pretty === 'function') {
        const out = pretty(k);
        if (out && typeof out === 'string') return out;
      }
    } catch {}
    if (STAT_LABELS[k]) return STAT_LABELS[k];
    if (/_percent$/i.test(k) || /pct/i.test(k)) return titleCase(k.replace(/_percent$/i, ' %').replace(/pct/i, '%'));
    if (/^ep_/i.test(k)) return titleCase(k.replace(/^ep_/i, 'Expected Pts '));
    return titleCase(k);
  };

  const prettyVal = (k, v) => {
    if (v == null || Number.isNaN(Number(v))) return '—';
    const n = Number(v);
    if (/cost/i.test(k) || /^now_cost$/i.test(k) || /^costs?$/i.test(k)) return money(n);
    if (/_percent$/i.test(k) || /pct|ownership|tsb/i.test(k)) return `${(+n).toFixed(1)}%`;
    if (/^ep(_next|_this|_total)?$/i.test(k) || /^expected_points$/i.test(k)) return Number.isInteger(n) ? n : (+n).toFixed(1);
    return Number.isInteger(n) ? n : (+n).toFixed(2);
  };

  const close = () => setCompareOpen(false);

  // ---------- base data ----------
  const elements  = playersInfo?.elements || {};
  const names     = playersInfo?.players  || {};
  const typesMap  = playersInfo?.types    || {};
  const positionOf = (pid) => {
    const p = Number(pid);
    return typesMap?.[p] ?? elements?.[p]?.element_type ?? null;
  };
  const totalPtsOf = (pid) => {
    const e = extendedInfo?.[String(pid)];
    return Number.isFinite(+e?.total_points) ? +e.total_points : 0;
  };

  const keys = React.useMemo(() => {
    if (Array.isArray(extRanks?.keys) && extRanks.keys.length) return extRanks.keys;
    const overall = extRanks?.overall || {};
    return Object.keys(overall);
  }, [extRanks]);

  // ---------- filters + search ----------
  const [search, setSearch] = React.useState('');
  const [posFilter, setPosFilter] = React.useState(null);
  const [teamFilter, setTeamFilter] = React.useState(null);


  React.useEffect(() => {
    if (compareOpen && compareA) {
      const p = positionOf(compareA);
      setPosFilter(p ?? null);
    }
  }, [compareOpen, compareA]);

  React.useEffect(() => {
    if (compareA && compareB) {
      setPosFilter(null);
      setTeamFilter(null);
      setSearch('');
      
    }
  }, [compareA, compareB]);

  const allCandidates = React.useMemo(() => {
    if (!playersInfo) return [];
    return Object.keys(names).map(pidStr => {
      const pid = Number(pidStr);
      return {
        id: pid,
        name: names[pid],
        pos: positionOf(pid),
        teamName: teamNameByPid?.[pid] || '',
        totalPts: totalPtsOf(pid),
      };
    });
  }, [playersInfo, names, teamNameByPid, extendedInfo]);

  const filtered = React.useMemo(() => {
    const s = search.trim().toLowerCase();
    return allCandidates
      .filter(r => {
        if (r.id === compareA || r.id === compareB) return false;
        if (posFilter && r.pos !== posFilter) return false;
        if (teamFilter && r.teamName !== teamFilter) return false;
        if (s && !String(r.name || '').toLowerCase().includes(s)) return false;
        return true;
      })
      .sort((a,b) => {
        if (b.totalPts !== a.totalPts) return b.totalPts - a.totalPts;
        return String(a.name).localeCompare(String(b.name));
      });
  }, [allCandidates, search, posFilter, teamFilter, compareA, compareB]);

  const availableTeams = React.useMemo(() => {
    const set = new Set();
    for (const pidStr of Object.keys(names || {})) {
      const pid = Number(pidStr);
      const t = teamNameByPid?.[pid];
      if (t) set.add(t);
    }
    return Array.from(set).sort();
  }, [names, teamNameByPid]);

  const pickSlot = (slot, pid) => {
    if (slot === 'A') setCompareA(pid);
    else setCompareB(pid);
  };
  const pickAuto = (pid) => {
    if (!compareA) setCompareA(pid);
    else if (!compareB) setCompareB(pid);
    else setCompareB(pid);
  };
  const [cmpTeamPicker, setCmpTeamPicker] = React.useState(false);


  // ---------- rows ----------
  const rows = React.useMemo(() => {
    if (!compareA || !compareB || !extendedInfo) return { topRows: [], restRows: [] };

    const eA = extendedInfo[String(compareA)] || {};
    const eB = extendedInfo[String(compareB)] || {};
    const isZero = (v) => Number.isFinite(Number(v)) && Number(v) === 0;

    const findKey = (aliases) => {
      for (const cand of aliases) {
        if (cand in eA || cand in eB) return cand;
        const alt = String(cand).toLowerCase();
        const matched = Object.keys({ ...eA, ...eB }).find(k => k.toLowerCase() === alt);
        if (matched) return matched;
      }
      return null;
    };

    const usedKeys = new Set();
    const topRows = [];
    for (const labelName of TOP_ORDER) {
      const aliases = TOP_KEY_ALIASES[labelName] || [];
      const key = findKey(aliases);
      if (!key || usedKeys.has(key)) continue;

      const vA = eA?.[key];
      const vB = eB?.[key];
      const bothMissing = (vA == null && vB == null);
      const bothZero = isZero(vA) && isZero(vB);
      if (bothMissing || bothZero) continue;

      const rA = extRanks?.overall?.[key]?.[compareA] ?? Infinity;
      const rB = extRanks?.overall?.[key]?.[compareB] ?? Infinity;

      usedKeys.add(key);
      topRows.push({ k: key, vA, vB, rA, rB, minR: Math.min(rA, rB) });
    }

    const rest = [];
    const allKeys = keys && keys.length ? keys : Object.keys({ ...eA, ...eB });
    for (const k of allKeys) {
      if (usedKeys.has(k)) continue;
      const vA = eA?.[k];
      const vB = eB?.[k];
      const bothMissing = (vA == null && vB == null);
      const bothZero = isZero(vA) && isZero(vB);
      if (bothMissing || bothZero) continue;

      const rA = extRanks?.overall?.[k]?.[compareA] ?? Infinity;
      const rB = extRanks?.overall?.[k]?.[compareB] ?? Infinity;

      rest.push({ k, vA, vB, rA, rB, minR: Math.min(rA, rB) });
    }

    rest.sort((a,b) => {
      if (a.minR !== b.minR) return a.minR - b.minR;
      const az = (Number(a.vA) === 0 && Number(a.vB) === 0) ? 1 : 0;
      const bz = (Number(b.vA) === 0 && Number(b.vB) === 0) ? 1 : 0;
      if (az !== bz) return az - bz;
      return getStatLabel(a.k).localeCompare(getStatLabel(b.k));
    });

    return { topRows, restRows: rest };
  }, [compareA, compareB, extendedInfo, extRanks, keys]);

  const nameA = names?.[compareA] || String(compareA || '—');
  const nameB = names?.[compareB] || (compareB ? String(compareB) : 'Pick player');

  const showPicker =
    (!compareA || !compareB) ||
    search.length > 0 || posFilter != null || teamFilter != null;

  // thead is the sticky element (direct child)
  const stickyIndex = showPicker ? 3 : 2;

  // ---------- UI ----------
  return (
    <Modal visible transparent animationType="none" onRequestClose={close}>
      <View
        pointerEvents="auto"
        style={[
          S.centerWrapDim,
          {
            backgroundColor: C.dim ?? 'rgba(0,0,0,0.5)',
            justifyContent: 'center',
            alignItems: 'center',
            paddingHorizontal: 12,
          }
        ]}
      >
        {/* Backdrop catches outside taps, but doesn't block scroll on the card */}
        <Pressable onPress={close} style={StyleSheet.absoluteFill} />

        <View
          style={[
            S.statsCard,
            {
              overflow: 'hidden',
              backgroundColor: C.card,
              borderColor: C.border,
              borderWidth: StyleSheet.hairlineWidth,
              maxHeight: '75%',
              width: '94%',
              borderRadius: 14,
            }
          ]}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 12 }}
            stickyHeaderIndices={[stickyIndex]}
          >
            {/* Header */}
            <View style={[S.actionHeader, { paddingRight: 44, minHeight: 44, backgroundColor: C.card }]}>
              <Text style={[S.actionTitle, { flex: 1, color: C.ink }]} numberOfLines={1}>
                Compare Players
              </Text>
              <TouchableOpacity
                onPress={close}
                style={{ position:'absolute', right:8, top:8, padding:6, borderRadius:12 }}
                hitSlop={{ top:8, bottom:8, left:8, right:8 }}
                accessibilityLabel="Close compare"
              >
                <MaterialCommunityIcons name="close" size={20} color={C.ink} />
              </TouchableOpacity>
            </View>

            {/* Search + filters */}
            <View style={{ padding:12, gap:8, backgroundColor: C.card }}>
            
              <ThemedTextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search players to change comparison…"
                style={{ height: 36, color: C.ink, backgroundColor: C.page }}
                placeholderTextColor={C.muted ?? '#888'}
                returnKeyType="search"
              />

              <View style={{ flexDirection:'row', flexWrap:'wrap', gap:8, alignItems:'center' }}>
                {[
                  { label:'All', val:null },
                  { label:'GK', val:1 }, { label:'DEF', val:2 },
                  { label:'MID', val:3 }, { label:'FWD', val:4 },
                ].map(p => (
                  <TouchableOpacity
                    key={`pos-${String(p.val)}`}
                    onPress={() => setPosFilter(p.val)}
                    style={[
                      S.miniBtn,
                      {
                        borderColor: (posFilter === p.val) ? (C.accent || C.ink) : C.border,
                        backgroundColor: 'transparent'
                      }
                    ]}
                  >
                    <Text style={[
                      S.miniBtnTxt,
                      { color: (posFilter === p.val) ? (C.accent || C.ink) : C.ink }
                    ]}>
                      {p.label}
                    </Text>
                  </TouchableOpacity>
                ))}

                <TouchableOpacity
                  
                  onPress={() => setCmpTeamPicker(true)}

                  style={[
                    S.miniBtn,
                    { borderColor: C.border, flexDirection:'row', alignItems:'center', gap:6 }
                  ]}
                  accessibilityLabel="Team filter"
                >
                  <MaterialCommunityIcons name="account-group" size={14} color={C.ink} />
                  <Text style={[S.miniBtnTxt, { color: C.ink }]}>
                    {teamFilter == null ? 'All Teams' : `Team: ${teamFilter}`}
                  </Text>
                  <MaterialCommunityIcons name="chevron-down" size={16} color={C.ink} />
                </TouchableOpacity>
              </View>

                           <MiniSelectModal
  visible={cmpTeamPicker}
  title="Choose Team"
  C={C}
 
  options={[{ label: 'All Teams', value: null }].concat(
    (availableTeams || []).map(t =>
      typeof t === 'string'
        ? ({ label: String(t), value: String(t) })
        : ({ label: t.name || String(t.code), value: t.code ?? t.name })
    )
  )}
  selected={teamFilter ?? null}
  onSelect={(val) => setTeamFilter(val)}
  onClose={() => setCmpTeamPicker(false)}
/>


            </View>

            {/* Suggestions */}
            {showPicker ? (
              <View style={{ maxHeight: 240, borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.border, backgroundColor: C.page, marginHorizontal: 12, borderRadius: 8, overflow:'hidden' }}>
                <FlatList
                  data={filtered}
                  keyExtractor={(r) => String(r.id)}
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item }) => (
                    <View style={[S.rowItem, { backgroundColor: C.page, borderColor: C.border, borderBottomWidth: StyleSheet.hairlineWidth, alignItems:'center' }]}>
                      <TouchableOpacity
                        onPress={() => pickAuto(item.id)}
                        style={{ flexDirection:'row', alignItems:'center', gap:8, flex:1, minWidth: 0, paddingVertical: 6 }}
                      >
                        <Image
                          source={{ uri: crestFor(item.id, teamNums) }}
                          style={{ width: 18, height: 18, resizeMode:'contain' }}
                        />
                        <Text style={[S.rName, { color: C.ink, flexShrink:1 }]} numberOfLines={1}>{item.name}</Text>
                      </TouchableOpacity>
                      <View style={{ flexDirection:'row', gap:8 }}>
                        <TouchableOpacity onPress={() => pickSlot('A', item.id)} style={[S.miniBtn, { borderColor: C.border }]}>
                          <Text style={[S.miniBtnTxt, { color: C.ink }]}>Set A</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => pickSlot('B', item.id)} style={[S.miniBtn, { borderColor: C.border }]}>
                          <Text style={[S.miniBtnTxt, { color: C.ink }]}>Set B</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                />
              </View>
            ) : null}

            {/* ===== THEAD: sticky Player A / Player B header ===== */}
            <View
              style={{
                width: '100%',
                alignSelf: 'stretch',
                backgroundColor: C.card,
                borderTopWidth: StyleSheet.hairlineWidth,
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderColor: C.border,
                zIndex: 10,
                elevation: 2,
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'nowrap',
                  paddingVertical: 12,
                  paddingHorizontal: 12,
                }}
              >
                <View style={{ flex: 1, minWidth: 62, overflow: 'hidden' }}>
  <Text
    style={[
      S.kpiTitle,
      { color: C.muted, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.4 },
    ]}
    numberOfLines={1}
    ellipsizeMode="tail"
  >
    Stat
  </Text>
</View>


                <View style={{ width: 120, minWidth: 120, alignItems: 'flex-end' }}>
                  <Text style={[S.kpiValue, { color: C.ink, fontSize: 17, fontWeight: '900' }]} numberOfLines={1}>
                    {nameA}
                  </Text>
                  <Text style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Player A</Text>
                </View>

                <Text style={{ opacity: 0.5, paddingHorizontal: 8, color: C.ink }}>vs</Text>

                <View style={{ width: 120, minWidth: 120, alignItems: 'flex-start' }}>
                  <Text style={[S.kpiValue, { color: C.ink, fontSize: 17, fontWeight: '900' }]} numberOfLines={1}>
                    {nameB}
                  </Text>
                  <Text style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Player B</Text>
                </View>
              </View>
            </View>
            {/* ===== END THEAD ===== */}
<CompareRadar
  pidA={compareA}
  pidB={compareB}
  nameA={nameA}
  nameB={nameB}
  extendedInfo={extendedInfo}
  extRanks={extRanks}
/>

            {/* Comparison: Top Stats, then Rest */}
            <View style={{ padding:12, backgroundColor: C.card, gap: 12 }}>
              {(!compareA || !compareB) ? (
                <Text style={{ opacity:0.7, color: C.muted }}>Pick both players to see the comparison.</Text>
              ) : (
                <>
                  {rows.topRows.length > 0 && (
                    <View>
                      <Text style={[S.kpiTitle, { color: C.muted, marginBottom: 6 }]}>Top Stats</Text>
                      <FixturesCompareRow pidA={compareA} pidB={compareB} C={C} />
                      <View style={{ gap:6 }}>
                        {rows.topRows.map(({ k, vA, vB, rA, rB }) => {
                          const label = getStatLabel(k);
                          const winA = rA < rB;
                          const winB = rB < rA;
                          return (
                            <View
                              key={`top-${k}`}
                              style={[
                                S.rowItem,
                                {
                                  alignItems:'center',
                                  backgroundColor: C.page,
                                  borderColor: C.border,
                                  borderBottomWidth: StyleSheet.hairlineWidth,
                                  paddingVertical: 8
                                }
                              ]}
                            >
                            <View style={{ flex: 1, minWidth: 62, overflow: 'hidden' }}>
  <Text
    style={[S.rName, { color: C.ink, fontSize: 10, lineHeight: 16 }]}
    numberOfLines={3}
    ellipsizeMode="tail"
  >
    {label}
  </Text>
</View>


                              <View style={{ width: 120, alignItems:'center', flexDirection:'row', justifyContent:'flex-end' }}>
                                {winA ? <MaterialCommunityIcons name="crown" size={14} color="#d4af37" /> : null}
                                <Text style={[S.kpiValue, { color: C.ink, marginLeft: 6 }, winA && { fontWeight:'800' }]} numberOfLines={1}>
                                  {prettyVal(k, vA)}
                                </Text>
                              </View>
                              <Text style={{ opacity:0.5, paddingHorizontal:8, color: C.ink }}>vs</Text>
                              <View style={{ width: 120, alignItems:'center', flexDirection:'row', justifyContent:'flex-start' }}>
                                <Text style={[S.kpiValue, { color: C.ink, marginRight: 6 }, winB && { fontWeight:'800' }]} numberOfLines={1}>
                                  {prettyVal(k, vB)}
                                </Text>
                                {winB ? <MaterialCommunityIcons name="crown" size={14} color="#d4af37" /> : null}
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  )}

                  {rows.restRows.length > 0 && (
                    <View>
                      {rows.topRows.length > 0 && (
                        <Text style={[S.kpiTitle, { color: C.muted, marginTop: 8, marginBottom: 6 }]}>More</Text>
                      )}
                      <View style={{ gap:6 }}>
                        {rows.restRows.map(({ k, vA, vB, rA, rB }) => {
                          const label = getStatLabel(k);
                          const winA = rA < rB;
                          const winB = rB < rA;
                          return (
                            <View
                              key={`rest-${k}`}
                              style={[
                                S.rowItem,
                                {
                                  alignItems:'center',
                                  backgroundColor: C.page,
                                  borderColor: C.border,
                                  borderBottomWidth: StyleSheet.hairlineWidth,
                                  paddingVertical: 8
                                }
                              ]}
                            >
                              <View style={{ flex: 1, minWidth: 62, overflow: 'hidden' }}>
  <Text
    style={[S.rName, { color: C.ink, fontSize: 10, lineHeight: 16 }]}
    numberOfLines={3}
    ellipsizeMode="tail"
  >
    {label}
  </Text>
</View>

                              <View style={{ width: 120, alignItems:'center', flexDirection:'row', justifyContent:'flex-end' }}>
                                {winA ? <MaterialCommunityIcons name="crown" size={14} color="#d4af37" /> : null}
                                <Text style={[S.kpiValue, { color: C.ink, marginLeft: 6 }, winA && { fontWeight:'800' }]} numberOfLines={1}>
                                  {prettyVal(k, vA)}
                                </Text>
                              </View>
                              <Text style={{ opacity:0.5, paddingHorizontal:8, color: C.ink }}>vs</Text>
                              <View style={{ width: 120, alignItems:'center', flexDirection:'row', justifyContent:'flex-start' }}>
                                <Text style={[S.kpiValue, { color: C.ink, marginRight: 6 }, winB && { fontWeight:'800' }]} numberOfLines={1}>
                                  {prettyVal(k, vB)}
                                </Text>
                                {winB ? <MaterialCommunityIcons name="crown" size={14} color="#d4af37" /> : null}
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  )}
                </>
              )}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};





const SeasonStatsModal = () => {
  if (!statsOpen || !statsPid) return null;

  const insets = useSafeAreaInsets();
  const topPad = Math.max(insets?.top || 0, 16); // breathing room at the very top

  const e = extFor(statsPid, extendedInfo) || {};
  const st = statusMeta(statsPid, extendedInfo);
  const name = namesById?.[statsPid] || String(statsPid);

  // --- helpers ---
  const isZeroStat = (v) => {
    if (v === null || v === undefined) return false;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n === 0;
  };

  const [rankMode, setRankMode] = useState('overall'); // 'overall' | 'type'

  // Subtitle + fixtures (match ActionSheet)
  const elements   = playersInfo?.elements || {};
  const elementRaw = e?.element_type ?? elements?.[statsPid]?.element_type;
  const posShort   = POS_NAME?.[elementRaw] || '';
  const teamLabel  = teamNameByPid?.[statsPid] || '';
  const subtitle   = [posShort, teamLabel].filter(Boolean).join(' · ');
  const headerTitle = subtitle ? `${name} — ${subtitle}` : name;

  const fixtures   = nextFixtures(statsPid, gw) || [];
  const news       = (e?.news || '').trim();

  // Priorities (first 9 like ActionSheet)
  const FRONT_KEYS = [
    'now_cost','form','points_per_game','selected_by_percent',
    'expected_points','ep_next','ict_index','threat','creativity',
    'influence','minutes','goals_scored','assists','clean_sheets'
  ];

  const HIDE = typeof EXT_HIDE_KEYS !== 'undefined' ? EXT_HIDE_KEYS : new Set([
    'news','photo','photo_mobile','id','code','element_type','team',
    'web_name','first_name','second_name','special','squad_number'
  ]);

  const fmtVal = (k, v) => {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (typeof v === 'number') {
      if (/cost/i.test(k) || /^now_cost$/i.test(k)) return money(v);
      if (/_percent$/i.test(k) || /^selected_by_percent$/i.test(k)) return `${(+v).toFixed(1)}%`;
      if (/^ep(_next|_this|_total)?$/i.test(k) || /^expected_points$/i.test(k))
        return Number.isInteger(v) ? v : (+v).toFixed(1);
      return Number.isInteger(v) ? v : (+v).toFixed(2);
    }
    const n = Number(v);
    if (!Number.isNaN(n) && v?.trim?.() !== '') {
      if (/cost/i.test(k) || /^now_cost$/i.test(k)) return money(n);
      if (/_percent$/i.test(k) || /^selected_by_percent$/i.test(k)) return `${n.toFixed(1)}%`;
      return Number.isInteger(n) ? n : n.toFixed(2);
    }
    return String(v);
  };

  // Collect rankable entries from extended row
  const rawEntries = Object.entries(e)
    .filter(([k, v]) =>
      !HIDE.has(k) &&
      ['string','number','boolean'].includes(typeof v) &&
      v !== '' && v !== null
    );

  const seen = new Set();
  const entries = rawEntries.filter(([k]) => (seen.has(k) ? false : (seen.add(k), true)));

  const frontActual = [];
  for (const k of FRONT_KEYS) {
    const idx = entries.findIndex(([ek]) => ek === k);
    if (idx !== -1) frontActual.push(entries[idx]);
    if (frontActual.length >= 9) break;
  }
  const frontKeysSet = new Set(frontActual.map(([k]) => k));
  const rest = entries
    .filter(([k]) => !frontKeysSet.has(k))
    .sort((a, b) => a[0].localeCompare(b[0]));

  const withRanks = [...frontActual, ...rest].map(([k, v]) => {
    const over = getOverallRank(statsPid, k);
    const typ  = getTypeRank(statsPid, k);
    const { overallDen, typeDen } = getRankDenoms(k, statsPid);
    return { k, v, over, typ, overallDen, typeDen };
  }).filter(it =>
    (Number.isFinite(it.over) && it.overallDen) ||
    (Number.isFinite(it.typ)  && it.typeDen)
  );

  // Sort by chosen scope asc; zero values sink to bottom
  const BIG = 1e9;
  const sorted = withRanks.sort((a, b) => {
    const aRank = rankMode === 'overall'
      ? (Number.isFinite(a.over) ? a.over : Infinity)
      : (Number.isFinite(a.typ)  ? a.typ  : Infinity);

    const bRank = rankMode === 'overall'
      ? (Number.isFinite(b.over) ? b.over : Infinity)
      : (Number.isFinite(b.typ)  ? b.typ  : Infinity);

    const aScore = aRank + (isZeroStat(a.v) ? BIG : 0);
    const bScore = bRank + (isZeroStat(b.v) ? BIG : 0);

    if (aScore !== bScore) return aScore - bScore;
    if (isZeroStat(a.v) !== isZeroStat(b.v)) return isZeroStat(a.v) ? 1 : -1;
    return a.k.localeCompare(b.k);
  });

  return (
    <View
      pointerEvents="auto"
      style={[S.centerWrapDim, { paddingTop: topPad }]} // safe breathing room at top
    >
      <View style={[S.statsCard, { marginTop: 8, overflow: 'hidden' }]}>
        {/* Header (like ActionSheet); X absolutely positioned so title never clips */}
        <View style={[S.actionHeader, { paddingRight: 44, minHeight: 48, paddingBottom: 2 }]}>
          <View style={{ flexDirection:'row', alignItems:'center', gap:8, flex:1 }}>
            {!!st?.flag && (
              <MaterialCommunityIcons name="flag-variant" size={16} color={st.flag.color} />
            )}
            <Text
              style={[S.actionTitle, { flexShrink: 1 }]}
              numberOfLines={3}
              ellipsizeMode="tail"
            >
              {headerTitle}
            </Text>

            {/* Compare button */}
            <TouchableOpacity
              onPress={() => openCompareWith(statsPid)}
              style={{ marginLeft: 8, padding: 6, borderRadius: 12 }}
              hitSlop={{ top:8, bottom:8, left:8, right:8 }}
              accessibilityLabel="Compare player"
            >
              <MaterialCommunityIcons name="scale-balance" size={18} color={C.ink} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={() => setStatsOpen(false)}
            style={{ position:'absolute', right:8, top:8, padding:6, borderRadius:12 }}
            hitSlop={{ top:8, bottom:8, left:8, right:8 }}
            accessibilityLabel="Close"
          >
            <MaterialCommunityIcons name="close" size={20} color={C.ink} />
          </TouchableOpacity>
        </View>

        {/* Fixtures chips */}
        {!!fixtures.length && (
          <View style={[S.marketMiniRow, { paddingHorizontal:16, flexDirection:'row', alignItems:'center', justifyContent:'space-between' }]}>
    <View style={{ flex:1, flexDirection:'row', flexWrap:'wrap' }}>
      {fixtures.slice(0, 12).map((f, i) => (
        <Text
          key={`ssfx-${i}`}
          numberOfLines={1}
          style={[S.marketMiniCell, { backgroundColor: f.color, color: f.textColor }]}
        >
          {tinyFixture(f.label)}
        </Text>
      ))}
    </View>
    <TouchableOpacity
      onPress={() => openInfo(statsPid)}
      style={{ marginLeft: 8, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, flexShrink: 0, flexDirection:'row', alignItems:'center', gap:6 }}
      hitSlop={{ top:8, bottom:8, left:8, right:8 }}
      accessibilityLabel="Expand fixtures"
    >
      <MaterialCommunityIcons name="open-in-new" size={14} color={C.ink} />
      <Text style={{ color: C.ink, fontWeight: '700' }}>All Fixtures</Text>
    </TouchableOpacity>
  </View>
        )}

        {/* Optional news */}
        {news ? (
          <View style={[S.newsBox, { marginHorizontal:16, marginTop:8 }]}>
            <Text style={S.newsText}>{news}</Text>
          </View>
        ) : null}

        {/* Caption */}
        <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 }}>
          <Text style={[S.kpiTitle, { textAlign: 'center', opacity: 0.7 }]} numberOfLines={2}>
            Toggle to view Overall or Position ranks. Stars mark top-10 (★★) and top-20 (★) in the selected view.
          </Text>
        </View>

        {/* Overall / Position toggle */}
        <View style={{ paddingHorizontal: 12, marginTop: 4 }}>
          <View style={{
            flexDirection:'row', alignSelf:'center',
            backgroundColor: C.card, borderRadius: 999, padding: 4
          }}>
            {['overall','type'].map(m => {
              const active = rankMode === m;
              return (
                <TouchableOpacity
                  key={m}
                  onPress={() => setRankMode(m)}
                  style={{
                    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
                    backgroundColor: active ? C.ink : 'transparent',
                    borderWidth: active ? 0 : 1, borderColor: C.border, marginHorizontal: 2
                  }}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: active ? C.card : C.ink }}>
                    {m === 'overall' ? 'Overall' : 'Position'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* KPI grid (only stats with ranks) */}
        {/* KPI grid (match ActionSheet look by reusing StatKPICard) */}
<ScrollView
  contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 24, paddingTop: 8 }}
  contentInsetAdjustmentBehavior="automatic"
  keyboardShouldPersistTaps="handled"
>
  {/*
    Build a list like ActionSheet's "majors": [{ key, label, value, fmt }]
    We keep the same sorted order you computed above.
  */}
  {(() => {
    const majorsFromSorted = sorted.map(it => {
      const { k, v } = it;
      return {
        key: k,
        label: pretty(k),
        value: v,
        fmt: (kk => (vv => fmtVal(kk, vv)))(k),
      };
    });

    return (
      <View style={S.kpiWrap}>
        {majorsFromSorted.map(m => (
          <StatKPICard
            key={`season-kpi-${m.key}`}
            label={m.label}
            value={m.value}
            fmt={m.fmt}
            pid={statsPid}
            statKey={m.key}
            mode={rankMode}      // 'overall' | 'type'
            C={C}
          />
        ))}
      </View>
    );
  })()}
</ScrollView>

      </View>
    </View>
  );
};



  // ---------- Dynamic stat discovery ----------
// ---------- Dynamic stat discovery ----------
// ---------- Dynamic stat discovery (use extended_api) ----------
// ---------- Dynamic stat discovery (use extended_api + Top Stats first) ----------

// Ultra-short header labels for stats
const SHORT_LABELS = {
  total_points: 'Pts',
  minutes: 'Min',
  goals_scored: 'G',
  assists: 'A',
  clean_sheets: 'CS',
  goals_conceded: 'GC',
  saves: 'Sv',
  bonus: 'Bon',
  bps: 'BPS',
  yellow_cards: 'YC',
  red_cards: 'RC',
  own_goals: 'OG',
  penalties_saved: 'PS',
  penalties_missed: 'PM',

  // x-stats
  expected_goals: 'xG',
  expected_assists: 'xA',
  expected_goal_involvements: 'xGI',
  expected_goals_conceded: 'xGC',

  // meta / value
  points_per_game: 'PPG',
  value_form: 'VF',
  value_season: 'VS',
  selected_by_percent: 'Sel%',
  form: 'Form',
  ict_index: 'ICT',

  // prices & changes
  now_cost: '£',
  nowcost: '£',
  cost_change_event: '£Δ',
  cost_change_event_fall: '£∇',
  cost_change_start: '£Δs',
  cost_change_start_fall: '£∇s',
};

// fallback: make a tiny acronym if we don’t have a mapping
const shortHeaderFor = (key) => {
  if (!key) return '';
  // normalize common variants
  if (/^now_?cost$/i.test(key)) return '£';
  const hit = SHORT_LABELS[key] || SHORT_LABELS[key.toLowerCase()];
  if (hit) return hit;

  // create a compact acronym: e.g., "threat_per_90" -> "TP9"
  const words = String(key).replace(/_/g, ' ').split(' ').filter(Boolean);
  if (words.length === 1) {
    const w = words[0];
    // keep capitals & digits, else first 3 letters
    const caps = w.replace(/[a-z]/g, '');
    if (caps.length >= 2) return caps.slice(0, 4);
    const digits = w.replace(/\D/g, '');
    if (digits) return (w[0] || '').toUpperCase() + digits.slice(0, 2);
    return w.slice(0, 3).toUpperCase();
  }
  const acro = words.map(w => (w[0] || '').toUpperCase()).join('');
  return acro.slice(0, 4);
};

  const TOP_KEY_ALIASES = {
    'now cost': ['now_cost', 'cost', 'price'],
    'goals': ['goals_scored', 'goals'],
    'assists': ['assists'],
    'total points': ['total_points'],
    'form': ['form'],
    'defcon per 90': ['defcon_per90', 'defcon90', 'defcon_per_90','defensive_contribution_per_90'],
    'defcon': ['defcon','defensive_contribution'],
    'expected goals per 90': ['xg_per90', 'xg90', 'expected_goals_per90', 'expected_goals_per_90'],
    'expected assists per 90': ['xa_per90', 'xa90', 'expected_assists_per90', 'expected_assists_per_90'],
    'minutes': ['minutes'],
    'bonus': ['bonus'],
    'starts': ['starts'],
    'threat': ['threat'],
    'ict index': ['ict_index', 'ict'],
    'clean sheet': ['clean_sheets', 'clean_sheet'],
  };

  const TOP_ORDER = [
    'total points',
    'now cost',
    'goals',
    'assists',
    
    'form',
    'defcon per 90',
    'defcon',
    'expected goals per 90',
    'expected assists per 90',
    'minutes',
    'bonus',
    'starts',
    'threat',
    'ict index',
    'clean sheet',
  ];
// Friendly long label for a stat key (used in pickers & descriptions)
const friendlyLabelForStat = (key) => {
  if (!key) return '';
  if (/^now_?cost$/i.test(key)) return 'Price';
  if (String(key) === 'total_points') return 'Total points';
  const s = String(key).replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const statDefs = useMemo(() => {
  // Fallback: only show price if extended info isn’t ready yet
  if (!extendedInfo || !Array.isArray(extRanks?.keys) || !extRanks.keys.length) {
    return [
      {
        key: 'now_cost',
        label: friendlyLabelForStat('now_cost'),
        format: (v) =>
          v == null || isNaN(v) ? '—' : `£${(v / 10).toFixed(1)}`,
      },
    ];
  }

  const ALIASES = TOP_KEY_ALIASES;
  const TOP = TOP_ORDER;

  const aliasOf = (k) => {
    const lower = String(k || '').toLowerCase();
    for (const canon in ALIASES) {
      const arr = ALIASES[canon] || [];
      if (arr.some((a) => a.toLowerCase() === lower)) return canon;
    }
    return null;
  };

  const keys = Array.from(new Set(extRanks.keys)); // numeric & rankable
  const topKeys = [];
  const restKeys = [];

  for (const k of keys) {
    const canon = aliasOf(k);
    if (canon && TOP.includes(canon)) topKeys.push({ k, canon });
    else restKeys.push(k);
  }

  const percentLike = (key = '') =>
    /\d/.test(key) || /ownership|tsb|pct|percent/i.test(key);

  topKeys.sort((a, b) => TOP.indexOf(a.canon) - TOP.indexOf(b.canon));
  const restNonPct = restKeys.filter((k) => !percentLike(k)).sort();
  const restPct = restKeys.filter((k) => percentLike(k)).sort();

  const ordered = topKeys.map((t) => t.k).concat(restNonPct, restPct);

  if (!ordered.includes('now_cost')) ordered.unshift('now_cost');

  return ordered.map((k) => ({
    key: k,
    label: friendlyLabelForStat(k),
    format:
      /^now_?cost$/i.test(k) || /price/i.test(k)
        ? (v) =>
            v == null || isNaN(v)
              ? '—'
              : `£${(Number(v) / 10).toFixed(1)}`
        : undefined,
  }));
}, [extendedInfo, extRanks]);









  const isPercentKey = (key='') => /\d/.test(key) || /ownership|tsb/i.test(key);

  // ---------- Market data ----------
  

  // ---------- MARKET BOTTOM SHEET ----------
  /** AllPlayersStatsModal — sortable table of all players with user-editable columns.
 *  - Default columns: Price, Total Points, Form, Goals, Assists, Minutes, xG/90, DEFCON/90
 *  - Tap headers to sort; tap again to toggle asc/desc.
 *  - “Columns” button lets user add/remove columns (persisted).
 *  - Quick filters: Position (GK/DEF/MID/FWD) + search by name.
 *//** ------------------------------------------------------------------
 *  AllPlayersStatsModal — ultra-fast, optimized version
 *  - Very fast sorting + filtering (FlatList, memoized rows)
 *  - Correct formatting: £ for prices, % for percent keys
 *  - Search is single-line, doesn’t collapse modal when no results
 * ------------------------------------------------------------------ */
/**
 * AllPlayersStatsModal — sortable table of all players with user-editable columns.
 *  - Default columns: Price, Total Points, Form, Goals, Assists, Minutes, xG/90, DEFCON/90
 *  - Tap headers to sort; tap again to toggle asc/desc.
 *  - “Columns” button lets user add/remove columns (persisted).
 *  - Quick filters: Position (GK/DEF/MID/FWD) + search by name.
 *  - Performance trims to first 500 rows.
 *//**
 * AllPlayersStatsModal — sortable table of all players with user-editable columns.
 *  - Default columns: Pts, Price, Form, Sel%, Goals, Assists, Minutes, xG/90, DEFCON/90
 *  - Tap headers to sort; tap again to toggle asc/desc.
 *  - Little "×" in each header to remove that column.
 *  - “Columns” picker:
 *      • Shows active columns (in current order) with Up/Down + Remove
 *      • Shows available columns with "+" to add
 *      • Order + selection persisted in AsyncStorage
 *  - Quick filters: Position (GK/DEF/MID/FWD) + search by name.
 *  - Italic “i” next to position opens stats modal via setStatsPid / setStatsOpen.
 */const AllPlayersStatsModal = React.memo(function AllPlayersStatsModal({
  open,
  onClose,
  extendedInfo,
  playersInfo,
  extRanks, // kept for possible future use
  C,
}) {
  if (!open) return null;

  const NAME_COL_W = 130;
  const COL_MIN_W = 52;
  const TABLE_MAX_H = Math.round(Dimensions.get('window').height * 0.6);

  const colWidthFor = () => Math.max(COL_MIN_W, 52);

  const POS_LABELS = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
  const COLS_KEY = 'planner_allstats_columns_v1';

  const isPercentish = (key = '') =>
    key === 'selected_by_percent' ||
    /ownership|tsb|percent|pct/i.test(key);

  // Team maps
  const teamShort = playersInfo?.teamShort || {};
  const teamNames = playersInfo?.teamNames || playersInfo?.teamsById || {};

  // Prefer full team name (Arsenal), then short (ARS), then fallback.
  const teamLabelFor = React.useCallback(
    (teamNum) => {
      if (!teamNum) return '';
      return teamNames?.[teamNum] || teamShort?.[teamNum] || `Team ${teamNum}`;
    },
    [teamNames, teamShort]
  );

  // Build catalog of numeric/rankable stat keys
  const catalog = React.useMemo(() => {
    const out = new Set();
    for (const [, row] of Object.entries(extendedInfo || {})) {
      if (!row || typeof row !== 'object') continue;
      for (const [k, v] of Object.entries(row)) {
        if (isRankableExtKey(k, v)) out.add(k);
      }
    }
    if (!out.has('now_cost')) out.add('now_cost');
    return Array.from(out).sort();
  }, [extendedInfo]);

  const DEFAULT_COLS = [
    'total_points',
    'now_cost',
    'form',
    'selected_by_percent',
    'goals_scored',
    'assists',
    'minutes',
    'xg_per90',
    'defcon_per90',
  ].filter((k) => catalog.includes(k));

  const [columns, setColumns] = React.useState(DEFAULT_COLS);

  // Load saved columns
  React.useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(COLS_KEY);
        if (raw) {
          const wanted = JSON.parse(raw).filter((k) => catalog.includes(k));
          if (wanted.length) setColumns(wanted);
        }
      } catch {}
    })();
  }, [catalog]);

  // Persist columns
  React.useEffect(() => {
    (async () => {
      try {
        await AsyncStorage.setItem(COLS_KEY, JSON.stringify(columns));
      } catch {}
    })();
  }, [columns]);

  // Column picker modal
  const [pickerOpen, setPickerOpen] = React.useState(false);

  const toggleCol = (k) => {
    setColumns((cols) =>
      cols.includes(k) ? cols.filter((x) => x !== k) : [...cols, k],
    );
  };

  // header “x” remove
  const removeCol = (k) => {
    setColumns((cols) => {
      if (cols.length <= 1) return cols;
      return cols.filter((x) => x !== k);
    });
  };

  // Reorder helpers (Up/Down)
  const moveCol = (k, dir) => {
    setColumns((cols) => {
      const idx = cols.indexOf(k);
      if (idx < 0) return cols;
      const target = idx + dir;
      if (target < 0 || target >= cols.length) return cols;
      const next = cols.slice();
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  // Sort state: default by total_points (Pts)
  const [sortKey, setSortKey] = React.useState(
    DEFAULT_COLS.includes('total_points')
      ? 'total_points'
      : (DEFAULT_COLS[0] || 'now_cost'),
  );
  const [sortDir, setSortDir] = React.useState('desc');
  const setSort = (k) => {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir('desc');
    }
  };

  // Filters
  const [posFilter, setPosFilter] = React.useState(null); // 1..4 or null
  const [q, setQ] = React.useState('');
  const [teamFilter, setTeamFilter] = React.useState(null); // teamNum or null
  const [teamPickerOpen, setTeamPickerOpen] = React.useState(false);

  // Helpers
  const namesById = playersInfo?.names || {};
  const types = playersInfo?.types || {};
  const teams = playersInfo?.teams || {};

  // Build flat player list once
  const allRows = React.useMemo(() => {
    const rows = [];
    for (const [pidStr, row] of Object.entries(extendedInfo || {})) {
      const pid = Number(pidStr);
      if (!Number.isFinite(pid)) continue;
      const type = Number(types?.[pid]) || Number(row.element_type) || null;
      const name = namesById?.[pid] || row.web_name || String(pid);
            const teamNum = Number(teams?.[pid]) || Number(row.team) || null;
      const shortTeam =
        (teams?.[pid]) || (row.team) || null;

      const status = row.status || null; // FPL status

      rows.push({
        pid,
        type,
        name,
        teamNum,
        shortTeam,
        status,
        r: row,
      });
    }
    return rows;
  }, [extendedInfo, namesById, types, teams, teamShort, teamNames]);

  // Build team options for dropdown (teamNum + label)
  const teamOptions = React.useMemo(() => {
    const map = new Map(); // teamNum -> label
    for (const r of allRows) {
      if (!r.teamNum) continue;
      if (!map.has(r.teamNum)) {
        map.set(r.teamNum, r.shortTeam);
      }
    }
    return Array.from(map.entries()).sort((a, b) =>
      String(a[1]).localeCompare(String(b[1])),
    ); // [teamNum, label]
  }, [allRows, teamLabelFor]);

  // Apply filters (availability + position + team + name search)
  const filtered = React.useMemo(() => {
    const qn = q.trim().toLowerCase();
    return allRows.filter((x) => {
      // drop unavailable
      if (x.status === 'u' || x.r?.status === 'u') return false;
      // position filter
      if (posFilter && x.type !== posFilter) return false;
      // team filter
      if (teamFilter != null && x.teamNum !== teamFilter) return false;
      // name search
      if (qn && !String(x.name).toLowerCase().includes(qn)) return false;
      return true;
    });
  }, [allRows, posFilter, q, teamFilter]);

  // Value extractor used for sorting
  const valueFor = React.useCallback((row, key) => {
    let v = row.r?.[key];
    if (v == null) {
      const lower = String(key).toLowerCase();
      const alt = Object.keys(row.r || {}).find(
        (k) => String(k).toLowerCase() === lower,
      );
      if (alt) v = row.r?.[alt];
    }
    if (/^now_?cost$/i.test(key)) return Number(v ?? 0);
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }, []);

  const sorted = React.useMemo(() => {
    const arr = filtered.slice();
    arr.sort((a, b) => {
      const va = valueFor(a, sortKey);
      const vb = valueFor(b, sortKey);
      return sortDir === 'asc' ? va - vb : vb - va;
    });
    return arr.slice(0, 500);
  }, [filtered, sortKey, sortDir, valueFor]);

  // Cell formatter with £, % and compact decimals
  const fmtCell = (k, rawV) => {
    if (rawV == null || rawV === '') return '—';

    if (/^now_?cost$/i.test(k) || /price/i.test(k)) {
      const v = Number(rawV);
      if (!Number.isFinite(v)) return '—';
      const tenths = /^now_?cost$/i.test(k) ? v : v * 10;
      return `£${(tenths / 10).toFixed(1)}`;
    }

    if (isPercentish(k)) {
      const v = Number(rawV);
      if (!Number.isFinite(v)) return '—';
      return `${v.toFixed(1)}%`;
    }

    const v = Number(rawV);
    if (Number.isInteger(v)) return String(v);
    if (typeof v === 'number' && !isNaN(v)) {
      return v.toFixed(2).replace(/\.00$/, '.0').replace(/\.0$/, '');
    }
    return String(rawV ?? '—');
  };

  const HeaderCell = ({ k }) => {
    const active = k === sortKey;
    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          borderRightWidth: 1,
          borderColor: C.border,
          paddingVertical: 4,
          paddingHorizontal: 4,
          width: colWidthFor(k), // <-- fixed width for header
        }}
      >
        <TouchableOpacity
          onPress={() => setSort(k)}
          style={{ flex: 1, paddingVertical: 2, paddingRight: 4 }}
        >
          <Text
            style={{
              color: C.ink,
              fontWeight: active ? '800' : '700',
              fontSize: 10,
            }}
            numberOfLines={1}
          >
            {shortHeaderFor(k)}
            {active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
          </Text>
        </TouchableOpacity>

        {/* small "x" to remove column */}
        <TouchableOpacity
          onPress={() => removeCol(k)}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          style={{ paddingHorizontal: 2, paddingVertical: 2 }}
        >
          <Text style={{ color: C.muted, fontSize: 10 }}>×</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const RowCell = ({ k, row }) => {
    const v = valueFor(row, k);
    return (
      <View
        style={{
          paddingVertical: 6,
          paddingHorizontal: 6,
          borderRightWidth: 1,
          borderColor: C.border,
          width: colWidthFor(k), // <-- same fixed width for body cell
        }}
      >
        <Text style={{ color: C.ink, fontSize: 11 }}>{fmtCell(k, v)}</Text>
      </View>
    );
  };

  // --- RENDER ---

  return (
    <View
      pointerEvents={open ? 'auto' : 'none'}
      style={[S.modalWrap, { display: open ? 'flex' : 'none' }]}
    >
      {/* backdrop */}
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={1}
        onPress={onClose}
      />

      <View
        style={{
          backgroundColor: C.card,
          borderRadius: 14,
          padding: 10,
          maxHeight: Math.round(Dimensions.get('window').height * 0.86),
          alignSelf: 'stretch',
          marginHorizontal: 12,
        }}
      >
        {/* Title + actions */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 8,
          }}
        >
          <Text style={{ color: C.ink, fontWeight: '800', fontSize: 16 }}>
            Stats
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {/* Team dropdown */}
            <TouchableOpacity
              onPress={() => setTeamPickerOpen(true)}
              style={S.smallBtn}
            >
              <MaterialCommunityIcons
                name="shield-outline"
                size={14}
                color={C.ink}
              />
              <Text style={S.smallBtnTxt}>
                {teamFilter == null
                  ? 'All teams'
                  : (teamOptions.find(([num]) => num === teamFilter)?.[1] ||
                     teamLabelFor(teamFilter))}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setPickerOpen(true)}
              style={S.smallBtn}
            >
              <MaterialCommunityIcons
                name="view-column"
                size={14}
                color={C.ink}
              />
              <Text style={S.smallBtnTxt}>Columns</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} style={S.smallBtn}>
              <MaterialCommunityIcons name="close" size={14} color={C.ink} />
              <Text style={S.smallBtnTxt}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Filters row */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            marginBottom: 8,
          }}
        >
          {[null, 1, 2, 3, 4].map((p) => {
            const active = posFilter === p;
            const label = p == null ? 'All' : POS_LABELS[p];
            return (
              <TouchableOpacity
                key={String(p)}
                onPress={() => setPosFilter(p)}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 999,
                  backgroundColor: active ? C.ink : 'transparent',
                  borderWidth: active ? 0 : 1,
                  borderColor: C.border,
                }}
              >
                <Text
                  style={{
                    color: active ? C.card : C.ink,
                    fontWeight: '700',
                    fontSize: 12,
                  }}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
          <View style={{ flex: 1 }} />
          {/* Single-line search pill */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              borderRadius: 999,
              borderWidth: 1,
              borderColor: C.border,
              paddingHorizontal: 10,
              height: 32,
              minWidth: 120,
            }}
          >
            <MaterialCommunityIcons
              name="magnify"
              size={14}
              color={C.muted}
              style={{ marginRight: 6 }}
            />
            <ThemedTextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search"
              placeholderTextColor={C.muted}
              style={{
                flex: 1,
                height: '100%',
                paddingVertical: 0,
                paddingHorizontal: 0,
                color: C.ink,
                fontSize: 10,
                textAlignVertical: 'center',
              }}
              returnKeyType="search"
            />
          </View>
        </View>

        {/* Table */}
        <ScrollView
          horizontal
          bounces={false}
          style={{
            borderWidth: 1,
            borderColor: C.border,
            borderRadius: 10,
          }}
        >
          <View>
            {/* Header */}
            <View style={{ flexDirection: 'row', backgroundColor: C.bg }}>
              <View
                style={{
                  width: NAME_COL_W,
                  borderRightWidth: 1,
                  borderColor: C.border,
                  paddingVertical: 8,
                  paddingHorizontal: 8,
                }}
              >
                <Text
                  style={{
                    color: C.muted,
                    fontWeight: '700',
                    fontSize: 12,
                  }}
                >
                  Player
                </Text>
              </View>
              {columns.map((k) => (
                <HeaderCell key={k} k={k} />
              ))}
            </View>

            {/* Body with fixed min height (no collapsing when empty) */}
            <View
              style={{
                maxHeight: TABLE_MAX_H,
                minHeight: 140,
              }}
            >
              {sorted.length === 0 ? (
                <View
                  style={{
                    flex: 1,
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 16,
                  }}
                >
                  <Text style={{ color: C.muted, fontSize: 13 }}>
                    No players match your filters.
                  </Text>
                </View>
              ) : (
                <ScrollView>
                  {sorted.map((row) => (
                    <View
                      key={row.pid}
                      style={{
                        flexDirection: 'row',
                        borderTopWidth: 1,
                        borderColor: C.border,
                      }}
                    >
                      {/* frozen identity */}
                      <View
                        style={{
                          width: NAME_COL_W,
                          borderRightWidth: 1,
                          borderColor: C.border,
                          paddingVertical: 6,
                          paddingHorizontal: 6,
                        }}
                      >
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                          }}
                        >
                          <Image
                            source={{
                              uri: clubCrestUri?.(row.teamNum),
                            }}
                            style={{
                              width: 18,
                              height: 18,
                              marginRight: 6,
                              borderRadius: 3,
                            }}
                            resizeMode="contain"
                          />
                          <View style={{ flex: 1 }}>
                            <Text
                              style={{
                                color: C.ink,
                                fontWeight: '700',
                                fontSize: 11,
                              }}
                              numberOfLines={1}
                            >
                              {row.name}
                            </Text>

                            {/* Position + team + italic stats "i" */}
                            <View
                              style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                              }}
                            >
                              <Text
                                style={{ color: C.muted, fontSize: 10 }}
                                numberOfLines={1}
                              >
                                {(POS_LABELS[row.type] || '?') +
                                  ''}
                              </Text>
                              <TouchableOpacity
                                onPress={() => {
                                  setStatsPid(row.pid);
                                  setStatsOpen(true);
                                }}
                                hitSlop={{
                                  top: 6,
                                  bottom: 6,
                                  left: 6,
                                  right: 6,
                                }}
                                style={{ marginLeft: 6 }}
                              >
                                <Text style={S.rItalicI2}>i</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        </View>
                      </View>

                      {columns.map((k) => (
                        <RowCell key={k} k={k} row={row} />
                      ))}
                    </View>
                  ))}
                </ScrollView>
              )}
            </View>
          </View>
        </ScrollView>

        {/* Column picker with reorder (Up/Down) */}
        <Modal
          visible={pickerOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setPickerOpen(false)}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: 'rgba(0,0,0,0.35)',
              justifyContent: 'center',
              padding: 20,
            }}
          >
            <View
              style={{
                backgroundColor: C.card,
                borderRadius: 14,
                padding: 12,
                maxHeight: 480,
                width: '100%',
              }}
            >
              {/* Active columns (reorder via Up/Down) */}
              <Text
                style={{
                  color: C.ink,
                  fontWeight: '800',
                  fontSize: 14,
                  marginBottom: 4,
                }}
              >
                Active columns (order)
              </Text>
              <ScrollView style={{ maxHeight: 220 }}>
                {columns.map((k, idx) => {
                  const canMoveUp = idx > 0;
                  const canMoveDown = idx < columns.length - 1;
                  const canRemove = columns.length > 1;
                  return (
                    <View
                      key={`active-${k}`}
                      style={{
                        paddingVertical: 6,
                        flexDirection: 'row',
                        alignItems: 'center',
                      }}
                    >
                      <Text
                        style={{
                          flex: 1,
                          color: C.ink,
                          fontSize: 13,
                        }}
                        numberOfLines={1}
                      >
                        {pretty(k)}
                      </Text>
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        {/* Up */}
                        <TouchableOpacity
                          onPress={() => {
                            if (canMoveUp) moveCol(k, -1);
                          }}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                          style={[
                            S.smallBtn,
                            {
                              paddingHorizontal: 6,
                              paddingVertical: 4,
                              opacity: canMoveUp ? 1 : 0.35,
                            },
                          ]}
                        >
                          <MaterialCommunityIcons
                            name="chevron-up"
                            size={14}
                            color={C.ink}
                          />
                        </TouchableOpacity>

                        {/* Down */}
                        <TouchableOpacity
                          onPress={() => {
                            if (canMoveDown) moveCol(k, +1);
                          }}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                          style={[
                            S.smallBtn,
                            {
                              paddingHorizontal: 6,
                              paddingVertical: 4,
                              opacity: canMoveDown ? 1 : 0.35,
                            },
                          ]}
                        >
                          <MaterialCommunityIcons
                            name="chevron-down"
                            size={14}
                            color={C.ink}
                          />
                        </TouchableOpacity>

                        {/* Remove */}
                        <TouchableOpacity
                          onPress={() => {
                            if (canRemove) toggleCol(k);
                          }}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                          style={[
                            S.smallBtn,
                            {
                              paddingHorizontal: 6,
                              paddingVertical: 4,
                              borderColor: '#ef4444',
                              opacity: canRemove ? 1 : 0.35,
                            },
                          ]}
                        >
                          <Text
                            style={{
                              color: '#ef4444',
                              fontWeight: '700',
                              fontSize: 11,
                            }}
                          >
                            Remove
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>

              {/* Available columns */}
              <Text
                style={{
                  color: C.ink,
                  fontWeight: '800',
                  fontSize: 14,
                  marginTop: 8,
                  marginBottom: 4,
                }}
              >
                Add more columns
              </Text>
              <ScrollView style={{ maxHeight: 160 }}>
                {catalog
                  .filter((k) => !columns.includes(k))
                  .map((k) => (
                    <TouchableOpacity
                      key={`avail-${k}`}
                      onPress={() => toggleCol(k)}
                      style={{
                        paddingVertical: 6,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <Text
                        style={{ color: C.ink, fontSize: 13 }}
                        numberOfLines={1}
                      >
                        {pretty(k)}
                      </Text>
                      <Text
                        style={{
                          color: C.accent,
                          fontWeight: '700',
                        }}
                      >
                        +
                      </Text>
                    </TouchableOpacity>
                  ))}
              </ScrollView>

              <TouchableOpacity
                onPress={() => setPickerOpen(false)}
                style={{ alignSelf: 'flex-end', marginTop: 8 }}
              >
                <Text style={{ color: C.accent, fontWeight: '700' }}>
                  Done
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Team picker dropdown (MiniSelectModal) */}
        <MiniSelectModal
          visible={teamPickerOpen}
          title="Filter by team"
          C={C}
          options={[
            { label: 'All teams', value: null },
            ...teamOptions.map(([tn, label]) => ({
              label,
              value: tn,
            })),
          ]}
          selected={teamFilter}
          onSelect={(val) => setTeamFilter(val == null ? null : Number(val))}
          onClose={() => setTeamPickerOpen(false)}
        />
      </View>
    </View>
  );
});



 // ---------- Transfer Market: true Modal + keyboard-safe UX ----------




const TransferMarketModal = React.memo(() => {
  // Top of TransferMarketModal (not inside any hook):
  if (!transferMode || !current) return null;
  const outId = transferMode.outId;
  const statsMode = !!transferMode?.statsMode;
  const baselinePos = types?.[outId] ?? null;

  // local pos filter (active only in stats mode)
  const [posFilter, setPosFilter] = useState(null); // null = All

  // types helper (handles string/number keys)
  const typeOf = useCallback(
    (pid) => Number(types?.[pid] ?? types?.[String(pid)] ?? 0),
    [types]
  );

  // Use posFilter in statsMode, otherwise follow the outgoing player's position
  const effectivePos = useMemo(() => {
    if (statsMode) return posFilter ?? null;        // null = All positions
    if (transferMode?.anyPos) return null;          // unrestricted (when coming from stats with anyPos)
    return types?.[outId] ?? null;                  // classic “replacing X” flow
  }, [statsMode, posFilter, transferMode?.anyPos, types, outId]);

  const POS_LABELS = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };

  const baseCounts = (() => {
    const picks = (current?.picks || []).slice();
    const idx = picks.indexOf(outId);
    if (idx >= 0) picks.splice(idx, 1);
    return teamCounts(picks);
  })();

  // Helper: would adding this player exceed 3?
  function wouldBreakTeamLimit(inPid) {
    const t = teamOf(inPid);
    if (!t) return false;
    const c = baseCounts.get(t) || 0;
    return c >= 3;
  }

  // if you previously had an "affordable" toggle/state:
  const [affordable, setAffordable] = useState(false);
  // force it OFF in stats mode
  const affordableOn = statsMode ? false : affordable;
  const currentOutPid = outId;
  const outName = namesById?.[outId] || String(outId);
  const pos = transferMode?.anyPos ? null : types?.[outId]; // 1=GK, 2=DEF, 3=MID, 4=FWD

  // ----- local-only state (keystrokes stay inside modal) -----
  const [teamFilter, setTeamFilter] = useState(null); // null or team name string

  const [marketSort, setMarketSort] = useState('points');
  const [sortDesc, setSortDesc] = useState(true);

  // --- anchored picker state + refs ---
  const [picker, setPicker] = useState({ visible: false, type: null });


  

  // Only freeze list when stats modal is open or the picker is visible
  const overlayOpen = picker.visible || statsOpen;

  const [marketSearchRaw, setMarketSearchRaw] = useState('');
  const [affordableOnly, setAffordableOnly] = useState(true);
  useEffect(() => {
    if (!marketOpen) return;
    (async () => {
      try {
        const v = await AsyncStorage.getItem(MARKET_AFFORDABLE_KEY);
        if (v !== null) setAffordableOnly(v === '1');
      } catch {}
    })();
  }, [marketOpen]);

  const toggleAffordable = useCallback(() => {
    setAffordableOnly((v) => {
      const next = !v;
      try { AsyncStorage.setItem(MARKET_AFFORDABLE_KEY, next ? '1' : '0'); } catch {}
      return next;
    });
  }, []);

  // precompute base list locally (only modal re-renders when typing)
  const marketBaseList = useMemo(() => {
    if (!playersInfo || !current || !transferMode) return [];

    const mySet = new Set(current.picks);

    const entries = Object.keys(playersInfo.players).map((pidStr) => {
      const pid = Number(pidStr);
      if (effectivePos && types[pid] !== effectivePos) return null;
      if (!statsMode && mySet.has(pid)) return null;
      const price = Number(costs[pid] || 0);

      const st = statusMeta(pid, extendedInfo);
      const row = {
        id: pid,
        name: playersInfo.players[pid],
        pos: types[pid],
        price,
        _status: st.status,
        _flag: st.flag,
        teamName: teamNameByPid?.[pid] || '',
        _fixtures: nextFixtures(pid, gw),
      };

      const activeSortKey = marketSort;
      const extRow = extendedInfo?.[String(pid)] || extendedInfo?.[pid];

      // PER-90 MINUTES FILTER
      if (isPer90Key(activeSortKey)) {
        const mins = getMinutesExt(pid, extendedInfo);
        if (mins < 180) return null;
      }

      // assign metrics (prefer extended_api)
      for (const { key } of statDefs) {
        if (extRow && Object.prototype.hasOwnProperty.call(extRow, key)) {
          let v = Number(extRow[key]);
          if (!Number.isFinite(v)) v = 0;
          if (/^now_?cost$/i.test(key) || /price/i.test(key)) {
            row[key] = v / 10;
          } else {
            row[key] = v;
          }
        } else if (/^now_?cost$/i.test(key) || /price/i.test(key)) {
          const raw = Number(costs?.[pid] ?? 0);
          row[key] = Number.isFinite(raw) ? raw / 10 : 0;
        }
      }

      return row;
    }).filter(Boolean);

    return entries;
  }, [playersInfo, current, transferMode, teamNameByPid, costs, statDefs, outId, gw, nextFixtures, types, pos, extendedInfo, effectivePos, marketSort]);

  const availableTeams = useMemo(() => {
    const names = new Set();
    for (const r of marketBaseList) names.add(r.teamName || '');
    return Array.from(names).filter(Boolean).sort();
  }, [marketBaseList]);

  const renderMarketItem = ({ item }) => {
    const disabled = !!item._limitHit && !statsMode;
    const onRowPress = () => {
      if (disabled) return;
      doTransfer(item.id);
    };
    return (
      <View style={[S.rowItem, disabled && { opacity: 0.45 }]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={S.rLeft}>
            {/* Actions: info + compare (+ add if not statsMode) */}
            <View style={S.rActions}>
              <TouchableOpacity
                onPress={() => { setStatsPid(item.id); setStatsOpen(true); }}
                style={S.rIconBtn}
                hitSlop={{ top:8, bottom:8, left:8, right:8 }}
                accessibilityLabel="Player info"
              >
                <Text style={S.rItalicI}>i</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => openCompareFromMarket(currentOutPid, item.id)}
                style={S.rIconBtn}
                hitSlop={{ top:8, bottom:8, left:8, right:8 }}
                accessibilityLabel="Compare player"
              >
                <MaterialCommunityIcons name="scale-balance" size={18} color={C.ink} />
              </TouchableOpacity>

              {!statsMode && (
                <TouchableOpacity
                  onPress={() => !disabled && doTransfer(item.id)}
                  disabled={disabled}
                  style={[S.rIconBtn, disabled && { opacity: 0.4 }]}
                  hitSlop={{ top:8, bottom:8, left:8, right:8 }}
                  accessibilityLabel="Select player"
                >
                  <MaterialCommunityIcons name="plus-circle" size={18} color={C.ink} />
                </TouchableOpacity>
              )}
            </View>

            <Image source={{ uri: crestFor(item.id, teamNums) }} style={{ width: 18, height: 18, resizeMode: 'contain' }} />
            {!!item._flag && (
              <MaterialCommunityIcons name="flag-variant" size={14} color={item._flag.color} />
            )}
            <Text style={S.rName} numberOfLines={1}>{item.name}</Text>
            <Text style={S.rInlinePrice}>{` • ${POS_NAME[item.pos]} • ${money(item.price)}`}</Text>
          </View>

          {!!item._fixtures?.length && (
            <View style={S.marketMiniRow}>
              {item._fixtures.slice(0, 7).map((f, i) => (
                <Text
                  key={`${item.id}-mf-${i}`}
                  numberOfLines={1}
                  style={[S.marketMiniCell, { backgroundColor: f.color, color: f.textColor }]}
                >
                  {tinyFixture(f.label)}
                </Text>
              ))}
            </View>
          )}

          {disabled && !statsMode && (
            <Text style={[S.rSub, { marginTop: 4 }]}>
              Limit reached: 3 from {item.teamName}
            </Text>
          )}
        </View>

        <Text style={S.rPrice}>
          {/^costs?$/i.test(marketSort) || /price/i.test(marketSort)
            ? (Number(item[marketSort]) / 10).toFixed(1)
            : (Number.isFinite(item[marketSort]) ? item[marketSort] : '')
          }
        </Text>
      </View>
    );
  };

  // set default sort if previous choice is gone
  useEffect(() => {
    if (!statDefs.length) return;
    if (!statDefs.find(s=>s.key===marketSort)) {
      setMarketSort(statDefs[0].key);
    }
  }, [statDefs]); // eslint-disable-line

  const statLabel = useMemo(
    () => (statDefs.find(s => s.key === marketSort)?.label) ?? pretty(marketSort),
    [statDefs, marketSort]
  );

  const bvOut = Number(current?.bought?.[outId] || 0);
  const nowOut = Number(costs?.[outId] || 0);
  const override = current?.sellOverrides?.[outId];
  const sell = (typeof override === 'number') ? override : sellPrice(nowOut, bvOut);
  const maxBudget = (current.bank || 0) + sell;

  const close = () => setMarketOpen(false);

  const isPercentKey = (key='') => /\d/.test(key) || /ownership|tsb/i.test(key);

  const marketData = useMemo(() => {
    const q = marketSearchRaw.trim().toLowerCase();
    const filtered = marketBaseList.filter((e) => {
      if (e._status === 'u') return false;
      if (!statsMode && affordableOnly && Number(e.price) > maxBudget) return false;
      if (teamFilter && e.teamName !== teamFilter) return false;
      if (!q) return true;
      const n = e.name.toLowerCase();
      const t = (e.teamName || '').toLowerCase();
      return n.includes(q) || t.includes(q);
    }).map(e => ({ ...e, _limitHit: wouldBreakTeamLimit(e.id) }));

    filtered.sort((a, b) => {
      const va = Number(a[marketSort] || 0);
      const vb = Number(b[marketSort] || 0);
      return sortDesc ? (vb - va) : (va - vb);
    });
    return filtered.slice(0, 400);
  }, [marketBaseList, marketSearchRaw, affordableOnly, maxBudget, marketSort, sortDesc, teamFilter]);

 

  // -------------------------------------------------------

  return (
  <View
    pointerEvents={marketOpen && !statsOpen ? 'auto' : 'none'}
    style={[S.sheetWrap, { display: marketOpen ? 'flex' : 'none' }]}
  >

      {!statsOpen && (
  <TouchableOpacity style={S.sheetBackdrop} onPress={close} activeOpacity={1} />
)}

      <View pointerEvents={statsOpen ? 'none' : 'auto'} style={S.sheetCard}>
        <SafeAreaView style={{ maxHeight: SCREEN_H * 0.8 }}>
          <View style={S.marketHead}>
            <ThemedTextInput
              style={S.search}
              value={marketSearchRaw}
              onChangeText={setMarketSearchRaw}
              placeholder="Search players..."
              placeholderTextColor={C.muted}
            />
            {!statsMode && (
              <TouchableOpacity onPress={toggleAffordable} style={S.smallBtn}>
                <MaterialCommunityIcons
                  name={affordableOnly ? 'check-circle' : 'circle-outline'}
                  size={14}
                  color={C.ink}
                />
                <Text style={S.smallBtnTxt}>Affordable</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={close} style={S.smallBtn}>
              <MaterialCommunityIcons name="close" size={14} color={C.ink} />
              <Text style={S.smallBtnTxt}>Close</Text>
            </TouchableOpacity>
          </View>

          {/* Meta line: replacing + budget */}
          <View style={S.marketMeta}>
            {!statsMode && (
              <Text style={S.marketMetaTxt}>
                Replacing {outName} — Budget {money(maxBudget)}
              </Text>
            )}
          </View>

          <View style={[S.marketThead, { position: 'relative' }]}>
            <View style={{ flex: 1 }} />

            <View style={{ flexDirection: 'row', gap: 6 }}>
              {statsMode && (
                <TouchableOpacity
                  onPress={() => setPicker({ visible: true, type: 'pos' })}

                  style={S.smallBtn}
                >
                  <MaterialCommunityIcons name="account-group-outline" size={14} color={C.ink} />
                  <Text style={S.smallBtnTxt}>
                    {posFilter ? POS_LABELS[posFilter] : 'All positions'}
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                onPress={() => setPicker({ visible: true, type: 'team' })}

                style={S.smallBtn}
              >
                <MaterialCommunityIcons name="shield-outline" size={14} color={C.ink} />
                <Text style={S.smallBtnTxt}>{teamFilter ? teamFilter : 'All teams'}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setPicker({ visible: true, type: 'stat' })}

                style={S.smallBtn}
              >
                <MaterialCommunityIcons name="sort" size={14} color={C.ink} />
                <Text style={S.smallBtnTxt}>{statLabel}</Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={() => setSortDesc(d => !d)} style={S.smallBtn}>
                <MaterialCommunityIcons name={sortDesc ? 'arrow-down' : 'arrow-up'} size={14} color={C.ink} />
              </TouchableOpacity>
            </View>

            {/* Old dropdown panels removed (Android scroll issues) */}
          </View>

          {/* Anchored picker (teams / stats / positions) */}
          {/* TEAM PICKER */}
<MiniSelectModal
  visible={picker.visible && picker.type === 'team'}
  title="Choose Team"
  C={C}

  options={[{ label: 'All teams', value: null }].concat(
    (availableTeams || []).map(t =>
      typeof t === 'string'
        ? ({ label: String(t), value: String(t) })
        : ({ label: t.name || String(t.code), value: t.code ?? t.name })
    )
  )}
  selected={teamFilter ?? null}
  onSelect={(val) => setTeamFilter(val)}
  onClose={() => setPicker({ visible: false, type: null })}
/>

{/* POSITION PICKER */}
<MiniSelectModal
  visible={picker.visible && picker.type === 'pos'}
  title="Choose Position"
  C={C}
 
  options={[
    { label: 'All positions', value: null },
    { label: POS_LABELS[1], value: 1 },
    { label: POS_LABELS[2], value: 2 },
    { label: POS_LABELS[3], value: 3 },
    { label: POS_LABELS[4], value: 4 },
  ]}
  selected={posFilter ?? null}
  onSelect={(val) => setPosFilter(val)}
  onClose={() => setPicker({ visible: false, type: null })}
/>

{/* STAT / SORT PICKER */}
<MiniSelectModal
  visible={picker.visible && picker.type === 'stat'}
  title="Choose Stat"
  C={C}

  options={(statDefs || []).map(s => ({ label: String(s.label || s.key), value: String(s.key) }))}
  selected={typeof marketSort === 'object' ? marketSort?.key : marketSort}
  onSelect={(val) => {
    if (marketSort && typeof marketSort === 'object') setMarketSort({ ...marketSort, key: val });
    else setMarketSort(val);
  }}
  onClose={() => setPicker({ visible: false, type: null })}
/>


          <FlatList
            data={marketData}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderMarketItem}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            scrollEnabled={!(Platform.OS === 'android' && overlayOpen)}
          />
        </SafeAreaView>
      </View>
    </View>
  );
});





  // ---------- Summary modal (centered, no grey overlay, more transfer space, no Vice) ----------
  const SummaryModal = () => {
    const rows = useMemo(() => {
      const out = [];
      const k = keysNum(weeks).sort((a,b)=>a-b);
      for (const g of k) {
        const w = weeks[g];
        if (!w) continue;
        out.push({
          g,
          transfers: collapseTransfers(w.transfers || [])
  .map(([o, i]) => `${namesById?.[o] ?? o} → ${namesById?.[i] ?? i}`),


          chip: w.chip || null,
          cap: w.cap ? (namesById?.[w.cap] || w.cap) : '—',
          hits: w.hits || 0,
        });
      }
      return out;
    }, [weeks, namesById]);

    return (
      <View pointerEvents={summaryOpen ? 'auto' : 'none'} style={[S.centerWrap, { display: summaryOpen ? 'flex' : 'none' }]}>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setSummaryOpen(false)} />
       
        <View style={S.sumCardCenter}>
          <View style={S.sumHeader}>
            <Text style={S.sumTitle}>Season Plan Summary</Text>
            <TouchableOpacity style={S.smallBtn} onPress={() => setSummaryOpen(false)}>
              <MaterialCommunityIcons name="close" size={14} color={C.ink} />
              <Text style={S.smallBtnTxt}>Close</Text>
            </TouchableOpacity>
          </View>

          {/* Header row */}
          <View style={[S.tableRow, { borderTopWidth: 0 }]}>
            <Text style={[S.th, {flex:0.6}]}>GW</Text>
            <Text style={[S.th, {flex:3.4}]}>Transfers</Text>
            <Text style={[S.th, {flex:1.0}]}>Chip</Text>
            <Text style={[S.th, {flex:1.2}]}>Captain</Text>
            <Text style={[S.th, {flex:0.8}]}>Cost</Text>
          </View>

          <ScrollView>
            {rows.map((r) => (
              <View key={`sum-${r.g}`} style={S.tableRow}>
                <Text style={[S.td, {flex:0.6}]}>{r.g}</Text>
                <View style={{ flex:3.4 }}>
                  {r.transfers.length ? (
                    <View style={S.transferWrap}>
                      {r.transfers.map((t, i) => (
                        <View key={`${r.g}-t${i}`} style={S.pill}>
                          <Text style={S.pillTxt}>{t}</Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={S.td}>—</Text>
                  )}
                </View>
                <Text style={[S.td, {flex:1.0}]} numberOfLines={1}>{r.chip ? r.chip : '—'}</Text>
                <Text style={[S.td, {flex:1.2}]} numberOfLines={1}>{r.cap}</Text>
                <Text style={[S.td, {flex:0.8, color: r.hits ? '#ef4444' : C.ink}]}>
                  {r.hits ? -Math.abs(r.hits) : 0}
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    );
  };

  // ---------- GW Picker (overlay) ----------
  const GwPickerOverlay = () => (
    <View pointerEvents={gwPickerOpen ? 'auto' : 'none'} style={[S.centerWrap, { display: gwPickerOpen ? 'flex' : 'none' }]}>
    <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setGwPickerOpen(false)} />
      <View style={S.sumCardCenter}>
        <View style={S.sumHeader}>
          <Text style={S.sumTitle}>Go to Gameweek</Text>
          <TouchableOpacity style={S.smallBtn} onPress={() => setGwPickerOpen(false)}>
            <MaterialCommunityIcons name="close" size={14} color={C.ink} />
            <Text style={S.smallBtnTxt}>Close</Text>
          </TouchableOpacity>
        </View>
        <ScrollView>
          {Array.from({ length: maxGw }, (_, i) => i + 1).map((n) => {
            const disabled = n < minGw;
            return (
              <TouchableOpacity
                key={`gw-${n}`}
                style={[S.gwItem, disabled && S.navBtnDisabled]}
                onPress={() => { if (!disabled) { setGw(n); setGwPickerOpen(false); } }}
                disabled={disabled}
              >
                <Text style={S.gwItemTxt}>Gameweek {n}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );

  // ---------- Chips (overlay) ----------
  const ChipsOverlay = () => {
    const items = [
      { code: 'freehit', label: 'Free Hit' },
      { code: 'wildcard', label: 'Wildcard' },
      { code: 'bboost',  label: 'Bench Boost' },
      { code: '3xc',     label: 'Triple Captain' },
    ];
    return (
      <View pointerEvents={chipsOpen ? 'auto' : 'none'} style={[S.modalWrap, { display: chipsOpen ? 'flex' : 'none' }]}>
       <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setChipsOpen(false)} />
        <View style={S.chipsCard}>
          <View style={S.chipsHeader}>
            <Text style={S.chipsTitle}>Chips</Text>
            <TouchableOpacity style={S.smallBtn} onPress={() => setChipsOpen(false)}>
              <MaterialCommunityIcons name="close" size={14} color={C.ink} />
              <Text style={S.smallBtnTxt}>Close</Text>
            </TouchableOpacity>
          </View>
          <View style={S.chipsList}>
            {items.map(({ code, label }) => {
              const on = current?.chip === code;
              const selectable = chipIsSelectable(code, gw);
              const status = chipStatusLabel(code, gw, on);
              return (
                <TouchableOpacity
                  key={code}
                  onPress={() => { if (selectable || on) toggleChip(code); }}
                  disabled={!selectable && !on}
                  style={[S.chipLine, (!selectable && !on) && { opacity: 0.4 }]}
                >
                  <Text style={S.chipName}>{label}</Text>
                  <Text style={[S.chipName, { color: on ? C.ink : (status === 'USED' ? '#ef4444' : C.muted) }]}>
                    {status}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

         
        </View>
      </View>
    );
  };

  // Fallback position name map (needed by market rows)
  const POS_NAME = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
function RankLine({ label, rank, den, suffix, style }) {
  if (!Number.isFinite(rank) || !Number.isFinite(den) || den <= 0) return null;
  return (
    <Text style={style} numberOfLines={1}>
      {label ? `${label}: ` : ''}
      {Math.round(rank)} / {Math.round(den)}{suffix ? ` ${suffix}` : ''}
    </Text>
  );
}
  // For difficulty sums (respects custom overrides)
  const diffOf = useCallback((label) => getRatingAndColor(label).d, [getRatingAndColor]);

  // ---------- Season Ticker (overlay) with editable FDR ----------
  const TickerOverlay = () => {
    const CELL_W = 56;
    const MINE_W = 92;
    const DIFF_W = 56;
    const BASE_CELL_H = 36;

    const [rowHeights, setRowHeights] = useState({});
    const setRowHeight = useCallback((team, h) => {
      setRowHeights(prev => (prev[team] === h ? prev : { ...prev, [team]: h }));
    }, []);

    const [lookahead, setLookahead] = useState(5); // default 5 GWs
    const [sortByDiff, setSortByDiff] = useState(true);
    const [ascDiff, setAscDiff] = useState(true);



    // persist helpers
    const saveOverrides = useCallback(async (next) => {
      setFdrOverrides(next);
      try { await AsyncStorage.setItem(FDR_OVERRIDES_KEY, JSON.stringify(next)); } catch {}
    }, []);
    const saveUseCustom = useCallback(async (v) => {
      setUseCustomFdr(v);
      try { await AsyncStorage.setItem(FDR_CUSTOM_ENABLED_KEY, v ? '1' : '0'); } catch {}
    }, []);

    const onCycle = useCallback((label) => {
      if (!label) return;
      const curr = Number(fdrOverrides?.[label]) || (Array.isArray(fdrRatingsBase?.[label]) ? fdrRatingsBase[label][0] : 3) || 3;
      const base = Array.isArray(fdrRatingsBase?.[label]) ? fdrRatingsBase[label][0] : 3;
      const next = ((curr % 5) + 1);
      const out = { ...(fdrOverrides || {}) };
      out[label] = next;
      if (next === base) delete out[label];      // keep storage clean when equal to base
      saveOverrides(out);
    }, [fdrOverrides, saveOverrides, fdrRatingsBase]);

    const onResetLabel = useCallback((label) => {
      if (!label) return;
      const out = { ...(fdrOverrides || {}) };
      if (out[label] != null) {
        delete out[label];
        saveOverrides(out);
      }
    }, [fdrOverrides, saveOverrides]);


    const onResetAll = useCallback(() => {
      saveOverrides({});
    }, [saveOverrides]);

    const teamsRaw = useMemo(() => Object.keys(fdr || {}).sort(), [fdr]);
    const gwCount = maxGw;
    const startCol0 = Math.min(gwCount - 1, Math.max(0, (gw || 1) - 1));
    const endCol = Math.min(gwCount - 1, startCol0 + Math.max(1, lookahead) - 1);
    const range = useMemo(() => Array.from({ length: endCol - startCol0 + 1 }, (_, i) => startCol0 + i), [startCol0, endCol]);
const sumForTeam = useCallback((team) => {
  let sum = 0, has = false;
  for (const gi of range) {
    const perGw = (fdr?.[team] || [])[gi] || [];
    if (perGw.length === 0) continue;
    for (const [label] of perGw) {
      const d = diffOf(label); // respects custom overrides
      if (Number.isFinite(d)) { sum += d; has = true; }
    }
  }
  return has ? sum : null;
}, [fdr, range, diffOf]);
    const picksNow = useMemo(
      () => (current?.chip === 'bboost' ? (current?.picks || []) : (current?.picks || []).slice(0, 15)),
      [current?.picks, current?.chip]
    );
    const mineByTeam = useMemo(() => {
      const res = {};
      for (const pid of picksNow) {
        const t = teamNameByPid?.[pid];
        if (!t) continue;
        (res[t] ||= []).push(surname(namesById?.[pid] || String(pid)));
      }
      return res;
    }, [picksNow, teamNameByPid, namesById]);

    const teams = useMemo(() => {
      if (!sortByDiff) return teamsRaw;
      const scored = teamsRaw.map((team) => {
        let sum = 0;
        for (const gi of range) {
          const perGw = (fdr?.[team] || [])[gi] || [];
          if (perGw.length === 0) continue;
          for (const [label] of perGw) sum += diffOf(label);
        }
        return { team, sum };
      });
      scored.sort((a,b) => ascDiff ? (a.sum - b.sum) : (b.sum - a.sum));
      return scored.map(x=>x.team);
    }, [teamsRaw, fdr, range, sortByDiff, ascDiff, diffOf]);

    // --- FDR Editor (modal within ticker) ---
    const [editorOpen, setEditorOpen] = useState(false);
    const [editorDraft, setEditorDraft] = useState({});
    const visibleLabels = useMemo(() => {
      const set = new Set(Object.keys(fdrOverrides || {}));   // ensure edited labels always appear
      for (const team of Object.keys(fdr || {})) {
        for (const gi of range) {
          const perGw = (fdr?.[team] || [])[gi] || [];
          for (const [label] of perGw) set.add(label);
        }
      }
      return Array.from(set).sort();
    }, [fdr, range, fdrOverrides]);

    const openEditor = () => {
      const init = {};
      for (const label of visibleLabels) {
        const ov = fdrOverrides?.[label];
        if (typeof ov === 'number') {
          init[label] = ov;                                   // show my saved override
        } else {
          const base = Array.isArray(fdrRatingsBase?.[label]) ? fdrRatingsBase[label][0] : 3;
          init[label] = Number.isFinite(base) ? base : 3;     // fall back to FPL base
        }
      }
      setEditorDraft(init);
      
      setEditorOpen(true);
    };

    const stepLabel = (label, delta) => {
      setEditorDraft(prev => {
        const curr = Number(prev[label] ?? 3);
        let next = curr + delta;
        if (next < 1) next = 1;
        if (next > 5) next = 5;
        if (curr === next) return prev;
        return { ...prev, [label]: next };
      });
    };
    const saveEditor = () => {
      // compute overrides vs FPL base
      const out = {};
      for (const label of Object.keys(editorDraft)) {
        const base = Array.isArray(fdrRatingsBase?.[label]) ? fdrRatingsBase[label][0] : 3;
        const v = Number(editorDraft[label] ?? base ?? 3);
        if (v !== base) out[label] = v;
      }
      saveOverrides(out);
      saveUseCustom(true);
      setEditorOpen(false);
    };
          const resetEditorVisible = () => {
        setEditorDraft(prev => {
          const next = { ...prev };
          for (const label of visibleLabels) {
            const base = Array.isArray(fdrRatingsBase?.[label]) ? fdrRatingsBase[label][0] : 3;
            next[label] = Number.isFinite(base) ? base : 3;
          }
          return next;
        });
      };
      const sortMode = useMemo(() => {
  if (!sortByDiff) return 'club';      // alphabetical by club
  return ascDiff ? 'easy' : 'hard';    // difficulty ascending/descending
}, [sortByDiff, ascDiff]);

const cycleSort = useCallback(() => {
  // club → easy → hard → club …
  if (!sortByDiff) { setSortByDiff(true); setAscDiff(true); return; }   // club → easy
  if (ascDiff)      { setAscDiff(false); return; }                      // easy → hard
  setSortByDiff(false);                                                 // hard → club
}, [sortByDiff, ascDiff]);


      // local rating getter that respects the "use custom" toggle for the Ticker only
      const ratingFor = useCallback(
  (label) => getRatingAndColor(label),
  [getRatingAndColor]
);

      return (
        <>
          <View pointerEvents={tickerOpen ? 'auto' : 'none'} style={[S.modalWrap, { display: tickerOpen ? 'flex' : 'none' }]}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setTickerOpen(false)} />
            <View style={S.tickCard}>
              <View style={S.tickHeader}>
                <Text style={S.tickTitle}>Season Ticker (GW {startCol0 + 1} → GW {endCol + 1})</Text>
                <TouchableOpacity style={S.smallBtn} onPress={() => setTickerOpen(false)}>
                  <MaterialCommunityIcons name="close" size={14} color={C.ink} />
                  <Text style={S.smallBtnTxt}>Close</Text>
                </TouchableOpacity>
              </View>

              {/* Options */}
              <View style={S.tickOpts}>
                <Text style={{ color:C.muted, fontWeight:'800' }}>Gameweeks:</Text>
                <View style={{ flexDirection:'row', alignItems:'center', gap:6 }}>
                  <TouchableOpacity style={S.smallBtn} onPress={()=> setLookahead(v=> Math.max(1, v-1))}><Text style={S.smallBtnTxt}>–</Text></TouchableOpacity>
                  <Text style={[S.smallBtnTxt, { minWidth:40, textAlign:'center' }]}>{lookahead}</Text>
                  <TouchableOpacity style={S.smallBtn} onPress={()=> setLookahead(v=> Math.min(38, v+1))}><Text style={S.smallBtnTxt}>+</Text></TouchableOpacity>
                </View>

                <TouchableOpacity style={[S.smallBtn, { borderColor: C.ink }]} onPress={cycleSort}>
  <MaterialCommunityIcons
    name={sortMode === 'club'
      ? 'order-alphabetical-ascending'
      : (sortMode === 'easy' ? 'sort-numeric-ascending' : 'sort-numeric-descending')}
    size={14}
    color={C.ink}
  />
  <Text style={S.smallBtnTxt}>
    {sortMode === 'easy' ? 'Sort: Easy → Hard'
      : sortMode === 'hard' ? 'Sort: Hard → Easy'
      : 'Sort: By Club'}
  </Text>
</TouchableOpacity>



               

                <TouchableOpacity style={S.smallBtn} onPress={openEditor}>
                  <MaterialCommunityIcons name="pencil" size={14} color={C.ink} />
                  <Text style={S.smallBtnTxt}>Edit FDR</Text>
                </TouchableOpacity>
              </View>

              <ScrollView style={S.tickBody}>
                <View style={{ flexDirection:'row' }}>
                  {/* LEFT: sticky club column */}
                  <View>
                    <View style={[S.tickRow, { paddingHorizontal: 12 }]}>
                      <View style={[S.tickTeam, { backgroundColor:'transparent', borderWidth:0, height: BASE_CELL_H }]}>
                        <Text style={[S.tickCellTxt, { color: C.ink }]}>Club</Text>
                      </View>
                    </View>
                    {teams.map((team) => (
                      <View key={`left-${team}`} style={S.tickRow}>
                        <View style={[S.tickTeam, { height: rowHeights[team] ?? BASE_CELL_H }]}>
                          <Text numberOfLines={1} style={S.tickTeamTxt}>{team}</Text>
                        </View>
                      </View>
                    ))}
                  </View>

                  {/* RIGHT: Mine + GW grid */}
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View>
                      <View style={[S.tickRow, { paddingHorizontal: 12 }]}>
                        <View style={[S.tickMine, { width: MINE_W }]}>
                          <Text style={[S.tickCellTxt, { color: C.ink }]}>Mine</Text>
                        </View>
                        {/* NEW: Diff header cell */}
    <View style={[S.tickMine, { width: DIFF_W }]}>
      <Text style={[S.tickCellTxt, { color: C.ink }]}>Score</Text>
    </View>
                        <View style={[S.tickCellsWrap, { borderWidth:0 }]}>
                          <View style={S.tickCells}>
                            {range.map((gi) => (
                              <View key={`gwh-${gi}`} style={[S.tickCell, { width: CELL_W, minHeight: BASE_CELL_H, backgroundColor:'transparent' }]}>
                                <Text style={[S.tickCellTxt, { color: C.ink }]}>GW{gi + 1}</Text>
                              </View>
                            ))}
                          </View>
                        </View>
                      </View>

                      {teams.map((team) => (
                        <View
                          key={`row-${team}`}
                          style={S.tickRow}
                          onLayout={(e) => setRowHeight(team, e.nativeEvent.layout.height)}
                        >
                          <View style={[S.tickMine, { width: MINE_W }]}>
                            <Text style={S.tickMineTxt}>
                              {(mineByTeam[team] || []).join(', ') || '—'}
                            </Text>
                          </View>

{/* NEW: Diff value cell */}
      <View style={[S.tickMine, { width: DIFF_W }]}>
        <Text style={[S.tickCellTxt, { color: C.ink }]}>
          {(() => {
            const v = sumForTeam(team);
            return Number.isFinite(v) ? String(v) : '—';
          })()}
        </Text>
      </View>
                          <View style={S.tickCellsWrap}>
                            <View style={S.tickCells}>
                              {range.map((gi) => {
                                const perGw = (fdr?.[team] || [])[gi] || [];
                                if (perGw.length === 0) {
                                  return (
                                    <View key={`${team}-g${gi}-empty`} style={[S.tickCell, { width: CELL_W, minHeight: BASE_CELL_H, backgroundColor:'transparent' }]} />
                                  );
                                }
                                return (
                                  <View key={`${team}-g${gi}`} style={{ flexDirection:'column' }}>
                                    {perGw.map(([label], i) => {
                                      const { color, text } = ratingFor(label);
                                      return (
                                        <View
  key={`${team}-g${gi}-f${i}`}
  style={[S.tickCell, { width: CELL_W, minHeight: BASE_CELL_H, backgroundColor: color, justifyContent:'center' }]}
>
  <Text style={[S.tickCellTxt, { color: text }]} numberOfLines={1}>
    {shortFixture(label)}
  </Text>
</View>

                                      );
                                    })}
                                  </View>
                                );
                              })}
                            </View>
                          </View>
                        </View>
                      ))}
                    </View>
                  </ScrollView>
                </View>
              </ScrollView>
            </View>
          </View>

          {/* FDR Editor Modal */}
          <View
            pointerEvents={editorOpen ? 'auto' : 'none'}
            style={[S.centerWrapDim, { display: editorOpen ? 'flex' : 'none', position:'absolute', left:0, right:0, top:0, bottom:0, zIndex: 9999 }]}
          >
            <View style={S.editorCard}>
              <View style={S.sumHeader}>
                <Text style={S.sumTitle}>Edit FDR (start from FPL)</Text>
                <View style={{ flexDirection:'row', gap:8 }}>
                  <TouchableOpacity style={S.smallBtn} onPress={saveEditor}>
                    <MaterialCommunityIcons name="content-save" size={14} color={C.ink} />
                    <Text style={S.smallBtnTxt}>Save</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={S.smallBtn} onPress={() => setEditorOpen(false)}>
                    <MaterialCommunityIcons name="close" size={14} color={C.ink} />
                    <Text style={S.smallBtnTxt}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <ScrollView>
                {visibleLabels.map((label) => {
                  const val = Number(editorDraft[label] ?? 3);
                  return (
                    <View key={`ed-${label}`} style={S.editorRow}>
                      <Text style={S.editorLabel} numberOfLines={1}>{label}</Text>
                      <View style={S.editorControls}>
                        <TouchableOpacity style={S.smallBtn} onPress={() => stepLabel(label, -1)}>
                          <Text style={S.smallBtnTxt}>–</Text>
                        </TouchableOpacity>
                        <Text style={S.badgeNum}>{val}</Text>
                        <TouchableOpacity style={S.smallBtn} onPress={() => stepLabel(label, +1)}>
                          <Text style={S.smallBtnTxt}>+</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
              <View style={{ flexDirection:'row', justifyContent:'space-between', padding:12 }}>
                <TouchableOpacity style={S.smallBtn} onPress={resetEditorVisible}>
                  <MaterialCommunityIcons name="backup-restore" size={14} color={C.ink} />
                  <Text style={S.smallBtnTxt}>Reset Visible</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[S.smallBtn, { borderColor:'#ef4444' }]}
                  onPress={() => { saveOverrides({}); saveUseCustom(false); setEditorOpen(false); }}
                >
                  <MaterialCommunityIcons name="trash-can-outline" size={14} color="#ef4444" />
                  <Text style={[S.smallBtnTxt, { color:'#ef4444' }]}>Reset All My FDR</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </>
      );
    };

    // ---------- Refresh ----------
    const onRefresh = () => {
      setRefreshing(true);
      (async () => {
        try {
          const id = fplId || (await AsyncStorage.getItem('fplId'));
          const snap = await loadSnapshot(id);
          setSnapshot(snap);
          setWeeks((prev) => recomputeAll(prev, snap, playersInfo, bankOverrides));

        } catch (e) {
          setError(String(e?.message || e));
        } finally {
          setRefreshing(false);
        }
      })();
    };

    // ---------- Bank Editor (center modal) ----------
    const BankEditor = () => {
      const open = bankEditOpen;
      const close = () => setBankEditOpen(false);
       // Prefer an override for this GW; else use the freshly recomputed weeks[gw].bank
  const effectiveBankTenths =
    Number.isFinite(bankOverrides?.[gw])
      ? Number(bankOverrides[gw] || 0)
      : Number(weeks?.[gw]?.bank || 0);

  


  const displayMoney = (tenths) => `£${(Number(tenths || 0) / 10).toFixed(1)}m`;

  const step = (deltaTenths) => {
    setBankDraftTenths((v) => {
      const next = Math.max(-9999, Math.min(9999, v + deltaTenths)); // allow -999.9m .. 999.9m

      return next;
    });
  };

  const saveDraft = () => {
  setBankOverrides((prevOv) => {
    const desiredFinal = Number(bankDraftTenths || 0);
    const curFinal = Number(weeks?.[gw]?.bank ?? 0);

    // What is the "start of GW" bank that the engine currently uses?
    // - If an override already exists, that's the start bank.
    // - Else use the captured GW-start snapshot (__gwStart__.bank) if present.
    // - Else fall back to current final (safe fallback).
    const startEffective =
      (prevOv && Object.prototype.hasOwnProperty.call(prevOv, gw))
        ? Number(prevOv[gw])
        : Number(weeks?.[gw]?.__gwStart__?.bank ?? curFinal);

    // Keep transfer delta the same, just shift start bank so final becomes what user typed.
    const newStartOverride = startEffective + (desiredFinal - curFinal);

    const nextOv = { ...(prevOv || {}), [gw]: newStartOverride };
    setWeeks((prevWeeks) => recomputeAll(prevWeeks, snapshot, playersInfo, nextOv));
    return nextOv;
  });
  close();
};


const clearOverride = () => {
  setBankOverrides((prevOv) => {
    const nextOv = { ...(prevOv || {}) };
    delete nextOv[gw];
    setWeeks((prevWeeks) => recomputeAll(prevWeeks, snapshot, playersInfo, nextOv));
    return nextOv;
  });
  close();
};



      
     
      
      

      return (
        <View pointerEvents={open ? 'auto' : 'none'} style={[S.centerWrapDim, { display: open ? 'flex' : 'none' }]}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={close} />
          <View style={S.editorCard}>
            <View style={S.sumHeader}>
              <Text style={S.sumTitle}>Override Bank (GW {gw})</Text>
              <TouchableOpacity style={S.smallBtn} onPress={close}>
                <MaterialCommunityIcons name="close" size={14} color={C.ink} />
                <Text style={S.smallBtnTxt}>Close</Text>
              </TouchableOpacity>
            </View>

            <View style={{ paddingHorizontal:16, paddingBottom:12, alignItems:'center' }}>
              <Text style={{ color:C.muted, fontWeight:'800', marginBottom:10 }}>Bank value</Text>
              <Text style={[S.cardValue, { marginBottom: 12 }]}>{displayMoney(bankDraftTenths)}</Text>

              {/* big steppers row */}
              <View style={{ flexDirection:'row', gap:10, alignItems:'center', marginBottom: 12 }}>
                <TouchableOpacity style={S.smallBtn} onPress={() => step(-10)}><Text style={S.smallBtnTxt}>–1.0</Text></TouchableOpacity>
                <TouchableOpacity style={S.smallBtn} onPress={() => step(-1)} ><Text style={S.smallBtnTxt}>–0.1</Text></TouchableOpacity>
                <TouchableOpacity style={[S.smallBtn, { borderColor:C.ink }]} disabled>
                  <Text style={[S.smallBtnTxt, { minWidth: 64, textAlign: 'center' }]}>{(bankDraftTenths/10).toFixed(1)}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={S.smallBtn} onPress={() => step(+1)} ><Text style={S.smallBtnTxt}>+0.1</Text></TouchableOpacity>
                <TouchableOpacity style={S.smallBtn} onPress={() => step(+10)}><Text style={S.smallBtnTxt}>+1.0</Text></TouchableOpacity>
              </View>

              <View style={{ flexDirection:'row', gap:8 }}>
              <TouchableOpacity style={[S.smallBtn, { borderColor:'#ef4444' }]} onPress={clearOverride}>
                  <MaterialCommunityIcons name="eraser" size={14} color="#ef4444" />
                  <Text style={[S.smallBtnTxt, { color:'#ef4444' }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={S.smallBtn} onPress={saveDraft}>
                  <MaterialCommunityIcons name="content-save" size={14} color={C.ink} />
                  <Text style={S.smallBtnTxt}>Save</Text>
                </TouchableOpacity>
                
              </View>
            </View>
          </View>
        </View>
      );
    };

    // ---------- RENDER ----------
    const { gkRow, defRow, midRow, fwdRow, benchRow, benchBoostOn } = rowsForDisplay();

    return (
      <SafeAreaView style={S.page} edges={['left', 'right']}>
        <AppHeader />

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={S.container}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ width: '100%' }}>
            <InfoBanner text="All planning stays on your device (FT, chips, transfers). Autosaved. Future gameweeks update automatically." />

            <ControlsRow />
            

            <NavRow />
            <TopBar />

            

             <View style={S.pitchWrap}>
  {settingsOpen && (
    <View style={S.settingsLayer} pointerEvents="box-none">
    {/* Backdrop that closes on outside press */}
    <Pressable
      style={S.settingsBackdrop}
      onPress={() => setSettingsOpen(false)}
      pointerEvents="auto"
    />
    {/* Overlay itself */}
    <View style={S.settingsOverlayWrap} pointerEvents="box-none">
      <View style={S.settingsOverlay} pointerEvents="auto">
          <TouchableOpacity
            style={S.settingsBtn}
            onPress={() => setZoom(z => clampZoom(z * 0.99))}
            accessibilityLabel="Zoom out"
          >
            <View style={S.settingsBtnInner}>
              <MaterialCommunityIcons name="magnify-minus-outline" size={18} color={C.ink} />
              
            </View>
          </TouchableOpacity>

          {/* Zoom + */}
          <TouchableOpacity
            style={S.settingsBtn}
            onPress={() => setZoom(z => clampZoom(z * 1.010))}
            accessibilityLabel="Zoom in"
          >
            <View style={S.settingsBtnInner}>
              <MaterialCommunityIcons name="magnify-plus-outline" size={18} color={C.ink} />
              
            </View>
          </TouchableOpacity>

          {/* Mini fixtures toggle */}
          <TouchableOpacity
            style={S.settingsBtn}
            onPress={() => setShowMinis(v => !v)}
            accessibilityRole="switch"
            accessibilityState={{ checked: showMinis }}
          >
            <View style={S.settingsBtnInner}>
              <MaterialCommunityIcons
                name={showMinis ? 'toggle-switch' : 'toggle-switch-off'}
                size={22}
                color={C.ink}
              />
              <Text style={S.settingsTxt}>Mini fixtures: {showMinis ? 'ON' : 'OFF'}</Text>
            </View>
          </TouchableOpacity>
          {/* Share */}
   <TouchableOpacity
     style={[S.settingsBtn, { display: 'none' }]}

     onPress={handleShare}
     accessibilityLabel="Share planner image"
   >
     <View style={S.settingsBtnInner}>
       <MaterialCommunityIcons name="share-variant" size={18} color={C.ink} />
       <Text style={S.settingsTxt}>Share</Text>
     </View>
   </TouchableOpacity>
        </View>
      </View>
    </View>
  )}

             {/* Center the scaled pitch so it doesn’t clip left/right */}
              <View style={{ alignItems:'center' }}>
              <ImageBackground ref={shareTargetRef}
   collapsable={false} source={assetImages.pitch} style={[S.pitchBg, benchBoostOn && S.pitchStacked]}>
                <View
                  style={{
                    width: '100%',
                    transform: [{ scale: zoom }],
                    // Avoid layout jitter on Android when scaling
                    transformOrigin: 'center', // ignored on RN but OK to keep
                  }}
                >
                  
                    <TeamRow ids={gkRow} isFirst />
                    <TeamRow ids={defRow} />
                    <TeamRow ids={midRow} />
                    <TeamRow ids={fwdRow} />
                    {!benchBoostOn && <TeamRow ids={benchRow} isBenchRow />}
                    </View>
                  </ImageBackground>
                  
                
              </View>
            </View>
          </View>

          {(loading || !current) && (
            <View style={S.loadingOverlay}>
              <View style={S.loadingCard}>
                <ActivityIndicator size="large" />
                <Text style={S.loadingText}>Loading planner…</Text>
              </View>
            </View>
          )}

          {error ? (
            <View style={{ padding: 16 }}>
              <Text style={{ color: 'tomato' }}>{String(error)}</Text>
            </View>
          ) : null}
        </ScrollView>

        {/* Overlays / Sheets */}
        <ActionSheet />
        <TransferMarketModal /> 
        <AllPlayersStatsModal
  open={allStatsOpen}
  onClose={() => setAllStatsOpen(false)}
  extendedInfo={extendedInfo}
  playersInfo={playersInfo}
  extRanks={extRanks}
  C={C}
/>

        <ChipsOverlay />
        <GwPickerOverlay />
        
        
        <SummaryModal />
        <TickerOverlay />
        <SeasonStatsModal />
        <PlayerInfoModal
          visible={infoOpen}
          onClose={closeInfo}
          playerId={infoPid}
          playerName={infoPid ? (namesById?.[infoPid] || String(infoPid)) : ''}
          position={""}
        />
        <CompareModal />
        
        <BankEditor />
      </SafeAreaView>
    );
  }


