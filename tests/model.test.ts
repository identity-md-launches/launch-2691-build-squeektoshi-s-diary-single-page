import test from 'node:test';
import assert from 'node:assert/strict';
import { HOUR, DAY, parseStatus, parseHistory, parseEconomy, makeDays, getRecords, tokenExact, tokenNumber, numeric, type History, type Bucket } from '../src/model';

const today = Date.parse('2026-10-30T00:00:00Z');
const now = today + 8.5 * HOUR;
const bucket = (start: number, hours: number, work: number, settlements = 6): Bucket => ({ start, end: start + hours * HOUR, work, settlements });
const history = (buckets: Bucket[], generatedAt = now): History => ({ generatedAt, buckets, summary: null });

test('real API telemetry units, string block values, and unknown phases', () => {
  const spinning = parseStatus({ measurement: { coreStatus: 'SPINNING', rpmMilli: 12500, speedMmPerSecond: 250, distanceMm: 11500044 }, builder: { anchor: { blockHeight: '4118', blockProgress: '503463521' } } });
  assert.equal(spinning.phase, 'running'); assert.equal(spinning.rpm, 12.5); assert.equal(spinning.speed, 25); assert.equal(spinning.distance, 11.500044);
  assert.equal(spinning.height, 4118); assert.equal(spinning.progress, 50.3463521);
  assert.equal(parseStatus({ measurement: { coreStatus: 'IDLE' } }).phase, 'napping');
  assert.equal(parseStatus({ measurement: { coreStatus: 'SOMETHING_NEW' } }).phase, 'unknown');
  assert.equal(parseStatus({ measurement: { coreStatus: 'IDLE' } }).rpm, null);
  assert.throws(() => parseStatus({}));
  assert.throws(() => parseStatus({ measurement: { coreStatus: undefined, rpmMilli: undefined }, builder: { anchor: { blockHeight: undefined } } }));
});

test('missing and malformed numbers remain unknown, never fabricated zeros', () => {
  for (const v of [null, undefined, '', {}, true, -1, 'Infinity', 'NaN', '9999999999999999999999999999']) assert.equal(numeric(v), null);
  assert.equal(numeric('0'), 0);
  const parsed = parseHistory({ status: 'available', buckets: [{ startAt: '2026-10-30T00:00:00Z', endAt: '2026-10-30T01:00:00Z' }, { startAt: 'bad', endAt: 'bad', workAdded: '5' }] });
  assert.equal(parsed.buckets.length, 1); assert.equal(parsed.buckets[0].work, null);
  assert.throws(() => parseHistory({ status: 'unavailable', buckets: [] }));
});

test('six-hour totals are not multiplied by six or invented as hourly values', () => {
  const days = makeDays([history([bucket(today - DAY, 6, 600), bucket(today - DAY + 6 * HOUR, 6, 0), bucket(today - DAY + 12 * HOUR, 6, 300), bucket(today - DAY + 18 * HOUR, 6, 0)])], 2, now);
  assert.equal(days[0].total, 900); assert.equal(days[0].complete, true);
  assert.equal(days[0].activeHours, null); assert.deepEqual(days[0].activeRange, [2, 12]);
  assert.deepEqual(days[0].stretchRange, [1, 6]);
  assert.equal(days[0].slots[0].exact, false); assert.equal(days[0].slots[0].bucket?.work, 600);
});

test('hourly observations take precedence, while totals tile whole coarse buckets without overlaps', () => {
  const day = today - DAY;
  const coarse = history([0, 6, 12, 18].map((h, i) => bucket(day + h * HOUR, 6, (i + 1) * 100)));
  const fine = history([bucket(day + 2 * HOUR, 1, 17), bucket(day + 3 * HOUR, 1, 18)]);
  const result = makeDays([coarse, fine], 2, now)[0];
  assert.equal(result.total, 1000); assert.equal(result.complete, true);
  assert.equal(result.slots[2].exact, true); assert.equal(result.slots[2].bucket?.work, 17);
});

test('a noon-to-noon 30-day bucket is never presented as a calendar-day total', () => {
  const d = makeDays([history([bucket(today - 12 * HOUR, 24, 1000)])], 2, now);
  assert.equal(d[0].total, null); assert.equal(d[1].total, null);
  assert.equal(d[1].knownTotal, 0); assert.equal(d[1].slots[2].exact, false);
});

test('unknown observation and future hours are separate from observed zero work', () => {
  const d = makeDays([history([bucket(today, 1, 0), bucket(today + HOUR, 1, 0, 0)])], 1, now)[0];
  assert.equal(d.slots[0].observed, true); assert.equal(d.slots[0].bucket?.work, 0);
  assert.equal(d.slots[1].observed, false); assert.equal(d.slots[9].future, true);
  assert.equal(d.total, null);
});

test('cache timestamps cannot stretch a partial bucket into later observations', () => {
  const d = makeDays([history([bucket(today, 6, 0)], today + HOUR)], 1, now)[0];
  assert.equal(d.slots[0].observed, true); assert.equal(d.slots[4].observed, false);
  assert.equal(d.total, null);
});

test('hourly active/quiet counts and longest stretches include midnight continuity', () => {
  const all = Array.from({ length: 48 }, (_, i) => bucket(today - DAY + i * HOUR, 1, i >= 22 && i <= 26 ? 10 : 0));
  const days = makeDays([history(all)], 2, now);
  assert.equal(days[0].activeHours, 2); assert.equal(days[0].quietHours, 22); assert.equal(days[0].longest, 2);
  assert.equal(days[1].activeHours, 3); assert.equal(days[1].quietHours, 5); assert.equal(days[1].longest, 3);
  const records = getRecords(days, now);
  assert.equal(records.longest, 5); assert.equal(records.streak, 2);
  assert.equal(records.best?.total, 20);
});

test('quietest day excludes missing days and current incomplete day', () => {
  const buckets = [2, 1].flatMap((offset) => [0, 6, 12, 18].map(h => bucket(today - offset * DAY + h * HOUR, 6, offset === 2 ? 0 : 100)));
  const records = getRecords(makeDays([history(buckets)], 7, now), now);
  assert.equal(records.quietest?.start, today - 2 * DAY);
  assert.equal(records.best?.total, 400); assert.equal(records.streak, 1);
  assert.equal(records.completeCount, 2);
});

test('token amounts retain base-unit precision and apply actual token decimals', () => {
  const e = parseEconomy({ status: 'available', asset: { decimals: 18 }, supply: { totalMintedBaseUnits: '16387784752755398547956254', liveSupplyBaseUnits: '16387784752755398547956254', capBaseUnits: '2100000000000000000000000000' } });
  assert.equal(tokenExact(e.minted, e.decimals), '16,387,784.752755398547956254');
  assert.equal(tokenNumber(e.cap, e.decimals), 2100000000);
  assert.equal(tokenExact('7', 0), '7'); assert.equal(tokenExact('1', 3), '0.001');
  assert.equal(tokenNumber(null, 18), null);
  assert.throws(() => parseEconomy({ status: 'available', supply: { totalMintedBaseUnits: undefined, capBaseUnits: undefined } }));
});
