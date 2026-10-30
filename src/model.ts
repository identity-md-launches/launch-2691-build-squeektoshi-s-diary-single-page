export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export type Phase = 'running' | 'napping' | 'unknown';
export interface Telemetry {
  phase: Phase;
  rpm: number | null;
  speed: number | null;
  distance: number | null;
  passes: number | null;
  height: number | null;
  progress: number | null;
  observedAt: number | null;
  generatedAt: number | null;
  staleAfter: number;
  freshness: string;
}
export interface Bucket { start: number; end: number; work: number | null; settlements: number | null }
export interface History { generatedAt: number; buckets: Bucket[]; summary: number | null }
export interface Economy { minted: string | null; cap: string | null; live: string | null; decimals: number; generatedAt: number | null }
export interface Slot { start: number; future: boolean; bucket: Bucket | null; observed: boolean; exact: boolean; level: number }
export interface DiaryDay {
  start: number; slots: Slot[]; total: number | null; knownTotal: number;
  observedHours: number; exactHours: number; activeHours: number | null;
  quietHours: number | null; longest: number | null; busiest: Bucket | null; complete: boolean; today: boolean;
  activeRange: [number, number] | null; stretchRange: [number, number] | null;
}

export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function numeric(value: unknown): number | null {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER ? n : null;
}
export function timestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const n = Date.parse(value);
  return Number.isFinite(n) ? n : null;
}
const units = (value: unknown): string | null => typeof value === 'string' && /^\d{1,80}$/.test(value) ? value : null;
export function parseStatus(raw: unknown): Telemetry {
  const d = object(raw), m = object(d.measurement), anchor = object(object(d.builder).anchor);
  const rpm = numeric(m.rpmMilli), speed = numeric(m.speedMmPerSecond), distance = numeric(m.distanceMm), progress = numeric(anchor.blockProgress);
  if (typeof m.coreStatus !== 'string' && rpm === null && speed === null && distance === null && numeric(anchor.blockHeight) === null && progress === null) throw new Error('Wheel data unavailable');
  return {
    phase: m.coreStatus === 'SPINNING' ? 'running' : m.coreStatus === 'IDLE' ? 'napping' : 'unknown',
    rpm: rpm === null ? null : rpm / 1000,
    speed: speed === null ? null : speed / 10,
    distance: distance === null ? null : distance / 1_000_000,
    passes: numeric(m.cumulativeWorkUnits), height: numeric(anchor.blockHeight),
    progress: progress === null ? null : Math.min(100, progress / 10_000_000),
    observedAt: timestamp(m.observedAt), generatedAt: timestamp(d.generatedAt),
    staleAfter: (numeric(m.staleAfterSeconds) ?? 120) * 1000,
    freshness: typeof m.freshness === 'string' ? m.freshness : 'unknown',
  };
}
export function parseHistory(raw: unknown): History {
  const d = object(raw);
  if (d.status !== 'available' || !Array.isArray(d.buckets)) throw new Error('Diary data unavailable');
  const buckets: Bucket[] = [];
  for (const value of d.buckets) {
    const b = object(value), start = timestamp(b.startAt), end = timestamp(b.endAt);
    if (start === null || end === null || end <= start || end - start > 2 * DAY) continue;
    buckets.push({ start, end, work: numeric(b.workAdded), settlements: numeric(b.settlementCount) });
  }
  if (!buckets.length && d.buckets.length) throw new Error('No readable diary observations');
  return { generatedAt: timestamp(d.generatedAt) ?? Date.now(), buckets, summary: numeric(object(d.summary).workAdded) };
}
export function parseEconomy(raw: unknown): Economy {
  const d = object(raw), supply = object(d.supply), asset = object(d.asset), decimals = numeric(asset.decimals);
  if (d.status !== 'available' || ![supply.totalMintedBaseUnits, supply.capBaseUnits, supply.liveSupplyBaseUnits].some(v => units(v) !== null)) throw new Error('Supply data unavailable');
  return { minted: units(supply.totalMintedBaseUnits), cap: units(supply.capBaseUnits), live: units(supply.liveSupplyBaseUnits), decimals: decimals !== null && Number.isInteger(decimals) && decimals <= 36 ? decimals : 18, generatedAt: timestamp(d.generatedAt) };
}
export const dayStart = (time: number) => Math.floor(time / DAY) * DAY;
export const formatNumber = (n: number | null, digits = 0) => n === null ? '–' : new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(n);
export function tokenNumber(unitsValue: string | null, decimals: number): number | null {
  if (unitsValue === null) return null;
  const n = Number(unitsValue) / 10 ** decimals;
  return Number.isFinite(n) ? n : null;
}
export function tokenExact(unitsValue: string | null, decimals: number): string {
  if (unitsValue === null) return 'Unavailable';
  if (!decimals) return BigInt(unitsValue).toLocaleString('en-US');
  const padded = unitsValue.padStart(decimals + 1, '0');
  return `${BigInt(padded.slice(0, -decimals)).toLocaleString('en-US')}.${padded.slice(-decimals)}`;
}

/** Prefer the smallest real bucket. Never split a coarse count into invented hourly totals. */
export function makeDays(histories: History[], count: number, now: number): DiaryDay[] {
  const ordered = histories.flatMap(h => h.buckets.map(b => ({ ...b, generatedAt: h.generatedAt })))
    .sort((a, b) => (a.end - a.start) - (b.end - b.start) || b.generatedAt - a.generatedAt);
  const maxRate = Math.max(1, ...ordered.filter(b => b.work !== null && (b.settlements ?? 0) > 0).map(b => b.work! / ((b.end - b.start) / HOUR)));
  const today = dayStart(now);
  return Array.from({ length: count }, (_, i) => {
    const start = today - (count - 1 - i) * DAY;
    const slots = Array.from({ length: 24 }, (_, hour): Slot => {
      const time = start + hour * HOUR, future = time > now;
      const bucket = future ? null : ordered.find(b => b.start <= time && b.end >= time + HOUR && b.generatedAt >= time && b.work !== null && ((b.settlements ?? 0) > 0 || (b.work ?? 0) > 0)) ?? null;
      const exact = bucket !== null && bucket.end - bucket.start === HOUR;
      const rate = bucket?.work === null || !bucket ? 0 : bucket.work / ((bucket.end - bucket.start) / HOUR);
      const level = rate === 0 ? 0 : Math.max(1, Math.min(4, Math.ceil(4 * Math.sqrt(rate / maxRate))));
      return { start: time, future, bucket, observed: bucket !== null, exact, level };
    });
    const unique = [...new Set(slots.map(s => s.bucket).filter((b): b is Bucket => !!b))];
    // Tile the day with non-overlapping whole buckets. Backtrack to a complete
    // coarse bucket when a detailed feed covers only part of that same interval.
    // Noon-to-noon totals can never be silently assigned to a calendar day.
    const end = Math.min(start + DAY, Math.floor(now / HOUR) * HOUR + HOUR);
    const candidates = ordered.filter(b => b.start >= start && b.start < end && b.end <= start + DAY && b.work !== null && ((b.settlements ?? 0) > 0 || (b.work ?? 0) > 0));
    const memo = new Map<number, number | null>();
    const tile = (cursor: number): number | null => {
      if (cursor >= end) return 0;
      if (memo.has(cursor)) return memo.get(cursor)!;
      for (const b of candidates.filter(b => b.start === cursor)) {
        if (b.generatedAt < Math.min(b.end, end) - HOUR) continue;
        const rest = tile(b.end);
        if (rest !== null) { const total = b.work! + rest; memo.set(cursor, total); return total; }
      }
      memo.set(cursor, null); return null;
    };
    const total = tile(start);
    let knownTotal = 0, lastEnd = start;
    for (const b of [...candidates].sort((a, b) => a.start - b.start || (a.end - a.start) - (b.end - b.start))) {
      if (b.start >= lastEnd) { knownTotal += b.work!; lastEnd = b.end; }
    }
    if (total !== null) knownTotal = total;
    const observedHours = slots.filter(s => s.observed && s.start + HOUR <= now).length;
    const exactSlots = slots.filter(s => s.exact && s.start + HOUR <= now);
    const exactHours = exactSlots.length;
    const fullyHourly = exactHours === Math.min(24, Math.floor((now - start) / HOUR));
    let longest = 0, stretch = 0;
    for (const slot of slots) {
      if (slot.exact && slot.start + HOUR <= now && (slot.bucket?.work ?? 0) > 0) { stretch++; longest = Math.max(longest, stretch); } else stretch = 0;
    }
    const resolved = slots.filter(s => s.start + HOUR <= now && s.observed);
    const hourlyActive = resolved.filter(s => s.exact && (s.bucket?.work ?? 0) > 0).length;
    const unresolvedActive = [...new Set(resolved.filter(s => !s.exact && (s.bucket?.work ?? 0) > 0).map(s => s.bucket!))];
    const fullyInside = unresolvedActive.filter(b => b.start >= start && b.end <= Math.min(start + DAY, Math.floor(now / HOUR) * HOUR));
    const minActive = hourlyActive + fullyInside.filter(b => !resolved.some(s => s.exact && s.bucket!.work! > 0 && s.start >= b.start && s.start < b.end)).length;
    const maxActive = resolved.filter(s => (s.bucket?.work ?? 0) > 0).length;
    let maxStretch = 0, possibleStretch = 0;
    for (const s of slots) {
      if (s.start + HOUR <= now && s.observed && (s.bucket?.work ?? 0) > 0) { possibleStretch++; maxStretch = Math.max(maxStretch, possibleStretch); } else possibleStretch = 0;
    }
    const minStretch = Math.max(longest, minActive > 0 ? 1 : 0);
    const busiest = unique.filter(b => b.work !== null && b.work > 0 && b.start >= start && b.end <= start + DAY)
      .sort((a, b) => (b.work! / (b.end - b.start)) - (a.work! / (a.end - a.start)))[0] ?? null;
    return {
      start, slots, total, knownTotal,
      observedHours, exactHours,
      activeHours: fullyHourly && exactHours > 0 ? exactSlots.filter(s => (s.bucket?.work ?? 0) > 0).length : null,
      quietHours: fullyHourly && exactHours > 0 ? exactSlots.filter(s => s.bucket?.work === 0).length : null,
      longest: fullyHourly && exactHours > 0 ? longest : null, busiest,
      complete: total !== null && start + DAY <= now,
      today: start === today,
      activeRange: resolved.length ? [minActive, maxActive] : null,
      stretchRange: resolved.length ? [minStretch, maxStretch] : null,
    };
  });
}

export function getRecords(days: DiaryDay[], now = Date.now()) {
  const complete = days.filter(d => d.complete && d.total !== null);
  const best = [...complete].sort((a, b) => b.total! - a.total!)[0] ?? null;
  const quietest = [...complete].sort((a, b) => a.total! - b.total!)[0] ?? null;
  // A streak may continue from yesterday while today's day is still in progress.
  let streak = 0;
  for (const d of [...days].reverse()) {
    const active = d.knownTotal > 0 || d.slots.some(s => (s.bucket?.work ?? 0) > 0 && s.bucket!.start >= d.start && s.bucket!.end <= d.start + DAY);
    if (d.today && !active) continue;
    if (active) streak++;
    else break;
  }
  let longest = 0, stretch = 0, longestAt: number | null = null;
  for (const d of days) for (const s of d.slots) {
    if (s.exact && s.start + HOUR <= now && (s.bucket?.work ?? 0) > 0) {
      stretch++;
      if (stretch > longest) { longest = stretch; longestAt = s.start - (stretch - 1) * HOUR; }
    } else stretch = 0;
  }
  return { best, quietest, streak, longest, longestAt, completeCount: complete.length };
}
