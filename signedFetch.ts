// signedFetch.ts (TypeScript)
// - Only signs calls to your Cloud Run base
// - Bumps the ad meter (worth 2) AFTER real API calls
// - Adds a minimal "updating" gate via https://livefpl.us/version.json
//   If "updating" === 1, NO Cloud Run API calls are performed and a one-time Alert is shown.

import { Alert } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as Application from 'expo-application';
import { bump } from './meter';

// === CONFIG ===
// Keep BASE without trailing slash to avoid accidental '//'
export const CLOUDRUN_BASE = 'https://livefpl-api-489391001748.europe-west4.run.app';

const STORE_KEY = 'session.v1';
const RETRY_ON_401_KEY = '__retried401'; // internal flag to avoid infinite loops

// -------- version.json (updating gate) ----------
const VERSION_URL = 'https://livefpl.us/version.json';
const VERSION_TTL_MS = 60_000; // avoid spamming; re-check at most every 30s

type VersionJson = {
  updating?: number | boolean | string;
  [k: string]: any;
};

let __versionInfo: VersionJson | null = null;
let __versionFetchedAt = 0;
let __alertedUpdating = false; // show a one-time banner/alert

async function ensureVersionInfo(): Promise<VersionJson> {
  const now = Date.now();
  if (__versionInfo && (now - __versionFetchedAt) < VERSION_TTL_MS) return __versionInfo;
  try {
    const r = await fetch(VERSION_URL, { cache: 'no-store' });
    if (r.ok) {
      __versionInfo = (await r.json()) as VersionJson;
      __versionFetchedAt = now;
    } else if (!__versionInfo) {
      __versionInfo = {};
    }
  } catch {
    if (!__versionInfo) __versionInfo = {};
  }
  return __versionInfo!;
}

function isUpdatingFlagTrue(v: VersionJson | null): boolean {
  if (!v) return false;
  const raw = v.updating as any;
  if (raw === 1 || raw === '1' || raw === true || raw === 'true') return true;
  return false;
}

/** Optional helper if other modules want to query the current state after the first call. */
export function isAppUpdating(): boolean {
  return isUpdatingFlagTrue(__versionInfo);
}

// ------------------------------------------------

export interface Session {
  sid: string;
  jwt: string;
  sigSecret: string;
  exp: number; // epoch seconds
}

/** Validate: if the path contains "/leagues/", it MUST be followed by a numeric id segment. */
function validateLeaguePathOrThrow(pathname: string) {
  const idx = pathname.indexOf('/leagues/');
  if (idx === -1) return; // no leagues segment -> no special rule
  const after = pathname.slice(idx + '/leagues/'.length); // everything after "/leagues/"
  // Extract the next segment (until / ? or end)
  const nextSeg = after.split(/[/?#]/)[0] ?? '';
  const isNumeric = /^\d+$/.test(nextSeg);
  if (!isNumeric) {
    const example = '/LH_api/leagues/123?autosubs=1';
    const msg = `Invalid league URL: "${pathname}". Expected a numeric id after "/leagues/". Example: ${example}`;
    console.warn(msg);
    throw new Error(msg);
  }
}

async function sha256b64(input: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    input,
    { encoding: Crypto.CryptoEncoding.BASE64 }
  );
}

async function nonceHex(len = 16): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(len);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function ensureSession(): Promise<Session> {
  const now = Date.now() / 1000;
  const raw = await SecureStore.getItemAsync(STORE_KEY);
  if (raw) {
    try {
      const s = JSON.parse(raw) as Session;
      if (s?.exp && s.exp - 60 > now) return s;
    } catch {
      // ignore parse error -> fall through to refresh
    }
  }

    const res = await fetch(`${CLOUDRUN_BASE}/auth/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: Application.applicationName,
      version: Application.nativeApplicationVersion,
      build: Application.nativeBuildVersion,
    }),
  });
  if (!res.ok) throw new Error(`auth/start ${res.status}`);
  const s = (await res.json()) as Session;
  await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(s));
  return s;

  
}

/**
 * Signed request to your Cloud Run API.
 * Pass either an absolute URL under CLOUDRUN_BASE, or a path like "/api/games".
 * NOTE: Blocks when version.json has updating == 1 (one-time Alert + throw).
 */
export async function signedFetch(urlOrPath: string, init: RequestInit = {}): Promise<Response> {
  const isPath = urlOrPath.startsWith('/');
  const url = isPath ? `${CLOUDRUN_BASE}${urlOrPath}` : urlOrPath;
  const u = new URL(url);

  // Not our API -> plain fetch (no signing, no bump, no gate)
  if (!u.href.startsWith(CLOUDRUN_BASE)) {
    return fetch(url, init);
  }

  // ---- Updating gate (hard block BEFORE any API call, including auth/start) ----
  await ensureVersionInfo();
  if (isUpdatingFlagTrue(__versionInfo)) {
    const e: any = new Error('UPDATING');
    e.code = 'APP_UPDATING';
    e.blockedUrl = url;
    if (!__alertedUpdating) {
      //__alertedUpdating = true;
      Alert.alert('LiveFPL is updating', 'Please try again in a moment.');
    }
    throw e; // DO NOT hit the API
  }
  // -----------------------------------------------------------------------------

  validateLeaguePathOrThrow(u.pathname);
  const { jwt, sigSecret } = await ensureSession();

  const method = (init.method || 'GET').toUpperCase();
  // RN Fetch types are loose; treat body as any and stringify if it's a plain object.
  const rawBody: any = (init as any).body;
  const bodyStr =
    typeof rawBody === 'string' ? rawBody : rawBody ? JSON.stringify(rawBody) : '';

  const ts = new Date().toISOString();
  const nonce = await nonceHex();
  const pathOnly = u.pathname; // exclude query to avoid ordering issues in signing
  const payload = [method, pathOnly, bodyStr, ts, nonce].join('\n');
  const sig = await sha256b64(`v1:${sigSecret}:${payload}:${sigSecret}`);

  let res = await fetch(url, {
    ...init,
    headers: {
  ...(init.headers || {}), // caller headers first
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${jwt}`,
  'X-Date': ts,
  'X-Nonce': nonce,
  'X-Signature': sig,
  'X-App-Version': Application.nativeApplicationVersion ?? '',
  'X-App-Build': Application.nativeBuildVersion ?? '',
} as Record<string, string>,

    body: (bodyStr || undefined) as any,
  });

  if (res.status === 401 && !(init as any)[RETRY_ON_401_KEY]) {
  try { await SecureStore.deleteItemAsync(STORE_KEY); } catch {}
  const nextInit: RequestInit = { ...(init as any), [RETRY_ON_401_KEY]: true };
  return signedFetch(urlOrPath, nextInit);
}

  // Count this real Cloud Run call (worth 2)
  setTimeout(() => {
    try {
      bump({ source: 'api', key: `${method}:${pathOnly}` }); // +1
      bump({ source: 'api', force: true });                  // +1 (bypass dedupe)
    } catch (e: any) {
      console.log(e);
    }
  }, 0);

  return res;
}

/**
 * Convenience wrapper: if the URL belongs to your Cloud Run API, sign it;
 * otherwise do a normal fetch. This lets you use one function everywhere.
 * NOTE: Cloud Run calls will be blocked when version.json has updating == 1.
 */
export async function smartFetch(urlOrPath: string, init: RequestInit = {}): Promise<Response> {
  if (urlOrPath.startsWith('/') || urlOrPath.startsWith(CLOUDRUN_BASE)) {
    return signedFetch(urlOrPath, init); // includes the updating gate
  }
  return fetch(urlOrPath, init);
}
