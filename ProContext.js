// ProContext.js
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import Purchases from 'react-native-purchases';

const RC_IOS_API_KEY = 'appl_zPaSWIBhQoVcwHkPKVkiQdHwpel'; // <-- paste from RevenueCat dashboard
const ENTITLEMENT_ID = 'Premium';                          // <-- the entitlement you created

const ProCtx = createContext({
  isReady: false,
  isPro: false,
  offerings: null,
  purchaseMonthly: async () => {},
  purchaseAnnual: async () => {},
  restore: async () => {},
});

export function ProProvider({ children }) {
  const [isReady, setIsReady] = useState(false);
  const [isPro, setIsPro] = useState(false);
  const [offerings, setOfferings] = useState(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        if (Platform.OS === 'ios') {
          await Purchases.setLogLevel(Purchases.LOG_LEVEL.DEBUG);
          await Purchases.configure({ apiKey: RC_IOS_API_KEY });

          // Initial read
          const info = await Purchases.getCustomerInfo();
          if (mounted) setIsPro(Boolean(info.entitlements.active[ENTITLEMENT_ID]));

          // Offerings
          const offs = await Purchases.getOfferings();
          if (mounted) setOfferings(offs);
        } else {
          // Android not set up yet → always not pro
          if (mounted) {
            setIsPro(false);
            setOfferings(null);
          }
        }
      } catch (e) {
        // keep minimal: fail closed (non-pro) and continue
        console.warn('RevenueCat init error', e);
      } finally {
        if (mounted) setIsReady(true);
      }
    })();

    // Listen for changes (receipt refresh / account changes)
    const removeListener =
      Platform.OS === 'ios'
        ? Purchases.addCustomerInfoUpdateListener((info) => {
            setIsPro(Boolean(info.entitlements.active[ENTITLEMENT_ID]));
          })
        : () => {};

    return () => {
      mounted = false;
      removeListener?.();
    };
  }, []);

  const getPkgById = (pkgIdGuess) => {
    // Try to find monthly/annual from "current" offering if present.
    // Fallbacks allow different offering identifiers.
    if (!offerings?.current) return null;
    const pkgs = offerings.current.availablePackages || [];
    // Try RevenueCat canonical identifiers first
    const byIdentifier = pkgs.find((p) => p.identifier === pkgIdGuess);
    if (byIdentifier) return byIdentifier;

    // Fallback: try by package type (MONTHLY/ANNUAL)
    if (pkgIdGuess === 'monthly') {
      return pkgs.find((p) => p.packageType === 'MONTHLY') || null;
    }
    if (pkgIdGuess === 'annual') {
      return pkgs.find((p) => p.packageType === 'ANNUAL') || null;
    }
    return null;
  };

  const purchase = async (pkg) => {
    if (!pkg) return { ok: false, error: 'No package' };
    try {
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      const pro = Boolean(customerInfo.entitlements.active[ENTITLEMENT_ID]);
      setIsPro(pro);
      return { ok: true, pro };
    } catch (e) {
      // user cancellation or error
      return { ok: false, error: e?.message || String(e) };
    }
  };

  const value = useMemo(
    () => ({
      isReady,
      isPro,
      offerings,
      purchaseMonthly: async () => purchase(getPkgById('monthly')),
      purchaseAnnual: async () => purchase(getPkgById('annual')),
      restore: async () => {
        try {
          const info = await Purchases.restorePurchases();
          const pro = Boolean(info.entitlements.active[ENTITLEMENT_ID]);
          setIsPro(pro);
          return { ok: true, pro };
        } catch (e) {
          return { ok: false, error: e?.message || String(e) };
        }
      },
    }),
    [isReady, isPro, offerings]
  );

  return <ProCtx.Provider value={value}>{children}</ProCtx.Provider>;
}

export function usePro() {
  return useContext(ProCtx);
}
