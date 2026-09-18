import { Platform } from 'react-native';

// Freestar / AppLovin MAX test-build IDs. Production Playwire stays on master.
export const MAX_SDK_KEY =
  'hO52kFtMvEo_AoeRzED0_XXfS1B1VQp9GW50yudJO-eUUTOmRBLl3c-2GyTevLNspll_fN5PLTbAHOakoTuHuP';

export const GAD_APP_ID = Platform.select({
  ios: 'ca-app-pub-8061946413537984~4171878940',
  android: 'ca-app-pub-8061946413537984~5484960613',
});

export const BANNER_AD_UNIT_ID = Platform.select({
  ios: '41b130d0f774a5dd',
  android: 'd57df5027cedf6a9',
});

export const INTERSTITIAL_AD_UNIT_ID = Platform.select({
  ios: '7a9e3e1d1c65f45b',
  android: '2c88ce6d64dbe70e',
});

export const ANDROID_AD_REVIEW_KEY =
  'CATKx497wlO3DsbMGWxBITQg_OqT7XXdI_Zw_NLFriX9yVSAWdEK9wbnpqK0c3rI5ezOZzGVw7J7RTJtdAzwUZ';
