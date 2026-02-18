// i18n.js – bootstrap for app translations (en, es, ar, fr, de)
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';

const LANGUAGE_KEY = '@LiveFPL language';
const SUPPORTED = ['en', 'es', 'ar', 'fr', 'de'];

function mapLocaleToSupported(locale) {
  if (!locale) return 'en';
  const code = (locale.languageCode || locale).split('-')[0].toLowerCase();
  if (SUPPORTED.includes(code)) return code;
  const map = { pt: 'en', it: 'en', nl: 'en' };
  return map[code] || 'en';
}

const resources = {
  en: { translation: require('./locales/en.json') },
  es: { translation: require('./locales/es.json') },
  ar: { translation: require('./locales/ar.json') },
  fr: { translation: require('./locales/fr.json') },
  de: { translation: require('./locales/de.json') },
};

i18n.use(initReactI18next).init({
  resources,
  fallbackLng: 'en',
  supportedLngs: SUPPORTED,
  compatibilityJSON: 'v4',
  interpolation: { escapeValue: false },
});

export async function initI18nLanguage() {
  try {
    const stored = await AsyncStorage.getItem(LANGUAGE_KEY);
    if (stored && SUPPORTED.includes(stored)) {
      await i18n.changeLanguage(stored);
      return;
    }
    const locales = Localization.getLocales();
    const lang = mapLocaleToSupported(locales?.[0]);
    await i18n.changeLanguage(lang);
  } catch (e) {
    console.warn('i18n init language', e);
  }
}

export async function setStoredLanguage(lang) {
  if (!SUPPORTED.includes(lang)) return;
  await AsyncStorage.setItem(LANGUAGE_KEY, lang);
  await i18n.changeLanguage(lang);
}

export default i18n;
