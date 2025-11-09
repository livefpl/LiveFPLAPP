// TemplatesChipsAverages.js — tabs + Averages table with sample name + Live/Played/Left rows,
// pickers for Chips/Captains, percentage bars.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import AppHeader from './AppHeader';
import { useColors } from './theme';
import { clubCrestUri } from './clubs';
import { smartFetch } from './signedFetch';

Text.defaultProps = Text.defaultProps || {};
Text.defaultProps.allowFontScaling = false;
Text.defaultProps.maxFontSizeMultiplier = 1;

/* ---------------------- Sizing ---------------------- */
const rem = Dimensions.get('window').width / 380;
const S = (x) => Math.round(x * rem);

/* ---------------------- Constants ---------------------- */
const CACHE_TTL_MS = 30_000;
const API_URL = 'https://livefpl.us/api/games.json';
const FLIP_WINDOW_MS = 60 * 60 * 1000;

const SAMPLE_OPTIONS = [
  { label: 'Top 10k', value: 'top10k' },
  { label: 'Elite',   value: 'elite' },
  { label: 'Near You', value: 'local' },
];

const SAMPLE_COPY = {
  local: {
    needsSetup: 'Near You requires your LiveFPL local group (set after entering your FPL ID on the Rank page).',
  },
};
const SAMPLE_SHORT = { top10k: 'Top 10k', elite: 'Elite', local: 'Near You' };

/* ---------------------- EO Overlay helpers ---------------------- */
const EO_TTL_MIN = { top10k: 10, elite: 10, local: 10 };
const MS = (min) => min * 60 * 1000;

async function getGWFirstSeenTs() {
  try { return Number(await AsyncStorage.getItem('gw.current.t')) || 0; }
  catch { return 0; }
}
async function getGWSalt() {
  try { return await AsyncStorage.getItem('gw.current'); }
  catch { return null; }
}
function isLikelyStaleEO(map) {
  if (!(map instanceof Map)) return true;
  return map.size < 5;
}
function normalizePercent(v) {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return n >= 0 ? n * 100 : n;
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
  let hits = 0; // average points deducted for hits in sample (points, neg)
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
function collectPlayersFromGames(json) {
  // id -> { id, name, teamId, type, pts, seenLive, seenPlayed }
  const byId = new Map();
  (json || []).forEach((game) => {
    const teamHId = Number(game?.[16] ?? 0);
    const teamAId = Number(game?.[17] ?? 0);

    // attempt live/finished flags
    const live = Boolean(game?.inProgress ?? game?.is_live ?? game?.[7] ?? game?.[8] ?? false);
    const finished = Boolean(game?.finished ?? game?.is_finished ?? game?.[9] ?? game?.[10] ?? false);

    const tableH = game?.[12] || [];
    const tableA = game?.[13] || [];

    const pushRows = (rows, teamId) => {
      (rows || []).forEach((row) => {
        const [name, _eo, _o, _pts, explained, elementId, shortName, type] = row;
        const id = Number(elementId) || null;
        if (!id) return;

        const prev = byId.get(id) || {};
        const ptsNum = Number(_pts) || 0;

        // minutes from explained
        let mins = 0;
        if (Array.isArray(explained)) {
          for (const e of explained) {
            if (!Array.isArray(e) || e.length < 2) continue;
            const tag = String(e[0]).toLowerCase();
            if (tag === 'mins' || tag === 'minutes') {
              mins = Number(e[1]) || 0;
              break;
            }
          }
        }

        const seenLive  = prev.seenLive  || (mins > 0 && live && !finished);
        const seenPlayed= prev.seenPlayed|| (mins > 0 && (!live || finished));

        byId.set(id, {
          id,
          name: shortName || name,
          teamId: Number(teamId) || prev.teamId || 0,
          type: Number(type) || prev.type || 0,
          pts: (prev.pts || 0) + ptsNum,
          seenLive,
          seenPlayed,
        });
      });
    };

    pushRows(tableH, teamHId);
    pushRows(tableA, teamAId);
  });
  return byId;
}
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

/* ---------------------- Totals ---------------------- */
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

/* ---------------------- Chip label ---------------------- */
function chipLabel(k) {
  const m = String(k).toLowerCase();
  if (m === 'bboost') return 'Bench Boost';
  if (m === '3xc') return 'Triple Captain';
  if (m === 'freehit') return 'Free Hit';
  if (m === 'wildcard') return 'Wildcard';
  if (m === 'none') return 'None';
  return k;
}

/* ---------------------- Main Screen ---------------------- */
export default function TemplatesChipsAverages() {
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

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState('');

  const [sample, setSample] = useState('local'); // drives Averages (no picker)
  const [eoMap, setEoMap] = useState(null);
  const [sampleHits, setSampleHits] = useState(0);
  const [eoErr, setEoErr] = useState('');

  const [localsMeta, setLocalsMeta] = useState(null);
  const [localsErr, setLocalsErr] = useState('');
  const [localGroupNum, setLocalGroupNum] = useState(null);

  const [dataGames, setDataGames] = useState([]);
  const cacheRef = useRef(new Map());

  const [myExposure, setMyExposure] = useState(null); // { id -> multiplier }
  const [myHit, setMyHit] = useState(0);

  // Tabs
  const [tab, setTab] = useState('templates'); // 'templates' | 'averages' | 'chips' | 'captains'

  // Pickers for Chips/Captains
  const [capPickerOpen, setCapPickerOpen] = useState(false);
  const [capPickKey, setCapPickKey] = useState(null);
  const [chipPickerOpen, setChipPickerOpen] = useState(false);
  const [chipPickKey, setChipPickKey] = useState(null);

  /* ---------- data fetch ---------- */
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
      const res = await smartFetch(`${API_URL}?v=${ver}${gw ? `&gw=${gw}` : ''}`, {
        headers: { 'cache-control': 'no-cache' },
      });
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
        for (const p of payload.team) {
          const pid = Number(p?.fpl_id ?? p?.element ?? p?.id ?? p?.code) || null;
          if (!pid) continue;
          const role = String(p?.role || '').toLowerCase();
          const mul = role === 'tc' ? 3 : role === 'c' ? 2 : role === 'b' ? 0 : 1;
          exposure[pid] = mul;
        }
        setMyExposure(exposure);
      } catch {
        setMyExposure(null);
      }
    })();
  }, []);

  // locals meta
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

  // EO overlay for segment sample (drives Averages)
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

  // Sync Captains & Chips pickers to segment by default (they can be overridden)
  useEffect(() => {
    if (sample === 'elite') {
      setCapPickKey('elite');
      setChipPickKey('elite');
    } else if (sample === 'top10k') {
      setCapPickKey('top10k');
      setChipPickKey('top10k');
    } else if (sample === 'local') {
      if (localGroupNum != null) {
        setCapPickKey(`local:${localGroupNum}`);
        setChipPickKey(`local:${localGroupNum}`);
      } else {
        setCapPickKey(null);
        setChipPickKey(null);
      }
    }
  }, [sample, localGroupNum]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchGames(true);
  }, [fetchGames]);

  /* ---------- derived ---------- */
  const byId = useMemo(() => collectPlayersFromGames(dataGames), [dataGames]);

  // Averages uses segment sample only (no picker)
  const avgPickKey = sample === 'elite' ? 'elite' : sample === 'top10k' ? 'top10k' :
                     (sample === 'local' && localGroupNum != null) ? `local:${localGroupNum}` : null;

  const chosenAvg = useMemo(() => {
    if (!localsMeta?.locals?.length) return null;
    const L = localsMeta.locals;
    const key = avgPickKey;
    if (!key) return null;

    if (key === 'elite') return L.find(x => String(x.name).toLowerCase() === 'elite' || String(x.index).toLowerCase() === 'elite') || null;
    if (key === 'top10k') return L.find(x => String(x.name).toLowerCase() === 'top 10k' || String(x.index).toLowerCase() === 'top10k') || null;

    if (key.startsWith('local:')) {
      const nStr = key.split(':')[1];
      const n = Number(nStr);
      return (Number.isFinite(n) ? L.find(x => Number(x.index) === n) : null)
          || L.find(x => String(x.index) === nStr) || null;
    }
    return null;
  }, [localsMeta, avgPickKey]);

  const avgSampleLabel = useMemo(() => {
    // Prefer the actual local group name when available; otherwise nice defaults.
    if (chosenAvg?.name) return String(chosenAvg.name);
    return SAMPLE_SHORT[sample] || 'Sample';
  }, [chosenAvg, sample]);

  const hitsMean = Number(chosenAvg?.hits_mean || 0);
  const autosubsInc = Number(chosenAvg?.autosubs_increase_interp || 0);

  // Averages calculation (You vs Sample) — uses per-player GW points
  const averages = useMemo(() => {
    const overlay = eoMap instanceof Map ? eoMap : new Map();
    const exposure = myExposure || {};
    let youScore = 0;
    let smpScore = 0;

    // You
    for (const [idStr, mul] of Object.entries(exposure)) {
      const id = Number(idStr);
      const p = byId.get(id);
      const pts = Number(p?.pts || 0);
      youScore += pts * (Number(mul) || 0);
    }

    // Sample (EO-weighted)
    for (const [id, eoPct] of (eoMap || new Map()).entries()) {
      if (Number(id) < 1) continue;
      const p = byId.get(Number(id));
      const pts = Number(p?.pts || 0);
      smpScore += pts * ((Number(eoPct) || 0) / 100);
    }

    // meta adjustments
    youScore += Number(myHit || 0);
    smpScore += Number(sampleHits || 0);

    return {
      you:    { score: youScore },
      sample: { score: smpScore },
    };
  }, [eoMap, myExposure, byId, myHit, sampleHits]);

  const adjustedSampleScore = useMemo(() => {
    if (!averages) return 0;
    return averages.sample.score + (autosubsInc - hitsMean);
  }, [averages, autosubsInc, hitsMean]);

  // Player state map (pid -> 'live' | 'played' | 'left')
  const playerState = useMemo(() => {
    const map = new Map();
    byId.forEach((p, pid) => {
      if (p.seenLive) map.set(pid, 'live');
      else if (p.seenPlayed) map.set(pid, 'played');
      else map.set(pid, 'left');
    });
    return map;
  }, [byId]);

 // Your counts (captain x2, TC x3, bench 0) — mirrors EO weighting in sample
const myPlayState = useMemo(() => {
  let liveCnt = 0, playedCnt = 0, leftCnt = 0;
  const exposure = myExposure || {};
  for (const [idStr, mul] of Object.entries(exposure)) {
    const m = Number(mul) || 0;        // 0 (bench), 1 (normal), 2 (C), 3 (TC)
    if (m <= 0) continue;              // ignore bench
    const pid = Number(idStr);
    const st = playerState.get(pid) || 'left';
    if (st === 'live')      liveCnt   += m;
    else if (st === 'played') playedCnt += m;
    else                     leftCnt   += m;
  }
  return { liveCnt, playedCnt, leftCnt };
}, [myExposure, playerState]);


  // Sample counts (EO-weighted; average slots)
  const samplePlayState = useMemo(() => {
    let liveCnt = 0, playedCnt = 0, leftCnt = 0;
    if (!(eoMap instanceof Map)) return { liveCnt, playedCnt, leftCnt };
    for (const [k, v] of eoMap.entries()) {
      const pid = Number(k);
      if (!(pid >= 1)) continue;
      const frac = (Number(v) || 0) / 100;
      if (frac <= 0) continue;
      const st = playerState.get(pid) || 'left';
      if (st === 'live') liveCnt += frac;
      else if (st === 'played') playedCnt += frac;
      else leftCnt += frac;
    }
    return { liveCnt, playedCnt, leftCnt };
  }, [eoMap, playerState]);

  /* ---------------------- UI ---------------------- */
  const styles = useMemo(() => StyleSheet.create({
    safe: { flex: 1, backgroundColor: P.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    muted: { color: P.muted },
    card: {
      backgroundColor: P.card,
      borderColor: P.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 14,
      padding: 12,
      marginTop: 14,
    },

    /* Toolbar (Compare against) */
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
    toolbarLabel: { color: isDark ? '#bcd' : '#374151', fontWeight: '800', fontSize: 12, marginRight: 6 },
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
    segmentTextActive: { color: '#ffffff' },

    /* Top tabs */
    tabsWrapSticky: {
      backgroundColor: P.bg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: P.border,
      paddingBottom: 6,
    },
    tabsRow: {
      flexDirection: 'row',
      gap: 8,
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingTop: 6,
    },
    tabPill: {
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: P.border,
      backgroundColor: isDark ? '#182544' : '#e8efff',
    },
    tabPillActive: { backgroundColor: P.accent, borderColor: P.accentDark },
    tabText: { fontWeight: '800', fontSize: 12, color: isDark ? P.ink : '#0b1220' },
    tabTextActive: { color: '#fff' },

    /* Section titles */
    sectionTitleText: { color: P.muted, fontWeight: '800', fontSize: 13, letterSpacing: 0.3 },
    sectionSub: { color: P.muted, fontSize: 11, marginTop: 2 },

    /* Averages */
    avgHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    avgTitle: { fontSize: 16, fontWeight: '900', color: P.ink },
    avgHeadRow: { flexDirection: 'row', backgroundColor: isDark ? '#1a2544' : '#e8efff', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 6, marginBottom: 6 },
    avgThLabel: { flex: 1.3, color: isDark ? '#bcd' : '#374151', fontWeight: '800', fontSize: 13 },
    avgTh: { flex: 1, textAlign: 'right', color: isDark ? '#bcd' : '#374151', fontWeight: '800', fontSize: 13 },
    avgTdLabel: { flex: 1.3, color: P.ink, fontSize: 13, fontWeight: '800' },
    avgGridRow: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: P.border2 || P.border, paddingVertical: 8 },
    avgTd: { flex: 1, textAlign: 'right', color: P.ink, fontSize: 13, fontVariant: ['tabular-nums'] },

    /* Tiles (XI) */
    xiCard: { marginTop: 14, padding: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: P.border, borderRadius: 14, backgroundColor: P.card },
    xiRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 6, marginTop: 6 },
    xiTile: {
      flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10,
      backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#fff',
      borderWidth: StyleSheet.hairlineWidth, borderColor: P.border2 || P.border
    },
    xiTileOwned: {
      borderWidth: 2,
      borderColor: P.accent,
      backgroundColor: isDark ? 'rgba(96,165,250,0.10)' : 'rgba(96,165,250,0.10)',
    },
    xiName: { fontSize: 11, fontWeight: '800', color: P.ink },
    xiEO: { fontSize: 11, color: P.ink, fontVariant: ['tabular-nums'] },
    xiGainLine: { fontSize: 11, fontVariant: ['tabular-nums'] },
    xiDeltaPos: { color: P.ok, fontWeight: '900' },
    xiDeltaNeg: { color: P.red, fontWeight: '900' },

    /* Bars */
    barWrap: {
      height: 6, width: '100%', borderRadius: 999,
      overflow: 'hidden',
      backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
      marginTop: 4,
    },
    barFill: { height: '100%', borderRadius: 999, backgroundColor: P.accent },

    /* Modals */
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
    pickRow: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: P.border2 || P.border },
    closeBtn: { alignSelf: 'flex-end', marginTop: 12, backgroundColor: P.accent, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
    closeBtnText: { color: '#fff', fontWeight: '900' },
    changeBtn: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 10, paddingVertical: 6,
      borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, borderColor: P.border2 || P.border,
      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    },
    changeBtnText: { marginLeft: 8, color: P.ink, fontWeight: '800' },
    rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    rowPct: { color: P.ink, fontVariant: ['tabular-nums'] },
    itemLabel: { color: P.ink, fontWeight: '800' },
  }), [P, isDark]);

  function SectionTitle({ icon, children, sub }) {
    return (
      <View style={{ marginBottom: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <MaterialCommunityIcons name={icon} size={16} color={P.muted} />
          <Text style={styles.sectionTitleText}>{children}</Text>
        </View>
        {sub ? <Text style={styles.sectionSub}>{sub}</Text> : null}
      </View>
    );
  }

  function SegmentToggle({ sample, setSample, onPressInfo }) {
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
            <TouchableOpacity onPress={onPressInfo} style={{ padding: 8, marginLeft: 'auto' }}>
              <MaterialCommunityIcons name="information-outline" size={18} color={P.muted} />
            </TouchableOpacity>
          </View>
          {!!(sample === 'local' && /^missing:local/.test(eoErr)) && (
            <Text style={{ color: P.muted, fontSize: 11, marginTop: 6 }}>{SAMPLE_COPY.local.needsSetup}</Text>
          )}
        </View>
      </View>
    );
  }

  function TopTabs() {
    const tabs = [
      { key: 'templates', label: 'Templates' },
      { key: 'averages', label: 'Averages' },
      { key: 'chips', label: 'Chip Usage' },
      { key: 'captains', label: 'Captains' },
    ];
    return (
      <View style={styles.tabsWrapSticky}>
        <View style={styles.tabsRow}>
          {tabs.map(t => {
            const active = tab === t.key;
            return (
              <TouchableOpacity
                key={t.key}
                onPress={() => setTab(t.key)}
                activeOpacity={0.85}
                style={[styles.tabPill, active && styles.tabPillActive]}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  }

  /* ---------------------- Bars ---------------------- */
  function PercentBar({ pct /* 0..100 */ }) {
    const w = clamp(Number(pct) || 0, 0, 100);
    return (
      <View style={styles.barWrap}>
        <View style={[styles.barFill, { width: `${w}%` }]} />
      </View>
    );
  }

  /* ---------------------- Averages (table with sample name + state rows) ---------------------- */
  function AveragesCard() {
    return (
      <View style={styles.card}>
        <View style={styles.avgHeader}>
          <Text style={styles.avgTitle}>Averages</Text>
        </View>

        <View>
          <View style={styles.avgHeadRow}>
            <Text style={styles.avgThLabel}></Text>
            <Text style={styles.avgTh}>You</Text>
            <Text style={styles.avgTh}>{avgSampleLabel}</Text>
          </View>

          <View style={styles.avgGridRow}>
            <Text style={styles.avgTdLabel}>Average Score</Text>
            <Text style={styles.avgTd}>{averages.you.score.toFixed(2)}</Text>
            <Text style={styles.avgTd}>{adjustedSampleScore.toFixed(2)}</Text>
          </View>

          <View style={styles.avgGridRow}>
            <Text style={styles.avgTdLabel}>Live</Text>
            <Text style={styles.avgTd}>{myPlayState.liveCnt}</Text>
            <Text style={styles.avgTd}>{samplePlayState.liveCnt.toFixed(1)}</Text>
          </View>

          <View style={styles.avgGridRow}>
            <Text style={styles.avgTdLabel}>Played</Text>
            <Text style={styles.avgTd}>{myPlayState.playedCnt}</Text>
            <Text style={styles.avgTd}>{samplePlayState.playedCnt.toFixed(1)}</Text>
          </View>

          <View style={styles.avgGridRow}>
            <Text style={styles.avgTdLabel}>Left</Text>
            <Text style={styles.avgTd}>{myPlayState.leftCnt}</Text>
            <Text style={styles.avgTd}>{samplePlayState.leftCnt.toFixed(1)}</Text>
          </View>
        </View>
      </View>
    );
  }

  /* ---------------------- XI (from EO) ---------------------- */
  const showXI = useMemo(() => {
    return (sample === 'elite' || sample === 'top10k' || sample === 'local');
  }, [sample]);

  function EoBar({ frac }) {
    const w = clamp(frac, 0, 1) * 100;
    return (
      <View style={styles.barWrap}>
        <View style={[styles.barFill, { width: `${w}%` }]} />
      </View>
    );
  }

  function XiTile({ r }) {
    const crest = r.teamId ? { uri: clubCrestUri(r.teamId) } : null;
    const delta = (r.yourMul || 0) - r.eo; // positive = you own more
    theDeltaStyle = delta >= 0 ? styles.xiDeltaPos : styles.xiDeltaNeg;
    const owned = (r.yourMul || 0) > 0;
    return (
      <View style={[styles.xiTile, owned && styles.xiTileOwned]}>
        {!!crest && <Image source={crest} style={{ width: 24, height: 24, resizeMode: 'contain', marginBottom: 4 }} />}
        <Text numberOfLines={1} style={styles.xiName}>{r.name}</Text>
        <Text style={styles.xiEO}>{(r.eo * 100).toFixed(1)}% EO</Text>
        <EoBar frac={r.eo} />
        <Text style={[styles.xiGainLine, theDeltaStyle]}>
          {delta >= 0 ? '+' : ''}{(delta * 100).toFixed(1)}%
        </Text>
      </View>
    );
  }

  function pickXIFromEO() {
    const overlay = eoMap instanceof Map ? eoMap : new Map();
    if (!overlay || overlay.size === 0) return null;

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
          .sort((a, b) => (b.eo - a.eo) || a.name.localeCompare(b.name))
          .slice(0, count);

    return {
      gk: pickTop(1, 2),
      df: pickTop(2, 5),
      md: pickTop(3, 5),
      fw: pickTop(4, 3),
    };
  }

  function renderXIBlock() {
    if (!showXI) return null;
    const xi = pickXIFromEO();
    if (!xi) return null;
    const relShort = (chosenAvg?.name) ? chosenAvg.name : (SAMPLE_SHORT[sample] || 'Sample');
    return (
      <View style={styles.xiCard}>
        <SectionTitle icon="soccer-field">Highest EO Players in {relShort}</SectionTitle>
        <Text style={styles.sectionSub}>Gain/Loss % shows your delta vs sample. Your owned players are highlighted.</Text>

        <View style={styles.xiRow}>
          {xi.gk.map(p => <XiTile key={`gk-${p.id}`} r={p} />)}
          {xi.gk.length < 2 ? <View style={[styles.xiTile, { opacity: 0.4 }]} /> : null}
        </View>
        <View style={styles.xiRow}>
          {xi.df.map(p => <XiTile key={`df-${p.id}`} r={p} />)}
        </View>
        <View style={styles.xiRow}>
          {xi.md.map(p => <XiTile key={`md-${p.id}`} r={p} />)}
        </View>
        <View style={styles.xiRow}>
          {xi.fw.map(p => <XiTile key={`fw-${p.id}`} r={p} />)}
          {xi.fw.length < 3 ? <View style={[styles.xiTile, { opacity: 0.4 }]} /> : null}
        </View>
      </View>
    );
  }

  /* ---------------------- Chip Usage & Captains (with pickers + bars) ---------------------- */
  const capPickLabel = useMemo(() => {
    if (!localsMeta?.locals?.length) return 'Choose sample';
    if (!capPickKey) {
      if (sample === 'elite') return 'Elite';
      if (sample === 'top10k') return 'Top 10K';
      if (sample === 'local')  return 'Near You';
      return 'Choose sample';
    }
    if (capPickKey === 'elite') return 'Elite';
    if (capPickKey === 'top10k') return 'Top 10K';
    if (capPickKey.startsWith('local:')) return 'Near You';
    const chosen = (() => {
      const L = localsMeta.locals;
      const key = capPickKey;
      if (key.startsWith('index:')) {
        const token = key.split(':')[1];
        const asNum = Number(token);
        return (Number.isFinite(asNum) ? L.find(x => Number(x.index) === asNum) : null)
            || L.find(x => String(x.index).toLowerCase() === String(token).toLowerCase())
            || L.find(x => String(x.name).toLowerCase() === String(token).toLowerCase()) || null;
      }
      return null;
    })();
    return chosen?.name || 'Choose sample';
  }, [localsMeta, capPickKey, sample]);

  const chipPickLabel = useMemo(() => {
    if (!localsMeta?.locals?.length) return 'Choose sample';
    if (!chipPickKey) {
      if (sample === 'elite') return 'Elite';
      if (sample === 'top10k') return 'Top 10K';
      if (sample === 'local')  return 'Near You';
      return 'Choose sample';
    }
    if (chipPickKey === 'elite') return 'Elite';
    if (chipPickKey === 'top10k') return 'Top 10K';
    if (chipPickKey.startsWith('local:')) return 'Near You';
    const chosen = (() => {
      const L = localsMeta.locals;
      const key = chipPickKey;
      if (key.startsWith('index:')) {
        const token = key.split(':')[1];
        const asNum = Number(token);
        return (Number.isFinite(asNum) ? L.find(x => Number(x.index) === asNum) : null)
            || L.find(x => String(x.index).toLowerCase() === String(token).toLowerCase())
            || L.find(x => String(x.name).toLowerCase() === String(token).toLowerCase()) || null;
      }
      return null;
    })();
    return chosen?.name || 'Choose sample';
  }, [localsMeta, chipPickKey, sample]);

  function ChipUsageCard() {
    const labelFrom = (k) => {
      if (!k) return sample === 'elite' ? 'Elite' : sample === 'top10k' ? 'Top 10k' : 'Near You';
      if (k === 'elite') return 'Elite';
      if (k === 'top10k') return 'Top 10k';
      if (k.startsWith('local:')) return 'Near You';
      return 'Sample';
    };

    const chosenChip = useMemo(() => {
      if (!localsMeta?.locals?.length) return null;
      const L = localsMeta.locals;
      const key = chipPickKey;
      if (!key) return null;
      if (key === 'elite') return L.find(x => String(x.name).toLowerCase() === 'elite' || String(x.index).toLowerCase() === 'elite') || null;
      if (key === 'top10k') return L.find(x => String(x.name).toLowerCase() === 'top 10k' || String(x.index).toLowerCase() === 'top10k') || null;
      if (key.startsWith('local:')) {
        const nStr = key.split(':')[1];
        const n = Number(nStr);
        return (Number.isFinite(n) ? L.find(x => Number(x.index) === n) : null)
            || L.find(x => String(x.index) === nStr) || null;
      }
      if (key.startsWith('index:')) {
        const token = key.split(':')[1];
        const asNum = Number(token);
        return (Number.isFinite(asNum) ? L.find(x => Number(x.index) === asNum) : null)
            || L.find(x => String(x.index).toLowerCase() === String(token).toLowerCase())
            || L.find(x => String(x.name).toLowerCase() === String(token).toLowerCase()) || null;
      }
      return null;
    }, [localsMeta, chipPickKey]);

    const chipWeek = chosenChip?.this_gw?.chip_percent || {};
    const chipOverall = chosenChip?.overall?.chip_percent || {};

    const row = (label, val, key) => {
      const pct = Number(val) || 0;
      return (
        <View key={key} style={{ paddingVertical: 8 }}>
          <View style={styles.rowTop}>
            <Text style={styles.itemLabel}>{label}</Text>
            <Text style={styles.rowPct}>{pct.toFixed(1)}%</Text>
          </View>
          <PercentBar pct={pct} />
        </View>
      );
    };

    return (
      <View style={styles.card}>
        <View style={styles.avgHeader}>
          <Text style={styles.avgTitle}>Chip Usage</Text>
          <TouchableOpacity style={styles.changeBtn} onPress={() => setChipPickerOpen(true)} activeOpacity={0.8}>
            <MaterialCommunityIcons name="account-switch-outline" size={16} color={P.ink} />
            <Text style={styles.changeBtnText}>{chipPickLabel}</Text>
          </TouchableOpacity>
        </View>

        <SectionTitle icon="poker-chip" sub={`This GW · Sample: ${labelFrom(chipPickKey)}`}>This GW</SectionTitle>
        {Object.keys(chipWeek).length
          ? Object.entries(chipWeek).map(([k, v]) => row(chipLabel(k), v, `wk-${k}`))
          : <Text style={styles.muted}>No data.</Text>}

        <View style={{ height: 10 }} />

        <SectionTitle icon="poker-chip" sub={`Season to date · Sample: ${labelFrom(chipPickKey)}`}>Season</SectionTitle>
        {Object.keys(chipOverall).length
          ? Object.entries(chipOverall).map(([k, v]) => row(chipLabel(k), v, `ov-${k}`))
          : <Text style={styles.muted}>No data.</Text>}

        {/* Chip picker modal */}
        <Modal visible={chipPickerOpen} transparent animationType="fade" onRequestClose={() => setChipPickerOpen(false)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Choose a sample</Text>

              <TouchableOpacity style={styles.pickRow} onPress={() => { setChipPickKey('elite'); setChipPickerOpen(false); }}>
                <Text style={{ color: P.ink, fontWeight: '800' }}>Elite</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.pickRow} onPress={() => { setChipPickKey('top10k'); setChipPickerOpen(false); }}>
                <Text style={{ color: P.ink, fontWeight: '800' }}>Top 10K</Text>
              </TouchableOpacity>

              {localGroupNum != null && (
                <TouchableOpacity style={styles.pickRow} onPress={() => { setChipPickKey(`local:${localGroupNum}`); setChipPickerOpen(false); }}>
                  <Text style={{ color: P.ink, fontWeight: '800' }}>Near You</Text>
                </TouchableOpacity>
              )}

              <ScrollView style={{ maxHeight: S(300), marginTop: 8 }}>
                {(localsMeta?.locals || []).map((g, i) => (
                  <TouchableOpacity
                    key={`lk-chip-${i}`}
                    style={styles.pickRow}
                    onPress={() => { setChipPickKey(`index:${g.index}`); setChipPickerOpen(false); }}
                  >
                    <Text style={{ color: P.ink }}>{String(g.name || `Group ${i + 1}`)}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <TouchableOpacity style={styles.closeBtn} onPress={() => setChipPickerOpen(false)} activeOpacity={0.8}>
                <Text style={styles.closeBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  function CaptainsCard() {
    const idToName = (pid) => byId.get(Number(pid))?.name || String(pid);
    const chosenCap = useMemo(() => {
      if (!localsMeta?.locals?.length) return null;
      const L = localsMeta.locals;
      const key = capPickKey;
      if (!key) return null;
      if (key === 'elite') return L.find(x => String(x.name).toLowerCase() === 'elite' || String(x.index).toLowerCase() === 'elite') || null;
      if (key === 'top10k') return L.find(x => String(x.name).toLowerCase() === 'top 10k' || String(x.index).toLowerCase() === 'top10k') || null;
      if (key.startsWith('local:')) {
        const nStr = key.split(':')[1];
        const n = Number(nStr);
        return (Number.isFinite(n) ? L.find(x => Number(x.index) === n) : null)
            || L.find(x => String(x.index) === nStr) || null;
      }
      if (key.startsWith('index:')) {
        const token = key.split(':')[1];
        const asNum = Number(token);
        return (Number.isFinite(asNum) ? L.find(x => Number(x.index) === asNum) : null)
            || L.find(x => String(x.index).toLowerCase() === String(token).toLowerCase())
            || L.find(x => String(x.name).toLowerCase() === String(token).toLowerCase()) || null;
      }
      return null;
    }, [localsMeta, capPickKey]);

    const captains = chosenCap?.captains || [];
    const tripleCaptains = chosenCap?.triple_captains || [];

    const capRows = (captains || []).map(([pid, frac]) => ({ id: Number(pid), name: idToName(pid), pct: (Number(frac) || 0) * 100 }));
    const tcRows  = (tripleCaptains || []).map(([pid, frac]) => ({ id: Number(pid), name: idToName(pid), pct: (Number(frac) || 0) * 100 }));

    const row = (r, key) => (
      <View key={key} style={{ paddingVertical: 8 }}>
        <View style={styles.rowTop}>
          <Text style={styles.itemLabel} numberOfLines={1}>{r.name}</Text>
          <Text style={styles.rowPct}>{r.pct.toFixed(1)}%</Text>
        </View>
        <PercentBar pct={r.pct} />
      </View>
    );

    const labelFrom = (k) => {
      if (!k) return sample === 'elite' ? 'Elite' : sample === 'top10k' ? 'Top 10k' : 'Near You';
      if (k === 'elite') return 'Elite';
      if (k === 'top10k') return 'Top 10k';
      if (k.startsWith('local:')) return 'Near You';
      return 'Sample';
    };

    return (
      <View style={styles.card}>
        <View style={styles.avgHeader}>
          <Text style={styles.avgTitle}>Captains</Text>
          <TouchableOpacity style={styles.changeBtn} onPress={() => setCapPickerOpen(true)} activeOpacity={0.8}>
            <MaterialCommunityIcons name="account-switch-outline" size={16} color={P.ink} />
            <Text style={styles.changeBtnText}>{/* picker button label */ (capPickKey ? labelFrom(capPickKey) : labelFrom(sample))}</Text>
          </TouchableOpacity>
        </View>

        <SectionTitle icon="crown-outline" sub={`This GW · Sample: ${labelFrom(capPickKey || sample)}`}>Captain Choices</SectionTitle>
        <ScrollView style={{ maxHeight: S(240) }}>
          {capRows.length ? capRows.map((r, i) => row(r, `cap-${r.id}-${i}`)) : <Text style={styles.muted}>No data.</Text>}
        </ScrollView>

        <View style={{ height: 10 }} />

        <SectionTitle icon="alpha-t-box-outline" sub={`This GW · Sample: ${labelFrom(capPickKey || sample)}`}>Triple Captains</SectionTitle>
        <ScrollView style={{ maxHeight: S(200) }}>
          {tcRows.length ? tcRows.map((r, i) => row(r, `tc-${r.id}-${i}`)) : <Text style={styles.muted}>No data.</Text>}
        </ScrollView>

        {/* Captains picker modal */}
        <Modal visible={capPickerOpen} transparent animationType="fade" onRequestClose={() => setCapPickerOpen(false)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Choose a sample</Text>

              <TouchableOpacity style={styles.pickRow} onPress={() => { setCapPickKey('elite'); setCapPickerOpen(false); }}>
                <Text style={{ color: P.ink, fontWeight: '800' }}>Elite</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.pickRow} onPress={() => { setCapPickKey('top10k'); setCapPickerOpen(false); }}>
                <Text style={{ color: P.ink, fontWeight: '800' }}>Top 10K</Text>
              </TouchableOpacity>

              {localGroupNum != null && (
                <TouchableOpacity style={styles.pickRow} onPress={() => { setCapPickKey(`local:${localGroupNum}`); setCapPickerOpen(false); }}>
                  <Text style={{ color: P.ink, fontWeight: '800' }}>Near You</Text>
                </TouchableOpacity>
              )}

              <ScrollView style={{ maxHeight: S(300), marginTop: 8 }}>
                {(localsMeta?.locals || []).map((g, i) => (
                  <TouchableOpacity
                    key={`lk-cap-${i}`}
                    style={styles.pickRow}
                    onPress={() => { setCapPickKey(`index:${g.index}`); setCapPickerOpen(false); }}
                  >
                    <Text style={{ color: P.ink }}>{String(g.name || `Group ${i + 1}`)}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <TouchableOpacity style={styles.closeBtn} onPress={() => setCapPickerOpen(false)} activeOpacity={0.8}>
                <Text style={styles.closeBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  /* ---------------------- Render ---------------------- */
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

      {/* Placeholder help modal */}
      <Modal visible={false} transparent animationType="fade" onRequestClose={() => {}} />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="none"
        removeClippedSubviews={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={P.accent} />}
        stickyHeaderIndices={[0, 1]}  // Compare segment + top tabs
      >
        {/* Compare against — sticky (drives Averages) */}
        <SegmentToggle
          sample={sample}
          setSample={setSample}
          onPressInfo={() => { Linking.openURL('https://www.livefpl.net/elite'); }}
        />

        {/* Top Tabs — sticky */}
        <TopTabs />

        {/* Tab contents */}
        {tab === 'templates' && renderXIBlock()}
        {tab === 'averages' && <AveragesCard />}
        {tab === 'chips' && <ChipUsageCard />}
        {tab === 'captains' && <CaptainsCard />}
      </ScrollView>
    </SafeAreaView>
  );
}
