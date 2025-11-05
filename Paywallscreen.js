// PaywallScreen.js
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Linking,
  ScrollView,
} from 'react-native';
import Constants from 'expo-constants';
import Purchases from 'react-native-purchases';
import * as Clipboard from 'expo-clipboard';
import AppHeader from './AppHeader';
import { useColors } from './theme';
import { usePro } from './ProContext';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default function PaywallScreen(props) {
  const C = useColors();
  const { offerings, purchaseMonthly, purchaseAnnual, restore, isReady } = usePro();

  const [appUserId, setAppUserId] = useState(null);
  const [info, setInfo] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);

  const isExpoGo = Constants.appOwnership === 'expo';
  const isIOS = Platform.OS === 'ios';

  // ---- Resolve packages ----
  const monthlyPkg =
    offerings?.current?.availablePackages?.find((p) => p.packageType === 'MONTHLY') || null;
  const annualPkg =
    offerings?.current?.availablePackages?.find((p) => p.packageType === 'ANNUAL') || null;

  // ---- Price helpers (auto, localized) ----
  const priceOf = (pkg) => pkg?.product?.priceString ?? '';

  const perMonthOfAnnual = (pkg) => {
    const p = pkg?.product;
    if (!p?.price || !p?.currencyCode) return '';
    const perMonth = p.price / 12;
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: p.currencyCode,
      }).format(perMonth);
    } catch {
      return `${p.currencyCode} ${perMonth.toFixed(2)}`;
    }
  };

  // Optional intro pricing line if configured in App Store Connect
  const introLine = (pkg) => {
    const ip = pkg?.product?.introPrice;
    if (!ip?.priceString) return '';
    return `Intro offer: ${ip.priceString}`;
  };

  // ---- Load account details from RevenueCat ----
  const loadAccount = useCallback(async () => {
    setRefreshing(true);
    try {
      const [id, ci] = await Promise.all([
        Purchases.getAppUserID().catch(() => null),
        Purchases.getCustomerInfo().catch(() => null),
      ]);
      setAppUserId(id);
      setInfo(ci);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadAccount();
  }, [loadAccount]);

  // ---- Status / entitlement summary ----
  const ENTITLEMENT_ID = 'Premium'; // your RC entitlement identifier
  const entitlement = info?.entitlements?.active?.[ENTITLEMENT_ID];
  const isProActive = !!entitlement;
  const expiresAt = entitlement?.expirationDate || entitlement?.expiresDate || null;

  const statusLine = useMemo(() => {
    if (!isReady && !info) return 'Checking status…';
    if (isProActive) {
      return expiresAt
        ? `Pro (Active) — renews ${new Date(expiresAt).toLocaleString()}`
        : 'Pro (Active)';
    }
    return 'Free (No active subscription)';
  }, [isReady, info, isProActive, expiresAt]);

  const managementURL = isIOS
    ? 'itms-apps://apps.apple.com/account/subscriptions'
    : 'https://play.google.com/store/account/subscriptions';

  // Strip "$RCAnonymousID:" prefix and enable copy
  const cleanId = useMemo(
    () => (appUserId ? appUserId.replace(/^\$RCAnonymousID:/, '') : null),
    [appUserId]
  );
  const copyId = async () => {
    if (!cleanId) return;
    await Clipboard.setStringAsync(cleanId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const disabledReason = useMemo(() => {
    if (isExpoGo) return 'Not available in Expo Go';
    if (!isIOS) return 'Google Play billing not enabled yet.';
    if (!isReady) return 'Loading products…';
    if (!offerings?.current) return 'No current offering configured.';
    return null;
  }, [isExpoGo, isIOS, isReady, offerings]);

  const buyMonthly = async () => {
    if (!monthlyPkg) return;
    await purchaseMonthly();
    await loadAccount();
  };

  const buyAnnual = async () => {
    if (!annualPkg) return;
    await purchaseAnnual();
    await loadAccount();
  };

  const onRestore = async () => {
    await restore();
    await loadAccount();
  };

  // --------- Benefits list ---------
  const benefits = [
    { icon: 'check-circle-outline', text: 'Ad-free experience across the app and the site' },
    { icon: 'check-circle-outline', text: 'Support LiveFPL and ongoing development' },
    {
      icon: 'check-circle-outline',
      text: 'Full, unlimited access to all features (some features will become Pro-only in a few weeks)',
    },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Avoid Go-Pro/Change-ID in this header to prevent recursion/overlap */}
      <AppHeader showGoPro={false} showChangeId={false} />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Benefits card */}
        <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
          <Text style={[styles.cardTitle, { color: C.ink }]}>Benefits of Premium Access</Text>
          <View style={{ gap: 10 }}>
            {benefits.map((b, idx) => (
              <View key={idx} style={styles.benefitRow}>
                <MaterialCommunityIcons name={b.icon} size={18} color={C.ink} />
                <Text style={[styles.benefitText, { color: C.ink }]}>{b.text}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Account card */}
        <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
          <Text style={[styles.cardTitle, { color: C.ink }]}>Account</Text>

          <View style={styles.kvRow}>
            <Text style={[styles.kKey, { color: C.muted }]}>Anonymous ID</Text>
            {/* Cleaned ID with copy chip */}
            <View style={styles.idRow}>
              <Text
                selectable
                numberOfLines={1}
                style={[styles.kValMono, { color: C.ink, flexShrink: 1 }]}
              >
                {cleanId || '—'}
              </Text>
              {cleanId ? (
                <TouchableOpacity
                  onPress={copyId}
                  style={[styles.copyBtn, { backgroundColor: C.stripBg, borderColor: C.border2 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Copy Anonymous ID"
                >
                  <MaterialCommunityIcons name={copied ? 'check' : 'content-copy'} size={14} color={C.ink} />
                  <Text style={[styles.copyText, { color: C.ink }]}>
                    {copied ? 'Copied' : 'Copy'}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          <View style={styles.kvRow}>
            <Text style={[styles.kKey, { color: C.muted }]}>Status</Text>
            <Text style={[styles.kVal, { color:  C.ink }]}>{statusLine}</Text>
          </View>

          <View style={[styles.actionsRow, { borderTopColor: C.border2 }]}>
            <TouchableOpacity
              onPress={loadAccount}
              style={[styles.actionBtn, { borderColor: C.border2, backgroundColor: C.stripBg }]}
            >
              {refreshing ? (
                <ActivityIndicator color={C.ink} />
              ) : (
                <Text style={[styles.actionText, { color: C.ink }]}>Refresh</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => Linking.openURL(managementURL)}
              style={[styles.actionBtn, { borderColor: C.border2, backgroundColor: C.stripBg }]}
            >
              <Text style={[styles.actionText, { color: C.ink }]}>Manage in Store</Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.help, { color: C.muted }]}>
            Use this Anonymous ID for any communication with LiveFPL customer service (Twitter or at
            livefpl@gmail.com).
          </Text>
        </View>

        {/* Purchase card */}
        <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
          <Text style={[styles.cardTitle, { color: C.ink }]}>Go Pro</Text>

          {!isReady && (
            <View style={styles.row}>
              <ActivityIndicator color={C.ink} />
              <Text style={{ color: C.muted, marginLeft: 8 }}>Loading products…</Text>
            </View>
          )}

          {!!disabledReason && <Text style={[styles.note, { color: C.warn }]}>{disabledReason}</Text>}

          <View style={styles.buyRow}>
            <TouchableOpacity
              style={[
                styles.buyBtn,
                { borderColor: C.border2, backgroundColor: C.stripBg },
                (!monthlyPkg || !!disabledReason) && styles.btnDisabled,
              ]}
              disabled={!monthlyPkg || !!disabledReason}
              onPress={buyMonthly}
            >
              <Text style={[styles.buyText, { color: C.ink }]}>
                Monthly {priceOf(monthlyPkg) ? `· ${priceOf(monthlyPkg)}` : ''}
              </Text>
              {!!introLine(monthlyPkg) && (
                <Text style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>{introLine(monthlyPkg)}</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.buyBtn,
                { borderColor: C.border2, backgroundColor: C.stripBg },
                (!annualPkg || !!disabledReason) && styles.btnDisabled,
              ]}
              disabled={!annualPkg || !!disabledReason}
              onPress={buyAnnual}
            >
              <Text style={[styles.buyText, { color: C.ink }]}>
                Annual {priceOf(annualPkg) ? `· ${priceOf(annualPkg)}` : ''}
              </Text>
              {!!perMonthOfAnnual(annualPkg) && (
                <Text style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>
                  ≈ {perMonthOfAnnual(annualPkg)} / month
                </Text>
              )}
            </TouchableOpacity>
          </View>

          <View style={[styles.legalWrap, { borderTopColor: C.border2 }]}>
  <Text style={[styles.legalText, { color: C.muted }]}>
    By subscribing, you agree to our{' '}
    <Text
      style={[styles.legalLink, { color: C.link }]}
      onPress={() => Linking.openURL('https://www.livefpl.net/privacy.pdf')}
    >
      Privacy Policy
    </Text>{' '}
    and{' '}
    <Text
      style={[styles.legalLink, { color: C.link }]}
      onPress={() => Linking.openURL('https://www.apple.com/legal/internet-services/itunes/dev/stdeula/')}
    >
      Terms of Use
    </Text>
    .
  </Text>
</View>


          <TouchableOpacity
  style={[styles.linkBtn, { borderColor: C.border2, backgroundColor: C.stripBg }]}
  onPress={onRestore}
  disabled={!!disabledReason}
>
  <Text style={[styles.linkText, { color: C.ink }]}>Restore Purchases</Text>
</TouchableOpacity>


          <Text style={[styles.disclaimer, { color: C.muted }]}>
            Payments are processed by Apple. Subscriptions auto-renew; cancel any time in store.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // small inline “Close” bar for overlay use
  inlineCloseWrap: {
    height: 44,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  inlineCloseBtn: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  inlineCloseText: { fontWeight: '700', fontSize: 12 },

  content: { padding: 16, gap: 16 },

  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
  },
  cardTitle: { fontSize: 16, fontWeight: '800', marginBottom: 8 },

  // Benefits
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  benefitText: { fontSize: 14, lineHeight: 20 },

  // Account
  kvRow: { marginVertical: 4 },
  kKey: { fontSize: 12 },
  kVal: { fontSize: 14, fontWeight: '700' },
  kValMono: { fontSize: 13, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }) },

  idRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  copyBtn: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  copyText: { fontSize: 12, fontWeight: '700' },

  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 10,
    marginTop: 10,
    borderTopWidth: 1,
  },
  actionBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  actionText: { fontWeight: '700' },
  help: { marginTop: 8, fontSize: 12, lineHeight: 16 },

  // Buy
  row: { flexDirection: 'row', alignItems: 'center' },
  note: { marginTop: 6, marginBottom: 10, fontSize: 12 },

  buyRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  buyBtn: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buyText: { fontSize: 15, fontWeight: '700' },
  btnDisabled: { opacity: 0.5 },

  // Privacy under buy buttons
  legalWrap: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  legalText: { fontSize: 12, lineHeight: 18 },
  legalLink: { fontWeight: '700', textDecorationLine: 'underline' },

  linkBtn: {
  marginTop: 12,
  paddingVertical: 10,
  paddingHorizontal: 14,
  alignItems: 'center',
  borderWidth: 1,
  borderRadius: 10,
},

  linkText: { fontSize: 14, fontWeight: '700' },

  disclaimer: { fontSize: 12, marginTop: 10, lineHeight: 16 },
});
