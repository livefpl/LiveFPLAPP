// PlayerInfoModal.js — centered modal, compact UI, FDR chips, xGC, DC + bonus tag, minutes chip, GW-first Recent, crest in Upcoming, xG toggle
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Image,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import useCachedJson from './useCachedJson';
import { useColors } from './theme';
import { clubCrestUri } from './clubs';

const ONE_HOUR = 3600_000;

/* ---------- Compact scale ---------- */
const SCALE = 0.88;
const S = (x) => Math.round(x * SCALE);

/* ---------- Layout sizing (compact) ---------- */
const H_FIXTURE_ROW = S(44);
const H_RECENT_ROW  = S(92);
const V_GAP         = S(6);
const CAP_N         = 5;

/* ---------- Chip sizing (fixed but compact) ---------- */
const CHIP_W = S(64);
const CHIP_H = S(22);
const CHIP_RADIUS = S(11);

/* ---------- Team short mapping ---------- */
const TEAM_SHORT_MAP = {
  'Arsenal': 'ARS','Aston Villa': 'AVL','Bournemouth': 'BOU','AFC Bournemouth': 'BOU',
  'Brentford': 'BRE','Brighton': 'BHA','Brighton and Hove Albion': 'BHA','Chelsea': 'CHE',
  'Crystal Palace': 'CRY','Everton': 'EVE','Fulham': 'FUL','Ipswich Town': 'IPS',
  'Leeds United': 'LEE','Leicester City': 'LEI','Liverpool': 'LIV','Luton Town': 'LUT',
  'Manchester City': 'MCI','Man City': 'MCI','Manchester United': 'MUN','Man Utd': 'MUN',
  'Newcastle United': 'NEW',"Nott'm Forest": 'NFO','Sheffield United': 'SHU',
  'Southampton': 'SOU','Tottenham Hotspur': 'TOT','Spurs': 'TOT','West Ham United': 'WHU',
  'West Ham': 'WHU','Wolverhampton Wanderers': 'WOL','Wolves': 'WOL','Burnley': 'BUR',
  'West Bromwich Albion': 'WBA','Sunderland': 'SUN',
};

function toShort(teamName) {
  if (!teamName) return '';
  if (TEAM_SHORT_MAP[teamName]) return TEAM_SHORT_MAP[teamName];
  const simple = teamName.replace(/[^A-Z]/gi, ' ').trim().split(/\s+/).map(w=>w[0]).join('').toUpperCase();
  if (simple.length >= 2 && simple.length <= 4) return simple;
  return teamName.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
}

/* ---------- color helpers ---------- */
function parseHex(hex) {
  if (!hex) return null;
  const s = String(hex).trim();
  const m = s.match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const h = m[1];
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}
function luminanceRgb([r, g, b]) {
  const [R, G, B] = [r, g, b].map((v) => v / 255);
  return 0.2126*R + 0.7152*G + 0.0722*B;
}
function rgbToCss([r, g, b]) {
  const clamp = (x) => Math.max(0, Math.min(255, Math.round(x)));
  return `rgb(${clamp(r)}, ${clamp(g)}, ${clamp(b)})`;
}
function idealTextOnRgb([r, g, b]) {
  const lum = luminanceRgb([r,g,b]);
  return lum < 0.55 ? '#fff' : '#000';
}
function darkenRgb([r,g,b], k=0.85) {
  return [r*k, g*k, b*k].map((x)=>Math.max(0, Math.min(255, Math.round(x))));
}

/* ---------- Tiny letter circle ---------- */
function LetterCircle({ label='A', size=S(12), bg='transparent', fg='white', stroke='#333', strokeWidth=1 }) {
  return (
    <View style={{ width:size, height:size, borderRadius:size/2, backgroundColor:bg, borderWidth:strokeWidth, borderColor:stroke, alignItems:'center', justifyContent:'center', overflow:'hidden' }}>
      <Text numberOfLines={1} style={{ color:fg, fontWeight:'700', fontSize:size*0.72, lineHeight:size, includeFontPadding:false, textAlign:'center', textAlignVertical:'center' }}>
        {String(label).toUpperCase()}
      </Text>
    </View>
  );
}

/* ---------- Event & expected-stat pills ---------- */
function EventsPills({ h, C, position }) {
  if (!h) return null;

  const mins = Number(h.minutes || 0);
  if (mins === 0) return <Text style={{ color: C.muted, fontStyle: 'italic', fontSize: S(12) }}>Didn’t play</Text>;

  const darkBlue = (() => {
    const baseHex = String(C.bg || C.card || '#000').replace('#', '');
    if (baseHex.length !== 6) return 'white';
    const bgRgb = [parseInt(baseHex.slice(0,2),16), parseInt(baseHex.slice(2,4),16), parseInt(baseHex.slice(4,6),16)];
    return luminanceRgb(bgRgb) < 0.5 ? 'white' : 'darkblue';
  })();

  const g   = Number(h.goals_scored || 0);
  const a   = Number(h.assists || 0);
  const cs  = Number(h.clean_sheets || 0);
  const sv  = Number(h.saves || 0);
  const yc  = Number(h.yellow_cards || 0);
  const rc  = Number(h.red_cards || 0);
  const bns = Number(h.bonus || 0);
  const dc  = Number(h.defensive_contribution ?? h.def_contrib ?? 0); // DC

  // Determine DEF and threshold for +2
  const posStr = String(position ?? '').toUpperCase();
  const posNum = Number(position);
  const isDef  = (posNum === 2) || posStr.startsWith('D') || posStr === 'DEF' || posStr === 'DEFENDER';
  const dcBonus = (isDef && dc >= 10) || (!isDef && dc >= 12);

  const Row = ({ children }) => <View style={{ flexDirection:'row', flexWrap:'wrap', gap:S(6), alignItems:'center' }}>{children}</View>;
  const Pill = ({ children }) => (
    <View style={{ flexDirection:'row', alignItems:'center', gap:S(5), paddingHorizontal:S(8), paddingVertical:S(3), borderRadius:999, borderWidth:StyleSheet.hairlineWidth, borderColor:C.border, backgroundColor:C.card }}>
      {children}
    </View>
  );
  const BonusTag = () => (
    <View style={{ marginLeft:S(3), paddingHorizontal:S(5), paddingVertical:S(1), borderRadius:999, borderWidth:StyleSheet.hairlineWidth, borderColor:C.border, backgroundColor:C.card }}>
      <Text style={{ color: darkBlue, fontWeight:'800', fontSize:S(10) }}>+2</Text>
    </View>
  );

  const pills = [];
  pills.push(
    <Pill key="mins">
      <MaterialCommunityIcons name="clock-time-four-outline" size={S(14)} color={darkBlue} />
      <Text style={{ color: C.ink, fontWeight: '700', fontSize: S(12) }}>{mins}′</Text>
    </Pill>
  );
  if (g > 0)  pills.push(<Pill key="g"><MaterialCommunityIcons name="soccer" size={S(14)} color={darkBlue} /><Text style={{ color:C.ink, fontWeight:'700', fontSize:S(12) }}>{g}</Text></Pill>);
  if (a > 0)  pills.push(<Pill key="a"><LetterCircle label="A" size={S(12)} fg={darkBlue} stroke={C.ink} /><Text style={{ color:C.ink, fontWeight:'700', fontSize:S(12) }}>{a}</Text></Pill>);
  if (cs > 0) pills.push(<Pill key="cs"><MaterialCommunityIcons name="shield-check" size={S(14)} color={darkBlue} /><Text style={{ color:C.ink, fontWeight:'700', fontSize:S(12) }}>{cs}</Text></Pill>);
  if (sv > 0) pills.push(<Pill key="sv"><MaterialCommunityIcons name="hand-back-right" size={S(14)} color={darkBlue} /><Text style={{ color:C.ink, fontWeight:'700', fontSize:S(12) }}>{sv}</Text></Pill>);
  if (dc > 0) pills.push(
    <Pill key="dc">
      <MaterialCommunityIcons name="wall" size={S(14)} color={darkBlue} />
      <Text style={{ color:C.ink, fontWeight:'700', fontSize:S(12) }}>{dc}</Text>
      {dcBonus ? <BonusTag /> : null}
    </Pill>
  );
  if (bns > 0) pills.push(<Pill key="b"><MaterialCommunityIcons name="star" size={S(14)} color="gold" /><Text style={{ color:C.ink, fontWeight:'700', fontSize:S(12) }}>{bns}</Text></Pill>);
  if (yc > 0) pills.push(<Pill key="yc"><View style={{ width:S(10), height:S(14), borderRadius:S(2), backgroundColor:'#ffd400', borderWidth:0.5, borderColor:'#333' }} /><Text style={{ color:C.ink, fontWeight:'700', fontSize:S(12) }}>{yc}</Text></Pill>);
  if (rc > 0) pills.push(<Pill key="rc"><View style={{ width:S(10), height:S(14), borderRadius:S(2), backgroundColor:'#e11d48', borderWidth:0.5, borderColor:'#333' }} /><Text style={{ color:C.ink, fontWeight:'700', fontSize:S(12) }}>{rc}</Text></Pill>);

  return <Row>{pills}</Row>;
}

function ExpectedPills({ h, C }) {
  const xg  = Number(h.expected_goals ?? 0);
  const xa  = Number(h.expected_assists ?? 0);
  const xgi = Number(h.expected_goal_involvements ?? (xg + xa));
  const xgc = Number(h.expected_goals_conceded ?? 0);
  const has = xg || xa || xgi || xgc;
  if (!has) return null;

  const Row = ({ children }) => <View style={{ flexDirection:'row', flexWrap:'wrap', gap:S(6), alignItems:'center' }}>{children}</View>;
  const Pill = ({ label, value }) => (
    <View style={{ flexDirection:'row', alignItems:'center', gap:S(6), paddingHorizontal:S(8), paddingVertical:S(3), borderRadius:999, borderWidth:StyleSheet.hairlineWidth, borderColor:C.border, backgroundColor:C.card }}>
      <Text style={{ color:C.muted, fontWeight:'800', fontSize:S(11) }}>{label}</Text>
      <Text style={{ color:C.ink, fontWeight:'800', fontSize:S(12), fontVariant:['tabular-nums'] }}>{value.toFixed(2)}</Text>
    </View>
  );

  // No outer margin here; we'll add spacing only when we actually render these pills.
  return (
    <Row>
      {xg  ? <Pill key="xg"  label="xG"  value={xg} />  : null}
      {xa  ? <Pill key="xa"  label="xA"  value={xa} />  : null}
      {xgi ? <Pill key="xgi" label="xGI" value={xgi} /> : null}
      {xgc ? <Pill key="xgc" label="xGC" value={xgc} /> : null}
    </Row>
  );
}

/* ---------- Main ---------- */
export default function PlayerInfoModal({
  visible,
  onClose,
  playerId,
  playerName,
  teamShort: teamShortProp,
  position,
  getTeamShort,
}) {
  const C = useColors();
  const [showXG, setShowXG] = useState(false);

  const url = playerId ? `https://fantasy.premierleague.com/api/element-summary/${playerId}/` : null;
  const cacheKey = playerId ? `fpl:element-summary:${playerId}` : null;

  const { data, status, error } = useCachedJson({ url, cacheKey, ttlMs: ONE_HOUR, enabled: visible && !!playerId });
  const { data: prices } = useCachedJson({ url: 'https://livefpl.us/api/prices.json', cacheKey: 'livefpl:prices', ttlMs: ONE_HOUR, enabled: visible });
  const { data: fdrMap } = useCachedJson({ url: 'https://livefpl.us/planner/fdr_ratings.json', cacheKey: 'livefpl:fdr', ttlMs: ONE_HOUR, enabled: visible });

  const teamMetaById = useMemo(() => {
    const map = new Map();
    if (prices && typeof prices === 'object') {
      for (const k of Object.keys(prices)) {
        const row = prices[k];
        const id = Number(row?.team_code);
        const name = row?.team;
        if (!Number.isFinite(id) || !name) continue;
        if (!map.has(id)) map.set(id, { name, short: toShort(name) });
      }
    }
    return map;
  }, [prices]);

  const fixturesAll = useMemo(() => data?.fixtures ?? [], [data]);
  const historyAll  = useMemo(() => (data?.history ?? []).slice().reverse(), [data]);
  const past        = useMemo(() => data?.history_past ?? [], [data]);

  const priceRow = useMemo(() => {
    if (!playerId || !prices || typeof prices !== 'object') return null;
    return prices[String(playerId)] || null;
  }, [playerId, prices]);

  const playerTeamCode = priceRow?.team_code != null ? Number(priceRow.team_code) : null;
  const playerTeamName = priceRow?.team || null;
  const crestUri = useMemo(() => clubCrestUri(Number(playerTeamCode) || 1), [playerTeamCode]);

  const teamShortResolved = useMemo(() => {
    if (teamShortProp) return teamShortProp;
    if (typeof getTeamShort === 'function' && playerTeamCode != null) {
      const s = getTeamShort(Number(playerTeamCode));
      if (s) return s;
    }
    if (playerTeamCode && teamMetaById.has(playerTeamCode)) return teamMetaById.get(playerTeamCode).short;
    if (playerTeamName) return toShort(playerTeamName);
    return '';
  }, [teamShortProp, getTeamShort, playerTeamCode, teamMetaById, playerTeamName]);

  const idToShort = (id) => {
    if (id == null) return '';
    const num = Number(id);
    if (Number.isFinite(num) && teamMetaById.has(num)) return teamMetaById.get(num).short;
    try {
      if (typeof getTeamShort === 'function') {
        const s = getTeamShort(num);
        if (s) return s;
      }
    } catch {}
    return `Team ${id}`;
  };

  const prettyTime = (iso) =>
    iso
      ? new Date(iso).toLocaleString(undefined, { weekday:'short', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
      : 'TBD';

  const fixVisibleCount    = Math.min(CAP_N, fixturesAll.length || 0) || 1;
  const recentVisibleCount = Math.min(CAP_N, historyAll.length || 0) || 1;
  const fixturesMaxH       = fixVisibleCount * H_FIXTURE_ROW + (fixVisibleCount - 1) * V_GAP + 4;
  const recentMaxH         = recentVisibleCount * H_RECENT_ROW + (recentVisibleCount - 1) * V_GAP + 4;

  // theme luminance for FDR contrast tweak
  const themeRgb = parseHex(C.card || C.bg || '#111111') || [17,17,17];
  const isLightTheme = luminanceRgb(themeRgb) > 0.6;

  function fdrFor(oppShort, sideHOrA) {
    if (!oppShort || !fdrMap) return null;
    const key = `${oppShort}(${sideHOrA})`;
    const entry = fdrMap[key];
    if (entry && Array.isArray(entry) && entry.length >= 2) {
      const [difficulty, rgb] = entry;
      if (!Array.isArray(rgb)) return { difficulty, bg: undefined, fg: undefined };
      let chipRgb = rgb.slice(0,3);
      if (isLightTheme && luminanceRgb(chipRgb) > 0.75) chipRgb = darkenRgb(chipRgb, 0.82);
      const bg = rgbToCss(chipRgb);
      const fg = idealTextOnRgb(chipRgb);
      return { difficulty, bg, fg };
    }
    return null;
  }

  function FDRChip({ label, bg, fg, borderColor }) {
    return (
      <View style={{ width:CHIP_W, height:CHIP_H, borderRadius:CHIP_RADIUS, borderWidth:StyleSheet.hairlineWidth, borderColor, backgroundColor:bg, alignItems:'center', justifyContent:'center' }}>
        <Text numberOfLines={1} style={{ color:fg, fontWeight:'800', fontSize:S(11), includeFontPadding:false, textAlign:'center' }}>
          {label}
        </Text>
      </View>
    );
  }

  function ScoreBadge({ text }) {
    return (
      <View style={{ marginLeft:S(6), paddingHorizontal:S(8), paddingVertical:S(3), borderRadius:999, borderWidth:StyleSheet.hairlineWidth, borderColor:C.border, backgroundColor:C.card }}>
        <Text style={{ color:C.text, fontWeight:'800', fontSize:S(12) }}>{text}</Text>
      </View>
    );
  }

  function PointsBadge({ pts }) {
    return (
      <View style={{ paddingHorizontal:S(8), paddingVertical:S(3), borderRadius:999, borderWidth:StyleSheet.hairlineWidth, borderColor:C.border, backgroundColor:C.card }}>
        <Text style={{ color:C.text, fontWeight:'800', fontSize:S(12) }}>{`Pts ${pts}`}</Text>
      </View>
    );
  }

  function GWBadge({ round }) {
    return (
      <View style={{ paddingHorizontal:S(8), paddingVertical:S(3), borderRadius:999, borderWidth:StyleSheet.hairlineWidth, borderColor:C.border, backgroundColor:C.card }}>
        <Text style={{ color:C.text, fontWeight:'800', fontSize:S(12) }}>{`GW ${round}`}</Text>
      </View>
    );
  }

  // Small header toggle for xG pills
  function XGToggle() {
    return (
      <TouchableOpacity
        onPress={() => setShowXG(v => !v)}
        style={{
          flexDirection:'row',
          alignItems:'center',
          gap:S(6),
          paddingHorizontal:S(10),
          paddingVertical:S(6),
          borderRadius:999,
          borderWidth:StyleSheet.hairlineWidth,
          borderColor:C.border,
          backgroundColor: showXG ? C.card2 : C.card,
        }}
        accessibilityRole="button"
        accessibilityLabel="Toggle expected stats"
        hitSlop={{ top:6, bottom:6, left:6, right:6 }}
      >
        <MaterialCommunityIcons
          name="chart-line"
          size={S(14)}
          color={showXG ? C.text : C.ink}
        />
        <Text style={{ color: showXG ? C.text : C.ink, fontWeight:'700', fontSize:S(12) }}>
          {showXG ? ' Hide xG' : ' Show xG'}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      {/* exactly ONE child under Modal to avoid adjacent JSX error */}
      <View style={styles.modalRoot}>
        {/* Backdrop */}
        <View style={[styles.backdrop, { backgroundColor: C.backdrop }]} />
        {/* Centered container (like Rank) */}
        <View style={styles.centerWrap} pointerEvents="box-none">
          <View style={[styles.sheet, { backgroundColor: C.card, borderColor: C.border }]}>
            {/* ------- Header ------- */}
            <View style={[styles.header, { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border }]}>
              <View style={styles.headerLeft}>
                <Image source={{ uri: crestUri }} style={{ width:S(24), height:S(24), borderRadius:S(12), marginRight:S(6) }} />
                <View style={{ flexShrink: 1 }}>
                  <Text style={[styles.title, { color: C.text }]} numberOfLines={1}>
                    {playerName || `Player #${playerId || '?'}`}
                  </Text>
                  <Text style={[styles.subtitle, { color: C.ink }]} numberOfLines={1}>
                    {[teamShortResolved || null, position || null].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </View>
              <TouchableOpacity onPress={onClose} hitSlop={{ top:10, left:10, right:10, bottom:10 }} accessibilityLabel="Close player info">
                <MaterialCommunityIcons name="close" size={S(22)} color={C.text} />
              </TouchableOpacity>
            </View>

            {/* ------- Body ------- */}
            {status === 'loading' ? (
              <View style={styles.center}>
                <ActivityIndicator color={C.text} />
                <Text style={{ color: C.ink, marginTop: S(6), fontSize: S(12) }}>Loading player info…</Text>
              </View>
            ) : status === 'error' ? (
              <View style={styles.center}>
                <MaterialCommunityIcons name="cloud-alert" size={S(30)} color={C.ink} />
                <Text style={{ color: C.ink, marginTop: S(6), fontSize: S(12) }}>Couldn’t load latest. Showing cache if available.</Text>
                {!!error && <Text style={{ color: C.ink, marginTop: S(4), fontSize: S(11) }}>{String(error)}</Text>}
              </View>
            ) : (
              <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: S(18) }} showsVerticalScrollIndicator={false}>
                <>
                  {/* ---------------- Upcoming fixtures ---------------- */}
                  <Section title="Upcoming fixtures" color={C.text}>
                    {fixturesAll.length === 0 ? (
                      <Text style={{ color: C.ink, fontSize: S(12) }}>No upcoming fixtures found.</Text>
                    ) : (
                      <View>
                        <ScrollView
                          style={{ maxHeight: fixturesMaxH }}
                          contentContainerStyle={{ paddingBottom: S(2) }}
                          nestedScrollEnabled
                          showsVerticalScrollIndicator
                          keyboardShouldPersistTaps="handled"
                        >
                          {fixturesAll.map((f, idx) => {
                            const home = !!f.is_home;
                            const oppId = home ? f.team_a : f.team_h;
                            const side = home ? 'H' : 'A';
                            const oppShort = idToShort(oppId);
                            const fdr = fdrFor(oppShort, side);
                            const chipBg = fdr?.bg || C.card;
                            const chipFg = fdr?.fg || C.text;
                            const oppCrest = clubCrestUri(oppId || 1);

                            return (
                              <View
                                key={`fix-${f.id}-${idx}`}
                                style={[styles.fixtRow, { borderColor: C.border, backgroundColor: C.card2, marginBottom: V_GAP }]}
                              >
                                <Text style={[styles.fixtGW, { color: C.text }]}>{`GW ${f.event}`}</Text>
                                <Image source={{ uri: oppCrest }} style={{ width:S(22), height:S(22), borderRadius:S(11), marginRight:S(6) }} />
                                <FDRChip label={`${oppShort}[${side}]`} bg={chipBg} fg={chipFg} borderColor={C.border} />
                                <Text style={[styles.fixtWhen, { color: C.ink, marginLeft: 'auto' }]}>{prettyTime(f.kickoff_time)}</Text>
                              </View>
                            );
                          })}
                        </ScrollView>
                      </View>
                    )}
                  </Section>

                  {/* ---------------- Recent matches ---------------- */}
                  <Section title="Recent matches" color={C.text} rightSlot={<XGToggle />}>
                    {historyAll.length === 0 ? (
                      <Text style={{ color: C.ink, fontSize: S(12) }}>No recent history.</Text>
                    ) : (
                      <View>
                        <ScrollView
                          style={{ maxHeight: recentMaxH }}
                          contentContainerStyle={{ paddingBottom: S(2) }}
                          nestedScrollEnabled
                          showsVerticalScrollIndicator
                          keyboardShouldPersistTaps="handled"
                        >
                          {historyAll.map((h, idx) => {
                            const oppId = h.opponent_team;
                            const home = !!h.was_home;
                            const side = home ? 'H' : 'A';
                            const oppShort = idToShort(oppId);

                            const fdr = fdrFor(oppShort, side);
                            const chipBg = fdr?.bg || C.card;
                            const chipFg = fdr?.fg || C.text;

                            const crest = clubCrestUri(oppId || 1);
                            const scoreUs = home ? h.team_h_score : h.team_a_score;
                            const scoreThem = home ? h.team_a_score : h.team_h_score;
                            const score = (Number.isFinite(scoreUs) && Number.isFinite(scoreThem)) ? `${scoreUs}–${scoreThem}` : '—';

                            const mins = Number(h.minutes || 0);

                            return (
                              <View
   key={`hist-${h.element}-${h.fixture}-${idx}`}
   style={[
     styles.recentCard,
     { 
       borderColor: C.border,
       backgroundColor: C.card2,
       marginBottom: V_GAP,
       // Only reserve extra height when xG is shown
       minHeight: (mins > 0 && showXG) ? H_RECENT_ROW : undefined,
     }
   ]}
 >
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: S(8) }}>
                                  <GWBadge round={h.round} />
                                  <Image source={{ uri: crest }} style={{ width: S(24), height: S(24), borderRadius: S(12) }} />
                                  <FDRChip label={`${oppShort}[${side}]`} bg={chipBg} fg={chipFg} borderColor={C.border} />
                                  <ScoreBadge text={score} />
                                  <View style={{ flex: 1 }} />
                                  <PointsBadge pts={h.total_points ?? 0} />
                                </View>

                                {/* No top margin unless xG is actually visible */}
                                <View>
                                  <EventsPills h={h} C={C} position={position} />
                                  {mins > 0 && showXG ? (
                                    <View style={{ marginTop: S(6) }}>
                                      <ExpectedPills h={h} C={C} />
                                    </View>
                                  ) : null}
                                </View>
                              </View>
                            );
                          })}
                        </ScrollView>
                      </View>
                    )}
                  </Section>

                  {/* ---------------- Past Seasons ---------------- */}
                  <Section title="Past seasons" color={C.text}>
                    {past.length === 0 ? (
                      <Text style={{ color: C.ink, fontSize: S(12) }}>No past seasons on record.</Text>
                    ) : (
                      <View>
                        {past.slice(-3).reverse().map((p) => (
                          <View key={p.season_name} style={[styles.pastRow, { borderColor: C.border }]}>
                            <Text style={[styles.pastSeason, { color: C.text }]}>{p.season_name}</Text>
                            <Text style={[styles.pastStat, { color: C.ink }]}>{`Pts ${p.total_points} · G ${p.goals_scored} · A ${p.assists}`}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </Section>
                </>
              </ScrollView>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Section({ title, children, color, rightSlot }) {
  // Always a single wrapper around children to avoid adjacent JSX
  return (
    <View style={{ marginBottom: S(14) }}>
      <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginBottom:S(6) }}>
        <Text style={[styles.sectionTitle, { color }]}>{title}</Text>
        {rightSlot ? <View>{rightSlot}</View> : <View />}
      </View>
      <View>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.6,
  },
  modalRoot: {
    flex: 1,
  },
  /* Centered overlay like Rank modal */
  centerWrap: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: S(12),
  },
  sheet: {
    maxHeight: '70%',
    width: '96%',
    maxWidth: 640,
    borderRadius: S(16),
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  header: {
    paddingHorizontal: S(14), paddingTop: S(12), paddingBottom: S(8),
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: S(16), fontWeight: '700' },
  subtitle: { fontSize: S(11) },
  center: { alignItems: 'center', paddingVertical: S(22) },
  scroll: { paddingHorizontal: S(14) },
  sectionTitle: { fontSize: S(13), fontWeight: '700', opacity: 0.9 },

  /* Fixture row */
  fixtRow: {
    flexDirection: 'row', alignItems: 'center', gap: S(6), padding: S(8),
    borderRadius: S(8), borderWidth: StyleSheet.hairlineWidth,
    minHeight: H_FIXTURE_ROW,
  },
  fixtGW: { fontWeight: '700', fontSize: S(12), marginRight: S(4) },
  fixtWhen: { fontSize: S(11) },

  /* Recent card */
  recentCard: { padding: S(8), borderRadius: S(8), borderWidth: StyleSheet.hairlineWidth, minHeight: H_RECENT_ROW },

  /* Past seasons */
  pastRow: {
    flexDirection: 'row', justifyContent: 'space-between', paddingVertical: S(6),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pastSeason: { fontWeight: '700', fontSize: S(12) },
  pastStat: { fontSize: S(11) },
});
