// playwireInit.js
import { Platform, Alert } from 'react-native';
import { Playwire } from '@intergi/react-native-playwire-sdk';

export function initPlaywire({ publisherId, iosAppId, androidAppId }) {
  const appId = Platform.select({
    ios: iosAppId,
    android: androidAppId,
  });

  


  try {
        Playwire.initializeSDK(publisherId, appId, () => {
      // This callback is invoked when the SDK finishes initialization
          });
  } catch (e) {
    
  }
}
