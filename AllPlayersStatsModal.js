/**
 * AllPlayersStatsModal — sortable table of all players, editable columns.
 * Rebuilt to avoid "Text strings must be rendered within a <Text> component".
 * Same behaviour: filters (position, team, search), column picker, persist columns, tap "i" for single-player stats.
 */
import React, { useCallback, useMemo, useState, useEffect } from 'react';
import {
  View,
  Text,
  Dimensions,
  ScrollView,
  TouchableOpacity,
  Image,
  FlatList,
  Modal,
  StyleSheet,
  Keyboard,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import ThemedTextInput from './ThemedTextInput';
import { clubCrestUri } from './clubs';

const COLS_KEY = 'planner_allstats_columns_v1';
const NAME_COL_W = 130;
const COL_MIN_W = 52;
const POS_LABELS = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };

function isPercentish(key) {
  return key === 'selected_by_percent' || /ownership|tsb|percent|pct/i.test(String(key || ''));
}

export default function AllPlayersStatsModal({
  open,
  onClose,
  extendedInfo,
  playersInfo,
  teamNums,
  C,
  tableMaxHeight,
  styles: S,
  shortHeaderFor,
  pretty,
  isRankableExtKey,
  setStatsPid,
  setStatsOpen,
  MiniSelectModal,
}) {
  const { t } = useTranslation();
  const TABLE_MAX_H = tableMaxHeight ?? Math.round(Dimensions.get('window').height * 0.6);

  const teamShort = playersInfo?.teamShort || {};
  const teamNames = playersInfo?.teamNames || playersInfo?.teamsById || {};
  const teamLabelFor = useCallback(
    (teamNum) => {
      if (!teamNum) return '';
      return teamNames?.[teamNum] || teamShort?.[teamNum] || `Team ${teamNum}`;
    },
    [teamNames, teamShort]
  );

  const catalog = useMemo(() => {
    const out = new Set();
    for (const [, row] of Object.entries(extendedInfo || {})) {
      if (!row || typeof row !== 'object') continue;
      for (const [k, v] of Object.entries(row)) {
        if (isRankableExtKey(k, v)) out.add(k);
      }
    }
    if (!out.has('now_cost')) out.add('now_cost');
    return Array.from(out).sort();
  }, [extendedInfo, isRankableExtKey]);

  const DEFAULT_COLS = [
    'now_cost',
    'total_points',
    'selected_by_percent',
    'goals_scored',
    'assists',
    'form',
    'minutes',
    'xg_per90',
    'defcon_per90',
  ].filter((k) => catalog.includes(k));

  const [columns, setColumns] = useState(DEFAULT_COLS);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sortKey, setSortKey] = useState('total_points');
  const [sortDir, setSortDir] = useState('desc');
  const [posFilter, setPosFilter] = useState(null);
  const [q, setQ] = useState('');
  const [teamFilter, setTeamFilter] = useState(null);
  const [teamPickerOpen, setTeamPickerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const defaultCols = [
      'now_cost',
      'total_points',
      'selected_by_percent',
      'goals_scored',
      'assists',
      'form',
      'minutes',
      'xg_per90',
      'defcon_per90',
    ].filter((k) => catalog.includes(k));
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(COLS_KEY);
        if (cancelled) return;
        if (!raw) {
          if (defaultCols.length) setColumns(defaultCols);
          return;
        }
        const wanted = JSON.parse(raw).filter((k) => catalog.includes(k));
        // Only use saved columns if we have at least as many as defaults; otherwise merge defaults in
        if (wanted.length >= defaultCols.length) {
          setColumns(wanted);
        } else {
          const merged = [...wanted];
          for (const k of defaultCols) {
            if (!merged.includes(k)) merged.push(k);
          }
          setColumns(merged);
        }
      } catch (_) {
        if (defaultCols.length) setColumns(defaultCols);
      }
    })();
    return () => { cancelled = true; };
  }, [catalog]);

  useEffect(() => {
    (async () => {
      try {
        await AsyncStorage.setItem(COLS_KEY, JSON.stringify(columns));
      } catch (_) {}
    })();
  }, [columns]);

  const toggleCol = useCallback((k) => {
    setColumns((cols) => (cols.includes(k) ? cols.filter((x) => x !== k) : [...cols, k]));
  }, []);
  const removeCol = useCallback((k) => {
    setColumns((cols) => (cols.length <= 1 ? cols : cols.filter((x) => x !== k)));
  }, []);
  const moveCol = useCallback((k, dir) => {
    setColumns((cols) => {
      const idx = cols.indexOf(k);
      if (idx < 0) return cols;
      const target = idx + dir;
      if (target < 0 || target >= cols.length) return cols;
      const next = cols.slice();
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item);
      return next;
    });
  }, []);
  const setSort = useCallback((k) => {
    setSortKey((prev) => {
      if (k === prev) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('desc');
      return k;
    });
  }, []);

  const namesById = playersInfo?.names || {};
  const types = playersInfo?.types || {};
  const teams = playersInfo?.teams || {};

  const allRows = useMemo(() => {
    const rows = [];
    for (const [pidStr, row] of Object.entries(extendedInfo || {})) {
      const pid = Number(pidStr);
      if (!Number.isFinite(pid)) continue;
      const type = Number(types?.[pid]) || Number(row.element_type) || null;
      const name = namesById?.[pid] || row.web_name || String(pid);
      // Team id for crest: teamNums (pid->id) from planner, then extendedInfo row
      const teamNum = Number(teamNums?.[pid] ?? teamNums?.[String(pid)]) ?? Number(row.team) ?? Number(row.team_code) ?? (typeof teams?.[pid] === 'number' ? teams[pid] : null) ?? null;
      const shortTeam = teams?.[pid] ?? row.team ?? null;
      const status = row.status || null;
      rows.push({ pid, type, name, teamNum, shortTeam, status, r: row });
    }
    return rows;
  }, [extendedInfo, namesById, types, teams, teamNums]);

  const teamOptions = useMemo(() => {
    const map = new Map();
    for (const r of allRows) {
      if (r.teamNum != null && !map.has(r.teamNum)) map.set(r.teamNum, r.shortTeam);
    }
    return Array.from(map.entries()).sort((a, b) =>
      String(a[1]).localeCompare(String(b[1]))
    );
  }, [allRows]);

  const filtered = useMemo(() => {
    const qn = q.trim().toLowerCase();
    return allRows.filter((x) => {
      if (x.status === 'u' || x.r?.status === 'u') return false;
      if (posFilter != null && x.type !== posFilter) return false;
      if (teamFilter != null && x.teamNum !== teamFilter) return false;
      if (qn && !String(x.name).toLowerCase().includes(qn)) return false;
      return true;
    });
  }, [allRows, posFilter, q, teamFilter]);

  const valueFor = useCallback((row, key) => {
    let v = row.r?.[key];
    if (v == null) {
      const lower = String(key).toLowerCase();
      const alt = Object.keys(row.r || {}).find((k) => String(k).toLowerCase() === lower);
      if (alt) v = row.r?.[alt];
    }
    if (/^now_?cost$/i.test(key)) return Number(v ?? 0);
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }, []);

  const sorted = useMemo(() => {
    const arr = filtered.slice();
    arr.sort((a, b) => {
      const va = valueFor(a, sortKey);
      const vb = valueFor(b, sortKey);
      return sortDir === 'asc' ? va - vb : vb - va;
    });
    return arr.slice(0, 500);
  }, [filtered, sortKey, sortDir, valueFor]);

  const fmtCell = useCallback((k, rawV) => {
    if (rawV == null || rawV === '') return '—';
    if (/^now_?cost$/i.test(k) || /price/i.test(k)) {
      const v = Number(rawV);
      if (!Number.isFinite(v)) return '—';
      const tenths = /^now_?cost$/i.test(k) ? v : v * 10;
      return `£${(tenths / 10).toFixed(1)}`;
    }
    if (isPercentish(k)) {
      const v = Number(rawV);
      if (!Number.isFinite(v)) return '—';
      return `${v.toFixed(1)}%`;
    }
    const v = Number(rawV);
    if (Number.isInteger(v)) return String(v);
    if (typeof v === 'number' && !Number.isNaN(v)) {
      return v.toFixed(2).replace(/\.00$/, '.0').replace(/\.0$/, '');
    }
    return String(rawV ?? '—');
  }, []);

  const colWidth = () => Math.max(COL_MIN_W, 52);

  if (!open) return null;

  const teamLabel =
    teamFilter == null
      ? 'All teams'
      : String(
          teamOptions.find(([num]) => num === teamFilter)?.[1] ??
            teamLabelFor(teamFilter) ??
            'All teams'
        );

  const headerRow = (
    <View style={[localStyles.headerRow, { backgroundColor: C.bg }]}>
      <View style={[localStyles.playerCell, { borderColor: C.border }]}>
        <Text style={[localStyles.headerText, { color: C.muted }]}>Player</Text>
      </View>
      {columns.map((k) => {
        const active = k === sortKey;
        const label = String(shortHeaderFor(k) ?? '') + (active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');
        return (
          <View key={k} style={[localStyles.headerCell, { borderColor: C.border, width: colWidth() }]}>
            <TouchableOpacity onPress={() => setSort(k)} style={localStyles.sortTouch}>
              <Text
                style={[localStyles.headerCellText, { color: C.ink, fontWeight: active ? '800' : '700' }]}
                numberOfLines={1}
              >
                {label}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => removeCol(k)}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              style={localStyles.xTouch}
            >
              <Text style={[localStyles.xText, { color: C.muted }]}>×</Text>
            </TouchableOpacity>
          </View>
        );
      })}
    </View>
  );

  const emptyBody = (
    <View style={localStyles.emptyBody}>
      <Text style={[localStyles.emptyText, { color: C.muted }]}>
        No players match your filters.
      </Text>
    </View>
  );

  const renderRow = ({ item: row }) => (
    <View style={[localStyles.row, { borderColor: C.border }]}>
      <View style={[localStyles.playerCell, { borderColor: C.border }]}>
        <View style={localStyles.rowIdentity}>
          <Image
            source={{ uri: clubCrestUri(row.teamNum ?? row.r?.team ?? row.r?.team_code ?? 1) }}
            style={localStyles.crest}
            resizeMode="contain"
          />
          <View style={localStyles.nameBlock}>
            <Text style={[localStyles.nameText, { color: C.ink }]} numberOfLines={1}>
              {String(row.name ?? '')}
            </Text>
            <View style={localStyles.posRow}>
              <Text style={[localStyles.posText, { color: C.muted }]} numberOfLines={1}>
                {String(POS_LABELS[row.type] ?? '?')}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  if (setStatsPid) setStatsPid(row.pid);
                  if (setStatsOpen) setStatsOpen(true);
                }}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                style={localStyles.iBtn}
              >
                <Text style={S?.rItalicI2 || [localStyles.iText, { color: C.ink }]}>i</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
      {columns.map((k) => {
        const cellStr = fmtCell(k, valueFor(row, k));
        return (
          <View key={k} style={[localStyles.cell, { borderColor: C.border, width: colWidth() }]}>
            <Text style={[localStyles.cellText, { color: C.ink }]} numberOfLines={1}>
              {typeof cellStr === 'string' ? cellStr : '—'}
            </Text>
          </View>
        );
      })}
    </View>
  );

  const tableBody =
    sorted.length === 0 ? (
      emptyBody
    ) : (
      <FlatList
        data={sorted}
        keyExtractor={(item) => String(item.pid)}
        renderItem={renderRow}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        removeClippedSubviews={false}
        initialNumToRender={20}
        maxToRenderPerBatch={20}
        windowSize={5}
      />
    );

  const tableContent = (
    <View style={localStyles.tableInner}>
      {headerRow}
      <View style={[localStyles.tableBody, { maxHeight: TABLE_MAX_H }]}>{tableBody}</View>
    </View>
  );

  const scrollContent = (
    <ScrollView
      horizontal
      bounces={false}
      style={[localStyles.tableScroll, { borderColor: C.border }]}
      contentContainerStyle={localStyles.scrollContent}
    >
      {tableContent}
    </ScrollView>
  );

  const positionPills = [null, 1, 2, 3, 4].map((p) => {
    const active = posFilter === p;
    const label = p == null ? 'All' : (POS_LABELS[p] ?? '?');
    return (
      <TouchableOpacity
        key={p === null ? 'pos-all' : `pos-${p}`}
        onPress={() => setPosFilter(p)}
        style={[
          localStyles.pill,
          {
            backgroundColor: active ? C.ink : 'transparent',
            borderColor: C.border,
            borderWidth: active ? 0 : 1,
          },
        ]}
      >
        <Text
          style={[localStyles.pillText, { color: active ? C.card : C.ink }]}
          numberOfLines={1}
        >
          {String(label)}
        </Text>
      </TouchableOpacity>
    );
  });

  const titleRow = (
    <View style={localStyles.titleRow}>
      <Text style={[localStyles.titleText, { color: C.ink }]}>Stats</Text>
      <View style={localStyles.titleActions}>
        <TouchableOpacity onPress={() => setTeamPickerOpen(true)} style={S?.smallBtn || localStyles.smallBtn}>
          <MaterialCommunityIcons name="shield-outline" size={14} color={C.ink} />
          <Text style={S?.smallBtnTxt || [localStyles.smallBtnText, { color: C.ink }]} numberOfLines={1}>
            {teamLabel}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setPickerOpen(true)} style={S?.smallBtn || localStyles.smallBtn}>
          <MaterialCommunityIcons name="view-column" size={14} color={C.ink} />
          <Text style={S?.smallBtnTxt || [localStyles.smallBtnText, { color: C.ink }]} numberOfLines={1}>
            {String(t('planner.columns') ?? '')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onClose} style={S?.smallBtn || localStyles.smallBtn}>
          <MaterialCommunityIcons name="close" size={14} color={C.ink} />
          <Text style={S?.smallBtnTxt || [localStyles.smallBtnText, { color: C.ink }]} numberOfLines={1}>
            {String(t('planner.close') ?? '')}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const filtersRow = (
    <View style={localStyles.filtersRow}>
      {positionPills}
      <View style={localStyles.searchPill}>
        <MaterialCommunityIcons name="magnify" size={14} color={C.muted} style={localStyles.magnify} />
        <ThemedTextInput
          value={q}
          onChangeText={setQ}
          placeholder={String(t('planner.search') ?? '')}
          placeholderTextColor={C.muted}
          style={[localStyles.searchInput, { color: C.ink }]}
          returnKeyType="search"
        />
      </View>
    </View>
  );

  const columnPickerModal = (
    <Modal
      visible={pickerOpen}
      transparent
      animationType="fade"
      onRequestClose={() => setPickerOpen(false)}
    >
      <View style={localStyles.pickerBackdrop}>
        <View style={[localStyles.pickerCard, { backgroundColor: C.card }]}>
          <Text style={[localStyles.pickerTitle, { color: C.ink }]}>Active columns (order)</Text>
          <ScrollView style={localStyles.pickerScroll}>
            {columns.map((k, idx) => {
              const canMoveUp = idx > 0;
              const canMoveDown = idx < columns.length - 1;
              const canRemove = columns.length > 1;
              return (
                <View key={`active-${k}`} style={localStyles.pickerRow}>
                  <Text style={[localStyles.pickerRowLabel, { color: C.ink }]} numberOfLines={1}>
                    {String(pretty(k) ?? k ?? '')}
                  </Text>
                  <View style={localStyles.pickerRowActions}>
                    <TouchableOpacity
                      onPress={() => canMoveUp && moveCol(k, -1)}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      style={[localStyles.pickerIconBtn, { opacity: canMoveUp ? 1 : 0.35 }]}
                    >
                      <MaterialCommunityIcons name="chevron-up" size={14} color={C.ink} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => canMoveDown && moveCol(k, 1)}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      style={[localStyles.pickerIconBtn, { opacity: canMoveDown ? 1 : 0.35 }]}
                    >
                      <MaterialCommunityIcons name="chevron-down" size={14} color={C.ink} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => canRemove && removeCol(k)}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      style={[localStyles.pickerIconBtn, { opacity: canRemove ? 1 : 0.35 }]}
                    >
                      <Text style={localStyles.removeText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </ScrollView>
          <Text style={[localStyles.pickerSubtitle, { color: C.ink }]}>Add more columns</Text>
          <ScrollView style={localStyles.pickerScrollSmall}>
            {catalog
              .filter((k) => !columns.includes(k))
              .map((k) => (
                <TouchableOpacity
                  key={`avail-${k}`}
                  onPress={() => toggleCol(k)}
                  style={localStyles.pickerRow}
                >
                  <Text style={[localStyles.pickerRowLabel, { color: C.ink }]} numberOfLines={1}>
                    {String(pretty(k) ?? k ?? '')}
                  </Text>
                  <Text style={[localStyles.plusText, { color: C.accent || C.ink }]}>+</Text>
                </TouchableOpacity>
              ))}
          </ScrollView>
          <TouchableOpacity onPress={() => setPickerOpen(false)} style={localStyles.doneBtn}>
            <Text style={[localStyles.doneText, { color: C.accent || C.ink }]}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  const cardChildren = [
    <React.Fragment key="stats-title">{titleRow}</React.Fragment>,
    <React.Fragment key="stats-filters">{filtersRow}</React.Fragment>,
    <React.Fragment key="stats-table">{scrollContent}</React.Fragment>,
  ];

  const windowHeight = Dimensions.get('window').height;
  const cardTop = Math.round(windowHeight * 0.06);
  const cardMaxHeight = Math.round(windowHeight * 0.86);

  return (
    <View pointerEvents="auto" style={S?.modalWrap || localStyles.modalWrap}>
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={1}
        onPress={() => { Keyboard.dismiss(); onClose(); }}
      />
      <View
        style={[
          localStyles.card,
          {
            backgroundColor: C.card,
            top: cardTop,
            maxHeight: cardMaxHeight,
            marginHorizontal: 12,
          },
        ]}
      >
        {cardChildren}
      </View>
      {columnPickerModal}
      {MiniSelectModal && (
        <MiniSelectModal
          visible={teamPickerOpen}
          title={String(t('planner.filterByTeam') ?? '')}
          C={C}
          options={[
            { label: 'All teams', value: null },
            ...teamOptions.map(([tn, label]) => ({
              label: String(label ?? teamLabelFor(tn) ?? `Team ${tn}`),
              value: tn,
            })),
          ]}
          selected={teamFilter}
          onSelect={(val) => setTeamFilter(val == null ? null : Number(val))}
          onClose={() => setTeamPickerOpen(false)}
        />
      )}
    </View>
  );
}

const localStyles = StyleSheet.create({
  modalWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 9999,
  },
  card: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderRadius: 14,
    padding: 10,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  titleText: { fontWeight: '800', fontSize: 16 },
  titleActions: { flexDirection: 'row', gap: 8 },
  smallBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  smallBtnText: { fontWeight: '800', fontSize: 11 },
  filtersRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  pill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  pillText: { fontWeight: '700', fontSize: 12 },
  searchPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    height: 32,
    minWidth: 120,
  },
  magnify: { marginRight: 6 },
  searchInput: {
    flex: 1,
    height: '100%',
    paddingVertical: 0,
    paddingHorizontal: 0,
    fontSize: 10,
  },
  tableScroll: { borderWidth: 1, borderRadius: 10 },
  scrollContent: {},
  tableInner: {},
  headerRow: { flexDirection: 'row' },
  playerCell: {
    width: NAME_COL_W,
    borderRightWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  headerText: { fontWeight: '700', fontSize: 12 },
  headerCell: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRightWidth: 1,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  sortTouch: { flex: 1, paddingVertical: 2, paddingRight: 4 },
  headerCellText: { fontSize: 10 },
  xTouch: { paddingHorizontal: 2, paddingVertical: 2 },
  xText: { fontSize: 10 },
  tableBody: { minHeight: 140 },
  emptyBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  emptyText: { fontSize: 13 },
  row: { flexDirection: 'row', borderTopWidth: 1 },
  rowIdentity: { flexDirection: 'row', alignItems: 'center' },
  crest: { width: 18, height: 18, marginRight: 6, borderRadius: 3 },
  nameBlock: { flex: 1 },
  nameText: { fontWeight: '700', fontSize: 11 },
  posRow: { flexDirection: 'row', alignItems: 'center' },
  posText: { fontSize: 10 },
  iBtn: { marginLeft: 6 },
  iText: { fontStyle: 'italic', fontWeight: '700', fontSize: 10 },
  cell: {
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRightWidth: 1,
  },
  cellText: { fontSize: 11 },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    padding: 20,
  },
  pickerCard: { borderRadius: 14, padding: 12, maxHeight: 480, width: '100%' },
  pickerTitle: { fontWeight: '800', fontSize: 14, marginBottom: 4 },
  pickerScroll: { maxHeight: 220 },
  pickerScrollSmall: { maxHeight: 160 },
  pickerRow: {
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickerRowLabel: { flex: 1, fontSize: 13 },
  pickerRowActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pickerIconBtn: { paddingHorizontal: 6, paddingVertical: 4 },
  removeText: { color: '#ef4444', fontWeight: '700', fontSize: 11 },
  pickerSubtitle: { fontWeight: '800', fontSize: 14, marginTop: 8, marginBottom: 4 },
  plusText: { fontWeight: '700' },
  doneBtn: { alignSelf: 'flex-end', marginTop: 8 },
  doneText: { fontWeight: '700' },
});
