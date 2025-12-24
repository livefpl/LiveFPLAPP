// EventFeed.js
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useColors } from './theme';

/**
 * Reusable distilled events feed.
 *
 * Minimal contract:
 *   <EventFeed gw={curGW} effectiveId={someFplIdOrNull} onePt={payload?.one_pt} />
 *
 * Optional:
 * - height: number for the list container
 * - impactThreshold: default 0.01 (points)
 */
export default function EventFeed({
  gw,
  effectiveId,
  onePt,
  height = 520,
  impactThreshold = 0.01,
}) {
  const C = useColors();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [impactOnly, setImpactOnly] = useState(true);

  const [groups, setGroups] = useState([]); // rendered groups
  const [lastUpdated, setLastUpdated] = useState(0);

  // game filter (dropdown)
  const [gameFilter, setGameFilter] = useState('all'); // 'all' or String(game_id)
  const [gamePickerOpen, setGamePickerOpen] = useState(false);

  // expand state for player rows (key = `${groupKey}:${pid}`)
  const [expanded, setExpanded] = useState(() => new Set());
  // pid -> teamId map (so we can show shirts even if events JSON has no team)
  const [pidToTeam, setPidToTeam] = useState(() => new Map());

  const refreshTickRef = useRef(0);

  const fetchJSON = useCallback(async (url) => {
    const r = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
    if (!r.ok) throw new Error(`HTTP ${r.status} loading ${url}`);
    return await r.json();
  }, []);

  const readExposure = useCallback(async () => {
    const k1 = effectiveId != null ? `myExposure:${String(effectiveId)}` : null;
    const raw =
      (k1 ? await AsyncStorage.getItem(k1) : null) ||
      (await AsyncStorage.getItem('myExposure'));
    if (!raw) return {};
    try {
      const obj = JSON.parse(raw);
      return (obj && typeof obj === 'object') ? obj : {};
    } catch {
      return {};
    }
  }, [effectiveId]);

  const readLocalGroup = useCallback(async () => {
    const k1 = effectiveId != null ? `localGroup:${String(effectiveId)}` : null;
    const raw =
      (k1 ? await AsyncStorage.getItem(k1) : null) ||
      (await AsyncStorage.getItem('localGroup'));
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [effectiveId]);

  const loadLocalEO = useCallback(async (gwNum, groupNum) => {
    if (!gwNum || !groupNum) return new Map();

    const EO_TTL_MS = 10 * 60 * 1000;
    const key = `EO:local:gw${gwNum}:g${groupNum}`;

    try {
      const raw = await AsyncStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.t && parsed?.data && (Date.now() - parsed.t) < EO_TTL_MS) {
          return parseEOJson(parsed.data);
        }
      }
    } catch {}

    // NOTE: this must match your working endpoint
    const url = `https://livefpl.us/${gwNum}/local_${groupNum}.json`;
    const json = await fetchJSON(url);

    try {
      await AsyncStorage.setItem(key, JSON.stringify({ t: Date.now(), data: json }));
    } catch {}

    return parseEOJson(json);
  }, [fetchJSON]);
  

  const doLoad = useCallback(async () => {
    const rt = ++refreshTickRef.current;
    setLoading(true);
    setErr('');


    try {
      const gwNum = Number(gw);
      if (!Number.isFinite(gwNum) || gwNum <= 0) throw new Error('Missing GW');

      const [myExposure, localGroup] = await Promise.all([
        readExposure(),
        readLocalGroup(),
      ]);

      const eoMap = await loadLocalEO(gwNum, localGroup);

      const url = `https://livefpl.us/${gwNum}/events_distilled.json`;
      const data = await fetchJSON(url);

      const all = flattenDistilled(data, myExposure, eoMap);
             // pid -> teamId from canonical teams.json (keys are pid)
      const TEAMS_JSON = 'https://livefpl.us/teams.json';
             let teamMap = new Map();
      try {
        const teamsObj = await fetchJSON(TEAMS_JSON);
        if (teamsObj && typeof teamsObj === 'object' && !Array.isArray(teamsObj)) {
          for (const [k, v] of Object.entries(teamsObj)) {
            const pid = Number(k);
            const tid = Number(v);
            if (Number.isFinite(pid) && pid > 0 && Number.isFinite(tid) && tid > 0) {
              teamMap.set(pid, tid);
            }
          }
        }
      } catch {
        teamMap = new Map();
      }
      setPidToTeam(teamMap);


      if (rt !== refreshTickRef.current) return;

      setGroups(all);
      setLastUpdated(Date.now());
    } catch (e) {
      if (rt !== refreshTickRef.current) return;
      setErr(String(e?.message || e || 'Could not load events'));
      setGroups([]);
    } finally {
      if (rt === refreshTickRef.current) setLoading(false);
    }
  }, [gw, readExposure, readLocalGroup, loadLocalEO, fetchJSON]);

  useEffect(() => {
    doLoad();
  }, [doLoad]);

  // build game options from loaded groups
  const gameOptions = useMemo(() => {
    const m = new Map(); // game_id -> label
    const bestTs = {};   // game_id -> latest ts

    for (const g of (groups || [])) {
      const gid = g?.game_id;
      if (gid == null) continue;

      const label =
        g?.game_label ||
        g?.game_teams ||
        g?.teams_str ||
        g?.teams ||
        g?.game_name ||
        `Game ${gid}`;

      const k = String(gid);
      if (!m.has(k)) m.set(k, String(label));
      bestTs[k] = Math.max(bestTs[k] || 0, Number(g.ts) || 0);
    }

    const arr = Array.from(m.entries()).map(([id, label]) => ({
      id,
      label,
      ts: bestTs[id] || 0,
    }));

    // newest games first
    arr.sort((a, b) => (b.ts - a.ts) || String(a.label).localeCompare(String(b.label)));
    return arr;
  }, [groups]);

  const currentGameLabel = useMemo(() => {
    if (gameFilter === 'all') return 'All games';
    const hit = (gameOptions || []).find(x => String(x.id) === String(gameFilter));
    return hit?.label || 'Selected game';
  }, [gameFilter, gameOptions]);

  const filtered = useMemo(() => {
    const abs = Math.abs;
    const thr = Number(impactThreshold) || 0;

    const out = (groups || []).filter(g => {
      if (!g?.playersRendered?.length) return false;

      // game filter
      if (gameFilter !== 'all') {
        if (String(g?.game_id ?? '') !== String(gameFilter)) return false;
      }

      // impact filter
      if (impactOnly && abs(g.net || 0) < thr) return false;
      return true;
    });

    return out;
  }, [groups, impactOnly, impactThreshold, gameFilter]);

  // --- NEW: build a "sections-like" flat array with day headers ---
  const sections = useMemo(() => {
    const out = [];
    let lastDayKey = null;

    for (const g of filtered) {
      const ts = Number(g.ts || 0);
      const d = new Date(ts > 2e12 ? ts : ts * 1000);
      const dayKey = d.toDateString(); // stable per-day key

      if (dayKey !== lastDayKey) {
        out.push({ type: 'day', dayKey, ts });
        lastDayKey = dayKey;
      }

      out.push({ type: 'event', item: g });
    }

    return out;
  }, [filtered]);

  const stickyHeaderIndices = useMemo(() => {
    const idxs = [];
    for (let i = 0; i < (sections || []).length; i++) {
      if (sections[i]?.type === 'day') idxs.push(i);
    }
    return idxs;
  }, [sections]);

  const toggleExpanded = useCallback((key) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const header = useMemo(() => {
    return (
      <View style={[styles.headerWrap, { borderColor: C.border, backgroundColor: C.card }]}>
        <View style={styles.headerRow}>
          <Text style={[styles.headerTitle, { color: C.ink }]}>Events</Text>

          <TouchableOpacity
            onPress={() => setImpactOnly(v => !v)}
            style={[
              styles.pill,
              { borderColor: C.border, backgroundColor: impactOnly ? C.accent : 'transparent' },
            ]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={{ color: impactOnly ? 'white' : C.muted, fontSize: 11, fontWeight: '800' }}>
              Non zero impact only
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={doLoad}
            style={[styles.iconBtn, { borderColor: C.border, backgroundColor: C.card2 }]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialCommunityIcons name="refresh" size={16} color={C.ink} />
          </TouchableOpacity>
        </View>

        {/* game dropdown */}
        <View style={{ marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ color: C.muted, fontSize: 11, fontWeight: '800' }}>Game</Text>

          <TouchableOpacity
            onPress={() => setGamePickerOpen(true)}
            style={[
              styles.dropdownBtn,
              { borderColor: C.border, backgroundColor: C.sunken || C.card2 },
            ]}
          >
            <Text numberOfLines={1} style={{ color: C.ink, fontSize: 11, fontWeight: '900', flex: 1 }}>
              {currentGameLabel}
            </Text>
            <MaterialCommunityIcons name="chevron-down" size={18} color={C.muted} />
          </TouchableOpacity>
        </View>

        <View style={[styles.thead, { borderColor: C.border, backgroundColor: C.sunken || C.card2 }]}>
          <Text style={[styles.thCell, { color: C.muted, flex: 1.2 }]}>Event</Text>
          <Text style={[styles.thCell, { color: C.muted, width: 110, textAlign: 'right' }]}>Points gained</Text>
          <Text style={[styles.thCell, { color: C.muted, width: 110, textAlign: 'right' }]}>Rank Change</Text>
        </View>

        {!!err && (
          <Text style={{ color: C.bad || '#ef4444', fontSize: 12, paddingTop: 6 }}>
            {err}
          </Text>
        )}

        {/* dropdown modal */}
        <Modal visible={gamePickerOpen} transparent animationType="fade" onRequestClose={() => setGamePickerOpen(false)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setGamePickerOpen(false)}>
            <Pressable
              style={[styles.modalCard, { backgroundColor: C.card, borderColor: C.border }]}
              onPress={() => {}}
            >
              <Text style={{ color: C.ink, fontWeight: '900', marginBottom: 10 }}>Filter by game</Text>

              <TouchableOpacity
                onPress={() => {
                  setGameFilter('all');
                  setGamePickerOpen(false);
                }}
                style={[styles.modalRow, { borderColor: C.border }]}
              >
                <Text style={{ color: C.ink, fontWeight: '900' }}>All games</Text>
              </TouchableOpacity>

              <FlatList
                data={gameOptions}
                keyExtractor={(x) => x.id}
                style={{ maxHeight: 360 }}
                renderItem={({ item }) => {
                  const on = String(gameFilter) === String(item.id);
                  return (
                    <TouchableOpacity
                      onPress={() => {
                        setGameFilter(item.id);
                        setGamePickerOpen(false);
                      }}
                      style={[
                        styles.modalRow,
                        { borderColor: C.border, backgroundColor: on ? (C.sunken || C.card2) : 'transparent' },
                      ]}
                    >
                      <Text style={{ color: C.ink, fontWeight: on ? '900' : '800' }} numberOfLines={1}>
                        {item.label}
                      </Text>
                    </TouchableOpacity>
                  );
                }}
              />
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    );
  }, [C, impactOnly, doLoad, err, gamePickerOpen, gameOptions, gameFilter, currentGameLabel]);

  const renderGroupCard = useCallback(({ item, index }) => {
    const net = Number(item?.net || 0);
    const rankDelta = onePt ? ptsToRankDelta(net, Number(onePt) || 0) : 0;

    // Points gained: green if positive, red if negative
    const posPts = net > 0;
    const negPts = net < 0;

    // Rank change: show ABS + arrow, no negative sign
    // Our ptsToRankDelta returns + = drop (worse), - = rise (better)
    const improves = rankDelta < 0;
    const worsens = rankDelta > 0;

    const title = prettyGroupTitle(item);
    const metaLine = buildMetaLine(item);

    const groupKey = `${Number(item?.ts || 0)}:${Number(item?.gen || 0)}:${index}`;

    const isBonusGroup =
      String(item?.kind || item?.title || '')
        .toLowerCase()
        .includes('bonus');

    return (
      <View style={[styles.card, { borderColor: C.border, backgroundColor: C.card }]}>
        <View style={styles.cardTop}>
          <View style={{ width: 22, alignItems: 'center', paddingTop: 1 }}>
            {renderGroupIcon(item, C)}

          </View>

          <View style={{ flex: 1 }}>
            <Text style={[styles.cardTitle, { color: C.ink }]} numberOfLines={3}>
              {title}
            </Text>

            {!!metaLine && (
              <Text style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>
                {metaLine}
              </Text>
            )}
          </View>

          <View style={styles.rightCols}>
            <View style={styles.rightColWide}>
              <View style={styles.impactRow}>
                {posPts ? <MaterialCommunityIcons name="arrow-up" size={14} color={C.good || '#10b981'} /> : null}
                {negPts ? <MaterialCommunityIcons name="arrow-down" size={14} color={C.bad || '#ef4444'} /> : null}
                <Text
                  style={[
                    styles.impactTxt,
                    { color: posPts ? (C.good || '#10b981') : negPts ? (C.bad || '#ef4444') : C.muted },
                  ]}
                >
                  {fmtSigned(net, 2)}
                </Text>
              </View>
            </View>

            <View style={styles.rightColWide}>
              <View style={styles.impactRow}>
                {onePt && improves ? (
                  <MaterialCommunityIcons name="arrow-up" size={14} color={C.good || '#10b981'} />
                ) : null}
                {onePt && worsens ? (
                  <MaterialCommunityIcons name="arrow-down" size={14} color={C.bad || '#ef4444'} />
                ) : null}
                <Text
                  style={[
                    styles.rankTxt,
                    {
                      color: !onePt
                        ? C.muted
                        : improves
                          ? (C.good || '#10b981')
                          : worsens
                            ? (C.bad || '#ef4444')
                            : C.muted,
                    },
                  ]}
                >
                  {onePt ? fmtRankAbs(rankDelta) : '—'}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* players */}
        <View style={{ marginTop: 10 }}>
          {(item.playersRendered || []).slice(0, 18).map((p) => {
            const isYou = Number(p.you || 0) > 0;

            const rowKey = `${groupKey}:${p.pid}`;
            const isOpen = !isBonusGroup && expanded.has(rowKey);

            const dPts = Number(p.delta_pts || 0);

            return (
              <View key={`${p.pid}`}>
                <TouchableOpacity
                  onPress={() => {
                    if (!isBonusGroup) toggleExpanded(rowKey);
                  }}
                  activeOpacity={0.85}
                  style={[
                    styles.playerRow,
                    isYou
                      ? { backgroundColor: C.sunken || C.card2, borderColor: C.border, borderWidth: StyleSheet.hairlineWidth }
                      : null,
                  ]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                    <TeamCrest team={p.team ?? pidToTeam.get(Number(p.pid))} size={18} />


                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                      <Text
                        style={[
                          styles.playerName,
                          { color: C.ink, fontWeight: isYou ? '900' : '700' },
                        ]}
                        numberOfLines={1}
                      >
                        {p.name || `#${p.pid}`}
                      </Text>

                      {/* Δpts next to name */}
                      <Text
                        style={[
                          styles.deltaNextToName,
                          { color: dPts > 0 ? (C.good || '#10b981') : dPts < 0 ? (C.bad || '#ef4444') : C.muted },
                        ]}
                        numberOfLines={1}
                      >
                        {fmtSigned(dPts, 0)}
                      </Text>

                      {isYou ? (
                        <View style={[styles.youTag, { borderColor: C.border, backgroundColor: C.card }]}>
                          <Text style={{ fontSize: 9, fontWeight: '900', color: C.ink }}>YOU</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>

                  {/* Restore You× + EO% + Impact like before */}
                  <Text style={[styles.smallCol, { color: C.muted }]} numberOfLines={1}>
                    You {Number(p.you || 0)}×
                  </Text>

                  <Text style={[styles.smallCol, { color: C.muted }]} numberOfLines={1}>
                    EO {(Number(p.eo || 0) * 100).toFixed(1)}%
                  </Text>

                  {/* Impact */}
                  <View style={{ width: 78, alignItems: 'flex-end' }}>
                    <Text
                      style={[
                        styles.impactSmall,
                        {
                          color:
                            Number(p.imp || 0) > 0 ? (C.good || '#10b981')
                            : Number(p.imp || 0) < 0 ? (C.bad || '#ef4444')
                            : C.muted,
                        },
                      ]}
                      numberOfLines={1}
                    >
                      {fmtSigned(Number(p.imp || 0), 2)}
                    </Text>
                  </View>

                  {/* No expand chevron for bonus groups */}
                  {!isBonusGroup && (
                    <MaterialCommunityIcons
                      name={isOpen ? 'chevron-up' : 'chevron-down'}
                      size={18}
                      color={C.muted}
                    />
                  )}
                </TouchableOpacity>

                {/* expanded reasons (disabled for bonus groups) */}
                {isOpen ? (
                  <View style={[styles.reasonsBox, { borderColor: C.border, backgroundColor: C.card2 || C.sunken || C.card }]}>
                    {(p.reasons || []).length ? (
                      (p.reasons || []).map((r, idx2) => {
                        const dd = Number(r.delta_pts || 0);
                        const label = String(r.label || r.stat || 'Update');
                        const count = r.count != null ? Number(r.count) : null;

                        return (
                          <View key={`${idx2}`} style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 3 }}>
                            <Text style={{ color: C.ink, flex: 1, fontSize: 11, fontWeight: '700' }}>
                              {label}{count != null ? ` ×${count}` : ''}
                            </Text>
                            <Text
                              style={{
                                width: 46,
                                textAlign: 'right',
                                fontSize: 11,
                                fontWeight: '900',
                                color: dd > 0 ? (C.good || '#10b981') : dd < 0 ? (C.bad || '#ef4444') : C.muted,
                                fontVariant: ['tabular-nums'],
                              }}
                            >
                              {fmtSigned(dd, 0)}
                            </Text>
                          </View>
                        );
                      })
                    ) : (
                      <Text style={{ color: C.muted, fontSize: 11 }}>No details.</Text>
                    )}
                  </View>
                ) : null}
              </View>
            );
          })}

          {(item.playersRendered || []).length > 18 && (
            <Text style={{ color: C.muted, fontSize: 11, marginTop: 6 }}>
              +{(item.playersRendered.length - 18)} more…
            </Text>
          )}
        </View>
      </View>
    );
  }, [C, onePt, expanded, toggleExpanded, pidToTeam]);

  return (
    <View style={{ height }}>
      {header}

      {loading ? (
        <View style={{ paddingTop: 18 }}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={sections}
          stickyHeaderIndices={stickyHeaderIndices}
          keyExtractor={(x, i) =>
            x?.type === 'day'
              ? `day:${x.dayKey}`
              : `${x?.item?.ts || 0}:${x?.item?.gen || 0}:${i}`
          }
          renderItem={({ item, index }) => {
            if (item?.type === 'day') {
              const d = new Date((Number(item.ts) || 0) > 2e12 ? item.ts : (Number(item.ts) || 0) * 1000);
              return (
                <View style={[styles.dayHeader, { backgroundColor: C.card, borderColor: C.border }]}>
                  <Text style={{ color: C.muted, fontWeight: '900', fontSize: 12 }}>
                    {d.toLocaleDateString(undefined, {
                      weekday: 'long',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </Text>
                </View>
              );
            }
            return renderGroupCard({ item: item.item, index });
          }}
          contentContainerStyle={{ paddingBottom: 16 }}
          showsVerticalScrollIndicator={false}
        />
      )}

      {!!lastUpdated && !loading && (
        <Text style={{ color: C.muted, fontSize: 10, paddingTop: 6 }}>
          Updated {new Date(lastUpdated).toLocaleTimeString()}
        </Text>
      )}
    </View>
  );
}

/* ---------------- UI helpers ---------------- */

function TeamCrest({ team, size = 18 }) {
  const t = Number(team);
  if (!Number.isFinite(t) || t <= 0) {
    return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#9ca3af' }} />;
  }
  // Uses your website crest path convention.
  const uri = `https://livefpl.us/figures/new_logos2/${t}.png`;
  return (
    <Image
      source={{ uri }}
      style={{ width: size, height: size, borderRadius: size / 2 }}
    />
  );
}

function renderGroupIcon(g, C, size = 18) {
  // 1) Try group-level hint
  const raw = String(g?.kind || g?.title || g?.type || '').toLowerCase();

  // 2) If group-level is generic, look inside playersRendered labels/reasons
  const players = Array.isArray(g?.playersRendered) ? g.playersRendered : [];
  const playersText = players
    .map(p => {
      const labels = String(p?.labels || '');
      const rs = Array.isArray(p?.reasons)
        ? p.reasons.map(r => String(r?.label || r?.stat || '')).join(' ')
        : '';
      return `${labels} ${rs}`;
    })
    .join(' ')
    .toLowerCase();

  const text = `${raw} ${playersText}`;

  // Yellow / Red cards (Rank-page style)
  if (text.includes('yellow')) return <View style={styles.cardYellow} />;
  if (text.includes('red')) return <View style={styles.cardRed} />;

  // Everything else uses an MCI name
  return (
    <MaterialCommunityIcons
      name={iconForGroup({ ...g, kind: text })}
      size={size}
      color={C.muted}
    />
  );
}


function iconForGroup(g) {
  const kind = String(g?.kind || g?.title || '').toLowerCase();

  if (kind.includes('goal')) return 'soccer';
  if (kind.includes('assist')) return 'shoe-cleat';
  if (kind.includes('minutes') || kind.includes('60')) return 'clock-outline';
  if (kind.includes('clean') || kind.includes('cs')) return 'shield-check';
  if (kind.includes('bonus')) return 'star-outline';
  if (kind.includes('defcon') || kind.includes('defensive')) return 'wall';
  if (kind.includes('sub')) return 'swap-horizontal';
  if (kind.includes('var') || kind.includes('cancel')) return 'undo-variant';

  return 'clock-outline';
}

function buildMetaLine(g) {
  const teams =
    g?.game_teams ||
    g?.teams_str ||
    g?.game_label ||
    g?.game_name ||
    '';

  const score =
    g?.game_score ||
    g?.score ||
    g?.gameScore ||
    g?.game?.score ||
    '';

  // minute can come in a bunch of forms depending on your backend
  const minuteRaw =
    g?.minute ??
    g?.game_minutes ??
    g?.min ??
    g?.gameMin ??
    g?.game?.minute ??
    g?.game?.min ??
    null;

  const minute =
    minuteRaw == null ? '' :
    Number.isFinite(Number(minuteRaw)) ? `${Math.round(Number(minuteRaw))}'` :
    String(minuteRaw).trim();

  // IMPORTANT CHANGE: now returns time-only (date is shown as sticky day header)
  const when = formatTsCompact(g?.ts, g?.ts_str);

  const leftParts = [teams, score, minute].filter(Boolean);
  const left = leftParts.join(' • ');

  if (left && when) return `${left} • ${when}`;
  if (left) return String(left);
  if (when) return String(when);
  return '';
}

function formatTsCompact(tsMaybe, tsStrFallback) {
  const ts = Number(tsMaybe);
  if (Number.isFinite(ts) && ts > 0) {
    const ms = ts > 2e12 ? ts : ts * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) {
      // Time only (date comes from sticky day header)
      const time = d.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' });
      return `${time}`;
    }
  }

  const s = String(tsStrFallback || '').trim();
  if (!s) return '';
  return s;
}

function prettyGroupTitle(g) {
  const base = String(g?.title || g?.kind || 'Update');

  // If backend already gives a good title, keep it.
  const baseLower = base.toLowerCase();

  // We only rewrite when it looks generic
  const looksGeneric =
    baseLower === 'cards' ||
    baseLower === 'card' ||
    baseLower === 'defcon' ||
    baseLower === 'defensive contribution' ||
    baseLower === 'defensive contributions' ||
    baseLower === 'defensive' ||
    baseLower === 'cards/defcon';

  if (!looksGeneric) return base;

  const top = (g?.playersRendered || [])[0];
  if (!top) return base;

  const name = top.name || `#${top.pid}`;

  // Look for DEFCON / cards in BOTH labels and reasons
  const labelsText = String(top.labels || '').toLowerCase();
  const reasonsText = Array.isArray(top.reasons)
    ? top.reasons.map(r => String(r?.label || r?.stat || '')).join(' ').toLowerCase()
    : '';

  const text = `${labelsText} ${reasonsText}`.trim();

  // Cards
  if (text.includes('yellow')) return `${name} Yellow Card`;
  if (text.includes('red')) return `${name} Red Card`;

  // DEFCON (defensive contribution)
  if (text.includes('defcon') || text.includes('defensive contribution') || text.includes('defensive')) {
    // Added/Removed: use the player's total delta pts sign
    const dpts = Number(top.delta_pts || 0);
    const verb = dpts >= 0 ? 'Added' : 'Removed';
    return `${name} DEFCON ${verb}`;
  }

  return `${name} ${base}`;
}

/* ---------------- Core logic ported from your website feed ---------------- */

function abs(n) { return Math.abs(Number(n) || 0); }

function safeMul(exposureObj, pid) {
  if (!exposureObj || typeof exposureObj !== 'object') return 0;
  const v = exposureObj[String(pid)] ?? exposureObj[pid];
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// eoMap holds EO as percent (e.g. 33.2). Convert to fraction 0..1
function safeEOFrac(eoMap, pid) {
  if (!(eoMap instanceof Map)) return 0;
  if (!eoMap.has(pid)) return 0;
  const n = Number(eoMap.get(pid));
  return Number.isFinite(n) ? (n / 100) : 0;
}

// Build per-player aggregated totals + keep reason breakdown for expansion
function aggregatePlayers(players) {
  const m = new Map();
  for (const p of (players || [])) {
    const pid = p?.pid ?? p?.id ?? p?.element;
    if (pid == null) continue;

    const dpts = Number(p.delta_pts ?? p.deltaPts ?? p.delta ?? 0); // tolerate older keys
    const d = Number(p.delta ?? 0);

    if (!m.has(pid)) {
      m.set(pid, {
        pid,
        name: p.name || '',
        labelSet: new Set(),
        delta_pts: 0,
        delta: 0,
        team: p.team ?? p.team_id ?? p.tid ?? p.teamId ?? null,
        reasons: [],
      });
    }
    const row = m.get(pid);
    row.delta_pts += dpts;
    row.delta += d;

    const label = p.label != null ? String(p.label) : '';
    if (label) row.labelSet.add(label);

    if (!row.name && p.name) row.name = p.name;

    const t = p.team ?? p.team_id ?? p.tid ?? p.teamId ?? null;
    if (t != null) row.team = t;

    // reason line
    row.reasons.push({
      label: p.label || p.stat || 'Update',
      stat: p.stat || '',
      delta_pts: Number(p.delta_pts ?? p.deltaPts ?? p.delta ?? 0),
      count: p.count ?? null,
    });
  }

  const out = [];
  for (const row of m.values()) {
    out.push({
      pid: row.pid,
      name: row.name || '',
      labels: row.labelSet.size ? Array.from(row.labelSet).join(', ') : '',
      delta_pts: row.delta_pts,
      delta: row.delta,
      team: row.team,
      reasons: row.reasons || [],
    });
  }
  return out;
}

function buildRenderedPlayers(players, exposureObj, eoMap) {
  const agg = aggregatePlayers(players);
  const rendered = [];

  for (const p of agg) {
    const d = Number(p.delta_pts || 0);
    if (!d) continue; // keep deltapts!=0 filter

    const you = safeMul(exposureObj, p.pid); // 0/1/2/3
    const eo = safeEOFrac(eoMap, p.pid);     // 0..1
    const imp = d * (you - eo);

    rendered.push({ ...p, you, eo, imp });
  }

  rendered.sort((a, b) => abs(b.imp) - abs(a.imp));
  return rendered;
}

// merge pure bonus groups per game, keep the latest ts as base
function mergePureBonusByGameRaw(rawGroups) {
  const isBonusOnlyGroup = (g) => {
    const players = g?.players || [];
    if (!players.length) return false;
    return players.every(p => {
      const stat = String(p?.stat || '').toLowerCase();
      const label = String(p?.label || '').toLowerCase();
      return stat === 'bonus' || label === 'bonus';
    });
  };

  const out = [];
  const slots = new Map(); // game_id -> slot

  for (const g of rawGroups) {
    const gameId = g?.game_id ?? g?.g?.game_id ?? null;

    if (gameId != null && isBonusOnlyGroup(g)) {
      if (!slots.has(gameId)) slots.set(gameId, { base: null, groups: [] });
      const slot = slots.get(gameId);
      slot.groups.push(g);
      if (!slot.base || (Number(g.ts) > Number(slot.base.ts))) slot.base = g;
    } else {
      out.push(g);
    }
  }

  for (const [gameId, slot] of slots.entries()) {
    const base = slot.base;
    if (!base) continue;

    const playersAgg = new Map();
    for (const g of slot.groups) {
      for (const p of (g?.players || [])) {
        const pid = p?.pid ?? p?.id ?? p?.element;
        if (pid == null) continue;
        const cur = playersAgg.get(pid) || { ...p, delta_pts: 0, delta: 0 };
        cur.delta_pts += Number(p.delta_pts ?? p.deltaPts ?? p.delta ?? 0);
        cur.delta += Number(p.delta || 0);
        playersAgg.set(pid, cur);
      }
    }

    out.push({
      ...base,
      game_id: gameId,
      kind: 'bonus_merged',
      title: 'Bonus recalculation',
      players: Array.from(playersAgg.values()),
    });
  }

  return out;
}

function flattenDistilled(data, exposureObj, eoMap) {
  const raw = [];
  for (const b of (data?.batches || [])) {
    for (const g of (b?.groups || [])) {
      raw.push({
        ...g,
        ts: Number(b.ts) || Number(g.ts) || 0,
        gen: Number(b.gen) || Number(g.gen) || 0,
        ts_str: g.ts_str || b.ts_str || '',
      });
    }
  }

  const mergedRaw = mergePureBonusByGameRaw(raw);

  const out = [];
  for (const g of mergedRaw) {
    const playersRendered = buildRenderedPlayers(g.players || [], exposureObj, eoMap);
    const net = playersRendered.reduce((s, p) => s + (Number(p.imp) || 0), 0);

    const game_teams =
      g?.game_teams ||
      g?.teams_str ||
      g?.teams ||
      g?.g?.teams ||
      g?.game?.teams ||
      g?.game_name ||
      '';

    // pass score if present
    const game_score =
      g?.game_score ||
      g?.score ||
      g?.gameScore ||
      g?.game?.score ||
      '';

    out.push({
      ...g,
      game_teams: typeof game_teams === 'string' ? game_teams : '',
      game_score: typeof game_score === 'string' ? game_score : game_score,
      title: g.title || g.kind || 'Update',
      playersRendered,
      net,
    });
  }

  out.sort((a, b) => (Number(b.ts) - Number(a.ts)) || (Number(b.gen) - Number(a.gen)));
  return out;
}

/**
 * Points -> rank delta using the “damped + mild asymmetry” curve.
 * Returns “rank places” where + means you *drop* (worse rank), − means you rise.
 */
function ptsToRankDelta(ptsImpact, onePtVal) {
  const p = Number(ptsImpact) || 0;
  const op = Number(onePtVal) || 0;
  if (!p || !op) return 0;

  const x = Math.abs(p);

  const k = 10;
  const a = 0.55;
  const damp = 1 / (1 + a * (x / k) * (x / k));

  const maxAsym = 0.18;
  const asymStrength = 1 - Math.exp(-x / 8);
  const asym = 1 + (p < 0 ? +maxAsym : -maxAsym) * asymStrength;

  const places = x * op * damp * asym;
  const out = Math.round(places);

  return (p < 0) ? +out : -out;
}

function fmtSigned(n, decimals = 2, noPlus = false) {
  const v = Number(n) || 0;
  const s = v > 0 ? (noPlus ? '' : '+') : v < 0 ? '−' : '';
  const a = Math.abs(v);
  return s + a.toFixed(decimals);
}

// rank: show ABS only, with commas, no minus, no plus
function fmtRankAbs(rankDelta) {
  const n = Math.abs(Number(rankDelta) || 0);
  // commas + no decimals
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function parseEOJson(json) {
  const map = new Map();
  if (!json) return map;

  if (!Array.isArray(json) && typeof json === 'object') {
    for (const [k, v] of Object.entries(json)) {
      if (v == null) continue;
      if (typeof v === 'number') {
        map.set(Number(k), normalizePercent(v));
      } else if (typeof v === 'object') {
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
}

function normalizePercent(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return (n >= 0 && n <= 1) ? (n * 100) : n;
}

/* ---------------- Styles ---------------- */

const styles = StyleSheet.create({
  headerWrap: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: '900',
    flex: 1,
  },
  pill: {
    paddingHorizontal: 10,
    height: 26,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
  },
  iconBtn: {
    width: 30,
    height: 26,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropdownBtn: {
    height: 30,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  thead: {
    flexDirection: 'row',
    marginTop: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  thCell: {
    fontSize: 11,
    fontWeight: '800',
  },

  // NEW: sticky day header row
  dayHeader: {
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },

  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  cardTop: {
    flexDirection: 'row',
    gap: 10,
  },
  deltaNextToName: {
    fontSize: 11,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },

  cardTitle: {
    fontSize: 13,
    fontWeight: '900',
  },
  rightCols: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  rightColWide: {
    width: 102,
    alignItems: 'flex-end',
  },
  impactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  impactTxt: {
    fontSize: 13,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  rankTxt: {
    fontSize: 12,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  smallCol: {
    width: 64,
    textAlign: 'right',
    fontSize: 11,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  impactSmall: {
    marginTop: 1,
    fontSize: 11,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },

  youTag: {
    paddingHorizontal: 6,
    height: 16,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
  },
  playerName: {
    fontSize: 12,
  },
  deltaPts: {
    width: 46,
    textAlign: 'right',
    fontSize: 12,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  cardYellow: {
  width: 10,
  height: 14,
  borderRadius: 2,
  backgroundColor: '#ffd400',
  borderWidth: 0.5,
  borderColor: '#333',
},
cardRed: {
  width: 10,
  height: 14,
  borderRadius: 2,
  backgroundColor: '#e11d48',
  borderWidth: 0.5,
  borderColor: '#333',
},

  reasonsBox: {
    marginTop: 6,
    marginBottom: 2,
    marginLeft: 26,
    padding: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 18,
  },
  modalCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 12,
  },
  modalRow: {
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    marginBottom: 8,
  },
});
