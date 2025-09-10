import React from 'react';
import { Image } from 'react-native';

// Base paths for remote images
export const CLUB_CREST_BASE = 'https://livefpl.us/figures/new_logos2/';
export const CLUB_CREST_EXT = '.png';

export const ASSET_BASE = 'https://livefpl.us/figures/'; // for arrows

// --- Club crests ---
export const clubCrestUri = (clubId) =>
  `${CLUB_CREST_BASE}${String(clubId)}${CLUB_CREST_EXT}`;

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
