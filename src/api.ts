import { parseStatus, parseHistory, parseEconomy, object, type Telemetry, type History, type Economy } from './model';

const API = 'https://api.squeekchain.com/v1';
const CACHE_KEY = 'squeektoshi-diary:v1';
export type Resource = 'status' | '24h' | '7d' | '30d' | 'economy';
export interface DiaryState {
  status: Telemetry | null;
  '24h': History | null;
  '7d': History | null;
  '30d': History | null;
  economy: Economy | null;
  errors: Set<Resource>;
  updated: Partial<Record<Resource, number>>;
  loading: boolean;
}
export const state: DiaryState = { status: null, '24h': null, '7d': null, '30d': null, economy: null, errors: new Set(), updated: {}, loading: true };
const paths: Record<Resource, string> = { status: '/status', '24h': '/settlements?range=24h', '7d': '/settlements?range=7d', '30d': '/settlements?range=30d', economy: '/economy/state' };
const pending = new Set<Resource>();

export function restoreCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
    const c = object(cached);
    if (c.version !== 1) return;
    const payloads = object(c.payloads), updated = object(c.updated);
    for (const key of Object.keys(paths) as Resource[]) {
      const raw = payloads[key];
      if (!raw) continue;
      try {
        apply(key, raw);
        const date = updated[key];
        if (typeof date === 'number' && Number.isFinite(date)) state.updated[key] = date;
        state.errors.add(key);
        rawCache[key] = raw;
      } catch { /* A damaged resource must not erase the other cached observations. */ }
    }
  } catch { /* Storage may be blocked or corrupt. The diary still works without it. */ }
}

const rawCache: Partial<Record<Resource, unknown>> = {};

function apply(resource: Resource, raw: unknown) {
  if (resource === 'status') state.status = parseStatus(raw);
  else if (resource === 'economy') state.economy = parseEconomy(raw);
  else state[resource] = parseHistory(raw);
}

/** Cache only the public fields this page uses, never signer or installation metadata. */
function compact(resource: Resource, raw: unknown): unknown {
  const d = object(raw);
  if (resource === 'status') {
    const m = object(d.measurement), a = object(object(d.builder).anchor);
    return { generatedAt: d.generatedAt, measurement: { coreStatus: m.coreStatus, rpmMilli: m.rpmMilli, speedMmPerSecond: m.speedMmPerSecond, distanceMm: m.distanceMm, cumulativeWorkUnits: m.cumulativeWorkUnits, observedAt: m.observedAt, staleAfterSeconds: m.staleAfterSeconds, freshness: m.freshness }, builder: { anchor: { blockHeight: a.blockHeight, blockProgress: a.blockProgress } } };
  }
  if (resource === 'economy') {
    const s = object(d.supply);
    return { status: d.status, generatedAt: d.generatedAt, asset: { decimals: object(d.asset).decimals }, supply: { totalMintedBaseUnits: s.totalMintedBaseUnits, capBaseUnits: s.capBaseUnits, liveSupplyBaseUnits: s.liveSupplyBaseUnits } };
  }
  return { status: d.status, generatedAt: d.generatedAt, summary: { workAdded: object(d.summary).workAdded }, buckets: Array.isArray(d.buckets) ? d.buckets.map(v => { const b = object(v); return { startAt: b.startAt, endAt: b.endAt, workAdded: b.workAdded, settlementCount: b.settlementCount }; }) : null };
}

export async function refresh(resources: Resource[], onChange: (changed: Resource[]) => void) {
  const available = resources.filter(r => !pending.has(r));
  if (!available.length) return;
  available.forEach(r => pending.add(r));
  await Promise.allSettled(available.map(async resource => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`${API}${paths[resource]}`, { signal: controller.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error(`Public API returned ${response.status}`);
      const data = compact(resource, await response.json());
      apply(resource, data);
      rawCache[resource] = data;
      state.updated[resource] = Date.now();
      state.errors.delete(resource);
    } catch {
      state.errors.add(resource);
    } finally {
      clearTimeout(timer);
      pending.delete(resource);
    }
  }));
  state.loading = false;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ version: 1, payloads: rawCache, updated: state.updated })); } catch { /* Storage is optional. */ }
  onChange(available);
}
