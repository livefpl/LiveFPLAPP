// signedFetch.ts (TypeScript)
// - Only signs calls to your Cloud Run base
// - Bumps the ad meter (worth 2) AFTER real API calls
// - Shows an Alert so you can verify bumps during testing

import { Alert } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as Application from 'expo-application';
import { bump } from './meter';

// === CONFIG ===
// Keep BASE without trailing slash to avoid accidental '//'
export const CLOUDRUN_BASE = 'https://livefpl-api-489391001748.europe-west4.run.app';

const STORE_KEY = 'session.v1';

export interface Session {
  sid: string;
  jwt: string;
  sigSecret: string;
  exp: number; // epoch seconds
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
 */
export async function signedFetch(urlOrPath: string, init: RequestInit = {}): Promise<Response> {
  const isPath = urlOrPath.startsWith('/');
  const url = isPath ? `${CLOUDRUN_BASE}${urlOrPath}` : urlOrPath;
  const u = new URL(url);

  // Not our API -> plain fetch (no signing, no bump)
  if (!u.href.startsWith(CLOUDRUN_BASE)) {
    return fetch(url, init);
  }

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

  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${jwt}`,
      'X-Date': ts,
      'X-Nonce': nonce,
      'X-Signature': sig,
      'X-App-Version': Application.nativeApplicationVersion ?? '',
      'X-App-Build': Application.nativeBuildVersion ?? '',
      ...(init.headers || {}),
    } as Record<string, string>,
    body: (bodyStr || undefined) as any,
  });

  // Count this real Cloud Run call (worth 2) and show a debug Alert
  setTimeout(() => {
    try {
      bump({ source: 'api', key: `${method}:${pathOnly}` }); // +1
      bump({ source: 'api', force: true });                  // +1 (bypass dedupe)
      
    } catch (e: any) {
     console.log(e)
    }
  }, 0);

  return res;
}

/**
 * Convenience wrapper: if the URL belongs to your Cloud Run API, sign it;
 * otherwise do a normal fetch. This lets you use one function everywhere.
 */
export async function smartFetch(urlOrPath: string, init: RequestInit = {}): Promise<Response> {
  if (urlOrPath.startsWith('/') || urlOrPath.startsWith(CLOUDRUN_BASE)) {
    return signedFetch(urlOrPath, init);
  }
  return fetch(urlOrPath, init);
}
