/**
 * Compare two plans side-by-side for one GW at a time.
 * Players shown with shirt (crest), name, vice badge, fixture. Similarities greyed out.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Image,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { clubCrestUri } from './clubs';

const STATE_KEY = (id, planId) => `planner_state_${String(id)}__${String(planId || 'main')}`;
const BENCH_START = 11;

function safeGet(obj, key, def) {
  try {
    const v = obj != null ? obj[key] : undefined;
    return v !== undefined && v !== null ? v : def;
  } catch (_) {
    return def;
  }
}

function safePicks(week) {
  const p = safeGet(week, 'picks', []);
  return Array.isArray(p) ? p : [];
}

function nameFor(pid, namesById) {
  if (pid == null) return '';
  const n = namesById != null ? namesById[pid] : null;
  return typeof n === 'string' ? n : String(pid);
}

/** Return week data for targetGw; if not saved, use most recent prior saved week (carry-forward). */
function getWeekForGw(weeks, targetGw) {
  if (!weeks || targetGw == null) return null;
  const w = weeks[targetGw];
  if (w != null) return w;
  const keys = Object.keys(weeks).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (keys.length === 0) return null;
  const prior = keys.filter((g) => g <= targetGw);
  const gwToUse = prior.length ? Math.max(...prior) : keys[0];
  return weeks[gwToUse] ?? null;
}

export default function ComparePlansModal({
  visible,
  onClose,
  plans = [],
  fplId,
  namesById = {},
  teamNums = {},
  getFixtureLabel,
  currentGw,
  C,
}) {
  const [planAId, setPlanAId] = useState(null);
  const [planBId, setPlanBId] = useState(null);
  const [dataA, setDataA] = useState(null);
  const [dataB, setDataB] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedGw, setSelectedGw] = useState(null);

  const planList = Array.isArray(plans) ? plans : [];
  const canLoad = visible && fplId && planAId && planBId && planAId !== planBId;

  useEffect(() => {
    if (visible && planList.length >= 2) {
      setPlanAId(planList[0].id);
      setPlanBId(planList[1].id);
    }
  }, [visible]);

  useEffect(() => {
    if (!canLoad) {
      setDataA(null);
      setDataB(null);
      setError(null);
      setSelectedGw(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [rawA, rawB] = await Promise.all([
          AsyncStorage.getItem(STATE_KEY(fplId, planAId)),
          AsyncStorage.getItem(STATE_KEY(fplId, planBId)),
        ]);
        if (cancelled) return;
        const savedA = rawA ? JSON.parse(rawA) : null;
        const savedB = rawB ? JSON.parse(rawB) : null;
        const weeksA = savedA && savedA.weeks && typeof savedA.weeks === 'object' ? savedA.weeks : {};
        const weeksB = savedB && savedB.weeks && typeof savedB.weeks === 'object' ? savedB.weeks : {};
        setDataA({ weeks: weeksA });
        setDataB({ weeks: weeksB });
        const allGw = new Set([...Object.keys(weeksA).map(Number), ...Object.keys(weeksB).map(Number)].filter(Number.isFinite));
        const sorted = Array.from(allGw).sort((a, b) => a - b);
        const minGwInit = Math.max(1, Number(currentGw) || 1);
        const firstValid = sorted.length ? Math.max(minGwInit, sorted[0]) : minGwInit;
        setSelectedGw((prev) => (prev != null && prev >= minGwInit && prev <= 38 ? prev : firstValid));
      } catch (e) {
        if (!cancelled) setError(String((e && e.message) || 'Failed to load plans'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [canLoad, fplId, planAId, planBId, currentGw]);

  const minGw = Math.max(1, Number(currentGw) || 1);
  const gwList = useMemo(() => {
    const set = new Set();
    if (dataA && dataA.weeks) Object.keys(dataA.weeks).forEach((k) => { const n = Number(k); if (Number.isFinite(n)) set.add(n); });
    if (dataB && dataB.weeks) Object.keys(dataB.weeks).forEach((k) => { const n = Number(k); if (Number.isFinite(n)) set.add(n); });
    const maxFromData = set.size ? Math.max(...set) : 0;
    const maxGw = Math.max(38, maxFromData);
    return Array.from({ length: maxGw }, (_, i) => i + 1);
  }, [dataA, dataB]);

  const gwIndex = useMemo(() => (selectedGw != null ? gwList.indexOf(selectedGw) : -1), [gwList, selectedGw]);
  const canPrev = gwIndex > 0 && selectedGw != null && selectedGw > minGw;
  const canNext = gwIndex >= 0 && gwIndex < gwList.length - 1;
  const goPrev = useCallback(() => { if (canPrev && gwList[gwIndex - 1] != null && gwList[gwIndex - 1] >= minGw) setSelectedGw(gwList[gwIndex - 1]); }, [canPrev, gwIndex, gwList, minGw]);
  const goNext = useCallback(() => { if (canNext && gwList[gwIndex + 1] != null) setSelectedGw(gwList[gwIndex + 1]); }, [canNext, gwIndex, gwList]);

  useEffect(() => {
    if (selectedGw != null && minGw != null && selectedGw < minGw) setSelectedGw(minGw);
  }, [minGw, selectedGw]);

  const weekA = useMemo(() => {
    if (selectedGw == null || !dataA || !dataA.weeks) return null;
    return getWeekForGw(dataA.weeks, selectedGw);
  }, [dataA, selectedGw]);
  const weekB = useMemo(() => {
    if (selectedGw == null || !dataB || !dataB.weeks) return null;
    return getWeekForGw(dataB.weeks, selectedGw);
  }, [dataB, selectedGw]);

  const picksA = useMemo(() => safePicks(weekA), [weekA]);
  const picksB = useMemo(() => safePicks(weekB), [weekB]);
  const capA = safeGet(weekA, 'cap', null);
  const capB = safeGet(weekB, 'cap', null);
  const viceA = safeGet(weekA, 'vice', null);
  const viceB = safeGet(weekB, 'vice', null);
  const chipA = safeGet(weekA, 'chip', null);
  const chipB = safeGet(weekB, 'chip', null);
  const hitsA = Number(safeGet(weekA, 'hits', 0)) || 0;
  const hitsB = Number(safeGet(weekB, 'hits', 0)) || 0;
  const bankA = safeGet(weekA, 'bank', 0);
  const bankB = safeGet(weekB, 'bank', 0);
  const itbA = typeof bankA === 'number' ? bankA : Number(bankA) || 0;
  const itbB = typeof bankB === 'number' ? bankB : Number(bankB) || 0;

  const planAName = useMemo(() => planList.find((p) => p.id === planAId)?.name || 'Plan 1', [planList, planAId]);
  const planBName = useMemo(() => planList.find((p) => p.id === planBId)?.name || 'Plan 2', [planList, planBId]);

  const getFixture = useCallback((pid, gw) => (typeof getFixtureLabel === 'function' ? getFixtureLabel(pid, gw) : ''), [getFixtureLabel]);
  const teamIdFor = useCallback((pid) => Number(teamNums != null && (teamNums[pid] ?? teamNums[String(pid)])) || null, [teamNums]);

  const maxSlots = Math.max(picksA.length, picksB.length, 1);
  const slotOrder = useMemo(() => {
    const diff = [];
    const same = [];
    for (let i = 0; i < maxSlots; i++) {
      const pidA = picksA[i] ?? null;
      const pidB = picksB[i] ?? null;
      const samePid = pidA === pidB;
      const sameCap = (capA === pidA) === (capB === pidB);
      const sameVice = (viceA === pidA) === (viceB === pidB);
      const rowSame = samePid && sameCap && sameVice;
      if (!rowSame) diff.push(i);
      else same.push(i);
    }
    return [...diff, ...same];
  }, [picksA, picksB, capA, capB, viceA, viceB, maxSlots]);

  const renderOneCell = useCallback((pid, cap, vice, isSame, isBench) => {
    const ink = (C && C.ink) || '#111';
    const muted = (C && C.muted) || '#666';
    const textColor = isSame || isBench ? muted : ink;
    const teamId = pid != null ? teamIdFor(pid) : null;
    const uri = teamId != null ? clubCrestUri(teamId) : null;
    const displayName = pid != null ? nameFor(pid, namesById) : '—';
    const isCap = pid != null && cap === pid;
    const isVice = pid != null && vice === pid;
    const suffix = [isCap ? ' (C)' : '', isVice ? ' (V)' : '', isBench ? ' (B)' : ''].join('');
    const fixtureText = pid != null && selectedGw != null ? getFixture(pid, selectedGw) : '';

    return (
      <View style={[styles.playerRow, (isSame || isBench) && styles.playerRowSame]}>
        {uri ? (
          <Image source={{ uri }} style={styles.crest} resizeMode="contain" />
        ) : (
          <View style={styles.crestPlaceholder} />
        )}
        <View style={styles.playerInfo}>
          <Text style={[styles.playerName, { color: textColor }]} numberOfLines={1}>{String(displayName)}{suffix}</Text>
          {fixtureText ? (
            <Text style={[styles.fixtureText, { color: muted }]} numberOfLines={1}>{String(fixtureText)}</Text>
          ) : null}
        </View>
      </View>
    );
  }, [C, teamIdFor, namesById, selectedGw, getFixture]);

  const summaryBar = useCallback((chip, hits, itb, capName) => {
    const ink = (C && C.ink) || '#111';
    const itbVal = typeof itb === 'number' ? itb / 10 : Number(itb) / 10;
    const parts = [
      `Chip: ${chip || '—'}`,
      `H: ${hits}`,
      `ITB: ${Number.isFinite(itbVal) ? itbVal.toFixed(1) : '0'}`,
      capName ? `C: ${capName}` : 'C: —',
    ];
    return (
      <View style={[styles.summaryBar, { backgroundColor: (C && C.accent) ? `${C.accent}22` : '#0a7ea422' }]}>
        <View style={styles.summaryRow}>
          {parts.map((p, i) => (
            <Text key={i} style={[styles.summaryText, { color: ink }]} numberOfLines={1}>{String(p)}</Text>
          ))}
        </View>
      </View>
    );
  }, [C]);

  if (!visible) return null;

  const ink = (C && C.ink) || '#111';
  const muted = (C && C.muted) || '#666';
  const border = (C && C.border) || '#ddd';
  const card = (C && C.card) || '#fff';
  const accent = (C && C.accent) || '#0a7ea4';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={[styles.card, { backgroundColor: card, borderColor: border }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: ink }]}>Compare plans</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <MaterialCommunityIcons name="close" size={24} color={ink} />
            </TouchableOpacity>
          </View>

          <View style={styles.pickers}>
            <View style={styles.pickerRow}>
              <Text style={[styles.planLabel, { color: ink }]}>Plan 1:</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                {planList.map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    onPress={() => setPlanAId(p.id)}
                    style={[styles.chip, { borderColor: border, backgroundColor: planAId === p.id ? accent : 'transparent' }]}
                  >
                    <Text style={[styles.chipText, { color: planAId === p.id ? '#fff' : ink }]} numberOfLines={1}>{String(p.name || p.id)}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
            <View style={styles.pickerRow}>
              <Text style={[styles.planLabel, { color: ink }]}>Plan 2:</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                {planList.map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    onPress={() => setPlanBId(p.id)}
                    style={[styles.chip, { borderColor: border, backgroundColor: planBId === p.id ? accent : 'transparent' }]}
                  >
                    <Text style={[styles.chipText, { color: planBId === p.id ? '#fff' : ink }]} numberOfLines={1}>{String(p.name || p.id)}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>

          {error ? (
            <View style={styles.msg}>
              <Text style={[styles.errorText, { color: '#b91c1c' }]}>{String(error)}</Text>
            </View>
          ) : loading ? (
            <View style={styles.msg}>
              <ActivityIndicator size="small" color={accent} />
              <Text style={[styles.msgText, { color: muted }]}>Loading…</Text>
            </View>
          ) : !planAId || !planBId || planAId === planBId ? (
            <View style={styles.msg}>
              <Text style={[styles.msgText, { color: muted }]}>Select two different plans above.</Text>
            </View>
          ) : gwList.length === 0 ? (
            <View style={styles.msg}>
              <Text style={[styles.msgText, { color: muted }]}>No gameweek data in these plans.</Text>
            </View>
          ) : (
            <>
              <View style={[styles.gwNav, { borderColor: border }]}>
                <TouchableOpacity onPress={goPrev} disabled={!canPrev} style={[styles.gwNavBtn, { borderColor: border, opacity: canPrev ? 1 : 0.4 }]}>
                  <Text style={[styles.gwNavText, { color: ink }]}>Previous GW</Text>
                </TouchableOpacity>
                <View style={[styles.gwDisplay, { backgroundColor: card, borderColor: border }]}>
                  <Text style={[styles.gwDisplayText, { color: ink }]}>{String(selectedGw != null ? selectedGw : '—')}</Text>
                </View>
                <TouchableOpacity onPress={goNext} disabled={!canNext} style={[styles.gwNavBtn, { borderColor: border, opacity: canNext ? 1 : 0.4 }]}>
                  <Text style={[styles.gwNavText, { color: ink }]}>Next GW</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.twoCol}>
                <View style={[styles.column, { borderColor: border }]}>
                  <Text style={[styles.columnTitle, { color: ink }]} numberOfLines={1}>{String(planAName)}</Text>
                  {summaryBar(chipA, hitsA, itbA, capA ? nameFor(capA, namesById) : null)}
                </View>
                <View style={[styles.column, { borderColor: border }]}>
                  <Text style={[styles.columnTitle, { color: ink }]} numberOfLines={1}>{String(planBName)}</Text>
                  {summaryBar(chipB, hitsB, itbB, capB ? nameFor(capB, namesById) : null)}
                </View>
              </View>
              <ScrollView style={styles.playerList} showsVerticalScrollIndicator={true}>
                  {slotOrder.map((idx) => {
                    const pidA = picksA[idx] ?? null;
                    const pidB = picksB[idx] ?? null;
                    const samePid = pidA === pidB;
                    const sameCap = (capA === pidA) === (capB === pidB);
                    const sameVice = (viceA === pidA) === (viceB === pidB);
                    const rowSame = samePid && sameCap && sameVice;
                    const isBench = idx >= BENCH_START;
                    return (
                      <View key={`row-${idx}`} style={[styles.comparisonRow, { borderColor: border }]}>
                        <View style={[styles.cellCol, { borderRightWidth: 1, borderColor: border }]}>
                          {renderOneCell(pidA, capA, viceA, rowSame, isBench)}
                        </View>
                        <View style={styles.cellCol}>
                          {renderOneCell(pidB, capB, viceB, rowSame, isBench)}
                        </View>
                      </View>
                    );
                  })}
              </ScrollView>
            </>
          )}

          <TouchableOpacity onPress={onClose} style={[styles.closeBtn, { borderColor: border }]}>
            <Text style={[styles.closeBtnText, { color: accent }]}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    maxHeight: '90%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  title: { fontSize: 18, fontWeight: '800' },
  pickers: { marginBottom: 10 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  planLabel: { fontSize: 12, fontWeight: '700', marginRight: 8, minWidth: 48 },
  chipScroll: { flex: 1 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    marginRight: 6,
  },
  chipText: { fontSize: 12, fontWeight: '700' },
  gwNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 10,
    padding: 6,
    marginBottom: 10,
  },
  gwNavBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  gwNavText: { fontSize: 12, fontWeight: '700' },
  gwDisplay: {
    minWidth: 44,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  gwDisplayText: { fontSize: 14, fontWeight: '800' },
  twoCol: { flexDirection: 'row', marginBottom: 8 },
  column: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    padding: 8,
    marginHorizontal: 4,
  },
  comparisonRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    minHeight: 44,
  },
  cellCol: {
    flex: 1,
    padding: 4,
  },
  columnTitle: { fontSize: 13, fontWeight: '800', marginBottom: 6 },
  summaryBar: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 6,
    marginBottom: 8,
  },
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  summaryText: { fontSize: 10, fontWeight: '700' },
  playerList: { maxHeight: 320 },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderRadius: 6,
  },
  playerRowSame: { opacity: 0.6 },
  crest: { width: 24, height: 24, borderRadius: 4, marginRight: 8 },
  crestPlaceholder: { width: 24, height: 24, borderRadius: 4, marginRight: 8, backgroundColor: '#eee' },
  playerInfo: { flex: 1, minWidth: 0 },
  playerName: { fontSize: 12, fontWeight: '700' },
  fixtureText: { fontSize: 10, marginTop: 1 },
  emptyText: { fontSize: 12, fontStyle: 'italic' },
  msg: { alignItems: 'center', paddingVertical: 24 },
  msgText: { fontSize: 13 },
  errorText: { fontSize: 13 },
  closeBtn: {
    alignSelf: 'flex-end',
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
  },
  closeBtnText: { fontWeight: '800' },
});
