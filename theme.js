// theme.js
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'theme.mode';           // 'system' | 'light' | 'dark'

// —— Palettes ———————————————————————————————————————————————————
// Keys cover everything used across your pages (union of all pages).
const DARK = {
  // App structure
  bg: '#0b0c10',
  pageBg: '#0b0c10',
  card: '#0f1525',
  border: '#1e2638',
  border2: '#2a3348',
  ink: '#e6eefc',
  muted: '#93a4bf',
  inputBg: '#0c1326',
  inputBorder: '#1b2642',

  // Accents & states
  accent: '#6366f1',
  accentDark: '#4338ca',
  ok: '#22c55e',
  warn: '#f59e0b',
  yellow: '#f59e0b',
  red: '#ef4444',
  bad: '#ef4444',
  danger: '#f43f5e',

  // “Strip”/banners & chips
  stripBg: '#0f1422',
  stripBorder: '#1d2233',
  chip: '#0c1322',
  chipBorder: '#23304d',
  chipBg: '#1b2540',
  chipBorder2: '#2a3a63',
  chipActiveBg: '#102b1f',
  chipActiveBorder: '#1f7a5a',
  chipUsed: '#9aa6ca',

  // Tables & special text
  thead: '#0f172a',
  whiteHi: '#e6eefc',
  whiteMd: '#cbd5e1',
  text: '#e6eefc',

  // Prices/Leagues cards
  name: '#e5e7eb',
  pts: '#f8fafc',
  ptsBench: '#a8b3cc',
  ptsMissed: '#9aa0ad',
  eo: '#a7b4d6',
  same: '#9aa0ad',
  pitchBgEdge: '#0b1224',

  // Code blocks (ChangeID)
  codeBg: '#0b1328',
  codeInk: '#e2ecff',
};

const LIGHT = {
  // App structure
  bg: '#ffffff',
  pageBg: '#f8fafc',
  card: '#ffffff',
  border: '#e5e7eb',
  border2: '#d1d5db',
  ink: '#0b1320',
  muted: '#64748b',
  inputBg: '#f1f5f9',
  inputBorder: '#cbd5e1',

  // Accents & states
  accent: '#2563eb',
  accentDark: '#1d4ed8',
  ok: '#16a34a',
  warn: '#f59e0b',
  yellow: '#f59e0b',
  red: '#dc2626',
  bad: '#dc2626',
  danger: '#dc2626',

  // “Strip”/banners & chips
  stripBg: '#eef2ff',
  stripBorder: '#c7d2fe',
  chip: '#f3f4f6',
  chipBorder: '#e5e7eb',
  chipBg: '#f5f6fb',
  chipBorder2: '#e8eaf0',
  chipActiveBg: '#e6fff5',
  chipActiveBorder: '#8be0c0',
  chipUsed: '#6b7280',

  // Tables & special text
  thead: '#f3f4f6',
  whiteHi: '#0f172a',
  whiteMd: '#334155',
  text: '#0f172a',

  // Prices/Leagues cards
  name: '#111827',
  pts: '#111827',
  ptsBench: '#6b7280',
  ptsMissed: '#9ca3af',
  eo: '#475569',
  same: '#6b7280',
  pitchBgEdge: '#e5e7eb',

  // Code blocks (ChangeID)
  codeBg: '#f3f4f6',
  codeInk: '#0b1320',
};

// Navigation theme (React Navigation)
const makeNavTheme = (colors) => ({
  dark: colors === DARK,
  colors: {
    background: colors.bg,
    card: colors.card,
    text: colors.ink,
    border: colors.border,
    primary: colors.accent,
    notification: colors.accent,
  },
});

const ThemeContext = createContext({
  mode: 'system',
  setMode: (_m) => {},
  colors: DARK,
  navTheme: makeNavTheme(DARK),
});

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState('system'); // 'system' | 'light' | 'dark'
  const sys = Appearance.getColorScheme();    // 'light' | 'dark' | null

  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved) setMode(saved);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      if (mode === 'system') {
        // re-render to apply system changes
        setMode((m) => m); 
      }
    });
    return () => sub.remove();
  }, [mode]);

  const effective = mode === 'system' ? (sys ?? 'dark') : mode;
  const colors = effective === 'light' ? LIGHT : DARK;

  const value = useMemo(
    () => ({ mode, setMode: async (m) => { setMode(m); try { await AsyncStorage.setItem(STORAGE_KEY, m); } catch {} }, colors, navTheme: makeNavTheme(colors) }),
    [mode, effective]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
export const useColors = () => useContext(ThemeContext).colors;
