// PaywallModal.js
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Modal, View, Text, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import Purchases from 'react-native-purchases';
import { useColors } from './theme';

export default function PaywallModal({ visible, onClose, onPurchased }) {
  const C = useColors();
  const [loading, setLoading] = useState(false);
  const [offerings, setOfferings] = useState(null);

  useEffect(() => {
    if (!visible) return;
    (async () => {
      try {
        setLoading(true);
        const o = await Purchases.getOfferings();
        setOfferings(o?.current || null);
      } catch (e) {
        // You can surface a nicer error view here
      } finally {
        setLoading(false);
      }
    })();
  }, [visible]);

  const onBuy = useCallback(async (pkg) => {
    if (!pkg) return;
    try {
      setLoading(true);
      await Purchases.purchasePackage(pkg);
      onPurchased && onPurchased();
      onClose && onClose();
    } catch (e) {
      // user cancelled or error
      if (e?.userCancelled) return;
      Alert.alert('Purchase Failed', e?.message || 'Please try again later.');
    } finally {
      setLoading(false);
    }
  }, [onPurchased, onClose]);

  const styles = useMemo(() => StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 16 },
    sheet: {
      width: '100%', maxWidth: 520, borderRadius: 16, backgroundColor: C.card,
      borderWidth: 1, borderColor: C.border, padding: 16
    },
    title: { fontSize: 18, fontWeight: '800', color: C.ink, textAlign: 'center', marginBottom: 8 },
    subtitle: { fontSize: 13, color: C.muted, textAlign: 'center', marginBottom: 14 },
    row: { gap: 10 },
    btn: {
      paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12,
      backgroundColor: C.accent, alignItems: 'center', marginTop: 10
    },
    btnGhost: {
      paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12,
      backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', marginTop: 8
    },
    btnText: { color: '#fff', fontWeight: '800' },
    btnGhostText: { color: C.ink, fontWeight: '800' },
    small: { fontSize: 12, color: C.muted, textAlign: 'center', marginTop: 8 },
  }), [C]);

  const monthly = offerings?.availablePackages?.find(p => p.packageType === 'MONTHLY') || offerings?.monthly;
  const annual  = offerings?.availablePackages?.find(p => p.packageType === 'ANNUAL')  || offerings?.annual;

  const mPrice = monthly?.product?.priceString;
  const yPrice = annual?.product?.priceString;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Go Ad-Free (Pro)</Text>
          <Text style={styles.subtitle}>Support LiveFPL and remove ads on this device’s Apple/Google account.</Text>

          {loading && <ActivityIndicator />}

          {!loading && !offerings && (
            <Text style={styles.small}>No products available. Please try again later.</Text>
          )}

          {!loading && offerings && (
            <View style={styles.row}>
              {monthly && (
                <Pressable style={styles.btn} onPress={() => onBuy(monthly)} accessibilityRole="button">
                  <Text style={styles.btnText}>Monthly {mPrice || ''}</Text>
                </Pressable>
              )}
              {annual && (
                <Pressable style={styles.btn} onPress={() => onBuy(annual)} accessibilityRole="button">
                  <Text style={styles.btnText}>Yearly {yPrice || ''}</Text>
                </Pressable>
              )}
              <Pressable style={styles.btnGhost} onPress={onClose} accessibilityRole="button">
                <Text style={styles.btnGhostText}>Not now</Text>
              </Pressable>

              <Text style={styles.small}>Managed by Apple/Google. You can restore on any device using the same store account.</Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}
