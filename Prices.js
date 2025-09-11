// PricesPage.js (dark mode fixed, light mode kept, theme-aware)
import InfoBanner from './InfoBanner';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Dimensions,
  SafeAreaView,
  useWindowDimensions,
  Modal,
  ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DataTable } from 'react-native-paper';
import FontAwesome from 'react-native-vector-icons/FontAwesome';
import { ClubCrest, assetImages } from './clubs';
import { useFplId } from './FplIdContext';
import { smartFetch } from './signedFetch';
import { useColors, useTheme } from './theme';
import AppHeader from './AppHeader';

// Shared keys (use these across Games/Threats/Prices to stay in sync)
const EOPREF_KEY = 'eo.source';                // 'near' | 'top10k'
const PRICES_EO_FILTER_KEY = 'prices.onlyAbove1Pct'; // '1' | '0'
const EO_CUTOFF = 1.0; // percent

const screenWidth = Dimensions.get('window').width;
const BOTTOM_AD_INSET = 120;

/* ---------- Helpers ---------- */
const pidOf = (p) => p.id ?? p.element ?? `${p.name}|${p.team_code}`;
const pct = (n) => `${(Number(n || 0) * 100).toFixed(2)}\u2060%`;
const fold = (s = '') =>
  String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/ø/g, 'o')
    .replace(/đ|ð/g, 'd')
    .replace(/þ/g, 'th')
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(/ł/g, 'l');

const getPredictionMessage = (val, perHour) => {
  const in1d = val + perHour * 24;
  const in2d = val + perHour * 48;
  if (val >= 1) return 'Tonight ⬆️';
  if (val <= -1) return 'Tonight ⬇️';
  if (in1d >= 1) return 'Tomorrow';
  if (in1d <= -1) return 'Tomorrow';
  if (in2d >= 1) return '2 days';
  if (in2d <= -1) return '2 days';
  return '>2 days';
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
const BUCKET_ORDER = {
  tonight_up: 0,
  tonight_down: 1,
  tomorrow_up: 2,
  tomorrow_down: 3,
  '2days_up': 4,
  '2days_down': 5,
  later: 6,
};

/* Countdown to next 01:30 UTC */
const pad2 = (n) => String(n).padStart(2, '0');
const computeCountdownToNext0130UTC = () => {
  const now = new Date();
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 1, 30, 0, 0));
  let next = base;
  const afterCut = now.getUTCHours() > 1 || (now.getUTCHours() === 1 && now.getUTCMinutes() >= 30);
  if (afterCut) next = new Date(base.getTime() + 24 * 60 * 60 * 1000);
  const diffMs = Math.max(0, next - now);
  const total = Math.floor(diffMs / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
};

/* Pred bar */
const ProgressBar = ({ value, styles }) => {
  const raw = Number(value) || 0;
  const v = Math.max(0, Math.min(1, Math.abs(raw)));
  const fillColor = raw >= 0 ? styles.progressFillUp.backgroundColor : styles.progressFillDown.backgroundColor;
  return (
    <View style={styles.progressTrack}>
      <View style={styles.progressGoalMarker} />
      <View style={[styles.progressFill, { width: `${v * 100}%`, backgroundColor: fillColor }]} />
    </View>
  );
};

/* ---------- Chips ---------- */
const ToggleChip = ({ label, active, onPress, P, isDark, disabled }) => (
  <TouchableOpacity onPress={onPress} activeOpacity={0.8} disabled={disabled}>
    <View style={[
      chipStyles.base,
      disabled ? { opacity: 0.5 } :
      active
        ? (isDark
            ? { backgroundColor: P.accentPillBg, borderColor: P.accent }
            : { backgroundColor: P.accent,       borderColor: P.accent })
        : { backgroundColor: P.card, borderColor: P.border2 },
    ]}>
      <Text style={[chipStyles.txtBase, { color: active ? P.accentOn : P.muted }]}>{label}</Text>
    </View>
  </TouchableOpacity>
);

const chipStyles = StyleSheet.create({
  base: { borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12, borderWidth: 1 },
  txtBase: { fontWeight: '700' },
});

/* ---------- Dark detection (robust) ---------- */
const detectDark = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return true; // default to dark to be safe
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  // relative luminance
  const srgb = [r, g, b].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  const L = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
  return L < 0.5; // dark if luminance low
};

/* ---------- EO helpers ---------- */
const EO_TTL_MS = 10 * 60 * 1000; // 10 minutes

const normalizePercent = (v) => {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return n >= 0 && n <= 1 ? n * 100 : n; // 0.02 -> 2
};

const getEOFromStorage = async (key) => {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.t && parsed.data) {
      if (Date.now() - parsed.t > EO_TTL_MS) return null;
      return parsed.data;
    }
    // tolerate plain JSON without wrapper
    return parsed;
  } catch {
    return null;
  }
};

const setEOToStorage = async (key, data) => {
  try { await AsyncStorage.setItem(key, JSON.stringify({ t: Date.now(), data })); } catch {}
};

// prefer true FPL element id
const elementIdOf = (p) => {
  const cands = [p?.element, p?.id, p?.element_id, p?.player_id, p?.eid, p?.el];
  for (const c of cands) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
};

// Build a Map<elementId, percent> from EO JSON for a given source.
const buildEOMapForSource = (json, source /* 'near' | 'top10k' */) => {
  const map = new Map();
  if (!json) return map;

  const KEYS_NEAR   = ['EO1','eo1','eo_near','EO_near','near','eoNear','EO_near_you','EO_NearYou'];
  const KEYS_TOP10K = ['EO2','eo2','eo_top10k','EO_top10k','top10k','eoTop10k'];
  const keys = source === 'near' ? KEYS_NEAR : KEYS_TOP10K;

  const norm = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return n >= 0 && n <= 1 ? n * 100 : n; // 0.42 -> 42
  };

  const pickEO = (obj) => {
    for (const k of keys) {
      if (obj && obj[k] != null) {
        const n = norm(obj[k]);
        if (n != null) return n;
      }
    }
    // fallback: any "eo" field
    if (obj && typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj)) {
        if (/eo/i.test(k)) {
          const n = norm(v);
          if (n != null) return n;
        }
      }
    }
    return null;
  };

  const setOne = (idLike, v) => {
    const id = Number(idLike ?? v?.element ?? v?.id ?? v?.element_id ?? v?.player_id);
    if (!Number.isFinite(id) || id <= 0) return;

    if (typeof v === 'number') {
      const n = norm(v);
      if (n != null) map.set(id, n);
      return;
    }
    if (v && typeof v === 'object') {
      const n = pickEO(v);
      if (n != null) map.set(id, n);
    }
  };

  // { elements: { "1": {...}|42.7, ... } }
  if (json.elements && typeof json.elements === 'object') {
    for (const [id, v] of Object.entries(json.elements)) setOne(id, v);
    return map;
  }
  // flat dict { "1": {...}|42.7, ... }
  if (typeof json === 'object' && !Array.isArray(json)) {
    for (const [id, v] of Object.entries(json)) setOne(id, v);
    return map;
  }
  // array rows [{element, EO1, EO2, ...}]
  if (Array.isArray(json)) {
    for (const row of json) {
      if (row && typeof row === 'object') {
        setOne(row?.element ?? row?.id ?? row?.element_id ?? row?.player_id, row);
      }
    }
  }

  return map;
};

// Inline EO reader from a player row, then fallback to map
const getEOForPlayer = (p, source, eoMap) => {
  const norm = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return n >= 0 && n <= 1 ? n * 100 : n;
  };
  const NEAR = ['EO1','eo1','eo_near','EO_near','near','eoNear','EO_near_you','EO_NearYou'];
  const TOP  = ['EO2','eo2','eo_top10k','EO_top10k','top10k','eoTop10k'];
  const keys = source === 'near' ? NEAR : TOP;

  // 1) inline EO on player, if ever present
  for (const k of keys) {
    if (p && p[k] != null) {
      const n = norm(p[k]);
      if (n != null) return n;
    }
  }
  // 2) from map
  if (eoMap instanceof Map && eoMap.size > 0) {
    const el = p?._el ?? elementIdOf(p);
    if (Number.isFinite(el)) {
      const v = eoMap.get(el);
      if (v != null) return v;
    }
  }
  return null;
};

/* ---------- Main ---------- */
const PricesPage = () => {
  const baseC = useColors();
  const theme = useTheme?.() || {};
  const isDark = (typeof theme.isDark === 'boolean') ? theme.isDark : detectDark(baseC.bg);

  // augment palette with safe fallbacks used in this screen
  const C = useMemo(() => ({
    ...baseC,
    // fallbacks for chips
    accentPillBg: baseC.accentPillBg ?? (isDark ? '#1b2a4a' : '#dbeafe'),
    accentOn:     baseC.accentOn     ?? '#ffffff',
    chipUsed:     baseC.chipUsed     ?? '#9aa6ca',
    whiteHi:      baseC.whiteHi      ?? '#e6eefc',
    whiteMd:      baseC.whiteMd      ?? '#cbd5e1',
    placeholder:  baseC.placeholder  ?? (isDark ? '#93a4bf' : '#94a3b8'),
  }), [baseC, isDark]);

  const styles = useMemo(() => createStyles(C, isDark, screenWidth), [C, isDark]);
  const P = C; // pass to chips
  const LIVEFPL_LOGO = assetImages?.livefplLogo ?? assetImages?.logo;

  const { width, height } = useWindowDimensions();
  const isCompact = width < 360;
  const listHeight = Math.max(280, Math.floor(height * 0.55));

  const { fplId } = useFplId();

  const sFetch = smartFetch;
  const [players, setPlayers] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [sortColumn, setSortColumn] = useState('prediction');
  const [sortDirection, setSortDirection] = useState('ascending');
  const [filterMode, setFilterMode] = useState('all');
  const [limit, setLimit] = useState(60);

  const [watchlist, setWatchlist] = useState(new Set());
  const [myTeamIds, setMyTeamIds] = useState(new Set());
  const [myTeamNames, setMyTeamNames] = useState(new Set());

  const [countdown, setCountdown] = useState(computeCountdownToNext0130UTC());

  /* EO filter state + map */
  const [onlyAbove1Pct, setOnlyAbove1Pct] = useState(true);     // default ON
  const [eoSource, setEoSource] = useState('top10k');           // 'near' | 'top10k'
  const [eoMap, setEoMap] = useState(new Map());                // always a Map

  /* Summary modal state */
  const [summaryOpen, setSummaryOpen] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setCountdown(computeCountdownToNext0130UTC()), 1000);
    return () => clearInterval(id);
  }, []);

  /* -------- Data -------- */
  const fetchPrices = useCallback(async () => {
    const resp = await sFetch('https://livefpl-api-489391001748.europe-west4.run.app/LH_api/prices');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();

    // IMPORTANT: keep the dict key as the element id
    const arr = Object.entries(json).map(([elStr, p]) => {
      const el = Number(elStr); // element id from the key
      return {
        ...p,
        // search fields
        name: String(p.name || ''),
        team: String(p.team || ''),
        _nameFold: fold(p?.name ?? ''),
        _teamFold: fold(p?.team ?? ''),
        _typeFold: fold(p?.type ?? ''),

        // numbers
        progress: Number(p.progress ?? 0),
        progress_tonight: Number(p.progress_tonight ?? 0),
        per_hour: Number(p.per_hour ?? 0),
        cost: Number(p.cost ?? 0),
        team_code: Number(p.team_code ?? 0),

        // ids — this is what makes EO lookup work
        id: el,
        element: el,
        _el: el,

        // stable key for watchlist / FlatList
        _pid: `${fold(p.name)}|${Number(p.team_code ?? 0)}`,

        // keep type/labels
        type: String(p.type || ''),
        type_code: Number(p.type_code ?? 0),
      };
    });

    setPlayers(arr);
  }, [sFetch]);

  const loadWatchlist = useCallback(async () => {
    const raw = await AsyncStorage.getItem('pricesWatchlist');
    if (!raw) return setWatchlist(new Set());
    try {
      const ids = JSON.parse(raw);
      setWatchlist(new Set(Array.isArray(ids) ? ids : []));
    } catch {
      setWatchlist(new Set());
    }
  }, []);

  const loadMyTeamFromRankCache = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem('fplData');
      if (!raw) {
        setMyTeamIds(new Set());
        setMyTeamNames(new Set());
        return;
      }
      const parsed = JSON.parse(raw);
      const payload = parsed?.data || parsed;
      const team = Array.isArray(payload?.team) ? payload.team : [];

      const idSet = new Set();
      const nameSet = new Set();

      team.forEach((pl) => {
        const el = Number(pl?.element ?? pl?.fpl_id ?? pl?.id);
        if (Number.isFinite(el)) idSet.add(el);
        const nm = fold(String(pl?.name || '').trim());
        if (nm) nameSet.add(nm);
      });

      setMyTeamIds(idSet);
      setMyTeamNames(nameSet);
    } catch {
      setMyTeamIds(new Set());
      setMyTeamNames(new Set());
    }
  }, []);

  const loadEOPrefsAndMap = useCallback(async () => {
    try {
      // EO source
      const storedEO = await AsyncStorage.getItem(EOPREF_KEY);
      const src = storedEO === 'near' ? 'near' : 'top10k';
      setEoSource(src);

      // toggle
      const storedFilter = await AsyncStorage.getItem(PRICES_EO_FILTER_KEY);
      if (storedFilter == null) {
        setOnlyAbove1Pct(true);
        AsyncStorage.setItem(PRICES_EO_FILTER_KEY, '1').catch(() => {});
      } else {
        setOnlyAbove1Pct(storedFilter === '1');
      }

      // cache key like Games/Threats
      let key = 'EO:elite';
      if (src === 'near') {
        const myId = await AsyncStorage.getItem('fplId');
        const rawLocal =
          (myId && (await AsyncStorage.getItem(`localGroup:${myId}`))) ||
          (await AsyncStorage.getItem('localGroup'));
        const localNum = Number(rawLocal) || 1;
        key = `EO:local:${localNum}`;
      }

      // try cached src
      const cached = await getEOFromStorage(key);
      if (cached) {
        const m = buildEOMapForSource(cached, src);
        if (m.size > 0) { setEoMap(m); return; }
      }

      // fallback to elite cache
      if (key !== 'EO:elite') {
        const elite = await getEOFromStorage('EO:elite');
        if (elite) {
          const m = buildEOMapForSource(elite, 'top10k');
          if (m.size > 0) { setEoMap(m); return; }
        }
      }

      // last resort: fetch elite.json
      try {
        const res = await fetch('https://livefpl.us/elite.json', { headers: { 'cache-control': 'no-cache' } });
        if (res.ok) {
          const json = await res.json();
          await setEOToStorage('EO:elite', json);
          const m = buildEOMapForSource(json, 'top10k');
          setEoMap(m);
          return;
        }
      } catch {
        // ignore network error
      }

      // if nothing, still set an empty Map to keep type stable
      setEoMap(new Map());
    } catch {
      setEoMap(new Map());
    }
  }, []);

  useEffect(() => {
    fetchPrices().catch(() => {});
    loadWatchlist().catch(() => {});
    loadMyTeamFromRankCache().catch(() => {});
    loadEOPrefsAndMap().catch(() => {});
  }, [fetchPrices, loadWatchlist, loadMyTeamFromRankCache, loadEOPrefsAndMap]);

  const handleRefresh = useCallback(async () => {
    try {
      setRefreshing(true);
      await Promise.all([fetchPrices(), loadWatchlist(), loadMyTeamFromRankCache(), loadEOPrefsAndMap()]);
    } finally {
      setRefreshing(false);
      setLimit(60);
    }
  }, [fetchPrices, loadWatchlist, loadMyTeamFromRankCache, loadEOPrefsAndMap]);

  /* -------- Sorting / Filtering / Search -------- */
  const handleSort = useCallback(
    (column) => {
      if (column === 'prediction' || column === 'progress_tonight') {
        const nextCol = 'prediction';
        const isAsc = sortColumn === nextCol && sortDirection === 'ascending';
        setSortColumn(nextCol);
        setSortDirection(isAsc ? 'descending' : 'ascending');
      } else {
        const isAsc = sortColumn === column && sortDirection === 'ascending';
        setSortColumn(column);
        setSortDirection(isAsc ? 'descending' : 'ascending');
      }
      setLimit(60);
    },
    [sortColumn, sortDirection]
  );

  const toggleWatch = useCallback(async (p) => {
    setWatchlist((prev) => {
      const next = new Set(prev);
      const id = p._pid;
      if (next.has(id)) next.delete(id);
      else next.add(id);
      AsyncStorage.setItem('pricesWatchlist', JSON.stringify(Array.from(next))).catch(() => {});
      return next;
    });
  }, []);

  // While searching, EO filter is temporarily OFF (UI also shows it OFF)
  const searchActive = searchQuery.trim().length > 0;
  const eoFilterActive = onlyAbove1Pct && !searchActive; // effective toggle

  const filteredSorted = useMemo(() => {
    const qFold = fold(searchQuery.trim());
    let arr = players;

    /* EO ≥ 1% filter with survival for My Team / Watchlist / Positive prediction */
    if (eoFilterActive && eoMap instanceof Map) {
      arr = arr.filter((p) => {
        const inWatch = watchlist.has(p._pid);
        const inMy =
          myTeamIds.has(Number(p.id)) ||
          myTeamIds.has(Number(p.element)) ||
          myTeamNames.has(p._nameFold);

        // NEW: anyone with positive prediction survives
        const positivePrediction = Number(p.progress_tonight) > 0;

        if (inWatch || inMy || positivePrediction) return true; // survive

        const el = Number(p.id ?? p.element);
        const eoPct = eoMap.get(el) ?? 0; // eo already in percent
        return eoPct >= EO_CUTOFF; // default gate: EO ≥ 1%
      });
    }

    // Existing mode filters
    if (filterMode === 'watch') {
      arr = arr.filter((p) => watchlist.has(p._pid));
    } else if (filterMode === 'my') {
      arr = arr.filter(
        (p) =>
          myTeamIds.has(Number(p.id)) ||
          myTeamIds.has(Number(p.element)) ||
          myTeamNames.has(p._nameFold)
      );
    }

    if (qFold) {
      arr = arr.filter(
        (p) => p._nameFold.includes(qFold) || p._teamFold.includes(qFold) || p._typeFold.includes(qFold)
      );
    }

    if (sortColumn === 'prediction') {
      const dir = sortDirection === 'ascending' ? 1 : -1;
      arr = [...arr].sort((a, b) => {
        const aBucket = getPredictionBucket(a.progress_tonight, a.per_hour);
        const bBucket = getPredictionBucket(b.progress_tonight, b.per_hour);
        const aRank = BUCKET_ORDER[aBucket] ?? 999;
        const bRank = BUCKET_ORDER[bBucket] ?? 999;
        if (aRank !== bRank) return dir * (aRank - bRank);
        const aMag = Math.abs(a.progress_tonight);
        const bMag = Math.abs(b.progress_tonight);
        if (aMag !== bMag) return dir * (bMag - aMag);
        if (a.per_hour !== b.per_hour) return dir * (Math.abs(b.per_hour) - Math.abs(a.per_hour));
        return dir * String(a.name).localeCompare(String(b.name));
      });
    } else {
      const dir = sortDirection === 'ascending' ? 1 : -1;
      arr = [...arr].sort((a, b) => {
        if (sortColumn === 'name' || sortColumn === 'team') {
          const aF = sortColumn === 'name' ? a._nameFold : a._teamFold;
          const bF = sortColumn === 'name' ? b._nameFold : b._teamFold;
          const cmp = aF.localeCompare(bF);
          if (cmp !== 0) return dir * cmp;
          return dir * String(a.name).localeCompare(String(b.name));
        }
        const av = Number(a[sortColumn] ?? 0);
        const bv = Number(b[sortColumn] ?? 0);
        return dir * (av - bv);
      });
    }

    return arr;
  }, [
    players,
    searchQuery,
    sortColumn,
    sortDirection,
    filterMode,
    watchlist,
    myTeamIds,
    myTeamNames,
    onlyAbove1Pct,
    eoMap,
    eoSource,
  ]);

  const visible = useMemo(() => filteredSorted.slice(0, limit), [filteredSorted, limit]);

  /* -------- Tonight / Tomorrow summary (players, not just names) -------- */
  const summary = useMemo(() => {
    const buckets = {
      tonight_up: [], tonight_down: [],
      tomorrow_up: [], tomorrow_down: []
    };
    for (const p of filteredSorted) {
      const b = getPredictionBucket(p.progress_tonight, p.per_hour);
      if (b in buckets) buckets[b].push(p);
    }
    const byImpact = (arr) =>
      [...arr].sort((a, b) => Math.abs(b.progress_tonight) - Math.abs(a.progress_tonight));

    return {
      tonightUp:    byImpact(buckets.tonight_up),
      tonightDown:  byImpact(buckets.tonight_down),
      tomorrowUp:   byImpact(buckets.tomorrow_up),
      tomorrowDown: byImpact(buckets.tomorrow_down),
    };
  }, [filteredSorted]);

  useEffect(() => setLimit(60), [searchQuery, filterMode, sortColumn, sortDirection]);

  /* -------- Small summary UI bits (for modal) -------- */
  const SummaryPlayerPill = ({ p }) => (
    <View style={styles.pill}>
      <View style={styles.pillCrest}>
        <ClubCrest id={p.team_code} style={{ width: 18, height: 18 }} resizeMode="contain" />
      </View>
      <Text style={styles.pillName} numberOfLines={1}>{p.name}</Text>
      <Text style={styles.pillPct}>{pct(p.progress_tonight)}</Text>
    </View>
  );

  const SummarySection = ({ title, players, tintStyle }) => (
    <View style={[styles.sectionCard, tintStyle]}>
      <Text style={styles.sectionTitle}>{title} · <Text style={styles.sectionCount}>{players.length}</Text></Text>
      {players.length ? (
        <View style={styles.pillWrap}>
          {players.map((p) => (
            <SummaryPlayerPill key={`${p._el}|pill`} p={p} />
          ))}
        </View>
      ) : (
        <Text style={styles.sumNamesDim}>No strong movers</Text>
      )}
    </View>
  );

  /* -------- Renderers -------- */
  const renderHeader = () => {
    if (isCompact) {
      return (
        <DataTable.Header style={styles.headerStyle}>
          <DataTable.Title
            style={styles.colPlayer}
            sortDirection={sortColumn === 'name' ? sortDirection : undefined}
            onPress={() => { handleSort('name'); }}
          >
            <Text style={styles.headTxt}>Player</Text>
          </DataTable.Title>

          <DataTable.Title
            numeric
            style={styles.colCompactRight}
            sortDirection={sortColumn === 'prediction' ? sortDirection : undefined}
            onPress={() => { handleSort('progress_tonight'); }}
          >
            <Text style={styles.headTxt}>Now · Prediction</Text>
          </DataTable.Title>
        </DataTable.Header>
      );
    }

    return (
      <DataTable.Header style={styles.headerStyle}>
        <DataTable.Title
          style={styles.colPlayer}
          sortDirection={sortColumn === 'name' ? sortDirection : undefined}
          onPress={() => { handleSort('name'); }}
        >
          <Text style={styles.headTxt}>Player</Text>
        </DataTable.Title>

        <DataTable.Title
          style={styles.colTeam}
          sortDirection={sortColumn === 'team' ? sortDirection : undefined}
          onPress={() => { handleSort('team'); }}
        >
          <Text style={styles.headTxt}>Team</Text>
        </DataTable.Title>

        <DataTable.Title
          numeric
          style={styles.colNow}
          sortDirection={sortColumn === 'progress' ? sortDirection : undefined}
          onPress={() => { handleSort('progress'); }}
        >
          <Text style={styles.headTxt}>Now</Text>
        </DataTable.Title>

        <DataTable.Title
          numeric
          style={styles.colPred}
          sortDirection={sortColumn === 'prediction' ? sortDirection : undefined}
          onPress={() => { handleSort('progress_tonight'); }}
        >
          <Text style={styles.headTxt}>Change Time</Text>
        </DataTable.Title>
      </DataTable.Header>
    );
  };

  const renderRow = ({ item }) => {
    const watched = watchlist.has(item._pid);
    const msg = getPredictionMessage(item.progress_tonight, item.per_hour);
    const bucket = getPredictionBucket(item.progress_tonight, item.per_hour);
    const predBgStyle =
      bucket === 'tonight_up'
        ? styles.predTonightUp
        : bucket === 'tonight_down'
        ? styles.predTonightDown
        : styles.predNeutral;
    const predTextStyle =
      bucket === 'tonight_up'
        ? styles.predTextUp
        : bucket === 'tonight_down'
        ? styles.predTextDown
        : styles.predTextNeutral;

    if (isCompact) {
      return (
        <DataTable.Row style={[styles.rowStyle, { paddingHorizontal: 6 }]}>
          <DataTable.Cell style={styles.colPlayer}>
            <View style={styles.playerCell}>
              <TouchableOpacity
                onPress={() => { toggleWatch(item); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <FontAwesome name={watched ? 'star' : 'star-o'} size={16} color={watched ? '#facc15' : P.chipUsed} />
              </TouchableOpacity>

              <View style={styles.shirtWrap}>
                <ClubCrest id={item.team_code} style={{ width: 28, height: 28 }} resizeMode="contain" />
              </View>

              <View style={styles.playerText}>
                <Text style={styles.playerName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.playerMeta} numberOfLines={1}>
                  {item.type} · £{item.cost.toFixed(1)}
                </Text>
              </View>
            </View>
          </DataTable.Cell>

          <DataTable.Cell numeric style={styles.colCompactRight}>
            <View style={styles.compactRight}>
              <View style={[styles.nowWrap, { width: 120 }]}>
                <Text style={styles.cellTxt}>{pct(item.progress)}</Text>
                <ProgressBar value={item.progress} styles={styles} />
              </View>
              <View style={[styles.predWrap, predBgStyle]}>
                <Text style={[styles.predPct, predTextStyle]} numberOfLines={1} ellipsizeMode="tail">
                  {pct(item.progress_tonight)}
                </Text>
                <Text style={[styles.predMsg, predTextStyle]} numberOfLines={1} ellipsizeMode="tail">
                  {msg}
                </Text>
              </View>
            </View>
          </DataTable.Cell>
        </DataTable.Row>
      );
    }

    return (
      <DataTable.Row style={styles.rowStyle}>
        <DataTable.Cell style={styles.colPlayer}>
          <View style={styles.playerCell}>
            <TouchableOpacity
              onPress={() => { toggleWatch(item); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <FontAwesome name={watched ? 'star' : 'star-o'} size={16} color={watched ? '#facc15' : P.chipUsed} />
            </TouchableOpacity>

            <View style={styles.shirtWrap}>
              <ClubCrest id={item.team_code} style={{ width: 28, height: 28 }} resizeMode="contain" />
            </View>

            <View style={styles.playerText}>
              <Text style={styles.playerName} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.playerMeta} numberOfLines={1}>
                {item.type} · £{item.cost.toFixed(1)}
              </Text>
            </View>
          </View>
        </DataTable.Cell>

        <DataTable.Cell style={styles.colTeam}>
          <Text style={styles.cellTxt} numberOfLines={1}>{item.team}</Text>
        </DataTable.Cell>

        <DataTable.Cell numeric style={styles.colNow}>
          <View style={styles.nowWrap}>
            <Text style={styles.cellTxt}>{pct(item.progress)}</Text>
            <ProgressBar value={item.progress} styles={styles} />
          </View>
        </DataTable.Cell>

        <DataTable.Cell numeric style={styles.colPred}>
          <View style={[styles.predWrap, predBgStyle]}>
            <Text style={[styles.predPct, predTextStyle]}>{pct(item.progress_tonight)}</Text>
            <Text style={[styles.predMsg, predTextStyle]}>{msg}</Text>
          </View>
        </DataTable.Cell>
      </DataTable.Row>
    );
  };
const CheckButton = ({ label, checked, onToggle, disabled, P, isDark }) => (
  <TouchableOpacity onPress={onToggle} activeOpacity={0.8} disabled={disabled}>
    <View
      style={[
        { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1 },
        { borderColor: P.border2, backgroundColor: isDark ? P.card : '#ffffff' },
        disabled && { opacity: 0.5 },
      ]}
    >
      <FontAwesome
        name={checked ? 'check-square' : 'square-o'}
        size={18}
        color={checked ? P.accent : P.muted}
      />
      <Text style={{ fontWeight: '700', color: isDark ? P.ink : '#0f172a', fontSize: 12 }}>
        {label}
      </Text>
    </View>
  </TouchableOpacity>
);
  const renderFooter = () => (
    <View>
      {visible.length < filteredSorted.length ? (
        <View style={styles.footerLoadMore}>
          <Text style={styles.footerTxt}>Loading more…</Text>
        </View>
      ) : (
        <View style={styles.footerDone}>
          <Text style={styles.footerTxtDim}>
            {filteredSorted.length ? 'End of list' : 'No players match your filters'}
          </Text>
        </View>
      )}
      <View style={{ height: BOTTOM_AD_INSET }} />
    </View>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        {/* Top bar — stay DARK in both modes */}
        <AppHeader />

        {/* Countdown banner */}
        <InfoBanner text="Transfer trends & past changes at" link="www.livefpl.net/prices" />
        <View style={styles.banner}>
          <Text style={styles.bannerTxt}>
            These are predicted price changes to take place in{' '}
            <Text style={styles.bannerStrong}>{countdown}</Text>{' '}
            hours (at <Text style={styles.bannerStrong}>01:30 UTC</Text>)
          </Text>
        </View>

        {/* Top controls (sticky area) */}
        <View style={styles.controlsRow}>
          <TextInput
            style={styles.input}
            placeholder="Search players, teams, positions…"
            placeholderTextColor={C.placeholder}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />

          <View style={styles.toggleRow}>
            <ToggleChip label="All"       active={filterMode === 'all'}   onPress={() => setFilterMode('all')}   P={P} isDark={isDark} />
            <ToggleChip label="My Team"   active={filterMode === 'my'}    onPress={() => setFilterMode('my')}    P={P} isDark={isDark} />
            <ToggleChip label="Watchlist" active={filterMode === 'watch'} onPress={() => setFilterMode('watch')} P={P} isDark={isDark} />
            {/* EO filter toggle (persisted, default ON) */}
            <TouchableOpacity onPress={() => setSummaryOpen(true)} activeOpacity={0.85}>
              <View style={[chipStyles.base, { backgroundColor: isDark ? '#1e293b' : '#e2e8f0', borderColor: P.border2 }]}>
                <Text style={[chipStyles.txtBase, { color: isDark ? P.whiteHi : '#0f172a' }]}>Show summary</Text>
              </View>
            </TouchableOpacity>
            /* ---------- Check button ---------- */

<CheckButton
  label="Hide fallers below 1% EO"
  checked={eoFilterActive}            // visually off while typing
  onToggle={() => {
    if (searchActive) return;         // don't change saved pref mid-typing
    const v = !onlyAbove1Pct;
    setOnlyAbove1Pct(v);
    AsyncStorage.setItem(PRICES_EO_FILTER_KEY, v ? '1' : '0').catch(() => {});
  }}
  disabled={searchActive}
  P={P}
  isDark={isDark}
/>

            {/* Show Summary button */}
            
          </View>
        </View>

        {/* Table area with finite height and scroll */}
        <View style={[styles.tableWrap, { height: listHeight }]}>
          <DataTable style={styles.table}>
            <FlatList
              ListHeaderComponent={renderHeader()}
              data={visible}
              keyExtractor={(item) => String(item._el)}  // use element id (stable, unique)
              renderItem={renderRow}
              onEndReachedThreshold={0.35}
              onEndReached={() => {
                if (visible.length < filteredSorted.length) setLimit((n) => n + 60);
              }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
              contentContainerStyle={{ paddingBottom: BOTTOM_AD_INSET }}
              ListFooterComponent={renderFooter}
            />
          </DataTable>
        </View>
      </View>

      {/* ===== Summary Modal ===== */}
      <Modal
        visible={summaryOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setSummaryOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: isDark ? '#0b1224' : '#ffffff', borderColor: P.border }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Price Change Summary</Text>
              <TouchableOpacity onPress={() => setSummaryOpen(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSub}>
              Based on current predictions and your filters/search.
            </Text>

            <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
              <SummarySection
                title="Likely Tonight ⬆️"
                players={summary.tonightUp}
                tintStyle={styles.sumTintUp}
              />
              <SummarySection
                title="Likely Tonight ⬇️"
                players={summary.tonightDown}
                tintStyle={styles.sumTintDown}
              />
              <SummarySection
                title="Likely Tomorrow ⬆️"
                players={summary.tomorrowUp}
                tintStyle={styles.sumTintSoonUp}
              />
              <SummarySection
                title="Likely Tomorrow ⬇️"
                players={summary.tomorrowDown}
                tintStyle={styles.sumTintSoonDown}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>
      {/* ===== End Summary Modal ===== */}
    </SafeAreaView>
  );
};

/* ---------- Styles ---------- */
const createStyles = (C, isDark, screenWidth) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: C.bg, paddingTop: 48 },
    container: { flex: 1, paddingHorizontal: 10 },

    tableWrap: { overflow: 'hidden', borderRadius: 10, marginTop: 8 },

    // Summary modal-specific
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'flex-end',
    },
    modalCard: {
      maxHeight: '85%',
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingHorizontal: 14,
      paddingTop: 12,
      borderWidth: 1,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingBottom: 6,
    },
    modalTitle: { fontSize: 16, fontWeight: '900', color: isDark ? C.whiteHi : '#0f172a' },
    modalClose: { fontSize: 20, color: isDark ? C.whiteMd : '#334155' },
    modalSub: {
      color: isDark ? C.whiteMd : '#475569',
      marginBottom: 10,
      fontSize: 12,
      textAlign: 'center',
    },

    // Section cards inside modal
    sectionCard: {
      borderWidth: 1,
      borderRadius: 12,
      paddingVertical: 10,
      paddingHorizontal: 12,
      marginBottom: 10,
    },
    sectionTitle: { fontWeight: '800', fontSize: 12, color: isDark ? C.whiteHi : '#0f172a' },
    sectionCount: { color: isDark ? C.ink : '#0f172a' },

    // Player pills
    pillWrap: {
      marginTop: 8,
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginHorizontal: -4,
    },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: isDark ? '#1b2642' : '#cbd5e1',
      backgroundColor: isDark ? '#0f1525' : '#f8fafc',
      borderRadius: 999,
      paddingVertical: 6,
      paddingHorizontal: 10,
      margin: 4,
      maxWidth: '100%',
      gap: 6,
    },
    pillCrest: { width: 20, alignItems: 'center' },
    pillName: { color: isDark ? C.whiteHi : '#0f172a', fontWeight: '700', maxWidth: screenWidth * 0.5 },
    pillPct: { color: isDark ? C.whiteMd : '#475569', fontSize: 11 },

    // Summary tints (reused from earlier)
    sumTintUp:       { backgroundColor: isDark ? '#0f1d12' : '#ecfdf5', borderColor: isDark ? '#14532d' : '#a7f3d0' },
    sumTintDown:     { backgroundColor: isDark ? '#2b1412' : '#fef2f2', borderColor: isDark ? '#7f1d1d' : '#fecaca' },
    sumTintSoonUp:   { backgroundColor: isDark ? '#0f1725' : '#eef2ff', borderColor: isDark ? '#1d4ed8' : '#c7d2fe' },
    sumTintSoonDown: { backgroundColor: isDark ? '#1e1825' : '#f5f3ff', borderColor: isDark ? '#6d28d9' : '#ddd6fe' },

    // Force DataTable background to our theme color (fixes white table in dark)
    table: {
      backgroundColor: isDark ? C.bg : '#ffffff',
    },

    // Banner
    banner: {
      borderWidth: 1,
      borderColor: isDark ? C.border2 : '#e2e8f0',
      backgroundColor: isDark ? C.card : '#f8fafc',
      borderRadius: 12,
      paddingVertical: 8,
      paddingHorizontal: 12,
      marginBottom: 2,
    },
    bannerTxt: { color: isDark ? (C.whiteMd || '#cbd5e1') : '#334155', fontSize: 12, textAlign: 'center' },
    bannerStrong: { color: isDark ? (C.whiteHi || '#e6eefc') : '#0f172a', fontWeight: '800' },

    // Controls
    controlsRow: { marginBottom: 8, paddingTop: 6 },
    input: {
      height: 40,
      borderWidth: 1,
      borderColor: isDark ? C.inputBorder : '#e2e8f0',
      backgroundColor: isDark ? C.inputBg : '#ffffff',
      color: isDark ? C.ink : '#0f172a',
      paddingHorizontal: 12,
      borderRadius: 10,
      marginBottom: 8,
    },
    toggleRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },

    // Table header / rows
    headerStyle: {
      borderBottomWidth: 1,
      borderColor: C.border,
      backgroundColor: isDark ? '#0f172a' : '#f1f5f9',
    },
    headTxt: { color: isDark ? C.ink : '#0f172a', fontWeight: '800' },

    rowStyle: {
      borderBottomWidth: 1,
      borderColor: C.border,
      backgroundColor: isDark ? '#0c1326' : '#ffffff', // dark fixed
    },

    // Column widths
    colPlayer: { flex: 5, minWidth: 0, alignItems: 'center', justifyContent: 'flex-start' },
    colTeam:   { flex: 2, minWidth: 0, alignItems: 'center', justifyContent: 'center' },
    colNow:    { flex: 3, minWidth: 0, alignItems: 'center', justifyContent: 'center' },
    colPred:   { flex: 4, minWidth: 0, alignItems: 'center', justifyContent: 'center' },
    colCompactRight: { flex: 5, minWidth: 0, alignItems: 'flex-end', justifyContent: 'center' },

    // Player cell
    playerCell: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    shirtWrap: { width: 28, alignItems: 'center' },
    playerText: { minWidth: 0, maxWidth: screenWidth * 0.42 - 28 - 26 },
    playerName: { color: isDark ? C.ink : '#0f172a', fontSize: 12, fontWeight: '700' },
    playerMeta: { color: isDark ? C.muted : '#64748b', fontSize: 10, marginTop: 2 },

    cellTxt: { color: isDark ? C.ink : '#0f172a', fontSize: 9, textAlign: 'center' },

    nowWrap: { width: 110, alignItems: 'flex-end' },
    compactRight: { alignItems: 'flex-end', width: '100%', gap: 6 },

    // Progress
    progressTrack: {
      width: '90%',
      maxWidth: 120,
      minWidth: 70,
      height: 8,
      backgroundColor: isDark ? '#0b1224' : '#e5e7eb',
      borderRadius: 6,
      overflow: 'hidden',
      position: 'relative',
      borderWidth: 1,
      borderColor: isDark ? '#1b2642' : '#cbd5e1',
    },
    progressFill: { height: '100%', borderRadius: 6 },
    progressFillUp:   { backgroundColor:  '#22c55e' },
    progressFillDown: { backgroundColor:  '#b91c1c'  },
    progressGoalMarker: {
      position: 'absolute',
      right: 0,
      top: 0,
      bottom: 0,
      width: 2,
      backgroundColor: isDark ? '#334155' : '#94a3b8',
    },

    // Prediction cell (fixed for dark mode)
    predWrap: {
      minWidth: 120,
      width: '90%',
      alignItems: 'center',
      borderRadius: 8,
      paddingVertical: 4,
      paddingHorizontal: 0,
      borderWidth: 1,
    },
    predNeutral: {
      backgroundColor: isDark ? '#0f1525' : '#f1f5f9',
      borderColor: isDark ? '#374151' : '#e5e7eb',
    },
    predPct: { fontSize: 10, fontWeight: '700', android_hyphenationFrequency: 'none' },
    predMsg: { fontSize: 9, marginTop: 2, android_hyphenationFrequency: 'none' },

    // readable text colors on tints
    predTextUp:      { color: isDark ? '#ffffff' : '#14532d' },
    predTextDown:    { color: isDark ? '#ffffff' : '#7f1d1d' },
    predTextNeutral: { color: isDark ? C.ink : '#334155' },

    // Strong Tonight tints
    predTonightUp: {
      backgroundColor: isDark ? '#166534' : '#dcfce7',
      borderColor:     isDark ? '#16a34a' : '#16a34a',
    },
    predTonightDown: {
      backgroundColor: isDark ? '#7C2D12' : '#fee2e2',
      borderColor:     isDark ? '#b91c1c' : '#ef4444',
    },

    // Footer
    footerLoadMore: { paddingVertical: 14, alignItems: 'center' },
    footerDone: { paddingVertical: 14, alignItems: 'center' },
    footerTxt: { color: isDark ? '#cbd5e1' : '#64748b', fontWeight: '700' },
    footerTxtDim: { color: isDark ? '#6b7280' : '#94a3b8' },
    sumNamesDim: { color: isDark ? '#cbd5e1' : '#64748b',}
  });

export default PricesPage;
