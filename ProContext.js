// ProContext.js
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import Purchases from 'react-native-purchases';

const RC_IOS_API_KEY = 'appl_zPaSWIBhQoVcwHkPKVkiQdHwpel'; // from RevenueCat dashboard
const RC_ANDROID_API_KEY = 'goog_rqtovVYQnMRFKqrGyvDijZortxM'; // <-- TODO: paste your Android key here
const ENTITLEMENT_ID = 'Premium'; // the entitlement you created in RC

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
        await Purchases.setLogLevel(Purchases.LOG_LEVEL.DEBUG);

        const apiKey = Platform.select({
          ios: RC_IOS_API_KEY,
          android: RC_ANDROID_API_KEY,
        });

        // If for some reason we don't have a key for this platform, just bail out gracefully
        if (!apiKey) {
          console.warn('No RevenueCat API key configured for this platform.');
          if (mounted) {
            setIsPro(false);
            setOfferings(null);
          }
          return;
        }

        await Purchases.configure({ apiKey });

        // Initial customer info
        const info = await Purchases.getCustomerInfo();
        if (mounted) {
          setIsPro(Boolean(info.entitlements.active[ENTITLEMENT_ID]));
        }

        // Offerings
        const offs = await Purchases.getOfferings();
        if (mounted) {
          setOfferings(offs);
        }
      } catch (e) {
        console.warn('RevenueCat init error', e);
        if (mounted) {
          setIsPro(false);
          setOfferings(null);
        }
      } finally {
        if (mounted) setIsReady(true);
      }
    })();

    // Listen for changes on *both* platforms now
    const removeListener = Purchases.addCustomerInfoUpdateListener((info) => {
      setIsPro(Boolean(info.entitlements.active[ENTITLEMENT_ID]));
    });

    return () => {
      mounted = false;
      removeListener?.();
    };
  }, []);

  const getPkgById = (pkgIdGuess) => {
    if (!offerings?.current) return null;
    const pkgs = offerings.current.availablePackages || [];

    const byIdentifier = pkgs.find((p) => p.identifier === pkgIdGuess);
    if (byIdentifier) return byIdentifier;

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
