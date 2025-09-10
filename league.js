// league.js
import InfoBanner from './InfoBanner';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  Image,
  ImageBackground,
  Dimensions,
  Switch,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { assetImages, clubCrestUri } from './clubs';
import { useFplId } from './FplIdContext';
import { smartFetch } from './signedFetch';
import { useColors, useTheme } from './theme';

const COL = { pos: 12, manager: 35, yet: 9, cap: 18, gw: 13, total: 15 };
const toPct = (n) => `${n}%`;
const LIVEFPL_LOGO = assetImages?.livefplLogo ?? assetImages?.logo;

const CHIP_ORDER = ['WC', 'BB', 'FH', 'TC'];
const RADIUS = 18;
const SHOW_HEARTS = false;

/** ===== Helpers ===== */
const fmt = (n) => (n === null || n === undefined ? '-' : Intl.NumberFormat('en-US').format(n));
const sign = (n) => (n > 0 ? `+${n}` : `${n}`);
const safeArr = (v) => (Array.isArray(v) ? v : []);
const pickPayload = (json, fplId) => (json && json[String(fplId)]) ? json[String(fplId)] : (json || {});
const pct = (x) => (x == null ? '' : `${Math.round(x * 100)}%`);

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

  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);

  const [options, setOptions] = useState([]);
  const [selected, setSelected] = useState(null);
  const _leagueLink = selected?.id
    ? `www.livefpl.net/leagues/${selected.id}`
    : 'www.livefpl.net/leagues';
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [optionsError, setOptionsError] = useState('');

  const [league, setLeague] = useState(null);
  const [leagueLoading, setLeagueLoading] = useState(false);
  const [leagueError, setLeagueError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const [expanded, setExpanded] = useState(() => new Set());
  const [favs, setFavs] = useState(() => new Set());
  const [autosubs, setAutosubs] = useState(true);

  // ── Chips table sort (default: by percent, desc)
  const [chipsSortKey, setChipsSortKey] = useState('pct');
  const [chipsSortDir, setChipsSortDir] = useState('desc');

  // ── EO table sort (default: by EO%, desc)
  const [eoSortKey, setEoSortKey] = useState('eo_pct');
  const [eoSortDir, setEoSortDir] = useState('desc');

  const pctStr = (n) => {
    const x = Number(n);
    return Number.isFinite(x) ? `${Math.round(x)}%` : '-';
  };

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

  const eoRows = useMemo(() => {
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

  useEffect(() => {
    (async () => {
      const saved = await AsyncStorage.getItem('selectedLeague');
      if (saved) { try { setSelected(JSON.parse(saved)); } catch {} }
      const favRaw = await AsyncStorage.getItem('favEntries');
      if (favRaw) { try { setFavs(new Set(JSON.parse(favRaw))); } catch {} }
      const as = await AsyncStorage.getItem('autosubs');
      if (as === '0') setAutosubs(false);
    })();
  }, []);

  useEffect(() => {
    setSelected(null);
    setLeague(null);
    setExpanded(new Set());
    AsyncStorage.removeItem('selectedLeague').catch(() => {});
  }, [fplId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!fplId) return;
      setLoadingOptions(true);
      setOptionsError('');
      try {
        const cached = await AsyncStorage.getItem('fplData');
        const now = Date.now();
        let payload = null;

        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            if (parsed?.timestamp && now - parsed.timestamp < 30000 && parsed.id === fplId) {
              payload = parsed.data;
            }
          } catch {}
        }

        if (!payload) {
          const resp = await smartFetch(
            `https://livefpl-api-489391001748.europe-west4.run.app/LH_api/${encodeURIComponent(fplId)}`
          );
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const json = await resp.json();
          payload = pickPayload(json, fplId);
          await AsyncStorage.setItem('fplData', JSON.stringify({ data: payload, timestamp: now, id: fplId }));
        }

        const raw = Array.isArray(payload?.options) ? payload.options : [];
        const mapped = raw.map(([id, name]) => ({ id: String(id), name: String(name) }));
        if (!cancelled) setOptions(mapped);
      } catch (e) {
        if (!cancelled) setOptionsError(e?.message || 'Failed to load your leagues.');
      } finally {
        if (!cancelled) setLoadingOptions(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fplId, triggerRefetch]);

  const fetchLeague = useCallback(async (leagueId, { force = false, autosubs = true } = {}) => {
    if (!leagueId) return;
    setLeagueError('');
    setLeagueLoading(true);
    try {
      const cacheKey = `league:${leagueId}:autosubs=${autosubs ? 1 : 0}`;
      const now = Date.now();
      if (!force) {
        const cached = await AsyncStorage.getItem(cacheKey);
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            if (parsed?.timestamp && now - parsed.timestamp < 30000) {
              setLeague(parsed.data);
              setLeagueLoading(false);
              return;
            }
          } catch {}
        }
      }
      const resp = await smartFetch(
        `https://livefpl-api-489391001748.europe-west4.run.app/LH_api/leagues/${encodeURIComponent(leagueId)}?autosubs=${autosubs ? 1 : 0}`
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      setLeague(json);
      await AsyncStorage.setItem(cacheKey, JSON.stringify({ data: json, timestamp: now }));
    } catch (e) {
      setLeagueError(e?.message || 'Failed to load league.');
    } finally {
      setLeagueLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selected?.id) {
      setExpanded(new Set());
      fetchLeague(selected.id, { autosubs });
    }
  }, [selected?.id, autosubs, fetchLeague]);

  const onRefresh = useCallback(async () => {
    if (!selected?.id) return;
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
    const rows = league?.rows ? [...league.rows] : [];
    rows.sort((a, b) => {
      const av = getSortVal(a, sortKey);
      const bv = getSortVal(b, sortKey);
      const bothNum = typeof av === 'number' && typeof bv === 'number';
      let cmp = bothNum ? (av - bv) : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [league?.rows, sortKey, sortDir]);

  const header = useMemo(() => {
    if (!league) return null;
    return (
      <View>
        <InfoBanner text="Full Downloadable League Analysis at" link={_leagueLink} />

        <View style={S.thead}>
          <Text style={S.theadTitle}>
            {league.league_name ?? 'League'}
            {league.gameweek ? ` — Live Gameweek ${league.gameweek} Table` : ''}
          </Text>

          <View style={S.colHeadRow}>
            <View style={[S.thCell, S.thCenter, { width: toPct(COL.pos) }]}>
              <Pressable style={S.thPress} onPress={() => handleSort('pos')}>
                <Text style={[S.th, sortKey==='pos' && S.thActive]}>Pos</Text>
                {sortKey==='pos' && (
                  <MaterialCommunityIcons name={sortDir==='asc'?'chevron-up':'chevron-down'} size={14} color={C.muted} />
                )}
              </Pressable>
            </View>

            <View style={[S.thCell, S.thStart, { width: toPct(COL.manager) }]}>
              <Text style={S.th}>Manager</Text>
            </View>

            <View style={[S.thCell, S.thCenter, { width: toPct(COL.yet) }]}>
              <Pressable style={S.thPress} onPress={() => handleSort('yet')}>
                <Text style={[S.th, sortKey==='yet' && S.thActive]}>Yet</Text>
                {sortKey==='yet' && (
                  <MaterialCommunityIcons name={sortDir==='asc'?'chevron-up':'chevron-down'} size={14} color={C.accent} />
                )}
              </Pressable>
            </View>

            <View style={[S.thCell, S.thCenter, { width: toPct(COL.cap) }]}>
              <Pressable style={S.thPress} onPress={() => handleSort('cap')}>
                <Text style={[S.th, sortKey==='cap' && S.thActive]}>(C)</Text>
                {sortKey==='cap' && (
                  <MaterialCommunityIcons name={sortDir==='asc'?'chevron-up':'chevron-down'} size={14} color={C.accent} />
                )}
              </Pressable>
            </View>

            <View style={[S.thCell, S.thCenter, { width: toPct(COL.gw) }]}>
              <Pressable style={S.thPress} onPress={() => handleSort('gw')}>
                <Text style={[S.th, sortKey==='gw' && S.thActive]}>GW</Text>
                {sortKey==='gw' && (
                  <MaterialCommunityIcons name={sortDir==='asc'?'chevron-up':'chevron-down'} size={14} color={C.accent} />
                )}
              </Pressable>
            </View>

            <View style={[S.thCell, S.thCenter, { width: toPct(COL.total) }]}>
              <Pressable style={S.thPress} onPress={() => handleSort('total')}>
                <Text style={[S.th, sortKey==='total' && S.thActive]}>Total</Text>
                {sortKey==='total' && (
                  <MaterialCommunityIcons name={sortDir==='asc'?'chevron-up':'chevron-down'} size={14} color={C.accent} />
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    );
  }, [league, sortKey, sortDir, C.accent, S]);

  const onToggleAutosubs = async (val) => {
    setAutosubs(val);
    await AsyncStorage.setItem('autosubs', val ? '1' : '0');
    if (selected?.id) {
      fetchLeague(selected.id, { autosubs: val, force: true });
    }
  };

  const renderRow = ({ item }) => {
    const me = Number(fplId) === Number(item.entry_id);
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
      />
    );
  };

  if (!fplId) {
    return (
      <View style={[S.center, { paddingTop: 50 }]}>
        <Text style={S.muted}>Set your FPL ID first.</Text>
      </View>
    );
  }

  return (
    <View style={S.page}>
      <AppHeader />

      {/* === Toolbar: Select | Settings Cog | EO & Chips === */}
      <View style={S.toolbarRow}>
        <Pressable style={[S.select, { flex: 1 }]} onPress={() => setOpen(true)}>
          <Text style={[S.selectText, !selected && S.placeholder]}>
            {selected?.name ?? 'Select a league'}
          </Text>
          <MaterialCommunityIcons name="chevron-down" size={20} color={C.muted} />
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

        {/* EO & Chips */}
        {league && (
          <TouchableOpacity
            style={[S.analyticsBtn, S.analyticsInlineBtn]}
            onPress={() => setAnalyticsOpen(true)}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="chart-bar" size={16} color={C.ink} />
            <Text style={S.analyticsBtnText}>EO & Chips</Text>
          </TouchableOpacity>
        )}
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
                style={{ maxHeight: 360 }}
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

      {/* Analytics modal */}
      <Modal visible={analyticsOpen} transparent animationType="fade" onRequestClose={() => setAnalyticsOpen(false)}>
        <View style={S.overlay}>
          <View style={S.analyticsSheet}>
            <View style={S.analyticsHeaderRow}>
              <Text style={S.analyticsTitle}>League analytics</Text>
              <TouchableOpacity onPress={() => setAnalyticsOpen(false)}>
                <Text style={S.link}>Close</Text>
              </TouchableOpacity>
            </View>

            {/* Chips usage */}
            <Text style={S.tableTitle}>Chips usage (%)</Text>
            <View style={S.tableHeaderRow}>
              <Pressable style={[S.headCell, { flex: 2 }]} onPress={() => handleChipsSort('chip')}>
                <Text style={[S.headTxt, chipsSortKey === 'chip' && S.headActive]}>Chip</Text>
                {chipsSortKey === 'chip' && (
                  <MaterialCommunityIcons name={chipsSortDir === 'asc' ? 'chevron-up' : 'chevron-down'} size={14} color={C.accent} />
                )}
              </Pressable>
              <Pressable style={[S.headCell, S.headNum, { flex: 1 }]} onPress={() => handleChipsSort('pct')}>
                <Text style={[S.headTxt, chipsSortKey === 'pct' && S.headActive]}>Pct</Text>
                {chipsSortKey === 'pct' && (
                  <MaterialCommunityIcons name={chipsSortDir === 'asc' ? 'chevron-up' : 'chevron-down'} size={14} color={C.accent} />
                )}
              </Pressable>
            </View>
            <FlatList
              data={chipsRows}
              keyExtractor={(x) => x.chip}
              style={S.tableList}
              renderItem={({ item }) => (
                <View style={S.row}>
                  <Text style={[S.cell, { flex: 2 }]}>{item.chip}</Text>
                  <Text style={[S.cell, S.cellNum, { flex: 1 }]}>{pctStr(item.pct)}</Text>
                </View>
              )}
            />

            {/* EO & captains */}
            <Text style={[S.tableTitle, { marginTop: 12 }]}>Player EO & captains (%)</Text>
            <View style={S.tableHeaderRow}>
              <Pressable style={[S.headCell, { flex: 2 }]} onPress={() => handleEoSort('name')}>
                <Text style={[S.headTxt, eoSortKey === 'name' && S.headActive]}></Text>
                {eoSortKey === 'name' && (
                  <MaterialCommunityIcons name={eoSortDir === 'asc' ? 'chevron-up' : 'chevron-down'} size={10} color={C.accent} />
                )}
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
                  {eoSortKey === key && (
                    <MaterialCommunityIcons name={eoSortDir === 'asc' ? 'chevron-up' : 'chevron-down'} size={10} color={C.accent} />
                  )}
                </Pressable>
              ))}
            </View>

            <FlatList
              data={eoRows}
              keyExtractor={(x) => String(x.id)}
              style={S.tableList}
              renderItem={({ item }) => (
                <View style={S.row}>
                  <Text style={[S.cell, { flex: 2 }]} numberOfLines={1}>{item.name}</Text>
                  <Text style={[S.cell, S.cellNum]}>{pctStr(item.own_pct)}</Text>
                  <Text style={[S.cell, S.cellNum]}>{pctStr(item.s_pct)}</Text>
                  <Text style={[S.cell, S.cellNum]}>{pctStr(item.c_pct)}</Text>
                  <Text style={[S.cell, S.cellNum]}>{pctStr(item.tc_pct)}</Text>
                  <Text style={[S.cell, S.cellNum]}>{pctStr(item.eo_pct)}</Text>
                </View>
              )}
            />
          </View>
        </View>
      </Modal>

      {/* List */}
      {selected?.id ? (
        leagueLoading && !league ? (
          <View style={[S.center, { paddingTop: 24 }]}><ActivityIndicator color={C.accent} /><Text style={S.muted}>Loading league…</Text></View>
        ) : leagueError ? (
          <View style={[S.center, { paddingTop: 24 }]}>
            <Text style={S.error}>{leagueError}</Text>
            <View style={{ height: 8 }} />
            <TouchableOpacity onPress={() => fetchLeague(selected.id, { autosubs })}><Text style={S.link}>Retry</Text></TouchableOpacity>
          </View>
        ) : league ? (
          <FlatList
            data={dataSorted}
            keyExtractor={(x) => String(x.entry_id)}
            renderItem={renderRow}
            ListHeaderComponent={header}
            stickyHeaderIndices={[0]}
            contentContainerStyle={{ paddingBottom: 36 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
          />
        ) : null
      ) : null}
    </View>
  );
};

/** ===== Row ===== */
const LeagueRow = ({ row, me, fav, expanded, onToggle, onFav, C, isDark, S }) => {
  const navigation = useNavigation();
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

  const chips = (() => {
    const arr = [];
    if (activeChip) arr.push({ key: 'active', val: activeChip, active: true });
    CHIP_ORDER.forEach((c) => {
      if (c === activeChip) return;
      if (usedChips.includes(c)) arr.push({ key: c, val: c, used: true });
    });
    return arr;
  })();

  const transfers = safeArr(row.transfers);
  const xferSum = transfers.reduce((acc, t) => acc + (typeof t.gain === 'number' ? t.gain : 0), 0);
  const hits = Number(row.gw_hits ?? row.hits ?? row.hit ?? 0) || 0;
  const xferNet = xferSum + hits;
  const netForColor = hits ? xferNet : xferSum;
  const xferText = hits ? ` ${sign(xferSum)} + ${hits} = ${sign(xferNet)} (incl. hits)` : ` ${sign(xferSum)}`;

  const HeaderInner = () => (
    <>
      {/* Pos */}
      <View style={[S.rankWrap, { width: toPct(COL.pos) }]}>
        <View style={S.arrowBlock}>
          <Image source={assetImages[t.key]} style={S.rankArrow} />
          {showDelta && (
            <Text style={[S.deltaTiny, { color: me ? '#ffffff' : t.color }]}>{sign(delta)}</Text>
          )}
        </View>
        <Text style={[S.rankNum, me && S.rankNumMine]}>{row.rank}</Text>
      </View>

      {/* Manager block */}
      <View style={[S.managerCol, { width: toPct(COL.manager) }]}>
        <TouchableOpacity activeOpacity={0.7}>
          <Text numberOfLines={2} style={[S.teamName, me && S.teamNameMine]}>{row.manager_name}</Text>
        </TouchableOpacity>
        <Text style={[S.managerName, me && S.managerNameMine]}>{row.team_name}</Text>

        <View style={S.chipsRow}>
          {showOR && (
  <View
    style={[
      S.kpiBubble,
      // invert ONLY when it's my highlighted row on dark mode
      me && isDark && {
        backgroundColor: '#ffffff',
        borderColor: 'rgba(255,255,255,0.7)',
      },
   ]}
  >
    <Text
      style={[
        S.kpiBubbleText,
        me && isDark && { color: '#0b0c10' },
      ]}
    >
       <Text style={{ fontWeight: '700' }}>OR</Text> {fmt(row.overall_rank)}
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
              <View key={`${row.entry_id}-${c.key}-wrap`} style={[S.chipHaloThick, { backgroundColor: `${C.accent}33` }]}>
                {chipCore}
              </View>
            ) : (
              chipCore
            );
          })}
        </View>
      </View>

      {/* Yet */}
      <View style={[S.colFixed, { width: toPct(COL.yet) }]}>
        <Text style={[S.fixedNum, me && S.fixedNumMine]}>{row.yet ?? row.played_rem ?? 0}</Text>
      </View>

      {/* Captain / Vice */}
      <View style={[S.colFixed, { width: toPct(COL.cap) }]}>
        <Text numberOfLines={1} style={[S.capMain, me && S.capMainMine]}>{row.captain || ''}</Text>
        <Text numberOfLines={1} style={[S.capSub, me && S.capSubMine]}>{row.vice || ''}</Text>
      </View>

      {/* GW */}
      <View style={[S.colFixed, { width: toPct(COL.gw) }]}>
        {(() => {
          const gwGross = Number(row.gw_gross ?? row.gwgross ?? row.gw ?? 0);
          const gwHits = Number(row.gw_hits ?? row.hits ?? row.hit ?? 0);
          return (
            <View style={S.gwStack}>
              <Text style={[S.gwMain, me && S.gwMainMine]}>{gwGross}</Text>
              {!!gwHits && (
                <Text style={[S.gwHit, { color: badColor }]}>({gwHits > 0 ? `+${gwHits}` : gwHits})</Text>
              )}
            </View>
          );
        })()}
      </View>

      {/* Total + chevron */}
      <View style={[S.totalCol, { width: toPct(COL.total) }]}>
        <Text style={[S.totalNum, me && S.totalNumMine]}>{row.total ?? 0}</Text>
        <MaterialCommunityIcons
          name={expanded ? 'chevron-down' : 'chevron-right'}
          size={22}
          color={me ? '#ffffff' : (C.text ?? '#0f172a')}
        />
      </View>
    </>
  );

  return (
    <Pressable onPress={onToggle} style={{ marginTop: 4 }} android_ripple={{ color: C.border }}>
      {/* SUMMARY HEADER */}
      <View style={[S.rowCard, me && S.rowCardMine]}>
        {me ? (
          <LinearGradient
            colors={['#22d3ee', '#6366f1']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[S.rowHeader, S.rowHeaderMine]}
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
                <MaterialCommunityIcons name="open-in-new" size={12} color={me ? 'black' : C.accent} />

                <Text style={[S.kpiKey, { marginLeft: 2, fontSize: 10 }]}>View Rank</Text>
              </Pressable>

              {SHOW_HEARTS && (
                <Pressable onPress={(e) => { e.stopPropagation?.(); onFav(); }} style={S.heartBtn}>
                  <MaterialCommunityIcons name="heart" size={18} color={fav ? (C.danger ?? '#ef4444') : C.muted} />
                </Pressable>
              )}
            </View>

            {!!transfers.length && (
              <View style={S.transfersRow}>
                {transfers.slice(0, 16).map((t, idx) => (
                  <View
                    key={`${t.out}-${t.in}-${idx}`}
                    style={[
                      S.xferPill,
                      (typeof t.gain === 'number' && t.gain > 0) ? { borderColor: (C.ok ?? '#22c55e') } :
                      (typeof t.gain === 'number' && t.gain < 0) ? { borderColor: (C.danger ?? '#ef4444') } :
                      { borderColor: C.border2 },
                    ]}
                  >
                    <Text style={S.xferOut}>{t.in}</Text>
                    <Text style={S.xferArrow}>→</Text>
                    <Text style={S.xferIn}>{t.out}</Text>
                    {typeof t.gain === 'number' && <Text style={S.xferDiff}> {sign(t.gain)}</Text>}
                  </View>
                ))}
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

            {/* Mini pitch */}
            <RosterGrid roster={row.roster} activeChip={activeChip} C={C} S={S} isDark={isDark} />
          </View>
        </View>
      )}
    </Pressable>
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

const PlayerCell = ({ player, width, activeChip, C, S, isDark }) => {
  const mul = Number(player.mul ?? player.multiplier ?? 1);
  let cap;
  if (player.role === 'v') cap = 'V';
  else if (player.role === 'c' || mul >= 2) {
    const isTC = (activeChip === 'TC' && player.role === 'c') || mul >= 3;
    cap = isTC ? 'TC' : 'C';
  }
  const isBench = player.role === 'b';
  const missed = player.status === 'missed' || Number(player.minutes) === 0;
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
          <View style={[S.capBadge, cap === 'C' ? [S.capBadgeC, { backgroundColor: C.accent }] : S.capBadgeV]}>
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
          status === 'yet' && [S.yet, { backgroundColor: C.accent, color: isDark ? '#0b0c10' : '#0b0c10' }],
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
    page: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 12, paddingTop: 48 },
    center: { alignItems: 'center', justifyContent: 'center' },
    centerRow: { flexDirection: 'row', alignItems: 'center' },
    label: { color: C.ink, marginBottom: 8, fontWeight: '700' },
    muted: { color: C.muted },
    error: { color: C.danger ?? '#ff8b8b' },
    link: { color: C.accent, fontWeight: '700' },

    /** Toolbar */
    toolbarRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 8,
    },

    /** Select */
    select: {
      height: 44, borderRadius: 12, borderWidth: 1, borderColor: C.border,
      backgroundColor: C.card, paddingHorizontal: 12,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: 0,
    },
    selectText: { color: C.ink, fontSize: 12 },
    placeholder: { color: C.muted },

    /** Small icon button (cog) */
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

    /** THEAD (sticky) */
    thead: {
      backgroundColor: isDark ? '#0f172a' : '#eaf0ff',
      paddingTop: 6, paddingBottom: 8, marginVertical: 4,
      borderBottomWidth: 1, borderColor: C.border2,
    },
    theadTitle: { color: C.ink, textAlign: 'center', fontWeight: '700', marginBottom: 6 },
    colHeadRow: { flexDirection: 'row', alignItems: 'center' },
    th: { color: C.ink, fontWeight: '800' },
    thCell: { paddingVertical: 6, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center' },
    thCenter: { justifyContent: 'center' },
    thStart: { justifyContent: 'flex-start' },
    thPress: { flexDirection: 'row', alignItems: 'center', gap: 4 },
thActive: { textDecorationLine: 'underline', color: C.ink },

    /** Row card */
    rowCard: {
      backgroundColor: C.card,
      borderRadius: RADIUS,
      borderWidth: 1,
      borderColor: C.border,
      overflow: 'hidden',
    },
    rowCardMine: {
      borderColor: C.accent,
      shadowColor: C.accent,
      shadowOpacity: 0.25,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 0 },
      elevation: 3,
    },

    rowHeader: { flexDirection: 'row', alignItems: 'stretch', paddingHorizontal: 10, paddingVertical: 6 },
    rowHeaderMine: {
      borderRadius: RADIUS,
      shadowColor: 'rgba(0,0,0,0.35)',
      shadowOpacity: 1,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2,
    },

    rankWrap: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
    arrowBlock: { alignItems: 'center', justifyContent: 'center' },
    rankArrow: { width: 14, height: 14, resizeMode: 'contain' },
    deltaTiny: { fontSize: 6, lineHeight: 10, fontWeight: '800', marginTop: 1 },

    rankNum: { color: C.text ?? '#111827', fontWeight: '700' },
    rankNumMine: { color: C.ink },

    managerCol: { minWidth: 0, paddingHorizontal: 6 },
    teamName: { color: C.text ?? '#111827', fontWeight: '700', fontSize: 11 },
    teamNameMine: { color: C.ink },
    managerName: { color: C.muted, marginTop: 2, fontSize: 10 },
    managerNameMine: { color: C.ink },

    chipsRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 0, flexWrap: 'nowrap' },
    chip: {
      paddingHorizontal: 2, paddingVertical: 0,
      borderRadius: 5, backgroundColor: isDark ? '#0f1525' : '#f5f6fb', borderWidth: 1, borderColor: C.border2,
    },
    chipText: { color: C.text ?? '#111827', fontSize: 10 },
    chipActive: {
      shadowColor: C.accent,
      shadowOpacity: 0.35,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 0 },
      elevation: 2,
    },
    chipHaloThick: { padding: 4, borderRadius: 999, backgroundColor: `${C.accent}28` },
    chipDot: {
      position: 'absolute', top: -3, right: -3, width: 8, height: 8, borderRadius: 4,
      borderWidth: 2,
      shadowColor: `${C.accent}33`, shadowOpacity: 1, shadowRadius: 3, shadowOffset: { width: 0, height: 0 },
    },
    chipUsed: { opacity: 0.85 },
    chipUsedText: { color: C.muted, textDecorationLine: 'line-through' },

    kpiBubble: { paddingHorizontal: 2, paddingVertical: 3, borderRadius: 999, backgroundColor: isDark ? '#0f1525' : '#eef2ff', borderWidth: 1, borderColor: C.border2 },
    kpiBubbleText: { fontSize: 10, color: C.text ?? '#111827' },

    colFixed: { alignItems: 'center', justifyContent: 'center' },
    fixedNum: { color: C.text ?? '#111827' },
    fixedNumMine: { color: C.ink },

    capMain: { color: C.text ?? '#111827', fontWeight: '700', fontSize: 12 },
    capMainMine: { color: C.ink },
    capSub: { color: C.muted, fontSize: 10, marginTop: 2 },
    capSubMine: { color: C.ink },

    totalCol: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
    totalNum: { color: C.text ?? '#111827', fontWeight: '700', marginRight: 2 },
    totalNumMine: { color: C.ink },

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
      alignSelf: 'flex-start', flexShrink: 0, margin: 3,
    },
    xferOut: { color: C.ink, fontWeight: '700', fontSize: 12 },
    xferArrow: { color: C.muted, marginHorizontal: 4 },
    xferIn: { color: C.ink, fontWeight: '700', fontSize: 12 },
    xferDiff: { color: C.muted, fontSize: 12, marginLeft: 4, opacity: 0.8 },
    xferTotal: { marginLeft: 6, fontWeight: '800' },

    gwStack: { flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
    gwMain: { color: C.text ?? '#111827', fontWeight: '700', fontSize: 13 },
    gwMainMine: { color: C.ink },
    gwHit: { marginLeft: 4, fontSize: 12, fontWeight: '700' },

    /** Mini pitch */
    pitchWrap: { marginTop: 10, borderRadius: 12, overflow: 'hidden', backgroundColor: isDark ? '#0b1224' : '#e7edf9', borderWidth: 1, borderColor: C.border2 },
    pitchBg: { width: '100%', paddingVertical: 10 },
    pitchImg: { opacity: isDark ? 0.35 : 0.2 },
    pitchRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 },

    /** Top bar */
   topBar: {
   height: 44,
   paddingHorizontal: 12,
   alignItems: 'center',
   flexDirection: 'row',
   justifyContent: 'center',

  backgroundColor: '#0b0c10',         // always dark (same as other screens)
  borderBottomWidth: 1,
  borderBottomColor: '#1f2937',       // subtle divider
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
    capBadgeC: {},
    capBadgeV: { backgroundColor: isDark ? '#c7d2fe' : '#e0e7ff', borderColor: '#4f46e5' },
    capBadgeTxt: { fontSize: 10, fontWeight: '800', color: '#0b0c10' },

    cellName: { marginTop: 4, width: '100%', textAlign: 'center', color: C.ink, fontSize: 8, fontWeight: '700' },

    played: { backgroundColor: isDark ? '#e2e8f0' : '#ffffff', color: '#0b0c10' },
    live: { backgroundColor: isDark ? '#fde68a' : '#f59e0b', color: '#0b0c10' },
    missed: { backgroundColor: C.danger ?? '#ef4444', color: '#ffffff' },
    yet: { backgroundColor: C.accent, color: '#0b0c10' },
    benched: { backgroundColor: isDark ? '#111827' : '#d1d5db', color: isDark ? '#e5e7eb' : '#111827' },

    thCell: { paddingVertical: 6, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center' },

    cellPts: {
      marginTop: 2, width: '100%', textAlign: 'center', paddingVertical: 1, borderRadius: 6, overflow: 'hidden',
      fontSize: 10, fontWeight: '800', color: isDark ? '#0b0c10' : '#0b0c10',
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
      backgroundColor: isDark ? '#121826' : '#f8fafc', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.border2,
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
  });

export default League;
