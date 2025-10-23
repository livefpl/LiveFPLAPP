// WhatIf.js — simplified, menu-first UX (now with sorted pickers, elegant (−), cascades in summary)
//
// Adds in this rev:
// • Scorer/Assister pickers sorted: players in MY TEAM first, then by EO desc
// • Assister "-1" reads "none"
// • Simplified elegant (−) button
// • Summary now also lists cascaded effects (CS gained/lost and more/fewer goals conceded)
// • Rank arrows use clubs' assets (assetImages.rankUp / rankDown / rankSame) and sit right by the ranks
import { AppState } from 'react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  ActivityIndicator,
  FlatList,
  Modal,
  RefreshControl,

  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ScrollView,
  Image,
} from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AppHeader from './AppHeader';
import { smartFetch } from './signedFetch';
import { useColors } from './theme';
import { assetImages } from './clubs'; // expects { rankUp, rankDown, rankSame }
Text.defaultProps = Text.defaultProps || {};
Text.defaultProps.allowFontScaling = false;

const API_GAMES = 'https://livefpl.us/api/games.json';
const COUNTER_URL = (gw) => `https://livefpl.us/${gw}/counter_${gw}.json`;

const CACHE_TTL_MS = 30000;
const EO_TTL_MS = 10 * 60 * 1000;

const DIMINISH_K = 0.7;
const SATURATE_K = 30;

const TYPE_LABEL = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
const csPoints = (t) => (t === 1 || t === 2 ? 4 : t === 3 ? 1 : 0);
const goalPoints = (t) => (t === 4 ? 4 : t === 3 ? 5 : 6);
const gcPenalty = (conceded, t) => (t === 1 || t === 2 ? -Math.floor((Number(conceded) || 0) / 2) : 0);
const minutesPts = (mins) => (mins >= 60 ? 2 : mins > 0 ? 1 : 0);

/* ------------------------------ EO helpers -------------------------------- */
const parseEOJson = (json) => {
  const map = new Map();
  if (!json) return map;
  if (Array.isArray(json)) {
    for (const x of json) {
      const id = x?.id ?? x?.element ?? x?.element_id ?? x?.pid;
      const eo = x?.eo ?? x?.EO ?? x?.effective_ownership ?? x?.effective;
      if (id != null && eo != null) map.set(Number(id), Number(eo) * 100);
    }
  } else {
    for (const [k, v] of Object.entries(json)) {
      const eo = typeof v === 'number' ? v : (v?.eo ?? v?.EO ?? v?.effective_ownership ?? v?.effective);
      if (eo != null) map.set(Number(k), Number(eo) * 100);
    }
  }
  return map;
};
const getEOFromStorage = async (key) => {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.t || !parsed?.data) return null;
    if (Date.now() - parsed.t > EO_TTL_MS) return null;
    return parsed.data;
  } catch { return null; }
};
const setEOToStorage = async (key, data) => {
  try { await AsyncStorage.setItem(key, JSON.stringify({ t: Date.now(), data })); } catch {}
};
const loadLocalEO = async () => {
  try {
    const myId = await AsyncStorage.getItem('fplId');
    const rawLocal =
      (myId && (await AsyncStorage.getItem(`localGroup:${myId}`))) ||
      (await AsyncStorage.getItem('localGroup'));
    const localNum = rawLocal ? Number(rawLocal) : null;
    if (!localNum) return new Map();

    let gw = Number(await AsyncStorage.getItem('gw.current'));
    if (!Number.isFinite(gw) || gw <= 0) {
      const cachedGW = await AsyncStorage.getItem('fplData');
      if (cachedGW) gw = Number(JSON.parse(cachedGW)?.data?.gw) || gw;
    }
    if (!Number.isFinite(gw) || gw <= 0) gw = 1;

    const key = `EO:local:${localNum}:gw${gw}`;
    const cached = await getEOFromStorage(key);
    if (cached) return parseEOJson(cached);

    const url = `https://livefpl.us/${gw}/local_${localNum}.json`;
    const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
    if (!res.ok) return new Map();
    const json = await res.json();
    await setEOToStorage(key, json);
    return parseEOJson(json);
  } catch {
    return new Map();
  }
};

/* ----------------------------- Ranker builder ----------------------------- */
function buildCounterRanker(counterObj) {
  const pairs = Object.entries(counterObj)
    .map(([k, v]) => [Number(k), Number(v) || 0])
    .filter(([t, c]) => Number.isFinite(t) && c > 0)
    .sort((a, b) => a[0] - b[0]);

  const totals = pairs.map(p => p[0]);
  const counts = pairs.map(p => p[1]);
  const N = counts.reduce((s, c) => s + c, 0);

  const greater = new Array(totals.length).fill(0);
  for (let i = totals.length - 2; i >= 0; i--) {
    greater[i] = greater[i + 1] + counts[i + 1];
  }

  const lb = (arr, x) => { let lo = 0, hi = arr.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; }
    return lo;
  };

  const rankAtFrac = (t, frac = 0.5) => {
    if (!totals.length) return 1;
    const T = Math.round(Number(t) || 0);
    let i = lb(totals, T);
    if (i === totals.length) i = totals.length - 1;
    if (totals[i] !== T && i > 0 && Math.abs(totals[i - 1] - T) <= Math.abs(totals[i] - T)) i--;

    const tie = (counts[i] || 1);
    const higher = (greater[i] || 0);

    const ff = Math.max(0, Math.min(0.999999, Number(frac) || 0));
    const within = Math.floor(ff * tie);
    return 1 + higher + within;
  };
  const rankAtSmooth = (x, frac = 0.5) => {
    if (!totals.length) return 1;
    const rx = Math.round(x);
    if (Math.abs(x - rx) < 1e-6) return rankAtFrac(rx, frac);
    if (x <= totals[0] + 1e-6) return rankAtFrac(totals[0], frac);
    if (x >= totals[totals.length - 1] - 1e-6) return rankAtFrac(totals[totals.length - 1], frac);

    let i = lb(totals, x);
    if (i <= 0) i = 1;
    const loT = totals[i - 1];
    const hiT = totals[i];
    const loR = rankAtFrac(loT, frac);
    const hiR = rankAtFrac(hiT, frac);
    const w = (x - loT) / (hiT - loT);
    const r = loR + w * (hiR - loR);
    return Math.round(r);
  };
  const rankAt = (t) => rankAtFrac(t, 0.5);
  return { rankAt, rankAtFrac, rankAtSmooth, totals, counts, greater, N };
}

/* -------------------------------- Component -------------------------------- */
export default function WhatIf() {
  const C = useColors();
  const S = useMemo(() => makeStyles(C), [C]);

  const cacheRef = useRef({ t: 0, data: [] });
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
// Points-change modal
const [showDiff, setShowDiff] = useState(false);

  // --- PER-GAME STATE HOLDER (events + 90') ---
  const emptyFake = useCallback(() => ({
    goals: new Map(),
    goalAssists: new Map(),
    assists: new Map(),
    yc: new Map(),
    rc: new Map(),
    bonus: new Map(),
    defcon: new Map(),
  }), []);
  const [perGame, setPerGame] = useState(new Map()); // key: gIdx (index), value: {fake, force90}
  const getBundleFor = useCallback((idx) => {
    const got = perGame.get(idx);
    if (got) return got;
    return { fake: emptyFake(), force90: false };
  }, [perGame, emptyFake]);

  const [fake, setFake] = useState(emptyFake());
  const [showEditor, setShowEditor] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const [gIdx, setGIdx] = useState(0);
  const [force90, setForce90] = useState(false);

  // persist current game's bundle whenever it changes
  useEffect(() => {
    setPerGame(prev => {
      const m = new Map(prev);
      m.set(gIdx, { fake, force90 });
      return m;
    });
  }, [gIdx, fake, force90]);

  const hasEdits = useMemo(() => (
    fake.goals.size || fake.goalAssists.size || fake.assists.size ||
    fake.yc.size || fake.rc.size || fake.bonus.size || fake.defcon.size
  ) > 0, [fake]);

  const [eoMap, setEoMap] = useState(new Map());
  const [myExposure, setMyExposure] = useState({});
  const [overrideMul, setOverrideMul] = useState(new Map());
  const [allPlayers, setAllPlayers] = useState([]);

  /* ---------------- Elements (names/types) ---------------- */
  const [elements, setElements] = useState([]);
  const [hadTriedBootstrap, setHadTriedBootstrap] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const elRaw = await AsyncStorage.getItem('elements');
        if (!cancelled && elRaw) { setElements(JSON.parse(elRaw) || []); }
        else {
          const payloadRaw = await AsyncStorage.getItem('fplData');
          const payload = payloadRaw ? JSON.parse(payloadRaw)?.data || {} : {};
          if (!cancelled) setElements(payload?.elements || []);
        }
      } catch { if (!cancelled) setElements([]); }
    })();
    return () => { cancelled = true; };
  }, []);

  // If still empty, fetch once from bootstrap-static (fallback for names)
  useEffect(() => {
    (async () => {
      if (elements?.length || hadTriedBootstrap) return;
      try {
        const res = await smartFetch('https://fantasy.premierleague.com/api/bootstrap-static/');
        if (res?.ok) {
          const json = await res.json();
          const els = json?.elements || [];
          if (els?.length) {
            setElements(els);
            try { await AsyncStorage.setItem('elements', JSON.stringify(els)); } catch {}
          }
        }
      } catch {} finally {
        setHadTriedBootstrap(true);
      }
    })();
  }, [elements, hadTriedBootstrap]);

  const elementsById = useMemo(() => {
    const map = new Map();
    for (const e of elements || []) {
      const id = Number(e?.id);
      if (!id) continue;
      map.set(id, { id, name: e?.web_name || e?.name || String(id), type: Number(e?.element_type) || Number(e?.type) || 0 });
    }
    return map;
  }, [elements]);
  const globalNameMap = useMemo(() => new Map(elementsById), [elementsById]);

  /* ---------------- Data loads ---------------- */
  const loadGames = useCallback(async (force=false) => {
    try {
      if (!force && cacheRef.current.data.length && Date.now() - cacheRef.current.t < CACHE_TTL_MS) {
        setGames(cacheRef.current.data);
        setLoading(false);
        return;
      }
      const res = await smartFetch(API_GAMES, { headers: { 'cache-control': 'no-cache' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json)) throw new Error('Bad games payload');
      cacheRef.current = { t: Date.now(), data: json };
      setGames(json);
    } catch {
      // soft
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { loadGames(); }, [loadGames]);

  const loadLocalBits = useCallback(async () => {
    try { setEoMap(await loadLocalEO()); } catch { setEoMap(new Map()); }
    try {
      const myId = await AsyncStorage.getItem('fplId');
      const raw = (myId && (await AsyncStorage.getItem(`myExposure:${myId}`))) || (await AsyncStorage.getItem('myExposure'));
      setMyExposure(raw ? JSON.parse(raw) : {});
    } catch { setMyExposure({}); }
  }, []);
  useEffect(() => { loadLocalBits(); }, [loadLocalBits]);
  // Re-check when app returns to foreground (cheap and immediate)
  const onRefresh = useCallback(() => {
    setLoading(true);
    Promise.all([loadGames(true), loadLocalBits(), loadRanker()]).finally(() => setLoading(false));
  }, [loadGames, loadLocalBits, loadRanker]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') onRefresh();
    });
    return () => sub.remove();
  }, [onRefresh]);

  // Watch for fplId / local group changes (no AsyncStorage events, so light poll)
  const seenKeysRef = useRef({ fplId: null, local: null });
  useEffect(() => {
    let cancelled = false;
    let timer;
   const tick = async () => {
      try {
        const fplId = await AsyncStorage.getItem('fplId');
        const rawLocal =
          (fplId && (await AsyncStorage.getItem(`localGroup:${fplId}`))) ||
          (await AsyncStorage.getItem('localGroup'));
        if (seenKeysRef.current.fplId !== fplId || seenKeysRef.current.local !== rawLocal) {
          seenKeysRef.current = { fplId, local: rawLocal };
          // Re-load bits tied to identity/team
          await loadLocalBits();
          await loadRanker();
        }
      } finally {
        if (!cancelled) timer = setTimeout(tick, 1500); // light heartbeat
      }
    };
    tick();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [loadLocalBits, loadRanker]);
  /* ---------------- Current-match players (for editor lists) ---------------- */
  const game = games[gIdx] || null;
  const tableH = game?.[12] || [];
  const tableA = game?.[13] || [];
  const homeName = String(game?.[0] || 'Home');
  const awayName = String(game?.[1] || 'Away');

  const baseScoreH = Number(game?.[2] || 0);
  const baseScoreA = Number(game?.[3] || 0);
  const status = String(game?.[4] || '');
  const isEnded = /end|full|ft|finish|final|result|full[-\s]?time/i.test(status);
const isLive  = /live/i.test(status);

const isYet =
  /yet|kick|tbd|scheduled|not/i.test(status) ||
  (!isEnded && (!tableH.length && !tableA.length) && (baseScoreH + baseScoreA === 0));

const give90 = !isEnded && ((isYet || isLive) && (force90 || hasEdits));





  const players = useMemo(() => {
    const list = [];
    const pushRows = (rows, side) => {
      for (const row of rows) {
        const [name, _EO, _O, pts, explained, elementId, shortName, type] = row;
        const id = Number(elementId) || null;
        if (!id) continue;
        const exp = {};
        (explained || []).forEach(t => {
          if (!Array.isArray(t) || t.length < 3) return;
          exp[String(t[0])] = { times: Number(t[1])||0, pts: Number(t[2])||0 };
        });
        const mins = Number(exp?.minutes?.times || 0);
        list.push({
          id,
          name: shortName || name || String(id),
          type: Number(type) || 0,
          side,
          basePts: Number(pts) || 0,
          exp,
          eo: eoMap.get(id) || 0,
          myMul: Number(myExposure?.[id] || 0),
          baseGoals: Number(exp?.goals_scored?.times || 0),
          baseAssists: Number(exp?.assists?.times || 0),
          baseYC: Number(exp?.yellow_cards?.times || 0),
          baseRC: Number(exp?.red_cards?.times || 0),
          baseBonusPts: Number(exp?.bonus?.pts || 0),
          baseGCPts: Number(exp?.goals_conceded?.pts || 0),
          baseCSPts: Number(exp?.clean_sheets?.pts || 0),
          baseMinPts: minutesPts(mins),
        });
      }
    };
    pushRows(tableH, 'H'); pushRows(tableA, 'A');
    return list;
  }, [tableH, tableA, eoMap, myExposure]);

  // Snapshots for secondary fallback naming (current picked match)
  const playersSnapshot = useMemo(() => {
    const m = new Map();
    for (const p of players) m.set(p.id, { id: p.id, name: p.name, type: p.type });
    return m;
  }, [players]);

  const playerById = useMemo(() => playersSnapshot, [playersSnapshot]);
  // Build the same "players" structure for an arbitrary game (used by global summary)
const getPlayersForGame = useCallback((g) => {
  const rowsH = g?.[12] || [];
  const rowsA = g?.[13] || [];
  const list = [];
  const pushRows = (rows, side) => {
    for (const row of rows) {
      const [name, _EO, _O, pts, explained, elementId, shortName, type] = row;
      const id = Number(elementId) || null;
      if (!id) continue;
      const exp = {};
      (explained || []).forEach(t => {
        if (!Array.isArray(t) || t.length < 3) return;
        exp[String(t[0])] = { times: Number(t[1])||0, pts: Number(t[2])||0 };
      });
      const mins = Number(exp?.minutes?.times || 0);
      list.push({
        id,
        name: shortName || name || String(id),
        type: Number(type) || 0,
        side,
        basePts: Number(pts) || 0,
        exp,
        eo: eoMap.get(id) || 0,
        myMul: Number(myExposure?.[id] || 0),
        baseGoals: Number(exp?.goals_scored?.times || 0),
        baseAssists: Number(exp?.assists?.times || 0),
        baseYC: Number(exp?.yellow_cards?.times || 0),
        baseRC: Number(exp?.red_cards?.times || 0),
        baseBonusPts: Number(exp?.bonus?.pts || 0),
        baseGCPts: Number(exp?.goals_conceded?.pts || 0),
        baseCSPts: Number(exp?.clean_sheets?.pts || 0),
        baseMinPts: minutesPts(mins),
      });
    }
  };
  pushRows(rowsH, 'H'); pushRows(rowsA, 'A');
  return list;
}, [eoMap, myExposure]);


  // Global-first name resolver (elements → current match → id) + special "-1" → "none"
  const nameForId = useCallback((pid) => {
    const idNum = Number(pid);
    if (idNum === -1) return 'none';
    const pElem = globalNameMap.get(idNum);
    if (pElem?.name) return pElem.name;
    const pLive = playerById.get(idNum);
    if (pLive?.name) return pLive.name;
    return String(pid);
  }, [playerById, globalNameMap]);

  // Roster (names resolved at render time)
  useEffect(() => {
    const roster = Object.keys(myExposure || {}).map(k => {
      const pid = Number(k);
      const base = globalNameMap.get(pid) || { id: pid, type: 0 };
      return { id: pid, type: base.type || 0 };
    });
    setAllPlayers(roster);
  }, [myExposure, globalNameMap]);

  /* ---------------- Captain / Swap ---------------- */
  const [capModal, setCapModal] = useState(false);
  const [capTarget, setCapTarget] = useState(null);
  const openCaptainModal = () => { setCapTarget(null); setCapModal(true); };

  const getMulFor = (pid) => overrideMul.get(pid) ?? Number(myExposure?.[pid] || 0);

  const confirmCaptain = () => {
    if (!capTarget) return;
    const XI = allPlayers.filter(p => (overrideMul.get(p.id) ?? Number(myExposure?.[p.id] || 0)) > 0);
    const curCap = XI.find(p => (overrideMul.get(p.id) ?? Number(myExposure?.[p.id] || 0)) > 1);
    const capMul = Math.max(2, Number(curCap ? (overrideMul.get(curCap.id) ?? Number(myExposure?.[curCap.id] || 0)) : 2));
    const next = new Map(overrideMul);
    if (curCap) next.set(curCap.id, 1);
    next.set(capTarget, capMul);
    setOverrideMul(next);
    setCapModal(false);
  };

  const MIN_BY_TYPE = { 1: 1, 2: 3, 3: 2, 4: 1 };
  const xiSet = () => new Set(allPlayers.filter(p => getMulFor(p.id) > 0).map(p => p.id));
  const countsByType = (setIds) => {
    const c = {1:0,2:0,3:0,4:0};
    allPlayers.forEach(p => { if (setIds.has(p.id)) c[p.type] = (c[p.type]||0)+1; });
    return c;
  };
  const swapKeepsFormation = (benchId, starterId) => {
    const xi = xiSet();
    if (!xi.has(starterId) || xi.has(benchId)) return false;
    xi.delete(starterId); xi.add(benchId);
    if (xi.size !== 11) return false;
    const c = countsByType(xi);
    if (c[1] !== 1) return false;
    if (c[2] < MIN_BY_TYPE[2]) return false;
    if (c[3] < MIN_BY_TYPE[3]) return false;
    if (c[4] < MIN_BY_TYPE[4]) return false;
    return true;
  };

  const [swapModal, setSwapModal] = useState(false);
  const [swapA, setSwapA] = useState(null);
  const [swapB, setSwapB] = useState(null);
  const openSwapModal = () => { setSwapA(null); setSwapB(null); setSwapModal(true); };
  const confirmSwap = () => {
    if (!swapA || !swapB) return;
    if (!swapKeepsFormation(swapB, swapA)) return;
    const mulA = getMulFor(swapA);
    const mulB = getMulFor(swapB);
    const next = new Map(overrideMul);
    next.set(swapA, mulB);
    next.set(swapB, mulA);
    setOverrideMul(next);
    setSwapModal(false);
  };

  /* ---------------- Ranker ---------------- */
  const [ranker, setRanker] = useState(null);
  const [anchorTotal, setAnchorTotal] = useState(null);
  const [pointShift, setPointShift] = useState(0);
  const [tieFrac, setTieFrac] = useState(0.5);
  const [totalManagers, setTotalManagers] = useState(12000000);
  const [oldRank, setOldRank] = useState(null);
  const [liveRank, setLiveRank] = useState(null);

  const loadRanker = useCallback(async () => {
    try {
      let gw = Number(await AsyncStorage.getItem('gw.current'));
      if (!Number.isFinite(gw) || gw <= 0) {
        const cachedGW = await AsyncStorage.getItem('fplData');
        if (cachedGW) gw = Number(JSON.parse(cachedGW)?.data?.gw) || gw;
      }
      if (!Number.isFinite(gw) || gw <= 0) gw = 1;

      const res = await fetch(COUNTER_URL(gw), { headers: { 'cache-control': 'no-cache' } });
      if (!res.ok) throw new Error('counter fetch failed');
      const hist = await res.json();
      const rk = buildCounterRanker(hist);
      setRanker(rk); setTotalManagers(rk.N);

      const cached = await AsyncStorage.getItem('fplData');
      const payload = cached ? JSON.parse(cached)?.data || {} : {};
      const includeSubs = 1;
      const live = includeSubs
        ? Number(payload?.post_rank ?? payload?.displayrank)
        : Number(payload?.pre_rank ?? payload?.displayrank);
      const totalPts = Number(payload?.total_points ?? payload?.overall_points);

      const maybeOld = Number(payload?.old_rank);
      if (Number.isFinite(maybeOld) && maybeOld > 0) setOldRank(maybeOld);
      if (Number.isFinite(live) && live > 0) setLiveRank(live);
      if (Number.isFinite(totalPts)) setAnchorTotal(totalPts);

      if (rk && Number.isFinite(live) && Number.isFinite(totalPts)) {
        // Find tie bucket containing live
        let iStar = 0;
        for (let i = 0; i < rk.totals.length; i++) {
          const start = 1 + (rk.greater[i] || 0);
          const end = start + (rk.counts[i] || 0) - 1;
          if (live >= start && live <= end) { iStar = i; break; }
        }
        const Tstar = rk.totals[iStar];
        const start = 1 + (rk.greater[iStar] || 0);
        const tie = rk.counts[iStar] || 1;

        const shift = totalPts - Tstar;
        setPointShift(shift);

        const x = Math.max(0, Math.min(tie - 1, live - start));
        const frac = Math.min(0.999999, Math.max(0, (x + 1e-6) / tie));
        setTieFrac(frac);
      } else {
        setPointShift(0);
        setTieFrac(0.5);
      }
    } catch {
      setRanker(null); setAnchorTotal(null); setPointShift(0); setTieFrac(0.5);
    }
  }, []);
  useEffect(() => { loadRanker(); }, [loadRanker]);

  /* ---------------- Scoring + Sims ---------------- */
  const playerByIdLive = useMemo(() => {
    const m = new Map();
    for (const p of players) m.set(p.id, p);
    return m;
  }, [players]);

  const baseGoalsByPid   = useMemo(()=>{ const m=new Map(); players.forEach(p=>p.baseGoals&&m.set(p.id,p.baseGoals)); return m; },[players]);
  const baseAssistsByPid = useMemo(()=>{ const m=new Map(); players.forEach(p=>p.baseAssists&&m.set(p.id,p.baseAssists)); return m; },[players]);
  const baseYCByPid      = useMemo(()=>{ const m=new Map(); players.forEach(p=>p.baseYC&&m.set(p.id,p.baseYC)); return m; },[players]);
  const baseRCByPid      = useMemo(()=>{ const m=new Map(); players.forEach(p=>p.baseRC&&m.set(p.id,p.baseRC)); return m; },[players]);
  const baseBonusByPid   = useMemo(()=>{ const m=new Map(); players.forEach(p=>p.baseBonusPts&&m.set(p.id,p.baseBonusPts)); return m; },[players]);
  const baseDefconByPid  = useMemo(()=>{ const m=new Map(); players.forEach(p=>{ const pts=Number(p?.exp?.defensive_contribution?.pts||0); if (pts>0) m.set(p.id, Math.round(pts/2));}); return m; },[players]);

  const clampDelta = (cur, change, base) => {
    const next = cur + change;
    const min = -Math.max(0, Number(base)||0);
    return Math.max(min, next);
  };

  const changeDelta = useCallback((draft, kind, pid, change, baseMap) => {
    if (kind === 'assists') {
      if (change < 0) {
        const posGA = draft.goalAssists.get(pid) || 0;
        if (posGA > 0) {
          const nxt = posGA - 1;
          if (nxt === 0) draft.goalAssists.delete(pid); else draft.goalAssists.set(pid, nxt);
          return;
        }
        const cur = draft.assists.get(pid) || 0;
        const base = Number(baseMap.get(pid) || 0);
        const nxt = clampDelta(cur, -1, base);
        if (nxt === 0) draft.assists.delete(pid); else draft.assists.set(pid, nxt);
        return;
      } else {
        const cur = draft.assists.get(pid) || 0;
        if (cur < 0) {
          const nxt = Math.min(0, cur + 1);
          if (nxt === 0) draft.assists.delete(pid); else draft.assists.set(pid, nxt);
          return;
        }
        draft.assists.set(pid, cur + 1);
        return;
      }
    }
    const map = draft[kind];
    const cur = map.get(pid) || 0;
    const base = Number(baseMap.get(pid) || 0);
    const nxt = clampDelta(cur, change, base);
    if (nxt === 0) map.delete(pid); else map.set(pid, nxt);
  }, []);

  // changeKind: mutate fake events by ±1 while respecting base counts
  const changeKind = useCallback((sign, kind, pid) => {
    setFake(prev => {
      const d = {
        goals: new Map(prev.goals),
        goalAssists: new Map(prev.goalAssists),
        assists: new Map(prev.assists),
        yc: new Map(prev.yc),
        rc: new Map(prev.rc),
        bonus: new Map(prev.bonus),
        defcon: new Map(prev.defcon),
      };

      const baseMap =
        kind === 'goals'   ? baseGoalsByPid   :
        kind === 'assists' ? baseAssistsByPid :
        kind === 'yc'      ? baseYCByPid      :
        kind === 'rc'      ? baseRCByPid      :
        kind === 'bonus'   ? baseBonusByPid   :
        kind === 'defcon'  ? baseDefconByPid  : new Map();

      changeDelta(d, kind, pid, sign, baseMap);
      return d;
    });
  }, [
    changeDelta,
    baseGoalsByPid, baseAssistsByPid, baseYCByPid,
    baseRCByPid, baseBonusByPid, baseDefconByPid
  ]);

  const resetAll = useCallback(() => {
    // reset only the CURRENT game's simulated state
    setFake(emptyFake());
    setForce90(false);
    setOverrideMul(new Map());
    setShowEditor(false);
  }, [emptyFake]);

  const scoreDelta = useMemo(() => {
    let dH = 0, dA = 0;
    for (const [pid, d] of fake.goals.entries()) {
      const p = playerByIdLive.get(pid);
      if (!p) continue;
      if (p.side === 'H') dH += d; else dA += d;
    }
    return { dH, dA };
  }, [fake.goals, playerByIdLive]);

  const simScoreH = baseScoreH + scoreDelta.dH;
  const simScoreA = baseScoreA + scoreDelta.dA;
  const changedScore = scoreDelta.dH !== 0 || scoreDelta.dA !== 0;

  const teamConceded = { H: simScoreA, A: simScoreH };
  const baseTeamConceded = { H: baseScoreA, A: baseScoreH };
  const teamCS = { H: simScoreA === 0, A: simScoreH === 0 };
  const baseTeamCS = { H: baseScoreA === 0, A: baseScoreH === 0 };



  const allowDef = give90 || changedScore;

  const playerDeltaMap = useMemo(() => {
    const m = new Map();
    for (const p of players) {
      const minBase = p.baseMinPts;
      const minNew = give90 ? 2 : minBase;

      const deltaMin = minNew - minBase;

      const dGoals = Number(fake.goals.get(p.id) || 0);
      const dAssists = Number(fake.assists.get(p.id) || 0) + Number(fake.goalAssists.get(p.id) || 0);
      const dYC = Number(fake.yc.get(p.id) || 0);
      const dRC = Number(fake.rc.get(p.id) || 0);
      const dBonus = Number(fake.bonus.get(p.id) || 0);
      const dDefU = Number(fake.defcon.get(p.id) || 0);

      const deltaDirect =
        dGoals * goalPoints(p.type) +
        dAssists * 3 +
        dYC * (-1) +
        dRC * (-3) +
        dBonus * (1) +
        dDefU * (2);

      // A player only gets CS/GC if they are eligible:
// - give90 → everyone eligible (live/yet or you toggled 90′)
// - otherwise must have 60+ mins (baseMinPts >= 2)
const defEligible = give90 || p.baseMinPts >= 2;

const deltaCS = (allowDef && defEligible)
  ? ((teamCS[p.side] ? csPoints(p.type) : 0) - p.baseCSPts)
  : 0;

const deltaGC = (allowDef && defEligible)
  ? (gcPenalty(teamConceded[p.side], p.type) - p.baseGCPts)
  : 0;


      const delta = deltaDirect + deltaMin + deltaCS + deltaGC;
      if (delta !== 0) m.set(p.id, delta);
      // --- DEBUG: Alert when Doku's totals move ---


    }
    return m;
  }, [players, fake, give90, allowDef, teamCS, teamConceded]);

  const returnsIntensity = useMemo(() => {
    const m = new Map();
    for (const p of players) {
      const g = Math.max(0, Number(fake.goals.get(p.id) || 0));
      const a = Math.max(0, Number(fake.assists.get(p.id) || 0) + Number(fake.goalAssists.get(p.id) || 0));
      const b = Math.max(0, Number(fake.bonus.get(p.id) || 0));
      const d = Math.max(0, Number(fake.defcon.get(p.id) || 0));
      const totalPosReturns = g + a + b + d;
      if (totalPosReturns > 0) m.set(p.id, totalPosReturns);
    }
    return m;
  }, [players, fake.goals, fake.assists, fake.goalAssists, fake.bonus, fake.defcon]);

  const simAgg = useMemo(() => {
    let myDelta = 0, fieldDelta = 0;
    const getMul = (p) => overrideMul.get(p.id) ?? Number(p.myMul || 0);
    for (const p of players) {
      const delta = playerDeltaMap.get(p.id) || 0;
      if (!delta) continue;
      const myMul = getMul(p);

      const mPos = Number(returnsIntensity.get(p.id) || 0);
      const eoEff = effectiveEOMult(p.eo, mPos, delta);

      myDelta += myMul * delta;
      fieldDelta += eoEff * delta;
    }
    return { myDelta, fieldDelta, net: myDelta - fieldDelta };
  }, [players, playerDeltaMap, returnsIntensity, overrideMul]);

  const gwBasePtsByPid = useMemo(() => {
    const m = new Map();
    for (const g of games) {
      const tables = [(g?.[12]||[]), (g?.[13]||[])];
      for (const rows of tables) {
        for (const row of rows) {
          const id  = Number(row?.[5]) || Number(row?.[6]) || null;
          const pts = Number(row?.[3]) || 0;
          if (!id) continue;
          m.set(id, (m.get(id) || 0) + pts);
        }
      }
    }
    return m;
  }, [games]);

  const tweakBaseDelta = useMemo(() => {
    let sum = 0;
    for (const p of allPlayers) {
      const pid = Number(p.id);
      const origMul = Number(myExposure?.[pid] || 0);
      const newMul  = overrideMul.get(pid) ?? origMul;
      if (newMul !== origMul) {
        const basePtsGW = Number(gwBasePtsByPid.get(pid) || 0);
        sum += (newMul - origMul) * basePtsGW;
      }
    }
    return sum;
  }, [allPlayers, myExposure, overrideMul, gwBasePtsByPid]);

  const estimateRank = useCallback((netDeltaPts) => {
    if (!ranker || anchorTotal == null) return null;
    const t = (anchorTotal + (Number(netDeltaPts) || 0)) - (Number(pointShift) || 0);
    const isInt = Math.abs(t - Math.round(t)) < 1e-6;
    const r = isInt ? ranker.rankAtFrac(Math.round(t), tieFrac) : ranker.rankAtSmooth(t, tieFrac);
    return Math.min(totalManagers || 12000000, Math.max(1, r));
  }, [ranker, anchorTotal, pointShift, tieFrac, totalManagers]);

  const myTotalDelta    = simAgg.myDelta + tweakBaseDelta;
  const fieldTotalDelta = simAgg.fieldDelta;
  const netTotalDelta   = myTotalDelta - fieldTotalDelta;
  const netSaturated = Math.sign(netTotalDelta) * (SATURATE_K * (1 - Math.exp(-Math.abs(netTotalDelta) / SATURATE_K)));
  const estRank = estimateRank(netSaturated);

  const hasScenario = useMemo(() =>
    force90 || overrideMul.size > 0 || hasEdits, [force90, overrideMul, hasEdits]);

  /* --------- Direction arrows (vs OLD when available) --------- */
  const dirVs = (base, now) => {
    if (!Number.isFinite(base) || !Number.isFinite(now)) return 'same';
    if (now < base) return 'up';
    if (now > base) return 'down';
    return 'same';
  };
  const liveDir = dirVs(oldRank ?? null, liveRank ?? null);
  const estDir  = dirVs(oldRank ?? null, estRank ?? null);

  /* --------------------------- Quick Add Modals ---------------------------- */
  const [quickKind, setQuickKind] = useState(null); // 'goals'|'assists'|'yc'|'rc'|'bonus'|'defcon'
  const [selScorer, setSelScorer] = useState(null);
  const [selAssister, setSelAssister] = useState(null);
  const [selPid, setSelPid] = useState(null);

  const isInMyTeam = useCallback((pid) => (overrideMul.get(pid) ?? Number(myExposure?.[pid] || 0)) > 0, [overrideMul, myExposure]);

  const sortForPicker = useCallback((arr) => {
    return [...arr].sort((a,b) => {
      if (a?.id === -1) return -1; // keep "none" on top when present
      if (b?.id === -1) return 1;
      const aIn = isInMyTeam(a.id) ? 1 : 0;
      const bIn = isInMyTeam(b.id) ? 1 : 0;
      if (aIn !== bIn) return bIn - aIn; // my team first
      const aEO = Number(a?.eo || 0);
      const bEO = Number(b?.eo || 0);
      if (aEO !== bEO) return bEO - aEO;  // then by EO desc
      const an = (a?.name || '').toLowerCase();
      const bn = (b?.name || '').toLowerCase();
      return an.localeCompare(bn);
    });
  }, [isInMyTeam]);

  const openQuickAdd = (kind) => {
    if (!showEditor) setPickOpen(true);
    else {
      setQuickKind(kind);
      setSelScorer(null); setSelAssister(null); setSelPid(null);
    }
  };

  const confirmQuickAdd = () => {
    if (!quickKind) return;
    setFake(prev => {
      const d = {
        goals: new Map(prev.goals),
        goalAssists: new Map(prev.goalAssists),
        assists: new Map(prev.assists),
        yc: new Map(prev.yc),
        rc: new Map(prev.rc),
        bonus: new Map(prev.bonus),
        defcon: new Map(prev.defcon),
      };
      if (quickKind === 'goals') {
        if (!selScorer) return prev;
        d.goals.set(selScorer, (d.goals.get(selScorer) || 0) + 1);
        if (selAssister != null && selAssister !== -1) {
          d.goalAssists.set(selAssister, (d.goalAssists.get(selAssister) || 0) + 1);
        }
      } else if (quickKind === 'assists') {
        if (!selPid) return prev;
        d.assists.set(selPid, (d.assists.get(selPid)||0) + 1);
      } else if (quickKind === 'yc') {
        if (!selPid) return prev;
        d.yc.set(selPid, (d.yc.get(selPid)||0) + 1);
      } else if (quickKind === 'rc') {
        if (!selPid) return prev;
        d.rc.set(selPid, (d.rc.get(selPid)||0) + 1);
      } else if (quickKind === 'bonus') {
        if (!selPid) return prev;
        d.bonus.set(selPid, (d.bonus.get(selPid)||0) + 1);
      } else if (quickKind === 'defcon') {
        if (!selPid) return prev;
        d.defcon.set(selPid, (d.defcon.get(selPid)||0) + 1);
      }
      return d;
    });
    if ((isYet || isLive) && !force90) setForce90(true);
    setQuickKind(null);
    setSelScorer(null); setSelAssister(null); setSelPid(null);
  };
// === Global “who changed” across all edited games (EO ≥ 1%) ===
const changedPlayersAll = useMemo(() => {
  const out = [];
  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    if (!g) continue;

    const bundle = getBundleFor(i);
    const f = bundle.fake || emptyFake();

    // quick skip if nothing at all in this game
    const anyEdits =
      f.goals.size || f.goalAssists.size || f.assists.size ||
      f.yc.size || f.rc.size || f.bonus.size || f.defcon.size || bundle.force90;
    if (!anyEdits) continue;

    const baseH = Number(g?.[2] || 0);
    const baseA = Number(g?.[3] || 0);

    // score deltas in this game from added/removed goals
    let dH = 0, dA = 0;
    const list = getPlayersForGame(g);
    const byId = new Map(list.map(p => [p.id, p]));

    for (const [pid, d] of f.goals.entries()) {
      const p = byId.get(pid);
      if (!p) continue;
      if (p.side === 'H') dH += d; else dA += d;
    }

    const simH = baseH + dH;
    const simA = baseA + dA;

   const status   = String(g?.[4] || '');
const isEndedG = /end|full|ft|finish|final|result|full[-\s]?time/i.test(status);
const isLiveG  = /live/i.test(status);

const isYetG =
  /yet|kick|tbd|scheduled|not/i.test(status) ||
  (!isEndedG && (!(g?.[12]?.length || g?.[13]?.length)) && (baseH + baseA === 0));

const give90G   = !isEndedG && ((isYetG || isLiveG) && (bundle.force90 || anyEdits));
const allowDefG = give90G || (dH !== 0 || dA !== 0);



    const teamConceded = { H: simA, A: simH };
    const baseConceded = { H: baseA, A: baseH };
    const teamCS = { H: simA === 0, A: simH === 0 };

    // precompute base counts maps for clamp
    const baseGoals = new Map(), baseAssists = new Map(), baseYC = new Map(), baseRC = new Map(), baseBonus = new Map(), baseDefcon = new Map();
    list.forEach(p => {
      if (p.baseGoals) baseGoals.set(p.id, p.baseGoals);
      if (p.baseAssists) baseAssists.set(p.id, p.baseAssists);
      if (p.baseYC) baseYC.set(p.id, p.baseYC);
      if (p.baseRC) baseRC.set(p.id, p.baseRC);
      if (p.baseBonusPts) baseBonus.set(p.id, p.baseBonusPts);
      const defPts = Number(p?.exp?.defensive_contribution?.pts || 0);
      if (defPts > 0) baseDefcon.set(p.id, Math.round(defPts/2));
    });

    // Combine assists (from goal dialog + direct)
    const mergedAssists = (() => {
      const m = new Map(f.assists);
      for (const [k,v] of f.goalAssists.entries()) m.set(k, (m.get(k)||0) + v);
      return m;
    })();

    const returnsIntensity = new Map(); // positive returns count (for EO attenuation)
    const playerDeltaMap = new Map();

    for (const p of list) {
      const minBase = p.baseMinPts;
      // Use this game's flags, not the current match's
const minNew = give90G ? 2 : minBase;

      const deltaMin = minNew - minBase;

      const dGoals = Number(f.goals.get(p.id) || 0);
      const dAssists = Number(mergedAssists.get(p.id) || 0);
      const dYC = Number(f.yc.get(p.id) || 0);
      const dRC = Number(f.rc.get(p.id) || 0);
      const dBonus = Number(f.bonus.get(p.id) || 0);
      const dDefU = Number(f.defcon.get(p.id) || 0);

      const deltaDirect =
        dGoals * goalPoints(p.type) +
        dAssists * 3 +
        dYC * (-1) +
        dRC * (-3) +
        dBonus * (1) +
        dDefU * (2);

      const defEligible = give90G || p.baseMinPts >= 2;

const deltaCS = (allowDefG && defEligible)
  ? ((teamCS[p.side] ? csPoints(p.type) : 0) - p.baseCSPts)
  : 0;
const gcPenaltyBase = (t) => (t === 1 || t === 2 ? -Math.floor((Number(teamConceded[p.side]) || 0) / 2) : 0); // uses sim conceded
const deltaGC = (allowDefG && defEligible)
  ? (gcPenaltyBase(p.type) - p.baseGCPts)
  : 0;

      
      

      const delta = deltaDirect + deltaMin + deltaCS + deltaGC;
      if (delta !== 0) {
        playerDeltaMap.set(p.id, delta);
        const gPos = Math.max(0, dGoals);
        const aPos = Math.max(0, dAssists);
        const bPos = Math.max(0, dBonus);
        const dPos = Math.max(0, dDefU);
        const totalPos = gPos + aPos + bPos + dPos;
        if (totalPos > 0) returnsIntensity.set(p.id, totalPos);
      }
    }

    // push “who changed” rows (EO ≥ 1%)
    for (const [pid, d] of playerDeltaMap.entries()) {
      const p = byId.get(pid);
      if (!p) continue;
      const eoPct = Number(p.eo || 0);
      if (eoPct <= 1) continue; // ≥ 1% only
      out.push({
        id: pid,
        name: p.name,
        eo: eoPct,
        real: Number(p.basePts || 0),
        fake: Number(p.basePts || 0) + Number(d || 0),
        delta: Number(d || 0),
        type: p.type,
        side: p.side,
        gIdx: i,
      });
    }
  }

  // biggest swings first
  out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return out;
}, [games, getBundleFor, emptyFake, getPlayersForGame]);


  // === Global Summary of Fake Events across all edited games (with cascades) ===
const changesSummaryAll = useMemo(() => {
  const out = [];
  const bucket = (x) => Math.floor(Math.max(0, Number(x) || 0) / 2);

  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    if (!g) continue;

    const bundle = getBundleFor(i);
    const f = bundle.fake || emptyFake();
    const anyEdits =
      f.goals.size || f.goalAssists.size || f.assists.size ||
      f.yc.size || f.rc.size || f.bonus.size || f.defcon.size || bundle.force90;
    if (!anyEdits) continue;

    const homeNameG = String(g?.[0] || 'Home');
    const awayNameG = String(g?.[1] || 'Away');
    const baseH = Number(g?.[2] || 0);
    const baseA = Number(g?.[3] || 0);

    // score deltas for headers & cascades
    const list = getPlayersForGame(g);
    const byId = new Map(list.map(p => [p.id, p]));
    let dH = 0, dA = 0;
    for (const [pid, d] of f.goals.entries()) {
      const p = byId.get(pid);
      if (!p) continue;
      if (p.side === 'H') dH += d; else dA += d;
    }
    const simH = baseH + dH;
    const simA = baseA + dA;

    // section header per edited game (shows base → sim score if changed)
    const header = (dH !== 0 || dA !== 0)
      ? `${homeNameG} vs ${awayNameG}: ${baseH}–${baseA} → ${simH}–${simA}`
      : `${homeNameG} vs ${awayNameG}: edits with no score change`;
    out.push(header);

    // ---- Direct edits
    const act = (d) => (d > 0 ? 'Added' : 'Removed');
    const qty = (d) => { const n = Math.abs(Number(d) || 0); return n > 1 ? ` ×${n}` : ''; };
    const pushMap = (mapObj, noun) => {
      for (const [pid, d] of mapObj.entries()) {
        if (!d) continue;
        out.push(`• ${act(d)} ${noun}: ${nameForId(pid)}${qty(d)}`);
      }
    };
    pushMap(f.goals, 'goal');
    pushMap(f.goalAssists, 'assist');
    pushMap(f.assists, 'assist');
    pushMap(f.yc, 'yellow card');
    pushMap(f.rc, 'red card');
    pushMap(f.bonus, 'bonus point');
    pushMap(f.defcon, 'defensive bonus (+2)');

    // ---- Cascades (CS / GC buckets)
    const status   = String(g?.[4] || '');
const isEndedG = /end|full|ft|finish|final|result|full[-\s]?time/i.test(status);
const isLiveG  = /live/i.test(status);

const isYetG =
  /yet|kick|tbd|scheduled|not/i.test(status) ||
  (!isEndedG && (!(g?.[12]?.length || g?.[13]?.length)) && (baseH + baseA === 0));

const give90G  = !isEndedG && ((isYetG || isLiveG) && (bundle.force90 || anyEdits));



    // Clean sheets
    const baseCS = { H: baseA === 0, A: baseH === 0 };
    const simCS  = { H: simA === 0,  A: simH === 0  };
    if (baseCS.H !== simCS.H) out.push(`• ${simCS.H ? 'Clean sheet gained' : 'Clean sheet lost'}: ${homeNameG}`);
    if (baseCS.A !== simCS.A) out.push(`• ${simCS.A ? 'Clean sheet gained' : 'Clean sheet lost'}: ${awayNameG}`);

    // Goals-conceded penalties bucket changes
    const bH = bucket(baseA), sH = bucket(simA);
    if (bH !== sH) {
      const dir = sH > bH ? 'More goals conceded' : 'Fewer goals conceded';
      out.push(`• ${dir}: ${homeNameG} ×${Math.abs(sH - bH)}`);
    }
    const bA = bucket(baseH), sA = bucket(simH);
    if (bA !== sA) {
      const dir = sA > bA ? 'More goals conceded' : 'Fewer goals conceded';
      out.push(`• ${dir}: ${awayNameG} ×${Math.abs(sA - bA)}`);
    }

    // Minutes credit (only if it upgrades anybody)
    if (give90G) {
      let upgraded = 0;
      for (const p of list) if (p.baseMinPts < 2) upgraded++;
      if (upgraded > 0) out.push(`• Minutes credited as 90′: ${upgraded} players`);
    }
  }
  return out;
}, [games, getBundleFor, emptyFake, getPlayersForGame, nameForId]);



  /* --------------------------------- Render -------------------------------- */
  if (loading) {
    return (
      <SafeAreaView style={S.safe} edges={['left', 'right']}>
        <AppHeader  />
        <View style={S.center}><ActivityIndicator color={C.accent} /><Text style={S.muted}>Loading…</Text></View>
      </SafeAreaView>
    );
  }

  const RankArrow = ({ dir, size=16 }) => {
    const src = dir === 'up' ? assetImages?.up
      : dir === 'down' ? assetImages?.down
      : assetImages?.same;
    if (src) return <Image source={src} style={{ width: size, height: size, marginLeft: 6 }} resizeMode="contain" />;
    return (
      <MaterialCommunityIcons
        name={dir === 'up' ? 'arrow-up-bold' : dir === 'down' ? 'arrow-down-bold' : 'arrow-right-bold'}
        size={size}
        color={dir === 'up' ? '#16a34a' : dir === 'down' ? '#dc2626' : C.muted}
      />
    );
  };

  return (
   <SafeAreaView style={S.safe} edges={['left', 'right']}>
      <AppHeader  />
      <ScrollView
        refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} />}
      >
      {/* Title + brief explanation */}
      <View style={S.card}>
        <Text style={S.pageTitle}>What-If Simulator</Text>
        <Text style={S.pageBlurb}>
          Quickly test fake goals, assists, cards, and bonus to see how your live rank might change.
          Use the (−) on chips to remove events — they’ll appear struck below so you can tap to restore.
        </Text>
      </View>

      {/* Rank header */}
      <View style={S.card}>
        {/* LIVE row — always show with clubs arrows (vs OLD when available) */}
        <View style={S.rankLine}>
          <Text style={[S.rankBig, hasScenario && S.strike]}>
            Live Rank: {liveRank ? liveRank.toLocaleString() : '—'}
          </Text>
          <RankArrow dir={liveDir} size={18} />
        </View>

        {/* Estimated row only when scenario exists */}
        {hasScenario && (
          <>
            <View style={[S.rankLine, { marginTop: 4 }]}>
              <Text style={S.rankNew}>
                Scenario Rank: {estRank ? estRank.toLocaleString() : '—'}
              </Text>
              <RankArrow dir={estDir} size={18} />
            </View>
            <Text style={S.deltaTxt}>
              You {myTotalDelta>=0?'+':''}{myTotalDelta.toFixed(1)} • Field {fieldTotalDelta>=0?'+':''}{fieldTotalDelta.toFixed(1)} • Net {netTotalDelta>=0?'+':''}{netTotalDelta.toFixed(1)}
            </Text>
          </>
        )}

        {hasScenario && (
          <TouchableOpacity onPress={resetAll} style={S.resetBtn}>
            <MaterialCommunityIcons name="backup-restore" size={16} color={C.ink} />
            <Text style={S.resetTxt}>Reset</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Global Summary of changes across all edited games */}
{changesSummaryAll.length > 0 && (
  <View style={S.card}>
    <Text style={S.cardTitle}>Summary of Fake Events (All Games)</Text>
    <View style={S.summaryList}>
      {changesSummaryAll.map((line, i) => (
        <Text key={`sum-all-${i}`} style={S.summaryItem} numberOfLines={1}>
          {line.startsWith('•') ? line : `— ${line}`}
        </Text>
      ))}
    </View>

    {/* Who changed button only when there are affected players */}
    {changedPlayersAll.length > 0 && (
      <TouchableOpacity onPress={() => setShowDiff(true)} style={S.resetBtn}>
        <MaterialCommunityIcons name="chart-line-variant" size={16} color={C.ink} />
        <Text style={S.resetTxt}>Who changed</Text>
      </TouchableOpacity>
    )}
  </View>
)}

    

      {/* Top Menu */}
      <View style={S.card}>
        <Text style={S.cardTitle}>Actions</Text>
        <View style={S.menuRow}>
          <MenuButton
            icon="plus-circle-outline"
            label="Add Fake Events"
            onPress={() => setPickOpen(true)}
            C={C}
          />
          
          

          <MenuButton
            icon="account-edit-outline"
            label="Change Captain"
            onPress={openCaptainModal}
            C={C}
          />
          <MenuButton
            icon="swap-horizontal"
            label="Swap XI ↔ Bench"
            onPress={openSwapModal}
            C={C}
          />
        </View>

        {showEditor && (
          <View style={S.editorBar}>
            {/* in the editor bar line, show the simulated score (accounts for fake events) */}
            <Text style={S.editorMatch} numberOfLines={1}>
              {game ? `${homeName} vs ${awayName}  •  ${simScoreH}–${simScoreA}  •  ${String(status||'')}` : 'Pick a match'}
            </Text>

            {isLive && (
              <TouchableOpacity
                style={[S.tinyBtn, force90 && S.tinyBtnActive]}
                onPress={() => setForce90((v)=>!v)}
              >
                <MaterialCommunityIcons name="timer-outline" size={14} color={C.muted} />
                <Text style={S.tinyBtnTxt}>{force90 ? `Ended (90')` : `End game (90')`}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={S.tinyBtn} onPress={() => setShowEditor(false)}>
              <MaterialCommunityIcons name="eye-off-outline" size={14} color={C.muted} />
              <Text style={S.tinyBtnTxt}>Hide editor</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Event editor appears only after a match is picked */}
      {showEditor && (
        <View style={{ paddingHorizontal: 10, paddingBottom: 14 }}>
          <View style={S.card}>
            <Row title="Goals" icon="soccer" C={C} S={S}
                 onAdd={() => setQuickKind('goals')}>
              <ChipsNew
                kept={makeChips(baseGoalsByPid, fake.goals, nameForId, (n,t,d)=> `${n} ⚽×${t}${d?` (${d>0?'+':''}${d})`:''}`)}
                removed={makeRemoved(baseGoalsByPid, fake.goals, nameForId, (n,t,d)=> `${n} ⚽×${Math.max(0,t)} (${d})`)}
                kind="goals" S={S}
                onMinus={(k,id)=>changeKind(-1,k,id)} onRestore={(k,id)=>changeKind(+1,k,id)}
              />
            </Row>

            <Row title="Assists" icon="handshake-outline" C={C} S={S}
                 onAdd={() => setQuickKind('assists')}>
              <ChipsNew
                kept={makeChips(baseAssistsByPid, mergeAssists(fake.goalAssists, fake.assists), nameForId, (n,t,d)=> `${n} 🅰️×${t}${d?` (${d>0?'+':''}${d})`:''}`)}
                removed={makeRemoved(baseAssistsByPid, mergeAssists(fake.goalAssists, fake.assists), nameForId, (n,t,d)=> `${n} 🅰️×${Math.max(0,t)} (${d})`)}
                kind="assists" S={S}
                onMinus={(k,id)=>changeKind(-1,k,id)} onRestore={(k,id)=>changeKind(+1,k,id)}
              />
            </Row>

            <Row title="Yellow Cards" icon="card-outline" C={C} S={S}
                 onAdd={() => setQuickKind('yc')}>
              <ChipsNew
                kept={makeChips(baseYCByPid, fake.yc, nameForId, (n,t,d)=> `${n} 🟨×${t}${d?` (${d>0?'+':''}${d})`:''}`)}
                removed={makeRemoved(baseYCByPid, fake.yc, nameForId, (n,t,d)=> `${n} 🟨×${Math.max(0,t)} (${d})`)}
                kind="yc" S={S}
                onMinus={(k,id)=>changeKind(-1,k,id)} onRestore={(k,id)=>changeKind(+1,k,id)}
              />
            </Row>

            <Row title="Red Cards" icon="card-outline" C={C} S={S}
                 onAdd={() => setQuickKind('rc')}>
              <ChipsNew
                kept={makeChips(baseRCByPid, fake.rc, nameForId, (n,t,d)=> `${n} 🟥×${t}${d?` (${d>0?'+':''}${d})`:''}`)}
                removed={makeRemoved(baseRCByPid, fake.rc, nameForId, (n,t,d)=> `${n} 🟥×${Math.max(0,t)} (${d})`)}
                kind="rc" S={S}
                onMinus={(k,id)=>changeKind(-1,k,id)} onRestore={(k,id)=>changeKind(+1,k,id)}
              />
            </Row>

            <Row title="Bonus" icon="medal-outline" C={C} S={S}
                 onAdd={() => setQuickKind('bonus')}>
              <ChipsNew
                kept={makeChips(baseBonusByPid, fake.bonus, nameForId, (n,t,d)=> `${n} ⭐${t>0?`+${t}`:t}${d?` (${d>0?'+':''}${d})`:''}`)}
                removed={makeRemoved(baseBonusByPid, fake.bonus, nameForId, (n,t,d)=> `${n} ⭐${Math.max(0,t)} (${d})`)}
                kind="bonus" S={S}
                onMinus={(k,id)=>changeKind(-1,k,id)} onRestore={(k,id)=>changeKind(+1,k,id)}
              />
            </Row>

            <Row title="DefCon (+2)" icon="shield-check" C={C} S={S}
                 onAdd={() => setQuickKind('defcon')}>
              <ChipsNew
                kept={makeChips(baseDefconByPid, fake.defcon, nameForId, (n,t,d)=> `${n} 🛡️+${t*2}${d?` (${d>0?'+':''}${d*2})`:''}`)}
                removed={makeRemoved(baseDefconByPid, fake.defcon, nameForId, (n,t,d)=> `${n} 🛡️+${Math.max(0,t)*2} (${d*2})`)}
                kind="defcon" S={S}
                onMinus={(k,id)=>changeKind(-1,k,id)} onRestore={(k,id)=>changeKind(+1,k,id)}
              />
            </Row>
          </View>
        </View>
      )}

      {/* Points-change modal */}
<Modal
  transparent
  visible={showDiff}
  onRequestClose={() => setShowDiff(false)}
  animationType="fade"
>
  <View style={S.modalBack}>
    <View style={S.modalCard}>
      <View style={S.rowHeader}>
        <Text style={S.modalTitle}>Points change (EO ≥ 1%)</Text>
        <TouchableOpacity onPress={() => setShowDiff(false)}>
          <MaterialCommunityIcons name="close" size={18} color={C.muted} />
        </TouchableOpacity>
      </View>

      {changedPlayersAll.length === 0 ? (
        <Text style={S.muted}>No affected players with EO ≥ 1%.</Text>
      ) : (
        <ScrollView style={{ maxHeight: 360 }}>
          {changedPlayersAll.map(p => (
            <View key={`diff-${p.id}-${p.gIdx}`} style={S.pickRow}>
              <Text style={S.pickTxt} numberOfLines={1}>
                {nameForId(p.id)}
                {p.type ? ` • ${TYPE_LABEL[p.type] || ''}` : ''}
                {` • EO ${Math.round(p.eo)}%`}
              </Text>
              <Text style={[S.pickTxt, { marginTop: 2 }]}>
                {`Real ${p.real} → Fake ${p.fake} `}
                <Text style={{ fontWeight: '700', color: p.delta > 0 ? '#16a34a' : '#dc2626' }}>
                  ({p.delta > 0 ? '+' : ''}{p.delta})
                </Text>
              </Text>
            </View>
          ))}
        </ScrollView>
      )}

      <View style={S.modalActions}>
        <PrimaryBtn label="Close" onPress={() => setShowDiff(false)} />
      </View>
    </View>
  </View>
</Modal>


      {/* Captain modal */}
      <Modal transparent visible={capModal} onRequestClose={()=>setCapModal(false)} animationType="fade">
        <View style={S.modalBack}><View style={S.modalCard}>
          <View style={S.rowHeader}>
            <Text style={S.modalTitle}>Pick new Captain</Text>
            <TouchableOpacity onPress={()=>setCapModal(false)}><MaterialCommunityIcons name="close" size={18} color={C.muted} /></TouchableOpacity>
          </View>
          <ScrollView style={{maxHeight:320}}>
            {allPlayers
              .filter(p => (overrideMul.get(p.id) ?? Number(myExposure?.[p.id] || 0)) > 0)
              .map(p => (
              <TouchableOpacity key={`cap-${p.id}`} onPress={()=>setCapTarget(p.id)}  style={[S.pickRow, capTarget === p.id && S.pickRowActive]}>
                <Text style={S.pickTxt} numberOfLines={1}>
                  {nameForId(p.id)} • {TYPE_LABEL[p.type] || ''}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <View style={S.modalActions}>
            <PrimaryBtn
              label="Set Captain"
              onPress={confirmCaptain}
              disabled={!capTarget}
            />
          </View>
        </View></View>
      </Modal>

      {/* Swap modal */}
      <Modal transparent visible={swapModal} onRequestClose={()=>setSwapModal(false)} animationType="fade">
        <View style={S.modalBack}><View style={S.modalCard}>
          <View style={S.rowHeader}>
            <Text style={S.modalTitle}>Swap XI ↔ Bench</Text>
            <TouchableOpacity onPress={()=>setSwapModal(false)}><MaterialCommunityIcons name="close" size={18} color={C.muted} /></TouchableOpacity>
          </View>

          <Text style={S.modalLabel}>Bench (pick one)</Text>
          <ScrollView style={{maxHeight:140}}>
            {allPlayers
              .filter(p => getMulFor(p.id) === 0)
              .map(p=>(
              <TouchableOpacity key={`sw-bench-${p.id}`} onPress={()=>setSwapB(p.id)} style={[S.pickRow, swapB===p.id && S.pickRowActive]}>
                <Text style={S.pickTxt} numberOfLines={1}>{nameForId(p.id)} • {TYPE_LABEL[p.type]||''}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={[S.modalLabel,{marginTop:6}]}>Starter to replace</Text>
          <ScrollView style={{maxHeight:140}}>
            {allPlayers
              .filter(p => getMulFor(p.id) > 0)
              .filter(p => !swapB || swapKeepsFormation(swapB, p.id))
              .map(p=>(
               <TouchableOpacity key={`sw-a-${p.id}`} onPress={()=>setSwapA(p.id)} style={[S.pickRow, swapA===p.id && S.pickRowActive]}>
                 <Text style={S.pickTxt} numberOfLines={1}>{nameForId(p.id)}</Text>
               </TouchableOpacity>
             ))}
           </ScrollView>

          <View style={S.modalActions}>
            <PrimaryBtn
              label="Swap"
              onPress={confirmSwap}
              disabled={!swapA || !swapB || !swapKeepsFormation(swapB, swapA)}
            />
          </View>
        </View></View>
      </Modal>

      {/* Pick Match modal */}
      <Modal transparent visible={pickOpen} onRequestClose={()=>setPickOpen(false)} animationType="fade">
        <View style={S.modalBack}><View style={S.modalCard}>
          <View style={S.rowHeader}>
            <Text style={S.modalTitle}>Pick a Match</Text>
            <TouchableOpacity onPress={()=>setPickOpen(false)}><MaterialCommunityIcons name="close" size={18} color={C.muted} /></TouchableOpacity>
          </View>
          <ScrollView style={{maxHeight:420}}>
            {/* in the Pick Match modal list, reflect the simulated score for the currently selected match */}
            {games.map((g, i)=>(
              <TouchableOpacity
                key={`g-${i}`}
                onPress={() => {
   // 1) Persist the CURRENT game's bundle
   setPerGame(prev => {
     const m = new Map(prev);
     m.set(gIdx, { fake, force90 });
     return m;
   });
   // 2) Load (or init) the TARGET game's bundle
   const bundle = getBundleFor(i);
   setGIdx(i);
   setFake(bundle.fake);
   setForce90(bundle.force90);
   setPickOpen(false);
   setShowEditor(true);
 }}
                style={S.pickRow}
              >
                <Text style={S.pickTxt} numberOfLines={1}>
                  {String(g?.[0]||'Home')} vs {String(g?.[1]||'Away')} • {(i===gIdx?simScoreH:Number(g?.[2]||0))}–{(i===gIdx?simScoreA:Number(g?.[3]||0))} • {String(g?.[4]||'')}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View></View>
      </Modal>

      {/* Quick Add modal */}
      <Modal transparent visible={!!quickKind} onRequestClose={()=>setQuickKind(null)} animationType="fade">
        <View style={S.modalBack}><View style={S.modalCard}>
          <View style={S.rowHeader}>
            <Text style={S.modalTitle}>
              {quickKind === 'goals' ? 'Add Goal' :
               quickKind === 'assists' ? 'Add Assist' :
               quickKind === 'yc' ? 'Add Yellow Card' :
               quickKind === 'rc' ? 'Add Red Card' :
               quickKind === 'bonus' ? 'Add Bonus (+1)' :
               quickKind === 'defcon' ? 'Add DefCon (+2)' : ''}
            </Text>
            <TouchableOpacity onPress={()=>setQuickKind(null)}><MaterialCommunityIcons name="close" size={18} color={C.muted} /></TouchableOpacity>
          </View>

          {quickKind === 'goals' && (
            <>
              <Text style={S.modalLabel}>Scorer</Text>
              <PlayerPicker
                data={sortForPicker(players)}
                selectedId={selScorer}
                onSelect={setSelScorer}
                S={S}
                nameForId={nameForId}
              />
              <Text style={[S.modalLabel,{marginTop:8}]}>Assister</Text>
              <PlayerPicker
                data={sortForPicker([{id:-1,name:'none',type:0,eo:0}, ...players])}
                selectedId={selAssister ?? -1}
                onSelect={setSelAssister}
                S={S}
                nameForId={nameForId}
              />
            </>
          )}

          {quickKind !== 'goals' && (
            <>
              <Text style={S.modalLabel}>Player</Text>
              <PlayerPicker
                data={sortForPicker(players)}
                selectedId={selPid}
                onSelect={setSelPid}
                S={S}
                nameForId={nameForId}
              />
            </>
          )}

          <View style={S.modalActions}>
            <PrimaryBtn
              label="Add"
              onPress={confirmQuickAdd}
              disabled={
                (quickKind==='goals' && !selScorer) ||
                (quickKind!=='goals' && !selPid)
              }
            />
          </View>
        </View></View>
      </Modal>
       </ScrollView>
    </SafeAreaView>
  );
}

/* ------------------------------ Small pieces ------------------------------- */

function effectiveEOMult(eoPercent, mPos, delta) {
  // eoPercent is in [0..300], where 100 = 100% EO, 170 = 170% (C), 300 caps TC
  const raw = Math.max(0, Number(eoPercent) || 0) / 100; // 0..3

  // For non-positive returns, just use linear multiplier (captaincy still doubles negatives in FPL scoring)
  if (!(delta > 0 && mPos > 0)) return Math.min(3, raw);

  // Split raw into "ownership up to 100%" and "extra" (C/TC spillover).
  const ownership = Math.min(raw, 1);     // 0..1
  const extra     = Math.max(0, raw - 1); // 0..2 (C/TC)

  // Diminish ONLY after the first positive return:
  // mPos counts positive returns credited so far for this player in this edit-set.
  // For the first return, pow = 1 → baseEff ≈ ownership (no attenuation).
  // From the second return onward, pow > 1 → diminishing kicks in smoothly.
  const pow = 1 + DIMINISH_K * Math.max(0, mPos - 1);

  const baseEff = ownership === 0 ? 0 : 1 - Math.pow(1 - ownership, pow);

  // Keep captaincy/triple-captain proportional to the same attenuation ratio.
  const scale = ownership > 0 ? (baseEff / ownership) : 1;
  const eff   = baseEff + extra * scale;

  // Cap at TC ceiling (3×)
  return Math.min(3, Math.max(0, eff));
}



function PlayerPicker({ data, selectedId, onSelect, S, nameForId }) {
  return (
    <View style={{maxHeight:220}}>
      <FlatList
        data={data}
        keyExtractor={(item)=>String(item.id)}
        renderItem={({item})=>(
          <TouchableOpacity
            onPress={()=>onSelect(item.id)}
            style={[S.pickRow, selectedId===item.id && S.pickRowActive]}
          >
            <Text style={S.pickTxt} numberOfLines={1}>
              {(nameForId ? nameForId(item.id) : (item.name || String(item.id)))}
              {item.type?` • ${TYPE_LABEL[item.type]||''}`:''}
              {item?.eo ? ` • EO ${Math.round(item.eo)}%` : ''}
            </Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

function MenuButton({ icon, label, onPress, C }) {
  return (
    <TouchableOpacity onPress={onPress} style={{alignItems:'center'}}>
      <View style={{
        padding:10,borderRadius:10,backgroundColor:C.cardAccent,marginBottom:6
      }}>
        <MaterialCommunityIcons name={icon} size={20} color={C.ink} />
      </View>
      <Text style={{fontSize:12,color:C.ink}}>{label}</Text>
    </TouchableOpacity>
  );
}

function PrimaryBtn({ label, onPress, disabled }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[stylesBtn.base, disabled && stylesBtn.disabled]}
    >
      <Text style={stylesBtn.txt}>{label}</Text>
    </TouchableOpacity>
  );
}
const stylesBtn = StyleSheet.create({
  base:{backgroundColor:'#2563eb',paddingHorizontal:14,paddingVertical:8,borderRadius:8},
  disabled:{opacity:0.5},
  txt:{color:'white',fontWeight:'600'}
});

function Row({ title, icon, children, C, S, onAdd }) {
  return (
    <View style={{marginBottom:10}}>
      <View style={S.rowHeader}>
        <View style={{flexDirection:'row',alignItems:'center',gap:6}}>
          <MaterialCommunityIcons name={icon} size={16} color={C.muted} />
          <Text style={S.rowTitle}>{title}</Text>
        </View>
        <TouchableOpacity onPress={onAdd} style={S.addBtn}>
          <MaterialCommunityIcons name="plus" size={14} color={C.ink} />
          <Text style={S.addTxt}>Add</Text>
        </TouchableOpacity>
      </View>
      {children}
    </View>
  );
}

/**
 * ChipsNew:
 *  - "kept": list of current totals (>0); each chip shows an explicit (−) control
 *  - "removed": any entry with delta < 0 is shown struck; tap to restore (+1)
 */
function ChipsNew({ kept, removed, onMinus, onRestore, kind, S }) {
  return (
    <>
      {!!kept.length && (
        <View style={S.chips}>
          {kept.map(({pid,label})=>(
            <View key={`k-${kind}-${pid}`} style={S.chipRow}>
              <TouchableOpacity style={S.chip} onPress={()=>onMinus(kind,pid)}>
                <Text style={S.chipTxt} numberOfLines={1}>{label}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={()=>onMinus(kind,pid)} style={S.minusBtn} hitSlop={{top:8,bottom:8,left:8,right:8}}>
                <Text style={S.minusTxt}>−</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
      {!!removed.length && (
        <>
          <Text style={S.removedHint}>Removed (tap to restore)</Text>
          <View style={S.chipsMuted}>
            {removed.map(({pid,label})=>(
              <TouchableOpacity key={`r-${kind}-${pid}`} onPress={()=>onRestore(kind,pid)} style={[S.chip, S.chipMuted]}>
                <Text style={[S.chipTxt, S.chipTxtMuted, S.chipTxtStruck]} numberOfLines={1}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}
    </>
  );
}
/* ------------------------------- Helpers ---------------------------------- */

function mergeAssists(ga, a) {
  const m = new Map(a);
  for (const [k,v] of ga.entries()) m.set(k, (m.get(k)||0)+v);
  return m;
}

/**
 * makeChips:
 *  - Show entries with t > 0
 *  - label formatter receives (name, total, delta)
 */
function makeChips(baseMap, deltaMap, nameForId, fmt) {
  const out = [];
  const ids = new Set([...baseMap.keys(), ...deltaMap.keys()]);
  ids.forEach(pid=>{
    const base = Number(baseMap.get(pid)||0);
    const d = Number(deltaMap.get(pid)||0);
    const t = base + d;
    if (t > 0) {
      const name = nameForId(pid);
      out.push({ pid, label: fmt(name,t,d) });
    }
  });
  return out;
}

/**
 * makeRemoved:
 *  - Show ANY entry where delta < 0 (even if total > 0)
 *  - label formatter receives (name, total, delta)
 */
function makeRemoved(baseMap, deltaMap, nameForId, fmt) {
  const out = [];
  const ids = new Set([...baseMap.keys(), ...deltaMap.keys()]);
  ids.forEach(pid=>{
    const base = Number(baseMap.get(pid)||0);
    const d = Number(deltaMap.get(pid)||0);
    const t = base + d;
    if (d < 0 || (t <= 0 && (base>0 || d<0))) {
      const name = nameForId(pid);
      out.push({ pid, label: fmt(name, t, d) });
    }
  });
  return out;
}

function makeStyles(C) {
  const flatCards =
    String(C?.bg || '').toLowerCase() === String(C?.card || '').toLowerCase();
  return StyleSheet.create({
    safe:{flex:1, backgroundColor:C.bg},
    center:{alignItems:'center',justifyContent:'center',padding:24},
    muted:{color:C.muted},
    card:{backgroundColor:C.card, borderRadius:12, padding:12, margin:10,borderWidth: flatCards ? StyleSheet.hairlineWidth : 0,
      borderColor: flatCards ? (C.border || 'rgba(0,0,0,0.12)') : 'transparent',
      shadowColor: flatCards ? '#000' : 'transparent',
      shadowOpacity: flatCards ? 0.06 : 0,
      shadowRadius: flatCards ? 8 : 0,
      shadowOffset: flatCards ? { width: 0, height: 2 } : { width: 0, height: 0 },
      elevation: flatCards ? 2 : 0, // Android
    
    },

    pageTitle:{fontSize:18, fontWeight:'800', color:C.ink, marginBottom:6},
    pageBlurb:{color:C.muted, fontSize:12, lineHeight:16},

    rankRow:{flexDirection:'row', alignItems:'center', justifyContent:'space-between'},
    rankLine:{flexDirection:'row', alignItems:'center', gap:6},
    rankBig:{fontSize:18, fontWeight:'700', color:C.ink},
    strike:{textDecorationLine:'line-through', color:C.muted},
    rankNew:{fontSize:16, fontWeight:'700', color:C.ink},
    deltaTxt:{marginTop:6, color:C.muted, fontSize:12},

    resetBtn:{position:'absolute', right:12, top:12, flexDirection:'row', alignItems:'center', gap:6, backgroundColor:C.cardAccent, paddingHorizontal:10, paddingVertical:6, borderRadius:8},
    resetTxt:{color:C.ink, fontWeight:'600', fontSize:12},

    cardTitle:{fontSize:14, fontWeight:'700', color:C.muted, marginBottom:8},
    menuRow:{flexDirection:'row', justifyContent:'space-around', alignItems:'center'},

    summaryList:{gap:4},
    summaryItem:{color:C.ink, fontSize:13},

    editorBar:{marginTop:8, paddingTop:8, borderTopWidth:StyleSheet.hairlineWidth, borderTopColor:C.border, flexDirection:'row', alignItems:'center', gap:8},
    editorMatch:{flex:1, color:C.ink, fontWeight:'600'},
    tinyBtn:{flexDirection:'row', alignItems:'center', gap:6, paddingHorizontal:8, paddingVertical:6, borderRadius:8, backgroundColor:C.cardAccent},
    tinyBtnActive:{backgroundColor:'#e5ffe5'},
    tinyBtnTxt:{color:C.muted, fontSize:12},

    rowHeader:{flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginBottom:6},
    rowTitle:{fontWeight:'700', color:C.ink},
    addBtn:{flexDirection:'row', alignItems:'center', gap:6, backgroundColor:C.cardAccent, paddingHorizontal:8, paddingVertical:6, borderRadius:8},
    addTxt:{color:C.ink, fontSize:12, fontWeight:'600'},

    chips:{flexDirection:'row', flexWrap:'wrap', gap:6},
    chipsMuted:{flexDirection:'row', flexWrap:'wrap', gap:6, opacity:0.9, marginTop:6},
    removedHint:{marginTop:6, color:C.muted, fontSize:11},

    chipRow:{flexDirection:'row', alignItems:'center', borderRadius:16, overflow:'hidden', backgroundColor:'transparent'},
    chip:{backgroundColor:C.cardAccent, paddingHorizontal:8, paddingVertical:6, borderTopLeftRadius:16, borderBottomLeftRadius:16, maxWidth:'100%'},
    chipTxt:{color:C.ink, fontSize:12},
    chipMuted:{backgroundColor:C.bg},
    chipTxtMuted:{color:C.muted},
    chipTxtStruck:{textDecorationLine:'line-through', opacity:0.9},

    // Elegant minimal minus: no heavy borders, subtle ink color, good hit area
    minusBtn:{paddingHorizontal:10, paddingVertical:6, borderTopRightRadius:16, borderBottomRightRadius:16, backgroundColor:'transparent'},
    minusTxt:{color:C.muted, fontSize:14, fontWeight:'900', includeFontPadding:false},

    modalBack:{flex:1, backgroundColor:'rgba(0,0,0,0.35)', justifyContent:'center', padding:14},
    modalCard:{backgroundColor:C.card, borderRadius:12, padding:12},
    modalTitle:{fontSize:16, fontWeight:'700', color:C.ink},
    modalLabel:{fontSize:12, fontWeight:'700', color:C.muted, marginBottom:6, marginTop:2},
    pickRow:{paddingVertical:10, paddingHorizontal:8, borderRadius:8, marginBottom:6, backgroundColor:C.cardAccent},
    pickRowActive:{borderWidth:2, borderColor:'#2563eb'},
    pickTxt:{color:C.ink},
    modalActions:{flexDirection:'row', justifyContent:'flex-end', marginTop:10, gap:8},
  });
}
