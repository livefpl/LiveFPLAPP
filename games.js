// Games.js (theme-integrated)
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppHeader from './AppHeader';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Image,
  Dimensions,
  SafeAreaView,
  Modal,
  ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { clubCrestUri, assetImages } from './clubs';
import { smartFetch } from './signedFetch';
import { useColors } from './theme';

/* ---------------------- Sizing ---------------------- */
const rem = Dimensions.get('window').width / 380;
const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;
const LIVEFPL_LOGO = assetImages?.livefplLogo ?? assetImages?.logo;
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
const API_URL = 'https://livefpl-api-489391001748.europe-west4.run.app/LH_api/games';

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

async function loadEOOverlay(sample) {
  if (sample === 'elite') {
    const key = 'EO:elite';
    const cached = await getEOFromStorage(key);
    if (cached) return { map: parseEOJson(cached), src: 'cache:elite' };
    const res = await fetch('https://livefpl.us/elite.json', { headers: { 'cache-control': 'no-cache' } });
    if (!res.ok) throw new Error(`EO HTTP ${res.status}`);
    const json = await res.json();
    await setEOToStorage(key, json);
    return { map: parseEOJson(json), src: 'net:elite' };
  }
  if (sample === 'local') {
    const myId = await AsyncStorage.getItem('fplId');
    const raw =
      (myId && (await AsyncStorage.getItem(`localGroup:${myId}`))) ||
      (await AsyncStorage.getItem('localGroup'));
    const localNum = raw ? Number(raw) : null;
    if (!localNum) return { map: null, src: 'missing:local' };
    const key = `EO:local:${localNum}`;
    const cached = await getEOFromStorage(key);
    if (cached) return { map: parseEOJson(cached), src: `cache:local_${localNum}` };
    const res = await fetch(`https://livefpl.us/local_${localNum}.json`, { headers: { 'cache-control': 'no-cache' } });
    if (!res.ok) throw new Error(`EO HTTP ${res.status}`);
    const json = await res.json();
    await setEOToStorage(key, json);
    return { map: parseEOJson(json), src: `net:local_${localNum}` };
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
const VALUE_COL_W = XS ? 50 : 56;             // right value column

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

function CollapsibleSection({ icon, title, open, onToggle, children, hint, rightExtra, styles, colors }) {
  return (
    <View style={{ marginTop: 8 }}>
      <TouchableOpacity onPress={onToggle} style={styles.collapseHeader} activeOpacity={0.8}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <MaterialCommunityIcons name={icon} size={16} color={colors.muted} />
          <Text style={styles.sectionTitleText}>{title}</Text>
          {hint ? <Text style={styles.hintText}>{hint}</Text> : null}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {rightExtra /* <-- shows on the right of the header */}
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

function BarRow({ name, value, max, cap, unit, checkAt, color, styles, colors }) {
  const barColor = color || colors.accent;
  const capped = typeof cap === 'number' ? Math.min(value, cap) : value;
  const widthPct = max > 0 ? Math.round((capped / max) * 100) : 0;
  const hit = typeof checkAt === 'number' ? value >= checkAt : false;
  return (
    <View style={styles.barRow}>
      <Text
        style={[styles.barName, { width: NAME_COL_W }]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {name}
      </Text>
      <View style={styles.barMeter}>
        <View style={[styles.barFill, { width: `${widthPct}%`, backgroundColor: barColor }]} />
      </View>
      <Text style={[styles.barValue, { width: VALUE_COL_W }]}>
        {value}{unit ? unit : ''}{hit ? ' ✓' : ''}
      </Text>
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


/* ------------------------- Game Card -------------------------- */
function GameCard({ game, eoMap, myExposure, styles, colors }) {
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

      {/* --- Collapsible: Rank Movers --- */}
      <CollapsibleSection
  icon="swap-vertical"
  title="Rank Movers"
  open={rankMoversOpen}
  onToggle={() => setRankMoversOpen(o => !o)}
  hint={!rankMoversOpen ? 'Tap to expand' : undefined}
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

        {/* Threats */}
        <View style={styles.subHeaderRow}>
          <MaterialCommunityIcons name="trending-up" size={16} color={colors.muted} />
          <Text style={styles.subHeaderText}>Threats to You</Text>
        </View>
        {Array.isArray(threats) && threats.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
            {threats.map(t => (
              <View key={`th-${t.id}`} style={styles.chip}>
                <Text style={styles.chipName} numberOfLines={1}>
                  {t.name}  (-{t.delta.toFixed(0)}%)
                </Text>
                <Text style={styles.chipMeta}>{t.pts} pts {emojiFor(t.pts, 'threat')}</Text>
              </View>
            ))}
          </ScrollView>
        ) : (
          <Text style={styles.mutedSmall}>No major threats detected.</Text>
        )}

        {/* Opportunities */}
        <View style={[styles.subHeaderRow, { marginTop: 8 }]}>
          <MaterialCommunityIcons name="star-outline" size={16} color={colors.muted} />
          <Text style={styles.subHeaderText}>Your Opportunities</Text>
        </View>
        {Array.isArray(opportunities) && opportunities.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
            {opportunities.map(t => (
              <View key={`op-${t.id}`} style={styles.chip}>
                <Text style={styles.chipName} numberOfLines={1}>
                  {t.name}  ({t.delta.toFixed(0)}%)
                </Text>
                <Text style={styles.chipMeta}>{t.pts} pts {emojiFor(t.pts, 'opportunity')}</Text>
              </View>
            ))}
          </ScrollView>
        ) : (
          <Text style={styles.mutedSmall}>No players for you in this game.</Text>
        )}
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
            bpsShow.map((p) => (
              <BarRow key={`bps-${p.id}`} name={p.name} value={p.bps} max={bpsMax} styles={styles} colors={colors} />
            ))
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
      <BonusRow home={bonusH} away={bonusA} styles={styles} colors={colors} />

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
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

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
        setData(cached.data);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const url = API_URL;
      const res = await smartFetch(url, { headers: { 'cache-control': 'no-cache' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json)) throw new Error('Bad payload');
      setData(json);
      cacheRef.current.set(key, { t: Date.now(), data: json });
    } catch (e) {
      setErr('Failed to load games.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
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

  // Refresh exposure & EO overlay when returning to Games
  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      const refresh = async () => {
        try {
          const myId = await AsyncStorage.getItem('fplId');
          const raw =
            (myId && (await AsyncStorage.getItem(`myExposure:${myId}`))) ||
            (await AsyncStorage.getItem('myExposure'));
          if (mounted) setMyExposure(raw ? JSON.parse(raw) : null);
        } catch {
          if (mounted) setMyExposure(null);
        }
        if (mounted && (sample === 'elite' || sample === 'local')) {
          try {
            const { map, src } = await loadEOOverlay(sample);
            if (mounted) { setEoMap(map); setEoSrc(src); }
          } catch (e) {
            if (mounted) { setEoMap(null); setEoSrc('error'); setEoErr(String(e?.message || e)); }
          }
        }
      };
      refresh();
      return () => { mounted = false; };
    }, [sample])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
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
    <SafeAreaView style={styles.safe}>
      <AppHeader />
      {err ? <Text style={[styles.muted, { textAlign: 'center', marginTop: 8 }]}>{err}</Text> : null}
      {eoErr ? <Text style={[styles.muted, { textAlign: 'center', marginTop: 4 }]}>EO overlay: {eoErr}</Text> : null}

      {/* EO Sample Selector with Help */}
      <View style={styles.toolbar}>
        <View style={[styles.segmentRow, { alignItems: 'center', flexWrap: 'wrap' }]}>
          <Text style={styles.toolbarLabel}>Compare Against:</Text>
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

      <FlatList
        data={data}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 16 }}
        ListHeaderComponent={<View style={{ height: 10 }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
        renderItem={({ item }) => <GameCard game={item} eoMap={eoMap} myExposure={myExposure} styles={styles} colors={colors} />}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      />

      {/* Sample explanation modal */}
      <SampleInfoHelp visible={showSampleHelp} onClose={() => setShowSampleHelp(false)} styles={styles} colors={colors} />
    </SafeAreaView>
  );
}

/* --------------------------- Styles (theme-aware) --------------------------- */
function makeStyles(colors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg, paddingTop: 48 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    muted: { color: colors.muted },
    mutedSmall: { color: colors.muted, fontSize: 12 },

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
    },

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
    chipName: { color: colors.ink, fontWeight: '800', fontSize: 12 },
    chipMeta: { color: colors.muted, fontSize: 11, marginTop: 2 },

    scoreBlock: { minWidth: 150, alignItems: 'center' },
    scoreText: { color: colors.ink, fontSize: 22, fontWeight: '900' },
    statusWrap: { alignItems: 'center', gap: 6, marginTop: 2, justifyContent: 'center', width: '100%' },
    statusText: { fontWeight: '800', textAlign: 'center' },

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
    sectionTitleText: { color: colors.muted, fontWeight: '800', fontSize: 12, letterSpacing: 0.4 },
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
    td: { color: colors.ink, fontSize: 12, minWidth: 0 },
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
