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
  Image,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DataTable } from 'react-native-paper';
import FontAwesome from 'react-native-vector-icons/FontAwesome';
import { ClubCrest, assetImages } from './clubs';
import { useFplId } from './FplIdContext';
import { smartFetch } from './signedFetch';
import { useColors, useTheme } from './theme';
import AppHeader from './AppHeader';

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
const ToggleChip = ({ label, active, onPress, P, isDark }) => (
  <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
    <View style={[
      chipStyles.base,
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

  const { width } = useWindowDimensions();
  const isCompact = width < 360;
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
  useEffect(() => {
    const id = setInterval(() => setCountdown(computeCountdownToNext0130UTC()), 1000);
    return () => clearInterval(id);
  }, []);

  /* -------- Data -------- */
  const fetchPrices = useCallback(async () => {
    const resp = await sFetch('https://livefpl-api-489391001748.europe-west4.run.app/LH_api/prices');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    const arr = Object.values(json).map((p) => ({
      ...p,
      _pid: pidOf(p),
      name: String(p.name || ''),
      team: String(p.team || ''),
      _nameFold: fold(p?.name ?? ''),
      _teamFold: fold(p?.team ?? ''),
      _typeFold: fold(p?.type ?? ''),
      progress: Number(p.progress ?? 0),
      progress_tonight: Number(p.progress_tonight ?? 0),
      per_hour: Number(p.per_hour ?? 0),
      type: String(p.type || ''),
      cost: Number(p.cost ?? 0),
      team_code: Number(p.team_code ?? 0),
      id: Number(p.id ?? p.element ?? NaN),
      element: Number(p.element ?? p.id ?? NaN),
    }));
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

  useEffect(() => {
    fetchPrices().catch(() => {});
    loadWatchlist().catch(() => {});
    loadMyTeamFromRankCache().catch(() => {});
  }, [fetchPrices, loadWatchlist, loadMyTeamFromRankCache]);

  const handleRefresh = useCallback(async () => {
    try {
      setRefreshing(true);
      await Promise.all([fetchPrices(), loadWatchlist(), loadMyTeamFromRankCache()]);
    } finally {
      setRefreshing(false);
      setLimit(60);
    }
  }, [fetchPrices, loadWatchlist, loadMyTeamFromRankCache]);

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

  const filteredSorted = useMemo(() => {
    const qFold = fold(searchQuery.trim());
    let arr = players;

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
  }, [players, searchQuery, sortColumn, sortDirection, filterMode, watchlist, myTeamIds, myTeamNames]);

  const visible = useMemo(() => filteredSorted.slice(0, limit), [filteredSorted, limit]);
  useEffect(() => setLimit(60), [searchQuery, filterMode, sortColumn, sortDirection]);

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
                <ClubCrest id={item.team_code} style={styles.shirtImage} resizeMode="contain" />
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
              <ClubCrest id={item.team_code} style={styles.shirtImage} resizeMode="contain" />
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
        <InfoBanner text="Transfer trends and past price changes available at" link="www.livefpl.net/prices" />
        <View style={styles.banner}>
          <Text style={styles.bannerTxt}>
            These are predicted price changes to take place in{' '}
            <Text style={styles.bannerStrong}>{countdown}</Text>{' '}
            hours (at <Text style={styles.bannerStrong}>01:30 UTC</Text>)
          </Text>
        </View>

        {/* Top controls */}
        <View style={styles.controlsRow}>
          <TextInput
            style={styles.input}
            placeholder="Search players, teams, positions…"
            placeholderTextColor={C.placeholder}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />

          <View style={styles.toggleRow}>
            <ToggleChip label="All"       active={filterMode === 'all'}  onPress={() => setFilterMode('all')}  P={P} isDark={isDark} />
            <ToggleChip label="My Team"   active={filterMode === 'my'}   onPress={() => setFilterMode('my')}   P={P} isDark={isDark} />
            <ToggleChip label="Watchlist" active={filterMode === 'watch'} onPress={() => setFilterMode('watch')} P={P} isDark={isDark} />
          </View>
        </View>

        <DataTable style={styles.table}>
          {renderHeader()}
          <FlatList
            data={visible}
            keyExtractor={(item) => String(item._pid)}
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
    </SafeAreaView>
  );
};

/* ---------- Styles ---------- */
const createStyles = (C, isDark, screenWidth) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: C.bg, paddingTop: 48 },
    container: { flex: 1, paddingHorizontal: 10 },

    // Force DataTable background to our theme color (fixes white table in dark)
    table: {
      backgroundColor: isDark ? C.bg : '#ffffff',
    },

    // Top bar — fixed dark
    topBar: {
      height: 44,
      paddingHorizontal: 12,
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'center',
      backgroundColor: '#0b0c10',
      borderBottomWidth: 1,
      borderBottomColor: '#0b0c10',
      zIndex: 10,
      elevation: 10,
      marginBottom: 6,
    },
    topLogo: { height: 28, width: 160 },
    topTitle: { color: '#e6eefc', fontWeight: '900', fontSize: 16 },

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
    toggleRow: { flexDirection: 'row', gap: 8 },

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
    shirtImage: { width: 28, height: 28 },
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
  });

export default PricesPage;
