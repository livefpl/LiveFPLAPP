// ProContext.js
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as SecureStore from 'expo-secure-store';
import Purchases from 'react-native-purchases';
import { setAdGuard } from './AdInterstitial';

const KEY = 'livefpl.isPro.secure.v1';
const EXP_KEY = 'livefpl.proExpiresAt.v1';

const Ctx = createContext({
  isPro: false,
  proExpiresAt: null,        // ISO string or null
  refreshing: false,
  refresh: async () => {},
  restore: async () => {},
  openPaywall: () => {},     // show PaywallModal
  closePaywall: () => {},
});

export function ProProvider({ children }) {
  const [isPro, setIsPro] = useState(false);
  const [proExpiresAt, setProExpiresAt] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);

  const isProRef = useRef(false);
  useEffect(() => { isProRef.current = isPro; }, [isPro]);

  // Register guard for interstitial ads
  useEffect(() => {
    setAdGuard(() => isProRef.current);
  }, []);

  // Initial load from secure storage (grace works offline)
  useEffect(() => {
    (async () => {
      try {
        const raw = await SecureStore.getItemAsync(KEY);
        const exp = await SecureStore.getItemAsync(EXP_KEY);
        const now = Date.now();
        const ok = raw === '1';
        const expMs = exp ? Date.parse(exp) : null;

        // Optional small grace: if expired within last 3 days, still ok offline
        const GRACE_MS = 3 * 24 * 3600 * 1000;
        const withinGrace = expMs && now - expMs < GRACE_MS;

        setIsPro(ok && (!expMs || expMs > now || withinGrace));
        setProExpiresAt(exp || null);
      } catch {}
    })();
  }, []);

  // Persist securely
  const setProSecure = useCallback(async (active, expiresAt) => {
    setIsPro(!!active);
    setProExpiresAt(expiresAt || null);
    try {
      await SecureStore.setItemAsync(KEY, active ? '1' : '0');
      if (expiresAt) {
        await SecureStore.setItemAsync(EXP_KEY, expiresAt);
      } else {
        await SecureStore.deleteItemAsync(EXP_KEY);
      }
    } catch {}
  }, []);

  // Query RevenueCat for current entitlements
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const info = await Purchases.getCustomerInfo();
      const ent = info?.entitlements?.active?.pro;
      if (ent) {
        const exp = ent?.expirationDate; // ISO or null for lifetime
        await setProSecure(true, exp || null);
      } else {
        await setProSecure(false, null);
      }
    } catch {
      // keep whatever cache we have
    } finally {
      setRefreshing(false);
    }
  }, [setProSecure]);

  const restore = useCallback(async () => {
    setRefreshing(true);
    try {
      await Purchases.restorePurchases();
    } catch {}
    finally {
      setRefreshing(false);
    }
    await refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({
      isPro,
      proExpiresAt,
      refreshing,
      refresh,
      restore,
      openPaywall: () => setShowPaywall(true),
      closePaywall: () => setShowPaywall(false),
    }),
    [isPro, proExpiresAt, refreshing, refresh, restore]
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* Mount paywall once at root; controlled by context */}
      <PaywallMount open={showPaywall} onClose={() => setShowPaywall(false)} onPurchased={refresh} />
    </Ctx.Provider>
  );
}

export function usePro() {
  return useContext(Ctx);
}

// Lazy import to avoid circular deps at module top
function PaywallMount({ open, onClose, onPurchased }) {
  const [Comp, setComp] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const mod = await import('./PaywallModal');
      if (alive) setComp(() => mod.default);
    })();
    return () => { alive = false; };
  }, []);
  if (!Comp) return null;
  return <Comp visible={open} onClose={onClose} onPurchased={onPurchased} />;
}
