// threats.js — tabs more visible; merged grid cards; sticky compare; Danger Table with emojis
import AppHeader from './AppHeader';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  ActivityIndicator,
  Dimensions,
  Image,
  RefreshControl,
  
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Modal,
  Linking
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { clubCrestUri } from './clubs';
import { smartFetch } from './signedFetch';
import { useColors } from './theme';
Text.defaultProps = Text.defaultProps || {};
Text.defaultProps.allowFontScaling = false;
Text.defaultProps.maxFontSizeMultiplier = 1; 

/* ---------------------- Sizing ---------------------- */
const rem = Dimensions.get('window').width / 380;
const S = (x) => Math.round(x * rem);
const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;
const TABLE_THREAT_CUTOFF = 0.05;
const LB_PTS_W = 24;
const LB_VAL_W = 44;
const NUM = { fontVariant: ['tabular-nums'] };
const FLIP_WINDOW_MS = 60 * 60 * 1000; // 30 min “files may lag” window
const INTRO_SEEN_KEY = 'threats.intro.v1.seen';


async function getGWFirstSeenTs() {
  try { return Number(await AsyncStorage.getItem('gw.current.t')) || 0; }
  catch { return 0; }
}
function isLikelyStaleEO(map) {
  // minimal heuristic: almost empty = stale
  if (!(map instanceof Map)) return true;
  return map.size < 5; // tweak if needed
}

/* ---------------------- Samples & copy ---------------------- */
const SAMPLE_OPTIONS = [
  { label: 'Top 10k', value: 'top10k' },
  { label: 'Elite',   value: 'elite' },
  { label: 'Near You', value: 'local' },
];

const SAMPLE_COPY = {
  top10k: {
    title: 'Top 10k',
    short: '',
    long:
      'Top 10k compares your team against a sample representing managers currently around the top 10,000 overall ranks. ' +
      'It’s useful to see how popular picks among leading managers impact your rank.',
  },
  elite: {
    title: 'Elite',
    short: '',
    long:
      'Elite compares you to a curated set of historically strong managers. ' +
      'Great for understanding what long-term high performers are doing differently.',
  },
  local: {
    title: 'Near You',
    short: '',
    long:
      'Near You compares you to managers around your current overall rank via a LiveFPL local group. ' +
      'This shows who is threatening or helping your rank in your immediate neighborhood.',
    needsSetup:
      'Near You requires your LiveFPL local group (set after entering your FPL ID on the Rank page).',
  },
};

// 🔹 Human-friendly labels for dynamic copy (added)
const SAMPLE_LABEL = {
  top10k: 'the Top 10k',
  elite: 'Elite managers',
  local: 'your Local group',
};
const SAMPLE_SHORT = {
  top10k: 'Top 10k',
  elite: 'Elite',
  local: 'Local group',
};

const CACHE_TTL_MS = 30_000; // games data cache
const API_URL = 'https://livefpl.us/api/games.json';

/* ---------------------- EO Overlay helpers ---------------------- */
const EO_TTL_MIN = { top10k: 10, elite: 10, local: 10 };
const MS = (min) => min * 60 * 1000;

const normalizePercent = (v) => {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return n >= 0 ? n * 100 : n;
};

async function getGWSalt() {
  try { return await AsyncStorage.getItem('gw.current'); }
  catch { return null; }
}
function buildEOUrl(sample, gw, localNum) {
  const base = 'https://livefpl.us';
  const gwSeg = (Number(gw) > 0) ? `/${Number(gw)}` : '';
  if (sample === 'top10k') return `${base}${gwSeg}/top10k.json`;
  if (sample === 'elite')  return `${base}${gwSeg}/elite.json`;
  if (sample === 'local')  return `${base}${gwSeg}/local_${localNum}.json`;
  return null;
}



const getEOFromStorage = async (key, ttlMs) => {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.t || !parsed?.data) return null;
    if (Date.now() - parsed.t > ttlMs) return null;
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
  const ttlMs = MS(EO_TTL_MIN[sample] || 60);

  const gwRaw = await getGWSalt();
  const gw = Number(gwRaw) || null;                  // used in path segment
  const gwTs = await getGWFirstSeenTs();
  const inFlip = gw && (Date.now() - gwTs < FLIP_WINDOW_MS);

  const gwTag = gw ? `:gw${gw}` : '';
  let key = `EO:${sample}${gwTag}`;
  let url = null;

  if (sample === 'top10k') {
    url = buildEOUrl('top10k', gw);
  } else if (sample === 'elite') {
    url = buildEOUrl('elite', gw);
  } else if (sample === 'local') {
    const myId = await AsyncStorage.getItem('fplId');
    const raw =
      (myId && (await AsyncStorage.getItem(`localGroup:${myId}`))) ||
      (await AsyncStorage.getItem('localGroup'));
    const localNum = raw ? Number(raw) : null;
    if (!localNum) return { map: null, src: 'missing:local' };
    key = `EO:local:${localNum}${gwTag}`;
    url = buildEOUrl('local', gw, localNum);
  } else {
    return { map: null, src: 'none' };
  }

  // Serve from cache unless we're inside the flip window
  if (!inFlip) {
    const cached = await getEOFromStorage(key, ttlMs);
    if (cached) return { map: parseEOJson(cached), src: `cache:${key}` };
  }

  // Fetch (GW now in path; keep cache-buster ?v=)
  const bucket = Math.floor(Date.now() / (inFlip ? 60 * 1000 : ttlMs));
  const fetchUrl = `${url}?v=${bucket}`;
  const res = await fetch(fetchUrl, { headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) throw new Error(`EO HTTP ${res.status}`);

  const json = await res.json();
  await setEOToStorage(key, json);
  let map = parseEOJson(json);

  // Flip-window fallback to previous GW cache if current looks stale
  if (inFlip && isLikelyStaleEO(map) && gw && gw > 1) {
    try {
      const prevKey = key.replace(`:gw${gw}`, `:gw${gw - 1}`);
      const prevCached = await getEOFromStorage(prevKey, Infinity);
      if (prevCached) {
        const prevMap = parseEOJson(prevCached);
        if (!isLikelyStaleEO(prevMap)) {
          return { map: prevMap, src: `fallback:${prevKey}` };
        }
      }
    } catch {}
  }

  return { map, src: `net:${key}` };
}


/* ---------------------- Parsing helpers ---------------------- */
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

function collectPlayersFromGames(json) {
  // id -> { id, name, teamId, type, pts, minutes, statusGuess }
  const byId = new Map();
  (json || []).forEach((game) => {
    const status = String(game?.[4] ?? '').toLowerCase(); // 'live'/'done'/...
    const isLive = /live/.test(status);
    const isDone = /done|official/i.test(status);
    const teamHId = Number(game?.[16] ?? 0);
    const teamAId = Number(game?.[17] ?? 0);
    const tableH = game?.[12] || [];
    const tableA = game?.[13] || [];

    const pushRows = (rows, teamId) => {
      (rows || []).forEach((row) => {
        const [name, _eo, _o, pts, explained, elementId, shortName, type] = row;
        const id = Number(elementId) || null;
        if (!id) return;
        const e = parseExplained(explained);
        const minutes = Number(e?.minutes?.times || 0);
        let statusClass = 'yet';
        if (minutes > 0 && isLive) statusClass = 'live';
        else if (minutes > 0 && !isLive) statusClass = 'played';
        else if (minutes === 0 && isDone) statusClass = 'missed';
        else statusClass = 'yet';

        const prev = byId.get(id) || {};
        if (prev.minutes != null && prev.minutes > minutes) return;

        byId.set(id, {
          id,
          name: shortName || name,
          teamId: Number(teamId) || 0,
          type: Number(type) || 0,
          pts: Number(pts) || 0,
          minutes,
          statusGuess: statusClass,
        });
      });
    };
    pushRows(tableH, teamHId);
    pushRows(tableA, teamAId);
  });
  return byId;
}

/* ---------------------- Small helpers ---------------------- */
const TYPE_LABEL = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
const chunk = (arr, n = 4) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/* ---------------------- Main Screen ---------------------- */
export default function Threats() {
  const C = useColors();
  // Local palette with safe fallbacks
  const P = useMemo(
    () => ({
      bg: C.bg,
      card: C.card,
      ink: C.ink,
      muted: C.muted,
      border: C.border,
      border2: C.border2 ?? C.border,
      accent: C.accent ?? '#60a5fa',
      accentDark: C.accentDark ?? C.accent ?? '#3b82f6',
      ok: C.ok ?? '#22c55e',
      yellow: C.yellow ?? '#f59e0b',
      red: C.red ?? '#ef4444',
      grayStrong: '#111827',
      graySoft: '#e5e7eb',
    }),
    [C]
  );

  const isDark = useMemo(() => {
    const hex = String(P.bg || '#000000').replace('#', '');
    if (hex.length < 6) return true;
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return l < 0.5;
  }, [P.bg]);
const [introOpen, setIntroOpen] = useState(false);

  const [lbExpanded, setLbExpanded] = useState(false);
  const MAX_LB_ROWS = 11;
  const [sample, setSample] = useState('local');
  const [eoMap, setEoMap] = useState(null);
  const [eoErr, setEoErr] = useState('');
  const [dataGames, setDataGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState('');

  const [myExposure, setMyExposure] = useState(null); // { id -> multiplier }
  const [ownedStatus, setOwnedStatus] = useState(new Map()); // id -> 'yet'|'live'|'played'|'missed'
  const [sortKey, setSortKey] = useState('eoVsYouPct'); // 'name' | 'eoVsYouPct' | 'pts' | 'ptsVsYou'
  const [sortDir, setSortDir] = useState('desc');       // 'asc' | 'desc'
  const [infoOpen, setInfoOpen] = useState(false);

  // — Tabs: 'live' | 'diffs' | 'threats'
  const [activeTab, setActiveTab] = useState('live');
  const userTabRef = useRef(false); // becomes true once user clicks a tab

  const handleSort = (key) => {
    const defaultDir = key === 'name' ? 'asc' : 'desc';
    setSortDir((prevDir) => (sortKey === key ? (prevDir === 'asc' ? 'desc' : 'asc') : defaultDir));
    setSortKey(key);
  };

  const cacheRef = useRef(new Map());

  // 🔹 Dynamic labels based on selected sample (added)
  const labels = useMemo(() => {
    const relShort = SAMPLE_SHORT[sample] || 'field';
    const relLong  = SAMPLE_LABEL[sample] || 'the field';
    return {
      // Tabs
      liveSub: `Current LIVE players — your edge vs ${relShort} as points arrive`,

      // Differentials
      diffsTitle: `Your Differentials (vs ${relShort})`,
      diffsSub: `Players you own more than ${relLong}. +% = your edge`,

      // Threats
      threatsTitle: `Main Threats (vs ${relShort})`,
      threatsSub: `Players ${relLong} own more than you. −% = your risk`,

      // Star/Killer/Flop
      trioTitle: 'Star · Killer · Flop',
      trioSub: `Highlights this gameweek (relative to ${relShort})`,

      // Danger Table
      tableTitle: `Danger Table (vs ${relShort})`,
      tableSub: `EO vs You  = ${relShort} ownership − yours · Loss = points lost`,
    };
  }, [sample]);

// derive multiplier from role like in Rank: b=0, c=2, tc=3, starter=1
const deriveMul = (role) => {
  const r = String(role || '').toLowerCase();
  if (r === 'b')  return 0;
  if (r === 'tc') return 3;
  if (r === 'c')  return 2;
  return 1;
};

// Load exposure + ownedStatus for the CURRENT fplId, preferring per-ID cache.
const loadExposureAndStatusForCurrentId = useCallback(async () => {
  try {
    const id = await AsyncStorage.getItem('fplId');
    let payload = null;

    // Try scoped cache first
    const scoped = id && (await AsyncStorage.getItem(`fplData:${id}`));
    if (scoped) {
      const parsed = JSON.parse(scoped);
      payload = parsed?.data || parsed; // tolerate either shape
    } else {
      // Fallback to legacy cache, but only if it matches this id
      const legacyRaw = await AsyncStorage.getItem('fplData');
      if (legacyRaw) {
        const legacy = JSON.parse(legacyRaw);
        if (!legacy?.id || String(legacy.id) === String(id)) {
          payload = legacy?.data || legacy;
        }
      }
    }

    // Absolute fallback to prior loose exposure if nothing else exists
    if (!payload?.team?.length) {
      const rawExp =
        (id && (await AsyncStorage.getItem(`myExposure:${id}`))) ||
        (await AsyncStorage.getItem('myExposure'));
      setMyExposure(rawExp ? JSON.parse(rawExp) : null);
      // Keep old ownedStatus in this rare fallback
      return;
    }

    // Build fresh exposure + ownedStatus from cached team
    const exposure = {};
    const statusMap = new Map();
    for (const p of payload.team) {
      const pid =
        Number(p?.fpl_id ?? p?.element ?? p?.id ?? p?.code) || null;
      if (!pid) continue;

      exposure[pid] = deriveMul(p?.role);

      const s = String(p?.status ?? 'd').toLowerCase();
      const dict = { y: 'yet', m: 'missed', d: 'played', l: 'live' };
      statusMap.set(pid, dict[s] || 'played');
    }

    setMyExposure(exposure);
    setOwnedStatus(statusMap);
  } catch {
    // Safe fallbacks
    setMyExposure(null);
    setOwnedStatus(new Map());
  }
}, []);


  /* Fetch games */
  const fetchGames = useCallback(async (force = false) => {
    setErr('');
    try {
      const gw = await getGWSalt();
    const key = `base${gw ? `:gw${gw}` : ''}`;
      const cached = cacheRef.current.get(key);
      if (!force && cached && Date.now() - cached.t < CACHE_TTL_MS) {
        setDataGames(cached.data);
        setLoading(false);
        setRefreshing(false);
        return;
      }
      const ver = Math.floor(Date.now() / CACHE_TTL_MS);
    const res = await smartFetch(
      `${API_URL}?v=${ver}${gw ? `&gw=${gw}` : ''}`,
      { headers: { 'cache-control': 'no-cache' } }
    );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json)) throw new Error('Bad payload');
      setDataGames(json);
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
      const seen = await AsyncStorage.getItem(INTRO_SEEN_KEY);
      if (!seen) setIntroOpen(true);
    } catch {
      setIntroOpen(true);
    }
  })();
}, []);
const dismissIntro = useCallback(async () => {
  try { await AsyncStorage.setItem(INTRO_SEEN_KEY, '1'); } catch {}
  setIntroOpen(false);
}, []);


/* Load exposure + owned statuses for current ID (from per-ID cache when possible) */
useEffect(() => {
  loadExposureAndStatusForCurrentId();
}, [loadExposureAndStatusForCurrentId]);


  /* EO overlay (based on sample) */
  useEffect(() => {
    let cancelled = false;
    setEoErr('');
    loadEOOverlay(sample)
      .then(({ map }) => { if (!cancelled) setEoMap(map || null); })
      .catch((e) => { if (!cancelled) { setEoMap(null); setEoErr(String(e?.message || e)); } });
    return () => { cancelled = true; };
  }, [sample]);

 useFocusEffect(
  React.useCallback(() => {
    let mounted = true;
    setRefreshing(true);

    const refresh = async () => {
      // 1) Always refresh games on focus (forces recompute for all tabs)
      try {
        await fetchGames(false);
      } catch {}

      // 2) Refresh exposure & owned statuses (as you had)
      // 2) Refresh exposure & owned statuses for CURRENT ID from per-ID cache
try {
  if (!mounted) return;
  await loadExposureAndStatusForCurrentId();
} catch {
  if (mounted) {
    setMyExposure(null);
    setOwnedStatus(new Map());
  }
}


      // 3) Refresh EO overlay for the current sample (as you had)
      try {
        const { map } = await loadEOOverlay(sample);
        if (mounted) setEoMap(map || null);
      } catch (e) {
        if (mounted) {
          setEoMap(null);
          setEoErr(String(e?.message || e));
        }
      }
    };

    refresh().finally(() => mounted && setRefreshing(false));
    return () => { mounted = false; };
  }, [fetchGames, sample,loadExposureAndStatusForCurrentId])
);


  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchGames(true);
  }, [fetchGames]);

  /* ---------- Compute tiles, table, and live battle ---------- */
  const {
    star, killer, flop, diffsSorted, threatsSorted, tableThreats, liveBattle
  } = useMemo(() => {
    const exposure = myExposure || {};
    const overlay = eoMap instanceof Map ? eoMap : new Map();
    const byId = collectPlayersFromGames(dataGames); // id -> {name, teamId, type, pts, minutes, statusGuess}

    const enriched = [];
    byId.forEach((p, id) => {
      const mul = Number(exposure?.[id] ?? 0);   // 0/1/2/3...
      const eoPct = Number(overlay.get(id) || 0);
      const eoFrac = eoPct / 100;
      const net = (mul - eoFrac) * (Number(p.pts) || 0);
      const statusOwned = ownedStatus.get(id) || null;
      enriched.push({ ...p, id, mul, eoPct, eoFrac, net, statusOwned });
    });

    // Only consider players with points on the board
    const skCandidates = enriched.filter(x => Number(x.pts) > 0);

    let starPick = null;
    let killerPick = null;
    if (skCandidates.length) {
      const nets = skCandidates.map(x => Number(x.net) || 0);
      const maxNet = Math.max(...nets);
      const minNet = Math.min(...nets);

      // Hide Star/Killer if all nets are zero
      if (maxNet !== 0) {
        starPick = skCandidates.slice().sort((a, b) => b.net - a.net)[0] || null;
      }
      if (minNet !== 0) {
        killerPick = skCandidates.slice().sort((a, b) => a.net - b.net)[0] || null;
      }
    }

    
    const flopsPool = enriched.filter(
  (x) => x.mul > 0 && x.statusOwned && x.statusOwned !== 'yet' && Number(x.pts || 0) <= 3
);
    let flopPick = null;
if (flopsPool.length) {
  const flopsSorted = flopsPool.slice().sort((a, b) =>
    (Number(a.pts) || 0) - (Number(b.pts) || 0) ||
    (Number(a.eoPct) || 0) - (Number(b.eoPct) || 0)
  );
  flopPick = flopsSorted.find((p) => !starPick || p.id !== starPick.id) || null;
}

    // ——— Your Differentials and Threats (lists) ———
    const diffs = enriched
      .filter((x) => (x.mul - x.eoFrac) >= 0.75 )
      .map((x) => ({ ...x, _label: TYPE_LABEL[x.type] || '', _pctDisplay: (x.mul - x.eoFrac) * 100, _kind: 'diff' }));
    const threats = enriched
      .filter((x) => (x.eoFrac - x.mul) >= 0.30 )
      .map((x) => ({ ...x, _label: TYPE_LABEL[x.type] || '', _pctDisplay: -((x.eoFrac - x.mul) * 100), _kind: 'threat' }));

    const diffsSorted = diffs.slice().sort((a, b) => (b._pctDisplay - a._pctDisplay));
    const threatsSorted = threats.slice().sort((a, b) => (Math.abs(b._pctDisplay) - Math.abs(a._pctDisplay)));

    // ——— Danger Table rows ———
    const tableThreatsBase = enriched
      .filter((x) => (x.eoFrac - x.mul) >= TABLE_THREAT_CUTOFF)
      .map((x) => {
        const eoVsYouPct = (x.eoFrac - x.mul) * 100;
        const ptsVsYou = (x.eoFrac - x.mul) * x.pts;
        const status = x.statusGuess || x.statusOwned || 'yet';


        // Emoji rule
        let threatEmoji = '';
        if ((eoVsYouPct > 50 && status !="played")|| ptsVsYou > 3) {
          threatEmoji = '💀';
        } else if ((eoVsYouPct > 30 && status !="played") || ptsVsYou > 2) {
          threatEmoji = '😈';
        }

        return {
          id: x.id,
          name: x.name,
          teamId: x.teamId,
          status,
          eoVsYouPct,
          pts: x.pts,
          ptsVsYou,
          threatEmoji,
        };
      });

    const tableThreats = tableThreatsBase.slice().sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortKey === 'name') return dir * a.name.localeCompare(b.name);
      const av = Number(a[sortKey] ?? 0);
      const bv = Number(b[sortKey] ?? 0);
      if (av === bv) return a.name.localeCompare(b.name);
      return dir * (av - bv);
    });

    if (starPick) starPick._label = '⭐ Star';
    if (killerPick) killerPick._label = '💀 Killer';
    if (flopPick) flopPick._label = '😵 Flop';

    // -------- Live Battle (only players currently LIVE) --------
    const pickStatus = (x) => x.statusGuess || x.statusOwned || 'yet';


    const liveOnly = enriched.filter((x) => pickStatus(x) === 'live');

    // gain if you own more than the field (mul > eoFrac), loss otherwise
    const gains = [];
    const losses = [];
    for (const x of liveOnly) {
      const gap = x.mul - x.eoFrac;           // positive => your edge
      const contrib = gap * (Number(x.pts) || 0);
      const row = {
        id: x.id,
        name: x.name,
        teamId: x.teamId,
        pts: Number(x.pts) || 0,
        value: contrib,                        // signed contribution
      };
      if (x.mul > 0 && gap > 0) {
        gains.push(row);
      } else {
        losses.push(row);
      }
    }

    // Sort for readability (biggest effects first)
    gains.sort((a, b) => (b.value - a.value) || (b.pts - a.pts));
    losses.sort((a, b) => (Math.abs(b.value) - Math.abs(a.value)) || (b.pts - a.pts));

    const totalGain  = gains.reduce((s, r) => s + r.value, 0);
    const totalLoss  = losses.reduce((s, r) => s + r.value, 0); // this will be ≤ 0
    const netTotal   = totalGain + totalLoss;

    return {
      star: starPick, killer: killerPick, flop: flopPick,
      diffsSorted, threatsSorted, tableThreats,
      liveBattle: { gains, losses, totalGain, totalLoss, netTotal }
    };
  }, [dataGames, eoMap, myExposure, ownedStatus, sortKey, sortDir]);

  // Default tab based on live vs not (unless user picked a tab)
  useEffect(() => {
    const hasLive = !!(liveBattle?.gains?.length || liveBattle?.losses?.length);
    if (!userTabRef.current) {
      setActiveTab(hasLive ? 'live' : 'diffs');
    }
  }, [liveBattle]);

  const inlineHint = useMemo(() => {
    const base = SAMPLE_COPY[sample]?.short || '';
    if (sample === 'local' && /^missing:local/.test(eoErr)) {
      return `${base}  (${SAMPLE_COPY.local.needsSetup})`;
    }
    return base;
  }, [sample, eoErr]);

  /* ---------------------- Styles (theme-aware) ---------------------- */
  const imgwidth = rem * 55;
  const SHIRT_ASPECT = 5.6 / 5;
  const PLAYER_IMAGE_WIDTH = imgwidth * 0.8;
  const PLAYER_IMAGE_HEIGHT = PLAYER_IMAGE_WIDTH / SHIRT_ASPECT;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        safe: { flex: 1, backgroundColor: P.bg },
        center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
        muted: { color: P.muted },

        /* Compare-against (sticky) */
        toolbarWrapSticky: {
          backgroundColor: P.bg,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: P.border,
        },
        toolbar: {
          paddingHorizontal: 12,
          paddingVertical: 8,
          backgroundColor: isDark ? '#0e152a' : '#f7f9ff',
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: P.border,
          borderRadius: 12,
          marginTop: 8,
          marginBottom: 8,
        },
        toolbarRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
        toolbarLabel: { color: isDark ? '#bcd' : '#374151', fontWeight: '800', fontSize: 12, marginRight: 6, alignSelf: 'center' },
        segment: {
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: P.border,
          backgroundColor: isDark ? '#182544' : '#e8efff',
          paddingVertical: 8,
          paddingHorizontal: 12,
          borderRadius: 999,
        },
        segmentActive: {
          backgroundColor: P.accent,
          borderColor: P.accentDark,
        },
        segmentText: {
          color: isDark ? P.ink : '#0b1220',
          fontWeight: '800',
          fontSize: 12,
          letterSpacing: 0.2,
        },
        segmentTextActive: { color: '#ffffff', ...NUM },
        infoBtn: { padding: 8, marginLeft: 'auto' },
        inlineHelp: { color: P.muted, fontSize: 11, marginTop: 6 },

        /* Section titles */
        sectionWrap: { marginTop: 8, marginBottom: 4 },
        sectionTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
        sectionTitleText: { color: P.muted, fontWeight: '800', fontSize: 13, letterSpacing: 0.3 },
        sectionSub: { color: P.muted, fontSize: 11, marginTop: 2 },

        /* Grid */
        gridRow: {
          flexDirection: 'row',
          gap: 3,
          justifyContent: 'space-between',
          marginTop: 3,
        },
        gridCell: { flex: 1, minWidth: 0 },
        tilePlaceholder: { flex: 1, height: PLAYER_IMAGE_HEIGHT + 90 },

        // Individual player unit (now *no* per-card background for grouped sections)
        tileUnit: {
          paddingVertical: 2,
          paddingHorizontal: 2,
          borderRadius: 8,
          alignItems: 'center',
        },

        playerContainer: { alignItems: 'center' },
        imageWrap: {
          width: PLAYER_IMAGE_WIDTH,
          height: undefined,
          aspectRatio: SHIRT_ASPECT,
          position: 'relative',
          alignItems: 'center',
          justifyContent: 'center',
        },
        playerImage: { width: '100%', height: undefined, aspectRatio: SHIRT_ASPECT, resizeMode: 'contain' },
        emojiOnImage: {
          position: 'absolute',
          top: S(6),
          right: S(-12),
          fontSize: S(11),
          includeFontPadding: false,
        },

        // Name/points strips
        playerName: {
          fontSize: 11,
          lineHeight: 14,
          includeFontPadding: false,
          fontWeight: 'bold',
          marginTop: 0,
          marginBottom: 0,
          backgroundColor: '#000000',
          color:  '#ffffff',
          width: imgwidth,
          textAlign: 'center',
          overflow: 'hidden',
          borderTopLeftRadius: 4,
          borderTopRightRadius: 4,
        },

        // Status strips (no rounded bottom)
        played: {
          fontSize: 12,
          lineHeight: 14,
          includeFontPadding: false,
          width: imgwidth,
          textAlign: 'center',
          overflow: 'hidden',
          backgroundColor: isDark ? '#ffffff' : P.graySoft,
          color: P.grayStrong,
          ...NUM,
        },
        live: {
          fontSize: 12,
          lineHeight: 14,
          includeFontPadding: false,
          width: imgwidth,
          textAlign: 'center',
          overflow: 'hidden',
          backgroundColor: P.yellow,
          color: '#141414',
          ...NUM,
        },
        missed: {
          fontSize: 12,
          lineHeight: 14,
          includeFontPadding: false,
          width: imgwidth,
          textAlign: 'center',
          overflow: 'hidden',
          backgroundColor: P.red,
          color: 'white',
          ...NUM,
        },
        yet: {
          fontSize: 12,
          lineHeight: 14,
          includeFontPadding: false,
          width: imgwidth,
          textAlign: 'center',
          overflow: 'hidden',
          backgroundColor: '#1e9770',
          color: 'white',
          ...NUM,
        },

        pctRow: {
          fontSize: 11,
          lineHeight: 12,
          includeFontPadding: false,
          width: imgwidth,
          textAlign: 'center',
          overflow: 'hidden',
          color: 'white',
          borderBottomLeftRadius: 4,
          borderBottomRightRadius: 4,
          ...NUM,
        },
        pctRowGain: { backgroundColor: "lightgreen", color: '#0b1220' },
        pctRowHurt: { backgroundColor: P.red, color: 'white' },

        // Hidden EO bar (kept for possible future)
        EOs: { flexDirection: 'row', width: imgwidth, alignSelf: 'center' },
        EOsRow: { overflow: 'hidden' },
        EO1: {
          fontSize: 9,
          lineHeight: 12,
          includeFontPadding: false,
          backgroundColor: 'white',
          color: 'black',
          width: imgwidth,
          textAlign: 'center',
          overflow: 'hidden',
          display: 'none',
        },

        netChip: {
          marginTop: 6,
          paddingHorizontal: 8,
          paddingVertical: 3,
          borderRadius: 999,
          backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: P.border2,
        },
        netText: { fontSize: 11, fontWeight: '800' },
        netGain: { color: P.ok },
        netHurt: { color: P.red },

        /* NEW: Grouped grid containers (merged cards look) */
        groupCard: {
          backgroundColor: isDark ? P.card : '#f2f2f2',
          borderColor:      isDark ? P.border : '#d9e2ff',
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: 12,
          padding: 8,
          marginTop: 8,
        },
        groupRows: {
          gap: 6,
        },

        /* Main table (Danger Table) */
        tableCard: {
          backgroundColor: P.card,
          borderColor: P.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: 14,
          padding: 10,
          marginTop: 14,
        },
        tableHeaderRow: { backgroundColor: isDark ? '#1a2544' : '#e8efff' },
        tableRow: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 8,
          paddingHorizontal: 6,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: P.border2,
        },
        th: { color: isDark ? P.muted : '#374151', fontWeight: '800', fontSize: 13 },
        td: { color: P.ink, fontSize: 13 },
        tdName: { color: P.ink, fontSize: 13, flexShrink: 1 },
        right: { textAlign: 'right' },
        trAlt: { backgroundColor: 'rgba(255,255,255,0.04)' },
        tableCrest: { width: 20, height: 20, resizeMode: 'contain' },
        tableEmoji: { fontSize: 10 },

        /* clickable headers */
        thCell: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
        },
        thCellRight: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 4,
        },

        /* Status pill inside table */
        statusPill: {
          paddingHorizontal: 8,
          paddingVertical: 3,
          borderRadius: 999,
          borderWidth: StyleSheet.hairlineWidth,
          marginLeft: 6,
        },
        statusPillSmall: { paddingHorizontal: 6, paddingVertical: 2 },
        statusTxt: { fontSize: 10, fontWeight: '900' },
        statusTxtSmall: { fontSize: 7, fontWeight: '900' },

        /* Modal */
        modalBackdrop: {
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.45)',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
        },
        modalCard: {
          width: '100%',
          maxWidth: 480,
          backgroundColor: P.card,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: P.border,
          padding: 16,
        },
        modalTitle: { color: P.ink, fontSize: 18, fontWeight: '900', marginBottom: 8 },
        modalList: { gap: 4 },
        modalItemTitle: { color: P.ink, fontWeight: '800' },
        modalItemText: { color: P.muted, fontSize: 13, lineHeight: 18 },
        modalBtn: {
          alignSelf: 'flex-end',
          marginTop: 12,
          backgroundColor: P.accent,
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: 10,
        },
        modalBtnText: { color: '#ffffff', fontWeight: '900' },

        /* NEW: Tabs — make them visually distinct from compare section */
        tabsStickyWrap: {
          backgroundColor: P.bg,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: P.border,
        },
        tabsWrap: {
          paddingHorizontal: 12,
          paddingTop: 8,
          paddingBottom: 6,
        },
        tabsHeaderRow: {
   flexDirection: 'row',
   alignItems: 'center',
   justifyContent: 'space-between',
   gap: 8,
 },
        tabsRow: {
          flexDirection: 'row',
          gap: 8,
          backgroundColor: isDark ? '#0d152c' : '#eef3ff',
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: P.border,
          borderRadius: 12,
          padding: 4,
          flex:1
        },
        tabsHelpBtn: {
  padding: 6,
   alignSelf: 'center',
 },
        tab: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: 10,
          borderRadius: 10,
          backgroundColor: 'transparent',
          position: 'relative',
        },
        tabActive: {
          backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
        },
        tabText: {
          fontWeight: '900',
          fontSize: 12,
          color: isDark ? P.ink : '#0b1220',
          letterSpacing: 0.2,
        },
        tabTextActive: {
          color: isDark ? '#ffffff' : '#0b1220',
        },
        tabUnderline: {
          position: 'absolute',
          left: 12,
          right: 12,
          bottom: 4,
          height: 3,
          borderRadius: 999,
          backgroundColor: P.accent,
        },

        /* Live Battle */
        liveBattleCard: {
          backgroundColor: P.card,
          borderColor: P.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: 14,
          padding: 10,
          marginTop: 14,
        },
        lbHeader: {
          flexDirection: 'row',
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: P.border2,
          paddingVertical: 8,
          backgroundColor: isDark ? '#1a2544' : '#e8efff',
        },
        lbColTitle: { color: isDark ? P.muted : '#374151', fontWeight: '800', fontSize: 13, textAlign:'center' },
        lbRowWrap: { flexDirection: 'row', minHeight: 44 },
        lbCol: { flex: 1, paddingVertical: 8, paddingHorizontal: 6 },
        lbColRightBorder: { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: P.border2 },

        lbNetBar: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingVertical: 6,
          paddingHorizontal: 6,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: P.border2,
        },
        lbNetText: { fontSize: 13, fontWeight: '900' },
        lbNetPos: { color: P.ok, ...NUM },
        lbNetNeg: { color: P.red, ...NUM },

        lbRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'flex-start',
          paddingVertical: 6,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: P.border2,
        },
        lbNameCell: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, flex:1 },
        lbName: { color: P.ink, fontSize: 13, flexShrink: 1 },
        lbPts: { color: P.ink, fontSize: 13, ...NUM },
        lbValGain: { color: P.ok, fontSize: 13, fontWeight: '800', ...NUM },
        lbValLoss: { color: P.red, fontSize: 13, fontWeight: '800', ...NUM },
        lbFooter: {
          flexDirection: 'row',
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: P.border2,
          marginTop: 6,
          paddingTop: 8,
        },
        lbTotalLabel: { color: P.muted, fontSize: 13, fontWeight: '800' },
      }),
    [P, imgwidth, PLAYER_IMAGE_WIDTH, isDark]
  );

  /* ---------- Small UI components ---------- */
  function SectionTitle({ icon, children, sub }) {
    return (
      <View style={styles.sectionWrap}>
        <View style={styles.sectionTitle}>
          <MaterialCommunityIcons name={icon} size={16} color={P.muted} />
          <Text style={styles.sectionTitleText}>{children}</Text>
        </View>
        {sub ? <Text style={styles.sectionSub}>{sub}</Text> : null}
      </View>
    );
  }

 function SegmentToggle({ sample, setSample, onPressInfo, onPressIntro, inlineHint }) {
    return (
      <View style={styles.toolbarWrapSticky}>
        <View style={styles.toolbar}>
          <View style={styles.toolbarRow}>
            <Text style={styles.toolbarLabel}>Compare against:</Text>
            {SAMPLE_OPTIONS.map((opt) => {
              const active = sample === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => setSample(opt.value)}
                  activeOpacity={0.8}
                  style={[styles.segment, active && styles.segmentActive]}
                >
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              onPress={onPressInfo}
              style={styles.infoBtn}
              accessibilityRole="button"
              accessibilityLabel="What do these mean?"
            >
              <MaterialCommunityIcons name="information-outline" size={18} color={P.muted} />
            </TouchableOpacity>
            
          </View>
          {!!inlineHint && <Text style={styles.inlineHelp}>{inlineHint}</Text>}
        </View>
      </View>
    );
  }

 function TabBar({ onPressIntro }) {
    const tabs = [
      { key: 'live', label: 'Live Battle' },
      { key: 'diffs', label: 'Differentials' },
      { key: 'threats', label: 'Danger Table' },
    ];
    return (
      <View style={styles.tabsStickyWrap}>
        <View style={styles.tabsWrap}>

         <View style={styles.tabsHeaderRow}>
           {/* Tabs group */}
           <View style={styles.tabsRow}>
             {tabs.map((t) => {
               const active = activeTab === t.key;
               return (
                 <TouchableOpacity
                   key={t.key}
                   onPress={() => { userTabRef.current = true; setActiveTab(t.key); }}
                   activeOpacity={0.85}
                   style={[styles.tab, active && styles.tabActive]}
                 >
                   <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
                 </TouchableOpacity>
               );
             })}
           </View>
           {/* Standalone help button */}
           <TouchableOpacity
             onPress={onPressIntro}
             style={styles.tabsHelpBtn}
             hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
             accessibilityRole="button"
             accessibilityLabel="How to read this page?"
           >
             <MaterialCommunityIcons
               name="help-circle-outline"
               size={18}
               color={isDark ? P.ink : '#0b1220'}
             />
           </TouchableOpacity>
         </View>
        </View>
      </View>
    );
  }


  function EOBarSingle({ value }) {
    return (
      <View style={[styles.EOs, styles.EOsRow]}>
        <Text numberOfLines={1} ellipsizeMode="tail" allowFontScaling={false} style={styles.EO1}>
          {Number(value || 0).toFixed(1)}%
        </Text>
      </View>
    );
  }

  // NOTE: tile is now background-less (just a unit) so they sit “merged” in a common card
  function PlayerTile({ item, label, showPct }) {
    const crest = item.teamId ? { uri: clubCrestUri(item.teamId) } : null;
    const statusKey =
  (item.statusOwned === 'live' || item.statusGuess === 'live')
    ? 'live'
    : (item.statusGuess || item.statusOwned || 'yet');
    const statusStyle = styles[statusKey] || styles.played;
    const pctBadge = typeof item._pctDisplay === 'number' ? item._pctDisplay : null;
    const hasPctRow = showPct && pctBadge != null;

    // emoji logic for tiles (kept minimal)
    const isLive = statusKey === 'live';
    const isDone = statusKey === 'played' || statusKey === 'missed';
    const delivered = Number(item.pts) > 3;
    const kind = item._kind === 'threat' ? 'threat' : (item._kind === 'diff' ? 'opportunity' : null);
    let emoji = null;
    if (kind) {
      if (isDone || (isLive && delivered)) {
        emoji = delivered ? (kind === 'threat' ? '😔' : '✅') : (kind === 'threat' ? '😃' : '👎');
      } else if (isLive && !delivered) {
        emoji = '🤞';
      } else {
        emoji = '⏳';
      }
    }

    return (
      <View style={styles.tileUnit}>
        {!!label && <Text style={{ color: P.muted, fontSize: 12, fontWeight: '800', marginBottom: 4 }}>{label}</Text>}
        <View style={styles.playerContainer}>
          <View style={styles.imageWrap}>
            {crest ? <Image source={crest} style={styles.playerImage} /> : <View style={[styles.playerImage]} />}
            {!!emoji && <Text style={styles.emojiOnImage}>{emoji}</Text>}
          </View>

          <Text numberOfLines={1} ellipsizeMode="tail" allowFontScaling={false} style={styles.playerName}>
            {item.name}
          </Text>

          {/* Status strip — no rounded bottom now */}
          <Text numberOfLines={1} ellipsizeMode="tail" allowFontScaling={false} style={statusStyle}>
            {Number(item.pts || 0)}
          </Text>

          {hasPctRow && (
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              allowFontScaling={false}
              style={[styles.pctRow, pctBadge >= 0 ? styles.pctRowGain : styles.pctRowHurt]}
            >
              {pctBadge > 0 ? '+' : ''}{pctBadge.toFixed(0)}%
            </Text>
          )}

          <EOBarSingle value={item.eoPct} />

          <View style={styles.netChip}>
            <Text style={[styles.netText, item.net >= 0 ? styles.netGain : styles.netHurt, NUM]}>
              {item.net >= 0 ? '+' : ''}{item.net.toFixed(1)} pts
            </Text>
          </View>
        </View>
      </View>
    );
  }

  // NEW: Grouped grid section — merges all tiles in one shared card background
  function GroupedGridSection({ title, icon, sub, data, showPct }) {
    if (!data || data.length === 0) return null;
    const rows = chunk(data, 4);
    return (
      <View style={styles.groupCard}>
        <SectionTitle icon={icon} sub={sub}>{title}</SectionTitle>
        <View style={styles.groupRows}>
          {rows.map((r, idx) => (
            <View key={`row-${idx}`} style={styles.gridRow}>
              {r.map((p) => (
                <View key={`p-${p.id}`} style={styles.gridCell}>
                  <PlayerTile item={p} label={p._label || ''} showPct={showPct} />
                </View>
              ))}
            </View>
          ))}
        </View>
      </View>
    );
  }

  // Status pill meta
  const statusMeta = useMemo(() => ({
    live:   { bg: P.yellow, text: P.grayStrong, edge: P.yellow, label: 'LIVE' },
    played: { bg: isDark ? '#ffffff' : P.graySoft, text: P.grayStrong, edge: isDark ? '#ffffff' : P.graySoft, label: 'PLAYED' },
    missed: { bg: P.red, text: '#ffffff', edge: P.red, label: 'MISSED' },
    yet:    { bg: P.ok, text: '#ffffff', edge: P.ok, label: 'YET' },
  }), [P, isDark]);

  function StatusPill({ status, small }) {
    const meta = statusMeta[status] || statusMeta.played;
    return (
      <View style={[
        styles.statusPill,
        small && styles.statusPillSmall,
        { backgroundColor: meta.bg, borderColor: meta.bg },
      ]}>
        <Text style={[
          styles.statusTxt,
          small && styles.statusTxtSmall,
          { color: meta.text },
        ]}>
          {meta.label}
        </Text>
      </View>
    );
  }

  // Trio in same merged grid style
  const trioData = useMemo(() => {
    const arr = [];
    if (star)   arr.push(star);
    if (flop)   arr.push(flop);
    if (killer) arr.push(killer);
    return arr;
  }, [star, flop, killer]);

  /* ---------------------- Render ---------------------- */
  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: P.bg }} edges={['left', 'right']}>
        <AppHeader  />
        <View style={styles.center}>
          <ActivityIndicator color={P.accent} />
          <Text style={styles.muted}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <AppHeader  />

      {err ? <Text style={[styles.muted, { textAlign: 'center', marginTop: 8 }]}>{err}</Text> : null}
      {eoErr ? <Text style={[styles.muted, { textAlign: 'center', marginTop: 4 }]}>EO overlay: {eoErr}</Text> : null}
{/* First-visit Intro Modal */}
<Modal visible={introOpen} transparent animationType="fade" onRequestClose={dismissIntro}>
  <View style={styles.modalBackdrop}>
    <View style={styles.modalCard}>
      <Text style={styles.modalTitle}>How to read this page</Text>

      <View style={styles.modalList}>
        <Text style={styles.modalItemTitle}>• Differentials</Text>
        <Text style={styles.modalItemText}>
          Your biggest potential rank boosters this week — players you own much more than the comparison group.
        </Text>

        <Text style={[styles.modalItemTitle, { marginTop: 10 }]}>• Choose a sample</Text>
        <Text style={styles.modalItemText}>
          Compare vs Top 10k / Elite / Near You. “Near You” is default and best for seeing the immediate effect on your rank.
        </Text>

        <Text style={[styles.modalItemTitle, { marginTop: 10 }]}>• Main threats</Text>
        <Text style={styles.modalItemText}>
          Players the comparison group owns more than you — they’re most likely to hurt your rank.
        </Text>

        <Text style={[styles.modalItemTitle, { marginTop: 10 }]}>• Danger Table</Text>
        <Text style={styles.modalItemText}>
          Tap the <Text style={{fontWeight: '800'}}>Danger Table</Text> tab for the full, sortable list of threats.
        </Text>

        <Text style={[styles.modalItemTitle, { marginTop: 10 }]}>• Live Battle</Text>
        <Text style={styles.modalItemText}>
          Real-time swings — see how much you’re gaining or losing right now, player by player.
        </Text>
      </View>

      <TouchableOpacity style={styles.modalBtn} onPress={dismissIntro} activeOpacity={0.8}>
        <Text style={styles.modalBtnText}>Got it</Text>
      </TouchableOpacity>
    </View>
  </View>
</Modal>

      {/* Info modal for explaining samples */}
      <Modal visible={infoOpen} transparent animationType="fade" onRequestClose={() => setInfoOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Comparison Samples</Text>
            <View style={styles.modalList}>
              <Text style={styles.modalItemTitle}>• {SAMPLE_COPY.top10k.title}</Text>
              <Text style={styles.modalItemText}>{SAMPLE_COPY.top10k.long}</Text>

              <Text style={[styles.modalItemTitle, { marginTop: 10 }]}>• {SAMPLE_COPY.elite.title}</Text>
              <Text style={styles.modalItemText}>
  {SAMPLE_COPY.elite.long}{' '}
  <Text style={styles.link} onPress={() => Linking.openURL('https://www.livefpl.net/elite')}>
    Here is a list of the elite managers and links to their teams →
  </Text>
</Text>


              <Text style={[styles.modalItemTitle, { marginTop: 10 }]}>• {SAMPLE_COPY.local.title}</Text>
              <Text style={styles.modalItemText}>{SAMPLE_COPY.local.long}</Text>
              <Text style={[styles.modalItemText, { opacity: 0.85 }]}>{SAMPLE_COPY.local.needsSetup}</Text>
            </View>

            <TouchableOpacity style={styles.modalBtn} onPress={() => setInfoOpen(false)} activeOpacity={0.8}>
              <Text style={styles.modalBtnText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={P.accent} />}
        stickyHeaderIndices={[0, 1]} // keep "Compare against" AND the Tabs sticky
      >
        {/* Sticky header: Compare against */}
        <SegmentToggle
          sample={sample}
          setSample={setSample}
          onPressInfo={() => setInfoOpen(true)}
          onPressIntro={() => setIntroOpen(true)}
          inlineHint={inlineHint}
        />

        {/* Sticky header: Tabs (now visually distinct) */}
        <TabBar onPressIntro={() => setIntroOpen(true)} />

        {/* --- Tab: Live Battle --- */}
        {activeTab === 'live' && (
          (liveBattle?.gains?.length || liveBattle?.losses?.length) ? (
            <View style={styles.liveBattleCard}>
              <SectionTitle icon="sword-cross" sub={labels.liveSub}>
                Live Battle
              </SectionTitle>

              {/* Net total across gains + losses */}
              <View style={styles.lbNetBar}>
                <Text style={styles.lbTotalLabel}>Net (Gains + Losses)</Text>
                <Text
                  style={[
                    styles.lbNetText,
                    (liveBattle.netTotal >= 0) ? styles.lbNetPos : styles.lbNetNeg,
                  ]}
                >
                  {liveBattle.netTotal >= 0 ? '+' : ''}{liveBattle.netTotal.toFixed(2)}
                </Text>
              </View>

              {/* Header */}
              <View style={styles.lbHeader}>
                <View style={[styles.lbCol, styles.lbColRightBorder]}>
                  <Text style={styles.lbColTitle}>Gains</Text>
                </View>
                <View style={styles.lbCol}>
                  <Text style={styles.lbColTitle}>Losses</Text>
                </View>
              </View>

              {/* Rows: render side-by-side lists */}
              <View style={styles.lbRowWrap}>
                {/* Gains column */}
                <View style={[styles.lbCol, styles.lbColRightBorder]}>
                  {/* header row for gains */}
                  <View style={styles.lbRow}>
                    <Text style={[styles.muted, { flex: 1 }]}>Player</Text>
                    <Text style={[styles.muted, { width: LB_PTS_W, textAlign: 'right' }]}>Pts</Text>
                    <Text style={[styles.muted, { width: LB_VAL_W, textAlign: 'right' }]}>Gain</Text>
                  </View>
                  {(liveBattle.gains.length
                    ? (lbExpanded ? liveBattle.gains : liveBattle.gains.slice(0, MAX_LB_ROWS))
                    : [{ id:'_g0', name:'—', pts:0, value:0 }]
                  ).map((r, i) => (
                    <View key={`g-${r.id}-${i}`} style={styles.lbRow}>
                      <View style={styles.lbNameCell}>
                        {!!r.teamId && <Image source={{ uri: clubCrestUri(r.teamId) }} style={styles.tableCrest} />}
                        <Text numberOfLines={1} style={styles.lbName}>{r.name}</Text>
                      </View>
                      <Text style={[styles.lbPts, { width: LB_PTS_W, textAlign: 'right' }]}>{r.pts}</Text>
                      <Text style={[styles.lbValGain, { width: LB_VAL_W, textAlign: 'right' }]}>
                        {r.value >= 0 ? '+' : ''}{r.value.toFixed(1)}
                      </Text>
                    </View>
                  ))}
                </View>

                {/* Losses column */}
                <View style={styles.lbCol}>
                  {/* header row for losses */}
                  <View style={styles.lbRow}>
                    <Text style={[styles.muted, { flex: 1 }]}>Player</Text>
                    <Text style={[styles.muted, { width: LB_PTS_W, textAlign: 'right' }]}>Pts</Text>
                    <Text style={[styles.muted, { width: LB_VAL_W, textAlign: 'right' }]}>Loss</Text>
                  </View>
                  {(liveBattle.losses.length
                    ? (lbExpanded ? liveBattle.losses : liveBattle.losses.slice(0, MAX_LB_ROWS))
                    : [{ id:'_l0', name:'—', pts:0, value:0 }]
                  ).map((r, i) => (
                    <View key={`l-${r.id}-${i}`} style={styles.lbRow}>
                      <View style={styles.lbNameCell}>
                        {!!r.teamId && <Image source={{ uri: clubCrestUri(r.teamId) }} style={styles.tableCrest} />}
                        <Text numberOfLines={1} style={styles.lbName}>{r.name}</Text>
                      </View>
                      <Text style={[styles.lbPts, { width: LB_PTS_W, textAlign: 'right' }]}>{r.pts}</Text>
                      <Text style={[styles.lbValLoss, { width: LB_VAL_W, textAlign: 'right' }]}>
                        {r.value.toFixed(1)}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>

              {/* Expand/Collapse */}
              {(liveBattle.gains.length > MAX_LB_ROWS || liveBattle.losses.length > MAX_LB_ROWS) && (
                <View style={{ alignItems: 'center', paddingTop: 6 }}>
                  <TouchableOpacity
                    onPress={() => setLbExpanded((v) => !v)}
                    style={{
                      paddingHorizontal: 12, paddingVertical: 6,
                      borderRadius: 999, borderWidth: StyleSheet.hairlineWidth,
                      borderColor: P.border2,
                      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={{ color: P.ink, fontWeight: '800', fontSize: 12 }}>
                      {lbExpanded
                        ? 'Show fewer'
                        : `Show all (${Math.max(
                            liveBattle.gains.length - MAX_LB_ROWS,
                            liveBattle.losses.length - MAX_LB_ROWS,
                          )} more)`}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Totals */}
              <View style={styles.lbFooter}>
                <View style={[styles.lbCol, styles.lbColRightBorder]}>
                  <View style={[styles.lbRow, { paddingVertical: 2 }]}>
                    <Text style={styles.lbTotalLabel}>Total</Text>
                    <Text style={[styles.lbValGain, { marginLeft: 'auto' }]}>
                      {liveBattle.totalGain >= 0 ? '+' : ''}{liveBattle.totalGain.toFixed(2)}
                    </Text>
                  </View>
                </View>
                <View style={styles.lbCol}>
                  <View style={[styles.lbRow, { paddingVertical: 2 }]}>
                    <Text style={styles.lbTotalLabel}>Total</Text>
                    <Text style={[styles.lbValLoss, { marginLeft: 'auto' }]}>
                      {liveBattle.totalLoss.toFixed(2)}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          ) : (
            <Text style={[styles.muted, { marginTop: 10 }]}>No live players right now.</Text>
          )
        )}

        {/* --- Tab: Differentials (merged) --- */}
        {activeTab === 'diffs' && (
          <>
            {/* Your Differentials — merged group */}
            <GroupedGridSection
              title={labels.diffsTitle}
              sub={labels.diffsSub}
              icon="star-four-points-outline"
              data={diffsSorted}
              showPct
            />

            {/* Threats — merged group */}
            <GroupedGridSection
              title={labels.threatsTitle}
              sub={labels.threatsSub}
              icon="alert-outline"
              data={threatsSorted}
              showPct
            />

            {/* Star · Killer · Flop — merged group */}
            <GroupedGridSection
              title={labels.trioTitle}
              sub={labels.trioSub}
              icon="star-four-points-outline"
              data={trioData}
              showPct={false}
            />
          </>
        )}

        {/* --- Tab: Danger Table --- */}
        {activeTab === 'threats' && tableThreats.length > 0 && (
          <View style={styles.tableCard}>
            <SectionTitle icon="table" sub={labels.tableSub}>
              {labels.tableTitle}
            </SectionTitle>

            <View style={[styles.tableHeaderRow, styles.tableRow]}>
              <TouchableOpacity
                style={[styles.thCell, { flex: 2.8 }]}
                onPress={() => handleSort('name')}
                activeOpacity={0.7}
              >
                <Text style={[styles.th]}>Player</Text>
                {sortKey === 'name' && (
                  <MaterialCommunityIcons
                    name={sortDir === 'asc' ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={P.ink}
                  />
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.thCellRight, { flex: 1 }]}
                onPress={() => handleSort('eoVsYouPct')}
                activeOpacity={0.7}
              >
                <Text style={[styles.th, styles.right]}>EO</Text>
                {sortKey === 'eoVsYouPct' && (
                  <MaterialCommunityIcons
                    name={sortDir === 'asc' ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={P.ink}
                  />
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.thCellRight, { flex: 0.9 }]}
                onPress={() => handleSort('pts')}
                activeOpacity={0.7}
              >
                <Text style={[styles.th, styles.right]}>Pts</Text>
                {sortKey === 'pts' && (
                  <MaterialCommunityIcons
                    name={sortDir === 'asc' ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={P.ink}
                  />
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.thCellRight, { flex: 1.2 }]}
                onPress={() => handleSort('ptsVsYou')}
                activeOpacity={0.7}
              >
                <Text style={[styles.th, styles.right]}>Loss</Text>
                {sortKey === 'ptsVsYou' && (
                  <MaterialCommunityIcons
                    name={sortDir === 'asc' ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={P.ink}
                  />
                )}
              </TouchableOpacity>
            </View>

            <ScrollView>
              {tableThreats.map((t, i) => (
                <View
                  key={`tr-${t.id}-${i}`}
                  style={[
                    styles.tableRow,
                    i % 2 ? styles.trAlt : null,
                  ]}
                >
                  <View style={{ flex: 2.8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {!!t.teamId && <Image source={{ uri: clubCrestUri(t.teamId) }} style={styles.tableCrest} />}
                    <Text style={styles.tdName} numberOfLines={1}>{t.name}</Text>
                    <StatusPill status={t.status} small />
                    {!!t.threatEmoji && <Text style={styles.tableEmoji}>{t.threatEmoji}</Text>}
                  </View>
                  <Text style={[styles.td, styles.right, { flex: 1 }, NUM]}>{t.eoVsYouPct.toFixed(1)}%</Text>
                  <Text style={[styles.td, styles.right, { flex: 0.9 }, NUM]}>{Number(t.pts || 0)}</Text>
                  <Text style={[styles.td, styles.right, { flex: 1.2 }, NUM]}>{t.ptsVsYou.toFixed(2)}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
