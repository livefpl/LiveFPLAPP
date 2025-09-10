// threats.js — theme-ready (uses useColors; no hardcoded palette at module scope)
import InfoBanner from './InfoBanner';
import AppHeader from './AppHeader';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Modal,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { clubCrestUri, assetImages } from './clubs';
import { smartFetch } from './signedFetch';
import { useColors } from './theme';

/* ---------------------- Sizing ---------------------- */
const rem = Dimensions.get('window').width / 380;
const S = (x) => Math.round(x * rem);
const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;
const LIVEFPL_LOGO = assetImages?.livefplLogo ?? assetImages?.logo;
const TABLE_THREAT_CUTOFF = 0.10;
const NUM = { fontVariant: ['tabular-nums'] };

/* ---------------------- Samples & copy ---------------------- */
const SAMPLE_OPTIONS = [
  { label: 'Top 10k', value: 'top10k' },
  { label: 'Elite',   value: 'elite' },
  { label: 'Near You', value: 'local' },
];

const SAMPLE_COPY = {
  top10k: {
    title: 'Top 10k',
    short: 'Compares you to a sample of managers around the top 10,000 overall ranks.',
    long:
      'Top 10k compares your team against a sample representing managers currently around the top 10,000 overall ranks. ' +
      'It’s useful to see how popular picks among leading managers impact your rank.',
  },
  elite: {
    title: 'Elite',
    short: 'Benchmarks against a curated group of consistently high-performing managers.',
    long:
      'Elite compares you to a curated set of historically strong managers. ' +
      'Great for understanding what long-term high performers are doing differently.',
  },
  local: {
    title: 'Near You',
    short: 'Looks at managers clustered near your overall rank (your LiveFPL local group).',
    long:
      'Near You compares you to managers around your current overall rank via a LiveFPL local group. ' +
      'This shows who is threatening or helping your rank in your immediate neighborhood.',
    needsSetup:
      'Near You requires your LiveFPL local group (set after entering your FPL ID on the Rank page).',
  },
};

const CACHE_TTL_MS = 30_000; // games data cache
const API_URL = 'https://livefpl-api-489391001748.europe-west4.run.app/LH_api/games';

/* ---------------------- EO Overlay helpers ---------------------- */
const EO_TTL_MIN = { top10k: 10, elite: 10, local: 10 };
const MS = (min) => min * 60 * 1000;

const normalizePercent = (v) => {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return n >= 0 ? n * 100 : n;
};

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
  let key = `EO:${sample}`;
  let url = null;

  if (sample === 'top10k') {
    url = 'https://livefpl.us/top10k.json';
  } else if (sample === 'elite') {
    url = 'https://livefpl.us/elite.json';
  } else if (sample === 'local') {
    const myId = await AsyncStorage.getItem('fplId');
    const raw =
      (myId && (await AsyncStorage.getItem(`localGroup:${myId}`))) ||
      (await AsyncStorage.getItem('localGroup'));
    const localNum = raw ? Number(raw) : null;
    if (!localNum) return { map: null, src: 'missing:local' };
    key = `EO:local:${localNum}`;
    url = `https://livefpl.us/local_${localNum}.json`;
  } else {
    return { map: null, src: 'none' };
  }

  const cached = await getEOFromStorage(key, ttlMs);
  if (cached) return { map: parseEOJson(cached), src: `cache:${key}` };

  const bucket = Math.floor(Date.now() / ttlMs);
  const fetchUrl = `${url}?v=${bucket}`;
  const res = await fetch(fetchUrl, { headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) throw new Error(`EO HTTP ${res.status}`);
  const json = await res.json();
  await setEOToStorage(key, json);
  return { map: parseEOJson(json), src: `net:${key}` };
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
  // Build a local palette with safe fallbacks for extra hues used here
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
// Add inside Threats() after P is defined
const DARK_TOPBAR = '#0b0c10'; // keep logo strip always dark
const isDark = useMemo(() => {
  // quick luminance check on the theme bg
  const hex = String(P.bg || '#000000').replace('#', '');
  if (hex.length < 6) return true;
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return l < 0.5;
}, [P.bg]);

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

  const handleSort = (key) => {
    const defaultDir = key === 'name' ? 'asc' : 'desc';
    setSortDir((prevDir) => (sortKey === key ? (prevDir === 'asc' ? 'desc' : 'asc') : defaultDir));
    setSortKey(key);
  };

  const cacheRef = useRef(new Map());

  /* Fetch games */
  const fetchGames = useCallback(async (force = false) => {
    setErr('');
    try {
      const key = 'base';
      const cached = cacheRef.current.get(key);
      if (!force && cached && Date.now() - cached.t < CACHE_TTL_MS) {
        setDataGames(cached.data);
        setLoading(false);
        setRefreshing(false);
        return;
      }
      const res = await smartFetch(API_URL, { headers: { 'cache-control': 'no-cache' } });
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

  /* Load myExposure & owned statuses from Rank payload */
  useEffect(() => {
    (async () => {
      try {
        const myId = await AsyncStorage.getItem('fplId');
        const rawExp =
          (myId && (await AsyncStorage.getItem(`myExposure:${myId}`))) ||
          (await AsyncStorage.getItem('myExposure'));
        setMyExposure(rawExp ? JSON.parse(rawExp) : null);

        const rawPayload = await AsyncStorage.getItem('fplData');
        const statusMap = new Map();
        if (rawPayload) {
          const parsed = JSON.parse(rawPayload)?.data;
          (parsed?.team || []).forEach((p) => {
            const id = Number(p?.fpl_id ?? p?.element ?? p?.id ?? p?.code);
            if (!id) return;
            const s = String(p?.status ?? 'd').toLowerCase();
            const dict = { y: 'yet', m: 'missed', d: 'played', l: 'live' };
            statusMap.set(id, dict[s] || 'played');
          });
        }
        setOwnedStatus(statusMap);
      } catch {
        setMyExposure(null);
        setOwnedStatus(new Map());
      }
    })();
  }, []);

  /* EO overlay (based on sample) */
  useEffect(() => {
    let cancelled = false;
    setEoErr('');
    loadEOOverlay(sample)
      .then(({ map }) => { if (!cancelled) setEoMap(map || null); })
      .catch((e) => { if (!cancelled) { setEoMap(null); setEoErr(String(e?.message || e)); } });
    return () => { cancelled = true; };
  }, [sample]);

  // Refresh on refocus (in case Rank changed ID → local group/exposure)
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
        } catch { if (mounted) setMyExposure(null); }

        if (mounted) {
          try {
            const { map } = await loadEOOverlay(sample);
            if (mounted) setEoMap(map || null);
          } catch (e) { if (mounted) { setEoMap(null); setEoErr(String(e?.message || e)); } }
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

  /* ---------- Compute tiles & table ---------- */
  const {
    star, killer, flop, diffsSorted, threatsSorted, tableThreats,
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

    const starPick = [...enriched].sort((a, b) => b.net - a.net)[0] || null;
    const killerPick = [...enriched].sort((a, b) => a.net - b.net)[0] || null;

    const flopsPool = enriched.filter((x) => x.mul > 0 && x.statusOwned && x.statusOwned !== 'yet');
    const flopPick = flopsPool.length
      ? flopsPool.slice().sort((a, b) =>
          (Number(a.pts) || 0) - (Number(b.pts) || 0) ||
          (Number(a.eoPct) || 0) - (Number(b.eoPct) || 0)
        )[0]
      : null;

    const diffs = enriched
      .filter((x) => (x.mul - x.eoFrac) >= 0.75 && (x.pts || 0) > 0)
      .map((x) => ({ ...x, _label: TYPE_LABEL[x.type] || '', _pctDisplay: (x.mul - x.eoFrac) * 100, _kind: 'diff' }));
    const threats = enriched
      .filter((x) => (x.eoFrac - x.mul) >= 0.30 && (x.pts || 0) > 0)
      .map((x) => ({ ...x, _label: TYPE_LABEL[x.type] || '', _pctDisplay: -((x.eoFrac - x.mul) * 100), _kind: 'threat' }));

    const diffsSorted = diffs.slice().sort((a, b) => (b._pctDisplay - a._pctDisplay));
    const threatsSorted = threats.slice().sort((a, b) => (Math.abs(b._pctDisplay) - Math.abs(a._pctDisplay)));

    const tableThreatsBase = enriched
      .filter((x) => (x.eoFrac - x.mul) >= TABLE_THREAT_CUTOFF && (x.pts || 0) > 0)
      .map((x) => {
        const eoVsYouPct = (x.eoFrac - x.mul) * 100;
        const ptsVsYou = (x.eoFrac - x.mul) * x.pts;
        return {
          id: x.id,
          name: x.name,
          teamId: x.teamId,
          eoVsYouPct,
          pts: x.pts,
          ptsVsYou,
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

    return { star: starPick, killer: killerPick, flop: flopPick, diffsSorted, threatsSorted, tableThreats };
  }, [dataGames, eoMap, myExposure, ownedStatus, sortKey, sortDir]);

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
        safe: { flex: 1, backgroundColor: P.bg, paddingTop: 48 },
        center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
        muted: { color: P.muted },

        topBar: {
   height: 44,
   paddingHorizontal: 12,
   alignItems: 'center',
   flexDirection: 'row',
   justifyContent: 'center',
   backgroundColor: DARK_TOPBAR,       // ← fixed dark bg
   borderBottomWidth: 1,
  borderBottomColor: '#1f2937',       // subtle dark divider
   zIndex: 10,
   elevation: 10,
   marginBottom: 6,
 },
        topLogo: { height: 28, width: 160 },
        topTitle: { color: P.ink, fontWeight: '900', fontSize: 18, letterSpacing: 0.2 },

        /* Toolbar + help */
        toolbar: {
          paddingHorizontal: 0,
          paddingBottom: 6,
          backgroundColor: P.bg,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: P.border,
        },
        toolbarLabel: { color: P.muted, fontWeight: '800', fontSize: 12, marginRight: 8, alignSelf: 'center' },
        segmentRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
        segment: {
   borderWidth: StyleSheet.hairlineWidth,
   borderColor: P.border,
   backgroundColor: isDark ? '#182544' : '#e8efff', // lighter pill on light mode
   paddingVertical: 8,
   paddingHorizontal: 12,
   borderRadius: 999,
 },
        segmentActive: {
  backgroundColor: P.accent,
   borderColor: P.accentDark,
 },
        segmentText: {
  color: isDark ? P.ink : '#0b1220', // stronger legibility on light
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
          gap: 10,
          justifyContent: 'space-between',
          marginTop: 8,
        },
        gridCell: { flex: 1, minWidth: 0 },
        tilePlaceholder: { flex: 1, height: PLAYER_IMAGE_HEIGHT + 90 },

        tileWrap: {
          backgroundColor: P.card,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: P.border,
          borderRadius: 14,
          padding: 10,
          alignItems: 'center',
          shadowColor: '#000',
          shadowOpacity: 0.18,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 3 },
          elevation: 2,
          position: 'relative',
        },
        tileLabel: { color: P.muted, fontSize: 12, fontWeight: '800', marginBottom: 4 },
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
        placeholder: { backgroundColor: '#0b1320', borderWidth: StyleSheet.hairlineWidth, borderColor: P.border },

        // Rank-style name/points blocks
        playerName: {
   fontSize: 11,
   lineHeight: 14,
   includeFontPadding: false,
   fontWeight: 'bold',
   marginTop: 0,
   marginBottom: 0,
   backgroundColor: '#000000' , // light-friendly
   color:  '#ffffff' ,
   width: imgwidth,
   textAlign: 'center',
   overflow: 'hidden',
 },
        played: {
          fontSize: 12,
          lineHeight: 14,
          includeFontPadding: false,
          width: imgwidth,
          textAlign: 'center',
          overflow: 'hidden',
          backgroundColor: isDark ? '#ffffff' : '#e5e7eb', // darker “white” on light mode
          color: 'black',
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
          backgroundColor: P.ok,
          color: 'white',
          ...NUM,
        },

        // Full-width percent row styles
        pctRow: {
          fontSize: 11,
          lineHeight: 12,
          includeFontPadding: false,
          width: imgwidth,
          textAlign: 'center',
          overflow: 'hidden',
          color: 'white',
          ...NUM,
        },
         pctRowGain: { backgroundColor: P.ok, color: '#0b1220' },  // readable on green both modes
 pctRowHurt: { backgroundColor: P.red, color: '#0b1220' }, 

        // Single EO pill (kept hidden)
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
   backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)', // adapt to theme
   borderWidth: StyleSheet.hairlineWidth,
   borderColor: P.border2,
 },
        netText: { fontSize: 11, fontWeight: '800' },
        netGain: { color: P.ok },
        netHurt: { color: P.red },

        // Rounded corners utilities
        topRounded: { borderTopLeftRadius: 4, borderTopRightRadius: 4, overflow: 'hidden' },
        bottomRounded: { borderBottomLeftRadius: 4, borderBottomRightRadius: 4, overflow: 'hidden' },

        /* Main threats table */
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
      }),
    [P, imgwidth, PLAYER_IMAGE_WIDTH]
  );

  /* ---------- Small UI components (close over styles & P) ---------- */
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
      <View style={styles.toolbar}>
        <View style={styles.segmentRow}>
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
    );
  }

  function EOBarSingle({ value }) {
    return (
      <View style={[styles.EOs, styles.EOsRow, styles.bottomRounded]}>
        <Text numberOfLines={1} ellipsizeMode="tail" allowFontScaling={false} style={styles.EO1}>
          {Number(value || 0).toFixed(1)}%
        </Text>
      </View>
    );
  }

  function PlayerTile({ item, label, showPct }) {
    const crest = item.teamId ? { uri: clubCrestUri(item.teamId) } : null;
    const statusKey = item.statusOwned || item.statusGuess || 'played';
    const statusStyle = styles[statusKey] || styles.played;
    const pctBadge = typeof item._pctDisplay === 'number' ? item._pctDisplay : null;
    const hasPctRow = showPct && pctBadge != null;

    // emoji logic
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
      <View style={styles.tileWrap}>
        {!!label && <Text style={styles.tileLabel}>{label}</Text>}
        <View style={styles.playerContainer}>
          <View style={styles.imageWrap}>
            {crest ? <Image source={crest} style={styles.playerImage} /> : <View style={[styles.playerImage, styles.placeholder]} />}
            {!!emoji && <Text style={styles.emojiOnImage}>{emoji}</Text>}
          </View>

          <Text numberOfLines={1} ellipsizeMode="tail" allowFontScaling={false} style={[styles.playerName, styles.topRounded]}>
            {item.name}
          </Text>

          <Text numberOfLines={1} ellipsizeMode="tail" allowFontScaling={false} style={[statusStyle, !hasPctRow && styles.bottomRounded]}>
            {Number(item.pts || 0)}
          </Text>

          {hasPctRow && (
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              allowFontScaling={false}
              style={[styles.pctRow, pctBadge >= 0 ? styles.pctRowGain : styles.pctRowHurt, styles.bottomRounded]}
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

  function GridSection({ title, icon, sub, data, showPct }) {
    if (!data || data.length === 0) return null;
    const rows = chunk(data, 4);
    return (
      <View style={{ marginTop: 8 }}>
        <SectionTitle icon={icon} sub={sub}>{title}</SectionTitle>
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
    );
  }

  /* ---------------------- Render ---------------------- */
  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: P.bg }}>
        <AppHeader />

        <View style={styles.center}>
          <ActivityIndicator color={P.accent} />
          <Text style={styles.muted}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <AppHeader />

      {err ? <Text style={[styles.muted, { textAlign: 'center', marginTop: 8 }]}>{err}</Text> : null}
      {eoErr ? <Text style={[styles.muted, { textAlign: 'center', marginTop: 4 }]}>EO overlay: {eoErr}</Text> : null}

      {/* Info modal for explaining samples */}
      <Modal visible={infoOpen} transparent animationType="fade" onRequestClose={() => setInfoOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Comparison Samples</Text>
            <View style={styles.modalList}>
              <Text style={styles.modalItemTitle}>• {SAMPLE_COPY.top10k.title}</Text>
              <Text style={styles.modalItemText}>{SAMPLE_COPY.top10k.long}</Text>

              <Text style={[styles.modalItemTitle, { marginTop: 10 }]}>• {SAMPLE_COPY.elite.title}</Text>
              <Text style={styles.modalItemText}>{SAMPLE_COPY.elite.long}</Text>

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
        stickyHeaderIndices={[0]}
      >
        <SegmentToggle
          sample={sample}
          setSample={setSample}
          onPressInfo={() => setInfoOpen(true)}
          inlineHint={inlineHint}
        />

        {/* Featured Trio */}
        <SectionTitle
          icon="star-outline"
          sub="Star: Most gained from. Killer: Most damage to your rank. Flop: Worst performer."
        >
          Star · Killer · Flop
        </SectionTitle>
        <View style={styles.gridRow}>
          <View style={styles.gridCell}>{star ? <PlayerTile item={star} label={star._label} showPct={false} /> : <View style={styles.tilePlaceholder} />}</View>
          <View style={styles.gridCell}>{killer ? <PlayerTile item={killer} label={killer._label} showPct={false} /> : <View style={styles.tilePlaceholder} />}</View>
          <View style={styles.gridCell}>{flop ? <PlayerTile item={flop} label={flop._label} showPct={false} /> : <View style={styles.tilePlaceholder} />}</View>
        </View>

        {/* Differentials */}
        <GridSection
          title="Your Differentials"
          sub="Players you own more than the field. +% is your edge; green = good for you."
          icon="star-four-points-outline"
          data={diffsSorted}
          showPct
        />

        {/* Threats */}
        <GridSection
          title="Main Threats to You"
          sub="Players the field owns more than you. −% is your risk; red = bad for you."
          icon="alert-outline"
          data={threatsSorted}
          showPct
        />

        {/* Main Threats Table */}
        {tableThreats.length > 0 && (
          <View style={styles.tableCard}>
            <SectionTitle
              icon="table"
              sub="EO vs You = field ownership − yours. Pts vs You = impact estimate. Tap headers to sort."
            >
              Main Threats
            </SectionTitle>
            <View style={[styles.tableHeaderRow, styles.tableRow]}>
              <TouchableOpacity
                style={[styles.thCell, { flex: 2 }]}
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
                <Text style={[styles.th, styles.right]}>EO vs You</Text>
                {sortKey === 'eoVsYouPct' && (
                  <MaterialCommunityIcons
                    name={sortDir === 'asc' ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={P.ink}
                  />
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.thCellRight, { flex: 1 }]}
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
                <Text style={[styles.th, styles.right]}>Pts vs You</Text>
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
                <View key={`tr-${t.id}-${i}`} style={[styles.tableRow, i % 2 ? styles.trAlt : null]}>
                  <View style={{ flex: 2, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {!!t.teamId && <Image source={{ uri: clubCrestUri(t.teamId) }} style={styles.tableCrest} />}
                    <Text style={styles.tdName} numberOfLines={1}>{t.name}</Text>
                  </View>
                  <Text style={[styles.td, styles.right, { flex: 1 }, NUM]}>{t.eoVsYouPct.toFixed(1)}%</Text>
                  <Text style={[styles.td, styles.right, { flex: 1 }, NUM]}>{Number(t.pts || 0)}</Text>
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
