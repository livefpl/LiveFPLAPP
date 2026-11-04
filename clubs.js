import React from 'react';
import { Image } from 'react-native';

// Base paths for remote images
export const CLUB_CREST_BASE = 'https://livefpl.us/figures/new_logos2/';
export const CLUB_CREST_EXT = '.png';

export const ASSET_BASE = 'https://livefpl.us/figures/'; // for arrows

// FPL season label used as Image cache key. Rolls over on 1 Aug UTC (no app update needed).
export function fplSeasonKey(d = new Date()) {
  const y = d.getUTCFullYear();
  const startYear = d.getUTCMonth() >= 7 ? y : y - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

let kitsOverride = '';

export function setCrestCacheBust(value) {
  const next = value == null ? '' : String(value).trim();
  kitsOverride = next && next !== '0' ? next : '';
}

export function crestCacheKey() {
  return kitsOverride || fplSeasonKey();
}

// --- Club crests ---
export const clubCrestUri = (clubId) =>
  `${CLUB_CREST_BASE}${String(clubId)}${CLUB_CREST_EXT}?v=${encodeURIComponent(crestCacheKey())}`;

export function ClubCrest({ id, style, ...imgProps }) {
  return <Image source={{ uri: clubCrestUri(id ?? 1) }} style={style} {...imgProps} />;
}

// --- Local imports (for pitch) ---
import livefplpitch from './images/livefplpitch.png';  // adjust path if needed

// --- Other global assets ---
export const assetImages = {
  up:   { uri: `${ASSET_BASE}up.png` },
  down: { uri: `${ASSET_BASE}down.png` },
  same: { uri: `${ASSET_BASE}same.png` },
  logo: { uri: `${ASSET_BASE}livefpllogo.png` }, 
  pitch: livefplpitch,   // ✅ local image reference
};
