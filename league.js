// league.js
import InfoBanner from './InfoBanner';
import React, { useCallback, useEffect, useMemo, useState,useRef } from 'react';
import AppHeader from './AppHeader';

import {
  
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ScrollView,
  Image,
  ImageBackground,
  Dimensions,
  Switch,
  Platform,
 
  Linking,
  Share,
} from 'react-native';
import ThemedTextInput from './ThemedTextInput';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { assetImages, clubCrestUri } from './clubs';
import { useFplId } from './FplIdContext';
import { smartFetch } from './signedFetch';
import { useColors, useTheme } from './theme';
Text.defaultProps = Text.defaultProps || {};
Text.defaultProps.allowFontScaling = false;
const { height } = Dimensions.get('window');

const COL = { pos: 12, manager: 35, yet: 9, cap: 18, gw: 13, total: 15 };
const toPct = (n) => `${n}%`;
const LIVEFPL_LOGO = assetImages?.livefplLogo ?? assetImages?.logo;

const CHIP_ORDER = ['WC', 'BB', 'FH', 'TC'];
const RADIUS = 18;
const SHOW_HEARTS = false;
const CELEBS_OPTION = { id: 'celebs', name: 'You vs. FPL Celebs' };

// === CELEBS AUGMENT HELPERS ===
const safeNum = (v, d = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
};

// Count “yet to play” using player roles + multipliers (captain twice, TC thrice)
const countYetFromTeam = (teamArr = []) => {
  let yet = 0;
  for (const p of teamArr) {
    const role = String(p?.role || '').toLowerCase();
    const status = String(p?.status || '').toLowerCase(); // y/m/d/l
    let mul = 0;
    if (role === 'b') mul = 0;
    else if (role === 'tc') mul = 3;
    else if (role === 'c') mul = 2;
    else mul = 1;
    if (status === 'y') yet += mul;
  }
  return yet;
};
// Multiplier: 1 normal, 2 captain, 3 TC (fallback to role if multiplier missing)
const capMultOf = (p) => {
  const role = String(p?.role || '').toLowerCase();
  const mul  = Number(p?.multiplier ?? p?.mul ?? (role === 'c' ? 2 : 1));
  return Math.max(1, mul);
};

// Label: append (C) or (TC)
const displayName = (p) => {
  const mul = capMultOf(p);
  const name = String(p?.name ?? '');
  if (mul >= 3) return `${name} (TC)`;
  if (mul === 2) return `${name} (C)`;
  return name;
};

// Points shown in table: base * multiplier
const displayPts = (p) => {
  const base = Number(p?.pts ?? p?.points ?? p?.score ?? 0);
  return base * capMultOf(p);
};

// Convert Rank payload -> roster expected by League rows
const buildRosterFromRank = (payload) => {
  const team = Array.isArray(payload?.team) ? payload.team : [];
  return team.slice(0, 15).map((p) => {
    const id =
      Number(p?.fpl_id ?? p?.element ?? p?.id ?? p?.code) || Date.now() + Math.random();

    const rawRole = String(p?.role || '').toLowerCase(); // 'c' | 'v' | 'b' | 's' | ''
    const statusCode = String(p?.status || 'd').toLowerCase(); // y/m/d/l
    const statusMap = { y: 'yet', m: 'missed', d: 'played', l: 'live' };
    const status = statusMap[statusCode] || 'played';

    // multiplier from role (bench → 0, TC → 3, C → 2, otherwise 1)
    let mul = 1;
    if (rawRole === 'b') mul = 0;
    else if (rawRole === 'tc') mul = 3;
    else if (rawRole === 'c') mul = 2;

    // Rank payload points are already multiplied for C/TC.
    // Normalize back to base points so our UI's multiplier logic doesn't double-count.
    // Heuristic: if mul > 1 and points cleanly divides by mul, divide once.
    let pts = safeNum(p?.points);
    if (mul > 1 && pts > 0) {
      const norm = pts / mul;
      // Use "clean division" heuristic to avoid accidental rounding issues
      if (Number.isInteger(norm)) {
        pts = norm;
      } else {
        // allow tiny floating error tolerance (e.g., 15.999999 → 16)
        const rounded = Math.round(norm);
        if (Math.abs(norm - rounded) < 1e-9) pts = rounded;
      }
    }

    return {
      id,
      name: String(p?.name ?? ''),
      team_id: Number(p?.club ?? p?.team_id ?? 1),
      gw_points: pts,                         // base (un-multiplied) points
      role: rawRole === 'tc' ? 'c' : rawRole, // keep 'c' for badge; TC inferred via mul=3
      multiplier: mul,
      status,
      eo: safeNum(p?.EO1) || 0,               // local EO (0..1); ok if 0
    };
  });
};


// Guess active chip from roster (or from payload if present)
const detectActiveChip = (payload, roster) => {
  const apiChip =
    String(payload?.active_chip || payload?.chip || '').toUpperCase();
  if (apiChip) return apiChip;
  const hasTC = roster.some((p) => p.role === 'c' && p.multiplier >= 3);
  if (hasTC) return 'TC';
  return ''; // '', 'TC', 'FH', 'BB', 'WC'
};

// Build a synthetic “me” row for the celebs league
const buildMeLeagueRow = (payload, myEntryId, autosubs) => {
  const manager = String(payload?.manager ?? 'You');
  const teamName = String(payload?.team_name ?? payload?.teamname ?? 'My Team');

  const live = safeNum(payload?.live_points);
  const bench = safeNum(payload?.bench_points);
  const hit = safeNum(payload?.hit);
  const gwGross = live + bench;            // GW points *before* hits
  const gwHits = hit;                      // (likely negative)
  const roster = buildRosterFromRank(payload);
  const yet = countYetFromTeam(payload?.team || []);

  // Which OR do we show in the row bubble? Match Rank screen logic.
  const showPost = autosubs || !!payload?.aut;
  const liveOR = showPost
    ? safeNum(payload?.post_rank, null)
    : safeNum(payload?.pre_rank, null);

  // Total: best source is API season total if present.
  // If payload.total_points already includes this GW progress, use it as-is.
  const seasonTotal =
    safeNum(payload?.total_points ?? payload?.total ?? payload?.season_total);

  // captain / vice from team names
  const cap = (payload?.team || []).find((p) => String(p?.role).toLowerCase() === 'c');
  const vice = (payload?.team || []).find((p) => String(p?.role).toLowerCase() === 'v');

  const active_chip = detectActiveChip(payload, roster);

  return {
    entry_id: Number(myEntryId),
    manager_name: manager,
    team_name: teamName,
    // rank/last_rank will be filled by recompute
    overall_rank: liveOR || undefined,
    captain: cap?.name || '',
    vice: vice?.name || '',
    gw_gross: gwGross,
    gw_hits: gwHits,
    total: seasonTotal,     // season total (server’s best truth)
    yet,                    // “players left” using multipliers
    used_chips: Array.isArray(payload?.used_chips) ? payload.used_chips : [],
    active_chip,
    transfers: [],          // rank payload didn’t include; ok to leave empty
    roster,
  };
};

// Recompute ranks locally (simple: by total desc, tiebreak by GW gross desc, then keep prior rank)
// --- helpers used by the ranker ---
const gwGrossOf = (r) => safeNum(r.gw_gross ?? r.gwgross ?? r.gw, 0);
const gwHitsOf  = (r) => safeNum(r.gw_hits ?? r.hits ?? r.hit, 0);
const gwNetOf   = (r) => gwGrossOf(r) + gwHitsOf(r); // hits are usually negative
const prevTotalOf = (r) => safeNum(r.total, 0) - gwNetOf(r);

// === My-row per-GW snapshot (to backfill Celebs "me") ===
const SNAP_VER = 'v1';
const snapKey = (fplId, gw) => `meSnapshot:${SNAP_VER}:${fplId}:gw${gw}`;

const pickGW = (leagueJson, rankPayload) => {
  const gw = Number(
    leagueJson?.gameweek ??
    rankPayload?.gameweek ??
    rankPayload?.gw ??
    0
  );
  return Number.isFinite(gw) && gw > 0 ? gw : 0;
};

const normEntryId = (r) => Number(r?.entry_id ?? r?.entry ?? r?.id ?? NaN);

const extractMyLeagueRow = (leagueJson, fplId) => {
  const rows = Array.isArray(leagueJson?.rows) ? leagueJson.rows : [];
  const myId = Number(fplId);
  return rows.find((r) => normEntryId(r) === myId) || null;
};

const snapshotFieldsFromRow = (row) => ({
  // only fields we intend to backfill later
  used_chips: Array.isArray(row?.used_chips) ? row.used_chips : undefined,
  active_chip: row?.active_chip || undefined,
  team_name: row?.team_name || undefined,
  FT: row?.FT ?? row?.ft ?? undefined,
  team_value: row?.team_value ?? undefined,
  transfers: Array.isArray(row?.transfers) ? row.transfers : undefined,
});

const saveMyLeagueSnapshot = async (leagueJson, fplId, rankPayload) => {
  try {
    const gw = pickGW(leagueJson, rankPayload);
    if (!gw || !fplId) return;
    const meRow = extractMyLeagueRow(leagueJson, fplId);
    if (!meRow) return;

    const data = snapshotFieldsFromRow(meRow);
    // if we have nothing meaningful, skip
    const hasAny =
      (data.used_chips && data.used_chips.length) ||
      data.active_chip ||
      data.team_name ||
      data.FT != null ||
      data.team_value != null ||
      (data.transfers && data.transfers.length);
    if (!hasAny) return;

    await AsyncStorage.setItem(
      snapKey(fplId, gw),
      JSON.stringify({ gw, data, ts: Date.now() })
    );
  } catch { /* noop */ }
};

const loadMySnapshot = async (fplId, gw) => {
  try {
    if (!gw || !fplId) return null;
    const raw = await AsyncStorage.getItem(snapKey(fplId, gw));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.data || null;
  } catch {
    return null;
  }
};

const backfillMeFromSnapshot = (meRow, snap) => {
  if (!snap) return meRow;
  const out = { ...meRow };

  if (!out.active_chip && snap.active_chip) out.active_chip = snap.active_chip;
  if ((!out.used_chips || !out.used_chips.length) && Array.isArray(snap.used_chips)) {
    out.used_chips = snap.used_chips;
  }
  if (!out.team_name && snap.team_name) out.team_name = snap.team_name;

  if (out.FT == null && snap.FT != null) out.FT = snap.FT;
  if (out.team_value == null && snap.team_value != null) out.team_value = snap.team_value;

  if ((!out.transfers || !out.transfers.length) && Array.isArray(snap.transfers)) {
    out.transfers = snap.transfers;
  }
  return out;
};

// Recompute ranks in two phases
// 1) "previous table" using prevTotal → sets last_rank
// 2) "current table" using total → sets rank
const recomputeRanks = (rows) => {
  const tagged = rows.map((r, i) => ({
    ...r,
    _i: i,
    // if server provided last_rank, keep it as a weak stability hint
    _serverLast: safeNum(r.last_rank, Number.MAX_SAFE_INTEGER),
  }));

  // Phase 1: previous standings (as-if you already existed last GW)
  const prev = [...tagged].sort((a, b) => {
    // primary: previous total (desc)
    const dt = prevTotalOf(b) - prevTotalOf(a);
    if (dt) return dt;
    // secondary: current GW gross (desc) — decent tie breaker
    const dg = gwGrossOf(b) - gwGrossOf(a);
    if (dg) return dg;
    // tertiary: keep server last order if present
    const ds = a._serverLast - b._serverLast;
    if (ds) return ds;
    // final: original order (stable)
    return a._i - b._i;
  });
  prev.forEach((r, idx) => { r._prevRank = idx + 1; });

  // Phase 2: current standings
  const curr = [...prev].sort((a, b) => {
    // primary: season total (desc)
    const dt = safeNum(b.total) - safeNum(a.total);
    if (dt) return dt;
    // secondary: current GW gross (desc)
    const dg = gwGrossOf(b) - gwGrossOf(a);
    if (dg) return dg;
    // final: preserve relative order from previous table
    return a._prevRank - b._prevRank;
  });
  curr.forEach((r, idx) => {
    r.last_rank = r._prevRank;   // old rank (computed as-if you existed)
    r.rank = idx + 1;            // current rank
  });

  return curr;
};


// Bump chips_pct to include me (keeps server shape and keeps it approximate)
const addMeToChipsPct = (chipsPct = {}, activeChip, oldCount) => {
  const n0 = Math.max(1, Number(oldCount) || 1);
  const keys = ['WC', 'BB', 'FH', 'TC'];
  // convert pct -> counts (rounded), then add mine
  const counts = {};
  keys.forEach((k) => {
    const pct = safeNum(chipsPct[k]);
    counts[k] = Math.round((pct / 100) * n0);
  });
  if (activeChip && keys.includes(activeChip)) counts[activeChip] += 1;

  const n1 = n0 + 1; // new league size after adding me
  const next = {};
  keys.forEach((k) => {
    next[k] = n1 ? (counts[k] * 100) / n1 : 0;
  });
  return next;
};

// Core: given celebs league + my rank payload → new league object
// Core: given celebs league + my rank payload → new league object
const augmentCelebsWithMe = async (leagueJson, { autosubs, myEntryId }) => {
  try {
    if (!leagueJson || !Array.isArray(leagueJson.rows)) return leagueJson;

    // Read the freshest Rank payload saved by rank.js (league.js also writes it)
    let payload = null;
    try {
      const raw = await AsyncStorage.getItem('fplData');
      if (raw) {
        const parsed = JSON.parse(raw);
       // Only trust it if it's for THIS user
      if (Number(parsed?.id) === Number(myEntryId)) {
         payload = parsed?.data || null;
       }
      }
    } catch (e) {
      // non-fatal
    }
    if (!payload) {
      // no rank payload → nothing we can safely synthesize
      return leagueJson;
    }

    // Normalize my entry id. Prefer the explicit prop, else derive from rank payload.
    const deriveMyId = () =>
      Number(
        payload?.entry_id ??
        payload?.entry ??
        payload?.id ??
        payload?.my_entry ??
        payload?.team_id
      ) || null;

    const myId =
      (Number(myEntryId) || deriveMyId()) ?? null;
    if (!myId) {
      // Without a stable id, we can't de-dup or append.
      return leagueJson;
    }

    // Robust "already-in-league" test: accept entry_id | entry | id (string or number)
    const normId = (r) => Number(r?.entry_id ?? r?.entry ?? r?.id ?? NaN);
    const exists = leagueJson.rows.some((r) => normId(r) === myId);
    if (exists) return leagueJson; // ✅ already present → do nothing

    // Build my synthetic row from the Rank payload
    const me = buildMeLeagueRow(payload, myId, autosubs);
    // Backfill holes on "me" from my per-GW snapshot (captured from non-celebs leagues)
try {
  const gw = pickGW(leagueJson, payload);
  const snap = await loadMySnapshot(myId, gw);
  Object.assign(me, backfillMeFromSnapshot(me, snap));
} catch { /* non-fatal */ }


    // Append + recompute
    const base = Array.isArray(leagueJson.rows) ? leagueJson.rows : [];
    const nextRows = [...base, me];
    const ranked = recomputeRanks(nextRows);

    // Optional: nudge chip % to include me (keeps server shape)
    const size0 = base.length;
    const chips_pct = addMeToChipsPct(leagueJson.chips_pct, me.active_chip, size0);

    return {
      ...leagueJson,
      rows: ranked,
      entries_count: safeNum(leagueJson.entries_count, size0) + 1,
      num_entries:   safeNum(leagueJson.num_entries, size0) + 1,
      chips_pct,
    };
  } catch (_e) {
    // If anything goes sideways, fall back to server json
    return leagueJson;
  }
};


/** ===== Helpers ===== */
const fmt = (n) => (n === null || n === undefined ? '-' : Intl.NumberFormat('en-US').format(n));
const sign = (n) => (n > 0 ? `+${n}` : `${n}`);
const safeArr = (v) => (Array.isArray(v) ? v : []);
const pickPayload = (json, fplId) => (json && json[String(fplId)]) ? json[String(fplId)] : (json || {});
const pct = (x) => (x == null ? '' : `${Math.round(x * 100)}%`);
const compactNumber = (n) => {
  const x = Number(n);
  if (!Number.isFinite(x)) return '-';
  return Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(x);
};
// Resolve Captain / Vice from row or fallback to roster roles
const capViceOf = (row) => {
  const roster = Array.isArray(row?.roster) ? row.roster : [];
  const cap  = row?.captain || roster.find(p => String(p?.role).toLowerCase() === 'c')?.name || '';
  const vice = row?.vice     || roster.find(p => String(p?.role).toLowerCase() === 'v')?.name || '';
  return { cap, vice };
};

const emojiToChar = (s) => {
  if (!s) return '';
  const m = { template: '😴', differential: '🎲', spy: '🕵' };
  return m[s] || '';
};

const League = () => {
  const { fplId, triggerRefetch } = useFplId();
  const navigation = useNavigation();

  // THEME
  const { mode } = useTheme();
  const C = useColors();
  const isDark = useMemo(() => {
    const hex = String(C.bg || '#000').replace('#', '');
    if (hex.length < 6) return true;
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    const l = 0.2126*r + 0.7152*g + 0.0722*b;
    return l < 0.5;
  }, [C.bg]);
  const S = useMemo(() => createStyles(C, isDark), [C, isDark]);
const [openA, setOpenA] = useState(false);
const [openB, setOpenB] = useState(false);
// ── Chips (overall) table sort (default: by pct, desc)
const [chipsOverallSortKey, setChipsOverallSortKey] = useState('pct'); // 'chip' | 'used' | 'pct' | 'uses'
const [chipsOverallSortDir, setChipsOverallSortDir] = useState('desc');


 const [compareOpen, setCompareOpen] = useState(false);
 const [compareA, setCompareA] = useState(null); // entry_id
 const [compareB, setCompareB] = useState(null); // entry_id
 
 const [comparePicking, setComparePicking] = useState('A'); // which slot is being set
// below: const [comparePicking, setComparePicking] = useState('A');
const [compareSortKey, setCompareSortKey] = useState('pts');   // 'name' | 'pts'
const [compareSortDir, setCompareSortDir] = useState('desc');  // 'asc' | 'desc'

const ptsOf = (p) => {
  const mul = Number(p.mul ?? p.multiplier ?? 1);
  return Number(p.gw_points ?? 0) * Math.max(1, mul);
};

const toggleCompareSort = (key) => {
  setCompareSortDir((prev) =>
    key === compareSortKey ? (prev === 'asc' ? 'desc' : 'asc')
                           : (key === 'name' ? 'asc' : 'desc')
  );
  setCompareSortKey(key);
};

  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [analyticsTab, setAnalyticsTab] = useState('eo'); // 'eo' | 'chips'
  const [eoQuery, setEoQuery] = useState('');

  const [options, setOptions] = useState([]);
  const [selected, setSelected] = useState(null);
  const _leagueLink = isValidLeagueId(selected?.id)
    ? `www.livefpl.net/leagues/${selected.id}`
    : 'www.livefpl.net/leagues';
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [optionsError, setOptionsError] = useState('');

  const [league, setLeague] = useState(null);
  const [leagueLoading, setLeagueLoading] = useState(false);
  const [leagueError, setLeagueError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
// Search + list ref
const [tableQuery, setTableQuery] = useState('');
const listRef = useRef(null);

  const [expanded, setExpanded] = useState(() => new Set());
  const [favs, setFavs] = useState(() => new Set());
  const [autosubs, setAutosubs] = useState(true);

  // --- de-dupe & abort guards ---
  const inflightRef = React.useRef(new Map());         // key -> { promise, controller }
  const lastCallRef = React.useRef({ key: null, ts: 0 });
  const activeKeyRef = React.useRef(null);             // which key is currently active

function isValidLeagueId(v) {
  const s = String(v ?? '').trim();
  return s === 'celebs' || /^\d+$/.test(s);
}

const handleChipsOverallSort = (key) => {
  setChipsOverallSortKey(key);
  setChipsOverallSortDir(prev =>
    key === chipsOverallSortKey ? (prev === 'asc' ? 'desc' : 'asc')
                                : (key === 'chip' ? 'asc' : 'desc'));
};

  const chipsWeekRows = useMemo(() => {
    const rows = Array.isArray(league?.rows) ? league.rows : [];
    const N = rows.length || 1;
    const keys = ['WC', 'BB', 'FH', 'TC'];

    const used = { WC: 0, BB: 0, FH: 0, TC: 0 };
    for (const r of rows) {
      const ac = String(r?.active_chip || '').toUpperCase();
      if (keys.includes(ac)) used[ac] += 1;
    }

    const pctObj = league?.chips_pct || {};
    const out = keys.map((chip) => ({
     chip,
      used: used[chip] || 0,
      pct: Number.isFinite(Number(pctObj[chip])) ? Number(pctObj[chip]) : (used[chip] * 100) / N,
    }));

   out.sort((a, b) => {
      let cmp = chipsSortKey === 'chip'
        ? a.chip.localeCompare(b.chip)
        : (a.pct - b.pct);
      return chipsSortDir === 'asc' ? cmp : -cmp;
    });
    return out;
  }, [league?.rows, league?.chips_pct, chipsSortKey, chipsSortDir]);


  // ── Chips table sort (default: by percent, desc)
  const [chipsSortKey, setChipsSortKey] = useState('pct');
  const [chipsSortDir, setChipsSortDir] = useState('desc');

  // ── EO table sort (default: by EO%, desc)
  const [eoSortKey, setEoSortKey] = useState('eo_pct');
  const [eoSortDir, setEoSortDir] = useState('desc');
  // EO player detail modal state
const [eoDetailOpen, setEoDetailOpen] = useState(false);
const [eoDetailPlayer, setEoDetailPlayer] = useState(null); // { id, name, groups: { tc:[], c:[], started:[], bench:[] } }


  const pctStr = (n) => {
    const x = Number(n);
    return Number.isFinite(x) ? `${Math.round(x)}%` : '-';
  };
  
const chipsOverallRows = useMemo(() => {
  const rows = Array.isArray(league?.rows) ? league.rows : [];
  const N = rows.length || 1;

  const norm = (x) => String(x || '').toUpperCase();
  const keys = ['WC', 'BB', 'FH', 'TC'];

  // aggregate
  const usedByManagers = { WC: 0, BB: 0, FH: 0, TC: 0 };  // managers who used it at least once
  const totalUses       = { WC: 0, BB: 0, FH: 0, TC: 0 };  // sum of uses (WC can be >1 per mgr)

  for (const r of rows) {
    const used = Array.isArray(r?.used_chips) ? r.used_chips.map(norm) : [];
    if (!used.length) continue;

    // Count WC variants (WC, WC1, WC2...)
    const wcUses = used.filter((c) => c.startsWith('WC')).length;
    if (wcUses > 0) usedByManagers.WC += 1;
    totalUses.WC += wcUses;

    // BB / FH / TC are single-token
    for (const chip of ['BB', 'FH', 'TC']) {
      const uses = used.filter((c) => c === chip).length;
      if (uses > 0) usedByManagers[chip] += 1;
      totalUses[chip] += uses;
    }
  }

  const rowsOut = keys.map((chip) => {
    const used = usedByManagers[chip] || 0;
    const pct  = (used * 100) / N;
    const uses = totalUses[chip] || 0;
    return { chip, used, pct, uses };
  });

  rowsOut.sort((a, b) => {
    let cmp;
    switch (chipsOverallSortKey) {
      case 'chip': cmp = a.chip.localeCompare(b.chip); break;
      case 'used': cmp = a.used - b.used; break;
      case 'uses': cmp = a.uses - b.uses; break;
      default:     cmp = a.pct  - b.pct;  break; // 'pct'
    }
    return chipsOverallSortDir === 'asc' ? cmp : -cmp;
  });

  return rowsOut;
}, [league?.rows, chipsOverallSortKey, chipsOverallSortDir]);

  const chipsRows = useMemo(() => {
    const obj = league?.chips_pct || {};
    const rows = Object.keys(obj).map((chip) => ({ chip, pct: Number(obj[chip] ?? 0) }));
    rows.sort((a, b) => {
      let cmp = chipsSortKey === 'chip'
        ? a.chip.localeCompare(b.chip)
        : (a.pct - b.pct);
      return chipsSortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [league?.chips_pct, chipsSortKey, chipsSortDir]);

  const handleChipsSort = (key) => {
    setChipsSortKey(key);
    setChipsSortDir(prev =>
      key === chipsSortKey ? (prev === 'asc' ? 'desc' : 'asc')
                           : (key === 'chip' ? 'asc' : 'desc'));
  };

  const eoRowsRaw = useMemo(() => {
    const arr = Array.isArray(league?.eo_dict) ? [...league.eo_dict] : [];
    arr.sort((a, b) => {
      const isStr = (eoSortKey === 'name');
      const av = isStr ? String(a.name || '').toLowerCase() : Number(a[eoSortKey] ?? 0);
      const bv = isStr ? String(b.name || '').toLowerCase() : Number(b[eoSortKey] ?? 0);
      let cmp = isStr ? av.localeCompare(bv) : (av - bv);
      return eoSortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [league?.eo_dict, eoSortKey, eoSortDir]);

  const eoRows = useMemo(() => {
    const q = eoQuery.trim().toLowerCase();
    if (!q) return eoRowsRaw;
    return eoRowsRaw.filter(r => String(r.name || '').toLowerCase().includes(q));
  }, [eoRowsRaw, eoQuery]);

  const handleEoSort = (key) => {
    setEoSortKey(key);
    setEoSortDir(prev =>
      key === eoSortKey ? (prev === 'asc' ? 'desc' : 'asc')
                        : (key === 'name' ? 'asc' : 'desc'));
  };

// Rank player "type" (accepts several common fields)
const typeRank = (p) => {
  const t = (p.type ?? p.pos ?? p.position ?? p.element_type ?? '').toString().toLowerCase();
  if (t === 'gk' || t === 'g' || t === '1' || t === 'goalkeeper') return 0;
  if (t === 'def' || t === 'd' || t === '2' || t === 'defender')   return 1;
  if (t === 'mid' || t === 'm' || t === '3' || t === 'midfielder') return 2;
  if (t === 'fwd' || t === 'fw' || t === 'f' || t === '4' || t === 'forward') return 3;
  return 9; // unknown types at the end
};

const nameKey = (p) => String(p?.name ?? '').toLowerCase();

const cmpTypeAlpha = (a, b) => {
  const dt = typeRank(a) - typeRank(b);
  return dt !== 0 ? dt : nameKey(a).localeCompare(nameKey(b));
};

// Sort only non-hidden (priority === 0) and keep the rest after, stable
const sortVisible = (arr, side) => {
  const pri = side === 'A' ? priA : priB;
  const visible = [];
  const hidden  = [];
  for (const p of arr) (pri(p) > 0 ? hidden : visible).push(p);
  visible.sort(cmpTypeAlpha);
  return [...visible, ...hidden];
};

  // Build EO detail buckets for a given player (by id, falls back to name match if id missing)
const buildEoDetail = useCallback((player) => {
  const rows = Array.isArray(league?.rows) ? league.rows : [];
  const pid  = Number(player?.id ?? NaN);
  const pname = String(player?.name ?? '').toLowerCase();

  const groups = { tc: [], c: [], started: [], bench: [] };

  for (const r of rows) {
    const roster = Array.isArray(r?.roster) ? r.roster : [];
    // find matching player in this manager’s roster
    const match = roster.find(p => {
      const pId = Number(p?.id ?? NaN);
      if (Number.isFinite(pid)) return pId === pid;
      return String(p?.name ?? '').toLowerCase() === pname;
    });
    if (!match) continue;

    const role = String(match?.role || '').toLowerCase();         // 'c' | 'v' | 'b' | 's' | ''
    const mul  = Number(match?.multiplier ?? match?.mul ?? 1);     // may be missing in some feeds
    const chip = String(r?.active_chip || '').toUpperCase();       // e.g. 'TC'
    const capNameRow = String(r?.captain || '').toLowerCase();     // manager’s captain (by name)
    const playerName = String(match?.name || '').toLowerCase();

    const bench = role === 'b';
    // some feeds don’t tag the captain in roster; fall back to row.captain name
    const isCaptainByRole = role === 'c';
    const isCaptainByName = !!capNameRow && capNameRow === playerName;
    const isCaptain = isCaptainByRole || isCaptainByName;

    // TC if (a) multiplier ≥ 3 OR (b) active chip is TC for this manager and this player is the captain
    const isTC = isCaptain && (mul >= 3 || chip === 'TC');

    if (bench) {
      groups.bench.push(r.team_name || String(r.entry_id || ''));
    } else if (isTC) {
      groups.tc.push(r.team_name || String(r.entry_id || ''));
    } else if (isCaptain) {
      groups.c.push(r.team_name || String(r.entry_id || ''));
    } else {
      groups.started.push(r.team_name || String(r.entry_id || ''));
    }
  }

  // sort names for determinism
  for (const k of Object.keys(groups)) {
    groups[k].sort((a, b) => String(a).localeCompare(String(b)));
  }

  return {
    id: pid || null,
    name: player?.name || '',
    groups,
  };
}, [league?.rows]);


  // CHANGE this effect that loads saved state:
useEffect(() => {
  (async () => {
    const saved = await AsyncStorage.getItem('selectedLeague');
    if (saved) {
      try { setSelected(JSON.parse(saved)); } catch {}
    } else {
      // No saved default → open Celebs by default
      setSelected(CELEBS_OPTION);
    }

    const favRaw = await AsyncStorage.getItem('favEntries');
    if (favRaw) { try { setFavs(new Set(JSON.parse(favRaw))); } catch {} }

    const as = await AsyncStorage.getItem('autosubs');
    if (as === '0') setAutosubs(false);
        setSelectedLoaded(true);

  })();
}, []);


  useEffect(() => {
  // On FPL ID change: purge celebs caches tied to prior session,
  // but keep the user's last selection if they had one.
  (async () => {
    if (!selectedLoaded) return; // ⛔ wait until we know the saved selection
    try {
      await AsyncStorage.multiRemove([
        'league:celebs:autosubs=0',
        'league:celebs:autosubs=1',
     ]);
      // keep fplData; rank payload may still be for the same user after account switch
    } catch {}
    // If nothing was selected (fresh app), fall back to Celebs
    if (!selected) {
      const next = CELEBS_OPTION;
      setSelected(next);
      await AsyncStorage.setItem('selectedLeague', JSON.stringify(next)).catch(() => {});
    } else {
      // keep current selection; just clear table so a fresh fetch happens
      setLeague(null);
      setExpanded(new Set());
    }
  })();
}, [fplId,selectedLoaded]); 


 useEffect(() => {
  let cancelled = false;
  (async () => {
    if (!fplId) return;
    setLoadingOptions(true);
    setOptionsError('');

    try {
      // Always include Celebs
      let baseOptions = [CELEBS_OPTION];

      // Try to hydrate options from local cache only
      const now = Date.now();
      let payload = null;

      // 1) fplData (written by Rank or earlier loads)
      try {
        const cached = await AsyncStorage.getItem('fplData');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (String(parsed?.id) === String(fplId) && parsed?.data) {
            payload = parsed.data;
          }
        }
      } catch {}

      // 2) fallback to per-ID snapshot saved by Rank
      if (!payload) {
        try {
          const snap = await AsyncStorage.getItem(`latestRankData:${fplId}`);
          if (snap) {
            payload = pickPayload(JSON.parse(snap), fplId);
          }
        } catch {}
      }

      // Map options from whatever we have locally
      if (payload?.options && Array.isArray(payload.options)) {
        const mapped = payload.options.map(([id, name]) => ({
          id: String(id),
          name: String(name),
        }));
        baseOptions = mapped.some(o => o.id === CELEBS_OPTION.id)
          ? mapped
          : [CELEBS_OPTION, ...mapped];
      }

      // Set options immediately from local data
      if (!cancelled) {
        setOptions(baseOptions);
        if (!selected && selectedLoaded) setSelected(CELEBS_OPTION);
      }

      // If Celebs is selected, stop here — no Rank API call
      if (selected?.id === 'celebs') {
        return;
      }

      // Non-Celebs: if we have no payload yet, fetch once to refresh options
      if (!payload) {
        const resp = await smartFetch(
          `https://livefpl-api-489391001748.europe-west4.run.app/LH_api2/${encodeURIComponent(fplId)}`
        );
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();
        const fresh = pickPayload(json, fplId);

        await AsyncStorage.setItem(
          'fplData',
          JSON.stringify({ data: fresh, timestamp: now, id: fplId })
        );

        const mapped = Array.isArray(fresh?.options)
          ? fresh.options.map(([id, name]) => ({ id: String(id), name: String(name) }))
          : [];
        const withCelebs = mapped.some(o => o.id === CELEBS_OPTION.id)
          ? mapped
          : [CELEBS_OPTION, ...mapped];

        if (!cancelled) setOptions(withCelebs);
      }
    } catch (e) {
      if (!cancelled) setOptionsError(e?.message || 'Failed to load your leagues.');
    } finally {
      if (!cancelled) setLoadingOptions(false);
    }
  })();

  return () => { cancelled = true; };
}, [fplId, triggerRefetch, selected?.id]);




  const fetchLeague = useCallback(async (leagueId, { force = false, autosubs = true } = {}) => {
  if (!isValidLeagueId(leagueId)) return;

  const key = `${leagueId}|${autosubs ? 1 : 0}|${fplId}`;
  const now = Date.now();

  // Drop ultra-rapid duplicates for the same key
  if (lastCallRef.current.key === key && (now - lastCallRef.current.ts) < 300) {
    return;
  }
  lastCallRef.current = { key, ts: now };

  // Share the in-flight request if same key already running
  if (inflightRef.current.has(key)) {
    try {
      setLeagueLoading(true);
      await inflightRef.current.get(key).promise;
      return;
    } finally {
      setLeagueLoading(false);
    }
  }

  // Abort previous different request (prevents races)
  if (activeKeyRef.current && activeKeyRef.current !== key) {
    const prev = inflightRef.current.get(activeKeyRef.current);
    if (prev?.controller) prev.controller.abort();
  }
  activeKeyRef.current = key;

  setLeagueError('');
  setLeagueLoading(true);

  const controller = new AbortController();
  const run = (async () => {
    try {
      const cacheKey = `league:${leagueId}:autosubs=${autosubs ? 1 : 0}`;
      const VERSION_URL = 'https://livefpl.us/version.json';
      const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

      // 1) Read cached league (per id + autosubs)
      let cachedObj = null;
      try {
        const raw = await AsyncStorage.getItem(cacheKey);
        if (raw) cachedObj = JSON.parse(raw);
      } catch {}

      const cachedData = cachedObj?.data || null;
      const cachedTs = Number(cachedObj?.timestamp || 0) || 0;
      const cachedGen = Number(cachedObj?.gen);
      const ageMs = now - cachedTs;
      const tooOld = ageMs > TWO_DAYS_MS;

      // 2) Fetch current gen from CDN (lightweight)
      let remoteGen = null;
      try {
        const vres = await fetch(`${VERSION_URL}?t=${Date.now()}`, { cache: 'no-store' });
        if (vres.ok) {
          const vjson = await vres.json();
          const g = Number(vjson?.gen);
          if (Number.isFinite(g)) remoteGen = g;
        }
      } catch {
        // ignore – fallback logic below
      }

      // 3) Decide whether we can serve cache without hitting API
      //    - If >2 days old → must refetch
      //    - Else if we know remoteGen and it equals cachedGen → serve cache
      //    - Else if we *don’t* know remoteGen, but we have non-stale cache and not forcing → serve cache
      if (!force && cachedData && !tooOld) {
        const genKnownAndSame = (remoteGen != null) && (cachedGen === remoteGen);
        const genUnknownButFresh = (remoteGen == null);

        if (genKnownAndSame || genUnknownButFresh) {
          let dataToUse = cachedData;

          // Augment celebs from cached data if needed
          if (String(leagueId) === 'celebs') {
            try {
              dataToUse = await augmentCelebsWithMe(cachedData, { autosubs, myEntryId: fplId });
            } catch {}
          }

          setLeague(dataToUse);
          return; // ✅ no API call
        }
      }

      // 4) Fetch fresh league JSON
      const url =
        String(leagueId) === 'celebs'
          ? `https://livefpl.us/api/celebs_${autosubs ? 1 : 0}.json`
          : `https://livefpl-api-489391001748.europe-west4.run.app/LH_api/leagues/${encodeURIComponent(leagueId)}?autosubs=${autosubs ? 1 : 0}`;

      const resp = await smartFetch(url, { signal: controller.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();

      // 5) Snapshot my row for non-celebs
      if (String(leagueId) !== 'celebs') {
        try {
          let rankPayload = null;
          const raw = await AsyncStorage.getItem('fplData');
          if (raw) {
            try { rankPayload = JSON.parse(raw)?.data || null; } catch {}
          }
          await saveMyLeagueSnapshot(json, fplId, rankPayload);
        } catch { /* non-fatal */ }
      }

      // 6) If celebs, ensure we have rank payload and augment
      let result = json;
      if (String(leagueId) === 'celebs') {
  try {
    let havePayload = false;

    try {
      const raw = await AsyncStorage.getItem('fplData');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (String(parsed?.id) === String(fplId) && parsed?.data) {
          havePayload = true;
        }
      }
    } catch {}

    if (!havePayload && fplId) {
      try {
        const snap = await AsyncStorage.getItem(`latestRankData:${fplId}`);
        if (snap) {
          const parsedSnap = JSON.parse(snap);
          const data = pickPayload(parsedSnap, fplId);
          if (data) {
            await AsyncStorage.setItem(
              'fplData',
              JSON.stringify({ data, timestamp: Date.now(), id: fplId })
            );
            havePayload = true;
          }
        }
      } catch {}
    }

    result = await augmentCelebsWithMe(json, { autosubs, myEntryId: fplId });
  } catch {}
}


      // 7) Set in UI (augmented if celebs)
      setLeague(result);

      // 8) Cache the *raw* server json with the gen we saw from CDN (if any)
      await AsyncStorage.setItem(
        cacheKey,
        JSON.stringify({
          data: json,
          timestamp: Date.now(),
          gen: Number.isFinite(remoteGen) ? remoteGen : cachedGen ?? null,
        })
      );
    } finally {
      const cur = inflightRef.current.get(key);
      if (cur && cur.controller === controller) {
        inflightRef.current.delete(key);
      }
      if (activeKeyRef.current === key) activeKeyRef.current = null;
    }
  })();

  inflightRef.current.set(key, { promise: run, controller });

  try {
    await run;
  } catch (e) {
    if (e?.name !== 'AbortError') {
      setLeagueError(e?.message || 'Failed to load league.');
    }
  } finally {
    setLeagueLoading(false);
  }
}, [fplId]);


 useEffect(() => {
  const unsub = navigation.addListener('focus', () => {
    if (isValidLeagueId(selected?.id)) {
      // Obey refresh rules (no force) → will serve cache when fresh, otherwise refetch.
      fetchLeague(selected.id, { autosubs });
    }
  });
  return unsub;
}, [navigation, selected?.id, autosubs, fetchLeague]);


  useEffect(() => {
    if (isValidLeagueId(selected?.id)) {
      setExpanded(new Set());
      setLeague(null);
      fetchLeague(selected.id, { autosubs });
    }
  }, [selected?.id, autosubs, fetchLeague]);

  const onRefresh = useCallback(async () => {
    if (!isValidLeagueId(selected?.id)) return;
    setRefreshing(true);
    await fetchLeague(selected.id, { autosubs });
    setRefreshing(false);
  }, [selected?.id, autosubs, fetchLeague]);

  const toggleExpanded = (entryId) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(entryId) ? next.delete(entryId) : next.add(entryId);
      return next;
    });
  };

  const toggleFav = async (entryId) => {
    setFavs((prev) => {
      const next = new Set(prev);
      next.has(entryId) ? next.delete(entryId) : next.add(entryId);
      AsyncStorage.setItem('favEntries', JSON.stringify(Array.from(next)));
      return next;
    });
  };

  const selectAndClose = async (obj) => {
    setSelected(obj);
    await AsyncStorage.setItem('selectedLeague', JSON.stringify(obj || {}));
    setOpen(false);
  };

  // ── Sorting state
  const [sortKey, setSortKey] = useState('pos');
  const [sortDir, setSortDir] = useState('asc');
// near other useState hooks
const [selectedLoaded, setSelectedLoaded] = useState(false);

  const getSortVal = (row, key) => {
    switch (key) {
      case 'pos':    return Number(row.rank ?? Number.POSITIVE_INFINITY);
      case 'manager':{
        const s = (row.team_name || row.manager_name || '').toString();
        return s.toLowerCase();
      }
      case 'yet':    return Number(row.yet ?? row.played_rem ?? 0);
      case 'cap':    return (row.captain || '').toString().toLowerCase();
      case 'gw': {
        const net = (row.gw_net != null)
          ? Number(row.gw_net)
          : Number(row.gw_gross ?? row.gwgross ?? row.gw ?? 0) - 
            Number(row.gw_hits ?? row.hits ?? row.hit ?? 0);
        return net;
      }
      case 'total':  return Number(row.total ?? 0);
      default:       return 0;
    }
  };

  const handleSort = (key) => {
    const nextDir =
      sortKey === key ? (sortDir === 'asc' ? 'desc' : 'asc')
                      : (key === 'pos' || key === 'manager' ? 'asc' : 'desc');
    setSortKey(key);
    setSortDir(nextDir);
  };

  const dataSorted = useMemo(() => {
    // 1) filter by search text across team/manager/players (incl. C/VC)
    const q = tableQuery.trim().toLowerCase();
    const base = Array.isArray(league?.rows) ? league.rows : [];
    const rows = (!q ? [...base] : base.filter((row) => {
      const team = String(row?.team_name || '').toLowerCase();
      const mgr  = String(row?.manager_name || '').toLowerCase();
      const cap  = String(row?.captain || '').toLowerCase();
      const vice = String(row?.vice || '').toLowerCase();
      const roster = Array.isArray(row?.roster) ? row.roster : [];
      if (team.includes(q) || mgr.includes(q) || cap.includes(q) || vice.includes(q)) return true;
      // search players in roster (names)
      for (const p of roster) {
        if (String(p?.name || '').toLowerCase().includes(q)) return true;
      }
      return false;
    }));
    rows.sort((a, b) => {
      const av = getSortVal(a, sortKey);
      const bv = getSortVal(b, sortKey);
      const bothNum = typeof av === 'number' && typeof bv === 'number';
      let cmp = bothNum ? (av - bv) : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [league?.rows, sortKey, sortDir,tableQuery]);

  // Hide "Yet" if every entry is 0
  let showYet = useMemo(() => {
    return false;
    const rows = league?.rows || [];
    if (!rows.length) return true; // show by default while loading/empty
    return rows.some(r => Number(r?.yet ?? r?.played_rem ?? 0) > 0);
  }, [league?.rows]);
  
  // Rebalance widths when Yet is hidden (steal its width and give to Manager + GW)
  const COLS = useMemo(() => {
    if (showYet) return COL;
    return {
      ...COL,
      yet: 0,
      manager: COL.manager + 7, // take some of Yet's 9%
      gw:      COL.gw + 2,      // …and a bit to GW
    };
  }, [showYet]);

  const onShareLeague = useCallback(() => {
    if (!selected?.id) return;
    Share.share({ message: `LiveFPL League: ${_leagueLink}` }).catch(() => {});
  }, [selected?.id, _leagueLink]);

const scrollToIndexSafe = (index) => {
  if (!listRef.current || index < 0) return;
  try {
    listRef.current.scrollToIndex({ index, viewPosition: 0.5, animated: true });
  } catch {
    // fallback: approximate offset if measurement missing
    listRef.current.scrollToOffset({ offset: Math.max(0, index * 64 - 120), animated: true });
  }
};

const scrollToFirst = (predicate) => {
  const rows = dataSorted || [];
  const idx = rows.findIndex(predicate);
  if (idx < 0) return;

  // Ensure the target row is expanded
  const row = rows[idx];
  const id = getEntryId(row);
  setExpanded((prev) => {
    const next = new Set(prev);
    next.add(id);            // make sure it's open (idempotent)
    return next;
  });

  // Scroll after the list re-renders with the expanded row
  setTimeout(() => scrollToIndexSafe(idx), 30);
};


const scrollToMe = () => {
  scrollToFirst((r) => Number(r?.entry_id ?? r?.entry ?? r?.id) === Number(fplId));
};

// Fuzzy jump by team/manager name (used by EO modal)
const scrollToManagerByName = (name) => {
  const q = String(name || '').trim().toLowerCase();
  if (!q) return;
  scrollToFirst((r) => {
    const team = String(r?.team_name || '').toLowerCase();
    const mgr  = String(r?.manager_name || '').toLowerCase();
    return team === q || mgr === q;
  });
};

  const header = useMemo(() => {
    if (!league) return null;
    const Caret = ({active}) => active ? <Text style={S.sortCaret}>{sortDir==='asc' ? '▲' : '▼'}</Text> : null;

    return (
      <View style={S.stickyWrap}>
       

        <View style={S.thead}>
          <Text style={S.theadTitle}>
            {league.league_name ?? 'League'}
            {league.gameweek ? ` — Live Gameweek ${league.gameweek} Table` : ''}
          </Text>
          <View style={{ alignItems: 'center', marginTop: 2 }}>
  <Text style={S.theadTitle2}>
  Full downloadable league analysis at{' '}
  <Text
    style={[S.leagueLinkLine, { textDecorationLine: 'underline' }]}
    onPress={() => Linking.openURL(`https://${_leagueLink}`)}
  >
    {_leagueLink}
  </Text>
</Text>

</View>


          <View style={S.colHeadRow}>
            <View style={[S.thCell, S.thCenter, { width: toPct(COLS.pos) }]}>
              <Pressable style={S.thPress} onPress={() => handleSort('pos')}>
                <Text style={[S.th, sortKey==='pos' && S.thActive]}>Pos</Text>
                <Caret active={sortKey==='pos'} />
              </Pressable>
            </View>

            <View style={[S.thCell, S.thStart, { width: toPct(COLS.manager) }]}>
              <Pressable style={S.thPress} onPress={() => handleSort('manager')}>
                <Text style={[S.th, sortKey==='manager' && S.thActive]}>Manager</Text>
                <Caret active={sortKey==='manager'} />
              </Pressable>
            </View>

            {showYet && (
              <View style={[S.thCell, S.thCenter, { width: toPct(COLS.yet) }]}>
                <Pressable style={S.thPress} onPress={() => handleSort('yet')}>
                  <Text style={[S.th, sortKey==='yet' && S.thActive]}>Yet</Text>
                  <Caret active={sortKey==='yet'} />
                </Pressable>
              </View>
            )}

            <View style={[S.thCell, S.thCenter, { width: toPct(COLS.cap) }]}>
              <Pressable style={S.thPress} onPress={() => handleSort('cap')}>
                <Text style={[S.th, sortKey==='cap' && S.thActive]}>(C)</Text>
                <Caret active={sortKey==='cap'} />
              </Pressable>
            </View>

            <View style={[S.thCell, S.thCenter, { width: toPct(COLS.gw) }]}>
              <Pressable style={S.thPress} onPress={() => handleSort('gw')}>
                <Text style={[S.th, sortKey==='gw' && S.thActive]}>GW</Text>
                <Caret active={sortKey==='gw'} />
              </Pressable>
            </View>

            <View style={[S.thCell, S.thCenter, { width: toPct(COLS.total) }]}>
              <Pressable style={S.thPress} onPress={() => handleSort('total')}>
                <Text style={[S.th, sortKey==='total' && S.thActive]}>Total</Text>
                <Caret active={sortKey==='total'} />
              </Pressable>
            </View>
          </View>

          {leagueLoading && (
            <View style={S.loadingBar}>
              <ActivityIndicator size="small" color={C.accent} />
              <Text style={S.loadingTxt}>Loading data…</Text>
            </View>
          )}
        </View>
      </View>
    );
  }, [league, sortKey, sortDir, S, _leagueLink, leagueLoading]);

  const onToggleAutosubs = async (val) => {
    if (!showYet) return;
    setAutosubs(val);
    await AsyncStorage.setItem('autosubs', val ? '1' : '0');
    if (isValidLeagueId(selected?.id)) {
      fetchLeague(selected.id, { autosubs: val, force: true });
    }
  };

const getEntryId = (r) => Number(r?.entry_id ?? r?.entry ?? r?.id);

  const renderRow = useCallback(({ item }) => {
    const getEntryId = (r) => Number(r?.entry_id ?? r?.entry ?? r?.id);
    const me = Number(fplId) === getEntryId(item);
    const isFav = favs.has(item.entry_id);
    const isExpanded = expanded.has(item.entry_id);
    return (
      <LeagueRow
        row={item}
        me={me}
        fav={isFav}
        expanded={isExpanded}
        onToggle={() => toggleExpanded(item.entry_id)}
        onFav={() => toggleFav(item.entry_id)}
        C={C}
        isDark={isDark}
        S={S}
        showYet={showYet}
        cols={COLS}
      />
    );
  }, [fplId, favs, expanded, C, isDark, S, showYet, COLS]);

  // abort anything still in flight on unmount
  useEffect(() => {
    return () => {
      inflightRef.current.forEach(({ controller }) => controller?.abort());
      inflightRef.current.clear();
    };
  }, []);

  if (!fplId) {
    return (
      <View style={[S.center, { paddingTop: 50 }]}>
        <Text style={S.muted}>Set your FPL ID first.</Text>
      </View>
    );
  }

  return (
    
    <View style={S.page}>
      <AppHeader 
      bannerText="Full league analysis & awards at" bannerLink={_leagueLink}
      />
      <View style={{paddingHorizontal: 10}}>

      {/* === Toolbar: Select | Settings Cog | EO & Chips | Share === */}
      <View style={[S.toolbarRow, { marginTop: 8, alignItems: 'center' }]}>
        <Pressable style={[S.select, { flex: 1 }]} onPress={() => setOpen(true)}>
          <Text style={[S.selectText, !selected && S.placeholder]}>
            {selected?.name ?? 'Select a league'}
          </Text>
          <MaterialCommunityIcons name="chevron-down" size={18} color={C.muted} />
        </Pressable>
    

        {/* Settings */}
        <TouchableOpacity
          style={S.iconBtn}
          onPress={() => setSettingsOpen(true)}
          activeOpacity={0.7}
          accessibilityLabel="Settings"
        >
          <MaterialCommunityIcons name="cog" size={18} color={C.ink} />
        </TouchableOpacity>

        {/* Analytics */}
        {league && (
          <TouchableOpacity
            style={S.iconBtn}
            onPress={() => setAnalyticsOpen(true)}
            activeOpacity={0.7}
            accessibilityLabel="League analytics (EO & Chips)"
          >
            <MaterialCommunityIcons name="chart-box-outline" size={18} color={C.ink} />
          </TouchableOpacity>
        )}

        {league && (
          <TouchableOpacity
            style={S.iconBtn}
            onPress={() => {
              // preselect “me” and the top row if available
              const rows = league?.rows || [];
              const meRow = rows.find(r => Number(r.entry_id) === Number(fplId));
              const topRow = rows[0];
              setCompareA(meRow?.entry_id ?? topRow?.entry_id ?? null);
              const other = rows.find(r => r.entry_id !== (meRow?.entry_id ?? topRow?.entry_id));
             setCompareB(other?.entry_id ?? null);
              setComparePicking('A');
              setCompareOpen(true);
            }}
activeOpacity={0.7}
            accessibilityLabel="Compare two teams"
          >
            <MaterialCommunityIcons name="scale-balance" size={18} color={C.ink} />
          </TouchableOpacity>
        )}

        {/* Share */}
        {selected?.id && (
          <TouchableOpacity
            style={[S.iconBtn,{display:'none'}]}
            onPress={onShareLeague}
            activeOpacity={0.7}
            accessibilityLabel="Share league"
          >
            <MaterialCommunityIcons name="share-variant" size={18} color={C.ink} />
          </TouchableOpacity>
        )}
      </View>
      {/* === Search row (new line under the buttons) === */}
<View style={[S.toolbarRow, { marginTop: 2, alignItems: 'center' }]}>
  <View style={{ flex: 1 }}>
  <ThemedTextInput
  value={tableQuery}
  onChangeText={setTableQuery}
  placeholder="Search league…"
  placeholderTextColor={C.muted}
  multiline={false}
  textAlignVertical="center"               // Android vertical centering
  style={[
    S.searchInputInline,
    { paddingTop: 9, paddingBottom: 9, lineHeight: 14 }  // keep compact height
    // 🔴 remove lineHeight: 36
  ]}
  returnKeyType="search"
/>

</View>


  <TouchableOpacity
    style={S.findBtn}
    onPress={scrollToMe}
    activeOpacity={0.7}
    accessibilityLabel="Find my row"
  >
    <Text style={S.findBtnText}>Find me</Text>
  </TouchableOpacity>
  
</View>




      {/* League picker modal */}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={S.overlay}>
          <View style={S.sheet}>
            <Text style={S.sheetTitle}>Choose league</Text>
            {loadingOptions ? (
              <View style={S.centerRow}><ActivityIndicator color={C.accent} /><Text style={[S.muted, { marginLeft: 8 }]}>Loading…</Text></View>
            ) : optionsError ? (
              <Text style={S.error}>{optionsError}</Text>
            ) : (
              <FlatList
                data={options}
                keyExtractor={(x) => x.id}
                style={{ maxHeight: 500 }}
                
                renderItem={({ item }) => (
                  <TouchableOpacity style={S.optItem} onPress={() => selectAndClose(item)} activeOpacity={0.6}>
                    <Text style={S.optText}>{item.name}</Text>
                    {selected?.id === item.id && <MaterialCommunityIcons name="check" size={18} color={C.ink} />}
                  </TouchableOpacity>
                )}
              />
            )}
            <View style={{ alignItems: 'flex-end', marginTop: 8 }}>
              <TouchableOpacity onPress={() => setOpen(false)}><Text style={S.link}>Cancel</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Settings modal */}
      <Modal visible={settingsOpen} transparent animationType="fade" onRequestClose={() => setSettingsOpen(false)}>
        <View style={S.overlay}>
          <View style={S.settingsSheet}>
            <View style={S.analyticsHeaderRow}>
              <Text style={S.analyticsTitle}>Settings</Text>
              <TouchableOpacity onPress={() => setSettingsOpen(false)}>
                <Text style={S.link}>Close</Text>
              </TouchableOpacity>
            </View>

            {/* Autosubs */}
            <View style={S.settingRow}>
              <View style={S.settingLabelCol}>
                <Text style={S.settingLabel}>Autosubs</Text>
                <Text style={S.settingHint}>Apply autosubs to live points in league rows.</Text>
              </View>
              <Switch
                value={autosubs}
                onValueChange={onToggleAutosubs}
                trackColor={{ false: C.border2, true: C.accent }}
                thumbColor={autosubs ? (isDark ? '#052e16' : '#ffffff') : (isDark ? C.ink : '#e2e8f0')}
                style={S.autoSwitch}
                disabled={!showYet}
              />
            </View>

            {/* Glossary */}
            <Text style={[S.tableTitle, { marginTop: 12 }]}>Glossary</Text>
            {[
              ['EO', 'Effective ownership within this league for a player.'],
              ['OR', 'Live Overall Rank (as calculated by LiveFPL).'],
              ['FT', 'Free Transfers Left.'],
              ['TV', 'Team Value (At deadline time).'],
              ['Yet', 'Players left to play (captain counts twice).'],
              ['WC', 'Wildcard.'],
              ['FH', 'Free Hit.'],
              ['BB', 'Bench Boost.'],
              ['TC', 'Triple Captain.'],
            ].map(([k, v]) => (
              <View style={S.bulletRow} key={k}>
                <Text style={S.bulletDot}>•</Text>
                <Text style={S.bulletText}><Text style={{ fontWeight: '800' }}>{k}</Text>: {v}</Text>
              </View>
            ))}
          </View>
        </View>
      </Modal>

      {/* Analytics modal (segmented + EO search) */}
      <Modal visible={analyticsOpen} transparent animationType="fade" onRequestClose={() => setAnalyticsOpen(false)}>
        <View style={S.overlay}>
          <View style={S.analyticsSheet}>
            <View style={S.analyticsHeaderRow}>
              <Text style={S.analyticsTitle}>League analytics</Text>
              <TouchableOpacity onPress={() => setAnalyticsOpen(false)}>
                <Text style={S.link}>Close</Text>
              </TouchableOpacity>
            </View>

            {/* Segmented tabs */}
            <View style={S.segmentRow}>
              <Pressable
                style={[S.segment, analyticsTab==='eo' && S.segmentActive]}
                onPress={() => setAnalyticsTab('eo')}
              >
                <Text style={[S.segmentTxt, analyticsTab==='eo' && S.segmentTxtActive]}>EO</Text>
              </Pressable>
              <Pressable
                style={[S.segment, analyticsTab==='chips' && S.segmentActive]}
                onPress={() => setAnalyticsTab('chips')}
              >
                <Text style={[S.segmentTxt, analyticsTab==='chips' && S.segmentTxtActive]}>Chips</Text>
              </Pressable>
            </View>

            {analyticsTab === 'chips' ? (
              <>
                <Text style={S.tableTitle}>Chips usage this week (%)</Text>
<View style={S.tableHeaderRow}>
  <Pressable style={[S.headCell, { flex: 2 }]} onPress={() => handleChipsSort('chip')}>
    <Text style={[S.headTxt, chipsSortKey === 'chip' && S.headActive]}>Chip</Text>
    {chipsSortKey === 'chip' && <Text style={S.sortCaretSm}>{chipsSortDir==='asc'?'▲':'▼'}</Text>}
  </Pressable>
  <View style={[S.headCell, S.headNum, { flex: 1 }]}>
    <Text style={S.headTxt}>Managers used</Text>
  </View>
  <Pressable style={[S.headCell, S.headNum, { flex: 1 }]} onPress={() => handleChipsSort('pct')}>
    <Text style={[S.headTxt, chipsSortKey === 'pct' && S.headActive]}>Pct</Text>
    {chipsSortKey === 'pct' && <Text style={S.sortCaretSm}>{chipsSortDir==='asc'?'▲':'▼'}</Text>}
  </Pressable>
</View>

                <FlatList
                  data={chipsWeekRows}
                  keyExtractor={(x) => x.chip}
                  style={S.tableList}
                  renderItem={({ item }) => (
                    <View style={S.row}>
                      <Text style={[S.cell, { flex: 2 }]}>{item.chip}</Text>
        <Text style={[S.cell, S.cellNum, { flex: 1 }]}>{item.used}</Text>
        <Text style={[S.cell, S.cellNum, { flex: 1 }]}>{pctStr(item.pct)}</Text>
                    </View>
                    
                  )}
                  
                />
                <View style={{ height: 12 }} />

<Text style={S.tableTitle}>Overall chip usage (season)</Text>
<View style={S.tableHeaderRow}>
  <Pressable style={[S.headCell, { flex: 2 }]} onPress={() => handleChipsOverallSort('chip')}>
    <Text style={[S.headTxt, chipsOverallSortKey === 'chip' && S.headActive]}>Chip</Text>
    {chipsOverallSortKey === 'chip' && <Text style={S.sortCaretSm}>{chipsOverallSortDir==='asc'?'▲':'▼'}</Text>}
  </Pressable>
  <Pressable style={[S.headCell, S.headNum, { flex: 1 }]} onPress={() => handleChipsOverallSort('used')}>
    <Text style={[S.headTxt, chipsOverallSortKey === 'used' && S.headActive]}>Managers used</Text>
    {chipsOverallSortKey === 'used' && <Text style={S.sortCaretSm}>{chipsOverallSortDir==='asc'?'▲':'▼'}</Text>}
  </Pressable>
  <Pressable style={[S.headCell, S.headNum, { flex: 1 }]} onPress={() => handleChipsOverallSort('pct')}>
    <Text style={[S.headTxt, chipsOverallSortKey === 'pct' && S.headActive]}>Pct</Text>
    {chipsOverallSortKey === 'pct' && <Text style={S.sortCaretSm}>{chipsOverallSortDir==='asc'?'▲':'▼'}</Text>}
  </Pressable>
  
</View>

<FlatList
  data={chipsOverallRows}
  keyExtractor={(x) => x.chip}
  style={S.tableList}
  renderItem={({ item }) => (
    <View style={S.row}>
      <Text style={[S.cell, { flex: 2 }]}>{item.chip}</Text>
      <Text style={[S.cell, S.cellNum, { flex: 1 }]}>{item.used}</Text>
      <Text style={[S.cell, S.cellNum, { flex: 1 }]}>{pctStr(item.pct)}</Text>
      
    </View>
  )}
/>

              </>
            ) : (
              <>
                <Text style={S.tableTitle}>Player EO & captains (%)</Text>
                <Text style={[S.muted, { fontSize: 11, marginTop: -2, marginBottom: 6 }]}>
    Tip: tap the group icon next to a player to see which managers started, captained, triple-captained, or benched him.
  </Text>

                {/* EO search */}
                <ThemedTextInput
                  value={eoQuery}
                  onChangeText={setEoQuery}
                  placeholder="Search player…"
                  placeholderTextColor={C.muted}
                  style={S.searchInput}
                />

                <View style={S.tableHeaderRow}>
                  <Pressable style={[S.headCell, { flex: 2 }]} onPress={() => handleEoSort('name')}>
                    <Text style={[S.headTxt, eoSortKey === 'name' && S.headActive]}>Player</Text>
                    {eoSortKey === 'name' && <Text style={S.sortCaretSm}>{eoSortDir==='asc'?'▲':'▼'}</Text>}
                  </Pressable>

                  {[
                    ['own_pct', 'Own'],
                    ['s_pct', 'Start'],
                    ['c_pct', '(C)'],
                    ['tc_pct', '(TC)'],
                    ['eo_pct', 'EO'],
                  ].map(([key, label]) => (
                    <Pressable key={key} style={[S.headCell, S.headNum]} onPress={() => handleEoSort(key)}>
                      <Text style={[S.headTxt, eoSortKey === key && S.headActive]}>{label}</Text>
                      {eoSortKey === key && <Text style={S.sortCaretSm}>{eoSortDir==='asc'?'▲':'▼'}</Text>}
                    </Pressable>
                  ))}
                </View>

                <FlatList
                  data={eoRows}
                  keyExtractor={(x) => String(x.id)}
                  style={S.tableList}
                  renderItem={({ item }) => (
  <View style={S.row}>
    <View style={[S.cell, { flex: 2, flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
      <Text numberOfLines={1} style={{ color: C.ink }}>{item.name}</Text>
      <TouchableOpacity
        onPress={() => {
          const detail = buildEoDetail(item);
          setEoDetailPlayer(detail);
          setEoDetailOpen(true);
        }}
        style={S.eoInfoBtn}
        activeOpacity={0.7}
        accessibilityLabel={`Who has ${item.name}?`}
      >
        <MaterialCommunityIcons
          name="account-multiple-outline"
          size={14}
          color={C.muted}
        />
      </TouchableOpacity>
    </View>

    <Text style={[S.cell, S.cellNum]}>{pctStr(item.own_pct)}</Text>
    <Text style={[S.cell, S.cellNum]}>{pctStr(item.s_pct)}</Text>
    <Text style={[S.cell, S.cellNum]}>{pctStr(item.c_pct)}</Text>
    <Text style={[S.cell, S.cellNum]}>{pctStr(item.tc_pct)}</Text>
    <Text style={[S.cell, S.cellNum]}>{pctStr(item.eo_pct)}</Text>
  </View>
)}

                />
              </>
            )}
          </View>

           {eoDetailOpen && (
   <>
     {/* Backdrop that closes the panel */}
     <Pressable
       onPress={() => setEoDetailOpen(false)}
       style={S.eoInnerBackdrop}
     />
     {/* EO detail card */}
     <View style={S.eoDetailCard}>
       <View style={S.analyticsHeaderRow}>
         <Text style={S.analyticsTitle}>
           {eoDetailPlayer?.name ? `Managers for ${eoDetailPlayer.name}` : 'Managers'}
         </Text>
         <TouchableOpacity onPress={() => setEoDetailOpen(false)}>
           <Text style={S.link}>Close</Text>
         </TouchableOpacity>
       </View>


       {/* Total managers in this league */}
<View style={S.eoTotalsRow}>
  <Text style={S.eoTotalsText}>
    Total managers in league: {Array.isArray(league?.rows) ? league.rows.length : 0}
  </Text>
</View>



       {eoDetailPlayer ? (
         <>
           {/* Quick counts row */}
           <View style={S.eoCountsRow}>
             <View style={S.eoCountPill}><Text style={S.eoCountKey}>TC</Text><Text style={S.eoCountVal}>{eoDetailPlayer.groups.tc.length}</Text></View>
             <View style={S.eoCountPill}><Text style={S.eoCountKey}>(C)</Text><Text style={S.eoCountVal}>{eoDetailPlayer.groups.c.length}</Text></View>
             <View style={S.eoCountPill}><Text style={S.eoCountKey}>Started</Text><Text style={S.eoCountVal}>{eoDetailPlayer.groups.started.length}</Text></View>
             <View style={S.eoCountPill}><Text style={S.eoCountKey}>Benched</Text><Text style={S.eoCountVal}>{eoDetailPlayer.groups.bench.length}</Text></View>
           </View>

           <ScrollView
  style={{ flex: 1 }}
  contentContainerStyle={{ paddingBottom: 6 }}
  nestedScrollEnabled
  keyboardShouldPersistTaps="handled"
>

             {[
               ['tc', 'Triple captained'],
               ['c', 'Captained'],
               ['started', 'Started (not captain)'],
               ['bench', 'Benched'],
             ].map(([k, title]) => (
               <View key={`eo-${k}`} style={{ marginTop: 10 }}>
                 <Text style={S.eoGroupTitle}>{title} — {eoDetailPlayer.groups[k].length}</Text>
                 {eoDetailPlayer.groups[k].length ? (
                   eoDetailPlayer.groups[k].map((name, i) => (
                     <TouchableOpacity
  key={`${k}-${i}`}
  style={S.eoManagerItem}
  onPress={() => {
    setEoDetailOpen(false);
    setAnalyticsOpen(false);
    scrollToManagerByName(name);
  }}
  activeOpacity={0.7}
  accessibilityLabel={`Go to ${name} in the table`}
>
  <MaterialCommunityIcons name="account-outline" size={14} color={C.muted} />
  <Text numberOfLines={1} style={[S.eoManagerName, { textDecorationLine: 'underline', color: C.accent }]}>
    {name}
  </Text>
</TouchableOpacity>

                   ))
                 ) : (
                   <Text style={S.muted}>— none —</Text>
                 )}
               </View>
             ))}
             <View style={{ height: 6 }} />
           </ScrollView>
         </>
       ) : (
         <Text style={S.muted}>No data.</Text>
       )}
     </View>
   </>
 )}

        </View>
      </Modal>



      {/* Compare modal */}
<Modal
  visible={compareOpen}
  transparent
  animationType="fade"
  onRequestClose={() => setCompareOpen(false)}
>
<View style={S.overlay}>
  <View
    style={[
      S.compareSheet,
      { maxHeight: Math.min(640, height * 0.85) } // NEW: responsive cap
    ]}
  >
    
      <View style={S.analyticsHeaderRow}>
        <Text style={S.analyticsTitle}>Compare teams</Text>
        <TouchableOpacity onPress={() => setCompareOpen(false)}>
          <Text style={S.link}>Close</Text>
        </TouchableOpacity>
      </View>
<ScrollView
      style={{ flexGrow: 0 }}
        contentContainerStyle={{ paddingBottom: 8, flexGrow: 1 }}  // allow vertical growth

      
      keyboardShouldPersistTaps="handled"
      nestedScrollEnabled
    >
    {/* Backdrop to close dropdowns – only when open, sits UNDER the dropdowns */}
{(openA || openB) && (
  <Pressable
    onPress={() => { setOpenA(false); setOpenB(false); }}
    style={{
      position: 'absolute',
      left: 0, right: 0, top: 0, bottom: 0,
      zIndex: 1,           // backdrop layer
    }}
    pointerEvents="auto"
  />
)}


     {/* Pickers */}
<View style={S.comparePickRow}>
  <View style={S.comparePickCol}>
    <Text style={S.comparePickLabel}>Team A</Text>
    <Pressable
      onPress={() => {
        setOpenA((v) => !v);
        setOpenB(false);
        setComparePicking('A');
      }}
      style={[S.select, { justifyContent:'space-between' }]}
    >
      <Text style={S.selectText}>
        {league?.rows?.find(r => r.entry_id === compareA)?.manager_name || 'Select…'}
      </Text>
      <MaterialCommunityIcons name={openA ? 'chevron-up' : 'chevron-down'} size={18} color={C.muted} />
    </Pressable>

    {openA && (
      <View style={S.dropdown}>
        <FlatList
          data={league?.rows ?? []}
          keyExtractor={(x) => String(x.entry_id)}
          
          nestedScrollEnabled
          keyboardShouldPersistTaps="always"
      showsVerticalScrollIndicator
          style={S.dropdownList}
          renderItem={({ item }) => {
            const isChosen = item.entry_id === compareA;
            return (
              <TouchableOpacity
                onPress={() => {
                  setCompareA(item.entry_id);
                  setOpenA(false);
                }}
                activeOpacity={0.7}
                style={S.dropdownItem}
              >
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={[S.optText, { fontWeight: '800' }]} numberOfLines={1}>
                    {item.manager_name}
                  </Text>
                  <Text style={[S.muted, { fontSize: 11 }]} numberOfLines={1}>
                    {item.team_name}
                  </Text>
                </View>
                {isChosen && (
                  <MaterialCommunityIcons name="check" size={18} color={C.accent} />
                )}
              </TouchableOpacity>
            );
          }}
        />
      </View>
    )}
  </View>

  <View style={S.comparePickCol}>
    <Text style={S.comparePickLabel}>Team B</Text>
    <Pressable
      onPress={() => {
        setOpenB((v) => !v);
        setOpenA(false);
        setComparePicking('B');
      }}
      style={[S.select, { justifyContent:'space-between' }]}
    >
      <Text style={S.selectText}>
        {league?.rows?.find(r => r.entry_id === compareB)?.manager_name || 'Select…'}
      </Text>
      <MaterialCommunityIcons name={openB ? 'chevron-up' : 'chevron-down'} size={18} color={C.muted} />
    </Pressable>

    {openB && (
      <View style={S.dropdown}>
        <FlatList
          data={league?.rows ?? []}
          keyExtractor={(x) => String(x.entry_id)}
         
          nestedScrollEnabled
          keyboardShouldPersistTaps="always"
      showsVerticalScrollIndicator
          style={S.dropdownList}
          renderItem={({ item }) => {
            const isChosen = item.entry_id === compareB;
            return (
              <TouchableOpacity
                onPress={() => {
                  setCompareB(item.entry_id);
                  setOpenB(false);
                }}
                activeOpacity={0.7}
                style={S.dropdownItem}
              >
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={[S.optText, { fontWeight: '800' }]} numberOfLines={1}>
                    {item.manager_name}
                  </Text>
                  <Text style={[S.muted, { fontSize: 11 }]} numberOfLines={1}>
                    {item.team_name}
                  </Text>
                </View>
                {isChosen && (
                  <MaterialCommunityIcons name="check" size={18} color={C.accent} />
                )}
              </TouchableOpacity>
            );
          }}
        />
      </View>
    )}
  </View>
</View>


      {/* Results */}
      {(() => {
        const A = league?.rows?.find(r => r.entry_id === compareA);
        const B = league?.rows?.find(r => r.entry_id === compareB);
        if (!A || !B) return null;

        const starters = (r) => (Array.isArray(r.roster)? r.roster:[]).filter(p => p.role !== 'b');
        const bench    = (r) => (Array.isArray(r.roster)? r.roster:[]).filter(p => p.role === 'b');
        // Before:
// const keyOf = (p) => String(p?.id ?? p?.name ?? '');

// After — captain/TC are treated as a different key:
const keyOf = (p) => {
  const base = String(p?.id ?? p?.name ?? '');
  const role = String(p?.role || '').toLowerCase();
  const mul  = Number(p?.multiplier ?? p?.mul ?? 1);
  const isCap = role === 'c' || mul >= 2; // includes TC (mul ≥ 3)
  return isCap ? `${base}#C` : base;
};


        const aStar = starters(A), bStar = starters(B);
        const aBench = bench(A),   bBench = bench(B);

        const setBStar = new Set(bStar.map(keyOf));
        const setAStar = new Set(aStar.map(keyOf));

        

        // priority: 0 = different starter (visible), 1 = shared starter (muted), 2 = bench (muted)
const priA = (p) => (p.role === 'b' ? 2 : (setBStar.has(keyOf(p)) ? 1 : 0));
const priB = (p) => (p.role === 'b' ? 2 : (setAStar.has(keyOf(p)) ? 1 : 0));

const applyCompareSort = (arr, priFn) => {
  const withPri = arr.map((p) => ({ p, pri: priFn(p) }));
  const visible = withPri.filter(x => x.pri === 0).map(x => x.p);
  const hidden  = withPri.filter(x => x.pri > 0)   // keep shared starters above bench
                         .sort((a,b) => a.pri - b.pri)
                         .map(x => x.p);

  visible.sort((a, b) => {
    let cmp;
    if (compareSortKey === 'name') {
      cmp = String(a.name || '').localeCompare(String(b.name || ''));
    } else {
      cmp = ptsOf(a) - ptsOf(b); // 'pts'
    }
    return compareSortDir === 'asc' ? cmp : -cmp;
  });

  return [...visible, ...hidden];
};

const listA = applyCompareSort([...aStar, ...aBench], priA);
const listB = applyCompareSort([...bStar, ...bBench], priB);


      const playerRow = (p, side) => {
  const priority = side === 'A' ? priA(p) : priB(p);
  const muted = priority > 0;
  const isBench = p.role === 'b';

  // minimal captain handling
  const mult = Math.max(
    1,
    Number(p?.multiplier ?? (String(p?.role || '').toLowerCase() === 'c' ? 2 : 1))
  );
  const name =
    mult >= 3 ? `${p.name} (TC)` :
    mult === 2 ? `${p.name} (C)`  :
    p.name;

  return (
    <View key={`${side}-${keyOf(p)}`} style={S.cRow}>
      <Text numberOfLines={1} style={[S.cName, muted && S.cMuted, isBench && S.cBench]}>
        {name}
      </Text>
      <Text style={[S.cPts, muted && S.cMuted]}>
        {Number(p?.gw_points ?? 0) * mult}
      </Text>
    </View>
  );
};


        return (
          <View style={S.compareResultWrap}>
            {/* Headers: manager/chip/score/total/rank */}
            <View style={S.cMetaRow}>
              <View style={S.cMetaCol}>
                <Text style={S.cMetaTitle}>{A.manager_name}</Text>
                <Text style={S.cMetaSub}>Chip: {A.active_chip || '-'}</Text>
                <Text style={S.cMetaSub}>
                  GW: {(A.gw_gross ?? 0)}{A.gw_hits ? ` (${A.gw_hits > 0 ? `+${A.gw_hits}` : A.gw_hits})` : ''}
                </Text>
                <Text style={S.cMetaSub}>Total: {A.total ?? 0}</Text>
                <Text style={S.cMetaSub}>League Rank: {A.rank ?? '-'}</Text>
                 <Text style={S.cMetaSub}>
  OR: {A.overall_rank != null ? compactNumber(A.overall_rank) : '-'}
</Text>
              </View>
              <View style={S.cMetaCol}>
                <Text style={S.cMetaTitle}>{B.manager_name}</Text>
                <Text style={S.cMetaSub}>Chip: {B.active_chip || '-'}</Text>
                <Text style={S.cMetaSub}>
                  GW: {(B.gw_gross ?? 0)}{B.gw_hits ? ` (${B.gw_hits > 0 ? `+${B.gw_hits}` : B.gw_hits})` : ''}
                </Text>
                <Text style={S.cMetaSub}>Total: {B.total ?? 0}</Text>
                <Text style={S.cMetaSub}>League Rank: {B.rank ?? '-'}</Text>
               
…
<Text style={S.cMetaSub}>
  OR: {B.overall_rank != null ? compactNumber(B.overall_rank) : '-'}
</Text>
              </View>
            </View>

            {/* Players side by side */}
            <View style={S.cTable}>
  <View style={S.cCol}>
    {/* thead */}
    <View style={S.tableHeaderRow}>
      <Pressable
        style={[S.headCell, { flex: 2 }]}
        onPress={() => toggleCompareSort('name')}
      >
        <Text style={[S.headTxt, compareSortKey === 'name' && S.headActive]}>
          Player
        </Text>
        {compareSortKey === 'name' && (
          <Text style={S.sortCaretSm}>{compareSortDir === 'asc' ? '▲' : '▼'}</Text>
        )}
      </Pressable>
      <Pressable
        style={[S.headCell, S.headNum]}
        onPress={() => toggleCompareSort('pts')}
      >
        <Text style={[S.headTxt, compareSortKey === 'pts' && S.headActive]}>
          Pts
        </Text>
        {compareSortKey === 'pts' && (
          <Text style={S.sortCaretSm}>{compareSortDir === 'asc' ? '▲' : '▼'}</Text>
        )}
      </Pressable>
    </View>

    {/* list A */}
    {listA.map(p => playerRow(p,'A'))}
    
  </View>

  <View style={S.cCol}>
    {/* thead (mirrors A) */}
    <View style={S.tableHeaderRow}>
      <Pressable
        style={[S.headCell, { flex: 2 }]}
        onPress={() => toggleCompareSort('name')}
      >
        <Text style={[S.headTxt, compareSortKey === 'name' && S.headActive]}>
          Player
        </Text>
        {compareSortKey === 'name' && (
          <Text style={S.sortCaretSm}>{compareSortDir === 'asc' ? '▲' : '▼'}</Text>
        )}
      </Pressable>
      <Pressable
        style={[S.headCell, S.headNum]}
        onPress={() => toggleCompareSort('pts')}
      >
        <Text style={[S.headTxt, compareSortKey === 'pts' && S.headActive]}>
          Pts
        </Text>
        {compareSortKey === 'pts' && (
          <Text style={S.sortCaretSm}>{compareSortDir === 'asc' ? '▲' : '▼'}</Text>
        )}
      </Pressable>
    </View>

    {/* list B */}
    {listB.map(p => playerRow(p,'B'))}
  </View>
</View>

          </View>
        );
      })()}
      </ScrollView>
    </View>
  </View>
</Modal>


      {/* List */}
      {selected?.id ? (
        leagueLoading ? (
          <>
            <View style={S.stickyWrap}>
              <View style={S.thead}>
                <Text style={S.theadTitle}>
                  {selected?.name ?? 'League'}
                </Text>
                <View style={S.loadingBar}>
                  <ActivityIndicator size="small" color={C.accent} />
                  <Text style={S.loadingTxt}>Loading data…</Text>
                </View>
              </View>
            </View>
            <SkeletonList S={S} C={C} />
          </>
        ) : leagueError ? (
          <View style={[S.center, { paddingTop: 24 }]}>
            <Text style={S.error}>{leagueError}</Text>
            <View style={{ height: 8 }} />
            <TouchableOpacity onPress={() => fetchLeague(selected.id, { autosubs })}><Text style={S.link}>Retry</Text></TouchableOpacity>
          </View>
        ) : league ? (
          <FlatList
          ref={listRef}
            data={dataSorted}
            keyExtractor={(x) => String(x.entry_id)}
            renderItem={renderRow}
            ListHeaderComponent={header}
            stickyHeaderIndices={[0]}
            contentContainerStyle={{ paddingBottom: 200 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
            onScrollToIndexFailed={({ index }) => {
      // estimate and try again if measurement not ready
      listRef.current?.scrollToOffset({ offset: Math.max(0, index * 64 - 120), animated: true });
      setTimeout(() => scrollToIndexSafe(index), 50);
    }}
            windowSize={8}
            initialNumToRender={20}
            removeClippedSubviews
            extraData={{ showYet, cols: COLS }}
          />
        ) : null
      ) : null}
    </View>
    </View>
  );
};

/** ===== Row ===== */
const LeagueRow = React.memo(({ row, me, fav, expanded, onToggle, onFav, C, isDark, S, showYet, cols }) => {
  const ME_GRADIENT = isDark
    ? ['rgba(34,211,238,0.18)', 'rgba(99,102,241,0.18)']
    : ['#22d3ee', '#6366f1'];
  const navigation = useNavigation();
  const [showAllTransfers, setShowAllTransfers] = useState(false);
  const [viewMode, setViewMode] = useState('pitch'); // 'pitch' | 'list'

  const delta = (row.last_rank && row.rank) ? row.last_rank - row.rank : 0;
  const showDelta = delta !== 0;
  const orVal = Number(row.overall_rank);
  const showOR = Number.isFinite(orVal) && orVal !== -1;
  const usedChips = safeArr(row.used_chips);
  const activeChip = row.active_chip || '';

  const okColor = C.ok ?? '#22c55e';
  const badColor = C.danger ?? '#ef4444';
  const sameColor = C.muted ?? '#9aa0ad';

  const t = delta > 0 ? { key: 'up', color: okColor }
        : delta < 0 ? { key: 'down', color: badColor }
        : { key: 'same', color: sameColor };

  const chips = useMemo(() => {
    const arr = [];
    if (activeChip) arr.push({ key: 'active', val: activeChip, active: true });
    CHIP_ORDER.forEach((c) => {
      if (c === activeChip) return;
      if (usedChips.includes(c)) arr.push({ key: c, val: c, used: true });
    });
    return arr;
  }, [activeChip, usedChips]);




  const transfers = safeArr(row.transfers);
  const xferSum = transfers.reduce((acc, t) => acc + (typeof t.gain === 'number' ? t.gain : 0), 0);
  const hits = Number(row.gw_hits ?? row.hits ?? row.hit ?? 0) || 0;
  const xferNet = xferSum + hits;
  const netForColor = hits ? xferNet : xferSum;
  const xferText = hits ? ` ${sign(xferSum)} + ${hits} = ${sign(xferNet)} (incl. hits)` : ` ${sign(xferSum)}`;

  const HeaderInner = () => (
    <>
      {/* Pos */}
      <View style={[S.rankWrap, { width: toPct(cols.pos) }]}>
        <View style={S.arrowBlock}>
          <Image source={assetImages[t.key]} style={S.rankArrow} />
          {showDelta && (
            <Text style={[S.deltaTiny, { color: me ? '#ffffff' : t.color }]}>{sign(delta)}</Text>
          )}
        </View>
        <Text style={[S.rankNum, me && S.rankNumMine]}>{row.rank}</Text>
      </View>

      {/* Manager block */}
      <View style={[S.managerCol, { width: toPct(cols.manager) }]}>
        {(() => {
  // If this is "me" in Celebs with placeholders, show "My Team" big and "You" below.
  const isPlaceholderCombo = me && String(row.manager_name) === 'You' && String(row.team_name) === 'My Team';
  const primaryText   = isPlaceholderCombo ? (row.team_name || row.manager_name) : (row.manager_name || row.team_name);
  const secondaryText = isPlaceholderCombo ? (row.manager_name || '')            : (row.team_name || '');

  return (
    <>
      <TouchableOpacity activeOpacity={0.7} onLongPress={(e) => { e.stopPropagation?.(); onFav(); }}>
        <Text numberOfLines={1} ellipsizeMode="tail" style={[S.teamName, me && S.teamNameMine]}>
          {primaryText}
        </Text>
      </TouchableOpacity>

      <Text style={[S.managerName, me && S.managerNameMine]} numberOfLines={1}>
        {secondaryText}
      </Text>
    </>
  );
})()}


        <View style={S.chipsRow}>
          {showOR && (
            <View
              style={[
                S.kpiBubbleSm,
                me && isDark && { borderColor: 'rgba(255,255,255,0.75)' },
              ]}
            >
              <Text
                style={[
                  S.kpiBubbleTextSm,
                  me && isDark && { color: '#ffffff' },
                ]}
              >
                OR <Text style={S.kpiNum}>{compactNumber(row.overall_rank)}</Text>
              </Text>
            </View>
          )}

          {chips.map((c) => {
            const chipCore = (
              <View
                key={`${row.entry_id}-${c.key}`}
                style={[
                  S.chip,
                  c.active && [S.chipActive, { borderColor: C.accent, backgroundColor: isDark ? '#0b3b2c20' : '#eefcf6' }],
                  c.used && S.chipUsed,
                ]}
              >
                <Text
                  style={[
                    S.chipText,
                    c.active && { color: isDark ? C.ink : '#0b0c10', fontWeight: '800' },
                    c.used && S.chipUsedText,
                  ]}
                >
                  {c.val}
                </Text>
                {c.active && <View style={[S.chipDot, { backgroundColor: C.accent, borderColor: isDark ? C.card : '#fff' }]} />}
              </View>
            );
            return c.active ? (
              <View key={`${row.entry_id}-${c.key}-wrap`} style={[S.chipHaloThick, { backgroundColor: `${C.accent}28` }]}>
                {chipCore}
              </View>
            ) : (
              chipCore
            );
          })}
        </View>
      </View>

      {/* Yet */}
      {showYet && (
        <View style={[S.colFixed, { width: toPct(cols.yet) }]}>
          <Text style={[S.fixedNum, me && S.fixedNumMine]}>{row.yet ?? row.played_rem ?? 0}</Text>
        </View>
      )}

      {/* Captain / Vice */}
      <View style={[S.colFixed, { width: toPct(cols.cap) }]}>
        <Text numberOfLines={1} style={[S.capMain, me && S.capMainMine]}>{row.captain || ''}</Text>
        <Text numberOfLines={1} style={[S.capSub, me && S.capSubMine]}>{row.vice || ''}</Text>
      </View>

      {/* GW */}
      <View style={[S.colFixed, { width: toPct(cols.gw) }]}>
        {(() => {
          const gwGross = Number(row.gw_gross ?? row.gwgross ?? row.gw ?? 0);
          const gwHits = Number(row.gw_hits ?? row.hits ?? row.hit ?? 0);
          const yetCount = Number(row?.yet ?? row?.played_rem ?? 0) || 0;

          return (
            <View style={S.gwStack}>
              <Text style={[S.gwMain, me && S.gwMainMine]}>{gwGross}</Text>
              {!!gwHits && (
                <Text style={[S.gwHit, { color: badColor }]}>({gwHits > 0 ? `+${gwHits}` : gwHits})</Text>
              )}
              { yetCount > 0 && (
      <Text style={S.gwYet}>Yet {yetCount}</Text>
    )}
            </View>
          );
        })()}
      </View>

      {/* Total + chevron */}
      <View style={[S.totalCol, { width: toPct(cols.total) }]}>
        <Text style={[S.totalNum, me && S.totalNumMine]}>{row.total ?? 0}</Text>
        <MaterialCommunityIcons
          name={expanded ? 'chevron-down' : 'chevron-right'}
          size={18}
          color={me ? '#ffffff' : (C.text ?? '#0f172a')}
        />
      </View>
    </>
  );

  return (
    <Pressable
      onPress={onToggle}
      onLongPress={(e) => { e.stopPropagation?.(); onFav(); }}
      style={{ marginTop: 4 }}
      android_ripple={{ color: C.border }}
    >
      {/* SUMMARY HEADER */}
      <View style={[S.rowCard, me && S.rowCardMine]}>
        {me ? (
          <LinearGradient
            colors={ME_GRADIENT}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[S.rowHeader, S.rowHeaderMine, isDark && { shadowOpacity: 0.35 }]}
          >
            <HeaderInner />
          </LinearGradient>
        ) : (
          <View style={S.rowHeader}>
            <HeaderInner />
          </View>
        )}
      </View>

      {/* EXPAND */}
      {expanded && (
        <View style={S.expand}>
          <View style={S.strip}>
            <View style={S.kpisRow}>
              <View style={S.kpiPill}><Text style={S.kpiKey}>FT</Text><Text style={S.kpiVal}>{row.FT ?? 0}</Text></View>
              <View style={S.kpiPill}><Text style={S.kpiKey}>TV</Text><Text style={S.kpiVal}>{row.team_value ? `£${row.team_value}` : '-'}</Text></View>
              <View style={S.kpiPill}><Text style={S.kpiKey}>Played</Text><Text style={S.kpiVal}>{row.played_text || `${row.played ?? 0}/12`}</Text></View>

              <Pressable
                onPress={(e) => {
                  e.stopPropagation?.();
                  navigation.navigate('Rank', { viewFplId: row.entry_id });
                }}
                style={S.kpiPill}
                accessibilityLabel="Open this manager’s Rank page"
              >
                <MaterialCommunityIcons name="open-in-new" size={12} color={ C.accent} />
                <Text style={[S.kpiKey, { marginLeft: 2, fontSize: 10 }]}>View Rank</Text>
              </Pressable>
            </View>

            {!!transfers.length && (
              <View style={S.transfersRow}>
                {(showAllTransfers ? transfers : transfers.slice(0, 6)).map((t, idx) => (
                  <View
                    key={`${t.out}-${t.in}-${idx}`}
                    style={[
                      S.xferPill,
                      { borderColor: C.border2 },
                    ]}
                  >
                    <Text style={S.xferOut}>{t.in}</Text>
                    <Text style={S.xferArrow}>→</Text>
                    <Text style={S.xferIn}>{t.out}</Text>
                    {typeof t.gain === 'number' && (
                      <Text style={[
                        S.xferDiff,
                        t.gain > 0 ? { color: (C.ok ?? '#22c55e') } :
                        t.gain < 0 ? { color: (C.danger ?? '#ef4444') } :
                        { color: C.muted },
                      ]}>
                        {' '}{sign(t.gain)}
                      </Text>
                    )}
                  </View>
                ))}
                {transfers.length > 6 && (
                  <TouchableOpacity onPress={() => setShowAllTransfers((v) => !v)} style={S.moreXfersBtn}>
                    <Text style={S.moreXfersTxt}>{showAllTransfers ? 'Show fewer' : `+${transfers.length - 6} more`}</Text>
                  </TouchableOpacity>
                )}
                {typeof xferSum === 'number' && (
                  <Text style={[
                    S.xferTotal,
                    netForColor > 0 ? { color: (C.ok ?? '#22c55e') } :
                    netForColor < 0 ? { color: (C.danger ?? '#ef4444') } :
                    { color: C.muted }
                  ]}>
                    {xferText}
                  </Text>
                )}
              </View>
            )}

            {/* View toggle */}
            <View style={S.segmentRowSm}>
              <Pressable
                style={[S.segmentSm, viewMode==='pitch' && S.segmentSmActive]}
                onPress={() => setViewMode('pitch')}
              >
                <Text style={[S.segmentSmTxt, viewMode==='pitch' && S.segmentSmTxtActive]}>Pitch</Text>
              </Pressable>
              <Pressable
                style={[S.segmentSm, viewMode==='list' && S.segmentSmActive]}
                onPress={() => setViewMode('list')}
              >
                <Text style={[S.segmentSmTxt, viewMode==='list' && S.segmentSmTxtActive]}>List</Text>
              </Pressable>
            </View>

            {viewMode === 'pitch'
              ? <RosterGrid roster={row.roster} activeChip={activeChip} C={C} S={S} isDark={isDark} />
              : <RosterList roster={row.roster} activeChip={activeChip} C={C} S={S} isDark={isDark} />}
          </View>
        </View>
      )}
    </Pressable>
  );
});

/** ===== Skeleton ===== */
const SkeletonList = ({ S, C }) => {
  const rows = Array.from({ length: 8 }, (_, i) => i);
  return (
    <View style={{ paddingTop: 12 }}>
      {rows.map((i) => (
        <View key={i} style={[S.rowCard, { marginVertical: 4, overflow: 'hidden' }]}>
          <View style={[S.rowHeader, { opacity: 0.9 }]}>
            <View style={[S.skel, { width: 30, height: 14 }]} />
            <View style={{ flex: 1, paddingHorizontal: 8 }}>
              <View style={[S.skel, { width: '60%', height: 12, marginBottom: 6 }]} />
              <View style={[S.skel, { width: '40%', height: 10 }]} />
            </View>
            <View style={[S.skel, { width: 40, height: 12 }]} />
          </View>
        </View>
      ))}
    </View>
  );
};

/** ===== Roster (mini pitch) ===== */
const RosterGrid = ({ roster, activeChip, C, S, isDark }) => {
  const players = Array.isArray(roster) ? roster.slice(0, 15) : [];
  const total = players.length;
  if (!total) return null;

  const perRow = Math.ceil(total / 2);
  const row1 = players.slice(0, perRow);
  const row2 = players.slice(perRow);

  const { width } = Dimensions.get('window');
  const sidePad = 10;
  const gap = 6;
  const innerW = Math.max(280, width - 2 * 32) - 20;
  const w1 = Math.floor((innerW - (perRow - 1) * gap) / perRow);
  const w2 = Math.floor((innerW - (Math.max(row2.length, 1) - 1) * gap) / Math.max(row2.length, 1));

  return (
    <View style={S.pitchWrap}>
      <ImageBackground
        source={assetImages.pitch}
        style={S.pitchBg}
        imageStyle={S.pitchImg}
        resizeMode="cover"
      >
        <View style={[S.pitchRow, { paddingHorizontal: sidePad }]}>
          {row1.map((p, idx) => (<PlayerCell key={`${p.id || p.name}-r1-${idx}`} player={p} width={w1} activeChip={activeChip} C={C} S={S} isDark={isDark} />))}
        </View>
        {!!row2.length && (
          <View style={[S.pitchRow, { paddingHorizontal: sidePad, marginTop: 10 }]}>
            {row2.map((p, idx) => (<PlayerCell key={`${p.id || p.name}-r2-${idx}`} player={p} width={w2} activeChip={activeChip} C={C} S={S} isDark={isDark} />))}
          </View>
        )}
      </ImageBackground>
    </View>
  );
};

const RosterList = ({ roster, activeChip, C, S, isDark }) => {
  const players = Array.isArray(roster) ? roster.slice(0, 15) : [];
  if (!players.length) return null;
  return (
    <View style={S.rosterList}>
      {players.map((p, i) => {
        const mul = Number(p.mul ?? p.multiplier ?? 1);
        let cap;
        if (p.role === 'v') cap = 'V';
        else if (p.role === 'c' || mul >= 2) {
          const isTC = (activeChip === 'TC' && p.role === 'c') || mul >= 3;
          cap = isTC ? 'TC' : 'C';
        }
        const basePts = Number(p.gw_points ?? 0);
        const pts = basePts * Math.max(1, mul);
        const status = p.role === 'b' ? 'benched' : p.status;

        return (
          <View key={`${p.id || p.name}-${i}`} style={S.rosterRow}>
            <Image source={{ uri: clubCrestUri(p.team_id ?? 1) }} style={S.rosterCrest} />
            <View style={{ flex: 1, paddingRight: 6 }}>
              <Text numberOfLines={1} style={S.rosterName}>{p.name}</Text>
              <Text
                style={[
                  S.rosterBadge,
                  status === 'played' && S.played,
                  status === 'live' && S.live,
                  status === 'missed' && S.missed,
                  status === 'yet' && [S.yet, { backgroundColor: C.accent, color: '#0b0c10' }],
                  status === 'benched' && S.benched,
                ]}
              >
                {status?.toUpperCase?.() || 'YET'}
              </Text>
            </View>
            {!!cap && (
              <View style={[S.rosterCap, cap === 'C' ? [S.capBadgeC, ] : S.capBadgeV]}>
                <Text style={S.capBadgeTxt}>{cap}</Text>
              </View>
            )}
            <Text style={S.rosterPts}>{pts}</Text>
            <Text style={S.rosterEO}>{pct(p.eo)}</Text>
          </View>
        );
      })}
    </View>
  );
};

const PlayerCell = ({ player, width, activeChip, C, S, isDark }) => {
  const mul = Number(player.mul ?? player.multiplier ?? 1);
  let cap;
  if (player.role === 'v') cap = 'V';
  else if (player.role === 'c' || mul >= 2) {
    const isTC = (activeChip === 'TC' && player.role === 'c') || mul >= 3;
    cap = isTC ? 'TC' : 'C';
  }
  const isBench = player.role === 'b';
  let status = player.status;
  if (isBench) status = 'benched';

  const basePts = Number(player.gw_points ?? 0);
  const pts = basePts * Math.max(1, mul);

  const eoText = pct(player.eo);

  return (
    <View style={[S.cellWrap, { width }]}>
      <View style={S.crestWrap}>
        <Image source={{ uri: clubCrestUri(player.team_id ?? 1) }} style={S.crest} />
        {!!player.emoji && (
          <View style={S.emojiBadge}>
            <Text style={S.emojiText}>{emojiToChar(player.emoji)}</Text>
          </View>
        )}
        {!!cap && (
          <View style={[S.capBadge, cap === 'C' ? [S.capBadgeC,] : S.capBadgeV]}>
            <Text style={S.capBadgeTxt}>{cap}</Text>
          </View>
        )}
      </View>

      <Text numberOfLines={1} style={S.cellName}>{player.name}</Text>
      <Text
        style={[
          S.cellPts,
          status === 'played' && S.played,
          status === 'live' && S.live,
          status === 'missed' && S.missed,
          status === 'yet' && [S.yet, { backgroundColor: '#1e9770', color: '#0b0c10' }],
          status === 'benched' && S.benched,
        ]}
      >
        {pts}
      </Text>
      <Text style={S.cellEO}>{eoText}</Text>
    </View>
  );
};

/** ===== Styles (theme-driven) ===== */
const createStyles = (C, isDark) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: C.bg},
    center: { alignItems: 'center', justifyContent: 'center' },
    centerRow: { flexDirection: 'row', alignItems: 'center' },
    label: { color: C.ink, marginBottom: 8, fontWeight: '700' },
    muted: { color: C.muted },
    error: { color: C.danger ?? '#ff8b8b' },
    link: { color: C.accent, fontWeight: '700' },
compareSheet: {
  width: '100%', maxWidth: 820, maxHeight: 640,
  backgroundColor: isDark ? '#121826' : '#f8fafc',
  borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.border2,
},
comparePickRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
comparePickCol: { flex: 1 },
comparePickLabel: { color: C.muted, fontSize: 11, marginBottom: 6, fontWeight: '700' },
compareList: {
  maxHeight: 180, borderWidth: 1, borderColor: C.border2,
  borderRadius: 10, backgroundColor: C.card, marginBottom: 10
},
compareItem: {
  flexDirection: 'row', alignItems: 'center',
  paddingVertical: 10, paddingHorizontal: 12,
  borderBottomWidth: 1, borderBottomColor: C.border2
},

compareResultWrap: { marginTop: 4 },
cMetaRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
cMetaCol: {
  flex: 1, borderWidth: 1, borderColor: C.border2,
  borderRadius: 10, padding: 10, backgroundColor: C.card
},
cMetaTitle: { color: C.ink, fontWeight: '800', marginBottom: 4, fontSize: 12 },
cMetaSub: { color: C.ink, fontSize: 11, marginTop: 2 },

cTable: { flexDirection: 'row', gap: 8 },
cCol: {
  flex: 1, borderWidth: 1, borderColor: C.border2,
  borderRadius: 10, padding: 8,
  backgroundColor: isDark ? '#0b1224' : '#f8fafc'
},
cColTitle: { color: C.ink, fontWeight: '800', marginBottom: 6 },
cRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: C.border2 },
cName: { flex: 1, color: C.ink, fontWeight: '700', fontSize: 12 },
cPts: { width: 44, textAlign: 'right', color: C.ink, fontWeight: '800' },
cMuted: { opacity: 0.55 },
cBench: { fontStyle: 'italic' },

    /** Toolbar */
    toolbarRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 8,
    },
    dropdown: {
  marginTop: 6,
  borderWidth: 1,
  borderColor: C.border2,
  backgroundColor: C.card,
  borderRadius: 10,
  maxHeight: 220,
  overflow: 'hidden',
  // keep above other content while still flowing in layout
  zIndex: 2,
  zIndex: 3,         // above the backdrop
  elevation: 6, 
},
dropdownList: {
  maxHeight: 220,
},
dropdownItem: {
  flexDirection: 'row',
  alignItems: 'center',
  paddingVertical: 10,
  paddingHorizontal: 12,
  borderBottomWidth: 1,
  borderBottomColor: C.border2,
},


    /** Select */
    select: {
      height: 44, borderRadius: 12, borderWidth: 1, borderColor: C.border2,
      backgroundColor: C.card, paddingHorizontal: 12,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: 0,
    },
    selectText: { color: C.ink, fontSize: 12 },
    placeholder: { color: C.muted },

    /** Small icon button (cog/share) */
    iconBtn: {
      height: 44,
      width: 44,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: C.border2,
      backgroundColor: C.card,
      alignItems: 'center',
      justifyContent: 'center',
    },

    /** Picker modal sheet */
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
    sheet: { width: '100%', maxWidth: 520, backgroundColor: isDark ? '#121826' : '#f8fafc', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.border2 },
    sheetTitle: { color: C.ink, fontSize: 12, fontWeight: '800', marginBottom: 8 },
    optItem: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border2, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    optText: { color: C.ink, fontSize: 12 },

    stickyWrap: {
      backgroundColor: isDark ? 'rgba(15,23,42,1)' : 'rgba(234,240,255,1)',
    },
    loadingBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 6,
      paddingHorizontal: 8,
      borderTopWidth: 1,
      borderColor: C.border2,
      backgroundColor: isDark ? 'rgba(15,23,42,0.96)' : 'rgba(234,240,255,0.96)',
    },
    loadingTxt: { color: C.muted, fontWeight: '700', fontSize: 11 },

    thead: {
      backgroundColor: isDark ? 'rgba(15,23,42,0.96)' : 'rgba(234,240,255,0.96)',
      paddingTop: 4, paddingBottom: 6,
      marginVertical: 0,
      borderBottomWidth: 1, borderColor: C.border2,
    },
    theadTitle: { color: C.ink, textAlign: 'center', fontWeight: '700', marginBottom: 4, fontSize: 12 },
    theadTitle2: { color: C.ink, textAlign: 'center', fontWeight: '500', marginBottom: 4, fontSize: 9 },
    leagueLinkLine: { color: C.accent, fontSize: 11, textDecorationLine: 'underline' },
    colHeadRow: { flexDirection: 'row', alignItems: 'center' },
    th: { color: C.ink, fontWeight: '800', fontSize: 11 },
    thCell: { paddingVertical: 6, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center' },
    thCenter: { justifyContent: 'center' },
    thStart: { justifyContent: 'flex-start' },
    thPress: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    thActive: { textDecorationLine: 'underline', color: C.ink },
    sortCaret: { color: C.muted, marginLeft: 2, fontSize: 10, lineHeight: 12 },
    sortCaretSm: { color: C.muted, marginLeft: 2, fontSize: 10 },

    /** Row card */
    rowCard: {
      backgroundColor: C.card,
      borderRadius: RADIUS,
      borderWidth: 1,
      borderColor: C.border2,
      overflow: 'hidden',
    },
    rowCardMine: {
      borderColor: C.accent,
      shadowColor: C.accent,
      shadowOpacity: 0.15,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 0 },
      elevation: 2,
    },

    rowHeader: { flexDirection: 'row', alignItems: 'stretch', paddingHorizontal: 8, paddingVertical: 5 },
    rowHeaderMine: {
      borderRadius: RADIUS,
      shadowColor: 'rgba(0,0,0,0.25)',
      shadowOpacity: 1,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2,
    },

    rankWrap: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
    arrowBlock: { alignItems: 'center', justifyContent: 'center' },
    rankArrow: { width: 12, height: 12, resizeMode: 'contain' },
    deltaTiny: { fontSize: 6, lineHeight: 10, fontWeight: '800', marginTop: 1 },

    rankNum: { color: C.text ?? '#111827', fontWeight: '700', fontSize: 12 },
    rankNumMine: { color: C.ink },

    managerCol: { minWidth: 0, paddingHorizontal: 6 },
    managerTopRow: { flexDirection: 'row', alignItems: 'center' },
    starBtn: { marginLeft: 6,display:'none' },
    teamName: { color: C.text ?? '#111827', fontWeight: '700', fontSize: 11, maxWidth: '100%' },
    teamNameMine: { color: C.ink },
    managerName: { color: C.ink, marginTop: 2, fontSize: 10 },
gwYet: { color: C.ink, fontSize: 8, marginTop: 1, fontWeight: '700' },

    chipsRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, marginTop: 2, flexWrap: 'nowrap' },

    chip: {
      height: 18,
      paddingHorizontal: 4, paddingVertical: 0,
      borderRadius: 5, backgroundColor: isDark ? '#0f1525' : '#f5f6fb', borderWidth: 1, borderColor: C.border2,
      alignItems: 'center', justifyContent: 'center',
    },
    chipText: { color: C.text ?? '#111827', fontSize: 10, lineHeight: 12 },
    chipActive: {
      shadowColor: C.accent,
      shadowOpacity: 0.25,
      shadowRadius: 5,
      shadowOffset: { width: 0, height: 0 },
      elevation: 2,
    },
    chipHaloThick: { padding: 2, borderRadius: 999, backgroundColor: `${C.accent}28`, marginBottom: -2 },

    chipDot: {
      position: 'absolute', top: -2, right: -1, width: 6, height: 6, borderRadius: 3,
      borderWidth: 1.5,
      shadowColor: `${C.accent}33`, shadowOpacity: 1, shadowRadius: 2, shadowOffset: { width: 0, height: 0 },
    },
    chipUsed: { opacity: 0.75,height: 12,paddingHorizontal: 2,
      paddingVertical: 0,
      borderRadius: 4,
    },
    chipUsedText: { color: C.muted, textDecorationLine: 'line-through',fontSize:8,lineHeight: 10, },

    // small OR bubble (outline-only)
    kpiBubbleSm: {
      paddingVertical: 2,
      paddingHorizontal: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: C.border2,
      backgroundColor: 'transparent',
    },
    kpiBubbleTextSm: {
      fontSize: 10,
      fontWeight: '700',
      color: C.ink,
    },
    kpiNum: {},

    colFixed: { alignItems: 'center', justifyContent: 'center' },
    fixedNum: { color: C.text ?? '#111827', fontSize: 12 },
    fixedNumMine: { color: C.ink },

    capMain: { color: C.text ?? '#111827', fontWeight: '700', fontSize: 12 },
    capMainMine: { color: C.ink },
    capSub: { color: C.text ?? '#111827', fontSize: 10, marginTop: 2 },
    capSubMine: { color: C.ink },

    totalCol: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
    totalNum: { color: C.text ?? '#111827', fontWeight: '700', marginRight: 2, fontSize: 12 },
    totalNumMine: { color: C.ink },
eoInfoBtn: {
  paddingHorizontal: 6,
  paddingVertical: 4,
  borderRadius: 6,
  borderWidth: 1,
  borderColor: C.border2,
  backgroundColor: C.card,
},

eoDetailSheet: {
  width: '100%',
  maxWidth: 560,
  maxHeight: 540,
  backgroundColor: isDark ? '#121826' : '#f8fafc',
  borderRadius: 16,
  padding: 16,
  borderWidth: 1,
  borderColor: C.border2,
},

eoCountsRow: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
  marginTop: 2,
  marginBottom: 6,
},

eoTotalsRow: {
  marginTop: 2,
  marginBottom: 6,
},
eoTotalsText: {
  color: C.ink,
  fontWeight: '800',
},


eoCountPill: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 6,
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: 999,
  backgroundColor: isDark ? '#10192e' : '#eef2ff',
  borderWidth: 1,
  borderColor: C.border2,
},

eoCountKey: { color: C.muted, fontSize: 12, fontWeight: '700' },
eoCountVal: { color: C.ink, fontSize: 12, fontWeight: '800' },

eoGroupTitle: {
  color: C.ink,
  fontWeight: '800',
  marginBottom: 6,
},

eoManagerItem: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 8,
  paddingVertical: 6,
  borderBottomWidth: 1,
  borderBottomColor: C.border2,
},

eoManagerName: { color: C.ink, fontWeight: '700', flexShrink: 1 },

    expand: {
      backgroundColor: isDark ? '#0f1422' : '#f1f5f9',
      borderWidth: 1, borderTopWidth: 0, borderColor: C.border2,
      borderBottomLeftRadius: RADIUS, borderBottomRightRadius: RADIUS,
      padding: 10, marginTop: -1,
    },
    strip: { backgroundColor: isDark ? '#0c1326' : '#ffffff', borderWidth: 1, borderColor: C.border2, padding: 8, borderRadius: 12 },
    kpisRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
    kpiPill: {
      paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999,
      backgroundColor: isDark ? '#10192e' : '#eef2ff', borderWidth: 1, borderColor: C.border2,
      flexDirection: 'row', gap: 6, alignItems: 'center',
    },
    kpiKey: { color: C.muted, fontSize: 12, fontWeight: '700' },
    kpiVal: { color: C.ink, fontSize: 12, fontWeight: '700' },
    heartBtn: { marginLeft: 4, padding: 4, display: 'None' },

    transfersRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 8, marginHorizontal: -3 },
    xferPill: {
      flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1,
      alignSelf: 'flex-start', flexShrink: 0, margin: 3, backgroundColor: isDark ? '#0f1525' : '#f8fafc',
    },
    xferOut: { color: C.ink, fontWeight: '700', fontSize: 12 },
    xferArrow: { color: C.muted, marginHorizontal: 4 },
    xferIn: { color: C.ink, fontWeight: '700', fontSize: 12 },
    xferDiff: { fontSize: 12, marginLeft: 4, opacity: 0.95, fontWeight: '800' },
    xferTotal: { marginLeft: 6, fontWeight: '800' },
    moreXfersBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: C.card, borderWidth: 1, borderColor: C.border2, margin: 3 },
    moreXfersTxt: { color: C.ink, fontWeight: '700', fontSize: 12 },

    gwStack: { flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
    gwMain: { color: C.text ?? '#111827', fontWeight: '700', fontSize: 13 },
    gwMainMine: { color: C.ink },
    gwHit: { marginLeft: 4, fontSize: 12, fontWeight: '700' },

    /** Mini pitch */
    pitchWrap: { marginTop: 10, borderRadius: 12, overflow: 'hidden', backgroundColor: isDark ? '#0b1224' : '#e7edf9', borderWidth: 1, borderColor: C.border2 },
    pitchBg: { width: '100%', paddingVertical: 10 },
    pitchImg: { opacity: isDark ? 0.15 : 0.2 },
    pitchRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 },

    /** Roster list */
    rosterList: { marginTop: 8, borderWidth: 1, borderColor: C.border2, borderRadius: 10, backgroundColor: isDark ? '#0b1224' : '#f8fafc' },
    rosterRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.border2 },
    rosterCrest: { width: 26, height: 26, resizeMode: 'contain', marginRight: 8 },
    rosterName: { color: C.ink, fontWeight: '700', fontSize: 11 },
    rosterBadge: { marginTop: 2, alignSelf: 'flex-start', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, overflow: 'hidden', fontSize: 10, fontWeight: '800', color: '#0b0c10', backgroundColor: '#e5e7eb' },
    rosterCap: { minWidth: 22, height: 18, paddingHorizontal: 4, borderRadius: 9, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border2, marginRight: 6 },
    rosterPts: { color: C.ink, fontWeight: '800', width: 36, textAlign: 'right' },
    rosterEO: { color: C.eo ?? '#a7b4d6', fontWeight: '700', width: 40, textAlign: 'right', fontSize: 10 },

    /** Top bar (kept for reference) */
    topBar: {
      height: 44,
      paddingHorizontal: 12,
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'center',
      backgroundColor: '#0b0c10',
      borderBottomWidth: 1,
      borderBottomColor: '#1f2937',
      zIndex: 10,
      elevation: 10,
      marginBottom: 6,
    },

    topLogo: { height: 28, width: 160 },
    topTitle: { color: C.ink, fontWeight: '900', fontSize: 16 },

    /** Player cell */
    cellWrap: { alignItems: 'center' },
    crestWrap: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
    crest: { width: 42, height: 42, resizeMode: 'contain' },
    emojiBadge: {
      position: 'absolute', left: 5, zIndex: 3, top: -6, width: 18, height: 18, borderRadius: 9,
      backgroundColor: isDark ? '#0f172a' : '#f1f5f9',
      alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border2,
    },
    emojiText: { fontSize: 11, lineHeight: 13, color: C.ink },
    capBadge: {
      position: 'absolute', right: 5, bottom: 6, minWidth: 18, height: 18, paddingHorizontal: 3, borderRadius: 9,
      alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border2,
    },
    capBadgeC: {backgroundColor:'white'},
    capBadgeV: { backgroundColor: isDark ? '#c7d2fe' : '#e0e7ff', borderColor: '#4f46e5' },
    capBadgeTxt: { fontSize: 10, fontWeight: '800', color: '#0b0c10' },

    cellName: { marginTop: 4, width: '100%', textAlign: 'center', color: C.ink, fontSize: 8, fontWeight: '700' },

    played: { backgroundColor: isDark ? '#e2e8f0' : '#ffffff', color: '#0b0c10' },
    live: { backgroundColor: isDark ? '#fde68a' : '#f59e0b', color: '#0b0c10' },
    missed: { backgroundColor: C.danger ?? '#ef4444', color: '#ffffff' },
    yet: { backgroundColor: '#1e9770', color: '#0b0c10' },
    benched: { backgroundColor: isDark ? '#111827' : '#d1d5db', color: isDark ? '#e5e7eb' : '#111827' },

    cellPts: {
      marginTop: 2, width: '100%', textAlign: 'center', paddingVertical: 1, borderRadius: 6, overflow: 'hidden',
      fontSize: 10, fontWeight: '800', color: '#0b0c10',
    },

    analyticsBar: { alignItems: 'flex-end', marginBottom: 8 },
    analyticsBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: C.border2,
      backgroundColor: C.card,
    },
    analyticsBtnText: { color: C.ink, fontWeight: '700' },
    analyticsSheet: {
      width: '100%', maxWidth: 720, maxHeight: 560,
      backgroundColor: isDark ? '#121826' : '#f8fafc', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.border2,position: 'relative',
    },
    eoInnerBackdrop: {
   position: 'absolute',
   left: 0, right: 0, top: 0, bottom: 0,
   backgroundColor: 'rgba(0,0,0,0.35)',
   borderRadius: 16,
 },
eoDetailCard: {
  position: 'absolute',
  left: 16,
  right: 16,
  top: 72,                             // a bit lower from the top bar
  // NOTE: remove/omit any "bottom" property so height can be capped

  borderRadius: 12,
  borderWidth: 1,
  borderColor: C.border2,
  backgroundColor: C.card,
  padding: 12,

  display: 'flex',

  // Make the panel SHORTER so ad remains visible below.
  // "height" is already defined at the top: const { height } = Dimensions.get('window')
  maxHeight: Math.min(height * 0.75, 100000), // ~55% of screen, hard cap 420
  alignSelf: 'stretch',
},

    analyticsHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    analyticsTitle: { color: C.ink, fontWeight: '800' },

    tableTitle: { color: C.ink, fontWeight: '800', marginBottom: 6, marginTop: 4 },
    tableHeaderRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: C.border2, paddingBottom: 6, marginBottom: 6 },
    headCell: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    headTxt: { color: C.ink, fontWeight: '700', fontSize: 10 },
    headActive: { textDecorationLine: 'underline', color: C.accent },
    headNum: { minWidth: 44, justifyContent: 'flex-end' },
    tableList: { maxHeight: 220 },
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.border2 },
    cell: { color: C.ink },
    cellNum: { textAlign: 'right', minWidth: 44, fontSize: 10, color: C.ink },

    cellEO: { marginTop: 1, fontSize: 10, color: C.eo ?? '#a7b4d6', fontWeight: '600', textAlign: 'center' },

    /** Toolbar companions */
    analyticsInlineBtn: {
      height: 44,
      borderRadius: 12,
      flexShrink: 0,
      justifyContent: 'center',
    },

    /** Settings sheet */
    settingsSheet: {
      width: '100%', maxWidth: 520,
      backgroundColor: isDark ? '#121826' : '#f8fafc', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.border2,
    },
    settingRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      borderWidth: 1, borderColor: C.border2, borderRadius: 12,
      paddingHorizontal: 12, paddingVertical: 10, backgroundColor: C.card,
    },
    settingLabelCol: { flexShrink: 1, paddingRight: 12 },
    settingLabel: { color: C.ink, fontWeight: '800' },
    settingHint: { color: C.muted, marginTop: 2, fontSize: 12 },

    autoSwitch: {
      transform: [
        { scaleX: Platform.OS === 'android' ? 0.9 : 0.85 },
        { scaleY: Platform.OS === 'android' ? 0.9 : 0.85 },
      ],
      marginTop: Platform.OS === 'ios' ? -2 : 0,
    },

    bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 6 },
    bulletDot: { color: C.muted, fontSize: 14, lineHeight: 20 },
    bulletText: { color: C.muted, flex: 1, fontSize: 13 },

    // Segmented controls
    segmentRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
    segment: { flex: 1, borderWidth: 1, borderColor: C.border2, backgroundColor: C.card, paddingVertical: 8, borderRadius: 999, alignItems: 'center' },
    segmentActive: { backgroundColor: isDark ? '#0f172a' : '#eaf0ff', borderColor: C.accent },
    segmentTxt: { color: C.muted, fontWeight: '700' },
    segmentTxtActive: { color: C.ink },

    segmentRowSm: { flexDirection: 'row', gap: 6, marginTop: 8, marginBottom: 6 },
    segmentSm: { flex: 0, borderWidth: 1, borderColor: C.border2, backgroundColor: C.card, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, alignItems: 'center' },
    segmentSmActive: { backgroundColor: isDark ? '#0f172a' : '#eaf0ff', borderColor: C.accent },
    segmentSmTxt: { color: C.muted, fontWeight: '700', fontSize: 11 },
    segmentSmTxtActive: { color: C.ink },

    searchInput: {
      height: 36,
      borderWidth: 1,
      borderColor: C.border2,
      backgroundColor: C.card,
      color: C.ink,
      paddingHorizontal: 10,
      borderRadius: 8,
      marginBottom: 8,
      fontSize: 12,
    },
   searchInputInline: {
  height: 36,
  paddingHorizontal: 12,
  paddingVertical: 0,       // ensures even centering
  borderRadius: 10,
  borderWidth: 1,
  borderColor: C.border2,
  backgroundColor: isDark ? '#0b1220' : '#ffffff',
  color: C.ink,
  fontSize: 14,
  // 🚫 no lineHeight here
},



findBtn: {
  height: 36,
  paddingHorizontal: 12,
  paddingVertical: 0, 
  borderRadius: 10,
  borderWidth: 1,
  borderColor: C.border2,
  backgroundColor: isDark ? '#0f172a' : '#f8fafc',
  alignItems: 'center',
  justifyContent: 'center',
  marginLeft: 8,
},

findBtnText: {
  color: C.ink,
  fontWeight: '700',
  fontSize: 14,
},


    // Skeleton
    skel: { backgroundColor: isDark ? '#0f172a' : '#e5e7eb', borderRadius: 6 },
  });

export default League;
