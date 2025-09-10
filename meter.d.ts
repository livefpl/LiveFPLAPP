// meter.d.ts – type stubs for your JS meter so TS is happy

export function setConfig(partial: {
  N?: number;
  cooldownMs?: number;
  dedupeTtlMs?: number;
}): { N: number; cooldownMs: number; dedupeTtlMs: number };

export function setTrigger(fn: (ctx: { count: number; source: string }) => any): boolean;

export function bump(opts?: {
  source?: string;
  key?: string;
  force?: boolean;
}): { counter: number; fired: boolean; reason: string };

export function getState(): {
  counter: number;
  state: 'idle' | 'loading_ad' | 'cooldown' | string;
  lastShownAt: number;
  config: { N: number; cooldownMs: number; dedupeTtlMs: number };
};

export function reset(): void;
