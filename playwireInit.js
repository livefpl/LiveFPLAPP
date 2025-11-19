// playwireInit.js
import { Platform } from 'react-native';
import { Playwire } from '@intergi/react-native-playwire-sdk';

// TEMPORARY: always use Playwire test mode until real demand is live
Playwire.setTest(true);
Playwire.startConsoleLogger();

export function initPlaywire({ publisherId, iosAppId, androidAppId }) {
  const appId = Platform.select({
    ios: iosAppId,
    android: androidAppId,
  });

  if (!publisherId || !appId) {
    console.warn('Playwire init skipped: missing publisherId or platform appId');
    return;
  }

  try {
    Playwire.initializeSDK(publisherId, appId, () => {
      // SDK finished initialization
      // console.log('Playwire SDK initialized');
    });
  } catch (e) {
    // Only catches sync errors at call time
    console.warn('Playwire.initializeSDK threw an error:', e);
  }
}
