// threats.js — Averages picker + Most-Selected XI + redesigned Live/Diffs/All
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
  Alert,
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
const TABLE_THREAT_CUTOFF = 0.05;
const LB_PTS_W = 24;
const LB_VAL_W = 44;
const NUM = { fontVariant: ['tabular-nums'] };
const FLIP_WINDOW_MS = 60 * 60 * 1000;
const INTRO_SEEN_KEY = 'threats.intro.v1.seen';
const imgwidth = rem * 55;
const SHIRT_ASPECT = 5.6 / 5;
const PLAYER_IMAGE_WIDTH = imgwidth * 0.8;
const PLAYER_IMAGE_HEIGHT = PLAYER_IMAGE_WIDTH / SHIRT_ASPECT;

async function getGWFirstSeenTs() {
  try { return Number(await AsyncStorage.getItem('gw.current.t')) || 0; }
  catch { return 0; }
}
function isLikelyStaleEO(map) {
  if (!(map instanceof Map)) return true;
  return map.size < 5;
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
      'Top 10k compares your team against a sample representing managers currently around the top 10,000 overall ranks.',
  },
  elite: {
    title: 'Elite',
    short: '',
    long:
      'Elite compares you to a curated set of historically strong managers.',
  },
  local: {
    title: 'Near You',
    short: '',
    long:
      'Near You compares you to managers around your current overall rank via a LiveFPL local group.',
    needsSetup:
      'Near You requires your LiveFPL local group (set after entering your FPL ID on the Rank page).',
  },
};

const SAMPLE_SHORT = { top10k: 'Top 10k', elite: 'Elite', local: 'local group' };
// Unified emoji set used across tiles and the Danger Table
const EMOJI = {
  THREAT_SEVERE: '💀',
  THREAT_MEDIUM: '😈',
  STAR: '⭐',
  KILLER: '💀',
  FLOP: '😵',
  DELIVERED_GOOD: '✅',
  DELIVERED_BAD: '👎',
  LIVE_HOPE: '🤞',
  WAITING: '⏳',
};

const CACHE_TTL_MS = 30_000;
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
  } catch { return null; }
};
const setEOToStorage = async (key, data) => {
  try { await AsyncStorage.setItem(key, JSON.stringify({ t: Date.now(), data })); } catch {}
};

const parseEOJsonWithMeta = (json) => {
  const map = new Map();
  let hits = 0; // average points deducted for hits in the sample (points, neg)
  if (!json) return { map, hits };
  const setPair = (keyRaw, val) => {
    const k = Number(keyRaw);
    if (k === -2) {
      const h = Number(val);
      if (isFinite(h)) hits = h;
      return;
    }
    if (val == null) return;
    if (typeof val === 'number') {
      map.set(k, normalizePercent(val));
    } else if (typeof val === 'object') {
      const eo = val.eo ?? val.EO ?? val.effective_ownership ?? val.effectiveOwnership ?? val.effective ?? val.value;
      if (eo != null) map.set(k, normalizePercent(eo));
    }
  };
  if (!Array.isArray(json) && typeof json === 'object') {
    for (const [k, v] of Object.entries(json)) setPair(k, v);
    return { map, hits };
  }
  if (Array.isArray(json)) {
    for (const item of json) {
      if (!item || typeof item !== 'object') continue;
      const id = item.id ?? item.element ?? item.element_id ?? item.pid ?? item.player_id;
      if (id != null) {
        const eo = item.eo ?? item.EO ?? item.effective_ownership ?? item.effectiveOwnership ?? item.effective ?? item.value;
        setPair(id, eo);
      }
      if (item.key === -2 || item.id === -2) {
        setPair(-2, item.value ?? item.eo ?? item.hits);
      }
    }
  }
  return { map, hits };
};

async function loadEOOverlay(sample) {
  const ttlMs = MS(EO_TTL_MIN[sample] || 60);
  const gwRaw = await getGWSalt();
  const gw = Number(gwRaw) || null;
  const gwTs = await getGWFirstSeenTs();
  const inFlip = gw && (Date.now() - gwTs < FLIP_WINDOW_MS);
  const gwTag = gw ? `:gw${gw}` : '';
  let key = `EO:${sample}${gwTag}`;
  let url = null;

  if (sample === 'top10k') url = buildEOUrl('top10k', gw);
  else if (sample === 'elite') url = buildEOUrl('elite', gw);
  else if (sample === 'local') {
    const myId = await AsyncStorage.getItem('fplId');
    const raw =
      (myId && (await AsyncStorage.getItem(`localGroup:${myId}`))) ||
      (await AsyncStorage.getItem('localGroup'));
    const localNum = raw ? Number(raw) : null;
    if (!localNum) return { map: null, hits: 0, src: 'missing:local' };
    key = `EO:local:${localNum}${gwTag}`;
    url = buildEOUrl('local', gw, localNum);
  } else {
    return { map: null, hits: 0, src: 'none' };
  }

  if (!inFlip) {
    const cached = await getEOFromStorage(key, ttlMs);
    if (cached) {
      const { map, hits } = parseEOJsonWithMeta(cached);
      return { map, hits, src: `cache:${key}` };
    }
  }

  const bucket = Math.floor(Date.now() / (inFlip ? 60 * 1000 : ttlMs));
  const res = await fetch(`${url}?v=${bucket}`, { headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) throw new Error(`EO HTTP ${res.status}`);
  const json = await res.json();
  await setEOToStorage(key, json);
  let { map, hits } = parseEOJsonWithMeta(json);

  if (inFlip && isLikelyStaleEO(map) && gw && gw > 1) {
    try {
      const prevKey = key.replace(`:gw${gw}`, `:gw${gw - 1}`);
      const prevCached = await getEOFromStorage(prevKey, Infinity);
      if (prevCached) {
        const prev = parseEOJsonWithMeta(prevCached);
        if (!isLikelyStaleEO(prev.map)) {
          return { map: prev.map, hits: prev.hits, src: `fallback:${prevKey}` };
        }
      }
    } catch {}
  }
  return { map, hits, src: `net:${key}` };
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
    const status = String(game?.[4] ?? '').toLowerCase();
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
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

/* ---------------------- NEW: totals ---------------------- */
function sumEOPlayers(overlay) {
  if (!(overlay instanceof Map)) return 0;
  let s = 0;
  for (const [k, v] of overlay.entries()) {
    const id = Number(k);
    if (id >= 1) s += (Number(v) || 0) / 100;
  }
  return s;
}

/* ---------------------- Locals API ---------------------- */
async function fetchLocalsForGW() {
  const gwRaw = await getGWSalt();
  const gw = Number(gwRaw) || null;
  const url = `https://livefpl.us/locals_${gw || 0}.json`;
  const r = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
  if (!r.ok) throw new Error(`locals HTTP ${r.status}`);
  const j = await r.json();
  return j;
}

/* ---------------------- Main Screen ---------------------- */
export default function Threats() {
  const C = useColors();
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

const [tableSearch, setTableSearch] = useState('');

  const [introOpen, setIntroOpen] = useState(false);
  const [localGroupNum, setLocalGroupNum] = useState(null);
  const [infoOpen, setInfoOpen] = useState(false);
const [myHit, setMyHit] = useState(0); // points (usually negative)
  const [lbExpanded, setLbExpanded] = useState(false);

  const [sample, setSample] = useState('local');
  const [eoMap, setEoMap] = useState(null);
  const [sampleHits, setSampleHits] = useState(0);
  const [eoErr, setEoErr] = useState('');
  const [dataGames, setDataGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState('');

  const [myExposure, setMyExposure] = useState(null); // { id -> multiplier }
  const [ownedStatus, setOwnedStatus] = useState(new Map()); // id -> 'yet'|'live'|'played'|'missed'
  const [sortKey, setSortKey] = useState('eoVsYouPct');
  const [sortDir, setSortDir] = useState('desc');
  const userTabRef = useRef(false);

  // locals API
  const [localsMeta, setLocalsMeta] = useState(null); // {curgw, locals:[]}
  const [localsErr, setLocalsErr] = useState('');
  const [avgPickerOpen, setAvgPickerOpen] = useState(false);
  const [avgPickKey, setAvgPickKey] = useState(null); // 'elite' | 'top10k' | 'local:<num>' | 'index:<i>' | 'overall' | etc.

  const cacheRef = useRef(new Map());

  const labels = useMemo(() => {
    const relShort = SAMPLE_SHORT[sample] || 'field';
    return {
      liveSub: `Current LIVE players — your edge vs ${relShort} as points arrive`,
      diffsTitle: `Your Differentials (vs ${relShort})`,
      diffsSub: `Players you own more than the ${relShort}. +% = your edge`,
      threatsTitle: `Main Threats (vs ${relShort})`,
      threatsSub: `Players the ${relShort} own more than you. −% = your risk`,
      trioTitle: 'Star · Killer · Flop',
      trioSub: `Highlights this gameweek (relative to ${relShort})`,
      tableTitle: `Danger Table (vs ${relShort})`,
      tableSub: `EO vs You = ${relShort} ownership − yours · Loss = points lost`,
      avgTitle: `Averages (You vs ${relShort})`,
      avgSub: `Effective players: start=1×, C=2×, TC=3×. Score includes autosubs and hits (from sample metadata).`,
    };
  }, [sample]);

  const deriveMul = (role) => {
    const r = String(role || '').toLowerCase();
    if (r === 'b')  return 0;
    if (r === 'tc') return 3;
    if (r === 'c')  return 2;
    return 1;
  };

  const [activeTab, setActiveTab] = useState('live');

  const loadExposureAndStatusForCurrentId = useCallback(async () => {
    try {
      const id = await AsyncStorage.getItem('fplId');
      let payload = null;
      const scoped = id && (await AsyncStorage.getItem(`fplData:${id}`));
      if (scoped) {
        const parsed = JSON.parse(scoped);
        payload = parsed?.data || parsed;
      } else {
        const legacyRaw = await AsyncStorage.getItem('fplData');
        if (legacyRaw) {
          const legacy = JSON.parse(legacyRaw);
          if (!legacy?.id || String(legacy.id) === String(id)) {
            payload = legacy?.data || legacy;
          }
        }
      }
       setMyHit(0);
       
      if (!payload?.team?.length) {
        const rawExp =
          (id && (await AsyncStorage.getItem(`myExposure:${id}`))) ||
          (await AsyncStorage.getItem('myExposure'));
        setMyExposure(rawExp ? JSON.parse(rawExp) : null);
        return;
      }
      const exposure = {};
      const statusMap = new Map();
      for (const p of payload.team) {
        const pid = Number(p?.fpl_id ?? p?.element ?? p?.id ?? p?.code) || null;
        if (!pid) continue;
        exposure[pid] = deriveMul(p?.role);
        const s = String(p?.status ?? 'd').toLowerCase();
        const dict = { y: 'yet', m: 'missed', d: 'played', l: 'live' };
        statusMap.set(pid, dict[s] || 'played');
      }
      setMyExposure(exposure);
      setOwnedStatus(statusMap);
    } catch {
      setMyExposure(null);
      setOwnedStatus(new Map());
    }
  }, []);

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

  // Keep the Averages picker selection in sync with the top "Compare against" segment
  useEffect(() => {
    if (sample === 'elite') {
      setAvgPickKey('elite');
    } else if (sample === 'top10k') {
      setAvgPickKey('top10k');
    } else if (sample === 'local') {
      if (localGroupNum != null) {
        setAvgPickKey(`local:${localGroupNum}`);
      } else {
        // fallback label until local resolves
        setAvgPickKey(null);
      }
    }
  }, [sample, localGroupNum]);

  // keep localGroupNum in state
  useEffect(() => {
    if (sample !== 'local') { setLocalGroupNum(null); return; }
    (async () => {
      try {
        const id = await AsyncStorage.getItem('fplId');
        const raw =
          (id && (await AsyncStorage.getItem(`localGroup:${id}`))) ||
          (await AsyncStorage.getItem('localGroup'));
        const n = raw ? Number(raw) : null;
        setLocalGroupNum(Number.isFinite(n) ? n : null);
      } catch {
        setLocalGroupNum(null);
      }
    })();
  }, [sample]);

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

  useEffect(() => {
    loadExposureAndStatusForCurrentId();
  }, [loadExposureAndStatusForCurrentId]);

  // EO overlay
  useEffect(() => {
    let cancelled = false;
    setEoErr('');
    loadEOOverlay(sample)
      .then(({ map, hits }) => {
        if (!cancelled) {
          setEoMap(map || null);
          setSampleHits(Number(hits) || 0);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setEoMap(null);
          setSampleHits(0);
          setEoErr(String(e?.message || e));
        }
      });
    return () => { cancelled = true; };
  }, [sample]);

  // locals
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const j = await fetchLocalsForGW();
        if (!mounted) return;
        setLocalsMeta(j);
      } catch (e) {
        if (!mounted) return;
        setLocalsErr(String(e?.message || e));
      }
    })();
    return () => { mounted = false; };
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      let mounted = true;
      setRefreshing(true);
      const refresh = async () => {
        try { await fetchGames(false); } catch {}
        try {
          if (!mounted) return;
          await loadExposureAndStatusForCurrentId();
        } catch {
          if (mounted) {
            setMyExposure(null);
            setOwnedStatus(new Map());
          }
        }
        try {
          const { map, hits } = await loadEOOverlay(sample);
          if (mounted) {
            setEoMap(map || null);
            setSampleHits(Number(hits) || 0);
          }
        } catch (e) {
          if (mounted) {
            setEoMap(null);
            setSampleHits(0);
            setEoErr(String(e?.message || e));
          }
        }
      };
      refresh().finally(() => mounted && setRefreshing(false));
      return () => { mounted = false; };
    }, [fetchGames, sample, loadExposureAndStatusForCurrentId])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchGames(true);
  }, [fetchGames]);

  /* ---------- Compute collections from games + EO + exposure ---------- */
  const byId = useMemo(() => collectPlayersFromGames(dataGames), [dataGames]);

  const {
    star, killer, flop, diffsSorted, threatsSorted, tableThreats, liveBattle, averages
  } = useMemo(() => {
    const exposure = myExposure || {};
    const overlay = eoMap instanceof Map ? eoMap : new Map();

    // union of ids
    const idSet = new Set([
      ...byId.keys(),
      ...Object.keys(exposure || {}).map((k) => Number(k)),
      ...Array.from(overlay.keys()).filter((k) => Number(k) >= 1),
    ]);
    const enriched = [];
    for (const id of idSet) {
      const p = byId.get(id) || { id, name: '', teamId: 0, type: 0, pts: 0, minutes: 0, statusGuess: 'played' };
      const mul = Number(exposure?.[id] ?? 0);
      const eoPct = Number(overlay.get(id) || 0);
      const eoFrac = eoPct / 100;
      const net = (mul - eoFrac) * (Number(p.pts) || 0);
      const statusOwned = ownedStatus.get(id) || null;
      enriched.push({ ...p, id, mul, eoPct, eoFrac, net, statusOwned });
    }

    // star/killer/flop
    const skCandidates = enriched.filter(x => Number(x.pts) > 0);
    let starPick = null, killerPick = null;
    if (skCandidates.length) {
      const nets = skCandidates.map(x => Number(x.net) || 0);
      const maxNet = Math.max(...nets);
      const minNet = Math.min(...nets);
      if (maxNet !== 0) starPick = skCandidates.slice().sort((a, b) => b.net - a.net)[0] || null;
      if (minNet !== 0) killerPick = skCandidates.slice().sort((a, b) => a.net - b.net)[0] || null;
    }
    const flopsPool = enriched.filter(
      (x) => x.mul > 0 && (x.statusOwned && x.statusOwned !== 'yet') && Number(x.pts || 0) <= 3
    );
    let flopPick = null;
    if (flopsPool.length) {
      const flopsSorted = flopsPool.slice().sort((a, b) =>
        (Number(a.pts) || 0) - (Number(b.pts) || 0) ||
        (Number(a.eoPct) || 0) - (Number(b.eoPct) || 0)
      );
      flopPick = flopsSorted.find((p) => !starPick || p.id !== starPick.id) || null;
    }

    // lists
    const diffs = enriched
      .filter((x) => (x.mul - x.eoFrac) >= 0.75 )
      .map((x) => ({ ...x, _label: TYPE_LABEL[x.type] || '', _pctDisplay: (x.mul - x.eoFrac) * 100, _kind: 'diff' }));
    const threats = enriched
      .filter((x) => (x.eoFrac - x.mul) >= 0.30 )
      .map((x) => ({ ...x, _label: TYPE_LABEL[x.type] || '', _pctDisplay: -((x.eoFrac - x.mul) * 100), _kind: 'threat' }));

    const diffsSorted = diffs.slice().sort((a, b) => (b._pctDisplay - a._pctDisplay));
    const threatsSorted = threats.slice().sort((a, b) => (Math.abs(b._pctDisplay) - Math.abs(a._pctDisplay)));

    const tableThreatsBase = enriched
      .filter((x) => (x.eoFrac - x.mul) >= TABLE_THREAT_CUTOFF)
      .map((x) => {
        const eoVsYouPct = (x.eoFrac - x.mul) * 100;
        const ptsVsYou   = (x.eoFrac - x.mul) * x.pts;
        const status     = x.statusGuess || x.statusOwned || 'yet';
        // Emoji rule mirrored across UI
        let emoji = '';
        if ((eoVsYouPct > 50 && status !== 'played') || ptsVsYou > 3) {
          emoji = EMOJI.THREAT_SEVERE;
        } else if ((eoVsYouPct > 30 && status !== 'played') || ptsVsYou > 2) {
          emoji = EMOJI.THREAT_MEDIUM;
        }
        return {
          id: x.id,
          name: x.name,
          teamId: x.teamId,
          status,
          eoVsYouPct,
          pts: x.pts,
          ptsVsYou,
          emoji,
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

    // Live battle
    const pickStatus = (x) => x.statusGuess || x.statusOwned || 'yet';
    const liveOnly = enriched.filter((x) => pickStatus(x) === 'live');
    const gains = [], losses = [];
    for (const x of liveOnly) {
      const gap = x.mul - x.eoFrac;
      const contrib = gap * (Number(x.pts) || 0);
      const row = { id: x.id, name: x.name, teamId: x.teamId, pts: Number(x.pts) || 0, value: contrib };
      if (x.mul > 0 && gap > 0) gains.push(row);
      else losses.push(row);
    }
    gains.sort((a, b) => (b.value - a.value) || (b.pts - a.pts));
    losses.sort((a, b) => (Math.abs(b.value) - Math.abs(a.pts)) || (b.pts - a.pts));
    const totalGain  = gains.reduce((s, r) => s + r.value, 0);
    const totalLoss  = losses.reduce((s, r) => s + r.value, 0);
    const netTotal   = totalGain + totalLoss;

    // averages
    let youPlayed = 0, youLive = 0, youLeft = 0, youScore = 0;
    let smpPlayed = 0, smpLive = 0, smpLeft = 0, smpScore = 0;
    for (const x of enriched) {
      const s = pickStatus(x);
      const mul = Number(x.mul) || 0;
      const f   = Number(x.eoFrac) || 0;
      const pts = Number(x.pts) || 0;
      youScore += pts * mul  ;
      youScore += Number(myHit || 0);
      
      smpScore += pts * f;
      if (s === 'live') { youLive += mul; smpLive += f; }
      else if (s === 'played' || s === 'missed') { youPlayed += mul; smpPlayed += f; }
      else if (s === 'yet') { youLeft += mul; smpLeft += f; }
    }

    smpScore += Number(sampleHits) || 0; // EO meta (points; usually negative)
    const eoTotal = sumEOPlayers(overlay);
    const youTotal = youPlayed + youLive + youLeft;
    const smpTotal = smpPlayed + smpLive + smpLeft;

    const averages = {
      you:    { played: youPlayed, live: youLive, left: youLeft, score: youScore },
      sample: { played: smpPlayed, live: smpLive, left: smpLeft, score: smpScore },
      totals: { you: youTotal, sample: eoTotal },
    };

    return {
      star: starPick, killer: killerPick, flop: flopPick,
      diffsSorted, threatsSorted, tableThreats,
      liveBattle: { gains, losses, totalGain, totalLoss, netTotal },
      averages
    };
  }, [dataGames, eoMap, myExposure, ownedStatus, sortKey, sortDir, sampleHits, byId,myHit]);

  // After the useMemo that defines star, killer, flop, ...
  const trioData = useMemo(() => [star, killer, flop].filter(Boolean), [star, killer, flop]);

  // default tab logic
  useEffect(() => {
    const hasLive = !!(liveBattle?.gains?.length || liveBattle?.losses?.length);
    if (!userTabRef.current) setActiveTab(hasLive ? 'live' : 'diffs');
  }, [liveBattle]);

  /* ---------------------- Styles ---------------------- */
  const styles = useMemo(() => StyleSheet.create({
    safe: { flex: 1, backgroundColor: P.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    muted: { color: P.muted },
    link: { color: P.accent, textDecorationLine: 'underline' },

    // header tabs
    tabsRow: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 12,
      paddingTop: 8,
      paddingBottom: 6,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: P.border,
      backgroundColor: P.bg,
    },
    tabBtn: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 10,
      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      borderColor: P.border2,
    },
    tabBtnActive: { backgroundColor: P.accent, borderColor: P.accentDark },
    tabText: { fontWeight: '900', fontSize: 12, color: isDark ? P.ink : '#0b1220', letterSpacing: 0.2 },
    tabTextActive: { color: '#fff' },

    /* Grouped grid containers (merged cards look) */
    groupCard: {
      backgroundColor: isDark ? P.card : '#f2f2f2',
      borderColor:      isDark ? P.border : '#d9e2ff',
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 12,
      padding: 8,
      marginTop: 8,
    },
    groupRows: { gap: 6 },
    gridRow: {
      flexDirection: 'row',
      gap: 3,
      justifyContent: 'space-between',
      marginTop: 3,
    },
    gridCell: { flex: 1, minWidth: 0 },

    // cards
    card: {
      backgroundColor: P.card,
      borderColor: P.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 14,
      padding: 10,
      marginTop: 14,
    },

    /* Modal (generic) */
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
    },
    modalCard: {
      width: '100%',
      maxWidth: 520,
      backgroundColor: P.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: P.border,
      padding: 16,
    },
    modalTitle: { color: P.ink, fontSize: 18, fontWeight: '900', marginBottom: 8 },
    pickRow: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: P.border2 },
    closeBtn: { alignSelf: 'flex-end', marginTop: 12, backgroundColor: P.accent, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
    closeBtnText: { color: '#fff', fontWeight: '900' },

    // section titles
    sectionWrap: { marginTop: 8, marginBottom: 4 },
    sectionTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    sectionTitleText: { color: P.muted, fontWeight: '800', fontSize: 13, letterSpacing: 0.3 },
    sectionSub: { color: P.muted, fontSize: 11, marginTop: 2 },

    // live battle
    lbHeader: {
      flexDirection: 'row',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: P.border2,
      paddingVertical: 8,
      backgroundColor: isDark ? '#1a2544' : '#e8efff',
      borderRadius: 10,
    },
    lbColTitle: { color: isDark ? P.muted : '#374151', fontWeight: '800', fontSize: 13, textAlign:'center' },
    lbRowWrap: { flexDirection: 'row', minHeight: 44 },
    lbCol: { flex: 1, paddingVertical: 8, paddingHorizontal: 6 },
    lbColRightBorder: { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: P.border2 },
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

    playerImage: { width: '100%', height: undefined, aspectRatio: SHIRT_ASPECT, resizeMode: 'contain' },
    emojiOnImage: {
      position: 'absolute',
      top: S(6),
      right: S(-12),
      fontSize: S(11),
      includeFontPadding: false,
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

    // toolbar (compare against)
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
    segmentActive: { backgroundColor: P.accent, borderColor: P.accentDark },
    segmentText: { color: isDark ? P.ink : '#0b1220', fontWeight: '800', fontSize: 12, letterSpacing: 0.2 },
    segmentTextActive: { color: '#ffffff', ...NUM },
    infoBtn: { padding: 8, marginLeft: 'auto' },
    inlineHelp: { color: P.muted, fontSize: 11, marginTop: 6 },

    // table (threats)
    tableHeaderRow: { backgroundColor: isDark ? '#1a2544' : '#e8efff', borderRadius: 10 },
    tableRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
      paddingHorizontal: 6,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: P.border2,
    },
    tableRowRoundedTop: { borderTopLeftRadius: 10, borderTopRightRadius: 10 },
    tableRowRoundedBot: { borderBottomLeftRadius: 10, borderBottomRightRadius: 10 },
    th: { color: isDark ? P.muted : '#374151', fontWeight: '800', fontSize: 13 },
    td: { color: P.ink, fontSize: 13 },
    tdMono: { ...NUM },
    tdName: { color: P.ink, fontSize: 13, flexShrink: 1 },
    right: { textAlign: 'right' },
    trAlt: { backgroundColor: 'rgba(255,255,255,0.04)' },

    tableCrest: { width: 20, height: 20, resizeMode: 'contain' },

    thCell: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    thCellRight: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },

    // averages
    avgHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    avgTitle: { fontSize: 16, fontWeight: '900', color: P.ink },
    changeBtn: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 10, paddingVertical: 6,
      borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, borderColor: P.border2,
      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    },

    avgGridRow: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: P.border2, paddingVertical: 8 },
    avgHeadRow: { flexDirection: 'row', backgroundColor: isDark ? '#1a2544' : '#e8efff', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 6, marginBottom: 6 },
    avgTh: { flex: 1, textAlign: 'right', color: isDark ? P.muted : '#374151', fontWeight: '800', fontSize: 13 },
    avgTdLabel: { flex: 1.3, color: P.ink, fontSize: 13, fontWeight: '800' },
    avgTd: { flex: 1, textAlign: 'right', color: P.ink, fontSize: 13, ...NUM },
    avgSubtle: { color: P.muted, fontSize: 11 },

    // XI pitch
    xiCard: { marginTop: 14, padding: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: P.border, borderRadius: 14, backgroundColor: P.card },
    xiRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 6, marginTop: 6 },
    xiTile: {
      flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10,
      backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#fff',
      borderWidth: StyleSheet.hairlineWidth, borderColor: P.border2
    },
    xiTileOwned: {
    borderWidth: 2,
    borderColor: P.accent,
    backgroundColor: isDark ? 'rgba(96,165,250,0.10)' : 'rgba(96,165,250,0.10)',
  },
    xiName: { fontSize: 11, fontWeight: '800', color: P.ink },
    xiEO: { fontSize: 11, ...NUM, color: P.ink },
    xiStatBlock: { marginTop: 2, alignItems: 'center', gap: 2 },
  xiEOline: { fontSize: 11, ...NUM, color: P.ink },
  xiGainLine: { fontSize: 11, ...NUM },
    xiDeltaPos: { color: P.ok, fontWeight: '900' },
    xiDeltaNeg: { color: P.red, fontWeight: '900' },
    xiCrest: { width: 24, height: 24, resizeMode: 'contain', marginBottom: 4 },

    eoBarWrap: {
      height: 6, width: '90%', borderRadius: 999,
      overflow: 'hidden', backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
      marginTop: 4,
    },
    eoBarFill: { height: '100%', borderRadius: 999, backgroundColor: P.accent },
    statusRow: { marginTop: 2, alignItems: 'center' },
  }), [P, isDark]);

  /* ---------------------- UI micro-components ---------------------- */
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

  function SegmentToggle({ sample, setSample, onPressInfo, inlineHint }) {
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
            <TouchableOpacity onPress={onPressInfo} style={styles.infoBtn}>
              <MaterialCommunityIcons name="information-outline" size={18} color={P.muted} />
            </TouchableOpacity>
          </View>
          {!!inlineHint && <Text style={styles.inlineHelp}>{inlineHint}</Text>}
        </View>
      </View>
    );
  }

  // Tabs header
  const tabs = [
    { key: 'live',  label: 'Live Battle' },
    { key: 'diffs', label: 'Your Differentials' },
    { key: 'all',   label: 'Danger Table' },
    { key: 'avgs',  label: 'Templates, Chips & Averages' },
  ];

  /* ---------------------- Averages Picker + Tables ---------------------- */

  // Choose default avgPickKey to mirror EO sample
  useEffect(() => {
    if (!localsMeta) return;
    if (avgPickKey) return; // keep user's choice
    if (sample === 'elite') setAvgPickKey('elite');
    else if (sample === 'top10k') setAvgPickKey('top10k');
    else if (sample === 'local' && localGroupNum != null) setAvgPickKey(`local:${localGroupNum}`);
  }, [localsMeta, sample, avgPickKey, localGroupNum]);

  // Robust resolver that supports numeric and string indices (e.g., "overall", "elite", "top1m")
  const resolveLocalsChoice = useCallback(() => {
    if (!localsMeta?.locals?.length) return null;
    const L = localsMeta.locals;

    // Direct cohort shortcuts
    if (avgPickKey === 'elite') {
      return L.find(x => String(x.name).toLowerCase() === 'elite' || String(x.index).toLowerCase() === 'elite') || null;
    }
    if (avgPickKey === 'top10k') {
      return L.find(x => String(x.name).toLowerCase() === 'top 10k' || String(x.index).toLowerCase() === 'top10k') || null;
    }
    if (avgPickKey && avgPickKey.startsWith('local:')) {
      const nStr = avgPickKey.split(':')[1];
      const n = Number(nStr);
      // match by numeric index value for locals_<gw>.json known locals,
      // else fallback to string equality on index
      const hit =
        (Number.isFinite(n) ? L.find(x => Number(x.index) === n) : null) ||
        L.find(x => String(x.index) === nStr);
      if (hit) return hit;
    }
    if (avgPickKey && avgPickKey.startsWith('index:')) {
      const token = avgPickKey.split(':')[1]; // could be "2", "overall", "top1m", "elite", ...
      // Try numeric match first, else string index match, else by name (case-insensitively)
      const asNum = Number(token);
      const hit =
        (Number.isFinite(asNum) ? L.find(x => Number(x.index) === asNum) : null) ||
        L.find(x => String(x.index).toLowerCase() === String(token).toLowerCase()) ||
        L.find(x => String(x.name).toLowerCase() === String(token).toLowerCase());
      if (hit) return hit;
    }
    // Additionally accept raw keys like "overall" or "top1m"
    if (avgPickKey === 'overall' || avgPickKey === 'top1m') {
      const t = avgPickKey.toLowerCase();
      return L.find(x => String(x.index).toLowerCase() === t || String(x.name).toLowerCase() === (t === 'top1m' ? 'top 1m' : t)) || null;
    }

    // fallback none
    return null;
  }, [localsMeta, avgPickKey]);

  // name to show on the picker button
  const avgPickLabel = useMemo(() => {
    if (!localsMeta?.locals?.length) return 'Choose sample';
    if (!avgPickKey) {
      if (sample === 'elite') return 'Elite';
      if (sample === 'top10k') return 'Top 10K';
      if (sample === 'local')  return 'Near You';
      return 'Choose sample';
    }
    if (avgPickKey === 'elite') return 'Elite';
    if (avgPickKey === 'top10k') return 'Top 10K';
    if (avgPickKey.startsWith('local:')) return 'Near You';
    const chosen = resolveLocalsChoice();
    return chosen?.name || 'Choose sample';
  }, [localsMeta, avgPickKey, sample, resolveLocalsChoice]);

  // Should show your-vs-sample averages table? YES for elite/top10k/local ONLY
  const showCompareAverages = useMemo(() => {
    if (!avgPickKey) return (sample === 'elite' || sample === 'top10k' || sample === 'local');
    return (avgPickKey === 'elite' || avgPickKey === 'top10k' || avgPickKey.startsWith('local:'));
  }, [avgPickKey, sample]);

  const chosenLocal = resolveLocalsChoice();
  const chipWeek = chosenLocal?.this_gw?.chip_percent || {};
  const chipOverall = chosenLocal?.overall?.chip_percent || {};
  const captains = chosenLocal?.captains || [];
  const tripleCaptains = chosenLocal?.triple_captains || [];
  const hitsMean = Number(chosenLocal?.hits_mean || 0); // assumed in points (positive magnitude)
  const autosubsInc = Number(chosenLocal?.autosubs_increase_interp || 0); // assumed in points (positive)

  // Build captain/TC rows with names (fallback to id)
  const idToName = (pid) => byId.get(Number(pid))?.name || String(pid);
  const capRows = captains.map(([pid, frac]) => ({ id: Number(pid), name: idToName(pid), pct: frac * 100 }));
  const tcRows  = tripleCaptains.map(([pid, frac]) => ({ id: Number(pid), name: idToName(pid), pct: frac * 100 }));

  // Apply locals adjustment to the sample score (only for display)
  const adjustedSampleScore = useMemo(() => {
    if (!averages) return 0;
    // Add autosubs, subtract hitsMean (interpreted as points)
    return averages.sample.score + (autosubsInc - hitsMean);
  }, [averages, autosubsInc, hitsMean]);

  function AvgPicker() {
     const relShort = SAMPLE_SHORT[sample] || 'field';
    return (
      <View style={styles.card}>
        <View style={styles.avgHeader}>
          <Text style={styles.avgTitle}>Averages</Text>
          <TouchableOpacity style={styles.changeBtn} onPress={() => setAvgPickerOpen(true)}>
            <MaterialCommunityIcons name="account-switch-outline" size={16} color={P.ink} />
            <Text style={{ marginLeft: 8, color: P.ink, fontWeight: '800' }}>{avgPickLabel}</Text>
          </TouchableOpacity>
        </View>

        {/* (A) You vs Sample table (only for Top10K / Elite / Local) */}
        {showCompareAverages && averages && (
          <View>
            <View style={styles.avgHeadRow}>
              <Text style={[styles.avgTdLabel]}></Text>
              <Text style={styles.avgTh}>You</Text>
              <Text style={styles.avgTh}>Sample</Text>
            </View>

            <View style={styles.avgGridRow}>
              <Text style={styles.avgTdLabel}>Players Played</Text>
              <Text style={styles.avgTd}>{averages.you.played.toFixed(0)}</Text>
              <Text style={styles.avgTd}>{averages.sample.played.toFixed(2)}</Text>
            </View>
            <View style={styles.avgGridRow}>
              <Text style={styles.avgTdLabel}>Players Live</Text>
              <Text style={styles.avgTd}>{averages.you.live.toFixed(0)}</Text>
              <Text style={styles.avgTd}>{averages.sample.live.toFixed(2)}</Text>
            </View>
            <View style={styles.avgGridRow}>
              <Text style={styles.avgTdLabel}>Players Left (Yet)</Text>
              <Text style={styles.avgTd}>{averages.you.left.toFixed(0)}</Text>
              <Text style={styles.avgTd}>{averages.sample.left.toFixed(2)}</Text>
            </View>
            <View style={[styles.avgGridRow, { borderBottomWidth: 0 }]}>
              <Text style={styles.avgTdLabel}>Average Score</Text>
              <Text style={styles.avgTd}>{averages.you.score.toFixed(2)}</Text>
              <Text style={styles.avgTd}>{adjustedSampleScore.toFixed(2)}</Text>
            </View>
          </View>
        )}

        {/* (B) Chips (this GW & overall) */}
        <View style={{ marginTop: 10 }}>
          <SectionTitle icon="poker-chip" sub="This GW">{`Chip Usage`} [Sample: {relShort}]</SectionTitle>
          {Object.keys(chipWeek).length ? (
            Object.entries(chipWeek).map(([k,v]) => (
              <View key={`wk-${k}`} style={styles.avgGridRow}>
                <Text style={styles.avgTdLabel}>{chipLabel(k)}</Text>
                <Text style={styles.avgTd}></Text>
                <Text style={styles.avgTd}>{Number(v).toFixed(1)}%</Text>
              </View>
            ))
          ) : <Text style={styles.muted}>No data.</Text>}
        </View>

        <View style={{ marginTop: 10 }}>
          <SectionTitle icon="poker-chip" sub="Season to date">{`Chip Usage (Season)`} [Sample: {relShort}]</SectionTitle>
          {Object.keys(chipOverall).length ? (
            Object.entries(chipOverall).map(([k,v]) => (
              <View key={`ov-${k}`} style={styles.avgGridRow}>
                <Text style={styles.avgTdLabel}>{chipLabel(k)}</Text>
                <Text style={styles.avgTd}></Text>
                <Text style={styles.avgTd}>{Number(v).toFixed(1)}%</Text>
              </View>
            ))
          ) : <Text style={styles.muted}>No data.</Text>}
        </View>

        {/* (C) Captains & Triple Captains */}
        <View style={{ marginTop: 10 }}>
          <SectionTitle icon="crown-outline" sub="This GW">Captains [Sample: {relShort}]</SectionTitle>
          <ScrollView style={{ maxHeight: S(240) }}>
            {capRows.length ? capRows.map((r, i) => (
              <View key={`cap-${r.id}-${i}`} style={styles.avgGridRow}>
                <Text style={styles.avgTdLabel} numberOfLines={1}>{r.name}</Text>
                <Text style={styles.avgTd}></Text>
                <Text style={styles.avgTd}>{r.pct.toFixed(1)}%</Text>
              </View>
            )) : <Text style={styles.muted}>No data.</Text>}
          </ScrollView>
        </View>

        <View style={{ marginTop: 10 }}>
          <SectionTitle icon="alpha-t-box-outline" sub="This GW">Triple Captains [Sample: {relShort}]</SectionTitle>
          <ScrollView style={{ maxHeight: S(200) }}>
            {tcRows.length ? tcRows.map((r, i) => (
              <View key={`tc-${r.id}-${i}`} style={styles.avgGridRow}>
                <Text style={styles.avgTdLabel} numberOfLines={1}>{r.name}</Text>
                <Text style={styles.avgTd}></Text>
                <Text style={styles.avgTd}>{r.pct.toFixed(2)}%</Text>
              </View>
            )) : <Text style={styles.muted}>No data.</Text>}
          </ScrollView>
        </View>

        {/* Picker Modal */}
        <Modal visible={avgPickerOpen} transparent animationType="fade" onRequestClose={() => setAvgPickerOpen(false)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Choose a sample</Text>

              <TouchableOpacity
                style={styles.pickRow}
                onPress={() => { setAvgPickKey('elite'); setAvgPickerOpen(false); }}
              >
                <Text style={{ color: P.ink, fontWeight: '800' }}>Elite</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.pickRow}
                onPress={() => { setAvgPickKey('top10k'); setAvgPickerOpen(false); }}
              >
                <Text style={{ color: P.ink, fontWeight: '800' }}>Top 10K</Text>
              </TouchableOpacity>

              {localGroupNum != null && (
                <TouchableOpacity
                  style={styles.pickRow}
                  onPress={() => { setAvgPickKey(`local:${localGroupNum}`); setAvgPickerOpen(false); }}
                >
                  <Text style={{ color: P.ink, fontWeight: '800' }}>Near You</Text>
                </TouchableOpacity>
              )}

              <ScrollView style={{ maxHeight: S(300), marginTop: 8 }}>
                {(localsMeta?.locals || []).map((g, i) => (
                  <TouchableOpacity
                    key={`lk-${i}`}
                    style={styles.pickRow}
                    onPress={() => { setAvgPickKey(`index:${g.index}`); setAvgPickerOpen(false); }}
                  >
                    <Text style={{ color: P.ink }}>{String(g.name || `Group ${i+1}`)}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <TouchableOpacity style={styles.closeBtn} onPress={() => setAvgPickerOpen(false)}>
                <Text style={styles.closeBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  // Chip label canonicalization
  function chipLabel(k) {
    const m = String(k).toLowerCase();
    if (m === 'bboost') return 'Bench Boost';
    if (m === '3xc') return 'Triple Captain';
    if (m === 'freehit') return 'Free Hit';
    if (m === 'wildcard') return 'Wildcard';
    if (m === 'none') return 'None';
    return k;
  }

  /* ---------------------- MOST-SELECTED XI (Top10K/Elite/Local) ---------------------- */
  const showXI = useMemo(() => {
    if (!avgPickKey) return (sample === 'elite' || sample === 'top10k' || sample === 'local');
    return (avgPickKey === 'elite' || avgPickKey === 'top10k' || avgPickKey.startsWith('local:'));
  }, [avgPickKey, sample]);

  function pickXIFromEO() {
    const overlay = eoMap instanceof Map ? eoMap : new Map();
    if (!overlay || overlay.size === 0) return null;

    // Make rows with id, eoFrac, name, type, teamId, your mul for delta
    const rows = [];
    for (const [k, v] of overlay.entries()) {
      const id = Number(k);
      if (!(id >= 1)) continue;
      const eoPct = Number(v) || 0;
      const p = byId.get(id) || { id, name: String(id), teamId: 0, type: 0 };
      rows.push({
        id, name: p.name, teamId: p.teamId, type: p.type,
        eo: eoPct / 100,
        yourMul: Number(myExposure?.[id] || 0),
      });
    }

    const pickTop = (type, count) =>
      rows.filter(r => r.type === type)
          .sort((a,b) => (b.eo - a.eo) || a.name.localeCompare(b.name))
          .slice(0, count);

    const gk = pickTop(1, 2);
    const df = pickTop(2, 5);
    const md = pickTop(3, 5);
    const fw = pickTop(4, 3);
    return { gk, df, md, fw };
  }

  function EoBar({ frac }) {
    const w = clamp(frac, 0, 1) * 100;
    return (
      <View style={styles.eoBarWrap}>
        <View style={[styles.eoBarFill, { width: `${w}%` }]} />
      </View>
    );
  }

  function XiTile({ r }) {
    const crest = r.teamId ? { uri: clubCrestUri(r.teamId) } : null;
    const delta = r.yourMul - r.eo; // + means you own more
    const deltaStyle = delta >= 0 ? styles.xiDeltaPos : styles.xiDeltaNeg;
    const owned = (r.yourMul || 0) > 0;
    return (
      <View style={[styles.xiTile, owned && styles.xiTileOwned]}>
        {!!crest && <Image source={crest} style={styles.xiCrest} />}
        <Text numberOfLines={1} style={styles.xiName}>{r.name}</Text>
       <View style={styles.xiStatBlock}>
       <Text style={styles.xiEOline}>{(r.eo * 100).toFixed(1)}% EO</Text>
        
      </View>
        <EoBar frac={r.eo} />
        <Text style={[styles.xiGainLine, deltaStyle]}>
          {delta >= 0 ? '+' : ''}{(delta * 100).toFixed(1)}%
        </Text>
      </View>
      
    );
  }

  function renderXIBlock() {
    if (!showXI) return null;
    const xi = pickXIFromEO();
    if (!xi) return null;
    const relShort = SAMPLE_SHORT[sample] || 'field';
    return (
      <View style={styles.xiCard}>
        <SectionTitle icon="soccer-field">Highest EO Players in the {relShort} sample</SectionTitle>
        <Text style={styles.sectionSub}>Gain/loss % shown at bottom. Players you own are highlighted.</Text>
        {/* 2 GK row */}
        <View style={styles.xiRow}>
          {xi.gk.map(p => <XiTile key={`gk-${p.id}`} r={p} />)}
          {xi.gk.length < 2 ? <View style={[styles.xiTile, { opacity: 0.4 }]} /> : null}
        </View>
        {/* 5 DEF one row */}
        <View style={styles.xiRow}>
          {xi.df.map(p => <XiTile key={`df-${p.id}`} r={p} />)}
        </View>
        {/* 5 MID one row */}
        <View style={styles.xiRow}>
          {xi.md.map(p => <XiTile key={`md-${p.id}`} r={p} />)}
        </View>
        {/* 3 FWD row */}
        <View style={styles.xiRow}>
          {xi.fw.map(p => <XiTile key={`fw-${p.id}`} r={p} />)}
          {xi.fw.length < 3 ? <View style={[styles.xiTile, { opacity: 0.4 }]} /> : null}
        </View>
      </View>
    );
  }

  /* ---------------------- Live Battle / Diffs / Dangers (redesigned) ---------------------- */

  const handleSort = (key) => {
    const defaultDir = key === 'name' ? 'asc' : 'desc';
    setSortDir((prevDir) => (sortKey === key ? (prevDir === 'asc' ? 'desc' : 'asc') : defaultDir));
    setSortKey(key);
  };

  function LiveBattleCard() {
    if (!(liveBattle?.gains?.length || liveBattle?.losses?.length)) {
      return <Text style={[styles.muted, { marginTop: 10 }]}>No live players right now.</Text>;
    }
    return (
      <View style={styles.card}>
        <SectionTitle icon="sword-cross" sub={labels.liveSub}>Live Battle</SectionTitle>

        {/* Net total */}
        <View style={{flexDirection:'row', justifyContent:'space-between', paddingVertical:6, borderBottomWidth:StyleSheet.hairlineWidth, borderBottomColor:P.border2}}>
          <Text style={{ color:P.muted, fontWeight:'800' }}>Net (Gains + Losses)</Text>
          <Text style={[{ fontWeight:'900' }, (liveBattle.netTotal >= 0) ? { color:P.ok } : { color:P.red }]}
          >
            {liveBattle.netTotal >= 0 ? '+' : ''}{liveBattle.netTotal.toFixed(2)}
          </Text>
        </View>

        {/* Header */}
        <View style={[styles.lbHeader, { marginTop: 8 }]}>
          <View style={[styles.lbCol, styles.lbColRightBorder]}><Text style={styles.lbColTitle}>Gains</Text></View>
          <View style={styles.lbCol}><Text style={styles.lbColTitle}>Losses</Text></View>
        </View>

        <View style={styles.lbRowWrap}>
          <View style={[styles.lbCol, styles.lbColRightBorder]}>
            <View style={styles.lbRow}>
              <Text style={[styles.muted, { flex: 1 }]}>Player</Text>
              <Text style={[styles.muted, { width: LB_PTS_W, textAlign: 'right' }]}>Pts</Text>
              <Text style={[styles.muted, { width: LB_VAL_W, textAlign: 'right' }]}>Gain</Text>
            </View>
            {(liveBattle.gains.length
              ? (lbExpanded ? liveBattle.gains : liveBattle.gains.slice(0, 11))
              : [{ id:'_g0', name:'—', pts:0, value:0 }]
            ).map((r, i) => (
              <View key={`g-${r.id}-${i}`} style={styles.lbRow}>
                <View style={styles.lbNameCell}>
                  {!!r.teamId && <Image source={{ uri: clubCrestUri(r.teamId) }} style={{ width:20, height:20, resizeMode:'contain' }} />}
                  <Text numberOfLines={1} style={styles.lbName}>{r.name}</Text>
                </View>
                <Text style={[styles.lbPts, { width: LB_PTS_W, textAlign: 'right' }]}>{r.pts}</Text>
                <Text style={[styles.lbValGain, { width: LB_VAL_W, textAlign: 'right' }]}>{r.value >= 0 ? '+' : ''}{r.value.toFixed(1)}</Text>
              </View>
            ))}
          </View>

          <View style={styles.lbCol}>
            <View style={styles.lbRow}>
              <Text style={[styles.muted, { flex: 1 }]}>Player</Text>
              <Text style={[styles.muted, { width: LB_PTS_W, textAlign: 'right' }]}>Pts</Text>
              <Text style={[styles.muted, { width: LB_VAL_W, textAlign: 'right' }]}>Loss</Text>
            </View>
            {(liveBattle.losses.length
              ? (lbExpanded ? liveBattle.losses : liveBattle.losses.slice(0, 11))
              : [{ id:'_l0', name:'—', pts:0, value:0 }]
            ).map((r, i) => (
              <View key={`l-${r.id}-${i}`} style={styles.lbRow}>
                <View style={styles.lbNameCell}>
                  {!!r.teamId && <Image source={{ uri: clubCrestUri(r.teamId) }} style={{ width:20, height:20, resizeMode:'contain' }} />}
                  <Text numberOfLines={1} style={styles.lbName}>{r.name}</Text>
                </View>
                <Text style={[styles.lbPts, { width: LB_PTS_W, textAlign: 'right' }]}>{r.pts}</Text>
                <Text style={[styles.lbValLoss, { width: LB_VAL_W, textAlign: 'right' }]}>{r.value.toFixed(1)}</Text>
              </View>
            ))}
          </View>
        </View>

        {(liveBattle.gains.length > 11 || liveBattle.losses.length > 11) && (
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
                {lbExpanded ? 'Show fewer' : 'Show all'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }

  function Pill({ children }) {
    return (
      <View style={{
        paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999,
        borderWidth: StyleSheet.hairlineWidth, borderColor: P.border2,
        backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#fff',
        marginRight: 6, marginTop: 6
      }}>
        <Text style={{ color: P.ink, fontWeight: '800', fontSize: 12 }}>{children}</Text>
      </View>
    );
  }

  // Simple status labels for the strip
  const STATUS_LABEL = { live: 'LIVE', played: 'PLAYED', missed: 'MISSED', yet: 'YET' };
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

  // Grouped grid section — merges all tiles in one shared card background
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

  function DangerTableCard() {
    return (
      <View style={styles.card}>
        <SectionTitle icon="table" sub={labels.tableSub}>{labels.tableTitle}</SectionTitle>

        <View style={[styles.tableHeaderRow, styles.tableRow]}>
          <TouchableOpacity
            style={[styles.thCell, { flex: 2.8 }]}
            onPress={() => handleSort('name')}
            activeOpacity={0.7}
          >
            <Text style={[styles.th]}>Player</Text>
            {sortKey === 'name' && (
              <MaterialCommunityIcons name={sortDir === 'asc' ? 'chevron-up' : 'chevron-down'} size={16} color={P.ink} />
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.thCellRight, { flex: 1 }]}
            onPress={() => handleSort('eoVsYouPct')}
            activeOpacity={0.7}
          >
            <Text style={[styles.th, styles.right]}>EO</Text>
            {sortKey === 'eoVsYouPct' && (
              <MaterialCommunityIcons name={sortDir === 'asc' ? 'chevron-up' : 'chevron-down'} size={16} color={P.ink} />
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.thCellRight, { flex: 0.9 }]}
            onPress={() => handleSort('pts')}
            activeOpacity={0.7}
          >
            <Text style={[styles.th, styles.right]}>Pts</Text>
            {sortKey === 'pts' && (
              <MaterialCommunityIcons name={sortDir === 'asc' ? 'chevron-up' : 'chevron-down'} size={16} color={P.ink} />
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.thCellRight, { flex: 1.2 }]}
            onPress={() => handleSort('ptsVsYou')}
            activeOpacity={0.7}
          >
            <Text style={[styles.th, styles.right]}>Loss</Text>
            {sortKey === 'ptsVsYou' && (
              <MaterialCommunityIcons name={sortDir === 'asc' ? 'chevron-up' : 'chevron-down'} size={16} color={P.ink} />
            )}
          </TouchableOpacity>
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
          nestedScrollEnabled
        >
          {tableThreats.map((t, i) => (
            <View
              key={`tr-${t.id}-${i}`}
              style={[
                styles.tableRow,
                i % 2 ? { backgroundColor: 'rgba(255,255,255,0.04)' } : null,
                i === 0 && styles.tableRowRoundedTop,
                i === tableThreats.length - 1 && styles.tableRowRoundedBot,
              ]}
            >
              <View style={{ flex: 2.8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {!!t.teamId && <Image source={{ uri: clubCrestUri(t.teamId) }} style={styles.tableCrest} />}
                <Text style={styles.tdName} numberOfLines={1}>
                  {t.emoji ? `${t.emoji} ` : ''}{t.name}
                </Text>
              </View>
              <Text style={[styles.td, styles.right, styles.tdMono, { flex: 1 }]}>{t.eoVsYouPct.toFixed(1)}%</Text>
              <Text style={[styles.td, styles.right, styles.tdMono, { flex: 0.9 }]}>{Number(t.pts || 0)}</Text>
              <Text
                style={[
                  styles.td, styles.right, styles.tdMono, { flex: 1.2 },
                  t.ptsVsYou > 0 ? { color: P.red, fontWeight:'800' } : { color: P.ok, fontWeight:'800' }
                ]}
              >
                {t.ptsVsYou.toFixed(2)}
              </Text>
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  /* ---------------------- Main Render ---------------------- */
  const inlineHint = useMemo(() => {
    const base = '';
    if (sample === 'local' && /^missing:local/.test(eoErr)) {
      return SAMPLE_COPY.local.needsSetup;
    }
    return base;
  }, [sample, eoErr]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['left', 'right']}>
        <AppHeader />
        <View style={styles.center}>
          <ActivityIndicator color={P.accent} />
          <Text style={styles.muted}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <AppHeader />

      {err ? <Text style={[styles.muted, { textAlign: 'center', marginTop: 8 }]}>{err}</Text> : null}
      {eoErr ? <Text style={[styles.muted, { textAlign: 'center', marginTop: 4 }]}>EO overlay: {eoErr}</Text> : null}
      {localsErr ? <Text style={[styles.muted, { textAlign: 'center', marginTop: 4 }]}>Locals: {localsErr}</Text> : null}

      {/* Info modal for explaining samples */}
      <Modal visible={infoOpen} transparent animationType="fade" onRequestClose={() => setInfoOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Comparison Samples</Text>
            <View style={{ gap: 6 }}>
              <Text style={{ color: P.ink, fontWeight: '800' }}>• {SAMPLE_COPY.top10k.title}</Text>
              <Text style={{ color: P.muted, fontSize: 13, lineHeight: 18 }}>{SAMPLE_COPY.top10k.long}</Text>

              <Text style={{ color: P.ink, fontWeight: '800', marginTop: 10 }}>• {SAMPLE_COPY.elite.title}</Text>
              <Text style={{ color: P.muted, fontSize: 13, lineHeight: 18 }}>
                {SAMPLE_COPY.elite.long}{' '}
                <Text style={styles.link} onPress={() => Linking.openURL('https://www.livefpl.net/elite')}>
                  Here is a list of the elite managers and links to their teams →
                </Text>
              </Text>

              <Text style={{ color: P.ink, fontWeight: '800', marginTop: 10 }}>• {SAMPLE_COPY.local.title}</Text>
              <Text style={{ color: P.muted, fontSize: 13, lineHeight: 18 }}>{SAMPLE_COPY.local.long}</Text>
              <Text style={{ color: P.muted, fontSize: 13, lineHeight: 18, opacity: 0.85 }}>{SAMPLE_COPY.local.needsSetup}</Text>
            </View>

            <TouchableOpacity style={styles.closeBtn} onPress={() => setInfoOpen(false)} activeOpacity={0.8}>
              <Text style={styles.closeBtnText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Intro — kept minimal */}
      <Modal visible={introOpen} transparent animationType="fade" onRequestClose={dismissIntro}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>How to read this page</Text>
            <Text style={{ color:P.muted, marginBottom: 10 }}>
              Compare vs Top 10K / Elite / Near You. Danger Table lists who can hurt your rank most.
            </Text>
            <TouchableOpacity style={styles.closeBtn} onPress={dismissIntro} activeOpacity={0.8}>
              <Text style={styles.closeBtnText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="none"
        removeClippedSubviews={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={P.accent} />}
        stickyHeaderIndices={[0,1]}
      >
        {/* Compare against — sticky */}
        <SegmentToggle
          sample={sample}
          setSample={setSample}
          onPressInfo={() => setInfoOpen(true)}
          onPressIntro={() => setIntroOpen(true)}
          inlineHint={inlineHint}
        />

        {/* Tabs — sticky */}
        <View style={styles.tabsRow}>
          {tabs.map(t => {
            const active = activeTab === t.key;
            return (
              <TouchableOpacity
                key={t.key}
                onPress={() => { userTabRef.current = true; setActiveTab(t.key); }}
                style={[styles.tabBtn, active && styles.tabBtnActive]}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Live */}
        {activeTab === 'live' && <LiveBattleCard />}

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

        {/* All Threats (Danger Table) */}
        {activeTab === 'all' && <DangerTableCard />}

        {/* Averages tab — XI first, then picker */}
        {activeTab === 'avgs' && (
          <>
            {renderXIBlock()}
            <AvgPicker />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
