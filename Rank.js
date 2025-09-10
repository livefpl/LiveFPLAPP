// rank.js — clean (no metrics/interstitials)
import InfoBanner from './InfoBanner';
import AppHeader from './AppHeader';

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Image,
  ImageBackground,
  Dimensions,
  ScrollView,
  TouchableOpacity,
  Modal,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { useFplId } from './FplIdContext';
import { FontAwesome, MaterialCommunityIcons } from '@expo/vector-icons';

import StatsStrip from './StatsStrip';
import SettingsModal from './SettingsModal';
import { clubCrestUri, assetImages } from './clubs';
import { smartFetch } from './signedFetch';
import { useColors } from './theme';

// -------- Layout helpers --------
const CACHE_TTL_MS = 30_000; // 30s cache
const rem = Dimensions.get('window').width / 380;
const vrem = Dimensions.get('window').height / 380;
const imgwidth = rem * 55;
const imgheight = 12;

// Unified shirt sizing/positions
const SHIRT_SCALE = 0.7; // tune once for both platforms
const SHIRT_ASPECT = 5.6 / 5; // width / height
const PLAYER_IMAGE_WIDTH = (imgwidth * SHIRT_SCALE * vrem) / 2.2;
const PLAYER_IMAGE_HEIGHT = PLAYER_IMAGE_WIDTH / SHIRT_ASPECT;
const CAP_TOP = PLAYER_IMAGE_HEIGHT * 0.34; // badge circle vertical position
const EMOJI_TOP = PLAYER_IMAGE_HEIGHT * 0.35; // emoji vertical position

// Lock the pitch height cross-platform and derive row height
const PITCH_RATIO = 540 / 405;
const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;
let PITCH_HEIGHT = Math.min(SCREEN_W * PITCH_RATIO, SCREEN_H * 0.8);
PITCH_HEIGHT = SCREEN_H * 0.65;
const ROW_HEIGHT = Math.floor(PITCH_HEIGHT / 5);

// ---------- Helpers that don't need styles ----------
function getEventCounts(pl) {
  const counts = {
    goals_scored: 0,
    assists: 0,
    yellow_cards: 0,
    red_cards: 0,
    clean_sheets: 0,
    saves: 0,
    bonus: 0,
    defensive_contribution: 0,
  };
  (pl.stats || []).forEach(([raw, c]) => {
    const key = String(raw).toLowerCase();
    if (key in counts) counts[key] += Number(c) || 0;
  });
  return counts;
}

function find_emoji(s) {
  const d = { d: '🎲', t: '😴', s: '🕵', ds: '⭐', '': '', f: '🔥', sub: '🔃' };
  return d[s] || '';
}
function find_status(s) {
  const d = { y: 'yet', m: 'missed', d: 'played', l: 'live' };
  return d[s] || 'played';
}

const FootballLineupWithImages = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const viewFplId = route?.params?.viewFplId;
  const { fplId, triggerRefetch } = useFplId();
  const C = useColors();

  // Theme-aware styles inside component
  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, alignItems: 'center', width: '100%', justifyContent: 'center', paddingTop: 28 },

        loadingOverlay: {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.35)',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 999,
        },
        loadingCard: {
          backgroundColor: C.card,
          borderWidth: 1,
          borderColor: C.border,
          borderRadius: 12,
          paddingVertical: 14,
          paddingHorizontal: 16,
          minWidth: 180,
          alignItems: 'center',
        },
        loadingText: { marginTop: 8, color: 'white', fontWeight: '600' },

        pitchBg: {
          position: 'relative',
          width: '100%',
          height: PITCH_HEIGHT,
          justifyContent: 'space-evenly',
          paddingBottom: 8,
        },

        firstLineupContainer: {
          flexDirection: 'row',
          justifyContent: 'space-evenly',
          alignItems: 'center',
          width: '100%',
          height: ROW_HEIGHT,
        },
        lineupContainer: {
          flexDirection: 'row',
          justifyContent: 'space-evenly',
          alignItems: 'center',
          width: '100%',
          height: ROW_HEIGHT,
        },

        positionContainer: { alignItems: 'center', width: '20%', marginBottom: '2%', marginTop: '2%' },
        playerContainer: { alignItems: 'center' },

        playerImage: { width: PLAYER_IMAGE_WIDTH, height: undefined, aspectRatio: SHIRT_ASPECT, resizeMode: 'contain' },

        settingsButton: { padding: 6, borderRadius: 8 },
        switch: {
          position: 'absolute',
          top: 22 * vrem,
          left: 15 * rem,
          borderRadius: 6,
          zIndex: 1,
          alignItems: 'center',
          flexDirection: 'column',
        },

        scoresheet: {
          backgroundColor: C.card,
          borderWidth: 1,
          borderColor: C.border,
          position: 'absolute',
          top: 25 * vrem,
          right: 7 * rem,
          borderRadius: 6,
          justifyContent: 'center',
          paddingVertical: 4,
          paddingHorizontal: 6,
          alignItems: 'center',
        },
        scoresheetMain: { fontSize: 12 * rem, marginTop: 7 * rem, fontWeight: 'bold', textAlign: 'center', color: 'white' },
        scoresheetSub: { fontSize: 10 * rem, marginTop: 7 * rem, textAlign: 'center', color: 'white' },

        centeredView: { flex: 1, justifyContent: 'center', alignItems: 'center', marginTop: 7 * vrem },
        modalView: {
          margin: 20,
          backgroundColor: C.card,
          color: 'white',
          borderRadius: 20,
          padding: 20,
          alignItems: 'center',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.25,
          shadowRadius: 4,
          elevation: 5,
          borderWidth: 1,
          borderColor: C.border,
        },
        modalTitle: { marginBottom: 15, textAlign: 'center', fontSize: 20, fontWeight: 'bold', color: 'white' },
        button: { borderRadius: 20, padding: 10, backgroundColor: '#2196F3' },
        textStyle: { color: 'white', fontWeight: 'bold', textAlign: 'center' },

        statsHeader: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          paddingHorizontal: 10,
          paddingVertical: 5,
          backgroundColor: C.card,
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8,
          borderWidth: 1,
          borderColor: C.border,
          color: 'white',
        },
        statRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          width: 300,
          padding: 10,
          borderBottomWidth: 1,
          borderBottomColor: C.border,
        },
        headerText: { flex: 1, textAlign: 'center', fontWeight: 'bold', fontSize: 16, color: 'white' },
        statName: { flex: 1, fontSize: 12, color: 'white' },
        statValue: { flex: 1, textAlign: 'center', fontSize: 14, color: 'white' },

        emoji: { position: 'absolute', left: -6 * rem, top: EMOJI_TOP },
        cap: {
          position: 'absolute',
          top: CAP_TOP,
          right: -6 * rem,
          backgroundColor: 'black',
          width: 16 * rem,
          height: 16 * rem,
          borderRadius: 8 * rem,
          justifyContent: 'center',
          alignItems: 'center',
        },
        capText: { color: 'white', fontSize: 12 * rem, lineHeight: 16 * rem },

        topRounded: { borderTopLeftRadius: 4, borderTopRightRadius: 4, overflow: 'hidden' },
        bottomRounded: { borderBottomLeftRadius: 4, borderBottomRightRadius: 4, overflow: 'hidden' },

        managerName: { fontSize: 16, fontWeight: '600', marginTop: 0, marginBottom: 0, color: 'white', textAlign: 'center' },

        EOs: { flexDirection: 'row', width: imgwidth, alignSelf: 'center' },
        EOsRow: { overflow: 'hidden' },
        EO1: {
          fontSize: 9,
          lineHeight: 12,
          includeFontPadding: false,
          backgroundColor: 'white',
          color: 'black',
          width: imgwidth / 2,
          textAlign: 'center',
          overflow: 'hidden',
        },
        EO2: {
          fontSize: 9,
          lineHeight: 12,
          includeFontPadding: false,
          backgroundColor: 'lightgreen',
          color: 'black',
          width: imgwidth / 2,
          textAlign: 'center',
          overflow: 'hidden',
        },

        eventsSlot: { minHeight: 18, justifyContent: 'center', alignItems: 'center' },
        eventsChip: {
          alignSelf: 'center',
          paddingHorizontal: 0,
          paddingVertical: 2,
          borderRadius: 10,
          backgroundColor: 'rgba(255,255,255,0.04)',
        },
        eventsIconsRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' },
        cardYellow: { width: 10, height: 14, borderRadius: 2, backgroundColor: '#ffd400', borderWidth: 0.5, borderColor: '#333' },
        cardRed: { width: 10, height: 14, borderRadius: 2, backgroundColor: '#e11d48', borderWidth: 0.5, borderColor: '#333' },
        assistPill: { backgroundColor: 'white', borderRadius: 6, paddingHorizontal: 4, paddingVertical: 1, borderWidth: 0.5, borderColor: '#ccc' },
        assistText: { fontSize: 10, fontWeight: '700' },

        arrow: { width: 12 * rem, height: 12 * rem, marginBottom: 20 },

        playerName: {
          fontSize: 10,
          lineHeight: imgheight,
          includeFontPadding: false,
          fontWeight: 'bold',
          marginTop: 0,
          marginBottom: 0,
          backgroundColor: 'black',
          color: 'white',
          width: imgwidth,
          textAlign: 'center',
          overflow: 'hidden',
        },

        played: {
          fontSize: 11,
          lineHeight: imgheight,
          includeFontPadding: false,
          width: imgwidth,
          textAlign: 'center',
          overflow: 'hidden',
          backgroundColor: 'white',
          color: 'black',
        },
        live: {
          fontSize: 11,
          lineHeight: imgheight,
          includeFontPadding: false,
          width: imgwidth,
          textAlign: 'center',
          overflow: 'hidden',
          backgroundColor: 'orange',
          color: 'black',
        },
        missed: {
          fontSize: 11,
          lineHeight: imgheight,
          includeFontPadding: false,
          width: imgwidth,
          textAlign: 'center',
          overflow: 'hidden',
          backgroundColor: 'red',
          color: 'white',
        },
        yet: {
          fontSize: 11,
          lineHeight: imgheight,
          includeFontPadding: false,
          width: imgwidth,
          textAlign: 'center',
          overflow: 'hidden',
          backgroundColor: '#1e9770',
          color: 'white',
        },

        eoLegendInline: { marginLeft: 8, alignItems: 'center' },
        eoLegendCell: { fontSize: 7, lineHeight: 14 },

        badgecontainer: {
          width: '100%',
          backgroundColor: C.card,
          borderTopWidth: 0,
          borderBottomWidth: 0,
          borderColor: C.border,
          flexDirection: 'row',
          justifyContent: 'space-around',
          alignItems: 'center',
          paddingVertical: 10 * rem,
          minHeight: 70 * rem,
          marginTop: 35 * vrem,
        },
      }),
    [C]
  );

  // Components that need styles are defined INSIDE the function
  const EventIcon = ({ type, count }) => {
    if (!count) return null;
    const wrap = { flexDirection: 'row', alignItems: 'center', marginHorizontal: 2 };
    const txt = { fontSize: 10, marginLeft: 2 };
    const Count = () => (count > 1 ? <Text style={txt}>{count}</Text> : null);

    switch (type) {
      case 'goals_scored':
        return (
          <View style={wrap}>
            <MaterialCommunityIcons name="soccer" size={12} />
            <Count />
          </View>
        );
      case 'assists':
        return (
          <View style={[wrap, styles.assistPill]}>
            <Text style={styles.assistText}>A</Text>
            <Count />
          </View>
        );
      case 'yellow_cards':
        return (
          <View style={wrap}>
            <View style={styles.cardYellow} />
          </View>
        );
      case 'red_cards':
        return (
          <View style={wrap}>
            <View style={styles.cardRed} />
          </View>
        );
      case 'clean_sheets':
        return (
          <View style={wrap}>
            <MaterialCommunityIcons name="shield-check" size={12} />
          </View>
        );
      case 'saves':
        return (
          <View style={wrap}>
            <MaterialCommunityIcons name="hand-back-right" size={12} />
            <Count />
          </View>
        );
      case 'bonus':
        return (
          <View style={wrap}>
            <MaterialCommunityIcons name="star" size={12} />
            <Count />
          </View>
        );
      case 'defensive_contribution':
        return (
          <View style={wrap}>
            <MaterialCommunityIcons name="lock" size={12} />
          </View>
        );
      default:
        return null;
    }
  };

  const EventsRow = ({ counts }) => {
    const sum =
      counts.goals_scored +
      counts.assists +
      counts.yellow_cards +
      counts.red_cards +
      counts.clean_sheets +
      counts.saves +
      counts.bonus +
      counts.defensive_contribution;

    if (!sum) return null;

    return (
      <View style={styles.eventsChip}>
        <View style={styles.eventsIconsRow}>
          <EventIcon type="goals_scored" count={counts.goals_scored} />
          <EventIcon type="assists" count={counts.assists} />
          <EventIcon type="yellow_cards" count={counts.yellow_cards} />
          <EventIcon type="red_cards" count={counts.red_cards} />
          <EventIcon type="clean_sheets" count={counts.clean_sheets} />
          <EventIcon type="saves" count={counts.saves} />
          <EventIcon type="bonus" count={counts.bonus} />
          <EventIcon type="defensive_contribution" count={counts.defensive_contribution} />
        </View>
      </View>
    );
  };

  const [info, setInfo] = useState({
    Points: '',
    Pointsfinal: 0,
    Newrank: '',
    arrow: 'same',
    GWrank: '',
    Safety: 0,
    Ranksubs: undefined,
    Ranknosubs: undefined,
    diffpercent: '',
    diffpercentsubs: '',
    diffpercentnosubs: '',
    arrowsubs: 'same',
    arrownosubs: 'same',
    gw: '',
  });

  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [settingsmodalVisible, setsettingsModalVisible] = useState(false);
  const [displaySettings, setDisplaySettings] = useState({
    showEOs: true,
    showEvents: true,
    includeSubs: false,
    showManagerName: true,
  });

  const [modalVisible, setModalVisible] = useState(false);
  const [selectedPlayerStats, setSelectedPlayerStats] = useState([]);
  const [selectedPlayerName, setSelectedPlayerName] = useState('');

  const handlePressPlayer = (player) => {
    setSelectedPlayerName(player.name);
    setSelectedPlayerStats(player.stats || []);
    setModalVisible(true);
  };

  const renderStatsTable = (stats) => {
    if (!stats || stats.length === 0) return <Text>No stats available</Text>;
    return (
      <View>
        <View style={styles.statsHeader}>
          <Text style={[styles.headerText, { color: C.ink }]}>Event</Text>
          <Text style={[styles.headerText, { color: C.ink }]}>Count</Text>
          <Text style={[styles.headerText, { color: C.ink }]}>Points</Text>
        </View>
        {stats.map((item, index) => (
          <View key={index} style={styles.statRow}>
            <Text style={[styles.statName, { color: C.ink }]} numberOfLines={1} ellipsizeMode="tail">
              {String(item[0]).replace('_', ' ').toUpperCase()}
            </Text>
            <Text style={[styles.statValue, { color: C.ink }]}>{item[1]}</Text>
            <Text style={[styles.statValue, { color: C.ink }]}>{item[2]}</Text>
          </View>
        ))}
      </View>
    );
  };

  const pickPayload = (json, id) => {
    if (!json) return null;
    if (json[id]) return json[id];
    if (json[String(id)]) return json[String(id)];
    const keys = Object.keys(json);
    if (keys.length === 1 && typeof json[keys[0]] === 'object') {
      return json[keys[0]];
    }
    return json;
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const effectiveId = viewFplId || (await AsyncStorage.getItem('fplId')) || fplId;

      if (!effectiveId) {
        navigation.navigate('Change ID');
        setLoading(false);
        return;
      }

      const now = Date.now();
      let payload = null;

      // Only read/write cache when not viewing override
      if (!viewFplId) {
        const cached = await AsyncStorage.getItem('fplData');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed?.timestamp && now - parsed.timestamp < CACHE_TTL_MS && parsed.id === effectiveId) {
            payload = parsed.data;
          }
        }
      }

      if (!payload) {
        const resp = await smartFetch(
          `https://livefpl-api-489391001748.europe-west4.run.app/LH_api/${effectiveId}`
        );
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();
        payload = pickPayload(json, effectiveId);

        // Save my exposure map: element id -> multiplier (0/1/2/3)
        try {
          const exposure = {};
          for (const p of payload?.team ?? []) {
            const id = Number(p?.fpl_id ?? p?.element ?? p?.id ?? p?.code);
            if (!id) continue;
            const role = String(p?.role ?? '').toLowerCase();
            let mul = 0;
            if (role === 'b') mul = 0;
            else if (role === 'tc') mul = 3;
            else if (role === 'c') mul = 2;
            else mul = 1;
            exposure[id] = mul;
          }
          await AsyncStorage.setItem('myExposure', JSON.stringify(exposure));
        } catch {}

        const localGroup = Number(payload?.local ?? payload?.Local ?? payload?.local_group ?? payload?.group);
        if (localGroup) {
          try {
            await AsyncStorage.setItem('localGroup', String(localGroup));
          } catch {}
        }

        if (!viewFplId) {
          await AsyncStorage.setItem('fplData', JSON.stringify({ data: payload, timestamp: now, id: effectiveId }));
        }
      }

      const live = Number(payload?.live_points ?? 0);
      const bench = Number(payload?.bench_points ?? 0);
      const hit = Number(payload?.hit ?? 0);
      const livePlusBench = live + bench;
      const pointsfinal = livePlusBench + hit;

      const includeVal = Boolean(payload?.aut ?? displaySettings.includeSubs);
      setDisplaySettings((prev) => ({ ...prev, includeSubs: includeVal }));

      const displayRank = includeVal ? payload?.post_rank ?? payload?.displayrank : payload?.pre_rank ?? payload?.displayrank;

      const arrowDirection =
        (displayRank ?? 0) > (payload?.old_rank ?? 0)
          ? 'down'
          : (payload?.old_rank ?? 0) > (displayRank ?? 0)
          ? 'up'
          : 'same';

      const difference = pointsfinal - Number(payload?.safety ?? 0);
      const subText = `${Math.abs(difference)} ${difference >= 0 ? 'above' : 'below'} safety`;

      const safeDiv = (n, d) => (d ? (n * 100) / d : 0);
      const diffrank = -(displayRank ?? 0) + (payload?.old_rank ?? 0);
      const diffpercent = safeDiv(diffrank, payload?.old_rank ?? 0).toFixed(2);
      const diffpercentText = `Old: ${(payload?.old_rank ?? 0).toLocaleString()} (${Number(diffpercent) > 0 ? '+' : ''}${diffpercent}%)`;

      const diffranksubs = -(payload?.post_rank ?? 0) + (payload?.old_rank ?? 0);
      const diffpercentsubs = safeDiv(diffranksubs, payload?.old_rank ?? 0).toFixed(2);
      const diffpercentsubsText = `Old: ${(payload?.old_rank ?? 0).toLocaleString()} (${Number(diffpercentsubs) > 0 ? '+' : ''}${diffpercentsubs}%)`;

      const diffranknosubs = -(payload?.pre_rank ?? 0) + (payload?.old_rank ?? 0);
      const diffpercentnosubs = safeDiv(diffranknosubs, payload?.old_rank ?? 0).toFixed(2);
      const diffpercentnosubsText = `Old: ${(payload?.old_rank ?? 0).toLocaleString()} (${Number(diffpercentnosubs) > 0 ? '+' : ''}${diffpercentnosubs}%)`;

      const arrowsubs =
        (payload?.post_rank ?? 0) > (payload?.old_rank ?? 0)
          ? 'down'
          : (payload?.old_rank ?? 0) > (payload?.post_rank ?? 0)
          ? 'up'
          : 'same';

      const arrownosubs =
        (payload?.pre_rank ?? 0) > (payload?.old_rank ?? 0)
          ? 'down'
          : (payload?.old_rank ?? 0) > (payload?.pre_rank ?? 0)
          ? 'up'
          : 'same';

      setInfo({
        diffrank,
        diffpercent: diffpercentText,
        subsafety: subText,
        Pointsfinal: pointsfinal,
        Hit: hit,
        Points: `${livePlusBench}(${hit})=${pointsfinal}`,
        Newrank: displayRank,
        arrow: arrowDirection,
        Safety: Number(payload?.safety ?? 0),
        Ranksubs: payload?.post_rank,
        Ranknosubs: payload?.pre_rank,
        diffpercentsubs: diffpercentsubsText,
        diffpercentnosubs: diffpercentnosubsText,
        arrowsubs,
        arrownosubs,
        GWrank: payload?.GWrank,
        gw: payload?.gw,
        manager: payload?.manager ?? '',
      });

      const playersData = (payload?.team ?? []).map((player) => {
        const EO1p = Number(player?.EO1 ?? 0) * 100;
        const EO2p = Number(player?.EO2 ?? 0) * 100;
        const fmt = (x) => (x > 0 ? Math.round(x) : x.toFixed(1));
        const role = player?.role;
        const isBench = role === 'b';
        const pos = isBench ? 'Bench' : Number(player?.position ?? 0);
        const statsFiltered = (player?.stats ?? []).filter((stat) => String(stat[0]).toLowerCase() !== 'bps');

        return {
          key: String(player?.code ?? player?.fpl_id ?? player?.name),
          name: String(player?.name ?? ''),
          position: pos,
          team: Number(player?.club ?? 0),
          EO: fmt(EO1p),
          EO2: fmt(EO2p),
          Emoji: find_emoji(player?.emoji ?? ''),
          Status: find_status(player?.status ?? 'd'),
          Points: Number(player?.points ?? 0),
          Cap: !isBench && role !== 's' ? role : '',
          imageUri: clubCrestUri(player?.club ?? 1),
          stats: statsFiltered,
        };
      });
      setPlayers(playersData);
    } catch (e) {
      console.error('Failed to fetch data:', e);
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [fplId, navigation, displaySettings.includeSubs, viewFplId]);

  useEffect(() => {
    fetchData();
  }, [fetchData, triggerRefetch]);

  useFocusEffect(
    useCallback(() => {
      // no-op now; kept for parity if you pass viewFplId in route
    }, [route?.params?.viewFplId])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData().finally(() => setRefreshing(false));
  };

  const playersWithStats = players;
  const goalkeepers = playersWithStats.filter((p) => p.position === 1);
  const defenders = playersWithStats.filter((p) => p.position === 2);
  const midfielders = playersWithStats.filter((p) => p.position === 3);
  const forwards = playersWithStats.filter((p) => p.position === 4);
  const bench = playersWithStats.filter((p) => p.position === 'Bench');
  const items = [goalkeepers, defenders, midfielders, forwards, bench];
  const effectiveIdForLink = useMemo(() => {
    const override = route?.params?.viewFplId;
    return (override && String(override)) || (fplId && String(fplId)) || null;
  }, [route?.params?.viewFplId, fplId]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView
        style={{ backgroundColor: C.bg }}
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <View style={styles.container}>
          <Modal animationType="slide" transparent visible={modalVisible} onRequestClose={() => setModalVisible(false)}>
            <View style={styles.centeredView}>
              <View style={styles.modalView}>
                <Text style={[styles.modalTitle, { color: C.ink }]}>{selectedPlayerName}</Text>
                {renderStatsTable(selectedPlayerStats)}
                <TouchableOpacity style={styles.button} onPress={() => setModalVisible(false)}>
                  <Text style={styles.textStyle}>Hide Stats</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>

          <View style={styles.container}>
            <InfoBanner
              text="Full extended info available at"
              link={`www.livefpl.net/${effectiveIdForLink ? effectiveIdForLink : ''}`}
            />
            <View style={{ width: '100%', paddingHorizontal: 12, marginBottom: 6 }}>
              <StatsStrip
                items={[
                  { title: `GW${info.gw} Rank`, value: info.GWrank },
                  {
                    title: 'Live Rank',
                    value: displaySettings.includeSubs ? info.Ranksubs : info.Ranknosubs,
                    icon: assetImages[displaySettings.includeSubs ? info.arrowsubs : info.arrownosubs],
                    sub: displaySettings.includeSubs ? info.diffpercentsubs : info.diffpercentnosubs,
                    flex: 1.3,
                  },
                  { title: 'Points', value: info.Points, sub: info.subsafety },
                ]}
              />
            </View>

            {displaySettings.showManagerName && info.manager ? (
              <Text style={[styles.managerName, { color: C.ink }]}>Manager: {info.manager}</Text>
            ) : null}

            <ImageBackground source={assetImages.pitch} style={styles.pitchBg}>
              <View style={styles.switch}>
                <TouchableOpacity onPress={() => setsettingsModalVisible(true)} style={styles.settingsButton}>
                  <FontAwesome name="cog" size={25} color={'black'} />
                </TouchableOpacity>

                {/* EO legend (inline next to cog; hides when EOs are hidden) */}
                {displaySettings.showEOs && (
                  <View style={styles.eoLegendInline}>
                    <View
                      style={[styles.EOs, styles.EOsRow, styles.bottomRounded, { borderRadius: 6, overflow: 'hidden' }]}
                    >
                      <Text
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        allowFontScaling={false}
                        style={[styles.EO1, styles.eoLegendCell]}
                      >
                        Near U
                      </Text>
                      <Text
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        allowFontScaling={false}
                        style={[styles.EO2, styles.eoLegendCell]}
                      >
                        Top10k
                      </Text>
                    </View>
                  </View>
                )}

                <SettingsModal
                  visible={settingsmodalVisible}
                  onClose={() => setsettingsModalVisible(false)}
                  displaySettings={displaySettings}
                  setDisplaySettings={setDisplaySettings}
                />
              </View>

              <View style={styles.scoresheet}>
                <Text style={[styles.scoresheetMain, { color: C.ink }]}>{info.Points}</Text>
                <Text style={[styles.scoresheetSub, { color: C.ink }]}>
                  {displaySettings.includeSubs ? (
                    <>
                      {info.Ranksubs?.toLocaleString?.()}{' '}
                      <Image source={assetImages[info.arrowsubs]} style={styles.arrow} />
                    </>
                  ) : (
                    <>
                      {info.Ranknosubs?.toLocaleString?.()}{' '}
                      <Image source={assetImages[info.arrownosubs]} style={styles.arrow} />
                    </>
                  )}
                </Text>
              </View>

              {items.map((item, rowIdx) => {
                const containerStyle =
                  rowIdx === 0 && items[4].length === 0 ? styles.firstLineupContainer : styles.lineupContainer;

                return (
                  <View key={`row-${rowIdx}`} style={containerStyle}>
                    {item.map((player) => {
                      const counts = getEventCounts(player);

                      return (
                        <View style={styles.positionContainer} key={player.key}>
                          <View style={styles.playerContainer}>
                            <TouchableOpacity onPress={() => handlePressPlayer(player)}>
                              <Image source={{ uri: player.imageUri }} style={styles.playerImage} />
                            </TouchableOpacity>

                            <Text style={styles.emoji}>{player.Emoji}</Text>

                            {!!player.Cap && (
                              <View style={styles.cap}>
                                <Text style={styles.capText}>{player.Cap}</Text>
                              </View>
                            )}

                            {/* Player name with top-rounded corners */}
                            <Text
                              numberOfLines={1}
                              ellipsizeMode="tail"
                              allowFontScaling={false}
                              style={[styles.playerName, styles.topRounded]}
                            >
                              {player.name}
                            </Text>

                            {/* Points (rounded bottom if EOs hidden) */}
                            <Text
                              numberOfLines={1}
                              ellipsizeMode="tail"
                              allowFontScaling={false}
                              style={[styles[player.Status], !displaySettings.showEOs && styles.bottomRounded]}
                            >
                              {player.Points}
                            </Text>

                            {/* EOs (rounded bottom if showing) */}
                            {displaySettings.showEOs && (
                              <View style={[styles.EOs, styles.EOsRow, styles.bottomRounded]}>
                                <Text numberOfLines={1} ellipsizeMode="tail" allowFontScaling={false} style={styles.EO1}>
                                  {player.EO}%
                                </Text>
                                <Text numberOfLines={1} ellipsizeMode="tail" allowFontScaling={false} style={styles.EO2}>
                                  {player.EO2}%
                                </Text>
                              </View>
                            )}

                            {/* Events chip (icons) */}
                            <View style={styles.eventsSlot}>{displaySettings.showEvents && <EventsRow counts={counts} />}</View>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                );
              })}
            </ImageBackground>
          </View>
        </View>

        {loading && !refreshing && (
          <View style={styles.loadingOverlay}>
            <View style={styles.loadingCard}>
              <ActivityIndicator size="large" />
              <Text style={[styles.loadingText, { color: C.ink }]}>Loading latest data…</Text>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
};

export default FootballLineupWithImages;
