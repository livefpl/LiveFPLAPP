// Games.js (theme-integrated)
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import EventFeed from './EventFeed';

import AppHeader from './AppHeader';
import {
 
  ActivityIndicator,
  FlatList,
  SectionList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Image,
  Dimensions,

  Modal,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { clubCrestUri, assetImages } from './clubs';
import { smartFetch } from './signedFetch';
import { useColors,useTheme  } from './theme';
Text.defaultProps = Text.defaultProps || {};
Text.defaultProps.allowFontScaling = false;

/* ---------------------- Sizing ---------------------- */
const rem = Dimensions.get('window').width / 380;
const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;
const LIVEFPL_LOGO = assetImages?.livefplLogo ?? assetImages?.logo;
const SORT_OPTIONS = [
  { label: 'Chronological',     value: 'chrono' },
  { label: 'Live Games First',  value: 'live' },
  { label: 'Biggest Gain/Loss', value: 'net' },
  { label: 'Highest EO',        value: 'eo' },
];
const SORT_KEY = 'games.sortBy';

// Safe kickoff getter (accepts object or array payloads)
// Safe kickoff getter (array uses *last* entry; object uses common keys)
// Safe kickoff getter (accepts object or array payloads)
function getKickoffDate(game) {
  const parseMaybeDate = (v) => {
    if (v == null) return null;

    // numeric: treat < 1e12 as seconds, otherwise ms
    if (typeof v === 'number') {
      const n = v < 1e12 ? v * 1000 : v;
      const d = new Date(n);
      const yr = d.getUTCFullYear();
      return isNaN(d) || yr < 2020 || yr > 2100 ? null : d;
    }

    // string: normalize and parse as UTC, not local
    if (typeof v === 'string') {
      const s = v.trim();

      // ISO with timezone (Z or ±hh:mm) → safe
      if (/Z$|[+-]\d{2}:\d{2}$/.test(s)) {
        const d = new Date(s);
        return isNaN(d) ? null : d;
      }

      // "YYYY-MM-DD HH:mm(:ss)?" or "YYYY-MM-DDTHH:mm(:ss)?" (no tz)
      let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
      if (m) {
        const [ , Y, M, D, h, mnt, sec = '0' ] = m;
        const d = new Date(Date.UTC(+Y, +M - 1, +D, +h, +mnt, +sec));
        return isNaN(d) ? null : d;
      }

      // "YYYY-MM-DD" date-only
      m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) {
        const [ , Y, M, D ] = m;
        const d = new Date(Date.UTC(+Y, +M - 1, +D, 0, 0, 0));
        return isNaN(d) ? null : d;
      }

      // numeric string → same as number path
      if (/^\d+$/.test(s)) {
        const n = Number(s);
        return parseMaybeDate(n);
      }

      // last resort
      const d = new Date(s);
      return isNaN(d) ? null : d;
    }

    return null;
  };

  // Prefer known kickoff fields; fall back to common alternates
  if (Array.isArray(game)) {
    const candidates = [game[15], game[14], game[19], game[20]]; // adjust if your feed differs
    for (const c of candidates) {
      const d = parseMaybeDate(c);
      if (d) return d;
    }
    return null;
  } else {
    const k = game?.kickoff ?? game?.kickoff_time ?? game?.ko ?? game?.start ?? null;
    return parseMaybeDate(k);
  }
}


// Day label like "Saturday 12 Oct"
function formatDay(d) {
  try {
    return d.toLocaleDateString(undefined, {
      weekday: 'long',
      day: '2-digit',
      month: 'short',
    });
  } catch { return ''; }
}

// Time like "14:00"
function formatTime(d) {
  try {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

// Light metrics we need for sorting (team EO sum, abs net, live/done flags, kickoff)
function gameSortMetrics(game, eoMap, myExposure) {
  const status = Array.isArray(game) ? game[4] : (game?.status || '');
  const bonusStatus = Array.isArray(game) ? game[5] : (game?.bonus_status || '');
  const isLive = /live/i.test(status);
  const isDone = /done|official/i.test(status) || /official/i.test(bonusStatus);

  const tableH = Array.isArray(game) ? game[12] || [] : (game?.tableH || []);
  const tableA = Array.isArray(game) ? game[13] || [] : (game?.tableA || []);

  // rows: {id, eo, pts}
  const normalize = (table) =>
    (table || []).map((row) => {
      const id  = Number(row?.[5]) || null;
      const eo  = Number(row?.[1]) || 0;
      const pts = Number(row?.[3]) || 0;
      return { id, eo, pts };
    });

  const overlay = (rows) =>
    eoMap instanceof Map
      ? rows.map(r => (r.id && eoMap.has(r.id)) ? { ...r, eo: Number(eoMap.get(r.id)) || 0 } : r)
      : rows;

  const rowsH = overlay(normalize(tableH));
  const rowsA = overlay(normalize(tableA));

  const teamEOsum = rowsH.reduce((s,r)=>s+(r.eo||0),0) + rowsA.reduce((s,r)=>s+(r.eo||0),0);

  let net = 0;
  if (myExposure && typeof myExposure === 'object') {
    const all = rowsH.concat(rowsA);
    let my = 0, field = 0;
    for (const r of all) {
      const pts = r.pts || 0;
      const mul = Number(myExposure?.[r.id] ?? 0);
      const eoFrac = (Number(r.eo) || 0) / 100;
      my   += mul * pts;
      field+= eoFrac * pts;
    }
    net = my - field;
  }

  return {
    isLive, isDone,
    absNet: Math.abs(net || 0),
    teamEOsum: Number.isFinite(teamEOsum) ? teamEOsum : 0,
    kickoff: getKickoffDate(game),
  };
}

// --- DEV: simulate multiple games ---
const DEV_SIMULATE = { enabled: false, minute: 56 };

function forceLive(game, minute = 56) {
  const g = Array.isArray(game) ? [...game] : game;

  // status / bonus
  g[4] = 'Live';   // status
  g[5] = '';       // bonus_status

  const rewriteTable = (table = []) =>
    table.map((row = []) => {
      const r = [...row];
      const explained = Array.isArray(r[4]) ? [...r[4]] : [];
      const filtered = explained.filter(
        (t) => !(Array.isArray(t) && String(t[0]) === 'minutes')
      );
      filtered.push(['minutes', minute, 0]);
      r[4] = filtered;
      return r;
    });

  g[12] = rewriteTable(g[12] || []); // tableH
  g[13] = rewriteTable(g[13] || []); // tableA

  return g;
}

function forceNilNilNotLive(game) {
  const g = Array.isArray(game) ? [...game] : game;

  // score 0–0 and clear any event lists
  g[2] = 0; // home score
  g[3] = 0; // away score
  g[6] = [];  // goalsH
  g[7] = [];  // goalsA
  g[8] = [];  // assistsH
  g[9] = [];  // assistsA
  g[10] = []; // bonusH
  g[11] = []; // bonusA

  // ensure it's not live/done
  // (keep kickoff so your UI can still show time if needed)
  g[4] = 'Scheduled'; // status
  g[5] = '';          // bonus_status

  // remove any injected 'minutes' so maxMinutes = 0
  const stripMinutes = (table = []) =>
    table.map((row = []) => {
      const r = [...row];
      const explained = Array.isArray(r[4]) ? [...r[4]] : [];
      r[4] = explained.filter(
        (t) => !(Array.isArray(t) && String(t[0]) === 'minutes')
      );
      return r;
    });

  g[12] = stripMinutes(g[12] || []); // tableH
  g[13] = stripMinutes(g[13] || []); // tableA

  return g;
}

function simulateTail(list, minute = 56) {
  if (!Array.isArray(list) || list.length === 0) return list;
  const out = list.slice();

  // last: 0-0 not live
  out[out.length - 1] = forceNilNilNotLive(out[out.length - 1]);

  // previous: live 56' (if exists)
  if (out.length >= 2) {
    out[out.length - 2] = forceLive(out[out.length - 2], minute);
  }
  return out;
}


// Simple breakpoints for tiny/narrow phones
const XS = SCREEN_W <= 340;
const SM = SCREEN_W <= 380;

// How tall the player tables can get (tweak numbers as needed)
const TABLE_MAX_H = XS
  ? Math.min(SCREEN_H * 0.55, 420)
  : SM
  ? Math.min(SCREEN_H * 0.6, 520)
  : Math.min(SCREEN_H * 0.7, 620);

/* ---------------------- Options & API ---------------------- */
const SAMPLE_OPTIONS = [
  { label: 'Top 10k', value: 'top10k' },
  { label: 'Elite',   value: 'elite' },
  { label: 'Near You',   value: 'local' },
];

const CACHE_TTL_MS = 30000; // reuse cached response for 30s
const API_URL = 'https://livefpl.us/api/games.json';

/* ---------------------- EO Overlay Helpers ---------------------- */
const EO_TTL_MS = 10 * 60 * 1000; // 10 minutes

const normalizePercent = (v) => {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return n >= 0 ? n * 100 : n; // e.g., 0.02 -> 2%
};

const getEOFromStorage = async (key) => {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.t || !parsed?.data) return null;
    if (Date.now() - parsed.t > EO_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
};

const setEOToStorage = async (key, data) => {
  try { await AsyncStorage.setItem(key, JSON.stringify({ t: Date.now(), data })); } catch {}
};

const parseEOJson = (json) => {
  const map = new Map();
  if (!json) return map;
  if (!Array.isArray(json) && typeof json === 'object') {
    for (const [k, v] of Object.entries(json)) {
      if (v == null) continue;
      if (typeof v === 'number') map.set(Number(k), normalizePercent(v));
      else if (typeof v === 'object') {
        const eo = v.eo ?? v.EO ?? v.effective_ownership ?? v.effectiveOwnership ?? v.effective ?? v.value;
        if (eo != null) map.set(Number(k), normalizePercent(eo));
      }
    }
    return map;
  }
  if (Array.isArray(json)) {
    for (const item of json) {
      if (!item || typeof item !== 'object') continue;
      const id = item.id ?? item.element ?? item.element_id ?? item.pid ?? item.player_id;
      const eo = item.eo ?? item.EO ?? item.effective_ownership ?? item.effectiveOwnership ?? item.effective;
      if (id != null && eo != null) map.set(Number(id), normalizePercent(eo));
    }
  }
  return map;
};
function maxMinutesFromTables(tableH = [], tableA = []) {
  let maxM = 0;
  const scan = (table) => {
    for (const row of table) {
      const explained = row?.[4];
      if (!Array.isArray(explained)) continue;
      for (const t of explained) {
        if (!Array.isArray(t) || t.length < 2) continue;
        if (String(t[0]) === 'minutes') {
          const mins = Number(t[1]) || 0;
          if (mins > maxM) maxM = mins;
        }
      }
    }
  };
  scan(tableH);
  scan(tableA);
  return maxM;
}

function computeNetAggFromTables(tableH = [], tableA = [], eoMap, myExposure) {
  if (!myExposure || typeof myExposure !== 'object') return null;

  const normalize = (table) =>
    (table || []).map(([name, eo, _o, pts, _explained, elementId]) => ({
      id: Number(elementId) || null,
      eo: Number(eo) || 0,
      pts: Number(pts) || 0,
    }));

  const applyOverlay = (rows) =>
    (eoMap instanceof Map)
      ? rows.map(r => (r.id && eoMap.has(r.id)) ? { ...r, eo: Number(eoMap.get(r.id)) || 0 } : r)
      : rows;

  const rowsH = applyOverlay(normalize(tableH));
  const rowsA = applyOverlay(normalize(tableA));
  const all = rowsH.concat(rowsA);

  let my = 0, field = 0;
  for (const r of all) {
    const pts = r.pts || 0;
    const mul = Number(myExposure?.[r.id] ?? 0);     // your exposure multiplier
    const eoFrac = (r.eo || 0) / 100;               // sample EO fraction
    my += mul * pts;
    field += eoFrac * pts;
  }
  return { my, field, net: my - field };
}


function riskEmoji({ eo, loss }) {
  if ( loss > 3) return '☠️';
  if ( loss > 2) return '😈';
  return '';
}

function oppEmoji(gainPts) {
  if (gainPts > 3) return '✅';
  
  return '';
}

function toPct(n) {
  const v = Number(n) || 0;
  return (v > 0 ? '+' : v < 0 ? '' : '') + v.toFixed(0) + '%';
}

function toSignedPts(n) {
  const v = Number(n) || 0;
  const s = v > 0 ? '+' : '';
  return s + v.toFixed(1);
}

// Convert your existing arrays -> compact table rows
function buildOppThreatTables(threats, opportunities) {
  const opp = (opportunities || []).map(o => {
    const youPct = (Number(o.mul) || 0) * 100;
    const gainPct = (youPct - (Number(o.eo) || 0));         // positive
    const gainPts = (gainPct / 100) * (Number(o.pts) || 0); // positive or 0
    return {
      id: o.id, name: o.name,
      gainPct, pts: Number(o.pts) || 0,
      gainedPts: gainPts,
      emoji: oppEmoji(gainPts),
    };
  }).sort((a,b) => b.gainedPts - a.gainedPts || b.gainPct - a.gainPct);

  const thr = (threats || []).map(t => {
    const youPct = (Number(t.mul) || 0) * 100;
    const lossPct = -((Number(t.eo) || 0) - youPct);        // negative
    const lostPts = (lossPct / 100) * (Number(t.pts) || 0); // negative or 0
    const rawLoss = Math.max(0, ((Number(t.eo)||0)/100 - (youPct/100)) * (Number(t.pts)||0));
    return {
      id: t.id, name: t.name,
      lossPct, pts: Number(t.pts) || 0,
      lostPts,
      emoji: riskEmoji({ eo: Number(t.eo)||0, loss: rawLoss }),
    };
  }).sort((a,b) => a.lostPts - b.lostPts || a.lossPct - b.lossPct); // most negative first

  return { opp, thr };
}

async function loadEOOverlay(sample) {
  // figure out current GW (fallback to fplData → gw, then 1)
  let gw = Number(await AsyncStorage.getItem('gw.current'));
  if (!Number.isFinite(gw) || gw <= 0) {
    const cachedGW = await AsyncStorage.getItem('fplData');
    if (cachedGW) gw = Number(JSON.parse(cachedGW)?.data?.gw) || gw;
  }
  if (!Number.isFinite(gw) || gw <= 0) gw = 1;

  if (sample === 'elite') {
    const key = `EO:elite:gw${gw}`;
    const cached = await getEOFromStorage(key);
    if (cached) return { map: parseEOJson(cached), src: `cache:elite:gw${gw}` };
    const res = await fetch(`https://livefpl.us/${gw}/elite.json`, { headers: { 'cache-control': 'no-cache' } });
    if (!res.ok) throw new Error(`EO HTTP ${res.status}`);
    const json = await res.json();
    await setEOToStorage(key, json);
    return { map: parseEOJson(json), src: `net:elite:gw${gw}` };
  }

  if (sample === 'local') {
    const myId = await AsyncStorage.getItem('fplId');
    const raw =
      (myId && (await AsyncStorage.getItem(`localGroup:${myId}`))) ||
      (await AsyncStorage.getItem('localGroup'));
    const localNum = raw ? Number(raw) : null;
    if (!localNum) return { map: null, src: 'missing:local' };
    const key = `EO:local:${localNum}:gw${gw}`;
    const cached = await getEOFromStorage(key);
    if (cached) return { map: parseEOJson(cached), src: `cache:local_${localNum}:gw${gw}` };
    const res = await fetch(`https://livefpl.us/${gw}/local_${localNum}.json`, { headers: { 'cache-control': 'no-cache' } });
    if (!res.ok) throw new Error(`EO HTTP ${res.status}`);
    const json = await res.json();
    await setEOToStorage(key, json);
    return { map: parseEOJson(json), src: `net:local_${localNum}:gw${gw}` };
  }

  return { map: null, src: 'none' };
}


/* ---------------------- Layout helpers ---------------------- */
const COL_FLEX = XS
  ? { player: 2.3, eo: 1.1, pts: 0.9 }
  : SM
  ? { player: 2.3, eo: 1.0, pts: 0.8 }
  : { player: 2.3, eo: 1.0, pts: 0.8 };

// Fixed columns for progress bars so tracks align perfectly
const NAME_COL_W = XS ? 96 : SM ? 112 : 140;  // left label column
const VALUE_COL_W = XS ? 62 : 72; // more room for value + small badge

/* ---------------------- Helpers (pure JS) ---------------------- */
const safe = (v, fallback) => (v ?? fallback);

const LABELS = {
  minutes: 'Minutes',
  goals_scored: 'Goals',
  assists: 'Assists',
  clean_sheets: 'Clean Sheets',
  goals_conceded: 'Goals Conceded',
  saves: 'Saves',
  bonus: 'Bonus',
  BPS: 'BPS',
  yellow_cards: 'Yellow Cards',
  red_cards: 'Red Cards',
  own_goals: 'Own Goals',
  penalties_saved: 'Penalties Saved',
  penalties_missed: 'Penalties Missed',
  defensive_contribution: 'Defensive Contribution',
};

const TYPE_LABEL = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
const thresholdForType = (t) => (Number(t) === 2 ? 10 : 12);

// row format (from sample):
// [name, EO, O, score, explained, elementId, shortName, type]
function parseExplained(list) {
  const out = {};
  (list || []).forEach((t) => {
    if (!Array.isArray(t) || t.length < 2) return;
    const key = String(t[0]);
    const times = Number(t[1]) || 0;
    const pts = Number(t[2]) || 0;
    out[key] = { times, pts };
  });
  return out;
}

function tableToPlayers(table) {
  return (table || []).map((row) => {
    const [name, EO, _O, score, explained, elementId, shortName, type] = row;
    const e = parseExplained(explained);
    return {
      id: Number(elementId) || null,
      name: shortName || name,
      rawName: name,
      EO: Number(EO) || 0,
      pts: Number(score) || 0,
      type: Number(type) || 0,
      explainedMap: e,
      explainedRaw: explained || [],
      yc: e.yellow_cards?.times ?? 0,
      rc: e.red_cards?.times ?? 0,
      og: e.own_goals?.times ?? 0,
      penSaved: e.penalties_saved?.times ?? 0,
      penMissed: e.penalties_missed?.times ?? 0,
      goals: e.goals_scored?.times ?? 0,
      assists: e.assists?.times ?? 0,
    };
  });
}

const sortByTypeThenPts = (a, b) => {
  const ta = Number.isFinite(a.type) ? a.type : 99;
  const tb = Number.isFinite(b.type) ? b.type : 99;
  if (ta !== tb) return ta - tb;
  if (b.pts !== a.pts) return b.pts - a.pts;
  return (a.name || '').localeCompare(b.name || '');
};

function tallyFromCompact(pairs) {
  return (pairs || []).map(([name, arr]) => ({
    name,
    count: Array.isArray(arr) ? arr.length : Number(arr || 0) || 0,
  }));
}

// Build a Map<pid, value> for a given stat identifier from the stats table
function extractStatMap(statsList, identifier) {
  const entry = (statsList || []).find((s) => s?.identifier === identifier);
  if (!entry) return new Map();
  const combined = [...safe(entry.h, []), ...safe(entry.a, [])];
  const m = new Map();
  combined.forEach((obj) => {
    const pid = Number(obj.element);
    const val = Number(obj.value) || 0;
    if (!Number.isFinite(pid)) return;
    m.set(pid, (m.get(pid) || 0) + val);
  });
  return m;
}

function joinStatWithNames(statMap, idIndex, keyName) {
  const arr = [];
  statMap.forEach((value, id) => {
    const info = idIndex.get(id) || {};
    arr.push({
      id,
      name: info.name || String(id),
      type: info.type || 0,
      [keyName]: value,
    });
  });
  return arr.filter((x) => (x[keyName] || 0) > 0).sort((a, b) => b[keyName] - a[keyName]);
}

/* -------------------------- UI bits (theme-aware) --------------------------- */
function SectionTitle({ icon, children, styles, colors }) {
  return (
    <View style={styles.sectionTitle}>
      <MaterialCommunityIcons name={icon} size={16} color={colors.muted} />
      <Text style={styles.sectionTitleText}>{children}</Text>
    </View>
  );
}

// CollapsibleSection
function CollapsibleSection({ icon, title, open, onToggle, children, hint, rightExtra, styles, colors }) {
  return (
    <View style={{ marginTop: 8 }}>
      <TouchableOpacity onPress={onToggle} style={styles.collapseHeader} activeOpacity={0.8}>
        {/* LEFT: allow truncation */}
        <View style={styles.collapseLeft}>
          <MaterialCommunityIcons name={icon} size={16} color={colors.muted} />
          <Text style={styles.sectionTitleText} numberOfLines={1} ellipsizeMode="tail">
            {title}
          </Text>
          {hint ? <Text style={styles.hintText} numberOfLines={1} ellipsizeMode="tail">{hint}</Text> : null}
        </View>

        {/* RIGHT: don’t shrink + clamp pill width */}
        <View style={styles.collapseRight}>
          {rightExtra ? <View style={styles.rightClamp}>{rightExtra}</View> : null}
          <MaterialCommunityIcons
            name={open ? 'chevron-up' : 'chevron-down'}
            size={20}
            color={colors.muted}
          />
        </View>
      </TouchableOpacity>

      {open ? <View style={{ marginTop: 4 }}>{children}</View> : null}
    </View>
  );
}



function Chip({ children, color, borderColor, styles }) {
  return (
    <View style={[styles.chip, borderColor && { borderColor }, color && { backgroundColor: color }]}>
      <Text style={styles.chipText}>{children}</Text>
    </View>
  );
}

function BarRow({
  name,
  value,
  max,
  cap,
  unit,
  checkAt,
  color,
  styles,
  colors,
  // optional medal-style badge (e.g. "+3" for Bonus Race)
  badgeText,
  badgeColor,
}) {
  const barColor = color || colors.accent;
  const val = Number(value ?? 0);
  const capped = typeof cap === 'number' ? Math.min(val, cap) : val;
  const widthPct = max > 0 ? Math.min(100, Math.round((capped / max) * 100)) : 0;

  // legacy +2 for Defensive Contributions if value hits threshold (only when no custom badge)
  const hit = typeof checkAt === 'number' ? val >= checkAt : false;
  const showHitBadge = !badgeText && hit;
  const showCustomBadge = !!badgeText;

  return (
    <View style={styles.barRow}>
      {/* Fixed label column so all meters align */}
      <Text
        style={[styles.barName, { width: NAME_COL_W }]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {name}
      </Text>

      {/* Track (flexes), fill uses % so every track width is identical row-to-row */}
      <View style={styles.barMeter}>
        <View
          style={[
            styles.barFill,
            { width: `${widthPct}%`, backgroundColor: barColor },
          ]}
        />
      </View>

      {/* Fixed value/badge column (single line, right-aligned) */}
      <View
        style={{
          width: VALUE_COL_W,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'flex-end',
          // ensure one line; if it's ever too tight, widen VALUE_COL_W a bit
        }}
      >
        <Text style={styles.barValue} numberOfLines={1}>
          {val}{unit ? unit : ''}
        </Text>

        {/* Inline badge (no stacking) */}
        {showHitBadge ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 4 }}>
            <MaterialCommunityIcons name="plus-circle" size={10} color={colors.ok} />
            <Text style={[styles.barValue, { fontSize: 11, color: colors.ok, marginLeft: 2 }]}>
              +2
            </Text>
          </View>
        ) : null}

        {showCustomBadge ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 4 }}>
            <MaterialCommunityIcons
              name="plus-circle"
              size={10}
              color={badgeColor || colors.accent}
            />
            <Text
              style={[
                styles.barValue,
                { fontSize: 11, color: badgeColor || colors.accent, marginLeft: 2 },
              ]}
              numberOfLines={1}
            >
              {badgeText}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}


function TwoColumnList({ home, away, bullet = '•', styles, colors }) {
  return (
    <View style={styles.twoCol}>
      <View style={styles.col}>
        {home.length === 0 ? (
          <Text style={styles.mutedSmall}>—</Text>
        ) : (
          home.map((x, i) => (
            <Text style={styles.rowText} key={`h-${i}`} numberOfLines={1}>
              {bullet} {x.name}{x.count > 1 ? ` ×${x.count}` : ''}
            </Text>
          ))
        )}
      </View>
      <View style={[styles.col, { alignItems: 'flex-end' }]}>
        {away.length === 0 ? (
          <Text style={styles.mutedSmall}>—</Text>
        ) : (
          away.map((x, i) => (
            <Text style={styles.rowText} key={`a-${i}`} numberOfLines={1}>
              {x.name}{x.count > 1 ? ` ×${x.count}` : ''} {bullet}
            </Text>
          ))
        )}
      </View>
    </View>
  );
}

function BonusRow({ home, away, styles, colors }) {
  const renderSide = (list, align = 'flex-start', keyPrefix = 'h') => (
    <View style={[styles.bonusSide, { alignItems: align }]}>
      {list.length === 0 ? (
        <Text style={styles.mutedSmall}>—</Text>
      ) : (
        list.map(([name, b], i) => (
          <View key={`${keyPrefix}-${i}`} style={styles.bonusItem}>
            <MaterialCommunityIcons name="medal-outline" size={14} color={colors.accent} />
            <Text style={styles.rowText}>
              {' '}{name} <Text style={styles.bold}>+{b}</Text>
            </Text>
          </View>
        ))
      )}
    </View>
  );
  return (
    <View style={styles.bonusRow}>
      {renderSide(home, 'flex-start', 'h')}
      {renderSide(away, 'flex-end', 'a')}
    </View>
  );
}

/* ---------- EO sample help ---------- */
/* ---------- EO sample help (expanded) ---------- */
function SampleInfoHelp({ visible, onClose, styles, colors }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.helpBackdrop}>
        <View style={styles.helpCard}>
          <View style={styles.helpHeader}>
            <Text style={styles.helpTitle}>What’s this page doing?</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <MaterialCommunityIcons name="close" size={20} color={colors.ink} />
            </TouchableOpacity>
          </View>


          {/* What the page does */}
          <View style={{ gap: 8, marginBottom: 10 }}>
            <Text style={styles.helpLine}>
              • This page tracks each live/finished match and summarizes goals, assists, bonus and key races
              (Bonus Race & Defensive Contributions). It also shows <Text style={styles.bold}>Team EO</Text> and
              computes your <Text style={styles.bold}>Net Gain</Text> vs the field for the game based on your saved team exposure.
            </Text>
            <Text style={styles.helpLine}>
              • <Text style={styles.bold}>Rank Movers</Text> highlights players who are threats (high field ownership you don’t match)
              and opportunities (you own/captain more than the field).
            </Text>
          </View>

          <Text style={[styles.helpTitle, { marginTop: 2, marginBottom: 6 }]}>What do these samples mean?</Text>

          {/* What the samples are */}
          <View style={{ gap: 8 }}>
            <Text style={styles.helpLine}>
              <Text style={styles.bold}>Top 10k: </Text>
              Effective ownership based on managers around rank ~10,000.
            </Text>
            <Text style={styles.helpLine}>
              <Text style={styles.bold}>Elite: </Text>
              Curated long-term high performers tracked by LiveFPL (smaller but sharper sample).
            </Text>
            <Text style={styles.helpLine}>
              <Text style={styles.bold}>Near You: </Text>
              Managers close to your rank (local group). We detect your group from the Rank page; if your FPL ID isn’t saved yet, this may be unavailable.
            </Text>
          </View>

          <Text style={[styles.helpTitle, { marginTop: 12, marginBottom: 6 }]}>How are samples used?</Text>

          {/* How the overlay changes numbers */}
          <View style={{ gap: 8 }}>
            
            <Text style={styles.helpLine}>
              • <Text style={styles.bold}>Team EO</Text> is the sum of the displayed EO% values for that team (after the overlay).
            </Text>
            <Text style={styles.helpLine}>
              • <Text style={styles.bold}>Threats / Opportunities</Text> use the EO% of the chosen sample to compare the field’s ownership
              to yours (including captaincy multipliers), then rank the biggest deltas for this game.
            </Text>
            <Text style={styles.helpLine}>
              • <Text style={styles.bold}>Net Gain</Text> = (your exposure × player points) − (sample EO × player points), aggregated over all players in the match.
            </Text>
            
          </View>

          <TouchableOpacity onPress={onClose} style={styles.helpOkay}>
            <Text style={styles.helpOkayText}>Got it</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function getSortLabel(value) {
  const hit = SORT_OPTIONS.find(o => o.value === value);
  return hit ? hit.label : value;
}

function SortDropdown({ value, onChange, options, styles, colors }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        activeOpacity={0.8}
        style={styles.ddButton}
        accessibilityRole="button"
        accessibilityLabel="Change sort order"
      >
        <Text style={styles.ddButtonText} numberOfLines={1}>
          {getSortLabel(value)}
        </Text>
        <MaterialCommunityIcons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.muted}
        />
      </TouchableOpacity>

      {/* Use a transparent modal so the menu can overlay everything and close on outside tap */}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity
          style={styles.ddBackdrop}
          activeOpacity={1}
          onPress={() => setOpen(false)}
        >
          {/* Click-through blocker; actual menu below */}
        </TouchableOpacity>

        {/* Menu panel aligned to top-right (near the header). Tweak position if needed. */}
        <View pointerEvents="box-none" style={styles.ddFloatingWrap}>
          <View style={styles.ddMenu}>
            {options.map(opt => {
              const selected = opt.value === value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => { onChange(opt.value); setOpen(false); }}
                  activeOpacity={0.8}
                  style={[styles.ddItem, selected && styles.ddItemActive]}
                >
                  <Text
                    style={[styles.ddItemText, selected && styles.ddItemTextActive]}
                    numberOfLines={1}
                  >
                    {opt.label}
                  </Text>
                  {selected ? (
                    <MaterialCommunityIcons name="check" size={16} color={colors.accent} />
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </Modal>
    </>
  );
}

// --- New compact, Flashscore-style row ---
// --- Compact, Flashscore-style row with EO under each team ---
// --- Compact, Flashscore-style row with EO under each team & fixed right column ---
function CompactGameRow({ game, eoMap, myExposure, styles, colors, onPress, expanded }) {
  const hName = game[0], aName = game[1];
  const hScore = game[2], aScore = game[3];
  const status = game[4], bonusStatus = game[5];
  const teamHId = game[16], teamAId = game[17];
  const tableH = game[12] || [];
  const tableA = game[13] || [];

  const crestH = clubCrestUri ? { uri: clubCrestUri(teamHId) } : null;
  const crestA = clubCrestUri ? { uri: clubCrestUri(teamAId) } : null;

  const isLive = /live/i.test(status);
  const isDone = /done|official/i.test(status) || /Official/i.test(bonusStatus);

  // EO overlay
  const normalize = (table) =>
    (table || []).map(([name, eo, _o, _pts, _explained, elementId]) => ({
      id: Number(elementId) || null,
      eo: Number(eo) || 0,
    }));
  const applyOverlay = (rows) =>
    eoMap instanceof Map
      ? rows.map(r => (r.id && eoMap.has(r.id)) ? { ...r, eo: Number(eoMap.get(r.id)) || 0 } : r)
      : rows;

  const rowsH = applyOverlay(normalize(tableH));
  const rowsA = applyOverlay(normalize(tableA));
  const teamEO_H = rowsH.reduce((s, r) => s + (r.eo || 0), 0);
  const teamEO_A = rowsA.reduce((s, r) => s + (r.eo || 0), 0);

  // minute + net gain
  const minute = React.useMemo(() => maxMinutesFromTables(tableH, tableA), [tableH, tableA]);
  const netAgg = React.useMemo(
    () => computeNetAggFromTables(tableH, tableA, eoMap, myExposure),
    [tableH, tableA, eoMap, myExposure]
  );

  const gainStyle =
    !netAgg ? styles.fxGainZero
    : netAgg.net > 0 ? styles.fxGainPos
    : netAgg.net < 0 ? styles.fxGainNeg
    : styles.fxGainZero;
const ko = getKickoffDate(game);
  const phaseText =
    isDone ? 'FT'
    : isLive ? `${minute}'`
    : (ko ? formatTime(ko) : (status || '').toUpperCase());
  const showScore = isLive || isDone; // only show scores when live or finished

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[
        styles.fixtureRow,
        isLive ? styles.fixtureRowLive : isDone ? styles.fixtureRowDone : styles.fixtureRowIdle
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${hName} ${hScore}, ${aName} ${aScore}, ${phaseText}`}
      accessibilityHint={expanded ? 'Collapse match details' : 'Expand match details'}
    >
      {/* LEFT: slim status rail */}
      <View style={styles.fxLeft}>
        <Text
          style={[
            styles.fxPhase,
            isLive ? { color: colors.yellow } : isDone ? { color: colors.ok } : { color: colors.muted },
          ]}
          numberOfLines={1}
        >
          {phaseText}
        </Text>
        {isLive ? <View style={styles.fxLiveDot} /> : null}
      </View>

      {/* MIDDLE: two stacked team rows (EO under each team name) */}
      <View style={styles.fxMiddle}>
        {/* Home line */}
        <View style={styles.fxTeamLine}>
          {!!crestH && <Image source={crestH} style={styles.fxCrest} />}
          <View style={styles.fxTeamNameWrap}>
            <Text style={styles.fxTeamName} numberOfLines={1}>{hName}</Text>
            <Text style={styles.fxEOText} numberOfLines={1}>EO {Math.round(teamEO_H)}%</Text>
          </View>
            <Text style={styles.fxScore} accessibilityLabel={`home score ${hScore}`}>
    {showScore ? hScore : ''}
  </Text>

        </View>

        {/* Away line */}
        <View style={styles.fxTeamLine}>
          {!!crestA && <Image source={crestA} style={styles.fxCrest} />}
          <View style={styles.fxTeamNameWrap}>
            <Text style={styles.fxTeamName} numberOfLines={1}>{aName}</Text>
            <Text style={styles.fxEOText} numberOfLines={1}>EO {Math.round(teamEO_A)}%</Text>
          </View>
         <Text style={styles.fxScore} accessibilityLabel={`away score ${aScore}`}>
    {showScore ? aScore : ''}
  </Text>
        </View>
      </View>

      {/* RIGHT: fixed-width column (gain + chevron) */}
      <View style={styles.fxRight}>
        {netAgg && (
          <View style={[styles.fxGain, gainStyle]}>
            <MaterialCommunityIcons
              name={netAgg.net > 0 ? 'trending-up' : netAgg.net < 0 ? 'trending-down' : 'minus'}
              size={14}
              color={colors.ink}
            />
            <Text style={styles.fxGainText}>
              {netAgg.net > 0 ? '+' : ''}{netAgg.net.toFixed(1)}
            </Text>
          </View>
        )}
        <MaterialCommunityIcons
          style={{ marginTop: 2 }}
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={colors.muted}
        />
      </View>
    </TouchableOpacity>
  );
}




/* ------------------------- Game Card -------------------------- */
function GameCard({ game, eoMap, myExposure, styles, colors,onCollapse  }) {
  const hName = game[0];
  const aName = game[1];
  const hScore = game[2];
  const aScore = game[3];
  const status = game[4];
  const bonusStatus = game[5];
  const goalsH = safe(game[6], []);
  const goalsA = safe(game[7], []);
  const assistsH = safe(game[8], []);
  const assistsA = safe(game[9], []);
  const bonusH = safe(game[10], []);
  const bonusA = safe(game[11], []);
  const tableH = safe(game[12], []);
  const tableA = safe(game[13], []);
  const teamHId = game[16];
  const teamAId = game[17];
  const statsList = safe(game[18], []);

  const crestH = clubCrestUri ? { uri: clubCrestUri(teamHId) } : null;
  const crestA = clubCrestUri ? { uri: clubCrestUri(teamAId) } : null;

  const playersH = useMemo(() => tableToPlayers(tableH), [tableH]);
  const playersA = useMemo(() => tableToPlayers(tableA), [tableA]);

  const scorersHome = useMemo(() => tallyFromCompact(goalsH).filter(x => x.count > 0), [goalsH]);
  const scorersAway = useMemo(() => tallyFromCompact(goalsA).filter(x => x.count > 0), [goalsA]);
  const assistsHome = useMemo(() => tallyFromCompact(assistsH).filter(x => x.count > 0), [assistsH]);
  const assistsAway = useMemo(() => tallyFromCompact(assistsA).filter(x => x.count > 0), [assistsA]);
// Own goals benefit the opponent
const ownToHome = useMemo(
  () => playersA.filter(p => p.og > 0).map(p => ({ name: `${p.name} (OG)`, count: p.og })),
  [playersA]
);
const ownToAway = useMemo(
  () => playersH.filter(p => p.og > 0).map(p => ({ name: `${p.name} (OG)`, count: p.og })),
  [playersH]
);

// Final goals lists (regular scorers + opponent own goals)
const goalsHomeDisplay = useMemo(
  () => [...scorersHome, ...ownToHome],
  [scorersHome, ownToHome]
);
const goalsAwayDisplay = useMemo(
  () => [...scorersAway, ...ownToAway],
  [scorersAway, ownToAway]
);

  const maxMinutes = useMemo(() => {
    const h = playersH.map(p => p.explainedMap?.minutes?.times ?? 0);
    const a = playersA.map(p => p.explainedMap?.minutes?.times ?? 0);
    return Math.max(0, ...h, ...a);
  }, [playersH, playersA]);

  const isLive = /live/i.test(status);
  const isDone = /done|official/i.test(status) || /Official/i.test(bonusStatus);

  const emojiFor = React.useCallback((pts, kind /* 'threat' | 'opportunity' */) => {
    const delivered = Number(pts) > 3;
    if (isDone || (isLive && delivered)) {
      return delivered
        ? (kind === 'threat' ? '😔' : '✅')
        : (kind === 'threat' ? '😃' : '👎');
    }
    if (isLive && !delivered) return '🤞';
    return '⏳';
  }, [isLive, isDone]);

  // Build id-> {name,type} index from both team tables to label stat rows
  const idIndex = useMemo(() => {
    const m = new Map();
    playersH.forEach((p) => { if (p.id) m.set(p.id, { name: p.name, type: p.type }); });
    playersA.forEach((p) => { if (p.id && !m.has(p.id)) m.set(p.id, { name: p.name, type: p.type }); });
    return m;
  }, [playersH, playersA]);

  const bpsMap = useMemo(() => extractStatMap(statsList, 'bps'), [statsList]);
  const defMap = useMemo(() => extractStatMap(statsList, 'defensive_contribution'), [statsList]);

  const bpsJoined = useMemo(() => joinStatWithNames(bpsMap, idIndex, 'bps'), [bpsMap, idIndex]);
  const defJoined = useMemo(() => joinStatWithNames(defMap, idIndex, 'def'), [defMap, idIndex]);
// --- Correct, tie-aware (competition ranking) bonus from BPS ---
// Sort by BPS desc; assign ranks 1,2,3 with competition ranking (1,1,3,4...).
// Then map rank→bonus: 1→+3, 2→+2, 3→+1.
function deriveBonusMapFromBps(bpsArr) {
  const arr = (bpsArr || [])
    .map(p => ({ id: p.id, bps: Number(p.bps) || 0 }))
    .sort((a, b) => b.bps - a.bps);

  const bonusMap = new Map();
  let prevBps = null;
  let rankForThisBps = 0;  // the rank assigned to this BPS value
  let seen = 0;            // how many players we've iterated over (1-based index)

  for (const p of arr) {
    seen += 1;
    if (prevBps === null || p.bps !== prevBps) {
      // new BPS group: competition ranking assigns rank = seen
      rankForThisBps = seen;
      prevBps = p.bps;
    }
    // award only for ranks 1..3
    const award =
      rankForThisBps === 1 ? 3 :
      rankForThisBps === 2 ? 2 :
      rankForThisBps === 3 ? 1 : 0;

    if (p.id && award > 0) bonusMap.set(p.id, award);
  }
  return bonusMap;
}


// Quick membership sets
const homeIdSet = useMemo(() => new Set(playersH.map(p => p.id).filter(Boolean)), [playersH]);
const awayIdSet = useMemo(() => new Set(playersA.map(p => p.id).filter(Boolean)), [playersA]);

// Derived awards map
const bonusMap = useMemo(() => deriveBonusMapFromBps(bpsJoined), [bpsJoined]);

// Derived Bonus Points lists (for the "Bonus Points" section)
const bonusHomeDerived = useMemo(() => {
  const rows = [];
  for (const p of (bpsJoined || [])) {
    const award = bonusMap.get(p.id) || 0;
    if (award > 0 && homeIdSet.has(p.id)) rows.push([p.name, award]);
  }
  rows.sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  return rows;
}, [bpsJoined, bonusMap, homeIdSet]);

const bonusAwayDerived = useMemo(() => {
  const rows = [];
  for (const p of (bpsJoined || [])) {
    const award = bonusMap.get(p.id) || 0;
    if (award > 0 && awayIdSet.has(p.id)) rows.push([p.name, award]);
  }
  rows.sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  return rows;
}, [bpsJoined, bonusMap, awayIdSet]);


  // Collapsibles (hidden by default)
  const [bpsOpen, setBpsOpen] = useState(false);
  const [defOpen, setDefOpen] = useState(false);
  

  // Threats/opportunities collapsibles (hidden by default as requested)
  const [rankMoversOpen, setRankMoversOpen] = useState(false);

  // Top-8 vs all toggle when open
  const [bpsExpanded, setBpsExpanded] = useState(false);
  const bpsShow = bpsExpanded ? bpsJoined : bpsJoined.slice(0, 8);
  const bpsMax = bpsJoined.length ? Math.max(...bpsJoined.map(p => p.bps)) : 0;

  const [defExpanded, setDefExpanded] = useState(false);

  const defSorted = useMemo(() => {
    const arr = defJoined.map((p) => {
      const cap = thresholdForType(p.type);
      const val = Number(p.def) || 0;
      return { ...p, cap, remaining: Math.max(cap - val, 0) };
    });
    arr.sort((a, b) =>
      a.remaining - b.remaining ||
      (b.def || 0) - (a.def || 0) ||
      (a.name || '').localeCompare(b.name || '')
    );
    return arr;
  }, [defJoined]);

  const defShow = defExpanded ? defSorted : defSorted.slice(0, 8);

  // Teams modal + Player detail panel
  const [showTeamsModal, setShowTeamsModal] = useState(false);
  const [playerDetail, setPlayerDetail] = useState(null);

  const normalizeRows = (table) =>
    (table || []).map(([name, eo, _o, pts, explained, elementId, shortName, type]) => ({
      id: Number(elementId) || null,
      name: shortName || name,
      eo: Number(eo) || 0,
      pts: Number(pts) || 0,
      type: Number(type) || 0,
      explainedMap: parseExplained(explained || []),
      explainedRaw: explained || [],
    }));

  const applyOverlay = useCallback((rows) => {
    if (!eoMap || !(eoMap instanceof Map)) return rows;
    return rows.map(r => (r.id && eoMap.has(r.id)) ? { ...r, eo: Number(eoMap.get(r.id)) || 0 } : r);
  }, [eoMap]);

  const rowsH = useMemo(() => applyOverlay(normalizeRows(tableH)).sort(sortByTypeThenPts), [tableH, applyOverlay]);
  const rowsA = useMemo(() => applyOverlay(normalizeRows(tableA)).sort(sortByTypeThenPts), [tableA, applyOverlay]);

  const teamEO_H = useMemo(() => rowsH.reduce((s, r) => s + (Number(r.eo) || 0), 0), [rowsH]);
  const teamEO_A = useMemo(() => rowsA.reduce((s, r) => s + (Number(r.eo) || 0), 0), [rowsA]);

  const threats = useMemo(() => {
    try {
      if (!myExposure || typeof myExposure !== 'object') return [];
      const all = [...rowsH, ...rowsA];
      const out = all.map(r => {
        const mul = Number(myExposure?.[r.id] ?? 0);
        const delta = (Number(r.eo) || 0) - (mul * 100);
        return { id: r.id, name: r.name, eo: Number(r.eo)||0, mul, delta, pts: Number(r.pts)||0 };
      }).filter(t => t.delta > 0);
      out.sort((a,b) => b.delta - a.delta || (b.eo - a.eo));
      return out.slice(0, 5);
    } catch { return []; }
  }, [rowsH, rowsA, myExposure]);

  const opportunities = useMemo(() => {
    try {
      if (!myExposure || typeof myExposure !== 'object') return [];
      const all = [...rowsH, ...rowsA];
      const out = all.map(r => {
        const mul = Number(myExposure?.[r.id] ?? 0);
        const delta = (mul * 100) - (Number(r.eo) || 0);
        return { id: r.id, name: r.name, eo: Number(r.eo)||0, mul, delta, pts: Number(r.pts)||0 };
      }).filter(t => t.mul > 0 && t.delta > 0);
      out.sort((a,b) => b.delta - a.delta || (b.mul - a.mul));
      return out.slice(0, 5);
    } catch { return []; }
  }, [rowsH, rowsA, myExposure]);

  // Aggregate: my points vs field points for this game
  const netAgg = useMemo(() => {
    try {
      if (!myExposure || typeof myExposure !== 'object') return null;
      let my = 0;
      let field = 0;
      const all = [...rowsH, ...rowsA];
      for (const r of all) {
        const pts = Number(r.pts) || 0;
        const mul = Number(myExposure?.[r.id] ?? 0);
        const eoFrac = (Number(r.eo) || 0) / 100;
        my += mul * pts;
        field += eoFrac * pts;
      }
      return { my, field, net: my - field };
    } catch {
      return null;
    }
  }, [rowsH, rowsA, myExposure]);

  const onRowPress = (row) => setPlayerDetail(row);

  return (
    <View style={styles.card}>
    {/* collapse chevron */}
     {onCollapse ? (
       <TouchableOpacity
         onPress={onCollapse}
         accessibilityRole="button"
         accessibilityLabel="Collapse match details"
         accessibilityHint="Return to compact row"
         style={styles.cardChevronBtn}
         activeOpacity={0.8}
      >
         <MaterialCommunityIcons name="chevron-up" size={22} color={colors.muted} />
       </TouchableOpacity>
     ) : null}
      {/* Header */}
      <View style={styles.headerRow}>
        {/* Home block */}
        <View style={[styles.teamBlock, styles.teamBlockCenter]}>
          {!!crestH && <Image source={crestH} style={styles.crestBig} />}
          <Text style={styles.teamName} numberOfLines={1}>{hName}</Text>
          <Text style={styles.teamMeta}>Team EO: {teamEO_H.toFixed(1)}%</Text>
        </View>

        {/* score + status */}
        <View style={styles.scoreBlock}>
          <Text style={styles.scoreText}>{hScore} — {aScore}</Text>
          <View style={styles.statusWrap}>
            <Chip styles={styles}>
              <Text style={[styles.statusText, isLive ? { color: colors.yellow } : isDone ? { color: colors.ok } : { color: colors.muted }]}>
                {status} {maxMinutes}'
              </Text>
            </Chip>
            
            
            <TouchableOpacity style={styles.playersBtn} onPress={() => setShowTeamsModal(true)}>
              <MaterialCommunityIcons name="account-group-outline" size={14} color={'white'} />
              <Text style={styles.playersBtnText}>Expand All Players</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Away block */}
        <View style={[styles.teamBlock, styles.teamBlockCenter]}>
          {!!crestA && <Image source={crestA} style={styles.crestBig} />}
          <Text style={[styles.teamName]} numberOfLines={1}>{aName}</Text>
          <Text style={styles.teamMeta}>Team EO: {teamEO_A.toFixed(1)}%</Text>
        </View>
      </View>
      
{/* Scorers & Assists strip (compact, no headings) */}
{(() => {
  const hasGoals = (scorersHome.length + scorersAway.length) > 0;
  const hasAssists = (assistsHome.length + assistsAway.length) > 0;
  if (!hasGoals && !hasAssists) return null;
  return (
    <View style={styles.eventsStrip}>
      {hasGoals && (
        <TwoColumnList
          home={goalsHomeDisplay}
          away={goalsAwayDisplay}
          bullet="⚽"
          styles={styles}
          colors={colors}
        />
      )}
      {hasAssists && (
        <TwoColumnList
          home={assistsHome}
          away={assistsAway}
          bullet="🅰️"
          styles={styles}
          colors={colors}
        />
      )}
    </View>
  );
})()}

<CollapsibleSection
  icon="swap-vertical"
  title="Rank Movers"
  open={rankMoversOpen}
  onToggle={() => setRankMoversOpen(o => !o)}
  
  styles={styles}
  colors={colors}
  rightExtra={
    netAgg ? (
      <Chip styles={styles}>
        <Text
          numberOfLines={1}
          style={[
            styles.statusText,
            netAgg.net > 0
              ? { color: colors.ok }
              : netAgg.net < 0
              ? { color: colors.red }
              : { color: colors.muted },
          ]}
        >
          Net Gain: {netAgg.net > 0 ? '+' : ''}{netAgg.net.toFixed(1)} pts
        </Text>
      </Chip>
    ) : null
  }
>
  {(() => {
    const { opp, thr } = buildOppThreatTables(threats, opportunities);

    const Table = ({ title, rows, kind }) => (
      <View style={{ marginTop: 6 }}>
        <View style={styles.subHeaderRow}>
          <MaterialCommunityIcons
            name={kind === 'opp' ? 'star-outline' : 'alert-outline'}
            size={16}
            color={colors.muted}
          />
          <Text style={styles.subHeaderText}>{title}</Text>
        </View>

        <View style={styles.tableWrap}>
          <View style={styles.tableHead}>
            <Text style={[styles.th, styles.colPlayer]}>Player</Text>
            <Text style={[styles.th, styles.colNum, styles.cellRight]}>
              {kind === 'opp' ? 'Gain %' : 'Loss %'}
            </Text>
            <Text style={[styles.th, styles.colNum, styles.cellRight]}>Pts</Text>
            <Text style={[styles.th, styles.colNum, styles.cellRight]}>
              {kind === 'opp' ? 'Gained Pts' : 'Lost Pts'}
            </Text>
            <Text style={[styles.th, styles.colRisk]}> </Text>
          </View>

          {rows.length === 0 ? (
            <View style={{ padding: 8 }}>
              <Text style={styles.mutedSmall}>
                {kind === 'opp' ? 'No players for you in this game.' : 'No major threats detected.'}
              </Text>
            </View>
          ) : (
            <View style={styles.tableBody}>
              {rows.map((r, i) => (
                <TouchableOpacity
                  key={`${r.id || r.name}-${i}`}
                  style={[styles.tr, i % 2 === 1 && styles.trAlt]}
                  activeOpacity={0.7}
                  onPress={() => onRowPress({
                    id: r.id, name: r.name, pts: r.pts, type: undefined,
                    explainedMap: {}, explainedRaw: []
                  })}
                >
                  <Text style={[styles.td, styles.colPlayer]} numberOfLines={1} ellipsizeMode="tail">{r.name}</Text>

                  {kind === 'opp' ? (
                    <Text style={[styles.td, styles.colNum, styles.cellRight, { color: colors.ok }]}>
                      {toPct(r.gainPct)}
                    </Text>
                  ) : (
                    <Text style={[styles.td, styles.colNum, styles.cellRight, { color: colors.red }]}>
                      {toPct(r.lossPct)}
                    </Text>
                  )}

                  <Text style={[styles.td, styles.colNum, styles.cellRight]}>{r.pts}</Text>

                  {kind === 'opp' ? (
                    <Text style={[styles.td, styles.colNum, styles.cellRight, { color: colors.ok }]}>
                      {toSignedPts(r.gainedPts)}
                    </Text>
                  ) : (
                    <Text style={[styles.td, styles.colNum, styles.cellRight, { color: colors.red }]}>
                      {toSignedPts(r.lostPts)}
                    </Text>
                  )}

                  <Text style={[styles.td, styles.colRisk]}>
                    {kind === 'opp' ? oppEmoji(r.gainedPts) : r.emoji}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </View>
    );

    return (
      <>
        <Table title="Opportunities" rows={opp} kind="opp" />
        <Table title="Threats" rows={thr} kind="thr" />
      </>
    );
  })()}
</CollapsibleSection>


      <CollapsibleSection
        icon="shield-outline"
        title="Defensive Contributions"
        open={defOpen}
        onToggle={() => setDefOpen((o) => !o)}
        hint={!defOpen ? 'Tap to expand' : undefined}
        styles={styles}
        colors={colors}
      >
        <View style={styles.barsBox}>
          {defShow.length === 0 ? (
            <Text style={styles.mutedSmall}>—</Text>
          ) : (
            defShow.map((p) => {
              const cap = p.cap ?? thresholdForType(p.type);
              return (
                <BarRow
                  key={`def-${p.id}`}
                  name={`${p.name}${p.type ? ` (${TYPE_LABEL[p.type] || p.type})` : ''}`}
                  value={p.def || 0}
                  max={cap}
                  cap={cap}
                  unit={`/${cap}`}
                  checkAt={cap}
                  color={colors.accentDark}
                  styles={styles}
                  colors={colors}
                />
              );
            })
          )}
        </View>
        {defSorted.length > 8 && (
          <TouchableOpacity style={styles.toggleBtn} onPress={() => setDefExpanded((s) => !s)}>
            <Text style={styles.toggleText}>{defExpanded ? 'Show top 8' : `Show all ${defSorted.length}`}</Text>
          </TouchableOpacity>
        )}
      </CollapsibleSection>

      {/* --- Collapsible analytics BEFORE Goals/Assists --- */}
      <CollapsibleSection
        icon="chart-bar"
        title="Bonus Race"
        open={bpsOpen}
        onToggle={() => setBpsOpen((o) => !o)}
        hint={!bpsOpen ? 'Tap to expand' : undefined}
        styles={styles}
        colors={colors}
      >
        <View style={styles.barsBox}>
          {bpsShow.length === 0 ? (
            <Text style={styles.mutedSmall}>—</Text>
          ) : (
           bpsShow.map((p) => {
    const award = bonusMap.get(p.id) || 0;
    return (
      <BarRow
        key={`bps-${p.id}`}
        name={p.name}
        value={p.bps}
        max={bpsMax}
        styles={styles}
        colors={colors}
        // NEW: medal-style inline badge
        badgeText={award > 0 ? `+${award}` : undefined}
        badgeColor={award > 0 ? colors.accent : undefined}
      />
    );
  })
          )}
        </View>
        {bpsJoined.length > 8 && (
          <TouchableOpacity style={styles.toggleBtn} onPress={() => setBpsExpanded((s) => !s)}>
            <Text style={styles.toggleText}>{bpsExpanded ? 'Show top 8' : `Show all ${bpsJoined.length}`}</Text>
          </TouchableOpacity>
        )}
      </CollapsibleSection>

      

      

      {/* Bonus points list */}
      <SectionTitle icon="medal-outline" styles={styles} colors={colors}>Bonus Points</SectionTitle>
 
<BonusRow home={bonusHomeDerived} away={bonusAwayDerived} styles={styles} colors={colors} />


      {/* Cards & Pens */}
      <SectionTitle icon="card-outline" styles={styles} colors={colors}>Cards & Pens</SectionTitle>
      <View style={styles.tagsRow}>
        {[
          ...rowsFromList('🟨', playersH.filter(p=>p.yc>0).map(p=>({name:p.name,count:p.yc})), 'left', null, styles, colors),
          ...rowsFromList('🟨', playersA.filter(p=>p.yc>0).map(p=>({name:p.name,count:p.yc})), 'right', null, styles, colors),
          ...rowsFromList('🟥', playersH.filter(p=>p.rc>0).map(p=>({name:p.name,count:p.rc})), 'left', colors.red, styles, colors),
          ...rowsFromList('🟥', playersA.filter(p=>p.rc>0).map(p=>({name:p.name,count:p.rc})), 'right', colors.red, styles, colors),
          
          ...rowsFromList('🧤 PS', playersH.filter(p=>p.penSaved>0).map(p=>({name:p.name,count:p.penSaved})), 'left', colors.ok, styles, colors),
          ...rowsFromList('🧤 PS', playersA.filter(p=>p.penSaved>0).map(p=>({name:p.name,count:p.penSaved})), 'right', colors.ok, styles, colors),
          ...rowsFromList('❌ PM', playersH.filter(p=>p.penMissed>0).map(p=>({name:p.name,count:p.penMissed})), 'left', colors.red, styles, colors),
          ...rowsFromList('❌ PM', playersA.filter(p=>p.penMissed>0).map(p=>({name:p.name,count:p.penMissed})), 'right', colors.red, styles, colors),
        ]}
      </View>

      {/* TEAMS MODAL */}
      <Modal
        visible={showTeamsModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowTeamsModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{hName} & {aName}</Text>
              <TouchableOpacity onPress={() => setShowTeamsModal(false)} style={styles.closeBtn}>
                <MaterialCommunityIcons name="close" size={20} color={colors.ink} />
              </TouchableOpacity>
            </View>

            {/* two tables side-by-side */}
            <View style={[styles.modalRowFit, XS && { gap: 8 }]}>
              {/* Home table */}
              <View style={[styles.teamTable, XS && styles.teamTableXS]}>
                <View style={styles.tableHeader}>
                  {!!crestH && <Image source={crestH} style={styles.crestSmall} />}
                  <Text style={styles.tableTeamName} numberOfLines={1}>{hName}</Text>
                </View>
                <View style={styles.tableCols}>
                  <Text style={[styles.th, styles.cellPlayer, SM && styles.thSM, { flex: COL_FLEX.player }]}>
                    Player
                  </Text>
                  <Text style={[styles.th, styles.cellRight, SM && styles.thSM, { flex: COL_FLEX.eo }]}>
                    EO%
                  </Text>
                  <Text style={[styles.th, styles.cellRight, SM && styles.thSM, { flex: COL_FLEX.pts }]}>
                    Pts
                  </Text>
                </View>
                <ScrollView style={{ maxHeight: TABLE_MAX_H }}>
                  {rowsH.map((r) => (
                    <TouchableOpacity
                      key={`hr-${r.id ? r.id : Math.random()}`}
                      style={styles.trTouchable}
                      onPress={() => onRowPress(r)}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[styles.td, styles.cellPlayer, SM && styles.tdSM, { flex: COL_FLEX.player }]}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                      >
                        {r.name}
                      </Text>
                      <Text
                        style={[styles.td, styles.cellRight, SM && styles.tdSM, { flex: COL_FLEX.eo }]}
                        numberOfLines={1}
                      >
                        {r.eo.toFixed(1)}%
                      </Text>
                      <Text
                        style={[styles.td, styles.cellRight, SM && styles.tdSM, { flex: COL_FLEX.pts }]}
                        numberOfLines={1}
                      >
                        {r.pts}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <View style={styles.breakdownFooter}>
                  <MaterialCommunityIcons name="gesture-tap" size={14} color={colors.muted} />
                  <Text style={styles.mutedSmall}> Tap a player in the table to view their breakdown.</Text>
                </View>
              </View>

              {/* Away table */}
              <View style={[styles.teamTable, XS && styles.teamTableXS]}>
                <View style={styles.tableHeader}>
                  {!!crestA && <Image source={crestA} style={styles.crestSmall} />}
                  <Text style={styles.tableTeamName} numberOfLines={1}>{aName}</Text>
                </View>
                <View style={styles.tableCols}>
                  <Text style={[styles.th, styles.cellPlayer, SM && styles.thSM, { flex: COL_FLEX.player }]}>
                    Player
                  </Text>
                  <Text style={[styles.th, styles.cellRight, SM && styles.thSM, { flex: COL_FLEX.eo }]}>
                    EO%
                  </Text>
                  <Text style={[styles.th, styles.cellRight, SM && styles.thSM, { flex: COL_FLEX.pts }]}>
                    Pts
                  </Text>
                </View>
                <ScrollView style={{ maxHeight: TABLE_MAX_H }}>
                  {rowsA.map((r) => (
                    <TouchableOpacity
                      key={`ar-${r.id ? r.id : Math.random()}`}
                      style={styles.trTouchable}
                      onPress={() => onRowPress(r)}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[styles.td, styles.cellPlayer, SM && styles.tdSM, { flex: COL_FLEX.player }]}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                      >
                        {r.name}
                      </Text>
                      <Text
                        style={[styles.td, styles.cellRight, SM && styles.tdSM, { flex: COL_FLEX.eo }]}
                        numberOfLines={1}
                      >
                        {r.eo.toFixed(1)}%
                      </Text>
                      <Text
                        style={[styles.td, styles.cellRight, SM && styles.tdSM, { flex: COL_FLEX.pts }]}
                        numberOfLines={1}
                      >
                        {r.pts}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <View style={styles.breakdownFooter}>
                  <MaterialCommunityIcons name="gesture-tap" size={14} color={colors.muted} />
                  <Text style={styles.mutedSmall}> Tap a player in the table to view their breakdown.</Text>
                </View>
              </View>
            </View>

            {/* SUB-MODAL PANEL for selected player */}
            {playerDetail && (
              <View style={styles.subModalCard} pointerEvents="auto">
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>
                    {playerDetail.name} {playerDetail.type ? `• ${TYPE_LABEL[playerDetail.type]}` : ''}
                  </Text>
                  <TouchableOpacity onPress={() => setPlayerDetail(null)} style={styles.closeBtn}>
                    <MaterialCommunityIcons name="close" size={20} color={colors.ink} />
                  </TouchableOpacity>
                </View>

                <View style={styles.breakdownHeader}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <MaterialCommunityIcons name="chart-box-outline" size={18} color={colors.accent} />
                    <Text style={styles.breakdownTitle}>Points Breakdown</Text>
                  </View>
                  <Text style={styles.breakdownPts}>
                    Total: <Text style={styles.bold}>{playerDetail.pts}</Text>
                  </Text>
                </View>

                <ScrollView style={{ maxHeight: 420 }}>
                  {(() => {
                    const entries = Object.entries(playerDetail.explainedMap || {});
                    const items = entries
                      .filter(([_, v]) => (v?.pts ?? 0) !== 0)
                      .map(([k, v]) => ({
                        key: k,
                        label: LABELS[k] || k,
                        times: v.times || 0,
                        pts: v.pts || 0,
                      }))
                      .sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts) || a.label.localeCompare(b.label));
                    if (items.length === 0) {
                      return <Text style={styles.mutedSmall}>No scoring events recorded.</Text>;
                    }
                    return items.map((it, idx) => {
                      const mult = it.times > 1 ? ` ×${it.times}` : '';
                      const sign = it.pts > 0 ? '+' : '';
                      return (
                        <View key={`${it.key}-${idx}`} style={styles.breakdownRow}>
                          <Text style={styles.breakdownLabel}>{it.label}{mult}</Text>
                          <Text style={styles.breakdownValue}>{sign}{it.pts}</Text>
                        </View>
                      );
                    });
                  })()}
                </ScrollView>

                <View style={styles.breakdownFooter}>
                  <MaterialCommunityIcons name="gesture-tap" size={14} color={colors.muted} />
                  <Text style={styles.mutedSmall}> Tap another player in the table to view their breakdown.</Text>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function rowsFromList(label, list, side, borderColor, styles, colors) {
  return list.map((x, i) => (
    <Chip
      key={`${label}-${side}-${i}`}
      color={colors.chip}
      borderColor={borderColor || colors.chipBorder}
      styles={styles}
    >
      <Text style={styles.tagText}>{label} {x.name}{x.count > 1 ? ` ×${x.count}` : ''}</Text>
    </Chip>
  ));
}

/* --------------------------- Screen --------------------------- */
function Games() {
  
  const [gwTitle, setGwTitle] = useState(null);
const [sortBy, setSortBy] = useState('chrono'); // default: chronological
const [viewTab, setViewTab] = useState('summary'); // 'summary' | 'feed'
const [onePt, setOnePt] = useState(null);

useEffect(() => {
  (async () => {
    try {
      // Rank stores the last payload in AsyncStorage under 'fplData' (legacy) and/or fplData:<id>.
      // Start with the simplest: legacy 'fplData'.
      const raw = await AsyncStorage.getItem('fplData');
      if (raw) {
        const parsed = JSON.parse(raw);
        const payload = parsed?.data ?? parsed; // depending on your wrapper shape
        const v = payload?.one_pt ?? payload?.onePt ?? payload?.one_pt_est ?? null;
        if (v != null) { setOnePt(Number(v)); return; }
      }

      // Fallback: if you prefer per-id caches, you can also try:
      // const myId = await AsyncStorage.getItem('fplId');
      // if (myId) {
      //   const scoped = await AsyncStorage.getItem(`fplData:${myId}`);
      //   if (scoped) {
      //     const p2 = JSON.parse(scoped);
      //     const payload2 = p2?.data ?? p2;
      //     const v2 = payload2?.one_pt ?? payload2?.onePt ?? payload2?.one_pt_est ?? null;
      //     if (v2 != null) { setOnePt(Number(v2)); return; }
      //   }
      // }
    } catch {}
  })();
}, []);

// Load saved sort choice on first mount
useEffect(() => {
  (async () => {
    try {
      const v = await AsyncStorage.getItem(SORT_KEY);
      if (v && SORT_OPTIONS.some(o => o.value === v)) setSortBy(v);
    } catch {}
  })();
}, []);

// Setter that also persists to storage
const setSort = useCallback(async (v) => {
  setSortBy(v);
  try { await AsyncStorage.setItem(SORT_KEY, v); } catch {}
}, []);

  const [openIndex, setOpenIndex] = useState(null);

 const toggleAt = useCallback(
   (i) => setOpenIndex((prev) => (prev === i ? null : i)),
   []
 );
  const [expanded, setExpanded] = useState(new Set());
  const toggleExpanded = useCallback((i) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }, []);

  const colors = useColors();
  const { mode, setMode } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
const onToggleMode = () => {
    if (mode === 'dark') setMode('light');
    else setMode('dark');
  };
  const iconName = mode === 'dark' ? 'moon-waning-crescent' : 'white-balance-sunny';
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState('');
  const [sample, setSample] = useState('local');
  const [eoMap, setEoMap] = useState(null);
  const [myExposure, setMyExposure] = useState(null);
  const [eoSrc, setEoSrc] = useState('none');
  const [eoErr, setEoErr] = useState('');
  const [showSampleHelp, setShowSampleHelp] = useState(false);
  const cacheRef = useRef(new Map());

  const fetchGames = useCallback(async (force = false) => {
    setErr('');
    try {
      const key = 'base';
      const cached = cacheRef.current.get(key);
      if (!force && cached && Date.now() - cached.t < CACHE_TTL_MS) {
        const payload = cached.data;
        const finalData = DEV_SIMULATE.enabled
        ? simulateTail(payload, DEV_SIMULATE.minute)
        : payload;
        setData(finalData);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const url = API_URL;
      const res = await smartFetch(url, { headers: { 'cache-control': 'no-cache' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json)) throw new Error('Bad payload');
      // apply sim to UI only; keep cache raw
    const finalData = DEV_SIMULATE.enabled
      ? simulateTail(json, DEV_SIMULATE.minute)
      : json;
      setData(finalData);
      cacheRef.current.set(key, { t: Date.now(), data: json });
    } catch (e) {
      setErr('Failed to load games.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
useEffect(() => {
  (async () => {
    // try explicit key first
    let gw = Number(await AsyncStorage.getItem('gw.current'));
    if (!Number.isFinite(gw) || gw <= 0) {
      // fallback: read gw from cached fplData blob
      const cached = await AsyncStorage.getItem('fplData');
      if (cached) {
        try { gw = Number(JSON.parse(cached)?.data?.gw); } catch {}
      }
    }
    if (!Number.isFinite(gw) || gw <= 0) gw = null;
    setGwTitle(gw);
  })();
}, []);

  useEffect(() => { fetchGames(); }, [fetchGames]);

  useEffect(() => {
    (async () => {
      try {
        const myId = await AsyncStorage.getItem('fplId');
        const raw =
          (myId && (await AsyncStorage.getItem(`myExposure:${myId}`))) ||
          (await AsyncStorage.getItem('myExposure'));
        setMyExposure(raw ? JSON.parse(raw) : null);
      } catch {
        setMyExposure(null);
      }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setEoErr('');
    if (sample === 'elite' || sample === 'local') {
      loadEOOverlay(sample)
        .then(({ map, src }) => { if (!cancelled) { setEoMap(map); setEoSrc(src); } })
        .catch((e) => { if (!cancelled) { setEoMap(null); setEoSrc('error'); setEoErr(String(e?.message || e)); } });
    } else {
      setEoMap(null);
      setEoSrc('none');
    }
    return () => { cancelled = true; };
  }, [sample]);

 // Refresh games + exposure + EO overlay whenever this screen regains focus
useFocusEffect(
  useCallback(() => {
    let mounted = true;

    const refreshOnFocus = async () => {
      // 1) Try to refresh the games list
      try {
        if (mounted) setRefreshing(true);
        await fetchGames(true); // force fresh pull on focus
      } finally {
        if (mounted) setRefreshing(false);
      }

      // 2) Rehydrate your exposure from storage
      try {
        const myId = await AsyncStorage.getItem('fplId');
        const raw =
          (myId && (await AsyncStorage.getItem(`myExposure:${myId}`))) ||
          (await AsyncStorage.getItem('myExposure'));
        if (mounted) setMyExposure(raw ? JSON.parse(raw) : null);
      } catch {
        if (mounted) setMyExposure(null);
      }

      // 3) Refresh EO overlay based on selected sample
      if (sample === 'elite' || sample === 'local') {
        try {
          const { map, src } = await loadEOOverlay(sample);
          if (mounted) { setEoMap(map); setEoSrc(src); }
        } catch (e) {
          if (mounted) { setEoMap(null); setEoSrc('error'); setEoErr(String(e?.message || e)); }
        }
      } else if (mounted) {
        setEoMap(null);
        setEoSrc('none');
      }
    };

    refreshOnFocus();
    return () => { mounted = false; };
  }, [fetchGames, sample])
);
useFocusEffect(
  useCallback(() => {
    setViewTab('summary');   // or whatever your default is called
    return undefined;
  }, [])
);

const sortedData = useMemo(() => {
  const copy = (data || []).slice();
  return copy.sort((a, b) => {
    const A = gameSortMetrics(a, eoMap, myExposure);
    const B = gameSortMetrics(b, eoMap, myExposure);

    if (sortBy === 'live') {
      // live first, then chronological
      if (A.isLive !== B.isLive) return A.isLive ? -1 : 1;
      const at = A.kickoff?.getTime?.() ?? Infinity;
      const bt = B.kickoff?.getTime?.() ?? Infinity;
      return at - bt;
    }

    if (sortBy === 'net') {
      // biggest absolute gain/loss first
      if (B.absNet !== A.absNet) return B.absNet - A.absNet;
      // tie-break chrono
      const at = A.kickoff?.getTime?.() ?? Infinity;
      const bt = B.kickoff?.getTime?.() ?? Infinity;
      return at - bt;
    }

    if (sortBy === 'eo') {
      // highest total EO (home+away) first
      if (B.teamEOsum !== A.teamEOsum) return B.teamEOsum - A.teamEOsum;
      const at = A.kickoff?.getTime?.() ?? Infinity;
      const bt = B.kickoff?.getTime?.() ?? Infinity;
      return at - bt;
    }

    // default: chronological
    const at = A.kickoff?.getTime?.() ?? Infinity;
    const bt = B.kickoff?.getTime?.() ?? Infinity;
    return at - bt;
  });
}, [data, eoMap, myExposure, sortBy]);

const chronoSections = useMemo(() => {
  if (sortBy !== 'chrono') return [];

  // Group by YYYY-MM-DD based on kickoff date (fallback bucket if missing)
  const bucket = new Map();
  for (const g of sortedData) {
    const ko = getKickoffDate(g);
    const dayKey = ko && !isNaN(ko) ? [
      ko.getFullYear(),
      String(ko.getMonth() + 1).padStart(2, '0'),
      String(ko.getDate()).padStart(2, '0')
    ].join('-') : 'unknown';

    if (!bucket.has(dayKey)) bucket.set(dayKey, { title: ko ? formatDay(ko) : '—', data: [] });
    bucket.get(dayKey).data.push(g);
  }

  // Keep natural chronological order of the map based on sortedData pass
  return Array.from(bucket.values());
}, [sortedData, sortBy]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setExpanded(new Set());
    fetchGames(true);
  }, [fetchGames]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.muted}>Loading games…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}  edges={['left', 'right']}>
      <AppHeader />
      {/* Full-width selector: Games Summary / Live Feed */}
<View style={styles.viewToggleWrap}>
  <TouchableOpacity
    activeOpacity={0.9}
    onPress={() => setViewTab('summary')}
    style={[
      styles.viewToggleBtn,
      viewTab === 'summary' && styles.viewToggleBtnActive,
    ]}
  >
    <Text
      style={[
        styles.viewToggleText,
        viewTab === 'summary' && styles.viewToggleTextActive,
      ]}
    >
      Games Info
    </Text>
  </TouchableOpacity>

  <TouchableOpacity
    activeOpacity={0.9}
    onPress={() => setViewTab('feed')}
    style={[
      styles.viewToggleBtn,
      viewTab === 'feed' && styles.viewToggleBtnActive,
    ]}
  >
    <Text
      style={[
        styles.viewToggleText,
        viewTab === 'feed' && styles.viewToggleTextActive,
      ]}
    >
      Live Feed
    </Text>
  </TouchableOpacity>
</View>

      {err ? <Text style={[styles.muted, { textAlign: 'center', marginTop: 8 }]}>{err}</Text> : null}
      {eoErr ? <Text style={[styles.muted, { textAlign: 'center', marginTop: 4 }]}>EO overlay: {eoErr}</Text> : null}

    

{viewTab === 'summary' ? (
  <>
    {/* EO Sample Selector with Help (ONLY on summary tab) */}
    <View style={styles.toolbar}>
      <View style={[styles.segmentRow, { alignItems: 'center', flexWrap: 'wrap' }]}>
        <Text style={styles.toolbarLabel}>Gain/Loss vs:</Text>
        {SAMPLE_OPTIONS.map((opt) => {
          const active = sample === opt.value;
          return (
            <TouchableOpacity
              key={opt.value}
              onPress={() => setSample(opt.value)}
              activeOpacity={0.8}
              style={[styles.segment, active && styles.segmentActive]}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity style={styles.helpBtn} onPress={() => setShowSampleHelp(true)} activeOpacity={0.8}>
          <MaterialCommunityIcons name="help-circle-outline" size={14} color={colors.accent} />
          <Text style={styles.helpBtnText}>What’s this?</Text>
        </TouchableOpacity>
      </View>
    </View>

    {/* GW header + sort dropdown */}
    <View style={styles.gwHeaderRow}>
      <Text style={styles.gwHeaderText}>
        {gwTitle ? `Gameweek ${gwTitle}` : 'Gameweek'}
      </Text>

      <SortDropdown
        value={sortBy}
        onChange={setSort}
        options={SORT_OPTIONS}
        styles={styles}
        colors={colors}
      />
    </View>

    {/* Existing lists */}
    {sortBy === 'chrono' ? (
      <SectionList
        sections={chronoSections}
        keyExtractor={(_, i) => String(i)}
        extraData={openIndex}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 16 }}
        ListHeaderComponent={<View style={{ height: 10 }} />}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.dayHeader}>
            <Text style={styles.dayHeaderText}>{section.title}</Text>
          </View>
        )}
        renderItem={({ item }) => {
          const index = sortedData.indexOf(item);
          return openIndex === index ? (
            <GameCard
              game={item}
              eoMap={eoMap}
              myExposure={myExposure}
              styles={styles}
              colors={colors}
              onCollapse={() => toggleAt(index)}
            />
          ) : (
            <CompactGameRow
              game={item}
              eoMap={eoMap}
              myExposure={myExposure}
              styles={styles}
              colors={colors}
              onPress={() => toggleAt(index)}
            />
          );
        }}
        SectionSeparatorComponent={() => <View style={{ height: 8 }} />}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      />
    ) : (
      <FlatList
        data={sortedData}
        keyExtractor={(_, i) => String(i)}
        extraData={openIndex}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 16 }}
        ListHeaderComponent={<View style={{ height: 10 }} />}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
        renderItem={({ item, index }) =>
          openIndex === index ? (
            <GameCard
              game={item}
              eoMap={eoMap}
              myExposure={myExposure}
              styles={styles}
              colors={colors}
              onCollapse={() => toggleAt(index)}
            />
          ) : (
            <CompactGameRow
              game={item}
              eoMap={eoMap}
              myExposure={myExposure}
              styles={styles}
              colors={colors}
              onPress={() => toggleAt(index)}
            />
          )
        }
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      />
    )}
  </>
) : (
  // ✅ Live Feed tab (ALWAYS near-you, not affected by sample selector)
  <View style={{ paddingHorizontal: 12, paddingTop: 6 }}>
    <EventFeed
      gw={gwTitle}
      height={Math.max(520, SCREEN_H - 220)}
      onePt={onePt}
    />
  </View>
)}





      {/* Sample explanation modal */}
      <SampleInfoHelp visible={showSampleHelp} onClose={() => setShowSampleHelp(false)} styles={styles} colors={colors} />
    </SafeAreaView>
  );
}

/* --------------------------- Styles (theme-aware) --------------------------- */
function makeStyles(colors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    muted: { color: colors.muted },
    mutedSmall: { color: colors.muted, fontSize: 12 },
    compactRow: {
  backgroundColor: colors.card,
  borderColor: colors.border,
  borderWidth: 1,
  borderRadius: 12,
  paddingVertical: 10,
  paddingHorizontal: 12,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
},
iconBtn: {
    height: 32,
    width: 32,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  ddButton: {
  minWidth: 170,
  maxWidth: 240,
  height: 36,
  paddingHorizontal: 10,
  borderWidth: 1,
  borderColor: colors.border2,
  backgroundColor: colors.chip,
  borderRadius: 10,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
},
ddButtonText: {
  color: colors.ink,
  fontWeight: '800',
  fontSize: 12,
  flex: 1,
  marginRight: 6,
},
ddBackdrop: {
  position: 'absolute',
  left: 0, right: 0, top: 0, bottom: 0,
  backgroundColor: 'rgba(0,0,0,0.15)',
},
ddFloatingWrap: {
  // Position the menu near the header (top-right). Adjust top value to taste.
  position: 'absolute',
  right: 12,
  top: 64,
},
ddMenu: {
  backgroundColor: colors.card,
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: 12,
  minWidth: 220,
  paddingVertical: 4,
  shadowColor: '#000',
  shadowOpacity: 0.2,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 6 },
  elevation: 10,
},
ddItem: {
  paddingHorizontal: 12,
  paddingVertical: 10,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
},
ddItemActive: {
  backgroundColor: colors.stripBg,
},
ddItemText: {
  color: colors.ink,
  fontSize: 13,
  fontWeight: '600',
},
ddItemTextActive: {
  color: colors.accent,
  fontWeight: '800',
},

compEO: {
  marginTop: 1,
  fontSize: 11,
  color: colors.muted,
},
compChevronWrap: {
  marginLeft: 6,
  alignSelf: 'center',
},
 compTeam: {
   flexShrink: 1,
   flexBasis: '35%',
   flexDirection: 'row',
   alignItems: 'center',
   gap: 6,
 },
compTeamTextWrap: {
  flexShrink: 1,
  minWidth: 0,
},
compNet: {
  marginTop: 2,
  fontSize: 11,
  // color is set inline to ok/red/muted based on value
},
 compTeamText: {
   color: colors.ink,
   fontSize: 13,
   fontWeight: '800',
   maxWidth: 120,
 },
compTeamEO: {
  marginTop: 1,
  fontSize: 11,
  color: colors.muted,
},

compCrest: {
  width: 22 * rem,
  height: 22 * rem,
  resizeMode: 'contain',
},

compCenter: {
  alignItems: 'center',
  justifyContent: 'center',
  paddingHorizontal: 8,
  flexBasis: '30%',
},
compScore: {
  color: colors.ink,
  fontSize: 18,
  fontWeight: '900',
  letterSpacing: 0.3,
},
compStatus: {
  marginBottom: 2,
  fontSize: 12,
},


    card: {
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 16,
      padding: 12,
      shadowColor: '#000',
      shadowOpacity: 0.2,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      elevation: 6,
      position: 'relative',
    },
    cardChevronBtn: {
   position: 'absolute',
   top: 6,
   right: 6,
   padding: 2,
   borderRadius: 999,
   backgroundColor: colors.stripBg,
   borderWidth: 1,
   borderColor: colors.border2,
 },

 fixtureRow: {
  backgroundColor: colors.card,
  borderColor: colors.border,
  borderWidth: 1,
  borderRadius: 12,
  paddingVertical: 8,
  paddingHorizontal: 10,
  flexDirection: 'row',
  alignItems: 'stretch',
},

/* left status rail */
fxLeft: {
  width: 52,
  alignItems: 'center',
  justifyContent: 'center',
  paddingVertical: 2,
  marginRight: 8,
  borderRightWidth: 1,
  borderRightColor: colors.border2,
},
fxPhase: { fontSize: 11, fontWeight: '800' },
fxLiveDot: {
  width: 6, height: 6, borderRadius: 999, marginTop: 4,
  backgroundColor: colors.yellow,
},

/* middle stacked teams (Flashscore-like) */
fxMiddle: { flex: 1, gap: 6, justifyContent: 'center' },
fxTeamLine: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 8,
},
fxCrest: { width: 20 * rem, height: 20 * rem, resizeMode: 'contain' },
fxTeamName: { color: colors.ink, fontSize: 14, fontWeight: '800', flex: 1, minWidth: 0 },
fxScore: { color: colors.ink, fontSize: 16, fontWeight: '900', minWidth: 18, textAlign: 'right' },

/* right info column (EO + gain + chevron) */
fxRight: { alignItems: 'flex-end', justifyContent: 'center', marginLeft: 8 },
fxPill: {
  paddingHorizontal: 6,
  paddingVertical: 2,
  borderRadius: 999,
  backgroundColor: colors.stripBg,
  borderWidth: 1,
  borderColor: colors.border2,
  marginBottom: 4,
  minWidth: 64,
  alignItems: 'center',
},
fxPillText: { color: colors.muted, fontSize: 11, fontWeight: '700' },

// in makeStyles(colors)
fxTeamNameWrap: { flex: 1, minWidth: 0 },
fxEOText: { color: colors.muted, fontSize: 10, marginTop: 1 },

// make scores align across rows regardless of right chip width
fxScore: {
  color: colors.ink,
  fontSize: 16,
  fontWeight: '900',
  width: 28,              // <- fixed width for alignment
  textAlign: 'right',
},

// right column: fixed width so gain chip never pushes middle
fxRight: {
  width: 84,              // <- fixed; tune as you like
  alignItems: 'flex-end',
  justifyContent: 'center',
  marginLeft: 8,
},

// gain chip: keep consistent width
fxGain: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 6,
  paddingHorizontal: 8,
  paddingVertical: 3,
  borderRadius: 999,
  borderWidth: 1,
  marginBottom: 4,
  minWidth: 64,           // <- chip doesn't shrink smaller
  justifyContent: 'center'
},

// optional: subtle row tints by phase
fixtureRowLive:  { borderColor: colors.yellow },
fixtureRowDone:  { borderColor: colors.border },
fixtureRowIdle:  { borderColor: colors.border2 },




fxGainText: { color: colors.ink, fontWeight: '800', fontSize: 12 },
fxGainPos: { backgroundColor: colors.stripBg, borderColor: colors.ok },
fxGainNeg: { backgroundColor: colors.stripBg, borderColor: colors.red },
fxGainZero: { backgroundColor: colors.stripBg, borderColor: colors.border2 },


    headerRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      marginBottom: 6,
      gap: 10,
    },
    teamBlock: { flex: 1 },
    crestBig: { width: 40 * rem, height: 40 * rem, resizeMode: 'contain', alignSelf: 'center' },
    teamName: { color: colors.ink, fontWeight: '800', fontSize: 14, marginTop: 4, textAlign: 'center' },
    teamMeta: { color: colors.muted, fontSize: 12, marginTop: 2, textAlign: 'center' },

    chipsRow: { gap: 8, paddingHorizontal: 2 },
    chip: {
      backgroundColor: colors.chip,         // themed
      borderColor: colors.chipBorder,       // themed
      borderWidth: 1,
      borderRadius: 12,
      paddingVertical: 6,
      paddingHorizontal: 10,
      marginRight: 8,
      minWidth: 112,
    },
    collapseLeft: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 6,
  flex: 1,           // take remaining space
  minWidth: 0,       // allow text truncation
},
collapseRight: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0,     // never shrink (keeps chevron visible)
},
rightClamp: {
  maxWidth: 160,     // adjust if you like; keeps pill from growing too wide
  flexShrink: 1,
},
netChip: {
  marginTop: 3,
  paddingHorizontal: 6,
  paddingVertical: 2,
  borderRadius: 999,
  flexDirection: 'row',
  alignItems: 'center',
  gap: 6,
  maxWidth: 160,     // matches rightClamp above
},

    chipName: { color: colors.ink, fontWeight: '800', fontSize: 12 },
    chipMeta: { color: colors.muted, fontSize: 11, marginTop: 2 },

    scoreBlock: { minWidth: 150, alignItems: 'center' },
    scoreText: { color: colors.ink, fontSize: 22, fontWeight: '900' },
    statusWrap: { alignItems: 'center', gap: 6, marginTop: 2, justifyContent: 'center', width: '100%' },
    statusText: { fontWeight: '800', textAlign: 'center' },
    // inside makeStyles
metaRow: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 6,
  marginTop: 2,
},
metaPill: {
  paddingHorizontal: 6,
  paddingVertical: 2,
  borderRadius: 999,
  backgroundColor: colors.stripBg,
  borderWidth: 1,
  borderColor: colors.border2,
},
metaPillText: {
  color: colors.muted,
  fontSize: 11,
  fontWeight: '700',
  letterSpacing: 0.2,
},

statusPill: {
  paddingHorizontal: 8,
  paddingVertical: 2,
  borderRadius: 999,
  borderWidth: 1,
  marginBottom: 3,
},
statusLive: { backgroundColor: 'rgba(255, 213, 79, 0.12)', borderColor: colors.yellow },
statusDone: { backgroundColor: 'rgba(76, 175, 80, 0.14)', borderColor: colors.ok },
statusIdle: { backgroundColor: colors.stripBg, borderColor: colors.border2 },
statusPillText: { color: colors.ink, fontSize: 11, fontWeight: '800' },
   dayHeader: {
      paddingVertical: 6,
      paddingHorizontal: 8,
      backgroundColor: colors.stripBg,
      borderColor: colors.border2,
      borderWidth: 1,
      borderRadius: 10,
      marginTop: 8,
      marginBottom: 6,
    },
    dayHeaderText: {
      color: colors.ink,
      fontWeight: '900',
      fontSize: 13,
      letterSpacing: 0.2,
      textAlign:'center'
    },

netChip: {
  marginTop: 3,
  paddingHorizontal: 6,
  paddingVertical: 2,
  borderRadius: 999,
  flexDirection: 'row',
  alignItems: 'center',
  gap: 6,
},
netChipPos: { backgroundColor: colors.stripBg, },
netChipNeg: { backgroundColor: colors.stripBg, },
netChipZero: { backgroundColor: colors.stripBg, },
netChipText: { color: colors.ink, fontWeight: '800', fontSize: 10 },


    playersBtn: {
      marginTop: 8,
      flexDirection: 'row',
      gap: 6,
      alignItems: 'center',
      backgroundColor: colors.accent,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 10,
    },
    playersBtnText: { color: 'white', fontWeight: '800', fontSize: 12 },

    sectionTitle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 8,
      marginBottom: 4,
    },
    sectionTitleText: { color: colors.ink, fontWeight: '800', fontSize: 12, letterSpacing: 0.4 },
    hintText: { color: colors.muted, fontSize: 11, marginLeft: 6 },

    collapseHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 6,
      borderTopWidth: 1,
      borderTopColor: colors.border2,
    },

    twoCol: {
      flexDirection: 'row',
      gap: 10,
      marginBottom: 4,
    },
    col: { flex: 1 },
    rowText: { color: colors.ink, fontSize: 13 },

    chipText: { color: colors.ink, fontSize: 12 },
    bold: { fontWeight: '800', color: colors.ink },
    tagText: { color: colors.ink, fontSize: 12 },

    tagsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginBottom: 4,
    },

    bonusRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 8,
      marginBottom: 2,
    },
    bonusSide: { flex: 1 },
    bonusItem: { flexDirection: 'row', alignItems: 'center' },

    barsBox: {
      backgroundColor: colors.stripBg,      // themed panel
      borderColor: colors.border2,
      borderWidth: 1,
      borderRadius: 12,
      padding: 8,
      marginTop: 4,
    },
    barRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginVertical: 3,
    },
    barName: { color: colors.ink, fontSize: 12 },
    barMeter: {
      flex: 1,
      height: 8,
      backgroundColor: colors.chipBorder2,  // subtle track
      borderRadius: 999,
      overflow: 'hidden',
    },
    barFill: { height: 8, borderRadius: 999 },
    barValue: { color: colors.muted, fontSize: 12, textAlign: 'right' },

    toggleBtn: { alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 10 },
    toggleText: { color: colors.muted, fontSize: 12 },
    tableWrap: {
  backgroundColor: colors.stripBg,
  borderColor: colors.border2,
  borderWidth: 1,
  borderRadius: 12,
  overflow: 'hidden',
  marginTop: 4,
},
tableHead: {
  flexDirection: 'row',
  alignItems: 'center',
  paddingVertical: 6,
  paddingHorizontal: 8,
  borderBottomWidth: 1,
  borderBottomColor: colors.border2,
  backgroundColor: colors.chip, // subtle header bg
},
tableBody: {},
tr: {
  flexDirection: 'row',
  alignItems: 'center',
  paddingVertical: 6,
  paddingHorizontal: 8,
  borderTopWidth: 1,
  borderTopColor: colors.border2,
},
trAlt: { backgroundColor: colors.chipBorder2 },
td: { color: colors.ink, fontSize: 12, minWidth: 0 },
cellRight: { textAlign: 'right' },
colPlayer: { flex: XS ? 3.0 : SM ? 2.6 : 2.4, minWidth: 0, paddingRight: 8 },
 colNum:    { flex: XS ? 0.7 : 0.85, minWidth: XS ? 44 : 56 },
 colRisk:   { width: XS ? 24 : 36, textAlign: 'center' },



    /* Toolbar (EO sample selector) */
    toolbar: {
      paddingHorizontal: 12,
      paddingBottom: 4,
    },
    toolbarLabel: {
      color: colors.muted,
      fontWeight: '800',
      fontSize: 12,
      marginRight: 8,
      alignSelf: 'center',
    },
    segmentRow: {
      flexDirection: 'row',
      gap: 8,
    },
    gwHeaderRow: {
  paddingHorizontal: 12,
  paddingTop: 6,
  paddingBottom: 2,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
},
gwHeaderText: {
  color: colors.ink,
  fontWeight: '900',
  fontSize: 16,
  letterSpacing: 0.2,
},
gwHeaderRow: {
  paddingHorizontal: 12,
  paddingTop: 6,
  paddingBottom: 2,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
},
gwHeaderText: {
  color: colors.ink,
  fontWeight: '900',
  fontSize: 16,
  letterSpacing: 0.2,
},
sortPickerWrap: {
  minWidth: 170,
  maxWidth: 240,
  borderWidth: 1,
  borderColor: colors.border2,
  backgroundColor: colors.chip,
  borderRadius: 10,
  overflow: 'hidden',
},
sortPicker: {
  height: 36,
  paddingHorizontal: 8,
  color: colors.ink,
},


    segment: {
      borderWidth: 1,
      borderColor: colors.border2,
      backgroundColor: colors.chip,          // themed
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 999,
    },
    segmentActive: {
      backgroundColor: colors.accent,
      borderColor: colors.accentDark,
    },
    segmentText: {
      color: colors.muted,
      fontWeight: '800',
      fontSize: 12,
      letterSpacing: 0.2,
    },
    segmentTextActive: {
      color: 'white',
    },
    eventsStrip: {
  backgroundColor: colors.stripBg,
  borderColor: colors.border2,
  borderWidth: 1,
  borderRadius: 12,
  padding: 8,
  marginTop: 6,
  marginBottom: 4,
},


    /* Help chip/button */
    helpBtn: {
      display:'none',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 999,
      backgroundColor: colors.stripBg,
      borderWidth: 1,
      borderColor: colors.border2,
      marginLeft: 6,
    },
    viewToggleWrap: {
  flexDirection: 'row',
  marginHorizontal: 12,
  marginTop: 10,
  marginBottom: 10,
  borderRadius: 14,
  borderWidth: 1,
  borderColor: colors.border,
  backgroundColor: colors.card2,
  overflow: 'hidden',
},
viewToggleBtn: {
  flex: 1,
  paddingVertical: 10,
  alignItems: 'center',
  justifyContent: 'center',
},
viewToggleBtnActive: {
  backgroundColor: colors.accent,
},
viewToggleText: {
  color: colors.muted,
  fontWeight: '900',
  fontSize: 12,
},
viewToggleTextActive: {
  color: 'white',
},

    helpBtnText: { color: colors.accent, fontWeight: '800', fontSize: 12 },

    /* Help modal */
    helpBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 12,
    },
    helpCard: {
      width: '100%',
      maxWidth: 520,
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 16,
      padding: 14,
    },
    helpHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    helpTitle: { color: colors.ink, fontWeight: '900', fontSize: 16 },
    helpLine: { color: colors.ink, fontSize: 13, lineHeight: 18 },
    helpOkay: {
      alignSelf: 'flex-end',
      marginTop: 10,
      backgroundColor: colors.accent,
      borderRadius: 10,
      paddingVertical: 6,
      paddingHorizontal: 12,
    },
    helpOkayText: { color: 'white', fontWeight: '800' },

    /* Modal base */
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 8,
    },
    modalCard: {
      maxHeight: Math.min(SCREEN_H * 0.92, 860),
      width: '100%',
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 16,
      padding: 12,
    },
    modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    modalTitle: { color: colors.ink, fontWeight: '900', fontSize: 16 },
    closeBtn: { padding: 6 },

    /* Fit two tables side-by-side without wasted space */
    modalRowFit: {
      flexDirection: 'row',
      gap: 12,
    },
    teamTable: {
      flex: 1,
      minWidth: 0,
      borderWidth: 1,
      borderColor: colors.border2,
      borderRadius: 12,
      padding: 8,
      backgroundColor: colors.stripBg,
    },
    gwHeaderWrap: {
  paddingHorizontal: 12,
  paddingTop: 6,
  paddingBottom: 2,
},
gwHeaderText: {
  color: colors.ink,
  fontWeight: '900',
  fontSize: 16,
  letterSpacing: 0.2,
  textAlign:'center'
},

    tableHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
    crestSmall: { width: 22, height: 22, resizeMode: 'contain' },
    tableTeamName: { color: colors.ink, fontWeight: '800' },

    tableCols: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
    th: { color: colors.muted, fontWeight: '800', fontSize: 12 },
    thSM: { fontSize: 11 },
    trTouchable: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 6,
      borderTopWidth: 1,
      borderTopColor: colors.border2,
    },
    
    td: { color: colors.ink, fontSize: 12, minWidth: 0, flexShrink: 1 },
    tdSM: { fontSize: 11 },

    cellPlayer: { minWidth: 0 },
    cellRight: { textAlign: 'right' },

    teamTableXS: { padding: 6 },

    /* Player breakdown sub-panel */
    subModalCard: {
      position: 'absolute',
      left: 12,
      right: 12,
      top: 12,
      bottom: 12,
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 16,
      padding: 12,
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 12,
    },

    /* Player breakdown rows */
    breakdownHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    topBar: {
      height: 44,
      paddingHorizontal: 12,
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'center',
      backgroundColor: '#0b0c10',
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      zIndex: 10,
      elevation: 10,
      marginBottom: 6,
    },
    topLogo: {
      height: 28,
      width: 160,
    },
    topTitle: {
      color: colors.ink,
      fontWeight: '900',
      fontSize: 16,
    },
    subHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
    subHeaderText: { color: colors.muted, fontWeight: '800', fontSize: 12 },
    breakdownTitle: { color: colors.ink, fontWeight: '800', fontSize: 14 },
    breakdownPts: { color: colors.muted, fontSize: 12 },
    breakdownRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 6,
      borderTopWidth: 1,
      borderTopColor: colors.border2,
    },
    teamBlockCenter: { alignItems: 'center' },
    breakdownLabel: { color: colors.ink, fontSize: 13, flex: 1 },
    breakdownValue: { color: colors.ink, fontSize: 13, fontWeight: '800' },
    breakdownFooter: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  });
}

export default Games;
